import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/voice-wave', () => ({ createVoiceWave: () => vi.fn() }));
let receive: (message: Record<string, unknown>) => void;
let posted: ReturnType<typeof vi.fn>;
const clicks = new Map<string, (event: { isTrusted: boolean }) => void>();
const element = (id: string) => document.getElementById(id)!;
// The widget only acts on trusted clicks, which jsdom can't dispatch; call the handlers directly.
const click = (id: string) => clicks.get(id)!({ isTrusted: true });
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = readFileSync('src/site-voice/index.html', 'utf8');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
    }
  );
  clicks.clear();
  const add = HTMLElement.prototype.addEventListener;
  vi.spyOn(HTMLElement.prototype, 'addEventListener').mockImplementation(function (
    this: HTMLElement,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) {
    if (type === 'click' && this.id) clicks.set(this.id, listener as never);
    add.call(this, type, listener, options);
  });
  posted = vi.fn();
  chrome.runtime.connect = vi.fn().mockReturnValue({
    postMessage: posted,
    onMessage: {
      addListener: (fn: typeof receive) => {
        receive = fn;
      },
    },
    onDisconnect: { addListener: vi.fn() },
  } as unknown as chrome.runtime.Port);
  await import('../src/site-voice/index');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const task = (taskId: string, busy: boolean) =>
  receive({ type: 'task', event: { taskId, busy, detail: 'Task update' } });
const result = (taskId: string) =>
  receive({ type: 'result', taskId, status: 'cancelled', text: taskId, detail: 'Cancelled' });
it('keeps a result visible after a late terminal event', () => {
  task('first', true);
  result('first');
  task('first', false);
  expect(element('result').hidden).toBe(false);
  expect(element('result').textContent).toBe('first');
  expect(element('cancel').hidden).toBe(true);
});
it('ignores duplicate results and old task events during a newer recording', () => {
  task('first', true);
  result('first');
  receive({ type: 'state', state: 'recording' });
  task('first', true);
  task('first', false);
  result('first');
  expect(element('bars').hidden).toBe(false);
  expect(element('status').textContent).toBe('Listening locally');
});
it('ignores the previous result while a new task runs and accepts the new result', () => {
  task('first', true);
  result('first');
  task('second', true);
  result('first');
  expect(element('result').classList.contains('is-previous')).toBe(true);
  expect(element('result-label').hidden).toBe(false);
  result('second');
  expect(element('result').classList.contains('is-previous')).toBe(false);
  expect(element('result').hidden).toBe(false);
  expect(element('result').textContent).toBe('second');
});

it('shows a new task rejected before it emits any busy event', () => {
  task('first', true);
  result('first');
  task('rejected', false);
  result('rejected');
  expect(element('result').textContent).toBe('rejected');
  expect(element('result').hidden).toBe(false);
});

it('renders result Markdown while keeping HTML and unsafe links inert', () => {
  task('formatted', true);
  receive({
    type: 'result',
    taskId: 'formatted',
    status: 'done',
    text: '**Bold** and *italic* with `code`\n\n- First\n- Second\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![image](https://example.com/private.png)',
  });
  const output = element('result');
  expect(output.querySelector('strong')?.textContent).toBe('Bold');
  expect(output.querySelector('em')?.textContent).toBe('italic');
  expect(output.querySelector('code')?.textContent).toBe('code');
  expect(output.querySelectorAll('li')).toHaveLength(2);
  expect(output.querySelector('script')).toBeNull();
  expect(output.querySelector('a')?.hasAttribute('href')).toBe(false);
  expect(output.querySelector('img')?.hasAttribute('src')).toBe(false);
  task('next', true);
  result('next');
  expect(output.querySelector('strong')).toBeNull();
  expect(output.textContent).toBe('next');
});

const bind = () =>
  receive({ type: 'bound', conversationId: 'c1', origin: 'https://piano.example:8443' });
const done = (taskId: string) => {
  task(taskId, true);
  receive({ type: 'result', taskId, status: 'done', text: `Answer ${taskId}` });
};

it('keeps the answer open until the person collapses it', () => {
  bind();
  done('first');
  vi.advanceTimersByTime(60_000);
  expect(element('panel').hidden).toBe(false);
  expect(element('result').textContent).toBe('Answer first');
  click('collapse');
  expect(element('panel').hidden).toBe(true);
});

it('starts a reply from the collapsed launcher in one click and keeps the last answer', () => {
  bind();
  done('first');
  click('collapse');
  expect(element('panel').hidden).toBe(true);
  click('mic');
  expect(posted).toHaveBeenCalledWith({ type: 'start', language: 'en-US' });
  expect(element('panel').hidden).toBe(false);
  expect(element('status').textContent).toBe('Starting your reply…');
  expect(element('result').textContent).toBe('Answer first');
  expect(element('result').classList.contains('is-previous')).toBe(true);
  expect(element('talk').hidden).toBe(true);
});

it('returns to the last answer when a reply is cancelled', () => {
  bind();
  done('first');
  click('talk');
  receive({ type: 'state', state: 'recording' });
  click('cancel');
  expect(posted).toHaveBeenCalledWith({ type: 'cancel' });
  expect(element('panel').hidden).toBe(false);
  expect(element('result').classList.contains('is-previous')).toBe(false);
  expect(element('talk').getAttribute('aria-label')).toBe('Reply');
  expect(element('open').hidden).toBe(false);
});

it('reopens an unsent transcript instead of starting over', () => {
  bind();
  click('mic');
  receive({ type: 'state', state: 'recording' });
  receive({ type: 'transcript', ok: true, text: 'Show G major' });
  click('collapse');
  posted.mockClear();
  click('mic');
  expect(posted).not.toHaveBeenCalled();
  expect((element('draft') as HTMLTextAreaElement).value).toBe('Show G major');
});

it('starts a new conversation on request', () => {
  bind();
  done('first');
  expect(element('new-conversation').hidden).toBe(false);
  click('new-conversation');
  expect(posted).toHaveBeenCalledWith({ type: 'new-conversation' });
  expect(element('result').hidden).toBe(true);
  expect(element('talk').getAttribute('aria-label')).toBe('Talk');
  expect(element('new-conversation').hidden).toBe(true);
});

it('names the bound site in the header and launcher', () => {
  bind();
  expect(element('site-name').textContent).toBe('BYOA · piano.example:8443');
  expect(element('mic').getAttribute('aria-label')).toBe('Talk to piano.example:8443 with BYOA');
});
