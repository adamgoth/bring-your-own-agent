import type { CoreMessage } from 'ai';
import type { TaskEvent } from '../lib/task-event';

/** Worker-only context, never populated from page messages. */
export interface SiteConversationContext {
  id: string;
  agentId: string;
  history: CoreMessage[];
  instructions: string;
  isCurrent(): boolean;
  validate(): Promise<boolean>;
}
/** In-memory transport for the same site executor used by page ports. No general-chat routing. */
export function createSiteTaskChannel(
  sender: chrome.runtime.MessageSender,
  emit: (event: TaskEvent) => void
) {
  const messages = new Set<(message: unknown) => void>();
  const disconnects = new Set<() => void>();
  const event = <T>(listeners: Set<T>) => ({
    addListener: (listener: T) => {
      listeners.add(listener);
    },
    removeListener: (listener: T) => {
      listeners.delete(listener);
    },
    hasListener: (listener: T) => listeners.has(listener),
    hasListeners: () => !!listeners.size,
  });
  const port = {
    name: 'agentboard-task',
    sender,
    onMessage: event(messages),
    onDisconnect: event(disconnects),
    postMessage: emit,
    disconnect: () => {
      for (const listener of disconnects) listener();
    },
  } as chrome.runtime.Port;
  return {
    port,
    send: (message: unknown) => {
      for (const listener of messages) listener(message);
    },
  };
}
