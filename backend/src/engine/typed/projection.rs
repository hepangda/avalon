use super::*;
pub fn known_players(viewer: &PlayerSlot, players: &[PlayerSlot]) -> Vec<VisibilityInfo> {
    players
        .iter()
        .filter(|p| p.id != viewer.id)
        .filter_map(|p| {
            let (shown_as, certain, role) = match viewer.role {
                Role::Merlin if p.role.is_evil() && p.role != Role::Mordred => {
                    (ShownAs::Evil, true, None)
                }
                Role::Percival if matches!(p.role, Role::Merlin | Role::Morgana) => {
                    (ShownAs::MerlinOrMorgana, false, None)
                }
                Role::Morgana | Role::Assassin | Role::Mordred | Role::Minion
                    if p.role.is_evil() && p.role != Role::Oberon =>
                {
                    (ShownAs::KnownAlly, true, Some(p.role))
                }
                _ => return None,
            };
            Some(VisibilityInfo {
                player_id: p.id.clone(),
                shown_as,
                certain,
                role,
            })
        })
        .collect()
}
pub fn role_variants(s: &GameState) -> RoleVariants {
    if s.randomness_version == Some(RandomnessVersion::ResolvedV1) {
        return s.role_variants.clone().unwrap_or_default();
    }
    #[cfg(feature = "legacy-import")]
    if s.randomness_version.is_none() {
        return legacy_role_variants(s);
    }
    RoleVariants::new()
}
#[cfg(feature = "legacy-import")]
pub(crate) fn legacy_role_variants(s: &GameState) -> RoleVariants {
    let mut variants = RoleVariants::new();
    for (role, count) in [(Role::LoyalServant, 5u8), (Role::Minion, 2u8)] {
        let mut rng = Rng::legacy(&format!("{}:role-art:v2:{role}", s.seed));
        let mut players: Vec<_> = s.players.iter().filter(|p| p.role == role).collect();
        players.sort_by_key(|p| p.seat);
        rng.shuffle(&mut players);
        let mut choices: Vec<_> = (0..count).collect();
        rng.shuffle(&mut choices);
        for (i, p) in players.iter().enumerate() {
            variants.insert(p.id.clone(), choices[i % count as usize]);
        }
    }
    variants
}
fn template(s: &GameState, variants: &RoleVariants) -> ClientGameState {
    let over = s.phase == Phase::GameOver;
    let assassination = s.phase == Phase::Assassination;
    let leader = s.leader_id();
    let players = s
        .players
        .iter()
        .map(|p| {
            let visible = over || (assassination && p.role.is_evil());
            ClientPlayer {
                id: p.id.clone(),
                name: p.name.clone(),
                seat: p.seat,
                connected: p.connected,
                is_bot: None,
                avatar_url: None,
                latency: None,
                claimed: None,
                role: visible.then_some(p.role),
                role_variant: if visible {
                    variants.get(&p.id).copied()
                } else {
                    None
                },
                is_leader: p.id == leader,
                is_lady_holder: s.lady_enabled && s.lady_holder_id.as_ref() == Some(&p.id),
            }
        })
        .collect();
    let votes =
        if matches!(s.phase, Phase::Voting | Phase::MissionVote) || s.proposed_team.is_some() {
            let all = s.votes.len() == s.players.len();
            Some(
                s.players
                    .iter()
                    .map(|p| ClientVote {
                        player_id: p.id.clone(),
                        has_voted: s.votes.contains_key(&p.id),
                        vote: if all {
                            s.votes.get(&p.id).copied()
                        } else {
                            None
                        },
                    })
                    .collect(),
            )
        } else {
            None
        };
    ClientGameState {
        phase: s.phase,
        discussion: s.discussion.clone(),
        action_timers: s.action_timers.clone(),
        server_time: None,
        previous_phase: s
            .phase_history
            .as_ref()
            .and_then(|h| h.last())
            .map(|c| c.phase),
        phase_revision: s.phase_revision.unwrap_or(0),
        role_revision: s.role_revision,
        can_reroll_opening: s.can_reroll_opening(),
        round_index: s.round_index,
        leader_index: s.leader_index,
        rejection_count: s.rejection_count,
        players,
        self_role: None,
        known_players: vec![],
        role_acks: s.role_acks.clone(),
        roles_pending: s.roles_pending(),
        proposed_team: s.proposed_team.clone(),
        team_changed: s.team_changed,
        votes,
        mission_submissions: if s.phase == Phase::MissionVote {
            s.proposed_team
                .iter()
                .flatten()
                .filter(|id| s.mission_cards.contains_key(*id))
                .cloned()
                .collect()
        } else {
            vec![]
        },
        mission_results: s
            .mission_results
            .iter()
            .map(|m| ClientMissionResult {
                round_index: m.round_index,
                success: m.success,
                fail_count: m.fail_count,
                team_size: m.team_size,
            })
            .collect(),
        vote_history: s
            .vote_history
            .iter()
            .map(|v| ClientVoteRecord {
                round_index: v.round_index,
                proposal_index: v.proposal_index,
                leader_id: v.leader_id.clone(),
                team: v.team.clone(),
                votes: v
                    .votes
                    .iter()
                    .map(|(id, vote)| RecordedVote {
                        player_id: id.clone(),
                        vote: *vote,
                    })
                    .collect(),
                approved: v.approved,
            })
            .collect(),
        logs: vec![],
        config: ClientConfig {
            player_count: s.config.player_count,
            mission_sizes: mission_sizes(s.config.player_count).to_vec(),
            required_fails: required_fails(s.config.player_count).to_vec(),
            roles_in_play: s.config.roles.clone(),
            max_rejections: s.config.options.rejection_limit(),
            speech_seconds: s.config.options.speech_seconds.unwrap_or(120.) as i64,
        },
        lady: s.lady_enabled.then(|| LadyView {
            holder_id: s.lady_holder_id.clone(),
            inspected_ids: s.lady_inspected_ids.clone(),
            pending: s.pending_lady,
        }),
        private_lady_result: None,
        can_start_assassination: false,
        early_assassination: None,
        assassin_candidates: None,
        outcome: if over { s.outcome.clone() } else { None },
        is_spectator: true,
        game_id: None,
    }
}
fn complete(
    s: &GameState,
    mut view: ClientGameState,
    variants: &RoleVariants,
    viewer: &PlayerId,
) -> ClientGameState {
    view.logs = s
        .logs
        .iter()
        .filter(|l| l.channel == LogChannel::Public || l.audience.as_ref() == Some(viewer))
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
    if let Some(p) = s.player(viewer) {
        view.self_role = Some(p.role);
        view.is_spectator = false;
        view.known_players = known_players(p, &s.players);
        if let Some(p) = view.players.iter_mut().find(|p| &p.id == viewer) {
            p.role = view.self_role;
            p.role_variant = variants.get(viewer).copied();
        }
        view.can_start_assassination = !view.roles_pending
            && s.assassination_voters().contains(viewer)
            && s.ballot().is_none()
            && s.can_start_assassination();
        if let Some(lady) = s
            .last_lady_result
            .as_ref()
            .filter(|l| &l.holder_id == viewer)
        {
            view.private_lady_result = Some(PrivateLadyResult {
                target_id: lady.target_id.clone(),
                loyalty: lady.loyalty,
            });
        }
        if s.phase == Phase::Assassination && s.assassin_id.as_ref() == Some(viewer) {
            view.assassin_candidates = Some(
                s.players
                    .iter()
                    .filter(|p| !p.role.is_evil())
                    .map(|p| p.id.clone())
                    .collect(),
            );
        }
    }
    if let Some(ballot) = s.ballot().filter(|b| b.voter_ids.contains(viewer)) {
        view.early_assassination = Some(ballot.clone());
    }
    view
}
pub fn project(s: &GameState, viewer: &PlayerId) -> ClientGameState {
    let variants = role_variants(s);
    complete(s, template(s, &variants), &variants, viewer)
}
pub fn project_many(s: &GameState, viewers: &[PlayerId]) -> Vec<ClientGameState> {
    let variants = role_variants(s);
    let base = template(s, &variants);
    viewers
        .iter()
        .map(|id| complete(s, base.clone(), &variants, id))
        .collect()
}
