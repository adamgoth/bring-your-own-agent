import { createVoiceCapture } from '../lib/voice-capture';
import { claimVoiceLease } from '../lib/voice-lease';
import { startVoiceMeter } from './voice-meter';

import { localRecognizer, withDeadline } from '../lib/local-speech';
export { localRecognizer } from '../lib/local-speech';
export type { LocalRecognition, LocalRecognitionConstructor } from '../lib/local-speech';

export function setupLocalVoice(options: { changed?: () => void; canStart?: () => boolean } = {}) {
  const probe = document.querySelector<HTMLButtonElement>('#voice-probe');
  if (probe && import.meta.env.BYOA_VOICE_PROBE) {
    probe.hidden = false;
    probe.addEventListener('click', () => {
      abort(true);
      void chrome.tabs.create({ url: chrome.runtime.getURL('voice-probe/setup.html') });
    });
  }
  const panel = document.querySelector<HTMLDetailsElement>('#local-voice');
  const mic = document.querySelector<HTMLButtonElement>('#voice-button');
  const composer = document.querySelector<HTMLTextAreaElement>('#message-input');
  const waveform = document.querySelector<HTMLCanvasElement>('#voice-waveform');
  const recording = document.querySelector<HTMLElement>('#voice-recording');
  const recordingStatus = document.querySelector<HTMLElement>('#voice-recording-status');
  const cancel = document.querySelector<HTMLButtonElement>('#voice-cancel');
  if (!panel || !mic || !composer || !waveform || !recording || !recordingStatus || !cancel) return;
  const permissionHelp = panel.querySelector<HTMLElement>('#voice-permission-help');
  const language = panel.querySelector<HTMLSelectElement>('#voice-language');
  const check = panel.querySelector<HTMLButtonElement>('#voice-check');
  const install = panel.querySelector<HTMLButtonElement>('#voice-install');
  const record = panel.querySelector<HTMLButtonElement>('#voice-record');
  const status = panel.querySelector<HTMLElement>('#voice-status');
  if (!permissionHelp || !language || !check || !install || !record || !status) return;
  const API = localRecognizer();
  let recognition: ReturnType<typeof createVoiceCapture> | undefined;
  let releaseLease: (() => void) | undefined;
  let ready = false;
  let pending = false;
  let closed = false;
  let stopping = false;
  let baseText = '';
  let transcript = '';
  let priorReadOnly = false;
  let stopMeter: (() => void) | undefined;
  let completion: Promise<boolean> | undefined;
  let resolveCompletion: ((ok: boolean) => void) | undefined;
  const speechOptions = () => ({ langs: [language.value], processLocally: true as const });
  const render = () => {
    mic.setAttribute('aria-expanded', String(panel.open));
    mic.setAttribute('aria-pressed', String(!!recognition));
    mic.title = recognition ? 'Finish dictation' : 'Dictate a message locally';
    mic.setAttribute('aria-label', mic.title);
    recording.hidden = !recognition;
    composer.classList.toggle('is-recording', !!recognition);
    language.disabled = pending || !!recognition;
    check.disabled = pending || !!recognition || !API;
    install.disabled = pending || !!recognition;
    record.disabled = pending || !ready || stopping;
    record.textContent = recognition ? 'Finish recording' : 'Start talking';
    record.setAttribute('aria-pressed', String(!!recognition));
    options.changed?.();
  };
  const settle = (ok: boolean, discard = false) => {
    releaseLease?.();
    releaseLease = undefined;
    stopMeter?.();
    stopMeter = undefined;
    recognition = undefined;
    stopping = false;
    composer.readOnly = priorReadOnly;
    composer.value =
      !discard && transcript.trim()
        ? [baseText, transcript.trim()]
            .filter(Boolean)
            .join(baseText && !baseText.endsWith('\n') ? '\n' : '')
        : baseText;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    const resolve = resolveCompletion;
    resolveCompletion = undefined;
    render();
    resolve?.(ok && !!transcript.trim());
  };
  const abort = (discard = false) => {
    if (!recognition) return;
    const active = recognition;
    transcript = active.text;
    settle(false, discard);
    try {
      active.cancel();
    } catch {
      // State and meter are already released even if the recognizer has ended.
    }
  };
  const stop = () => {
    if (!recognition || stopping) return;
    stopping = true;
    recordingStatus.textContent = 'Finishing…';
    stopMeter?.();
    stopMeter = undefined;
    render();
    recognition.finish();
  };
  const checkAvailability = async () => {
    if (!API) return;
    pending = true;
    ready = false;
    install.hidden = true;
    status.textContent = 'Checking offline speech availability…';
    render();
    try {
      const state = await withDeadline(API.available(speechOptions()), 10_000);
      if (closed) return;
      ready = state === 'available';
      install.hidden = state !== 'downloadable';
      status.textContent = ready
        ? 'Ready. Audio stays on this device.'
        : state === 'downloadable'
          ? 'Download the browser’s language pack once to enable offline speech.'
          : state === 'downloading'
            ? 'Language pack is downloading. Check again when it finishes.'
            : 'Offline speech is unavailable for this language in this browser. You can still type.';
    } catch {
      status.textContent =
        'Chrome could not check offline speech in this sidebar. You can still type.';
    } finally {
      pending = false;
      render();
    }
  };
  check.addEventListener('click', () => void checkAvailability());
  language.addEventListener('change', () => void checkAvailability());
  install.addEventListener('click', () => {
    if (!API || pending) return;
    // Invoke directly in the user gesture: installation may require transient activation.
    let installation: Promise<boolean>;
    try {
      installation = API.install(speechOptions());
    } catch {
      status.textContent = 'Chrome could not start the language-pack download. Try again.';
      return;
    }
    pending = true;
    status.textContent =
      'Downloading offline speech. This downloads a model; it does not upload audio.';
    render();
    void withDeadline(installation, 120_000)
      .then(async (ok) => {
        if (closed) return;
        if (ok) await checkAvailability();
        else status.textContent = 'Language pack installation did not complete. Try again.';
      })
      .catch(() => {
        status.textContent =
          'Offline speech installation did not finish. Check availability again or retry the download.';
      })
      .finally(() => {
        pending = false;
        render();
      });
  });
  const toggleRecording = () => {
    if (recognition) {
      stop();
      return;
    }
    if (closed) return;
    if (!API || !ready || pending || composer.disabled || options.canStart?.() === false) {
      panel.open = true;
      render();
      return;
    }
    permissionHelp.hidden = true;
    baseText = composer.value;
    transcript = '';
    priorReadOnly = composer.readOnly;
    try {
      const active = createVoiceCapture({
        state: (state) => {
          if (recognition !== active) return;
          stopping = state === 'finishing';
          recordingStatus.textContent = stopping ? 'Finishing…' : 'Listening locally';
          if (stopping) {
            stopMeter?.();
            stopMeter = undefined;
          } else
            stopMeter = startVoiceMeter(waveform, () => {
              if (recognition === active && !stopping)
                recordingStatus.textContent = 'Listening · meter unavailable';
            });
          render();
        },
        result: (result) => {
          if (recognition !== active) return;
          transcript = result.text;
          settle(result.ok, result.cancelled);
          if (result.error) {
            panel.open = true;
            permissionHelp.hidden = !result.error.includes('not-allowed');
            status.textContent = result.error.includes('not-allowed')
              ? 'Microphone access needs approval. Choose Set up microphone access, then try again.'
              : result.error;
          } else {
            status.textContent = 'Transcript added to your message.';
            composer.focus();
          }
        },
      });
      recognition = active;
      completion = new Promise((resolve) => {
        resolveCompletion = resolve;
      });
      composer.readOnly = true;
      panel.open = false;
      recordingStatus.textContent = 'Starting local dictation…';
      releaseLease = claimVoiceLease(
        () => {
          if (recognition !== active) return;
          const finishImmediately = stopping;
          void active.start(language.value, true);
          if (finishImmediately) active.finish();
        },
        () => {
          abort();
          panel.open = true;
          status.textContent =
            'Recording stopped because its connection or focus changed. Nothing was sent.';
        },
        () => {
          abort(true);
          panel.open = true;
          status.textContent = 'Microphone is busy in another BYOA view.';
        }
      );
      render();
    } catch {
      abort();
      panel.open = true;
      status.textContent = 'Could not start local dictation. No cloud service was used.';
    }
  };
  record.addEventListener('click', toggleRecording);
  mic.addEventListener('click', toggleRecording);
  cancel.addEventListener('click', () => {
    abort(true);
    composer.focus();
  });
  panel.querySelector('#voice-permission')?.addEventListener('click', () => {
    abort();
    void chrome.tabs
      .create({ url: chrome.runtime.getURL('src/voice-permission/index.html') })
      .catch(() => {
        status.textContent =
          'Open Chrome Settings → Privacy and security → Site settings → Microphone.';
      });
  });
  composer.addEventListener('input', () => {
    if (!recognition || composer.value === baseText) return;
    const replacement = composer.value;
    abort(true);
    composer.value = replacement;
    options.changed?.();
  });
  panel.addEventListener('toggle', render);
  // Behave like the actions popover: Escape or a click elsewhere closes it.
  // The mic is excluded because it opens this panel when voice isn't ready yet.
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !panel.open) return;
    panel.open = false;
    panel.querySelector<HTMLElement>('summary')?.focus();
    event.preventDefault();
  });
  document.addEventListener('click', (event) => {
    const target = event.target as Node;
    if (panel.open && !panel.contains(target) && !mic.contains(target)) panel.open = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && recognition) {
      abort();
      status.textContent =
        'Dictation stopped when the sidebar was hidden. Review your message before sending.';
    }
  });
  window.addEventListener('pagehide', () => {
    closed = true;
    abort();
  });
  if (API) void checkAvailability();
  else
    status.textContent =
      'This browser does not support local-only speech recognition. You can still type.';
  render();
  return {
    get isActive() {
      return !!recognition;
    },
    finishForSend: () => {
      if (!recognition) return Promise.resolve(true);
      const result = completion ?? Promise.resolve(false);
      stop();
      return result;
    },
    cancel: () => abort(true),
  };
}
