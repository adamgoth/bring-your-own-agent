import { test, expect } from '@playwright/test';

test('creates, renames and restores independent drafts with isolated undo', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tiptap')).toContainText('The reading group');
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByLabel('Document title', { exact: true }).fill('My second draft');
  await page.locator('.tiptap').fill('A brand new idea.');
  await page.reload();
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('My second draft');
  await expect(page.locator('.tiptap')).toHaveText('A brand new idea.');
  await page.getByRole('navigation', { name: 'Saved documents' }).getByRole('button', { name: 'A reading group' }).click();
  await expect(page.locator('.tiptap')).toContainText('The reading group');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('navigation', { name: 'Saved documents' }).getByRole('button', { name: 'My second draft' }).click();
  await expect(page.locator('.tiptap')).toHaveText('A brand new idea.');
});

test('imports Markdown safely as a new document and exports its formatting', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import Markdown file').setInputFiles({ name: 'Notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# My notes\n\nSome **bold** and *italic* words.\n\n- First\n- Second\n\n<script>window.importExecuted=true</script>\n<img src="https://example.invalid/tracker.png" onerror="window.importExecuted=true">') });
  await expect(page.locator('.tiptap h1')).toHaveText('My notes');
  await expect(page.locator('.tiptap strong')).toHaveText('bold');
  await expect(page.locator('.tiptap li')).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).importExecuted)).toBeUndefined();
  await expect(page.locator('.tiptap img, .tiptap script')).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Markdown' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Notes.md');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  expect(text).toContain('# My notes');
  expect(text).toContain('**bold**');
  expect(text).not.toContain('<script>');
  await expect(page.getByRole('navigation', { name: 'Saved documents' }).getByRole('button')).toHaveCount(2);
});

test('preserves a legacy draft and review notes during migration', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('margin-v1')) localStorage.setItem('margin-v1', JSON.stringify({ document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My original draft' }] }] }, anchors: [], notes: [{ id: 'note', anchorId: 'old', kind: 'comment', text: 'Old review', reason: '', status: 'dismissed' }], activeId: null, revision: 3 }));
  });
  await page.goto('/');
  await expect(page.locator('.tiptap')).toHaveText('My original draft');
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('Recovered draft');
  await page.locator('.history summary').click();
  await expect(page.locator('.history')).toContainText('Old review');
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Saved documents' }).getByRole('button')).toHaveCount(1);
});

test('refuses to overwrite a newer edit from another tab', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('.tiptap')).toContainText('The reading group');
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('.tiptap')).toContainText('The reading group');
  await page.getByLabel('Document title', { exact: true }).fill('First tab edit');
  await other.getByLabel('Document title', { exact: true }).fill('Conflicting edit');
  await expect(other.locator('.saved')).toContainText('Changed in another tab');
  await other.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(other.getByLabel('Document title', { exact: true })).toHaveValue('Conflicting edit');
  await page.reload();
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('First tab edit');
});

test('reports a full storage device without discarding the open draft', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tiptap')).toContainText('The reading group');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
  await page.locator('.tiptap').fill('Keep this unsaved writing');
  await expect(page.locator('.saved')).toContainText('Could not save');
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page.locator('.tiptap')).toHaveText('Keep this unsaved writing');
});
