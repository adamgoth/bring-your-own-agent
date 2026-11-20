# Limits, permissions and privacy

BYOA is a prototype. This page is the single reference for what a connected site can do, how long things last, and where data goes. The [SDK contract](../packages/browser/README.md) repeats the parts an app developer codes against, and the extension's [Privacy Policy](../byoa-extension/PRIVACY.md) is the complete data statement.

## Who can connect

- Any top-level HTTPS page can ask to connect. So can plain-HTTP `localhost` and `127.0.0.1` on any port, for local development.
- Plain HTTP on other hosts, pages inside iframes, and other schemes are refused.
- Being eligible grants nothing. Nothing is shared until you approve that exact origin (scheme, host and port) in BYOA's own popup. `localhost` and `127.0.0.1` are separate origins and need separate approvals.
- The page bridge stays dormant until a page calls the BYOA client, so ordinary sites see no polling or messages. Once a page calls the client it can tell that BYOA is installed and whether a profile is ready; it learns nothing else until approved.
- Every script on an approved origin shares that origin's authority. The page transport does not isolate scripts from one another.

## Approvals

- The app's **Connect Agent** click opens a BYOA-owned window showing the requesting site and every profile, even when only one exists. The app never sees the profile list, credentials or endpoint details.
- A pending approval expires after three minutes. Cancelling or closing the window keeps any existing connection.
- You choose how long a connection lasts: **Until I close the browser** (the default), **For 30 days**, or **Until I disconnect**. Incognito approvals are always session-only.
- Persistent grants stay on this device across browser restarts and extension updates. Expiry is checked when access is read. Deleting a profile revokes its site grants.
- Approving a different profile for a site cancels that site's existing tasks. Disconnecting cancels its queued and running tasks.

Manage approvals in **Options → Connected sites**: review profiles, shared files, duration, expiry and last use; change duration; disconnect one site or all of them. The activity log there is local and metadata-only (connection events, task IDs, status, profile names, tool names and duration, with no prompts, tool arguments or results). It keeps at most 500 entries for 30 days and can be cleared. Grants and activity are excluded from settings backups.

## What a site task can use

- Only the page's own WebMCP tools that the app named in its request. Apps pass tool names; tool definitions are never accepted from page messages.
- Workspace sharing is off by default. In the approval popup you can share read-only snapshots of Persona (`IDENTITY.md` and `SOUL.md`), About you (`USER.md`) or Memory (`MEMORY.md`) with that exact origin for the chosen connection duration. Shared content can reach destinations used by the site's tools.
- `AGENTS.md`, journals, file tools and remote-MCP context are always excluded. The page API exposes no sharing state.
- Each request starts without prior conversation history. Floating site voice is the exception: follow-ups there use up to four successful prior turns from the same site.

## Task limits

| Limit | Value |
| --- | --- |
| Running site tasks | 3 globally, 2 per profile, 1 outstanding per tab. Extra tasks wait in FIFO order. |
| Queue wait | 5 minutes. Does not consume run time. |
| Run time | 2 minutes by default; 1–10 minutes in Options. An app's `timeoutMs` can shorten it, never extend it. |
| Inactivity | 60 seconds without a stream chunk, tool call or result. |
| Reattach after a dropped port | 10 seconds within the same document, replaying the last 50 progress events. |
| Task history | 10 recent finished tasks per tab plus any live task, for the browser session only. |

Site tasks run independently of sidebar chats. Navigation stops a run. A service-worker restart marks unfinished tasks `interrupted`. Neither resumes the model stream, and there is no automatic retry: the app can look up a summary and offer an explicit **Retry**. Cancelling stops further work but cannot undo an action a tool has already performed, so apps must provide their own review, revision checks and undo.

## Spending budgets and usage

You control budgets in BYOA Options, the connection popup and Connected sites. Apps cannot set budgets, prices, grants or sharing.

- The default per-task cap is 200,000 total tokens. You can override it per site, and set per-site or all-sites daily caps in tokens or dollars. Days follow the browser's local calendar. Sidebar chats are excluded.
- Task events carry cumulative token counts (`inputTokens`, `outputTokens`, `totalTokens`, `usageKnown`). When the provider reports no usage, the profile's step limit applies instead and usage is marked incomplete.
- A budget stop ends the task with `status: 'error'` and `code: 'budget'`; existing proposals stay available for review. A task already over its cap starts no provider call. Usage arrives after each step, so each running task can overshoot a cap by at most one step. A retry is a fresh task against the same daily ledger.
- Costs and profile prices stay private to the extension. Dollar caps need configured prices or a provider-reported cost; no price table is bundled, and missing costs are labelled incomplete in Connected sites. Keyless local profiles count tokens at zero cost. The bundled OpenAI-compatible adapter does not preserve arbitrary OpenRouter billing fields, so enter profile prices when you need dollar caps there.
- Daily ledgers are kept locally for 35 calendar days, with up to 1,000 site buckets per day. Private browsing has a separate session-only ledger. Cancellation before a usage report, and tasks interrupted by a worker restart, are marked incomplete.

## Where data goes

- Credentials stay in the extension. The page never receives them.
- Prompts, tool definitions and tool results go to the model endpoint configured in the profile you approved. Use sample content while developing.
- Provider API billing applies. BYOA does not use a ChatGPT or Claude consumer subscription.
- BYOA has no account system, telemetry or AI proxy of its own.
- Settings exports are plaintext and can contain credentials. Keep them private.
- Floating voice transcribes on the device with Chrome's local speech recognition. No audio is stored or sent to a transcription service; only the text you approve is sent to your agent.

See the [Privacy Policy](../byoa-extension/PRIVACY.md) for storage, retention and deletion details.
