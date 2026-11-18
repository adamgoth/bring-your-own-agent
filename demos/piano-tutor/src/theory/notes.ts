import { Note } from 'tonal';

/** Turn user-typed accidentals into tonal's ASCII form: ♭ → b, ♯ → #, ♮ dropped. */
export function normaliseAccidentals(text: string): string {
  return text.replace(/♭/g, 'b').replace(/♯/g, '#').replace(/♮/g, '').replace(/𝄪/g, '##').replace(/𝄫/g, 'bb');
}

/** Uppercase a leading note letter so "bm" and "f#m7" parse. */
export function capitaliseRoot(text: string): string {
  return text.replace(/^([a-g])/, (letter) => letter.toUpperCase());
}

/**
 * Parse a pitch class such as "Bb", "f#", "E♭". Returns tonal's spelling or throws.
 * Octaves are rejected: a tonic or root is a pitch class.
 */
export function parsePitchClass(input: unknown, what = 'note'): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error(`Give a ${what} name such as C, F# or Bb.`);
  }
  const text = capitaliseRoot(normaliseAccidentals(input.trim()));
  const note = Note.get(text);
  if (note.empty || note.oct !== undefined || !/^[A-G](#{1,2}|b{1,2})?$/.test(text)) {
    throw new Error(`"${input}" is not a ${what} name. Use a letter A–G with an optional # or b, such as C, F# or Bb.`);
  }
  return note.pc;
}

export const midiOf = (note: string): number => {
  const midi = Note.midi(note);
  if (midi === null || midi === undefined) throw new Error(`"${note}" is not a note with an octave.`);
  return midi;
};

export const pitchClassOf = (note: string): string => Note.pitchClass(note);

/** Display form for people: Bb → B♭, F# → F♯. */
export function prettyNote(note: string): string {
  return note.replace(/##/g, '𝄪').replace(/#/g, '♯').replace(/(?<=[A-G])bb/g, '𝄫').replace(/(?<=[A-G])b/g, '♭');
}

/** Display form for a chord symbol: only the root and bass accidentals become ♭/♯. */
export function prettySymbol(symbol: string): string {
  return symbol
    .replace(/^([A-G])(#{1,2}|b{1,2})?/, (_, letter: string, acc = '') => prettyNote(letter + acc))
    .replace(/\/([A-G])(#{1,2}|b{1,2})?$/, (_, letter: string, acc = '') => '/' + prettyNote(letter + acc));
}

/** Display form for a chord name: "F# half-diminished over Bb" → "F♯ half-diminished over B♭". */
export function prettyName(name: string): string {
  return name.replace(/(^|\s)([A-G])(#{1,2}|b{1,2})(?=\s|$)/g, (_, space: string, letter: string, acc: string) => space + prettyNote(letter + acc));
}
