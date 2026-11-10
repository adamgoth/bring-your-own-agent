import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ArrowUpRight, Check, ChevronDown, Code2, Download, Highlighter, Italic, List, PenLine, Play, Quote, Redo2, Undo2, X, CircleHelp } from 'lucide-react';
import { Workspace, selectionExtension } from './engine';
import { connectTools, createTools } from './tools';
import { AgentConnection } from './AgentConnection';
import { SelectionActions } from './SelectionActions';
import { downloadMarkdown } from './markdown';

export default function WritingApp({ w }: { w: Workspace }) {
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
    onCreate: ({ editor }) => { w.editor = editor; w.save(); w.emit(); },
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
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (!w.save()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [w]);
  const exportDocument = () => { if (editor) downloadMarkdown(w.title, editor.getHTML()); };
  return <div className="app-shell" data-margin-selection-popup>
    <header className="topbar">
      <a href="#" className="brand" aria-label="Margin home"><span className="brand-mark"><PenLine size={20}/></span>margin<span className="brand-dot">.</span></a>
      <div className="header-actions"><AgentConnection /><button className="icon-button" aria-label="How to use Margin" onClick={() => setHelp(true)}><CircleHelp size={19}/></button><button className="export" onClick={exportDocument}><Download size={15}/> Export Markdown</button></div>
    </header>
    <main className="workspace">
      <section className="writing-area">
        <div className="document-meta"><span className="saved" role="status"><Check size={13}/>{w.storageMessage}</span></div>
        <label className="document-title-label">Document title<input className="document-title" aria-label="Document title" value={w.title} maxLength={180} onChange={e => { w.title = e.target.value; w.save(); w.emit(); }}/></label>
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
          </div>
          <div className="editor-wrap"><EditorContent editor={editor}/></div>
          <div className="paper-footer"><span>{words} words <span>·</span> {Math.max(1, Math.ceil(words / 200))} min read</span></div>
        </div>
        <div className={`selection-bar ${active ? 'has-selection' : ''}`}>
          <Highlighter size={17}/><span>{active ? active.stale ? 'Passage changed. Select it again to continue.' : `${active.text.trim().split(/\s+/).length} words selected` : 'Select text to improve, comment, or explain.'}</span>

          {active && !active.stale && <button className="reopen-selection" onClick={() => window.dispatchEvent(new Event('margin:selection-menu'))}>Selection actions</button>}
          {active && <button className="icon-button" aria-label="Clear selection" onClick={() => w.clearSelection()}><X size={15}/></button>}
        </div>
        {w.reviewMessage && <p className="conflict-message" role="status">{w.reviewMessage}</p>}
        {w.notes.some(n => n.status !== 'pending') && <details className="history"><summary>Review history ({w.notes.filter(n => n.status !== 'pending').length})</summary>{w.notes.filter(n => n.status !== 'pending').map(n => <p key={n.id}><span>{n.status}</span> {n.text}</p>)}</details>}
      </section>
      <details className="developer-tools"><summary><Code2 size={14}/> Developer tools <span>Manual tool calls & activity</span></summary><div className="inspector"><p>Test page tools without an agent.</p><div className="mode-box"><span className="mini-dot"/>{status}<button onClick={() => setHelp(true)}>Setup <ArrowUpRight size={12}/></button></div><label htmlFor="tool">Tool</label><select id="tool" value={tool} onChange={e => sample(e.target.value)}>{api.tools.map(t => <option key={t.name}>{t.name}</option>)}</select><p className="tool-description">{api.tools.find(t => t.name === tool)?.description}</p><div className="args-label"><label htmlFor="arguments">Arguments · JSON</label><button onClick={() => sample(tool)}>Load example</button></div><textarea id="arguments" className="code-input" spellCheck={false} value={args} onChange={e => setArgs(e.target.value)}/><button className="primary" onClick={run}><Play size={14}/> Run tool</button><details className="schema"><summary>View input schema</summary><pre>{JSON.stringify(api.tools.find(t => t.name === tool)?.inputSchema, null, 2)}</pre></details>{output && <div className="tool-output"><span className="eyebrow">RESULT</span><pre>{output}</pre></div>}<div className="review-heading"><span>TOOL CALLS</span><button onClick={() => { w.logs = []; w.emit(); }}>Clear</button></div>{!w.logs.length && <p className="no-calls">No tool calls yet.</p>}{w.logs.map(l => <details className={`log ${l.error ? 'error' : ''}`} key={l.id}><summary><span className="log-dot"/><code>{l.name}</code><span>{l.ms} ms</span></summary><div className="log-meta">{l.source} · {l.time}</div><pre>{JSON.stringify({ arguments: l.args, result: l.result }, null, 2)}</pre></details>)}</div>
      </details>
    </main>
    {editor && <SelectionActions editor={editor} workspace={w} />}
    <footer className="app-footer"><button onClick={() => setHelp(true)}>Help</button></footer>
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><button className="close-modal icon-button" aria-label="Close help" autoFocus onClick={() => setHelp(false)}><X size={20}/></button><h2 id="help-title">Using Margin</h2><ol><li>Connect an agent with the BYOA extension.</li><li>Select text, choose Improve this, Comment, or Explain, and send your request.</li><li>Accept or reject edits in the document. Undo restores an accepted edit.</li></ol><p>Click a highlight to reopen its menu. The × clears the selection.</p><div className="help-box"><b>Saving your work</b><p>Documents and review notes stay in this browser. Clearing site data deletes them. Export Markdown for a backup of your writing; comments and suggestions aren’t included.</p></div><p>Your agent sends requests and document context to your chosen AI provider. API keys stay in BYOA.</p><a href="https://github.com/adamgoth/bring-your-own-agent#readme" target="_blank" rel="noreferrer">BYOA setup <ArrowUpRight size={13}/></a></section></div>}
  </div>;
}
