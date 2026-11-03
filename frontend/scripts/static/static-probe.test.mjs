import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unpublishedFiles } from './static-probe.mjs';

const base = 'https://cdn.example.com/avalon/';
const asset = (file, size, contentType) => ({ file, key: `avalon/${file}`, size, contentType, sha256: 'a'.repeat(64) });
const immutable = 'public, max-age=31536000, immutable';

function fakeCdn(objects) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: new URL(url), init });
    const object = objects[new URL(url).pathname];
    if (object instanceof Error) throw object;
    if (!object) return new Response(null, { status: 404 });
    return new Response(null, { status: 200, headers: object });
  };
  return { requests, fetchImpl };
}

test('uploads only assets the CDN origin does not already serve unchanged', async () => {
  const files = [
    asset('assets/index-12345678.js', 10, 'text/javascript; charset=utf-8'),
    asset('assets/public/0123456789abcdef/a.webp', 20, 'image/webp'),
    asset('assets/missing-12345678.js', 30, 'text/javascript'),
    asset('assets/public/0123456789abcdef/short.webp', 40, 'image/webp'),
    asset('assets/public/0123456789abcdef/type.webp', 50, 'image/webp'),
    asset('assets/public/0123456789abcdef/cache.webp', 60, 'image/webp'),
    asset('assets/public/0123456789abcdef/compressed.webp', 70, 'image/webp'),
    asset('assets/public/0123456789abcdef/offline.webp', 80, 'image/webp'),
  ];
  const { requests, fetchImpl } = fakeCdn({
    '/avalon/assets/index-12345678.js': { 'content-length': '10', 'content-type': 'text/javascript', 'cache-control': immutable },
    '/avalon/assets/public/0123456789abcdef/a.webp': { 'content-length': '20', 'content-type': 'image/webp', 'cache-control': immutable },
    '/avalon/assets/public/0123456789abcdef/short.webp': { 'content-length': '39', 'content-type': 'image/webp', 'cache-control': immutable },
    '/avalon/assets/public/0123456789abcdef/type.webp': { 'content-length': '50', 'content-type': 'image/png', 'cache-control': immutable },
    '/avalon/assets/public/0123456789abcdef/cache.webp': { 'content-length': '60', 'content-type': 'image/webp', 'cache-control': 'max-age=14400' },
    '/avalon/assets/public/0123456789abcdef/compressed.webp': { 'content-type': 'image/webp', 'cache-control': immutable },
    '/avalon/assets/public/0123456789abcdef/offline.webp': new TypeError('fetch failed'),
  });
  const pending = await unpublishedFiles(files, base, fetchImpl);
  assert.deepEqual(pending, files.slice(2));
  assert.equal(requests.length, files.length);
  for (const { init } of requests) {
    assert.equal(init.method, 'HEAD');
    assert.equal(init.headers['Accept-Encoding'], 'identity');
  }
});

test('probes bypass the cached asset URL with one nonce per run', async () => {
  const files = [asset('assets/a-12345678.js', 1, 'text/javascript'), asset('assets/b-12345678.js', 1, 'text/javascript')];
  const first = fakeCdn({});
  const second = fakeCdn({});
  await unpublishedFiles(files, base, first.fetchImpl);
  await unpublishedFiles(files, base, second.fetchImpl);
  const nonces = (requests) => new Set(requests.map(({ url }) => url.searchParams.get('publish')));
  assert.equal(nonces(first.requests).size, 1);
  assert.match([...nonces(first.requests)][0], /^[a-f0-9]{16}$/);
  assert.notDeepEqual(nonces(first.requests), nonces(second.requests));
  assert.deepEqual(first.requests.map(({ url }) => url.origin + url.pathname).sort(),
    files.map((file) => new URL(file.file, base).href).sort());
});
