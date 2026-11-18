import { prettyNote, prettySymbol } from '../theory';
import type { HeardState } from '../state/store';
import { keyName } from './keyEstimate';

const MIDI_LINE: Record<HeardState['midi']['status'], (h: HeardState) => string> = {
  off: () => 'MIDI is off.',
  connecting: () => 'Connecting to MIDI.',
  connected: (h) => `MIDI: ${h.midi.devices.join(', ')}.`,
  'no-devices': () => 'No MIDI keyboard is connected; the on-screen keys still work.',
  unavailable: (h) => `MIDI unavailable (${h.midi.message ?? 'no permission or no Web MIDI'}); the on-screen keys still work.`,
};

/** Plain-text summary of what the app has heard, for the agent and screen readers. */
export function describeHeard(h: HeardState, nowMs: number): string {
  const parts: string[] = [];
  parts.push(h.listening ? `Listening. ${MIDI_LINE[h.midi.status](h)}` : 'Not listening.');
  if (h.mic.status === 'on') {
    parts.push(
      h.mic.mode === 'compare'
        ? `Microphone (${h.mic.label ?? 'mic'}) is being compared against MIDI${h.mic.compare?.total.n ? `: right on ${h.mic.compare.total.notes} of ${h.mic.compare.total.n} chords so far` : ''}.`
        : `Microphone (${h.mic.label ?? 'mic'}) is on, experimental.`,
    );
  } else if (h.mic.status === 'error') {
    parts.push(`Microphone failed: ${h.mic.message ?? 'unknown error'}.`);
  }
  if (h.chord) parts.push(`Playing ${prettySymbol(h.chord.symbol)} (${h.sounding.map(prettyNote).join(' ')}).`);
  else if (h.sounding.length) parts.push(`Holding ${h.sounding.map(prettyNote).join(' ')}, not a chord I can name.`);
  if (h.history.length) parts.push(`Recent chords: ${h.history.slice(-8).map((c) => prettySymbol(c.symbol)).join(', ')}.`);
  if (h.key) {
    const sure = h.key.confidence >= 0.6 ? 'Key' : h.key.confidence >= 0.3 ? 'Key, probably' : 'Key, unsure';
    parts.push(`${sure}: ${prettyKey(keyName(h.key))} (confidence ${h.key.confidence.toFixed(2)}; next best ${prettyKey(keyName(h.key.runnerUp))}).`);
  } else if (h.history.length || h.sounding.length) {
    parts.push('Not enough playing yet to guess the key.');
  }
  void nowMs;
  return parts.join(' ');
}

const prettyKey = (name: string) => name.replace(/^([A-G])(#|b)?/, (_, l: string, a = '') => prettyNote(l + a));

export function serialiseHeard(h: HeardState, nowMs: number) {
  return {
    listening: h.listening,
    midi: h.midi,
    microphone: { status: h.mic.status, label: h.mic.label ?? null, mode: h.mic.mode, lastChord: h.mic.lastChord, comparison: h.mic.compare, message: h.mic.message ?? null },
    playing: h.chord ? { symbol: h.chord.symbol, alternatives: h.chord.candidates.slice(1, 4), notes: h.sounding } : null,
    holding: h.sounding,
    recent: h.history.map((c) => ({ symbol: c.symbol, secondsAgo: Math.max(0, Math.round((nowMs - c.at) / 1000)) })),
    key: h.key
      ? { name: keyName(h.key), tonic: h.key.tonic, mode: h.key.mode, confidence: h.key.confidence, nextBest: keyName(h.key.runnerUp) }
      : null,
    summary: describeHeard(h, nowMs),
  };
}
