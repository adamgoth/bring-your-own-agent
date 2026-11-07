# Privacy Policy

Last updated: November 7, 2026

BYOA is a browser extension that connects your browser to services and tools you choose. This policy explains what stays on your device, what is sent to BYOA, and what may be sent to third parties.

## Data sent to BYOA

The extension does not send your activity or content to us. BYOA does not operate an account system, analytics service, advertising service, telemetry collector, or backend that receives extension data.

We do not sell extension data or use it for advertising.

## Data on your device

BYOA stores its settings in your browser. These settings may include service credentials, endpoints, model and tool configuration, command templates, scripts, and interface preferences.

Conversations, attachments, page content, and tool activity may be held in memory while the extension is running, but normal sidebar conversations are not automatically persisted. The experimental page-request interface keeps bounded, per-tab task transcripts (prompt, response, and tool activity) in extension session storage so an optional sidebar can display them. These clear with the browser session; they are not included in settings exports.

You may optionally connect a local folder to an agent as a Local Workspace. BYOA stores the folder connection in your browser; the files remain in the folder you selected.

Settings backups are plaintext and may contain credentials or other sensitive configuration. Treat them as secrets. Backups do not include Local Workspace connections or folder contents. Importing settings clears existing Local Workspace connections, so folders must be reconnected afterward.

## Data sent to third parties

BYOA may make limited third-party requests to load its interface. Those services receive ordinary network information, such as your IP address and request headers.

When you configure or use a provider, server, tool, or script, BYOA or that tool may send data to the relevant third-party services. These services can include model providers, proxies, MCP servers, websites, and services contacted by tools or scripts.

Depending on the action, shared data may include content you provide, attachments, Local Workspace file contents, URL and title context from current or earlier conversation turns, page content, tool definitions and instructions, tool inputs and results, model settings, and credentials or browser-session data needed to access the selected service.

BYOA requests the `<all_urls>` host permission, which Chrome describes as access to your data on all websites. You can restrict or revoke site access at any time from `chrome://extensions`.

The `agentboard_read_page` tool includes reduced-resolution page visuals by default for connection APIs that support media in tool results: one screenshot of the currently visible browser viewport for HTML pages, or full-page images for PDFs. These images can disclose material absent from extracted text, including photographs, signatures, handwriting, annotations, visual redactions, charts, diagrams, layout relationships, and anything else on screen at that moment such as chat widgets, notifications, and form contents as rendered. Screenshots are delivered only while that page's tab is the active tab of its window, so switching tabs during a read yields no image. A tool call can set `includePageImages` to `false` for text-only extraction. Raw PDF bytes are not sent to the model provider, and images are not stored in sidebar history or browser storage, but images delivered to a configured model service are processed under that service's terms and privacy policy.

Reading a local `file://` PDF requires you to enable Chrome’s “Allow access to file URLs” toggle for BYOA. Chrome grants this permission at the file-scheme level, but BYOA uses it only when `agentboard_read_page` is invoked against the exact current top-level PDF. Remote images in model-authored Markdown stay hidden until you choose Load external image after reviewing the full destination URL. Loading an image sends a request to that destination, which may contain information in its URL. Model-authored Markdown links and images reject `file:`, extension, data, and other privileged URL schemes so they cannot exercise that browser permission. Local bytes are read inside the capability-authenticated PDF worker path and are not sent through the extension service worker, generic runtime messages, logs, or storage. As with any attached tab, the configured AI endpoint can receive the local tab’s URL and title in page context; the tool’s public result does not duplicate the filesystem path.

At the start of each new chat for an agent with a connected workspace, BYOA automatically reads recognized `IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`, and `MEMORY.md` files and sends their contents to that agent’s configured AI service. Other files in the selected folder may be read and sent through visible tool calls. Permitted memory writes and deletions also occur through visible tool calls. Switching a conversation to another configured agent may send its existing history, the selected agent’s Local Workspace content, and page context to the newly selected service.

The exact data sent through configured services depends on the provider and the features, tools, and scripts used for your request. Third-party services process data under their own terms and privacy policies; BYOA does not control their logging, retention, caching, or use of data after they receive it.

## Your choices

You control which providers, endpoints, tools, scripts, and Local Workspace folders you configure and use.

Disconnecting a Local Workspace, deleting an agent, clearing extension data, or uninstalling BYOA removes browser-held folder connections but does not delete files in the selected folders. Delete folder contents with your normal filesystem tools. Files in a synchronized folder may also be retained by that synchronization service.

Deleting local data does not delete exported backups or data already received by third parties.

## Contact

For privacy or security questions about this modified BYOA fork, contact the person who supplied this local build. The upstream [AgentBoard project](https://github.com/igrigorik/agentboard) is credited for provenance; its issue tracker is not a BYOA support channel.
