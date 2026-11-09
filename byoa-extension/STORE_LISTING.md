# Chrome Web Store submission: BYOA 0.1.1

## Package

From the repository root:

```bash
pnpm --dir byoa-extension run package:store
```

Upload `release/byoa-0.1.1-chrome-web-store.zip` from this extension directory. The command runs type checking, lint, and unit tests, builds production assets without source maps, and includes the MIT license and privacy policy. It does not commit, tag, publish, or require a clean working tree. The separate `release` command remains the tagged GitHub release workflow.

The source manifest's placeholder version is replaced from `package.json` during the build. Version 0.1.0 started BYOA's own release numbering independently of AgentBoard. Version 0.1.1 replaces the 0.1.0 submission; the store requires a higher version for any replacement.

## Listing text

Name: BYOA

Summary: Bring your own AI agent to WebMCP-enabled websites using your own provider, API key, and model.

Description:

BYOA lets you configure your own AI agent and use it with browser apps that expose WebMCP tools.

Choose OpenAI, OpenRouter, Anthropic, Google, or a compatible endpoint. Enter your own API key and model ID, open the sidebar, and ask your agent to work with the tools available on the current page.

Features:
- Provider presets with editable endpoints and model IDs.
- A browser sidebar for conversations and page tools.
- Optional remote MCP server connections.
- An optional local workspace for agent context and memory.
- Experimental in-app agent connections: apps that integrate BYOA can ask to connect, and you approve each site.

You supply access to a compatible AI service. Provider charges and terms may apply. WebMCP is experimental, and available tools depend on the website. The experimental Connect agent flow works with HTTPS websites and local development servers that integrate BYOA's client. Each site must be approved separately, and approvals last for the browser session.

BYOA has no account system, advertising, or analytics backend. Prompts, page context, tool results, attachments, and workspace files may be sent to services you configure. Review the privacy policy before use.

Based on AgentBoard by Ilya Grigorik, available under the MIT license.

## Links and assets

- Project/support: https://github.com/adamgoth/bring-your-own-agent
- Support issues: https://github.com/adamgoth/bring-your-own-agent/issues
- Privacy policy: https://github.com/adamgoth/bring-your-own-agent/blob/main/byoa-extension/PRIVACY.md
- Icon: `public/icons/icon-128.png` (also copied to `release/store-assets/icon-128.png`).
- Prepared 1280×800 screenshots: `release/store-assets/byoa-provider-setup.png` and `release/store-assets/byoa-first-run.png`. Both were captured from a clean profile with empty credentials. Add a demo-action screenshot if desired.
- Promotional images: `release/store-assets/byoa-store-small-440x280.png` and `release/store-assets/byoa-store-marquee-1400x560.png`. Originals and generation prompts are saved under `../docs/media/`. Upload these separately from the extension ZIP.

The revised privacy policy must be pushed before submitting; until then the public link shows the earlier wording. Set and verify your chosen public contact email in the dashboard. No contact email is inferred from Git history.

## Single purpose

Let users configure their own AI agent and interact with browser page tools through WebMCP.

## Permission explanations

- `storage`: Save agent/provider settings, user-selected configuration, and bounded session task transcripts.
- `tabs`: Track tab identity and URL/title context for conversations and route tool calls to their owning tab.
- `activeTab`: Capture the visible page when the page-reading tool includes visual context.
- `sidePanel`: Display the agent conversation and tool activity beside the current website.
- `contextMenus`: Offer BYOA actions from the browser context menu.
- `scripting`: Install bundled WebMCP bridges and page-reading tools and execute user-configured page scripts.
- `webNavigation`: Detect document navigation and invalidate tools and capabilities belonging to the previous document.
- `<all_urls>`: Connect to user-configured AI/MCP endpoints and access selected pages for page tools. A small connection bridge loads on HTTPS and loopback pages so that apps integrating BYOA can request a connection; it stays inactive until the page calls BYOA's client, and no site can use the agent until the user approves that site. Access is broad because endpoint and website URLs are user-selected; file access additionally requires Chrome's explicit file-URL toggle. Website access can be restricted in Chrome's extension settings.

## Reviewer instructions

1. Install the extension and open BYOA using its toolbar action.
2. Open settings and add an agent. Select a provider preset, provide a compatible model ID and API key, and save. Provider/model access is required for live AI requests; the extension does not include a shared key.
3. For the reproducible local examples, clone the linked repository, install Node.js 22.13+ and pnpm 10.28+, then run `pnpm setup` followed by `pnpm dev` from the repository root.
4. Open Margin at `http://localhost:5183` or Boardwalk at `http://localhost:5184`. Reload the page after installing the extension if necessary.
5. Click Connect agent, review the requested connection, and choose the configured agent. Try a writing action in Margin or a board action in Boardwalk; observe changes directly in the app.
6. Open the sidebar to inspect available tools and conversation/tool activity. A native WebMCP browser flag is not required for these demos because BYOA includes a polyfill.

Before submitting, arrange a reviewer-accessible test endpoint/key if reviewers cannot use their own provider. Enter test credentials only in the dashboard's private test instructions; never place them in this file or the ZIP.

## Submission checks

- Complete the dashboard's data-use disclosures based on the full privacy policy. Own-key operation does not mean no data is processed or transmitted to third parties.
- Review the custom script feature when answering the remote-code declaration: it executes user-configured JavaScript in a website's MAIN world through a Blob script. It does not currently use `chrome.userScripts`. Explain this accurately and assess it against the MV3 policy's isolated-context exception; do not claim that all executed code is bundled merely because model requests use an API.
- Official code policy: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements/
- Add screenshots, verify the contact email and privacy link, select distribution, and submit for review. Publishing is a separate dashboard action.
