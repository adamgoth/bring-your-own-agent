import { useState } from 'react';
import { bassDegree, inversionName, prettyName, prettyNote, prettySymbol } from '../theory';
import { tutorStore, useTutor } from '../state/store';
import { AUDIO_BLOCKED_MESSAGE } from '../audio/audioEngine';

const SHORT_INVERSIONS = ['Root', '1st', '2nd', '3rd', '4th', '5th'];

export function ChordPanel() {
  const view = useTutor((s) => s.view);
  const hand = useTutor((s) => s.hand);
  const [playError, setPlayError] = useState('');

  if (view.kind === 'empty') {
    return (
      <section className="chord chord--empty" aria-labelledby="chord-heading">
        <h2 id="chord-heading" className="chord__symbol chord__symbol--quiet">No chord yet</h2>
        <p className="chord__hint">Type a chord such as Gmaj7, pick a key, or try one of these:</p>
        <div className="examples">
          <button type="button" onClick={() => tutorStore.getState().showChord('Gmaj7')}>G major 7</button>
          <button type="button" onClick={() => tutorStore.getState().showKey('A', 'major')}>Chords in A major</button>
          <button type="button" onClick={() => tutorStore.getState().showKey('B', 'minor')}>B minor key</button>
        </div>
      </section>
    );
  }

  const { voicing } = view;
  const base = view.kind === 'chord' ? view.chord : view.chords[view.selectedIndex].chord;
  const invertible = bassDegree(base) >= 0;
  const play = async () => {
    setPlayError('');
    try {
      await tutorStore.getState().play();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not play.';
      setPlayError(message === AUDIO_BLOCKED_MESSAGE ? 'Your browser blocked audio. Press Play again.' : message);
    }
  };

  return (
    <section className="chord" aria-labelledby="chord-heading">
      <div className="chord__head">
        <div>
          <h2 id="chord-heading" className="chord__symbol">{prettySymbol(voicing.chord.symbol)}</h2>
          <p className="chord__name">
            {prettyName(voicing.chord.name)}
            {invertible && <>, {inversionName(voicing.inversion)}</>}
          </p>
        </div>
        <button type="button" className="play" onClick={play}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" /></svg>
          Play
        </button>
      </div>
      <p className="chord__notes" aria-label="Notes">
        {voicing.notes.map((n) => (
          <span key={n}>{prettyNote(n.replace(/-?\d+$/, ''))}<sub>{n.match(/-?\d+$/)?.[0]}</sub></span>
        ))}
      </p>
      <div className="chord__controls">
        {invertible && (
          <fieldset className="segmented">
            <legend>Inversion</legend>
            {base.pitchClasses.map((_, i) => (
              <label key={i}>
                <input
                  type="radio"
                  name="inversion"
                  checked={voicing.inversion === i}
                  onChange={() => tutorStore.getState().setInversion(i)}
                />
                <span>{SHORT_INVERSIONS[i]}</span>
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="segmented">
          <legend>Suggested fingering</legend>
          {(['right', 'left'] as const).map((h) => (
            <label key={h}>
              <input type="radio" name="hand" checked={hand === h} onChange={() => tutorStore.getState().setHand(h)} />
              <span>{h === 'right' ? 'Right hand' : 'Left hand'}</span>
            </label>
          ))}
        </fieldset>
      </div>
      {playError && <p className="error" role="alert">{playError}</p>}
    </section>
  );
}
