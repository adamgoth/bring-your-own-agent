// Chord recognition from a magnitude spectrum: peak picking → 12-bin chroma → match against
// harmonic-aware chord templates, with the lowest strong peak read as the bass.

export type Spectrum = { magnitudes: Float32Array | number[]; sampleRate: number; fftSize: number };

export type LowPeak = { pc: number; hz: number; magnitude: number };

export type ChromaFrame = {
  chroma: number[];
  /** Spectral peaks below ~450 Hz, lowest first: bass candidates. */
  lowPeaks: LowPeak[];
};

export const CHORD_TYPES = [
  { id: 'maj', suffix: '', intervals: [0, 4, 7], penalty: 0 },
  { id: 'min', suffix: 'm', intervals: [0, 3, 7], penalty: 0 },
  { id: 'dim', suffix: 'dim', intervals: [0, 3, 6], penalty: 0.005 },
  { id: 'aug', suffix: 'aug', intervals: [0, 4, 8], penalty: 0.02 },
  { id: 'sus2', suffix: 'sus2', intervals: [0, 2, 7], penalty: 0.02 },
  { id: 'sus4', suffix: 'sus4', intervals: [0, 5, 7], penalty: 0.02 },
  { id: '7', suffix: '7', intervals: [0, 4, 7, 10], penalty: 0.003 },
  { id: 'maj7', suffix: 'maj7', intervals: [0, 4, 7, 11], penalty: 0.003 },
  { id: 'm7', suffix: 'm7', intervals: [0, 3, 7, 10], penalty: 0.003 },
  { id: 'm7b5', suffix: 'm7b5', intervals: [0, 3, 6, 10], penalty: 0.003 },
  { id: 'dim7', suffix: 'dim7', intervals: [0, 3, 6, 9], penalty: 0.005 },
] as const;

export type ChordTypeId = (typeof CHORD_TYPES)[number]['id'];

export type ChordMatch = {
  root: number;
  type: ChordTypeId;
  pitchClasses: number[];
  bassPc: number | null;
  score: number;
};

/** Relative chroma weight of partials 1–6 by the time a chord has settled (upper partials decay first). Tuned on synthetic audio (see testAudio.ts). */
const PARTIALS = [
  { semis: 0, weight: 1 },
  { semis: 0, weight: 0.6 },
  { semis: 7, weight: 0.35 },
  { semis: 0, weight: 0.3 },
  { semis: 4, weight: 0.2 },
  { semis: 7, weight: 0.15 },
];

function templateFor(pcs: number[]): number[] {
  const t = new Array<number>(12).fill(0);
  for (const pc of pcs) for (const p of PARTIALS) t[(pc + p.semis) % 12] += p.weight;
  return t;
}

const TEMPLATES = CHORD_TYPES.flatMap((type) =>
  Array.from({ length: 12 }, (_, root) => {
    const pitchClasses = type.intervals.map((i) => (root + i) % 12);
    return { root, type: type.id, pitchClasses, penalty: type.penalty, template: templateFor(pitchClasses) };
  }),
);

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export function spectrumToChroma({ magnitudes, sampleRate, fftSize }: Spectrum, { minHz = 50, maxHz = 2100, bassMaxHz = 450, bassFloor = 0.05 } = {}): ChromaFrame {
  const binHz = sampleRate / fftSize;
  const lo = Math.max(2, Math.floor(minHz / binHz));
  const hi = Math.min(magnitudes.length - 2, Math.ceil(maxHz / binHz));
  let max = 0;
  for (let i = lo; i <= hi; i += 1) if (magnitudes[i] > max) max = magnitudes[i];
  const chroma = new Array<number>(12).fill(0);
  if (max <= 0) return { chroma, lowPeaks: [] };
  const floor = max * 0.02;
  const lowPeaks: LowPeak[] = [];
  for (let i = lo; i <= hi; i += 1) {
    const m = magnitudes[i];
    if (m < floor || m <= magnitudes[i - 1] || m < magnitudes[i + 1]) continue;
    // Parabolic interpolation on log magnitude for a sub-bin frequency.
    const a = Math.log(magnitudes[i - 1] + 1e-12);
    const b = Math.log(m + 1e-12);
    const c = Math.log(magnitudes[i + 1] + 1e-12);
    const offset = (a - 2 * b + c) === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c);
    const freq = (i + offset) * binHz;
    const pitch = 69 + 12 * Math.log2(freq / 440);
    const nearest = Math.round(pitch);
    if (Math.abs(pitch - nearest) > 0.4) continue; // between semitones: noise or a stretched partial
    const pc = ((nearest % 12) + 12) % 12;
    chroma[pc] += Math.sqrt(m);
    if (freq <= bassMaxHz && m >= max * bassFloor) lowPeaks.push({ pc, hz: freq, magnitude: m });
  }
  return { chroma, lowPeaks };
}

/** Best chord for a chroma frame, or null when nothing fits well. */
export function matchChord({ chroma, lowPeaks }: ChromaFrame, minScore = 0.7): ChordMatch | null {
  let best: ChordMatch | null = null;
  let bestScore = -Infinity;
  for (const t of TEMPLATES) {
    // The bass is the lowest low-register peak that belongs to this chord.
    const bassPc = lowPeaks.find((p) => t.pitchClasses.includes(p.pc))?.pc ?? null;
    let score = cosine(chroma, t.template) - t.penalty;
    // Prefer the reading whose root is in the bass (Am7 over C6 when A is lowest).
    if (bassPc !== null && t.root === bassPc) score += 0.03;
    if (score > bestScore) {
      bestScore = score;
      best = { root: t.root, type: t.type, pitchClasses: t.pitchClasses, bassPc, score };
    }
  }
  return best && best.score >= minScore ? best : null;
}

/** Notes to feed the listening engine: the bass in octave 3, other chord tones stacked above it. */
export function matchToMidi(match: Pick<ChordMatch, 'pitchClasses' | 'root' | 'bassPc'>): number[] {
  const bass = match.bassPc ?? match.root;
  const notes = [48 + bass];
  for (const pc of match.pitchClasses) {
    if (pc === bass) continue;
    let midi = 48 + pc;
    while (midi <= notes[notes.length - 1]) midi += 12;
    notes.push(midi);
  }
  return notes;
}
