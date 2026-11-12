import { createFloatingVoice } from './floating-voice';
import { onGrantChanged } from '../lib/site-grant';
import { connectableOrigin } from '../background/site-connection';
import { isTrustedSubmitShortcut } from './site-gesture';

// Runs on every eligible top-level page, so it stays dormant (no polling, no storage listener,
// no messages) until the page itself calls the BYOA client.
if (connectableOrigin(window.location.href) && window === window.top) {
  const floatingVoice = createFloatingVoice();
  let voiceOptions: unknown;
  let voiceSync = 0;
  const syncVoice = async () => {
    if (!voiceOptions) return;
    const sync = ++voiceSync;
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'SITE_VOICE_SYNC',
        options: voiceOptions,
      });
      if (sync === voiceSync) floatingVoice(result?.enabled === true, result?.bindingId);
    } catch {
      if (sync === voiceSync) floatingVoice(false);
    }
  };
  let lastGesture = 0;
  let activated = false;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  const active = new Map<
    string,
    { port: chrome.runtime.Port; last?: Record<string, unknown>; cancelled?: boolean }
  >();
  const seen = new Set<string>();
  const emit = (value: object) =>
    window.postMessage(
      { source: 'agentboard:extension', version: 1, ...value },
      window.location.origin
    );
  const reply = (id: string, ok: boolean, value?: unknown, error?: string, code?: number) =>
    emit({ kind: 'response', id, ok, value, error, code });
  const refresh = async () => {
    try {
      await syncVoice();
      emit({
        kind: 'status',
        value: await chrome.runtime.sendMessage({ type: 'SITE_CONNECTION_STATUS' }),
      });
      // Chrome can retain a stale port across worker termination without onDisconnect.
      // Reconcile acknowledged tasks against durable state on the existing heartbeat cadence.
      for (const [id, task] of active) {
        if (typeof task.last?.taskId !== 'string') continue;
        try {
          const event = await chrome.runtime.sendMessage({
            type: 'SITE_TASK',
            taskId: task.last.taskId,
          });
          if (active.get(id) !== task || !event?.taskId || event.busy) continue;
          task.last = event;
          active.delete(id);
          emit({ kind: 'task', id, event });
          task.port.disconnect();
        } catch {
          /* Port recovery handles transient failures. */
        }
      }
    } catch {
      clearInterval(refreshTimer);
      emit({ kind: 'status', value: { available: false, configured: false, connected: false } });
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
    if (method === 'voice') {
      voiceOptions = params;
      void syncVoice().then(() => reply(id, true));
      return;
    }
    if (method === 'cancel') {
      const task = active.get(id);
      if (task) {
        task.cancelled = true;
        try {
          task.port.postMessage({ type: 'cancel' });
        } catch {
          /* Send on attach. */
        }
      }
      return;
    }
    if (
      !['status', 'connectionResult', 'task', 'tasks'].includes(method) &&
      Date.now() - lastGesture > 1500
    ) {
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
          'Use a button click or Command/Ctrl+Enter to connect or open BYOA.',
          4100
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
      const task: {
        port: chrome.runtime.Port;
        last?: Record<string, unknown>;
        cancelled?: boolean;
      } = {
        port: undefined as unknown as chrome.runtime.Port,
      };
      const deliver = (message: Record<string, unknown>) => {
        if (active.get(id) !== task) return;
        if (
          typeof message.seq === 'number' &&
          typeof task.last?.seq === 'number' &&
          message.seq <= task.last.seq
        )
          return;
        task.last = message;
        emit({ kind: 'task', id, event: message });
        if (!message.busy) {
          active.delete(id);
          task.port?.disconnect();
        }
      };
      const interrupted = () =>
        deliver({
          taskId: task.last?.taskId || '',
          status: 'error',
          code: 'interrupted',
          detail: 'Task connection interrupted. Review results before retrying.',
          busy: false,
        });
      const recover = async () => {
        const deadline = Date.now() + 10000;
        while (active.get(id) === task) {
          try {
            const event = await chrome.runtime.sendMessage({
              type: 'SITE_TASK',
              taskId: task.last?.taskId,
            });
            if (event?.taskId && !event.busy) {
              deliver(event);
              return;
            }
            // A live record must not be presented as terminal while its grace timer still runs.
            if (event?.busy && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 500));
              continue;
            }
          } catch {
            /* Extension unavailable. */
          }
          interrupted();
          return;
        }
      };
      const open = (attempt: number) => {
        if (active.get(id) !== task) return;
        let acknowledged = attempt === 0;
        let attachTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          const port = chrome.runtime.connect({ name: 'agentboard-task' });
          task.port = port;
          port.onMessage.addListener((message) => {
            if (active.get(id) !== task || task.port !== port) return;
            if (message.type === 'not-running') {
              clearTimeout(attachTimer);
              port.disconnect();
              return;
            }
            acknowledged = true;
            clearTimeout(attachTimer);
            if (message.type !== 'attached') deliver(message);
            if (task.cancelled && active.get(id) === task) port.postMessage({ type: 'cancel' });
          });
          port.onDisconnect.addListener(() => {
            clearTimeout(attachTimer);
            if (active.get(id) !== task || task.port !== port) return;
            const nextAttempt = acknowledged ? 1 : attempt + 1;
            if (!task.last?.taskId || nextAttempt > 3) {
              void recover();
              return;
            }
            setTimeout(() => open(nextAttempt), nextAttempt * 200);
          });
          if (attempt === 0)
            port.postMessage({
              type: 'start',
              text: params.prompt,
              tools: params.tools,
              timeoutMs: params.timeoutMs,
            });
          else {
            port.postMessage({
              type: 'attach',
              taskId: task.last?.taskId,
              afterSeq: task.last?.seq ?? 0,
            });
            attachTimer = setTimeout(() => port.disconnect(), 1500);
          }
        } catch {
          void recover();
        }
      };
      active.set(id, task);
      open(0);
      return;
    }
    const methods: Record<string, string> = {
      status: 'SITE_CONNECTION_STATUS',
      task: 'SITE_TASK',
      tasks: 'SITE_TASKS',
      connectionResult: 'SITE_CONNECTION_RESULT',
      connect: 'SITE_CONNECT',
      disconnect: 'SITE_DISCONNECT',
      settings: 'SITE_OPEN_SETTINGS',
      chat: 'SITE_VIEW_CHAT',
    };
    if (!methods[method]) {
      reply(id, false, undefined, 'Unknown BYOA method.', 4200);
      return;
    }
    void chrome.runtime
      .sendMessage({ type: methods[method], taskId: params.taskId, requestId: params.requestId })
      .then((result) => {
        if (result?.success === false) {
          reply(
            id,
            false,
            undefined,
            result.error || 'Open BYOA from the toolbar.',
            method === 'connectionResult' ? 4001 : 4100
          );
          return;
        }
        reply(id, true, result);
        if (['status', 'disconnect'].includes(method)) emit({ kind: 'status', value: result });
        if (method === 'connectionResult' && result.connection)
          emit({ kind: 'status', value: result.connection });
      })
      .catch(() => {
        reply(id, false, undefined, 'Reload BYOA and the page.', 4900);
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
      (origin, _grant, incognito) => {
        if (origin === window.location.origin && incognito === chrome.extension.inIncognitoContext)
          void refresh();
      },
      { signalOnly: true }
    );
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.config) void refresh();
    });
    void refresh();
  }
}
