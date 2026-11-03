import { readFileSync } from "node:fs";
import { instantiateEngine } from "../src/lib/debug/rustEngine";
import { ENGINE_WASM_PATH } from "./engine-wasm";

// Test files that build game states run the same Rust rules as the server.
instantiateEngine(new WebAssembly.Module(readFileSync(ENGINE_WASM_PATH)));
