# Rust backend

The production HTTP/WebSocket backend is Rust. React/Vite remain the browser
application. The old TypeScript server and engine are retained as behavioral
references, fixture generators, and development-gallery dependencies; the Docker
runtime contains only the Rust executable, browser assets, and OS certificates.

## Build and run

Install rustup, Node.js 22+, npm, and Docker Compose. The repository-root
`rust-toolchain.toml` pins Rust 1.99.1, and `backend/Cargo.lock` pins dependencies.
Use `npm ci` followed by `npm run dev` with configured `.env.local` credentials.
The launcher uses the dedicated local development database and runs Cargo.

For a production build, run `npm run build`, then `npm start` with the variables
in `.env.example`. `npm run build:web` and `npm run build:server` can run separately.
The container build uses Node only in the frontend build stage.

`CPU_WORKERS` optionally configures the shared game/persistence Rayon pool from
1 to 32 threads. The default reserves a core when possible and caps the pool at
four workers. Submitted CPU jobs have 32 admission permits. Room command queues
hold at most 128 messages; each connection admits at most 32 outstanding actions.
Connections have bounded outbound queues and a 1 MiB application byte budget;
overload closes them with 1013. A room accepts at most 256 concurrent connections.
These are operational capacity limits, not advertised service throughput.

## Execution and consistency

One Tokio task owns a room's state and processes mutations sequentially. Expensive
transitions, replay construction, canonical hashing, history verification and
projection/encoding run outside the network executor. The game and persistence
paths share one bounded CPU pool. Historical rating queries use a separately
bounded blocking path with two permits and cached fitted models.

The live domain is strongly typed. Roles, teams, phases, votes, mission cards,
actions, effects, room commands, room status, notices and error codes are enums.
Players, accounts and connections have distinct identifier types. The room actor
keeps `RoomDocument` and `GameState` structs across commands; it does not decode
and mutate a JSON tree for every action. Bots consume an authorized typed client
view, and replay/rating/history computation uses typed records.

`engine::*` and `bots::*` expose the native APIs. Explicit `codec` modules adapt
JSON fixtures and external data. JSON remains appropriate at HTTP/WebSocket,
PostgreSQL/journal, hash and legacy-import boundaries. Generic journal values stay
JSON, but journal operations and path components are typed enums. User text,
localization keys, SQL and wire labels remain strings; serde maps enum variants
to the existing protocol names.

The actor prepares a draft, commits the journal and related settlement through
SQLx, then installs and publishes the committed result. New rooms and game state
carry `randomnessVersion: "resolved-v1"`. Stochastic events record actual role
assignments, initial/reselected leader, seat order and cosmetic variants before
the commit. Replay applies these results without drawing randomness. The stored account key is still
the compact JSON pair of issuer origin and subject, preserving accounts and seats.

Heartbeats and full-view recovery read authorized committed caches independently
of the command queue, including while a database write is stalled. Cached views
are shared for equivalent spectator permissions. Connection generations prevent
a replaced device's late disconnect from affecting its successor. Private roles,
notes, votes and bot deductions retain their existing visibility boundaries.

No-op changes do not write a new room version. Database failures invalidate
speculative state and require reconnect/reload. A lost COMMIT response is treated
as ambiguous and is not retried automatically. Journal corruption or an unsupported
snapshot quarantines that room. The process stops authoritative work when its
database ownership connection or generation is lost.

Run one application process per database. Multiple Tokio threads do not change
the ownership restriction. Shutdown stops admission, closes clients, drains accepted
work, and checkpoints; a 15-second total deadline bounds shutdown. A hard timeout
requires normal journal recovery on restart.

## One-way cutover

The Rust cookie has a new name and players must sign in again. There is no legacy
cookie decoder. Existing account identities and completed history are retained.
The cutover ends old rooms, preserving their verified documents and original
journals in private migration archives. Unfinished games are marked aborted and
never receive an invented result or additional reward. Discovery, PKCE, nonce, issuer/audience validation, silent login, and
userinfo-subject checks retain the current Pangda Auth contract.

Before the first production cutover, stop room creation and old-writer admission,
drain and stop Node, take a consistent data snapshot, and run the offline migration
tool described in [the cutover guide](randomness-cutover.md). Rehearse against a
disposable data copy first. The server refuses to start on unmigrated records.
The release pipeline rejects
images without the Rust runtime label, and rollout failure does not restore a
previous Node image. Repair forward with Rust if deployment fails.

This implementation has been tested against generated legacy-format fixtures and
disposable PostgreSQL databases. Production data and production deployment have
not been accessed as part of implementation validation.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run test:slow
npm run check:rust
cargo test --release --locked --manifest-path backend/Cargo.toml
cargo test --release --locked --features legacy-import --manifest-path backend/Cargo.toml
npm run build
```

The migration-only Rust differential corpus includes 102 traces and 12,919 engine transitions,
all 22 event types, rules versions 1–5, player/spectator projections, 1,733 live
bot decisions, 450 detailed bot policy cases, and 180 weighted deals. The suite
also compares 211 JavaScript canonical JSON/hash vectors, rating parameters,
covariance, profiles, history deltas, privacy, pagination, and replay rewind output.
The default runtime additionally replays the materialized random outcomes through
the same rule traces with unrelated seeds, checks invalid/missing results, and
plays native-RNG bot games. The old JS random algorithm is compiled only with
`legacy-import`; it is absent from the normal server and production image.

Real database and WebSocket tests require a PostgreSQL server where the test user
can create databases. Both suites create and drop isolated UUID databases; the
runtime test additionally requires a supplied database name ending in `_test`.
Never point these commands at a production server.

```sh
AVALON_TEST_DATABASE_URL=postgres://user:password@localhost:5432/postgres \
  cargo test --release --manifest-path backend/Cargo.toml --test storage_integration -- --ignored
TEST_DATABASE_URL=postgres://user:password@localhost:5432/avalon_test \
  cargo test --release --manifest-path backend/Cargo.toml --test runtime_integration -- --ignored
AVALON_TEST_DATABASE_URL=postgres://user:password@localhost:5432/postgres \
  cargo test --features legacy-import --manifest-path backend/Cargo.toml --test migration_integration -- --ignored
```

The socket suite verifies real lock contention, heartbeats/resync during blocked
writes, failure without speculative publication, account takeover, restart/seat
recovery, private notes, origin/auth rejection, overload close codes, and room
dissolution. The storage suite checks transactional settlement, corruption,
checkpoint preservation, old snapshots, stale writers and ownership loss.

## Performance and remaining boundaries

Rust removes tracing GC from the game service. It does not make allocation,
deallocation, SQL, networking, or operating-system scheduling free. The initial
implementation deliberately preserves JSON data and wire compatibility rather
than changing persistent records and browser contracts simultaneously.

The owned reducer consumes an already-prepared draft and avoids a second complete
game clone. Batch projection reuses public history and role-art computation;
canonical hashing streams into SHA-256 without building a giant canonical string.
Viewer hashing excludes only the specified transient fields without copying the
whole view. Equal spectator views share storage. Old actor document references
and replaced view references are retired through the CPU pool where possible.

Measure the checked-in release corpus with:

```sh
cargo run --release --manifest-path backend/Cargo.toml --example benchmark_engine
cargo run --release --manifest-path backend/Cargo.toml --example allocations_engine
```

The initial port's local release run, before recorded-randomness cutover, on an
Apple M3 Max (arm64, Rust 1.99.1) measured 11,959
successful transitions from the checked-in corpus:

| CPU operation | P50 | P99 | Maximum |
| --- | ---: | ---: | ---: |
| Reduce including game clone | 0.038 ms | 0.207 ms | 0.318 ms |
| Owned reduce with an existing draft | 0.008 ms | 0.031 ms | 0.077 ms |
| Individual projection for every player plus spectator | 0.528 ms | 2.164 ms | 2.374 ms |
| Batched projection for every player plus spectator | 0.280 ms | 1.063 ms | 1.289 ms |

Owned reduction excludes the preceding draft preparation; its median allocation
count was 109 requests totaling about 24.5 KiB (P99: 787 / 95.1 KiB). Batched
projection still requested about 951 KiB at the median and 3,834 KiB at P99 across
all generated views. Those counts demonstrate reduced allocation, not its removal.
These CPU microbenchmarks exclude room orchestration, SQL and network delivery;
they are not an end-to-end latency guarantee or a deployment capacity measurement.
The checked-in benchmark now uses the resolved-event corpus; rerun it for current
measurements instead of treating the earlier figures as an unchanged guarantee.

`RUST_LOG=avalon_server=debug` includes CPU admission/queue and execution timings.
Collect those separately from SQL and room queue latency. Run representative
concurrent-room, spectator, bot, reconnect, checkpoint, and history workloads on
the target CPU quota before declaring a capacity or tail-latency SLO.

After the native-domain refactor, the same 11,959-transition corpus directly
calling typed APIs measured:

| Native CPU operation | P50 | P99 | Maximum |
| --- | ---: | ---: | ---: |
| Apply including typed draft clone | 0.010 ms | 0.077 ms | 0.139 ms |
| Apply to an existing typed draft | 0.002 ms | 0.011 ms | 0.068 ms |
| Individual projections for all viewers | — | 0.292 ms | 0.422 ms |
| Batched projections for all viewers | — | 0.300 ms | 0.496 ms |

Median allocation calls for owned rule execution fell from 109 to 21; batch
projection fell from 10,466 to 2,849. The native benchmark decodes fixtures outside
the measured region. It measures domain execution, not transport encoding, SQL or
network latency. The live socket/database suites separately verify commit ordering,
privacy, recovery and heartbeat responsiveness.

Typed draft/history clones, output buffers and persistence serialization still
allocate. Further shared history storage, a versioned delta protocol, browser WASM
sharing and multi-node ownership require separate evidence and migration tests.
The current release does not claim zero allocation, zero-copy networking, or a
hard one-millisecond maximum.
