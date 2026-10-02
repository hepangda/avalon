import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { staticPublishConfig } from "./static-config.mjs";

// Publish only the build manifest, never sync/delete a shared bucket or upload HTML.
const root = resolve(process.env.STATIC_BUILD_DIR || "dist/client");
const bucket = process.env.STATIC_R2_BUCKET;
assert.ok(bucket && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(bucket), "Set STATIC_R2_BUCKET to your target bucket name");
const base = staticPublishConfig(process.env);
const manifest = JSON.parse(
  await readFile(resolve(root, "static-assets.json"), "utf8"),
);
assert.equal(
  manifest.base,
  base,
  "Manifest does not match STATIC_ASSET_BASE_URL; build with the same CDN URL first",
);
assert.ok(manifest.files.length > 0);
const keys = new Set();
for (const file of manifest.files) {
  assert.match(
    file.file,
    /^assets\/(?:public\/[a-f0-9]{16}\/[\w./-]+|[\w-]+-[\w-]{8,}\.(?:js|css))$/,
  );
  assert.ok(!file.file.split("/").some((part) => part.startsWith(".")));
  assert.equal(file.key, `avalon/${file.file}`);
  assert.ok(!keys.has(file.key));
  keys.add(file.key);
  const bytes = await readFile(resolve(root, file.file));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    file.sha256,
    `Build changed: ${file.file}`,
  );
  assert.equal((await stat(resolve(root, file.file))).size, file.size);
}
console.log(
  `Validated ${keys.size} immutable assets (${manifest.files.reduce((sum, file) => sum + file.size, 0)} bytes) for ${bucket}/avalon/`,
);
if (!process.argv.includes("--upload")) {
  console.log(
    "Dry run only. Pass --upload to publish; no remote files will be deleted.",
  );
  process.exit(0);
}
for (const [index, file] of manifest.files.entries()) {
  let uploaded = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = spawnSync(
      process.env.WRANGLER_BINARY || "wrangler",
      [
        "r2",
        "object",
        "put",
        `${bucket}/${file.key}`,
        "--remote",
        "--file",
        resolve(root, file.file),
        "--content-type",
        file.contentType,
        "--cache-control",
        "public, max-age=31536000, immutable",
      ],
      { encoding: "utf8", env: process.env, timeout: 120_000 },
    );
    if (!result.error && result.status === 0) {
      uploaded = true;
      break;
    }
    if (attempt === 3) {
      throw new Error(
        `Upload failed for ${file.key}: ${result.error?.message ?? result.stderr}`,
      );
    }
    console.warn(`Retry ${attempt}/3: ${file.key}`);
    await setTimeout(attempt * 1000);
  }
  assert.ok(uploaded, file.key);
  console.log(`[${index + 1}/${keys.size}] ${file.key}`);
}
console.log(
  "Upload complete. Verify the CDN before rolling out the application.",
);
