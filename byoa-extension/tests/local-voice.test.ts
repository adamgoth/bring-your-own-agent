import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  localRecognizer,
  setupLocalVoice,
  type LocalRecognition,
} from '../src/sidebar/local-voice';
vi.mock('../src/lib/voice-lease', () => ({
  claimVoiceLease: (granted: () => void) => {
    granted();
    return () => {};
  },
}));
vi.mock('../src/sidebar/voice-meter', () => ({ startVoiceMeter: vi.fn(() => vi.fn()) }));
let active: FakeRecognition;
class FakeRecognition {
  static available = vi.fn(async () => 'available');
  static install = vi.fn(async () => true);
  get processLocally() {
    return this.local;
  }
  set processLocally(value: boolean) {
    this.local = value;
  }
  local = false;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: LocalRecognition['onresult'] = null;
  onerror: LocalRecognition['onerror'] = null;
  onend: LocalRecognition['onend'] = null;
  constructor() {
    active = this;
  }
  start = vi.fn(() => expect(this.processLocally).toBe(true));
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
}
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = readFileSync('src/sidebar/index.html', 'utf8');
  Object.defineProperty(window, 'SpeechRecognition', {
    configurable: true,
    value: FakeRecognition,
  });
  Object.defineProperty(window, 'webkitSpeechRecognition', {
    configurable: true,
    value: undefined,
  });
  FakeRecognition.available.mockResolvedValue('available');
});
it('fails closed for legacy cloud-capable recognition without local support', () => {
  Object.defineProperty(window, 'SpeechRecognition', {
    value: class {
      start = vi.fn();
    },
  });
  expect(localRecognizer()).toBeUndefined();
  setupLocalVoice();
  expect(button('voice-record').disabled).toBe(true);
  expect(document.getElementById('voice-status')?.textContent).toContain('does not support');
});
it('records locally, then appends the transcript to the composer without sending', async () => {
  setupLocalVoice();
  await vi.waitFor(() => expect(button('voice-record').disabled).toBe(false));
  const composer = document.getElementById('message-input') as HTMLTextAreaElement;
  composer.value = 'Existing draft';
  button('voice-button').click();
  active.onresult?.({ results: [[{ transcript: 'Hello local speech' }]] });
  expect(composer.value).toBe('Existing draft');
  expect(composer.readOnly).toBe(true);
  expect(document.getElementById('voice-recording')?.hidden).toBe(false);
  button('voice-button').click();
  expect(composer.value).toBe('Existing draft\nHello local speech');
  expect(composer.readOnly).toBe(false);
  expect(document.getElementById('voice-recording')?.hidden).toBe(true);
  expect(FakeRecognition.available).toHaveBeenCalledWith({
    langs: ['en-US'],
    processLocally: true,
  });
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
it('does not retry remotely after a local recognition error', async () => {
  setupLocalVoice();
  await vi.waitFor(() => expect(button('voice-record').disabled).toBe(false));
  button('voice-record').click();
  active.onerror?.({ error: 'language-not-supported' });
  expect(active.abort).toHaveBeenCalledOnce();
  expect(active.start).toHaveBeenCalledOnce();
  expect(active.processLocally).toBe(true);
  expect(document.getElementById('voice-status')?.textContent).toContain('No cloud service');
});
it('downloads only after an explicit click and keeps recording disabled until available', async () => {
  FakeRecognition.available.mockResolvedValue('downloadable');
  setupLocalVoice();
  await vi.waitFor(() => expect(button('voice-install').hidden).toBe(false));
  expect(FakeRecognition.install).not.toHaveBeenCalled();
  expect(button('voice-record').disabled).toBe(true);
  FakeRecognition.available.mockResolvedValue('available');
  button('voice-install').click();
  await vi.waitFor(() => expect(button('voice-record').disabled).toBe(false));
  expect(FakeRecognition.install).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
});

it('discards capture and ignores late recognition events', async () => {
  setupLocalVoice();
  await vi.waitFor(() => expect(button('voice-record').disabled).toBe(false));
  button('voice-record').click();
  active.onresult?.({ results: [[{ transcript: 'discard this' }]] });
  button('voice-cancel').click();
  active.onresult?.({ results: [[{ transcript: 'late result' }]] });
  expect(active.abort).toHaveBeenCalledOnce();
  expect(document.getElementById('voice-recording')?.hidden).toBe(true);
  expect((document.getElementById('message-input') as HTMLTextAreaElement).value).toBe('');
});

it('waits for final words before allowing Send and stops only once', async () => {
  const voice = setupLocalVoice()!;
  await vi.waitFor(() => expect(button('voice-record').disabled).toBe(false));
  button('voice-button').click();
  active.stop.mockImplementation(() => {});
  active.onresult?.({ results: [[{ transcript: 'interim' }]] });
  const completed = vi.fn();
  const result = voice.finishForSend().then(completed);
  void voice.finishForSend();
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  expect(active.stop).toHaveBeenCalledOnce();
  active.onresult?.({ results: [[{ transcript: 'Final words included' }]] });
  active.onend?.();
  await result;
  expect(completed).toHaveBeenCalledWith(true);
  expect((document.getElementById('message-input') as HTMLTextAreaElement).value).toBe(
    'Final words included'
  );
});
it('does not permit Send when recording ends without speech', async () => {
  const voice = setupLocalVoice()!;
  await vi.waitFor(() => expect(button('voice-record').disabled).toBe(false));
  button('voice-button').click();
  expect(await voice.finishForSend()).toBe(false);
});
it('does not permit Send after a recognition error', async () => {
  const voice = setupLocalVoice()!;
  await vi.waitFor(() => expect(button('voice-record').disabled).toBe(false));
  button('voice-button').click();
  active.stop.mockImplementation(() => {});
  const result = voice.finishForSend();
  active.onerror?.({ error: 'not-allowed' });
  expect(await result).toBe(false);
});
it('offers a dedicated permission page after denial without requesting access automatically', async () => {
  vi.mocked(chrome.tabs.create).mockResolvedValue(undefined);
  setupLocalVoice();
  await vi.waitFor(() => expect(button('voice-record').disabled).toBe(false));
  button('voice-button').click();
  active.onerror?.({ error: 'not-allowed' });
  expect(document.getElementById('voice-permission-help')?.hidden).toBe(false);
  expect(chrome.tabs.create).not.toHaveBeenCalled();
  button('voice-permission').click();
  expect(chrome.tabs.create).toHaveBeenCalledWith({
    url: 'chrome-extension://test-extension-id/src/voice-permission/index.html',
  });
});
it('keeps partial text for review and refuses Send if finalization times out', async () => {
  const voice = setupLocalVoice()!;
  await vi.waitFor(() => expect(button('voice-record').disabled).toBe(false));
  vi.useFakeTimers();
  try {
    button('voice-button').click();
    active.stop.mockImplementation(() => {});
    active.onresult?.({ results: [[{ transcript: 'Partial words' }]] });
    const result = voice.finishForSend();
    await vi.advanceTimersByTimeAsync(8000);
    expect(await result).toBe(false);
    expect(active.abort).toHaveBeenCalledOnce();
    expect((document.getElementById('message-input') as HTMLTextAreaElement).value).toBe(
      'Partial words'
    );
  } finally {
    vi.useRealTimers();
  }
});

it('cancels a pending Send and preserves the typed draft even if abort throws', async () => {
  const voice = setupLocalVoice()!;
  await vi.waitFor(() => expect(button('voice-record').disabled).toBe(false));
  const composer = document.getElementById('message-input') as HTMLTextAreaElement;
  composer.value = 'Keep this draft';
  button('voice-button').click();
  active.stop.mockImplementation(() => {});
  active.abort.mockImplementation(() => {
    throw new Error('Already ended');
  });
  active.onresult?.({ results: [[{ transcript: 'Discard these words' }]] });
  const result = voice.finishForSend();
  button('voice-cancel').click();
  expect(await result).toBe(false);
  expect(composer.value).toBe('Keep this draft');
  expect(composer.readOnly).toBe(false);
  expect(document.activeElement).toBe(composer);
  active.onend?.();
  expect(composer.value).toBe('Keep this draft');
});

it('preserves an external composer edit and suppresses a pending voice Send', async () => {
  const voice = setupLocalVoice();
  await vi.waitFor(() => expect(button('voice-record').disabled).toBe(false));
  button('voice-button').click();
  active.stop.mockImplementation(() => {});
  active.onresult?.({ results: [[{ transcript: 'Old dictation' }]] });
  const finishing = voice?.finishForSend();
  const composer = document.getElementById('message-input') as HTMLTextAreaElement;
  composer.value = 'Use the chosen action';
  composer.dispatchEvent(new Event('input'));
  active.onend?.();
  expect(await finishing).toBe(false);
  expect(composer.value).toBe('Use the chosen action');
});
