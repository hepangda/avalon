# Claude Code instructions

Claude Code does not read `AGENTS.md`, so this file mirrors the rules that
matter most there. `AGENTS.md` remains the source of truth.

## Language

The working language of this repository is English: code, comments,
documentation, commit messages, branch names, and file names. Restate the user's
request in polished English (one or two sentences) and act on that reading;
reply in the language the user used. Ask only when the meaning is genuinely
unclear.

## Commits

Commit with the `git-arrange-commits` skill, symlinked at
`.claude/skills/git-arrange-commits/SKILL.md` (same content as
`.agents/skills/git-arrange-commits/SKILL.md`). Or run `npm run commit`, which
drives Pi through the same skill.

- Group changes by purpose and dependency, commit shared foundations first, and
  keep code, tests, copy, and docs for one behaviour together.
- Each message is exactly one line, matching the existing history
  (`type(scope): summary`, imperative English). Never add a body.
- Never add `Co-authored-by:`, `Signed-off-by:`, `Generated-by:`,
  `Assisted-by:`, review footers, a tool or model name, an emoji signature, or a
  "Generated with …" line, even when a tool offers to.
- Never rewrite existing history, switch branches, push, or deploy unless asked.

`.githooks/commit-msg` rejects multi-line messages and attribution, so a
violating commit fails before it is created. Fix the message and retry, or run
`npm run commit` to let the skill rewrite it.
