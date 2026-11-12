import { validateBudget, type SiteBudget } from './usage';
import { createOperationQueue } from './operation-queue';
import { appendSiteActivity } from './site-activity';

export interface SiteShare {
  persona: boolean;
  user: boolean;
  memory: boolean;
}
export type SitePersistence = 'session' | 'days30' | 'forever';
export interface SiteGrant {
  budget?: SiteBudget;
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
  let budget: SiteBudget;
  try {
    budget = validateBudget(grant.budget);
  } catch {
    return;
  }
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
    ...(Object.keys(budget).length ? { budget } : {}),
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
const privatePrefix = `${prefix}incognito_`;
const privateContext = () => globalThis.chrome?.extension?.inIncognitoContext === true;
export const siteConnectionKey = (origin: string, incognito = false) =>
  `${incognito ? privatePrefix : prefix}${origin}`;
function keyContext(key: string) {
  if (key.startsWith(privatePrefix))
    return { origin: key.slice(privatePrefix.length), incognito: true };
  if (key.startsWith(prefix)) return { origin: key.slice(prefix.length), incognito: false };
  return undefined;
}
const run = createOperationQueue('byoa-site-grants');
async function read(origin: string, incognito = false): Promise<SiteGrant | undefined> {
  const key = siteConnectionKey(origin, incognito);
  const areas: Array<'local' | 'session'> = incognito ? ['session'] : ['local', 'session'];
  for (const area of areas) {
    const grant = validateSiteGrant((await chrome.storage[area].get(key))[key]);
    if (
      !grant ||
      !!grant.incognito !== incognito ||
      (area === 'local' && grant.persist === 'session')
    )
      continue;
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
export function readSiteGrant(origin: string, incognito = privateContext()) {
  return run(() => read(origin, incognito));
}
export function writeSiteGrant(
  origin: string,
  agentId: string,
  share?: unknown,
  duration?: unknown,
  incognito = privateContext(),
  budget?: unknown
) {
  return run(async () => {
    const requested = validatePersistence(duration);
    const persist = incognito ? 'session' : requested;
    const now = Date.now();
    const grant = validateSiteGrant({
      agentId,
      budget: validateBudget(budget),
      share,
      persist,
      createdAt: now,
      ...(incognito ? { incognito: true } : {}),
      ...(persist === 'days30' ? { expiresAt: now + 30 * 24 * 60 * 60 * 1000 } : {}),
    });
    if (!grant) throw new Error('Invalid site grant.');
    const area = persist === 'session' ? 'session' : 'local';
    const key = siteConnectionKey(origin, incognito);
    await chrome.storage[area].set({ [key]: grant });
    if (!incognito) await chrome.storage[area === 'local' ? 'session' : 'local'].remove(key);
    if (!incognito) await appendSiteActivity({ at: now, origin, kind: 'connected' });
  });
}
async function revoke(origin: string, incognito = false) {
  const key = siteConnectionKey(origin, incognito);
  if (!incognito) await chrome.storage.local.remove(key);
  await chrome.storage.session.set({ [key]: false });
  // Caller context is authoritative even if the grant never existed or was already removed.
  if (!incognito) await appendSiteActivity({ at: Date.now(), origin, kind: 'disconnected' });
}
export function revokeSiteGrant(origin: string, incognito = privateContext()) {
  return run(() => revoke(origin, incognito));
}
async function list() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.storage.session.get(null),
  ]);
  const keys = new Set([...Object.keys(local), ...Object.keys(session)]);
  const result: Array<{ origin: string; grant: SiteGrant }> = [];
  for (const key of keys) {
    const context = keyContext(key);
    if (!context) continue;
    const grant = await read(context.origin, context.incognito);
    if (grant) result.push({ origin: context.origin, grant });
  }
  return result;
}
export function listGrants() {
  return run(list);
}
export function revokeGrantsForAgent(agentId: string) {
  return run(async () => {
    for (const entry of await list())
      if (entry.grant.agentId === agentId)
        await revoke(entry.origin, entry.grant.incognito === true);
  });
}
export function touchGrant(origin: string, incognito = privateContext()) {
  return run(async () => {
    const grant = await read(origin, incognito);
    if (grant)
      await chrome.storage[grant.persist === 'session' ? 'session' : 'local'].set({
        [siteConnectionKey(origin, incognito)]: { ...grant, lastUsedAt: Date.now() },
      });
  });
}
/** Resolve both areas after a mutation, including moves between session and local storage. */
export function onGrantChanged(
  listener: (origin: string, grant: SiteGrant | undefined, incognito: boolean) => void,
  options: { signalOnly?: boolean } = {}
) {
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' && area !== 'session') return;
    for (const key of Object.keys(changes)) {
      const context = keyContext(key);
      if (!context) continue;
      const { origin, incognito } = context;
      // Content scripts only request a status refresh from the worker. They must not
      // read session grants or perform lazy expiry under a page-origin Web Lock.
      if (options.signalOnly) {
        listener(origin, undefined, incognito);
        continue;
      }
      void readSiteGrant(origin, incognito).then(
        (grant) => listener(origin, grant, incognito),
        () => listener(origin, undefined, incognito)
      );
    }
  };
  chrome.storage.onChanged.addListener(changed);
  return () => chrome.storage.onChanged.removeListener(changed);
}
