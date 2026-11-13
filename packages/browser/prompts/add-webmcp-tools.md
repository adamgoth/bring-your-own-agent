# Expose app capabilities through WebMCP

Use this when an app has no suitable WebMCP tools yet. [add-byoa.md](add-byoa.md) sends you here from its Step 2 after the person approves a tool inventory; you can also follow it on its own. It only creates tools: the BYOA connection UI and requests are add-byoa.md's job.

Inspect the repository's instructions, app state, authorization, routing and tests before editing.

## How tools reach the agent

WebMCP tools are named functions registered on the page's `modelContext`. BYOA reads the registered definitions and calls `execute` when the agent uses a tool. The BYOA SDK does not register tools or provide WebMCP itself: the browser's native implementation or the BYOA extension's polyfill provides `modelContext`. Depending on the browser it appears as `document.modelContext` or `navigator.modelContext`, so look for both:

```ts
type ModelContext = {
  registerTool(tool: unknown, options?: { signal?: AbortSignal }): Promise<unknown> | void;
  unregisterTool?(name: string): void;
};
const modelContext = (): ModelContext | undefined =>
  (document as { modelContext?: ModelContext }).modelContext ??
  (navigator as { modelContext?: ModelContext }).modelContext;

/** Registers the workflow's tools. Returns a cleanup function, or null when WebMCP is unavailable. */
export async function registerAppTools(app: AppServices) {
  const context = modelContext();
  if (!context?.registerTool) return null; // Manual features keep working without BYOA.
  const controller = new AbortController();
  const names: string[] = [];
  for (const tool of [
    {
      name: 'get_selection',
      description: 'Read the passage the user has selected, with its ID. Call this first.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => ({
        content: [{ type: 'text', text: JSON.stringify(app.currentSelection()) }],
      }),
    },
    {
      name: 'propose_replacement',
      description: 'Propose replacement text for a selection. The user reviews and accepts it.',
      inputSchema: {
        type: 'object',
        properties: {
          selectionId: { type: 'string' },
          replacement: { type: 'string', maxLength: 4000 },
          reason: { type: 'string', maxLength: 300 },
        },
        required: ['selectionId', 'replacement'],
        additionalProperties: false,
      },
      execute: async (args: { selectionId: string; replacement: string; reason?: string }) => {
        // Validate again here: schemas and descriptions are not enforcement.
        const result = app.createProposal(args); // checks permissions, IDs, limits, revisions
        return result.ok
          ? { content: [{ type: 'text', text: `Proposal ${result.id} is waiting for the user's review.` }] }
          : { isError: true, content: [{ type: 'text', text: result.error }] };
      },
    },
  ]) {
    await context.registerTool(tool, { signal: controller.signal });
    names.push(tool.name);
  }
  return () => {
    controller.abort();
    for (const name of names) {
      try { context.unregisterTool?.(name); } catch { /* Already removed by abort. */ }
    }
  };
}
```

`app.currentSelection()` and `app.createProposal()` stand for the app's own services. Worked examples: Margin's [tools.ts](https://github.com/adamgoth/bring-your-own-agent/blob/main/demos/margin/src/tools.ts) (document selection, proposals, comments) and Boardwalk's [tools.ts](https://github.com/adamgoth/bring-your-own-agent/blob/main/demos/boardwalk/src/tools.ts) (board snapshot and a reviewable batch of card changes).

## Rules

1. **Inventory.** Start from the inventory the person approved, or propose one: bounded reads plus explicit actions for one useful workflow. Use stable identifiers and precise names and descriptions; the agent chooses tools by their descriptions. Say what data leaves the app through tool definitions and results (it goes to the person's model provider). Never expose credentials or unrelated private state.
2. **Authorization.** Implement tools against existing app services and authorization checks. Validate arguments again in `execute`: permissions, identifiers, limits and business rules. Return bounded, relevant data. Return `{ isError: true, content: [...] }` with a short message on failure instead of throwing.
3. **Review.** For changes the person should approve, store a proposal promptly and return; the app's own UI accepts or rejects it. Never block a running tool waiting for a human. Check revisions before acceptance, reject stale proposals after manual edits, keep undo where appropriate, and handle duplicate calls. Destructive or financial actions keep the app's explicit authorization step.
4. **Lifecycle.** Register only once the state the tools need is ready, and await registration; expose that readiness to the request UI. Abort or unregister when the owning route or view goes away, and when replacing tools. In React, register in an effect with cleanup so StrictMode doesn't leave duplicates. If `modelContext` is unavailable, leave the app fully usable manually.
5. **Tests.** Call each tool's `execute` directly with fake data: schema failures, unauthorized calls, missing objects, duplicate calls, stale revisions, proposal acceptance and rejection, and registration cleanup. Never trigger real payments, messages or destructive operations to verify tooling.
6. **Handoff.** Report each tool's exact name, schema, read or write classification, where registration completes, how it is cleaned up, its authorization and review behavior, and where its results appear. If you came from add-byoa.md, return to its Step 3; otherwise point the person to add-byoa.md for the connection UI and requests.
