use crate::{AppState, auth::AuthUser, history, ratings};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
use rand::Rng;
use serde_json::{Value, json};
use std::collections::HashMap;
#[derive(Debug)]
struct HttpError(Box<Response>);
impl IntoResponse for HttpError {
    fn into_response(self) -> Response {
        *self.0
    }
}
type Reply = Result<Json<Value>, HttpError>;
fn error(status: StatusCode, code: &str, message: &str) -> HttpError {
    HttpError(Box::new(
        (status, Json(json!({"code":code,"error":message}))).into_response(),
    ))
}
fn internal(e: anyhow::Error) -> HttpError {
    if e.to_string() == "HISTORY_BUSY" {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "HISTORY_BUSY",
            "History computation is busy; retry shortly",
        );
    }
    tracing::error!(error=?e,"HTTP request failed");
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "INTERNAL_ERROR",
        "Request failed",
    )
}
fn user(s: &AppState, h: &HeaderMap) -> Result<AuthUser, HttpError> {
    s.auth
        .read_session(h.get("cookie").and_then(|x| x.to_str().ok()).unwrap_or(""))
        .map_err(internal)?
        .ok_or_else(|| {
            error(
                StatusCode::UNAUTHORIZED,
                "AUTH_REQUIRED",
                "Sign in to continue",
            )
        })
}
fn valid_code(code: &str) -> bool {
    code.len() == 4 && code.bytes().all(|b| b.is_ascii_digit())
}
fn json_write(s: &AppState, h: &HeaderMap, code: &str) -> Result<(), HttpError> {
    if h.get("origin").and_then(|v| v.to_str().ok()) != Some(s.public_origin.as_str()) {
        return Err(error(
            StatusCode::FORBIDDEN,
            "INVALID_ORIGIN",
            "Same-origin request required",
        ));
    }
    if h.get("content-type")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(';').next())
        .is_none_or(|s| !s.trim().eq_ignore_ascii_case("application/json"))
    {
        return Err(error(StatusCode::BAD_REQUEST, code, "JSON body required"));
    }
    Ok(())
}
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/rooms", get(rooms).post(create_room))
        .route("/api/rooms/{code}", get(preview))
        .route("/api/history", get(profile))
        .route("/api/history/games", get(games))
        .route(
            "/api/rooms/{code}/players/{player_id}/record",
            get(seat_record),
        )
        .route("/api/games/{id}/replay", get(replay))
        .route("/api/auth/preferences", patch(preferences))
        .route("/api/auth/alias", post(alias))
        .route("/debug/addRandomCard", get(debug_card))
}
async fn health(State(s): State<AppState>) -> Response {
    match s.db.health().await {
        Ok(()) => Json(json!({"ok":true,"status":"healthy"})).into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"ok":false,"status":"unavailable"})),
        )
            .into_response(),
    }
}
fn positive(
    q: &HashMap<String, String>,
    key: &str,
    default: usize,
    min: usize,
) -> Result<usize, HttpError> {
    match q.get(key) {
        None => Ok(default),
        Some(v) => {
            let n = v.parse::<f64>().ok().filter(|v| {
                v.is_finite() && v.fract() == 0. && *v >= min as f64 && *v <= 9_007_199_254_740_991.
            });
            n.map(|n| n as usize)
                .ok_or_else(|| error(StatusCode::BAD_REQUEST, "INVALID_QUERY", "Invalid query"))
        }
    }
}
async fn rooms(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Reply {
    user(&s, &h)?;
    Ok(Json(
        s.db.list_public_rooms(positive(&q, "page", 1, 1)? as i64)
            .await
            .map_err(internal)?,
    ))
}
#[derive(serde::Deserialize)]
struct CreateRoomBody {
    #[serde(default)]
    roster: Option<Vec<String>>,
    #[serde(default)]
    config: Option<crate::room::protocol::ConfigInput>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedRoom {
    code: String,
    host_token: String,
    player_id: crate::engine::PlayerId,
    player_token: String,
}
async fn create_room(
    State(s): State<AppState>,
    h: HeaderMap,
    body: Result<Json<CreateRoomBody>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, HttpError> {
    let u = user(&s, &h).map_err(|r| {
        if r.0.status() == StatusCode::UNAUTHORIZED {
            error(
                StatusCode::UNAUTHORIZED,
                "CREATE_ROOM_TOKEN_REQUIRED",
                "Sign in to create a room",
            )
        } else {
            r
        }
    })?;
    let Json(body) =
        body.map_err(|_| error(StatusCode::BAD_REQUEST, "INVALID_JSON", "Invalid JSON body"))?;
    let account = s.auth.account_key(&u);
    let alias = s.db.get_alias(&account).await.map_err(internal)?;
    let name = alias.filter(|a| !a.is_empty()).unwrap_or(u.username);
    for _ in 0..5 {
        let code = format!("{:04}", rand::thread_rng().gen_range(0..=9999));
        let input = crate::room::protocol::Init {
            roster: body.roster.clone().unwrap_or_default(),
            config: body.config.clone(),
            creator: crate::room::protocol::Creator {
                name: name.clone(),
                avatar_url: u.picture.clone(),
                account: account.clone().into(),
            },
        };
        match s.rooms.init(&code, input).await.map_err(internal)? {
            crate::room::protocol::InitOutcome::Created {
                host_token,
                player_id,
                player_token,
            } => {
                return Ok((
                    StatusCode::CREATED,
                    Json(CreatedRoom {
                        code,
                        host_token,
                        player_id,
                        player_token,
                    }),
                )
                    .into_response());
            }
            crate::room::protocol::InitOutcome::Exists => continue,
            crate::room::protocol::InitOutcome::InvalidCreator => {
                return Err(error(
                    StatusCode::BAD_GATEWAY,
                    "OIDC_USERINFO_INVALID",
                    "Invalid OAuth username",
                ));
            }
        }
    }
    Err(error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "CREATE_FAILED",
        "Failed to create room",
    ))
}
async fn preview(State(s): State<AppState>, h: HeaderMap, Path(code): Path<String>) -> Reply {
    user(&s, &h)?;
    if !valid_code(&code) {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "INVALID_ROOM",
            "Invalid room code",
        ));
    }
    s.rooms
        .preview(&code)
        .await
        .map_err(internal)?
        .map(Json)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "NOT_FOUND", "Room not found"))
}
async fn profile(State(s): State<AppState>, h: HeaderMap) -> Reply {
    let account = s.auth.account_key(&user(&s, &h)?);
    Ok(Json(
        history::query(&s.db, s.environment == "development", move |b| {
            b.profile(&account)
        })
        .await
        .map_err(internal)?,
    ))
}
async fn games(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Reply {
    let account = s.auth.account_key(&user(&s, &h)?);
    let offset = positive(&q, "offset", 0, 0)?;
    Ok(Json(
        history::query(&s.db, s.environment == "development", move |b| {
            b.games_page(&account, offset)
        })
        .await
        .map_err(internal)?,
    ))
}
async fn seat_record(
    State(s): State<AppState>,
    h: HeaderMap,
    Path((code, player_id)): Path<(String, String)>,
) -> Reply {
    let account = s.auth.account_key(&user(&s, &h)?);
    if !valid_code(&code) {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "INVALID_ROOM",
            "Invalid room code",
        ));
    }
    let target = s
        .rooms
        .seat_account(&code, &account, &player_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "NOT_FOUND", "Record not found"))?;
    let hidden = target != account
        && s.db.get_preferences(&target).await.map_err(internal)?["hideRecord"] == true;
    Ok(Json(
        history::query(&s.db, s.environment == "development", move |b| {
            b.seat_record(&target, hidden)
        })
        .await
        .map_err(internal)?,
    ))
}
async fn replay(State(s): State<AppState>, h: HeaderMap, Path(id): Path<String>) -> Reply {
    let account = s.auth.account_key(&user(&s, &h)?);
    let replay =
        s.db.load_replay(&id)
            .await
            .map_err(internal)?
            .filter(|r| ratings::codec::visible(r, s.environment == "development"))
            .ok_or_else(|| error(StatusCode::NOT_FOUND, "NOT_FOUND", "Game not found"))?;
    Ok(Json(
        json!({"replay":replay,"viewerId":s.db.find_seat(&id,&account).await.map_err(internal)?}),
    ))
}
fn valid_preferences(v: &Value) -> bool {
    v.as_object().is_some_and(|o| {
        !o.is_empty()
            && o.iter().all(|(k, v)| match k.as_str() {
                "locale" => v.as_str().is_some_and(|x| ["en", "zh"].contains(&x)),
                "cardArt" => v
                    .as_str()
                    .is_some_and(|x| ["modern", "classic", "furry"].contains(&x)),
                "muted" | "voice" | "notify" | "hideRecord" => v.is_boolean(),
                "volume" | "voiceVolume" => v.as_f64().is_some_and(|n| (0.0..=1.0).contains(&n)),
                _ => false,
            })
    })
}
async fn preferences(
    State(s): State<AppState>,
    h: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Reply {
    json_write(&s, &h, "INVALID_PREFERENCES")?;
    let account = s.auth.account_key(&user(&s, &h)?);
    let Json(body) = body.map_err(|_| {
        error(
            StatusCode::BAD_REQUEST,
            "INVALID_PREFERENCES",
            "Invalid preferences",
        )
    })?;
    if !valid_preferences(&body) {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "INVALID_PREFERENCES",
            "Invalid preferences",
        ));
    }
    Ok(Json(
        json!({"preferences":s.db.save_preferences(&account,&body).await.map_err(internal)?}),
    ))
}
async fn alias(
    State(s): State<AppState>,
    h: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Reply {
    json_write(&s, &h, "INVALID_ALIAS")?;
    let u = user(&s, &h)?;
    let account = s.auth.account_key(&u);
    let Json(body) = body.map_err(|_| {
        error(
            StatusCode::BAD_REQUEST,
            "INVALID_ALIAS",
            "Alias cannot be empty",
        )
    })?;
    let name = body["alias"]
        .as_str()
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(10)
        .collect::<String>();
    if name.is_empty() {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "INVALID_ALIAS",
            "Alias cannot be empty",
        ));
    }
    let alias = s.db.set_alias(&account, &name).await.map_err(internal)?;
    let mut u = serde_json::to_value(u).map_err(|e| internal(e.into()))?;
    u["alias"] = json!(alias);
    u["rerollCards"] = s.db.get_cards(&account, None).await.map_err(internal)?;
    Ok(Json(json!({"user":u})))
}
async fn debug_card(State(s): State<AppState>, h: HeaderMap) -> Reply {
    let local = url::Url::parse(&s.public_origin)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .is_some_and(|host| ["localhost", "127.0.0.1", "[::1]", "::1"].contains(&host.as_str()));
    if s.environment != "development" || !local {
        return Err(HttpError(Box::new(StatusCode::NOT_FOUND.into_response())));
    }
    if h.get("sec-fetch-site").is_some_and(|v| v == "cross-site")
        || h.get("origin")
            .is_some_and(|v| v != s.public_origin.as_str())
    {
        return Err(error(
            StatusCode::FORBIDDEN,
            "INVALID_ORIGIN",
            "Invalid origin",
        ));
    }
    let account = s.auth.account_key(&user(&s, &h)?);
    Ok(Json(
        json!({"rerollCards":s.db.grant_debug_card(&account).await.map_err(internal)?}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn room_creation_decodes_typed_fields_before_entering_the_room_queue() {
        for value in [
            json!({}),
            json!({"roster":null,"config":null}),
            json!({"roster":["A"],"config":{"options":{"morgana":true}}}),
        ] {
            assert!(serde_json::from_value::<CreateRoomBody>(value).is_ok());
        }
        for value in [
            json!({"roster":[7]}),
            json!({"config":"invalid"}),
            json!({"config":{"options":{"morgana":"true"}}}),
        ] {
            assert!(serde_json::from_value::<CreateRoomBody>(value).is_err());
        }
    }
    #[test]
    fn preferences_reject_unknown_or_out_of_range_fields() {
        for value in [
            json!({"locale":"zh","volume":0.7}),
            json!({"hideRecord":true}),
            json!({"cardArt":"furry"}),
        ] {
            assert!(valid_preferences(&value));
        }
        for value in [
            json!({}),
            json!({"locale":"zh-CN"}),
            json!({"volume":1.1}),
            json!({"hideRecord":1}),
            json!({"account":"someone"}),
            json!([]),
        ] {
            assert!(!valid_preferences(&value));
        }
    }
    #[test]
    fn numeric_queries_enforce_safe_nonnegative_integer() {
        for value in ["-1", "1.5", "NaN", "9007199254740992"] {
            assert!(
                positive(
                    &HashMap::from([("offset".into(), value.into())]),
                    "offset",
                    0,
                    0
                )
                .is_err()
            );
        }
        assert_eq!(
            positive(
                &HashMap::from([("offset".into(), "30".into())]),
                "offset",
                0,
                0
            )
            .unwrap(),
            30
        );
    }
}
