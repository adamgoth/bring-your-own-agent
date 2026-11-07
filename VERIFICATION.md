# Verification — November 7, 2026

Run from this repository, after installation from the preserved lockfiles:

- `pnpm run setup`: all three projects installed successfully.
- `pnpm check`: extension TypeScript and strict lint passed; 72 extension test files / 1,020 tests passed; Margin's five engine tests and Boardwalk's ten board/tool tests passed; both app production builds passed.
- `pnpm build`: extension and both app production builds passed.
- `pnpm test:browser` with Chrome for Testing: passed using a disposable browser profile and loopback mock provider. Covered independent tool scopes, manual cards, background tasks, reviewed card creation/deletion/movement and column creation/renaming, cross-app queuing, queued cancellation, per-origin disconnect, optional task transcript focus, and mobile viewport sizing.
- `npm --prefix demos/margin run test:e2e -- --grep-invert 'native WebMCP'`: five editor/disconnected-agent browser regressions passed. The separate native-browser WebMCP feature test was excluded; app integration used the extension's actual WebMCP bridge.

No real API credentials or normal browser profile were used by these checks. Live-provider output quality, subscription authentication, production hosted-site permissions, and worker recovery are outside this verification. The prototype limits are documented in the root README and `byoa-extension/sdk/README.md`.

Both dev servers were started from this repo using `pnpm dev`: Margin on localhost:5173, Boardwalk on localhost:5174. The original source repositories were retained.

## Demo layout and pre-commit fixes

Current layout: `byoa-extension/`, `demos/margin/`, and `demos/boardwalk/`. Root setup/dev/build/check commands and app SDK imports use these paths.

- Root `pnpm check`: strict extension lint/typechecking; 75 extension test files / 1,047 tests, five Margin tests, ten Boardwalk tests; both demo builds passed.
- Extension `pnpm run build`: passed; `byoa-extension/dist` is ready to reload.
- Fresh-profile browser regressions: seven read-page scenarios, 19 built-MV3 scenarios, sidebar setup/provider Save/Edit, cross-app approval/tasks/review/cancellation, and the new image-consent test all passed with dummy providers/data.
- The image-consent test observed zero requests while rendering model-authored Markdown and one request only after approval of its visible destination.
- Release-path unit tests cover all three extension documents in a monorepo and standalone layout. No repository was initialized or tagged, and no release was published.
- Root GitHub Actions workflow formatting was validated locally. The workflow has not run on GitHub; upstream WPT diagnostics are opt-in because documented conformance gaps remain.

The two existing demo servers were restarted from their moved folders on the same ports. No real provider keys or normal browser profiles were used.
