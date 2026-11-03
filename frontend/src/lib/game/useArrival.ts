import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The index of the item that just joined a growing list (a mission's seal, a
 * rejection), so it can be pressed into place. Whatever was already there on
 * mount — a refresh, a late join — arrives silently. `scope` starts a new list.
 */
export function useArrival(count: number, scope: unknown): number | null {
  const [arrival, setArrival] = useState<number | null>(null);
  const last = useRef({ count, scope });
  useLayoutEffect(() => {
    const previous = last.current;
    last.current = { count, scope };
    if (previous.scope === scope && count === previous.count + 1) setArrival(count - 1);
    else if (previous.scope !== scope || count < previous.count) setArrival(null);
  }, [count, scope]);
  return arrival;
}
