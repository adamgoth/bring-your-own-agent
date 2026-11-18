import { prettySymbol } from '../theory';
import { useTutor } from '../state/store';

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

/** Mic accuracy against MIDI on the same playing, per chord type. Shown while both are on. */
export function MicComparison() {
  const mic = useTutor((s) => s.heard.mic);
  if (mic.status !== 'on' || mic.mode !== 'compare') return null;
  const report = mic.compare;
  const download = () => {
    const blob = new Blob([JSON.stringify({ recordedAt: new Date().toISOString(), microphone: mic.label, ...report }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'mic-vs-midi.json' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="compare" aria-label="Microphone compared with MIDI">
      <p className="compare__lead">
        MIDI is the reference while both are on. Play chords and the mic is scored against it.
        {mic.lastChord && <> Mic heard <strong>{prettySymbol(mic.lastChord)}</strong>.</>}
      </p>
      {report && report.total.n > 0 ? (
        <>
          <table>
            <thead>
              <tr><th scope="col">Chord type</th><th scope="col">Played</th><th scope="col">Notes right</th><th scope="col">Bass right</th></tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.type}><td>{r.type}</td><td>{r.n}</td><td>{pct(r.notes, r.n)}</td><td>{pct(r.bass, r.n)}</td></tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th scope="row">All</th><td>{report.total.n}</td><td>{pct(report.total.notes, report.total.n)}</td><td>{pct(report.total.bass, report.total.n)}</td></tr>
            </tfoot>
          </table>
          <button type="button" className="listen__reset" onClick={download}>Download results</button>
        </>
      ) : (
        <p className="listen__muted">No chords scored yet.</p>
      )}
    </section>
  );
}
