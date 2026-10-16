// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IntlProvider } from 'use-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../../messages/zh.json';
import { projectStateForViewer, reduce, createRng } from '@/lib/engine';
import { buildStartedGame, FIVE_P } from '@/lib/engine/testkit';
import { EarlyAssassinationVote } from './EarlyAssassinationVote';

let root: Root;
let container: HTMLDivElement;
const vote = vi.fn().mockResolvedValue({ ok: true });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vote.mockClear();
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});
const pending = reduce(buildStartedGame(FIVE_P), { type: 'REQUEST_ASSASSINATION', by: 'p3' }, { now: 1, rng: createRng('vote') });
if (!pending.ok) throw new Error('Expected a pending ballot');
const state = pending.state;
async function render(connected = true, by = 'p4') {
  const game = projectStateForViewer(state, by);
  await act(async () => root.render(<IntlProvider locale="zh" messages={zh}>
    <EarlyAssassinationVote ballot={game.earlyAssassination!} game={game} myPlayerId={by} connected={connected} vote={vote} />
  </IntlProvider>));
}
function button(text: string) {
  return [...document.querySelectorAll('button')].find((el) => el.textContent === text)!;
}

it.each([['同意', 'approve'], ['反对', 'reject']])('submits %s against the visible proposal', async (label, value) => {
  await render();
  expect(document.querySelector('dialog')?.open).toBe(true);
  await act(async () => button(label).click());
  expect(vote).toHaveBeenCalledWith(state.earlyAssassination!.id, value);
});

it('disables voting while disconnected and shows submitted consent after recovery', async () => {
  await render(false);
  expect(button('同意').disabled).toBe(true);
  await render(true);
  expect(button('同意').disabled).toBe(false);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(true, 'p3');
  expect(document.querySelector('dialog')?.open).toBe(false);
  const waiting = state.earlyAssassination!.voterIds.filter((id) => id !== 'p3')
    .map((id) => state.players.find((p) => p.id === id)!.name);
  expect(document.querySelector('[role="status"]')?.textContent).toBe(`等待 ${new Intl.ListFormat('zh').format(waiting)}`);
  expect(button('同意')).toBeUndefined();
  expect(vote).not.toHaveBeenCalled();
});
