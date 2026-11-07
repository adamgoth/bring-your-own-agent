import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { mapAnchor, type Anchor } from './engine';
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', group: 'block' }, text: { group: 'inline' } } });
function fixture() {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('Hello beautiful world'))]);
  const state = EditorState.create({ doc });
  const a: Anchor = { id: 'a', from: 7, to: 16, text: 'beautiful', fingerprint: JSON.stringify(doc.slice(7, 16).toJSON()), stale: false, revision: 0 };
  return { state, a };
}
describe('selection mapping', () => {
  it('moves a selection when earlier text grows', () => { const {state,a} = fixture(); expect(mapAnchor(a,state.tr.insertText('Well, ',1))).toMatchObject({from:13,to:22,stale:false}); });
  it('invalidates an edited passage', () => { const {state,a}=fixture(); expect(mapAnchor(a,state.tr.insertText('very ',9)).stale).toBe(true); });
  it('invalidates a deleted passage', () => { const {state,a}=fixture(); expect(mapAnchor(a,state.tr.delete(7,16)).stale).toBe(true); });
  it('ignores typing at either boundary', () => { const {state,a}=fixture(); expect(mapAnchor(a,state.tr.insertText('very ',7))).toMatchObject({from:12,to:21,stale:false}); expect(mapAnchor(a,state.tr.insertText('!',16))).toMatchObject({from:7,to:16,stale:false}); });
  it('does not invalidate a passage when later text changes', () => { const {state,a}=fixture(); expect(mapAnchor(a,state.tr.insertText('!',22)).stale).toBe(false); });
});
