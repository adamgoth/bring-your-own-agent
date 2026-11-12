import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { CdpPipe, chromeSandboxArgs, waitFor } from './chrome-harness.mjs';

const demoHost = process.env.BYOA_DEMO_HOST || 'localhost';
assert.ok(['localhost', '127.0.0.1'].includes(demoHost));
const boardOrigin = `http://${demoHost}:${process.env.BYOA_BOARD_PORT || 5184}`;
const marginOrigin = `http://${demoHost}:${process.env.BYOA_MARGIN_PORT || 5183}`;
const requests = [];
let holdNext = false;
const heldResponses = [];
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
  if (user.includes('Recovery fixture') || user.includes('Restart fixture')) {
    // Recovery tests need a held stream, not another proposal.
  } else if (user.includes('SIDEBAR_ISOLATION_FIXTURE')) {
    // Sidebar has its own broader tool set; return text without calling a tool.
  } else if (board) {
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
  } else if (names.includes('suggest_title')) {
    assert.deepEqual(names, ['suggest_title']);
    assert.equal(body.model, 'second-fixture');
    if (results.length === 0) {
      name = 'suggest_title';
      args = { requestId: user.match(/Title request ID: ([a-f0-9-]+)/)?.[1], title: 'Reading Group Invitation' };
    }
  } else if (names.includes('propose_document')) {
    assert.deepEqual(names, ['propose_document']);
    assert.equal(body.model, 'second-fixture');
    if (results.length === 0) {
      name = 'propose_document';
      args = { requestId: user.match(/Draft request ID: ([a-f0-9-]+)/)?.[1], markdown: '# A first draft\n\nDRAFT_FIXTURE: Welcome to the reading group.' };
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
        usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 },
      }) +
      '\n\n'
  );
  res.end('data: [DONE]\n\n');
}
const provider = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/protocol-fixture') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<script>window.__observed=[];addEventListener('message',e=>{if(e.data?.source==='agentboard:extension')__observed.push(e.data)});addEventListener('agent:announceProvider',e=>{__observed.push({announcement:true});window.__rawProvider=e.detail.provider;window.__providerInfo=e.detail.info});</script><title>Protocol fixture</title>`);
    return;
  }
  if (req.method !== 'POST') { res.writeHead(204); res.end(); return; }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  if (holdNext) {
    holdNext = false;
    heldResponses.push(() => respond(body, res));
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
const launchBrowser = () => spawn(
  process.env.CHROME_FOR_TESTING_BIN,
  [
    '--headless=new',
    ...chromeSandboxArgs(),
    '--disable-background-networking',
    '--disable-blink-features=WebMCP', // Exercise the shipped polyfill consistently across Chrome versions.
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
let browser = launchBrowser();
let cdp = new CdpPipe(browser);
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
  let ext = await page(`chrome-extension://${new URL(worker.url).host}/src/options/index.html`);
  await waitFor(() => ext.evaluate(`document.readyState==='complete'&&!!chrome.tabs`), 'options');
  assert.equal(await ext.evaluate(`chrome.runtime.getManifest().name`), 'BYOA');
  assert.equal(await ext.evaluate(`document.title`), 'BYOA: settings');
  await ext.evaluate(
    `chrome.storage.local.get('config').then(({config})=>chrome.storage.local.set({config:{...config,schemaVersion:2,agents:[{id:'fixture',name:'Demo deepseek',provider:'openai',apiProtocol:'openai-chat-completions',model:'fixture',endpoint:${JSON.stringify(endpoint)},temperature:0.7,maxSteps:8,isDefault:true}],defaultAgentId:'fixture'}}))`
  );
  const rawPage = await page(`http://127.0.0.1:${provider.address().port}/protocol-fixture`);
  await rawPage.evaluate(`new Promise(resolve=>setTimeout(resolve,300))`);
  assert.deepEqual(await rawPage.evaluate(`window.__observed`), [], 'No-request page receives no provider announcements or messages');
  await rawPage.evaluate(`window.dispatchEvent(new Event('agent:requestProvider'))`);
  await waitFor(() => rawPage.evaluate(`!!window.__rawProvider`), 'raw provider discovery');
  assert.equal(await rawPage.evaluate(`window.__observed.filter(e=>e.announcement).length`), 1);
  assert.equal(await rawPage.evaluate(`window.__observed.filter(e=>!e.announcement).length`), 0, 'Discovery alone sends no transport messages');
  const rawStatus = await rawPage.evaluate(`window.__rawProvider.request({method:'agent_status'})`);
  assert.equal(rawStatus.available, true); assert.equal(rawStatus.connected, false);
  assert.equal(await rawPage.evaluate(`window.__rawProvider.request({method:'unknown'}).catch(e=>e.code)`), 4200);
  assert.equal(await rawPage.evaluate(`window.__rawProvider.request({method:'agent_openSettings'}).catch(e=>e.code)`), 4100);
  await rawPage.evaluate(`window.postMessage({source:'agentboard:page',version:1,id:'v1-synthetic',method:'status'},location.origin)`);
  await waitFor(() => rawPage.evaluate(`window.__observed.some(e=>e.kind==='response'&&e.id==='v1-synthetic'&&e.ok&&e.value.available)`), 'v1 pasted client compatibility');
  console.log('PASS silent page, request-only raw discovery, raw errors and v1 compatibility.');
  let board = await page(`${boardOrigin}/`);
  await board.evaluate(`window.__events=[];window.addEventListener('message',e=>{if(e.data?.kind==='task')window.__events.push(e.data.event)})`);
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
  let tabId = await ext.evaluate(
    `chrome.tabs.query({url:${JSON.stringify(boardOrigin + '/*')}}).then(t=>Math.max(...t.map(tab=>tab.id)))`
  );
  await waitFor(async () => {
    const catalog = await ext.evaluate(
      `chrome.runtime.sendMessage({type:'WEBMCP_GET_TOOLS',tabId:${tabId}})`
    );
    return catalog.success && catalog.data.some((t) => t.name === 'propose_board_changes');
  }, 'Boardwalk tools in the extension catalog');
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
    boardOrigin
  );
  assert.ok(
    await board.evaluate(
      `!document.querySelector('input[name="agent-profile"]') && document.querySelector('#agent-indicator').textContent.includes('Not connected')`
    )
  );
  assert.ok(await firstPrompt.evaluate(`document.querySelector('#sharing').hidden`), 'Sharing hidden without a workspace');
  assert.equal(await firstPrompt.evaluate(`document.querySelectorAll('#sharing input:checked').length`), 0, 'Sharing defaults off');
  assert.equal(await firstPrompt.evaluate(`document.querySelector('#persist').value`), 'session');
  await firstPrompt.evaluate(`document.querySelector('#persist').value='days30'`);
  await firstPrompt.click('#approve');
  await waitFor(
    () =>
      board.evaluate(
        `document.querySelector('#agent-indicator').textContent.includes('Demo deepseek')`
      ),
    'connected name'
  );
  // Restart the actual browser with the same temporary profile; session storage is lost.
  const optionsUrl = `chrome-extension://${new URL(worker.url).host}/src/options/index.html`;
  await send('Browser.close');
  if (browser.exitCode === null) await new Promise(resolve => browser.once('close', resolve));
  browser = launchBrowser(); cdp = new CdpPipe(browser);
  ext = await page(optionsUrl);
  await waitFor(() => ext.evaluate(`document.readyState==='complete'&&!!chrome.tabs`), 'restarted options');
  board = await page(`${boardOrigin}/?integration=active`);
  await waitFor(() => board.evaluate(`document.querySelector('#agent-indicator')?.textContent.includes('Demo deepseek')`), 'persistent connection after restart');
  await waitFor(() => ext.evaluate(`document.querySelector('[data-origin="${boardOrigin}"]')?.textContent.includes('For 30 days')`), 'connected sites duration');
  tabId = await ext.evaluate(`chrome.tabs.query({url:${JSON.stringify(boardOrigin + '/*')}}).then(t=>t.find(tab=>tab.url.includes('?integration=active'))?.id)`);
  console.log('PASS 30-day approval survives a real browser restart and appears in Connected sites.');
  await board.evaluate(`window.addEventListener('agent:announceProvider',e=>window.__rawProvider=e.detail.provider);window.dispatchEvent(new Event('agent:requestProvider'));window.__rawEvents=[];window.__rawProvider.on('task',e=>window.__rawEvents.push(e));const b=document.createElement('button');b.id='raw-task';b.textContent='Raw task';b.style='position:fixed;top:100px;left:500px;z-index:99999';b.onclick=()=>window.__rawProvider.request({method:'agent_requestTask',params:{prompt:'Recovery fixture raw provider',tools:['get_board_snapshot','get_selected_cards','propose_board_changes']}}).then(v=>window.__rawTask=v).catch(e=>window.__rawError={message:e.message,code:e.code});document.body.append(b);`);
  await board.click('#raw-task');
  try { await waitFor(() => board.evaluate(`!!window.__rawTask&&window.__rawEvents.some(e=>e.taskId===window.__rawTask.taskId&&!e.busy)`), 'raw provider task without SDK'); } catch(error) { console.error('Raw task fixture:', await board.evaluate(`({task:window.__rawTask,events:window.__rawEvents,error:window.__rawError})`)); throw error; }
  assert.equal(await board.evaluate(`window.__rawEvents.at(-1).usage.totalTokens`), 100);
  assert.equal(await board.evaluate(`JSON.stringify(window.__rawEvents).includes('inputPerMillion')`), false);
  await board.evaluate(`document.querySelector('#raw-task').remove()`);
  console.log('PASS raw provider task without SDK, terminal progress and token-only usage.');
  requests.length = 0; // Keep the existing demo wire-count assertions scoped to demo requests.

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
  await board.evaluate(`document.querySelector('#connection-menu').hidden=true`);
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
  assert.equal(await cancelPrompt.evaluate(`document.querySelector('#persist').value`), 'days30');
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
  await send('Page.navigate', { url: `${boardOrigin}/` }, board.sessionId);
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
  await board.evaluate(`window.__events=[];window.addEventListener('message',e=>{if(e.data?.kind==='task')window.__events.push(e.data.event)})`);
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
  assert.equal(await board.evaluate(`window.__events.at(-1).usage.totalTokens`), 400);
  assert.equal(await board.evaluate(`window.__events.at(-1).usage.usageKnown`), true);
  assert.equal(await board.evaluate(`'costUsd' in window.__events.at(-1).usage`), false);
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
  const margin = await page(`${marginOrigin}/`);
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
    marginOrigin
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
    await send('Page.bringToFront', {}, margin.sessionId);
    // Let ProseMirror settle its focus selection before selecting the passage.
    await margin.evaluate(`new Promise(resolve => { document.querySelector('.tiptap').focus(); setTimeout(resolve, 100); })`);
    await margin.evaluate(
      `(()=>{const p=document.querySelector('.tiptap p');p.closest('[contenteditable]').focus();const text=document.createTreeWalker(p,NodeFilter.SHOW_TEXT).nextNode();const r=document.createRange();r.selectNodeContents(text);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`
    );
    await waitFor(
      () => margin.evaluate(`!!document.querySelector('.margin-selection-popup')`),
      'Margin popup'
    );
    await margin.evaluate(
      `[...document.querySelectorAll('.margin-selection-popup button')].find(b=>b.textContent==='Improve this').click()`
    );
    await waitFor(() => margin.evaluate(`!!document.querySelector('.agent-send')`), 'Margin send');
  };
  const submitMarginWithKeyboard = async (modifiers) => {
    await send('Page.bringToFront', {}, margin.sessionId);
    // Expire previous clicks so this request proves keyboard activation works.
    await margin.evaluate(`new Promise(resolve => setTimeout(resolve, 1700))`);
    await margin.evaluate(`(async () => {
      document.querySelector('.selected-passage').scrollIntoView({block:'center'});
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      document.querySelector('#agent-instruction').focus({preventScroll:true});
    })()`);
    await waitFor(() => margin.evaluate(`document.activeElement?.id==='agent-instruction'`), 'keyboard prompt focus');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers }, margin.sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers }, margin.sessionId);
  };
  await selectMargin();
  await margin.evaluate(`new Promise(resolve => setTimeout(resolve, 1700))`);
  const beforeSyntheticShortcut = requests.length;
  await margin.evaluate(`document.querySelector('#agent-instruction').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }))`);
  await waitFor(() => margin.evaluate(`window.__events.at(-1)?.status==='error' && window.__events.at(-1)?.detail.includes('button click or Command/Ctrl+Enter')`), 'synthetic shortcut rejected');
  assert.equal(requests.length, beforeSyntheticShortcut);
  await submitMarginWithKeyboard(4);
  await waitFor(
    () =>
      margin.evaluate(
        `window.__events.at(-1)?.status==='done' && !document.querySelector('.margin-selection-popup') && !!document.querySelector('.suggestion-insertion')`
      ),
    'Margin done',
    30000
  );
  assert.ok(
    await margin.evaluate(`document.querySelector('.tiptap').textContent.includes('SHARED_SDK')`)
  );
  assert.equal(requests.length, 7);
  console.log(
    'PASS trusted Command+Enter starts a task after click activation expires; synthetic shortcuts are rejected. Margin retains its 5-tool scope.'
  );
  // Hold both apps to prove overlap before either finishes.
  holdNext = true;
  await board.click('[data-action="close-review"]');
  await board.click('[data-action="ask"]');
  await board.evaluate(`document.querySelector('#instruction').value='Review board'`);
  await board.click('#send-button');
  await waitFor(() => requests.length === 8, 'held board request');
  holdNext = true;
  await selectMargin();
  await submitMarginWithKeyboard(2);
  await waitFor(() => requests.length === 9, 'concurrent Margin request');
  assert.equal(await margin.evaluate(`window.__events.at(-1)?.status`), 'working');
  assert.ok(await board.evaluate(`document.querySelector('#task-status').textContent.includes('working')`));
  const isolationSidebar = await page(
    `chrome-extension://${new URL(worker.url).host}/src/sidebar/index.html#tab=${tabId}`
  );
  await waitFor(() => isolationSidebar.evaluate(`document.querySelector('#message-input')?.disabled === false && document.querySelector('.agent-switcher-label')?.textContent === 'Demo deepseek' && document.querySelector('.chat-container')?.hidden === false`), 'sidebar ready');
  await isolationSidebar.evaluate(`document.querySelector('#message-input').value='SIDEBAR_ISOLATION_FIXTURE'; document.querySelector('#message-input').dispatchEvent(new Event('input', { bubbles: true }))`);
  await isolationSidebar.evaluate(`document.querySelector('#send-button').click()`);
  await waitFor(() => requests.length === 10, 'sidebar alongside two site tasks');
  await waitFor(() => isolationSidebar.evaluate(`document.querySelector('#messages').textContent.includes('Your proposals are ready')`), 'sidebar completed independently');
  heldResponses.shift()();
  heldResponses.shift()();
  await waitFor(() => margin.evaluate(`window.__events.at(-1)?.status==='done'`), 'Margin completes after sidebar');
  await waitFor(() => board.evaluate(`document.querySelector('#task-status').textContent.includes('A little progress, together.')`), 'Board completes after sidebar');
  console.log('PASS two apps reach working together; sidebar completes without cancelling either site task.');
  // Start a fresh held task for origin-scoped revocation.
  holdNext = true;
  await board.click('[data-action="ask"]');
  await board.evaluate(`document.querySelector('#instruction').value='Review board'`);
  const beforeRevocation = requests.length;
  await board.click('#send-button');
  await waitFor(() => requests.length === beforeRevocation + 1, 'held revocation request');
  // Revoking only the board origin stops its held request, while Margin remains connected.
  await board.click('#agent-indicator');
  await ext.click(`[data-origin="${boardOrigin}"] [data-action="disconnect"]`);
  await waitFor(() => board.evaluate(`document.querySelector('#agent-indicator').textContent.includes('Not connected')`), 'Options disconnect reaches app');
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
    'PASS origin-scoped disconnect while a model request waits.'
  );
  console.log('PASS Options revocation disconnects the app and cancels its running persistent task.');
  heldResponses.shift()(); // Dispose of the cancelled provider response before recovery fixtures.
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
  await send('Page.bringToFront', {}, margin.sessionId);
  await margin.evaluate(`[...document.querySelectorAll('.library-actions button')].find(button => button.textContent.includes('New document')).click()`);
  await waitFor(() => margin.evaluate(`!!document.querySelector('#draft-description')`), 'empty document draft prompt');
  await margin.evaluate(`(() => {
    const input = document.querySelector('#draft-description');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Write an invitation to a reading group.');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(() => margin.evaluate(`!document.querySelector('.draft-starter button[type="submit"]').disabled`), 'draft prompt ready');
  await margin.click('.draft-starter button[type="submit"]');
  await waitFor(() => margin.evaluate(`document.querySelector('.draft-preview')?.textContent.includes('DRAFT_FIXTURE') && !document.querySelector('.draft-use').disabled`), 'draft preview', 30000);
  assert.equal(await margin.evaluate(`document.querySelector('.tiptap').textContent`), '');
  await margin.click('.draft-use');
  await waitFor(() => margin.evaluate(`document.querySelector('.tiptap').textContent.includes('DRAFT_FIXTURE') && !document.querySelector('.draft-preview')`), 'accepted draft');
  console.log('PASS empty document → scoped draft tool → separate preview → explicit acceptance.');
  await margin.click('.suggest-title');
  await waitFor(() => margin.evaluate(`document.querySelector('.document-title').value==='Reading Group Invitation'`), 'suggested title', 30000);
  assert.ok(await margin.evaluate(`document.querySelector('.tiptap').textContent.includes('DRAFT_FIXTURE')`));
  console.log('PASS one-click title suggestion uses its own tool scope and preserves the writing.');

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
  // Capture the real task port in the extension's isolated content world, never in page JS.
  const contentContext = await waitFor(() => [...cdp.contexts.values()].find(context =>
    context.sessionId === margin.sessionId && context.origin === `chrome-extension://${new URL(worker.url).host}`), 'Margin content world');
  const contentEval = async expression => {
    const result = await send('Runtime.evaluate', { expression, contextId: contentContext.id, awaitPromise: true, returnByValue: true }, margin.sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || 'Content-world evaluation failed');
    return result.result?.value;
  };
  await contentEval(`(() => {
    const original = chrome.runtime.connect.bind(chrome.runtime);
    globalThis.__taskPorts = [];
    chrome.runtime.connect = (...args) => { const port = original(...args); if (port.name === 'agentboard-task') __taskPorts.push(port); return port; };
  })()`);
  const liveWorker = await waitFor(async () => (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url === worker.url), 'live worker');
  const { sessionId: workerSession } = await send('Target.attachToTarget', { targetId: liveWorker.targetId, flatten: true });
  await send('Runtime.evaluate', { expression: `globalThis.__taskPorts=[]; chrome.runtime.onConnect.addListener(port=>{if(port.name==='agentboard-task') __taskPorts.push(port);});` }, workerSession);
  // Use Margin's real request wrapper so reload recovery persists the acknowledged ID.
  await margin.evaluate(`(async () => {
    const api = await import('/src/agentboard.ts'); window.__recoveryApi = api;
    const button = document.createElement('button'); button.id='recovery-request'; button.textContent='Recovery fixture';
    button.onclick=()=>{window.__recoveryDone=null; api.requestAgent('Recovery fixture', ['get_document_outline']).then(event=>window.__recoveryDone=event);};
    document.body.append(button);
  })()`);
  holdNext = true; const beforeDrop = requests.length;
  await margin.click('#recovery-request'); await waitFor(() => requests.length > beforeDrop, 'held recovery request');
  const recoveryId = await margin.evaluate(`JSON.parse(sessionStorage.getItem('margin-agent-request')).id`);
  const eventCount = await margin.evaluate('window.__events.length');
  await send('Runtime.evaluate', { expression: '__taskPorts.at(-1).disconnect()' }, workerSession);
  await waitFor(() => contentEval('__taskPorts.length>=2'), 'real port reattachment');
  heldResponses.shift()();
  await waitFor(() => margin.evaluate(`window.__recoveryDone?.status==='done'`), 'reattached completion');
  assert.equal(await margin.evaluate(`window.__events.slice(${eventCount}).some(event=>event.status==='error')`), false);
  assert.equal(await margin.evaluate(`window.__recoveryDone.taskId`), recoveryId);
  await send('Target.detachFromTarget', { sessionId: workerSession });
  console.log('PASS real task-port disconnect reattaches invisibly and completes on the same task.');

  holdNext = true; const beforeReload = requests.length;
  await margin.click('#recovery-request'); await waitFor(() => requests.length > beforeReload, 'held reload request');
  const reloadId = await margin.evaluate(`JSON.parse(sessionStorage.getItem('margin-agent-request')).id`);
  await send('Page.reload', {}, margin.sessionId);
  await waitFor(() => margin.evaluate(`!!document.querySelector('.task-recovery')`), 'Margin interrupted recovery banner', 20000);
  const lookup = await margin.evaluate(`import('/src/agentboard.ts').then(({agentboard})=>agentboard.getTask(${JSON.stringify(reloadId)}))`);
  assert.equal(lookup.busy, false); assert.equal(lookup.retryable, true);
  assert.equal(lookup.code, 'interrupted');
  assert.deepEqual(Object.keys(lookup).sort(), ['taskId','status','detail','busy','seq','code','retryable','usage'].sort());
  const taskCountAfterReload = requests.length;
  await new Promise(resolve=>setTimeout(resolve, 500));
  assert.equal(requests.length, taskCountAfterReload, 'Reload lookup must not automatically retry');
  heldResponses.shift()();
  await margin.click('.task-recovery button:first-of-type');
  await waitFor(() => requests.length === taskCountAfterReload + 1, 'trusted explicit retry request');
  await waitFor(() => margin.evaluate(`!document.querySelector('.task-recovery')`), 'retry completes and clears recovery');
  console.log('PASS reload stops the old run, SDK returns only a retryable terminal summary, and only the trusted Retry click sends a fresh request.');

  // Fixture-only budgets: one step overshoots a tiny task cap, then daily cap refuses without HTTP.
  await ext.evaluate(`chrome.storage.session.get('agentboard_connection_${marginOrigin}').then(v=>chrome.storage.session.set({['agentboard_connection_${marginOrigin}']:{...v['agentboard_connection_${marginOrigin}'],budget:{perTaskTokens:1}}}))`);
  const budgetBefore = requests.length;
  await margin.evaluate(`(async()=>{const api=await import('/src/agentboard.ts');const b=document.createElement('button');b.id='budget-request';b.textContent='Budget fixture';b.onclick=()=>api.requestAgent('Recovery fixture',['get_document_outline']).then(event=>window.__budgetDone=event);document.body.append(b);})()`);
  await margin.click('#budget-request');
  await waitFor(()=>margin.evaluate(`window.__budgetDone?.code==='budget'`),'one-step budget stop');
  assert.equal(requests.length-budgetBefore,1);
  assert.equal(await margin.evaluate(`window.__budgetDone.usage.totalTokens`),100);
  await ext.evaluate(`chrome.storage.session.get('agentboard_connection_${marginOrigin}').then(v=>chrome.storage.session.set({['agentboard_connection_${marginOrigin}']:{...v['agentboard_connection_${marginOrigin}'],budget:{perDayTokens:1}}}))`);
  await margin.evaluate(`window.__budgetDone=null`); await margin.click('#budget-request');
  await waitFor(()=>margin.evaluate(`window.__budgetDone?.code==='budget'`),'daily budget refusal');
  assert.equal(requests.length-budgetBefore,1);
  assert.equal(await margin.evaluate(`window.__budgetDone.usage.totalTokens`),0);
  await ext.evaluate(`chrome.storage.session.get('agentboard_connection_${marginOrigin}').then(v=>chrome.storage.session.set({['agentboard_connection_${marginOrigin}']:{...v['agentboard_connection_${marginOrigin}'],budget:{}}}))`);
  console.log('PASS cumulative token-only usage, one-step budget overshoot, and zero-request daily refusal.');

  // Stop the real MV3 worker mid-run. The reconnect wakes it and the startup sweep terminates the task.
  await margin.evaluate(`(async () => {
    const {requestAgent}=await import('/src/agentboard.ts');
    const button=document.createElement('button'); button.id='restart-request'; button.textContent='Restart fixture';
    button.onclick=()=>requestAgent('Restart fixture',['get_document_outline']); document.body.append(button);
  })()`);
  holdNext = true; const beforeRestart = requests.length;
  await margin.click('#restart-request'); await waitFor(() => requests.length > beforeRestart, 'held worker restart request');
  const workerToClose = await waitFor(async () => (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url === worker.url), 'worker to terminate');
  const { success: workerClosed } = await send('Target.closeTarget', { targetId: workerToClose.targetId });
  assert.equal(workerClosed, true);
  await ext.evaluate(`chrome.runtime.sendMessage({type:'PING'})`);
  const replacementWorker = await waitFor(async () => (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url === worker.url && target.targetId !== workerToClose.targetId), 'replacement worker', 5000).catch(() => null);
  if (replacementWorker) {
    try {
      await waitFor(() => margin.evaluate(`!!document.querySelector('.task-recovery')`), 'worker restart recovery banner', 40000);
    } catch (error) {
      console.error('Worker recovery summary:', await margin.evaluate(`import('/src/agentboard.ts').then(({agentboard})=>agentboard.getTask(JSON.parse(sessionStorage.getItem('margin-agent-request')).id))`));
      throw error;
    }
    const restarted = await margin.evaluate(`import('/src/agentboard.ts').then(({agentboard})=>agentboard.getTask(JSON.parse(sessionStorage.getItem('margin-agent-request')).id))`);
    assert.equal(restarted.code, 'interrupted'); assert.equal(restarted.busy, false);
    heldResponses.shift()();
    await margin.click('.task-recovery button:last-child');
    console.log('PASS real worker termination produces an interrupted terminal event after reconnect and startup sweep.');
  } else {
    await margin.evaluate(`import('/src/agentboard.ts').then(api=>api.cancelAgent())`);
    heldResponses.shift()();
    console.log('SKIP active-worker termination: Chrome kept the same worker target after closeTarget and a wake-up ping; startup interruption sweep is unit-tested.');
  }

  await ext.evaluate(`document.querySelector('#connected-sites [data-origin="${marginOrigin}"] select').value='forever'`);
  await ext.click(`[data-origin="${marginOrigin}"] [data-action="change-duration"]`);
  await waitFor(() => ext.evaluate(`document.querySelector('[data-origin="${marginOrigin}"] p').textContent.includes('Until I disconnect')`), 'forever duration saved');
  await send('Browser.close');
  if (browser.exitCode === null) await new Promise(resolve => browser.once('close', resolve));
  browser = launchBrowser(); cdp = new CdpPipe(browser);
  const reopened = await page(`${marginOrigin}/`);
  await waitFor(() => reopened.evaluate(`document.querySelector('.agent-connection-button')?.textContent.includes('Second profile')`), 'forever connection after restart');
  console.log('PASS until-disconnect approval survives a real browser restart.');
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
