import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBudget,
  localDay,
  priceUsage,
  recordUsage,
  todayUsage,
} from '../src/background/site-budgets';
import {
  addUsage,
  emptyUsage,
  normalizeUsage,
  publicUsage,
  validateBudget,
  validatePrices,
  validateSpending,
} from '../src/lib/usage';

let local: Record<string, unknown>;
let session: Record<string, unknown>;
beforeEach(() => {
  local = {};
  session = {};
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 12, 23, 59));
  for (const [area, store] of [
    [chrome.storage.local, local],
    [chrome.storage.session, session],
  ] as const) {
    vi.mocked(area.get).mockImplementation(async () => structuredClone(store));
    vi.mocked(area.set).mockImplementation(async (values) => {
      Object.assign(store, structuredClone(values));
    });
  }
});
afterEach(() => vi.useRealTimers());
const usage = {
  inputTokens: 60,
  outputTokens: 40,
  totalTokens: 100,
  usageKnown: true,
  costUsd: 0.25,
};
describe('spending ledger', () => {
  it('serializes concurrent writes across sites and includes all in global totals', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => recordUsage(`https://site${i % 2}.test`, usage))
    );
    expect((await todayUsage('https://site0.test')).site.tokens).toBe(2500);
    expect((await todayUsage('https://site0.test')).global).toMatchObject({
      tokens: 5000,
      usd: 12.5,
    });
  });
  it('uses local calendar days, resets and prunes to 35 days', async () => {
    await recordUsage('https://a.test', usage);
    vi.setSystemTime(new Date(2026, 10, 13, 0, 1));
    expect((await todayUsage('https://a.test')).site.tokens).toBe(0);
    await recordUsage('https://a.test', usage);
    vi.setSystemTime(new Date(2026, 11, 18));
    await todayUsage('https://a.test');
    expect(local.byoa_usage_ledger).toEqual({});
    expect(localDay(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
  it('keeps private activity only in session and separate from regular global budgets', async () => {
    await recordUsage('https://a.test', usage, true);
    expect(local).toEqual({});
    expect((await todayUsage('https://a.test')).global.tokens).toBe(0);
    expect((await todayUsage('https://a.test', true)).global.tokens).toBe(100);
  });
  it('bounds daily sites without dropping global usage from already-running steps', async () => {
    const sites = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [`https://site${i}.test`, { tokens: 1, usd: 0 }])
    );
    local.byoa_usage_ledger = { [localDay()]: sites };
    expect(
      await checkBudget('https://new.test', {}, { perTaskTokens: 1000 }, emptyUsage())
    ).toContain('capacity');
    await recordUsage('https://in-flight.test', usage);
    expect(
      Object.keys((local.byoa_usage_ledger as Record<string, object>)[localDay()])
    ).toHaveLength(1001);
    expect((await todayUsage('https://new.test')).global.tokens).toBe(1100);
  });
  it('retains accounting after a simulated worker reload', async () => {
    await recordUsage('https://a.test', usage);
    vi.resetModules();
    const reloaded = await import('../src/background/site-budgets');
    expect((await reloaded.todayUsage('https://a.test')).site.tokens).toBe(100);
  });
  it.each([
    [{ perDayTokens: 100 }, { perTaskTokens: 1000 }],
    [{ perDayUsd: 0.25 }, { perTaskTokens: 1000 }],
    [{}, { perTaskTokens: 1000, perDayTokens: 100 }],
    [{}, { perTaskTokens: 1000, perDayUsd: 0.25 }],
  ])('checks each daily cap and combined caps', async (site, global) => {
    await recordUsage('https://a.test', usage);
    expect(await checkBudget('https://a.test', site, global, emptyUsage())).toContain('Resets');
    expect(
      await checkBudget('https://a.test', { ...site, perTaskTokens: 10 }, global, usage)
    ).toContain('Per-task');
  });
  it.each([
    [
      { perDayTokens: 100 },
      { perTaskTokens: 1000 },
      '100 tokens',
      'Daily tokens',
      'Connected sites',
    ],
    [{ perDayUsd: 0.25 }, { perTaskTokens: 1000 }, '$0.25', 'Daily dollars', 'Connected sites'],
    [
      {},
      { perTaskTokens: 1000, perDayTokens: 100 },
      '100 tokens',
      'Daily tokens',
      'App spending limits',
    ],
    [{}, { perTaskTokens: 1000, perDayUsd: 0.25 }, '$0.25', 'Daily dollars', 'App spending limits'],
  ])(
    'explains the daily limit and where to change it',
    async (site, global, limit, field, location) => {
      await recordUsage('https://a.test', usage);
      const message = await checkBudget('https://a.test', site, global, emptyUsage());
      expect(message).toContain(`(${limit})`);
      expect(message).toContain(`Update “${field}”`);
      expect(message).toContain(location);
      expect(message).toContain('Resets');
    }
  );
  it('points to the source of the effective per-task limit', async () => {
    const siteMessage = await checkBudget(
      'https://a.test',
      { perTaskTokens: 50 },
      { perTaskTokens: 100 },
      usage
    );
    expect(siteMessage).toContain('(50 tokens)');
    expect(siteMessage).toContain('Connected sites');
    const globalMessage = await checkBudget('https://a.test', {}, { perTaskTokens: 100 }, usage);
    expect(globalMessage).toContain('(100 tokens)');
    expect(globalMessage).toContain('App spending limits');
  });
  it('preserves unknown usage and unknown prices without pretending they are zero', async () => {
    const unknown = normalizeUsage({});
    expect(unknown.usageKnown).toBe(false);
    expect(normalizeUsage({ inputTokens: 0, outputTokens: 0 }).usageKnown).toBe(true);
    expect(addUsage(usage, unknown).usageKnown).toBe(false);
    await recordUsage('https://a.test', unknown);
    expect((await todayUsage('https://a.test')).site).toMatchObject({
      unknown: true,
      unknownCost: true,
    });
    expect(priceUsage(usage, { apiKey: 'fixture' }).costUsd).toBe(0.25);
    expect(
      priceUsage(normalizeUsage({ inputTokens: 60, outputTokens: 40 }), { apiKey: 'fixture' })
        .costUsd
    ).toBeUndefined();
    expect(priceUsage(usage, {}).costUsd).toBe(0);
    expect(
      priceUsage(normalizeUsage(usage), { apiKey: 'fixture', prices: { input: 2, output: 4 } })
        .costUsd
    ).toBe(0.00028);
    expect(publicUsage(usage)).not.toHaveProperty('costUsd');
  });
});
describe('budget validation', () => {
  it.each([
    null,
    [],
    false,
    { perTaskTokens: 0 },
    { perDayTokens: -1 },
    { perDayTokens: 1.5 },
    { perDayUsd: Infinity },
    { perTaskTokens: '10' },
  ])('rejects malformed limits %j', (value) => expect(() => validateBudget(value)).toThrow());
  it('migrates defaults and projects only supported fields', () => {
    expect(validateSpending(undefined)).toEqual({ perTaskTokens: 200000 });
    expect(validateBudget({ perDayUsd: 0.2, secret: 'ignored' })).toEqual({ perDayUsd: 0.2 });
    expect(() => validatePrices({ input: NaN, output: 1 })).toThrow();
    expect(validatePrices({ input: 0, output: 0 })).toEqual({ input: 0, output: 0 });
  });
});
