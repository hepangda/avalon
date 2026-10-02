# Game flow


Lobby -> role reveal -> team building -> vote -> mission -> result, repeated up to 5 missions. If enabled, Lady of the Lake runs after missions 2-4. If the blue team wins 3 missions, assassination runs before game over. Finished games include full reveal and replay.

During assassination, every red team identity—including Oberon and Mordred—is revealed on a face-up player card in the center of the table, visible to players and spectators. Each card shows the seat number, player name, and role. Table seats keep their original presentation, and target selection is unchanged. Blue team identities remain private until game over.

The assassin can also choose **Functions → Start assassination early** during active play. After confirmation, unfinished votes, mission cards, and any pending Lady inspection are abandoned; completed history is preserved. Without a referee rollback, quests do not resume: hitting Merlin gives the red team the win, while missing gives the blue team the win, regardless of the mission tally. Other players and spectators cannot use the assassin-only action; referees have a separate phase-control action.

The referee panel also provides **Start Merlin identification** and **Return to previous phase**. Returning restores the prior leader, proposal, round and completed results; votes or mission cards in the restored phase must be submitted again. Repeated returns walk back through the phase history without redealing identities or changing seat ownership. Already-revealed information cannot be withdrawn. Referee phase actions are recorded in the public log, survive reconnection, and are reflected in the final replay.

After a game, identities stay revealed on the table. The host can choose **Play again** to bring everyone back to preparation in the same room, while **View Replay** opens the completed game in a new tab. Room code, seat identities, reconnect tokens and configuration are preserved. The completed replay is archived before reset; the next deal gets a new game ID and fresh roles. Referees can also return from GameOver to correct the last phase; finishing again updates that game's replay.

Replays contain factual match records only: identities, outcomes, votes, mission cards, Lady inspections and assassination. There is no performance scoring or MVP selection. Archives are stored in PostgreSQL without a TTL or automatic deletion; the replay URL remains usable after room reuse, logout and server restarts. Event revisions prevent a delayed retry from overwriting a newer referee correction.

Lobby seats are allocated automatically when an account sits down. Starting a game drops unused placeholders and renumbers occupied seats without changing their occupants or reconnect tokens. Display names are normalized to at most 10 Unicode characters, for Chinese, Latin and mixed names alike, at both the identity UI and server boundary.

## Full-screen table

The room preparation page shows the avatar seat grid, role configuration and
start button directly on the page. Starting a game
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

### 重随卡

- 仅登录账号可获得和使用，跨房间、跨设备保存，最多持有 2 张。
- 每日上线自动领取 1 张；UTC+8 每天 04:00 切换奖励日，跨日在线或回到页面时也会领取。满额时当日奖励视为已领取，不补发。
- 从发牌时入座到对局结算、期间未释放或更换账号的玩家，每累计完成 5 局获得 1 张；临时断线保留资格，旁观及中途加入不计入。同一账号同一局只计一次，裁判回退后再次结算不重复计数，满额奖励不储存。
- 发牌后，本人确认身份前且首个组队提案提交前，可以消耗 1 张重随卡。全桌身份按原角色配置重新随机，使用者的新角色必定与上次不同，所有玩家重新确认身份。
- 重随扣卡、身份变更，以及结算奖励均由服务端校验并与房间状态一起写入数据库；重连或请求重试不会重复扣卡。
