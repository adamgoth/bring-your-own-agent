import { afterEach, expect, it, vi } from 'vitest';
import { createFloatingVoice } from '../src/content-scripts/floating-voice';

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
});
it('replaces the iframe for a new binding but preserves it for ordinary refreshes', () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue(undefined);
  const sync = createFloatingVoice();
  sync(true, 'original');
  const original = document.querySelector('iframe')!;
  sync(true, 'original');
  expect(document.querySelector('iframe')).toBe(original);
  sync(true, 'replacement');
  expect(original.isConnected).toBe(false);
  const replacement = document.querySelector('iframe')!;
  expect(replacement).not.toBe(original);
  expect(replacement.src).toBe(chrome.runtime.getURL('src/site-voice/index.html'));
  sync(true, 'replacement');
  expect(document.querySelector('iframe')).toBe(replacement);
  sync(false);
  expect(document.querySelector('iframe')).toBeNull();
});

it('keeps voice running while the frame is dragged, then resumes the occlusion check', () => {
  vi.useFakeTimers();
  const listeners = new Map<string, (event: unknown) => void>();
  const add = vi.spyOn(globalThis, 'addEventListener').mockImplementation(((
    type: string,
    listener: (event: unknown) => void
  ) => {
    listeners.set(type, listener);
  }) as typeof globalThis.addEventListener);
  const elementFromPoint = vi.fn();
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: elementFromPoint,
  });
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const send = vi.mocked(chrome.runtime.sendMessage).mockResolvedValue(undefined);
  const hides = () =>
    send.mock.calls.filter(
      ([message]) => (message as unknown as { type?: string })?.type === 'SITE_VOICE_HIDE'
    ).length;
  try {
    const sync = createFloatingVoice();
    sync(true, 'binding');
    const frame = document.querySelector('iframe')!;
    frame.getBoundingClientRect = () => new DOMRect(100, 100, 84, 52);
    // jsdom computes an empty opacity, which the visibility check would read as 0.
    frame.style.opacity = '1';
    elementFromPoint.mockReturnValue(frame);
    send.mockClear();

    listeners.get('message')!({
      isTrusted: true,
      source: frame.contentWindow,
      origin: `chrome-extension://${chrome.runtime.id}`,
      data: { type: 'byoa-voice-drag', x: 10, y: 10 },
    });
    expect(frame.style.pointerEvents).toBe('none');
    // While dragging, hit-testing passes through the frame to the page.
    elementFromPoint.mockReturnValue(document.body);
    vi.advanceTimersByTime(1500);
    expect(hides()).toBe(0);

    listeners.get('pointerup')!({ isTrusted: true });
    expect(frame.style.pointerEvents).toBe('');
    vi.advanceTimersByTime(500);
    expect(hides()).toBe(1);
  } finally {
    add.mockRestore();
    hidden.mockRestore();
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    vi.useRealTimers();
    listeners.get('pagehide')?.(new Event('pagehide'));
  }
});
