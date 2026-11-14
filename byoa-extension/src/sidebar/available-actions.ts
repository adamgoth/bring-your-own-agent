interface AvailableAction {
  name: string;
  description: string;
}

/** Discover tools without running them or submitting the user's draft. */
export function setupAvailableActions(tabId: number | null, composer: HTMLTextAreaElement): void {
  const disclosure = document.getElementById('available-actions') as HTMLDetailsElement;
  const trigger = disclosure.querySelector('summary') as HTMLElement;
  const count = document.getElementById('actions-count') as HTMLElement;
  const search = document.getElementById('actions-search') as HTMLInputElement;
  const status = document.getElementById('actions-status') as HTMLElement;
  const list = document.getElementById('actions-list') as HTMLElement;
  let actions: AvailableAction[] = [];
  let sequence = 0;

  function render() {
    const query = search.value.trim().toLowerCase();
    const matches = actions.filter((action) =>
      `${action.name} ${action.description}`.toLowerCase().includes(query)
    );
    list.replaceChildren();
    status.textContent = actions.length
      ? matches.length
        ? `${matches.length} available`
        : 'No matching actions.'
      : 'No actions available for this page.';
    for (const action of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-option';
      const name = document.createElement('strong');
      name.textContent = action.name;
      const description = document.createElement('span');
      description.textContent = action.description;
      button.append(name, description);
      button.addEventListener('click', () => {
        const separator = composer.value && !/\s$/.test(composer.value) ? '\n' : '';
        composer.value += `${separator}Use ${action.name}: `;
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        disclosure.open = false;
        composer.focus();
        composer.setSelectionRange(composer.value.length, composer.value.length);
      });
      list.append(button);
    }
  }

  async function refresh() {
    const request = ++sequence;
    status.textContent = 'Loading actions…';
    list.replaceChildren();
    try {
      const response = await chrome.runtime.sendMessage({ type: 'WEBMCP_GET_TOOLS', tabId });
      if (request !== sequence) return;
      if (!response?.success || !Array.isArray(response.data)) throw new Error('Unavailable');
      actions = response.data;
      count.textContent = String(actions.length);
      render();
    } catch {
      if (request !== sequence) return;
      actions = [];
      count.textContent = '—';
      status.textContent = 'Couldn’t load actions. Close and reopen to try again.';
    }
  }

  search.addEventListener('input', render);
  disclosure.addEventListener('toggle', () => {
    if (disclosure.open) {
      search.value = '';
      search.focus();
      void refresh();
    }
  });
  disclosure.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      disclosure.open = false;
      trigger.focus();
      event.preventDefault();
    }
  });
  document.addEventListener('click', (event) => {
    if (!disclosure.contains(event.target as Node)) disclosure.open = false;
  });
  window.addEventListener('focus', () => void refresh());
  chrome.tabs.onUpdated.addListener((updatedTabId, change) => {
    if (updatedTabId === tabId && change.status === 'complete') void refresh();
  });
  void refresh();
}
