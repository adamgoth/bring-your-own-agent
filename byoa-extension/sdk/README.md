# Experimental BYOA app client

This browser-only TypeScript client requests agent work. It does not register tools or extend `document.modelContext`. Apps register their tools through WebMCP, then pass the names of the approved page tools to a task. BYOA resolves the actual WebMCP definitions and execution routes; credentials stay in the extension.

Start with the [web app integration guide](../../docs/web-app-integration.md) for tool registration, connection UI, task handling, reviewable changes, and local testing. This README describes the client contract and prototype limits.

```ts
import { agentboard } from '../../../byoa-extension/sdk';

// Call from a user button. BYOA owns the profile picker and site approval UI.
// Resolves after approval; rejects on Cancel, window close, navigation, or expiry.
const connection = await agentboard.connect();

// Call request from a user button. Names refer to existing WebMCP tools.
const controller = new AbortController();
const task = await agentboard.request({
  prompt: 'Break the selected card into smaller tasks',
  tools: ['get_board_snapshot', 'get_selected_cards', 'propose_board_changes'],
  signal: controller.signal, // optional AbortController
});
for await (const event of task.events) showProgress(event);
// task.cancel(); task.openChat() from an explicit View chat click
```

`getStatus()`, `subscribe(listener)`, and `disconnect()` manage connection UI. `connect()` opens BYOA’s own extension window, shows the requesting origin and every profile (even a single profile), and waits for the user’s approval. The app does not enumerate profiles or pass a profile ID. The returned connection exposes only readiness and the approved profile’s ID/display name, never other profiles, credentials, or endpoint details. **Change profile** simply calls `connect()` again; cancellation preserves the existing connection. Switching profiles cancels this origin’s existing tasks without changing the extension-wide default. `subscribeTasks(listener)` supplies compact task events. `openSettings()` and `openChat(taskId?)` require a user click. `task.events` is a single-consumer async iterable of queued, working, done, cancelled, or error events. A terminal event has `busy: false`; a completed task need not have created a proposal. Every request is independent, without prior conversational history. Chat viewing is a transcript viewer, not a resumable conversation.

## Prototype boundaries

- Any top-level HTTPS page can ask to connect, as can plain-HTTP `localhost` or `127.0.0.1` on any port for local development. Plain HTTP on other hosts, subframes, and other schemes are refused. Being eligible grants nothing: each exact origin (scheme, host, and port) needs its own approval, and tasks check that approval before any model request. The origin rule contains no tool names or app-specific handlers.
- The page bridge stays dormant until the page sends its first client message (normally `getStatus()`), so ordinary sites see no polling or messages. Once a page calls the client, it can tell that BYOA is installed and whether any profile is ready; it learns nothing else until approved. Call `getStatus()` once at startup rather than waiting for an unsolicited status event.
- Configure API profiles in BYOA Options and explicitly choose one when connecting. API provider billing applies. This does not authenticate through a ChatGPT or Claude subscription.
- A trusted app click opens the BYOA-owned approval window. The popup is extension-private and validates the original tab, document, origin, request token, expiry, and selected profile before granting access. Closing or cancelling rejects the request. Pending approvals expire after three minutes; short status polls let the flow survive service-worker restarts. Permissions remain per origin and browser session. Spending budgets, persistent per-site permissions, and a complete capability-session system remain future work.
- Treat every script in an approved origin as sharing that origin's authority. Page messages are not a security boundary between scripts on the same page. The extension does not return secrets through the interface.
- Page tasks allow only the requested WebMCP tools with `site` provenance. Local Workspace and remote-MCP tools/context are excluded. Tool definitions are never accepted from page messages.
- Page tasks queue across apps, with at most one outstanding task per tab. The existing model client still has one active stream; a normal sidebar chat can interrupt a page task. Independent execution clients remain future work.
- Disconnect cancels that origin's queued and active tasks. Abort cancels model execution and prevents further tool work; it cannot undo a tool action already performed. Apps must provide their own review, revision checks, and undo behavior.
- Keep the page open. Navigation/closing the page disconnects the task. Worker interruption fails closed; there is no automatic retry, task reattachment, or recovery across documents. Review existing changes before sending a fresh request. Tasks time out after two minutes, including queue time.
- Task history is bounded to ten tasks per tab in extension session storage. Responses and tool activity are bounded too. It clears with the browser session. Prompts/tool results are sent to the configured model endpoint.

The v1 `window.postMessage` transport is an implementation detail of this prototype. It is not a standardized agent-provider API. Both local apps import this source from sibling directories. Other apps can copy `sdk/index.ts` for now; npm packaging and provider discovery are future work.

The `agentboard` export and `agentboard:*` transport identifiers remain compatible with the inherited client. These names do not identify this fork as the upstream AgentBoard product.
