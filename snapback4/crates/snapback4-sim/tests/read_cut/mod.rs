mod fixture;
use snapback4_core::{Context, Engine, Value};
use std::collections::BTreeMap;

fn args(values: &[(&str, &str)]) -> BTreeMap<String, Value> {
    values.iter().map(|(key, value)| ((*key).into(), if *key == "roomId" { Value::Id((*value).into()) } else { Value::String((*value).into()) })).collect()
}

#[test]
fn calibration_empty_cut_is_distinct_from_no_matches() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), fixture::SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(fixture::seed(54_990, 44_100).into_iter().filter(|(table, row)| table != "messages" || row.field("roomId").unwrap().as_str().unwrap() != "words")).unwrap();
    let cut = engine.query("all", Context::new("dev:alice", args(&[("q", "coffee")]))).unwrap();
    assert!(cut.data.as_array().unwrap().is_empty() && !cut.complete && cut.next.is_none());
    println!("W8a calibration: messages=99090 hidden_ahead=44100 rows=0 examined={} complete={} next={:?}", cut.metered.examined, cut.complete, cut.next);
    assert_eq!(serde_json::to_value(&cut).unwrap()["cut"], "meter");
    let scoped = engine.query("scoped", Context::new("dev:alice", args(&[("roomId", "readable"), ("q", "coffee")]))).unwrap();
    assert!(scoped.complete && scoped.data.as_array().unwrap().len() == 10);
    assert_eq!(serde_json::to_value(scoped).unwrap()["cut"], serde_json::Value::Null);
    let empty = engine.query("scoped", Context::new("dev:alice", args(&[("roomId", "readable"), ("q", "absent")]))).unwrap();
    assert!(empty.complete && empty.data.as_array().unwrap().is_empty());
    assert!(serde_json::to_value(empty).unwrap().get("cut").unwrap().is_null());
    engine.seed(fixture::seed(0, 0).into_iter().filter(|(table, _)| table == "messages")).unwrap();
    let words = engine.query("scoped", Context::new("dev:alice", args(&[("roomId", "words"), ("q", "cof")]))).unwrap();
    assert!(!words.complete && !words.data.as_array().unwrap().is_empty());
    assert_eq!(serde_json::to_value(words).unwrap()["cut"], "words");
    let nonuniform = engine.query("all", Context::new("dev:alice", args(&[("q", "absent")]))).unwrap();
    assert!(!nonuniform.complete && nonuniform.capped_at.is_none() && nonuniform.word_cut_at.is_none());
    assert!(serde_json::to_value(nonuniform).unwrap().get("cut").unwrap().is_null());
}

#[test]
fn held_query_compiles_with_device_dispatch_and_a_server_refusal() {
    let source = fixture::SOURCE.replace("query all(q: text <=100, c: cursor ?):", "query all(q: text <=100, c: cursor ?) held:");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(!bound.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"));
    let emitted = snapback4_lang::emit::typescript(&bound);
    assert!(emitted.contains("held: true"), "{emitted}");
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let refusal = engine.query("all", Context::new("dev:alice", args(&[("q", "coffee")]))).unwrap_err();
    assert_eq!(refusal.code, "E_QUERY_HELD");
    assert_eq!(refusal.guide.as_deref(), Some("search"));
    assert!(refusal.rewrite.unwrap().contains("scoped server walk"));
}
