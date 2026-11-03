//! Rebuild public replay data from typed, validated domain events.
mod model;
use crate::engine::{
    self, CheckpointKind, ClientLogEntry, CreateGame, Effect, GameEvent, GameOptions, GameState,
    InitialPlayer, LogChannel, Phase, PlayerId, Role,
};
use anyhow::{Context, Result, bail, ensure};
pub use model::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Clone, Default)]
struct Builder {
    rounds: BTreeMap<usize, ReplayRound>,
    lady_checks: Vec<ReplayLady>,
    assassination: Option<ReplayAssassination>,
}
impl Builder {
    fn round(&mut self, index: usize, leader: PlayerId, size: usize) -> &mut ReplayRound {
        self.rounds.entry(index).or_insert_with(|| ReplayRound {
            round_index: index,
            leader_player_id: leader,
            team_size: size,
            final_team: None,
            approved: None,
            mission_success: None,
            fail_count: None,
            votes: vec![],
            proposals: vec![],
            mission_cards: vec![],
        })
    }
    fn checkpoint(
        &mut self,
        kind: CheckpointKind,
        previous_leader: Option<&PlayerId>,
        state: &GameState,
    ) -> Result<()> {
        match kind {
            CheckpointKind::Vote => {
                if let Some(record) = state.vote_history.last() {
                    let round = self.round(
                        record.round_index,
                        record.leader_id.clone(),
                        record.team.len(),
                    );
                    round
                        .votes
                        .extend(record.votes.iter().map(|(id, vote)| ReplayVote {
                            proposal_index: record.proposal_index,
                            player_id: id.clone(),
                            value: *vote,
                        }));
                    round.proposals.push(ReplayProposal {
                        proposal_index: record.proposal_index,
                        leader_player_id: record.leader_id.clone(),
                        team: record.team.clone(),
                        approved: record.approved,
                    });
                    if record.approved {
                        round.approved = Some(true);
                        round.final_team = Some(record.team.clone());
                    }
                }
            }
            CheckpointKind::MissionResult => {
                if let Some(result) = state.mission_results.last() {
                    let leader = previous_leader.context("Mission result has no leader")?;
                    let round = self.round(result.round_index, leader.clone(), result.team_size);
                    round.approved = Some(true);
                    round.mission_success = Some(result.success);
                    round.fail_count = Some(result.fail_count);
                    round.final_team = Some(result.team.clone());
                    round.team_size = result.team_size;
                    round
                        .mission_cards
                        .extend(result.team.iter().filter_map(|id| {
                            result.cards.get(id).map(|card| ReplayCard {
                                player_id: id.clone(),
                                card: *card,
                            })
                        }));
                }
            }
            CheckpointKind::Lady => {
                if let Some(result) = &state.last_lady_result {
                    self.lady_checks.push(ReplayLady {
                        round_index: state.round_index,
                        holder_player_id: result.holder_id.clone(),
                        target_player_id: result.target_id.clone(),
                        revealed_team: result.loyalty,
                    });
                }
            }
            CheckpointKind::GameOver => {
                if let (Some(assassin), Some(target)) = (
                    &state.assassin_id,
                    state
                        .outcome
                        .as_ref()
                        .and_then(|o| o.assassin_target_id.as_ref()),
                ) {
                    self.assassination = Some(ReplayAssassination {
                        assassin_player_id: assassin.clone(),
                        target_player_id: target.clone(),
                        hit_merlin: state
                            .players
                            .iter()
                            .any(|p| &p.id == target && p.role == Role::Merlin),
                    });
                }
            }
            CheckpointKind::GameStarted => {}
        }
        Ok(())
    }
    fn finish(
        self,
        id: &str,
        state: &GameState,
        profiles: &[ReplayPlayer],
        started: Option<i64>,
        ended: Option<i64>,
    ) -> Result<ReplayData> {
        let variants = engine::role_variants(state);
        let role_assignments = state
            .players
            .iter()
            .map(|p| ReplayRole {
                player_id: p.id.clone(),
                role: p.role,
                role_variant: variants.get(&p.id).copied(),
            })
            .collect();
        let mut players: Vec<_> = state
            .players
            .iter()
            .map(|p| {
                let profile = profiles.iter().find(|v| v.id == p.id);
                ReplayPlayer {
                    id: p.id.clone(),
                    name: p.name.clone(),
                    seat: Some(p.seat),
                    avatar_url: profile
                        .and_then(|p| p.avatar_url.clone())
                        .filter(|s| !s.is_empty()),
                    is_bot: profile.and_then(|p| p.is_bot).filter(|v| *v),
                }
            })
            .collect();
        players.sort_by_key(|p| p.seat);
        let log = state
            .logs
            .iter()
            .filter(|l| l.channel == LogChannel::Public)
            .map(|l| ClientLogEntry {
                seq: l.seq,
                round_index: l.round_index,
                at: l.at,
                channel: l.channel,
                key: l.key.clone(),
                params: l.params.clone(),
                style: l.style,
            })
            .collect();
        Ok(ReplayData {
            format_version: 2,
            game_id: id.into(),
            outcome: state
                .outcome
                .clone()
                .context("Cannot archive an unfinished game")?,
            role_assignments,
            players,
            rounds: self.rounds.into_values().collect(),
            lady_checks: self.lady_checks,
            assassination: self.assassination,
            options: state.config.options.clone(),
            log,
            started_at: started,
            ended_at: ended,
        })
    }
}
/// Live room path: no JSON construction or decoding occurs during rule replay.
pub fn build(
    game_id: &str,
    seed: &str,
    options: &GameOptions,
    players: &[ReplayPlayer],
    events: &[RecordedEvent],
) -> Result<ReplayData> {
    Ok(rebuild(game_id, seed, options, players, events)?.0)
}
fn rebuild(
    game_id: &str,
    seed: &str,
    options: &GameOptions,
    players: &[ReplayPlayer],
    events: &[RecordedEvent],
) -> Result<(ReplayData, GameState)> {
    ensure!(!game_id.is_empty(), "Replay game id is missing");
    let input = CreateGame {
        host_id: players
            .first()
            .context("Replay roster is empty")?
            .id
            .clone(),
        players: players
            .iter()
            .map(|p| InitialPlayer {
                id: p.id.clone(),
                name: p.name.clone(),
            })
            .collect(),
        options: options.clone(),
        seed: seed.into(),
    };
    let mut state = engine::create_game(&input)?;
    let mut builder = Builder::default();
    let mut history = Vec::new();
    let mut started = None;
    for (index, entry) in events.iter().enumerate() {
        ensure!(
            entry.seq == index as u64 + 1,
            "Replay sequence has a gap or duplicate at {}",
            entry.seq
        );
        let event = &entry.event;
        let previous_phase = state.phase;
        let previous_leader = state
            .players
            .iter()
            .find(|p| p.seat == state.leader_index)
            .map(|p| p.id.clone());
        let result = engine::apply_owned(state, event, entry.created_at)
            .map_err(|(error, _)| anyhow::anyhow!("Replay event {}: {error}", entry.seq))?;
        if matches!(event, GameEvent::PreviousPhase { .. }) {
            builder = history.pop().context("Replay rewind without checkpoint")?;
        } else if previous_phase != Phase::Lobby && result.state.phase != previous_phase {
            history.push(builder.clone());
        }
        if matches!(event, GameEvent::StartGame { .. }) {
            started = Some(entry.created_at);
        }
        for effect in result.effects {
            let Effect::PersistCheckpoint { checkpoint } = effect;
            builder.checkpoint(checkpoint, previous_leader.as_ref(), &result.state)?;
        }
        state = result.state;
    }
    ensure!(
        state.phase == Phase::GameOver && state.outcome.is_some(),
        "Cannot archive an unfinished game"
    );
    let replay = builder.finish(
        game_id,
        &state,
        players,
        started,
        events.last().map(|e| e.created_at),
    )?;
    Ok((replay, state))
}

/// Forward-mark an already materialized public archive without rerunning any game
/// logic. Missing historical metadata remains missing, including options, log,
/// timestamps, cosmetic variants and incomplete rating identities.
pub fn migrate_archive(payload: &Value) -> Result<Value> {
    let object = payload
        .as_object()
        .context("Replay payload must be an object")?;
    match object.get("formatVersion") {
        None => {}
        Some(version) if matches!(version.as_u64(), Some(1 | 2)) => {}
        _ => bail!("Unsupported replay format version"),
    }
    ensure!(
        payload["gameId"].as_str().is_some_and(|id| !id.is_empty()),
        "Replay game id is missing"
    );
    ensure!(
        payload["outcome"].is_object()
            && matches!(payload["outcome"]["winner"].as_str(), Some("good" | "evil")),
        "Replay has no completed outcome"
    );
    let players = payload["players"]
        .as_array()
        .context("Replay players must be an array")?;
    ensure!(
        players
            .iter()
            .all(|p| p.is_object() && p["id"].as_str().is_some_and(|id| !id.is_empty())),
        "Invalid replay player"
    );
    for key in ["roleAssignments", "rounds", "ladyChecks", "log"] {
        if let Some(value) = object.get(key) {
            ensure!(value.is_array(), "Replay {key} must be an array");
        }
    }
    if let Some(assignments) = payload["roleAssignments"].as_array() {
        ensure!(
            assignments.iter().all(|a| a.is_object()
                && a["playerId"].as_str().is_some_and(|id| !id.is_empty())
                && a["role"].is_string()),
            "Invalid replay role assignment"
        );
    }
    for key in ["startedAt", "endedAt"] {
        if let Some(value) = object.get(key) {
            ensure!(value.is_null() || value.is_number(), "Invalid replay {key}");
        }
    }
    let mut migrated = payload.clone();
    migrated["formatVersion"] = json!(2);
    Ok(migrated)
}
