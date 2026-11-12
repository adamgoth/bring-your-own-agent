export interface SiteChat {
  usage?: import('./usage').TaskUsage;
  origin: string;
  shared?: string[];
  notice?: string;
  id: string;
  createdAt: number;
  agentName?: string;
  prompt: string;
  response: string;
  activity: Array<{ name: string; text: string }>;
  status: string;
  detail: string;
}
export const siteChatPrefix = (tabId: number) => `agentboard_chat_${tabId}_`;
