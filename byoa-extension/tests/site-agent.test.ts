import { beforeEach, describe, expect, it, vi } from 'vitest';
import { siteConnectionKey } from '../src/lib/site-grant';
import { createSiteAgentHandler } from '../src/background/site-agent';
import type { AIClient, StreamCallbacks } from '../src/lib/ai/client';
import type { ConfigStorage } from '../src/lib/storage/config';

const SITE_CONNECTION_KEY = siteConnectionKey('http://localhost:5183');

function harness() {
  const streamChat = vi.fn().mockResolvedValue(undefined);
  const cancelStream = vi.fn();
  const getAgent = vi
    .fn()
    .mockResolvedValue({ id: 'configured', name: 'API test', apiKey: 'fixture-only-key' });
  const prepare = vi.fn().mockResolvedValue(undefined);
  const listener = createSiteAgentHandler(
    { streamChat, cancelStream } as unknown as AIClient,
    {
      getAgent,
      getAgents: vi.fn().mockImplementation(async () => {
        const agent = await getAgent();
        return agent ? [agent] : [];
      }),
    } as unknown as ConfigStorage,
    prepare
  );
  const connect = (url = 'http://localhost:5183/', tabId = 7) => {
    let receive: (msg: object) => void = () => {};
    let disconnect: () => void = () => {};
    const port = {
      name: 'agentboard-task',
      sender: { url, frameId: 0, tab: { id: tabId } },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener: (fn: typeof receive) => {
          receive = fn;
        },
      },
      onDisconnect: {
        addListener: (fn: typeof disconnect) => {
          disconnect = fn;
        },
      },
    };
    listener(port as unknown as chrome.runtime.Port);
    return { port, send: (msg: object) => receive(msg), close: () => disconnect() };
  };
  return { streamChat, cancelStream, getAgent, prepare, connect };
}

describe('Site background tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      chrome.storage.session.get as (keys: string) => Promise<Record<string, unknown>>
    ).mockResolvedValue({ [SITE_CONNECTION_KEY]: { agentId: 'configured' } });
  });
  it('cancels a running task when Options revokes its persistent grant', async () => {
    const grant = { agentId: 'configured', persist: 'forever', createdAt: Date.now() };
    vi.mocked(
      chrome.storage.local.get as (keys: string) => Promise<Record<string, unknown>>
    ).mockResolvedValue({ [SITE_CONNECTION_KEY]: grant });
    vi.mocked(
      chrome.storage.session.get as (keys: string) => Promise<Record<string, unknown>>
    ).mockResolvedValue({});
    const h = harness();
    const p = h.connect();
    p.send({ type: 'start', tools: ['get_selection'], text: 'One' });
    await vi.waitFor(() => expect(h.streamChat).toHaveBeenCalledOnce());
    vi.mocked(
      chrome.storage.local.get as (keys: string) => Promise<Record<string, unknown>>
    ).mockResolvedValue({});
    const changed = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)![0];
    changed({ [SITE_CONNECTION_KEY]: { oldValue: grant } }, 'local');
    await vi.waitFor(() =>
      expect(h.cancelStream).toHaveBeenCalledWith(h.streamChat.mock.calls[0][4])
    );
    expect(p.port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'cancelled' })
    );
  });
  it('uses the chosen profile with a restricted tool list, reports progress, and never opens the sidebar', async () => {
    const h = harness();
    const p = h.connect();
    p.send({
      type: 'start',
      tools: ['get_selection', 'propose_replacement'],
      text: 'Rewrite this sample',
      agentId: 'page-chosen-agent',
    });
    await vi.waitFor(() => expect(h.streamChat).toHaveBeenCalledOnce());
    const args = h.streamChat.mock.calls[0];
    expect(args[0]).toBe('configured');
    expect(args[2]).toBe(7);
    expect(args[5]).toBeUndefined();
    expect(args[6]).toEqual(
      expect.objectContaining({
        tools: ['get_selection', 'propose_replacement'],
        share: { persona: false, user: false, memory: false },
      })
    );
    const callbacks = args[3] as StreamCallbacks;
    callbacks.onToolCall?.({
      id: 'tool',
      toolName: 'propose_replacement',
      input: {},
      status: 'running',
      startTime: Date.now(),
    });
    expect(p.port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ busy: true, detail: 'Using propose_replacement…' })
    );
    callbacks.onFinish('Suggestion ready');
    expect(p.port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'done',
        detail: 'Task finished. Review changes in the app.',
        busy: false,
      })
    );
    await vi.waitFor(() =>
      expect(chrome.storage.session.set).toHaveBeenCalledWith(
        expect.objectContaining({
          [Object.keys(vi.mocked(chrome.storage.session.set).mock.calls.at(-1)![0])[0]]:
            expect.objectContaining({
              prompt: 'Rewrite this sample',
              response: 'Suggestion ready',
              status: 'done',
            }),
        })
      )
    );
    p.close();
  });
  it('requires a site connection before starting and cancels when disconnected', async () => {
    const h = harness();
    vi.mocked(
      chrome.storage.session.get as (keys: string) => Promise<Record<string, unknown>>
    ).mockResolvedValue({});
    const blocked = h.connect();
    blocked.send({ type: 'start', tools: ['get_selection', 'propose_replacement'], text: 'One' });
    await vi.waitFor(() =>
      expect(blocked.port.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'error',
          detail: 'Connect your API agent to this site first.',
        })
      )
    );
    expect(h.streamChat).not.toHaveBeenCalled();
    blocked.close();
    vi.mocked(
      chrome.storage.session.get as (keys: string) => Promise<Record<string, unknown>>
    ).mockResolvedValue({ [SITE_CONNECTION_KEY]: { agentId: 'configured' } });
    const running = h.connect();
    running.send({ type: 'start', tools: ['get_selection', 'propose_replacement'], text: 'Two' });
    await vi.waitFor(() => expect(h.streamChat).toHaveBeenCalledOnce());
    const changed = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)![0];
    vi.mocked(
      chrome.storage.session.get as (keys: string) => Promise<Record<string, unknown>>
    ).mockResolvedValue({ [SITE_CONNECTION_KEY]: false });
    changed({ [SITE_CONNECTION_KEY]: { newValue: false } }, 'session');
    await vi.waitFor(() =>
      expect(h.cancelStream).toHaveBeenCalledWith(h.streamChat.mock.calls[0][4])
    );
    expect(h.cancelStream).toHaveBeenCalledWith(h.streamChat.mock.calls[0][4]);
    expect(running.port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'cancelled' })
    );
    running.close();
  });
  it('drops senders that are not eligible to connect', () => {
    const h = harness();
    for (const url of ['http://example.com/', 'http://192.168.1.10:5183/', 'file:///tmp/app.html'])
      expect(h.connect(url).port.disconnect).toHaveBeenCalledOnce();
    expect(h.streamChat).not.toHaveBeenCalled();
  });
  it('keeps approvals per exact origin, so another eligible site cannot use one', async () => {
    const h = harness();
    // Only http://localhost:5183 holds a grant (see beforeEach).
    for (const url of [
      'https://example.com/',
      'http://localhost:5185/',
      'http://127.0.0.1:5183/',
    ]) {
      const other = h.connect(url);
      expect(other.port.disconnect).not.toHaveBeenCalled();
      other.send({ type: 'start', tools: ['get_selection'], text: 'Spend my credits' });
      await vi.waitFor(() =>
        expect(other.port.postMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({
            status: 'error',
            detail: 'Connect your API agent to this site first.',
          })
        )
      );
      other.close();
    }
    expect(h.streamChat).not.toHaveBeenCalled();
  });
  it('rejects duplicate starts and concurrent tasks on one tab, and cancels only its own stream', async () => {
    const h = harness();
    const p = h.connect();
    p.send({ type: 'start', tools: ['get_selection', 'propose_replacement'], text: 'One' });
    p.send({ type: 'start', tools: ['get_selection', 'propose_replacement'], text: 'Duplicate' });
    await vi.waitFor(() => expect(h.streamChat).toHaveBeenCalledOnce());
    const other = h.connect();
    other.send({ type: 'start', tools: ['get_selection', 'propose_replacement'], text: 'Other' });
    expect(other.port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'error' })
    );
    p.send({ type: 'cancel' });
    expect(h.cancelStream).toHaveBeenCalledWith(h.streamChat.mock.calls[0][4]);
    expect(p.port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'cancelled', busy: false })
    );
    p.close();
    other.close();
  });
  it('does not start a request cancelled during preparation', async () => {
    const h = harness();
    let release!: () => void;
    h.prepare.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const p = h.connect();
    p.send({ type: 'start', tools: ['get_selection', 'propose_replacement'], text: 'One' });
    await vi.waitFor(() => expect(h.prepare).toHaveBeenCalledOnce());
    p.close();
    release();
    await Promise.resolve();
    expect(h.streamChat).not.toHaveBeenCalled();
  });
  it('reports missing configuration and provider errors without exposing provider error details', async () => {
    const h = harness();
    h.getAgent.mockResolvedValueOnce(null);
    const p = h.connect();
    p.send({ type: 'start', tools: ['get_selection', 'propose_replacement'], text: 'One' });
    await vi.waitFor(() =>
      expect(p.port.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'error' })
      )
    );
    expect(h.streamChat).not.toHaveBeenCalled();
    p.close();
    const q = h.connect();
    q.send({ type: 'start', tools: ['get_selection', 'propose_replacement'], text: 'Two' });
    await vi.waitFor(() => expect(h.streamChat).toHaveBeenCalledOnce());
    (h.streamChat.mock.calls[0][3] as StreamCallbacks).onError(new Error('SECRET'));
    expect(JSON.stringify(q.port.postMessage.mock.calls)).not.toContain('SECRET');
    q.close();
  });
  it.each([{ agentId: 'different-profile' }, { agentId: 'configured', share: { persona: true } }])(
    'cancels this site task when the grant changes: %j',
    async (grant) => {
      const h = harness();
      const p = h.connect();
      p.send({ type: 'start', tools: ['get_selection'], text: 'Read my selection' });
      await vi.waitFor(() => expect(h.streamChat).toHaveBeenCalledOnce());
      const changed = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)![0];
      vi.mocked(
        chrome.storage.session.get as (keys: string) => Promise<Record<string, unknown>>
      ).mockResolvedValue({ [SITE_CONNECTION_KEY]: grant });
      changed({ [SITE_CONNECTION_KEY]: { newValue: grant } }, 'session');
      await vi.waitFor(() => expect(h.cancelStream).toHaveBeenCalled());
      expect(h.cancelStream).toHaveBeenCalledWith(h.streamChat.mock.calls[0][4]);
      expect(p.port.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'cancelled', busy: false })
      );
      p.close();
    }
  );
});
