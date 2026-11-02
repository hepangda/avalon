import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const resolver = fileURLToPath(new URL('../deploy/release/resolve-commit.sh', import.meta.url));
const vmTests = fileURLToPath(new URL('../deploy/release/test_vm_rollout.py', import.meta.url));
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

test('VM rollout safety and restricted SSH gateway', () => {
  const result = spawnSync('python3', [vmTests], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('SSH failure cannot be hidden by a healthy public endpoint', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'avalon-ssh-release-'));
  try {
    writeFileSync(join(cwd, 'ssh'), '#!/bin/sh\nexit 17\n', { mode: 0o755 });
    writeFileSync(join(cwd, 'curl'), '#!/bin/sh\ntouch "$PUBLIC_CHECK"\nprintf \'{"ok":true}\'\n', { mode: 0o755 });
    const result = spawnSync('bash', [rollout, `ghcr.io/hepangda/avalon@sha256:${'a'.repeat(64)}`, `sha-${'c'.repeat(40)}`], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${cwd}:${process.env.PATH}`, VM_HOST: 'example.invalid', VM_USER: 'deploy',
        VM_SSH_KEY_FILE: '/unused/key', VM_SSH_KNOWN_HOSTS_FILE: '/unused/hosts',
        PUBLIC_ORIGIN: 'https://example.invalid', PUBLIC_CHECK: join(cwd, 'public-check') },
    });
    assert.equal(result.status, 17, result.stderr);
    assert.equal(existsSync(join(cwd, 'public-check')), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
