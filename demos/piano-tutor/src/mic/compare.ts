import { midiOf, parseChord } from '../theory';
import type { ChordMatch } from './chroma';

export type CompareRow = { type: string; n: number; notes: number; bass: number };
export type CompareReport = { rows: CompareRow[]; total: CompareRow; pending: number };

type Truth = { symbol: string; type: string; pcs: number[]; bassPc: number; at: number };
type MicChord = { pcs: number[]; bassPc: number; at: number };

const pc = (note: string) => midiOf(`${note}4`) % 12;
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Scores the microphone against MIDI on the same performance. Each MIDI chord is ground truth; the
 * mic counts as right if, within the window around it, it reported the same pitch classes
 * (and, for the bass column, the same lowest note).
 */
export class MicMidiComparator {
  private truths: Truth[] = [];
  private mics: MicChord[] = [];
  private readonly rows = new Map<string, CompareRow>();
  constructor(private readonly windowMs = { before: 200, after: 900 }) {}

  addTruth(symbol: string, at: number): void {
    try {
      const chord = parseChord(symbol);
      const pcs = chord.pitchClasses.map(pc);
      this.truths.push({ symbol, type: chord.quality, pcs, bassPc: pc(chord.bass ?? chord.root), at });
    } catch {
      /* a symbol theory cannot parse is not scored */
    }
  }

  addMic(match: Pick<ChordMatch, 'pitchClasses' | 'bassPc' | 'root'>, at: number): void {
    this.mics.push({ pcs: match.pitchClasses, bassPc: match.bassPc ?? match.root, at });
  }

  /** Score every truth whose window has closed by `now`. */
  settle(now: number): void {
    const ready = this.truths.filter((t) => now - t.at > this.windowMs.after);
    this.truths = this.truths.filter((t) => now - t.at <= this.windowMs.after);
    for (const truth of ready) {
      const candidates = this.mics.filter((m) => m.at >= truth.at - this.windowMs.before && m.at <= truth.at + this.windowMs.after);
      const notes = candidates.find((m) => same(m.pcs, truth.pcs));
      const row = this.rows.get(truth.type) ?? { type: truth.type, n: 0, notes: 0, bass: 0 };
      row.n += 1;
      if (notes) row.notes += 1;
      if (notes && notes.bassPc === truth.bassPc) row.bass += 1;
      this.rows.set(truth.type, row);
    }
    this.mics = this.mics.filter((m) => now - m.at < 5000);
  }

  report(): CompareReport {
    const rows = [...this.rows.values()].sort((a, b) => b.n - a.n);
    const total = rows.reduce((s, r) => ({ ...s, n: s.n + r.n, notes: s.notes + r.notes, bass: s.bass + r.bass }), { type: 'all', n: 0, notes: 0, bass: 0 });
    return { rows, total, pending: this.truths.length };
  }

  reset(): void {
    this.truths = [];
    this.mics = [];
    this.rows.clear();
  }
}
