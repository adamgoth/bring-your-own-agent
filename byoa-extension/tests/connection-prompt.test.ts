import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openConnectionPrompt,
  getConnectionPrompt,
  decideConnectionPrompt,
  connectionPromptResult,
  closeConnectionPrompt,
} from '../src/background/connection-prompt';
import { siteConnectionKey } from '../src/background/site-connection';
import type { ConfigStorage } from '../src/lib/storage/config';
const origin = 'http://localhost:5184';
const sender = {
  id: 'fixture',
  tab: { id: 7 },
  frameId: 0,
  documentId: 'document-one',
  url: `${origin}/`,
} as chrome.runtime.MessageSender;
const agents = [
  { id: 'one', name: 'My agent', apiKey: 'SECRET', endpoint: 'PRIVATE' },
  { id: 'empty', name: 'Needs setup' },
];
const config = {
  getAgents: vi.fn(async () => agents),
  getDefaultAgent: vi.fn(async () => agents[0]),
  getAgent: vi.fn(async (id: string) => agents.find((agent) => agent.id === id) || null),
} as unknown as ConfigStorage;
let data: Record<string, unknown>;
const popup = (id: string) =>
  ({
    id: 'fixture',
    url: `chrome-extension://fixture/src/connect/index.html#${id}`,
  }) as chrome.runtime.MessageSender;
beforeEach(() => {
  data = {};
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: {
      ...chrome.runtime,
      id: 'fixture',
      getURL: (path: string) => `chrome-extension://fixture/${path}`,
    },
    storage: {
      ...chrome.storage,
      session: {
        get: vi.fn(async (key: string | null) =>
          key === null ? { ...data } : { [key]: data[key] }
        ),
        set: vi.fn(async (value: object) => {
          Object.assign(data, value);
        }),
        remove: vi.fn(async (key: string) => {
          delete data[key];
        }),
      },
    },
    tabs: { ...chrome.tabs, get: vi.fn(async () => ({ id: 7, url: `${origin}/` })) },
    webNavigation: { getFrame: vi.fn(async () => ({ documentId: 'document-one' })) },
    windows: {
      create: vi.fn(async () => ({ id: 77 })),
      update: vi.fn(async () => ({ id: 77 })),
      remove: vi.fn(async () => {}),
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('extension-owned profile approval', () => {
  it('requires popup approval and returns only the approved connection to the page', async () => {
    const { requestId } = await openConnectionPrompt(sender);
    expect(data[siteConnectionKey(origin)]).toBeUndefined();
    expect(await connectionPromptResult(requestId, sender, config)).toEqual({ pending: true });
    const view = await getConnectionPrompt(requestId, popup(requestId), config);
    expect(view.origin).toBe(origin);
    expect(view.profiles).toHaveLength(2);
    expect(JSON.stringify(view)).not.toMatch(/SECRET|PRIVATE|apiKey|endpoint/);
    await expect(decideConnectionPrompt(requestId, 'one', true, sender, config)).rejects.toThrow(
      'Only the BYOA'
    );
    await expect(
      decideConnectionPrompt(requestId, 'empty', true, popup(requestId), config)
    ).rejects.toThrow('ready');
    expect(data[siteConnectionKey(origin)]).toBeUndefined();
    await decideConnectionPrompt(requestId, 'one', true, popup(requestId), config);
    expect(await connectionPromptResult(requestId, sender, config)).toEqual({
      pending: false,
      connection: {
        available: true,
        configured: true,
        connected: true,
        agentId: 'one',
        agentName: 'My agent',
      },
    });
  });
  it('preserves the current connection when the user cancels a profile switch', async () => {
    data[siteConnectionKey(origin)] = { agentId: 'existing' };
    const { requestId } = await openConnectionPrompt(sender);
    await decideConnectionPrompt(requestId, undefined, false, popup(requestId), config);
    await expect(connectionPromptResult(requestId, sender, config)).rejects.toThrow('cancelled');
    expect(data[siteConnectionKey(origin)]).toEqual({ agentId: 'existing' });
  });
  it('treats closing the popup as cancellation and reuses a pending request', async () => {
    const first = await openConnectionPrompt(sender);
    expect(await openConnectionPrompt(sender)).toEqual(first);
    expect(chrome.windows.create).toHaveBeenCalledOnce();
    await closeConnectionPrompt(77);
    await expect(connectionPromptResult(first.requestId, sender, config)).rejects.toThrow(
      'cancelled'
    );
    expect(data[siteConnectionKey(origin)]).toBeUndefined();
  });
  it('rejects another document or a navigation before approval', async () => {
    const { requestId } = await openConnectionPrompt(sender);
    await expect(
      connectionPromptResult(requestId, { ...sender, documentId: 'another-document' }, config)
    ).rejects.toThrow('another page');
    vi.mocked(chrome.webNavigation.getFrame).mockResolvedValue({
      documentId: 'new-document',
    } as chrome.webNavigation.GetFrameResultDetails);
    await expect(
      decideConnectionPrompt(requestId, 'one', true, popup(requestId), config)
    ).rejects.toThrow('page changed');
    expect(data[siteConnectionKey(origin)]).toBeUndefined();
  });
  it('refuses expired approvals', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { requestId } = await openConnectionPrompt(sender);
    vi.setSystemTime(Date.now() + 180001);
    await expect(
      decideConnectionPrompt(requestId, 'one', true, popup(requestId), config)
    ).rejects.toThrow('ended');
    expect(data[siteConnectionKey(origin)]).toBeUndefined();
  });
});
