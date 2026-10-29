# Avalon Online

An online Avalon game for 5–10 players, with real-time rooms, spectators,
reconnection, companion bots and post-game replays. The interface supports
Simplified Chinese and English, with layouts for phones and desktops.

The app uses React, Vite and TypeScript, a Rust (Tokio/Axum) HTTP/WebSocket server, and
PostgreSQL. Sign-in is required for rooms, spectating and replays. Authentication
currently integrates with Pangda Auth; it is not a provider-independent OIDC client.

## Local development

Requires Node.js 22 or newer, npm, Docker Compose and Rust installed through
`rustup`. The pinned toolchain in `rust-toolchain.toml` is selected automatically.
Frontend dependencies use `npm ci`; backend dependencies use `backend/Cargo.lock`.

```sh
npm ci
cp .env.example .env.local
# Set your development OIDC client credentials in .env.local.
npm run dev
```

Open `http://localhost:5173`. The launcher starts a dedicated PostgreSQL container
on `127.0.0.1:55432`, the API on port 3000 and Vite on port 5173. Vite proxies API
and WebSocket requests. The local database uses `avalon` / `avalon_dev` and database
`avalon_development`; these credentials are only for the loopback development service.
Tables are initialized automatically.

The launcher reads development configuration from `.env.local` and overrides
`DATABASE_URL` with the dedicated local database.
Set `AVALON_DEV_DB_PORT` in `.env.local` if port 55432 is occupied. Ctrl+C stops the
servers while preserving the database container and volume. Vite reloads frontend
changes automatically; restart `npm run dev:server` after changing Rust sources.

```sh
npm run db:up       # Start only the local database
npm run dev:server  # Start local database and API
npm run db:down     # Stop local database, keeping its volume
```

The development-only gallery at `/debug/gallery` runs
local game scenarios without sign-in. It includes player/spectator views,
reconnection simulations and result animations, and never writes account or room
data. Its route and bundle are excluded from production builds.

While signed in locally, `/debug/addRandomCard` grants one reroll card, up to the
account limit. The API permits this only in explicit development mode on loopback.

## Authentication

Register a confidential OIDC client with S256 PKCE and `openid profile` scopes. Set
`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_SESSION_SECRET` in local
configuration or the deployment environment. Use a base64url-encoded 32-byte session
secret and retain it across restarts.

Provider tokens are used only during login and are never stored. The encrypted HttpOnly
session cookie holds the verified account identity and expires seven days after login;
the browser then signs in again with a hidden `prompt=none` request while the provider
session lasts. Accounts disabled at the provider therefore lose access within seven days.
Only a confirmed answer from `/api/auth/session` (200 or 401) changes the signed-in
account, so a restart or deploy that returns 5xx or drops the connection keeps players in
their rooms; a page loaded during the outage shows sign-in and re-checks with backoff.

Register the exact callback `${PUBLIC_ORIGIN}/api/auth/callback`; local Vite uses
`http://localhost:5173/api/auth/callback`. The approved issuers are explicit in
`backend/src/auth.rs`; development additionally accepts a loopback issuer such as
`http://localhost:17001`. Supporting another provider requires adapting and testing that
integration, not just changing the example issuer URL.

## Self-hosting

A single Rust application process and PostgreSQL are required. For Docker Compose:

1. Copy `.env.example` to `.env` and configure authentication.
2. Set `ENVIRONMENT=production` and `PUBLIC_ORIGIN` to your public HTTPS origin.
3. Set a strong `POSTGRES_PASSWORD`; set `DATABASE_URL` to
   `postgres://avalon:<URL-encoded-password>@db:5432/avalon` using the same password.
4. Run `docker compose up -d --build` and route HTTPS and WebSockets through a
   reverse proxy to `127.0.0.1:3000`.

Compose keeps PostgreSQL data in the `postgres-data` volume. Back it up separately.
For a process-managed installation, run `npm run build` followed by `npm start`
with `.env` or environment variables. Set `PUBLIC_ORIGIN` to the browser-facing
origin (for example `http://localhost:3000` for a local production-build preview).
The server serves the frontend from `dist/client`. `npm run build:web` builds only
the frontend; `npm run build:server` builds the release executable at
`backend/target/release/avalon-server`. The production Docker image contains the
Rust binary, frontend assets and CA certificates; no Node runtime is needed.

The Rust migration intentionally invalidates old login cookies. Account identity
and database history remain associated after signing in again. Releases are
forward-only: do not deploy the legacy Node backend after the cutover.

Run **one application process per database**. A PostgreSQL session advisory lock
and generation checks enforce room ownership. Use a direct database connection
or session-mode pooling; transaction-mode pooling is incompatible. `PG_POOL_MAX`
includes one reserved ownership connection. `/api/health` checks database and
ownership health; SIGTERM drains pending room work before shutdown.

Static files are served by the app by default. Optional CDN publishing is described
in [deploy/r2](deploy/r2/README.md); Kubernetes constraints are documented in
[deploy/k8s](deploy/k8s/README.md), and commit-based releases through GHCR images in
[deploy/release](deploy/release/README.md). Site-specific infrastructure and migration
records are not part of the public deployment instructions.

## One-way data cutover

The production server uses recorded random outcomes and contains no legacy
JavaScript RNG implementation. Stop every old Avalon process before migrating.
The offline importer preserves accounts, preferences, cards, rewards, ratings
inputs and completed archives. It archives and clears existing rooms, so ongoing
games end at this release. It does not invent a winner for an unfinished game.
Players sign in again after the Rust server starts.

First take a consistent PostgreSQL backup. Build the separate importer, review its
read-only report, and apply the transaction with the same database connection:

```sh
npm run build:migration
# DATABASE_URL must be supplied by the operator; no production default is used.
backend/target/release/migrate-randomness --dry-run
backend/target/release/migrate-randomness --apply
npm run build:server
npm start
```

A Docker importer is available as an explicit build target. The default production
image contains only the Rust server; it never contains the legacy importer binary:

```sh
docker build --target migration-tool -t avalon-migration .
docker run --rm -e DATABASE_URL avalon-migration --dry-run
docker run --rm -e DATABASE_URL avalon-migration --apply
docker build --target production -t avalon .
```

Completed archives become `formatVersion: 2` without changing recorded outcomes,
roles, cosmetic variants, logs or timestamps. Missing legacy metadata stays
missing. A completed room with no archive is reconstructed only by the isolated
legacy importer and checked against its persisted final result. Corruption or a
mismatch fails the transaction. The server refuses an unmigrated nonempty database;
there is no automatic migration or fallback to the Node backend.
See the [cutover guide](docs/randomness-cutover.md) for data preservation,
preflight checks and repeat-execution behavior.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run test:rust
npm run test:rust:legacy
npm run check:rust
npm run build
```

`npm test` skips the long bot self-play regressions (about 20 seconds). Run them
after changing bot or game-engine logic:

```sh
npm run test:slow
```

Database integration tests are opt-in and clear the application tables in the
selected database. Use a disposable database whose name ends in `_test`:

```sh
TEST_DATABASE_URL=postgres://user:password@localhost:5432/avalon_test npm run test:postgres
```

Rust persistence and live HTTP/WebSocket integration tests create and drop their
own UUID-named databases. The supplied account needs `CREATEDB`; use the local
disposable PostgreSQL server. The runtime test also refuses a connection URL whose
database name does not end in `_test`:

```sh
AVALON_TEST_DATABASE_URL=postgres://user:password@localhost:5432/postgres cargo test --manifest-path backend/Cargo.toml --test storage_integration -- --ignored
TEST_DATABASE_URL=postgres://user:password@localhost:5432/avalon_test cargo test --manifest-path backend/Cargo.toml --test runtime_integration -- --ignored
```

The runtime suite covers private views, real SQL lock delays, failed commits,
account takeover, process restart and room dissolution through actual sockets.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | React UI, translations integration, client stores and WebSockets |
| `src/lib/engine/` | Deterministic rules, event modules, role visibility and player projections |
| `src/components/game/GameView.tsx` | Injectable game table shared by rooms and gallery |
| `src/styles/` | Ordered table, card, dialog and timer styles |
| `backend/src/` | Production Rust HTTP, authentication, rooms, storage, rules and CPU workers |
| `backend/tests/` | Rust integration tests and cross-language fixtures |
| `server/` | Retained TypeScript behavioral oracle and regression tests |
| `backend/src/main.rs` | Rust HTTP/WebSocket entry point and shutdown |
| `backend/src/http.rs`, `backend/src/static_files.rs` | HTTP API composition and frontend resources |
| `backend/src/room/` | Bounded room tasks, committed views, membership and referee commands |
| `backend/src/storage.rs`, `backend/src/journal.rs` | PostgreSQL transactions, ownership and verified recovery |
| `backend/src/auth.rs` | OIDC protocol, new encrypted Rust sessions and provider cache |
| `messages/` | Chinese/English text; `*.debug.json` loads only in development |
| `public/assets/` | Optimized game artwork |
| `scripts/` | Development launcher, static publishing and bot benchmarks |
| `deploy/` | Optional R2, Kubernetes and release pipeline documentation |
| `dist/client/`, `backend/target/` | Generated frontend and Rust build output |

See [gameplay](docs/gameplay.md), [architecture and recovery](docs/architecture.md),
[Rust runtime and validation](docs/rust-backend.md),
[bot decisions](docs/bots.md), and [artwork provenance](docs/art/README.md).
[Publication review](docs/publication-review.md) records what was removed, retained
privately or still needs review before distribution.

## Repository conventions

Use English for identifiers, comments, documentation and test descriptions.
Keep translated interface text and voice lines in their locale resources;
multilingual test fixtures and artwork provenance may retain their original text.
Prefer the current runtime APIs over wrappers for retired frameworks. Keep
compatibility code only when it protects existing stored data or published links.

## History, replays and ratings

Signed-in players can open `/history` to see their profile and games, then select
a game to view `/replay/:gameId`. Replays support playback, keyboard navigation,
shareable steps and individual player viewpoints. See [history and ratings](docs/history.md)
for the model, eligibility rules, API and historical-record recovery constraints.
