/**
 * Framework-neutral UI for apps that do not use React.
 *
 *   import { defineAgentElements } from '@byoagent/browser/elements';
 *   import '@byoagent/browser/styles.css';
 *   defineAgentElements();
 *   // <byoa-connection-dialog></byoa-connection-dialog>, then dialog.open = true
 *
 * Importing is SSR-safe: nothing touches the DOM until defineAgentElements() runs.
 * The element renders in light DOM with the same markup and classes as the React
 * AgentConnectionDialog, so one stylesheet and the same --byoa-* variables theme both.
 */
import { byoa } from './index.js';
import { createAgentSession, type AgentSession } from './session.js';
import {
  agentLabels,
  connectionView,
  containTab,
  defaultSetupUrl,
  dockMark,
  iconPaths,
  type AgentLabels,
  type IconName,
} from './ui.js';

export type { AgentLabels } from './ui.js';

export interface AgentConnectionDialogElement extends HTMLElement {
  /** Reflects the `open` attribute. Setting it shows or hides the modal. */
  open: boolean;
  /** Defaults to a page-wide session over the shared `byoa` client. */
  session: AgentSession;
  /** Overrides for built-in strings. */
  labels: AgentLabels;
  /** Reflects the `setup-url` attribute used when BYOA is missing. */
  setupUrl: string;
  /** Receives focus on close when the element that opened the dialog is gone. */
  returnFocusElement: HTMLElement | null;
  show(): void;
  close(): void;
}

/** Fired when the person closes the dialog (Escape, ×, or a native close). */
export type AgentOpenChangeEvent = CustomEvent<{ open: boolean }>;

declare global {
  interface HTMLElementTagNameMap {
    'byoa-connection-dialog': AgentConnectionDialogElement;
  }
  interface HTMLElementEventMap {
    openchange: AgentOpenChangeEvent;
  }
}

let shared: AgentSession | undefined;
const sharedSession = () => (shared ??= createAgentSession(byoa));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const svgNs = 'http://www.w3.org/2000/svg';
let ids = 0;

type Child = Node | string | false | null | undefined;
function h(tag: string, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false || value === null) continue;
    if (key === 'onclick') element.addEventListener('click', value as EventListener);
    else if (key === 'className') element.className = String(value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child) element.append(child);
  return element;
}
function svg(className: string, viewBox = '0 0 24 24') {
  const element = document.createElementNS(svgNs, 'svg');
  element.setAttribute('class', className);
  element.setAttribute('viewBox', viewBox);
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('focusable', 'false');
  return element;
}
function icon(name: IconName, className = 'byoa-icon') {
  const element = svg(className);
  for (const [key, value] of Object.entries({
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }))
    element.setAttribute(key, value);
  for (const d of iconPaths[name]) {
    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', d);
    element.append(path);
  }
  return element;
}
function mark(connected: boolean) {
  const element = svg('byoa-mark');
  const cradle = document.createElementNS(svgNs, 'path');
  for (const [key, value] of Object.entries({
    d: dockMark.cradle,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '3.5',
    'stroke-linecap': 'round',
  }))
    cradle.setAttribute(key, value);
  const dot = document.createElementNS(svgNs, 'circle');
  for (const [key, value] of Object.entries(dockMark.dot)) dot.setAttribute(key, String(value));
  dot.setAttribute('fill', connected ? dockMark.connectedColor : 'currentColor');
  dot.setAttribute('opacity', connected ? '1' : '0.45');
  element.append(cradle, dot);
  return element;
}

function connectionDialogClass() {
  return class ByoaConnectionDialog extends HTMLElement implements AgentConnectionDialogElement {
    static observedAttributes = ['open', 'setup-url'];
    returnFocusElement: HTMLElement | null = null;
    #session: AgentSession | undefined;
    #labels: AgentLabels = {};
    #unsubscribe: (() => void) | undefined;
    #dialog: HTMLDialogElement | undefined;
    #title: HTMLElement | undefined;
    #close: HTMLElement | undefined;
    #body: HTMLElement | undefined;
    #previous: Element | null = null;
    #error = '';
    #rendered = '';

    get session() {
      return this.#session ?? sharedSession();
    }
    set session(value: AgentSession) {
      if (value === this.#session) return;
      this.#detach();
      this.#session = value;
      if (this.isConnected) this.#attach();
    }
    get labels() {
      return this.#labels;
    }
    set labels(value: AgentLabels) {
      this.#labels = value ?? {};
      this.#render(true);
    }
    get open() {
      return this.hasAttribute('open');
    }
    set open(value: boolean) {
      this.toggleAttribute('open', !!value);
    }
    get setupUrl() {
      return this.getAttribute('setup-url') || defaultSetupUrl;
    }
    set setupUrl(value: string) {
      this.setAttribute('setup-url', value);
    }
    show() {
      this.open = true;
    }
    close() {
      this.open = false;
    }

    connectedCallback() {
      if (!this.#dialog) this.#build();
      this.#attach();
      this.#syncOpen();
    }
    disconnectedCallback() {
      this.#detach();
      if (this.#dialog?.open) this.#dialog.close();
    }
    attributeChangedCallback(name: string) {
      if (!this.#dialog) return;
      if (name === 'open') this.#syncOpen();
      else this.#render(true);
    }

    #text() {
      return { ...agentLabels, ...this.#labels };
    }
    #build() {
      const titleId = `byoa-connection-title-${++ids}`;
      this.#title = h('h2', { id: titleId });
      this.#close = h(
        'button',
        { type: 'button', className: 'byoa-btn byoa-icon-button', onclick: () => this.#requestClose() },
        icon('close')
      );
      this.#body = h('div', { className: 'byoa-connection-body' });
      const dialog = h(
        'dialog',
        { className: 'byoa-dialog byoa-connection', 'aria-labelledby': titleId },
        h('header', { className: 'byoa-dialog-header' }, this.#title, this.#close)
      ) as HTMLDialogElement;
      // The body is display: contents so its parts join the dialog's flex column.
      this.#body.style.display = 'contents';
      dialog.append(this.#body);
      dialog.addEventListener('keydown', (event) => containTab(event, dialog));
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        this.#requestClose();
      });
      // A close the element did not ask for (for example a browser close request).
      // `close` is queued, so after close() then show() a stale event can arrive while
      // the dialog is open again; only a dialog that is really closed counts.
      dialog.addEventListener('close', () => {
        if (this.open && !dialog.open) this.#requestClose();
      });
      this.#dialog = dialog;
      this.append(dialog);
    }
    #attach() {
      if (this.#unsubscribe) return;
      try {
        this.#unsubscribe = this.session.subscribe(() => this.#render());
      } catch (error) {
        this.#error = message(error);
      }
      this.#render(true);
    }
    #detach() {
      this.#unsubscribe?.();
      this.#unsubscribe = undefined;
    }
    #syncOpen() {
      const dialog = this.#dialog;
      if (!dialog) return;
      if (this.open && !dialog.open) {
        this.#previous = document.activeElement;
        this.#error = '';
        this.#render(true);
        if (dialog.isConnected) dialog.showModal();
        (dialog.querySelector<HTMLElement>('[data-byoa-autofocus]') ?? this.#close)?.focus();
      } else if (!this.open && dialog.open) {
        dialog.close();
        const previous = this.#previous;
        this.#previous = null;
        if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
        else this.returnFocusElement?.focus();
      }
    }
    #requestClose() {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new CustomEvent('openchange', { detail: { open: false } }));
    }
    /** Invoke inside the click so the extension sees the person's gesture. */
    #act(operation: () => unknown) {
      this.#error = '';
      try {
        void Promise.resolve(operation()).catch((error) => {
          this.#error = message(error);
          this.#render();
        });
      } catch (error) {
        this.#error = message(error);
      }
      this.#render();
    }
    #render(force = false) {
      const body = this.#body;
      if (!body || !this.#title || !this.#close) return;
      const text = this.#text();
      const snapshot = this.session.getSnapshot();
      const view = connectionView(snapshot, text);
      const alert = this.#error || snapshot.connectionError || snapshot.connection.error || '';
      const signature = JSON.stringify([view, alert, text, this.setupUrl]);
      if (!force && signature === this.#rendered) return;
      this.#rendered = signature;

      const active = document.activeElement;
      const focusedKey =
        active instanceof HTMLElement && body.contains(active) ? active.dataset.byoaKey : undefined;

      this.#title.textContent = text.connectionTitle;
      this.#close.setAttribute('aria-label', text.close);
      const session = this.session;
      const row = (key: string, name: IconName, label: string, trail: IconName | null, onclick: () => void) =>
        h(
          'button',
          { type: 'button', className: 'byoa-btn byoa-row', 'data-byoa-key': key, onclick },
          icon(name),
          h('span', { className: 'byoa-row-label' }, label),
          trail && icon(trail, 'byoa-icon byoa-row-trail')
        );
      const { state } = view;
      const connected = state === 'connected';
      const parts: Child[] = [
        h(
          'div',
          { className: 'byoa-status', 'data-state': state, role: 'status' },
          h('span', { className: 'byoa-status-dot', 'aria-hidden': 'true' }),
          h(
            'span',
            { className: 'byoa-status-text' },
            h('strong', { className: 'byoa-status-name' }, view.title),
            view.detail && h('span', { className: 'byoa-status-detail' }, view.detail)
          ),
          connected &&
            h(
              'button',
              {
                type: 'button',
                className: 'byoa-btn byoa-text-button',
                'aria-label': text.changeProfile,
                'data-byoa-key': 'change',
                onclick: () => this.#act(() => session.connect()),
              },
              text.change
            )
        ),
        state === 'unavailable' &&
          h(
            'a',
            {
              className: 'byoa-btn byoa-primary',
              href: this.setupUrl,
              target: '_blank',
              rel: 'noreferrer',
              'data-byoa-autofocus': true,
              'data-byoa-key': 'setup',
            },
            text.setupLink,
            icon('external')
          ),
        (state === 'disconnected' || state === 'waiting') &&
          h(
            'button',
            {
              type: 'button',
              className: 'byoa-btn byoa-primary',
              'data-byoa-autofocus': true,
              'data-byoa-key': 'connect',
              disabled: state === 'waiting',
              'aria-busy': state === 'waiting' ? 'true' : undefined,
              onclick: () => this.#act(() => session.connect()),
            },
            state === 'waiting' && h('span', { className: 'byoa-spinner', 'aria-hidden': 'true' }),
            state === 'waiting' ? text.waitingAction : text.connect
          ),
        state !== 'detecting' &&
          h(
            'div',
            { className: 'byoa-menu' },
            connected &&
              row('sidebar', 'sidebar', text.sidebar, 'chevron', () =>
                this.#act(() => session.client.openChat(session.getSnapshot().task?.taskId))
              ),
            state === 'unavailable'
              ? row('refresh', 'refresh', text.refresh, null, () => this.#act(() => session.refresh()))
              : row('settings', 'settings', text.settings, 'external', () =>
                  this.#act(() => session.client.openSettings())
                )
          ),
        alert && h('p', { className: 'byoa-error', role: 'alert' }, alert),
        h(
          'footer',
          { className: 'byoa-dialog-footer' },
          h('p', { className: 'byoa-privacy' }, icon('lock'), h('span', {}, text.privacy)),
          h(
            'div',
            { className: 'byoa-footer-row' },
            connected &&
              h(
                'button',
                {
                  type: 'button',
                  className: 'byoa-btn byoa-danger-button',
                  'data-byoa-key': 'disconnect',
                  onclick: () => this.#act(() => session.disconnect()),
                },
                icon('power'),
                text.disconnect
              ),
            h('span', { className: 'byoa-attribution' }, mark(connected), text.managedBy)
          )
        ),
      ];
      body.replaceChildren(...parts.filter((part): part is Node | string => !!part));

      // Re-rendering replaces nodes; keep keyboard focus on the same control when it survives.
      if (focusedKey) {
        const next = body.querySelector<HTMLElement>(`[data-byoa-key="${focusedKey}"]`);
        if (next && !(next as HTMLButtonElement).disabled) next.focus();
        else if (this.#dialog?.open)
          (body.querySelector<HTMLElement>('[data-byoa-autofocus]:not(:disabled)') ?? this.#close).focus();
      }
    }
  };
}

/**
 * Registers <byoa-connection-dialog>. Safe to call more than once and a no-op where
 * custom elements are unavailable (for example during server rendering).
 */
export function defineAgentElements(registry?: CustomElementRegistry) {
  const target = registry ?? (typeof customElements === 'undefined' ? undefined : customElements);
  if (!target || target.get('byoa-connection-dialog')) return;
  target.define('byoa-connection-dialog', connectionDialogClass());
}
