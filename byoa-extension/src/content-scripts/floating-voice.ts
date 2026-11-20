/** Collapsed frame: the BYOA + mic launcher pill plus room for its shadow. */
const LAUNCHER = { width: 84, height: 52 };
/** Default gap from the bottom-right corner, and the least the frame keeps from any edge. */
const MARGIN = 12;
const EDGE = 4;
const positionKey = () => `siteVoicePosition:${globalThis.location.origin}`;
type Offset = { right: number; bottom: number };
const isOffset = (value: unknown): value is Offset =>
  typeof value === 'object' &&
  value !== null &&
  Number.isFinite((value as Offset).right) &&
  Number.isFinite((value as Offset).bottom);
const isGrab = (value: unknown) =>
  Number.isFinite(value) && (value as number) >= 0 && (value as number) <= 400;

/** Only the extension iframe sees transcripts; the host page receives size changes only. */
export function createFloatingVoice() {
  let bindingId: string | undefined;
  let frame: HTMLIFrameElement | undefined;
  let visibility: ReturnType<typeof setInterval> | undefined;
  /** The frame being dragged; it ignores the pointer meanwhile, so hit-testing cannot see it. */
  let dragging: HTMLIFrameElement | undefined;
  /** Where the person dragged it, as distances from the right and bottom edges. */
  let wanted: Offset = { right: MARGIN, bottom: MARGIN };
  /** Keep the whole frame on screen; an expanded panel may shift, but `wanted` is kept for when it collapses. */
  const place = () => {
    if (!frame) return;
    const { width, height } = frame.getBoundingClientRect();
    const clamp = (value: number, room: number) =>
      Math.max(EDGE, Math.min(Math.max(EDGE, room - EDGE), value));
    frame.style.setProperty(
      'right',
      `${clamp(wanted.right, globalThis.innerWidth - width)}px`,
      'important'
    );
    frame.style.setProperty(
      'bottom',
      `${clamp(wanted.bottom, globalThis.innerHeight - height)}px`,
      'important'
    );
  };
  const current = (): Offset => ({
    right: parseFloat(frame?.style.right ?? '') || MARGIN,
    bottom: parseFloat(frame?.style.bottom ?? '') || MARGIN,
  });
  const save = () => void chrome.storage.local.set({ [positionKey()]: wanted }).catch(() => {});
  globalThis.addEventListener('resize', place);
  /**
   * The frame reports that a drag started, and where in the frame it was grabbed. Moving an iframe under
   * the pointer breaks its event routing, so the page tracks the rest of the drag with the frame ignoring
   * the pointer. The release lands on the page, so a drag never becomes a click inside the frame.
   */
  const drag = (grabX: number, grabY: number) => {
    if (!frame) return;
    const moving = frame;
    dragging = moving;
    moving.style.setProperty('pointer-events', 'none', 'important');
    const root = document.documentElement;
    const cursor = root.style.cursor;
    root.style.cursor = 'grabbing';
    const move = (event: PointerEvent) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      const { width, height } = moving.getBoundingClientRect();
      wanted = {
        right: globalThis.innerWidth - (event.clientX - grabX) - width,
        bottom: globalThis.innerHeight - (event.clientY - grabY) - height,
      };
      place();
      wanted = current();
    };
    const stop = (event: Event) => {
      if (!event.isTrusted) return;
      globalThis.removeEventListener('pointermove', move, true);
      globalThis.removeEventListener('pointerup', stop, true);
      globalThis.removeEventListener('pointercancel', stop, true);
      globalThis.removeEventListener('blur', stop);
      if (dragging === moving) dragging = undefined;
      moving.style.removeProperty('pointer-events');
      root.style.cursor = cursor;
      save();
    };
    globalThis.addEventListener('pointermove', move, true);
    globalThis.addEventListener('pointerup', stop, true);
    globalThis.addEventListener('pointercancel', stop, true);
    globalThis.addEventListener('blur', stop);
  };
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
    if (event.data?.type === 'byoa-voice-drag' && isGrab(event.data.x) && isGrab(event.data.y)) {
      drag(event.data.x, event.data.y);
      return;
    }
    if (event.data?.type === 'byoa-voice-move-reset') {
      wanted = { right: MARGIN, bottom: MARGIN };
      place();
      void chrome.storage.local.remove(positionKey()).catch(() => {});
      return;
    }
    if (event.data?.type !== 'byoa-voice-size') return;
    const expanded = event.data.expanded === true;
    frame.style.setProperty(
      'width',
      expanded ? 'min(340px, calc(100vw - 24px))' : `${LAUNCHER.width}px`,
      'important'
    );
    const height = Number.isFinite(event.data.height)
      ? Math.max(LAUNCHER.height, Math.min(380, event.data.height))
      : 380;
    frame.style.setProperty(
      'height',
      expanded ? `${height}px` : `${LAUNCHER.height}px`,
      'important'
    );
    place();
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
    frame.style.cssText = `position:fixed!important;bottom:12px!important;right:12px!important;width:${LAUNCHER.width}px!important;height:${LAUNCHER.height}px!important;max-height:calc(100vh - 24px)!important;border:0!important;z-index:2147483647!important;background:transparent!important;color-scheme:light!important;`;
    document.documentElement.append(frame);
    void chrome.storage.local
      .get(positionKey())
      .then((stored) => {
        const saved = stored?.[positionKey()];
        if (isOffset(saved)) {
          wanted = saved;
          place();
        }
      })
      .catch(() => {});
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
        // A drag sets pointer-events: none, which hides the frame from hit-testing; skip only this check then.
        (dragging !== frame &&
          document.elementFromPoint(
            Math.min(globalThis.innerWidth - 1, Math.max(0, rect.x + rect.width / 2)),
            Math.min(globalThis.innerHeight - 1, Math.max(0, rect.y + rect.height / 2))
          ) !== frame) ||
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        Number(style.opacity) === 0
      )
        hide();
    }, 500);
  };
}
