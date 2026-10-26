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
[deploy/k8s](deploy/k8s/README.md), and commit-based releases through GHCR images in
[deploy/release](deploy/release/README.md). Site-specific infrastructure and migration
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
| `deploy/` | Optional R2, Kubernetes and release pipeline documentation |
| `dist/client/`, `dist/server/` | Generated frontend and backend build output |

See [gameplay](docs/gameplay.md), [architecture and recovery](docs/architecture.md),
[bot decisions](docs/bots.md), and [artwork provenance](docs/art/README.md).
[Publication review](docs/publication-review.md) records what was removed, retained
privately or still needs review before distribution.

### 战绩、复盘与评分

登录后从首页右上角「战绩」进入 `/history`：左侧是个人铭牌（对局分、称号、红蓝胜负、担任过的角色、近期战况），右侧是本人参加过的对局列表，滚动到底自动加载。点击任一局进入 `/replay/:gameId`。

复盘直接复用对局圆桌：按「开局 → 每次提名投票 → 出征 → 湖中仙女 → 刺杀 → 终局」逐拍回放，底栏可逐步、播放或拖动进程（`←/→/Home/End/空格`），当前拍记在 `?step=` 中便于分享。默认全知视角；点任一座位切换为该玩家视角，只显示其开局所知身份，匿名任务牌和他人的湖中仙女结果也保持背面。

评分版本 `bt-map-v1-1800`（`server/ratings.ts`）使用平均团队 Bradley–Terry 模型：
`P(蓝胜) = sigmoid(β₀ + u_config + mean(θ_blue) − mean(θ_red))`，玩家 / 蓝方优势 / 配置偏差的高斯先验标准差依次为 `1 / 0.7 / 0.35`，配置按角色集合、湖中仙女和拒绝上限区分，Newton MAP 拟合加回溯线搜索，Laplace 协方差。后台分为 `1800 + 400 / ln(10) × θ`；对局分为 `1000 + (1 − 0.94^n) × (后台分 − 1000)`，n 为本人计分局数。称号以后台分 1600 / 1750 / 1850 / 2000 分五档。单局分差是该局在全局时间线前后本人对局分之差（按需拟合历史前缀并缓存），未出场期间的变化不归入任何一局。后台分、协方差和账号映射不离开服务端。

计分资格：生产环境只计真人完整局，机器人对局完全从个人战绩、对局列表、角色/阵营统计和近期表现中隐藏，直接访问其复盘接口也返回 404；存档仍保留。本地开发（`ENVIRONMENT=development`）继续显示并计入机器人局。含回退、重随、撤回投票/提名或管理员代操作的对局、身份不全或数据不全的对局不计分，但仍可复盘并在列表中标注原因。

存储：对局结束时把席位→账号写入私有表 `avalon_game_seats`，并在 `avalon_replays.altered` 记录是否有干预。升级后首次启动会一次性（`avalon_migrations: game-seats-v1`）为旧对局补链接：仍存在的房间按其日志精确恢复；其余仅当「唯一真人席位 + 唯一结算账号」时关联，且标为旧对局不计分，绝不按昵称猜测。

接口（均需登录、`no-store`）：`GET /api/history` 返回本人铭牌；`GET /api/history/games?offset=0` 每页 30 本人参加过的对局；`GET /api/games/:id/replay` 返回 `{ replay, viewerId }`。每次请求先查归档版本号，未变化时复用内存中的拟合。

历史参与与席位归属分开处理：角色偏好结算或奖励结算能证明账号参加过该局时，即使旧记录无法恢复席位，也进入该账号的对局列表，标注「已确认参赛 · 角色未恢复」。这部分计入参与局数，单独返回 `unresolvedGames`；不纳入个人胜场、胜率、阵营/角色统计、近期胜负或评分。没有任何已知角色对局时胜率显示为未知。原始账号列表只在服务端使用。生产环境仍隐藏所有已标记机器人对局。精确席位回填只能来自匹配 game ID、修订号和完整 replay 的存档证据，不按昵称猜测。

经用户明确授权的历史名称修复：`server/history-name-recovery.ts` 仅供运营回填使用，不作为日后自动认领身份的规则。它使用历史已验证名称（含用户确认的别名）、完整结算名单和一对一约束，只输出唯一关联；冲突或歧义不自动写入。回填前备份并核对 replay 修订与完整内容，保存修复前后数据和依据。已确认的旧 `Bot N` 席位可补齐 `isBot`，现有正式环境隐藏规则随即生效，不删除存档。

对明确批准纳入评分的旧局，私有 `avalon_replays.rating_import = 'name-recovery-v1'` 允许缺少规则或干预审计的记录进入历史兼容模型；原 `altered = NULL` 和缺失规则保持原样。未知规则使用独立配置组，不假设等于当前默认规则；已知回退、机器人和身份不全仍排除。新的 replay 修订会清除该批准标记，防止旧批准覆盖后来的结果变化。
