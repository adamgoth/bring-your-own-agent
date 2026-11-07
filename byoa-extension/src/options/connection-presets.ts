import type { ApiProtocol } from '../lib/ai/protocol';
import { normalizeProviderEndpoint, PROVIDER_ENDPOINTS } from '../lib/ai/provider-endpoints';

export const CONNECTION_PRESETS = {
  openai: { label: 'OpenAI', endpoint: PROVIDER_ENDPOINTS.openai, apiProtocol: 'openai-responses' },
  openrouter: {
    label: 'OpenRouter',
    endpoint: PROVIDER_ENDPOINTS.openrouter,
    apiProtocol: 'openai-responses',
  },
  anthropic: {
    label: 'Anthropic',
    endpoint: PROVIDER_ENDPOINTS.anthropic,
    apiProtocol: 'anthropic-messages',
  },
  google: {
    label: 'Google Gemini',
    endpoint: PROVIDER_ENDPOINTS.google,
    apiProtocol: 'google-generative-ai',
  },
} as const satisfies Record<string, { label: string; endpoint: string; apiProtocol: ApiProtocol }>;

export type ConnectionPreset = keyof typeof CONNECTION_PRESETS;

export function isConnectionPreset(value: string): value is ConnectionPreset {
  return Object.hasOwn(CONNECTION_PRESETS, value);
}

/** Infer only exact compatible presets; never change saved routing to match a provider name. */
export function inferConnectionPreset(
  endpoint: string,
  protocol: ApiProtocol
): ConnectionPreset | 'custom' {
  return (
    (Object.entries(CONNECTION_PRESETS).find(
      ([id, preset]) =>
        (preset.apiProtocol === protocol ||
          (id === 'openrouter' && protocol === 'openai-chat-completions')) &&
        (normalizeProviderEndpoint(endpoint) === preset.endpoint ||
          (!endpoint && id !== 'openrouter'))
    )?.[0] as ConnectionPreset | undefined) ?? 'custom'
  );
}
