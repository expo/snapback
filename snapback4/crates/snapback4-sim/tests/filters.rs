//! Disclosure and progress at a filtered page's meter boundary (LLP 3000.007 §5.6).
use snapback4_core::{Context, Engine, Value};
use snapback4_core::cursor::decode_cursor;
use snapback4_core::meter::Ceilings;
use snapback4_core::value::object;
use std::collections::BTreeMap;

fn fixture(rule: &str, predicate: &str, take: u32, examined: u64) -> Engine {
    fixture_with_cursor(rule, predicate, take, examined, true)
}
fn fixture_with_cursor(rule: &str, predicate: &str, take: u32, examined: u64, cursor: bool) -> Engine {
    let after = if cursor { " after c" } else { "" };
    let source = format!("table items:\n  n: int\n  owner: principal\n  by byN: n, id\n  read <- {rule}\nquery page(c: cursor ?):\n  return items[]{after} first {take} by byN where {predicate}\n");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"), rule != "allow");
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.set_ceilings(Ceilings { examined, ..Ceilings::default() });
    engine
}

fn seed(engine: &mut Engine, count: i64, hidden: impl Fn(i64) -> bool) {
    engine.seed((0..count).map(|n| ("items".into(), object([("id", Value::Id(format!("r{n:03}"))), ("n", Value::Int(n)), ("owner", Value::Id(if hidden(n) { "dev:bob" } else { "dev:alice" }.into()))])))).unwrap();
}
fn context(cursor: Option<&str>) -> Context {
    Context::new("dev:alice", cursor.map(|c| BTreeMap::from([("c".into(), Value::String(c.into()))])).unwrap_or_default()).at(1)
}

#[test]
fn uniform_filtered_pages_advance_past_more_rejections_than_the_ceiling() {
    // n is indexed; a true test that reads the row (never hoisted out of the page) keeps this a filter, not a seek.
    let mut engine = fixture("allow", ".n >= 23 and .owner != 'dev:nobody'", 2, 7);
    seed(&mut engine, 27, |_| false);
    let mut cursor = None;
    let mut matched = Vec::new();
    let mut positions = Vec::new();
    let mut capped = 0;
    for _ in 0..10 {
        let page = engine.query("page", context(cursor.as_deref())).unwrap();
        if !page.complete { capped += 1; assert!(page.capped_at.is_some()); }
        matched.extend(page.data.as_array().unwrap().iter().map(|r| r.field("n").unwrap().as_int().unwrap()));
        match page.next {
            Some(next) => {
                let position = decode_cursor(engine.schema(), &next).unwrap().values[0].as_int().unwrap();
                if let Some(prior) = positions.last() { assert!(position > *prior); }
                positions.push(position);
                cursor = Some(next);
            }
            None => break,
        }
    }
    assert_eq!(matched, [23, 24, 25, 26]);
    assert_eq!(positions, [6, 13, 20, 24, 26]);
    assert_eq!(capped, 3);
}

#[test]
fn no_cursor_discloses_a_hidden_key_and_a_hidden_run_ends_empty() {
    let mut engine = fixture(".owner = viewer", ".n % 4 = 0", 2, 5);
    seed(&mut engine, 30, |n| n % 2 == 1 || n >= 18);
    let mut cursor = None;
    let mut count = 0;
    let mut last = -1;
    for _ in 0..15 {
        let page = engine.query("page", context(cursor.as_deref())).unwrap();
        assert!(!page.complete, "a non-uniform prefix never claims completeness");
        for row in page.data.as_array().unwrap() { assert_eq!(row.field("owner").unwrap(), &Value::Id("dev:alice".into())); }
        match page.next {
            Some(next) => {
                let decoded = decode_cursor(engine.schema(), &next).unwrap();
                let n = decoded.values[0].as_int().unwrap();
                assert!(n % 2 == 0 && n < 18, "hidden key in {decoded:?}");
                assert_eq!(decoded.values[1], Value::Id(format!("r{n:03}")));
                assert!(n > last);
                last = n;
                count += 1;
                cursor = Some(next);
            }
            None => { assert!(page.data.as_array().unwrap().is_empty()); assert!(page.capped_at.is_none(), "hidden tail does not spend the caller's allowance"); break; }
        }
    }
    assert_eq!(count, 3, "only readable filter candidates consume the examined budget");
    assert_eq!(last, 16);
}

#[test]
fn a_filled_page_positions_after_its_last_returned_row() {
    let mut engine = fixture("allow", ".n % 3 = 0", 2, 7);
    seed(&mut engine, 15, |_| false);
    let page = engine.query("page", context(None)).unwrap();
    assert!(page.complete);
    let last = page.data.as_array().unwrap().last().unwrap();
    assert_eq!(last.field("n").unwrap(), &Value::Int(3));
    let decoded = decode_cursor(engine.schema(), page.next.as_deref().unwrap()).unwrap();
    assert_eq!(decoded.values, [Value::Int(3), Value::Id("r003".into())]);
    assert_eq!(page.metered.examined, 4);
}

#[test]
fn a_filled_uniform_filter_is_complete_without_a_cursor_too() {
    let mut engine = fixture_with_cursor("allow", ".n % 3 = 0", 2, 7, false);
    seed(&mut engine, 15, |_| false);
    let page = engine.query("page", context(None)).unwrap();
    assert!(page.complete, "N matches satisfy the filtered page even without a cursor: {page:?}");
    assert_eq!(page.data.as_array().unwrap().len(), 2);
    assert_eq!(page.metered.examined, 4);
    assert!(page.next.is_none());
}

#[test]
fn predicate_probe_cut_withholds_row_and_direct_cursor_uses_its_visible_key() {
    let source = "table items:\n  owner: principal\n  body: text <=50\n  by byOwner: owner, id\n  read <- .owner = viewer\ntable removed:\n  eventId: id\n  unique byEvent: eventId\n  public 'tombstones'\nquery page(c: cursor ?):\n  return items[viewer] after c first 2 by byOwner where not exists removed[eventId = .id]\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed((0..3).map(|n| ("items".into(), object([("id", Value::Id(format!("r{n}"))), ("owner", Value::Id("dev:alice".into())), ("body", Value::String(format!("BODY-{n}")))])))).unwrap();
    engine.seed([("removed".into(), object([("id", Value::Id("marker".into())), ("eventId", Value::Id("r1".into()))]))]).unwrap();
    engine.set_ceilings(Ceilings { examined: 3, ..Default::default() });
    let page = engine.query("page", context(None)).unwrap();
    assert!(!page.complete);
    assert_eq!(page.metered.examined, 4);
    assert_eq!(page.data.as_array().unwrap().len(), 1);
    assert_eq!(page.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("r0".into()));
    let cursor = page.next.unwrap();
    let position = decode_cursor(engine.schema(), &cursor).unwrap();
    assert_eq!(position.values, [Value::Id("r1".into())]);
    // @ref LLP 3000.007#20.24.1 — an interrupted tombstone predicate must
    // finish before rejecting its row; the same small budget then cuts at r2.
    assert!(position.inclusive);
    let tail = engine.query("page", context(Some(&cursor))).unwrap();
    assert!(!tail.complete && tail.data.as_array().unwrap().is_empty());
    let cursor = tail.next.unwrap();
    let position = decode_cursor(engine.schema(), &cursor).unwrap();
    assert_eq!(position.values, [Value::Id("r2".into())]);
    assert!(position.inclusive);
    let end = engine.query("page", context(Some(&cursor))).unwrap();
    assert!(end.complete && end.next.is_none());
    assert_eq!(end.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("r2".into()));
}
