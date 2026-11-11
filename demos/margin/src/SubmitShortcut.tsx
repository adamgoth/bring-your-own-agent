import type { KeyboardEvent } from 'react';

export function submitOnShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  if (event.repeat) return;
  const form = event.currentTarget.form;
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (form && submit && !submit.disabled) form.requestSubmit(submit);
}

export function SubmitShortcut() {
  const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return <kbd className="submit-shortcut" aria-hidden="true">{mac ? '⌘' : 'Ctrl'} ↵</kbd>;
}
