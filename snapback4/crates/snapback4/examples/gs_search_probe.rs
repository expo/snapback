//! Lane GS research probe. Reads only a caller-supplied COPY of the calibration
//! store, or creates disposable synthetic stores. Does not change production code.
//! @ref LLP 3000.024#2 — reproduce the baseline, not a proposed implementation.
use snapback4_core::{Context, Engine, Store, Value, value::object};
use serde_json::json;
use std::{collections::BTreeMap, time::Instant};

const NOW: i64 = 1_790_493_000_000;

fn context(viewer: &str, cursor: Option<String>) -> Context {
    Context::new(viewer, BTreeMap::from([
        ("q".into(), Value::String("coffee".into())),
        ("c".into(), cursor.map(Value::String).unwrap_or(Value::Null)),
    ])).at(NOW)
}

fn measure(engine: &mut Engine, viewer: &str, name: &str, label: &str) {
    let mut times = Vec::new();
    let mut last = None;
    for i in 0..23 {
        let start = Instant::now();
        let result = engine.query(name, context(viewer, None)).unwrap();
        if i >= 3 { times.push(start.elapsed().as_secs_f64() * 1000.0); }
        last = Some(result);
    }
    times.sort_by(f64::total_cmp);
    let page = last.unwrap();
    let next_page = page.next.as_ref().map(|token| {
        let next = engine.query(name, context(viewer, Some(token.clone()))).unwrap();
        let ids = |data: &Value| data.as_array().unwrap().iter()
            .map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>();
        let first_ids = ids(&page.data);
        let next_ids = ids(&next.data);
        assert!(next_ids.iter().all(|id| !first_ids.contains(id)), "duplicate across pages");
        let keys = page.data.as_array().unwrap().iter().chain(next.data.as_array().unwrap())
            .map(|row| (row.field("at").unwrap().as_int().unwrap(), row.field("id").unwrap().as_str().unwrap()))
            .collect::<Vec<_>>();
        assert!(keys.windows(2).all(|pair| pair[0] > pair[1]), "global order across pages");
        json!({"complete":next.complete,"rows":next_ids.len(),"next":next.next.is_some(),"meter":next.metered})
    });
    println!("{}", json!({"label":label,"query":name,"p50_ms":times[9],"p95_ms":times[18],
        "samples_ms":times,"rows":page.data.as_array().ok().map(|rows| rows.len()),
        "complete":page.complete,"cut":format!("{:?}",page.cut),"capped_at":format!("{:?}",page.capped_at),
        "word_cut_at":page.word_cut_at,"next":page.next.is_some(),"meter":page.metered,"page2":next_page}));
}

fn synthetic(groups: usize, words: usize, hits: usize) {
    let source = r#"
table members:
  roomId: id
  principal: principal
  unique roomId, principal
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
table messages:
  roomId: id
  body: text <=4000
  at: time
  search body
  read <- exists members[.roomId, viewer]
query newest(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.roomId, viewer] last 20 by .at after c
"#;
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::new_at(Store::memory().unwrap(), bound.schema,
        bound.programs.into_iter().map(|p| p.program), NOW).unwrap();
    let text = (0..words).map(|n| format!("coffee{n:03}")).collect::<Vec<_>>().join(" ");
    for start in (0..=groups).step_by(100) {
        let mut rows = Vec::new();
        for group in start..(start + 100).min(groups + 1) {
            let room = format!("r{group:05}");
            rows.push(("members".into(), object([
                ("id", Value::Id(format!("member{group:05}"))),
                ("roomId", Value::Id(room.clone())),
                ("principal", Value::Id(if group == groups {"bob"} else {"alice"}.into())),
            ])));
            for n in 0..hits {
                rows.push(("messages".into(), object([
                    ("id", Value::Id(format!("{room}-{n:03}"))),
                    ("roomId", Value::Id(room.clone())),
                    ("body", Value::String(text.clone())),
                    ("at", Value::Int(if group == groups { 10000 + n as i64 } else { n as i64 })),
                ])));
            }
        }
        engine.seed_at(rows, NOW).unwrap();
    }
    let label = format!("groups={groups},words={words},hits={hits}");
    let first = engine.query("newest", context("alice", None)).unwrap();
    if let Ok(rows) = first.data.as_array() {
        assert!(rows.iter().all(|row| row.field("roomId").unwrap().as_str().unwrap() != format!("r{groups:05}")), "unreadable chat escaped");
        if first.complete { assert_eq!(rows.len(), (groups * hits).min(20)); }
    }
    measure(&mut engine, "alice", "newest", &label);
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if let Some(path) = args.first() {
        let mut engine = Engine::open_at(Store::open(std::path::Path::new(path)).unwrap(), NOW).unwrap();
        for name in ["gsOriginal", "gsbare", "gssender", "gschat", "gspeers", "gsoriginalFixed", "searchMessages", "gssenderChat"] {
            measure(&mut engine, "user:01M3GT3FPQGRMD803E1A4BPK07", &format!("messaging.{name}"), "calibration-final-store");
        }
    } else {
        for groups in [1000, 3000, 10000] { synthetic(groups, 1, 30); }
        for (groups, words, hits) in [(100,1,1),(100,1,30),(100,4,30),(100,32,30),(500,1,30)] {
            synthetic(groups, words, hits);
        }
    }
}
