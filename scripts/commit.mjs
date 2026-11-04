import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

const SKILL = 'git-arrange-commits';
const RULES = [
  'Group the changes by purpose and dependency, not by file extension or directory.',
  'Every commit message is exactly one line: no body, no bullet list, no signature or trailer.',
  'Never add attribution such as Co-authored-by, Signed-off-by, Generated-by, Assisted-by, a tool or model name, or an emoji signature, even when a tool offers to.',
  'Follow the conventions already used in this repository. Never rewrite existing history,',
  'switch branches, push, tag, release, or deploy.',
  'Verify the staged diff and run the repository checks that apply to it.',
  'Report each created commit as "<short-sha> <subject>", the checks you ran, and anything left uncommitted.',
].join('\n');

const ATTRIBUTION = /^\s*[a-z-]+-by:/i;
const GENERATED = /generated with|generated-by|assisted-by|claude code|copilot/i;
const GIT_TRAILER = /^(This reverts commit [0-9a-f]{7,40}\.|This is a combination of \d+ commits\.|\(cherry picked from commit [0-9a-f]{7,40}\))$/;

/** Explain why a message breaks the commit rules, or return null when it complies. */
export function messageViolations(message) {
  const lines = message.split('\n').map(line => line.trimEnd()).filter(line => line.trim() !== '');
  if (!lines.length) return 'empty message';
  if (lines.some(line => ATTRIBUTION.test(line))) return 'attribution trailer';
  if (lines.some(line => GENERATED.test(line))) return 'generated attribution';
  if (lines.slice(1).some(line => !GIT_TRAILER.test(line))) return 'body';
  return null;
}

/** Build the prompt handed to the agent; the skill is forced so the workflow cannot be skipped. */
export function buildCommitPrompt({ hint = '', dryRun = false } = {}) {
  const request = hint.trim();
  const lines = [
    `/skill:${SKILL} Arrange the current working-tree changes into reviewable local commits.`,
    '',
    RULES,
  ];
  if (request) lines.push('', `Additional instruction from the user: ${request}`);
  if (dryRun) lines.push('', 'Dry run: report the commit plan you would create without staging or committing anything.');
  return lines.join('\n');
}

/** Resolve the Pi executable: explicit override, then the user install, then PATH. */
export function resolvePiBin(env = process.env, exists = existsSync) {
  if (env.PI_BIN) return env.PI_BIN;
  const installed = join(homedir(), '.pi', 'agent', 'bin', 'pi');
  return exists(installed) ? installed : 'pi';
}

/** Prefer the skill committed in this repository so collaborators get the same workflow. */
export function resolveSkillDir(repoRoot = root, env = process.env, exists = existsSync) {
  if (env.PI_ARRANGE_SKILL) return env.PI_ARRANGE_SKILL;
  const local = join(repoRoot, '.agents', 'skills', SKILL);
  return exists(local) ? local : join(homedir(), '.agents', 'skills', SKILL);
}

/** Parse CLI arguments into Pi passthrough flags and a free-form hint. */
export function parseArgs(argv) {
  const options = {
    dryRun: false, printPrompt: false, check: false, all: false, model: undefined, approve: false, help: false, hint: '',
  };
  const hint = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--print-prompt') options.printPrompt = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--approve') options.approve = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--model') {
      const value = argv[index + 1];
      if (!value) throw new Error('--model requires a value');
      options.model = value;
      index += 1;
    } else if (arg === '--') {
      hint.push(...argv.slice(index + 1));
      break;
    } else hint.push(arg);
  }
  options.hint = hint.join(' ').trim();
  return options;
}

function git(args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

function usage() {
  return [
    'Usage: npm run commit [-- <hint>] [options]',
    '',
    'Arranges the current working-tree changes into single-line local commits',
    `through the ${SKILL} skill, using Pi in prompt mode.`,
    '',
    'Options:',
    '  --dry-run          Let the agent plan the commits without staging or committing',
    '  --print-prompt     Print the prompt sent to Pi and exit',
    '  --check            Audit commit messages ahead of upstream and exit',
    '  --all              With --check, audit the whole reachable history',
    '  --model <pattern>  Run Pi with a specific model',
    '  --approve          Trust project-local Pi configuration for this run',
    '  -h, --help         Show this help',
    '',
    'Examples:',
    '  npm run commit',
    '  npm run commit -- split backend and frontend work',
    '  npm run commit -- --dry-run',
  ].join('\n');
}

function audit(all) {
  const upstream = all ? null : git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const range = upstream?.status === 0 ? '@{upstream}..HEAD' : 'HEAD';
  const log = git(['log', '--format=%H%x00%B%x01', range]);
  if (log.status !== 0) throw new Error(log.stderr.trim() || 'git log failed');
  const entries = log.stdout.split('\x01').filter(entry => entry.trim() !== '');
  const offenders = entries.map(entry => {
    const [sha, ...rest] = entry.split('\x00');
    const message = rest.join('\x00');
    return { sha: sha.trim(), subject: (message.trim().split('\n')[0] ?? '').trim(), reason: messageViolations(message) };
  }).filter(entry => entry.reason);

  if (!offenders.length) {
    console.log(`Commit messages are compliant (${entries.length} commit(s) audited).`);
    return;
  }
  for (const offender of offenders) console.error(`${offender.sha.slice(0, 9)} ${offender.reason}: ${offender.subject}`);
  console.error(`${offenders.length} commit(s) break the rules. Run \`npm run commit\` to rewrite them through the skill.`);
  process.exitCode = 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.check) {
    audit(options.all);
    return;
  }

  const status = git(['status', '--porcelain']);
  if (status.error) throw new Error('git is unavailable');
  if (status.status !== 0) throw new Error(status.stderr.trim() || 'git status failed');
  if (!status.stdout.trim()) {
    console.log('Working tree is clean. Nothing to commit.');
    return;
  }

  const prompt = buildCommitPrompt(options);
  if (options.printPrompt) {
    console.log(prompt);
    return;
  }

  const args = ['--print', '--skill', resolveSkillDir()];
  if (options.model) args.push('--model', options.model);
  if (options.approve) args.push('--approve');
  args.push(prompt);

  const child = spawn(resolvePiBin(), args, { cwd: root, stdio: 'inherit' });
  const forward = signal => child.kill(signal);
  process.once('SIGINT', forward);
  process.once('SIGTERM', forward);
  const release = () => {
    process.removeListener('SIGINT', forward);
    process.removeListener('SIGTERM', forward);
  };
  child.once('error', error => {
    release();
    console.error(`Could not start Pi (${error.message}). Set PI_BIN to the pi executable.`);
    process.exitCode = 1;
  });
  child.once('exit', code => {
    release();
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
