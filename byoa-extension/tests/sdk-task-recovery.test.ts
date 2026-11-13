import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { TaskEvent } from '../../packages/browser/task-event';

describe('SDK task recovery contract', () => {
  let receive: (event: MessageEvent) => void;
  let posted: Mock<(message: unknown) => void>;
  const send = (data: object) =>
    receive({
      source: window,
      origin: window.location.origin,
      data: { source: 'agentboard:extension', version: 1, ...data },
    } as unknown as MessageEvent);
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(window, 'addEventListener').mockImplementation((name, listener) => {
      if (name === 'message') receive = listener as (event: MessageEvent) => void;
    });
    posted = vi.fn();
    vi.spyOn(window, 'postMessage').mockImplementation(posted);
  });
  afterEach(() => vi.restoreAllMocks());
  it('forwards a shorter timeout, derives retryability from the terminal event, and never retries itself', async () => {
    const { createTransport } = await import('../../packages/browser/transport');
    const agentboard = createTransport(window);
    const pending = agentboard.request({ prompt: 'Fixture', tools: ['read'], timeoutMs: 5000 });
    const request = posted.mock.calls[0][0] as { id: string; params: object };
    expect(request.params).toMatchObject({ timeoutMs: 5000 });
    const queued: TaskEvent = {
      taskId: 'task',
      status: 'queued',
      busy: true,
      detail: 'Queued',
      seq: 1,
    };
    send({ kind: 'task', id: request.id, event: queued });
    const task = await pending;
    expect(task.retryable).toBe(false);
    const terminal = { ...queued, status: 'error', busy: false, code: 'interrupted', seq: 2 };
    send({ kind: 'task', id: request.id, event: terminal });
    const received = [];
    for await (const event of task.events) received.push(event);
    expect(received).toEqual([queued, terminal]);
    expect(task.retryable).toBe(true);
    expect(posted).toHaveBeenCalledOnce();
    expect(task).not.toHaveProperty('retry');
  });
  it('supports read-only task and list lookups, unknown IDs, and code-derived retryability', async () => {
    const { createTransport } = await import('../../packages/browser/transport');
    const agentboard = createTransport(window);
    const answer = (value: unknown) => {
      const request = posted.mock.calls.at(-1)![0] as { id: string };
      send({ kind: 'response', id: request.id, ok: true, value });
    };
    const pending = agentboard.getTask('known');
    answer({
      taskId: 'known',
      status: 'error',
      detail: 'Timed out',
      busy: false,
      code: 'timeout',
      seq: 4,
    });
    expect(await pending).toMatchObject({ retryable: true, code: 'timeout' });
    const unknown = agentboard.getTask('unknown');
    answer(null);
    expect(await unknown).toBeNull();
    const list = agentboard.listTasks();
    answer([{ taskId: 'done', status: 'done', detail: 'Done', busy: false, seq: 2 }]);
    expect(await list).toEqual([expect.objectContaining({ retryable: false })]);
    expect(posted.mock.calls.map(([request]) => (request as { method: string }).method)).toEqual([
      'task',
      'task',
      'tasks',
    ]);
  });
});
