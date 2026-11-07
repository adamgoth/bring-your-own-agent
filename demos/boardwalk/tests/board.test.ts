import { describe, expect, it } from "vitest";
import { BoardStore, restore, seed } from "../src/board";
import { createTools } from "../src/tools";

describe("board review workflow", () => {
  it("leaves cards untouched until the user accepts a valid batch, then supports undo", () => {
    const store = new BoardStore();
    const original = structuredClone(store.state.cards);
    const { proposalId } = store.propose(
      1,
      [
        { op: "move", cardId: "onboarding", columnId: "ready" },
        {
          op: "create",
          title: "Map the onboarding steps",
          columnId: "backlog",
        },
      ],
      "Break the work into small steps.",
    );
    expect(store.state.cards).toEqual(original);
    store.accept(proposalId);
    expect(store.state.cards.find((c) => c.id === "onboarding")?.columnId).toBe(
      "ready",
    );
    expect(store.state.cards).toHaveLength(original.length + 1);
    expect(store.state.proposals[0].status).toBe("accepted");
    store.undo();
    expect(store.state.cards).toEqual(original);
    expect(store.state.revision).toBe(3);
    expect(() => store.accept(proposalId)).toThrow("no longer pending");
  });
  it("rejects stale proposals after a manual change, including after undo", () => {
    const store = new BoardStore();
    const { proposalId } = store.propose(
      1,
      [{ op: "update", cardId: "onboarding", title: "Agent title" }],
      "Clearer title.",
    );
    store.change([
      { op: "update", cardId: "onboarding", title: "My new title" },
    ]);
    expect(() => store.accept(proposalId)).toThrow("board changed");
    expect(store.state.cards.find((c) => c.id === "onboarding")?.title).toBe(
      "My new title",
    );
    store.undo();
    expect(() => store.accept(proposalId)).toThrow("board changed");
    expect(() =>
      store.propose(1, [{ op: "create", title: "Old snapshot" }], "Stale"),
    ).toThrow("board changed");
  });
  it("validates the entire batch before changing any card", () => {
    const store = new BoardStore();
    const before = structuredClone(store.state);
    expect(() =>
      store.change([
        { op: "update", cardId: "onboarding", title: "Should not stick" },
        { op: "move", cardId: "missing", columnId: "done" },
      ]),
    ).toThrow("no longer exists");
    expect(store.state).toEqual(before);
    expect(store.canUndo).toBe(false);
    expect(() =>
      store.propose(
        1,
        [
          {
            op: "move",
            cardId: "onboarding",
            columnId: "done",
            title: "Hidden edit",
          },
        ],
        "No",
      ),
    ).toThrow("only changes");
  });
  it("returns tool errors as tool results and only creates reviewable proposals", async () => {
    const store = new BoardStore();
    store.toggle("onboarding");
    const tools = createTools(store);
    const selection = await tools[1].execute({});
    expect(
      JSON.parse(selection.content[0].text).cards.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual(["onboarding"]);
    const result = await tools[2].execute({
      revision: 1,
      reason: "Next step",
      changes: [{ op: "create", title: "Review onboarding" }],
    });
    expect(JSON.parse(result.content[0].text).status).toBe("pending");
    expect(store.state.cards).toEqual(seed.cards);
    const error = await tools[2].execute({
      revision: 99,
      reason: "Wrong snapshot",
      changes: [{ op: "create", title: "Invalid" }],
    });
    expect(error).toHaveProperty("isError", true);
    expect(store.state.proposals).toHaveLength(1);
  });
  it("restores accepted state without resurrecting session proposals or duplicate IDs", () => {
    const store = new BoardStore();
    store.propose(1, [{ op: "create", title: "Pending" }], "Session only");
    const restored = restore(JSON.stringify(store.state));
    expect(restored.cards).toEqual(seed.cards);
    expect(restored.proposals).toEqual([]);
    expect(() =>
      restore(
        JSON.stringify({ ...seed, cards: [seed.cards[0], seed.cards[0]] }),
      ),
    ).toThrow("Duplicate");
  });
  it("reviews deletion and column changes together, with complete undo", () => {
    const store = new BoardStore();
    store.toggle("onboarding");
    const { proposalId } = store.propose(
      1,
      [
        { op: "create_column", columnId: "next-week", name: "Next week" },
        { op: "move", cardId: "permissions", columnId: "next-week" },
        { op: "rename_column", columnId: "ready", name: "Up next" },
        { op: "delete", cardId: "onboarding" },
      ],
      "Reorganize the board.",
    );
    expect(store.state.columns).toEqual(seed.columns);
    expect(store.state.cards).toEqual(seed.cards);
    store.accept(proposalId);
    expect(store.state.columns.at(-1)?.name).toBe("Next week");
    expect(store.state.columns.find((c) => c.id === "ready")?.name).toBe(
      "Up next",
    );
    expect(
      store.state.cards.find((c) => c.id === "permissions")?.columnId,
    ).toBe("next-week");
    expect(store.state.cards.some((c) => c.id === "onboarding")).toBe(false);
    expect(store.selected.size).toBe(0);
    expect(restore(JSON.stringify(store.state)).columns).toEqual(
      store.state.columns,
    );
    store.undo();
    expect(store.state.columns).toEqual(seed.columns);
    expect(store.state.cards).toEqual(seed.cards);
    expect([...store.selected]).toEqual(["onboarding"]);
  });
  it("validates column references, duplicate names, and delete ordering atomically", () => {
    const store = new BoardStore();
    for (const changes of [
      [{ op: "create_column", columnId: "ready", name: "Duplicate ID" }],
      [{ op: "create_column", columnId: "new", name: " READY " }],
      [{ op: "rename_column", columnId: "missing", name: "Unknown" }],
      [{ op: "rename_column", columnId: "ready", name: "Backlog" }],
      [{ op: "delete", cardId: "onboarding", title: "Unexpected" }],
      [
        { op: "delete", cardId: "onboarding" },
        { op: "update", cardId: "onboarding", title: "Already deleted" },
      ],
      [
        { op: "move", cardId: "onboarding", columnId: "later" },
        { op: "create_column", columnId: "later", name: "Later" },
      ],
      [
        { op: "create_column", columnId: "later", name: "Later" },
        { op: "delete", cardId: "missing" },
      ],
    ]) {
      expect(() => store.propose(1, changes, "Invalid batch")).toThrow();
      expect(store.state).toEqual(seed);
    }
  });
  it("blocks stale deletions and column renames after a manual edit", () => {
    const store = new BoardStore();
    const { proposalId } = store.propose(
      1,
      [
        { op: "delete", cardId: "onboarding" },
        { op: "rename_column", columnId: "ready", name: "Up next" },
      ],
      "Cleanup",
    );
    store.change([
      { op: "update", cardId: "onboarding", title: "Keep my work" },
    ]);
    expect(() => store.accept(proposalId)).toThrow("board changed");
    expect(store.state.cards.find((c) => c.id === "onboarding")?.title).toBe(
      "Keep my work",
    );
    expect(store.state.columns).toEqual(seed.columns);
  });
  it("migrates earlier saved boards and rejects orphaned cards or duplicate columns", () => {
    const { columns: _columns, ...oldBoard } = seed;
    expect(restore(JSON.stringify(oldBoard)).columns).toEqual(seed.columns);
    expect(() =>
      restore(
        JSON.stringify({
          ...seed,
          columns: [...seed.columns, seed.columns[0]],
        }),
      ),
    ).toThrow();
    expect(() =>
      restore(
        JSON.stringify({
          ...seed,
          cards: [{ ...seed.cards[0], columnId: "missing" }],
        }),
      ),
    ).toThrow("Unknown column");
  });
  it("exposes dynamic columns and all new operations through the proposal tool", async () => {
    const store = new BoardStore();
    const tools = createTools(store);
    const result = await tools[2].execute({
      revision: 1,
      reason: "Organize",
      changes: [
        { op: "create_column", columnId: "later", name: "Later" },
        { op: "rename_column", columnId: "ready", name: "Up next" },
        { op: "delete", cardId: "onboarding" },
      ],
    });
    store.accept(JSON.parse(result.content[0].text).proposalId);
    const snapshot = JSON.parse((await tools[0].execute({})).content[0].text);
    expect(
      snapshot.columns.some(
        (c: { id: string; name: string }) =>
          c.id === "later" && c.name === "Later",
      ),
    ).toBe(true);
    expect(
      snapshot.columns.find((c: { id: string }) => c.id === "ready").name,
    ).toBe("Up next");
    expect(
      snapshot.cards.some((c: { id: string }) => c.id === "onboarding"),
    ).toBe(false);
  });
});
