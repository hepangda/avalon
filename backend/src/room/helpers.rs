use super::{
    model::*,
    protocol::{ConfigInput, Init},
};
use crate::engine::typed::GameOptions;
use rand::Rng;
use std::collections::BTreeMap;

pub fn token(length: usize) -> String {
    const CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}
pub fn id() -> String {
    token(16)
}
pub fn sanitize_name(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(10)
        .collect()
}
pub fn fallback(seat: usize) -> String {
    format!("Player {}", seat + 1)
}
pub fn sanitize_avatar(raw: Option<&str>) -> Option<String> {
    let s = raw?;
    if s.len() > 2048 {
        return None;
    }
    let u = url::Url::parse(s).ok()?;
    matches!(u.scheme(), "http" | "https").then(|| u.to_string())
}
pub fn make_config(raw: &ConfigInput, roster: Vec<String>, initial: bool) -> RoomConfig {
    let defaults = super::protocol::InputOptions::default();
    let o = raw.options.as_ref().unwrap_or(&defaults);
    let paired = o.morgana.unwrap_or(initial) || o.percival.unwrap_or(initial);
    let options = GameOptions {
        oberon: o.oberon.unwrap_or(false),
        mordred: o.mordred.unwrap_or(false),
        morgana: paired,
        percival: paired,
        lady_of_the_lake: o.lady_of_the_lake.unwrap_or(false),
        max_rejections: Some(
            o.max_rejections
                .filter(|n| n.is_finite())
                .unwrap_or(5.)
                .floor()
                .clamp(1., 5.),
        ),
        speech_seconds: Some(
            o.speech_seconds
                .filter(|n| n.is_finite())
                .unwrap_or(120.)
                .floor()
                .clamp(30., 600.),
        ),
    };
    RoomConfig {
        use_recommended: Some(raw.use_recommended.unwrap_or(initial)),
        max_players: raw
            .max_players
            .filter(|n| n.is_finite())
            .unwrap_or(10.)
            .floor()
            .clamp(5., 10.) as usize,
        allow_spectators: true,
        allow_mid_join: true,
        options,
        roster,
    }
}
pub fn resolve_config(config: &mut RoomConfig, count: usize) {
    if config.use_recommended != Some(true) {
        return;
    }
    let n = count.clamp(5, 10);
    config.options = GameOptions {
        morgana: true,
        percival: true,
        oberon: n == 7 || n == 10,
        mordred: n >= 9,
        lady_of_the_lake: n >= 9,
        max_rejections: Some(5.),
        speech_seconds: Some(120.),
    };
}
pub fn empty_room(code: &str, input: Init) -> Option<RoomDocument> {
    let creator_name = sanitize_name(&input.creator.name);
    if creator_name.is_empty() {
        return None;
    }
    let mut roster: Vec<String> = input
        .roster
        .iter()
        .take(10)
        .enumerate()
        .map(|(i, n)| {
            let s = sanitize_name(n);
            if s.is_empty() { fallback(i) } else { s }
        })
        .collect();
    if roster.is_empty() {
        roster.push(fallback(0));
    }
    let mut members: Vec<Member> = roster
        .iter()
        .enumerate()
        .map(|(seat, name)| Member {
            id: id().into(),
            name: name.clone(),
            seat,
            is_spectator: false,
            claimed: false,
            connected: false,
            is_bot: None,
            avatar_url: None,
            latency: None,
        })
        .collect();
    members[0].name = creator_name;
    members[0].claimed = true;
    members[0].avatar_url = sanitize_avatar(input.creator.avatar_url.as_deref());
    let pid = members[0].id.clone();
    let mut sessions = BTreeMap::new();
    sessions.insert(pid.clone(), token(32));
    let mut accounts = BTreeMap::new();
    accounts.insert(pid, input.creator.account.clone());
    Some(RoomDocument {
        schema_version: 1,
        randomness_version: Some(RandomnessVersion::ResolvedV1),
        meta: RoomMeta {
            code: code.into(),
            name: Some(String::new()),
            visibility: Some(Visibility::Private),
            host_token: id(),
            host_account: Some(input.creator.account),
            status: RoomStatus::Lobby,
            config: make_config(&input.config.unwrap_or_default(), roster, true),
            game_id: None,
            seed: None,
            host_offline_since: None,
            all_humans_offline_since: None,
        },
        members,
        game: None,
        event_seq: 0,
        events: vec![],
        sessions,
        notes: BTreeMap::new(),
        accounts,
        game_accounts: BTreeMap::new(),
        last_game_seats: Some(SeatHistory::default()),
        archive: None,
    })
}
