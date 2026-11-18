import type { StoreApi } from 'zustand/vanilla';
import { describeView, modeOf, type ChordView, type KeyView, type TutorState, type View } from '../state/store';
import { formatFingering, inversionName, MODES, modeLabel } from '../theory';
import { serialiseHeard } from '../listen/describe';

/** A tool as WebMCP sees it. No browser dependency. */
export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

export type ToolError = { error: string };

/** Errors come back as `{ error }` so the agent can read them and tell the user what to do. */
const safe =
  (action: (input: Record<string, unknown>) => unknown) =>
  async (input: Record<string, unknown>): Promise<unknown> => {
    try {
      return await action(input ?? {});
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'The action could not be completed.' } satisfies ToolError;
    }
  };

function shownChord(view: ChordView | KeyView) {
  const { voicing, fingering } = view;
  return {
    symbol: voicing.chord.symbol,
    name: voicing.chord.name,
    inversion: voicing.inversion,
    inversionName: inversionName(voicing.inversion),
    notes: voicing.notes,
    fingering: {
      right: formatFingering(fingering.right),
      left: formatFingering(fingering.left),
      note: 'Suggested fingering, 1 = thumb, 5 = little finger, listed lowest note first.',
    },
  };
}

function keySummary(view: KeyView) {
  return {
    key: `${view.tonic} ${modeLabel(view.mode).toLowerCase()}`,
    tonic: view.tonic,
    mode: view.mode,
    sevenths: view.sevenths,
    scale: view.scale,
    chords: view.chords.map((c) => ({ degree: c.degree, numeral: c.numeral, symbol: c.symbol, name: c.name, notes: c.notes })),
    selected: { degree: view.selectedIndex + 1, numeral: view.chords[view.selectedIndex].numeral, ...shownChord(view) },
  };
}

export function serialiseView(view: View) {
  if (view.kind === 'empty') return { view: 'empty' as const, summary: describeView(view) };
  if (view.kind === 'chord') return { view: 'chord' as const, ...shownChord(view), summary: describeView(view) };
  return { view: 'key' as const, ...keySummary(view), summary: describeView(view) };
}

/** Added to a result when the call ended listening, so the agent can say so. */
const ended = (wasListening: boolean) => (wasListening ? { stoppedListening: true } : {});

const ASCII_NOTE = 'Use ASCII accidentals: # for sharp, b for flat (F#, Bb).';

export function createTools(store: StoreApi<TutorState>, now: () => number = () => performance.now()): Tool[] {
  const state = () => store.getState();
  return [
    {
      name: 'show_chord',
      description:
        'Show one chord on the piano keyboard with its notes and suggested fingering, without playing it. ' +
        'Use when the user asks how to play a chord, or names a chord with an extension or the word "chord". ' +
        'Convert speech to a chord symbol: "G major seven" → Gmaj7, "G seven" → G7, "B minor chord" → Bm, ' +
        '"F sharp minor seven flat five" or "F sharp half diminished" → F#m7b5, "B flat sus four" → Bbsus4, ' +
        '"C over E" → C/E, "A diminished" → Adim, "E flat augmented" → Ebaug, "C minor major seven" → CmMaj7. ' +
        `${ASCII_NOTE} A bare "<note> major" or "<note> minor" without "chord" or "how to play" usually means the key: use show_key. ` +
        'Optional inversion: 0 root position, 1 first, 2 second, 3 third (seventh chords only). ' +
        'To change the inversion of the chord already on screen, use set_inversion instead.' +
        ' If listening, this ends listen mode (listening stops; the chord history and key guess are kept).',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Chord symbol, e.g. Gmaj7, Bm, F#m7b5, Bbsus4, C/E.' },
          inversion: { type: 'integer', minimum: 0, maximum: 3, description: '0 = root position, 1 = first inversion, 2 = second, 3 = third.' },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
      execute: safe(({ symbol, inversion }) => {
        const wasListening = state().heard.listening;
        const view = state().showChord(symbol, { inversion });
        return { ...shownChord(view), ...ended(wasListening), summary: describeView(view) };
      }),
    },
    {
      name: 'show_key',
      description:
        'Show the seven chords of a key as a strip of roman numerals and put the first chord (I or i) on the keyboard. ' +
        'Use for "show me all the chords in A major" (tonic A, mode major) and for a bare key name such as ' +
        '"show me B minor" (tonic B, mode minor) or "E flat major" (tonic Eb, mode major). ' +
        `${ASCII_NOTE} "minor" alone means natural minor; use "harmonic minor" or "melodic minor" only when the user says so. ` +
        'Set sevenths true for seventh chords ("the seventh chords in C", "with sevenths"); otherwise triads.' +
        ' If listening, this ends listen mode (listening stops; the chord history and key guess are kept).',
      inputSchema: {
        type: 'object',
        properties: {
          tonic: { type: 'string', description: 'Key note, e.g. A, Bb, F#.' },
          mode: { type: 'string', enum: MODES.map((m) => m.id), description: 'Scale or mode of the key.' },
          sevenths: { type: 'boolean', description: 'true for seventh chords, false (default) for triads.' },
        },
        required: ['tonic', 'mode'],
        additionalProperties: false,
      },
      execute: safe(({ tonic, mode, sevenths }) => {
        const wasListening = state().heard.listening;
        const view = state().showKey(tonic, mode, { sevenths });
        return { ...keySummary(view), ...ended(wasListening), summary: describeView(view) };
      }),
    },
    {
      name: 'select_chord_in_key',
      description:
        'Put one chord of the key on screen onto the keyboard. Needs a key shown first (show_key). ' +
        'Degree is 1–7: "the five chord" or "V" → 5, "the two" or "ii" → 2, "the relative minor" in a major key → 6. ' +
        'You can also map a chord name to its degree using the chords show_key returned.' +
        ' If listening, this ends listen mode (listening stops; the chord history and key guess are kept).',
      inputSchema: {
        type: 'object',
        properties: { degree: { type: 'integer', minimum: 1, maximum: 7, description: 'Scale degree, 1 to 7.' } },
        required: ['degree'],
        additionalProperties: false,
      },
      execute: safe(({ degree }) => {
        if (typeof degree !== 'number' || !Number.isInteger(degree) || degree < 1 || degree > 7) {
          throw new Error('Degree must be a whole number from 1 to 7.');
        }
        const view = state().selectDegree(degree - 1);
        return { degree, numeral: view.chords[view.selectedIndex].numeral, ...shownChord(view), summary: describeView(view) };
      }),
    },
    {
      name: 'set_inversion',
      description:
        'Change the inversion of the chord on screen, whether it was shown alone or picked from a key. ' +
        '"first inversion" → 1, "second inversion" → 2, "third inversion" → 3, "root position" → 0. ' +
        'Triads have inversions 0–2; seventh chords 0–3.' +
        ' If listening, this ends listen mode (listening stops; the chord history and key guess are kept).',
      inputSchema: {
        type: 'object',
        properties: { inversion: { type: 'integer', minimum: 0, maximum: 3, description: '0 = root position, 1 = first, 2 = second, 3 = third.' } },
        required: ['inversion'],
        additionalProperties: false,
      },
      execute: safe(({ inversion }) => {
        const view = state().setInversion(inversion);
        return { ...shownChord(view), summary: describeView(view) };
      }),
    },
    {
      name: 'play',
      description:
        'Play the chord on screen through the speakers with the current sound ("play it", "let me hear it"). ' +
        'Browsers block audio until the user has clicked the page; if the result says audio is blocked, ' +
        'ask the user to press the Play button once, then call play again.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: safe(async () => {
        const result = await state().play();
        return { played: result.symbol, notes: result.notes, sound: result.sound, summary: `Played ${result.symbol}: ${result.notes.join(' ')}.` };
      }),
    },
    {
      name: 'play_progression',
      description:
        'Play several chords in order, one after another, showing each on the keyboard as it sounds. Use this, in one call, ' +
        'whenever the user wants to hear a progression or a sequence of chords; do not call select_chord_in_key and play ' +
        'for each chord. Give tonic (and mode) to show that key first, so the progression plays on the key strip. ' +
        'Each chord is a degree of the key (1–7), a numeral (I, V, vi, IV) or a chord name (C, G, Am, F); names outside ' +
        'the key switch to chord mode. Returns once the last chord has played. ' +
        'If listening, this ends listen mode (listening stops; the chord history and key guess are kept).',
      inputSchema: {
        type: 'object',
        properties: {
          chords: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: { type: 'string' },
            description: 'The chords in order, e.g. ["C", "G", "Am", "F"], ["I", "V", "vi", "IV"] or ["1", "5", "6", "4"].',
          },
          tonic: { type: 'string', description: `Optional: show this key first, e.g. "C" or "Bb". ${ASCII_NOTE}` },
          mode: { type: 'string', enum: MODES.map((m) => m.id), description: 'Mode of that key; defaults to major.' },
          seconds_per_chord: { type: 'number', minimum: 0.5, maximum: 4, description: 'How long each chord lasts; default 1.6.' },
        },
        required: ['chords'],
        additionalProperties: false,
      },
      execute: safe(async ({ chords, tonic, mode, seconds_per_chord }) => {
        const wasListening = state().heard.listening;
        if (tonic !== undefined) state().showKey(tonic, mode ?? 'major');
        const result = await state().playProgression(chords, { secondsPerChord: seconds_per_chord });
        const view = state().view;
        return {
          played: result.played,
          ...(result.interrupted ? { interrupted: true, note: 'Stopped early because the screen changed.' } : {}),
          ...(view.kind === 'key' ? { key: `${view.tonic} ${modeLabel(view.mode).toLowerCase()}` } : {}),
          ...ended(wasListening),
          summary: `Played ${result.played.join(' – ')}${result.interrupted ? ' (stopped early)' : ''}.`,
        };
      }),
    },
    {
      name: 'get_state',
      description:
        'Read what the screen shows now: appMode (chord, key or listen), the chord or key with its notes, inversion and ' +
        'suggested fingering. In listen mode the screen follows what the user plays; use get_listening_summary for that. ' +
        'Use before answering questions about "this chord" or "it" when you are unsure what is shown.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: safe(() => ({ ...serialiseView(state().view), appMode: modeOf(state()), sound: state().sound })),
    },
    {
      name: 'start_listening',
      description:
        'Start listening to what the user plays: one input (a MIDI keyboard, or the microphone) plus the on-screen keys. ' +
        'Use when they say "listen to me", "watch what I play" or ask what they are playing while not listening. ' +
        'Set microphone true when they ask to use the microphone or play an acoustic piano (mic chord detection is ' +
        'experimental); false to switch back to MIDI; leave it out to keep the input they last chose. This switches the screen to listen mode, which follows ' +
        'what they play until they or you show a chord or key. Listening runs locally and continuously; read it ' +
        'with get_listening_summary.',
      inputSchema: {
        type: 'object',
        properties: { microphone: { type: 'boolean', description: 'true: listen through the microphone instead of MIDI (experimental). false: MIDI.' } },
        additionalProperties: false,
      },
      execute: safe(async ({ microphone }) => {
        if (microphone === true || microphone === false) await state().setListenInput(microphone ? 'mic' : 'midi');
        await state().startListening();
        return serialiseHeard(state().heard, now());
      }),
    },
    {
      name: 'stop_listening',
      description:
        'Stop listening ("stop listening", "that\'s enough") and leave listen mode; the screen shows the last chord heard. ' +
        'The chord history and key guess are kept, so get_listening_summary still answers questions about what was played.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: safe(() => serialiseHeard(state().stopListening(), now())),
    },
    {
      name: 'get_listening_summary',
      description:
        'What the user is playing: the chord now, the notes held, the last chords with how many seconds ago, and the ' +
        'estimated key with a 0–1 confidence and the next-best key. Use for "what am I playing", "what key am I in", ' +
        '"what was that chord". Below 0.6 confidence, say the key is a guess. Relative keys (C major and A minor) are ' +
        'often close; mention both when the next best is the relative key.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: safe(() => serialiseHeard(state().heard, now())),
    },
  ];
}
