import { midiOf } from './notes';

export type Hand = 'right' | 'left';

/** Right-hand pattern for a shape described by the gaps (in semitones) between neighbouring notes. */
function rightHand(gaps: number[]): number[] {
  if (gaps.length === 0) return [1];
  if (gaps.length === 1) return gaps[0] <= 4 ? [1, 3] : gaps[0] <= 7 ? [1, 4] : [1, 5];
  if (gaps.length === 2) {
    const [lower, upper] = gaps;
    if (lower <= 2) return [1, 2, 5]; // sus2 shape: C D G
    if (upper <= 2) return [1, 3, 4]; // sus4 shape: C F G
    if (upper >= 5) return [1, 2, 5]; // first inversion: third then fourth
    return [1, 3, 5]; // root position and second inversion
  }
  if (gaps.length === 3) {
    // A seventh chord inversion has one second in it; put adjacent fingers on it.
    if (gaps[2] <= 2) return [1, 2, 4, 5];
    return [1, 2, 3, 5];
  }
  if (gaps.length === 4) return [1, 2, 3, 4, 5];
  return [];
}

/**
 * Suggested finger numbers (1 = thumb, 5 = little finger), one per note, lowest note first.
 * Covers the common triad and seventh shapes and their inversions; it is a starting point,
 * not a rule. Returns an empty array for shapes with more than five notes.
 */
export function suggestFingering(notes: string[], hand: Hand): number[] {
  const midis = notes.map(midiOf).sort((a, b) => a - b);
  const gaps = midis.slice(1).map((m, i) => m - midis[i]);
  if (hand === 'right') return rightHand(gaps);
  // The left hand mirrors the right: play the reversed shape with the right-hand rule, then flip.
  return rightHand([...gaps].reverse()).reverse();
}

export const formatFingering = (fingers: number[]): string => fingers.join('-');
