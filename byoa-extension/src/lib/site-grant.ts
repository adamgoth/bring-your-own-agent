import { createOperationQueue } from './operation-queue';
import { appendSiteActivity } from './site-activity';

export interface SiteShare {
  persona: boolean;
  user: boolean;
  memory: boolean;
}
export type SitePersistence = 'session' | 'days30' | 'forever';
export interface SiteGrant {
  agentId: string;
  share: SiteShare;
  persist: SitePersistence;
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
  incognito?: true;
}
export function validateSiteShare(value: unknown): SiteShare {
  const share = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    persona: share.persona === true,
    user: share.user === true,
    memory: share.memory === true,
  };
}
export function validatePersistence(value: unknown): SitePersistence {
  if (value === undefined) return 'session';
  if (value === 'session' || value === 'days30' || value === 'forever') return value;
  throw new Error('Invalid connection duration.');
}
export function validateSiteGrant(value: unknown): SiteGrant | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const grant = value as Record<string, unknown>;
  if (typeof grant.agentId !== 'string' || !grant.agentId.trim()) return;
  let persist: SitePersistence;
  try {
    persist = validatePersistence(grant.persist);
  } catch {
    return;
  }
  const timestamp = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (grant.createdAt !== undefined && !timestamp(grant.createdAt)) return;
  if (grant.persist !== undefined && !timestamp(grant.createdAt)) return;
  if (grant.expiresAt !== undefined && !timestamp(grant.expiresAt)) return;
  if (persist === 'days30' && !timestamp(grant.expiresAt)) return;
  if (grant.incognito === true && persist !== 'session') return;
  if (grant.lastUsedAt !== undefined && !timestamp(grant.lastUsedAt)) return;
  return {
    agentId: grant.agentId,
    share: validateSiteShare(grant.share),
    persist,
    createdAt: (grant.createdAt as number | undefined) ?? 0,
    ...(grant.incognito === true ? { incognito: true as const } : {}),
    ...(persist === 'days30' ? { expiresAt: grant.expiresAt as number } : {}),
    ...(grant.lastUsedAt !== undefined ? { lastUsedAt: grant.lastUsedAt as number } : {}),
  };
}
const prefix = 'agentboard_connection_';
export const siteConnectionKey = (origin: string) => `${prefix}${origin}`;
const run = createOperationQueue('byoa-site-grants');
async function read(origin: string): Promise<SiteGrant | undefined> {
  const key = siteConnectionKey(origin);
  for (const area of ['local', 'session'] as const) {
    const grant = validateSiteGrant((await chrome.storage[area].get(key))[key]);
    if (!grant || (area === 'local' && grant.persist === 'session')) continue;
    if (grant.expiresAt !== undefined && grant.expiresAt <= Date.now()) {
      await chrome.storage.local.remove(key);
      await chrome.storage.session.remove(key);
      await appendSiteActivity({ at: Date.now(), origin, kind: 'expired' });
      return;
    }
    return grant;
  }
  return undefined;
}
export function readSiteGrant(origin: string) {
  return run(() => read(origin));
}
export function writeSiteGrant(
  origin: string,
  agentId: string,
  share?: unknown,
  duration?: unknown,
  incognito = false
) {
  return run(async () => {
    const requested = validatePersistence(duration);
    const persist =
      incognito || globalThis.chrome?.extension?.inIncognitoContext ? 'session' : requested;
    const now = Date.now();
    const grant = validateSiteGrant({
      agentId,
      share,
      persist,
      createdAt: now,
      ...(incognito ? { incognito: true } : {}),
      ...(persist === 'days30' ? { expiresAt: now + 30 * 24 * 60 * 60 * 1000 } : {}),
    });
    if (!grant) throw new Error('Invalid site grant.');
    const area = persist === 'session' ? 'session' : 'local';
    const key = siteConnectionKey(origin);
    await chrome.storage[area].set({ [key]: grant });
    await chrome.storage[area === 'local' ? 'session' : 'local'].remove(key);
    if (!incognito) await appendSiteActivity({ at: now, origin, kind: 'connected' });
  });
}
async function revoke(origin: string) {
  const old = await read(origin);
  const key = siteConnectionKey(origin);
  await chrome.storage.local.remove(key);
  await chrome.storage.session.set({ [key]: false });
  if (!old?.incognito) await appendSiteActivity({ at: Date.now(), origin, kind: 'disconnected' });
}
export function revokeSiteGrant(origin: string) {
  return run(() => revoke(origin));
}
async function list() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.storage.session.get(null),
  ]);
  const origins = [
    ...new Set(
      [...Object.keys(local), ...Object.keys(session)]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
    ),
  ];
  const result: Array<{ origin: string; grant: SiteGrant }> = [];
  for (const origin of origins) {
    const grant = await read(origin);
    if (grant) result.push({ origin, grant });
  }
  return result;
}
export function listGrants() {
  return run(list);
}
export function revokeGrantsForAgent(agentId: string) {
  return run(async () => {
    for (const entry of await list())
      if (entry.grant.agentId === agentId) await revoke(entry.origin);
  });
}
export function touchGrant(origin: string) {
  return run(async () => {
    const grant = await read(origin);
    if (grant)
      await chrome.storage[grant.persist === 'session' ? 'session' : 'local'].set({
        [siteConnectionKey(origin)]: { ...grant, lastUsedAt: Date.now() },
      });
  });
}
/** Resolve both areas after a mutation, including moves between session and local storage. */
export function onGrantChanged(
  listener: (origin: string, grant: SiteGrant | undefined) => void,
  options: { signalOnly?: boolean } = {}
) {
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' && area !== 'session') return;
    for (const key of Object.keys(changes)) {
      if (!key.startsWith(prefix)) continue;
      const origin = key.slice(prefix.length);
      // Content scripts only request a status refresh from the worker. They must not
      // read session grants or perform lazy expiry under a page-origin Web Lock.
      if (options.signalOnly) {
        listener(origin, undefined);
        continue;
      }
      void readSiteGrant(origin).then(
        (grant) => listener(origin, grant),
        () => listener(origin, undefined)
      );
    }
  };
  chrome.storage.onChanged.addListener(changed);
  return () => chrome.storage.onChanged.removeListener(changed);
}
