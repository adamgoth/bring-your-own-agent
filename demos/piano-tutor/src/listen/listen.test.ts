import { Note } from 'tonal';
import { ListeningEngine } from './engine';
import { KeyEstimator } from './keyEstimate';
import { connectMidi, parseMidiMessage, type MidiAccessLike, type MidiInputLike } from './midi';

const m = (n: string) => Note.midi(n)!;

/** Play chords (lists of notes) for `ms` each, releasing between them. Returns the end time. */
function perform(engine: ListeningEngine, chords: string[][], ms = 1000, start = 0): number {
  let t = start;
  for (const chord of chords) {
    chord.forEach((n, i) => engine.noteOn(m(n), t + i * 10));
    for (let step = 50; step <= ms; step += 50) engine.update(t + step);
    chord.forEach((n) => engine.noteOff(m(n), t + ms + 5));
    t += ms + 20;
  }
  return t;
}

describe('KeyEstimator', () => {
  function estimateAfter(chords: string[][], repeats = 3) {
    const engine = new ListeningEngine();
    let t = 0;
    for (let r = 0; r < repeats; r += 1) t = perform(engine, chords, 1000, t);
    engine.update(t);
    return engine.snapshot().key;
  }

  it('finds C major from I–IV–V–I', () => {
    expect(estimateAfter([['C4', 'E4', 'G4'], ['F3', 'A3', 'C4'], ['G3', 'B3', 'D4'], ['C4', 'E4', 'G4']])).toMatchObject({ tonic: 'C', mode: 'major' });
  });

  it('finds G major and spells nothing with flats', () => {
    const key = estimateAfter([['G3', 'B3', 'D4'], ['C4', 'E4', 'G4'], ['D4', 'F#4', 'A4'], ['G3', 'B3', 'D4']]);
    expect(key).toMatchObject({ tonic: 'G', mode: 'major', usesFlats: false });
  });

  it('finds A minor from i–iv–V–i with the raised seventh', () => {
    expect(estimateAfter([['A3', 'C4', 'E4'], ['D4', 'F4', 'A4'], ['E3', 'G#3', 'B3'], ['A3', 'C4', 'E4']])).toMatchObject({ tonic: 'A', mode: 'minor' });
  });

  it('finds E flat major and uses flats', () => {
    const key = estimateAfter([['Eb4', 'G4', 'Bb4'], ['Ab3', 'C4', 'Eb4'], ['Bb3', 'D4', 'F4'], ['Eb4', 'G4', 'Bb4']]);
    expect(key).toMatchObject({ tonic: 'Eb', mode: 'major', usesFlats: true });
    expect(key!.confidence).toBeGreaterThan(0.3);
  });

  it('needs some evidence before guessing', () => {
    const k = new KeyEstimator();
    k.advance(0, [0, 4, 7]);
    k.advance(500, [0, 4, 7]);
    expect(k.estimate()).toBeNull();
  });

  it('forgets old music with a 30 s time constant', () => {
    const k = new KeyEstimator();
    k.advance(0, []);
    k.advance(10_000, [0, 4, 7]); // 10 s of C major triad
    const before = k.estimate()!.evidence;
    k.advance(40_000, []); // 30 s of silence
    expect(k.estimate()?.evidence ?? 0).toBeCloseTo(before / Math.E, 0);
  });
});

describe('ListeningEngine', () => {
  it('names a chord once it has been stable', () => {
    const e = new ListeningEngine({ stableMs: 120 });
    ['C4', 'E4', 'G4'].forEach((n, i) => e.noteOn(m(n), i * 10));
    expect(e.snapshot().chord).toBeNull();
    e.update(100);
    expect(e.snapshot().chord).toBeNull();
    e.update(150);
    expect(e.snapshot()).toMatchObject({ chord: { symbol: 'C' }, sounding: ['C4', 'E4', 'G4'] });
  });

  it('reads inversions from the lowest note', () => {
    const e = new ListeningEngine();
    perform(e, [['E3', 'G3', 'C4']]);
    expect(e.snapshot().history.map((c) => c.symbol)).toEqual(['C/E']);
  });

  it('ignores the brief in-between sets while a chord is released', () => {
    const e = new ListeningEngine();
    perform(e, [['C4', 'E4', 'G4'], ['A3', 'C4', 'E4', 'G4'], ['F3', 'A3', 'C4'], ['G3', 'B3', 'D4', 'F4']]);
    expect(e.snapshot().history.map((c) => c.symbol)).toEqual(['C', 'Am7', 'F', 'G7']);
  });

  it('keeps sustained notes sounding until the pedal lifts', () => {
    const e = new ListeningEngine();
    e.pedal(true, 0);
    ['C4', 'E4', 'G4'].forEach((n) => e.noteOn(m(n), 0));
    ['C4', 'E4', 'G4'].forEach((n) => e.noteOff(m(n), 50));
    e.update(200);
    expect(e.snapshot()).toMatchObject({ chord: { symbol: 'C' }, sounding: ['C4', 'E4', 'G4'] });
    e.pedal(false, 300);
    expect(e.snapshot()).toMatchObject({ chord: null, sounding: [] });
    expect(e.snapshot().history).toHaveLength(1);
  });

  it('keeps the last 16 chords', () => {
    const e = new ListeningEngine();
    const chords = Array.from({ length: 20 }, (_, i) => (i % 2 ? ['C4', 'E4', 'G4'] : ['G3', 'B3', 'D4']));
    perform(e, chords, 300);
    expect(e.snapshot().history).toHaveLength(16);
  });

  it('clears the readout for clusters it cannot name', () => {
    const e = new ListeningEngine();
    perform(e, [['C4', 'E4', 'G4']]);
    ['C4', 'C#4', 'D4', 'D#4'].forEach((n) => e.noteOn(m(n), 5000));
    e.update(5300);
    expect(e.snapshot().chord).toBeNull();
  });
});

describe('MIDI', () => {
  it('parses note on, note off, velocity-zero note on and control change on any channel', () => {
    expect(parseMidiMessage([0x93, 60, 100])).toEqual({ type: 'noteon', note: 60, velocity: 100 });
    expect(parseMidiMessage([0x80, 60, 0])).toEqual({ type: 'noteoff', note: 60 });
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ type: 'noteoff', note: 60 });
    expect(parseMidiMessage([0xb0, 64, 127])).toEqual({ type: 'cc', controller: 64, value: 127 });
    expect(parseMidiMessage([0xf8])).toBeNull();
    expect(parseMidiMessage([0xe0, 0, 64])).toBeNull();
  });

  it('attaches to every input, including ones plugged in later, and detaches', () => {
    const inputs: MidiInputLike[] = [{ id: 'a', name: 'Piano', state: 'connected', onmidimessage: null }];
    const access: MidiAccessLike = { inputs: { forEach: (cb) => inputs.forEach(cb) }, onstatechange: null };
    const events: string[] = [];
    const devices: string[][] = [];
    const disconnect = connectMidi(access, (e, name) => events.push(`${name}:${e.type}`), (d) => devices.push(d));
    inputs[0].onmidimessage!({ data: new Uint8Array([0x90, 60, 90]) });
    inputs.push({ id: 'b', name: 'Pads', state: 'connected', onmidimessage: null });
    access.onstatechange!({});
    inputs[1].onmidimessage!({ data: new Uint8Array([0x80, 60, 0]) });
    expect(events).toEqual(['Piano:noteon', 'Pads:noteoff']);
    expect(devices).toEqual([['Piano'], ['Piano', 'Pads']]);
    disconnect();
    expect(inputs.every((i) => i.onmidimessage === null)).toBe(true);
  });
});

describe('keyScale', () => {
  it('gives the scale of a confident key while listening, tonic first', async () => {
    const { keyScale } = await import('./keyScale');
    const key = { tonic: 'Eb', mode: 'major' as const, score: 0.9, confidence: 0.7, runnerUp: { tonic: 'C', mode: 'minor' as const, score: 0.8 }, evidence: 10, usesFlats: true };
    expect(keyScale({ listening: true, key })).toEqual([3, 5, 7, 8, 10, 0, 2]);
    expect(keyScale({ listening: true, key })).toBe(keyScale({ listening: true, key })); // stable for React
    expect(keyScale({ listening: true, key: { ...key, tonic: 'A', mode: 'minor' } })).toEqual([9, 11, 0, 2, 4, 5, 7]);
    expect(keyScale({ listening: false, key })).toBeUndefined();
    expect(keyScale({ listening: true, key: { ...key, confidence: 0.1 } })).toBeUndefined();
    expect(keyScale({ listening: true, key: null })).toBeUndefined();
  });
});
