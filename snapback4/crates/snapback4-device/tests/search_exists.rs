//! A search `exists` over a per-row read rule (LLP 3000.036 §15.11): a row
//! the caller may read proves presence (`true`); with no readable match the
//! server cannot prove absence (no value, never `false`); a domain the scan
//! decides answers `false`. Hidden rows never change the answer, and a device
//! never answers `true` where the server does not.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Engine, Value, value::object};

const SOURCE: &str = r#"
table applications:
  owner: principal
  status: enum('draft', 'submitted')
  read <- .owner = viewer
  online only
table drafts:
  owner: principal
  status: enum('draft', 'submitted')
  read <- .owner = viewer
  sync to .owner
table notices:
  status: enum('draft', 'submitted')
  read <- allow
  sync public
query plain():
  return exists applications where .status = 'submitted'
query residual():
  return exists applications where .status != 'draft'
query among():
  return exists applications where .status in ['submitted']
query nested():
  return { submitted: exists applications where .status = 'submitted', n: 1 }
query pinned():
  return exists applications where .owner = viewer and .status = 'submitted'
query held():
  return exists drafts where .status = 'submitted'
query public():
  return exists notices where .status = 'submitted'
"#;
const SEARCHES: [&str; 4] = ["plain", "residual", "among", "nested"];

#[derive(Debug, PartialEq)]
struct Answer { data: Value, complete: bool, unavailable: bool }

fn row(table: &str, id_: &str, owner: Option<&str>, status: &str) -> (String, Value) {
    let mut fields = vec![("id", id(id_)), ("status", Value::String(status.into()))];
    if let Some(owner) = owner { fields.push(("owner", id(owner))); }
    (table.into(), object(fields))
}

/// `submitted` by amy in every table except `notices`, which stays empty.
fn seeded(amy_submitted: bool) -> (Engine, snapback4_device::device::Backend) {
    let (mut engine, backend) = compile(SOURCE);
    let status = if amy_submitted { "submitted" } else { "draft" };
    engine.seed([row("applications", "a1", Some("amy"), status), row("drafts", "d1", Some("amy"), status)]).unwrap();
    (engine, backend)
}

fn server(engine: &mut Engine, op: &str, viewer: &str) -> Answer {
    let o = engine.query(op, context(viewer, &[]).at(10)).unwrap();
    Answer { data: o.data, complete: o.complete, unavailable: o.unavailable }
}

fn exists(data: &Value, op: &str) -> Value {
    if op == "nested" && *data != Value::Null { data.field("submitted").unwrap().clone() } else { data.clone() }
}

#[test]
fn the_server_answers_a_visible_match_true_and_a_hidden_only_match_unavailable() {
    let (mut engine, _) = seeded(true);
    for op in SEARCHES {
        // amy reads her own row: presence is proven. The scan still cannot
        // prove the page complete, so the answer stays `complete: false`.
        let amy = server(&mut engine, op, "amy");
        assert_eq!(exists(&amy.data, op), Value::Bool(true), "{op}: {amy:?}");
        assert!(!amy.complete && !amy.unavailable, "{op}: {amy:?}");
        if op == "nested" { assert_eq!(amy.data.field("n").unwrap(), &Value::Int(1)); }
        // bob's only match is amy's row: no value, never `false`.
        let bob = server(&mut engine, op, "bob");
        assert_eq!(bob, Answer { data: Value::Null, complete: false, unavailable: true }, "{op}");
    }
    // A domain the scan decides (the owner pinned) proves absence.
    assert_eq!(server(&mut engine, "pinned", "amy"), Answer { data: Value::Bool(true), complete: true, unavailable: false });
    assert_eq!(server(&mut engine, "pinned", "bob"), Answer { data: Value::Bool(false), complete: true, unavailable: false });
    assert_eq!(server(&mut engine, "public", "bob"), Answer { data: Value::Bool(false), complete: true, unavailable: false });
}

#[test]
fn hidden_rows_never_change_the_answer() {
    // bob's answers are the same whether amy's hidden row matches or not,
    // and amy's answer without a readable match does not see bob's state.
    let (mut with, _) = seeded(true);
    let (mut without, _) = seeded(false);
    for op in SEARCHES.into_iter().chain(["pinned", "held", "public"]) {
        assert_eq!(server(&mut with, op, "bob"), server(&mut without, op, "bob"), "{op}");
    }
    for op in SEARCHES {
        assert_eq!(server(&mut without, op, "amy"), Answer { data: Value::Null, complete: false, unavailable: true }, "{op}");
    }
    assert_eq!(server(&mut without, "pinned", "amy").data, Value::Bool(false));
}

fn device_agrees<H: Host>(host: &mut H, viewer: &str, amy_submitted: bool) {
    let (mut engine, backend) = seeded(amy_submitted);
    let mut device = host.open(viewer, Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, viewer, 100).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    for op in SEARCHES.into_iter().chain(["pinned", "held", "public"]) {
        let s = server(&mut engine, op, viewer);
        let (local, unknown, _) = device.query_with_coverage(op, viewer, &json!({}), 10);
        let local = local.unwrap();
        let label = format!("{} {viewer} {op} (amy submitted: {amy_submitted})", host.label());
        // Never `true` where the server is not.
        if exists(&local.data, op) == Value::Bool(true) { assert_eq!(exists(&s.data, op), Value::Bool(true), "{label}: {s:?} / {local:?}"); }
        match op {
            // Online only: the device holds no partition and answers unknown,
            // whatever the server knows; the client asks the server.
            "plain" | "residual" | "among" | "nested" | "pinned" => {
                assert!(unknown && !local.complete && local.unavailable && local.data == Value::Null, "{label}: {local:?}");
            }
            // The viewer's held partition is exactly what it may read: a held
            // match is `true`, and its absence is certified on the device
            // (the server, which cannot tell hidden rows from none, has no value).
            "held" => {
                let mine = viewer == "amy" && amy_submitted;
                assert!(!unknown && local.complete && local.data == Value::Bool(mine), "{label}: {local:?}");
                assert_eq!(s.data, if mine { Value::Bool(true) } else { Value::Null }, "{label}");
            }
            _ => {
                assert!(!unknown && local.complete && local.data == Value::Bool(false), "{label}: {local:?}");
                assert_eq!(s, Answer { data: Value::Bool(false), complete: true, unavailable: false }, "{label}");
            }
        }
    }
    host.close(viewer, device);
}

#[test]
fn both_device_stores_keep_unknown_and_held_answers() {
    for viewer in ["amy", "bob"] {
        for submitted in [true, false] {
            device_agrees(&mut Memory::new(), viewer, submitted);
            device_agrees(&mut Sqlite::new(&format!("search-exists-{viewer}-{submitted}")), viewer, submitted);
        }
    }
}
