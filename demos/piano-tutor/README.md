# Piano Tutor — WebMCP voice demo

A piano-learning page you drive by voice through BYOA. Ask for a chord or a key and it shows how to play it on a three-octave keyboard, with spelled note names and suggested fingering. Switch to Listen and it names the chords and key you play on a MIDI keyboard (or, experimentally, through the microphone).

The app has no backend, no API key and no model calls of its own. It registers ten WebMCP tools and asks BYOA for its floating site voice; your configured BYOA agent does the talking.

## Run locally

Build the SDK packages first (from the repository root, `pnpm run setup` or `pnpm build`), then:

```sh
cd demos/piano-tutor
npm install
npm run dev
```

Open **http://localhost:5185/**. The server binds to loopback. Everything works by hand without the extension: type a chord (`Gmaj7`, `F#m7b5`, `C/E`), pick a key and mode, choose inversions, press Play, or tap the on-screen keys. Browsers block audio until the page has been clicked once.

## Use it with BYOA

1. Build BYOA and load the unpacked extension from `byoa-extension/dist` (see the [root README](../../README.md)). Configure an API agent in its Options.
2. Click **Connect Agent** in the header and approve `localhost:5185` in BYOA's window.
3. Once connected, BYOA shows its floating voice mic on the page, limited to this app's tools. The first time, finish **Voice setup** (microphone permission and on-device speech).
4. Click the page once so audio can play, then try:
   - “Show me G major seven.” → “First inversion.” → “Play it.”
   - “Show me the chords in B flat major.” → “Pick the five chord.”
   - “Play a one-five-six-four in C.”
5. **Listen mode with MIDI:** plug in a MIDI keyboard and say “Listen to me” (or press Listen). Chords count once they have sounded unchanged for 120 ms; the key estimate builds up over about 30 seconds of playing. Then ask “What was I just playing?” or “What key am I in?”. Showing a chord or key ends listen mode, but `get_listening_summary` still remembers what you played.

Speech is recognised on device by the extension; the transcript goes to your configured model provider along with the tool definitions and results, and API billing applies.

## Tools

Every tool returns a `summary` line the agent can read back; errors come back as `{ error }`.

| Tool | Input | Does |
| --- | --- | --- |
| `show_chord` | `symbol` (e.g. `Gmaj7`), optional `inversion` 0–3 | Shows a chord with notes and fingering. |
| `show_key` | `tonic`, `mode`, optional `sevenths` | Shows a key and its seven chords on the key strip. |
| `select_chord_in_key` | `degree` 1–7 | Selects a chord from the key on screen. |
| `set_inversion` | `inversion` 0–3 | Inverts the chord on screen. |
| `play` | none | Plays the chord on screen. |
| `play_progression` | `chords` (symbols, roman numerals or degrees), optional `tonic`, `mode`, `seconds_per_chord` | Plays a sequence, showing each chord as it sounds. |
| `get_state` | none | Reads the mode and what the screen shows. |
| `start_listening` | optional `microphone` | Listens to MIDI (or the microphone) plus the on-screen keys. |
| `stop_listening` | none | Stops listening. |
| `get_listening_summary` | none | Current and recent chords, held notes and the estimated key. |

## Layout

| Path | What |
| --- | --- |
| `src/theory/` | Pure music theory over [tonal](https://github.com/tonaljs/tonal): parsing, voicing, fingering, chords in a key, chord detection. |
| `src/state/store.ts` | The single zustand store. The UI and the WebMCP tools call the same actions. |
| `src/tools/` | Tool definitions (`registry.ts`, browser-free), WebMCP registration, and the BYOA site-voice opt-in. |
| `src/listen/` | Listening engine (held notes, sustain pedal, chord stability), key estimate, Web MIDI. |
| `src/mic/` | Experimental microphone chord detection (AudioWorklet, FFT, chroma matching). |
| `src/audio/` | Web Audio synth. |

## Checks

```sh
npm test
npm run build
```
