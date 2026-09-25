mod fixture;
use snapback4_core::{Context, Engine, Value};
use std::collections::BTreeMap;

fn args(values: &[(&str, &str)]) -> BTreeMap<String, Value> {
    values.iter().map(|(key, value)| ((*key).into(), if *key == "roomId" { Value::Id((*value).into()) } else { Value::String((*value).into()) })).collect()
}

#[test]
fn calibration_uniform_words_continue_and_hidden_prefix_does_not_cut() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), fixture::SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(fixture::seed(54_990, 44_100).into_iter().filter(|(table, row)| table != "messages" || row.field("roomId").unwrap().as_str().unwrap() != "words")).unwrap();
    let cut = engine.query("all", Context::new("dev:alice", args(&[("q", "coffee")]))).unwrap();
    assert_eq!(cut.data.as_array().unwrap().len(), 10);
    assert!(!cut.complete && cut.next.is_none());
    println!("W8a calibration: messages=99090 hidden_ahead=44100 rows=0 examined={} complete={} next={:?}", cut.metered.examined, cut.complete, cut.next);
    assert_eq!(serde_json::to_value(&cut).unwrap()["cut"], serde_json::Value::Null);
    assert!(cut.capped_at.is_none(), "hidden candidates cannot cut the visible page");
    let scoped = engine.query("scoped", Context::new("dev:alice", args(&[("roomId", "readable"), ("q", "coffee")]))).unwrap();
    assert!(scoped.complete && scoped.data.as_array().unwrap().len() == 10);
    assert_eq!(serde_json::to_value(scoped).unwrap()["cut"], serde_json::Value::Null);
    let empty = engine.query("scoped", Context::new("dev:alice", args(&[("roomId", "readable"), ("q", "absent")]))).unwrap();
    assert!(empty.complete && empty.data.as_array().unwrap().is_empty());
    assert!(serde_json::to_value(empty).unwrap().get("cut").unwrap().is_null());
    engine.seed(fixture::seed(0, 0).into_iter().filter(|(table, _)| table == "messages")).unwrap();
    let words = engine.query("scoped", Context::new("dev:alice", args(&[("roomId", "words"), ("q", "cof")]))).unwrap();
    assert!(words.complete && words.next.is_some());
    assert_eq!(words.data.as_array().unwrap().len(), 10);
    assert!(words.cut.is_none() && words.word_cut_at.is_none());
    let control = engine.query("all", Context::new("dev:alice", args(&[("q", "cof")]))).unwrap();
    assert!(!control.complete && control.next.is_none() && control.word_cut_at.is_some());
    assert!(control.cut.is_none());
    assert!(!control.data.as_array().unwrap().is_empty());
    let nonuniform = engine.query("all", Context::new("dev:alice", args(&[("q", "absent")]))).unwrap();
    assert!(!nonuniform.complete && nonuniform.capped_at.is_none() && nonuniform.word_cut_at.is_none());
    assert!(serde_json::to_value(nonuniform).unwrap().get("cut").unwrap().is_null());
}

#[path = "point.rs"] pub(crate) mod point;
mod disclosure;

#[test]
fn nonuniform_full_response_sweep_including_cut() {
    let mut worlds = Vec::new();
    for hidden in [0, 32, 33] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), disclosure::source())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed(disclosure::rows(hidden)).unwrap();
        worlds.push(disclosure::sweep(|name, ceilings| {
            engine.set_ceilings(ceilings);
            disclosure::wire(&engine.query(name, disclosure::context("secret")).unwrap())
        }));
        engine.set_ceilings(Default::default());
        let visible = engine.query("all", disclosure::context("coffee")).unwrap();
        assert_eq!(visible.data.as_array().unwrap().len(), 5);
        assert!(!visible.complete && visible.cut.is_none());
        disclosure::merge_cuts("server", |name, q, ceilings| {
            engine.set_ceilings(ceilings);
            engine.query(name, disclosure::context(q)).unwrap()
        });
    }
    assert_eq!(worlds[0], worlds[1]);
    assert_eq!(worlds[0], worlds[2]);
    println!("W8R1a disclosure host=server hidden_words=32,33 identical_pairs={} positive_controls=3", worlds[0].len() * 2);
}

#[test]
fn point_probe_cut_cannot_disappear() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), point::SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(point::rows()).unwrap();
    point::check("server", |count, key, ceilings| {
        engine.set_ceilings(ceilings);
        engine.query("point", point::context(count, key)).unwrap()
    });
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
    assert!(refusal.rewrite.unwrap().contains("grouped or newest form"));
}
