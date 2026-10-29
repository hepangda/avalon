//! Arbitrary nested state changes must recover exactly, including array shape
//! changes and objects whose fields disappear between commands.
use avalon_server::journal::{apply_changes, diff_state, document_hash};
use proptest::prelude::*;
use serde_json::Value;

fn documents() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Bool),
        (-1_000_000i64..1_000_000).prop_map(|n| Value::Number(n.into())),
        "[a-zA-Z0-9中😀]{0,32}".prop_map(Value::String)
    ];
    let nested = leaf.prop_recursive(4, 96, 12, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..12).prop_map(Value::Array),
            prop::collection::btree_map("[a-z]{1,8}", inner, 0..12)
                .prop_map(|m| Value::Object(m.into_iter().collect()))
        ]
    });
    // RoomDocument is always an object; a root array is intentionally rejected
    // by the legacy journal format. Nested arrays still vary arbitrarily.
    prop::collection::btree_map("[a-z]{1,8}", nested, 0..8)
        .prop_map(|m| Value::Object(m.into_iter().collect()))
}
proptest! {
    #[test]
    fn changes_restore_arbitrary_documents(before in documents(),after in documents()){
        let changes=Value::Array(diff_state(&before,&after));
        let recovered=apply_changes(before,&changes).unwrap();
        prop_assert_eq!(document_hash(&recovered),document_hash(&after));
        prop_assert_eq!(recovered,after);
    }
}
