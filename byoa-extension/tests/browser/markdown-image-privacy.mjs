import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { CdpPipe, chromeSandboxArgs, findChrome, waitFor } from './chrome-harness.mjs';
const requests = [];
const server = http.createServer((req, res) => {
  requests.push(req.url);
  res.writeHead(204);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const profile = mkdtempSync(path.join(tmpdir(), 'byoa-review-image-'));
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
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
);
const cdp = new CdpPipe(browser);
const send = (m, p = {}, s) =>
  Promise.race([
    cdp.send(m, p, s),
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(Error('CDP timeout')), 12000);
      t.unref();
    }),
  ]);
async function page(url) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url }, sessionId);
  return async (expression) => {
    const r = await send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (r.exceptionDetails)
      throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
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
  const options = await page(`${base}/src/options/index.html`);
  await waitFor(() => options(`!!chrome.storage?.session`), 'options');
  const url = `http://127.0.0.1:${server.address().port}/image?data=DUMMY_PRIVATE_CONTEXT`;
  await options(
    `chrome.storage.local.set({config:{schemaVersion:2,logLevel:'warn',agents:[{id:'dummy',name:'Dummy agent',provider:'openai',apiProtocol:'openai-responses',model:'dummy-model',endpoint:'http://127.0.0.1:1/v1',temperature:0.7}]}})`
  );
  await options(
    `chrome.storage.session.set({agentboard_chat_77_review:{id:'review',origin:'http://localhost:5173',createdAt:1,prompt:'Dummy task',response:${JSON.stringify(`![preview](${url})`)},activity:[],status:'done',detail:'Dummy task'}})`
  );
  const sidebar = await page(`${base}/src/sidebar/index.html#tab=77`);
  await waitFor(
    () =>
      sidebar(
        `!!document.querySelector('#site-agent-chat .external-image-consent button') && !document.querySelector('.chat-container').hidden`
      ),
    'image consent'
  );
  assert.equal(
    await sidebar(`document.querySelector('#site-agent-chat img').hasAttribute('src')`),
    false
  );
  assert.equal(
    await sidebar(
      `document.querySelector('#site-agent-chat .external-image-consent code').textContent`
    ),
    url
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(requests.length, 0, 'Rendering must not make any image request');
  await sidebar(
    `document.querySelector('#site-agent-chat .external-image-consent button').click()`
  );
  await waitFor(() => requests.length, 'explicitly approved image request');
  assert.equal(requests.length, 1);
  assert.equal(requests[0], '/image?data=DUMMY_PRIVATE_CONTEXT');
  console.log(
    'PASS: model-authored images make no request until explicit approval of the visible destination (fresh profile, dummy data).'
  );
} finally {
  if (browser.exitCode === null && browser.signalCode === null) {
    const close = new Promise((r) => browser.once('close', r));
    browser.kill('SIGKILL');
    await close;
  }
  await new Promise((r) => server.close(r));
  rmSync(profile, { recursive: true, force: true });
}
