import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ClientGameState } from '@/lib/engine';
import {
  newTablePresentations,
  sameTimeline,
  type TablePresentation,
} from './tablePresentation';

/** Presentation is local; the authoritative game continues to synchronize underneath it. */
export function useTablePresentation(game: ClientGameState | null) {
  const previous = useRef<ClientGameState | null>(null);
  const [queue, setQueue] = useState<TablePresentation[]>([]);
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = game;
    if (!game || (old && !sameTimeline(old, game))) {
      setQueue([]);
      return;
    }
    if (game) {
      const next = newTablePresentations(old, game);
      if (next.length) setQueue((items) => [...items, ...next]);
    }
  }, [game]);
  const current = queue[0] ?? null;
  const finish = useCallback((id: string) => {
    setQueue((items) => (items[0]?.id === id ? items.slice(1) : items));
  }, []);
  useEffect(() => {
    if (current?.kind !== 'vote') return;
    const timer = setTimeout(() => finish(current.id), 2300);
    return () => clearTimeout(timer);
  }, [current, finish]);
  return { presentation: current, finish };
}
