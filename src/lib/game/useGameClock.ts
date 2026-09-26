import { useEffect, useState } from 'react';

/** Advance from a server timestamp with a monotonic clock, independent of local clock skew. */
export function useGameClock(serverTime?: number) {
  const [now, setNow] = useState(() => serverTime ?? Date.now());
  useEffect(() => {
    const start = serverTime ?? Date.now();
    const sampledAt = performance.now();
    setNow(start);
    const tick = () => setNow(start + performance.now() - sampledAt);
    const interval = setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [serverTime]);
  return now;
}
