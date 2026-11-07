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
  await selectText(page, 'Good writing rarely arrives fully formed.');
  await suggestion(page, 'Good writing takes shape over time.');
  await page.locator('.developer-tools > summary').click();
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.screenshot({ path: 'test-results/margin-inline-review.png', fullPage: true });
  await page.getByRole('button', {name:'Accept',exact:true}).click();
  await expect(page.locator('.tiptap')).toContainText('Good writing takes shape over time.');
  await expect(page.locator('.suggestion-insertion')).toHaveCount(0);
  await page.getByRole('button', {name:'Undo',exact:true}).click();
  await expect(page.locator('.tiptap')).toContainText('Good writing rarely arrives fully formed.');
  await page.reload();
  await expect(page.locator('.tiptap')).toContainText('Good writing rarely arrives fully formed.');
});
test('rejects stale edits and keeps pending notes after reload', async ({page}) => {
  await page.goto('/');
  await selectText(page, 'Good writing rarely arrives fully formed.');
  await suggestion(page, 'A new opening.');
  await page.reload();
  await expect(page.locator('.suggestion-insertion')).toHaveText('A new opening.');
  await selectText(page, 'Good writing rarely arrives fully formed.');
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
  await selectText(page,'The best tools give those thoughts room to breathe.');
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
  await expect(page.locator('.tiptap h1')).toHaveText('A little room to think');
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
    await selectText(page, 'Good writing rarely arrives fully formed.');
    const result = await page.evaluate(async () => {
      const context = (document as any).modelContext;
      const tools = await context.getTools();
      const selectionResult = JSON.parse(await context.executeTool(tools.find((t: any) => t.name === 'get_selection'), {}));
      const selection = JSON.parse(selectionResult.content[0].text);
      const proposalResult = JSON.parse(await context.executeTool(tools.find((t: any) => t.name === 'propose_replacement'), {selectionId:selection.selectionId,replacement:'Writing improves through revision.',reason:'Native WebMCP integration test.'}));
      return { names: tools.map((t: any) => t.name), selection, proposalResult };
    });
    expect(result.names).toContain('add_comment');
    expect(result.selection.text).toBe('Good writing rarely arrives fully formed.');
    expect(result.proposalResult.isError).not.toBe(true);
    await expect(page.locator('.suggestion-insertion')).toHaveText('Writing improves through revision.');
    await page.getByRole('button',{name:'Accept',exact:true}).click();
    await expect(page.locator('.tiptap')).toContainText('Writing improves through revision.');
  });
});


test('agent connection is distinct from tool registration and has no companion setup', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Not connected', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agent connection' })).toContainText('Install or enable the BYOA extension');
  await expect(page.getByText('Pairing token', {exact:true})).toHaveCount(0);
  await expect(page.getByText('Connect local agent', {exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Agent connection' })).toHaveCount(0);
  await selectText(page, 'Good writing rarely arrives fully formed.');
  await page.getByRole('button', { name: 'Suggest replacement', exact: true }).click();
  await page.locator('.margin-selection-popup').getByRole('button', {name:'Connect agent',exact:true}).click();
  await expect(page.getByRole('region', { name: 'Agent connection' })).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('[data-agentboard-send]')).toHaveCount(0);
});
