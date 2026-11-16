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
  resultLabel = el('result-label'),
  language = el<HTMLSelectElement>('language');
const talk = el<HTMLButtonElement>('talk'),
  newConversation = el<HTMLButtonElement>('new-conversation');
const capturing = ['starting', 'recording', 'finishing'];
const port = chrome.runtime.connect({ name: 'byoa-site-voice' });
const paint = createVoiceBars(bars);
let state = 'idle';
let taskId: string | undefined;
let completedTaskId: string | undefined;
let bound = false;
let autoSend = false;
let submitted = false;
let hasResult = false;
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
// A result stays on screen while the person replies to it; it is compacted, not removed.
const render = () => {
  const settled = ['idle', 'result', 'error'].includes(state);
  bars.hidden = !['recording', 'finishing'].includes(state);
  draft.hidden = state !== 'review';
  result.hidden = !hasResult;
  result.classList.toggle('is-previous', hasResult && state !== 'result');
  resultLabel.hidden = !hasResult || state === 'result';
  talk.hidden = !settled;
  talk.textContent = hasResult ? 'Reply' : 'Talk';
  talk.disabled = !bound;
  finish.hidden = state !== 'recording';
  send.hidden = !['recording', 'finishing', 'review'].includes(state);
  send.disabled = state === 'finishing' || submitted;
  cancel.hidden = settled;
  cancel.textContent = state === 'review' ? 'Discard' : 'Cancel';
  open.hidden = !hasResult || capturing.includes(state) || state === 'review';
  newConversation.hidden = !hasResult || !settled;
  language.disabled = [...capturing, 'working'].includes(state);
  mic.disabled = !bound;
};
/** Leave capture or review and return to the last result, if there is one. */
const settle = (message: string) => {
  autoSend = false;
  draft.value = '';
  state = hasResult ? 'result' : 'idle';
  status.textContent = message;
};
const startRecording = () => {
  autoSend = false;
  submitted = false;
  state = 'starting';
  status.textContent = hasResult ? 'Starting your reply…' : 'Starting local dictation…';
  expand(true);
  post({ type: 'start', language: language.value });
  render();
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
    if (event.isTrusted) action();
  });
// One click on the launcher always means "talk", including a reply after a result.
// It only reopens the panel when a draft or task is already in progress.
onClick('mic', () => {
  if ([...capturing, 'review', 'working'].includes(state)) {
    expand(true);
    render();
    return;
  }
  startRecording();
});
onClick('talk', startRecording);
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
  post({ type: 'cancel' });
  settle(state === 'review' ? 'Dictation discarded.' : 'Cancelled. Nothing was sent.');
  if (!hasResult) expand(false);
  render();
});
onClick('collapse', () => {
  if (capturing.includes(state)) {
    post({ type: 'cancel' });
    settle('Cancelled. Nothing was sent.');
  }
  expand(false);
  render();
});
onClick('open', () => post({ type: 'open' }));
onClick('setup', () => {
  post({ type: 'cancel' });
  post({ type: 'setup' });
  settle('Finish voice setup in the new tab, then try again.');
  render();
});
onClick('new-conversation', () => {
  post({ type: 'new-conversation' });
  hasResult = false;
  result.replaceChildren();
  settle('New chat started. Earlier replies won’t be used as context.');
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
    expand(true);
    // The panel stays open after an answer; only the person collapses it (collapse button or Escape).
    render();
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
    post({ type: 'cancel' });
    settle('Cancelled. Nothing was sent.');
    expand(false);
    render();
  }
});
globalThis.addEventListener('pagehide', () => {
  post({ type: 'cancel' });
  port.disconnect();
});
render();
