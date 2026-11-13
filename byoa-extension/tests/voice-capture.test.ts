import { afterEach, expect, it, vi } from 'vitest';
import { createVoiceCapture } from '../src/lib/voice-capture';
import { createVoiceOwner } from '../src/background/voice-owner';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('enforces one capture owner and notifies on focus cancellation', () => {
  const owner = createVoiceOwner();
  const a = {},
    b = {};
  const lost = vi.fn();
  expect(owner.claim(a, lost)).toBe(true);
  expect(owner.claim(b, vi.fn())).toBe(false);
  owner.release(b);
  expect(owner.claim(b, vi.fn())).toBe(false);
  owner.cancel();
  expect(lost).toHaveBeenCalledOnce();
  expect(owner.claim(b, vi.fn())).toBe(true);
  owner.release(b);
});
it('cancellation invalidates a pending availability check and never opens recognition', async () => {
  let resolve!: (value: string) => void;
  const start = vi.fn();
  class Speech {
    get processLocally() {
      return true;
    }
    static available = () =>
      new Promise<string>((done) => {
        resolve = done;
      });
    static install = async () => true;
    start = start;
  }
  vi.stubGlobal('SpeechRecognition', Speech);
  const result = vi.fn();
  const capture = createVoiceCapture({ result });
  const pending = capture.start('en-US');
  capture.cancel();
  resolve('available');
  await pending;
  expect(start).not.toHaveBeenCalled();
  expect(result).toHaveBeenCalledOnce();
  expect(result).toHaveBeenCalledWith({ text: '', ok: false, cancelled: true });
});
