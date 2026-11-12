# Changelog

## Unreleased — SDK packaging and provider discovery

- Build ESM and declarations for `@byoagent/browser`, with lazy `byoa`, `createClient`, provider selection and SSR-safe imports. Keep `agentboard` as a deprecated alias.
- Add neutral request-only provider discovery and MAIN-world provider, preserving isolated-world/worker authority checks and the full recovery/token-only usage contract.
- Keep v1 `agentboard:*` transport compatibility; eventual removal is planned with no scheduled date.
- Build demos from package output and verify npm pack installation, consumer types and SSR import in CI. No registry publication or store submission.

## Unreleased — task recovery

- Same-document task-port reattachment with a ten-second grace period and 50-event replay buffer.
- Session-only sequenced task records, tab/origin-scoped summary lookup, and restart interruption reporting.
- Separate queue, run and inactivity limits; Options run limit (1–10 minutes), with app requests clamped to it.
- SDK lookup and retryability; Margin reload recovery with explicit gesture-based retry. No automatic retry or stream resumption.

## Unreleased

- Keep sidebar conversations in browser-session storage and continue active responses when the sidebar closes. Reopening restores messages and tool activity without rerunning work; Stop and Clear remain explicit actions. Agent switching retains the same history.

- Isolate sidebar and site model streams. Run up to three site tasks concurrently, with two per profile and one per tab; report provider rate limits clearly.
- Choose session-only, 30-day, or until-disconnect site approvals; incognito stays session-only.
- Manage Connected sites in Options, including duration, shared files, last use and revocation that cancels running tasks.
- Keep a clearable, metadata-only local activity log (500 entries, 30 days), excluded with grants from settings backups.
- Revoke approvals when their profile is deleted and enforce expiry on read.


## Unreleased

- Add optional per-origin, session-only sharing of persona, user, and memory snapshots with site tasks. Sharing defaults off, excludes file tools, and is recorded in extension transcripts.

## 0.1.1

- Any HTTPS site, and `localhost`/`127.0.0.1` on any port, can request an agent connection. Each exact origin still needs approval, and tasks check it before any model request. Previously only the two bundled demo ports could connect.
- The page bridge stays dormant until a page calls the BYOA client, so ordinary sites see no polling or messages.

## 0.1.0

Initial BYOA release, based on AgentBoard by Ilya Grigorik.

- Configure agents with OpenAI, OpenRouter, Anthropic, Google, or compatible endpoints.
- Use your own API keys and model IDs; OpenRouter defaults to Responses with optional Chat Completions compatibility.
- Interact with WebMCP tools through the browser sidebar.
- Connect agents to the included local writing editor and Kanban demos.
- Optionally configure remote MCP servers and a local workspace.

### Spending budgets and usage

- Added person-controlled per-task, site daily and all-sites daily budgets, a serialized 35-day local ledger, and isolated private session accounting.
- Added cumulative token usage to task events/recovery and Boardwalk, with explicit incomplete usage and step-limit fallback. Budget stops preserve proposals and use `error` / `budget`.
- Added optional profile pricing and extension-private cost/activity reporting. No built-in prices; sidebar chats are excluded. Caps are checked at provider step boundaries and may overshoot by one step per running task.
