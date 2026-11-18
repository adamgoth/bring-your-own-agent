import { ChordGate, type GateEvent } from './chordGate.ts';
import { matchChord, spectrumToChroma, type ChordMatch } from './chroma.ts';
import type { MicFrame } from './micCapture.ts';

type Frame = Pick<MicFrame, 't' | 'rms' | 'magnitudes' | 'sampleRate' | 'fftSize'>;

/**
 * Frames in, stable chord events out: the detector the offline prototype evaluated. The
 * loudness threshold follows the room: three times the 10th-percentile level of the last
 * 10 seconds, kept between 0.0015 and 0.006 so a quiet laptop mic, a noisy room and long
 * stretches of continuous playing all still work.
 */
export class MicChordDetector {
  private readonly gate = new ChordGate();
  private levels: number[] = [];
  private static readonly WINDOW = 312; // ~10 s of 32 ms frames
  private static readonly WARMUP = 30; // ~1 s before the floor is trusted

  /** Current loudness threshold (RMS). */
  get threshold(): number {
    if (this.levels.length < MicChordDetector.WARMUP) return 0.002;
    const sorted = [...this.levels].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)];
    return Math.min(0.006, Math.max(0.0015, floor * 3));
  }

  push(frame: Frame): GateEvent[] {
    this.levels.push(frame.rms);
    if (this.levels.length > MicChordDetector.WINDOW) this.levels.shift();
    const threshold = this.threshold;
    this.gate.setMinimumRms(threshold);
    const match: ChordMatch | null =
      frame.rms >= threshold ? matchChord(spectrumToChroma({ magnitudes: frame.magnitudes, sampleRate: frame.sampleRate, fftSize: frame.fftSize })) : null;
    return this.gate.push({ t: frame.t, rms: frame.rms, match });
  }

  reset(): void {
    this.gate.reset();
    this.levels = [];
  }
}
