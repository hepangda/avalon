import { buildEngineWasm } from "./engine-wasm";

export default async function setup() {
  await buildEngineWasm();
}
