//! @ref LLP 3000.028#3.2 — continuations minted before equality normalization survive.
use snapback4_core::{Context, Engine, Value, cursor::{decode_cursor, encode_cursor}, ir, value::object};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

fn bound(prefix: bool, direction: &str, literal: bool) -> Bound {
    let table = "table t:\n  group: int\n  key: int\n  second: int\n  by byFull: group, key, second, id\n  public 'test'\n";
    let keys = if prefix { "[group = 7]" } else { "" };
    let equality = if prefix { if literal { ".key = 1" } else { ".key = k" } }
        else if literal { ".group = 7 and .key = 1" } else { ".group = 7 and .key = k" };
    let b = compile(&[("schema.q".into(), format!("{table}query page(k: int, c: cursor ?):\n  return t{keys} where {equality} {direction} 1 by byFull after c\n"))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn engine(b: Bound) -> Engine {
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed((0..12).map(|n| ("t".into(), object([
        ("id", Value::Id(format!("r{n:02}"))), ("group", Value::Int(7)),
        ("key", Value::Int(n / 4)), ("second", Value::Int(n % 4)),
    ])))).unwrap();
    e
}
fn ctx(token: Option<&str>) -> Context {
    Context::new("alice", BTreeMap::from([
        ("k".into(), Value::Int(1)), ("c".into(), token.map(|s| Value::String(s.into())).unwrap_or(Value::Null)),
    ]))
}
fn fixture_name(prefix: bool, direction: &str, literal: bool) -> String { format!("{prefix}-{direction}-{literal}") }
#[test]
fn baseline_minted_continuations_match_new_suffix_pages() {
    // Regenerate only with the pre-normalization compiler. Its runtime, schema
    // and generation are identical. The normal test never rewrites evidence.
    let mint = std::env::var_os("EQ_MINT_BASELINE").is_some();
    let mut fixtures = BTreeMap::<String, String>::new();
    let saved: BTreeMap<String, String> = serde_json::from_str(include_str!("fixtures/selected-prefix-cursors.json")).unwrap();
    for prefix in [false, true] {
        for direction in ["first", "last"] {
            for literal in [false, true] {
                let b = bound(prefix, direction, literal);
                let schema = b.schema.clone();
                let scan = ir::scans(&b.programs[0].program)[0];
                assert_eq!(scan.prefix.len(), if mint { usize::from(prefix) } else { 2 });
                let mut e = engine(b);
                let first = e.query("page", ctx(None)).unwrap();
                let new_token = first.next.as_ref().unwrap();
                let key = fixture_name(prefix, direction, literal);
                if mint {
                    fixtures.insert(key.clone(), new_token.clone());
                    let mut last = first;
                    for _ in 0..3 { last = e.query("page", ctx(last.next.as_deref())).unwrap(); }
                    e.set_ceilings(snapback4_core::meter::Ceilings { examined: 2, ..Default::default() });
                    let cut_before = e.query("page", ctx(None)).unwrap();
                    let cut_past = e.query("page", ctx(last.next.as_deref())).unwrap();
                    for (kind, cut) in [("before", cut_before), ("past", cut_past)] {
                        assert!(!cut.complete);
                        assert!(cut.data.as_array().unwrap().is_empty());
                        fixtures.insert(format!("{key}-cut-{kind}"), cut.next.unwrap());
                    }
                    continue;
                }
                let before = e.query("page", ctx(Some(&saved[&format!("{key}-cut-before")]))).unwrap();
                assert_eq!(before.data, first.data, "a cut before the pinned group starts at its first row");
                let past = e.query("page", ctx(Some(&saved[&format!("{key}-cut-past")]))).unwrap();
                assert!(past.data.as_array().unwrap().is_empty());
                assert!(past.complete);
                assert!(past.next.is_none());
                let token = &saved[&key];
                let old = decode_cursor(&schema, token).unwrap();
                assert_eq!(old.scope.as_ref().unwrap().prefix.len(), usize::from(prefix));
                assert_eq!(old.suffix.len(), 4 - usize::from(prefix));
                let mut inclusive = old.clone();
                inclusive.inclusive = true;
                let inclusive = encode_cursor(&schema, &inclusive).unwrap();
                assert_eq!(e.query("page", ctx(Some(&inclusive))).unwrap().data, first.data);
                assert_eq!(e.query("page", ctx(Some(&(token.clone() + "=")))).unwrap_err().code, "E_INPUT");
                let expected = e.query("page", ctx(Some(new_token))).unwrap();
                let continued = e.query("page", ctx(Some(token))).unwrap();
                assert_eq!(continued.data, expected.data, "{key}");
                assert_eq!(continued.complete, expected.complete);
                assert_eq!(continued.next, expected.next);
                let mut ids = vec![first.data.as_array().unwrap()[0].field("id").unwrap().clone()];
                let mut next = Some(token.clone());
                while let Some(token) = next {
                    let page = e.query("page", ctx(Some(&token))).unwrap();
                    ids.extend(page.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().clone()));
                    next = page.next;
                }
                let mut expected: Vec<_> = (4..8).map(|n| Value::Id(format!("r{n:02}"))).collect();
                if direction == "last" { expected.reverse(); }
                assert_eq!(ids, expected);
                // Same canonical encoding, but one invalid descriptor/scope at a time.
                for change in 0..8 {
                    let mut wrong = old.clone();
                    match change {
                        0 => wrong.table = "other".into(),
                        1 => wrong.index = "other".into(),
                        2 => wrong.order = if direction == "first" { ir::Order::Desc } else { ir::Order::Asc },
                        3 => wrong.scope.as_mut().unwrap().generation += 1,
                        4 => wrong.suffix[0].name = "other".into(),
                        5 => wrong.scope = None,
                        6 => wrong.scope.as_mut().unwrap().prefix.push(Value::Int(999)),
                        _ => wrong.scope.as_mut().unwrap().variant = Some([1, 2, 3, 4]),
                    }
                    let token = encode_cursor(&schema, &wrong).unwrap();
                    let error = e.query("page", ctx(Some(&token))).unwrap_err();
                    assert!(matches!(error.code.as_str(), "E_INPUT" | "E_CURSOR_INDEX"), "{key}/{change}: {error}");
                }
                let mut plain = bound(prefix, direction, literal);
                let mut ir = serde_json::to_value(&plain.programs[0].program).unwrap();
                fn erase(value: &mut serde_json::Value) {
                    match value {
                        serde_json::Value::Object(fields) => { fields.remove("cursor_pins"); for v in fields.values_mut() { erase(v); } },
                        serde_json::Value::Array(values) => for v in values { erase(v); },
                        _ => {}
                    }
                }
                erase(&mut ir);
                plain.programs[0].program = serde_json::from_value(ir).unwrap();
                assert_eq!(engine(plain).query("page", ctx(Some(token))).unwrap_err().code, "E_INPUT");
                if prefix {
                    let mut wrong = old.clone();
                    wrong.scope.as_mut().unwrap().prefix[0] = Value::Int(8);
                    let token = encode_cursor(&schema, &wrong).unwrap();
                    assert_eq!(e.query("page", ctx(Some(&token))).unwrap_err().code, "E_INPUT");
                }
            }
        }
    }
    if mint {
        std::fs::write("tests/fixtures/selected-prefix-cursors.json", serde_json::to_string_pretty(&fixtures).unwrap() + "\n").unwrap();
    }
}
