import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ArrowUpRight, Check, ChevronDown, Code2, Download, Highlighter, Italic, List, PenLine, Play, Quote, Redo2, Undo2, X, CircleHelp } from 'lucide-react';
import { Workspace, selectionExtension } from './engine';
import { connectTools, createTools } from './tools';
import { AgentConnection } from './AgentConnection';
import { SelectionActions } from './SelectionActions';

export default function App() {
  const [w] = useState(() => new Workspace());
  const [content] = useState(() => w.load());
  useSyncExternalStore(w.subscribe, w.snapshot);
  const [status, setStatus] = useState('Checking WebMCP…');
  const [help, setHelp] = useState(false);
  const [tool, setTool] = useState('get_selection');
  const [args, setArgs] = useState('{}');
  const [output, setOutput] = useState('');
  const api = useMemo(() => createTools(w), [w]);
  const editor = useEditor({ extensions: [StarterKit, selectionExtension(w)], content,
    editorProps: { attributes: { 'aria-label': 'Document editor', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' } },
    onCreate: ({ editor }) => { w.editor = editor; w.emit(); },
    onTransaction: ({ editor, transaction }) => w.onTransaction(editor, transaction),
  });
  useEffect(() => { if (!editor) return; w.editor = editor; return connectTools(api.tools, setStatus); }, [editor, api, w]);
  const active = w.active;
  const words = editor?.getText().trim().split(/\s+/).filter(Boolean).length ?? 0;
  const sample = (name: string) => {
    const selectionId = active?.id || 'Select a passage first';
    const values: Record<string, object> = { get_selection: {}, get_document_outline: {}, find_text: { query: 'thoughts' }, propose_replacement: { selectionId, replacement: 'A clearer way to put it.', reason: 'A manual test of the suggestion workflow.' }, add_comment: { selectionId, text: 'Try making the main idea more specific.', kind: 'comment' } };
    setTool(name); setArgs(JSON.stringify(values[name], null, 2));
  };
  const run = async () => {
    try { setOutput(JSON.stringify(await api.invoke(tool, JSON.parse(args), 'manual'), null, 2)); }
    catch (e) { setOutput(e instanceof Error ? e.message : String(e)); }
  };
  const exportDocument = () => {
    if (!editor) return;
    const blob = new Blob([editor.getText()], { type: 'text/plain' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'margin-document.txt'; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="app-shell" data-margin-selection-popup>
    <header className="topbar">
      <a href="#" className="brand" aria-label="Margin home"><span className="brand-mark"><PenLine size={20}/></span>margin<span className="brand-dot">.</span></a>
      <span className="project-label">A WEBMCP PLAYGROUND</span>
      <div className="header-actions"><AgentConnection /><button className="icon-button" aria-label="How to use Margin" onClick={() => setHelp(true)}><CircleHelp size={19}/></button><button className="export" onClick={exportDocument}><Download size={15}/> Export</button></div>
    </header>
    <main className="workspace">
      <section className="writing-area">
        <div className="document-meta"><span><span className="mini-dot"/> PERSONAL WORKSPACE <span className="slash">/</span> Untitled document</span><span className="saved"><Check size={13}/>{w.storageMessage}</span></div>
        <div className="paper">
          <div className="formatbar" aria-label="Formatting toolbar">
            <button onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} aria-pressed={editor?.isActive('heading', { level: 2 })} title="Toggle heading">Heading <ChevronDown size={12}/></button>
            <span className="divider"/>
            <button aria-label="Bold" aria-pressed={editor?.isActive('bold')} onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
            <button aria-label="Italic" aria-pressed={editor?.isActive('italic')} onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={16}/></button>
            <button aria-label="Bullet list" aria-pressed={editor?.isActive('bulletList')} onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={18}/></button>
            <button aria-label="Block quote" aria-pressed={editor?.isActive('blockquote')} onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBlockquote().run()}><Quote size={16}/></button>
            <span className="divider"/>
            <button aria-label="Undo" disabled={!editor?.can().undo()} onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={16}/></button>
            <button aria-label="Redo" disabled={!editor?.can().redo()} onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={16}/></button>
            <span className="format-hint">Your words. A little help.</span>
          </div>
          <div className="editor-wrap"><div className="eyebrow">THE WORKING DRAFT <span>01</span></div><EditorContent editor={editor}/></div>
          <div className="paper-footer"><span>{words} words <span>·</span> {Math.max(1, Math.ceil(words / 200))} min read</span><span><span className="small-square"/> LOCAL DRAFT</span></div>
        </div>
        <div className={`selection-bar ${active ? 'has-selection' : ''}`}>
          <Highlighter size={17}/><span>{active ? active.stale ? 'Passage changed. Select it again to continue.' : `${active.text.trim().split(/\s+/).length} words selected · Ready for your connected agent` : 'Highlight a passage, then ask your connected agent about it.'}</span>

          {active && <button className="icon-button" aria-label="Clear selection" onClick={() => w.clearSelection()}><X size={15}/></button>}
        </div>
        {w.reviewMessage && <p className="conflict-message" role="status">{w.reviewMessage}</p>}
        {w.notes.some(n => n.status !== 'pending') && <details className="history"><summary>Review history ({w.notes.filter(n => n.status !== 'pending').length})</summary>{w.notes.filter(n => n.status !== 'pending').map(n => <p key={n.id}><span>{n.status}</span> {n.text}</p>)}</details>}
      </section>
      <details className="developer-tools"><summary><Code2 size={14}/> Developer tools <span>Manual tool calls & activity</span></summary><div className="inspector"><span className="eyebrow">UNDER THE HOOD</span><h2>The tool bench.</h2><p>Call the same functions exposed to a browser agent. No model or API key required.</p><div className="mode-box"><span className="mini-dot"/>{status}<button onClick={() => setHelp(true)}>Setup <ArrowUpRight size={12}/></button></div><label htmlFor="tool">Tool</label><select id="tool" value={tool} onChange={e => sample(e.target.value)}>{api.tools.map(t => <option key={t.name}>{t.name}</option>)}</select><p className="tool-description">{api.tools.find(t => t.name === tool)?.description}</p><div className="args-label"><label htmlFor="arguments">Arguments · JSON</label><button onClick={() => sample(tool)}>Load example</button></div><textarea id="arguments" className="code-input" spellCheck={false} value={args} onChange={e => setArgs(e.target.value)}/><button className="primary" onClick={run}><Play size={14}/> Run tool</button><details className="schema"><summary>View input schema</summary><pre>{JSON.stringify(api.tools.find(t => t.name === tool)?.inputSchema, null, 2)}</pre></details>{output && <div className="tool-output"><span className="eyebrow">RESULT</span><pre>{output}</pre></div>}<div className="review-heading"><span>TOOL CALLS</span><button onClick={() => { w.logs = []; w.emit(); }}>Clear</button></div>{!w.logs.length && <p className="no-calls">Your calls will appear here.</p>}{w.logs.map(l => <details className={`log ${l.error ? 'error' : ''}`} key={l.id}><summary><span className="log-dot"/><code>{l.name}</code><span>{l.ms} ms</span></summary><div className="log-meta">{l.source} · {l.time}</div><pre>{JSON.stringify({ arguments: l.args, result: l.result }, null, 2)}</pre></details>)}</div>
      </details>
    </main>
    {editor && <SelectionActions editor={editor} workspace={w} />}
    <footer className="app-footer"><span>SPACE TO WRITE. ROOM TO EXPERIMENT.</span><button onClick={() => setHelp(true)}>Built for humans & their agents <ArrowUpRight size={12}/></button></footer>
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><button className="close-modal icon-button" aria-label="Close help" autoFocus onClick={() => setHelp(false)}><X size={20}/></button><span className="eyebrow">WELCOME TO MARGIN</span><h2 id="help-title">A shared page.<br/>A little possibility.</h2><ol><li><b>Highlight a passage.</b> The selection stays available when you move to your agent.</li><li><b>Bring your browser agent.</b> Connect your API agent through the BYOA extension using the button above. Send instructions from the highlight popup; open the agent chat whenever you want details.</li><li><b>Have the final word.</b> Review suggestions beside the affected passage. Expand comment annotations to read or resolve them. Use Undo to restore an accepted edit.</li></ol><div className="help-box"><b>No agent connected?</b><p>Expand Developer tools below the document to exercise the tools yourself. Manual mode doesn't generate AI responses.</p></div><p>Configure your API profiles in BYOA, then choose a profile when connecting. Reload Margin after installing or reloading the extension.</p><p>Everything is stored in this browser. Margin makes no model calls; your browser agent handles AI processing. Use the sample text while experimenting.</p><a href="https://developer.chrome.com/docs/ai/webmcp" target="_blank" rel="noreferrer">WebMCP setup guide <ArrowUpRight size={13}/></a></section></div>}
  </div>;
}
