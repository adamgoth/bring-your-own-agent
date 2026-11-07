/** Experimental page client. Tool definitions and execution remain owned by WebMCP. */
export type Connection = {
  available: boolean;
  configured: boolean;
  connected: boolean;
  agentId?: string;
  agentName?: string;
  error?: string;
};
export type Profile = { id: string; name: string; ready: boolean };
export type ProfileList = { profiles: Profile[]; defaultAgentId?: string };
export type TaskEvent = {
  taskId: string;
  status: 'queued' | 'working' | 'done' | 'cancelled' | 'error';
  detail: string;
  busy: boolean;
};
export type AgentTask = {
  id: string;
  events: AsyncIterable<TaskEvent>;
  cancel(): void;
  openChat(): Promise<void>;
};
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
    else request.reject(new Error(data.error || 'BYOA request failed.'));
  } else if (data.kind === 'status') {
    connection = data.value;
    for (const listener of statusListeners) listener(connection);
  } else if (data.kind === 'task') {
    taskSinks.get(data.id)?.(data.event);
  }
});
function call<T>(method: string, params = {}, timeout = 5000): Promise<T> {
  const id = globalThis.crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error('BYOA is unavailable. Enable the extension and reload this page.'));
    }, timeout);
    waiting.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    post(id, method, params);
  });
}
async function update(method: string, params = {}) {
  const result = await call<Connection>(method, params);
  connection = result;
  for (const listener of statusListeners) listener(connection);
  return result;
}
export const agentboard = {
  async getStatus(): Promise<Connection> {
    try {
      return await update('status');
    } catch {
      return disconnected;
    }
  },
  async connect(): Promise<Connection> {
    const { requestId } = await call<{ requestId: string }>('connect');
    const deadline = Date.now() + 185000;
    while (Date.now() < deadline) {
      const result = await call<{ pending: boolean; connection?: Connection }>('connectionResult', {
        requestId,
      });
      if (!result.pending && result.connection) {
        connection = result.connection;
        for (const listener of statusListeners) listener(connection);
        return connection;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Connection request expired. Connect again.');
  },
  disconnect: () => update('disconnect'),
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
  }: {
    prompt: string;
    tools: readonly string[];
    signal?: AbortSignal;
  }): Promise<AgentTask> {
    if (signal?.aborted) return Promise.reject(signal.reason || new Error('Cancelled.'));
    const requestId = globalThis.crypto.randomUUID();
    const buffer: TaskEvent[] = [];
    let wake: (() => void) | undefined;
    let terminal = false;
    let acknowledged = false;
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
      post(requestId, 'request', { prompt, tools });
    });
  },
};
