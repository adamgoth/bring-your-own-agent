import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lookupSiteTasks,
  saveSiteTask,
  sweepInterruptedTasks,
  type SiteTaskRecord,
} from '../src/background/site-tasks';
import { parseStorageConfig } from '../src/lib/storage/config';
import { clampTaskTimeout, migrateTaskTimeout } from '../src/lib/storage/config-migration';

function record(
  id = 'one',
  tabId = 7,
  origin = 'https://app.test',
  incognito = false
): SiteTaskRecord {
  return {
    id,
    tabId,
    origin,
    incognito,
    documentId: 'document',
    createdAt: Date.now(),
    heartbeatAt: Date.now(),
    seq: 4,
    prompt: 'PRIVATE PROMPT',
    response: 'PRIVATE RESPONSE',
    activity: [{ name: 'secret', text: 'PRIVATE TOOL' }],
    status: 'working',
    detail: 'Working',
    lastEvent: { taskId: id, status: 'working', detail: 'Working', busy: true, seq: 4 },
  };
}
describe('Session task records', () => {
  let stored: Record<string, SiteTaskRecord>;
  beforeEach(() => {
    stored = {};
    vi.mocked(chrome.storage.session.get).mockImplementation(async () => structuredClone(stored));
    vi.mocked(chrome.storage.session.set).mockImplementation(async (updates) => {
      Object.assign(stored, structuredClone(updates));
    });
    vi.mocked(chrome.storage.session.remove).mockImplementation(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
    });
  });
  it('serializes writes and lookup, returns only summaries scoped by tab, origin and private context', async () => {
    const own = record();
    void saveSiteTask(own);
    void saveSiteTask(record('other-tab', 8));
    void saveSiteTask(record('other-origin', 7, 'https://other.test'));
    void saveSiteTask(record('private', 7, 'https://app.test', true));
    own.prompt = 'mutated';
    expect(await lookupSiteTasks(7, own.origin, false)).toEqual([own.lastEvent]);
    expect(await lookupSiteTasks(7, own.origin, false, 'missing')).toEqual([]);
    expect(Object.values(stored)[0].prompt).toBe('PRIVATE PROMPT');
    expect(JSON.stringify(await lookupSiteTasks(7, own.origin, false))).not.toMatch(
      /PRIVATE|prompt|response|activity|documentId|heartbeatAt/
    );
  });
  it('sweeps queued and working records exactly once, preserving transcript and finished records', async () => {
    const working = record();
    const done = record('done');
    done.status = 'done';
    done.lastEvent = { ...done.lastEvent, status: 'done', busy: false };
    const queued = record('queued');
    queued.status = 'queued';
    await saveSiteTask(working);
    await saveSiteTask(done);
    await saveSiteTask(queued);
    await sweepInterruptedTasks();
    await sweepInterruptedTasks();
    const events = await lookupSiteTasks(7, working.origin, false);
    expect(events.filter((event) => event.code === 'interrupted')).toHaveLength(2);
    expect(events.find((event) => event.taskId === 'one')).toMatchObject({
      seq: 5,
      status: 'error',
      busy: false,
    });
    expect(events.find((event) => event.taskId === 'done')).toEqual(done.lastEvent);
    expect(Object.values(stored).find((value) => value.id === 'one')?.response).toBe(
      'PRIVATE RESPONSE'
    );
  });
  it('preserves usage on worker interruption while projecting costs out of lookup', async () => {
    const task = record();
    task.usage = {
      inputTokens: 6,
      outputTokens: 4,
      totalTokens: 10,
      usageKnown: false,
      costUsd: 0.5,
    };
    await saveSiteTask(task);
    await sweepInterruptedTasks();
    const events = await lookupSiteTasks(7, task.origin, false);
    expect(events[0]).toMatchObject({
      code: 'interrupted',
      usage: { totalTokens: 10, usageKnown: false },
    });
    expect(events[0].usage).not.toHaveProperty('costUsd');
  });
  it('bounds recent terminal records without pruning a live run', async () => {
    await saveSiteTask(record('live'));
    for (let i = 0; i < 15; i++) {
      const task = record(`done-${i}`);
      task.createdAt += i + 1;
      task.status = 'done';
      task.lastEvent = { ...task.lastEvent, busy: false, status: 'done' };
      await saveSiteTask(task);
    }
    expect(await lookupSiteTasks(7, 'https://app.test', false)).toHaveLength(10);
    expect(Object.values(stored).some((task) => task.id === 'live')).toBe(true);
    expect(Object.keys(stored)).toHaveLength(11);
  });
});
describe('Task timeout configuration', () => {
  it('migrates missing configuration and refuses invalid settings', () => {
    expect(migrateTaskTimeout(undefined)).toBe(2);
    for (const value of [0, 11, 1.5, NaN, '2', null])
      expect(() => migrateTaskTimeout(value)).toThrow();
  });
  it('normalizes older storage and preserves valid limits through the config boundary', () => {
    expect(parseStorageConfig({ schemaVersion: 2, agents: [] }).config.siteTaskTimeoutMinutes).toBe(
      2
    );
    expect(
      parseStorageConfig({ schemaVersion: 2, agents: [], siteTaskTimeoutMinutes: 8 }).config
        .siteTaskTimeoutMinutes
    ).toBe(8);
    expect(() =>
      parseStorageConfig({ schemaVersion: 2, agents: [], siteTaskTimeoutMinutes: 11 })
    ).toThrow();
  });
  it('allows apps only to shorten the configured run limit', () => {
    expect(clampTaskTimeout(3, 1000)).toBe(1000);
    expect(clampTaskTimeout(3, 900000)).toBe(180000);
    for (const value of [undefined, NaN, Infinity, -1, 0, '1'])
      expect(clampTaskTimeout(3, value)).toBe(180000);
  });
});
