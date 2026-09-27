use snapback4_core::{Context, Engine, Value};
use snapback4_core::value::object;
use std::collections::BTreeMap;

fn source() -> String {
    let table = |name, rule| format!("table {name}:\n  owner: principal\n  at: time\n  body: text <=500\n  by byOwnerTime: owner, at, id\n  cap 100\n  read <- {rule}\n");
    format!("{}{}query page(c: cursor ?):\n  return merge inbox after c last 2 by byOwnerTime:\n    [viewer]\n    shared[viewer]\n", table("inbox", ".owner = viewer"), table("shared", "allow"))
}

#[test]
fn named_table_merge_pages_both_sources_and_keeps_cursor_scope() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed((0..6).map(|n| (if n % 2 == 0 { "inbox" } else { "shared" }.into(), object([("id", Value::Id(format!("r{n}"))), ("owner", Value::Id("dev:a".into())), ("at", Value::Int(n / 2)), ("body", Value::String(format!("row {n}")))])))).unwrap();
    let mut cursor = None;
    let mut ids = Vec::new();
    loop {
        let page = engine.query("page", Context::new("dev:a", BTreeMap::from([("c".into(), cursor.clone().map(Value::String).unwrap_or(Value::Null))]))).unwrap();
        assert!(page.complete);
        ids.extend(page.data.as_array().unwrap().iter().map(|v| v.field("id").unwrap().as_str().unwrap().to_owned()));
        match page.next { Some(next) => cursor = Some(next), None => break }
    }
    assert_eq!(ids, ["r5", "r4", "r3", "r2", "r1", "r0"]);
    let mut position = snapback4_core::cursor::decode_cursor(engine.schema(), cursor.as_deref().unwrap()).unwrap();
    position.table = "shared".into();
    let foreign = snapback4_core::cursor::encode_cursor(engine.schema(), &position).unwrap();
    assert!(engine.query("page", Context::new("dev:nobody", BTreeMap::from([("c".into(), Value::String(foreign))]))).is_err(), "empty lanes cannot accept a foreign cursor");
}

#[test]
fn named_table_merge_requires_the_same_columns_and_index() {
    for bad in [source().replacen("  body: text <=500", "  body: int", 1), source().replacen("owner, at, id", "owner, id, at", 1), source().replace("    [viewer]", "    shared[viewer]")] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), bad)]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "{:?}", bound.diagnostics);
    }
}

#[test]
fn whole_table_cap_is_enforced_across_different_owners() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "table items:\n  owner: principal\n  cap 2\n  public 'bounded public items'\n  sync public\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, []).unwrap();
    let row = |n| ("items".into(), object([("id", Value::Id(format!("r{n}"))), ("owner", Value::Id(format!("dev:{n}")))]));
    assert_eq!(engine.seed([row(0), row(1)]).unwrap(), 2);
    assert_eq!(engine.seed([row(2)]).unwrap_err().code(), "E_CONSTRAINT");
    assert_eq!(engine.snapshot("dev:reader").unwrap().0.len(), 2);
}

fn filtered_merges(surface: bool) {
    use snapback4_core::ir::{Expr, Stmt};
    for cross in [false, true] {
        let predicate = "not exists removed[eventId = .id]";
        let mut source = source().replace("read <- .owner = viewer", "read <- allow");
        if !cross { source = source.replace("shared[viewer]", "['dev:b']"); }
        if surface { source = source.replace("last 2 by byOwnerTime:", &format!("last 2 by byOwnerTime where {predicate}:")); }
        source.push_str(&format!("table removed:\n  eventId: id\n  unique byEvent: eventId\n  public 'tombstones'\nquery predicate(c: cursor ?):\n  return inbox[viewer] after c first 1 by byOwnerTime where {predicate}\n"));
        let mut bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert!(bound.notes.is_empty(), "{:?}", bound.notes);
        if !surface {
            // Exercise the existing engine before the merge-header syntax is
            // admitted: copy an already compiled scan predicate into its lanes.
            let scan = snapback4_core::ir::scans(&bound.programs.iter().find(|p| p.program.name == "predicate").unwrap().program)[0].clone();
            let program = &mut bound.programs.iter_mut().find(|p| p.program.name == "page").unwrap().program;
            let Stmt::Return(Expr::Merge(merge)) = program.body.last_mut().unwrap() else { panic!("direct merge return") };
            for lane in &mut merge.lanes { lane.scan.filter = scan.filter.clone(); }
        }
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let mut rows = (0..12).map(|n| (if cross && n % 2 == 1 { "shared" } else { "inbox" }.into(), object([
            ("id", Value::Id(format!("r{n:02}"))), ("owner", Value::Id(if !cross && n % 2 == 1 { "dev:b" } else { "dev:a" }.into())),
            ("at", Value::Int(n)), ("body", Value::String(format!("BODY-{n:02}"))),
        ]))).collect::<Vec<_>>();
        rows.extend((2..10).map(|n| ("removed".into(), object([("id", Value::Id(format!("t{n}"))), ("eventId", Value::Id(format!("r{n:02}")))]))));
        engine.seed(rows).unwrap();
        let query_context = |cursor: Option<String>| Context::new("dev:a", BTreeMap::from([("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))])).at(300);
        let full = engine.query("page", query_context(None)).unwrap();
        assert!(full.complete);
        assert_eq!(full.data.as_array().unwrap().len(), 2);
        let mut checked_partial = false;
        for ceiling in 1..=full.metered.examined {
            engine.set_ceilings(snapback4_core::Ceilings { examined: ceiling, ..Default::default() });
            let page = engine.query("page", query_context(None)).unwrap();
            for row in page.data.as_array().unwrap() { assert!(!(2..10).contains(&row.field("at").unwrap().as_int().unwrap())); }
            if page.capped_at.is_some() { assert!(!page.complete); assert!(page.next.is_none()); checked_partial |= !page.data.as_array().unwrap().is_empty(); }
        }
        assert!(checked_partial, "a cut can retain already checked live entries");
        engine.set_ceilings(Default::default());
        let mut cursor = None;
        let mut ids = Vec::new();
        for _ in 0..4 {
            let page = engine.query("page", query_context(cursor)).unwrap();
            assert!(page.complete);
            ids.extend(page.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()));
            cursor = page.next;
            if cursor.is_none() { break; }
        }
        assert!(cursor.is_none());
        assert_eq!(ids, ["r11", "r10", "r01", "r00"]);
        println!("FILTERED_MERGE surface={surface} cross={cross} uncut_examined={} full_rows=2 continued_live_rows=4", full.metered.examined);
    }
}

#[test]
fn filtered_merge_engine_withholds_cut_predicates() { filtered_merges(false); }

#[test]
fn filtered_merge_header_admits_metered_predicates() { filtered_merges(true); }

#[test]
fn filtered_merge_without_cursor_is_complete_at_its_bound() {
    let source = source().replace("after c last 2 by byOwnerTime:", "last 2 by byOwnerTime where .body != '':");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.iter().any(|note| note.code == "N_NO_CURSOR"));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed((0..3).map(|n| ("inbox".into(), object([("id", Value::Id(format!("r{n}"))), ("owner", Value::Id("dev:a".into())), ("at", Value::Int(n)), ("body", Value::String("live".into()))])))).unwrap();
    let page = engine.query("page", Context::new("dev:a", Default::default())).unwrap();
    assert_eq!(page.data.as_array().unwrap().len(), 2);
    assert!(page.complete);
    assert!(page.next.is_none());
    assert!(page.capped_at.is_none());
}

#[test]
fn filtered_matching_merge_uses_the_same_predicate_and_bool_check() {
    let source = "table items:\n  owner: principal\n  body: text <=50\n  by byWords: owner, words(body), id\n  read <- .owner = viewer\nquery page(c: cursor ?):\n  return merge items matching 'hello' after c first 1 by byWords where .body != 'hello removed':\n    [viewer]\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(["hello removed", "hello live"].into_iter().enumerate().map(|(n, body)| ("items".into(), object([("id", Value::Id(format!("r{n}"))), ("owner", Value::Id("dev:a".into())), ("body", Value::String(body.into()))])))).unwrap();
    let page = engine.query("page", Context::new("dev:a", Default::default())).unwrap();
    assert!(page.complete);
    assert_eq!(page.data.as_array().unwrap()[0].field("body").unwrap(), &Value::String("hello live".into()));
    let bad = snapback4_lang::compile(&[("schema.q".into(), source.replace(".body != 'hello removed'", ".body"))]);
    assert!(bad.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.message.starts_with("where needs a bool predicate")));
}

#[test]
fn w13h_only_canonical_returned_shapes_are_marked_and_round_trip() {
    let table = "table msgs:\n  lane: int\n  by byLane: lane, id\n  public 'fixture'\n  sync public\n";
    let read = "msgs[0] after c first 1 by byLane";
    let shape = "{ id }";
    for (tail, marked) in [
        (format!("  return {read} {shape}"), true),
        (format!("  page = {read}\n  return page {shape}"), true),
        (format!("  page = {read}\n  alias = page\n  return alias {shape}"), false),
        (format!("  page = {read}\n  ignored = page\n  return page {shape}"), false),
        (format!("  page = {read}\n  page = {read}\n  return page {shape}"), false),
        (format!("  page = {read}\n  return page {{ id, raw: page }}"), false),
        (format!("  page = {read} {shape}\n  return page"), false),
        (format!("  return {{ page: {read} {shape} }}"), false),
        (format!("  return {read} {shape} if viewer = 'dev:a' else []"), false),
        (format!("  if viewer = 'dev:a':\n    return {read} {shape}\n  return []"), false),
        (format!("  bag = []\n  for i in range(0, 1):\n    bag = bag + [{read} {shape}]\n  return bag"), false),
    ] {
        let source = format!("{table}query feed(c: cursor ?):\n{tail}\n");
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{tail}: {:?}", bound.diagnostics);
        let program = &bound.programs[0].program;
        assert_eq!(program.returned_shapes.len(), usize::from(marked), "{tail}");
        let json = serde_json::to_string(program).unwrap();
        assert_eq!(json.contains("\"returned_shapes\""), marked, "unmarked IR has no new serialized field: {tail}");
        assert_eq!(*program, serde_json::from_str(&json).unwrap());
    }
    let source = format!("{table}fn shaped(c: cursor ?):\n  return {read} {shape}\nquery feed(c: cursor ?):\n  return shaped(c)\n");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.programs[0].program.returned_shapes.is_empty(), "a helper's shape is not the query's returned shape expression");
}
