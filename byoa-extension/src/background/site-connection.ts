import type { ConfigStorage } from '../lib/storage/config';

// Local prototype allowlist, not app-specific behavior. Hosted origins require explicit approval.
export const DEMO_ORIGINS = new Set([
  'http://localhost:5183',
  'http://localhost:5184',
  'http://127.0.0.1:5183',
  'http://127.0.0.1:5184',
]);
export const siteConnectionKey = (origin: string) => `agentboard_connection_${origin}`;
export function siteOrigin(sender: chrome.runtime.MessageSender): string | undefined {
  if (sender.tab?.id === undefined || sender.frameId !== 0 || !sender.url) return;
  try {
    const origin = new URL(sender.url).origin;
    return DEMO_ORIGINS.has(origin) ? origin : undefined;
  } catch {
    return;
  }
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
