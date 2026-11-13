import { sidebarSessionTab } from './chat-session';
import type { CoreMessage } from 'ai';
import { parseSiteVoice, type SiteVoiceOptions } from '../lib/site-voice';
import { readSiteGrant, onGrantChanged } from '../lib/site-grant';
import { siteOrigin, siteConnectionStatus } from './site-connection';
import { getToolRegistry } from '../lib/webmcp/tool-registry';
import { createSiteTaskChannel, type SiteConversationContext } from './site-task-channel';
import { lookupSiteTasks, type SiteTaskRecord } from './site-tasks';
import { siteChatPrefix } from '../lib/site-chat';
import type { ConfigStorage } from '../lib/storage/config';
import { createVoiceOwner } from './voice-owner';

export function setupSiteVoice(options: {
  config: ConfigStorage;
  execute(port: chrome.runtime.Port, context?: SiteConversationContext): void;
  prepare(tabId: number): Promise<unknown>;
  open(tabId: number, taskId?: string): Promise<void>;
}) {
  const voice = createVoiceOwner();
  const enabled = async () => (await options.config.get()).voiceMode === true;
  type Binding = {
    sender: chrome.runtime.MessageSender;
    tabId: number;
    documentId: string;
    origin: string;
    incognito: boolean;
    agentId: string;
    grant: string;
    policy: SiteVoiceOptions;
    id: string;
    history: CoreMessage[];
    widget?: chrome.runtime.Port;
    taskId?: string;
    busy: boolean;
    submissionEpoch: number;
    unwatch?: () => void;
    channel?: ReturnType<typeof createSiteTaskChannel>;
  };
  const grantKey = (grant: Awaited<ReturnType<typeof readSiteGrant>>) => {
    if (!grant) return '';
    const { lastUsedAt: _ignored, ...authority } = grant;
    return JSON.stringify(authority);
  };
  const bindings = new Map<number, Binding>();
  const registrationEpoch = new Map<number, number>();
  const handshakes = new Map<string, { entry: Binding; complete(): void }>();
  const send = (entry: Binding, message: object) => {
    try {
      entry.widget?.postMessage(message);
    } catch {
      /* Widget has left. */
    }
  };
  const cancelTask = (entry: Binding) => {
    entry.submissionEpoch++;
    entry.channel?.send({ type: 'cancel' });
  };
  const remove = (tabId: number) => {
    const entry = bindings.get(tabId);
    if (!entry) return;
    bindings.delete(tabId);
    entry.unwatch?.();
    if (entry.widget) voice.release(entry.widget);
    cancelTask(entry);
    send(entry, {
      type: 'lost',
      error: 'Site voice connection changed. Reload or reconnect to continue.',
    });
    entry.widget?.disconnect();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.config || changes.config.newValue?.voiceMode === true) return;
    for (const [tabId, epoch] of registrationEpoch) registrationEpoch.set(tabId, epoch + 1);
    for (const tabId of bindings.keys()) remove(tabId);
  });
  const valid = async (entry: Binding) => {
    if (bindings.get(entry.tabId) !== entry) return false;
    const [frame, grant, connection, voiceEnabled] = await Promise.all([
      chrome.webNavigation.getFrame({ tabId: entry.tabId, frameId: 0 }),
      readSiteGrant(entry.origin, entry.incognito),
      siteConnectionStatus(options.config, entry.origin, entry.incognito),
      enabled(),
    ]);
    return (
      voiceEnabled &&
      bindings.get(entry.tabId) === entry &&
      frame?.documentId === entry.documentId &&
      new URL(frame.url).origin === entry.origin &&
      connection.connected &&
      connection.agentId === entry.agentId &&
      grantKey(grant) === entry.grant
    );
  };
  const toolsValid = (entry: Binding) =>
    entry.policy.tools.every(
      (name) =>
        getToolRegistry().hasSiteTool(entry.tabId, name) &&
        !getToolRegistry().isProtectedToolName(name)
    );
  const submit = async (
    entry: Binding,
    text: unknown,
    isConnected: () => boolean = () => true,
    epoch = entry.submissionEpoch
  ) => {
    const checkCancelled = () => {
      if (epoch !== entry.submissionEpoch || !isConnected())
        throw new Error('Submission cancelled. Nothing was sent.');
    };
    checkCancelled();
    if (entry.busy) throw new Error('A site task is already running.');
    if (typeof text !== 'string' || !text.trim() || text.length > 30000)
      throw new Error('Enter a request of at most 30,000 characters.');
    entry.busy = true;
    try {
      if (!(await valid(entry))) throw new Error('This site conversation is no longer authorized.');
      checkCancelled();
      await options.prepare(entry.tabId);
      if (!(await valid(entry)) || !toolsValid(entry))
        throw new Error(
          'The document or approved page tools changed. Reconnect before continuing.'
        );
      checkCancelled();
      const context: SiteConversationContext = {
        id: entry.id,
        agentId: entry.agentId,
        history: [...entry.history],
        instructions: entry.policy.instructions ?? '',
        isCurrent: () => bindings.get(entry.tabId) === entry && toolsValid(entry),
        validate: () => valid(entry),
      };
      let settled = false;
      const channel = createSiteTaskChannel(entry.sender, (event) => {
        // Usage accounting can republish terminal events after the task has settled.
        if (settled) return;
        entry.taskId = event.taskId;
        send(entry, { type: 'task', event, conversationId: entry.id });
        if (!event.busy && !settled) {
          settled = true;
          // Serialize behind task writes before reading the actual response; never synthesize a summary.
          void lookupSiteTasks(entry.tabId, entry.origin, entry.incognito, event.taskId)
            .then(async () => {
              const key = `${siteChatPrefix(entry.tabId)}${event.taskId}`;
              const record = (await chrome.storage.session.get(key))[key] as
                | SiteTaskRecord
                | undefined;
              if (record && record.conversationId !== entry.id) return;
              if (record && event.status === 'done' && bindings.get(entry.tabId) === entry) {
                entry.history.push(
                  { role: 'user', content: record.prompt.slice(0, 6000) },
                  { role: 'assistant', content: record.response.slice(0, 6000) }
                );
                entry.history = entry.history.slice(-8);
              }
              send(entry, {
                type: 'result',
                taskId: event.taskId,
                status: event.status,
                text: record?.response.slice(0, 500) || event.detail,
                detail: event.detail,
              });
            })
            .catch(() =>
              send(entry, {
                type: 'error',
                error:
                  'Task ended, but its saved response could not be loaded. Open conversation to review.',
              })
            )
            .finally(() => {
              entry.busy = false;
              entry.channel = undefined;
            });
        }
      });
      entry.channel = channel;
      options.execute(channel.port, context);
      channel.send({ type: 'start', text: text.trim(), tools: entry.policy.tools });
    } catch (error) {
      entry.busy = false;
      throw error;
    }
  };
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'SITE_VOICE_BIND') {
      const handshake =
        typeof message.nonce === 'string' ? handshakes.get(message.nonce) : undefined;
      if (
        handshake &&
        sender.frameId === 0 &&
        sender.tab?.id === handshake.entry.tabId &&
        sender.documentId === handshake.entry.documentId &&
        siteOrigin(sender) === handshake.entry.origin
      ) {
        handshakes.delete(message.nonce);
        handshake.complete();
      }
      reply({ success: !!handshake });
      return false;
    }
    if (message.type === 'SITE_VOICE_HIDE') {
      const entry = sender.tab?.id === undefined ? undefined : bindings.get(sender.tab.id);
      if (entry && sender.frameId === 0 && sender.documentId === entry.documentId && entry.widget)
        voice.stop(entry.widget);
      return false;
    }
    if (message.type === 'SITE_VOICE_SYNC') {
      const origin = siteOrigin(sender);
      if (!origin || !sender.documentId || sender.tab?.id === undefined) return false;
      const tabId = sender.tab.id;
      const epoch = (registrationEpoch.get(tabId) ?? 0) + 1;
      registrationEpoch.set(tabId, epoch);
      void (async () => {
        if (!(await enabled())) {
          remove(tabId);
          return { enabled: false };
        }
        const policy = parseSiteVoice(message.options);
        const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
        if (frame?.documentId !== sender.documentId) throw new Error('Document changed.');
        const connection = await siteConnectionStatus(
          options.config,
          origin,
          sender.tab?.incognito
        );
        const grant = await readSiteGrant(origin, sender.tab?.incognito);
        if (registrationEpoch.get(tabId) !== epoch) return { enabled: false };
        if (!policy.enabled || !connection.connected || !connection.agentId || !grant) {
          remove(tabId);
          return { enabled: false };
        }
        const previous = bindings.get(tabId);
        if (
          previous &&
          previous.documentId === sender.documentId &&
          previous.grant === grantKey(grant) &&
          JSON.stringify(previous.policy) === JSON.stringify(policy)
        )
          return { enabled: true, bindingId: previous.id };
        await options.prepare(tabId);
        if (!(await enabled())) return { enabled: false };
        const currentFrame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
        if (registrationEpoch.get(tabId) !== epoch) return { enabled: false };
        if (currentFrame?.documentId !== sender.documentId) throw new Error('Document changed.');
        const registry = getToolRegistry();
        if (
          !policy.tools.every(
            (name) => registry.hasSiteTool(tabId, name) && !registry.isProtectedToolName(name)
          )
        )
          throw new Error('Voice tools must be registered page tools.');
        remove(tabId);
        const entry: Binding = {
          sender,
          tabId,
          documentId: sender.documentId as string,
          origin,
          incognito: sender.tab?.incognito === true,
          agentId: connection.agentId,
          grant: grantKey(grant),
          policy,
          id: globalThis.crypto.randomUUID(),
          history: [],
          busy: false,
          submissionEpoch: 0,
        };
        bindings.set(tabId, entry);
        const capabilities = new Map(
          policy.tools.map((name) => [name, registry.getToolForTab(tabId, name)])
        );
        entry.unwatch = registry.onTabToolsChanged(tabId, () => {
          if (
            bindings.get(tabId) === entry &&
            policy.tools.some(
              (name) => registry.getToolForTab(tabId, name) !== capabilities.get(name)
            )
          )
            remove(tabId);
        });
        return { enabled: true, bindingId: entry.id };
      })().then(reply, (error) => reply({ enabled: false, error: String(error) }));
      return true;
    }
    if (message.type === 'SITE_VOICE_CONTINUE' || message.type === 'SITE_VOICE_CANCEL') {
      const boundTab = sidebarSessionTab(sender);
      if (boundTab === null || boundTab !== message.tabId) return false;
      const entry = bindings.get(boundTab);
      if (!entry || message.conversationId !== entry.id) {
        reply({
          error: 'This conversation belongs to a previous document. Start a new task on the site.',
        });
        return false;
      }
      const epoch = entry.submissionEpoch;
      void (async () => {
        const tab = await chrome.tabs.get(boundTab);
        if ((tab.incognito === true) !== entry.incognito)
          throw new Error('Conversation profile changed.');
        if (message.type === 'SITE_VOICE_CANCEL') cancelTask(entry);
        else await submit(entry, message.text, undefined, epoch);
      })().then(
        () => reply({ success: true }),
        (error) => reply({ error: String(error) })
      );
      return true;
    }
    return false;
  });
  chrome.runtime.onConnect.addListener((port) => {
    if (voice.connect(port)) return;
    if (port.name !== 'byoa-site-voice') return;
    const sender = port.sender;
    const entry = sender?.tab?.id === undefined ? undefined : bindings.get(sender.tab.id);
    if (
      !entry ||
      sender?.url !== chrome.runtime.getURL('src/site-voice/index.html') ||
      !sender.frameId ||
      !sender.documentId
    ) {
      port.disconnect();
      return;
    }
    let closed = false;
    let bound = false;
    let generation = 0;
    let lane = Promise.resolve();
    port.onDisconnect.addListener(() => {
      closed = true;
      generation++;
      voice.release(port);
      if (entry.widget === port) entry.widget = undefined;
    });
    // Chrome omits extension subframes from webNavigation.getFrame. Verify the exact
    // extension-created iframe through its isolated parent bridge, then recheck top-document authority.
    const nonce = globalThis.crypto.randomUUID();
    const deadline = setTimeout(() => {
      handshakes.delete(nonce);
      if (!bound) port.disconnect();
    }, 5000);
    port.onDisconnect.addListener(() => {
      clearTimeout(deadline);
      handshakes.delete(nonce);
    });
    handshakes.set(nonce, {
      entry,
      complete: () => {
        void valid(entry)
          .then((ok) => {
            clearTimeout(deadline);
            if (closed || !ok || entry.widget) {
              port.disconnect();
              return;
            }
            entry.widget = port;
            bound = true;
            port.postMessage({ type: 'bound', conversationId: entry.id });
          })
          .catch(() => port.disconnect());
      },
    });
    port.postMessage({ type: 'bind-challenge', nonce });
    port.onMessage.addListener((message) => {
      if (!bound || closed) return;
      // Open on the click's message turn, before awaits can consume activation.
      if (message.type === 'open') {
        void options.open(entry.tabId, entry.taskId).catch(() =>
          send(entry, {
            type: 'error',
            error: 'Open BYOA from the toolbar to view this conversation.',
          })
        );
        return;
      }
      if (message.type === 'cancel') {
        generation++;
        voice.release(port);
        cancelTask(entry);
        return;
      }
      if (message.type === 'finish') {
        voice.finish(port);
        return;
      }
      const token = generation;
      lane = lane
        .then(async () => {
          if (token !== generation || closed) return;
          if (closed || !(await valid(entry))) throw new Error('Site voice authorization changed.');
          if (message.type === 'setup') {
            await chrome.tabs.create({
              url: chrome.runtime.getURL('src/voice-permission/index.html'),
            });
            return;
          }
          if (message.type === 'start') {
            if (entry.busy) throw new Error('Wait for the current task to finish.');
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id !== entry.tabId) throw new Error('Return to this tab before recording.');
            if (token !== generation || closed) return;
            await voice.start(
              port,
              ['en-US', 'en-GB', 'sv-SE'].includes(message.language) ? message.language : 'en-US',
              (data) =>
                send(entry, { ...data, type: data.type === 'result' ? 'transcript' : data.type })
            );
          } else if (message.type === 'submit')
            await submit(entry, message.text, () => token === generation && !closed);
        })
        .catch((error) => {
          if (token !== generation || closed) return;
          send(entry, {
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
  });
  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0) remove(details.tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    registrationEpoch.delete(tabId);
    remove(tabId);
  });
  chrome.tabs.onActivated.addListener(() => voice.cancel());
  chrome.windows.onFocusChanged.addListener(() => voice.cancel());
  onGrantChanged((origin, _grant, incognito) => {
    for (const entry of bindings.values())
      if (entry.origin === origin && entry.incognito === incognito)
        void valid(entry).then((ok) => {
          if (!ok) remove(entry.tabId);
        });
  });
  return { voice };
}
