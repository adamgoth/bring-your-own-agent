import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpPipe, chromeSandboxArgs, findChrome, waitFor } from './chrome-harness.mjs';
const profile = mkdtempSync(path.join(tmpdir(), 'byoa-local-voice-'));
const extension = fileURLToPath(new URL('../../dist', import.meta.url));
const browser = spawn(
  findChrome({ forExtension: true }),
  [
    '--headless=new',
    ...chromeSandboxArgs(),
    '--no-first-run',
    '--no-default-browser-check',
    '--use-mock-keychain',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    ...(process.env.BYOA_VOICE_AUDIO
      ? [`--use-file-for-fake-audio-capture=${process.env.BYOA_VOICE_AUDIO}`]
      : []),
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
);
const cdp = new CdpPipe(browser);
try {
  console.log('Browser:', JSON.stringify(await cdp.send('Browser.getVersion')));
  const worker = await waitFor(
    async () =>
      (await cdp.send('Target.getTargets')).targetInfos.find(
        (t) => t.type === 'service_worker' && t.url.endsWith('/service-worker-loader.js')
      ),
    'extension worker'
  );
  const url = `chrome-extension://${new URL(worker.url).host}/src/sidebar/index.html`;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  const evaluate = async (expression) => {
    const r = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      sessionId
    );
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('#voice-status')?.textContent && !document.querySelector('#voice-status').textContent.startsWith('Checking')`
      ),
    'voice capability result'
  ).catch(async (error) => {
    console.log(
      'Diagnostic:',
      await evaluate(`({url:location.href, text:document.body.innerText.slice(0,1600)})`)
    );
    throw error;
  });
  if (process.env.BYOA_VOICE_INSTALL === '1') {
    console.log('Installing local English pack (no audio upload)…');
    await evaluate(
      `document.querySelector('#local-voice').open=true; document.querySelector('#voice-install').click()`
    );
    await waitFor(
      () => evaluate(`!document.querySelector('#voice-check').disabled`),
      'language installation',
      180000
    );
  }
  const capability = await evaluate(
    `(async () => { const C = window.SpeechRecognition || window.webkitSpeechRecognition; return { origin: location.origin, supported: !!C, local: !!C && 'processLocally' in C.prototype, availabilityAPI: typeof C?.available, status: document.querySelector('#voice-status').textContent, recordDisabled: document.querySelector('#voice-record').disabled, state: C?.available ? await C.available({langs:['en-US'], processLocally:true}).catch(e=>e.name+': '+e.message) : null }; })()`
  );
  console.log('Extension capability:', JSON.stringify(capability));
  if (capability.state !== 'available') {
    assert.equal(capability.recordDisabled, true);
    console.log(
      'PASS unsupported/uninstalled recognition fails closed. Live transcription remains unverified until a local pack is available.'
    );
  }
  // Exercise the actual composer layout; a hidden composer cannot reveal overlap bugs.
  await evaluate(
    `chrome.storage.local.set({config:{schemaVersion:2,defaultAgentId:'voice-test',agents:[{id:'voice-test',name:'Layout fixture',provider:'openai',apiProtocol:'openai-chat-completions',model:'fixture',endpoint:'http://127.0.0.1:1/v1',temperature:0.7,maxSteps:8,isDefault:true}],mcpConfig:{mcpServers:{}},builtinScripts:[],userScripts:[],logLevel:'silent'}})`
  );
  await waitFor(
    () => evaluate(`!document.querySelector('.input-container').hidden`),
    'composer visible'
  ).catch(async (error) => {
    console.log(await evaluate(`document.body.innerText`));
    throw error;
  });
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 360, height: 640, deviceScaleFactor: 1, mobile: false },
    sessionId
  );
  for (const open of [false, true]) {
    await evaluate(`document.querySelector('#local-voice').open=${open}`);
    const layout = await evaluate(
      `(() => {const summary=document.querySelector('#local-voice summary');const a=summary.getBoundingClientRect();const popover=document.querySelector('#local-voice .voice-panel').getBoundingClientRect();const composer=document.querySelector('.composer').getBoundingClientRect();const open=document.querySelector('#local-voice').open;return {visible:a.top>=0&&a.bottom<=innerHeight,uncovered:summary.contains(document.elementFromPoint(a.x+a.width/2,a.y+a.height/2)),separate:!open||(popover.top>=0&&popover.bottom<=composer.top+1),composerFits:composer.bottom<=innerHeight+1};})()`
    );
    assert.deepEqual(layout, {
      visible: true,
      uncovered: true,
      separate: true,
      composerFits: true,
    });
  }
  console.log(
    'PASS voice settings toggle stays clickable and its popover sits above the composer, collapsed and expanded at 360×640.'
  );
  // Deterministic recognizer tests the shipped composer; audio meter uses Chrome's fake device.
  await cdp.send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: `
    window.__submissions=[];
    const connect=chrome.runtime.connect.bind(chrome.runtime);
    chrome.runtime.connect=(...args)=>{const port=connect(...args);port.onMessage.addListener(message=>{window.__chatUpdate=message.type;if(message.type==='snapshot')window.__chatReady=true;});const post=port.postMessage.bind(port);port.postMessage=message=>{if(message.type==='submit')window.__submissions.push(message);return post(message);};return port;};
    window.SpeechRecognition=class {
      get processLocally(){return this.local;} set processLocally(v){this.local=v;}
      static async available(){return 'available';} static async install(){return true;}
      start(){if(!this.local)throw Error('Must be local');window.__recognition=this;}
      stop(){window.__stops=(window.__stops||0)+1;}
      abort(){}
    };
  `,
    },
    sessionId
  );
  const attachedTab = await evaluate(
    `chrome.tabs.create({url:'about:blank',active:false}).then(tab=>tab.id)`
  );
  await cdp.send('Page.navigate', { url: 'about:blank' }, sessionId);
  await cdp.send('Page.navigate', { url: url + '#tab=' + attachedTab }, sessionId);
  await waitFor(
    () =>
      evaluate(
        `document.readyState==='complete' && !document.querySelector('#voice-record')?.disabled && !document.querySelector('#message-input')?.disabled`
      ),
    'mock recognizer ready'
  );
  await waitFor(() => evaluate(`window.__chatReady===true`), 'chat session ready').catch(
    async (error) => {
      console.log(
        await evaluate(
          `({url:location.href,text:document.body.innerText,update:window.__chatUpdate})`
        )
      );
      throw error;
    }
  );
  async function startDictation() {
    await evaluate(
      `window.__recognition=undefined;document.querySelector('#voice-button').click()`
    );
    await waitFor(() => evaluate(`!!window.__recognition`), 'capture lease and recognizer ready');
  }
  // A context-menu selection supersedes dictation, including an in-flight Send.
  const { sessionId: workerSession } = await cdp.send('Target.attachToTarget', {
    targetId: worker.targetId,
    flatten: true,
  });
  await startDictation();
  await evaluate(
    `window.__recognition.onresult({results:[[{transcript:'Superseded dictation'}]]});document.querySelector('#send-button').click()`
  );
  await cdp.send(
    'Runtime.evaluate',
    {
      expression: `void chrome.runtime.sendMessage({type:'CONTEXT_SELECTION',tabId:${attachedTab},text:'Selected page text'}).catch(()=>{})`,
    },
    workerSession
  );
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('#message-input').value.includes('Selected page text') && !document.querySelector('#message-input').readOnly`
      ),
    'context selection cancels dictation'
  );
  await evaluate(
    `window.__recognition.onresult({results:[[{transcript:'Late result'}]]});window.__recognition.onend()`
  );
  assert.equal(
    await evaluate(`document.querySelector('#message-input').value`),
    'Please help me with this text:\n\n"Selected page text"'
  );
  assert.equal(await evaluate(`window.__submissions.length`), 0);
  assert.equal(await evaluate(`document.querySelector('#send-button').disabled`), false);
  console.log(
    'PASS context-menu selection survives dictation cancellation and late results without sending.'
  );
  await evaluate(`document.querySelector('#message-input').value='Typed draft'`);
  await startDictation();
  await evaluate(
    `window.__recognition.onresult({results:[[{transcript:'Synthetic transcript'}]]});`
  );
  await waitFor(
    () =>
      evaluate(
        `!document.querySelector('#voice-recording').hidden && document.querySelector('#voice-recording-status').textContent==='Listening locally'`
      ),
    'recording waveform'
  );
  await waitFor(
    () =>
      evaluate(
        `Array.from(document.querySelector('#voice-waveform').getContext('2d').getImageData(0,0,240,32).data).some(v=>v>0)`
      ),
    'microphone samples drawn'
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('#message-input'),'::placeholder').opacity`
    ),
    '0'
  );
  assert.equal(
    await evaluate(`getComputedStyle(document.querySelector('#message-input')).color`),
    'rgba(0, 0, 0, 0)'
  );
  const micLayout = await evaluate(
    `(() => {const mic=document.querySelector('#voice-button');const r=mic.getBoundingClientRect();const send=document.querySelector('#send-button').getBoundingClientRect();const attach=document.querySelector('#attach-button').getBoundingClientRect();const wave=document.querySelector('#voice-waveform').getBoundingClientRect();return {visible:r.top>=0&&r.bottom<=innerHeight,uncovered:mic.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),separate:attach.right<=r.left&&r.right<=send.left,waveVisible:wave.width>0&&wave.top>=0&&wave.bottom<=r.top};})()`
  );
  assert.deepEqual(micLayout, {
    visible: true,
    uncovered: true,
    separate: true,
    waveVisible: true,
  });
  assert.equal(await evaluate(`document.querySelector('#send-button').disabled`), false);
  assert.equal(await evaluate(`document.querySelector('#message-input').value`), 'Typed draft');
  const recordingShot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(
    path.join(tmpdir(), 'byoa-voice-recording.png'),
    Buffer.from(recordingShot.data, 'base64')
  );
  await evaluate(`document.querySelector('#voice-button').click();window.__recognition.onend()`);
  assert.equal(
    await evaluate(`document.querySelector('#message-input').value`),
    'Typed draft\nSynthetic transcript'
  );
  assert.equal(
    await evaluate(`document.querySelector('#message-input').classList.contains('is-recording')`),
    false
  );
  await startDictation();
  await evaluate(`document.querySelector('#send-button').click()`);
  assert.equal(await evaluate(`document.querySelector('#send-button').disabled`), true);
  assert.equal(
    await evaluate(`document.querySelector('#message-input').value`),
    'Typed draft\nSynthetic transcript'
  );
  assert.equal(await evaluate(`window.__submissions.length`), 0);
  await evaluate(
    `window.__recognition.onresult({results:[[{transcript:'Final words'}]]});window.__recognition.onend()`
  );
  await waitFor(
    () => evaluate(`window.__submissions.length===1`),
    'one transcript submission'
  ).catch(async (error) => {
    console.log(
      'Send diagnostic:',
      await evaluate(
        `({text:document.body.innerText,submissions:window.__submissions,hash:location.hash})`
      )
    );
    throw error;
  });
  assert.equal(
    await evaluate(`window.__submissions[0].content`),
    'Typed draft\nSynthetic transcript\nFinal words'
  );
  await waitFor(
    () =>
      evaluate(
        `!document.querySelector('#message-input').readOnly && document.querySelector('#voice-recording').hidden`
      ),
    'finalized send'
  );
  console.log(
    'PASS visible live waveform, mic-stop draft append, and Send waits for final recognition.'
  );
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(path.join(tmpdir(), 'byoa-voice-polish.png'), Buffer.from(shot.data, 'base64'));
  // The permission page only requests access on click, and releases the synthetic device.
  const { targetId: permissionTarget } = await cdp.send('Target.createTarget', {
    url: 'about:blank',
  });
  const { sessionId: permissionSession } = await cdp.send('Target.attachToTarget', {
    targetId: permissionTarget,
    flatten: true,
  });
  await cdp.send('Page.enable', {}, permissionSession);
  await cdp.send(
    'Page.navigate',
    { url: `chrome-extension://${new URL(worker.url).host}/src/voice-permission/index.html` },
    permissionSession
  );
  const permissionEval = async (expression) => {
    const result = await cdp.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      permissionSession
    );
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text
      );
    return result.result?.value;
  };
  await waitFor(
    () =>
      permissionEval(
        `document.readyState==='complete' && !!document.querySelector('#allow-microphone')`
      ),
    'permission page'
  );
  await permissionEval(
    `window.__permissionTracks=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.__permissionTracks=stream.getTracks();return stream;};document.querySelector('#allow-microphone').click()`
  );
  await waitFor(
    () =>
      permissionEval(
        `document.querySelector('#permission-status').textContent.includes('access is allowed')`
      ),
    'synthetic microphone permission'
  ).catch(async (error) => {
    console.log('Permission page:', await permissionEval(`document.body.innerText`));
    throw error;
  });
  assert.equal(
    await permissionEval(
      `window.__permissionTracks.length>0&&window.__permissionTracks.every(track=>track.readyState==='ended')`
    ),
    true
  );
  console.log(
    'PASS permission page obtains access and immediately releases every synthetic microphone track.'
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  const killTimer = setTimeout(() => browser.kill('SIGKILL'), 3000);
  await cdp.send('Browser.close').catch(() => {});
  if (browser.exitCode === null) await new Promise((resolve) => browser.once('close', resolve));
  clearTimeout(killTimer);
  rmSync(profile, { recursive: true, force: true });
}
