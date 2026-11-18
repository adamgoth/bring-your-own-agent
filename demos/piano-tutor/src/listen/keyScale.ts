import { Note, Scale } from 'tonal';
import type { HeardState } from '../state/store';

/** Below this the key guess is too shaky to draw on the keyboard. */
export const SCALE_MIN_CONFIDENCE = 0.3;

const cache = new Map<string, number[]>();

/**
 * Pitch classes (0–11) of the estimated key's scale, tonic first, while listening with a
 * reasonably confident estimate; otherwise undefined. Cached so the keyboard gets a stable array.
 */
export function keyScale(heard: Pick<HeardState, 'listening' | 'key'>): number[] | undefined {
  const k = heard.key;
  if (!heard.listening || !k || k.confidence < SCALE_MIN_CONFIDENCE) return undefined;
  const id = `${k.tonic} ${k.mode}`;
  let pcs = cache.get(id);
  if (!pcs) {
    pcs = Scale.get(id).notes.map((n) => Note.chroma(n) ?? 0);
    cache.set(id, pcs);
  }
  return pcs;
}
