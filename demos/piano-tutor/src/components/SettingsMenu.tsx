import { useEffect, useId, useRef, useState } from 'react';
import { SOUND_LABELS } from '../audio/audioEngine';
import { tutorStore, useTutor } from '../state/store';

/** Gear button with a small, non-modal settings panel: sound, taps and microphone. */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const panelId = `${id}-panel`;
  const headingId = `${id}-heading`;

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('select, input, button')?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      gear.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (wrap.current?.contains(event.target as Node)) return;
      setOpen(false);
      // A click on blank space would drop focus to the page; give it back to the gear instead.
      setTimeout(() => {
        if (document.activeElement === document.body || document.activeElement === null) gear.current?.focus({ preventScroll: true });
      });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div
      className="settings"
      ref={wrap}
      onBlur={(event) => {
        // Tabbing out of the panel closes it; a blur to nowhere (window switch, blank click) does not.
        const next = event.relatedTarget as Node | null;
        if (open && next && !wrap.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={gear}
        className="settings__gear"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <mask id={`${id}-gear-hole`}>
            <rect width="20" height="20" fill="#fff" />
            <circle cx="10" cy="10" r="2.4" fill="#000" />
          </mask>
          <g mask={`url(#${id}-gear-hole)`}>
            <circle cx="10" cy="10" r="5.9" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
              <rect key={deg} x="8.5" y="1.6" width="3" height="3.6" rx="0.8" transform={`rotate(${deg} 10 10)`} />
            ))}
          </g>
        </svg>
      </button>
      {open && (
        <div className="settings__panel" id={panelId} ref={panel} role="dialog" aria-labelledby={headingId}>
          <h2 id={headingId} className="settings__heading">Settings</h2>
          <SettingsFields />
        </div>
      )}
    </div>
  );
}

function SettingsFields() {
  const sound = useTutor((s) => s.sound);
  const latch = useTutor((s) => s.latchTaps);
  const midiSound = useTutor((s) => s.midiSound);
  const mic = useTutor((s) => s.heard.mic);
  const id = useId();

  return (
    <>
      <div className="settings__group">
        <label className="settings__field" htmlFor={`${id}-sound`}>
          Sound
        </label>
        <select id={`${id}-sound`} value={sound} onChange={(e) => tutorStore.getState().setSound(e.target.value)}>
          {Object.entries(SOUND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="settings__check">
          <input type="checkbox" checked={latch} onChange={(e) => tutorStore.getState().setLatchTaps(e.target.checked)} />
          Keep tapped keys down
        </label>
        <label className="settings__check" title="Turn off if your keyboard has its own speakers.">
          <input type="checkbox" checked={midiSound} onChange={(e) => tutorStore.getState().setMidiSound(e.target.checked)} />
          Play MIDI keys through the app
        </label>
        {mic.status === 'on' && mic.devices.length > 1 && (
          <>
            <label className="settings__field" htmlFor={`${id}-mic`}>
              Microphone
            </label>
            <select id={`${id}-mic`} value={mic.deviceId} onChange={(e) => void tutorStore.getState().startMic(e.target.value)}>
              {mic.devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
            </select>
          </>
        )}
      </div>
    </>
  );
}
