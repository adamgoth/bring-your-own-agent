import { useRef, useState, useSyncExternalStore } from 'react';
import type { JSONContent } from '@tiptap/core';
import { FilePlus2, Upload } from 'lucide-react';
import { Workspace } from './engine';
import { activeDocumentKey, documentPrefix, listDocuments } from './documents';
import { importMarkdown } from './markdown';
import { isAgentBusy, useAgentBoardTask } from './agentboard';
import WritingApp from './App';
import { ErrorNotice } from './ErrorNotice';

function initialWorkspace(): Workspace {
  try {
    const documents = listDocuments();
    if (documents.length) {
      const current = documents.find(d => d.id === localStorage.getItem(activeDocumentKey)) || documents[0];
      return new Workspace(current.id, current.title);
    }
    // Preserve the original single-document workspace, including review notes.
    const legacy = localStorage.getItem('margin-v1');
    if (legacy) {
      const workspace = JSON.parse(legacy);
      if (workspace.document?.type !== 'doc' || !Array.isArray(workspace.notes) || !Array.isArray(workspace.anchors)) throw new Error('Invalid legacy draft');
      const id = crypto.randomUUID();
      localStorage.setItem(documentPrefix + id, JSON.stringify({ id, title: 'Recovered draft', updatedAt: Date.now(), workspace }));
      return new Workspace(id, 'Recovered draft');
    }
  } catch { /* The library reports storage errors and never deletes unreadable data. */ }
  return new Workspace(crypto.randomUUID());
}

export default function DocumentLibrary() {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  // React Fast Refresh preserves state objects across module updates, including
  // instances of the previous Workspace class. Keep the live document, editor,
  // and subscriptions, but adopt the current methods and any new default fields.
  if (Object.getPrototypeOf(workspace) !== Workspace.prototype) {
    const defaults = new Workspace(workspace.documentId, workspace.title);
    for (const field of Object.keys(defaults) as (keyof Workspace)[]) {
      if (!Object.hasOwn(workspace, field)) Object.defineProperty(workspace, field, Object.getOwnPropertyDescriptor(defaults, field)!);
    }
    Object.setPrototypeOf(workspace, Workspace.prototype);
  }
  useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const task = useAgentBoardTask();
  let documents: ReturnType<typeof listDocuments> = [];
  let storageError = '';
  try { documents = listDocuments(); } catch (e) { storageError = e instanceof Error ? e.message : 'Browser storage is unavailable.'; }
  const canLeave = () => {
    if (isAgentBusy()) { setError('Wait for your agent to finish or cancel its task before switching documents.'); return false; }
    if (!workspace.save()) { setError(workspace.storageMessage); return false; }
    setError('');
    return true;
  };
  const open = (next: Workspace) => {
    if (!canLeave()) return;
    try { localStorage.setItem(activeDocumentKey, next.documentId); } catch { /* Saving the document reports storage failures. */ }
    setWorkspace(next);
  };
  const create = (title = 'Untitled document', content: JSONContent | string = '<p></p>') => open(new Workspace(crypto.randomUUID(), title, content));
  return <div className="library-layout">
    <aside className="document-library" aria-label="Documents">
      <h2>Documents</h2>
      <div className="library-actions">
        <button onClick={() => create()} disabled={task?.busy}><FilePlus2 size={15}/> New document</button>
        <button onClick={() => input.current?.click()} disabled={task?.busy}><Upload size={15}/> Import Markdown</button>
      </div>
      <input ref={input} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" aria-label="Import Markdown file" hidden onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { setError('Choose a Markdown file smaller than 2 MB.'); return; }
        try { create(file.name.replace(/\.(md|markdown|txt)$/i, ''), importMarkdown(await file.text())); }
        catch { setError('Could not import this file. Your current document is unchanged.'); }
      }}/>
      <nav aria-label="Saved documents">{documents.map(doc => <button key={doc.id} aria-current={doc.id === workspace.documentId ? 'page' : undefined} disabled={task?.busy} onClick={() => { if (doc.id !== workspace.documentId) open(new Workspace(doc.id, doc.title)); }}>
        <span>{doc.title || 'Untitled document'}</span><small>{new Date(doc.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
      </button>)}</nav>
      <p className="local-notice">Stored in this browser. Export a backup before clearing site data.</p>
      {(error || storageError) && <ErrorNotice title="Document unavailable" message={error || storageError}/>}
    </aside>
    <WritingApp key={workspace.documentId} w={workspace}/>
  </div>;
}
