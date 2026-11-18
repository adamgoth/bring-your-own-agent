import { describeView, useTutor } from '../state/store';

/** Polite screen-reader announcement of the chord or key on screen. */
export function LiveLine() {
  const view = useTutor((s) => s.view);
  return (
    <p className="visually-hidden" aria-live="polite" aria-atomic="true">
      {view.kind === 'empty' ? '' : describeView(view)}
    </p>
  );
}
