# Local-only sidebar dictation

The composer microphone starts local dictation. A live waveform displays samples from the microphone using a Web Audio analyser; no audio is saved or connected to speakers.

- Click the microphone again to finish and append the transcript to your existing message for editing.
- Click Send during recording to stop, wait for final recognition results, and submit the complete message once.
- Click × or press Escape to discard the current dictation and retain your original typed draft.
- Errors, empty recognition, and an eight-second finishing timeout never automatically send. Partial text remains available for review after an error or timeout.
- Recording stops after 60 seconds, when the sidebar is hidden, or when it closes. Captured audio tracks and the audio analyser are released.

Voice settings lets you choose English (US), English (UK), or Swedish and explicitly download a browser-managed language pack when required. A permission error offers an extension-owned setup page. Its Allow microphone button requests access only after a click and immediately stops all acquired tracks. Returning to the sidebar never starts recording automatically.

Only recognition implementations exposing `processLocally`, `available`, and `install` are accepted. Availability and installation require local processing, and each recognition instance sets `processLocally = true` before starting. Unsupported browsers, unavailable packs and failures never fall back to a remote service. No extra API key is needed for transcription. The selected agent processes the text only after Send, using the existing chat flow.

## Try it

1. Reload the unpacked extension from `byoa-extension/dist` and reopen the sidebar.
2. With an agent selected, click the composer microphone. If setup is needed, follow Voice settings to download the language pack or enable access.
3. Speak and watch the waveform. Click the mic to finish and edit, or click Send to finish and submit directly.

## Validation

Focused tests cover local-only recognition, final result waiting, cancellation and late events, errors, permission setup, and microphone/audio-context cleanup. The built-extension browser fixture uses a temporary Chrome profile, a synthetic microphone and a deterministic recognizer to verify composer layout, actual waveform drawing and Send integration. This does not measure recognition accuracy.

Manual testing confirmed local transcription in installed Chrome. Chrome for Testing 148 exposed the local API and a downloadable English pack, but its installation attempt timed out. Availability checks are bounded at ten seconds and installation at two minutes; neither failure enables a cloud fallback.
