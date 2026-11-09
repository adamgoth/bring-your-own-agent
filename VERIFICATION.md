# Verification

The following checks were completed during development using temporary browser profiles and dummy providers.

## Source checks and builds

- Extension TypeScript and strict lint passed.
- Extension unit tests: 75 files, 1,050 tests passed.
- Margin unit tests: five passed.
- Boardwalk unit tests: ten passed.
- The extension and both demo production builds passed.
- Release-path tests cover the extension documents in both monorepo and standalone layouts.

## Browser checks

- Cross-app tests passed on both `localhost` and `127.0.0.1`, using ports 5183 and 5184. Coverage includes connection approval, profile selection, separate tool scopes, reviewed edits, card and column changes, queuing, cancellation, disconnect, transcript viewing, and mobile layout.
- Sidebar tests cover first-agent setup, provider presets, Save/Edit, live profile changes, draft/history preservation, and configuration-error recovery.
- The image-consent test verified zero requests before approval of the displayed destination and one request afterward.
- Seven read-page scenarios and 19 built-MV3 scenarios passed, covering page tools, worker restart, PDFs, local-file isolation, and configuration recovery.
- Five Margin editor/disconnected-agent browser regressions passed; the native-browser WebMCP feature test was excluded from that run.

## Running the checks

From the repository root:

```sh
pnpm setup
pnpm check
pnpm build
pnpm dev:demos
```

With both demo servers running:

```sh
CHROME_FOR_TESTING_BIN='/path/to/Chrome for Testing' pnpm test:browser
BYOA_DEMO_HOST=127.0.0.1 CHROME_FOR_TESTING_BIN='/path/to/Chrome for Testing' pnpm test:browser
```

See [extension browser tests](byoa-extension/tests/browser/README.md) for the remaining suites. The root GitHub Actions workflow checks all projects; upstream WPT conformance diagnostics are opt-in because documented gaps remain.

No real API credentials or normal browser profiles were used. Live-provider output quality, subscription authentication, hosted-site permissions, and task recovery are outside this verification. See the [SDK boundaries](byoa-extension/sdk/README.md#prototype-boundaries).
