import { startVoiceMeter } from './voice-meter';

/** Local-only Web Speech adapter. Never use recognition without explicit local support. */
export interface LocalRecognition {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export interface LocalRecognitionConstructor {
  new (): LocalRecognition;
  prototype: LocalRecognition;
  available(options: { langs: string[]; processLocally: true }): Promise<string>;
  install(options: { langs: string[]; processLocally: true }): Promise<boolean>;
}
export function localRecognizer(): LocalRecognitionConstructor | undefined {
  const scope = window as unknown as {
    SpeechRecognition?: LocalRecognitionConstructor;
    webkitSpeechRecognition?: LocalRecognitionConstructor;
  };
  const API = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (
    !API ||
    !('processLocally' in API.prototype) ||
    typeof API.available !== 'function' ||
    typeof API.install !== 'function'
  )
    return;
  return API;
}

async function withDeadline<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Speech operation timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function setupLocalVoice(options: { changed?: () => void; canStart?: () => boolean } = {}) {
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
  let recognition: LocalRecognition | undefined;
  let ready = false;
  let pending = false;
  let closed = false;
  let stopping = false;
  let baseText = '';
  let transcript = '';
  let priorReadOnly = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
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
    clearTimeout(timeout);
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
    settle(false, discard);
    try {
      active.abort();
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
    clearTimeout(timeout);
    const active = recognition;
    timeout = setTimeout(() => {
      if (recognition !== active) return;
      abort();
      panel.open = true;
      status.textContent =
        'Transcription did not finish. Any captured text is in your message for review; nothing was sent.';
    }, 8000);
    render();
    try {
      active.stop();
    } catch {
      abort();
      panel.open = true;
      status.textContent = 'Could not finish dictation. Review your message before sending.';
    }
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
      const active = new API();
      active.processLocally = true;
      if (active.processLocally !== true) throw new Error('Local processing unavailable');
      active.lang = language.value;
      active.continuous = true;
      active.interimResults = true;
      recognition = active;
      completion = new Promise((resolve) => {
        resolveCompletion = resolve;
      });
      composer.readOnly = true;
      panel.open = false;
      recordingStatus.textContent = 'Listening locally';
      active.onresult = (event) => {
        if (recognition !== active) return;
        transcript = Array.from(event.results)
          .map((result) => result[0].transcript)
          .join(' ');
      };
      active.onerror = (event) => {
        if (recognition !== active) return;
        abort();
        panel.open = true;
        permissionHelp.hidden =
          event.error !== 'not-allowed' && event.error !== 'service-not-allowed';
        status.textContent =
          event.error === 'not-allowed'
            ? 'Microphone access needs approval. Choose Set up microphone access, then try again.'
            : `Local dictation stopped (${event.error}). Review any captured text before sending. No cloud service was used.`;
      };
      active.onend = () => {
        if (recognition !== active) return;
        settle(true);
        if (!transcript.trim()) {
          panel.open = true;
          status.textContent = 'No speech detected. Nothing was sent. Try again.';
        } else {
          status.textContent = 'Transcript added to your message.';
          composer.focus();
        }
      };
      active.start();
      if (recognition !== active) return;
      stopMeter = startVoiceMeter(waveform, () => {
        if (recognition === active && !stopping)
          recordingStatus.textContent = 'Listening · meter unavailable';
      });
      timeout = setTimeout(stop, 60_000);
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
  panel.addEventListener('toggle', render);
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
