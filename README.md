# Avalon Online

A production-grade online implementation of Avalon for 5-10 friends, no login required. The server enforces role assignment, team voting, mission resolution, Lady of the Lake, assassination, reconnection, spectating, and full post-game replay.

- Mobile-first, real-time, medieval-fantasy themed.
- i18n: Simplified Chinese (default) + English.
- Roles: Merlin, Percival, Loyal Servant, Morgana, Assassin, Oberon, Mordred, and Minion of Mordred. Lady of the Lake is optional.

## Tech stack

- React 19 SPA built with Vite, TypeScript strict mode
- TailwindCSS, Framer Motion, Zustand, TanStack Query
- [Hono](https://hono.dev) on Cloudflare Workers for the API + WebSocket routing
- Cloudflare Durable Objects (SQLite storage + WebSocket Hibernation) for authoritative room state
- `use-intl` for i18n, React Router for client routing

## Architecture

The authoritative game state for a room lives in a single **Durable Object** (`worker/room-do.ts`), one instance per room code. Because a DO is single-threaded and addressable by name from anywhere, it replaces the old "single Node process + in-memory store" model with the same semantics but no single point of failure and automatic per-room scaling.

- A pure deterministic engine in `src/lib/engine/` drives the rules (unchanged, runtime-agnostic).
- Clients connect over **native WebSockets** (`/rooms/:code/ws`) which the Worker forwards to the room's Durable Object. The DO uses the **Hibernation API** so idle rooms cost nothing while keeping connections alive. Per-viewer state projection ensures clients never see hidden roles or mission cards.
- The append-only **event log** is persisted in the DO's own **SQLite** and is the single source of truth: on wake the DO deterministically replays it to rebuild state, and on game over it reconstructs the full `ReplayData` and ships it to a per-game `ReplayDurableObject` (keyed by game id). **There is no external database** — Postgres/Prisma were removed entirely.
- The React SPA is served as static assets by the Worker, with SPA fallback for client routes. Locale routing (`/zh`, `/en`) is handled client-side by React Router.

## Local development

```bash
npm install
npm run dev
```

`npm run dev` runs Vite with the Cloudflare plugin, so the React app, the Hono Worker, and the Durable Objects (including WebSockets) all run together in a local `workerd` runtime. Open multiple browser tabs or phones on the same network to simulate players.

To run the production build locally in a Miniflare runtime (closest to deployed behavior):

```bash
npm run build
npm run preview
```

## Scripts

- `npm run dev`: Vite dev server + Worker + Durable Objects (hot reload)
- `npm run build`: production build (client SPA + Worker bundle)
- `npm run preview`: serve the production build in a local Workers runtime
- `npm run deploy`: build and deploy to Cloudflare (`wrangler deploy`)
- `npm run cf-types`: regenerate Cloudflare runtime types (`worker-configuration.d.ts`)
- `npm test`: engine unit tests (Vitest)
- `npm run typecheck`: TypeScript check (app + worker projects)
- `npm run lint`: ESLint

## Deployment (Cloudflare Workers)

No servers, containers, or database to manage. With a Cloudflare account and `wrangler` authenticated (`npx wrangler login`):

```bash
npm run deploy
```

Configuration lives in `wrangler.jsonc`:

- `main` → the Hono Worker entry (`worker/index.ts`)
- `assets` → the built client SPA with `not_found_handling: "single-page-application"`; `run_worker_first` routes `/api/*` and `/rooms/*` to the Worker, everything else to static assets
- `durable_objects` → the `ROOM` and `REPLAY` bindings
- `migrations` → registers both classes as `new_sqlite_classes` (SQLite-backed Durable Objects)

Durable Object storage is created automatically on first use; there is no migration step or connection string to configure.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | React SPA — pages, components, stores, i18n, WebSocket client |
| `src/lib/engine/` | Pure deterministic game engine (shared with the Worker) |
| `worker/` | Hono entry + `RoomDurableObject` + `ReplayDurableObject` + SQLite schema |
| `src/lib/socket/protocol.ts` | WebSocket wire protocol shared by client + Worker |
| `messages/` | i18n message catalogs (`zh`, `en`) |
| `wrangler.jsonc` | Cloudflare Worker + Durable Object + assets configuration |

## Game flow

Lobby -> role reveal -> team building -> vote -> mission -> result, repeated up to 5 missions. If enabled, Lady of the Lake runs after missions 2-4. If good wins 3 missions, assassination runs before game over. Finished games include full reveal and replay.
