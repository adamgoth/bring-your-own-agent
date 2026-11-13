import { sampleVoiceVolume } from '../lib/voice-volume';
import { createVoiceBars } from '../lib/voice-bars';
export function startVoiceMeter(canvas: HTMLCanvasElement, unavailable: () => void): () => void {
  let frame: number | undefined;
  let stopSamples: (() => void) | undefined;
  let closed = false;
  const stop = () => {
    closed = true;
    if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
    stopSamples?.();
  };
  try {
    const draw = createVoiceBars(canvas);
    let level = 0;
    stopSamples = sampleVoiceVolume(
      (value) => {
        level = value;
      },
      () => {
        stop();
        unavailable();
      }
    );
    const paint = (now = 0) => {
      if (closed) return;
      draw(level, now);
      frame = globalThis.requestAnimationFrame(paint);
    };
    paint();
  } catch {
    stop();
    unavailable();
  }
  return stop;
}
