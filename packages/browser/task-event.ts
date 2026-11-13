/** Additive public task contract. Never include transcript or provider diagnostics here. */
export type TaskCode =
  | 'budget'
  | 'timeout'
  | 'interrupted'
  | 'revoked'
  | 'tools-changed'
  | 'step-limit';
export type TaskUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageKnown: boolean;
};
export type TaskEvent = {
  /** The client stopped waiting; provider cancellation was not confirmed. */
  local?: true;
  usage?: TaskUsage;
  taskId: string;
  status: 'queued' | 'working' | 'done' | 'cancelled' | 'error';
  detail: string;
  busy: boolean;
  seq?: number;
  code?: TaskCode;
};
