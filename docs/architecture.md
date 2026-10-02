# Architecture and crash recovery


`server/index.ts` is the Node entry point. `server/rooms.ts` keeps one in-memory
`Room` per room code. The deterministic rules engine in `src/lib/engine/` and
per-viewer projections remain independent of hosting. `server/app.ts` defines the
HTTP API routes; `server/index.ts` owns the Node runtime and WebSocket lifecycle.
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

The browser negotiates synchronization version 1 at join. Each `view:sync` is a
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
Older clients retain the legacy push protocol, without integrity verification.

Run **one application process** per database (no PM2 cluster or multiple replicas).
A dedicated connection holds a PostgreSQL advisory lock; startup rejects a second
owner. A generation token checked inside room-write transactions fences stale
processes after ownership changes. A lost owner connection stops the server so the
process manager can restart it. Use a direct PostgreSQL connection (or session-mode
pooling), not PgBouncer transaction pooling, for this ownership connection.

Four-digit room codes still provide 10,000 retained rooms. Automatic room deletion
is not implemented. PostgreSQL backups remain necessary for disk/database loss;
application crash recovery is not a substitute for backups. Backups and migrations
must capture both `avalon_rooms` and `avalon_room_journal` in one consistent database
snapshot. A snapshot-only server is not compatible with
this journal schema; rollback requires an explicit data/schema migration or a
pre-upgrade database restore, not merely deploying the old application image.
