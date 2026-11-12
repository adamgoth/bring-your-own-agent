/** Additive public task contract. Never include transcript or provider diagnostics here. */
export type TaskCode =
  | 'budget'
  | 'timeout'
  | 'interrupted'
  | 'revoked'
  | 'tools-changed'
  | 'step-limit';
export type TaskEvent = {
  taskId: string;
  status: 'queued' | 'working' | 'done' | 'cancelled' | 'error';
  detail: string;
  busy: boolean;
  seq?: number;
  code?: TaskCode;
};
