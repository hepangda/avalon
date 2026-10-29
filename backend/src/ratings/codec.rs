//! JSON compatibility at the archive/HTTP/test boundary; fitting is typed.
use super::{ArchivedPlayer, Exclusion, Fit, Player, Record};
use anyhow::Result;
use serde::Deserialize;
use serde_json::Value;

pub fn fit(input: &[Value], include_bots: bool) -> Result<Fit> {
    let records: Vec<Record> = input
        .iter()
        .map(Record::deserialize)
        .collect::<std::result::Result<_, _>>()?;
    super::fit_records(records.iter(), include_bots)
}
pub fn exclusion(game: &Value, include_bots: bool) -> Option<&'static str> {
    match Record::deserialize(game) {
        Ok(record) => record.exclusion(include_bots).map(Exclusion::as_str),
        Err(_) => Some("invalid"),
    }
}
pub fn public(player: Option<&Player>, now: i64) -> Value {
    serde_json::to_value(super::public_rating(player, now)).expect("finite public rating")
}
pub fn visible(replay: &Value, include_bots: bool) -> bool {
    #[derive(Deserialize)]
    struct Visibility {
        #[serde(default)]
        players: Vec<ArchivedPlayer>,
    }
    include_bots
        || Visibility::deserialize(replay)
            .is_ok_and(|r| !r.players.iter().any(|p| p.is_bot == Some(true)))
}
