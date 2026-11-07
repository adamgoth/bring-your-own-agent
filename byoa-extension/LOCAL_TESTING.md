# Local BYOA testing

BYOA is a modified AgentBoard fork. Work in this repository’s `byoa-extension/` directory, not the retained upstream checkout.

## Build and load

Run these commands from the repository root:

```sh
cd byoa-extension
pnpm run check
pnpm run build
```

Load `byoa-extension/dist` using **Load unpacked** at `chrome://extensions`. After rebuilding, reload BYOA there, then reload the demo tabs. The extension needs no development server. The repository now has a local initial commit. Release packaging additionally requires a clean annotated tag.

Margin runs at `http://localhost:5183/` and Boardwalk at `http://localhost:5184/`. The equivalent `127.0.0.1` URLs also support BYOA; approve each exact origin separately. Do not start another server if those ports are occupied. Current app setup commands are in the [root README](../README.md).

## Connect and try the demos

Configure a profile in BYOA Settings. Each app's **Connect agent** action calls `agentboard.connect()` and opens BYOA's private approval window. That window shows the requesting origin and all profiles, even a single profile. Approve the desired profile there. Apps never enumerate profiles or receive credentials. Cancellation leaves existing grants intact; grants are scoped per origin and browser session.

In Margin, highlight sample text, choose an editing action, enter an instruction, and press **Send**. In Boardwalk, select a card, choose **Ask agent**, enter an instruction, and press **Send**. Review proposals in the app. Tasks run in the background; **View agent chat** explicitly opens the transcript. Disconnect cancels that origin's tasks. See [sdk/README.md](sdk/README.md) for lifecycle and capability limits.

## Browser verification

Use disposable browser profiles and a loopback dummy provider, never saved credentials. With both demo servers running and the extension built:

```sh
CHROME_FOR_TESTING_BIN='/path/to/Chrome for Testing' pnpm test:browser:apps:built
```

The tracked harness exercises approval, profile switching, both apps' WebMCP scopes, proposals, cancellation, per-origin revocation, and transcript viewing. Other built suites are documented in [tests/browser/README.md](tests/browser/README.md). Old `AGENTBOARD_*` test environment variables remain supported technical identifiers.

## Historical verification notes

The entries below record earlier AgentBoard/Margin iterations and old layouts, before the current BYOA-owned approval flow. Paths, UI copy, test counts, provider advice, and missing-feature statements in these historical entries are not current setup instructions. Preserve them as provenance; use the instructions above and the root README for current work.

## Dependency changes and audit scope

- MCP SDK 1.29.0 → 1.32.2, including the [HTTP redirect credential/body leakage fix](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw). This client transport is relevant to remote MCP use. Server-side findings in the same package do not imply the extension runs an MCP server.
- Vitest 2.1.9 → 4.1.12, removing the old vulnerable test-server/worker graph (including Tinypool). Those findings concern development/test use, not shipped extension code.
- Zod 3.25.76 → 4.6.7, explicitly supported by the installed AI/MCP SDK peer ranges.
- Vite 6.4.2 → 6.4.5; CRXJS 2.4.0 → 2.7.1; compatible AI SDK 5.x/provider 2.x and other transitive updates in the lockfile.
- Narrow override `@ai-sdk/provider-utils@3.0.44>undici: 6.29.1`: that SDK release pulls unsupported Undici 5.x. Its Node-only path uses `Agent({ connect: { lookup } })` and `fetch(..., { dispatcher })`, retained in 6.x. A loopback smoke check verified custom lookup, body reading, redirect refusal, and abort behavior. Browser/service-worker execution uses native fetch. This is an intentional, reviewed major override, not a blanket audit fix; revisit it when the provider-utils dependency is corrected upstream.
- Kept Prettier at 3.8.3 to avoid unrelated formatting changes. Updated three test expectations/types for Vitest and Google's new nested tool-image encoding. Fixed the MV3 isolation test to poison methods when the polyfill locks `document.modelContext`.

Audit: **101 → 3 findings**; final **0 critical, 0 high, 3 moderate, 0 low**. Production-only audit: **0**. Counts are advisory/path findings, not a count of demonstrated exploits.

Remaining development-only findings:

- `glob` through `archiver-utils`: [AbortSignal cancellation bypass](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), fixed in glob 14.0.2. The release packager appends pre-enumerated buffers; it does not call archiver's glob traversal API. No release was packaged or published.
- `minimatch` through archiver and TypeScript ESLint: [pattern amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249), fixed in 11.0.1. The vulnerable optimization path requires level 2; the inspected TypeScript ESLint call uses `{ dot: true }`, not level 2. These are build-time paths, not browser tools. Untrusted repo/config input would require reassessment.

No forced glob/minimatch major overrides were applied. These residual advisories remain visible. ESLint 9 and glob 10 also report upstream deprecation notices. The release build warns about an approximately 840 kB main chunk; the build succeeds. Zero production audit findings is not a complete security guarantee.

## Verification

- Frozen-lockfile installation with scripts disabled.
- `pnpm run check`: typecheck, strict lint, 68 files / 1,005 tests passed.
- Development and minified builds; generated sources unchanged.
- Built page reader: 7 browser scenarios passed.
- Built MV3 extension: 19 scenarios passed on both development and minified builds, including local mock-provider requests, worker restart, tools, PDFs, and configuration recovery.
- Pinned WPT: 19 files / 39 subtests passed, native WebMCP disabled; same-document imperative scope only.
- Margin smoke: all five tools discovered and called through the actual built AgentBoard relay on both development and minified builds in isolated fresh browser profiles. Replacement/comment appeared pending review. No external model/provider was configured.

Local evidence and rerunnable smoke scripts are under ignored `local/`: `verification/`, `margin-smoke.mjs`, `undici-smoke.mjs`, and `wpt-results/`. Browser suites accept `CHROME_BIN` and `CHROME_FOR_TESTING_BIN`; this machine's tested binary is `/private/tmp/margin-bridge-browsers/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.

## Send from the highlight popup without the sidebar

1. Reload the unpacked AgentBoard extension in `chrome://extensions`, then reload `http://localhost:5173/`.
2. In AgentBoard Options, edit your API agent and enable **Set as default agent**, then save. The popup uses this default, independent of the last agent selected in the sidebar.
3. Highlight a sample passage, choose Suggest replacement / Explain / Add comment, and enter your instruction.
4. Click **Send** (the send-icon button). No sidebar is opened. The popup shows compact work/error status and Cancel. **View agent chat** opens AgentBoard, where the full prompt, model response, and tool activity are available. The document has no page-level agent log. Suggestions and comments appear inline through Margin's tools.
5. Review replacements before accepting them.

Each send is a fresh, independent task, with no cross-request chat history. Keep the page open. Closing/reloading it cancels its connection; worker interruption shows a disconnection error. There is a two-minute task timeout. Cancellation cannot retract a suggestion already created. AgentBoard's AI client permits one active model stream globally, so sending another task or sidebar chat can interrupt the current task.

This local prototype supports the top-level localhost:5173 page. Only a trusted Send click starts a task. It calls the configured default provider directly using extension-held credentials and allows only Margin's five site tools. It skips Local Workspace resolution and remote MCP guidance/tools for these requests. No automatic continuation occurs after navigation/tool changes or the step limit; the inline status asks you to review and retry. No private workspace files or real API keys were used in verification.

Validation for this change: typecheck and strict lint; 69 files / 1,011 AgentBoard tests; Margin build and five engine tests. The isolated browser test uses a loopback mock Chat Completions provider to exercise real tool calls, inline progress/proposals, cancellation, and provider errors while asserting no sidebar is opened. See `local/background-smoke.mjs` and `local/verification/background-*` for evidence. Live OpenRouter/model behavior is left for your own configured-agent test.

## Clean popup and sidebar history

The popup now uses **Send** with a small send icon, removes the default-agent caption, and includes **View agent chat**. Background sends still do not open a sidebar; View agent chat explicitly requests it. If Chrome refuses that request, open AgentBoard via its toolbar icon. Its sidebar restores the tab's popup-task history automatically, including prompts, responses, and expandable tool activity. Existing sidebar conversation and draft text are preserved; the task transcript is a separate viewing section, not resumable model history for sidebar follow-ups.

History is kept only in extension session storage (up to ten tasks per tab, bounded response/activity sizes), rather than in the Margin document or permanent browser storage. It clears with the browser session. The current popup shows compact working/completed/error state and cancellation; full model commentary stays off the page.

UX validation: 70 AgentBoard test files / 1,013 tests, strict lint, typecheck, both builds, and Margin's five engine tests. Browser verification covers clean popup labels/icon, background proposals without opening a sidebar, the View agent chat request, cold sidebar history restoration, and popup cancellation/errors. See `local/chat-ux-smoke.mjs` and `local/verification/chat-ux-*`.

## Extension-only connection UX

Margin no longer includes local companion/pairing controls. The prior full source is preserved in the Margin repository's local branch `archive/local-agent-2026-11-07`, commit `87c1ea3d24fbe7f2c55b9dbca3525a0433e73e64`.

Reload the extension and Margin. Click **Not connected** in the header, then **Connect agent**. If no API profile is configured, the menu offers **Open AgentBoard settings** instead. After connecting, the indicator reads **Agent connected**, switching to **Agent working…** during requests. The menu offers the chat, settings, and Disconnect. The popup offers Send only while connected. WebMCP registration remains a separate Developer tools status.

This demo connection is scoped to localhost:5173 and lasts for the browser session, including page reloads. The extension shares readiness flags and, only after connection, the profile display name. It does not share endpoints, models, or keys. It checks the connection before starting model requests. Disconnect blocks new starts and cancels active tasks; existing suggestions are still available to review. Provider credentials are tested when a request is sent, not by the connection indicator.

Connection UX validation: 71 AgentBoard files / 1,017 tests, strict lint, typecheck, build, and unchanged generated sources; Margin build, five engine tests, and five editor/disconnected-agent browser tests. The loopback mock-provider integration verified explicit Connect, background proposal generation, Disconnect blocking sends, and disconnected status in a fresh document. Screenshots and logs are under `local/verification/connection-*` and `agent-connected.png`.

The header now displays the connected profile name (ellipsized when long), with Working… appended during a task. Not connected remains the disconnected state.

## Shared client and Boardwalk demo

The preceding sections record the earlier Margin-only iterations. The current implementation replaces the DOM-attribute/MARGIN_* bridge with a generic page client in `sdk/`. Both Margin (localhost:5173) and Boardwalk (localhost:5174) import that client. The extension resolves requested tool names through WebMCP and contains no app-specific tool list or DOM selectors.

Rebuild and reload `agentboard/dist`, then reload both app tabs. Connections from the old prototype do not migrate: use each app's Not connected → Connect agent. Boardwalk runs from the sibling `webmcp-kanban` repository with `pnpm dev`; Margin's existing server remains on 5173. Use `localhost` page URLs, not `127.0.0.1`.

In Boardwalk, select a card → Ask agent → enter an instruction → Send. Progress is compact, proposals are reviewed inside the board, and acceptance applies the whole validated batch. Manual edits invalidate older proposals; undo advances the revision. Sidebar chat opens only through an explicit View chat click and focuses the correct task. Manual create/edit/move/undo works without an extension.

The two origins connect independently for the browser session. Page tasks queue instead of replacing one another; cancellation removes a queued task without aborting the active task. Disconnect cancels queued/active work for that origin. The native sidebar still shares the singleton model client and can interrupt a page task. Navigation/worker interruption fails closed with no automatic reattachment or retry. See `sdk/README.md` for the full prototype boundary, including the missing extension-owned consent UI.

The tracked browser test `tests/browser/app-provider.mjs` uses disposable Chrome and a loopback mock provider, never the user's extension configuration or credentials. With both app servers running and the extension built:

```sh
CHROME_FOR_TESTING_BIN='/path/to/Chrome for Testing' pnpm test:browser:apps:built
```

It exercises both apps' distinct WebMCP scopes, pending review and acceptance, manual card operations, background execution without a sidebar, cross-app queuing, queued cancellation, per-origin revocation, optional task transcript viewing, and a narrow mobile viewport. Screenshots are written to `/private/tmp/boardwalk-{desktop,review,mobile}.png`.

Final verification for this iteration: AgentBoard typecheck and strict lint pass; 72 files / 1,020 unit tests pass. AgentBoard, Margin, and Boardwalk production builds pass. Margin's five engine tests and five editor/disconnected-agent browser regressions pass; Boardwalk's five board/tool tests pass. The tracked two-app mock-provider browser test passes all flows above, including mobile sizing and transcript focus. Live provider behavior remains for the configured-agent test; no real credentials were used.

## BYOA monorepo layout

This snapshot now lives under `Bring Your Own Agent/agentboard`, with sibling `margin/` and `boardwalk/` apps. Earlier paths and checkpoint instructions above describe the original source repositories. Use the root README for current setup and launch commands. Boardwalk now supports reviewed card deletion and column create/rename; its ten unit tests cover ordered batches, undo, stale changes, and migration of existing saved boards.

## Explicit profile selection

The current connect flow enumerates every profile after a trusted menu-opening click, even when only one exists. The app shows names and readiness flags; incomplete profiles remain visible with Needs setup. Selecting a profile and confirming connects that specific ID for this origin, without changing the extension-wide default. Profile switching cancels this origin’s existing queued/active tasks. Legacy boolean connection grants are treated as disconnected: reload and reconnect through the picker. The two-app mock-provider test verifies a single-profile picker in Boardwalk, two profiles in Margin, and that Margin actually calls its selected non-default model.

## BYOA-owned connection popup

This supersedes the preceding app-owned profile picker. Both apps call `agentboard.connect()`; BYOA opens `src/connect/index.html` in an extension popup window. It shows the source origin and all profiles and grants site access only after approval in that private extension context. Cancellation/closing leaves existing grants intact. Pending approvals are session-backed, document-bound, and expire after three minutes. App code no longer enumerates profiles or supplies an agent ID to connect.

## Current extension directory

The extension folder is now `bring-your-own-agent/byoa-extension/`; older `agentboard/` paths in historical entries above refer to prior layouts. Load the current extension from `byoa-extension/dist`. The SDK remains under `byoa-extension/sdk`, with both app imports updated.

Both demo apps now live under `demos/margin/` and `demos/boardwalk/`. Run setup, dev, build, and check from the repository root; historical paths above remain for provenance.

Current demo ports are 5183/5184, avoiding Vite’s common 5173 port. Earlier port numbers below the setup section are historical. The old 5173/5174 origins are no longer allowed to connect to BYOA.
