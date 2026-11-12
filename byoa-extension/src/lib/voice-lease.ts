/** Port lifetime is the lease; losing the worker always ends capture. */
export function claimVoiceLease(granted: () => void, lost: () => void, refused: () => void) {
  const port = chrome.runtime.connect({ name: 'byoa-voice-owner' });
  let closed = false;
  const release = () => {
    if (!closed) {
      closed = true;
      port.disconnect();
    }
  };
  port.onDisconnect.addListener(() => {
    if (!closed) {
      closed = true;
      lost();
    }
  });
  port.onMessage.addListener((message) => {
    if (closed) return;
    if (message.lost) {
      release();
      lost();
    } else if (message.granted) granted();
    else {
      release();
      refused();
    }
  });
  port.postMessage({ type: 'claim' });
  return release;
}
