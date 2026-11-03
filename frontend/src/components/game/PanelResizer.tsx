import { useRef, type RefObject } from 'react';
import { useTranslations } from 'use-intl';
import { clampPanelWidth, PANEL_MIN_WIDTH } from './useSidePanel';

/** The table keeps at least this much room however wide its panels are dragged. */
const TABLE_MIN_WIDTH = 520;
const KEY_STEP = 24;

/**
 * The grip on a side panel's inner edge. Dragging it toward the table widens the
 * panel; the width is written straight onto the panel while dragging and kept on release.
 */
export function PanelResizer({ panel, width, onCommit }: {
  panel: RefObject<HTMLElement | null>;
  width: number;
  onCommit: (width: number) => void;
}) {
  const t = useTranslations();
  const drag = useRef<{ x: number; width: number; max: number; current: number } | null>(null);

  /** How wide the panel may grow while leaving the table its room. */
  function maxWidth() {
    const workspace = panel.current?.parentElement;
    return workspace ? workspace.getBoundingClientRect().width - TABLE_MIN_WIDTH : width;
  }
  function preview(next: number) {
    panel.current?.style.setProperty('--side-width', `${next}px`);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('table.resizePanel')}
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={clampPanelWidth(Infinity)}
      aria-valuenow={width}
      tabIndex={0}
      className="table-side-resizer"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        // A table already squeezed below its room never pushes the panel narrower than it is.
        drag.current = { x: event.clientX, width, max: Math.max(maxWidth(), width), current: width };
        panel.current?.setAttribute('data-resizing', '');
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        state.current = clampPanelWidth(state.width + state.x - event.clientX, state.max);
        preview(state.current);
      }}
      onPointerUp={(event) => {
        const state = drag.current;
        if (!state) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        panel.current?.removeAttribute('data-resizing');
        onCommit(state.current);
      }}
      onPointerCancel={() => {
        drag.current = null;
        panel.current?.removeAttribute('data-resizing');
        preview(width);
      }}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowLeft' ? KEY_STEP : event.key === 'ArrowRight' ? -KEY_STEP : 0;
        if (!step) return;
        event.preventDefault();
        onCommit(clampPanelWidth(width + step, Math.max(maxWidth(), width)));
      }}
    />
  );
}
