# Repository instructions

## Language

The working language of this repository is English. This holds regardless of
the language the user writes in or the language an agent uses in chat: code,
comments, documentation, commit messages, branch names, file names, and issue
text are written in English.

Before acting on a request, restate it in polished, unambiguous English and
proceed on that understanding; keep the restatement to one or two sentences and
do not turn it into a questionnaire. Ask only when the meaning is genuinely
unclear. Answer the user in the language they used, but keep every artefact in
the repository in English.

## Commits

Create commits with the `git-arrange-commits` skill committed in this
repository: `.agents/skills/git-arrange-commits/SKILL.md`. Do not stage and
commit by hand.

- Pi: `/skill:git-arrange-commits`, or `npm run commit`
  (`npm run commit -- --dry-run` to plan first). The launcher runs
  `pi --print` with the repository copy of the skill and passes any trailing
  text through as an extra instruction.
- Codex: read the same `SKILL.md` before committing.
- Claude Code reads `CLAUDE.md` and `.claude/skills/`, not `.agents/`. Both are
  wired up here: `CLAUDE.md` mirrors these rules and
  `.claude/skills/git-arrange-commits` symlinks the repository skill.

Never add attribution of any kind to a commit message: no `Co-authored-by:`,
`Signed-off-by:`, `Generated-by:`, `Assisted-by:`, review/PR footers, tool or
model names, emoji signatures, or "Generated with …" lines — even when a tool,
IDE, extension, or model offers to add one. If a hook or tool inserts such a
trailer, amend it out before reporting the result.

`.githooks/commit-msg` enforces the one-line and no-attribution rules on every
commit. It is installed by `npm install` (`prepare`) and can be enabled by hand
with `npm run hooks:install`, which sets `core.hooksPath=.githooks`. Never
bypass it with `--no-verify`: let it reject the message, then run
`npm run commit` so the skill rewrites it. `npm run commit:check` audits the
messages of commits ahead of upstream; `npm run commit:check -- --all` audits
the whole reachable history.

`scripts/commit.mjs` loads the repository copy first, then the user copy at
`~/.agents/skills/git-arrange-commits` (override with `PI_ARRANGE_SKILL`), and
resolves the Pi executable from `PI_BIN`, then `~/.pi/agent/bin/pi`, then
`PATH`.

Grouping, verification, and message rules live in the skill and apply here:
one-line Conventional Commit subjects in imperative English, matching the
existing history (`type(scope): summary`), no message bodies and no
attribution or signature lines.
