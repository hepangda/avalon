# Architecture and crash recovery


`backend/src/main.rs` is the Rust entry point. `backend/src/room/` keeps one
state-owning Tokio task per room code. `backend/src/engine/` contains deterministic
rules and per-viewer projections independent of hosting. `backend/src/http.rs`
defines HTTP routes; Axum owns HTTP/WebSocket transport. The TypeScript server and
engine remain behavioral oracles and browser-development helpers. See
[Rust runtime and validation](rust-backend.md) for execution bounds and migration.
**Settings** controls language and Classic /
Modern / Furry card art across home, rooms, games and replays. Signed-in accounts
store preferences in `avalon_profiles.preferences`; local storage is only a
rendering cache and a fallback for signed-out visitors. Session reads retrieve
account preferences, including on window focus. `PATCH /api/auth/preferences`
requires a same-origin JSON request and a verified session, validates supported
values, and merges only changed fields atomically in PostgreSQL. A failed save
restores the previous display and shows an error; stale session reads and writes
from a previous account cannot replace current settings. The additive startup
migration preserves existing aliases.

PostgreSQL is authoritative; room objects are disposable caches:

1. Each room executes commands sequentially. Different rooms share the connection
   pool without permanently reserving a connection per room or player.
2. An accepted change appends a versioned private JSONB **change journal** and
   advances the room head. Array histories append only their new tails. The journal
   covers the whole durable room: rules state, recorded game events, seats/tokens,
   account bindings, notes, referee logs, and replay metadata. It stores resulting
   changes, so recovery does not rerun randomness or depend on a newer rules engine.
3. The journal, room version, card debit and completed replay commit in **one
   transaction on one checked-out connection**. Game pushes and successful action
   acknowledgements follow COMMIT. Failed writes publish no speculative game state
   and force a reconnect. A lost COMMIT response remains ambiguous; actions are not
   automatically retried.
4. A background checkpoint runs after 32 committed changes or 60 seconds with
   pending changes, and on graceful drain. Before replacing a snapshot, it restores
   the captured version from the previous snapshot and journal and checks SHA-256.
   Only then does it discard the covered journal prefix; newer entries survive.
   Verification yields to other I/O between entries. A mismatch retains the journal
   and quarantines the room. Transient checkpoint failures retain the journal for retry.
5. Recovery validates the snapshot hash, contiguous journal versions, and each
   entry's before/after hash. Corruption fails closed rather than serving an older
   state. Legacy snapshots are accepted and receive hashes on their next write or
   checkpoint. Connections and referee authorization do not survive a process
   restart; account/seat ownership and hidden game information do.
6. Heartbeats bypass the room command queue and PostgreSQL. They read only cached
   **committed** per-viewer revision/hash metadata and publish transient latency
   separately. Idle rooms are evicted after five minutes once pending work finishes.
   Completed replays and account aliases have no automatic expiry.

All room connections use `view:sync`. Each message is a
complete, atomic room/game/identity view carrying a runtime epoch, increasing view
revision and SHA-256 digest. Only the authenticated viewer's projection is hashed;
server secrets never enter this protocol. Latency and sampled `serverTime` are
excluded, but authoritative timer start/pause timestamps remain covered. Normal
updates still send full views (wire deltas are not part of this change).

Every four seconds, and when a tab becomes visible, the heartbeat checks the
server's latest revision against the actual browser store. Missing final pushes,
or different contents at the same revision, trigger `room:resync`. The client
blocks interaction until a verified full view replaces state and clears stale
presentations and pending UI actions. Old snapshots/socket callbacks are ignored;
failed recovery retries on later heartbeats rather than looping immediately.
A referee rewind advances the view revision. A restart establishes a new epoch.
The retired `state:sync`, `room:snapshot`, `private:reveal` and `private:lady`
protocol is no longer emitted. Clients that predate atomic views must reload
the application after an upgrade.

Run **one application process** per database (no multiple application replicas).
A dedicated connection holds a PostgreSQL advisory lock; startup rejects a second
owner. A generation token checked inside room-write transactions fences stale
processes after ownership changes. A lost owner connection stops the server so the
process manager can restart it. Use a direct PostgreSQL connection (or session-mode
pooling), not PgBouncer transaction pooling, for this ownership connection.

Four-digit room codes provide 10,000 possible active rooms. A lobby with no seated
humans dissolves immediately. When all seated humans are offline, lobbies expire
after ten minutes and started/finished rooms after one hour. Host departure
transfers ownership to an online human; a disconnected host has a five-minute
grace period. When succession is required but no eligible player remains, the
room dissolves, except that a started/finished game with a disconnected host
keeps its one-hour grace period. Dissolution deletes room state and its journal
after pending checkpoints finish; completed replays remain archived.

PostgreSQL backups remain necessary for disk/database loss;
application crash recovery is not a substitute for backups. Backups and migrations
must capture both `avalon_rooms` and `avalon_room_journal` in one consistent database
snapshot. A snapshot-only server is not compatible with
this journal schema. Production releases are one-way to Rust; old Node images
must not be restarted against the migrated application. Data recovery must verify
both snapshots and journals before the Rust service resumes writes.

## Module boundaries and compatibility

`backend/src/room/mod.rs` owns the bounded command queue and COMMIT boundary.
`domain.rs` prepares membership, referee and private-note changes on a typed draft;
committed viewer caches remain readable while the actor awaits SQL. The shared
CPU pool handles transitions, projection, hashing and verified compaction.
Account queries share the database pool, while room, replay, card debit and
reward settlement stay in the same transaction.

The domain uses `GameState`, `GameEvent`, `Role`, `Phase`, `RoomDocument` and
`Command` types with exhaustive enum matching. Wire JSON is decoded before
entering the room queue. The original committed JSON is retained separately for
the existing database CAS/hash contract, and serialization occurs at persistence
and transport boundaries. The engine and bot policy have explicit `codec` adapters
for tests and offline imports; production code calls the native APIs directly.

OIDC discovery is validated before a five-minute cache is populated; concurrent
requests share one lookup and failures are not cached. JWKS are cached by URI with
expiry and an unknown-key refresh cooldown. Both caches are bounded and used only at
login. HTTP and WebSocket session checks decrypt the session cookie locally and never
contact the provider; WebSocket verification also skips display preferences and
daily rewards.

The browser store accepts an atomic verified view and reads private identity and
Lady results directly from that game projection. Production rooms use recorded
random outcomes (`resolved-v1`); the old seeded stream is compiled only into the
offline importer. The one-time [cutover](randomness-cutover.md) preserves completed
history and private migration evidence, then ends old live rooms. Old rules remain
available for import verification. The browser's live protocol remains unchanged.
