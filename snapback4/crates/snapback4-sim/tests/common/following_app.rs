//! The published wiring block, installed beside the prefixed feeds module.
#![allow(dead_code)]
use snapback4_core::{Context, Engine, QueryOutcome, Value, WriteState};
use std::collections::BTreeMap;

pub const READERS: [(&str, usize); 2] = [("dev:reader5", 5), ("dev:reader500", 500)];
pub fn id(s: &str) -> Value { Value::Id(s.into()) }
pub fn author(n: usize) -> String { format!("dev:author{n:03}") }
pub fn app() -> String {
    snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).into_iter()
        .find(|block| block.starts_with("-- After: snapback4 init --recipe feeds --prefix feed\n")).unwrap()
}
pub fn built() -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("feed.q".into(), snapback4_lang::recipe::following("feed", "feed").unwrap()), ("social.q".into(), app())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert_eq!(bound.schema.operations["social.following"].runs.as_deref(), Some("device"));
    bound
}
pub fn context(viewer: &str, values: &[(&str, Value)]) -> Context {
    Context::new(viewer, values.iter().map(|(k, v)| ((*k).into(), v.clone())).collect()).at(100_000)
}
pub fn mutate(engine: &mut Engine, op: &str, viewer: &str, values: &[(&str, Value)], now: i64) -> Value {
    let outcome = engine.mutate(&format!("social.{op}"), None, context(viewer, values).at(now)).unwrap();
    match outcome.state { WriteState::Sent { result, .. } => result, other => panic!("{op}: {other:?}") }
}
pub fn seed(engine: &mut Engine) {
    // Every follow and post goes through the published app mutation and its
    // recipe helper. This tests the bridge, not a pre-materialized inbox.
    for n in 0..500 { mutate(engine, "register", &author(n), &[], 1); }
    for (viewer, count) in READERS {
        mutate(engine, "register", viewer, &[], 1);
        for n in 0..count { mutate(engine, "follow", viewer, &[("authorId", id(&author(n)))], 2); }
    }
    for n in 0..500 {
        mutate(engine, "createPost", &author(n), &[("postId", id(&format!("p{n}"))), ("body", Value::String(format!("app card {n}")))], 10 + n as i64);
    }
    for n in 0..25 {
        mutate(engine, "createPost", &author(0), &[("postId", id(&format!("recent{n}"))), ("body", Value::String(format!("recent app card {n}")))], 1_000 + n);
    }
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend_from_slice(&13u32.to_be_bytes()); png.extend_from_slice(b"IHDR");
    png.extend_from_slice(&640u32.to_be_bytes()); png.extend_from_slice(&480u32.to_be_bytes());
    png.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    let asset = engine.store_asset(&author(0), &png, 2_000).unwrap();
    mutate(engine, "createPost", &author(0), &[("postId", id("photo")), ("body", Value::String("media app card".into())), ("media", Value::Map(BTreeMap::from([("id".into(), id(&asset.id))]).into()))], 2_001);
    for (viewer, _) in READERS {
        mutate(engine, "repost", viewer, &[("postId", id("photo"))], 2_002);
        mutate(engine, "repost", viewer, &[("postId", id("photo"))], 2_003);
    }
    assert_eq!(engine.store().rows("follows").unwrap().len(), 505);
    assert_eq!(engine.store().rows("feedFollows").unwrap().len(), 505);
    assert_eq!(engine.store().rows("reposts").unwrap().len(), 2);
    assert_eq!(engine.store().rows("posts").unwrap().len(), 526);
    assert!(!engine.schema().tables["feedFeed"].columns.contains_key("body"));
}
pub fn check_cards(page: &QueryOutcome) {
    assert!(page.complete && page.next.is_some(), "{page:?}");
    let entries = page.data.as_array().unwrap();
    assert_eq!(entries.len(), 20);
    let repost = &entries[0];
    assert_eq!(repost.field("repost").unwrap(), &Value::Bool(true));
    assert_eq!(repost.field("post").unwrap().field("body").unwrap(), &Value::String("media app card".into()));
    assert_eq!(repost.field("post").unwrap().field("media").unwrap().field("width").unwrap(), &Value::Int(640));
    assert_eq!(repost.field("attribution").unwrap().field("postId").unwrap(), &id("photo"));
    assert_eq!(entries[1].field("repost").unwrap(), &Value::Bool(false));
    assert!(entries.iter().all(|e| e.field("body").is_err()));
}
pub fn measure(label: &str, count: usize, mut query: impl FnMut() -> QueryOutcome) -> (QueryOutcome, f64) {
    let mut times = Vec::new();
    let mut last = None;
    for n in 0..23 {
        let start = std::time::Instant::now();
        let page = query();
        if n >= 3 { times.push(start.elapsed().as_secs_f64() * 1000.0); }
        check_cards(&page);
        last = Some(page);
    }
    times.sort_by(f64::total_cmp);
    let page = last.unwrap();
    println!("W6a host={label} follows={count} rows=20 complete=true examined={} probes={} index={} p95_ms={:.3}", page.metered.examined, page.metered.rule_probes, page.metered.index_entries, times[18]);
    (page, times[18])
}
pub fn remove(engine: &mut Engine) {
    mutate(engine, "deletePost", &author(0), &[("postId", id("photo"))], 3_000);
    for (viewer, _) in READERS { mutate(engine, "unrepost", viewer, &[("postId", id("photo"))], 3_001); }
    assert_eq!(engine.store().rows("reposts").unwrap().len(), 0);
}
pub fn check_removed(page: &QueryOutcome) {
    assert!(page.complete);
    assert_eq!(page.data.as_array().unwrap().len(), 20);
    assert!(page.data.as_array().unwrap().iter().all(|e| e.field("postId") != Ok(&id("photo"))));
}
pub fn query(engine: &mut Engine, viewer: &str) -> QueryOutcome { engine.query("social.following", context(viewer, &[])).unwrap() }
pub fn server_scenario() {
    let bound = built();
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    seed(&mut engine);
    let mut measured = Vec::new();
    for (viewer, count) in READERS {
        let (first, p95) = measure("server", count, || query(&mut engine, viewer));
        let next = engine.query("social.following", context(viewer, &[("c", Value::String(first.next.clone().unwrap()))])).unwrap();
        assert!(next.complete);
        assert!(next.data.as_array().unwrap().iter().all(|r| !first.data.as_array().unwrap().iter().any(|p| p.field("eventId") == r.field("eventId"))));
        measured.push((first.metered.examined, p95));
    }
    assert_eq!(measured[0].0, measured[1].0, "500 follows do not add query work");
    println!("W6a host=server following500/following5={:.3}", measured[1].1 / measured[0].1);
    remove(&mut engine);
    for (viewer, _) in READERS {
        check_removed(&query(&mut engine, viewer));
        mutate(&mut engine, "unfollow", viewer, &[("authorId", id(&author(0)))], 4_000);
        assert!(query(&mut engine, viewer).data.as_array().unwrap().iter().all(|r| r.field("actorId") != Ok(&id(&author(0)))));
    }
    println!("W6a server: 505 bridged edges, 526 app cards, 2 idempotent reposts, 3 removed events hidden before purge");
}
