/** Plain-language formatting for usage figures and times shown in settings. */

export function formatTokens(tokens: number, incomplete = false): string {
  return `${tokens.toLocaleString()}${incomplete ? '+' : ''} ${tokens === 1 ? 'token' : 'tokens'}`;
}

/**
 * Format a dollar amount. Small amounts keep enough precision to be useful; when no cost is
 * known at all the result says so instead of showing $0.
 */
export function formatUsd(usd: number | undefined, incomplete = false): string {
  if (usd === undefined || (incomplete && usd === 0)) return 'Cost unknown';
  const amount = usd === 0 ? '$0.00' : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
  return incomplete ? `${amount}+` : amount;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "10:37 AM" today, "Yesterday, 10:37 AM", otherwise a short date and time. */
export function formatWhen(at: number, now = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay(date, today)) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday, ${time}`;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The host part of an origin, for headings; falls back to the input. */
export function siteHost(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}
