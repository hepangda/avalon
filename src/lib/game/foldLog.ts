import type { ClientGameState, ClientLogEntry, ClientMissionResult, ClientVoteRecord, GamePhase } from '@/lib/engine';

/**
 * Lines the nomination cards already say: the cards are drawn from the game's
 * history, so these lines only tell the chronicle where a card belongs.
 */
const NOMINATION_KEYS = new Set([
  'proposalBegins', 'teamAnnounced', 'teamFinalized', 'speechBegins', 'admin.speechSkipped',
  'discussionFinished', 'voteApproved', 'voteRejected', 'missionSucceeded', 'missionFailed',
]);
const SPEECH_KEYS = new Set(['speechBegins', 'admin.speechSkipped']);
/** A reroll deals a new game: its notice stands only until that game's play begins. */
const REROLL_KEYS = new Set(['admin.leaderRerolled', 'admin.rolesRerolled', 'rerollCardUsed']);
/** Phases in which a nomination is still being put together, before its vote is on record. */
const OPEN_PHASES = new Set<GamePhase>(['TeamBuilding', 'TeamAnnouncement', 'Discussion', 'TeamFinalizing', 'Voting']);

/** One nomination as the game's history has it, from the leader taking the crown to the quest it sent. */
export interface ProposalChapter {
  kind: 'proposal';
  key: string;
  /** 1-based, as the log counts. */
  round: number;
  proposal: number;
  leader: string;
  /** The team first put to the table, kept only when the leader later changed it. */
  draft: string[] | null;
  team: string[];
  speeches: ClientLogEntry[];
  /** The vote on record; absent while the nomination is still in play. */
  record?: ClientVoteRecord;
  mission?: ClientMissionResult;
  /** The nomination the table is playing now. */
  live: boolean;
  /** When its vote was cast. */
  at: number;
}

export type ChronicleItem =
  | { kind: 'round'; entry: ClientLogEntry }
  | ProposalChapter
  | { kind: 'entry'; entry: ClientLogEntry };

export type ChronicleHistory = Pick<
  ClientGameState,
  | 'phase' | 'roundIndex' | 'rejectionCount' | 'leaderIndex' | 'players' | 'proposedTeam' | 'voteHistory' | 'missionResults'
  | 'canRerollOpening'
>;

const team = (entry: ClientLogEntry) =>
  typeof entry.params?.team === 'string' ? entry.params.team.split(',').filter(Boolean) : [];
const keyOf = (round: number, proposal: number) => `${round}-${proposal}`;

/**
 * Renders the log against the game's history: each nomination on record (and
 * the one in play) is one card built from the history, placed where its vote
 * was cast; every other line, a referee's included, stands alone in time order.
 * A referee rewinding only adds a line, it never reshapes a card; a reroll deals
 * a new game, so its line stands only while that game has yet to begin.
 */
export function chronicle(entries: ClientLogEntry[], history: ChronicleHistory): ChronicleItem[] {
  const records = new Map(history.voteHistory.map((r) => [keyOf(r.roundIndex + 1, r.proposalIndex + 1), r]));
  const liveKey = OPEN_PHASES.has(history.phase) ? keyOf(history.roundIndex + 1, history.rejectionCount + 1) : null;

  // The lines each nomination left behind, told apart by the nomination being played when they were written.
  const lines = new Map<string, ClientLogEntry[]>();
  const anchor = new Map<string, ClientLogEntry>();
  let current: string | null = null;
  for (const entry of entries) {
    if (entry.key === 'proposalBegins') current = keyOf(Number(entry.params?.round), Number(entry.params?.proposal));
    else if (entry.key === 'roundBegins') current = null;
    else if (entry.key === 'admin.phaseReturned' && entry.params?.proposal !== undefined)
      current = keyOf(entry.roundIndex + 1, Number(entry.params.proposal));
    if (!current || !NOMINATION_KEYS.has(entry.key)) continue;
    // A nomination begun again after a rewind is told afresh.
    if (entry.key === 'proposalBegins') lines.set(current, []);
    (lines.get(current) ?? lines.set(current, []).get(current)!).push(entry);
    // The card stands where its vote on record was cast.
    if ((entry.key === 'voteApproved' || entry.key === 'voteRejected') && records.has(current)) anchor.set(current, entry);
  }

  const card = (key: string, live: boolean): ProposalChapter => {
    const [round, proposal] = key.split('-').map(Number) as [number, number];
    const record = records.get(key);
    const own = lines.get(key) ?? [];
    const finalTeam = record?.team ?? (live ? (history.proposedTeam ?? []) : []);
    const announced = own.filter((e) => e.key === 'teamAnnounced').at(-1);
    const draft = announced ? team(announced) : [];
    const leader = record?.leaderId
      ?? (live ? history.players.find((p) => p.seat === history.leaderIndex)?.id : undefined)
      ?? String(own.find((e) => e.key === 'proposalBegins')?.params?.leader ?? '');
    return {
      kind: 'proposal',
      key,
      round,
      proposal,
      leader,
      draft: finalTeam.length > 0 && draft.some((id) => !finalTeam.includes(id)) ? draft : null,
      team: finalTeam,
      speeches: own.filter((e) => SPEECH_KEYS.has(e.key)),
      record,
      mission: record?.approved ? history.missionResults.find((m) => m.roundIndex === round - 1) : undefined,
      live,
      at: anchor.get(key)?.at ?? 0,
    };
  };

  const cardAt = new Map([...anchor].map(([key, entry]) => [entry.seq, key]));
  // A quest a referee rewound out of is begun again: it is headed where it last began, while history reaches it.
  const headings = new Map(entries.filter((e) => e.key === 'roundBegins').map((e) => [Number(e.params?.round), e.seq]));
  const items: ChronicleItem[] = [];
  for (const entry of entries) {
    if (entry.key === 'roundBegins') {
      const round = Number(entry.params?.round);
      if (headings.get(round) === entry.seq && round <= history.roundIndex + 1) items.push({ kind: 'round', entry });
      continue;
    }
    const placed = cardAt.get(entry.seq);
    if (placed) items.push(card(placed, false));
    else if (!NOMINATION_KEYS.has(entry.key) && (history.canRerollOpening || !REROLL_KEYS.has(entry.key)))
      items.push({ kind: 'entry', entry });
  }
  if (liveKey && !records.has(liveKey)) items.push(card(liveKey, true));
  // A nomination whose vote is on record but whose line is missing still gets its card, at the end of its quest.
  for (const key of records.keys()) {
    if (anchor.has(key)) continue;
    const round = Number(key.split('-')[0]);
    const next = items.findIndex((i) => i.kind === 'round' && Number(i.entry.params?.round) > round);
    items.splice(next < 0 ? items.length : next, 0, card(key, false));
  }
  return items;
}
