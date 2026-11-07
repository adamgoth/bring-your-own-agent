import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { CdpPipe, chromeSandboxArgs, waitFor } from './chrome-harness.mjs';

const requests = [];
let holdNext = false;
function respond(body, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  assert.ok(Array.isArray(body.tools), 'The task request must include its registered tools');
  const names = body.tools.map((t) => t.function.name);
  const results = body.messages.filter((m) => m.role === 'tool');
  const user = body.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
  const board = names.includes('get_board_snapshot');
  let name, args;
  if (board) {
    assert.deepEqual(
      names.sort(),
      ['get_board_snapshot', 'get_selected_cards', 'propose_board_changes'].sort()
    );
    if (results.length === 0) {
      name = 'get_board_snapshot';
      args = {};
    } else if (results.length === 1) {
      name = 'get_selected_cards';
      args = {};
    } else if (results.length === 2) {
      name = 'propose_board_changes';
      args = {
        revision: 1,
        reason: 'Make the onboarding work easier to start.',
        changes: [
          { op: 'create_column', columnId: 'next-week', name: 'Next week' },
          { op: 'rename_column', columnId: 'ready', name: 'Up next' },
          { op: 'move', cardId: 'onboarding', columnId: 'next-week' },
          { op: 'delete', cardId: 'empty-state' },
          {
            op: 'create',
            title: 'Map the first onboarding screen',
            columnId: 'backlog',
            priority: 'high',
          },
        ],
      };
    }
  } else {
    assert.equal(
      body.model,
      'second-fixture',
      'Margin must use the selected profile, not the default'
    );
    assert.deepEqual(
      names.sort(),
      [
        'get_selection',
        'get_document_outline',
        'find_text',
        'propose_replacement',
        'add_comment',
      ].sort()
    );
    if (results.length === 0) {
      name = 'get_selection';
      args = {};
    } else if (results.length === 1) {
      name = 'propose_replacement';
      args = {
        selectionId: user.match(/captured selection ID for the tool call: ([a-f0-9-]+)/)?.[1],
        replacement: 'SHARED_SDK: Good writing starts with a clear next step.',
        reason: 'Fixture suggestion.',
      };
    }
  }
  const delta = name
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'call_' + results.length,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      }
    : { role: 'assistant', content: 'Your proposals are ready for review.' };
  res.write(
    'data: ' +
      JSON.stringify({
        id: 'fixture',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'fixture',
        choices: [{ index: 0, delta, finish_reason: name ? 'tool_calls' : 'stop' }],
      }) +
      '\n\n'
  );
  res.end('data: [DONE]\n\n');
}
const provider = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  if (holdNext) {
    holdNext = false;
    return;
  }
  try {
    respond(body, res);
  } catch (e) {
    console.error(e);
    res.destroy(e);
  }
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${provider.address().port}/v1`;
const profile = mkdtempSync(join(tmpdir(), 'byoa-two-app-'));
const extension = fileURLToPath(new URL('../../dist', import.meta.url));
const browser = spawn(
  process.env.CHROME_FOR_TESTING_BIN,
  [
    '--headless=new',
    ...chromeSandboxArgs(),
    '--disable-background-networking',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-mock-keychain',
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
);
const cdp = new CdpPipe(browser);
const send = (method, params = {}, session) =>
  Promise.race([
    cdp.send(method, params, session),
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 12000);
      t.unref();
    }),
  ]);
async function page(url) {
  const existing = url.includes('/src/connect/')
    ? (await send('Target.getTargets')).targetInfos.find((target) => target.url === url)
    : undefined;
  const { targetId } = existing || (await send('Target.createTarget', { url: 'about:blank' }));
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  if (!existing) await send('Page.navigate', { url }, sessionId);
  const evaluate = async (expression) => {
    const r = await send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const click = async (selector) => {
    await send('Page.bringToFront', {}, sessionId);
    const coords = await evaluate(
      `(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});await new Promise(requestAnimationFrame);const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`
    );
    await send(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', button: 'left', clickCount: 1, ...coords },
      sessionId
    );
    await send(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', button: 'left', clickCount: 1, ...coords },
      sessionId
    );
  };
  return { sessionId, evaluate, click };
}
try {
  const worker = await waitFor(
    async () =>
      (await send('Target.getTargets')).targetInfos.find(
        (t) => t.type === 'service_worker' && t.url.endsWith('/service-worker-loader.js')
      ),
    'worker'
  );
  const ext = await page(`chrome-extension://${new URL(worker.url).host}/src/options/index.html`);
  await waitFor(() => ext.evaluate(`document.readyState==='complete'&&!!chrome.tabs`), 'options');
  assert.equal(await ext.evaluate(`chrome.runtime.getManifest().name`), 'BYOA');
  assert.equal(await ext.evaluate(`document.title`), 'BYOA: settings');
  await ext.evaluate(
    `chrome.storage.local.get('config').then(({config})=>chrome.storage.local.set({config:{...config,schemaVersion:2,agents:[{id:'fixture',name:'Demo deepseek',provider:'openai',apiProtocol:'openai-chat-completions',model:'fixture',endpoint:${JSON.stringify(endpoint)},temperature:0.7,maxSteps:8,isDefault:true}],defaultAgentId:'fixture'}}))`
  );
  const board = await page('http://localhost:5174/');
  await waitFor(
    () =>
      board.evaluate(
        `document.querySelectorAll('.card').length===9 && document.querySelector('#tool-status').textContent==='3 page tools ready'`
      ),
    'board & tools'
  );
  await waitFor(
    () =>
      board.evaluate(
        `document.querySelector('#connection-menu').textContent.includes('BYOA will ask you')`
      ),
    'board SDK bridge'
  );
  const tabId = await ext.evaluate(
    `chrome.tabs.query({url:'http://localhost:5174/*'}).then(t=>t[0].id)`
  );
  const catalog = await ext.evaluate(
    `chrome.runtime.sendMessage({type:'WEBMCP_GET_TOOLS',tabId:${tabId}})`
  );
  assert.ok(catalog.success && catalog.data.some((t) => t.name === 'propose_board_changes'));
  await board.click('#agent-indicator');
  await board.click('[data-action="connect"]');
  const firstPromptTarget = await waitFor(
    async () =>
      (await send('Target.getTargets')).targetInfos.find((target) =>
        target.url.includes('/src/connect/index.html#')
      ),
    'BYOA connection popup'
  );
  const firstPrompt = await page(firstPromptTarget.url);
  await waitFor(
    () => firstPrompt.evaluate(`document.querySelectorAll('input[name="profile"]').length===1`),
    'single profile in BYOA popup'
  );
  assert.equal(
    await firstPrompt.evaluate(`document.querySelector('#origin').textContent`),
    'http://localhost:5174'
  );
  assert.ok(
    await board.evaluate(
      `!document.querySelector('input[name="agent-profile"]') && document.querySelector('#agent-indicator').textContent.includes('Not connected')`
    )
  );
  await firstPrompt.click('#approve');
  await waitFor(
    () =>
      board.evaluate(
        `document.querySelector('#agent-indicator').textContent.includes('Demo deepseek')`
      ),
    'connected name'
  );
  await board.click('#agent-indicator');
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
    board.sessionId
  );
  writeFileSync(
    join(tmpdir(), 'boardwalk-desktop.png'),
    Buffer.from(
      (await send('Page.captureScreenshot', { format: 'png' }, board.sessionId)).data,
      'base64'
    )
  );
  // Cancelling the extension-owned picker leaves the existing connection untouched.
  await board.click('#agent-indicator');
  await waitFor(
    () => board.evaluate(`!document.querySelector('[data-action="connect"]').disabled`),
    'connection request settled'
  );
  await board.click('[data-action="connect"]');
  const cancelTarget = await waitFor(
    async () =>
      (await send('Target.getTargets')).targetInfos.find((target) =>
        target.url.includes('/src/connect/index.html#')
      ),
    'profile switch popup'
  );
  const cancelPrompt = await page(cancelTarget.url);
  await waitFor(
    () => cancelPrompt.evaluate(`!document.querySelector('#approve').disabled`),
    'switch popup ready'
  );
  await cancelPrompt.click('#cancel');
  await waitFor(
    () => board.evaluate(`document.querySelector('#toast')?.textContent.includes('cancelled')`),
    'cancelled connection result'
  );
  assert.ok(
    await board.evaluate(
      `document.querySelector('#agent-indicator').textContent.includes('Demo deepseek')`
    )
  );
  await board.click('#agent-indicator');
  console.log(
    'PASS extension-owned picker approval and cancellation; the app never renders a profile list.'
  );
  // An ordinary manual create/move/undo round trip works independently of an agent.
  await board.click('[data-action="new"]');
  await board.evaluate(`document.querySelector('#card-title').value='Manual browser test card'`);
  await board.click('#card-form button[type="submit"]');
  assert.equal(await board.evaluate(`document.querySelectorAll('.card').length`), 10);
  await board.evaluate(
    `(()=>{const e=[...document.querySelectorAll('[data-move]')].find(e=>e.closest('.card').textContent.includes('Manual browser'));e.value='done';e.dispatchEvent(new Event('change',{bubbles:true}));})()`
  );
  assert.ok(
    await board.evaluate(
      `document.querySelector('[data-column="done"]').textContent.includes('Manual browser')`
    )
  );
  await board.click('[data-action="undo"]');
  await board.click('[data-action="undo"]');
  assert.equal(await board.evaluate(`document.querySelectorAll('.card').length`), 9);
  // Revisions intentionally remain monotonic after undo. Reset the isolated fixture below.
  console.log('PASS manual create, move, and undo.');
  // Reset this isolated demo's storage so the deterministic provider starts at revision 1.
  await board.evaluate(`localStorage.removeItem('boardwalk-v1')`);
  await send('Page.navigate', { url: 'http://localhost:5174/' }, board.sessionId);
  await waitFor(
    () =>
      board.evaluate(
        `document.querySelector('#tool-status')?.textContent==='3 page tools ready'&&document.querySelector('#agent-indicator')?.textContent.includes('Demo deepseek')`
      ),
    'board reload'
  );
  await waitFor(async () => {
    const result = await ext.evaluate(
      `chrome.runtime.sendMessage({type:'WEBMCP_GET_TOOLS',tabId:${tabId}})`
    );
    return (
      result?.success &&
      ['get_board_snapshot', 'get_selected_cards', 'propose_board_changes'].every((name) =>
        result.data.some((tool) => tool.name === name)
      )
    );
  }, 'extension tool discovery after board reload');
  await board.click('[data-select="onboarding"]');
  await board.click('[data-action="ask"]');
  await board.evaluate(
    `document.querySelector('#instruction').value='Break the selected card into smaller tasks.'`
  );
  await board.click('#send-button');
  await waitFor(
    () =>
      board.evaluate(
        `document.querySelector('#task-status')?.textContent.includes('A little progress, together.')`
      ),
    'board task done',
    30000
  );
  assert.equal(requests.length, 4);
  assert.equal(await board.evaluate(`document.querySelectorAll('.card').length`), 9);
  assert.ok(
    await board.evaluate(
      `document.querySelector('#proposals').textContent.includes('Map the first onboarding screen')`
    )
  );
  assert.ok(
    !(await send('Target.getTargets')).targetInfos.some((t) => t.url.includes('/src/sidebar/'))
  );
  writeFileSync(
    join(tmpdir(), 'boardwalk-review.png'),
    Buffer.from(
      (await send('Page.captureScreenshot', { format: 'png' }, board.sessionId)).data,
      'base64'
    )
  );
  await board.click('[data-accept]');
  assert.equal(await board.evaluate(`document.querySelectorAll('.card').length`), 9);
  assert.equal(await board.evaluate(`document.querySelectorAll('.column').length`), 5);
  assert.ok(
    await board.evaluate(
      `document.querySelector('[data-column="ready"] h2').textContent==='Up next' && !document.querySelector('[data-card="empty-state"]')`
    )
  );
  assert.ok(
    await board.evaluate(
      `document.querySelector('[data-column="next-week"]').textContent.includes('Make the first five minutes')`
    )
  );
  console.log(
    'PASS board → SDK → background agent → 3 WebMCP tools → pending batch → user accepts card deletion and column create/rename/move; no sidebar.'
  );
  await ext.evaluate(
    `chrome.storage.local.get('config').then(({config})=>chrome.storage.local.set({config:{...config,agents:[...config.agents,{...config.agents[0],id:'second-fixture',name:'Second profile',model:'second-fixture',isDefault:false}]}}))`
  );
  const margin = await page('http://localhost:5173/');
  await margin.evaluate(
    `window.__events=[];window.addEventListener('message',e=>{if(e.data?.kind==='task')window.__events.push(e.data.event)})`
  );
  await waitFor(
    () =>
      margin.evaluate(
        `!!document.querySelector('.tiptap p')&&!!document.querySelector('.agent-connection-button')`
      ),
    'Margin'
  );
  await waitFor(
    () =>
      margin.evaluate(
        `document.querySelector('.agent-connection-control')?.dataset.providerReady==='true'`
      ),
    'Margin extension attached'
  );
  await margin.click('.agent-connection-button');
  await waitFor(
    () =>
      margin.evaluate(
        `document.querySelector('#agent-connection-menu')?.textContent.includes('BYOA will ask you')`
      ),
    'Margin SDK'
  );
  await margin.click('#agent-connection-menu .primary');
  const secondTarget = await waitFor(
    async () =>
      (await send('Target.getTargets')).targetInfos.find((target) =>
        target.url.includes('/src/connect/index.html#')
      ),
    'Margin BYOA popup'
  );
  const secondPrompt = await page(secondTarget.url);
  await waitFor(
    () => secondPrompt.evaluate(`document.querySelectorAll('input[name="profile"]').length===2`),
    'all profiles in BYOA popup'
  );
  assert.equal(
    await secondPrompt.evaluate(`document.querySelector('#origin').textContent`),
    'http://localhost:5173'
  );
  assert.equal(
    await margin.evaluate(`document.querySelectorAll('input[name="agent-profile"]').length`),
    0
  );
  await secondPrompt.click('input[value="second-fixture"]');
  await secondPrompt.click('#approve');
  await waitFor(
    () =>
      margin.evaluate(
        `document.querySelector('.agent-connection-button').textContent.includes('Second profile')`
      ),
    'Margin connected independently'
  );
  await margin.click('.agent-connection-button');
  const selectMargin = async () => {
    await margin.evaluate(
      `(()=>{const p=document.querySelector('.tiptap p');p.closest('[contenteditable]').focus();const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`
    );
    await waitFor(
      () => margin.evaluate(`!!document.querySelector('.margin-selection-popup')`),
      'Margin popup'
    );
    await margin.evaluate(
      `[...document.querySelectorAll('.margin-selection-popup button')].find(b=>b.textContent==='Suggest replacement').click()`
    );
    await waitFor(() => margin.evaluate(`!!document.querySelector('.agent-send')`), 'Margin send');
  };
  await selectMargin();
  await margin.click('.agent-send');
  await waitFor(
    () =>
      margin.evaluate(
        `document.querySelector('.margin-selection-popup [role="status"]')?.textContent==='Ready for review.'`
      ),
    'Margin done',
    30000
  );
  assert.ok(
    await margin.evaluate(`document.querySelector('.tiptap').textContent.includes('SHARED_SDK')`)
  );
  assert.equal(requests.length, 7);
  console.log(
    'PASS Margin uses the same SDK and bridge, with its own 5-tool scope and inline suggestion.'
  );
  // Hold a board model request, queue a Margin request, cancel only the queued task.
  holdNext = true;
  await board.click('[data-action="close-review"]');
  await board.click('[data-action="ask"]');
  await board.evaluate(`document.querySelector('#instruction').value='Review board'`);
  await board.click('#send-button');
  await waitFor(() => requests.length === 8, 'held board request');
  await selectMargin();
  await margin.click('.agent-send');
  await waitFor(
    () => margin.evaluate(`window.__events.at(-1)?.status==='queued'`),
    'Margin queued'
  ).catch(async (e) => {
    console.log(
      'QUEUE DEBUG',
      await margin.evaluate(
        `({events:window.__events,popup:document.querySelector('.margin-selection-popup')?.innerText})`
      )
    );
    throw e;
  });
  assert.equal(requests.length, 8);
  await margin.click('.agent-send + button');
  await waitFor(
    () =>
      margin.evaluate(
        `document.querySelector('.margin-selection-popup [role="status"]')?.textContent.includes('Cancelled')`
      ),
    'queued cancellation'
  );
  assert.equal(requests.length, 8);
  // Revoking only the board origin stops its held request, while Margin remains connected.
  await board.click('#agent-indicator');
  await board.click('[data-action="disconnect"]');
  await waitFor(
    () =>
      board.evaluate(`document.querySelector('#task-status').textContent.includes('Task stopped')`),
    'revocation cancellation'
  );
  assert.ok(
    await margin.evaluate(
      `document.querySelector('.agent-connection-button').textContent.includes('Second profile')`
    )
  );
  console.log(
    'PASS cross-app queuing, queued cancellation, and origin-scoped disconnect while a model request waits.'
  );
  // Optional conversation opens only on an explicit user click and focuses the correct task.
  await board.click('[data-action="chat"]');
  const focused = await waitFor(
    () =>
      ext.evaluate(
        `chrome.storage.session.get('agentboard_chat_focus_${tabId}').then(s=>s['agentboard_chat_focus_${tabId}'])`
      ),
    'chat task focus'
  );
  assert.ok(focused.taskId);
  const sidebar = await page(
    `chrome-extension://${new URL(worker.url).host}/src/sidebar/index.html#tab=${tabId}`
  );
  await waitFor(
    () =>
      sidebar.evaluate(
        `!!document.querySelector('#site-agent-chat [data-task-id="${focused.taskId}"]')`
      ),
    'correct task transcript'
  );
  console.log('PASS optional chat restores the correct task transcript.');
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    board.sessionId
  );
  await board.evaluate(`document.querySelector('#connection-menu').hidden=true`);
  assert.ok(await board.evaluate(`document.documentElement.scrollWidth<=innerWidth`));
  writeFileSync(
    join(tmpdir(), 'boardwalk-mobile.png'),
    Buffer.from(
      (await send('Page.captureScreenshot', { format: 'png' }, board.sessionId)).data,
      'base64'
    )
  );
  console.log('PASS mobile layout fits the viewport. No real provider credentials used.');
} finally {
  provider.closeAllConnections();
  provider.close();
  await send('Browser.close').catch(() => {});
  browser.kill();
  if (browser.exitCode === null)
    await Promise.race([
      new Promise((r) => browser.once('close', r)),
      new Promise((r) => setTimeout(r, 1000)),
    ]);
  rmSync(profile, { recursive: true, force: true });
}
