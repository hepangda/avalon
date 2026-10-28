# Game flow


Lobby -> deal and individual role confirmation -> team proposal -> leader explanation -> each player speaks -> leader finalizes the team -> vote -> mission -> result, repeated up to 5 missions. If enabled, Lady of the Lake runs after missions 2-4. If the blue team wins 3 missions, assassination runs before game over. Finished games include full reveal and replay.

During assassination, every red team identity—including Oberon and Mordred—is revealed on a face-up player card in the center of the table, visible to players and spectators. Each card shows the seat number, player name, and role. Table seats keep their original presentation, and target selection is unchanged. Blue team identities remain private until game over.

Mutually known red teammates can request **Start assassination early** during
active play. The request opens a private consent ballot; the initiator approves
automatically, and all eligible teammates must agree. A rejection cancels it.
Only after unanimous approval are unfinished votes, mission cards and any pending
Lady inspection abandoned. Completed history remains intact. Without a referee
rollback, quests do not resume: hitting Merlin gives red the win; missing gives
blue the win regardless of the mission tally. Other players and spectators cannot
see or join the ballot; referees have a separate phase-control action.

The referee panel also provides **Start Merlin identification** and **Return to previous phase**. Returning restores the prior leader, proposal, round and completed results; votes or mission cards in the restored phase must be submitted again. Repeated returns walk back through the phase history without redealing identities or changing seat ownership. Already-revealed information cannot be withdrawn. Referee phase actions are recorded in the public log, survive reconnection, and are reflected in the final replay.

After a game, identities stay revealed on the table. The host can choose **Play again** to bring everyone back to preparation in the same room, while **View Replay** opens the completed game in a new tab. Room code, seat identities, reconnect tokens and configuration are preserved. The completed replay is archived before reset; the next deal gets a new game ID and fresh roles. Referees can also return from GameOver to correct the last phase; finishing again updates that game's replay.

Replays contain factual match records only: identities, outcomes, votes, mission cards, Lady inspections and assassination. Account ratings are derived separately from final teams and outcomes; see
[history and ratings](history.md). There is no MVP selection. Archives are stored in PostgreSQL without a TTL or automatic deletion; the replay URL remains valid after room reuse and server restarts; signed-out viewers must sign in again. Event revisions prevent a delayed retry from overwriting a newer referee correction.

Lobby seats are allocated automatically when an account sits down. Starting a game drops unused placeholders and randomly seats the participants while minimizing repeated positions from their previous game, preserving their IDs and reconnect tokens. Display names are normalized to at most 10 Unicode characters, for Chinese, Latin and mixed names alike, at both the identity UI and server boundary.

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

### Reroll cards

- Signed-in accounts can earn and spend cards across rooms and devices, holding
  at most one card at a time.
- The daily sign-in reward grants one card. Reward days start at 04:00 UTC+8;
  staying online across that boundary or returning to the page also claims it.
  A full wallet consumes that day's reward without storing it for later.
- Every five eligible completed games grants one card. The player must remain
  seated under the same account from dealing through settlement, and the game
  must last strictly longer than ten minutes. Exactly ten minutes does not qualify.
  Temporary disconnects preserve eligibility; spectators do not qualify. Each
  account/game counts once, including after referee rewinds and repeat settlement.
  Rewards earned with a full wallet are not banked.
- After dealing, before confirming their role and before the first team proposal,
  a player may spend one card to reroll the entire table with the same role set.
  The spender must receive a different role, and everyone confirms their role again.
- The server validates card debits, role changes and settlement rewards and commits
  them with room state. Reconnection or request retries cannot debit a card twice.

## Role variety across games

Accounts start with a weight of 100 for each role. At settlement, the final role
loses 25 points down to a minimum of 50; other roles gain 25. New deals sample
legal complete assignments using these weights while preserving the configured
role counts. Settlement is deduplicated per account and game. If optional
preference storage is unavailable, ordinary seeded dealing still works.
