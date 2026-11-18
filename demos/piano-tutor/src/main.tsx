import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentProvider } from '@byoagent/react';
import { App } from './App';
import '@byoagent/react/styles.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AgentProvider>
      <App />
    </AgentProvider>
  </StrictMode>,
);
