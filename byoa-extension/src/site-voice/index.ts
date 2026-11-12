import { createVoiceBars } from '../lib/voice-bars';
import { StreamingMarkdownRenderer } from '../sidebar/StreamingMarkdownRenderer';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mic = el<HTMLButtonElement>('mic'),
  panel = el('panel'),
  status = el('status');
const draft = el<HTMLTextAreaElement>('draft'),
  bars = el<HTMLCanvasElement>('bars');
const finish = el<HTMLButtonElement>('finish'),
  send = el<HTMLButtonElement>('send'),
  cancel = el<HTMLButtonElement>('cancel');
const open = el<HTMLButtonElement>('open'),
  result = el('result'),
  language = el<HTMLSelectElement>('language');
const port = chrome.runtime.connect({ name: 'byoa-site-voice' });
const paint = createVoiceBars(bars);
let state = 'idle';
let taskId: string | undefined;
let completedTaskId: string | undefined;
let bound = false;
let autoSend = false;
let submitted = false;
let hasResult = false;
let collapseTimer: ReturnType<typeof setTimeout> | undefined;
const post = (message: object) => {
  try {
    port.postMessage(message);
  } catch {
    fail('BYOA disconnected. Reload this page.');
  }
};
const reportSize = () =>
  globalThis.parent.postMessage(
    {
      type: 'byoa-voice-size',
      expanded: !panel.hidden,
      height: Math.ceil(panel.getBoundingClientRect().height + 8),
    },
    '*'
  );
new ResizeObserver(reportSize).observe(panel);
const expand = (value: boolean) => {
  panel.hidden = !value;
  mic.hidden = value;
  reportSize();
};
const render = () => {
  bars.hidden = !['recording', 'finishing'].includes(state);
  draft.hidden = state !== 'review';
  result.hidden = state !== 'result';
  finish.hidden = state !== 'recording';
  send.hidden = !['recording', 'finishing', 'review'].includes(state);
  send.disabled = state === 'finishing' || submitted;
  cancel.hidden = !['starting', 'recording', 'finishing', 'review', 'working'].includes(state);
  cancel.textContent = state === 'review' ? 'Discard' : 'Cancel';
  open.hidden = !hasResult;
  language.disabled = ['starting', 'recording', 'finishing', 'working'].includes(state);
  mic.disabled = !bound;
};
function fail(error: string) {
  autoSend = false;
  state = 'error';
  status.textContent = error;
  expand(true);
  render();
}
const submit = () => {
  if (submitted || !draft.value.trim()) return;
  submitted = true;
  state = 'working';
  status.textContent = 'Working…';
  post({ type: 'submit', text: draft.value });
  render();
};
const onClick = (id: string, action: () => void) =>
  el(id).addEventListener('click', (event) => {
    if (event.isTrusted) {
      clearTimeout(collapseTimer);
      action();
    }
  });
onClick('mic', () => {
  expand(true);
  if (hasResult || state === 'review') {
    render();
    return;
  }
  autoSend = false;
  submitted = false;
  state = 'starting';
  status.textContent = 'Starting local dictation…';
  post({ type: 'start', language: language.value });
  render();
});
onClick('finish', () => {
  state = 'finishing';
  post({ type: 'finish' });
  render();
});
onClick('send', () => {
  if (state === 'recording') {
    autoSend = true;
    state = 'finishing';
    post({ type: 'finish' });
    render();
  } else if (state === 'review') submit();
});
onClick('cancel', () => {
  autoSend = false;
  post({ type: 'cancel' });
  draft.value = '';
  state = 'idle';
  status.textContent = 'Dictation discarded.';
  expand(false);
  render();
});
onClick('collapse', () => {
  if (['starting', 'recording', 'finishing'].includes(state)) {
    autoSend = false;
    post({ type: 'cancel' });
    state = 'idle';
  }
  expand(false);
});
onClick('open', () => post({ type: 'open' }));
onClick('setup', () => {
  post({ type: 'cancel' });
  post({ type: 'setup' });
  autoSend = false;
  state = 'idle';
  render();
});
// The result stays accessible until the next deliberate recording.
const again = document.createElement('button');
again.textContent = 'Dictate again';
again.hidden = true;
open.after(again);
again.addEventListener('click', (event) => {
  if (!event.isTrusted) return;
  clearTimeout(collapseTimer);
  hasResult = false;
  submitted = false;
  autoSend = false;
  state = 'starting';
  again.hidden = true;
  status.textContent = 'Starting local dictation…';
  post({ type: 'start', language: language.value });
  render();
});
port.onMessage.addListener((message) => {
  if (message.type === 'bind-challenge') {
    globalThis.parent.postMessage({ type: 'byoa-voice-bind', nonce: message.nonce }, '*');
    return;
  }
  if (message.type === 'bound') {
    bound = true;
    render();
    return;
  }
  if (message.type === 'state') {
    state = message.state;
    status.textContent = state === 'recording' ? 'Listening locally' : 'Finishing…';
    render();
  }
  if (message.type === 'volume') paint(message.level);
  if (message.type === 'transcript') {
    if (!['starting', 'recording', 'finishing'].includes(state)) return;
    const shouldSend = autoSend && message.ok;
    autoSend = false;
    draft.value = message.text ?? '';
    state = 'review';
    status.textContent = message.error || 'Review your transcript.';
    render();
    if (shouldSend) submit();
    else draft.focus();
  }
  if (message.type === 'task') {
    if (message.event.taskId === completedTaskId) return;
    taskId = message.event.taskId;
    if (!message.event.busy) return;
    state = 'working';
    status.textContent = message.event.detail;
    render();
  }
  if (message.type === 'result') {
    if (message.taskId === completedTaskId || (taskId && message.taskId !== taskId)) return;
    completedTaskId = message.taskId;
    state = 'result';
    hasResult = true;
    submitted = false;
    result.replaceChildren();
    StreamingMarkdownRenderer.renderComplete(result, message.text);
    status.textContent = message.status === 'done' ? 'Completed' : message.detail;
    again.hidden = false;
    expand(true);
    render();
    if (message.status === 'done') collapseTimer = setTimeout(() => expand(false), 10000);
  }
  if (message.type === 'error' || message.type === 'lost')
    fail(message.error || 'Recording stopped when focus or connection changed. Nothing was sent.');
});
port.onDisconnect.addListener(() => {
  bound = false;
  fail('BYOA disconnected. Reload this page.');
});
globalThis.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    autoSend = false;
    post({ type: 'cancel' });
    state = 'idle';
    expand(false);
    render();
  }
});
globalThis.addEventListener('pagehide', () => {
  post({ type: 'cancel' });
  port.disconnect();
});
render();
