# Avalon Online

A production-grade online implementation of Avalon for 5-10 friends. Joining stays open, while creating a room requires Pangda Auth OIDC. The server enforces role assignment, team voting, mission resolution, Lady of the Lake, assassination, reconnection, spectating, and full post-game replay.

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

Room codes are exactly four ASCII digits (`0000`–`9999`), kept as strings to preserve leading zeros. The join input and HTTP/WebSocket room endpoints require this format; legacy six-character codes are no longer accepted. Creation tries up to five random codes on collisions without overwriting existing rooms. Room state is not automatically reclaimed, so the 10,000-code space counts retained rooms, not just currently connected rooms.

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

## Voice rooms (Cloudflare RealtimeKit)

Every newly-created room includes an audio-only room. Seated players explicitly join voice, start muted, and can hold the mobile-friendly talk button, keep the microphone open, mute it, or switch input devices. RealtimeKit media state drives the participant microphone and speaking indicators; speech is not tied to game turns.

On desktop, hold **Space** from the game table to speak and release it to mute. Text fields and other keyboard controls keep their normal behavior. Switching tabs or moving focus out of the browser closes the microphone.

Create a RealtimeKit app and a preset whose meeting type is **Voice**. The preset must allow participants to produce audio without stage approval. Set its active participant/grid capacity to at least 10 so every Avalon player can be represented.

For local development, add these values to an ignored `.dev.vars` file:

```dotenv
CLOUDFLARE_ACCOUNT_ID=<account-id>
REALTIMEKIT_APP_ID=<realtimekit-app-id>
REALTIMEKIT_PRESET_NAME=<voice-preset-name>
REALTIMEKIT_API_TOKEN=<api-token>
```

The API token stays Worker-side and needs only the Cloudflare **Realtime / Realtime Admin** permission. For production, configure the three identifiers as Worker variables and store the token as a secret, for example:

```bash
npx wrangler secret put REALTIMEKIT_API_TOKEN
```

Never expose this token through a `VITE_*` variable. Because voice is now part of every room, room creation returns a configuration error when these settings are absent; joining existing rooms remains available.

## Room-creator OAuth (Pangda Auth / KeyForge)

Creating a room uses an OIDC Authorization Code flow with S256 PKCE. The Worker keeps the tokens in an encrypted HttpOnly cookie and accepts creation only after verifying an access token whose audience is exactly `https://avalon.pangda.app/createRoom`. Room preview and WebSocket join routes stay public. The creator's `preferred_username` becomes the first seat name, and the OIDC `picture` claim becomes its avatar.

Register this API resource in Pangda Auth:

```json
{
  "resource_uri": "https://avalon.pangda.app/createRoom",
  "name": "Avalon Create Room",
  "allowed_scopes": ["openid", "profile", "offline_access"]
}
```

Register a confidential `avalon` client with PKCE required, the same allowed resource/scopes, and this production callback:

```text
https://avalon.pangda.app/api/auth/callback
```

The non-secret issuer, client id, and resource audience live in `wrangler.jsonc`. Configure the two secrets separately:

```bash
npx wrangler secret put OIDC_CLIENT_SECRET
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' | npx wrangler secret put OIDC_SESSION_SECRET
```

For same-machine local development, start KeyForge at `http://localhost:17001` and open Avalon at `http://localhost:5173`. Use the separately registered `avalon_local` client and set `OIDC_ISSUER=http://localhost:17001`, `OIDC_CLIENT_ID=avalon_local`, `OIDC_CLIENT_SECRET`, `OIDC_RESOURCE`, `OIDC_SESSION_SECRET`, and `ENVIRONMENT=development` in the ignored `.dev.vars` file. The client callback must be exactly `http://localhost:5173/api/auth/callback`. This path does not require Cloudflare Tunnel; keep both local services running. In KeyForge, grant the client and `https://avalon.pangda.app/createRoom` API to the `all` group so every authenticated user can create a room.

For HTTPS tunnel testing, `https://auth-dev.pangda.app` remains supported but requires a connected Cloudflare Tunnel (HTTP 530 / error 1033 means that route is unavailable). Its discovery document publishes the internal `http://localhost:17001` origin. Development mode recognizes only that exact alias, validates all published endpoints against it, and rebases endpoint and avatar URLs to the public `auth-dev.pangda.app` origin. Production keeps strict issuer matching.

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

| Path                         | Purpose                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `src/`                       | React SPA — pages, components, stores, i18n, WebSocket client            |
| `src/lib/engine/`            | Pure deterministic game engine (shared with the Worker)                  |
| `worker/`                    | Hono entry + `RoomDurableObject` + `ReplayDurableObject` + SQLite schema |
| `src/lib/socket/protocol.ts` | WebSocket wire protocol shared by client + Worker                        |
| `messages/`                  | i18n message catalogs (`zh`, `en`)                                       |
| `wrangler.jsonc`             | Cloudflare Worker + Durable Object + assets configuration                |

## Game flow

Lobby -> role reveal -> team building -> vote -> mission -> result, repeated up to 5 missions. If enabled, Lady of the Lake runs after missions 2-4. If good wins 3 missions, assassination runs before game over. Finished games include full reveal and replay.

During assassination, every evil identity—including Oberon and Mordred—is revealed on a face-up player card in the center of the table, visible to players and spectators. Each card shows the seat number, player name, and role. Table seats keep their original presentation, and target selection is unchanged. Good identities remain private until game over.

The assassin can also choose **Functions → Start assassination early** during active play. After confirmation, unfinished votes, mission cards, and any pending Lady inspection are abandoned; completed history is preserved. Without a referee rollback, quests do not resume: hitting Merlin gives evil the win, while missing gives good the win, regardless of the mission tally. Other players and spectators cannot use the assassin-only action; referees have a separate phase-control action.

The referee panel also provides **Start Merlin identification** and **Return to previous phase**. Returning restores the prior leader, proposal, round and completed results; votes or mission cards in the restored phase must be submitted again. Repeated returns walk back through the phase history without redealing identities or changing seat ownership. Already-revealed information cannot be withdrawn. Referee phase actions are recorded in the public log, survive reconnection, and are reflected in the final replay.

After a game, the host can choose **Play again → Return to lobby** to bring everyone back to preparation in the same room. Room code, seat identities, reconnect tokens, configuration and voice meeting are preserved. The completed replay is archived before reset; the next deal gets a new game ID and fresh roles. Referees can also return from GameOver to correct the last phase; finishing again updates that game's replay.

Lobby hosts can remove any unclaimed seat by its stable seat ID. Remaining seats are renumbered without changing their occupants or reconnect tokens. Display names are normalized to at most 10 Unicode characters, for Chinese, Latin and mixed names alike, at both the identity UI and server boundary.
