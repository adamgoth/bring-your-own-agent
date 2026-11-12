/** Page client for the request-only Agent Provider protocol. Safe to import during SSR. */
import type { AgentTask, Connection, TaskEvent, TaskSummary } from './types.js';
import {
  discoverProviders,
  ProviderError,
  type AgentProvider,
  type ProviderDetail,
} from './provider.js';
export * from './types.js';
export * from './provider.js';
const disconnected: Connection = { available: false, configured: false, connected: false };
const retryable = (event: TaskEvent) => event.code === 'timeout' || event.code === 'interrupted';

export function createClient(provider?: AgentProvider) {
  let selected = provider;
  let selecting: Promise<AgentProvider> | undefined;
  let connection = disconnected;
  let latestTask: TaskEvent | null = null;
  let attached = false;
  let disposed = false;
  let discoveryController: AbortController | undefined;
  const assertOpen = () => {
    if (disposed) throw new ProviderError(4900, 'Client disposed. Create a new client.');
  };
  const statuses = new Set<(value: Connection) => void>();
  const taskListeners = new Set<(value: TaskEvent | null) => void>();
  const sinks = new Set<(value: TaskEvent) => void>();
  const status = (value: unknown) => {
    connection = value as Connection;
    for (const listener of statuses) {
      try {
        listener(connection);
      } catch {
        /* Isolate subscribers. */
      }
    }
  };
  const task = (value: unknown) => {
    const event = value as TaskEvent;
    latestTask = event;
    for (const listener of taskListeners) {
      try {
        listener(event);
      } catch {
        /* Isolate subscribers. */
      }
    }
    for (const sink of sinks) sink(event);
  };
  const attach = (p: AgentProvider) => {
    assertOpen();
    if (!attached) {
      p.on('connectionChanged', status);
      p.on('task', task);
      attached = true;
    }
    return p;
  };
  const getProvider = (): Promise<AgentProvider> => {
    assertOpen();
    if (selected) return Promise.resolve(attach(selected));
    if (!selecting) {
      discoveryController = new AbortController();
      selecting = discoverProviders({ signal: discoveryController.signal })
        .then((found) => {
          if (!found.length)
            throw new ProviderError(
              4900,
              'No agent provider found. Enable the extension and reload.'
            );
          selected = found[0].provider;
          return attach(selected);
        })
        .finally(() => {
          selecting = undefined;
          discoveryController = undefined;
        });
    }
    return selecting;
  };
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const p = await getProvider();
    assertOpen();
    return p.request({ method, params }) as Promise<T>;
  };
  const client = {
    providers: (options?: Parameters<typeof discoverProviders>[0]): Promise<ProviderDetail[]> =>
      discoverProviders(options),
    async getStatus(): Promise<Connection> {
      try {
        const result = await call<Connection>('agent_status');
        status(result);
        return result;
      } catch {
        return disconnected;
      }
    },
    async connect(): Promise<Connection> {
      const result = await call<Connection>('agent_connect');
      status(result);
      return result;
    },
    async disconnect(): Promise<Connection> {
      const result = await call<Connection>('agent_disconnect');
      status(result);
      return result;
    },
    configureVoice: (options: {
      enabled: boolean;
      tools?: readonly string[];
      instructions?: string;
    }) => call<void>('agent_configureVoice', options),
    openSettings: () => call<void>('agent_openSettings'),
    openChat: (taskId?: string) => call<void>('agent_openChat', { taskId }),
    async getTask(taskId: string): Promise<TaskSummary | null> {
      const event = await call<TaskEvent | null>('agent_getTask', { taskId });
      return event ? { ...event, retryable: retryable(event) } : null;
    },
    async listTasks(): Promise<TaskSummary[]> {
      return (await call<TaskEvent[]>('agent_listTasks')).map((event) => ({
        ...event,
        retryable: retryable(event),
      }));
    },
    subscribe(listener: (value: Connection) => void) {
      statuses.add(listener);
      listener(connection);
      return () => {
        statuses.delete(listener);
      };
    },
    subscribeTasks(listener: (value: TaskEvent | null) => void) {
      taskListeners.add(listener);
      listener(latestTask);
      return () => {
        taskListeners.delete(listener);
      };
    },
    /** Release listeners permanently. Cancel active tasks and await terminal events first. */
    dispose() {
      disposed = true;
      discoveryController?.abort(new ProviderError(4900, 'Client disposed.'));
      if (selected && attached) {
        selected.removeListener('connectionChanged', status);
        selected.removeListener('task', task);
        attached = false;
      }
      statuses.clear();
      taskListeners.clear();
    },
    async request({
      prompt,
      tools,
      signal,
      timeoutMs,
    }: {
      prompt: string;
      tools: readonly string[];
      signal?: AbortSignal;
      timeoutMs?: number;
    }): Promise<AgentTask> {
      if (signal?.aborted) throw signal.reason || new ProviderError(4001, 'Cancelled.');
      const p = await getProvider();
      assertOpen();
      if (signal?.aborted) throw signal.reason || new ProviderError(4001, 'Cancelled.');
      let id: string | undefined;
      let terminal = false;
      let last: TaskEvent | undefined;
      let wake: (() => void) | undefined;
      const early: TaskEvent[] = [];
      const buffer: TaskEvent[] = [];
      const abort = () => {
        if (id)
          void p.request({ method: 'agent_cancelTask', params: { taskId: id } }).catch(() => {});
      };
      const cleanup = () => {
        sinks.delete(receive);
        signal?.removeEventListener('abort', abort);
      };
      const receive = (event: TaskEvent) => {
        if (id === undefined) {
          early.push(event);
          return;
        }
        if (
          event.taskId !== id ||
          terminal ||
          (event.seq !== undefined && last?.seq !== undefined && event.seq <= last.seq)
        )
          return;
        last = event;
        buffer.push(event);
        if (!event.busy) {
          terminal = true;
          cleanup();
        }
        wake?.();
        wake = undefined;
      };
      sinks.add(receive);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const result = (await p.request({
          method: 'agent_requestTask',
          params: { prompt, tools, timeoutMs },
        })) as { taskId: string };
        if (typeof result?.taskId !== 'string' || !result.taskId)
          throw new ProviderError(-32603, 'Provider returned an invalid task ID.');
        id = result.taskId;
        for (const event of early) receive(event);
        if (signal?.aborted) abort();
      } catch (error) {
        cleanup();
        throw error;
      }
      return {
        id,
        get retryable() {
          return !!last && retryable(last);
        },
        cancel: abort,
        openChat: () => client.openChat(id),
        events: {
          async *[Symbol.asyncIterator]() {
            while (true) {
              if (buffer.length) {
                const next = buffer.shift();
                if (next) yield next;
              } else if (terminal) return;
              else
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
            }
          },
        },
      };
    },
  };
  return client;
}
export const byoa = createClient();
/** @deprecated Use byoa instead. */
export const agentboard = byoa;
