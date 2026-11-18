// Piano-like test audio: stretched (inharmonic) partials with faster decay up the series,
// a short hammer-noise burst, rolled onsets and slight detuning. Not a piano, but it has the
// properties that make chroma hard: strong upper partials, sharp octaves and transients.

export const SAMPLE_RATE = 48000;

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function addNote(out: Float32Array, startSample: number, durationS: number, midi: number, velocity: number, random: () => number): void {
  const sr = SAMPLE_RATE;
  const detune = (random() - 0.5) * 12; // ±6 cents
  const f0 = 440 * 2 ** ((midi - 69 + detune / 100) / 12);
  const B = midi < 48 ? 0.0006 : midi < 72 ? 0.0003 : 0.0008;
  const length = Math.min(out.length - startSample, Math.floor(durationS * sr));
  const releaseS = 0.08;
  for (let k = 1; k <= 16; k += 1) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > 7000) break;
    const amp = (velocity / k ** 1.2) * (0.75 + 0.5 * random());
    const tau = (f0 < 200 ? 2.2 : 1.5) / (1 + 0.3 * k);
    const phase = random() * 2 * Math.PI;
    const w = (2 * Math.PI * fk) / sr;
    for (let n = 0; n < length; n += 1) {
      const t = n / sr;
      const attack = Math.min(1, t / 0.004);
      const release = t > durationS - releaseS ? Math.max(0, (durationS - t) / releaseS) : 1;
      out[startSample + n] += amp * attack * release * Math.exp(-t / tau) * Math.sin(w * n + phase);
    }
  }
  // Hammer thump: 15 ms of decaying noise.
  for (let n = 0; n < Math.min(length, 0.015 * sr); n += 1) {
    out[startSample + n] += velocity * 0.15 * (random() * 2 - 1) * Math.exp(-n / (0.004 * sr));
  }
}

export function addNoise(out: Float32Array, level: number, random: () => number): void {
  for (let i = 0; i < out.length; i += 1) out[i] += level * (random() * 2 - 1);
}
