/** Space speaks from the table, while inputs and other controls keep their keys. */
export function isPushToTalkShortcut(event: KeyboardEvent): boolean {
  if (
    event.key !== ' ' ||
    event.repeat ||
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target.closest('[data-push-to-talk]')) return true;
  return !target.closest(
    'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="button"], [role="slider"], [role="combobox"]',
  );
}
