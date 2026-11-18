import { ChordPanel } from './components/ChordPanel';
import { Controls } from './components/Controls';
import { Header } from './components/Header';
import { Keyboard } from './components/Keyboard';
import { KeyStrip, ListenKeyStrip } from './components/KeyStrip';
import { LiveLine } from './components/LiveLine';
import { ListenDetails, ListenPanel } from './components/ListenBar';
import { ModeTabs } from './components/ModeTabs';
import { playChordFunction } from './audio/audioEngine';
import { tutorStore } from './state/store';
import { Note } from 'tonal';
import { keyScale } from './listen/keyScale';
import { modeOf, useTutor } from './state/store';
import { appTools } from './tools/tools';
import { useWebMcpTools } from './tools/useWebMcpTools';
import { useSiteVoice } from './tools/useSiteVoice';

const toolNames = appTools.map((tool) => tool.name);

export function App() {
  const registered = useWebMcpTools(appTools);
  useSiteVoice(toolNames, registered);
  const view = useTutor((s) => s.view);
  const hand = useTutor((s) => s.hand);
  const sounding = useTutor((s) => s.sounding);
  const held = useTutor((s) => s.heard.sounding);
  const scale = useTutor((s) => keyScale(s.heard));
  const mode = useTutor(modeOf);
  // Listen mode shows only what you play (and the key's scale); chord and key modes show the chosen voicing.
  const listening = mode === 'listen';
  const notes = listening || view.kind === 'empty' ? [] : view.voicing.notes;
  const fingers = listening || view.kind === 'empty' ? [] : view.fingering[hand];

  return (
    <div className="app">
      <Header />
      <main className="stage">
        <div className={`stage__top stage__top--${mode}`}>
          {listening ? <ListenPanel /> : <ChordPanel />}
          <div className="stage__side">
            <ModeTabs />
            <Controls />
          </div>
        </div>
        <div className="keyboard-wrap">
          <Keyboard notes={notes} fingers={fingers} sounding={sounding} held={held} onPress={pressKey} onRelease={releaseKey} scale={scale} />
        </div>
        {mode === 'key' && <KeyStrip />}
        {listening && <ListenKeyStrip />}
        <ListenDetails />
      </main>
      <LiveLine />
    </div>
  );
}

// Tapping a key sounds it and, while listening, feeds the same pipeline as MIDI.
function pressKey(midi: number) {
  const state = tutorStore.getState();
  if (state.latchTaps && state.heard.soundingMidi.includes(midi)) {
    state.input({ type: 'off', note: midi }, 'screen');
    return;
  }
  void playChordFunction([Note.fromMidi(midi)], state.sound).catch(() => {});
  state.input({ type: 'on', note: midi }, 'screen');
}

function releaseKey(midi: number) {
  const state = tutorStore.getState();
  if (!state.latchTaps) state.input({ type: 'off', note: midi }, 'screen');
}
