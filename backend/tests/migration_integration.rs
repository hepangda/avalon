#![cfg(feature = "legacy-import")]
//! Every case creates a unique disposable database. Never runs against an application database.
use anyhow::Result;
use avalon_server::{
    journal::{diff_state, document_hash},
    migration::{self, MARKER},
    storage::Database,
};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
struct TestDb {
    admin: PgPool,
    pool: PgPool,
    url: String,
    name: String,
}
impl TestDb {
    async fn new() -> Result<Self> {
        let base = std::env::var("AVALON_TEST_DATABASE_URL")?;
        let admin = PgPool::connect(&base).await?;
        // Fixed prefix plus generated UUID hexadecimal: no user-controlled SQL identifiers.
        let name = format!("avalon_migration_{}", uuid::Uuid::new_v4().simple());
        sqlx::query(sqlx::AssertSqlSafe(format!("CREATE DATABASE {name}")))
            .execute(&admin)
            .await?;
        let mut target = url::Url::parse(&base)?;
        target.set_path(&format!("/{name}"));
        let url = target.to_string();
        let pool = PgPool::connect(&url).await?;
        Ok(Self {
            admin,
            pool,
            url,
            name,
        })
    }
    async fn schema(&self) -> Result<()> {
        sqlx::raw_sql(include_str!("../migrations/0001_schema.sql"))
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    async fn close(self) -> Result<()> {
        self.pool.close().await;
        sqlx::query(sqlx::AssertSqlSafe(format!("DROP DATABASE {}", self.name)))
            .execute(&self.admin)
            .await?;
        self.admin.close().await;
        Ok(())
    }
    async fn table(&self, name: &str) -> Result<bool> {
        Ok(sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
            .bind(name)
            .fetch_one(&self.pool)
            .await?)
    }
    async fn marked(&self) -> Result<bool> {
        if !self.table("avalon_migrations").await? {
            return Ok(false);
        }
        Ok(
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM avalon_migrations WHERE name=$1)")
                .bind(MARKER)
                .fetch_one(&self.pool)
                .await?,
        )
    }
}
fn old_doc(code: &str) -> Value {
    json!({"schemaVersion":1,"meta":{"code":code,"name":"Legacy","status":"in_game","gameId":"unfinished","seed":"old-seed"},"game":{"phase":"RoleReveal","outcome":null},"members":[],"events":[],"eventSeq":0,"accounts":{"p1":"account"},"gameAccounts":{"p1":"account"},"sessions":{"p1":"private-token"},"notes":{"p1":{"notes":{"p2":"Merlin"}}},"archive":null})
}
fn replay() -> Value {
    let f: Value = serde_json::from_str(include_str!("fixtures/replay.json")).unwrap();
    let mut r = f["expected"].clone();
    r["gameId"] = json!("archived-one");
    r.as_object_mut().unwrap().remove("formatVersion");
    for a in r["roleAssignments"].as_array_mut().unwrap() {
        a.as_object_mut().unwrap().remove("roleVariant");
    }
    r["operatorMetadata"] = json!({"must":"survive"});
    r
}
async fn insert_room(pool: &PgPool, code: &str, document: &Value) -> Result<()> {
    sqlx::query("INSERT INTO avalon_rooms(code,version,document,snapshot_version,snapshot_hash,state_hash) VALUES($1,1,$2,1,$3,$3)").bind(code).bind(document).bind(document_hash(document)).execute(pool).await?;
    Ok(())
}
async fn accounting(pool: &PgPool) -> Result<Value> {
    let mut result = json!({});
    for (table, query) in [
        (
            "cards",
            "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY account),'[]') FROM avalon_cards t",
        ),
        (
            "profiles",
            "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY account),'[]') FROM avalon_profiles t",
        ),
        (
            "rewards",
            "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY game_id,account),'[]') FROM avalon_game_rewards t",
        ),
        (
            "weights",
            "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY account),'[]') FROM avalon_role_weights t",
        ),
        (
            "weightGames",
            "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY game_id,account),'[]') FROM avalon_role_weight_games t",
        ),
    ] {
        result[table] = sqlx::query_scalar(query).fetch_one(pool).await?;
    }
    Ok(result)
}
#[tokio::test]
#[ignore = "requires disposable PostgreSQL admin URL"]
async fn atomic_cutover_preserves_data_and_does_not_clear_new_rooms_on_rerun() -> Result<()> {
    let db = TestDb::new().await?;
    db.schema().await?;
    sqlx::raw_sql("INSERT INTO avalon_cards(account,cards,completed_games,last_daily_day) VALUES('account',1,17,'2026-10-27'); INSERT INTO avalon_profiles(account,alias,preferences) VALUES('account','玩家','{\"theme\":\"dark\"}'); INSERT INTO avalon_game_rewards VALUES('historical','account'); INSERT INTO avalon_role_weights VALUES('account','{\"Merlin\":75}'); INSERT INTO avalon_role_weight_games VALUES('historical','account');").execute(&db.pool).await?;
    let r = replay();
    sqlx::query("INSERT INTO avalon_replays(game_id,revision,payload,altered,rating_import,updated_at) VALUES('archived-one',5,$1,true,'name-recovery-v1','2026-01-01')").bind(&r).execute(&db.pool).await?;
    sqlx::query("INSERT INTO avalon_game_seats(game_id,player_id,account) VALUES('archived-one','p1','account')").execute(&db.pool).await?;
    let initial = old_doc("1234");
    insert_room(&db.pool, "1234", &initial).await?;
    let mut final_doc = initial.clone();
    final_doc["meta"]["name"] = json!("Journal head");
    final_doc["eventSeq"] = json!(1);
    let change = json!({"format":1,"baseHash":document_hash(&initial),"hash":document_hash(&final_doc),"changes":diff_state(&initial,&final_doc)});
    sqlx::query("INSERT INTO avalon_room_journal(code,version,entry) VALUES('1234',2,$1)")
        .bind(&change)
        .execute(&db.pool)
        .await?;
    sqlx::query("UPDATE avalon_rooms SET version=2,state_hash=$1 WHERE code='1234'")
        .bind(document_hash(&final_doc))
        .execute(&db.pool)
        .await?;
    let mut finished = old_doc("5678");
    finished["meta"]["gameId"] = json!("archived-one");
    finished["meta"]["status"] = json!("finished");
    finished["eventSeq"] = json!(5);
    finished["game"] = json!({"phase":"GameOver","outcome":r["outcome"]});
    finished["archive"] = json!({"revision":5,"replay":r,"seats":{"p1":"account"},"altered":true});
    insert_room(&db.pool, "5678", &finished).await?;
    let before = accounting(&db.pool).await?;
    let dry = migration::run(&db.url, false).await?;
    assert!(dry.dry_run);
    assert_eq!(dry.legacy_rooms, 2);
    assert_eq!(dry.aborted_rooms, 1);
    assert_eq!(dry.completed_rooms, 1);
    assert_eq!(dry.converted_replays, 1);
    assert_eq!(dry.replays_without_role_variants, 1);
    assert!(!db.marked().await?);
    assert!(!db.table("avalon_room_cutover_archive").await?);
    assert_eq!(accounting(&db.pool).await?, before);
    assert!(
        Database::connect(&db.url, 3).await.is_err(),
        "startup must not auto-convert legacy data"
    );
    let applied = migration::run(&db.url, true).await?;
    assert!(!applied.already_applied);
    assert!(db.marked().await?);
    assert_eq!(accounting(&db.pool).await?, before);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM avalon_rooms")
        .fetch_one(&db.pool)
        .await?;
    assert_eq!(count, 0);
    let preserved: Value =
        sqlx::query_scalar("SELECT document FROM avalon_room_cutover_archive WHERE code='1234'")
            .fetch_one(&db.pool)
            .await?;
    assert_eq!(preserved, final_doc);
    let journal: Value =
        sqlx::query_scalar("SELECT journal FROM avalon_room_cutover_archive WHERE code='1234'")
            .fetch_one(&db.pool)
            .await?;
    assert_eq!(journal, json!([{"version":2,"entry":change}]));
    let status: String =
        sqlx::query_scalar("SELECT status FROM avalon_room_cutover_archive WHERE code='1234'")
            .fetch_one(&db.pool)
            .await?;
    assert_eq!(status, "aborted");
    let migrated=sqlx::query("SELECT payload,revision,altered,rating_import,updated_at::text AS at FROM avalon_replays WHERE game_id='archived-one'").fetch_one(&db.pool).await?;
    let mut payload: Value = migrated.try_get("payload")?;
    assert_eq!(payload["formatVersion"], 2);
    payload.as_object_mut().unwrap().remove("formatVersion");
    assert_eq!(payload, r);
    assert_eq!(migrated.try_get::<i32, _>("revision")?, 5);
    assert!(migrated.try_get::<bool, _>("altered")?);
    assert_eq!(
        migrated.try_get::<String, _>("rating_import")?,
        "name-recovery-v1"
    );
    assert!(
        migrated
            .try_get::<String, _>("at")?
            .starts_with("2026-01-01")
    );
    let runtime = Database::connect(&db.url, 3).await?;
    migration::ensure_ready(&runtime).await?;
    assert!(
        migration::run(&db.url, false).await.is_err(),
        "live runtime lock excludes migration"
    );
    let current = json!({"schemaVersion":1,"randomnessVersion":"resolved-v1","meta":{"code":"9012"},"game":null});
    runtime.save_room("9012", 0, &current, None).await?;
    runtime.close().await;
    assert!(migration::run(&db.url, true).await?.already_applied);
    assert!(migration::run(&db.url, false).await?.already_applied);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM avalon_rooms WHERE code='9012'")
        .fetch_one(&db.pool)
        .await?;
    assert_eq!(count, 1);
    // A marker does not bless a later accidental legacy room insertion.
    insert_room(&db.pool, "9999", &old_doc("9999")).await?;
    assert!(Database::connect(&db.url, 3).await.is_err());
    assert!(migration::run(&db.url, true).await.is_err());
    db.close().await
}
#[tokio::test]
#[ignore = "requires disposable PostgreSQL admin URL"]
async fn corrupted_journal_and_late_conflicts_roll_back_every_write() -> Result<()> {
    let db = TestDb::new().await?;
    db.schema().await?;
    let d = old_doc("1234");
    insert_room(&db.pool, "1234", &d).await?;
    sqlx::query("UPDATE avalon_rooms SET snapshot_hash='corrupt' WHERE code='1234'")
        .execute(&db.pool)
        .await?;
    for apply in [false, true] {
        assert!(migration::run(&db.url, apply).await.is_err());
        assert!(!db.marked().await?);
        assert!(!db.table("avalon_room_cutover_archive").await?);
    }
    sqlx::query("UPDATE avalon_rooms SET snapshot_hash=$1 WHERE code='1234'")
        .bind(document_hash(&d))
        .execute(&db.pool)
        .await?;
    let r = replay();
    sqlx::query("INSERT INTO avalon_replays(game_id,revision,payload) VALUES('archived-one',1,$1)")
        .bind(&r)
        .execute(&db.pool)
        .await?;
    sqlx::query("INSERT INTO avalon_game_seats VALUES('archived-one','p1','existing-account')")
        .execute(&db.pool)
        .await?;
    let mut conflicting = d;
    conflicting["archive"] =
        json!({"revision":1,"replay":r,"seats":{"p1":"different-account"},"altered":false});
    sqlx::query(
        "UPDATE avalon_rooms SET document=$1,snapshot_hash=$2,state_hash=$2 WHERE code='1234'",
    )
    .bind(&conflicting)
    .bind(document_hash(&conflicting))
    .execute(&db.pool)
    .await?;
    assert!(
        migration::run(&db.url, false).await.is_err(),
        "read-only plan detects conflicting seat links before application"
    );
    assert!(
        migration::run(&db.url, true).await.is_err(),
        "conflict after archive inserts must roll back DDL and changes"
    );
    assert!(!db.marked().await?);
    assert!(!db.table("avalon_room_cutover_archive").await?);
    let old: Value =
        sqlx::query_scalar("SELECT payload FROM avalon_replays WHERE game_id='archived-one'")
            .fetch_one(&db.pool)
            .await?;
    assert_eq!(old, r);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM avalon_rooms")
        .fetch_one(&db.pool)
        .await?;
    assert_eq!(count, 1);
    db.close().await
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL admin URL"]
async fn stale_room_revision_cannot_backfill_newer_replay_identity() -> Result<()> {
    let db = TestDb::new().await?;
    db.schema().await?;
    let current = replay();
    sqlx::query(
        "INSERT INTO avalon_replays(game_id,revision,payload) VALUES('archived-one',10,$1)",
    )
    .bind(&current)
    .execute(&db.pool)
    .await?;
    let mut old = current.clone();
    old["endedAt"] = json!(1);
    let mut room = old_doc("1234");
    room["archive"] = json!({"revision":9,"replay":old,"seats":{"p1":"stale-account"}});
    insert_room(&db.pool, "1234", &room).await?;
    migration::run(&db.url, false).await?;
    migration::run(&db.url, true).await?;
    let seats: i64 = sqlx::query_scalar("SELECT count(*) FROM avalon_game_seats")
        .fetch_one(&db.pool)
        .await?;
    assert_eq!(seats, 0);
    let mut actual: Value =
        sqlx::query_scalar("SELECT payload FROM avalon_replays WHERE game_id='archived-one'")
            .fetch_one(&db.pool)
            .await?;
    actual.as_object_mut().unwrap().remove("formatVersion");
    assert_eq!(actual, current);
    sqlx::query("UPDATE avalon_replays SET payload=jsonb_set(payload,'{formatVersion}','\"2\"'::jsonb) WHERE game_id='archived-one'").execute(&db.pool).await?;
    assert!(
        Database::connect(&db.url, 3).await.is_err(),
        "string version cannot pass the startup guard"
    );
    assert!(migration::run(&db.url, true).await.is_err());
    db.close().await
}
#[tokio::test]
#[ignore = "requires disposable PostgreSQL admin URL"]
async fn old_schema_and_account_balances_are_not_rewritten_by_preflight_or_cutover() -> Result<()> {
    let db = TestDb::new().await?;
    sqlx::raw_sql("CREATE TABLE avalon_cards(account text PRIMARY KEY,cards integer NOT NULL,completed_games integer NOT NULL,last_daily_day text); INSERT INTO avalon_cards VALUES('legacy-wallet',7,19,'2026-10-01'); CREATE TABLE avalon_rooms(code text PRIMARY KEY,version integer NOT NULL,document jsonb NOT NULL); ").execute(&db.pool).await?;
    sqlx::query("INSERT INTO avalon_rooms VALUES('1234',8,$1)")
        .bind(old_doc("1234"))
        .execute(&db.pool)
        .await?;
    assert!(Database::connect(&db.url, 3).await.is_err());
    assert!(!db.table("avalon_migrations").await?);
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='avalon_rooms' AND column_name='snapshot_version'").fetch_one(&db.pool).await?;
    assert_eq!(count, 0);
    let dry = migration::run(&db.url, false).await?;
    assert_eq!(dry.legacy_rooms, 1);
    assert!(!db.table("avalon_migrations").await?);
    migration::run(&db.url, true).await?;
    let balance: i32 =
        sqlx::query_scalar("SELECT cards FROM avalon_cards WHERE account='legacy-wallet'")
            .fetch_one(&db.pool)
            .await?;
    assert_eq!(balance, 7);
    let original: Value = sqlx::query_scalar(
        "SELECT original_room FROM avalon_room_cutover_archive WHERE code='1234'",
    )
    .fetch_one(&db.pool)
    .await?;
    assert_eq!(original["version"], 8);
    assert!(original.get("snapshot_version").is_none());
    let runtime = Database::connect(&db.url, 3).await?;
    runtime.close().await;
    db.close().await
}
#[tokio::test]
#[ignore = "requires disposable PostgreSQL admin URL"]
async fn empty_database_dry_run_is_schema_read_only_and_normal_startup_can_initialize() -> Result<()>
{
    let db = TestDb::new().await?;
    let report = migration::run(&db.url, false).await?;
    assert_eq!(report.legacy_rooms, 0);
    assert!(!db.table("avalon_rooms").await?);
    assert!(!db.table("avalon_migrations").await?);
    let runtime = Database::connect(&db.url, 3).await?;
    migration::ensure_ready(&runtime).await?;
    assert!(db.marked().await?);
    runtime.close().await;
    db.close().await
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL admin URL"]
async fn completed_legacy_events_recover_missing_archive_without_awarding_again() -> Result<()> {
    let db = TestDb::new().await?;
    db.schema().await?;
    let fixture: Value = serde_json::from_str(include_str!("fixtures/replay-rewind.json"))?;
    let mut room = old_doc("1234");
    room["meta"]["status"] = json!("finished");
    room["meta"]["gameId"] = fixture["gameId"].clone();
    room["meta"]["seed"] = fixture["seed"].clone();
    room["game"] = fixture["finalState"].clone();
    room["members"] = fixture["players"].clone();
    room["events"] = fixture["events"].clone();
    room["eventSeq"] = json!(fixture["events"].as_array().unwrap().len());
    insert_room(&db.pool, "1234", &room).await?;
    let before = accounting(&db.pool).await?;
    let dry = migration::run(&db.url, false).await?;
    assert_eq!(dry.recovered_replays, 1);
    assert_eq!(dry.completed_rooms, 1);
    assert!(!db.marked().await?);
    migration::run(&db.url, true).await?;
    let migrated: Value = sqlx::query_scalar("SELECT payload FROM avalon_replays WHERE game_id=$1")
        .bind(fixture["gameId"].as_str().unwrap())
        .fetch_one(&db.pool)
        .await?;
    let mut expected = fixture["expected"].clone();
    expected["formatVersion"] = json!(2);
    for assignment in expected["roleAssignments"].as_array_mut().unwrap() {
        assignment.as_object_mut().unwrap().remove("roleVariant");
    }
    assert_eq!(migrated, expected);
    assert_eq!(
        accounting(&db.pool).await?,
        before,
        "recovering an old replay cannot award cards or alter ratings inputs"
    );
    let runtime = Database::connect(&db.url, 3).await?;
    assert_eq!(
        runtime
            .load_replay(fixture["gameId"].as_str().unwrap())
            .await?,
        Some(expected)
    );
    runtime.close().await;
    db.close().await
}
