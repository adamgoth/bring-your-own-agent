// Deliberately no visibilitychange cancellation: this host has no visible UI.
const API = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const speechOptions = { langs: ['en-US'], processLocally: true };
let active;
let stream;
let audio;
let timer;
let finishTimer;
let generation = 0;
let pending = false;
const report = { events: [], text: '', released: true };
const deadline = (promise, ms = 10000) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Timed out')), ms);
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
async function capability() {
  const local = !!API && 'processLocally' in API.prototype;
  return {
    url: location.href,
    local,
    hidden: document.hidden,
    visibility: document.visibilityState,
    state:
      local && API.available
        ? await deadline(API.available(speechOptions)).catch(String)
        : 'unsupported',
  };
}
async function release() {
  clearTimeout(timer);
  clearTimeout(finishTimer);
  stream?.getTracks().forEach((track) => track.stop());
  if (audio && audio.state !== 'closed') await audio.close();
  report.released =
    (!stream || stream.getTracks().every((track) => track.readyState === 'ended')) &&
    (!audio || audio.state === 'closed');
}
async function capture() {
  if (active || pending) throw Error('Capture busy');
  pending = true;
  const id = ++generation;
  const state = await capability();
  if (id !== generation) return { cancelled: true };
  pending = false;
  if (state.state !== 'available') return { ...state, blocked: true };
  report.events = [];
  report.text = '';
  report.final = false;
  const recognition = new API();
  recognition.processLocally = true;
  if (recognition.processLocally !== true) throw Error('Local processing unavailable');
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;
  active = recognition;
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (active !== recognition) {
      acquired.getTracks().forEach((track) => track.stop());
      return { cancelled: true };
    }
    stream = acquired;
    audio = new AudioContext();
    audio.createMediaStreamSource(stream).connect(audio.createAnalyser());
    report.released = false;
    for (const event of ['start', 'audiostart', 'speechstart', 'speechend', 'audioend']) {
      recognition.addEventListener(event, () => {
        if (active === recognition) report.events.push(event);
      });
    }
    recognition.onresult = (event) => {
      if (active !== recognition) return;
      report.text = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(' ');
      report.final = Array.from(event.results).some((result) => result.isFinal);
    };
    recognition.onerror = (event) => {
      if (active === recognition) report.events.push(`error:${event.error}`);
    };
    recognition.onend = () => {
      if (active !== recognition) return;
      active = undefined;
      report.events.push('end');
      void release();
    };
    recognition.start();
    finishTimer = setTimeout(() => {
      if (active === recognition) recognition.stop();
    }, 10000);
    timer = setTimeout(() => void cancel(), 15000);
    return { started: true, ...state };
  } catch (error) {
    await cancel();
    throw error;
  }
}
async function cancel() {
  generation++;
  pending = false;
  const recognition = active;
  active = undefined;
  try {
    recognition?.abort();
  } finally {
    await release();
  }
  return snapshot();
}
function snapshot() {
  return { ...report, active: !!active, hidden: document.hidden };
}
async function media() {
  if (active || pending) throw Error('Capture busy');
  const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
  let context;
  try {
    context = new AudioContext();
    context.createMediaStreamSource(acquired).connect(context.createAnalyser());
  } finally {
    acquired.getTracks().forEach((track) => track.stop());
    await context?.close();
  }
  return {
    media: true,
    hidden: document.hidden,
    released:
      acquired.getTracks().every((track) => track.readyState === 'ended') &&
      context.state === 'closed',
  };
}
globalThis.probe = {
  media,
  capability,
  capture,
  cancel,
  snapshot,
  install: () => deadline(API.install(speechOptions), 120000),
};
if (location.pathname.endsWith('/host.html'))
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message.target !== 'host') return;
    const operation = { capability, capture, cancel, snapshot, media }[message.command];
    if (!operation) return;
    Promise.resolve()
      .then(operation)
      .then(reply, (error) => reply({ error: String(error) }));
    return true;
  });
addEventListener('pagehide', () => void cancel());
