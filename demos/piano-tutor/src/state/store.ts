import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import {
  bassDegree,
  chordsInKey,
  formatFingering,
  invertChord,
  inversionName,
  modeLabel,
  parseChord,
  prettyName,
  prettyNote,
  prettySymbol,
  suggestFingering,
  voiceChord,
  type Hand,
  type KeyChord,
  type ModeId,
  type ParsedChord,
} from '../theory';
import { browserLiveKeys, DEFAULT_SOUND, isAppAudioPlaying, playChordFunction, SOUND_IDS, type LiveKeys } from '../audio/audioEngine';
import { ListeningEngine, type HeardSnapshot } from '../listen/engine';
import { browserMidi, connectMidi, SUSTAIN_CC, type MidiEvent, type RequestMidi } from '../listen/midi';
import { matchToMidi } from '../mic/chroma';
import { MicMidiComparator, type CompareReport } from '../mic/compare';
import { BrowserMicCapture, type AudioInputOption, type MicCapture, type MicFrame } from '../mic/micCapture';
import { MicChordDetector } from '../mic/micListener';
import { detectChord as nameNotes } from '../theory';
import { Note } from 'tonal';

export type Voicing = {
  /** 0 = root position. */
  inversion: number;
  /** Notes with octaves, lowest first, e.g. ["G3", "B3", "D4", "F#4"]. */
  notes: string[];
  /** The chord as voiced, re-symbolled for inversions: Gmaj7/B. */
  chord: ParsedChord;
};

export type Fingering = { right: number[]; left: number[] };

export type ChordView = { kind: 'chord'; chord: ParsedChord; voicing: Voicing; fingering: Fingering };
export type KeyView = {
  kind: 'key';
  tonic: string;
  mode: ModeId;
  sevenths: boolean;
  scale: string[];
  chords: KeyChord[];
  /** 0-based index into chords. */
  selectedIndex: number;
  voicing: Voicing;
  fingering: Fingering;
};
export type EmptyView = { kind: 'empty' };
export type View = ChordView | KeyView | EmptyView;

export type PlayResult = { symbol: string; notes: string[]; sound: string };

export type MidiStatus = 'off' | 'connecting' | 'connected' | 'no-devices' | 'unavailable';
export type InputSource = 'midi' | 'screen' | 'mic';
export type NoteInput = { type: 'on'; note: number } | { type: 'off'; note: number } | { type: 'pedal'; down: boolean } | { type: 'all-off' };

export type MicState = {
  status: 'off' | 'starting' | 'on' | 'error';
  devices: AudioInputOption[];
  deviceId?: string;
  label?: string;
  message?: string;
  /** 0–1, for a level meter. */
  level: number;
  /** 'feed': the mic drives the listening engine. 'compare': MIDI is connected, so the mic is scored against it instead. */
  mode: 'feed' | 'compare';
  /** The mic's latest chord, shown in compare mode. */
  lastChord: string | null;
  compare: CompareReport | null;
};

export type HeardState = HeardSnapshot & {
  listening: boolean;
  midi: { status: MidiStatus; devices: string[]; message?: string };
  mic: MicState;
  /** Which input produced the latest note. */
  lastSource: InputSource | null;
};

const emptyHeard = (): HeardState => ({
  listening: false,
  midi: { status: 'off', devices: [] },
  mic: { status: 'off', devices: [], level: 0, mode: 'feed', lastChord: null, compare: null },
  lastSource: null,
  sounding: [],
  soundingMidi: [],
  chord: null,
  history: [],
  key: null,
});

/**
 * What the app is doing. Chord and key modes show what you or the agent chose and stay put;
 * listen mode follows what you play. Listening is on exactly when the mode is 'listen'.
 */
export type AppMode = 'chord' | 'key' | 'listen';
export type ListenInput = 'midi' | 'mic';

export const modeOf = (state: Pick<TutorState, 'view' | 'heard'>): AppMode =>
  state.heard.listening ? 'listen' : state.view.kind === 'key' ? 'key' : 'chord';

export type TutorState = {
  view: View;
  /** The last chord and key views shown, so switching modes can return to them. */
  lastChord: ChordView | null;
  lastKey: KeyView | null;
  sound: string;
  /** Which hand's finger numbers the keyboard labels. */
  hand: Hand;
  /** Notes sounding right now, for the keyboard to pulse. */
  sounding: string[];
  showChord: (symbol: unknown, opts?: { inversion?: unknown }) => ChordView;
  showKey: (tonic: unknown, mode: unknown, opts?: { sevenths?: unknown; degree?: unknown }) => KeyView;
  /** 0-based. */
  selectDegree: (index: unknown) => KeyView;
  setInversion: (n: unknown) => ChordView | KeyView;
  /**
   * Switch to chord or key mode, ending listening. Chord mode returns to the last chord; key mode opens the
   * key just heard (when coming from listen mode and a key was estimated), else the last key, else C major.
   */
  enterMode: (mode: 'chord' | 'key') => View;
  play: () => Promise<PlayResult>;
  /**
   * Play chords one after another, putting each on screen as it sounds. Items are degrees (1–7) or
   * numerals (I, V, vi) of the key on screen, or chord symbols (C, G, Am). Symbols in the shown key keep
   * key mode; others switch to chord mode. Resolves when the last chord has played. Stops early if
   * anything else changes the screen.
   */
  playProgression: (chords: unknown, opts?: { secondsPerChord?: unknown }) => Promise<ProgressionResult>;
  clear: () => void;
  setSound: (id: unknown) => string;
  setHand: (hand: Hand) => void;

  heard: HeardState;
  /** What listen mode hears besides the on-screen keys: a MIDI keyboard or the microphone, never both. */
  listenInput: ListenInput;
  /** Choose the input; while listening, switches over at once (disconnecting the other). */
  setListenInput: (input: ListenInput) => Promise<HeardState>;
  /** Start listening with the chosen input (MIDI by default), plus the on-screen keyboard. */
  startListening: () => Promise<HeardState>;
  stopListening: () => HeardState;
  /** Feed a note event from any input. Ignored while not listening. */
  input: (event: NoteInput, source: InputSource) => void;
  /** Forget the chord history and key estimate. */
  resetListening: () => void;
  /** Listen through a microphone (experimental). Starts listening if needed. */
  startMic: (deviceId?: string) => Promise<MicState>;
  stopMic: () => Promise<MicState>;
  /** Advance the listening clock: commits stable chords and refreshes the key estimate. */
  tick: () => void;
  /** When on, tapping an on-screen key holds it until tapped again, so chords can be built with a mouse. */
  latchTaps: boolean;
  setLatchTaps: (on: boolean) => void;
  /** Play the MIDI keyboard's keys through the app's sound. Off for keyboards with their own speakers. */
  midiSound: boolean;
  setMidiSound: (on: boolean) => void;
};

/** Plays notes now. `hold` is how long they ring before being damped, in seconds; the player picks a default. */
export type Player = (notes: string[], sound: string, opts?: { hold?: number }) => Promise<void>;

export type ProgressionResult = {
  /** Chord symbols actually played, in order. */
  played: string[];
  /** True if something else changed the screen mid-way, which stops the progression. */
  interrupted: boolean;
};

function voice(chord: ParsedChord, inversion?: number): { voicing: Voicing; fingering: Fingering } {
  const notes = voiceChord(chord, { inversion });
  const degree = bassDegree(chord);
  if (degree < 0) {
    // Bass outside the chord (C/D): one fixed voicing, no inversions.
    return {
      voicing: { inversion: 0, notes, chord },
      fingering: { right: suggestFingering(notes, 'right'), left: suggestFingering(notes, 'left') },
    };
  }
  const n = inversion ?? degree;
  const voiced = invertChord(chord, n);
  return {
    voicing: { inversion: n, notes, chord: voiced },
    fingering: { right: suggestFingering(notes, 'right'), left: suggestFingering(notes, 'left') },
  };
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

/** One chord of a progression, as the view that shows it. See TutorState.playProgression. */
function progressionStep(item: unknown, start: View): ChordView | KeyView {
  const inKey = (index: number): KeyView => {
    if (start.kind !== 'key') throw new Error(`"${String(item)}" is a degree of a key, but no key is shown. Show a key first, or use chord names like C or Am.`);
    return { ...start, selectedIndex: index, ...voice(start.chords[index].chord) };
  };
  const text = typeof item === 'number' ? String(item) : typeof item === 'string' ? item.trim() : '';
  if (!text) throw new Error('Each chord must be a name like "Am", a numeral like "vi", or a degree from 1 to 7.');
  if (/^\d+$/.test(text)) {
    const degree = Number(text);
    if (degree < 1 || degree > 7) throw new Error(`Degree ${degree} is not in a key; use 1 to 7.`);
    return inKey(degree - 1);
  }
  // Roman numerals (I, V, vi, vii°): position in the key, whatever their case.
  const roman = /^([ivIV]+)(?:°|ø|o|dim)?$/.exec(text);
  if (roman && ROMAN.includes(roman[1].toLowerCase())) return inKey(ROMAN.indexOf(roman[1].toLowerCase()));
  // A chord of the shown key stays in the key, so the strip highlights it.
  if (start.kind === 'key') {
    const index = start.chords.findIndex((c) => c.symbol === text);
    if (index >= 0) return inKey(index);
  }
  const chord = parseChord(text);
  return { kind: 'chord', chord, ...voice(chord) };
}

function toInt(value: unknown, what: string): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new Error(`${what} must be a whole number.`);
  return n;
}

export type StoreOptions = {
  player?: Player;
  requestMidi?: RequestMidi;
  /** Milliseconds; performance.now in the browser. */
  now?: () => number;
  /** Repeating timer for the listening clock; returns a cancel function. */
  every?: (fn: () => void, ms: number) => () => void;
  mic?: MicCapture;
  /** True while the app's own sound is playing; the mic ignores what it hears then. */
  appAudioPlaying?: () => boolean;
  /** Sounds MIDI keys as they are held; the browser's Web Audio by default. */
  liveKeys?: LiveKeys;
  /** Waits between a progression's chords; setTimeout by default. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultEvery = (fn: () => void, ms: number) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

export function createTutorStore(options: Player | StoreOptions = {}): StoreApi<TutorState> {
  const opts: StoreOptions = typeof options === 'function' ? { player: options } : options;
  const player = opts.player ?? playChordFunction;
  const requestMidi = opts.requestMidi ?? browserMidi;
  const now = opts.now ?? (() => performance.now());
  const every = opts.every ?? defaultEvery;
  const appAudioPlaying = opts.appAudioPlaying ?? (() => isAppAudioPlaying());
  const liveKeys = opts.liveKeys ?? browserLiveKeys;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  /** Bumped whenever a progression should stop; each step checks it's still the current run. */
  let progressionRun = 0;

  const engine = new ListeningEngine();
  const detector = new MicChordDetector();
  const comparator = new MicMidiComparator();
  let micCapture: MicCapture | null = opts.mic ?? null;
  let micNotes: number[] = [];
  let lastTruthAt = -Infinity;
  let lastLevelAt = -Infinity;
  let stopTimer: (() => void) | null = null;
  let disconnectMidi: (() => void) | null = null;
  let lastSignature = '';

  return createStore<TutorState>()((set, get) => {
    const publish = (extra: Partial<HeardState> = {}) => {
      const snap = engine.snapshot();
      const k = snap.key;
      const signature = [snap.sounding.join(' '), snap.chord?.symbol, snap.chord?.at, snap.history.length, k?.tonic, k?.mode, k ? Math.round(k.confidence * 20) : '', JSON.stringify(extra)].join('|');
      if (signature === lastSignature) return;
      lastSignature = signature;
      set({ heard: { ...get().heard, ...snap, ...extra } });
      followHeardChord();
    };

    /**
     * While listening, the chord panel follows what is played: each newly recognised chord (a new
     * commit, repeats included) replaces whatever is shown, a key included, with that chord.
     * Names the panel can't show are skipped, leaving the view as it was.
     */
    /** Every view change goes through here, so the last chord and key are remembered for mode switches. */
    const setView = (view: View) => {
      set({
        view,
        ...(view.kind === 'chord' ? { lastChord: view } : {}),
        ...(view.kind === 'key' ? { lastKey: view } : {}),
      });
    };
    /** Showing something on purpose (by the person or the agent) leaves listen mode. */
    const endListening = () => {
      if (get().heard.listening) get().stopListening();
    };

    let followedAt = -Infinity;
    const followHeardChord = () => {
      const { listening, chord } = get().heard;
      if (!listening || !chord || chord.at <= followedAt) return;
      followedAt = chord.at;
      try {
        const parsed = parseChord(chord.symbol);
        setView({ kind: 'chord', chord: parsed, ...voice(parsed) });
      } catch {
        /* not a chord symbol the panel understands; keep what's shown */
      }
    };

    /** Connect MIDI for listening; reports no devices or unavailability in heard.midi instead of throwing. */
    const connectMidiInput = async () => {
      set({ heard: { ...get().heard, midi: { status: 'connecting', devices: [] } } });
      try {
        const access = await requestMidi();
        // Stopped, or switched to the mic, while waiting for permission.
        if (!get().heard.listening || get().listenInput !== 'midi') {
          if (get().heard.midi.status === 'connecting') set({ heard: { ...get().heard, midi: { status: 'off', devices: [] } } });
          return;
        }
        disconnectMidi = connectMidi(access, onMidi, (devices) => {
          const before = get().heard.midi.devices;
          set({ heard: { ...get().heard, midi: { status: devices.length ? 'connected' : 'no-devices', devices } } });
          // A keyboard unplugged mid-note never sends its note-offs.
          if (before.some((name) => !devices.includes(name))) {
            liveKeys.allUp();
            engine.allOff(now());
            publish({ lastSource: 'midi' });
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'MIDI is not available.';
        set({ heard: { ...get().heard, midi: { status: 'unavailable', devices: [], message } } });
      }
    };
    const disconnectMidiInput = () => {
      disconnectMidi?.();
      disconnectMidi = null;
      liveKeys.allUp();
      engine.allOff(now());
      publish({ lastSource: get().heard.lastSource });
      set({ heard: { ...get().heard, midi: { status: 'off', devices: [] } } });
    };

    const setMic = (next: Partial<MicState>) => set({ heard: { ...get().heard, mic: { ...get().heard.mic, ...next } } });
    const compareMode = () => get().heard.midi.status === 'connected';

    // Every chord MIDI commits (repeats included) is ground truth for the mic comparison.
    const recordTruth = () => {
      const { mic, chord } = get().heard;
      if (mic.status !== 'on' || !compareMode() || !chord || chord.at <= lastTruthAt) return;
      lastTruthAt = chord.at;
      comparator.addTruth(chord.symbol, chord.at);
    };

    const releaseMicNotes = (t: number) => {
      for (const note of micNotes) engine.noteOff(note, t);
      micNotes = [];
    };

    const onMicFrame = (frame: MicFrame) => {
      if (frame.t - lastLevelAt > 120) {
        lastLevelAt = frame.t;
        const level = Math.min(1, Math.round(Math.sqrt(frame.rms) * 4 * 20) / 20);
        if (level !== get().heard.mic.level) setMic({ level });
      }
      // The app's own playback, heard through the speakers, is not the person playing.
      if (appAudioPlaying()) {
        detector.reset();
        if (micNotes.length) {
          releaseMicNotes(now());
          publish({ lastSource: 'mic' });
        }
        return;
      }
      for (const event of detector.push(frame)) {
        const t = now();
        if (event.type === 'chord') {
          const notes = matchToMidi(event.match);
          const symbol = nameNotes(notes.map((n) => Note.fromMidiSharps(n)))[0] ?? null;
          if (compareMode()) {
            // MIDI may have connected while the mic was feeding: let go of what it held.
            if (micNotes.length) {
              releaseMicNotes(t);
              publish({ lastSource: get().heard.lastSource });
            }
            comparator.addMic(event.match, event.t);
            setMic({ mode: 'compare', lastChord: symbol });
          } else {
            releaseMicNotes(t);
            for (const note of notes) engine.noteOn(note, t);
            micNotes = notes;
            setMic({ mode: 'feed', lastChord: symbol });
            publish({ lastSource: 'mic' });
          }
        } else if (micNotes.length) {
          releaseMicNotes(t);
          publish({ lastSource: 'mic' });
        }
      }
    };

    const onMidi = (event: MidiEvent) => {
      // Only the sustain pedal matters for listening; other controllers are ignored.
      if (event.type === 'cc' && event.controller !== SUSTAIN_CC) return;
      const t = now();
      const sound = get().midiSound;
      if (event.type === 'noteon') {
        if (sound) liveKeys.keyDown(event.note, event.velocity, get().sound);
        engine.noteOn(event.note, t);
      } else if (event.type === 'noteoff') {
        liveKeys.keyUp(event.note);
        engine.noteOff(event.note, t);
      } else {
        liveKeys.pedal(event.value >= 64);
        engine.pedal(event.value >= 64, t);
      }
      publish({ lastSource: 'midi' });
      recordTruth();
    };

    return {
    heard: emptyHeard(),

    async startListening() {
      progressionRun++;
      if (!get().heard.listening) {
        // Only chords played from now on take over the panel, not one left over from before.
        followedAt = get().heard.chord?.at ?? -Infinity;
        set({ heard: { ...get().heard, listening: true, midi: { status: 'off', devices: [] } } });
        stopTimer = every(() => get().tick(), 100);
        if (get().listenInput === 'mic') await get().startMic(get().heard.mic.deviceId);
        else await connectMidiInput();
      }
      return get().heard;
    },

    listenInput: 'midi',
    async setListenInput(input) {
      if (input !== 'midi' && input !== 'mic') throw new Error('Input must be "midi" or "mic".');
      const before = get().listenInput;
      set({ listenInput: input });
      if (!get().heard.listening || before === input) return get().heard;
      if (input === 'mic') {
        disconnectMidiInput();
        await get().startMic(get().heard.mic.deviceId);
      } else {
        await get().stopMic();
        await connectMidiInput();
      }
      return get().heard;
    },

    stopListening() {
      if (get().heard.mic.status !== 'off') void get().stopMic();
      disconnectMidi?.();
      disconnectMidi = null;
      liveKeys.allUp();
      stopTimer?.();
      stopTimer = null;
      engine.allOff(now());
      lastSignature = '';
      set({ heard: { ...get().heard, ...engine.snapshot(), listening: false, midi: { status: 'off', devices: [] }, mic: { ...get().heard.mic, status: 'off', level: 0 } } });
      return get().heard;
    },

    input(event, source) {
      if (!get().heard.listening) return;
      const t = now();
      if (event.type === 'on') engine.noteOn(event.note, t);
      else if (event.type === 'off') engine.noteOff(event.note, t);
      else if (event.type === 'pedal') engine.pedal(event.down, t);
      else engine.allOff(t);
      publish({ lastSource: source });
    },

    resetListening() {
      engine.reset();
      comparator.reset();
      lastTruthAt = -Infinity;
      if (get().heard.mic.compare) setMic({ compare: comparator.report() });
      lastSignature = '';
      set({ heard: { ...get().heard, ...engine.snapshot() } });
    },

    tick() {
      const t = now();
      engine.update(t);
      publish();
      recordTruth();
      const { mic } = get().heard;
      if (mic.status === 'on' && compareMode()) {
        comparator.settle(t);
        const report = comparator.report();
        if (JSON.stringify(report) !== JSON.stringify(mic.compare)) setMic({ compare: report });
      }
    },

    async startMic(deviceId) {
      if (!get().heard.listening) await get().startListening();
      micCapture ??= new BrowserMicCapture();
      setMic({ status: 'starting', message: undefined });
      // Switching devices: whatever the old one was holding is over.
      if (micNotes.length) {
        releaseMicNotes(now());
        publish({ lastSource: get().heard.lastSource });
      }
      try {
        detector.reset();
        const session = await micCapture.start(onMicFrame, deviceId);
        setMic({ status: 'on', devices: session.devices, deviceId: session.deviceId, label: session.label, mode: compareMode() ? 'compare' : 'feed' });
      } catch (error) {
        const message = error instanceof Error && error.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow the microphone for this page and try again.'
          : error instanceof Error ? error.message : 'Could not start the microphone.';
        setMic({ status: 'error', message });
      }
      return get().heard.mic;
    },

    async stopMic() {
      await micCapture?.stop();
      releaseMicNotes(now());
      detector.reset();
      setMic({ status: 'off', level: 0, lastChord: null });
      publish({ lastSource: get().heard.lastSource });
      return get().heard.mic;
    },

    latchTaps: false,
    setLatchTaps(on) {
      if (!on) get().input({ type: 'all-off' }, 'screen');
      set({ latchTaps: on });
    },

    midiSound: true,
    setMidiSound(on) {
      if (!on) liveKeys.allUp();
      set({ midiSound: Boolean(on) });
    },

    view: { kind: 'empty' },
    lastChord: null,
    lastKey: null,
    sound: DEFAULT_SOUND,
    hand: 'right',
    sounding: [],

    showChord(symbol, opts = {}) {
      const chord = parseChord(symbol);
      const inversion = opts.inversion === undefined || opts.inversion === null ? undefined : toInt(opts.inversion, 'Inversion');
      const view: ChordView = { kind: 'chord', chord, ...voice(chord, inversion) };
      endListening();
      setView(view);
      return view;
    },

    showKey(tonic, mode, opts = {}) {
      const sevenths = opts.sevenths === undefined ? false : Boolean(opts.sevenths);
      const key = chordsInKey(tonic, mode, { sevenths });
      const index = opts.degree === undefined ? 0 : toInt(opts.degree, 'Degree');
      if (index < 0 || index > 6) throw new Error('Degree must be from 0 to 6.');
      const view: KeyView = { kind: 'key', ...key, selectedIndex: index, ...voice(key.chords[index].chord) };
      endListening();
      setView(view);
      return view;
    },

    enterMode(mode) {
      const { view, heard, lastChord, lastKey } = get();
      const fromListening = heard.listening;
      endListening();
      if (mode === 'chord') {
        const next: View = view.kind === 'chord' ? view : lastChord ?? { kind: 'empty' };
        setView(next);
        return next;
      }
      if (view.kind === 'key' && !fromListening) return view;
      const heardKey = heard.key ? { tonic: heard.key.tonic, mode: heard.key.mode } : null;
      const pick = (fromListening ? heardKey : null) ?? (lastKey ? { tonic: lastKey.tonic, mode: lastKey.mode } : null) ?? heardKey ?? { tonic: 'C', mode: 'major' };
      const sevenths = lastKey?.sevenths ?? false;
      if (lastKey && lastKey.tonic === pick.tonic && lastKey.mode === pick.mode) {
        setView(lastKey);
        return lastKey;
      }
      return get().showKey(pick.tonic, pick.mode, { sevenths });
    },

    selectDegree(input) {
      const { view } = get();
      if (view.kind !== 'key') throw new Error('No key is shown. Show a key first, then pick a chord in it.');
      const index = toInt(input, 'Degree');
      if (index < 0 || index > 6) throw new Error('A key has seven chords; pick degree 1 to 7.');
      const next: KeyView = { ...view, selectedIndex: index, ...voice(view.chords[index].chord) };
      endListening();
      setView(next);
      return next;
    },

    setInversion(input) {
      const { view } = get();
      if (view.kind === 'empty') throw new Error('No chord is shown. Show a chord first, then choose an inversion.');
      const n = toInt(input, 'Inversion');
      const base = view.kind === 'chord' ? view.chord : view.chords[view.selectedIndex].chord;
      if (bassDegree(base) < 0) {
        throw new Error(`${base.symbol} has a bass note outside the chord, so it has no inversions. Show ${base.symbol.split('/')[0]} to invert it.`);
      }
      const next = { ...view, ...voice(base, n) };
      endListening();
      setView(next);
      return next;
    },

    async play() {
      const { view, sound } = get();
      if (view.kind === 'empty') throw new Error('Nothing to play yet. Show a chord or a key first.');
      const { notes, chord } = view.voicing;
      set({ sounding: notes });
      try {
        await player(notes, sound);
      } catch (error) {
        set({ sounding: [] });
        throw error;
      }
      setTimeout(() => {
        if (get().sounding === notes) set({ sounding: [] });
      }, 1200);
      return { symbol: chord.symbol, notes, sound };
    },

    async playProgression(chords, opts = {}) {
      if (!Array.isArray(chords) || chords.length === 0) throw new Error('Give the chords to play, for example ["C", "G", "Am", "F"] or [1, 5, 6, 4].');
      if (chords.length > 8) throw new Error('Play at most eight chords at a time.');
      const seconds = opts.secondsPerChord === undefined || opts.secondsPerChord === null ? 1.6 : Number(opts.secondsPerChord);
      if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 4) throw new Error('Seconds per chord must be from 0.5 to 4.');

      // Work out every chord before playing any, so a bad one fails without half a progression.
      const start = get().view;
      const steps: Array<ChordView | KeyView> = chords.map((item) => progressionStep(item, start));

      endListening();
      const run = ++progressionRun;
      const { sound } = get();
      const played: string[] = [];
      let interrupted = false;
      for (const [i, step] of steps.entries()) {
        // Someone picked something else (a tap, the agent, listening): leave their choice alone.
        if (run !== progressionRun || (i > 0 && get().view !== steps[i - 1])) {
          interrupted = true;
          break;
        }
        setView(step);
        const notes = step.voicing.notes;
        set({ sounding: notes });
        const last = i === steps.length - 1;
        try {
          // Damp each chord as the next one starts, like a pianist would; let the last one ring.
          await player(notes, sound, { hold: last ? Math.max(seconds, 2.5) : seconds });
        } catch (error) {
          set({ sounding: [] });
          if (played.length === 0) throw error;
          interrupted = true;
          break;
        }
        played.push(step.voicing.chord.symbol);
        await sleep((last ? Math.min(seconds, 1.2) : seconds) * 1000);
      }
      if (get().sounding.length && run === progressionRun) set({ sounding: [] });
      return { played, interrupted };
    },

    clear() {
      progressionRun++;
      set({ view: { kind: 'empty' }, sounding: [] });
    },

    setSound(id) {
      if (typeof id !== 'string' || !SOUND_IDS.includes(id)) {
        throw new Error(`Unknown sound "${String(id)}". Choose one of: ${SOUND_IDS.join(', ')}.`);
      }
      set({ sound: id });
      return id;
    },

    setHand(hand) {
      set({ hand });
    },
    };
  });
}

/** The app's single store. The UI and the WebMCP tools both call its actions. */
export const tutorStore = createTutorStore();

export function useTutor<T>(selector: (state: TutorState) => T): T {
  return useStore(tutorStore, selector);
}

/** Notes joined for people: "G3 B3 D4 F♯4". */
export const spokenNotes = (notes: string[]): string => notes.map(prettyNote).join(' ');

/** One-line plain-text description of what is on screen, shared by the aria-live line and the tools. */
export function describeView(view: View): string {
  if (view.kind === 'empty') return 'Nothing shown. Ask for a chord or a key.';
  const { voicing, fingering } = view;
  const chordLine = `${prettySymbol(voicing.chord.symbol)}, ${prettyName(voicing.chord.name)}, ${inversionName(voicing.inversion)}: ${spokenNotes(voicing.notes)}. Right hand ${formatFingering(fingering.right)}, left hand ${formatFingering(fingering.left)}.`;
  if (view.kind === 'chord') return chordLine;
  const selected = view.chords[view.selectedIndex];
  return `${prettyNote(view.tonic)} ${modeLabel(view.mode).toLowerCase()} ${view.sevenths ? 'seventh chords' : 'triads'}: ${view.chords.map((c) => `${c.numeral} ${prettySymbol(c.symbol)}`).join(', ')}. Selected ${selected.numeral}, ${chordLine}`;
}
