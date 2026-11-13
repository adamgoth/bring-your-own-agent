import { createTransport } from '../../../packages/browser/transport';
import {
  ProviderError,
  type AgentProvider,
  type ProviderEvent,
} from '../../../packages/browser/provider';
import type { AgentTask } from '../../../packages/browser/types';

// MAIN world has no secrets or authority. The isolated bridge and worker enforce all permissions.
if (window === window.top) {
  let detail: object | undefined;
  window.addEventListener('agent:requestProvider', () => {
    if (!detail) {
      const transport = createTransport(window);
      const listeners = new Map<ProviderEvent, Set<(value: unknown) => void>>();
      const tasks = new Map<string, AgentTask>();
      const emit = (name: ProviderEvent, value: unknown) => {
        for (const listener of listeners.get(name) || []) {
          try {
            listener(value);
          } catch {
            /* One consumer must not break delivery. */
          }
        }
      };
      transport.subscribe((value) => emit('connectionChanged', value));
      const provider: AgentProvider = Object.freeze({
        async request({ method, params }: { method: string; params?: unknown }) {
          const p = (params || {}) as Record<string, unknown>;
          switch (method) {
            case 'agent_configureVoice':
              return transport.configureVoice({
                enabled: p.enabled as boolean,
                tools: p.tools as string[],
                instructions: p.instructions as string | undefined,
              });
            case 'agent_status':
              return transport.getStatus();
            case 'agent_connect':
              return transport.connect();
            case 'agent_disconnect':
              return transport.disconnect();
            case 'agent_openSettings':
              return transport.openSettings();
            case 'agent_openChat':
              return transport.openChat(p.taskId as string | undefined);
            case 'agent_getTask':
              return transport.getTask(p.taskId as string);
            case 'agent_listTasks':
              return transport.listTasks();
            case 'agent_cancelTask':
              tasks.get(p.taskId as string)?.cancel();
              return;
            case 'agent_requestTask': {
              // Forward only the allowed task fields; page-supplied authority is never relayed.
              const task = await transport.request({
                prompt: p.prompt as string,
                tools: p.tools as string[],
                timeoutMs: p.timeoutMs as number | undefined,
              });
              // Legacy preflight failures have no worker record. Give each one a unique
              // provider-local ID so concurrent failures cannot consume each other's events.
              const taskId = task.id || `preflight:${globalThis.crypto.randomUUID()}`;
              tasks.set(taskId, task);
              void (async () => {
                try {
                  for await (const event of task.events)
                    emit('task', task.id ? event : { ...event, taskId });
                } finally {
                  tasks.delete(taskId);
                }
              })();
              return { taskId };
            }
            default:
              throw new ProviderError(4200, 'Unsupported agent method.');
          }
        },
        on(event: ProviderEvent, listener: (value: unknown) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)?.add(listener);
        },
        removeListener(event: ProviderEvent, listener: (value: unknown) => void) {
          listeners.get(event)?.delete(listener);
        },
      });
      detail = Object.freeze({
        info: Object.freeze({
          uuid: globalThis.crypto.randomUUID(),
          name: 'BYOA',
          rdns: 'dev.byoa.extension',
          icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAD+0lEQVR4nOyZS2gTURSGz5n0aaWaNpO+gohvEcEHPsGFCL426kIXFVTEhS5cuBNBBR+4FFwpKAVRcaddqFDdCb7RggpthbaL2jbTJm1imrQxucczaRUXuZOZyY2xkA+SdOacc+/97/PMVINZjgaznJKAYlMSUGxmvYCyXA4+X9M6Qtxq/o1Er0ZHhz5CAXFaH1oZ6xtarmqA5/6+JwRdCY18Pw8FwE19KC8ssInn15tsNkqnN3DPfMhmG9u/cD5UV51BhM3suWammk4iLisxed37uH9cZX3SNaAJ2CizIXq2ZLsfObxsD1RXfuXGX+DLnezpn/7Azsw9tmV8FNWXiZMZCKHeiS3SumIXkfYUEZtB2hBsNn2yiXBa32+U7ELjrQu8AqDNrr8QeDtyMFAHClAigKj6KC+mJrv+5kiIspojoICc26gdphds4WOyoWYEAB03xk1MNpQIQIIqcIibmGyoSSWQOsEpbmKyoCoXctOY/0cACbzJ3+MOIsanY/JHiQDvw65+EnTcrj9XesyMAQUoS6e9D3seIYq9RDQo8zFtpk/tg+52UITS54F593ueQWJqFSdul/iyg5tsTH+gI3OPbRkfhVgcZCIm10eNsqiZbPMiOMYsU5Yc0w9ZlDyZAwzKbHyMrgXVIK6zMA7LLBYCSC6AwBRg+TDkEOQy10irQ3IuIBkXn2Q2zmPK6+oaV4IivP7AarNMmZ1+Jt7LbFIBsdjwCP98kQaWeU6DIjwI8rKIOsPhcFRmttyFeNt7LrNxSnxS15u2QZ74fC3beS6ekNl5LT63ircUgGQdDJp2l7/zSMqa54CG96w8BAj3AkZGBp7xKPTIPXChzx+4A+6o8jVgG8996SMobyRdYWPQvQATHoUzlnaEVp+/pct8nwM2MX11f+AzAh6y8uPOy7nOcgrgUXjKXdFh5cPrYTlPp3f1estlviy3cK3QG5qvmb68cS6xKpN7/0nIGHwBObC1l+u63ghaxWtzythwn+TK+/i3jydwD2ro4etFfL2Ye3wF2IGgNw7JrROGEczlavswmuf3L6rA8nccUg8FhYwkpDZHgsE+O962k7mIYfSmALdzUjYEBYLn/EAKUjvsNt7EcTowd26jXlVT9oQDN4BCCOB9MgG7o9GBsJM4DzgkmYzF4xPRtpo5tSF+Y7aJhVRDXlAIBJ4dNQZOTU1FJ8AhjgXMIOLx6NvKCs8txHI+yHA9b6eOyuIeT/KcuSFSiQOhUPClWSa4QElGWVsbqKusFPsItX0shF/qykaF4kTIDzfUnkrG2iORyBjkicqU+A+6HliahvRiTdNWosB0GtPdHvL08pnyDRRTEAH/ktI/+YpNSUCxKQkoNr8AAAD//0JOkEEAAAAGSURBVAMAmFJ1SIvhHOoAAAAASUVORK5CYII=',
        }),
        provider,
      });
    }
    window.dispatchEvent(new CustomEvent('agent:announceProvider', { detail }));
  });
}
