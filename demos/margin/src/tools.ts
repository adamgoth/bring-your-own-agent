import type { Workspace, Action } from './engine';
type Args = Record<string, unknown>;
export type Tool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (args: Args) => Promise<unknown> };
type Context = { registerTool: (tool: Tool, options?: { signal: AbortSignal }) => void | Promise<unknown>; unregisterTool?: (name: string) => void };
function str(args: Args, key: string, optional = false) {
  const v = args[key];
  if (optional && v === undefined) return '';
  if (typeof v !== 'string' || (!optional && !v.trim()) || v.length > 20000) throw new Error(`${key} must be ${optional ? 'a' : 'a nonempty'} string of at most 20,000 characters.`);
  return v;
}
const string = (description: string) => ({ type: 'string', description, maxLength: 20000 });
const schema = (properties = {}, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
export function createTools(w: Workspace) {
  const defs = [
    { name: 'suggest_title', description: 'Set the document title in response to the user clicking Suggest title. Requires the title request ID supplied by the app. Never changes the document body.', inputSchema: schema({ requestId: string('Title request ID from the prompt.'), title: { type: 'string', description: 'A concise, specific, single-line title. No surrounding quotation marks.', maxLength: 180 } }, ['requestId', 'title']), read: false, run: (a: Args) => w.suggestTitle(str(a, 'requestId'), str(a, 'title')) },
    { name: 'propose_document', description: 'Return a new document draft as Markdown for a separate preview. Does not modify the editor. Requires the request ID supplied by the app.', inputSchema: schema({ requestId: string('Draft request ID supplied in the prompt.'), markdown: string('Complete draft in Markdown, up to 20,000 characters.') }, ['requestId', 'markdown']), read: false, run: (a: Args) => w.proposeDraft(str(a, 'requestId'), str(a, 'markdown')) },
    { name: 'get_selection', description: 'Read the passage the user highlighted, its surrounding context, and the requested editing action. Returns a selection ID for attaching suggestions.', inputSchema: schema(), read: true, run: () => w.selection() },
    { name: 'get_document_outline', description: 'Read document headings to understand the structure of the writing.', inputSchema: schema(), read: true, run: () => {
      const headings: { level: number; text: string }[] = [];
      w.editor!.state.doc.descendants(node => { if (node.type.name === 'heading') headings.push({ level: node.attrs.level, text: node.textContent }); });
      return { headings };
    } },
    { name: 'find_text', description: 'Find exact text in the document and return matching passages with nearby context.', inputSchema: schema({ query: string('Exact text to find, case insensitive.') }, ['query']), read: true, run: (a: Args) => {
      const query = str(a, 'query').toLowerCase(); const matches: { text: string; context: string }[] = [];
      w.editor!.state.doc.descendants(node => {
        if (!node.isTextblock) return;
        const text = node.textContent; let start = 0; let index;
        while ((index = text.toLowerCase().indexOf(query, start)) >= 0 && matches.length < 50) {
          matches.push({ text: text.slice(index, index + query.length), context: text.slice(Math.max(0, index - 80), index + query.length + 80) }); start = index + query.length;
        }
        return false;
      }); return { matches, limit: 50 };
    } },
    { name: 'propose_replacement', description: 'Suggest replacement text for a captured selection. Displays an inline proposal for the user to accept or reject.', inputSchema: schema({ selectionId: string('Selection ID returned by get_selection.'), replacement: string('Complete proposed replacement as plain text. Newlines create paragraphs.'), reason: string('Brief explanation of the edit.') }, ['selectionId', 'replacement']), read: false, run: (a: Args) => w.addNote('rewrite', str(a, 'selectionId'), str(a, 'replacement'), str(a, 'reason', true)) },
    { name: 'add_comment', description: 'Attach an explanation or editorial comment to a captured selection without changing the document.', inputSchema: schema({ selectionId: string('Selection ID returned by get_selection.'), text: string('The explanation or comment to show beside the passage.'), kind: { type: 'string', enum: ['explain', 'comment'], description: 'Whether this is an explanation or an editorial comment.' } }, ['selectionId', 'text', 'kind']), read: false, run: (a: Args) => {
      if (a.kind !== 'explain' && a.kind !== 'comment') throw new Error('kind must be explain or comment.');
      return w.addNote(a.kind as Action, str(a, 'selectionId'), str(a, 'text'));
    } },
  ];
  const invoke = async (name: string, args: Args, source: 'manual' | 'agent') => {
    const started = performance.now(); let result: unknown; let error = false;
    try {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be a JSON object.');
      const def = defs.find(d => d.name === name);
      if (!def) throw new Error('Unknown tool.');
      const allowed = Object.keys(def.inputSchema.properties);
      if (Object.keys(args).some(k => !allowed.includes(k))) throw new Error('Unexpected argument. Check the tool schema.');
      result = { content: [{ type: 'text', text: JSON.stringify(def.run(args)) }] };
    } catch (e) { error = true; result = { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }; }
    w.logs.unshift({ id: crypto.randomUUID(), name, source, args, result, ms: Math.round(performance.now() - started), error, time: new Date().toLocaleTimeString() });
    w.logs = w.logs.slice(0, 100); w.emit();
    return result;
  };
  const tools: Tool[] = defs.map(d => ({ name: d.name, description: d.description, inputSchema: d.inputSchema, annotations: { readOnlyHint: d.read }, execute: args => invoke(d.name, args, 'agent') }));
  return { tools, invoke };
}
export function connectTools(tools: Tool[], onStatus: (status: string) => void) {
  const context = (document as Document & { modelContext?: Context }).modelContext ?? (navigator as Navigator & { modelContext?: Context }).modelContext;
  if (!context?.registerTool) { onStatus('Manual mode'); return () => {}; }
  const abort = new AbortController(); let disposed = false;
  const registered: string[] = [];
  void (async () => {
    try {
      for (const tool of tools) {
        if (disposed) break;
        await context.registerTool(tool, { signal: abort.signal });
        registered.push(tool.name);
      }
      if (!disposed) onStatus('WebMCP connected');
    } catch (e) { if (!disposed) onStatus(`Registration failed: ${e instanceof Error ? e.message : String(e)}`); }
  })();
  return () => { disposed = true; abort.abort(); if (context.unregisterTool) for (const name of registered) { try { context.unregisterTool(name); } catch { /* Already removed by abort in newer implementations. */ } } };
}
