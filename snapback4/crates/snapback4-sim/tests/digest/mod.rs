//! The published digest recipes run against the engine, including their limits.
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, JobState, Store, Value, wire};
use snapback4_core::engine::runner::Runner;
use snapback4_core::error::{MeterKind, RuntimeError};
use snapback4_core::meter::{Ceilings, Cut, Meter};
use std::collections::BTreeMap;
use std::time::Instant;

fn source(large: bool) -> String {
    let needle = if large { "job digestLarge(" } else { "job digest(" };
    snapback4_lang::guide::quarry(snapback4_lang::guide::card("jobs").unwrap()).into_iter()
        .find(|block| block.contains(needle)).expect("published digest recipe")
}

fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(b.notes.is_empty(), "{:?}", b.notes);
    b
}

fn engine(source: &str) -> Engine {
    let b = bound(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}

fn period(start: i64, end: i64) -> BTreeMap<String, Value> {
    [("periodStart".into(), Value::Int(start)), ("periodEnd".into(), Value::Int(end))].into()
}

fn seed(e: &mut Engine, rows: Vec<(&str, Json)>) {
    let rows = rows.into_iter().map(|(table, row)| (table.to_owned(), wire::row_from_json(e.schema().table(table).unwrap(), &row).unwrap())).collect::<Vec<_>>();
    e.seed_at(rows, 1_000).unwrap();
}

fn message(chat: &str, ordinal: i64, sender: &str, at: i64) -> Json {
    json!({"id":format!("{chat}-m{ordinal:03}"),"conversationId":chat,"senderId":sender,"ordinal":ordinal,"body":"coffee","tombstone":false,"at":at,"expiresAt":null})
}

fn small(e: &mut Engine) {
    let mut rows = Vec::new();
    for p in ["alice", "bob", "carol"] { rows.push(("profiles", json!({"id":format!("prof-{p}"),"principal":p}))); }
    for (c, people) in [("c1", vec![("alice", 2), ("bob", 0)]), ("c2", vec![("alice", 0), ("bob", 0), ("carol", 5)]), ("c3", vec![("bob", 0), ("carol", 0)])] {
        rows.push(("conversations", json!({"id":c,"title":c})));
        for (p, read) in people { rows.push(("members", json!({"id":format!("{c}-{p}"),"conversationId":c,"principal":p,"readOrdinal":read}))); }
    }
    for o in 1..=5 {
        let mut m = message("c1", o, "bob", 15_000);
        if o == 4 { m["tombstone"] = json!(true); }
        if o == 5 { m["expiresAt"] = json!(20_000); }
        rows.push(("messages", m));
    }
    for o in 1..=4 { rows.push(("messages", message("c2", o, if o % 2 == 1 { "alice" } else { "carol" }, 15_000))); }
    for o in 1..=3 { rows.push(("messages", message("c3", o, "carol", if o == 1 { 5_000 } else { 15_000 }))); }
    seed(e, rows);
}

fn payloads(e: &Engine) -> Vec<Json> {
    let mut payloads = e.effects(None, 100).unwrap().into_iter().map(|effect| wire::to_json(&effect.payload)).collect::<Vec<_>>();
    payloads.sort_by_key(|p| p["targetUserId"].as_str().unwrap().to_owned());
    payloads
}

#[test]
fn period_digest_and_viewer_inbox_agree_before_the_expiry_sweep() {
    let mut e = engine(&source(false));
    small(&mut e);
    let mut expected = Vec::new();
    for (viewer, counts, examined) in [("alice", vec![1, 2], 11), ("bob", vec![0, 4, 2], 14), ("carol", vec![0, 0], 8)] {
        let read = e.query("inbox", Context::new(viewer, period(10_000, 20_000)).at(20_000)).unwrap();
        assert!(read.complete, "{viewer}: {read:?}");
        let rows = read.data.as_array().unwrap();
        assert_eq!(rows.iter().map(|row| row.field("unread").unwrap().as_int().unwrap()).collect::<Vec<_>>(), counts);
        assert_eq!(read.metered.examined, examined);
        if viewer == "alice" { assert!(!rows.iter().any(|row| row.field("conversationId").unwrap() == &Value::Id("c3".into()))); }
        let unread: i64 = counts.iter().sum();
        if unread > 0 { expected.push(json!({"targetUserId":viewer,"kind":"digest","periodStart":10000,"periodEnd":20000,"unread":unread,"chats":counts.iter().filter(|n| **n > 0).count()})); }
        println!("period inbox {viewer}: {counts:?}, examined={examined}");
    }
    // The retained 0.2.27 probe's inbox starts at zero, unlike its job.
    for (viewer, counts, examined) in [("alice", vec![1, 2], 11), ("bob", vec![0, 4, 3], 15), ("carol", vec![0, 0], 9)] {
        let read = e.query("inbox", Context::new(viewer, period(0, 20_000)).at(20_000)).unwrap();
        assert_eq!(read.data.as_array().unwrap().iter().map(|row| row.field("unread").unwrap().as_int().unwrap()).collect::<Vec<_>>(), counts);
        assert_eq!(read.metered.examined, examined);
        println!("all-history inbox {viewer}: {counts:?}, examined={examined}");
    }
    let before = e.store().rows("messages").unwrap();
    assert_eq!(before.len(), 12, "expired row is still physically present");
    let run = e.run_job("digest", period(10_000, 20_000), 20_000).unwrap();
    assert_eq!((run.state, run.chunks, run.rows_written), (JobState::Done, 3, 0));
    assert_eq!(payloads(&e), expected);
    assert_eq!(e.store().rows("messages").unwrap(), before);
    assert_eq!(e.sweep_expired(20_000, 100).unwrap(), 1);
}

fn hub(e: &mut Engine, per: i64, in_period: i64, small_profile: bool) {
    let mut rows = vec![("profiles", json!({"id":"prof-hub","principal":"hub"}))];
    if small_profile { rows.push(("profiles", json!({"id":"prof-a","principal":"a"}))); }
    for c in 0..1000 {
        let chat = format!("c{c:04}");
        rows.push(("conversations", json!({"id":chat,"title":chat})));
        rows.push(("members", json!({"id":format!("{chat}-hub"),"conversationId":chat,"principal":"hub","readOrdinal":0})));
        rows.push(("members", json!({"id":format!("{chat}-peer"),"conversationId":chat,"principal":format!("peer{c}"),"readOrdinal":0})));
        if small_profile && c == 0 { rows.push(("members", json!({"id":"c0000-a","conversationId":chat,"principal":"a","readOrdinal":0}))); }
        for o in 1..=per { rows.push(("messages", message(&chat, o, &format!("peer{c}"), if o > per - in_period { 15_000 } else { 5_000 }))); }
    }
    seed(e, rows);
}

fn with_ordinal(source: &str) -> String {
    let ordinal = source.split("fn unreadIn(").nth(1).unwrap().split("schedule daily").next().unwrap()
        .replace("unreadIn(", "unreadByOrdinal(").replace("query inbox(", "query ordinalInbox(")
        .replace("job digest(", "job digestByOrdinal(")
        .replace("messages[conversationId, at >= periodStart, at < periodEnd] first 100 by byConversationTime where not .tombstone and .senderId != reader and .ordinal > readOrdinal",
            "messages[conversationId, ordinal > readOrdinal] first 100 by byConversationOrdinal where not .tombstone and .senderId != reader and .at >= periodStart and .at < periodEnd");
    format!("{source}\nfn unreadByOrdinal({ordinal}")
}

// JobRun does not expose its meter. Execute the compiled single-profile chunk
// under the same system context and Cut::Abort in a rolled-back transaction.
// A lowered ceiling immediately below the count proves the exact examination
// count without changing any product ceiling or adding instrumentation.
fn measured_chunk(e: &mut Engine, job: &str, examined: u64) -> Result<Value, RuntimeError> {
    let program = e.program(job).unwrap().clone();
    let schema = e.schema().clone();
    let mut context = Context::system().at(20_000);
    context.args = period(10_000, 20_000);
    assert!(examined <= Ceilings::job().examined);
    let tx = e.store_mut().read_transaction().unwrap();
    let result = Runner::new(&tx, &schema, context, Meter::new(Ceilings { examined, ..Ceilings::job() }, Cut::Abort), 0).run(&program);
    tx.rollback().unwrap();
    result
}

#[test]
fn hub_seeks_the_period_in_one_chunk_and_ordinal_history_parks_on_examined() {
    let mut e = engine(&with_ordinal(&source(false)));
    hub(&mut e, 20, 5, false);
    let error = measured_chunk(&mut e, "digestByOrdinal", 16_384).unwrap_err();
    assert!(matches!(error, RuntimeError::Bound { kind: MeterKind::Examined, actual: 16_385, ceiling: 16_384, .. }), "{error:?}");
    let started = Instant::now();
    let ordinal = e.run_job("digestByOrdinal", period(10_000, 20_000), 20_000).unwrap();
    assert_eq!((ordinal.state, ordinal.chunks, ordinal.rows_written), (JobState::Parked, 0, 0));
    assert_eq!(ordinal.error.as_deref(), Some("E_BOUND: examined rows reached the ceiling 16384"));
    assert!(payloads(&e).is_empty());
    println!("hub 1000x20 ordinal: examined=16385, ceiling=16384, elapsed_ms={}", started.elapsed().as_millis());
    measured_chunk(&mut e, "digest", 7_003).unwrap();
    let error = measured_chunk(&mut e, "digest", 7_002).unwrap_err();
    assert!(matches!(error, RuntimeError::Bound { kind: MeterKind::Examined, actual: 7_003, ceiling: 7_002, .. }), "{error:?}");
    let started = Instant::now();
    let time = e.run_job("digest", period(10_000, 20_000), 20_000).unwrap();
    assert_eq!((time.state, time.chunks, time.rows_written), (JobState::Done, 1, 0));
    assert_eq!(payloads(&e), [json!({"targetUserId":"hub","kind":"digest","periodStart":10000,"periodEnd":20000,"unread":5000,"chats":1000})]);
    println!("hub 1000x20 time: examined=7003, chunks=1, writes=0, effects=1, elapsed_ms={}", started.elapsed().as_millis());
}

#[test]
fn parked_digest_queued_again_is_a_new_run_and_reemits_completed_profiles() {
    let mut e = engine(&with_ordinal(&source(false)));
    hub(&mut e, 20, 5, true);
    let mut ids = Vec::new();
    for n in 1..=2 {
        let run = e.run_job("digestByOrdinal", period(10_000, 20_000), 20_000 + n).unwrap();
        assert_eq!((run.state, run.chunks), (JobState::Parked, 1));
        assert_eq!(run.error.as_deref(), Some("E_BOUND: examined rows reached the ceiling 16384"));
        ids.push(run.id);
        let effects = payloads(&e);
        assert_eq!(effects.len(), n as usize);
        assert!(effects.iter().all(|p| p["targetUserId"] == "a" && p["unread"] == 5));
        println!("parked retry {n}: committed chunks=1, effects={}", effects.len());
    }
    assert_ne!(ids[0], ids[1]);
}

#[test]
fn schedule_and_chunk_cursor_survive_restart_but_manual_run_reemits() {
    let dir = std::env::temp_dir().join(format!("sb4-digest-{}-{}", std::process::id(), snapback4_core::now_ms()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let b = bound(&source(false).replace("schedule daily every 1d at 08:00", "schedule daily every 1m"));
    let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    small(&mut e);
    assert!(e.fire_schedules(1_000).unwrap().is_empty());
    drop(e);
    let mut e = Engine::open(Store::open(&path).unwrap()).unwrap();
    assert_eq!(e.fire_schedules(60_000).unwrap(), ["daily"]);
    let first = e.run_job_chunk(60_000).unwrap().unwrap();
    assert_eq!((first.state, first.chunks), (JobState::Running, 1));
    assert_eq!(payloads(&e).len(), 1);
    drop(e);
    let mut e = Engine::open(Store::open(&path).unwrap()).unwrap();
    assert!(e.fire_schedules(60_001).unwrap().is_empty());
    while e.run_job_chunk(60_001).unwrap().is_some() {}
    let effects = payloads(&e);
    assert_eq!(effects.len(), 2);
    assert_eq!(effects[0]["targetUserId"], "alice");
    assert_eq!(effects[1]["targetUserId"], "bob");
    assert!(effects.iter().all(|p| p["periodStart"] == 0 && p["periodEnd"] == 60_000));
    assert_eq!(e.jobs(10).unwrap().len(), 1);
    assert_eq!(e.job(&first.id).unwrap().unwrap().chunks, 3);
    let repeat = e.run_job("digest", period(0, 60_000), 60_002).unwrap();
    assert_ne!(repeat.id, first.id);
    assert_eq!(payloads(&e).len(), 4);
    drop(e);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn membership_chunks_total_the_same_digest_and_delete_the_totals() {
    let more_members = |e: &mut Engine| {
        small(e);
        let mut rows = Vec::new();
        for c in 0..30 {
            let chat = format!("extra{c:02}");
            rows.push(("conversations", json!({"id":chat,"title":chat})));
            rows.push(("members", json!({"id":chat,"conversationId":chat,"principal":"alice","readOrdinal":0})));
            rows.push(("messages", message(&chat, 1, "bob", 15_000)));
        }
        seed(e, rows);
    };
    let mut single = engine(&source(false));
    more_members(&mut single);
    single.run_job("digest", period(10_000, 20_000), 20_000).unwrap();
    let mut large = engine(&source(true));
    more_members(&mut large);
    seed(&mut large, vec![("members", json!({"id":"orphan","conversationId":"c1","principal":"no-profile","readOrdinal":0}))]);
    let run = large.run_job("digestLarge", period(10_000, 20_000), 20_000).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!(payloads(&large), payloads(&single));
    assert!(large.store().rows("digestTotals").unwrap().is_empty());
    println!("large digest: chunks={}, writes={}, effects=2, totals left=0", run.chunks, run.rows_written);
}

#[test]
fn single_profile_stops_at_the_exact_examined_envelope() {
    let mut e = engine(&source(false));
    hub(&mut e, 20, 14, false);
    // 14,381 period messages + 1,000 members + 1,002 scan attempts
    // + one profile row = exactly 16,384 examinations.
    let extra = (0..381).map(|c| ("messages", message(&format!("c{c:04}"), 21, &format!("peer{c}"), 15_000))).collect();
    seed(&mut e, extra);
    measured_chunk(&mut e, "digest", 16_384).unwrap();
    let error = measured_chunk(&mut e, "digest", 16_383).unwrap_err();
    assert!(matches!(error, RuntimeError::Bound { kind: MeterKind::Examined, actual: 16_384, ceiling: 16_383, .. }), "{error:?}");
    let run = e.run_job("digest", period(10_000, 20_000), 20_000).unwrap();
    assert_eq!((run.state, run.chunks), (JobState::Done, 1));
    assert_eq!(payloads(&e)[0]["unread"], 14_381);
    seed(&mut e, vec![("messages", message("c0381", 21, "peer381", 15_000))]);
    let run = e.run_job("digest", period(10_000, 20_000), 20_001).unwrap();
    assert_eq!((run.state, run.chunks), (JobState::Parked, 0));
    assert_eq!(run.error.as_deref(), Some("E_BOUND: examined rows reached the ceiling 16384"));
    assert_eq!(payloads(&e).len(), 1, "the refused profile emitted nothing");
    println!("time-seek boundary: 14381 period messages -> 16384 examined/done; 14382 -> 16385 attempted/parked; effects stay 1");
}

#[test]
fn remind_seeks_immutable_time_instead_of_breaking_in_id_order() {
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("jobs").unwrap()).into_iter()
        .find(|block| block.contains("job remind(")).unwrap();
    let mut e = engine(&source);
    seed(&mut e, [("a-future", 30_000), ("b-period", 15_000), ("c-old", 5_000), ("d-end", 20_000), ("e-start", 10_000)]
        .into_iter().map(|(id, at)| ("invites", json!({"id":id,"inviteeId":"alice","sentAt":at,"reminded":false}))).collect());
    let run = e.run_job("remind", period(10_000, 20_000), 20_000).unwrap();
    assert_eq!((run.state, run.rows_written), (JobState::Done, 2));
    for row in e.store().rows("invites").unwrap() {
        let at = row.field("sentAt").unwrap().as_int().unwrap();
        assert_eq!(row.field("reminded").unwrap(), &Value::Bool((10_000..20_000).contains(&at)));
    }
}
