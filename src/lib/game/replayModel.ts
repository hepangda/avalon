import {
  computeKnownPlayers,
  missionSizesFor,
  rejectionLimit,
  requiredFailsFor,
  teamOf,
  type ClientLogEntry,
  type MissionCard,
  type Role,
  type Team,
  type VisibilityInfo,
  type VoteValue,
} from '@/lib/engine';
import type { ReplayData, ReplayLadyCheck } from './replayTypes';

export interface ReplaySeat {
  id: string;
  name: string;
  seat: number;
  avatarUrl?: string;
  isBot?: boolean;
  role?: Role;
  variant?: number;
  team?: Team;
}

export interface ReplayProposalView {
  key: string;
  roundIndex: number;
  proposalIndex: number;
  leaderId: string | null;
  /** Null when an old archive did not keep a rejected team. */
  team: string[] | null;
  /** The announced draft, when the leader changed it before the vote. */
  draftTeam: string[] | null;
  votes: Map<string, VoteValue>;
  approves: number;
  rejects: number;
  approved: boolean;
  speakers: string[];
  startedAt: number | null;
  referee: ClientLogEntry[];
}

export interface ReplayMissionView {
  roundIndex: number;
  size: number;
  requiredFails: number;
  proposals: ReplayProposalView[];
  success: boolean | null;
  failCount: number | null;
  team: string[] | null;
  cards: Map<string, MissionCard>;
  /** Lady of the Lake used after this mission. */
  lady: ReplayLadyCheck | null;
}

export interface ReplayModel {
  gameId: string;
  players: ReplaySeat[];
  byId: Map<string, ReplaySeat>;
  missions: ReplayMissionView[];
  outcome: ReplayData['outcome'];
  assassination: ReplayData['assassination'];
  /** Evil ended the missions early to strike. */
  earlyStrike: boolean;
  maxRejections: number;
  startedAt: number | null;
  endedAt: number | null;
  proposalCount: number;
  /** Table events outside any nomination (referee actions before play, endings). */
  closingLog: ClientLogEntry[];
  knowledge: (playerId: string) => VisibilityInfo[];
}

const ids = (value: string | number | undefined) =>
  typeof value === 'string' && value ? value.split(',') : [];

function sameMembers(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

interface LogSegment {
  draftTeam: string[] | null;
  speakers: string[];
  startedAt: number | null;
  referee: ClientLogEntry[];
}

/** Split the public log at each "proposal begins" line, keyed "round:proposal" (0-based). */
function segmentLog(log: ClientLogEntry[]) {
  const segments = new Map<string, LogSegment>();
  const closing: ClientLogEntry[] = [];
  let current: LogSegment | null = null;
  for (const entry of log) {
    if (entry.key === 'proposalBegins' && entry.params) {
      current = { draftTeam: null, speakers: [], startedAt: entry.at || null, referee: [] };
      segments.set(`${Number(entry.params.round) - 1}:${Number(entry.params.proposal) - 1}`, current);
    } else if (entry.style === 'admin') {
      (current?.referee ?? closing).push(entry);
    } else if (!current) {
      continue;
    } else if (entry.key === 'teamAnnounced') {
      current.draftTeam = ids(entry.params?.team);
    } else if (entry.key === 'speechBegins' && typeof entry.params?.player === 'string') {
      current.speakers.push(entry.params.player);
    } else if (entry.key === 'earlyAssassination') {
      closing.push(entry);
    }
  }
  return { segments, closing };
}

/** Normalize an archived replay, including archives written before proposals and logs were kept. */
export function buildReplayModel(data: ReplayData): ReplayModel {
  const roleOf = new Map(data.roleAssignments.map((r) => [r.playerId, r]));
  const players: ReplaySeat[] = data.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => {
      const assignment = roleOf.get(p.id);
      return {
        ...p,
        ...(assignment
          ? { role: assignment.role, variant: assignment.roleVariant, team: teamOf(assignment.role) }
          : {}),
      };
    });
  const byId = new Map(players.map((p) => [p.id, p]));
  const count = players.length;
  const sizes = missionSizesFor(count);
  const fails = requiredFailsFor(count);
  const { segments, closing } = segmentLog(data.log ?? []);
  const roundByIndex = new Map(data.rounds.map((r) => [r.roundIndex, r]));
  const ladyAfter = new Map(data.ladyChecks.map((l) => [l.roundIndex - 1, l]));

  const missions: ReplayMissionView[] = sizes.map((size, roundIndex) => {
    const round = roundByIndex.get(roundIndex);
    const voteGroups = new Map<number, Map<string, VoteValue>>();
    for (const v of round?.votes ?? []) {
      const group = voteGroups.get(v.proposalIndex) ?? new Map<string, VoteValue>();
      group.set(v.playerId, v.value);
      voteGroups.set(v.proposalIndex, group);
    }
    const played = round?.missionSuccess !== null && round?.missionSuccess !== undefined;
    const lastIndex = Math.max(-1, ...voteGroups.keys());
    const firstLeaderSeat = byId.get(round?.leaderPlayerId ?? '')?.seat;
    const recorded = new Map((round?.proposals ?? []).map((p) => [p.proposalIndex, p]));
    const indexes = [...new Set([...voteGroups.keys(), ...recorded.keys()])].sort((a, b) => a - b);

    const proposals = indexes.map((proposalIndex): ReplayProposalView => {
      const votes = voteGroups.get(proposalIndex) ?? new Map<string, VoteValue>();
      const known = recorded.get(proposalIndex);
      // Archives without proposals: the leader moves one seat per nomination.
      const leaderId = known?.leaderPlayerId
        ?? (firstLeaderSeat === undefined
          ? null
          : players.find((p) => p.seat === (firstLeaderSeat + proposalIndex) % count)?.id ?? null);
      const approved = known?.approved ?? (played && proposalIndex === lastIndex);
      const team = known?.team ?? (approved ? round?.finalTeam ?? null : null);
      const segment = segments.get(`${roundIndex}:${proposalIndex}`);
      const approves = [...votes.values()].filter((v) => v === 'approve').length;
      return {
        key: `${roundIndex}:${proposalIndex}`,
        roundIndex,
        proposalIndex,
        leaderId,
        team,
        draftTeam: segment?.draftTeam && team && !sameMembers(segment.draftTeam, team) ? segment.draftTeam : null,
        votes,
        approves,
        rejects: votes.size - approves,
        approved,
        speakers: segment?.speakers ?? [],
        startedAt: segment?.startedAt ?? null,
        referee: segment?.referee ?? [],
      };
    });

    return {
      roundIndex,
      size,
      requiredFails: fails[roundIndex] ?? 1,
      proposals,
      success: played ? round!.missionSuccess : null,
      failCount: played ? round!.failCount : null,
      team: played ? round!.finalTeam : null,
      cards: new Map((round?.missionCards ?? []).map((c) => [c.playerId, c.card])),
      lady: ladyAfter.get(roundIndex) ?? null,
    };
  });

  const roster = players.flatMap((p) => (p.role ? [{ id: p.id, role: p.role }] : []));
  const tally = data.outcome?.missionTally;
  return {
    gameId: data.gameId,
    players,
    byId,
    missions,
    outcome: data.outcome,
    assassination: data.assassination,
    earlyStrike: !!data.assassination && !!tally && tally.good < 3,
    maxRejections: rejectionLimit(data.options?.maxRejections),
    startedAt: data.startedAt ?? null,
    endedAt: data.endedAt ?? null,
    proposalCount: missions.reduce((sum, m) => sum + m.proposals.length, 0),
    closingLog: closing,
    knowledge: (playerId) => {
      const viewer = roster.find((p) => p.id === playerId);
      return viewer ? computeKnownPlayers(viewer, roster) : [];
    },
  };
}

export interface ReplayPlayerStats {
  led: number;
  picked: number;
  approves: number;
  rejects: number;
  /** Votes for a team that included evil. */
  approvedEvilTeams: number;
  fails: number;
  missions: number;
}

export function playerStats(model: ReplayModel, playerId: string): ReplayPlayerStats {
  const stats: ReplayPlayerStats = { led: 0, picked: 0, approves: 0, rejects: 0, approvedEvilTeams: 0, fails: 0, missions: 0 };
  for (const mission of model.missions) {
    for (const p of mission.proposals) {
      if (p.leaderId === playerId) stats.led += 1;
      if (p.team?.includes(playerId)) stats.picked += 1;
      const vote = p.votes.get(playerId);
      if (vote === 'approve') {
        stats.approves += 1;
        if (p.team?.some((id) => model.byId.get(id)?.team === 'evil')) stats.approvedEvilTeams += 1;
      } else if (vote === 'reject') stats.rejects += 1;
    }
    const card = mission.cards.get(playerId);
    if (card) {
      stats.missions += 1;
      if (card === 'fail') stats.fails += 1;
    }
  }
  return stats;
}
