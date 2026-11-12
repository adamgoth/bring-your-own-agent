# Agent Provider protocol, version 1

This experimental, neutral page interface is independent of WebMCP and npm. BYOA implements it in the MAIN world. Origin eligibility, trusted gestures, document ownership, grants, task limits and cancellation remain enforced in its isolated bridge and service worker. No secrets or authority live in the provider object.

## Discovery

Listen for `agent:announceProvider` on `window`, then dispatch `new Event('agent:requestProvider')` there. Every provider responds **only to requests**, using `CustomEvent` with a frozen `detail: { info, provider }`. It must not announce on installation, startup or a timer. Sites making neither discovery requests nor legacy v1 calls receive no provider announcements or transport messages. Discovery by itself sends no transport messages. Providers retain a stable object and UUID for the document's lifetime and answer repeated requests, allowing late listeners and concurrent discovery.

`info` contains `uuid` (document-lifetime random instance ID), `name` (display name), `icon` (data image URI), and `rdns` (implementer identifier). BYOA currently uses `BYOA`, its existing icon, and `dev.byoa.extension`. This identifier is a stable protocol label, not proof of domain ownership. It is independent of the npm scope. Render names as text, and icons as images, never executable markup.

Discovery listeners must be installed before requesting and removed at the end of a bounded collection window. Retry requests within that window to cover startup races, deduplicate by UUID and object, and support zero, one or multiple providers. The SDK defaults to 200 ms, permits 0–1000 ms, and supports an AbortSignal. Its lazy default chooses the first valid announcement; use `createClient(chosen.provider)` for explicit selection. Discover before rendering a picker; invoke a selected provider from a fresh click. Do not await an unbounded discovery step inside a gesture handler.

## Provider object

```ts
interface AgentProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on(event: 'connectionChanged' | 'task', listener: (payload: unknown) => void): void;
  removeListener(event: 'connectionChanged' | 'task', listener: (payload: unknown) => void): void;
}
```

Listeners are sets, run independently, and may be removed by identity. Task events may precede request resolution: register before requesting, buffer until the returned task ID is known, then filter by that ID. Events carry monotonic per-task optional `seq`; deduplicate replayed sequence numbers. Terminal events have `busy: false`. Unsubscribe when the owning UI is disposed. The SDK offers `dispose()` for provider listeners; cancel active tasks and await their terminal events before disposal. Disposal is final, aborts pending client discovery and removes provider listeners; create a new client to reconnect.

| Method | Params | Result | Trusted gesture |
| --- | --- | --- | --- |
| `agent_status` | none | Connection | no |
| `agent_connect` | none | Connection after approval | yes |
| `agent_disconnect` | none | Connection | yes |
| `agent_requestTask` | `{ prompt, tools: string[], timeoutMs? }` | `{ taskId }` | yes |
| `agent_cancelTask` | `{ taskId }` | void | no |
| `agent_openChat` | `{ taskId? }` | void | yes |
| `agent_openSettings` | none | void | yes |
| `agent_getTask` | `{ taskId }` | TaskSummary or null | no |
| `agent_listTasks` | none | TaskSummary[] | no |

`tools` contains registered WebMCP **names**, never tool definitions. `timeoutMs` may only shorten the extension's run limit. No method accepts grants, profile selection, sharing, budgets, prices or configuration. Unknown methods reject with numeric `code: 4200`. Errors are Error objects with numeric codes: 4001 (approval cancelled/expired), 4100 (gesture/authorization refused), 4200 (unsupported method), 4900 (transport unavailable). Task execution failures use terminal TaskEvents, preserving the existing task contract, including a failure before a worker task is allocated. Every request result and its events must have a unique nonempty taskId; BYOA assigns provider-local `preflight:` IDs to these failures. They have no worker record, so lookup returns null. An SDK encountering an empty or invalid ID rejects with -32603 (invalid provider response) rather than misattributing another request’s events.

Connection contains `available`, `configured`, `connected`, optional approved `agentId`, `agentName`, and `error`. It does not expose other profiles or their settings. `connectionChanged` carries Connection. `task` carries the additive TaskEvent contract: taskId, status (queued/working/done/cancelled/error), detail, busy, optional seq, code and cumulative token-only usage (`inputTokens`, `outputTokens`, `totalTokens`, `usageKnown`). TaskSummary adds retryable. Codes remain budget/timeout/interrupted/revoked/tools-changed/step-limit. Lookup is summary-only and scoped to the calling tab, origin and browsing context; it cannot resume a stream, expose transcripts or gain control of an old document's task.

BYOA connects through an extension-owned approval popup. Internal polling runs every 500 ms, stops on cancellation/error, and expires after roughly three minutes (185-second client deadline plus at most one five-second transport call). A newer connect or disconnect stops the previous polling loop. Cancelling or closing the popup preserves an existing approved connection. Disconnect cancels this origin's work. Neither abort nor disconnect undoes completed page actions. Retrying a task requires a new trusted gesture and review of any existing proposals.

## Without the SDK

Register your WebMCP tools first. This example discovers a provider and installs a task button. Application rendering helpers are omitted.

```js
const found = new Map();
const announce = ({ detail }) => {
  // Validate the info and provider shape in a production integration.
  if (typeof detail?.provider?.request === 'function') found.set(detail.info.uuid, detail);
};
window.addEventListener('agent:announceProvider', announce);
window.dispatchEvent(new Event('agent:requestProvider'));
await new Promise(resolve => setTimeout(resolve, 200));
window.removeEventListener('agent:announceProvider', announce);
const chosen = [...found.values()][0]; // Show a picker if several are present.
if (!chosen) throw new Error('No agent provider found');
const provider = chosen.provider;
connectButton.onclick = () => provider.request({ method: 'agent_connect' });
const onTask = event => renderTaskProgress(event); // Filter by your returned taskId.
provider.on('task', onTask); // Listen before submitting, including early events.
runButton.onclick = async () => {
  const { taskId } = await provider.request({
    method: 'agent_requestTask',
    params: { prompt: 'Read the selected cards', tools: ['get_selected_cards'] },
  });
  rememberTaskId(taskId);
};
// On disposal: provider.removeListener('task', onTask).
```

## Security and compatibility

Any same-origin script can announce a provider or forge page events/messages. Discovery identity and rdns are not authentication. Treat provider objects, metadata, errors and generated results as untrusted. An announcement does not grant extension access. The person approves the exact origin in extension UI; scripts in that origin share its authority. Validate tool arguments, keep changes reviewable and support undo. Do not pass confidential data to a provider merely because it announced itself.

Eligible pages are top-level HTTPS and loopback HTTP (`localhost`, `127.0.0.1`); iframe support is out of scope. A click or Command/Ctrl+Enter is tracked in the isolated bridge and remains valid for 1500 ms. Forged MAIN-world events cannot create a trusted gesture. Discovery does not consume a gesture or grant access. The provider sends only the existing v1 `agentboard:page` envelopes; the bridge continues answering existing pasted clients unchanged. `agentboard:*`, task ports and storage keys remain internal and unchanged. The SDK's deprecated agentboard alias remains available. Event/method prefixes are neutral; this experimental spec is not a standards submission.

Credentials, endpoint configuration, context/sharing state, transcript content, costs and prices remain extension-private. Optional workspace context is shared only by extension-owned approval and is never exposed through this interface. Existing independent execution lanes, queue/run/inactivity limits, recovery, budgets and token accounting apply unchanged. Prices and costs are never in task usage.
