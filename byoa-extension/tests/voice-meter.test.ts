import { afterEach, expect, it, vi } from 'vitest';
import { sampleVoiceVolume } from '../src/lib/voice-volume';
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
  // Points of the last line stroked (the main wave is drawn last).
  let points: Array<[number, number]> = [];
  let current: Array<[number, number]> = [];
  const draw = {
    clearRect: vi.fn(),
    beginPath: () => (current = []),
    moveTo: (x: number, y: number) => current.push([x, y]),
    lineTo: (x: number, y: number) => current.push([x, y]),
    stroke: vi.fn(() => (points = current)),
    setTransform: vi.fn(),
  } as Record<string, unknown>;
  vi.spyOn(canvas, 'getContext').mockReturnValue(draw as unknown as CanvasRenderingContext2D);
  return { canvas, points: () => points, draw };
}
const spread = (points: Array<[number, number]>) =>
  Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y));

it('draws silence as a flat line across the whole width', async () => {
  fakeMicrophone(128);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  );
  for (const width of [120, 240]) {
    const { canvas, points, draw } = sizedCanvas(width);
    const stop = startVoiceMeter(canvas, vi.fn());
    await vi.waitFor(() => expect(points().length).toBeGreaterThan(2));
    expect(draw.lineCap).toBe('round');
    const xs = points().map(([x]) => x);
    expect(Math.min(...xs)).toBeCloseTo(1.5);
    expect(Math.max(...xs)).toBeCloseTo(width - 1.5);
    expect(new Set(points().map(([, y]) => y))).toEqual(new Set([16]));
    stop();
  }
  vi.unstubAllGlobals();
});

it('moves with current speech and returns to flat when it stops, keeping no history', async () => {
  vi.useFakeTimers();
  let level = 176;
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
  const frames: Array<(now: number) => void> = [];
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((paint: (now: number) => void) => frames.push(paint))
  );
  const { canvas, points } = sizedCanvas(100);
  const stop = startVoiceMeter(canvas, vi.fn());
  await vi.waitFor(() => expect(points().length).toBeGreaterThan(2));
  const run = async (from: number, to: number) => {
    for (let now = from; now <= to; now += 50) {
      await vi.advanceTimersByTimeAsync(50);
      frames.at(-1)!(now);
    }
  };
  await run(50, 50);
  const first = spread(points());
  // One frame of loud audio only partly raises the wave.
  expect(first).toBeGreaterThan(0);
  await run(100, 1000);
  const talking = spread(points());
  expect(talking).toBeGreaterThan(first);
  expect(talking).toBeLessThanOrEqual(32 - 6 + 0.01);
  // The shape moves between frames even at a steady level.
  const before = points().map(([, y]) => y);
  await run(1050, 1050);
  expect(points().map(([, y]) => y)).not.toEqual(before);
  level = 128;
  await run(1100, 4000);
  expect(spread(points())).toBe(0);
  stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
  const stop = sampleVoiceVolume(vi.fn(), vi.fn());
  stop();
  resolve({ getTracks: () => [track] });
  await vi.waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
  vi.unstubAllGlobals();
});
