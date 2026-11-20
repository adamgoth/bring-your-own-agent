import { normalizeProviderEndpoint, PROVIDER_ENDPOINTS } from './provider-endpoints';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { JSONValue } from 'ai';
import type { LanguageModelV2 } from '@ai-sdk/provider';
import type { AgentConfig } from '../storage/config';
import { withTextOnlyToolResults } from './tool-result-media';

// AI SDK warnings bypass AgentBoard's logger and may interpolate model or tool values.
globalThis.AI_SDK_LOG_WARNINGS = false;

export type ProviderOptions = Record<string, Record<string, JSONValue>>;

export interface ModelRuntime {
  model: LanguageModelV2;
  providerOptions?: ProviderOptions;
}

type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const PROVIDER_AUTH_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key'] as const;

async function fetchWithoutProviderAuthentication(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  for (const header of PROVIDER_AUTH_HEADERS) headers.delete(header);
  return globalThis.fetch(input, { ...init, headers });
}

function keylessEndpointFetch(agent: AgentConfig): FetchFunction | undefined {
  return agent.endpoint && !agent.apiKey ? fetchWithoutProviderAuthentication : undefined;
}

/** Per-request routing context. Never derived from prompts, pages, or user identity. */
export interface ModelRuntimeOptions {
  /** Stable for one conversation or task; ignored unless the agent targets OpenRouter. */
  sessionId?: string;
}

function openAICompatibleFetch(
  agent: AgentConfig,
  options: ModelRuntimeOptions
): FetchFunction | undefined {
  const keylessFetch = keylessEndpointFetch(agent);
  return isOpenRouterAgent(agent) && isRoutingSessionId(options.sessionId)
    ? withOpenRouterSession(options.sessionId, keylessFetch)
    : keylessFetch;
}

/** Opaque, bounded routing keys only; OpenRouter accepts at most 256 characters. */
const ROUTING_SESSION_ID = /^[A-Za-z0-9_-]{1,256}$/;

export function isRoutingSessionId(value: unknown): value is string {
  return typeof value === 'string' && ROUTING_SESSION_ID.test(value);
}

export function createRoutingSessionId(): string {
  return globalThis.crypto.randomUUID();
}

/** Only the exact OpenRouter endpoint gets OpenRouter request fields; compatible proxies do not. */
export function isOpenRouterAgent(agent: AgentConfig): boolean {
  return (
    (agent.apiProtocol === 'openai-responses' || agent.apiProtocol === 'openai-chat-completions') &&
    !!agent.endpoint &&
    normalizeProviderEndpoint(agent.endpoint) === PROVIDER_ENDPOINTS.openrouter
  );
}

const OPENROUTER_ORIGIN = new URL(PROVIDER_ENDPOINTS.openrouter).origin;

/**
 * OpenRouter app attribution: requests show up as "BYOA" in the person's activity log and in
 * OpenRouter's app analytics. `HTTP-Referer` is required for attribution; the title alone is
 * ignored. Both are fixed product constants, never the page or the person.
 */
export const OPENROUTER_APP_HEADERS: Readonly<Record<string, string>> = {
  'HTTP-Referer': 'https://github.com/adamgoth/bring-your-own-agent',
  'X-OpenRouter-Title': 'BYOA',
};

function openRouterAppHeaders(agent: AgentConfig): { headers?: Record<string, string> } {
  return isOpenRouterAgent(agent) ? { headers: { ...OPENROUTER_APP_HEADERS } } : {};
}

/**
 * Add OpenRouter's top-level `session_id` to every JSON request, so each step of a tool loop and
 * each follow-up turn shares one sticky-routing key. This is a routing hint, not a provider pin:
 * OpenRouter still falls back when the sticky provider is unavailable, and cache hits are not
 * guaranteed. The body field is used rather than `x-session-id` because the body value wins and
 * needs no extra CORS-visible header.
 */
function withOpenRouterSession(sessionId: string, base?: FetchFunction): FetchFunction {
  return async (input, init) => {
    const send = base ?? globalThis.fetch;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (typeof init?.body !== 'string' || new URL(url).origin !== OPENROUTER_ORIGIN) {
      return send(input, init);
    }
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      return send(input, init);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(input, init);
    return send(input, { ...init, body: JSON.stringify({ ...body, session_id: sessionId }) });
  };
}

function buildOpenAIResponsesOptions(agent: AgentConfig): ProviderOptions {
  const options: Record<string, JSONValue> = { store: false };
  const reasoning = agent.reasoning?.enabled ? agent.reasoning.openai : undefined;

  if (reasoning) {
    options.reasoningEffort = reasoning.reasoningEffort;
    if (reasoning.reasoningSummary) {
      options.reasoningSummary = reasoning.reasoningSummary;
    }
  }

  return { openai: options };
}

function buildOpenAIChatOptions(agent: AgentConfig): ProviderOptions | undefined {
  const reasoning = agent.reasoning?.enabled ? agent.reasoning.openai : undefined;
  if (!reasoning) return undefined;

  return {
    openai: {
      reasoningEffort: reasoning.reasoningEffort,
    },
  };
}

function buildAnthropicOptions(agent: AgentConfig): ProviderOptions | undefined {
  const reasoning = agent.reasoning?.enabled ? agent.reasoning.anthropic : undefined;
  if (!reasoning) return undefined;

  return {
    anthropic: {
      thinking: {
        type: 'enabled',
        budgetTokens: reasoning.thinkingBudgetTokens || 12000,
      },
    },
  };
}

function buildGoogleOptions(agent: AgentConfig): ProviderOptions | undefined {
  const reasoning = agent.reasoning?.enabled ? agent.reasoning.google : undefined;
  if (!reasoning) return undefined;

  return {
    google: {
      thinkingConfig: {
        thinkingBudget: reasoning.thinkingBudget ?? 8192,
        includeThoughts: reasoning.includeThoughts ?? true,
      },
    },
  };
}

/**
 * Construct the SDK model and protocol-owned request options without issuing a
 * request. The exhaustive switch is the only transport-selection authority.
 */
export function createModelRuntime(
  agent: AgentConfig,
  options: ModelRuntimeOptions = {}
): ModelRuntime {
  switch (agent.apiProtocol) {
    case 'openai-responses': {
      const fetch = openAICompatibleFetch(agent, options);
      const openai = createOpenAI({
        apiKey: agent.apiKey || 'no-key-provided',
        baseURL: agent.endpoint,
        ...openRouterAppHeaders(agent),
        ...(fetch && { fetch }),
      });
      return {
        model: openai.responses(agent.model),
        providerOptions: buildOpenAIResponsesOptions(agent),
      };
    }

    case 'openai-chat-completions': {
      const fetch = openAICompatibleFetch(agent, options);
      const openai = createOpenAI({
        apiKey: agent.apiKey || 'no-key-provided',
        baseURL: agent.endpoint,
        ...openRouterAppHeaders(agent),
        ...(fetch && { fetch }),
      });
      return {
        // The Chat adapter serializes rich tool outputs as JSON. Strip typed media at the model
        // boundary so tools can remain provider-neutral without leaking base64 into prompt text.
        model: withTextOnlyToolResults(openai.chat(agent.model)),
        providerOptions: buildOpenAIChatOptions(agent),
      };
    }

    case 'anthropic-messages': {
      const keylessFetch = keylessEndpointFetch(agent);
      const anthropicConfig: Parameters<typeof createAnthropic>[0] = {
        apiKey: agent.apiKey || 'no-key-provided',
        baseURL: agent.endpoint,
        ...(keylessFetch && { fetch: keylessFetch }),
      };

      // Anthropic requires this opt-in only for browser-to-provider requests.
      // A custom endpoint owns its own CORS and authentication contract.
      if (
        !agent.endpoint ||
        normalizeProviderEndpoint(agent.endpoint) === PROVIDER_ENDPOINTS.anthropic
      ) {
        anthropicConfig.headers = {
          'anthropic-dangerous-direct-browser-access': 'true',
        };
        anthropicConfig.fetch = async (url, options) =>
          globalThis.fetch(url, {
            ...options,
            headers: {
              ...options?.headers,
              'anthropic-dangerous-direct-browser-access': 'true',
            },
          });
      }

      const anthropic = createAnthropic(anthropicConfig);
      return {
        model: anthropic(agent.model),
        providerOptions: buildAnthropicOptions(agent),
      };
    }

    case 'google-generative-ai': {
      const keylessFetch = keylessEndpointFetch(agent);
      const google = createGoogleGenerativeAI({
        apiKey: agent.apiKey || 'no-key-provided',
        baseURL: agent.endpoint,
        ...(keylessFetch && { fetch: keylessFetch }),
      });
      return {
        model: google(agent.model),
        providerOptions: buildGoogleOptions(agent),
      };
    }
  }

  throw new Error(`Unsupported agent API protocol: ${String(agent.apiProtocol)}`);
}
