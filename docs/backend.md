# Backend

The production HTTP/WebSocket server is Rust (Tokio/Axum, SQLx, PostgreSQL). The
Docker runtime contains only the Rust executable, the built browser assets and OS
certificates.

| Path | Responsibility |
| --- | --- |
| `backend/src/main.rs` | Entry point, startup checks and shutdown |
| `backend/src/http.rs`, `static_files.rs` | HTTP API and frontend resources |
| `backend/src/room.rs`, `room/` | One state-owning task per room: command queue, COMMIT boundary, membership, referee tools, heartbeats |
| `backend/src/engine.rs`, `engine/` | Deterministic rules, recorded randomness and per-viewer projections |
| `backend/src/bots.rs`, `bots/` | Companion bot policy ([bot decisions](bots.md)) |
| `backend/src/storage.rs`, `journal.rs` | PostgreSQL transactions, ownership, journal and verified recovery |
| `backend/src/replay.rs`, `history.rs`, `ratings.rs` | Archives, history and ratings ([history and ratings](history.md)) |
| `backend/src/auth.rs` | OIDC login, encrypted session cookies and provider caches |
| `backend/src/migration.rs` | Startup guard for the resolved-randomness cutover |

## Typed domain

Roles, teams, phases, votes, mission cards, actions, effects, room commands,
notices and error codes are enums; players, accounts and connections have distinct
identifier types. Wire JSON is decoded before it enters a room queue, and the room
task keeps `RoomDocument` and `GameState` structs across commands. JSON remains
only at the HTTP/WebSocket, PostgreSQL/journal and hash boundaries; serde maps enum
variants to the existing protocol names. Bots consume an authorized client view.

Game state carries `randomnessVersion: "resolved-v1"`. Stochastic events record
their outcomes (role assignments, leaders, seat order, cosmetic variants) before
commit, so replay and recovery never draw randomness.

## Room execution and persistence

PostgreSQL is authoritative; room objects are caches.

1. Each room executes commands sequentially. Expensive transitions, projection,
   hashing and verification run on one bounded CPU pool (`CPU_WORKERS`, 1–32;
   by default one core is reserved and the pool is capped at four).
2. An accepted change appends a versioned JSONB **change journal** entry and
   advances the room head. The journal covers rules state, recorded events,
   seats, account bindings, notes, referee logs and replay metadata. It stores
   resulting changes, so recovery does not rerun rules.
3. The journal, room version, card debit, rewards and completed replay commit in
   **one transaction**. Pushes and acknowledgements follow COMMIT. A failed write
   publishes nothing and forces a reconnect; a lost COMMIT response is ambiguous
   and is never retried automatically. No-op commands write nothing.
4. A checkpoint runs after 32 changes or 60 seconds with pending changes, and on
   graceful drain. It rebuilds the captured version from the previous snapshot and
   journal, checks SHA-256, and only then drops the covered journal prefix. A
   mismatch quarantines the room.
5. Recovery validates the snapshot hash, contiguous journal versions and every
   entry's before/after hash, and fails closed on corruption. Connections and
   referee authorization do not survive a restart; seats and hidden game
   information do.

Shutdown stops admission, closes clients, drains accepted work and checkpoints
within 15 seconds. Idle rooms are evicted five minutes after their work finishes.

### View sync

Every room connection receives `view:sync`: a complete, atomic view of the room,
game and identity, with a runtime epoch, increasing revision and SHA-256 digest of
that viewer's projection (latency and sampled `serverTime` excluded). Heartbeats
every four seconds, and whenever a tab becomes visible, compare the server's latest
revision with the browser store. A missing push or differing content triggers
`room:resync`; the client blocks interaction until a verified full view replaces
its state. Heartbeats and resync read committed caches, so they keep working while
a database write is stalled.

Latency comes from WebSocket Ping/Pong sent by the server every four seconds (30
second timeout). The server pushes `net:rtt` to the connection and `net:latency`
to the room for seated players.

### Room lifecycle

Room codes have four digits. A lobby with no seated humans dissolves immediately.
When every seated human is offline, lobbies expire after ten minutes and started or
finished rooms after one hour. A departing host hands over to an online human; a
disconnected host has five minutes' grace. Dissolution deletes room state and
journal after pending checkpoints; completed replays stay archived.

### Limits

Room queues hold 128 messages; each connection may have 32 outstanding actions,
a bounded outbound queue and a 1 MiB byte budget, and is closed with 1013 when
overloaded. A room accepts 256 connections. CPU jobs have 32 admission permits;
rating queries use a separate path with two permits and cached fitted models.
These are safety limits, not measured capacity.

## Ownership and operations

Run **one application process per database**. A dedicated connection holds a
PostgreSQL advisory lock, so a second owner is rejected at startup, and a
generation token checked inside room writes fences stale processes. Losing the
ownership connection stops the server. Use a direct connection or session-mode
pooling, never transaction pooling. `PG_POOL_MAX` includes the ownership connection.

Back up `avalon_rooms` and `avalon_room_journal` in one consistent snapshot; crash
recovery is not a substitute for backups. Releases are forward-only. A populated
database from before the Rust cutover is refused at startup; migrate it first with
the `migrate-randomness` importer from release `84841fa` (see that commit's
`docs/randomness-cutover.md`). The release pipeline rejects images without the Rust
runtime label.

## Authentication and preferences

Provider tokens are used only during login. The encrypted HttpOnly session cookie
holds the verified account identity for seven days; afterwards the browser signs in
again with a hidden `prompt=none` request. HTTP and WebSocket checks decrypt the
cookie locally and never call the provider. OIDC discovery and JWKS are cached,
bounded and used only at login. Approved issuers are listed in `auth.rs`.

Only a confirmed `/api/auth/session` answer (200 or 401) changes the signed-in
account, so a restart that returns 5xx or drops connections keeps players in their
rooms; a page loaded during an outage shows sign-in and re-checks with backoff.

Display preferences live in `avalon_profiles.preferences`. `PATCH
/api/auth/preferences` requires a same-origin JSON request and merges only the
changed fields; the browser keeps a local copy for rendering and signed-out use.

## Target storage model (decided 2026-10-30, not yet implemented)

Application memory becomes the authority while the process runs, and PostgreSQL an
asynchronous persistence destination:

- A room validates a change, installs it in memory and acknowledges it without
  waiting for a commit; reads and heartbeats use memory.
- Background persistence keeps per-entity order, rejects stale versions and
  retries without rolling back accepted state. Pending work is bounded; snapshots
  may be coalesced, but archives, account effects and deletions must not be lost.
- Related changes (card use, rewards) are applied together in memory and persisted
  idempotently.
- Live rooms are never evicted and reloaded from an older copy; public listings
  read memory.
- Restart restores the latest persisted state; updates since then may be lost.
  Graceful shutdown flushes within a bounded drain.
- A single owner remains, but a backup database outage must not invalidate live
  games.

No hot/cold database pair or failover is planned. The SQL commit boundary,
database-backed reads, idle eviction and ownership lifecycle must change together.

## Testing

`npm run test:rust` replays ten fixed engine traces (1,306 events) checking state,
effects, every player's and the spectator's view hashes, and batch/single
projection agreement. The selection checks its own coverage (all event kinds, room
sizes 5–10, flow versions 1–5, every role, the major win reasons) and fails if a fixture
goes missing. Run the full 102-trace corpus with `npm run test:rust:replay:full`
after changing rules, projection or privacy logic.

The fixtures in `backend/tests/fixtures` were generated by the retired TypeScript
server and are frozen. `backend/tests/support` adapts them to the typed APIs.

Database and socket suites create and drop their own databases; the account needs
`CREATEDB`, and the runtime suite also requires a database name ending in `_test`.
Never point them at production.

```sh
AVALON_TEST_DATABASE_URL=postgres://user:password@localhost:5432/postgres \
  cargo test --manifest-path backend/Cargo.toml --test storage_integration -- --ignored
TEST_DATABASE_URL=postgres://user:password@localhost:5432/avalon_test \
  cargo test --manifest-path backend/Cargo.toml --test runtime_integration -- --ignored
```

They cover lock contention, resync during blocked writes, failed commits, account
takeover, restart recovery, private notes, origin/auth rejection, overload close
codes, dissolution, settlement atomicity, corruption, stale writers and ownership
loss.

## Performance

```sh
cargo run --release --manifest-path backend/Cargo.toml --example benchmark_engine
cargo run --release --manifest-path backend/Cargo.toml --example allocations_engine
```

On an Apple M3 Max the 11,959-transition corpus measured:

| Operation | P50 | P99 | Maximum |
| --- | ---: | ---: | ---: |
| Apply including draft clone | 0.010 ms | 0.077 ms | 0.139 ms |
| Apply to an existing draft | 0.002 ms | 0.011 ms | 0.068 ms |
| Individual projections for all viewers | — | 0.292 ms | 0.422 ms |
| Batched projections for all viewers | — | 0.300 ms | 0.496 ms |

These exclude transport, SQL and network time. `RUST_LOG=avalon_server=debug`
logs CPU queue and execution timings; measure real workloads before stating a
capacity or latency target.
