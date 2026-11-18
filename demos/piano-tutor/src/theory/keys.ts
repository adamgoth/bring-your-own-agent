import { Interval, Scale } from 'tonal';
import { parseChord, type ParsedChord } from './chords';
import { parsePitchClass } from './notes';

export const MODES = [
  { id: 'major', label: 'Major', scale: 'major' },
  { id: 'minor', label: 'Natural minor', scale: 'minor' },
  { id: 'harmonic minor', label: 'Harmonic minor', scale: 'harmonic minor' },
  { id: 'melodic minor', label: 'Melodic minor', scale: 'melodic minor' },
  { id: 'dorian', label: 'Dorian', scale: 'dorian' },
  { id: 'phrygian', label: 'Phrygian', scale: 'phrygian' },
  { id: 'lydian', label: 'Lydian', scale: 'lydian' },
  { id: 'mixolydian', label: 'Mixolydian', scale: 'mixolydian' },
] as const;

export type ModeId = (typeof MODES)[number]['id'];

const ALIASES: Record<string, ModeId> = {
  major: 'major', ionian: 'major', maj: 'major',
  minor: 'minor', min: 'minor', 'natural minor': 'minor', aeolian: 'minor',
  'harmonic minor': 'harmonic minor', harmonic: 'harmonic minor',
  'melodic minor': 'melodic minor', melodic: 'melodic minor', 'jazz minor': 'melodic minor',
  dorian: 'dorian', phrygian: 'phrygian', lydian: 'lydian', mixolydian: 'mixolydian',
};

export function parseMode(input: unknown): ModeId {
  const key = typeof input === 'string' ? input.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ') : '';
  const mode = ALIASES[key];
  if (!mode) {
    throw new Error(`"${String(input)}" is not a mode I know. Use one of: ${MODES.map((m) => m.id).join(', ')}.`);
  }
  return mode;
}

export const modeLabel = (mode: ModeId): string => MODES.find((m) => m.id === mode)!.label;

export type KeyChord = {
  /** 1–7 */
  degree: number;
  numeral: string;
  symbol: string;
  name: string;
  notes: string[];
  chord: ParsedChord;
};

export type KeyChords = {
  tonic: string;
  mode: ModeId;
  sevenths: boolean;
  scale: string[];
  chords: KeyChord[];
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const MAJOR_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/** Chord suffix and numeral decoration from the third, fifth and (optional) seventh above the root. */
function describe(third: number, fifth: number, seventh?: number): { suffix: string; minorCase: boolean; mark: string } {
  const triad =
    third === 4 && fifth === 7 ? 'maj' :
    third === 3 && fifth === 7 ? 'min' :
    third === 3 && fifth === 6 ? 'dim' :
    third === 4 && fifth === 8 ? 'aug' : 'other';
  if (seventh === undefined) {
    return {
      maj: { suffix: '', minorCase: false, mark: '' },
      min: { suffix: 'm', minorCase: true, mark: '' },
      dim: { suffix: 'dim', minorCase: true, mark: '°' },
      aug: { suffix: 'aug', minorCase: false, mark: '+' },
      other: { suffix: '', minorCase: false, mark: '?' },
    }[triad];
  }
  const key = `${triad}:${seventh}`;
  const table: Record<string, { suffix: string; minorCase: boolean; mark: string }> = {
    'maj:11': { suffix: 'maj7', minorCase: false, mark: 'maj7' },
    'maj:10': { suffix: '7', minorCase: false, mark: '7' },
    'min:10': { suffix: 'm7', minorCase: true, mark: '7' },
    'min:11': { suffix: 'mMaj7', minorCase: true, mark: 'maj7' },
    'dim:10': { suffix: 'm7b5', minorCase: true, mark: 'ø7' },
    'dim:9': { suffix: 'dim7', minorCase: true, mark: '°7' },
    'aug:11': { suffix: 'maj7#5', minorCase: false, mark: '+maj7' },
    'aug:10': { suffix: '7#5', minorCase: false, mark: '+7' },
  };
  return table[key] ?? { suffix: '', minorCase: false, mark: '?' };
}

const semis = (from: string, to: string): number => ((Interval.semitones(Interval.distance(from, to)) ?? 0) % 12 + 12) % 12;

/** The seven diatonic chords of a key, spelled from its scale. */
export function chordsInKey(tonicInput: unknown, modeInput: unknown, { sevenths = false } = {}): KeyChords {
  const tonic = parsePitchClass(tonicInput, 'key');
  const mode = parseMode(modeInput);
  const scaleName = MODES.find((m) => m.id === mode)!.scale;
  const scale = Scale.get(`${tonic} ${scaleName}`).notes;
  if (scale.length !== 7) throw new Error(`Could not build the ${tonic} ${mode} scale.`);
  const chords = scale.map((root, i): KeyChord => {
    const tones = [0, 2, 4, ...(sevenths ? [6] : [])].map((step) => scale[(i + step) % 7]);
    const [third, fifth, seventh] = tones.slice(1).map((n) => semis(root, n));
    const { suffix, minorCase, mark } = describe(third, fifth, seventh);
    const offset = semis(tonic, root) - MAJOR_SEMITONES[i];
    const accidental = offset === -1 || offset === 11 ? '♭' : offset === 1 || offset === -11 ? '♯' : '';
    const numeral = accidental + (minorCase ? ROMAN[i].toLowerCase() : ROMAN[i]) + mark;
    const chord = parseChord(root + suffix);
    return { degree: i + 1, numeral, symbol: chord.symbol, name: chord.name, notes: tones, chord: { ...chord, pitchClasses: tones } };
  });
  return { tonic, mode, sevenths, scale, chords };
}
