import { createTools } from '../tools/registry';
import { magnitudeSpectrum, rms } from './fft';
import { addNoise, addNote, rng, SAMPLE_RATE } from './testAudio';
import { createTutorStore } from '../state/store';
import { ChordGate } from './chordGate';
import { matchChord, matchToMidi, spectrumToChroma } from './chroma';
import { MicMidiComparator } from './compare';
import { MicChordDetector } from './micListener';
import type { MicCapture, MicFrame } from './micCapture';

const FFT = 8192;

function chordAudio(notes: number[], seconds = 1, seed = 1): Float32Array {
  const random = rng(seed);
  const audio = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
  for (const n of notes) addNote(audio, 0, seconds, n, 0.08, random);
  addNoise(audio, 0.0015, random);
  return audio;
}

function frameAt(audio: Float32Array, seconds: number) {
  const end = Math.floor(seconds * SAMPLE_RATE);
  return { magnitudes: magnitudeSpectrum(audio, end, FFT), sampleRate: SAMPLE_RATE, fftSize: FFT };
}

/** Frames every 32 ms across a performance of (notes, seconds) pairs separated by silence. */
function framesFor(performance: Array<[number[], number]>, startMs = 0): MicFrame[] {
  const random = rng(9);
  const total = performance.reduce((s, [, d]) => s + d + 0.3, 0.2);
  const audio = new Float32Array(Math.ceil(total * SAMPLE_RATE));
  let t = 0.1;
  for (const [notes, d] of performance) {
    for (const n of notes) addNote(audio, Math.floor(t * SAMPLE_RATE), d, n, 0.08, random);
    t += d + 0.3;
  }
  addNoise(audio, 0.0015, random);
  const frames: MicFrame[] = [];
  const hop = Math.round(0.032 * SAMPLE_RATE);
  for (let end = FFT; end <= audio.length; end += hop) {
    frames.push({ t: startMs + (end / SAMPLE_RATE) * 1000, rms: rms(audio, end, 1024), magnitudes: magnitudeSpectrum(audio, end, FFT), sampleRate: SAMPLE_RATE, fftSize: FFT });
  }
  return frames;
}

describe('chroma chord matching', () => {
  it.each([
    [[60, 64, 67], 'maj', 0, 0],
    [[57, 60, 64, 67], 'm7', 9, 9],
    [[52, 55, 60], 'maj', 0, 4], // C/E
    [[54, 57, 60, 64], 'm7b5', 6, 6],
    [[55, 59, 62, 65], '7', 7, 7],
    [[48, 52, 55, 59], 'maj7', 0, 0],
  ])('reads %j as %s on root %i with bass %i', (notes, type, root, bassPc) => {
    const match = matchChord(spectrumToChroma(frameAt(chordAudio(notes as number[]), 0.45)));
    expect(match).toMatchObject({ type, root, bassPc });
  });

  it('finds nothing in silence', () => {
    expect(matchChord(spectrumToChroma(frameAt(new Float32Array(SAMPLE_RATE), 0.5)))).toBeNull();
  });

  it('turns a match into notes with the bass lowest', () => {
    expect(matchToMidi({ root: 0, pitchClasses: [0, 4, 7], bassPc: 4 })).toEqual([52, 60, 67]);
    expect(matchToMidi({ root: 9, pitchClasses: [9, 0, 4, 7], bassPc: null })).toEqual([57, 60, 64, 67]);
  });
});

describe('ChordGate', () => {
  const m = (root: number) => ({ root, type: 'maj' as const, pitchClasses: [root, (root + 4) % 12, (root + 7) % 12], bassPc: root, score: 0.9 });

  it('waits for a stable reading, ignores a stray frame and releases on quiet', () => {
    const gate = new ChordGate({ attackSkipMs: 0 });
    const events = [
      ...gate.push({ t: 0, rms: 0.02, match: m(0) }),
      ...gate.push({ t: 32, rms: 0.02, match: m(0) }),
      ...gate.push({ t: 64, rms: 0.02, match: m(0) }),
      ...gate.push({ t: 160, rms: 0.02, match: m(0) }),
      ...gate.push({ t: 192, rms: 0.02, match: m(7) }),
      ...gate.push({ t: 224, rms: 0.02, match: m(0) }),
      ...gate.push({ t: 300, rms: 0.001, match: null }),
      ...gate.push({ t: 480, rms: 0.001, match: null }),
    ];
    expect(events.map((e) => e.type)).toEqual(['chord', 'release']);
  });
});

describe('ChordGate holds', () => {
  const m = (root: number) => ({ root, type: 'maj' as const, pitchClasses: [root, (root + 4) % 12, (root + 7) % 12], bassPc: root, score: 0.9 });

  it('releases a held chord that stops being heard while the room stays loud', () => {
    const gate = new ChordGate({ attackSkipMs: 0 });
    const events = [];
    for (let t = 0; t <= 200; t += 32) events.push(...gate.push({ t, rms: 0.02, match: m(0) }));
    for (let t = 232; t <= 1000; t += 32) events.push(...gate.push({ t, rms: 0.02, match: null })); // a melody: loud, no chord
    expect(events.map((e) => e.type)).toEqual(['chord', 'release']);
  });
});

describe('MicChordDetector loudness threshold', () => {
  it('follows the noise floor of the room', () => {
    const quiet = new MicChordDetector();
    const loud = new MicChordDetector();
    const silent = new Float32Array(FFT / 2);
    for (let i = 0; i < 40; i += 1) {
      quiet.push({ t: i * 32, rms: 0.0002, magnitudes: silent, sampleRate: SAMPLE_RATE, fftSize: FFT });
      loud.push({ t: i * 32, rms: 0.002, magnitudes: silent, sampleRate: SAMPLE_RATE, fftSize: FFT });
    }
    expect(quiet.threshold).toBeCloseTo(0.0015, 4); // clamped low: soft playing on a quiet mic still counts
    expect(loud.threshold).toBeCloseTo(0.006, 4); // 3x a noisy room's floor, capped so normal playing still counts
  });

  it('keeps detecting through ten seconds of continuous loud playing', () => {
    const d = new MicChordDetector();
    const silent = new Float32Array(FFT / 2);
    for (let i = 0; i < 320; i += 1) d.push({ t: i * 32, rms: 0.05, magnitudes: silent, sampleRate: SAMPLE_RATE, fftSize: FFT });
    expect(d.threshold).toBe(0.006);
  });

  it('detects a soft chord on a quiet microphone', () => {
    const d = new MicChordDetector();
    const audio = chordAudio([57, 60, 64, 67], 1.2, 4).map((x) => x * 0.12); // about 12 dB quieter than the tests above
    const events = [];
    const hop = Math.round(0.032 * SAMPLE_RATE);
    for (let end = FFT; end <= audio.length; end += hop) {
      events.push(...d.push({ t: (end / SAMPLE_RATE) * 1000, rms: rms(audio, end, 1024), magnitudes: magnitudeSpectrum(audio, end, FFT), sampleRate: SAMPLE_RATE, fftSize: FFT }));
    }
    expect(events.find((e) => e.type === 'chord')).toMatchObject({ match: { type: 'm7', root: 9 } });
  });
});

describe('MicMidiComparator', () => {
  it('scores mic chords against MIDI chords per type', () => {
    const c = new MicMidiComparator();
    c.addTruth('C', 0);
    c.addMic({ root: 0, pitchClasses: [0, 4, 7], bassPc: 0 }, 300);
    c.addTruth('Am7', 2000);
    c.addMic({ root: 0, pitchClasses: [0, 4, 7], bassPc: 0 }, 2300); // wrong chord
    c.addTruth('C/E', 4000);
    c.addMic({ root: 0, pitchClasses: [0, 4, 7], bassPc: 0 }, 4300); // right notes, wrong bass
    c.settle(10_000);
    const report = c.report();
    expect(report.total).toEqual({ type: 'all', n: 3, notes: 2, bass: 1 });
    expect(report.rows.find((r) => r.type === 'major')).toEqual({ type: 'major', n: 2, notes: 2, bass: 1 });
    expect(report.rows.find((r) => r.type === 'minor seventh')).toEqual({ type: 'minor seventh', n: 1, notes: 0, bass: 0 });
  });
});

describe('microphone in the store', () => {
  function setup(withMidi: boolean, appAudio = { playing: false }) {
    let t = 0;
    let onFrame: ((f: MicFrame) => void) | null = null;
    const mic: MicCapture = {
      start: async (cb) => {
        onFrame = cb;
        return { devices: [{ deviceId: 'a', label: 'Built-in Microphone' }], deviceId: 'a', label: 'Built-in Microphone', sampleRate: SAMPLE_RATE };
      },
      stop: async () => {
        onFrame = null;
      },
    };
    const input = { id: 'p', name: 'Piano', state: 'connected', onmidimessage: null as null | ((e: { data: Uint8Array | null }) => void) };
    const store = createTutorStore({
      player: async () => {},
      requestMidi: withMidi ? async () => ({ inputs: { forEach: (cb) => cb(input) }, onstatechange: null }) : async () => Promise.reject(new Error('no MIDI')),
      now: () => t,
      every: () => () => {},
      mic,
      appAudioPlaying: () => appAudio.playing,
    });
    const feed = (frames: MicFrame[]) => {
      for (const f of frames) {
        t = f.t;
        onFrame!(f);
        store.getState().tick();
      }
    };
    return { store, feed, input, setT: (x: number) => (t = x) };
  }

  it('drives the listening engine when there is no MIDI', async () => {
    const { store, feed } = setup(false);
    await store.getState().startMic();
    expect(store.getState().heard.mic).toMatchObject({ status: 'on', label: 'Built-in Microphone', mode: 'feed' });
    feed(framesFor([[[57, 60, 64, 67], 1], [[53, 57, 60], 1]]));
    expect(store.getState().heard.history.map((c) => c.symbol)).toEqual(['Am7', 'F']);
    expect(store.getState().heard.lastSource).toBe('mic');
  });

  it('ignores what it hears while the app itself is playing, then resumes', async () => {
    const appAudio = { playing: false };
    const { store, feed } = setup(false, appAudio);
    await store.getState().startMic();
    const frames = framesFor([[[57, 60, 64, 67], 2], [[53, 57, 60], 1], [[55, 59, 62], 1]]);
    // Chords start at 0.1 s with 0.3 s gaps: Am7 0.1–2.1, F 2.4–3.4, G 3.7–4.7.
    const [am7, f, g] = [frames.filter((x) => x.t < 2400), frames.filter((x) => x.t >= 2400 && x.t < 3650), frames.filter((x) => x.t >= 3650)];
    // Cut Am7 off while it is still held, then the app starts playing through the speakers.
    feed(am7.slice(0, 25));
    expect(store.getState().heard.sounding.length).toBe(4);
    appAudio.playing = true;
    feed(am7.slice(25));
    expect(store.getState().heard.sounding).toEqual([]);
    feed(f);
    expect(store.getState().heard.history.map((c) => c.symbol)).toEqual(['Am7']);
    appAudio.playing = false;
    feed(g);
    expect(store.getState().heard.history.map((c) => c.symbol)).toEqual(['Am7', 'G']);
  });

  it('uses one input at a time: the microphone replaces MIDI, and back', async () => {
    const { store, feed } = setup(true);
    await store.getState().startListening();
    expect(store.getState().heard.midi.status).toBe('connected');
    await store.getState().setListenInput('mic');
    expect(store.getState().listenInput).toBe('mic');
    expect(store.getState().heard.midi.status).toBe('off');
    // With MIDI off, the mic drives listening instead of being scored against MIDI.
    expect(store.getState().heard.mic).toMatchObject({ status: 'on', mode: 'feed' });
    feed(framesFor([[[57, 60, 64, 67], 1]]));
    expect(store.getState().heard.history.map((c) => c.symbol)).toEqual(['Am7']);
    await store.getState().setListenInput('midi');
    expect(store.getState().heard.mic.status).toBe('off');
    expect(store.getState().heard.midi.status).toBe('connected');
  });

  it('starts listening on the chosen input', async () => {
    const { store } = setup(true);
    await store.getState().setListenInput('mic');
    expect(store.getState().heard.listening).toBe(false);
    await store.getState().startListening();
    expect(store.getState().heard.midi.status).toBe('off');
    expect(store.getState().heard.mic.status).toBe('on');
    store.getState().stopListening();
    await store.getState().startListening();
    expect(store.getState().heard.mic.status).toBe('on');
  });

  it('start_listening with microphone true selects the microphone', async () => {
    const { store } = setup(true);
    const tools = createTools(store, () => 0);
    await tools.find((t) => t.name === 'start_listening')!.execute({ microphone: true });
    expect(store.getState().listenInput).toBe('mic');
    expect(store.getState().heard).toMatchObject({ listening: true, midi: { status: 'off' }, mic: { status: 'on', mode: 'feed' } });
  });

  it('lets go of held notes when switching microphones', async () => {
    const { store, feed } = setup(false);
    await store.getState().startMic();
    // A long chord, cut off while still sounding.
    feed(framesFor([[[57, 60, 64, 67], 2]]).slice(0, 25));
    expect(store.getState().heard.sounding.length).toBe(4);
    await store.getState().startMic('b');
    expect(store.getState().heard.sounding).toEqual([]);
  });

  it('scores a chord played twice in a row twice', async () => {
    const { store, feed, input, setT } = setup(true);
    await store.getState().startMic();
    const performance: Array<[number[], number]> = [[[60, 64, 67], 1], [[60, 64, 67], 1]];
    const frames = framesFor(performance);
    let at = 100;
    for (const [notes, d] of performance) {
      setT(at);
      notes.forEach((n) => input.onmidimessage!({ data: new Uint8Array([0x90, n, 80]) }));
      feed(frames.filter((f) => f.t >= at && f.t < at + d * 1000));
      setT(at + d * 1000);
      notes.forEach((n) => input.onmidimessage!({ data: new Uint8Array([0x80, n, 0]) }));
      feed(frames.filter((f) => f.t >= at + d * 1000 && f.t < at + d * 1000 + 300));
      at += (d + 0.3) * 1000;
    }
    setT(at + 2000);
    store.getState().tick();
    expect(store.getState().heard.mic.compare?.total.n).toBe(2);
  });

  it('is scored against MIDI instead when a MIDI keyboard is connected', async () => {
    const { store, feed, input, setT } = setup(true);
    await store.getState().startMic();
    const performance: Array<[number[], number]> = [[[60, 64, 67], 1], [[57, 60, 64, 67], 1]];
    // Play the same chords on MIDI at the moments the audio has them.
    const frames = framesFor(performance);
    let at = 100;
    for (const [notes, d] of performance) {
      setT(at);
      notes.forEach((n) => input.onmidimessage!({ data: new Uint8Array([0x90, n, 80]) }));
      feed(frames.filter((f) => f.t >= at && f.t < at + d * 1000));
      setT(at + d * 1000);
      notes.forEach((n) => input.onmidimessage!({ data: new Uint8Array([0x80, n, 0]) }));
      feed(frames.filter((f) => f.t >= at + d * 1000 && f.t < at + d * 1000 + 300));
      at += (d + 0.3) * 1000;
    }
    setT(at + 2000);
    store.getState().tick();
    const { mic, history } = store.getState().heard;
    expect(history.map((c) => c.symbol)).toEqual(['C', 'Am7']); // MIDI only: the mic did not double up
    expect(mic.mode).toBe('compare');
    expect(mic.compare?.total).toEqual({ type: 'all', n: 2, notes: 2, bass: 2 });
  });
});
