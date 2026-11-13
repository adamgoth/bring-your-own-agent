/** Explicit page opt-in; this declares tool names, never grants or tool definitions. */
export interface SiteVoiceOptions {
  enabled: boolean;
  tools: string[];
  instructions?: string;
}
export function parseSiteVoice(value: unknown): SiteVoiceOptions {
  const input = value as Partial<SiteVoiceOptions> | null;
  if (!input || typeof input.enabled !== 'boolean')
    throw new Error('Voice opt-in requires enabled.');
  if (!input.enabled) return { enabled: false, tools: [] };
  if (
    !Array.isArray(input.tools) ||
    input.tools.length < 1 ||
    input.tools.length > 32 ||
    input.tools.some((name) => typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(name))
  )
    throw new Error('Voice requires 1–32 registered page-tool names.');
  if (
    input.instructions !== undefined &&
    (typeof input.instructions !== 'string' || input.instructions.length > 2000)
  )
    throw new Error('Voice instructions must be at most 2,000 characters.');
  return {
    enabled: true,
    tools: [...new Set(input.tools)],
    instructions: input.instructions ?? '',
  };
}
