//! Shape-matched calibration of the published wired app, not a replay of all Clique tables.
#![allow(dead_code)]
use snapback4_core::{Engine, Value, value::object};
use std::collections::{BTreeMap, BTreeSet};
#[path = "following_app.rs"]
mod app;
use app::id;

pub const VIEWER: &str = "dev:u0003";
pub fn who(n: usize) -> String { format!("dev:u{n:04}") }
pub fn built() -> snapback4_lang::Bound {
    let caps = snapback4_lang::recipe::FollowingCaps::parse(Some("1008"), Some("5921")).unwrap();
    let bound = snapback4_lang::compile(&[("feed.q".into(), snapback4_lang::recipe::following_sized("feed", "feed", caps).unwrap()), ("social.q".into(), app::app())]);
    assert!(bound.diagnostics.is_empty() && bound.notes.is_empty(), "{:?} {:?}", bound.diagnostics, bound.notes);
    bound
}

pub fn rows() -> Vec<(String, Value)> {
    let mut graph = BTreeSet::new();
    for a in 10..15 { graph.insert((2, a)); }
    for a in 10..510 { graph.insert((3, a)); }
    for r in 4..904 { graph.insert((r, 1007)); }
    'fill: for offset in 1..1007 {
        for r in 5..1008 {
            graph.insert((r, (r + offset) % 1007));
            if graph.len() == 5921 { break 'fill; }
        }
    }
    assert_eq!(graph.len(), 5921);
    assert_eq!(graph.iter().filter(|(r, _)| *r == 3).count(), 500);
    let mut followers = vec![Vec::new(); 1008];
    for &(r, a) in &graph { followers[a].push(r); }
    assert!(followers[..1007].iter().all(|f| f.len() <= 50));
    assert_eq!(followers[1007].len(), 900);
    let mut rows = Vec::new();
    for a in 0..1008 {
        rows.push(("feedAuthors".into(), object([("id", id(&format!("author-{a:04}"))), ("principal", id(&who(a))), ("shared", Value::Bool(a == 1007))])));
        rows.push(("profiles".into(), object([("id", id(&format!("profile-{a:04}"))), ("principal", id(&who(a))), ("name", Value::String(format!("Author {a:04}")))])));
    }
    for &(r, a) in &graph {
        let fields = [("id", id(&format!("follow-{r:04}-{a:04}"))), ("followerId", id(&who(r))), ("followedId", id(&who(a)))];
        rows.push(("follows".into(), object(fields.clone())));
        rows.push(("feedFollows".into(), object(fields.into_iter().chain([("at", Value::Int(1))]))));
    }
    for r in followers[1007].iter().copied().chain([1007]) {
        rows.push(("feedPulls".into(), object([("id", id(&format!("pull-{r:04}"))), ("readerId", id(&who(r))), ("authorId", id(&who(1007)))])));
        rows.push(("feedPullCounts".into(), object([("id", id(&format!("count-{r:04}"))), ("readerId", id(&who(r))), ("used", Value::Int(1))])));
    }
    // The graph precedes these posts: one permanently promoted celebrity;
    // all other actors push to their followers and themselves. This import
    // has no truncation at the 200-event follow-time backfill bound.
    for (a, audience) in followers.iter().enumerate() {
        for n in 0..49 + usize::from(a < 836) {
            let eid = format!("post-{a:04}-{n:04}");
            let at = Value::Int((n * 1008 + a + 10) as i64);
            rows.push(("posts".into(), object([("id", id(&eid)), ("authorId", id(&who(a))), ("body", Value::String(format!("Calibration app card {a:04}/{n:04}"))), ("media", Value::Null), ("at", at.clone())])));
            rows.push(("feedPosts".into(), object([("id", id(&eid)), ("postId", id(&eid)), ("actorId", id(&who(a))), ("authorId", id(&who(a))), ("repost", Value::Bool(false)), ("at", at.clone()), ("shared", Value::Bool(a == 1007))])));
            let readers = if a == 1007 { vec![a] } else { std::iter::once(a).chain(audience.iter().copied()).collect() };
            for r in readers {
                rows.push((if a == 1007 { "feedBroadcast" } else { "feedFeed" }.into(), object([
                    ("id", id(&format!("entry-{r:04}-{eid}"))), ("readerId", id(&who(r))), ("eventId", id(&eid)), ("actorId", id(&who(a))),
                    ("authorId", id(&who(a))), ("postId", id(&eid)), ("repost", Value::Bool(false)), ("at", at.clone()),
                ])));
            }
        }
    }
    for (table, expected) in [("feedAuthors", 1008), ("profiles", 1008), ("follows", 5921), ("feedFollows", 5921), ("posts", 50228), ("feedPosts", 50228)] {
        assert_eq!(rows.iter().filter(|(t, _)| t == table).count(), expected, "{table}");
    }
    rows
}

pub fn seed(engine: &mut Engine) {
    engine.load(rows()).unwrap();
    // load skips constraints; adoption validates every original cap and
    // unique key before measuring or exercising the actual app bridge.
    let schema = engine.schema().clone();
    let programs: Vec<_> = engine.programs().cloned().collect();
    engine.adopt(schema, programs).unwrap();
}

pub fn check_page(page: &snapback4_core::QueryOutcome) {
    assert!(page.complete && page.next.is_some(), "{page:?}");
    let entries = page.data.as_array().unwrap();
    assert_eq!(entries.len(), 20);
    assert!(entries.iter().all(|r| r.field("post").unwrap().field("body").unwrap().as_str().unwrap().starts_with("Calibration app card ")));
}

pub fn check_counts(counts: &BTreeMap<String, (usize, usize)>) {
    for (table, expected) in [("feedAuthors", 1008), ("profiles", 1008), ("follows", 5921), ("feedFollows", 5921), ("posts", 50228), ("feedPosts", 50228), ("feedFeed", 25050), ("feedBroadcast", 49)] {
        assert_eq!(counts[table].0, expected, "{table}");
    }
    assert_eq!(counts.values().map(|v| v.0).sum::<usize>(), 139413);
    assert_eq!(counts.values().map(|v| v.1).sum::<usize>(), 17876585);
    assert_eq!(counts.get("feedPulls").map_or(0, |v| v.0), 0);
    assert_eq!(counts.get("feedPullCounts").map_or(0, |v| v.0), 0);
    fn comma(n: usize) -> String {
        let digits = n.to_string();
        digits.chars().enumerate().map(|(i, c)| if i > 0 && (digits.len() - i).is_multiple_of(3) { format!(",{c}") } else { c.to_string() }).collect()
    }
    let card = include_str!("../../../snapback4-lang/src/recipe/ADOPTION.md");
    for table in ["feedAuthors", "feedFollows", "feedPosts", "feedFeed", "follows", "posts", "profiles", "feedBroadcast"] {
        let (rows, bytes) = counts[table];
        let line = card.lines().find(|line| line.starts_with(&format!("| `{table}`"))).unwrap();
        assert!(line.ends_with(&format!("| {} | {} |", comma(rows), comma(bytes))), "card disagrees with measured {table}: {line}");
    }
    assert!(card.contains("| **139,413** | **17,876,585** |"));
}

pub fn exercise_bridge(engine: &mut Engine) -> u64 {
    let before = engine.seq().unwrap();
    app::mutate(engine, "saveProfile", &who(1007), &[("name", Value::String("Updated profile".into()))], 100_000);
    app::mutate(engine, "createPost", &who(10), &[("postId", id("bridge-post")), ("body", Value::String("bridge card".into()))], 100_001);
    let page = app::query(engine, VIEWER);
    assert_eq!(page.data.as_array().unwrap()[0].field("post").unwrap().field("body").unwrap(), &Value::String("bridge card".into()));
    before
}
