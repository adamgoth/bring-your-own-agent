import { IndexedDBMemoryBindingRepository } from '../src/lib/memory/bindings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openConnectionPrompt,
  getConnectionPrompt,
  decideConnectionPrompt,
  connectionPromptResult,
  closeConnectionPrompt,
} from '../src/background/connection-prompt';
import { siteConnectionKey } from '../src/lib/site-grant';
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
  vi.spyOn(IndexedDBMemoryBindingRepository.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(IndexedDBMemoryBindingRepository.prototype, 'get').mockResolvedValue(undefined);
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
  it.each([
    { perTaskTokens: 0 },
    { perDayTokens: -1 },
    { perDayUsd: '1' },
    { perTaskTokens: Infinity },
  ])('rejects malformed popup budgets %j', async (budget) => {
    const { requestId } = await openConnectionPrompt(sender);
    await expect(
      decideConnectionPrompt(
        requestId,
        'one',
        true,
        popup(requestId),
        config,
        undefined,
        'session',
        budget
      )
    ).rejects.toThrow();
    expect(await connectionPromptResult(requestId, sender, config)).toMatchObject({
      pending: true,
    });
  });
  it('validates duration and calculates expiry in the extension', async () => {
    const { requestId } = await openConnectionPrompt(sender);
    await expect(
      decideConnectionPrompt(requestId, 'one', true, popup(requestId), config, undefined, 'invalid')
    ).rejects.toThrow('duration');
    const before = Date.now();
    await decideConnectionPrompt(
      requestId,
      'one',
      true,
      popup(requestId),
      config,
      undefined,
      'days30'
    );
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [siteConnectionKey(origin)]: expect.objectContaining({
        persist: 'days30',
        expiresAt: expect.any(Number),
      }),
    });
    const grant = vi
      .mocked(chrome.storage.local.set)
      .mock.calls.map(
        (call) => (call[0] as Record<string, { expiresAt: number }>)[siteConnectionKey(origin)]
      )
      .find(Boolean);
    expect(grant!.expiresAt).toBeGreaterThanOrEqual(before + 2592000000);
    expect(grant!.expiresAt).toBeLessThanOrEqual(Date.now() + 2592000000);
  });
  it('hides duration and forces session approval for incognito tabs', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 7,
      url: `${origin}/`,
      incognito: true,
    } as chrome.tabs.Tab);
    const { requestId } = await openConnectionPrompt(sender);
    expect((await getConnectionPrompt(requestId, popup(requestId), config)).incognito).toBe(true);
    await decideConnectionPrompt(
      requestId,
      'one',
      true,
      popup(requestId),
      config,
      undefined,
      'forever'
    );
    expect(data[siteConnectionKey(origin, true)]).toMatchObject({
      persist: 'session',
      incognito: true,
    });
    expect(data[siteConnectionKey(origin)]).toBeUndefined();
    expect((await connectionPromptResult(requestId, sender, config)).connection).toMatchObject({
      connected: true,
      agentId: 'one',
    });
  });

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
  it.each([false, true])('stores sharing only for a mounted profile: %s', async (mounted) => {
    if (mounted)
      vi.mocked(IndexedDBMemoryBindingRepository.prototype.get).mockResolvedValue({
        agentId: 'one',
        handle: {},
      } as never);
    const { requestId } = await openConnectionPrompt(sender);
    await decideConnectionPrompt(requestId, 'one', true, popup(requestId), config, {
      persona: true,
      user: 'true',
      memory: false,
    });
    expect(data[siteConnectionKey(origin)]).toEqual({
      agentId: 'one',
      persist: 'session',
      createdAt: expect.any(Number),
      share: { persona: mounted, user: false, memory: false },
    });
    const result = await connectionPromptResult(requestId, sender, config);
    expect(JSON.stringify(result)).not.toMatch(/share|workspace/i);
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
