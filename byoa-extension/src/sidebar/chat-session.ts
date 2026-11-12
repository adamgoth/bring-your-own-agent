import {
  CHAT_SESSION_PORT,
  type ChatEvent,
  type ChatSessionCommand,
  type ChatSessionSnapshot,
  type ChatSessionUpdate,
  type ChatTurn,
} from '../lib/chat-session';
import type { MessageContent } from '../types';
import { TextBox } from './TextBox';
import { ReasoningBox } from './ReasoningBox';
import { ToolCallBox } from './ToolCallBox';
import { createCopyMarkdownAction } from './CopyMarkdownAction';

type ChatSessionRequest = ChatSessionCommand extends infer C
  ? C extends ChatSessionCommand
    ? Omit<C, 'requestId'>
    : never
  : never;

interface View {
  root: HTMLElement;
  text?: TextBox;
  reasoning?: ReasoningBox;
  tools: Map<string, ToolCallBox>;
  markdown: string[];
  block: string;
  anchor?: HTMLElement;
}

/** A view owns DOM and a subscription, never model execution or model history. */
export function connectChatSession(options: {
  container: HTMLElement;
  message: (
    role: 'user' | 'assistant' | 'system' | 'error',
    content: MessageContent
  ) => HTMLElement;
  busy: (busy: boolean) => void;
  selected: (agentId: string) => void;
  scroll: () => void;
}) {
  let port: chrome.runtime.Port | undefined;
  let ready = false;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let activeTurnId: string | undefined;
  let selectedAgentId: string | undefined;
  const views = new Map<string, View>();
  const pending = new Map<string, { resolve(): void; reject(error: Error): void }>();
  let initialResolve!: () => void;
  const initialized = new Promise<void>((resolve) => {
    initialResolve = resolve;
  });
  const setBusy = () => options.busy(!!activeTurnId);
  const finishText = (view: View) => {
    view.text?.finishStreaming();
    view.text = undefined;
    if (view.block) view.markdown.push(view.block);
    view.block = '';
  };
  const finish = (view: View) => {
    finishText(view);
    view.reasoning?.finishStreaming();
    view.reasoning = undefined;
    const markdown = view.markdown.join('\n\n');
    if (markdown && view.anchor) {
      view.anchor.classList.add('response-action-anchor');
      view.anchor.appendChild(createCopyMarkdownAction(markdown));
    }
  };
  const event = (view: View, value: ChatEvent) => {
    switch (value.type) {
      case 'text-start': {
        finishText(view);
        view.text = new TextBox(value.id);
        view.anchor = view.text.getElement();
        view.root.append(view.anchor);
        view.text.startStreaming();
        break;
      }
      case 'text':
        view.text?.appendChunk(value.text);
        view.block += value.text;
        break;
      case 'text-end':
        finishText(view);
        break;
      case 'reasoning-start': {
        view.reasoning?.finishStreaming();
        view.reasoning = new ReasoningBox();
        const wrapper = document.createElement('div');
        wrapper.className = 'reasoning-wrapper';
        wrapper.append(view.reasoning.getElement());
        view.root.append(wrapper);
        view.anchor = wrapper;
        view.reasoning.startStreaming();
        break;
      }
      case 'reasoning':
        view.reasoning?.appendChunk(value.text);
        break;
      case 'reasoning-end':
        view.reasoning?.finishStreaming(value.usage);
        view.reasoning = undefined;
        break;
      case 'tool': {
        const box = new ToolCallBox(value.tool);
        view.tools.set(value.tool.id, box);
        const wrapper = document.createElement('div');
        wrapper.className = 'tool-call-wrapper';
        wrapper.append(box.getElement());
        view.root.append(wrapper);
        view.anchor = wrapper;
        break;
      }
      case 'result':
        view.tools.get(value.id)?.updateResult(value.output, value.status, value.error);
        break;
      case 'notice': {
        const notice = document.createElement('div');
        notice.className = 'message message-system';
        notice.textContent = value.text;
        view.root.append(notice);
        break;
      }
    }
  };
  const turn = (value: ChatTurn) => {
    if (views.has(value.id)) return;
    const root = document.createElement('section');
    root.className = 'chat-session-turn';
    root.dataset.turnId = value.id;
    root.setAttribute('aria-label', `Conversation with ${value.agentName}`);
    const user = value.messages[0];
    if (user) root.append(options.message('user', user.content));
    const view: View = { root, tools: new Map(), markdown: [], block: '' };
    views.set(value.id, view);
    options.container.append(root);
    for (const item of value.events) event(view, item);
    if (value.status === 'working') activeTurnId = value.id;
    else finish(view);
  };
  const snapshot = (value: ChatSessionSnapshot) => {
    // Keep the independently rendered App agent chat and the composer untouched.
    for (const view of views.values()) {
      view.text?.finishStreaming();
      view.reasoning?.finishStreaming();
      view.root.remove();
    }
    views.clear();
    activeTurnId = undefined;
    selectedAgentId = value.selectedAgentId;
    if (selectedAgentId) options.selected(selectedAgentId);
    for (const item of value.turns) turn(item);
    ready = true;
    initialResolve();
    setBusy();
    options.scroll();
  };
  const connect = () => {
    if (stopped) return;
    const attached = chrome.runtime.connect({ name: CHAT_SESSION_PORT });
    port = attached;
    attached.onMessage.addListener((update: ChatSessionUpdate) => {
      if (port !== attached) return;
      switch (update.type) {
        case 'unavailable':
          ready = false;
          options.message('error', update.error);
          initialResolve();
          break;
        case 'snapshot':
          snapshot(update.snapshot);
          break;
        case 'selected':
          selectedAgentId = update.agentId;
          options.selected(update.agentId);
          break;
        case 'turn':
          turn(update.turn);
          setBusy();
          break;
        case 'event': {
          const view = views.get(update.turnId);
          if (view) event(view, update.event);
          break;
        }
        case 'status': {
          const view = views.get(update.turnId);
          if (view) finish(view);
          if (activeTurnId === update.turnId) activeTurnId = undefined;
          setBusy();
          break;
        }
        case 'reply': {
          const waiter = pending.get(update.requestId);
          pending.delete(update.requestId);
          if (update.error) waiter?.reject(new Error(update.error));
          else waiter?.resolve();
          break;
        }
      }
      options.scroll();
    });
    attached.onDisconnect.addListener(() => {
      if (port !== attached) return;
      port = undefined;
      ready = false;
      for (const waiter of pending.values())
        waiter.reject(
          new Error(
            'Chat disconnected. Reconnecting to check progress; the request will not be repeated.'
          )
        );
      pending.clear();
      // Retain the last transcript while reconnecting, but do not claim a live response.
      for (const view of views.values()) {
        view.text?.finishStreaming();
        view.reasoning?.finishStreaming();
      }
      activeTurnId = undefined;
      setBusy();
      if (!stopped) retry = setTimeout(connect, 1000);
    });
  };
  const request = (command: ChatSessionRequest) => {
    if (!ready || !port)
      return Promise.reject(new Error('Chat is reconnecting. Please wait before sending.'));
    const attached = port;
    const requestId = globalThis.crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      try {
        attached.postMessage({ ...command, requestId });
      } catch {
        pending.delete(requestId);
        reject(new Error('Chat connection is unavailable.'));
      }
    });
  };
  connect();
  window.addEventListener('pagehide', () => {
    stopped = true;
    clearTimeout(retry);
    port?.disconnect();
  });
  return {
    initialized,
    get selectedAgentId() {
      return selectedAgentId;
    },
    submit: (id: string, agentId: string, content: MessageContent) =>
      request({ type: 'submit', id, agentId, content }),
    select: (agentId: string) => request({ type: 'select', agentId }),
    cancel: () =>
      activeTurnId ? request({ type: 'cancel', turnId: activeTurnId }) : Promise.resolve(),
    clear: () => request({ type: 'clear' }),
  };
}
