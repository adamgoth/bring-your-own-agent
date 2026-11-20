# Build BYOA into a web app

BYOA lets a user connect their configured agent to your app and request work from your interface. Your app exposes capabilities through WebMCP tools; BYOA runs the agent and routes tool calls back to the page. Results appear through your app's own state and UI.

This guide describes the experimental implementation in this repository. **Top-level HTTPS pages, and plain-HTTP `localhost` or `127.0.0.1` on any port, can ask to connect.** Plain HTTP on other hosts and pages inside iframes cannot. Each exact origin needs the person's approval in BYOA's popup. Use the locally packaged `@byoagent/browser` SDK; it is not on npm yet. For a picture of how the pieces fit, see [How it works](../README.md#how-it-works).

## Who owns what

| Component | Responsibility |
| --- | --- |
| Your app | User interface, app state, tool registration, argument validation, authorization, proposed changes, review, and undo. |
| WebMCP | Registry of tool names, descriptions, schemas, and execution functions in the page. |
| BYOA | Agent configuration and credentials, connection approval, model requests, task progress, cancellation, and routing calls to the requested page tools. |

There are two parts to an integration: expose app capabilities through WebMCP, then use the BYOA client to request work with those capabilities. Exposing WebMCP tools alone does not add the BYOA connection flow. The connection and task APIs are specific to this prototype, not part of WebMCP.

For a coding-agent workflow, start with the [integration recipe](../packages/browser/prompts/add-byoa.md). React apps can use [the optional components and hooks](../packages/react/README.md); other apps can use the same connection dialog as a [custom element](../packages/browser/README.md#connection-dialog-without-react). Existing WebMCP tools remain app-owned.

## 1. Expose app capabilities

Choose a small set of useful operations over your app's data. Prefer explicit actions such as `get_selected_cards` and `propose_board_changes`, with stable IDs and structured arguments.

Register tools after your app state is ready. BYOA preserves the browser's native WebMCP implementation (`document.modelContext` or `navigator.modelContext`, depending on the browser) or installs its polyfill at document start. The client itself does not provide WebMCP. This JavaScript example registers a read-only tool; `getSelectedCards()` is an app function you supply:

```js
async function registerAppTools(getSelectedCards) {
  // Native browsers may expose navigator.modelContext; BYOA's polyfill provides document.modelContext.
  const context = document.modelContext ?? navigator.modelContext;
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

Build the packages from a clone of this repository with `pnpm sdk:vendor --out /absolute/path/to/app/vendor/byoa`, then install from the app root using `npm install ./vendor/byoa/byoagent-browser-0.1.0.tgz`. Commit the archive with the app lockfile. Once separately published, use `npm install @byoagent/browser`.

```ts
import { byoa } from '@byoagent/browser';
```

The demos install the packages as local dependencies, with independent lockfiles. `byoa` discovers providers lazily; `agentboard` is a deprecated compatibility alias. Use `discoverProviders()` or `byoa.providers()` and `createClient(chosen.provider)` to present a provider picker. Imports are SSR-safe; call browser methods only in the browser. The [provider specification](provider-spec.md) includes a without-SDK example and security model.

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
import type { AgentTask } from '@byoagent/browser';

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

Consume `task.events` once. `subscribeTasks()` is available for shared progress UI. You can also pass an `AbortSignal` to `request()`. Open chat or settings only from explicit user actions. Each request starts without prior conversational history; **Open in sidebar** opens a transcript, not a resumable conversation.

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

Follow the root README to [install the extension](../README.md#install-the-extension), configure an API profile, and [run the demos](../README.md#run-the-demos). Reload the extension and app tabs after extension rebuilds. Your own app can connect from any `localhost` or `127.0.0.1` port during development and from any top-level HTTPS origin once deployed; each exact origin needs its own approval.

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

## Limits your app should handle

The full list of limits, approval durations, budgets and data-flow rules is in [Limits, permissions and privacy](limits-and-privacy.md). The parts that shape app code:

- **Concurrency.** One outstanding task per tab (3 globally, 2 per profile). Extra tasks queue for up to five minutes; render `queued`.
- **Timeouts.** Run time is two minutes by default (the person can set 1–10 minutes); `timeoutMs` can only shorten it. A task also stops after 60 seconds without progress, so a tool that waits on a person will trip it. Return proposals promptly and let the app handle review.
- **Interruptions.** Navigation stops a run and a worker restart marks it `interrupted`. Nothing resumes or retries automatically. Store the active task ID in `sessionStorage`, call `getTask(id)` on reload (poll while it is still busy), or `listTasks()` for up to ten recent summaries. Show existing proposals and a **Retry** button for retryable terminal events; its click calls `request()` again with freshly validated context. Margin's recovery banner is an example.
- **Budgets.** People set token and dollar caps in the extension; apps cannot. A budget stop is `status: 'error'` with `code: 'budget'`. Keep existing proposals available for review.
- **Usage.** Task events and recovery summaries carry cumulative `usage: { inputTokens, outputTokens, totalTokens, usageKnown }`. Render `usageKnown: false` as incomplete usage, never as a free or zero-token run. Costs and prices are never exposed to the page.
- **Scope.** A task receives only the site tools you named. The page API exposes no connection duration, expiry, sharing state or activity, and every script on an approved origin shares that origin's authority.
- **Data.** Prompts, tool definitions and tool results go to the person's configured model endpoint. Return bounded, relevant data from tools, and use sample content while developing.

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
