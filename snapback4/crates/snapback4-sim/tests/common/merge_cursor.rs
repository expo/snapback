//! Shared merge boundary fixtures, compiled on the server and both device stores.
#![allow(dead_code)]
use snapback4_core::{Context, Value, engine::QueryOutcome, value::object, wire};
use std::collections::BTreeMap;

pub const CEILING: usize = 8_192;

pub fn source(cross_table: bool, uniform: bool) -> String {
    let rule = if uniform { "  public 'feed entries'\n  sync public" } else { "  read <- .owner = viewer\n  online only" };
    let table = |name| format!("table {name}:\n  lane: text <=1\n  at: int\n  owner: principal\n  by byLane: lane, at, id\n{rule}\n");
    let second = if cross_table { "b['b']" } else { "['b']" };
    format!("{}{}\nquery feed(c: cursor ?):\n  return merge a after c last 1 by byLane:\n    ['a']\n    {second}\n", table("a"), if cross_table { table("b") } else { String::new() })
}

pub fn bound(source: &str) -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

pub fn expiring_source(cross: bool) -> String {
    source(cross, true).replace("  owner: principal", "  owner: principal\n  until: time ?\n  by byExpiry: until\n  expire at .until")
}

pub fn expired_seed(cross: bool) -> Vec<(String, Value)> {
    seed(cross, CEILING + 1, Some(15)).into_iter().map(|(table, row)| {
        let until = if row.field("owner").unwrap().as_str().unwrap() == "bob" { Value::Int(1) } else { Value::Null };
        let mut fields = row.as_object().unwrap().clone();
        fields.insert("until".into(), until);
        (table, Value::Row(fields.into()))
    }).collect()
}

pub fn row(name: &str, lane: &str, at: i64, owner: &str) -> Value {
    object([("id", Value::Id(name.into())), ("lane", Value::String(lane.into())), ("at", Value::Int(at)), ("owner", Value::Id(owner.into()))])
}

pub fn seed(cross_table: bool, hidden: usize, competing: Option<i64>) -> Vec<(String, Value)> {
    let second = if cross_table { "b" } else { "a" };
    let mut rows = vec![("a".into(), row("shown-10", "a", 10, "alice"))];
    if let Some(at) = competing { rows.push((second.into(), row("competing", "b", at, "alice"))); }
    rows.extend((0..hidden).map(|n| (second.into(), row(&format!("hidden-{n}"), "b", 21 + n as i64, "bob"))));
    rows
}

pub fn context(cursor: Option<String>) -> Context {
    Context::new("alice", BTreeMap::from([("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))])).at(100_000)
}

pub fn ids(page: &QueryOutcome) -> Vec<String> {
    page.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()).collect()
}

pub fn check_cut(mut query: impl FnMut(Option<String>) -> QueryOutcome) {
    let first = query(None);
    assert_eq!(ids(&first), ["shown-10"]);
    assert!(!first.complete);
    assert_eq!(first.metered.examined, CEILING as u64 + 1);
    println!("merge cut: examined={} complete={} next={:?}", first.metered.examined, first.complete, first.next);
    if let Some(next) = first.next.clone() {
        let second = query(Some(next));
        assert_eq!(ids(&second), ["competing"], "continuation skipped readable time 15 forever: {second:?}");
    }
    assert!(first.next.is_none(), "the shared cursor cannot represent the unfinished second lane");
}

// The full /q response in serve.rs, including explicit nulls; operator-only
// meters and cut sites are deliberately absent from that viewer boundary.
pub fn server_wire(page: &QueryOutcome) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({"complete":page.complete,"data":wire::to_json(&page.data),"next":page.next,"nextExpiry":page.next_expiry,"seq":page.seq,"tables":page.tables,"viewer":"alice"})).unwrap()
}

pub fn equal_rows(cross_table: bool) -> Vec<(String, Value)> {
    let second = if cross_table { "b" } else { "a" };
    let mut rows = vec![("a".into(), row("z", "a", 10, "alice")), (second.into(), row("y", "b", 10, "alice")), ("a".into(), row("x", "a", 10, "alice"))];
    if cross_table {
        // A projection copy keeps the same ID and ordering suffix.
        rows.push((second.into(), row("z", "b", 10, "alice")));
    }
    rows
}

pub fn check_equal(mut query: impl FnMut(Option<String>) -> QueryOutcome) {
    let mut cursor = None;
    for expected in ["z", "y", "x"] {
        let page = query(cursor);
        assert!(page.complete, "{page:?}");
        assert_eq!(ids(&page), [expected]);
        cursor = page.next;
        assert_eq!(cursor.is_some(), expected != "x");
    }
}

pub fn check_hidden(mut query: impl FnMut(Option<String>) -> QueryOutcome) {
    let first = query(None);
    assert_eq!(ids(&first), ["competing"], "authorization scans must reach the newest readable row through the hidden run");
    assert!(!first.complete);
    assert!(first.capped_at.is_none());
    assert_eq!(first.metered.examined, 2, "one fixed miss/candidate allowance per lane");
    assert!(first.next.is_none(), "non-uniform merge class still withholds continuation");
}
