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
          ? { content: [{ type: 'text', text: `Proposal ${result.id} is waiting for the user's review. Next: stop and tell the user it is ready. Do not propose again for this selection.` }] }
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

1. **Inventory.** Start from the inventory the person approved, or propose one: bounded reads plus explicit actions for one useful workflow. To find candidates, list every way the app's state changes today (buttons, key handlers, timers, network calls) and keep the ones a person would plausibly ask an agent to do. Name tools for the person's intent, not the internal function. Use stable identifiers and precise names and descriptions; the agent chooses tools by their descriptions. Never put a real value, or any value the agent must not guess, in a parameter description as an example: the agent will send it. Say what data leaves the app through tool definitions and results (it goes to the person's model provider). Never expose credentials or unrelated private state.
2. **Authorization.** Implement tools against existing app services and authorization checks. Validate arguments again in `execute`: permissions, identifiers, limits and business rules. Return bounded, relevant data. Return `{ isError: true, content: [...] }` with a short message on failure instead of throwing.
3. **Results.** The agent steers on the latest result more than on descriptions it read once, so put the contract there. Return the new state with every change so the agent never has to ask what happened. End each result with the next step: which tool to call, or to stop and tell the person. Name each failure plainly (nothing selected, not found, not permitted, stale revision) so the agent can explain it instead of guessing. Report only what the app itself checked: a tool never accepts the agent's account of an outcome, and anything that can be verified or scored is verified or scored by the app.
4. **Review.** For changes the person should approve, store a proposal promptly and return; the app's own UI accepts or rejects it. Never block a running tool waiting for a human. Check revisions before acceptance, reject stale proposals after manual edits, keep undo where appropriate, and handle duplicate calls. Destructive or financial actions keep the app's explicit authorization step.
5. **Lifecycle.** Register only once the state the tools need is ready, and await registration; expose that readiness to the request UI. Abort or unregister when the owning route or view goes away, and when replacing tools. In React, register in an effect with cleanup so StrictMode doesn't leave duplicates. If `modelContext` is unavailable, leave the app fully usable manually.
6. **Tests.** Call each tool's `execute` directly with fake data: schema failures, unauthorized calls, missing objects, duplicate calls, stale revisions, proposal acceptance and rejection, and registration cleanup. Also drive the tools the way a host does, not only the way your code does: register against a fake `modelContext` that captures the definitions, then call each captured `execute` with arguments that have been through `JSON.parse(JSON.stringify(...))`, and check the returned text reads correctly on its own. Never trigger real payments, messages or destructive operations to verify tooling.
7. **Handoff.** Report each tool's exact name, schema, read or write classification, where registration completes, how it is cleaned up, its authorization and review behavior, and where its results appear. Say which behavior you verified by running it and which you only reasoned about. If you came from add-byoa.md, return to its Step 3; otherwise point the person to add-byoa.md for the connection UI and requests.
