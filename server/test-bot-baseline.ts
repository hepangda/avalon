/** Frozen pre-upgrade reasoning for reproducible cross-play benchmarks. The one
 * adaptation is the table's required role-based fail priority, shared by both
 * policies so the benchmark does not reward incompatible sabotage conventions.
 * Test tooling only; do not import into the room runtime or tune with the policy. */
import { createRng, isEvil, projectStateForViewer, rejectionLimit, type ActionTimer, type ClientGameState, type GameEvent, type GameState } from '@/lib/engine';
import { designatedSaboteurs } from './bot-policy';

function subsets<T>(values: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size < 0 || size > values.length) return [];
  return values.flatMap((value, index) => subsets(values.slice(index + 1), size - 1).map((rest) => [value, ...rest]));
}

function baselineBeliefs(view: ClientGameState, self: string) {
  const ids = view.players.map((p) => p.id);
  const evilCount = view.config.rolesInPlay.filter(isEvil).length;
  const known = new Map<string, boolean>([[self, !!view.selfRole && isEvil(view.selfRole)]]);
  for (const p of view.knownPlayers) {
    if (p.shownAs === 'evil' || p.shownAs === 'known-ally') known.set(p.playerId, true);
    if (p.shownAs === 'merlin-or-morgana' && !view.config.rolesInPlay.includes('Morgana')) known.set(p.playerId, false);
  }
  if (view.privateLadyResult) known.set(view.privateLadyResult.targetId, view.privateLadyResult.loyalty === 'evil');
  const pair = view.knownPlayers.filter((p) => p.shownAs === 'merlin-or-morgana').map((p) => p.playerId);
  const countEvil = (team: readonly string[], evil: Set<string>) => team.filter((id) => evil.has(id)).length;
  const possible = subsets(ids, evilCount).map((team) => new Set(team)).filter((evil) => {
    if ([...known].some(([id, value]) => evil.has(id) !== value)) return false;
    if (pair.length === 2 && countEvil(pair, evil) !== 1) return false;
    return view.missionResults.every((result) => {
      const team = view.voteHistory.find((vote) => vote.roundIndex === result.roundIndex && vote.approved)?.team;
      return !team || countEvil(team, evil) >= result.failCount;
    });
  });
  const worlds = possible.map((evil) => {
    let logWeight = 0;
    for (const result of view.missionResults) {
      const team = view.voteHistory.find((vote) => vote.roundIndex === result.roundIndex && vote.approved)?.team;
      if (team && result.failCount === 0 && countEvil(team, evil) > 0) logWeight += Math.log(0.2);
    }
    for (let round = 0; round <= view.roundIndex; round++) {
      let evidence = 0;
      for (const proposal of view.voteHistory.filter((vote) => vote.roundIndex === round)) {
        const dangerous = countEvil(proposal.team, evil) >= (view.config.requiredFails[round] ?? 1);
        for (const vote of proposal.votes) {
          if (vote.playerId === self) continue;
          const chance = evil.has(vote.playerId) ? (dangerous ? 0.85 : 0.25) : (dangerous ? 0.4 : 0.8);
          evidence += Math.log(vote.vote === 'approve' ? chance : 1 - chance);
        }
      }
      logWeight += evidence * 0.3;
    }
    return { evil, logWeight };
  });
  const max = Math.max(...worlds.map((world) => world.logWeight));
  const weighted = worlds.map((world) => ({ evil: world.evil, weight: Math.exp(world.logWeight - max) }));
  const total = weighted.reduce((sum, world) => sum + world.weight, 0);
  const cache = new Map<string, number>();
  const risk = (team: readonly string[], fails = 1) => {
    const key = `${fails}:${[...team].sort().join(',')}`;
    if (cache.has(key)) return cache.get(key)!;
    const result = total ? weighted.reduce((sum, w) => sum + (countEvil(team, w.evil) >= fails ? w.weight : 0), 0) / total
      : team.some((id) => known.get(id) === true) ? 1 : 0.5;
    cache.set(key, result);
    return result;
  };
  return { risk, teams: (size: number) => subsets(ids.filter((id) => id !== self), size - 1).map((rest) => [self, ...rest]) };
}

export function baselineBotAction(state: GameState, timer: ActionTimer, seed: string): GameEvent {
  const by = timer.playerId;
  const rng = createRng(seed);
  const view = projectStateForViewer(state, by);
  const evil = view.selfRole !== null && isEvil(view.selfRole);
  const allies = new Set(view.knownPlayers.filter((p) => p.shownAs === 'known-ally').map((p) => p.playerId));
  if (evil) allies.add(by);
  const required = view.config.requiredFails[view.roundIndex] ?? 1;
  const chooseTeam = () => {
    const model = baselineBeliefs(view, by);
    const teams = rng.shuffle(model.teams(view.config.missionSizes[view.roundIndex]!));
    const score = (team: string[]) => {
      const risk = model.risk(team, required);
      if (!evil) return risk;
      const accomplices = team.filter((id) => allies.has(id)).length;
      return (accomplices >= required ? -2 : 0) + Math.abs(accomplices - required) * 0.1 + risk * 0.1;
    };
    teams.sort((a, b) => score(a) - score(b));
    const best = teams[0]!;
    return view.proposedTeam?.includes(by) && view.proposedTeam.length === best.length && score(view.proposedTeam) <= score(best) + 0.001 ? view.proposedTeam : best;
  };
  switch (timer.action) {
    case 'role': return { type: 'ACK_ROLE', by, roleRevision: view.roleRevision };
    case 'propose': return { type: 'PROPOSE_TEAM', by, team: chooseTeam() };
    case 'finalize': return { type: 'FINALIZE_TEAM', by, team: chooseTeam() };
    case 'announce': return { type: 'START_DISCUSSION', by, direction: 'clockwise' };
    case 'speak': return { type: 'END_SPEECH', by };
    case 'vote': {
      const proposed = view.proposedTeam ?? [];
      const lastChance = view.rejectionCount >= rejectionLimit(view.config.maxRejections) - 1;
      const model = baselineBeliefs(view, by);
      const risk = model.risk(proposed, required);
      const bestRisk = Math.min(...model.teams(proposed.length).map((team) => model.risk(team, required)));
      const canSabotage = proposed.filter((id) => allies.has(id)).length >= required;
      const tolerance = 0.1 + Math.min(view.rejectionCount, 3) * 0.06;
      const approve = evil ? !lastChance && rng.next() < (canSabotage ? 0.95 : 0.55) : lastChance || (risk < 0.999 && risk <= bestRisk + tolerance);
      return { type: 'CAST_VOTE', by, value: approve ? 'approve' : 'reject' };
    }
    case 'mission': {
      const designated = designatedSaboteurs(view, by, required);
      return { type: 'CAST_MISSION_CARD', by, card: evil && (view.selfRole === 'Oberon' || designated.includes(by)) ? 'fail' : 'success' };
    }
    case 'lady': {
      const model = baselineBeliefs(view, by);
      const targets = rng.shuffle(view.players.filter((p) => p.id !== by && !view.lady?.inspectedIds.includes(p.id)));
      targets.sort((a, b) => Math.abs(model.risk([a.id]) - 0.5) - Math.abs(model.risk([b.id]) - 0.5));
      return { type: 'USE_LADY', by, target: targets[0]!.id };
    }
    case 'assassinate': {
      const exposedEvil = new Set(view.players.filter((p) => p.role && isEvil(p.role)).map((p) => p.id));
      const insight = (id: string) => view.voteHistory.reduce((score, proposal) => {
        const vote = proposal.votes.find((v) => v.playerId === id)?.vote;
        if (!vote) return score;
        const tainted = proposal.team.some((member) => exposedEvil.has(member));
        return score + ((vote === 'reject') === tainted ? 1 : -1);
      }, 0);
      const candidates = rng.shuffle(view.assassinCandidates ?? []).sort((a, b) => insight(b) - insight(a));
      return { type: 'ASSASSINATE', by, target: candidates[0]! };
    }
  }
}
