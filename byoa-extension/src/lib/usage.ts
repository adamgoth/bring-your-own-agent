/** Provider-reported counts. Unknown is distinct from a reported zero. */
export interface TaskUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageKnown: boolean;
  costUsd?: number;
}
export interface TokenPrices {
  input: number;
  output: number;
}
export interface SiteBudget {
  perTaskTokens?: number;
  perDayTokens?: number;
  perDayUsd?: number;
}
export interface SpendingSettings {
  perTaskTokens: number;
  perDayTokens?: number;
  perDayUsd?: number;
}
export function positiveLimit(value: unknown, integer = true): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > Number.MAX_SAFE_INTEGER ||
    (integer && !Number.isSafeInteger(value))
  )
    throw new Error('Budget limits must be positive finite numbers (whole tokens).');
  return value;
}
export function validateBudget(value: unknown): SiteBudget {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid budget.');
  const source = value as Record<string, unknown>;
  const result: SiteBudget = {};
  for (const key of ['perTaskTokens', 'perDayTokens', 'perDayUsd'] as const)
    if (source[key] !== undefined) result[key] = positiveLimit(source[key], key !== 'perDayUsd');
  return result;
}
export function validateSpending(value: unknown): SpendingSettings {
  const budget = validateBudget(value);
  return { ...budget, perTaskTokens: budget.perTaskTokens ?? 200000 };
}
export function validatePrices(value: unknown): TokenPrices | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid prices.');
  const p = value as Record<string, unknown>;
  for (const key of ['input', 'output'])
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] < 0 || p[key] > 1e9)
      throw new Error('Prices must be finite nonnegative dollars per million tokens.');
  return { input: p.input as number, output: p.output as number };
}
export const emptyUsage = (): TaskUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  usageKnown: true,
});
export function normalizeUsage(value: unknown): TaskUsage {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const valid = (n: unknown): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const inputTokens = valid(v.inputTokens) ? v.inputTokens : 0;
  const outputTokens = valid(v.outputTokens) ? v.outputTokens : 0;
  const totalTokens = Math.max(
    valid(v.totalTokens) ? v.totalTokens : 0,
    inputTokens + outputTokens
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    usageKnown: valid(v.inputTokens) && valid(v.outputTokens),
  };
}
export function addUsage(a: TaskUsage, b: TaskUsage): TaskUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    usageKnown: a.usageKnown && b.usageKnown,
    ...(a.costUsd !== undefined && b.costUsd !== undefined
      ? { costUsd: a.costUsd + b.costUsd }
      : {}),
  };
}
/** Public projection deliberately excludes extension-private prices and costs. */
export function publicUsage(u: TaskUsage): Omit<TaskUsage, 'costUsd'> {
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    totalTokens: u.totalTokens,
    usageKnown: u.usageKnown,
  };
}
