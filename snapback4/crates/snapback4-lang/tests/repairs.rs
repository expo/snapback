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
fn strict_not_equal_is_not_an_equality_repair() {
    let (tokens, diagnostics) = snapback4_lang::lexer::lex("schema.q", "1 !== 2");
    assert!(diagnostics.is_empty());
    assert_eq!(tokens.iter().filter(|t| t.kind == snapback4_lang::lexer::Kind::Symbol).map(|t| t.value.as_str()).collect::<Vec<_>>(), ["!=", "="]);
    let bound = compile(&[("schema.q".into(), "query q():\n  return 1 !== 2\n".into())]);
    assert_eq!(bound.diagnostics.iter().map(ToString::to_string).collect::<Vec<_>>(), [
        "schema.q:2:14 — E_QUARRY_SYNTAX: expected expression, got \"=\"\n  rewrite: fix this Quarry line and rerun snapback4 check\n  guide: language",
        "schema.q:1:1 — E_QUARRY_SYNTAX: query q has an empty body\n  rewrite: fix this Quarry line and rerun snapback4 check\n  guide: language",
    ]);
    assert!(bound.diagnostics.iter().all(|d| !d.mechanical));
    assert!(bound.programs.is_empty());
    for d in bound.diagnostics { println!("{d}"); }
}

#[test]
fn equality_recovery_preserves_an_independent_syntax_error() {
    let source = "query q():\n  yes = 1 == 1\n  return :\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert_eq!(bound.diagnostics.len(), 2, "{:?}", bound.diagnostics);
    assert_eq!(bound.diagnostics[0].to_string(), "schema.q:2:11 — E_QUARRY_SYNTAX: equality is = in Quarry\n  rewrite: = — check --fix applies it\n  guide: language");
    assert_eq!(bound.diagnostics[1].to_string(), "schema.q:3:10 — E_QUARRY_SYNTAX: expected expression, got \":\"\n  rewrite: fix this Quarry line and rerun snapback4 check\n  guide: language");
    assert!(bound.diagnostics[0].mechanical && !bound.diagnostics[1].mechanical);
    for d in &bound.diagnostics { println!("before: {d}"); }
    let fixed = compile(&[("schema.q".into(), source.replace("==", "="))]);
    assert_eq!(fixed.diagnostics.len(), 1);
    assert_eq!(fixed.diagnostics[0].to_string(), bound.diagnostics[1].to_string());
    println!("after: {}", fixed.diagnostics[0]);
    let valid = compile(&[("schema.q".into(), source.replace("==", "=").replace("return :", "return yes"))]);
    assert!(valid.diagnostics.is_empty(), "{:?}", valid.diagnostics);
    let mut engine = snapback4_core::Engine::memory(valid.schema, valid.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(engine.query("q", snapback4_core::Context::new("alice", Default::default())).unwrap().data, snapback4_core::Value::Bool(true));
}

#[test]
fn reproduced_diagnostics() {
    let expected = [
        (ONCE, "schema.q:1:15 — E_QUARRY_SYNTAX: once is a column modifier, not an argument constraint; declare it on the owning table column\n  rewrite: photo: image <=10000000 ? — check --fix applies it\n  guide: language"),
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
fn trending_card_ranks_its_declared_candidate_window() {
    use snapback4_core::{Context, Engine, Value};
    use snapback4_lang::guide::quarry;
    use std::collections::BTreeMap;
    let block = quarry(include_str!("fixtures/legacy-feed-recipes.md")).into_iter().find(|block| block.contains("query trendingNow()")).unwrap();
    let bound = compile(&[("schema.q".into(), block)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let post = |id: &str, at: i64| ("posts".into(), snapback4_core::value::object([("id", Value::Id(id.into())), ("authorId", Value::Id("alice".into())), ("body", Value::String("post".into())), ("at", Value::Int(at))]));
    engine.seed([post("old", 1), post("popular", 90_000_000), post("new", 99_000_000)]).unwrap();
    engine.seed([("likes".into(), snapback4_core::value::object([("id", Value::Id("l1".into())), ("postId", Value::Id("popular".into())), ("principal", Value::Id("alice".into()))]))]).unwrap();
    let context = || Context::new("alice", BTreeMap::new()).at(100_000_000);
    let result = engine.query("trendingNow", context()).unwrap();
    assert!(result.complete);
    let rows = result.data.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].field("id").unwrap(), &Value::Id("popular".into()));
    assert_eq!(rows[1].field("id").unwrap(), &Value::Id("new".into()));
    engine.seed((0..8200).map(|i| post(&format!("p{i:05}"), 95_000_000))).unwrap();
    let cut = engine.query("trendingNow", context()).unwrap();
    assert!(cut.complete, "the declared candidate window is the query input");
    assert_eq!(cut.data.as_array().unwrap().len(), 10);
    assert_eq!(cut.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("popular".into()));
    for row in cut.data.as_array().unwrap() {
        assert_eq!(row.field("likes").unwrap(), &Value::Int(i64::from(row.field("id").unwrap() == &Value::Id("popular".into()))));
    }
    println!("trending: complete-day rows={}, examined={}; cut-day population=8202, returned={}, examined={}, complete={}", rows.len(), result.metered.examined, cut.data.as_array().unwrap().len(), cut.metered.examined, cut.complete);
}

#[test]
fn trending_card_finds_winners_only_inside_its_declared_candidate_window() {
    use snapback4_core::{Context, Engine, Value, value::object};
    use snapback4_lang::guide::quarry;
    use std::collections::BTreeMap;
    let block = quarry(include_str!("fixtures/legacy-feed-recipes.md")).into_iter().find(|block| block.contains("query trendingNow()")).unwrap();
    let bound = compile(&[("schema.q".into(), block)]);
    assert!(bound.diagnostics.is_empty() && bound.notes.is_empty(), "{:?} {:?}", bound.diagnostics, bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let post = |n: i64| ("posts".into(), object([
        ("id", Value::Id(format!("p{n:05}"))), ("authorId", Value::Id("alice".into())),
        ("body", Value::String("candidate".into())), ("at", Value::Int(90_000_000 + n)),
    ]));
    let likes = |n: i64, count: i64| (0..count).map(move |k| ("likes".into(), object([
        ("id", Value::Id(format!("l{n}-{k}"))), ("postId", Value::Id(format!("p{n:05}"))),
        ("principal", Value::Id(format!("reader{k}"))),
    ])));
    engine.seed((0..1500).map(post)).unwrap();
    engine.seed(likes(250, 3).chain(likes(1250, 4))).unwrap();
    let context = || Context::new("alice", BTreeMap::new()).at(100_000_000);
    let ids = |data: &Value| data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().clone()).collect::<Vec<_>>();
    let page = engine.query("trendingNow", context()).unwrap();
    assert!(page.complete, "{page:?}");
    let expected = [1250, 250, 1499, 1498, 1497, 1496, 1495, 1494, 1493, 1492].map(|n| Value::Id(format!("p{n:05}")));
    assert_eq!(ids(&page.data), expected, "first-200 and first-1000 samples both lose the winner; all ties use descending time");
    engine.seed((1500..8193).map(post)).unwrap();
    engine.seed(likes(8192, 5)).unwrap();
    let cut = engine.query("trendingNow", context()).unwrap();
    assert!(cut.complete, "sorting and slicing the declared candidate window is a complete answer about that window");
    assert_eq!(cut.capped_at, None, "the candidate bound leaves enough meter for exact prefix scores");
    assert_eq!(cut.metered.examined, 8191);
    assert_eq!(ids(&cut.data).len(), 10);
    assert_eq!(ids(&cut.data)[..2], expected[..2]);
    assert_eq!(cut.data.as_array().unwrap().iter().map(|row| row.field("likes").unwrap().as_int().unwrap()).collect::<Vec<_>>(), [4, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert!(!ids(&cut.data).contains(&Value::Id("p08192".into())), "the true winner is outside this recipe's candidate bound");
    println!("adversarial trending: exact population=1500 ids={:?} examined={}; capped population=8193 missing winner=p08192 examined={} complete={}", ids(&page.data), page.metered.examined, cut.metered.examined, cut.complete);
}

#[test]
fn wildcard_then_bare_column_is_an_explicit_replacement() {
    let source = SHAPE.replace("history()", "history(c: cursor ?)").replace("by byId", "by byId after c");
    let bound = compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
}
