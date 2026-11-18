import { useRef, useState } from 'react';
import { AgentConnectionDialog, AgentIndicator } from '@byoagent/react';

/** BYOA connection status and dialog. Connecting enables the extension's floating voice mic here. */
export function AgentConnection() {
  const [open, setOpen] = useState(false);
  const indicator = useRef<HTMLButtonElement>(null);
  return (
    <>
      <AgentIndicator
        ref={indicator}
        className="agent-indicator"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="agent-connection"
        onClick={() => setOpen(true)}
      />
      <AgentConnectionDialog
        id="agent-connection"
        returnFocusRef={indicator}
        open={open}
        onOpenChange={setOpen}
        labels={{ privacy: 'Requests share what is on screen with your chosen provider. Your API key stays in BYOA.' }}
      />
    </>
  );
}
