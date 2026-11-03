# Companion bot decisions

The Rust room runtime calls `backend/src/bots/` on its bounded CPU pool. Decisions use
only the authorized player projection: the bot cannot read the deal seed, another seat's
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

`bots::decide_detailed` exposes reasons, hypothesis counts and candidate scores for local
diagnostics. These contain private deductions and must never be added to room
broadcasts or public logs. Beliefs are reconstructed from the projection each
decision, so restart/replay needs no separate bot memory. The policy currently
uses structured game history; speaking turns end automatically, without analyzing
or generating human conversation. Its likelihoods are design assumptions, not a
model calibrated on recorded human games.

```bash
cargo test --locked --manifest-path backend/Cargo.toml --test bots
```

Human playtesting is still needed to assess how natural the decisions feel.
