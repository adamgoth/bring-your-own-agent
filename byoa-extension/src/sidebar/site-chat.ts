import { siteChatPrefix, type SiteChat } from '../lib/site-chat';
import { StreamingMarkdownRenderer } from './StreamingMarkdownRenderer';

/** Display popup task history without replacing the sidebar's own conversation or draft. */
export function setupSiteChat(tabId: number | null, container: HTMLElement) {
  if (!tabId) return;
  const prefix = siteChatPrefix(tabId);
  const focusKey = `agentboard_chat_focus_${tabId}`;
  const section = document.createElement('section');
  section.id = 'site-agent-chat';
  section.setAttribute('aria-label', 'App agent chat');
  let pending = Promise.resolve();
  const refresh = (focus = false) => {
    pending = pending
      .then(async () => {
        const stored = await chrome.storage.session.get(null);
        const chats = Object.entries(stored)
          .filter(([key]) => key.startsWith(prefix))
          .map(([, value]) => value as SiteChat)
          .sort((a, b) => a.createdAt - b.createdAt);
        if (!chats.length) return;
        section.replaceChildren();
        const heading = document.createElement('h3');
        heading.textContent = 'App agent chat';
        section.append(heading);
        for (const chat of chats) {
          const article = document.createElement('article');
          article.dataset.taskId = chat.id;
          const label = document.createElement('p');
          label.className = 'site-chat-label';
          label.textContent = `${chat.agentName ?? 'BYOA'} · ${chat.status}`;
          article.append(label);
          const shared = document.createElement('p');
          shared.textContent = chat.shared?.length
            ? `Shared with this task: ${chat.shared.join(', ')}`
            : 'Nothing shared from your workspace';
          article.append(shared);
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
          section.append(article);
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
