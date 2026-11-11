export const documentPrefix = 'margin-document-v1:';
export const activeDocumentKey = 'margin-active-document';
export type SavedDocument = { id: string; title: string; updatedAt: number; workspace: { document: unknown; anchors: unknown[]; notes: unknown[]; activeId: string | null; revision: number; draftProposal?: import('./engine').DraftProposal | null } };

export function listDocuments(): SavedDocument[] {
  const documents: SavedDocument[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (!key.startsWith(documentPrefix)) continue;
    const data = JSON.parse(localStorage.getItem(key)!);
    if (data.id !== key.slice(documentPrefix.length) || typeof data.title !== 'string' || !data.workspace?.document) throw new Error('A saved document could not be read. Export your open draft before clearing browser data.');
    documents.push(data);
  }
  return documents.sort((a, b) => b.updatedAt - a.updatedAt);
}
