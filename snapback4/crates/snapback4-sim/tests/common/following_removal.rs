//! Removal envelope: a five-follower writer, or a promoted writer with
//! 900 followers and an earlier pushed event acquired through backfill.
#![allow(dead_code)]
use super::world::{args, id, mutate};
use snapback4_core::{Context, Engine, JobState, Value};
use snapback4_core::value::object;
use std::collections::BTreeMap;

pub const AUTHOR: &str = "dev:writer";
pub const ORIGINAL: &str = "original";
pub fn reader(n: usize) -> String { format!("dev:reader{n:04}") }

pub fn seed(engine: &mut Engine, followers: usize) {
    let shared = followers > 50;
    let mut rows = vec![("authors".into(), object([("id", id("author")), ("principal", id(AUTHOR)), ("shared", Value::Bool(shared))]))];
    for n in 0..followers {
        rows.push(("follows".into(), object([("id", id(&format!("follow{n}"))), ("followerId", id(&reader(n))), ("followedId", id(AUTHOR))])));
    }
    if shared {
        for viewer in std::iter::once(AUTHOR.to_owned()).chain((0..followers).map(reader)) {
            rows.push(("pulls".into(), object([("id", id(&format!("pull-{viewer}"))), ("readerId", id(&viewer)), ("authorId", id(AUTHOR))])));
        }
    }
    for (event, actor) in [("old-pushed", AUTHOR), (ORIGINAL, "dev:original")] {
        rows.push(("posts".into(), object([("id", id(event)), ("postId", id(event)), ("actorId", id(actor)), ("authorId", id(actor)), ("repost", Value::Bool(false)), ("body", Value::String(event.into())), ("at", Value::Int(1)), ("shared", Value::Bool(false))])));
    }
    for viewer in std::iter::once(AUTHOR.to_owned()).chain((0..followers).map(reader)) {
        rows.push(("feed".into(), object([("id", id(&format!("inbox-{viewer}"))), ("eventId", id("old-pushed")), ("readerId", id(&viewer)), ("actorId", id(AUTHOR)), ("authorId", id(AUTHOR)), ("postId", id("old-pushed")), ("repost", Value::Bool(false)), ("body", Value::String("old-pushed".into())), ("at", Value::Int(1))])));
    }
    engine.seed(rows).unwrap();
    for (op, input, at) in [
        ("createPost", args(&[("postId", id("new-post")), ("body", Value::String("new post".into()))]), 2),
        ("repost", args(&[("postId", id(ORIGINAL))]), 3),
    ] {
        let result = engine.mutate(op, None, Context::new(AUTHOR, input).at(at).with_ids((0..60).map(|n| format!("{op}-{n:03}")))).unwrap();
        assert!(matches!(result.state, snapback4_core::WriteState::Sent { .. }), "{result:?}");
    }
}

pub fn repost_id(engine: &Engine) -> String {
    engine.store().rows("posts").unwrap().iter().find(|row| row.field("repost") == Ok(&Value::Bool(true))).unwrap().field("id").unwrap().as_str().unwrap().to_owned()
}

pub fn remove(engine: &mut Engine) -> Vec<String> {
    let events = vec!["old-pushed".into(), "new-post".into(), repost_id(engine)];
    mutate(engine, "deletePost", AUTHOR, &[("postId", id("old-pushed"))], 4);
    mutate(engine, "deletePost", AUTHOR, &[("postId", id("new-post"))], 5);
    mutate(engine, "unrepost", AUTHOR, &[("postId", id(ORIGINAL))], 6);
    events
}

pub fn page(engine: &mut Engine, viewer: &str) -> snapback4_core::QueryOutcome {
    let result = engine.query("following", Context::new(viewer, BTreeMap::new()).at(10)).unwrap();
    assert!(result.complete, "{viewer}: {result:?}");
    result
}

pub fn event_rows(engine: &Engine, event: &str) -> usize {
    engine.store().rows("feed").unwrap().iter().filter(|row| row.field("eventId").unwrap() == &id(event)).count()
}

pub fn purge(engine: &mut Engine) -> snapback4_core::JobRun {
    assert!(engine.fire_schedules(0).unwrap().is_empty());
    assert_eq!(engine.fire_schedules(60_000).unwrap(), vec!["purgeRemovedEvery"]);
    assert!(engine.fire_schedules(60_001).unwrap().is_empty());
    let mut last = None;
    while let Some(run) = engine.run_job_chunk(60_002).unwrap() {
        assert_ne!(run.state, JobState::Parked, "{run:?}");
        last = Some(run);
    }
    let run = last.unwrap();
    assert_eq!(run.state, JobState::Done);
    run
}

pub fn all(engine: &mut Engine, viewer: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut cursor = None;
    for _ in 0..10 {
        let result = engine.query("following", Context::new(viewer, args(&[("c", cursor.map(Value::String).unwrap_or(Value::Null))])).at(10)).unwrap();
        assert!(result.complete);
        ids.extend(result.data.as_array().unwrap().iter().filter(|row| **row != Value::Null).map(|row| row.field("eventId").unwrap().as_str().unwrap().to_owned()));
        cursor = result.next;
        if cursor.is_none() { return ids; }
    }
    panic!("cursor did not terminate");
}

pub fn seed_cut_page(engine: &mut Engine) {
    seed(engine, 5);
    for n in 0..40 {
        mutate(engine, "createPost", AUTHOR, &[("postId", id(&format!("cut-{n:02}"))), ("body", Value::String(format!("removed body {n:02}")))], 100 + n);
    }
    for n in 20..40 { mutate(engine, "deletePost", AUTHOR, &[("postId", id(&format!("cut-{n:02}")))], 200 + n); }
}

pub fn check_cut_page(host: &str, mut query: impl FnMut(snapback4_core::Ceilings) -> snapback4_core::QueryOutcome) {
    let control = query(snapback4_core::Ceilings::default());
    assert!(control.complete);
    assert!(control.next.is_some());
    assert_eq!(control.data.as_array().unwrap(), &vec![Value::Null; 20]);
    let cut = query(snapback4_core::Ceilings { examined: 25, ..snapback4_core::Ceilings::default() });
    let visible = cut.data.as_array().map_or(0, |rows| rows.iter().filter(|row| **row != Value::Null).count());
    println!("REMOVAL_CUT host={host} ceiling=25 examined={} returned_events={visible} complete={} next={} control_examined={} control_slots=20", cut.metered.examined, cut.complete, cut.next.is_some(), control.metered.examined);
    assert!(!cut.complete, "a cut tombstone lookup is unknown");
    let json = snapback4_core::wire::to_json(&cut.data).to_string();
    assert!(!json.contains("cut-") && !json.contains("removed body"), "{host}: removed events and their bodies must never render: {json}");
    assert_eq!(cut.data, Value::Null, "withhold the result depending on a cut lookup");
    assert!(cut.next.is_none(), "do not continue past unchecked tombstones");
}
