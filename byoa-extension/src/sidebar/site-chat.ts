import { siteChatPrefix, type SiteChat } from '../lib/site-chat';
import { StreamingMarkdownRenderer } from './StreamingMarkdownRenderer';
import { formatTokens, formatUsd } from '../options/format';

/**
 * One quiet meta line per task: agent, status and usage. Unknown cost is left out; the full
 * figures stay in the tooltip and in Settings, Connected sites.
 */
export function siteChatMeta(chat: SiteChat): { text: string; title: string } {
  const parts = [chat.agentName ?? 'BYOA', chat.status];
  const details: string[] = [];
  if (chat.usage) {
    const incomplete = !chat.usage.usageKnown;
    const tokens = formatTokens(chat.usage.totalTokens, incomplete);
    parts.push(tokens);
    if (chat.usage.costUsd !== undefined) parts.push(formatUsd(chat.usage.costUsd, incomplete));
    details.push(`${tokens} · ${formatUsd(chat.usage.costUsd, incomplete)}`);
    if (incomplete) details.push('Usage is incomplete; the step limit was used as a fallback.');
  }
  details.push(
    chat.shared?.length
      ? `Shared with this task: ${chat.shared.join(', ')}`
      : 'Nothing shared from your workspace'
  );
  return { text: parts.join(' · '), title: details.join('\n') };
}

/** Display popup task history without replacing the sidebar's own conversation or draft. */
export function setupSiteChat(tabId: number | null, container: HTMLElement) {
  if (!tabId) return;
  const prefix = siteChatPrefix(tabId);
  const focusKey = `agentboard_chat_focus_${tabId}`;
  const section = document.createElement('section');
  section.id = 'site-agent-chat';
  section.setAttribute('aria-label', 'App agent chat');
  const history = document.createElement('div');
  section.append(history);
  let pending = Promise.resolve();
  let conversationId: string | undefined;
  const form = document.createElement('form');
  const draft = document.createElement('textarea');
  draft.setAttribute('aria-label', 'Continue this site conversation');
  draft.placeholder = 'Continue this site conversation…';
  draft.maxLength = 30000;
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = 'Send to this site';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel site task';
  const notice = document.createElement('p');
  notice.setAttribute('role', 'status');
  form.append(draft, send, cancel, notice);
  form.hidden = true;
  section.append(form);
  let submitting = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submitting || !draft.value.trim() || !conversationId) return;
    submitting = true;
    send.disabled = true;
    void chrome.runtime
      .sendMessage({ type: 'SITE_VOICE_CONTINUE', tabId, conversationId, text: draft.value })
      .then((result) => {
        if (result?.success) {
          draft.value = '';
          notice.textContent = 'Working with this site’s approved tools…';
        } else notice.textContent = result?.error || 'Could not continue this conversation.';
      })
      .catch(() => {
        notice.textContent = 'Reload BYOA to continue.';
      })
      .finally(() => {
        submitting = false;
        send.disabled = false;
      });
  });
  cancel.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'SITE_VOICE_CANCEL', tabId, conversationId });
  });
  const refresh = (focus = false) => {
    pending = pending
      .then(async () => {
        const stored = await chrome.storage.session.get(null);
        const chats = Object.entries(stored)
          .filter(([key]) => key.startsWith(prefix))
          .map(([, value]) => value as SiteChat)
          .sort((a, b) => a.createdAt - b.createdAt);
        if (!chats.length) return;
        history.replaceChildren();
        const heading = document.createElement('h3');
        heading.textContent = 'App agent chat';
        history.append(heading);
        for (const chat of chats) {
          const article = document.createElement('article');
          article.dataset.taskId = chat.id;
          const meta = siteChatMeta(chat);
          const label = document.createElement('p');
          label.className = 'site-chat-label';
          label.textContent = meta.text;
          label.title = meta.title;
          article.append(label);
          // Sharing is privacy-relevant, so it stays visible whenever something was shared.
          if (chat.shared?.length) {
            const shared = document.createElement('p');
            shared.className = 'site-chat-label';
            shared.textContent = `Shared: ${chat.shared.join(', ')}`;
            article.append(shared);
          }
          if (chat.notice) {
            const notice = document.createElement('p');
            notice.textContent = chat.notice;
            article.append(notice);
          }
          const user = document.createElement('div');
          user.className = 'message message-user';
          user.textContent = chat.prompt;
          article.append(user);
          if (chat.activity.length) {
            const tools = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = `Tool activity (${chat.activity.length})`;
            tools.append(summary);
            for (const activity of chat.activity) {
              const name = document.createElement('strong');
              name.textContent = activity.name;
              const value = document.createElement('pre');
              value.textContent = activity.text;
              tools.append(name, value);
            }
            article.append(tools);
          }
          if (chat.response) {
            const assistant = document.createElement('div');
            assistant.className = 'message message-assistant';
            StreamingMarkdownRenderer.renderComplete(assistant, chat.response);
            article.append(assistant);
          }
          const status = document.createElement('p');
          status.className = 'site-chat-label';
          status.textContent = chat.detail;
          article.append(status);
          history.append(article);
        }
        const latest = chats.filter((chat) => chat.conversationId).at(-1);
        conversationId = latest?.conversationId;
        form.hidden = !conversationId;
        if (conversationId) {
          send.disabled = submitting || latest?.status === 'queued' || latest?.status === 'working';
          cancel.hidden = latest?.status !== 'queued' && latest?.status !== 'working';
        }
        if (!section.isConnected) container.prepend(section);
        if (focus) {
          const taskId = stored[focusKey]?.taskId;
          const target =
            Array.from(section.querySelectorAll<HTMLElement>('article')).find(
              (article) => article.dataset.taskId === taskId
            ) ?? section;
          target.scrollIntoView?.({ block: 'start' });
        }
      })
      .catch(() => undefined);
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    if (Object.keys(changes).some((key) => key.startsWith(prefix) || key === focusKey))
      refresh(focusKey in changes);
  });
  refresh(true);
}
