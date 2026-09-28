mod fixture;
mod cursors;
use snapback4_core::{Context, Engine, Value, engine::QueryOutcome};

fn query(engine: &mut Engine, name: &str, cursor: Option<String>, term: &str) -> QueryOutcome {
    let mut args = std::collections::BTreeMap::from([("c".into(), cursor.map_or(Value::Null, Value::String))]);
    args.insert("q".into(), Value::String(term.into()));
    engine.query(name, Context::new("dev:alice", args).at(2000)).unwrap()
}

const DECODED_STORE: bool = true;
const COMPACT_MEMBERSHIPS: bool = true;
mod forms;

#[test]
fn w7r1b_server_search_cursor_positions_and_descriptors() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), cursors::source())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(cursors::seed()).unwrap();
    for op in ["searchLane", "searchPair", "searchNewest"] {
        let first = query(&mut engine, op, None, "cof");
        let next = first.next.unwrap();
        for (name, token, mut expected) in cursors::positions(&bound.schema, &next) {
            if op == "searchLane" { expected.retain(|id| id.starts_with("r0000")); }
            let mut cursor = Some(token);
            let mut actual = Vec::new();
            let mut pages = 0;
            loop {
                let page = query(&mut engine, op, cursor, "cof");
                actual.extend(cursors::ids(&page));
                cursor = page.next;
                pages += 1;
                assert!(pages < 10);
                if cursor.is_none() { break; }
            }
            assert_eq!(actual, expected, "{op} {name}");
        }
        for (name, token) in cursors::malformed(&bound.schema, &next) {
            let error = engine.query(op, Context::new("dev:alice", [("q".into(), Value::String("cof".into())), ("c".into(), Value::String(token))].into()).at(2000)).unwrap_err();
            assert_eq!(error.code, "E_INPUT", "{op} {name}: {error}");
            assert!(error.to_string().contains("cursor"));
        }
        println!("W7R1b cursor host=server op={op} valid_positions=3 malformed_descriptors=8 exact_order=true");
    }
}

mod lazy;

fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut dyn FnMut(&str, Option<String>, &str) -> QueryOutcome)) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(rows).unwrap();
    check(&mut |op, cursor, term| {
        let page = query(&mut engine, op, cursor, term);
        if source.contains("last 10 by .at") && term == "absent" { assert!(page.complete, "server has the full history"); }
        page
    });
}
