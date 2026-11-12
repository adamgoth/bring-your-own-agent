import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { setupMicrophonePermission } from '../src/voice-permission/index';
const capture = vi.fn();
beforeEach(() => {
  capture.mockReset();
  document.body.innerHTML = readFileSync('src/voice-permission/index.html', 'utf8');
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: capture },
  });
  setupMicrophonePermission();
});
it('requests audio only on click and immediately stops every acquired track', async () => {
  const stop = vi.fn();
  capture.mockResolvedValue({ getTracks: () => [{ stop }] });
  expect(capture).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('#allow-microphone')!.click();
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  expect(capture).toHaveBeenCalledWith({ audio: true, video: false });
  expect(document.querySelector('#permission-status')?.textContent).toContain('access is allowed');
});
it('explains blocked access and allows a deliberate retry', async () => {
  capture.mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'));
  const allow = document.querySelector<HTMLButtonElement>('#allow-microphone')!;
  allow.click();
  await vi.waitFor(() => expect(document.getElementById('permission-help')?.hidden).toBe(false));
  expect(allow.disabled).toBe(false);
  expect(document.querySelector('#permission-status')?.textContent).toContain('blocked');
  expect(capture).toHaveBeenCalledOnce();
});
it('distinguishes a missing microphone from permission denial', async () => {
  capture.mockRejectedValue(new DOMException('Missing', 'NotFoundError'));
  document.querySelector<HTMLButtonElement>('#allow-microphone')!.click();
  await vi.waitFor(() =>
    expect(document.querySelector('#permission-status')?.textContent).toContain(
      'No microphone was found'
    )
  );
});
