/** Experimental page client. Tool definitions and execution remain owned by WebMCP. */
export type Connection = {
  available: boolean;
  configured: boolean;
  connected: boolean;
  agentId?: string;
  agentName?: string;
  error?: string;
};
export type Profile = { id: string; name: string; ready: boolean };
export type ProfileList = { profiles: Profile[]; defaultAgentId?: string };
import type { TaskEvent } from './task-event.js';
export type { TaskEvent, TaskCode, TaskUsage } from './task-event.js';
export type TaskSummary = TaskEvent & { retryable: boolean };
export type AgentTask = {
  id: string;
  readonly retryable: boolean;
  events: AsyncIterable<TaskEvent>;
  cancel(): void;
  openChat(): Promise<void>;
};
