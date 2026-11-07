# Source provenance

Assembled on November 7, 2026 from three local working copies, including their current uncommitted changes:

- `byoa-extension/` from `workspaces/agentboard`, based on local checkpoint `b7d539a` plus the generic app-provider client, task queue, and related changes. Upstream: https://github.com/igrigorik/agentboard. The original MIT license and copyright notice are preserved unchanged in `byoa-extension/LICENSE`.
- `demos/margin/` from `workspaces/webmcp-editor`, based on local checkpoint `d0c50a0` plus its migration to the shared browser client.
- `demos/boardwalk/` from `workspaces/webmcp-kanban`, including card deletion, editable columns, and the scrolling sidebar fix.

This repository is a source snapshot, not a history merge. The source repositories, Git history, and Margin's archived local-agent branch remain in their original locations. The old local companion is intentionally excluded from this extension/API demo.

Ignored build output, dependencies, local verification artifacts, browser profiles, environment files, and credentials were not copied. Rebuild using the commands in the root README. Provider configuration stays in the user's extension installation and is never bundled with the demo source.
