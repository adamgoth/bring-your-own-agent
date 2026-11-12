/**
 * Small DOM building blocks for the settings page, styled by the `.ui-*` / `.button` rules in
 * styles.css (which read the BYOA design tokens). Each returns a plain element, so callers can
 * keep ids and data attributes that tests and other modules rely on.
 */

type Child = Node | string | null | undefined | false;

interface ElementOptions {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  data?: Record<string, string>;
}

/** Create an element with optional class, text, attributes, data attributes and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  Object.assign(node.dataset, options.data ?? {});
  for (const child of children) if (child) node.append(child);
  return node;
}

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger-quiet';

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  small?: boolean;
  /** Stable hook for tests and delegated handlers (`data-action`). */
  action?: string;
  ariaLabel?: string;
  onClick?: () => void;
}

export function button({
  label,
  variant = 'secondary',
  small = false,
  action,
  ariaLabel,
  onClick,
}: ButtonOptions): HTMLButtonElement {
  const node = el('button', {
    className: `button button-${variant}${small ? ' button-small' : ''}`,
    text: label,
    attrs: { type: 'button', ...(ariaLabel ? { 'aria-label': ariaLabel } : {}) },
    data: action ? { action } : {},
  });
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export type Tone = 'connected' | 'success' | 'danger' | 'warning' | 'neutral';

/** A rounded status label. "connected" adds the BYOA dot; the text always says the state too. */
export function statusPill(text: string, tone: Tone = 'neutral'): HTMLSpanElement {
  return el(
    'span',
    { className: 'ui-pill', data: { tone } },
    tone === 'connected' &&
      el('span', { className: 'ui-pill-dot', attrs: { 'aria-hidden': 'true' } }),
    text
  );
}

export interface Stat {
  label: string;
  value: string;
  note?: string;
}

/** A row of label/value figures, e.g. today's usage. */
export function statGroup(stats: Stat[], label?: string): HTMLElement {
  const group = el('dl', { className: 'ui-stats', attrs: label ? { 'aria-label': label } : {} });
  for (const stat of stats)
    group.append(
      el(
        'div',
        { className: 'ui-stat' },
        el('dt', { text: stat.label }),
        el('dd', { text: stat.value }),
        stat.note && el('dd', { className: 'ui-stat-note', text: stat.note })
      )
    );
  return group;
}

export interface Detail {
  label: string;
  value: string | Node;
  /** Stable hook for tests (`data-field`). */
  field?: string;
}

/** A compact grid of labelled facts. */
export function detailGrid(details: Detail[]): HTMLDListElement {
  const grid = el('dl', { className: 'ui-details' });
  for (const detail of details)
    grid.append(
      el(
        'div',
        { className: 'ui-detail', data: detail.field ? { field: detail.field } : {} },
        el('dt', { text: detail.label }),
        el('dd', {}, detail.value)
      )
    );
  return grid;
}

export interface SettingRowOptions {
  title: string;
  hint?: string;
  control: Node;
}

/** A labelled setting: title and hint on the left, its controls on the right (stacked when narrow). */
export function settingRow({ title, hint, control }: SettingRowOptions): HTMLElement {
  return el(
    'div',
    { className: 'ui-setting' },
    el(
      'div',
      { className: 'ui-setting-text' },
      el('h4', { text: title }),
      hint && el('p', { text: hint })
    ),
    el('div', { className: 'ui-setting-control' }, control)
  );
}

export interface DisclosureOptions {
  summary: string;
  count?: number;
  content: Node;
  /** Controls placed on the summary line (they don't toggle the disclosure). */
  actions?: Node[];
  open?: boolean;
}

/** A collapsible block with a chevron, optional count and optional actions on its header line. */
export function disclosure({
  summary,
  count,
  content,
  actions = [],
  open = false,
}: DisclosureOptions): HTMLDetailsElement {
  const details = el('details', { className: 'ui-disclosure' });
  details.open = open;
  const summaryEl = el(
    'summary',
    {},
    el('span', { className: 'ui-disclosure-title', text: summary }),
    count !== undefined && el('span', { className: 'ui-count', text: String(count) })
  );
  details.append(summaryEl);
  if (actions.length) {
    const bar = el('div', { className: 'ui-disclosure-actions' }, ...actions);
    details.append(bar);
  }
  details.append(el('div', { className: 'ui-disclosure-body' }, content));
  return details;
}

/** A dashed placeholder for empty lists. */
export function emptyState(title: string, body: string): HTMLElement {
  return el('div', { className: 'ui-empty' }, el('h3', { text: title }), el('p', { text: body }));
}
