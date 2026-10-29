//! Real HTTP/WebSocket/PostgreSQL boundary tests. Never uses or changes a supplied database.
//! TEST_DATABASE_URL must name a disposable *_test database; the suite creates its own
//! UUID-named database on that server and drops it after the run.
//! TEST_DATABASE_URL=postgres://postgres:password@127.0.0.1:55439/avalon_rust_test \
//! cargo test --test runtime_integration -- --ignored --nocapture
use anyhow::{Context, Result, ensure};
use avalon_server::{
    AppState,
    auth::{self, Auth, AuthUser, SESSION_COOKIE},
    http,
    room::{self, RoomRegistry},
    storage::Database,
};
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::{
    net::{TcpListener, TcpStream},
    task::JoinHandle,
    time::timeout,
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

type Wire = WebSocketStream<MaybeTlsStream<TcpStream>>;
struct Client {
    wire: Wire,
    seq: u64,
    received: Vec<Value>,
    view: Option<Value>,
}
impl Client {
    async fn connect(server: &Server, code: &str, user: usize) -> Result<Self> {
        let mut request = format!("{}/rooms/{code}/ws", server.origin.replace("http:", "ws:"))
            .into_client_request()?;
        request
            .headers_mut()
            .insert("origin", server.origin.parse()?);
        request
            .headers_mut()
            .insert("cookie", server.cookies[user].parse()?);
        let (wire, _) = connect_async(request).await?;
        Ok(Self {
            wire,
            seq: 0,
            received: Vec::new(),
            view: None,
        })
    }
    async fn send(&mut self, event: &str, payload: Value) -> Result<String> {
        self.seq += 1;
        let id = self.seq.to_string();
        self.wire
            .send(Message::Text(
                json!({"t":"req","id":id,"event":event,"payload":payload})
                    .to_string()
                    .into(),
            ))
            .await?;
        Ok(id)
    }
    async fn read(&mut self) -> Result<Value> {
        loop {
            match timeout(Duration::from_secs(5), self.wire.next())
                .await
                .context("WebSocket response timed out")?
            {
                Some(Ok(Message::Text(raw))) => {
                    let v: Value = serde_json::from_str(&raw)?;
                    if v["event"] == "view:sync" {
                        self.view = Some(v["payload"].clone());
                    }
                    self.received.push(v.clone());
                    return Ok(v);
                }
                Some(Ok(Message::Ping(body))) => self.wire.send(Message::Pong(body)).await?,
                Some(Ok(Message::Close(close))) => anyhow::bail!("Socket closed: {close:?}"),
                Some(Err(error)) => return Err(error.into()),
                None => anyhow::bail!("Socket ended"),
                _ => {}
            }
        }
    }
    async fn ack(&mut self, id: &str) -> Result<Value> {
        if let Some(v) = self
            .received
            .iter()
            .find(|v| v["t"] == "ack" && v["id"] == id)
        {
            return Ok(v["res"].clone());
        }
        loop {
            let v = self.read().await?;
            if v["t"] == "ack" && v["id"] == id {
                return Ok(v["res"].clone());
            }
        }
    }
    async fn call(&mut self, event: &str, payload: Value) -> Result<Value> {
        let id = self.send(event, payload).await?;
        self.ack(&id).await
    }
    async fn ok(&mut self, event: &str, payload: Value) -> Result<Value> {
        let response = self.call(event, payload).await?;
        ensure!(response["ok"] == true, "{event} failed: {response}");
        Ok(response)
    }
    async fn closed_without_view_text(&mut self, forbidden: &str) -> Result<()> {
        loop {
            match self.read().await {
                Ok(v) => ensure!(
                    v["event"] != "view:sync" || !v["payload"].to_string().contains(forbidden),
                    "Failed transaction published speculative state"
                ),
                Err(error) => {
                    ensure!(
                        !error.to_string().contains("timed out"),
                        "Failed transaction did not close the socket"
                    );
                    return Ok(());
                }
            }
        }
    }
    async fn sync(&mut self) -> Result<Value> {
        self.ok("room:resync", json!({})).await?;
        self.view.clone().context("Expected committed view")
    }
    fn player_id(&self) -> Result<String> {
        self.view
            .as_ref()
            .and_then(|v| v["view"]["playerId"].as_str())
            .map(str::to_owned)
            .context("Expected player binding")
    }
}
struct Server {
    db: Database,
    rooms: RoomRegistry,
    origin: String,
    cookies: Vec<String>,
    task: JoinHandle<()>,
}
impl Server {
    async fn start(url: &str) -> Result<Self> {
        let db = Database::connect(url, 12).await?;
        let rooms = RoomRegistry::new(db.clone(), db.cpu_pool());
        rooms.restore().await?;
        let auth = Auth::new(
            "https://auth.pangda.app".into(),
            "runtime-fixture".into(),
            "fixture-secret".into(),
            [91; 32],
            true,
        )?;
        let cookies = (0..6)
            .map(|i| {
                auth.seal_session(AuthUser {
                    id: format!("runtime-user-{i}"),
                    username: format!("User{i}"),
                    picture: None,
                })
                .map(|token| format!("{SESSION_COOKIE}={token}"))
            })
            .collect::<Result<Vec<_>>>()?;
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let origin = format!("http://{}", listener.local_addr()?);
        let state = AppState {
            db: db.clone(),
            rooms: rooms.clone(),
            auth: auth.clone(),
            public_origin: origin.clone(),
            environment: "development".into(),
        };
        let app = Router::new()
            .merge(http::router())
            .merge(auth::router())
            .merge(room::router())
            .with_state(state);
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Ok(Self {
            db,
            rooms,
            origin,
            cookies,
            task,
        })
    }
    async fn stop(&self) -> Result<()> {
        self.rooms.shutdown().await?;
        self.task.abort();
        self.db.close().await;
        Ok(())
    }
    async fn create(&self, roster: Vec<&str>) -> Result<String> {
        let response = reqwest::Client::new()
            .post(format!("{}/api/rooms", self.origin))
            .header("cookie", &self.cookies[0])
            .json(&json!({"roster":roster}))
            .send()
            .await?;
        let status = response.status();
        let body: Value = response.json().await?;
        ensure!(
            status == reqwest::StatusCode::CREATED,
            "Create room: {status}: {body}"
        );
        body["code"]
            .as_str()
            .map(str::to_owned)
            .context("Room code")
    }
    async fn document(&self, code: &str) -> Result<Value> {
        Ok(self
            .db
            .load_room(code)
            .await?
            .context("Room absent")?
            .document)
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn await_write_lock(db: &Database) -> Result<()> {
    timeout(Duration::from_secs(3),async{loop{
  let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'UPDATE avalon_rooms%')").fetch_one(&db.pool).await?;
  if waiting{return Ok::<_,anyhow::Error>(());}tokio::time::sleep(Duration::from_millis(10)).await;
 }}).await.context("Room never reached blocked database UPDATE")??;
    Ok(())
}
fn assert_private(view: &Value, expected: Option<&str>) -> Result<()> {
    let game = &view["view"]["game"];
    ensure!(!game.is_null(), "Missing game projection");
    ensure!(
        game.get("seed").is_none() && game.get("missionCards").is_none(),
        "Server-private fields leaked"
    );
    ensure!(
        game["players"]
            .as_array()
            .context("players")?
            .iter()
            .all(|p| p.get("role").is_none()
                || (expected.is_some() && p["id"] == view["view"]["playerId"])),
        "A player's role leaked in public player list"
    );
    if let Some(role) = expected {
        ensure!(game["selfRole"] == role, "Wrong private role");
    } else {
        ensure!(
            game["selfRole"].is_null() && game["knownPlayers"] == json!([]),
            "Spectator received hidden role information"
        );
    }
    Ok(())
}

async fn gameplay_and_transactions(server: &Server) -> Result<(String, String, Value)> {
    // Exercise authentication and origin checks at the actual WebSocket upgrade.
    let code = server
        .create(vec!["Seat 1", "Seat 2", "Seat 3", "Seat 4", "Seat 5"])
        .await?;
    let nonupgrade = reqwest::Client::new()
        .get(format!("{}/rooms/{code}/ws", server.origin))
        .send()
        .await?;
    ensure!(
        nonupgrade.status().as_u16() == 426,
        "Plain HTTP websocket endpoint lost Upgrade Required response"
    );
    ensure!(
        nonupgrade.json::<Value>().await? == json!({"error":"Expected websocket"}),
        "Unexpected websocket upgrade error payload"
    );
    let mut denied = format!("{}/rooms/{code}/ws", server.origin.replace("http:", "ws:"))
        .into_client_request()?;
    denied
        .headers_mut()
        .insert("origin", server.origin.parse()?);
    let error = connect_async(denied).await.unwrap_err();
    ensure!(
        matches!(error,tokio_tungstenite::tungstenite::Error::Http(r) if r.status().as_u16()==401),
        "Unauthenticated websocket accepted"
    );
    let mut wrong_origin = format!("{}/rooms/{code}/ws", server.origin.replace("http:", "ws:"))
        .into_client_request()?;
    wrong_origin
        .headers_mut()
        .insert("origin", "https://attacker.invalid".parse()?);
    wrong_origin
        .headers_mut()
        .insert("cookie", server.cookies[0].parse()?);
    let error = connect_async(wrong_origin).await.unwrap_err();
    ensure!(
        matches!(error,tokio_tungstenite::tungstenite::Error::Http(r) if r.status().as_u16()==403),
        "Cross-origin websocket accepted"
    );
    let mut unjoined = Client::connect(server, &code, 5).await?;
    let emote = unjoined
        .call("table:emote", json!({"emote":"approve"}))
        .await?;
    ensure!(
        emote["ok"] == false && emote["error"]["code"] == "NOT_IN_ROOM",
        "Unjoined socket may send table reactions"
    );
    drop(unjoined);
    let mut clients = Vec::new();
    for i in 0..5 {
        let mut client = Client::connect(server, &code, i).await?;
        client.ok("room:join", json!({})).await?;
        if i > 0 {
            client
                .ok("room:claimSeat", json!({"name":format!("User{i}")}))
                .await?;
        }
        clients.push(client);
    }
    let mut spectator = Client::connect(server, &code, 5).await?;
    spectator.ok("room:join", json!({})).await?;
    let players = clients
        .iter()
        .map(Client::player_id)
        .collect::<Result<Vec<_>>>()?;
    clients[0].ok("room:start", json!({})).await?;
    let started = server.document(&code).await?;
    ensure!(
        started["game"]["phase"] == "TeamBuilding"
            && started["meta"]["status"] == "in_game"
            && started["eventSeq"].as_i64().unwrap_or(0) > 0,
        "START ack arrived without committed start: phase={}, roles={}",
        started["game"]["phase"],
        started["game"]["roleAcks"]
    );
    for (i, client) in clients.iter_mut().enumerate() {
        let view = client.sync().await?;
        let role = started["game"]["players"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == players[i])
            .unwrap()["role"]
            .as_str()
            .unwrap();
        assert_private(&view, Some(role))?;
        client
            .ok(
                "game:ackRole",
                json!({"roleRevision":view["view"]["game"]["roleRevision"]}),
            )
            .await?;
    }
    assert_private(&spectator.sync().await?, None)?;
    let doc = server.document(&code).await?;
    ensure!(
        doc["game"]["phase"] == "TeamBuilding",
        "Roles did not advance"
    );
    let leader = doc["game"]["players"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["seat"] == doc["game"]["leaderIndex"])
        .unwrap()["id"]
        .as_str()
        .unwrap();
    let leader = players.iter().position(|p| p == leader).unwrap();
    let team = json!([players[0], players[1]]);
    clients[leader]
        .ok("game:proposeTeam", json!({"team":team}))
        .await?;
    clients[leader]
        .ok("game:startDiscussion", json!({"direction":"clockwise"}))
        .await?;
    let discussion = server.document(&code).await?["game"]["discussion"]["order"]
        .as_array()
        .unwrap()
        .clone();
    for speaker in discussion {
        let i = players
            .iter()
            .position(|id| Some(id.as_str()) == speaker.as_str())
            .unwrap();
        clients[i].ok("game:endSpeech", json!({})).await?;
    }
    clients[leader]
        .ok("game:finalizeTeam", json!({"team":team}))
        .await?;
    clients[0]
        .ok("game:vote", json!({"value":"approve"}))
        .await?;
    let private_vote = spectator.sync().await?;
    assert_private(&private_vote, None)?;
    ensure!(
        private_vote["view"]["game"]["votes"]
            .as_array()
            .context("vote projection")?
            .iter()
            .all(|v| v.get("vote").is_none_or(Value::is_null)),
        "Unfinished vote values leaked to spectator"
    );
    for client in clients.iter_mut().skip(1) {
        client.ok("game:vote", json!({"value":"approve"})).await?;
    }
    let doc = server.document(&code).await?;
    ensure!(
        doc["game"]["phase"] == "MissionVote",
        "Vote ACK preceded database commit"
    );

    let revealed = spectator.sync().await?;
    ensure!(
        revealed["view"]["game"]["votes"]
            .as_array()
            .context("revealed votes")?
            .iter()
            .all(|v| v["vote"] == "approve"),
        "Completed votes were not revealed"
    );
    // Store private notes; these survive process replacement but are absent from views.
    let scope = json!({"gameId":doc["meta"]["gameId"],"roleRevision":doc["game"]["roleRevision"],"playerId":players[0]});
    let mut notes = scope.clone();
    notes["update"] =
        json!({"baseRevision":0,"notes":{players[1].clone():"percival-claim"},"enabled":true});
    let saved = clients[0].ok("notes:sync", notes).await?["data"].clone();
    ensure!(
        !spectator
            .sync()
            .await?
            .to_string()
            .contains("percival-claim"),
        "Private notes leaked"
    );

    // A real PostgreSQL table lock holds COMMIT-path work. Fast paths must read only
    // the committed snapshot and must not wait behind the queued rename.
    let committed = clients[0].sync().await?;
    let mut lock = server.db.pool.begin().await?;
    sqlx::query("LOCK TABLE avalon_rooms IN SHARE MODE")
        .execute(&mut *lock)
        .await?;
    let pending = clients[0]
        .send("room:rename", json!({"name":"Committed"}))
        .await?;
    await_write_lock(&server.db).await?;
    let ping = timeout(
        Duration::from_millis(500),
        clients[0].ok("net:ping", json!({})),
    )
    .await
    .context("Heartbeat blocked behind SQL")??;
    ensure!(
        ping["data"]["sync"]["hash"] == committed["hash"],
        "Heartbeat exposed speculative hash"
    );
    let recovery = timeout(Duration::from_millis(500), clients[0].sync())
        .await
        .context("Resync blocked behind SQL")??;
    ensure!(
        recovery["hash"] == committed["hash"],
        "Resync exposed speculative hash"
    );
    ensure!(
        recovery["view"]["room"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m["name"] != "Committed"),
        "Uncommitted rename leaked"
    );
    ensure!(
        !clients[0]
            .received
            .iter()
            .any(|v| v["t"] == "ack" && v["id"] == pending),
        "Mutation ACK sent before SQL commit"
    );
    lock.commit().await?;
    ensure!(
        clients[0].ack(&pending).await?["ok"] == true,
        "Rename did not commit"
    );
    let doc = server.document(&code).await?;
    ensure!(
        doc["members"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["id"] == players[0] && m["name"] == "Committed"),
        "ACK without durable rename"
    );

    // Force the actual UPDATE transaction to fail. No speculative state is allowed
    // on any socket, and a fresh connection must restore the last committed state.
    sqlx::query("CREATE FUNCTION runtime_fail_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'runtime test injected commit failure'; END $$").execute(&server.db.pool).await?;
    sqlx::query("CREATE TRIGGER runtime_fail_update BEFORE UPDATE ON avalon_rooms FOR EACH ROW EXECUTE FUNCTION runtime_fail_update()").execute(&server.db.pool).await?;
    let failed = clients[0]
        .send("room:rename", json!({"name":"Speculate"}))
        .await?;
    while let Ok(v) = clients[0].read().await {
        ensure!(
            v["event"] != "view:sync" || !v["payload"].to_string().contains("Speculate"),
            "Failed transaction published state"
        );
        if v["t"] == "ack" && v["id"] == failed {
            ensure!(
                v["res"]["ok"] == false,
                "Failed transaction acknowledged success"
            );
            break;
        }
    }
    for client in &mut clients {
        client.closed_without_view_text("Speculate").await?;
    }
    spectator.closed_without_view_text("Speculate").await?;
    sqlx::query("DROP TRIGGER runtime_fail_update ON avalon_rooms")
        .execute(&server.db.pool)
        .await?;
    sqlx::query("DROP FUNCTION runtime_fail_update()")
        .execute(&server.db.pool)
        .await?;
    ensure!(
        server.document(&code).await?["members"]
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m["name"] != "Speculate"),
        "Failed transaction persisted state"
    );
    let mut recovered = Client::connect(server, &code, 0).await?;
    recovered.ok("room:join", json!({})).await?;
    ensure!(
        recovered.player_id()? == players[0],
        "Failure recovery lost account seat"
    );
    ensure!(
        recovered.sync().await?["view"]["room"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["id"] == players[0] && m["name"] == "Committed"),
        "Recovery did not restore committed rename"
    );

    // Replace the recovered device, then close the old connection. The old close
    // must not detach or mark the replacement's seat offline.
    let mut replacement = Client::connect(server, &code, 0).await?;
    replacement.ok("room:join", json!({})).await?;
    let mut replaced_notice = false;
    for _ in 0..10 {
        match recovered.read().await {
            Ok(v) => {
                if v["event"] == "system:notice" && v["payload"]["type"] == "session_replaced" {
                    replaced_notice = true;
                }
            }
            Err(_) => break,
        }
    }
    ensure!(
        replaced_notice,
        "Old device did not receive takeover notice"
    );
    drop(recovered);
    ensure!(replacement.player_id()? == players[0], "Takeover lost seat");
    replacement.ok("net:ping", json!({})).await?;
    ensure!(
        replacement.sync().await?["view"]["room"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["id"] == players[0] && m["connected"] == true),
        "Stale close disconnected new device"
    );
    ensure!(
        replacement.ok("notes:sync", scope.clone()).await?["data"] == saved,
        "Takeover lost notes"
    );
    drop(replacement);
    drop(clients);
    drop(spectator);
    Ok((code, players[0].clone(), scope))
}
async fn connection_backpressure(server: &Server) -> Result<()> {
    let code = server.create(vec!["Seat"]).await?;
    let mut client = Client::connect(server, &code, 0).await?;
    client.ok("room:join", json!({})).await?;
    let mut lock = server.db.pool.begin().await?;
    sqlx::query("LOCK TABLE avalon_rooms IN SHARE MODE")
        .execute(&mut *lock)
        .await?;
    client
        .send("room:rename", json!({"name":"Pressure0"}))
        .await?;
    await_write_lock(&server.db).await?;
    for i in 1..33 {
        client
            .send("room:rename", json!({"name":format!("Pressure{i}")}))
            .await?;
    }
    let close = timeout(Duration::from_secs(2), async {
        loop {
            match client.wire.next().await {
                Some(Ok(Message::Close(frame))) => {
                    return frame.context("Missing close reason");
                }
                Some(Ok(Message::Ping(p))) => client.wire.send(Message::Pong(p)).await?,
                Some(Ok(_)) => {}
                Some(Err(e)) => return Err(e.into()),
                None => anyhow::bail!("Ended without backpressure close"),
            }
        }
    })
    .await
    .context("Connection accepted more than 32 queued requests")??;
    ensure!(
        u16::from(close.code) == 1013,
        "Unexpected backpressure close: {close:?}"
    );
    lock.commit().await?;
    Ok(())
}
async fn restored_and_dissolution(
    server: &Server,
    code: &str,
    player: &str,
    scope: Value,
) -> Result<()> {
    let mut client = Client::connect(server, code, 0).await?;
    let joined = client.ok("room:join", json!({})).await?;
    ensure!(
        joined["data"]["playerId"] == player && joined["data"]["isHost"] == true,
        "Restart lost account/host binding"
    );
    let notes = client.ok("notes:sync", scope).await?;
    ensure!(notes["data"]["revision"] == 1, "Restart lost notes");
    ensure!(
        client.sync().await?["view"]["game"]["phase"] == "MissionVote",
        "Restart lost gameplay phase"
    );
    connection_backpressure(server)
        .await
        .context("Per-connection backpressure")?;
    let empty = server.create(vec!["Seat"]).await?;
    let mut host = Client::connect(server, &empty, 0).await?;
    host.ok("room:join", json!({})).await?;
    let leave = host.send("room:leave", json!({})).await?;
    let _ = host.ack(&leave).await;
    timeout(Duration::from_secs(3), async {
        loop {
            if server.db.load_room(&empty).await?.is_none() {
                return Ok::<_, anyhow::Error>(());
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await??;
    ensure!(
        server.rooms.preview(&empty).await?.is_none(),
        "Dissolved room remains visible"
    );
    Ok(())
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires disposable TEST_DATABASE_URL whose database name ends _test"]
async fn actual_socket_sql_commit_privacy_recovery_and_lifecycle() -> Result<()> {
    let supplied =
        std::env::var("TEST_DATABASE_URL").context("Disposable TEST_DATABASE_URL required")?;
    let mut url = url::Url::parse(&supplied)?;
    ensure!(
        url.path().trim_start_matches('/').ends_with("_test"),
        "Refusing a database not ending _test"
    );
    url.set_path("/postgres");
    let admin = sqlx::PgPool::connect(url.as_str()).await?;
    let name = format!("avalon_runtime_{}_test", uuid::Uuid::new_v4().simple());
    sqlx::query(sqlx::AssertSqlSafe(format!("CREATE DATABASE {name}")))
        .execute(&admin)
        .await?;
    url.set_path(&format!("/{name}"));
    let result = async {
        let first = Server::start(url.as_str()).await?;
        let first_result = gameplay_and_transactions(&first).await;
        first.stop().await?;
        let (code, player, scope) = first_result?;
        let second = Server::start(url.as_str()).await?;
        let result = restored_and_dissolution(&second, &code, &player, scope).await;
        second.stop().await?;
        result
    }
    .await;
    let cleanup = sqlx::query(sqlx::AssertSqlSafe(format!(
        "DROP DATABASE {name} WITH (FORCE)"
    )))
    .execute(&admin)
    .await;
    admin.close().await;
    result?;
    cleanup?;
    Ok(())
}
