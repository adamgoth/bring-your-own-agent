# @byoagent/browser

This browser-only TypeScript client requests agent work. It does not register tools or extend `document.modelContext`. Apps register their tools through WebMCP, then pass the names of the approved page tools to a task. BYOA resolves the actual WebMCP definitions and execution routes; credentials stay in the extension.

Start with the [web app integration guide](../../docs/web-app-integration.md) for tool registration, connection UI, task handling, reviewable changes, and local testing. This README describes the client contract and prototype limits.

```ts
import { byoa } from '@byoagent/browser';

// Call from a user button. BYOA owns the profile picker and site approval UI.
// Resolves after approval; rejects on Cancel, window close, navigation, or expiry.
const connection = await byoa.connect();

// Call request from a user button. Names refer to existing WebMCP tools.
const controller = new AbortController();
const task = await byoa.request({
  prompt: 'Break the selected card into smaller tasks',
  tools: ['get_board_snapshot', 'get_selected_cards', 'propose_board_changes'],
  signal: controller.signal, // optional AbortController
  timeoutMs: 90000, // optional; can only shorten the person’s run limit
});
for await (const event of task.events) showProgress(event);
// task.cancel(); task.openChat() from an explicit View chat click
```

`getStatus()`, `subscribe(listener)`, and `disconnect()` manage connection UI. `connect()` opens BYOA’s own extension window, shows the requesting origin and every profile (even a single profile), and waits for the user’s approval. The app does not enumerate profiles or pass a profile ID. The returned connection exposes only readiness and the approved profile’s ID/display name, never other profiles, credentials, or endpoint details. **Change profile** simply calls `connect()` again; cancellation preserves the existing connection. Switching profiles cancels this origin’s existing tasks without changing the extension-wide default. `subscribeTasks(listener)` supplies compact task events. `openSettings()` and `openChat(taskId?)` require a user click. `task.events` is a single-consumer async iterable of queued, working, done, cancelled, or error events. A terminal event has `busy: false`; a completed task need not have created a proposal. Every request is independent, without prior conversational history. Chat viewing is a transcript viewer, not a resumable conversation.

## Prototype boundaries

- Any top-level HTTPS page can ask to connect, as can plain-HTTP `localhost` or `127.0.0.1` on any port for local development. Plain HTTP on other hosts, subframes, and other schemes are refused. Being eligible grants nothing: each exact origin (scheme, host, and port) needs its own approval, and tasks check that approval before any model request. The origin rule contains no tool names or app-specific handlers.
- The page bridge stays dormant until the page sends its first client message (normally `getStatus()`), so ordinary sites see no polling or messages. Once a page calls the client, it can tell that BYOA is installed and whether any profile is ready; it learns nothing else until approved. Call `getStatus()` once at startup rather than waiting for an unsolicited status event.
- Configure API profiles in BYOA Options and explicitly choose one when connecting. API provider billing applies. This does not authenticate through a ChatGPT or Claude subscription.
- A trusted app click opens the BYOA-owned approval window. The popup is extension-private and validates the original tab, document, origin, request token, expiry, and selected profile before granting access. Closing or cancelling rejects the request. Pending approvals expire after three minutes; short status polls let the flow survive service-worker restarts. Permissions remain per origin and chosen connection duration. Spending budgets are controlled exclusively in extension UI.
- Treat every script in an approved origin as sharing that origin's authority. Page messages are not a security boundary between scripts on the same page. The extension does not return secrets through the interface.
- Page tasks allow only the requested WebMCP tools with `site` provenance. Workspace sharing is off by default. In BYOA’s popup, you can share read-only snapshots of Persona (IDENTITY.md and SOUL.md), About you (USER.md), or Memory (MEMORY.md) for that exact origin and chosen connection duration. Shared content can reach destinations used by the site’s tools. AGENTS.md, journals, file tools, and remote-MCP context remain excluded. The page API exposes no sharing state. Tool definitions are never accepted from page messages.
- Site tasks run independently of sidebar chats, with at most 3 running globally, 2 per profile, and 1 outstanding task per tab. Excess tasks wait in eligible FIFO order.
- Disconnect cancels that origin's queued and active tasks. Abort cancels model execution and prevents further tool work; it cannot undo a tool action already performed. Apps must provide their own review, revision checks, and undo behavior.
- Keep the page open. A task port can reconnect to the same tab, document and origin within ten seconds, replaying the last 50 progress events after its last sequence. Navigation cannot resume a run; worker restarts mark unfinished records `error` with `code: "interrupted"`. There is no automatic retry.
- Queue wait is limited to five minutes. Run time starts after queue admission: two minutes by default, configurable in Options from 1–10 minutes. `request({ timeoutMs })` can shorten, never extend that setting. Inactivity stops work after 60 seconds without a stream chunk, tool call or result. Heartbeats do not reset inactivity. Each limit reports `code: "timeout"` with a distinct detail.
- Task history retains ten recent terminal records per tab plus any live task in extension session storage. Responses and tool activity are bounded too. It clears with the browser session. Prompts/tool results are sent to the configured model endpoint.

## Package and discovery

The package is built locally; this change does not publish it to npm. Run `pnpm pack:sdk` at the repository root to build, pack, install and verify it; the command prints the tarball path. Install that file with `npm install /path/to/byoagent-browser-0.1.0.tgz`. After a separate publication, the registry installation is `npm install @byoagent/browser`.

`byoa` discovers lazily on the first operation and selects the first valid provider. Importing the ESM module is SSR-safe and does not access window. `agentboard` remains a deprecated alias of the same client. Existing client methods, including recovery and token usage, remain available.

```ts
import { byoa, createClient, discoverProviders } from '@byoagent/browser';
const providers = await byoa.providers(); // or discoverProviders({ timeoutMs: 200, signal })
const client = providers[0] ? createClient(providers[0].provider) : null;
// Show a provider picker when several exist. Call connect/request from a fresh gesture.
// On disposal, cancel active tasks, await terminal events and call client?.dispose().
```

Disposal is final and aborts pending discovery; create a new client afterward. Preflight failures receive unique provider-local task IDs without worker records (lookup returns null). Invalid or empty IDs from other providers reject rather than mixing request events.

Discovery times out with an empty list when none answer. It removes its listeners, retries within the collection window, deduplicates announcements and can be aborted. The default discovery window is 200 ms; a 1000 ms maximum preserves the 1500 ms trusted-gesture window. Discover ahead of a picker rather than waiting during a click.

See [the neutral provider specification](../../docs/provider-spec.md) for raw-provider integration without the SDK, method/error semantics, event ordering and security. The v1 postMessage transport and internal identifiers remain compatible; their eventual removal has no scheduled date. Any same-origin script can announce a provider: metadata is not proof of identity.

### Connection duration and activity

BYOA’s approval popup defaults to “Until I close the browser”; the person can choose “For 30 days” or “Until I disconnect”. Incognito approvals are session-only. Persistent grants remain on this device across browser restarts and extension updates. Expiry is checked when access is read, without background alarms. Deleting a profile revokes its site grants.

Options → Connected sites lists profiles, shared files, duration, expiry and last use. Disconnecting there stops running tasks. Its clearable local activity log retains at most 500 entries and 30 days: connection events and task IDs, status, profile names, tool names and duration. It contains no prompts, tool arguments or results. Grants and activity are excluded from settings export/import. The page-facing Connection API is unchanged and exposes no duration, expiry, sharing state or activity.

### Task lookup and explicit retry

`getTask(id)` returns a summary or `null`; `listTasks()` returns up to ten recent summaries.
These read-only calls need no click and are scoped to the calling tab, exact origin and browsing context.
Summaries contain only `taskId`, `status`, `detail`, `busy`, `seq`, optional `code` and token-only `usage`, and the SDK-derived `retryable`.
They never contain prompts, generated responses, tool arguments/results, sharing state or profile configuration.
Records last only for this browser session. A new document may look up a record, but cannot attach to the old run.

Events have monotonic per-task `seq` values and optional `code` (`budget`, `timeout`, `interrupted`,
`revoked`, `tools-changed`, `step-limit`). `budget` reports a person-controlled cap.
`task.retryable` and summary `retryable` are true only for `timeout` or `interrupted`.
There is no `task.retry()`: call `request()` again from a trusted click or submit shortcut, after reviewing existing proposals.

```ts
// Save after acknowledgment; store request inputs separately only if your app needs them.
sessionStorage.setItem('activeTaskId', task.id);
// On the next load:
const lastId = sessionStorage.getItem('activeTaskId');
const previous = lastId ? await byoa.getTask(lastId) : null;
// If previous.busy, poll until terminal (navigation cleanup can take ten seconds).
if (previous?.retryable) showRetryButton(previous.detail);
// The Retry button's click handler calls request() with freshly validated page context.
```

Reattachment replays bounded progress, not a provider stream. A restart loses the stream and cannot resume it.
Tools that wait on a person would currently trip inactivity; design review as a proposal returned promptly to the app.

Task events include optional cumulative `usage` (input/output/total tokens and `usageKnown`). Show incomplete usage when `usageKnown` is false. `error` with `code: 'budget'` means a person-controlled cap stopped execution; retain proposals for review. Daily caps reset at local midnight. Each running task may overshoot by one provider step. Prices and dollars are extension-private; apps cannot set budgets. Recovery summaries preserve usage and sequence numbers.
