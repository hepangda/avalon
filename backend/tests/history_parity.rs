mod support;
use avalon_server::{history::RecordBook, replay};
use serde_json::{Value, json};
use support::ratings;
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/history.json")).unwrap()
}
fn close(a: &Value, b: &Value, path: &str) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => assert!(
            (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-8,
            "{path}: {a} != {b}"
        ),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                close(a, b, &format!("{path}/{i}"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (k, v) in a {
                close(v, &b[k], &format!("{path}/{k}"));
            }
        }
        _ => assert_eq!(a, b, "{path}"),
    }
}
#[test]
fn exact_rating_model_matches_typescript() {
    let data = fixture();
    let records = data["records"].as_array().unwrap();
    for policy in data["policies"].as_array().unwrap() {
        let bots = policy["includeBots"].as_bool().unwrap();
        let fit = ratings::fit(records, bots).unwrap();
        assert_eq!(json!(fit.configs), policy["fit"]["configs"]);
        assert_eq!(json!(fit.accounts), policy["fit"]["accounts"]);
        assert_eq!(
            json!(
                records
                    .iter()
                    .map(|g| ratings::exclusion(g, bots))
                    .collect::<Vec<_>>()
            ),
            policy["exclusions"]
        );
        close(
            &json!(fit.parameters),
            &policy["fit"]["parameters"],
            "parameters",
        );
        close(
            &json!(fit.covariance),
            &policy["fit"]["covariance"],
            "covariance",
        );
        assert_eq!(json!(fit.accounts), policy["fit"]["accounts"]);
        assert_eq!(json!(fit.configs), policy["fit"]["configs"]);
        for (account, player) in fit.players {
            let expected = &policy["fit"]["players"][&account];
            close(
                &json!({"hidden":player.hidden,"sd":player.sd,"games":player.games,"lastPlayed":player.last_played}),
                expected,
                &account,
            );
            close(
                &ratings::public(Some(&player), 100000),
                &policy["public"][&account],
                "public",
            );
        }
    }
}
#[test]
fn profile_privacy_prefix_deltas_and_pagination_match_typescript() {
    let data = fixture();
    for policy in data["policies"].as_array().unwrap() {
        let mut book = RecordBook::from_json(
            data["records"].as_array().unwrap().clone(),
            policy["includeBots"].as_bool().unwrap(),
        )
        .unwrap();
        for expected in policy["profiles"].as_array().unwrap() {
            let account = expected["account"].as_str().unwrap();
            close(
                &book.profile(account).unwrap(),
                &expected["profile"],
                "profile",
            );
            close(
                &book.games_page(account, 0).unwrap(),
                &expected["games"],
                "games",
            );
            close(
                &book.games_page(account, 30).unwrap(),
                &expected["next"],
                "next",
            );
            close(
                &book.seat_record(account, false).unwrap(),
                &expected["visible"],
                "seat",
            );
            close(
                &book.seat_record(account, true).unwrap(),
                &expected["hidden"],
                "hidden",
            );
        }
    }
}
#[test]
fn completed_replay_matches_typescript() {
    let v: Value = serde_json::from_str(include_str!("fixtures/replay.json")).unwrap();
    let actual = support::replay::build(
        v["gameId"].as_str().unwrap(),
        v["seed"].as_str().unwrap(),
        &v["options"],
        &v["players"],
        v["resolvedEvents"].as_array().unwrap(),
    )
    .unwrap();
    assert_eq!(actual, replay::migrate_archive(&v["expected"]).unwrap());
}

#[test]
fn referee_rewind_replay_matches_typescript() {
    let v: Value = serde_json::from_str(include_str!("fixtures/replay-rewind.json")).unwrap();
    let actual = support::replay::build(
        v["gameId"].as_str().unwrap(),
        v["seed"].as_str().unwrap(),
        &v["options"],
        &v["players"],
        v["resolvedEvents"].as_array().unwrap(),
    )
    .unwrap();
    assert_eq!(actual, replay::migrate_archive(&v["expected"]).unwrap());
}

#[test]
fn materialized_archive_conversion_preserves_all_known_and_unknown_metadata() {
    let original = fixture();
    for record in original["records"].as_array().unwrap() {
        let before = &record["replay"];
        let mut migrated = replay::migrate_archive(before).unwrap();
        assert_eq!(migrated["formatVersion"], 2);
        assert_eq!(replay::migrate_archive(&migrated).unwrap(), migrated);
        migrated.as_object_mut().unwrap().remove("formatVersion");
        assert_eq!(migrated, *before);
    }
    let mut missing = original["records"][0]["replay"].clone();
    for key in ["options", "log", "startedAt", "endedAt", "roleAssignments"] {
        missing.as_object_mut().unwrap().remove(key);
    }
    let migrated = replay::migrate_archive(&missing).unwrap();
    for key in ["options", "log", "startedAt", "endedAt", "roleAssignments"] {
        assert!(migrated.get(key).is_none(), "invented {key}");
    }
    let mut versioned = missing.clone();
    versioned["formatVersion"] = json!(1);
    assert_eq!(replay::migrate_archive(&versioned).unwrap(), migrated);
    for version in [json!(0), json!(3), json!(null), json!("2")] {
        versioned["formatVersion"] = version;
        assert!(replay::migrate_archive(&versioned).is_err());
    }
    missing["outcome"] = Value::Null;
    assert!(replay::migrate_archive(&missing).is_err());
}

#[test]
fn converted_archives_preserve_ratings_profiles_and_pagination() {
    let data = fixture();
    let records = data["records"].as_array().unwrap();
    let converted: Vec<Value> = records
        .iter()
        .map(|r| {
            let mut r = r.clone();
            r["replay"] = replay::migrate_archive(&r["replay"]).unwrap();
            r
        })
        .collect();
    for policy in data["policies"].as_array().unwrap() {
        let bots = policy["includeBots"].as_bool().unwrap();
        let a = ratings::fit(records, bots).unwrap();
        let b = ratings::fit(&converted, bots).unwrap();
        assert_eq!(a.parameters, b.parameters);
        assert_eq!(a.covariance, b.covariance);
        let mut book = RecordBook::from_json(converted.clone(), bots).unwrap();
        for expected in policy["profiles"].as_array().unwrap() {
            let account = expected["account"].as_str().unwrap();
            close(
                &book.profile(account).unwrap(),
                &expected["profile"],
                "converted profile",
            );
            close(
                &book.games_page(account, 0).unwrap(),
                &expected["games"],
                "converted games",
            );
            close(
                &book.games_page(account, 30).unwrap(),
                &expected["next"],
                "converted next",
            );
        }
    }
}

#[test]
fn production_replay_rejects_unresolved_randomness() {
    let v: Value = serde_json::from_str(include_str!("fixtures/replay.json")).unwrap();
    assert!(
        support::replay::build(
            v["gameId"].as_str().unwrap(),
            v["seed"].as_str().unwrap(),
            &v["options"],
            &v["players"],
            v["events"].as_array().unwrap()
        )
        .is_err()
    );
    let events = v["resolvedEvents"].as_array().unwrap();
    assert!(
        support::replay::build(
            v["gameId"].as_str().unwrap(),
            v["seed"].as_str().unwrap(),
            &v["options"],
            &v["players"],
            &events[..1]
        )
        .is_err(),
        "unfinished game fabricated an archive"
    );
}
