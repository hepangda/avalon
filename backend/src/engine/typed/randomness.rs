use super::*;
use GameEvent as G;
use std::collections::BTreeMap;
fn invalid(message: &str) -> EngineError {
    EngineError::new(ErrorCode::InvalidRandomness, message)
}
fn valid_variants(players: &[PlayerSlot], roles: &[Role], variants: &RoleVariants) -> bool {
    let expected = roles
        .iter()
        .filter(|r| matches!(r, Role::LoyalServant | Role::Minion))
        .count();
    variants.len() == expected
        && players.iter().zip(roles).all(|(p, r)| match r {
            Role::LoyalServant => variants.get(&p.id).is_some_and(|n| *n < 5),
            Role::Minion => variants.get(&p.id).is_some_and(|n| *n < 2),
            _ => !variants.contains_key(&p.id),
        })
}
pub(crate) fn validate(s: &GameState, e: &GameEvent, legacy: bool) -> Result<()> {
    if s.randomness_version != Some(RandomnessVersion::ResolvedV1) {
        if legacy && s.randomness_version.is_none() {
            return Ok(());
        }
        return Err(invalid("Missing or unsupported randomness version"));
    }
    let current_roles: Vec<_> = s.players.iter().map(|p| p.role).collect();
    if s.phase != Phase::Lobby
        && !s
            .role_variants
            .as_ref()
            .is_some_and(|v| valid_variants(&s.players, &current_roles, v))
    {
        return Err(invalid("Invalid persisted role variants"));
    }
    if let G::StartGame { seat_order, .. } = e {
        let mut players: Vec<_> = s.players.iter().collect();
        players.sort_by_key(|p| p.seat);
        let expected: Vec<_> = players.iter().map(|p| p.id.clone()).collect();
        if seat_order.as_ref() != Some(&expected) {
            return Err(invalid("Resolved seatOrder must match the bootstrap seats"));
        }
    }
    if let G::StartGame { leader_index, .. } | G::RerollLeader { leader_index, .. } = e
        && !leader_index.is_some_and(|seat| s.players.iter().any(|p| p.seat == seat))
    {
        return Err(invalid(
            "Resolved leaderIndex is required and must name a seat",
        ));
    }
    if let G::StartGame {
        assigned_roles,
        role_variants,
        ..
    }
    | G::RerollRoles {
        assigned_roles,
        role_variants,
        ..
    }
    | G::UseRerollCard {
        assigned_roles,
        role_variants,
        ..
    } = e
    {
        let roles = assigned_roles
            .as_ref()
            .filter(|r| valid_assignment(&s.config.roles, r))
            .ok_or_else(|| invalid("Resolved assignedRoles must match the configured deck"))?;
        if !role_variants
            .as_ref()
            .is_some_and(|v| valid_variants(&s.players, roles, v))
        {
            return Err(invalid(
                "Resolved roleVariants must cover exactly the variant roles",
            ));
        }
        if let G::UseRerollCard { by, .. } = e {
            let index = s
                .players
                .iter()
                .position(|p| &p.id == by)
                .ok_or_else(|| EngineError::new(ErrorCode::UnknownPlayer, "Unknown player"))?;
            if roles[index] == s.players[index].role {
                return Err(invalid(
                    "Resolved reroll must change the requesting player's role",
                ));
            }
        }
    }
    Ok(())
}
fn variants(players: &[PlayerSlot], roles: &[Role], seed: &str) -> RoleVariants {
    let mut out = RoleVariants::new();
    for (role, count) in [(Role::LoyalServant, 5u8), (Role::Minion, 2u8)] {
        let mut rng = Rng::new(&format!("{seed}:resolved-role-art:{role}"));
        let mut selected: Vec<_> = players
            .iter()
            .zip(roles)
            .filter(|(_, r)| **r == role)
            .map(|(p, _)| p)
            .collect();
        selected.sort_by_key(|p| p.seat);
        rng.shuffle(&mut selected);
        let mut choices: Vec<_> = (0..count).collect();
        rng.shuffle(&mut choices);
        for (i, p) in selected.iter().enumerate() {
            out.insert(p.id.clone(), choices[i % count as usize]);
        }
    }
    out
}
pub fn resolve_randomness(s: &GameState, event: &GameEvent, seed: &str) -> Result<GameEvent> {
    if s.randomness_version != Some(RandomnessVersion::ResolvedV1) {
        return Err(invalid(
            "Legacy states must be imported before live commands",
        ));
    }
    let mut event = event.clone();
    let mut rng = Rng::new(seed);
    let by = if let G::UseRerollCard { by, .. } = &event {
        Some(by.clone())
    } else {
        None
    };
    if let G::StartGame {
        assigned_roles,
        role_variants,
        ..
    }
    | G::RerollRoles {
        assigned_roles,
        role_variants,
        ..
    }
    | G::UseRerollCard {
        assigned_roles,
        role_variants,
        ..
    } = &mut event
    {
        if let Some(roles) = assigned_roles {
            if !valid_assignment(&s.config.roles, roles) {
                return Err(invalid(
                    "Supplied assignedRoles do not match the configured deck",
                ));
            }
        } else {
            let mut roles = s.config.roles.clone();
            if let Some(by) = &by {
                let index =
                    s.players.iter().position(|p| &p.id == by).ok_or_else(|| {
                        EngineError::new(ErrorCode::UnknownPlayer, "Unknown player")
                    })?;
                let old = s.players[index].role;
                let alternatives: Vec<_> = roles.iter().filter(|r| **r != old).copied().collect();
                if alternatives.is_empty() {
                    return Err(EngineError::new(
                        ErrorCode::InvalidRoleSet,
                        "No different identity available",
                    ));
                }
                let role = alternatives[(rng.next() * alternatives.len() as f64).floor() as usize];
                roles.remove(roles.iter().position(|r| *r == role).unwrap());
                rng.shuffle(&mut roles);
                roles.insert(index, role);
            } else {
                rng.shuffle(&mut roles);
            }
            *assigned_roles = Some(roles);
        }
        if role_variants.is_none() {
            *role_variants = Some(variants(&s.players, assigned_roles.as_ref().unwrap(), seed));
        }
    }
    if let G::StartGame { leader_index, .. } | G::RerollLeader { leader_index, .. } = &mut event
        && leader_index.is_none()
    {
        if s.players.is_empty() {
            return Err(invalid("Cannot choose a leader without seats"));
        }
        *leader_index =
            Some(s.players[(rng.next() * s.players.len() as f64).floor() as usize].seat);
    }
    if let G::StartGame { seat_order, .. } = &mut event
        && seat_order.is_none()
    {
        let mut p: Vec<_> = s.players.iter().collect();
        p.sort_by_key(|p| p.seat);
        *seat_order = Some(p.iter().map(|p| p.id.clone()).collect());
    }
    validate(s, &event, false)?;
    Ok(event)
}
pub fn weighted_roles(
    players: &[PlayerSlot],
    deck: &[Role],
    weights: &BTreeMap<PlayerId, RoleWeights>,
    seed: &str,
    excluded: Option<(&PlayerId, Role)>,
) -> Option<Vec<Role>> {
    let mut rng = Rng::new(seed);
    weighted_with_rng(players, deck, weights, &mut rng, excluded)
}
pub(crate) fn weighted_with_rng(
    players: &[PlayerSlot],
    deck: &[Role],
    weights: &BTreeMap<PlayerId, RoleWeights>,
    rng: &mut Rng,
    excluded: Option<(&PlayerId, Role)>,
) -> Option<Vec<Role>> {
    let n = deck.len();
    if players.len() != n || n > 10 {
        return None;
    }
    let mut matrix = [[f64::NEG_INFINITY; 10]; 10];
    for (p, player) in players.iter().enumerate() {
        for (i, role) in deck.iter().enumerate() {
            if excluded == Some((&player.id, *role)) {
                continue;
            }
            let w = weights
                .get(&player.id)
                .and_then(|w| w.get(role))
                .copied()
                .filter(|w| w.is_finite() && *w > 0.)
                .map(|w| w.max(50.))
                .unwrap_or(100.);
            matrix[p][i] = w.ln();
        }
    }
    fn total(
        used: usize,
        p: usize,
        n: usize,
        m: &[[f64; 10]; 10],
        memo: &mut [Option<f64>; 1024],
    ) -> f64 {
        if used == (1 << n) - 1 {
            return 0.;
        }
        if let Some(v) = memo[used] {
            return v;
        }
        let mut branches = [f64::NEG_INFINITY; 10];
        for i in 0..n {
            if used & (1 << i) == 0 {
                branches[i] = m[p][i] + total(used | (1 << i), p + 1, n, m, memo);
            }
        }
        let max = branches[..n]
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        let r = if max == f64::NEG_INFINITY {
            max
        } else {
            max + branches[..n]
                .iter()
                .map(|v| (v - max).exp())
                .sum::<f64>()
                .ln()
        };
        memo[used] = Some(r);
        r
    }
    let mut memo = [None; 1024];
    if !total(0, 0, n, &matrix, &mut memo).is_finite() {
        return None;
    }
    let mut out = Vec::with_capacity(n);
    let mut used = 0;
    for p in 0..n {
        let mut branches = [f64::NEG_INFINITY; 10];
        for i in 0..n {
            if used & (1 << i) == 0 {
                branches[i] = matrix[p][i] + total(used | (1 << i), p + 1, n, &matrix, &mut memo);
            }
        }
        let max = branches[..n]
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        let masses = branches.map(|v| (v - max).exp());
        let mut ticket = rng.next() * masses[..n].iter().sum::<f64>();
        let mut selected = None;
        for (i, mass) in masses[..n].iter().copied().enumerate() {
            if mass == 0. {
                continue;
            }
            selected = Some(i);
            if ticket < mass {
                break;
            }
            ticket -= mass;
        }
        let i = selected?;
        out.push(deck[i]);
        used |= 1 << i;
    }
    Some(out)
}
