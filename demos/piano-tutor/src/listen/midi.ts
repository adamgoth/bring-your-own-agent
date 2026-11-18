export type MidiEvent =
  | { type: 'noteon'; note: number; velocity: number }
  | { type: 'noteoff'; note: number }
  | { type: 'cc'; controller: number; value: number };

/** Parse one MIDI message. Note-on with velocity 0 is a note-off. Other messages are ignored. */
export function parseMidiMessage(data: ArrayLike<number>): MidiEvent | null {
  if (!data || data.length < 3) return null;
  const status = data[0] & 0xf0;
  if (status === 0x90 && data[2] > 0) return { type: 'noteon', note: data[1], velocity: data[2] };
  if (status === 0x80 || status === 0x90) return { type: 'noteoff', note: data[1] };
  if (status === 0xb0) return { type: 'cc', controller: data[1], value: data[2] };
  return null;
}

export const SUSTAIN_CC = 64;

// Minimal shapes of the Web MIDI objects this app uses, so tests can fake them.
export type MidiInputLike = { id: string; name?: string | null; state?: string; onmidimessage: ((e: { data: Uint8Array | null }) => void) | null };
export type MidiAccessLike = {
  inputs: { forEach(cb: (input: MidiInputLike) => void): void };
  onstatechange: ((e: unknown) => void) | null;
};
export type RequestMidi = () => Promise<MidiAccessLike>;

/** The browser's Web MIDI, looked up when called so it can be absent or replaced. */
export const browserMidi: RequestMidi = () => {
  const request = (navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccessLike> }).requestMIDIAccess;
  if (!request) return Promise.reject(new Error('This browser has no Web MIDI. Use Chrome or Edge, or tap the on-screen keys.'));
  return request.call(navigator);
};

/** Listen to every connected input, including ones plugged in later. Returns a disconnect function. */
export function connectMidi(
  access: MidiAccessLike,
  onEvent: (event: MidiEvent, inputName: string) => void,
  onDevices: (names: string[]) => void,
): () => void {
  const attached = new Map<string, MidiInputLike>();
  const scan = () => {
    const names: string[] = [];
    access.inputs.forEach((input) => {
      if (input.state === 'disconnected') {
        input.onmidimessage = null;
        attached.delete(input.id);
        return;
      }
      names.push(input.name || 'MIDI input');
      if (!attached.has(input.id)) {
        attached.set(input.id, input);
        input.onmidimessage = (e) => {
          const event = e.data ? parseMidiMessage(e.data) : null;
          if (event) onEvent(event, input.name || 'MIDI input');
        };
      }
    });
    onDevices(names);
  };
  scan();
  access.onstatechange = scan;
  return () => {
    access.onstatechange = null;
    attached.forEach((input) => (input.onmidimessage = null));
    attached.clear();
  };
}
