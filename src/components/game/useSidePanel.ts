import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

type PanelState = { open: boolean; width: number };

/** Matches the `@container match (min-width: 1080px)` rules in table-layout.css. */
const WIDE_TABLE = 1080;
export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_WIDTH = 640;

export const clampPanelWidth = (width: number, max = PANEL_MAX_WIDTH) =>
  Math.round(Math.min(Math.max(width, PANEL_MIN_WIDTH), Math.max(PANEL_MIN_WIDTH, max)));

function readPanel(key: string, defaults: PanelState): PanelState {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Partial<PanelState> | null;
    return {
      open: typeof saved?.open === 'boolean' ? saved.open : defaults.open,
      width: typeof saved?.width === 'number' ? clampPanelWidth(saved.width) : defaults.width,
    };
  } catch {
    return defaults;
  }
}

/** Whether the table is wide enough to keep its panels beside it rather than over it. */
export function useWideTable(ref: RefObject<HTMLElement | null>) {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured before the first paint, so a wide table never shows its narrow layout.
    const style = getComputedStyle(el);
    setWide(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >= WIDE_TABLE);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= WIDE_TABLE);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return wide;
}

/** Whether a wide table shows a side panel beside it, and how wide, remembered on this device under `key`. */
export function useSidePanel(key: string, defaults: PanelState) {
  const [panel, setPanel] = useState(() => readPanel(key, defaults));
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(panel));
    } catch {
      /* Storage may be unavailable; the layout still works for this visit. */
    }
  }, [key, panel]);
  const setOpen = useCallback((open: boolean) => setPanel((current) => ({ ...current, open })), []);
  const setWidth = useCallback((width: number) => setPanel((current) => ({ ...current, width })), []);
  return { ...panel, setOpen, setWidth };
}

/** True once the page has laid out, so panels slide when toggled but never on first paint. */
export function useSettled() {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);
  return settled;
}
