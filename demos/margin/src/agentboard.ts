import { useEffect, useState, useSyncExternalStore } from 'react';
import { agentboard, type AgentTask, type Connection, type TaskEvent } from '../../../byoa-extension/sdk';
export { agentboard };
let activeTask: AgentTask | undefined;
let taskController: AbortController | undefined;
let requesting = false;
let latestTask: TaskEvent | null = null;
const requestListeners = new Set<() => void>();
agentboard.subscribeTasks(task => { latestTask = task; });
export const isAgentBusy = () => requesting || !!latestTask?.busy;
const subscribeRequests = (listener: () => void) => { requestListeners.add(listener); return () => { requestListeners.delete(listener); }; };
const pageTools = ['get_selection', 'get_document_outline', 'find_text', 'propose_replacement', 'add_comment'];
export async function requestAgent(prompt: string, tools: readonly string[] = pageTools) {
  if (isAgentBusy()) throw new Error('An agent task is already running.');
  requesting = true;
  taskController = new AbortController();
  requestListeners.forEach(listener => listener());
  try {
    const task = await agentboard.request({ prompt, tools, signal: taskController.signal });
    activeTask = task;
    let result: TaskEvent | undefined;
    for await (const event of task.events) { result = event; }
    return result;
  } finally {
    activeTask = undefined;
    taskController = undefined;
    requesting = false;
    requestListeners.forEach(listener => listener());
  }
}
export const cancelAgent = () => { if (taskController) taskController.abort(); else activeTask?.cancel(); };
export function useAgentBoardTask() {
  const pending = useSyncExternalStore(subscribeRequests, () => requesting);
  const [task, setTask] = useState<TaskEvent | null>(null);
  useEffect(() => agentboard.subscribeTasks(setTask), []);
  return pending && !task?.busy ? { taskId: '', status: 'queued' as const, detail: 'Starting agent…', busy: true } : task;
}
export function useAgentBoardConnection() {
  const [connection, setConnection] = useState<Connection>({ available: false, configured: false, connected: false });
  useEffect(() => {
    const unsubscribe = agentboard.subscribe(setConnection);
    void agentboard.getStatus().then(setConnection);
    return unsubscribe;
  }, []);
  return connection;
}
