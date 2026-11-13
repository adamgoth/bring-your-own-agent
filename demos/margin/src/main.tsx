import ReactDOM from 'react-dom/client';
import { AgentProvider } from '@byoagent/react';
import { agentSession } from './agentboard';
import '@byoagent/react/styles.css';
import App from './DocumentLibrary';
import './style.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<AgentProvider session={agentSession}><App /></AgentProvider>);
