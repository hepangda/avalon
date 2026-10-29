//! Explicit, one-way data cutover. Production startup never replays legacy random events.
use crate::storage::Database;
#[cfg(feature = "legacy-import")]
use anyhow::Context;
use anyhow::{Result, ensure};
use serde::Serialize;
#[cfg(feature = "legacy-import")]
use serde_json::Value;
use sqlx::PgConnection;
#[cfg(feature = "legacy-import")]
use sqlx::Row;
pub const MARKER: &str = "resolved-randomness-v1";
const ARCHIVE_DDL: &str = include_str!("../migrations/0002_resolved_randomness.sql");

async fn has_table(conn: &mut PgConnection, name: &str) -> Result<bool> {
    Ok(sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
        .bind(name)
        .fetch_one(conn)
        .await?)
}
async fn marker_present(conn: &mut PgConnection) -> Result<bool> {
    if !has_table(conn, "avalon_migrations").await? {
        return Ok(false);
    }
    Ok(
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM avalon_migrations WHERE name=$1)")
            .bind(MARKER)
            .fetch_one(conn)
            .await?,
    )
}
async fn live_counts(conn: &mut PgConnection) -> Result<(i64, i64)> {
    let rooms = if has_table(conn, "avalon_rooms").await? {
        sqlx::query_scalar("SELECT count(*) FROM avalon_rooms")
            .fetch_one(&mut *conn)
            .await?
    } else {
        0
    };
    let replays = if has_table(conn, "avalon_replays").await? {
        sqlx::query_scalar("SELECT count(*) FROM avalon_replays")
            .fetch_one(&mut *conn)
            .await?
    } else {
        0
    };
    Ok((rooms, replays))
}
async fn check_resolved_records(conn: &mut PgConnection) -> Result<()> {
    if has_table(conn, "avalon_rooms").await? {
        let legacy:i64=sqlx::query_scalar("SELECT count(*) FROM avalon_rooms WHERE document->>'randomnessVersion' IS DISTINCT FROM 'resolved-v1' OR (document->'game' IS NOT NULL AND document->'game'<>'null'::jsonb AND document->'game'->>'randomnessVersion' IS DISTINCT FROM 'resolved-v1')").fetch_one(&mut *conn).await?;
        ensure!(
            legacy == 0,
            "Found {legacy} legacy or unsupported rooms after {MARKER}; refuse startup"
        );
    }
    if has_table(conn, "avalon_replays").await? {
        let legacy:i64=sqlx::query_scalar("SELECT count(*) FROM avalon_replays WHERE payload->'formatVersion' IS DISTINCT FROM '2'::jsonb").fetch_one(&mut *conn).await?;
        ensure!(
            legacy == 0,
            "Found {legacy} legacy or unsupported replays after {MARKER}; refuse startup"
        );
    }
    ensure!(
        has_table(conn, "avalon_room_cutover_archive").await?
            && has_table(conn, "avalon_replay_cutover_archive").await?,
        "Cutover marker exists without archive schema"
    );
    Ok(())
}
/// Called while the runtime holds the advisory owner connection, before any DDL.
pub(crate) async fn preflight_runtime(conn: &mut PgConnection) -> Result<()> {
    if marker_present(conn).await? {
        return check_resolved_records(conn).await;
    }
    let (rooms, replays) = live_counts(conn).await?;
    ensure!(
        rooms == 0 && replays == 0,
        "Legacy database requires explicit migrate-randomness --apply before Rust startup ({rooms} rooms, {replays} replays); stop the server and run the migration tool"
    );
    Ok(())
}
/// Idempotent startup guard. Only an empty room/replay database may initialize itself.
pub async fn ensure_ready(db: &Database) -> Result<()> {
    let mut tx = db.fenced().await?;
    if marker_present(&mut tx).await? {
        check_resolved_records(&mut tx).await?;
        tx.commit().await?;
        return Ok(());
    }
    let (rooms, replays) = live_counts(&mut tx).await?;
    ensure!(
        rooms == 0 && replays == 0,
        "Explicit resolved randomness cutover is required for populated databases"
    );
    sqlx::raw_sql(ARCHIVE_DDL).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO avalon_migrations(name) VALUES($1)")
        .bind(MARKER)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub dry_run: bool,
    pub already_applied: bool,
    pub legacy_rooms: usize,
    pub aborted_rooms: usize,
    pub completed_rooms: usize,
    pub existing_replays: usize,
    pub converted_replays: usize,
    pub recovered_replays: usize,
    pub replays_without_role_variants: usize,
    pub preserved_account_rows: std::collections::BTreeMap<String, i64>,
}

#[cfg(feature = "legacy-import")]
mod importer {
    use super::*;
    use crate::journal::{document_hash, replay_journal};
    use serde_json::json;
    use sqlx::postgres::PgPoolOptions;
    use std::{collections::BTreeMap, time::Duration};
    struct Room {
        code: String,
        version: i64,
        raw: Value,
        journal: Value,
        document: Value,
        hash: String,
        finished: bool,
    }
    struct Replay {
        id: String,
        revision: i32,
        raw: Option<Value>,
        payload: Value,
        seats: Option<Value>,
        altered: Option<bool>,
    }

    /// Dry run is read-only and takes the same exclusive owner lock as the server.
    pub async fn run(url: &str, apply: bool) -> Result<Report> {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_secs(5))
            .connect(url)
            .await?;
        let mut conn = pool.acquire().await?;
        let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock(1096171852,1)")
            .fetch_one(&mut *conn)
            .await?;
        ensure!(
            locked,
            "Another Avalon server or migration owns this database; stop it first"
        );
        let result = run_locked(&mut conn, apply).await;
        // Closing the exact connection releases the session lock even after rollback/error.
        let _ = conn.close().await;
        pool.close().await;
        result
    }
    async fn run_locked(conn: &mut PgConnection, apply: bool) -> Result<Report> {
        use sqlx::Connection;
        let mut tx = conn.begin().await?;
        if apply {
            sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                .execute(&mut *tx)
                .await?;
        }
        let mut report = Report {
            dry_run: !apply,
            ..Default::default()
        };
        if marker_present(&mut tx).await? {
            check_resolved_records(&mut tx).await?;
            report.already_applied = true;
            tx.commit().await?;
            return Ok(report);
        }
        // Preserve all accounting tables unchanged. Counts are included in the reviewable plan.
        for (name, query) in [
            ("avalon_cards", "SELECT count(*) FROM avalon_cards"),
            (
                "avalon_game_rewards",
                "SELECT count(*) FROM avalon_game_rewards",
            ),
            (
                "avalon_role_weights",
                "SELECT count(*) FROM avalon_role_weights",
            ),
            (
                "avalon_role_weight_games",
                "SELECT count(*) FROM avalon_role_weight_games",
            ),
            ("avalon_profiles", "SELECT count(*) FROM avalon_profiles"),
            (
                "avalon_game_seats",
                "SELECT count(*) FROM avalon_game_seats",
            ),
        ] {
            if has_table(&mut tx, name).await? {
                let count: i64 = sqlx::query_scalar(query).fetch_one(&mut *tx).await?;
                report.preserved_account_rows.insert(name.into(), count);
            }
        }
        let journal_exists = has_table(&mut tx, "avalon_room_journal").await?;
        let mut journals: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        if journal_exists {
            for row in sqlx::query(
                "SELECT code,version,entry FROM avalon_room_journal ORDER BY code,version",
            )
            .fetch_all(&mut *tx)
            .await?
            {
                let code: String = row.try_get("code")?;
                let version: i32 = row.try_get("version")?;
                let entry: Value = row.try_get("entry")?;
                journals
                    .entry(code)
                    .or_default()
                    .push(json!({"version":version,"entry":entry}));
            }
        }
        let mut rooms = Vec::new();
        if has_table(&mut tx, "avalon_rooms").await? {
            for row in sqlx::query("SELECT to_jsonb(r) AS raw FROM avalon_rooms r ORDER BY code")
                .fetch_all(&mut *tx)
                .await?
            {
                let raw: Value = row.try_get("raw")?;
                let code = raw["code"]
                    .as_str()
                    .context("Invalid room code")?
                    .to_owned();
                let version = raw["version"].as_i64().context("Invalid room version")?;
                ensure!(version >= 1, "Invalid room version for {code}");
                let snapshot = raw["snapshot_version"].as_i64().unwrap_or(version);
                let entries = journals.remove(&code).unwrap_or_default();
                let replay_entries: Vec<Value> = entries
                    .iter()
                    .filter(|e| e["version"].as_i64().unwrap_or(0) > snapshot)
                    .map(|e| {
                        let mut entry = e["entry"].clone();
                        entry["version"] = e["version"].clone();
                        entry
                    })
                    .collect();
                let document = replay_journal(
                    raw["document"].clone(),
                    snapshot,
                    raw["snapshot_hash"].as_str(),
                    &replay_entries,
                    version,
                    raw["state_hash"].as_str(),
                )
                .with_context(|| {
                    format!("Room {code} failed integrity verification; nothing was migrated")
                })?;
                ensure!(
                    document["schemaVersion"] == 1 && document["meta"]["code"] == code,
                    "Unsupported room snapshot {code}"
                );
                let finished = document["game"]["phase"] == "GameOver"
                    && !document["game"]["outcome"].is_null();
                let hash = document_hash(&document);
                rooms.push(Room {
                    code,
                    version,
                    raw,
                    journal: json!(entries),
                    document,
                    hash,
                    finished,
                });
            }
        }
        ensure!(
            journals.is_empty(),
            "Orphan room journal entries exist; refuse to discard unassociated history"
        );
        report.legacy_rooms = rooms.len();
        report.completed_rooms = rooms.iter().filter(|r| r.finished).count();
        report.aborted_rooms = rooms.len() - report.completed_rooms;
        let mut replays: BTreeMap<String, Replay> = BTreeMap::new();
        if has_table(&mut tx, "avalon_replays").await? {
            for row in
                sqlx::query("SELECT to_jsonb(r) AS raw FROM avalon_replays r ORDER BY game_id")
                    .fetch_all(&mut *tx)
                    .await?
            {
                let raw: Value = row.try_get("raw")?;
                let id = raw["game_id"]
                    .as_str()
                    .context("Invalid replay id")?
                    .to_owned();
                let revision = i32::try_from(
                    raw["revision"]
                        .as_i64()
                        .context("Invalid replay revision")?,
                )?;
                let payload = crate::replay::migrate_archive(&raw["payload"])
                    .with_context(|| format!("Replay {id} cannot migrate"))?;
                ensure!(
                    payload["gameId"] == id,
                    "Replay row and payload game id differ: {id}"
                );
                if raw["payload"]["formatVersion"] != 2 {
                    report.converted_replays += 1;
                }
                replays.insert(
                    id.clone(),
                    Replay {
                        id,
                        revision,
                        raw: Some(raw),
                        payload,
                        seats: None,
                        altered: None,
                    },
                );
            }
        }
        report.existing_replays = replays.len();
        for room in &rooms {
            let d = &room.document;
            // A surviving archive may describe an earlier completed game even if this room is unfinished now.
            if d["archive"]["replay"].is_object() {
                let payload = crate::replay::migrate_archive(&d["archive"]["replay"])?;
                let revision = i32::try_from(
                    d["archive"]["revision"]
                        .as_i64()
                        .context("Missing room archive revision")?,
                )?;
                let links = exact_links(d, &payload);
                merge_replay(&mut replays, &mut report, payload, revision, links)?;
            }
            if room.finished {
                let payload = crate::replay::migrate_finished_room(d)?
                    .context("Finished room could not be materialized")?;
                let revision = i32::try_from(
                    d["eventSeq"]
                        .as_i64()
                        .context("Missing finished room event sequence")?,
                )?;
                let links = exact_links(d, &payload);
                merge_replay(&mut replays, &mut report, payload, revision, links)?;
            }
        }
        report.replays_without_role_variants = replays
            .values()
            .filter(|r| {
                r.payload["roleAssignments"].as_array().is_none_or(|a| {
                    a.iter().any(|a| {
                        matches!(a["role"].as_str(), Some("LoyalServant" | "Minion"))
                            && a.get("roleVariant").is_none()
                    })
                })
            })
            .count();
        // Validate prospective links during the read-only plan as well as apply.
        // An older room revision is never evidence for a newer archived game's identities.
        let seat_table = has_table(&mut tx, "avalon_game_seats").await?;
        for replay in replays.values() {
            if let Some(seats) = replay.seats.as_ref().and_then(Value::as_object) {
                for (player, account) in seats {
                    let account = account.as_str().context("Invalid exact seat account")?;
                    ensure!(
                        replay.payload["players"]
                            .as_array()
                            .is_some_and(|p| p.iter().any(|p| p["id"] == *player)),
                        "Seat link names a player absent from replay {}",
                        replay.id
                    );
                    if seat_table {
                        let old:Option<String>=sqlx::query_scalar("SELECT account FROM avalon_game_seats WHERE game_id=$1 AND player_id=$2").bind(&replay.id).bind(player).fetch_optional(&mut *tx).await?;
                        ensure!(
                            old.as_deref().is_none_or(|a| a == account),
                            "Conflicting exact seat link for replay {}",
                            replay.id
                        );
                    }
                }
            }
        }
        if !apply {
            tx.commit().await?;
            return Ok(report);
        }
        // DDL is additive and in this same transaction; no accounting data is rewritten.
        sqlx::raw_sql(include_str!("../migrations/0001_schema.sql"))
            .execute(&mut *tx)
            .await?;
        sqlx::raw_sql(ARCHIVE_DDL).execute(&mut *tx).await?;
        for room in rooms {
            let incarnation = document_hash(
                &json!({"code":room.code,"version":room.version,"documentHash":room.hash}),
            );
            sqlx::query("INSERT INTO avalon_room_cutover_archive(migration,incarnation,code,source_version,status,document,document_hash,original_room,journal) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(MARKER).bind(incarnation).bind(&room.code).bind(room.version).bind(if room.finished{"completed"}else{"aborted"}).bind(room.document).bind(room.hash).bind(room.raw).bind(room.journal).execute(&mut *tx).await?;
        }
        for replay in replays.values() {
            if let Some(raw) = &replay.raw {
                sqlx::query("INSERT INTO avalon_replay_cutover_archive(migration,game_id,original_replay) VALUES($1,$2,$3)").bind(MARKER).bind(&replay.id).bind(raw).execute(&mut *tx).await?;
            }
            if replay.raw.is_some() {
                // Keep existing revision, timestamps, altered/rating provenance and every seat link.
                sqlx::query("UPDATE avalon_replays SET payload=$2 WHERE game_id=$1")
                    .bind(&replay.id)
                    .bind(&replay.payload)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query("INSERT INTO avalon_replays(game_id,revision,payload,altered) VALUES($1,$2,$3,$4)").bind(&replay.id).bind(replay.revision).bind(&replay.payload).bind(replay.altered).execute(&mut *tx).await?;
            }
            if let Some(seats) = replay.seats.as_ref().and_then(Value::as_object) {
                for (player, account) in seats {
                    let account = account.as_str().context("Invalid exact seat account")?;
                    let old: Option<String> = sqlx::query_scalar(
                        "SELECT account FROM avalon_game_seats WHERE game_id=$1 AND player_id=$2",
                    )
                    .bind(&replay.id)
                    .bind(player)
                    .fetch_optional(&mut *tx)
                    .await?;
                    ensure!(
                        old.as_deref().is_none_or(|a| a == account),
                        "Conflicting exact seat link for replay {}",
                        replay.id
                    );
                    sqlx::query("INSERT INTO avalon_game_seats(game_id,player_id,account) VALUES($1,$2,$3) ON CONFLICT DO NOTHING").bind(&replay.id).bind(player).bind(account).execute(&mut *tx).await?;
                }
            }
        }
        // Archival and deletion are atomic with the marker. Future resolved rooms are never cleared on rerun.
        sqlx::query("DELETE FROM avalon_room_journal")
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM avalon_rooms")
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO avalon_migrations(name) VALUES($1)")
            .bind(MARKER)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(report)
    }
    fn exact_links(document: &Value, replay: &Value) -> Option<(Value, Option<bool>)> {
        if document["archive"]["replay"]["gameId"] == replay["gameId"]
            && document["archive"]["seats"].is_object()
        {
            return Some((
                document["archive"]["seats"].clone(),
                document["archive"]["altered"].as_bool(),
            ));
        }
        if document["meta"]["gameId"] == replay["gameId"] && document["gameAccounts"].is_object() {
            let altered = document["events"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|e| {
                    e["event"]["admin"] == true
                        || [
                            "PREVIOUS_PHASE",
                            "REROLL_ROLES",
                            "USE_REROLL_CARD",
                            "RETRACT_VOTES",
                            "RETRACT_PROPOSAL",
                        ]
                        .contains(&e["event"]["type"].as_str().unwrap_or(""))
                });
            return Some((document["gameAccounts"].clone(), Some(altered)));
        }
        None
    }
    fn merge_replay(
        replays: &mut BTreeMap<String, Replay>,
        report: &mut Report,
        payload: Value,
        revision: i32,
        links: Option<(Value, Option<bool>)>,
    ) -> Result<()> {
        let id = payload["gameId"]
            .as_str()
            .context("Recovered replay has no game id")?
            .to_owned();
        if let Some(existing) = replays.get_mut(&id) {
            // A canonical archived replay is the durable historical record; do not replace it with reconstructed randomness.
            // Same/newer room archives must agree exactly or require operator investigation.
            if revision >= existing.revision {
                ensure!(
                    existing.payload == payload,
                    "Room/archive replay mismatch for {id}; refuse to choose between contradictory histories"
                );
            }
            if let Some((seats, _)) =
                links.filter(|_| revision == existing.revision && existing.payload == payload)
            {
                if let Some(old) = &existing.seats {
                    ensure!(old == &seats, "Conflicting room seat links for {id}");
                } else {
                    existing.seats = Some(seats);
                }
            }
        } else {
            let (seats, altered) = links.map(|(s, a)| (Some(s), a)).unwrap_or((None, None));
            replays.insert(
                id.clone(),
                Replay {
                    id,
                    revision,
                    raw: None,
                    payload,
                    seats,
                    altered,
                },
            );
            report.recovered_replays += 1;
        }
        Ok(())
    }
}
#[cfg(feature = "legacy-import")]
pub use importer::run;
