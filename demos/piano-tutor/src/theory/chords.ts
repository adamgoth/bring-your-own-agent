import { Chord } from 'tonal';
import { capitaliseRoot, midiOf, normaliseAccidentals } from './notes';

export type ParsedChord = {
  /** Canonical symbol as typed after clean-up, e.g. "Gmaj7", "C/E". */
  symbol: string;
  /** Full name, e.g. "G major seventh", "C major over E". */
  name: string;
  /** Root (tonal's "tonic"), e.g. "G". */
  root: string;
  /** Chord type in words, e.g. "major seventh", "half-diminished". */
  quality: string;
  /** Chord tones in root-position order, root first. */
  pitchClasses: string[];
  /** Bass note of a slash chord, if any. */
  bass?: string;
};

const EXAMPLES = 'Try a symbol such as C, Bm, Gmaj7, F#m7b5, Bbsus4 or C/E.';

/** Tidy tonal's symbol spellings into the ones most people read. */
export function canonicalSuffix(suffix: string): string {
  const map: Record<string, string> = {
    M: '', maj: '', Maj: '', major: '',
    min: 'm', minor: 'm', '-': 'm',
    Maj7: 'maj7', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', ma7: 'maj7',
    o: 'dim', '°': 'dim', o7: 'dim7', '°7': 'dim7',
    '+': 'aug', '+5': 'aug',
    '+maj7': 'maj7#5', 'M7#5': 'maj7#5', 'maj#5': 'maj7#5',
    'ø': 'm7b5', 'ø7': 'm7b5', h7: 'm7b5', h: 'm7b5',
    'm/ma7': 'mMaj7', 'm/maj7': 'mMaj7', mM7: 'mMaj7', mmaj7: 'mMaj7',
    sus: 'sus4',
  };
  return map[suffix] ?? suffix;
}

function splitSymbol(symbol: string): { root: string; suffix: string; bass?: string } | null {
  const match = /^([A-G](?:#{1,2}|b{1,2})?)(.*?)(?:\/([A-G](?:#{1,2}|b{1,2})?))?$/.exec(symbol);
  if (!match) return null;
  return { root: match[1], suffix: match[2], bass: match[3] };
}

export function parseChord(input: unknown): ParsedChord {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error(`No chord symbol given. ${EXAMPLES}`);
  }
  const cleaned = capitaliseRoot(normaliseAccidentals(input.trim().replace(/\s+/g, '')));
  const parts = splitSymbol(cleaned);
  if (!parts) throw new Error(`"${input}" is not a chord symbol I recognise. ${EXAMPLES}`);
  const bassPart = parts.bass ? capitaliseRoot(parts.bass) : undefined;
  const suffix = canonicalSuffix(parts.suffix);
  const upper = Chord.get(parts.root + suffix);
  if (upper.empty || !upper.tonic) {
    throw new Error(`"${input}" is not a chord symbol I recognise. ${EXAMPLES}`);
  }
  const bass = bassPart && bassPart !== upper.tonic ? bassPart : undefined;
  const symbol = parts.root + suffix + (bass ? `/${bass}` : '');
  return {
    symbol,
    name: upper.name + (bass ? ` over ${bass}` : ''),
    root: upper.tonic,
    quality: upper.type,
    pitchClasses: upper.notes,
    ...(bass ? { bass } : {}),
  };
}

/** Index of the bass note among the chord tones, or -1 if the bass is not a chord tone. */
export function bassDegree(chord: ParsedChord): number {
  if (!chord.bass) return 0;
  const bassMidi = midiOf(chord.bass + '4') % 12;
  return chord.pitchClasses.findIndex((pc) => midiOf(pc + '4') % 12 === bassMidi);
}

export const inversionCount = (chord: ParsedChord): number => chord.pitchClasses.length;

const ORDINALS = ['root position', 'first inversion', 'second inversion', 'third inversion', 'fourth inversion', 'fifth inversion'];
export const inversionName = (n: number): string => ORDINALS[n] ?? `inversion ${n}`;

/** The same chord with the given inversion, re-symbolled as a slash chord when inverted. */
export function invertChord(chord: ParsedChord, inversion: number): ParsedChord {
  const n = checkInversion(chord, inversion);
  const plain = parseChord(chord.symbol.split('/')[0]);
  if (n === 0) return plain;
  const bass = plain.pitchClasses[n];
  return { ...plain, symbol: `${plain.symbol}/${bass}`, name: `${plain.name} over ${bass}`, bass };
}

function checkInversion(chord: ParsedChord, inversion: number): number {
  const max = chord.pitchClasses.length - 1;
  if (!Number.isInteger(inversion) || inversion < 0 || inversion > max) {
    throw new Error(`${chord.symbol} has ${max + 1} notes, so the inversion must be a whole number from 0 (root position) to ${max}.`);
  }
  return inversion;
}

export type VoiceOptions = { inversion?: number; octave?: number };

/** Lowest and highest keys on the on-screen keyboard (C3 to C6). */
export const KEYBOARD_LOW = 48;
export const KEYBOARD_HIGH = 84;

/** Stack pitch classes upwards: each note is the nearest one above the previous. */
function stack(pitchClasses: string[], startOctave: number): string[] {
  const notes: string[] = [];
  let previous = -Infinity;
  for (const pc of pitchClasses) {
    let octave = notes.length === 0 ? startOctave : startOctave - 1;
    while (midiOf(pc + octave) <= previous) octave += 1;
    notes.push(pc + octave);
    previous = midiOf(pc + octave);
  }
  return notes;
}

/**
 * Voice a chord as notes with octaves.
 * `inversion` puts that chord tone in the bass (0 = root position). A slash chord whose bass is a
 * chord tone starts from that inversion; one whose bass is not (C/D) puts the bass under the chord.
 * The voicing is moved by whole octaves so its centre sits nearest C♯ of `octave` (4 = just above middle C),
 * then kept on the C3–C6 keyboard.
 */
export function voiceChord(chord: ParsedChord, { inversion, octave = 4 }: VoiceOptions = {}): string[] {
  const degree = bassDegree(chord);
  let order: string[];
  if (chord.bass && degree < 0) {
    order = [chord.bass, ...chord.pitchClasses];
  } else {
    const n = checkInversion(chord, inversion ?? degree);
    order = [...chord.pitchClasses.slice(n), ...chord.pitchClasses.slice(0, n)];
  }
  // A semitone above C breaks near-ties (E3–C4 vs E4–C5) toward the lower voicing and Eb3–Bb3 vs Eb4–Bb4 upward.
  const target = 12 * (octave + 1) + 1;
  let best = stack(order, octave);
  let bestDistance = Infinity;
  for (let start = octave - 2; start <= octave + 1; start += 1) {
    const candidate = stack(order, start);
    const midis = candidate.map(midiOf);
    const centre = (Math.min(...midis) + Math.max(...midis)) / 2;
    const distance = Math.abs(centre - target);
    const fits = midis[0] >= KEYBOARD_LOW && midis[midis.length - 1] <= KEYBOARD_HIGH;
    const score = distance + (fits ? 0 : 100);
    if (score < bestDistance) {
      best = candidate;
      bestDistance = score;
    }
  }
  return best;
}
