//! Explicit measurement fixture, kept outside the blocking suite's workload.
use snapback4_core::{Context, Engine, Value, WriteState, value::object};
use std::{collections::BTreeMap, path::PathBuf};

const SOURCE: &str = include_str!("../../snapback4-sim/tests/fixtures/intent-clique.q");
fn id(s: impl Into<String>) -> Value { Value::Id(s.into()) }
fn text(s: impl Into<String>) -> Value { Value::String(s.into()) }

#[test]
#[ignore = "creates the 50k-post/100k-message HTTP measurement store; set SB4_READ_FIXTURE"]
fn create_read_latency_fixture() {
    let root = PathBuf::from(std::env::var("SB4_READ_FIXTURE").expect("SB4_READ_FIXTURE"));
    assert!(!root.exists(), "use a new fixture directory: {}", root.display());
    std::fs::create_dir_all(root.join("snapback")).unwrap();
    std::fs::create_dir_all(root.join(".snapback4")).unwrap();
    std::fs::write(root.join("snapback/schema.q"), SOURCE).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let now = snapback4_core::now_ms();
    engine.seed((0..1000).map(|n| ("profiles".into(), object([
        ("id", id(format!("profile-{n}"))), ("principal", id(format!("dev:u{n:04}"))),
        ("displayName", text(format!("User {n}"))), ("handle", text(format!("u{n:04}"))),
        ("bio", text("")), ("location", text("")), ("link", Value::Null), ("avatar", Value::Null), ("createdAt", Value::Int(now)),
    ])))).unwrap();
    for n in 0..50000 {
        let author = format!("dev:u{:04}", n % 1000);
        let args = BTreeMap::from([("postId".into(), id(format!("p{n:06}"))), ("body".into(), text(format!("Scale post {n}"))), ("parentId".into(), Value::Null)]);
        let out = engine.mutate("createPost", None, Context::new(author, args).at(now + n)).unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
    }
    while engine.run_timeline_chunk(now + 50000).unwrap().is_some() {}
    for (reader, count) in [("u0005", 5), ("u0500", 500)] {
        for n in 0..count {
            let out = engine.mutate("setFollow", None, Context::new(format!("dev:{reader}"), BTreeMap::from([
                ("owner".into(), id(format!("dev:u{n:04}"))), ("set".into(), Value::Bool(true)),
            ])).at(now + 50001)).unwrap();
            assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        }
    }
    while engine.run_timeline_chunk(now + 50001).unwrap().is_some() {}
    engine.seed((0..1000).map(|n| ("members".into(), object([
        ("id", id(format!("member-{n}"))), ("conversationId", id(format!("chat-{n}"))),
        ("principal", id("dev:u0500")), ("role", text("admin")), ("readOrdinal", Value::Int(0)),
    ])))).unwrap();
    engine.seed((0..100000).map(|n| {
        let conversation = if n < 10000 { 0 } else { 1 + (n - 10000) % 999 };
        ("messages".into(), object([
            ("id", id(format!("m{n:06}"))), ("conversationId", id(format!("chat-{conversation}"))),
            ("senderId", id("dev:u0000")), ("body", text(format!("Scale message {n}"))),
            ("ordinal", Value::Int(n)), ("at", Value::Int(now)), ("expiresAt", Value::Null), ("tombstone", Value::Bool(false)),
        ]))
    })).unwrap();
    engine.store().conn().execute("VACUUM INTO ?1", [root.join(".snapback4/store.sqlite").to_str().unwrap()]).unwrap();
    println!("read fixture: 1000 profiles, 50000 posts, 505 follows, 1000 memberships, 100000 messages; {}", root.display());
}

fn measure<T>(name: &str, mut run: impl FnMut() -> T) {
    let mut samples = Vec::new();
    for _ in 0..1000 {
        let start = std::time::Instant::now();
        std::hint::black_box(run());
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    samples.sort_by(f64::total_cmp);
    println!("PHASE {name} n=1000 p50_ms={:.6} p95_ms={:.6} p99_ms={:.6} max_ms={:.6}", samples[499], samples[949], samples[989], samples[999]);
}

#[test]
#[ignore = "measures idle maintenance on SB4_READ_FIXTURE, independently of HTTP and the client"]
fn idle_maintenance_read_latency() {
    let root = PathBuf::from(std::env::var("SB4_READ_FIXTURE").expect("SB4_READ_FIXTURE"));
    let mut engine = Engine::open(snapback4_core::Store::open(&root.join(".snapback4/store.sqlite")).unwrap()).unwrap();
    let now = snapback4_core::now_ms();
    let budget = std::time::Duration::from_micros(250);
    engine.fire_schedules(now).unwrap();
    while engine.run_job_chunk_for(now, budget).unwrap().is_some() {}
    assert!(engine.timeline_work_counts().unwrap().iter().all(|(_, pending, parked)| *pending == 0 && *parked == 0));
    assert_eq!(engine.store().conn().query_row("PRAGMA synchronous", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
    assert_eq!(engine.store().conn().query_row("PRAGMA wal_autocheckpoint", [], |row| row.get::<_, i64>(0)).unwrap(), 1000);
    measure("delivery", || assert!(engine.run_timeline_chunk_for(now, budget).unwrap().is_none()));
    measure("expiry", || assert_eq!(engine.sweep_expired_for(now, 2000, budget).unwrap(), 0));
    measure("schedule", || assert!(engine.fire_schedules(now).unwrap().is_empty()));
    measure("jobs", || assert!(engine.run_job_chunk_for(now, budget).unwrap().is_none()));
    measure("action-leases", || assert_eq!(engine.requeue_expired_actions_for(now, budget).unwrap(), 0));
    measure("effect-leases", || assert_eq!(engine.requeue_expired_effects_for(now, budget).unwrap(), 0));
    measure("assets", || {
        let mut sweep = engine.prepare_asset_sweep_for(now, budget).unwrap();
        sweep.remove_files().unwrap();
        while !sweep.is_empty() { engine.finish_asset_sweep_for(&mut sweep, budget).unwrap(); }
    });
    measure("checkpoint-idle", || engine.store().conn().execute_batch("PRAGMA wal_checkpoint(PASSIVE)").unwrap());
}
