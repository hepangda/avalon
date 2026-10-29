//! Typed history read model. JSON is decoded once when the archive cache rebuilds.
use crate::{
    engine::typed::{Role, Team, WinReason},
    ratings::{self, ArchivedRole, Exclusion, Fit, PublicRating, Record},
    storage::Database,
};
use anyhow::Result;
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, OnceLock},
};
use tokio::sync::Semaphore;

#[derive(Debug, Clone, Copy, Default, Serialize)]
struct Totals {
    games: usize,
    wins: usize,
}
impl Totals {
    fn record(&mut self, won: bool) {
        self.games += 1;
        self.wins += usize::from(won);
    }
}
#[derive(Debug, Serialize)]
struct Teams {
    good: Totals,
    evil: Totals,
}
#[derive(Debug, Serialize)]
struct RoleStats {
    role: Role,
    games: usize,
    wins: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    rating: PublicRating,
    trend: Vec<f64>,
    total: Totals,
    unresolved_games: usize,
    teams: Teams,
    roles: Vec<RoleStats>,
    form: Vec<bool>,
}
#[derive(Debug, Serialize)]
#[serde(untagged)]
enum SeatRecord {
    Hidden {
        rating: PublicRating,
        hidden: bool,
    },
    Visible {
        rating: PublicRating,
        total: Totals,
        teams: Teams,
        roles: Vec<RoleStats>,
        form: Vec<bool>,
    },
}
#[derive(Debug, Serialize)]
struct OwnSeat {
    role: Role,
    won: bool,
    delta: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    variant: Option<u8>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryGame {
    game_id: String,
    ended_at: Option<i64>,
    player_count: usize,
    winner: Team,
    reason: Option<WinReason>,
    missions: Vec<bool>,
    unrated: Option<Exclusion>,
    participation_only: bool,
    seat: Option<OwnSeat>,
}
#[derive(Debug, Serialize)]
struct HistoryPage {
    total: usize,
    next: Option<usize>,
    games: Vec<HistoryGame>,
}

pub struct RecordBook {
    games: Vec<Arc<Record>>,
    rated: Vec<Arc<Record>>,
    fit: Fit,
    prefixes: BTreeMap<usize, BTreeMap<String, f64>>,
    pub include_bots: bool,
}
fn ended(game: &Record) -> i64 {
    game.replay.ended_at.or(game.replay.started_at).unwrap_or(0)
}
fn seat<'a>(game: &'a Record, account: &str) -> Option<&'a ArchivedRole> {
    let id = game.seats.iter().find(|(_, a)| a.as_str() == account)?.0;
    game.replay
        .role_assignments
        .iter()
        .find(|r| &r.player_id == id)
}
fn participated(game: &Record, account: &str) -> bool {
    seat(game, account).is_some() || game.participants.iter().any(|a| a == account)
}
fn now() -> i64 {
    crate::now_ms()
}
impl RecordBook {
    pub fn from_json(records: Vec<Value>, include_bots: bool) -> Result<Self> {
        let parsed: Vec<Record> = records
            .into_iter()
            .map(serde_json::from_value)
            .collect::<std::result::Result<_, _>>()?;
        Self::new(parsed, include_bots)
    }
    pub fn new(records: Vec<Record>, include_bots: bool) -> Result<Self> {
        let mut games: Vec<_> = records
            .into_iter()
            .filter(|g| g.replay.outcome.is_some() && g.visible(include_bots))
            .map(Arc::new)
            .collect();
        games.sort_by(|a, b| {
            ended(b)
                .cmp(&ended(a))
                .then_with(|| a.replay.game_id.cmp(&b.replay.game_id))
        });
        let rated: Vec<_> = games
            .iter()
            .filter(|g| g.exclusion(include_bots).is_none())
            .rev()
            .cloned()
            .collect();
        let fit = ratings::fit_records(rated.iter().map(AsRef::as_ref), include_bots)?;
        Ok(Self {
            games,
            rated,
            fit,
            prefixes: BTreeMap::from([(0, BTreeMap::new())]),
            include_bots,
        })
    }
    fn scores_after(&mut self, count: usize) -> Result<&BTreeMap<String, f64>> {
        if !self.prefixes.contains_key(&count) {
            let partial;
            let fit = if count == self.rated.len() {
                &self.fit
            } else {
                partial = ratings::fit_records(
                    self.rated[..count].iter().map(AsRef::as_ref),
                    self.include_bots,
                )?;
                &partial
            };
            self.prefixes.insert(
                count,
                fit.players
                    .iter()
                    .map(|(a, p)| (a.clone(), ratings::public_rating(Some(p), now()).score))
                    .collect(),
            );
        }
        Ok(&self.prefixes[&count])
    }
    fn score_after(&mut self, count: usize, account: &str) -> Result<f64> {
        Ok(*self
            .scores_after(count)?
            .get(account)
            .unwrap_or(&ratings::INITIAL_SCORE))
    }
    fn delta(&mut self, game_id: &str, account: &str) -> Result<Option<f64>> {
        let Some(index) = self.rated.iter().position(|g| g.replay.game_id == game_id) else {
            return Ok(None);
        };
        Ok(Some(ratings::round_tenth(
            self.score_after(index + 1, account)? - self.score_after(index, account)?,
        )))
    }
    fn profile_typed(&mut self, account: &str) -> Result<Profile> {
        let mut unresolved = 0;
        let mut total = Totals::default();
        let mut teams = Teams {
            good: Totals::default(),
            evil: Totals::default(),
        };
        let mut roles = BTreeMap::<Role, Totals>::new();
        let mut form = Vec::new();
        for game in &self.games {
            let Some(assignment) = seat(game, account) else {
                if participated(game, account) {
                    unresolved += 1;
                }
                continue;
            };
            let role = assignment.role;
            let team = role.team();
            let won = game
                .replay
                .outcome
                .as_ref()
                .expect("completed archive")
                .winner
                == team;
            total.record(won);
            match team {
                Team::Good => teams.good.record(won),
                Team::Evil => teams.evil.record(won),
            };
            roles.entry(role).or_default().record(won);
            if form.len() < 10 {
                form.push(won);
            }
        }
        let played: Vec<_> = self
            .rated
            .iter()
            .enumerate()
            .filter(|(_, g)| g.seats.values().any(|a| a == account))
            .map(|(i, _)| i)
            .collect();
        let played = &played[played.len().saturating_sub(20)..];
        let mut trend = Vec::new();
        if let Some(first) = played.first() {
            trend.push(self.score_after(*first, account)?);
            for i in played {
                trend.push(self.score_after(i + 1, account)?);
            }
        }
        let mut roles: Vec<_> = roles
            .into_iter()
            .map(|(role, t)| RoleStats {
                role,
                games: t.games,
                wins: t.wins,
            })
            .collect();
        roles.sort_by(|a, b| {
            b.games
                .cmp(&a.games)
                .then(b.wins.cmp(&a.wins))
                .then(a.role.as_str().cmp(b.role.as_str()))
        });
        Ok(Profile {
            rating: ratings::public_rating(self.fit.players.get(account), now()),
            trend,
            total,
            unresolved_games: unresolved,
            teams,
            roles,
            form,
        })
    }
    pub fn profile(&mut self, account: &str) -> Result<Value> {
        Ok(serde_json::to_value(self.profile_typed(account)?)?)
    }
    pub fn seat_record(&mut self, account: &str, hidden: bool) -> Result<Value> {
        let record = if hidden {
            SeatRecord::Hidden {
                rating: ratings::public_rating(self.fit.players.get(account), now()),
                hidden: true,
            }
        } else {
            let p = self.profile_typed(account)?;
            SeatRecord::Visible {
                rating: p.rating,
                total: p.total,
                teams: p.teams,
                roles: p.roles.into_iter().take(3).collect(),
                form: p.form,
            }
        };
        Ok(serde_json::to_value(record)?)
    }
    pub fn games_page(&mut self, account: &str, offset: usize) -> Result<Value> {
        let selected: Vec<_> = self
            .games
            .iter()
            .filter(|g| participated(g, account))
            .cloned()
            .collect();
        let total = selected.len();
        let mut games = Vec::new();
        for game in selected.into_iter().skip(offset).take(30) {
            let r = &game.replay;
            let outcome = r.outcome.as_ref().expect("completed archive");
            let own = seat(&game, account);
            let seat = match own {
                Some(a) => Some(OwnSeat {
                    role: a.role,
                    won: outcome.winner == a.role.team(),
                    delta: self.delta(&r.game_id, account)?,
                    variant: a.role_variant,
                }),
                None => None,
            };
            let mut rounds: Vec<_> = r.rounds.iter().collect();
            rounds.sort_by_key(|r| r.round_index);
            games.push(HistoryGame {
                game_id: r.game_id.clone(),
                ended_at: r.ended_at,
                player_count: r.players.len(),
                winner: outcome.winner,
                reason: outcome.reason,
                missions: rounds
                    .into_iter()
                    .filter_map(|r| r.mission_success)
                    .collect(),
                unrated: game.exclusion(self.include_bots),
                participation_only: own.is_none() && participated(&game, account),
                seat,
            });
        }
        Ok(serde_json::to_value(HistoryPage {
            total,
            next: (offset.saturating_add(30) < total).then_some(offset + 30),
            games,
        })?)
    }
}

// Admission happens before fetching archives or spawning any CPU job. At most two
// archive builds / rating queries are admitted, and excess HTTP work is rejected.
static ADMISSION: OnceLock<Arc<Semaphore>> = OnceLock::new();
static CACHE: OnceLock<Mutex<Option<(String, RecordBook)>>> = OnceLock::new();
pub async fn query<F>(db: &Database, include_bots: bool, job: F) -> Result<Value>
where
    F: FnOnce(&mut RecordBook) -> Result<Value> + Send + 'static,
{
    let permit = ADMISSION
        .get_or_init(|| Arc::new(Semaphore::new(2)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| anyhow::anyhow!("HISTORY_BUSY"))?;
    let options = db.pool.connect_options();
    let version = json!([
        options.get_host(),
        options.get_port(),
        options.get_database(),
        options.get_username(),
        db.game_records_version().await?,
        include_bots
    ])
    .to_string();
    let cached = CACHE.get_or_init(|| Mutex::new(None));
    let needs_build = cached
        .try_lock()
        .map(|cache| cache.as_ref().is_none_or(|(key, _)| key != &version))
        .unwrap_or(true);
    let records = if needs_build {
        Some(db.list_game_records().await?)
    } else {
        None
    };
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let mut cache = cached
            .lock()
            .map_err(|_| anyhow::anyhow!("history lock poisoned"))?;
        if cache.as_ref().is_none_or(|(key, _)| key != &version) {
            let records = records.ok_or_else(|| anyhow::anyhow!("HISTORY_BUSY"))?;
            *cache = Some((version, RecordBook::from_json(records, include_bots)?));
        }
        job(&mut cache.as_mut().unwrap().1)
    })
    .await?
}
