/**
 * Framework-neutral pieces shared by the React components and the custom elements:
 * default strings, connection states, icons and dialog focus containment.
 * Safe to import during SSR: nothing here touches the DOM until a function is called.
 */
import type { Connection } from './types.js';

export const agentLabels = {
  connect: 'Connect Agent',
  connected: 'Agent connected',
  connectedState: 'connected',
  detecting: 'Checking for agent…',
  detectingDetail: 'Looking for BYOA in this browser.',
  working: 'Working…',
  connectionTitle: 'Agent connection',
  close: 'Close',
  unavailable: 'BYOA isn’t available',
  setup: 'Install or enable BYOA, then reload this page.',
  setupLink: 'Get BYOA',
  refresh: 'Check again',
  notConnected: 'No agent connected',
  waitingTitle: 'Waiting for approval',
  waiting: 'Choose a profile in the BYOA window.',
  waitingAction: 'Waiting for BYOA…',
  explain: 'BYOA will ask you to choose a profile and approve this site.',
  approved: 'Connected to this site.',
  change: 'Change',
  changeProfile: 'Change profile',
  settings: 'Agent settings',
  sidebar: 'Open sidebar',
  chat: 'Open in sidebar',
  disconnect: 'Disconnect',
  managedBy: 'Managed by BYOA',
  privacy: 'Requests and tool results go to your chosen provider. Your API key stays in BYOA.',
  request: 'Ask agent',
  prompt: 'Request',
  send: 'Send',
  cancel: 'Cancel',
  starting: 'Starting agent…',
  retry: 'Retry request',
  review: 'Review existing results before retrying.',
};
export type AgentLabels = Partial<typeof agentLabels>;
export const defaultSetupUrl = 'https://github.com/adamgoth/bring-your-own-agent#readme';

export type ConnectionState = 'detecting' | 'unavailable' | 'waiting' | 'connected' | 'disconnected';
export type ConnectionView = { state: ConnectionState; title: string; detail: string };

/** The one status card every connection surface shows. */
export function connectionView(
  snapshot: { connection: Connection; detecting: boolean; connecting: boolean },
  labels: typeof agentLabels
): ConnectionView {
  const { connection, detecting, connecting } = snapshot;
  if (detecting) return { state: 'detecting', title: labels.detecting, detail: labels.detectingDetail };
  if (!connection.available) return { state: 'unavailable', title: labels.unavailable, detail: labels.setup };
  if (connecting) return { state: 'waiting', title: labels.waitingTitle, detail: labels.waiting };
  if (connection.connected)
    return { state: 'connected', title: connection.agentName || labels.connected, detail: labels.approved };
  return { state: 'disconnected', title: labels.notConnected, detail: labels.explain };
}

/** 24×24 stroke icons (Lucide geometry), rendered with currentColor. */
export const iconPaths = {
  close: ['M18 6 6 18', 'm6 6 12 12'],
  sidebar: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M15 3v18'],
  settings: [
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  ],
  external: ['M7 7h10v10', 'M7 17 17 7'],
  chevron: ['m9 18 6-6-6-6'],
  power: ['M12 2v10', 'M18.4 6.6a9 9 0 1 1-12.77.04'],
  refresh: [
    'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
    'M21 3v5h-5',
    'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
    'M8 16H3v5',
  ],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
} as const;
export type IconName = keyof typeof iconPaths;

/** BYOA's Dock symbol. Its dot is tangerine only while connected. */
export const dockMark = {
  cradle: 'M5 5.5V11.5A7 7 0 0 0 19 11.5V5.5',
  dot: { cx: 12, cy: 8, r: 3.5 },
  connectedColor: '#F05A28',
} as const;

const focusable =
  'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab inside a modal surface. Returns true when it moved focus. */
export function containTab(event: KeyboardEvent, container: HTMLElement): boolean {
  if (event.key !== 'Tab') return false;
  const controls = Array.from(container.querySelectorAll<HTMLElement>(focusable)).filter(
    (element) => element.tabIndex >= 0 && element.getClientRects().length > 0
  );
  const first = controls[0];
  const last = controls.at(-1);
  const active = container.ownerDocument.activeElement;
  if (!first || !last) {
    event.preventDefault();
    return true;
  }
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (active === last || active === container)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
