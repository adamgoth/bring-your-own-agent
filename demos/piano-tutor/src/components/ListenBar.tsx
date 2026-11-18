import { keyName } from '../listen/keyEstimate';
import { SCALE_MIN_CONFIDENCE } from '../listen/keyScale';
import { parseChord, prettyName, prettyNote, prettySymbol } from '../theory';
import { tutorStore, useTutor, type HeardState, type ListenInput } from '../state/store';
import { MicComparison } from './MicControls';

/** One short line under the input switch: what the chosen input is doing. Never a popover. */
function inputNote({ midi, mic }: HeardState, input: ListenInput): { text: string; title?: string } {
  if (input === 'mic') {
    if (mic.status === 'starting') return { text: 'Starting the microphone…' };
    if (mic.status === 'error') return { text: 'Microphone unavailable', title: `${mic.message ?? 'The microphone could not start.'} You can tap the keys below.` };
    if (mic.status === 'on') return { text: mic.label ?? 'Microphone on', title: 'Experimental: chords heard through the microphone. The app ignores its own sound.' };
    return { text: 'Microphone off' };
  }
  if (midi.status === 'connected') return { text: midi.devices.join(', ') };
  if (midi.status === 'connecting') return { text: 'Connecting…' };
  if (midi.status === 'no-devices') return { text: 'No keyboard found', title: 'Plug in a MIDI keyboard, or tap the keys below.' };
  if (midi.status === 'unavailable') return { text: 'MIDI not available here', title: `${midi.message ?? 'This browser does not allow MIDI.'} You can tap the keys below.` };
  return { text: 'Off' };
}

const INPUTS: Array<{ id: ListenInput; label: string }> = [
  { id: 'midi', label: 'MIDI' },
  { id: 'mic', label: 'Microphone' },
];

const prettyKey = (name: string) => name.replace(/^([A-G])(#|b)?/, (_, l: string, a = '') => prettyNote(l + a));

/** Full name of a heard chord, or null if the panel can't parse it. */
function heardName(symbol: string): string | null {
  try {
    return prettyName(parseChord(symbol).name);
  } catch {
    return null;
  }
}

/** Listen mode's main panel: the chord you are playing, the notes held, the key guess and the input status. */
export function ListenPanel() {
  const heard = useTutor((s) => s.heard);
  const input = useTutor((s) => s.listenInput);
  const { chord, key, mic } = heard;
  const confident = key !== null && key.confidence >= SCALE_MIN_CONFIDENCE;
  const note = inputNote(heard, input);
  // After you let go, keep the last chord on screen (dimmed) rather than going blank.
  const last = chord ?? heard.history.at(-1) ?? null;
  const name = last ? heardName(last.symbol) : null;
  return (
    <section className="chord listen-panel" aria-labelledby="listen-heading" aria-live="polite">
      <h2 id="listen-heading" className={`chord__symbol listen-panel__chord${chord ? '' : ' chord__symbol--quiet'}`}>
        {last ? prettySymbol(last.symbol) : heard.sounding.length ? '…' : 'Play'}
      </h2>
      <p className="chord__name listen-panel__name">
        <i className="modes__dot is-on" aria-hidden="true" />
        {chord ? `You’re playing ${name ?? 'an unusual voicing'}` : last ? `Last chord: ${name ?? 'an unusual voicing'}` : 'Listening for a chord'}
      </p>
      <p className="chord__notes listen-panel__notes" aria-label="Notes held">
        {heard.sounding.length ? (
          heard.sounding.map((n) => (
            <span key={n}>{prettyNote(n.replace(/-?\d+$/, ''))}<sub>{n.match(/-?\d+$/)?.[0]}</sub></span>
          ))
        ) : (
          <span className="listen__muted">No notes held</span>
        )}
      </p>
      <div className="listen-panel__facts">
        <div className="listen__key">
          <span className="listen__label">Key</span>
          {key ? (
            <span title={confident ? undefined : 'Too unsure to mark on the keyboard yet'}>
              <span>
                {prettyKey(keyName(key))}
                {!confident && <span className="listen__unsure">?</span>}
              </span>
              <meter min={0} max={1} low={0.3} high={0.6} optimum={1} value={key.confidence} aria-label={`Confidence ${Math.round(key.confidence * 100)}%`} />
            </span>
          ) : (
            <span className="listen__muted">Keep playing</span>
          )}
        </div>
        <div className="listen__input">
          <span className="listen__label" id="listen-input-label">Input</span>
          <div className="listen__input-row">
            <fieldset className="segmented segmented--small" aria-labelledby="listen-input-label">
              {INPUTS.map((option) => (
                <label key={option.id}>
                  <input type="radio" name="listen-input" checked={input === option.id} onChange={() => void tutorStore.getState().setListenInput(option.id)} />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
            <span className="listen__muted listen__note" title={note.title}>
              {input === 'mic' && mic.status === 'on' && (
                <span className="mic__level" aria-hidden="true"><span style={{ inlineSize: `${Math.round(mic.level * 100)}%` }} /></span>
              )}
              {note.text}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Listen mode: recent chords and Clear. Sits under the key strip. */
export function ListenDetails() {
  const listening = useTutor((s) => s.heard.listening);
  const history = useTutor((s) => s.heard.history);
  if (!listening) return null;
  return (
    <>
      <section className="listen-more" aria-label="Recent chords">
        {history.length > 0 && (
          <>
            <ol className="listen__history" aria-label="Recent chords">
              {history.slice(-8).map((c) => (
                <li key={`${c.symbol}-${c.at}`}>{prettySymbol(c.symbol)}</li>
              ))}
            </ol>
            <button type="button" className="listen__reset" onClick={() => tutorStore.getState().resetListening()}>
              Clear
            </button>
          </>
        )}
      </section>
      <MicComparison />
    </>
  );
}
