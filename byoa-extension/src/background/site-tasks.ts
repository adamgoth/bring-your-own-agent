import { publicUsage } from '../lib/usage';
import { siteChatPrefix, type SiteChat } from '../lib/site-chat';
import type { TaskEvent } from '../lib/task-event';

export type SiteTaskRecord = SiteChat & {
  tabId: number;
  documentId: string;
  incognito: boolean;
  seq: number;
  lastEvent: TaskEvent;
  startedAt?: number;
  heartbeatAt: number;
};
// All task writes, sweeps, pruning and reads share one lane. A lookup cannot overtake a finish.
let writes: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation);
  writes = result.catch(() => undefined);
  return result;
}
export function saveSiteTask(record: SiteTaskRecord) {
  const snapshot = globalThis.structuredClone(record);
  return serial(async () => {
    await chrome.storage.session.set({ [`${siteChatPrefix(record.tabId)}${record.id}`]: snapshot });
    const stored = await chrome.storage.session.get(null);
    const older = Object.entries(stored)
      .filter(([key]) => key.startsWith(siteChatPrefix(record.tabId)))
      .sort((a, b) => (b[1]?.createdAt ?? 0) - (a[1]?.createdAt ?? 0));
    // Never prune a live task, even if many refused requests are recorded beside it.
    await chrome.storage.session.remove(
      older
        .slice(10)
        .filter(([, value]) => !value.lastEvent?.busy)
        .map(([key]) => key)
    );
  });
}
export function sweepInterruptedTasks() {
  return serial(async () => {
    const stored = await chrome.storage.session.get(null);
    const updates: Record<string, SiteTaskRecord> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (!/^agentboard_chat_\d+_/.test(key) || !['queued', 'working'].includes(value?.status))
        continue;
      const lastEvent: TaskEvent = {
        ...(value.usage ? { usage: publicUsage(value.usage) } : {}),
        taskId: value.id,
        status: 'error',
        busy: false,
        seq: (value.seq ?? 0) + 1,
        code: 'interrupted',
        detail: 'BYOA restarted. Results so far remain for review. Retry from a button click.',
      };
      updates[key] = {
        ...value,
        seq: lastEvent.seq ?? 1,
        lastEvent,
        status: lastEvent.status,
        detail: lastEvent.detail,
      };
    }
    if (Object.keys(updates).length) await chrome.storage.session.set(updates);
  });
}
export function lookupSiteTasks(
  tabId: number,
  origin: string,
  incognito: boolean,
  taskId?: unknown
): Promise<TaskEvent[]> {
  return serial(async () => {
    const stored = await chrome.storage.session.get(null);
    return Object.entries(stored)
      .filter(
        ([key, value]) =>
          key.startsWith(siteChatPrefix(tabId)) &&
          value?.origin === origin &&
          (value.incognito === true) === incognito &&
          (taskId === undefined || value.id === taskId)
      )
      .sort((a, b) => (b[1]?.createdAt ?? 0) - (a[1]?.createdAt ?? 0))
      .slice(0, 10)
      .flatMap(([, value]) => {
        const event = value.lastEvent as TaskEvent | undefined;
        // Explicit projection: new transcript fields must never become public accidentally.
        return event
          ? [
              {
                ...(event.usage ? { usage: publicUsage(event.usage) } : {}),
                taskId: event.taskId,
                status: event.status,
                detail: event.detail,
                busy: event.busy,
                seq: event.seq,
                ...(event.code && { code: event.code }),
              },
            ]
          : [];
      });
  });
}
