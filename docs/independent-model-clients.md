# Independent model streams

Site tasks run in unique `site:<streamId>` lanes. Sidebar requests use the default
`sidebar` lane and retain the existing newest-fully-prepared-request-wins behavior.
Cancellation uses stream ownership across all pending and active lanes.

The site scheduler admits up to three tasks globally and two per profile. The site
handler still permits one outstanding task per tab. Waiters are considered in FIFO
order among profiles with capacity; a saturated profile does not block other profiles.
Release is idempotent, and aborted waiters are removed. The two-minute timeout still
includes queue time. There is no retry or recovery across documents or worker restarts.

## Shared-state audit

- **Tool snapshots:** `captureToolSnapshot` and `selectToolsForTab` run synchronously,
  allocate a fresh selection and source map, and bind factories to the requested tab.
  Each stream's tool-change subscription is tab scoped. No shared selection is mutated.
- **Preparation:** `waitForCurrentSystemTools` only drains the shared, serialized refresh
  promise through its latest generation. Concurrent callers do not initiate duplicate
  refreshes or change the registry themselves.
- **Remote MCP:** site tasks exclude remote tools/context and do not subscribe to the
  remote session's revocation signal. The sidebar listener captures only its request's
  controllers, so remote revocation cannot abort a site lane.
- **Memory authority:** shared workspace bootstrap is read-only for site tasks; they get
  no memory tools. Resolution creates a per-call filesystem/bootstrap and uses existing
  per-agent authority epochs, counted in-flight resolutions, and shared revocation leases.
  Concurrent valid reads do not revoke each other; binding changes intentionally revoke
  the affected profile's authority.
- **Prompt-cache diagnostics:** only the sidebar retains a previous fingerprint. Site
  lanes are unique and have no previous request to compare; their fingerprints are logged
  without retaining history. This prevents cross-app comparisons and unbounded lane state.
- **Toolbar:** the current toolbar indicates connection status, not task activity. It has
  no busy boolean to convert. Task progress is owned by each port, and the one-task-per-tab
  guard prevents overlapping busy updates in an app. Completing one task cannot clear
  another app's progress. No new toolbar busy behavior is introduced.
- **Model runtime:** `createModelRuntime` creates provider/model objects per call. The
  only module-level runtime assignment disables SDK warning logging; it holds no request
  state. Provider retry policy remains `maxRetries: 2`.
- **Abort/error reporting:** site tasks no longer describe replacement by another request.
  Sanitized provider rate-limit errors become a clear task error. Other failures identify
  the site's chosen profile connection and never expose raw provider details to pages.

## Validation

Implementation is based on PR #3 head `2023bc8`, which was open when checked on
2026-11-12. Original-checkout changes are preserved in place. Plan 4 is not included.

Browser tests use a fresh
Chrome for Testing profile and loopback mock provider, with no real provider credentials.
Existing demo servers on ports 5183/5184 are reused; their sources match this branch.

- `pnpm check`: passed, with 1,100 extension tests, 5 Margin tests, 10 Boardwalk
  tests, and both demo builds. This includes existing sidebar supersession/preparation
  regressions, lane isolation in both directions and between sites, cancellation by ID,
  lane cleanup after finish/error/abort, scheduler fairness/limits/abort/idempotent release,
  and sanitized rate-limit task errors.
- `pnpm build`: passed for the extension and both demos.
- Root README `pnpm test:browser`: passed with Chrome for Testing. Held Margin and
  Boardwalk responses prove both apps reach working before either finishes; a sidebar
  message completes while both are held, then both site tasks complete. Distinct tool
  scopes, review/acceptance, optional transcripts, mobile layout, real restart persistence
  for both persistent durations, and Options revocation during a running task also pass.
- `git diff --check`: passed.

The initial sandboxed check could not bind the loopback mock provider; the full check
passed with loopback access. Browser fixture iterations exposed premature sidebar
readiness and a coordinate click that did not send the message. The final test waits
for the resolved profile and visible chat container, dispatches the input event, and
uses the established DOM-click fixture to submit the sidebar message. The real sidebar
UI click path is not separately covered by this concurrency assertion. The sidebar
request is a normal background/provider stream, not a mocked client call.

Global/profile saturation and queued abort are covered by deterministic scheduler tests;
the two-app browser scenario uses distinct profiles. Provider retries and 429 wording are
covered by unit/wire tests, not real external rate limiting. Workspace authority and
sharing retain their existing regression coverage; no real personal workspace is used.
No busy toolbar indicator exists in this revision, so there is no overlapping-toolbar
busy-counter test. No dependency, demo source, grant contract, or plan 4 change is included.

The plans README prohibits pushing; this implementation remains a local branch based on
PR #3, without merging PR #3 or publishing a new PR.
