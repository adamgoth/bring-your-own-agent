/** Fixed public feedback: never includes raw provider response data. */
export class LocalEndpointAccessError extends Error {
  constructor() {
    super(
      'The local AI server refused access (403). If you use Ollama, open Settings → edit this agent → Ollama setup, allow this extension in OLLAMA_ORIGINS, then fully quit and restart Ollama. Review any completed tool actions before retrying.'
    );
    this.name = 'LocalEndpointAccessError';
  }
}

export function isLocalEndpoint(endpoint?: string): boolean {
  if (!endpoint) return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}
