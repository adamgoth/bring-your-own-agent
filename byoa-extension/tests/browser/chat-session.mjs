import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpPipe, chromeSandboxArgs, findChrome, waitFor } from './chrome-harness.mjs';

const requests = [];
let holdNext = false;
let release;
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Session fixture</title><h1>Session fixture</h1>');
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  const index = requests.length;
  const respond = () => {
    if (res.destroyed) return;
    const tool =
      body.messages.some((m) => m.role === 'user' && String(m.content).includes('USE_TOOL')) &&
      !body.messages.some((m) => m.role === 'tool');
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'fixture-call',
              type: 'function',
              function: { name: 'session_probe', arguments: '{}' },
            },
          ],
        }
      : { role: 'assistant', content: `Answer number ${index}` };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(
      `data: ${JSON.stringify({ id: `response-${index}`, object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\n`
    );
    res.end('data: [DONE]\n\n');
  };
  if (holdNext) {
    holdNext = false;
    release = respond;
  } else respond();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(path.join(tmpdir(), 'byoa-chat-session-'));
const extension = fileURLToPath(new URL('../../dist', import.meta.url));
const browser = spawn(
  findChrome({ forExtension: true }),
  [
    '--headless=new',
    ...chromeSandboxArgs(),
    '--disable-background-networking',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-mock-keychain',
    '--disable-blink-features=WebMCP',
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
);
const cdp = new CdpPipe(browser);
const send = (method, params = {}, session) => cdp.send(method, params, session);
async function page(url) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url }, sessionId);
  const evaluate = async (expression) => {
    const result = await send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text
      );
    return result.result.value;
  };
  return { targetId, sessionId, evaluate };
}
async function submit(view, text) {
  await waitFor(
    () =>
      view.evaluate(
        `!document.querySelector('#message-input').disabled && document.querySelector('.chat-container').hidden === false`
      ),
    'ready composer'
  );
  await view.evaluate(
    `(() => { const input=document.querySelector('#message-input'); input.value=${JSON.stringify(text)}; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#send-button').click(); })()`
  );
}
try {
  const worker = await waitFor(
    async () =>
      (await send('Target.getTargets')).targetInfos.find(
        (t) => t.type === 'service_worker' && t.url.endsWith('/service-worker-loader.js')
      ),
    'worker'
  );
  const base = `chrome-extension://${new URL(worker.url).host}`;
  const settings = await page(`${base}/src/options/index.html`);
  await settings.evaluate(
    `chrome.storage.local.set({config:{schemaVersion:2,defaultAgentId:'a',agents:['a','b'].map(id=>({id,name:'Agent '+id,provider:'openai',apiProtocol:'openai-chat-completions',model:id,endpoint:${JSON.stringify(origin + '/v1')},temperature:0,maxSteps:5})),mcpConfig:{mcpServers:{}},builtinScripts:[],userScripts:[],logLevel:'silent'}})`
  );
  const site = await page(`${origin}/page`);
  await waitFor(() => site.evaluate('!!document.modelContext'), 'WebMCP polyfill');
  await site.evaluate(
    `document.modelContext.registerTool({name:'session_probe',description:'Return synthetic test data',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:async()=>{window.toolRuns=(window.toolRuns||0)+1;return {content:[{type:'text',text:'SYNTHETIC_TOOL_RESULT'}]};}})`
  );
  const tabId = await settings.evaluate(
    `(async()=> (await chrome.tabs.query({})).find(t=>t.url===${JSON.stringify(origin + '/page')}).id)()`
  );
  const sidebarUrl = `${base}/src/sidebar/index.html#tab=${tabId}`;
  let view = await page(sidebarUrl);
  await waitFor(
    () =>
      settings.evaluate(
        `(async()=>!!(await chrome.storage.session.get('byoa_chat_session_${tabId}'))['byoa_chat_session_${tabId}'])()`
      ),
    'session initialized'
  );
  holdNext = true;
  await submit(view, 'USE_TOOL: inspect the synthetic page');
  await waitFor(() => requests.length === 1, 'first provider request');
  await send('Target.closeTarget', { targetId: view.targetId });
  view = await page(sidebarUrl);
  await waitFor(
    () =>
      view.evaluate(
        `document.querySelector('#send-button').classList.contains('stop-mode') && document.querySelector('#messages').textContent.includes('USE_TOOL')`
      ),
    'reattach to active turn'
  );
  assert.equal(requests.length, 1);
  await send('Target.closeTarget', { targetId: view.targetId });
  release();
  await waitFor(() => requests.length === 2, 'tool and follow-up while sidebar closed');
  await waitFor(
    () =>
      settings.evaluate(
        `(async()=> (await chrome.storage.session.get('byoa_chat_session_${tabId}'))['byoa_chat_session_${tabId}'].turns[0].status==='done')()`
      ),
    'detached completion'
  );
  assert.equal(
    await site.evaluate('window.toolRuns'),
    1,
    JSON.stringify({
      tools: requests[0].tools.map((t) => t.function.name),
      results: requests[1].messages.filter((m) => m.role === 'tool'),
    })
  );
  view = await page(sidebarUrl);
  await waitFor(
    () =>
      view.evaluate(`document.querySelector('#messages').textContent.includes('Answer number 2')`),
    'replayed answer'
  );
  assert.equal(requests.length, 2);
  assert.equal(await view.evaluate(`document.querySelectorAll('.tool-call-wrapper').length`), 1);
  await submit(view, 'What did you just do?');
  await waitFor(() => requests.length === 3, 'follow-up');
  assert.ok(JSON.stringify(requests[2].messages).includes('Answer number 2'));
  assert.ok(JSON.stringify(requests[2].messages).includes('fixture-call'));
  assert.ok(JSON.stringify(requests[2].messages).includes('[output not retained]'));
  await waitFor(
    () =>
      view.evaluate(`document.querySelector('#messages').textContent.includes('Answer number 3')`),
    'follow-up answer'
  );
  console.log(
    'PASS closed-sidebar tool execution; replay without rerun; structured follow-up history.'
  );

  holdNext = true;
  await submit(view, 'Hold this response');
  await waitFor(() => requests.length === 4, 'held response');
  await view.evaluate(`document.querySelector('[data-agent-id="b"]').click()`);
  await waitFor(
    () => view.evaluate(`document.querySelector('.agent-switcher-label').textContent==='Agent b'`),
    'selected second agent'
  );
  release();
  await waitFor(
    () =>
      view.evaluate(`document.querySelector('#messages').textContent.includes('Answer number 4')`),
    'old agent finishes'
  );
  await submit(view, 'Continue with the same history');
  await waitFor(() => requests.length === 5, 'new agent request');
  assert.equal(requests[4].model, 'b');
  assert.ok(JSON.stringify(requests[4].messages).includes('Answer number 4'));
  await waitFor(
    () =>
      view.evaluate(`document.querySelector('#messages').textContent.includes('Answer number 5')`),
    'new agent answer'
  );
  console.log('PASS agent switching preserves history and does not cancel the active response.');

  holdNext = true;
  await submit(view, 'Cancel this');
  await waitFor(() => requests.length === 6, 'cancel request');
  await view.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  await waitFor(
    () => view.evaluate(`document.querySelector('#messages').textContent.includes('Stopped.')`),
    'explicit cancellation'
  );
  release();
  await view.evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true}))`
  );
  await waitFor(
    () => view.evaluate(`document.querySelectorAll('.chat-session-turn').length===0`),
    'clear conversation'
  );
  await submit(view, 'Fresh history');
  await waitFor(() => requests.length === 7, 'fresh request');
  assert.ok(!JSON.stringify(requests[6].messages).includes('Answer number 5'));
  await waitFor(
    () =>
      view.evaluate(`document.querySelector('#messages').textContent.includes('Answer number 7')`),
    'fresh answer'
  );
  console.log('PASS explicit Stop and Clear; cleared history is not sent again.');
  holdNext = true;
  await submit(view, 'Restart this synthetic running response');
  await waitFor(() => requests.length === 8, 'request before worker restart');
  const runningWorker = (await send('Target.getTargets')).targetInfos.find(
    (t) => t.type === 'service_worker' && t.url === worker.url
  );
  assert.equal(
    (await send('Target.closeTarget', { targetId: runningWorker.targetId })).success,
    true
  );
  await waitFor(
    () =>
      view.evaluate(`document.querySelector('#messages').textContent.includes('BYOA restarted.')`),
    'sidebar interruption after real worker restart',
    40000
  );
  assert.equal(requests.length, 8, 'Worker restart must not repeat the request');
  release();
  await submit(view, 'Continue after the interrupted turn');
  await waitFor(() => requests.length === 9, 'explicit follow-up after restart');
  await waitFor(
    () =>
      view.evaluate(`document.querySelector('#messages').textContent.includes('Answer number 9')`),
    'post-restart answer'
  );
  assert.equal(requests[8].model, 'b');
  assert.ok(JSON.stringify(requests[8].messages).includes('Fresh history'));
  console.log(
    'PASS real worker restart restores history and selection, reports interruption, and never retries automatically.'
  );
  await send('Target.closeTarget', { targetId: site.targetId });
  await waitFor(
    () =>
      settings.evaluate(
        `(async()=>!('byoa_chat_session_${tabId}' in await chrome.storage.session.get(null)))()`
      ),
    'tab session cleanup'
  );
  console.log('PASS closing the bound tab deletes its session.');
} finally {
  browser.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => browser.once('exit', resolve));
  rmSync(profile, { recursive: true, force: true });
}
