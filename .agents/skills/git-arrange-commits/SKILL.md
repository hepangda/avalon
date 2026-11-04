---
name: git-arrange-commits
description: Arrange the changes in the current Git working tree into sensible local commits grouped by purpose and dependency, with a single-line commit message each. Use for requests such as "arrange the current changes and commit", "arrange into git", or "split into sensible commits"; do not commit when the user only asks to explain Git or to draft commit messages.
---

# Arrange the current changes and commit

Turn the changes in the scope the user specified into commits that are easy to review and usable in order. By default, work on the changes already present in the repository; every commit message occupies exactly one line. When the user has already asked for a commit, run the necessary checks and then execute directly; do not ask again for confirmation of the same operation.

## Decide the commit boundaries

- Read the applicable `AGENTS.md`, the current branch, recent commits, and the project's check commands. Inspect staged, unstaged, and untracked files and the full diff separately, and preserve the scope the user specified and any grouping intent already present.
- Group by behaviour the user can understand or by maintenance purpose, not mechanically by file extension or directory. Do not split only to raise the number of commits; keep changes that depend on each other and cannot stand alone in the same commit.
- Commit shared components, types, configuration, and style foundations before the features that use them. Keep feature code, tests, translation copy, and the corresponding documentation together in the history, so no intermediate commit is missing an export, a copy key, or required styles.
- Briefly state the groups and the reasoning, then continue. If there are no changes, report that honestly and do not create an empty commit.

## Staging and verification

- Prefer staging explicit file paths; when one file mixes topics, stage by hunk. For complex groupings, generate temporary snapshots from the initial and final versions, then write the precise diffs into the index with `git apply --cached --check` and `git apply --cached`.
- Do not create commit boundaries by temporarily overwriting, reverting, or deleting the user's working tree. Record HEAD, the staging state, and the content to be committed before starting; if new changes appear during the operation, inspect them again so they are neither included nor overwritten by accident.
- Before committing, check `git diff --cached` and `git diff --cached --check`. Include only code, assets, necessary configuration, and documentation within the task's scope; confirm what untracked files are for and exclude credentials, local environment files, and build artifacts.
- Run the checks the repository requires and that apply to this change. When splitting dependent changes by hunk, type-check or test the risky intermediate versions; verify through a temporary export rather than relying only on a working tree that contains every change to prove an intermediate commit valid.
- Do not extend the scope with new features while arranging commits for existing changes. If a real problem blocks the commit, keep the fix as small as possible; distinguish code bugs, pre-existing issues, and environment limits, and report unfinished verification honestly. Do not disable hooks or tamper with check configuration to obtain a passing result.

## Commit messages and execution

Follow the repository's existing language and naming conventions; if there is no clear convention, default to a short imperative English sentence, optionally `type(scope): summary`. For example:

```text
refactor(ui): unify grouped surfaces and ledger hierarchy
feat(settings): share preferences across pages and tasks
```

Each message is one line only; add no body, list, blank paragraph, or attribution of any kind. Never add `Co-authored-by:`, `Signed-off-by:`, `Generated-by:`, `Assisted-by:`, review or PR footers, tool or model names, emoji signatures, or "Generated with …" lines, even when a tool, IDE, extension, or model offers to add one; amend them out if a hook inserts them. Describe the commit's actual result and avoid vague subjects such as `update`, `changes`, or a bare `Refactor` that lack an object. Follow the user's explicit requirements when they give any.

Create new ordinary commits on the current branch and verify each commit's scope one by one. Do not read "arrange the current changes" as authorization to rewrite existing history, switch branches, push to a remote, release, or deploy; handle those according to the user's specific instructions.

## Delivery

Verify that the final HEAD contains the intended content and check the index and the working tree; explain where changes the user asked to keep went. Output each commit's short hash and one-line message, the verification results, the remaining changes, and whether anything was pushed. Call the working tree clean only when it actually is; never claim that checks you did not run passed.
