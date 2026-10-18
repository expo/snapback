//! LLP 3000.040 on the server and the two production device stores: bounded
//! ints refuse alike, calendar builtins and keys agree, and a whole-table cap
//! refuses at N and predicts over a fully held public table.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, WriteState};

const SOURCE: &str = r#"table reviews:
  author: principal
  stars: int 1..5
  helpful: int 0.. default 0
  delta: int -10..10 ?
  budget: int ..1000 ?
  scores: [int 0..100] <=8
  read <- .author = viewer
  insert <- .author = viewer
  update <- .author = viewer
  sync to .author
table categories:
  name: text 1..40
  public
  insert <- allow
  cap 3
  sync public
table checkins:
  person: principal
  at: time
  unique person, month(at) else ALREADY_THIS_MONTH
  read <- .person = viewer
  insert <- .person = viewer
  sync to .person
view checkinsByYear: count checkins by .person, year(.at)
  read <- .person = viewer
query calendar(t: time):
  m = month(t)
  return { month: m, year: year(t), start: monthStart(m), next: monthStart(m + 1), yearStart: yearStart(year(t)), check: month(t) / 12 + 1970 = year(t) }
query starts(m: int, y: int):
  return { month: monthStart(m), year: yearStart(y) }
query inMonth(t: time):
  return checkins[viewer, month(t)]
query perYear(y: int):
  return checkinsByYear[viewer, y]
query mine():
  return reviews where .author = viewer first 20 by .id
mutation rate(stars: int 1..5, scores: [int 0..100] <=8):
  return insert reviews { author: viewer, stars, scores }
mutation computed(n: int):
  return insert reviews { author: viewer, stars: n + 1, scores: [] }
mutation shift(d: int ?, b: int ?):
  return insert reviews { author: viewer, stars: 3, scores: [], delta: d, budget: b }
mutation listed(xs: [int] <=8):
  return insert reviews { author: viewer, stars: 3, scores: xs }
mutation addCategory(name: text 1..40):
  return insert categories { name }
mutation checkIn(at: time):
  return insert checkins { person: viewer, at }
"#;

const NOW: i64 = 1_791_676_800_000; // 2026-10-11T00:00Z

fn code_of(state: &WriteState) -> Option<&str> {
    match state { WriteState::Sent { .. } => None, WriteState::Failed { why, .. } => Some(why.code.as_str()) }
}

fn wire(value: &serde_json::Value) -> Vec<(String, Value)> {
    value.as_object().unwrap().iter().map(|(k, v)| (k.clone(), match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Number(n) => Value::Int(n.as_i64().unwrap()),
        serde_json::Value::String(s) => Value::String(s.clone()),
        serde_json::Value::Array(items) => Value::Array(items.iter().map(|i| Value::Int(i.as_i64().unwrap())).collect()),
        other => panic!("{other}"),
    })).collect()
}

/// The server and the device agree on one mutation's outcome code.
fn both<H: Host>(server: &mut snapback4_core::engine::Engine, device: &mut snapback4_device::device::Device<H::Store>, name: &str, args: serde_json::Value, id: &str) -> Option<String> {
    let pairs = wire(&args);
    let refs: Vec<(&str, Value)> = pairs.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
    let sent = server.mutate(name, None, context("alice", &refs).at(NOW).with_ids([format!("{id}-server")])).unwrap();
    let predicted = device.predict(name, "alice", &args, NOW, vec![format!("{id}-device")], 1);
    let server_code = code_of(&sent.state).map(str::to_owned);
    let device_code = predicted.as_ref().err().map(|e| e.code().to_string());
    assert_eq!(server_code, device_code, "{name} {args}: server {:?} device {:?}", sent.state, predicted.err());
    if let WriteState::Failed { why, .. } = &sent.state { assert!(!why.message.is_empty()); }
    server_code
}

fn bounded<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    let mut device = host.open("lang2-bounded", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "alice", 10).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let mut n = 0;
    let mut call = |server: &mut _, device: &mut _, name: &str, args: serde_json::Value| { n += 1; both::<H>(server, device, name, args, &format!("w{n}")) };
    // Arguments: each bound, one past it, list items, optionals.
    for (stars, ok) in [(1i64, true), (5, true), (0, false), (6, false), (-9_007_199_254_740_991, false)] {
        let code = call(&mut server, &mut device, "rate", json!({"stars": stars, "scores": [0, 100]}));
        assert_eq!(code.is_none(), ok, "stars {stars}");
        if !ok { assert_eq!(code.as_deref(), Some("E_INPUT")); }
    }
    assert_eq!(call(&mut server, &mut device, "rate", json!({"stars": 3, "scores": [101]})).as_deref(), Some("E_INPUT"));
    assert_eq!(call(&mut server, &mut device, "rate", json!({"stars": 3, "scores": [-1]})).as_deref(), Some("E_INPUT"));
    // Computed values meet the column's bound when stored.
    assert_eq!(call(&mut server, &mut device, "computed", json!({"n": 4})), None);
    assert_eq!(call(&mut server, &mut device, "computed", json!({"n": 5})).as_deref(), Some("E_INPUT"));
    assert_eq!(call(&mut server, &mut device, "computed", json!({"n": -1})).as_deref(), Some("E_INPUT"));
    // Optional columns: null is fine, a value meets the range; `..N` has no lower bound.
    assert_eq!(call(&mut server, &mut device, "shift", json!({"d": null, "b": null})), None);
    assert_eq!(call(&mut server, &mut device, "shift", json!({"d": -10, "b": -9_007_199_254_740_991i64})), None);
    assert_eq!(call(&mut server, &mut device, "shift", json!({"d": 11, "b": 0})).as_deref(), Some("E_INPUT"));
    assert_eq!(call(&mut server, &mut device, "shift", json!({"d": 0, "b": 1001})).as_deref(), Some("E_INPUT"));
    // An unbounded list argument stored into a bounded list column.
    assert_eq!(call(&mut server, &mut device, "listed", json!({"xs": [0, 50, 100]})), None);
    assert_eq!(call(&mut server, &mut device, "listed", json!({"xs": [50, 101]})).as_deref(), Some("E_INPUT"));
    // The message names the bound and the value.
    let refused = server.mutate("rate", None, context("alice", &[("stars", Value::Int(7)), ("scores", Value::Array(vec![]))]).at(NOW).with_ids(["msg".to_owned()])).unwrap();
    let WriteState::Failed { why, .. } = refused.state else { panic!("accepted 7") };
    assert!(why.message.contains("int 1..5") && why.message.contains('7'), "{}", why.message);
    let stored = server.mutate("computed", None, context("alice", &[("n", Value::Int(9))]).at(NOW).with_ids(["msg2".to_owned()])).unwrap();
    let WriteState::Failed { why, .. } = stored.state else { panic!("stored 10") };
    assert_eq!(why.message, "reviews.stars must be int 1..5, not the number 10");
    host.close("lang2-bounded", device);
}

fn calendar<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    let mut device = host.open("lang2-calendar", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "alice", 10).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let i53 = 9_007_199_254_740_991i64;
    for t in [0, -1, -2_678_400_000, -2_678_400_001, 951_782_400_000, -2_203_891_200_000, -2_203_891_200_001, NOW, 1_798_761_599_999, 1_798_761_600_000, i53 - 40 * 86_400_000] {
        let on_server = server.query("calendar", context("alice", &[("t", Value::Int(t))]).at(NOW)).unwrap();
        let on_device = device.query("calendar", "alice", &json!({"t": t}), NOW).unwrap();
        assert_eq!(on_server.data, on_device.data, "{t}");
        assert_eq!(on_server.data.field("check").unwrap(), &Value::Bool(true));
    }
    let row = server.query("calendar", context("alice", &[("t", Value::Int(NOW))]).at(NOW)).unwrap().data;
    assert_eq!(snapback4_core::wire::to_json(&row), json!({"month": 681, "year": 2026, "start": 1_790_812_800_000i64, "next": 1_793_491_200_000i64, "yearStart": 1_767_225_600_000i64, "check": true}));
    // The extreme starts refuse alike, never a wrong instant.
    for (m, y) in [(3_425_122i64, 2026i64), (0, 287_397), (-3_425_122, 2026), (0, -283_457), (i53, 0)] {
        let on_server = server.query("starts", context("alice", &[("m", Value::Int(m)), ("y", Value::Int(y))]).at(NOW)).unwrap_err();
        let on_device = device.query("starts", "alice", &json!({"m": m, "y": y}), NOW).unwrap_err();
        assert_eq!((on_server.code.as_str(), on_device.code.as_str()), ("E_OVERFLOW", "E_OVERFLOW"), "{m} {y}");
    }
    // A month key: once per calendar month, on both.
    let october = NOW;
    let november = 1_793_491_200_000;
    assert_eq!(both::<H>(&mut server, &mut device, "checkIn", json!({"at": october}), "c1"), None);
    let watermark = device.state().unwrap().0;
    device.apply(&stream_page(&mut server, "alice", watermark), false).unwrap();
    assert_eq!(both::<H>(&mut server, &mut device, "checkIn", json!({"at": october + 86_400_000 * 19}), "c2").as_deref(), Some("ALREADY_THIS_MONTH"));
    assert_eq!(both::<H>(&mut server, &mut device, "checkIn", json!({"at": november}), "c3"), None);
    let watermark = device.state().unwrap().0;
    device.apply(&stream_page(&mut server, "alice", watermark), false).unwrap();
    for t in [october, november, november - 1, november + 86_400_000] {
        let on_server = server.query("inMonth", context("alice", &[("t", Value::Int(t))]).at(NOW)).unwrap();
        let on_device = device.query("inMonth", "alice", &json!({"t": t}), NOW).unwrap();
        assert_eq!(on_server.data, on_device.data, "{t}");
        assert_ne!(on_server.data, Value::Null);
    }
    let on_server = server.query("perYear", context("alice", &[("y", Value::Int(2026))]).at(NOW)).unwrap();
    let on_device = device.query("perYear", "alice", &json!({"y": 2026}), NOW).unwrap();
    assert_eq!(on_server.data, on_device.data);
    assert_eq!(on_server.data, Value::Int(2));
    host.close("lang2-calendar", device);
}

fn whole_table_cap<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    let mut device = host.open("lang2-cap", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "alice", 10).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    for (n, name) in ["a", "b", "c"].iter().enumerate() {
        assert_eq!(both::<H>(&mut server, &mut device, "addCategory", json!({"name": name}), &format!("k{n}")), None);
        let watermark = device.state().unwrap().0;
        device.apply(&stream_page(&mut server, "alice", watermark), false).unwrap();
    }
    assert_eq!(both::<H>(&mut server, &mut device, "addCategory", json!({"name": "d"}), "k3").as_deref(), Some("E_CONSTRAINT"));
    let refused = server.mutate("addCategory", None, context("bob", &[("name", Value::String("e".into()))]).at(NOW).with_ids(["k4".to_owned()])).unwrap();
    let WriteState::Failed { why, .. } = refused.state else { panic!("a fourth category was written") };
    assert_eq!(why.message, "categories holds at most 3 rows");
    host.close("lang2-cap", device);
}

/// Tightening a range over stored rows (LLP 3000.040 §1.6): the server refuses
/// E_ADOPT while a row does not fit and adopts once it is repaired; a device that
/// held the stale image drops it at the new generation and reacquires.
fn tightening<H: Host>(host: &mut H) {
    const LOOSE: &str = "table scores:\n  owner: principal\n  stars: int\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  sync to .owner\nquery all():\n  return scores where .owner = viewer first 10 by .id\nmutation fix(s: scores, stars: int):\n  update scores[s] { stars }\n  return null\n";
    let (mut server, backend) = compile(LOOSE);
    let table = server.schema().tables["scores"].clone();
    for (id, stars) in [("low", 0), ("ok", 3)] {
        server.seed([("scores".into(), snapback4_core::wire::row_from_json(&table, &json!({"id": id, "owner": "alice", "stars": stars})).unwrap())]).unwrap();
    }
    let mut device = host.open("lang2-tighten", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "alice", 10).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let held = device.query("all", "alice", &json!({}), NOW).unwrap().data;
    assert!(snapback4_core::wire::to_json(&held).to_string().contains("\"stars\":0"), "{}", host.label());
    let (_, tight) = compile(&LOOSE.replace("stars: int\n", "stars: int 1..5\n").replace("stars: int):", "stars: int 1..5):"));
    let refused = server.adopt(tight.schema.clone(), tight.programs.clone()).unwrap_err();
    assert_eq!(refused.code(), "E_ADOPT", "{refused}");
    assert!(refused.to_string().contains("int 1..5"), "{refused}");
    assert!(matches!(server.mutate("fix", None, context("alice", &[("s", id("low")), ("stars", Value::Int(1))]).at(NOW)).unwrap().state, WriteState::Sent { .. }));
    server.adopt(tight.schema.clone(), tight.programs.clone()).unwrap();
    let tight = snapback4_device::device::Backend { generation: server.generation(), ..tight };
    device.adopt(tight).unwrap();
    for (n, page) in snapshot_pages(&mut server, "alice", 10).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let read = device.query("all", "alice", &json!({}), NOW).unwrap();
    let text = snapback4_core::wire::to_json(&read.data).to_string();
    assert!(!text.contains("\"stars\":0") && text.contains("\"stars\":1"), "{}: {text}", host.label());
    host.close("lang2-tighten", device);
}

#[test] fn tightening_server_and_memory_device() { tightening(&mut Memory::new()); }
#[test] fn tightening_server_and_sqlite_device() { tightening(&mut Sqlite::new("lang2-tighten")); }
#[test] fn bounded_ints_server_and_memory_device() { bounded(&mut Memory::new()); }
#[test] fn bounded_ints_server_and_sqlite_device() { bounded(&mut Sqlite::new("lang2-bounded")); }
#[test] fn calendar_server_and_memory_device() { calendar(&mut Memory::new()); }
#[test] fn calendar_server_and_sqlite_device() { calendar(&mut Sqlite::new("lang2-calendar")); }
#[test] fn whole_table_cap_server_and_memory_device() { whole_table_cap(&mut Memory::new()); }
#[test] fn whole_table_cap_server_and_sqlite_device() { whole_table_cap(&mut Sqlite::new("lang2-cap")); }
