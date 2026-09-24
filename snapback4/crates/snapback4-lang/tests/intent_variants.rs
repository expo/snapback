use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;
const SOURCE: &str = include_str!("fixtures/intent-variants.q");
fn bound(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics); b
}
fn id(value: &str) -> Value { Value::Id(value.into()) }
fn text(value: &str) -> Value { Value::String(value.into()) }
fn seed(engine: &mut Engine) {
    engine.seed([("orgs".into(), object([("id", id("org"))])), ("orgs".into(), object([("id", id("hidden"))])),
        ("members".into(), object([("id", id("member")), ("org", id("org")), ("principal", id("alice"))])),
        ("labels".into(), object([("id", id("label"))]))]).unwrap();
    engine.seed([("a", "todo", Some("x"), 1), ("b", "doing", Some("x"), 2), ("c", "todo", None, 3), ("d", "done", Some("y"), 4), ("e", "todo", Some("x"), 5)]
        .map(|(key, status, assignee, at)| ("issues".into(), object([("id", id(key)), ("org", id("org")), ("status", text(status)), ("assignee", assignee.map(id).unwrap_or(Value::Null)), ("at", Value::Int(at))])))).unwrap();
    engine.seed([("la", "a", "org"), ("lb", "b", "hidden"), ("lc", "c", "org")].map(|(key, issue, org)| ("issueLabels".into(), object([("id", id(key)), ("issue", id(issue)), ("label", id("label")), ("org", id(org))])))).unwrap();
    engine.seed([("a", "alice", "able"), ("b", "bob", "baker"), ("c", "alice", "charlie"), ("d", "alice", "delta")].map(|(key, owner, handle)| ("profiles".into(), object([("id", id(key)), ("owner", id(owner)), ("handle", text(handle)), ("bio", text("common"))])))).unwrap();
}
fn engine() -> Engine { let b = bound(SOURCE); let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap(); seed(&mut e); e }
fn args(status: Option<&str>, assignee: Option<&str>) -> BTreeMap<String, Value> { BTreeMap::from([("org".into(), id("org")), ("status".into(), status.map(text).unwrap_or(Value::Null)), ("assignee".into(), assignee.map(id).unwrap_or(Value::Null)), ("c".into(), Value::Null)]) }
fn pages(engine: &mut Engine, name: &str, mut args: BTreeMap<String, Value>) -> Vec<String> {
    let mut ids = Vec::new();
    for _ in 0..10 {
        let page = engine.query(name, Context::new("alice", args.clone())).unwrap();
        assert!(page.complete, "{name}: {page:?}");
        ids.extend(page.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()));
        if let Some(cursor) = page.next { args.insert("c".into(), text(&cursor)); } else { return ids; }
    }
    panic!("did not finish")
}
#[test]
fn board_variants_pin_arguments_and_page_every_matching_row() {
    let b = bound(SOURCE);
    let board = &b.programs.iter().find(|p| p.program.name == "board").unwrap().program;
    let scans = snapback4_core::ir::scans(board);
    assert_eq!(scans.len(), 4);
    assert!(scans.iter().all(|scan| scan.filter.is_none()));
    let mut actual = scans.iter().map(|s| b.schema.tables["issues"].indexes[&s.index].columns()).collect::<Vec<_>>(); actual.sort();
    assert_eq!(actual, vec![vec!["assignee", "org", "at", "id"], vec!["assignee", "org", "status", "at", "id"], vec!["org", "at", "id"], vec!["org", "status", "at", "id"]].into_iter().map(|v| v.into_iter().map(str::to_owned).collect::<Vec<_>>()).collect::<Vec<_>>());
    let mut e = engine();
    e.seed([("issues".into(), object([("id", id("secret")), ("org", id("hidden")), ("status", text("todo")), ("assignee", id("x")), ("at", Value::Int(6))]))]).unwrap();
    for (status, assignee, expected) in [(None, None, vec!["e", "d", "c", "b", "a"]), (Some("todo"), None, vec!["e", "c", "a"]), (None, Some("x"), vec!["e", "b", "a"]), (Some("todo"), Some("x"), vec!["e", "a"])] {
        let first = e.query("board", Context::new("alice", args(status, assignee))).unwrap();
        let position = snapback4_core::cursor::decode_cursor(e.schema(), first.next.as_ref().unwrap()).unwrap();
        let columns = e.schema().tables["issues"].indexes[&position.index].columns();
        assert_eq!(columns.contains(&"status".into()), status.is_some());
        assert_eq!(columns.contains(&"assignee".into()), assignee.is_some());
        assert!(position.scope.unwrap().variant.is_some());
        assert_eq!(pages(&mut e, "board", args(status, assignee)), expected);
        let mut hidden = args(status, assignee); hidden.insert("org".into(), id("hidden"));
        let denied = e.query("board", Context::new("alice", hidden)).unwrap();
        assert!(denied.data.as_array().unwrap().is_empty(), "{denied:?}");
        assert!(denied.next.is_none());
    }
}
#[test]
fn cursor_presence_is_checked_even_when_the_index_is_shared() {
    let mut e = engine();
    for name in ["board", "window"] {
        let mut a = if name == "board" { args(None, None) } else { BTreeMap::from([("org".into(), id("org")), ("start".into(), Value::Null), ("c".into(), Value::Null)]) };
        let first = e.query(name, Context::new("alice", a.clone())).unwrap();
        a.insert("c".into(), text(&first.next.unwrap()));
        if name == "board" { a.insert("status".into(), text("todo")); } else { a.insert("start".into(), Value::Int(1)); }
        let error = e.query(name, Context::new("alice", a)).unwrap_err();
        assert_eq!(error.code, "E_CURSOR_INDEX", "{error}");
    }
}
#[test]
fn aggregate_and_argument_only_local_choose_the_same_presence_branch() {
    let mut e = engine();
    for (status, count) in [(None, 5), (Some("todo"), 3)] {
        let a = BTreeMap::from([("org".into(), id("org")), ("status".into(), status.map(text).unwrap_or(Value::Null))]);
        let result = e.query("total", Context::new("alice", a)).unwrap();
        assert!(result.complete); assert_eq!(result.data, Value::Int(count));
        let mut a = args(status, None); a.remove("assignee");
        assert_eq!(pages(&mut e, "local", a).len(), count as usize);
    }
}
#[test]
fn exact_exists_stays_a_ruled_probe_when_discovery_is_not_admitted() {
    let b = bound(SOURCE);
    for name in ["withLabel", "withNamedLabel"] {
        let p = &b.programs.iter().find(|p| p.program.name == name).unwrap().program;
        let probes: Vec<_> = snapback4_core::ir::read_sites(p).into_iter().filter(|site| site.table == "issueLabels").collect();
        assert_eq!(probes.len(), 1);
        assert_eq!(probes[0].kind, "point");
        assert!(b.schema.tables["issueLabels"].indexes[&probes[0].index].unique);
        assert!(snapback4_lang::bind::merges(&p.body).is_empty());
        assert!(snapback4_core::ir::scans(p).iter().all(|scan| scan.table == "issues" && scan.merge_site.is_none()));
    }
    let mut e = engine();
    for name in ["withLabel", "withNamedLabel"] {
        assert_eq!(pages(&mut e, name, BTreeMap::from([("org".into(), id("org")), ("label".into(), id("label")), ("c".into(), Value::Null)])), ["c", "a"]);
    }
}
#[test]
fn empty_folded_search_browses_with_order_continuation_and_authorization() {
    let mut e = engine();
    for q in ["", " \t\n", "...!!!", "common"] {
        assert_eq!(pages(&mut e, "people", BTreeMap::from([("q".into(), text(q)), ("c".into(), Value::Null)])), ["a", "c", "d"]);
    }
    assert_eq!(pages(&mut e, "people", BTreeMap::from([("q".into(), text("cha")), ("c".into(), Value::Null)])), ["c"]);
}

#[test]
fn fourth_optional_filter_stays_residual_and_names_its_fallback() {
    let source = "table t:\n  a: int\n  b: int\n  c: int\n  d: int\n  public 't'\nquery q(a: int ?, b: int ?, c: int ?, d: int ?, cursor: cursor ?):\n  return t where (a = null or .a = a) and (b = null or .b = b) and (c = null or .c = c) and (d = null or .d = d) first 5 after cursor\n";
    let b = bound(source);
    let scans = snapback4_core::ir::scans(&b.programs[0].program);
    assert_eq!(scans.len(), 8);
    assert!(scans.iter().all(|scan| scan.filter.is_some()));
    assert!(b.notes.iter().any(|note| note.code == "N_OPTIONAL_FILTER_LIMIT" && note.message.contains("d stay residual")), "{:?}", b.notes);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([("t".into(), object([("id", id("yes")), ("a", Value::Int(1)), ("b", Value::Int(1)), ("c", Value::Int(1)), ("d", Value::Int(1))])),
        ("t".into(), object([("id", id("no")), ("a", Value::Int(1)), ("b", Value::Int(1)), ("c", Value::Int(1)), ("d", Value::Int(2))]))]).unwrap();
    let p = e.query("q", Context::new("alice", BTreeMap::from([("a".into(), Value::Null), ("b".into(), Value::Null), ("c".into(), Value::Null), ("d".into(), Value::Int(1)), ("cursor".into(), Value::Null)]))).unwrap();
    assert_eq!(p.data.as_array().unwrap().len(), 1);
    assert_eq!(p.data.as_array().unwrap()[0].field("id").unwrap(), &id("yes"));
}

#[test]
fn optional_equality_accepts_both_spellings_and_orders() {
    for guard in ["status = null or .status = status", "null == status or .status == status", ".status == status or status == null"] {
        let source = SOURCE.replace("status = null or .status = status", guard);
        let b = bound(&source);
        assert_eq!(snapback4_core::ir::scans(&b.programs.iter().find(|p| p.program.name == "board").unwrap().program).len(), 4);
    }
}

#[test]
fn optional_ranges_lists_helpers_and_streaming_totals_keep_their_consumers() {
    let source = "table t:\n  at: int\n  public 't'\nfn selected(x: int ?):\n  chosen = x\n  for i in range(0, 1):\n    chosen = x\n  return chosen\nquery window(start: int ?, c: cursor ?):\n  lo = selected(start)\n  return t where (lo = null or .at >= lo) first 1 by .at after c\nquery list(values: [int] <=3 ?, c: cursor ?):\n  return t where (values = null or .at in values) first 1 by .at after c\nquery total(start: int ?):\n  return count(t where (start = null or .at >= start))\nquery sum(start: int ?):\n  return sum(t where (start = null or .at >= start), .at)\nquery has(start: int ?):\n  return exists t where (start = null or .at >= start)\n";
    let b = bound(source);
    for name in ["window", "total", "sum", "has"] {
        let p = &b.programs.iter().find(|p| p.program.name == name).unwrap().program;
        let scans = snapback4_core::ir::scans(p);
        assert_eq!(scans.len(), 2, "{name}");
        assert_eq!(scans.iter().filter(|s| s.range.is_some()).count(), 1, "{name}: {scans:?}");
    }
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for start in [Value::Null, Value::Int(6)] {
        let absent = e.query("has", Context::new("alice", BTreeMap::from([("start".into(), start)]))).unwrap();
        assert!(absent.complete); assert_eq!(absent.data, Value::Bool(false));
    }
    e.seed((1..=5).map(|n| ("t".into(), object([("id", id(&n.to_string())), ("at", Value::Int(n))])))).unwrap();
    for (start, expected) in [(Value::Null, vec!["1", "2", "3", "4", "5"]), (Value::Int(3), vec!["3", "4", "5"])] {
        assert_eq!(pages(&mut e, "window", BTreeMap::from([("start".into(), start.clone()), ("c".into(), Value::Null)])), expected);
        for (name, expected) in [("total", Value::Int(expected.len() as i64)), ("sum", Value::Int(if start == Value::Null { 15 } else { 12 })), ("has", Value::Bool(true))] {
            let page = e.query(name, Context::new("alice", BTreeMap::from([("start".into(), start.clone())]))).unwrap();
            assert!(page.complete); assert_eq!(page.data, expected);
        }
    }
    assert_eq!(pages(&mut e, "list", BTreeMap::from([("values".into(), Value::Array(vec![Value::Int(1), Value::Int(3)])), ("c".into(), Value::Null)])), ["1", "3"]);
    let absent = e.query("list", Context::new("alice", BTreeMap::from([("values".into(), Value::Null), ("c".into(), Value::Null)]))).unwrap();
    let error = e.query("list", Context::new("alice", BTreeMap::from([("values".into(), Value::Array(vec![])), ("c".into(), text(&absent.next.unwrap()))]))).unwrap_err();
    assert_eq!(error.code, "E_CURSOR_INDEX", "empty discovery still validates presence");
    let absent = e.query("has", Context::new("alice", BTreeMap::from([("start".into(), Value::Int(6))]))).unwrap();
    assert!(absent.complete); assert_eq!(absent.data, Value::Bool(false));
    e.set_ceilings(snapback4_core::Ceilings { examined: 0, ..Default::default() });
    for start in [Value::Null, Value::Int(3)] {
        let cut = e.query("has", Context::new("alice", BTreeMap::from([("start".into(), start)]))).unwrap();
        assert!(!cut.complete && cut.next.is_none()); assert_eq!(cut.data, Value::Null, "{cut:?}");
    }
    e.set_ceilings(snapback4_core::Ceilings { examined: 1, ..Default::default() });
    for name in ["total", "sum"] {
        for start in [Value::Null, Value::Int(3)] {
            let cut = e.query(name, Context::new("alice", BTreeMap::from([("start".into(), start)]))).unwrap();
            assert!(!cut.complete && cut.next.is_none()); assert_eq!(cut.data, Value::Null, "{name}: {cut:?}");
        }
    }
}

#[test]
fn search_helpers_evaluate_once_and_authored_merges_browse() {
    let source = "table t:\n  owner: principal\n  body: text <=40\n  by byWords: owner, words(body), id\n  read <- .owner = viewer\n  update <- .owner = viewer\n  cap 10 by owner\n  sync to .owner\ntable input:\n  value: text <=40\n  public 'input'\nfn needle(i: input): (input[i] ! else MISSING).value\nquery page(i: input, c: cursor ?):\n  return t[viewer] matching needle(i) first 1 by byWords after c\nquery merged(q: text <=40, c: cursor ?):\n  return merge t matching q after c first 1 by byWords:\n    [viewer]\nquery wrapped(q: text <=40, c: cursor ?):\n  return { rows: t[viewer] matching q first 1 by byWords after c }\n";
    let b = bound(source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([("input".into(), object([("id", id("q")), ("value", text("hello"))]))]).unwrap();
    e.seed(["a", "b", "c", "d"].map(|key| ("t".into(), object([("id", id(key)), ("owner", id("alice")), ("body", text(if key == "d" { "" } else { "hello" }))])))).unwrap();
    let page = e.query("page", Context::new("alice", BTreeMap::from([("i".into(), id("q")), ("c".into(), Value::Null)]))).unwrap();
    let direct = e.query("merged", Context::new("alice", BTreeMap::from([("q".into(), text("hello")), ("c".into(), Value::Null)]))).unwrap();
    assert_eq!(page.metered.examined, direct.metered.examined + 1, "the helper's point read runs once");
    for q in ["", " \t", "...", "hello"] {
        assert_eq!(pages(&mut e, "merged", BTreeMap::from([("q".into(), text(q)), ("c".into(), Value::Null)])), if q == "hello" { vec!["a", "b", "c"] } else { vec!["a", "b", "c", "d"] });
        let page = e.query("wrapped", Context::new("alice", BTreeMap::from([("q".into(), text(q)), ("c".into(), Value::Null)]))).unwrap();
        assert!(page.complete && page.next.is_some(), "{page:?}");
    }
    let browse = e.query("merged", Context::new("alice", BTreeMap::from([("q".into(), text("")), ("c".into(), Value::Null)]))).unwrap();
    let error = e.query("merged", Context::new("alice", BTreeMap::from([("q".into(), text("hello")), ("c".into(), text(&browse.next.unwrap()))]))).unwrap_err();
    assert_eq!(error.code, "E_CURSOR_INDEX");
}
