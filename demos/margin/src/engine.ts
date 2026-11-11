import { documentPrefix, type SavedDocument } from './documents';
import { importMarkdown } from './markdown';
import type { Editor, JSONContent } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export type Action = 'rewrite' | 'explain' | 'comment';
export type Anchor = { id: string; from: number; to: number; text: string; fingerprint: string; stale: boolean; revision: number };
export type Note = { id: string; anchorId: string; kind: Action; text: string; reason: string; status: 'pending' | 'accepted' | 'dismissed' };
export type Log = { id: string; name: string; source: 'manual' | 'agent'; args: unknown; result: unknown; ms: number; error: boolean; time: string };
export type DraftProposal = { markdown: string; revision: number; document: string };
const key = new PluginKey('margin');
export const seed = '<h1>A reading group</h1><p>The reading group will meet once a month. We will start with six people and meet at the library on Saturday mornings. Each session will last about an hour.</p><p>Each meeting will focus on one book chosen by the group. Members can suggest a title at the end of a session, then vote on what to read next.</p><h2>Format</h2><p>Everyone brings one question or a passage they want to discuss. There is no presentation to prepare. You can still come if you have not finished the book.</p><h2>Before the first meeting</h2><ul><li>Confirm the room booking.</li><li>Choose a short book for the first session.</li><li>Send the date and reading list to the group.</li></ul>';

const fingerprint = (doc: PMNode, from: number, to: number) => JSON.stringify(doc.slice(from, to).toJSON());
export function mapAnchor(anchor: Anchor, tr: Transaction): Anchor {
  if (!tr.docChanged || anchor.stale) return anchor;
  const from = tr.mapping.map(anchor.from, 1);
  const to = tr.mapping.map(anchor.to, -1);
  const stale = from >= to || from < 0 || to > tr.doc.content.size || fingerprint(tr.doc, from, to) !== anchor.fingerprint;
  return { ...anchor, from, to: Math.max(from, to), stale };
}
export class Workspace {
  constructor(public documentId = 'default', public title = 'A reading group', private initialContent: JSONContent | string = seed) {}
  private storedRaw: string | null = null;
  private loaded = false;
  storageConflict = false;
  editor: Editor | null = null;
  anchors = new Map<string, Anchor>();
  activeId: string | null = null;
  notes: Note[] = [];
  logs: Log[] = [];
  revision = 0;
  action: Action = 'rewrite';
  instruction = '';
  reviewMessage = '';
  titleRevision = 0;
  titleError = '';
  titleUndo: { before: string; after: string } | null = null;
  private titleRequest: { id: string; title: string; titleRevision: number; revision: number } | null = null;
  editTitle(title: string) { this.title = title; this.titleRevision++; this.titleUndo = null; this.save(); this.emit(); }
  beginTitleSuggestion() {
    if (!this.editor?.getText().trim()) throw new Error('Write something first so your agent has context for a title.');
    this.titleError = '';
    this.titleRequest = { id: crypto.randomUUID(), title: this.title, titleRevision: this.titleRevision, revision: this.revision };
    return this.titleRequest.id;
  }
  endTitleSuggestion() { this.titleRequest = null; }
  suggestTitle(requestId: string, title: string) {
    try {
      const request = this.titleRequest;
      if (!request || request.id !== requestId) throw new Error('This title request has expired.');
      if (request.titleRevision !== this.titleRevision || request.title !== this.title || request.revision !== this.revision) throw new Error('You edited the title or document. Your changes were kept; request a new suggestion when ready.');
      title = title.trim();
      if (!title || title.length > 180 || /[\r\n]/.test(title)) throw new Error('Return a single-line title of at most 180 characters.');
      if (!this.loaded || localStorage.getItem(documentPrefix + this.documentId) !== this.storedRaw) throw new Error('This document changed in another tab. Reload before suggesting a title.');
      this.title = title;
      if (!this.save()) { this.title = request.title; throw new Error(this.storageMessage); }
      this.titleRevision++;
      this.titleUndo = { before: request.title, after: title };
      this.titleError = '';
      this.titleRequest = null;
      this.emit();
      return { status: 'applied', title };
    } catch (error) { this.titleError = error instanceof Error ? error.message : String(error); this.emit(); throw error; }
  }
  undoTitleSuggestion() {
    const previous = this.titleUndo;
    if (!previous || this.title !== previous.after) return;
    if (localStorage.getItem(documentPrefix + this.documentId) !== this.storedRaw) throw new Error('This document changed in another tab. Reload before changing its title.');
    this.title = previous.before;
    if (!this.save()) { this.title = previous.after; throw new Error(this.storageMessage); }
    this.titleRevision++; this.titleUndo = null; this.emit();
  }
  draftProposal: DraftProposal | null = null;
  private draftRequest: { id: string; revision: number; document: string } | null = null;
  get canUseDraft() {
    return !!this.editor?.isEmpty && !!this.draftProposal && this.revision === this.draftProposal.revision && JSON.stringify(this.editor.getJSON()) === this.draftProposal.document;
  }
  beginDraft() {
    if (!this.editor?.isEmpty) throw new Error('Start a new, empty document to request a draft.');
    this.draftRequest = { id: crypto.randomUUID(), revision: this.revision, document: JSON.stringify(this.editor.getJSON()) };
    this.draftProposal = null;
    this.save(); this.emit();
    return this.draftRequest.id;
  }
  endDraft() { this.draftRequest = null; }
  proposeDraft(requestId: string, markdown: string) {
    const request = this.draftRequest;
    if (!request || request.id !== requestId) throw new Error('This draft request has expired.');
    if (!markdown.trim() || markdown.length > 20000) throw new Error('Provide between 1 and 20,000 characters of Markdown.');
    if (this.draftProposal) throw new Error('A draft is already awaiting review.');
    this.draftProposal = { markdown, revision: request.revision, document: request.document };
    this.save(); this.emit();
    return { status: 'pending', message: 'Draft shown in a separate preview. The user must choose Use draft to insert it.' };
  }
  dismissDraft() { this.endDraft(); this.draftProposal = null; this.save(); this.emit(); }
  acceptDraft() {
    if (!this.canUseDraft || !this.editor) throw new Error('This document changed. Your writing has been kept.');
    if (!this.loaded || localStorage.getItem(documentPrefix + this.documentId) !== this.storedRaw) throw new Error('This document changed in another tab. Reload before using a draft.');
    const proposal = this.draftProposal!;
    this.draftProposal = null;
    try {
      const inserted = this.editor.chain().focus().insertContentAt({ from: 0, to: this.editor.state.doc.content.size }, importMarkdown(proposal.markdown)).run();
      if (!inserted) throw new Error('Could not insert the draft.');
      this.endDraft(); this.save(); this.emit();
    } catch (error) { this.draftProposal = proposal; this.emit(); throw error; }
  }
  listeners = new Set<() => void>();
  version = 0;
  storageMessage = 'Saved on this browser';
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.version;
  emit() { this.version++; this.listeners.forEach(fn => fn()); }
  get active() { return this.activeId ? this.anchors.get(this.activeId) : undefined; }
  load(): JSONContent | string {
    try {
      this.storedRaw = localStorage.getItem(documentPrefix + this.documentId);
      this.loaded = true;
      if (!this.storedRaw) return this.initialContent;
      const saved: SavedDocument = JSON.parse(this.storedRaw);
      const data = saved.workspace;
      if ((data.document as JSONContent)?.type !== 'doc' || !Array.isArray(data.anchors) || !Array.isArray(data.notes)) throw new Error('Invalid saved workspace');
      this.title = saved.title;
      this.anchors = new Map((data.anchors as Anchor[]).map(a => [a.id, a]));
      this.notes = data.notes as Note[];
      this.activeId = data.activeId;
      this.revision = data.revision || 0;
      this.draftProposal = data.draftProposal ?? null;
      return data.document as JSONContent;
    } catch { this.loaded = false; this.storageMessage = 'Could not restore saved document — export before leaving'; return this.initialContent; }
  }
  save(): boolean {
    if (!this.editor || !this.loaded) return false;
    try {
      const key = documentPrefix + this.documentId;
      const workspace = { document: this.editor.getJSON(), anchors: [...this.anchors.values()], notes: this.notes, activeId: this.activeId, revision: this.revision, draftProposal: this.draftProposal };
      const previous = this.storedRaw ? JSON.parse(this.storedRaw) as SavedDocument : null;
      // Opening or focusing an unchanged draft must not invalidate another tab.
      if (previous?.title === this.title && JSON.stringify(previous.workspace) === JSON.stringify(workspace)) return true;
      if (localStorage.getItem(key) !== this.storedRaw) {
        this.storageConflict = true;
        this.storageMessage = 'Changed in another tab. Export your draft, then reload.';
        return false;
      }
      const raw = JSON.stringify({ id: this.documentId, title: this.title, updatedAt: Date.now(), workspace });
      localStorage.setItem(key, raw);
      this.storedRaw = raw;
      this.storageMessage = 'Saved in this browser';
      return true;
    } catch { this.storageMessage = 'Could not save — export your draft before leaving'; return false; }
  }
  capture(editor: Editor) {
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    const text = editor.state.doc.textBetween(from, to, '\n');
    if (!text.trim()) return;
    const active = this.active;
    if (active && !active.stale && active.from === from && active.to === to && active.fingerprint === fingerprint(editor.state.doc, from, to)) return;
    // Keep only selections that a pending/history note or the current action needs.
    if (this.anchors.size > 200) {
      const used = new Set(this.notes.map(n => n.anchorId));
      for (const id of this.anchors.keys()) if (!used.has(id) && id !== this.activeId) this.anchors.delete(id);
    }
    const anchor: Anchor = { id: crypto.randomUUID(), from, to, text, fingerprint: fingerprint(editor.state.doc, from, to), stale: false, revision: this.revision };
    this.anchors.set(anchor.id, anchor);
    this.activeId = anchor.id;
  }
  onTransaction(editor: Editor, tr: Transaction) {
    if (tr.docChanged) {
      this.revision++;
      for (const [id, anchor] of this.anchors) this.anchors.set(id, mapAnchor(anchor, tr));
    }
    if (tr.selectionSet && !tr.getMeta(key)) this.capture(editor);
    editor.view.updateState(editor.state);
    this.save();
    this.emit();
  }
  refresh() { this.editor?.view.dispatch(this.editor.state.tr.setMeta(key, true)); }
  requireAnchor(id?: string) {
    const anchor = id ? this.anchors.get(id) : this.active;
    if (!anchor) throw new Error('Select a passage in the editor first, then call get_selection.');
    if (anchor.stale) throw new Error('This passage changed. Ask the user to select it again and call get_selection for a fresh selection ID.');
    return anchor;
  }
  selection() {
    const a = this.requireAnchor();
    const doc = this.editor!.state.doc;
    return { selectionId: a.id, text: a.text, revision: this.revision, contextBefore: doc.textBetween(Math.max(0, a.from - 180), a.from, '\n'), contextAfter: doc.textBetween(a.to, Math.min(doc.content.size, a.to + 180), '\n'), requestedAction: this.action, instruction: this.instruction };
  }
  addNote(kind: Action, selectionId: string, text: string, reason = '') {
    const a = this.requireAnchor(selectionId);
    if (!text.trim() || text.length > 20000) throw new Error('Provide between 1 and 20,000 characters.');
    if (this.notes.filter(n => n.status === 'pending').length >= 50) throw new Error('Review existing suggestions before adding more.');
    const note: Note = { id: crypto.randomUUID(), anchorId: a.id, kind, text, reason, status: 'pending' };
    this.notes.unshift(note);
    this.refresh();
    return { noteId: note.id, status: 'pending', message: 'Visible beside the passage for human review.' };
  }
  accept(id: string) {
    const note = this.notes.find(n => n.id === id);
    if (!note || note.kind !== 'rewrite' || note.status !== 'pending' || !this.editor) return;
    const a = this.requireAnchor(note.anchorId);
    const content: JSONContent | JSONContent[] = note.text.includes('\n')
      ? note.text.split('\n').map(text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }))
      : { type: 'text', text: note.text };
    const success = this.editor.chain().focus().setMeta('marginAcceptance', id).insertContentAt({ from: a.from, to: a.to }, content).run();
    if (!success) throw new Error('The editor could not apply this replacement.');
    note.status = 'accepted';
    this.refresh();
  }
  dismiss(id: string) { const n = this.notes.find(n => n.id === id); if (n) n.status = 'dismissed'; this.refresh(); }
  clearSelection() {
    this.activeId = null;
    if (this.editor) this.editor.commands.setTextSelection(this.editor.state.selection.to);
    this.refresh();
  }
  setAction(action: Action) { this.action = action; this.emit(); }
}
export function selectionExtension(workspace: Workspace) {
  return Extension.create({
    name: 'margin',
    addProseMirrorPlugins() {
      return [new Plugin({ key, props: { decorations(state) {
        const items: Decoration[] = [];
        const active = workspace.active;
        if (active && !active.stale && active.to <= state.doc.content.size) {
          items.push(Decoration.inline(active.from, active.to, { class: 'selected-passage', title: 'Click to reopen selection actions' }));
          items.push(Decoration.widget(active.to, () => {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'clear-highlight';
            clear.contentEditable = 'false';
            clear.setAttribute('aria-label', 'Clear highlighted selection');
            clear.title = 'Clear selection';
            clear.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
            clear.addEventListener('mousedown', event => event.preventDefault());
            clear.addEventListener('click', event => {
              event.stopPropagation();
              workspace.clearSelection();
              workspace.editor?.view.focus();
            });
            return clear;
          }, { side: -1, key: `clear-selection:${active.id}`, stopEvent: () => true, ignoreSelection: true }));
        }
        for (const n of workspace.notes) {
          const a = workspace.anchors.get(n.anchorId);
          if (n.status !== 'pending' || !a) continue;
          const valid = !a.stale && a.to <= state.doc.content.size;
          if (valid) items.push(Decoration.inline(a.from, a.to, { class: n.kind === 'rewrite' ? 'suggestion-original' : 'comment-anchor', 'data-note-id': n.id }));
          const position = Math.max(0, Math.min(a.to, state.doc.content.size));
          // Review UI is a widget, not document content: it moves with the anchor
          // and stays out of saved prose, exports, and the undo history.
          items.push(Decoration.widget(position, () => {
            const root = document.createElement('span');
            root.className = 'inline-annotation'; root.contentEditable = 'false';
            if (n.kind === 'rewrite' && valid) {
              const inserted = document.createElement('span'); inserted.className = 'suggestion-insertion';
              inserted.textContent = n.text; inserted.setAttribute('aria-label', 'Proposed replacement'); root.append(inserted);
            }
            const card = document.createElement('details');
            card.className = `note inline-review ${valid ? '' : 'conflict'}`;
            card.open = n.kind === 'rewrite' || !valid;
            const summary = document.createElement('summary');
            summary.textContent = n.kind === 'rewrite' ? 'Suggested edit' : n.kind === 'explain' ? 'Explanation' : 'Comment';
            card.append(summary);
            const body = document.createElement('div'); body.className = 'annotation-body';
            if (n.kind !== 'rewrite' || !valid) {
              const text = document.createElement('p'); text.className = 'note-text'; text.textContent = n.text; body.append(text);
            }
            if (n.reason) { const reason = document.createElement('small'); reason.textContent = n.reason; body.append(reason); }
            if (!valid) {
              const warning = document.createElement('p'); warning.className = 'conflict-message';
              warning.textContent = 'This passage changed. Select it again to request a fresh suggestion.'; body.append(warning);
            }
            const actions = document.createElement('div'); actions.className = 'note-actions';
            if (n.kind === 'rewrite') {
              const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'accept'; accept.textContent = 'Accept'; accept.disabled = !valid;
              accept.addEventListener('click', () => {
                try { workspace.reviewMessage = ''; workspace.accept(n.id); }
                catch (error) { workspace.reviewMessage = error instanceof Error ? error.message : String(error); workspace.emit(); }
              }); actions.append(accept);
            }
            const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = n.kind === 'rewrite' ? 'Reject' : 'Resolve';
            dismiss.addEventListener('click', () => workspace.dismiss(n.id)); actions.append(dismiss);
            body.append(actions); card.append(body); root.append(card); return root;
          }, { side: 1, key: `${n.id}:${valid}`, stopEvent: () => true, ignoreSelection: true }));
        }
        return DecorationSet.create(state.doc, items);
      } } })];
    },
  });
}
