# Floating site voice: feasibility gate

Status: **manual native offscreen transcription passed on November 12, 2026**. Adam tested the main BYOA build with the sidebar closed: offscreen events included speechstart/speechend/end, final text was “Okay make the heading shorter”, and final=true, active=false, released=true. Browser version and offline network-isolation were not supplied; do not infer a compatibility range or network trace. This passed the feasibility gate; the floating widget, site conversation contract, and shared capture host are now implemented. The sidebar has a development-only link to the diagnostic; its dictation behavior is unchanged.

## Probe

`byoa-extension/tests/browser/fixtures/voice-host` is the source of the diagnostic pages. Normal local builds also include them at `dist/voice-probe/`; release builds exclude the diagnostic pages and handler. Floating voice uses the offscreen permission in every build. The standalone unpacked fixture remains available for isolated automation. The standalone fixture declares only the `offscreen` permission. A visible extension page obtains microphone permission and installs the English pack explicitly. It relays capture through its worker into a `USER_MEDIA` offscreen document. The same native recognizer can be tested directly in the visible page as the alternative host. No sidebar is present.

The probe requires native `processLocally` support and `available({ processLocally: true }) === 'available'` before starting. It never substitutes a recognizer, calls an agent, or falls back to remote speech. Each run is bounded, and stops its microphone tracks and AudioContext. The runner checks the actual `OFFSCREEN_DOCUMENT` context, separately exercises synthetic microphone/analyser access, verifies cleanup, and closes the offscreen document. Exit 2 means the native offscreen transcript gate did not pass; it is not a successful recognition test.

## Observations on November 12, 2026

- Chrome for Testing **157.0.8103.38**, isolated temporary profile: explicit synthetic microphone permission succeeded and its tracks ended.
- Both extension hosts expose local recognition but report the English pack as `downloading`. Installation from the visible page exceeded the 120-second deadline. No native final transcript was obtained, so offscreen SpeechRecognition support is **neither established nor ruled out**.
- Independent `getUserMedia` and AudioContext/analyser creation work in both hosts. That does not establish speech recognition support.
- The offscreen document reports `visibilityState: 'visible'` and `hidden: false` in this version. Use `runtime.getContexts` to establish offscreen identity; do not infer it from DOM visibility or import sidebar visibility cancellation into the host.
- Chrome for Testing **158.0.8127.18** did not reliably initialize the diagnostic page and one run exited with `SIGTRAP`. It provides no speech compatibility result.
- The visible extension-origin alternative encounters the same language-pack prerequisite in 157. Switching hosts does not yet resolve this gate.
- A headed 157 run also timed out installing the pack. A follow-up with the visible tab explicitly foregrounded and a locally synthesized WAV again reported `downloading` in both hosts, verified the offscreen context and both media cleanups, closed the host, and exited **2** (gate not passed). The synthetic phrase was not transcribed.

No supported-version claim follows from these results. Recognition never started in the blocked runs, so no recognition-network trace or accuracy claim is made. The probe code has no cloud fallback; offline native transcription still needs verification after the pack is available.

Validation: extension typecheck, lint, and production build passed (`byoa-extension/dist` rebuilt); all 18 existing local-voice, voice-meter, and voice-permission tests passed. Probe JavaScript syntax and formatting checks passed. These checks do not satisfy the native transcription gate.

## Automated reproduction

To test the main build, add `BYOA_VOICE_MAIN_DIST=1` to the command below. From `byoa-extension`, set `CHROME_FOR_TESTING_BIN` to a Chrome for Testing executable and run:

```sh
BYOA_VOICE_INSTALL=1 pnpm test:browser:voice-host
```

The runner always creates a temporary profile and uses a synthetic microphone, even with `BYOA_VOICE_HEADED=1`. It never accesses the user's real microphone or their installed Chrome profile. Supply `BYOA_VOICE_AUDIO=/absolute/path/to/synthetic-speech.wav` for an intelligible synthetic phrase. The default fake-device signal cannot establish transcription accuracy. `BYOA_VOICE_DEBUG=1` includes browser diagnostics. Browser and temporary profile are cleaned up on completion; a four-minute watchdog bounds browser stalls.

## Smallest manual test to unblock the decision

1. Reload the existing BYOA extension from `byoa-extension/dist`. In its sidebar open **Voice settings → Test voice with sidebar closed**. This opens a diagnostic tab in the same extension. Close the sidebar before starting recognition; no separate extension or site connection is needed.
2. Click **Allow microphone**, then **Install local English pack**. Click **Check both hosts** until both say `available`. Permission setup releases its microphone immediately and never begins recognition.
3. Click **Start offscreen recognition**, say “Please make the heading shorter,” then wait up to 15 seconds and click **Read results from both hosts**. Record the Chrome version and offscreen report. A passing report needs the expected final text, `final: true`, `active: false`, and `released: true`.
4. If offscreen fails, use **Start visible recognition** for the same phrase and read the results again. This distinguishes a host limitation from a general local-recognition issue. Use **Stop and release both hosts** if needed.
5. After setup, repeat recognition with networking disabled to verify local operation. Close the diagnostic tab afterward (keep your main BYOA installation).

This manual step is explicitly user-operated; automation must not record the real microphone. A successful deterministic sidebar fixture is not a substitute for this native-host result.

## Implementation and validation

The main `byoa-extension/dist` now includes the opt-in floating control, worker-owned offscreen capture, bounded site conversation, and scoped sidebar continuation. Margin opts in to its five editing tools.

Repository checks passed: 1,230 extension tests, 5 Margin tests, 10 Boardwalk tests, typecheck, lint, and builds. The existing two-app browser regression passed. The synthetic sidebar browser test passed waveform, review, final Send, context-menu cancellation, and microphone cleanup. The floating browser fixture uses deterministic recognition and a synthetic microphone to verify the real extension/task/tool/conversation path; native speech accuracy remains covered only by the separate manual evidence above.

Chrome documents `USER_MEDIA` and runtime-only extension API access for offscreen documents, but does not promise native SpeechRecognition compatibility: [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

Main-dist validation: the same runner with `BYOA_VOICE_MAIN_DIST=1` reached both native APIs through the main service worker, verified synthetic media/context cleanup and offscreen document closure, and exited 2 because the isolated profile still lacked the speech pack. This confirms diagnostic integration, not native transcription.
