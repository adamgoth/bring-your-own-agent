import { siteConnectionKey } from '../src/lib/site-grant';
import { describe, expect, it, vi } from 'vitest';
import { siteOrigin, siteConnectionStatus, siteProfiles } from '../src/background/site-connection';
import type { ConfigStorage } from '../src/lib/storage/config';
const origin = 'http://localhost:5183';
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
    expect((await siteConnectionStatus(config(), 'http://localhost:5184')).connected).toBe(false);
  });
  it('accepts top-level HTTPS sites and loopback on any port', () => {
    for (const url of [
      'http://localhost:5183/',
      'http://localhost:5184/',
      'http://127.0.0.1:5185/app',
      'http://localhost:3000/',
      'http://localhost/',
      'https://example.com/path?q=1',
      'https://app.example.com:8443/',
      'https://localhost:5183/',
    ])
      expect(siteOrigin({ tab: { id: 7 }, frameId: 0, url } as chrome.runtime.MessageSender)).toBe(
        new URL(url).origin
      );
  });
  it('rejects subframes, non-tab senders, plain HTTP hosts, and other schemes', () => {
    for (const sender of [
      { tab: { id: 7 }, frameId: 1, url: origin },
      { tab: { id: 7 }, frameId: 1, url: 'https://example.com/' },
      { frameId: 0, url: origin },
      { tab: { id: 7 }, frameId: 0 },
      ...[
        'http://example.com/',
        'http://example.com:5183/',
        'http://127.0.0.1.example.com:5183/',
        'http://localhost.example.com/',
        'http://192.168.1.10:5183/',
        'file:///Users/me/app.html',
        'chrome-extension://abc/page.html',
        'data:text/html,hi',
        'not a url',
      ].map((url) => ({ tab: { id: 7 }, frameId: 0, url })),
    ])
      expect(siteOrigin(sender as chrome.runtime.MessageSender)).toBeUndefined();
  });
});
