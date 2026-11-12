// Toolbar icon status: the Dock symbol's dot is grey while the current tab's site has no
// agent connected and orange once it does. The tooltip says the same in words, so the
// state never depends on color alone.
import { siteConnectionKey, readSiteGrant } from '../lib/site-grant';

const ICONS = {
  connected: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
  idle: { 16: 'icons/icon-idle-16.png', 32: 'icons/icon-idle-32.png' },
} as const;

function originOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const { origin, protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? origin : undefined;
  } catch {
    return undefined;
  }
}

export async function refreshToolbarIcon(tabId: number, url?: string): Promise<void> {
  const origin = originOf(url);
  let connected = false;
  if (origin) {
    connected = !!(await readSiteGrant(origin));
  }
  try {
    await chrome.action.setIcon({ tabId, path: connected ? ICONS.connected : ICONS.idle });
    await chrome.action.setTitle({
      tabId,
      title: connected && origin ? `BYOA: connected to ${new URL(origin).host}` : 'BYOA',
    });
  } catch {
    // The tab closed before the icon could update.
  }
}

async function refreshAllTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : refreshToolbarIcon(tab.id, tab.url)))
  );
}

export function startToolbarIconSync(): void {
  if (!chrome.action?.setIcon) return;
  chrome.tabs.onUpdated?.addListener((tabId, change, tab) => {
    if (change.url || change.status === 'complete') void refreshToolbarIcon(tabId, tab.url);
  });
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'session') return;
    if (Object.keys(changes).some((key) => key.startsWith(siteConnectionKey('')))) {
      void refreshAllTabs();
    }
  });
  void refreshAllTabs();
}
