// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildScenario } from '@/lib/debug/scenarios';
import { projectStateForViewer, type ClientGameState } from '@/lib/engine';
import { useLadyResult } from './useLadyResult';

let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useLadyResult>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

const scene = buildScenario('ladyGood', 7);
const holder = scene.viewerId;
const inspected = { ...projectStateForViewer(scene.nextState ?? scene.state, holder), gameId: 'game-1' };

function Probe({ game }: { game: ClientGameState }) {
  latest = useLadyResult(game, holder);
  return null;
}
async function mount(game: ClientGameState) {
  await act(async () => root.render(<Probe game={game} />));
}
async function remount(game: ClientGameState) {
  await act(async () => root.unmount());
  root = createRoot(container);
  await mount(game);
}

it('shows the inspection result until the holder dismisses it', async () => {
  await mount(inspected);
  expect(latest.unseen).toEqual(inspected.privateLadyResult);
  await act(async () => latest.markSeen());
  expect(latest.unseen).toBeNull();
});

it('does not replay a dismissed result after a refresh, a reconnect or a referee step', async () => {
  await mount(inspected);
  await act(async () => latest.markSeen());
  await remount(inspected);
  expect(latest.unseen).toBeNull();
  await mount({ ...inspected, phaseRevision: (inspected.phaseRevision ?? 0) + 1 });
  expect(latest.unseen).toBeNull();
});

it('still shows a result that was never dismissed after a refresh', async () => {
  await mount(inspected);
  await remount(inspected);
  expect(latest.unseen).toEqual(inspected.privateLadyResult);
});

it('never shows over the ending', async () => {
  await mount({ ...inspected, phase: 'GameOver' });
  expect(latest.unseen).toBeNull();
});
