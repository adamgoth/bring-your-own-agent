import { MemoryMountError } from '../lib/memory/manager';
import type { CoreMessage } from 'ai';
import type { AIClient, StreamFinishMetadata } from '../lib/ai/client';
import type { ConfigStorage } from '../lib/storage/config';
import type { ChatMessage, ConversationWorkspaceContext, MessageContent } from '../types';
import {
  CHAT_SESSION_PORT,
  CHAT_SESSION_PREFIX,
  type ChatEvent,
  type ChatSessionCommand,
  type ChatSessionSnapshot,
  type ChatSessionUpdate,
  type ChatTurn,
} from '../lib/chat-session';
import { raceWithAbort } from '../lib/abort';
import { toModelMessages } from '../lib/ai/model-history';
import { buildPageContextXml } from '../lib/ai/page-context';
import {
  selectStreamContinuation,
  toolsChangedContinuationMessage,
  stepLimitContinuationMessage,
} from '../lib/ai/stream-policy';

const MAX_SESSION_BYTES = 3_000_000;
const MAX_SESSIONS = 8;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
interface Run {
  id: string;
  controller: AbortController;
  streamId?: string;
}
interface Session {
  data: ChatSessionSnapshot;
  subscribers: Set<chrome.runtime.Port>;
  run?: Run;
  workspace?: ConversationWorkspaceContext;
  epoch: number;
  writes: Promise<unknown>;
  timer?: ReturnType<typeof setTimeout>;
  disposed?: boolean;
  size: number;
}

/** Only the extension UI may subscribe. Page SDK tasks have a separate authority boundary. */
export function sidebarSessionTab(sender: chrome.runtime.MessageSender | undefined): number | null {
  if (!sender || sender.id !== chrome.runtime.id || !sender.url) return null;
  let url: URL;
  try {
    url = new URL(sender.url);
  } catch {
    return null;
  }
  if (url.href.split('#')[0] !== chrome.runtime.getURL('src/sidebar/index.html')) return null;
  const match = /^#tab=(\d+)$/.exec(url.hash);
  return match ? Number(match[1]) : null;
}

export function createChatSessionService(
  client: AIClient,
  config: ConfigStorage,
  prepare: (tabId: number) => Promise<unknown>,
  hints: (tabId: number) => Array<{ name: string; description: string }>
) {
  const sessions = new Map<number, Session>();
  const loading = new Map<number, Promise<Session>>();
  // Serialize creation too: simultaneous tabs cannot exceed the storage allocation.
  let creations: Promise<unknown> = Promise.resolve();
  let storageWrites: Promise<unknown> = Promise.resolve();
  const post = (port: chrome.runtime.Port, update: ChatSessionUpdate) => {
    try {
      port.postMessage(update);
    } catch {
      /* A view is optional. */
    }
  };
  const broadcast = (s: Session, update: ChatSessionUpdate) => {
    for (const port of s.subscribers) post(port, update);
  };
  const current = (s: Session, run: Run) => s.run === run && !run.controller.signal.aborted;
  const persist = (s: Session): Promise<unknown> => {
    if (s.timer) clearTimeout(s.timer);
    s.timer = undefined;
    const snapshot = globalThis.structuredClone(s.data);
    s.writes = storageWrites
      .catch(() => undefined)
      .then(async () => {
        if (!s.disposed) {
          const stored = await chrome.storage.session.get(null);
          const nextBytes = bytes({
            ...stored,
            [`${CHAT_SESSION_PREFIX}${snapshot.tabId}`]: snapshot,
          });
          // Other extension features share this quota. Always allow Clear and
          // restoring an unchanged record, even when those features filled it.
          if (nextBytes > 8_000_000 && nextBytes > bytes(stored)) {
            throw new Error('Session storage limit reached');
          }
          await chrome.storage.session.set({
            [`${CHAT_SESSION_PREFIX}${snapshot.tabId}`]: snapshot,
          });
        }
      });
    storageWrites = s.writes;
    return s.writes;
  };
  const finish = (s: Session, turn: ChatTurn, status: ChatTurn['status'], detail?: string) => {
    if (turn.status !== 'working') return;
    turn.status = status;
    if (detail) {
      const event: ChatEvent = { type: 'notice', text: detail };
      turn.events.push(event);
      broadcast(s, { type: 'event', turnId: turn.id, event });
    }
    for (const message of turn.messages)
      for (const tool of message.toolCalls ?? []) {
        if (tool.status === 'pending' || tool.status === 'running') {
          tool.status = 'error';
          tool.error = 'Execution was interrupted. It may already have produced side effects.';
          const event: ChatEvent = {
            type: 'result',
            id: tool.id,
            status: 'error',
            output: undefined,
            error: tool.error,
          };
          turn.events.push(event);
          broadcast(s, { type: 'event', turnId: turn.id, event });
        }
      }
    s.data.revision++;
    broadcast(s, { type: 'status', turnId: turn.id, status });
  };
  const cancel = (
    s: Session,
    detail = 'Stopped. Tool actions already performed are not undone.'
  ) => {
    const run = s.run;
    if (!run) return;
    s.run = undefined;
    run.controller.abort();
    if (run.streamId) client.cancelStream(run.streamId);
    const turn = s.data.turns.find((t) => t.id === run.id);
    if (turn) finish(s, turn, 'cancelled', detail);
    void persist(s).catch(() => storageFailure(s));
  };
  const storageFailure = (s: Session) => {
    const run = s.run;
    s.run = undefined;
    run?.controller.abort();
    if (run?.streamId) client.cancelStream(run.streamId);
    const turn = s.data.turns.find((t) => t.id === run?.id) ?? s.data.turns.at(-1);
    if (!turn) return;
    const detail =
      'Chat could not be saved. Reopening may omit recent progress. Review results before retrying.';
    if (turn.status === 'working') finish(s, turn, 'error', detail);
    else if (!turn.events.some((e) => e.type === 'notice' && e.text === detail)) {
      const event: ChatEvent = { type: 'notice', text: detail };
      turn.events.push(event);
      turn.status = 'error';
      broadcast(s, { type: 'event', turnId: turn.id, event });
      broadcast(s, { type: 'status', turnId: turn.id, status: 'error' });
    }
  };
  const changed = (s: Session) => {
    s.data.revision++;
    if (!s.timer)
      s.timer = setTimeout(() => {
        void persist(s).catch(() => storageFailure(s));
      }, 250);
  };
  const load = (tabId: number): Promise<Session> => {
    const existing = sessions.get(tabId);
    if (existing) return Promise.resolve(existing);
    const pending = loading.get(tabId);
    if (pending) return pending;
    const promise = creations
      .catch(() => undefined)
      .then(async () => {
        const tab = await chrome.tabs.get(tabId);
        const stored = await chrome.storage.session.get(null);
        const key = `${CHAT_SESSION_PREFIX}${tabId}`;
        const existing = stored[key] as ChatSessionSnapshot | undefined;
        if (
          !existing &&
          Object.keys(stored).filter((k) => k.startsWith(CHAT_SESSION_PREFIX)).length >=
            MAX_SESSIONS
        ) {
          throw new Error(
            'Chat storage is full. Close an existing chat’s browser tab before starting another.'
          );
        }
        const data: ChatSessionSnapshot =
          existing?.version === 1 && existing.incognito === (tab.incognito === true)
            ? existing
            : { version: 1, tabId, incognito: tab.incognito === true, turns: [], revision: 0 };
        const s: Session = {
          data,
          subscribers: new Set(),
          epoch: 0,
          writes: Promise.resolve(),
          size: bytes(data),
        };
        for (const turn of data.turns)
          if (turn.status === 'working') {
            finish(
              s,
              turn,
              'error',
              'BYOA restarted. This turn was interrupted; review results before sending a new request.'
            );
          }
        await persist(s);
        sessions.set(tabId, s);
        return s;
      });
    creations = promise;
    loading.set(tabId, promise);
    void promise.finally(() => loading.delete(tabId)).catch(() => undefined);
    return promise;
  };
  const select = (s: Session, agentId: string) => {
    if (s.data.selectedAgentId === agentId) return;
    s.data.selectedAgentId = agentId;
    s.workspace = undefined;
    s.epoch++;
    changed(s);
    broadcast(s, { type: 'selected', agentId });
  };
  const execute = async (s: Session, turn: ChatTurn, run: Run) => {
    // Keep the worker available only while it owns work, including with no view open.
    const heartbeat = setInterval(() => {
      void chrome.storage.session
        .get(`${CHAT_SESSION_PREFIX}${s.data.tabId}`)
        .catch(() => undefined);
    }, 20_000);
    const emit = (event: ChatEvent, update?: () => void) => {
      if (!current(s, run)) return;
      // Reserve space for cancellation/status metadata. Never silently prune model history.
      const eventSize = bytes(event) * 2;
      if (s.size + eventSize > MAX_SESSION_BYTES - 20_000) {
        cancel(
          s,
          'Chat storage limit reached. Review results, then clear the conversation to continue.'
        );
        return;
      }
      s.size += eventSize;
      update?.();
      const last = turn.events.at(-1);
      if ((event.type === 'text' || event.type === 'reasoning') && last?.type === event.type)
        last.text += event.text;
      else turn.events.push(globalThis.structuredClone(event));
      changed(s);
      broadcast(s, { type: 'event', turnId: turn.id, event });
    };
    try {
      let continuationCount = 0;
      while (current(s, run)) {
        const agent = await raceWithAbort(config.getAgent(turn.agentId), run.controller.signal);
        if (!agent) throw new Error('The selected agent is unavailable.');
        await raceWithAbort(prepare(s.data.tabId), run.controller.signal);
        if (!current(s, run)) return;
        const tab = await raceWithAbort(chrome.tabs.get(s.data.tabId), run.controller.signal);
        const page = { url: tab.url ?? '', title: tab.title ?? '' };
        const user = turn.messages.at(-1);
        if (!user) throw new Error('Missing conversation turn');
        user.metadata = { ...user.metadata, pageContext: page };
        const history = s.data.turns.flatMap((t) => t.messages);
        const messages = toModelMessages(history, {
          buildPageContextXml,
          currentPageUrl: page.url,
          siteToolHints: hints(s.data.tabId),
        });
        const assistant: ChatMessage = {
          id: globalThis.crypto.randomUUID(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          metadata: { agentId: agent.id, agentName: agent.name },
        };
        turn.messages.push(assistant);
        const epoch = s.epoch;
        const workspace = s.workspace?.agentId === agent.id ? s.workspace : undefined;
        run.streamId = globalThis.crypto.randomUUID();
        let metadata: StreamFinishMetadata | undefined;
        let completed = false;
        let failure: Error | undefined;
        await client.streamChat(
          agent.id,
          messages as CoreMessage[],
          s.data.tabId,
          {
            onWorkspaceContext: (context) => {
              if (current(s, run) && s.epoch === epoch && s.data.selectedAgentId === agent.id)
                s.workspace = context;
            },
            onTextBlockStart: (id) => emit({ type: 'text-start', id }),
            onTextBlockChunk: (_id, text) =>
              emit({ type: 'text', text }, () => {
                assistant.content = String(assistant.content) + text;
              }),
            onTextBlockEnd: () => emit({ type: 'text-end' }),
            onReasoningStart: () => emit({ type: 'reasoning-start' }),
            onReasoningChunk: (text) => emit({ type: 'reasoning', text }),
            onReasoningEnd: (usage) => emit({ type: 'reasoning-end', usage }),
            onToolCall: (tool) =>
              emit({ type: 'tool', tool }, () => {
                (assistant.toolCalls ??= []).push(globalThis.structuredClone(tool));
              }),
            onToolResult: (result) =>
              emit({ type: 'result', ...result }, () => {
                const tool = assistant.toolCalls?.find((t) => t.id === result.id);
                if (tool)
                  Object.assign(tool, result, {
                    endTime: Date.now(),
                    duration: Date.now() - tool.startTime,
                  });
              }),
            onFinish: (text, meta) => {
              if (!current(s, run)) return;
              // Some adapters deliver only a final answer.
              if (!assistant.content && text) {
                emit({ type: 'text-start', id: globalThis.crypto.randomUUID() });
                emit({ type: 'text', text }, () => {
                  assistant.content = text;
                });
                emit({ type: 'text-end' });
              }
              metadata = meta;
              completed = true;
            },
            onError: (error) => {
              failure =
                error instanceof MemoryMountError
                  ? error
                  : new Error('AI request failed. Check the agent connection and try again.');
            },
            onAbort: (reason) => {
              failure = new Error(
                reason === 'remote-tools-changed'
                  ? 'Remote tools changed. Review results before retrying.'
                  : 'Another sidebar request replaced this response.'
              );
            },
          },
          run.streamId,
          workspace
        );
        if (!current(s, run)) return;
        if (failure) throw failure;
        if (!completed)
          throw new Error('The response was interrupted. Review results before retrying.');
        const continuation =
          s.data.selectedAgentId === agent.id
            ? selectStreamContinuation({
                toolsChanged: !!metadata?.toolsChanged,
                stepsExhausted: !!metadata?.stepsExhausted,
                continuationCount,
              })
            : null;
        if (!continuation) break;
        continuationCount++;
        turn.messages.push({
          id: globalThis.crypto.randomUUID(),
          role: 'user',
          timestamp: Date.now(),
          content:
            continuation === 'tools-changed'
              ? toolsChangedContinuationMessage()
              : stepLimitContinuationMessage(agent.maxSteps),
        });
      }
      if (current(s, run)) finish(s, turn, 'done');
    } catch (error) {
      if (current(s, run))
        finish(
          s,
          turn,
          'error',
          error instanceof MemoryMountError ||
            (error instanceof Error && error.message.startsWith('Another sidebar'))
            ? error.message
            : 'Chat interrupted or failed. Review results before retrying; check the agent connection if this persists.'
        );
    } finally {
      clearInterval(heartbeat);
      if (s.run === run) s.run = undefined;
      await persist(s).catch(() => storageFailure(s));
    }
  };
  const submit = async (s: Session, command: Extract<ChatSessionCommand, { type: 'submit' }>) => {
    if (s.data.turns.some((t) => t.id === command.id)) return; // Idempotent delivery, never an automatic retry.
    if (s.run)
      throw new Error(
        'This conversation already has a running request. Stop it before sending another.'
      );
    if (!validContent(command.content) || typeof command.id !== 'string' || command.id.length > 100)
      throw new Error('Invalid chat message.');
    const agent = await config.getAgent(command.agentId);
    if (!agent) throw new Error('Choose an available agent first.');
    if (s.disposed) throw new Error('This browser tab was closed.');
    if (bytes(s.data) + bytes(command.content) > MAX_SESSION_BYTES - 100_000)
      throw new Error(
        'Chat storage limit reached. Clear the conversation or reduce attachments before continuing.'
      );
    select(s, agent.id);
    const turn: ChatTurn = {
      id: command.id,
      agentId: agent.id,
      agentName: agent.name,
      messages: [{ id: command.id, role: 'user', content: command.content, timestamp: Date.now() }],
      events: [],
      status: 'working',
    };
    s.data.turns.push(turn);
    s.size = bytes(s.data) + 10_000;
    const run: Run = { id: turn.id, controller: new AbortController() };
    s.run = run;
    try {
      await persist(s);
    } catch {
      s.run = undefined;
      s.data.turns.pop();
      throw new Error('Chat could not be saved. No request was sent.');
    }
    if (s.disposed || !current(s, run)) return;
    broadcast(s, { type: 'turn', turn: globalThis.structuredClone(turn) });
    void execute(s, turn, run);
  };
  // All user commands are ordered across views. Execution itself runs outside this queue.
  const commands = new Map<number, Promise<unknown>>();
  const connect = (port: chrome.runtime.Port) => {
    if (port.name !== CHAT_SESSION_PORT) return;
    const tabId = sidebarSessionTab(port.sender);
    if (tabId === null) {
      port.disconnect();
      return;
    }
    let closed = false;
    port.onDisconnect.addListener(() => {
      closed = true;
      sessions.get(tabId)?.subscribers.delete(port);
    });
    const ready = load(tabId).then((s) => {
      if (!closed) {
        s.subscribers.add(port);
        post(port, { type: 'snapshot', snapshot: globalThis.structuredClone(s.data) });
      }
      return s;
    });
    void ready.catch(() => {
      if (!closed)
        post(port, {
          type: 'unavailable',
          error: 'Chat could not be restored. Close unused chat tabs or reload BYOA and try again.',
        });
    });
    port.onMessage.addListener((command: ChatSessionCommand) => {
      if (closed || !command || typeof command.requestId !== 'string') return;
      const operation = (commands.get(tabId) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          const s = await ready;
          if (closed || s.disposed) return;
          switch (command.type) {
            case 'submit':
              await submit(s, command);
              break;
            case 'select':
              s.workspace = undefined;
              s.epoch++;
              s.data.selectedAgentId = undefined;
              if (!(await config.getAgent(command.agentId))) throw new Error('Agent unavailable.');
              select(s, command.agentId);
              await persist(s);
              break;
            case 'cancel':
              if (s.run?.id === command.turnId) cancel(s);
              break;
            case 'clear':
              cancel(s);
              s.data.turns = [];
              s.size = bytes(s.data);
              s.workspace = undefined;
              s.epoch++;
              s.data.revision++;
              await persist(s);
              broadcast(s, { type: 'snapshot', snapshot: globalThis.structuredClone(s.data) });
              break;
            default:
              throw new Error('Unknown chat command.');
          }
          post(port, { type: 'reply', requestId: command.requestId });
        });
      commands.set(tabId, operation);
      void operation.catch((error) =>
        post(port, {
          type: 'reply',
          requestId: command.requestId,
          error: error instanceof Error ? error.message : 'Chat command failed.',
        })
      );
    });
  };
  return {
    connect,
    reconcileAgents(agentIds: Set<string>) {
      for (const s of sessions.values()) {
        const turn = s.data.turns.find((t) => t.id === s.run?.id);
        if (turn && !agentIds.has(turn.agentId))
          cancel(s, 'The active agent was removed. Review results before continuing.');
        if (s.data.selectedAgentId && !agentIds.has(s.data.selectedAgentId)) {
          s.data.selectedAgentId = undefined;
          s.workspace = undefined;
          s.epoch++;
          changed(s);
        }
      }
    },
    invalidateWorkspace(agentId?: string) {
      for (const s of sessions.values())
        if (!agentId || s.data.selectedAgentId === agentId || s.workspace?.agentId === agentId) {
          s.workspace = undefined;
          s.epoch++;
        }
    },
    async removeTab(tabId: number) {
      const s = sessions.get(tabId) ?? (await loading.get(tabId)?.catch(() => undefined));
      if (s) {
        cancel(s);
        s.disposed = true;
        if (s.timer) clearTimeout(s.timer);
        for (const port of s.subscribers) port.disconnect();
        await s.writes.catch(() => undefined);
      }
      sessions.delete(tabId);
      commands.delete(tabId);
      await chrome.storage.session.remove(`${CHAT_SESSION_PREFIX}${tabId}`);
    },
  };
}

function validContent(content: MessageContent): boolean {
  if (typeof content === 'string') return !!content.trim();
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.length <= 20 &&
    content.every(
      (part) =>
        part &&
        (part.type === 'text'
          ? typeof part.text === 'string'
          : part.type === 'image' &&
            typeof part.image === 'string' &&
            /^data:image\/(png|jpeg|gif|webp);base64,/.test(part.image))
    )
  );
}
