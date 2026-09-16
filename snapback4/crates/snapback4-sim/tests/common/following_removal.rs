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
        rows.push(("posts".into(), object([("id", id(event)), ("postId", id(event)), ("actorId", id(actor)), ("authorId", id(actor)), ("repost", Value::Bool(false)), ("at", Value::Int(1)), ("shared", Value::Bool(false))])));
    }
    for viewer in std::iter::once(AUTHOR.to_owned()).chain((0..followers).map(reader)) {
        rows.push(("feed".into(), object([("id", id(&format!("inbox-{viewer}"))), ("eventId", id("old-pushed")), ("readerId", id(&viewer)), ("actorId", id(AUTHOR)), ("authorId", id(AUTHOR)), ("postId", id("old-pushed")), ("repost", Value::Bool(false)), ("at", Value::Int(1))])));
    }
    engine.seed(super::world::with_pull_counts(rows)).unwrap();
    for (op, input, at) in [
        ("createPost", args(&[("postId", id("new-post"))]), 2),
        ("repost", args(&[("eventId", id(ORIGINAL))]), 3),
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
        ids.extend(result.data.as_array().unwrap().iter().map(|row| row.field("eventId").unwrap().as_str().unwrap().to_owned()));
        cursor = result.next;
        if cursor.is_none() { return ids; }
    }
    panic!("cursor did not terminate");
}

// An application's additional insert path must obey the recipe's table rule.
pub fn authority_source() -> String {
    format!("{}\nmutation forgeRemoval(eventId: posts, markerId: id, actorId: principal):\n  insert removedEvents {{ id: markerId, eventId, actorId }}\nmutation forgeImplicit(eventId: posts):\n  insert removedEvents {{ eventId, actorId: viewer }}\n", super::world::source())
}

pub const PRIVATE: &str = "dev:private";
pub const INTRUDER: &str = "dev:intruder";

pub fn seed_authority(engine: &mut Engine, hidden: bool) {
    seed(engine, 5);
    // Identical attacker-visible state. The victim can read its own copy;
    // only the unreadable copy's event identity differs between worlds.
    engine.seed([("feed".into(), object([
        ("id", id("private-copy")), ("readerId", id(PRIVATE)),
        ("eventId", id(if hidden { "new-post" } else { "old-pushed" })),
        ("actorId", id(AUTHOR)), ("authorId", id(AUTHOR)), ("postId", id("new-post")),
        ("repost", Value::Bool(false)), ("at", Value::Int(2)),
    ]))]).unwrap();
}

pub fn seed_cut(engine: &mut Engine, followers: usize) {
    seed(engine, 5);
    for n in 0..40 {
        mutate(engine, "createPost", AUTHOR, &[("postId", id(&format!("cut-{n:02}")))], 100 + n);
    }
    if followers > 50 {
        // Real promotion leaves the removed old pushes in the inbox and adds
        // a live broadcast lane. Removing shared posts alone deletes their
        // broadcasts immediately and would miss the long tombstone run.
        for n in 5..followers { mutate(engine, "follow", &reader(n), &[("authorId", id(AUTHOR))], 150); }
        mutate(engine, "createPost", AUTHOR, &[("postId", id("broadcast-live"))], 160);
        assert!(engine.store().rows("pulls").unwrap().iter().any(|row| row.field("readerId") == Ok(&id(&reader(0)))));
        assert!(engine.store().rows("broadcast").unwrap().iter().any(|row| row.field("eventId") == Ok(&id("broadcast-live"))));
    }
    let before = page(engine, &reader(0));
    assert_eq!(before.data.as_array().unwrap().len(), 20);
    assert!(before.next.is_some());
    for n in 20..40 { mutate(engine, "deletePost", AUTHOR, &[("postId", id(&format!("cut-{n:02}")))], 200 + n); }
}

pub fn wire(page: &snapback4_core::QueryOutcome) -> serde_json::Value {
    serde_json::json!({"data":snapback4_core::wire::to_json(&page.data), "complete":page.complete, "next":page.next, "seq":page.seq, "tables":page.tables, "nextExpiry":page.next_expiry})
}

// @ref LLP 3000.007#20.12 — every returned event must have completed its public tombstone predicate.
pub fn check_cut(host: &str, followers: usize, mut query: impl FnMut(snapback4_core::Ceilings) -> snapback4_core::QueryOutcome) {
    let uncut = query(Default::default());
    assert!(uncut.complete);
    let cost = uncut.metered.examined;
    assert_eq!(uncut.data.as_array().unwrap().len(), 20);
    assert!(uncut.next.is_some());
    if followers > 50 { assert!(uncut.data.as_array().unwrap().iter().any(|row| row.field("postId") == Ok(&id("broadcast-live")))); }
    assert_eq!(uncut.metered.examined, if followers > 50 { 85 } else { 82 });
    assert_eq!(uncut.metered.rule_probes, if followers > 50 { 42 } else { 41 });
    let mut leaked = Vec::new();
    let mut unsafe_cursors = Vec::new();
    for ceiling in 1..=cost {
        let page = query(snapback4_core::Ceilings { examined: ceiling, ..Default::default() });
        let json = wire(&page).to_string();
        let removed = (20..40).filter(|n| json.contains(&format!("cut-{n:02}"))).count();
        if removed > 0 { leaked.push((ceiling, removed)); }
        if page.capped_at.is_some() && page.next.is_some() { unsafe_cursors.push(ceiling); }
        if ceiling == 25 {
            println!("REMOVAL_CUT host={host} followers={followers} ceiling=25 examined={} removed={removed} complete={} next={} rows={}", page.metered.examined, page.complete, page.next.is_some(), page.data.as_array().map_or(0, |rows| rows.len()));
            assert!(!page.complete);
            assert_eq!(page.data, Value::Array(vec![]));
            assert!(page.next.is_none());
        }
    }
    println!("REMOVAL_SWEEP host={host} followers={followers} ceilings=1..={cost} leaked_ceilings={} unsafe_cursors={} uncut_rows={} uncut_probes={} uncut_next={}", leaked.len(), unsafe_cursors.len(), uncut.data.as_array().unwrap().len(), uncut.metered.rule_probes, uncut.next.is_some());
    assert!(leaked.is_empty(), "unchecked removed events on {host}: {leaked:?}");
    assert!(unsafe_cursors.is_empty(), "cut merge continuations on {host}: {unsafe_cursors:?}");
    assert!(uncut.data.as_array().unwrap().iter().all(|row| *row != Value::Null));
}

// Exercise the allocation of the next tombstone key inside the predicate,
// with examination and probe budgets still open. Exists itself allocates no row.
pub fn check_heap_cut(host: &str, mut query: impl FnMut(snapback4_core::Ceilings) -> snapback4_core::QueryOutcome) {
    let heap_bytes = 20;
    let page = query(snapback4_core::Ceilings { heap_bytes, ..Default::default() });
    assert_eq!(page.capped_at.as_ref().map(|(kind, _)| *kind), Some(snapback4_core::error::MeterKind::HeapBytes));
    assert_eq!(page.metered.rule_probes, 1);
    assert_eq!(page.metered.examined, 3, "one completed tombstone probe; the second candidate is allocating its key");
    assert_eq!(page.metered.heap_bytes, 26);
    assert!(!page.complete);
    assert!(page.next.is_none());
    assert_eq!(page.data, Value::Null, "no unchecked event survives heap unwind");
    println!("REMOVAL_HEAP host={host} ceiling={heap_bytes} charged={} examined={} probes={} data={:?} next=false complete=false", page.metered.heap_bytes, page.metered.examined, page.metered.rule_probes, page.data);
    let live = query(Default::default());
    assert!(live.complete);
    assert_eq!(live.data.as_array().unwrap().len(), 20);
    assert!(live.next.is_some());
}
