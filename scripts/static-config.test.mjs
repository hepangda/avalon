import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { staticBase, staticPublishConfig } from './static-config.mjs';

test('optional builds and required publishers share URL validation', () => {
  assert.equal(staticBase(undefined), '/');
  assert.equal(staticBase(''), '/');
  assert.throws(() => staticPublishConfig({}));
  assert.throws(() => staticBase('http://cdn.example.com/avalon/'));
});

test('CDN publication requires an explicit HTTPS destination scoped to Avalon', () => {
  for (const value of [undefined, 'http://cdn.example.com/avalon/',
    'https://cdn.example.com/', 'https://user:password@cdn.example.com/avalon/',
    'https://cdn.example.com/avalon/?token=secret', 'https://cdn.example.com/avalon/#fragment']) {
    assert.throws(() => staticPublishConfig({ STATIC_ASSET_BASE_URL: value }));
  }
  assert.equal(staticPublishConfig({ STATIC_ASSET_BASE_URL: 'https://cdn.example.com/avalon/' }),
    'https://cdn.example.com/avalon/');
});

test('publisher validates a custom destination and rejects mismatches before uploading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avalon-static-test-'));
  try {
    const bytes = Buffer.from('console.log("fixture");');
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/index-12345678.js'), bytes);
    await writeFile(join(root, 'static-assets.json'), JSON.stringify({
      base: 'https://cdn.example.com/avalon/',
      files: [{ file: 'assets/index-12345678.js', key: 'avalon/assets/index-12345678.js',
        size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
        contentType: 'text/javascript; charset=utf-8' }],
    }));
    const env = { ...process.env, STATIC_BUILD_DIR: root,
      STATIC_R2_BUCKET: 'example-assets', STATIC_ASSET_BASE_URL: 'https://cdn.example.com/avalon/',
      // No real uploader may run, even if a regression reaches the upload stage.
      WRANGLER_BINARY: join(root, 'no-uploader') };
    const run = (overrides, upload = false, flags = []) => spawnSync(process.execPath,
      ['scripts/publish-static.mjs', ...(upload ? ['--upload'] : []), ...flags],
      { env: { ...env, ...overrides }, encoding: 'utf8' });
    const valid = run({});
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /Dry run only/);
    for (const [override, message] of [
      [{ STATIC_R2_BUCKET: '' }, /Set STATIC_R2_BUCKET/],
      [{ STATIC_ASSET_BASE_URL: '' }, /Set STATIC_ASSET_BASE_URL/],
      [{ STATIC_ASSET_BASE_URL: 'https://other.example.com/avalon/' }, /Manifest does not match/],
    ]) {
      const invalid = run(override, true);
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stderr, message);
      assert.doesNotMatch(invalid.stderr, /Upload failed/);
    }
    // --force uploads every asset without probing the CDN.
    const uploader = join(root, 'uploader');
    await writeFile(uploader, `#!/bin/sh\necho "$@" >> "${join(root, 'uploads')}"\n`, { mode: 0o755 });
    const forced = run({ WRANGLER_BINARY: uploader }, true, ['--force']);
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /0 assets already published; uploading 1/);
    assert.equal(await readFile(join(root, 'uploads'), 'utf8'),
      `r2 object put example-assets/avalon/assets/index-12345678.js --remote --file ${join(root, 'assets/index-12345678.js')} ` +
      '--content-type text/javascript; charset=utf-8 --cache-control public, max-age=31536000, immutable\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
