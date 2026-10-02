# Avalon Online

An online Avalon game for 5–10 players, with real-time rooms, spectators,
reconnection, companion bots and post-game replays. The interface supports
Simplified Chinese and English, with layouts for phones and desktops.

The app uses React, Vite and TypeScript, a Node.js HTTP/WebSocket server, and
PostgreSQL. Sign-in is required for rooms, spectating and replays. Authentication
currently integrates with Pangda Auth; it is not a provider-independent OIDC client.

## Local development

Requires Node.js 22 or newer, npm and Docker Compose. Local development and
Docker builds use `npm ci` with the single `package-lock.json`.

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

Use `.env.local` for development configuration; copy any existing `.dev.vars`
development values there once. The launcher reads only `.env.local`, never
production configuration, and overrides `DATABASE_URL` with the dedicated local database.
Set `AVALON_DEV_DB_PORT` in `.env.local` if port 55432 is occupied. Ctrl+C stops the
servers while preserving the database container and volume.

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
`server/auth/config.ts`; development additionally accepts a loopback issuer such as
`http://localhost:17001`. Supporting another provider requires adapting and testing that
integration, not just changing the example issuer URL.

## Self-hosting

A single Node application process and PostgreSQL are required. For Docker Compose:

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
The server serves the frontend from `dist/client`.

Run **one application process per database**. A PostgreSQL session advisory lock
and generation checks enforce room ownership. Use a direct database connection
or session-mode pooling; transaction-mode pooling is incompatible. `PG_POOL_MAX`
includes one reserved ownership connection. `/api/health` checks database and
ownership health; SIGTERM drains pending room work before shutdown.

Static files are served by the app by default. Optional CDN publishing is described
in [deploy/r2](deploy/r2/README.md); Kubernetes constraints are documented in
[deploy/k8s](deploy/k8s/README.md). Site-specific infrastructure and migration
records are not part of the public deployment instructions.

## Verification

```sh
npm run typecheck
npm run lint
npm test
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

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | React UI, translations integration, client stores and WebSockets |
| `src/lib/engine/` | Deterministic rules, event modules, role visibility and player projections |
| `src/components/game/GameView.tsx` | Injectable game table shared by rooms and gallery |
| `src/styles/` | Ordered table, card, dialog and timer styles |
| `server/` | Node backend and colocated tests |
| `server/index.ts` | Node HTTP/WebSocket entry point and shutdown |
| `server/app.ts`, `server/http/` | HTTP API composition and route groups |
| `server/room.ts`, `server/room-*.ts` | Serialized commits and separate membership, referee, view and recovery services |
| `server/database.ts` | PostgreSQL transactions and process ownership |
| `server/auth.ts`, `server/auth/` | Auth API, OIDC protocol, session encryption and provider cache |
| `messages/` | Chinese/English text; `*.debug.json` loads only in development |
| `public/assets/` | Optimized game artwork |
| `scripts/` | Development launcher, static publishing and bot benchmarks |
| `deploy/` | Optional R2 and Kubernetes deployment documentation |
| `dist/client/`, `dist/server/` | Generated frontend and backend build output |

See [gameplay](docs/gameplay.md), [architecture and recovery](docs/architecture.md),
[bot decisions](docs/bots.md), and [artwork provenance](docs/art/README.md).
[Publication review](docs/publication-review.md) records what was removed, retained
privately or still needs review before distribution.
