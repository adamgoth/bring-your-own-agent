export function setupMicrophonePermission() {
  const allow = document.querySelector<HTMLButtonElement>('#allow-microphone');
  const status = document.querySelector<HTMLElement>('#permission-status');
  const help = document.querySelector<HTMLElement>('#permission-help');
  if (!allow || !status || !help) return;
  allow.addEventListener('click', () => {
    allow.disabled = true;
    status.textContent = 'Waiting for microphone permission. Choose Allow in Chrome’s prompt.';
    void (async () => {
      try {
        const stream = await globalThis.navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        // Permission acquisition only. Never attach the stream to a recorder or recognizer.
        stream.getTracks().forEach((track) => track.stop());
        help.hidden = true;
        status.textContent =
          'Microphone access is allowed. Return to your original tab and start dictation in the BYOA sidebar.';
        allow.textContent = 'Check microphone access again';
      } catch (error) {
        help.hidden = false;
        const name = error instanceof DOMException ? error.name : '';
        status.textContent =
          name === 'NotFoundError'
            ? 'No microphone was found. Connect a microphone, then try again.'
            : name === 'NotReadableError'
              ? 'Chrome could not open the microphone. Check whether another app is using it, then try again.'
              : 'Microphone access is blocked or the request was dismissed. Follow the steps below, then try again.';
      } finally {
        allow.disabled = false;
      }
    })();
  });
  document.querySelector('#microphone-settings')?.addEventListener('click', () => {
    void chrome.tabs.create({ url: 'chrome://settings/content/microphone' }).catch(() => {
      status.textContent =
        'Open Chrome Settings → Privacy and security → Site settings → Microphone.';
    });
  });
}
setupMicrophonePermission();
