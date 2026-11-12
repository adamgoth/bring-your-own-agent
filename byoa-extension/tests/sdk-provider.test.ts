import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, byoa, agentboard } from '../sdk/index';
import {
  discoverProviders,
  type AgentProvider,
  type ProviderDetail,
  type ProviderEvent,
} from '../sdk/provider';
import { createTransport } from '../sdk/transport';

const status = { available: true, configured: true, connected: true };
const terminal = { taskId: 'synthetic', status: 'done', detail: 'Done', busy: false, seq: 2 };
function fixture(uuid = 'synthetic-provider') {
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  const provider: AgentProvider = {
    request: vi.fn(async () => status),
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(listener);
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
    },
  };
  const emit = (event: ProviderEvent, value: unknown) => {
    for (const listener of listeners.get(event) || []) listener(value);
  };
  const detail: ProviderDetail = {
    info: {
      uuid,
      name: 'Synthetic provider',
      rdns: 'test.invalid',
      icon: 'data:image/png;base64,',
    },
    provider,
  };
  return { provider, detail, emit, listeners };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('request-only provider discovery', () => {
  it('is lazy and keeps the alias', () => {
    expect(byoa).toBe(agentboard);
  });
  it('handles zero, two, duplicate and late providers and removes its listener', async () => {
    vi.useFakeTimers();
    const a = fixture('a'),
      b = fixture('b');
    const respond = () => {
      for (const detail of [a.detail, b.detail, a.detail])
        window.dispatchEvent(new CustomEvent('agent:announceProvider', { detail }));
    };
    const remove = vi.spyOn(window, 'removeEventListener');
    expect(
      await (async () => {
        const promise = discoverProviders({ timeoutMs: 20 });
        await vi.advanceTimersByTimeAsync(20);
        return promise;
      })()
    ).toEqual([]);
    window.addEventListener('agent:requestProvider', respond);
    const found = discoverProviders({ timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    expect((await found).map((p) => p.info.uuid)).toEqual(['a', 'b']);
    expect(remove).toHaveBeenCalledWith('agent:announceProvider', expect.any(Function));
    window.removeEventListener('agent:requestProvider', respond);
  });
  it('finds a late provider and supports concurrent discovery windows', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const respond = () =>
      window.dispatchEvent(new CustomEvent('agent:announceProvider', { detail: f.detail }));
    const first = discoverProviders({ timeoutMs: 200 });
    const second = discoverProviders({ timeoutMs: 200 });
    await vi.advanceTimersByTimeAsync(75);
    window.addEventListener('agent:requestProvider', respond);
    await vi.advanceTimersByTimeAsync(125);
    expect(await first).toEqual([f.detail]);
    expect(await second).toEqual([f.detail]);
    window.removeEventListener('agent:requestProvider', respond);
  });
  it('rejects unsafe discovery delays and cleans up aborted discovery', async () => {
    await expect(discoverProviders({ timeoutMs: 1500 })).rejects.toThrow(RangeError);
    const controller = new AbortController();
    const result = discoverProviders({ signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toBeDefined();
  });
});
describe('SDK client', () => {
  it('buffers task events delivered before request resolution, deduplicates sequence and detaches', async () => {
    const f = fixture();
    f.provider.request = vi.fn(async ({ method }) => {
      if (method === 'agent_requestTask') {
        f.emit('task', { ...terminal, seq: 1, busy: true, status: 'working' });
        f.emit('task', terminal);
        return { taskId: 'synthetic' };
      }
      return status;
    });
    const client = createClient(f.provider);
    const task = await client.request({ prompt: 'Synthetic', tools: [] });
    const events = [];
    for await (const event of task.events) events.push(event);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    client.dispose();
    expect(f.listeners.get('task')?.size).toBe(0);
  });
  it('rejects uncorrelatable empty IDs instead of attributing another request failure', async () => {
    const f = fixture();
    f.provider.request = vi.fn(async () => {
      f.emit('task', { ...terminal, taskId: '', status: 'error', detail: 'Gesture required' });
      return { taskId: '' };
    });
    const client = createClient(f.provider);
    await expect(client.request({ prompt: 'Synthetic', tools: [] })).rejects.toMatchObject({
      code: -32603,
    });
    client.dispose();
  });
  it('aborts pending discovery on disposal and never attaches to a disposed client', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const respond = () =>
      window.dispatchEvent(new CustomEvent('agent:announceProvider', { detail: f.detail }));
    window.addEventListener('agent:requestProvider', respond);
    const on = vi.spyOn(f.provider, 'on');
    const client = createClient();
    const result = client.getStatus();
    client.dispose();
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toMatchObject({ available: false });
    expect(on).not.toHaveBeenCalled();
    await expect(client.connect()).rejects.toMatchObject({ code: 4900 });
    window.removeEventListener('agent:requestProvider', respond);
  });
  it('cancels if aborted during acknowledgement and forwards only task fields', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.provider.request = vi.fn(async ({ method }) => {
      if (method === 'agent_requestTask') {
        controller.abort();
        return { taskId: 'synthetic' };
      }
      return undefined;
    });
    const client = createClient(f.provider);
    await client.request({ prompt: 'Synthetic', tools: [], signal: controller.signal });
    expect(f.provider.request).toHaveBeenCalledWith({
      method: 'agent_cancelTask',
      params: { taskId: 'synthetic' },
    });
    client.dispose();
  });
  it('preserves summary-only recovery and failed request cleanup', async () => {
    const f = fixture();
    f.provider.request = vi.fn(async ({ method }) => {
      if (method === 'agent_getTask') return { ...terminal, code: 'interrupted' };
      throw new Error('synthetic failure');
    });
    const client = createClient(f.provider);
    expect(await client.getTask('synthetic')).toMatchObject({ retryable: true });
    await expect(client.request({ prompt: 'Synthetic', tools: [] })).rejects.toThrow(
      'synthetic failure'
    );
    client.dispose();
  });
});
describe('v1 transport adapter', () => {
  it('retries status until answered and preserves numeric errors', async () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const client = createTransport(window);
    const pending = client.getStatus();
    await vi.advanceTimersByTimeAsync(250);
    expect(post).toHaveBeenCalledTimes(2);
    const message = post.mock.calls[0][0];
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
          source: 'agentboard:extension',
          version: 1,
          kind: 'response',
          id: message.id,
          ok: true,
          value: status,
        },
      })
    );
    expect(await pending).toEqual(status);
    const settings = client.openSettings();
    const rejected = expect(settings).rejects.toMatchObject({ code: 4100 });
    const id = post.mock.calls.at(-1)?.[0].id;
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
          source: 'agentboard:extension',
          version: 1,
          kind: 'response',
          id,
          ok: false,
          error: 'Gesture required',
          code: 4100,
        },
      })
    );
    await rejected;
  });
});

it('bounds connect polling and cancels an outstanding loop on disconnect', async () => {
  vi.useFakeTimers();
  let polls = 0;
  vi.spyOn(window, 'postMessage').mockImplementation((message) => {
    if (message.source !== 'agentboard:page') return;
    const value =
      message.method === 'connect'
        ? { requestId: 'synthetic-approval' }
        : message.method === 'connectionResult'
          ? (polls++, { pending: true })
          : status;
    queueMicrotask(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: window.location.origin,
          data: {
            source: 'agentboard:extension',
            version: 1,
            kind: 'response',
            id: message.id,
            ok: true,
            value,
          },
        })
      )
    );
  });
  const client = createTransport(window);
  const expired = expect(client.connect()).rejects.toMatchObject({ code: 4001 });
  await vi.advanceTimersByTimeAsync(186000);
  await expired;
  const count = polls;
  await vi.advanceTimersByTimeAsync(1000);
  expect(polls).toBe(count);
  const cancelled = expect(client.connect()).rejects.toMatchObject({ code: 4001 });
  await vi.advanceTimersByTimeAsync(10);
  const disconnected = client.disconnect();
  await vi.advanceTimersByTimeAsync(0);
  await disconnected;
  await vi.advanceTimersByTimeAsync(500);
  await cancelled;
  const cancelledCount = polls;
  await vi.advanceTimersByTimeAsync(1000);
  expect(polls).toBe(cancelledCount);
});
