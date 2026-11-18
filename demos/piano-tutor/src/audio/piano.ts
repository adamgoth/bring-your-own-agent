// A synthesised acoustic piano: each note is a struck string, built from its partials.
// What makes it read as "piano" rather than "synth":
// - partials are slightly sharp (string stiffness), louder at the bottom, and missing the one the
//   hammer position cancels;
// - there is no sustain level: every partial decays on its own, higher ones faster, with a quick
//   initial drop then a long tail, and low notes ring longer than high ones;
// - two strings per note, a few cents apart, for the slow beating of a real unison;
// - a short filtered noise "thunk" from the hammer, and a small room around it all.

export interface Partial {
  /** Frequency in Hz. */
  freq: number;
  /** Relative peak level; a note's levels sum to 1. */
  amp: number;
  /** Time constant of the long decay, in seconds. */
  decay: number;
}

/** The partials of one piano string at `freq` Hz. Pure, so it can be tested without audio. */
export function pianoPartials(freq: number): Partial[] {
  const ratio = 261.63 / freq;
  // Stiffer, shorter strings in the treble are more inharmonic.
  const inharmonicity = 0.00012 * Math.max(1, freq / 261.63);
  // A middle C rings for a few seconds; bass notes much longer, top notes briefly.
  const fundamentalDecay = Math.min(6, Math.max(0.25, 1.6 * ratio ** 0.8));
  const partials: Partial[] = [];
  for (let n = 1; n <= 16; n++) {
    const f = n * freq * Math.sqrt(1 + inharmonicity * n * n);
    if (f > 12000) break;
    // Hammer strikes about 1/8 along the string, so the 8th partial is (nearly) missing.
    const strike = Math.abs(Math.sin((Math.PI * n) / 8)) * 0.85 + 0.15;
    // Felt hammers roll off the top; brighter in the bass where the hammer is harder relative to pitch.
    const felt = 1 / (1 + (f / 2600) ** 2);
    const amp = (strike * felt) / n ** 1.05;
    partials.push({ freq: f, amp, decay: fundamentalDecay / (1 + 0.45 * (n - 1)) });
  }
  const total = partials.reduce((sum, p) => sum + p.amp, 0);
  return partials.map((p) => ({ ...p, amp: p.amp / total }));
}

interface Rig {
  input: GainNode;
  noise: AudioBuffer;
}
const rigs = new WeakMap<BaseAudioContext, Rig>();

/** Shared per context: a gentle compressor so chords don't clip, a short room reverb, and a noise buffer. */
function rigFor(ctx: BaseAudioContext): Rig {
  const existing = rigs.get(ctx);
  if (existing) return existing;
  const input = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 12;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  const dry = ctx.createGain();
  dry.gain.value = 0.85;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  const reverb = ctx.createConvolver();
  reverb.buffer = roomImpulse(ctx, 1.6);
  input.connect(dry).connect(compressor);
  input.connect(reverb).connect(wet).connect(compressor);
  compressor.connect(ctx.destination);
  const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.08), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const rig = { input, noise };
  rigs.set(ctx, rig);
  return rig;
}

/** Stereo decaying noise, darker as it fades: a plain small room. */
function roomImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const smoothing = 0.2 + 0.75 * t;
      low = low * smoothing + (Math.random() * 2 - 1) * (1 - smoothing);
      data[i] = low * (1 - t) ** 2.5;
    }
  }
  return buffer;
}

/** How long a damped note takes to fall silent, in seconds. */
export const DAMP_TAIL = 0.6;
/** A held key's strings stop on their own after this long; by then the sound has decayed away. */
const LONGEST_RING = 30;

/**
 * Strike one string at `freq` Hz now. It rings until the returned damper is called (or decays away);
 * calling the damper again is harmless. `gain` scales the whole note, `velocity` (0..1) also brightens it.
 */
export function strikePianoNote(ctx: BaseAudioContext, freq: number, { velocity = 0.75, gain = 1 } = {}): (at?: number) => void {
  const rig = rigFor(ctx);
  const now = ctx.currentTime + 0.005;
  const note = ctx.createGain();
  note.gain.value = gain * velocity;
  // Softer strikes are darker.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 1800 + 9000 * velocity ** 2;
  tone.Q.value = 0.5;
  note.connect(tone).connect(rig.input);

  const sources: AudioScheduledSourceNode[] = [];
  const envelopes: GainNode[] = [];
  for (const partial of pianoPartials(freq)) {
    // Lower partials get a second, slightly detuned string; the beating is what makes a unison sound alive.
    const strings = partial.freq < 1500 ? [-1.6, 1.6] : [0];
    for (const cents of strings) {
      const osc = ctx.createOscillator();
      osc.frequency.value = partial.freq;
      osc.detune.value = cents;
      const env = ctx.createGain();
      const peak = partial.amp / strings.length;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(peak, now + 0.002);
      // Prompt sound: a fast drop just after the strike...
      env.gain.setTargetAtTime(peak * 0.22, now + 0.002, Math.max(0.03, partial.decay * 0.1));
      // ...then the long aftersound.
      env.gain.setTargetAtTime(0, now + partial.decay * 0.25, partial.decay);
      osc.connect(env).connect(note);
      osc.start(now);
      osc.stop(now + LONGEST_RING);
      sources.push(osc);
      envelopes.push(env);
    }
  }

  // Hammer thunk: a few milliseconds of noise around the note's upper partials.
  const hammer = ctx.createBufferSource();
  hammer.buffer = rig.noise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = Math.min(5000, freq * 5);
  band.Q.value = 0.9;
  const thunk = ctx.createGain();
  thunk.gain.setValueAtTime(0.18 * velocity, now);
  thunk.gain.setTargetAtTime(0, now, 0.012);
  hammer.connect(band).connect(thunk).connect(note);
  hammer.start(now);
  hammer.stop(now + 0.08);

  let damped = false;
  return (at = ctx.currentTime) => {
    if (damped) return;
    damped = true;
    const when = Math.max(at, now + 0.01);
    // The damper: every partial falls away quickly from wherever its decay has got to.
    for (const env of envelopes) {
      env.gain.cancelScheduledValues(when);
      env.gain.setTargetAtTime(0, when, 0.09);
    }
    for (const source of sources) source.stop(when + DAMP_TAIL);
  };
}

/**
 * Strike each frequency now, hold for `hold` seconds (letting it decay naturally), then damp it.
 * `velocity` is 0..1 and also brightens the tone, as on a real piano.
 */
export function playPianoNotes(ctx: BaseAudioContext, frequencies: number[], { hold = 3, velocity = 0.75 } = {}) {
  const gain = 1 / Math.sqrt(Math.max(1, frequencies.length));
  const damp = ctx.currentTime + 0.005 + hold;
  for (const freq of frequencies) strikePianoNote(ctx, freq, { velocity, gain })(damp);
}
