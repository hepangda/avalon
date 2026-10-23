import type { ClientLogEntry } from '@/lib/engine';

const SPEECH_KEYS = new Set(['speechBegins', 'admin.speechSkipped']);

/** Everything the log said about one nomination, from the leader taking the crown to the quest it sent. */
export interface ProposalChapter {
  kind: 'proposal';
  key: number;
  /** 1-based, as the log counts. */
  round: number;
  proposal: number;
  leader: string;
  /** The team first put to the table, kept only when the leader later changed it. */
  draft: string[] | null;
  team: string[];
  speeches: ClientLogEntry[];
  vote: ClientLogEntry | null;
  mission: ClientLogEntry | null;
  /** Referee and other lines that happened inside this nomination, in order. */
  notes: ClientLogEntry[];
}

export type ChronicleItem =
  | { kind: 'round'; entry: ClientLogEntry }
  | ProposalChapter
  | { kind: 'entry'; entry: ClientLogEntry };

const team = (entry: ClientLogEntry) =>
  typeof entry.params?.team === 'string' ? entry.params.team.split(',').filter(Boolean) : [];

/**
 * Gathers each nomination's scattered lines (leader, draft, speeches, final team,
 * vote, quest) into one chapter, so the log reads as one card per nomination.
 */
export function chronicle(entries: ClientLogEntry[]): ChronicleItem[] {
  const items: ChronicleItem[] = [];
  let open: ProposalChapter | null = null;
  let announced: string[] = [];
  for (const entry of entries) {
    const { key } = entry;
    if (key === 'proposalBegins') {
      open = {
        kind: 'proposal',
        key: entry.seq,
        round: Number(entry.params?.round),
        proposal: Number(entry.params?.proposal),
        leader: String(entry.params?.leader ?? ''),
        draft: null,
        team: [],
        speeches: [],
        vote: null,
        mission: null,
        notes: [],
      };
      announced = [];
      items.push(open);
      continue;
    }
    if (key === 'roundBegins') {
      open = null;
      items.push({ kind: 'round', entry });
      continue;
    }
    if (!open) {
      items.push({ kind: 'entry', entry });
      continue;
    }
    if (key === 'teamAnnounced') {
      announced = team(entry);
      open.draft = null;
      open.team = announced;
      if (typeof entry.params?.leader === 'string') open.leader = entry.params.leader;
    } else if (key === 'teamFinalized') {
      const final = team(entry);
      open.draft = announced.length > 0 && announced.some((id) => !final.includes(id)) ? announced : null;
      open.team = final;
      if (typeof entry.params?.leader === 'string') open.leader = entry.params.leader;
    } else if (SPEECH_KEYS.has(key)) {
      open.speeches.push(entry);
    } else if (key === 'voteApproved' || key === 'voteRejected') {
      open.vote = entry;
    } else if ((key === 'missionSucceeded' || key === 'missionFailed') && open.vote?.key === 'voteApproved') {
      open.mission = entry;
    } else if (key === 'admin.proposalRetracted') {
      announced = [];
      open.draft = null;
      open.team = [];
      open.vote = null;
      open.notes.push(entry);
    } else if (key === 'discussionFinished') {
      // The card already shows the discussion ending in the final team.
    } else if (key.startsWith('admin.')) {
      open.notes.push(entry);
    } else {
      // Anything else (the lady, an assassination, the end) stands on its own line.
      open = null;
      items.push({ kind: 'entry', entry });
    }
  }
  return items;
}
