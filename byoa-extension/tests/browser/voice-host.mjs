import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpPipe, chromeSandboxArgs, findChrome, waitFor } from './chrome-harness.mjs';

// Always isolate permissions and always supply a synthetic device, including headed runs.
const profile = mkdtempSync(path.join(tmpdir(), 'byoa-voice-host-'));
const mainBuild = process.env.BYOA_VOICE_MAIN_DIST === '1';
const extension = fileURLToPath(
  new URL(mainBuild ? '../../dist' : './fixtures/voice-host', import.meta.url)
);
const browser = spawn(
  findChrome({ forExtension: true }),
  [
    ...(process.env.BYOA_VOICE_HEADED === '1' ? [] : ['--headless=new']),
    ...chromeSandboxArgs(),
    '--no-first-run',
    '--no-default-browser-check',
    '--use-mock-keychain',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    ...(process.env.BYOA_VOICE_AUDIO
      ? [`--use-file-for-fake-audio-capture=${path.resolve(process.env.BYOA_VOICE_AUDIO)}`]
      : []),
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    'about:blank',
  ],
  {
    stdio: [
      'ignore',
      'ignore',
      process.env.BYOA_VOICE_DEBUG === '1' ? 'inherit' : 'ignore',
      'pipe',
      'pipe',
    ],
  }
);
const cdp = new CdpPipe(browser);
const watchdog = setTimeout(() => browser.kill('SIGKILL'), 240000);
let nativeOffscreenPassed = false;
try {
  console.log('Browser:', JSON.stringify(await cdp.send('Browser.getVersion')));
  const worker = await waitFor(
    async () =>
      (await cdp.send('Target.getTargets')).targetInfos.find(
        (t) =>
          t.type === 'service_worker' &&
          t.url.endsWith(mainBuild ? '/service-worker-loader.js' : '/worker.js')
      ),
    'probe worker'
  ).catch(async (error) => {
    console.log('Targets:', JSON.stringify(await cdp.send('Target.getTargets')));
    throw error;
  });
  const { targetId } = await cdp.send('Target.createTarget', {
    url: `chrome-extension://${new URL(worker.url).host}/${mainBuild ? 'voice-probe/' : ''}setup.html`,
  });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.bringToFront', {}, sessionId);
  const evaluate = async (expression) => {
    const result = await cdp.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      sessionId
    );
    if (result.exceptionDetails)
      throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  await waitFor(() => evaluate('!!globalThis.workerProbe'), 'setup ready').catch(async (error) => {
    console.log(
      'Setup diagnostic:',
      await evaluate(
        '({url:location.href,text:document.body?.innerText,probe:typeof probe,workerProbe:typeof workerProbe})'
      )
    );
    throw error;
  });
  await evaluate("document.querySelector('#permission').click()");
  await waitFor(
    () => evaluate("document.querySelector('#status').textContent.includes('granted')"),
    'explicit synthetic microphone permission'
  );
  console.log('Permission:', await evaluate("document.querySelector('#status').textContent"));
  console.log('Visible before setup:', JSON.stringify(await evaluate('probe.capability()')));
  if (process.env.BYOA_VOICE_INSTALL === '1') {
    console.log('Installing local English pack in visible extension page (120 second deadline)…');
    console.log('Install:', await evaluate('probe.install().catch(String)'));
  }
  await cdp.send('Page.bringToFront', {}, sessionId);
  const visible = await evaluate('probe.capability()');
  const offscreen = await evaluate("workerProbe('capability')");
  console.log('Native capabilities:', JSON.stringify({ visible, offscreen }));
  const mediaChecks = {
    visible: await evaluate('probe.media()'),
    offscreen: await evaluate("workerProbe('media')"),
  };
  console.log('Independent USER_MEDIA checks:', JSON.stringify(mediaChecks));
  assert.equal(mediaChecks.visible.released, true);
  assert.equal(mediaChecks.offscreen.released, true);
  const hostContexts = await evaluate("workerProbe('contexts')");
  assert.equal(hostContexts.length, 1);
  assert.equal(hostContexts[0].documentUrl, offscreen.url);
  assert.ok(offscreen.url.endsWith('/host.html'));
  assert.equal(visible.hidden, false);
  assert.equal(
    (await cdp.send('Target.getTargets')).targetInfos.some((t) => t.url.includes('/sidebar/')),
    false
  );
  for (const host of ['offscreen', 'visible']) {
    const run = (command) =>
      evaluate(host === 'offscreen' ? `workerProbe('${command}')` : `probe.${command}()`);
    console.log(`${host} native start:`, JSON.stringify(await run('capture')));
    if ((host === 'offscreen' ? offscreen : visible).state === 'available') {
      await waitFor(
        async () => !(await run('snapshot')).active,
        `${host} native recognition end`,
        20000
      );
    }
    const result = await run('cancel');
    assert.equal(result.released, true);
    assert.equal(result.active, false);
    console.log(`${host} native result:`, JSON.stringify(result));
    if (result.final && result.text.trim()) {
      console.log(`NATIVE FINAL TEXT OBTAINED: ${host}`);
      if (host === 'offscreen') nativeOffscreenPassed = true;
    } else
      console.log(
        `GATE NOT PASSED: ${host} has no native final transcript. This is not a fixture pass.`
      );
  }
  await evaluate("workerProbe('close')");
  const { sessionId: workerSession } = await cdp.send('Target.attachToTarget', {
    targetId: worker.targetId,
    flatten: true,
  });
  const contexts = await cdp.send(
    'Runtime.evaluate',
    {
      expression: "chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})",
      awaitPromise: true,
      returnByValue: true,
    },
    workerSession
  );
  assert.deepEqual(contexts.result.value, []);
  console.log(
    'PASS offscreen document closed; synthetic streams and audio contexts released. No sidebar opened.'
  );
  if (!nativeOffscreenPassed) process.exitCode = 2;
} finally {
  clearTimeout(watchdog);
  const killTimer = setTimeout(() => browser.kill('SIGKILL'), 3000);
  await cdp.send('Browser.close').catch(() => {});
  if (browser.exitCode === null && browser.signalCode === null)
    await new Promise((resolve) => browser.once('close', resolve));
  clearTimeout(killTimer);
  rmSync(profile, { recursive: true, force: true });
}
