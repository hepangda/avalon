use super::*;
use ErrorCode as E;
use GameEvent as G;
use Phase as P;
use std::collections::HashSet;
fn error(code: ErrorCode, message: impl Into<String>) -> EngineError {
    EngineError::new(code, message)
}
fn params<const N: usize>(pairs: [(&str, LogParam); N]) -> Option<LogParams> {
    Some(pairs.into_iter().map(|(k, v)| (k.into(), v)).collect())
}
fn log(
    s: &mut GameState,
    key: &str,
    params: Option<LogParams>,
    audience: Option<&PlayerId>,
    admin: bool,
) {
    s.log_seq += 1;
    s.logs.push(LogEntry {
        seq: s.log_seq,
        round_index: s.round_index,
        at: 0,
        channel: if audience.is_some() {
            LogChannel::Private
        } else {
            LogChannel::Public
        },
        audience: audience.cloned(),
        key: key.into(),
        params,
        style: admin.then_some(LogStyle::Admin),
    });
}
fn round_log(s: &mut GameState) {
    log(
        s,
        "roundBegins",
        params([("round", (s.round_index + 1).to_string().into())]),
        None,
        false,
    );
    log(
        s,
        "proposalBegins",
        params([
            ("round", (s.round_index + 1).to_string().into()),
            ("proposal", (s.rejection_count + 1).to_string().into()),
            ("leader", s.leader_id().into()),
        ]),
        None,
        false,
    );
}
fn knowledge(s: &mut GameState) {
    for player in s.players.clone() {
        log(
            s,
            "yourRole",
            params([("role", player.role.as_str().into())]),
            Some(&player.id),
            false,
        );
        for k in known_players(&player, &s.players) {
            log(
                s,
                &format!("perceive.{}", k.shown_as),
                params([("player", k.player_id.into())]),
                Some(&player.id),
                false,
            );
        }
    }
}
fn phase(s: &GameState, p: Phase) -> Result<()> {
    if s.phase == p {
        Ok(())
    } else {
        Err(error(E::WrongPhase, format!("Not in {p}")))
    }
}
fn effect(e: &mut Vec<Effect>, checkpoint: CheckpointKind) {
    e.push(Effect::PersistCheckpoint { checkpoint });
}
fn set_assassin(s: &mut GameState) {
    s.assassin_id = s
        .players
        .iter()
        .find(|p| p.role == Role::Assassin)
        .map(|p| p.id.clone());
}
fn set_lady(s: &mut GameState) {
    if s.lady_enabled {
        let seat = (s.leader_index + s.players.len() - 1) % s.players.len();
        s.lady_holder_id = s
            .players
            .iter()
            .find(|p| p.seat == seat)
            .map(|p| p.id.clone());
    }
}
fn clear_knowledge(s: &mut GameState) {
    s.logs.retain(|l| {
        l.channel != LogChannel::Private || (l.key != "yourRole" && !l.key.starts_with("perceive."))
    });
}
fn lineup(roles: &[Role], team: Team) -> String {
    [
        Role::Merlin,
        Role::Percival,
        Role::LoyalServant,
        Role::Morgana,
        Role::Mordred,
        Role::Oberon,
        Role::Assassin,
        Role::Minion,
    ]
    .into_iter()
    .filter_map(|r| {
        let n = roles
            .iter()
            .filter(|v| **v == r && r.team() == team)
            .count();
        match n {
            0 => None,
            1 => Some(r.to_string()),
            _ => Some(format!("{r}*{n}")),
        }
    })
    .collect::<Vec<_>>()
    .join(",")
}
fn outcome(
    s: &GameState,
    winner: Team,
    reason: WinReason,
    target: Option<PlayerId>,
) -> GameOutcome {
    let good = s.mission_results.iter().filter(|m| m.success).count();
    GameOutcome {
        winner,
        reason,
        mission_tally: MissionTally {
            good,
            evil: s.mission_results.len() - good,
        },
        assassin_target_id: target,
        revealed_roles: s
            .players
            .iter()
            .map(|p| RevealedRole {
                player_id: p.id.clone(),
                role: p.role,
                team: p.role.team(),
            })
            .collect(),
    }
}
pub fn create_game(input: impl std::borrow::Borrow<CreateGame>) -> Result<GameState> {
    let input = input.borrow();
    let n = input.players.len();
    let roles = build_roles(n, &input.options)?;
    let ids: HashSet<_> = input.players.iter().map(|p| &p.id).collect();
    if ids.len() != n {
        return Err(error(E::UnknownPlayer, "Duplicate player ids"));
    }
    Ok(GameState {
        randomness_version: Some(RandomnessVersion::ResolvedV1),
        role_variants: Some(Default::default()),
        phase: P::Lobby,
        flow_version: Some(5),
        discussion: None,
        action_timers: vec![],
        config: GameConfig {
            player_count: n,
            options: input.options.clone(),
            roles,
        },
        seed: input.seed.clone(),
        players: input
            .players
            .iter()
            .enumerate()
            .map(|(seat, p)| PlayerSlot {
                id: p.id.clone(),
                name: p.name.clone(),
                seat,
                role: Role::LoyalServant,
                connected: true,
            })
            .collect(),
        round_index: 0,
        leader_index: 0,
        rejection_count: 0,
        proposed_team: None,
        team_changed: None,
        votes: Default::default(),
        mission_cards: Default::default(),
        mission_results: vec![],
        vote_history: vec![],
        logs: vec![],
        log_seq: 0,
        role_acks: vec![],
        await_role_acks: None,
        lady_enabled: input.options.lady_of_the_lake,
        lady_holder_id: None,
        lady_inspected_ids: vec![],
        pending_lady: false,
        last_lady_result: None,
        assassin_id: None,
        early_assassination: None,
        outcome: None,
        phase_history: None,
        phase_revision: None,
        opening_closed: false,
        role_revision: 0,
    })
}
// Both success and rejection return the owned state. Boxing only the error
// cannot reduce the result's size and would allocate on rejected commands.
#[allow(clippy::result_large_err)]
pub fn apply_owned(
    state: GameState,
    event: &GameEvent,
    now: i64,
) -> std::result::Result<Transition, (EngineError, GameState)> {
    apply(state, event, now, false)
}
#[cfg(feature = "legacy-import")]
#[allow(clippy::result_large_err)]
pub(crate) fn apply_legacy(
    state: GameState,
    event: &GameEvent,
    now: i64,
) -> std::result::Result<Transition, (EngineError, GameState)> {
    apply(state, event, now, true)
}
#[allow(clippy::result_large_err)]
fn apply(
    mut state: GameState,
    event: &GameEvent,
    now: i64,
    legacy: bool,
) -> std::result::Result<Transition, (EngineError, GameState)> {
    if let Err(e) = super::randomness::validate(&state, event, legacy) {
        return Err((e, state));
    }
    let referee = matches!(event, G::SkipSpeech { .. })
        || matches!(
            event,
            G::ProposeTeam {
                admin: Some(true),
                ..
            } | G::FinalizeTeam {
                admin: Some(true),
                ..
            } | G::CastVote {
                admin: Some(true),
                ..
            } | G::StartAssassination {
                admin: Some(true),
                ..
            }
        );
    let play = matches!(
        event,
        G::ProposeTeam { .. }
            | G::FinalizeTeam { .. }
            | G::StartDiscussion { .. }
            | G::EndSpeech { .. }
            | G::SkipSpeech { .. }
            | G::CastVote { .. }
            | G::CastMissionCard { .. }
            | G::UseLady { .. }
            | G::StartAssassination { .. }
            | G::RequestAssassination { .. }
            | G::VoteAssassination { .. }
            | G::Assassinate { .. }
    );
    if play && !referee && state.roles_pending() {
        return Err((
            error(
                E::RolesPending,
                "Waiting for every player to confirm their identity",
            ),
            state,
        ));
    }
    let previous = TimerContext::capture(&state);
    let old_role = state.role_revision;
    let checkpoint = (!matches!(event, G::PreviousPhase { .. })
        && state.phase != P::Lobby
        && may_change_phase(&state, event))
    .then(|| state.checkpoint());
    let mut effects = vec![];
    if let Err(e) = dispatch(&mut state, event, &mut effects) {
        return Err((e, state));
    }
    if matches!(event, G::PreviousPhase { .. } | G::RerollLeader { .. })
        || state.role_revision != old_role
        || matches!(state.phase, P::Assassination | P::GameOver)
    {
        state.early_assassination = Some(None);
    }
    if !matches!(event, G::PreviousPhase { .. })
        && previous.phase != P::Lobby
        && state.phase != previous.phase
    {
        state
            .phase_history
            .get_or_insert_with(Vec::new)
            .push(checkpoint.expect("phase-changing commands capture a checkpoint"));
    }
    if matches!(
        state.phase,
        P::TeamBuilding | P::Assassination | P::GameOver
    ) {
        state.discussion = None;
    }
    sync_timers(&previous, &mut state, event, now);
    for l in &mut state.logs {
        if l.at == 0 {
            l.at = now;
        }
    }
    Ok(Transition { state, effects })
}
fn may_change_phase(s: &GameState, e: &GameEvent) -> bool {
    match e {
        G::AckRole { .. }
        | G::RerollLeader { .. }
        | G::RerollRoles { .. }
        | G::UseRerollCard { .. }
        | G::SetTimersPaused { .. }
        | G::SetConnected { .. }
        | G::RetractVotes => false,
        G::EndSpeech { .. } | G::SkipSpeech { .. } => s
            .discussion
            .as_ref()
            .is_some_and(|d| d.speaker_index + 1 >= d.order.len()),
        G::CastVote { .. } => s.votes.len() + 1 >= s.players.len(),
        G::CastMissionCard { by, .. } => s.proposed_team.as_ref().is_none_or(|t| {
            t.iter()
                .all(|id| id == by || s.mission_cards.contains_key(id))
        }),
        G::RequestAssassination { .. } => s.assassination_voters().len() == 1,
        G::VoteAssassination { by, value, .. } => {
            *value == Vote::Approve
                && s.ballot().is_some_and(|b| {
                    b.voter_ids
                        .iter()
                        .all(|id| id == by || b.votes.get(id) == Some(&Vote::Approve))
                })
        }
        _ => true,
    }
}

fn dispatch(s: &mut GameState, e: &GameEvent, effects: &mut Vec<Effect>) -> Result<()> {
    match e {
        G::StartGame {
            by,
            flow_version,
            assigned_roles,
            await_role_acks,
            leader_index,
            role_variants,
            ..
        } => {
            if s.phase != P::Lobby {
                return Err(error(E::WrongPhase, "Game already started"));
            }
            if s.players.first().is_none_or(|p| &p.id != by) {
                return Err(error(E::NotHost, "Only the host can start"));
            }
            let roles = assigned_roles.as_ref().ok_or_else(|| {
                error(E::InvalidRandomness, "Resolved assignedRoles are required")
            })?;
            if roles.len() != s.players.len() {
                return Err(error(
                    E::InvalidRoleSet,
                    "Role count != player count at assignment",
                ));
            }
            s.flow_version = Some(flow_version.unwrap_or(5));
            if *await_role_acks == Some(true) {
                s.await_role_acks = Some(true);
            }
            for (p, r) in s.players.iter_mut().zip(roles) {
                p.role = *r;
            }
            s.leader_index = leader_index.unwrap_or(0);
            install_variants(s, role_variants);
            set_assassin(s);
            set_lady(s);
            s.phase = P::TeamBuilding;
            s.role_acks.clear();
            s.proposed_team = None;
            log(
                s,
                "gameStarted",
                params([("count", s.players.len().to_string().into())]),
                None,
                false,
            );
            log(
                s,
                "lineup",
                params([
                    ("good", lineup(&s.config.roles, Team::Good).into()),
                    ("evil", lineup(&s.config.roles, Team::Evil).into()),
                ]),
                None,
                false,
            );
            knowledge(s);
            round_log(s);
            effect(effects, CheckpointKind::GameStarted);
        }
        G::AckRole { by, role_revision } => {
            if s.phase == P::Lobby {
                return Err(error(E::WrongPhase, "Game has not started"));
            }
            if s.player(by).is_none() {
                return Err(error(E::UnknownPlayer, format!("Unknown player {by}")));
            }
            if role_revision.unwrap_or(0) != s.role_revision {
                return Err(error(
                    E::WrongPhase,
                    "Roles were reassigned. View and confirm your new identity.",
                ));
            }
            if !s.role_acks.contains(by) {
                s.role_acks.push(by.clone());
            }
        }
        G::UseRerollCard {
            by,
            role_revision,
            assigned_roles,
            role_variants,
        } => {
            let old = s
                .player(by)
                .ok_or_else(|| error(E::UnknownPlayer, "Unknown player"))?
                .role;
            if !s.can_reroll_opening()
                || s.role_acks.contains(by)
                || *role_revision != s.role_revision
            {
                return Err(error(
                    E::WrongPhase,
                    "Reroll is only available before confirming your current identity and the first proposal.",
                ));
            }
            if s.config.roles.iter().all(|r| *r == old) {
                return Err(error(E::InvalidRoleSet, "No different identity available"));
            }
            for (p, r) in s
                .players
                .iter_mut()
                .zip(assigned_roles.as_ref().expect("validated roles"))
            {
                p.role = *r;
            }
            install_variants(s, role_variants);
            set_assassin(s);
            s.role_acks.clear();
            s.role_revision += 1;
            s.phase_revision = Some(s.phase_revision.unwrap_or(0) + 1);
            clear_knowledge(s);
            log(
                s,
                "rerollCardUsed",
                params([("player", by.into())]),
                None,
                false,
            );
            knowledge(s);
        }
        G::RerollLeader {
            actor,
            leader_index,
        } => {
            if !s.can_reroll_opening() {
                return Err(error(
                    E::WrongPhase,
                    "Only available before the first proposal or assassination.",
                ));
            }
            s.phase_revision = Some(s.phase_revision.unwrap_or(0) + 1);
            s.leader_index = leader_index.expect("validated leader");
            set_lady(s);
            log(
                s,
                "admin.leaderRerolled",
                params([
                    ("actor", actor.clone().into()),
                    ("seat", (s.leader_index + 1).into()),
                ]),
                None,
                true,
            );
        }
        G::RerollRoles {
            actor,
            assigned_roles,
            role_variants,
        } => {
            if !s.can_reroll_opening() {
                return Err(error(
                    E::WrongPhase,
                    "Only available before the first proposal or assassination.",
                ));
            }
            s.phase_revision = Some(s.phase_revision.unwrap_or(0) + 1);
            for (p, r) in s
                .players
                .iter_mut()
                .zip(assigned_roles.as_ref().expect("validated roles"))
            {
                p.role = *r;
            }
            install_variants(s, role_variants);
            set_assassin(s);
            s.role_acks.clear();
            s.role_revision += 1;
            clear_knowledge(s);
            log(
                s,
                "admin.rolesRerolled",
                params([("actor", actor.clone().into())]),
                None,
                true,
            );
            knowledge(s);
        }
        G::ProposeTeam { by, team, admin } | G::FinalizeTeam { by, team, admin } => {
            let final_ = matches!(e, G::FinalizeTeam { .. });
            phase(
                s,
                if final_ {
                    P::TeamFinalizing
                } else {
                    P::TeamBuilding
                },
            )?;
            if *admin != Some(true) && s.leader_id() != *by {
                return Err(error(E::NotLeader, "Only the leader may propose"));
            }
            let size = mission_sizes(s.config.player_count)
                .get(s.round_index)
                .copied()
                .unwrap_or(0);
            if team.len() != size {
                return Err(error(
                    E::WrongTeamSize,
                    format!("Team must have {size} members, got {}", team.len()),
                ));
            }
            let mut seen = HashSet::new();
            if team.iter().any(|id| !seen.insert(id)) {
                return Err(error(E::DuplicateTeamMember, "Duplicate team member"));
            }
            for id in team {
                if s.player(id).is_none() {
                    return Err(error(E::InvalidTeamMember, format!("Unknown member {id}")));
                }
            }
            let changed = s
                .proposed_team
                .as_ref()
                .is_some_and(|old| old.iter().any(|id| !team.contains(id)));
            s.team_changed = Some(final_ && changed);
            s.proposed_team = Some(team.clone());
            s.opening_closed = true;
            s.votes.clear();
            s.discussion = None;
            s.phase = if final_ || s.flow_version == Some(1) {
                P::Voting
            } else {
                P::TeamAnnouncement
            };
            if s.flow_version != Some(1) {
                let mut p = params([
                    ("leader", by.into()),
                    (
                        "team",
                        team.iter()
                            .map(PlayerId::as_ref)
                            .collect::<Vec<_>>()
                            .join(",")
                            .into(),
                    ),
                ])
                .unwrap();
                if final_ {
                    p.insert("changed".into(), usize::from(changed).into());
                }
                log(
                    s,
                    if final_ {
                        "teamFinalized"
                    } else {
                        "teamAnnounced"
                    },
                    Some(p),
                    None,
                    false,
                );
            }
            if !final_ && !matches!(s.flow_version, Some(1 | 2 | 5)) {
                let leader = s.leader_id();
                start_discussion(s, &leader, Direction::Clockwise)?;
            }
        }
        G::StartDiscussion { by, direction } => {
            start_discussion(s, by, direction.unwrap_or(Direction::Clockwise))?
        }
        G::EndSpeech { by } | G::SkipSpeech { target: by, .. } => {
            if s.phase != P::Discussion || s.discussion.is_none() {
                return Err(error(E::WrongPhase, "Not in Discussion"));
            }
            let d = s.discussion.as_ref().unwrap();
            let idx = d.speaker_index;
            if d.order.get(idx) != Some(by) {
                return Err(error(E::NotSpeaker, "Only the current speaker may finish"));
            }
            if let G::SkipSpeech { actor, .. } = e {
                log(
                    s,
                    "admin.speechSkipped",
                    params([("actor", actor.clone().into()), ("player", by.into())]),
                    None,
                    true,
                );
            }
            let d = s.discussion.as_mut().unwrap();
            d.speaker_index += 1;
            if d.speaker_index >= d.order.len() {
                s.phase = P::TeamFinalizing;
                log(
                    s,
                    "discussionFinished",
                    params([("leader", s.leader_id().into())]),
                    None,
                    false,
                );
            } else {
                let next = d.order[d.speaker_index].clone();
                log(
                    s,
                    "speechBegins",
                    params([("player", next.into())]),
                    None,
                    false,
                );
            }
        }
        G::SetTimersPaused { paused, actor } => {
            if matches!(s.phase, P::Lobby | P::GameOver) || s.action_timers.is_empty() {
                return Err(error(E::WrongPhase, "No current timer"));
            }
            if !s
                .action_timers
                .iter()
                .all(|t| t.paused_at.is_some() == *paused)
            {
                log(
                    s,
                    if *paused {
                        "admin.timersPaused"
                    } else {
                        "admin.timersResumed"
                    },
                    params([("actor", actor.clone().into())]),
                    None,
                    true,
                );
            }
        }
        G::CastVote { by, value, admin } => {
            cast_vote(s, by, *value, *admin == Some(true), effects)?
        }
        G::RetractVotes => {
            phase(s, P::Voting)?;
            s.votes.clear();
        }
        G::RetractProposal => {
            if !matches!(
                s.phase,
                P::Voting | P::TeamAnnouncement | P::Discussion | P::TeamFinalizing
            ) {
                return Err(error(E::WrongPhase, "No active proposal"));
            }
            s.proposed_team = None;
            s.votes.clear();
            s.phase = P::TeamBuilding;
        }
        G::CastMissionCard { by, card } => cast_card(s, by, *card, effects)?,
        G::UseLady { by, target } => {
            phase(s, P::LadyOfLake)?;
            if s.lady_holder_id.as_ref() != Some(by) {
                return Err(error(E::NotLadyHolder, "Only the Lady holder may inspect"));
            }
            if target == by {
                return Err(error(E::LadyTargetSelf, "Cannot inspect yourself"));
            }
            if s.lady_inspected_ids.contains(target) {
                return Err(error(E::LadyTargetInspected, "Target already inspected"));
            }
            let loyalty = s
                .player(target)
                .ok_or_else(|| error(E::InvalidTeamMember, format!("Unknown target {target}")))?
                .role
                .team();
            s.lady_inspected_ids.push(by.clone());
            s.last_lady_result = Some(LadyResult {
                holder_id: by.clone(),
                target_id: target.clone(),
                loyalty,
            });
            s.lady_holder_id = Some(target.clone());
            s.pending_lady = false;
            log(
                s,
                "ladyInspected",
                params([("holder", by.into()), ("target", target.into())]),
                None,
                false,
            );
            log(
                s,
                if loyalty == Team::Evil {
                    "ladyResultEvil"
                } else {
                    "ladyResultGood"
                },
                params([("target", target.into())]),
                Some(by),
                false,
            );
            advance_round(s);
            effect(effects, CheckpointKind::Lady);
        }
        G::RequestAssassination { by } => {
            if !s.can_start_assassination() || s.ballot().is_some() {
                return Err(error(E::WrongPhase, "Cannot request assassination now"));
            }
            let voters = s.assassination_voters();
            if !voters.contains(by) {
                return Err(error(
                    E::NotAssassin,
                    "Only mutually known red teammates may request assassination",
                ));
            }
            let mut votes = Votes::new();
            votes.insert(by.clone(), Vote::Approve);
            s.early_assassination = Some(Some(AssassinationBallot {
                id: s.log_seq + 1,
                initiator_id: by.clone(),
                voter_ids: voters.clone(),
                votes,
            }));
            for id in &voters {
                log(
                    s,
                    "assassinationRequested",
                    params([("player", by.into())]),
                    Some(id),
                    false,
                );
            }
            if voters.len() == 1 {
                let id = s.assassin_id.clone().unwrap();
                start_assassination(s, &id, false, None)?;
            }
        }
        G::VoteAssassination {
            by,
            proposal_id,
            value,
        } => {
            let Some(ballot) = s.ballot() else {
                return Err(error(
                    E::WrongPhase,
                    "This assassination ballot is no longer active",
                ));
            };
            if !s.can_start_assassination() || ballot.id != *proposal_id {
                return Err(error(
                    E::WrongPhase,
                    "This assassination ballot is no longer active",
                ));
            }
            if !ballot.voter_ids.contains(by) {
                return Err(error(E::NotAssassin, "Only known red teammates may vote"));
            }
            if ballot.votes.contains_key(by) {
                return Err(error(E::AlreadyVoted, "Already voted on this proposal"));
            }
            let b = s.early_assassination.as_mut().unwrap().as_mut().unwrap();
            b.votes.insert(by.clone(), *value);
            let voters = b.voter_ids.clone();
            let all = voters
                .iter()
                .all(|id| b.votes.get(id) == Some(&Vote::Approve));
            if *value == Vote::Reject {
                for id in voters {
                    log(
                        s,
                        "assassinationRejected",
                        params([("player", by.into())]),
                        Some(&id),
                        false,
                    );
                }
                s.early_assassination = Some(None);
            } else if all {
                let id = s.assassin_id.clone().unwrap();
                start_assassination(s, &id, false, None)?;
            }
        }
        G::StartAssassination { by, admin, actor } => {
            start_assassination(s, by, *admin == Some(true), actor.as_deref())?
        }
        G::Assassinate { by, target } => {
            phase(s, P::Assassination)?;
            if s.assassin_id.as_ref() != Some(by) {
                return Err(error(E::NotAssassin, "Only the assassin may act"));
            }
            let p = s.player(target).ok_or_else(|| {
                error(E::AssassinTargetInvalid, format!("Unknown target {target}"))
            })?;
            if target == by {
                return Err(error(E::AssassinTargetInvalid, "Cannot target self"));
            }
            if p.role.is_evil() {
                return Err(error(
                    E::AssassinTargetInvalid,
                    "Target must be on the blue team",
                ));
            }
            let hit = p.role == Role::Merlin;
            s.phase = P::GameOver;
            log(
                s,
                "assassinStruck",
                params([("target", target.into())]),
                None,
                false,
            );
            log(
                s,
                if hit {
                    "assassinHitMerlin"
                } else {
                    "assassinMissed"
                },
                None,
                None,
                false,
            );
            s.outcome = Some(outcome(
                s,
                if hit { Team::Evil } else { Team::Good },
                if hit {
                    WinReason::AssassinatedMerlin
                } else {
                    WinReason::AssassinMissed
                },
                Some(target.clone()),
            ));
            effect(effects, CheckpointKind::GameOver);
        }
        G::PreviousPhase { actor } => {
            let cp = s
                .phase_history
                .as_mut()
                .and_then(Vec::pop)
                .ok_or_else(|| error(E::WrongPhase, "No previous phase to return to"))?;
            s.restore(cp);
            s.phase_revision = Some(s.phase_revision.unwrap_or(0) + 1);
            if s.phase == P::Voting {
                s.votes.clear();
            }
            s.mission_cards.clear();
            log(
                s,
                "admin.phaseReturned",
                params([
                    ("actor", actor.clone().into()),
                    ("phase", s.phase.as_str().into()),
                    ("proposal", (s.rejection_count + 1).into()),
                ]),
                None,
                true,
            );
        }
        G::SetConnected { by, connected } => {
            let p = s
                .players
                .iter_mut()
                .find(|p| &p.id == by)
                .ok_or_else(|| error(E::UnknownPlayer, format!("Unknown player {by}")))?;
            p.connected = *connected;
        }
    }
    Ok(())
}
fn install_variants(s: &mut GameState, variants: &Option<RoleVariants>) {
    if s.randomness_version == Some(RandomnessVersion::ResolvedV1) {
        s.role_variants = variants.clone();
    }
}
fn start_discussion(s: &mut GameState, by: &PlayerId, direction: Direction) -> Result<()> {
    phase(s, P::TeamAnnouncement)?;
    if &s.leader_id() != by {
        return Err(error(E::NotLeader, "Only the leader may start discussion"));
    }
    let mut seats: Vec<_> = s.players.iter().collect();
    seats.sort_by_key(|p| p.seat);
    let n = seats.len() as i64;
    let offset = if matches!(s.flow_version, Some(2 | 3)) {
        0
    } else {
        1
    };
    let step = if s.flow_version == Some(5) && direction == Direction::Clockwise {
        -1
    } else {
        1
    };
    let start = seats
        .iter()
        .position(|p| &p.id == by)
        .expect("validated leader") as i64
        + offset * step;
    let order: Vec<_> = (0..n)
        .map(|i| seats[(start + i * step).rem_euclid(n) as usize].id.clone())
        .collect();
    let first = order[0].clone();
    s.discussion = Some(DiscussionState {
        order,
        speaker_index: 0,
    });
    s.phase = P::Discussion;
    log(
        s,
        "speechBegins",
        params([("player", first.into())]),
        None,
        false,
    );
    Ok(())
}
fn cast_vote(
    s: &mut GameState,
    by: &PlayerId,
    value: Vote,
    admin: bool,
    effects: &mut Vec<Effect>,
) -> Result<()> {
    phase(s, P::Voting)?;
    if s.player(by).is_none() {
        return Err(error(E::UnknownPlayer, format!("Unknown player {by}")));
    }
    if !admin && s.votes.contains_key(by) {
        return Err(error(E::AlreadyVoted, "Already voted"));
    }
    s.votes.insert(by.clone(), value);
    log(
        s,
        if value == Vote::Approve {
            "youApproved"
        } else {
            "youRejected"
        },
        params([
            ("round", (s.round_index + 1).to_string().into()),
            ("proposal", (s.rejection_count + 1).to_string().into()),
        ]),
        Some(by),
        false,
    );
    let n = s.players.len();
    if s.votes.len() != n {
        return Ok(());
    }
    effect(effects, CheckpointKind::Vote);
    let approves = s.votes.values().filter(|v| **v == Vote::Approve).count();
    let approved = approves > n - approves;
    s.vote_history.push(VoteRecord {
        round_index: s.round_index,
        proposal_index: s.rejection_count,
        leader_id: s.leader_id(),
        team: s.proposed_team.clone().unwrap_or_default(),
        votes: s.votes.clone(),
        approved,
    });
    log(
        s,
        if approved {
            "voteApproved"
        } else {
            "voteRejected"
        },
        params([
            ("round", (s.round_index + 1).to_string().into()),
            ("proposal", (s.rejection_count + 1).to_string().into()),
            ("approves", approves.to_string().into()),
            ("rejects", (n - approves).to_string().into()),
        ]),
        None,
        false,
    );
    if approved {
        s.rejection_count = 0;
        s.mission_cards.clear();
        s.phase = P::MissionVote;
        return Ok(());
    }
    let limit = s.config.options.rejection_limit();
    if s.rejection_count + 1 >= limit {
        s.phase = P::GameOver;
        log(
            s,
            if limit == 5 {
                "hammerEvilWins"
            } else {
                "rejectionLimitReached"
            },
            params([("count", limit.into())]),
            None,
            false,
        );
        s.outcome = Some(outcome(
            s,
            Team::Evil,
            if limit == 5 {
                WinReason::FiveRejections
            } else {
                WinReason::RejectionLimit
            },
            None,
        ));
        effect(effects, CheckpointKind::GameOver);
        return Ok(());
    }
    s.rejection_count += 1;
    s.leader_index = (s.leader_index + 1) % n;
    s.proposed_team = None;
    s.votes.clear();
    s.phase = P::TeamBuilding;
    log(
        s,
        "proposalBegins",
        params([
            ("leader", s.leader_id().into()),
            ("round", (s.round_index + 1).to_string().into()),
            ("proposal", (s.rejection_count + 1).to_string().into()),
        ]),
        None,
        false,
    );
    Ok(())
}
fn cast_card(
    s: &mut GameState,
    by: &PlayerId,
    card: MissionCard,
    effects: &mut Vec<Effect>,
) -> Result<()> {
    phase(s, P::MissionVote)?;
    if !s.proposed_team.as_ref().is_some_and(|t| t.contains(by)) {
        return Err(error(E::NotOnTeam, "Player is not on the mission team"));
    }
    if s.mission_cards.contains_key(by) {
        return Err(error(E::AlreadyPlayedCard, "Already played a card"));
    }
    if card == MissionCard::Fail && !s.player(by).expect("team member").role.is_evil() {
        return Err(error(
            E::GoodCannotFail,
            "Blue team players must play success",
        ));
    }
    s.mission_cards.insert(by.clone(), card);
    log(
        s,
        if card == MissionCard::Fail {
            "youPlayedFail"
        } else {
            "youPlayedSuccess"
        },
        params([("round", (s.round_index + 1).to_string().into())]),
        Some(by),
        false,
    );
    let team = s.proposed_team.as_ref().expect("mission team");
    if !team.iter().all(|id| s.mission_cards.contains_key(id)) {
        return Ok(());
    }
    let fails = team
        .iter()
        .filter(|id| s.mission_cards.get(*id) == Some(&MissionCard::Fail))
        .count();
    let required = required_fails(s.config.player_count)[s.round_index];
    let success = fails < required;
    let cards = team
        .iter()
        .map(|id| (id.clone(), s.mission_cards[id]))
        .collect();
    s.mission_results.push(MissionOutcome {
        round_index: s.round_index,
        team_size: team.len(),
        team: team.clone(),
        success,
        fail_count: fails,
        cards,
    });
    s.phase = P::MissionResult;
    s.mission_cards.clear();
    log(
        s,
        if success {
            "missionSucceeded"
        } else {
            "missionFailed"
        },
        params([
            ("round", (s.round_index + 1).to_string().into()),
            ("fails", fails.to_string().into()),
        ]),
        None,
        false,
    );
    effect(effects, CheckpointKind::MissionResult);
    let good = s.mission_results.iter().filter(|m| m.success).count();
    let evil = s.mission_results.len() - good;
    if evil >= 3 {
        s.phase = P::GameOver;
        log(s, "evilWinsMissions", None, None, false);
        s.outcome = Some(outcome(s, Team::Evil, WinReason::ThreeMissions, None));
        effect(effects, CheckpointKind::GameOver);
    } else if good >= 3 {
        if s.players.iter().any(|p| p.role == Role::Assassin) {
            s.phase = P::Assassination;
            log(s, "goodWinsMissionsAssassin", None, None, false);
        } else {
            s.phase = P::GameOver;
            log(s, "goodWinsMissions", None, None, false);
            s.outcome = Some(outcome(s, Team::Good, WinReason::ThreeMissions, None));
            effect(effects, CheckpointKind::GameOver);
        }
    } else if s.lady_enabled && (1..=3).contains(&s.round_index) {
        s.phase = P::LadyOfLake;
        s.pending_lady = true;
        log(
            s,
            "ladyBegins",
            params([(
                "holder",
                s.lady_holder_id
                    .clone()
                    .expect("enabled Lady has a holder")
                    .into(),
            )]),
            None,
            false,
        );
    } else {
        advance_round(s);
    }
    Ok(())
}
fn advance_round(s: &mut GameState) {
    s.round_index += 1;
    s.leader_index = (s.leader_index + 1) % s.players.len();
    s.rejection_count = 0;
    s.proposed_team = None;
    s.votes.clear();
    s.phase = P::TeamBuilding;
    round_log(s);
}
fn start_assassination(
    s: &mut GameState,
    by: &PlayerId,
    admin: bool,
    actor: Option<&str>,
) -> Result<()> {
    if !s.can_start_assassination() {
        return Err(error(E::WrongPhase, "Assassination cannot be started now"));
    }
    if !admin && s.assassin_id.as_ref() != Some(by) {
        return Err(error(E::NotAssassin, "Only the assassin may act"));
    }
    s.early_assassination = Some(None);
    s.phase = P::Assassination;
    s.opening_closed = true;
    s.proposed_team = None;
    s.votes.clear();
    s.mission_cards.clear();
    s.pending_lady = false;
    if admin {
        log(
            s,
            "admin.assassinationStarted",
            params([("actor", actor.unwrap_or(by.as_ref()).into())]),
            None,
            true,
        );
    } else {
        log(
            s,
            "earlyAssassination",
            params([("player", by.into())]),
            None,
            false,
        );
    }
    Ok(())
}

struct TimerContext {
    phase: Phase,
    round: usize,
    rejections: usize,
    phase_revision: Option<u64>,
    role_revision: u64,
    speaker: Option<usize>,
    timers: Vec<ActionTimer>,
}
impl TimerContext {
    fn capture(s: &GameState) -> Self {
        Self {
            phase: s.phase,
            round: s.round_index,
            rejections: s.rejection_count,
            phase_revision: s.phase_revision,
            role_revision: s.role_revision,
            speaker: s.discussion.as_ref().map(|d| d.speaker_index),
            timers: s.action_timers.clone(),
        }
    }
}
fn resume(mut t: ActionTimer, now: i64) -> ActionTimer {
    if let Some(paused) = t.paused_at.take() {
        t.started_at += (now - paused).max(0);
    }
    t
}
fn sync_timers(prev: &TimerContext, s: &mut GameState, event: &GameEvent, now: i64) {
    let mut pending = Vec::new();
    let mut add = |id: Option<&PlayerId>, action| {
        if let Some(id) = id
            && (action == ActionKind::Role || s.role_acks.contains(id))
        {
            pending.push((id.clone(), action));
        }
    };
    if !matches!(s.phase, P::Lobby | P::GameOver) {
        for p in &s.players {
            if !s.role_acks.contains(&p.id) {
                add(Some(&p.id), ActionKind::Role);
            }
        }
        if !s.roles_pending() {
            match s.phase {
                P::TeamBuilding => add(s.leader().map(|p| &p.id), ActionKind::Propose),
                P::TeamAnnouncement => add(s.leader().map(|p| &p.id), ActionKind::Announce),
                P::Discussion => add(
                    s.discussion
                        .as_ref()
                        .and_then(|d| d.order.get(d.speaker_index)),
                    ActionKind::Speak,
                ),
                P::TeamFinalizing => add(s.leader().map(|p| &p.id), ActionKind::Finalize),
                P::Voting => {
                    for p in &s.players {
                        if !s.votes.contains_key(&p.id) {
                            add(Some(&p.id), ActionKind::Vote);
                        }
                    }
                }
                P::MissionVote => {
                    for id in s.proposed_team.iter().flatten() {
                        if !s.mission_cards.contains_key(id) {
                            add(Some(id), ActionKind::Mission);
                        }
                    }
                }
                P::LadyOfLake => add(s.lady_holder_id.as_ref(), ActionKind::Lady),
                P::Assassination => add(s.assassin_id.as_ref(), ActionKind::Assassinate),
                _ => {}
            }
        }
    }
    let reset = prev.phase != s.phase
        || prev.round != s.round_index
        || prev.rejections != s.rejection_count
        || prev.phase_revision != s.phase_revision
        || prev.speaker != s.discussion.as_ref().map(|d| d.speaker_index)
        || matches!(event, G::RetractVotes);
    let carry_pause = !reset && prev.timers.iter().any(|t| t.paused_at.is_some());
    let speech_ms = s.config.options.speech_duration() * 1000;
    s.action_timers = pending
        .into_iter()
        .map(|(id, action)| {
            let keep = if action == ActionKind::Role {
                prev.role_revision == s.role_revision
            } else {
                !reset
            };
            let existing = if keep {
                prev.timers
                    .iter()
                    .find(|t| t.player_id == id && t.action == action)
            } else {
                None
            };
            let mut t = if let Some(t) = existing {
                if reset {
                    resume(t.clone(), now)
                } else {
                    t.clone()
                }
            } else {
                let duration = match action {
                    ActionKind::Announce if s.flow_version == Some(5) => speech_ms / 2,
                    ActionKind::Speak => speech_ms,
                    ActionKind::Assassinate => speech_ms * 3 / 2,
                    _ => 20000,
                };
                ActionTimer {
                    player_id: id,
                    action,
                    started_at: now,
                    duration_ms: duration,
                    paused_at: carry_pause.then_some(now),
                }
            };
            if let G::SetTimersPaused { paused, .. } = event {
                if *paused {
                    t.paused_at.get_or_insert(now);
                } else {
                    t = resume(t, now);
                }
            }
            t
        })
        .collect();
}
