import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { ENGINE_WASM_URL } from "../src/lib/debug/rustEngine";

// Plain paths: DOM test environments replace the global URL class.
const backend = join(dirname(fileURLToPath(import.meta.url)), "../../backend");
export const ENGINE_WASM_PATH = join(backend, "target/wasm32-unknown-unknown/wasm/avalon_engine_wasm.wasm");

let pending: Promise<string> | null = null;

/**
 * Compiles the Rust rules engine to WebAssembly. Cargo makes repeat builds
 * no-ops, so callers may run this on every request to pick up rule edits.
 */
export function buildEngineWasm(): Promise<string> {
  pending ??= new Promise<string>((resolve, reject) => {
    const cargo = spawn(
      "cargo",
      [
        "build",
        "--locked",
        "--quiet",
        "--manifest-path",
        join(backend, "Cargo.toml"),
        "-p",
        "avalon-engine-wasm",
        "--target",
        "wasm32-unknown-unknown",
        "--profile",
        "wasm",
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    cargo.once("error", reject);
    cargo.once("exit", (code) =>
      code === 0
        ? resolve(ENGINE_WASM_PATH)
        : reject(new Error(`Building the rules engine for WebAssembly failed (exit ${code})`)),
    );
  }).finally(() => {
    pending = null;
  });
  return pending;
}

/** Serves a freshly built engine to the debug gallery; production builds never see it. */
export function engineWasm(): Plugin {
  return {
    name: "avalon-engine-wasm",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(ENGINE_WASM_URL, (_req, res, next) => {
        buildEngineWasm()
          .then((path) => readFile(path))
          .then((bytes) => {
            res.setHeader("Content-Type", "application/wasm");
            res.setHeader("Cache-Control", "no-store");
            res.end(bytes);
          })
          .catch(next);
      });
    },
  };
}
