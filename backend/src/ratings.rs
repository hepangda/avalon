//! Bradley–Terry MAP ratings. This is the existing calibrated model, including its
//! joint Laplace covariance; it must only run on the bounded CPU executor.
use crate::engine::typed::{GameOptions, PlayerId, Role, Team, WinReason};
use anyhow::{Result, bail};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

pub mod codec;

pub const VERSION: &str = "bt-map-v1-deviation-v2";
pub const INITIAL_SCORE: f64 = 50.;
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedPlayer {
    pub id: PlayerId,
    #[serde(default)]
    pub is_bot: Option<bool>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedRole {
    pub player_id: PlayerId,
    pub role: Role,
    #[serde(default)]
    pub role_variant: Option<u8>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedOutcome {
    pub winner: Team,
    #[serde(default)]
    pub reason: Option<WinReason>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedRound {
    pub round_index: usize,
    #[serde(default)]
    pub mission_success: Option<bool>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedReplay {
    pub game_id: String,
    #[serde(default)]
    pub players: Vec<ArchivedPlayer>,
    #[serde(default)]
    pub role_assignments: Vec<ArchivedRole>,
    #[serde(default)]
    pub outcome: Option<ArchivedOutcome>,
    #[serde(default)]
    pub options: Option<GameOptions>,
    #[serde(default)]
    pub rounds: Vec<ArchivedRound>,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub ended_at: Option<i64>,
}
#[derive(Clone, Copy, Debug, serde::Deserialize, PartialEq, Eq)]
pub enum RatingImport {
    #[serde(rename = "name-recovery-v1")]
    NameRecoveryV1,
    #[serde(other)]
    Unknown,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub replay: ArchivedReplay,
    #[serde(default)]
    pub altered: Option<bool>,
    #[serde(default)]
    pub seats: BTreeMap<PlayerId, String>,
    #[serde(default)]
    pub participants: Vec<String>,
    #[serde(default)]
    pub rating_import: Option<RatingImport>,
}
#[derive(Clone, Copy, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Exclusion {
    Bots,
    Legacy,
    Identity,
    Invalid,
}
impl Exclusion {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bots => "bots",
            Self::Legacy => "legacy",
            Self::Identity => "identity",
            Self::Invalid => "invalid",
        }
    }
}
impl Record {
    pub fn participant(&self, id: &PlayerId) -> Option<String> {
        if self
            .replay
            .players
            .iter()
            .any(|p| p.id == *id && p.is_bot == Some(true))
        {
            Some(serde_json::to_string(&("local-rating-bot", id)).expect("identity tuple"))
        } else {
            self.seats.get(id).filter(|a| !a.is_empty()).cloned()
        }
    }
    pub fn visible(&self, include_bots: bool) -> bool {
        include_bots || !self.replay.players.iter().any(|p| p.is_bot == Some(true))
    }
    pub fn exclusion(&self, include_bots: bool) -> Option<Exclusion> {
        if !self.visible(include_bots) {
            return Some(Exclusion::Bots);
        }
        if (self.altered.is_none() || self.replay.options.is_none())
            && self.rating_import != Some(RatingImport::NameRecoveryV1)
        {
            return Some(Exclusion::Legacy);
        }
        let players = &self.replay.players;
        let accounts: Vec<_> = players.iter().map(|p| self.participant(&p.id)).collect();
        if accounts.iter().any(Option::is_none)
            || accounts.iter().collect::<BTreeSet<_>>().len() != accounts.len()
        {
            return Some(Exclusion::Identity);
        }
        let roles = &self.replay.role_assignments;
        if !(5..=10).contains(&players.len())
            || roles.len() != players.len()
            || roles
                .iter()
                .map(|a| &a.player_id)
                .collect::<BTreeSet<_>>()
                .len()
                != players.len()
            || players
                .iter()
                .any(|p| !roles.iter().any(|a| a.player_id == p.id))
        {
            return Some(Exclusion::Invalid);
        }
        let good = roles.iter().filter(|a| a.role.team() == Team::Good).count();
        if good == 0 || good == players.len() || self.replay.outcome.is_none() {
            return Some(Exclusion::Invalid);
        }
        None
    }
}
fn configuration(r: &ArchivedReplay) -> String {
    let mut roles: Vec<_> = r.role_assignments.iter().map(|a| a.role.as_str()).collect();
    roles.sort_unstable();
    let known = r.options.is_some();
    let key = json!([
        roles,
        if known {
            "known-rules"
        } else {
            "legacy-unknown-rules"
        },
        r.options.as_ref().map(|o| o.lady_of_the_lake),
        r.options.as_ref().map(|o| o.max_rejections.unwrap_or(5.))
    ]);
    crate::journal::canonical_json(&key)
}
fn factor(a: &[Vec<f64>]) -> Result<Vec<Vec<f64>>> {
    let mut l = vec![vec![0.; a.len()]; a.len()];
    for i in 0..a.len() {
        for j in 0..=i {
            let s = a[i][j] - (0..j).map(|k| l[i][k] * l[j][k]).sum::<f64>();
            if i == j && s <= 0. {
                bail!("Rating Hessian is not positive definite");
            }
            l[i][j] = if i == j { s.sqrt() } else { s / l[j][j] };
        }
    }
    Ok(l)
}
fn solve(l: &[Vec<f64>], b: &[f64]) -> Vec<f64> {
    let mut x = b.to_vec();
    for i in 0..x.len() {
        for j in 0..i {
            x[i] -= l[i][j] * x[j];
        }
        x[i] /= l[i][i];
    }
    for i in (0..x.len()).rev() {
        for j in i + 1..x.len() {
            x[i] -= l[j][i] * x[j];
        }
        x[i] /= l[i][i];
    }
    x
}
#[derive(Debug, Clone)]
pub struct Player {
    pub hidden: f64,
    pub sd: f64,
    pub games: usize,
    pub last_played: i64,
}
#[derive(Debug)]
pub struct Fit {
    pub players: BTreeMap<String, Player>,
    pub covariance: Vec<Vec<f64>>,
    pub parameters: Vec<f64>,
    pub accounts: Vec<String>,
    pub configs: Vec<String>,
}
struct Row {
    x: Vec<(usize, f64)>,
    y: f64,
}
fn objective(v: &[f64], precision: &[f64], rows: &[Row]) -> f64 {
    precision
        .iter()
        .zip(v)
        .map(|(p, x)| 0.5 * p * x * x)
        .sum::<f64>()
        + rows
            .iter()
            .map(|r| {
                let z = r.x.iter().map(|(i, w)| v[*i] * w).sum::<f64>();
                z.max(0.) + (-z.abs()).exp().ln_1p() - r.y * z
            })
            .sum::<f64>()
}
pub fn fit_records<'a>(
    input: impl IntoIterator<Item = &'a Record>,
    include_bots: bool,
) -> Result<Fit> {
    let mut games: Vec<_> = input
        .into_iter()
        .filter(|g| g.exclusion(include_bots).is_none())
        .collect();
    games.sort_by(|a, b| a.replay.game_id.cmp(&b.replay.game_id));
    let accounts: Vec<String> = games
        .iter()
        .flat_map(|g| g.replay.players.iter().filter_map(|p| g.participant(&p.id)))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let configs: Vec<String> = games
        .iter()
        .map(|g| configuration(&g.replay))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let d = accounts.len() + 1 + configs.len();
    let precision: Vec<f64> = (0..d)
        .map(|i| {
            if i < accounts.len() {
                1.
            } else if i == accounts.len() {
                1. / 0.7_f64.powi(2)
            } else {
                1. / 0.35_f64.powi(2)
            }
        })
        .collect();
    let mut rows = Vec::with_capacity(games.len());
    for g in &games {
        let r = &g.replay;
        let n = r.players.len();
        let roles = &r.role_assignments;
        let good = roles.iter().filter(|a| a.role.team() == Team::Good).count();
        let mut x: Vec<_> = roles
            .iter()
            .map(|a| {
                let id = g.participant(&a.player_id).expect("eligible identity");
                (
                    accounts.binary_search(&id).expect("indexed identity"),
                    if a.role.team() == Team::Good {
                        1. / good as f64
                    } else {
                        -1. / (n - good) as f64
                    },
                )
            })
            .collect();
        x.push((accounts.len(), 1.));
        x.push((
            accounts.len()
                + 1
                + configs
                    .binary_search(&configuration(r))
                    .expect("indexed configuration"),
            1.,
        ));
        rows.push(Row {
            x,
            y: if r.outcome.as_ref().expect("eligible outcome").winner == Team::Good {
                1.
            } else {
                0.
            },
        });
    }
    let mut v = vec![0.; d];
    let mut h = Vec::new();
    let mut converged = false;
    for _ in 0..60 {
        let mut gradient: Vec<_> = v.iter().zip(&precision).map(|(v, p)| v * p).collect();
        h = vec![vec![0.; d]; d];
        for i in 0..d {
            h[i][i] = precision[i];
        }
        for r in &rows {
            let p = 1. / (1. + (-r.x.iter().map(|(i, w)| v[*i] * w).sum::<f64>()).exp());
            for &(i, wi) in &r.x {
                gradient[i] += (p - r.y) * wi;
                for &(j, wj) in &r.x {
                    h[i][j] += p * (1. - p) * wi * wj;
                }
            }
        }
        if gradient.iter().map(|x| x.abs()).fold(0., f64::max) < 1e-8 {
            converged = true;
            break;
        }
        let step = solve(&factor(&h)?, &gradient);
        let before = objective(&v, &precision, &rows);
        let mut rate = 1.;
        loop {
            let next: Vec<_> = v.iter().zip(&step).map(|(v, s)| v - rate * s).collect();
            if rate <= 1e-8 || objective(&next, &precision, &rows) <= before {
                v = next;
                break;
            }
            rate /= 2.;
        }
    }
    if !converged {
        bail!("Rating fit did not converge");
    }
    let l = factor(&h)?;
    let covariance: Vec<Vec<f64>> = (0..d)
        .map(|i| {
            let mut b = vec![0.; d];
            b[i] = 1.;
            solve(&l, &b)
        })
        .collect();
    let players = accounts
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let played: Vec<_> = games
                .iter()
                .filter(|g| {
                    g.replay
                        .players
                        .iter()
                        .any(|p| g.participant(&p.id).as_deref() == Some(a))
                })
                .collect();
            (
                a.clone(),
                Player {
                    hidden: 1800. + (400. / 10_f64.ln()) * v[i],
                    sd: covariance[i][i].sqrt(),
                    games: played.len(),
                    last_played: played
                        .iter()
                        .filter_map(|g| g.replay.ended_at)
                        .max()
                        .unwrap_or(0)
                        .max(0),
                },
            )
        })
        .collect();
    Ok(Fit {
        players,
        covariance,
        parameters: v,
        accounts,
        configs,
    })
}
pub fn round_tenth(x: f64) -> f64 {
    (x * 10. + 0.5).floor() / 10.
}
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Title {
    Beginner,
    Learning,
    Capable,
    Expert,
    Master,
}
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Stale,
    Insufficient,
    Tentative,
    Supported,
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicRating {
    pub score: f64,
    pub rated_games: usize,
    pub title: Title,
    pub confidence: Confidence,
}
pub fn public_rating(player: Option<&Player>, now: i64) -> PublicRating {
    let Some(p) = player else {
        return PublicRating {
            score: INITIAL_SCORE,
            rated_games: 0,
            title: Title::Beginner,
            confidence: Confidence::Insufficient,
        };
    };
    let title = if p.hidden < 1600. {
        Title::Beginner
    } else if p.hidden < 1750. {
        Title::Learning
    } else if p.hidden < 1850. {
        Title::Capable
    } else if p.hidden < 2000. {
        Title::Expert
    } else {
        Title::Master
    };
    let confidence = if now - p.last_played > 90 * 86_400_000 {
        Confidence::Stale
    } else if p.sd > 0.8 {
        Confidence::Insufficient
    } else if p.sd > 0.6 {
        Confidence::Tentative
    } else {
        Confidence::Supported
    };
    PublicRating {
        score: round_tenth(50. + 10. * (p.hidden - 1800.) / 200.),
        rated_games: p.games,
        title,
        confidence,
    }
}
