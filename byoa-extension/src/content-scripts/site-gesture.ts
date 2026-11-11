/** Only explicit submit shortcuts count; ordinary typing and synthetic events do not. */
export function isTrustedSubmitShortcut(
  event: Pick<
    KeyboardEvent,
    'isTrusted' | 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing'
  >
): boolean {
  return (
    event.isTrusted &&
    event.key === 'Enter' &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    !event.isComposing
  );
}
