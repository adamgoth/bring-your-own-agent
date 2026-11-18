import { useState } from 'react';
import { Note } from 'tonal';
import { chordsInKey, modeLabel, parseChord, prettyNote, prettySymbol } from '../theory';
import { tutorStore, useTutor } from '../state/store';
import { SCALE_MIN_CONFIDENCE } from '../listen/keyScale';
import { AUDIO_BLOCKED_MESSAGE } from '../audio/audioEngine';

export function KeyStrip() {
  const view = useTutor((s) => s.view);
  const [playError, setPlayError] = useState('');
  if (view.kind !== 'key') return null;
  /** Select the chord, then play it so the keyboard shows it sounding. */
  const play = async (i: number) => {
    setPlayError('');
    try {
      tutorStore.getState().selectDegree(i);
      await tutorStore.getState().play();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not play.';
      setPlayError(message === AUDIO_BLOCKED_MESSAGE ? 'Your browser blocked audio. Press play again.' : message);
    }
  };
  const title = `${prettyNote(view.tonic)} ${modeLabel(view.mode).toLowerCase()}`;
  return (
    <section className="strip" aria-labelledby="strip-heading">
      <div className="strip__head">
        <h2 id="strip-heading">Chords in {title}</h2>
        <fieldset className="segmented">
          <legend className="visually-hidden">Chord size</legend>
          {[false, true].map((sevenths) => (
            <label key={String(sevenths)}>
              <input
                type="radio"
                name="sevenths"
                checked={view.sevenths === sevenths}
                onChange={() => tutorStore.getState().showKey(view.tonic, view.mode, { sevenths, degree: view.selectedIndex })}
              />
              <span>{sevenths ? 'Sevenths' : 'Triads'}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <ol className="strip__chords">
        {view.chords.map((chord, i) => (
          <li key={chord.degree}>
            <button
              type="button"
              aria-pressed={view.selectedIndex === i}
              aria-label={`${chord.numeral}, ${chord.name}`}
              onClick={() => tutorStore.getState().selectDegree(i)}
            >
              <Numeral numeral={chord.numeral} />
              <span className="strip__symbol">{prettySymbol(chord.symbol)}</span>
            </button>
            <button
              type="button"
              className="strip__play"
              aria-label={`Play ${chord.numeral}, ${chord.name}`}
              title={`Play ${prettySymbol(chord.symbol)}`}
              onClick={() => void play(i)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5v11l9-5.5z" /></svg>
            </button>
          </li>
        ))}
      </ol>
      {playError && <p className="error" role="alert">{playError}</p>}
    </section>
  );
}

/**
 * Listen mode: the estimated key's seven chords, with the one you're playing highlighted ("you're on IV").
 * Display only, with no play buttons, so the app never plays into a listening microphone.
 */
export function ListenKeyStrip() {
  const key = useTutor((s) => (s.heard.listening ? s.heard.key : null));
  const playing = useTutor((s) => s.heard.chord?.symbol ?? null);
  if (!key || key.confidence < SCALE_MIN_CONFIDENCE) return null;
  let sevenths = false;
  let rootChroma: number | null = null;
  try {
    if (playing) {
      const parsed = parseChord(playing);
      sevenths = parsed.pitchClasses.length >= 4;
      rootChroma = Note.chroma(parsed.root) ?? null;
    }
  } catch {
    /* an unusual name: no highlight */
  }
  const { chords } = chordsInKey(key.tonic, key.mode, { sevenths });
  const current = chords.findIndex((c) => Note.chroma(c.chord.root) === rootChroma);
  const title = `${prettyNote(key.tonic)} ${modeLabel(key.mode).toLowerCase()}`;
  return (
    <section className="strip strip--listen" aria-labelledby="listen-strip-heading">
      <div className="strip__head">
        <h2 id="listen-strip-heading">
          Chords in {title}
          {current >= 0 && <span className="strip__now"> · you’re on {chords[current].numeral}</span>}
        </h2>
        <p className="strip__legend">Dots on the keyboard mark this scale; blue is the tonic.</p>
      </div>
      <ol className="strip__chords">
        {chords.map((chord, i) => (
          <li key={chord.degree} className={i === current ? 'is-current' : undefined} aria-current={i === current ? 'true' : undefined}>
            <div className="strip__cell">
              <Numeral numeral={chord.numeral} />
              <span className="strip__symbol">{prettySymbol(chord.symbol)}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Roman numeral in the display serif; accidentals and quality marks (°, ø, +, 7) in the sans, where they stay legible. */
function Numeral({ numeral }: { numeral: string }) {
  const [, accidental = '', roman = numeral, mark = ''] = /^([♭♯]?)([ivIV]+)(.*)$/.exec(numeral) ?? [];
  return (
    <span className="strip__numeral">
      {accidental && <span className="strip__mark">{accidental}</span>}
      {roman}
      {mark && <span className="strip__mark strip__mark--suffix">{mark}</span>}
    </span>
  );
}
