import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { staticPublishConfig } from "./static-config.mjs";

const base = staticPublishConfig(process.env);
assert.ok(process.env.PUBLIC_ORIGIN, "Set PUBLIC_ORIGIN to the app's browser-facing origin");
const origin = new URL(process.env.PUBLIC_ORIGIN).origin;
const root = resolve(process.env.STATIC_BUILD_DIR || "dist/client");
const manifest = JSON.parse(
  await readFile(resolve(root, "static-assets.json"), "utf8"),
);
assert.equal(manifest.base, base, "Manifest does not match STATIC_ASSET_BASE_URL");
assert.ok(manifest.files.length > 0, "No assets to verify");
const pending = [...manifest.files];
let verified = 0;
async function download(file) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(new URL(file.file, manifest.base), {
        headers: { Origin: origin },
        signal: AbortSignal.timeout(30_000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { response, bytes };
    } catch (error) {
      if (attempt === 3)
        throw new Error(`Could not download ${file.key}`, { cause: error });
      console.warn(`Retry ${attempt}/3: ${file.key}`);
    }
  }
}
async function verify() {
  for (let file; (file = pending.shift());) {
    const { response, bytes } = await download(file);
    assert.equal(response.status, 200, file.key);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "*",
      file.key,
    );
    assert.match(
      response.headers.get("cache-control") ?? "",
      /max-age=31536000.*immutable/,
      file.key,
    );
    assert.equal(
      response.headers.get("content-type")?.split(";")[0],
      file.contentType.split(";")[0],
      file.key,
    );
    assert.equal(bytes.byteLength, file.size, file.key);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      file.sha256,
      file.key,
    );
    verified++;
    if (verified % 10 === 0)
      console.log(`Verified ${verified}/${manifest.files.length} assets`);
  }
}
await Promise.all(Array.from({ length: 4 }, verify));
console.log(
  `Verified ${verified} CDN assets: contents, MIME, CORS, immutable cache headers`,
);
for (const file of [
  manifest.files.find((file) => file.file.endsWith(".js")),
  manifest.files.find((file) => file.file.endsWith(".webp")),
]) {
  assert.ok(file);
  const { response } = await download(file);
  assert.equal(response.headers.get("cf-cache-status"), "HIT", file.key);
  console.log(`Cloudflare HIT: ${file.key}`);
}
