import type { ReplayMissionView, ReplayModel, ReplayProposalView } from './replayModel';
import { knownRoleNotes, type RoleNotes } from './roleNotes';
import type { ReplayLadyCheck } from './replayTypes';

/** One beat of the game, in the order it was played. */
export type ReplayStep = {
  key: string;
  roundIndex: number;
  /** Seat holding the leader's crown at this beat. */
  leaderId: string | null;
  /** Seat holding Lady of the Lake at this beat, when the archive tells. */
  ladyId: string | null;
  /** Missions settled by the end of this beat. */
  settled: number;
} & (
  | { kind: 'deal' }
  | { kind: 'vote'; proposal: ReplayProposalView }
  | { kind: 'quest'; mission: ReplayMissionView }
  | { kind: 'lady'; check: ReplayLadyCheck }
  | { kind: 'strike'; assassination: NonNullable<ReplayModel['assassination']> }
  | { kind: 'end' }
);

export function replaySteps(model: ReplayModel): ReplayStep[] {
  const checks = model.missions.flatMap((m) => (m.lady ? [m.lady] : []));
  // The lady stays with whoever she visits next; after her last visit, with that visit's target.
  const ladyDuring = (roundIndex: number) =>
    checks.find((c) => c.roundIndex - 1 >= roundIndex)?.holderPlayerId ?? checks.at(-1)?.targetPlayerId ?? null;
  const steps: ReplayStep[] = [];
  const firstLeader = model.missions[0]?.proposals[0]?.leaderId ?? null;
  let settled = 0;
  let last = { roundIndex: 0, leaderId: firstLeader, ladyId: ladyDuring(0) };
  steps.push({ key: 'deal', kind: 'deal', settled, ...last });
  for (const mission of model.missions) {
    const { roundIndex } = mission;
    for (const proposal of mission.proposals) {
      last = { roundIndex, leaderId: proposal.leaderId, ladyId: ladyDuring(roundIndex) };
      steps.push({ key: `v${proposal.key}`, kind: 'vote', proposal, settled, ...last });
    }
    if (mission.success !== null) {
      settled += 1;
      steps.push({ key: `q${roundIndex}`, kind: 'quest', mission, settled, ...last });
    }
    if (mission.lady) {
      steps.push({ key: `l${roundIndex}`, kind: 'lady', check: mission.lady, settled, ...last, ladyId: mission.lady.holderPlayerId });
      last = { ...last, ladyId: mission.lady.targetPlayerId };
    }
  }
  if (model.assassination) steps.push({ key: 'strike', kind: 'strike', assassination: model.assassination, settled, ...last });
  if (model.outcome) steps.push({ key: 'end', kind: 'end', settled, ...last });
  return steps;
}

/**
 * Seat tags for a viewpoint: every role from above, or only what one seat knew when the
 * cards were dealt. The game's end turns every card over either way.
 */
export function viewpointNotes(model: ReplayModel, viewpoint: string | null): RoleNotes {
  if (!viewpoint) return Object.fromEntries(model.players.flatMap((p) => (p.role ? [[p.id, p.role]] : [])));
  const self = model.byId.get(viewpoint);
  return knownRoleNotes({
    selfRole: self?.role ?? null,
    knownPlayers: model.knowledge(viewpoint),
    config: { rolesInPlay: model.players.flatMap((p) => (p.role ? [p.role] : [])) },
    players: model.players,
  }, viewpoint);
}
