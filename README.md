# Avalon Online

A production-grade online implementation of **The Resistance: Avalon** — play
with 5–10 friends, no login required. The server enforces every rule: role
assignment, team voting, mission resolution, Lady of the Lake, assassination,
reconnection, spectating, and full post-game replay.

- **Mobile-first**, real-time, medieval-fantasy themed.
- **i18n**: 简体中文 (default) + English.
- **Roles**: Merlin, Percival, Loyal Servant / Morgana, Assassin, Oberon,
  Mordred, Minion of Mordred. Lady of the Lake optional.

## Tech stack

- Next.js 15 (App Router) · React 19 · TypeScript (strict)
- TailwindCSS · Framer Motion · Zustand
- Socket.IO (real-time) — hosted in a **custom server** alongside Next
- PostgreSQL + Prisma (checkpoint persistence + replay)
- next-intl (i18n)

## Architecture

The authoritative game state lives **in memory** in a single Node process. A
pure, deterministic engine (`src/lib/engine/`) — framework-agnostic, seeded RNG,
fully unit-tested — drives all rules. The Socket.IO layer is a thin transport
that projects per-viewer state (no client ever sees another player's role or
mission card) and persists key checkpoints to Postgres for reconnect-recovery
and replay.

> Because Socket.IO needs a persistent connection, this app must run on a
> **long-process host** (Railway, Render, Fly.io) — not a serverless/edge
> platform like Vercel. Locale routing that would normally use Next middleware
> is handled in `server.ts` instead (middleware doesn't run under a custom
> server).

## Local development

```bash
npm install
cp .env.example .env          # set DATABASE_URL (and DIRECT_URL for migrations)
npx prisma migrate dev        # create tables
npm run dev                   # custom server on http://localhost:3000
```

Open multiple browser tabs (or phones on the same network) to simulate players.

### Scripts

- `npm run dev` — custom server with hot reload (`tsx watch server.ts`)
- `npm run build` — production Next build
- `npm run start` — production server (`NODE_ENV=production tsx server.ts`)
- `npm test` — engine unit tests (Vitest)
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint

## Environment variables

| Var            | Purpose                                                        |
| -------------- | ------------------------------------------------------------- |
| `DATABASE_URL` | Postgres connection (pooled URL for the app runtime)          |
| `DIRECT_URL`   | Non-pooled Postgres URL for `prisma migrate` (Neon/Supabase)  |
| `PORT`         | Server port (default 3000)                                    |
| `HOST`         | Bind host (default 0.0.0.0)                                   |

## Deployment

### Render (blueprint)

1. Push this repo to GitHub.
2. In Render, create a **Blueprint** from `render.yaml`.
3. Set `DATABASE_URL` and `DIRECT_URL` in the dashboard (e.g. a Neon database —
   use the pooled URL for `DATABASE_URL`, the direct URL for `DIRECT_URL`).
4. Deploy. The container runs `prisma migrate deploy` then starts the server.
   Health check: `/api/health`.

### Railway / any Docker host

```bash
docker build -t avalon-online .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://…pooled…" \
  -e DIRECT_URL="postgresql://…direct…" \
  avalon-online
```

The image applies pending migrations on startup, then launches the single
Next + Socket.IO process.

## Game flow

Lobby → role reveal → (team building → vote → mission → result)×5, with Lady of
the Lake after missions 2–4 if enabled → assassination (if good wins 3) → game
over + full reveal → replay.
