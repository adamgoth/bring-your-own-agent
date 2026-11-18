import { useMemo, useRef } from 'react';
import { KEYBOARD_HIGH, KEYBOARD_LOW, midiOf, prettyNote } from '../theory';

const WHITE_W = 24;
const WHITE_H = 150;
const BLACK_W = 14;
const BLACK_H = 94;
const WHITE_STEPS = new Set([0, 2, 4, 5, 7, 9, 11]);
/** Nudges that place black keys the way a real keyboard does, in viewBox units. */
const BLACK_NUDGE: Record<number, number> = { 1: -2.5, 3: 2.5, 6: -3, 8: 0, 10: 3 };
const NATURAL_NAMES = ['C', '', 'D', '', 'E', 'F', '', 'G', '', 'A', '', 'B'];

type Key = { midi: number; black: boolean; x: number };

function layout(): { keys: Key[]; width: number } {
  const keys: Key[] = [];
  let whiteIndex = 0;
  for (let midi = KEYBOARD_LOW; midi <= KEYBOARD_HIGH; midi += 1) {
    const step = midi % 12;
    if (WHITE_STEPS.has(step)) {
      keys.push({ midi, black: false, x: whiteIndex * WHITE_W });
      whiteIndex += 1;
    } else {
      keys.push({ midi, black: true, x: whiteIndex * WHITE_W - BLACK_W / 2 + BLACK_NUDGE[step] });
    }
  }
  return { keys, width: whiteIndex * WHITE_W };
}

const { keys: KEYS, width: WIDTH } = layout();

type Props = {
  /** Notes with octaves, lowest first. */
  notes: string[];
  /** One finger number per note, or empty to hide them. */
  fingers: number[];
  sounding: string[];
  /** What the player is holding (from MIDI, taps or the mic), spelled, shown in the second colour. */
  held?: string[];
  /** Tapping keys: called with the MIDI note number. */
  onPress?: (midi: number) => void;
  onRelease?: (midi: number) => void;
  /** The estimated key while listening: pitch classes (0–11) of its scale, tonic first. */
  scale?: number[];
};

export function Keyboard({ notes, fingers, sounding, held = [], onPress, onRelease, scale }: Props) {
  const lit = useMemo(() => {
    const map = new Map<number, { name: string; finger?: number }>();
    notes.forEach((note, i) => map.set(midiOf(note), { name: note.replace(/-?\d+$/, ''), finger: fingers[i] }));
    return map;
  }, [notes, fingers]);
  const sound = useMemo(() => new Set(sounding.map(midiOf)), [sounding]);
  const heldMap = useMemo(() => new Map(held.map((n) => [midiOf(n), n.replace(/-?\d+$/, '')])), [held]);
  const pointers = useRef(new Map<number, number>());

  const keyAt = (event: React.PointerEvent): number | null => {
    const target = (event.target as Element).closest('[data-midi]');
    return target ? Number(target.getAttribute('data-midi')) : null;
  };
  const down = (event: React.PointerEvent<SVGSVGElement>) => {
    const midi = keyAt(event);
    if (midi === null || !onPress) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, midi);
    onPress(midi);
  };
  const up = (event: React.PointerEvent<SVGSVGElement>) => {
    const midi = pointers.current.get(event.pointerId);
    if (midi === undefined) return;
    pointers.current.delete(event.pointerId);
    onRelease?.(midi);
  };
  const label = notes.length ? `Keyboard with ${notes.map(prettyNote).join(', ')} highlighted` : 'Keyboard, no keys highlighted';

  const renderKey = (key: Key) => {
    const on = lit.get(key.midi);
    const heldName = heldMap.get(key.midi);
    const w = key.black ? BLACK_W : WHITE_W;
    const h = key.black ? BLACK_H : WHITE_H;
    const cx = key.x + w / 2;
    const classes = ['key', key.black ? 'key--black' : 'key--white', on ? 'is-lit' : '', heldName !== undefined ? 'is-held' : '', on && sound.has(key.midi) ? 'is-sounding' : '']
      .filter(Boolean)
      .join(' ');
    const isC = key.midi % 12 === 0;
    return (
      <g key={key.midi} className={classes} data-midi={key.midi}>
        <rect x={key.x + (key.black ? 0 : 0.5)} y={0} width={key.black ? w : w - 1} height={h} rx={key.black ? 2 : 3} className="key__body" />
        {scale?.includes(key.midi % 12) && (
          <circle
            cx={cx}
            cy={h - (key.black ? 25 : 30)}
            r={key.midi % 12 === scale[0] ? (key.black ? 3.2 : 4) : key.black ? 2.2 : 2.8}
            className={`scale-dot${key.midi % 12 === scale[0] ? ' scale-dot--tonic' : ''}`}
          />
        )}
        {heldName !== undefined && on && (
          <rect x={key.x + (key.black ? 1.5 : 2)} y={h - (key.black ? 6 : 7)} width={key.black ? w - 3 : w - 5} height={key.black ? 4 : 5} rx={1.5} className="key__heard-bar" />
        )}
        {heldName !== undefined && !on ? (
          <text x={cx} y={h - (key.black ? 13 : 15)} textAnchor="middle" className="key__name key__name--heard">
            {prettyNote(heldName)}
          </text>
        ) : on ? (
          <>
            {on.finger !== undefined && (
              <g className="finger">
                <circle cx={cx} cy={h - (key.black ? 36 : 44)} r={key.black ? 6.4 : 8.6} />
                <text x={cx} y={h - (key.black ? 36 : 44)} dy="0.36em" textAnchor="middle">
                  {on.finger}
                </text>
              </g>
            )}
            <text x={cx} y={h - (key.black ? 13 : 15)} textAnchor="middle" className="key__name">
              {prettyNote(on.name)}
            </text>
          </>
        ) : (
          isC && (
            <text x={cx} y={h - 12} textAnchor="middle" className={`key__c${key.midi === 60 ? ' is-middle' : ''}`}>
              {NATURAL_NAMES[0]}
              {Math.floor(key.midi / 12) - 1}
            </text>
          )
        )}
      </g>
    );
  };

  return (
    <svg
      className={`keyboard${onPress ? ' is-playable' : ''}`}
      viewBox={`-1 -1 ${WIDTH + 2} ${WHITE_H + 2}`}
      role="img"
      aria-label={label}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
    >
      {KEYS.filter((k) => !k.black).map(renderKey)}
      {KEYS.filter((k) => k.black).map(renderKey)}
    </svg>
  );
}
