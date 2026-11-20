// @vitest-environment node

/**
 * OpenRouter sticky routing on the real outgoing requests: the real AIClient and real AI SDK
 * adapters run a multi-step tool loop against a stubbed fetch, and every captured request is
 * checked for the conversation's `session_id`.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiProtocol } from '../src/lib/ai/protocol';
import { eventSSE, sse } from './helpers/ai-wire-server';

const mocks = vi.hoisted(() => ({ tools: {} as Record<string, unknown> }));

vi.mock('../src/lib/memory/manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/memory/manager')>()),
  getMemoryManager: () => ({ resolve: async () => ({ state: 'unmounted' }) }),
}));

vi.mock('../src/lib/webmcp/tool-registry', () => ({
  getToolRegistry: () => ({
    captureToolSnapshot: () => ({
      tools: mocks.tools,
      toolSources: new Map([['probe', 'site']]),
      remoteSession: { hasContext: false, signal: new AbortController().signal },
    }),
    onTabToolsChanged: () => () => undefined,
  }),
}));

import { AIClient, type StreamCallbacks } from '../src/lib/ai/client';
import { PROVIDER_ENDPOINTS } from '../src/lib/ai/provider-endpoints';

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

type Reply = 'tool' | 'text';

const responsesReply = (reply: Reply, n: number) =>
  reply === 'tool'
    ? [
        sse({
          type: 'response.created',
          response: { id: `resp_${n}`, created_at: 0, model: 'm' },
        }),
        sse({
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            type: 'function_call',
            id: `fc_${n}`,
            call_id: `call_${n}`,
            name: 'probe',
            arguments: '',
          },
        }),
        sse({
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            type: 'function_call',
            id: `fc_${n}`,
            call_id: `call_${n}`,
            name: 'probe',
            arguments: '{"value":"x"}',
            status: 'completed',
          },
        }),
        sse({
          type: 'response.completed',
          response: { incomplete_details: null, usage: { input_tokens: 1, output_tokens: 1 } },
        }),
        sse('[DONE]'),
      ]
    : [
        sse({
          type: 'response.created',
          response: { id: `resp_${n}`, created_at: 0, model: 'm' },
        }),
        sse({
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: `msg_${n}` },
        }),
        sse({ type: 'response.output_text.delta', item_id: `msg_${n}`, delta: 'OK' }),
        sse({
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'message', id: `msg_${n}` },
        }),
        sse({
          type: 'response.completed',
          response: { incomplete_details: null, usage: { input_tokens: 1, output_tokens: 1 } },
        }),
        sse('[DONE]'),
      ];

const chatReply = (reply: Reply, n: number) => [
  sse({
    id: `chat_${n}`,
    created: 0,
    model: 'm',
    choices: [
      reply === 'tool'
        ? {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `call_${n}`,
                  type: 'function',
                  function: { name: 'probe', arguments: '{"value":"x"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          }
        : { index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }),
  sse('[DONE]'),
];

const anthropicText = [
  eventSSE('message_start', {
    type: 'message_start',
    message: { id: 'msg_1', model: 'm', usage: { input_tokens: 1 } },
  }),
  eventSSE('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  }),
  eventSSE('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'OK' },
  }),
  eventSSE('content_block_stop', { type: 'content_block_stop', index: 0 }),
  eventSSE('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1 },
  }),
  eventSSE('message_stop', { type: 'message_stop' }),
];

const googleText = [
  sse({
    candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  }),
];

let captured: Captured[];
let script: Reply[];

function stubFetch(protocol: ApiProtocol) {
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      captured.push({
        url,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      const reply = script.shift() ?? 'text';
      n++;
      const chunks =
        protocol === 'openai-responses'
          ? responsesReply(reply, n)
          : protocol === 'openai-chat-completions'
            ? chatReply(reply, n)
            : protocol === 'anthropic-messages'
              ? anthropicText
              : googleText;
      return new Response(chunks.join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    })
  );
}

function storeAgent(apiProtocol: ApiProtocol, endpoint: string) {
  vi.mocked(chrome.storage.local.get).mockResolvedValue({
    config: {
      schemaVersion: 2,
      agents: [
        {
          id: 'agent',
          name: 'Agent',
          provider: apiProtocol.startsWith('openai') ? 'openai' : apiProtocol.split('-')[0],
          apiProtocol,
          apiKey: 'fixture-only-key',
          model: 'vendor/model',
          endpoint,
          temperature: 0.7,
          maxSteps: 10,
        },
      ],
    },
  } as never);
}

async function run(sessionId?: string): Promise<void> {
  let failure: Error | undefined;
  let finished = false;
  const callbacks: StreamCallbacks = {
    onFinish: () => {
      finished = true;
    },
    onError: (error) => {
      failure = error;
    },
  };
  await AIClient.getInstance().streamChat(
    'agent',
    [{ role: 'user', content: 'Private prompt text from https://private.example.test/page' }],
    undefined,
    callbacks,
    undefined,
    undefined,
    undefined,
    sessionId === undefined ? {} : { sessionId }
  );
  if (failure) throw failure;
  expect(finished).toBe(true);
}

const sessionIdsOf = (requests: Captured[]) => requests.map(({ body }) => body.session_id);

beforeEach(() => {
  captured = [];
  script = [];
  mocks.tools = {
    probe: tool({
      description: 'Probe',
      inputSchema: z.object({ value: z.string() }),
      execute: async () => 'probed',
    }),
  };
  vi.mocked(chrome.storage.local.get).mockResolvedValue({} as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(['openai-responses', 'openai-chat-completions'] as const)(
  'OpenRouter sticky routing over %s',
  (protocol) => {
    const path = protocol === 'openai-responses' ? '/responses' : '/chat/completions';

    beforeEach(() => {
      storeAgent(protocol, PROVIDER_ENDPOINTS.openrouter);
      stubFetch(protocol);
    });

    it('sends the conversation key on every tool-loop step and follow-up turn', async () => {
      script = ['tool', 'tool', 'text'];
      await run('conversation-key-1');
      expect(captured).toHaveLength(3);
      for (const request of captured) {
        expect(request.url).toBe(`${PROVIDER_ENDPOINTS.openrouter}${path}`);
        expect(request.body.session_id).toBe('conversation-key-1');
        // The body field is authoritative; no OpenRouter header is added.
        expect(request.headers.has('x-session-id')).toBe(false);
        // Fallback stays OpenRouter's default: no provider pinning is introduced.
        expect(request.body).not.toHaveProperty('provider');
        // App attribution so OpenRouter's activity log shows BYOA.
        expect(request.headers.get('http-referer')).toBe(
          'https://github.com/adamgoth/bring-your-own-agent'
        );
        expect(request.headers.get('x-openrouter-title')).toBe('BYOA');
      }
      // The tool loop really ran: later steps carry earlier tool results.
      expect(JSON.stringify(captured[2].body)).toContain('probed');

      script = ['tool', 'text'];
      await run('conversation-key-1');
      expect(sessionIdsOf(captured.slice(3))).toEqual(['conversation-key-1', 'conversation-key-1']);
    });

    it('uses a different key for a new conversation', async () => {
      script = ['text'];
      await run('conversation-key-1');
      script = ['text'];
      await run('conversation-key-2');
      expect(sessionIdsOf(captured)).toEqual(['conversation-key-1', 'conversation-key-2']);
    });

    it('gives a call without a conversation its own key for all of its steps', async () => {
      script = ['tool', 'text'];
      await run();
      script = ['text'];
      await run();
      const [first, second, third] = sessionIdsOf(captured) as string[];
      expect(first).toMatch(/^[0-9a-f-]{36}$/);
      expect(second).toBe(first);
      expect(third).toMatch(/^[0-9a-f-]{36}$/);
      expect(third).not.toBe(first);
      expect(first).not.toContain('private.example.test');
    });

    it('recognizes the OpenRouter endpoint saved with a trailing slash', async () => {
      storeAgent(protocol, `${PROVIDER_ENDPOINTS.openrouter}/`);
      script = ['text'];
      await run('conversation-key-1');
      expect(captured[0].url).toBe(`${PROVIDER_ENDPOINTS.openrouter}${path}`);
      expect(captured[0].body.session_id).toBe('conversation-key-1');
    });

    it('replaces a malformed key instead of sending it', async () => {
      script = ['text'];
      await run('https://private.example.test/?email=someone@example.test');
      expect(captured[0].body.session_id).toMatch(/^[0-9a-f-]{36}$/);
    });
  }
);

describe('non-OpenRouter connections', () => {
  it.each([
    { name: 'OpenAI Responses', protocol: 'openai-responses', endpoint: PROVIDER_ENDPOINTS.openai },
    {
      name: 'a compatible Chat endpoint',
      protocol: 'openai-chat-completions',
      endpoint: 'https://proxy.example.test/api/v1',
    },
    {
      name: 'a look-alike OpenRouter host',
      protocol: 'openai-responses',
      endpoint: 'https://openrouter.ai.example.test/api/v1',
    },
    {
      name: 'a different OpenRouter path',
      protocol: 'openai-chat-completions',
      endpoint: 'https://openrouter.ai/other/v1',
    },
    { name: 'Anthropic', protocol: 'anthropic-messages', endpoint: PROVIDER_ENDPOINTS.anthropic },
    { name: 'Google', protocol: 'google-generative-ai', endpoint: PROVIDER_ENDPOINTS.google },
  ] as const)(
    'sends no OpenRouter session or app headers to $name',
    async ({ protocol, endpoint }) => {
      storeAgent(protocol, endpoint);
      stubFetch(protocol);
      script = ['text'];
      await run('conversation-key-1');
      expect(captured).toHaveLength(1);
      expect(captured[0].body).not.toHaveProperty('session_id');
      expect(captured[0].headers.has('x-session-id')).toBe(false);
      expect(captured[0].headers.has('http-referer')).toBe(false);
      expect(captured[0].headers.has('x-openrouter-title')).toBe(false);
      expect(JSON.stringify(captured[0])).not.toContain('conversation-key-1');
    }
  );
});
