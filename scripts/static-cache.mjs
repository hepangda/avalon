import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

// A cold edge can return MISS while the cache fills. Still require an actual
// HIT within a bounded window; BYPASS/DYNAMIC must not silently pass a release.
export async function verifyCacheHit(file, download, wait = setTimeout) {
  let status;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { response, bytes } = await download(file);
    assert.equal(response.status, 200, file.key);
    assert.equal(bytes.byteLength, file.size, file.key);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.key);
    status = response.headers.get('cf-cache-status');
    if (status === 'HIT') return;
    assert.ok(['MISS', 'EXPIRED', 'REVALIDATED', 'UPDATING'].includes(status),
      `${file.key}: unexpected Cloudflare cache status ${status}`);
    if (attempt < 5) await wait(attempt * 1000);
  }
  throw new Error(`${file.key}: Cloudflare cache did not reach HIT after 5 attempts (last: ${status})`);
}
