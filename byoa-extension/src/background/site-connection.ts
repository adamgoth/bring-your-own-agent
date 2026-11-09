import type { ConfigStorage } from '../lib/storage/config';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);
/**
 * Origins that may ask to connect: any HTTPS site, plus plain-HTTP loopback on any port for
 * local development. Plain HTTP elsewhere is refused because a network attacker could inject
 * the page. Being eligible grants nothing; each exact origin still needs the person's approval.
 */
export function connectableOrigin(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)))
      return url.origin;
  } catch {
    /* Not a URL. */
  }
  return undefined;
}
export const siteConnectionKey = (origin: string) => `agentboard_connection_${origin}`;
export function siteOrigin(sender: chrome.runtime.MessageSender): string | undefined {
  if (sender.tab?.id === undefined || sender.frameId !== 0 || !sender.url) return;
  return connectableOrigin(sender.url);
}
export async function siteProfiles(config: ConfigStorage) {
  const [agents, defaultAgent] = await Promise.all([config.getAgents(), config.getDefaultAgent()]);
  return {
    profiles: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      ready: !!(agent.apiKey || agent.endpoint),
    })),
    defaultAgentId: defaultAgent?.id,
  };
}
export async function siteConnectionStatus(config: ConfigStorage, origin: string) {
  const [agents, stored] = await Promise.all([
    config.getAgents(),
    chrome.storage.session.get(siteConnectionKey(origin)),
  ]);
  const grant = stored[siteConnectionKey(origin)];
  const agent =
    grant && typeof grant === 'object' && typeof grant.agentId === 'string'
      ? agents.find((agent) => agent.id === grant.agentId)
      : undefined;
  const configured = agents.some((agent) => !!(agent.apiKey || agent.endpoint));
  const connected = !!agent && !!(agent.apiKey || agent.endpoint);
  return {
    available: true,
    configured,
    connected,
    ...(connected && agent ? { agentId: agent.id, agentName: agent.name } : {}),
  };
}
