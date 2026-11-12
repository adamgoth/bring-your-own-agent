const status = document.querySelector('#status');
const worker = (command) => chrome.runtime.sendMessage({ target: 'worker', command });
globalThis.workerProbe = worker;
const show = (value) => {
  status.textContent = JSON.stringify(value, null, 2);
};
const action = (id, operation) =>
  document.querySelector(id).addEventListener('click', () => {
    Promise.resolve(operation()).then(show, (error) => show({ error: String(error) }));
  });
action('#permission', async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
  return {
    permission: 'granted',
    released: stream.getTracks().every((track) => track.readyState === 'ended'),
  };
});
action('#install', () => probe.install());
action('#check', async () => ({
  visible: await probe.capability(),
  offscreen: await worker('capability'),
}));
action('#offscreen', async () => {
  await probe.cancel();
  return worker('capture');
});
action('#visible', async () => {
  await worker('cancel');
  return probe.capture();
});
action('#results', async () => ({
  visible: probe.snapshot(),
  offscreen: await worker('snapshot'),
}));
action('#stop', async () => ({ visible: await probe.cancel(), offscreen: await worker('cancel') }));
setInterval(async () => {
  const visible = probe.snapshot();
  if (visible.active) show({ visible });
}, 500);

addEventListener('pagehide', () => {
  void worker('cancel')
    .then(() => worker('close'))
    .catch(() => {});
});
