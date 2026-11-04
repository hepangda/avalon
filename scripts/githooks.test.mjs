import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const hook = join(root, '.githooks', 'commit-msg');

function runHook(message) {
  const directory = mkdtempSync(join(tmpdir(), 'avalon-commit-msg-'));
  const file = join(directory, 'message');
  writeFileSync(file, message);
  const result = spawnSync('sh', [hook, file], { encoding: 'utf8' });
  rmSync(directory, { recursive: true, force: true });
  return result;
}

test('accepts a single-line subject and ignores editor comments', () => {
  assert.equal(runHook('feat(table): reveal the mission cards\n').status, 0);
  assert.equal(runHook('feat(table): reveal the mission cards\n\n# Please enter the commit message\n#\n').status, 0);
});

test('accepts the trailer git writes for a revert', () => {
  const result = runHook('Revert "feat(table): reveal the mission cards"\n\nThis reverts commit 8a4c2f9d1b.\n');
  assert.equal(result.status, 0);
});

test('rejects a body', () => {
  const result = runHook('feat(table): reveal the mission cards\n\n- Split the reveal\n');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one line/);
});

test('rejects attribution trailers', () => {
  const result = runHook('feat(table): reveal the mission cards\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /attribution trailers/);
});

test('rejects generated attribution and empty messages', () => {
  assert.match(runHook('feat(table): reveal the mission cards\n\nGenerated with Claude Code\n').stderr, /generated/);
  assert.match(runHook('\n\n').stderr, /empty/);
});

test('is executable so git can run it directly', () => {
  assert.notEqual(statSync(hook).mode & 0o111, 0);
});
