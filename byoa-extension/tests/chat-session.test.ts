import { LocalEndpointAccessError } from '../src/lib/ai/local-endpoint-error';
import { describe, expect, it, vi } from 'vitest';
import { sidebarSessionTab } from '../src/background/chat-session';
import { CHAT_SESSION_PREFIX, type ChatSessionSnapshot } from '../src/lib/chat-session';
import { harness, submit, finish, stored } from './helpers/chat-session';

describe('background-owned chat sessions', () => {
  it.each([true, false])('only exposes trusted local endpoint feedback (%s)', async (trusted) => {
    const h = harness();
    const p = h.connect();
    await p.ready();
    await p.send(submit());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    h.calls[0].callbacks.onError(
      trusted ? new LocalEndpointAccessError() : new Error('secret provider body')
    );
    h.calls[0].release();
    await vi.waitFor(() =>
      expect((stored[`${CHAT_SESSION_PREFIX}1`] as ChatSessionSnapshot).turns[0].status).toBe(
        'error'
      )
    );
    const data = JSON.stringify(stored);
    expect(data).not.toContain('secret provider body');
    expect(data.includes('OLLAMA_ORIGINS')).toBe(trusted);
  });

  it('continues with no sidebar and replays without repeating model work', async () => {
    const h = harness();
    const first = h.connect();
    await first.ready();
    await first.send(submit());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    h.calls[0].callbacks.onTextBlockStart?.('block');
    h.calls[0].callbacks.onTextBlockChunk?.('block', 'Partial');
    first.close();
    expect(h.client.cancelStream).not.toHaveBeenCalled();
    const second = h.connect();
    await second.ready();
    const snapshot = second.updates.find((u) => u.type === 'snapshot')!;
    expect(JSON.stringify(snapshot)).toContain('Partial');
    expect(h.client.streamChat).toHaveBeenCalledTimes(1);
    h.calls[0].callbacks.onTextBlockChunk?.('block', ' answer');
    await finish(h, 0, 'Partial answer');
    await second.send(submit('followup', 'a', 'Explain that'));
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    expect(JSON.stringify(h.calls[1].args[1])).toContain('Partial answer');
    await finish(h, 1);
  });
  it('preserves history across agent switches but invalidates workspace and skips continuation', async () => {
    const h = harness();
    const p = h.connect();
    await p.ready();
    await p.send(submit());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    await p.send({ type: 'select', agentId: 'b' });
    h.calls[0].callbacks.onWorkspaceContext?.({ agentId: 'a', state: 'unmounted' });
    expect(h.client.cancelStream).not.toHaveBeenCalled();
    h.calls[0].callbacks.onFinish('From A', { toolsChanged: true, stepsExhausted: false });
    h.calls[0].release();
    await vi.waitFor(() =>
      expect((stored[`${CHAT_SESSION_PREFIX}1`] as ChatSessionSnapshot).turns[0].status).toBe(
        'done'
      )
    );
    await p.send(submit('second', 'b'));
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    expect(h.calls[1].args[0]).toBe('b');
    expect(h.calls[1].args[5]).toBeUndefined();
    expect(JSON.stringify(h.calls[1].args[1])).toContain('From A');
    await finish(h, 1);
  });
  it('retains partial tool history on stop, ignores late callbacks and stale cancellation', async () => {
    const h = harness();
    const p = h.connect();
    await p.ready();
    await p.send(submit());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    h.calls[0].callbacks.onToolCall?.({
      id: 'tool1',
      toolName: 'read_page',
      input: {},
      source: 'agentboard',
      status: 'running',
      startTime: 1,
    });
    await p.send({ type: 'cancel', turnId: 'turn-1' });
    h.calls[0].callbacks.onTextBlockChunk?.('block', 'LATE');
    await p.send(submit('second'));
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    const history = JSON.stringify(h.calls[1].args[1]);
    expect(history).toContain('tool-result');
    expect(history).toContain('interrupted');
    expect(history).not.toContain('LATE');
    await p.send({ type: 'cancel', turnId: 'turn-1' });
    expect(h.client.cancelStream).toHaveBeenCalledTimes(1);
    await finish(h, 1);
  });
  it('clears while preparing and prevents old callbacks from restoring cleared turns', async () => {
    let release!: () => void;
    const h = harness(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const p = h.connect();
    await p.ready();
    await p.send(submit());
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await p.send({ type: 'clear' });
    release();
    await vi.waitFor(() =>
      expect((stored[`${CHAT_SESSION_PREFIX}1`] as ChatSessionSnapshot).turns).toEqual([])
    );
    expect(h.client.streamChat).not.toHaveBeenCalled();
  });
  it('deduplicates submission and refuses concurrent turns in the same conversation', async () => {
    const h = harness();
    const p = h.connect();
    await p.ready();
    await p.send(submit());
    expect((await p.send(submit())).error).toBeUndefined();
    expect((await p.send(submit('other'))).error).toContain('running');
    expect(h.client.streamChat).toHaveBeenCalledTimes(1);
    await finish(h);
  });
  it('recovers worker interruption without retry and preserves completed tools', async () => {
    stored[`${CHAT_SESSION_PREFIX}1`] = {
      version: 1,
      tabId: 1,
      incognito: false,
      selectedAgentId: 'a',
      revision: 1,
      turns: [
        {
          id: 'old',
          agentId: 'a',
          agentName: 'A',
          status: 'working',
          events: [],
          messages: [
            {
              id: 'm',
              role: 'assistant',
              content: 'Partial',
              timestamp: 1,
              toolCalls: [
                {
                  id: 'tool',
                  toolName: 'change',
                  status: 'success',
                  input: {},
                  output: 'Changed',
                  startTime: 1,
                },
              ],
            },
          ],
        },
      ],
    };
    const h = harness();
    const p = h.connect();
    await p.ready();
    const data = stored[`${CHAT_SESSION_PREFIX}1`] as ChatSessionSnapshot;
    expect(data.turns[0].status).toBe('error');
    expect(data.turns[0].messages[0].toolCalls?.[0].status).toBe('success');
    expect(JSON.stringify(data)).toContain('BYOA restarted');
    expect(h.client.streamChat).not.toHaveBeenCalled();
  });
  it('performs automatic continuations in the background with tool history', async () => {
    const h = harness();
    const p = h.connect();
    await p.ready();
    await p.send(submit());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    p.close();
    h.calls[0].callbacks.onToolCall?.({
      id: 'tool',
      toolName: 'example',
      input: {},
      status: 'running',
      startTime: 1,
      source: 'webmcp',
    });
    h.calls[0].callbacks.onToolResult?.({
      id: 'tool',
      output: 'untrusted text',
      status: 'success',
    });
    h.calls[0].callbacks.onFinish('Progress', { toolsChanged: true, stepsExhausted: false });
    h.calls[0].release();
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    expect(JSON.stringify(h.calls[1].args[1])).toContain('[output not retained]');
    expect(JSON.stringify(h.calls[1].args[1])).not.toContain('untrusted text');
    await finish(h, 1);
  });
  it('refuses page-origin subscriptions and invalid message content', async () => {
    const h = harness();
    const evil = h.connect(1, 'https://example.test/#tab=1');
    expect(evil.port.disconnect).toHaveBeenCalledOnce();
    expect(
      sidebarSessionTab({ id: 'other', url: chrome.runtime.getURL('src/sidebar/index.html#tab=1') })
    ).toBeNull();
    const p = h.connect();
    await p.ready();
    expect(
      (
        await p.send({
          ...submit(),
          content: [{ type: 'image', image: 'https://evil.test/image' }],
        })
      ).error
    ).toBe('Invalid chat message.');
    expect(h.client.streamChat).not.toHaveBeenCalled();
  });
  it('rejects oversized input before calling a provider', async () => {
    const h = harness();
    const p = h.connect();
    await p.ready();
    expect((await p.send(submit('large', 'a', 'x'.repeat(3_000_000)))).error).toContain(
      'storage limit'
    );
    expect(h.client.streamChat).not.toHaveBeenCalled();
  });
  it('does not persist workspace bootstrap and invalidates it on binding changes', async () => {
    const h = harness();
    const p = h.connect();
    await p.ready();
    await p.send(submit());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    const context = {
      agentId: 'a',
      state: 'mounted' as const,
      identity: 'PRIVATE BOOTSTRAP',
      soul: null,
      user: null,
      agents: null,
      memory: '',
    };
    h.calls[0].callbacks.onWorkspaceContext?.(context);
    await finish(h);
    expect(JSON.stringify(stored)).not.toContain('PRIVATE BOOTSTRAP');
    await p.send(submit('second'));
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    expect(h.calls[1].args[5]).toEqual(context);
    await finish(h, 1);
    h.service.invalidateWorkspace('a');
    await p.send(submit('third'));
    await vi.waitFor(() => expect(h.calls).toHaveLength(3));
    expect(h.calls[2].args[5]).toBeUndefined();
    await finish(h, 2);
  });
});

it('keeps regular/private conversations isolated and removes session data with its tab', async () => {
  const h = harness();
  const regular = h.connect();
  await regular.ready();
  await regular.send(submit());
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  await finish(h);
  chrome.tabs.get = vi
    .fn()
    .mockImplementation(async (id) => ({ id, incognito: id === 2, url: 'https://example.test/' }));
  const privateView = h.connect(2);
  await privateView.ready();
  const snapshot = privateView.updates.find((u) => u.type === 'snapshot');
  expect(snapshot).toMatchObject({ snapshot: { incognito: true, turns: [] } });
  await h.service.removeTab(1);
  expect(stored[`${CHAT_SESSION_PREFIX}1`]).toBeUndefined();
  expect(stored[`${CHAT_SESSION_PREFIX}2`]).toBeDefined();
});

it('shares accepted turns with two views and cancelling from either stops the same run', async () => {
  const h = harness();
  const a = h.connect();
  const b = h.connect();
  await Promise.all([a.ready(), b.ready()]);
  await a.send(submit());
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  expect(b.updates.some((u) => u.type === 'turn' && u.turn.id === 'turn-1')).toBe(true);
  expect((await b.send(submit('other'))).error).toContain('running');
  await b.send({ type: 'cancel', turnId: 'turn-1' });
  expect(a.updates).toContainEqual({ type: 'status', turnId: 'turn-1', status: 'cancelled' });
});

it('stops a detached turn when its profile is removed', async () => {
  const h = harness();
  const p = h.connect();
  await p.ready();
  await p.send(submit());
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  p.close();
  h.service.reconcileAgents(new Set());
  await vi.waitFor(() =>
    expect((stored[`${CHAT_SESSION_PREFIX}1`] as ChatSessionSnapshot).turns[0].status).toBe(
      'cancelled'
    )
  );
  expect(h.client.cancelStream).toHaveBeenCalledOnce();
});

it('fails closed before provider submission when session persistence fails', async () => {
  const h = harness();
  const p = h.connect();
  await p.ready();
  chrome.storage.session.set = vi.fn().mockRejectedValue(new Error('QUOTA_BYTES'));
  expect((await p.send(submit())).error).toContain('No request was sent');
  expect(h.client.streamChat).not.toHaveBeenCalled();
});

it('marks a late final-storage failure visibly instead of claiming the response was saved', async () => {
  const h = harness();
  const p = h.connect();
  await p.ready();
  await p.send(submit());
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  chrome.storage.session.set = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
  h.calls[0].callbacks.onFinish('Unsaved answer');
  h.calls[0].release();
  await vi.waitFor(() => expect(JSON.stringify(p.updates)).toContain('Chat could not be saved'));
});

it('interrupts oversized output without silently replacing earlier history', async () => {
  const h = harness();
  const p = h.connect();
  await p.ready();
  await p.send(submit());
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  h.calls[0].callbacks.onTextBlockStart?.('text');
  h.calls[0].callbacks.onTextBlockChunk?.('text', 'Useful partial answer');
  h.calls[0].callbacks.onTextBlockChunk?.('text', 'x'.repeat(2_000_000));
  await vi.waitFor(() =>
    expect((stored[`${CHAT_SESSION_PREFIX}1`] as ChatSessionSnapshot).turns[0].status).toBe(
      'cancelled'
    )
  );
  expect(JSON.stringify(stored)).toContain('Useful partial answer');
  expect(JSON.stringify(stored)).toContain('storage limit reached');
});

it('allows Clear to free space when other session data is above the allocation guard', async () => {
  const h = harness();
  const p = h.connect();
  await p.ready();
  await p.send(submit());
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  await finish(h);
  stored.otherFeature = 'x'.repeat(8_000_000);
  expect((await p.send({ type: 'clear' })).error).toBeUndefined();
  expect((stored[`${CHAT_SESSION_PREFIX}1`] as ChatSessionSnapshot).turns).toEqual([]);
});
