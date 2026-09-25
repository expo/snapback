#![allow(dead_code)]
use snapback4_core::{Value, engine::QueryOutcome, error::Refusal, value::object};
use serde_json::{Value as Json, json};
use std::time::Instant;

pub const COUNTS: [usize; 8] = [0, 1, 31, 32, 33, 45, 200, 1000];
pub const SOURCE: &str = r#"
table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  read <- .principal = viewer
  sync to .principal
table messages:
  roomId: id
  body: text <=4096
  at: time
  by byRoom: roomId, id
  by byRoomWords: roomId, words(body), at, id
  by byWords: words(body), at, id
  read <- exists members[.roomId, viewer]
  sync to members[.roomId]
query search(q: text <=100, c: cursor ?):
  return messages['room'] matching q after c last 20 by byRoomWords
query nonuniform(q: text <=100, c: cursor ?):
  return messages matching q after c last 20 by byWords
query pair(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 20 by byRoomWords:
    ['hidden']
    ['room']
"#;

pub fn seed(n: usize, hidden: usize) -> Vec<(String, Value)> {
    let mut rows = vec![("members".into(), object([("id", Value::Id("member".into())), ("roomId", Value::Id("room".into())), ("principal", Value::Id("dev:alice".into()))]))];
    for (room, count) in [("room", n), ("hidden", hidden)] {
        for i in 0..count {
            rows.push(("messages".into(), object([("id", Value::Id(format!("{room}-{i:05}"))), ("roomId", Value::Id(room.into())), ("body", Value::String(format!("kx{i:02}"))), ("at", Value::Int(i as i64))])));
        }
    }
    rows
}

pub fn ids(page: &QueryOutcome) -> Vec<String> {
    page.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect()
}

pub type Query<'a> = dyn FnMut(&str, Option<String>) -> Result<QueryOutcome, Refusal> + 'a;

pub fn walk(q: &mut Query<'_>, op: &str, require_full: bool) -> (Vec<String>, usize) {
    let mut cursor = None;
    let mut all = Vec::new();
    let mut pages = 0;
    loop {
        let page = q(op, cursor).unwrap();
        assert_eq!((page.complete, page.cut), (true, None), "{page:?}");
        let part = ids(&page);
        if require_full && part.len() == 20 { assert!(page.next.is_some(), "a full 45-word page needs next: {page:?}"); }
        all.extend(part);
        pages += 1;
        assert!(pages < 1000, "walk did not progress");
        cursor = page.next;
        if cursor.is_none() { break; }
    }
    (all, pages)
}

pub fn emit(kind: &str, host: &str, value: Json) {
    println!("W14A {}", json!({"variant": "head", "kind": kind, "host": host, "value": value}));
}

pub fn measure(host: &str, n: usize, q: &mut Query<'_>) {
    match q("search", None) {
        Ok(page) => emit("counters", host, json!({"words": n, "meter": page.metered, "rows": ids(&page).len(), "complete": page.complete, "cut": page.cut, "next": page.next.is_some(), "capped_at": page.capped_at})),
        Err(error) => { emit("counters", host, json!({"words": n, "error": error})); return; }
    }
    if [45, 200, 1000].contains(&n) {
        let (actual, pages) = walk(q, "search", n == 45);
        let expected: Vec<_> = (0..n).rev().map(|i| format!("room-{i:05}")).collect();
        assert_eq!(actual, expected);
        emit("walk", host, json!({"words": n, "rows": actual.len(), "pages": pages}));
    }
    if n == 45 && std::env::var_os("WORD_EXPANSION_MEASURE").is_some() {
        for whole in [false, true] {
            let mut times = Vec::new();
            for i in 0..63 {
                let start = Instant::now();
                if whole { std::hint::black_box(walk(q, "search", false)); }
                else { std::hint::black_box(q("search", None).unwrap()); }
                if i >= 3 { times.push(start.elapsed().as_nanos() as u64); }
            }
            times.sort_unstable();
            emit("latency", host, json!({"whole": whole, "requests": 60, "warmups": 3, "p50_us": times[29] as f64 / 1000.0, "p95_us": times[56] as f64 / 1000.0}));
        }
    }
}

pub fn viewer(page: &QueryOutcome) -> Vec<u8> {
    serde_json::to_vec(&json!({"data": snapback4_core::wire::to_json(&page.data), "complete": page.complete, "cut": page.cut, "next": page.next, "tables": page.tables, "nextExpiry": page.next_expiry, "seq": page.seq, "viewer": "dev:alice"})).unwrap()
}

pub fn observations(q: &mut Query<'_>) -> Vec<Vec<u8>> {
    let mut result = Vec::new();
    for op in ["search", "pair"] {
        let mut cursor = None;
        loop {
            let page = q(op, cursor).unwrap();
            result.push(viewer(&page));
            cursor = page.next;
            if cursor.is_none() { break; }
        }
    }
    result
}

pub fn assert_cut(case: &str, page: &QueryOutcome) {
    use snapback4_core::engine::ReadCut;
    assert_eq!((page.complete, page.cut, page.next.as_ref()), (false, Some(ReadCut::Meter), None));
    match case {
        "discovery-index" => { assert_eq!(ids(page).len(), 0); assert_eq!(page.metered.index_entries, 33); }
        "opening-examined" | "opening-internal-examined" => {
            assert_eq!(ids(page).len(), 10);
            // Internal candidate admission stops as soon as an earlier lane
            // cuts; preauthorized server lanes keep their attempted-read count.
            assert_eq!(page.metered.examined, if case == "opening-internal-examined" { 11 } else { 45 });
        }
        "heap" => assert_eq!(page.data, Value::Null),
        _ => panic!("unknown probe"),
    }
}

pub fn non_uniform_source() -> String {
    SOURCE.replace("  body: text <=4096", "  author: principal default 'dev:alice'\n  body: text <=4096").replace("read <- exists members[.roomId, viewer]", "read <- exists members[.roomId, viewer] and .author = viewer").replace("  sync to members[.roomId]\n", "")
}

pub fn expired_source() -> String { SOURCE.replace("  at: time", "  at: time\n  expires: time ?\n  by byExpires: expires\n  expire at .expires") }
pub fn expired_seed(extra: bool) -> Vec<(String, Value)> {
    let mut rows = seed(45, 0);
    if extra {
        rows.push(("messages".into(), object([("id", Value::Id("expired".into())), ("roomId", Value::Id("room".into())),
            ("body", Value::String("kx-expired".into())), ("at", Value::Int(999)), ("expires", Value::Int(50))])));
    }
    rows
}

pub const ROUND3: &str = include_str!("../search_merge/round3.q");
pub fn round3_seed(population: usize) -> Vec<(String, Value)> {
    let mut rows = Vec::new();
    for room in ["r1", "r2"] { rows.push(("members".into(), object([("id", Value::Id(format!("member-{room}"))),
        ("roomId", Value::Id(room.into())), ("principal", Value::Id("dev:alice".into()))]))); }
    rows.push(("messages".into(), object([("id", Value::Id("shown".into())), ("roomId", Value::Id("r2".into())),
        ("authorId", Value::Id("dev:alice".into())), ("body", Value::String("coffee".into()))])));
    for n in 0..population { rows.push(("messages".into(), object([("id", Value::Id(format!("hidden{n}"))),
        ("roomId", Value::Id("r1".into())), ("authorId", Value::Id("dev:bob".into())), ("body", Value::String(format!("cof{n:02}")))]))); }
    rows
}

pub fn nested_cursor(programs: &mut [snapback4_core::ir::Program], bytes: usize) {
    use snapback4_core::ir::{Expr, Stmt};
    let search = programs.iter_mut().find(|p| p.name == "search").unwrap();
    let Stmt::Return(Expr::Scan(scan)) = &mut search.body[0] else { panic!("search scan") };
    // The dead branch is never evaluated. Word lanes borrow this compiled IR;
    // changing its payload cannot change their allocation charge.
    scan.after = Some(Box::new(Expr::Block { body: vec![Stmt::If { condition: Expr::Literal(Value::Bool(false)),
        then_body: vec![Stmt::Const { name: "unused".into(), value: Expr::Literal(Value::String("x".repeat(bytes))) }], else_body: vec![] }],
        value: Box::new(Expr::Variable("c".into())) }));
}

// Sub-pair (ii): no extra expired word takes N=46 seeks; an extra word needs
// N+1=47. This is the existing time-hidden existence bit from metered expired
// work (LLP 3000 §7), not a new authorization channel. Compare whole envelopes.
pub fn assert_expired_boundary(a: &QueryOutcome, b: &QueryOutcome) {
    assert_eq!((a.metered.index_entries, b.metered.index_entries), (46, 47));
    let a: Json = serde_json::from_slice(&viewer(a)).unwrap();
    let b: Json = serde_json::from_slice(&viewer(b)).unwrap();
    assert_eq!(a["complete"], true);
    assert_eq!(a["cut"], Json::Null);
    assert!(a["next"].is_string());
    assert_eq!(a["data"].as_array().unwrap().len(), 20);
    let mut expected = a;
    expected["data"] = json!([]);
    expected["complete"] = json!(false);
    expected["cut"] = json!("meter");
    expected["next"] = Json::Null;
    assert_eq!(b, expected, "all remaining production fields, including nextExpiry, agree");
}

pub fn nested_predicate(programs: &mut [snapback4_core::ir::Program]) {
    use snapback4_core::ir::{Expr, Stmt};
    let search = programs.iter_mut().find(|p| p.name == "search").unwrap();
    let Stmt::Return(Expr::Scan(scan)) = &mut search.body[0] else { panic!("search scan") };
    let mut predicate = Expr::Literal(Value::Bool(true));
    for _ in 0..8 {
        predicate = Expr::Block { body: vec![Stmt::If { condition: Expr::Literal(Value::Bool(false)),
            then_body: vec![Stmt::Const { name: "unused".into(), value: Expr::Literal(Value::String("x".repeat(4096))) }], else_body: vec![] }], value: Box::new(predicate) };
    }
    scan.filter = Some(Box::new(predicate));
}
