import { useEffect, useState, type FormEvent } from 'react';
import { MODES } from '../theory';
import { tutorStore, useTutor } from '../state/store';

const TONICS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const pretty = (t: string) => t.replace('#', '♯').replace('b', '♭');

/** One slim row: type a chord and press Enter, or pick a key note to show that key. */
export function Controls() {
  const view = useTutor((s) => s.view);
  const [symbol, setSymbol] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<string>('major');

  // The key pickers follow the key on screen, however it got there (tools, examples, strip).
  const shownTonic = view.kind === 'key' && TONICS.includes(view.tonic) ? view.tonic : '';
  const shownMode = view.kind === 'key' ? view.mode : null;
  useEffect(() => {
    if (shownMode) setMode(shownMode);
  }, [shownMode]);

  const showChord = (event: FormEvent) => {
    event.preventDefault();
    if (!symbol.trim()) return;
    try {
      tutorStore.getState().showChord(symbol);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That chord could not be shown.');
    }
  };

  const showKey = (tonic: string, nextMode: string) => {
    const sevenths = view.kind === 'key' ? view.sevenths : false;
    tutorStore.getState().showKey(tonic, nextMode, { sevenths });
  };

  return (
    <div className="controls">
      <form className="controls__chord" onSubmit={showChord} noValidate>
        <label htmlFor="chord-input" className="visually-hidden">Chord (press Enter to show it)</label>
        <input
          id="chord-input"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Chord: Gmaj7, Bm, C/E"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'chord-error' : undefined}
        />
      </form>
      <div className="controls__key" role="group" aria-label="Key">
        <select aria-label="Key note" value={shownTonic} onChange={(e) => e.target.value && showKey(e.target.value, mode)}>
          <option value="" disabled>Key</option>
          {TONICS.map((t) => <option key={t} value={t}>{pretty(t)}</option>)}
        </select>
        <select
          aria-label="Mode"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            if (shownTonic) showKey(shownTonic, e.target.value);
          }}
        >
          {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
      {error && <p id="chord-error" className="error controls__error" role="alert">{error}</p>}
    </div>
  );
}
