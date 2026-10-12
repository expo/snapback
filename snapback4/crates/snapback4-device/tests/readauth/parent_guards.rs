//! A read-rule disjunct whose row columns the scan pins (`exists
//! boards[.board, owner = viewer]` under `.board = board`) decides the page
//! for a caller it admits, as a readable grant does (LLP 3000.036 §16.3): the
//! server walks the board owner's page once and answers `complete: true`, and
//! a search `exists` over it may answer `false`. The decision reads only rows
//! the caller may read, so rows hidden from a caller never change their
//! answer, and a parent its holders cannot read decides nothing. Devices keep
//! no such path: a union read rule cannot sync (`E_SYNC`), so both device
//! stores answer the online-only page unknown and the client asks the server.
use super::*;
use snapback4_core::{Value, value::object};

const PARENTS: &str = "table boards:
  owner: principal
  immutable owner
  read <- allow
  sync public
table cards:
  board: boards
  author: principal
  immutable board, author
  read <- .author = viewer or exists boards[.board, owner = viewer]
  online only
table vaults:
  owner: principal
  immutable owner
  read <- deny
  online only
table notes:
  vault: vaults
  author: principal
  immutable vault, author
  read <- .author = viewer or exists vaults[.vault, owner = viewer]
  online only
query boardCards(board: boards, c: cursor ?):
  return cards where .board = board first 50 by .id after c
query guarded(board: boards, c: cursor ?):
  if exists boards[board, owner = viewer]:
    return cards where .board = board first 50 by .id after c
  return cards where .board = board and .author = viewer first 50 by .id after c
query anyCard(board: boards, c: cursor ?):
  return exists cards where .board = board
query vaultNotes(vault: vaults, c: cursor ?):
  return notes where .vault = vault first 50 by .id after c
";

const OPS: [&str; 3] = ["boardCards", "guarded", "anyCard"];

#[derive(Debug, PartialEq)]
struct Answer { data: Json, complete: bool, unavailable: bool }

fn row(table: &str, fields: Vec<(&str, Value)>) -> (String, Value) { (table.into(), object(fields)) }

/// Board `b1` (olga's) with ann's card, plus bo's card when `more`; board `b2`
/// (olga's) is empty; vault `v1` (olga's, unreadable) holds ann's note.
fn seeded(more: bool) -> (Engine, snapback4_device::device::Backend) {
    let (mut engine, backend) = compile(PARENTS);
    let mut rows = vec![
        row("boards", vec![("id", id("b1")), ("owner", id("olga"))]),
        row("boards", vec![("id", id("b2")), ("owner", id("olga"))]),
        row("cards", vec![("id", id("c1")), ("board", id("b1")), ("author", id("ann"))]),
        row("vaults", vec![("id", id("v1")), ("owner", id("olga"))]),
        row("notes", vec![("id", id("n1")), ("vault", id("v1")), ("author", id("ann"))]),
    ];
    if more { rows.push(row("cards", vec![("id", id("c2")), ("board", id("b1")), ("author", id("bo"))])); }
    engine.seed(rows).unwrap();
    (engine, backend)
}

fn server(engine: &mut Engine, op: &str, viewer: &str, board: &str) -> Answer {
    let key = if op == "vaultNotes" { "vault" } else { "board" };
    let o = engine.query(op, context(viewer, &[(key, id(board)), ("c", Value::Null)]).at(10)).unwrap();
    Answer { data: wire::to_json(&o.data), complete: o.complete, unavailable: o.unavailable }
}

fn ids(answer: &Answer) -> Vec<String> {
    answer.data.as_array().map(|rows| rows.iter().map(|r| r["id"].as_str().unwrap().to_owned()).collect()).unwrap_or_default()
}

#[test]
fn the_parent_owner_reads_a_decided_page_and_everyone_else_is_unchanged() {
    let (mut engine, _) = seeded(true);
    // olga owns b1: every card, complete, decided once (guarded or not).
    for op in ["boardCards", "guarded"] {
        let olga = server(&mut engine, op, "olga", "b1");
        assert_eq!((ids(&olga), olga.complete), (vec!["c1".to_owned(), "c2".to_owned()], true), "{op}: {olga:?}");
    }
    // ann is an author, not the owner: her own card; the unguarded page cannot
    // prove "no more", the guarded arm pins her and is complete.
    assert_eq!((ids(&server(&mut engine, "boardCards", "ann", "b1")), server(&mut engine, "boardCards", "ann", "b1").complete), (vec!["c1".to_owned()], false));
    assert_eq!((ids(&server(&mut engine, "guarded", "ann", "b1")), server(&mut engine, "guarded", "ann", "b1").complete), (vec!["c1".to_owned()], true));
    // A search `exists` over a decided scan proves absence too.
    assert_eq!(server(&mut engine, "anyCard", "olga", "b1"), Answer { data: json!(true), complete: true, unavailable: false });
    assert_eq!(server(&mut engine, "anyCard", "olga", "b2"), Answer { data: json!(false), complete: true, unavailable: false });
    assert_eq!(server(&mut engine, "anyCard", "ann", "b1"), Answer { data: json!(true), complete: false, unavailable: false });
    assert_eq!(server(&mut engine, "anyCard", "ann", "b2"), Answer { data: Json::Null, complete: false, unavailable: true });
    // A parent its owner cannot read decides nothing: every row, capped.
    let olga = server(&mut engine, "vaultNotes", "olga", "v1");
    assert_eq!((ids(&olga), olga.complete), (vec!["n1".to_owned()], false), "{olga:?}");
}

#[test]
fn rows_a_caller_cannot_read_never_change_their_answer() {
    // bo's card is hidden from ann (and from zed, who reads nothing).
    let (mut with, _) = seeded(true);
    let (mut without, _) = seeded(false);
    for viewer in ["ann", "zed"] {
        for op in OPS {
            for board in ["b1", "b2"] {
                assert_eq!(server(&mut with, op, viewer, board), server(&mut without, op, viewer, board), "{viewer} {op} {board}");
            }
        }
        assert_eq!(server(&mut with, "vaultNotes", viewer, "v1"), server(&mut without, "vaultNotes", viewer, "v1"), "{viewer}");
    }
}

fn devices_ask_the_server<H: Host>(host: &mut H, viewer: &str) {
    let (mut engine, backend) = seeded(true);
    let mut device = host.open(viewer, Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, viewer, 100).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    for op in OPS {
        for board in ["b1", "b2"] {
            let (local, unknown, _) = device.query_with_coverage(op, viewer, &json!({"board": board, "c": null}), 10);
            let local = local.unwrap();
            let label = format!("{} {viewer} {op} {board}", host.label());
            // The cards are online only: the device decides nothing, whatever
            // the server's verdict, so the client takes the server's answer.
            assert!(unknown && !local.complete, "{label}: {local:?}");
            let s = server(&mut engine, op, viewer, board);
            // Never `true` or rows where the server has none.
            if wire::to_json(&local.data) == json!(true) { assert_eq!(s.data, json!(true), "{label}"); }
            for row in local.data.as_array().into_iter().flatten() {
                assert!(s.data.as_array().is_some_and(|rows| rows.contains(&wire::to_json(row))), "{label}: {local:?} / {s:?}");
            }
        }
    }
    host.close(viewer, device);
}

#[test]
fn both_device_stores_leave_the_decided_page_to_the_server() {
    for viewer in ["olga", "ann"] {
        devices_ask_the_server(&mut Memory::new(), viewer);
        devices_ask_the_server(&mut Sqlite::new(&format!("parent-guards-{viewer}")), viewer);
    }
}
