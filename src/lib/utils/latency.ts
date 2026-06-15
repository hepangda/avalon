/**
 * Connection-quality thresholds (round-trip latency in ms) and helpers for the
 * online-status dots. Green = healthy, amber = laggy, red = very laggy, and a
 * hollow gray ring = disconnected.
 */

const LAG_MS = 150;
const HEAVY_LAG_MS = 400;

/** Tailwind classes for a connection-status dot, given connection + latency. */
export function latencyDotClass(connected: boolean, latency?: number): string {
  if (!connected) {
    // Hollow gray ring — visibly different from any filled state.
    return 'border border-parchment/40 bg-transparent';
  }
  if (latency === undefined) return 'bg-emerald-400';
  if (latency >= HEAVY_LAG_MS) return 'bg-red-500';
  if (latency >= LAG_MS) return 'bg-amber-400';
  return 'bg-emerald-400';
}

/** Format self latency for the header indicator, e.g. "42 ms". */
export function formatLatency(ms: number | null): string {
  if (ms === null) return '— ms';
  return `${ms} ms`;
}

/** Text-color class mirroring the dot tone, for the self-latency number. */
export function latencyTextClass(ms: number | null): string {
  if (ms === null) return 'text-parchment/40';
  if (ms >= HEAVY_LAG_MS) return 'text-red-400';
  if (ms >= LAG_MS) return 'text-amber-400';
  return 'text-emerald-400';
}
