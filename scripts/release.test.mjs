import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const resolver = fileURLToPath(new URL('../deploy/release/resolve-commit.sh', import.meta.url));
const rollout = fileURLToPath(new URL('../deploy/release/rollout.sh', import.meta.url));

test('release resolves main and abbreviated commits, rejecting tags and commits outside main', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'avalon-commit-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const resolve = (ref) => spawnSync('bash', [resolver, ref], { cwd, encoding: 'utf8' });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release Test');
    git('config', 'user.email', 'release@example.invalid');
    git('commit', '--allow-empty', '-m', 'first');
    const first = git('rev-parse', 'HEAD');
    git('commit', '--allow-empty', '-m', 'second');
    const latest = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', latest);
    assert.equal(resolve('main').stdout.trim(), latest);
    assert.equal(resolve(first.slice(0, 7)).stdout.trim(), first);
    assert.equal(resolve(first).stdout.trim(), first);
    git('checkout', '-b', 'side', first);
    git('commit', '--allow-empty', '-m', 'not on main');
    const side = git('rev-parse', 'HEAD');
    for (const ref of [side, 'v0.1.2', '--help', 'main~1', '$(touch injected)', '0000000']) {
      assert.notEqual(resolve(ref).status, 0, ref);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('GHCR rollout patches pull credentials and image together and can restore Harbor', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'avalon-rollout-'));
  const image = `ghcr.io/hepangda/avalon@sha256:${'a'.repeat(64)}`;
  const previous = `harbor.example/avalon@sha256:${'b'.repeat(64)}`;
  try {
    writeFileSync(join(cwd, 'kubectl'), `#!/usr/bin/env bash
shift 2
case "$1" in
  get) printf '%s' "$PREVIOUS" ;;
  patch) printf '%s\\n' "\${@: -1}" >> "$PATCH_LOG" ;;
  rollout) test "$(wc -l < "$PATCH_LOG")" -gt 1 ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(cwd, 'curl'), '#!/usr/bin/env bash\nprintf \'{"ok":true}\'\n', { mode: 0o755 });
    const log = join(cwd, 'patches');
    const result = spawnSync('bash', [rollout, image, `sha-${'c'.repeat(40)}`], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${cwd}:${process.env.PATH}`, PREVIOUS: previous,
        PATCH_LOG: log, K8S_NAMESPACE: 'avalon', K8S_DEPLOYMENT: 'avalon',
        K8S_CONTAINER: 'avalon', K8S_IMAGE_PULL_SECRET: 'ghcr-pull', PUBLIC_ORIGIN: 'https://example.invalid' },
    });
    assert.equal(result.status, 1, result.stderr);
    const patches = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(patches.length, 2);
    assert.equal(patches[0].spec.template.spec.containers[0].image, image);
    assert.deepEqual(patches[0].spec.template.spec.imagePullSecrets, [{ name: 'ghcr-pull' }]);
    assert.equal(patches[1].spec.template.spec.containers[0].image, previous);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
