import { BoardStore } from "./board";
export function createTools(store: BoardStore) {
  const wrap =
    (run: (args: Record<string, unknown>) => unknown) =>
    async (args: Record<string, unknown>) => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(run(args)) }] };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    };
  const empty = { type: "object", properties: {}, additionalProperties: false };
  return [
    {
      name: "get_board_snapshot",
      description:
        "Read the kanban board, its revision, columns, and cards. Use the returned revision when proposing changes.",
      inputSchema: empty,
      annotations: { readOnlyHint: true },
      execute: wrap(() => ({
        revision: store.state.revision,
        columns: store.state.columns,
        cards: store.state.cards,
      })),
    },
    {
      name: "get_selected_cards",
      description:
        "Read the cards the user selected, along with the current board revision. An empty selection means the request concerns the whole board.",
      inputSchema: empty,
      annotations: { readOnlyHint: true },
      execute: wrap(() => ({
        revision: store.state.revision,
        cards: store.state.cards.filter((card) => store.selected.has(card.id)),
      })),
    },
    {
      name: "propose_board_changes",
      description:
        "Propose a batch of card and column changes for human review. Never applies changes directly. Read the board first and use its current revision. Create, update, move, or delete cards; create columns with a new unique ID; rename existing columns by ID. Deletions and column changes also require human acceptance. Changes run in order: a create_column can precede moves or new cards using its columnId. Column IDs stay stable when renamed.",
      inputSchema: {
        type: "object",
        properties: {
          revision: {
            type: "integer",
            minimum: 1,
            description: "Current revision returned by get_board_snapshot.",
          },
          reason: {
            type: "string",
            maxLength: 1500,
            description: "Explain the proposed batch briefly.",
          },
          changes: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                op: {
                  type: "string",
                  enum: [
                    "create",
                    "update",
                    "move",
                    "delete",
                    "create_column",
                    "rename_column",
                  ],
                },
                cardId: {
                  type: "string",
                  description:
                    "Required for update, move, and delete. Use the exact existing ID. Omit for column operations and create.",
                },
                name: {
                  type: "string",
                  minLength: 1,
                  maxLength: 80,
                  description:
                    "Required for create_column and rename_column; the column display name.",
                },
                title: { type: "string", maxLength: 140 },
                description: { type: "string", maxLength: 2000 },
                columnId: {
                  type: "string",
                  minLength: 1,
                  maxLength: 64,
                  description:
                    "Use an existing column ID from get_board_snapshot for cards or rename_column. For create_column, supply a new lowercase ID starting with a letter (letters, digits, underscores, hyphens). Later changes in the batch can use it.",
                },
                priority: {
                  type: "string",
                  enum: ["low", "medium", "high", "urgent"],
                },
                labels: {
                  type: "array",
                  maxItems: 5,
                  items: { type: "string", maxLength: 24 },
                },
              },
              required: ["op"],
              additionalProperties: false,
            },
          },
        },
        required: ["revision", "reason", "changes"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: wrap((args) => {
        if (
          Object.keys(args).some(
            (key) => !["revision", "reason", "changes"].includes(key),
          )
        )
          throw new Error("Unexpected proposal argument.");
        return store.propose(args.revision, args.changes, args.reason);
      }),
    },
  ];
}
export async function registerTools(
  store: BoardStore,
  onStatus: (status: string) => void,
) {
  const context = (
    document as Document & {
      modelContext?: {
        registerTool: (
          tool: unknown,
          options?: { signal: AbortSignal },
        ) => Promise<unknown> | void;
      };
    }
  ).modelContext;
  if (!context?.registerTool) {
    onStatus("Tools unavailable — load BYOA and reload the page.");
    return;
  }
  const controller = new AbortController();
  window.addEventListener("pagehide", () => controller.abort(), { once: true });
  try {
    for (const tool of createTools(store))
      await context.registerTool(tool, { signal: controller.signal });
    onStatus("3 page tools ready");
  } catch (error) {
    onStatus(
      error instanceof Error ? error.message : "Could not register page tools.",
    );
  }
}
