import { useEffect, useRef, useState } from 'react';
import { AgentConnectionDialog, AgentIndicator, useConnection } from '@byoagent/react';
import { ErrorNotice } from './ErrorNotice';
import { useAgentBoardTask, useTaskRecovery, retryRecoveredTask, dismissRecovery } from './agentboard';

export function AgentConnection() {
  const { connection } = useConnection();
  const task = useAgentBoardTask();
  const recovery = useTaskRecovery();
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const indicator = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('margin:connect-agent', show);
    return () => window.removeEventListener('margin:connect-agent', show);
  }, []);
  return <div className="agent-connection-control" data-provider-ready={connection.available}>
    <AgentIndicator ref={indicator} className={`connection agent-connection-button ${connection.connected ? 'connected' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="agent-connection-menu" onClick={() => setOpen(true)} />
    {recovery && <aside role="status" className="task-recovery"><p>{recovery.detail} Review existing proposals before repeating this request.</p><button disabled={!!task?.busy || !connection.connected} onClick={() => { setError(''); void retryRecoveredTask().catch(error => setError(error instanceof Error ? error.message : String(error))); }}>Retry request</button><button onClick={dismissRecovery}>Dismiss</button></aside>}
    <AgentConnectionDialog returnFocusRef={indicator} id="agent-connection-menu" className="margin-agent-dialog" open={open} onOpenChange={setOpen} labels={{ privacy: 'Requests send writing to your chosen provider. Your API key stays in BYOA.' }} />
    {error && <ErrorNotice title="Agent request failed" message={error} />}
  </div>;
}
