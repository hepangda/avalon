//! The default server consumes explicit outcomes. The golden transitions below
//! were produced by the independent TypeScript rules, then only the random
//! results were materialized; JavaScript is not used by these tests at runtime.
use avalon_server::{bots::codec as bots, engine::codec as engine};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
fn input(n: usize) -> Value {
    json!({"hostId":"p0","players":(0..n).map(|i|json!({"id":format!("p{i}"),"name":format!("P{i}")})).collect::<Vec<_>>(),"options":{"percival":true,"morgana":true,"mordred":n>=7,"oberon":false,"ladyOfTheLake":true},"seed":"metadata-only-🧙"})
}
fn lobby() -> Value {
    engine::create_game(&input(7)).unwrap()
}
fn start(s: &Value) -> Value {
    engine::resolve_randomness(
        s,
        &json!({"type":"START_GAME","by":"p0","flowVersion":5}),
        "start-draw",
    )
    .unwrap()
}
fn canonical(v: &Value) -> String {
    fn append(out: &mut String, v: &Value) {
        match v {
            Value::Object(m) => {
                out.push('{');
                let mut keys: Vec<_> = m.keys().collect();
                keys.sort();
                for (i, k) in keys.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&serde_json::to_string(k).unwrap());
                    out.push(':');
                    append(out, &m[*k]);
                }
                out.push('}');
            }
            Value::Array(a) => {
                out.push('[');
                for (i, v) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    append(out, v);
                }
                out.push(']');
            }
            _ => out.push_str(&v.to_string()),
        }
    }
    let mut out = String::new();
    append(&mut out, v);
    out
}
fn hash(v: &Value) -> String {
    format!("{:x}", Sha256::digest(canonical(v).as_bytes()))
}
#[test]
fn all_resolved_rules_and_private_views_match_independent_oracle() {
    let traces: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/resolved-engine-traces.json")).unwrap();
    for trace in traces {
        let name = trace["name"].as_str().unwrap();
        let mut state = engine::create_game(&trace["input"]).unwrap();
        assert_eq!(hash(&state), trace["initial"], "{name}: create");
        let mut viewers: Vec<_> = trace["input"]["players"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["id"].as_str().unwrap().to_owned())
            .collect();
        viewers.push("observer".into());
        for (i, step) in trace["steps"].as_array().unwrap().iter().enumerate() {
            let now = step["now"].as_i64().unwrap();
            let result = engine::reduce_owned(
                state,
                &step["event"],
                now,
                "seed deliberately unrelated to original JS RNG",
            )
            .unwrap_or_else(|(e, _)| panic!("{name} {i}: {e}"));
            assert_eq!(hash(&result.state), step["state"], "{name} {i}: state");
            assert_eq!(
                json!(result.effects),
                step["effects"],
                "{name} {i}: effects"
            );
            state = result.state;
            let views = engine::project_many(&state, &viewers);
            let index = i % viewers.len();
            assert_eq!(
                views[index],
                engine::project(&state, &viewers[index]),
                "{name} {i}: batch/single"
            );
            assert_eq!(
                hash(&Value::Array(views)),
                step["views"],
                "{name} {i}: private projection"
            );
        }
    }
}
#[test]
fn resolved_commands_replay_independently_of_rng_seed() {
    let mut state = lobby();
    let commands = [
        json!({"type":"START_GAME","by":"p0"}),
        json!({"type":"REROLL_ROLES","actor":"referee"}),
        json!({"type":"USE_REROLL_CARD","by":"p2","roleRevision":1}),
        json!({"type":"REROLL_LEADER","actor":"referee"}),
    ];
    for (i, command) in commands.iter().enumerate() {
        let resolved = engine::resolve_randomness(&state, command, &format!("draw{i}")).unwrap();
        assert_eq!(
            resolved,
            engine::resolve_randomness(&state, &resolved, "another seed").unwrap(),
            "already-resolved commands are stable"
        );
        let a = engine::reduce(&state, &resolved, 1234, "seed A").unwrap();
        let b = engine::reduce(&state, &resolved, 1234, "seed B🧙").unwrap();
        assert_eq!(a.state, b.state);
        assert_eq!(a.effects, b.effects);
        if command["type"] != "REROLL_LEADER" {
            assert_eq!(a.state["roleVariants"], resolved["roleVariants"]);
        }
        state = a.state;
    }
    let variants = engine::role_variants(&state);
    state["seed"] = json!("different metadata seed");
    assert_eq!(engine::role_variants(&state), variants);
}
fn rejected_unchanged(state: &Value, event: &Value) {
    let (error, returned) = engine::reduce_owned(state.clone(), event, 99, "ignored").unwrap_err();
    assert_eq!(error.code, "INVALID_RANDOMNESS");
    assert_eq!(returned, *state);
}
#[test]
fn missing_and_corrupt_resolved_results_fail_before_mutation() {
    let state = lobby();
    let valid = start(&state);
    for key in ["assignedRoles", "leaderIndex", "roleVariants", "seatOrder"] {
        let mut event = valid.clone();
        event.as_object_mut().unwrap().remove(key);
        rejected_unchanged(&state, &event);
    }
    for leader in [json!(-1), json!(9000), json!(1.5), json!("1")] {
        let mut event = valid.clone();
        event["leaderIndex"] = leader;
        rejected_unchanged(&state, &event);
    }
    let mut wrong_deck = valid.clone();
    wrong_deck["assignedRoles"][0] = json!("Merlin");
    wrong_deck["assignedRoles"][1] = json!("Merlin");
    rejected_unchanged(&state, &wrong_deck);
    assert!(engine::resolve_randomness(&state, &wrong_deck, "draw").is_err());
    let mut wrong_seats = valid.clone();
    wrong_seats["seatOrder"][0] = json!("unknown");
    rejected_unchanged(&state, &wrong_seats);
    let mut extra = valid.clone();
    extra["roleVariants"]["unrelated-player"] = json!(0);
    rejected_unchanged(&state, &extra);
    let id = valid["roleVariants"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap();
    for value in [json!(-1), json!(10), json!(0.5), json!("0"), Value::Null] {
        let mut event = valid.clone();
        event["roleVariants"][id] = value;
        rejected_unchanged(&state, &event);
    }
    let mut started = engine::reduce(&state, &valid, 1, "ignored").unwrap().state;
    let by = "p2";
    let unchanged = json!({"type":"USE_REROLL_CARD","by":by,"roleRevision":0,"assignedRoles":started["players"].as_array().unwrap().iter().map(|p|p["role"].clone()).collect::<Vec<_>>(),"roleVariants":started["roleVariants"]});
    rejected_unchanged(&started, &unchanged);
    assert!(engine::resolve_randomness(&started, &unchanged, "draw").is_err());
    started["roleVariants"] = json!({});
    rejected_unchanged(&started, &json!({"type":"ACK_ROLE","by":"p0"}));
}
#[test]
fn unsupported_versions_never_downgrade_to_legacy() {
    for version in [json!("legacy"), json!("resolved-v2"), json!(null), json!(1)] {
        let mut state = lobby();
        state["randomnessVersion"] = version;
        rejected_unchanged(&state, &json!({"type":"ACK_ROLE","by":"p0"}));
        assert!(
            engine::resolve_randomness(&state, &json!({"type":"START_GAME","by":"p0"}), "seed")
                .is_err()
        );
    }
    #[cfg(not(feature = "legacy-import"))]
    {
        let mut state = lobby();
        state.as_object_mut().unwrap().remove("randomnessVersion");
        rejected_unchanged(&state, &json!({"type":"ACK_ROLE","by":"p0"}));
    }
}
#[test]
fn native_rng_and_weighted_deals_are_deterministic_and_bounded() {
    for seed in ["", "中文🧙", "seed", "same prefix 1", "same prefix 2"] {
        let mut a = engine::Rng::new(seed);
        let mut b = engine::Rng::new(seed);
        for _ in 0..1000 {
            let x = a.next();
            assert_eq!(x, b.next());
            assert!((0.0..1.0).contains(&x));
        }
    }
    let mut a = engine::Rng::new("different-a");
    let mut b = engine::Rng::new("different-b");
    assert_ne!(a.next(), b.next());
    let s = lobby();
    for i in 0..50 {
        let seed = format!("weighted:{i}");
        let roles = engine::weighted_roles(
            &s["players"],
            &s["config"]["roles"],
            &json!({}),
            &seed,
            Some(("p2", "Merlin")),
        )
        .unwrap();
        assert_eq!(
            roles,
            engine::weighted_roles(
                &s["players"],
                &s["config"]["roles"],
                &json!({}),
                &seed,
                Some(("p2", "Merlin"))
            )
            .unwrap()
        );
        assert_ne!(roles[2], "Merlin");
        let resolved = engine::resolve_randomness(
            &s,
            &json!({"type":"START_GAME","by":"p0","assignedRoles":roles}),
            &seed,
        )
        .unwrap();
        assert!(engine::reduce(&s, &resolved, 1, "ignored").is_ok());
    }
}
#[test]
fn resolved_role_art_remains_private_and_only_comes_from_saved_results() {
    let state = lobby();
    let event = start(&state);
    let state = engine::reduce(&state, &event, 1, "ignored").unwrap().state;
    let observer = engine::project(&state, "observer");
    assert!(observer.get("seed").is_none());
    assert!(observer.get("roleVariants").is_none());
    assert!(
        observer["players"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p.get("role").is_none() && p.get("roleVariant").is_none())
    );
    for p in state["players"].as_array().unwrap() {
        let id = p["id"].as_str().unwrap();
        let view = engine::project(&state, id);
        for visible in view["players"].as_array().unwrap() {
            if visible["id"] != id {
                assert!(visible.get("roleVariant").is_none());
            } else {
                assert_eq!(visible.get("roleVariant"), state["roleVariants"].get(id));
            }
        }
    }
}
#[test]
fn native_bots_finish_games_with_legal_actions() {
    for n in 5..=10 {
        for sample in 0..2 {
            let mut state = engine::create_game(&input(n)).unwrap();
            let seed = format!("native-match:{n}:{sample}");
            let event = engine::resolve_randomness(
                &state,
                &json!({"type":"START_GAME","by":"p0","flowVersion":5}),
                &seed,
            )
            .unwrap();
            state = engine::reduce_owned(state, &event, 1, "ignored")
                .unwrap()
                .state;
            for step in 0..900 {
                if state["phase"] == "GameOver" {
                    break;
                }
                let timer = &state["actionTimers"][0];
                let by = timer["playerId"].as_str().expect("pending bot action");
                let action = timer["action"].as_str().unwrap();
                let event = bots::decide(
                    &engine::project(&state, by),
                    by,
                    action,
                    &format!("{seed}:{step}"),
                )
                .unwrap();
                state = engine::reduce_owned(state, &event, 2 + step, "ignored")
                    .unwrap_or_else(|(e, _)| panic!("{seed} {step}: {e}"))
                    .state;
            }
            assert_eq!(state["phase"], "GameOver", "{seed}");
            assert!(state["outcome"].is_object());
        }
    }
}
