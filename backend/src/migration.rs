//! Startup guard for the one-way resolved-randomness cutover. Legacy random events are never replayed.
use crate::storage::Database;
use anyhow::{Result, ensure};
use sqlx::PgConnection;
const MARKER: &str = "resolved-randomness-v1";
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
        "Legacy database requires the one-way cutover before Rust startup ({rooms} rooms, {replays} replays); run migrate-randomness --apply from release 84841fa first"
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
