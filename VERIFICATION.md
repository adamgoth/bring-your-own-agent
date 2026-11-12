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

No real API credentials or normal browser profiles were used. Live-provider output quality, subscription authentication, hosted-site permissions are outside this verification. See the [SDK boundaries](byoa-extension/sdk/README.md#prototype-boundaries).

## Plan 4 validation

Recovery unit tests cover sender identity (tab/document/origin/private context), bounded ordered replay,
finish during disconnection, grace expiry, cancellation ownership, summary-only lookup, serialized persistence,
startup sweep, record pruning, timeout clamp, independent queue/run limits and inactivity progress resets.
`pnpm check` passed: extension TypeScript, strict lint, 80 test files / 1,129 tests;
Margin's five and Boardwalk's ten tests and builds passed. `pnpm build` passed from the root.

The root browser integration passed with Chrome for Testing 157.0.8103.38, temporary profiles,
a loopback dummy provider and isolated demo ports 5283/5284 (the normal servers were already in use).
It verifies real worker-side task-port disconnect → same task completion with no error; reload →
summary-only terminal lookup and Margin's explicit Retry UI with no automatic request; and actual
MV3 target termination → replacement worker → startup sweep → terminal `interrupted` event in the
still-open page. Chrome retained the stale task port without `onDisconnect`; the heartbeat's
summary reconciliation covers that observed case. Existing approval, independent app/sidebar lanes,
revocation, tool scope, review/acceptance, transcript, mobile and browser-restart checks also passed.

Coverage limits: the app harness disables native WebMCP to exercise the shipped polyfill consistently;
no live providers or personal browser profiles were used. Earlier runs intermittently timed out in
Boardwalk catalog discovery before reaching recovery tests; the completed run passed. This is not a
claim that all Chrome versions or native WebMCP implementations have been verified. The worker
termination test explicitly reports a skip on versions that refuse to replace an active worker;
Chrome 157 replaced it and the test passed. Summary isolation, sequence replay bounds, configuration
validation, all timeout clocks and stalled-preparation cleanup have deterministic unit coverage.

Independent Astra review identified a queued-navigation document-ownership race and timing-dependent
reload classification. Fixes cancel queued/running tasks as top-document navigation begins, revalidate
the initiating document after preparation and immediately before tool snapshot/provider execution, and
classify lost-document completion as `interrupted` while preserving same-document `tools-changed`.
Regression tests cover navigation during queue/grace, missed navigation notification during preparation,
asynchronous shared-context preparation before tool capture, and both tool-change completion outcomes.

## Plan 5 validation

Spending coverage includes serialized concurrent site/global accounting, local day rollover and
35-day pruning, bounded site buckets, restart reads, isolated private-session accounting,
price math and missing costs, missing usage versus reported zero, cap combinations and malformed
limits. Task regressions cover zero-provider-call refusal, mid-task stops with cumulative token-only
usage, explicit missing-usage fallback, and usage-preserving worker interruption/recovery lookup.
A real AI SDK fixture verifies that awaited per-step accounting stops a second model call and
reports budget metadata after one step overshoots the cap. Popup tests reject malformed budgets.

`pnpm check` passed: extension types, strict lint, 81 files / 1,160 tests; Margin's five tests,
Boardwalk's ten tests, and both demo builds. `pnpm build` passed from the root.

The full root browser suite passed with no skips. The browser suite uses Chrome for Testing 157.0.8103.38, fresh temporary profiles, a loopback mock
provider, and isolated Margin/Boardwalk ports 5283/5284. No real keys or personal profiles are used.
New assertions verify cumulative counts, omission of dollars, a one-step tiny-cap stop, and a daily
refusal with zero provider calls. Existing independence, cancellation, proposals, transcripts,
document recovery and browser-persistence coverage remains enabled.

During development, browser runs exposed harness assumptions about recovery summary keys and button
ordering after adding usage and spending controls; those assertions/selectors were updated. Two runs
hit the existing intermittent Boardwalk tool-discovery timeout. Native WebMCP is disabled by the
harness to exercise the shipped polyfill. Live provider billing and unreported usage after abrupt
worker termination cannot be verified by this fixture. The bundled OpenAI-compatible adapter drops
arbitrary OpenRouter cost fields; user-entered prices are required for reliable cost estimates there.
Costs remain extension-private. Private accounting is deterministic unit coverage rather than a claim
of automated Chrome incognito end-to-end verification.

Independent Astra review of the initial plan 5 snapshot found two issues: provider-reported usage
could be lost when cancellation occurred during a pending tool, and queued-task costs could use an
older profile than the executing client. Accounting now intercepts each provider finish before the
SDK waits for tools, with a guard per transport invocation and no duplicate step-summary accounting.
The client supplies a detached snapshot of its executing profile to pricing. Regression fixtures
cover pending-tool cancellation (12 tokens recorded exactly once), execution-profile pricing, and
incomplete usage when cancellation precedes any provider usage report. Startup sweeps similarly mark
working tasks' potentially unreported usage incomplete while keeping public summaries token-only.

After the review fixes, root `pnpm check` and `pnpm build` passed again, as did the full Chrome
integration with no skips. Astra follow-up review of `a64e985` found no actionable findings, confirmed both initial findings resolved, and passed four focused suites / 102 tests. The reviewer did not rerun browser integration.
