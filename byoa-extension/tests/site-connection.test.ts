import { describe, expect, it, vi } from 'vitest';
import {
  siteOrigin,
  siteConnectionStatus,
  siteConnectionKey,
  siteProfiles,
} from '../src/background/site-connection';
import type { ConfigStorage } from '../src/lib/storage/config';
const origin = 'http://localhost:5173';
const key = siteConnectionKey(origin);
const agents = [
  { id: 'first', name: 'Deepseek', apiKey: 'SECRET', endpoint: 'PRIVATE' },
  { id: 'second', name: 'Writing agent', endpoint: 'PRIVATE' },
  { id: 'empty', name: 'Unfinished' },
];
function config() {
  return {
    getAgents: vi.fn().mockResolvedValue(agents),
    getDefaultAgent: vi.fn().mockResolvedValue(agents[0]),
  } as unknown as ConfigStorage;
}
function stored(value: unknown) {
  vi.mocked(
    chrome.storage.session.get as (key: string) => Promise<Record<string, unknown>>
  ).mockResolvedValue({ [key]: value });
}

describe('site profile choice', () => {
  it('lists all profiles, including incomplete and single-profile configurations, without secrets', async () => {
    const storage = config();
    const result = await siteProfiles(storage);
    expect(result).toEqual({
      profiles: [
        { id: 'first', name: 'Deepseek', ready: true },
        { id: 'second', name: 'Writing agent', ready: true },
        { id: 'empty', name: 'Unfinished', ready: false },
      ],
      defaultAgentId: 'first',
    });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE|apiKey|endpoint/);
    vi.mocked(storage.getAgents).mockResolvedValue([agents[0]] as never);
    expect((await siteProfiles(storage)).profiles).toEqual([
      { id: 'first', name: 'Deepseek', ready: true },
    ]);
  });
  it('reports the explicitly chosen profile rather than the default', async () => {
    stored({ agentId: 'second' });
    expect(await siteConnectionStatus(config(), origin)).toEqual({
      available: true,
      configured: true,
      connected: true,
      agentId: 'second',
      agentName: 'Writing agent',
    });
    stored(false);
    expect(await siteConnectionStatus(config(), origin)).toEqual({
      available: true,
      configured: true,
      connected: false,
    });
  });
  it('refuses legacy, removed, or unconfigured grants', async () => {
    for (const grant of [true, { agentId: 'missing' }, { agentId: 'empty' }]) {
      stored(grant);
      expect((await siteConnectionStatus(config(), origin)).connected).toBe(false);
    }
  });
  it('keeps connections isolated by origin', async () => {
    stored({ agentId: 'second' });
    expect((await siteConnectionStatus(config(), origin)).connected).toBe(true);
    expect((await siteConnectionStatus(config(), 'http://localhost:5174')).connected).toBe(false);
  });
  it('restricts messages to top-level demo origins', () => {
    for (const url of ['http://localhost:5173/', 'http://localhost:5174/'])
      expect(siteOrigin({ tab: { id: 7 }, frameId: 0, url } as chrome.runtime.MessageSender)).toBe(
        new URL(url).origin
      );
    for (const sender of [
      { tab: { id: 7 }, frameId: 1, url: origin },
      { frameId: 0, url: origin },
      { tab: { id: 7 }, frameId: 0, url: 'https://example.com' },
    ])
      expect(siteOrigin(sender as chrome.runtime.MessageSender)).toBeUndefined();
  });
});
