import { Send } from 'lucide-react';
import { agentboard, requestAgent, cancelAgent, useAgentBoardConnection, useAgentBoardTask } from './agentboard';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { Action, Workspace } from './engine';

const actions = {
  comment: { label: 'Add comment', placeholder: 'What should the comment focus on?', task: 'Add an editorial comment with add_comment using kind "comment".' },
  rewrite: { label: 'Suggest replacement', placeholder: 'How should the agent rewrite this?', task: 'Suggest a rewrite with propose_replacement and leave it for review.' },
  explain: { label: 'Explain', placeholder: 'What would you like explained?', task: 'Explain the passage with add_comment using kind "explain".' },
};

function Composer({ workspace, anchorId }: { workspace: Workspace; anchorId: string }) {
  const connection = useAgentBoardConnection();
  const task = useAgentBoardTask();
  const [action, setAction] = useState<Action>();
  const [error, setError] = useState('');
  const [instruction, setInstruction] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (action) input.current?.focus({ preventScroll: true }); }, [action]);
  const prompt = action ? [actions[action].task,
    'Use this captured selection ID for the tool call: ' + anchorId,
    instruction.trim() && 'My instruction: ' + instruction.trim(),
    'Selected passage (quoted context):\n' + JSON.stringify(workspace.requireAnchor(anchorId).text),
  ].filter(Boolean).join('\n\n') : '';
  return <>
    <div className="agent-buttons" role="group" aria-label="Margin selection actions">
      {(Object.keys(actions) as Action[]).map(kind => <button key={kind} type="button" aria-pressed={action === kind}
        onMouseDown={event => event.preventDefault()} onClick={() => setAction(kind)}>{actions[kind].label}</button>)}
    </div>
    {action && <form onSubmit={event => event.preventDefault()}>
      <textarea ref={input} aria-label="Instruction for agent" placeholder={actions[action].placeholder} rows={2} maxLength={1000}
        value={instruction} onChange={event => setInstruction(event.target.value)} />
      <div className="agent-buttons">
        {connection.connected ? <>
          <button type="button" className="agent-send" onClick={() => { setError(''); void requestAgent(prompt).catch(error => setError(error instanceof Error ? error.message : String(error))); }} disabled={task?.busy}><Send size={14} aria-hidden="true" /> Send</button>
          {task?.busy && <button type="button" onClick={cancelAgent}>Cancel</button>}
          <button type="button" onClick={() => void agentboard.openChat(task?.taskId).catch(error => setError(error instanceof Error ? error.message : String(error)))}>View agent chat</button>
        </> : <button type="button" onClick={() => window.dispatchEvent(new Event('margin:connect-agent'))}>Connect agent</button>}
      </div>
    </form>}
    {error && <p role="alert">{error}</p>}
    {task && <p role={task.status === 'error' ? 'alert' : 'status'}>{task.busy ? 'Working…' : task.status === 'done' ? 'Ready for review.' : task.detail}</p>}
  </>;
}

export function SelectionActions({ editor, workspace }: {
  editor: Editor; workspace: Workspace;
}) {
  const [anchorId, setAnchorId] = useState<string>();
  const popup = useRef<HTMLDivElement>(null);

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
        setAnchorId(editor.view.hasFocus() && from !== to && active && !active.stale &&
          active.from === from && active.to === to ? active.id : undefined);
      });
    };
    const dismiss = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node)) setAnchorId(undefined);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAnchorId(undefined); };
    editor.on('selectionUpdate', update);
    document.addEventListener('selectionchange', update);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      cancelAnimationFrame(frame);
      editor.off('selectionUpdate', update);
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [editor, workspace]);

  useLayoutEffect(() => {
    const element = popup.current;
    if (!element || !anchorId) return;
    const position = () => {
      const anchor = workspace.anchors.get(anchorId);
      if (!anchor || anchor.stale) { setAnchorId(undefined); return; }
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
    <Composer key={anchorId} workspace={workspace} anchorId={anchorId} />
  </div> : null;
}
