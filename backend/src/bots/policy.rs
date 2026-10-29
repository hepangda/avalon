use crate::engine::{
    Rng,
    typed::{
        ActionKind, ClientGameState, Direction, GameEvent, LogChannel, LogParam, MissionCard,
        Phase, PlayerId, Role, ShownAs, Team, Vote,
    },
};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, thiserror::Error)]
pub enum BotError {
    #[error("Bot player is not present in the authorized view")]
    UnknownPlayer,
    #[error("Bot requires an authorized seated-player role")]
    NotSeated,
    #[error("Bot roster must contain 5–10 distinct players")]
    InvalidRoster,
    #[error("No mission configuration for this round")]
    InvalidRound,
    #[error("No legal bot decision")]
    NoLegalDecision,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Reason {
    AcknowledgeRole,
    AnnounceTeam,
    FinishSpeaking,
    InfiltratePlausibleTeam,
    ProtectCriticalMission,
    BalanceSafetyInformationAndCover,
    LastProposal,
    SabotageOpportunityAndCover,
    ProvenDanger,
    CompareAvailableTeams,
    GoodMustSucceed,
    OberonSabotages,
    OutsideFailQuota,
    CannotReachFailThreshold,
    DecisiveSabotage,
    BuildEarlyCredibility,
    DesignatedSabotage,
    ControlNextInspection,
    ResolveUsefulUncertainty,
    KnowledgeUnexplainedByPublicHistory,
}
#[derive(Debug, Serialize)]
pub struct Decision {
    pub event: GameEvent,
    pub reason: Reason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hypotheses: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consistent: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alternatives: Option<Vec<Alternative>>,
}
impl Decision {
    fn new(event: GameEvent, reason: Reason) -> Self {
        Self {
            event,
            reason,
            hypotheses: None,
            consistent: None,
            alternatives: None,
        }
    }
    fn beliefs(mut self, model: &Beliefs) -> Self {
        self.hypotheses = Some(model.hypotheses());
        self.consistent = Some(model.consistent);
        self
    }
    fn alternatives(mut self, values: impl IntoIterator<Item = Alternative>) -> Self {
        self.alternatives = Some(values.into_iter().collect());
        self
    }
}
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum Alternative {
    Team(TeamCandidate),
    Target(TargetCandidate),
    Suspect(Suspect),
}
#[derive(Debug, Clone, Serialize)]
pub struct TeamCandidate {
    pub team: Vec<PlayerId>,
    pub score: f64,
    pub risk: f64,
}
#[derive(Debug, Clone, Serialize)]
pub struct TargetCandidate {
    pub target: PlayerId,
    pub score: f64,
}
#[derive(Debug, Clone, Serialize)]
pub struct Suspect {
    pub target: PlayerId,
    pub score: f64,
    pub probability: f64,
}
trait Scored {
    fn score(&self) -> f64;
}
impl Scored for TeamCandidate {
    fn score(&self) -> f64 {
        self.score
    }
}
impl Scored for TargetCandidate {
    fn score(&self) -> f64 {
        self.score
    }
}
impl Scored for Suspect {
    fn score(&self) -> f64 {
        self.score
    }
}
fn evil(role: Role) -> bool {
    role.is_evil()
}
fn subsets<T: Clone>(values: &[T], size: usize) -> Vec<Vec<T>> {
    if size == 0 {
        return vec![vec![]];
    }
    if size > values.len() {
        return vec![];
    }
    let mut out = vec![];
    for (i, value) in values.iter().enumerate() {
        for rest in subsets(&values[i + 1..], size - 1) {
            let mut team = Vec::with_capacity(size);
            team.push(value.clone());
            team.extend(rest);
            out.push(team);
        }
    }
    out
}
pub fn entropy(ps: &[f64]) -> f64 {
    -ps.iter()
        .map(|p| if *p > 0.0 { p * p.log2() } else { 0.0 })
        .sum::<f64>()
}
pub fn fail_distribution(
    evil: usize,
    required: usize,
    good_wins: usize,
    evil_wins: usize,
) -> Vec<f64> {
    if evil == 0 {
        return vec![1.0];
    }
    let urgent = good_wins >= 2 || evil_wins >= 2;
    let sabotage = if urgent { 0.94 } else { 0.72 };
    let mut independent = vec![1.0];
    for _ in 0..evil {
        let mut next = vec![0.0; independent.len() + 1];
        for (k, p) in independent.iter().enumerate() {
            next[k] += p * (1.0 - sabotage);
            next[k + 1] += p * sabotage;
        }
        independent = next;
    }
    let mut result: Vec<_> = independent.iter().map(|p| p * 0.45).collect();
    let hide = if urgent {
        0.025
    } else if required > evil {
        0.8
    } else {
        0.24
    };
    result[0] += 0.55 * hide;
    result[evil.min(required)] += 0.55 * (1.0 - hide);
    result
}
fn tally(view: &ClientGameState, before: Option<usize>) -> (usize, usize) {
    let mut good = 0;
    let mut bad = 0;
    for mission in &view.mission_results {
        if before.is_some_and(|r| mission.round_index >= r) {
            continue;
        }
        if mission.success { good += 1 } else { bad += 1 }
    }
    (good, bad)
}
fn race_equity(good: usize, evil: usize) -> f64 {
    if good >= 3 {
        1.0
    } else if evil >= 3 {
        0.0
    } else {
        0.55 * race_equity(good + 1, evil) + (1.0 - 0.55) * race_equity(good, evil + 1)
    }
}
fn tolerance(rejections: usize) -> f64 {
    0.1 + rejections.min(3) as f64 * 0.065
}
fn choose<T: Scored>(
    values: &[T],
    rng: &mut Rng,
    temperature: f64,
    band: f64,
) -> Result<usize, BotError> {
    let best = values
        .iter()
        .map(Scored::score)
        .fold(f64::NEG_INFINITY, f64::max);
    let choices: Vec<_> = values
        .iter()
        .enumerate()
        .filter(|(_, v)| v.score() >= best - band)
        .map(|(i, v)| (i, ((v.score() - best) / temperature.max(0.001)).exp()))
        .collect();
    let mut remaining = rng.next() * choices.iter().map(|(_, w)| w).sum::<f64>();
    for (i, w) in &choices {
        remaining -= w;
        if remaining <= 0.0 {
            return Ok(*i);
        }
    }
    choices
        .last()
        .map(|(i, _)| *i)
        .ok_or(BotError::NoLegalDecision)
}
fn log_text<'a>(
    params: &'a Option<std::collections::BTreeMap<String, LogParam>>,
    key: &str,
) -> Option<&'a str> {
    params.as_ref()?.get(key)?.as_str()
}
#[derive(Clone, Copy)]
struct World {
    mask: u16,
    weight: f64,
}
struct Mission {
    round: usize,
    mask: u16,
    fails: usize,
    success: bool,
}
/// Historical inference borrows evidence with explicit assumptions rather than
/// cloning a whole client view and deleting fields to impersonate a player.
#[derive(Clone, Copy)]
enum Context<'a> {
    Current,
    Historical {
        before: usize,
        known_evil: &'a [PlayerId],
    },
}
pub struct Beliefs {
    ids: Vec<PlayerId>,
    self_id: PlayerId,
    bits: HashMap<PlayerId, u16>,
    worlds: Vec<World>,
    pub consistent: bool,
    good: usize,
    evil: usize,
}
impl Beliefs {
    pub fn new(
        view: &ClientGameState,
        self_id: &PlayerId,
        public_only: bool,
        behavior: bool,
    ) -> Self {
        Self::build(view, self_id, public_only, behavior, Context::Current)
    }
    fn historical(
        view: &ClientGameState,
        self_id: &PlayerId,
        before: usize,
        known_evil: &[PlayerId],
    ) -> Self {
        Self::build(
            view,
            self_id,
            false,
            false,
            Context::Historical { before, known_evil },
        )
    }
    fn build(
        view: &ClientGameState,
        self_id: &PlayerId,
        public_only: bool,
        behavior: bool,
        context: Context<'_>,
    ) -> Self {
        let ids: Vec<_> = view.players.iter().map(|p| p.id.clone()).collect();
        let bits: HashMap<_, _> = ids
            .iter()
            .enumerate()
            .map(|(i, id)| (id.clone(), 1u16 << i))
            .collect();
        let mask_of = |team: &[PlayerId]| {
            team.iter()
                .fold(0, |mask, id| mask | bits.get(id).copied().unwrap_or(0))
        };
        let evil_count = view
            .config
            .roles_in_play
            .iter()
            .filter(|r| evil(**r))
            .count();
        let masks: Vec<_> = subsets(&ids, evil_count)
            .iter()
            .map(|team| mask_of(team))
            .collect();
        let mut known: HashMap<PlayerId, bool> = HashMap::new();
        let before = match context {
            Context::Current => None,
            Context::Historical { before, .. } => Some(before),
        };
        let mut pair = vec![];
        match context {
            Context::Current => {
                for p in &view.players {
                    if let Some(role) = p.role
                        && (!public_only
                            || matches!(view.phase, Phase::Assassination | Phase::GameOver))
                    {
                        known.insert(p.id.clone(), evil(role));
                    }
                }
                if !public_only {
                    if let Some(role) = view.self_role {
                        known.insert(self_id.clone(), evil(role));
                    }
                    for p in &view.known_players {
                        match p.shown_as {
                            ShownAs::Evil | ShownAs::KnownAlly => {
                                known.insert(p.player_id.clone(), true);
                            }
                            ShownAs::MerlinOrMorgana => {
                                pair.push(p.player_id.clone());
                                if !view.config.roles_in_play.contains(&Role::Morgana) {
                                    known.insert(p.player_id.clone(), false);
                                }
                            }
                        }
                    }
                    for log in &view.logs {
                        if log.channel == LogChannel::Private
                            && matches!(log.key.as_str(), "ladyResultGood" | "ladyResultEvil")
                            && let Some(target) = log_text(&log.params, "target")
                        {
                            known.insert(PlayerId::from(target), log.key == "ladyResultEvil");
                        }
                    }
                    if let Some(result) = &view.private_lady_result {
                        known.insert(result.target_id.clone(), result.loyalty == Team::Evil);
                    }
                }
            }
            Context::Historical { known_evil, .. } => {
                known.insert(self_id.clone(), false);
                for id in known_evil {
                    known.insert(id.clone(), true);
                }
            }
        }
        let pair_mask = mask_of(&pair);
        let prior: Vec<_> = masks
            .iter()
            .copied()
            .filter(|mask| {
                known
                    .iter()
                    .all(|(id, evil)| (*mask & bits.get(id).copied().unwrap_or(0) != 0) == *evil)
                    && (pair.len() != 2 || (*mask & pair_mask).count_ones() == 1)
            })
            .collect();
        let mut records: Vec<_> = view
            .mission_results
            .iter()
            .filter(|r| before.is_none_or(|b| r.round_index < b))
            .filter_map(|r| {
                let proposal = view
                    .vote_history
                    .iter()
                    .filter(|p| before.is_none_or(|b| p.round_index < b))
                    .find(|p| p.round_index == r.round_index && p.approved)?;
                Some(Mission {
                    round: r.round_index,
                    mask: mask_of(&proposal.team),
                    fails: r.fail_count,
                    success: r.success,
                })
            })
            .collect();
        records.sort_by_key(|r| r.round);
        let mut likelihood_cache = HashMap::new();
        let mut likelihood = |mask: u16, before: usize| {
            *likelihood_cache.entry((mask, before)).or_insert_with(|| {
                let mut weight = 1.0;
                let (mut good, mut evil) = (0, 0);
                for r in &records {
                    if r.round >= before {
                        break;
                    }
                    let count = (mask & r.mask).count_ones() as usize;
                    let required = view
                        .config
                        .required_fails
                        .get(r.round)
                        .copied()
                        .unwrap_or(1);
                    weight *= fail_distribution(count, required, good, evil)
                        .get(r.fails)
                        .copied()
                        .unwrap_or(0.0);
                    if r.success { good += 1 } else { evil += 1 }
                }
                weight
            })
        };
        let mut worlds: Vec<_> = prior
            .iter()
            .map(|mask| World {
                mask: *mask,
                weight: likelihood(*mask, usize::MAX),
            })
            .filter(|w| w.weight > 0.0)
            .collect();
        let consistent = !worlds.is_empty();
        if !consistent {
            worlds = if prior.is_empty() { &masks } else { &prior }
                .iter()
                .map(|mask| World {
                    mask: *mask,
                    weight: 1.0,
                })
                .collect();
        }
        if behavior && consistent {
            let mut evidence = vec![0.0; worlds.len()];
            for round in 0..=view.round_index {
                let proposals: Vec<_> = view
                    .vote_history
                    .iter()
                    .filter(|v| v.round_index == round)
                    .collect();
                if proposals.is_empty() {
                    continue;
                }
                let public_prior: Vec<_> = masks
                    .iter()
                    .map(|mask| World {
                        mask: *mask,
                        weight: likelihood(*mask, round),
                    })
                    .filter(|w| w.weight > 0.0)
                    .collect();
                let mut round_evidence = vec![0.0; worlds.len()];
                for proposal in proposals {
                    let team_mask = mask_of(&proposal.team);
                    let required =
                        view.config.required_fails.get(round).copied().unwrap_or(1) as u32;
                    let hammer =
                        proposal.proposal_index >= view.config.max_rejections.saturating_sub(1);
                    let expectations: HashMap<_, _> = proposal
                        .votes
                        .iter()
                        .map(|vote| {
                            let id = &vote.player_id;
                            let bit = bits.get(id).copied().unwrap_or(0);
                            let possible: Vec<_> =
                                public_prior.iter().filter(|w| w.mask & bit == 0).collect();
                            let total = possible.iter().map(|w| w.weight).sum::<f64>();
                            let risk = if total > 0.0 {
                                possible
                                    .iter()
                                    .filter(|w| (w.mask & team_mask).count_ones() >= required)
                                    .map(|w| w.weight)
                                    .sum::<f64>()
                                    / total
                            } else {
                                0.5
                            };
                            (
                                id.clone(),
                                if hammer {
                                    0.98
                                } else {
                                    (0.85 - risk * 0.8
                                        + if team_mask & bit != 0 { 0.12 } else { -0.08 }
                                        + proposal.proposal_index as f64 * 0.07)
                                        .clamp(0.08, 0.92)
                                },
                            )
                        })
                        .collect();
                    for (i, w) in worlds.iter().enumerate() {
                        let dangerous = (w.mask & team_mask).count_ones() >= required;
                        for vote in &proposal.votes {
                            let id = &vote.player_id;
                            if !public_only && id == self_id {
                                continue;
                            }
                            let evil = w.mask & bits.get(id).copied().unwrap_or(0) != 0;
                            let ordinary = expectations[id];
                            let approve = if evil {
                                if hammer {
                                    0.12
                                } else if dangerous {
                                    0.82
                                } else {
                                    0.38
                                }
                            } else if hammer {
                                ordinary
                            } else {
                                ordinary * 0.85 + if dangerous { 0.12 } else { 0.88 } * 0.15
                            };
                            round_evidence[i] += if vote.vote == Vote::Approve {
                                approve
                            } else {
                                1.0 - approve
                            }
                            .ln();
                        }
                    }
                }
                let best = round_evidence
                    .iter()
                    .copied()
                    .fold(f64::NEG_INFINITY, f64::max);
                for (i, value) in round_evidence.iter().enumerate() {
                    evidence[i] += ((value - best) * 0.3).max(-1.8);
                }
            }
            for (i, w) in worlds.iter_mut().enumerate() {
                w.weight *= evidence[i].exp();
            }
        }
        let total = worlds.iter().map(|w| w.weight).sum::<f64>();
        for w in &mut worlds {
            w.weight /= if total == 0.0 { 1.0 } else { total };
        }
        let (good, evil) = tally(view, before);
        Self {
            ids,
            self_id: self_id.clone(),
            bits,
            worlds,
            consistent,
            good,
            evil,
        }
    }
    fn mask(&self, team: &[PlayerId]) -> u16 {
        team.iter()
            .fold(0, |mask, id| mask | self.bits.get(id).copied().unwrap_or(0))
    }
    pub fn hypotheses(&self) -> usize {
        self.worlds.len()
    }
    pub fn distribution(&self, team: &[PlayerId]) -> Vec<f64> {
        let mask = self.mask(team);
        let mut result = vec![0.0; mask.count_ones() as usize + 1];
        for w in &self.worlds {
            result[(mask & w.mask).count_ones() as usize] += w.weight;
        }
        result
    }
    pub fn risk(&self, team: &[PlayerId], required: usize) -> f64 {
        self.distribution(team)
            .iter()
            .skip(required)
            .sum::<f64>()
            .clamp(0.0, 1.0)
    }
    pub fn teams(&self, size: usize, include_self: bool) -> Vec<Vec<PlayerId>> {
        if include_self {
            if size == 0 {
                return vec![];
            }
            let others: Vec<_> = self
                .ids
                .iter()
                .filter(|id| **id != self.self_id)
                .cloned()
                .collect();
            subsets(&others, size - 1)
                .into_iter()
                .map(|rest| {
                    let mut t = vec![self.self_id.clone()];
                    t.extend(rest);
                    t
                })
                .collect()
        } else {
            subsets(&self.ids, size)
        }
    }
    fn information(&self, team: &[PlayerId], required: usize) -> f64 {
        let counts = self.distribution(team);
        let mut result = vec![0.0; counts.len()];
        let mut conditional = 0.0;
        for (count, p) in counts.iter().enumerate() {
            let cards = fail_distribution(count, required, self.good, self.evil);
            conditional += p * entropy(&cards);
            for (fails, chance) in cards.iter().enumerate() {
                result[fails] += p * chance;
            }
        }
        (entropy(&result) - conditional).max(0.0)
    }
    fn inspection_value(&self, id: &PlayerId, size: usize, required: usize) -> f64 {
        let bit = self.bits.get(id).copied().unwrap_or(0);
        let (mut best, mut gb, mut eb) = (1.0f64, 1.0f64, 1.0f64);
        for team in self.teams(size, false) {
            let mask = self.mask(&team);
            let (mut gr, mut er) = (0.0, 0.0);
            for w in &self.worlds {
                if (mask & w.mask).count_ones() < (required as u32) {
                    continue;
                }
                if w.mask & bit != 0 {
                    er += w.weight
                } else {
                    gr += w.weight
                }
            }
            best = best.min(gr + er);
            gb = gb.min(gr);
            eb = eb.min(er);
        }
        (best - gb - eb).max(0.0)
    }
}
pub fn designated_saboteurs(
    view: &ClientGameState,
    by: &PlayerId,
    required: usize,
) -> Vec<PlayerId> {
    let mut roles: HashMap<_, _> = view
        .known_players
        .iter()
        .filter(|p| p.shown_as == ShownAs::KnownAlly)
        .filter_map(|p| p.role.map(|r| (&p.player_id, r)))
        .collect();
    if let Some(role) = view.self_role {
        roles.insert(by, role);
    }
    let priority = |id: &PlayerId| match roles.get(id) {
        Some(Role::Assassin) => 0,
        Some(Role::Minion) => 1,
        Some(Role::Morgana) => 2,
        Some(Role::Mordred) => 3,
        _ => 4,
    };
    let team = view.proposed_team.as_deref().unwrap_or_default();
    let mut players: Vec<_> = view
        .players
        .iter()
        .filter(|p| priority(&p.id) < 4 && team.contains(&p.id))
        .collect();
    players.sort_by_key(|p| (priority(&p.id), p.seat));
    players
        .iter()
        .take(required)
        .map(|p| p.id.clone())
        .collect()
}
pub fn merlin_suspicions(view: &ClientGameState) -> Vec<Suspect> {
    let candidates = view.assassin_candidates.as_deref().unwrap_or_default();
    let visible: Vec<_> = view
        .players
        .iter()
        .filter(|p| p.role.is_some_and(|r| evil(r) && r != Role::Mordred))
        .map(|p| p.id.clone())
        .collect();
    let mut suspects = vec![];
    for target in candidates {
        let mut score = 0.0;
        for round in 0..=view.round_index {
            let proposals: Vec<_> = view
                .vote_history
                .iter()
                .filter(|p| p.round_index == round)
                .collect();
            if proposals.is_empty() {
                continue;
            }
            let ordinary = Beliefs::historical(view, target, round, &[]);
            let informed = Beliefs::historical(view, target, round, &visible);
            let required = view.config.required_fails.get(round).copied().unwrap_or(1);
            let size = view.config.mission_sizes.get(round).copied().unwrap_or(0);
            let teams = ordinary.teams(size, true);
            let best_o = teams
                .iter()
                .map(|t| ordinary.risk(t, required))
                .fold(f64::INFINITY, f64::min);
            let best_i = teams
                .iter()
                .map(|t| informed.risk(t, required))
                .fold(f64::INFINITY, f64::min);
            let lady = view.logs.iter().any(|l| {
                l.channel == LogChannel::Public
                    && l.key == "ladyInspected"
                    && log_text(&l.params, "holder") == Some(target.as_ref())
                    && l.round_index < round
            });
            let mut evidence = 0.0;
            for proposal in proposals {
                let vote = proposal
                    .votes
                    .iter()
                    .find(|v| v.player_id == *target)
                    .map(|v| v.vote);
                let hammer =
                    proposal.proposal_index >= view.config.max_rejections.saturating_sub(1);
                let team = &proposal.team;
                if let Some(vote) = vote.filter(|_| !hammer) {
                    let approve = |model: &Beliefs, best: f64| {
                        let risk = model.risk(team, required);
                        if risk >= 1.0 - 1e-9 {
                            0.08
                        } else {
                            (0.55 + (best + tolerance(proposal.proposal_index) - risk) * 1.7)
                                .clamp(0.12, 0.9)
                        }
                    };
                    let ia = approve(&informed, best_i);
                    let oa = approve(&ordinary, best_o);
                    let mc = ia * 0.8 + oa * 0.2;
                    let ac = oa * if lady { 0.4 } else { 0.8 } + ia * if lady { 0.6 } else { 0.2 };
                    evidence += if vote == Vote::Approve {
                        mc / ac
                    } else {
                        (1.0 - mc) / (1.0 - ac)
                    }
                    .ln();
                }
                if proposal.leader_id == *target {
                    let likelihood = |model: &Beliefs| {
                        (-model.risk(team, required) / 0.18).exp()
                            / teams
                                .iter()
                                .map(|t| (-model.risk(t, required) / 0.18).exp())
                                .sum::<f64>()
                    };
                    let oc = likelihood(&ordinary);
                    let ic = likelihood(&informed);
                    evidence += 0.55 * ((ic * 0.8 + oc * 0.2) / (oc * 0.8 + ic * 0.2)).ln();
                }
            }
            score += evidence.clamp(-1.5, 1.5);
        }
        suspects.push(Suspect {
            target: target.clone(),
            score,
            probability: 0.0,
        });
    }
    let best = suspects
        .iter()
        .map(|p| p.score)
        .fold(f64::NEG_INFINITY, f64::max);
    let total = suspects.iter().map(|p| (p.score - best).exp()).sum::<f64>();
    for p in &mut suspects {
        p.probability = (p.score - best).exp() / total;
    }
    suspects
}

pub fn decide_typed(
    view: &ClientGameState,
    by: &PlayerId,
    action: ActionKind,
    seed: &str,
) -> Result<GameEvent, BotError> {
    Ok(decide_with_capture(view, by, action, seed, Rng::new, Capture::ActionOnly)?.event)
}
pub fn decide_detailed_typed(
    view: &ClientGameState,
    by: &PlayerId,
    action: ActionKind,
    seed: &str,
) -> Result<Decision, BotError> {
    decide_with_rng(view, by, action, seed, Rng::new)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Capture {
    ActionOnly,
    Diagnostics,
}
pub(crate) fn decide_with_rng(
    view: &ClientGameState,
    by: &PlayerId,
    action: ActionKind,
    seed: &str,
    make_rng: fn(&str) -> Rng,
) -> Result<Decision, BotError> {
    decide_with_capture(view, by, action, seed, make_rng, Capture::Diagnostics)
}
fn decide_with_capture(
    view: &ClientGameState,
    by: &PlayerId,
    action: ActionKind,
    seed: &str,
    make_rng: fn(&str) -> Rng,
    capture: Capture,
) -> Result<Decision, BotError> {
    if !(5..=10).contains(&view.players.len())
        || view
            .players
            .iter()
            .enumerate()
            .any(|(i, player)| view.players[..i].iter().any(|prior| prior.id == player.id))
    {
        return Err(BotError::InvalidRoster);
    }
    if !view.players.iter().any(|p| p.id == *by) {
        return Err(BotError::UnknownPlayer);
    }
    if view.self_role.is_none() {
        return Err(BotError::NotSeated);
    }
    let mut rng = make_rng(seed);
    let evil = view.self_role.is_some_and(evil);
    let round = view.round_index;
    let required = view.config.required_fails.get(round).copied().unwrap_or(1);
    let size = view
        .config
        .mission_sizes
        .get(round)
        .copied()
        .ok_or(BotError::InvalidRound)?;
    let (good, evil_wins) = tally(view, None);
    let urgent = good >= 2 || evil_wins >= 2;
    let mut allies: Vec<_> = view
        .known_players
        .iter()
        .filter(|p| p.shown_as == ShownAs::KnownAlly)
        .map(|p| p.player_id.clone())
        .collect();
    if evil {
        allies.push(by.clone());
    }
    let mut personality = make_rng(&format!(
        "personality:{}:{}:{}",
        view.role_revision,
        by,
        view.players
            .iter()
            .map(|p| p.id.as_ref())
            .collect::<Vec<_>>()
            .join(":")
    ));
    let patience = personality.next();
    let temperature = 0.016 + personality.next() * 0.012;
    match action {
        ActionKind::Role => Ok(Decision::new(
            GameEvent::AckRole {
                by: by.clone(),
                role_revision: Some(view.role_revision),
            },
            Reason::AcknowledgeRole,
        )),
        ActionKind::Announce => Ok(Decision::new(
            GameEvent::StartDiscussion {
                by: by.clone(),
                direction: Some(Direction::Clockwise),
            },
            Reason::AnnounceTeam,
        )),
        ActionKind::Speak => Ok(Decision::new(
            GameEvent::EndSpeech { by: by.clone() },
            Reason::FinishSpeaking,
        )),
        ActionKind::Propose | ActionKind::Finalize => {
            let model = Beliefs::new(view, by, false, true);
            let public = Beliefs::new(view, by, true, true);
            let teams = model.teams(size, !evil);
            let best_risk = teams
                .iter()
                .map(|t| model.risk(t, required))
                .fold(f64::INFINITY, f64::min);
            let leverage = race_equity(good + 1, evil_wins) - race_equity(good, evil_wins + 1);
            let scores: Vec<_> = teams
                .into_iter()
                .filter_map(|team| {
                    let risk = model.risk(&team, required);
                    let public_risk = public.risk(&team, required);
                    let info = if urgent {
                        0.0
                    } else {
                        model.information(&team, required)
                    };
                    let accomplices = team.iter().filter(|id| allies.contains(id)).count();
                    let cover = if view.self_role == Some(Role::Merlin) {
                        0.15
                    } else {
                        0.045
                    };
                    let score = if evil {
                        risk * (0.75 + leverage)
                            - public_risk * 0.48
                            - accomplices.saturating_sub(required) as f64 * 0.1
                            + if team.contains(by) { 0.025 } else { 0.0 }
                    } else {
                        -risk * (1.0 + leverage) - public_risk * cover + info * 0.035
                    };
                    (evil || risk <= best_risk + if urgent { 0.025 } else { 0.08 })
                        .then_some(TeamCandidate { team, score, risk })
                })
                .collect();
            let mut index = choose(
                &scores,
                &mut rng,
                temperature,
                if urgent { 0.025 } else { 0.055 },
            )?;
            if action == ActionKind::Finalize {
                let best = scores
                    .iter()
                    .map(|s| s.score)
                    .fold(f64::NEG_INFINITY, f64::max);
                let proposed = view.proposed_team.as_deref().unwrap_or_default();
                if let Some(i) = scores.iter().position(|s| {
                    s.team.len() == proposed.len()
                        && s.team.iter().all(|id| proposed.contains(id))
                        && s.score >= best - 0.035
                }) {
                    index = i;
                }
            }
            let event = if action == ActionKind::Propose {
                GameEvent::ProposeTeam {
                    by: by.clone(),
                    team: scores[index].team.clone(),
                    admin: None,
                }
            } else {
                GameEvent::FinalizeTeam {
                    by: by.clone(),
                    team: scores[index].team.clone(),
                    admin: None,
                }
            };
            let decision = Decision::new(
                event,
                if evil {
                    Reason::InfiltratePlausibleTeam
                } else if urgent {
                    Reason::ProtectCriticalMission
                } else {
                    Reason::BalanceSafetyInformationAndCover
                },
            )
            .beliefs(&model);
            if capture == Capture::Diagnostics {
                let mut alternatives = scores;
                alternatives.sort_by(|a, b| b.score.total_cmp(&a.score));
                alternatives.truncate(5);
                Ok(decision.alternatives(alternatives.into_iter().map(Alternative::Team)))
            } else {
                Ok(decision)
            }
        }
        ActionKind::Vote => {
            let team = view.proposed_team.as_deref().unwrap_or_default();
            if view.rejection_count >= view.config.max_rejections.saturating_sub(1) {
                return Ok(Decision::new(
                    GameEvent::CastVote {
                        by: by.clone(),
                        value: if evil { Vote::Reject } else { Vote::Approve },
                        admin: None,
                    },
                    Reason::LastProposal,
                ));
            }
            let model = Beliefs::new(view, by, false, true);
            let risk = model.risk(team, required);
            let best = model
                .teams(team.len(), true)
                .iter()
                .map(|t| model.risk(t, required))
                .fold(f64::INFINITY, f64::min);
            let tolerance = tolerance(view.rejection_count) + (patience - 0.5) * 0.025;
            let approve = if !evil {
                risk < 1.0 - 1e-9 && risk <= best + tolerance
            } else {
                let public = Beliefs::new(view, by, true, true);
                let pr = public.risk(team, required);
                let chance = if risk >= 0.95 {
                    if pr > 0.98 && !urgent { 0.6 } else { 0.96 }
                } else {
                    (0.2 + risk * 0.65 + (1.0 - pr) * 0.18 - view.rejection_count as f64 * 0.025)
                        .clamp(0.1, 0.85)
                };
                rng.next() < chance
            };
            Ok(Decision::new(
                GameEvent::CastVote {
                    by: by.clone(),
                    value: if approve { Vote::Approve } else { Vote::Reject },
                    admin: None,
                },
                if evil {
                    Reason::SabotageOpportunityAndCover
                } else if risk >= 1.0 - 1e-9 {
                    Reason::ProvenDanger
                } else {
                    Reason::CompareAvailableTeams
                },
            )
            .beliefs(&model))
        }
        ActionKind::Mission => {
            let mission = |card, reason| {
                Decision::new(
                    GameEvent::CastMissionCard {
                        by: by.clone(),
                        card,
                    },
                    reason,
                )
            };
            if !evil {
                return Ok(mission(MissionCard::Success, Reason::GoodMustSucceed));
            }
            if view.self_role == Some(Role::Oberon) {
                return Ok(mission(MissionCard::Fail, Reason::OberonSabotages));
            }
            let designated = designated_saboteurs(view, by, required);
            if !designated.contains(by) {
                return Ok(mission(MissionCard::Success, Reason::OutsideFailQuota));
            }
            let model = Beliefs::new(view, by, false, true);
            let mut team = view.proposed_team.clone().unwrap_or_default();
            if model.risk(&team, required) < 1e-9 {
                return Ok(mission(
                    MissionCard::Success,
                    Reason::CannotReachFailThreshold,
                ));
            }
            if urgent {
                return Ok(mission(MissionCard::Fail, Reason::DecisiveSabotage));
            }
            let public = Beliefs::new(view, by, true, true);
            let suspicion = designated
                .iter()
                .map(|id| public.risk(std::slice::from_ref(id), 1))
                .fold(f64::NEG_INFINITY, f64::max);
            team.sort();
            let mut shared = make_rng(&format!(
                "sabotage:{}:{}:{}:{}:{}",
                view.role_revision,
                round,
                view.rejection_count,
                team.iter()
                    .map(AsRef::as_ref)
                    .collect::<Vec<&str>>()
                    .join(":"),
                view.vote_history.len()
            ));
            let hide_chance = if round < 2 && suspicion < 0.95 {
                0.16 + (1.0 - suspicion) * 0.18
            } else {
                0.0
            };
            let hide = shared.next() < hide_chance;
            Ok(mission(
                if hide {
                    MissionCard::Success
                } else {
                    MissionCard::Fail
                },
                if hide {
                    Reason::BuildEarlyCredibility
                } else {
                    Reason::DesignatedSabotage
                },
            ))
        }
        ActionKind::Lady => {
            let model = Beliefs::new(view, by, false, true);
            let next = (round + 1).min(4);
            let size = view
                .config
                .mission_sizes
                .get(next)
                .copied()
                .ok_or(BotError::InvalidRound)?;
            let required = view.config.required_fails.get(next).copied().unwrap_or(1);
            let inspected = view
                .lady
                .as_ref()
                .map(|l| l.inspected_ids.as_slice())
                .unwrap_or_default();
            let targets: Vec<_> = view
                .players
                .iter()
                .filter(|p| p.id != *by && !inspected.contains(&p.id))
                .map(|p| {
                    let risk = model.risk(std::slice::from_ref(&p.id), 1);
                    let information = entropy(&[risk, 1.0 - risk]);
                    let improvement = model.inspection_value(&p.id, size, required);
                    TargetCandidate {
                        target: p.id.clone(),
                        score: if evil {
                            risk * 0.8 + information * 0.12
                        } else {
                            improvement + information * 0.16 - risk * 0.025
                        },
                    }
                })
                .collect();
            let index = choose(&targets, &mut rng, temperature, 0.025)?;
            let decision = Decision::new(
                GameEvent::UseLady {
                    by: by.clone(),
                    target: targets[index].target.clone(),
                },
                if evil {
                    Reason::ControlNextInspection
                } else {
                    Reason::ResolveUsefulUncertainty
                },
            )
            .beliefs(&model);
            if capture == Capture::Diagnostics {
                Ok(decision.alternatives(targets.into_iter().map(Alternative::Target)))
            } else {
                Ok(decision)
            }
        }
        ActionKind::Assassinate => {
            let suspects = merlin_suspicions(view);
            let index = choose(&suspects, &mut rng, 0.55, 1.2)?;
            let decision = Decision::new(
                GameEvent::Assassinate {
                    by: by.clone(),
                    target: suspects[index].target.clone(),
                },
                Reason::KnowledgeUnexplainedByPublicHistory,
            );
            if capture == Capture::Diagnostics {
                Ok(decision.alternatives(suspects.into_iter().map(Alternative::Suspect)))
            } else {
                Ok(decision)
            }
        }
    }
}
