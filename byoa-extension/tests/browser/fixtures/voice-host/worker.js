chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('setup.html')) return;
  if (message.target !== 'worker') return;
  void (async () => {
    if (message.command === 'contexts') {
      return chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    }
    if (message.command === 'close') {
      await chrome.offscreen.closeDocument();
      return { closed: true };
    }
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (!contexts.length)
      await chrome.offscreen.createDocument({
        url: 'host.html',
        reasons: ['USER_MEDIA'],
        justification: 'Test native local speech recognition using a synthetic microphone',
      });
    return chrome.runtime.sendMessage({ target: 'host', command: message.command });
  })().then(reply, (error) => reply({ error: String(error) }));
  return true;
});
