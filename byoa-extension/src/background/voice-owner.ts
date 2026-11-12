/** One capture lease shared by sidebar and floating controls; discarded on worker restart. */
export function createVoiceOwner() {
  let owner: { key: object; lost(): void } | undefined;
  let host: chrome.runtime.Port | undefined;
  let hostReady: ((port: chrome.runtime.Port) => void) | undefined;
  let creating: Promise<chrome.runtime.Port> | undefined;
  let closing: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;
  let capture:
    | { id: string; key: object; emit(message: Record<string, unknown>): void }
    | undefined;
  const release = (key: object) => {
    if (owner?.key !== key) return;
    owner = undefined;
    if (capture?.key === key) {
      host?.postMessage({ type: 'cancel', id: capture.id });
      capture = undefined;
      clearInterval(timer);
      closing = closing
        .then(async () => {
          if (creating) await creating.catch(() => {});
          host = undefined;
          const contexts = await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
          });
          if (
            contexts.some(
              (c) => c.documentUrl === chrome.runtime.getURL('src/voice-host/index.html')
            )
          )
            await chrome.offscreen.closeDocument();
        })
        .catch(() => {});
    }
  };
  const claim = (key: object, lost: () => void) => {
    if (owner && owner.key !== key) return false;
    owner = { key, lost };
    return true;
  };
  const cancel = () => {
    const current = owner;
    if (current) {
      release(current.key);
      current.lost();
    }
  };
  return {
    claim,
    release,
    stop(key: object) {
      if (owner?.key === key) cancel();
    },
    cancel,
    connect(port: chrome.runtime.Port) {
      if (port.name === 'byoa-voice-host') {
        if (
          port.sender?.url !== chrome.runtime.getURL('src/voice-host/index.html') ||
          port.sender.tab
        ) {
          port.disconnect();
          return true;
        }
        host = port;
        hostReady?.(port);
        hostReady = undefined;
        port.onMessage.addListener((message) => {
          const current = capture;
          if (!current || message.id !== current.id || host !== port) return;
          if (message.type === 'result') release(current.key);
          current.emit(message);
        });
        port.onDisconnect.addListener(() => {
          if (host === port) {
            host = undefined;
            cancel();
          }
        });
        return true;
      }
      if (port.name !== 'byoa-voice-owner') return false;
      if (!port.sender?.url?.startsWith(chrome.runtime.getURL('src/sidebar/index.html'))) {
        port.disconnect();
        return true;
      }
      port.onMessage.addListener((message) => {
        if (message.type === 'claim')
          port.postMessage({
            granted: claim(port, () => {
              try {
                port.postMessage({ lost: true });
              } catch {
                /* Gone. */
              }
            }),
          });
      });
      port.onDisconnect.addListener(() => release(port));
      return true;
    },
    async start(key: object, language: string, emit: (message: Record<string, unknown>) => void) {
      if (!claim(key, () => emit({ type: 'lost' })))
        throw new Error('Microphone is busy in another BYOA view.');
      const id = globalThis.crypto.randomUUID();
      capture = { id, key, emit };
      try {
        await closing;
        if (!creating)
          creating = (async () => {
            const contexts = await chrome.runtime.getContexts({
              contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
            });
            if (
              contexts.length &&
              host &&
              contexts.every(
                (c) => c.documentUrl === chrome.runtime.getURL('src/voice-host/index.html')
              )
            )
              return host;
            if (contexts.length)
              throw new Error(
                'Another offscreen document is active. Close the voice diagnostic before recording.'
              );
            const ready = new Promise<chrome.runtime.Port>((resolve, reject) => {
              const deadline = setTimeout(() => {
                hostReady = undefined;
                reject(new Error('Local voice host did not start.'));
              }, 5000);
              hostReady = (value) => {
                clearTimeout(deadline);
                resolve(value);
              };
            });
            // Consume a rejected ready promise even if createDocument itself fails first.
            void ready.catch(() => {});
            await chrome.offscreen.createDocument({
              url: 'src/voice-host/index.html',
              reasons: [chrome.offscreen.Reason.USER_MEDIA],
              justification: 'Local dictation started from the BYOA microphone',
            });
            return ready;
          })().finally(() => {
            creating = undefined;
          });
        const port = await creating;
        if (capture?.id !== id) return;
        port.postMessage({ type: 'ping' });
        timer = setInterval(() => {
          try {
            port.postMessage({ type: 'ping' });
          } catch {
            cancel();
          }
        }, 2000);
        port.postMessage({ type: 'start', id, language });
      } catch (error) {
        release(key);
        throw error;
      }
    },
    finish(key: object) {
      if (capture?.key === key) host?.postMessage({ type: 'finish', id: capture.id });
    },
  };
}
