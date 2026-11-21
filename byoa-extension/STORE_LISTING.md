# Chrome Web Store submission: BYOA 0.2.0

## Package

From the repository root:

```bash
pnpm --dir byoa-extension run package:store
```

Upload `release/byoa-0.2.0-chrome-web-store.zip` from this extension directory. The command runs type checking, lint, and unit tests, builds production assets without source maps, and includes the MIT license and privacy policy. It does not commit, tag, publish, or require a clean working tree. The separate `release` command remains the tagged GitHub release workflow.

The source manifest's placeholder version is replaced from `package.json` during the build. Version 0.1.0 started BYOA's own release numbering independently of AgentBoard. 0.1.1 was the first published version; 0.2.0 replaces it, and the store requires a higher version for any replacement.

## What changes in 0.2.0

- **Name and summary** come from `manifest.json`, so they change with this upload. The toolbar title and `short_name` stay "BYOA".
- **New permission: `offscreen`.** Add the justification below in the dashboard's Privacy tab before submitting.
- **Voice input is new.** Update the single purpose, data-use answers and privacy policy link as described below.
- The full list is in [CHANGELOG.md](CHANGELOG.md#020).

## Listing text

Name (from the manifest): BYOA - Bring Your Own AI Agent

Summary (from the manifest): Use your own AI agent, model and API key inside web apps. Approve each site, set spending caps, and keep your key private.

Description (paste into the dashboard):

```text
BYOA (Bring Your Own Agent) lets you use your own AI agent inside web apps, instead of whatever AI the app has built in.

Set up your agent once: your provider, your model, your API key. When an app supports BYOA, click Connect Agent, approve the site, and ask for work from inside the app. The agent runs in the background with your key, uses the tools the app exposes, and the app shows you the result to accept or undo.

WHAT YOU GET
• Any model: OpenAI (Responses or Chat Completions), Anthropic, Google, OpenRouter, local Ollama, or any compatible endpoint.
• Multiple agent profiles. Choose which one each site gets.
• Per-site approval. Nothing is shared until you approve the exact site, for this browser session, 30 days, or until you disconnect.
• Spending caps: a token limit per task, plus daily token or dollar caps per site and across all sites.
• Connected sites page: see what each site can use, change or revoke access, and view a local activity log (no prompts or results are stored in it).
• Background tasks: up to three at once, no sidebar needed.
• Voice: talk to your agent on sites that support it, with on-device speech recognition. Audio is never recorded or sent anywhere.
• A sidebar agent for any page: read pages, PDFs, GitHub pull requests and YouTube transcripts, connect remote MCP servers, write your own WebMCP tools, and save prompt commands.
• Optional local workspace: share read-only persona or memory files with a site. Off by default.

PRIVACY AND SAFETY
• Your API key stays in the extension and is never given to the page.
• A site's task can use only the page tools that app names. It never gets your sidebar tools, file tools or MCP servers.
• Connecting and requesting work always need a click from you.
• No account, no analytics, no proxy. Prompts, page content and tool results go only to the AI provider you configure, under that provider's terms and charges.

FOR APP DEVELOPERS
Add BYOA to your app with the browser SDK (@byoagent/browser) or React components, and expose your app's actions as WebMCP tools. Try the Margin, Boardwalk and Piano Tutor demos in the GitHub repo.

WebMCP is an emerging web standard. BYOA includes a polyfill, so no browser flag is needed.

Source, docs and issues: https://github.com/adamgoth/bring-your-own-agent
Based on AgentBoard by Ilya Grigorik (MIT).
```

## Links and assets

- Homepage: https://github.com/adamgoth/bring-your-own-agent
- Support: https://github.com/adamgoth/bring-your-own-agent/issues
- Privacy policy: https://github.com/adamgoth/bring-your-own-agent/blob/main/byoa-extension/PRIVACY.md
- Listing video: https://www.youtube.com/watch?v=2dbfm2v9eKE
- Icon: `public/icons/icon-128.png` (also copied to `release/store-assets/icon-128.png`).
- Screenshots (1280×800), in this order. The existing `release/store-assets/byoa-provider-setup.png` and `byoa-first-run.png` show empty settings screens; replace them:
  1. Margin with the agent's proposed edit in the page, ready to accept. Caption: "Your agent works inside the app. You review every change."
  2. The Connect Agent approval window: site origin, profile picker, duration. Caption: "Approve each site and choose which agent it gets."
  3. Connected sites or budgets in Options. Caption: "Spending caps per task, per site and per day."
  4. The floating voice control with the live voice wave, on Piano Tutor. Caption: "Talk to your agent on sites that support voice."
  5. The sidebar with tool calls on any page. Caption: "A sidebar agent for any page, with your own model."
  6. Provider setup, filled in with a masked key. Caption: "OpenAI, Anthropic, Google, OpenRouter, Ollama or any compatible endpoint."
- Promotional images: `release/store-assets/byoa-store-small-440x280.png` and `release/store-assets/byoa-store-marquee-1400x560.png`. Consider rebuilding them from `brand/svg/` so they match the brand (Tangerine on the dot only).

Push the privacy policy before submitting; the public link shows whatever is on `main`.

## Single purpose

Let users bring their own AI agent to web pages: connect it to apps that support BYOA and to browser page tools through WebMCP, by text or voice.

## Permission explanations

- `storage`: Save agent/provider settings, user-selected configuration, and bounded session task transcripts.
- `tabs`: Track tab identity and URL/title context for conversations and route tool calls to their owning tab.
- `activeTab`: Capture the visible page when the page-reading tool includes visual context.
- `sidePanel`: Display the agent conversation and tool activity beside the current website.
- `offscreen`: Hosts on-device speech recognition and the microphone level meter for optional voice input, while the sidebar or a connected site's voice control is in use. Audio is not recorded, stored, or sent anywhere; only the transcript goes to the user's configured AI provider.
- `contextMenus`: Offer BYOA actions from the browser context menu.
- `scripting`: Install bundled WebMCP bridges and page-reading tools and execute user-configured page scripts.
- `webNavigation`: Detect document navigation and invalidate tools and capabilities belonging to the previous document.
- `<all_urls>`: Connect to user-configured AI/MCP endpoints and access selected pages for page tools. A small connection bridge loads on HTTPS and loopback pages so that apps integrating BYOA can request a connection; it stays inactive until the page calls BYOA's client, and no site can use the agent until the user approves that site. Access is broad because endpoint and website URLs are user-selected; file access additionally requires Chrome's explicit file-URL toggle. Website access can be restricted in Chrome's extension settings.

## Reviewer instructions

1. Install the extension and open BYOA using its toolbar action.
2. Open settings and add an agent. Select a provider preset, provide a compatible model ID and API key, and save. Provider/model access is required for live AI requests; the extension does not include a shared key.
3. For the reproducible local examples, clone the linked repository, install Node.js 22.13+ and pnpm 10.28+, then run `pnpm run setup`, `pnpm build` and `pnpm dev:demos` from the repository root.
4. Open Margin at `http://localhost:5183` or Boardwalk at `http://localhost:5184`. Reload the page after installing the extension if necessary.
5. Click Connect Agent, review the requested connection, and choose the configured agent. Try a writing action in Margin or a board action in Boardwalk; observe changes directly in the app.
6. Voice: run the Piano Tutor demo (`demos/piano-tutor`, see its README) at `http://localhost:5185`, connect, and click the floating microphone. Chrome may download an on-device language pack first.
7. Open the sidebar to inspect available tools and conversation/tool activity. A native WebMCP browser flag is not required for these demos because BYOA includes a polyfill.

Before submitting, arrange a reviewer-accessible test endpoint/key if reviewers cannot use their own provider. Enter test credentials only in the dashboard's private test instructions; never place them in this file or the ZIP.

## Dashboard checklist

- Account tab: set a Publisher display name (for example "BYOA") and a dedicated, verified contact email, so a personal address isn't shown on the listing.
- Store listing: paste the description, upload the screenshots and promo tiles, set the homepage and support URLs, and add the listing video.
- Privacy tab: add the `offscreen` justification, update the single purpose, and recheck the data-use disclosures. Voice transcripts fall under personal communications, which is already declared. Own-key operation does not mean no data is processed or transmitted to third parties.
- Remote code: the custom script feature executes user-configured JavaScript in a website's MAIN world through a Blob script. It does not use `chrome.userScripts`. Explain this accurately and assess it against the MV3 policy's isolated-context exception; do not claim that all executed code is bundled merely because model requests use an API. Policy: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements/
- Upload the ZIP, submit for review. Publishing is a separate dashboard action.
