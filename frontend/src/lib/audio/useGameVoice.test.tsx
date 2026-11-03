// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectStateForViewer, reduce, createRng, type ClientGameState } from '@/lib/engine';
import { buildStartedGame, FIVE_P, proposeForVote } from '@/lib/engine/testkit';
import { completeMission, completeVotes } from '@/lib/debug/scenarios';
import { useGameVoice } from './useGameVoice';
import { playVoiceSequence, stopVoice } from './engine';
vi.mock('./engine', () => ({ playVoiceSequence: vi.fn(), stopVoice: vi.fn() }));
vi.mock('use-intl', () => ({ useLocale: () => 'en' }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
function Probe({ game, settled, connected }: { game: ClientGameState; settled: boolean; connected: boolean }) {
  useGameVoice(game, settled, connected);
  return null;
}
function render(game: ClientGameState, settled = true, connected = true) {
  root ??= createRoot(document.createElement('div'));
  act(() => root.render(<Probe game={game} settled={settled} connected={connected} />));
}
afterEach(() => { act(() => root.unmount()); root = undefined!; vi.clearAllMocks(); });
const game = () => projectStateForViewer(buildStartedGame(FIVE_P), 'p0');

describe('voice reveal timing', () => {
  it('waits for the visible reveal and ignores timer-only synchronization', () => {
    const before = game();
    render(before);
    expect(playVoiceSequence).not.toHaveBeenCalled();
    const next = { ...before, phase: 'Voting' as const };
    render(next, false);
    expect(playVoiceSequence).not.toHaveBeenCalled();
    render(next);
    expect(playVoiceSequence).toHaveBeenCalledTimes(1);
    expect(vi.mocked(playVoiceSequence).mock.calls[0]?.[0][0]).toMatch(/\/en\/voting-.*\.wav$/);
    vi.mocked(stopVoice).mockClear();
    const timer = { ...next, serverTime: 999 };
    render(timer, false);
    render(timer);
    expect(stopVoice).not.toHaveBeenCalled();
    expect(playVoiceSequence).toHaveBeenCalledTimes(1);
  });
  it('waits through a fast quest and assassination, then speaks only the winner', () => {
    const voting = proposeForVote(buildStartedGame(FIVE_P), { type: 'PROPOSE_TEAM', by: 'p0', team: ['p0', 'p3'] });
    render(projectStateForViewer(voting, 'p0'));
    const mission = completeMission(completeVotes(voting, 'approve'), 0);
    render(projectStateForViewer(mission, 'p0'), false);
    const assassination = reduce(mission, { type: 'START_ASSASSINATION', by: 'p4' }, { now: 2, rng: createRng('voice') });
    if (!assassination.ok) throw new Error('Expected assassination');
    render(projectStateForViewer(assassination.state, 'p0'), false);
    const end = reduce(assassination.state, { type: 'ASSASSINATE', by: 'p4', target: 'p0' }, { now: 3, rng: createRng('voice') });
    if (!end.ok) throw new Error('Expected game over');
    const final = projectStateForViewer(end.state, 'p0');
    render(final, false);
    expect(playVoiceSequence).not.toHaveBeenCalled();
    render(final);
    expect(playVoiceSequence).toHaveBeenCalledTimes(1);
    expect(vi.mocked(playVoiceSequence).mock.calls[0]?.[0]).toEqual([expect.stringMatching(/evilWins-.*\.wav$/)]);
    render({ ...final, serverTime: 999 });
    expect(playVoiceSequence).toHaveBeenCalledTimes(1);
  });
  it('silences reconnect snapshots and cancels on rollback', () => {
    const before = game();
    render(before);
    const next = { ...before, phase: 'Voting' as const };
    render(next, true, false);
    render(next);
    expect(playVoiceSequence).not.toHaveBeenCalled();
    render({ ...before, phaseRevision: 1 });
    expect(stopVoice).toHaveBeenCalled();
    expect(playVoiceSequence).not.toHaveBeenCalled();
  });
});
