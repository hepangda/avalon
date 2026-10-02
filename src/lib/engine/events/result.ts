import type {
  Effect,
  EngineError,
  EngineErrorCode,
  EngineResult,
  GameState
} from '../types';

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

export function err(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } satisfies EngineError };
}

export function ok(state: GameState, effects: Effect[] = []): EngineResult {
  return { ok: true, state, effects };
}

/** Structured clone of plain state so reducers never mutate their input. */
export function clone(s: GameState): GameState {
  return structuredClone(s);
}
