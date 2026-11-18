import { modeLabel, type ModeId } from '../theory';

// Krumhansl–Kessler probe-tone profiles, tonic first.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Conventional key names by tonic pitch class. */
const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
/** Keys whose signatures use flats, so heard notes should be spelled with flats. */
const FLAT_MAJORS = new Set([1, 3, 5, 8, 10]);
const FLAT_MINORS = new Set([0, 2, 3, 5, 7, 10]);

export type KeyGuess = { tonic: string; mode: Extract<ModeId, 'major' | 'minor'>; score: number };
export type KeyEstimate = KeyGuess & {
  /** 0–1: how clearly the best key beats the runner-up and how well it fits at all. */
  confidence: number;
  runnerUp: KeyGuess;
  /** Seconds of (decayed) notes the estimate rests on. */
  evidence: number;
  usesFlats: boolean;
};

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

export const keyName = (k: Pick<KeyGuess, 'tonic' | 'mode'>): string => `${k.tonic} ${modeLabel(k.mode).toLowerCase()}`.replace('natural minor', 'minor');

/**
 * Rolling pitch-class histogram weighted by how long each pitch class sounds, decaying with a
 * time constant of `tau` seconds, correlated against the 24 major and minor key profiles.
 */
export class KeyEstimator {
  private readonly histogram = new Array<number>(12).fill(0);
  private last: number | null = null;
  private readonly tau: number;
  private readonly minEvidence: number;

  constructor({ tau = 30, minEvidence = 1.5 } = {}) {
    this.tau = tau;
    this.minEvidence = minEvidence;
  }

  /** Advance to time `t` (ms), crediting `sounding` pitch classes (0–11) for the elapsed time. */
  advance(t: number, sounding: Iterable<number>): void {
    if (this.last === null) {
      this.last = t;
      return;
    }
    const dt = Math.max(0, (t - this.last) / 1000);
    this.last = t;
    if (dt === 0) return;
    const decay = Math.exp(-dt / this.tau);
    for (let i = 0; i < 12; i += 1) this.histogram[i] *= decay;
    const credit = this.tau * (1 - decay); // ∫ e^{-(t-s)/τ} ds over the interval
    for (const pc of new Set(sounding)) this.histogram[pc] += credit;
  }

  reset(): void {
    this.histogram.fill(0);
    this.last = null;
  }

  estimate(): KeyEstimate | null {
    const evidence = this.histogram.reduce((s, x) => s + x, 0);
    if (evidence < this.minEvidence) return null;
    const guesses: KeyGuess[] = [];
    for (let tonic = 0; tonic < 12; tonic += 1) {
      const rotated = this.histogram.map((_, i) => this.histogram[(i + tonic) % 12]);
      guesses.push({ tonic: MAJOR_NAMES[tonic], mode: 'major', score: pearson(rotated, MAJOR) });
      guesses.push({ tonic: MINOR_NAMES[tonic], mode: 'minor', score: pearson(rotated, MINOR) });
    }
    guesses.sort((a, b) => b.score - a.score);
    const [best, second] = guesses;
    const margin = Math.min(1, Math.max(0, (best.score - second.score) / 0.15));
    const fit = Math.min(1, Math.max(0, best.score / 0.8));
    const tonicPc = (best.mode === 'major' ? MAJOR_NAMES : MINOR_NAMES).indexOf(best.tonic);
    return {
      ...best,
      confidence: Math.round(margin * fit * 100) / 100,
      runnerUp: second,
      evidence: Math.round(evidence * 10) / 10,
      usesFlats: best.mode === 'major' ? FLAT_MAJORS.has(tonicPc) : FLAT_MINORS.has(tonicPc),
    };
  }
}
