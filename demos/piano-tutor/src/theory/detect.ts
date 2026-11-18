import { Chord } from 'tonal';
import { canonicalSuffix } from './chords';
import { midiOf, normaliseAccidentals, pitchClassOf } from './notes';

/**
 * Ranked chord symbols for a set of notes, best first. Notes may carry octaves ("E3 G3 C4"),
 * in which case the lowest note is the bass; plain pitch classes are read in the order given.
 */
export function detectChord(notes: string[]): string[] {
  const cleaned = notes.map((n) => normaliseAccidentals(n.trim())).filter(Boolean);
  const hasOctaves = cleaned.length > 0 && cleaned.every((n) => /\d$/.test(n));
  const ordered = hasOctaves ? [...cleaned].sort((a, b) => midiOf(a) - midiOf(b)) : cleaned;
  const seen = new Set<number>();
  const pitchClasses: string[] = [];
  for (const note of ordered) {
    const pc = pitchClassOf(note);
    const chroma = midiOf(pc + '4') % 12;
    if (!pc || seen.has(chroma)) continue;
    seen.add(chroma);
    pitchClasses.push(pc);
  }
  if (pitchClasses.length < 2) return [];
  const candidates = Chord.detect(pitchClasses).map((symbol) => {
    const match = /^([A-G](?:#{1,2}|b{1,2})?)(.*?)(\/[A-G](?:#{1,2}|b{1,2})?)?$/.exec(symbol);
    const suffix = match ? canonicalSuffix(match[2]) : '';
    return { symbol: match ? match[1] + suffix + (match[3] ?? '') : symbol, rank: rankOf(suffix) };
  });
  // Stable sort: common chord types first, tonal's order (root position first) within a rank.
  return candidates
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((c) => c.symbol);
}

/** Everyday chord types a learner expects to see named before exotic readings of the same notes. */
const COMMON = ['', 'm', '7', 'maj7', 'm7', 'dim', 'm7b5', 'dim7', 'aug', 'sus4', 'sus2', 'mMaj7', '6', 'm6', '9', 'maj9', 'm9', 'add9'];
const rankOf = (suffix: string): number => {
  const i = COMMON.indexOf(suffix);
  return i < 0 ? COMMON.length : i < 9 ? 0 : 1;
};
