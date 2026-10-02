import { createHash } from 'node:crypto';
import { mkdtemp, realpath, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { createFrontendApp } from '../server/static-files';
import { staticAssets } from './static-assets';

it.each(['/', 'https://cdn.example.com/avalon/'])('emits one hashed copy and rewrites HTML for base %s', async (base) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'avalon-assets-test-')));
  try {
    const publicDir = join(root, 'public');
    const outDir = join(root, 'out');
    await mkdir(join(publicDir, 'assets/game'), { recursive: true });
    for (const name of ['favicon.ico', 'apple-touch-icon.png', 'assets/game/card.webp']) {
      await writeFile(join(publicDir, name), `fixture:${name}`);
    }
    await writeFile(join(publicDir, '.DS_Store'), 'private finder data');
    await writeFile(join(root, 'index.html'), '<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><script type="module" src="/main.js"></script>');
    await writeFile(join(root, 'main.js'), 'globalThis.assets = __PUBLIC_ASSET_URLS__;');
    await build({ configFile: false, root, publicDir, base, logLevel: 'silent', plugins: [staticAssets(publicDir, base)], build: { outDir } });
    const manifest = JSON.parse(await readFile(join(outDir, 'static-assets.json'), 'utf8')) as {
      base: string; files: Array<{ file: string; size: number; sha256: string; contentType: string }>;
    };
    expect(manifest.base).toBe(base);
    const paths = await readdir(outDir, { recursive: true });
    expect(paths).not.toContain('.DS_Store');
    expect(paths).not.toContain('favicon.ico');
    expect(paths).not.toContain('assets/game/card.webp');
    expect(manifest.files.filter((f) => /\.(ico|png|webp)$/.test(f.file))).toHaveLength(3);
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    const js = manifest.files.find((f) => f.file.endsWith('.js'))!;
    const script = await readFile(join(outDir, js.file), 'utf8');
    const app = createFrontendApp(outDir);
    for (const file of manifest.files) {
      const bytes = await readFile(join(outDir, file.file));
      expect(bytes.length).toBe(file.size);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      if (/\.(ico|png)$/.test(file.file)) expect(html).toContain(base + file.file);
      if (/\.(ico|png|webp)$/.test(file.file)) expect(script).toContain(base + file.file);
      if (/\.(ico|png|webp)$/.test(file.file)) {
        const original = '/' + file.file.replace(/^assets\/public\/[a-f0-9]{16}\//, '');
        const alias = await app.request(original);
        expect(alias.status).toBe(302);
        expect(alias.headers.get('Location')).toBe(base + file.file);
        expect(alias.headers.get('Cache-Control')).toBe('no-store');
      }
      const response = await app.request('/' + file.file);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toContain('immutable');
      expect(response.headers.get('Content-Type')?.split(';')[0]).toBe(file.contentType.split(';')[0]);
      await response.arrayBuffer();
    }
    expect((await app.request('/assets/missing.webp')).status).toBe(404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
