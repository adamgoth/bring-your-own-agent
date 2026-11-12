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
