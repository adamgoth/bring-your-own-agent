import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { connectChatSession } from '../src/sidebar/chat-session';
import type { ChatSessionSnapshot, ChatSessionUpdate, ChatTurn } from '../src/lib/chat-session';

vi.mock('../src/sidebar/StreamingMarkdownRenderer', () => ({
  StreamingMarkdownRenderer: class {
    constructor(private element: HTMLElement) {}
    static renderComplete(element: HTMLElement, content: string) {
      element.textContent = content;
    }
    write(content: string) {
      this.element.textContent += content;
    }
    end() {}
  },
}));
const clipboard = vi.fn().mockResolvedValue(undefined);
const empty: ChatSessionSnapshot = {
  version: 1,
  tabId: 1,
  incognito: false,
  selectedAgentId: 'a',
  turns: [],
  revision: 0,
};
let ports: ReturnType<typeof mockPort>[];
function mockPort() {
  let message: (value: ChatSessionUpdate) => void = () => {};
  let disconnected = () => {};
  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(() => disconnected()),
    onMessage: {
      addListener: (listener: typeof message) => {
        message = listener;
      },
    },
    onDisconnect: {
      addListener: (listener: typeof disconnected) => {
        disconnected = listener;
      },
    },
    emit: (value: ChatSessionUpdate) => message(value),
    drop: () => disconnected(),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  ports = [];
  chrome.runtime.connect = vi.fn(() => {
    const port = mockPort();
    ports.push(port);
    return port as unknown as chrome.runtime.Port;
  });
  document.body.innerHTML =
    '<div id="messages"><section id="site-agent-chat">App history</section></div>';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  });
  clipboard.mockClear();
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.clearAllTimers();
  vi.useRealTimers();
});
function setup() {
  const busy = vi.fn();
  const selected = vi.fn();
  const view = connectChatSession({
    container: document.querySelector('#messages')!,
    busy,
    selected,
    scroll: () => {},
    message: (_role, content) => {
      const element = document.createElement('div');
      element.textContent = String(content);
      return element;
    },
  });
  ports[0].emit({ type: 'snapshot', snapshot: structuredClone(empty) });
  return { view, busy, selected };
}
function turn(): ChatTurn {
  return {
    id: 'turn',
    agentId: 'a',
    agentName: 'A',
    status: 'working',
    events: [],
    messages: [{ id: 'u', role: 'user', content: 'Question', timestamp: 1 }],
  };
}

it('subscribes and renders text/tool interleaving with one complete copy action', async () => {
  const { busy } = setup();
  const port = ports[0];
  port.emit({ type: 'turn', turn: turn() });
  const emit = (event: Extract<ChatSessionUpdate, { type: 'event' }>['event']) =>
    port.emit({ type: 'event', turnId: 'turn', event });
  emit({ type: 'text-start', id: 'one' });
  emit({ type: 'text', text: 'Before **tool**' });
  emit({ type: 'text-end' });
  emit({
    type: 'tool',
    tool: { id: 'tool', toolName: 'read_page', input: {}, status: 'running', startTime: 1 },
  });
  emit({ type: 'result', id: 'tool', status: 'success', output: 'Read' });
  emit({ type: 'text-start', id: 'two' });
  emit({ type: 'text', text: 'After tool' });
  emit({ type: 'text-end' });
  port.emit({ type: 'status', turnId: 'turn', status: 'done' });
  expect(busy).toHaveBeenLastCalledWith(false);
  const copy = document.querySelector<HTMLButtonElement>(
    '[aria-label="Copy response as Markdown"]'
  );
  expect(copy).not.toBeNull();
  copy!.click();
  await Promise.resolve();
  expect(clipboard).toHaveBeenCalledWith('Before **tool**\n\nAfter tool');
  expect(document.querySelector('#site-agent-chat')?.textContent).toBe('App history');
});

it('reconnects with snapshot replay, ignores stale port events and never resubmits', async () => {
  const { busy } = setup();
  const old = ports[0];
  old.emit({ type: 'turn', turn: turn() });
  old.drop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(ports).toHaveLength(2);
  const recovered = turn();
  recovered.status = 'done';
  recovered.events = [
    { type: 'text-start', id: 'text' },
    { type: 'text', text: 'Completed while closed' },
    { type: 'text-end' },
  ];
  ports[1].emit({ type: 'snapshot', snapshot: { ...empty, turns: [recovered] } });
  old.emit({ type: 'turn', turn: { ...turn(), id: 'stale' } });
  expect(document.querySelectorAll('.chat-session-turn')).toHaveLength(1);
  expect(document.body.textContent).toContain('Completed while closed');
  expect(busy).toHaveBeenLastCalledWith(false);
  expect(ports[1].postMessage).not.toHaveBeenCalled();
});

it('Stop is explicit and view teardown only disconnects the subscription', async () => {
  const { view } = setup();
  const port = ports[0];
  port.emit({ type: 'turn', turn: turn() });
  const cancelled = view.cancel();
  const command = port.postMessage.mock.calls[0][0];
  expect(command).toMatchObject({ type: 'cancel', turnId: 'turn' });
  port.emit({ type: 'reply', requestId: command.requestId });
  await cancelled;
  expect(port.disconnect).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('pagehide'));
  expect(port.disconnect).toHaveBeenCalled();
  expect(port.postMessage).toHaveBeenCalledTimes(1);
});

it('clear replay preserves app history and profile changes preserve the conversation', async () => {
  const { selected } = setup();
  const port = ports[0];
  port.emit({ type: 'turn', turn: turn() });
  port.emit({ type: 'selected', agentId: 'b' });
  expect(selected).toHaveBeenLastCalledWith('b');
  expect(document.body.textContent).toContain('Question');
  port.emit({ type: 'snapshot', snapshot: empty });
  expect(document.querySelectorAll('.chat-session-turn')).toHaveLength(0);
  expect(document.querySelector('#site-agent-chat')?.textContent).toBe('App history');
});
