import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.addInitScript(() => {
    const registry = new Map<string, any>();
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool(tool: any) { registry.set(tool.name, tool); },
      unregisterTool(name: string) { registry.delete(name); },
    } });
    const state = window as any;
    state.draftRequests = [];
    const listeners = new Set<(event: unknown) => void>();
    const post = (data: any) => listeners.forEach(listener => listener({ ...data.event, seq: data.event.busy ? 0 : 1 }));
    let count = 0;
    const provider = {
      on(name: string, listener: (event: unknown) => void) { if (name === 'task') listeners.add(listener); },
      removeListener(name: string, listener: (event: unknown) => void) { if (name === 'task') listeners.delete(listener); },
      async request({ method, params }: { method: string; params: any }) {
        if (method === 'agent_status') return { available: true, configured: true, connected: true, agentName: 'Test agent' };
        if (method === 'agent_requestTask') {
          const id = `draft-${++count}`;
          state.draftRequests.push({ id, params });
          post({ event: { taskId: id, status: 'working', busy: true, detail: 'Drafting' } });
          return { taskId: id };
        }
        if (method === 'agent_cancelTask') post({ event: { taskId: params.taskId, status: 'cancelled', busy: false, detail: 'Cancelled' } });
      },
    };
    window.addEventListener('agent:requestProvider', () => window.dispatchEvent(new CustomEvent('agent:announceProvider', {
      detail: { info: { uuid: 'draft-fixture', name: 'Test agent', icon: '', rdns: 'test.local' }, provider },
    })));
    state.failDraft = (detail: string) => {
      const request = state.draftRequests.at(-1);
      post({ kind: 'task', id: request.id, event: { taskId: request.id, status: 'error', busy: false, detail } });
    };
    state.returnTitle = async (title: string) => {
      const request = state.draftRequests.at(-1);
      const requestId = request.params.prompt.match(/Title request ID: ([a-f0-9-]+)/)[1];
      const result = await registry.get('suggest_title').execute({ requestId, title });
      post({ kind: 'task', id: request.id, event: { taskId: request.id, status: 'done', busy: false, detail: 'Done' } });
      return result;
    };
    state.returnDraft = async (markdown: string, token?: string) => {
      const request = state.draftRequests.at(-1);
      const requestId = token ?? request.params.prompt.match(/Draft request ID: ([a-f0-9-]+)/)[1];
      const result = await registry.get('propose_document').execute({ requestId, markdown });
      if (!token) post({ kind: 'task', id: request.id, event: { taskId: request.id, status: 'done', busy: false, detail: 'Done' } });
      return result;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByLabel('What are you writing?').fill('A short invitation to our reading group.');
}
async function start(page: Page) {
  await page.getByRole('button', { name: 'Draft with your agent', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).draftRequests.length)).toBe(1);
}
async function draft(page: Page, markdown = '# Reading group\n\nJoin us on Saturday.\n\n- Bring a book') {
  return page.evaluate(text => (window as any).returnDraft(text), markdown);
}

test('previews a draft, persists it, accepts it only on request, and supports undo', async ({ page }) => {
  await setup(page); await start(page);
  expect(await page.evaluate(() => (window as any).draftRequests[0].params.tools)).toEqual(['propose_document']);
  await draft(page);
  await expect(page.getByRole('heading', { name: 'Draft preview' })).toBeVisible();
  await expect(page.locator('.tiptap')).toHaveText('');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/draft-preview-mobile.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'Use draft', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.locator('.draft-preview h1')).toHaveText('Reading group');
  await page.getByRole('button', { name: 'Use draft', exact: true }).click();
  await expect(page.locator('.tiptap h1')).toHaveText('Reading group');
  await expect(page.locator('.draft-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.tiptap')).toHaveText('');
});

test('keeps typing made while drafting and prevents replacement even after undo', async ({ page }) => {
  await setup(page); await start(page);
  await page.locator('.tiptap').fill('My own opening.');
  await draft(page);
  await expect(page.getByRole('button', { name: 'Use draft', exact: true })).toBeDisabled();
  await expect(page.locator('.tiptap')).toHaveText('My own opening.');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.tiptap')).toHaveText('');
  await expect(page.getByRole('button', { name: 'Use draft', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.locator('.draft-preview')).toHaveCount(0);
});

test('rejects changes made after the preview arrives and does not render unsafe HTML', async ({ page }) => {
  await setup(page); await start(page);
  await draft(page, '# Preview\n\n<script>window.unsafeDraft = true</script><img src=x onerror="window.unsafeDraft=true">\n\nHello.');
  await expect(page.locator('.draft-preview img, .draft-preview script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).unsafeDraft)).toBeUndefined();
  await page.locator('.tiptap').fill('My opening after the preview.');
  await expect(page.getByRole('button', { name: 'Use draft', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.locator('.tiptap')).toHaveText('My opening after the preview.');
});

test('cancellation rejects late results and invalid request IDs', async ({ page }) => {
  await setup(page); await start(page);
  const invalid = await page.evaluate(() => (window as any).returnDraft('Wrong draft', 'wrong-id'));
  expect(invalid.isError).toBe(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Draft with your agent', exact: true })).toBeEnabled();
  const late = await draft(page);
  expect(late.isError).toBe(true);
  await expect(page.locator('.draft-preview')).toHaveCount(0);
  await expect(page.locator('.tiptap')).toHaveText('');
});

test('acceptance refuses to overwrite another tab’s saved changes', async ({ page, context }) => {
  await setup(page); await start(page); await draft(page);
  await expect(page.getByRole('button', { name: 'Use draft', exact: true })).toBeEnabled();
  const other = await context.newPage();
  await other.goto('/');
  await other.locator('.tiptap').fill('Saved from another tab.');
  await page.getByRole('button', { name: 'Use draft', exact: true }).click();
  await expect(page.getByText('This document changed in another tab. Reload before using a draft.')).toBeVisible();
  await expect(page.locator('.tiptap')).toHaveText('');
  await other.reload();
  await expect(other.locator('.tiptap')).toHaveText('Saved from another tab.');
});


test('shows a readable draft error and retries without losing the prompt', async ({ page }) => {
  await setup(page); await start(page);
  await page.evaluate(() => (window as any).failDraft('Your API key was rejected. Check your agent settings and try again.'));
  const notice = page.getByRole('alert');
  await expect(notice).toContainText('Couldn’t create a draft');
  await expect(notice).toContainText('Your API key was rejected.');
  await expect(page.getByLabel('What are you writing?')).toHaveValue('A short invitation to our reading group.');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/draft-error-mobile.png', fullPage: true });
  await notice.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).draftRequests.length)).toBe(2);
  await draft(page);
  await expect(page.locator('.draft-preview')).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(page.locator('.tiptap')).toHaveText('');
});

test('draft keyboard shortcut respects empty prompts and submits once', async ({ page }) => {
  await setup(page);
  const input = page.getByLabel('What are you writing?');
  await input.fill('');
  await input.press('Meta+Enter');
  expect(await page.evaluate(() => (window as any).draftRequests.length)).toBe(0);
  await input.fill('An invitation');
  await input.press('Enter');
  await expect(input).toHaveValue('An invitation\n');
  await input.press('Meta+Enter');
  await expect.poll(() => page.evaluate(() => (window as any).draftRequests.length)).toBe(1);
  await expect(input).toBeDisabled();
  await draft(page);
  await expect(page.locator('.draft-preview')).toBeVisible();
});


test('suggests a title in one click, preserves the body, and can undo it', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('button', { name: 'Suggest title', exact: true })).toBeDisabled();
  await page.locator('.tiptap').fill('A monthly reading group at the library.');
  await page.getByRole('button', { name: 'Suggest title', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).draftRequests.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).draftRequests[0].params.tools)).toEqual(['suggest_title']);
  await page.evaluate(() => (window as any).returnTitle('The Library Reading Group'));
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('The Library Reading Group');
  await expect(page.locator('.tiptap')).toHaveText('A monthly reading group at the library.');
  await page.getByRole('button', { name: 'Undo suggested title', exact: true }).click();
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('Untitled document');
  await page.reload();
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('Untitled document');
});

test('title suggestion cannot replace a title typed while the agent works', async ({ page }) => {
  await setup(page);
  await page.locator('.tiptap').fill('A reading group.');
  await page.getByRole('button', { name: 'Suggest title', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).draftRequests.length)).toBe(1);
  await page.getByLabel('Document title', { exact: true }).fill('My own title');
  const result = await page.evaluate(() => (window as any).returnTitle('An agent title'));
  expect(result.isError).toBe(true);
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('My own title');
  await expect(page.getByRole('alert')).toContainText('Your changes were kept');
});

test('cancelled title requests cannot rename a document', async ({ page }) => {
  await setup(page);
  await page.locator('.tiptap').fill('A reading group.');
  await page.getByRole('button', { name: 'Suggest title', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).draftRequests.length)).toBe(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Suggest title', exact: true })).toBeEnabled();
  const result = await page.evaluate(() => (window as any).returnTitle('Too late'));
  expect(result.isError).toBe(true);
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('Untitled document');
});
