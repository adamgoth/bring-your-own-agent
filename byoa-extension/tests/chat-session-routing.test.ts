import { describe, expect, it, vi } from 'vitest';
import { CHAT_SESSION_PREFIX, type ChatSessionSnapshot } from '../src/lib/chat-session';
import { harness, submit, finish, stored } from './helpers/chat-session';

/** The routing option is streamChat's eighth argument. */
const routingOf = (h: ReturnType<typeof harness>, index: number) =>
  (h.calls[index].args[7] as { sessionId?: string } | undefined)?.sessionId;
const snapshot = (tabId = 1) => stored[`${CHAT_SESSION_PREFIX}${tabId}`] as ChatSessionSnapshot;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('sidebar conversation routing session', () => {
  it('keeps one opaque key across follow-ups, continuations, and agent switches', async () => {
    const h = harness();
    const p = h.connect();
    await p.ready();
    await p.send(submit('turn-1', 'a', 'Private prompt text'));
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    const sessionId = routingOf(h, 0)!;
    expect(sessionId).toMatch(UUID);
    expect(snapshot().routingSessionId).toBe(sessionId);

    // An automatic continuation inside the same turn reuses the key.
    h.calls[0].callbacks.onFinish('Progress', { toolsChanged: true, stepsExhausted: false });
    h.calls[0].release();
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    expect(routingOf(h, 1)).toBe(sessionId);
    await finish(h, 1);

    // A follow-up turn reuses it.
    await p.send(submit('turn-2', 'a', 'Explain that'));
    await vi.waitFor(() => expect(h.calls).toHaveLength(3));
    expect(routingOf(h, 2)).toBe(sessionId);
    await finish(h, 2);

    // Switching agents continues the same conversation, so the key stays. OpenRouter scopes
    // stickiness per model, so a different model cannot inherit the other model's provider.
    await p.send({ type: 'select', agentId: 'b' });
    await p.send(submit('turn-3', 'b'));
    await vi.waitFor(() => expect(h.calls).toHaveLength(4));
    expect(h.calls[3].args[0]).toBe('b');
    expect(routingOf(h, 3)).toBe(sessionId);
    await finish(h, 3);

    // The key carries no page URL, title, or prompt text.
    expect(sessionId).not.toContain('example.test');
    expect(sessionId).not.toContain('Private');
  });

  it('rotates the key when Clear starts a new conversation', async () => {
    const h = harness();
    const p = h.connect();
    await p.ready();
    await p.send(submit());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    const before = routingOf(h, 0)!;
    await finish(h, 0);
    await p.send({ type: 'clear' });
    expect(snapshot().routingSessionId).toMatch(UUID);
    expect(snapshot().routingSessionId).not.toBe(before);
    await p.send(submit('turn-2'));
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    expect(routingOf(h, 1)).toBe(snapshot().routingSessionId);
    expect(routingOf(h, 1)).not.toBe(before);
    await finish(h, 1);
  });

  it('gives separate tabs separate conversations', async () => {
    const h = harness();
    const one = h.connect(1);
    const two = h.connect(2);
    await one.ready();
    await two.ready();
    expect(snapshot(1).routingSessionId).toMatch(UUID);
    expect(snapshot(2).routingSessionId).toMatch(UUID);
    expect(snapshot(1).routingSessionId).not.toBe(snapshot(2).routingSessionId);
  });

  it('keeps the key when a conversation is restored after a worker restart or interruption', async () => {
    const first = harness();
    const p = first.connect();
    await p.ready();
    await p.send(submit());
    await vi.waitFor(() => expect(first.calls).toHaveLength(1));
    const sessionId = routingOf(first, 0);
    // The worker dies mid-turn: a fresh service restores from session storage.
    const restarted = harness();
    const q = restarted.connect();
    await q.ready();
    expect(snapshot().turns[0].status).toBe('error');
    expect(snapshot().routingSessionId).toBe(sessionId);
    await q.send(submit('turn-2'));
    await vi.waitFor(() => expect(restarted.calls).toHaveLength(1));
    expect(routingOf(restarted, 0)).toBe(sessionId);
    await finish(restarted, 0);
  });

  it('assigns a key to a conversation saved before routing keys existed', async () => {
    stored[`${CHAT_SESSION_PREFIX}1`] = {
      version: 1,
      tabId: 1,
      incognito: false,
      revision: 1,
      turns: [],
    };
    const h = harness();
    const p = h.connect();
    await p.ready();
    const assigned = snapshot().routingSessionId;
    expect(assigned).toMatch(UUID);
    await p.send(submit());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    expect(routingOf(h, 0)).toBe(assigned);
    await finish(h, 0);
  });

  it('replaces a malformed stored key instead of sending it', async () => {
    stored[`${CHAT_SESSION_PREFIX}1`] = {
      version: 1,
      tabId: 1,
      incognito: false,
      revision: 1,
      turns: [],
      routingSessionId: 'https://example.test/page?user=someone@example.test',
    };
    const h = harness();
    const p = h.connect();
    await p.ready();
    expect(snapshot().routingSessionId).toMatch(UUID);
  });
});
