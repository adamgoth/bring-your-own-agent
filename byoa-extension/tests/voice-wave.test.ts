import { expect, it, vi } from 'vitest';
import { createVoiceWave, waveShape } from '../src/lib/voice-wave';

function canvasWithSpy() {
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 40;
  const ys: number[] = [];
  const draw = {
    clearRect: vi.fn(),
    beginPath: vi.fn(() => ys.splice(0)),
    moveTo: vi.fn((_x: number, y: number) => ys.push(y)),
    lineTo: vi.fn((_x: number, y: number) => ys.push(y)),
    stroke: vi.fn(),
    setTransform: vi.fn(),
  };
  vi.spyOn(canvas, 'getContext').mockReturnValue(draw as unknown as CanvasRenderingContext2D);
  return { canvas, ys, draw };
}

it('tapers the wave to zero at both edges and stays within -1..1', () => {
  for (const t of [0, 0.37, 2.5]) {
    expect(Math.abs(waveShape(0, t))).toBeLessThan(1e-9);
    expect(Math.abs(waveShape(1, t))).toBeLessThan(1e-6);
    for (let x = 0; x <= 1; x += 0.01) expect(Math.abs(waveShape(x, t))).toBeLessThanOrEqual(1);
  }
});

it('draws a flat line in silence', () => {
  const { canvas, ys, draw } = canvasWithSpy();
  createVoiceWave(canvas)(0, 1000);
  expect(draw.stroke).toHaveBeenCalledOnce();
  expect(new Set(ys)).toEqual(new Set([20]));
});

it('spans the width and grows with the current level, with no history', () => {
  const { canvas, ys, draw } = canvasWithSpy();
  const paint = createVoiceWave(canvas);
  const spread = () => Math.max(...ys) - Math.min(...ys);
  paint(0.2, 1000);
  const quiet = spread();
  paint(0.7, 1000);
  const loud = spread();
  expect(quiet).toBeGreaterThan(2);
  expect(loud).toBeGreaterThan(quiet);
  expect(loud).toBeLessThanOrEqual(40);
  const xs = draw.lineTo.mock.calls.map(([x]) => x as number);
  expect(Math.max(...xs)).toBeGreaterThan(195);
  paint(0, 1000);
  expect(spread()).toBe(0);
});
