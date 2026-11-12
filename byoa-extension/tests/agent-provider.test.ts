import { expect, it, vi } from 'vitest';
import { createClient } from '../sdk/index';
const mock = vi.hoisted(() => ({
  getStatus: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  openSettings: vi.fn(),
  openChat: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  subscribe: vi.fn(),
  request: vi.fn(),
}));
vi.mock('../sdk/transport', () => ({ createTransport: () => mock }));
it('announces only on request with stable identity; routes the complete API and isolates event listeners', async () => {
  const announced = vi.fn();
  window.addEventListener('agent:announceProvider', announced);
  await import('../src/content-scripts/agent-provider');
  expect(announced).not.toHaveBeenCalled();
  expect(mock.subscribe).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('agent:requestProvider'));
  window.dispatchEvent(new Event('agent:requestProvider'));
  const detail = (announced.mock.calls[0][0] as CustomEvent).detail;
  expect((announced.mock.calls[1][0] as CustomEvent).detail).toBe(detail);
  expect(Object.isFrozen(detail)).toBe(true);
  expect(Object.isFrozen(detail.info)).toBe(true);
  expect(mock.subscribe).toHaveBeenCalledOnce();
  const provider = detail.provider;
  for (const [method, target, params, args] of [
    ['agent_status', mock.getStatus, undefined, []],
    ['agent_connect', mock.connect, undefined, []],
    ['agent_disconnect', mock.disconnect, undefined, []],
    ['agent_openSettings', mock.openSettings, undefined, []],
    ['agent_openChat', mock.openChat, { taskId: 'synthetic' }, ['synthetic']],
    ['agent_getTask', mock.getTask, { taskId: 'synthetic' }, ['synthetic']],
    ['agent_listTasks', mock.listTasks, undefined, []],
  ] as const) {
    await provider.request({ method, params });
    expect(target).toHaveBeenCalledWith(...args);
  }
  await expect(provider.request({ method: 'invalid' })).rejects.toMatchObject({ code: 4200 });
  const receive = vi.fn();
  const broken = () => {
    throw new Error('Synthetic listener failure');
  };
  provider.on('connectionChanged', broken);
  provider.on('connectionChanged', receive);
  mock.subscribe.mock.calls[0][0]({ connected: true });
  expect(receive).toHaveBeenCalledOnce();
  provider.removeListener('connectionChanged', receive);
  mock.subscribe.mock.calls[0][0]({ connected: false });
  expect(receive).toHaveBeenCalledOnce();
  const event = { taskId: 'synthetic', status: 'done', detail: 'Done', busy: false, seq: 1 };
  mock.request.mockResolvedValue({
    id: 'synthetic',
    events: {
      async *[Symbol.asyncIterator]() {
        yield event;
      },
    },
  });
  const taskListener = vi.fn();
  provider.on('task', taskListener);
  expect(
    await provider.request({
      method: 'agent_requestTask',
      params: {
        prompt: 'Synthetic',
        tools: ['read'],
        budget: { dollars: 100 },
        share: true,
        apiKey: 'synthetic-only',
      },
    })
  ).toEqual({ taskId: 'synthetic' });
  expect(mock.request).toHaveBeenCalledWith({
    prompt: 'Synthetic',
    tools: ['read'],
    timeoutMs: undefined,
  });
  await vi.waitFor(() => expect(taskListener).toHaveBeenCalledWith(event));
  const failure = (detail: string, code: string) => ({
    id: '',
    events: {
      async *[Symbol.asyncIterator]() {
        yield { taskId: '', status: 'error', detail, code, busy: false, seq: 1 };
      },
    },
  });
  mock.request
    .mockResolvedValueOnce(failure('First failure', 'timeout'))
    .mockResolvedValueOnce(failure('Second failure', 'revoked'));
  const client = createClient(provider);
  const [first, second] = await Promise.all([
    client.request({ prompt: 'First synthetic', tools: [] }),
    client.request({ prompt: 'Second synthetic', tools: [] }),
  ]);
  expect(first.id).toMatch(/^preflight:/);
  expect(second.id).not.toBe(first.id);
  const firstEvents = [];
  for await (const event of first.events) firstEvents.push(event);
  const secondEvents = [];
  for await (const event of second.events) secondEvents.push(event);
  expect(firstEvents.map((event) => event.detail)).toEqual(['First failure']);
  expect(secondEvents.map((event) => event.detail)).toEqual(['Second failure']);
  expect(first.retryable).toBe(true);
  expect(second.retryable).toBe(false);
  client.dispose();
  window.removeEventListener('agent:announceProvider', announced);
});
