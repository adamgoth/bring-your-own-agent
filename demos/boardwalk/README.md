# Boardwalk — WebMCP Kanban demo

A second bring-your-own-agent demo alongside Margin. Select cards, ask your configured BYOA API agent for help, and review a batch of proposed changes inside the board. BYOA works in the background; View chat opens its transcript only when requested.

## Run locally

From the BYOA repository root, the source layout is:

```
bring-your-own-agent/
  byoa-extension/       # modified extension and shared sdk/
  demos/
    margin/        # Margin, port 5183
    boardwalk/     # Boardwalk, port 5184
```

```sh
pnpm setup
pnpm dev
```

Open **http://localhost:5184/**. The server binds to loopback. Manual card creation, editing, moving (drag or Move menu), selection, and undo work without an extension. Accepted board state is saved in this browser's local storage. Pending proposals are session-only. This is a single-browser demo; avoid editing the same board in multiple tabs.

Build BYOA with `pnpm build`, then reload the unpacked extension from `byoa-extension/dist` in `chrome://extensions`. Reload both app tabs after the extension reload. Configure an API agent in its Options and choose it in the connection picker. Connect separately in each app using **Not connected → Connect agent**. The header shows your connected profile name.

## Try it

1. Select **Make the first five minutes feel easy** using its checkbox.
2. Click **Ask agent**, then **Break it down** and **Send**.
3. Watch compact progress on the board. The sidebar stays closed.
4. Review the proposed card changes and click **Accept changes** or **Dismiss**. Nothing changes until acceptance.
5. Try **Undo**, or manually edit a card while a proposal is pending. Old proposals become stale and cannot overwrite your work.
6. **View chat** opens BYOA's transcript for this task. **Cancel** stops further work; **Disconnect** stops this site's tasks without disconnecting Margin.

Use sample content: your configured model provider receives your instruction, tool definitions, and tool results. API billing applies; this demo does not use a consumer chat subscription.

## Shared integration

Both demos import `byoa-extension/sdk/index.ts`. BYOA's page bridge has no Boardwalk-specific DOM selectors, tool schemas, or prompt logic. The app owns its interface, data validation, revision checks, and review workflow. WebMCP owns the tool registry and execution:

- `get_board_snapshot`: cards, columns, and current revision.
- `get_selected_cards`: selected cards and revision.
- `propose_board_changes`: validated batch of card create/update/move/delete and column create/rename operations, pending human approval. New columns use stable IDs; renaming keeps existing card assignments intact. A batch can create a column and move cards into it. Undo restores cards and columns together.

Only those three site tools are available to a Boardwalk task. Workspace files and remote-MCP context are excluded. Margin requests its own five tools through the same interface.

See `../../byoa-extension/sdk/README.md` for the experimental client contract and limits. Any HTTPS site or loopback port can ask to connect; each origin needs separate approval. BYOA queues page tasks, uses session-scoped connection flags, and owns the connection/profile approval popup. Spending budgets, persistent site permissions, independent model clients, and task recovery remain future work. Keep the page open; interrupted tasks do not resume or retry automatically.

## Checks

```sh
pnpm test
pnpm build
```

With both app servers running and BYOA built, run the shared browser test from `byoa-extension/`:

```sh
CHROME_FOR_TESTING_BIN='/path/to/Chrome for Testing' pnpm test:browser:apps:built
```

The test uses a fresh temporary browser profile and a loopback mock model provider. It verifies tool scopes, background work, batch review/acceptance, manual edits, cross-app queuing, cancellation, origin-specific disconnect, optional transcript viewing, and mobile layout. It never loads your normal browser profile or real provider credentials.

The app now calls `agentboard.connect()` without building a profile picker. BYOA opens its own window showing the requesting site and all profiles. Select a profile and approve there. Cancel or close preserves any existing connection. Profile lists are no longer exposed to app code.
