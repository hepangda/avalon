import type { CueKind } from '@/components/game/ResultOverlay';

export interface CueCounts {
  votes: number;
  missions: number;
}

/** The active cue: what happened and which round it belongs to. */
export interface ActiveCue {
  kind: CueKind;
  roundIndex: number;
}

export interface CueDecision {
  cue: ActiveCue | null;
  next: CueCounts;
}

/**
 * Pure decision for the result-cue hook. Given the previously-seen counts and
 * the current game history, decide which cue (if any) to fire and the updated
 * counts. A mission completion takes priority over a vote in the same tick.
 *
 * `prev` null = first observation (initial load / reconnect): record a baseline
 * and fire nothing, so a freshly-synced full history never replays old cues.
 */
export function decideCue(
  prev: CueCounts | null,
  current: {
    voteHistory: ReadonlyArray<{ approved: boolean; roundIndex: number }>;
    missionResults: ReadonlyArray<{ success: boolean; roundIndex: number }>;
  },
): CueDecision {
  const votes = current.voteHistory.length;
  const missions = current.missionResults.length;
  const next: CueCounts = { votes, missions };

  if (prev === null) return { cue: null, next };

  if (missions > prev.missions) {
    const last = current.missionResults[missions - 1];
    return {
      cue: last
        ? { kind: last.success ? 'missionSuccess' : 'missionFail', roundIndex: last.roundIndex }
        : null,
      next,
    };
  }
  if (votes > prev.votes) {
    const last = current.voteHistory[votes - 1];
    return {
      cue: last
        ? { kind: last.approved ? 'voteApproved' : 'voteRejected', roundIndex: last.roundIndex }
        : null,
      next,
    };
  }
  return { cue: null, next };
}
