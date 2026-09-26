# Avalon Online

A production-grade online implementation of Avalon for 5-10 friends. Joining stays open, while creating a room requires Pangda Auth OIDC. The server enforces role assignment, team voting, mission resolution, Lady of the Lake, assassination, reconnection, spectating, and full post-game replay.

- Mobile-first, real-time, medieval-fantasy themed.
- i18n: Simplified Chinese (default) + English.
- Each proposal follows draft team → automatic public announcement and one speaking turn per player in seat order, starting with the next seat after the leader and ending with the leader → leader revises/confirms the final team → vote. Players end their own speaking turns; submitting the draft starts discussion immediately, and the leader confirms the final team after everyone has spoken. Referees can skip the current speaker; each skip is recorded in the public log.
- Speaking reminders are configurable in the room lobby before starting the game (30–600 seconds, default 120). The assassination discussion lasts 1.5 times the speaking time (default 180 seconds). Identity confirmation, team actions, votes, mission cards, and Lady inspections use 20 seconds. Timers continue into overtime without submitting or advancing anything; pending timers survive refresh, reconnect, and Durable Object hibernation. Referees can pause/resume the current phase’s clocks (including overtime); a new speaking turn or phase starts fresh, running timers. Games started before this change retain their original proposal flow for recovery/replay compatibility.
- Roles: Merlin, Percival, Loyal Servant, Morgana, Assassin, Oberon, Mordred, and Minion of Mordred. Lady of the Lake is optional.
- Private avatar notes are enabled by the Functions panel’s default-on checkbox. Enabling shows known information alongside saved manual guesses; disabling hides all identity labels and editing controls without resetting them. Merlin’s known enemies allow only specific red roles other than Mordred; unseen players allow blue notes and Mordred only when present in the lineup; Percival’s known pair allow only Merlin/Morgana guesses. Red teammates receive each other’s exact roles privately, with Oberon still excluded in both directions.
- Private notes and their visibility preference sync to the room every 5 seconds, with a 750 ms debounce after edits. Only the authenticated seat connection can read or update them. Reconnecting or reclaiming the same seat on another device restores the saved notes; transferring devices still uses the existing seat-token or release/reclaim flow. Pending offline edits remain in the browser and merge against versioned server data. Notes are excluded from public snapshots, game events and replays, and reset for a new game or role assignment. Spectator notes remain browser-local.

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
- The append-only **event log** is persisted in the DO's own **SQLite** and is the single source of truth: on wake the DO deterministically replays it to rebuild state. Game over first writes a complete replay snapshot into room SQLite, then archives it in a per-game `ReplayDurableObject` (keyed by game id). Durable alarms retry failed transfers every 30 seconds, even after players leave. A room cannot discard its event log or snapshot until the archive acknowledges storage. **There is no external database** — Postgres/Prisma were removed entirely.
- The React SPA is served as static assets by the Worker, with SPA fallback for client routes. Locale routing (`/zh`, `/en`) is handled client-side by React Router.

## Local development

```bash
npm install
npm run dev
```

`npm run dev` runs Vite with the Cloudflare plugin, so the React app, the Hono Worker, and the Durable Objects (including WebSockets) all run together in a local `workerd` runtime. Open multiple browser tabs or phones on the same network to simulate players.

## Room-creator OAuth (Pangda Auth / KeyForge)

Creating a room uses an OIDC Authorization Code flow with S256 PKCE. The Worker keeps the tokens in an encrypted HttpOnly cookie and accepts creation only after verifying an access token whose audience is exactly `https://avalon.pangda.app/createRoom`. Room preview and WebSocket join routes stay public. The creator's saved game alias (or `preferred_username` when no alias is set) becomes the first seat name, and the OIDC `picture` claim becomes its avatar.

Signed-in players can save a game alias of up to 10 characters on the home page. `POST /api/auth/alias` saves it in an `AccountProfileDurableObject` keyed by the verified OIDC issuer and subject. Profiles have no expiry and are independent of cookies, browsers and rooms. Session reads and token refreshes load the saved alias, so future sign-ins and room creation use it without changing the upstream account name.

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
- `durable_objects` → the `ROOM`, `REPLAY` and `ACCOUNT_PROFILE` bindings
- `migrations` → registers the room/replay classes in `v1` and the account profile class in `v2` as `new_sqlite_classes` (SQLite-backed Durable Objects)

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

Lobby -> role reveal -> team building -> vote -> mission -> result, repeated up to 5 missions. If enabled, Lady of the Lake runs after missions 2-4. If the blue team wins 3 missions, assassination runs before game over. Finished games include full reveal and replay.

During assassination, every red team identity—including Oberon and Mordred—is revealed on a face-up player card in the center of the table, visible to players and spectators. Each card shows the seat number, player name, and role. Table seats keep their original presentation, and target selection is unchanged. Blue team identities remain private until game over.

The assassin can also choose **Functions → Start assassination early** during active play. After confirmation, unfinished votes, mission cards, and any pending Lady inspection are abandoned; completed history is preserved. Without a referee rollback, quests do not resume: hitting Merlin gives the red team the win, while missing gives the blue team the win, regardless of the mission tally. Other players and spectators cannot use the assassin-only action; referees have a separate phase-control action.

The referee panel also provides **Start Merlin identification** and **Return to previous phase**. Returning restores the prior leader, proposal, round and completed results; votes or mission cards in the restored phase must be submitted again. Repeated returns walk back through the phase history without redealing identities or changing seat ownership. Already-revealed information cannot be withdrawn. Referee phase actions are recorded in the public log, survive reconnection, and are reflected in the final replay.

After a game, identities stay revealed on the table. The host can choose **Play again** to bring everyone back to preparation in the same room, while **View Replay** opens the completed game in a new tab. Room code, seat identities, reconnect tokens and configuration are preserved. The completed replay is archived before reset; the next deal gets a new game ID and fresh roles. Referees can also return from GameOver to correct the last phase; finishing again updates that game's replay.

Replays contain factual match records only: identities, outcomes, votes, mission cards, Lady inspections and assassination. There is no performance scoring or MVP selection. Archives are stored in independent SQLite-backed Durable Objects without a TTL or automatic deletion; the replay URL remains usable after room reuse, logout and server restarts. Existing durable KV archives remain readable. Event revisions prevent a delayed retry from overwriting a newer referee correction.

Lobby hosts can remove any unclaimed seat by its stable seat ID. Remaining seats are renumbered without changing their occupants or reconnect tokens. Display names are normalized to at most 10 Unicode characters, for Chinese, Latin and mixed names alike, at both the identity UI and server boundary.

## Full-screen table

The room preparation page keeps its original layout: the roster, role
configuration and start button are shown directly on the page. Starting a game
opens the viewport-sized table. Players sit along the two ends, with seat
numbers on the table edge and each player's cards in front of them. In-game
identity, rules and history open in scrollable sheets; the table and action rail
remain on screen. Short landscape screens place the action rail beside the table.

Team votes stay face-down until everybody has voted, then flip simultaneously
at their original seats. Quest submissions expose only which seats have played,
never the card values. Once a quest resolves, the client collects the backs,
shuffles an anonymous pile built solely from the result counts, and reveals it.
The server continues to synchronize during these brief presentation sequences.
Refreshing restores submitted-card markers, and referee vote retractions restore
the voting controls without requiring a refresh.

### Debug gallery

打开 `/zh/debug/gallery`（英文为 `/en/debug/gallery`），或点击首页底部的调试画廊入口。
无需登录或创建房间，所有模拟都在浏览器本地运行，复用实际游戏引擎、玩家视角投影和牌桌组件。

- 26 个预设涵盖身份揭示、组队与投票、任务结果动画、湖中仙女、刺杀、胜负结局、旁观入座与断线。
- 支持 5–10 人及任意玩家／旁观者视角；第四轮双失败门槛场景至少需要 7 人。
- 直接操作牌桌，或补齐其他玩家的投票与任务牌；可以撤销、重置并重播结果动画。
- 连接设置可切换断线、显示延迟、玩家在线状态，以及模拟下一次牌桌操作失败。显示延迟不会延缓操作。
- “复制入口”保存预设、人数和视角，不保存继续操作后的整局状态。例如 `/zh/debug/gallery?scene=twoFails&players=7&view=p0`。
- “查看当前视角数据”显示实际投影；本地预设中的所有角色可从视角选择器查看。模拟不写入房间、账号或战绩。
