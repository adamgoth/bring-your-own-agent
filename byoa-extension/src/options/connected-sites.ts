import { budgetInputs } from '../lib/budget-inputs';
import { todayUsage } from '../background/site-budgets';
import { listGrants, onGrantChanged, revokeSiteGrant, writeSiteGrant } from '../lib/site-grant';
import {
  onSiteActivityChanged,
  clearSiteActivity,
  listSiteActivity,
  type SiteActivity,
} from '../lib/site-activity';
import { ConfigStorage } from '../lib/storage/config';

const durations = {
  session: 'Until I close the browser',
  days30: 'For 30 days',
  forever: 'Until I disconnect',
};
function activityList(container: HTMLElement, entries: SiteActivity[]) {
  container.replaceChildren();
  if (!entries.length) container.textContent = 'No activity recorded.';
  for (const entry of [...entries].reverse()) {
    const row = document.createElement('p');
    row.textContent = [
      new Date(entry.at).toLocaleString(),
      entry.origin,
      entry.kind,
      entry.agentName,
      entry.status,
      entry.usage
        ? `${entry.usage.totalTokens} tokens${entry.usage.usageKnown ? '' : ' (incomplete)'}${entry.usage.costUsd === undefined ? ' · cost unknown' : ` · $${entry.usage.costUsd.toFixed(6)}`}`
        : undefined,
      entry.tools?.join(', '),
      entry.durationMs === undefined ? undefined : `${entry.durationMs} ms`,
    ]
      .filter(Boolean)
      .join(' · ');
    container.append(row);
  }
}
export async function initializeConnectedSites() {
  const list = document.getElementById('connected-sites-list');
  if (!list) return;
  const error = document.getElementById('site-permissions-error');
  let generation = 0;
  const act = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
      if (error) error.hidden = true;
      await render();
    } catch {
      if (error) {
        error.hidden = false;
        error.textContent = 'Could not update connected sites. Please try again.';
      }
    }
  };
  const render = async () => {
    const current = ++generation;
    const [entries, agents, activity] = await Promise.all([
      listGrants(),
      ConfigStorage.getInstance().getAgents(),
      listSiteActivity(),
    ]);
    if (current !== generation) return;
    list.replaceChildren();
    if (!entries.length)
      list.textContent = 'No connected sites. Connect from an app to get started.';
    const total = await todayUsage('', globalThis.chrome?.extension?.inIncognitoContext === true);
    const overview = document.createElement('p');
    overview.textContent = `All sites today${globalThis.chrome?.extension?.inIncognitoContext ? ' (Incognito only)' : ' (regular browsing)'}: ${total.global.tokens} tokens${total.global.unknown ? ' (incomplete usage)' : ''} · $${total.global.usd.toFixed(6)}${total.global.unknownCost ? ' (incomplete cost)' : ''}`;
    list.append(overview);
    for (const { origin, grant } of entries) {
      const row = document.createElement('article');
      row.dataset.origin = origin;
      const title = document.createElement('h3');
      title.textContent = `${origin}${grant.incognito ? ' (Incognito)' : ''}`;
      const info = document.createElement('p');
      const files = [
        grant.share.persona ? 'IDENTITY.md, SOUL.md' : '',
        grant.share.user ? 'USER.md' : '',
        grant.share.memory ? 'MEMORY.md' : '',
      ].filter(Boolean);
      info.textContent = `${agents.find((agent) => agent.id === grant.agentId)?.name ?? 'Deleted profile'} · Shared files: ${files.join(', ') || 'None'} · ${durations[grant.persist]}${grant.expiresAt ? ` (expires ${new Date(grant.expiresAt).toLocaleString()})` : ''} · Last used: ${grant.lastUsedAt ? new Date(grant.lastUsedAt).toLocaleString() : 'Never'}`;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Duration for ${origin}`);
      for (const [value, label] of Object.entries(durations)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.append(option);
      }
      select.value = grant.persist;
      select.disabled = grant.incognito === true;
      const change = document.createElement('button');
      change.textContent = 'Change duration';
      change.dataset.action = 'change-duration';
      change.onclick = () =>
        void act(() =>
          writeSiteGrant(
            origin,
            grant.agentId,
            grant.share,
            select.value,
            grant.incognito === true,
            grant.budget
          )
        );
      const disconnect = document.createElement('button');
      disconnect.textContent = 'Disconnect';
      disconnect.dataset.action = 'disconnect';
      disconnect.onclick = () => void act(() => revokeSiteGrant(origin, grant.incognito === true));
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'View activity';
      const events = document.createElement('div');
      activityList(
        events,
        activity.filter((entry) => entry.origin === origin)
      );
      details.append(summary, events);
      const spending = document.createElement('fieldset');
      const readBudget = budgetInputs(spending, grant.budget);
      const save = document.createElement('button');
      save.textContent = 'Save spending limits';
      save.dataset.action = 'save-budget';
      save.onclick = () =>
        void act(() =>
          writeSiteGrant(
            origin,
            grant.agentId,
            grant.share,
            grant.persist,
            grant.incognito === true,
            readBudget()
          )
        );
      const totals = await todayUsage(origin, grant.incognito === true);
      const usage = document.createElement('p');
      usage.textContent = `Today: ${totals.site.tokens} tokens${totals.site.unknown ? ' (incomplete; step limit fallback)' : ''} · $${totals.site.usd.toFixed(6)}${totals.site.unknownCost ? ' (incomplete cost)' : ''}`;
      row.append(title, info, usage, spending, save, select, change, disconnect, details);
      list.append(row);
    }
    const all = document.getElementById('site-activity-all');
    if (all) activityList(all, activity);
  };
  document.getElementById('disconnect-all')?.addEventListener(
    'click',
    () =>
      void act(async () => {
        for (const { origin, grant } of await listGrants())
          await revokeSiteGrant(origin, grant.incognito === true);
      })
  );
  document
    .getElementById('clear-site-activity')
    ?.addEventListener('click', () => void act(clearSiteActivity));
  onGrantChanged(() => void act(async () => {}));
  onSiteActivityChanged(() => void act(async () => {}));
  await act(async () => {});
}
