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
import {
  button,
  detailGrid,
  disclosure,
  el,
  emptyState,
  settingRow,
  statGroup,
  statusPill,
  type Tone,
} from './ui';
import { formatDuration, formatTokens, formatUsd, formatWhen, siteHost } from './format';

const durations = {
  session: 'Until I close the browser',
  days30: 'For 30 days',
  forever: 'Until I disconnect',
};

type Grant = Awaited<ReturnType<typeof listGrants>>[number]['grant'];
type DayTotals = Awaited<ReturnType<typeof todayUsage>>['site'];

const kindLabels: Record<SiteActivity['kind'], string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  expired: 'Access expired',
  task: 'Task',
};

const statusTones: Record<string, Tone> = {
  done: 'success',
  error: 'danger',
  cancelled: 'neutral',
  queued: 'neutral',
  working: 'warning',
};

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function usageText(totals: DayTotals) {
  return `${formatTokens(totals.tokens, totals.unknown)} · ${formatUsd(totals.usd, totals.unknownCost)}`;
}

function activityItem(entry: SiteActivity, showSite: boolean): HTMLLIElement {
  const meta = [
    entry.agentName,
    entry.usage &&
      `${formatTokens(entry.usage.totalTokens, !entry.usage.usageKnown)} · ${formatUsd(entry.usage.costUsd)}`,
    entry.durationMs === undefined ? undefined : formatDuration(entry.durationMs),
  ].filter(Boolean);
  return el(
    'li',
    { className: 'activity-item' },
    el('time', {
      className: 'activity-time',
      text: formatWhen(entry.at),
      attrs: { datetime: new Date(entry.at).toISOString() },
    }),
    el(
      'div',
      { className: 'activity-main' },
      el(
        'div',
        { className: 'activity-title' },
        el('span', { text: kindLabels[entry.kind] ?? entry.kind }),
        showSite && el('span', { className: 'activity-site', text: siteHost(entry.origin) }),
        entry.status && statusPill(capitalize(entry.status), statusTones[entry.status] ?? 'neutral')
      ),
      meta.length > 0 && el('p', { className: 'activity-meta', text: meta.join(' · ') }),
      entry.tools?.length
        ? el(
            'p',
            { className: 'activity-tools' },
            ...entry.tools.map((tool) => el('code', { text: tool }))
          )
        : null
    )
  );
}

function activityList(entries: SiteActivity[], showSite: boolean): HTMLElement {
  if (!entries.length) return el('p', { className: 'ui-muted', text: 'No activity yet.' });
  return el(
    'ol',
    { className: 'activity-list' },
    ...[...entries].reverse().map((entry) => activityItem(entry, showSite))
  );
}

function sharedFiles(grant: Grant) {
  return (
    [
      grant.share.persona ? 'IDENTITY.md, SOUL.md' : '',
      grant.share.user ? 'USER.md' : '',
      grant.share.memory ? 'MEMORY.md' : '',
    ]
      .filter(Boolean)
      .join(', ') || 'None'
  );
}

function accessText(grant: Grant) {
  const label = durations[grant.persist];
  return grant.expiresAt ? `${label} (ends ${formatWhen(grant.expiresAt)})` : label;
}

export async function initializeConnectedSites() {
  const list = document.getElementById('connected-sites-list');
  if (!list) return;
  const summary = document.getElementById('site-usage-summary');
  const recent = document.getElementById('site-activity-all');
  const disconnectAll = document.getElementById('disconnect-all') as HTMLButtonElement | null;
  const error = document.getElementById('site-permissions-error');
  const status = document.getElementById('site-permissions-status');
  const incognito = globalThis.chrome?.extension?.inIncognitoContext === true;
  let generation = 0;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  const announce = (message: string) => {
    if (!status) return;
    status.textContent = message;
    status.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status.hidden = true), 3000);
  };
  const act = async (operation: () => Promise<unknown>, success?: string) => {
    try {
      await operation();
      if (error) error.hidden = true;
      await render();
      if (success) announce(success);
    } catch {
      if (error) {
        error.hidden = false;
        error.textContent = 'Could not update connected sites. Please try again.';
      }
    }
  };

  const siteCard = (
    origin: string,
    grant: Grant,
    agentName: string,
    totals: DayTotals,
    activity: SiteActivity[]
  ) => {
    const isIncognito = grant.incognito === true;
    const card = el('article', { className: 'site-card', data: { origin } });

    const header = el(
      'header',
      { className: 'site-card-header' },
      el(
        'div',
        { className: 'site-card-heading' },
        el('h3', { text: siteHost(origin) }),
        el('p', { className: 'site-card-origin', text: origin })
      ),
      el(
        'div',
        { className: 'site-card-actions' },
        statusPill('Connected', 'connected'),
        isIncognito && statusPill('Incognito'),
        button({
          label: 'Disconnect',
          variant: 'danger-quiet',
          small: true,
          action: 'disconnect',
          ariaLabel: `Disconnect ${origin}`,
          onClick: () =>
            void act(
              () => revokeSiteGrant(origin, isIncognito),
              `Disconnected ${siteHost(origin)}.`
            ),
        })
      )
    );

    const details = detailGrid([
      { label: 'Agent', value: agentName, field: 'agent' },
      { label: 'Shared files', value: sharedFiles(grant), field: 'files' },
      { label: 'Access', value: accessText(grant), field: 'access' },
      {
        label: 'Last used',
        value: grant.lastUsedAt ? formatWhen(grant.lastUsedAt) : 'Never',
        field: 'last-used',
      },
      { label: 'Used today', value: usageText(totals), field: 'usage' },
    ]);

    // Access duration
    const select = el('select', {
      className: 'ui-select',
      attrs: { 'aria-label': `How long ${origin} stays connected` },
    });
    for (const [value, label] of Object.entries(durations))
      select.append(el('option', { text: label, attrs: { value } }));
    select.value = grant.persist;
    select.disabled = isIncognito;
    const updateAccess = button({
      label: 'Update',
      small: true,
      action: 'change-duration',
      onClick: () =>
        void act(
          () =>
            writeSiteGrant(
              origin,
              grant.agentId,
              grant.share,
              select.value,
              isIncognito,
              grant.budget
            ),
          'Access updated.'
        ),
    });
    updateAccess.disabled = true;
    select.addEventListener('change', () => {
      updateAccess.disabled = select.value === grant.persist;
    });

    // Spending limits
    const spending = el('fieldset', { className: 'budget-fields' });
    spending.append(
      el('legend', { className: 'visually-hidden', text: `Spending limits for ${origin}` })
    );
    const readBudget = budgetInputs(spending, grant.budget);
    const saveLimits = button({
      label: 'Save limits',
      small: true,
      action: 'save-budget',
      onClick: () =>
        void act(
          () =>
            writeSiteGrant(
              origin,
              grant.agentId,
              grant.share,
              grant.persist,
              isIncognito,
              readBudget()
            ),
          'Spending limits saved.'
        ),
    });
    saveLimits.disabled = true;
    spending.addEventListener('input', () => (saveLimits.disabled = false));

    const settings = el(
      'div',
      { className: 'site-card-settings' },
      settingRow({
        title: 'Access',
        hint: isIncognito
          ? 'Incognito connections end when you close Incognito windows.'
          : 'How long this site stays connected.',
        control: el('div', { className: 'ui-inline' }, select, updateAccess),
      }),
      settingRow({
        title: 'Spending limits',
        hint: 'Leave per-task tokens blank to use the global default; blank daily limits mean no site limit. Dollar limits apply only when the model’s price is known.',
        control: el('div', { className: 'ui-stack' }, spending, saveLimits),
      })
    );

    const history = disclosure({
      summary: 'Activity',
      count: activity.length,
      content: activityList(activity, false),
    });
    history.dataset.key = `site:${origin}:${isIncognito}`;

    card.append(header, details, settings, history);
    return card;
  };

  const render = async () => {
    const current = ++generation;
    const [entries, agents, activity, overall] = await Promise.all([
      listGrants(),
      ConfigStorage.getInstance().getAgents(),
      listSiteActivity(),
      todayUsage('', incognito),
    ]);
    const siteTotals = await Promise.all(
      entries.map(({ origin, grant }) => todayUsage(origin, grant.incognito === true))
    );
    if (current !== generation) return;

    // Keep expanded activity panels open across re-renders.
    const open = new Set(
      [...document.querySelectorAll<HTMLDetailsElement>('#connected-sites details[data-key]')]
        .filter((details) => details.open)
        .map((details) => details.dataset.key)
    );

    if (summary)
      summary.replaceChildren(
        el(
          'div',
          { className: 'site-summary-header' },
          el('h3', { text: 'Today' }),
          statusPill(incognito ? 'Incognito only' : 'Regular browsing')
        ),
        statGroup(
          [
            {
              label: 'Tokens',
              value: `${overall.global.tokens.toLocaleString()}${overall.global.unknown ? '+' : ''}`,
              note: overall.global.unknown ? 'Some tasks didn’t report usage' : undefined,
            },
            {
              label: 'Cost',
              value: formatUsd(overall.global.usd, overall.global.unknownCost),
              note:
                overall.global.unknownCost && overall.global.usd > 0
                  ? 'Some models have no known price'
                  : overall.global.unknownCost
                    ? 'This model has no known price'
                    : undefined,
            },
            { label: 'Connected sites', value: String(entries.length) },
          ],
          'Usage today across all sites'
        )
      );

    list.replaceChildren(
      ...(entries.length
        ? entries.map(({ origin, grant }, index) =>
            siteCard(
              origin,
              grant,
              agents.find((agent) => agent.id === grant.agentId)?.name ?? 'Deleted profile',
              siteTotals[index].site,
              activity.filter((entry) => entry.origin === origin)
            )
          )
        : [
            emptyState(
              'No connected sites',
              'When an app asks to connect, approve it in BYOA’s connection window and it shows up here.'
            ),
          ])
    );
    if (disconnectAll) disconnectAll.hidden = entries.length === 0;

    if (recent) {
      const clear = button({
        label: 'Clear activity',
        variant: 'quiet',
        small: true,
        onClick: () => void act(clearSiteActivity, 'Activity cleared.'),
      });
      clear.id = 'clear-site-activity';
      clear.disabled = activity.length === 0;
      const all = disclosure({
        summary: 'Recent activity, all sites',
        count: activity.length,
        content: activityList(activity, true),
        actions: [clear],
      });
      all.dataset.key = 'all';
      recent.replaceChildren(all);
    }

    for (const details of document.querySelectorAll<HTMLDetailsElement>(
      '#connected-sites details[data-key]'
    ))
      details.open = open.has(details.dataset.key);
  };

  disconnectAll?.addEventListener('click', () => {
    if (!window.confirm('Disconnect every site? Apps will need to ask to connect again.')) return;
    void act(async () => {
      for (const { origin, grant } of await listGrants())
        await revokeSiteGrant(origin, grant.incognito === true);
    }, 'All sites disconnected.');
  });
  onGrantChanged(() => void act(async () => {}));
  onSiteActivityChanged(() => void act(async () => {}));
  await act(async () => {});
}
