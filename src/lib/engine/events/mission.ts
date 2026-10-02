import {
  allCardsIn,
  assassinInPlay,
  currentRequiredFails,
  evilWins,
  goodWins,
  ladyDue,
  nextLeaderIndex,
  playerById
} from '../fsm';
import { isGood, teamOf } from '../roles';
import type {
  Effect,
  EngineResult,
  GameState,
  MissionCard,
  PlayerId
} from '../types';
import { buildOutcome } from './ending';
import { logRoundStart, pushPrivate, pushPublic } from './log';
import { clone, err, ok } from './result';

// ---------------------------------------------------------------------------
// CAST_MISSION_CARD → (all in) MissionResult → route
// ---------------------------------------------------------------------------

export function castMissionCard(s: GameState, by: PlayerId, card: MissionCard): EngineResult {
  if (s.phase !== 'MissionVote') return err('WRONG_PHASE', 'Not in MissionVote');
  if (!s.proposedTeam || !s.proposedTeam.includes(by)) {
    return err('NOT_ON_TEAM', 'Player is not on the mission team');
  }
  if (s.missionCards[by] !== undefined) return err('ALREADY_PLAYED_CARD', 'Already played a card');

  const player = playerById(s, by)!;
  if (card === 'fail' && isGood(player.role)) {
    return err('GOOD_CANNOT_FAIL', 'Blue team players must play success');
  }

  const next = clone(s);
  next.missionCards[by] = card;
  pushPrivate(next, by, card === 'fail' ? 'youPlayedFail' : 'youPlayedSuccess', {
    round: String(next.roundIndex + 1),
  });

  if (!allCardsIn(next)) return ok(next);

  // Tally.
  const team = next.proposedTeam!;
  const failCount = team.filter((id) => next.missionCards[id] === 'fail').length;
  const success = failCount < currentRequiredFails(next);
  // Snapshot the per-player cards onto the outcome before clearing, so the
  // persistence layer can record them (cards are never projected to clients
  // except in post-game replay).
  const cards: Record<PlayerId, MissionCard> = {};
  for (const id of team) cards[id] = next.missionCards[id]!;
  next.missionResults.push({
    roundIndex: next.roundIndex,
    teamSize: team.length,
    team: [...team],
    success,
    failCount,
    cards,
  });
  next.phase = 'MissionResult';
  next.missionCards = {};
  pushPublic(next, success ? 'missionSucceeded' : 'missionFailed', {
    round: String(next.roundIndex + 1),
    fails: String(failCount),
  });

  const effects: Effect[] = [{ kind: 'PERSIST_CHECKPOINT', checkpoint: 'mission_result' }];
  return routeAfterResult(next, effects);
}

// ---------------------------------------------------------------------------
// Routing after a mission result (T10–T14)
// ---------------------------------------------------------------------------

export function routeAfterResult(next: GameState, effects: Effect[]): EngineResult {
  // Evil's 3rd fail ends immediately, even if Lady would otherwise trigger.
  if (evilWins(next) >= 3) {
    next.phase = 'GameOver';
    pushPublic(next, 'evilWinsMissions');
    next.outcome = buildOutcome(next, 'evil', 'three_missions');
    return ok(next, [...effects, { kind: 'PERSIST_CHECKPOINT', checkpoint: 'game_over' }]);
  }

  if (goodWins(next) >= 3) {
    if (assassinInPlay(next)) {
      next.phase = 'Assassination';
      pushPublic(next, 'goodWinsMissionsAssassin');
      return ok(next, effects);
    }
    next.phase = 'GameOver';
    pushPublic(next, 'goodWinsMissions');
    next.outcome = buildOutcome(next, 'good', 'three_missions');
    return ok(next, [...effects, { kind: 'PERSIST_CHECKPOINT', checkpoint: 'game_over' }]);
  }

  // Game continues.
  if (ladyDue(next)) {
    next.phase = 'LadyOfLake';
    next.pendingLady = true;
    pushPublic(next, 'ladyBegins', { holder: next.ladyHolderId ?? '' });
    return ok(next, effects);
  }

  advanceToNextRound(next);
  return ok(next, effects);
}

export function advanceToNextRound(next: GameState): void {
  next.roundIndex += 1;
  next.leaderIndex = nextLeaderIndex(next);
  next.rejectionCount = 0;
  next.proposedTeam = null;
  next.votes = {};
  next.phase = 'TeamBuilding';
  logRoundStart(next);
}

// ---------------------------------------------------------------------------
// USE_LADY → reveal loyalty to holder, pass token, next round
// ---------------------------------------------------------------------------

export function applyLadyOfLake(s: GameState, by: PlayerId, target: PlayerId): EngineResult {
  if (s.phase !== 'LadyOfLake') return err('WRONG_PHASE', 'Not in LadyOfLake');
  if (s.ladyHolderId !== by) return err('NOT_LADY_HOLDER', 'Only the Lady holder may inspect');
  if (target === by) return err('LADY_TARGET_SELF', 'Cannot inspect yourself');
  if (s.ladyInspectedIds.includes(target)) {
    return err('LADY_TARGET_INSPECTED', 'Target already inspected');
  }
  const targetPlayer = playerById(s, target);
  if (!targetPlayer) return err('INVALID_TEAM_MEMBER', `Unknown target ${target}`);

  const next = clone(s);
  const loyalty = teamOf(targetPlayer.role);

  next.ladyInspectedIds.push(by); // current holder can't be re-inspected later
  next.lastLadyResult = { holderId: by, targetId: target, loyalty };
  next.ladyHolderId = target;
  next.pendingLady = false;
  pushPublic(next, 'ladyInspected', { holder: by, target });
  pushPrivate(next, by, loyalty === 'evil' ? 'ladyResultEvil' : 'ladyResultGood', { target });

  advanceToNextRound(next);

  return ok(next, [
    { kind: 'PERSIST_CHECKPOINT', checkpoint: 'lady' },
    { kind: 'PRIVATE_LADY', holderId: by, targetId: target, loyalty },
  ]);
}
