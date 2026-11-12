import { localRecognizer, withDeadline } from '../lib/local-speech';
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

const speechLanguage = document.querySelector<HTMLSelectElement>('#speech-language');
const speechStatus = document.querySelector<HTMLElement>('#speech-status');
const speechOptions = () => ({
  langs: [speechLanguage?.value || 'en-US'],
  processLocally: true as const,
});
document.querySelector('#speech-check')?.addEventListener('click', () => {
  const API = localRecognizer();
  if (!speechStatus) return;
  if (!API) {
    speechStatus.textContent = 'Local speech is unsupported in this Chrome version.';
    return;
  }
  void withDeadline(API.available(speechOptions()), 10000).then(
    (state) => {
      speechStatus.textContent =
        state === 'available'
          ? 'Ready. Return to the site and click its microphone.'
          : `Local language pack: ${state}.`;
    },
    () => {
      speechStatus.textContent = 'Could not check local speech. Try again.';
    }
  );
});
document.querySelector('#speech-install')?.addEventListener('click', () => {
  const API = localRecognizer();
  if (!speechStatus || !API) return;
  const install = API.install(speechOptions());
  speechStatus.textContent = 'Downloading a local speech model. No audio is uploaded.';
  void withDeadline(install, 120000).then(
    (ok) => {
      speechStatus.textContent = ok
        ? 'Language pack ready. Return to your site to start recording.'
        : 'Download did not complete. Check availability again.';
    },
    () => {
      speechStatus.textContent = 'Download timed out. Check availability again.';
    }
  );
});
