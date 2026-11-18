import { createTutorStore } from '../state/store';
import { AUDIO_BLOCKED_MESSAGE } from '../audio/audioEngine';
import { createTools, type Tool } from './registry';
import { registerTools } from './useWebMcpTools';

type Result = Record<string, any>;

function setup(player: (notes: string[], sound: string) => Promise<void> = async () => {}) {
  const store = createTutorStore(player);
  const tools = createTools(store);
  const run = async (name: string, input: Record<string, unknown> = {}) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    return (await tool.execute(input)) as Result;
  };
  return { store, tools, run };
}

describe('tool registry', () => {
  it('defines the tools with object schemas and descriptions', () => {
    const { tools } = setup();
    expect(tools.map((t) => t.name)).toEqual(['show_chord', 'show_key', 'select_chord_in_key', 'set_inversion', 'play', 'play_progression', 'get_state', 'start_listening', 'stop_listening', 'get_listening_summary']);
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(tool.description.length).toBeGreaterThan(80);
    }
  });

  it('show_chord shows the chord and returns notes and fingering', async () => {
    const { run, store } = setup();
    const result = await run('show_chord', { symbol: 'Gmaj7' });
    expect(result).toMatchObject({
      symbol: 'Gmaj7',
      name: 'G major seventh',
      inversionName: 'root position',
      notes: ['G3', 'B3', 'D4', 'F#4'],
      fingering: { right: '1-2-3-5', left: '5-3-2-1' },
    });
    expect(result.summary).toContain('G major seventh');
    expect(store.getState().view.kind).toBe('chord');
  });

  it('show_chord takes an inversion', async () => {
    const { run } = setup();
    const result = await run('show_chord', { symbol: 'C', inversion: 2 });
    expect(result).toMatchObject({ symbol: 'C/G', notes: ['G3', 'C4', 'E4'], inversionName: 'second inversion' });
  });

  it('show_key returns the seven chords with numerals and notes', async () => {
    const { run, store } = setup();
    const result = await run('show_key', { tonic: 'A', mode: 'major' });
    expect(result.key).toBe('A major');
    expect(result.chords.map((c: Result) => `${c.numeral} ${c.symbol}`)).toEqual([
      'I A', 'ii Bm', 'iii C#m', 'IV D', 'V E', 'vi F#m', 'vii° G#dim',
    ]);
    expect(result.chords[1].notes).toEqual(['B', 'D', 'F#']);
    expect(result.selected).toMatchObject({ degree: 1, symbol: 'A', notes: ['A3', 'C#4', 'E4'] });
    expect(store.getState().view.kind).toBe('key');
  });

  it('show_key handles sevenths and flat keys', async () => {
    const { run } = setup();
    const result = await run('show_key', { tonic: 'Bb', mode: 'major', sevenths: true });
    expect(result.chords.map((c: Result) => c.symbol)).toEqual(['Bbmaj7', 'Cm7', 'Dm7', 'Ebmaj7', 'F7', 'Gm7', 'Am7b5']);
  });

  it('select_chord_in_key moves the keyboard to that degree', async () => {
    const { run } = setup();
    await run('show_key', { tonic: 'C', mode: 'major' });
    expect(await run('select_chord_in_key', { degree: 5 })).toMatchObject({ degree: 5, numeral: 'V', symbol: 'G', notes: ['G3', 'B3', 'D4'] });
  });

  it('set_inversion inverts the chord on screen in both views', async () => {
    const { run, store } = setup();
    await run('show_chord', { symbol: 'Gmaj7' });
    expect(await run('set_inversion', { inversion: 1 })).toMatchObject({ symbol: 'Gmaj7/B', notes: ['B3', 'D4', 'F#4', 'G4'] });
    await run('show_key', { tonic: 'A', mode: 'major' });
    expect(await run('set_inversion', { inversion: 1 })).toMatchObject({ symbol: 'A/C#' });
    expect(store.getState().view.kind).toBe('key');
  });

  it('play reports what it played', async () => {
    const played: string[][] = [];
    const { run } = setup(async (notes) => {
      played.push(notes);
    });
    await run('show_chord', { symbol: 'Bm' });
    expect(await run('play')).toMatchObject({ played: 'Bm', notes: ['B3', 'D4', 'F#4'], sound: 'piano' });
    expect(played).toEqual([['B3', 'D4', 'F#4']]);
  });

  it('play explains blocked audio', async () => {
    const { run } = setup(async () => {
      throw new Error(AUDIO_BLOCKED_MESSAGE);
    });
    await run('show_chord', { symbol: 'C' });
    expect(await run('play')).toEqual({ error: AUDIO_BLOCKED_MESSAGE });
  });

  it('get_state serialises each view', async () => {
    const { run } = setup();
    expect(await run('get_state')).toMatchObject({ view: 'empty' });
    await run('show_chord', { symbol: 'F#m7b5' });
    expect(await run('get_state')).toMatchObject({ view: 'chord', symbol: 'F#m7b5', notes: ['F#3', 'A3', 'C4', 'E4'] });
    await run('show_key', { tonic: 'B', mode: 'minor' });
    const key = await run('get_state');
    expect(key).toMatchObject({ view: 'key', key: 'B natural minor', selected: { symbol: 'Bm' } });
    expect(JSON.parse(JSON.stringify(key))).toEqual(key);
  });

  it.each([
    ['show_chord', { symbol: 'xyz' }, /not a chord symbol/],
    ['show_chord', {}, /No chord symbol/],
    ['show_chord', { symbol: 'C', inversion: 3 }, /0 \(root position\) to 2/],
    ['show_chord', { symbol: 'C', inversion: 'first' }, /whole number/],
    ['show_key', { tonic: 'H', mode: 'major' }, /not a key name/],
    ['show_key', { tonic: 'C', mode: 'blues' }, /not a mode I know/],
    ['select_chord_in_key', { degree: 3 }, /No key is shown/],
    ['set_inversion', { inversion: 1 }, /No chord is shown/],
    ['play', {}, /Nothing to play/],
  ])('%s returns an error for %j', async (name, input, message) => {
    const { run } = setup();
    const result = await run(name, input);
    expect(result.error).toMatch(message);
  });

  it('select_chord_in_key rejects degrees outside 1–7', async () => {
    const { run } = setup();
    await run('show_key', { tonic: 'C', mode: 'major' });
    expect((await run('select_chord_in_key', { degree: 8 })).error).toMatch(/1 to 7/);
    expect((await run('select_chord_in_key', { degree: 0 })).error).toMatch(/1 to 7/);
  });

  it('follows the run-one conversation', async () => {
    const { run, store } = setup();
    // "show me all the chords in A major"
    await run('show_key', { tonic: 'A', mode: 'major' });
    // "show me B minor"
    expect((await run('show_key', { tonic: 'B', mode: 'minor' })).chords[0].symbol).toBe('Bm');
    // "show me how to play G major 7"
    await run('show_chord', { symbol: 'Gmaj7' });
    // "first inversion"
    await run('set_inversion', { inversion: 1 });
    // "play it"
    expect(await run('play')).toMatchObject({ played: 'Gmaj7/B', notes: ['B3', 'D4', 'F#4', 'G4'] });
    expect(store.getState().view).toMatchObject({ kind: 'chord', voicing: { inversion: 1 } });
  });
});

describe('registerTools', () => {
  function fakeContext() {
    const registered = new Map<string, Tool>();
    return {
      registered,
      context: {
        registerTool(tool: Tool, { signal }: { signal: AbortSignal }) {
          registered.set(tool.name, tool);
          signal.addEventListener('abort', () => registered.delete(tool.name));
        },
      },
    };
  }

  it('registers every tool and removes them on abort', async () => {
    const { tools } = setup();
    const { registered, context } = fakeContext();
    const controller = new AbortController();
    expect(await registerTools(context, () => tools, controller)).toBe(true);
    expect([...registered.keys()]).toEqual(tools.map((t) => t.name));
    expect(await registered.get('show_chord')!.execute({ symbol: 'Bm' })).toMatchObject({ symbol: 'Bm' });
    controller.abort();
    expect(registered.size).toBe(0);
  });

  it('runs the latest tool list and turns throws into { error }', async () => {
    const { registered, context } = fakeContext();
    let tools: Tool[] = [
      { name: 'x', description: 'x', inputSchema: { type: 'object' }, execute: async () => 'old' },
    ];
    await registerTools(context, () => tools, new AbortController());
    tools = [{ name: 'x', description: 'x', inputSchema: { type: 'object' }, execute: async () => { throw new Error('boom'); } }];
    expect(await registered.get('x')!.execute({})).toEqual({ error: 'boom' });
  });

  it('stops and warns if registration fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tools } = setup();
    const controller = new AbortController();
    expect(await registerTools({ registerTool: () => Promise.reject(new Error('nope')) }, () => tools, controller)).toBe(false);
    expect(controller.signal.aborted).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('play_progression', () => {
  function progression() {
    const plays: Array<{ notes: string[]; hold?: number; view: string }> = [];
    const waits: number[] = [];
    let onWait: (() => void) | undefined;
    const store = createTutorStore({
      player: async (notes, _sound, opts) => {
        const v = store.getState().view;
        plays.push({ notes, hold: opts?.hold, view: v.kind === 'key' ? `key ${v.selectedIndex + 1}` : v.kind });
      },
      sleep: async (ms) => {
        waits.push(ms);
        onWait?.();
      },
    });
    const tools = createTools(store);
    const run = async (input: Record<string, unknown>) => (await tools.find((t) => t.name === 'play_progression')!.execute(input)) as Result;
    return { store, run, plays, waits, setOnWait: (fn: () => void) => (onWait = fn) };
  }

  it('shows the key and plays each chord on the strip, in one call', async () => {
    const { run, plays, waits, store } = progression();
    const result = await run({ tonic: 'C', chords: ['C', 'G', 'Am', 'F'] });
    expect(result).toMatchObject({ played: ['C', 'G', 'Am', 'F'], key: 'C major', summary: 'Played C – G – Am – F.' });
    expect(plays.map((p) => p.view)).toEqual(['key 1', 'key 5', 'key 6', 'key 4']);
    expect(plays.map((p) => p.notes[0])).toEqual(['C4', 'G3', 'A3', 'F3']);
    // Each chord is damped as the next starts; the last rings on.
    expect(plays.map((p) => p.hold)).toEqual([1.6, 1.6, 1.6, 2.5]);
    expect(waits).toEqual([1600, 1600, 1600, 1200]);
    expect(store.getState().view).toMatchObject({ kind: 'key', selectedIndex: 3 });
  });

  it('takes numerals and degrees of the key on screen, and a pace', async () => {
    const { run, plays, store } = progression();
    store.getState().showKey('G', 'major');
    expect(await run({ chords: ['I', 'V', 'vi', 'IV'], seconds_per_chord: 1 })).toMatchObject({ played: ['G', 'D', 'Em', 'C'] });
    expect(await run({ chords: ['2', 5, '1'] })).toMatchObject({ played: ['Am', 'D', 'G'] });
    expect(plays[0].hold).toBe(1);
  });

  it('plays chords outside a key in chord mode', async () => {
    const { run, store } = progression();
    expect(await run({ chords: ['Dm7', 'G7', 'Cmaj7'] })).toMatchObject({ played: ['Dm7', 'G7', 'Cmaj7'] });
    expect(store.getState().view.kind).toBe('chord');
  });

  it('checks every chord before playing any', async () => {
    const { run, plays } = progression();
    expect(await run({ chords: ['C', 'Q#'] })).toHaveProperty('error');
    expect(await run({ chords: ['1', '4'] })).toEqual({ error: expect.stringMatching(/no key is shown/) });
    expect(await run({ chords: [] })).toHaveProperty('error');
    expect(plays).toHaveLength(0);
  });

  it('stops when something else changes the screen', async () => {
    const { run, store, setOnWait } = progression();
    setOnWait(() => {
      const v = store.getState().view;
      if (v.kind === 'key' && v.selectedIndex === 4) store.getState().showChord('E');
    });
    expect(await run({ tonic: 'C', chords: ['C', 'G', 'Am', 'F'] })).toMatchObject({ played: ['C', 'G'], interrupted: true });
    expect(store.getState().view).toMatchObject({ kind: 'chord', chord: { symbol: 'E' } });
  });
});
