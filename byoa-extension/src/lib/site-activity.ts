import { createOperationQueue } from './operation-queue';

const key = 'byoa_site_activity';
const run = createOperationQueue('byoa-site-activity');
const maxAge = 30 * 24 * 60 * 60 * 1000;
export interface SiteActivity {
  at: number;
  origin: string;
  kind: 'connected' | 'disconnected' | 'expired' | 'task';
  agentName?: string;
  taskId?: string;
  status?: string;
  tools?: string[];
  durationMs?: number;
  usage?: import('./usage').TaskUsage;
}
// Explicit allowlist: never retain caller-supplied prompts, arguments, results or errors.
function clean(value: SiteActivity): SiteActivity {
  return {
    ...(value.usage ? { usage: value.usage } : {}),
    at: value.at,
    origin: value.origin,
    kind: value.kind,
    ...(value.agentName ? { agentName: value.agentName } : {}),
    ...(value.taskId ? { taskId: value.taskId } : {}),
    ...(value.status ? { status: value.status } : {}),
    ...(value.tools
      ? {
          tools: [...new Set(value.tools)]
            .filter((name) => /^[a-zA-Z0-9_-]{1,128}$/.test(name))
            .slice(0, 32),
        }
      : {}),
    ...(value.durationMs !== undefined ? { durationMs: value.durationMs } : {}),
  };
}
async function read() {
  const stored = (await chrome.storage.local.get(key))[key];
  return (Array.isArray(stored) ? stored : [])
    .filter(
      (entry: SiteActivity) =>
        entry &&
        Number.isFinite(entry.at) &&
        entry.at > Date.now() - maxAge &&
        entry.at <= Date.now() &&
        typeof entry.origin === 'string' &&
        ['connected', 'disconnected', 'expired', 'task'].includes(entry.kind)
    )
    .slice(-500)
    .map(clean);
}
export function listSiteActivity(origin?: string) {
  return run(async () => {
    const entries = await read();
    const stored = (await chrome.storage.local.get(key))[key];
    if (JSON.stringify(stored ?? []) !== JSON.stringify(entries))
      await chrome.storage.local.set({ [key]: entries });
    return origin ? entries.filter((entry) => entry.origin === origin) : entries;
  });
}
export function appendSiteActivity(entry: SiteActivity) {
  // Incognito activity must never persist on disk.
  if (globalThis.chrome?.extension?.inIncognitoContext) return Promise.resolve();
  return run(async () => {
    const entries = await read();
    entries.push(clean(entry));
    await chrome.storage.local.set({ [key]: entries.slice(-500) });
  });
}
export function clearSiteActivity() {
  return run(() => chrome.storage.local.remove(key));
}

export function onSiteActivityChanged(listener: () => void) {
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && key in changes) listener();
  };
  chrome.storage.onChanged.addListener(changed);
  return () => chrome.storage.onChanged.removeListener(changed);
}
