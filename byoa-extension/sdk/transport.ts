import { ProviderError } from './provider.js';
import type { Connection, TaskEvent, TaskSummary, AgentTask } from './types.js';
const retryable = (event: TaskEvent) => event.code === 'timeout' || event.code === 'interrupted';
export function createTransport(window: Window) {
  const disconnected: Connection = { available: false, configured: false, connected: false };
  const waiting = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const taskSinks = new Map<string, (event: TaskEvent) => void>();
  const statusListeners = new Set<(connection: Connection) => void>();
  const taskListeners = new Set<(event: TaskEvent) => void>();
  let connection = disconnected;
  let connectEpoch = 0;
  let latestTask: TaskEvent | null = null;
  function post(id: string, method: string, params = {}) {
    window.postMessage(
      { source: 'agentboard:page', version: 1, id, method, params },
      window.location.origin
    );
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (data?.source !== 'agentboard:extension' || data.version !== 1) return;
    if (data.kind === 'response') {
      const request = waiting.get(data.id);
      if (!request) return;
      clearTimeout(request.timer);
      waiting.delete(data.id);
      if (data.ok) request.resolve(data.value);
      else
        request.reject(
          new ProviderError(
            typeof data.code === 'number' ? data.code : 4900,
            data.error || 'BYOA request failed.'
          )
        );
    } else if (data.kind === 'status') {
      connection = data.value;
      for (const listener of statusListeners) listener(connection);
    } else if (data.kind === 'task') {
      taskSinks.get(data.id)?.(data.event);
    }
  });
  /**
   * `resend` repeats an idempotent call until answered. The extension's bridge stays silent until
   * a page first calls it and may finish loading after the app's first call, so status checks are
   * resent rather than relying on the bridge to announce itself to every site.
   */
  function call<T>(method: string, params = {}, timeout = 5000, resend = 0): Promise<T> {
    const id = globalThis.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let retry: ReturnType<typeof setInterval> | undefined;
      const timer = setTimeout(() => {
        clearInterval(retry);
        waiting.delete(id);
        reject(
          new ProviderError(4900, 'BYOA is unavailable. Enable the extension and reload this page.')
        );
      }, timeout);
      const settle =
        <V>(done: (value: V) => void) =>
        (value: V) => {
          clearInterval(retry);
          done(value);
        };
      waiting.set(id, {
        resolve: settle((value) => resolve(value as T)),
        reject: settle(reject),
        timer,
      });
      post(id, method, params);
      if (resend > 0) retry = setInterval(() => post(id, method, params), resend);
    });
  }
  async function update(method: string, params = {}) {
    const result = await call<Connection>(method, params, 5000, method === 'status' ? 250 : 0);
    connection = result;
    for (const listener of statusListeners) listener(connection);
    return result;
  }
  const agentboard = {
    async getTask(taskId: string): Promise<TaskSummary | null> {
      const event = await call<TaskEvent | null>('task', { taskId });
      return event ? { ...event, retryable: retryable(event) } : null;
    },
    async listTasks(): Promise<TaskSummary[]> {
      return (await call<TaskEvent[]>('tasks')).map((event) => ({
        ...event,
        retryable: retryable(event),
      }));
    },
    async getStatus(): Promise<Connection> {
      try {
        return await update('status');
      } catch {
        return disconnected;
      }
    },
    async connect(): Promise<Connection> {
      const epoch = ++connectEpoch;
      const { requestId } = await call<{ requestId: string }>('connect');
      const deadline = Date.now() + 185000;
      while (Date.now() < deadline && epoch === connectEpoch) {
        const result = await call<{ pending: boolean; connection?: Connection }>(
          'connectionResult',
          {
            requestId,
          }
        );
        if (epoch !== connectEpoch) break;
        if (!result.pending && result.connection) {
          connection = result.connection;
          for (const listener of statusListeners) listener(connection);
          return connection;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new ProviderError(
        4001,
        epoch !== connectEpoch
          ? 'Connection request cancelled.'
          : 'Connection request expired. Connect again.'
      );
    },
    disconnect: () => {
      connectEpoch++;
      return update('disconnect');
    },
    openSettings: () => call<void>('settings'),
    openChat: (taskId?: string) => call<void>('chat', { taskId }),
    subscribe(listener: (value: Connection) => void) {
      statusListeners.add(listener);
      listener(connection);
      return () => {
        statusListeners.delete(listener);
      };
    },
    subscribeTasks(listener: (value: TaskEvent | null) => void) {
      taskListeners.add(listener);
      listener(latestTask);
      return () => {
        taskListeners.delete(listener);
      };
    },
    request({
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
      if (signal?.aborted) return Promise.reject(signal.reason || new Error('Cancelled.'));
      const requestId = globalThis.crypto.randomUUID();
      const buffer: TaskEvent[] = [];
      let wake: (() => void) | undefined;
      let terminal = false;
      let acknowledged = false;
      let lastEvent: TaskEvent | undefined;
      const abort = () => post(requestId, 'cancel');
      const events: AsyncIterable<TaskEvent> = {
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
      };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!acknowledged) {
            taskSinks.delete(requestId);
            signal?.removeEventListener('abort', abort);
            reject(new Error('BYOA did not start the task. Reload the extension and page.'));
          }
        }, 5000);
        taskSinks.set(requestId, (event) => {
          lastEvent = event;
          latestTask = event;
          for (const listener of taskListeners) listener(event);
          buffer.push(event);
          wake?.();
          wake = undefined;
          if (!acknowledged) {
            acknowledged = true;
            clearTimeout(timer);
            resolve({
              id: event.taskId,
              get retryable() {
                return !!lastEvent && retryable(lastEvent);
              },
              events,
              cancel: abort,
              openChat: () => agentboard.openChat(event.taskId),
            });
          }
          if (!event.busy) {
            terminal = true;
            taskSinks.delete(requestId);
            signal?.removeEventListener('abort', abort);
          }
        });
        signal?.addEventListener('abort', abort, { once: true });
        post(requestId, 'request', { prompt, tools, timeoutMs });
      });
    },
  };

  return agentboard;
}
