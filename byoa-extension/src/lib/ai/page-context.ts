import type { PageContext } from '../../types';

export function buildPageContextXml(
  ctx: PageContext,
  siteToolHints?: Array<{ name: string; description: string }>
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let siteToolsBlock = '';
  if (siteToolHints && siteToolHints.length > 0) {
    const lines = siteToolHints.map((t) => `- ${esc(t.name)}: ${esc(t.description)}`).join('\n');
    siteToolsBlock = `\n<site_tools>\nThese page-specific tools may inspect or act in the active browser tab's existing signed-in session:\n${lines}\n</site_tools>`;
  }

  return `<page_context>
<url>${esc(ctx.url)}</url>
<title>${esc(ctx.title)}</title>${siteToolsBlock}
</page_context>

`;
}
