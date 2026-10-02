# Publication review

Review date: 2026-10-02. This review covers the current source tree and locally
visible Git history. It does not publish a release or rewrite Git history.

## Changes made

| Content | Decision | Reason |
| --- | --- | --- |
| Production Kubernetes resources and runbooks | Retained only in `.private/publication-review-20261002/deploy/k8s/` | Site topology, registry locations, release digests and recovery records belong in private operations storage |
| One-time database migration, credential switching and production smoke scripts | Moved to the private archive's `scripts/` | Tied to a specific installation; unsafe as general deployment examples |
| Root README | Rewritten | Removed deployment history and migration-era instructions; kept setup, authentication and verification |
| Architecture, gameplay and bot documentation | Split into `docs/` | Preserve current behavior and operational constraints without burying setup instructions |
| Static storage instructions and scripts | Rewritten/configured through environment | Removed account/zone identifiers and private destination defaults |
| Art metadata | Sanitized | Removed clipboard locations, local user paths and generation-session paths; retained prompts and provenance |
| Debug gallery | Development builds only | Keep simulated engine state and debug UI out of production bundles |
| 10 unused loose role images (about 606 KiB) | Removed | Replaced by the paired card/avatar directories; no code references remain |
| Four obsolete ESLint suppression comments | Removed | The configured rules no longer require them |
| Unused `@tanstack/react-query`, Husky and its empty prepare hook | Removed; both lockfiles updated | No query imports or project Git hooks remain |
| `tsconfig.tsbuildinfo`, old `worker-configuration.d.ts` and empty public source-art staging directory | Removed | Generated cache and a staging location that could accidentally ship originals |
| Previously deleted `.next/` and `.omo/` files | Kept deleted; ignore rules added | Build and agent session state do not belong in source control |
| Secrets, backups, private records and generated state | Git/Docker exclusions strengthened | Local files must not become release or image inputs |

Existing unrelated source changes were retained. The local archive also holds
pre-cleanup copies of edited documentation and selected files; it is not a
runnable release bundle. The real environment files and recovery backups were
preserved locally. Do not distribute a raw ZIP of the working directory: ignored
files still exist on disk. Package only reviewed source files or build outputs.

## Retained intentionally

- Gameplay code, tests, optimized artwork and bot benchmark fixtures remain.
- Both lockfiles remain: the documented workflows support npm and pnpm, and the
  Dockerfile consumes `package-lock.json`.
- Auth provider domains remain in the authentication allowlist and associated
  examples/tests because they define supported behavior, not deployment secrets.
- Current database recovery and rollback restrictions remain in architecture docs.

## Unresolved publication items

- **Artwork provenance:** the classic deck references supplied board-game art;
  the alternate deck uses user-provided illustrations. No redistribution
  permission records were found. Confirm permissions or replace the affected
  art before asset redistribution; see [art documentation](art/README.md).
- **License:** no project license file is present. The owner must choose the code
  license and establish compatible asset permissions; no license was invented.
- **History:** deleting a current file does not remove previous revisions. The
  locally visible history includes earlier agent continuation state and generated
  cache files. Publish a reviewed clean snapshot, or separately audit and clean
  history before making the existing repository public. No history rewrite was
  performed by this cleanup.

Credential-pattern scanning is a heuristic review, not a guarantee that every
secret has been found. Local environment files and backups are intentionally
private and their values are not reproduced in this report.

The high-confidence credential-pattern scan found no matches in current public
files or 959 locally visible historical text blobs. This scan does not validate
all possible passwords, encoded secrets or binary content.

## Validation

- TypeScript checks, ESLint and the production build passed.
- 724 Vitest tests and four Node script tests passed. Nineteen PostgreSQL
  integration tests were skipped because no disposable test database was supplied.
- The production manifest and JavaScript contain no debug gallery chunk or route.
- Relative documentation links resolve; Git ignore rules exclude local secrets
  and private archives. No remote upload, deployment or history rewrite was run.
