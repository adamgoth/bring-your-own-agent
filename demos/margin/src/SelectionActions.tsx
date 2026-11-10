import { Send, Sparkles } from 'lucide-react';
import { agentboard, requestAgent, cancelAgent, useAgentBoardConnection, useAgentBoardTask } from './agentboard';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { Action, Workspace } from './engine';

const actions = {
  rewrite: { label: 'Improve this', placeholder: 'Any specific direction?', submit: 'Suggest edit', working: 'Improving…', task: 'Improve the passage for clarity and flow while preserving its meaning and voice. Suggest the complete replacement with propose_replacement and leave it for human review.' },
  comment: { label: 'Comment', placeholder: 'What should I focus on?', submit: 'Add comment', working: 'Commenting…', task: 'Add a helpful editorial comment with add_comment using kind "comment". Do not rewrite the passage.' },
  explain: { label: 'Explain', placeholder: 'What would you like explained?', submit: 'Explain passage', working: 'Explaining…', task: 'Explain the passage clearly with add_comment using kind "explain". Do not rewrite it.' },
};
const presets = {
  Clearer: 'Make the passage clearer and easier to follow.',
  Shorter: 'Make the passage more concise without losing important meaning.',
  'More natural': 'Make the passage sound more natural and conversational.',
  'More professional': 'Use a polished, professional tone without adding jargon.',
};
type Preset = keyof typeof presets;

function Composer({ workspace, anchorId, onComplete }: { workspace: Workspace; anchorId: string; onComplete: () => void }) {
  const connection = useAgentBoardConnection();
  const task = useAgentBoardTask();
  const [action, setAction] = useState<Action>();
  const [preset, setPreset] = useState<Preset>();
  const [error, setError] = useState('');
  const [instruction, setInstruction] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (action) input.current?.focus({ preventScroll: true }); }, [action]);
  const send = async () => {
    if (!action || task?.busy) return;
    setError('');
    try {
      const direction = [action === 'rewrite' && preset ? presets[preset] : '', instruction.trim()].filter(Boolean).join('\n');
      const prompt = [actions[action].task,
        'Use this captured selection ID for the tool call: ' + anchorId,
        direction && 'My instruction: ' + direction,
        'Selected passage (quoted context):\n' + JSON.stringify(workspace.requireAnchor(anchorId).text),
      ].filter(Boolean).join('\n\n');
      workspace.action = action;
      workspace.instruction = direction;
      const existing = new Set(workspace.notes.map(note => note.id));
      setSubmitted(true);
      await requestAgent(prompt);
      if (workspace.notes.some(note => !existing.has(note.id) && note.anchorId === anchorId && note.status === 'pending')) onComplete();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <>
    <div className="agent-buttons selection-action-tabs" role="group" aria-label="Margin selection actions">
      {(Object.keys(actions) as Action[]).map(kind => <button key={kind} type="button" className={kind === 'rewrite' ? 'improve-action' : undefined} aria-pressed={action === kind} disabled={task?.busy}
        onMouseDown={event => event.preventDefault()} onClick={() => { setAction(kind); setError(''); setSubmitted(false); }}>{kind === 'rewrite' && <Sparkles size={14} aria-hidden="true"/>}{actions[kind].label}</button>)}
    </div>
    {action && <form className="selection-composer" onSubmit={event => { event.preventDefault(); if (connection.connected) void send(); }}>
      {action === 'rewrite' && <fieldset className="improvement-presets" disabled={task?.busy}>
        <legend>How should it read?</legend>
        <div>{(Object.keys(presets) as Preset[]).map(name => <button key={name} type="button" aria-pressed={preset === name} onClick={() => setPreset(value => value === name ? undefined : name)}>{name}</button>)}</div>
      </fieldset>}
      <label className="composer-label" htmlFor="agent-instruction">{actions[action].placeholder} <span>Optional</span></label>
      <textarea id="agent-instruction" ref={input} aria-label="Instruction for agent" placeholder={action === 'rewrite' ? 'For example, keep the technical details…' : actions[action].placeholder} rows={2} maxLength={1000} disabled={task?.busy}
        value={instruction} onChange={event => setInstruction(event.target.value)} />
      <div className="agent-buttons">
        {connection.connected ? <>
          <button type="submit" className="agent-send" disabled={task?.busy}><Send size={14} aria-hidden="true" /> {task?.busy ? actions[action].working : actions[action].submit}</button>
          {task?.busy && <button type="button" onClick={cancelAgent}>Cancel</button>}
          {submitted && <button type="button" className="composer-chat" onClick={() => void agentboard.openChat(task?.taskId || undefined).catch(error => setError(error instanceof Error ? error.message : String(error)))}>View agent chat</button>}
        </> : <button type="button" onClick={() => window.dispatchEvent(new Event('margin:connect-agent'))}>Connect agent</button>}
      </div>
    </form>}
    {error && <p role="alert">{error}</p>}
    {submitted && task && !task.busy && <p role={task.status === 'error' ? 'alert' : 'status'}>{task.status === 'done' ? 'Finished. No new suggestion was added.' : task.detail}</p>}
  </>;
}

export function SelectionActions({ editor, workspace }: {
  editor: Editor; workspace: Workspace;
}) {
  const [anchorId, setAnchorId] = useState<string>();
  const popup = useRef<HTMLDivElement>(null);
  const reopened = useRef<string | undefined>(undefined);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Keep the captured passage while the composer swaps its input for status
        // and approval controls. Removing the focused input can emit selectionchange.
        if (popup.current && !editor.view.hasFocus()) return;
        const { from, to } = editor.state.selection;
        const active = workspace.active;
        if (active && !active.stale && reopened.current === active.id) {
          setAnchorId(active.id);
          return;
        }
        setAnchorId(editor.view.hasFocus() && from !== to && active && !active.stale &&
          active.from === from && active.to === to ? active.id : undefined);
      });
    };
    const dismiss = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node)) { reopened.current = undefined; setAnchorId(undefined); }
    };
    const reopen = () => {
      const active = workspace.active;
      if (!active || active.stale) return;
      reopened.current = active.id;
      setAnchorId(active.id);
    };
    const clickPassage = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.selected-passage') && editor.view.dom.contains(target)) reopen();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { reopened.current = undefined; setAnchorId(undefined); } };
    editor.on('selectionUpdate', update);
    document.addEventListener('selectionchange', update);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    editor.view.dom.addEventListener('click', clickPassage);
    window.addEventListener('margin:selection-menu', reopen);
    return () => {
      cancelAnimationFrame(frame);
      editor.off('selectionUpdate', update);
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      editor.view.dom.removeEventListener('click', clickPassage);
      window.removeEventListener('margin:selection-menu', reopen);
    };
  }, [editor, workspace]);

  useLayoutEffect(() => {
    const element = popup.current;
    if (!element || !anchorId) return;
    const position = () => {
      const anchor = workspace.anchors.get(anchorId);
      if (!anchor || anchor.stale || workspace.activeId !== anchorId) { reopened.current = undefined; setAnchorId(undefined); return; }
      const coords = editor.view.coordsAtPos(anchor.from);
      const { width, height } = element.getBoundingClientRect();
      element.style.left = Math.max(8, Math.min(coords.left, innerWidth - width - 8)) + 'px';
      const above = coords.top - height - 8;
      element.style.top = Math.max(8, Math.min(above >= 8 ? above : coords.bottom + 8, innerHeight - height - 8)) + 'px';
      element.style.visibility = coords.bottom < 0 || coords.top > innerHeight ? 'hidden' : 'visible';
    };
    const resize = new ResizeObserver(position);
    resize.observe(element);
    editor.on('transaction', position);
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    position();
    return () => {
      resize.disconnect();
      editor.off('transaction', position);
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
    };
  }, [anchorId, editor, workspace]);

  return anchorId ? <div className="margin-selection-popup" ref={popup}>
    <Composer key={anchorId} workspace={workspace} anchorId={anchorId} onComplete={() => {
      // Collapse the native selection so choosing the same passage again is a
      // fresh selection. The saved anchor and inline review remain highlighted.
      const anchor = workspace.anchors.get(anchorId);
      reopened.current = undefined;
      if (anchor && !anchor.stale) editor.commands.setTextSelection(anchor.to);
      setAnchorId(undefined);
    }} />
  </div> : null;
}
