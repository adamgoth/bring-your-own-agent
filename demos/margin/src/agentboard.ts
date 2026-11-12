import { useEffect, useState, useSyncExternalStore } from 'react';
import { agentboard, type AgentTask, type Connection, type TaskEvent } from '../../../byoa-extension/sdk';
export { agentboard };
let activeTask: AgentTask | undefined;
let taskController: AbortController | undefined;
let requesting = false;
const recoveryKey = 'margin-agent-request';
let recovery: TaskEvent | null = null;
let recoveryAttempt = 0;
const recoveryListeners = new Set<() => void>();
const notifyRecovery = () => recoveryListeners.forEach(listener => listener());
let latestTask: TaskEvent | null = null;
const requestListeners = new Set<() => void>();
agentboard.subscribeTasks(task => { latestTask = task; });
export const isAgentBusy = () => requesting || !!latestTask?.busy;
const subscribeRequests = (listener: () => void) => { requestListeners.add(listener); return () => { requestListeners.delete(listener); }; };
const pageTools = ['get_selection', 'get_document_outline', 'find_text', 'propose_replacement', 'add_comment'];
export async function requestAgent(prompt: string, tools: readonly string[] = pageTools) {
  if (isAgentBusy()) throw new Error('An agent task is already running.');
  requesting = true;
  recoveryAttempt++;
  taskController = new AbortController();
  requestListeners.forEach(listener => listener());
  try {
    const task = await agentboard.request({ prompt, tools, signal: taskController.signal });
    activeTask = task;
    sessionStorage.setItem(recoveryKey, JSON.stringify({ id: task.id, prompt, tools }));
    recovery = null; notifyRecovery();
    let result: TaskEvent | undefined;
    for await (const event of task.events) { result = event; }
    if (result?.code === 'timeout' || result?.code === 'interrupted') { recovery = result; notifyRecovery(); }
    else sessionStorage.removeItem(recoveryKey);
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

// Lookup is read-only. A reload cannot resume a model stream or repeat proposals.
async function lookupRecovery() {
  const attempt = recoveryAttempt;
  try {
    const stored = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
    if (!stored?.id || activeTask || requesting) return;
    const summary = await agentboard.getTask(stored.id);
    if (attempt !== recoveryAttempt || activeTask || requesting) return;
    if (summary?.busy) { setTimeout(() => void lookupRecovery(), 1000); return; }
    if (summary?.retryable) { recovery = summary; notifyRecovery(); }
    else sessionStorage.removeItem(recoveryKey);
  } catch { /* Leave the request for lookup when BYOA becomes available. */ }
}
agentboard.subscribe(connection => { if (connection.available) void lookupRecovery(); });
export function useTaskRecovery() {
  return useSyncExternalStore(listener => { recoveryListeners.add(listener); return () => { recoveryListeners.delete(listener); }; }, () => recovery);
}
export async function retryRecoveredTask() {
  const stored = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
  if (!stored?.prompt || !Array.isArray(stored.tools)) return;
  recoveryAttempt++;
  return requestAgent(stored.prompt, stored.tools);
}
export function dismissRecovery() {
  recoveryAttempt++;
  recovery = null;
  sessionStorage.removeItem(recoveryKey);
  notifyRecovery();
}
