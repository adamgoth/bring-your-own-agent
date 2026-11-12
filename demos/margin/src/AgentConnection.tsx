import { ErrorNotice } from './ErrorNotice';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { agentboard, useAgentBoardConnection, useAgentBoardTask, useTaskRecovery, retryRecoveredTask, dismissRecovery } from './agentboard';

export function AgentConnection() {
  const connection = useAgentBoardConnection();
  const task = useAgentBoardTask();
  const recovery = useTaskRecovery();
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const act = (operation: Promise<unknown>) => { setError(''); void operation.catch(error => setError(error instanceof Error ? error.message : String(error))); };
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = () => setOpen(true);
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('margin:connect-agent', show);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('margin:connect-agent', show); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  const profileName = connection.agentName || 'Agent connected';
  const label = connection.connected ? task?.busy ? `${profileName} · Working…` : profileName : 'Connect your agent';
  return <div className="agent-connection-control" ref={root} data-provider-ready={connection.available}>
    <button className={`connection agent-connection-button ${connection.connected ? 'connected' : ''}`} aria-label={connection.connected ? `${label}, connected` : label} title={label}
      aria-expanded={open} aria-controls="agent-connection-menu" onClick={() => setOpen(value => !value)}>
      <span aria-hidden="true" /><span className="agent-profile-name">{label}</span><ChevronDown size={13} aria-hidden="true" />
    </button>
    {recovery && <aside role="status" className="task-recovery"><p>{recovery.detail} Review existing proposals before repeating this request.</p><button disabled={!!task?.busy || !connection.connected} onClick={() => act(retryRecoveredTask())}>Retry request</button><button onClick={dismissRecovery}>Dismiss</button></aside>}
    {open && <section className="agent-connection-menu" id="agent-connection-menu" aria-label="Agent connection">
      <button className="icon-button connection-close" aria-label="Close agent connection" onClick={() => setOpen(false)}><X size={14}/></button>
      <strong>{connection.connected ? profileName : 'Connect your agent'}</strong>
      {!connection.available ? <><p>Install or enable the BYOA extension, then reload this page.</p><a className="setup-link" href="https://github.com/adamgoth/bring-your-own-agent#readme" target="_blank" rel="noreferrer">BYOA setup ↗</a><p>In BYOA settings, add your provider, API key, and model.</p><button onClick={() => window.location.reload()}>Reload Margin</button></> : <>
        <p>{connecting ? 'Choose a profile in the BYOA window.' : connection.connected ? 'Connected to this site.' : 'BYOA will ask you to choose a profile and approve this site.'}</p>
        <button type="button" className="primary" disabled={connecting} onClick={()=>{
          setConnecting(true); setError('');
          void agentboard.connect().catch(error=>setError(error instanceof Error?error.message:String(error))).finally(()=>setConnecting(false));
        }}>{connecting?'Waiting for BYOA…':connection.connected?'Change profile':'Connect agent'}</button>
        <div className="agent-buttons"><button type="button" onClick={()=>act(agentboard.openSettings())}>Agent settings</button>{connection.connected && <><button type="button" onClick={()=>act(agentboard.openChat(task?.taskId))}>View agent chat</button><button type="button" onClick={()=>act(agentboard.disconnect())}>Disconnect</button></>}</div>
      </>}
      <p className="connection-privacy">Requests send writing to your chosen provider. Your API key stays in BYOA.</p>
      {error && <ErrorNotice title="Agent request failed" message={error}/>}
      {connection.error && <ErrorNotice title="Connection failed" message={connection.error}/>}
    </section>}
  </div>;
}
