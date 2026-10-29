use super::protocol::Command;
use super::{
    domain::{Binding, Draft},
    helpers,
};
use serde_json::{Value, json};
trait FixtureCommands {
    fn act(&mut self, id: &str, event: &str, p: &Value) -> Value;
}
impl FixtureCommands for Draft {
    fn act(&mut self, id: &str, event: &str, p: &Value) -> Value {
        let result = match Command::decode(event, p.clone()) {
            Ok(c) => self.dispatch(&id.into(), &c),
            Err(e) => e.into(),
        };
        serde_json::to_value(result).unwrap()
    }
}
use std::collections::BTreeMap;

fn room() -> Draft {
    let members:Vec<_>=(0..5).map(|i|json!({"id":format!("p{i}"),"name":format!("Player{i}"),"seat":i,"claimed":true,"connected":true,"isSpectator":false})).collect();
    let accounts: serde_json::Map<String, Value> = (0..5)
        .map(|i| (format!("p{i}"), json!(format!("account{i}"))))
        .collect();
    let sessions: serde_json::Map<String, Value> = (0..5)
        .map(|i| (format!("p{i}"), json!(format!("token{i}"))))
        .collect();
    let bindings: BTreeMap<_, _> = (0..5)
        .map(|i| {
            (
                format!("socket{i}").into(),
                Binding {
                    account: format!("account{i}").into(),
                    player: Some(format!("p{i}").into()),
                    host: i == 0,
                    ..Default::default()
                },
            )
        })
        .chain(std::iter::once((
            "spectator".into(),
            Binding {
                account: "observer".into(),
                ..Default::default()
            },
        )))
        .collect();
    let doc = json!({"schemaVersion":1,"meta":{"code":"1234","name":"","visibility":"private","hostToken":"host-token","hostAccount":"account0","status":"lobby","config":config_fixture(&json!({"useRecommended":true}),json!(["Seat 1","Seat 2","Seat 3","Seat 4","Seat 5"]),true),"gameId":null,"seed":null},"members":members,"game":null,"events":[],"eventSeq":0,"sessions":sessions,"notes":{},"accounts":accounts,"gameAccounts":{},"lastGameSeats":{"byPlayer":{},"byAccount":{}},"archive":null});
    Draft::new(
        Some(serde_json::from_value(doc).unwrap()),
        bindings,
        1_000_000,
    )
}
fn code(v: &Value) -> &str {
    v["error"]["code"].as_str().unwrap_or("")
}
fn success(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v
}
fn member(d: &Draft, id: &str) -> Value {
    serde_json::to_value(d.doc.as_ref().unwrap().member(&id.into()).unwrap()).unwrap()
}

#[test]
fn account_takeover_ignores_forged_local_tokens_and_retires_old_socket() {
    let mut d = room();
    d.bindings.insert(
        "replacement".into(),
        Binding {
            account: "account0".into(),
            ..Default::default()
        },
    );
    let joined = success(d.act(
        "replacement",
        "room:join",
        &json!({"playerId":"p1","playerToken":"token1","hostToken":"wrong"}),
    ));
    assert_eq!(joined["data"]["playerId"], "p0");
    assert_eq!(joined["data"]["isHost"], true);
    assert!(d.retire.contains("socket0"));
    assert!(d.bindings["socket0"].retired);
    assert_eq!(
        code(&d.act("socket0", "room:releaseSeat", &json!({}))),
        "RECONNECT"
    );
    d.disconnect(&"socket0".into());
    assert_eq!(member(&d, "p0")["connected"], true);
    assert_eq!(
        serde_json::to_value(d.doc.as_ref().unwrap()).unwrap()["accounts"]["p0"],
        "account0"
    );
}
#[test]
fn other_account_cannot_use_saved_seat_or_host_token() {
    let mut d = room();
    let joined = success(d.act(
        "spectator",
        "room:join",
        &json!({"playerId":"p0","playerToken":"token0","hostToken":"host-token"}),
    ));
    assert!(joined["data"]["playerId"].is_null());
    assert_eq!(joined["data"]["isHost"], false);
    assert_eq!(
        code(&d.act(
            "spectator",
            "room:details",
            &json!({"name":"stolen","visibility":"public"})
        )),
        "NOT_HOST"
    );
}
#[test]
fn manual_transfer_preserves_seats_and_rotates_host_authority() {
    let mut d = room();
    let before = serde_json::to_value(&d.doc).unwrap();
    success(d.act(
        "socket0",
        "room:transferHost",
        &json!({"targetPlayerId":"p2"}),
    ));
    let doc = serde_json::to_value(d.doc.as_ref().unwrap()).unwrap();
    assert_eq!(doc["meta"]["hostAccount"], "account2");
    assert_ne!(doc["meta"]["hostToken"], before["meta"]["hostToken"]);
    assert_eq!(doc["members"], before["members"]);
    assert_eq!(doc["sessions"], before["sessions"]);
    assert!(!d.bindings["socket0"].host);
    assert!(d.bindings["socket2"].host);
    assert_eq!(
        code(&d.act(
            "socket0",
            "room:transferHost",
            &json!({"targetPlayerId":"p1"})
        )),
        "NOT_HOST"
    );
}
#[test]
fn host_departure_immediately_hands_over_but_transport_disconnect_has_grace() {
    let mut d = room();
    success(d.act("socket0", "room:leave", &json!({})));
    d.reconcile();
    assert_eq!(
        serde_json::to_value(d.doc.as_ref().unwrap()).unwrap()["meta"]["hostAccount"],
        "account1"
    );
    assert_eq!(member(&d, "p0")["name"], "Seat 1");
    assert_eq!(member(&d, "p0")["claimed"], false);
    let mut d = room();
    d.disconnect(&"socket0".into());
    d.reconcile();
    let since = serde_json::to_value(d.doc.as_ref().unwrap()).unwrap()["meta"]["hostOfflineSince"]
        .as_i64()
        .unwrap();
    d.now = since + 299_999;
    d.reconcile();
    assert_eq!(
        serde_json::to_value(d.doc.as_ref().unwrap()).unwrap()["meta"]["hostAccount"],
        "account0"
    );
    d.now += 1;
    d.reconcile();
    assert_eq!(
        serde_json::to_value(d.doc.as_ref().unwrap()).unwrap()["meta"]["hostAccount"],
        "account1"
    );
    assert_eq!(member(&d, "p0")["claimed"], true);
}
#[test]
fn seated_account_may_move_but_cannot_claim_two_seats() {
    let mut d = room();
    success(d.act("socket1", "room:releaseSeat", &json!({})));
    success(d.act(
        "socket0",
        "room:claimSeat",
        &json!({"seatId":"p1","name":"Moved"}),
    ));
    assert_eq!(
        d.bindings["socket0"].player.as_ref().map(AsRef::as_ref),
        Some("p1")
    );
    assert_eq!(member(&d, "p0")["claimed"], false);
    assert_eq!(member(&d, "p0")["name"], "Seat 1");
    assert!(serde_json::to_value(d.doc.as_ref().unwrap()).unwrap()["sessions"]["p0"].is_null());
    d.bindings.insert(
        "second".into(),
        Binding {
            account: "account0".into(),
            ..Default::default()
        },
    );
    assert_eq!(
        code(&d.act(
            "second",
            "room:claimSeat",
            &json!({"seatId":"p0","name":"Duplicate"})
        )),
        "ALREADY_SEATED"
    );
}
#[test]
fn lobby_bounds_and_bot_identity_are_enforced() {
    let mut d = room();
    assert_eq!(
        code(&d.act("spectator", "room:addBot", &json!({}))),
        "NOT_HOST"
    );
    assert_eq!(
        code(&d.act("socket0", "room:removeSeat", &json!({"seatId":"p1"}))),
        "SEAT_CLAIMED"
    );
    success(d.act("socket1", "room:releaseSeat", &json!({})));
    success(d.act("socket0", "room:addBot", &json!({})));
    assert_eq!(member(&d, "p1")["isBot"], true);
    assert_eq!(member(&d, "p1")["name"], "Bot 1");
    assert!(serde_json::to_value(d.doc.as_ref().unwrap()).unwrap()["accounts"]["p1"].is_null());
    for _ in 0..5 {
        success(d.act("socket0", "room:addBot", &json!({})));
    }
    assert_eq!(
        code(&d.act("socket0", "room:addBot", &json!({}))),
        "ROOM_FULL"
    );
}
#[test]
fn private_notes_use_scoped_optimistic_concurrency_without_game_events() {
    let mut d = room();
    success(d.act("socket0", "room:start", &json!({})));
    let doc = serde_json::to_value(d.doc.as_ref().unwrap()).unwrap();
    let scope = json!({"gameId":doc["meta"]["gameId"],"roleRevision":doc["game"]["roleRevision"],"playerId":"p0"});
    let events = doc["events"].clone();
    let mut update = scope.clone();
    update["update"] =
        json!({"baseRevision":0,"enabled":false,"notes":{"p1":"Merlin","p2":"percival-claim"}});
    let saved = success(d.act("socket0", "notes:sync", &update));
    assert_eq!(saved["data"]["revision"], 1);
    assert_eq!(
        serde_json::to_value(d.doc.as_ref().unwrap()).unwrap()["events"],
        events
    );
    let conflict = d.act("socket0", "notes:sync", &update);
    assert_eq!(code(&conflict), "NOTES_CONFLICT");
    assert_eq!(conflict["data"], saved["data"]);
    assert_eq!(
        success(d.act("socket0", "notes:sync", &scope))["data"],
        saved["data"]
    );
    assert_eq!(
        code(&d.act("socket1", "notes:sync", &scope)),
        "STALE_NOTES_SCOPE"
    );
    assert_eq!(
        code(&d.act("spectator", "notes:sync", &scope)),
        "NOT_SEATED"
    );
    success(d.act("socket0", "room:releaseSeat", &json!({})));
    assert_eq!(code(&d.act("socket0", "notes:sync", &scope)), "NOT_SEATED");
    assert_eq!(
        code(&d.act(
            "spectator",
            "room:claimSeat",
            &json!({"seatId":"p0","name":"Thief"})
        )),
        "WRONG_PHASE"
    );
}
#[test]
fn config_timers_preserve_continuous_clamped_values() {
    assert_eq!(
        options_fixture(&json!({"speechSeconds":450.9,"maxRejections":0}))["speechSeconds"],
        450
    );
    assert_eq!(
        options_fixture(&json!({"maxRejections":0}))["maxRejections"],
        1
    );
    assert_eq!(
        options_fixture(&json!({"speechSeconds":9999}))["speechSeconds"],
        600
    );
    assert_eq!(
        config_fixture(&json!({}), json!([]), false)["options"]["morgana"],
        false
    );
}

fn options_fixture(value: &Value) -> Value {
    config_fixture(&json!({"options":value}), json!([]), false)["options"].clone()
}

fn config_fixture(raw: &Value, roster: Value, initial: bool) -> Value {
    serde_json::to_value(helpers::make_config(
        &serde_json::from_value(raw.clone()).unwrap(),
        serde_json::from_value(roster).unwrap(),
        initial,
    ))
    .unwrap()
}

#[test]
fn explicitly_empty_seat_history_survives_recovery() {
    let mut draft = room();
    let document = draft.doc.as_mut().unwrap();
    assert!(
        document
            .last_game_seats
            .as_ref()
            .unwrap()
            .by_player
            .is_empty()
    );
    document.normalize_after_load();
    assert!(
        document
            .last_game_seats
            .as_ref()
            .unwrap()
            .by_player
            .is_empty(),
        "the first game after a restart must not be treated as a rematch"
    );
    document.last_game_seats = None;
    document.normalize_after_load();
    assert_eq!(
        document.last_game_seats.as_ref().unwrap().by_player.len(),
        5,
        "only missing legacy history is reconstructed"
    );
}
