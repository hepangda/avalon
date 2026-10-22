import { useEffect } from 'react';

/**
 * Desktop shortcuts press the table's own controls: each control that answers to a key declares it
 * with `aria-keyshortcuts`, and a key only clicks one that is there and enabled. So a key can never
 * do what the button would not (a loyal player's F, a full team's sixth seat).
 */
export function shortcutKey(key: string): string | null {
  if (key === 'Enter') return 'Enter';
  if (/^[0-9]$/.test(key)) return key;
  const letter = key.toUpperCase();
  return ['Y', 'N', 'S', 'F'].includes(letter) ? letter : null;
}

/** Seats 1–9 take their own digit, seat 10 takes 0. */
export function seatShortcut(seat: number): string | undefined {
  return seat < 9 ? String(seat + 1) : seat === 9 ? '0' : undefined;
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing' | 'defaultPrevented' | 'target'>;

/** Returns the control the key pressed, if any. */
export function handleTableShortcut(event: KeyLike, root: ParentNode, doc: Document = document): HTMLElement | null {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
  const key = shortcutKey(event.key);
  if (!key) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return null;
  // Enter on a focused control already presses that control.
  if (key === 'Enter' && target?.closest('button, a[href], [role="button"], summary')) return null;
  // Sheets, the role deal and note popovers own the keyboard while they are open.
  if (doc.querySelector('dialog[open], [role="dialog"]')) return null;
  const control = root.querySelector<HTMLElement>(`[aria-keyshortcuts~="${key}"]`);
  if (!control || control.matches(':disabled, [aria-disabled="true"]')) return null;
  control.click();
  return control;
}

export function useTableShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const root = document.querySelector('.table-screen');
      if (root && handleTableShortcut(event, root)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
