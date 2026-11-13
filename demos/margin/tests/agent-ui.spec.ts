import { test, expect } from '@playwright/test';

test('native close synchronizes connection state and allows reopening', async ({ page }) => {
  await page.goto('/');
  const indicator = page.getByRole('button', { name: 'Connect Agent', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Agent connection' });
  for (let attempt = 0; attempt < 3; attempt++) {
    await indicator.click();
    await expect(dialog).toBeVisible();
    await expect(indicator).toHaveAttribute('aria-expanded', 'true');
    await dialog.evaluate(element => (element as HTMLDialogElement).close());
    await expect(dialog).toHaveCount(0);
    await expect(indicator).toHaveAttribute('aria-expanded', 'false');
    await expect(indicator).toBeFocused();
  }
});

test('shared connection UI preserves approval on cancel and manages keyboard focus', async ({ page }) => {
  await page.addInitScript(() => {
    const provider = {
      async request({ method }: { method: string }) {
        if (method === 'agent_connect') throw new Error('Approval cancelled');
        return { available: true, configured: true, connected: true, agentName: 'Fixture agent' };
      },
      on() {}, removeListener() {},
    };
    window.addEventListener('agent:requestProvider', () => window.dispatchEvent(new CustomEvent('agent:announceProvider', { detail: {
      info: { uuid: 'ui-fixture', name: 'Fixture', icon: '', rdns: 'test.local' }, provider,
    } })));
  });
  await page.goto('/');
  const indicator = page.getByRole('button', { name: 'Fixture agent, connected', exact: true });
  await indicator.click();
  const dialog = page.getByRole('dialog', { name: 'Agent connection' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Change profile' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Approval cancelled');
  await expect(indicator).toHaveText('Fixture agent');
  // Native modal dialogs keep keyboard focus inside their surface.
  for (let index = 0; index < 9; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(indicator).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await indicator.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 254, 250)');
  await page.screenshot({ path: 'test-results/shared-agent-dialog-mobile.png' });
});
