// @vitest-environment jsdom
// The browser package has no DOM test runner; this package's jsdom setup covers
// @byoagent/browser/elements so the React and custom-element dialogs are tested side by side.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createAgentSession,
  createClient,
  type AgentProvider,
  type Connection,
} from "@byoagent/browser";
import { defineAgentElements } from "@byoagent/browser/elements";

function fixture(initial: Partial<Connection> = {}) {
  let connection: Connection = {
    available: true,
    configured: true,
    connected: false,
    ...initial,
  };
  const listeners = new Set<(value: unknown) => void>();
  let rejectConnect: ((error: Error) => void) | undefined;
  const provider: AgentProvider = {
    on: (name, listener) => {
      if (name === "connectionChanged") listeners.add(listener);
    },
    removeListener: (_name, listener) => listeners.delete(listener),
    request: vi.fn(async ({ method }) => {
      if (method === "agent_status") return connection;
      if (method === "agent_connect")
        return new Promise((_resolve, reject) => {
          rejectConnect = reject;
        });
      if (method === "agent_disconnect") {
        connection = { ...connection, connected: false };
        listeners.forEach((listener) => listener(connection));
        return connection;
      }
    }),
  };
  const session = createAgentSession(createClient(provider));
  return {
    provider,
    session,
    cancelApproval: () => rejectConnect?.(new Error("Approval was cancelled.")),
  };
}

async function mount(session: ReturnType<typeof fixture>["session"]) {
  const element = document.createElement("byoa-connection-dialog");
  element.session = session;
  document.body.append(element);
  await vi.waitFor(() =>
    expect(element.querySelector(".byoa-status")?.getAttribute("data-state")).not.toBe("detecting"),
  );
  return element;
}
const text = (element: Element) => element.textContent?.replace(/\s+/g, " ") ?? "";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  defineAgentElements();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe("<byoa-connection-dialog>", () => {
  it("registers once and is a no-op without a custom element registry", () => {
    expect(() => defineAgentElements()).not.toThrow();
    expect(customElements.get("byoa-connection-dialog")).toBeTruthy();
    const define = vi.fn();
    defineAgentElements({ get: () => undefined, define } as unknown as CustomElementRegistry);
    expect(define).toHaveBeenCalledOnce();
  });

  it("opens modally on the primary action, and Escape closes it, reports openchange and restores focus", async () => {
    const f = fixture();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const element = await mount(f.session);
    const changes: boolean[] = [];
    element.addEventListener("openchange", (event) => changes.push(event.detail.open));

    element.open = true;
    const dialog = element.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBe(element.querySelector("h2")!.id);
    expect(text(element)).toContain("No agent connected");
    expect(document.activeElement?.textContent).toBe("Connect Agent");

    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(element.open).toBe(false);
    expect(dialog.open).toBe(false);
    expect(changes).toEqual([false]);
    expect(document.activeElement).toBe(opener);
  });

  it("ignores a stale native close event that arrives after a quick reopen", async () => {
    const f = fixture();
    const element = await mount(f.session);
    const changes: boolean[] = [];
    element.addEventListener("openchange", (event) => changes.push(event.detail.open));
    element.open = true;
    element.close();
    element.show();
    const dialog = element.querySelector("dialog")!;
    // The browser delivers the first close's queued event only now.
    dialog.dispatchEvent(new Event("close"));
    expect(element.open).toBe(true);
    expect(dialog.open).toBe(true);
    expect(changes).toEqual([]);

    // Remove and reinsert while open: the same stale event must not dismiss it either.
    element.remove();
    document.body.append(element);
    dialog.dispatchEvent(new Event("close"));
    expect(element.open).toBe(true);
    expect(dialog.open).toBe(true);
  });

  it("shows waiting while BYOA asks, then the approval error, and keeps focus inside", async () => {
    const f = fixture();
    const element = await mount(f.session);
    element.open = true;
    const connect = element.querySelector<HTMLButtonElement>(".byoa-primary")!;
    connect.click();
    await vi.waitFor(() =>
      expect(f.provider.request).toHaveBeenCalledWith({ method: "agent_connect", params: undefined }),
    );
    await vi.waitFor(() => expect(text(element)).toContain("Waiting for approval"));
    expect(element.querySelector<HTMLButtonElement>(".byoa-primary")!.disabled).toBe(true);
    expect(element.contains(document.activeElement)).toBe(true);

    f.cancelApproval();
    await vi.waitFor(() =>
      expect(element.querySelector('[role="alert"]')?.textContent).toBe("Approval was cancelled."),
    );
    expect(element.querySelector(".byoa-primary")!.textContent).toBe("Connect Agent");
  });

  it("offers Change, Open sidebar, Agent settings and Disconnect when connected, with label overrides", async () => {
    const f = fixture({ connected: true, agentName: "Work agent" });
    const element = await mount(f.session);
    element.labels = { sidebar: "Show transcript" };
    element.open = true;
    expect(element.querySelector(".byoa-status-name")!.textContent).toBe("Work agent");
    expect(element.querySelector('[aria-label="Change profile"]')).toBeTruthy();
    const rows = [...element.querySelectorAll(".byoa-row")].map((row) => row.textContent);
    expect(rows).toEqual(["Show transcript", "Agent settings"]);

    element.querySelector<HTMLButtonElement>(".byoa-danger-button")!.click();
    await vi.waitFor(() => expect(text(element)).toContain("No agent connected"));
    expect(f.provider.request).toHaveBeenCalledWith({ method: "agent_disconnect", params: undefined });
  });

  it("explains a missing extension with a setup link and Check again", async () => {
    const f = fixture({ available: false });
    const element = await mount(f.session);
    element.setupUrl = "https://example.test/setup";
    expect(text(element)).toContain("BYOA isn’t available");
    const link = element.querySelector<HTMLAnchorElement>("a.byoa-primary")!;
    expect(link.href).toBe("https://example.test/setup");
    expect(link.rel).toBe("noreferrer");
    expect([...element.querySelectorAll(".byoa-row")].map((row) => row.textContent)).toEqual([
      "Check again",
    ]);
  });

  it("releases its session subscription when removed", async () => {
    const f = fixture();
    const element = await mount(f.session);
    const subscribe = vi.spyOn(f.session, "subscribe");
    element.remove();
    document.body.append(element);
    expect(subscribe).toHaveBeenCalledOnce();
  });
});
