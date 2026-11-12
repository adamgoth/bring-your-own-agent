import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = readFileSync('src/connect/index.html', 'utf8');
  vi.mocked(chrome.tabs.create).mockResolvedValue(undefined);
  vi.mocked(chrome.runtime.openOptionsPage).mockResolvedValue(undefined);
});

it('opens first-agent creation and restores connection controls after setup without approving', async () => {
  const response = {
    origin: 'https://example.com',
    profiles: [] as Array<{ id: string; name: string; ready: boolean }>,
    persist: 'session',
    incognito: false,
  };
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(async () => response);
  await import('../src/connect/index');
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLButtonElement>('#setup-agent')?.hidden).toBe(false)
  );
  expect(document.querySelector<HTMLButtonElement>('#approve')?.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>('#duration')?.hidden).toBe(true);
  document.querySelector<HTMLButtonElement>('#setup-agent')?.click();
  expect(chrome.tabs.create).toHaveBeenCalledWith({
    url: 'chrome-extension://test-extension-id/src/options/index.html#create-agent',
  });
  response.profiles.push({ id: 'first', name: 'My agent', ready: true });
  const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];
  listener({ config: { newValue: {} } }, 'local');
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLButtonElement>('#setup-agent')?.hidden).toBe(true)
  );
  expect(document.querySelector<HTMLButtonElement>('#approve')?.disabled).toBe(false);
  expect(document.querySelector<HTMLElement>('#duration')?.hidden).toBe(false);
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'CONNECTION_PROMPT_APPROVE' })
  );
});

it('directs existing unfinished agents to settings', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
    origin: 'https://example.com',
    profiles: [{ id: 'draft', name: 'Draft', ready: false }],
    persist: 'session',
  });
  await import('../src/connect/index');
  await vi.waitFor(() =>
    expect(document.querySelector('#setup-agent')?.textContent).toBe('Finish agent setup')
  );
  document.querySelector<HTMLButtonElement>('#setup-agent')?.click();
  expect(chrome.runtime.openOptionsPage).toHaveBeenCalledOnce();
  expect(chrome.tabs.create).not.toHaveBeenCalled();
});
