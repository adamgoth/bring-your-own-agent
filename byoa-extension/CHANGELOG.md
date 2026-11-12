# Changelog

## Unreleased

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
