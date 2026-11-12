import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpPipe, findChrome, chromeSandboxArgs, waitFor } from './chrome-harness.mjs';
const requests = [];
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.end(
      '<!doctype html><title>Site voice fixture</title><h1 id="heading">Original heading</h1>'
    );
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  const done = body.messages.some((m) => m.role === 'tool');
  const delta = done
    ? { role: 'assistant', content: 'Changed the fixture heading.' }
    : {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'edit-fixture',
            type: 'function',
            function: { name: 'edit_heading', arguments: '{"text":"Short heading"}' },
          },
        ],
      };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(
    'data: ' +
      JSON.stringify({
        id: 'fixture',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'fixture',
        choices: [{ index: 0, delta, finish_reason: done ? 'stop' : 'tool_calls' }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }) +
      '\n\ndata: [DONE]\n\n'
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(path.join(tmpdir(), 'byoa-floating-voice-'));
const extension = fileURLToPath(new URL('../../dist', import.meta.url));
const browser = spawn(
  findChrome({ forExtension: true }),
  [
    '--headless=new',
    ...chromeSandboxArgs(),
    '--no-first-run',
    '--no-default-browser-check',
    '--use-mock-keychain',
    '--disable-blink-features=WebMCP',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
);
const cdp = new CdpPipe(browser);
const watchdog = setTimeout(() => browser.kill('SIGKILL'), 120000);
const evaluate = async (sessionId, expression) => {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    sessionId
  );
  if (result.exceptionDetails)
    throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function attach(targetId) {
  return (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
}
try {
  const worker = await waitFor(
    async () =>
      (await cdp.send('Target.getTargets')).targetInfos.find(
        (t) => t.type === 'service_worker' && t.url.endsWith('/service-worker-loader.js')
      ),
    'worker'
  );
  const workerSession = await attach(worker.targetId);
  await cdp.send('Runtime.enable', {}, workerSession);
  await waitFor(
    () => evaluate(workerSession, "typeof chrome !== 'undefined' && !!chrome.storage"),
    'worker API'
  );
  await evaluate(
    workerSession,
    `globalThis.voiceSenders=[];chrome.runtime.onConnect.addListener(p=>{if(p.name==='byoa-site-voice')voiceSenders.push(p.sender)})`
  );
  const base = `chrome-extension://${new URL(worker.url).host}`;
  const config = {
    schemaVersion: 2,
    defaultAgentId: 'fixture',
    agents: [
      {
        id: 'fixture',
        name: 'Voice fixture',
        provider: 'openai',
        apiProtocol: 'openai-chat-completions',
        model: 'fixture',
        endpoint: origin + '/v1',
        temperature: 0.7,
        maxSteps: 5,
        isDefault: true,
      },
    ],
    mcpConfig: { mcpServers: {} },
    builtinScripts: [],
    userScripts: [],
    logLevel: 'silent',
    voiceMode: true,
  };
  await evaluate(workerSession, `chrome.storage.local.set({config:${JSON.stringify(config)}})`);
  await evaluate(
    workerSession,
    `chrome.storage.session.set({[${JSON.stringify('agentboard_connection_' + origin)}]:{agentId:'fixture',share:{persona:false,user:false,memory:false},persist:'session',createdAt:Date.now()}})`
  );
  const { targetId } = await cdp.send('Target.createTarget', { url: origin });
  const page = await attach(targetId);
  await cdp.send('Runtime.enable', {}, page);
  await waitFor(
    () => evaluate(page, `!!(navigator.modelContext||document.modelContext)`),
    'page registry'
  );
  // A connection alone must not show a widget.
  assert.equal(await evaluate(page, `document.querySelectorAll('iframe').length`), 0);
  await evaluate(
    page,
    `(navigator.modelContext||document.modelContext).registerTool({name:'edit_heading',description:'Change the synthetic heading',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']},execute:async({text})=>{document.querySelector('#heading').textContent=text;return {content:[{type:'text',text:'changed'}]}}});window.addEventListener('agent:announceProvider',e=>window.provider=e.detail.provider);window.dispatchEvent(new Event('agent:requestProvider'))`
  );
  await waitFor(() => evaluate(page, '!!window.provider'), 'provider');
  await evaluate(
    page,
    `provider.request({method:'agent_configureVoice',params:{enabled:true,tools:['edit_heading']}})`
  );
  const widgetTarget = await waitFor(
    async () =>
      (await cdp.send('Target.getTargets')).targetInfos.find(
        (t) => t.url === base + '/src/site-voice/index.html'
      ),
    'widget frame'
  );
  const widget = await attach(widgetTarget.targetId);
  await waitFor(
    () => evaluate(widget, `!document.querySelector('#mic').disabled`),
    'bound mic'
  ).catch(async (error) => {
    console.log('Widget', await evaluate(widget, 'document.body.innerText'));
    console.log('Senders', await evaluate(workerSession, 'voiceSenders'));
    console.log(
      'Frames',
      await evaluate(
        workerSession,
        `chrome.tabs.query({url:${JSON.stringify(origin + '/*')}}).then(t=>chrome.webNavigation.getAllFrames({tabId:t[0].id}))`
      )
    );
    throw error;
  });
  assert.equal(await evaluate(page, `document.querySelector('iframe').contentDocument`), null);
  await cdp.send('Page.bringToFront', {}, page);
  const click = async (id) => {
    let previous;
    await waitFor(async () => {
      const local = await evaluate(
        widget,
        `(()=>{const r=document.querySelector(${JSON.stringify('#' + id)}).getBoundingClientRect();return [r.x,r.y,r.width,r.height,innerWidth,innerHeight]})()`
      );
      const outer = await evaluate(
        page,
        `(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`
      );
      const current = JSON.stringify([local, outer]);
      const stable = current === previous && local[2] > 0 && local[3] > 0;
      previous = current;
      return stable;
    }, 'stable widget layout');
    const rect = await evaluate(
      widget,
      `(()=>{const r=document.querySelector(${JSON.stringify('#' + id)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`
    );
    const offset = await evaluate(
      page,
      `(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.x,y:r.y}})()`
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.send(
        'Input.dispatchMouseEvent',
        { type, x: offset.x + rect.x, y: offset.y + rect.y, button: 'left', clickCount: 1 },
        page
      );
  };
  // Prewarm the real offscreen host, then replace only its recognition API with a deterministic fixture.
  await evaluate(
    workerSession,
    `chrome.offscreen.createDocument({url:'src/voice-host/index.html',reasons:['USER_MEDIA'],justification:'Synthetic voice browser fixture'})`
  );
  const hostTarget = await waitFor(
    async () =>
      (await cdp.send('Target.getTargets')).targetInfos.find(
        (t) => t.url === base + '/src/voice-host/index.html'
      ),
    'offscreen host'
  );
  const host = await attach(hostTarget.targetId);
  await evaluate(
    host,
    `window.SpeechRecognition=class {get processLocally(){return this.local}set processLocally(v){this.local=v}static async available(){return 'available'}static async install(){return true}start(){if(!this.local)throw Error('Must remain local');window.recognition=this}stop(){window.stopCount=(window.stopCount||0)+1}abort(){window.aborted=true}}`
  );
  await click('mic');
  await waitFor(() => evaluate(host, '!!window.recognition'), 'recognition started');
  await waitFor(
    () => evaluate(widget, `document.querySelector('#status').textContent==='Listening locally'`),
    'recording UI'
  );
  await evaluate(
    host,
    `recognition.onresult({results:[[{transcript:'Make the heading shorter'}]]})`
  );
  await click('send');
  await waitFor(() => evaluate(host, 'window.stopCount===1'), 'Send requests final recognition');
  assert.equal(requests.length, 0, 'Send must wait for final words');
  await evaluate(
    host,
    `recognition.onresult({results:[[{transcript:'Make the heading shorter please'}]]});recognition.onend()`
  );
  await waitFor(
    () => evaluate(page, `document.querySelector('#heading').textContent==='Short heading'`),
    'page action'
  );
  await waitFor(
    () =>
      evaluate(
        widget,
        `document.querySelector('#result').textContent==='Changed the fixture heading.'`
      ),
    'actual result'
  );
  assert.equal(requests.length, 2, 'One model/tool round trip, no summarization call');
  for (const request of requests)
    assert.deepEqual(
      request.tools.map((t) => t.function.name),
      ['edit_heading']
    );
  assert.ok(
    requests[0].messages.some((m) => m.role === 'user' && m.content.includes('shorter please'))
  );
  const contexts = await evaluate(
    workerSession,
    `chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})`
  );
  assert.equal(contexts.length, 0, 'Idle capture host closes');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, page);
  writeFileSync(path.join(tmpdir(), 'byoa-floating-result.png'), Buffer.from(shot.data, 'base64'));
  await click('open');
  const tabs = await evaluate(
    workerSession,
    `chrome.tabs.query({url:${JSON.stringify(origin + '/*')}})`
  );
  const tabId = tabs[0].id;
  await waitFor(
    () =>
      evaluate(
        workerSession,
        `chrome.storage.session.get('agentboard_chat_focus_${tabId}').then(x=>!!x['agentboard_chat_focus_${tabId}']?.taskId)`
      ),
    'matching conversation focus'
  );
  const saved = await evaluate(workerSession, 'chrome.storage.session.get(null)');
  const task = Object.values(saved).find(
    (v) => v?.conversationId && v?.prompt === 'Make the heading shorter please'
  );
  assert.ok(task?.conversationId);
  assert.equal(saved[`agentboard_chat_focus_${tabId}`].taskId, task.id);
  assert.equal(requests.length, 2, 'Opening conversation must not replay task');
  const sidebarTarget = (await cdp.send('Target.getTargets')).targetInfos.find((t) =>
    t.url.startsWith(base + '/src/sidebar/index.html')
  );
  const sidebar = sidebarTarget
    ? await attach(sidebarTarget.targetId)
    : await attach(
        (
          await cdp.send('Target.createTarget', {
            url: base + '/src/sidebar/index.html#tab=' + tabId,
          })
        ).targetId
      );
  await waitFor(
    () => evaluate(sidebar, `!!document.querySelector('#site-agent-chat textarea')`),
    'scoped continuation'
  );
  await evaluate(
    sidebar,
    `const form=document.querySelector('#site-agent-chat form');form.querySelector('textarea').value='Make it shorter again';form.requestSubmit()`
  );
  await waitFor(() => requests.length >= 4, 'continuation run').catch(async (error) => {
    console.log('Sidebar:', await evaluate(sidebar, 'document.body.innerText'));
    console.log('Request count:', requests.length);
    throw error;
  });
  assert.ok(
    requests[2].messages.some(
      (m) => m.role === 'assistant' && m.content === 'Changed the fixture heading.'
    )
  );
  assert.ok(
    requests[2].messages.some(
      (m) => m.role === 'user' && m.content.includes('Make it shorter again')
    )
  );
  for (const request of requests)
    assert.deepEqual(
      request.tools.map((t) => t.function.name),
      ['edit_heading']
    );
  await evaluate(page, `provider.request({method:'agent_configureVoice',params:{enabled:false}})`);
  await waitFor(
    () => evaluate(page, `document.querySelectorAll('iframe').length===0`),
    'opt-out removes widget'
  );
  console.log(
    'PASS main extension: opt-in and bound iframe, synthetic local capture, final Send once, exact page tools and action, actual result, idle cleanup, matching chat handoff and scoped follow-up. Native recognition is separately manually confirmed.'
  );
} finally {
  clearTimeout(watchdog);
  const kill = setTimeout(() => browser.kill('SIGKILL'), 3000);
  await cdp.send('Browser.close').catch(() => {});
  if (browser.exitCode === null && browser.signalCode === null)
    await new Promise((resolve) => browser.once('close', resolve));
  clearTimeout(kill);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(profile, { recursive: true, force: true });
}
