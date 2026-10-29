import type { Ack } from '../types';

/** State-integrity heartbeat; transport RTT is measured by the Rust server. */
export function createSyncHeartbeat(
  send: () => Promise<Ack<unknown>>,
  onAck?: (ack: Ack<unknown>) => void,
) {
  let pending = false;
  let generation = 0;
  let disposed = false;

  function reset() {
    generation++;
    pending = false;
  }

  return {
    async ping() {
      if (pending || disposed) return;
      pending = true;
      const current = generation;
      try {
        const res = await send();
        if (disposed || current !== generation) return;
        onAck?.(res);
      } catch {
        if (disposed || current !== generation) return;
        // Connection recovery handles failed requests.
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
