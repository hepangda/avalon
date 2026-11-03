import type {
  ClientGameState,
  GameEvent,
  GameOptions,
  GameState,
  PlayerId,
} from "@/lib/engine";

/**
 * The authoritative Rust rules engine compiled to WebAssembly. Only the debug
 * gallery and frontend tests load it; live games run on the server.
 */
interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  call(ptr: number, len: number): bigint;
}

export class EngineRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CreateGameInput {
  hostId: PlayerId;
  players: Array<{ id: PlayerId; name: string }>;
  options: GameOptions;
  seed: string;
}

/** Where the Vite dev server serves the engine it builds from `backend/engine`. */
export const ENGINE_WASM_URL = "/debug/engine.wasm";

let wasm: Exports | null = null;

export function instantiateEngine(module: WebAssembly.Module) {
  wasm = new WebAssembly.Instance(module).exports as unknown as Exports;
}

export async function loadEngine(url = ENGINE_WASM_URL) {
  if (!wasm) instantiateEngine(await WebAssembly.compileStreaming(fetch(url)));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function call<T>(request: object): T {
  if (!wasm) throw new Error("The rules engine has not been loaded");
  const input = encoder.encode(JSON.stringify(request));
  const ptr = wasm.alloc(input.length);
  new Uint8Array(wasm.memory.buffer, ptr, input.length).set(input);
  const packed = wasm.call(ptr, input.length);
  wasm.dealloc(ptr, input.length);
  const out = Number(packed >> 32n);
  const len = Number(packed & 0xffffffffn);
  const reply = JSON.parse(
    decoder.decode(new Uint8Array(wasm.memory.buffer, out, len)),
  ) as { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
  wasm.dealloc(out, len);
  if (!reply.ok) throw new EngineRejection(reply.error.code, reply.error.message);
  return reply.value;
}

export function createGame(input: CreateGameInput): GameState {
  return call({ op: "createGame", input });
}

/** Default clock: one simulated second per log entry keeps timers deterministic. */
export function clockFor(state: GameState): number {
  return 1_800_000_000_000 + state.logSeq * 1000;
}

/** Resolves randomness as a live room does, then applies the event. */
export function applyEvent(
  state: GameState,
  event: GameEvent,
  now = clockFor(state),
): GameState {
  return call({ op: "apply", state, event, now });
}

export function projectStateForViewer(state: GameState, viewer: PlayerId): ClientGameState {
  return call({ op: "project", state, viewer });
}
