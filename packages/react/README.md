# @byoagent/react

Optional React UI and hooks for `@byoagent/browser`. Supports React and React DOM 18.3/19; the browser SDK is also a peer dependency. Both packages are experimental and are **not published by this change**.

From a clone of this repository, run `pnpm sdk:vendor --out /absolute/path/to/app/vendor/byoa`. It installs and builds only the two packages and writes both archives into the app. Install both `./vendor/byoa/*.tgz` files together from that app’s root and commit them with its lockfile. Coding agents should follow [the integration recipe](../browser/prompts/add-byoa.md), which covers this step. After a separate registry release the equivalent is `npm install @byoagent/browser @byoagent/react`.

```tsx
import { useState } from 'react';
import { AgentProvider, AgentIndicator, AgentConnectionDialog, AgentPromptPopover } from '@byoagent/react';
import '@byoagent/react/styles.css'; // optional

function AgentControls({ toolsReady }: { toolsReady: boolean }) {
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  return <>
    <AgentIndicator aria-haspopup="dialog" aria-expanded={connectionOpen}
      onClick={() => setConnectionOpen(true)} />
    <AgentConnectionDialog open={connectionOpen} onOpenChange={setConnectionOpen} />
    <button onClick={() => setRequestOpen(true)}>Ask agent</button>
    <AgentPromptPopover open={requestOpen} onOpenChange={setRequestOpen}
      tools={['get_selection', 'propose_replacement']} ready={toolsReady} />
  </>;
}
// Mount at the app shell. Tool names above are examples: supply your registered tools.
export function App() {
  return <AgentProvider><AgentControls toolsReady={false} /></AgentProvider>;
}
```

`AgentPromptPopover` is a compact modal request surface backed by native `<dialog>` (modern browsers); it does not implement chat history. Closing it leaves work running; cancellation is explicit. The connection dialog launches the extension-owned approval window. Neither component asks for API keys or enumerates profiles. No telemetry is collected by this package.

## Hooks and ownership

- `useConnection()` returns `connection`, `detecting`, `connecting`, `error`, `connect`, `disconnect`, `refresh`, `clearError`.
- `useAgentTask()` returns `task`, `pending`, `busy`, `error`, `clearError`, `run`, `cancel`. Task errors are separate from connection errors. `run({ prompt, tools, signal?, timeoutMs? })` consumes events once and resolves with the terminal event. It rejects overlapping submissions within that session. `pending` covers the full request lifetime, not just acknowledgment. Direct client requests and other sessions do not populate this session’s task state. Cancellation applies to the session's owned request. Inspect terminal status; completion doesn't guarantee an app result.
- `useAgentSession()` exposes the shared session/client. `useAgentSnapshot()` exposes all state.
- `AgentTaskStatus` displays progress, cancel and transcript controls. Optional `onRetry` is app-owned: validate current tools/context and review existing proposals before starting another request. There is no automatic retry.

The default Provider borrows a shared session. For imperative app workflows or a chosen discovered provider, create a session once outside rendering:

```ts
import { byoa, createAgentSession } from '@byoagent/browser';
export const session = createAgentSession(byoa);
// <AgentProvider session={session}>...</AgentProvider>
// An app event handler can use session.run(...) and all controls share its state.
```

View unmount only unsubscribes, including StrictMode cleanup; it never disposes the borrowed session/client or cancels work. When an app-owned session's lifetime ends, `await session.dispose()` cancels its work and waits for bounded local completion. After one second without provider confirmation, the client emits an `interrupted` event marked `local: true`; remote work may still be running. Then dispose an owned client if needed. Create custom sessions at module scope and never dispose them in React effect cleanup (StrictMode replays it). Dispose only when the actual app owner ends the lifetime. Do not dispose the shared `byoa` singleton on a view unmount. Session state is memory-only; recovery prompts/results remain app-owned. Requests and connect/chat/settings must originate in explicit user gestures. Async preparatory work can lose that gesture: prepare context ahead of submission.

Imports and server rendering are safe; UI modules include `use client`. No client is created per render. Keep browser methods out of server render. Connection detection starts on subscription and can be retried through `refresh`/Check again.

## Styling and accessibility

Default CSS is optional. It is the same stylesheet as `@byoagent/browser/styles.css`, which also styles the framework-neutral `<byoa-connection-dialog>` element, so React and non-React apps share one design. No Tailwind dependency or shadow DOM. Components accept `className`; AgentIndicator also accepts normal button props. State is exposed through `data-state` and `data-busy` (the connection dialog's status card reports `detecting`, `unavailable`, `disconnected`, `waiting` or `connected`). Use hooks for completely custom markup.

The connection dialog shows one status card (profile name and a live dot, with an inline **Change** for switching profiles), an action list (**Open sidebar**, **Agent settings**), and a footer with the privacy note, a quiet **Disconnect** and a small "Managed by BYOA" mark. On screens up to 480px wide it becomes a bottom sheet.

```css
.app-theme {
  --byoa-font-family: var(--font-sans);
  --byoa-color-accent: var(--primary);
  --byoa-color-on-accent: var(--primary-foreground);
  --byoa-color-surface: var(--popover);
  --byoa-color-text: var(--foreground);
  --byoa-color-border: var(--border);
  --byoa-color-muted: var(--muted-foreground); /* optional; derived from text */
  --byoa-color-sunk: var(--muted); /* optional; status card background */
  --byoa-color-error: var(--destructive);
  --byoa-radius: var(--radius);
}
```

Dialogs default to a portal under `document.body`. Pass `portalContainer={themeElement}` to inherit a scoped theme. Dialogs handle native close events, keyboard focus containment and Escape dismissal; focus returns on close. The request surface initially focuses its textarea. Supply `returnFocusRef` when the opener may disappear; Margin uses its persistent header indicator as the fallback. Progress uses a polite live region. Connection text does not depend on color, and default CSS respects reduced motion. `labels` accepts overrides for built-in strings (see `AgentLabels`); provider-supplied detail text is passed through. Optional `setupUrl` customizes the connection setup link.

Use `getRequest(prompt)` on AgentPromptPopover to synchronously revalidate and construct a request using current app context. `ready={false}` disables submission until tools are registered. Apps own route changes, tool lifecycle, result rendering, authorization and review. No generated response is returned through the task API.

The browser package ships [the integration recipe](../browser/prompts/add-byoa.md) and a separate [tool creation recipe](../browser/prompts/add-webmcp-tools.md).

### Host resets and local development

Dialog and task-status controls are scoped to their own surfaces and reset their buttons, so global element rules such as `button { border: 0; background: none }` or a Tailwind preflight do not strip them, and the SDK never reuses generic class names such as `.primary`. Theme them with the variables above; for structural changes, pass `className` and use a selector more specific than two classes (for example `.my-theme.byoa-dialog .byoa-row`). Only the header indicator stays in the low-priority `@layer byoa`, so an app's own header styles win there.

The packages are ESM-only; there is no CommonJS build. Configure an ESM-capable test runner instead of mapping imports to source files. Build this repository using root `pnpm run setup`: the React package's development dependencies use pnpm links. For local linked React packages, configure your bundler to deduplicate `react`, `react-dom`, and `@byoagent/browser` (see Margin's Vite config). Ordinary npm consumers should install tarballs or eventual registry releases; those installs use peer dependencies and do not install the package's development links.
