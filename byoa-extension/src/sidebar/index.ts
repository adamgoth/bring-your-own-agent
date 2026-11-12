import { setupLocalVoice } from './local-voice';
import { setupSiteChat } from './site-chat';
/**
 * Sidebar main entry point
 * Handles chat UI, message management, AI streaming, and provider switching
 */

import log from '../lib/logger';
import { connectChatSession } from './chat-session';
import './styles.css';
import type { ChatMessage, MessageContent, MessagePart } from '../types';
import { ConfigStorage, type AgentConfig } from '../lib/storage/config';
import { StreamingMarkdownRenderer } from './StreamingMarkdownRenderer';
import { AgentSwitcher } from './AgentSwitcher';
import { CommandRegistry, CommandProcessor, createBuiltinCommands } from '../lib/commands';

// DOM elements
const messagesContainer = document.getElementById('messages') as HTMLDivElement;
const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
const sendButton = document.getElementById('send-button') as HTMLButtonElement;
const agentSwitcher = new AgentSwitcher(
  document.getElementById('agent-switcher') as HTMLDetailsElement,
  (agentId) => void selectAgent(agentId)
);
const settingsButton = document.getElementById('settings-button') as HTMLButtonElement;

// State
let currentAgentId: string | null = null;
let currentAgent: AgentConfig | null = null;
let isLoading = false;
let connectionRetries = 0;
const MAX_RETRIES = 3;
let agentSelectionSequence = 0;
let agentLoadSequence = 0;
let voice: ReturnType<typeof setupLocalVoice>;
let voiceSendPending = false;
let chatSession: ReturnType<typeof connectChatSession> | undefined;
const configStorage = ConfigStorage.getInstance();

// Image attachment state
interface ImageAttachment {
  id: string;
  dataUrl: string;
  mimeType: string;
  size: number;
  filename: string;
}

let pendingAttachments: ImageAttachment[] = [];

// Command system
let commandRegistry: CommandRegistry;
let commandProcessor: CommandProcessor;

// Scroll management state
let isUserAtBottom = true; // Initially at bottom

/**
 * Resize image if it exceeds max dimensions
 * Maintains aspect ratio and converts to JPEG for efficiency
 * @param file Original image file
 * @param maxDimension Max width/height (default 1920px)
 * @param quality JPEG quality 0-1 (default 0.85)
 * @returns Resized data URL
 */
async function resizeImageIfNeeded(
  file: File,
  maxDimension = 1920,
  quality = 0.85
): Promise<{ dataUrl: string; sizeKB: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to create canvas context'));
      return;
    }

    img.onload = () => {
      let { width, height } = img;

      // Check if resize needed
      const needsResize = width > maxDimension || height > maxDimension;

      if (!needsResize && file.size < 1024 * 1024) {
        // Small enough, return original
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const sizeKB = (dataUrl.length * 0.75) / 1024;
          resolve({ dataUrl, sizeKB });
        };
        reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
        reader.readAsDataURL(file);
        return;
      }

      // Calculate new dimensions (maintain aspect ratio)
      if (width > height) {
        if (width > maxDimension) {
          height = (height * maxDimension) / width;
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = (width * maxDimension) / height;
          height = maxDimension;
        }
      }

      // Resize
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to JPEG with quality control
      const resizedDataUrl = canvas.toDataURL('image/jpeg', quality);
      const sizeKB = (resizedDataUrl.length * 0.75) / 1024;
      resolve({ dataUrl: resizedDataUrl, sizeKB });
    };

    img.onerror = () => reject(new Error('Failed to load image'));

    // Load original
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Attach an image file to pending attachments
 * Automatically resizes large images to 1920px max dimension
 */
async function attachImage(file: File): Promise<void> {
  // Validate file type
  if (!file.type.startsWith('image/')) {
    addMessage('error', `Invalid file type: ${file.type}. Please select an image file.`);
    return;
  }

  try {
    // Resize if needed (1920px max, 85% quality)
    const { dataUrl, sizeKB } = await resizeImageIfNeeded(file);

    pendingAttachments.push({
      id: globalThis.crypto.randomUUID(),
      dataUrl,
      mimeType: 'image/jpeg', // Always JPEG after resize
      size: Math.round(sizeKB * 1024),
      filename: file.name,
    });

    updateAttachmentIndicator();
    log.info('[Sidebar] Attached image:', file.name, `(${sizeKB.toFixed(0)}KB)`);
  } catch (error) {
    log.error('[Sidebar] Failed to attach image:', error);
    addMessage(
      'error',
      `Failed to attach image: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Update attachment indicator display
 */
function updateAttachmentIndicator(): void {
  const indicator = document.getElementById('attachment-indicator');
  if (!indicator) return;

  if (pendingAttachments.length === 0) {
    indicator.style.display = 'none';
  } else {
    indicator.style.display = 'block';
    const count = pendingAttachments.length;
    indicator.textContent = `🖼️ ${count} image${count > 1 ? 's' : ''} attached - Press ESC to clear`;

    // Tooltip shows filenames
    indicator.title = pendingAttachments
      .map((a) => `${a.filename} (${(a.size / 1024).toFixed(1)}KB)`)
      .join('\n');
  }
}

// Parse the attached tab ID from the URL hash
const attachedTabId = (() => {
  const hash = new URL(window.location.href).hash;
  const match = hash.match(/#tab=(\d+)/);
  return match ? Number(match[1]) : null;
})();

log.info('[Sidebar] Initialized for tab:', attachedTabId);

// Smart scroll management helpers
function checkIfUserAtBottom(): boolean {
  const threshold = 10; // Allow some margin for rounding errors
  return (
    messagesContainer.scrollTop + messagesContainer.clientHeight >=
    messagesContainer.scrollHeight - threshold
  );
}

function maintainScrollPosition(): void {
  // Update our tracking of whether user is at bottom
  isUserAtBottom = checkIfUserAtBottom();
}

function scrollToBottomIfNeeded(): void {
  // Only scroll to bottom if user was already at bottom
  if (isUserAtBottom) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  voice = setupLocalVoice({
    changed: updateSendButton,
    canStart: () => !isLoading && !voiceSendPending,
  });
  // Remote MCP discovery is lazy; nudge it now so a cold browser session overlaps
  // discovery with the user typing rather than with their first message.
  chrome.runtime.sendMessage({ type: 'WEBMCP_WARM_TOOLS' }).catch(() => {
    // Warming is best-effort: a cold cache simply resolves at stream start.
  });

  // Event handlers must not accept input before their command dependency exists.
  commandRegistry = new CommandRegistry();
  const builtinCommands = createBuiltinCommands(commandRegistry, attachedTabId);
  commandRegistry.registerBuiltins(builtinCommands);
  await commandRegistry.loadUserCommands();
  commandProcessor = new CommandProcessor(commandRegistry);

  setupEventListeners();
  setupMessageListener();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.config) void loadAgents();
  });
  await loadAgents();
  if (attachedTabId !== null) {
    chatSession = connectChatSession({
      container: messagesContainer,
      message: addMessage,
      busy: (busy) => {
        isLoading = busy;
        updateSendButton();
      },
      selected: (agentId) => {
        currentAgentId = agentId;
        void loadAgents();
      },
      scroll: scrollToBottomIfNeeded,
    });
  }
  setupSiteChat(attachedTabId, messagesContainer);

  // Set up scroll tracking
  messagesContainer.addEventListener('scroll', () => {
    maintainScrollPosition();
  });

  // Listen for clear conversation event from built-in command
  window.addEventListener('clear-conversation', () => {
    clearConversation();
  });

  // Start health check
  startHealthCheck();

  // Initialize button state
  updateSendButton();
});

type SidebarState = 'loading' | 'setup' | 'error' | 'chat';

function setSidebarState(state: SidebarState): void {
  const ready = state === 'chat';
  const brand = document.getElementById('sidebar-brand');
  if (brand) brand.hidden = ready;
  const setup = document.getElementById('agent-setup');
  if (setup) setup.hidden = ready;
  for (const selector of ['.chat-container', '.input-container', '#agent-switcher']) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.hidden = !ready;
  }
  const title = document.getElementById('setup-title');
  const description = document.getElementById('setup-description');
  const action = document.getElementById('setup-action');
  const retry = document.getElementById('setup-retry');
  if (title)
    title.textContent =
      state === 'error'
        ? 'Unable to load your agents'
        : state === 'setup'
          ? 'Bring your first agent to BYOA'
          : 'Loading your agents…';
  if (description)
    description.textContent =
      state === 'error'
        ? 'BYOA couldn’t read your configuration. Try again or open settings to review it.'
        : state === 'setup'
          ? 'Choose your provider and model, then add your connection details to start chatting.'
          : 'BYOA is checking your configuration.';
  if (action) {
    action.hidden = state !== 'setup' && state !== 'error';
    action.textContent = state === 'error' ? 'Open settings' : 'Configure your first agent';
    action.onclick = () => {
      const opening =
        state === 'error'
          ? chrome.runtime.openOptionsPage()
          : chrome.tabs.create({
              url: chrome.runtime.getURL('src/options/index.html#create-agent'),
            });
      void Promise.resolve(opening).catch(() => {
        if (description) description.textContent = 'Couldn’t open settings. Please try again.';
      });
    };
  }
  if (retry) {
    retry.hidden = state !== 'error';
    retry.onclick = () => void loadAgents();
  }
  messageInput.disabled = !ready;
  updateSendButton();
}

async function loadAgents() {
  const sequence = ++agentLoadSequence;
  // An incoming configuration snapshot supersedes any pending agent selection.
  ++agentSelectionSequence;
  try {
    const agents = await configStorage.getAgents();
    const defaultAgent = await configStorage.getDefaultAgent();
    if (sequence !== agentLoadSequence) return;
    const selectedAgent =
      agents.find(({ id }) => id === currentAgentId) ??
      agents.find(({ id }) => id === defaultAgent?.id) ??
      agents[0];
    currentAgentId = selectedAgent?.id ?? null;
    currentAgent = selectedAgent ?? null;
    agentSwitcher.setAgents(agents, selectedAgent?.id);
    if (!selectedAgent) {
      cancelCurrentStream();
      setSidebarState('setup');
      return;
    }
    messageInput.placeholder = 'Ask anything. Use /help for available commands.';
    setSidebarState('chat');
  } catch {
    if (sequence !== agentLoadSequence) return;
    currentAgentId = null;
    currentAgent = null;
    cancelCurrentStream();
    agentSwitcher.setAgents([]);
    setSidebarState('error');
    log.error('[Sidebar] Failed to load agent configuration');
  }
}

// Setup listener for messages from background
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    // Filter messages by tabId for tab-specific messages
    if (request.type === 'CONTEXT_SELECTION') {
      // Only handle if the message is for our tab
      if (request.tabId !== attachedTabId) {
        log.debug(
          `[Sidebar] Ignoring CONTEXT_SELECTION for tab ${request.tabId}, our tab is ${attachedTabId}`
        );
        sendResponse({ received: false });
        return false;
      }

      // Handle text selected from context menu
      if (request.text) {
        voice?.cancel();
        messageInput.value = `Please help me with this text:\n\n"${request.text}"`;
        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
        messageInput.focus();
      }
    } else if (request.type === 'PING') {
      // PING is tab-agnostic, always respond
      // This is handled by the background script
      sendResponse({ received: true });
    } else {
      // Don't respond to unknown messages - let other handlers deal with them
      log.debug('[Sidebar] Ignoring message type:', request.type);
    }

    return false;
  });
}

// Health check to detect disconnections
function startHealthCheck() {
  setInterval(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'PING',
      } as const);
      if (response?.pong) {
        connectionRetries = 0; // Reset retry counter on success
      }
    } catch {
      connectionRetries++;
      if (connectionRetries >= MAX_RETRIES) {
        log.error('[Sidebar] Lost connection to background service');
        addMessage('error', 'Connection lost. Please reload the extension.');
      }
    }
  }, 30000); // Check every 30 seconds
}

// Static icon markup for the send/stop button (no user content).
const SEND_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>';
const STOP_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>';

function updateSendButton() {
  if (isLoading) {
    const mic = document.querySelector<HTMLButtonElement>('#voice-button');
    if (mic) mic.disabled = true;
    sendButton.innerHTML = STOP_ICON;
    sendButton.title = 'Stop generation (Esc)';
    sendButton.setAttribute('aria-label', 'Stop generation');
    sendButton.classList.add('stop-mode');
    sendButton.disabled = false; // Keep enabled for cancellation
  } else {
    sendButton.innerHTML = SEND_ICON;
    sendButton.title = 'Send message';
    sendButton.setAttribute('aria-label', 'Send message');
    sendButton.classList.remove('stop-mode');
    sendButton.disabled =
      voiceSendPending || !currentAgent || (!voice?.isActive && messageInput.value.trim() === '');
    if (voiceSendPending) {
      sendButton.title = 'Finishing dictation…';
      sendButton.setAttribute('aria-label', 'Finishing dictation');
    }
    const mic = document.querySelector<HTMLButtonElement>('#voice-button');
    if (mic) mic.disabled = voiceSendPending;
  }
}

// Agent switching affects future sends without cancelling the active response.
// Clear the bootstrap before the async lookup so late callbacks cannot cross agents.
async function selectAgent(selectedAgentId: string): Promise<void> {
  const selectionSequence = ++agentSelectionSequence;
  currentAgentId = null;
  currentAgent = null;
  updateSendButton();

  try {
    const [agent] = await Promise.all([
      configStorage.getAgent(selectedAgentId),
      chatSession?.select(selectedAgentId),
    ]);
    if (selectionSequence !== agentSelectionSequence) return;
    if (!agent) throw new Error('Agent not found');
    currentAgentId = selectedAgentId;
    currentAgent = agent;
    addMessage('system', `Switched to ${agent.name}`);
  } catch {
    if (selectionSequence !== agentSelectionSequence) return;
    addMessage('error', 'Failed to switch agent');
    log.error('[Sidebar] Agent switch failed');
  } finally {
    if (selectionSequence === agentSelectionSequence) updateSendButton();
  }
}

function setupEventListeners() {
  // Send message or cancel on button click
  sendButton.addEventListener('click', () => {
    if (isLoading) {
      cancelCurrentStream();
    } else {
      handleSendMessage();
    }
  });

  // Send message on Enter (without Shift)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  // Attach button click - open file picker
  const attachButton = document.getElementById('attach-button') as HTMLButtonElement;
  attachButton.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.multiple = true; // Allow multi-select
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) {
        for (const file of Array.from(files)) {
          await attachImage(file);
        }
      }
    };
    input.click();
  });

  // Clipboard paste for images
  messageInput.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    // Check for images in clipboard
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault(); // Don't paste as text

        const file = item.getAsFile();
        if (file) {
          await attachImage(file);
        }
        return;
      }
    }

    // Fall through to default text paste
  });

  // Auto-resize textarea and update button state
  messageInput.addEventListener('input', () => {
    const currentHeight = messageInput.offsetHeight;

    // If content overflows current height, grow immediately
    if (messageInput.scrollHeight > currentHeight && currentHeight < 140) {
      messageInput.style.height = `${Math.min(messageInput.scrollHeight, 140)}px`;
    }
    // If content is less than current height, shrink by resetting
    else if (messageInput.scrollHeight < currentHeight) {
      messageInput.style.height = '88px'; // Reset to base height
      if (messageInput.scrollHeight > 88) {
        messageInput.style.height = `${Math.min(messageInput.scrollHeight, 140)}px`;
      }
    }

    if (!isLoading) {
      updateSendButton();
    }
  });

  // Settings button click
  settingsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

async function handleSendMessage() {
  if (voiceSendPending) return;
  if (voice?.isActive) {
    voiceSendPending = true;
    updateSendButton();
    let complete = false;
    try {
      complete = await voice.finishForSend();
    } finally {
      voiceSendPending = false;
      updateSendButton();
    }
    if (!complete) return;
  }
  const text = messageInput.value.trim();

  // Require either text or attachments and a fully resolved agent selection.
  if (!text && pendingAttachments.length === 0) return;
  if (isLoading || !currentAgentId || !currentAgent) return;

  // Clear input immediately for better UX
  messageInput.value = '';
  messageInput.style.height = '88px';

  // Process slash commands (only if there's text)
  if (text) {
    const processed = await commandProcessor.process(text);

    if (processed) {
      if (processed.type === 'action' && processed.action) {
        // Execute built-in command (doesn't send to LLM)
        try {
          processed.action();
        } catch (error) {
          log.error('[Sidebar] Command execution error:', error);
          addMessage('error', `Command failed: ${error}`);
        }
        return;
      } else if (processed.type === 'text' && processed.content) {
        // Replace message with expanded template and continue with attachments
        const expandedMessage = processed.content;
        await createAndSendMessage(expandedMessage);
        return;
      }
    }
  }

  // Regular message (not a command)
  await createAndSendMessage(text);
}

/**
 * Helper to create message with attachments and send to AI
 */
async function createAndSendMessage(text: string) {
  // Build multi-part content
  const content: MessagePart[] = [];

  if (text) {
    content.push({ type: 'text', text });
  }

  for (const attachment of pendingAttachments) {
    content.push({
      type: 'image',
      image: attachment.dataUrl,
      mimeType: attachment.mimeType,
    });
  }

  // Create message
  const userMsg: ChatMessage = {
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    content:
      content.length === 1 && content[0].type === 'text'
        ? (content[0].text ?? '') // Keep as string if text-only (backward compatible)
        : content, // Use multi-part for images
    timestamp: Date.now(),
    metadata: {
      hasAttachments: pendingAttachments.length > 0,
    },
  };

  if (!chatSession || !currentAgentId) {
    addMessage('error', 'Open BYOA on a browser tab to start a conversation.');
    return;
  }
  isLoading = true;
  updateSendButton();
  try {
    await chatSession.submit(userMsg.id, currentAgentId, userMsg.content);
  } catch (error) {
    isLoading = false;
    updateSendButton();
    messageInput.value = text;
    addMessage('error', error instanceof Error ? error.message : 'Could not submit message.');
    return;
  }

  // Clear attachments
  const hadAttachments = pendingAttachments.length > 0;
  pendingAttachments = [];
  updateAttachmentIndicator();

  if (hadAttachments) {
    log.info('[Sidebar] Sending message with attachments to AI');
  }
}

function addMessage(
  role: 'user' | 'assistant' | 'system' | 'error',
  content: MessageContent,
  isStreaming = false
): HTMLDivElement {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message message-${role}`;
  if (isStreaming) {
    messageDiv.classList.add('streaming');
  }

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  // Handle string content (backward compatible)
  if (typeof content === 'string') {
    // Support markdown formatting
    if (role === 'assistant' && content) {
      StreamingMarkdownRenderer.renderComplete(contentDiv, content);
    } else if (role === 'assistant' && isStreaming) {
      // Empty content for streaming, will be filled incrementally
      contentDiv.innerHTML = '';
    } else {
      contentDiv.textContent = content;
    }
  } else {
    // Handle multi-part content
    const textParts = content.filter((p) => p.type === 'text');
    const imageParts = content.filter((p) => p.type === 'image');

    // Render text parts
    if (textParts.length > 0) {
      const textContent = textParts.map((p) => p.text).join('\n');
      if (role === 'assistant') {
        StreamingMarkdownRenderer.renderComplete(contentDiv, textContent);
      } else {
        contentDiv.textContent = textContent;
      }
    }

    // Add attachment badge for images
    if (imageParts.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'attachment-badge';
      badge.textContent = `📎 ${imageParts.length} image${imageParts.length > 1 ? 's' : ''}`;
      contentDiv.appendChild(badge);
    }
  }

  messageDiv.appendChild(contentDiv);
  messagesContainer.appendChild(messageDiv);

  // Smart scroll - only scroll if user is at bottom
  scrollToBottomIfNeeded();

  return messageDiv;
}

// Add clear conversation functionality
function clearConversation() {
  void chatSession
    ?.clear()
    .then(() => {
      for (const child of Array.from(messagesContainer.children)) {
        if (child.classList.contains('message')) child.remove();
      }
      isUserAtBottom = true;
    })
    .catch((error) => addMessage('error', error.message));
}

// Add keyboard shortcut for clearing (Cmd/Ctrl+K)
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    clearConversation();
  }
});

// Cancel current stream
function cancelCurrentStream() {
  void chatSession?.cancel().catch((error) => addMessage('error', error.message));
}

// Cancel current stream on Escape OR clear attachments
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (voice?.isActive) {
      voice.cancel();
      return;
    }
    // Priority 1: Cancel active or preparing stream
    if (isLoading) {
      cancelCurrentStream();
    }
    // Priority 2: Clear pending attachments
    else if (pendingAttachments.length > 0) {
      pendingAttachments = [];
      updateAttachmentIndicator();
      log.info('[Sidebar] Cleared pending attachments');
    }
  }
});

export {};
