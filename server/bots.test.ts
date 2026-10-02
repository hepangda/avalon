import { describe, expect, it } from 'vitest';
import { createGame, isEvil, missionSize, projectStateForViewer, type ActionTimer } from '@/lib/engine';
import { buildStartedGame, FIVE_P } from '@/lib/engine/testkit';
import { DEFAULT_ROOM_CONFIG } from './room-helpers';
import { botAction, decideBot } from './bots';

function game(count = 5) {
  const result = createGame({ hostId: 'p0', players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}` })), options: DEFAULT_ROOM_CONFIG.options, seed: 'bots' });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}
const timer = (action: ActionTimer['action'], playerId = 'p0'): ActionTimer => ({ action, playerId, startedAt: 0, durationMs: 20_000 });

describe('bot decisions', () => {
  it('fills exactly the legal team size without duplicates', () => {
    for (let count = 5; count <= 10; count++) {
      const state = game(count);
      for (let round = 0; round < 5; round++) {
        state.roundIndex = round;
        for (const action of ['propose', 'finalize'] as const) {
          const event = botAction(state, timer(action), `${count}:${round}`);
          if (event.type !== 'PROPOSE_TEAM' && event.type !== 'FINALIZE_TEAM') throw new Error('Wrong action');
          if (!isEvil(state.players[0]!.role)) expect(event.team).toContain('p0');
          expect(new Set(event.team).size).toBe(missionSize(count, round));
          expect(event.team).toHaveLength(missionSize(count, round));
        }
      }
    }
  });

  it('always plays success for every good role', () => {
    const state = game();
    state.proposedTeam = ['p0', 'p1'];
    for (const role of ['Merlin', 'Percival', 'LoyalServant'] as const) {
      state.players[0]!.role = role;
      expect(botAction(state, timer('mission'), role)).toEqual({ type: 'CAST_MISSION_CARD', by: 'p0', card: 'success' });
    }
  });

  it('never uses hidden identities or individual mission cards to choose a team', () => {
    const state = game();
    state.players[0]!.role = 'LoyalServant';
    state.players[1]!.role = 'Merlin';
    state.players[2]!.role = 'Assassin';
    const before = botAction(state, timer('propose'), 'privacy');
    state.players[1]!.role = 'Assassin';
    state.players[2]!.role = 'Merlin';
    state.missionCards = { p1: 'fail' };
    expect(botAction(state, timer('propose'), 'privacy')).toEqual(before);
  });

  it('Merlin avoids visible evil but cannot distinguish hidden Mordred', () => {
    const state = game();
    state.players.forEach((p) => { p.role = 'LoyalServant'; });
    state.players[0]!.role = 'Merlin';
    state.players[1]!.role = 'Assassin';
    state.players[2]!.role = 'Morgana';
    for (let i = 0; i < 20; i++) {
      const event = botAction(state, timer('propose'), String(i));
      expect(event).toMatchObject({ type: 'PROPOSE_TEAM' });
      if (event.type === 'PROPOSE_TEAM') {
        expect(event.team).not.toContain('p1');
        expect(event.team).not.toContain('p2');
      }
    }
    state.players[1]!.role = 'Mordred';
    const before = botAction(state, timer('propose'), 'mordred');
    state.players[1]!.role = 'LoyalServant';
    expect(botAction(state, timer('propose'), 'mordred')).toEqual(before);
  });

  it('uses public failed missions to avoid suspicious teams', () => {
    const state = game();
    state.players[0]!.role = 'LoyalServant';
    state.roundIndex = 1;
    state.missionResults = [{ roundIndex: 0, teamSize: 2, team: ['p0', 'p1'], success: false, failCount: 1, cards: { p0: 'success', p1: 'fail' } }];
    state.voteHistory = [{ roundIndex: 0, proposalIndex: 0, leaderId: 'p0', team: ['p0', 'p1'], votes: {}, approved: true }];
    const event = botAction(state, timer('propose'), 'history');
    if (event.type !== 'PROPOSE_TEAM') throw new Error('Wrong action');
    expect(event.team).not.toContain('p1');
  });

  it('coordinates two fail cards when the mission requires them', () => {
    const state = game(7);
    state.roundIndex = 3;
    state.players[0]!.role = 'Assassin';
    state.players[1]!.role = 'Morgana';
    state.proposedTeam = ['p0', 'p1', 'p2', 'p3'];
    expect(botAction(state, timer('mission'), 'two')).toMatchObject({ card: 'fail' });
    expect(botAction(state, timer('mission', 'p1'), 'two')).toMatchObject({ card: 'fail' });
  });

  it('good approves the last chance while evil rejects it', () => {
    const state = game();
    state.rejectionCount = 4;
    state.proposedTeam = ['p1', 'p2'];
    state.players[0]!.role = 'LoyalServant';
    expect(botAction(state, timer('vote'), 'last')).toMatchObject({ value: 'approve' });
    state.players[0]!.role = 'Assassin';
    expect(botAction(state, timer('vote'), 'last')).toMatchObject({ value: 'reject' });
  });

  it('known evil teammates avoid redundant fail cards', () => {
    const state = game();
    state.players[0]!.role = 'Assassin';
    state.players[1]!.role = 'Morgana';
    state.proposedTeam = ['p0', 'p1'];
    expect(botAction(state, timer('mission'), 'mission')).toMatchObject({ card: 'fail' });
    expect(botAction(state, timer('mission', 'p1'), 'mission')).toMatchObject({ card: 'success' });
  });

  it('accepts a reasonable off-team proposal before hammer as rejections accumulate', () => {
    const state = game(6);
    state.players[0]!.role = 'LoyalServant';
    state.roundIndex = 1;
    state.proposedTeam = ['p1', 'p2', 'p3'];
    expect(botAction(state, timer('vote'), 'compromise')).toMatchObject({ value: 'reject' });
    state.rejectionCount = 2;
    expect(botAction(state, timer('vote'), 'compromise')).toMatchObject({ value: 'approve' });
  });

  it('does not relax a veto on a known dangerous team before hammer', () => {
    const state = game();
    state.players[0]!.role = 'Merlin';
    state.players[1]!.role = 'Assassin';
    state.proposedTeam = ['p0', 'p1'];
    state.rejectionCount = 3;
    expect(botAction(state, timer('vote'), 'known-danger')).toMatchObject({ value: 'reject' });
  });

  it('rejects an unsupported off-team proposal instead of randomly approving it', () => {
    const state = game();
    state.players[0]!.role = 'LoyalServant';
    state.proposedTeam = ['p1', 'p2'];
    expect(botAction(state, timer('vote'), 'off-team')).toMatchObject({ value: 'reject' });
    state.proposedTeam = ['p0', 'p2'];
    expect(botAction(state, timer('vote'), 'own-team')).toMatchObject({ value: 'approve' });
  });

  it('strictly reserves failures for designated red roles, regardless of seed, urgency or submissions', () => {
    const state = buildStartedGame(['Merlin', 'Percival', 'LoyalServant', 'LoyalServant', 'LoyalServant', 'LoyalServant', 'Assassin', 'Morgana', 'Mordred', 'Oberon']);
    state.missionResults = [0, 1].map((roundIndex) => ({ roundIndex, teamSize: 3, team: ['p0', 'p1', 'p2'], success: true, failCount: 0, cards: {} }));
    state.players.reverse(); // ordering follows seat numbers, not array order
    for (const round of [2, 3]) {
      state.roundIndex = round;
      state.proposedTeam = ['p9', 'p8', 'p7', 'p6', 'p0'];
      for (let i = 0; i < 30; i++) {
        state.missionCards = { p6: i % 2 ? 'success' : 'fail' };
        expect(botAction(state, timer('mission', 'p6'), String(i))).toMatchObject({ card: 'fail' });
        expect(botAction(state, timer('mission', 'p7'), String(i))).toMatchObject({ card: round === 3 ? 'fail' : 'success' });
        expect(botAction(state, timer('mission', 'p8'), String(i))).toMatchObject({ card: 'success' });
        expect(botAction(state, timer('mission', 'p9'), String(i))).toMatchObject({ card: 'fail' });
      }
    }
  });

  it('uses Assassin > Minion > Morgana > Mordred even when seats run in reverse order', () => {
    const state = buildStartedGame(['Merlin', 'Percival', 'LoyalServant', 'LoyalServant', 'LoyalServant', 'LoyalServant', 'Mordred', 'Morgana', 'Minion', 'Assassin']);
    state.missionResults = [0, 1].map((roundIndex) => ({ roundIndex, teamSize: 3, team: ['p0', 'p1', 'p2'], success: true, failCount: 0, cards: {} }));
    for (const round of [2, 3]) {
      state.roundIndex = round;
      for (const redTeam of [['p6', 'p7', 'p8', 'p9'], ['p6', 'p7', 'p8'], ['p6', 'p7']]) {
        state.proposedTeam = [...redTeam, 'p0'];
        const ordered = [...redTeam].reverse();
        for (const id of redTeam) {
          expect(botAction(state, timer('mission', id), 'priority')).toMatchObject({
            card: ordered.indexOf(id) < (round === 3 ? 2 : 1) ? 'fail' : 'success',
          });
        }
      }
    }
  });

  it('breaks ties between Minions by seat and never lets an extra Minion fail', () => {
    const state = buildStartedGame(['Merlin', 'LoyalServant', 'LoyalServant', 'LoyalServant', 'LoyalServant', 'LoyalServant', 'Minion', 'Assassin', 'Minion', 'Minion']);
    state.roundIndex = 3;
    state.proposedTeam = ['p9', 'p8', 'p7', 'p6', 'p0'];
    state.missionResults = [0, 1].map((roundIndex) => ({ roundIndex, teamSize: 3, team: ['p0', 'p1', 'p2'], success: true, failCount: 0, cards: {} }));
    expect(botAction(state, timer('mission', 'p7'), 'ties')).toMatchObject({ card: 'fail' });
    expect(botAction(state, timer('mission', 'p6'), 'ties')).toMatchObject({ card: 'fail' });
    expect(botAction(state, timer('mission', 'p8'), 'ties')).toMatchObject({ card: 'success' });
    expect(botAction(state, timer('mission', 'p9'), 'ties')).toMatchObject({ card: 'success' });
  });

  it('allows only the designated red to hide while Oberon always sabotages', () => {
    const state = buildStartedGame(['Merlin', 'Percival', 'LoyalServant', 'LoyalServant', 'Assassin', 'Morgana', 'Oberon']);
    state.proposedTeam = ['p4', 'p5'];
    const choices = new Set<string>();
    for (let revision = 0; revision < 60; revision++) {
      state.roleRevision = revision;
      const first = botAction(state, timer('mission', 'p4'), String(revision));
      if (first.type === 'CAST_MISSION_CARD') choices.add(first.card);
      expect(botAction(state, timer('mission', 'p5'), String(revision))).toMatchObject({ card: 'success' });
      state.proposedTeam = ['p4', 'p6'];
      expect(botAction(state, timer('mission', 'p6'), String(revision))).toMatchObject({ card: 'fail' });
      state.proposedTeam = ['p4', 'p5'];
    }
    expect(choices).toEqual(new Set(['success', 'fail']));
  });

  it('does not expose a lone red on a double-fail mission that cannot be sabotaged', () => {
    const state = buildStartedGame(['Merlin', 'Percival', 'LoyalServant', 'LoyalServant', 'Assassin', 'Morgana', 'Mordred']);
    state.roundIndex = 3;
    state.proposedTeam = ['p0', 'p1', 'p2', 'p4'];
    expect(botAction(state, timer('mission', 'p4'), 'impossible')).toMatchObject({ card: 'success' });
  });

  it('keeps a sound announced draft and offers different equally rational opening teams', () => {
    const state = buildStartedGame(FIVE_P);
    const choices = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const proposal = botAction(state, timer('propose', 'p2'), String(i));
      if (proposal.type !== 'PROPOSE_TEAM') throw new Error('Wrong action');
      choices.add([...proposal.team].sort().join(','));
      state.proposedTeam = proposal.team;
      expect(botAction(state, timer('finalize', 'p2'), `final:${i}`)).toMatchObject({ team: proposal.team });
    }
    expect(choices.size).toBeGreaterThan(1);
  });

  it('respects configurable rejection limits and does not mutate its input', () => {
    const state = buildStartedGame(FIVE_P, { maxRejections: 2 });
    state.rejectionCount = 1; state.proposedTeam = ['p3', 'p4'];
    const before = structuredClone(state);
    expect(botAction(state, timer('vote', 'p2'), 'limit')).toMatchObject({ value: 'approve' });
    expect(botAction(state, timer('vote', 'p3'), 'limit')).toMatchObject({ value: 'reject' });
    expect(state).toEqual(before);
  });

  it('cannot use secret current votes/cards, another Lady result, or the dealing seed', () => {
    const state = buildStartedGame(FIVE_P);
    state.proposedTeam = ['p1', 'p2'];
    for (const action of ['propose', 'finalize', 'vote', 'mission', 'lady'] as const) {
      const before = botAction(state, timer(action, 'p2'), 'information-boundary');
      const hidden = structuredClone(state);
      hidden.seed = 'a-different-deal';
      hidden.players[0]!.role = 'Assassin'; hidden.players[4]!.role = 'Merlin';
      hidden.votes = { p0: 'reject', p1: 'approve' };
      hidden.missionCards = { p1: 'fail' };
      hidden.lastLadyResult = { holderId: 'p0', targetId: 'p4', loyalty: 'good' };
      expect(botAction(hidden, timer(action, 'p2'), 'information-boundary')).toEqual(before);
    }
  });

  it('provides reproducible private diagnostics without requiring authoritative state', () => {
    const state = buildStartedGame(FIVE_P);
    const view = projectStateForViewer(state, 'p2');
    const decision = decideBot(view, 'p2', 'propose', 'explain');
    expect(decision).toEqual(decideBot(structuredClone(view), 'p2', 'propose', 'explain'));
    expect(decision.consistent).toBe(true);
    expect(decision.hypotheses).toBe(6);
    expect(decision.alternatives!.length).toBeGreaterThan(1);
  });
});
