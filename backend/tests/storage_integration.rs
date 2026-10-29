//! Run against a disposable empty PostgreSQL database, never a production database:
//! AVALON_TEST_DATABASE_URL=postgres://postgres:...@127.0.0.1:55439/postgres cargo test --test storage_integration -- --ignored
use avalon_server::{journal::document_hash, storage::Database};
use serde_json::{Value, json};
use sqlx::Row;
fn doc() -> Value {
    json!({"randomnessVersion":"resolved-v1","meta":{"code":"1234","name":"test","status":"lobby","visibility":"public","config":{"maxPlayers":10}},"members":[],"events":[],"gameAccounts":{}})
}
#[tokio::test]
#[ignore = "requires a disposable PostgreSQL database"]
async fn persistence_integrity_atomicity_and_fencing() {
    let url = std::env::var("AVALON_TEST_DATABASE_URL")
        .expect("Disposable AVALON_TEST_DATABASE_URL required");
    let admin = sqlx::PgPool::connect(&url).await.unwrap();
    // The database identifier is only a fixed prefix plus generated UUID hex.
    let name = format!("avalon_test_{}", uuid::Uuid::new_v4().simple());
    sqlx::query(sqlx::AssertSqlSafe(format!("CREATE DATABASE {name}")))
        .execute(&admin)
        .await
        .unwrap();
    let mut target = url::Url::parse(&url).unwrap();
    target.set_path(&format!("/{name}"));
    let url = target.to_string();
    let db = Database::connect(&url, 4).await.unwrap();
    assert!(
        Database::connect(&url, 2).await.is_err(),
        "exclusive database owner"
    );
    let initial = doc();
    let v = db.save_room("1234", 0, &initial, None).await.unwrap();
    assert_eq!(v, 1);
    assert!(db.save_room("1234", 0, &initial, None).await.is_err());
    let mut changed = initial.clone();
    changed["events"] = json!([{"event":{"type":"TEST"}}]);
    changed["meta"]["name"] = json!("second");
    assert_eq!(
        db.save_room_from_previous("1234", 1, &changed, Some(&initial), None)
            .await
            .unwrap(),
        2
    );
    assert_eq!(
        db.load_room("1234").await.unwrap().unwrap().document,
        changed
    );
    assert!(db.save_room("1234", 1, &initial, None).await.is_err());
    assert_eq!(
        db.save_room_from_previous("1234", 2, &changed, Some(&changed), None)
            .await
            .unwrap(),
        2,
        "no-op does not create a new version"
    );
    assert!(
        db.save_room_from_previous("1234", 2, &initial, Some(&json!({"wrong":"base"})), None)
            .await
            .is_err(),
        "stale base hash rejects prepared change"
    );
    assert!(
        db.save_room("1234", 2, &initial, Some("no-card"))
            .await
            .is_err()
    );
    assert_eq!(
        db.load_room("1234").await.unwrap().unwrap().version,
        2,
        "failed spend rolls back journal and version"
    );
    assert!(
        db.checkpoint_room("1234", 2, &initial).await.is_err(),
        "wrong checkpoint preserves evidence"
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM avalon_room_journal WHERE code='1234'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
    db.checkpoint_room("1234", 2, &changed).await.unwrap();
    assert_eq!(
        db.load_room("1234").await.unwrap().unwrap().document,
        changed
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM avalon_room_journal WHERE code='1234'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
    db.grant_debug_card("account").await.unwrap();
    let mut finished = changed.clone();
    finished["game"] = json!({"phase":"GameOver","randomnessVersion":"resolved-v1"});
    finished["archive"] = json!({"revision":1,"replay":{"formatVersion":2,"gameId":"integration-game","outcome":{"winner":"good"},"startedAt":0,"endedAt":600001,"players":[]},"seats":{"p1":"account"},"altered":false,"rewardAccounts":["account","account"],"roleWeightAssignments":{"account":"Merlin"}});
    assert_eq!(
        db.save_room("1234", 2, &finished, Some("account"))
            .await
            .unwrap(),
        3
    );
    assert_eq!(db.get_cards("account", None).await.unwrap()["cards"], 0);
    assert_eq!(
        db.get_cards("account", None).await.unwrap()["completedGames"],
        1
    );
    assert_eq!(
        db.find_seat("integration-game", "account")
            .await
            .unwrap()
            .as_deref(),
        Some("p1")
    );
    let weights = db.get_role_weights(&["account".into()]).await.unwrap();
    assert_eq!(weights["account"]["Merlin"], 75.);
    assert_eq!(weights["account"]["Percival"], 125.);
    db.save_room("1234", 3, &finished, None).await.unwrap();
    assert_eq!(
        db.get_cards("account", None).await.unwrap()["completedGames"],
        1,
        "reward is idempotent"
    );
    assert_eq!(
        db.get_role_weights(&["account".into()]).await.unwrap(),
        weights,
        "role settlement idempotent"
    );
    // Corruption in the next journal entry must be detected, not compacted away.
    sqlx::query("UPDATE avalon_room_journal SET entry=jsonb_set(entry,'{hash}','\"corrupt\"') WHERE code='1234' AND version=4").execute(&db.pool).await.unwrap();
    assert!(db.load_room("1234").await.is_err());
    assert!(db.checkpoint_room("1234", 4, &finished).await.is_err());
    sqlx::query("UPDATE avalon_room_journal SET entry=jsonb_set(entry,'{hash}',$1::jsonb) WHERE code='1234' AND version=4").bind(json!(document_hash(&finished))).execute(&db.pool).await.unwrap();
    db.checkpoint_room("1234", 4, &finished).await.unwrap();
    // Legacy snapshot with no hashes must remain readable.
    sqlx::query(
        "INSERT INTO avalon_rooms(code,version,document,snapshot_version) VALUES('5678',7,$1,7)",
    )
    .bind(&initial)
    .execute(&db.pool)
    .await
    .unwrap();
    assert_eq!(db.load_room("5678").await.unwrap().unwrap().version, 7);
    // Optional role preferences cannot break game settlement.
    sqlx::query("DROP TABLE avalon_role_weights")
        .execute(&db.pool)
        .await
        .unwrap();
    finished["archive"]["revision"] = json!(2);
    finished["archive"]["roleWeightAssignments"] = json!({"new-account":"Assassin"});
    db.save_room("1234", 4, &finished, None).await.unwrap();
    let rev: i32 =
        sqlx::query("SELECT revision FROM avalon_replays WHERE game_id='integration-game'")
            .fetch_one(&db.pool)
            .await
            .unwrap()
            .get("revision");
    assert_eq!(rev, 2);
    // Fencing rejects an old process even before its lock heartbeat notices.
    sqlx::query("UPDATE avalon_runtime SET token='replaced' WHERE id=1")
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(db.save_room("1234", 5, &finished, None).await.is_err());
    assert!(db.delete_room("1234", 5).await.is_err());
    assert!(db.health().await.is_err());
    db.close().await;
    let db = Database::connect(&url, 3).await.unwrap();
    assert_eq!(
        db.load_room("1234").await.unwrap().unwrap().document,
        finished
    );
    let pid:i32=sqlx::query_scalar("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=1096171852 AND objid=1 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())").fetch_one(&db.pool).await.unwrap();
    sqlx::query("SELECT pg_terminate_backend($1)")
        .bind(pid)
        .execute(&db.pool)
        .await
        .unwrap();
    let replacement = Database::connect(&url, 3).await.unwrap();
    assert!(
        db.health().await.is_err(),
        "terminated owner is fenced by replacement"
    );
    assert!(!db.ownership_available());
    db.close().await;
    let db = replacement;
    db.delete_room("1234", 5).await.unwrap();
    db.delete_room("5678", 7).await.unwrap();
    db.close().await;
    sqlx::query(sqlx::AssertSqlSafe(format!("DROP DATABASE {name}")))
        .execute(&admin)
        .await
        .unwrap();
    admin.close().await;
}
