export interface SiteShare {
  persona: boolean;
  user: boolean;
  memory: boolean;
}
export interface SiteGrant {
  agentId: string;
  share: SiteShare;
}
export function validateSiteShare(value: unknown): SiteShare {
  const share = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    persona: share.persona === true,
    user: share.user === true,
    memory: share.memory === true,
  };
}
export function validateSiteGrant(value: unknown): SiteGrant | undefined {
  if (!value || typeof value !== 'object') return;
  const grant = value as Record<string, unknown>;
  if (typeof grant.agentId !== 'string' || !grant.agentId) return;
  return { agentId: grant.agentId, share: validateSiteShare(grant.share) };
}
export const siteConnectionKey = (origin: string) => `agentboard_connection_${origin}`;
export async function readSiteGrant(origin: string) {
  return validateSiteGrant(
    (await chrome.storage.session.get(siteConnectionKey(origin)))[siteConnectionKey(origin)]
  );
}
export async function writeSiteGrant(origin: string, agentId: string, share?: unknown) {
  await chrome.storage.session.set({
    [siteConnectionKey(origin)]: { agentId, share: validateSiteShare(share) },
  });
}
export async function revokeSiteGrant(origin: string) {
  await chrome.storage.session.set({ [siteConnectionKey(origin)]: false });
}
