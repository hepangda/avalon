//! Native domain model. JSON is confined to the parent module's codec adapters.
mod model;
mod projection;
mod randomness;
mod rules;
pub use super::rng::Rng;
pub use model::*;
pub use projection::{known_players, project, project_many, role_variants};
pub(crate) use randomness::weighted_with_rng;
pub use randomness::{resolve_randomness, weighted_roles};
#[cfg(feature = "legacy-import")]
pub(crate) use rules::apply_legacy;
pub use rules::{apply_owned, create_game};
#[cfg(feature = "legacy-import")]
pub fn create_legacy_game(input: impl std::borrow::Borrow<CreateGame>) -> Result<GameState> {
    let mut state = create_game(input)?;
    state.randomness_version = None;
    state.role_variants = None;
    Ok(state)
}
#[cfg(feature = "legacy-import")]
pub use super::legacy::apply_legacy_owned;

pub fn mission_sizes(n: usize) -> &'static [usize] {
    match n {
        5 => &[2, 3, 2, 3, 3],
        6 => &[2, 3, 4, 3, 4],
        7 => &[2, 3, 3, 4, 4],
        8..=10 => &[3, 4, 4, 5, 5],
        _ => &[],
    }
}
pub fn required_fails(n: usize) -> &'static [usize] {
    match n {
        5 | 6 => &[1, 1, 1, 1, 1],
        7..=10 => &[1, 1, 1, 2, 1],
        _ => &[],
    }
}
pub fn build_roles(n: usize, options: &GameOptions) -> Result<Vec<Role>> {
    let (good, evil) = match n {
        5 => (3, 2),
        6 => (4, 2),
        7 => (4, 3),
        8 => (5, 3),
        9 => (6, 3),
        10 => (6, 4),
        _ => {
            return Err(EngineError::new(
                ErrorCode::InvalidPlayerCount,
                format!("Player count {n} not in 5..10"),
            ));
        }
    };
    let mut g = vec![Role::Merlin];
    if options.percival {
        g.push(Role::Percival);
    }
    while g.len() < good {
        g.push(Role::LoyalServant);
    }
    let mut e = vec![Role::Assassin];
    for (enabled, role) in [
        (options.morgana, Role::Morgana),
        (options.mordred, Role::Mordred),
        (options.oberon, Role::Oberon),
    ] {
        if enabled {
            e.push(role);
        }
    }
    while e.len() < evil {
        e.push(Role::Minion);
    }
    if g.len() != good || e.len() != evil {
        return Err(EngineError::new(
            ErrorCode::InvalidRoleSet,
            format!(
                "Role set mismatch for {n}p: built {} blue / {} red, expected {good}/{evil} (too many special roles enabled?)",
                g.len(),
                e.len()
            ),
        ));
    }
    g.extend(e);
    Ok(g)
}
pub fn valid_assignment(deck: &[Role], roles: &[Role]) -> bool {
    if deck.len() != roles.len() {
        return false;
    }
    let mut a = deck.to_vec();
    let mut b = roles.to_vec();
    a.sort_unstable();
    b.sort_unstable();
    a == b
}
impl GameState {
    pub fn player(&self, id: &PlayerId) -> Option<&PlayerSlot> {
        self.players.iter().find(|p| &p.id == id)
    }
    pub fn leader(&self) -> Option<&PlayerSlot> {
        self.players.iter().find(|p| p.seat == self.leader_index)
    }
    pub fn leader_id(&self) -> PlayerId {
        self.leader()
            .expect("a validated game has a leader seat")
            .id
            .clone()
    }
    pub fn roles_pending(&self) -> bool {
        self.await_role_acks == Some(true)
            && !self.opening_closed
            && self.phase != Phase::Lobby
            && self.players.iter().any(|p| !self.role_acks.contains(&p.id))
    }
    pub fn can_reroll_opening(&self) -> bool {
        matches!(self.phase, Phase::TeamBuilding | Phase::RoleReveal)
            && !self.opening_closed
            && self.round_index == 0
            && self.rejection_count == 0
            && self.proposed_team.is_none()
            && self.vote_history.is_empty()
            && self.mission_results.is_empty()
            && self.phase_history.as_ref().is_none_or(Vec::is_empty)
            && self.outcome.is_none()
    }
    pub fn can_start_assassination(&self) -> bool {
        self.assassin_id.is_some()
            && self.players.iter().any(|p| p.role == Role::Assassin)
            && !matches!(
                self.phase,
                Phase::Lobby | Phase::Assassination | Phase::GameOver
            )
    }
    pub fn assassination_voters(&self) -> Vec<PlayerId> {
        self.players
            .iter()
            .filter(|p| p.role.is_evil() && p.role != Role::Oberon)
            .map(|p| p.id.clone())
            .collect()
    }
    pub fn ballot(&self) -> Option<&AssassinationBallot> {
        self.early_assassination.as_ref().and_then(Option::as_ref)
    }
    pub fn checkpoint(&self) -> PhaseCheckpoint {
        PhaseCheckpoint {
            phase: self.phase,
            round_index: self.round_index,
            leader_index: self.leader_index,
            rejection_count: self.rejection_count,
            team_changed: self.team_changed,
            proposed_team: self.proposed_team.clone(),
            discussion: self.discussion.clone(),
            votes: self.votes.clone(),
            mission_cards: self.mission_cards.clone(),
            mission_results: self.mission_results.clone(),
            vote_history: self.vote_history.clone(),
            lady_holder_id: self.lady_holder_id.clone(),
            lady_inspected_ids: self.lady_inspected_ids.clone(),
            pending_lady: self.pending_lady,
            last_lady_result: self.last_lady_result.clone(),
            outcome: self.outcome.clone(),
        }
    }
    pub fn restore(&mut self, c: PhaseCheckpoint) {
        self.phase = c.phase;
        self.round_index = c.round_index;
        self.leader_index = c.leader_index;
        self.rejection_count = c.rejection_count;
        self.team_changed = c.team_changed;
        self.proposed_team = c.proposed_team;
        self.discussion = c.discussion;
        self.votes = c.votes;
        self.mission_cards = c.mission_cards;
        self.mission_results = c.mission_results;
        self.vote_history = c.vote_history;
        self.lady_holder_id = c.lady_holder_id;
        self.lady_inspected_ids = c.lady_inspected_ids;
        self.pending_lady = c.pending_lady;
        self.last_lady_result = c.last_lady_result;
        self.outcome = c.outcome;
    }
}
pub fn roles_pending(s: &GameState) -> bool {
    s.roles_pending()
}
pub fn can_reroll_opening(s: &GameState) -> bool {
    s.can_reroll_opening()
}
pub fn can_start_assassination(s: &GameState) -> bool {
    s.can_start_assassination()
}
