import { marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';

const markdown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
export function importMarkdown(text: string): string {
  // Imported HTML is restricted to the editor's supported prose elements.
  return DOMPurify.sanitize(marked.parse(text, { async: false, gfm: false }), {
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 's', 'del', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a'],
    ALLOWED_ATTR: ['href', 'start'],
  });
}
export const exportMarkdown = (html: string) => markdown.turndown(html) + '\n';
export function downloadMarkdown(title: string, html: string) {
  const url = URL.createObjectURL(new Blob([exportMarkdown(html)], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = (title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim() || 'Untitled') + '.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
