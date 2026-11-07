import { useEffect, useState } from 'react';
import { agentboard, type AgentTask, type Connection, type TaskEvent } from '../../../byoa-extension/sdk';
export { agentboard };
let activeTask: AgentTask | undefined;
const pageTools = ['get_selection', 'get_document_outline', 'find_text', 'propose_replacement', 'add_comment'];
export async function requestAgent(prompt: string) {
  const task = await agentboard.request({ prompt, tools: pageTools });
  activeTask = task;
  for await (const _event of task.events) { /* Progress is shared with the app via subscribeTasks. */ }
  if (activeTask === task) activeTask = undefined;
}
export const cancelAgent = () => activeTask?.cancel();
export function useAgentBoardTask() {
  const [task, setTask] = useState<TaskEvent | null>(null);
  useEffect(() => agentboard.subscribeTasks(setTask), []);
  return task;
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
