# Add Bring Your Own Agent (BYOA) to a web app

You are a coding agent adding BYOA to the app in your current workspace. This is the single starting point: you may have been given only this file or the BYOA repository URL (https://github.com/adamgoth/bring-your-own-agent). Follow the steps in order. This recipe targets `@byoagent/browser` and `@byoagent/react` 0.1.x.

## What you are building

BYOA lets a person use their own AI agent inside your app. Three parts work together:

- **The BYOA browser extension** (the person installs it) holds their API keys, shows its own profile picker and site-approval window, runs the agent, and keeps the transcript in its sidebar.
- **WebMCP tools in your app** are the only way the agent touches the app: small, named functions such as `get_selection` or `propose_board_changes`, registered with the page's `modelContext`.
- **The BYOA SDK in your app** adds a **Connect Agent** button and dialog, and sends requests that name the tools the agent may use. A request returns a task with progress events, never generated text: results arrive through your own tools and review UI.

## Ground rules

- Never handle API keys, provider credentials or profile lists. The extension owns credentials, profile choice, site approval, budgets and sharing consent; don't recreate those controls.
- Connect, submit, cancel and retry only from an explicit user action. Never connect, submit or retry automatically, and never broaden the tool list beyond the workflow.
- Your app keeps its own authorization, validation and review. Changes the person should approve are proposals they accept in your UI. Cancellation cannot undo a tool action that already ran.
- Preserve existing behavior and work in progress. Keep every manual feature working when the extension is missing.
- Do not invent APIs. Use the installed packages' READMEs and TypeScript declarations as the contract. Do not publish packages, deploy, or use real credentials.

## Step 1: Survey the app

Read the repository's instructions, then report briefly:

- Framework (React or not), package manager, build tool, ESM support in the app and its test runner, design system and theme tokens.
- Existing WebMCP tools: search for `registerTool` and `modelContext`. For each tool give its name, what it reads or changes, where registration completes, how it is cleaned up, and how its results reach the UI.
- Authorization boundaries for the data the workflow would touch.

## Step 2: Pick one workflow and its tools

Choose one useful workflow, for example "improve the selected paragraph" or "tidy the selected cards".

- **If suitable tools exist**, list the exact names the workflow needs. If an existing tool changes data without the app's normal authorization or review, report that gap before using it.
- **If they don't exist**, propose a small inventory: one or two bounded read tools plus at most one write tool, preferably one that creates a reviewable proposal rather than changing data directly. For each tool, say what data it sends to the person's model provider. **Stop and ask the person to approve the inventory.** After approval, build it by following [add-webmcp-tools.md](add-webmcp-tools.md), then continue here.

## Step 3: Install the SDK

The packages are not on npm yet; build them from the BYOA repository. Requirements: git, Node 22.13 or newer, and pnpm 10 (`corepack enable` provides it if missing; ask the person before changing global tooling).

Clone BYOA **outside** the app, for example in a temporary or sibling folder, then pack the SDK straight into the app:

```sh
git clone --depth 1 https://github.com/adamgoth/bring-your-own-agent.git /tmp/byoa
cd /tmp/byoa
pnpm sdk:vendor --out /absolute/path/to/your-app/vendor/byoa
```

`sdk:vendor` installs and builds only the two packages (not the extension or demos) and writes `byoagent-browser-0.1.0.tgz` and `byoagent-react-0.1.0.tgz`. From the app root, install with relative paths using the app's own package manager:

```sh
npm install ./vendor/byoa/byoagent-browser-0.1.0.tgz                                         # any framework
npm install ./vendor/byoa/byoagent-browser-0.1.0.tgz ./vendor/byoa/byoagent-react-0.1.0.tgz  # React apps
```

Commit `vendor/byoa/` with the lockfile; never record a temporary or absolute tarball path. The packages are ESM-only: if the app's test runner (for example Jest) needs configuration for ESM dependencies, configure it rather than aliasing to source. If tarballs are already provided, install those instead. After a registry release, install matching published versions.

## Step 4: Add the connection UI

Put a **Connect Agent** button in the header or toolbar, labelled exactly that while disconnected. When connected it shows the approved profile name.

**React** (React and React DOM 18.3 or 19): mount one `AgentProvider` at the app shell and use the ready-made components.

```tsx
import { useState } from 'react';
import { AgentProvider, AgentIndicator, AgentConnectionDialog } from '@byoagent/react';
import '@byoagent/react/styles.css'; // optional default styles

function AgentControls() {
  const [open, setOpen] = useState(false);
  return <>
    <AgentIndicator aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} />
    <AgentConnectionDialog open={open} onOpenChange={setOpen} />
  </>;
}
// <AgentProvider><App /></AgentProvider> at the app shell
```

**Any other framework** (plain DOM, Vue, Svelte, Angular, server-rendered pages): use the `<byoa-connection-dialog>` custom element. It is the same dialog as the React component.

```ts
import { byoa, createAgentSession } from '@byoagent/browser';
import { defineAgentElements } from '@byoagent/browser/elements';
import '@byoagent/browser/styles.css'; // optional default styles

export const session = createAgentSession(byoa); // create once, at module scope
defineAgentElements();
const dialog = document.querySelector('byoa-connection-dialog')!; // <byoa-connection-dialog> in your markup
dialog.session = session;
dialog.returnFocusElement = connectButton;
connectButton.addEventListener('click', () => { dialog.open = true; });
session.subscribe(() => {
  const { connection, pending } = session.getSnapshot();
  connectButton.textContent = connection.connected ? connection.agentName ?? 'Agent connected' : 'Connect Agent';
  submitButton.disabled = !connection.connected || pending;
});
```

Styling: reuse the app's design system. Map `--byoa-*` variables (accent, on-accent, surface, text, muted, border, error, radius, font) to the app's tokens; see the React package README. Check that white text on the mapped accent keeps 4.5:1 contrast. Use hooks (`useConnection`, `useAgentTask`) or the session snapshot if the app needs fully custom markup, preserving accessible names, focus handling and status announcements.

The dialog already handles every connection state: checking, extension missing, not connected, waiting for approval in BYOA's window, connected (Change, Open sidebar, Agent settings, Disconnect), and errors such as a cancelled approval.

## Step 5: Send requests

Wire the workflow's existing button or composer to one request:

```ts
const terminal = await session.run({
  prompt: 'Improve the selected paragraph for clarity. Propose the replacement for review.',
  tools: ['get_selection', 'propose_replacement'], // exact registered names, smallest set
});
// terminal?.status is 'done', 'cancelled' or 'error'. Results already arrived through your tools.
```

In React, use `const { run, cancel, task, busy } = useAgentTask()`, or `AgentPromptPopover` (with `tools` and `ready`) for a generic request box. Rules:

- Enable submission only after the tools' registration has completed and the person is connected; revalidate context at submission. Route or view changes must update the tool list and readiness.
- Disable duplicate submissions while `pending`/`busy`. Show queued, working, done, cancelled and error states.
- Offer **Cancel** (`session.cancel()`) for the running request and **Open in sidebar** (`session.client.openChat(taskId)`) for its transcript.
- `run()` consumes the task's events; never iterate them again. A session tracks only its own `run()` calls, so share one session between the dialog and your request code.
- An `interrupted` final event with `local: true` means BYOA stopped waiting for cancellation; remote work may still be running.

## Step 6: Show results and keep review

Results appear through the app's own tool state and UI (for example proposals with Accept and Reject). Keep proposals visible after failures. A completed task need not have produced a result. Retry only from a fresh click after checking the current context and existing proposals. Don't persist prompts automatically; recovery storage is an explicit product decision.

## Step 7: Clean up

Unregister tools and release subscriptions when the owning view goes away. Create sessions once at module scope. In React, never dispose a session in effect cleanup (StrictMode replays it). Dispose an app-owned session only when its real lifetime ends, awaiting its bounded completion, then dispose an owned client. Never dispose the shared `byoa` client from a component. Imports are SSR-safe; call browser APIs only in browser lifecycle code and event handlers.

## Step 8: Validate

Run the app's existing checks, then add coverage with a mock provider instead of the extension. In a browser test (for example Playwright's `page.addInitScript`), announce a fake provider before the page loads:

```js
const listeners = new Set();
const provider = {
  async request({ method, params }) {
    if (method === 'agent_status' || method === 'agent_connect')
      return { available: true, configured: true, connected: true, agentName: 'Test agent' };
    if (method === 'agent_requestTask') {
      const taskId = 'task-1';
      setTimeout(() => listeners.forEach((l) => l({ taskId, status: 'working', busy: true, seq: 0, detail: 'Working' })));
      // Call your app's own tool handlers here to simulate the agent, then finish:
      setTimeout(() => listeners.forEach((l) => l({ taskId, status: 'done', busy: false, seq: 1, detail: 'Done' })), 50);
      return { taskId };
    }
  },
  on(event, listener) { if (event === 'task') listeners.add(listener); },
  removeListener(event, listener) { listeners.delete(listener); },
};
addEventListener('agent:requestProvider', () => dispatchEvent(new CustomEvent('agent:announceProvider', {
  detail: { info: { uuid: 'test', name: 'Test', icon: '', rdns: 'test.local' }, provider },
})));
```

In unit tests, pass the same kind of object to `createClient(provider)` and give `createAgentSession(client)` to `AgentProvider session={...}` or the element's `session`. Cover: extension missing, cancelled approval, successful connection, the exact tool list sent, task error, cancellation, disconnect during work, route or tool changes, and explicit retry. For React also check StrictMode and server rendering. Check keyboard-only use of the dialog, focus return, scoped or dark themes, and a 375px-wide screen.

For a manual check, the person needs the extension. Until it is in the Chrome Web Store they build it from the BYOA repository ([Install the extension](https://github.com/adamgoth/bring-your-own-agent#install-the-extension)), add a provider profile in its Options, open the app, and click **Connect Agent**.

## Report back

List the files changed, the tools and their exact names, the tool list each request sends, the checks you ran and their results, and the manual checks still needed (including installing the extension). Mention anything you couldn't verify.
