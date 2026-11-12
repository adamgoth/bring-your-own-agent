/** Development-build diagnostic, reachable only from its own extension page. */
export function registerVoiceProbe() {
  const page = chrome.runtime.getURL('voice-probe/setup.html');
  const host = chrome.runtime.getURL('voice-probe/host.html');
  let creating: Promise<void> | undefined;
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.url !== page || message.target !== 'worker')
      return false;
    if (
      !['contexts', 'close', 'capability', 'capture', 'cancel', 'snapshot', 'media'].includes(
        message.command
      )
    )
      return false;
    void (async () => {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      });
      if (message.command === 'contexts') return contexts;
      if (contexts.some((context) => context.documentUrl !== host))
        throw new Error('Another offscreen host is in use. Close it before testing voice.');
      if (message.command === 'close') {
        if (contexts.length) await chrome.offscreen.closeDocument();
        return { closed: true };
      }
      if (!contexts.length) {
        creating ??= chrome.offscreen
          .createDocument({
            url: 'voice-probe/host.html',
            reasons: [chrome.offscreen.Reason.USER_MEDIA],
            justification: 'User-initiated test of local speech with the sidebar closed',
          })
          .finally(() => {
            creating = undefined;
          });
        await creating;
      }
      return chrome.runtime.sendMessage({ target: 'host', command: message.command });
    })().then(reply, (error) => reply({ error: String(error) }));
    return true;
  });
}
