/** CPU comparison with backend/examples/benchmark_compare.rs. Fixture decoding,
 * RNG context setup, JSON encoding, SQL and network delivery are not timed. */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createGame, reduce, type CreateGameInput } from '../src/lib/engine/reducer';
import { createRng } from '../src/lib/engine/rng';
import { projectStateForViewer } from '../src/lib/engine/projection';
import type { GameEvent, ClientGameState } from '../src/lib/engine/types';

interface Trace {
  input: CreateGameInput;
  steps: Array<{ event: GameEvent; now: number; seed: string; error?: unknown }>;
}
const traces = JSON.parse(readFileSync('backend/tests/fixtures/engine-traces.json', 'utf8')) as Trace[];
const rounds = Number(process.argv[2] ?? 3);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error('Rounds must be 1–20');
const viewers = traces.map(t => [...t.input.players.map(p => p.id), 'observer']);
let retained: ClientGameState[] = [];
function run(collect: boolean) {
  const updates: number[] = [];
  const views: number[] = [];
  let checksum = 0;
  for (const [index, trace] of traces.entries()) {
    const created = createGame(trace.input);
    if (!created.ok) throw new Error(created.error.message);
    let state = created.state;
    for (const step of trace.steps) {
      if (step.error) continue; // rejected commands do not change either corpus
      const context = { now: step.now, rng: createRng(step.seed) };
      const started = performance.now();
      const result = reduce(state, step.event, context);
      const duration = performance.now() - started;
      if (!result.ok) throw new Error(result.error.message);
      if (collect) updates.push(duration);
      state = result.state;
      const projectedAt = performance.now();
      const projected = viewers[index]!.map(id => projectStateForViewer(state, id));
      const projectionDuration = performance.now() - projectedAt;
      if (collect) views.push(projectionDuration);
      retained = projected; // escape outputs; consume outside the timed region
      checksum += projected.reduce((n, v) => n + v.players.length + v.logs.length, 0);
    }
  }
  return { updates, views, checksum };
}
function stats(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  const q = (percent: number) => sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)]!;
  return { samples: sorted.length, p50_ms: q(.5), p95_ms: q(.95), p99_ms: q(.99) };
}
run(false); // full-corpus warmup, including V8 optimization
const updates: number[] = [], views: number[] = [], runs = [];
for (let i = 0; i < rounds; i++) {
  const result = run(true);
  updates.push(...result.updates); views.push(...result.views);
  runs.push({ update: stats(result.updates), views: stats(result.views), checksum: result.checksum });
}
console.log(JSON.stringify({ runtime: process.version, architecture: process.arch, rounds,
  traces: traces.length, update: stats(updates), views: stats(views), runs, retainedViews: retained.length }));
