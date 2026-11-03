import { describe, expect, it } from 'vitest';
import { projectStateForViewer, type ClientGameState, type GameState } from '@/lib/engine';
import { buildStartedGame, FIVE_P } from '@/lib/engine/testkit';
import { applyEvent, completeMission, completeVotes, propose } from '@/lib/debug/scenarios';
import { beatSnapshot, phaseBeats } from './phaseBeats';

const view = (s: GameState): ClientGameState => ({ ...projectStateForViewer(s, 'p1'), gameId: 'g1' });
function step(from: GameState, to: GameState, held = false) {
  const previous = view(from);
  const next = view(to);
  return phaseBeats(beatSnapshot(previous, held), beatSnapshot(next, false), next);
}
const kinds = (beats: ReturnType<typeof step>) => beats.map((beat) => beat.kind);

describe('phase beats between settled tables', () => {
  const start = buildStartedGame(FIVE_P);

  it('opens the first quest when the viewer first sees the table', () => {
    expect(step(start, start, true)).toEqual([{ kind: 'round', roundIndex: 0, size: 2, needsTwo: false }]);
    expect(step(start, start)).toEqual([]);
  });

  it('brings a named team in from the seats, and opens ballots from the leader around', () => {
    const voting = propose(start);
    const team = voting.proposedTeam!;
    const announced = applyEvent(start, { type: 'PROPOSE_TEAM', by: 'p0', team });
    expect(step(start, announced)).toEqual([{ kind: 'team', team }]);
    expect(voting.phase).toBe('Voting');
    const beats = step(announced, voting);
    expect(kinds(beats)).toEqual(['ballots']);
    expect(beats[0]).toEqual({ kind: 'ballots', order: ['p0', 'p1', 'p2', 'p3', 'p4'] });
  });

  it('passes the crown after a rejection and sends the team off after approval', () => {
    const voting = propose(start);
    const rejected = completeVotes(voting, 'reject');
    expect(step(voting, rejected)).toEqual([{ kind: 'crown', from: 'p0', to: 'p1' }]);
    const approved = completeVotes(voting, 'approve');
    expect(approved.phase).toBe('MissionVote');
    expect(step(voting, approved)).toEqual([{ kind: 'quest', order: approved.proposedTeam }]);
  });

  it('opens the next quest and moves the crown together', () => {
    const missionVote = completeVotes(propose(start), 'approve');
    const next = completeMission(missionVote, 0);
    expect(next.roundIndex).toBe(1);
    expect(step(missionVote, next)).toEqual([
      { kind: 'round', roundIndex: 1, size: 3, needsTwo: false },
      { kind: 'crown', from: 'p0', to: 'p1' },
    ]);
  });

  it('marks quests that need two fails', () => {
    const seven = buildStartedGame(['Merlin', 'Percival', 'LoyalServant', 'LoyalServant', 'Morgana', 'Assassin', 'Oberon']);
    const second = completeMission(completeVotes(propose(seven), 'approve'), 1);
    const third = completeMission(completeVotes(propose(second), 'approve'), 0);
    expect(third.roundIndex).toBe(2);
    const fourth = completeMission(completeVotes(propose(third), 'approve'), 0);
    expect(step(third, fourth)[0]).toMatchObject({ kind: 'round', roundIndex: 3, needsTwo: true });
  });

  it('plays nothing across a rollback, another game or the ending', () => {
    const voting = propose(start);
    expect(step(voting, { ...start, phaseRevision: 2 })).toEqual([]);
    const other = { ...view(voting), gameId: 'g2' };
    expect(phaseBeats(beatSnapshot(view(start), false), beatSnapshot(other, false), other)).toEqual([]);
    expect(step(voting, { ...completeVotes(voting, 'approve'), phase: 'GameOver' })).toEqual([]);
  });
});
