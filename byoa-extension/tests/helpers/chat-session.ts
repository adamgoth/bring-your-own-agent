import { beforeEach, afterEach, expect, vi } from 'vitest';
import { createChatSessionService } from '../../src/background/chat-session';
import {
  CHAT_SESSION_PORT,
  CHAT_SESSION_PREFIX,
  type ChatSessionSnapshot,
  type ChatSessionUpdate,
} from '../../src/lib/chat-session';
import type { AIClient, StreamCallbacks } from '../../src/lib/ai/client';
import type { ConfigStorage } from '../../src/lib/storage/config';

export let stored: Record<string, unknown>;
const cleanups: Array<() => Promise<unknown>> = [];
beforeEach(() => {
  stored = {};
  chrome.tabs.get = vi.fn().mockImplementation(async (id) => ({
    id,
    url: `https://example.test/${id}`,
    title: 'Example',
    incognito: false,
  }));
  chrome.storage.session.get = vi.fn().mockImplementation(async () => structuredClone(stored));
  chrome.storage.session.set = vi.fn().mockImplementation(async (values) => {
    Object.assign(stored, structuredClone(values));
  });
  chrome.storage.session.remove = vi.fn().mockImplementation(async (key) => {
    delete stored[key];
  });
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
export function harness(prepare = async () => {}) {
  const calls: Array<{ callbacks: StreamCallbacks; release(): void; args: unknown[] }> = [];
  const client = {
    streamChat: vi.fn().mockImplementation(
      (...args: unknown[]) =>
        new Promise<void>((resolve) => {
          calls.push({ args, callbacks: args[3] as StreamCallbacks, release: resolve });
        })
    ),
    cancelStream: vi.fn().mockImplementation((id) => {
      const call = calls.find((c) => c.args[4] === id);
      call?.release();
    }),
  };
  const config = {
    getAgent: vi
      .fn()
      .mockImplementation(async (id) => (id === 'missing' ? null : { id, name: id, maxSteps: 2 })),
  };
  const service = createChatSessionService(
    client as unknown as AIClient,
    config as unknown as ConfigStorage,
    prepare,
    () => []
  );
  const tabs = new Set<number>();
  cleanups.push(async () => {
    for (const tab of tabs) await service.removeTab(tab);
    for (const call of calls) call.release();
  });
  function connect(
    tabId = 1,
    url = `chrome-extension://test-extension-id/src/sidebar/index.html#tab=${tabId}`
  ) {
    tabs.add(tabId);
    let listener: (message: unknown) => void = () => {};
    let close: () => void = () => {};
    const updates: ChatSessionUpdate[] = [];
    const port = {
      name: CHAT_SESSION_PORT,
      sender: { id: chrome.runtime.id, url },
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
      onDisconnect: {
        addListener: (fn: typeof close) => {
          close = fn;
        },
      },
      postMessage: vi.fn((message: ChatSessionUpdate) => updates.push(structuredClone(message))),
      disconnect: vi.fn(() => close()),
    };
    service.connect(port as unknown as chrome.runtime.Port);
    const ready = () =>
      vi.waitFor(() => expect(updates.some((u) => u.type === 'snapshot')).toBe(true));
    const send = async (command: Record<string, unknown>) => {
      const requestId = crypto.randomUUID();
      listener({ ...command, requestId });
      await vi.waitFor(() =>
        expect(updates.some((u) => u.type === 'reply' && u.requestId === requestId)).toBe(true)
      );
      return updates.find((u) => u.type === 'reply' && u.requestId === requestId) as Extract<
        ChatSessionUpdate,
        { type: 'reply' }
      >;
    };
    return { port, updates, ready, send, close: () => close() };
  }
  return { service, client, calls, config, connect };
}
export const submit = (id = 'turn-1', agentId = 'a', content = 'Hello') => ({
  type: 'submit',
  id,
  agentId,
  content,
});
export async function finish(h: ReturnType<typeof harness>, index = 0, text = 'Answer') {
  h.calls[index].callbacks.onFinish(text);
  h.calls[index].release();
  await vi.waitFor(() =>
    expect((stored[`${CHAT_SESSION_PREFIX}1`] as ChatSessionSnapshot)?.turns.at(-1)?.status).toBe(
      'done'
    )
  );
}
