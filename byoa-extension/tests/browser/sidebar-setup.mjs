import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpPipe, chromeSandboxArgs, findChrome, waitFor } from './chrome-harness.mjs';

const profile = mkdtempSync(path.join(tmpdir(), 'byoa-sidebar-setup-'));
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
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }
);
browser.stderr.on('data', (chunk) => {
  if (process.env.BYOA_BROWSER_DEBUG) process.stderr.write(chunk);
});
const cdp = new CdpPipe(browser);
const send = (method, params = {}, session) =>
  Promise.race([
    cdp.send(method, params, session),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 12000);
      timer.unref();
    }),
  ]);
async function page(url, existingId) {
  const targetId = existingId ?? (await send('Target.createTarget', { url })).targetId;
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async (expression) => {
    const result = await send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      );
    return result.result.value;
  };
  evaluate.sessionId = sessionId;
  return evaluate;
}
try {
  const worker = await waitFor(
    async () =>
      (await send('Target.getTargets')).targetInfos.find(
        (t) => t.type === 'service_worker' && t.url.endsWith('/service-worker-loader.js')
      ),
    'extension worker'
  );
  console.log('Extension worker ready');
  const base = `chrome-extension://${new URL(worker.url).host}`;
  const sidebar = await page(`${base}/src/sidebar/index.html`);
  await waitFor(
    () => sidebar(`document.querySelector('#setup-title')?.textContent.includes('first agent')`),
    'first agent setup'
  );
  assert.equal(
    await sidebar(
      `document.querySelector('.input-container').hidden && document.querySelector('.chat-container').hidden && document.querySelector('#agent-switcher').hidden`
    ),
    true
  );
  assert.equal(await sidebar(`document.querySelector('#messages').textContent.trim()`), '');
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 400, height: 760, deviceScaleFactor: 1, mobile: false },
    sidebar.sessionId
  );
  const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sidebar.sessionId);
  writeFileSync(
    path.join(tmpdir(), 'byoa-sidebar-setup.png'),
    Buffer.from(screenshot.data, 'base64')
  );
  console.log('Setup view ready');
  await sidebar(`document.querySelector('#setup-action').click()`);
  const optionsTarget = await waitFor(
    async () =>
      (await send('Target.getTargets')).targetInfos.find((t) =>
        t.url.includes('/src/options/index.html')
      ),
    'setup options tab'
  );
  const options = await page(optionsTarget.url, optionsTarget.targetId);
  await waitFor(
    () => options(`document.querySelector('#agent-modal')?.open`),
    'create agent dialog'
  );
  assert.equal(await options(`document.querySelector('#modal-title').textContent`), 'New Agent');
  // Exercise real Save and Edit with dummy keys; never call a live provider.
  for (const [provider, endpoint, apiProtocol] of [
    ['openrouter', 'https://openrouter.ai/api/v1', 'openai-responses'],
    ['anthropic', 'https://api.anthropic.com/v1', 'anthropic-messages'],
    ['google', 'https://generativelanguage.googleapis.com/v1beta', 'google-generative-ai'],
    ['openai', 'https://api.openai.com/v1', 'openai-responses'],
  ]) {
    await options(
      `(() => {const p=document.querySelector('#agent-provider');p.value=${JSON.stringify(provider)};p.dispatchEvent(new Event('change',{bubbles:true}));})()`
    );
    assert.equal(await options(`document.querySelector('#agent-endpoint').value`), endpoint);
    assert.equal(await options(`document.querySelector('#agent-model').value`), '');
    assert.equal(await options(`document.querySelector('#agent-api-key').required`), true);
    assert.equal(
      await options(`document.querySelector('#connection-api-group').classList.contains('hidden')`),
      true
    );
    assert.equal(
      await options(
        `document.querySelector('#openai-api-mode-group').classList.contains('hidden')`
      ),
      provider !== 'openrouter'
    );
    if (provider === 'openrouter') {
      await send(
        'Emulation.setDeviceMetricsOverride',
        { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false },
        options.sessionId
      );
      await options(
        `document.querySelector('#agent-provider').closest('fieldset').scrollIntoView({block:'start'})`
      );
      const shot = await send('Page.captureScreenshot', { format: 'png' }, options.sessionId);
      writeFileSync(
        path.join(tmpdir(), 'byoa-provider-presets.png'),
        Buffer.from(shot.data, 'base64')
      );
    }
    // Blank model/key cannot be saved even with an auto-filled endpoint.
    await options(
      `document.querySelector('#agent-name').value='Dummy ${provider}';document.querySelector('#agent-modal .modal-save-btn').click()`
    );
    assert.equal(await options(`document.querySelector('#agent-modal').open`), true);
    await options(
      `document.querySelector('#agent-model').value='dummy-model-id';document.querySelector('#agent-api-key').value='dummy-key';document.querySelector('#agent-modal .modal-save-btn').click()`
    );
    await waitFor(() => options(`!document.querySelector('#agent-modal').open`), 'preset saved');
    const saved = await options(
      `chrome.storage.local.get('config').then(({config})=>config.agents.find(a=>a.name==='Dummy ${provider}'))`
    );
    assert.equal(saved.endpoint, endpoint);
    assert.equal(saved.apiProtocol, apiProtocol);
    assert.equal(saved.model, 'dummy-model-id');
    assert.equal(saved.apiKey, 'dummy-key');
    await waitFor(
      () => options(`!!document.querySelector('[data-card-id="${saved.id}"]')`),
      'saved agent card'
    );
    await options(`document.querySelector('[data-card-id="${saved.id}"]').click()`);
    await waitFor(
      () => options(`document.querySelector('#agent-modal').open`),
      'preset edit dialog'
    );
    assert.equal(await options(`document.querySelector('#agent-provider').value`), provider);
    assert.equal(await options(`document.querySelector('#agent-api-key').value`), 'dummy-key');
    if (provider === 'openrouter') {
      await options(
        `(() => {const mode=document.querySelector('#agent-openai-api-mode');mode.value='openai-chat-completions';mode.dispatchEvent(new Event('change',{bubbles:true}));})()`
      );
      assert.equal(await options(`document.querySelector('#agent-provider').value`), 'openrouter');
      assert.equal(await options(`document.querySelector('#agent-api-key').value`), 'dummy-key');
      await options(`document.querySelector('#agent-modal .modal-save-btn').click()`);
      await waitFor(
        () => options(`!document.querySelector('#agent-modal').open`),
        'compatibility mode saved'
      );
      assert.equal(
        await options(
          `chrome.storage.local.get('config').then(({config})=>config.agents.find(a=>a.id==='${saved.id}').apiProtocol)`
        ),
        'openai-chat-completions'
      );
      await options(`document.querySelector('[data-card-id="${saved.id}"]').click()`);
      await waitFor(
        () => options(`document.querySelector('#agent-modal').open`),
        'compatibility edit dialog'
      );
      assert.equal(await options(`document.querySelector('#agent-provider').value`), 'openrouter');
      assert.equal(
        await options(`document.querySelector('#agent-openai-api-mode').value`),
        'openai-chat-completions'
      );
    }
    await options(
      `document.querySelector('#modal-close').click();document.querySelector('#create-agent').click()`
    );
    assert.equal(await options(`document.querySelector('#agent-model').value`), '');
  }
  console.log(
    'PASS: provider presets fill routing, require model/key, and survive real Save/Edit.'
  );
  await options(`document.querySelector('#modal-close').click()`);
  const config = {
    schemaVersion: 2,
    logLevel: 'warn',
    agents: [
      {
        id: 'dummy',
        name: 'Dummy agent',
        provider: 'openai',
        apiProtocol: 'openai-chat-completions',
        model: 'dummy-model',
        endpoint: 'http://127.0.0.1:1/v1',
        temperature: 0.7,
        maxSteps: 8,
        isDefault: true,
      },
    ],
    defaultAgentId: 'dummy',
  };
  await options(`chrome.storage.local.set({config:${JSON.stringify(config)}})`);
  await waitFor(
    () =>
      sidebar(
        `!document.querySelector('.input-container').hidden && !document.querySelector('#message-input').disabled && document.querySelector('.agent-switcher-label').textContent === 'Dummy agent'`
      ),
    'live configured chat'
  );
  assert.equal(
    await sidebar(`document.querySelector('.agent-switcher-label').textContent`),
    'Dummy agent'
  );
  await sidebar(
    `document.querySelector('#message-input').value='Retained draft';document.querySelector('#messages').textContent='Retained history'`
  );
  await options(
    `chrome.storage.local.set({config:${JSON.stringify({ ...config, agents: [], defaultAgentId: undefined })}})`
  );
  await waitFor(
    () => sidebar(`!document.querySelector('#agent-setup').hidden`),
    'last removal setup'
  );
  assert.equal(await sidebar(`document.querySelector('#message-input').value`), 'Retained draft');
  await options(`chrome.storage.local.set({config:${JSON.stringify(config)}})`);
  await waitFor(
    () => sidebar(`document.querySelector('#agent-setup').hidden`),
    'reconfigured chat'
  );
  assert.equal(
    await sidebar(`document.querySelector('#messages').textContent`),
    'Retained history'
  );
  assert.equal(await sidebar(`document.querySelector('#message-input').value`), 'Retained draft');
  await options(`chrome.storage.local.set({config:{schemaVersion:999,agents:[]}})`);
  await waitFor(
    () =>
      sidebar(`document.querySelector('#setup-title').textContent==='Unable to load your agents'`),
    'configuration error'
  );
  assert.equal(
    await sidebar(`document.querySelector('#setup-action').textContent`),
    'Open settings'
  );
  await options(`chrome.storage.local.set({config:${JSON.stringify(config)}})`);
  await waitFor(
    () => sidebar(`document.querySelector('#agent-setup').hidden`),
    'configuration recovery'
  );
  console.log(
    'PASS: first-agent setup, direct creation dialog, live add/remove, retained history/draft, configuration error and recovery (fresh profile, dummy provider).'
  );
} finally {
  if (browser.exitCode === null && browser.signalCode === null) {
    const closed = new Promise((resolve) => browser.once('close', resolve));
    browser.kill('SIGKILL');
    await closed;
  }
  rmSync(profile, { recursive: true, force: true });
}
