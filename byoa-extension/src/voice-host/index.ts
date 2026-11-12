import { createVoiceCapture } from '../lib/voice-capture';
import { sampleVoiceVolume } from '../lib/voice-volume';
const port = chrome.runtime.connect({ name: 'byoa-voice-host' });
let id = '';
let stopMeter: (() => void) | undefined;
let watchdog: ReturnType<typeof setTimeout>;
const post = (message: object) => {
  try {
    port.postMessage({ ...message, id });
  } catch {
    capture.cancel();
    stopMeter?.();
  }
};
const capture = createVoiceCapture({
  state: (state) => {
    if (state === 'recording')
      stopMeter = sampleVoiceVolume(
        (level) => post({ type: 'volume', level }),
        () => post({ type: 'meter-unavailable' })
      );
    else {
      stopMeter?.();
      stopMeter = undefined;
    }
    post({ type: 'state', state });
  },
  result: (result) => {
    stopMeter?.();
    stopMeter = undefined;
    post({ type: 'result', ...result });
  },
});
port.onMessage.addListener((message) => {
  if (message.type === 'ping') {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      capture.cancel();
      stopMeter?.();
    }, 6000);
    return;
  }
  if (message.type === 'start' && !capture.active) {
    id = message.id;
    void capture.start(message.language);
  }
  if (message.id !== id) return;
  if (message.type === 'finish') capture.finish();
  if (message.type === 'cancel') capture.cancel();
});
port.onDisconnect.addListener(() => {
  clearTimeout(watchdog);
  capture.cancel();
  stopMeter?.();
});
globalThis.addEventListener('pagehide', () => {
  capture.cancel();
  stopMeter?.();
});
