import { createTutorStore, describeView, type Player } from './store';

function setup(player: Player = async () => {}) {
  const calls: Array<[string[], string]> = [];
  const store = createTutorStore(async (notes, sound) => {
    calls.push([notes, sound]);
    await player(notes, sound);
  });
  return { store, s: store.getState, calls };
}

describe('tutor store', () => {
  it('starts empty', () => {
    const { s } = setup();
    expect(s().view).toEqual({ kind: 'empty' });
  });

  it('shows a chord with voicing and fingering', () => {
    const { s } = setup();
    s().showChord('Gmaj7');
    const view = s().view;
    expect(view.kind).toBe('chord');
    if (view.kind !== 'chord') return;
    expect(view.chord.name).toBe('G major seventh');
    expect(view.voicing).toMatchObject({ inversion: 0, notes: ['G3', 'B3', 'D4', 'F#4'] });
    expect(view.fingering).toEqual({ right: [1, 2, 3, 5], left: [5, 3, 2, 1] });
  });

  it('inverts the chord on screen', () => {
    const { s } = setup();
    s().showChord('Gmaj7');
    const view = s().setInversion(1);
    expect(view.voicing.notes).toEqual(['B3', 'D4', 'F#4', 'G4']);
    expect(view.voicing.chord.symbol).toBe('Gmaj7/B');
    expect(view.fingering.right).toEqual([1, 2, 4, 5]);
  });

  it('treats a slash chord on a chord tone as an inversion', () => {
    const { s } = setup();
    const view = s().showChord('C/E');
    expect(view.voicing.inversion).toBe(1);
    expect(view.voicing.notes).toEqual(['E3', 'G3', 'C4']);
    expect(s().setInversion(0).voicing.chord.symbol).toBe('C');
  });

  it('refuses to invert a chord over a foreign bass', () => {
    const { s } = setup();
    s().showChord('C/D');
    expect(() => s().setInversion(1)).toThrow(/no inversions/);
  });

  it('shows a key and selects its chords', () => {
    const { s } = setup();
    const view = s().showKey('A', 'major');
    expect(view.chords.map((c) => c.symbol)).toEqual(['A', 'Bm', 'C#m', 'D', 'E', 'F#m', 'G#dim']);
    expect(view.selectedIndex).toBe(0);
    expect(view.voicing.notes).toEqual(['A3', 'C#4', 'E4']);
    const fifth = s().selectDegree(4);
    expect(fifth.voicing.chord.symbol).toBe('E');
    expect(s().setInversion(2).voicing.chord.symbol).toBe('E/B');
    expect(s().view.kind).toBe('key');
  });

  it('switches a key to sevenths and keeps the selection', () => {
    const { s } = setup();
    s().showKey('C', 'major', { degree: 4 });
    const view = s().showKey('C', 'major', { sevenths: true, degree: 4 });
    expect(view.voicing.chord.symbol).toBe('G7');
  });

  it('rejects bad input without changing the view', () => {
    const { s } = setup();
    s().showChord('Bm');
    const before = s().view;
    expect(() => s().showChord('nope')).toThrow(/not a chord symbol/);
    expect(() => s().showKey('H', 'major')).toThrow(/not a key name/);
    expect(() => s().selectDegree(2)).toThrow(/No key is shown/);
    expect(() => s().setInversion(5)).toThrow(/0 \(root position\) to 2/);
    expect(s().view).toBe(before);
  });

  it('plays the voiced chord with the current sound', async () => {
    const { s, calls } = setup();
    s().showChord('Bm');
    s().setSound('sawPad');
    expect(await s().play()).toEqual({ symbol: 'Bm', notes: ['B3', 'D4', 'F#4'], sound: 'sawPad' });
    expect(calls).toEqual([[['B3', 'D4', 'F#4'], 'sawPad']]);
  });

  it('reports blocked audio and nothing-to-play', async () => {
    const { s } = setup(async () => {
      throw new Error('Audio is blocked');
    });
    await expect(s().play()).rejects.toThrow(/Nothing to play/);
    s().showChord('C');
    await expect(s().play()).rejects.toThrow(/blocked/);
    expect(s().sounding).toEqual([]);
  });

  it('rejects unknown sounds', () => {
    const { s } = setup();
    expect(() => s().setSound('kazoo')).toThrow(/Unknown sound/);
  });

  it('describes the view in one line', () => {
    const { s } = setup();
    expect(describeView(s().view)).toMatch(/Nothing shown/);
    s().showChord('Gmaj7');
    expect(describeView(s().view)).toBe(
      'Gmaj7, G major seventh, root position: G3 B3 D4 F♯4. Right hand 1-2-3-5, left hand 5-3-2-1.',
    );
    s().showKey('Bb', 'major');
    expect(describeView(s().view)).toMatch(/^B♭ major triads: I B♭, ii Cm, iii Dm, IV E♭/);
  });

  it('clears', () => {
    const { s } = setup();
    s().showChord('C');
    s().clear();
    expect(s().view.kind).toBe('empty');
  });
});
