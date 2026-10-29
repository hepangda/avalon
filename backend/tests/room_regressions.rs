//! Legacy snapshots preserve Map insertion order, which differs from randomized seat order.
use avalon_server::room::protocol::Command;
use avalon_server::room::{
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

fn legacy_room() -> Draft {
    let doc = json!({"schemaVersion":1,"meta":{"code":"1234","status":"lobby","hostAccount":"account0","hostToken":"host-token","config":config_fixture(&json!({}),json!(["Seat zero","Seat one","Seat two"]),false)},"members":[
        {"id":"p2","name":"Two","seat":2,"claimed":true,"connected":false,"isSpectator":false},
        {"id":"p0","name":"Zero","seat":0,"claimed":true,"connected":false,"isSpectator":false},
        {"id":"p1","name":"One","seat":1,"claimed":false,"connected":false,"isSpectator":false}
    ],"game":null,"events":[],"eventSeq":0,"sessions":{"p0":"token0","p2":"token2"},"accounts":{"p0":"account0","p2":"account2"},"gameAccounts":{},"notes":{},"lastGameSeats":{"byPlayer":{},"byAccount":{}},"archive":null});
    let mut normalized: avalon_server::room::model::RoomDocument =
        serde_json::from_value(doc).unwrap();
    normalized.normalize_after_load();
    let doc = serde_json::to_value(normalized).unwrap();
    let bindings = BTreeMap::from([(
        "host".into(),
        Binding {
            account: "account0".into(),
            player: Some("p0".into()),
            host: true,
            ..Default::default()
        },
    )]);
    Draft::new(
        Some(serde_json::from_value(doc).unwrap()),
        bindings,
        1_000_000,
    )
}
#[test]
fn legacy_randomized_snapshot_normalizes_member_order() {
    let d = legacy_room();
    let doc = serde_json::to_value(d.doc.unwrap()).unwrap();
    let ids: Vec<_> = doc["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["p0", "p1", "p2"]);
}
#[test]
fn removing_legacy_empty_seat_preserves_correct_roster_labels() {
    let mut d = legacy_room();
    let result = d.act("host", "room:removeSeat", &json!({"seatId":"p1"}));
    assert_eq!(result["ok"], true, "{result}");
    let doc = serde_json::to_value(d.doc.unwrap()).unwrap();
    assert_eq!(
        doc["meta"]["config"]["roster"],
        json!(["Seat zero", "Seat two"])
    );
    assert_eq!(doc["members"][0]["id"], "p0");
    assert_eq!(doc["members"][0]["seat"], 0);
    assert_eq!(doc["members"][1]["id"], "p2");
    assert_eq!(doc["members"][1]["seat"], 1);
}
#[test]
fn legacy_roster_edits_follow_seat_numbers() {
    let mut d = legacy_room();
    let result = d.act(
        "host",
        "room:setRoster",
        &json!({"names":["New zero","New one","New two"]}),
    );
    assert_eq!(result["ok"], true, "{result}");
    let doc = serde_json::to_value(d.doc.unwrap()).unwrap();
    let names: BTreeMap<_, _> = doc["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| (m["id"].as_str().unwrap(), m["name"].as_str().unwrap()))
        .collect();
    assert_eq!(names["p0"], "New zero");
    assert_eq!(names["p1"], "New one");
    assert_eq!(names["p2"], "New two");
}

fn with_legacy_spectator() -> Draft {
    let mut d = legacy_room();
    let mut doc = serde_json::to_value(d.doc.take().unwrap()).unwrap();
    doc["members"].as_array_mut().unwrap().push(json!({"id":"legacy-observer","name":"Observer","seat":99,"claimed":true,"connected":true,"isSpectator":true}));
    doc["accounts"]["legacy-observer"] = json!("observer-account");
    doc["sessions"]["legacy-observer"] = json!("observer-token");
    d.doc = Some(serde_json::from_value(doc).unwrap());
    d.bindings.insert(
        "observer".into(),
        Binding {
            account: "observer-account".into(),
            player: Some("legacy-observer".into()),
            ..Default::default()
        },
    );
    d.bindings.insert(
        "guest".into(),
        Binding {
            account: "guest-account".into(),
            ..Default::default()
        },
    );
    d
}
#[test]
fn spectator_records_are_not_claimable_removable_or_host_successors() {
    let mut d = with_legacy_spectator();
    let before = serde_json::to_value(&d.doc).unwrap();
    for (who, event, payload) in [
        (
            "guest",
            "room:claimSeat",
            json!({"seatId":"legacy-observer","name":"Guest"}),
        ),
        (
            "host",
            "room:removeSeat",
            json!({"seatId":"legacy-observer"}),
        ),
        (
            "host",
            "room:transferHost",
            json!({"targetPlayerId":"legacy-observer"}),
        ),
    ] {
        let r = d.act(who, event, &payload);
        assert_eq!(r["ok"], false, "{event}: {r}");
        assert_eq!(
            serde_json::to_value(&d.doc).unwrap(),
            before,
            "{event} mutated a rejected draft"
        );
    }
}
#[test]
fn roster_edits_and_new_seats_keep_legacy_spectators_separate() {
    let mut d = with_legacy_spectator();
    assert_eq!(
        d.act(
            "host",
            "room:setRoster",
            &json!({"names":["Zero","One","Two"]})
        )["ok"],
        true
    );
    assert!(
        serde_json::to_value(d.doc.as_ref().unwrap()).unwrap()["members"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["id"] == "legacy-observer" && m["name"] == "Observer")
    );
    assert_eq!(d.act("host", "room:addBot", &json!({}))["ok"], true);
    let claimed = d.act("guest", "room:claimSeat", &json!({"name":"Guest"}));
    assert_eq!(claimed["ok"], true, "{claimed}");
    let doc = serde_json::to_value(d.doc.as_ref().unwrap()).unwrap();
    let guest = doc["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == claimed["data"]["playerId"])
        .unwrap();
    assert_eq!(guest["seat"], 3);
    assert_eq!(guest["isSpectator"], false);
    assert_eq!(
        doc["members"].as_array().unwrap().last().unwrap()["id"],
        "legacy-observer"
    );
    for _ in 4..10 {
        assert_eq!(d.act("host", "room:addBot", &json!({}))["ok"], true);
    }
    assert_eq!(
        serde_json::to_value(d.doc.as_ref().unwrap()).unwrap()["members"]
            .as_array()
            .unwrap()
            .len(),
        11
    );
    assert_eq!(
        d.act("host", "room:addBot", &json!({}))["error"]["code"],
        "ROOM_FULL"
    );
}
#[test]
fn dealing_preserves_legacy_spectator_account_but_excludes_it_from_players_and_rewards() {
    let mut d = with_legacy_spectator();
    for _ in 0..3 {
        assert_eq!(d.act("host", "room:addBot", &json!({}))["ok"], true);
    }
    let start = d.act("host", "room:start", &json!({}));
    assert_eq!(start["ok"], true, "{start}");
    let doc = serde_json::to_value(d.doc.as_ref().unwrap()).unwrap();
    assert_eq!(doc["game"]["players"].as_array().unwrap().len(), 5);
    assert_eq!(doc["members"].as_array().unwrap().len(), 6);
    assert_eq!(doc["accounts"]["legacy-observer"], "observer-account");
    assert_eq!(doc["sessions"]["legacy-observer"], "observer-token");
    assert!(doc["gameAccounts"]["legacy-observer"].is_null());
    assert_eq!(d.act("host", "admin:auth", &json!({}))["ok"], true);
    let before = serde_json::to_value(&d.doc).unwrap();
    for (event, payload) in [
        ("admin:propose", json!({"team":["p0"]})),
        (
            "admin:vote",
            json!({"targetPlayerId":"p0","value":"invalid"}),
        ),
        ("admin:setTimersPaused", json!({"paused":"yes"})),
        ("admin:skipSpeech", json!({"targetPlayerId":"missing"})),
        ("admin:unbind", json!({"targetPlayerId":"legacy-observer"})),
        (
            "admin:vote",
            json!({"targetPlayerId":"legacy-observer","value":"approve"}),
        ),
    ] {
        let r = d.act("host", event, &payload);
        assert_eq!(r["ok"], false, "{event}: {r}");
        assert_eq!(
            serde_json::to_value(&d.doc).unwrap(),
            before,
            "{event} mutated a rejected draft"
        );
    }
}

fn config_fixture(raw: &Value, roster: Value, initial: bool) -> Value {
    serde_json::to_value(helpers::make_config(
        &serde_json::from_value(raw.clone()).unwrap(),
        serde_json::from_value(roster).unwrap(),
        initial,
    ))
    .unwrap()
}
