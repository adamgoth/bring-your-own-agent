import { useEffect, useRef, useState } from 'react';
import type { Tool } from './registry';

type ModelContext = {
  registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void>;
};

/**
 * Register tools one by one with `context.registerTool(tool, { signal })`. Aborting the signal
 * removes them. `getTools` is read at call time so tools always run the latest list.
 * Resolves true once every tool is registered and the signal is still live.
 */
export async function registerTools(context: ModelContext, getTools: () => Tool[], controller: AbortController): Promise<boolean> {
  const safe = (name: string) => async (input: Record<string, unknown>) => {
    try {
      const tool = getTools().find((t) => t.name === name);
      if (!tool) return { error: `The tool ${name} is no longer available.` };
      return await tool.execute(input ?? {});
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'The action could not be completed.' };
    }
  };
  try {
    for (const tool of getTools()) {
      if (controller.signal.aborted) return false;
      await context.registerTool({ ...tool, execute: safe(tool.name) }, { signal: controller.signal });
    }
    return !controller.signal.aborted;
  } catch (error) {
    if (!controller.signal.aborted) {
      controller.abort();
      console.warn('Piano Tutor WebMCP registration failed:', error);
    }
    return false;
  }
}

// Feature-detected `document.modelContext`, stable registrations, latest-ref callbacks,
// AbortController cleanup, errors returned as { error }. Returns whether the tools are registered right now.
export function useWebMcpTools(tools: Tool[]): boolean {
  const latest = useRef(tools);
  const [registered, setRegistered] = useState(false);
  useEffect(() => {
    latest.current = tools;
  });
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context) return;
    const controller = new AbortController();
    // Abort removes registrations on unmount, hot reload and Strict Mode cleanup.
    void registerTools(context, () => latest.current, controller).then((ok) => {
      if (!controller.signal.aborted) setRegistered(ok);
    });
    return () => {
      controller.abort();
      setRegistered(false);
    };
  }, []);
  return registered;
}
