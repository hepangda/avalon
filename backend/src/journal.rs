//! Compatible replay and integrity checks for the existing PostgreSQL journal.
use anyhow::{Result, bail, ensure};
use serde_json::Value;
#[cfg(test)]
use serde_json::json;
use sha2::{Digest, Sha256};

// Context tracks only exact view paths; identically named nested fields still contribute.
#[derive(Clone, Copy)]
enum Context {
    Other,
    View,
    Room,
    RoomMembers,
    Member,
    Game,
    GamePlayers,
    Player,
}
impl Context {
    fn omits(self, key: &str) -> bool {
        matches!(
            (self, key),
            (Self::Member | Self::Player, "latency") | (Self::Game, "serverTime")
        )
    }
    fn field(self, key: &str) -> Self {
        match (self, key) {
            (Self::View, "room") => Self::Room,
            (Self::View, "game") => Self::Game,
            (Self::Room, "members") => Self::RoomMembers,
            (Self::Game, "players") => Self::GamePlayers,
            _ => Self::Other,
        }
    }
    fn item(self) -> Self {
        match self {
            Self::RoomMembers => Self::Member,
            Self::GamePlayers => Self::Player,
            _ => Self::Other,
        }
    }
}
fn write_canonical<W: std::io::Write>(
    value: &Value,
    out: &mut W,
    context: Context,
) -> std::io::Result<()> {
    match value {
        Value::Object(map) => {
            out.write_all(b"{")?;
            let mut keys: Vec<_> = map.keys().filter(|key| !context.omits(key)).collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.write_all(b",")?;
                }
                serde_json::to_writer(&mut *out, key).map_err(std::io::Error::other)?;
                out.write_all(b":")?;
                write_canonical(&map[key], out, context.field(key))?;
            }
            out.write_all(b"}")
        }
        Value::Array(array) => {
            out.write_all(b"[")?;
            for (i, value) in array.iter().enumerate() {
                if i > 0 {
                    out.write_all(b",")?;
                }
                write_canonical(value, out, context.item())?;
            }
            out.write_all(b"]")
        }
        Value::Number(number) => out.write_all(
            ryu_js::Buffer::new()
                .format(number.as_f64().expect("finite JSON number"))
                .as_bytes(),
        ),
        Value::String(value) => serde_json::to_writer(out, value).map_err(std::io::Error::other),
        Value::Bool(true) => out.write_all(b"true"),
        Value::Bool(false) => out.write_all(b"false"),
        Value::Null => out.write_all(b"null"),
    }
}
pub fn canonical_json(value: &Value) -> String {
    let mut bytes = Vec::new();
    write_canonical(value, &mut bytes, Context::Other).expect("memory writer");
    String::from_utf8(bytes).expect("JSON is UTF-8")
}
struct HashWriter(Sha256);
impl std::io::Write for HashWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn hash_with_context(value: &Value, context: Context) -> String {
    let mut writer = HashWriter(Sha256::new());
    write_canonical(value, &mut writer, context).expect("hash writer");
    hex::encode(writer.0.finalize())
}
/// Streams canonical tokens into SHA-256 without allocating a whole document string.
pub fn document_hash(value: &Value) -> String {
    hash_with_context(value, Context::Other)
}
/// Equivalent to browser viewContent: omit only transient latency and server clock fields.
pub fn view_hash(value: &Value) -> String {
    hash_with_context(value, Context::View)
}

/// Journal payloads are generic JSON, but operations and path components are
/// closed domain types. Unknown operations fail while decoding the boundary.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum PathKey {
    Field(String),
    Index(u64),
}
impl PathKey {
    fn validate(&self) -> Result<()> {
        match self {
            Self::Field(key) => ensure!(
                !matches!(key.as_str(), "__proto__" | "constructor" | "prototype"),
                "Unsafe journal path"
            ),
            Self::Index(index) => {
                checked_index(*index)?;
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Change {
    Set {
        path: Vec<PathKey>,
        value: Value,
    },
    Delete {
        path: Vec<PathKey>,
    },
    Splice {
        path: Vec<PathKey>,
        index: u64,
        remove: u64,
        items: Vec<Value>,
    },
}
impl Change {
    fn path(&self) -> &[PathKey] {
        match self {
            Self::Set { path, .. } | Self::Delete { path } | Self::Splice { path, .. } => path,
        }
    }
}
fn checked_index(index: u64) -> Result<usize> {
    ensure!(index <= 9_007_199_254_740_991, "Invalid journal index");
    usize::try_from(index).map_err(Into::into)
}
fn descend<'a>(mut value: &'a mut Value, path: &[PathKey]) -> Result<&'a mut Value> {
    for key in path {
        value = match (value, key) {
            (Value::Object(map), PathKey::Field(key)) => map.get_mut(key),
            (Value::Array(array), PathKey::Index(index)) => array.get_mut(checked_index(*index)?),
            _ => None,
        }
        .ok_or_else(|| anyhow::anyhow!("Missing journal path"))?;
    }
    Ok(value)
}
pub fn apply_changes(document: Value, changes: &Value) -> Result<Value> {
    use serde::Deserialize;
    apply_operations(document, Vec::<Change>::deserialize(changes)?)
}
pub fn apply_operations(
    mut document: Value,
    changes: impl IntoIterator<Item = Change>,
) -> Result<Value> {
    for change in changes {
        for key in change.path() {
            key.validate()?;
        }
        match change {
            Change::Set { path, value } if path.is_empty() => document = value,
            Change::Set { mut path, value } => {
                let key = path.pop().expect("nonempty set path");
                let parent = descend(&mut document, &path)?;
                match (parent, key) {
                    (Value::Object(map), PathKey::Field(key)) => {
                        map.insert(key, value);
                    }
                    (Value::Array(array), PathKey::Index(index)) => {
                        let slot = array
                            .get_mut(checked_index(index)?)
                            .ok_or_else(|| anyhow::anyhow!("Invalid array set"))?;
                        *slot = value;
                    }
                    _ => bail!("Invalid journal set"),
                }
            }
            Change::Delete { mut path } => {
                let key = path
                    .pop()
                    .ok_or_else(|| anyhow::anyhow!("Invalid journal root operation"))?;
                match (descend(&mut document, &path)?, key) {
                    (Value::Object(map), PathKey::Field(key)) => {
                        map.remove(&key);
                    }
                    _ => bail!("Invalid journal delete"),
                }
            }
            Change::Splice {
                path,
                index,
                remove,
                items,
            } => {
                ensure!(!path.is_empty(), "Invalid journal root operation");
                let array = descend(&mut document, &path)?
                    .as_array_mut()
                    .ok_or_else(|| anyhow::anyhow!("Invalid journal splice"))?;
                let index = checked_index(index)?;
                let remove = checked_index(remove)?;
                ensure!(
                    index <= array.len() && remove <= array.len() - index,
                    "Invalid journal splice range"
                );
                array.splice(index..index + remove, items);
            }
        }
    }
    Ok(document)
}
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct JournalIntegrityError(pub String);
pub fn replay_journal(
    document: Value,
    snapshot_version: i64,
    snapshot_hash: Option<&str>,
    entries: &[Value],
    version: i64,
    state_hash: Option<&str>,
) -> Result<Value> {
    restore_journal(
        document,
        snapshot_version,
        snapshot_hash,
        entries,
        version,
        state_hash,
    )
    .map_err(|e| JournalIntegrityError(e.to_string()).into())
}
fn restore_journal(
    mut document: Value,
    snapshot_version: i64,
    snapshot_hash: Option<&str>,
    entries: &[Value],
    version: i64,
    state_hash: Option<&str>,
) -> Result<Value> {
    let mut digest = document_hash(&document);
    ensure!(
        snapshot_hash.is_none_or(|h| h == digest),
        "Room snapshot hash mismatch"
    );
    let mut revision = snapshot_version;
    for entry in entries {
        ensure!(
            entry["format"] == 1
                && entry["version"].as_i64() == Some(revision + 1)
                && entry["baseHash"].as_str() == Some(&digest),
            "Room journal gap or base hash mismatch"
        );
        document = apply_changes(document, &entry["changes"])?;
        digest = document_hash(&document);
        ensure!(
            entry["hash"].as_str() == Some(&digest),
            "Room journal hash mismatch"
        );
        revision += 1;
    }
    ensure!(
        revision == version && state_hash.is_none_or(|h| h == digest),
        "Room journal head mismatch"
    );
    Ok(document)
}
/// Diff records array tails without copying unchanged history into the journal.
pub fn diff_state(before: &Value, after: &Value) -> Vec<Value> {
    diff_changes(before, after)
        .into_iter()
        .map(|change| serde_json::to_value(change).expect("journal change"))
        .collect()
}
/// Build typed operations; arbitrary document values remain at this storage boundary.
pub fn diff_changes(before: &Value, after: &Value) -> Vec<Change> {
    fn diff(a: &Value, b: &Value, path: &mut Vec<PathKey>, out: &mut Vec<Change>) {
        if a == b {
            return;
        }
        match (a, b) {
            (Value::Object(a), Value::Object(b)) => {
                for key in a.keys().filter(|k| !b.contains_key(*k)) {
                    path.push(PathKey::Field(key.clone()));
                    out.push(Change::Delete { path: path.clone() });
                    path.pop();
                }
                for (key, b) in b {
                    path.push(PathKey::Field(key.clone()));
                    if let Some(a) = a.get(key) {
                        diff(a, b, path, out);
                    } else {
                        out.push(Change::Set {
                            path: path.clone(),
                            value: b.clone(),
                        });
                    }
                    path.pop();
                }
            }
            (Value::Array(a), Value::Array(b)) => {
                let n = a.len().min(b.len());
                for i in 0..n {
                    path.push(PathKey::Index(i as u64));
                    diff(&a[i], &b[i], path, out);
                    path.pop();
                }
                if a.len() != b.len() {
                    out.push(Change::Splice {
                        path: path.clone(),
                        index: n as u64,
                        remove: (a.len() - n) as u64,
                        items: b[n..].to_vec(),
                    });
                }
            }
            _ => out.push(Change::Set {
                path: path.clone(),
                value: b.clone(),
            }),
        }
    }
    let mut changes = Vec::new();
    diff(before, after, &mut Vec::new(), &mut changes);
    changes
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn js_numbers_and_utf16_order() {
        assert_eq!(
            canonical_json(&json!({"\u{e000}":1,"😀":-0.0,"n":1e-7,"large":1e21})),
            "{\"large\":1e+21,\"n\":1e-7,\"😀\":0,\"\u{e000}\":1}"
        );
    }
    #[test]
    fn round_trip_and_corruption() {
        let a = json!({"a":[1,2],"old":true});
        let b = json!({"a":[1,3,4],"new":"x"});
        let changes = json!(diff_state(&a, &b));
        assert_eq!(apply_changes(a.clone(), &changes).unwrap(), b);
        let e = json!({"format":1,"version":2,"baseHash":document_hash(&a),"hash":document_hash(&b),"changes":changes});
        assert_eq!(
            replay_journal(
                a.clone(),
                1,
                None,
                std::slice::from_ref(&e),
                2,
                Some(&document_hash(&b))
            )
            .unwrap(),
            b
        );
        assert!(replay_journal(a, 1, None, &[e], 3, None).is_err());
    }
    #[test]
    fn rejects_unsafe_paths() {
        assert!(
            apply_changes(
                json!({}),
                &json!([{"op":"set","path":["__proto__"],"value":1}])
            )
            .is_err()
        );
    }
}

#[cfg(test)]
mod js_compatibility {
    use super::*;
    #[test]
    fn node_canonical_json_and_sha256_vectors() {
        let fixtures: Value =
            serde_json::from_str(include_str!("../tests/fixtures/canonical-json.json")).unwrap();
        for (i, fixture) in fixtures.as_array().unwrap().iter().enumerate() {
            assert_eq!(
                canonical_json(&fixture["value"]),
                fixture["canonical"].as_str().unwrap(),
                "canonical case {i}"
            );
            assert_eq!(
                document_hash(&fixture["value"]),
                fixture["hash"].as_str().unwrap(),
                "hash case {i}"
            );
        }
    }
}

#[cfg(test)]
mod view_integrity {
    use super::*;
    #[test]
    fn ignores_only_exact_transient_view_fields() {
        let view = json!({"latency":44,"room":{"members":[{"id":"p1","latency":10,"notes":{"latency":20}}],"latency":55},"game":{"players":[{"id":"p1","latency":30,"role":"Merlin","meta":{"latency":40}}],"serverTime":1000,"history":[{"serverTime":2000}]},"playerId":"p1","isHost":true,"isReferee":false});
        let mut projected = view.clone();
        projected["room"]["members"][0]
            .as_object_mut()
            .unwrap()
            .remove("latency");
        projected["game"]["players"][0]
            .as_object_mut()
            .unwrap()
            .remove("latency");
        projected["game"]
            .as_object_mut()
            .unwrap()
            .remove("serverTime");
        assert_eq!(view_hash(&view), document_hash(&projected));
        let mut transient = view.clone();
        transient["room"]["members"][0]["latency"] = json!(999);
        transient["game"]["players"][0]["latency"] = json!(888);
        transient["game"]["serverTime"] = json!(999999);
        assert_eq!(view_hash(&view), view_hash(&transient));
        for pointer in [
            "/latency",
            "/room/latency",
            "/room/members/0/notes/latency",
            "/game/players/0/meta/latency",
            "/game/history/0/serverTime",
            "/game/players/0/role",
            "/isReferee",
        ] {
            let mut changed = view.clone();
            *changed.pointer_mut(pointer).unwrap() = json!("changed");
            assert_ne!(view_hash(&view), view_hash(&changed), "must hash {pointer}");
        }
        let lobby = json!({"room":{"members":[]},"game":null,"playerId":null,"isHost":false,"isReferee":false});
        assert_eq!(view_hash(&lobby), document_hash(&lobby));
    }
}
