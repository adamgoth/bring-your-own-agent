/**
 * Live voice wave shared by the sidebar and the floating control. It shows only the current level,
 * with no history: a flat line in silence, a moving wave across the whole width while someone talks.
 * Only a smoothed volume scalar reaches it (see voice-volume.ts), so the wave's shape is drawn while
 * its height follows the real level.
 */

/** Below this the line is drawn flat; the sampler already subtracts a noise floor. */
const SILENCE = 0.015;
/** Levels arrive in 0..0.75. */
const FULL = 0.75;

/** The wave's height at `x` (0..1 across the width) and time `t` in seconds, before scaling; within -1..1. */
export function waveShape(x: number, t: number): number {
  // Tapered at both ends so the wave grows out of the flat line instead of being cut off at the edges.
  const taper = Math.sin(Math.PI * x);
  const wave =
    0.8 * Math.sin(2 * Math.PI * (x * 2.6 - t * 1.1)) +
    0.5 * Math.sin(2 * Math.PI * (x * 5.3 + t * 1.7) + 1.1) +
    0.3 * Math.sin(2 * Math.PI * (x * 9.7 - t * 2.6) + 2.3);
  // Soft-clip so most frames use most of the height without flat-topping.
  return taper * Math.tanh(0.95 * wave);
}

export function createVoiceWave(canvas: HTMLCanvasElement) {
  const draw = canvas.getContext('2d');
  if (!draw) throw new Error('Canvas unavailable');
  return (level: number, now = globalThis.performance.now()) => {
    const ratio = globalThis.devicePixelRatio || 1;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (canvas.clientWidth && canvas.clientHeight) {
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      draw.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    draw.clearRect(0, 0, width, height);
    const color = globalThis.getComputedStyle(canvas).color;
    draw.strokeStyle = color;
    draw.lineCap = 'round';
    draw.lineJoin = 'round';
    const middle = height / 2;
    const loud = Math.max(0, Math.min(1, (level - SILENCE) / (FULL - SILENCE)));
    // Quieter speech still moves visibly; loud speech fills the height without clipping.
    const reach = (Math.max(0, height - 6) / 2) * loud ** 0.6;
    const inset = 1.5;
    const span = Math.max(1, width - inset * 2);
    const t = now / 1000;
    const trace = (lineWidth: number, alpha: number, lag: number, scale: number) => {
      draw.globalAlpha = alpha;
      draw.lineWidth = lineWidth;
      draw.beginPath();
      const steps = Math.max(2, Math.ceil(span / 2));
      for (let i = 0; i <= steps; i++) {
        const x = i / steps;
        const y = reach ? middle - waveShape(x, t - lag) * reach * scale : middle;
        if (i === 0) draw.moveTo(inset + x * span, y);
        else draw.lineTo(inset + x * span, y);
      }
      draw.stroke();
    };
    // A faint echo behind the main line gives the wave some depth while it moves.
    if (reach) trace(1.5, 0.3, 0.18, 0.7);
    trace(2.5, 1, 0, 1);
    draw.globalAlpha = 1;
  };
}
