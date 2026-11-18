import {
  chordsInKey,
  detectChord,
  invertChord,
  parseChord,
  parseMode,
  parsePitchClass,
  prettyName,
  prettyNote,
  prettySymbol,
  suggestFingering,
  voiceChord,
} from './index';

const voice = (symbol: string, inversion?: number) => voiceChord(parseChord(symbol), { inversion }).join(' ');

describe('parseChord', () => {
  it.each([
    ['Gmaj7', 'G', 'major seventh', ['G', 'B', 'D', 'F#'], 'G major seventh'],
    ['Bm', 'B', 'minor', ['B', 'D', 'F#'], 'B minor'],
    ['F#m7b5', 'F#', 'half-diminished', ['F#', 'A', 'C', 'E'], 'F# half-diminished'],
    ['Bbsus4', 'Bb', 'suspended fourth', ['Bb', 'Eb', 'F'], 'Bb suspended fourth'],
    ['C', 'C', 'major', ['C', 'E', 'G'], 'C major'],
    ['Bdim', 'B', 'diminished', ['B', 'D', 'F'], 'B diminished'],
    ['Caug', 'C', 'augmented', ['C', 'E', 'G#'], 'C augmented'],
    ['D7', 'D', 'dominant seventh', ['D', 'F#', 'A', 'C'], 'D dominant seventh'],
    ['Am7', 'A', 'minor seventh', ['A', 'C', 'E', 'G'], 'A minor seventh'],
    ['Bdim7', 'B', 'diminished seventh', ['B', 'D', 'F', 'Ab'], 'B diminished seventh'],
  ])('%s', (symbol, root, quality, pitchClasses, name) => {
    const chord = parseChord(symbol);
    expect(chord).toMatchObject({ symbol, root, quality, pitchClasses, name });
    expect(chord.bass).toBeUndefined();
  });

  it('parses slash chords and keeps chord tones in root-position order', () => {
    expect(parseChord('C/E')).toEqual({
      symbol: 'C/E',
      name: 'C major over E',
      root: 'C',
      quality: 'major',
      pitchClasses: ['C', 'E', 'G'],
      bass: 'E',
    });
    expect(parseChord('Am/G')).toMatchObject({ root: 'A', bass: 'G', pitchClasses: ['A', 'C', 'E'] });
  });

  it('tidies the forms people type', () => {
    expect(parseChord('gmaj7').symbol).toBe('Gmaj7');
    expect(parseChord('B♭m').symbol).toBe('Bbm');
    expect(parseChord('CM7').symbol).toBe('Cmaj7');
    expect(parseChord('Gmaj').symbol).toBe('G');
    expect(parseChord(' F# m ').symbol).toBe('F#m');
    expect(parseChord('Cø').symbol).toBe('Cm7b5');
  });

  it.each(['', 'xyz', 'H', 'Cblah', '7', 'C//E'])('rejects %j with a readable error', (junk) => {
    expect(() => parseChord(junk)).toThrow(/chord symbol/);
  });

  it('rejects non-strings', () => {
    expect(() => parseChord(undefined)).toThrow(/No chord symbol/);
    expect(() => parseChord(42)).toThrow(/No chord symbol/);
  });
});

describe('voiceChord', () => {
  it('centres voicings near middle C', () => {
    expect(voice('Gmaj7')).toBe('G3 B3 D4 F#4');
    expect(voice('C')).toBe('C4 E4 G4');
    expect(voice('Bm')).toBe('B3 D4 F#4');
    expect(voice('F#m7b5')).toBe('F#3 A3 C4 E4');
    expect(voice('Bbsus4')).toBe('Bb3 Eb4 F4');
  });

  it('voices every inversion of a triad', () => {
    expect(voice('C', 0)).toBe('C4 E4 G4');
    expect(voice('C', 1)).toBe('E3 G3 C4');
    expect(voice('C', 2)).toBe('G3 C4 E4');
  });

  it('voices every inversion of a seventh chord', () => {
    expect(voice('Gmaj7', 0)).toBe('G3 B3 D4 F#4');
    expect(voice('Gmaj7', 1)).toBe('B3 D4 F#4 G4');
    expect(voice('Gmaj7', 2)).toBe('D4 F#4 G4 B4');
    expect(voice('Gmaj7', 3)).toBe('F#3 G3 B3 D4');
  });

  it('puts the bass of a slash chord at the bottom', () => {
    expect(voice('C/E')).toBe('E3 G3 C4');
    expect(voice('C/G')).toBe('G3 C4 E4');
    expect(voice('C/D')).toBe('D3 C4 E4 G4');
  });

  it('keeps flat spellings, including where the octave number changes', () => {
    expect(voice('Ebm')).toBe('Eb4 Gb4 Bb4');
    expect(voice('Cb')).toBe('Cb4 Eb4 Gb4');
    expect(voice('Bdim7')).toBe('B3 D4 F4 Ab4');
  });

  it('honours a requested register', () => {
    expect(voiceChord(parseChord('C'), { octave: 5 }).join(' ')).toBe('C5 E5 G5');
  });

  it('rejects an inversion the chord does not have', () => {
    expect(() => voiceChord(parseChord('C'), { inversion: 3 })).toThrow(/0 \(root position\) to 2/);
    expect(() => voiceChord(parseChord('C'), { inversion: 1.5 })).toThrow(/whole number/);
  });
});

describe('invertChord', () => {
  it('renames inversions as slash chords', () => {
    const g = parseChord('Gmaj7');
    expect([0, 1, 2, 3].map((n) => invertChord(g, n).symbol)).toEqual(['Gmaj7', 'Gmaj7/B', 'Gmaj7/D', 'Gmaj7/F#']);
    expect(invertChord(parseChord('C/E'), 0).symbol).toBe('C');
  });
});

describe('suggestFingering', () => {
  const finger = (symbol: string, inversion: number, hand: 'left' | 'right') =>
    suggestFingering(voiceChord(parseChord(symbol), { inversion }), hand).join('-');

  it('uses the standard triad shapes', () => {
    expect([0, 1, 2].map((n) => finger('C', n, 'right'))).toEqual(['1-3-5', '1-2-5', '1-3-5']);
    expect([0, 1, 2].map((n) => finger('C', n, 'left'))).toEqual(['5-3-1', '5-3-1', '5-2-1']);
  });

  it('uses the standard seventh shapes', () => {
    expect([0, 1, 2, 3].map((n) => finger('Gmaj7', n, 'right'))).toEqual(['1-2-3-5', '1-2-4-5', '1-2-3-5', '1-2-3-5']);
    expect([0, 1, 2, 3].map((n) => finger('Gmaj7', n, 'left'))).toEqual(['5-3-2-1', '5-3-2-1', '5-3-2-1', '5-4-2-1']);
  });

  it('handles suspended shapes', () => {
    expect(finger('Csus2', 0, 'right')).toBe('1-2-5');
    expect(finger('Csus4', 0, 'right')).toBe('1-3-4');
  });

  it('returns one finger per note in any input order', () => {
    expect(suggestFingering(['G4', 'C4', 'E4'], 'right')).toEqual([1, 3, 5]);
  });
});

describe('chordsInKey', () => {
  const summary = (tonic: string, mode: string, sevenths = false) =>
    chordsInKey(tonic, mode, { sevenths }).chords.map((c) => `${c.numeral} ${c.symbol}`);

  it('gives all seven chords of C major', () => {
    expect(summary('C', 'major')).toEqual(['I C', 'ii Dm', 'iii Em', 'IV F', 'V G', 'vi Am', 'vii° Bdim']);
    expect(summary('C', 'major', true)).toEqual([
      'Imaj7 Cmaj7', 'ii7 Dm7', 'iii7 Em7', 'IVmaj7 Fmaj7', 'V7 G7', 'vi7 Am7', 'viiø7 Bm7b5',
    ]);
  });

  it('gives all seven chords of A major with their notes', () => {
    const key = chordsInKey('A', 'major');
    expect(key.chords.map((c) => `${c.numeral} ${c.symbol}`)).toEqual([
      'I A', 'ii Bm', 'iii C#m', 'IV D', 'V E', 'vi F#m', 'vii° G#dim',
    ]);
    expect(key.chords[0].notes).toEqual(['A', 'C#', 'E']);
    expect(key.chords[6].notes).toEqual(['G#', 'B', 'D']);
    expect(key.chords.map((c) => c.degree)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('gives all seven chords of B minor', () => {
    expect(summary('B', 'minor')).toEqual(['i Bm', 'ii° C#dim', '♭III D', 'iv Em', 'v F#m', '♭VI G', '♭VII A']);
    expect(summary('B', 'harmonic minor')).toEqual(['i Bm', 'ii° C#dim', '♭III+ Daug', 'iv Em', 'V F#', '♭VI G', 'vii° A#dim']);
    expect(summary('B', 'melodic minor')).toEqual(['i Bm', 'ii C#m', '♭III+ Daug', 'IV E', 'V F#', 'vi° G#dim', 'vii° A#dim']);
  });

  it('spells flat keys with flats', () => {
    const key = chordsInKey('Bb', 'major');
    expect(key.scale).toEqual(['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A']);
    expect(key.chords[0].notes).toEqual(['Bb', 'D', 'F']);
    expect(key.chords[3].symbol).toBe('Eb');
    expect(key.chords.flatMap((c) => c.notes).some((n) => n.includes('#'))).toBe(false);
    expect(summary('F', 'minor')).toEqual(['i Fm', 'ii° Gdim', '♭III Ab', 'iv Bbm', 'v Cm', '♭VI Db', '♭VII Eb']);
  });

  it('covers the church modes', () => {
    expect(summary('D', 'dorian')).toEqual(['i Dm', 'ii Em', '♭III F', 'IV G', 'v Am', 'vi° Bdim', '♭VII C']);
    expect(summary('E', 'phrygian')).toEqual(['i Em', '♭II F', '♭III G', 'iv Am', 'v° Bdim', '♭VI C', '♭vii Dm']);
    expect(summary('F', 'lydian')).toEqual(['I F', 'II G', 'iii Am', '♯iv° Bdim', 'V C', 'vi Dm', 'vii Em']);
    expect(summary('G', 'mixolydian')).toEqual(['I G', 'ii Am', 'iii° Bdim', 'IV C', 'v Dm', 'vi Em', '♭VII F']);
  });

  it('accepts mode aliases', () => {
    expect(parseMode('Natural Minor')).toBe('minor');
    expect(parseMode('aeolian')).toBe('minor');
    expect(parseMode('ionian')).toBe('major');
    expect(parseMode('harmonic_minor')).toBe('harmonic minor');
  });

  it('rejects unknown tonics and modes', () => {
    expect(() => chordsInKey('H', 'major')).toThrow(/not a key name/);
    expect(() => chordsInKey('C4', 'major')).toThrow(/not a key name/);
    expect(() => chordsInKey('C', 'locrian')).toThrow(/not a mode I know/);
  });
});

describe('detectChord', () => {
  it('names root-position chords', () => {
    expect(detectChord(['C4', 'E4', 'G4'])[0]).toBe('C');
    expect(detectChord(['G3', 'B3', 'D4', 'F#4'])[0]).toBe('Gmaj7');
    expect(detectChord(['A3', 'C4', 'E4', 'G4'])[0]).toBe('Am7');
  });

  it('reads the lowest note as the bass', () => {
    expect(detectChord(['G3', 'C4', 'E3'])[0]).toBe('C/E');
  });

  it('ignores doubled notes and returns nothing for fewer than two pitch classes', () => {
    expect(detectChord(['C3', 'C4', 'E4', 'G4', 'C5'])[0]).toBe('C');
    expect(detectChord(['C4', 'C5'])).toEqual([]);
  });
});

describe('notes', () => {
  it('parses and prettifies pitch classes', () => {
    expect(parsePitchClass('bb')).toBe('Bb');
    expect(parsePitchClass('F♯')).toBe('F#');
    expect(prettyNote('Bb3')).toBe('B♭3');
    expect(prettyNote('F#')).toBe('F♯');
    expect(prettySymbol('Bbm7b5/Db')).toBe('B♭m7b5/D♭');
    expect(prettyName('F# half-diminished over Bb')).toBe('F♯ half-diminished over B♭');
    expect(prettyName('B minor')).toBe('B minor');
  });
});
