# Bring Your Own Agent (BYOA)

Configure your agent once in a browser extension. Connect an app, send a request from inside it, and review the results there. The extension runs the agent in the background; its sidebar is optional.

This repo contains the modified AgentBoard extension, the shared experimental browser client, and two WebMCP demos:

| Folder                | What it does                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `byoa-extension/`     | Our AgentBoard fork: provider configuration, background tasks, scoped page tools, cancellation, and optional chat transcripts. The extension is branded BYOA; internal identifiers retain compatibility. |
| `byoa-extension/sdk/` | Shared browser client used by both apps.                                                                                                                                                                 |
| `demos/margin/`       | Selection-first writing app with inline suggestions and comments. Port 5183.                                                                                                                             |
| `demos/boardwalk/`    | Kanban board with reviewable card and column changes. Port 5184.                                                                                                                                         |

## Get running

Use Node 22.13+ and pnpm 10.28.0 (npm ships with Node).

```sh
cd bring-your-own-agent
pnpm run setup
pnpm build
pnpm dev:demos
```

`pnpm run setup` installs each project's pinned dependencies using its existing lockfile. The projects keep independent lockfiles; this is a single project folder, not a pnpm workspace. Git tracking is currently disabled. No provider credentials or browser profiles are part of the repo.

1. Open `chrome://extensions`, enable Developer mode, and **Load unpacked** → this repo's `byoa-extension/dist` folder.
2. Configure your API agent profiles in the extension's Options.
3. Open [Margin](http://localhost:5183/) and [Boardwalk](http://localhost:5184/). Both `localhost` and `127.0.0.1` work; each origin needs its own connection approval.
4. In each app, choose **Not connected → Connect agent**. BYOA opens its own popup: check the requesting site, select a profile, then approve. The picker is shown even when only one profile exists. The header displays your agent's profile name.
5. Send a request inside the app. Proposals appear there for review. **View chat** explicitly opens the extension's task transcript.

An unpacked extension's installation identity depends on its path. Loading this new `byoa-extension/dist` is a separate installation from the old checkout: configure its agent or deliberately import a settings export. Keep settings exports private; they can contain credentials. Disable the old installation while testing this one so two bridges don't run on the same page. Reload the extension and app tabs after extension rebuilds.

The servers bind to loopback and use strict ports. Ports 5183/5184 keep the demos separate from apps using Vite’s default port 5173. Ctrl+C stops both servers.

## Demo prompts

**Margin:** highlight a passage → Suggest replacement → “Make this clearer and more concise” → Send. Accept or reject the inline suggestion.

**Boardwalk:** select any card → Ask agent → “Break this into three actionable tasks. Keep the original card” → Send. Review the batch before accepting.

Also try: “Create a column called Next week, move two high-priority cards into it, rename Ready to Up next, and propose deleting the sample-board card.” Card deletion and column changes are proposals, not immediate mutations. Undo restores accepted cards and columns together. Editing the board invalidates older proposals.

`pnpm dev:demos` starts both demos together: Margin at http://localhost:5183/ and Boardwalk at http://localhost:5184/. `pnpm dev` is an equivalent shortcut. Press Ctrl+C to stop both.

## Shared contract

Apps expose their actions with WebMCP. They pass registered tool names to `agentboard.request()` through the shared client; they never supply executable tool definitions to the provider interface. No app-specific extension handler is needed.

- Margin: `get_selection`, `get_document_outline`, `find_text`, `propose_replacement`, `add_comment`.
- Boardwalk: `get_board_snapshot`, `get_selected_cards`, `propose_board_changes` (card create/update/move/delete; column create/rename).

See [the SDK contract](byoa-extension/sdk/README.md), [Margin's guide](demos/margin/README.md), and [Boardwalk's guide](demos/boardwalk/README.md).

This is a local prototype. Only the two demo origins are allowed. Connections are per origin and browser session; page tasks queue, and each request has a two-minute timeout including queue time. Navigation or worker interruption stops work without automatic retry or recovery. The native sidebar still shares a model client and can interrupt a page task. BYOA owns the profile picker and site-approval popup. Hosted-site permissions, independent model clients, and task recovery remain future work.

Provider API billing applies. This does not use a ChatGPT or Claude consumer subscription. Use sample content: the configured provider receives instructions, tool definitions, and tool results. Workspace files and remote-MCP context are excluded from app tasks. Credentials remain in the extension.

## Checks

```sh
pnpm check       # Extension types/lint/tests; both demo unit tests and builds
pnpm build       # Build the extension and both demos
# Keep pnpm dev running in a separate terminal, then:
CHROME_FOR_TESTING_BIN='/path/to/Chrome for Testing' pnpm test:browser
```

The browser test uses a fresh temporary profile and a loopback mock model provider. It verifies both apps, distinct tool scopes, review/acceptance, deletion and column changes, queuing, cancellation, per-origin disconnect, optional task transcripts, and mobile layout. It does not use your normal browser profile or real API credentials. Margin also has its own editor Playwright regressions: `npm --prefix demos/margin run test:e2e` (requires Google Chrome and the dev server).

## Source and licensing

This project was assembled from the current working copies and starts with a new local Git history. The original repositories and their history remain intact. See [PROVENANCE.md](PROVENANCE.md). The AgentBoard fork retains its original MIT license and copyright notice in [byoa-extension/LICENSE](byoa-extension/LICENSE). Inherited release tooling uses BYOA artifact names; no publishing repository is configured, and upstream AgentBoard is rejected as a release destination.

GitHub Actions runs from the root `.github/workflows/ci.yml`, checking all three projects and their browser integration. The upstream WebMCP WPT suite remains an opt-in workflow diagnostic because known conformance gaps remain; requested diagnostic runs still fail on those gaps.
