import type { ChatMessage, MessageContent, ToolCall } from '../types';

export type ChatEvent =
  | { type: 'text-start'; id: string }
  | { type: 'text'; text: string }
  | { type: 'text-end' }
  | { type: 'reasoning-start' }
  | { type: 'reasoning'; text: string }
  | { type: 'reasoning-end'; usage?: { reasoningTokens: number } }
  | { type: 'tool'; tool: ToolCall }
  | { type: 'result'; id: string; output: unknown; status: 'success' | 'error'; error?: string }
  | { type: 'notice'; text: string };

export interface ChatTurn {
  id: string;
  agentId: string;
  agentName: string;
  messages: ChatMessage[];
  events: ChatEvent[];
  status: 'working' | 'done' | 'cancelled' | 'error';
}

export interface ChatSessionSnapshot {
  version: 1;
  tabId: number;
  incognito: boolean;
  selectedAgentId?: string;
  turns: ChatTurn[];
  revision: number;
}

export type ChatSessionCommand =
  | { type: 'submit'; requestId: string; id: string; agentId: string; content: MessageContent }
  | { type: 'select'; requestId: string; agentId: string }
  | { type: 'cancel'; requestId: string; turnId: string }
  | { type: 'clear'; requestId: string };

export type ChatSessionUpdate =
  | { type: 'unavailable'; error: string }
  | { type: 'snapshot'; snapshot: ChatSessionSnapshot }
  | { type: 'turn'; turn: ChatTurn }
  | { type: 'event'; turnId: string; event: ChatEvent }
  | { type: 'status'; turnId: string; status: ChatTurn['status'] }
  | { type: 'selected'; agentId: string }
  | { type: 'reply'; requestId: string; error?: string };

export const CHAT_SESSION_PORT = 'chat-session';
export const CHAT_SESSION_PREFIX = 'byoa_chat_session_';
