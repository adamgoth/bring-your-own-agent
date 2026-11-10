import { test, expect, type Page } from '@playwright/test';
test.use({ launchOptions: { args: ['--enable-features=WebMCP', '--enable-blink-features=WebMCP'] } });
async function selectText(page: Page, text: string) {
  await page.locator('.tiptap').evaluate((el, wanted) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) { const index = node.textContent!.indexOf(wanted); if (index >= 0) { const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + wanted.length); const selection = window.getSelection()!; (el as HTMLElement).focus(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); return; } }
    throw new Error('Text not found');
  }, text);
  await expect(page.locator('.selected-passage').first()).toHaveText(text);
}
async function openTools(page: Page) {
  if (!(await page.locator('.developer-tools').evaluate(el => (el as HTMLDetailsElement).open))) await page.locator('.developer-tools > summary').click();
}
async function suggestion(page: Page, text: string) {
  await openTools(page);
  await page.getByLabel('Tool', { exact: true }).selectOption('propose_replacement');
  const args = JSON.parse(await page.getByLabel('Arguments · JSON').inputValue());
  await page.getByLabel('Arguments · JSON').fill(JSON.stringify({ ...args, replacement: text }));
  await page.getByRole('button', { name: 'Run tool', exact: true }).click();
  await expect(page.locator('.suggestion-insertion')).toHaveText(text);
}
test('suggest, accept, undo and persist the document', async ({page}) => {
  await page.goto('/');
  await selectText(page, 'The reading group will meet once a month.');
  await suggestion(page, 'Good writing takes shape over time.');
  await page.locator('.developer-tools > summary').click();
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.screenshot({ path: 'test-results/margin-inline-review.png', fullPage: true });
  await page.getByRole('button', {name:'Accept',exact:true}).click();
  await expect(page.locator('.tiptap')).toContainText('Good writing takes shape over time.');
  await expect(page.locator('.suggestion-insertion')).toHaveCount(0);
  await page.getByRole('button', {name:'Undo',exact:true}).click();
  await expect(page.locator('.tiptap')).toContainText('The reading group will meet once a month.');
  await page.reload();
  await expect(page.locator('.tiptap')).toContainText('The reading group will meet once a month.');
});
test('rejects stale edits and keeps pending notes after reload', async ({page}) => {
  await page.goto('/');
  await selectText(page, 'The reading group will meet once a month.');
  await suggestion(page, 'A new opening.');
  await page.reload();
  await expect(page.locator('.suggestion-insertion')).toHaveText('A new opening.');
  await selectText(page, 'The reading group will meet once a month.');
  await page.keyboard.type('A different thought.');
  await expect(page.getByRole('button', {name:'Accept',exact:true})).toBeDisabled();
  await expect(page.locator('.conflict-message')).toBeVisible();
  await page.getByRole('button', {name:'Reject',exact:true}).click();
  await expect(page.locator('.note')).toHaveCount(0);
});
test('manual inspector validates inputs and adds an explanation', async ({page}) => {
  await page.goto('/');
  await openTools(page);
  await page.getByRole('button', {name:'Run tool',exact:true}).click();
  await expect(page.locator('.tool-output')).toContainText('Select a passage');
  await selectText(page,'Each meeting will focus on one book chosen by the group.');
  await page.getByLabel('Tool', { exact: true }).selectOption('add_comment');
  const args = JSON.parse(await page.getByLabel('Arguments · JSON').inputValue());
  await page.getByLabel('Arguments · JSON').fill(JSON.stringify({ ...args, kind: 'explain', text: 'The writer values tools that leave space for thinking.' }));
  await page.getByRole('button', {name:'Run tool',exact:true}).click();
  await expect(page.locator('.note')).not.toHaveAttribute('open', '');
  await page.locator('.note summary').click();
  await expect(page.locator('.note')).toContainText('The writer values tools');
  await expect(page.locator('.comment-anchor')).toBeVisible();
  await page.getByRole('button',{name:'Resolve',exact:true}).click();
  await expect(page.locator('.comment-anchor')).toHaveCount(0);
});
test('renders without errors and fits mobile', async ({page}) => {
  const errors: string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.tiptap h1')).toHaveText('A reading group');
  await page.screenshot({path:'test-results/margin-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('.developer-tools')).not.toHaveAttribute('open', '');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/margin-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

test.describe('native WebMCP', () => {
  test('discovers and invokes registered tools through the browser API', async ({page}) => {
    await page.goto('/');
    await expect(page.locator('.mode-box')).toContainText('WebMCP connected');
    await selectText(page, 'The reading group will meet once a month.');
    const result = await page.evaluate(async () => {
      const context = (document as any).modelContext;
      const tools = await context.getTools();
      const selectionResult = JSON.parse(await context.executeTool(tools.find((t: any) => t.name === 'get_selection'), {}));
      const selection = JSON.parse(selectionResult.content[0].text);
      const proposalResult = JSON.parse(await context.executeTool(tools.find((t: any) => t.name === 'propose_replacement'), {selectionId:selection.selectionId,replacement:'Writing improves through revision.',reason:'Native WebMCP integration test.'}));
      return { names: tools.map((t: any) => t.name), selection, proposalResult };
    });
    expect(result.names).toContain('add_comment');
    expect(result.selection.text).toBe('The reading group will meet once a month.');
    expect(result.proposalResult.isError).not.toBe(true);
    await expect(page.locator('.suggestion-insertion')).toHaveText('Writing improves through revision.');
    await page.getByRole('button',{name:'Accept',exact:true}).click();
    await expect(page.locator('.tiptap')).toContainText('Writing improves through revision.');
  });
});


test('agent connection is distinct from tool registration and has no companion setup', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect your agent', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agent connection' })).toContainText('Install or enable the BYOA extension');
  await expect(page.getByText('Pairing token', {exact:true})).toHaveCount(0);
  await expect(page.getByText('Connect local agent', {exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Agent connection' })).toHaveCount(0);
  await selectText(page, 'The reading group will meet once a month.');
  await page.getByRole('button', { name: 'Improve this', exact: true }).click();
  await page.locator('.margin-selection-popup').getByRole('button', {name:'Connect agent',exact:true}).click();
  await expect(page.getByRole('region', { name: 'Agent connection' })).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('[data-agentboard-send]')).toHaveCount(0);
});

async function mockConnectedAgent(page: Page) {
  await page.addInitScript(() => {
    (window as any).agentRequests = [];
    window.addEventListener('message', event => {
      const data = event.data;
      if (data?.source !== 'agentboard:page') return;
      if (data.method === 'status') window.postMessage({ source: 'agentboard:extension', version: 1, kind: 'response', id: data.id, ok: true, value: { available: true, configured: true, connected: true, agentName: 'Test agent' } }, location.origin);
      if (data.method === 'request') {
        (window as any).agentRequests.push(data.params);
        window.postMessage({ source: 'agentboard:extension', version: 1, kind: 'task', id: data.id, event: { taskId: data.id, status: 'working', busy: true, detail: 'Working' } }, location.origin);
      }
      if (data.method === 'cancel') window.postMessage({ source: 'agentboard:extension', version: 1, kind: 'task', id: data.id, event: { taskId: data.id, status: 'cancelled', busy: false, detail: 'Cancelled' } }, location.origin);
    });
  });
}

test('improvement presets are exclusive and combine with optional instructions', async ({ page }) => {
  await mockConnectedAgent(page);
  await page.goto('/');
  await selectText(page, 'The reading group will meet once a month.');
  const popup = page.locator('.margin-selection-popup');
  await popup.getByRole('button', { name: 'Improve this', exact: true }).click();
  await popup.getByRole('button', { name: 'Clearer', exact: true }).click();
  await popup.getByRole('button', { name: 'Shorter', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Clearer', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(popup.getByRole('button', { name: 'Shorter', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).agentRequests.length)).toBe(0);
  await popup.getByLabel('Instruction for agent').fill('Keep the technical details.');
  await popup.getByRole('button', { name: 'Suggest edit', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Improving…', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as any).agentRequests.length)).toBe(1);
  const requests = await page.evaluate(() => (window as any).agentRequests);
  expect(requests).toHaveLength(1);
  expect(requests[0].prompt).toContain('more concise');
  expect(requests[0].prompt).toContain('Keep the technical details.');
  expect(requests[0].prompt).toContain('preserving its meaning and voice');
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Suggest edit', exact: true })).toBeEnabled();
});

test('general improvement needs no input and Comment and Explain stay simple', async ({ page }) => {
  await mockConnectedAgent(page);
  await page.goto('/');
  await selectText(page, 'The reading group will meet once a month.');
  const popup = page.locator('.margin-selection-popup');
  await popup.getByRole('button', { name: 'Improve this', exact: true }).click();
  await popup.getByRole('button', { name: 'Suggest edit', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Improving…', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as any).agentRequests.length)).toBe(1);
  const prompt = await page.evaluate(() => (window as any).agentRequests[0].prompt);
  expect(prompt).toContain('clarity and flow');
  expect(prompt).not.toContain('My instruction:');
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await popup.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(popup.locator('fieldset')).toHaveCount(0);
  await expect(popup.getByLabel('Instruction for agent')).toHaveAttribute('placeholder', 'What should I focus on?');
  await popup.getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(popup.locator('fieldset')).toHaveCount(0);
  await expect(popup.getByLabel('Instruction for agent')).toHaveAttribute('placeholder', 'What would you like explained?');
  await page.setViewportSize({ width: 390, height: 844 });
  await popup.getByRole('button', { name: 'Improve this', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/improve-popup-mobile.png' });
});

test('reopens actions on a saved highlight after rejecting a suggestion', async ({ page }) => {
  await page.goto('/');
  await selectText(page, 'The reading group will meet once a month.');
  await suggestion(page, 'A shorter opening.');
  await page.locator('.developer-tools > summary').click();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.locator('.suggestion-insertion')).toHaveCount(0);
  await expect(page.locator('.selected-passage')).toHaveText('The reading group will meet once a month.');
  await page.locator('.selected-passage').click();
  const popup = page.locator('.margin-selection-popup');
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: 'Improve this', exact: true }).click();
  await expect(popup.getByLabel('Instruction for agent')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await page.getByRole('button', { name: 'Selection actions', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(popup).toBeVisible();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(popup).toHaveCount(0);
  await expect(page.locator('.selected-passage')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Selection actions', exact: true })).toHaveCount(0);
});

test('clears the highlight inline without removing writing or review notes', async ({ page }) => {
  await page.goto('/');
  await selectText(page, 'The reading group will meet once a month.');
  await suggestion(page, 'A clearer opening.');
  await page.locator('.developer-tools > summary').click();
  await page.getByRole('button', { name: 'Clear highlighted selection', exact: true }).click();
  await expect(page.locator('.selected-passage')).toHaveCount(0);
  await expect(page.locator('.clear-highlight')).toHaveCount(0);
  await expect(page.locator('.margin-selection-popup')).toHaveCount(0);
  await expect(page.locator('.suggestion-insertion')).toHaveText('A clearer opening.');
  await expect(page.locator('.tiptap')).toContainText('The reading group will meet once a month.');
  expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
  await page.reload();
  await expect(page.locator('.selected-passage')).toHaveCount(0);
  await expect(page.locator('.suggestion-insertion')).toHaveText('A clearer opening.');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await selectText(page, 'The reading group will meet once a month.');
  await page.getByRole('button', { name: 'Clear highlighted selection', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.selected-passage')).toHaveCount(0);
});
