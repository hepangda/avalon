// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminPanel } from './AdminPanel';
import { adminActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { buildStartedGame, FIVE_P } from '@/lib/engine/testkit';
import { projectStateForViewer } from '@/lib/engine';

// Animation rendering is outside this interaction test; retain real buttons and refs.
vi.mock('framer-motion', () => {
  const cache = new Map<string, (props: Record<string, unknown>) => ReactNode>();
  return {
    useReducedMotion: () => true,
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: (_, tag: string) => {
      if (!cache.has(tag)) cache.set(tag, (props) => createElement(tag,
        Object.fromEntries(Object.entries(props).filter(([key]) =>
          !['initial', 'animate', 'exit', 'transition', 'variants', 'custom', 'layout'].includes(key)))));
      return cache.get(tag);
    } }),
  };
});
vi.mock('use-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/socket/client', () => ({ adminActions: {
  auth: vi.fn().mockResolvedValue({ ok: true, data: { ok: true } }),
  setTimersPaused: vi.fn().mockResolvedValue({ ok: true }),
} }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useRoomStore.setState({ isReferee: false });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function button(label: string) {
  const found = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim().startsWith(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
it('enables directly, but requires confirmation before pausing timers', async () => {
  const game = projectStateForViewer(buildStartedGame(FIVE_P), 'p0');
  game.actionTimers = [{ playerId: 'p0', action: 'propose', startedAt: 0, durationMs: 20_000 }];
  await act(async () => root.render(<AdminPanel game={game} />));
  await act(async () => button('admin.open').click());
  expect(adminActions.auth).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain('admin.ask.enable');
  // Use a fresh mount to avoid waiting for the cosmetic close/open animation.
  await act(async () => root.render(null));
  useRoomStore.setState({ isReferee: true });
  await act(async () => root.render(<AdminPanel game={game} />));
  await act(async () => button('admin.pauseTimer').click());
  expect(adminActions.setTimersPaused).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('admin.ask.pauseTimer');
  await act(async () => button('common.confirm').click());
  expect(adminActions.setTimersPaused).toHaveBeenCalledExactlyOnceWith(true);
});
