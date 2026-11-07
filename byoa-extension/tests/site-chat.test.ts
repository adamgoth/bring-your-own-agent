import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupSiteChat } from '../src/sidebar/site-chat';
import type { SiteChat } from '../src/lib/site-chat';

const sessionGet = vi.mocked(
  chrome.storage.session.get as (keys: null) => Promise<Record<string, unknown>>
);

const chat: SiteChat = {
  id: 'one',
  origin: 'http://localhost:5183',
  createdAt: 1,
  agentName: 'Test agent',
  prompt: 'Shorten this passage',
  response: '**Here is your suggestion.**',
  activity: [{ name: 'propose_replacement', text: '<script>bad()</script>' }],
  status: 'done',
  detail: 'Finished.',
};
describe('Site chat history in the sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML =
      '<textarea id="message-input">Existing unsent draft</textarea><div id="messages"><p>Existing sidebar chat</p></div>';
  });
  it('restores tab-scoped messages and tools on a cold sidebar without changing its conversation or draft', async () => {
    sessionGet.mockResolvedValue({
      agentboard_chat_7_one: chat,
      agentboard_chat_8_other: { ...chat, prompt: 'Other tab private prompt' },
    });
    setupSiteChat(7, document.getElementById('messages')!);
    await vi.waitFor(() =>
      expect(document.querySelector('#site-agent-chat')?.textContent).toContain(
        'Shorten this passage'
      )
    );
    expect(document.querySelector('#site-agent-chat strong')?.textContent).toBe(
      'propose_replacement'
    );
    expect(document.querySelector('#site-agent-chat script')).toBeNull();
    expect(document.querySelector('#site-agent-chat')?.textContent).not.toContain(
      'Other tab private prompt'
    );
    expect(document.getElementById('messages')?.textContent).toContain('Existing sidebar chat');
    expect((document.getElementById('message-input') as HTMLTextAreaElement).value).toBe(
      'Existing unsent draft'
    );
  });
  it('updates existing history as the background response arrives', async () => {
    sessionGet.mockResolvedValue({
      agentboard_chat_7_one: { ...chat, response: 'Working text', status: 'working' },
    });
    setupSiteChat(7, document.getElementById('messages')!);
    await vi.waitFor(() =>
      expect(document.querySelector('#site-agent-chat')?.textContent).toContain('Working text')
    );
    sessionGet.mockResolvedValue({ agentboard_chat_7_one: chat });
    const changed = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)![0];
    changed({ agentboard_chat_7_one: { newValue: chat } }, 'session');
    await vi.waitFor(() =>
      expect(document.querySelector('#site-agent-chat')?.textContent).toContain(
        'Here is your suggestion.'
      )
    );
    expect(document.querySelectorAll('#site-agent-chat')).toHaveLength(1);
  });
});
