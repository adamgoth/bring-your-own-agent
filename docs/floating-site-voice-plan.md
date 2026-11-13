# Floating voice on connected sites

Status: implemented on `codex/floating-site-voice`; repository checks and browser regressions passed. Native offscreen recognition was manually confirmed.

Implementation started on `codex/floating-site-voice`. The first-stage probe and evidence are in [floating-site-voice-feasibility.md](floating-site-voice-feasibility.md). Adam confirmed final native offscreen transcription and cleanup in the main build with the sidebar closed. Production implementation is complete in the main build.

## Product behavior

Voice mode (beta) is off by default in Settings. When enabled, show a small extension-owned mic only in a top-level document that has activated the BYOA integration and has a valid connection. An origin grant alone should not cause a widget on unrelated pages that never activate BYOA. No sidebar is required.

Click mic → recording bars, Cancel, Finish and Send. Finish shows a compact editable transcript with Send and Discard; Send during recording waits for final words and submits once. Preserve the current sidebar behavior. Show Working and cancellation while the site task runs. On completion show a brief excerpt of the actual response with Open conversation; collapse success after a short delay, retain access to the latest result, and keep errors until dismissed. Never invent a success summary or make another model call just to summarize. Escape cancels capture. Only one recording is active per browser profile.

Keep keyboard shortcuts, wake words, continuous listening, spoken replies, dragging/customization and a permanent mini-chat out of scope.

## What exists, and what needs to change

- `byoa-extension/src/sidebar/local-voice.ts` currently couples local recognition, draft handling and controls to sidebar DOM. `voice-meter.ts` also combines microphone capture and rendering. Extract a DOM-independent voice controller plus separate volume sampling and bar rendering.
- `src/voice-permission/` provides the extension-origin microphone permission flow. Reuse it and add visible local language-pack setup. Do not try to show permission prompts or initiate gesture-dependent downloads invisibly.
- `src/content-scripts/site-bridge.ts` stays dormant until the site invokes BYOA, then tracks connection status. Use this activation boundary and grant updates for widget mounting/removal.
- `src/background/site-agent.ts` executes independent site tasks, enforces grants/sharing/budgets and limits execution to explicitly requested registered page tools. It does not provide conversational history today.
- `src/background/chat-session.ts` provides the sidebar's general conversation. It is a separate execution path and is not a safe shortcut for site voice: using it directly would change the site's tool and permission boundaries.
- `src/sidebar/site-chat.ts` already renders site task history. `SITE_VIEW_CHAT` in `src/background/index.ts` opens the sidebar and focuses a task. Extend these rather than copying voice results into the general sidebar chat.

Correction to the initial concept: the mic and sidebar do not currently share a site conversation. Build a site-scoped conversation that both can view/continue, preserving separation from general sidebar chat.

## Implementation order

### 1. Prove local recognition with the sidebar closed

Create a minimal extension offscreen document using the `offscreen` permission and `USER_MEDIA` reason. It owns local SpeechRecognition and the microphone analyser; the service worker coordinates commands and owns task execution. The host sends volume values and recognition state through runtime messaging, never raw audio.

Gate further implementation on a real-browser spike: after explicit microphone permission and language-pack setup, start `processLocally=true` recognition from a widget gesture relayed through the worker, obtain final text, stop, and verify every stream/context releases with no sidebar open. Verify supported Chrome versions rather than assuming the sidebar's success proves offscreen compatibility. Hidden documents and gesture requirements may differ. The existing sidebar visibility-change cancellation must not be copied into an always-hidden offscreen host.

If native local recognition cannot run in this context, document that blocker and evaluate a visible extension-origin capture surface. Do not introduce cloud recognition or silently switch to a bundled local model engine.

### 2. Define the site conversation and tool contract

Extract reusable task execution from the port-oriented site handler so a worker-owned voice controller can submit under the same validated site context. Retain grant checks, profile choice, sharing, token/dollar budgets, registered-tool validation, cancellation, task IDs and recovery semantics.

Bind each recording and conversation to tab, top-level document, exact origin, private/regular profile and authorized agent. Derive identity from verified browser senders; never accept page-supplied tab IDs as authority. Recheck authorization and document identity before submission and tool execution.

A connection does not currently specify the tool allowlist needed for arbitrary speech: the site supplies `tools` on each request today. Add an explicit optional voice capability registration to the site integration (enabled, allowed registered page-tool names, optional bounded app instructions). Reuse the existing registry to validate names and detect changes. Older sites remain compatible but do not get an actionable voice mic until they opt in. Demonstrate this integration in Margin.

Add a site conversation ID linking its ordered tasks and approved text context. Follow-ups such as “make it shorter” use only this site's conversation, with bounded history; never include unrelated sidebar messages, other origins, or private-profile history. Reuse task storage/recovery and define document navigation as the initial conversation boundary. Keep successful task records available for review without automatically replaying interrupted work.

### 3. Add the floating control

Use the activated top-level content bridge to mount a small extension-origin iframe. Render transcript/results inside the extension origin, not the host page DOM. Add only the required web-accessible assets, validate the frame's binding to its parent document in the worker, and refuse unbound capture/control requests. Page messages must not start recording. Require a real user action on the extension control.

Reuse the smoothed bars and existing icons. Account for narrow windows, zoom, focus, keyboard access and page stacking. Preserve page scrolling. Use explicit states: idle, setup required, recording, finishing, review, working, result and error. No hidden background recording after tab switches, navigation, widget disappearance, disconnect or document loss. Close the offscreen host when idle; never auto-resume recording after worker restart.

### 4. Add brief results and conversation handoff

Display a bounded, safely rendered Markdown excerpt from the final response or the actual task status. Treat model and page content as data; never render arbitrary HTML. Distinguish completed, cancelled, interrupted, budget-limited and failed tasks, including partial results.

Open conversation uses the user's click to invoke `SITE_VIEW_CHAT` immediately and focuses the exact site conversation/task. Extend the existing App agent chat view with a scoped continuation input using the same site executor and permissions. Keep general sidebar chat separate and retain its draft. If opening the panel fails, show the existing toolbar fallback. Do not replay the task when switching views.

## Lifecycle and failure rules

- One capture owner per browser profile, shared between sidebar and widget; simultaneous starts return a clear busy state.
- Each capture has a unique ID. Ignore stale final results, duplicate Send, and events after cancellation. Losing the originating document before finalization prevents submission.
- Stop capture on tab change, navigation, tab close, grant revocation, widget disconnect, extension update and timeout. Already-submitted tasks retain existing task cancellation/recovery policy.
- A worker disconnect ends capture safely; no automatic restart or resubmission. A recognized but unsent draft is ephemeral.
- Permission denied, pack unavailable, silence and recognition failure never enable cloud fallback or send automatically.
- Context-menu insertion cancels active sidebar dictation before replacing the draft (fixed separately in PR #9); other composer replacement paths must follow the same ownership rule.
- Keep audio off disk and off the network. Send only approved final text through the existing configured agent flow. Persist conversation data only under existing session/privacy rules.

## Acceptance and delivery

First deliver the offscreen proof and capability decision. Then deliver the shared voice controller and site conversation/tool contract. Finish with the widget, Margin opt-in and sidebar handoff as a complete vertical slice.

Automated checks should cover sender/document validation, cross-origin/profile isolation, tool allowlists, budget and revocation behavior, duplicate/late events, concurrent starts, focus/navigation cleanup and permission recovery. Browser fixtures should exercise the actual extension with a synthetic microphone and deterministic recognition, including a site opt-in and result opening the correct conversation. A live local transcription check with the sidebar closed is separately required; deterministic fixtures do not prove speech API support or accuracy. Confirm no speech-service network fallback.

Done means: connect on the demo site, close the sidebar, dictate a task, see the site action and accurate brief result, open that conversation, and continue it without rerunning work or gaining broader tools.

## Browser reference

Chrome's offscreen API provides a hidden extension document, supports `USER_MEDIA`, and exposes runtime messaging as its extension API. It does not by itself establish that native local SpeechRecognition works there:
https://developer.chrome.com/docs/extensions/reference/api/offscreen
