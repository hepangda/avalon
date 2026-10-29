//! Authoritative room operations over typed state. No JSON tree manipulation.
pub use super::model::Binding;
use super::{helpers::*, model::*, protocol::*};
use crate::engine::typed::{
    self, CheckpointKind, CreateGame, Effect, GameEvent, InitialPlayer, LogChannel, LogEntry,
    LogParams, LogStyle, Phase, PlayerId, RoleWeights, Vote,
};
use crate::replay::{RecordedEvent, ReplayPlayer};
use std::collections::{BTreeMap, BTreeSet};

pub struct Draft {
    pub fatal: Option<anyhow::Error>,
    pub doc: Option<RoomDocument>,
    pub bindings: Bindings,
    pub notices: Vec<Notice>,
    pub retire: BTreeSet<ConnectionId>,
    pub dirty: bool,
    pub force: BTreeSet<ConnectionId>,
    pub spend: Option<AccountId>,
    pub host_departed: bool,
    pub weights: BTreeMap<AccountId, RoleWeights>,
    pub cards: bool,
    pub now: i64,
}
impl Draft {
    pub fn new(doc: Option<RoomDocument>, bindings: Bindings, now: i64) -> Self {
        Self {
            fatal: None,
            doc,
            bindings,
            notices: vec![],
            retire: BTreeSet::new(),
            dirty: false,
            force: BTreeSet::new(),
            spend: None,
            host_departed: false,
            weights: BTreeMap::new(),
            cards: false,
            now,
        }
    }
    fn d(&self) -> &RoomDocument {
        self.doc.as_ref().expect("room exists after command guard")
    }
    fn dm(&mut self) -> &mut RoomDocument {
        self.doc.as_mut().expect("room exists after command guard")
    }
    fn holder(&self, pid: &PlayerId) -> Option<ConnectionId> {
        self.bindings
            .iter()
            .find(|(_, b)| !b.retired && b.player.as_ref() == Some(pid))
            .map(|(id, _)| id.clone())
    }
    fn notice(&mut self, id: ConnectionId, kind: NoticeKind) {
        self.notices.push(Notice {
            connection: id,
            kind,
        });
    }
    fn actor_name(&self, id: &ConnectionId) -> String {
        self.bindings
            .get(id)
            .and_then(|b| b.player.as_ref())
            .and_then(|pid| self.d().member(pid))
            .map(|m| m.name.clone())
            .unwrap_or_else(|| "__admin_someone__".into())
    }
    fn log(&mut self, key: &str, params: LogParams) {
        let now = self.now;
        if let Some(game) = self.dm().game.as_mut() {
            game.log_seq += 1;
            game.logs.push(LogEntry {
                seq: game.log_seq,
                at: now,
                round_index: game.round_index,
                channel: LogChannel::Public,
                key: key.into(),
                params: Some(params),
                audience: None,
                style: Some(LogStyle::Admin),
            });
            self.dirty = true;
        }
    }
    fn release(&mut self, pid: &PlayerId) {
        let d = self.dm();
        d.accounts.remove(pid);
        d.game_accounts.remove(pid);
        d.sessions.remove(pid);
        if let Some(index) = d.members.iter().position(|m| m.id == *pid) {
            let seat = d.members[index].seat;
            let n = d
                .meta
                .config
                .roster
                .get(seat)
                .map(|s| sanitize_name(s))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| fallback(seat));
            let m = &mut d.members[index];
            m.name = n;
            m.avatar_url = None;
            m.is_bot = None;
            m.claimed = false;
            m.connected = false;
            m.latency = None;
        }
        if let Some(holder) = self.holder(pid) {
            self.bindings.get_mut(&holder).expect("holder").player = None;
        }
        self.dirty = true;
    }
    pub fn apply(&mut self, mut event: GameEvent) -> Ack {
        let Some(game) = self.doc.as_ref().and_then(|d| d.game.as_ref()) else {
            return Ack::fail(RoomErrorCode::NoGame, "No game in progress");
        };
        let seq = self.d().event_seq + 1;
        let seed = self.d().meta.seed.clone().unwrap_or_default();
        let prior_revision = game.role_revision;
        let excluded = if let GameEvent::UseRerollCard { by, .. } = &event {
            game.players
                .iter()
                .find(|p| p.id == *by)
                .map(|p| (p.id.clone(), p.role))
        } else {
            None
        };
        if matches!(
            event,
            GameEvent::StartGame { .. }
                | GameEvent::RerollRoles { .. }
                | GameEvent::UseRerollCard { .. }
        ) {
            let weights: BTreeMap<_, _> = game
                .players
                .iter()
                .filter_map(|p| {
                    self.d()
                        .accounts
                        .get(&p.id)
                        .and_then(|a| self.weights.get(a))
                        .map(|w| (p.id.clone(), w.clone()))
                })
                .collect();
            if let Some(roles) = typed::weighted_roles(
                &game.players,
                &game.config.roles,
                &weights,
                &format!("{seed}:{seq}:roles"),
                excluded.as_ref().map(|(p, r)| (p, *r)),
            ) {
                match &mut event {
                    GameEvent::StartGame { assigned_roles, .. }
                    | GameEvent::RerollRoles { assigned_roles, .. }
                    | GameEvent::UseRerollCard { assigned_roles, .. } => {
                        *assigned_roles = Some(roles)
                    }
                    _ => unreachable!(),
                }
            }
        }
        event = match typed::resolve_randomness(game, &event, &format!("{seed}:{seq}:outcome")) {
            Ok(event) => event,
            Err(e) => return Ack::engine(e),
        };
        let game = self.dm().game.take().expect("game checked");
        let transition = match typed::apply_owned(game, &event, self.now) {
            Ok(t) => t,
            Err((error, original)) => {
                self.dm().game = Some(original);
                return Ack::engine(error);
            }
        };
        let rewound = matches!(event, GameEvent::PreviousPhase { .. });
        let now = self.now;
        let d = self.dm();
        if transition.state.role_revision != prior_revision {
            d.notes.clear();
        }
        d.game = Some(transition.state);
        d.event_seq = seq;
        d.events.push(RecordedEvent {
            seq,
            event,
            created_at: now,
        });
        for effect in transition.effects {
            match effect {
                Effect::PersistCheckpoint {
                    checkpoint: CheckpointKind::GameStarted,
                } => self.dm().meta.status = RoomStatus::InGame,
                Effect::PersistCheckpoint {
                    checkpoint: CheckpointKind::GameOver,
                } => {
                    self.dm().meta.status = RoomStatus::Finished;
                    if let Err(error) = self.archive() {
                        let message = error.to_string();
                        self.fatal = Some(error);
                        return Ack::fail(RoomErrorCode::Internal, message);
                    }
                }
                _ => {}
            }
        }
        if rewound {
            self.dm().meta.status = RoomStatus::InGame;
        }
        self.dirty = true;
        Ack::ok()
    }
    fn archive(&mut self) -> anyhow::Result<()> {
        let d = self.d();
        let players: Vec<_> = d
            .active()
            .map(|m| ReplayPlayer {
                id: m.id.clone(),
                name: m.name.clone(),
                seat: None,
                avatar_url: m.avatar_url.clone(),
                is_bot: m.is_bot,
            })
            .collect();
        let replay = crate::replay::build(
            d.meta
                .game_id
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("Missing game id"))?,
            d.meta
                .seed
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("Missing game seed"))?,
            &d.meta.config.options,
            &players,
            &d.events,
        )?;
        let altered = d.events.iter().any(|e| intervened(&e.event));
        let rewards = d
            .game_accounts
            .values()
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let assignments = d
            .game
            .as_ref()
            .expect("completed game")
            .players
            .iter()
            .filter(|p| d.member(&p.id).is_some_and(|m| m.claimed))
            .filter_map(|p| d.accounts.get(&p.id).map(|a| (a.clone(), p.role)))
            .collect();
        self.dm().archive = Some(Archive {
            replay,
            seats: Some(d.game_accounts.clone()),
            altered: Some(altered),
            revision: d.event_seq,
            reward_accounts: Some(rewards),
            role_weight_assignments: Some(assignments),
        });
        Ok(())
    }
    pub fn reconcile(&mut self) {
        let Some(d) = self.doc.as_ref() else { return };
        let status = d.meta.status;
        let now = self.now;
        let humans: Vec<_> = d
            .members
            .iter()
            .filter(|m| m.human())
            .map(|m| m.id.clone())
            .collect();
        let online: Vec<_> = humans
            .iter()
            .filter_map(|pid| self.holder(pid).map(|id| (pid.clone(), id)))
            .collect();
        let host_online = self.bindings.values().any(|b| !b.retired && b.host);
        let departed = self.host_departed;
        let meta = &mut self.dm().meta;
        if online.is_empty() {
            meta.all_humans_offline_since.get_or_insert(now);
        } else {
            meta.all_humans_offline_since = None;
        }
        if host_online && !departed {
            meta.host_offline_since = None;
        } else {
            meta.host_offline_since.get_or_insert(now);
        }
        let timeout = if status == RoomStatus::Lobby {
            600_000
        } else {
            3_600_000
        };
        let expired = meta
            .all_humans_offline_since
            .is_some_and(|t| now - t >= timeout);
        if (status == RoomStatus::Lobby && humans.is_empty()) || expired {
            self.dissolve();
            return;
        }
        if departed || meta.host_offline_since.is_some_and(|t| now - t >= 300_000) {
            let old = self.d().meta.host_account.clone();
            if let Some((pid, id)) = online
                .iter()
                .find(|(_, id)| Some(&self.bindings[id].account) != old.as_ref())
            {
                self.transfer(pid, id);
            } else if departed || status == RoomStatus::Lobby {
                self.dissolve();
            }
        }
    }
    fn dissolve(&mut self) {
        self.doc = None;
        self.dirty = false;
        let ids: Vec<_> = self.bindings.keys().cloned().collect();
        for id in ids {
            let b = self.bindings.get_mut(&id).unwrap();
            b.player = None;
            b.host = false;
            b.referee = false;
            b.retired = true;
            self.notice(id.clone(), NoticeKind::RoomDissolved);
            self.retire.insert(id);
        }
    }
    fn transfer(&mut self, pid: &PlayerId, id: &ConnectionId) {
        let account = self.bindings[id].account.clone();
        let d = self.dm();
        d.meta.host_account = Some(account.clone());
        d.meta.host_token = token(32);
        d.meta.host_offline_since = None;
        d.accounts.insert(pid.clone(), account.clone());
        for b in self.bindings.values_mut() {
            b.host = !b.retired && b.account == account;
        }
        self.dirty = true;
    }
    pub fn dispatch(&mut self, id: &ConnectionId, command: &Command) -> Ack {
        let Some(binding) = self.bindings.get(id).cloned() else {
            return Ack::fail(RoomErrorCode::AuthRequired, "Sign in to enter a room");
        };
        if binding.retired {
            return Ack::fail(RoomErrorCode::Reconnect, "Reconnect to reload room state");
        }
        if self.doc.is_none() {
            return Ack::fail(RoomErrorCode::RoomNotFound, "Room not found");
        }
        if command.needs_host() && !binding.host {
            return Ack::fail(RoomErrorCode::NotHost, "Only host");
        }
        if command.lobby_only() && self.d().meta.status != RoomStatus::Lobby {
            return Ack::fail(RoomErrorCode::WrongPhase, "Game already started");
        }
        if command.needs_referee() && !binding.referee {
            return Ack::fail(RoomErrorCode::NotAdmin, "Referee panel not enabled");
        }
        match command {
            Command::Join {
                player_id,
                player_token,
                host_token,
            } => self.join(
                id,
                player_id.as_ref(),
                player_token.as_deref(),
                host_token.as_deref(),
            ),
            Command::ClaimSeat {
                seat_id,
                name,
                avatar_url,
            } => self.claim(id, seat_id.as_ref(), name.as_deref(), avatar_url.as_deref()),
            Command::ReleaseSeat {} | Command::Leave {} => {
                if let Some(pid) = binding.player {
                    self.release(&pid);
                    if self.d().game.is_some() {
                        self.apply(GameEvent::SetConnected {
                            by: pid,
                            connected: false,
                        });
                    }
                }
                if matches!(command, Command::Leave {}) && binding.host {
                    self.host_departed = true;
                    self.bindings.get_mut(id).unwrap().host = false;
                }
                self.dirty = true;
                Ack::ok()
            }
            Command::Rename { name } => {
                let Some(pid) = binding.player else {
                    return Ack::fail(RoomErrorCode::NotInRoom, "No player id");
                };
                let name = sanitize_name(name);
                if name.is_empty() {
                    return Ack::fail(RoomErrorCode::InvalidName, "Name cannot be empty");
                }
                if self.name_taken(&name, Some(&pid), None, false) {
                    return Ack::fail(
                        RoomErrorCode::NameTaken,
                        "That name is already taken in this room",
                    );
                }
                let Some(m) = self.dm().member_mut(&pid) else {
                    return Ack::fail(RoomErrorCode::UnknownPlayer, "No such player");
                };
                m.name = name.clone();
                self.dirty = true;
                Ack::data(Reply::Name { name })
            }
            Command::AddBot {} => self.add_bot(),
            Command::SetRoster { names } => self.roster(names),
            Command::RemoveSeat { seat_id } => self.remove_seat(seat_id),
            Command::Config { config } => {
                let mut c = make_config(config, self.d().meta.config.roster.clone(), false);
                resolve_config(&mut c, self.d().active().filter(|m| m.claimed).count());
                self.dm().meta.config = c;
                self.dirty = true;
                Ack::ok()
            }
            Command::Details { name, visibility } => {
                let trimmed = name.trim();
                if trimmed.encode_utf16().count() > 40
                    || name.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
                {
                    return Ack::fail(RoomErrorCode::Invalid, "Invalid room name or visibility");
                }
                let meta = &mut self.dm().meta;
                meta.name = Some(trimmed.into());
                meta.visibility = Some(*visibility);
                self.dirty = true;
                Ack::ok()
            }
            Command::TransferHost { target_player_id } => {
                let Some(next) = self.holder(target_player_id) else {
                    return Ack::fail(
                        RoomErrorCode::InvalidTarget,
                        "Choose another online human player",
                    );
                };
                if self.bindings[&next].account == binding.account
                    || self.d().member(target_player_id).is_none_or(|m| !m.human())
                {
                    return Ack::fail(
                        RoomErrorCode::InvalidTarget,
                        "Choose another online human player",
                    );
                }
                self.transfer(target_player_id, &next);
                Ack::ok()
            }
            Command::Kick { target_player_id } | Command::AdminUnbind { target_player_id } => {
                let Some(member) = self
                    .d()
                    .member(target_player_id)
                    .filter(|m| !matches!(command, Command::AdminUnbind { .. }) || !m.is_spectator)
                else {
                    return Ack::fail(RoomErrorCode::UnknownPlayer, "No such seat");
                };
                let target_name = member.name.clone();
                let holder = self.holder(target_player_id);
                self.release(target_player_id);
                if let Some(holder) = holder {
                    self.notice(
                        holder,
                        if matches!(command, Command::Kick { .. }) {
                            NoticeKind::Kicked
                        } else {
                            NoticeKind::Unbound
                        },
                    );
                }
                if matches!(command, Command::AdminUnbind { .. }) {
                    if self.d().game.is_some() {
                        self.apply(GameEvent::SetConnected {
                            by: target_player_id.clone(),
                            connected: false,
                        });
                    }
                    self.log(
                        "admin.unbound",
                        params([("actor", self.actor_name(id)), ("target", target_name)]),
                    );
                }
                Ack::ok()
            }
            Command::Restart {} => {
                if self.d().meta.status != RoomStatus::Finished
                    || self
                        .d()
                        .game
                        .as_ref()
                        .is_none_or(|g| g.phase != Phase::GameOver)
                {
                    return Ack::fail(
                        RoomErrorCode::WrongPhase,
                        "The game must finish before returning to the lobby",
                    );
                }
                let d = self.dm();
                d.game = None;
                d.archive = None;
                d.events.clear();
                d.notes.clear();
                d.event_seq = 0;
                d.meta.status = RoomStatus::Lobby;
                d.meta.game_id = None;
                d.meta.seed = None;
                for b in self.bindings.values_mut() {
                    b.referee = false;
                }
                self.dirty = true;
                Ack::ok()
            }
            Command::Start {} => self.start(),
            Command::Notes(request) => self.notes(id, request),
            Command::AdminAuth {} | Command::AdminClose {} => {
                let enable = matches!(command, Command::AdminAuth {});
                self.bindings.get_mut(id).unwrap().referee = enable;
                self.dirty = true;
                if enable {
                    Ack::data(Reply::Referee { ok: true })
                } else {
                    Ack::ok()
                }
            }
            Command::UseRerollCard { role_revision } => {
                let Some(pid) = binding.player else {
                    return Ack::fail(RoomErrorCode::NotInRoom, "Claim a seat first");
                };
                if self.d().accounts.get(&pid) != Some(&binding.account)
                    || self.d().member(&pid).is_none_or(|m| !m.claimed)
                {
                    return Ack::fail(RoomErrorCode::NotInRoom, "Claim a seat first");
                }
                if !self.cards {
                    return Ack::fail(RoomErrorCode::NoRerollCards, "No reroll cards remaining");
                }
                let result = self.apply(GameEvent::UseRerollCard {
                    by: pid,
                    role_revision: *role_revision,
                    assigned_roles: None,
                    role_variants: None,
                });
                if result.ok {
                    self.spend = Some(binding.account);
                }
                result
            }
            c if c.needs_referee() => self.admin(id, c),
            Command::AckRole { .. }
            | Command::ProposeTeam { .. }
            | Command::FinalizeTeam { .. }
            | Command::StartDiscussion { .. }
            | Command::EndSpeech {}
            | Command::Vote { .. }
            | Command::MissionCard { .. }
            | Command::UseLady { .. }
            | Command::StartAssassination {}
            | Command::VoteAssassination { .. }
            | Command::Assassinate { .. } => {
                let Some(pid) = binding.player else {
                    return Ack::fail(RoomErrorCode::NotInRoom, "No player id");
                };
                self.apply(player_event(command, pid).expect("player command"))
            }
            Command::Ping { .. } | Command::Resync {} | Command::Emote { .. } => Ack::fail(
                RoomErrorCode::Invalid,
                "Transient commands bypass the room queue",
            ),
            // Guard above handles these; explicit variants keep future additions visible.
            Command::AdminVote { .. }
            | Command::AdminPropose { .. }
            | Command::AdminRetractVotes {}
            | Command::AdminRetractProposal {}
            | Command::AdminStartAssassination {}
            | Command::AdminPreviousPhase {}
            | Command::AdminSkipSpeech { .. }
            | Command::AdminSetTimersPaused { .. }
            | Command::AdminRerollLeader {}
            | Command::AdminRerollRoles {} => unreachable!(),
        }
    }
    fn name_taken(
        &self,
        name: &str,
        except: Option<&PlayerId>,
        also: Option<&PlayerId>,
        claimed_only: bool,
    ) -> bool {
        self.d().members.iter().any(|m| {
            Some(&m.id) != except
                && Some(&m.id) != also
                && (!claimed_only || m.claimed)
                && m.name.to_lowercase() == name.to_lowercase()
        })
    }
    fn join(
        &mut self,
        id: &ConnectionId,
        player: Option<&PlayerId>,
        token: Option<&str>,
        host_token: Option<&str>,
    ) -> Ack {
        let account = self.bindings[id].account.clone();
        let owned = self
            .d()
            .members
            .iter()
            .find(|m| m.claimed && self.d().accounts.get(&m.id) == Some(&account))
            .map(|m| m.id.clone());
        let legacy = player
            .filter(|pid| {
                !self.d().accounts.contains_key(*pid)
                    && token.is_some()
                    && self.d().sessions.get(*pid).map(String::as_str) == token
            })
            .and_then(|pid| self.d().member(pid))
            .filter(|m| m.claimed)
            .map(|m| m.id.clone());
        let player = owned.or(legacy);
        let host = self
            .d()
            .meta
            .host_account
            .as_ref()
            .map(|a| a == &account)
            .unwrap_or_else(|| host_token.is_some_and(|t| t == self.d().meta.host_token));
        if host {
            self.dm().meta.host_account = Some(account.clone());
        }
        let retired: Vec<_> = self
            .bindings
            .iter()
            .filter(|(other, b)| {
                *other != id && (b.account == account || (player.is_some() && b.player == player))
            })
            .map(|(id, _)| id.clone())
            .collect();
        for other in retired {
            let b = self.bindings.get_mut(&other).unwrap();
            b.player = None;
            b.host = false;
            b.referee = false;
            b.retired = true;
            self.notice(other.clone(), NoticeKind::SessionReplaced);
            self.retire.insert(other);
        }
        let b = self.bindings.get_mut(id).unwrap();
        b.player = player.clone();
        b.host = host;
        self.force.insert(id.clone());
        self.dirty = true;
        let player_token = if let Some(pid) = &player {
            let token = self
                .d()
                .sessions
                .get(pid)
                .cloned()
                .unwrap_or_else(|| super::helpers::token(32));
            self.dm().sessions.insert(pid.clone(), token.clone());
            self.dm().member_mut(pid).unwrap().connected = true;
            self.bind_account(pid, &account);
            if self.d().game.is_some() {
                self.apply(GameEvent::SetConnected {
                    by: pid.clone(),
                    connected: true,
                });
            }
            Some(token)
        } else {
            None
        };
        Ack::data(Reply::Join {
            player_id: player,
            player_token,
            is_host: host,
        })
    }
    fn bind_account(&mut self, pid: &PlayerId, account: &AccountId) {
        let d = self.dm();
        if d.game_accounts.get(pid).is_some_and(|a| a != account) {
            d.game_accounts.remove(pid);
        }
        d.accounts.insert(pid.clone(), account.clone());
    }
    fn claim(
        &mut self,
        id: &ConnectionId,
        requested: Option<&PlayerId>,
        name: Option<&str>,
        avatar: Option<&str>,
    ) -> Ack {
        let binding = self.bindings[id].clone();
        let automatic = requested.is_none();
        let d = self.d();
        let count = d.active().count();
        let target = if automatic {
            binding
                .player
                .as_ref()
                .and_then(|p| d.member(p))
                .filter(|m| m.claimed)
                .or_else(|| d.active().find(|m| !m.claimed))
        } else {
            requested
                .and_then(|p| d.member(p))
                .filter(|m| !m.is_spectator)
        }
        .map(|m| m.id.clone());
        if target.is_none() && (!automatic || count >= 10) {
            return if automatic {
                Ack::fail(RoomErrorCode::RoomFull, "All 10 seats are taken")
            } else {
                Ack::fail(RoomErrorCode::UnknownSeat, "No such seat")
            };
        }
        let pid = target
            .clone()
            .unwrap_or_else(|| super::helpers::id().into());
        if target
            .as_ref()
            .and_then(|p| d.member(p))
            .is_some_and(|m| m.claimed)
            && self.holder(&pid).as_ref() != Some(id)
        {
            return Ack::fail(RoomErrorCode::SeatTaken, "That seat is already taken");
        }
        if d.active().any(|m| {
            m.claimed
                && m.id != pid
                && Some(&m.id) != binding.player.as_ref()
                && d.accounts.get(&m.id) == Some(&binding.account)
        }) {
            return Ack::fail(
                RoomErrorCode::AlreadySeated,
                "This account already has a seat in the room",
            );
        }
        let desired = name.map(sanitize_name).unwrap_or_default();
        if (automatic || name.is_some()) && desired.is_empty() {
            return Ack::fail(RoomErrorCode::InvalidName, "Name cannot be empty");
        }
        if !desired.is_empty()
            && self.name_taken(&desired, Some(&pid), binding.player.as_ref(), true)
        {
            return Ack::fail(
                RoomErrorCode::NameTaken,
                "That name is already taken in this room",
            );
        }
        if let Some(previous) = binding.player.filter(|p| p != &pid) {
            self.release(&previous);
        }
        if target.is_none() {
            let d = self.dm();
            d.members.insert(
                count,
                Member {
                    id: pid.clone(),
                    name: fallback(count),
                    seat: count,
                    is_spectator: false,
                    claimed: false,
                    connected: false,
                    is_bot: None,
                    avatar_url: None,
                    latency: None,
                },
            );
            d.meta.config.roster.push(fallback(count));
        }
        let token = self
            .d()
            .sessions
            .get(&pid)
            .cloned()
            .unwrap_or_else(|| super::helpers::token(32));
        let d = self.dm();
        d.sessions.insert(pid.clone(), token.clone());
        let member = d.member_mut(&pid).unwrap();
        if !desired.is_empty() {
            member.name = desired;
        }
        member.avatar_url = sanitize_avatar(avatar);
        member.claimed = true;
        member.connected = true;
        self.bindings.get_mut(id).unwrap().player = Some(pid.clone());
        self.bind_account(&pid, &binding.account);
        self.dirty = true;
        Ack::data(Reply::Seat {
            player_id: pid,
            player_token: token,
        })
    }
    fn add_bot(&mut self) -> Ack {
        let target = self.d().active().find(|m| !m.claimed).map(|m| m.id.clone());
        let count = self.d().active().count();
        if target.is_none() && count >= 10 {
            return Ack::fail(RoomErrorCode::RoomFull, "All 10 seats are taken");
        }
        let pid = target.clone().unwrap_or_else(|| id().into());
        let mut n = 1;
        while self.name_taken(&format!("Bot {n}"), Some(&pid), None, false) {
            n += 1;
        }
        if target.is_none() {
            let d = self.dm();
            d.members.insert(
                count,
                Member {
                    id: pid.clone(),
                    name: String::new(),
                    seat: count,
                    is_spectator: false,
                    claimed: false,
                    connected: false,
                    is_bot: None,
                    avatar_url: None,
                    latency: None,
                },
            );
            d.meta.config.roster.push(fallback(count));
        }
        let member = self.dm().member_mut(&pid).unwrap();
        member.name = format!("Bot {n}");
        member.is_bot = Some(true);
        member.claimed = true;
        member.connected = true;
        member.avatar_url = None;
        member.latency = None;
        self.dirty = true;
        Ack::ok()
    }
    fn roster(&mut self, names: &[String]) -> Ack {
        let desired: Vec<_> = names
            .iter()
            .take(10)
            .enumerate()
            .map(|(i, n)| {
                let n = sanitize_name(n);
                if n.is_empty() { fallback(i) } else { n }
            })
            .collect();
        let d = self.d();
        let mut seats: Vec<_> = d.active().cloned().collect();
        let spectators: Vec<_> = d
            .members
            .iter()
            .filter(|m| m.is_spectator)
            .cloned()
            .collect();
        if seats.iter().skip(desired.len()).any(|m| m.claimed) {
            return Ack::fail(RoomErrorCode::SeatClaimed, "Cannot remove a claimed seat");
        }
        let dropped: Vec<_> = seats
            .iter()
            .skip(desired.len())
            .map(|m| m.id.clone())
            .collect();
        for pid in dropped {
            self.dm().sessions.remove(&pid);
            self.dm().accounts.remove(&pid);
        }
        seats.truncate(desired.len());
        for (i, name) in desired.iter().enumerate() {
            if let Some(m) = seats.get_mut(i) {
                m.name = name.clone();
            } else {
                seats.push(Member {
                    id: id().into(),
                    name: name.clone(),
                    seat: i,
                    is_spectator: false,
                    claimed: false,
                    connected: false,
                    is_bot: None,
                    avatar_url: None,
                    latency: None,
                });
            }
        }
        seats.extend(spectators);
        let d = self.dm();
        d.members = seats;
        d.meta.config.roster = desired;
        self.dirty = true;
        Ack::ok()
    }
    fn remove_seat(&mut self, pid: &PlayerId) -> Ack {
        let Some(member) = self.d().member(pid).filter(|m| !m.is_spectator) else {
            return Ack::fail(RoomErrorCode::UnknownSeat, "No such seat");
        };
        if member.claimed {
            return Ack::fail(RoomErrorCode::SeatClaimed, "Cannot remove a claimed seat");
        }
        if self.d().active().count() <= 1 {
            return Ack::fail(RoomErrorCode::InvalidPlayerCount, "Keep at least one seat");
        }
        let seat = member.seat;
        if seat >= self.d().meta.config.roster.len() {
            return Ack::fail(RoomErrorCode::Invalid, "Invalid seat roster");
        }
        let d = self.dm();
        d.members.retain(|m| m.id != *pid);
        d.meta.config.roster.remove(seat);
        d.sessions.remove(pid);
        d.accounts.remove(pid);
        for (seat, m) in d.members.iter_mut().filter(|m| !m.is_spectator).enumerate() {
            m.seat = seat;
        }
        self.dirty = true;
        Ack::ok()
    }
    fn start(&mut self) -> Ack {
        if self.d().meta.status != RoomStatus::Lobby {
            return Ack::fail(RoomErrorCode::WrongPhase, "Already started");
        }
        let participants: Vec<_> = self.d().active().filter(|m| m.claimed).cloned().collect();
        let n = participants.len();
        if !(5..=10).contains(&n) {
            return Ack::fail(
                RoomErrorCode::InvalidPlayerCount,
                "Need 5–10 seated players to deal",
            );
        }
        let mut config = self.d().meta.config.clone();
        resolve_config(&mut config, n);
        let seed = format!("{}-{}-{}", self.d().meta.code, self.now, token(16));
        let previous: Vec<_> = participants
            .iter()
            .map(|m| {
                self.d()
                    .accounts
                    .get(&m.id)
                    .and_then(|a| {
                        self.d()
                            .last_game_seats
                            .as_ref()
                            .and_then(|h| h.by_account.get(a))
                    })
                    .or_else(|| {
                        self.d()
                            .last_game_seats
                            .as_ref()
                            .and_then(|h| h.by_player.get(&m.id))
                    })
                    .copied()
            })
            .collect();
        let order = super::seating::order(&previous, &format!("{seed}:seats"));
        let mut seated: Vec<_> = order.iter().map(|i| participants[*i].clone()).collect();
        let roster = seated
            .iter()
            .enumerate()
            .map(|(i, m)| {
                self.d()
                    .meta
                    .config
                    .roster
                    .get(m.seat)
                    .cloned()
                    .unwrap_or_else(|| fallback(i))
            })
            .collect();
        for (i, m) in seated.iter_mut().enumerate() {
            m.seat = i;
        }
        let by = seated[0].id.clone();
        let game = match typed::create_game(CreateGame {
            host_id: by.clone(),
            players: seated
                .iter()
                .map(|m| InitialPlayer {
                    id: m.id.clone(),
                    name: m.name.clone(),
                })
                .collect(),
            options: config.options.clone(),
            seed: seed.clone(),
        }) {
            Ok(game) => game,
            Err(error) => return Ack::engine(error),
        };
        let mut history = SeatHistory::default();
        let mut accounts = BTreeMap::new();
        let mut sessions = BTreeMap::new();
        for m in &seated {
            history.by_player.insert(m.id.clone(), m.seat);
            if let Some(account) = self.d().accounts.get(&m.id) {
                accounts.insert(m.id.clone(), account.clone());
                history.by_account.insert(account.clone(), m.seat);
            }
            if let Some(token) = self.d().sessions.get(&m.id) {
                sessions.insert(m.id.clone(), token.clone());
            }
        }
        let game_accounts = accounts.clone();
        for spectator in self.d().members.iter().filter(|m| m.is_spectator) {
            if let Some(a) = self.d().accounts.get(&spectator.id) {
                accounts.insert(spectator.id.clone(), a.clone());
            }
            if let Some(t) = self.d().sessions.get(&spectator.id) {
                sessions.insert(spectator.id.clone(), t.clone());
            }
            seated.push(spectator.clone());
        }
        config.roster = roster;
        let d = self.dm();
        d.meta.config = config;
        d.meta.game_id = Some(id());
        d.meta.seed = Some(seed);
        d.meta.status = RoomStatus::InGame;
        d.members = seated;
        d.game = Some(game);
        d.game_accounts = game_accounts;
        d.accounts = accounts;
        d.sessions = sessions;
        d.last_game_seats = Some(history);
        d.events.clear();
        d.event_seq = 0;
        d.notes.clear();
        self.apply(GameEvent::StartGame {
            by,
            flow_version: Some(5),
            await_role_acks: Some(true),
            assigned_roles: None,
            leader_index: None,
            role_variants: None,
            seat_order: None,
        })
    }
    fn notes(&mut self, id: &ConnectionId, p: &NotesRequest) -> Ack {
        let Some(pid) = self.bindings[id].player.clone() else {
            return Ack::fail(
                RoomErrorCode::NotSeated,
                "A current seat connection is required",
            );
        };
        if self.holder(&pid).as_ref() != Some(id)
            || self.d().member(&pid).is_none_or(|m| !m.claimed)
        {
            return Ack::fail(
                RoomErrorCode::NotSeated,
                "A current seat connection is required",
            );
        }
        let Some(game) = self.d().game.as_ref() else {
            return Ack::fail(RoomErrorCode::NoGame, "No game in progress");
        };
        let Some(gid) = self.d().meta.game_id.as_ref() else {
            return Ack::fail(RoomErrorCode::NoGame, "No game in progress");
        };
        let revision = game.role_revision;
        if p.player_id != pid || p.game_id != *gid || p.role_revision != revision {
            return Ack::fail(
                RoomErrorCode::StaleNotesScope,
                "The game, role assignment or seat has changed",
            );
        }
        let mut current = self
            .d()
            .notes
            .get(&pid)
            .filter(|n| n.game_id == *gid && n.role_revision == revision)
            .cloned()
            .unwrap_or_else(|| NotesDocument {
                game_id: gid.clone(),
                player_id: pid.clone(),
                role_revision: revision,
                revision: 0,
                notes: BTreeMap::new(),
                enabled: true,
            });
        let Some(update) = &p.update else {
            return Ack::data(Reply::Notes(current));
        };
        if update.notes.len() > game.players.len()
            || update
                .notes
                .keys()
                .any(|id| !game.players.iter().any(|p| p.id == *id))
        {
            return Ack::fail(RoomErrorCode::Invalid, "Invalid player or note");
        }
        if update.base_revision != current.revision {
            let mut ack = Ack::fail(
                RoomErrorCode::NotesConflict,
                "Notes changed; merge and retry",
            );
            ack.data = Some(Reply::Notes(current));
            return ack;
        }
        current.revision += 1;
        current.notes = update.notes.clone();
        current.enabled = update.enabled;
        self.dm().notes.insert(pid, current.clone());
        Ack::data(Reply::Notes(current))
    }
    fn admin(&mut self, id: &ConnectionId, command: &Command) -> Ack {
        let Some(game) = self.d().game.as_ref() else {
            return Ack::fail(RoomErrorCode::NoGame, "No game in progress");
        };
        let actor = self.actor_name(id);
        let mut after = None;
        let event = match command {
            Command::AdminVote {
                target_player_id,
                value,
            } => {
                let Some(m) = self
                    .d()
                    .member(target_player_id)
                    .filter(|m| !m.is_spectator)
                else {
                    return Ack::fail(RoomErrorCode::UnknownPlayer, "No such player");
                };
                after = Some((
                    "admin.votedFor",
                    params([
                        ("actor", actor.clone()),
                        ("target", m.name.clone()),
                        ("value", value.as_str().into()),
                    ]),
                ));
                GameEvent::CastVote {
                    by: target_player_id.clone(),
                    value: *value,
                    admin: Some(true),
                }
            }
            Command::AdminPropose { team } => {
                if !matches!(game.phase, Phase::TeamBuilding | Phase::TeamFinalizing) {
                    return Ack::fail(RoomErrorCode::WrongPhase, "Not choosing a team");
                }
                let Some(leader) = game.players.iter().find(|p| p.seat == game.leader_index) else {
                    return Ack::fail(RoomErrorCode::UnknownPlayer, "No current leader");
                };
                let leader_id = leader.id.clone();
                let leader_name = self
                    .d()
                    .member(&leader.id)
                    .map(|m| m.name.clone())
                    .unwrap_or_else(|| leader.id.to_string());
                after = Some((
                    "admin.proposedFor",
                    params([("actor", actor.clone()), ("leader", leader_name)]),
                ));
                if game.phase == Phase::TeamFinalizing {
                    GameEvent::FinalizeTeam {
                        by: leader_id,
                        team: team.clone(),
                        admin: Some(true),
                    }
                } else {
                    GameEvent::ProposeTeam {
                        by: leader_id,
                        team: team.clone(),
                        admin: Some(true),
                    }
                }
            }
            Command::AdminRetractVotes {} => {
                after = Some(("admin.votesRetracted", params([("actor", actor.clone())])));
                GameEvent::RetractVotes
            }
            Command::AdminRetractProposal {} => {
                after = Some((
                    "admin.proposalRetracted",
                    params([("actor", actor.clone())]),
                ));
                GameEvent::RetractProposal
            }
            Command::AdminStartAssassination {} => GameEvent::StartAssassination {
                by: game.assassin_id.clone().unwrap_or_default(),
                admin: Some(true),
                actor: Some(actor),
            },
            Command::AdminPreviousPhase {} => GameEvent::PreviousPhase { actor },
            Command::AdminSkipSpeech { target_player_id } => GameEvent::SkipSpeech {
                target: target_player_id.clone(),
                actor,
            },
            Command::AdminSetTimersPaused { paused } => GameEvent::SetTimersPaused {
                paused: *paused,
                actor,
            },
            Command::AdminRerollLeader {} => GameEvent::RerollLeader {
                actor,
                leader_index: None,
            },
            Command::AdminRerollRoles {} => GameEvent::RerollRoles {
                actor,
                assigned_roles: None,
                role_variants: None,
            },
            _ => return Ack::fail(RoomErrorCode::UnknownEvent, "Unknown referee command"),
        };
        let result = self.apply(event);
        if result.ok
            && let Some((key, params)) = after
        {
            self.log(key, params);
        }
        result
    }
    pub fn disconnect(&mut self, id: &ConnectionId) {
        let Some(binding) = self.bindings.remove(id) else {
            return;
        };
        if binding.retired || self.doc.is_none() {
            return;
        }
        if let Some(pid) = binding.player
            && self.holder(&pid).is_none()
        {
            if let Some(m) = self.dm().member_mut(&pid) {
                m.connected = false;
                m.latency = None;
            }
            if self.d().game.is_some() {
                self.apply(GameEvent::SetConnected {
                    by: pid,
                    connected: false,
                });
            }
            self.dirty = true;
        }
    }
    pub fn bots(&mut self) {
        let Some(game) = self.doc.as_ref().and_then(|d| d.game.as_ref()) else {
            return;
        };
        let ballot = game
            .early_assassination
            .as_ref()
            .and_then(Option::as_ref)
            .cloned();
        if let Some(ballot) = ballot {
            let at = game
                .logs
                .iter()
                .find(|l| l.seq == ballot.id)
                .map_or(0, |l| l.at);
            if at + 2000 <= self.now {
                for by in ballot.voter_ids {
                    let pending = self
                        .d()
                        .game
                        .as_ref()
                        .and_then(|g| g.early_assassination.as_ref())
                        .and_then(Option::as_ref)
                        .is_some_and(|b| !b.votes.contains_key(&by));
                    if pending && self.d().member(&by).is_some_and(|m| m.bot() && m.claimed) {
                        self.apply(GameEvent::VoteAssassination {
                            by,
                            proposal_id: ballot.id,
                            value: Vote::Approve,
                        });
                    }
                }
            }
        }
        let timers = self
            .d()
            .game
            .as_ref()
            .map(|g| g.action_timers.clone())
            .unwrap_or_default();
        for timer in timers {
            if timer.paused_at.is_some()
                || timer.started_at + 2000 > self.now
                || !self
                    .d()
                    .member(&timer.player_id)
                    .is_some_and(|m| m.bot() && m.claimed)
            {
                continue;
            }
            let Some(game) = self.d().game.as_ref() else {
                continue;
            };
            if !game.action_timers.iter().any(|t| {
                t.player_id == timer.player_id
                    && t.action == timer.action
                    && t.started_at == timer.started_at
            }) {
                continue;
            }
            let seed = format!(
                "{}:bot:{}:{}",
                self.d().meta.seed.as_deref().unwrap_or_default(),
                self.d().event_seq + 1,
                timer.player_id
            );
            let view = typed::project(game, &timer.player_id);
            match crate::bots::decide(&view, &timer.player_id, timer.action, &seed) {
                Ok(event) => {
                    self.apply(event);
                }
                Err(error) => tracing::error!(%error,"bot decision failed"),
            }
        }
    }
}
fn params<const N: usize>(values: [(&str, String); N]) -> LogParams {
    values
        .into_iter()
        .map(|(k, v)| (k.into(), v.into()))
        .collect()
}
fn intervened(e: &GameEvent) -> bool {
    matches!(
        e,
        GameEvent::PreviousPhase { .. }
            | GameEvent::RerollRoles { .. }
            | GameEvent::UseRerollCard { .. }
            | GameEvent::RetractVotes
            | GameEvent::RetractProposal
            | GameEvent::ProposeTeam {
                admin: Some(true),
                ..
            }
            | GameEvent::FinalizeTeam {
                admin: Some(true),
                ..
            }
            | GameEvent::CastVote {
                admin: Some(true),
                ..
            }
            | GameEvent::StartAssassination {
                admin: Some(true),
                ..
            }
    )
}
fn player_event(command: &Command, by: PlayerId) -> Option<GameEvent> {
    Some(match command {
        Command::AckRole { role_revision } => GameEvent::AckRole {
            by,
            role_revision: *role_revision,
        },
        Command::ProposeTeam { team } => GameEvent::ProposeTeam {
            by,
            team: team.clone(),
            admin: None,
        },
        Command::FinalizeTeam { team } => GameEvent::FinalizeTeam {
            by,
            team: team.clone(),
            admin: None,
        },
        Command::StartDiscussion { direction } => GameEvent::StartDiscussion {
            by,
            direction: *direction,
        },
        Command::EndSpeech {} => GameEvent::EndSpeech { by },
        Command::Vote { value } => GameEvent::CastVote {
            by,
            value: *value,
            admin: None,
        },
        Command::MissionCard { card } => GameEvent::CastMissionCard { by, card: *card },
        Command::UseLady { target_player_id } => GameEvent::UseLady {
            by,
            target: target_player_id.clone(),
        },
        Command::StartAssassination {} => GameEvent::RequestAssassination { by },
        Command::VoteAssassination { proposal_id, value } => GameEvent::VoteAssassination {
            by,
            proposal_id: *proposal_id,
            value: *value,
        },
        Command::Assassinate { target_player_id } => GameEvent::Assassinate {
            by,
            target: target_player_id.clone(),
        },
        _ => return None,
    })
}
