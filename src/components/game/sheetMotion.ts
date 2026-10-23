/**
 * Sheets come out of the control that opened them and go back into it.
 * The opener is whatever the player last pressed (or focused, for keyboard use).
 */
const OPEN_MS = 340;
const CLOSE_MS = 260;
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.25, 1)';
const EASE_IN = 'cubic-bezier(0.5, 0, 0.75, 0)';
const PRESS_WINDOW_MS = 1500;

let lastPress: { el: Element; at: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (event) => {
    const el = event.target instanceof Element
      ? event.target.closest('button, a, summary, label, [role="button"], [data-sheet-origin]')
      : null;
    lastPress = el ? { el, at: performance.now() } : null;
  }, true);
}

export function pressedOrigin(): HTMLElement | null {
  const pressed = lastPress && performance.now() - lastPress.at < PRESS_WINDOW_MS ? lastPress.el : null;
  const focused = document.activeElement !== document.body ? document.activeElement : null;
  const el = pressed ?? focused;
  return el instanceof HTMLElement ? el : null;
}

/** A control that left the page may have a successor in its place, marked with the same `data-sheet-origin`. */
function landing(origin: HTMLElement | null): { el: HTMLElement; rect: DOMRect } | null {
  let el = origin;
  if (el && !el.isConnected) {
    const key = el.dataset.sheetOrigin;
    el = key ? document.querySelector<HTMLElement>(`[data-sheet-origin="${CSS.escape(key)}"]`) : null;
  }
  const rect = el?.getBoundingClientRect();
  return el && rect && rect.width > 0 && rect.height > 0 ? { el, rect } : null;
}

/** The sheet's transform when it sits shrunk over the control; without one it sits a little smaller in place. */
function parked(sheet: HTMLElement, at: DOMRect | null): string {
  const to = sheet.getBoundingClientRect();
  if (!at) return 'scale(0.92)';
  const scale = Math.min(1, Math.max(0.06, at.width / to.width, at.height / to.height));
  const dx = at.left + at.width / 2 - (to.left + to.width / 2);
  const dy = at.top + at.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Take over from wherever an interrupted animation left the sheet. */
function settle(sheet: HTMLElement) {
  const style = getComputedStyle(sheet);
  const now = { transform: style.transform === 'none' ? 'none' : style.transform, opacity: style.opacity };
  sheet.getAnimations().forEach((animation) => animation.cancel());
  return now;
}

export function openSheet(sheet: HTMLElement, origin: HTMLElement | null, resumed = false) {
  const now = settle(sheet);
  if (reducedMotion()) {
    sheet.animate([{ opacity: resumed ? now.opacity : 0 }, { opacity: 1 }], { duration: 140 });
    return;
  }
  const start = resumed ? now : { transform: parked(sheet, landing(origin)?.rect ?? null), opacity: '0' };
  sheet.animate([
    start,
    { opacity: 1, offset: 0.3 },
    { transform: 'none', opacity: 1 },
  ], { duration: OPEN_MS, easing: EASE_OUT });
}

/** Resolves once the sheet has landed; it stays parked (filled) until the caller closes it. */
export async function closeSheet(sheet: HTMLElement, origin: HTMLElement | null) {
  const now = settle(sheet);
  if (reducedMotion()) {
    await sheet.animate([{ opacity: now.opacity }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).finished.catch(() => {});
    return;
  }
  const at = landing(origin);
  const animation = sheet.animate([
    now,
    { opacity: 1, offset: 0.6 },
    { transform: parked(sheet, at?.rect ?? null), opacity: 0 },
  ], { duration: CLOSE_MS, easing: EASE_IN, fill: 'forwards' });
  try {
    await animation.finished;
  } catch {
    return; // Reopened mid-flight.
  }
  at?.el.animate([{ scale: '1' }, { scale: '1.1' }, { scale: '1' }],
    { duration: 300, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)' });
}
