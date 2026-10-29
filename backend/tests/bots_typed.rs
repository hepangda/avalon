//! The live bot path consumes typed authorized views and returns typed commands.
//! No JSON conversion is needed while playing these games.
use avalon_server::{
    bots,
    engine::typed::{self, CreateGame, GameEvent, GameOptions, InitialPlayer, Phase, PlayerId},
};

fn create(count: usize, seed: &str) -> typed::GameState {
    let input = CreateGame {
        host_id: PlayerId::from("p0"),
        players: (0..count)
            .map(|i| InitialPlayer {
                id: PlayerId(format!("p{i}")),
                name: format!("Player {i}"),
            })
            .collect(),
        options: GameOptions {
            oberon: false,
            mordred: count >= 7,
            morgana: true,
            percival: true,
            lady_of_the_lake: true,
            max_rejections: Some(5.0),
            speech_seconds: Some(120.0),
        },
        seed: seed.into(),
    };
    let state = typed::create_game(input).unwrap();
    let start = GameEvent::StartGame {
        by: PlayerId::from("p0"),
        flow_version: Some(5),
        assigned_roles: None,
        await_role_acks: Some(true),
        leader_index: None,
        role_variants: None,
        seat_order: None,
    };
    let event = typed::resolve_randomness(&state, &start, seed).unwrap();
    typed::apply_owned(state, &event, 0).unwrap().state
}

#[test]
fn native_bots_play_typed_games_without_a_json_round_trip() {
    for count in 5..=10 {
        for trial in 0..2 {
            let seed = format!("native-typed:{count}:{trial}");
            let mut state = create(count, &seed);
            for step in 1..1000 {
                if state.phase == Phase::GameOver {
                    break;
                }
                let timer = state
                    .action_timers
                    .first()
                    .expect("unfinished game has a pending action")
                    .clone();
                let view = typed::project(&state, &timer.player_id);
                let event = bots::decide_typed(
                    &view,
                    &timer.player_id,
                    timer.action,
                    &format!("{seed}:bot:{step}"),
                )
                .unwrap();
                let detailed = bots::decide_detailed(
                    &view,
                    &timer.player_id,
                    timer.action,
                    &format!("{seed}:bot:{step}"),
                )
                .unwrap();
                assert_eq!(
                    event, detailed.event,
                    "diagnostics must not change the random draw order"
                );
                let event =
                    typed::resolve_randomness(&state, &event, &format!("{seed}:{step}")).unwrap();
                state = typed::apply_owned(state, &event, step)
                    .unwrap_or_else(|(error, _)| panic!("{seed} step{step}: {error}"))
                    .state;
            }
            assert_eq!(state.phase, Phase::GameOver, "{seed}");
        }
    }
}

#[test]
fn bot_boundary_rejects_spectator_or_inconsistent_roster() {
    let state = create(5, "boundary");
    let mut view = typed::project(&state, &PlayerId::from("observer"));
    assert!(matches!(
        bots::decide_typed(
            &view,
            &PlayerId::from("p0"),
            typed::ActionKind::Propose,
            "seed"
        ),
        Err(bots::BotError::NotSeated)
    ));
    view.players[1].id = view.players[0].id.clone();
    assert!(matches!(
        bots::decide_typed(
            &view,
            &PlayerId::from("p0"),
            typed::ActionKind::Propose,
            "seed"
        ),
        Err(bots::BotError::InvalidRoster)
    ));
}
