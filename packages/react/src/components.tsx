"use client";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { AgentRequest } from "@byoagent/browser";
import {
  agentLabels,
  connectionView,
  containTab,
  defaultSetupUrl,
  dockMark,
  iconPaths,
  type AgentLabels,
  type IconName,
} from "@byoagent/browser/ui";
import { useAgentSession, useAgentTask, useConnection } from "./context.js";

const defaults = agentLabels;
export type { AgentLabels };
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Inline stroke icons keep the package dependency-free and inherit currentColor. */
function Icon({ name, className = "byoa-icon" }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {iconPaths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
function DockMark({ connected }: { connected: boolean }) {
  return (
    <svg className="byoa-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={dockMark.cradle} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <circle
        {...dockMark.dot}
        fill={connected ? dockMark.connectedColor : "currentColor"}
        opacity={connected ? 1 : 0.45}
      />
    </svg>
  );
}

type IndicatorProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  labels?: AgentLabels;
};
export const AgentIndicator = forwardRef<HTMLButtonElement, IndicatorProps>(
  function AgentIndicator(
    { labels, className = "", children, ...props }: IndicatorProps,
    ref,
  ) {
    const text = { ...defaults, ...labels };
    const { connection, detecting } = useConnection();
    const { busy } = useAgentTask();
    const label = connection.connected
      ? `${connection.agentName || text.connected}${busy ? ` · ${text.working}` : ""}`
      : text.connect;
    return (
      <button
        type="button"
        ref={ref}
        aria-label={
          connection.connected ? `${label}, ${text.connectedState}` : label
        }
        {...props}
        className={`byoa-indicator ${className}`}
        data-state={
          connection.connected
            ? "connected"
            : detecting
              ? "detecting"
              : "disconnected"
        }
        data-busy={busy || undefined}
      >
        {children ?? (
          <>
            <span className="byoa-dot" aria-hidden="true" />
            <span className="byoa-agent-name">{label}</span>
          </>
        )}
      </button>
    );
  },
);

type SurfaceProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portalContainer?: HTMLElement | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  id?: string;
  labels?: AgentLabels;
};
function Surface({
  open,
  onOpenChange,
  portalContainer,
  returnFocusRef,
  className = "",
  id,
  title,
  closeLabel,
  children,
}: SurfaceProps & { title: string; closeLabel: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const change = useRef(onOpenChange);
  change.current = onOpenChange;
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-byoa-autofocus]")?.focus();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
      else returnFocusRef?.current?.focus();
    };
  }, [open, portalContainer, returnFocusRef]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={ref}
      id={id}
      className={`byoa-dialog ${className}`}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        containTab(event.nativeEvent, event.currentTarget);
      }}
      onClose={(event) => {
        // Ignore queued cleanup events from StrictMode or a replaced portal.
        if (event.currentTarget === ref.current && !event.currentTarget.open)
          change.current(false);
      }}
      onCancel={(event) => {
        event.preventDefault();
        change.current(false);
      }}
    >
      <header className="byoa-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="byoa-btn byoa-icon-button"
          aria-label={closeLabel}
          onClick={() => onOpenChange(false)}
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>,
    portalContainer ?? document.body,
  );
}

export function AgentConnectionDialog({
  labels,
  ...props
}: SurfaceProps & { setupUrl?: string }) {
  const text = { ...defaults, ...labels };
  const {
    setupUrl = defaultSetupUrl,
    ...surface
  } = props;
  const {
    connection,
    detecting,
    connecting,
    connect,
    disconnect,
    refresh,
    error,
  } = useConnection();
  const session = useAgentSession();
  const { task } = useAgentTask();
  const [localError, setLocalError] = useState("");
  const act = (operation: () => Promise<unknown>) => {
    setLocalError("");
    // Invoke immediately inside the click, preserving the trusted gesture.
    void operation().catch((error) => setLocalError(message(error)));
  };
  const { state, title, detail } = connectionView(
    { connection, detecting, connecting },
    text,
  );
  const alert = localError || error || connection.error;
  const row = (icon: IconName, label: string, trail: IconName | null, onClick: () => void) => (
    <button type="button" className="byoa-btn byoa-row" onClick={onClick}>
      <Icon name={icon} />
      <span className="byoa-row-label">{label}</span>
      {trail && <Icon name={trail} className="byoa-icon byoa-row-trail" />}
    </button>
  );
  return (
    <Surface
      {...surface}
      className={`byoa-connection ${surface.className ?? ""}`}
      title={text.connectionTitle}
      closeLabel={text.close}
    >
      <div className="byoa-status" data-state={state} role="status">
        <span className="byoa-status-dot" aria-hidden="true" />
        <span className="byoa-status-text">
          <strong className="byoa-status-name">{title}</strong>
          {detail && <span className="byoa-status-detail">{detail}</span>}
        </span>
        {state === "connected" && (
          <button
            type="button"
            className="byoa-btn byoa-text-button"
            aria-label={text.changeProfile}
            onClick={() => act(connect)}
          >
            {text.change}
          </button>
        )}
      </div>
      {state === "unavailable" && (
        <a
          className="byoa-btn byoa-primary"
          href={setupUrl}
          target="_blank"
          rel="noreferrer"
          data-byoa-autofocus
        >
          {text.setupLink}
          <Icon name="external" />
        </a>
      )}
      {(state === "disconnected" || state === "waiting") && (
        <button
          type="button"
          className="byoa-btn byoa-primary"
          data-byoa-autofocus
          disabled={connecting}
          aria-busy={connecting || undefined}
          onClick={() => act(connect)}
        >
          {connecting && <span className="byoa-spinner" aria-hidden="true" />}
          {connecting ? text.waitingAction : text.connect}
        </button>
      )}
      {state !== "detecting" && (
        <div className="byoa-menu">
          {state === "connected" &&
            row("sidebar", text.sidebar, "chevron", () =>
              act(() => session.client.openChat(task?.taskId)),
            )}
          {state === "unavailable"
            ? row("refresh", text.refresh, null, () => act(refresh))
            : row("settings", text.settings, "external", () =>
                act(session.client.openSettings),
              )}
        </div>
      )}
      {alert && (
        <p className="byoa-error" role="alert">
          {alert}
        </p>
      )}
      <footer className="byoa-dialog-footer">
        <p className="byoa-privacy">
          <Icon name="lock" />
          <span>{text.privacy}</span>
        </p>
        <div className="byoa-footer-row">
          {state === "connected" && (
            <button
              type="button"
              className="byoa-btn byoa-danger-button"
              onClick={() => act(disconnect)}
            >
              <Icon name="power" />
              {text.disconnect}
            </button>
          )}
          <span className="byoa-attribution">
            <DockMark connected={state === "connected"} />
            {text.managedBy}
          </span>
        </div>
      </footer>
    </Surface>
  );
}

/** Retry is supplied by the app so it can revalidate current context and existing results. */
export function AgentTaskStatus({
  className = "",
  labels,
  onRetry,
}: {
  className?: string;
  labels?: AgentLabels;
  onRetry?: () => void | Promise<unknown>;
}) {
  const text = { ...defaults, ...labels };
  const { task, pending, busy, cancel, error } = useAgentTask();
  const session = useAgentSession();
  const { connection } = useConnection();
  const [localError, setLocalError] = useState("");
  const act = (operation: () => void | Promise<unknown>) => {
    setLocalError("");
    try {
      void Promise.resolve(operation()).catch((error) =>
        setLocalError(message(error)),
      );
    } catch (error) {
      setLocalError(message(error));
    }
  };
  return (
    <div
      className={`byoa-task-status ${className}`}
      data-state={task?.status ?? (pending ? "queued" : "idle")}
    >
      <p role="status" aria-live="polite" aria-atomic="true">
        {task?.detail || (pending ? text.starting : "")}
      </p>
      {busy && (
        <button type="button" className="byoa-btn byoa-secondary" disabled={!pending} onClick={cancel}>
          {text.cancel}
        </button>
      )}
      {task && !busy && (
        <button
          type="button"
          className="byoa-btn byoa-secondary"
          onClick={() => act(() => session.client.openChat(task.taskId))}
        >
          <Icon name="sidebar" />
          {text.chat}
        </button>
      )}
      {!busy &&
        task &&
        (task.code === "timeout" || task.code === "interrupted") &&
        onRetry && (
          <>
            <p>{text.review}</p>
            <button
              type="button"
              className="byoa-btn byoa-secondary"
              disabled={!connection.connected}
              onClick={() => act(onRetry)}
            >
              {text.retry}
            </button>
          </>
        )}
      {(localError || error) && (
        <p className="byoa-error" role="alert">
          {localError || error}
        </p>
      )}
    </div>
  );
}

/** A compact request dialog. Closing it does not cancel work; cancellation is explicit. */
export function AgentPromptPopover({
  tools,
  getRequest,
  ready = true,
  labels,
  ...surface
}: SurfaceProps & {
  tools: readonly string[];
  ready?: boolean;
  getRequest?: (prompt: string) => AgentRequest;
}) {
  const text = { ...defaults, ...labels };
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const { connection } = useConnection();
  const { run, busy, clearError } = useAgentTask();
  const promptId = useId();
  return (
    <Surface {...surface} title={text.request} closeLabel={text.close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (
            busy ||
            !connection.connected ||
            !ready ||
            !tools.length ||
            !prompt.trim()
          )
            return;
          setError("");
          clearError();
          try {
            void run(
              getRequest
                ? getRequest(prompt.trim())
                : { prompt: prompt.trim(), tools },
            ).catch(() => {
              /* The shared task status owns request errors. */
            });
          } catch (error) {
            setError(message(error));
          }
        }}
      >
        <label htmlFor={promptId}>{text.prompt}</label>
        <textarea
          id={promptId}
          data-byoa-autofocus
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <button
          className="byoa-btn byoa-primary"
          type="submit"
          disabled={
            busy ||
            !connection.connected ||
            !ready ||
            !tools.length ||
            !prompt.trim()
          }
        >
          {text.send}
        </button>
      </form>
      {error && (
        <p className="byoa-error" role="alert">
          {error}
        </p>
      )}
      <AgentTaskStatus labels={labels} />
    </Surface>
  );
}
