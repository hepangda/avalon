import type { Ack } from '../types';

/** One in-flight sample per connection; failures and stale replies are not RTTs. */
export function createLatencyHeartbeat(
  send: (rtt: number | undefined) => Promise<Ack<unknown>>,
  publish: (latency: number | null) => void,
  onAck?: (ack: Ack<unknown>) => void,
) {
  let lastRtt: number | undefined;
  let pending = false;
  let generation = 0;
  let disposed = false;

  function reset() {
    generation++;
    pending = false;
    lastRtt = undefined;
  }

  return {
    async ping() {
      if (pending || disposed) return;
      pending = true;
      const current = generation;
      const sent = performance.now();
      try {
        const res = await send(lastRtt);
        if (disposed || current !== generation) return;
        lastRtt = res.ok ? Math.round(performance.now() - sent) : undefined;
        publish(lastRtt ?? null);
        onAck?.(res);
      } catch {
        if (disposed || current !== generation) return;
        lastRtt = undefined;
        publish(null);
      } finally {
        if (current === generation) pending = false;
      }
    },
    reset,
    dispose() {
      disposed = true;
      reset();
    },
  };
}
