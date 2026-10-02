import { isEvil, rejectionLimit, type ClientGameState } from '@/lib/engine';

export function subsets<T>(values: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size < 0 || size > values.length) return [];
  return values.flatMap((value, index) => subsets(values.slice(index + 1), size - 1).map((rest) => [value, ...rest]));
}

function popcount(mask: number): number {
  let count = 0;
  for (; mask; mask &= mask - 1) count++;
  return count;
}

export function entropy(probabilities: readonly number[]): number {
  return -probabilities.reduce((sum, p) => sum + (p > 0 ? p * Math.log2(p) : 0), 0);
}

/** A deliberately broad opponent model: coordinated sabotage AND independent humans.
 * Every physically possible count has support; success never clears a player. */
export function failDistribution(evil: number, required: number, goodWins: number, evilWins: number): number[] {
  if (!evil) return [1];
  const urgent = goodWins >= 2 || evilWins >= 2;
  const sabotage = urgent ? 0.94 : 0.72;
  let independent = [1];
  for (let i = 0; i < evil; i++) {
    const next = Array<number>(independent.length + 1).fill(0);
    independent.forEach((p, k) => {
      next[k]! += p * (1 - sabotage);
      next[k + 1]! += p * sabotage;
    });
    independent = next;
  }
  const result = independent.map((p) => p * 0.45);
  const hide = urgent ? 0.025 : required > evil ? 0.8 : 0.24;
  result[0]! += 0.55 * hide;
  result[Math.min(evil, required)]! += 0.55 * (1 - hide);
  return result;
}

interface BeliefOptions {
  /** Judge how an action looks to the table, without seat secrets. */
  publicOnly?: boolean;
  /** Mission-only inference for historical counterfactuals; avoids circular votes. */
  behavior?: boolean;
}

/** At most C(10,4)=210 joint worlds. Accepts ONLY a human-visible projection.
 * Hard facts constrain worlds; behavioral likelihoods can rank, never eliminate them. */
export function botBeliefs(view: ClientGameState, self: string, options: BeliefOptions = {}) {
  const ids = view.players.map((p) => p.id);
  const bits = new Map(ids.map((id, i) => [id, 1 << i]));
  const maskOf = (team: readonly string[]) => team.reduce((mask, id) => mask | (bits.get(id) ?? 0), 0);
  const evilCount = view.config.rolesInPlay.filter(isEvil).length;
  const masks = subsets(ids, evilCount).map(maskOf);
  const known = new Map<string, boolean>();
  for (const player of view.players) {
    if (player.role && (!options.publicOnly || view.phase === 'Assassination' || view.phase === 'GameOver')) {
      known.set(player.id, isEvil(player.role));
    }
  }
  if (!options.publicOnly) {
    if (view.selfRole) known.set(self, isEvil(view.selfRole));
    for (const p of view.knownPlayers) {
      if (p.shownAs === 'evil' || p.shownAs === 'known-ally') known.set(p.playerId, true);
      if (p.shownAs === 'merlin-or-morgana' && !view.config.rolesInPlay.includes('Morgana')) known.set(p.playerId, false);
    }
    // The latest-result field is replaced when the Lady passes to another seat.
    // A human still remembers their earlier inspection in their own private log.
    for (const log of view.logs) {
      if (log.channel === 'private' && typeof log.params?.target === 'string' &&
          (log.key === 'ladyResultGood' || log.key === 'ladyResultEvil')) {
        known.set(log.params.target, log.key === 'ladyResultEvil');
      }
    }
    if (view.privateLadyResult) known.set(view.privateLadyResult.targetId, view.privateLadyResult.loyalty === 'evil');
  }
  const pair = options.publicOnly ? [] : view.knownPlayers.filter((p) => p.shownAs === 'merlin-or-morgana').map((p) => p.playerId);
  const pairMask = maskOf(pair);
  const prior = masks.filter((mask) =>
    [...known].every(([id, evil]) => !!(mask & (bits.get(id) ?? 0)) === evil) &&
    (pair.length !== 2 || popcount(mask & pairMask) === 1));
  const records = view.missionResults.flatMap((result) => {
    const proposal = view.voteHistory.find((vote) => vote.roundIndex === result.roundIndex && vote.approved);
    return proposal ? [{ ...result, mask: maskOf(proposal.team) }] : [];
  }).sort((a, b) => a.roundIndex - b.roundIndex);
  const likelihoodCache = new Map<string, number>();
  const likelihood = (mask: number, beforeRound = Infinity) => {
    const key = `${mask}:${beforeRound}`;
    const cached = likelihoodCache.get(key);
    if (cached !== undefined) return cached;
    let weight = 1;
    let good = 0;
    let evil = 0;
    for (const result of records) {
      if (result.roundIndex >= beforeRound) break;
      const count = popcount(mask & result.mask);
      weight *= failDistribution(count, view.config.requiredFails[result.roundIndex] ?? 1, good, evil)[result.failCount] ?? 0;
      if (result.success) good++; else evil++;
    }
    likelihoodCache.set(key, weight);
    return weight;
  };
  let worlds = prior.map((mask) => ({ mask, weight: likelihood(mask) })).filter((w) => w.weight > 0);
  const consistent = worlds.length > 0;
  // Damaged/legacy history must not yield NaN. Retain role facts where possible
  // and expose the inconsistency to server-side diagnostics.
  if (!consistent) worlds = (prior.length ? prior : masks).map((mask) => ({ mask, weight: 1 }));

  if (options.behavior !== false && consistent) {
    const evidence = worlds.map(() => 0);
    for (let round = 0; round <= view.roundIndex; round++) {
      const proposals = view.voteHistory.filter((vote) => vote.roundIndex === round);
      if (!proposals.length) continue;
      // What was deducible BEFORE this round? Never explain an old vote using
      // a later fail card, a later Lady inspection, or our private knowledge.
      const publicPrior = masks.map((mask) => ({ mask, weight: likelihood(mask, round) })).filter((w) => w.weight > 0);
      const roundEvidence = worlds.map(() => 0);
      for (const proposal of proposals) {
        const teamMask = maskOf(proposal.team);
        const required = view.config.requiredFails[round] ?? 1;
        const hammer = proposal.proposalIndex >= rejectionLimit(view.config.maxRejections) - 1;
        const expectations = new Map(proposal.votes.map((vote) => {
          const bit = bits.get(vote.playerId) ?? 0;
          const possibleGood = publicPrior.filter((w) => !(w.mask & bit));
          const total = possibleGood.reduce((sum, w) => sum + w.weight, 0);
          const risk = total ? possibleGood.reduce((sum, w) => sum + (popcount(w.mask & teamMask) >= required ? w.weight : 0), 0) / total : 0.5;
          return [vote.playerId, hammer ? 0.98 : Math.max(0.08, Math.min(0.92,
            0.85 - risk * 0.8 + (teamMask & bit ? 0.12 : -0.08) + proposal.proposalIndex * 0.07))];
        }));
        worlds.forEach((world, i) => {
          const dangerous = popcount(world.mask & teamMask) >= required;
          for (const vote of proposal.votes) {
            if (!options.publicOnly && vote.playerId === self) continue; // no self-confirmation
            const evil = !!(world.mask & (bits.get(vote.playerId) ?? 0));
            const ordinary = expectations.get(vote.playerId)!;
            // A small informed-good mixture allows Merlin/Percival without
            // pretending that every loyal servant sees hidden identities.
            const approve = evil ? (hammer ? 0.12 : dangerous ? 0.82 : 0.38)
              : hammer ? ordinary : ordinary * 0.85 + (dangerous ? 0.12 : 0.88) * 0.15;
            roundEvidence[i]! += Math.log(vote.vote === 'approve' ? approve : 1 - approve);
          }
        });
      }
      const best = Math.max(...roundEvidence);
      // Correlated votes and repeated proposals are not independent proof.
      roundEvidence.forEach((value, i) => { evidence[i]! += Math.max(-1.8, (value - best) * 0.3); });
    }
    worlds.forEach((world, i) => { world.weight *= Math.exp(evidence[i]!); });
  }
  const total = worlds.reduce((sum, w) => sum + w.weight, 0);
  worlds.forEach((world) => { world.weight /= total || 1; });
  const distributionCache = new Map<number, number[]>();
  const distribution = (team: readonly string[]): number[] => {
    const mask = maskOf(team);
    const cached = distributionCache.get(mask);
    if (cached) return cached;
    const result = Array<number>(popcount(mask) + 1).fill(0);
    worlds.forEach((world) => { result[popcount(mask & world.mask)]! += world.weight; });
    distributionCache.set(mask, result);
    return result;
  };
  const risk = (team: readonly string[], fails = 1): number =>
    Math.max(0, Math.min(1, distribution(team).slice(Math.max(0, fails)).reduce((sum, p) => sum + p, 0)));
  const teams = (size: number, includeSelf = true): string[][] => includeSelf
    ? subsets(ids.filter((id) => id !== self), size - 1).map((rest) => [self, ...rest]) : subsets(ids, size);
  const goodWins = view.missionResults.filter((m) => m.success).length;
  const evilWins = view.missionResults.length - goodWins;
  const outcomes = (team: readonly string[], required = 1) => {
    const counts = distribution(team);
    const result = Array<number>(counts.length).fill(0);
    let conditionalEntropy = 0;
    counts.forEach((p, count) => {
      const cards = failDistribution(count, required, goodWins, evilWins);
      conditionalEntropy += p * entropy(cards);
      cards.forEach((chance, fails) => { result[fails]! += p * chance; });
    });
    return { probabilities: result, information: Math.max(0, entropy(result) - conditionalEntropy) };
  };
  // Expected improvement in the best next team after a truthful Lady result.
  const inspectionValue = (id: string, size: number, required = 1): number => {
    const candidates = teams(size, false).map(maskOf);
    const bit = bits.get(id) ?? 0;
    let best = 1;
    let goodBranch = 1;
    let evilBranch = 1;
    for (const team of candidates) {
      let goodRisk = 0;
      let evilRisk = 0;
      for (const world of worlds) {
        if (popcount(team & world.mask) < required) continue;
        if (world.mask & bit) evilRisk += world.weight; else goodRisk += world.weight;
      }
      best = Math.min(best, goodRisk + evilRisk);
      goodBranch = Math.min(goodBranch, goodRisk);
      evilBranch = Math.min(evilBranch, evilRisk);
    }
    return Math.max(0, best - goodBranch - evilBranch);
  };
  return { risk, teams, distribution, outcomes, inspectionValue, consistent, hypothesisCount: worlds.length };
}

export type BotBeliefs = ReturnType<typeof botBeliefs>;
