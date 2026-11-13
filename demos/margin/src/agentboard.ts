import { useSyncExternalStore } from 'react';
import { byoa as agentboard, createAgentSession, type TaskEvent } from '@byoagent/browser';
import { useConnection, useAgentTask } from '@byoagent/react';
export { agentboard };
export const agentSession = createAgentSession(agentboard);
const recoveryKey = 'margin-agent-request';
let recovery: TaskEvent | null = null;
let recoveryAttempt = 0;
const recoveryListeners = new Set<() => void>();
const notifyRecovery = () => recoveryListeners.forEach(listener => listener());
export const isAgentBusy = () => { const state = agentSession.getSnapshot(); return state.pending || !!state.task?.busy; };
const pageTools = ['get_selection', 'get_document_outline', 'find_text', 'propose_replacement', 'add_comment'];
export async function requestAgent(prompt: string, tools: readonly string[] = pageTools) {
  if (isAgentBusy()) throw new Error('An agent task is already running.');
  recoveryAttempt++;
  // Recovery inputs stay app-owned; the shared package never stores prompts.
  let savedId = '';
  const unsubscribe = agentSession.subscribe(() => {
    const { activeTaskId, pending } = agentSession.getSnapshot();
    if (pending && activeTaskId && activeTaskId !== savedId) {
      savedId = activeTaskId;
      sessionStorage.setItem(recoveryKey, JSON.stringify({ id: activeTaskId, prompt, tools }));
      recovery = null; notifyRecovery();
    }
  });
  try {
    const result = await agentSession.run({ prompt, tools });
    if (result?.code === 'timeout' || result?.code === 'interrupted') { recovery = result; notifyRecovery(); }
    else sessionStorage.removeItem(recoveryKey);
    return result;
  } finally { unsubscribe(); }
}
export const cancelAgent = agentSession.cancel;
export function useAgentBoardTask() {
  const { task, pending } = useAgentTask();
  return pending && !task?.busy ? { taskId: '', status: 'queued' as const, detail: 'Starting agent…', busy: true } : task;
}
export function useAgentBoardConnection() { return useConnection().connection; }

// Lookup is read-only. A reload cannot resume a model stream or repeat proposals.
async function lookupRecovery() {
  const attempt = recoveryAttempt;
  try {
    const stored = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
    if (!stored?.id || isAgentBusy()) return;
    const summary = await agentboard.getTask(stored.id);
    if (attempt !== recoveryAttempt || isAgentBusy()) return;
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
