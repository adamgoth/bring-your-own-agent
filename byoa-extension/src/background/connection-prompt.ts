import { IndexedDBMemoryBindingRepository } from '../lib/memory/bindings';
import { readSiteGrant, writeSiteGrant, validatePersistence } from '../lib/site-grant';
const bindings = new IndexedDBMemoryBindingRepository();
import type { ConfigStorage } from '../lib/storage/config';
import { siteConnectionStatus, siteOrigin, siteProfiles } from './site-connection';

type Prompt = {
  id: string;
  origin: string;
  tabId: number;
  documentId: string;
  expires: number;
  windowId?: number;
  state: 'pending' | 'approved' | 'cancelled';
};
const prefix = 'byoa_connect_prompt_';
const page = 'src/connect/index.html';
let operations = Promise.resolve();
function serialize<T>(run: () => Promise<T>): Promise<T> {
  const next = operations.then(run);
  operations = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}
async function read(id: unknown): Promise<Prompt> {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
    throw new Error('Invalid connection request.');
  const result = (await chrome.storage.session.get(prefix + id))[prefix + id] as Prompt | undefined;
  if (!result) throw new Error('This connection request is no longer available.');
  return result;
}
const save = (prompt: Prompt) => chrome.storage.session.set({ [prefix + prompt.id]: prompt });
async function current(prompt: Prompt) {
  const [tab, frame] = await Promise.all([
    chrome.tabs.get(prompt.tabId),
    chrome.webNavigation.getFrame({ tabId: prompt.tabId, frameId: 0 }),
  ]);
  if (
    !tab.url ||
    new URL(tab.url).origin !== prompt.origin ||
    frame?.documentId !== prompt.documentId
  )
    throw new Error('The requesting page changed. Connect again from the app.');
  return tab;
}
function popupSender(prompt: Prompt, sender: chrome.runtime.MessageSender) {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL(`${page}#${prompt.id}`)
  )
    throw new Error('Only the BYOA connection window can approve this request.');
}
export function openConnectionPrompt(sender: chrome.runtime.MessageSender) {
  return serialize(async () => {
    const origin = siteOrigin(sender);
    if (!origin || sender.tab?.id === undefined || !sender.documentId)
      throw new Error('Invalid requesting page.');
    const stored = await chrome.storage.session.get(null);
    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith(prefix)) continue;
      const old = value as Prompt;
      if (old.expires < Date.now()) {
        await chrome.storage.session.remove(key);
        if (old.windowId) void chrome.windows.remove(old.windowId).catch(() => undefined);
      } else if (
        old.state === 'pending' &&
        old.tabId === sender.tab.id &&
        old.documentId === sender.documentId &&
        old.windowId
      ) {
        try {
          await chrome.windows.update(old.windowId, { focused: true });
          return { requestId: old.id };
        } catch {
          await chrome.storage.session.remove(key);
        }
      }
    }
    const prompt: Prompt = {
      id: globalThis.crypto.randomUUID(),
      origin,
      tabId: sender.tab.id,
      documentId: sender.documentId,
      expires: Date.now() + 180000,
      state: 'pending',
    };
    await current(prompt);
    await save(prompt);
    try {
      const popup = await chrome.windows.create({
        url: chrome.runtime.getURL(`${page}#${prompt.id}`),
        type: 'popup',
        width: 440,
        height: 700,
        focused: true,
      });
      prompt.windowId = popup.id;
      await save(prompt);
      return { requestId: prompt.id };
    } catch {
      await chrome.storage.session.remove(prefix + prompt.id);
      throw new Error('Could not open BYOA. Try connecting again.');
    }
  });
}
export async function connectionPromptResult(
  id: unknown,
  sender: chrome.runtime.MessageSender,
  config: ConfigStorage
) {
  const prompt = await read(id);
  if (
    siteOrigin(sender) !== prompt.origin ||
    sender.tab?.id !== prompt.tabId ||
    sender.documentId !== prompt.documentId
  )
    throw new Error('This connection request belongs to another page.');
  if (prompt.expires < Date.now()) {
    await chrome.storage.session.remove(prefix + prompt.id);
    if (prompt.windowId) void chrome.windows.remove(prompt.windowId).catch(() => undefined);
    throw new Error('Connection request expired. Connect again.');
  }
  if (prompt.state === 'pending') return { pending: true };
  await chrome.storage.session.remove(prefix + prompt.id);
  if (prompt.state !== 'approved') throw new Error('Connection cancelled.');
  const tab = await current(prompt);
  return {
    pending: false,
    connection: await siteConnectionStatus(config, prompt.origin, tab.incognito),
  };
}
export async function getConnectionPrompt(
  id: unknown,
  sender: chrome.runtime.MessageSender,
  config: ConfigStorage
) {
  const prompt = await read(id);
  popupSender(prompt, sender);
  if (prompt.state !== 'pending' || prompt.expires < Date.now())
    throw new Error('This connection request has ended.');
  const tab = await current(prompt);
  const [profiles, connection] = await Promise.all([
    siteProfiles(config),
    siteConnectionStatus(config, prompt.origin, tab.incognito),
  ]);
  const [mounted, grant] = await Promise.all([
    bindings.list().catch(() => []),
    readSiteGrant(prompt.origin, tab.incognito),
  ]);
  return {
    origin: prompt.origin,
    ...profiles,
    profiles: profiles.profiles.map((profile) => ({
      ...profile,
      hasWorkspace: mounted.some((binding) => binding.agentId === profile.id),
    })),
    incognito: tab.incognito === true,
    budget: grant?.budget,
    persist: grant?.persist ?? 'session',
    selectedAgentId: connection.agentId,
    share: grant?.agentId === connection.agentId ? grant?.share : undefined,
  };
}
export function decideConnectionPrompt(
  id: unknown,
  agentId: unknown,
  approve: boolean,
  sender: chrome.runtime.MessageSender,
  config: ConfigStorage,
  share?: unknown,
  persist?: unknown,
  budget?: unknown
) {
  return serialize(async () => {
    const prompt = await read(id);
    popupSender(prompt, sender);
    if (prompt.state !== 'pending' || prompt.expires < Date.now())
      throw new Error('This connection request has ended.');
    if (approve) {
      const tab = await current(prompt);
      const duration = validatePersistence(persist);
      const agent = typeof agentId === 'string' ? await config.getAgent(agentId) : null;
      if (!agent || !(agent.apiKey || agent.endpoint))
        throw new Error('Choose a profile that is ready to connect.');
      const binding = await bindings.get(agent.id).catch(() => undefined);
      await writeSiteGrant(
        prompt.origin,
        agent.id,
        binding ? share : undefined,
        tab.incognito ? 'session' : duration,
        tab.incognito === true,
        budget
      );
    }
    prompt.state = approve ? 'approved' : 'cancelled';
    await save(prompt);
    return { success: true };
  });
}
export function closeConnectionPrompt(windowId: number) {
  return serialize(async () => {
    const stored = await chrome.storage.session.get(null);
    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith(prefix)) continue;
      const prompt = value as Prompt;
      if (prompt.windowId === windowId && prompt.state === 'pending') {
        prompt.state = 'cancelled';
        await save(prompt);
      }
    }
  });
}
