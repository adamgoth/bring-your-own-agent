import { describe, expect, it } from 'vitest';
import { SiteTaskQueue } from '../src/background/site-task-queue';

const signal = () => new AbortController().signal;
describe('site task scheduler', () => {
  it('enforces global and profile limits, admitting the oldest eligible waiter', async () => {
    const queue = new SiteTaskQueue();
    const a1 = await queue.acquire(signal(), 'a');
    const a2 = await queue.acquire(signal(), 'a');
    const admitted: string[] = [];
    const a3 = queue.acquire(signal(), 'a').then((r) => {
      admitted.push('a3');
      return r;
    });
    const b1 = await queue.acquire(signal(), 'b');
    const b2 = queue.acquire(signal(), 'b').then((r) => {
      admitted.push('b2');
      return r;
    });
    await Promise.resolve();
    expect(admitted).toEqual([]);
    a1();
    const releaseA3 = await a3;
    expect(admitted).toEqual(['a3']);
    a1(); // idempotent: no extra slot
    await Promise.resolve();
    expect(admitted).toEqual(['a3']);
    b1();
    (await b2)();
    expect(admitted).toEqual(['a3', 'b2']);
    a2();
    releaseA3();
  });
  it('removes aborted waiters and preserves successors', async () => {
    const queue = new SiteTaskQueue();
    const releases = await Promise.all([
      queue.acquire(signal(), 'a'),
      queue.acquire(signal(), 'a'),
    ]);
    const cancelled = new AbortController();
    const rejection = expect(queue.acquire(cancelled.signal, 'a')).rejects.toThrow(
      'cancelled while queued'
    );
    let entered = false;
    const last = queue.acquire(signal(), 'a').then((r) => {
      entered = true;
      return r;
    });
    cancelled.abort();
    await rejection;
    expect(entered).toBe(false);
    releases[0]();
    (await last)();
    releases[1]();
    await expect(queue.acquire(cancelled.signal, 'b')).rejects.toThrow('cancelled while queued');
  });
});
