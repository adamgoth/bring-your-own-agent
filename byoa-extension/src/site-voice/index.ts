import { createVoiceWave } from '../lib/voice-wave';
import { StreamingMarkdownRenderer } from '../sidebar/StreamingMarkdownRenderer';
import { siteHost } from '../options/format';
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
const paint = createVoiceWave(bars);
/** The latest level; the wave redraws every frame while visible so it moves smoothly between updates. */
let level = 0;
let waveFrame: number | undefined;
const animateWave = (on: boolean) => {
  if (!on) {
    if (waveFrame !== undefined) globalThis.cancelAnimationFrame(waveFrame);
    waveFrame = undefined;
    level = 0;
    return;
  }
  if (waveFrame !== undefined) return;
  const frame = (now: number) => {
    paint(level, now);
    waveFrame = globalThis.requestAnimationFrame(frame);
  };
  waveFrame = globalThis.requestAnimationFrame(frame);
};
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
  animateWave(!bars.hidden);
  draft.hidden = state !== 'review';
  result.hidden = !hasResult;
  result.classList.toggle('is-previous', hasResult && state !== 'result');
  result.classList.toggle('is-clipped', result.scrollHeight > result.clientHeight + 1);
  resultLabel.hidden = !hasResult || state === 'result';
  talk.hidden = !settled;
  talk.title = hasResult ? 'Reply' : 'Talk';
  talk.setAttribute('aria-label', talk.title);
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
/**
 * Drag the launcher or the panel header to move the frame. Past a small threshold the page takes over
 * the drag (it owns the frame's position), told only where in the frame the pointer grabbed it.
 * Double-clicking the header puts the frame back in its corner.
 */
const DRAG_THRESHOLD = 4;
const draggable = (handle: HTMLElement) => {
  let start: { x: number; y: number; id: number } | undefined;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('#collapse')) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  handle.addEventListener('pointermove', (event) => {
    if (!start || event.pointerId !== start.id) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return;
    globalThis.parent.postMessage({ type: 'byoa-voice-drag', x: start.x, y: start.y }, '*');
    start = undefined;
  });
  const reset = () => (start = undefined);
  handle.addEventListener('pointerup', reset);
  handle.addEventListener('pointercancel', reset);
};
draggable(mic);
draggable(el('panel-header'));
el('panel-header').addEventListener('dblclick', (event) => {
  if (!(event.target as Element).closest('#collapse'))
    globalThis.parent.postMessage({ type: 'byoa-voice-move-reset' }, '*');
});
/** Name the site in the header and launcher, so it is clear where spoken requests go. */
const showSite = (host: string) => {
  const name = el('site-name');
  name.textContent = `BYOA · ${host}`;
  name.title = host;
  mic.title = `Talk to ${host} with BYOA. Drag to move.`;
  mic.setAttribute('aria-label', `Talk to ${host} with BYOA`);
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
    if (typeof message.origin === 'string') showSite(siteHost(message.origin));
    render();
    return;
  }
  if (message.type === 'state') {
    state = message.state;
    status.textContent = state === 'recording' ? 'Listening locally' : 'Finishing…';
    render();
  }
  if (message.type === 'volume') level = message.level;
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
