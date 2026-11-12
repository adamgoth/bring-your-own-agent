import { onGrantChanged } from '../lib/site-grant';
import { connectableOrigin } from '../background/site-connection';
import { isTrustedSubmitShortcut } from './site-gesture';

// Runs on every eligible top-level page, so it stays dormant (no polling, no storage listener,
// no messages) until the page itself calls the BYOA client.
if (connectableOrigin(window.location.href) && window === window.top) {
  let lastGesture = 0;
  let activated = false;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  const active = new Map<string, { port: chrome.runtime.Port; last?: Record<string, unknown> }>();
  const seen = new Set<string>();
  const emit = (value: object) =>
    window.postMessage(
      { source: 'agentboard:extension', version: 1, ...value },
      window.location.origin
    );
  const reply = (id: string, ok: boolean, value?: unknown, error?: string) =>
    emit({ kind: 'response', id, ok, value, error });
  const refresh = async () => {
    try {
      emit({
        kind: 'status',
        value: await chrome.runtime.sendMessage({ type: 'SITE_CONNECTION_STATUS' }),
      });
    } catch {
      clearInterval(refreshTimer);
      emit({ kind: 'status', value: { available: false, configured: false, connected: false } });
      for (const [id, task] of active) {
        emit({
          kind: 'task',
          id,
          event: {
            taskId: task.last?.taskId || '',
            status: 'error',
            detail: 'BYOA disconnected. Review results before retrying.',
            busy: false,
          },
        });
      }
      active.clear();
    }
  };
  document.addEventListener(
    'keydown',
    (event) => {
      if (isTrustedSubmitShortcut(event)) lastGesture = Date.now();
    },
    true
  );
  document.addEventListener(
    'click',
    (event) => {
      if (event.isTrusted) lastGesture = Date.now();
    },
    true
  );
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (
      data?.source !== 'agentboard:page' ||
      data.version !== 1 ||
      typeof data.id !== 'string' ||
      data.id.length > 80
    )
      return;
    activate();
    const { id, method, params = {} } = data;
    if (method === 'cancel') {
      active.get(id)?.port.postMessage({ type: 'cancel' });
      return;
    }
    if (!['status', 'connectionResult'].includes(method) && Date.now() - lastGesture > 1500) {
      if (method === 'request')
        emit({
          kind: 'task',
          id,
          event: {
            taskId: '',
            status: 'error',
            detail: 'Start agent tasks with a button click or Command/Ctrl+Enter.',
            busy: false,
          },
        });
      else
        reply(
          id,
          false,
          undefined,
          'Use a button click or Command/Ctrl+Enter to connect or open BYOA.'
        );
      return;
    }
    if (method === 'request') {
      if (seen.has(id)) return;
      seen.add(id);
      if (seen.size > 200) {
        const oldest = seen.values().next().value;
        if (oldest) seen.delete(oldest);
      }
      try {
        const port = chrome.runtime.connect({ name: 'agentboard-task' });
        const task: { port: chrome.runtime.Port; last?: Record<string, unknown> } = { port };
        active.set(id, task);
        port.onMessage.addListener((message) => {
          if (active.get(id) !== task) return;
          task.last = message;
          emit({ kind: 'task', id, event: message });
          if (!message.busy) {
            active.delete(id);
            port.disconnect();
          }
        });
        port.onDisconnect.addListener(() => {
          if (active.get(id) !== task) return;
          active.delete(id);
          emit({
            kind: 'task',
            id,
            event: {
              taskId: task.last?.taskId || '',
              status: 'error',
              detail: 'Task connection interrupted. Review results before retrying.',
              busy: false,
            },
          });
        });
        port.postMessage({ type: 'start', text: params.prompt, tools: params.tools });
      } catch {
        emit({
          kind: 'task',
          id,
          event: {
            taskId: '',
            status: 'error',
            detail: 'Reload BYOA and the page.',
            busy: false,
          },
        });
      }
      return;
    }
    const methods: Record<string, string> = {
      status: 'SITE_CONNECTION_STATUS',
      connectionResult: 'SITE_CONNECTION_RESULT',
      connect: 'SITE_CONNECT',
      disconnect: 'SITE_DISCONNECT',
      settings: 'SITE_OPEN_SETTINGS',
      chat: 'SITE_VIEW_CHAT',
    };
    if (!methods[method]) {
      reply(id, false, undefined, 'Unknown BYOA method.');
      return;
    }
    void chrome.runtime
      .sendMessage({ type: methods[method], taskId: params.taskId, requestId: params.requestId })
      .then((result) => {
        if (result?.success === false) {
          reply(id, false, undefined, result.error || 'Open BYOA from the toolbar.');
          return;
        }
        reply(id, true, result);
        if (['status', 'disconnect'].includes(method)) emit({ kind: 'status', value: result });
        if (method === 'connectionResult' && result.connection)
          emit({ kind: 'status', value: result.connection });
      })
      .catch(() => {
        reply(id, false, undefined, 'Reload BYOA and the page.');
        void refresh();
      });
  });
  function activate() {
    if (activated) return;
    activated = true;
    refreshTimer = setInterval(() => {
      void refresh();
      for (const task of active.values()) {
        try {
          task.port.postMessage({ type: 'heartbeat' });
        } catch {
          void refresh();
        }
      }
    }, 15000);
    window.addEventListener('focus', () => void refresh());
    onGrantChanged(
      (origin) => {
        if (origin === window.location.origin) void refresh();
      },
      { signalOnly: true }
    );
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.config) void refresh();
    });
    void refresh();
  }
}
