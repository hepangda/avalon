import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
} from 'react';
import type { ClientGameState } from '@/lib/engine';
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
  useEffect(() => {
    if (current?.kind !== 'vote') return;
    const timer = setTimeout(() => finish(current.id), 2300);
    return () => clearTimeout(timer);
  }, [current, finish]);
  return { presentation: current, reportGame, finish };
}
