export type BottomDockView = 'log' | 'functions' | 'voice';

export const BOTTOM_DOCK_VIEW_EVENT = 'avalon:bottom-dock-view';

export function announceBottomDockView(view: BottomDockView): void {
  window.dispatchEvent(
    new CustomEvent<BottomDockView>(BOTTOM_DOCK_VIEW_EVENT, { detail: view }),
  );
}
