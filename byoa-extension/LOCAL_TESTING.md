# Local BYOA testing

Build and test the BYOA extension in `byoa-extension/`. See the [root README](../README.md) for project setup and [attribution](../PROVENANCE.md) for the AgentBoard credit.

## Build and load

Run these commands from the repository root:

```sh
cd byoa-extension
pnpm run check
pnpm run build
```

Load `byoa-extension/dist` using **Load unpacked** at `chrome://extensions`. After rebuilding, reload BYOA there, then reload the demo tabs. The extension needs no development server. Release packaging requires a clean annotated Git tag.

Margin runs at `http://localhost:5183/` and Boardwalk at `http://localhost:5184/`. The equivalent `127.0.0.1` URLs also support BYOA; approve each exact origin separately. Do not start another server if those ports are occupied. Current app setup commands are in the [root README](../README.md).

## Connect and try the demos

Configure a profile in BYOA Settings. Each app's **Connect agent** action calls `agentboard.connect()` and opens BYOA's private approval window. That window shows the requesting origin and all profiles, even a single profile. Approve the desired profile there. Apps never enumerate profiles or receive credentials. Cancellation leaves existing grants intact; grants are scoped per origin and browser session.

In Margin, highlight sample text, choose an editing action, enter an instruction, and press **Send**. In Boardwalk, select a card, choose **Ask agent**, enter an instruction, and press **Send**. Review proposals in the app. Tasks run in the background; **View agent chat** explicitly opens the transcript. Disconnect cancels that origin's tasks. See [sdk/README.md](../packages/browser/README.md) for lifecycle and capability limits.

## Browser verification

Use disposable browser profiles and a loopback dummy provider, never saved credentials. With both demo servers running and the extension built:

```sh
CHROME_FOR_TESTING_BIN='/path/to/Chrome for Testing' pnpm test:browser:apps:built
```

The tracked harness exercises approval, profile switching, both apps' WebMCP scopes, proposals, cancellation, per-origin revocation, and transcript viewing. Other built suites are documented in [tests/browser/README.md](tests/browser/README.md). Old `AGENTBOARD_*` test environment variables remain supported technical identifiers.

To verify the numeric loopback hostname as well:

```sh
BYOA_DEMO_HOST=127.0.0.1 CHROME_FOR_TESTING_BIN='/path/to/Chrome for Testing' pnpm test:browser:apps:built
```

Browser tests use temporary profiles and dummy providers. They cover site approval, profile switching, tool scoping, in-app review, cancellation, and optional transcripts. They do not test real provider credentials or automatically approve consequential actions on live websites.

## Dependency notes

The `@ai-sdk/provider-utils@3.0.44>undici` override is intentionally scoped to that dependency's Node transport. Browser and extension execution use native fetch. Reassess the override when upgrading the provider SDK; avoid applying blanket major-version overrides to the dependency tree.
