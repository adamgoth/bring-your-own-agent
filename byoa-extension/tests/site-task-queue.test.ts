import { describe, expect, it } from 'vitest';
import { SiteTaskQueue } from '../src/background/site-task-queue';

describe('page task queue', () => {
  it('serializes tasks in order and makes release idempotent', async () => {
    const queue = new SiteTaskQueue();
    const signal = new AbortController().signal;
    const first = await queue.acquire(signal);
    const admitted: number[] = [];
    const second = queue.acquire(signal).then((release) => {
      admitted.push(2);
      return release;
    });
    const third = queue.acquire(signal).then((release) => {
      admitted.push(3);
      return release;
    });
    await Promise.resolve();
    expect(admitted).toEqual([]);
    first();
    const releaseSecond = await second;
    first();
    await Promise.resolve();
    expect(admitted).toEqual([2]);
    releaseSecond();
    (await third)();
    expect(admitted).toEqual([2, 3]);
  });
  it('cancels a queued task without disturbing the running task or its successor', async () => {
    const queue = new SiteTaskQueue();
    const first = await queue.acquire(new AbortController().signal);
    const cancelled = new AbortController();
    const rejection = expect(queue.acquire(cancelled.signal)).rejects.toThrow(
      'cancelled while queued'
    );
    let entered = false;
    const last = queue.acquire(new AbortController().signal).then((release) => {
      entered = true;
      return release;
    });
    cancelled.abort();
    await rejection;
    expect(entered).toBe(false);
    first();
    (await last)();
    expect(entered).toBe(true);
  });
});
