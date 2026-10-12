//! LLP 3000.036.001 §7: a merged page runs the same plan on a device, over
//! both stores, with the existing per-scan coverage rules. Each test compares
//! the device's answer, walked to its end by cursor, with the server's.
mod common;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Value, value::object};

fn row(table: &str, fields: Vec<(&str, Value)>) -> (String, Value) { (table.to_owned(), object(fields)) }

/// Every page by cursor: ids, and whether each page was complete; the device
/// side also reports whether any page was unknown.
fn walk_server(engine: &mut snapback4_core::Engine, op: &str, viewer: &str, extra: &[(&str, Value)]) -> (Vec<String>, bool) {
    let mut cursor = Value::Null;
    let (mut ids, mut complete) = (Vec::new(), true);
    loop {
        let mut pairs: Vec<(&str, Value)> = extra.to_vec();
        pairs.push(("c", cursor.clone()));
        let out = engine.query(op, context(viewer, &pairs)).unwrap();
        ids.extend(out.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()));
        complete &= out.complete;
        match out.next { Some(next) => cursor = Value::String(next), None => return (ids, complete) }
    }
}

fn walk_device<S: snapback4_device::store::DeviceStore>(device: &mut snapback4_device::device::Device<S>, op: &str, viewer: &str, extra: Json) -> (Vec<String>, bool, bool) {
    let mut cursor = Json::Null;
    let (mut ids, mut complete, mut unknown) = (Vec::new(), true, false);
    loop {
        let mut args = extra.clone();
        args["c"] = cursor.clone();
        let (out, missing, _) = device.query_with_coverage(op, viewer, &args, 1_000);
        let out = out.unwrap();
        ids.extend(out.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()));
        complete &= out.complete;
        unknown |= missing;
        match out.next { Some(next) => cursor = Json::String(next), None => return (ids, complete, unknown) }
    }
}

const BOARDS: &str = "table members:
  board: int
  principal: principal
  unique board, principal
  read <- .principal = viewer
  insert <- deny
  sync to .principal

table cards:
  board: int
  at: int
  read <- exists members[.board, viewer]
  insert <- exists members[.board, viewer]
  sync to members[.board]

query two(a: int, b: int, c: cursor ?):
  return cards where .board = a or .board = b last 2 by .at after c
query one(a: int, c: cursor ?):
  return cards where .board = a last 2 by .at after c
";

fn boards<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(BOARDS);
    let bound = snapback4_lang::compile(&[("schema.q".into(), BOARDS.into())]);
    let two = bound.programs.iter().find(|p| p.program.name == "two").unwrap();
    assert!(snapback4_core::search_plan::merges(&two.program.body).iter().any(|m| m.branches()), "the page is a branch merge");
    let mut rows = vec![row("members", vec![("id", id("m1")), ("board", Value::Int(1)), ("principal", id("ann"))]),
        row("members", vec![("id", id("m2")), ("board", Value::Int(2)), ("principal", id("ann"))])];
    for n in 0..9i64 { rows.push(row("cards", vec![("id", id(&format!("c{n}"))), ("board", Value::Int(n % 3 + 1)), ("at", Value::Int(n))])); }
    engine.seed(rows).unwrap();
    let mut device = host.open("boards", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "ann", 4).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    host.close("boards", device);
    let mut device = host.open("boards", None).unwrap();
    // Two held groups: the device answers the server's rows, complete, without asking.
    let server = walk_server(&mut engine, "two", "ann", &[("a", Value::Int(1)), ("b", Value::Int(2))]);
    assert_eq!(server, (vec!["c7".into(), "c6".into(), "c4".into(), "c3".into(), "c1".into(), "c0".into()], true));
    let held = walk_device(&mut device, "two", "ann", json!({"a": 1, "b": 2}));
    assert_eq!((held.0.clone(), held.1, held.2), (server.0.clone(), true, false), "{}", host.label());
    // A group the caller is not in: the merged page's branch answers as the
    // direct page on that group does, on the server and on the device.
    let server = walk_server(&mut engine, "two", "ann", &[("a", Value::Int(1)), ("b", Value::Int(3))]);
    let direct = walk_device(&mut device, "one", "ann", json!({"a": 3}));
    let merged = walk_device(&mut device, "two", "ann", json!({"a": 1, "b": 3}));
    assert_eq!(server.0, vec!["c6", "c3", "c0"]);
    assert_eq!(merged.0, server.0, "{}", host.label());
    assert_eq!((merged.1, merged.2), (direct.1 && server.1, direct.2), "{}: the merge keeps the direct page's coverage", host.label());
}

#[test]
fn sqlite_branch_merge_over_held_groups() { boards(&mut Sqlite::new("branch-boards")); }
#[test]
fn memory_branch_merge_over_held_groups() { boards(&mut Memory::new()); }

const SEATS: &str = "table tickets:
  owner: principal
  at: int
  read <- .owner = viewer or viewer = 'service:audit'
  insert <- .owner = viewer
  sync to .owner

query tickets(c: cursor ?):
  return tickets last 2 by .at after c
";

/// A seat (`viewer = 'service:x'`) is decided on a device: the owner branch
/// reads the held partition and the page is complete there too.
fn seats<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(SEATS);
    let bound = snapback4_lang::compile(&[("schema.q".into(), SEATS.into())]);
    let p = bound.programs.iter().find(|p| p.program.name == "tickets").unwrap();
    assert!(snapback4_core::search_plan::merges(&p.program.body).iter().any(|m| m.branches() && m.lanes.iter().any(|l| l.grant())));
    let mut rows = Vec::new();
    for n in 0..7i64 { rows.push(row("tickets", vec![("id", id(&format!("k{n}"))), ("owner", id(if n % 2 == 0 { "ann" } else { "bob" })), ("at", Value::Int(n))])); }
    engine.seed(rows).unwrap();
    let mut device = host.open("seats", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "ann", 3).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let server = walk_server(&mut engine, "tickets", "ann", &[]);
    assert_eq!(server, (vec!["k6".into(), "k4".into(), "k2".into(), "k0".into()], true));
    let held = walk_device(&mut device, "tickets", "ann", json!({}));
    assert_eq!((held.0, held.1, held.2), (server.0, true, false), "{}", host.label());
    let audit = walk_server(&mut engine, "tickets", "service:audit", &[]);
    assert_eq!(audit.0.len(), 7);
    assert!(audit.1);
}

#[test]
fn sqlite_a_seat_branch_is_decided_on_a_device() { seats(&mut Sqlite::new("branch-seats")); }
#[test]
fn memory_a_seat_branch_is_decided_on_a_device() { seats(&mut Memory::new()); }

const ONLINE: &str = "table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  insert <- deny
  online only

table tickets:
  owner: principal
  helper: principal ?
  at: int
  read <- .owner = viewer or .helper = viewer or exists staff[viewer]
  insert <- .owner = viewer
  online only

query tickets(c: cursor ?):
  return tickets last 2 by .at after c
";

/// An online-only table and a role grant: the device does not answer either;
/// the read is unknown and the client asks the server (LLP 3000.028).
fn online<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(ONLINE);
    engine.seed(vec![row("tickets", vec![("id", id("k1")), ("owner", id("ann")), ("helper", Value::Null), ("at", Value::Int(1))])]).unwrap();
    let mut device = host.open("online", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "ann", 3).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let (out, unknown, _) = device.query_with_coverage("tickets", "ann", &json!({"c": null}), 1_000);
    let out = out.unwrap();
    assert!(unknown && !out.complete, "{}: {out:?}", host.label());
    let server = walk_server(&mut engine, "tickets", "ann", &[]);
    assert_eq!(server, (vec!["k1".into()], true));
}

#[test]
fn sqlite_online_branches_ask_the_server() { online(&mut Sqlite::new("branch-online")); }
#[test]
fn memory_online_branches_ask_the_server() { online(&mut Memory::new()); }

const OWNER_MEMBERSHIP: &str = "table memberships:
  parent: text <=40
  principal: principal
  unique parent, principal
  cap 16 by principal
  read <- .principal = viewer
  insert <- .principal = viewer and exists memberships[.parent, viewer]
  sync to .principal

table documents:
  owner: principal
  parent: text <=40
  at: int
  read <- .owner = viewer or exists memberships[.parent, viewer]
  insert <- .owner = viewer
  sync to .owner or memberships[.parent]

query documents(c: cursor ?):
  return documents last 2 by .at after c
";

// @ref LLP 3000.036.001#14 — acquired source and union target ranges run the same dynamic merge on both device stores.
fn owner_membership<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(OWNER_MEMBERSHIP);
    let bound = snapback4_lang::compile(&[("schema.q".into(), OWNER_MEMBERSHIP.into())]);
    let program = &bound.programs.iter().find(|p| p.program.name == "documents").unwrap().program;
    assert!(snapback4_core::ir::body_merges(&program.body).iter().any(|merge| merge.lanes.iter().any(|lane| lane.membership())));
    engine.seed(vec![
        row("memberships", vec![("id", id("m1")), ("parent", Value::String("p1".into())), ("principal", id("ann"))]),
        row("memberships", vec![("id", id("m2")), ("parent", Value::String("p2".into())), ("principal", id("ann"))]),
        row("documents", vec![("id", id("d1")), ("owner", id("ann")), ("parent", Value::String("p0".into())), ("at", Value::Int(1))]),
        row("documents", vec![("id", id("d2")), ("owner", id("bob")), ("parent", Value::String("p9".into())), ("at", Value::Int(2))]),
        row("documents", vec![("id", id("d3")), ("owner", id("ann")), ("parent", Value::String("p1".into())), ("at", Value::Int(3))]),
        row("documents", vec![("id", id("d4")), ("owner", id("bob")), ("parent", Value::String("p1".into())), ("at", Value::Int(4))]),
        row("documents", vec![("id", id("d5")), ("owner", id("bob")), ("parent", Value::String("p2".into())), ("at", Value::Int(5))]),
    ]).unwrap();
    let server = walk_server(&mut engine, "documents", "ann", &[]);
    assert_eq!(server, (vec!["d5".into(), "d4".into(), "d3".into(), "d1".into()], true));

    let mut missing = host.open("owner-membership-missing", Some(backend.clone())).unwrap();
    let (out, unknown, _) = missing.query_with_coverage("documents", "ann", &json!({"c": null}), 1_000);
    assert_eq!(out.unwrap_err().code, "E_PREDICT", "{}: {unknown}", host.label());

    let mut device = host.open("owner-membership", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "ann", 2).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let held = walk_device(&mut device, "documents", "ann", json!({}));
    assert_eq!((held.0, held.1, held.2), (server.0, true, false), "{}", host.label());
}

#[test]
fn sqlite_owner_membership_pages_use_acquired_groups() { owner_membership(&mut Sqlite::new("branch-owner-membership")); }
#[test]
fn memory_owner_membership_pages_use_acquired_groups() { owner_membership(&mut Memory::new()); }
