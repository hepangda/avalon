import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyCacheHit } from './static-cache.mjs';

const bytes = new TextEncoder().encode('immutable asset');
const file = { key: 'avalon/assets/test.js', size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
const reply = (cache, status = 200, body = bytes) => ({ response: new Response(null, { status, headers: { 'cf-cache-status': cache } }), bytes: body });

test('cold edge cache is allowed to warm up before requiring a HIT', async () => {
  const replies = ['MISS', 'MISS', 'HIT'];
  const delays = [];
  await verifyCacheHit(file, async () => reply(replies.shift()), async (delay) => delays.push(delay));
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(replies.length, 0);
});

test('persistent MISS and non-cacheable responses still fail deployment checks', async () => {
  let requests = 0;
  await assert.rejects(verifyCacheHit(file, async () => { requests++; return reply('MISS'); }, async () => {}), /after 5 attempts/);
  assert.equal(requests, 5);
  for (const status of ['DYNAMIC', 'BYPASS', 'UNKNOWN']) {
    await assert.rejects(verifyCacheHit(file, async () => reply(status)), /unexpected Cloudflare cache status/);
  }
});

test('HIT never hides an HTTP error or corrupted contents', async () => {
  await assert.rejects(verifyCacheHit(file, async () => reply('HIT', 503)));
  const wrong = new Uint8Array(bytes.byteLength).fill(120);
  await assert.rejects(verifyCacheHit(file, async () => reply('HIT', 200, wrong)));
});
