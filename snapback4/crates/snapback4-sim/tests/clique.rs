//! What the Clique lane and its day-two session attributed to Snapback 4,
//! each as the case they hit, against the fix (benchmarks/runs/2026-09-12-
//! snapback4-clique-0002).

use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::partition::holdings;
use snapback4_core::value::Value;
use snapback4_sim::chat::{CHAT, chat_engine_from};
use std::collections::BTreeMap;

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

/// M7: a `maintain` added on day two counts the rows that already exist,
/// and the built rows reach every member's partition.
#[test]
fn an_added_aggregate_is_built_from_existing_rows() {
    let without = CHAT.replace("maintain messageCounts: count messages by conversationId\n  read <- exists memberships[.conversationId, viewer]\n", "").replace(", count: messageCounts[.conversationId]", "");
    let mut engine = chat_engine_from(&without, &["dev:alice", "dev:bob"]);
    for n in 0..3 {
        let outcome = engine.mutate("send", Some(&format!("s{n}")), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("body", Value::String(format!("m{n}")))])).at(1_000 + n).with_ids([format!("m{n}")])).unwrap();
        assert!(matches!(outcome.state, WriteState::Sent { .. }));
    }
    let before = engine.seq().unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), CHAT.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let counts = engine.store().rows("messageCounts").unwrap();
    assert_eq!(counts.len(), 1, "{counts:?}");
    assert_eq!(counts[0].field("value").unwrap(), &Value::Int(3));
    // The built row streams to an established member.
    let page = engine.stream("dev:bob", before, 100).unwrap();
    assert!(page.events.iter().any(|e| e.table == "messageCounts" && e.kind == "put"), "{:?}", page.events);
    let (events, _) = engine.snapshot("dev:bob").unwrap();
    assert_eq!(holdings(&events)["messageCounts"].len(), 1);
    // And a further send counts on top of the backfill.
    engine.mutate("send", Some("s9"), Context::new("dev:bob", args(&[("conversationId", id("c1")), ("body", Value::String("four".into()))])).at(2_000).with_ids(["m9".to_owned()])).unwrap();
    assert_eq!(engine.store().rows("messageCounts").unwrap()[0].field("value").unwrap(), &Value::Int(4));
}

/// M7: adding an optional column with its own constraint is additive; the
/// day-two classifier said Narrowing for a constraint no existing row meets.
#[test]
fn a_new_optional_column_with_a_constraint_is_additive() {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), CHAT.to_owned())]);
    let with = CHAT.replace("  editedAt: time ?\n", "  editedAt: time ?\n  mood: text 1..8 ?\n");
    let next = snapback4_lang::compile(&[("schema.q".to_owned(), with)]);
    assert!(next.diagnostics.is_empty(), "{:?}", next.diagnostics);
    let steps = snapback4_core::successor::classify(&bound.schema, &next.schema);
    assert_eq!(snapback4_core::successor::worst(&steps), snapback4_core::successor::Change::Additive, "{steps:?}");
}
