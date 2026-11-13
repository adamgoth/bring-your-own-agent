import { useMemo, useState } from 'react';
import type { Workspace } from './engine';
import { cancelAgent, isAgentBusy, requestAgent, useAgentBoardConnection, useAgentBoardTask } from './agentboard';
import { importMarkdown } from './markdown';
import { ErrorNotice } from './ErrorNotice';
import { SubmitShortcut, submitOnShortcut } from './SubmitShortcut';

export function DraftStarter({ workspace: w }: { workspace: Workspace }) {
  const connection = useAgentBoardConnection();
  const task = useAgentBoardTask();
  const [instruction, setInstruction] = useState('');
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const proposal = w.draftProposal;
  const preview = useMemo(() => proposal ? importMarkdown(proposal.markdown) : '', [proposal]);
  const start = async () => {
    if (!instruction.trim() || isAgentBusy()) return;
    setMessage('');
    setFailed(false);
    try {
      const requestId = w.beginDraft();
      setRunning(true);
      const result = await requestAgent([
        'Write a first draft based on the user’s description. Return it using propose_document with the request ID below. Use Markdown. Do not claim to have inserted anything; the user will review a separate preview.',
        `Draft request ID: ${requestId}`,
        `User description: ${JSON.stringify(instruction.trim())}`,
      ].join('\n\n'), ['propose_document']);
      if (!w.draftProposal) {
        setFailed(result?.status !== 'cancelled');
        setMessage(result?.status === 'error' || result?.status === 'cancelled' ? result.detail : 'The agent finished without returning a draft. Try again.');
      }
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { w.endDraft?.(); setRunning(false); }
  };
  if (!w.editor?.isEmpty && !proposal && !running && !message) return null;
  return <section className="draft-starter" aria-label="Draft with your agent">
    {proposal ? <>
      <h2>Draft preview</h2>
      <div className="draft-preview" dangerouslySetInnerHTML={{ __html: preview }}/>
      {!w.canUseDraft && <p role="status">You’ve edited this document. The draft can’t replace your writing.</p>}
      <div className="agent-buttons">
        <button className="draft-use" disabled={!w.canUseDraft || !!task?.busy} onClick={() => { try { w.acceptDraft(); setMessage(''); } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : String(error)); } }}>Use draft</button>
        {w.canUseDraft && <button disabled={!!task?.busy || !instruction.trim()} onClick={() => void start()}>Try again</button>}
        <button onClick={() => { if (running) cancelAgent(); w.dismissDraft(); setMessage(''); }}>Dismiss</button>
      </div>
    </> : <>
      {w.editor?.isEmpty && <form onSubmit={event => { event.preventDefault(); if (connection.connected) void start(); }}>
        <label htmlFor="draft-description">What are you writing?</label>
        <textarea id="draft-description" placeholder="Describe the document…" value={instruction} maxLength={4000} rows={3} disabled={running} onChange={event => setInstruction(event.target.value)} onKeyDown={submitOnShortcut}/>
        <div className="agent-buttons">
          {connection.connected ? <button className="draft-use" type="submit" aria-keyshortcuts="Meta+Enter Control+Enter" disabled={!instruction.trim() || !!task?.busy}>{running ? 'Drafting…' : 'Draft with your agent'}{!running && <SubmitShortcut/>}</button> : <button type="button" onClick={() => window.dispatchEvent(new Event('margin:connect-agent'))}>Connect Agent</button>}
        </div>
      </form>}
      {running && <div className="agent-buttons"><span role="status">Drafting a preview…</span><button onClick={() => { w.endDraft(); cancelAgent(); }}>Cancel</button></div>}
      {!running && w.editor?.isEmpty && <p className="draft-hint">Or start typing below.</p>}
    </>}
    {message && (failed ? <ErrorNotice title={proposal ? 'Couldn’t use this draft' : 'Couldn’t create a draft'} message={message} onRetry={!proposal && w.editor?.isEmpty && !task?.busy && connection.connected ? () => void start() : undefined}/> : <p role="status">{message}</p>)}
  </section>;
}
