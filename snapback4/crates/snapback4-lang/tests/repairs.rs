use snapback4_lang::compile;

const INDEX: &str = include_str!("fixtures/repair-index.q");
const PROBE: &str = include_str!("fixtures/repair-probe.q");
const ONCE: &str = include_str!("fixtures/repair-once.q");
const SHAPE: &str = include_str!("fixtures/repair-shape.q");
const PARENS: &str = include_str!("fixtures/repair-parens.q");

#[test]
fn double_equals_in_a_helper_has_one_mechanical_diagnostic() {
    let source = include_str!("fixtures/repair-equality.q");
    let bound = compile(&[("schema.q".into(), source.into())]);
    for d in &bound.diagnostics { println!("{d}"); }
    assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
    assert_eq!(bound.diagnostics[0].to_string(), "schema.q:2:8 — E_QUARRY_SYNTAX: equality is = in Quarry\n  rewrite: = — check --fix applies it\n  guide: language");
    assert!(bound.diagnostics[0].mechanical);
    assert!(bound.programs.is_empty(), "the guessed spelling must not compile");
    let corrected = compile(&[("schema.q".into(), source.replace("==", "="))]);
    assert!(corrected.diagnostics.is_empty(), "{:?}", corrected.diagnostics);
    assert!(corrected.notes.is_empty(), "{:?}", corrected.notes);
}

#[test]
fn double_equals_recovers_each_comparison_in_expression_contexts() {
    for source in [
        "query q():\n  return (1 == 1) and (2==2)\n",
        "query q():\n  yes = 1 == 1\n  require 2 == 2 else NO\n  return yes\n",
        "fn equal(a: int, b: int): a == b\nquery q():\n  return equal(1, 1)\n",
        "query q():\n  return { yes: 1 == 1, values: [2 == 2] }\n",
        "query q():\n  return true if 1 == 1 else false\n",
        "table things:\n  owner: principal\n  read <- .owner == viewer\nquery q():\n  return true\n",
        "table things:\n  public 'things'\nquery q():\n  return things first 2 by byId where .id == 'x'\n",
    ] {
        let bound = compile(&[("schema.q".into(), source.into())]);
        assert_eq!(bound.diagnostics.len(), source.matches("==").count(), "{:?}", bound.diagnostics);
        assert!(bound.diagnostics.iter().all(|d| d.message == "equality is = in Quarry" && d.rewrite == "=" && d.mechanical));
        let fixed = compile(&[("schema.q".into(), source.replace("==", "="))]);
        assert!(fixed.diagnostics.is_empty(), "{source}: {:?}", fixed.diagnostics);
    }
    let files = [("one.q".into(), "query q():\n  return 1 == 1\n".into()), ("two.q".into(), "query q():\n  return 2 == 2\n".into())];
    let bound = compile(&files);
    assert_eq!(bound.diagnostics.len(), 2);
    assert_eq!(bound.diagnostics.iter().map(|d| d.site.file.as_str()).collect::<Vec<_>>(), ["one.q", "two.q"]);
}

#[test]
fn equality_controls_preserve_strings_comments_and_not_equal_and_refuse_triple_equals() {
    use snapback4_core::{Context, Engine, Value};
    let source = "query q():\n  return '==' != '=' -- == stays in a comment\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(engine.query("q", Context::new("alice", Default::default())).unwrap().data, Value::Bool(true));
    let triple = compile(&[("schema.q".into(), "query q():\n  return 1 === 1\n".into())]);
    assert_eq!(triple.diagnostics.len(), 2, "{:?}", triple.diagnostics);
    assert_eq!(triple.diagnostics[0].to_string(), "schema.q:2:13 — E_QUARRY_SYNTAX: expected expression, got \"=\"\n  rewrite: fix this Quarry line and rerun snapback4 check\n  guide: language");
    assert_eq!(triple.diagnostics[1].to_string(), "schema.q:1:1 — E_QUARRY_SYNTAX: query q has an empty body\n  rewrite: fix this Quarry line and rerun snapback4 check\n  guide: language");
    assert!(triple.diagnostics.iter().all(|d| !d.mechanical));
    for d in triple.diagnostics { println!("{d}"); }
}

#[test]
fn reproduced_diagnostics() {
    let expected = [
        (INDEX, "schema.q:7:10 — E_QUARRY_UNKNOWN: members has no index whose prefix takes 2 keys; its indexes are byId (id), byRoom (room, id)\n  rewrite: by byRoomPrincipal: room, principal, id — check --fix applies it\n  guide: indexes"),
        (PROBE, "schema.q:8:11 — E_QUARRY_UNKNOWN: chats has no index with 2 columns matching this key\n  rewrite: by byKeyAdmin: key, admin — check --fix applies it\n  guide: indexes"),
        (ONCE, "schema.q:1:15 — E_QUARRY_SYNTAX: once is a column modifier, not an argument constraint; declare it on the owning table column\n  rewrite: photo: image <=10000000 ? — check --fix applies it\n  guide: language"),
        (SHAPE, "schema.q:5:41 — E_QUARRY_UNKNOWN: shape wildcard already includes field tombstone\n  rewrite: { * } — check --fix applies it\n  guide: shapes"),
        (PARENS, "schema.q:1:1 — E_QUARRY_SYNTAX: an operation with no arguments still needs parentheses\n  rewrite: query trending(): — check --fix applies it\n  guide: language"),
    ];
    for (source, expected) in expected {
        let bound = compile(&[("schema.q".into(), source.into())]);
        assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
        let d = &bound.diagnostics[0];
        assert_eq!(d.to_string(), expected);
        assert_eq!(serde_json::to_value(d).unwrap()["mechanical"], true);
        println!("{d}");
    }
}

#[test]
fn table_typed_helpers_bind_at_each_call_as_rows_or_references() {
    use snapback4_core::{Context, Engine, Value};
    use std::collections::BTreeMap;
    let source = "table messages:\n  body: text <=100\n  public 'messages'\nfn identity(m: messages): m\nfn body(m: messages): m.body\nfn lookup(m: messages):\n  return (messages[m] ! else NOT_FOUND).body\nquery rowArg(id: messages):\n  m = messages[id] ! else NOT_FOUND\n  return body(identity(m))\nquery refArg(id: messages):\n  return lookup(identity(id))\nquery both(id: messages):\n  m = messages[id] ! else NOT_FOUND\n  return { row: body(identity(m)), ref: lookup(identity(id)) }\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("messages".into(), snapback4_core::value::object([("id", Value::Id("m1".into())), ("body", Value::String("hello".into()))]))]).unwrap();
    let context = || Context::new("alice", BTreeMap::from([("id".into(), Value::Id("m1".into()))]));
    for query in ["rowArg", "refArg"] {
        let result = engine.query(query, context()).unwrap();
        assert_eq!(result.data, Value::String("hello".into()));
        assert_eq!(result.metered.examined, 1, "{query}: exactly one explicit lookup, no implicit helper lookup");
        println!("{query}: examined={}", result.metered.examined);
    }
    let shaped = compile(&[("schema.q".into(), format!("{source}query shapeArg(id: messages):\n  return messages[id] {{ body: .body }}\n"))]);
    assert!(shaped.diagnostics.is_empty(), "{:?}", shaped.diagnostics);
    assert!(shaped.notes.is_empty(), "{:?}", shaped.notes);
    engine.adopt(shaped.schema, shaped.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(engine.query("shapeArg", context()).unwrap().data.field("body").unwrap(), &Value::String("hello".into()));
    let both = engine.query("both", context()).unwrap();
    assert_eq!(both.data.field("row"), both.data.field("ref"));
    assert_eq!(both.metered.examined, 2);
    // A reference still has no fields, and a row of another table does not fit.
    let bad = compile(&[("schema.q".into(), format!("{source}\nquery bad(id: messages):\n  return body(id)\n"))]);
    assert_eq!(bad.diagnostics.len(), 1);
    assert_eq!(bad.diagnostics[0].to_string(), "schema.q:5:24 — E_QUARRY_TYPE: a messages reference has no fields\n  rewrite: messages[m] ! else NOT_FOUND — read the row, or use the shape's row parameter: messages[m] { body: .body }\n  guide: shapes");
    assert_eq!(serde_json::to_value(&bad.diagnostics[0]).unwrap(), serde_json::json!({
        "site": {"file":"schema.q", "line":5, "col":24}, "code":"E_QUARRY_TYPE", "message":"a messages reference has no fields",
        "rewrite":"messages[m] ! else NOT_FOUND — read the row, or use the shape's row parameter: messages[m] { body: .body }", "guide":"shapes", "mechanical":false
    }));
    println!("{}", bad.diagnostics[0]);
    let wrong = compile(&[("schema.q".into(), format!("{source}\ntable other:\n  public 'other'\nquery wrong(id: other):\n  return body(other[id] ! else NOT_FOUND)\n"))]);
    assert!(wrong.diagnostics.iter().any(|d| d.message == "body's m is a messages reference; got a other row"));
}

#[test]
fn trending_card_ranks_the_day_and_reports_a_cut_set() {
    use snapback4_core::{Context, Engine, Value};
    use snapback4_lang::guide::{card, quarry};
    use std::collections::BTreeMap;
    let block = quarry(card("feeds").unwrap()).into_iter().find(|block| block.contains("query trending()")).unwrap();
    let bound = compile(&[("schema.q".into(), block)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let post = |id: &str, at: i64| ("posts".into(), snapback4_core::value::object([("id", Value::Id(id.into())), ("authorId", Value::Id("alice".into())), ("body", Value::String("post".into())), ("at", Value::Int(at))]));
    engine.seed([post("old", 1), post("popular", 90_000_000), post("new", 99_000_000)]).unwrap();
    engine.seed([("likes".into(), snapback4_core::value::object([("id", Value::Id("l1".into())), ("postId", Value::Id("popular".into())), ("principal", Value::Id("alice".into()))]))]).unwrap();
    let context = || Context::new("alice", BTreeMap::new()).at(100_000_000);
    let result = engine.query("trending", context()).unwrap();
    assert!(result.complete);
    let rows = result.data.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].field("id").unwrap(), &Value::Id("popular".into()));
    assert_eq!(rows[1].field("id").unwrap(), &Value::Id("new".into()));
    engine.seed((0..8200).map(|i| post(&format!("p{i:05}"), 95_000_000))).unwrap();
    let cut = engine.query("trending", context()).unwrap();
    assert!(!cut.complete);
    assert_eq!(cut.data.as_array().unwrap().len(), 10);
    println!("trending: complete-day rows={}, examined={}; cut-day population=8202, returned={}, examined={}, complete={}", rows.len(), result.metered.examined, cut.data.as_array().unwrap().len(), cut.metered.examined, cut.complete);
}
