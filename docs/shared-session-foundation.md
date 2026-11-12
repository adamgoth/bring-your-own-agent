# Shared chat session foundation

Implementation baseline: main 2866e7f (merged PRs #2–#7). PR #7 provider discovery is required by the currently hosted Margin app.

The sidebar becomes a subscriber to a background-owned, tab-scoped conversation.
The existing selected-agent behavior stays intact: selecting another agent affects
future requests, preserves the conversation, invalidates workspace bootstrap, and
does not cancel an active response. This is deliberately not one history per agent.

## Scope

1. Own history, selected profile, active turn, cancellation, page-context capture,
   and automatic continuations in a background session service.
2. Persist bounded transcript snapshots in session storage; reconnect a sidebar by
   replaying display events without repeating provider/tool execution. Closing the
   sidebar only unsubscribes. Stop and Clear explicitly cancel.
3. Mark unfinished turns interrupted after worker restart. Never retry them
   automatically. Remove sessions when their bound tab closes.
4. Retain the current sidebar stream lane and its supersession behavior across
   tabs. Retain independent site lanes and the existing site-task scheduler.
5. Preserve Margin's separate App agent chat, grant restrictions, recovery,
   timeout behavior, and budgets. Sidebar conversations remain outside site budgets.
6. Test lifecycle, agent switching, partial tool history, trusted subscription,
   replay, clear/cancel races, and existing UI/provider integration.

Workspace bootstrap stays worker-local and is reacquired after a worker restart;
private workspace snapshots are not added to persisted transcript records. Session
storage is extension-private, browser-session-only, excluded from backups. Storage
limits must stop with an explicit error rather than silently drop model history.

Voice, microphone permissions, transcription, overlays, TTS, new concurrency
policies, and agent-specific conversation switching are out of scope. A future
voice interface will submit turns and subscribe through this service, with its own
trusted entry-point validation.

## Implementation details

- `background/chat-session.ts` owns the tab conversation, runtime workspace cache,
  cancellation, and continuation loop. `lib/ai/model-history.ts` is the existing
  projection moved to shared code; `sidebar/model-history.ts` re-exports it.
- `lib/chat-session.ts` defines the trusted UI protocol. Only the exact extension
  sidebar URL with its bound tab can connect; the page SDK cannot read this store.
- `sidebar/chat-session.ts` reuses TextBox, ReasoningBox, ToolCallBox and Markdown
  copy controls. Initial snapshots restore ordered display events; incremental
  events update an attached view. Disconnect never submits or retries a turn.
- The existing sidebar lane is retained, including cross-sidebar supersession.
  Site task lanes, scheduling, recovery, permissions, and budgets are unchanged.
- Eight tab sessions maximum; 3 MB per session, with a conservative 8 MB guard over
  all session storage. No silent transcript pruning. Raw workspace bootstrap is
  never persisted; submitted images and visible tool results are. Active work
  refreshes the worker idle timer, and stops doing so when the turn settles.
- The original `ai-stream-*` port remains as a compatibility transport; the sidebar
  now uses `chat-session`. It is not used for session restoration.

## Validation

- Root `pnpm check`: typecheck, strict lint, 1,176 extension tests, 5 Margin tests,
  10 Boardwalk tests, and both demo builds passed.
- Extension production build passed.
- `test:browser:chat:built` passed with synthetic local data and a temporary Chrome
  profile: reattach during a held response; tool execution with no sidebar;
  completed replay without provider calls; structured follow-up history; agent
  switching mid-response; Stop/Clear; actual worker termination with no retry;
  restored selected profile; and cleanup when the bound tab closes.
- Existing sidebar setup browser regression passed.
- Existing full app browser regression passed against isolated current-main demo
  servers, covering app/sidebar independence, grants and revocation, task recovery,
  budgets, worker termination, and persistent approvals across browser restarts.
- `git diff --check` passed. No real provider credentials or personal workspace
  data were used. Voice is not implemented.

The original checkout's unrelated changes are preserved. Implementation is on
`codex/shared-session-foundation` in `/Users/wowza/workspaces/byoa-shared-session`.

## Hosted Margin compatibility follow-up

The worktree was fast-forwarded to merged PR #7 while preserving all shared-session changes. Hosted Margin now uses `agent:requestProvider` / `agent:announceProvider`, so an extension built before PR #7 is not discovered. Chrome was also still loading the original workspace dist rather than this worktree. Rebuilt this worktree after updating: root check passed with 1,188 extension tests and both demo suites, and root build passed.
