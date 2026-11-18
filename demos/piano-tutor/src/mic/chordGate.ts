// Turns per-frame chord matches into stable chord-on / chord-off events: a candidate must hold
// for a while across several frames, short dropouts are forgiven, and quiet ends the chord. A new attack restarts the candidate.

import type { ChordMatch } from './chroma';

export type GateFrame = { t: number; rms: number; match: ChordMatch | null };
export type GateEvent = { type: 'chord'; t: number; match: ChordMatch } | { type: 'release'; t: number };

export type ChordGateOptions = {
  minRms: number;
  stableMs: number;
  minReliableFrames: number;
  dropoutGraceMs: number;
  releaseMs: number;
  /** A frame this much louder than the quietest of the last few starts a new attack. */
  onsetRatio: number;
  /** Frames this soon after an attack are skipped while the hammer noise settles. */
  attackSkipMs: number;
  /** Release a held chord not heard for this long, even if the room stays loud (a melody after it). */
  heldMissMs: number;
};

export const DEFAULT_GATE: ChordGateOptions = {
  minRms: 0.004,
  stableMs: 140,
  minReliableFrames: 3,
  dropoutGraceMs: 90,
  releaseMs: 160,
  onsetRatio: 1.8,
  attackSkipMs: 40,
  heldMissMs: 600,
};

const key = (m: ChordMatch) => `${m.pitchClasses.slice().sort((a, b) => a - b).join(',')}/${m.bassPc ?? m.root}`;

export class ChordGate {
  private readonly o: ChordGateOptions;
  private candidate: { key: string; match: ChordMatch; since: number; lastSeen: number; frames: number } | null = null;
  private heldKey: string | null = null;
  private heldLastSeen = -Infinity;
  private quietSince: number | null = null;
  private recentRms: number[] = [];
  private attackAt = -Infinity;

  constructor(options: Partial<ChordGateOptions> = {}) {
    this.o = { ...DEFAULT_GATE, ...options };
  }

  setMinimumRms(minRms: number): void {
    this.o.minRms = minRms;
  }

  reset(): void {
    this.candidate = null;
    this.heldKey = null;
    this.heldLastSeen = -Infinity;
    this.quietSince = null;
    this.recentRms = [];
    this.attackAt = -Infinity;
  }

  push({ t, rms, match }: GateFrame): GateEvent[] {
    const events: GateEvent[] = [];
    const quietest = this.recentRms.length ? Math.min(...this.recentRms) : rms;
    this.recentRms = [...this.recentRms, rms].slice(-4);
    if (rms >= this.o.minRms && rms > quietest * this.o.onsetRatio) {
      this.attackAt = t;
      this.candidate = null;
    }

    if (rms < this.o.minRms) {
      this.quietSince ??= t;
      if (this.heldKey && t - this.quietSince >= this.o.releaseMs) {
        this.heldKey = null;
        this.candidate = null;
        events.push({ type: 'release', t });
      }
      return events;
    }
    this.quietSince = null;
    if (t - this.attackAt < this.o.attackSkipMs) return events;

    if (this.heldKey && match && key(match) === this.heldKey) this.heldLastSeen = t;
    if (this.heldKey && t - this.heldLastSeen >= this.o.heldMissMs) {
      this.heldKey = null;
      events.push({ type: 'release', t });
    }

    if (!match) {
      if (this.candidate && t - this.candidate.lastSeen > this.o.dropoutGraceMs) this.candidate = null;
      return events;
    }
    const k = key(match);
    if (!this.candidate || this.candidate.key !== k) {
      // A different reading starts a new candidate; a stray frame inside a held chord never
      // reaches minReliableFrames, so the held chord stays.
      this.candidate = { key: k, match, since: t, lastSeen: t, frames: 1 };
    } else {
      this.candidate.lastSeen = t;
      this.candidate.frames += 1;
      if (match.score > this.candidate.match.score) this.candidate.match = match;
    }
    const c = this.candidate;
    if (c.key !== this.heldKey && c.frames >= this.o.minReliableFrames && t - c.since >= this.o.stableMs) {
      this.heldKey = c.key;
      this.heldLastSeen = t;
      events.push({ type: 'chord', t: c.since, match: c.match });
    }
    return events;
  }
}
