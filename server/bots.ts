import { botBeliefs, entropy } from './bot-beliefs';
import { merlinSuspicions } from './bot-assassin';
import { chooseNearBest, clamp, designatedSaboteurs, raceEquity, tally, voteTolerance } from './bot-policy';
import { createRng, isEvil, projectStateForViewer, rejectionLimit, type ActionTimer, type ClientGameState, type GameEvent, type GameState } from '@/lib/engine';

export const BOT_DELAY_MS = 0;

export interface BotDecision {
  event: GameEvent;
  /** Server/test diagnostics ONLY: contains deductions from the seat's secrets. */
  reason: string;
  hypotheses?: number;
  consistent?: boolean;
  alternatives?: Array<{ team?: string[]; target?: string; score: number; risk?: number }>;
}

/** The sole authoritative-state boundary. The policy below cannot see secrets
 * unavailable to a human in this seat, even when the server runs every bot. */
export function botAction(state: GameState, timer: ActionTimer, seed: string): GameEvent {
  return decideBot(projectStateForViewer(state, timer.playerId), timer.playerId, timer.action, seed).event;
}

export function decideBot(view: ClientGameState, by: string, action: ActionTimer['action'], seed: string): BotDecision {
  const rng = createRng(seed);
  const evil = view.selfRole !== null && isEvil(view.selfRole);
  const required = view.config.requiredFails[view.roundIndex] ?? 1;
  const size = view.config.missionSizes[view.roundIndex]!;
  const { good, evil: evilWins } = tally(view);
  const urgent = good >= 2 || evilWins >= 2;
  const allies = new Set(view.knownPlayers.filter((p) => p.shownAs === 'known-ally').map((p) => p.playerId));
  if (evil) allies.add(by);
  // Stable preferences within a deal, independent of action order, clocks and seed
  // used to deal the secret roles. Random decisions still use the injected seed.
  const personality = createRng(`personality:${view.roleRevision}:${by}:${view.players.map((p) => p.id).join(':')}`);
  const patience = personality.next();
  const temperature = 0.016 + personality.next() * 0.012;
  const finish = (event: GameEvent, reason: string): BotDecision => ({ event, reason });
  switch (action) {
    case 'role': return finish({ type: 'ACK_ROLE', by, roleRevision: view.roleRevision }, 'acknowledge-role');
    case 'announce': return finish({ type: 'START_DISCUSSION', by, direction: 'clockwise' }, 'announce-team');
    case 'speak': return finish({ type: 'END_SPEECH', by }, 'finish-speaking');
    case 'propose':
    case 'finalize': {
      const model = botBeliefs(view, by);
      const publicModel = botBeliefs(view, by, { publicOnly: true });
      // A publicly exposed red leader can send an accomplice instead of insisting
      // on joining every team. Good leaders know their own seat is safe.
      const teams = model.teams(size, !evil);
      const bestRisk = Math.min(...teams.map((team) => model.risk(team, required)));
      const leverage = raceEquity(good + 1, evilWins) - raceEquity(good, evilWins + 1);
      const scores = teams.map((team) => {
        const risk = model.risk(team, required);
        const publicRisk = publicModel.risk(team, required);
        const information = urgent ? 0 : model.outcomes(team, required).information;
        const accomplices = team.filter((id) => allies.has(id)).length;
        // Public plausibility matters most for Merlin's cover and red infiltration.
        // It also favors retaining a team whose prior success the table can see.
        const cover = view.selfRole === 'Merlin' ? 0.15 : 0.045;
        const score = evil
          ? risk * (0.75 + leverage) - publicRisk * 0.48 - Math.max(0, accomplices - required) * 0.1 + (team.includes(by) ? 0.025 : 0)
          : -risk * (1 + leverage) - publicRisk * cover + information * 0.035;
        return { team, score, risk };
      }).filter((candidate) => evil || candidate.risk <= bestRisk + (urgent ? 0.025 : 0.08));
      let choice = chooseNearBest(scores, rng, temperature, urgent ? 0.025 : 0.055);
      // Speech doesn't itself add machine-readable evidence. Don't randomly
      // contradict our own draft when it is still among the best alternatives.
      const draft = scores.find((s) => s.team.length === view.proposedTeam?.length && s.team.every((id) => view.proposedTeam!.includes(id)));
      if (action === 'finalize' && draft && draft.score >= Math.max(...scores.map((s) => s.score)) - 0.035) choice = draft;
      return {
        event: { type: action === 'propose' ? 'PROPOSE_TEAM' : 'FINALIZE_TEAM', by, team: choice.team },
        reason: evil ? 'infiltrate-plausible-team' : urgent ? 'protect-critical-mission' : 'balance-safety-information-and-cover',
        hypotheses: model.hypothesisCount, consistent: model.consistent,
        alternatives: [...scores].sort((a, b) => b.score - a.score).slice(0, 5),
      };
    }
    case 'vote': {
      const team = view.proposedTeam ?? [];
      const hammer = view.rejectionCount >= rejectionLimit(view.config.maxRejections) - 1;
      if (hammer) return finish({ type: 'CAST_VOTE', by, value: evil ? 'reject' : 'approve' }, 'last-proposal');
      const model = botBeliefs(view, by);
      const risk = model.risk(team, required);
      const bestRisk = Math.min(...model.teams(team.length).map((candidate) => model.risk(candidate, required)));
      const tolerance = voteTolerance(view.rejectionCount) + (patience - 0.5) * 0.025;
      let approve: boolean;
      if (!evil) {
        // Never randomize a proven dangerous veto or a proven safe approval.
        approve = risk < 1 - 1e-9 && risk <= bestRisk + tolerance;
      } else {
        const publicModel = botBeliefs(view, by, { publicOnly: true });
        const publicRisk = publicModel.risk(team, required);
        // Support infiltration, oppose clean teams, sometimes vote with the table
        // for cover. No access to other players' sealed current votes.
        const chance = risk >= 0.95 ? (publicRisk > 0.98 && !urgent ? 0.6 : 0.96)
          : clamp(0.2 + risk * 0.65 + (1 - publicRisk) * 0.18 - view.rejectionCount * 0.025, 0.1, 0.85);
        approve = rng.next() < chance;
      }
      return { ...finish({ type: 'CAST_VOTE', by, value: approve ? 'approve' : 'reject' },
        evil ? 'sabotage-opportunity-and-cover' : risk >= 1 - 1e-9 ? 'proven-danger' : 'compare-available-teams'),
      hypotheses: model.hypothesisCount, consistent: model.consistent };
    }
    case 'mission': {
      if (!evil) return finish({ type: 'CAST_MISSION_CARD', by, card: 'success' }, 'good-must-succeed');
      // Oberon has no mutual visibility and does not take part in red coordination.
      if (view.selfRole === 'Oberon') return finish({ type: 'CAST_MISSION_CARD', by, card: 'fail' }, 'oberon-sabotages');
      // HARD RULE: Assassin > Minion > Morgana > Mordred among mutually visible
      // reds; seat order breaks ties between multiple Minions.
      // A non-designated red NEVER fails, even if somebody else already submitted
      // or may hide. The first one/two eligible seats alone consider sabotage.
      const designated = designatedSaboteurs(view, by, required);
      if (!designated.includes(by)) return finish({ type: 'CAST_MISSION_CARD', by, card: 'success' }, 'outside-fail-quota');
      const model = botBeliefs(view, by);
      const team = view.proposedTeam ?? [];
      if (model.risk(team, required) < 1e-9) return finish({ type: 'CAST_MISSION_CARD', by, card: 'success' }, 'cannot-reach-fail-threshold');
      if (urgent) return finish({ type: 'CAST_MISSION_CARD', by, card: 'fail' }, 'decisive-sabotage');
      const publicModel = botBeliefs(view, by, { publicOnly: true });
      const suspicion = Math.max(...designated.map((id) => publicModel.risk([id])));
      // Hide only while there is time to benefit from reputation, with a shared
      // public seed so the two designated reds do not accidentally split a plan.
      const shared = createRng(`sabotage:${view.roleRevision}:${view.roundIndex}:${view.rejectionCount}:${team.slice().sort().join(':')}:${view.voteHistory.length}`);
      const hideChance = view.roundIndex < 2 && suspicion < 0.95 ? 0.16 + (1 - suspicion) * 0.18 : 0;
      const hide = shared.next() < hideChance;
      return finish({ type: 'CAST_MISSION_CARD', by, card: hide ? 'success' : 'fail' }, hide ? 'build-early-credibility' : 'designated-sabotage');
    }
    case 'lady': {
      const model = botBeliefs(view, by);
      // The engine keeps roundIndex on the completed mission until Lady resolves.
      const nextRound = Math.min(view.roundIndex + 1, 4);
      const targets = view.players.filter((p) => p.id !== by && !view.lady?.inspectedIds.includes(p.id)).map((p) => {
        const risk = model.risk([p.id]);
        const information = entropy([risk, 1 - risk]);
        const improvement = model.inspectionValue(p.id, view.config.missionSizes[nextRound]!, view.config.requiredFails[nextRound] ?? 1);
        // Red prefers passing the token to an ally, limiting useful good inspections.
        return { target: p.id, score: evil ? risk * 0.8 + information * 0.12 : improvement + information * 0.16 - risk * 0.025 };
      });
      const choice = chooseNearBest(targets, rng, temperature, 0.025);
      return { event: { type: 'USE_LADY', by, target: choice.target }, reason: evil ? 'control-next-inspection' : 'resolve-useful-uncertainty',
        hypotheses: model.hypothesisCount, consistent: model.consistent, alternatives: targets };
    }
    case 'assassinate': {
      const candidates = merlinSuspicions(view);
      const choice = chooseNearBest(candidates, rng, 0.55, 1.2);
      return { event: { type: 'ASSASSINATE', by, target: choice.target }, reason: 'knowledge-unexplained-by-public-history', alternatives: candidates };
    }
  }
}
