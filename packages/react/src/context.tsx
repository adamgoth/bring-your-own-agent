"use client";
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { byoa, createAgentSession, type AgentSession } from "@byoagent/browser";

const defaultSession = createAgentSession(byoa);
const Context = createContext<AgentSession | null>(null);
/** The session outlives individual views. Unmount only unsubscribes; it never disposes a borrowed client. */
export function AgentProvider({
  session = defaultSession,
  children,
}: {
  session?: AgentSession;
  children: ReactNode;
}) {
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useAgentSession() {
  const session = useContext(Context);
  if (!session) throw new Error("Wrap agent components in AgentProvider.");
  return session;
}
export function useAgentSnapshot() {
  const session = useAgentSession();
  return useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getServerSnapshot,
  );
}
export function useConnection() {
  const session = useAgentSession();
  const { connection, detecting, connecting, connectionError } =
    useAgentSnapshot();
  return {
    connection,
    detecting,
    connecting,
    error: connectionError,
    connect: session.connect,
    disconnect: session.disconnect,
    refresh: session.refresh,
    clearError: session.clearConnectionError,
  };
}
export function useAgentTask() {
  const session = useAgentSession();
  const { task, pending, taskError } = useAgentSnapshot();
  return {
    task,
    pending,
    busy: pending || !!task?.busy,
    error: taskError,
    clearError: session.clearTaskError,
    run: session.run,
    cancel: session.cancel,
  };
}
