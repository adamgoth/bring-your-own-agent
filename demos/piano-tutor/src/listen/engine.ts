import { Note } from 'tonal';
import { detectChord } from '../theory';
import { KeyEstimator, type KeyEstimate } from './keyEstimate';

export type HeardChord = { symbol: string; candidates: string[]; at: number };

export type HeardSnapshot = {
  /** Notes sounding now (held or sustained), lowest first, spelled for the estimated key. */
  sounding: string[];
  soundingMidi: number[];
  chord: HeardChord | null;
  /** Most recent last, at most 16. */
  history: HeardChord[];
  key: KeyEstimate | null;
};

export type EngineOptions = {
  /** A chord must sound unchanged this long (ms) before it counts. */
  stableMs?: number;
  historySize?: number;
  keyTau?: number;
};

/**
 * Turns note events from any source (MIDI, the on-screen keyboard, the microphone) into the
 * chord being played, a short chord history and a key estimate. Pure: callers pass times in ms.
 */
export class ListeningEngine {
  private readonly held = new Set<number>();
  private readonly sustained = new Set<number>();
  private pedalDown = false;
  private pending: { symbol: string; candidates: string[]; since: number } | null = null;
  private current: HeardChord | null = null;
  private history: HeardChord[] = [];
  private readonly keys: KeyEstimator;
  private readonly stableMs: number;
  private readonly historySize: number;

  constructor({ stableMs = 120, historySize = 16, keyTau = 30 }: EngineOptions = {}) {
    this.stableMs = stableMs;
    this.historySize = historySize;
    this.keys = new KeyEstimator({ tau: keyTau });
  }

  private soundingMidi(): number[] {
    return [...new Set([...this.held, ...this.sustained])].sort((a, b) => a - b);
  }

  private beforeChange(t: number): void {
    this.keys.advance(t, this.soundingMidi().map((m) => m % 12));
  }

  private afterChange(t: number): void {
    const notes = this.spell(this.soundingMidi());
    const candidates = detectChord(notes);
    if (candidates.length === 0) {
      // Nothing nameable sounding (silence, one note, a cluster): clear the readout, keep history.
      this.pending = null;
      this.current = null;
      return;
    }
    if (this.current?.symbol === candidates[0]) {
      this.pending = null;
      return;
    }
    if (this.pending?.symbol !== candidates[0]) this.pending = { symbol: candidates[0], candidates, since: t };
    this.update(t);
  }

  private spell(midi: number[]): string[] {
    const flats = this.keys.estimate()?.usesFlats ?? false;
    return midi.map((m) => (flats ? Note.fromMidi(m) : Note.fromMidiSharps(m)));
  }

  noteOn(midi: number, t: number): void {
    this.beforeChange(t);
    this.held.add(midi);
    this.sustained.delete(midi);
    this.afterChange(t);
  }

  noteOff(midi: number, t: number): void {
    this.beforeChange(t);
    this.held.delete(midi);
    if (this.pedalDown) this.sustained.add(midi);
    this.afterChange(t);
  }

  pedal(down: boolean, t: number): void {
    this.beforeChange(t);
    this.pedalDown = down;
    if (!down) this.sustained.clear();
    this.afterChange(t);
  }

  /** Release everything, e.g. when an input disconnects. History and key survive. */
  allOff(t: number): void {
    this.beforeChange(t);
    this.held.clear();
    this.sustained.clear();
    this.pedalDown = false;
    this.afterChange(t);
  }

  /** Commit a chord that has been stable long enough and let the key estimate catch up. */
  update(t: number): void {
    this.beforeChange(t);
    if (this.pending && t - this.pending.since >= this.stableMs) {
      const chord: HeardChord = { symbol: this.pending.symbol, candidates: this.pending.candidates, at: this.pending.since };
      this.current = chord;
      this.pending = null;
      if (this.history[this.history.length - 1]?.symbol !== chord.symbol) {
        this.history = [...this.history, chord].slice(-this.historySize);
      }
    }
  }

  reset(): void {
    this.held.clear();
    this.sustained.clear();
    this.pedalDown = false;
    this.pending = null;
    this.current = null;
    this.history = [];
    this.keys.reset();
  }

  snapshot(): HeardSnapshot {
    const midi = this.soundingMidi();
    return { sounding: this.spell(midi), soundingMidi: midi, chord: this.current, history: this.history, key: this.keys.estimate() };
  }
}
