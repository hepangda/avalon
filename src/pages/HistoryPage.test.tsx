// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { IntlProvider } from 'use-intl';
import { afterEach, expect, it, vi } from 'vitest';
import messages from '../../messages/zh.json';
import type { HistoryGame, HistoryGamesPage, HistoryProfile } from '@/lib/game/historyTypes';
import HistoryPage from './HistoryPage';

vi.mock('@/components/PreferencesButton', () => ({ PreferencesButton: () => null }));
vi.mock('@/lib/auth/useAuthIdentity', () => ({ useAuthIdentity: () => ({ user: { id: 'u', username: 'Arthur' } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.unstubAllGlobals(); });

const profile: HistoryProfile = {
  rating: { score: 1369, ratedGames: 10, title: 'capable', confidence: 'tentative' },
  trend: [1000, 1180, 1290, 1369],
  total: { games: 11, wins: 6 },
  teams: { good: { games: 7, wins: 4 }, evil: { games: 4, wins: 2 } },
  roles: [{ role: 'Merlin', games: 3, wins: 2 }],
  form: [true, false],
};
const game = (gameId: string, seat: HistoryGame['seat'], unrated: HistoryGame['unrated'] = null): HistoryGame => ({
  gameId, endedAt: 1700000000000, playerCount: 5, winner: 'good', reason: 'assassin_missed',
  missions: [true, false, true, true], unrated, seat,
});

it('shows the plate, scores each game and pages the chronicle by scope', async () => {
  let observed: IntersectionObserverCallback | null = null;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { observed = callback; }
    observe() {}
    disconnect() {}
  });
  const pages: Record<string, HistoryGamesPage> = {
    'mine&offset=0': { total: 3, next: 2, games: [
      game('won', { role: 'Merlin', won: true, delta: 42 }),
      game('lost', { role: 'Merlin', won: false, delta: -11 }),
    ] },
    'mine&offset=2': { total: 3, next: null, games: [game('bots', { role: 'Percival', won: true, delta: null }, 'bots')] },
    'all&offset=0': { total: 1, next: null, games: [game('stranger', null)] },
  };
  const fetcher = vi.fn(async (url: string) => {
    const body = url === '/api/history' ? profile : pages[url.split('scope=')[1]!];
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal('fetch', fetcher);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<IntlProvider locale="zh" messages={messages} timeZone="Asia/Shanghai"><MemoryRouter><HistoryPage /></MemoryRouter></IntlProvider>);
    });
    const text = () => container.textContent ?? '';
    expect(text()).toContain('Arthur');
    expect(text()).toContain('1369');
    expect(text()).toContain('应对自如');
    expect(text()).toContain('55%');
    expect(text()).toContain('+42');
    expect(text()).toContain('-11');
    expect(container.querySelector('a[href="/replay/won"]')).not.toBeNull();

    const counts = () => [...container.querySelectorAll('.history-side-count, .history-role-count')].map((c) => c.textContent);
    expect(counts()).toEqual(['4/7', '2/4', '2/3']);
    await act(async () => { (container.querySelector('.history-role') as HTMLButtonElement).click(); });
    expect(counts()).toEqual(['57%', '50%', '67%']);
    await act(async () => { (container.querySelector('.history-side') as HTMLButtonElement).click(); });
    expect(counts()).toEqual(['4/7', '2/4', '2/3']);

    await act(async () => { observed!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
    expect(fetcher).toHaveBeenLastCalledWith('/api/history/games?scope=mine&offset=2', expect.any(Object));
    expect(container.querySelector('a[href="/replay/bots"]')!.textContent).toContain('含机器人');

    const all = [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === '全部复盘') as HTMLButtonElement;
    await act(async () => { all.click(); });
    expect(container.querySelectorAll('.history-game')).toHaveLength(1);
    expect(container.querySelector('a[href="/replay/stranger"]')!.textContent).toContain('蓝方胜利');
  } finally {
    await act(async () => root.unmount());
  }
});

it('shows confirmed attendance without inventing personal outcomes or a win rate', async () => {
  const unknown = { ...game('old-game', null, 'identity'), participationOnly: true };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/history'
    ? { ...profile, total: { games: 0, wins: 0 }, unresolvedGames: 2, roles: [], form: [] }
    : { games: [unknown], total: 2, next: null }))));
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<IntlProvider locale="zh" messages={messages} timeZone="Asia/Shanghai"><MemoryRouter><HistoryPage /></MemoryRouter></IntlProvider>));
    expect(container.textContent).toContain('已确认参赛 · 角色未恢复');
    expect(container.textContent).toContain('含 2 局已确认参赛');
    expect(container.querySelector('.history-record')!.textContent).toContain('—');
    expect(container.querySelector('a[href="/replay/old-game"]')).not.toBeNull();
    expect(container.querySelector('.history-game-score')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
