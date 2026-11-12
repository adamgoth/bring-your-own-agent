import { afterEach, expect, it, vi } from 'vitest';
import { startVoiceMeter } from '../src/sidebar/voice-meter';
afterEach(() => vi.restoreAllMocks());
it('draws microphone samples and releases the microphone, frame and audio context', async () => {
  const track = { stop: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const analyser = {
    fftSize: 256,
    getByteTimeDomainData: vi.fn((data: Uint8Array) => data.fill(160)),
  };
  const close = vi.fn(async () => {});
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      resume = async () => {};
      close = close;
      createAnalyser = () => analyser;
      createMediaStreamSource = () => source;
    }
  );
  const capture = vi.fn(async () => ({ getTracks: () => [track] }));
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: capture },
  });
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 42)
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const canvas = document.createElement('canvas');
  const draw = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
  };
  vi.spyOn(canvas, 'getContext').mockReturnValue(draw as unknown as CanvasRenderingContext2D);
  const stop = startVoiceMeter(canvas, vi.fn());
  await vi.waitFor(() => expect(draw.stroke).toHaveBeenCalled());
  expect(capture).toHaveBeenCalledWith({ audio: true, video: false });
  expect(source.connect).toHaveBeenCalledWith(analyser);
  expect(draw.lineTo).toHaveBeenCalled();
  stop();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(source.disconnect).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
  vi.unstubAllGlobals();
});

function fakeMicrophone(level: number) {
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      resume = async () => {};
      close = async () => {};
      createAnalyser = () => ({
        fftSize: 256,
        getByteTimeDomainData: (data: Uint8Array) => data.fill(level),
      });
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    }
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) },
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
}

function sizedCanvas(width: number) {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: width });
  Object.defineProperty(canvas, 'clientHeight', { value: 32 });
  const bars: Array<[number, number, number]> = [];
  let start = 0;
  const draw = {
    clearRect: vi.fn(),
    beginPath: () => bars.splice(0),
    moveTo: (_x: number, y: number) => (start = y),
    lineTo: (x: number, y: number) => bars.push([x, start, y]),
    stroke: vi.fn(),
    setTransform: vi.fn(),
  } as Record<string, unknown>;
  vi.spyOn(canvas, 'getContext').mockReturnValue(draw as unknown as CanvasRenderingContext2D);
  return { canvas, bars, draw };
}

it('fits rounded, evenly spaced bars to the available width', async () => {
  fakeMicrophone(128);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  );
  for (const [width, count] of [
    [120, 24],
    [240, 48],
  ]) {
    const { canvas, bars, draw } = sizedCanvas(width);
    const stop = startVoiceMeter(canvas, vi.fn());
    await vi.waitFor(() => expect(bars.length).toBe(count));
    expect(draw.lineCap).toBe('round');
    expect(draw.lineWidth).toBe(3);
    const gaps = bars.slice(1).map(([x], i) => x - bars[i][0]);
    expect(new Set(gaps)).toEqual(new Set([5]));
    expect(bars[0][0]).toBeGreaterThanOrEqual(1.5);
    expect(bars.at(-1)![0]).toBeLessThanOrEqual(width - 1.5);
    // Silence draws tiny dots centered vertically.
    for (const [, top, bottom] of bars) {
      expect(top).toBeCloseTo(16 - 0.25);
      expect(bottom).toBeCloseTo(16 + 0.25);
    }
    stop();
  }
  vi.unstubAllGlobals();
});

it('rises gently with speech and keeps quiet history as dots', async () => {
  fakeMicrophone(176);
  const frames: Array<(now: number) => void> = [];
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((paint: (now: number) => void) => frames.push(paint))
  );
  const { canvas, bars } = sizedCanvas(100);
  const stop = startVoiceMeter(canvas, vi.fn());
  await vi.waitFor(() => expect(bars.length).toBe(20));
  const heights = () => bars.map(([, top, bottom]) => bottom - top);
  const first = heights().at(-1)!;
  // A single frame of loud audio only partly raises the newest bar.
  expect(first).toBeGreaterThan(0.5);
  expect(first).toBeLessThan(10);
  for (let now = 50; now <= 1000; now += 50) frames.at(-1)!(now);
  const later = heights();
  expect(later.at(-1)!).toBeGreaterThan(first);
  expect(later.at(-1)!).toBeLessThanOrEqual(32 - 3 - 4 + 0.01);
  // Bars before speech started are still dots; recent bars form a rising cluster.
  expect(later[0]).toBeCloseTo(0.5);
  const recent = later.slice(-8);
  recent.slice(1).forEach((height, i) => expect(height).toBeGreaterThanOrEqual(recent[i] - 0.01));
  stop();
  vi.unstubAllGlobals();
});
it('releases a microphone that arrives after cancellation', async () => {
  let resolve!: (stream: unknown) => void;
  const track = { stop: vi.fn() };
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      resume = async () => {};
      close = async () => {};
    }
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  });
  const stop = startVoiceMeter(document.createElement('canvas'), vi.fn());
  stop();
  resolve({ getTracks: () => [track] });
  await vi.waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
  vi.unstubAllGlobals();
});
