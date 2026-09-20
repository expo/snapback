use super::common::*;
use snapback4_core::value::{Value, object};

fn retained_words<H: Host>(mut host: H, existence: bool) {
    // A horizon-free page and a positive existence read under a horizon both
    // need the left-group verdict; neither enters horizon coverage in discovery.
    let horizon = if existence { " last 50 by byTime" } else { "" };
    let left = if existence { "exists (messages['left'] matching 'kx' by byWords)" }
        else { "messages['left'] matching 'kx' last 50 by byWords" };
    let source = format!("table members:\n  room: text <=40\n  principal: principal\n  unique byRoomPrincipal: room, principal\n  by byPrincipal: principal, room\n  read <- .principal = viewer\n  delete <- .principal = viewer\n  sync to .principal\ntable messages:\n  room: text <=40\n  body: text <=40\n  at: time\n  by byTime: room, at, id\n  by byWords: room, words(body), at, id\n  read <- exists members[.room, viewer]\n  retain delivered-history\n  sync to members[.room]{horizon}\ntable remote:\n  public 'server knowledge'\n  online only\nquery alone():\n  return {left}\nquery mixed():\n  return {{left: {left}, right: exists remote['right']}}\nmutation leave():\n  delete members[room = 'left', principal = viewer]\n");
    let (mut engine, backend) = compile(&source);
    let mut rows = vec![("members".into(), object([("id", id("member")), ("room", Value::String("left".into())), ("principal", id("alice"))])),
        ("remote".into(), object([("id", id("right"))]))];
    rows.extend((0..45).map(|n| ("messages".into(), object([("id", id(&format!("m{n:02}"))), ("room", Value::String("left".into())),
        ("body", Value::String(format!("kx{n:02}"))), ("at", Value::Int(n))]))));
    engine.seed(rows).unwrap();
    let mut device = host.open("retained-words", Some(backend)).unwrap();
    let pages = snapshot_pages(&mut engine, "alice", 100);
    for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let before = device.query("alone", "alice", &serde_json::json!({}), 100).unwrap();
    if existence { assert_eq!(before.data, Value::Bool(true)); }
    else { assert_eq!(before.data.as_array().unwrap().len(), 45); }
    let watermark = pages.last().unwrap().watermark;
    engine.mutate("leave", Some("leave"), context("alice", &[])).unwrap();
    device.apply(&stream_page(&mut engine, "alice", watermark), false).unwrap();
    let (answer, unknown, retained) = device.query_with_coverage("alone", "alice", &serde_json::json!({}), 100);
    let answer = answer.unwrap();
    assert_eq!(answer.data, before.data, "leave keeps the rows actually acquired");
    assert!(!unknown && retained, "the scope is retained, independently of horizon or positive existence");
    let (answer, unknown, retained, components) = device.query_with_components("mixed", "alice", &serde_json::json!({}), 100);
    assert_eq!(answer.unwrap().data.field("left").unwrap(), &before.data);
    assert!(unknown && !retained, "the right component needs server knowledge");
    assert!(components["left"].retained && !components["left"].unknown);
    assert!(components["right"].unknown && !components["right"].retained);
    let server = engine.query("mixed", context("alice", &[]).at(100)).unwrap();
    assert_eq!(server.data.field("right").unwrap(), &Value::Bool(true));
    if existence { assert_eq!(server.data.field("left").unwrap(), &Value::Bool(false)); }
    else { assert!(server.data.field("left").unwrap().as_array().unwrap().is_empty()); }
    host.close("retained-words", device);
}

#[test] fn matching_horizon_free_retained_memory() { retained_words(Memory::new(), false); }
#[test] fn matching_horizon_free_retained_sqlite() { retained_words(Sqlite::new("retained-free"), false); }
#[test] fn matching_positive_existence_retained_memory() { retained_words(Memory::new(), true); }
#[test] fn matching_positive_existence_retained_sqlite() { retained_words(Sqlite::new("retained-exists"), true); }
