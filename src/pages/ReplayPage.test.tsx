// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { IntlProvider } from 'use-intl';
import { afterEach, expect, it, vi } from 'vitest';
import messages from '../../messages/zh.json';
import type { ReplayView } from '@/lib/game/replayTypes';
import ReplayPage from './ReplayPage';

vi.mock('@/components/PreferencesButton', () => ({ PreferencesButton: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.unstubAllGlobals(); });

const roles = ['Merlin', 'Assassin', 'LoyalServant', 'Morgana', 'Percival'] as const;
const view: ReplayView = {
  viewerId: 'p2',
  replay: {
    gameId: 'g',
    outcome: { winner: 'evil', reason: 'assassinated_merlin', missionTally: { good: 3, evil: 0 }, revealedRoles: [] },
    players: roles.map((_, i) => ({ id: `p${i}`, name: `P${i}`, seat: i })),
    roleAssignments: roles.map((role, i) => ({ playerId: `p${i}`, role })),
    rounds: [{
      roundIndex: 0, leaderPlayerId: 'p3', teamSize: 2, finalTeam: ['p0', 'p1'], approved: true,
      missionSuccess: false, failCount: 1,
      votes: ['p0', 'p1', 'p2', 'p3', 'p4'].map((playerId, i) => ({ proposalIndex: 0, playerId, value: i < 3 ? 'approve' as const : 'reject' as const })),
      proposals: [{ proposalIndex: 0, leaderPlayerId: 'p3', team: ['p0', 'p1'], approved: true }],
      missionCards: [{ playerId: 'p0', card: 'success' }, { playerId: 'p1', card: 'fail' }],
    }],
    ladyChecks: [],
    assassination: { assassinPlayerId: 'p1', targetPlayerId: 'p0', hitMerlin: true },
  },
};

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

it('plays the game back beat by beat on the table, from above or from one seat', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(view))));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const text = () => container.textContent ?? '';
  const click = (selector: string) => act(async () => { container.querySelector<HTMLElement>(selector)!.click(); });
  try {
    await act(async () => {
      root.render(
        <IntlProvider locale="zh" messages={messages} timeZone="Asia/Shanghai">
          <MemoryRouter initialEntries={['/replay/g']}>
            <Routes><Route path="/replay/:gameId" element={<><ReplayPage /><Search /></>} /></Routes>
          </MemoryRouter>
        </IntlProvider>,
      );
    });
    expect(text()).toContain('身份揭晓');
    expect(text()).toContain('1 / 5');

    await click('[aria-label="下一步"]');
    expect(container.querySelector('[data-testid="search"]')!.textContent).toBe('?step=v0%3A0');
    expect(text()).toContain('提名通过');

    await click('[aria-label="下一步"]');
    expect(text()).toContain('任务失败');
    expect(container.querySelectorAll('.table-card-front.is-negative')).toHaveLength(1);

    // Through the loyal servant's eyes the quest cards stay face down.
    await click('[aria-label="3. P2 · 你"]');
    expect(container.querySelector('.replay-viewpoint')!.textContent).toContain('3. P2');
    expect(container.querySelectorAll('.table-card-front.is-negative')).toHaveLength(0);

    await click('.replay-notch[data-kind="end"]');
    expect(text()).toContain('红方胜利');
    expect(text()).toContain('梅林被刺杀');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
