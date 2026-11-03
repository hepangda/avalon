# Avalon Online

An online Avalon game for 5–10 players, with real-time rooms, spectators,
reconnection, companion bots and post-game replays, in Simplified Chinese and
English for phones and desktops.

The browser app uses React, Vite and TypeScript; the server is Rust (Tokio/Axum)
with PostgreSQL. Sign-in is required for rooms, spectating and replays, and
currently integrates with Pangda Auth rather than arbitrary OIDC providers.

## Local development

Requires Node.js 22+, npm, Docker Compose and Rust via `rustup` (the toolchain in
`rust-toolchain.toml`, including its `wasm32-unknown-unknown` target, is installed
automatically).

```sh
npm ci
cp .env.example .env.local   # then set your development OIDC client
npm run dev
```

Open `http://localhost:5173`. The launcher starts a dedicated PostgreSQL container
on `127.0.0.1:55432` (override with `AVALON_DEV_DB_PORT`), the API on port 3000 and
Vite on port 5173, which proxies API and WebSocket requests. Ctrl+C stops the
servers and keeps the database. Restart after changing Rust sources.

```sh
npm run db:up       # database only
npm run dev:server  # database and API
npm run db:down     # stop the database, keeping its volume
```

Development-only tools: `/debug/gallery` runs local game scenarios without
sign-in, and `/debug/addRandomCard` grants a reroll card to the signed-in account.
Neither exists in production builds. The gallery plays on the Rust rules engine
compiled to WebAssembly: Vite builds it with Cargo on each page load, so it needs
only `npm run dev -w frontend` and picks up rule changes on reload. Frontend tests
that build game states load the same module, so `npm test` compiles it first.

## Authentication

Register a confidential OIDC client with S256 PKCE, `openid profile` scopes and
the callback `${PUBLIC_ORIGIN}/api/auth/callback` (locally
`http://localhost:5173/api/auth/callback`). Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET` and `OIDC_SESSION_SECRET` (base64url, 32 bytes, kept across
restarts). Approved issuers are listed in `backend/src/auth.rs`; development also
accepts a loopback issuer.

## Self-hosting

With Docker Compose:

1. Copy `.env.example` to `.env` and configure authentication.
2. Set `ENVIRONMENT=production` and `PUBLIC_ORIGIN` to the public HTTPS origin.
3. Set `POSTGRES_PASSWORD` and `DATABASE_URL`
   (`postgres://avalon:<URL-encoded-password>@db:5432/avalon`).
4. Run `docker compose up -d --build` and proxy HTTPS and WebSockets to
   `127.0.0.1:3000`.

Without Docker, run `npm run build` and then `npm start`; the server serves the
frontend from `dist/client`. Run exactly one application process per database and
back up PostgreSQL separately. See [backend](docs/backend.md) for ownership,
recovery and upgrade constraints, [deploy/r2](deploy/r2/README.md) for CDN
publishing, [deploy/release](deploy/release/README.md) for the release pipeline and
[Kubernetes notes](docs/kubernetes.md).

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run test:rust
npm run check:rust
npm run build
```

Database and socket integration tests are described in [backend](docs/backend.md#testing).

## Layout

| Path | Contents |
| --- | --- |
| `frontend/` | Web app (npm workspace): `src/`, `messages/` (zh/en text), `public/` (art and audio), `scripts/` (static publishing, voice generation) |
| `backend/` | Rust workspace: server, rules engine (`engine/`) and its development WebAssembly bridge (`engine-wasm/`), migrations, integration tests and frozen fixtures |
| `scripts/` | Development launcher and release tests |
| `deploy/` | R2 publishing and VM release tooling |
| `docs/` | Design and operations notes |

Documentation: [gameplay](docs/gameplay.md), [backend](docs/backend.md),
[history and ratings](docs/history.md), [bots](docs/bots.md),
[artwork and distribution](docs/artwork.md), [voice lines](docs/voice-prompts.md).

## Conventions

Use English for identifiers, comments, documentation and test descriptions; keep
interface text and voice lines in the locale resources. Keep compatibility code
only when it protects stored data or published links.
