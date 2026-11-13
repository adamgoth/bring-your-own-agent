import { byoa, type AgentClient, type AgentRequest } from "./index.js";
import type { Connection, TaskEvent } from "./types.js";

export type AgentSnapshot = Readonly<{
  connection: Connection;
  detecting: boolean;
  connecting: boolean;
  pending: boolean;
  activeTaskId: string | null;
  task: TaskEvent | null;
  connectionError: string | null;
  taskError: string | null;
}>;
const initial: AgentSnapshot = {
  connection: { available: false, configured: false, connected: false },
  detecting: true,
  connecting: false,
  pending: false,
  activeTaskId: null,
  task: null,
  connectionError: null,
  taskError: null,
};

/** Shared UI state. Borrows its client; disposal never disposes that client. */
export function createAgentSession(client: AgentClient = byoa) {
  let snapshot = initial;
  let disposed = false;
  let detach: (() => void) | undefined;
  let generation = 0;
  let controller: AbortController | undefined;
  let running: Promise<TaskEvent | undefined> | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<AgentSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* One view must not break task delivery to other views. */
      }
    }
  };
  const assertOpen = () => {
    if (disposed) throw new Error("Agent session disposed.");
  };
  const fail = (field: "connectionError" | "taskError", error: unknown) =>
    update({ [field]: error instanceof Error ? error.message : String(error) });
  const refresh = async () => {
    assertOpen();
    const attempt = ++generation;
    update({ detecting: true, connectionError: null });
    try {
      const connection = await client.getStatus();
      if (!disposed && attempt === generation)
        update({ connection, detecting: false });
      return connection;
    } catch (error) {
      if (!disposed && attempt === generation) {
        fail("connectionError", error);
        update({ detecting: false });
      }
      throw error;
    }
  };
  return {
    client,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      assertOpen();
      listeners.add(listener);
      if (!detach) {
        const status = client.subscribe((connection) => update({ connection }));
        detach = () => {
          status();
        };
        void refresh().catch(() => {});
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          detach?.();
          detach = undefined;
          generation++;
        }
      };
    },
    refresh,
    async connect() {
      assertOpen();
      if (snapshot.connecting) return;
      update({ connecting: true, connectionError: null });
      try {
        const connection = await client.connect();
        update({ connection });
        return connection;
      } catch (error) {
        fail("connectionError", error);
        throw error;
      } finally {
        update({ connecting: false });
      }
    },
    async disconnect() {
      assertOpen();
      update({ connectionError: null });
      try {
        const connection = await client.disconnect();
        update({ connection });
        return connection;
      } catch (error) {
        fail("connectionError", error);
        throw error;
      }
    },
    clearConnectionError: () => update({ connectionError: null }),
    clearTaskError: () => update({ taskError: null }),
    /** Consumes the task's event iterator once and resolves with its terminal event. */
    run(options: AgentRequest): Promise<TaskEvent | undefined> {
      assertOpen();
      if (running || snapshot.pending)
        return Promise.reject(new Error("An agent task is already running."));
      controller = new AbortController();
      const current = controller;
      const abort = () => current.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      update({
        pending: true,
        activeTaskId: null,
        task: null,
        taskError: null,
      });
      running = (async () => {
        try {
          const task = await client.request({
            ...options,
            signal: current.signal,
          });
          update({ activeTaskId: task.id });
          let last: TaskEvent | undefined;
          for await (const event of task.events) {
            last = event;
            update({ task: event });
          }
          return last;
        } catch (error) {
          fail("taskError", error);
          throw error;
        } finally {
          options.signal?.removeEventListener("abort", abort);
          controller = undefined;
          running = undefined;
          update({ pending: false, activeTaskId: null });
        }
      })();
      return running;
    },
    cancel: () => controller?.abort(),
    /** Cancels owned work and awaits its terminal event. The caller still owns the client. */
    async dispose() {
      disposed = true;
      generation++;
      controller?.abort();
      detach?.();
      detach = undefined;
      listeners.clear();
      await running?.catch(() => {});
    },
  };
}
export type AgentSession = ReturnType<typeof createAgentSession>;
