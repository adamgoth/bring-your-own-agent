import { useState } from 'react';
import { modeOf, tutorStore, useTutor, type AppMode } from '../state/store';

const MODES: Array<{ id: AppMode; label: string; hint: string }> = [
  { id: 'chord', label: 'Chord', hint: 'Look up one chord: its notes, inversions and fingering.' },
  { id: 'key', label: 'Key', hint: 'The seven chords of a key.' },
  { id: 'listen', label: 'Listen', hint: 'Follow what you play: the chord now and the key it fits.' },
];

/**
 * The app's three modes. Chord and key stay as chosen; listen follows your playing and is the only
 * mode where listening is on. Showing a chord or key from anywhere (the inputs, a strip, the agent)
 * switches modes the same way.
 */
export function ModeTabs() {
  const mode = useTutor(modeOf);
  const [error, setError] = useState('');
  const choose = async (next: AppMode) => {
    setError('');
    try {
      if (next === 'listen') await tutorStore.getState().startListening();
      else tutorStore.getState().enterMode(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch.');
    }
  };
  return (
    <div className="modes">
      <fieldset className="segmented modes__switch">
        <legend className="visually-hidden">Mode</legend>
        {MODES.map((m) => (
          <label key={m.id} title={m.hint}>
            <input type="radio" name="app-mode" checked={mode === m.id} onChange={() => void choose(m.id)} />
            <span>
              {m.id === 'listen' && <i className={`modes__dot${mode === 'listen' ? ' is-on' : ''}`} aria-hidden="true" />}
              {m.label}
            </span>
          </label>
        ))}
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
