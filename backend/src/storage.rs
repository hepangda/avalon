use crate::journal::{diff_state, document_hash, replay_journal};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use sqlx::{
    PgPool, Postgres, Row, Transaction,
    postgres::{PgPoolOptions, PgRow},
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Database {
    pub pool: PgPool,
    inner: Arc<Inner>,
}
struct Inner {
    cpu: crate::cpu::CpuPool,
    token: String,
    available: AtomicBool,
    owner: Mutex<Option<sqlx::pool::PoolConnection<Postgres>>>,
}
#[derive(Debug, Clone)]
pub struct RoomRecord {
    pub version: i64,
    pub document: Value,
}
const ROLES: [&str; 8] = [
    "Merlin",
    "Percival",
    "LoyalServant",
    "Morgana",
    "Assassin",
    "Oberon",
    "Mordred",
    "Minion",
];
fn normalize_weights(v: &Value) -> Value {
    json!(
        ROLES
            .into_iter()
            .map(|r| (
                r.to_owned(),
                json!(
                    v[r].as_f64()
                        .filter(|v| v.is_finite() && *v > 0.)
                        .unwrap_or(100.)
                        .max(50.)
                )
            ))
            .collect::<serde_json::Map<_, _>>()
    )
}
impl Database {
    pub async fn connect(url: &str, max: u32) -> Result<Self> {
        Self::connect_impl(url, max, false).await
    }
    #[cfg(feature = "legacy-import")]
    pub async fn connect_maintenance(url: &str, max: u32) -> Result<Self> {
        Self::connect_impl(url, max, true).await
    }
    async fn connect_impl(url: &str, max: u32, maintenance: bool) -> Result<Self> {
        ensure!(max >= 2, "PG_POOL_MAX must be at least 2");
        let cpu_threads = match std::env::var("CPU_WORKERS") {
            Ok(raw) => raw
                .parse::<usize>()
                .context("CPU_WORKERS must be an integer from 1 to 32")?,
            Err(std::env::VarError::NotPresent) => std::thread::available_parallelism()
                .map(|v| v.get())
                .unwrap_or(2)
                .saturating_sub(1)
                .clamp(1, 4),
            Err(error) => return Err(error).context("Invalid CPU_WORKERS"),
        };
        ensure!(
            (1..=32).contains(&cpu_threads),
            "CPU_WORKERS must be an integer from 1 to 32"
        );
        let pool=PgPoolOptions::new().max_connections(max).acquire_timeout(Duration::from_secs(5)).after_connect(|c,_|Box::pin(async move {sqlx::raw_sql("SET statement_timeout='10s'; SET idle_in_transaction_session_timeout='15s'; SET application_name='avalon-rust'").execute(c).await?;Ok(())})).connect(url).await?;
        let mut owner = pool.acquire().await?;
        let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock(1096171852, 1)")
            .fetch_one(&mut *owner)
            .await?;
        ensure!(
            locked,
            "Another Avalon server owns this database; stop it first"
        );
        if !maintenance {
            crate::migration::preflight_runtime(&mut owner).await?;
        }
        sqlx::raw_sql(include_str!("../migrations/0001_schema.sql"))
            .execute(&mut *owner)
            .await?;
        let token = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO avalon_runtime (id,token) VALUES (1,$1) ON CONFLICT(id) DO UPDATE SET token=excluded.token").bind(&token).execute(&mut *owner).await?;
        let db = Self {
            pool,
            inner: Arc::new(Inner {
                cpu: crate::cpu::CpuPool::new(cpu_threads, 32)?,
                token,
                available: AtomicBool::new(true),
                owner: Mutex::new(Some(owner)),
            }),
        };
        let weak = Arc::downgrade(&db.inner);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let Some(inner) = weak.upgrade() else { break };
                if !inner.available.load(Ordering::Acquire) {
                    break;
                }
                let mut guard = inner.owner.lock().await;
                if let Some(conn) = guard.as_mut() {
                    if sqlx::query("SELECT 1").execute(&mut **conn).await.is_err() {
                        inner.available.store(false, Ordering::Release);
                        break;
                    }
                } else {
                    break;
                }
            }
        });
        if !maintenance {
            crate::migration::ensure_ready(&db).await?;
        }
        Ok(db)
    }
    /// Share the same bounded CPU admission between room transitions and persistence work.
    pub fn cpu_pool(&self) -> crate::cpu::CpuPool {
        self.inner.cpu.clone()
    }
    pub fn ownership_available(&self) -> bool {
        self.inner.available.load(Ordering::Acquire)
    }
    fn available(&self) -> Result<()> {
        ensure!(
            self.inner.available.load(Ordering::Acquire),
            "Database ownership unavailable"
        );
        Ok(())
    }
    pub(crate) async fn fenced(&self) -> Result<Transaction<'_, Postgres>> {
        self.available()?;
        let mut tx = self.pool.begin().await?;
        let token: Option<String> =
            sqlx::query_scalar("SELECT token FROM avalon_runtime WHERE id=1 FOR SHARE")
                .fetch_optional(&mut *tx)
                .await?;
        if token.as_deref() != Some(&self.inner.token) {
            self.inner.available.store(false, Ordering::Release);
            anyhow::bail!("Database ownership lost");
        }
        Ok(tx)
    }
    pub async fn health(&self) -> Result<()> {
        let tx = self.fenced().await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn close(&self) {
        self.inner.available.store(false, Ordering::Release);
        if let Some(owner) = self.inner.owner.lock().await.take() {
            let _ = owner.close().await;
        }
        self.pool.close().await;
    }
    pub async fn list_room_codes(&self) -> Result<Vec<String>> {
        self.available()?;
        Ok(
            sqlx::query_scalar("SELECT code FROM avalon_rooms ORDER BY code")
                .fetch_all(&self.pool)
                .await?,
        )
    }
    pub async fn load_room(&self, code: &str) -> Result<Option<RoomRecord>> {
        self.available()?;
        let row=sqlx::query("SELECT r.*,COALESCE((SELECT jsonb_agg(j.entry || jsonb_build_object('version',j.version) ORDER BY j.version) FROM avalon_room_journal j WHERE j.code=r.code AND j.version>r.snapshot_version),'[]'::jsonb) AS entries FROM avalon_rooms r WHERE code=$1").bind(code).fetch_optional(&self.pool).await?;
        match row {
            Some(row) => Ok(Some(self.inner.cpu.run(move || decode_room(row)).await??)),
            None => Ok(None),
        }
    }
    pub async fn save_room(
        &self,
        code: &str,
        version: i64,
        document: &Value,
        spend_account: Option<&str>,
    ) -> Result<i64> {
        self.save_room_shared(
            code,
            version,
            Arc::new(document.clone()),
            None,
            spend_account,
        )
        .await
    }
    pub async fn save_room_from_previous(
        &self,
        code: &str,
        version: i64,
        document: &Value,
        previous: Option<&Value>,
        spend_account: Option<&str>,
    ) -> Result<i64> {
        self.save_room_shared(
            code,
            version,
            Arc::new(document.clone()),
            previous.map(|v| Arc::new(v.clone())),
            spend_account,
        )
        .await
    }
    /// The hot path transfers shared ownership without cloning the room on the I/O thread.
    pub async fn save_room_shared(
        &self,
        code: &str,
        version: i64,
        document: Arc<Value>,
        previous: Option<Arc<Value>>,
        spend_account: Option<&str>,
    ) -> Result<i64> {
        self.available()?;
        let doc = document.clone();
        let can_skip = version > 0 && spend_account.is_none();
        let prepared = self.inner.cpu.run(move || {
            let changes=previous.as_ref().map(|before|diff_state(before,&doc));
            if can_skip && changes.as_ref().is_some_and(Vec::is_empty) {return None;}
            let hash=document_hash(&doc);
            let change=previous.zip(changes).map(|(before,changes)| json!({"format":1,"baseHash":document_hash(&before),"hash":hash,"changes":changes}));
            let initial_json=if version==0 {Some(serde_json::to_string(doc.as_ref()).expect("JSON"))}else{None};
            Some((hash,change,initial_json))
        }).await?;
        let Some((hash, prepared, initial_json)) = prepared else {
            self.available()?;
            return Ok(version);
        };
        let mut tx = self.fenced().await?;
        let next = version
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("Room version overflow"))?;
        let next_i = i32::try_from(next)?;
        let ver_i = i32::try_from(version)?;
        let result = if version == 0 {
            sqlx::query("INSERT INTO avalon_rooms(code,version,document,snapshot_version,snapshot_hash,state_hash) VALUES($1,$2,$3::jsonb,$2,$4,$4) ON CONFLICT(code) DO NOTHING").bind(code).bind(next_i).bind(initial_json).bind(&hash).execute(&mut *tx).await?
        } else {
            let change = if let Some(change) = prepared {
                change
            } else {
                let row=sqlx::query("SELECT r.*,COALESCE((SELECT jsonb_agg(j.entry || jsonb_build_object('version',j.version) ORDER BY j.version) FROM avalon_room_journal j WHERE j.code=r.code AND j.version>r.snapshot_version),'[]'::jsonb) AS entries FROM avalon_rooms r WHERE code=$1 FOR UPDATE").bind(code).fetch_optional(&mut *tx).await?.ok_or_else(||anyhow::anyhow!("RoomConflict"))?;
                let doc = document.clone();
                let h = hash.clone();
                self.inner.cpu.run(move||->Result<Value>{let old=decode_room(row)?;ensure!(old.version==version,"RoomConflict");Ok(json!({"format":1,"baseHash":document_hash(&old.document),"hash":h,"changes":diff_state(&old.document,&doc)}))}).await??
            };
            let base_hash = change["baseHash"].as_str().unwrap_or_default().to_owned();
            let encoded_change = self
                .inner
                .cpu
                .run(move || serde_json::to_string(&change).expect("JSON"))
                .await?;
            let result=sqlx::query("UPDATE avalon_rooms SET version=$2,state_hash=$3,updated_at=now() WHERE code=$1 AND version=$4 AND (state_hash IS NULL OR state_hash=$5)").bind(code).bind(next_i).bind(&hash).bind(ver_i).bind(base_hash).execute(&mut *tx).await?;
            ensure!(result.rows_affected() == 1, "RoomConflict");
            sqlx::query(
                "INSERT INTO avalon_room_journal(code,version,entry) VALUES($1,$2,$3::jsonb)",
            )
            .bind(code)
            .bind(next_i)
            .bind(encoded_change)
            .execute(&mut *tx)
            .await?;
            result
        };
        ensure!(result.rows_affected() == 1, "RoomConflict");
        sqlx::query("UPDATE avalon_rooms SET public_listing=$2 WHERE code=$1")
            .bind(code)
            .bind(public_listing(&document))
            .execute(&mut *tx)
            .await?;
        if let Some(account) = spend_account {
            ensure!(
                sqlx::query("UPDATE avalon_cards SET cards=cards-1 WHERE account=$1 AND cards>0")
                    .bind(account)
                    .execute(&mut *tx)
                    .await?
                    .rows_affected()
                    == 1,
                "No reroll cards remaining"
            );
        }
        self.archive(&mut tx, document.clone()).await?;
        tx.commit().await?;
        Ok(next)
    }
    pub async fn delete_room(&self, code: &str, version: i64) -> Result<()> {
        let mut tx = self.fenced().await?;
        ensure!(
            sqlx::query("DELETE FROM avalon_rooms WHERE code=$1 AND version=$2")
                .bind(code)
                .bind(i32::try_from(version)?)
                .execute(&mut *tx)
                .await?
                .rows_affected()
                == 1,
            "RoomConflict"
        );
        tx.commit().await?;
        Ok(())
    }
    pub async fn checkpoint_room(&self, code: &str, version: i64, document: &Value) -> Result<()> {
        self.checkpoint_room_shared(code, version, Arc::new(document.clone()))
            .await
    }
    /// Snapshot serialization and replay verification stay off Tokio's I/O workers.
    pub async fn checkpoint_room_shared(
        &self,
        code: &str,
        version: i64,
        document: Arc<Value>,
    ) -> Result<()> {
        let (hash, encoded) = self
            .inner
            .cpu
            .run(move || {
                (
                    document_hash(&document),
                    serde_json::to_string(document.as_ref()).expect("JSON"),
                )
            })
            .await?;
        let mut tx = self.fenced().await?;
        let row=sqlx::query("SELECT version,document,snapshot_version,snapshot_hash FROM avalon_rooms WHERE code=$1 FOR UPDATE").bind(code).fetch_optional(&mut *tx).await?.ok_or_else(||anyhow::anyhow!("RoomConflict"))?;
        let head: i32 = row.try_get("version")?;
        let snap: i32 = row.try_get("snapshot_version")?;
        ensure!(i64::from(head) >= version, "RoomConflict");
        if i64::from(snap) < version {
            let entries=sqlx::query("SELECT entry || jsonb_build_object('version',version) AS entry FROM avalon_room_journal WHERE code=$1 AND version>$2 AND version<=$3 ORDER BY version").bind(code).bind(snap).bind(i32::try_from(version)?).fetch_all(&mut *tx).await?;
            let h = hash.clone();
            self.inner
                .cpu
                .run(move || -> Result<()> {
                    let snapshot: Value = row.try_get("document")?;
                    let old_hash: Option<String> = row.try_get("snapshot_hash")?;
                    let entries: Vec<Value> = entries
                        .into_iter()
                        .map(|r| r.try_get("entry"))
                        .collect::<Result<_, _>>()?;
                    replay_journal(
                        snapshot,
                        i64::from(snap),
                        old_hash.as_deref(),
                        &entries,
                        version,
                        Some(&h),
                    )?;
                    Ok(())
                })
                .await??;
            sqlx::query("UPDATE avalon_rooms SET document=$2::jsonb,snapshot_version=$3,snapshot_hash=$4 WHERE code=$1").bind(code).bind(encoded).bind(i32::try_from(version)?).bind(hash).execute(&mut *tx).await?;
            sqlx::query("DELETE FROM avalon_room_journal WHERE code=$1 AND version<=$2")
                .bind(code)
                .bind(i32::try_from(version)?)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }
    async fn archive(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        document: Arc<Value>,
    ) -> Result<()> {
        let d = document.as_ref();
        let Some(a) = d.get("archive").filter(|v| !v.is_null()) else {
            return Ok(());
        };
        let replay = &a["replay"];
        let id = replay["gameId"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow::anyhow!("Cannot archive unfinished game"))?;
        ensure!(
            !replay["outcome"].is_null(),
            "Cannot archive unfinished game"
        );
        let (seats, altered) = archive_links(d);
        let owned = document.clone();
        let encoded_replay = self
            .inner
            .cpu
            .run(move || serde_json::to_string(&owned["archive"]["replay"]).expect("JSON"))
            .await?;
        let changed=sqlx::query("INSERT INTO avalon_replays(game_id,revision,payload,altered) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(game_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,altered=excluded.altered,rating_import=NULL,updated_at=now() WHERE excluded.revision>avalon_replays.revision").bind(id).bind(i32::try_from(a["revision"].as_i64().unwrap_or(0))?).bind(encoded_replay).bind(altered).execute(&mut **tx).await?.rows_affected()>0;
        if changed {
            write_seats(tx, id, &seats).await?;
        }
        let long = replay["endedAt"]
            .as_f64()
            .zip(replay["startedAt"].as_f64())
            .is_some_and(|(end, start)| end - start > 600_000.);
        if changed && long {
            let mut accounts: Vec<_> = a["rewardAccounts"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            accounts.sort();
            accounts.dedup();
            for account in accounts {
                if sqlx::query("INSERT INTO avalon_game_rewards(game_id,account) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(id).bind(account).execute(&mut **tx).await?.rows_affected()>0 {sqlx::query("INSERT INTO avalon_cards(account,completed_games) VALUES($1,1) ON CONFLICT(account) DO UPDATE SET completed_games=avalon_cards.completed_games+1,cards=LEAST(1,avalon_cards.cards+CASE WHEN (avalon_cards.completed_games+1)%5=0 THEN 1 ELSE 0 END)").bind(account).execute(&mut **tx).await?;}
            }
        }
        if d["game"]["phase"] == "GameOver"
            && let Some(assignments) = a["roleWeightAssignments"].as_object()
        {
            sqlx::query("SAVEPOINT role_preferences")
                .execute(&mut **tx)
                .await?;
            let result = settle_roles(tx, id, assignments).await;
            if result.is_err() {
                sqlx::query("ROLLBACK TO SAVEPOINT role_preferences")
                    .execute(&mut **tx)
                    .await?;
                tracing::warn!("Optional role settlement unavailable; game retained");
            }
            sqlx::query("RELEASE SAVEPOINT role_preferences")
                .execute(&mut **tx)
                .await?;
        }
        Ok(())
    }
    pub async fn get_cards(&self, account: &str, claim_at: Option<i64>) -> Result<Value> {
        let day = claim_at
            .and_then(|ms| chrono::DateTime::from_timestamp_millis(ms + 14_400_000))
            .map(|d| d.format("%Y-%m-%d").to_string());
        let row=sqlx::query("INSERT INTO avalon_cards(account,cards,last_daily_day) VALUES($1,CASE WHEN $2::text IS NULL THEN 0 ELSE 1 END,$2) ON CONFLICT(account) DO UPDATE SET cards=CASE WHEN $2::text IS NOT NULL AND (avalon_cards.last_daily_day IS NULL OR avalon_cards.last_daily_day<$2) THEN LEAST(1,avalon_cards.cards+1) ELSE avalon_cards.cards END,last_daily_day=CASE WHEN $2::text IS NOT NULL AND (avalon_cards.last_daily_day IS NULL OR avalon_cards.last_daily_day<$2) THEN $2 ELSE avalon_cards.last_daily_day END RETURNING cards,completed_games,last_daily_day").bind(account).bind(day).fetch_one(&self.pool).await?;
        wallet(row)
    }
    pub async fn grant_debug_card(&self, account: &str) -> Result<Value> {
        wallet(sqlx::query("INSERT INTO avalon_cards(account,cards) VALUES($1,1) ON CONFLICT(account) DO UPDATE SET cards=LEAST(1,avalon_cards.cards+1) RETURNING cards,completed_games,last_daily_day").bind(account).fetch_one(&self.pool).await?)
    }
    pub async fn get_preferences(&self, account: &str) -> Result<Value> {
        Ok(
            sqlx::query_scalar("SELECT preferences FROM avalon_profiles WHERE account=$1")
                .bind(account)
                .fetch_optional(&self.pool)
                .await?
                .unwrap_or(json!({})),
        )
    }
    pub async fn save_preferences(&self, account: &str, patch: &Value) -> Result<Value> {
        Ok(sqlx::query_scalar("INSERT INTO avalon_profiles(account,preferences) VALUES($1,$2) ON CONFLICT(account) DO UPDATE SET preferences=avalon_profiles.preferences || excluded.preferences RETURNING preferences").bind(account).bind(patch).fetch_one(&self.pool).await?)
    }
    pub async fn get_alias(&self, account: &str) -> Result<Option<String>> {
        Ok(
            sqlx::query_scalar::<_, String>("SELECT alias FROM avalon_profiles WHERE account=$1")
                .bind(account)
                .fetch_optional(&self.pool)
                .await?
                .filter(|s| !s.is_empty()),
        )
    }
    pub async fn set_alias(&self, account: &str, alias: &str) -> Result<String> {
        sqlx::query("INSERT INTO avalon_profiles(account,alias) VALUES($1,$2) ON CONFLICT(account) DO UPDATE SET alias=excluded.alias").bind(account).bind(alias).execute(&self.pool).await?;
        Ok(alias.to_owned())
    }
    pub async fn get_role_weights(&self, accounts: &[String]) -> Result<Value> {
        let rows = sqlx::query(
            "SELECT account,weights FROM avalon_role_weights WHERE account=ANY($1::text[])",
        )
        .bind(accounts)
        .fetch_all(&self.pool)
        .await?;
        let mut out = serde_json::Map::new();
        for row in rows {
            out.insert(
                row.try_get("account")?,
                normalize_weights(&row.try_get::<Value, _>("weights")?),
            );
        }
        Ok(Value::Object(out))
    }
    pub async fn load_replay(&self, id: &str) -> Result<Option<Value>> {
        let row = sqlx::query("SELECT payload FROM avalon_replays WHERE game_id=$1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        self.inner
            .cpu
            .run(move || {
                row.map(|r| r.try_get::<Value, _>("payload"))
                    .transpose()
                    .map_err(anyhow::Error::from)
            })
            .await?
    }
    pub async fn find_seat(&self, id: &str, account: &str) -> Result<Option<String>> {
        Ok(sqlx::query_scalar(
            "SELECT player_id FROM avalon_game_seats WHERE game_id=$1 AND account=$2 LIMIT 1",
        )
        .bind(id)
        .bind(account)
        .fetch_optional(&self.pool)
        .await?)
    }
    pub async fn game_records_version(&self) -> Result<String> {
        Ok(sqlx::query_scalar("SELECT concat_ws(':',(SELECT count(*) FROM avalon_replays),(SELECT max(updated_at) FROM avalon_replays),(SELECT count(*) FROM avalon_game_seats),(SELECT count(*) FROM avalon_game_rewards),(SELECT count(*) FROM avalon_role_weight_games))").fetch_one(&self.pool).await?)
    }
    pub async fn list_game_records(&self) -> Result<Vec<Value>> {
        let rows=sqlx::query("SELECT r.payload,r.altered,r.rating_import,(SELECT jsonb_object_agg(s.player_id,s.account) FROM avalon_game_seats s WHERE s.game_id=r.game_id) AS seats,ARRAY(SELECT w.account FROM avalon_game_rewards w WHERE w.game_id=r.game_id UNION SELECT w.account FROM avalon_role_weight_games w WHERE w.game_id=r.game_id) AS participants FROM avalon_replays r ORDER BY r.game_id").fetch_all(&self.pool).await?;
        self.inner.cpu.run(move||rows.into_iter().map(|r|Ok(json!({"replay":r.try_get::<Value,_>("payload")?,"altered":r.try_get::<Option<bool>,_>("altered")?,"seats":r.try_get::<Option<Value>,_>("seats")?.unwrap_or(json!({})),"participants":r.try_get::<Vec<String>,_>("participants")?,"ratingImport":r.try_get::<Option<String>,_>("rating_import")?}))).collect()).await?
    }
    pub async fn list_public_rooms(&self, page: i64) -> Result<Value> {
        self.available()?;
        let rows:Vec<Value>=sqlx::query_scalar("SELECT public_listing FROM avalon_rooms WHERE public_listing IS NOT NULL ORDER BY code").fetch_all(&self.pool).await?;
        let pages = (rows.len().div_ceil(5) as i64).max(1);
        let page = page.clamp(1, pages);
        Ok(
            json!({"rooms":rows.into_iter().skip(((page-1)*5)as usize).take(5).collect::<Vec<_>>(),"page":page,"totalPages":pages}),
        )
    }
}
fn decode_room(row: PgRow) -> Result<RoomRecord> {
    let version = i64::from(row.try_get::<i32, _>("version")?);
    let snapshot = i64::from(row.try_get::<i32, _>("snapshot_version")?);
    let sh: Option<String> = row.try_get("snapshot_hash")?;
    let hh: Option<String> = row.try_get("state_hash")?;
    let entries: Value = row.try_get("entries")?;
    Ok(RoomRecord {
        version,
        document: replay_journal(
            row.try_get("document")?,
            snapshot,
            sh.as_deref(),
            entries
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("Invalid entries"))?,
            version,
            hh.as_deref(),
        )?,
    })
}
fn public_listing(d: &Value) -> Option<Value> {
    let meta = &d["meta"];
    let count = d["members"]
        .as_array()?
        .iter()
        .filter(|m| m["claimed"] == true && m["isSpectator"] != true)
        .count();
    let max = meta["config"]["maxPlayers"].as_u64()?;
    if meta["visibility"] != "public" || meta["status"] != "lobby" || count as u64 >= max {
        return None;
    }
    Some(
        json!({"code":meta["code"],"name":meta["name"].as_str().unwrap_or(""),"playerCount":count,"maxPlayers":max}),
    )
}
fn wallet(row: PgRow) -> Result<Value> {
    Ok(
        json!({"cards":row.try_get::<i32,_>("cards")?,"completedGames":row.try_get::<i32,_>("completed_games")?,"lastDailyDay":row.try_get::<Option<String>,_>("last_daily_day")?}),
    )
}
fn archive_links(d: &Value) -> (Value, Option<bool>) {
    let a = &d["archive"];
    if a["seats"].is_object() {
        return (a["seats"].clone(), a["altered"].as_bool());
    }
    let altered = d["events"].as_array().into_iter().flatten().any(|e| {
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
    (
        d.get("gameAccounts").cloned().unwrap_or(json!({})),
        Some(altered),
    )
}
async fn write_seats(tx: &mut Transaction<'_, Postgres>, id: &str, seats: &Value) -> Result<()> {
    sqlx::query("DELETE FROM avalon_game_seats WHERE game_id=$1")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    if let Some(seats) = seats.as_object() {
        for (player, account) in seats {
            sqlx::query(
                "INSERT INTO avalon_game_seats(game_id,player_id,account) VALUES($1,$2,$3)",
            )
            .bind(id)
            .bind(player)
            .bind(
                account
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("Invalid account link"))?,
            )
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}
async fn settle_roles(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
    assignments: &serde_json::Map<String, Value>,
) -> Result<()> {
    let mut entries: Vec<_> = assignments.iter().collect();
    entries.sort_by(|a, b| a.0.cmp(b.0));
    for (account, role) in entries {
        let Some(role) = role.as_str().filter(|r| ROLES.contains(r)) else {
            continue;
        };
        if sqlx::query("INSERT INTO avalon_role_weight_games(game_id,account) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(id).bind(account).execute(&mut **tx).await?.rows_affected()==0{continue;}
        sqlx::query("INSERT INTO avalon_role_weights(account) VALUES($1) ON CONFLICT DO NOTHING")
            .bind(account)
            .execute(&mut **tx)
            .await?;
        let current: Value = sqlx::query_scalar(
            "SELECT weights FROM avalon_role_weights WHERE account=$1 FOR UPDATE",
        )
        .bind(account)
        .fetch_one(&mut **tx)
        .await?;
        let mut weights = normalize_weights(&current);
        for r in ROLES {
            weights[r] = json!(if r == role {
                (weights[r].as_f64().unwrap() - 25.).max(50.)
            } else {
                weights[r].as_f64().unwrap() + 25.
            });
        }
        sqlx::query("UPDATE avalon_role_weights SET weights=$2 WHERE account=$1")
            .bind(account)
            .bind(weights)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}
