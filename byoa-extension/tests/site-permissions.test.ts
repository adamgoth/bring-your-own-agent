import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listGrants,
  onGrantChanged,
  readSiteGrant,
  revokeGrantsForAgent,
  revokeSiteGrant,
  siteConnectionKey,
  touchGrant,
  validateSiteGrant,
  writeSiteGrant,
} from '../src/lib/site-grant';
import { appendSiteActivity, clearSiteActivity, listSiteActivity } from '../src/lib/site-activity';
import { ConfigStorage } from '../src/lib/storage/config';

let local: Record<string, unknown>;
let session: Record<string, unknown>;
const origin = 'https://example.test';
const key = siteConnectionKey(origin);
beforeEach(() => {
  local = {};
  session = {};
  for (const [area, data] of [
    ['local', local],
    ['session', session],
  ] as const) {
    vi.mocked(chrome.storage[area].get).mockImplementation(async () => ({ ...data }));
    vi.mocked(chrome.storage[area].set).mockImplementation(async (values) => {
      Object.assign(data, values);
    });
    vi.mocked(chrome.storage[area].remove).mockImplementation(async (keys) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    });
  }
});
describe('persistent permissions', () => {
  it.each(['days30', 'forever'] as const)('survives session loss for %s', async (duration) => {
    await writeSiteGrant(origin, 'a', { memory: true }, duration);
    expect(session[key]).toBeUndefined();
    for (const k of Object.keys(session)) delete session[k];
    const grant = await readSiteGrant(origin);
    expect(grant).toMatchObject({ agentId: 'a', persist: duration, share: { memory: true } });
    expect(grant?.expiresAt).toBe(
      duration === 'days30' ? grant!.createdAt + 2592000000 : undefined
    );
    await touchGrant(origin);
    expect((await listGrants())[0].grant.lastUsedAt).toEqual(expect.any(Number));
  });
  it('moves between areas without leaving a stale grant and defaults to session', async () => {
    await writeSiteGrant(origin, 'a', undefined, 'forever');
    await writeSiteGrant(origin, 'b');
    expect(local[key]).toBeUndefined();
    expect(await readSiteGrant(origin)).toMatchObject({ agentId: 'b', persist: 'session' });
    await revokeSiteGrant(origin);
    expect(await readSiteGrant(origin)).toBeUndefined();
    expect(session[key]).toBe(false);
  });
  it('expires lazily, removes stale fallback, and records expiry only once', async () => {
    local[key] = { agentId: 'a', persist: 'days30', createdAt: 1, expiresAt: Date.now() - 1 };
    session[key] = { agentId: 'old' };
    expect(await readSiteGrant(origin)).toBeUndefined();
    expect(await readSiteGrant(origin)).toBeUndefined();
    expect(local[key]).toBeUndefined();
    expect(session[key]).toBeUndefined();
    expect((await listSiteActivity()).map((e) => e.kind)).toEqual(['expired']);
  });
  it('accepts legacy grants and false tombstones, rejects invalid metadata', async () => {
    session[key] = { agentId: 'legacy' };
    expect(await readSiteGrant(origin)).toMatchObject({ persist: 'session' });
    session[key] = false;
    expect(await readSiteGrant(origin)).toBeUndefined();
    for (const value of [
      { agentId: 'a', persist: 'other' },
      { agentId: 'a', persist: 'days30', createdAt: 1 },
      { agentId: 'a', createdAt: NaN },
      { agentId: 'a', lastUsedAt: 'today' },
    ])
      expect(validateSiteGrant(value)).toBeUndefined();
    await expect(writeSiteGrant(origin, 'a', undefined, 'other')).rejects.toThrow('duration');
  });
  it.each(['local', 'session'] as const)(
    'reports resolved changes from %s and unsubscribes',
    async (area) => {
      const listener = vi.fn();
      const off = onGrantChanged(listener);
      const changed = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)![0];
      await writeSiteGrant(origin, 'a', undefined, area === 'local' ? 'forever' : 'session');
      changed({ [key]: { newValue: (area === 'local' ? local : session)[key] } }, area);
      await vi.waitFor(() =>
        expect(listener).toHaveBeenCalledWith(origin, expect.objectContaining({ agentId: 'a' }))
      );
      await revokeSiteGrant(origin);
      changed({ [key]: { newValue: undefined } }, area);
      await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(origin, undefined));
      off();
      expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(changed);
    }
  );
  it('revokes only the deleted profile across both areas', async () => {
    await writeSiteGrant(origin, 'a', undefined, 'forever');
    await writeSiteGrant('https://second.test', 'a');
    await writeSiteGrant('https://other.test', 'b');
    await revokeGrantsForAgent('a');
    expect((await listGrants()).map((e) => e.grant.agentId)).toEqual(['b']);
  });
  it('profile deletion invokes grant revocation', async () => {
    local.config = {
      schemaVersion: 2,
      agents: [
        {
          id: 'a',
          name: 'A',
          provider: 'openai',
          apiProtocol: 'openai-chat-completions',
          model: 'test',
          temperature: 0.7,
          maxSteps: 8,
        },
      ],
    };
    await writeSiteGrant(origin, 'a', undefined, 'forever');
    await new ConfigStorage().deleteAgent('a');
    expect(await listGrants()).toEqual([]);
  });
  it('forces incognito to session and does not record its origin in local activity', async () => {
    await writeSiteGrant(origin, 'a', undefined, 'forever', true);
    expect(local[key]).toBeUndefined();
    expect(await readSiteGrant(origin)).toMatchObject({ persist: 'session', incognito: true });
    await revokeSiteGrant(origin);
    expect(await listSiteActivity()).toEqual([]);
  });
});
describe('site activity', () => {
  it('serializes concurrent writes, caps 500 entries, and prunes older than 30 days', async () => {
    await Promise.all(
      Array.from({ length: 510 }, (_, i) =>
        appendSiteActivity({ at: Date.now(), origin, kind: 'task', taskId: String(i) })
      )
    );
    const entries = await listSiteActivity();
    expect(entries).toHaveLength(500);
    expect(entries[0].taskId).toBe('10');
    await appendSiteActivity({ at: Date.now() - 31 * 86400000, origin, kind: 'task' });
    expect((await listSiteActivity()).every((entry) => entry.at > Date.now() - 30 * 86400000)).toBe(
      true
    );
  });
  it('keeps tool names only and clears all activity', async () => {
    await appendSiteActivity({
      at: Date.now(),
      origin,
      kind: 'task',
      tools: ['read_page', 'read_page'],
      prompt: 'SECRET',
      arguments: { password: 'SECRET' },
      result: 'SECRET',
    } as never);
    const entries = await listSiteActivity(origin);
    expect(entries[0].tools).toEqual(['read_page']);
    expect(JSON.stringify(entries)).not.toContain('SECRET');
    await clearSiteActivity();
    expect(await listSiteActivity()).toEqual([]);
  });
});
