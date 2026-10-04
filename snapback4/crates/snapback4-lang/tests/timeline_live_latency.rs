//! Contention service is bounded by rows/turns, not machine speed.
// @ref LLP 3000#contended-read-serving — a live delivery need not drain older bulk work.
use snapback4_core::{Context, Engine, Store, Value, WriteState};
use std::time::{Duration, Instant};
const SOURCE: &str = include_str!("fixtures/timeline-v2.q");
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn engine(source: &str) -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn write(e: &mut Engine, op: &str, viewer: &str, args: &[(&str, Value)], at: i64) {
    let out = e.mutate(op, None, Context::new(viewer, args.iter().map(|(k,v)| (k.to_string(),v.clone())).collect()).at(at)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}
fn post(e: &mut Engine, name: &str, at: i64) { write(e, "post", "alice", &[("postId", id(name)), ("parentId", Value::Null)], at); }
fn drain(e: &mut Engine) {
    for _ in 0..10_000 { if e.run_timeline_turn_for(5000, Duration::ZERO).unwrap().is_none() { return; } }
    panic!("finite healthy queue did not drain");
}
fn fixture(source: &str) -> Engine {
    let mut e = engine(source);
    for n in 0..120 { post(&mut e, &format!("old{n:03}"), n + 1); }
    drain(&mut e);
    for viewer in ["bob", "carol"] { write(&mut e, "follow", viewer, &[("actor", id("alice"))], 200); }
    e
}
fn has(e: &Engine, table: &str, viewer: &str, event: &str) -> bool {
    e.store().rows(table).unwrap().iter().any(|r| r.field("readerId").unwrap() == &id(viewer) && r.field("eventId").unwrap() == &id(event))
}

#[test]
fn small_delivery_overtakes_two_unfinished_backfills_without_expanding_a_slice() {
    let mut e = fixture(SOURCE);
    post(&mut e, "live", 201);
    let committed = Instant::now();
    let mut turns = 0;
    while !has(&e, "feedFeed", "carol", "live") && turns < 9 {
        let used = e.run_timeline_turn_for(300, Duration::ZERO).unwrap().unwrap();
        assert!(used.rows_written <= 2, "at most one recipient and its cursor, {used:?}");
        turns += 1;
    }
    assert!(has(&e, "feedFeed", "bob", "live"));
    assert!(has(&e, "feedFeed", "carol", "live"), "small delivery waited behind the entire backfill");
    let delivered = Instant::now();
    assert!(e.timeline_work_counts().unwrap()[0].1 >= 2, "bulk remains pending at live delivery");
    drain(&mut e);
    assert_eq!(e.timeline_work_counts().unwrap()[0].1, 0);
    assert_eq!(e.store().rows("feedFeed").unwrap().len(), 121 * 3);
    let bulk_complete = Instant::now();
    assert!(committed <= delivered && delivered <= bulk_complete);
    // Hang guard only; the deterministic row/turn assertions carry the regression.
    assert!(bulk_complete.duration_since(committed) < Duration::from_secs(60));
    eprintln!("live delivery turns={turns}; commit_to_delivery_ms={:.3}; bulk_drain_ms={:.3}", delivered.duration_since(committed).as_secs_f64()*1000., bulk_complete.duration_since(committed).as_secs_f64()*1000.);
}

#[test]
fn oldest_first_control_reproduces_the_head_of_line_block() {
    let mut e = fixture(SOURCE);
    post(&mut e, "live", 201);
    for _ in 0..9 { e.run_timeline_chunk_for(300, Duration::ZERO).unwrap(); }
    assert!(!has(&e, "feedFeed", "bob", "live"));
    assert!(!has(&e, "feedFeed", "carol", "live"));
}

#[test]
fn wide_live_fanout_does_not_repeatedly_examine_unconsumed_followers() {
    let mut single = None;
    for width in [1, 32, 900] {
        let mut e = engine(SOURCE);
        for n in 0..width {
            write(&mut e, "follow", &format!("reader{n:04}"), &[("actor", id("alice"))], 1);
        }
        // This is the replay fixture: no historical posts, hence no backfill
        // or cleanup backlog to blame for slow delivery to the last follower.
        assert_eq!(e.timeline_work_counts().unwrap()[0].1, 0);
        post(&mut e, "live", 2);
        assert_eq!(e.timeline_work_counts().unwrap()[0].1, 1);
        let mut turns = 0;
        let mut examined = 0;
        while let Some(used) = e.run_timeline_turn_for(3, Duration::ZERO).unwrap() {
            if turns == 0 {
                if let Some(one) = single {
                    assert!(used.examined <= one + 4,
                        "one recipient must not pay for a wide unconsumed page: {width}/{used:?}, single={one}");
                } else { single = Some(used.examined); }
            }
            assert!(used.rows_written <= 2, "one recipient plus durable progress: {used:?}");
            examined += used.examined;
            turns += 1;
            assert!(turns <= width + 1, "finite fan-out failed to advance");
        }
        assert_eq!(e.store().rows("feedFeed").unwrap().len(), width + 1);
        assert!(has(&e, "feedFeed", &format!("reader{:04}", width - 1), "live"));
        eprintln!("fanout width={width} turns={turns} examined={examined}");
    }
}

#[test]
fn turns_rotate_declarations_and_wrap_across_a_clock_rewind() {
    let source = SOURCE.replace("mutation post(postId:", "maintain second: timeline\n  events posts where .parentId = null and not .removed by authorId, at removed by removed\n  reposts reposts by actorId, postId, at\n  edges follows by followerId, followedId\n\nmutation post(postId:");
    let mut e = fixture(&source);
    // All admission/edge comparisons use their durable tokens, never queue time.
    post(&mut e, "rewound", -100);
    for _ in 0..18 { e.run_timeline_turn_for(300, Duration::ZERO).unwrap(); }
    for table in ["feedFeed", "secondFeed"] {
        for viewer in ["bob", "carol"] { assert!(has(&e, table, viewer, "rewound"), "{table}/{viewer}"); }
    }
    assert!(e.timeline_work_counts().unwrap().iter().all(|(_,pending,_)| *pending > 0));
    drain(&mut e);
}

#[test]
fn fair_turns_preserve_refollow_epochs_and_removal_while_bulk_is_pending() {
    let mut e = fixture(SOURCE);
    post(&mut e, "gone", 201);
    for _ in 0..3 { e.run_timeline_turn_for(300, Duration::ZERO).unwrap(); }
    write(&mut e, "unfollow", "bob", &[("actor", id("alice"))], 202);
    write(&mut e, "follow", "bob", &[("actor", id("alice"))], 203);
    write(&mut e, "remove", "alice", &[("postId", id("gone"))], 204);
    for _ in 0..1000 {
        for viewer in ["bob", "carol"] {
            let read=e.query("home", Context::new(viewer, Default::default()).at(400)).unwrap();
            assert!(read.data.as_array().unwrap().iter().all(|r| r.field("id").unwrap()!=&id("gone")));
        }
        if e.run_timeline_turn_for(400, Duration::ZERO).unwrap().is_none() { break; }
    }
    assert_eq!(e.timeline_work_counts().unwrap(), [("feed".into(),0,0)]);
    assert_eq!(e.store().rows("feedFeed").unwrap().len(), 120 * 3);
}

#[test]
fn reopening_and_adoption_reset_only_the_service_hint() {
    let dir=std::env::temp_dir().join(format!("lu-turns-{}",std::process::id()));
    std::fs::create_dir(&dir).unwrap();
    let path=dir.join("store.sqlite");
    let mut e=fixture(SOURCE);
    post(&mut e, "live", 201);
    for _ in 0..4 { e.run_timeline_turn_for(300, Duration::ZERO).unwrap(); }
    // Backup persists rows and their progress; the scheduling hint is disposable.
    e.store().conn().execute("VACUUM INTO ?1", [path.to_str().unwrap()]).unwrap();
    let mut reopened=Engine::open(Store::open(&path).unwrap()).unwrap();
    let b=snapback4_lang::compile(&[("schema.q".into(),SOURCE.into())]);
    reopened.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    drain(&mut e);drain(&mut reopened);
    assert_eq!(e.store().rows("feedFeed").unwrap(),reopened.store().rows("feedFeed").unwrap());
    drop(reopened);std::fs::remove_dir_all(dir).unwrap();
}
