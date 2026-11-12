import { localRecognizer, withDeadline, type LocalRecognition } from './local-speech';

export type CaptureResult = { text: string; ok: boolean; error?: string; cancelled?: boolean };
/** DOM-independent local capture. UI hosts own visibility policy; this controller never does. */
export function createVoiceCapture(callbacks: {
  result(value: CaptureResult): void;
  state?(state: 'recording' | 'finishing'): void;
}) {
  let active: LocalRecognition | undefined;
  let generation = 0;
  let pending = false;
  let text = '';
  let unfinished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  const settle = (value: CaptureResult, abort = false) => {
    const previous = active;
    active = undefined;
    pending = false;
    stopping = false;
    generation++;
    clearTimeout(timer);
    if (abort) {
      try {
        previous?.abort();
      } catch {
        /* Already ended. */
      }
    }
    callbacks.result(value);
  };
  const cancel = () => {
    if (active || pending) settle({ text: '', ok: false, cancelled: true }, true);
  };
  const finish = () => {
    if (!active || stopping) return;
    stopping = true;
    callbacks.state?.('finishing');
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        settle(
          {
            text,
            ok: false,
            error: 'Transcription did not finish. Review the captured text; nothing was sent.',
          },
          true
        ),
      8000
    );
    try {
      active.stop();
    } catch {
      settle(
        {
          text,
          ok: false,
          error: 'Could not finish dictation. Review your message before sending.',
        },
        true
      );
    }
  };
  return {
    cancel,
    finish,
    get active() {
      return !!active || pending;
    },
    get text() {
      return text;
    },
    async start(language: string, knownReady = false) {
      if (active || pending) throw new Error('A recording is already active.');
      pending = true;
      const id = ++generation;
      text = '';
      unfinished = false;
      try {
        const API = localRecognizer();
        if (!API) throw new Error('Local speech is unavailable. Use Voice setup.');
        const state = knownReady
          ? 'available'
          : await withDeadline(API.available({ langs: [language], processLocally: true }), 10000);
        if (id !== generation) return;
        if (state !== 'available')
          throw new Error(
            'Local speech needs setup. Open Voice setup to download the language pack.'
          );
        const recognition = new API();
        recognition.processLocally = true;
        if (!recognition.processLocally) throw new Error('Local processing unavailable.');
        recognition.lang = language;
        recognition.continuous = true;
        recognition.interimResults = true;
        active = recognition;
        pending = false;
        recognition.onresult = (event) => {
          if (active !== recognition) return;
          unfinished = Array.from(event.results).some((result) => result.isFinal === false);
          text = Array.from(event.results)
            .map((result) => result[0].transcript)
            .join(' ')
            .slice(0, 30000);
        };
        recognition.onerror = (event) => {
          if (active !== recognition) return;
          settle(
            {
              text,
              ok: false,
              error: `Local dictation stopped (${event.error}). Review any captured text. No cloud service was used.`,
            },
            true
          );
        };
        recognition.onend = () => {
          if (active !== recognition) return;
          settle({
            text: text.trim(),
            ok: !!text.trim() && !unfinished,
            ...(unfinished && {
              error:
                'Transcription ended before final words arrived. Review the captured text before sending.',
            }),
            ...(!text.trim() && { error: 'No speech detected. Nothing was sent.' }),
          });
        };
        recognition.start();
        if (active !== recognition) return;
        callbacks.state?.('recording');
        timer = setTimeout(finish, 60000);
      } catch (error) {
        if (id !== generation) return;
        settle(
          {
            text,
            ok: false,
            error: error instanceof Error ? error.message : 'Could not start local dictation.',
          },
          true
        );
      }
    },
  };
}
