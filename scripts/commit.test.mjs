import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommitPrompt, messageViolations, parseArgs, resolvePiBin, resolveSkillDir } from './commit.mjs';

test('prompt forces the arrange-commits skill with single-line messages', () => {
  const prompt = buildCommitPrompt({ hint: 'keep backend and frontend apart' });
  assert.match(prompt, /^\/skill:git-arrange-commits /);
  assert.match(prompt, /Every commit message is exactly one line/);
  assert.match(prompt, /Never add attribution such as Co-authored-by/);
  assert.match(prompt, /Additional instruction from the user: keep backend and frontend apart/);
  assert.doesNotMatch(prompt, /Dry run/);
});

test('dry run asks for a plan instead of commits', () => {
  const prompt = buildCommitPrompt({ dryRun: true });
  assert.match(prompt, /Dry run: report the commit plan/);
});

test('arguments split Pi passthrough flags from the free-form hint', () => {
  const options = parseArgs(['--dry-run', '--model', 'deepseek-flash', 'split', 'cli', 'work']);
  assert.deepEqual(options, {
    dryRun: true, printPrompt: false, check: false, all: false, model: 'deepseek-flash',
    approve: false, help: false, hint: 'split cli work',
  });
  assert.equal(parseArgs(['--', '--dry-run']).hint, '--dry-run');
  assert.throws(() => parseArgs(['--model']), /--model requires a value/);
});

test('PI_BIN wins over the installed Pi executable', () => {
  assert.equal(resolvePiBin({ PI_BIN: '/opt/custom/pi' }, () => true), '/opt/custom/pi');
  assert.equal(resolvePiBin({}, path => path.endsWith('/.pi/agent/bin/pi')), `${process.env.HOME}/.pi/agent/bin/pi`);
  assert.equal(resolvePiBin({}, () => false), 'pi');
});

test('the skill committed in the repository wins over the user install', () => {
  const local = '/repo/.agents/skills/git-arrange-commits';
  assert.equal(resolveSkillDir('/repo', {}, path => path === local), local);
  assert.equal(resolveSkillDir('/repo', { PI_ARRANGE_SKILL: '/custom/skill' }, () => true), '/custom/skill');
  assert.match(resolveSkillDir('/repo', {}, () => false), /\.agents\/skills\/git-arrange-commits$/);
});

test('message rules reject bodies and attribution but accept git trailers', () => {
  assert.equal(messageViolations('feat(table): reveal the mission cards\n'), null);
  assert.equal(messageViolations('Revert "feat(table): reveal the mission cards"\n\nThis reverts commit 8a4c2f9d1b.\n'), null);
  assert.equal(messageViolations('feat(table): reveal the mission cards\n\nBody explains the change.\n'), 'body');
  assert.equal(messageViolations('feat(table): reveal the mission cards\n\nCo-Authored-By: Someone <a@b>\n'), 'attribution trailer');
  assert.equal(messageViolations('feat(table): reveal cards, generated with Claude Code'), 'generated attribution');
  assert.equal(messageViolations('\n \n'), 'empty message');
});
