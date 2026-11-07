export const columns = [
  { id: "backlog", name: "Backlog", color: "#9293a0" },
  { id: "ready", name: "Ready", color: "#aa8bdb" },
  { id: "progress", name: "In progress", color: "#e0ad57" },
  { id: "done", name: "Done", color: "#75a993" },
] as const;
export type Column = string;
export type BoardColumn = { id: string; name: string; color: string };
export type Priority = "low" | "medium" | "high" | "urgent";
export type Card = {
  id: string;
  title: string;
  description: string;
  columnId: Column;
  priority: Priority;
  labels: string[];
};
export type Change = {
  op:
    | "create"
    | "update"
    | "move"
    | "delete"
    | "create_column"
    | "rename_column";
  name?: string;
  cardId?: string;
  title?: string;
  description?: string;
  columnId?: Column;
  priority?: Priority;
  labels?: string[];
};
export type Proposal = {
  id: string;
  baseRevision: number;
  reason: string;
  changes: Change[];
  status: "pending" | "accepted" | "dismissed";
};
export type Board = {
  revision: number;
  columns: BoardColumn[];
  cards: Card[];
  proposals: Proposal[];
};
const card = (
  id: string,
  title: string,
  description: string,
  columnId: Column,
  priority: Priority,
  labels: string[],
): Card => ({ id, title, description, columnId, priority, labels });
export const seed: Board = {
  revision: 1,
  columns: structuredClone([...columns]),
  proposals: [],
  cards: [
    card(
      "customer-notes",
      "Turn customer notes into a plan",
      "Review the sample feedback, identify themes, and break the work into a few concrete next steps.",
      "backlog",
      "medium",
      ["Discovery"],
    ),
    card(
      "onboarding",
      "Make the first five minutes feel easy",
      "Map the onboarding flow. Find the confusing decisions and suggest a simpler path for new users.",
      "backlog",
      "high",
      ["Product"],
    ),
    card(
      "empty-state",
      "Give the empty state a little personality",
      "Write helpful, concise copy for a brand-new workspace. It should tell people what to do next.",
      "backlog",
      "low",
      ["Content"],
    ),
    card(
      "permissions",
      "Make agent permissions understandable",
      "Describe what connecting an agent allows, how requests work, and how to disconnect.",
      "ready",
      "high",
      ["Trust", "Product"],
    ),
    card(
      "release-notes",
      "Draft the launch checklist",
      "Prepare a practical checklist for a small demo launch: accessibility, tests, setup instructions, and sample content.",
      "ready",
      "medium",
      ["Launch"],
    ),
    card(
      "card-layout",
      "Polish the card details",
      "Tighten spacing and hierarchy. Keep task titles easy to scan and metadata quiet.",
      "progress",
      "medium",
      ["Design"],
    ),
    card(
      "review",
      "Keep people in charge of changes",
      "Agent suggestions should be reviewable. A stale suggestion must never overwrite newer work.",
      "progress",
      "high",
      ["Trust"],
    ),
    card(
      "tools",
      "Expose the board through WebMCP",
      "Let an agent read the board and propose a batch of changes without bypassing human review.",
      "done",
      "medium",
      ["Engineering"],
    ),
    card(
      "sample-board",
      "Start with a useful sample board",
      "A small, realistic project makes it easier to try the workflow without sharing private work.",
      "done",
      "low",
      ["Demo"],
    ),
  ],
};
const priorities = ["low", "medium", "high", "urgent"];
function text(
  value: unknown,
  name: string,
  max: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  )
    throw new Error(
      `${name} must be ${allowEmpty ? "a" : "a nonempty"} string of at most ${max} characters.`,
    );
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object.");
  return value as Record<string, unknown>;
}
function column(value: unknown, available: readonly BoardColumn[]): Column {
  if (!available.some((c) => c.id === value))
    throw new Error("Unknown column.");
  return value as Column;
}
function columnName(
  value: unknown,
  available: readonly BoardColumn[],
  exceptId?: string,
) {
  const name = text(value, "Column name", 80).trim();
  if (
    available.some(
      (c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new Error("A column with this name already exists.");
  return name;
}
function priority(value: unknown): Priority {
  if (!priorities.includes(String(value))) throw new Error("Unknown priority.");
  return value as Priority;
}
function labels(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 5)
    throw new Error("Use at most five labels.");
  return value.map((v) => text(v, "Label", 24));
}
function applyOne(board: Board, change: Change) {
  const { op, cardId, name, ...fields } = change;
  if (op === "create_column") {
    board.columns.push({ id: change.columnId!, name: name!, color: "#9293a0" });
  } else if (op === "rename_column") {
    board.columns.find((c) => c.id === change.columnId)!.name = name!;
  } else if (op === "delete") {
    board.cards = board.cards.filter((c) => c.id !== cardId);
  } else if (op === "create") {
    board.cards.push({
      id: crypto.randomUUID(),
      title: fields.title!,
      description: "",
      columnId: "backlog",
      priority: "medium",
      labels: [],
      ...fields,
    });
  } else Object.assign(board.cards.find((c) => c.id === cardId)!, fields);
}
export function validateChanges(board: Board, input: unknown): Change[] {
  if (!Array.isArray(input) || !input.length || input.length > 12)
    throw new Error("Propose between one and twelve changes.");
  // Validate in order against a scratch board so a batch can create a column and move cards into it.
  const scratch = structuredClone(board);
  return input.map((value) => {
    const item = object(value);
    if (
      ![
        "create",
        "update",
        "move",
        "delete",
        "create_column",
        "rename_column",
      ].includes(String(item.op))
    )
      throw new Error("Unknown change operation.");
    const op = item.op as Change["op"];
    const allowed =
      op === "create_column" || op === "rename_column"
        ? ["op", "columnId", "name"]
        : op === "delete"
          ? ["op", "cardId"]
          : op === "move"
            ? ["op", "cardId", "columnId"]
            : op === "create"
              ? ["op", "title", "description", "columnId", "priority", "labels"]
              : [
                  "op",
                  "cardId",
                  "title",
                  "description",
                  "columnId",
                  "priority",
                  "labels",
                ];
    if (Object.keys(item).some((key) => !allowed.includes(key)))
      throw new Error(
        op === "move"
          ? "A move only changes the column."
          : "Unexpected change property.",
      );
    const change: Change = { op };
    if (op === "create_column" || op === "rename_column") {
      if (op === "create_column") {
        const id = text(item.columnId, "Column ID", 64);
        if (!/^[a-z][a-z0-9_-]*$/.test(id))
          throw new Error("Use a lowercase column ID starting with a letter.");
        if (scratch.columns.some((c) => c.id === id))
          throw new Error("Column ID already exists.");
        if (scratch.columns.length >= 12)
          throw new Error("This demo supports at most 12 columns.");
        change.columnId = id;
      } else change.columnId = column(item.columnId, scratch.columns);
      change.name = columnName(
        item.name,
        scratch.columns,
        op === "rename_column" ? change.columnId : undefined,
      );
    } else {
      if (op !== "create") {
        change.cardId = text(item.cardId, "Card ID", 100);
        if (!scratch.cards.some((c) => c.id === change.cardId))
          throw new Error("Card no longer exists.");
      }
      if (item.title !== undefined)
        change.title = text(item.title, "Title", 140);
      if (item.description !== undefined)
        change.description = text(item.description, "Description", 2000, true);
      if (item.columnId !== undefined)
        change.columnId = column(item.columnId, scratch.columns);
      if (item.priority !== undefined)
        change.priority = priority(item.priority);
      if (item.labels !== undefined) change.labels = labels(item.labels);
      if (op === "create" && !change.title)
        throw new Error("New cards need a title.");
      if (op === "move" && !change.columnId)
        throw new Error("Moving a card requires a column.");
      if (op === "update" && Object.keys(change).length === 2)
        throw new Error("An update needs a changed field.");
    }
    applyOne(scratch, change);
    if (scratch.cards.length > 100)
      throw new Error("This demo supports at most 100 cards.");
    return change;
  });
}
export function applyChanges(board: Board, changes: Change[]): Board {
  const checked = validateChanges(board, changes);
  const next = {
    ...board,
    cards: structuredClone(board.cards),
    columns: structuredClone(board.columns),
    revision: board.revision + 1,
  };
  for (const change of checked) applyOne(next, change);
  return next;
}
export class BoardStore {
  state: Board;
  selected = new Set<string>();
  private history: Array<{
    cards: Card[];
    columns: BoardColumn[];
    selected: string[];
  }> = [];
  constructor(
    board: Board = seed,
    private onChange: () => void = () => {},
  ) {
    this.state = structuredClone(board);
  }
  toggle(id: string) {
    if (this.selected.has(id)) this.selected.delete(id);
    else if (this.state.cards.some((card) => card.id === id))
      this.selected.add(id);
    this.onChange();
  }
  change(changes: Change[]) {
    const next = applyChanges(this.state, changes);
    this.history.push({
      cards: this.state.cards,
      columns: this.state.columns,
      selected: [...this.selected],
    });
    this.history = this.history.slice(-10);
    this.state = next;
    this.selected = new Set(
      [...this.selected].filter((id) => next.cards.some((c) => c.id === id)),
    );
    this.onChange();
  }
  propose(revision: unknown, input: unknown, reason: unknown) {
    if (revision !== this.state.revision)
      throw new Error(
        "The board changed. Read it again before proposing changes.",
      );
    if (this.state.proposals.filter((p) => p.status === "pending").length >= 10)
      throw new Error("Review existing proposals first.");
    const proposal: Proposal = {
      id: crypto.randomUUID(),
      baseRevision: this.state.revision,
      changes: validateChanges(this.state, input),
      reason: text(reason, "Reason", 1500),
      status: "pending",
    };
    this.state.proposals.unshift(proposal);
    this.onChange();
    return {
      proposalId: proposal.id,
      status: "pending",
      message: "The user can review and accept this batch in the board.",
    };
  }
  accept(id: string) {
    const proposal = this.state.proposals.find((p) => p.id === id);
    if (!proposal || proposal.status !== "pending")
      throw new Error("This proposal is no longer pending.");
    if (proposal.baseRevision !== this.state.revision)
      throw new Error("The board changed. Ask the agent for a fresh proposal.");
    this.change(proposal.changes);
    proposal.status = "accepted";
    this.onChange();
  }
  dismiss(id: string) {
    const proposal = this.state.proposals.find((p) => p.id === id);
    if (proposal) proposal.status = "dismissed";
    this.onChange();
  }
  undo() {
    const previous = this.history.pop();
    if (!previous) return;
    this.state = {
      ...this.state,
      cards: previous.cards,
      columns: previous.columns,
      revision: this.state.revision + 1,
    };
    this.selected = new Set(previous.selected);
    this.onChange();
  }
  get canUndo() {
    return this.history.length > 0;
  }
}
export function restore(raw: string | null): Board {
  if (!raw) return structuredClone(seed);
  const value = object(JSON.parse(raw));
  if (
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !Array.isArray(value.cards) ||
    value.cards.length > 100 ||
    !Array.isArray(value.proposals)
  )
    throw new Error("Invalid saved board.");
  // Migrate boards saved before editable columns were introduced.
  const savedColumns =
    value.columns === undefined ? structuredClone([...columns]) : value.columns;
  if (
    !Array.isArray(savedColumns) ||
    !savedColumns.length ||
    savedColumns.length > 12
  )
    throw new Error("Invalid saved columns.");
  const restoredColumns: BoardColumn[] = [];
  for (const entry of savedColumns) {
    const item = object(entry);
    const id = text(item.id, "Column ID", 64);
    if (
      !/^[a-z][a-z0-9_-]*$/.test(id) ||
      restoredColumns.some((c) => c.id === id)
    )
      throw new Error("Invalid or duplicate column ID.");
    const name = columnName(item.name, restoredColumns);
    if (typeof item.color !== "string" || !/^#[0-9a-f]{6}$/i.test(item.color))
      throw new Error("Invalid column color.");
    restoredColumns.push({ id, name, color: item.color });
  }
  if (!restoredColumns.some((c) => c.id === "backlog"))
    throw new Error("Saved board needs its default Backlog column.");
  const cards = value.cards.map((value) => {
    const item = object(value);
    return {
      id: text(item.id, "Card ID", 100),
      title: text(item.title, "Title", 140),
      description: text(item.description, "Description", 2000, true),
      columnId: column(item.columnId, restoredColumns),
      priority: priority(item.priority),
      labels: labels(item.labels),
    };
  });
  if (new Set(cards.map((card) => card.id)).size !== cards.length)
    throw new Error("Duplicate card IDs.");
  // Proposals are session-only; saved documents contain accepted board state.
  return {
    revision: Number(value.revision),
    columns: restoredColumns,
    cards,
    proposals: [],
  };
}
