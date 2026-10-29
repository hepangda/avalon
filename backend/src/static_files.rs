use crate::AppState;
use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
};
use serde_json::Value;
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tower_http::services::ServeDir;
#[derive(Clone)]
struct Frontend {
    root: PathBuf,
    aliases: Arc<HashMap<String, String>>,
}
pub fn router() -> Router<AppState> {
    from_root(std::env::var("FRONTEND_ROOT").unwrap_or_else(|_| "dist/client".into()))
}
pub fn from_root<S: Clone + Send + Sync + 'static>(root: impl Into<PathBuf>) -> Router<S> {
    let root = root.into();
    let mut aliases = HashMap::new();
    if let Ok(bytes) = std::fs::read(root.join("static-assets.json"))
        && let Ok(v) = serde_json::from_slice::<Value>(&bytes)
    {
        let base = v["base"].as_str().unwrap_or("");
        for entry in v["files"].as_array().into_iter().flatten() {
            if let Some(file) = entry["file"].as_str()
                && let Some(source) = hashed_public(file)
            {
                aliases.insert(format!("/{source}"), format!("{base}{file}"));
            }
        }
    }
    let frontend = Frontend {
        root: root.clone(),
        aliases: Arc::new(aliases),
    };
    // SPA fallback is explicit: missing asset and API paths remain 404.
    Router::new()
        .fallback_service(
            ServeDir::new(root)
                .append_index_html_on_directories(false)
                .fallback(Router::new().fallback(spa).with_state(frontend.clone())),
        )
        .layer(middleware::from_fn_with_state(frontend, headers))
}
fn hashed_public(file: &str) -> Option<&str> {
    let tail = file.strip_prefix("assets/public/")?;
    let (hash, path) = tail.split_once('/')?;
    if hash.len() == 16
        && hash
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        Some(path)
    } else {
        None
    }
}
fn immutable(path: &str) -> bool {
    if hashed_public(path.trim_start_matches('/')).is_some() {
        return true;
    }
    let Some(file) = path.strip_prefix("/assets/").filter(|p| !p.contains('/')) else {
        return false;
    };
    let Some((base, ext)) = file.rsplit_once('.') else {
        return false;
    };
    if !["js", "css", "woff", "woff2", "png", "webp", "svg"].contains(&ext) {
        return false;
    }
    base.split_once('-').is_some_and(|(_, suffix)| {
        suffix.len() >= 8
            && suffix
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}
fn asset(path: &str) -> bool {
    path.starts_with("/assets/") || ["/favicon.ico", "/apple-touch-icon.png"].contains(&path)
}
async fn spa(State(frontend): State<Frontend>, request: Request) -> Response {
    let path = request.uri().path();
    if asset(path)
        || path.starts_with("/api/")
        || path.starts_with("/rooms/") && path.ends_with("/ws")
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read(frontend.root.join("index.html")).await {
        Ok(bytes) => {
            let mut response = Response::new(Body::from(bytes));
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/html; charset=utf-8"),
            );
            response
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
async fn headers(State(frontend): State<Frontend>, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let head = request.method() == Method::HEAD;
    let mut response = if request.method() != Method::GET && !head {
        StatusCode::NOT_FOUND.into_response()
    } else if let Some(target) = frontend.aliases.get(&path) {
        {
            let mut r = Redirect::temporary(target).into_response();
            *r.status_mut() = StatusCode::FOUND;
            r
        }
    } else {
        next.run(request).await
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    if matches!(
        response.status(),
        StatusCode::OK | StatusCode::PARTIAL_CONTENT
    ) && !response
        .headers()
        .get(header::CONTENT_TYPE)
        .is_some_and(|v| v.to_str().unwrap_or("").contains("text/html"))
        && asset(&path)
    {
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"),
        );
        response.headers_mut().insert(
            "cross-origin-resource-policy",
            HeaderValue::from_static("cross-origin"),
        );
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(if immutable(&path) {
                "public, max-age=31536000, immutable"
            } else {
                "public, max-age=300, s-maxage=3600"
            }),
        );
    }
    if head {
        *response.body_mut() = Body::empty();
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use tower::ServiceExt;
    #[tokio::test]
    async fn frontend_routing_preserves_security_and_cache_contracts() {
        let root = std::env::temp_dir().join(format!("avalon-static-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(
            root.join("index.html"),
            "<!doctype html><title>Avalon</title>",
        )
        .unwrap();
        std::fs::write(root.join("assets/index-ABCDEFGH.js"), "export default 1").unwrap();
        std::fs::write(root.join("static-assets.json"),r#"{"base":"https://assets.example/","files":[{"file":"assets/public/0123456789abcdef/role.png"}]}"#).unwrap();
        let app = from_root::<()>(root.clone());
        for (path, status, cache) in [
            ("/room/1234", 200, "no-store"),
            ("/assets/missing.js", 404, "no-store"),
            ("/api/not-a-route", 404, "no-store"),
            (
                "/assets/index-ABCDEFGH.js",
                200,
                "public, max-age=31536000, immutable",
            ),
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status().as_u16(), status, "{path}");
            assert_eq!(response.headers()["cache-control"], cache);
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
            if path.contains("ABCDEFGH") {
                assert_eq!(response.headers()["access-control-allow-origin"], "*");
            }
        }
        let redirect = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/role.png")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(redirect.status(), StatusCode::FOUND);
        assert_eq!(
            redirect.headers()["location"],
            "https://assets.example/assets/public/0123456789abcdef/role.png"
        );
        let post = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/room/1234")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(post.status(), StatusCode::NOT_FOUND);
        let head = app
            .oneshot(
                Request::builder()
                    .method("HEAD")
                    .uri("/room/1234")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(head.status(), StatusCode::OK);
        assert!(
            axum::body::to_bytes(head.into_body(), 1024)
                .await
                .unwrap()
                .is_empty()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
