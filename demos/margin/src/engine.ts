import type { Editor, JSONContent } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export type Action = 'rewrite' | 'explain' | 'comment';
export type Anchor = { id: string; from: number; to: number; text: string; fingerprint: string; stale: boolean; revision: number };
export type Note = { id: string; anchorId: string; kind: Action; text: string; reason: string; status: 'pending' | 'accepted' | 'dismissed' };
export type Log = { id: string; name: string; source: 'manual' | 'agent'; args: unknown; result: unknown; ms: number; error: boolean; time: string };
const key = new PluginKey('margin');
export const seed = '<h1>A little room to think</h1><p>Good writing rarely arrives fully formed. It starts as a collection of half-finished thoughts, a sentence that almost works, or an idea waiting for the right words.</p><p>The best tools give those thoughts room to breathe. They help us notice what matters, remove what gets in the way, and find a clearer path from an idea to the page.</p><h2>A different kind of collaboration</h2><p>An assistant should feel like a thoughtful editor sitting beside you. You choose the passage. You set the direction. It offers a possibility, and you decide what stays.</p><p>This is a small experiment in that kind of collaboration: a shared page, a highlighted thought, and a little help in the margin.</p><h2>Things to try</h2><ul><li>Highlight a sentence and ask for a shorter version.</li><li>Ask for an explanation of an idea without changing it.</li><li>Keep typing while a suggestion is waiting.</li></ul>';
const fingerprint = (doc: PMNode, from: number, to: number) => JSON.stringify(doc.slice(from, to).toJSON());
export function mapAnchor(anchor: Anchor, tr: Transaction): Anchor {
  if (!tr.docChanged || anchor.stale) return anchor;
  const from = tr.mapping.map(anchor.from, 1);
  const to = tr.mapping.map(anchor.to, -1);
  const stale = from >= to || from < 0 || to > tr.doc.content.size || fingerprint(tr.doc, from, to) !== anchor.fingerprint;
  return { ...anchor, from, to: Math.max(from, to), stale };
}
export class Workspace {
  editor: Editor | null = null;
  anchors = new Map<string, Anchor>();
  activeId: string | null = null;
  notes: Note[] = [];
  logs: Log[] = [];
  revision = 0;
  action: Action = 'rewrite';
  instruction = '';
  reviewMessage = '';
  listeners = new Set<() => void>();
  version = 0;
  storageMessage = 'Saved on this browser';
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.version;
  emit() { this.version++; this.listeners.forEach(fn => fn()); }
  get active() { return this.activeId ? this.anchors.get(this.activeId) : undefined; }
  load(): JSONContent | string {
    try {
      const raw = localStorage.getItem('margin-v1');
      if (!raw) return seed;
      const data = JSON.parse(raw);
      if (data.document?.type !== 'doc' || !Array.isArray(data.anchors) || !Array.isArray(data.notes)) throw new Error('Invalid saved workspace');
      this.anchors = new Map(data.anchors.map((a: Anchor) => [a.id, a]));
      this.notes = data.notes;
      this.activeId = data.activeId;
      this.revision = data.revision || 0;
      return data.document;
    } catch { this.storageMessage = 'Could not restore saved document'; return seed; }
  }
  save() {
    if (!this.editor) return;
    try {
      localStorage.setItem('margin-v1', JSON.stringify({ document: this.editor.getJSON(), anchors: [...this.anchors.values()], notes: this.notes, activeId: this.activeId, revision: this.revision }));
      this.storageMessage = 'Saved on this browser';
    } catch { this.storageMessage = 'Storage unavailable — keep this tab open'; }
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
  clearSelection() { this.activeId = null; this.refresh(); }
  setAction(action: Action) { this.action = action; this.emit(); }
}
export function selectionExtension(workspace: Workspace) {
  return Extension.create({
    name: 'margin',
    addProseMirrorPlugins() {
      return [new Plugin({ key, props: { decorations(state) {
        const items: Decoration[] = [];
        const active = workspace.active;
        if (active && !active.stale && active.to <= state.doc.content.size) items.push(Decoration.inline(active.from, active.to, { class: 'selected-passage' }));
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
