#![allow(dead_code)]
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_core::value::object;
use std::collections::BTreeMap;

pub const HOUR: i64 = 3_600_000;
pub const DAY: i64 = 24 * HOUR;
pub const NOW: i64 = 100 * DAY + HOUR / 2;

pub fn source(synced: bool) -> String {
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).into_iter()
        .find(|s| s.contains("likeCount: count likes by postId")).unwrap();
    if synced { source.replace("  insert <- .authorId = viewer", "  insert <- .authorId = viewer\n  sync public")
        .replace("  delete <- .principal = viewer", "  delete <- .principal = viewer\n  sync public") } else { source }
}

pub fn id(s: &str) -> Value { Value::Id(s.into()) }
pub fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> { pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect() }
pub fn post(name: &str, at: i64) -> (String, Value) {
    ("posts".into(), object([("id", id(name)), ("authorId", id("alice")), ("body", Value::String(name.into())), ("at", Value::Int(at))]))
}
pub fn seed_post(engine: &mut Engine, name: &str, at: i64, likes: usize) {
    engine.seed([post(name, at)]).unwrap();
    engine.seed((0..likes).map(|n| ("likes".into(), object([
        ("id", id(&format!("{name}-l{n}"))), ("postId", id(name)), ("principal", id(&format!("reader-{n}"))),
    ])))).unwrap();
}
pub fn set_like(engine: &mut Engine, who: &str, post: &str, liked: bool, at: i64, write: &str) {
    let reply = engine.mutate("setLike", Some(write), Context::new(who, args(&[("postId", id(post)), ("liked", Value::Bool(liked))]))
        .at(at).with_ids([format!("like-{write}")])).unwrap();
    assert!(matches!(reply.state, WriteState::Sent { .. }), "{reply:?}");
}
pub fn rows(data: &Value) -> Vec<Value> { data.as_array().unwrap().to_vec() }
pub fn names(rows: &[Value]) -> Vec<String> { rows.iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_string()).collect() }
pub fn ranking(engine: &mut Engine, now: i64) -> Vec<Value> {
    let mut result = Vec::new(); let mut cursor = Value::Null;
    for _ in 0..100 {
        let reply = engine.query("trending", Context::new("bob", args(&[("c", cursor)])).at(now)).unwrap();
        assert!(reply.complete, "{reply:?}"); result.extend(rows(&reply.data));
        match reply.next { Some(next) => cursor = Value::String(next), None => return result }
    }
    panic!("cursor did not finish");
}
// Independent counts and newest-first ties come only from source rows.
pub fn oracle(engine: &Engine, now: i64) -> Vec<(String, i64)> {
    let posts = engine.store().rows("posts").unwrap();
    let likes = engine.store().rows("likes").unwrap();
    let mut result = Vec::new();
    for post in posts {
        let Value::Int(at) = post.field("at").unwrap() else { panic!() };
        if *at <= now - DAY || *at > now { continue; }
        let name = post.field("id").unwrap();
        let count = likes.iter().filter(|l| l.field("postId").unwrap() == name).count() as i64;
        result.push((name.as_str().unwrap().to_owned(), count, *at));
    }
    result.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.2.cmp(&a.2)).then_with(|| b.0.cmp(&a.0)));
    result.into_iter().map(|(id, count, _)| (id, count)).collect()
}
pub fn scored(rows: &[Value]) -> Vec<(String, i64)> {
    rows.iter().map(|r| { let Value::Int(n) = r.field("likeCount").unwrap() else { panic!() }; (r.field("id").unwrap().as_str().unwrap().into(), *n) }).collect()
}
pub fn fixture(engine: &mut Engine) {
    for (name, age, count) in [("fresh", HOUR / 2, 2), ("mid", 10 * HOUR, 3), ("edge", 47 * HOUR / 2, 1),
        ("old", 26 * HOUR, 5), ("exact-edge", DAY, 9), ("future", -2 * HOUR, 10)] {
        seed_post(engine, name, NOW - age, count);
    }
    for n in 0..12 { seed_post(engine, &format!("quiet-{n:02}"), NOW - (10 + n) * 60_000, 0); }
    seed_post(engine, "old-quiet", NOW - 27 * HOUR, 0);
}
pub fn paging_fixture(engine: &mut Engine) {
    for n in 0..37 { seed_post(engine, &format!("p{n:02}"), NOW - (n % 23 + 1) * HOUR, 1 + n as usize); }
    seed_post(engine, "old", NOW - 26 * HOUR, 50);
}

// Cross hour 999/1000: opaque maintained ids sort these decimal strings differently.
pub const TIE_NOW: i64 = 1005 * HOUR + HOUR / 2;
// Twelve occupied hour lanes, four tied scores in each; pairs also share post time.
pub fn tie_fixture(engine: &mut Engine) {
    for n in 0..48 { seed_post(engine, &format!("tie-{:02}", 47 - n), TIE_NOW - (n / 4 + 1) * HOUR - (n % 2) * 1000, 2); }
}
pub fn tie_queries(take: usize) -> String {
    let mut source = String::new();
    for (name, direction) in [("tieFirst", "first"), ("tieLast", "last")] {
        source.push_str(&format!("\nquery {name}(c: cursor ?):\n  return merge posts after c {direction} {take} by byHourLikes where .at > now - 86400000 and .at <= now:\n    [h] for h in range(hour(now) - 24, hour(now) + 1)\n"));
    }
    source
}
