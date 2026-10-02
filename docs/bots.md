# Companion bot decisions


The room calls `server/bots.ts` through the existing bot scheduler. Decisions use
only `projectStateForViewer`: the bot cannot read the deal seed, another seat's
private knowledge, sealed votes, or individual mission cards. Decisions are
reproducible from the same projection and action seed; no external model service
or extra runtime dependency is required.

- **Joint inference:** enumerate at most 210 possible evil-team assignments.
  Role knowledge, Percival's pair, private Lady inspections (including earlier
  inspections retained in the viewer's log), and minimum fail counts constrain
  those assignments. A mixture of coordinated and independent sabotage weights
  mission outcomes. Successful missions increase trust without proving innocence.
  Human deviations retain nonzero likelihood. Votes are discounted, capped soft
  evidence; a seat's own votes cannot reinforce its private deductions.
- **Teams and votes:** compare legal teams using joint sabotage risk, mission-race
  stakes, expected information and public plausibility. Merlin favors publicly
  defensible safe teams; red leaders can send an accomplice without themselves.
  Stable preferences and seeded sampling vary close alternatives within a bounded
  score range. Critical missions narrow that range. Finalization retains a sound
  draft, and vote tolerance increases toward the configured rejection limit.
- **Red mission cards:** mutually visible reds follow **Assassin → Minion →
  Morgana → Mordred**, with ascending seats breaking ties between Minions. Only
  the first one or two reds on the mission are eligible to fail, matching its
  required fail count. Everybody else always submits success, even if an eligible
  teammate hides. Eligible reds may build credibility early, but sabotage when
  either side has two results and the fail threshold is reachable. A shared public
  decision seed coordinates early hiding. **Oberon always fails independently**;
  its additional card can exceed the coordinated quota.
- **Lady and assassination:** good inspections weigh the expected improvement to
  the next team; evil also values controlling who receives the token. The assassin
  compares each candidate's historical behavior under ordinary-player and Merlin
  hypotheses, using only facts available before that round. Publicly deducible
  facts are not special Merlin evidence; Mordred's invisibility, possible Percival
  knowledge and earlier Lady access reduce misleading signals.

`decideBot` exposes reasons, hypothesis counts and candidate scores for local
diagnostics. These contain private deductions and must never be added to room
broadcasts or public logs. Beliefs are reconstructed from the projection each
decision, so restart/replay needs no separate bot memory. The policy currently
uses structured game history; speaking turns end automatically, without analyzing
or generating human conversation. Its likelihoods are design assumptions, not a
model calibrated on recorded human games.

```bash
npx vitest run server/bots.test.ts server/bot-beliefs.test.ts server/bot-assassin.test.ts server/bots-simulation.test.ts
npm run benchmark:bots -- 50
```

The benchmark runs the old reasoning and new reasoning against themselves and
against each other on both sides, with identical seeded deals. Both policies use
the mandated role-based sabotage priority. Each matchup covers 5–10 players, and
larger games alternate Mordred/Oberon with Lady enabled. It reports actual game
wins (including assassination), assassination hits, proposals per mission,
rejection losses, and measured decision latency. The regression suite additionally
covers every rejection limit, mixed policies, special-role combinations, privacy,
strict fail quotas and deterministic replay. Self-play measures regressions and
differences between policies; human playtesting is still needed to assess how
natural the decisions feel.
