# History, replays and ratings

## Viewing games

Open **History** from the home page while signed in. `/history` shows the account's
deviation score, title, team and role statistics, recent results and a paginated
list of games. Scrolling loads more games; selecting one opens `/replay/:gameId`.

Replays reuse the game table and advance through dealing, proposals and votes,
missions, Lady inspections, assassination and the outcome. Use the timeline,
playback controls or Left/Right/Home/End/Space. The current step is stored in
`?step=` for sharing. The default view is omniscient; selecting a seat shows only
that player's initial role knowledge. Anonymous mission cards and other players'
Lady results remain hidden in that viewpoint.

## Rating model

`server/ratings.ts` implements `bt-map-v1-deviation-v2`, an average-team
Bradley–Terry model:

```text
P(blue wins) = sigmoid(beta_0 + u_config + mean(theta_blue) - mean(theta_red))
```

Gaussian prior standard deviations are 1 for player skill, 0.7 for blue-team
advantage and 0.35 for configuration effects. Configurations distinguish role
sets, Lady of the Lake and rejection limits. Fitting uses Newton MAP with
backtracking line search and a Laplace covariance estimate.

Internal ratings are `1800 + 400 / ln(10) * theta`. The displayed deviation score
is `50 + 10 * (rating - 1800) / 200`, rounded to one decimal place; newcomers start
at 50.0 without a game-count bonus. The reference scale of 200 is fixed for this
model version, not an observed population standard deviation. Ratings are not
renormalized after each game. Internal thresholds of 1600, 1750, 1850 and 2000
define five titles.

A game's displayed delta compares the player's deviation score immediately before
and after that game on the global timeline. Historical prefixes are fitted on
demand and cached. Changes while a player is absent are not assigned to a game.
Internal ratings, covariance and account mappings stay on the server.

## Eligibility and attendance

Production profiles, game lists, role/team statistics and recent results exclude
all games marked as containing bots. Their replay API returns 404, while archives
remain stored. Local development (`ENVIRONMENT=development`) includes and rates
bot games.

Reroll cards, role rerolls, rewinds, vote/proposal retractions and referee actions
do not disqualify games: the final roles and outcome determine scoring. Games
with missing identities or incomplete data remain replayable but are marked with
an exclusion reason and do not affect ratings.

Attendance and seat ownership are separate. Role-preference or reward settlement
can establish participation even when an old seat cannot be recovered. Such games
appear as confirmed participation with an unresolved role and count toward total
participation, with a separate `unresolvedGames` count. They do not affect wins,
win rate, team/role statistics, recent results or ratings. With no known-role games,
win rate is unknown. Raw account lists never leave the server.

## Storage and recovery

At game end, private `avalon_game_seats` rows map seats to accounts and
`avalon_replays.altered` records intervention. The one-time `game-seats-v1`
migration in `avalon_migrations` backfills old games from matching room archives.
If exact evidence is unavailable, it links only a lone human seat with a lone
settlement account and leaves the game unrated. Automatic recovery never guesses
from nicknames. Exact backfills require matching game ID, revision and full replay.

`server/history-name-recovery.ts` supports explicitly authorized operator repairs.
It uses verified historical names (including approved aliases), complete settlement
rosters and one-to-one constraints to produce unique links. Conflicts or ambiguity
require review. Back up records, verify the replay revision and contents, and retain
before/after data and evidence before applying repairs. Confirmed historical
`Bot N` seats may be marked `isBot`; production filtering then applies without
deleting archives.

Explicitly approved old games may carry private
`avalon_replays.rating_import = 'name-recovery-v1'`. This allows records missing
rules or intervention metadata into the historical rating model without rewriting
`altered = NULL` or inventing rules. Unknown rules use a separate configuration
group. Bot games and incomplete identities remain excluded. A new replay revision
clears the approval so it cannot silently apply to a changed result.

## API

All endpoints require sign-in and return `no-store` responses:

- `GET /api/history`: the account's profile.
- `GET /api/history/games?offset=0`: 30 games per page for that account.
- `GET /api/games/:id/replay`: `{ replay, viewerId }`.

Requests check the archive revision and reuse the in-memory fitted model while
it remains unchanged.
