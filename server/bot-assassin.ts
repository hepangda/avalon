import { isEvil, rejectionLimit, type ClientGameState } from '@/lib/engine';
import { botBeliefs, type BotBeliefs } from './bot-beliefs';
import { clamp, voteTolerance } from './bot-policy';

/** Infer unexplained knowledge, not hindsight accuracy. All candidate identities
 * here are counterfactuals built from information public to the assassin. */
export function merlinSuspicions(view: ClientGameState): Array<{ target: string; score: number; probability: number }> {
  const candidates = view.assassinCandidates ?? [];
  const visibleEvil = view.players.filter((p) => p.role && isEvil(p.role) && p.role !== 'Mordred');
  const suspects = candidates.map((target) => {
    let score = 0;
    for (let round = 0; round <= view.roundIndex; round++) {
      const proposals = view.voteHistory.filter((p) => p.roundIndex === round);
      if (!proposals.length) continue;
      const prefix: ClientGameState = {
        ...view,
        phase: 'Voting',
        roundIndex: round,
        // Strip endgame reveals and ALL seat-specific inspection information.
        players: view.players.map(({ role: _role, ...p }) => p),
        selfRole: 'LoyalServant', knownPlayers: [], logs: [],
        privateLadyResult: undefined, outcome: null, assassinCandidates: undefined,
        missionResults: view.missionResults.filter((m) => m.roundIndex < round),
        voteHistory: view.voteHistory.filter((p) => p.roundIndex < round),
      };
      const ordinary = botBeliefs(prefix, target, { behavior: false });
      const informed = botBeliefs({ ...prefix, selfRole: 'Merlin', knownPlayers:
        visibleEvil.map((p) => ({ playerId: p.id, shownAs: 'evil', certain: true })) }, target, { behavior: false });
      const required = view.config.requiredFails[round] ?? 1;
      const teams = ordinary.teams(view.config.missionSizes[round]!);
      const bestOrdinary = Math.min(...teams.map((team) => ordinary.risk(team, required)));
      const bestInformed = Math.min(...teams.map((team) => informed.risk(team, required)));
      const hasLadyKnowledge = view.logs.some((log) => log.channel === 'public' && log.key === 'ladyInspected' &&
        log.params?.holder === target && log.roundIndex < round);
      let evidence = 0;
      for (const proposal of proposals) {
        const vote = proposal.votes.find((v) => v.playerId === target)?.vote;
        const hammer = proposal.proposalIndex >= rejectionLimit(view.config.maxRejections) - 1;
        if (vote && !hammer) {
          const approve = (model: BotBeliefs, best: number) => {
            const risk = model.risk(proposal.team, required);
            if (risk >= 1 - 1e-9) return 0.08;
            return clamp(0.55 + (best + voteTolerance(proposal.proposalIndex) - risk) * 1.7, 0.12, 0.9);
          };
          const informedApprove = approve(informed, bestInformed);
          const ordinaryApprove = approve(ordinary, bestOrdinary);
          // Merlin can conceal knowledge; Percival or a Lady holder can look informed.
          const merlinChance = informedApprove * 0.8 + ordinaryApprove * 0.2;
          const alternativeChance = ordinaryApprove * (hasLadyKnowledge ? 0.4 : 0.8) + informedApprove * (hasLadyKnowledge ? 0.6 : 0.2);
          evidence += Math.log(vote === 'approve' ? merlinChance / alternativeChance : (1 - merlinChance) / (1 - alternativeChance));
        }
        if (proposal.leaderId === target) {
          const likelihood = (model: BotBeliefs) => {
            const weights = teams.map((team) => Math.exp(-model.risk(team, required) / 0.18));
            return Math.exp(-model.risk(proposal.team, required) / 0.18) / weights.reduce((sum, w) => sum + w, 0);
          };
          const ordinaryChance = likelihood(ordinary);
          const informedChance = likelihood(informed);
          evidence += 0.55 * Math.log((informedChance * 0.8 + ordinaryChance * 0.2) /
            (ordinaryChance * 0.8 + informedChance * 0.2));
        }
      }
      score += clamp(evidence, -1.5, 1.5);
    }
    return { target, score, probability: 0 };
  });
  const best = Math.max(...suspects.map((p) => p.score));
  const total = suspects.reduce((sum, p) => sum + Math.exp(p.score - best), 0);
  return suspects.map((p) => ({ ...p, probability: Math.exp(p.score - best) / total }));
}
