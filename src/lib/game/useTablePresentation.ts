import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
} from 'react';
import type { ClientGameState } from '@/lib/engine';
import { useSoundCue } from '@/lib/audio/useSoundCue';
import { tablePresentationReducer } from './tablePresentation';

/** Presentation is local; the authoritative game continues to synchronize underneath it. */
export function useTablePresentation(game: ClientGameState | null) {
  const [state, dispatch] = useReducer(tablePresentationReducer, {
    game: null,
    queue: [],
  });
  useLayoutEffect(() => {
    dispatch({ type: 'sync', game });
  }, [game]);
  const current = state.queue[0]?.presentation ?? null;
  const reportGame = state.queue[0]?.reportGame ?? game;
  const finish = useCallback((id: string) => {
    dispatch({ type: 'finish', id });
  }, []);
  // The ballots turn over together (TableCard waits 0.15s), then the verdict.
  const vote = current?.kind === 'vote' ? current : null;
  useSoundCue(vote && 'flip', { key: vote?.id, count: Math.min(vote?.record.votes.length ?? 0, 4), interval: 0.03, delay: 0.2 });
  useSoundCue(vote && (vote.record.approved ? 'voteApprove' : 'voteReject'), { key: vote?.id, delay: 0.6 });
  useEffect(() => {
    if (current?.kind !== 'vote') return;
    const timer = setTimeout(() => finish(current.id), 2300);
    return () => clearTimeout(timer);
  }, [current, finish]);
  // The queue catches up with a new state one render late; until then a reveal may still be on its way.
  const settled = !current && state.game === game;
  return { presentation: current, reportGame, finish, settled };
}
