// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentSession,
  createClient,
  type AgentProvider,
  type Connection,
  type ProviderEvent,
  type TaskEvent,
} from "@byoagent/browser";
import {
  AgentProvider as ReactAgentProvider,
  AgentConnectionDialog,
  AgentIndicator,
  AgentPromptPopover,
  AgentTaskStatus,
} from "../src/index.js";

afterEach(cleanup);
function fixture() {
  const listeners = new Map<ProviderEvent, Set<(event: unknown) => void>>();
  const emit = (name: ProviderEvent, event: unknown) =>
    listeners.get(name)?.forEach((listener) => listener(event));
  let connection: Connection = {
    available: true,
    configured: true,
    connected: true,
    agentName: "My agent",
  };
  let next = 0;
  const provider: AgentProvider = {
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    request: vi.fn(async ({ method, params }) => {
      if (method === "agent_status") return connection;
      if (method === "agent_connect") return connection;
      if (method === "agent_disconnect") {
        connection = { ...connection, connected: false };
        emit("connectionChanged", connection);
        return connection;
      }
      if (method === "agent_requestTask") {
        const taskId = `task-${++next}`;
        emit("task", {
          taskId,
          status: "queued",
          busy: true,
          seq: 0,
          detail: "Queued",
        });
        return { taskId };
      }
      if (method === "agent_cancelTask") {
        emit("task", {
          taskId: (params as { taskId: string }).taskId,
          status: "cancelled",
          busy: false,
          seq: 2,
          detail: "Cancelled",
        });
      }
    }),
  };
  const client = createClient(provider);
  const session = createAgentSession(client);
  return {
    session,
    client,
    provider,
    emit,
    terminal: (code?: "timeout" | "interrupted") =>
      emit("task", {
        taskId: `task-${next}`,
        status: code ? "error" : "done",
        busy: false,
        seq: 1,
        detail: code || "Done",
        code,
      } satisfies TaskEvent),
  };
}

describe("shared session and React consumers", () => {
  it("survives StrictMode remount, shares task state, rejects duplicate submission, and consumes early/terminal events", async () => {
    const f = fixture();
    const view = render(
      <StrictMode>
        <ReactAgentProvider session={f.session}>
          <AgentIndicator />
          <AgentTaskStatus />
        </ReactAgentProvider>
      </StrictMode>,
    );
    await screen.findByText("My agent");
    let run!: Promise<TaskEvent | undefined>;
    act(() => {
      run = f.session.run({ prompt: "Summarize", tools: ["read"] });
    });
    await screen.findByText("Queued");
    expect(f.session.getSnapshot().activeTaskId).toBe("task-1");
    expect(screen.getByText("My agent · Working…")).toBeTruthy();
    await expect(
      f.session.run({ prompt: "Duplicate", tools: ["read"] }),
    ).rejects.toThrow("already running");
    act(() => f.terminal());
    await expect(run).resolves.toMatchObject({ status: "done" });
    expect(f.provider.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent_requestTask",
        params: expect.objectContaining({ tools: ["read"] }),
      }),
    );
    view.unmount();
    await expect(f.client.getStatus()).resolves.toMatchObject({
      connected: true,
    });
    await f.session.dispose();
    f.client.dispose();
  });

  it("cancels pending work on explicit disposal without disposing a borrowed client", async () => {
    const f = fixture();
    const run = f.session.run({ prompt: "Work", tools: ["read"] });
    await waitFor(() =>
      expect(f.session.getSnapshot().task?.status).toBe("queued"),
    );
    await f.session.dispose();
    await expect(run).resolves.toMatchObject({ status: "cancelled" });
    await expect(f.client.getStatus()).resolves.toMatchObject({
      connected: true,
    });
    f.client.dispose();
  });

  it("aborts before task creation without dispatching a request", async () => {
    const f = fixture();
    const run = f.session.run({ prompt: "Work", tools: ["read"] });
    const rejected = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await f.session.dispose();
    await rejected;
    expect(
      vi
        .mocked(f.provider.request)
        .mock.calls.some(([request]) => request.method === "agent_requestTask"),
    ).toBe(false);
  });

  it("retains retryable terminal states and never retries automatically", async () => {
    const f = fixture();
    const retry = vi.fn();
    render(
      <ReactAgentProvider session={f.session}>
        <AgentTaskStatus onRetry={retry} />
      </ReactAgentProvider>,
    );
    await waitFor(() => expect(f.session.getSnapshot().detecting).toBe(false));
    let run!: Promise<TaskEvent | undefined>;
    act(() => {
      run = f.session.run({ prompt: "Work", tools: ["read"] });
    });
    await screen.findByText("Queued");
    await act(async () => {
      f.terminal("interrupted");
      await run;
    });
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry request" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows Connect Agent without an extension and exposes setup/check again", async () => {
    const f = fixture();
    vi.mocked(f.provider.request).mockResolvedValue({
      available: false,
      configured: false,
      connected: false,
    });
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    render(
      <ReactAgentProvider session={f.session}>
        <AgentIndicator />
        <AgentConnectionDialog open onOpenChange={() => {}} />
      </ReactAgentProvider>,
    );
    await screen.findByText("Install or enable BYOA, then reload this page.");
    expect(screen.getByRole("button", { name: "Connect Agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("supports themed portal containers, labels, close requests, and restores focus", async () => {
    const f = fixture();
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const container = document.createElement("section");
    document.body.append(container);
    const close = vi.fn();
    const view = render(
      <ReactAgentProvider session={f.session}>
        <AgentConnectionDialog
          open
          onOpenChange={close}
          portalContainer={container}
          className="host-theme"
          labels={{ close: "Dismiss connection" }}
        />
      </ReactAgentProvider>,
    );
    const dialog = await screen.findByRole("dialog");
    expect(container.contains(dialog)).toBe(true);
    expect(dialog.classList.contains("host-theme")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss connection" }));
    expect(close).toHaveBeenCalledWith(false);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
    container.remove();
  });

  it("keeps request submission disabled until tools are ready and sends only the configured scope", async () => {
    const f = fixture();
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    const ui = (ready: boolean) => (
      <ReactAgentProvider session={f.session}>
        <AgentPromptPopover
          open
          onOpenChange={() => {}}
          tools={["read"]}
          ready={ready}
        />
      </ReactAgentProvider>
    );
    const view = render(ui(false));
    await waitFor(() => expect(f.session.getSnapshot().detecting).toBe(false));
    fireEvent.change(screen.getByLabelText("Request"), {
      target: { value: "Summarize" },
    });
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    view.rerender(ui(true));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Queued");
    expect(f.provider.request).toHaveBeenCalledWith({
      method: "agent_requestTask",
      params: { prompt: "Summarize", tools: ["read"], timeoutMs: undefined },
    });
    await act(async () => {
      f.terminal();
    });
  });
  it("keeps connection failures out of task UI and task failures out of connection UI", async () => {
    const f = fixture();
    const original = f.provider.request;
    f.provider.request = vi.fn(async (args) => {
      if (args.method === "agent_connect") throw Error("Approval cancelled");
      if (args.method === "agent_requestTask") throw Error("Request refused");
      return original(args);
    });
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    render(
      <ReactAgentProvider session={f.session}>
        <AgentConnectionDialog open onOpenChange={() => {}} />
        <AgentTaskStatus />
      </ReactAgentProvider>,
    );
    await screen.findByRole("button", { name: "Change profile" });
    fireEvent.click(screen.getByRole("button", { name: "Change profile" }));
    await screen.findByText("Approval cancelled");
    expect(
      document.querySelector('.byoa-task-status [role="alert"]'),
    ).toBeNull();
    await act(async () => {
      await f.session.run({ prompt: "Work", tools: ["read"] }).catch(() => {});
    });
    expect(
      document.querySelector('.byoa-task-status [role="alert"]')?.textContent,
    ).toBe("Request refused");
    expect(screen.getByRole("dialog").textContent).not.toContain(
      "Request refused",
    );
  });

  it("announces a rejected prompt exactly once and focuses the request input", async () => {
    const f = fixture();
    const original = f.provider.request;
    f.provider.request = vi.fn(async (args) => {
      if (args.method === "agent_requestTask") throw Error("Tool missing");
      return original(args);
    });
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    render(
      <ReactAgentProvider session={f.session}>
        <AgentPromptPopover open onOpenChange={() => {}} tools={["read"]} />
      </ReactAgentProvider>,
    );
    const input = screen.getByLabelText("Request");
    expect(document.activeElement).toBe(input);
    await waitFor(() =>
      expect(f.session.getSnapshot().connection.connected).toBe(true),
    );
    fireEvent.change(input, { target: { value: "Read" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    expect(screen.getAllByRole("alert").map((el) => el.textContent)).toEqual([
      "Tool missing",
    ]);
  });

  it("synchronizes native close events without closing a reopened StrictMode dialog", async () => {
    const f = fixture();
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    function Controls() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open controls</button>
          <AgentConnectionDialog open={open} onOpenChange={setOpen} />
        </>
      );
    }
    render(
      <StrictMode>
        <ReactAgentProvider session={f.session}>
          <Controls />
        </ReactAgentProvider>
      </StrictMode>,
    );
    fireEvent.click(screen.getByText("Open controls"));
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;
    // A queued close event from cleanup must not close an already reopened surface.
    fireEvent(dialog, new Event("close"));
    expect(screen.getByRole("dialog")).toBe(dialog);
    dialog.open = false;
    fireEvent(dialog, new Event("close"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Open controls"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("uses the supplied focus fallback when the original opener disappears", () => {
    const f = fixture();
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const fallback = document.createElement("button");
    document.body.append(fallback);
    const ref = createRef<HTMLElement>();
    ref.current = fallback;
    const view = render(
      <ReactAgentProvider session={f.session}>
        <AgentConnectionDialog
          open
          returnFocusRef={ref}
          onOpenChange={() => {}}
        />
      </ReactAgentProvider>,
    );
    opener.remove();
    view.unmount();
    expect(document.activeElement).toBe(fallback);
    fallback.remove();
  });
});
