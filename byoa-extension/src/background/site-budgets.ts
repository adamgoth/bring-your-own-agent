import { createOperationQueue } from '../lib/operation-queue';
import {
  type TaskUsage,
  type SiteBudget,
  type SpendingSettings,
  type TokenPrices,
} from '../lib/usage';

const run = createOperationQueue('byoa-site-budgets');
const key = 'byoa_usage_ledger';
const maxSites = 1000;
const overflow = 'overflow';
type Totals = { tokens: number; usd: number; unknown: boolean; unknownCost: boolean };
type Ledger = Record<string, Record<string, Totals>>;
const zero = (): Totals => ({ tokens: 0, usd: 0, unknown: false, unknownCost: false });
export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function resetTime(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toLocaleString();
}
async function ledger(incognito: boolean): Promise<Ledger> {
  const area = chrome.storage[incognito ? 'session' : 'local'];
  const stored = (await area.get(incognito ? `${key}_private` : key))[
    incognito ? `${key}_private` : key
  ];
  const result: Ledger = {};
  const oldest = new Date();
  oldest.setDate(oldest.getDate() - 34);
  for (const [day, entries] of Object.entries(stored ?? {})) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      day < localDay(oldest) ||
      day > localDay() ||
      !entries ||
      typeof entries !== 'object'
    )
      continue;
    result[day] = {};
    for (const [origin, raw] of Object.entries(entries)) {
      const v = raw as Totals;
      if (!v || !Number.isFinite(v.tokens) || v.tokens < 0 || !Number.isFinite(v.usd) || v.usd < 0)
        continue;
      result[day][origin] = {
        tokens: v.tokens,
        usd: v.usd,
        unknown: v.unknown === true,
        unknownCost: v.unknownCost === true,
      };
    }
  }
  return result;
}
async function save(data: Ledger, incognito: boolean) {
  await chrome.storage[incognito ? 'session' : 'local'].set({
    [incognito ? `${key}_private` : key]: data,
  });
}
export function priceUsage(
  usage: TaskUsage,
  profile: { apiKey?: string; prices?: TokenPrices }
): TaskUsage {
  return {
    ...usage,
    ...(!profile.apiKey
      ? { costUsd: 0 }
      : usage.costUsd !== undefined
        ? { costUsd: usage.costUsd }
        : profile.prices && usage.usageKnown
          ? {
              costUsd:
                (usage.inputTokens * profile.prices.input +
                  usage.outputTokens * profile.prices.output) /
                1000000,
            }
          : {}),
  };
}
export function recordUsage(origin: string, usage: TaskUsage, incognito = false) {
  return run(async () => {
    const data = await ledger(incognito);
    const day = localDay();
    const entries = data[day] ?? (data[day] = {});
    const bucket =
      Object.hasOwn(entries, origin) || Object.keys(entries).length < maxSites ? origin : overflow;
    const previous = entries[bucket] ?? zero();
    entries[bucket] = {
      tokens: previous.tokens + usage.totalTokens,
      usd: previous.usd + (usage.costUsd ?? 0),
      unknown: previous.unknown || !usage.usageKnown,
      unknownCost: previous.unknownCost || usage.costUsd === undefined,
    };
    await save(data, incognito);
  });
}
export function todayUsage(origin: string, incognito = false) {
  return run(async () => {
    const data = await ledger(incognito);
    await save(data, incognito);
    const entries = Object.values(data[localDay()] ?? {});
    return {
      capacityReached: !Object.hasOwn(data[localDay()] ?? {}, origin) && entries.length >= maxSites,
      site: data[localDay()]?.[origin] ?? zero(),
      global: entries.reduce(
        (a, b) => ({
          tokens: a.tokens + b.tokens,
          usd: a.usd + b.usd,
          unknown: a.unknown || b.unknown,
          unknownCost: a.unknownCost || b.unknownCost,
        }),
        zero()
      ),
    };
  });
}
export async function checkBudget(
  origin: string,
  budget: SiteBudget,
  settings: SpendingSettings,
  task: TaskUsage,
  incognito = false
): Promise<string | undefined> {
  const totals = await todayUsage(origin, incognito);
  if (totals.capacityReached) return `Daily accounting capacity reached. Resets ${resetTime()}.`;
  if (task.totalTokens >= (budget.perTaskTokens ?? settings.perTaskTokens))
    return 'Per-task token budget reached.';
  for (const [name, cap, used] of [
    ['Site daily token', budget.perDayTokens, totals.site.tokens],
    ['All-sites daily token', settings.perDayTokens, totals.global.tokens],
    ['Site daily dollar', budget.perDayUsd, totals.site.usd],
    ['All-sites daily dollar', settings.perDayUsd, totals.global.usd],
  ] as const)
    if (cap !== undefined && used >= cap) return `${name} budget reached. Resets ${resetTime()}.`;
  return undefined;
}
