//! Native callers retain domain values across transitions; JSON is not involved
//! in command execution or player projection.
use avalon_server::engine::*;

fn lobby() -> GameState {
    create_game(CreateGame {
        host_id: "p0".into(),
        players: (0..5)
            .map(|i| InitialPlayer {
                id: format!("p{i}").into(),
                name: format!("Player {i}"),
            })
            .collect(),
        options: GameOptions {
            morgana: true,
            percival: true,
            ..Default::default()
        },
        seed: "private-seed".into(),
    })
    .unwrap()
}
fn started() -> GameState {
    let s = lobby();
    let event = resolve_randomness(
        &s,
        &GameEvent::StartGame {
            by: "p0".into(),
            flow_version: Some(5),
            assigned_roles: None,
            await_role_acks: Some(true),
            leader_index: None,
            role_variants: None,
            seat_order: None,
        },
        "resolved-once",
    )
    .unwrap();
    apply_owned(s, &event, 1000).unwrap().state
}
#[test]
fn native_commands_retain_state_and_permissions() {
    let mut s = started();
    for id in s.players.iter().map(|p| p.id.clone()).collect::<Vec<_>>() {
        s = apply_owned(
            s,
            &GameEvent::AckRole {
                by: id,
                role_revision: Some(0),
            },
            1100,
        )
        .unwrap()
        .state;
    }
    assert!(!s.roles_pending());
    let spectator = project(&s, &PlayerId::from("spectator"));
    assert!(spectator.is_spectator);
    assert!(spectator.self_role.is_none());
    assert!(spectator.players.iter().all(|p| p.role.is_none()));
    let leader = s.leader_id();
    let team = s.players.iter().take(2).map(|p| p.id.clone()).collect();
    s = apply_owned(
        s,
        &GameEvent::ProposeTeam {
            by: leader,
            team,
            admin: None,
        },
        1200,
    )
    .unwrap()
    .state;
    assert_eq!(s.phase, Phase::TeamAnnouncement);
}
#[test]
fn rejected_native_command_returns_exact_state() {
    let s = started();
    let before = s.clone();
    let (error, returned) = apply_owned(
        s,
        &GameEvent::CastVote {
            by: "p0".into(),
            value: Vote::Approve,
            admin: None,
        },
        1001,
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::RolesPending);
    assert_eq!(returned, before);
}
#[test]
fn closed_enums_reject_invalid_boundary_values() {
    assert!(serde_json::from_str::<Role>("\"Merln\"").is_err());
    assert!(serde_json::from_str::<Phase>("\"MissionVoting\"").is_err());
    assert!(
        serde_json::from_str::<GameEvent>(r#"{"type":"CAST_VOTE","by":"p0","value":"maybe"}"#)
            .is_err()
    );
    assert!(serde_json::from_str::<GameEvent>(r#"{"type":"ASSASSINATE","by":"p0"}"#).is_err());
    assert_eq!(Role::Merlin.team(), Team::Good);
    assert_eq!(Role::Assassin.team(), Team::Evil);
}
#[test]
fn typed_serialization_preserves_missing_and_explicit_null() {
    let mut s = lobby();
    assert!(
        !serde_json::to_value(&s)
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("earlyAssassination")
    );
    s.early_assassination = Some(None);
    let wire = serde_json::to_value(&s).unwrap();
    assert!(wire["earlyAssassination"].is_null());
    let restored: GameState = serde_json::from_value(wire).unwrap();
    assert_eq!(restored, s);
}
