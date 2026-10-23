import { useRef, type MouseEvent, type PointerEvent } from 'react';

const HOLD_MS = 450;

/**
 * Right-click, or a touch held still on a portrait, opens that seat's menu.
 * `held` reports (once) whether the click ending a press belongs to the hold.
 */
export function useSeatHold(touchOnly: boolean) {
  const press = useRef<{ timer?: ReturnType<typeof setTimeout>; held: boolean; id?: string; x?: number; y?: number }>({ held: false });
  const release = () => clearTimeout(press.current.timer);
  const handlers = <T extends HTMLElement>(id: string, open: (target: T) => void) => ({
    onPointerDown: (event: PointerEvent<T>) => {
      release();
      press.current = { held: false, id };
      // A mouse has its right button; only touch and pens hold.
      if (touchOnly && event.pointerType === 'mouse') return;
      const target = event.currentTarget;
      press.current = { held: false, id, x: event.clientX, y: event.clientY,
        timer: setTimeout(() => { press.current.held = true; open(target); }, HOLD_MS) };
    },
    onPointerMove: (event: PointerEvent<T>) => {
      const { x, y } = press.current;
      if (x !== undefined && y !== undefined && Math.hypot(event.clientX - x, event.clientY - y) > 8) release();
    },
    onPointerUp: release,
    onPointerLeave: release,
    onPointerCancel: release,
    onContextMenu: (event: MouseEvent<T>) => {
      event.preventDefault();
      // A touch hold may raise the context menu too, after it has already opened.
      if (!press.current.held || press.current.id !== id) open(event.currentTarget);
    },
  });
  const held = (id: string) => {
    if (!press.current.held || press.current.id !== id) return false;
    press.current.held = false;
    return true;
  };
  return { handlers, held };
}
