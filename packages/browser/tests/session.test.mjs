import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createClient, createAgentSession } from '../dist/index.js';

function fixture({ silent = false, acknowledge } = {}) {
  const listeners = new Map();
  const calls = [];
  let next = 0;
  const emit = event => listeners.get('task')?.forEach(listener => listener(event));
  const provider = {
    on(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeListener(name, listener) { listeners.get(name)?.delete(listener); },
    async request(request) {
      calls.push(request);
      if (request.method === 'agent_status') return { available: true, configured: true, connected: true };
      if (request.method === 'agent_requestTask') {
        if (acknowledge) return acknowledge();
        const taskId = `task-${++next}`;
        emit({ taskId, busy: true, status: 'working', detail: 'Working', seq: 0 });
        return { taskId };
      }
      if (request.method === 'agent_cancelTask' && !silent) emit({ taskId: request.params.taskId, busy: false, status: 'cancelled', detail: 'Cancelled', seq: 1001 });
    },
  };
  return { client: createClient(provider), calls, emit };
}
const request = { prompt: 'Read fixture', tools: ['read'] };

test('sessions own only their runs, including when sharing a client with direct requests', async () => {
  const f = fixture();
  const first = createAgentSession(f.client);
  const second = createAgentSession(f.client);
  const unsub1 = first.subscribe(() => {}), unsub2 = second.subscribe(() => {});
  const direct = await f.client.request(request);
  assert.equal(first.getSnapshot().task, null);
  assert.equal(second.getSnapshot().pending, false);
  const run1 = first.run(request);
  await tick();
  assert.equal(first.getSnapshot().task.taskId, 'task-2');
  assert.equal(second.getSnapshot().task, null);
  const run2 = second.run(request);
  await tick();
  assert.equal(second.getSnapshot().task.taskId, 'task-3');
  f.emit({ taskId: direct.id, busy: true, status: 'working', detail: 'Other task', seq: 4 });
  assert.equal(first.getSnapshot().task.taskId, 'task-2');
  first.cancel();
  assert.equal((await run1).status, 'cancelled');
  assert.equal(second.getSnapshot().pending, true);
  second.cancel(); await run2;
  direct.cancel(); for await (const event of direct.events) { /* drain */ }
  unsub1(); unsub2(); await first.dispose(); await second.dispose(); f.client.dispose();
});

test('unconfirmed cancellation terminates locally, ignores late events, and unlocks the session', { timeout: 4000 }, async () => {
  const f = fixture({ silent: true });
  const session = createAgentSession(f.client);
  const run = session.run(request);
  await tick();
  session.cancel(); session.cancel();
  const terminal = await run;
  assert.equal(terminal.local, true);
  assert.equal(terminal.code, 'interrupted');
  assert.match(terminal.detail, /may still be running/);
  assert.equal(session.getSnapshot().pending, false);
  assert.equal(f.calls.filter(call => call.method === 'agent_cancelTask').length, 1);
  f.emit({ taskId: 'task-1', busy: true, status: 'working', detail: 'Late', seq: 100 });
  assert.equal(session.getSnapshot().task, terminal);
  const next = session.run(request); await tick();
  f.emit({ taskId: 'task-2', busy: false, status: 'done', detail: 'Done', seq: 2 });
  await next; await session.dispose(); f.client.dispose();
});

test('disposal is bounded even when the provider never confirms cancellation', { timeout: 4000 }, async () => {
  const f = fixture({ silent: true });
  const session = createAgentSession(f.client);
  const run = session.run(request); await tick();
  await session.dispose();
  assert.equal((await run).local, true);
  assert.throws(() => session.subscribe(() => {}), /disposed/);
  assert.throws(() => session.run(request), /disposed/);
  assert.equal((await f.client.getStatus()).connected, true);
  f.client.dispose();
});

test('disposal waits at most one second for acknowledgment; late acknowledgment is cancelled', async () => {
  let resolve;
  const f = fixture({ acknowledge: () => new Promise(done => { resolve = done; }) });
  const session = createAgentSession(f.client);
  const run = session.run(request);
  const rejected = assert.rejects(run, { name: 'AbortError' });
  await tick();
  await session.dispose(); await rejected;
  resolve({ taskId: 'late' }); await tick();
  assert.ok(f.calls.some(call => call.method === 'agent_cancelTask' && call.params.taskId === 'late'));
  f.client.dispose();
});

test('a real terminal event cancels the fallback timer and retains provider status', async () => {
  const f = fixture(); const session = createAgentSession(f.client);
  const run = session.run(request); await tick(); session.cancel();
  const event = await run;
  assert.equal(event.status, 'cancelled'); assert.equal(event.local, undefined);
  await session.dispose(); f.client.dispose();
});

test('unsubscribing during refresh prevents stale snapshot updates', async () => {
  let resolve;
  let subscriber;
  const client = {
    subscribe(listener) { subscriber = listener; return () => { subscriber = undefined; }; },
    getStatus() { return new Promise(done => { resolve = done; }); },
  };
  const session = createAgentSession(client);
  const unsubscribe = session.subscribe(() => {});
  unsubscribe();
  assert.equal(subscriber, undefined);
  resolve({ available: true, configured: true, connected: true }); await tick();
  assert.equal(session.getSnapshot().connection.connected, false);
  await session.dispose();
});
