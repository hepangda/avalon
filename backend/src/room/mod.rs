pub mod domain;
#[cfg(test)]
mod domain_tests;
pub mod helpers;
pub mod model;
pub mod protocol;
mod seating;

use crate::engine::typed::{self, ClientGameState, PlayerId};
use crate::{AppState, cpu::CpuPool, now_ms, storage::Database};
use anyhow::Result;
use axum::{
    Router,
    extract::{
        Path, State, WebSocketUpgrade,
        ws::rejection::WebSocketUpgradeRejection,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use domain::Draft;
use futures_util::{SinkExt, StreamExt};
use helpers::*;
use model::*;
use protocol::{Ack, Command, Init, InitOutcome, RoomErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, VecDeque},
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::{mpsc, oneshot, watch},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

const ROOM_QUEUE: usize = 128;
const CONNECTION_QUEUE: usize = 32;
const MAX_BUFFERED: usize = 1024 * 1024;
const MAX_ROOM_CONNECTIONS: usize = 256;

#[derive(Clone)]
pub struct RoomRegistry {
    inner: Arc<Registry>,
}
struct Registry {
    db: Database,
    cpu: CpuPool,
    rooms: tokio::sync::Mutex<HashMap<String, Handle>>,
    stopping: AtomicBool,
}
#[derive(Clone)]
struct Handle {
    tx: mpsc::Sender<Work>,
    live: Arc<Live>,
    cpu: CpuPool,
}
struct Live {
    peers: RwLock<BTreeMap<String, Arc<Peer>>>,
    latencies: Mutex<HashMap<String, i64>>,
    last_used: std::sync::atomic::AtomicI64,
}
struct Peer {
    id: String,
    account: String,
    out: mpsc::Sender<Message>,
    bytes: AtomicUsize,
    pending: AtomicUsize,
    retired: AtomicBool,
    close: watch::Sender<Option<(u16, String)>>,
    view: watch::Sender<Option<Arc<ViewSnapshot>>>,
    emotes: Mutex<VecDeque<i64>>,
}
#[derive(Serialize)]
struct ViewSnapshot {
    epoch: String,
    revision: i64,
    hash: String,
    view: Arc<RoomView>,
    #[serde(skip_serializing_if = "is_false")]
    recovery: bool,
}
fn is_false(value: &bool) -> bool {
    !*value
}
#[derive(Serialize)]
struct ViewPush<'a> {
    t: &'static str,
    event: &'static str,
    payload: &'a ViewSnapshot,
}
fn encode_view(snapshot: &ViewSnapshot) -> Message {
    Message::Text(
        serde_json::to_string(&ViewPush {
            t: "push",
            event: "view:sync",
            payload: snapshot,
        })
        .expect("valid view")
        .into(),
    )
}
impl Peer {
    fn send(&self, msg: Message) {
        if self.retired.load(Ordering::Acquire) {
            return;
        }
        self.send_even_retired(msg);
    }
    fn send_even_retired(&self, msg: Message) {
        let size = message_size(&msg);
        if self.bytes.fetch_add(size, Ordering::AcqRel) + size > MAX_BUFFERED {
            self.bytes.fetch_sub(size, Ordering::AcqRel);
            self.close(1013, "Slow client");
            return;
        }
        if self.out.try_send(msg).is_err() {
            self.bytes.fetch_sub(size, Ordering::AcqRel);
            self.close(1013, "Slow client");
        }
    }
    fn json(&self, v: Value) {
        self.send(Message::Text(v.to_string().into()));
    }
    fn close(&self, code: u16, reason: &str) {
        self.retired.store(true, Ordering::Release);
        self.close.send_replace(Some((code, reason.to_owned())));
    }
    fn ack(&self, id: &str, res: impl Serialize) {
        self.json(json!({"t":"ack","id":id,"res":res}));
    }
}
enum Work {
    Init(Init, oneshot::Sender<Result<InitOutcome>>),
    Preview(oneshot::Sender<Result<Option<Value>>>),
    Seat(AccountId, PlayerId, oneshot::Sender<Result<Option<String>>>),
    Connect(Arc<Peer>, oneshot::Sender<Result<()>>),
    Disconnect(String),
    Action {
        peer: Arc<Peer>,
        id: String,
        command: Command,
    },
    Maintain(oneshot::Sender<Result<()>>),
    Shutdown(oneshot::Sender<Result<()>>),
}

impl RoomRegistry {
    pub fn new(db: Database, cpu: CpuPool) -> Self {
        Self {
            inner: Arc::new(Registry {
                db,
                cpu,
                rooms: tokio::sync::Mutex::new(HashMap::new()),
                stopping: AtomicBool::new(false),
            }),
        }
    }
    async fn get(&self, code: &str) -> Result<Handle> {
        anyhow::ensure!(
            !self.inner.stopping.load(Ordering::Acquire),
            "Server draining"
        );
        anyhow::ensure!(valid_code(code), "Invalid room code");
        let mut rooms = self.inner.rooms.lock().await;
        if let Some(h) = rooms.get(code)
            && !h.tx.is_closed()
        {
            return Ok(h.clone());
        }
        let (tx, rx) = mpsc::channel(ROOM_QUEUE);
        let live = Arc::new(Live {
            peers: RwLock::new(BTreeMap::new()),
            latencies: Mutex::new(HashMap::new()),
            last_used: std::sync::atomic::AtomicI64::new(now_ms()),
        });
        let h = Handle {
            tx,
            live: live.clone(),
            cpu: self.inner.cpu.clone(),
        };
        rooms.insert(code.to_owned(), h.clone());
        let actor = Actor {
            code: code.to_owned(),
            db: self.inner.db.clone(),
            cpu: self.inner.cpu.clone(),
            live,
            rx,
            doc: None,
            stored_doc: None,
            version: 0,
            loaded: false,
            recovering: true,
            quarantined: false,
            bindings: BTreeMap::new(),
            epoch: uuid::Uuid::new_v4().to_string(),
            revision: 0,
            checkpoint: None,
            checkpoint_version: 0,
            checkpoint_at: now_ms(),
        };
        tokio::spawn(actor.run());
        Ok(h)
    }
    pub async fn init(&self, code: &str, input: Init) -> Result<InitOutcome> {
        let handle = self.get(code).await?;
        let (tx, rx) = oneshot::channel();
        handle
            .tx
            .try_send(Work::Init(input, tx))
            .map_err(|_| anyhow::anyhow!("Room busy"))?;
        rx.await?
    }
    pub async fn preview(&self, code: &str) -> Result<Option<Value>> {
        let h = self.get(code).await?;
        let (tx, rx) = oneshot::channel();
        h.tx.try_send(Work::Preview(tx))
            .map_err(|_| anyhow::anyhow!("Room busy"))?;
        rx.await?
    }
    pub async fn seat_account(
        &self,
        code: &str,
        viewer: &str,
        target: &str,
    ) -> Result<Option<String>> {
        let h = self.get(code).await?;
        let (tx, rx) = oneshot::channel();
        h.tx.try_send(Work::Seat(viewer.into(), target.into(), tx))
            .map_err(|_| anyhow::anyhow!("Room busy"))?;
        rx.await?
    }
    pub async fn restore(&self) -> Result<()> {
        for code in self.inner.db.list_room_codes().await? {
            let h = self.get(&code).await?;
            let (tx, rx) = oneshot::channel();
            h.tx.send(Work::Maintain(tx)).await?;
            match rx.await? {
                Ok(()) => {}
                Err(error) if error.is::<crate::journal::JournalIntegrityError>() => {
                    tracing::error!(room=%code,%error,"room recovery quarantined")
                }
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
    pub async fn shutdown(&self) -> Result<()> {
        self.inner.stopping.store(true, Ordering::Release);
        let handles: Vec<_> = self.inner.rooms.lock().await.values().cloned().collect();
        for handle in &handles {
            for peer in handle.live.peers.read().unwrap().values() {
                peer.close(1012, "Server restarting");
            }
        }
        let outcomes = futures_util::future::join_all(handles.into_iter().map(|h| async move {
            let (tx, rx) = oneshot::channel();
            if h.tx.send(Work::Shutdown(tx)).await.is_ok() {
                rx.await??;
            }
            Ok::<_, anyhow::Error>(())
        }))
        .await;
        for result in outcomes {
            result?;
        }
        Ok(())
    }
    pub async fn evict_closed(&self) {
        self.inner
            .rooms
            .lock()
            .await
            .retain(|_, h| !h.tx.is_closed());
    }
}
fn valid_code(code: &str) -> bool {
    code.len() == 4 && code.bytes().all(|b| b.is_ascii_digit())
}

struct Actor {
    code: String,
    db: Database,
    cpu: CpuPool,
    live: Arc<Live>,
    rx: mpsc::Receiver<Work>,
    doc: Option<Arc<RoomDocument>>,
    stored_doc: Option<Arc<Value>>,
    version: i64,
    loaded: bool,
    recovering: bool,
    quarantined: bool,
    bindings: Bindings,
    epoch: String,
    revision: i64,
    checkpoint: Option<JoinHandle<Result<()>>>,
    checkpoint_version: i64,
    checkpoint_at: i64,
}
impl Actor {
    async fn load(&mut self) -> Result<()> {
        if self.quarantined {
            return Err(crate::journal::JournalIntegrityError("Room is quarantined".into()).into());
        }
        if self.loaded {
            return Ok(());
        }
        let record = self.db.load_room(&self.code).await?;
        if let Some(record) = record {
            if record.document["schemaVersion"] != 1
                || record.document["randomnessVersion"] != "resolved-v1"
                || (!record.document["game"].is_null()
                    && record.document["game"]["randomnessVersion"] != "resolved-v1")
                || record.document["meta"]["code"] != self.code
                || !record.document["members"].is_array()
            {
                return Err(crate::journal::JournalIntegrityError(
                    "Unsupported room snapshot".into(),
                )
                .into());
            }
            self.version = record.version;
            let (document, stored) = self
                .cpu
                .run(move || -> Result<_> {
                    let typed: RoomDocument = serde_json::from_value(record.document.clone())
                        .map_err(|error| {
                            crate::journal::JournalIntegrityError(format!(
                                "Invalid room document: {error}"
                            ))
                        })?;
                    Ok((Arc::new(typed), Arc::new(record.document)))
                })
                .await??;
            self.doc = Some(document);
            self.stored_doc = Some(stored);
        } else {
            self.doc = None;
            self.stored_doc = None;
            self.version = 0;
        }
        self.checkpoint_version = self.version;
        self.loaded = true;
        self.recovering = true;
        Ok(())
    }
    async fn run(mut self) {
        loop {
            let checkpoint_due = if self.checkpoint.is_none() {
                self.checkpoint_at + 60_000
            } else {
                now_ms() + 60_000
            };
            let deadline = if self.quarantined {
                now_ms() + 60_000
            } else {
                self.deadline().min(checkpoint_due).max(now_ms() + 1)
            };
            let wait = Duration::from_millis((deadline - now_ms()).max(1) as u64);
            let work = tokio::select! {w=self.rx.recv()=>w,_=tokio::time::sleep(wait)=>{
                if let Err(error)=self.transition(Operation::Maintain).await{self.failed(&error);tokio::time::sleep(Duration::from_secs(1)).await;}
                if (self.doc.is_none()||self.quarantined)&&self.live.peers.read().unwrap().is_empty()&&now_ms()-self.live.last_used.load(Ordering::Relaxed)>300_000{break;}
                continue;
            }};
            let Some(work) = work else {
                break;
            };
            self.live.last_used.store(now_ms(), Ordering::Relaxed);
            match work {
                Work::Init(input, reply) => {
                    let res = self.initialize(input).await;
                    if let Err(error) = &res {
                        self.failed(error);
                    }
                    let _ = reply.send(res);
                }
                Work::Preview(reply) => {
                    let res=self.load().await.map(|_|self.doc.as_ref().map(|d|json!({"code":d.meta.code,"status":d.meta.status,"playerCount":d.active().filter(|m|m.claimed).count(),"maxPlayers":d.meta.config.max_players,"allowSpectators":true,"allowMidJoin":true})));
                    let _ = reply.send(res);
                }
                Work::Seat(viewer, target, reply) => {
                    let res = self.load().await.map(|_| {
                        if !self
                            .bindings
                            .values()
                            .any(|b| !b.retired && b.account == viewer)
                        {
                            return None;
                        }
                        let d = self.doc.as_ref()?;
                        let m = d.member(&target)?;
                        if !m.claimed || m.bot() {
                            return None;
                        }
                        d.accounts.get(&target).map(|a| a.0.clone())
                    });
                    let _ = reply.send(res);
                }
                Work::Connect(peer, reply) => {
                    if self.bindings.len() >= MAX_ROOM_CONNECTIONS {
                        let _ = reply.send(Err(anyhow::anyhow!("Room connection limit")));
                        continue;
                    }
                    self.bindings.insert(
                        peer.id.clone().into(),
                        Binding {
                            account: peer.account.clone().into(),
                            ..Default::default()
                        },
                    );
                    self.live
                        .peers
                        .write()
                        .unwrap()
                        .insert(peer.id.clone(), peer);
                    let _ = reply.send(Ok(()));
                }
                Work::Disconnect(id) => {
                    let res = self
                        .transition(Operation::Disconnect(id.clone().into()))
                        .await;
                    self.live.peers.write().unwrap().remove(&id);
                    self.bindings.remove(id.as_str());
                    if let Err(error) = res {
                        self.failed(&error);
                    }
                }
                Work::Action { peer, id, command } => {
                    let res = if peer.retired.load(Ordering::Acquire) {
                        Ok(Ack::fail(
                            RoomErrorCode::Reconnect,
                            "Reconnect to reload room state",
                        ))
                    } else {
                        self.transition(Operation::Command(peer.id.clone().into(), command))
                            .await
                    };
                    match res {
                        Ok(res) => peer.ack(&id, res),
                        Err(error) => {
                            peer.send_even_retired(Message::Text(
                                json!({"t":"ack","id":id,"res":Ack::fail(RoomErrorCode::Internal,"Internal error")})
                                    .to_string()
                                    .into(),
                            ));
                            self.failed(&error);
                        }
                    }
                    peer.pending.fetch_sub(1, Ordering::AcqRel);
                }
                Work::Maintain(reply) => {
                    let res = self.transition(Operation::Maintain).await.map(|_| ());
                    if let Err(error) = &res {
                        self.failed(error);
                    }
                    let _ = reply.send(res);
                }
                Work::Shutdown(reply) => {
                    for p in self.live.peers.read().unwrap().values() {
                        p.close(1012, "Server restarting");
                    }
                    if self.quarantined {
                        let _ = reply.send(Ok(()));
                        break;
                    }
                    let res = self.transition(Operation::Shutdown).await;
                    let result = match res {
                        Ok(_) => self.checkpoint_now().await,
                        Err(e) => Err(e),
                    };
                    let _ = reply.send(result);
                    break;
                }
            }
        }
    }
    fn failed(&mut self, error: &anyhow::Error) {
        if error.is::<crate::journal::JournalIntegrityError>() {
            self.quarantined = true;
        }
        tracing::error!(room=%self.code,%error,"room operation failed; reload required");
        self.loaded = false;
        for (id, b) in &mut self.bindings {
            b.retired = true;
            if let Some(p) = self.live.peers.read().unwrap().get(id.as_str()) {
                p.view.send_replace(None);
                p.close(1012, "Reload room state");
            }
        }
    }
    async fn initialize(&mut self, input: Init) -> Result<InitOutcome> {
        self.load().await?;
        if self.doc.is_some() {
            return Ok(InitOutcome::Exists);
        }
        let Some(doc) = empty_room(&self.code, input) else {
            return Ok(InitOutcome::InvalidCreator);
        };
        let player_id = doc.members[0].id.clone();
        let response = InitOutcome::Created {
            host_token: doc.meta.host_token.clone(),
            player_token: doc
                .sessions
                .get(&player_id)
                .expect("creator session")
                .clone(),
            player_id,
        };
        let mut draft = Draft::new(Some(doc), self.bindings.clone(), now_ms());
        draft.reconcile();
        self.install(draft).await?;
        Ok(response)
    }
    async fn transition(&mut self, operation: Operation) -> Result<Ack> {
        self.load().await?;
        let mut weights = BTreeMap::new();
        let mut cards = false;
        if let Operation::Command(id, command) = &operation {
            if command.needs_weights() {
                let accounts = self
                    .doc
                    .as_ref()
                    .map(|d| d.accounts.values().map(|a| a.0.clone()).collect::<Vec<_>>())
                    .unwrap_or_default();
                match self.db.get_role_weights(&accounts).await {
                    Ok(w) => weights = serde_json::from_value(w)?,
                    Err(error) => tracing::warn!(%error,"role weights unavailable"),
                }
            }
            if command.uses_card()
                && let Some(binding) = self.bindings.get(id)
            {
                let value = self.db.get_cards(&binding.account, None).await?;
                #[derive(Deserialize)]
                struct CardBalance {
                    cards: u32,
                }
                cards = serde_json::from_value::<CardBalance>(value)?.cards > 0;
            }
        }
        let prior = self.doc.clone();
        let bindings = self.bindings.clone();
        let recovering = self.recovering;
        let (draft, result) = self
            .cpu
            .run(move || {
                let mut draft = Draft::new(prior.as_deref().cloned(), bindings, now_ms());
                draft.weights = weights;
                draft.cards = cards;
                if recovering && let Some(doc) = draft.doc.as_mut() {
                    doc.normalize_after_load();
                }
                let shutdown = matches!(operation, Operation::Shutdown);
                if !shutdown {
                    draft.reconcile();
                }
                let result = match operation {
                    Operation::Maintain => {
                        draft.bots();
                        Ack::ok()
                    }
                    Operation::Disconnect(id) => {
                        draft.disconnect(&id);
                        Ack::ok()
                    }
                    Operation::Shutdown => {
                        draft.bindings.clear();
                        if let Some(doc) = draft.doc.as_mut() {
                            for member in &mut doc.members {
                                if !member.bot() {
                                    member.connected = false;
                                }
                            }
                        }
                        Ack::ok()
                    }
                    Operation::Command(id, command) => draft.dispatch(&id, &command),
                };
                if !shutdown {
                    draft.reconcile();
                }
                (draft, result)
            })
            .await?;
        self.install(draft).await?;
        Ok(result)
    }
    async fn install(&mut self, mut draft: Draft) -> Result<()> {
        if let Some(error) = draft.fatal.take() {
            anyhow::bail!("Room transition failed: {error}");
        }
        let next = draft.doc.map(Arc::new);
        let stored = if let Some(doc) = next.clone() {
            Some(Arc::new(
                self.cpu.run(move || serde_json::to_value(&*doc)).await??,
            ))
        } else {
            None
        };
        if let Some(doc) = &stored {
            // Storage computes structural changes/hashes on its bounded CPU pool.
            self.version = self
                .db
                .save_room_shared(
                    &self.code,
                    self.version,
                    doc.clone(),
                    self.stored_doc.clone(),
                    draft.spend.as_ref().map(AccountId::as_str),
                )
                .await?;
        } else if self.doc.is_some() {
            if let Some(task) = self.checkpoint.take() {
                task.await??;
            }
            self.db.delete_room(&self.code, self.version).await?;
            self.version = 0;
        }
        let retired_document = std::mem::replace(&mut self.doc, next);
        let retired_stored = std::mem::replace(&mut self.stored_doc, stored);
        self.cpu
            .run(move || {
                drop(retired_document);
                drop(retired_stored);
            })
            .await?;
        self.bindings = draft.bindings;
        self.recovering = false;
        self.live.latencies.lock().unwrap().retain(|pid, _| {
            self.bindings
                .values()
                .any(|b| !b.retired && b.player.as_ref().is_some_and(|p| p.as_ref() == pid))
        });
        for notice in draft.notices {
            if let Some(p) = self
                .live
                .peers
                .read()
                .unwrap()
                .get(notice.connection.as_str())
            {
                p.json(json!({"t":"push","event":"system:notice","payload":{"type":notice.kind}}));
            }
        }
        for id in draft.retire {
            if let Some(p) = self.live.peers.read().unwrap().get(id.as_str()) {
                p.view.send_replace(None);
                p.send_even_retired(Message::Close(Some(CloseFrame {
                    code: 4001,
                    reason: "Room session ended".into(),
                })));
                p.retired.store(true, Ordering::Release);
            }
        }
        if draft.dirty {
            self.publish(draft.force).await?;
        }
        if let Some(task) = &self.checkpoint
            && task.is_finished()
        {
            let result = self.checkpoint.take().unwrap().await?;
            if let Err(error) = result {
                tracing::error!(%error,room=%self.code,"checkpoint retained journal");
                self.failed(&error);
                return Err(error);
            }
        }
        if self.checkpoint.is_none()
            && (self.version - self.checkpoint_version >= 32
                || now_ms() - self.checkpoint_at >= 60_000)
        {
            self.checkpoint_at = now_ms();
            if let Some(doc) = self.stored_doc.clone() {
                let db = self.db.clone();
                let code = self.code.clone();
                let version = self.version;
                self.checkpoint_version = version;
                self.checkpoint = Some(tokio::spawn(async move {
                    db.checkpoint_room_shared(&code, version, doc).await
                }));
            }
        }
        Ok(())
    }
    async fn publish(&mut self, force: BTreeSet<ConnectionId>) -> Result<()> {
        let Some(doc) = self.doc.clone() else {
            return Ok(());
        };
        let bindings = self.bindings.clone();
        let latencies = self.live.latencies.lock().unwrap().clone();
        let views = self
            .cpu
            .run(move || render_views(&doc, &bindings, &latencies, now_ms()))
            .await?;
        for (id, hash, view) in views {
            let peer = self.live.peers.read().unwrap().get(id.as_str()).cloned();
            let Some(peer) = peer else {
                continue;
            };
            if peer.retired.load(Ordering::Acquire) {
                continue;
            }
            let previous = peer.view.borrow().clone();
            let same = previous.as_ref().is_some_and(|p| p.hash == hash);
            let revision = if same {
                previous.as_ref().unwrap().revision
            } else {
                self.revision += 1;
                self.revision
            };
            let snapshot = Arc::new(ViewSnapshot {
                epoch: self.epoch.clone(),
                revision,
                hash,
                view,
                recovery: false,
            });
            let retired = peer.view.send_replace(Some(snapshot.clone()));
            self.cpu
                .run(move || {
                    drop(retired);
                    drop(previous);
                })
                .await?;
            if !same || force.contains(&id) {
                let encoded = self.cpu.run(move || encode_view(&snapshot)).await?;
                peer.send(encoded);
            }
        }
        Ok(())
    }
    async fn checkpoint_now(&mut self) -> Result<()> {
        if let Some(task) = self.checkpoint.take() {
            task.await??;
        }
        if let Some(doc) = &self.stored_doc {
            self.db
                .checkpoint_room_shared(&self.code, self.version, doc.clone())
                .await?;
        }
        Ok(())
    }
    fn deadline(&self) -> i64 {
        let Some(d) = &self.doc else {
            return now_ms() + 60_000;
        };
        let now = now_ms();
        let mut deadline = now + 60_000;
        if let Some(since) = d.meta.all_humans_offline_since {
            deadline = deadline.min(
                since
                    + if d.meta.status == RoomStatus::Lobby {
                        600_000
                    } else {
                        3_600_000
                    },
            );
        }
        if let Some(since) = d.meta.host_offline_since {
            let due = since + 300_000;
            let successor = self.bindings.values().any(|b| {
                !b.retired && b.player.is_some() && d.meta.host_account.as_ref() != Some(&b.account)
            });
            if due > now || d.meta.status == RoomStatus::Lobby || successor {
                deadline = deadline.min(due);
            }
        }
        if let Some(game) = &d.game {
            for timer in &game.action_timers {
                if timer.paused_at.is_none()
                    && d.member(&timer.player_id)
                        .is_some_and(|m| m.bot() && m.claimed)
                {
                    deadline = deadline.min(timer.started_at + 2000);
                }
            }
            if let Some(ballot) = game.early_assassination.as_ref().and_then(Option::as_ref)
                && ballot.voter_ids.iter().any(|pid| {
                    !ballot.votes.contains_key(pid)
                        && d.member(pid).is_some_and(|m| m.bot() && m.claimed)
                })
            {
                deadline = deadline.min(
                    game.logs
                        .iter()
                        .find(|l| l.seq == ballot.id)
                        .map_or(now, |l| l.at)
                        + 2000,
                );
            }
        }
        deadline
    }
}
enum Operation {
    Command(ConnectionId, Command),
    Disconnect(ConnectionId),
    Maintain,
    Shutdown,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSnapshot {
    pub code: String,
    pub name: String,
    pub visibility: Visibility,
    pub status: RoomStatus,
    pub config: RoomConfig,
    pub members: Vec<Member>,
    pub host_player_id: Option<PlayerId>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomView {
    pub room: Arc<RoomSnapshot>,
    pub game: Option<ClientGameState>,
    pub player_id: Option<PlayerId>,
    pub is_host: bool,
    pub is_referee: bool,
}

pub fn render_views(
    doc: &RoomDocument,
    bindings: &Bindings,
    latencies: &HashMap<String, i64>,
    now: i64,
) -> Vec<(ConnectionId, String, Arc<RoomView>)> {
    let mut config = doc.meta.config.clone();
    if doc.meta.status == RoomStatus::Lobby {
        resolve_config(&mut config, doc.active().filter(|m| m.claimed).count());
    }
    let mut members = doc.members.clone();
    members.sort_by_key(|m| (m.is_spectator, m.seat));
    for m in &mut members {
        m.latency = latencies.get(m.id.as_ref()).copied();
    }
    let host = bindings
        .values()
        .find(|b| !b.retired && b.host && b.player.is_some())
        .and_then(|b| b.player.clone());
    let room = Arc::new(RoomSnapshot {
        code: doc.meta.code.clone(),
        name: doc.meta.name.clone().unwrap_or_default(),
        visibility: doc.meta.visibility.unwrap_or_default(),
        status: doc.meta.status,
        config,
        members,
        host_player_id: host,
    });
    let viewers: Vec<PlayerId> = bindings
        .values()
        .filter(|b| !b.retired)
        .map(|b| b.player.clone().unwrap_or_else(|| "__spectator__".into()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let projected = doc
        .game
        .as_ref()
        .map(|game| typed::project_many(game, &viewers))
        .unwrap_or_default();
    let mut games: BTreeMap<PlayerId, ClientGameState> =
        viewers.into_iter().zip(projected).collect();
    for game in games.values_mut() {
        game.server_time = Some(now);
        game.game_id = doc.meta.game_id.clone();
        for player in &mut game.players {
            let member = room.members.iter().find(|m| m.id == player.id);
            player.claimed = Some(member.is_some_and(|m| m.claimed));
            player.connected = member.is_some_and(|m| m.claimed && m.connected);
            if let Some(member) = member {
                player.name = member.name.clone();
                player.avatar_url = member.avatar_url.clone();
                player.is_bot = member.is_bot;
                player.latency = member.latency;
            }
        }
    }
    type Key = (Option<PlayerId>, bool, bool);
    type Entry = (String, Arc<RoomView>);
    let mut cache: BTreeMap<Key, Entry> = BTreeMap::new();
    bindings
        .iter()
        .filter(|(_, b)| !b.retired)
        .map(|(id, b)| {
            let (hash, view) = cache
                .entry((b.player.clone(), b.host, b.referee))
                .or_insert_with(|| {
                    let view = RoomView {
                        room: room.clone(),
                        game: games
                            .get(b.player.as_ref().map_or("__spectator__", AsRef::as_ref))
                            .cloned(),
                        player_id: b.player.clone(),
                        is_host: b.host,
                        is_referee: b.referee,
                    };
                    let wire = serde_json::to_value(&view).expect("authorized view serialization");
                    let hash = crate::journal::view_hash(&wire);
                    (hash, Arc::new(view))
                });
            (id.clone(), hash.clone(), view.clone())
        })
        .collect()
}

fn remove(value: &mut Value, key: &str) {
    if let Some(object) = value.as_object_mut() {
        object.remove(key);
    }
}
pub fn view_content(view: &Value) -> Value {
    let mut v = view.clone();
    for m in v["room"]["members"].as_array_mut().into_iter().flatten() {
        remove(m, "latency");
    }
    if v["game"].is_object() {
        remove(&mut v["game"], "serverTime");
        for m in v["game"]["players"].as_array_mut().into_iter().flatten() {
            remove(m, "latency");
        }
    }
    v
}

#[derive(Deserialize)]
enum RequestKind {
    #[serde(rename = "req")]
    Request,
}
#[derive(Deserialize)]
struct Request {
    #[serde(rename = "t")]
    _kind: RequestKind,
    id: String,
    event: String,
    #[serde(default)]
    payload: Value,
}
pub fn router() -> Router<AppState> {
    Router::new().route("/rooms/{code}/ws", get(upgrade))
}
async fn upgrade(
    State(s): State<AppState>,
    Path(code): Path<String>,
    headers: HeaderMap,
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    let Ok(ws) = ws else {
        return (
            StatusCode::UPGRADE_REQUIRED,
            axum::Json(json!({"error":"Expected websocket"})),
        )
            .into_response();
    };
    if !valid_code(&code)
        || headers.get("origin").and_then(|v| v.to_str().ok()) != Some(&s.public_origin)
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let account = match s.auth.read_session(
        headers
            .get("cookie")
            .and_then(|v| v.to_str().ok())
            .unwrap_or(""),
    ) {
        Ok(Some(user)) => s.auth.account_key(&user),
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let handle = match s.rooms.get(&code).await {
        Ok(h) => h,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    ws.max_message_size(64 * 1024)
        .max_frame_size(64 * 1024)
        .max_write_buffer_size(MAX_BUFFERED)
        .on_upgrade(move |ws| connection(ws, handle, account))
}
async fn connection(ws: WebSocket, handle: Handle, account: String) {
    let (out, mut messages) = mpsc::channel(64);
    let (close, mut closing) = watch::channel(None);
    let (view, _) = watch::channel(None);
    let peer = Arc::new(Peer {
        id: uuid::Uuid::new_v4().to_string(),
        account,
        out,
        bytes: AtomicUsize::new(0),
        pending: AtomicUsize::new(0),
        retired: AtomicBool::new(false),
        close,
        view,
        emotes: Mutex::new(VecDeque::with_capacity(4)),
    });
    let (reply, answer) = oneshot::channel();
    if handle
        .tx
        .send(Work::Connect(peer.clone(), reply))
        .await
        .is_err()
        || !matches!(answer.await, Ok(Ok(())))
    {
        return;
    }
    let (mut writer, mut reader) = ws.split();
    let ended = CancellationToken::new();
    let writer_ended = ended.clone();
    let write_peer = peer.clone();
    let mut writing = tokio::spawn(async move {
        loop {
            tokio::select! {
                _=writer_ended.cancelled()=>break,
                _=closing.changed()=>{let close=closing.borrow().clone();if let Some((code,reason))=close{let _=tokio::time::timeout(Duration::from_secs(2),writer.send(Message::Close(Some(CloseFrame{code,reason:reason.into()})))).await;}break;},
                message=messages.recv()=>{let Some(message)=message else{break;};write_peer.bytes.fetch_sub(message_size(&message),Ordering::AcqRel);let closing=matches!(message,Message::Close(_));
                    if !matches!(tokio::time::timeout(Duration::from_secs(10),writer.send(message)).await,Ok(Ok(())))||closing{break;}}
            }
        }
        writer_ended.cancel();
    });
    let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    heartbeat.tick().await;
    let mut alive = true;
    loop {
        tokio::select! {
            _=ended.cancelled()=>break,
            _=heartbeat.tick()=>{if !alive{peer.close(1001,"Heartbeat timeout");break;}alive=false;peer.send(Message::Ping(bytes::Bytes::new()));},
            message=reader.next()=>{match message{
                Some(Ok(Message::Pong(_)))=>alive=true,
                Some(Ok(Message::Ping(payload)))=>peer.send(Message::Pong(payload)),
                Some(Ok(Message::Text(raw)))=>{let request=match serde_json::from_str::<Request>(&raw){Ok(r)if r.id.len()<=128=>r,_=>continue};
                    if peer.retired.load(Ordering::Acquire){break;}
                    handle.live.last_used.store(now_ms(),Ordering::Relaxed);
                    let command=match Command::decode(&request.event,request.payload){Ok(command)=>command,Err(error)=>{peer.ack(&request.id,Ack::from(error));continue;}};
                if fast(&handle,&peer,&request.id,&command).await{continue;}
                    if peer.pending.fetch_add(1,Ordering::AcqRel)>=CONNECTION_QUEUE{peer.pending.fetch_sub(1,Ordering::AcqRel);peer.close(1013,"Too many pending requests");break;}
                    let work=Work::Action{peer:peer.clone(),id:request.id,command};
                    if handle.tx.try_send(work).is_err(){peer.pending.fetch_sub(1,Ordering::AcqRel);peer.close(1013,"Room busy");break;}
                },Some(Ok(Message::Close(_)))|Some(Err(_))|None=>break,_=>{}
            }}
        }
    }
    // Flush a policy close (including overload) before cancelling the writer.
    // Cancelling both select branches immediately can reset the TCP connection
    // without delivering the WebSocket close code to the reconnecting client.
    if !peer.retired.load(Ordering::Acquire) {
        peer.close(1000, "Connection closed");
    }
    if tokio::time::timeout(Duration::from_secs(3), &mut writing)
        .await
        .is_err()
    {
        ended.cancel();
        writing.abort();
        let _ = writing.await;
    }
    peer.retired.store(true, Ordering::Release);
    ended.cancel();
    let _ = handle.tx.send(Work::Disconnect(peer.id.clone())).await;
}
fn message_size(message: &Message) -> usize {
    match message {
        Message::Text(s) => s.len(),
        Message::Binary(b) | Message::Ping(b) | Message::Pong(b) => b.len(),
        Message::Close(c) => c.as_ref().map_or(0, |c| c.reason.len() + 2),
    }
}
async fn fast(handle: &Handle, peer: &Arc<Peer>, request_id: &str, command: &Command) -> bool {
    if !matches!(
        command,
        Command::Ping { .. } | Command::Resync {} | Command::Emote { .. }
    ) {
        return false;
    }
    let snapshot = peer.view.borrow().clone();
    match command {
        Command::Ping { rtt } => {
            let sync = snapshot
                .as_ref()
                .map(|s| json!({"epoch":s.epoch,"revision":s.revision,"hash":s.hash}));
            peer.ack(request_id, json!({"ok":true,"data":{"sync":sync}}));
            if let Some(rtt) = rtt.filter(|n| n.is_finite())
                && let Some(pid) = snapshot.as_ref().and_then(|s| s.view.player_id.as_ref())
            {
                let ms = rtt.round().clamp(0., 9999.) as i64;
                let old = handle
                    .live
                    .latencies
                    .lock()
                    .unwrap()
                    .insert(pid.to_string(), ms);
                if old != Some(ms) {
                    let msg=Message::Text(json!({"t":"push","event":"net:latency","payload":{"playerId":pid,"latency":ms}}).to_string().into());
                    for p in handle.live.peers.read().unwrap().values() {
                        p.send(msg.clone());
                    }
                }
            }
        }
        Command::Resync {} => {
            if let Some(snapshot) = snapshot {
                let result = handle
                    .cpu
                    .run(move || {
                        let mut view = (*snapshot.view).clone();
                        if let Some(game) = &mut view.game {
                            game.server_time = Some(now_ms());
                        }
                        encode_view(&ViewSnapshot {
                            epoch: snapshot.epoch.clone(),
                            revision: snapshot.revision,
                            hash: snapshot.hash.clone(),
                            view: Arc::new(view),
                            recovery: true,
                        })
                    })
                    .await;
                match result {
                    Ok(msg) => {
                        peer.send(msg);
                        peer.ack(request_id, Ack::ok());
                    }
                    Err(_) => peer.ack(
                        request_id,
                        Ack::fail(RoomErrorCode::Internal, "View unavailable"),
                    ),
                }
            } else {
                peer.ack(
                    request_id,
                    Ack::fail(RoomErrorCode::NotJoined, "Join the room first"),
                );
            }
        }
        Command::Emote { emote } => {
            let Some(view) = snapshot.as_ref().map(|s| &s.view) else {
                peer.ack(
                    request_id,
                    Ack::fail(RoomErrorCode::NotInRoom, "Join the room first"),
                );
                return true;
            };
            let Some(pid) = view
                .player_id
                .as_ref()
                .filter(|_| view.game.as_ref().is_some_and(|g| !g.is_spectator))
            else {
                peer.ack(
                    request_id,
                    Ack::fail(RoomErrorCode::NotSeated, "Only seated players can react"),
                );
                return true;
            };
            let now = now_ms();
            let allowed = {
                let mut recent = peer.emotes.lock().unwrap();
                while recent.front().is_some_and(|t| now - t >= 6000) {
                    recent.pop_front();
                }
                if recent.len() >= 4 || recent.back().is_some_and(|t| now - t < 700) {
                    false
                } else {
                    recent.push_back(now);
                    true
                }
            };
            if allowed {
                let msg=Message::Text(json!({"t":"push","event":"table:emote","payload":{"playerId":pid,"emote":emote}}).to_string().into());
                for p in handle.live.peers.read().unwrap().values() {
                    if p.view.borrow().is_some() {
                        p.send(msg.clone());
                    }
                }
                peer.ack(request_id, Ack::ok());
            } else {
                peer.ack(
                    request_id,
                    Ack::fail(RoomErrorCode::RateLimited, "Too many reactions"),
                );
            }
        }
        _ => unreachable!(),
    }
    true
}
