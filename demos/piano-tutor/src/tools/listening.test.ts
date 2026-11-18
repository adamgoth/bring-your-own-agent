import { createTutorStore, modeOf } from '../state/store';
import type { MidiAccessLike, MidiInputLike } from '../listen/midi';
import { createTools } from './registry';
import type { LiveKeys } from '../audio/audioEngine';

function setup({ midi = true }: { midi?: boolean } = {}) {
  let t = 0;
  const keys: string[] = [];
  const liveKeys: LiveKeys = {
    keyDown: (midi, velocity, sound) => keys.push(`down ${midi} ${velocity} ${sound}`),
    keyUp: (midi) => keys.push(`up ${midi}`),
    pedal: (down) => keys.push(down ? 'pedal down' : 'pedal up'),
    allUp: () => keys.push('all up'),
  };
  const input: MidiInputLike = { id: 'p', name: 'Stage Piano', state: 'connected', onmidimessage: null };
  const access: MidiAccessLike = { inputs: { forEach: (cb) => cb(input) }, onstatechange: null };
  const store = createTutorStore({
    player: async () => {},
    requestMidi: midi ? async () => access : async () => Promise.reject(new Error('MIDI permission was denied.')),
    now: () => t,
    every: () => () => {},
    liveKeys,
  });
  const tools = createTools(store, () => t);
  const run = async (name: string) => (await tools.find((x) => x.name === name)!.execute({})) as Record<string, any>;
  const send = (bytes: number[]) => input.onmidimessage!({ data: new Uint8Array(bytes) });
  const advance = (ms: number) => {
    t += ms;
    store.getState().tick();
  };
  return { store, run, send, advance, input, access, keys };
}

describe('listening tools', () => {
  it('start_listening connects MIDI and reports the device', async () => {
    const { run } = setup();
    const result = await run('start_listening');
    expect(result).toMatchObject({ listening: true, midi: { status: 'connected', devices: ['Stage Piano'] } });
    expect(result.summary).toMatch(/MIDI: Stage Piano/);
  });

  it('still listens to the on-screen keys when MIDI is refused', async () => {
    const { run, store, advance } = setup({ midi: false });
    const result = await run('start_listening');
    expect(result).toMatchObject({ listening: true, midi: { status: 'unavailable', message: 'MIDI permission was denied.' } });
    [57, 60, 64].forEach((note) => store.getState().input({ type: 'on', note }, 'screen'));
    advance(200);
    expect(await run('get_listening_summary')).toMatchObject({ playing: { symbol: 'Am', notes: ['A3', 'C4', 'E4'] } });
    expect(store.getState().heard.lastSource).toBe('screen');
  });

  it('get_listening_summary reports chord, history and key from MIDI', async () => {
    const { run, send, advance } = setup();
    await run('start_listening');
    const play = (notes: number[]) => {
      notes.forEach((n) => send([0x90, n, 80]));
      for (let i = 0; i < 10; i += 1) advance(100);
      notes.forEach((n) => send([0x80, n, 0]));
      advance(20);
    };
    for (let r = 0; r < 3; r += 1) [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]].forEach(play);
    [57, 60, 64, 67].forEach((n) => send([0x90, n, 80]));
    advance(300);
    const summary = await run('get_listening_summary');
    expect(summary.playing).toMatchObject({ symbol: 'Am7' });
    expect(summary.recent.at(-1)).toMatchObject({ symbol: 'Am7', secondsAgo: 0 });
    expect(summary.recent.map((c: { symbol: string }) => c.symbol).slice(0, 4)).toEqual(['C', 'F', 'G', 'C']);
    expect(summary.key).toMatchObject({ name: 'C major' });
    expect(summary.summary).toMatch(/Playing Am7 .* Recent chords: .* Key/);
  });

  it('sounds MIDI keys while held, with the pedal, and can be turned off', async () => {
    const { run, send, store, keys } = setup();
    await run('start_listening');
    send([0x90, 60, 100]);
    send([0xb0, 64, 127]);
    send([0x80, 60, 0]);
    send([0xb0, 64, 0]);
    expect(keys).toEqual(['down 60 100 piano', 'pedal down', 'up 60', 'pedal up']);
    keys.length = 0;
    store.getState().setMidiSound(false);
    send([0x90, 62, 90]);
    send([0x90, 62, 0]);
    // Silenced keys still reach listening, and their key-ups are harmless.
    expect(keys).toEqual(['all up', 'up 62']);
  });

  it('releases held notes when the keyboard is unplugged', async () => {
    const { run, send, store, input, access, advance, keys } = setup();
    await run('start_listening');
    [60, 64, 67].forEach((n) => send([0x90, n, 80]));
    advance(200);
    expect(store.getState().heard.sounding).toHaveLength(3);
    input.state = 'disconnected';
    access.onstatechange!({});
    expect(keys).toContain('all up');
    expect(store.getState().heard).toMatchObject({ sounding: [], chord: null, midi: { status: 'no-devices', devices: [] } });
  });

  it('stop_listening keeps history and ignores later input', async () => {
    const { run, store, advance } = setup();
    await run('start_listening');
    [60, 64, 67].forEach((note) => store.getState().input({ type: 'on', note }, 'screen'));
    advance(200);
    const stopped = await run('stop_listening');
    expect(stopped).toMatchObject({ listening: false, playing: null, recent: [{ symbol: 'C' }] });
    store.getState().input({ type: 'on', note: 62 }, 'screen');
    expect(store.getState().heard.sounding).toEqual([]);
  });

  it('follows the played chord, leaving key mode for chord mode', async () => {
    const { run, store, send, advance } = setup();
    store.getState().showKey('C', 'major');
    await run('start_listening');
    [55, 59, 62].forEach((n) => send([0x90, n, 80]));
    advance(300);
    const view = store.getState().view;
    expect(view.kind).toBe('chord');
    expect(view.kind === 'chord' && view.chord.symbol).toBe('G');
    [55, 59, 62].forEach((n) => send([0x80, n, 0]));
    advance(50);
    [52, 55, 59].forEach((n) => send([0x90, n, 80]));
    advance(300);
    const next = store.getState().view;
    expect(next.kind === 'chord' && next.chord.symbol).toBe('Em');
  });

  it('only follows while listening, and not a chord from before it started', async () => {
    const { run, store, send, advance } = setup();
    await run('start_listening');
    [55, 59, 62].forEach((n) => send([0x90, n, 80]));
    advance(300);
    [55, 59, 62].forEach((n) => send([0x80, n, 0]));
    await run('stop_listening');
    store.getState().showKey('A', 'minor');
    await run('start_listening');
    advance(300);
    expect(store.getState().view.kind).toBe('key');
    await run('stop_listening');
    store.getState().input({ type: 'on', note: 60 }, 'screen');
    advance(300);
    expect(store.getState().view.kind).toBe('key');
  });

  describe('modes', () => {
    const progression = async (send: (b: number[]) => void, advance: (ms: number) => void) => {
      const play = (notes: number[]) => {
        notes.forEach((n) => send([0x90, n, 80]));
        for (let i = 0; i < 10; i += 1) advance(100);
        notes.forEach((n) => send([0x80, n, 0]));
        advance(20);
      };
      for (let r = 0; r < 3; r += 1) [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]].forEach(play);
    };
    const toolsFor = (store: Parameters<typeof createTools>[0]) => createTools(store, () => 0);
    const call = async (store: Parameters<typeof createTools>[0], name: string, args: Record<string, unknown> = {}) =>
      (await toolsFor(store).find((x) => x.name === name)!.execute(args)) as Record<string, any>;

    it('showing a key while listening leaves listen mode and stays put while you keep playing', async () => {
      const { run, store, send, advance } = setup();
      await run('start_listening');
      await progression(send, advance);
      expect(modeOf(store.getState())).toBe('listen');
      const shown = await call(store, 'show_key', { tonic: 'C', mode: 'major' });
      expect(shown.stoppedListening).toBe(true);
      expect(modeOf(store.getState())).toBe('key');
      expect(store.getState().heard.listening).toBe(false);
      // MIDI is disconnected now; playing more on the screen keys no longer changes the screen.
      expect(store.getState().heard.midi.status).toBe('off');
      [55, 59, 62].forEach((note) => store.getState().input({ type: 'on', note }, 'screen'));
      advance(400);
      expect(store.getState().view.kind).toBe('key');
      // What was played is still there for "what key were those in?".
      expect(await run('get_listening_summary')).toMatchObject({ key: { name: 'C major' } });
      expect(await call(store, 'get_state')).toMatchObject({ appMode: 'key', view: 'key', mode: 'major' });
    });

    it('selecting a chord or changing the inversion also ends listening', async () => {
      const { run, store } = setup();
      store.getState().showKey('G', 'major');
      await run('start_listening');
      store.getState().selectDegree(3);
      expect(modeOf(store.getState())).toBe('key');
      await run('start_listening');
      store.getState().setInversion(1);
      expect(store.getState().heard.listening).toBe(false);
    });

    it('a chord that cannot be shown does not end listening', async () => {
      const { run, store } = setup();
      await run('start_listening');
      expect(() => store.getState().showChord('not a chord')).toThrow();
      expect(store.getState().heard.listening).toBe(true);
    });

    it('the Key tab opens the key just heard; the Chord tab returns to the last chord heard', async () => {
      const { run, store, send, advance } = setup();
      store.getState().showKey('E', 'minor');
      await run('start_listening');
      await progression(send, advance);
      const key = store.getState().enterMode('key');
      expect(key).toMatchObject({ kind: 'key', tonic: 'C', mode: 'major' });
      expect(store.getState().heard.listening).toBe(false);
      await run('start_listening');
      [57, 60, 64].forEach((n) => send([0x90, n, 80]));
      advance(300);
      const chord = store.getState().enterMode('chord');
      expect(chord.kind === 'chord' && chord.chord.symbol).toBe('Am');
      expect(modeOf(store.getState())).toBe('chord');
    });

    it('switching between chord and key returns to the last of each', () => {
      const { store } = setup();
      store.getState().showChord('Gmaj7');
      store.getState().showKey('D', 'minor', { sevenths: true });
      const chord = store.getState().enterMode('chord');
      expect(chord.kind === 'chord' && chord.chord.symbol).toBe('Gmaj7');
      const key = store.getState().enterMode('key');
      expect(key).toMatchObject({ kind: 'key', tonic: 'D', mode: 'minor', sevenths: true });
    });

    it('the Key tab with nothing chosen or heard opens C major; the Chord tab with nothing shows the empty state', () => {
      const { store } = setup();
      expect(store.getState().enterMode('chord')).toEqual({ kind: 'empty' });
      expect(store.getState().enterMode('key')).toMatchObject({ kind: 'key', tonic: 'C', mode: 'major' });
    });
  });
});
