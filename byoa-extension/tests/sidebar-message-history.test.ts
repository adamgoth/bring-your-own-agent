import { expect, it, vi } from 'vitest';
import { harness, submit, finish } from './helpers/chat-session';

it('preserves earlier page identity while collecting the current page for a follow-up', async () => {
  const h = harness();
  const p = h.connect();
  await p.ready();
  await p.send(submit('first', 'a', 'First page'));
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  await finish(h);
  chrome.tabs.get = vi
    .fn()
    .mockResolvedValue({ id: 1, url: 'https://other.test/new', title: 'New page' });
  await p.send(submit('second', 'a', 'Second page'));
  await vi.waitFor(() => expect(h.calls).toHaveLength(2));
  const messages = h.calls[1].args[1] as Array<{ role: string; content: string }>;
  expect(messages[0].content).toContain('https://example.test/1');
  expect(messages[0].content).not.toContain('https://other.test/new');
  expect(messages.at(-1)?.content).toContain('https://other.test/new');
  await finish(h, 1);
});

it('keeps status notices out of model history after cancellation and clearing', async () => {
  const h = harness();
  const p = h.connect();
  await p.ready();
  await p.send(submit());
  await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  await p.send({ type: 'cancel', turnId: 'turn-1' });
  await p.send(submit('second'));
  await vi.waitFor(() => expect(h.calls).toHaveLength(2));
  expect(JSON.stringify(h.calls[1].args[1])).not.toContain('Stopped.');
  await finish(h, 1);
  await p.send({ type: 'clear' });
  await p.send(submit('third', 'b', 'Fresh conversation'));
  await vi.waitFor(() => expect(h.calls).toHaveLength(3));
  const messages = h.calls[2].args[1] as unknown[];
  expect(messages).toHaveLength(1);
  expect(JSON.stringify(messages)).toContain('Fresh conversation');
  await finish(h, 2);
});
