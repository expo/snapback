use snapback4_core::{Context, Engine, Value, WriteState};
use std::collections::BTreeMap;
#[path = "../common/following.rs"]
mod world;
mod removal;
mod slots;
mod promotion;

#[test]
fn w10b_wired_repost_resolves_an_event_reference() {
    use crate::following_app as app;
    let mut engine = app::repost_helper_engine();
    app::mutate(&mut engine, "repost", "reader", &[("postId", app::id("app-post"))], 3);
    app::mutate(&mut engine, "repost", "reader", &[("postId", app::id("app-post"))], 4);
    let page = app::query(&mut engine, "reader");
    assert!(page.complete);
    let rows = page.data.as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].field("postId").unwrap(), &app::id("app-post"));
    assert_eq!(rows[0].field("authorId").unwrap(), &app::id("author"));
    assert_eq!(rows[0].field("repost").unwrap(), &Value::Bool(true));
    assert_eq!(engine.store().rows("reposts").unwrap().len(), 1);
}

#[test]
#[ignore = "design comparison: run explicitly with --ignored --nocapture"]
fn following_candidates_at_scale() {
    let requested = std::env::var("SB4_FEED_CANDIDATE").ok();
    if let Some(mode) = &requested { assert!(["merge", "fanout", "hybrid"].contains(&mode.as_str())); }
    for mode in ["merge", "fanout", "hybrid"].into_iter().filter(|mode| requested.as_deref().is_none_or(|wanted| wanted == *mode)) {
        let bound = world::compiled(&world::candidate(mode));
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        world::seed(&mut engine, mode);
        for n in [0, 1, 2, 3, 4] {
            let mut times = Vec::new();
            let mut page = None;
            for k in 0..23 {
                let start = std::time::Instant::now();
                let read = engine.query("following", Context::new(world::who(n), BTreeMap::new()).at(300_000)).unwrap();
                if k >= 3 { times.push(start.elapsed().as_secs_f64() * 1000.0); }
                page = Some(read);
            }
            times.sort_by(f64::total_cmp);
            let page = page.unwrap();
            let (cold, _) = engine.snapshot(&world::who(n)).unwrap();
            let cold = cold.iter().filter(|e| e.data.is_some()).count();
            println!("MEASURE {mode} reader={n} examined={} index={} complete={} fill={} cold={cold} p95_ms={:.3}", page.metered.examined, page.metered.index_entries, page.complete, page.data.as_array().unwrap().len(), times[18]);
            assert!(page.complete);
            assert_eq!(page.data.as_array().unwrap().len(), 20);
            if mode == "merge" {
                let sparse = engine.query("sparse", Context::new(world::who(n), BTreeMap::new()).at(300_000)).unwrap();
                println!("MEASURE filter reader={n} examined={} index={} complete={} fill={}", sparse.metered.examined, sparse.metered.index_entries, sparse.complete, sparse.data.as_array().unwrap().len());
            }
        }
        for author in [700, 999] {
            let mut times = Vec::new();
            for k in 0..23 {
                let start = std::time::Instant::now();
                let write = world::mutate(&mut engine, "createPost", &world::who(author), &[("postId", world::id(&format!("new-{author}-{k}")))], 300_001 + k);
                if k >= 3 { times.push(start.elapsed().as_secs_f64() * 1000.0); }
                if k == 22 { println!("MEASURE {mode} write={author} examined={} index={} written={}", write.metered.examined, write.metered.index_entries, write.metered.rows_written); }
            }
            times.sort_by(f64::total_cmp);
            println!("MEASURE {mode} write={author} p95_ms={:.3}", times[18]);
        }
    }
}

#[test]
fn hybrid_prototype_compiles() {
    let bound = world::compiled(&world::source());
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert_eq!(bound.schema.operations["following"].runs.as_deref(), Some("device"));
}

#[test]
fn follow_backfill_purge_reposts_and_promotion_are_exact() {
    let bound = world::compiled(&world::source());
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    for viewer in ["dev:alice", "dev:bob"] { world::mutate(&mut engine, "register", viewer, &[], 1); }
    for n in 0..220 {
        world::mutate(&mut engine, "createPost", "dev:alice", &[("postId", world::id(&format!("p{n:03}")))], 10 + n);
    }
    world::mutate(&mut engine, "createPost", "dev:bob", &[("postId", world::id("own"))], 240);
    let follow = world::mutate(&mut engine, "follow", "dev:bob", &[("authorId", world::id("dev:alice"))], 250);
    println!("FOLLOW backfill examined={} index={} written={}", follow.metered.examined, follow.metered.index_entries, follow.metered.rows_written);
    world::mutate(&mut engine, "follow", "dev:bob", &[("authorId", world::id("dev:alice"))], 251);
    let ids = all(&mut engine, "dev:bob");
    assert_eq!(ids.len(), 221);
    assert!(ids.contains(&"p000".into()) && ids.contains(&"p219".into()));
    world::mutate(&mut engine, "repost", "dev:bob", &[("eventId", world::id("p219"))], 260);
    world::mutate(&mut engine, "repost", "dev:bob", &[("eventId", world::id("p219"))], 261);
    assert_eq!(all(&mut engine, "dev:bob").len(), 222);
    let purge = world::mutate(&mut engine, "unfollow", "dev:bob", &[("authorId", world::id("dev:alice"))], 270);
    println!("FOLLOW purge examined={} index={} written={}", purge.metered.examined, purge.metered.index_entries, purge.metered.rows_written);
    assert_eq!(all(&mut engine, "dev:bob").len(), 2, "own original and own repost survive");
    world::mutate(&mut engine, "unfollow", "dev:bob", &[("authorId", world::id("dev:alice"))], 271);
    // Follow-time promotion: old pushes stay private; future posts use the
    // broadcast table. All current followers acquire the new pull lane.
    for n in 0..51 { world::mutate(&mut engine, "follow", &format!("dev:f{n}"), &[("authorId", world::id("dev:alice"))], 300 + n); }
    let posted = world::mutate(&mut engine, "createPost", "dev:alice", &[("postId", world::id("shared"))], 400);
    assert_eq!(posted.metered.rows_written, 2);
    assert_eq!(all(&mut engine, "dev:f0").len(), 221);
    assert_eq!(all(&mut engine, "dev:alice").len(), 221);
    world::mutate(&mut engine, "follow", "dev:bob", &[("authorId", world::id("dev:alice"))], 410);
    assert_eq!(all(&mut engine, "dev:bob").len(), 223, "220 pushed rows, one broadcast, two own events");
    world::mutate(&mut engine, "unfollow", "dev:bob", &[("authorId", world::id("dev:alice"))], 420);
    assert_eq!(all(&mut engine, "dev:bob").len(), 2);
}

fn all(engine: &mut Engine, viewer: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut cursor = None;
    loop {
        let page = engine.query("following", Context::new(viewer, world::args(&[("c", cursor.clone().map(Value::String).unwrap_or(Value::Null))])).at(500_000)).unwrap();
        assert!(page.complete, "{page:?}");
        ids.extend(page.data.as_array().unwrap().iter().map(|r| r.field("eventId").unwrap().as_str().unwrap().to_owned()));
        match page.next { Some(next) => cursor = Some(next), None => break }
    }
    assert_eq!(ids.iter().collect::<std::collections::BTreeSet<_>>().len(), ids.len(), "no duplicate event across pages");
    ids
}

#[test]
fn following_is_full_and_complete_at_the_envelope() {
    let bound = world::compiled(&world::source());
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    world::seed(&mut engine, "hybrid");
    for n in [0, 1, 2, 3, 4, 1000] {
        let mut cursor = None;
        for _ in 0..3 {
            let page = engine.query("following", Context::new(world::who(n), world::args(&[("c", cursor.map(Value::String).unwrap_or(Value::Null))])).at(300_000)).unwrap();
            assert!(page.complete, "reader {n}: {page:?}");
            assert!(page.metered.examined < 100);
            assert!(page.data.as_array().unwrap().len() == 20 || page.next.is_none());
            cursor = page.next;
            if cursor.is_none() { break; }
        }
    }
}

fn recipe() -> String {
    snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).remove(0)
}

#[test]
fn following_card_has_complete_follow_lifecycle() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), recipe())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let call = |engine: &mut Engine, name: &str, who: &str, args: BTreeMap<String, Value>| {
        let result = engine.mutate(name, None, Context::new(who, args).at(100)).unwrap();
        assert!(matches!(result.state, WriteState::Sent { .. }), "{name}: {:?}", result.state);
    };
    call(&mut engine, "register", "dev:alice", BTreeMap::new());
    call(&mut engine, "register", "dev:bob", BTreeMap::new());
    call(&mut engine, "createPost", "dev:alice", BTreeMap::from([("postId".into(), Value::Id("p1".into()))]));
    call(&mut engine, "follow", "dev:bob", BTreeMap::from([("authorId".into(), Value::Id("dev:alice".into()))]));
    let page = engine.query("following", Context::new("dev:bob", BTreeMap::new()).at(101)).unwrap();
    assert!(page.complete);
    assert_eq!(page.data.as_array().unwrap().len(), 1);
    call(&mut engine, "unfollow", "dev:bob", BTreeMap::from([("authorId".into(), Value::Id("dev:alice".into()))]));
    let page = engine.query("following", Context::new("dev:bob", BTreeMap::new()).at(102)).unwrap();
    assert!(page.complete);
    assert!(page.data.as_array().unwrap().is_empty());
}

#[test]
fn following_removes_source_events_at_the_envelope() {
    let bound = world::compiled(&world::source());
    for name in ["deletePost", "unrepost"] {
        assert!(bound.schema.operations.contains_key(name), "feeds card must publish {name}");
        assert_eq!(bound.schema.operations[name].predicts, bound.schema.operations["createPost"].predicts);
    }
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    world::seed(&mut engine, "hybrid");
    for (actor, event) in [(700, "p0700-0049"), (999, "p0999-0199")] {
        let write = world::mutate(&mut engine, "deletePost", &world::who(actor), &[("postId", world::id(event))], 300_000);
        println!("REMOVE actor={actor} examined={} index={} written={}", write.metered.examined, write.metered.index_entries, write.metered.rows_written);
        let readers = std::iter::once(actor).chain(world::graph().into_iter().filter(|(_, a)| *a == actor).map(|(r, _)| r));
        for reader in readers {
            let page = engine.query("following", Context::new(world::who(reader), BTreeMap::new()).at(300_001)).unwrap();
            assert!(page.complete);
            assert!(!page.data.as_array().unwrap().iter().any(|row| row.field("eventId") == Ok(&world::id(event))));
        }
        assert_eq!(engine.store().rows("removedEvents").unwrap().len(), 1);
        let run = engine.run_job("purgeRemoved", BTreeMap::new(), 300_002).unwrap();
        assert_eq!(run.state, snapback4_core::JobState::Done, "{run:?}");
        println!("PURGE scale actor={actor} chunks={} written={}", run.chunks, run.rows_written);
        for table in ["feed", "broadcast"] {
            assert!(!engine.store().rows(table).unwrap().iter().any(|row| row.field("eventId").unwrap() == &world::id(event)), "{table} retains {event}");
        }
        assert!(!engine.store().rows("posts").unwrap().iter().any(|row| row.field("id").unwrap() == &world::id(event)));
    }
}
