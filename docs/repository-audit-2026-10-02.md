# Avalon 仓库逐目录逐文件审查报告

> 这是精简前的审查快照，文件名和行数对应下述基准提交。执行结果见 [精简完成记录](cleanup-2026-10-02.md)；已删除或拆分的旧路径请从基准 Git 提交查看。

审查日期：2026 年 10 月 2 日。基准提交：`19f369c97dd38f607d33d87ec026737cf511e3ee`。审查开始时 Git 工作区干净。本报告讨论当前文件的作用、保留必要性和精简次序，不以文件数量或行数直接判断质量。

**建议先删除 14 个已无入口的旧文件，再精简仍被使用的组件分支、重复规则和大控制器。不要删游戏规则、权限投影、恢复日志、同步校验、有效测试或当前三套牌面。** 构建重复图片与双锁文件分叉，比合并几个十行工具文件更值得优先处理。

本次只生成报告及本地审查清单，没有在原工作区删除或改写业务源码。运行构建重新生成了被 Git 忽略的 `dist/`；14 文件删除验证在独立临时副本中完成，没有部署、上传或访问生产数据库。

## 审查范围与证据

逐文件表覆盖审查基线的 **326 个 Git 文件**，没有用“其他文件类似”代替条目：236 个文本文件、90 个图片文件。文本合计 41,326 行，其中两份锁文件占 9,662 行，46 个测试文件占 7,936 行。每个文件的用途和建议在后文独立列出。

- 实现与配置：查看文件内容，解析 TypeScript 静态导入、转导出和字符串动态导入，追踪浏览器、服务端、构建、测试和脚本入口；再检索疑似废弃符号与实际 JSX 调用。
- 测试：逐文件梳理用例与断言结构，核对相关实现；执行现有非数据库测试。测试命名中的 `test-*` 支持文件也纳入审查，没有按名字批量判废。
- 锁文件与翻译：解析完整结构，核对直接依赖解析版本和语言键。没有逐条评价第三方库内部实现，也没有把锁文件里传递依赖视为手工删除对象。
- 图片：90 个文件全部解码，核对尺寸、大小、SHA-256、成对关系与动态资源入口；这证明资源完整性及使用关系，不声称做过逐像素美术质量或授权鉴定。
- 本地隐藏文件：登记路径、大小、类型和清理条件；环境文件仅核对键名，不在报告复制凭据。数据库备份、SQLite 与 WAL 不读取业务记录、不执行迁移恢复。
- `node_modules/`、`.git/`：作为第三方安装产物和版本库内部状态登记逐文件元数据，**不把它们伪装成已经人工审计的项目源码**。清理建议按生成/恢复职责给出，不能任意删其中单个文件。

本地磁盘完整元数据清单另见 [local-file-inventory.json](../.private/repository-audit-20261002/local-file-inventory.json)，忽略文件的逐项用途和处置见 [local-files.md](../.private/repository-audit-20261002/local-files.md)。这两份文件含本地路径，保留在被忽略目录中。统计采用报告生成前的盘点快照，报告本身不计入 326 个原始文件。

判定分为“保留”“精简”“删除”“条件删除”。“删除”表示本次没有找到当前入口且完成副本验证；“条件删除”表示仍涉及支持政策、历史数据或本地恢复资产，不能直接执行。

## 最应该先做的清理

### 第一批删除 14 个已被替代的文件

这些文件合计 **1,121 行、37,310 字节**。它们不是运行时插件注册入口，没有发现 glob、字符串组件注册等额外加载机制。`PickPile` 仅被同样孤立的 `AssassinPanel` 引用；`cueLogic` 只连接旧 hook 和自己的测试，不能因“还有一个测试引用它”就当作生产必需。

| 文件 | 行数 | 已存在的替代或删除依据 |
| --- | ---: | --- |
| [src/components/game/AssassinPanel.tsx](/Users/zehao/Projects/avalon/src/components/game/AssassinPanel.tsx) | 38 | 无运行或测试入口；GameView 已直接渲染刺杀提示和 TableCard。 |
| [src/components/game/LadyOfLake.tsx](/Users/zehao/Projects/avalon/src/components/game/LadyOfLake.tsx) | 36 | GameView 已内联该提示，无导入调用；不涉及删除 USE_LADY 游戏规则。 |
| [src/components/game/MissionResult.tsx](/Users/zehao/Projects/avalon/src/components/game/MissionResult.tsx) | 56 | 无入口；当前结果由 MissionTableReveal 和展示队列负责。 |
| [src/components/game/MissionVote.tsx](/Users/zehao/Projects/avalon/src/components/game/MissionVote.tsx) | 34 | 无入口；GameView 和 HandArea 已提供说明与行动。 |
| [src/components/game/PickPile.tsx](/Users/zehao/Projects/avalon/src/components/game/PickPile.tsx) | 102 | 唯一导入来自同样已孤立的 AssassinPanel，整个子图可删除。 |
| [src/components/game/TeamBuilder.tsx](/Users/zehao/Projects/avalon/src/components/game/TeamBuilder.tsx) | 37 | 无入口，GameView 已渲染同职责内容。 |
| [src/components/game/VotePanel.tsx](/Users/zehao/Projects/avalon/src/components/game/VotePanel.tsx) | 49 | 无入口，GameView 当前进度与 HandArea 覆盖该职责。 |
| [src/components/game/VoteTokens.tsx](/Users/zehao/Projects/avalon/src/components/game/VoteTokens.tsx) | 375 | 375 行无外部导入；已由 TableCard、MissionTableReveal、useTablePresentation 替代。 |
| [src/components/lobby/NameEditor.tsx](/Users/zehao/Projects/avalon/src/components/lobby/NameEditor.tsx) | 71 | 无入口；昵称由首页账户别名维护、大厅同步 rename。不要顺带删掉仍被 LobbyPage 使用的 rename API。 |
| [src/components/lobby/PlayerList.tsx](/Users/zehao/Projects/avalon/src/components/lobby/PlayerList.tsx) | 102 | 无入口；现有 SeatPicker 负责大厅玩家网格与管理。 |
| [src/components/ui/Toggle.tsx](/Users/zehao/Projects/avalon/src/components/ui/Toggle.tsx) | 46 | 无入口，当前配置与笔记用原生 checkbox。 |
| [src/lib/game/cueLogic.test.ts](/Users/zehao/Projects/avalon/src/lib/game/cueLogic.test.ts) | 77 | 随已废弃 cueLogic/useResultCue 删除；其 8 项用例不再保护现行展示队列。 |
| [src/lib/game/cueLogic.ts](/Users/zehao/Projects/avalon/src/lib/game/cueLogic.ts) | 60 | 只被孤立 useResultCue 与自己的测试消费；现由 tablePresentation 的顺序队列承担。 |
| [src/lib/game/useResultCue.ts](/Users/zehao/Projects/avalon/src/lib/game/useResultCue.ts) | 38 | 没有任何调用者，已由 useTablePresentation 取代。 |

新的实现关系是：`GameView` 负责阶段提示；`HandArea` 负责行动；`TableCard` 负责公共牌面；`tablePresentation` 和 `useTablePresentation` 负责结果顺序；`MissionTableReveal` 负责当前任务动画；`SeatPicker` 负责大厅网格。删除旧文件不会删除这些功能。

已在独立副本移除上述 14 文件：TypeScript、Lint、构建通过，756 项 Vitest 与 4 项 Node 测试通过，20 项 PostgreSQL 测试依旧跳过。少掉的 8 项正是旧 `cueLogic.test.ts` 的测试。没有在原工作区做删除，也未做此次删减后的人工浏览器回归。

删减前后主 JS 均约 632.00 kB，gzip 均约 199.55 kB；CSS 从 67.40 kB 降至 64.43 kB，gzip 从 14.27 kB 降至 13.84 kB。旧 TSX 即使不进入 JS，也会被 Tailwind 的 `src/**/*` 内容扫描看见。**不要把 1,121 行源码删除宣传成主 JS 大幅提速。**

### 第二批删除有效文件中的旧分支

| 文件或范围 | 可以精简的内容 | 必须留下的内容 |
| --- | --- | --- |
| `src/components/animations/index.tsx` | 无调用的 `FadeIn`、`PhaseTransition`、`Pulse` | 两个真实消费者使用的 `FlipCard` |
| `MissionTrack.tsx` | `vertical` 和非 `compact` 两套旧模式 | 当前任务进度、双失败标记和历史入口 |
| `ProposalTracker.tsx` | `vertical` 与非 `compact` 旧模式 | 配置化拒绝上限和最后机会提示 |
| `IdentityCard.tsx` | 非 `compact` 大号触发器 | 私有身份及知识的 modal |
| `VoteResultPanel.tsx` | 非 `compact` 布局分支 | 逐人投票、队伍及 `showProposalLabel` 差异 |
| `MissionCardReveal.tsx` | 无调用的实时随机翻牌、定时器、`revealed`、`onComplete` 模式 | 两个调用者都使用的 `instant` 历史任务卡展示 |
| `IdentityPanel.tsx` | 未登录分支、`onLogin` 和可空 `user` 的冗余支持 | 已登录账户、别名与退出；首页已有 `AccountLogin` |
| `GameTable.tsx` | 唯一调用者未传入的 `hostId` 分支 | 当前座位、角色笔记、选择与动画挂点 |
| `server/room-helpers.ts` | 无调用的 `nextSeat`、`claimableSeats` | 配置/名字/头像归一和正式快照 |
| `src/lib/engine/fsm.ts` | 无调用的 `loyaltyOf` | 实际阶段 guard、比分和首领函数 |
| `src/lib/engine/testkit.ts` | 无调用的 `unanimous`、`goodIds` | 被各规则测试引用的构造器和发言流程 |
| `src/i18n/navigation.tsx` | 无调用的 `usePathname` | 大量现有消费者使用的 `Link`、`useRouter` |
| `src/lib/socket/types.ts` | 旧 Socket.IO 的 `RoomRuntime`、`SocketData`、空 `InterServerEvents` | 当前房间结构、ACK 和协议参数契约 |
| `src/lib/socket/protocol.ts` | 无消费的 `ClientMessage` 别名、长篇迁移背景 | 实际 wire 消息类型 |
| `server/room.ts` | 空方法 `persistConfig()` 及两处调用 | `run()` 中完整状态事务提交 |
| 客户端 `roomActions.transferHost` | 当前无人使用且服务端明确返回 `NOT_SUPPORTED` 的包装 | 服务端拒绝旧事件的分支可留一个兼容周期 |
| 39 个文件的 `'use client'` 指令 | 当前 Vite SPA 中不承担客户端/服务端划分的迁移遗留指令 | React hook、provider 与真实浏览器生命周期 |

这里有些精简会减少几十到上百行，有些仅移除无效接口。不要为追求某个行数目标把所有小工具函数塞回大文件。第二批是经调用检查形成的建议，尚未在副本实施整批改写验证，不能把第一批的验证结果借用给它。

### 第三批统一重复规则和构建流程

**静态图片重复输出。** `scripts/static-assets.ts` 给每张 public 图片生成哈希地址；Vite 默认仍把 public 原路径复制到输出。重新构建后，90 组源图片在 `dist/client` 同时存在原路径副本与内容哈希副本，多占 **14,336,060 字节，即 13.67 MiB**，客户端构建目录共约 28.06 MiB。这是构建/镜像/发布存储冗余，不代表浏览器必然下载两次。

建议让生产构建只走一个经过清单验证的资源输出流程，例如核实所有 `assetUrl()` 与 HTML 地址覆盖后关闭生产 `copyPublicDir`。开发继续使用原路径。如果仍承诺兼容旧无 hash URL，应明确列出兼容资源，而不是无条件复制全部文件。修改后要同时核验应用本源和 CDN 两种 base、favicon、苹果图标、三套牌面、头像池、manifest、MIME 与缺图 404。不要靠手动删 `dist` 下的重复文件作为长期修复。

还发现 `public/assets/game/.DS_Store` 和 `public/assets/game/roles/.DS_Store` 被默认 public 复制带入 `dist/client`，尽管它们被 Git 忽略、也被自定义插件跳过。**这两份 Finder 元数据可以直接删除**，并应从构建复制入口杜绝再次带入。它们不计入 14 个受版本管理的删除候选。

**双锁文件已经漂移。** README 当前支持两种包管理器，因此这不是“随便删任意一个锁”的理由。建议统一 npm，因为 Dockerfile 已经使用 `npm ci`，随后删除 `pnpm-lock.yaml` 并统一 README、脚本提示和开发约定。若选择 pnpm，应先改 Docker 构建和安装约定。以下是本次解析到的直接开发依赖差异，不包含传递依赖全部差异：

| 依赖 | npm 锁 | pnpm 锁 |
| --- | --- | --- |
| `@types/react` | 19.2.17 | 19.2.18 |
| `@types/react-dom` | 19.2.3 | 19.2.4 |
| `autoprefixer` | 10.5.2 | 10.5.4 |
| `eslint` | 9.39.4 | 9.39.5 |
| `prettier` | 3.9.4 | 3.9.6 |
| `typescript-eslint` | 8.63.0 | 8.66.0 |

**其他可收敛处。**

- `ROLE_TEAM_UI` 与 `engine/roles.ts` 的阵营表完全重复，使用一个叶子模块常量即可；不要为了共用这个常量引入整个服务器运行时。
- `staticBase` 与 `staticPublishConfig` 重复校验 HTTPS 及 `/avalon/`。抽出共享解析函数，同时保留“普通构建可空、发布必须填”的差异。
- `ConfigPanel` 和 reducer 分别维护相同角色展示顺序，可共用只读顺序常量；不要把纯展示序列与发牌顺序混为一谈。
- 前后端 tsconfig 的共同选项可以复用，但浏览器与 Node 的项目边界应保留。`scripts/benchmark-bots.ts` 目前不在任一显式 include 中；Vite 间接包含的是 `static-assets.ts`，不能据此说所有脚本都被类型检查。
- `eslint-plugin-react-hooks` 当前只有注册，没有任何 hook 规则启用；MJS 脚本也未获得当前 TS 规则。选择补齐需要的规则，或去掉没有效果的注册。`prettier` 没有 format 命令和项目配置，确认团队是否使用后接入或移除。
- 中英文各 614 个叶子翻译键，键集合一致。删旧组件后同步删其独占翻译，但保留当前仍在用的 `cue`、动态 `log`、`phase`、`roles` 等键。开发画廊代码虽已排除生产，`debug` 翻译仍随全量消息导入，可拆成仅开发加载。

## 应该重构而不是删除的核心

| 对象 | 现在的问题 | 建议边界 |
| --- | --- | --- |
| `server/room.ts`，1783 行 | 命令事务、socket、账户座位、笔记、裁判、bot、恢复和广播聚在一类 | 保留统一串行/提交边界；把成员命令、裁判命令、视图发布、checkpoint 调度拆成清晰模块，避免每个模块自行提交 |
| `server/auth.ts`，1008 行 | 协议、provider 配置、cookie 加密、网络和错误映射耦合 | 分 OIDC 配置/发现、token 校验、sealed session 与路由适配；为 discovery/JWKS 做按 issuer 区分的缓存需单独测试失效和刷新 |
| `src/pages/GamePage.tsx`，702 行 | live adapter 和大量阶段 JSX、笔记、动画/动作编排混在一起 | 拆 `GamePage` 的房间适配、可注入 actions 的 `GameView`、阶段提示板与展示控制；保持 debug 复用真实视图 |
| `src/globals.css`，1738 行 | 桌面、角色卡、弹窗、笔记和计时样式混在一处 | 按 table/role/dialog/notes/timing 拆文件；保留全局字体主题和明确层叠顺序，结合画廊做横竖屏检查 |
| `src/lib/engine/reducer.ts`，873 行 | 多阶段纯函数同文件，阅读和定位困难 | 在引擎目录拆职责模块；保持 `reduce()` 单一入口、注入时间/RNG、输入不变和回放语义 |
| `AdminPanel`、`FunctionsPanel`、`GameTools`、历史/湖验弹窗 | 各自维护 portal、确认、busy、焦点和层级 | 普通弹窗统一使用现有原生 `TableSheet`/dialog；原生顶层与普通 body portal 不能单靠 z-index 统一 |
| `server/database.ts`，354 行 | DDL、账户查询和房间/奖励/回放事务同处 | 拆迁移与查询 helper，仍在同一个连接/事务完成房间与奖励及回放提交 |
| `server/room.test.ts`，1683 行 | 多类功能和夹具集中，检索与维护成本高 | 按 seating/notes/referee/rewards/sync/recovery 拆测试，复用 Peer harness；不要通过删关键断言降低行数 |

主入口当前静态导入四个业务页面，构建给出主 JS 大于 500 kB 的提示。可按 Game/Replay 等路由拆包，先测实际首屏收益；不要仅提高 warning 阈值。当前业务是有状态多人游戏，恢复、隐私、确定性和设备接管机制的复杂性有实际来源，不适合一律替换成“更短的简单实现”。

## 必须有迁移条件的清理

1. **旧同步协议。** 当前客户端总是以 `syncVersion: 1` 加入，只消费 `view:sync`，但服务端仍为旧客户端发 `state:sync`、`room:snapshot`、`private:reveal`、`private:lady`。可以收敛，条件是部署窗口确认旧客户端刷新或强制重连，并把仍以旧协议读取状态的测试 harness 迁移到原子 view。删除类型而保留发送分支会制造不一致。
2. **旧 seat/host token。** 当前账户恢复优先，但 `handleJoin()` 明确支持尚未绑定账户的历史房间。`sessions`、`hostToken`、`playerToken`、localStorage session store 不能只因新房间使用账户就全部删掉。先明确历史房间和设备恢复迁移方案。
3. **旧游戏 flowVersion。** v1–v4 分支仍保护旧事件回放；`replay-builder` 也对缺少版本的旧 START_GAME 使用 v1。只有历史数据迁移/过期策略明确后才能删。
4. **本地 `.dev.vars` 兼容。** `dev.mjs` 现在实际读取它，而且当前磁盘存在该配置、没有 `.env.local`。先把需要的开发配置迁入 `.env.local`，验证本地启动，再删兼容分支及旧文件。`.dev.vars.prod`、`.env.neon` 未被普通启动入口读取，但仍可能被手工命令和历史运维流程使用，应先迁入私有配置库。
5. **永久房间和回放。** 数据库房间没有自动过期，四位码只有 10,000 种；不能通过删 `rooms.ts` 或内存 eviction 解决持久表增长。需要定义空闲房间留存、邀请码复用和回放独立保留政策，并评估历史链接及账号记录影响。当前没有执行任何数据清理。

## 不应该为了精简而删的东西

- 90 张发布图片都能从牌组/图标映射、头像池或 HTML 找到使用路径，SHA-256 没有完全相同的源文件。三套牌面是已有偏好选项，删掉任何一套是产品功能变更。35 张大牌面与 35 张角色头像是不同裁切和分辨率，不能按“画的是同一个人”判重复。
- `projection.ts`、`visibility.ts`、`stateIntegrity.ts`、`room-journal.ts` 分别处理身份知识、实时可见字段、网络视图校验和持久恢复，职责相关但不重复。
- `test-bot-baseline.ts` 是刻意冻结的对照策略；`test-auth.ts` 是真实服务器集成测试夹具；`test-persistence.ts` 是内存替身，三者都不能按“不进入生产包”判废。
- Debug 画廊和场景回归测试是当前 UI 检查工具。本次生产构建没有 DebugGalleryPage chunk；继续保留 DEV 边界即可。
- 本地/生产 Compose、前端/后端 tsconfig、账户服务器偏好/本地显示缓存都有不同职责，不宜机械合并。
- `.backups`、旧 SQLite 的 WAL 和唯一原图可能不可重建，不能与 `dist` 或 `node_modules` 同级处理。

## 验证结果和限度

| 检查 | 原始基线 | 临时副本删除 14 文件后 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | 通过 |
| `npm run lint` | 通过 | 通过 |
| Vitest | 43 文件通过，764 项通过；1 文件/20 项跳过 | 42 文件通过，756 项通过；1 文件/20 项跳过 |
| Node 脚本测试 | 4 项通过 | 4 项通过 |
| `npm run build` | 通过，主 JS 体积警告 | 通过，同类警告 |
| 实际 PostgreSQL 集成 | 未运行 | 未运行 |
| 生产部署、CDN 上传 | 未执行 | 未执行 |

测试命令显式取消 `TEST_DATABASE_URL`，因为集成测试会 TRUNCATE 应用表，本次没有准备独立可销毁数据库。单元测试通过不是数据库故障恢复已在真实库重新验证的证明。执行环境为本机 Node 26.8.1，Dockerfile 固定 Node 22；没有重建 Docker 镜像或复验 Node 22。

静态分析可证明仓库内已知入口的可达性，不能证明仓库外手工脚本或长期不刷新的旧客户端不存在。没有进行完整浏览器交互、响应式截图、线上负载或第三方依赖源码审计。第二批及更大重构实施后仍需按各自影响补验；不能挪用此次第一批副本结果。

## 建议实施次序

1. 删除已验证的 14 文件、两个 `.DS_Store`；将 8 项废弃 cue 测试一并移除，其他测试保留。
2. 清理无调用的导出、固定模式组件旧分支、空方法、过时注释和独占翻译；每个小批次通过现有检查，再跑画廊相关场景。
3. 统一包管理器与锁文件、静态资源输出、阵营映射和 CDN URL 解析；分别验证容器安装与本源/CDN 构建。
4. 拆 `GameView`、样式和普通弹窗；这是结构重构，应维持已有显示和动作语义。
5. 最后拆 Room/auth/database，保持事务与权限边界，并在独立 PostgreSQL 上运行 20 项集成测试。
6. 另开数据/兼容性迁移工作处理旧协议、token、flowVersion 和永久房间，不夹带进普通删文件提交。

以下是逐目录、逐文件的完整台账。条目中的“入口/消费者”为直接源码依赖或框架/命令入口，不把没有静态 import 的文档、锁文件和 public 资源默认判为无用。

## 目录台账

以下磁盘空间采用本次目录盘点的逻辑文件字节和，不等同于文件系统实际分配空间；子目录统计包含后代，不能把父子行再次相加。

| 顶层目录或范围 | Git 文件数 | 本地文件数 | 本地大小 | 作用与建议 |
| --- | ---: | ---: | ---: | --- |
| `(根目录)` | 18 | 21 | 0.33 MiB | 入口、配置与锁文件；保留当前构建运行链，统一锁文件。 |
| `deploy` | 3 | 3 | 0.00 MiB | 可选部署说明；保留 R2 能力与 K8s 单进程约束。 |
| `docs` | 11 | 22 | 25.61 MiB | 架构、规则、来源与历史审查；furry 原图移至素材库可减小工作目录。 |
| `messages` | 2 | 2 | 0.06 MiB | 双语翻译；按实际消费精简，不能删动态键。 |
| `public` | 90 | 92 | 13.69 MiB | 90 张发布图和少量 Finder 杂项；保留图片，删 .DS_Store。 |
| `scripts` | 9 | 9 | 0.02 MiB | 开发、构建/CDN 和 bot 基准；全部正式入口或其支持文件。 |
| `server` | 39 | 39 | 0.36 MiB | Node 房间、认证、持久化、bot 与测试；分解大文件，保留一致性机制。 |
| `src` | 154 | 154 | 0.65 MiB | 前端、纯规则、共享契约和测试；优先清理旧 UI 孤立子图。 |
| `.git` | 0 | 528 | 18.51 MiB | 版本历史和本地 Git 状态；保留，不手动裁剪内部文件。 |
| `node_modules` | 0 | 30701 | 666.48 MiB | 安装依赖；可整目录重装，不属于待审查的自研源码。 |
| `dist` | 0 | 187 | 28.25 MiB | 可重新构建；修正重复输出，不手动长期维护。 |
| `.wrangler` | 0 | 87 | 40.40 MiB | 旧 Worker 本地数据库/状态；归档确认后清理，不直接删 WAL。 |
| `.backups` | 0 | 179 | 20.72 MiB | 数据库与发布恢复点；按已验证的恢复/保留政策迁出或过期。 |
| `.private` | 0 | 47 | 8.93 MiB | 旧运维、清理、美术档案；从活动工作目录迁至专用私有存储。 |
| `.pnpm-store` | 0 | 0 | 0.00 MiB | 当前为空目录树；可随 npm 统一方案清理。 |

### 源码子目录边界

| 目录 | 职责与必要性 |
| --- | --- |
| `deploy/k8s/` | 集群部署约束；当前没有公开的可执行生产清单。 |
| `deploy/r2/` | 静态对象存储发布与 CORS 样例。 |
| `docs/art/` | 美术来源及逐图转换参数，不参与运行但有维护必要。 |
| `docs/art/furry-source/` | 被忽略的原图工作目录，唯一版本文件是 .gitignore。 |
| `src/components/` | 按页面/业务分组的界面组件，根部是全站偏好。 |
| `src/components/animations/` | 当前有效 FlipCard 加三个无消费者旧组件。 |
| `src/components/auth/` | 登录入口与路由访问门槛。 |
| `src/components/game/` | 桌面、行动、动画、战报、裁判与笔记；旧面板集中清理。 |
| `src/components/home/` | 账户资料编辑。 |
| `src/components/lobby/` | 准备房间的座位、配置与头部；两份旧组件可删。 |
| `src/components/player/` | 跨页面的玩家头像回退组件。 |
| `src/components/ui/` | 通用 UI；只删无消费者 Toggle。 |
| `src/i18n/` | 消息 provider、语言判断及导航适配。 |
| `src/lib/` | 业务库与共享偏好/资源入口。 |
| `src/lib/auth/` | 账户类型与浏览器会话生命周期。 |
| `src/lib/debug/` | 开发场景与其回归测试。 |
| `src/lib/engine/` | 纯规则、RNG、视图权限和测试；与托管平台无关。 |
| `src/lib/game/` | 展示决策、资源映射、私有笔记、交互 hook；清理旧 cue 子图。 |
| `src/lib/socket/` | 协议、房间 DTO、配置与摘要规范。 |
| `src/lib/socket/client/` | WebSocket、完整性恢复、心跳及 React 适配。 |
| `src/lib/store/` | 房间瞬态状态、会话重连缓存与账户显示偏好。 |
| `src/lib/utils/` | 类名与延迟等短小共享函数。 |
| `src/pages/` | 路由页面及仅开发的场景台。 |
| `public/assets/` | 只放最终发布的静态资源。 |
| `public/assets/game/` | 独立图标、玩家头像和三套角色牌面。 |
| `public/assets/game/icons/` | 8 个跨牌组共用图标。 |
| `public/assets/game/player-avatars/` | 10 个无阵营含义的玩家头像。 |
| `public/assets/game/roles/` | 三套等价牌面风格，保留与偏好选项一致。 |
| `public/assets/game/roles/classic/` | classic 牌组，13 张卡面及 13 张头像。 |
| `public/assets/game/roles/classic/cards/` | 1024×1536 完整角色卡画，由 RoleCard 使用。 |
| `public/assets/game/roles/classic/avatars/` | 512×512 角色肖像，由 RolePortrait 使用。 |
| `public/assets/game/roles/modern/` | modern 牌组，11 张卡面及 11 张头像。 |
| `public/assets/game/roles/modern/cards/` | 1024×1536 完整角色卡画，由 RoleCard 使用。 |
| `public/assets/game/roles/modern/avatars/` | 512×512 角色肖像，由 RolePortrait 使用。 |
| `public/assets/game/roles/furry/` | furry 牌组，11 张卡面及 11 张头像。 |
| `public/assets/game/roles/furry/cards/` | 1024×1536 完整角色卡画，由 RoleCard 使用。 |
| `public/assets/game/roles/furry/avatars/` | 512×512 角色肖像，由 RolePortrait 使用。 |

## 326 个版本文件的逐项审查

表内行数按原文件统计，二进制图片改列尺寸及 KiB。调用者信息只展示最多三处以控制表宽；全部 imports、usedBy、测试名称、尺寸和摘要证据保存在 [source-evidence.json](../.private/repository-audit-20261002/source-evidence.json)。此报告不自动执行建议。

### 根目录

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [.dockerignore](/Users/zehao/Projects/avalon/.dockerignore) | 29 | **保留** | 控制容器构建上下文，排除密钥、备份、开发缓存和文档。 | 避免本地私有资料进入镜像；与 Git 忽略规则职责不同。 |
| [.env.example](/Users/zehao/Projects/avalon/.env.example) | 25 | **保留并补充** | 列出数据库、监听地址、部署环境、OIDC 与可选 CDN 配置。 | 应补充会话密钥必须为 base64url 编码的 32 字节，以及本地数据库端口选项；空凭据占位应保留。 |
| [.gitignore](/Users/zehao/Projects/avalon/.gitignore) | 42 | **保留并精简** | 排除环境变量、构建产物、备份、私有运维和旧工具状态。 | 部分 .env 匹配重复可合并；.next、.wrangler 的忽略规则有防误提交价值，不能因框架迁移一并删除。 |
| [Dockerfile](/Users/zehao/Projects/avalon/Dockerfile) | 18 | **保留** | Node 22 多阶段构建，npm ci，生产依赖安装，非 root 启动。 | 当前正式打包入口，直接依赖 package-lock.json；开发与运行依赖分层合理。 |
| [README.md](/Users/zehao/Projects/avalon/README.md) | 128 | **保留并校正** | 项目入口、开发、登录、自部署和验证说明。 | 更新包管理器政策；保留单进程与专用开发数据库约束，不继续堆叠历史发布记录。 |
| [compose.dev.yaml](/Users/zehao/Projects/avalon/compose.dev.yaml) | 19 | **保留** | 独立开发 PostgreSQL，回环地址端口和持久卷。 | 与正式 Compose 的数据库隔离是必要措施，不应合并成容易误选生产库的配置。 |
| [compose.yaml](/Users/zehao/Projects/avalon/compose.yaml) | 33 | **保留** | 自托管 app 和 PostgreSQL，健康检查、私有监听、持久卷。 | 可工作的正式部署样例；与开发 Compose 并非无意义重复。 |
| [eslint.config.mjs](/Users/zehao/Projects/avalon/eslint.config.mjs) | 37 | **精简并加强** | TypeScript 未使用变量检测，以及引擎禁用 Math.random 的规则。 | react-hooks 插件已注册但未启用任何规则，当前 lint 通过不代表 hooks 合规；MJS 未纳入有效规则。启用需要的规则或删除无用插件注册。 |
| [index.html](/Users/zehao/Projects/avalon/index.html) | 25 | **保留并精简** | Vite HTML 入口，图标、字体、视口与 React 挂载点。 | 图标及字体仍被使用；建议去掉禁止缩放的 maximum-scale 和 user-scalable 配置，保留移动端安全区域。 |
| [package-lock.json](/Users/zehao/Projects/avalon/package-lock.json) | 5918 | **保留** | npm 完整依赖解析和校验信息。 | Dockerfile 使用 npm ci；建议作为唯一锁文件。无需人工精简传递依赖条目。 |
| [package.json](/Users/zehao/Projects/avalon/package.json) | 66 | **精简** | 依赖、开发启动、构建、测试、静态发布和 bot 基准命令。 | 运行依赖都有消费者；prettier 无脚本和专用配置，选择接入 format/check 或移除。固定主包管理器；不要误删实际用于 dev.mjs 的 concurrently。 |
| [pnpm-lock.yaml](/Users/zehao/Projects/avalon/pnpm-lock.yaml) | 3744 | **条件删除** | pnpm 依赖解析文件。 | 与 npm 锁的 6 个直接开发依赖版本已分叉；统一 npm 后删除并修改 README。若选择 pnpm，应先改 Dockerfile，再删除 npm 锁。 |
| [postcss.config.mjs](/Users/zehao/Projects/avalon/postcss.config.mjs) | 8 | **保留** | 连接 Tailwind 和 Autoprefixer。 | 当前 CSS 构建链需要；不因文件只有数行而合并到业务代码。 |
| [tailwind.config.ts](/Users/zehao/Projects/avalon/tailwind.config.ts) | 61 | **保留并精简** | 颜色、字体、阴影及动画主题配置。 | 先清理无消费者的主题扩展再考虑删值；动态 class 和 CSS theme() 使用必须一起检索。 |
| [tsconfig.json](/Users/zehao/Projects/avalon/tsconfig.json) | 25 | **保留并整理** | 前端和 Vite/Vitest 的严格类型检查。 | 可抽公共基础配置；需显式将 scripts 中未被配置导入的 TS 命令纳入检查，当前 benchmark-bots.ts 不在该项目文件列表中。 |
| [tsconfig.server.json](/Users/zehao/Projects/avalon/tsconfig.server.json) | 32 | **保留并整理** | Node 服务端及其测试的类型检查。 | 环境和入口与浏览器不同，应保留独立项目边界；共用 compilerOptions 可 extends。 |
| [vite.config.ts](/Users/zehao/Projects/avalon/vite.config.ts) | 31 | **精简** | React 编译、路径别名、开发代理和静态资源插件。 | 修正 public 原样复制与插件二次输出造成的资源重复；保留 HTTP/WebSocket 代理。 |
| [vitest.config.ts](/Users/zehao/Projects/avalon/vitest.config.ts) | 15 | **保留** | 发现前后端测试，统一 node 环境、JSX 和别名。 | node 环境不等于浏览器端交互验证，不能用它替代弹窗和移动布局检查。 |

### deploy/k8s

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [README.md](/Users/zehao/Projects/avalon/deploy/k8s/README.md) | 34 | **保留** | 解释单副本、Recreate、就绪检查、密钥和恢复约束。 | 不是可执行集群清单，但对避免错误多副本部署有必要；短文档可以继续单独维护。 |

### deploy/r2

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [README.md](/Users/zehao/Projects/avalon/deploy/r2/README.md) | 47 | **保留** | 可选 CDN 构建、上传、校验和保留旧资源的使用步骤。 | R2 仍是现有可选静态发布能力，不能把它与已移除的 Worker 运行时混为一谈。 |
| [cors.json](/Users/zehao/Projects/avalon/deploy/r2/cors.json) | 12 | **保留** | 公开静态资源的 GET/HEAD 跨域规则样例。 | 与 CDN 模块和图片访问有关；不要用于带私有数据的存储桶。 |

### docs

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [architecture.md](/Users/zehao/Projects/avalon/docs/architecture.md) | 78 | **保留并更新** | 房间串行化、事务、journal、checkpoint、视图同步和恢复约束。 | 是清理兼容分支时的依据；补充版本退场及房间留存政策，避免只删除机制。 |
| [bots.md](/Users/zehao/Projects/avalon/docs/bots.md) | 60 | **保留** | bot 推理边界、红方出牌约定、基准解释。 | 明确诊断数据私密、非人类实测结论；基准旧策略有刻意冻结的价值。 |
| [gameplay.md](/Users/zehao/Projects/avalon/docs/gameplay.md) | 41 | **精简并校正** | 游戏流程、裁判、回放、入座和重随卡规则。 | 开头遗漏讲解、发言、定队阶段；正文关于 logout 后回放可用应区分地址保留与必须重新登录。应补充座位重排及角色权重规则。 |
| [publication-review.md](/Users/zehao/Projects/avalon/docs/publication-review.md) | 68 | **保留归档** | 记录此前公开发布整理的范围、删除项和当时验证结果。 | 这是历史记录，724/19 不应当作本次 764/20 的现状；加日期语义或移入历史审查目录，别据此删除当下新增代码。 |

### docs/art

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [README.md](/Users/zehao/Projects/avalon/docs/art/README.md) | 172 | **保留** | 三套牌面、头像、图标、偏好和素材来源说明。 | 维护 90 个动态资源的必要文档；不能因运行时未 import 就删除来源记录。 |
| [classic-cards.json](/Users/zehao/Projects/avalon/docs/art/classic-cards.json) | 176 | **保留** | 13 个 classic 角色的描述、导出路径和头像裁切坐标。 | 不是运行数据，承担美术再加工与追溯职责；精简不能丢失逐角色裁切信息。 |
| [furry-cards.json](/Users/zehao/Projects/avalon/docs/art/furry-cards.json) | 20 | **保留** | 11 个 furry 原图到卡面/头像的转换说明与裁切参数。 | 连接本地原始素材和发布图片；原图不在公开资源目录中。 |
| [game-icons.json](/Users/zehao/Projects/avalon/docs/art/game-icons.json) | 55 | **保留并整理** | 图标提示、抠图导出与参考信息。 | 运行映射含 8 个图标，metadata 的 icons 数组为 7 项，assassinate 的保留来源在 README；建议统一记录格式。 |
| [modern-cards.json](/Users/zehao/Projects/avalon/docs/art/modern-cards.json) | 67 | **保留并整理** | 11 个 modern 角色的生成提示、参考和风格描述。 | 可整理为共享风格加逐角色差异，但保留历史修订信息和实际素材映射。 |
| [player-avatars.json](/Users/zehao/Projects/avalon/docs/art/player-avatars.json) | 57 | **精简** | 10 个独立头像的生成提示与输出路径。 | 各条长提示大量重复；可提取 sharedPrompt 加 subject 字段，保持完整提示可重建。与运行时 ID 清单不是同一职责。 |

### docs/art/furry-source

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [.gitignore](/Users/zehao/Projects/avalon/docs/art/furry-source/.gitignore) | 2 | **保留** | 忽略目录中的原始上传图，仅保留忽略文件本身。 | 防止约 25.5 MiB 原图被误提交；若原图全迁出，可连目录和此占位文件一起去掉。 |

### messages

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [en.json](/Users/zehao/Projects/avalon/messages/en.json) | 769 | **精简** | 英文界面、阶段、日志、错误和调试翻译。 | 614 个叶子键，与中文一致；按实际使用删旧键，动态 log/phase/role 键不可按字面搜索缺失判死。debug 文案可移至仅开发导入资源。 直接消费者：`provider.tsx`。 |
| [zh.json](/Users/zehao/Projects/avalon/messages/zh.json) | 769 | **精简** | 中文界面、阶段、日志、错误和调试翻译。 | 与英文同步整理；cue 命名空间仍被当前界面使用，不能随着旧 cueLogic 整组删除。 直接消费者：`provider.tsx`。 |

### public

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [apple-touch-icon.png](/Users/zehao/Projects/avalon/public/apple-touch-icon.png) | 180×180；35.0 KiB | **保留** | 苹果主屏幕 180 像素图标。 | index.html 的 apple-touch-icon 链接引用。 |
| [favicon.ico](/Users/zehao/Projects/avalon/public/favicon.ico) | ICO 容器；6.5 KiB | **保留** | 浏览器多尺寸站点图标。 | index.html 的 icon 链接引用；与 apple-touch-icon 面向不同入口。 |

### public/assets/game/icons

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [approve.webp](/Users/zehao/Projects/avalon/public/assets/game/icons/approve.webp) | 256×256；9.2 KiB | **保留** | 赞成票图标。 | GameArt 的 GAME_ICON_SRC 映射消费；图标跨牌组共用。 |
| [assassinate.webp](/Users/zehao/Projects/avalon/public/assets/game/icons/assassinate.webp) | 256×256；5.4 KiB | **保留** | 刺杀操作图标。 | GameArt 的 GAME_ICON_SRC 映射消费；图标跨牌组共用。 |
| [crest.webp](/Users/zehao/Projects/avalon/public/assets/game/icons/crest.webp) | 256×256；14.3 KiB | **保留** | 游戏标识及背牌图标。 | GameArt 的 GAME_ICON_SRC 映射消费；图标跨牌组共用。 |
| [lady.webp](/Users/zehao/Projects/avalon/public/assets/game/icons/lady.webp) | 256×256；13.7 KiB | **保留** | 湖中仙女图标。 | GameArt 的 GAME_ICON_SRC 映射消费；图标跨牌组共用。 |
| [leader.webp](/Users/zehao/Projects/avalon/public/assets/game/icons/leader.webp) | 256×256；13.0 KiB | **保留** | 领队图标。 | GameArt 的 GAME_ICON_SRC 映射消费；图标跨牌组共用。 |
| [mission-fail.webp](/Users/zehao/Projects/avalon/public/assets/game/icons/mission-fail.webp) | 256×256；14.4 KiB | **保留** | 任务失败图标。 | GameArt 的 GAME_ICON_SRC 映射消费；图标跨牌组共用。 |
| [mission-success.webp](/Users/zehao/Projects/avalon/public/assets/game/icons/mission-success.webp) | 256×256；19.7 KiB | **保留** | 任务成功图标。 | GameArt 的 GAME_ICON_SRC 映射消费；图标跨牌组共用。 |
| [reject.webp](/Users/zehao/Projects/avalon/public/assets/game/icons/reject.webp) | 256×256；7.5 KiB | **保留** | 反对票图标。 | GameArt 的 GAME_ICON_SRC 映射消费；图标跨牌组共用。 |

### public/assets/game/player-avatars

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [avatar-01.webp](/Users/zehao/Projects/avalon/public/assets/game/player-avatars/avatar-01.webp) | 512×512；39.3 KiB | **保留** | 独立玩家头像池中的 avatar-01。 | player-avatars.json 注册，经 playerAvatar 的稳定哈希选用；不是与角色头像重复。 |
| [avatar-02.webp](/Users/zehao/Projects/avalon/public/assets/game/player-avatars/avatar-02.webp) | 512×512；36.7 KiB | **保留** | 独立玩家头像池中的 avatar-02。 | player-avatars.json 注册，经 playerAvatar 的稳定哈希选用；不是与角色头像重复。 |
| [avatar-03.webp](/Users/zehao/Projects/avalon/public/assets/game/player-avatars/avatar-03.webp) | 512×512；29.4 KiB | **保留** | 独立玩家头像池中的 avatar-03。 | player-avatars.json 注册，经 playerAvatar 的稳定哈希选用；不是与角色头像重复。 |
| [avatar-04.webp](/Users/zehao/Projects/avalon/public/assets/game/player-avatars/avatar-04.webp) | 512×512；34.2 KiB | **保留** | 独立玩家头像池中的 avatar-04。 | player-avatars.json 注册，经 playerAvatar 的稳定哈希选用；不是与角色头像重复。 |
| [avatar-05.webp](/Users/zehao/Projects/avalon/public/assets/game/player-avatars/avatar-05.webp) | 512×512；34.2 KiB | **保留** | 独立玩家头像池中的 avatar-05。 | player-avatars.json 注册，经 playerAvatar 的稳定哈希选用；不是与角色头像重复。 |
| [avatar-06.webp](/Users/zehao/Projects/avalon/public/assets/game/player-avatars/avatar-06.webp) | 512×512；34.4 KiB | **保留** | 独立玩家头像池中的 avatar-06。 | player-avatars.json 注册，经 playerAvatar 的稳定哈希选用；不是与角色头像重复。 |
| [avatar-07.webp](/Users/zehao/Projects/avalon/public/assets/game/player-avatars/avatar-07.webp) | 512×512；32.6 KiB | **保留** | 独立玩家头像池中的 avatar-07。 | player-avatars.json 注册，经 playerAvatar 的稳定哈希选用；不是与角色头像重复。 |
| [avatar-08.webp](/Users/zehao/Projects/avalon/public/assets/game/player-avatars/avatar-08.webp) | 512×512；26.6 KiB | **保留** | 独立玩家头像池中的 avatar-08。 | player-avatars.json 注册，经 playerAvatar 的稳定哈希选用；不是与角色头像重复。 |
| [avatar-09.webp](/Users/zehao/Projects/avalon/public/assets/game/player-avatars/avatar-09.webp) | 512×512；30.4 KiB | **保留** | 独立玩家头像池中的 avatar-09。 | player-avatars.json 注册，经 playerAvatar 的稳定哈希选用；不是与角色头像重复。 |
| [avatar-10.webp](/Users/zehao/Projects/avalon/public/assets/game/player-avatars/avatar-10.webp) | 512×512；27.8 KiB | **保留** | 独立玩家头像池中的 avatar-10。 | player-avatars.json 注册，经 playerAvatar 的稳定哈希选用；不是与角色头像重复。 |

### public/assets/game/roles/classic/avatars

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [assassin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/assassin.webp) | 512×512；49.3 KiB | **保留** | classic 牌组的刺客方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-1.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/loyal-servant-1.webp) | 512×512；77.4 KiB | **保留** | classic 牌组的忠臣外观 1方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-2.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/loyal-servant-2.webp) | 512×512；61.9 KiB | **保留** | classic 牌组的忠臣外观 2方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-3.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/loyal-servant-3.webp) | 512×512；70.7 KiB | **保留** | classic 牌组的忠臣外观 3方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-4.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/loyal-servant-4.webp) | 512×512；64.3 KiB | **保留** | classic 牌组的忠臣外观 4方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-5.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/loyal-servant-5.webp) | 512×512；53.6 KiB | **保留** | classic 牌组的忠臣外观 5方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [merlin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/merlin.webp) | 512×512；57.0 KiB | **保留** | classic 牌组的梅林方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [minion-2.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/minion-2.webp) | 512×512；46.7 KiB | **保留** | classic 牌组的爪牙 2方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [minion.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/minion.webp) | 512×512；56.3 KiB | **保留** | classic 牌组的爪牙 1方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [mordred.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/mordred.webp) | 512×512；50.2 KiB | **保留** | classic 牌组的莫德雷德方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [morgana.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/morgana.webp) | 512×512；52.7 KiB | **保留** | classic 牌组的莫甘娜方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [oberon.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/oberon.webp) | 512×512；57.5 KiB | **保留** | classic 牌组的奥伯伦方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [percival.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/avatars/percival.webp) | 512×512；46.3 KiB | **保留** | classic 牌组的派西维尔方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |

### public/assets/game/roles/classic/cards

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [assassin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/assassin.webp) | 1024×1536；265.1 KiB | **保留** | classic 牌组的刺客完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-1.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/loyal-servant-1.webp) | 1024×1536；440.0 KiB | **保留** | classic 牌组的忠臣外观 1完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-2.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/loyal-servant-2.webp) | 1024×1536；337.2 KiB | **保留** | classic 牌组的忠臣外观 2完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-3.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/loyal-servant-3.webp) | 1024×1536；326.9 KiB | **保留** | classic 牌组的忠臣外观 3完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-4.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/loyal-servant-4.webp) | 1024×1536；337.9 KiB | **保留** | classic 牌组的忠臣外观 4完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-5.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/loyal-servant-5.webp) | 1024×1536；319.0 KiB | **保留** | classic 牌组的忠臣外观 5完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [merlin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/merlin.webp) | 1024×1536；278.2 KiB | **保留** | classic 牌组的梅林完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [minion-2.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/minion-2.webp) | 1024×1536；239.3 KiB | **保留** | classic 牌组的爪牙 2完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [minion.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/minion.webp) | 1024×1536；327.3 KiB | **保留** | classic 牌组的爪牙 1完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [mordred.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/mordred.webp) | 1024×1536；283.9 KiB | **保留** | classic 牌组的莫德雷德完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [morgana.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/morgana.webp) | 1024×1536；236.6 KiB | **保留** | classic 牌组的莫甘娜完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [oberon.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/oberon.webp) | 1024×1536；308.3 KiB | **保留** | classic 牌组的奥伯伦完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [percival.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/classic/cards/percival.webp) | 1024×1536；245.8 KiB | **保留** | classic 牌组的派西维尔完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |

### public/assets/game/roles/furry/avatars

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [assassin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/avatars/assassin.webp) | 512×512；51.7 KiB | **保留** | furry 牌组的刺客方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-1.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/avatars/loyal-servant-1.webp) | 512×512；76.4 KiB | **保留** | furry 牌组的忠臣外观 1方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-2.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/avatars/loyal-servant-2.webp) | 512×512；67.0 KiB | **保留** | furry 牌组的忠臣外观 2方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-3.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/avatars/loyal-servant-3.webp) | 512×512；76.3 KiB | **保留** | furry 牌组的忠臣外观 3方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-4.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/avatars/loyal-servant-4.webp) | 512×512；68.7 KiB | **保留** | furry 牌组的忠臣外观 4方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [merlin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/avatars/merlin.webp) | 512×512；63.4 KiB | **保留** | furry 牌组的梅林方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [minion.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/avatars/minion.webp) | 512×512；69.3 KiB | **保留** | furry 牌组的爪牙 1方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [mordred.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/avatars/mordred.webp) | 512×512；66.9 KiB | **保留** | furry 牌组的莫德雷德方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [morgana.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/avatars/morgana.webp) | 512×512；58.8 KiB | **保留** | furry 牌组的莫甘娜方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [oberon.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/avatars/oberon.webp) | 512×512；88.9 KiB | **保留** | furry 牌组的奥伯伦方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [percival.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/avatars/percival.webp) | 512×512；72.4 KiB | **保留** | furry 牌组的派西维尔方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |

### public/assets/game/roles/furry/cards

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [assassin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/cards/assassin.webp) | 1024×1536；261.6 KiB | **保留** | furry 牌组的刺客完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-1.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/cards/loyal-servant-1.webp) | 1024×1536；331.9 KiB | **保留** | furry 牌组的忠臣外观 1完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-2.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/cards/loyal-servant-2.webp) | 1024×1536；295.3 KiB | **保留** | furry 牌组的忠臣外观 2完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-3.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/cards/loyal-servant-3.webp) | 1024×1536；379.3 KiB | **保留** | furry 牌组的忠臣外观 3完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-4.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/cards/loyal-servant-4.webp) | 1024×1536；308.8 KiB | **保留** | furry 牌组的忠臣外观 4完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [merlin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/cards/merlin.webp) | 1024×1536；301.3 KiB | **保留** | furry 牌组的梅林完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [minion.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/cards/minion.webp) | 1024×1536；330.7 KiB | **保留** | furry 牌组的爪牙 1完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [mordred.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/cards/mordred.webp) | 1024×1536；304.7 KiB | **保留** | furry 牌组的莫德雷德完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [morgana.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/cards/morgana.webp) | 1024×1536；244.2 KiB | **保留** | furry 牌组的莫甘娜完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [oberon.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/cards/oberon.webp) | 1024×1536；398.5 KiB | **保留** | furry 牌组的奥伯伦完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [percival.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/furry/cards/percival.webp) | 1024×1536；353.7 KiB | **保留** | furry 牌组的派西维尔完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |

### public/assets/game/roles/modern/avatars

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [assassin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/avatars/assassin.webp) | 512×512；58.5 KiB | **保留** | modern 牌组的刺客方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-1.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/avatars/loyal-servant-1.webp) | 512×512；80.1 KiB | **保留** | modern 牌组的忠臣外观 1方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-2.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/avatars/loyal-servant-2.webp) | 512×512；84.2 KiB | **保留** | modern 牌组的忠臣外观 2方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-3.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/avatars/loyal-servant-3.webp) | 512×512；99.6 KiB | **保留** | modern 牌组的忠臣外观 3方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [loyal-servant-4.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/avatars/loyal-servant-4.webp) | 512×512；70.9 KiB | **保留** | modern 牌组的忠臣外观 4方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [merlin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/avatars/merlin.webp) | 512×512；97.9 KiB | **保留** | modern 牌组的梅林方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [minion.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/avatars/minion.webp) | 512×512；69.4 KiB | **保留** | modern 牌组的爪牙 1方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [mordred.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/avatars/mordred.webp) | 512×512；73.6 KiB | **保留** | modern 牌组的莫德雷德方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [morgana.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/avatars/morgana.webp) | 512×512；73.2 KiB | **保留** | modern 牌组的莫甘娜方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [oberon.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/avatars/oberon.webp) | 512×512；96.4 KiB | **保留** | modern 牌组的奥伯伦方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |
| [percival.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/avatars/percival.webp) | 512×512；75.4 KiB | **保留** | modern 牌组的派西维尔方形角色头像。 | 通过 cardDecks/roleMeta 动态寻址；GameArt.RolePortrait 在回放角色展示使用。 |

### public/assets/game/roles/modern/cards

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [assassin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/cards/assassin.webp) | 1024×1536；225.2 KiB | **保留** | modern 牌组的刺客完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-1.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/cards/loyal-servant-1.webp) | 1024×1536；339.2 KiB | **保留** | modern 牌组的忠臣外观 1完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-2.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/cards/loyal-servant-2.webp) | 1024×1536；420.4 KiB | **保留** | modern 牌组的忠臣外观 2完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-3.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/cards/loyal-servant-3.webp) | 1024×1536；367.8 KiB | **保留** | modern 牌组的忠臣外观 3完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [loyal-servant-4.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/cards/loyal-servant-4.webp) | 1024×1536；349.3 KiB | **保留** | modern 牌组的忠臣外观 4完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [merlin.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/cards/merlin.webp) | 1024×1536；383.7 KiB | **保留** | modern 牌组的梅林完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [minion.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/cards/minion.webp) | 1024×1536；262.9 KiB | **保留** | modern 牌组的爪牙 1完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [mordred.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/cards/mordred.webp) | 1024×1536；309.2 KiB | **保留** | modern 牌组的莫德雷德完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [morgana.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/cards/morgana.webp) | 1024×1536；277.9 KiB | **保留** | modern 牌组的莫甘娜完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [oberon.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/cards/oberon.webp) | 1024×1536；428.0 KiB | **保留** | modern 牌组的奥伯伦完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |
| [percival.webp](/Users/zehao/Projects/avalon/public/assets/game/roles/modern/cards/percival.webp) | 1024×1536；333.7 KiB | **保留** | modern 牌组的派西维尔完整卡画。 | 通过 cardDecks/roleMeta 动态寻址；RoleCard 的 full/compact/table 使用。 |

### scripts

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [benchmark-bots.ts](/Users/zehao/Projects/avalon/scripts/benchmark-bots.ts) | 27 | **保留** | 四种新旧策略对阵、5–10 人桌统计和延迟基准。 | 当前 package script 入口；不在生产服务包中。应纳入显式 TS 类型检查。 |
| [dev-env.mjs](/Users/zehao/Projects/avalon/scripts/dev-env.mjs) | 25 | **保留** | 覆盖生产继承配置，强制使用专用本地数据库。 | 避免开发启动误连真实数据库，不能因为短而视为冗余。 直接消费者：`dev-env.test.mjs`、`dev.mjs`。 |
| [dev-env.test.mjs](/Users/zehao/Projects/avalon/scripts/dev-env.test.mjs) | 33 | **保留** | 专用本地数据库覆盖、端口校验及不继承生产连接。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [dev.mjs](/Users/zehao/Projects/avalon/scripts/dev.mjs) | 56 | **精简** | 载入本地变量、管理开发数据库、同时启动 API/Vite。 | 继续保留隔离流程；完成 .dev.vars 到 .env.local 迁移后再移除旧加载分支，错误提示中的 pnpm 也应随政策统一。 |
| [publish-static.mjs](/Users/zehao/Projects/avalon/scripts/publish-static.mjs) | 87 | **保留** | 验证构建清单、大小和摘要，可选逐对象上传并重试。 | 显式目标且不删除远端对象；非普通构建必需，但现有静态发布功能需要。 |
| [static-assets.ts](/Users/zehao/Projects/avalon/scripts/static-assets.ts) | 115 | **优先精简** | 扫描 public、输出哈希资源、URL 映射、HTML 替换和发布清单。 | 90 张图片被再输出一次；应与 Vite public 复制统一为单一路径，不能只手动删除 dist 中副本。 直接消费者：`vite.config.ts`。 |
| [static-config.mjs](/Users/zehao/Projects/avalon/scripts/static-config.mjs) | 14 | **精简** | 验证显式 HTTPS CDN 地址及 /avalon/ 路径。 | 与 static-assets.ts 的 staticBase 重复 URL 规则；共享纯解析函数，分别保留可空构建值和必填发布值语义。 直接消费者：`publish-static.mjs`、`static-config.test.mjs`、`verify-static.mjs`。 |
| [static-config.test.mjs](/Users/zehao/Projects/avalon/scripts/static-config.test.mjs) | 55 | **保留** | CDN 目标合法性、缺失配置和上传前清单不匹配拦截。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [verify-static.mjs](/Users/zehao/Projects/avalon/scripts/verify-static.mjs) | 76 | **保留** | 请求 CDN 资源，核对摘要、MIME、CORS、缓存和 HIT。 | 它校验真实发布结果而非本地构建；未设置目标时不应执行，本次没有执行远程访问或上传。 |

### server

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [account-profile.test.ts](/Users/zehao/Projects/avalon/server/account-profile.test.ts) | 407 | **保留** | 昵称持久化/账户隔离、偏好 patch、每日领卡、登录访问与本地调试限制。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [account-profile.ts](/Users/zehao/Projects/avalon/server/account-profile.ts) | 23 | **保留** | 从认证 issuer/subject 建立账户键，封装昵称、卡片和偏好访问。 | 隔离账户边界；不能让客户端指定任意账户。 直接消费者：`account-profile.test.ts`、`app.ts`、`auth.ts` 等 5 个文件。 |
| [app.ts](/Users/zehao/Projects/avalon/server/app.ts) | 289 | **精简** | Hono 登录、账户、房间、回放和本地调试路由。 | 可拆 auth/profile/room 路由；与 index.ts 重复的健康端点需统一语义，实际 Node 入口的数据库检查必须保留。 直接消费者：`account-profile.test.ts`、`index.ts`、`socket-auth.ts`。 |
| [auth.test.ts](/Users/zehao/Projects/avalon/server/auth.test.ts) | 379 | **保留** | 安全回跳、静默/交互 OIDC、回调错误、discovery 同源校验及开发代理地址。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [auth.ts](/Users/zehao/Projects/avalon/server/auth.ts) | 1008 | **优先精简** | OIDC 登录、静默登录、PKCE、JWT 校验、用户信息及加密 cookie。 | 1008 行跨配置、协议、加密和 HTTP 上下文；按职责拆分。重复获取 discovery 和新建 JWKS resolver 可做受控缓存，不能删校验步骤。 直接消费者：`app.ts`、`auth.test.ts`、`index.ts` 等 4 个文件。 |
| [bot-assassin.test.ts](/Users/zehao/Projects/avalon/server/bot-assassin.test.ts) | 63 | **保留** | 梅林推断的反事实、历史时点、公开信息与私密日志隔离。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [bot-assassin.ts](/Users/zehao/Projects/avalon/server/bot-assassin.ts) | 70 | **保留** | 通过历史公开信息的反事实比较估计梅林。 | 与普通忠诚判断不同，bot 决策实际调用；应保留防事后信息泄露测试。 直接消费者：`bot-assassin.test.ts`、`bots.ts`。 |
| [bot-beliefs.test.ts](/Users/zehao/Projects/avalon/server/bot-beliefs.test.ts) | 140 | **保留** | 联合阵营概率、重叠任务约束、软证据限幅、旧湖验记忆和异常历史。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [bot-beliefs.ts](/Users/zehao/Projects/avalon/server/bot-beliefs.ts) | 203 | **保留** | 枚举合法阵营假设，用任务和软投票证据推导概率。 | bot 核心推理，不是可删的复杂装饰；无外部模型调用。 直接消费者：`bot-assassin.ts`、`bot-beliefs.test.ts`、`bots.ts`。 |
| [bot-policy.ts](/Users/zehao/Projects/avalon/server/bot-policy.ts) | 49 | **保留** | 破坏者优先级、比分估值、投票容忍度与近优抽样。 | 被新策略和冻结基准共用；重点是约定一致，避免把基准整体改成新实现。 直接消费者：`bot-assassin.ts`、`bots.ts`、`test-bot-baseline.ts`。 |
| [bots-simulation.test.ts](/Users/zehao/Projects/avalon/server/bots-simulation.test.ts) | 52 | **保留** | 跨人数/规则的新旧策略对局能结束、无明显自对局退化及确定性。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [bots.test.ts](/Users/zehao/Projects/avalon/server/bots.test.ts) | 254 | **保留** | 每类动作合法性、隐藏信息不可用、投票容忍度和严格红方出失败优先级。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [bots.ts](/Users/zehao/Projects/avalon/server/bots.ts) | 145 | **保留** | 投影权限边界及每类动作决策，产出私有诊断。 | Room 调度器直接使用；bots 属现有功能，删除会使机器人无法继续游戏。 直接消费者：`bots.test.ts`、`room.ts`、`test-bot-simulation.ts`。 |
| [database.integration.test.ts](/Users/zehao/Projects/avalon/server/database.integration.test.ts) | 720 | **保留** | 真实 PostgreSQL 并发、原子扣卡/奖励/回放、日志压缩/损坏、进程隔离与 SIGKILL 后 WebSocket 恢复。 | 本次 20 项全部跳过；真实事务、所有权和进程故障恢复不能用内存替身替代。 |
| [database.ts](/Users/zehao/Projects/avalon/server/database.ts) | 354 | **精简** | PostgreSQL 建表/迁移、所有权、事务持久化、账户与回放。 | 职责较多；可把 DDL、账户查询拆开，但 saveRoom 的房间/扣卡/归档原子事务不能拆散。 直接消费者：`database.integration.test.ts`、`index.ts`。 |
| [env.ts](/Users/zehao/Projects/avalon/server/env.ts) | 33 | **保留并命名整理** | 注入服务、认证变量、socket 附着数据和接口。 | 接口有助于测试；serializeAttachment 风格是旧运行时沿用的命名，不代表当前仍需 Durable Object。 直接消费者：`account-profile.test.ts`、`account-profile.ts`、`app.ts` 等 9 个文件。 |
| [ids.ts](/Users/zehao/Projects/avalon/server/ids.ts) | 13 | **保留** | 生成四位房间码、玩家 ID 和座位令牌。 | 仍被创建、入座和兼容重连使用；房间码空间与持久保留的矛盾需另设留存政策。 直接消费者：`app.ts`、`room.ts`。 |
| [index.ts](/Users/zehao/Projects/avalon/server/index.ts) | 185 | **保留** | Node HTTP/WebSocket 入口、认证升级、限流、心跳、回收和关机。 | 真实生产入口；不能以 app.ts 也有路由为由删掉。 |
| [persistence.ts](/Users/zehao/Projects/avalon/server/persistence.ts) | 73 | **保留** | 持久文档和存储接口、冲突错误。 | 连接真实 PostgreSQL 与内存测试替身；私有 RoomDocument 不能直接当 API DTO。 直接消费者：`database.integration.test.ts`、`database.ts`、`env.ts` 等 11 个文件。 |
| [replay-builder.test.ts](/Users/zehao/Projects/avalon/server/replay-builder.test.ts) | 120 | **保留** | 旧流程回放、双爪牙外观和裁判回退后废弃分支不入最终回放。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [replay-builder.ts](/Users/zehao/Projects/avalon/server/replay-builder.ts) | 207 | **保留并整理** | 由确定性事件重建终局公开回放，处理裁判回退。 | 实际结算使用；旧 flowVersion 回放兼容必须有存量依据才能移除。 直接消费者：`replay-builder.test.ts`、`room.ts`。 |
| [reroll-cards.test.ts](/Users/zehao/Projects/avalon/server/reroll-cards.test.ts) | 34 | **保留** | UTC+8 04:00 奖励日、满额、重复领取及每五局奖励。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [reroll-cards.ts](/Users/zehao/Projects/avalon/server/reroll-cards.ts) | 25 | **保留并对齐** | 卡片钱包类型、奖励日和纯奖励规则。 | rewardDay 被生产 SQL 使用；claimDaily/completeGame 是测试内存实现的规则模型，不应误认为生产扣卡路径，需保持与 SQL 对齐。 直接消费者：`database.ts`、`persistence.ts`、`reroll-cards.test.ts` 等 4 个文件。 |
| [room-helpers.test.ts](/Users/zehao/Projects/avalon/server/room-helpers.test.ts) | 100 | **保留** | 房间配置归一、角色组合绑定、房主 token 不进入快照及头像/座位身份恢复。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [room-helpers.ts](/Users/zehao/Projects/avalon/server/room-helpers.ts) | 149 | **精简** | 座位排序、配置归一、昵称/头像检查和快照。 | 删除无调用的 nextSeat、claimableSeats；保留实际边界校验，更新 thin runtime 等过时注释。 直接消费者：`bots.test.ts`、`room-helpers.test.ts`、`room-journal.test.ts` 等 5 个文件。 |
| [room-journal.test.ts](/Users/zehao/Projects/avalon/server/room-journal.test.ts) | 77 | **保留** | 两端 canonical hash 一致、差量恢复、日志紧凑性、损坏检测和原型污染路径拒绝。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [room-journal.ts](/Users/zehao/Projects/avalon/server/room-journal.ts) | 119 | **保留** | 状态差量、标准摘要、安全应用和日志重放。 | 支撑崩溃恢复与完整性检查；不是和前端动画历史相同的重复功能。 直接消费者：`database.integration.test.ts`、`database.ts`、`persistence.ts` 等 7 个文件。 |
| [room.test.ts](/Users/zehao/Projects/avalon/server/room.test.ts) | 1683 | **保留并拆分** | 完整 Room 行为：自助座位、历史分配、推荐规则、笔记、裁判、重随、账号接管、机器人、提交后同步及 checkpoint 隔离。 | 75 项实际测试，1683 行跨多领域；按职责拆文件、共享夹具，保留断言。 |
| [room.ts](/Users/zehao/Projects/avalon/server/room.ts) | 1783 | **优先精简** | 房间命令队列、持久化、入座、裁判、机器人、投影与新旧广播。 | 1783 行控制器应按职责拆分；删除空 persistConfig，逐步收敛旧协议，但必须保持先提交再广播的统一边界。 直接消费者：`database.integration.test.ts`、`room.test.ts`、`rooms.ts`。 |
| [rooms.ts](/Users/zehao/Projects/avalon/server/rooms.ts) | 28 | **保留** | 房间实例注册、空闲回收和 drain。 | 进程内生命周期管理，不能以文件短为由直接并入数据库模块。 直接消费者：`env.ts`、`index.ts`。 |
| [seating.test.ts](/Users/zehao/Projects/avalon/server/seating.test.ts) | 87 | **保留** | 5–10 人座位重新分配、最小重复、均匀候选抽样、恒定随机源和损坏历史。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [seating.ts](/Users/zehao/Projects/avalon/server/seating.ts) | 92 | **保留** | 记录账户/玩家旧座位，并在最少重复的位置分配中随机抽样。 | 当前开局明确使用，位掩码 DP 有 10 人上界和退路，不应改回可能不终止的随机重试。 直接消费者：`persistence.ts`、`room.ts`、`seating.test.ts`。 |
| [socket-auth.ts](/Users/zehao/Projects/avalon/server/socket-auth.ts) | 20 | **保留并整理** | WebSocket 升级前复用 session 验证，返回账号与刷新 cookie。 | 当前复用完整 /api/auth/session 会连带读取偏好和领取卡片；可抽底层 session 服务减少耦合，必须保留刷新 cookie 回传。 直接消费者：`account-profile.test.ts`、`index.ts`。 |
| [static-files.test.ts](/Users/zehao/Projects/avalon/server/static-files.test.ts) | 67 | **保留** | 哈希资源长期缓存、旧路径短缓存、SPA 不误充资源及拒绝写请求。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [static-files.ts](/Users/zehao/Projects/avalon/server/static-files.ts) | 45 | **保留** | SPA 与静态文件托管，区分 immutable 哈希资源、旧资源和 HTML。 | 缺失 assets 返回 404、防止 HTML 误缓存的行为必要。 直接消费者：`index.ts`、`static-files.test.ts`。 |
| [test-auth.ts](/Users/zehao/Projects/avalon/server/test-auth.ts) | 57 | **保留** | 真实服务器集成测试用的本地 OIDC/JWKS 与测试 cookie。 | 虽不叫 .test.ts，但由数据库集成测试引用；不能按命名删除。 直接消费者：`database.integration.test.ts`。 |
| [test-bot-baseline.ts](/Users/zehao/Projects/avalon/server/test-bot-baseline.ts) | 128 | **保留** | 刻意冻结的旧机器人策略，用于交叉对局比较。 | 与新策略相似是实验设计，不是可直接合并的重复代码。 直接消费者：`test-bot-simulation.ts`。 |
| [test-bot-simulation.ts](/Users/zehao/Projects/avalon/server/test-bot-simulation.ts) | 49 | **保留** | 确定性对局驱动、对阵选择和指标收集。 | 同时服务 benchmark 与回归测试，可迁到 tests/support 命名空间但不应删除。 直接消费者：`benchmark-bots.ts`、`bots-simulation.test.ts`。 |
| [test-persistence.ts](/Users/zehao/Projects/avalon/server/test-persistence.ts) | 88 | **保留并整理** | 内存 Persistence 替身，模拟账户、重随卡、回放和角色权重。 | 用于隔离单元测试，不能替代真实事务测试；可抽出公共测试支持目录。 直接消费者：`account-profile.test.ts`、`room.test.ts`。 |

### src

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [App.tsx](/Users/zehao/Projects/avalon/src/App.tsx) | 44 | **精简** | 语言/账户 provider、受保护路由、旧语言 URL 迁移和开发画廊。 | 保留 DEV 开关；Home/Lobby/Game/Replay 当前同步引入，可按路由延迟加载降低首包。 直接消费者：`main.tsx`。 |
| [globals.css](/Users/zehao/Projects/avalon/src/globals.css) | 1738 | **优先精简** | 1738 行全局主题、游戏桌、卡片、日志、弹窗、计时和响应式样式。 | 按实际组件职责拆分并保留导入顺序；不能机械删除媒体/容器查询和 reduced-motion 规则。 直接消费者：`main.tsx`。 |
| [main.tsx](/Users/zehao/Projects/avalon/src/main.tsx) | 13 | **保留** | 创建 React 根节点、StrictMode、BrowserRouter 和全局样式。 | 浏览器唯一入口。 |
| [vite-env.d.ts](/Users/zehao/Projects/avalon/src/vite-env.d.ts) | 1 | **保留** | 引入 Vite 客户端类型。 | 虽只有一行但支持 import.meta.env 的类型。 |

### src/components

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [LocaleSwitcher.tsx](/Users/zehao/Projects/avalon/src/components/LocaleSwitcher.tsx) | 34 | **保留** | 双语选择，通过账户偏好服务保存。 | PreferencesButton 的实际子组件，语言切换不应重连房间。 直接消费者：`PreferencesButton.tsx`。 |
| [PreferencesButton.tsx](/Users/zehao/Projects/avalon/src/components/PreferencesButton.tsx) | 79 | **保留** | 共享语言/牌面设置和保存反馈。 | 首页、大厅、游戏、回放都使用；避免各页面复制。 直接消费者：`RequireAccount.tsx`、`TableFrame.tsx`、`DebugGalleryPage.tsx` 等 6 个文件。 |

### src/components/animations

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [index.tsx](/Users/zehao/Projects/avalon/src/components/animations/index.tsx) | 129 | **精简** | 当前 FlipCard 和旧动画通用组件。 | 保留 RoleReveal/AssassinationReveal 使用的 FlipCard；删除无调用的 FadeIn、PhaseTransition、Pulse，可改名 FlipCard.tsx。 直接消费者：`AssassinationReveal.tsx`、`RoleReveal.tsx`。 |

### src/components/auth

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [AccountLogin.tsx](/Users/zehao/Projects/avalon/src/components/auth/AccountLogin.tsx) | 18 | **保留** | 简洁登录按钮、加载和错误提示。 | 首页和路由保护共同使用。 直接消费者：`RequireAccount.tsx`、`HomePage.tsx`。 |
| [RequireAccount.test.tsx](/Users/zehao/Projects/avalon/src/components/auth/RequireAccount.test.tsx) | 63 | **保留** | 渲染级验证受保护页面登录门槛及首页昵称入口；不是浏览器端完整交互测试。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [RequireAccount.tsx](/Users/zehao/Projects/avalon/src/components/auth/RequireAccount.tsx) | 26 | **保留** | 未登录时阻止挂载房间/游戏/回放，并保留回跳 URL。 | 前端访问流程必需；不能替代服务端认证。 直接消费者：`App.tsx`、`RequireAccount.test.tsx`。 |

### src/components/game

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [ActionTimerBadge.tsx](/Users/zehao/Projects/avalon/src/components/game/ActionTimerBadge.tsx) | 15 | **保留** | 本人动作名称、倒计时/超时和暂停标志。 | GameView 页脚/身份查看使用；与座位计时条不同呈现。 直接消费者：`GamePage.tsx`。 |
| [ActionTimerBar.tsx](/Users/zehao/Projects/avalon/src/components/game/ActionTimerBar.tsx) | 22 | **保留** | 座位上的绿色剩余/红色超时计时条。 | GameTable 的 playerStatus 实际消费，共用 actionTime 算法合理。 直接消费者：`GamePage.tsx`。 |
| [AdminPanel.tsx](/Users/zehao/Projects/avalon/src/components/game/AdminPanel.tsx) | 491 | **优先精简** | 裁判工具清单、目标选择、确认和执行。 | 491 行，多套对话框和忙状态；拆工具定义/表单，复用原生 dialog 基础设施，保留裁判动作权限及公开日志。 直接消费者：`FunctionsPanel.tsx`。 |
| [AssassinPanel.tsx](/Users/zehao/Projects/avalon/src/components/game/AssassinPanel.tsx) | 38 | **删除** | 旧桌面中央刺杀提示及红方身份展示。 | 无运行或测试入口；GameView 已直接渲染刺杀提示和 TableCard。 |
| [AssassinationReveal.tsx](/Users/zehao/Projects/avalon/src/components/game/AssassinationReveal.tsx) | 160 | **保留** | 确认后的刺杀目标、翻牌和胜负动画。 | 来自 authoritative outcome 的队列事件，支持跳过、原生 modal 和 reduced motion。 直接消费者：`GamePage.tsx`。 |
| [FullscreenControl.tsx](/Users/zehao/Projects/avalon/src/components/game/FullscreenControl.tsx) | 75 | **保留** | 浏览器全屏能力检查、进入退出和错误提示。 | GameTools 中有实际入口，覆盖 body portal 内容。 直接消费者：`GameTools.tsx`。 |
| [FunctionsPanel.tsx](/Users/zehao/Projects/avalon/src/components/game/FunctionsPanel.tsx) | 235 | **精简** | 提前刺杀、裁判入口和离座确认。 | 统一分散的 portal/确认状态；原生 TableSheet 与 body div 弹窗并存有 top-layer 整理需求。 直接消费者：`GameTools.tsx`。 |
| [GameArt.tsx](/Users/zehao/Projects/avalon/src/components/game/GameArt.tsx) | 56 | **保留** | 8 个游戏图标映射和角色头像渲染。 | 动态资源的正式入口；不能按单张文件没有字面 import 判定图片未使用。 直接消费者：`AssassinPanel.tsx`、`AssassinationReveal.tsx`、`FunctionsPanel.tsx` 等 14 个文件。 |
| [GameTable.tsx](/Users/zehao/Projects/avalon/src/components/game/GameTable.tsx) | 217 | **精简** | 双排座位、头像、角色笔记、卡位与任务动画容器。 | 当前游戏桌核心；hostId 从唯一调用者未传入，可删除无效分支，其他选择与标注逻辑有消费者。 直接消费者：`GamePage.tsx`。 |
| [GameTools.tsx](/Users/zehao/Projects/avalon/src/components/game/GameTools.tsx) | 108 | **精简** | 底部工具栏及功能抽屉。 | 现有自制 portal 抽屉可复用 dialog 管理，减少与其他弹窗的焦点和层级差异。 直接消费者：`GamePage.tsx`。 |
| [HandArea.tsx](/Users/zehao/Projects/avalon/src/components/game/HandArea.tsx) | 137 | **保留** | 当前玩家确认组队、发言、投票和任务提交按钮。 | 替代旧阶段面板的真实操作入口；服务器确认状态决定是否可再次操作。 直接消费者：`GamePage.tsx`。 |
| [IdentityCard.tsx](/Users/zehao/Projects/avalon/src/components/game/IdentityCard.tsx) | 168 | **精简** | 随时查看自己身份、阵营知识和翻转动画。 | 唯一调用者固定 compact；删除未使用的大号触发器模式，保留身份对话框。 直接消费者：`GamePage.tsx`。 |
| [InGameSeatClaim.tsx](/Users/zehao/Projects/avalon/src/components/game/InGameSeatClaim.tsx) | 65 | **保留并校正注释** | 已登录旁观者认领现有空座并保存重连信息。 | 游戏中实际入口；注释称新占座一定重新确认身份，与服务端保留已有 roleAcks 的行为不完全一致，不能作为删除判断依据。 直接消费者：`GamePage.tsx`。 |
| [LadyOfLake.tsx](/Users/zehao/Projects/avalon/src/components/game/LadyOfLake.tsx) | 36 | **删除** | 旧湖中仙女中央提示组件。 | GameView 已内联该提示，无导入调用；不涉及删除 USE_LADY 游戏规则。 |
| [LadyResultReveal.tsx](/Users/zehao/Projects/avalon/src/components/game/LadyResultReveal.tsx) | 115 | **精简** | 私有查验结果翻牌。 | 功能仍使用；复用翻牌与原生 dialog，移除为旧 SSR 形式保留的 mounted 间接显示逻辑需验证。 直接消费者：`GamePage.tsx`。 |
| [LogPanel.tsx](/Users/zehao/Projects/avalon/src/components/game/LogPanel.tsx) | 272 | **保留并拆分** | 公开/私有/规则标签页，日志格式化与投票/任务历史。 | 将日志参数本地化提取纯函数，保留自动跟随滚动、权限投影和键盘标签导航。 直接消费者：`GamePage.tsx`。 |
| [MissionCardReveal.tsx](/Users/zehao/Projects/avalon/src/components/game/MissionCardReveal.tsx) | 156 | **精简** | 历史中匿名任务卡展示，另含旧实时翻牌模式。 | 两个实际调用者都固定 instant；保留静态历史牌面，删除无调用的定时、随机翻牌、revealed/onComplete 模式。 直接消费者：`LogPanel.tsx`、`RoundHistoryModal.tsx`。 |
| [MissionResult.tsx](/Users/zehao/Projects/avalon/src/components/game/MissionResult.tsx) | 56 | **删除** | 旧任务结果大徽章与投票摘要。 | 无入口；当前结果由 MissionTableReveal 和展示队列负责。 |
| [MissionTableReveal.tsx](/Users/zehao/Projects/avalon/src/components/game/MissionTableReveal.tsx) | 124 | **保留** | 把桌面任务背牌收集、匿名洗牌并揭示统计结果。 | 当前动画链需要；匿名牌面由汇总生成，不能用私有玩家出牌替换。 直接消费者：`GameTable.tsx`。 |
| [MissionTrack.tsx](/Users/zehao/Projects/avalon/src/components/game/MissionTrack.tsx) | 156 | **精简** | 任务进度和历史入口，含新 compact 与旧圆点/竖排模式。 | 唯一调用者固定 compact；保留 compact 实现并移除旧 vertical/默认分支及仅其使用的 motion。 直接消费者：`GamePage.tsx`。 |
| [MissionVote.tsx](/Users/zehao/Projects/avalon/src/components/game/MissionVote.tsx) | 34 | **删除** | 旧任务阶段说明。 | 无入口；GameView 和 HandArea 已提供说明与行动。 |
| [PickPile.tsx](/Users/zehao/Projects/avalon/src/components/game/PickPile.tsx) | 102 | **删除** | 旧中央选人牌堆和动画。 | 唯一导入来自同样已孤立的 AssassinPanel，整个子图可删除。 直接消费者：`AssassinPanel.tsx`。 |
| [ProposalTracker.tsx](/Users/zehao/Projects/avalon/src/components/game/ProposalTracker.tsx) | 118 | **精简** | 组队被拒次数和最后机会提示。 | 唯一调用者固定 compact；保留配置化上限，移除旧 vertical 与非 compact 模式。 直接消费者：`GamePage.tsx`。 |
| [ReplayTimeline.tsx](/Users/zehao/Projects/avalon/src/components/game/ReplayTimeline.tsx) | 148 | **保留并整理** | 逐轮回放、最终提案票、任务出牌和湖中仙女记录。 | 回放页实际使用；“每轮”数据与完整提案明细并不完全相同，不要删掉服务端保存的早期提案数据。 直接消费者：`ReplayPage.tsx`。 |
| [RoleCard.tsx](/Users/zehao/Projects/avalon/src/components/game/RoleCard.tsx) | 58 | **保留** | 三种尺寸的完整牌画与本地化文案。 | full/compact/table 三种尺寸都有真实使用，不能照其他固定模式组件一并裁掉。 直接消费者：`PreferencesButton.tsx`、`AssassinationReveal.tsx`、`IdentityCard.tsx` 等 6 个文件。 |
| [RoleKnowledge.tsx](/Users/zehao/Projects/avalon/src/components/game/RoleKnowledge.tsx) | 50 | **保留** | 按可见知识类别组织玩家名单。 | 身份揭示与私密身份对话框共用。 直接消费者：`IdentityCard.tsx`、`RoleReveal.tsx`。 |
| [RoleNotePopover.tsx](/Users/zehao/Projects/avalon/src/components/game/RoleNotePopover.tsx) | 148 | **保留** | 角色猜测选择、原生 popover 定位和可视视口避让。 | 真实笔记入口；ResizeObserver/visualViewport 不属于多余抽象。 直接消费者：`GamePage.tsx`。 |
| [RoleReveal.tsx](/Users/zehao/Projects/avalon/src/components/game/RoleReveal.tsx) | 138 | **保留并整理** | 初始身份翻牌、确认和重随卡交互。 | 实际开局门槛；可统一异步动作状态，但必须保留角色版本、防重扣和换身份后的重置。 直接消费者：`GamePage.tsx`。 |
| [RoundHistoryModal.tsx](/Users/zehao/Projects/avalon/src/components/game/RoundHistoryModal.tsx) | 126 | **精简** | 单轮所有提案与任务结果对话框。 | 功能必要；可复用原生 TableSheet，减少自定义遮罩与键盘焦点逻辑。 直接消费者：`GamePage.tsx`。 |
| [ShowKnownNotes.tsx](/Users/zehao/Projects/avalon/src/components/game/ShowKnownNotes.tsx) | 31 | **保留** | 开启/关闭私有笔记显示与保存失败提示。 | 虽然短小但在 GameView 有明确职责，无需为减少文件数强行内联。 直接消费者：`GamePage.tsx`。 |
| [TableCard.tsx](/Users/zehao/Projects/avalon/src/components/game/TableCard.tsx) | 111 | **保留** | 空槽、背牌、公开票、任务牌和角色卡的统一渲染。 | 多处实际使用，是取代 VoteTokens 等旧实现的基础。 直接消费者：`GameTable.tsx`、`MissionTableReveal.tsx`、`GamePage.tsx`。 |
| [TableFrame.tsx](/Users/zehao/Projects/avalon/src/components/game/TableFrame.tsx) | 140 | **保留并整理** | 游戏全屏框架、桌面/战报切换、进度、工具和错误。 | 结构已经分离，继续保留；邀请链接复制反馈可与 RoomHeader 共用小 hook。 直接消费者：`GamePage.tsx`。 |
| [TableSheet.tsx](/Users/zehao/Projects/avalon/src/components/game/TableSheet.tsx) | 66 | **保留并提升复用** | 原生 dialog 通用底部面板。 | 偏好和认领空座使用；适合收敛普通弹窗，但不强行吞掉特有的身份/刺杀动画。 直接消费者：`PreferencesButton.tsx`、`GamePage.tsx`。 |
| [TeamBuilder.tsx](/Users/zehao/Projects/avalon/src/components/game/TeamBuilder.tsx) | 37 | **删除** | 旧选队阶段标题和人数说明。 | 无入口，GameView 已渲染同职责内容。 |
| [VotePanel.tsx](/Users/zehao/Projects/avalon/src/components/game/VotePanel.tsx) | 49 | **删除** | 旧投票状态说明与已投人数。 | 无入口，GameView 当前进度与 HandArea 覆盖该职责。 |
| [VoteResultPanel.tsx](/Users/zehao/Projects/avalon/src/components/game/VoteResultPanel.tsx) | 87 | **精简** | 投票结果、提案队伍和每人选择明细。 | LogPanel/RoundHistoryModal 都固定 compact；保留内容和 showProposalLabel 差异，去掉未用布局分支。 直接消费者：`LogPanel.tsx`、`MissionResult.tsx`、`RoundHistoryModal.tsx`。 |
| [VoteTokens.tsx](/Users/zehao/Projects/avalon/src/components/game/VoteTokens.tsx) | 375 | **删除** | 旧 VoteRevealReel、VotePile、OutcomeBanner 全套动画。 | 375 行无外部导入；已由 TableCard、MissionTableReveal、useTablePresentation 替代。 |

### src/components/home

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [IdentityPanel.tsx](/Users/zehao/Projects/avalon/src/components/home/IdentityPanel.tsx) | 157 | **精简** | 账户资料、昵称编辑和退出。 | 仅在 authUser 非空时由 HomePage 渲染；nullable user、登录按钮/onLogin 分支可收敛，保留真实昵称保存流程。 直接消费者：`RequireAccount.test.tsx`、`HomePage.tsx`。 |

### src/components/lobby

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [ConfigPanel.tsx](/Users/zehao/Projects/avalon/src/components/lobby/ConfigPanel.tsx) | 320 | **精简** | 推荐配置、角色组合、拒绝上限、发言时间和阵容预览。 | 功能均有当前入口；角色展示顺序与 reducer 的 LINEUP_ROLE_ORDER 重复，可提取共享只读顺序。 直接消费者：`LobbyPage.tsx`。 |
| [NameEditor.tsx](/Users/zehao/Projects/avalon/src/components/lobby/NameEditor.tsx) | 71 | **删除** | 旧房间内昵称输入与保存。 | 无入口；昵称由首页账户别名维护、大厅同步 rename。不要顺带删掉仍被 LobbyPage 使用的 rename API。 |
| [PlayerList.tsx](/Users/zehao/Projects/avalon/src/components/lobby/PlayerList.tsx) | 102 | **删除** | 旧列表式玩家/旁观者展示与踢人按钮。 | 无入口；现有 SeatPicker 负责大厅玩家网格与管理。 |
| [RoomHeader.tsx](/Users/zehao/Projects/avalon/src/components/lobby/RoomHeader.tsx) | 55 | **保留并整理** | 房间号、网络延迟和复制邀请。 | 大厅使用；可共用复制反馈 hook，不应删除整个页头。 直接消费者：`LobbyPage.tsx`。 |
| [SeatPicker.tsx](/Users/zehao/Projects/avalon/src/components/lobby/SeatPicker.tsx) | 151 | **保留** | 大厅自动入座、站起、机器人与踢人网格。 | 当前自助入座入口；与游戏中 InGameSeatClaim 的“认领既有空座”不同。 直接消费者：`LobbyPage.tsx`。 |
| [SpeechDurationSetting.tsx](/Users/zehao/Projects/avalon/src/components/lobby/SpeechDurationSetting.tsx) | 25 | **保留** | 有界发言时间选择器。 | ConfigPanel 使用；同步调用引擎归一规则避免前后端漂移。 直接消费者：`ConfigPanel.tsx`。 |

### src/components/player

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [PlayerAvatar.tsx](/Users/zehao/Projects/avalon/src/components/player/PlayerAvatar.tsx) | 47 | **保留** | 优先账户头像，失败回退稳定头像池，空座画剪影。 | 游戏桌与大厅共用，有真实加载失败处理。 直接消费者：`GameTable.tsx`、`PlayerList.tsx`、`SeatPicker.tsx`。 |

### src/components/ui

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [Button.tsx](/Users/zehao/Projects/avalon/src/components/ui/Button.tsx) | 39 | **保留** | 按钮样式、禁用、焦点与 ref。 | 多处业务复用，是必要基础组件。 直接消费者：`AccountLogin.tsx`、`AdminPanel.tsx`、`FunctionsPanel.tsx` 等 14 个文件。 |
| [Card.tsx](/Users/zehao/Projects/avalon/src/components/ui/Card.tsx) | 9 | **保留** | 统一 panel 容器与默认 padding。 | 9 行也有多个消费者；文件小不是删除理由。 直接消费者：`ReplayTimeline.tsx`、`IdentityPanel.tsx`、`ConfigPanel.tsx` 等 8 个文件。 |
| [Input.tsx](/Users/zehao/Projects/avalon/src/components/ui/Input.tsx) | 21 | **保留** | 统一输入框、焦点样式和 ref。 | 房间码和昵称输入共用。 直接消费者：`IdentityPanel.tsx`、`NameEditor.tsx`、`HomePage.tsx`。 |
| [ReconnectOverlay.tsx](/Users/zehao/Projects/avalon/src/components/ui/ReconnectOverlay.tsx) | 53 | **保留** | 断线时阻止交互，10 秒后提供刷新。 | 原生 dialog 顶层遮罩与同步恢复相关；不能用普通 loading 代替阻止错误提交。 直接消费者：`GamePage.tsx`、`LobbyPage.tsx`。 |
| [Toggle.tsx](/Users/zehao/Projects/avalon/src/components/ui/Toggle.tsx) | 46 | **删除** | 旧自定义 switch 按钮。 | 无入口，当前配置与笔记用原生 checkbox。 |

### src/i18n

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [navigation.test.tsx](/Users/zehao/Projects/avalon/src/i18n/navigation.test.tsx) | 29 | **保留** | 旧语言前缀归一与链接的 query/hash 保留。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [navigation.tsx](/Users/zehao/Projects/avalon/src/i18n/navigation.tsx) | 26 | **精简** | 以 href/push/replace 兼容旧调用方式，转发 React Router。 | Link/useRouter 被多处使用；先删无调用的 usePathname，不要为去掉小包装改动所有页面。 直接消费者：`FunctionsPanel.tsx`、`navigation.test.tsx`、`DebugGalleryPage.tsx` 等 7 个文件。 |
| [provider.tsx](/Users/zehao/Projects/avalon/src/i18n/provider.tsx) | 30 | **精简** | 注入中英文消息、账户语言与时区。 | 保留 provider；debug 翻译可仅在开发模式合并，当前两套全部同步打包。 直接消费者：`App.tsx`。 |
| [routing.ts](/Users/zehao/Projects/avalon/src/i18n/routing.ts) | 18 | **保留并更新注释** | 支持语言判断和旧语言前缀去除。 | 被偏好验证和旧链接兼容使用；不是可删的 Next 路由文件。 直接消费者：`App.tsx`、`LocaleSwitcher.tsx`、`navigation.test.tsx` 等 6 个文件。 |

### src/lib

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [assets.ts](/Users/zehao/Projects/avalon/src/lib/assets.ts) | 8 | **保留** | 开发路径到生产哈希资源 URL 的桥接。 | 动态图标/牌面/头像都依赖它；修复构建重复时应继续保留统一入口。 直接消费者：`GameArt.tsx`、`playerAvatar.ts`、`roleMeta.ts`。 |
| [preferences.ts](/Users/zehao/Projects/avalon/src/lib/preferences.ts) | 26 | **保留** | 牌面类型、默认值和账户偏好 patch 校验。 | 前后端共同验证，不能仅保留 UI 下拉列表。 直接消费者：`account-profile.ts`、`app.ts`、`database.ts` 等 13 个文件。 |

### src/lib/auth

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [types.ts](/Users/zehao/Projects/avalon/src/lib/auth/types.ts) | 15 | **保留** | 账户 DTO、昵称回退规则。 | 前后端共享的轻量接口，不应从服务端 auth.ts 反向导入大实现。 直接消费者：`app.ts`、`auth.ts`、`auth.ts` 等 11 个文件。 |
| [useAuthIdentity.ts](/Users/zehao/Projects/avalon/src/lib/auth/useAuthIdentity.ts) | 188 | **精简** | 共享登录会话、静默 iframe、刷新、退出与别名生命周期。 | 188 行不是整文件可删；可拆纯请求和静默流程，保留异步版本防串号。集中去重多处主动 refresh 请求。 直接消费者：`App.tsx`、`PreferencesButton.tsx`、`RequireAccount.test.tsx` 等 11 个文件。 |

### src/lib/debug

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [scenarios.test.ts](/Users/zehao/Projects/avalon/src/lib/debug/scenarios.test.ts) | 179 | **保留** | 逐人数/场景的确定性、终局正确性、私有投影、匿名任务和当前动画触发。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [scenarios.ts](/Users/zehao/Projects/avalon/src/lib/debug/scenarios.ts) | 303 | **保留** | 32 个基于真实引擎的本地调试场景。 | 开发画廊与参数化回归测试共用；未进入生产入口，不因 debug 名称删除。 直接消费者：`scenarios.test.ts`、`tablePresentation.test.ts`、`DebugGalleryPage.tsx`。 |

### src/lib/engine

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [config.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/config.test.ts) | 69 | **保留** | 人数阵营比例、各轮队伍人数、7 人以上第四轮双失败门槛和 accessor 一致性。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [config.ts](/Users/zehao/Projects/avalon/src/lib/engine/config.ts) | 81 | **保留** | 人数、任务队伍、失败门槛和规则范围。 | 规则表是业务基础；必要的表格边界测试应保留。 直接消费者：`config.test.ts`、`fsm.ts`、`index.ts` 等 9 个文件。 |
| [determinism.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/determinism.test.ts) | 64 | **保留** | 同 seed 发牌/首领/洗牌可复现、角色多重集守恒和非法人数。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [discussion.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/discussion.test.ts) | 287 | **保留** | 旧 v2/v3 流程、逐座发言、新 v5 方向/解释时间、计时与裁判跳过。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [fsm.ts](/Users/zehao/Projects/avalon/src/lib/engine/fsm.ts) | 108 | **精简** | 比分、领导者、阶段资格及任务结算辅助判断。 | 删除无调用的 loyaltyOf 与仅为它需要的 import；其余由 reducer/projection 实际调用。 直接消费者：`discussion.test.ts`、`index.ts`、`projection.ts` 等 7 个文件。 |
| [index.ts](/Users/zehao/Projects/avalon/src/lib/engine/index.ts) | 50 | **保留并整理** | 游戏引擎公共导出面。 | 大量调用依赖该入口；定期删除无人消费的转导出，前端纯展示可优先用类型或叶子模块。 直接消费者：`bot-assassin.test.ts`、`bot-assassin.ts`、`bot-beliefs.test.ts` 等 76 个文件。 |
| [lady.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/lady.test.ts) | 139 | **保留** | 湖中仙女触发轮次、只看忠诚、交接、防自验、防回验和禁用行为。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [presets.ts](/Users/zehao/Projects/avalon/src/lib/engine/presets.ts) | 55 | **保留** | 人数对应的推荐角色、阵容预览和红方名额计算。 | 大厅、房间配置、debug 共用；不是和 config 数值规则相同的冗余。 直接消费者：`index.ts`、`roleWeights.test.ts`。 |
| [projection.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/projection.test.ts) | 254 | **保留** | 身份、未结投票、任务卡、湖验、刺杀候选和日志的逐观察者隐私边界。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [projection.ts](/Users/zehao/Projects/avalon/src/lib/engine/projection.ts) | 199 | **保留** | 把完整状态投影成当前玩家/旁观者可见字段。 | 隐藏身份、未揭票、任务卡和私有日志的核心边界，不能简化为直接序列化完整 GameState。 直接消费者：`discussion.test.ts`、`index.ts`、`projection.test.ts` 等 8 个文件。 |
| [reducer.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/reducer.test.ts) | 532 | **保留** | 多数票、拒绝上限、任务胜负、提前刺杀、非法动作不可变及独立身份确认。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [reducer.ts](/Users/zehao/Projects/avalon/src/lib/engine/reducer.ts) | 873 | **精简** | 确定性的全部游戏事件、阶段、日志、回退及结算。 | 873 行可按发牌/提案发言/投票任务/裁判拆内部函数；统一 reduce 入口和随机/时钟注入必须保留。 直接消费者：`determinism.test.ts`、`discussion.test.ts`、`index.ts` 等 11 个文件。 |
| [referee.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/referee.test.ts) | 223 | **保留** | 阶段回退、历史恢复、开局重随、已开始不可重开和回放确定性。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [rerollCard.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/rerollCard.test.ts) | 49 | **保留** | 重随必换本人角色、完整角色集守恒、版本失效与私人知识更新。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [rng.ts](/Users/zehao/Projects/avalon/src/lib/engine/rng.ts) | 52 | **保留** | 字符串 seed、确定性 PRNG 与 Fisher–Yates。 | 发牌、座位、机器人与回放复现需要；不得替换成 Math.random。 直接消费者：`determinism.test.ts`、`discussion.test.ts`、`index.ts` 等 13 个文件。 |
| [roleVariants.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/roleVariants.test.ts) | 71 | **保留** | 重复身份外观唯一、跨序列化稳定，以及不通过外观泄露隐藏身份。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [roleVariants.ts](/Users/zehao/Projects/avalon/src/lib/engine/roleVariants.ts) | 22 | **保留** | 独立随机流为相同角色分配不同画面。 | 与角色权限一起投影，避免画面泄露身份顺序；classic 多样式不能视为多余图片。 直接消费者：`replay-builder.ts`、`projection.ts`、`roleVariants.test.ts`。 |
| [roleWeights.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/roleWeights.test.ts) | 78 | **保留** | 账户权重初值/步进/下限、完整合法发牌、偏置有效和坏输入退路。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [roleWeights.ts](/Users/zehao/Projects/avalon/src/lib/engine/roleWeights.ts) | 100 | **保留** | 账户角色权重、结算和合法完整发牌抽样。 | 服务端开局/结算使用，非无用推荐算法；有界 DP 与普通随机回退都应保留。 直接消费者：`database.integration.test.ts`、`database.ts`、`persistence.ts` 等 8 个文件。 |
| [roles.ts](/Users/zehao/Projects/avalon/src/lib/engine/roles.ts) | 83 | **保留** | 角色阵营及合法角色集合。 | 应成为 ROLE_TEAM_UI 的单一来源，避免前后端维护两份相同映射。 直接消费者：`fsm.ts`、`index.ts`、`presets.ts` 等 11 个文件。 |
| [testkit.ts](/Users/zehao/Projects/avalon/src/lib/engine/testkit.ts) | 122 | **精简** | 规则测试的构造器和完整发言流程工具。 | 多个测试引用；删除无调用的 unanimous/goodIds 等经引用确认的 helper，保留实际夹具。 直接消费者：`bot-assassin.test.ts`、`bot-beliefs.test.ts`、`bots.test.ts` 等 21 个文件。 |
| [timing.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/timing.test.ts) | 106 | **保留** | 暂停/继续幂等、超时冻结、同步投票、发言跳转及回退计时。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [timing.ts](/Users/zehao/Projects/avalon/src/lib/engine/timing.ts) | 59 | **保留** | 根据权威动作调和计时器，暂停恢复不推动游戏。 | Room bot 调度和前端显示共同依赖状态里的时间，不能挪成纯浏览器逻辑。 直接消费者：`reducer.ts`。 |
| [types.ts](/Users/zehao/Projects/avalon/src/lib/engine/types.ts) | 464 | **保留并整理** | 引擎事件、状态、效果、投影及回退类型。 | 前后端协议核心；可按内部状态与公开视图拆分，不能把公开视图直接复用私有状态类型。 直接消费者：`determinism.test.ts`、`discussion.test.ts`、`fsm.ts` 等 20 个文件。 |
| [visibility.test.ts](/Users/zehao/Projects/avalon/src/lib/engine/visibility.test.ts) | 78 | **保留** | 逐角色的已知玩家矩阵、莫德雷德与奥伯伦例外、自身排除。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [visibility.ts](/Users/zehao/Projects/avalon/src/lib/engine/visibility.ts) | 48 | **保留** | 梅林、派西维尔、红方等初始知识矩阵。 | projection 与发牌日志都使用，功能与投影层不同。 直接消费者：`index.ts`、`projection.ts`、`reducer.ts` 等 5 个文件。 |

### src/lib/game

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [actionAvailability.ts](/Users/zehao/Projects/avalon/src/lib/game/actionAvailability.ts) | 23 | **保留** | 由服务端视图确定是否还可投票/出任务牌。 | 防止重连后重复行动；已由 tablePresentation 测试覆盖，不需要为少一个文件内联两份。 直接消费者：`HandArea.tsx`、`tablePresentation.test.ts`、`GamePage.tsx`。 |
| [actionTimer.test.ts](/Users/zehao/Projects/avalon/src/lib/game/actionTimer.test.ts) | 35 | **保留** | 倒计时到超时边界、epoch 0 暂停以及进度条填充封顶。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [actionTimer.ts](/Users/zehao/Projects/avalon/src/lib/game/actionTimer.ts) | 14 | **保留** | 倒计时、超时与条形填充的纯计算。 | 两个计时组件共用，边界值测试有价值。 直接消费者：`ActionTimerBadge.tsx`、`ActionTimerBar.tsx`、`timing.test.ts` 等 4 个文件。 |
| [cardDecks.ts](/Users/zehao/Projects/avalon/src/lib/game/cardDecks.ts) | 30 | **保留** | 三套牌面标签及普通角色变体能力。 | 支撑 classic 第五忠臣/第二爪牙向其他牌面的回退，不能删成单套常量。 直接消费者：`PreferencesButton.tsx`、`roleMeta.ts`。 |
| [cueLogic.test.ts](/Users/zehao/Projects/avalon/src/lib/game/cueLogic.test.ts) | 77 | **删除** | 旧单一结果提示的首次同步、计数变化及任务优先；仅保护已无运行调用的旧实现。 | 随已废弃 cueLogic/useResultCue 删除；其 8 项用例不再保护现行展示队列。 |
| [cueLogic.ts](/Users/zehao/Projects/avalon/src/lib/game/cueLogic.ts) | 60 | **删除** | 旧按历史计数触发单一结果提示的算法。 | 只被孤立 useResultCue 与自己的测试消费；现由 tablePresentation 的顺序队列承担。 直接消费者：`cueLogic.test.ts`、`useResultCue.ts`。 |
| [displayName.test.ts](/Users/zehao/Projects/avalon/src/lib/game/displayName.test.ts) | 14 | **保留** | 空白归一与十个 Unicode 字符截断。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [displayName.ts](/Users/zehao/Projects/avalon/src/lib/game/displayName.ts) | 6 | **保留** | 统一 Unicode 昵称裁剪和空白归一。 | 账号、房间、浏览器缓存共同使用。 直接消费者：`account-profile.ts`、`app.ts`、`room-helpers.ts` 等 8 个文件。 |
| [names.ts](/Users/zehao/Projects/avalon/src/lib/game/names.ts) | 10 | **保留** | 服务端空座默认名称。 | room 与 debug 之外的正式座位逻辑需要稳定回退；可合入 displayName，但收益小，不优先。 直接消费者：`room-helpers.ts`、`room.ts`。 |
| [outcomeText.ts](/Users/zehao/Projects/avalon/src/lib/game/outcomeText.ts) | 17 | **保留** | 胜负原因到翻译键的映射。 | 游戏结局与回放共用，避免不同页面解释不一致。 直接消费者：`GamePage.tsx`、`ReplayPage.tsx`。 |
| [player-avatars.json](/Users/zehao/Projects/avalon/src/lib/game/player-avatars.json) | 12 | **保留** | 10 个可供稳定哈希选择的头像 ID。 | 运行时注册表；与 docs/art 的提示来源文件用途不同。 直接消费者：`playerAvatar.ts`。 |
| [playerAvatar.test.ts](/Users/zehao/Projects/avalon/src/lib/game/playerAvatar.test.ts) | 39 | **保留** | 头像文件存在、ID 稳定映射、分布及新增头像不整体重排。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [playerAvatar.ts](/Users/zehao/Projects/avalon/src/lib/game/playerAvatar.ts) | 25 | **保留** | 稳定 rendezvous 选择头像并应用生产资源 URL。 | 增加头像时减少既有用户变化，测试明确覆盖。 直接消费者：`PlayerAvatar.tsx`、`playerAvatar.test.ts`。 |
| [playerLabel.ts](/Users/zehao/Projects/avalon/src/lib/game/playerLabel.ts) | 14 | **保留** | 座位编号加显示名，以及按 ID 查询。 | 多个界面共用，避免编号规则散落。 直接消费者：`AdminPanel.tsx`、`AssassinationReveal.tsx`、`LadyOfLake.tsx` 等 12 个文件。 |
| [replayTypes.ts](/Users/zehao/Projects/avalon/src/lib/game/replayTypes.ts) | 64 | **保留** | 终局回放 DTO。 | 服务端构造与前端消费的明确契约；含个人任务牌，不可与实时视图混用。 直接消费者：`database.ts`、`persistence.ts`、`replay-builder.ts` 等 6 个文件。 |
| [roleMeta.test.ts](/Users/zehao/Projects/avalon/src/lib/game/roleMeta.test.ts) | 57 | **保留** | 三套卡面/头像完整、classic 全部变体和现代/furry 缺少变体的取模回退。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [roleMeta.ts](/Users/zehao/Projects/avalon/src/lib/game/roleMeta.ts) | 48 | **精简** | 角色素材 slug、变体路径、阵营展示和颜色。 | 保留动态资源解析；ROLE_TEAM_UI 与 engine/roles.ts 相同，应转导出或共用叶子常量。 直接消费者：`AssassinPanel.tsx`、`GameArt.tsx`、`RoleCard.tsx` 等 8 个文件。 |
| [roleNotes.test.ts](/Users/zehao/Projects/avalon/src/lib/game/roleNotes.test.ts) | 223 | **保留** | 各身份可标注范围、自动事实、手工猜测、显示开关及按游戏/角色版本隔离缓存。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [roleNotes.ts](/Users/zehao/Projects/avalon/src/lib/game/roleNotes.ts) | 179 | **保留** | 私有标注类型、合法候选、自动知识及本地缓存。 | “已知事实”和“手工猜测”有不同约束，不应合并成任意字符串标签。 直接消费者：`persistence.ts`、`room.test.ts`、`room.ts` 等 11 个文件。 |
| [roleNotesSync.test.ts](/Users/zehao/Projects/avalon/src/lib/game/roleNotesSync.test.ts) | 212 | **保留** | 旧本地数据迁移、离线意图、并发编辑、版本冲突、清空和丢 ACK 重试。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [roleNotesSync.ts](/Users/zehao/Projects/avalon/src/lib/game/roleNotesSync.ts) | 186 | **保留** | 离线编辑队列、版本冲突合并和服务器同步。 | 虽然复杂但解决跨设备覆盖、丢 ACK 和离线意图保留；不是多余 Zustand store。 直接消费者：`roleNotesSync.test.ts`、`useRoleNotes.ts`。 |
| [tablePresentation.test.ts](/Users/zehao/Projects/avalon/src/lib/game/tablePresentation.test.ts) | 262 | **保留** | 结果队列顺序、投票/任务/刺杀期间日志延后、重连不重播、回退清空、动作可用性和桌面座位排列。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [tablePresentation.ts](/Users/zehao/Projects/avalon/src/lib/game/tablePresentation.ts) | 163 | **保留** | 结果展示队列、时间线切换、匿名卡组和桌面排序。 | 当前投票/任务/刺杀动画的真正状态机，应保留并删旧 cue 实现。 直接消费者：`AssassinationReveal.tsx`、`GameTable.tsx`、`MissionTableReveal.tsx` 等 6 个文件。 |
| [useGameClock.ts](/Users/zehao/Projects/avalon/src/lib/game/useGameClock.ts) | 19 | **保留** | 以服务器采样时间和 performance.now 更新显示时钟。 | 避免客户端系统时钟漂移，事件清理和单调推进有必要。 直接消费者：`GamePage.tsx`。 |
| [useResultCue.ts](/Users/zehao/Projects/avalon/src/lib/game/useResultCue.ts) | 38 | **删除** | 旧结果提示 hook。 | 没有任何调用者，已由 useTablePresentation 取代。 |
| [useRoleNotes.ts](/Users/zehao/Projects/avalon/src/lib/game/useRoleNotes.ts) | 98 | **保留** | React 绑定、localStorage、去抖与定时同步笔记。 | 与纯同步控制器分离合理。 直接消费者：`GamePage.tsx`。 |
| [useRoleText.ts](/Users/zehao/Projects/avalon/src/lib/game/useRoleText.ts) | 20 | **保留** | 本地化角色名、短名、说明和阵营文案。 | 多组件共同消费，动态翻译键清理必须考虑此入口。 直接消费者：`GameTable.tsx`、`LogPanel.tsx`、`PickPile.tsx` 等 10 个文件。 |
| [useRoomAction.ts](/Users/zehao/Projects/avalon/src/lib/game/useRoomAction.ts) | 44 | **保留并复用** | 阶段变化时失效旧请求，统一 busy/error 与防重复提交。 | GameView 使用；适合让其他行动表单逐步复用，需保留各自身份/裁判语义。 直接消费者：`GamePage.tsx`。 |
| [useTablePresentation.ts](/Users/zehao/Projects/avalon/src/lib/game/useTablePresentation.ts) | 30 | **保留** | 把纯展示 reducer 接入 React，并定时结束投票展示。 | 当前 GameView 使用；与纯状态转换分开便于测试。 直接消费者：`GamePage.tsx`。 |

### src/lib/socket

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [protocol.ts](/Users/zehao/Projects/avalon/src/lib/socket/protocol.ts) | 42 | **精简** | req/ack/push 消息信封与事件类型。 | 保留共享契约；ClientMessage 仅别名且无消费，可去掉。Socket.IO 迁移背景可从文件头缩短。 直接消费者：`room.ts`、`socket.ts`。 |
| [roomConfig.ts](/Users/zehao/Projects/avalon/src/lib/socket/roomConfig.ts) | 23 | **保留** | 根据已坐人数解析推荐配置。 | UI 和服务端同时使用，统一规则是必要设计。 直接消费者：`room-helpers.ts`、`room.ts`、`ConfigPanel.tsx`。 |
| [stateIntegrity.ts](/Users/zehao/Projects/avalon/src/lib/socket/stateIntegrity.ts) | 53 | **保留** | canonical JSON、SHA-256、视图 stamp 和摘要范围。 | 被持久 journal 与浏览器校验共同使用；延迟不入 hash、权威计时入 hash 的边界应保留。 直接消费者：`database.integration.test.ts`、`room-journal.test.ts`、`room-journal.ts` 等 9 个文件。 |
| [types.ts](/Users/zehao/Projects/avalon/src/lib/socket/types.ts) | 202 | **精简** | 房间、成员、ACK 与事件参数约定，夹杂旧 Socket.IO 类型。 | 删除无消费的 RoomRuntime/SocketData/InterServerEvents；VoteValue/MissionCard 共用引擎类型。旧推送契约需先完成兼容退场。 直接消费者：`app.ts`、`database.integration.test.ts`、`persistence.ts` 等 25 个文件。 |

### src/lib/socket/client

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [heartbeat.test.ts](/Users/zehao/Projects/avalon/src/lib/socket/client/heartbeat.test.ts) | 87 | **保留** | 单请求 RTT、超时不算成功、重连世代、离开后不回写及发送异常恢复。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [heartbeat.ts](/Users/zehao/Projects/avalon/src/lib/socket/client/heartbeat.ts) | 46 | **保留** | 单请求 RTT 采样、连接世代和旧响应作废。 | 连接质量与状态完整性检查的支撑，不是 WebSocket ping 的重复实现。 直接消费者：`heartbeat.test.ts`、`useRoomConnection.ts`。 |
| [index.ts](/Users/zehao/Projects/avalon/src/lib/socket/client/index.ts) | 3 | **保留** | 聚合客户端连接和 action 导出。 | 消费者众多；几行入口文件有稳定依赖边界价值。 直接消费者：`AdminPanel.tsx`、`FunctionsPanel.tsx`、`HandArea.tsx` 等 9 个文件。 |
| [socket.test.ts](/Users/zehao/Projects/avalon/src/lib/socket/client/socket.test.ts) | 63 | **保留** | 4001 接管停止重连、普通断线重连以及旧 socket 消息无效。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [socket.ts](/Users/zehao/Projects/avalon/src/lib/socket/client/socket.ts) | 183 | **保留并整理** | WebSocket 连接、请求 ACK、超时和重连。 | 4001 设备接管与旧 socket 回调处理必要；更新 Socket.IO 迁移注释，收敛泛型包装。 直接消费者：`useAuthIdentity.ts`、`useRoleNotes.ts`、`index.ts` 等 6 个文件。 |
| [useRoomConnection.ts](/Users/zehao/Projects/avalon/src/lib/socket/client/useRoomConnection.ts) | 294 | **精简** | React 房间生命周期、同步校验、心跳及所有 action 包装。 | 294 行可拆 actions.ts 与 hook；删除未支持的 transferHost 客户端包装，其他操作需分别核对。 直接消费者：`index.ts`。 |
| [viewSync.test.ts](/Users/zehao/Projects/avalon/src/lib/socket/client/viewSync.test.ts) | 89 | **保留** | 丢推送、本地损坏、不同房间/旧 epoch、乱序、异步摘要过期和恢复去重。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [viewSync.ts](/Users/zehao/Projects/avalon/src/lib/socket/client/viewSync.ts) | 78 | **保留** | 按 epoch/revision/hash 校验全量视图与恢复。 | 检测丢终局推送、旧连接和本地状态损坏；不得为了少一个类删掉。 直接消费者：`useRoomConnection.ts`、`viewSync.test.ts`。 |

### src/lib/store

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [accountPreferences.test.ts](/Users/zehao/Projects/avalon/src/lib/store/accountPreferences.test.ts) | 87 | **保留** | 账户优先、字段 patch、失败回滚、请求竞态和切账号后的旧响应。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [accountPreferences.ts](/Users/zehao/Projects/avalon/src/lib/store/accountPreferences.ts) | 71 | **保留** | 账户偏好权威同步、乐观显示回滚和请求版本隔离。 | 解决切账号和并发保存，不与 localStorage 展示缓存重复。 直接消费者：`LocaleSwitcher.tsx`、`PreferencesButton.tsx`、`useAuthIdentity.ts` 等 4 个文件。 |
| [cardArt.ts](/Users/zehao/Projects/avalon/src/lib/store/cardArt.ts) | 25 | **保留** | 牌面偏好的本地渲染缓存与未登录持久化。 | 账户服务和 UI 都消费；仍需要非法值回退。 直接消费者：`PreferencesButton.tsx`、`GameArt.tsx`、`RoleCard.tsx` 等 8 个文件。 |
| [locale.ts](/Users/zehao/Projects/avalon/src/lib/store/locale.ts) | 33 | **保留** | 语言缓存、浏览器语言匹配和持久化。 | 账户偏好与 i18n provider 共用，不能只保留服务器字段。 直接消费者：`LocaleSwitcher.tsx`、`provider.tsx`、`accountPreferences.test.ts` 等 7 个文件。 |
| [preferences.test.ts](/Users/zehao/Projects/avalon/src/lib/store/preferences.test.ts) | 59 | **保留** | 浏览器语言默认、持久化牌面、无存储和非法值回退。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [room.test.ts](/Users/zehao/Projects/avalon/src/lib/store/room.test.ts) | 115 | **保留** | 延迟增量不替换历史、重开局/退房清理、裁判状态、重随知识和原子恢复。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [room.ts](/Users/zehao/Projects/avalon/src/lib/store/room.ts) | 141 | **精简** | 当前房间、权威游戏、身份、网络状态与原子 applyView。 | 逐步去掉仅旧推送需要的 setter/重复 reveal 缓存；测试仍在直接调用的 setter 需同步迁移测试，不可一删了之。 直接消费者：`AdminPanel.tsx`、`FunctionsPanel.tsx`、`useAuthIdentity.ts` 等 8 个文件。 |
| [session.test.ts](/Users/zehao/Projects/avalon/src/lib/store/session.test.ts) | 25 | **保留** | 删除旧匿名身份缓存同时保留房间重连令牌。 | 保护当前实际行为；测试入口由 Vitest 或 node --test 自动发现，不要求生产代码 import。 |
| [session.ts](/Users/zehao/Projects/avalon/src/lib/store/session.ts) | 62 | **条件精简** | 按房间保存座位/房主 token，并兼容旧本地身份迁移。 | 当前账户已负责归属，但旧房间重连仍读取 token；先做存量迁移再删 token 结构。 直接消费者：`FunctionsPanel.tsx`、`InGameSeatClaim.tsx`、`NameEditor.tsx` 等 7 个文件。 |

### src/lib/utils

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [cn.ts](/Users/zehao/Projects/avalon/src/lib/utils/cn.ts) | 6 | **保留** | clsx 与 Tailwind 类冲突合并。 | 大量 UI 调用；两个依赖都实际需要。 直接消费者：`LocaleSwitcher.tsx`、`PreferencesButton.tsx`、`GameArt.tsx` 等 17 个文件。 |
| [latency.ts](/Users/zehao/Projects/avalon/src/lib/utils/latency.ts) | 34 | **保留** | 延迟文本及在线状态颜色阈值。 | 大厅与游戏桌复用。 直接消费者：`GameTable.tsx`、`TableFrame.tsx`、`PlayerList.tsx` 等 5 个文件。 |

### src/pages

| 文件 | 行数或规格 | 结论 | 作用 | 必要性与处理理由 |
| --- | --- | --- | --- | --- |
| [DebugGalleryPage.tsx](/Users/zehao/Projects/avalon/src/pages/DebugGalleryPage.tsx) | 530 | **保留并拆分** | 开发场景面板、本地引擎驱动、视角切换和故障模拟。 | 530 行可拆控制栏与 session；DEV 路由和构建确认已排除生产，不能因调试代码长就删除。 直接消费者：`App.tsx`。 |
| [GamePage.tsx](/Users/zehao/Projects/avalon/src/pages/GamePage.tsx) | 702 | **优先精简** | 房间连接页面与 600 多行 GameView，组装动作、笔记、阶段板和展示。 | 拆开 live adapter、GameView、phase board 和结果编排；避免拆后把 socket 依赖重新引入纯 gallery 视图。 直接消费者：`App.tsx`、`DebugGalleryPage.tsx`。 |
| [HomePage.tsx](/Users/zehao/Projects/avalon/src/pages/HomePage.tsx) | 203 | **保留并整理** | 账号入口、建房、输入房间号和本地 debug 链接。 | 建房错误处理、认证失效和回跳需要保留；可简化传给已登录 IdentityPanel 的死分支参数。 直接消费者：`App.tsx`。 |
| [LobbyPage.tsx](/Users/zehao/Projects/avalon/src/pages/LobbyPage.tsx) | 178 | **保留并整理** | 准备房间、入座、配置、开局和游戏路由切换。 | 与 GamePage 职责不同；小型重复请求状态可复用 useRoomAction，保留跨房间旧快照保护。 直接消费者：`App.tsx`。 |
| [ReplayPage.tsx](/Users/zehao/Projects/avalon/src/pages/ReplayPage.tsx) | 168 | **精简** | 加载终局回放并展示角色、任务和刺杀。 | “durable archive transfer”注释已过时；当前归档在同一事务提交，检查是否还需要对 404/409 的固定 6 次轮询。 直接消费者：`App.tsx`。 |
| [debug-gallery.css](/Users/zehao/Projects/avalon/src/pages/debug-gallery.css) | 267 | **保留** | 开发画廊控制台和预览布局样式。 | 仅 debug 入口导入；不应并回全局生产样式。 直接消费者：`DebugGalleryPage.tsx`。 |

## 台账完整性校验

- 原始 Git 文件：326；独立判断条目：326；遗漏：0；重复：0。
- 文本文件：236，其中测试文件 46；图片文件：90，全部可解码，无完全相同 SHA-256 的源图片。
- 本地完整元数据快照：32,071 个文件/符号链接条目；其中本地非 Git 文件可读附表：516 条（不含单独存放在 JSON 中的第三方依赖和 Git 内部文件）。
- 本报告之后新增的报告文件及审查附件不纳入上述基线统计。建议实施后重新生成可达性和资源清单，避免沿用旧数字。
