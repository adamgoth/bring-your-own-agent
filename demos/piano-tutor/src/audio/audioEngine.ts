import { DAMP_TAIL, playPianoNotes, strikePianoNote } from './piano';

// Web Audio synth. Notes carry octaves ("G3", "Bb4", "F#4"),
// so any spelling plays at its real pitch.

/** Equal-tempered frequency for a note with an octave, A4 = 440 Hz. */
export function frequencyOf(note: string): number {
  const match = /^([A-Ga-g])(#{1,2}|b{1,2})?(-?\d+)$/.exec(note.trim());
  if (!match) throw new Error(`"${note}" is not a note with an octave, such as G3 or Bb4.`);
  const [, letter, accidental = '', octave] = match;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter.toUpperCase() as 'C'];
  const shift = accidental.startsWith('#') ? accidental.length : -accidental.length;
  const midi = 12 * (Number(octave) + 1) + base + shift;
  return 440 * 2 ** ((midi - 69) / 12);
}

export const AUDIO_BLOCKED_MESSAGE = 'Audio is blocked until someone clicks Play on the page once. Ask the user to click Play, then try again.';

export interface SoundPreset {
  oscillatorType: OscillatorType;
  filterType: BiquadFilterType;
  filterFrequency: number;
  adsr: {
    attackTime: number;
    decayTime: number;
    sustainLevel: number;
    releaseTime: number;
    noteLength: number;
  };
}

// Define different sound presets
export const soundPresets: Record<string, SoundPreset> = {
  basicSine: {
    oscillatorType: 'sine',
    filterType: 'lowpass',
    filterFrequency: 1000,
    adsr: {
      attackTime: 0.1,
      decayTime: 0.2,
      sustainLevel: 0.7,
      releaseTime: 0.3,
      noteLength: 1.0,
    },
  },
  sawPad: {
    oscillatorType: 'sawtooth',
    filterType: 'lowpass',
    filterFrequency: 1200,
    adsr: {
      attackTime: 0.2,
      decayTime: 0.3,
      sustainLevel: 0.5,
      releaseTime: 0.5,
      noteLength: 2.0,
    },
  },
  pluckySquare: {
    oscillatorType: 'square',
    filterType: 'lowpass',
    filterFrequency: 2000,
    adsr: {
      attackTime: 0.05,
      decayTime: 0.1,
      sustainLevel: 0.3,
      releaseTime: 0.2,
      noteLength: 0.5,
    },
  },
  triangleChill: {
    oscillatorType: 'triangle',
    filterType: 'lowpass',
    filterFrequency: 800,
    adsr: {
      attackTime: 0.2,
      decayTime: 1.0,
      sustainLevel: 0.4,
      releaseTime: 1.0,
      noteLength: 2.0,
    },
  },

  ambientDrone: {
    oscillatorType: 'sine',
    filterType: 'lowpass',
    filterFrequency: 600,
    adsr: {
      attackTime: 2.0,
      decayTime: 2.0,
      sustainLevel: 0.8,
      releaseTime: 4.0,
      noteLength: 6.0, // A long note before release
    },
  },

  etherealOrgan: {
    oscillatorType: 'triangle',
    filterType: 'bandpass',
    filterFrequency: 500, // Focus the band on a mid-range
    adsr: {
      attackTime: 1.5,
      decayTime: 1.5,
      sustainLevel: 0.6,
      releaseTime: 3.0,
      noteLength: 4.0,
    },
  },

  brightBrass: {
    oscillatorType: 'sawtooth',
    filterType: 'lowpass',
    filterFrequency: 1800,
    adsr: {
      attackTime: 0.4,
      decayTime: 1.0,
      sustainLevel: 0.7,
      releaseTime: 1.5,
      noteLength: 3.0,
    },
  },

  spacePad: {
    oscillatorType: 'sine',
    filterType: 'lowpass',
    filterFrequency: 2000,
    adsr: {
      attackTime: 3.0, // Very slow fade in
      decayTime: 2.0,
      sustainLevel: 0.7,
      releaseTime: 4.0, // Long release
      noteLength: 8.0, // Very long hold
    },
  },

  custom: {
    oscillatorType: 'sine',
    filterType: 'lowpass',
    filterFrequency: 1000,
    adsr: {
      attackTime: 0.1,
      decayTime: 0.2,
      sustainLevel: 0.7,
      releaseTime: 0.3,
      noteLength: 1.0,
    },
  },
};

/** The default sound: a synthesised acoustic piano (see piano.ts), not one of the oscillator presets above. */
export const PIANO = 'piano';
export const DEFAULT_SOUND = PIANO;

let sharedAudioContext: AudioContext | undefined;

/** How long the piano holds a note before the damper, and how long the damped tail lasts, in seconds. */
const PIANO_HOLD = 3;
const PIANO_DAMP = 0.6;
/** Extra margin for the room's echo after the app's own sound stops. */
const ECHO_MARGIN_MS = 250;
let playingUntil = 0;
const markPlaying = (seconds: number) => {
  playingUntil = Math.max(playingUntil, performance.now() + seconds * 1000 + ECHO_MARGIN_MS);
};

/**
 * True while the app's own sound may still be audible. A microphone would hear it through the
 * speakers and mistake it for the person playing, so mic detection pauses while this is true.
 */
export const isAppAudioPlaying = (now = performance.now()) => now < playingUntil;

const contextNow = () =>
  (sharedAudioContext ??= new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)());

const playChord = async (notes: string[], sound: string, { hold = PIANO_HOLD }: { hold?: number } = {}) => {
  const frequencies = notes.map(frequencyOf);
  const audioContext = contextNow();
  if (audioContext.state !== 'running') {
    // A browser may require a physical click before allowing agent-triggered audio.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        audioContext.resume(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(AUDIO_BLOCKED_MESSAGE)), 1500);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    if ((audioContext.state as AudioContextState) !== 'running') throw new Error(AUDIO_BLOCKED_MESSAGE);
  }

  if (sound === PIANO) {
    playPianoNotes(audioContext, frequencies, { hold });
    markPlaying(hold + PIANO_DAMP);
    return;
  }

  // Default to basicSine if preset isn't found
  const preset =
    soundPresets[sound as keyof typeof soundPresets] || soundPresets.basicSine;
  markPlaying(preset.adsr.noteLength + preset.adsr.releaseTime);

  // Master gain for overall volume
  const masterGain = audioContext.createGain();
  masterGain.gain.setValueAtTime(0.1, audioContext.currentTime);
  masterGain.connect(audioContext.destination);

  frequencies.forEach((frequency) => {
    const oscillator = audioContext.createOscillator();
    oscillator.type = preset.oscillatorType as OscillatorType;
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

    // Create a filter to shape the sound
    const filter = audioContext.createBiquadFilter();
    filter.type = preset.filterType as BiquadFilterType;
    filter.frequency.setValueAtTime(
      preset.filterFrequency,
      audioContext.currentTime,
    );

    // Create a gain node for the envelope
    const envelopeGain = audioContext.createGain();
    envelopeGain.gain.setValueAtTime(0, audioContext.currentTime);

    // Connect nodes: oscillator -> filter -> envelope -> master
    oscillator.connect(filter);
    filter.connect(envelopeGain);
    envelopeGain.connect(masterGain);

    // Read ADSR parameters
    const { attackTime, decayTime, sustainLevel, releaseTime, noteLength } =
      preset.adsr;
    const now = audioContext.currentTime;

    // Attack
    envelopeGain.gain.linearRampToValueAtTime(1.0, now + attackTime);
    // Decay
    envelopeGain.gain.linearRampToValueAtTime(
      sustainLevel,
      now + attackTime + decayTime,
    );

    // Start the oscillator
    oscillator.start(now);

    // We'll begin the release after noteLength
    const releaseStart = now + noteLength;
    oscillator.stop(releaseStart + releaseTime);

    // Sustain until release
    envelopeGain.gain.setValueAtTime(sustainLevel, releaseStart);
    // Release
    envelopeGain.gain.linearRampToValueAtTime(0, releaseStart + releaseTime);
  });
};

/** Play notes with octaves as a block chord. Rejects with AUDIO_BLOCKED_MESSAGE if the browser blocks audio. */
export const playChordFunction = (notes: string[], sound: string, opts?: { hold?: number }) => {
  return playChord(notes, sound, opts);
};

/** Preset ids in menu order, with readable labels. */
export const SOUND_LABELS: Record<string, string> = {
  [PIANO]: 'Piano',
  basicSine: 'Basic sine',
  sawPad: 'Saw pad',
  pluckySquare: 'Plucky square',
  triangleChill: 'Triangle chill',
  ambientDrone: 'Ambient drone',
  etherealOrgan: 'Ethereal organ',
  brightBrass: 'Bright brass',
  spacePad: 'Space pad',
};

/** Sound ids that can be chosen: the piano plus every oscillator preset except the internal "custom". */
export const SOUND_IDS = Object.keys(SOUND_LABELS);

// Live keys: a key played on a MIDI keyboard sounds from key-down until key-up, like a real piano,
// rather than as a fixed-length note. The sustain pedal holds released keys until it lifts.

/** Damps one held key: at an audio-clock time, or now. */
type Damper = (at?: number) => void;
const held = new Map<number, Damper>();
/** Keys let go while the pedal was down: still sounding until the pedal lifts. */
const pedalled = new Map<number, Damper>();
let pedalDown = false;

const midiFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A held oscillator-preset note: attack and decay to the preset's sustain level, release on key-up. */
function strikePresetNote(ctx: AudioContext, freq: number, preset: SoundPreset, velocity: number): Damper {
  const { attackTime, decayTime, sustainLevel, releaseTime } = preset.adsr;
  const now = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.1 * velocity;
  out.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = preset.oscillatorType;
  osc.frequency.value = freq;
  const filter = ctx.createBiquadFilter();
  filter.type = preset.filterType;
  filter.frequency.value = preset.filterFrequency;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(1, now + attackTime);
  env.gain.linearRampToValueAtTime(sustainLevel, now + attackTime + decayTime);
  osc.connect(filter).connect(env).connect(out);
  osc.start(now);
  let released = false;
  return (at = ctx.currentTime) => {
    if (released) return;
    released = true;
    env.gain.cancelScheduledValues(at);
    env.gain.setTargetAtTime(0, at, Math.max(0.02, releaseTime / 4));
    osc.stop(at + releaseTime + 0.1);
  };
}

/**
 * Sound a key now and hold it until keyUp. `velocity` is MIDI's 1..127. Silently does nothing while
 * the browser still blocks audio (no click on the page yet); the next key after a click will sound.
 */
export function keyDown(midi: number, velocity: number, sound: string) {
  // No Web Audio here (tests, very old browsers): the keys still feed listening, just silently.
  if (typeof window === 'undefined' || !(window.AudioContext || 'webkitAudioContext' in window)) return;
  const ctx = contextNow();
  if (ctx.state !== 'running') {
    void ctx.resume().catch(() => {});
    if ((ctx.state as AudioContextState) !== 'running') return;
  }
  // Striking a key that is still ringing (held or pedalled) damps the old strike first.
  held.get(midi)?.();
  pedalled.get(midi)?.();
  pedalled.delete(midi);
  // Velocity curve: soft playing stays audible, hard playing gets louder and brighter.
  const v = Math.max(0.15, Math.min(1, velocity / 127)) ** 0.7;
  const damp = sound === PIANO
    ? strikePianoNote(ctx, midiFrequency(midi), { velocity: v, gain: 0.7 })
    : strikePresetNote(ctx, midiFrequency(midi), soundPresets[sound] ?? soundPresets.basicSine, v);
  held.set(midi, damp);
  markPlaying(PIANO_HOLD);
}

export function keyUp(midi: number) {
  const damp = held.get(midi);
  if (!damp) return;
  held.delete(midi);
  if (pedalDown) pedalled.set(midi, damp);
  else {
    damp();
    markPlaying(DAMP_TAIL);
  }
}

export function sustainPedal(down: boolean) {
  pedalDown = down;
  if (down) return;
  pedalled.forEach((damp) => damp());
  pedalled.clear();
  markPlaying(DAMP_TAIL);
}

/** Damp every live key, e.g. when the keyboard disconnects mid-note. */
export function allKeysUp() {
  held.forEach((damp) => damp());
  pedalled.forEach((damp) => damp());
  held.clear();
  pedalled.clear();
  pedalDown = false;
}

export interface LiveKeys {
  keyDown: (midi: number, velocity: number, sound: string) => void;
  keyUp: (midi: number) => void;
  pedal: (down: boolean) => void;
  allUp: () => void;
}
export const browserLiveKeys: LiveKeys = { keyDown, keyUp, pedal: sustainPedal, allUp: allKeysUp };
