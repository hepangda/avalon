# Recorded randomness and one-time history migration

New games use the Rust ChaCha12 generator, seeded with SHA-256 of a private UTF-8
seed. The game records the resulting choices rather than requiring the algorithm
to remain unchanged forever. `START_GAME` records seat order, assigned roles,
leader index and role variants; role and leader rerolls also record their actual
results. The reducer validates those fields and applies them deterministically.

The production binary is built without `legacy-import`. Only the separate offline
importer and compatibility tests compile the old xmur3/mulberry32 implementation.

## What happens to existing data

| Data | Cutover behavior |
| --- | --- |
| Completed replay payloads | Preserve all original fields and results; add numeric `formatVersion: 2` |
| Missing historical variants/metadata | Preserve absence; do not invent historical facts |
| Completed rooms missing an archived replay | Reconstruct with the offline legacy importer and verify against the persisted final state |
| Unfinished rooms and lobbies | Preserve verified documents, original database rows and journals privately; mark aborted and remove from live rooms |
| Accounts, aliases, preferences, cards, rewards and role weights | Preserve existing records and balances |
| Historical seat links | Preserve existing links; fill only exact, matching-revision evidence and reject conflicts |
| Login cookies | Old Node sessions are not accepted; players sign in again |

An aborted game does not get a winner, a completed-game count, or a new reward.
The raw evidence tables contain private roles, notes and old seat tokens. They have
no public API and must be treated like the private room tables in database access
controls and backups.

## Prepare and inspect

Stop all Avalon processes that own the target database. The tool uses the same
PostgreSQL advisory lock as the server and refuses to run while a server owns it.
Take a consistent database backup and rehearse against a disposable copy first.
Set `DATABASE_URL` to the intended database explicitly; the tool does not choose
an environment or discover production credentials automatically.

```sh
npm run build:migration
backend/target/release/migrate-randomness --dry-run
```

No argument also means dry run. Conflicting or repeated mode flags are rejected.
Dry run uses a read-only repeatable-read transaction: it does not create tables,
write a marker, change balances, or remove rooms. Its JSON report includes rooms
to terminate, existing/recovered replays, missing variant metadata, and accounting
row counts. Corrupt journals, unsupported versions and contradictory histories
cause an error instead of choosing a new outcome.

## Apply once

```sh
backend/target/release/migrate-randomness --apply
npm run build:server
npm start
```

The importer validates all room snapshots/journals, creates private evidence
archives, converts/reconstructs completed replays, adds verified seat links,
removes old live rooms and journals, and writes `resolved-randomness-v1` to
`avalon_migrations` in one transaction. Failure rolls back the entire transaction.
It does not use the live settlement path, so replay recovery cannot spend a card
or award a game twice.

Repeating the tool returns `alreadyApplied: true` after checking readiness. It does
not clear games created after the cutover. A populated database without the marker,
or marked data with legacy/unknown room or replay versions, is rejected by normal
server startup before runtime schema setup changes it. A truly empty room/replay
database can initialize itself without an explicit cutover.

## Container builds

```sh
docker build --target migration-tool -t avalon-migration .
docker run --rm -e DATABASE_URL avalon-migration --dry-run
docker run --rm -e DATABASE_URL avalon-migration --apply
docker build --target production -t avalon-rust .
```

Use a database hostname reachable from the container. The `migration-tool` image
contains only the offline importer; the production image contains only the
default-feature server. Neither image needs Node at runtime.

## Verification

The migration test suite creates its own disposable databases and verifies:
read-only planning, exact accounting preservation, old snapshot-only schemas,
hash-checked journal recovery, atomic failure, stale seat-link evidence,
strict version markers, and safe repeated execution after new rooms exist.

```sh
AVALON_TEST_DATABASE_URL=postgres://user:password@localhost:5432/postgres \
  cargo test --features legacy-import --manifest-path backend/Cargo.toml \
  --test migration_integration -- --ignored
```

These tests are generated-data rehearsals. They do not mean a real deployment's
database has been migrated. Apply the tool to the explicitly selected environment
during the cutover window, then retain its report with the deployment record.

Validation on 2026-10-29 passed six PostgreSQL migration scenarios, the native and
legacy engine comparison suites, historical replay/rating preservation tests,
and a container-level rehearsal. The rehearsal migrated one synthetic unfinished
room and one completed replay, retained card balance and completed-game count,
verified read-only planning and safe repetition, then started the production Rust
image against that migrated database. The production image contains neither Node
nor the importer. No real business database was modified; that cutover is deferred
to the formal release window.
