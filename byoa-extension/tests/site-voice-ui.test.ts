import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/voice-bars', () => ({ createVoiceBars: () => vi.fn() }));
let receive: (message: Record<string, unknown>) => void;
const element = (id: string) => document.getElementById(id)!;
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
  chrome.runtime.connect = vi.fn().mockReturnValue({
    postMessage: vi.fn(),
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
  expect(element('result').hidden).toBe(true);
  result('second');
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
