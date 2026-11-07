/** Base URLs expected by the installed provider SDK adapters. */
export const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
} as const;

export function normalizeProviderEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}
