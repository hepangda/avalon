use anyhow::{Context, Result};
use avalon_server::{AppState, auth, http, room, static_files, storage::Database};
use axum::{
    Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "avalon_server=info,tower_http=info".into()),
        )
        .init();
    let public_origin =
        std::env::var("PUBLIC_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".into());
    let origin = url::Url::parse(&public_origin)?;
    anyhow::ensure!(
        origin.origin().ascii_serialization() == public_origin,
        "PUBLIC_ORIGIN must be an origin without a trailing slash"
    );
    let environment = std::env::var("ENVIRONMENT").unwrap_or_else(|_| "development".into());
    anyhow::ensure!(
        environment != "production" || origin.scheme() == "https",
        "Production PUBLIC_ORIGIN must use HTTPS"
    );
    let db = Database::connect(
        &std::env::var("DATABASE_URL").context("DATABASE_URL is required")?,
        std::env::var("PG_POOL_MAX")
            .unwrap_or_else(|_| "10".into())
            .parse()?,
    )
    .await?;
    avalon_server::migration::ensure_ready(&db).await?;
    let auth = auth::Auth::from_env()?;
    let cpu = db.cpu_pool();
    let rooms = room::RoomRegistry::new(db.clone(), cpu);
    rooms.restore().await?;
    let state = AppState {
        db: db.clone(),
        rooms: rooms.clone(),
        auth,
        public_origin,
        environment,
    };
    let api = Router::new()
        .merge(http::router())
        .merge(auth::router())
        .merge(room::router())
        .layer(middleware::from_fn(no_cache))
        .layer(DefaultBodyLimit::max(64 * 1024));
    let app = api
        .merge(static_files::router())
        .layer(middleware::from_fn_with_state(
            Arc::new(Semaphore::new(256)),
            admission,
        ))
        .with_state(state);
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".into());
    let listener = tokio::net::TcpListener::bind(format!("{host}:{port}")).await?;
    tracing::info!(%host,%port,"Avalon Rust server listening");
    let stop = CancellationToken::new();
    // Bound total shutdown, including HTTP work and database close, rather than
    // only the room queue. Interrupted SQL is recovered from PostgreSQL.
    let shutdown_deadline = tokio::spawn({
        let stop = stop.clone();
        async move {
            stop.cancelled().await;
            tokio::time::sleep(Duration::from_secs(15)).await;
            tracing::error!("Shutdown deadline exceeded");
            std::process::exit(1);
        }
    });
    let health_stop = stop.clone();
    let health_db = db.clone();
    let health_rooms = rooms.clone();
    let health = tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(2));
        let mut polls = 0;
        loop {
            tokio::select! {
                _=health_stop.cancelled()=>break,_=timer.tick()=>{polls+=1;if polls%30==0{health_rooms.evict_closed().await;}
                if let Err(error)=health_db.health().await{tracing::error!(%error,"database health unavailable");
                    if !health_db.ownership_available(){health_stop.cancel();break;}}}
            }
        }
    });
    let draining = tokio::spawn({
        let stop = stop.clone();
        async move {
            tokio::select! {_=signal()=>{},_=stop.cancelled()=>{}}
            stop.cancel();
            match tokio::time::timeout(Duration::from_secs(15), rooms.shutdown()).await {
                Ok(result) => result,
                Err(_) => {
                    tracing::error!("Room drain deadline exceeded; recovery required on restart");
                    std::process::exit(1);
                }
            }
        }
    });
    let server = axum::serve(listener, app).with_graceful_shutdown(stop.clone().cancelled_owned());
    server.await?;
    stop.cancel();
    let drained = draining.await?;
    let _ = health.await;
    let owned = db.ownership_available();
    db.close().await;
    shutdown_deadline.abort();
    drained?;
    anyhow::ensure!(owned, "Database ownership lost; restart required");
    Ok(())
}
async fn no_cache(request: axum::extract::Request, next: Next) -> Response {
    let mut res = next.run(request).await;
    res.headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    res.headers_mut()
        .insert("x-avalon-runtime", HeaderValue::from_static("rust"));
    res
}
async fn admission(
    State(limit): State<Arc<Semaphore>>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let Ok(_permit) = limit.try_acquire_owned() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Server busy").into_response();
    };
    next.run(request).await
}
async fn signal() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
