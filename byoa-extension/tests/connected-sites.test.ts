import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatDuration,
  formatTokens,
  formatUsd,
  formatWhen,
  siteHost,
} from '../src/options/format';
import { detailGrid, disclosure, statusPill } from '../src/options/ui';

const now = new Date(2026, 10, 12, 10, 40).getTime();
const origin = 'https://byoa-margin.vercel.app';

const mocks = vi.hoisted(() => ({
  listGrants: vi.fn(),
  writeSiteGrant: vi.fn(),
  revokeSiteGrant: vi.fn(),
  listSiteActivity: vi.fn(),
  clearSiteActivity: vi.fn(),
  todayUsage: vi.fn(),
}));

vi.mock('../src/lib/site-grant', () => ({
  listGrants: mocks.listGrants,
  writeSiteGrant: mocks.writeSiteGrant,
  revokeSiteGrant: mocks.revokeSiteGrant,
  onGrantChanged: vi.fn(),
}));
vi.mock('../src/lib/site-activity', () => ({
  listSiteActivity: mocks.listSiteActivity,
  clearSiteActivity: mocks.clearSiteActivity,
  onSiteActivityChanged: vi.fn(),
}));
vi.mock('../src/background/site-budgets', () => ({ todayUsage: mocks.todayUsage }));
vi.mock('../src/lib/storage/config', () => ({
  ConfigStorage: {
    getInstance: () => ({ getAgents: async () => [{ id: 'a1', name: 'deepseek' }] }),
  },
}));

describe('settings formatting', () => {
  it('formats tokens and dollars in plain language', () => {
    expect(formatTokens(4508)).toBe(`${(4508).toLocaleString()} tokens`);
    expect(formatTokens(1)).toBe('1 token');
    expect(formatTokens(20, true)).toBe('20+ tokens');
    expect(formatUsd(undefined)).toBe('Cost unknown');
    expect(formatUsd(0, true)).toBe('Cost unknown');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.00042)).toBe('$0.0004');
    expect(formatUsd(1.234, true)).toBe('$1.23+');
  });

  it('formats durations, times and hosts', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(5055)).toBe('5.1 s');
    expect(formatDuration(125000)).toBe('2 min 5 s');
    expect(formatWhen(now - 60_000, now)).toMatch(/^Today, /);
    expect(formatWhen(now - 24 * 60 * 60 * 1000, now)).toMatch(/^Yesterday, /);
    expect(siteHost(origin)).toBe('byoa-margin.vercel.app');
    expect(siteHost('not a url')).toBe('not a url');
  });
});

describe('settings UI components', () => {
  it('labels status with text, adding the dot only when connected', () => {
    const connected = statusPill('Connected', 'connected');
    expect(connected.textContent).toBe('Connected');
    expect(connected.querySelector('.ui-pill-dot')).not.toBeNull();
    expect(statusPill('Done', 'success').querySelector('.ui-pill-dot')).toBeNull();
  });

  it('renders details and disclosures with stable hooks', () => {
    const grid = detailGrid([{ label: 'Agent', value: 'deepseek', field: 'agent' }]);
    expect(grid.querySelector('[data-field="agent"] dd')?.textContent).toBe('deepseek');
    const details = disclosure({
      summary: 'Activity',
      count: 2,
      content: document.createElement('p'),
    });
    expect(details.querySelector('summary')?.textContent).toBe('Activity2');
    expect(details.open).toBe(false);
  });
});

describe('connected sites section', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    document.body.innerHTML = `
      <section id="connected-sites">
        <button id="disconnect-all" hidden>Disconnect all</button>
        <p id="site-permissions-error" hidden></p>
        <p id="site-permissions-status" hidden></p>
        <div id="site-usage-summary"></div>
        <div id="connected-sites-list"></div>
        <div id="site-activity-all"></div>
      </section>`;
    const totals = { tokens: 4508, usd: 0, unknown: false, unknownCost: true };
    mocks.todayUsage.mockResolvedValue({ global: totals, site: totals });
    mocks.listGrants.mockResolvedValue([
      {
        origin,
        grant: {
          agentId: 'a1',
          share: {},
          persist: 'session',
          lastUsedAt: now - 3 * 60_000,
          budget: {},
        },
      },
    ]);
    mocks.listSiteActivity.mockResolvedValue([
      { at: now - 4 * 60_000, origin, kind: 'connected' },
      {
        at: now - 3 * 60_000,
        origin,
        kind: 'task',
        agentName: 'deepseek',
        status: 'done',
        tools: ['get_selection', 'add_comment'],
        durationMs: 5055,
        usage: { inputTokens: 4000, outputTokens: 508, totalTokens: 4508, usageKnown: true },
      },
    ]);
    mocks.writeSiteGrant.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('shows a clear card per site with readable usage and activity', async () => {
    const { initializeConnectedSites } = await import('../src/options/connected-sites');
    await initializeConnectedSites();

    const summary = document.getElementById('site-usage-summary')!;
    expect(summary.textContent).toContain('Cost unknown');
    expect(summary.textContent).not.toContain('$0.000000');

    const card = document.querySelector<HTMLElement>(`[data-origin="${origin}"]`)!;
    expect(card.querySelector('h3')?.textContent).toBe('byoa-margin.vercel.app');
    expect(card.querySelector('[data-field="agent"] dd')?.textContent).toBe('deepseek');
    expect(card.querySelector('[data-field="access"] dd')?.textContent).toBe(
      'Until I close the browser'
    );
    expect(card.querySelector('[data-field="files"] dd')?.textContent).toBe('None');
    expect(document.getElementById('disconnect-all')?.hidden).toBe(false);

    const items = card.querySelectorAll('.activity-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Task');
    expect(items[0].textContent).toContain('5.1 s');
    expect([...items[0].querySelectorAll('code')].map((code) => code.textContent)).toEqual([
      'get_selection',
      'add_comment',
    ]);
    expect(document.querySelector('#site-activity-all .activity-site')?.textContent).toBe(
      'byoa-margin.vercel.app'
    );
  });

  it('enables saving only after a change and keeps open panels open', async () => {
    const { initializeConnectedSites } = await import('../src/options/connected-sites');
    await initializeConnectedSites();
    const card = () => document.querySelector<HTMLElement>(`[data-origin="${origin}"]`)!;

    const update = card().querySelector<HTMLButtonElement>('[data-action="change-duration"]')!;
    const select = card().querySelector('select')!;
    expect(update.disabled).toBe(true);
    select.value = 'forever';
    select.dispatchEvent(new Event('change'));
    expect(update.disabled).toBe(false);

    const save = card().querySelector<HTMLButtonElement>('[data-action="save-budget"]')!;
    expect(save.disabled).toBe(true);
    const input = card().querySelector<HTMLInputElement>('input[type="number"]')!;
    input.value = '1000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(save.disabled).toBe(false);

    card().querySelector('details')!.open = true;
    save.click();
    await vi.waitFor(() => expect(mocks.writeSiteGrant).toHaveBeenCalled());
    expect(mocks.writeSiteGrant.mock.calls[0][5]).toEqual({ perTaskTokens: 1000 });
    await vi.waitFor(() =>
      expect(document.getElementById('site-permissions-status')?.textContent).toBe(
        'Spending limits saved.'
      )
    );
    expect(card().querySelector('details')!.open).toBe(true);
  });

  it('shows an empty state when nothing is connected', async () => {
    mocks.listGrants.mockResolvedValue([]);
    mocks.listSiteActivity.mockResolvedValue([]);
    const { initializeConnectedSites } = await import('../src/options/connected-sites');
    await initializeConnectedSites();
    expect(document.getElementById('connected-sites-list')?.textContent).toContain(
      'No connected sites'
    );
    expect(document.getElementById('disconnect-all')?.hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#clear-site-activity')?.disabled).toBe(true);
  });
});
