import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { storage } = vi.hoisted(() => ({
  storage: { getAgents: vi.fn(), getDefaultAgent: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../src/lib/storage/config', () => ({
  ConfigStorage: { getInstance: () => storage },
}));
vi.mock('../src/lib/commands', () => ({
  CommandRegistry: class {
    registerBuiltins() {}
    async loadUserCommands() {}
  },
  CommandProcessor: class {},
  createBuiltinCommands: () => [],
}));

const agent = { id: 'dummy', name: 'Dummy agent', model: 'dummy-model' };
let change: (changes: Record<string, unknown>, area: string) => void;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  document.body.innerHTML = readFileSync('src/sidebar/index.html', 'utf8');
  storage.getAgents.mockReset().mockResolvedValue([]);
  chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ pong: true });
  chrome.storage.onChanged.addListener = vi.fn((listener) => {
    change = listener;
  });
  await import('../src/sidebar/index');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() =>
    expect(document.querySelector('#setup-title')?.textContent).toContain('first agent')
  );
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function element(selector: string) {
  return document.querySelector<HTMLElement>(selector)!;
}

it('shows focused setup and opens the existing creation flow directly', () => {
  expect(element('.chat-container').hidden).toBe(true);
  expect(element('.input-container').hidden).toBe(true);
  expect(element('#agent-switcher').hidden).toBe(true);
  expect(element('#messages').textContent?.trim()).toBe('');
  element('#setup-action').click();
  expect(chrome.tabs.create).toHaveBeenCalledWith({
    url: 'chrome-extension://test-extension-id/src/options/index.html#create-agent',
  });
});

it('reacts to add, edit, and last removal while retaining history and draft', async () => {
  const input = element('#message-input') as HTMLTextAreaElement;
  input.value = 'Unsent draft';
  element('#messages').textContent = 'Existing conversation';
  storage.getAgents.mockResolvedValue([agent]);
  change({ config: {} }, 'local');
  await vi.waitFor(() => expect(element('#agent-setup').hidden).toBe(true));
  expect(input.disabled).toBe(false);
  expect((element('#send-button') as HTMLButtonElement).disabled).toBe(false);
  expect(element('.agent-switcher-label').textContent).toBe('Dummy agent');
  storage.getAgents.mockResolvedValue([{ ...agent, name: 'Updated dummy' }]);
  change({ config: {} }, 'local');
  await vi.waitFor(() =>
    expect(element('.agent-switcher-label').textContent).toBe('Updated dummy')
  );
  storage.getAgents.mockResolvedValue([]);
  change({ config: {} }, 'local');
  await vi.waitFor(() => expect(element('#agent-setup').hidden).toBe(false));
  expect(element('.input-container').hidden).toBe(true);
  expect(input.value).toBe('Unsent draft');
  expect(element('#messages').textContent).toBe('Existing conversation');
  storage.getAgents.mockResolvedValue([agent]);
  change({ config: {} }, 'local');
  await vi.waitFor(() => expect(element('#agent-setup').hidden).toBe(true));
  expect(input.value).toBe('Unsent draft');
  expect(element('#messages').textContent).toBe('Existing conversation');
});

it('distinguishes configuration failures from an empty list and retries', async () => {
  storage.getAgents.mockRejectedValue(new Error('Invalid configuration'));
  change({ config: {} }, 'local');
  await vi.waitFor(() =>
    expect(element('#setup-title').textContent).toBe('Unable to load your agents')
  );
  expect(element('#setup-action').textContent).toBe('Open settings');
  expect(element('.input-container').hidden).toBe(true);
  element('#setup-action').click();
  expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  storage.getAgents.mockResolvedValue([agent]);
  element('#setup-retry').click();
  await vi.waitFor(() => expect(element('#agent-setup').hidden).toBe(true));
});

it('ignores a superseded load when a newer configuration arrives', async () => {
  let resolve!: (agents: (typeof agent)[]) => void;
  storage.getAgents.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  change({ config: {} }, 'local');
  storage.getAgents.mockResolvedValue([agent]);
  change({ config: {} }, 'local');
  await vi.waitFor(() => expect(element('#agent-setup').hidden).toBe(true));
  resolve([]);
  await vi.waitFor(() => expect(storage.getDefaultAgent).toHaveBeenCalled());
  expect(element('#agent-setup').hidden).toBe(true);
});
