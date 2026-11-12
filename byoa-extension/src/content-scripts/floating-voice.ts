/** Only the extension iframe sees transcripts; the host page receives size changes only. */
export function createFloatingVoice() {
  let bindingId: string | undefined;
  let frame: HTMLIFrameElement | undefined;
  let visibility: ReturnType<typeof setInterval> | undefined;
  const hide = () => {
    void chrome.runtime.sendMessage({ type: 'SITE_VOICE_HIDE' }).catch(() => {});
  };
  const remove = () => {
    hide();
    clearInterval(visibility);
    frame?.remove();
    frame = undefined;
  };
  globalThis.addEventListener('pagehide', remove);
  globalThis.addEventListener('message', (event) => {
    if (
      !event.isTrusted ||
      !frame ||
      event.source !== frame.contentWindow ||
      event.origin !== `chrome-extension://${chrome.runtime.id}`
    )
      return;
    if (event.data?.type === 'byoa-voice-bind' && typeof event.data.nonce === 'string') {
      void chrome.runtime
        .sendMessage({ type: 'SITE_VOICE_BIND', nonce: event.data.nonce })
        .catch(() => {});
      return;
    }
    if (event.data?.type !== 'byoa-voice-size') return;
    const expanded = event.data.expanded === true;
    frame.style.setProperty(
      'width',
      expanded ? 'min(340px, calc(100vw - 24px))' : '64px',
      'important'
    );
    const height = Number.isFinite(event.data.height)
      ? Math.max(64, Math.min(330, event.data.height))
      : 330;
    frame.style.setProperty('height', expanded ? `${height}px` : '64px', 'important');
  });
  return (enabled: boolean, nextBindingId?: string) => {
    if (!enabled) {
      if (frame) remove();
      return;
    }
    if (frame?.isConnected && bindingId === nextBindingId) return;
    if (frame) remove();
    if (!document.documentElement) return;
    bindingId = nextBindingId;
    frame = document.createElement('iframe');
    frame.src = chrome.runtime.getURL('src/site-voice/index.html');
    frame.title = 'BYOA voice';
    frame.style.cssText =
      'position:fixed!important;bottom:12px!important;right:12px!important;width:64px!important;height:64px!important;max-height:calc(100vh - 24px)!important;border:0!important;z-index:2147483647!important;background:transparent!important;color-scheme:light!important;';
    document.documentElement.append(frame);
    visibility = setInterval(() => {
      if (!frame?.isConnected) {
        remove();
        return;
      }
      const rect = frame.getBoundingClientRect();
      const style = globalThis.getComputedStyle(frame);
      if (
        document.hidden ||
        !rect.width ||
        !rect.height ||
        rect.bottom < 0 ||
        rect.top > globalThis.innerHeight ||
        rect.right < 0 ||
        rect.left > globalThis.innerWidth ||
        document.elementFromPoint(
          Math.min(globalThis.innerWidth - 1, Math.max(0, rect.x + rect.width / 2)),
          Math.min(globalThis.innerHeight - 1, Math.max(0, rect.y + rect.height / 2))
        ) !== frame ||
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        Number(style.opacity) === 0
      )
        hide();
    }, 500);
  };
}
