import type { Connection, TaskEvent } from './types.js';
export type ProviderEvent = 'connectionChanged' | 'task';
export interface AgentProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on(event: ProviderEvent, listener: (payload: unknown) => void): void;
  removeListener(event: ProviderEvent, listener: (payload: unknown) => void): void;
}
export type ProviderInfo = { uuid: string; name: string; icon: string; rdns: string };
export type ProviderDetail = { info: ProviderInfo; provider: AgentProvider };
export class ProviderError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
export type { Connection, TaskEvent };
/** Request-only discovery. No listeners, messages, or window access until called. */
export function discoverProviders({
  timeoutMs = 200,
  signal,
}: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ProviderDetail[]> {
  if (typeof window === 'undefined') return Promise.resolve([]);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 1000)
    return Promise.reject(new RangeError('timeoutMs must be between 0 and 1000.'));
  if (signal?.aborted)
    return Promise.reject(signal.reason || new ProviderError(4001, 'Discovery cancelled.'));
  return new Promise((resolve, reject) => {
    const found: ProviderDetail[] = [];
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<ProviderDetail>).detail;
      try {
        if (
          !detail ||
          typeof detail.info?.uuid !== 'string' ||
          !detail.info.uuid ||
          typeof detail.info.name !== 'string' ||
          typeof detail.info.icon !== 'string' ||
          typeof detail.info.rdns !== 'string' ||
          typeof detail.provider?.request !== 'function' ||
          typeof detail.provider.on !== 'function' ||
          typeof detail.provider.removeListener !== 'function'
        )
          return;
        if (
          !found.some(
            (item) => item.info.uuid === detail.info.uuid || item.provider === detail.provider
          )
        )
          found.push(
            Object.freeze({ info: Object.freeze({ ...detail.info }), provider: detail.provider })
          );
      } catch {
        /* An announcement is untrusted page data. */
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(retry);
      window.removeEventListener('agent:announceProvider', announce);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(signal?.reason || new ProviderError(4001, 'Discovery cancelled.'));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(found);
    }, timeoutMs);
    window.addEventListener('agent:announceProvider', announce);
    signal?.addEventListener('abort', abort, { once: true });
    const request = () => window.dispatchEvent(new Event('agent:requestProvider'));
    const retry = setInterval(request, 50);
    request();
  });
}
