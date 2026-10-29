//! Pangda OIDC authorization code + PKCE. Rust cookies intentionally invalidate Node sessions.
use crate::{AppState, now_ms};
use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use anyhow::{Context, Result, ensure};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, header},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, jwk::JwkSet};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use url::Url;
pub const SESSION_COOKIE: &str = "avalon_rust_session";
const FLOW_COOKIE: &str = "avalon_rust_oidc_flow";
const SESSION_TTL: i64 = 604800;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: String,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
}
#[derive(Clone)]
pub struct Auth {
    inner: Arc<Config>,
}
struct Config {
    issuer: String,
    client_id: String,
    client_secret: String,
    key: [u8; 32],
    development: bool,
    client: reqwest::Client,
    metadata: Mutex<Option<(Instant, Metadata)>>,
    keys: Mutex<Option<(Instant, String, JwkSet)>>,
}
#[derive(Clone, Deserialize)]
struct Metadata {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    userinfo_endpoint: String,
    jwks_uri: String,
}
#[derive(Serialize, Deserialize)]
struct Session {
    issuer: String,
    user: AuthUser,
    expires_at: i64,
}
#[derive(Serialize, Deserialize)]
struct Flow {
    state: String,
    nonce: String,
    verifier: String,
    next: Option<String>,
    expires_at: i64,
    silent: bool,
}
fn random_token(n: usize) -> String {
    let mut bytes = vec![0; n];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
fn loopback(u: &Url) -> bool {
    u.scheme() == "http"
        && matches!(
            u.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
        )
}
fn origin(value: &str, development: bool) -> Result<String> {
    let u = Url::parse(value)?;
    ensure!(
        u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && u.fragment().is_none()
            && u.path() == "/",
        "Expected origin URL"
    );
    ensure!(
        u.scheme() == "https" || (development && loopback(&u)),
        "Expected HTTPS origin"
    );
    Ok(u.origin().ascii_serialization())
}
pub fn safe_return_path(value: Option<&str>) -> Option<String> {
    let value = value?;
    if !value.starts_with('/')
        || value.starts_with("//")
        || value.contains('\\')
        || value.chars().any(char::is_control)
    {
        return None;
    }
    let base = Url::parse("https://avalon.invalid").unwrap();
    let u = base.join(value).ok()?;
    if u.origin() != base.origin() {
        return None;
    }
    Some(u[url::Position::BeforePath..].to_owned())
}
impl Auth {
    pub fn from_env() -> Result<Self> {
        let development =
            std::env::var("ENVIRONMENT").unwrap_or_else(|_| "production".into()) != "production";
        let issuer = origin(
            &std::env::var("OIDC_ISSUER").context("OIDC_ISSUER missing")?,
            development,
        )?;
        ensure!(
            ["https://auth.pangda.app", "https://auth-staging.pangda.app"]
                .contains(&issuer.as_str())
                || (development && loopback(&Url::parse(&issuer)?)),
            "OIDC_ISSUER not approved"
        );
        let client_id = std::env::var("OIDC_CLIENT_ID")
            .unwrap_or_default()
            .trim()
            .to_owned();
        let client_secret = std::env::var("OIDC_CLIENT_SECRET")
            .unwrap_or_default()
            .trim()
            .to_owned();
        ensure!(
            !client_id.is_empty() && !client_secret.is_empty(),
            "OIDC credentials missing"
        );
        let key = URL_SAFE_NO_PAD
            .decode(std::env::var("OIDC_SESSION_SECRET").context("OIDC_SESSION_SECRET missing")?)?;
        let key: [u8; 32] = key
            .try_into()
            .map_err(|_| anyhow::anyhow!("OIDC_SESSION_SECRET must contain 32 bytes"))?;
        Self::new(issuer, client_id, client_secret, key, development)
    }
    /// Explicit configuration constructor; applies the same issuer policy as environment configuration.
    pub fn new(
        issuer: String,
        client_id: String,
        client_secret: String,
        key: [u8; 32],
        development: bool,
    ) -> Result<Self> {
        let issuer = origin(&issuer, development)?;
        ensure!(
            ["https://auth.pangda.app", "https://auth-staging.pangda.app"]
                .contains(&issuer.as_str())
                || (development && loopback(&Url::parse(&issuer)?)),
            "OIDC_ISSUER not approved"
        );
        ensure!(
            !client_id.trim().is_empty() && !client_secret.trim().is_empty(),
            "OIDC credentials missing"
        );
        Ok(Self {
            inner: Arc::new(Config {
                issuer,
                client_id,
                client_secret,
                key,
                development,
                client: reqwest::Client::builder()
                    .timeout(Duration::from_secs(8))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()?,
                metadata: Mutex::new(None),
                keys: Mutex::new(None),
            }),
        })
    }
    pub fn issuer(&self) -> &str {
        &self.inner.issuer
    }
    pub fn account_key(&self, user: &AuthUser) -> String {
        serde_json::to_string(&[&self.inner.issuer, &user.id]).unwrap()
    }
    pub fn read_session(&self, cookie_header: &str) -> Result<Option<AuthUser>> {
        let Some(token) = cookie(cookie_header, SESSION_COOKIE) else {
            return Ok(None);
        };
        let session: Session = match self.unseal(token, b"avalon:rust:session:v1") {
            Ok(s) => s,
            Err(_) => return Ok(None),
        };
        if session.issuer != self.inner.issuer
            || session.expires_at <= now_ms()
            || !valid_user(&session.user, self.inner.development)
        {
            return Ok(None);
        }
        Ok(Some(session.user))
    }
    pub async fn current_user(&self, headers: &HeaderMap) -> Result<Option<Value>> {
        Ok(self
            .read_session(
                headers
                    .get(header::COOKIE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or(""),
            )?
            .map(|u| serde_json::to_value(u).unwrap()))
    }
    pub fn user(&self, headers: &HeaderMap) -> Result<Option<AuthUser>> {
        self.read_session(
            headers
                .get(header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or(""),
        )
    }
    fn seal<T: Serialize>(&self, value: &T, aad: &[u8]) -> Result<String> {
        let cipher = Aes256Gcm::new_from_slice(&self.inner.key).unwrap();
        let mut iv = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut iv);
        let plaintext = serde_json::to_vec(value)?;
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&iv),
                Payload {
                    msg: &plaintext,
                    aad,
                },
            )
            .map_err(|_| anyhow::anyhow!("Cookie encryption failed"))?;
        Ok(format!(
            "r1.{}.{}",
            URL_SAFE_NO_PAD.encode(iv),
            URL_SAFE_NO_PAD.encode(ciphertext)
        ))
    }
    fn unseal<T: serde::de::DeserializeOwned>(&self, value: &str, aad: &[u8]) -> Result<T> {
        ensure!(value.len() <= 8192, "Cookie too large");
        let parts: Vec<_> = value.split('.').collect();
        ensure!(
            parts.len() == 3 && parts[0] == "r1",
            "Invalid cookie version"
        );
        let iv = URL_SAFE_NO_PAD.decode(parts[1])?;
        ensure!(iv.len() == 12, "Invalid nonce");
        let ciphertext = URL_SAFE_NO_PAD.decode(parts[2])?;
        let plaintext = Aes256Gcm::new_from_slice(&self.inner.key)
            .unwrap()
            .decrypt(
                Nonce::from_slice(&iv),
                Payload {
                    msg: &ciphertext,
                    aad,
                },
            )
            .map_err(|_| anyhow::anyhow!("Invalid cookie"))?;
        Ok(serde_json::from_slice(&plaintext)?)
    }
    pub fn seal_session(&self, user: AuthUser) -> Result<String> {
        ensure!(
            valid_user(&user, self.inner.development),
            "Invalid session user"
        );
        self.seal(
            &Session {
                issuer: self.inner.issuer.clone(),
                user,
                expires_at: now_ms() + SESSION_TTL * 1000,
            },
            b"avalon:rust:session:v1",
        )
    }
    async fn metadata(&self) -> Result<Metadata> {
        let mut guard = self.inner.metadata.lock().await;
        if let Some((at, m)) = &*guard
            && at.elapsed() < Duration::from_secs(300)
        {
            return Ok(m.clone());
        }
        let m: Metadata = fetch_json(self.inner.client.get(format!(
            "{}/.well-known/openid-configuration",
            self.inner.issuer
        )))
        .await?;
        ensure!(m.issuer == self.inner.issuer, "OIDC_DISCOVERY_INVALID");
        for e in [
            &m.authorization_endpoint,
            &m.token_endpoint,
            &m.userinfo_endpoint,
            &m.jwks_uri,
        ] {
            let u = Url::parse(e)?;
            ensure!(
                u.origin().ascii_serialization() == self.inner.issuer
                    && u.username().is_empty()
                    && u.password().is_none()
                    && u.fragment().is_none(),
                "OIDC_DISCOVERY_INVALID"
            );
        }
        *guard = Some((Instant::now(), m.clone()));
        Ok(m)
    }
    async fn jwks(&self, uri: &str, refresh: bool) -> Result<JwkSet> {
        let mut guard = self.inner.keys.lock().await;
        if let Some((at, key_uri, keys)) = &*guard
            && key_uri == uri
            && at.elapsed() < Duration::from_secs(if refresh { 30 } else { 600 })
        {
            return Ok(keys.clone());
        }
        let keys: JwkSet = fetch_json(self.inner.client.get(uri)).await?;
        *guard = Some((Instant::now(), uri.to_owned(), keys.clone()));
        Ok(keys)
    }
    async fn begin(
        &self,
        public_origin: &str,
        next: Option<&str>,
        silent: bool,
    ) -> Result<(String, Option<String>)> {
        let origin = origin(public_origin, self.inner.development)?;
        let m = self.metadata().await?;
        let flow = Flow {
            state: random_token(24),
            nonce: random_token(24),
            verifier: random_token(32),
            next: safe_return_path(next),
            expires_at: now_ms() + 600000,
            silent,
        };
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(flow.verifier.as_bytes()));
        let sealed = self.seal(&flow, b"avalon:rust:flow:v1")?;
        let mut u = Url::parse(&m.authorization_endpoint)?;
        // Replace provider query parameters rather than allowing duplicate state/redirect/prompt.
        let unrelated: Vec<(String, String)> = u
            .query_pairs()
            .filter(|(k, _)| {
                ![
                    "response_type",
                    "client_id",
                    "redirect_uri",
                    "scope",
                    "nonce",
                    "code_challenge",
                    "code_challenge_method",
                    "state",
                    "prompt",
                ]
                .contains(&k.as_ref())
            })
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        u.set_query(None);
        {
            let mut q = u.query_pairs_mut();
            q.extend_pairs(unrelated);
            q.append_pair("response_type", "code")
                .append_pair("client_id", &self.inner.client_id)
                .append_pair("redirect_uri", &format!("{origin}/api/auth/callback"))
                .append_pair("scope", "openid profile")
                .append_pair("nonce", &flow.nonce)
                .append_pair("code_challenge", &challenge)
                .append_pair("code_challenge_method", "S256");
            if silent {
                q.append_pair("state", &format!("silent.{sealed}"))
                    .append_pair("prompt", "none");
            } else {
                q.append_pair("state", &flow.state);
            }
        }
        Ok((u.to_string(), if silent { None } else { Some(sealed) }))
    }
    async fn finish(
        &self,
        public_origin: &str,
        headers: &HeaderMap,
        query: &HashMap<String, String>,
    ) -> Result<(Option<String>, String)> {
        let returned = query.get("state").map(String::as_str).unwrap_or("");
        let silent = returned.strip_prefix("silent.");
        let cookie_header = headers
            .get(header::COOKIE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let sealed = silent
            .or_else(|| cookie(cookie_header, FLOW_COOKIE))
            .ok_or_else(|| anyhow::anyhow!("OIDC_FLOW_INVALID"))?;
        let flow: Flow = self
            .unseal(sealed, b"avalon:rust:flow:v1")
            .context("OIDC_FLOW_INVALID")?;
        ensure!(
            flow.expires_at > now_ms()
                && if silent.is_some() {
                    flow.silent
                } else {
                    !flow.silent && flow.state == returned
                },
            "OIDC_FLOW_INVALID"
        );
        ensure!(!query.contains_key("error"), "OIDC_AUTHORIZATION_DENIED");
        let code = query
            .get("code")
            .filter(|s| !s.is_empty())
            .context("OIDC_FLOW_INVALID")?;
        let m = self.metadata().await?;
        let origin = origin(public_origin, self.inner.development)?;
        let tokens: Value = fetch_json(
            self.inner
                .client
                .post(&m.token_endpoint)
                .basic_auth(&self.inner.client_id, Some(&self.inner.client_secret))
                .form(&[
                    ("grant_type", "authorization_code"),
                    ("code", code),
                    ("redirect_uri", &format!("{origin}/api/auth/callback")),
                    ("code_verifier", &flow.verifier),
                ]),
        )
        .await?;
        let id_token = tokens["id_token"]
            .as_str()
            .context("OIDC_TOKEN_RESPONSE_INVALID")?;
        let access_token = tokens["access_token"]
            .as_str()
            .context("OIDC_TOKEN_RESPONSE_INVALID")?;
        let header = jsonwebtoken::decode_header(id_token).context("OIDC_ID_TOKEN_INVALID")?;
        ensure!(
            header.alg == Algorithm::RS256 && header.typ.as_deref() == Some("JWT"),
            "OIDC_ID_TOKEN_INVALID"
        );
        let kid = header.kid.context("OIDC_ID_TOKEN_INVALID")?;
        let mut keys = self.jwks(&m.jwks_uri, false).await?;
        if keys.find(&kid).is_none() {
            keys = self.jwks(&m.jwks_uri, true).await?;
        }
        let key = keys.find(&kid).context("OIDC_ID_TOKEN_INVALID")?;
        let key = DecodingKey::from_jwk(key)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[&self.inner.issuer]);
        validation.set_audience(&[&self.inner.client_id]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.leeway = 0;
        validation.validate_nbf = true;
        let claims = jsonwebtoken::decode::<Value>(id_token, &key, &validation)
            .context("OIDC_ID_TOKEN_INVALID")?
            .claims;
        let sub = claims["sub"]
            .as_str()
            .filter(|s| !s.is_empty())
            .context("OIDC_ID_TOKEN_INVALID")?;
        ensure!(
            claims["nonce"].as_str() == Some(&flow.nonce),
            "OIDC_ID_TOKEN_INVALID"
        );
        if claims.get("azp").is_some() || claims["aud"].as_array().is_some_and(|a| a.len() > 1) {
            ensure!(
                claims["azp"].as_str() == Some(&self.inner.client_id),
                "OIDC_ID_TOKEN_INVALID"
            );
        }
        let info: Value = fetch_json(
            self.inner
                .client
                .get(&m.userinfo_endpoint)
                .bearer_auth(access_token),
        )
        .await?;
        ensure!(info["sub"].as_str() == Some(sub), "OIDC_USERINFO_INVALID");
        let username = info["preferred_username"]
            .as_str()
            .context("OIDC_USERINFO_INVALID")?
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let picture = match info.get("picture") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.clone()),
            _ => anyhow::bail!("OIDC_USERINFO_INVALID"),
        };
        let user = AuthUser {
            id: sub.to_owned(),
            username,
            picture,
        };
        ensure!(
            valid_user(&user, self.inner.development),
            "OIDC_USERINFO_INVALID"
        );
        Ok((flow.next, self.seal_session(user)?))
    }
}
fn valid_user(u: &AuthUser, dev: bool) -> bool {
    !u.id.is_empty()
        && !u.username.is_empty()
        && u.username.encode_utf16().count() <= 64
        && u.picture.as_ref().is_none_or(|s| {
            s.len() <= 2048
                && Url::parse(s).is_ok_and(|u| u.scheme() == "https" || (dev && loopback(&u)))
        })
}
async fn fetch_json<T: serde::de::DeserializeOwned>(request: reqwest::RequestBuilder) -> Result<T> {
    let mut response = request
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .context("OIDC_UNAVAILABLE")?
        .error_for_status()
        .context("OIDC_UNAVAILABLE")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            bytes.len() + chunk.len() <= 1_048_576,
            "OIDC response too large"
        );
        bytes.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&bytes)?)
}
fn cookie<'a>(header: &'a str, name: &str) -> Option<&'a str> {
    header
        .split(';')
        .filter_map(|p| p.trim().split_once('='))
        .find_map(|(k, v)| (k == name).then_some(v))
}
fn cookie_value(name: &str, value: &str, age: i64, secure: bool) -> String {
    format!(
        "{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{}",
        if secure { "; Secure" } else { "" }
    )
}
fn append_cookie(response: &mut Response, value: String) {
    if let Ok(v) = HeaderValue::from_str(&value) {
        response.headers_mut().append(header::SET_COOKIE, v);
    }
}
fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
fn error_redirect(next: Option<&str>, code: &str) -> String {
    let base = Url::parse("https://avalon.invalid").unwrap();
    let path = safe_return_path(next).unwrap_or_else(|| "/".into());
    let mut u = base.join(&path).unwrap();
    u.query_pairs_mut().append_pair("authError", code);
    u[url::Position::BeforePath..].to_owned()
}
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/session", get(session))
        .route("/api/auth/login", get(login))
        .route("/api/auth/silent", get(silent))
        .route(
            "/api/auth/silent/complete",
            get(|| async { no_store(axum::http::StatusCode::NO_CONTENT.into_response()) }),
        )
        .route("/api/auth/callback", get(callback))
        .route("/api/auth/logout", post(logout))
}
async fn session(State(s): State<AppState>, headers: HeaderMap) -> Response {
    let result = async {
        let Some(u) = s.auth.user(&headers)? else {
            return Ok::<_, anyhow::Error>(json!({"user":null}));
        };
        let account = s.auth.account_key(&u);
        let mut user = serde_json::to_value(&u)?;
        if let Some(alias) = s.db.get_alias(&account).await? {
            user["alias"] = json!(alias);
        }
        user["rerollCards"] = s.db.get_cards(&account, Some(now_ms())).await?;
        user["preferences"] = s.db.get_preferences(&account).await?;
        Ok(json!({"user":user}))
    }
    .await;
    no_store(match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => {
            tracing::warn!(error=%e,"Session lookup failed");
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error":"OIDC_UNAVAILABLE"})),
            )
                .into_response()
        }
    })
}
async fn login(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    start(s, headers, q.get("next").map(String::as_str), false).await
}
async fn silent(State(s): State<AppState>, headers: HeaderMap) -> Response {
    start(s, headers, Some("/api/auth/silent/complete"), true).await
}
async fn start(s: AppState, headers: HeaderMap, next: Option<&str>, silent: bool) -> Response {
    let next = safe_return_path(next).unwrap_or_else(|| "/".into());
    if s.auth.user(&headers).ok().flatten().is_some() {
        return no_store(Redirect::to(&next).into_response());
    }
    match s.auth.begin(&s.public_origin, Some(&next), silent).await {
        Ok((url, flow)) => {
            let mut r = Redirect::to(&url).into_response();
            if let Some(flow) = flow {
                append_cookie(
                    &mut r,
                    cookie_value(
                        FLOW_COOKIE,
                        &flow,
                        600,
                        s.public_origin.starts_with("https:"),
                    ),
                );
            }
            no_store(r)
        }
        Err(e) => {
            tracing::warn!(error=%e,"OIDC login unavailable");
            no_store(
                Redirect::to(&if silent {
                    "/api/auth/silent/complete".into()
                } else {
                    error_redirect(Some(&next), "unavailable")
                })
                .into_response(),
            )
        }
    }
}
async fn callback(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let silent = q.get("state").is_some_and(|s| s.starts_with("silent."));
    let secure = s.public_origin.starts_with("https:");
    let mut response = match s.auth.finish(&s.public_origin, &headers, &q).await {
        Ok((next, token)) => {
            let mut r = Redirect::to(next.as_deref().unwrap_or("/")).into_response();
            append_cookie(
                &mut r,
                cookie_value(SESSION_COOKIE, &token, SESSION_TTL, secure),
            );
            r
        }
        Err(e) => {
            tracing::warn!(error=%e,"OIDC callback failed");
            let next = if silent {
                "/api/auth/silent/complete".into()
            } else {
                let code = match q.get("error").map(String::as_str) {
                    Some("access_denied") => "denied",
                    Some("interaction_required" | "login_required") => "login_required",
                    Some("server_error" | "temporarily_unavailable") => "unavailable",
                    _ => {
                        if format!("{e:#}").contains("OIDC_FLOW_INVALID") {
                            "invalid_flow"
                        } else {
                            "failed"
                        }
                    }
                };
                let flow = cookie(
                    headers
                        .get(header::COOKIE)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or(""),
                    FLOW_COOKIE,
                )
                .and_then(|v| s.auth.unseal::<Flow>(v, b"avalon:rust:flow:v1").ok());
                error_redirect(flow.as_ref().and_then(|f| f.next.as_deref()), code)
            };
            Redirect::to(&next).into_response()
        }
    };
    if !silent {
        append_cookie(&mut response, cookie_value(FLOW_COOKIE, "", 0, secure));
    }
    no_store(response)
}
async fn logout(State(s): State<AppState>, headers: HeaderMap) -> Response {
    if headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v != s.public_origin)
    {
        return axum::http::StatusCode::FORBIDDEN.into_response();
    }
    let mut r = Json(json!({"ok":true})).into_response();
    append_cookie(
        &mut r,
        cookie_value(SESSION_COOKIE, "", 0, s.public_origin.starts_with("https:")),
    );
    no_store(r)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn auth() -> Auth {
        Auth::new(
            "https://auth.pangda.app".into(),
            "test".into(),
            "secret".into(),
            [7; 32],
            false,
        )
        .unwrap()
    }
    #[test]
    fn cookies_are_local_authenticated_and_separated() {
        let a = auth();
        let user = AuthUser {
            id: "猫😀".into(),
            username: "玩家".into(),
            picture: None,
        };
        let sealed = a.seal_session(user.clone()).unwrap();
        let cookie = format!("{SESSION_COOKIE}={sealed}");
        assert_eq!(a.read_session(&cookie).unwrap().unwrap().id, user.id);
        assert!(
            a.read_session(&format!("avalon_oidc_session={sealed}"))
                .unwrap()
                .is_none()
        );
        assert!(
            a.unseal::<Session>(&sealed, b"avalon:rust:flow:v1")
                .is_err()
        );
        assert_eq!(
            a.account_key(&user),
            "[\"https://auth.pangda.app\",\"猫😀\"]"
        );
        let mut bad = cookie.into_bytes();
        let n = bad.len();
        bad[n - 2] = if bad[n - 2] == b'A' { b'B' } else { b'A' };
        assert!(
            a.read_session(std::str::from_utf8(&bad).unwrap())
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn redirects_stay_local() {
        for p in [
            "//evil.test",
            "/\\evil.test",
            "https://evil.test",
            "/\nevil",
        ] {
            assert!(safe_return_path(Some(p)).is_none());
        }
        assert_eq!(
            safe_return_path(Some("/room/1234?a=b#x")).as_deref(),
            Some("/room/1234?a=b#x")
        );
    }
    #[test]
    fn origin_checks() {
        assert!(origin("http://evil.test", true).is_err());
        assert!(origin("https://auth.pangda.app/path", false).is_err());
        assert!(origin("http://127.0.0.1:3333", true).is_ok());
        assert!(origin("http://127.0.0.1:3333", false).is_err());
    }
    #[test]
    fn expired_session_rejected() {
        let a = auth();
        let token = a
            .seal(
                &Session {
                    issuer: a.issuer().into(),
                    user: AuthUser {
                        id: "u".into(),
                        username: "u".into(),
                        picture: None,
                    },
                    expires_at: now_ms() - 1,
                },
                b"avalon:rust:session:v1",
            )
            .unwrap();
        assert!(
            a.read_session(&format!("{SESSION_COOKIE}={token}"))
                .unwrap()
                .is_none()
        );
    }
}

#[cfg(test)]
mod oidc_integration_tests {
    // RSA fixture is a synthetic test-only key; it is never compiled into production builds.
    use super::*;
    use axum::extract::Form;
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[derive(Clone)]
    struct Provider {
        issuer: String,
        expected: Arc<Mutex<Value>>,
        exchanges: Arc<AtomicUsize>,
    }
    async fn discovery(State(p): State<Provider>) -> Json<Value> {
        let expected = p.expected.lock().await;
        Json(
            json!({"issuer": p.issuer,"authorization_endpoint":format!("{}/authorize?prompt=none",p.issuer),"token_endpoint":format!("{}/token",p.issuer),"userinfo_endpoint":format!("{}/userinfo",p.issuer),"jwks_uri":if expected["badDiscovery"]==true {"https://evil.example/keys".to_owned()}else{format!("{}/keys",p.issuer)}}),
        )
    }
    async fn keys() -> Json<Value> {
        Json(
            json!({"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"test-key","n":include_str!("../tests/fixtures/oidc-test-modulus.txt"),"e":"AQAB"}]}),
        )
    }
    async fn token(
        State(p): State<Provider>,
        headers: HeaderMap,
        Form(form): Form<HashMap<String, String>>,
    ) -> Response {
        p.exchanges.fetch_add(1, Ordering::Relaxed);
        let e = p.expected.lock().await;
        assert_eq!(
            headers.get(header::AUTHORIZATION).unwrap(),
            "Basic Y2xpZW50OnNlY3JldA=="
        );
        assert_eq!(form.get("code").map(String::as_str), Some("one-time-code"));
        assert_eq!(
            form.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:3000/api/auth/callback")
        );
        let verifier = form.get("code_verifier").unwrap();
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
            e["challenge"].as_str().unwrap()
        );
        let claims = json!({"iss":p.issuer,"aud":if e["badAudience"]==true {"wrong-client"}else{"client"},"sub":"subject-1","nonce":if e["badNonce"]==true {"incorrect"}else{e["nonce"].as_str().unwrap()},"iat":now_ms()/1000,"exp":now_ms()/1000+60});
        let mut header = jsonwebtoken::Header::new(Algorithm::RS256);
        header.kid = Some("test-key".into());
        let token = jsonwebtoken::encode(
            &header,
            &claims,
            &jsonwebtoken::EncodingKey::from_rsa_pem(include_bytes!(
                "../tests/fixtures/oidc-test-private.txt"
            ))
            .unwrap(),
        )
        .unwrap();
        Json(json!({"access_token":"access-token","id_token":token})).into_response()
    }
    async fn userinfo(State(p): State<Provider>, headers: HeaderMap) -> Json<Value> {
        assert_eq!(
            headers.get(header::AUTHORIZATION).unwrap(),
            "Bearer access-token"
        );
        let e = p.expected.lock().await;
        Json(
            json!({"sub":if e["badSubject"]==true{"wrong-subject"}else{"subject-1"},"preferred_username":"  玩家   One  ","picture":"https://example.test/avatar.png"}),
        )
    }
    async fn setup() -> (Auth, Provider, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let issuer = format!("http://{}", listener.local_addr().unwrap());
        let p = Provider {
            issuer: issuer.clone(),
            expected: Arc::new(Mutex::new(json!({}))),
            exchanges: Arc::new(AtomicUsize::new(0)),
        };
        let app = Router::new()
            .route("/.well-known/openid-configuration", get(discovery))
            .route("/keys", get(keys))
            .route("/token", post(token))
            .route("/userinfo", get(userinfo))
            .with_state(p.clone());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (
            Auth::new(issuer, "client".into(), "secret".into(), [8; 32], true).unwrap(),
            p,
            task,
        )
    }
    async fn begin(a: &Auth, p: &Provider, silent: bool) -> (HeaderMap, HashMap<String, String>) {
        let (url, cookie) = a
            .begin("http://127.0.0.1:3000", Some("/room/1234"), silent)
            .await
            .unwrap();
        let u = Url::parse(&url).unwrap();
        let query: HashMap<_, _> = u
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        assert_eq!(
            query.get("prompt").map(String::as_str),
            if silent { Some("none") } else { None }
        );
        assert_eq!(query["code_challenge_method"], "S256");
        let mut expected = p.expected.lock().await;
        expected["nonce"] = json!(query["nonce"]);
        expected["challenge"] = json!(query["code_challenge"]);
        drop(expected);
        let mut headers = HeaderMap::new();
        if let Some(cookie) = cookie {
            headers.insert(
                header::COOKIE,
                format!("{FLOW_COOKIE}={cookie}").parse().unwrap(),
            );
        }
        (
            headers,
            HashMap::from([
                ("state".into(), query["state"].clone()),
                ("code".into(), "one-time-code".into()),
            ]),
        )
    }
    #[tokio::test]
    async fn interactive_and_silent_pkce_round_trip() {
        let (a, p, task) = setup().await;
        for silent in [false, true] {
            let (headers, query) = begin(&a, &p, silent).await;
            let (next, cookie) = a
                .finish("http://127.0.0.1:3000", &headers, &query)
                .await
                .unwrap();
            assert_eq!(next.as_deref(), Some("/room/1234"));
            let user = a
                .read_session(&format!("{SESSION_COOKIE}={cookie}"))
                .unwrap()
                .unwrap();
            assert_eq!(user.id, "subject-1");
            assert_eq!(user.username, "玩家 One");
        }
        assert_eq!(p.exchanges.load(Ordering::Relaxed), 2);
        task.abort();
    }
    #[tokio::test]
    async fn reject_flow_token_claims_subject_and_discovery() {
        let (a, p, task) = setup().await;
        let (headers, mut query) = begin(&a, &p, false).await;
        let old = query.insert("state".into(), "wrong".into()).unwrap();
        assert!(
            a.finish("http://127.0.0.1:3000", &headers, &query)
                .await
                .is_err()
        );
        assert_eq!(p.exchanges.load(Ordering::Relaxed), 0);
        query.insert("state".into(), old);
        for field in ["badNonce", "badAudience", "badSubject"] {
            p.expected.lock().await[field] = json!(true);
            assert!(
                a.finish("http://127.0.0.1:3000", &headers, &query)
                    .await
                    .is_err(),
                "{field}"
            );
            p.expected.lock().await[field] = json!(false);
        }
        *a.inner.metadata.lock().await = None;
        p.expected.lock().await["badDiscovery"] = json!(true);
        assert!(a.metadata().await.is_err());
        task.abort();
    }
}
