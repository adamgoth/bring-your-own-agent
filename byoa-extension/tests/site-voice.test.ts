import { beforeEach, expect, it, vi } from 'vitest';
import { parseSiteVoice } from '../src/lib/site-voice';
import { setupSiteVoice } from '../src/background/site-voice';
const mocks = vi.hoisted(() => ({
  voiceMode: true,
  grant: { agentId: 'agent', share: {}, persist: 'session', lastUsedAt: 1 },
  execute: vi.fn(),
  release: vi.fn(),
  start: vi.fn(),
  tool: vi.fn(() => true),
  capability: {},
  watch: vi.fn((_tabId: number, _callback: () => void) => () => {}),
  prepare: vi.fn(async () => {}),
}));
vi.mock('../src/lib/site-grant', () => ({
  readSiteGrant: async () => mocks.grant,
  onGrantChanged: vi.fn(),
}));
vi.mock('../src/background/site-connection', () => ({
  siteOrigin: (s: chrome.runtime.MessageSender) =>
    s.frameId === 0 && s.url && s.tab?.id ? new URL(s.url).origin : undefined,
  siteConnectionStatus: async () => ({ connected: true, agentId: 'agent' }),
}));
vi.mock('../src/lib/webmcp/tool-registry', () => ({
  getToolRegistry: () => ({
    hasSiteTool: mocks.tool,
    isProtectedToolName: () => false,
    getToolForTab: () => mocks.capability,
    onTabToolsChanged: mocks.watch,
  }),
}));
vi.mock('../src/background/site-tasks', () => ({ lookupSiteTasks: async () => [] }));
vi.mock('../src/background/voice-owner', () => ({
  createVoiceOwner: () => ({
    connect: () => false,
    release: mocks.release,
    start: mocks.start,
    cancel: vi.fn(),
    stop: vi.fn(),
  }),
}));
const sender = {
  id: 'test-extension-id',
  tab: { id: 7, incognito: false },
  frameId: 0,
  documentId: 'doc',
  url: 'https://example.test/app',
} as chrome.runtime.MessageSender;
let listener: (
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  reply: (value: unknown) => void
) => boolean;
let connect: (port: chrome.runtime.Port) => void;
let frame: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.grant.lastUsedAt = 1;
  mocks.voiceMode = true;
  mocks.prepare.mockReset().mockResolvedValue(undefined);
  frame = { documentId: 'widget', parentFrameId: 0, parentDocumentId: 'doc' };
  Object.assign(chrome, {
    extension: { inIncognitoContext: false },
    webNavigation: {
      onBeforeNavigate: { addListener: vi.fn() },
      getFrame: vi.fn(async ({ frameId }: { frameId: number }) =>
        frameId === 0 ? { documentId: 'doc', url: sender.url } : frame
      ),
    },
    tabs: {
      onRemoved: { addListener: vi.fn() },
      onActivated: { addListener: vi.fn() },
      query: async () => [{ id: 7 }],
      get: async () => ({ id: 7, incognito: false }),
    },
    windows: { onFocusChanged: { addListener: vi.fn() } },
  });
  chrome.runtime.onMessage.addListener = vi.fn((value) => {
    listener = value as typeof listener;
  });
  chrome.runtime.onConnect = {
    addListener: vi.fn((value) => {
      connect = value;
    }),
  } as unknown as typeof chrome.runtime.onConnect;
  setupSiteVoice({
    config: { get: async () => ({ voiceMode: mocks.voiceMode }) } as never,
    execute: mocks.execute,
    prepare: mocks.prepare,
    open: async () => {},
  });
});
async function register(instructions = '') {
  return new Promise((resolve) =>
    listener(
      { type: 'SITE_VOICE_SYNC', options: { enabled: true, tools: ['edit'], instructions } },
      sender,
      resolve
    )
  );
}
function widget() {
  let message: (value: Record<string, unknown>) => void = () => {};
  const disconnects: (() => void)[] = [];
  const port = {
    name: 'byoa-site-voice',
    sender: {
      ...sender,
      url: chrome.runtime.getURL('src/site-voice/index.html'),
      frameId: 4,
      documentId: 'widget',
    },
    postMessage: vi.fn((value: { type: string; nonce?: string }) => {
      if (value.type === 'bind-challenge')
        listener(
          { type: 'SITE_VOICE_BIND', nonce: value.nonce },
          { ...sender, documentId: frame.parentDocumentId as string },
          () => {}
        );
    }),
    disconnect: vi.fn(() => disconnects.forEach((fn) => fn())),
    onMessage: {
      addListener: (fn: typeof message) => {
        message = fn;
      },
    },
    onDisconnect: { addListener: (fn: () => void) => disconnects.push(fn) },
  } as unknown as chrome.runtime.Port;
  connect(port);
  return { port, send: (value: Record<string, unknown>) => message(value) };
}
it('requires explicit bounded opt-in with tool names, discarding extra authority', () => {
  expect(() => parseSiteVoice({ enabled: true, tools: [] })).toThrow();
  expect(() =>
    parseSiteVoice({ enabled: true, tools: ['edit'], instructions: 'x'.repeat(2001) })
  ).toThrow();
  expect(
    parseSiteVoice({ enabled: true, tools: ['edit', 'edit'], share: { memory: true } })
  ).toEqual({ enabled: true, tools: ['edit'], instructions: '' });
});
it('does not bind a frame from another parent document', async () => {
  await register();
  frame.parentDocumentId = 'other-document';
  const { port, send } = widget();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'bound' }));
  send({ type: 'start' });
  expect(mocks.start).not.toHaveBeenCalled();
});
it('binds the verified extension iframe and ignores grant touch timestamps', async () => {
  await register();
  mocks.grant.lastUsedAt = 2;
  const { port, send } = widget();
  await vi.waitFor(() =>
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'bound' }))
  );
  send({ type: 'start', language: 'en-US' });
  await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
});
it('cancelling a queued start prevents late microphone acquisition', async () => {
  await register();
  const { port, send } = widget();
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
  send({ type: 'start' });
  send({ type: 'cancel' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mocks.start).not.toHaveBeenCalled();
});
it('rejects sidebar continuation for a different conversation without executing', async () => {
  await register();
  const reply = vi.fn();
  listener(
    { type: 'SITE_VOICE_CONTINUE', tabId: 7, conversationId: 'other', text: 'Continue' },
    { id: chrome.runtime.id, url: chrome.runtime.getURL('src/sidebar/index.html#tab=7') },
    reply
  );
  expect(reply).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  expect(mocks.execute).not.toHaveBeenCalled();
});

async function boundWidget() {
  const registered = await register();
  expect(registered).toEqual({ enabled: true, bindingId: expect.any(String) });
  const widgetPort = widget();
  await vi.waitFor(() =>
    expect(widgetPort.port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bound' })
    )
  );
  return { ...widgetPort, bindingId: (registered as { bindingId: string }).bindingId };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
it.each(['cancel', 'disconnect'])(
  'prevents submission after %s during preparation',
  async (action) => {
    const { port, send } = await boundWidget();
    const pending = deferred();
    mocks.prepare.mockReturnValueOnce(pending.promise);
    send({ type: 'submit', text: 'Edit the heading' });
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(2));
    if (action === 'cancel') send({ type: 'cancel' });
    else port.disconnect();
    pending.resolve();
    await flush();
    expect(mocks.execute).not.toHaveBeenCalled();
  }
);
it('cancels sidebar submission while preparation is pending', async () => {
  const { bindingId } = await boundWidget();
  const pending = deferred();
  mocks.prepare.mockReturnValueOnce(pending.promise);
  const sidebar = {
    id: chrome.runtime.id,
    url: chrome.runtime.getURL('src/sidebar/index.html#tab=7'),
  };
  const reply = vi.fn();
  listener(
    { type: 'SITE_VOICE_CONTINUE', tabId: 7, conversationId: bindingId, text: 'Edit' },
    sidebar,
    reply
  );
  await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(2));
  await new Promise((resolve) =>
    listener({ type: 'SITE_VOICE_CANCEL', tabId: 7, conversationId: bindingId }, sidebar, resolve)
  );
  pending.resolve();
  await vi.waitFor(() =>
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('cancelled') })
    )
  );
  expect(mocks.execute).not.toHaveBeenCalled();
});
it('returns a new binding identity when the enabled policy changes', async () => {
  const { port, bindingId } = await boundWidget();
  expect(await register()).toEqual({ enabled: true, bindingId });
  const replacement = (await register('New guidance')) as { bindingId: string };
  expect(replacement.bindingId).not.toBe(bindingId);
  expect(port.disconnect).toHaveBeenCalledOnce();
  const next = widget();
  await vi.waitFor(() =>
    expect(next.port.postMessage).toHaveBeenCalledWith({
      type: 'bound',
      conversationId: replacement.bindingId,
    })
  );
});
it('does not forward terminal usage updates after a result or into the next task', async () => {
  const { port, send } = await boundWidget();
  send({ type: 'submit', text: 'First' });
  await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
  const channel = mocks.execute.mock.calls[0][0] as chrome.runtime.Port;
  channel.postMessage({ taskId: 'first', status: 'cancelled', detail: 'Cancelled', busy: false });
  await vi.waitFor(() =>
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'result' }))
  );
  await flush();
  send({ type: 'submit', text: 'Second' });
  await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
  vi.mocked(port.postMessage).mockClear();
  channel.postMessage({ taskId: 'first', status: 'cancelled', detail: 'Late usage', busy: false });
  await flush();
  expect(port.postMessage).not.toHaveBeenCalled();
});

it('rebinds after the registered tool capability is replaced', async () => {
  const { port, bindingId } = await boundWidget();
  mocks.capability = {};
  mocks.watch.mock.calls.at(-1)![1]();
  expect(port.disconnect).toHaveBeenCalledOnce();
  const replacement = (await register()) as { bindingId: string };
  expect(replacement.bindingId).not.toBe(bindingId);
  const next = widget();
  await vi.waitFor(() =>
    expect(next.port.postMessage).toHaveBeenCalledWith({
      type: 'bound',
      conversationId: replacement.bindingId,
    })
  );
});

it('keeps the floating pane disabled unless voice mode is enabled', async () => {
  mocks.voiceMode = false;
  expect(await register()).toEqual({ enabled: false });
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});

it('disconnects an existing pane and releases capture when voice mode is switched off', async () => {
  await register();
  const { port } = widget();
  await new Promise((resolve) => setTimeout(resolve, 0));
  mocks.voiceMode = false;
  for (const [callback] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
    callback({ config: { newValue: { voiceMode: false } } }, 'local');
  }
  expect(port.disconnect).toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledWith(port);
  expect(await register()).toEqual({ enabled: false });
});
