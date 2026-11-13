# Build BYOA into a web app

BYOA lets a user connect their configured agent to your app and request work from your interface. Your app exposes capabilities through WebMCP tools; BYOA runs the agent and routes tool calls back to the page. Results appear through your app's own state and UI.

This guide describes the experimental implementation in this repository. **Top-level HTTPS pages, and plain-HTTP `localhost` or `127.0.0.1` on any port, can ask to connect.** Plain HTTP on other hosts and pages inside iframes cannot. Each exact origin needs the person's approval in BYOA's popup. Use the locally packaged `@byoagent/browser` SDK; registry publication is a separate step.

## Who owns what

| Component | Responsibility |
| --- | --- |
| Your app | User interface, app state, tool registration, argument validation, authorization, proposed changes, review, and undo. |
| WebMCP | Registry of tool names, descriptions, schemas, and execution functions in the page. |
| BYOA | Agent configuration and credentials, connection approval, model requests, task progress, cancellation, and routing calls to the requested page tools. |

There are two parts to an integration: expose app capabilities through WebMCP, then use the BYOA client to request work with those capabilities. Exposing WebMCP tools alone does not add the BYOA connection flow. The connection and task APIs are specific to this prototype, not part of WebMCP.

## 1. Expose app capabilities

Choose a small set of useful operations over your app's data. Prefer explicit actions such as `get_selected_cards` and `propose_board_changes`, with stable IDs and structured arguments.

Register tools after your app state is ready. BYOA preserves the browser's native `document.modelContext` when available or installs its polyfill at document start. The client itself does not provide WebMCP. This JavaScript example registers a read-only tool; `getSelectedCards()` is an app function you supply:

```js
async function registerAppTools(getSelectedCards) {
  const context = document.modelContext;
  if (!context?.registerTool) {
    throw new Error('Page tools unavailable. Enable BYOA and reload the page.');
  }

  const controller = new AbortController();
  window.addEventListener('pagehide', () => controller.abort(), { once: true });

  await context.registerTool({
    name: 'get_selected_cards',
    description: 'Read the cards currently selected by the user.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async () => ({
      content: [{ type: 'text', text: JSON.stringify(getSelectedCards()) }],
    }),
  }, { signal: controller.signal });

  return () => controller.abort();
}
```

Await registration before enabling requests. Register once per tool lifecycle, and clean up when the owning view is disposed; Margin also demonstrates an `unregisterTool` fallback. Keep manual app features usable when tools or the extension are unavailable.

For tools that accept arguments, describe them with an `inputSchema` and validate them again in the execution function. Enforce your app's permissions and business rules there. Schemas, tool descriptions, and annotations do not replace runtime checks. Return bounded, relevant data: tool definitions and results are sent to the user's configured model provider.

## 2. Connect the user's agent

Build and pack the SDK from this repository with `pnpm pack:sdk`, then install the printed tarball using `npm install /path/to/byoagent-browser-0.1.0.tgz`. Once separately published, use `npm install @byoagent/browser`.

```ts
import { byoa } from '@byoagent/browser';
```

The demos resolve the package's built ESM/declarations through aliases, with independent lockfiles. `byoa` discovers providers lazily; `agentboard` is a deprecated compatibility alias. Use `discoverProviders()` or `byoa.providers()` and `createClient(chosen.provider)` to present a provider picker. Imports are SSR-safe; call browser methods only in the browser. The [provider specification](provider-spec.md) includes a without-SDK example and security model.

Use `getStatus()` on startup and `subscribe()` to keep connection UI current. The following snippets use app-provided rendering functions and button references:

```ts
const unsubscribe = byoa.subscribe(renderConnection);
void byoa.getStatus().then(renderConnection);

connectButton.addEventListener('click', async () => {
  try {
    await byoa.connect();
  } catch (error) {
    showError(error);
  }
});

disconnectButton.addEventListener('click', async () => {
  try {
    await byoa.disconnect();
  } catch (error) {
    showError(error);
  }
});

// Call unsubscribe() when the owning view is disposed.
```

Call `connect()` from a user click. BYOA opens its own window showing the requesting origin and available profiles, and waits for approval. Your app does not build a profile picker or receive credentials. The returned connection includes readiness and the approved profile's ID and display name.

Offer **Change profile** by calling `connect()` again. Cancelling preserves the current connection; approving a different profile cancels this origin's existing tasks. Disconnecting cancels this origin's queued and active tasks. Connections are per exact origin and chosen connection duration, so `localhost` and `127.0.0.1` require separate approvals.

## 3. Request work and show progress

Send a prompt and the names of already registered WebMCP tools. BYOA resolves their definitions and execution routes. Do not pass executable tool definitions to `request()` or add app-specific handlers to the extension.

```ts
import type { AgentTask } from '../../../byoa-extension/sdk';

let activeTask: AgentTask | undefined;
let lastTask: AgentTask | undefined;
let sending = false;

sendButton.addEventListener('click', async () => {
  if (sending) return;
  const prompt = instructionInput.value.trim();
  if (!prompt) return;

  sending = true;
  try {
    const connection = await byoa.getStatus();
    if (!connection.connected) throw new Error('Connect an agent first.');

    activeTask = await byoa.request({
      prompt: `Read the selected cards and summarize them.\n\nUser request: ${prompt}`,
      tools: ['get_selected_cards'],
    });
    lastTask = activeTask;

    for await (const event of activeTask.events) {
      renderProgress(event);
    }
  } catch (error) {
    showError(error);
  } finally {
    activeTask = undefined;
    sending = false;
  }
});

cancelButton.addEventListener('click', () => activeTask?.cancel());
viewChatButton.addEventListener('click', async () => {
  try {
    await lastTask?.openChat();
  } catch (error) {
    showError(error);
  }
});
```

This read-only example produces a summary in the task transcript. For results to appear in your app, expose tools that create app-owned output, such as a suggestion or pending proposal, and include their names in the request. `request()` does not return a generated answer or structured proposal; it returns a task handle.

Task events contain `taskId`, `status`, `detail`, `busy`, monotonic `seq`, and optional `code`. `timeout` and `interrupted` are retryable; the SDK exposes `task.retryable`. Render `queued`, `working`, `done`, `cancelled`, and `error` states. A terminal event has `busy: false`; inspect its status because the iterator also ends after cancellation or failure. A `done` event does not guarantee that the agent created a proposal.

Consume `task.events` once. `subscribeTasks()` is available for shared progress UI. You can also pass an `AbortSignal` to `request()`. Open chat or settings only from explicit user actions. Each request starts without prior conversational history; **View chat** opens a transcript, not a resumable conversation.

## 4. Make changes reviewable

For an editing workflow, pair read tools with a proposal tool. Boardwalk's flow is:

1. `get_board_snapshot` returns cards, columns, and the current revision.
2. `get_selected_cards` returns the user's selection.
3. `propose_board_changes` validates a batch against that revision and stores a pending proposal.
4. Your app renders the proposal and lets the user accept or dismiss it.
5. Acceptance checks that the proposal is still current, applies the changes, and records enough state for undo.

Enforce review in the tool implementation: asking the model to wait for approval is not enough. Reject stale proposals after manual edits so they cannot overwrite newer work. Decide how to handle proposals already created when a task later fails or is cancelled. Cancellation prevents further work but cannot undo actions a tool has already performed.

Use [Boardwalk's tools](../demos/boardwalk/src/tools.ts) and [board state](../demos/boardwalk/src/board.ts) for batch validation and review. Use [Margin's tools](../demos/margin/src/tools.ts) for selection-based writing operations. The app guides explain the end-user workflows: [Boardwalk](../demos/boardwalk/README.md) and [Margin](../demos/margin/README.md).

## 5. Test locally

Follow the [root setup instructions](../README.md#get-running) to install dependencies, build the extension, load it unpacked, configure an API profile, and start the demos. Reload the extension and app tabs after extension rebuilds. For an integration experiment today, adapt a demo on its supported origin; changing the dev-server port or deploying the app does not grant connection access.

Check the integration with sample data:

- With BYOA unavailable, manual features still work and connection failures are visible.
- Connecting opens BYOA's approval window; cancelling preserves an existing connection.
- Requests use only the intended page tools, and progress includes queueing and terminal errors.
- Proposed changes require review, manual edits invalidate stale proposals, and undo restores accepted changes.
- Cancellation and disconnect stop further work; existing proposals remain understandable.
- Navigation or interruption leaves the app in a state the user can inspect before retrying.

From the repository root, run `pnpm check` for the existing project checks. With the built extension and both demo servers running, run the shared browser integration test:

```sh
CHROME_FOR_TESTING_BIN='/path/to/Chrome for Testing' pnpm test:browser
```

The test uses a temporary browser profile and a loopback mock provider. See the [browser test guide](../byoa-extension/tests/browser/README.md) for details. If you change a demo's tools or workflow, update the corresponding integration coverage.

## Current operating limits

Site tasks run independently of sidebar chats, with at most 3 running globally, 2 per profile, and 1 outstanding task per tab. Excess tasks wait in eligible FIFO order. Queue wait is limited to five minutes and does not consume run time. Run time is two minutes by default (Options: 1–10 minutes); an app’s optional `timeoutMs` can shorten it. Inactivity is 60 seconds without a stream chunk, tool call or result; a tool waiting on a person would hit this limit. Same-document port drops get ten seconds to reattach with bounded replay. Navigation stops the run; a worker restart marks unfinished tasks `interrupted`. Neither resumes a provider stream or retries automatically. Store the active task ID in `sessionStorage` and call `getTask(id)` on reload (poll if still busy), or `listTasks()` for up to ten recent summaries on this tab and exact origin. No gesture is needed for these summary-only lookups; prompts, responses and tool activity stay extension-private. Show existing proposals and a Retry button for retryable terminal events; its trusted click calls `request()` again with validated current context. See Margin’s recovery banner for an example.

App tasks receive only the requested site-provenance WebMCP tools; Workspace sharing is off by default. In BYOA’s popup, you can share read-only snapshots of Persona (IDENTITY.md and SOUL.md), About you (USER.md), or Memory (MEMORY.md) for that exact origin and chosen connection duration. Shared content can reach destinations used by the site’s tools. AGENTS.md, journals, file tools, and remote-MCP context remain excluded. The page API exposes no sharing state. Every script on an approved origin shares that origin's authority. The page transport does not isolate scripts from one another.

Credentials stay in the extension, but prompts, tool definitions, and tool results go to the configured model endpoint. API billing applies; this does not use a consumer ChatGPT or Claude subscription. Use sample content for development.

See the [SDK contract](../byoa-extension/sdk/README.md) for the full prototype boundaries and client behavior. Spending budgets, SDK distribution and provider discovery still need implementation before this becomes a general hosted-app integration.


### Connection duration and activity

BYOA’s approval popup defaults to “Until I close the browser”; the person can choose “For 30 days” or “Until I disconnect”. Incognito approvals are session-only. Persistent grants remain on this device across browser restarts and extension updates. Expiry is checked when access is read, without background alarms. Deleting a profile revokes its site grants.

Options → Connected sites lists profiles, shared files, duration, expiry and last use. Disconnecting there stops running tasks. Its clearable local activity log retains at most 500 entries and 30 days: connection events and task IDs, status, profile names, tool names and duration. It contains no prompts, tool arguments or results. Grants and activity are excluded from settings export/import. The page-facing Connection API is unchanged and exposes no duration, expiry, sharing state or activity.

### Spending budgets and usage

People control app budgets in BYOA Options, its connection popup and Connected sites. Apps cannot set budgets, prices, grants or sharing flags. The default per-task cap is 200,000 total tokens; a person can override it per site and set site or all-sites daily token/dollar caps. Days follow the browser's local calendar. Sidebar chats are excluded.

Task events and recovery summaries carry cumulative `usage: { inputTokens, outputTokens, totalTokens, usageKnown }`. Render `usageKnown: false` as incomplete usage, never as a free or zero-token run. Missing provider usage falls back to the profile step limit; known counts still accrue. A budget stop has `status: 'error'` and `code: 'budget'`. Keep existing proposals available for review. A task already over its cap starts no provider call. Usage arrives after a step, so each concurrently running task can overshoot a cap by at most one step. Retrying is a fresh task, subject to the same daily ledger.

Costs and profile prices remain extension-private. Dollar caps require configured prices or an explicitly reported provider cost; missing costs cannot enforce a dollar cap and are labelled incomplete in Connected sites. No price table is bundled. Keyless local profiles count tokens with zero cost. Provider metadata support varies; the bundled OpenAI-compatible adapter does not preserve arbitrary OpenRouter billing fields, so enter profile prices when needed.

Regular daily ledgers are kept locally for 35 calendar days; each day holds up to 1,000 site buckets plus an overflow bucket for already-running steps. New sites are refused at capacity until the next day. Private browsing has a separate session-only ledger and daily aggregate; it never contributes to regular persistent accounting. Provider usage is written before waiting for outstanding page tools and before the next step is authorized. Cancellation before a usage report, and working tasks interrupted by a worker restart, are marked incomplete. A worker killed before usage is received cannot recover unreported provider usage; interrupted tasks are never retried automatically.


## Optional floating site voice

After registering page tools, explicitly opt in:

```ts
await byoa.configureVoice({
  enabled: true,
  tools: ['get_selection', 'propose_replacement'],
  instructions: 'Propose changes for the person to review.',
});
// On disposal:
await byoa.configureVoice({ enabled: false });
```

This declares a capability, not a grant. The person must still connect the exact origin. Names must refer to 1–32 registered page tools; optional page guidance is bounded to 2,000 characters. A connection without opt-in shows no microphone. The raw provider method is `agent_configureVoice`.

The extension frame keeps transcripts/results outside the page DOM. Native speech uses `processLocally=true` in an extension offscreen document. Microphone permission and pack downloads happen in visible Voice setup. Finish shows an editable transcript; Send during recording waits for final words. No audio is stored or sent to a transcription service. Approved text goes to the configured agent under existing site tools, grants, sharing and budgets.

Results quote the actual task response without another model call. Open conversation focuses that task in App agent chat, whose continuation input remains separate from general sidebar chat. Follow-ups use up to four successful prior turns from this site (6,000 characters per message). Navigation, grant/profile changes, tool replacement and worker restarts end the conversation boundary. Historical tasks remain reviewable; interrupted work never replays automatically. Unsent transcripts are ephemeral.
