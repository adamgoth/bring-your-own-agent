import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../src/lib/storage/config';
import {
  SUGGESTED_MODELS,
  agentToEditorState,
  defaultAgentEditorState,
  initializeAgentEditor,
  readAgentDraft,
  renderAgentEditor,
} from '../src/options/agent-editor';

const optionsHTML = readFileSync('src/options/index.html', 'utf8');

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'Agent',
    provider: 'openai',
    apiProtocol: 'openai-responses',
    model: 'opaque-model',
    apiKey: 'secret-key',
    temperature: 0.7,
    ...overrides,
  };
}

function form(): HTMLFormElement {
  const value = document.getElementById('agent-form');
  if (!(value instanceof HTMLFormElement)) throw new Error('Agent form missing from fixture');
  return value;
}

beforeEach(() => {
  const parsed = new DOMParser().parseFromString(optionsHTML, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  initializeAgentEditor(form());
});

describe('agent editor state projection', () => {
  it('renders and reads every current agent field through one canonical form path', () => {
    const source = agent({
      name: 'Legacy proxy agent',
      description: 'Uses a compatibility endpoint',
      apiProtocol: 'openai-chat-completions',
      endpoint: 'https://proxy.example.test/v1',
      apiKey: undefined,
      temperature: 0.2,
      maxSteps: 7,
      isDefault: true,
      reasoning: {
        enabled: true,
        openai: { reasoningEffort: 'high' },
        autoExpand: false,
      },
    });

    renderAgentEditor(form(), agentToEditorState(source));
    const draft = readAgentDraft(form());

    expect(draft).toEqual({
      name: 'Legacy proxy agent',
      description: 'Uses a compatibility endpoint',
      apiKey: undefined,
      model: 'opaque-model',
      endpoint: 'https://proxy.example.test/v1',
      apiProtocol: 'openai-chat-completions',
      temperature: 0.2,
      maxSteps: 7,
      isDefault: true,
      reasoning: {
        enabled: true,
        autoExpand: false,
        openai: { reasoningEffort: 'high' },
      },
    });
    expect((document.getElementById('agent-api-key') as HTMLInputElement).required).toBe(false);
  });

  it('emits explicit undefined values so edits can clear optional persisted fields', () => {
    renderAgentEditor(
      form(),
      agentToEditorState(
        agent({
          description: 'Remove me',
          endpoint: 'https://proxy.example.test/v1',
          apiKey: 'remove-me',
        })
      )
    );
    (document.getElementById('agent-description') as HTMLInputElement).value = '';
    (document.getElementById('agent-endpoint') as HTMLInputElement).value = '';
    (document.getElementById('agent-api-key') as HTMLInputElement).value = '';

    const draft = readAgentDraft(form());

    expect(Object.hasOwn(draft, 'description')).toBe(true);
    expect(Object.hasOwn(draft, 'endpoint')).toBe(true);
    expect(Object.hasOwn(draft, 'apiKey')).toBe(true);
    expect(draft).toMatchObject({
      description: undefined,
      endpoint: undefined,
      apiKey: undefined,
    });
  });

  it('does not carry hidden legacy Chat state into a non-OpenAI agent', () => {
    renderAgentEditor(
      form(),
      agentToEditorState(agent({ apiProtocol: 'openai-chat-completions' }))
    );
    expect((document.getElementById('agent-openai-api-mode') as HTMLSelectElement).value).toBe(
      'openai-chat-completions'
    );

    renderAgentEditor(
      form(),
      agentToEditorState(
        agent({
          provider: 'anthropic',
          apiProtocol: 'anthropic-messages',
          model: 'claude-model',
        })
      )
    );

    expect(readAgentDraft(form()).apiProtocol).toBe('anthropic-messages');
    expect((document.getElementById('agent-openai-api-mode') as HTMLSelectElement).value).toBe(
      'openai-responses'
    );
    expect(document.getElementById('openai-api-mode-group')?.classList.contains('hidden')).toBe(
      true
    );

    const connectionApi = document.getElementById('agent-connection-api') as HTMLSelectElement;
    connectionApi.value = 'openai';
    connectionApi.dispatchEvent(new Event('change', { bubbles: true }));
    expect(readAgentDraft(form()).apiProtocol).toBe('openai-responses');
  });

  it('resets every provider-specific reasoning field between sequential edits', () => {
    renderAgentEditor(
      form(),
      agentToEditorState(
        agent({
          reasoning: {
            enabled: true,
            openai: { reasoningEffort: 'high', reasoningSummary: 'detailed' },
            autoExpand: false,
          },
        })
      )
    );

    renderAgentEditor(
      form(),
      agentToEditorState(
        agent({
          provider: 'google',
          apiProtocol: 'google-generative-ai',
          reasoning: {
            enabled: true,
            google: { thinkingBudget: -1, includeThoughts: false },
          },
        })
      )
    );

    expect((document.getElementById('reasoning-effort') as HTMLSelectElement).value).toBe('medium');
    expect((document.getElementById('reasoning-summary') as HTMLSelectElement).value).toBe('auto');
    expect(readAgentDraft(form()).reasoning).toEqual({
      enabled: true,
      autoExpand: true,
      google: { thinkingBudget: -1, includeThoughts: false },
    });
  });

  it('restores complete create defaults after an edit with unsaved values', () => {
    renderAgentEditor(
      form(),
      agentToEditorState(agent({ apiProtocol: 'openai-chat-completions', maxSteps: 42 }))
    );
    (document.getElementById('agent-name') as HTMLInputElement).value = 'Unsaved';
    (document.getElementById('reasoning-enabled') as HTMLInputElement).checked = true;

    renderAgentEditor(form(), defaultAgentEditorState());

    expect((document.getElementById('agent-name') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('agent-openai-api-mode') as HTMLSelectElement).value).toBe(
      'openai-responses'
    );
    expect((document.getElementById('agent-max-steps') as HTMLInputElement).value).toBe('10');
    expect((document.getElementById('reasoning-enabled') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('agent-api-key') as HTMLInputElement).required).toBe(true);
  });

  it('updates credential requirements without selecting a different protocol', () => {
    renderAgentEditor(form(), defaultAgentEditorState());
    const endpoint = document.getElementById('agent-endpoint') as HTMLInputElement;
    const apiKey = document.getElementById('agent-api-key') as HTMLInputElement;

    endpoint.value = 'https://proxy.example.test/v1';
    endpoint.dispatchEvent(new Event('input', { bubbles: true }));

    expect(apiKey.required).toBe(false);
    expect(readAgentDraft(form()).apiProtocol).toBe('openai-responses');
  });
});

function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function chooseProvider(value: string): void {
  const provider = document.getElementById('agent-provider') as HTMLSelectElement;
  provider.value = value;
  provider.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('provider presets', () => {
  it('shows an exact-origin command and copies the selected launch method', async () => {
    renderAgentEditor(form(), defaultAgentEditorState());
    chooseProvider('ollama');
    expect(document.getElementById('ollama-setup')?.classList.contains('hidden')).toBe(false);
    const command = document.getElementById('ollama-setup-command') as HTMLTextAreaElement;
    expect(command.value).toBe(
      'launchctl setenv OLLAMA_ORIGINS "chrome-extension://test-extension-id"'
    );
    const launch = document.getElementById('ollama-launch') as HTMLSelectElement;
    launch.value = 'terminal';
    launch.dispatchEvent(new Event('change'));
    expect(command.value).toBe(
      'OLLAMA_ORIGINS="chrome-extension://test-extension-id" ollama serve'
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    document.getElementById('ollama-copy-command')?.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(command.value);
    expect(document.getElementById('ollama-copy-status')?.textContent).toBe('Command copied.');
    chooseProvider('openai');
    expect(document.getElementById('ollama-setup')?.classList.contains('hidden')).toBe(true);
  });

  it('prefills keyless Ollama and keeps its routing when customizing the endpoint', () => {
    renderAgentEditor(form(), defaultAgentEditorState());
    chooseProvider('ollama');
    expect(readAgentDraft(form())).toMatchObject({
      endpoint: 'http://localhost:11434/v1',
      apiProtocol: 'openai-chat-completions',
      model: 'qwen3:4b',
      apiKey: undefined,
    });
    expect(input('agent-api-key').required).toBe(false);
    renderAgentEditor(form(), agentToEditorState(agent({ ...readAgentDraft(form()) })));
    expect((document.getElementById('agent-provider') as HTMLSelectElement).value).toBe('ollama');
    input('agent-endpoint').value = 'http://localhost:1234/v1';
    input('agent-endpoint').dispatchEvent(new Event('input', { bubbles: true }));
    expect(readAgentDraft(form())).toMatchObject({
      endpoint: 'http://localhost:1234/v1',
      apiProtocol: 'openai-chat-completions',
      model: 'qwen3:4b',
    });
    expect(input('agent-api-key').required).toBe(false);
  });

  it.each([
    ['openai', 'https://api.openai.com/v1', 'openai-responses'],
    ['openrouter', 'https://openrouter.ai/api/v1', 'openai-responses'],
    ['anthropic', 'https://api.anthropic.com/v1', 'anthropic-messages'],
    ['google', 'https://generativelanguage.googleapis.com/v1beta', 'google-generative-ai'],
  ])(
    'fills %s routing and requires a key without suggesting a model',
    (provider, endpoint, protocol) => {
      renderAgentEditor(form(), defaultAgentEditorState());
      chooseProvider(provider);
      expect(readAgentDraft(form())).toMatchObject({ endpoint, apiProtocol: protocol, model: '' });
      expect(input('agent-api-key').required).toBe(true);
      expect(document.getElementById('connection-api-group')?.classList.contains('hidden')).toBe(
        true
      );
      expect(document.getElementById('openai-api-mode-group')?.classList.contains('hidden')).toBe(
        provider !== 'openrouter'
      );
      expect(input('agent-model').placeholder).toBe(
        provider === 'openrouter' ? 'Enter a custom model ID' : 'Enter the exact model ID'
      );
    }
  );

  it('keeps the entered model and agent details, but clears the previous provider key', () => {
    renderAgentEditor(form(), agentToEditorState(agent({ description: 'Keep this' })));
    chooseProvider('openrouter');
    expect(readAgentDraft(form())).toMatchObject({
      name: 'Agent',
      description: 'Keep this',
      model: 'opaque-model',
      apiKey: undefined,
    });
    input('agent-api-key').value = 'dummy-router-key';
    chooseProvider('anthropic');
    expect(input('agent-api-key').value).toBe('');
    expect(readAgentDraft(form()).model).toBe('opaque-model');
  });

  it('recognizes saved presets without changing existing values or credentials', () => {
    const saved = agent({
      endpoint: 'https://openrouter.ai/api/v1/',
      apiProtocol: 'openai-chat-completions',
    });
    renderAgentEditor(form(), agentToEditorState(saved));
    expect((document.getElementById('agent-provider') as HTMLSelectElement).value).toBe(
      'openrouter'
    );
    expect(readAgentDraft(form())).toMatchObject({
      endpoint: saved.endpoint,
      apiProtocol: saved.apiProtocol,
      apiKey: saved.apiKey,
    });
    expect(input('agent-api-key').required).toBe(true);
  });

  it('preserves custom routing and exposes manual API settings', () => {
    const saved = agent({
      endpoint: 'https://gateway.example.test/v1',
      apiProtocol: 'anthropic-messages',
    });
    renderAgentEditor(form(), agentToEditorState(saved));
    expect((document.getElementById('agent-provider') as HTMLSelectElement).value).toBe('custom');
    expect(document.getElementById('connection-api-group')?.classList.contains('hidden')).toBe(
      false
    );
    expect(readAgentDraft(form())).toMatchObject({
      endpoint: saved.endpoint,
      apiProtocol: saved.apiProtocol,
      apiKey: saved.apiKey,
    });
  });

  it('supports customizing a preset without resetting its protocol or model', () => {
    renderAgentEditor(form(), defaultAgentEditorState());
    chooseProvider('openrouter');
    input('agent-model').value = 'my-model-id';
    input('agent-endpoint').value = 'http://localhost:1234/v1';
    input('agent-endpoint').dispatchEvent(new Event('input', { bubbles: true }));
    expect((document.getElementById('agent-provider') as HTMLSelectElement).value).toBe('custom');
    expect(document.getElementById('openai-api-mode-group')?.classList.contains('hidden')).toBe(
      false
    );
    expect(readAgentDraft(form())).toMatchObject({
      endpoint: 'http://localhost:1234/v1',
      apiProtocol: 'openai-responses',
      model: 'my-model-id',
    });
    expect(input('agent-api-key').required).toBe(false);
    chooseProvider('google');
    renderAgentEditor(form(), defaultAgentEditorState());
    expect((document.getElementById('agent-provider') as HTMLSelectElement).value).toBe('openai');
    expect(input('agent-model').value).toBe('');
    expect(input('agent-api-key').value).toBe('');
  });
});

it('keeps OpenRouter selected when opting into Chat Completions and preserves that mode on edit', () => {
  renderAgentEditor(form(), defaultAgentEditorState());
  chooseProvider('openrouter');
  input('agent-model').value = 'dummy-model';
  input('agent-api-key').value = 'dummy-key';
  const mode = document.getElementById('agent-openai-api-mode') as HTMLSelectElement;
  mode.value = 'openai-chat-completions';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  expect((document.getElementById('agent-provider') as HTMLSelectElement).value).toBe('openrouter');
  expect(readAgentDraft(form())).toMatchObject({
    apiProtocol: 'openai-chat-completions',
    model: 'dummy-model',
    apiKey: 'dummy-key',
    endpoint: 'https://openrouter.ai/api/v1',
  });
  renderAgentEditor(form(), agentToEditorState(agent({ ...readAgentDraft(form()) })));
  expect((document.getElementById('agent-provider') as HTMLSelectElement).value).toBe('openrouter');
  expect(mode.value).toBe('openai-chat-completions');
  expect(document.getElementById('openai-api-mode-group')?.classList.contains('hidden')).toBe(
    false
  );
});

describe('suggested models', () => {
  function modelPreset(): HTMLSelectElement {
    return document.getElementById('agent-model-preset') as HTMLSelectElement;
  }

  function choosePreset(value: string): void {
    modelPreset().value = value;
    modelPreset().dispatchEvent(new Event('change', { bubbles: true }));
  }

  const hidden = (element: HTMLElement) => element.classList.contains('hidden');

  it('lists every suggestion followed by a custom option', () => {
    expect([...modelPreset().options].map((option) => option.value)).toEqual([
      ...SUGGESTED_MODELS,
      '__custom__',
    ]);
  });

  it('offers suggestions only for OpenRouter and Custom connections', () => {
    renderAgentEditor(form(), defaultAgentEditorState());
    for (const [provider, offered] of [
      ['openai', false],
      ['anthropic', false],
      ['google', false],
      ['openrouter', true],
      ['custom', true],
    ] as const) {
      chooseProvider(provider);
      expect(hidden(modelPreset())).toBe(!offered);
      expect(hidden(input('agent-model'))).toBe(false);
    }
  });

  it('writes a chosen suggestion into the model ID and hides the text field', () => {
    renderAgentEditor(form(), defaultAgentEditorState());
    chooseProvider('openrouter');
    choosePreset('openai/gpt-6-luna');
    expect(hidden(input('agent-model'))).toBe(true);
    expect(readAgentDraft(form()).model).toBe('openai/gpt-6-luna');
  });

  it('clears a suggestion when switching to a custom model ID', () => {
    renderAgentEditor(form(), defaultAgentEditorState());
    chooseProvider('openrouter');
    choosePreset('meta/muse-ember');
    choosePreset('__custom__');
    expect(hidden(input('agent-model'))).toBe(false);
    expect(input('agent-model').value).toBe('');
    input('agent-model').value = 'vendor/my-model';
    expect(readAgentDraft(form()).model).toBe('vendor/my-model');
  });

  it('restores a saved agent to its suggestion or to the custom field', () => {
    const openrouter = { endpoint: 'https://openrouter.ai/api/v1' };
    renderAgentEditor(
      form(),
      agentToEditorState(agent({ ...openrouter, model: 'anthropic/claude-haiku-5.5' }))
    );
    expect(modelPreset().value).toBe('anthropic/claude-haiku-5.5');
    expect(hidden(input('agent-model'))).toBe(true);

    renderAgentEditor(form(), agentToEditorState(agent({ ...openrouter, model: 'other/model' })));
    expect(modelPreset().value).toBe('__custom__');
    expect(hidden(input('agent-model'))).toBe(false);
    expect(readAgentDraft(form()).model).toBe('other/model');
  });

  it('resyncs after the model ID is edited under a direct provider', () => {
    renderAgentEditor(form(), defaultAgentEditorState());
    chooseProvider('openrouter');
    choosePreset('openai/gpt-6-luna');
    chooseProvider('openai');
    input('agent-model').value = 'gpt-direct';
    chooseProvider('openrouter');
    expect(modelPreset().value).toBe('__custom__');
    expect(hidden(input('agent-model'))).toBe(false);
    expect(readAgentDraft(form()).model).toBe('gpt-direct');
  });
});

describe('cost tracking disclosure', () => {
  const costTracking = () => document.getElementById('agent-cost-tracking') as HTMLDetailsElement;

  it('stays collapsed for agents without prices and opens for agents with them', () => {
    costTracking().open = true;
    renderAgentEditor(form(), agentToEditorState(agent()));
    expect(costTracking().open).toBe(false);

    renderAgentEditor(form(), agentToEditorState(agent({ prices: { input: 1.5, output: 6 } })));
    expect(costTracking().open).toBe(true);
    expect(readAgentDraft(form()).prices).toEqual({ input: 1.5, output: 6 });
  });
});
