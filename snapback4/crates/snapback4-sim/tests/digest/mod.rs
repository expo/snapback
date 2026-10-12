//! The compatibility digest recipes run against the engine, including their limits.
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, JobState, Store, Value, wire};
use snapback4_core::engine::runner::Runner;
use snapback4_core::error::{MeterKind, RuntimeError};
use snapback4_core::meter::{Ceilings, Cut, Meter};
use std::collections::BTreeMap;
use std::time::Instant;

fn source() -> String {
    include_str!("../../../snapback4-lang/tests/fixtures/legacy-digest.q").into()
}

fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    // @ref LLP 3000.019#3.1 — the legacy recipe counts explicit ascending pages over an ordinal window; that remains runnable but now carries order advice.
    let advised: Vec<_> = b.programs.iter().filter(|p| matches!(p.program.name.as_str(), "inbox" | "ordinalInbox")).collect();
    // The `forge` mutation writes `digestMarkers` (`insert <- deny`) on purpose to
    // prove forgery is refused; `check` notes that write as unreachable (LLP 3000.036 §3 C).
    let forged = b.programs.iter().filter(|p| p.program.name == "forge").count();
    let denied: Vec<_> = b.notes.iter().filter(|note| note.code == "N_WRITE_DENIED").collect();
    assert_eq!(denied.len(), forged, "{:?}", b.notes);
    assert!(denied.iter().all(|note| note.message.starts_with("digestMarkers has ") && note.message.contains("in `forge`")), "{:?}", b.notes);
    assert_eq!(b.notes.len(), advised.len() + forged, "{:?}", b.notes);
    for program in advised {
        assert!(b.notes.iter().any(|note| note.code == "N_SYNC_ORDER"
            && note.message.starts_with(&format!("query {} ", program.program.name))), "{:?}", b.notes);
    }
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
    let mut e = engine(&source());
    small(&mut e);
    let mut expected = Vec::new();
    // The unswept expired message costs no examined unit (LLP 3000.007 §20.24.6).
    for (viewer, counts, examined) in [("alice", vec![1, 2], 10), ("bob", vec![0, 4, 2], 13), ("carol", vec![0, 0], 8)] {
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
    // The unswept expired message costs no examined unit (LLP 3000.007 §20.24.6).
    for (viewer, counts, examined) in [("alice", vec![1, 2], 10), ("bob", vec![0, 4, 3], 14), ("carol", vec![0, 0], 9)] {
        let read = e.query("inbox", Context::new(viewer, period(0, 20_000)).at(20_000)).unwrap();
        assert_eq!(read.data.as_array().unwrap().iter().map(|row| row.field("unread").unwrap().as_int().unwrap()).collect::<Vec<_>>(), counts);
        assert_eq!(read.metered.examined, examined);
        println!("all-history inbox {viewer}: {counts:?}, examined={examined}");
    }
    let before = e.store().rows("messages").unwrap();
    assert_eq!(before.len(), 12, "expired row is still physically present");
    let run = e.run_job("digest", period(10_000, 20_000), 20_000).unwrap();
    assert_eq!((run.state, run.chunks, run.rows_written), (JobState::Done, 3, 3));
    assert_eq!(payloads(&e), expected);
    let markers = e.store().rows("digestMarkers").unwrap();
    let marker_bytes = markers.iter().map(|row| snapback4_core::value::canonical_json(row).len()).sum::<usize>();
    println!("atomic digest: chunks=3 writes=3 effects=2 markers={} canonical_marker_bytes={marker_bytes}", markers.len());
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
    let helper = source.split("fn unreadIn(").nth(1).unwrap().split("table digestMarkers:").next().unwrap();
    let job = source.split("job digest(").nth(1).unwrap().split("schedule daily").next().unwrap();
    let ordinal = format!("fn unreadIn({helper}job digestByOrdinal({job}")
        .replace("unreadIn(", "unreadByOrdinal(").replace("query inbox(", "query ordinalInbox(")
        .replace("messages[conversationId, at >= periodStart, at < periodEnd] first 101 by byConversationTime where not .tombstone and .senderId != reader and .ordinal > readOrdinal",
            "messages[conversationId, ordinal > readOrdinal] first 101 by byConversationOrdinal where not .tombstone and .senderId != reader and .at >= periodStart and .at < periodEnd");
    format!("{source}\n{ordinal}")
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
    let mut e = engine(&with_ordinal(&source()));
    hub(&mut e, 20, 5, false);
    let error = measured_chunk(&mut e, "digestByOrdinal", 16_384).unwrap_err();
    assert!(matches!(error, RuntimeError::Bound { kind: MeterKind::Examined, actual: 16_385, ceiling: 16_384, .. }), "{error:?}");
    let started = Instant::now();
    let ordinal = e.run_job("digestByOrdinal", period(10_000, 20_000), 20_000).unwrap();
    assert_eq!((ordinal.state, ordinal.chunks, ordinal.rows_written), (JobState::Parked, 0, 0));
    assert_eq!(ordinal.error.as_deref(), Some("E_BOUND: examined rows reached the ceiling 16384"));
    assert!(payloads(&e).is_empty());
    println!("hub 1000x20 ordinal: examined=16385, ceiling=16384, elapsed_ms={}", started.elapsed().as_millis());
    measured_chunk(&mut e, "digest", 7_004).unwrap();
    let error = measured_chunk(&mut e, "digest", 7_003).unwrap_err();
    assert!(matches!(error, RuntimeError::Bound { kind: MeterKind::Examined, actual: 7_004, ceiling: 7_003, .. }), "{error:?}");
    let started = Instant::now();
    let time = e.run_job("digest", period(10_000, 20_000), 20_000).unwrap();
    assert_eq!((time.state, time.chunks, time.rows_written), (JobState::Done, 1, 1));
    assert_eq!(payloads(&e), [json!({"targetUserId":"hub","kind":"digest","periodStart":10000,"periodEnd":20000,"unread":5000,"chats":1000})]);
    println!("hub 1000x20 time: examined=7004, chunks=1, writes=1, effects=1, elapsed_ms={}", started.elapsed().as_millis());
}

#[test]
fn parked_digest_replacement_skips_completed_profiles() {
    let mut e = engine(&with_ordinal(&source()));
    hub(&mut e, 20, 5, true);
    let mut ids = Vec::new();
    for n in 1..=2 {
        let run = e.run_job("digestByOrdinal", period(10_000, 20_000), 20_000 + n).unwrap();
        assert_eq!((run.state, run.chunks), (JobState::Parked, 1));
        assert_eq!(run.error.as_deref(), Some("E_BOUND: examined rows reached the ceiling 16384"));
        ids.push(run.id);
        let effects = payloads(&e);
        assert_eq!(effects.len(), 1);
        assert_eq!(e.store().rows("digestMarkers").unwrap().len(), 1);
        assert!(effects.iter().all(|p| p["targetUserId"] == "a" && p["unread"] == 5));
        println!("parked retry {n}: committed chunks=1, effects={}", effects.len());
    }
    assert_ne!(ids[0], ids[1]);
}

#[test]
fn schedule_cursor_and_markers_survive_restart_and_manual_rerun() {
    let dir = std::env::temp_dir().join(format!("sb4-digest-{}-{}", std::process::id(), snapback4_core::now_ms()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let b = bound(&source().replace("schedule daily every 1d at 08:00", "schedule daily every 1m"));
    let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    small(&mut e);
    assert!(e.fire_schedules(1_000).unwrap().is_empty());
    drop(e);
    let mut e = Engine::open(Store::open(&path).unwrap()).unwrap();
    assert_eq!(e.fire_schedules(60_000).unwrap(), ["daily"]);
    // Restart after admission, before the first recipient transaction.
    drop(e);
    let mut e = Engine::open(Store::open(&path).unwrap()).unwrap();
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
    assert_eq!(payloads(&e).len(), 2);
    assert_eq!(repeat.rows_written, 0);
    assert_eq!(e.store().rows("digestMarkers").unwrap().len(), 3);
    drop(e);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn refusal_before_or_after_emit_or_marker_rolls_back_the_whole_recipient() {
    let original = source();
    let emit = "      emit push { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, unread, chats }";
    let marker = "    insert digestMarkers { principal: p.principal, periodEnd }";
    for source in [
        original.replace(emit, &format!("      require false else DIGEST_TEST_ABORT\n{emit}")),
        original.replace(marker, &format!("    require false else DIGEST_TEST_ABORT\n{marker}")),
        original.replace(marker, &format!("{marker}\n    require false else DIGEST_TEST_ABORT")),
    ] {
        let mut e = engine(&source);
        small(&mut e);
        let refused = e.run_job("digest", period(10_000, 20_000), 20_000).unwrap();
        assert_eq!((refused.state, refused.chunks, refused.rows_written), (JobState::Parked, 0, 0));
        assert!(refused.error.unwrap().contains("DIGEST_TEST_ABORT"));
        assert!(payloads(&e).is_empty());
        assert!(e.store().rows("digestMarkers").unwrap().is_empty());
        let b = bound(&original);
        e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let replacement = e.run_job("digest", period(10_000, 20_000), 20_001).unwrap();
        assert_eq!((replacement.state, replacement.rows_written), (JobState::Done, 3));
        assert_eq!(payloads(&e).len(), 2);
        let updated = bound(&original.replace("kind: 'digest'", "kind: 'updatedDigest'"));
        e.adopt(updated.schema, updated.programs.into_iter().map(|p| p.program)).unwrap();
        let changed_policy = e.run_job("digest", period(10_000, 20_000), 20_002).unwrap();
        assert_eq!(changed_policy.rows_written, 0);
        assert_eq!(payloads(&e).len(), 2, "changing implementation cannot reopen the business period");
    }
}

#[test]
fn two_queued_runs_share_markers_and_an_empty_period_stays_silent() {
    let source = source().replace("schedule daily every 1d at 08:00: digest", "schedule daily every 1m: digest\nschedule duplicate every 1m: digest");
    let mut e = engine(&source);
    small(&mut e);
    e.fire_schedules(1000).unwrap();
    assert_eq!(e.fire_schedules(60_000).unwrap().len(), 2);
    while e.run_job_chunk(60_000).unwrap().is_some() {}
    assert_eq!(payloads(&e).len(), 2);
    assert_eq!(e.store().rows("digestMarkers").unwrap().len(), 3);
    assert!(e.jobs(10).unwrap().iter().all(|j| j.state == JobState::Done));
    let empty = e.run_job("digest", period(60_000, 120_000), 120_000).unwrap();
    assert_eq!(empty.rows_written, 3);
    assert_eq!(payloads(&e).len(), 2);
    assert_eq!(e.run_job("digest", period(60_000, 120_000), 120_001).unwrap().rows_written, 0);
}

#[test]
fn chat_overflow_refuses_before_admitting_a_partial_total() {
    for count in [99, 100, 101] {
        let mut e = engine(&source());
        let mut rows = vec![("profiles", json!({"id":"p","principal":"alice"})), ("conversations", json!({"id":"c","title":"c"})),
            ("members", json!({"id":"m","conversationId":"c","principal":"alice","readOrdinal":0}))];
        rows.extend((1..=count).map(|n| ("messages", message("c", n, "bob", 15_000))));
        seed(&mut e, rows);
        let run = e.run_job("digest", period(10_000, 20_000), 20_000).unwrap();
        if count <= 100 {
            assert_eq!(run.state, JobState::Done);
            assert_eq!(payloads(&e)[0]["unread"], count);
        } else {
            assert_eq!(run.state, JobState::Parked);
            assert!(run.error.unwrap().contains("DIGEST_CHAT_BOUND"));
            assert!(payloads(&e).is_empty());
            assert!(e.store().rows("digestMarkers").unwrap().is_empty());
        }
    }
}

// @ref LLP 3000.011.001.001#5 — the refusal recipe proves membership completeness with a schema cap, not merely first 1000.
#[test]
fn membership_bound_is_enforced_before_a_digest_can_skip_a_chat() {
    for count in [999, 1000] {
        let mut e = engine(&source());
        let mut rows = vec![("profiles",json!({"id":"p","principal":"alice"}))];
        for n in 0..count {
            let chat = format!("c{n:04}");
            rows.push(("conversations",json!({"id":chat,"title":chat})));
            rows.push(("members",json!({"id":format!("m{n:04}"),"conversationId":chat,"principal":"alice","readOrdinal":0})));
            rows.push(("messages",message(&chat,1,"bob",15000)));
        }
        seed(&mut e,rows);
        let start = Instant::now();
        let run = e.run_job("digest",period(10000,20000),20000).unwrap();
        assert_eq!((run.state,run.rows_written),(JobState::Done,1));
        assert_eq!(payloads(&e)[0]["unread"],count);
        assert_eq!(payloads(&e)[0]["chats"],count);
        let markers = e.store().rows("digestMarkers").unwrap();
        println!("bounded guide memberships={count} messages={count} writes=1 markers={} marker_bytes={} elapsed_us={}",markers.len(),markers.iter().map(|r|snapback4_core::value::canonical_json(r).len()).sum::<usize>(),start.elapsed().as_micros());
        if count == 1000 {
            seed(&mut e,vec![("conversations",json!({"id":"another-chat","title":"one more"}))]);
            let next = wire::row_from_json(e.schema().table("members").unwrap(),&json!({"id":"overflow","conversationId":"another-chat","principal":"alice","readOrdinal":0})).unwrap();
            let refused = e.seed_at(vec![("members".into(),next)],20001).unwrap_err();
            assert!(matches!(&refused,RuntimeError::Constraint(message) if message == "members holds at most 1000 rows per group by principal"),"{refused:?}");
            assert_eq!(e.store().rows("members").unwrap().len(),1000);
            assert_eq!(e.store().rows("digestMarkers").unwrap(),markers);
            assert_eq!(payloads(&e).len(),1);
            println!("bounded guide membership1001: {refused}");
        }
    }
}

#[test]
fn each_recipient_rechecks_live_state_after_earlier_chunks() {
    let source = format!("{}\n{}", source()
        .replace("schedule daily every 1d at 08:00", "schedule daily every 1m")
        .replace("update <- .senderId = viewer", "update <- .senderId = viewer\n  delete <- .senderId = viewer"), r#"
mutation readAll():
  m = members[conversationId = 'c', principal = viewer]
  update members[m.id] { readOrdinal: 99 }
mutation leave():
  m = members[conversationId = 'c', principal = viewer]
  delete members[m.id]
mutation addBob():
  insert members { id: 'bob-rejoined', conversationId: 'c', principal: 'bob', readOrdinal: 0 }
mutation tombstone():
  update messages['c-m001'] { tombstone: true }
  update messages['c-m002'] { tombstone: true }
mutation remove():
  delete messages['c-m001']
  delete messages['c-m002']
"#);
    // Time advances between separate run_job_chunk transactions; one run_job
    // call pins its clock and would not exercise expiry between recipients.
    for change in ["expiry", "readAll", "leave", "rejoin", "tombstone", "remove"] {
        let mut e = engine(&source);
        let mut rows = vec![("conversations", json!({"id":"c","title":"c"}))];
        for p in ["alice", "bob", "carol"] {
            rows.push(("members", json!({"id":format!("m-{p}"),"conversationId":"c","principal":p,"readOrdinal":0})));
            if p != "carol" { rows.push(("profiles", json!({"id":format!("p-{p}"),"principal":p}))); }
        }
        for ordinal in 1..=2 {
            let mut m = message("c", ordinal, "carol", 15_000);
            if change == "expiry" { m["expiresAt"] = json!(65_000); }
            rows.push(("messages", m));
        }
        seed(&mut e, rows);
        e.fire_schedules(1000).unwrap();
        e.fire_schedules(60_000).unwrap();
        e.run_job_chunk(60_000).unwrap().unwrap();
        assert_eq!(payloads(&e)[0]["unread"], 2);
        if change != "expiry" {
            let (operation, viewer) = match change {
                "rejoin" => ("leave", "bob"),
                "readAll" | "leave" => (change, "bob"),
                _ => (change, "carol"),
            };
            let result = e.mutate(operation, None, Context::new(viewer, BTreeMap::new()).at(65_000)).unwrap();
            assert!(matches!(result.state, snapback4_core::WriteState::Sent { .. }), "{change}: {result:?}");
            if change == "rejoin" {
                let result = e.mutate("addBob", None, Context::new("alice", BTreeMap::new()).at(65_000)).unwrap();
                assert!(matches!(result.state, snapback4_core::WriteState::Sent { .. }), "{result:?}");
            }
        }
        while e.run_job_chunk(65_000).unwrap().is_some() {}
        let effects = payloads(&e);
        assert_eq!(effects.len(), if change == "rejoin" { 2 } else { 1 }, "{change}: {effects:?}");
        if change == "rejoin" { assert_eq!(effects[1]["unread"], 2); }
        assert_eq!(e.store().rows("digestMarkers").unwrap().len(), 2);
    }
}

#[test]
fn markers_are_private_unsynced_and_cannot_be_forged() {
    let source = format!("{}\nmutation forge(periodEnd: time):\n  insert digestMarkers {{ principal: viewer, periodEnd }}\nquery marker(periodEnd: time):\n  return digestMarkers[viewer, periodEnd]\n", source());
    let b = bound(&source);
    assert!(b.schema.table("digestMarkers").unwrap().sync.is_none());
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    small(&mut e);
    let args: BTreeMap<String, Value> = [("periodEnd".into(), Value::Int(20_000))].into();
    let outcome = e.mutate("forge", None, Context::new("alice", args.clone()).at(20_000)).unwrap();
    let snapback4_core::WriteState::Failed { why, .. } = &outcome.state else { panic!("forged marker: {:?}", outcome.state) };
    assert_eq!(why.code, "E_RULE", "{why:?}");
    assert!(e.store().rows("digestMarkers").unwrap().is_empty());
    e.run_job("digest", period(10_000, 20_000), 20_000).unwrap();
    assert_eq!(e.query("marker", Context::new("alice", args).at(20_000)).unwrap().data, Value::Null);
}

#[test]
fn single_profile_stops_at_the_exact_examined_envelope() {
    let mut e = engine(&source());
    hub(&mut e, 20, 14, false);
    // 14,380 period messages + 1,000 members + 1,002 scan attempts
    // + one profile row + one marker miss = exactly 16,384 examinations.
    let extra = (0..380).map(|c| ("messages", message(&format!("c{c:04}"), 21, &format!("peer{c}"), 15_000))).collect();
    seed(&mut e, extra);
    measured_chunk(&mut e, "digest", 16_384).unwrap();
    let error = measured_chunk(&mut e, "digest", 16_383).unwrap_err();
    assert!(matches!(error, RuntimeError::Bound { kind: MeterKind::Examined, actual: 16_384, ceiling: 16_383, .. }), "{error:?}");
    let run = e.run_job("digest", period(10_000, 20_000), 20_000).unwrap();
    assert_eq!((run.state, run.chunks), (JobState::Done, 1));
    assert_eq!(payloads(&e)[0]["unread"], 14_380);
    seed(&mut e, vec![("messages", message("c0380", 21, "peer380", 15_000))]);
    let run = e.run_job("digest", period(10_000, 20_001), 20_001).unwrap();
    assert_eq!((run.state, run.chunks), (JobState::Parked, 0));
    assert_eq!(run.error.as_deref(), Some("E_BOUND: examined rows reached the ceiling 16384"));
    assert_eq!(payloads(&e).len(), 1, "the refused profile emitted nothing");
    println!("time-seek boundary: 14380 period messages -> 16384 examined/done; 14381 -> 16385 attempted/parked; effects stay 1");
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
