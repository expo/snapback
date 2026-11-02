//! LLP 3000.001.001 increment 1: every published prefix is independently usable.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Engine, Value, value::object, engine::WriteState};
use snapback4_device::{device::{Backend, Device, Queued, StreamPage}, store::DeviceStore};

const SOURCE: &str = r#"
use personas alice, bob
table participants:
  threadId: threads
  personId: principal
  unique threadId, personId
  cap 50 by threadId
  read <- exists participants[.threadId, viewer]
  insert <- exists participants[.threadId, viewer]
  delete <- .personId = viewer
  sync by .personId
table threads:
  subject: text <=100
  read <- exists participants[.id, viewer]
  retain delivered-history
  sync to participants[.id] by .personId
table messages:
  conversation: threads
  body: text <=100
  n: int
  at: time
  read <- exists participants[.conversation, viewer]
  insert <- exists participants[.conversation, viewer]
  update <- exists participants[.conversation, viewer]
  delete <- exists participants[.conversation, viewer]
  retain delivered-history
  sync to participants[.conversation] by .personId last 2 by .at, .id
query inbox():
  return participants where .personId = viewer first 50 by .threadId
query thread(c: threads):
  return threads[c]
query history(c: threads, page: cursor ?):
  return messages where .conversation = c last 2 by .at, .id after page
query missing(m: messages):
  return exists messages[m]
query one(m: messages):
  return messages[m]
query total(c: threads):
  return count(messages where .conversation = c)
mutation bump(m: messages):
  old = messages[m] ! else NOT_FOUND
  update messages[m] {n: old.n + 1}
mutation edit(m: messages, body: text <=100):
  update messages[m] {body: body}
mutation move(m: messages, at: time):
  update messages[m] {at: at}
mutation remove(m: messages):
  delete messages[m]
mutation add(c: threads, body: text <=100, at: time):
  insert messages {conversation: c, body: body, n: 0, at: at}
mutation three():
  update messages['a4'] {body: 'changed a'}
  update messages['b4'] {body: 'changed b'}
  update messages['c4'] {body: 'changed c'}
mutation leave(m: participants):
  delete participants[m]
mutation join(c: threads):
  insert participants {threadId: c, personId: viewer}
"#;

fn fixture(retained: bool) -> (Engine, Backend) {
    let (mut e, b) = compile(&SOURCE.replace("retain delivered-history", if retained { "retain delivered-history" } else { "retain until-revoked" }));
    for g in ["a", "b", "c", "empty"] {
        e.seed_at([("threads".into(), object([("id", id(g)), ("subject", Value::String(g.into()))])),
            ("participants".into(), object([("id", id(&format!("p{g}"))), ("threadId", id(g)), ("personId", id("dev:alice"))]))], 100).unwrap();
        if g != "empty" {
            for n in 1..=4 { e.seed_at([("messages".into(), object([("id", id(&format!("{g}{n}"))),
                ("conversation", id(g)), ("body", Value::String(format!("body {n}"))), ("n", Value::Int(0)), ("at", Value::Int(1))]))], 100).unwrap(); }
        }
    }
    (e, b)
}

fn acquire<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>, hint: Option<&str>, limit: usize) -> StreamPage {
    let s = d.sync_state().unwrap();
    let h = hint.map(|g| snapback4_core::partition::AcquisitionGroup { table: "messages".into(), group: vec![json!(g)] });
    let p = e.acquisition_page_at("dev:alice", s.acquisition_cursor.as_deref(), h.as_ref(), &[], s.transfer_watermark, limit, 100, &s.pending_ids).unwrap();
    let events: Vec<_> = p.page.events.iter().map(|ev| json!({"table":ev.table,"kind":ev.kind,"id":ev.id,"data":ev.data.as_ref().map(snapback4_core::wire::to_json)})).collect();
    serde_json::from_value(json!({"snapshot":false,"events":events,"acquisitions":p.page.acquisitions,"joined":p.page.joined,
        "acquire":p.acquire,"watermark":p.page.watermark,"more":p.page.more,"images_at":p.page.images_at,"now":100,
        "acknowledged":p.acknowledged,"sent":p.acknowledged,"committed_above":p.committed_above,
        "requested_watermark":s.transfer_watermark,"captured_watermark":s.watermark,"send_revision":s.send_revision,
        "pending_through":s.pending_through,"pending_complete":s.pending_complete,"pending_bound":s.pending_bound})).unwrap()
}
fn stream<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>, limit: usize) -> StreamPage {
    let s = d.sync_state().unwrap();
    let p = e.certified_stream_at("dev:alice", s.transfer_watermark, limit, 100, &s.pending_ids).unwrap();
    let events: Vec<_> = p.page.events.iter().map(|ev| json!({"table":ev.table,"kind":ev.kind,"id":ev.id,"data":ev.data.as_ref().map(snapback4_core::wire::to_json)})).collect();
    serde_json::from_value(json!({"snapshot":false,"events":events,"acquisitions":p.page.acquisitions,"joined":p.page.joined,
        "watermark":p.page.watermark,"more":p.page.more,"images_at":p.page.images_at,"now":100,
        "acknowledged":p.acknowledged,"sent":p.acknowledged,"committed_above":p.committed_above,
        "requested_watermark":s.transfer_watermark,"captured_watermark":s.watermark,"send_revision":s.send_revision,
        "pending_through":s.pending_through,"pending_complete":s.pending_complete,"pending_bound":s.pending_bound})).unwrap()
}
fn drain<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>) {
    loop { let p = stream(e, d, 1); d.apply(&p, false).unwrap(); if !p.more { break; } }
}
fn tier1<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>) {
    while d.sync_state_read().unwrap().acquired_tables.len() < 2 {
        let p = acquire(e, d, None, 2);
        assert_eq!(p.acquire.as_ref().unwrap().unit.as_ref().unwrap().tier, 1);
        d.apply(&p, false).unwrap();
        assert!(!d.sync_state_read().unwrap().acquired);
    }
}
fn history<S: DeviceStore>(d: &mut Device<S>, g: &str) -> (Result<snapback4_core::QueryOutcome, snapback4_core::error::Refusal>, bool, bool) {
    d.query_with_coverage("history", "dev:alice", &json!({"c":g,"page":null}), 100)
}
fn mutate(e: &mut Engine, op: &str, pairs: &[(&str, Value)]) {
    let out = e.mutate(op, None, context("dev:alice", pairs).at(100)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}
macro_rules! stores { ($name:ident, $body:ident) => { #[test] fn $name() { $body(&mut Memory::new()); $body(&mut Sqlite::new(stringify!($name))); } } }

fn admission<H: Host>(h: &mut H) {
    for retained in [false, true] {
        let name = if retained { "kept" } else { "revoked" };
        let (mut e, b) = fixture(retained); let mut d = h.open(name, Some(b)).unwrap();
        tier1(&mut e, &mut d);
        h.close(name, d); let mut d = h.open(name, None).unwrap();
        assert!(d.query("inbox", "dev:alice", &json!({}), 100).unwrap().complete);
        assert!(!d.query_with_coverage("thread", "dev:alice", &json!({"c":"a"}), 100).1);
        assert!(history(&mut d, "a").1);
        let p = acquire(&mut e, &mut d, None, 1); let changed = d.apply(&p, false).unwrap();
        assert!(changed.contains(&"messages".into()));
        let s = d.sync_state_read().unwrap(); assert!(!s.acquired); assert_eq!(s.floored_groups, 1);
        h.close(name, d); let mut d = h.open(name, None).unwrap();
        assert_eq!(d.sync_state_read().unwrap().acquisition_cursor, s.acquisition_cursor);
        let (first, unknown, _) = history(&mut d, "a"); assert!(!unknown); let first = first.unwrap();
        assert!(first.complete); assert_eq!(first.data.as_array().unwrap().len(), 2);
        assert_eq!(first.data.as_array().unwrap()[0].field("id").unwrap(), &id("a4"));
        let across = d.query_with_coverage("history", "dev:alice", &json!({"c":"a","page":first.next}), 100);
        assert!(!across.0.unwrap().complete); assert!(across.1);
        let unwalked = history(&mut d, "b");
        assert!(unwalked.1);
        assert!(!unwalked.0.unwrap().complete, "an unfloored group is not an empty complete page");
        assert!(d.query_with_coverage("missing", "dev:alice", &json!({"m":"never"}), 100).1);
        assert!(d.query_with_coverage("total", "dev:alice", &json!({"c":"a"}), 100).1);
        assert!(d.predict("edit", "dev:alice", &json!({"m":"a4","body":"no"}), 100, vec![], 1).is_err());
        let p = acquire(&mut e, &mut d, Some("empty"), 1); d.apply(&p, false).unwrap();
        let (empty, unknown, _) = history(&mut d, "empty"); assert!(!unknown); let empty = empty.unwrap();
        assert!(empty.complete && empty.next.is_none() && empty.data.as_array().unwrap().is_empty());
    }
}
stores!(tier1_and_group_read_admission_survive_reopen_on_both_stores, admission);

// @ref LLP 3000.001.001#52-a-safe-read-before-full-acquisition — an acquired row is not a known absence while its read-rule witness is unacquired.
fn rule_dependency_admission<H: Host>(h: &mut H) {
    let source = SOURCE.replace("threads", "conversations").replace("retain delivered-history", "retain until-revoked")
        .replace("  cap 50 by threadId", "  until: time ?\n  expire at .until\n  cap 50 by threadId");
    let (mut e, b) = compile(&source);
    e.seed_at([
        ("conversations".into(), object([("id", id("a")), ("subject", Value::String("present".into()))])),
        ("participants".into(), object([("id", id("pa")), ("threadId", id("a")),
            ("personId", id("dev:alice")), ("until", Value::Null)])),
    ], 100).unwrap();
    let mut d = h.open("rule", Some(b)).unwrap();
    let p = acquire(&mut e, &mut d, None, 1); d.apply(&p, false).unwrap();
    assert_eq!(d.sync_state_read().unwrap().acquired_tables, ["conversations"]);
    let watermark = d.state().unwrap().0;
    let truth = e.query("thread", context("dev:alice", &[("c", id("a"))]).at(100)).unwrap();
    assert_eq!(truth.data.field("id").unwrap(), &id("a"));
    for _ in 0..2 {
        let (answer, unknown, _) = d.query_with_coverage("thread", "dev:alice", &json!({"c":"a"}), 100);
        assert!(unknown, "unacquired rule dependency must not turn a readable row into complete null: {answer:?}");
        assert!(!d.sync_state_read().unwrap().acquired);
        h.close("rule", d); d = h.open("rule", None).unwrap();
    }
    let p = acquire(&mut e, &mut d, None, 1); d.apply(&p, false).unwrap();
    assert_eq!(d.state().unwrap().0, watermark);
    assert_eq!(d.sync_state_read().unwrap().acquired_tables, ["conversations", "participants"]);
    let (answer, unknown, _) = d.query_with_coverage("thread", "dev:alice", &json!({"c":"a"}), 100);
    assert!(!unknown); let answer = answer.unwrap();
    assert!(answer.complete); assert_eq!(answer.data, truth.data);
    assert!(!d.sync_state_read().unwrap().acquired, "history group still waits");
}
#[test] fn read_rule_dependencies_gate_early_queries_memory() { rule_dependency_admission(&mut Memory::new()); }
#[test] fn read_rule_dependencies_gate_early_queries_sqlite() { rule_dependency_admission(&mut Sqlite::new("rule-dependencies")); }

fn finish_replacement<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>) {
    let mut p = stream(e, d, 100); p.snapshot_catchup = true;
    d.apply(&p, false).unwrap();
    let s = d.sync_state_read().unwrap(); assert!(s.acquired); assert!(s.acquisition_cursor.is_none());
}

// @ref LLP 3000.001.001#64-re-acquisition-stays-staged-in-the-first-increment — fresh joins during staged catch-up and after replacement share the upgraded store's classification.
fn fresh_join_after_replacement<H: Host>(h: &mut H) {
    for (during_catchup, progressive) in [(false, false), (false, true), (true, false), (true, true)] {
        let name = match (progressive, during_catchup) {
            (false, false) => "legacy-join", (true, false) => "upgraded-join",
            (false, true) => "legacy-staged-join", (true, true) => "upgraded-staged-join",
        };
        let (mut e, mut b) = fixture(true); let mut d = h.open(name, Some(b.clone())).unwrap();
        if progressive {
            while !d.sync_state_read().unwrap().acquired {
                let p = acquire(&mut e, &mut d, None, 100); d.apply(&p, false).unwrap();
            }
        } else {
            for (i, p) in snapshot_pages(&mut e, "dev:alice", 100).iter().enumerate() { d.apply(p, i == 0).unwrap(); }
        }
        b.generation += 1; d.adopt(b).unwrap();
        for (i, mut p) in snapshot_pages(&mut e, "dev:alice", 2).into_iter().enumerate() {
            p.stage_snapshot = true; p.generation = Some(2); d.apply(&p, i == 0).unwrap();
        }
        if !during_catchup { finish_replacement(&mut e, &mut d); }
        e.seed_at([
            ("threads".into(), object([("id", id("fresh")), ("subject", Value::String("fresh join".into()))])),
            ("participants".into(), object([("id", id("pfresh")), ("threadId", id("fresh")), ("personId", id("dev:alice"))])),
            ("messages".into(), object([("id", id("fresh1")), ("conversation", id("fresh")),
                ("body", Value::String("new".into())), ("n", Value::Int(0)), ("at", Value::Int(1))])),
        ], 100).unwrap();
        if during_catchup {
            assert!(d.publication_pending().unwrap());
            assert!(!d.sync_state_read().unwrap().acquired);
            finish_replacement(&mut e, &mut d);
        } else { drain(&mut e, &mut d); }
        for _ in 0..2 {
            let (answer, unknown, _) = history(&mut d, "fresh");
            assert!(!unknown, "fresh join must be usable; progressive={progressive}, during_catchup={during_catchup}: {answer:?}");
            let answer = answer.unwrap(); assert!(answer.complete);
            assert_eq!(answer.data.as_array().unwrap()[0].field("id").unwrap(), &id("fresh1"));
            h.close(name, d); d = h.open(name, None).unwrap();
        }
        // A real departure/rejoin still needs staged replacement on upgraded stores.
        mutate(&mut e, "leave", &[("m", id("pfresh"))]); drain(&mut e, &mut d);
        if during_catchup {
            for (i, mut p) in snapshot_pages(&mut e, "dev:alice", 2).into_iter().enumerate() {
                p.stage_snapshot = true; p.generation = Some(2); d.apply(&p, i == 0).unwrap();
            }
        }
        e.seed_at([("participants".into(), object([("id", id("pfresh2")),
            ("threadId", id("fresh")), ("personId", id("dev:alice"))]))], 100).unwrap();
        if during_catchup { finish_replacement(&mut e, &mut d); } else { drain(&mut e, &mut d); }
        assert!(history(&mut d, "fresh").1);
        h.close(name, d); let mut d = h.open(name, None).unwrap();
        assert!(history(&mut d, "fresh").1, "a genuine rejoin stays unknown after reopen");
    }
}
#[test] fn fresh_join_during_and_after_staged_replacement_memory() { fresh_join_after_replacement(&mut Memory::new()); }
#[test] fn fresh_join_during_and_after_staged_replacement_sqlite() { fresh_join_after_replacement(&mut Sqlite::new("fresh-join-replacement")); }

fn completion<H: Host>(h: &mut H) where H::Store: BoundaryMetadata {
    let (mut e, b) = fixture(true); let mut d = h.open("progress", Some(b.clone())).unwrap();
    tier1(&mut e, &mut d);
    // Catching up the ordinary stream does not end a still-unfinished walk.
    drain(&mut e, &mut d); assert!(!d.sync_state_read().unwrap().acquired);
    loop {
        let p = acquire(&mut e, &mut d, None, 2); let exhausted = p.acquire.as_ref().unwrap().exhausted;
        d.apply(&p, false).unwrap();
        h.close("progress", d); d = h.open("progress", None).unwrap();
        if exhausted { break; }
    }
    assert!(d.sync_state_read().unwrap().acquired);
    let mut oracle = h.open("oracle", Some(b)).unwrap();
    for (i,p) in snapshot_pages(&mut e, "dev:alice", 2).iter().enumerate() { oracle.apply(p, i == 0).unwrap(); }
    drain(&mut e, &mut oracle);
    assert_eq!(d.sync_state_read().unwrap().acquired_tables, oracle.sync_state_read().unwrap().acquired_tables);
    assert_eq!(d.store().boundary_entries(), oracle.store().boundary_entries());
    for table in ["threads", "participants", "messages"] { assert_eq!(d.store().raw_rows(table), oracle.store().raw_rows(table), "{table}"); }
    for group in ["a", "b", "c", "empty"] {
        let a = history(&mut d, group); let b = history(&mut oracle, group);
        assert_eq!(a.1, b.1); assert_eq!(serde_json::to_value(a.0.unwrap()).unwrap(), serde_json::to_value(b.0.unwrap()).unwrap());
    }
}
stores!(quiescent_whole_snapshot_oracle_including_facts_and_restarts, completion);

fn exhausted_waits<H: Host>(h: &mut H) {
    let (mut e, b) = fixture(false); let mut d = h.open("finish", Some(b)).unwrap();
    loop {
        let p = acquire(&mut e, &mut d, None, 2); let done = p.acquire.as_ref().unwrap().exhausted;
        d.apply(&p, false).unwrap(); assert!(!d.sync_state_read().unwrap().acquired);
        if p.acquire.as_ref().unwrap().pinned {
            // Put the final image head beyond the pin so exhaustion still needs
            // ordinary catch-up; a quiescent walk is already at its last head.
            mutate(&mut e, "edit", &[("m", id("a4")), ("body", Value::String("after pin".into()))]);
        }
        if done { break; }
    }
    let s = d.sync_state_read().unwrap(); assert!(s.acquisition_exhausted && s.acquisition_cursor.is_none());
    h.close("finish", d); let mut d = h.open("finish", None).unwrap();
    // Final completion is bounded by the captured image head, not a quiet account.
    drain(&mut e, &mut d); assert!(d.sync_state_read().unwrap().acquired);
}
stores!(exhaustion_beyond_the_pin_waits_for_the_stream, exhausted_waits);

fn inflight<H: Host>(h: &mut H) where H::Store: BoundaryMetadata {
    for stream_first in [false, true] {
        let name = if stream_first { "before" } else { "after" };
        let (mut e, b) = fixture(false); let mut d = h.open(name, Some(b)).unwrap();
        tier1(&mut e, &mut d); drain(&mut e, &mut d);
        let p = acquire(&mut e, &mut d, None, 1);
        mutate(&mut e, "edit", &[("m",id("a4")),("body",Value::String("edited".into()))]);
        mutate(&mut e, "move", &[("m",id("a3")),("at",Value::Int(8))]);
        mutate(&mut e, "remove", &[("m",id("a4"))]);
        mutate(&mut e, "add", &[("c",id("a")),("body",Value::String("insert".into())),("at",Value::Int(9))]);
        if stream_first {
            drain(&mut e, &mut d); assert!(d.apply(&p, false).is_err(), "obsolete in-flight page must retry");
            let p = acquire(&mut e, &mut d, None, 1); d.apply(&p, false).unwrap();
        } else { d.apply(&p, false).unwrap(); drain(&mut e, &mut d); }
        assert!(d.store().raw_rows("messages").iter().all(|r| r.field("id").unwrap() != &id("a4")));
        let local = history(&mut d, "a"); assert!(!local.1); let local = local.0.unwrap();
        let truth = e.query("history", context("dev:alice", &[("c",id("a"))]).at(100)).unwrap();
        assert_eq!(local.data, truth.data); assert!(local.complete);
    }
}
stores!(inflight_insert_edit_delete_and_order_key_move, inflight);

fn scopes<H: Host>(h: &mut H) where H::Store: BoundaryMetadata {
    for retained in [false, true] {
        let name = if retained { "retain" } else { "drop" };
        let (mut e, b) = fixture(retained); let mut d = h.open(name, Some(b)).unwrap();
        tier1(&mut e, &mut d); drain(&mut e, &mut d);
        let p = acquire(&mut e, &mut d, None, 1); d.apply(&p, false).unwrap();
        let delayed = acquire(&mut e, &mut d, Some("a"), 1);
        mutate(&mut e, "leave", &[("m",id("pa"))]); drain(&mut e, &mut d);
        assert!(d.apply(&delayed, false).is_err());
        assert_eq!(d.store().raw_rows("messages").iter().any(|r| r.field("id").unwrap() == &id("a4")), retained);
        e.seed_at([("participants".into(), object([("id",id("pa2")),("threadId",id("a")),("personId",id("dev:alice"))]))], 100).unwrap(); drain(&mut e, &mut d);
        let p = acquire(&mut e, &mut d, Some("a"), 1); d.apply(&p, false).unwrap();
        assert_eq!(history(&mut d, "a").1, retained, "retained rejoin stays unknown until replacement");
    }
}
stores!(revoke_rejoin_and_delayed_old_page_obey_both_policies, scopes);

// @ref LLP 3000.001.001#64-re-acquisition-stays-staged-in-the-first-increment — departure is durable even when no history was ever downloaded.
fn empty_rejoin<H: Host>(h: &mut H) {
    for retained in [false, true] {
        let name = if retained { "empty-retain" } else { "empty-drop" };
        let (mut e, b) = fixture(retained); let mut d = h.open(name, Some(b)).unwrap();
        tier1(&mut e, &mut d);
        assert!(d.store().raw_rows("messages").is_empty());
        assert!(d.store().boundary_entries().is_empty());
        mutate(&mut e, "leave", &[("m", id("pa"))]); drain(&mut e, &mut d);
        assert!(d.store().boundary_entries().is_empty());
        e.seed_at([("participants".into(), object([("id", id("pa2")), ("threadId", id("a")),
            ("personId", id("dev:alice"))]))], 100).unwrap();
        // Acquire before the join stream, while the persisted membership is Left.
        let p = acquire(&mut e, &mut d, Some("a"), 1); d.apply(&p, false).unwrap();
        h.close(name, d); let mut d = h.open(name, None).unwrap();
        let (read, unknown, _) = history(&mut d, "a");
        assert_eq!(unknown, retained, "an empty retained rejoin must route to the server");
        assert_eq!(read.unwrap().complete, !retained);
        if retained {
            assert_eq!(d.store().boundary_entries()[0].1, "unknown", "departure alone withholds the new floor");
            // A previously persisted erroneous floor cannot bypass membership
            // coverage on reopen either (the read-side defense is independent).
            let (key, _) = d.store().boundary_entries().into_iter().next().unwrap();
            let floor = p.acquisitions.last().unwrap().floor.clone().unwrap();
            h.close(name, d); h.patch_meta(name, &[(&key, Some(floor))]);
            d = h.open(name, None).unwrap();
            let (read, unknown, _) = history(&mut d, "a");
            assert!(unknown && !read.unwrap().complete);
        }
        drain(&mut e, &mut d);
        let p = acquire(&mut e, &mut d, Some("a"), 1); d.apply(&p, false).unwrap();
        assert_eq!(history(&mut d, "a").1, retained, "Rejoined remains unknown too");
        for (i, mut p) in snapshot_pages(&mut e, "dev:alice", 2).into_iter().enumerate() {
            p.stage_snapshot = true; d.apply(&p, i == 0).unwrap();
        }
        let mut p = stream(&mut e, &mut d, 100); p.snapshot_catchup = true;
        d.apply(&p, false).unwrap();
        let (read, unknown, _) = history(&mut d, "a");
        assert!(!unknown); assert!(read.unwrap().complete);
    }
}
stores!(empty_group_rejoin_requires_staged_replacement_on_both_stores, empty_rejoin);

fn tier1_key_move<H: Host>(h: &mut H) {
    let (mut e, b) = compile(r#"
use personas alice
table items:
  ownerId: principal
  rank: int
  immutable ownerId
  by aOrder: ownerId, rank
  read <- .ownerId = viewer
  update <- .ownerId = viewer
  sync
query existsItem(i: items):
  return exists items[i]
mutation move(i: items, rank: int):
  update items[i] {rank: rank}
"#);
    e.seed_at([("x", 100), ("y", 50)].map(|(key, rank)| ("items".into(), object([
        ("id", id(key)), ("ownerId", id("dev:alice")), ("rank", Value::Int(rank))]))), 100).unwrap();
    let mut d = h.open("move", Some(b)).unwrap();
    let first = acquire(&mut e, &mut d, None, 1);
    assert_eq!(first.events[0].id, "x"); d.apply(&first, false).unwrap();
    mutate(&mut e, "move", &[("i", id("y")), ("rank", Value::Int(200))]);
    let finish = acquire(&mut e, &mut d, None, 1);
    assert_eq!(finish.acquire.as_ref().unwrap().whole_tables, ["items"]);
    assert!(finish.events.is_empty()); assert!(finish.images_at.unwrap() > first.watermark);
    d.apply(&finish, false).unwrap();
    for _ in 0..2 {
        let (result, unknown, _) = d.query_with_coverage("existsItem", "dev:alice", &json!({"i":"y"}), 100);
        assert!(unknown, "a key skipped by the moving walk is unknown, not false: {result:?}");
        assert!(d.sync_state_read().unwrap().acquired_tables.is_empty());
        h.close("move", d); d = h.open("move", None).unwrap();
    }
    drain(&mut e, &mut d);
    let (result, unknown, _) = d.query_with_coverage("existsItem", "dev:alice", &json!({"i":"y"}), 100);
    let result = result.unwrap(); assert!(!unknown && result.complete); assert_eq!(result.data, Value::Bool(true));
    assert_eq!(d.sync_state_read().unwrap().acquired_tables, ["items"]);
}
stores!(tier1_whole_fact_waits_for_key_move_stream_repair_on_both_stores, tier1_key_move);

fn interrupted_snapshot<H: Host>(h: &mut H) {
    let (mut e, b) = fixture(false); let mut d = h.open("interrupted", Some(b)).unwrap();
    let mut first = snapshot_pages(&mut e, "dev:alice", 1).remove(0);
    first.stage_snapshot = true; assert!(first.more); d.apply(&first, true).unwrap();
    h.close("interrupted", d); let mut d = h.open("interrupted", None).unwrap();
    let state = d.sync_state_read().unwrap();
    assert!(!state.snapshot_catchup && !state.acquired);
    assert!(state.replacement_required, "the advertised client must restart the abandoned staged owner");
    for (i, mut p) in snapshot_pages(&mut e, "dev:alice", 2).into_iter().enumerate() {
        p.stage_snapshot = true; d.apply(&p, i == 0).unwrap();
    }
    let mut p = stream(&mut e, &mut d, 100); p.snapshot_catchup = true; d.apply(&p, false).unwrap();
    assert!(d.sync_state_read().unwrap().acquired);
    assert!(!d.sync_state_read().unwrap().replacement_required);
}
stores!(interrupted_legacy_snapshot_restarts_staged_on_both_stores, interrupted_snapshot);

fn atomic_commit<H: Host>(h: &mut H) where H::Store: BoundaryMetadata {
    let (mut e, b) = fixture(false); let mut d = h.open("three", Some(b)).unwrap();
    tier1(&mut e, &mut d);
    for _ in 0..2 { let p = acquire(&mut e, &mut d, None, 1); d.apply(&p, false).unwrap(); }
    let baseline = e.seq().unwrap();
    mutate(&mut e, "three", &[]);
    // Isolate this commit's ordinary applicator effects. Draining from zero
    // would also acquire C via the fixture's historical membership join.
    let page = stream_page(&mut e, "dev:alice", baseline);
    let mut page = page; page.requested_watermark = Some(d.state().unwrap().0);
    d.apply(&page, false).unwrap();
    for g in ["a", "b"] { let p = history(&mut d, g); assert!(!p.1); assert!(p.0.unwrap().complete); }
    assert!(history(&mut d, "c").1);
    assert!(d.store().raw_rows("messages").iter().any(|r| r.field("id").unwrap() == &id("c4") && r.field("body").unwrap() == &Value::String("changed c".into())));
    mutate(&mut e, "remove", &[("m",id("c4"))]); drain(&mut e, &mut d);
    let p = acquire(&mut e, &mut d, None, 1); d.apply(&p, false).unwrap();
    assert!(d.store().raw_rows("messages").iter().all(|r| r.field("id").unwrap() != &id("c4")));
    assert!(!history(&mut d, "c").1);
}
stores!(one_commit_two_floored_groups_and_an_unwalked_group_is_held, atomic_commit);

fn lifecycle<H: Host>(h: &mut H) where H::Store: BoundaryMetadata {
    for mode in ["generation", "replacement", "restore"] {
        let (mut e, b) = fixture(true); let mut d = h.open(mode, Some(b.clone())).unwrap();
        // Bind the server identity on the first publication. Introducing it
        // after the cold pin correctly looks like replacing an applied store.
        let mut first = acquire(&mut e, &mut d, None, 2);
        first.store_id = Some("old".into()); d.apply(&first, false).unwrap();
        tier1(&mut e, &mut d); let mut p = acquire(&mut e, &mut d, None, 1);
        p.store_id = Some("old".into()); d.apply(&p, false).unwrap();
        let mut replacement = b.clone();
        if mode == "generation" { replacement.generation += 1; d.adopt(replacement).unwrap(); }
        else {
            drain(&mut e, &mut d);
            let s = d.sync_state().unwrap();
            let page = serde_json::from_value(json!({"snapshot":false,"events":[],"watermark":0,"images_at":0,"more":false,
                "store_id":if mode == "restore" {"old"} else {"new"},"requested_watermark":s.watermark,"captured_watermark":s.watermark,"send_revision":s.send_revision})).unwrap();
            if mode == "restore" { assert_eq!(d.observe_store(&page).unwrap_err().code(), "E_STORE_RESTORE"); }
            else { assert!(d.observe_store(&page).unwrap().reset); d.adopt(replacement).unwrap(); }
        }
        let s = d.sync_state_read().unwrap(); assert!(!s.acquired); assert!(s.acquisition_cursor.is_none());
        assert!(s.acquired_tables.is_empty()); assert_eq!(s.floored_groups, 0); assert!(s.replacement_required);
        assert!(d.store().boundary_entries().is_empty());
        if mode == "restore" { continue; }
        p.store_id = None; p.generation = Some(s.generation); p.requested_watermark = Some(0); p.captured_watermark = Some(0); p.send_revision = Some(s.send_revision);
        assert!(d.apply(&p, false).is_err(), "replacement cannot use progressive acquisition");
        let mut full = snapshot_pages(&mut e, "dev:alice", 100).remove(0); full.generation = Some(s.generation); full.stage_snapshot = true;
        d.apply(&full, true).unwrap(); assert!(!d.sync_state_read().unwrap().acquired);
        let catchup: StreamPage = serde_json::from_value(json!({"snapshot":false,"snapshot_catchup":true,"events":[],"watermark":full.watermark,"images_at":full.watermark,"requested_watermark":full.watermark,"more":false})).unwrap();
        d.apply(&catchup, false).unwrap(); assert!(d.sync_state_read().unwrap().acquired);
    }
}
stores!(generation_replacement_and_restore_clear_progress_and_preserve_staging, lifecycle);

#[test]
fn native_progressive_restart_child() {
    let Ok(path) = std::env::var("SB4_PROGRESSIVE_RESTART_PATH") else { return };
    let mut d = Device::open(std::path::Path::new(&path), None).unwrap();
    let s = d.sync_state_read().unwrap();
    assert!(!s.acquired && s.acquisition_cursor.is_some());
    assert_eq!(s.acquired_tables, ["participants", "threads"]);
    assert_eq!(s.floored_groups, 1);
    assert!(!history(&mut d, "a").1);
    assert!(history(&mut d, "b").1);
}

#[test]
fn native_progressive_commit_survives_a_new_process() {
    let mut h = Sqlite::new("progressive-process");
    let (mut e, b) = fixture(true); let mut d = h.open("restart", Some(b)).unwrap();
    tier1(&mut e, &mut d); let p = acquire(&mut e, &mut d, None, 1); d.apply(&p, false).unwrap();
    drop(d);
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "native_progressive_restart_child", "--nocapture"])
        .env("SB4_PROGRESSIVE_RESTART_PATH", h.path("restart")).output().unwrap();
    assert!(output.status.success(), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
}

fn own_write<H: Host>(h: &mut H) {
    let (mut e, b) = fixture(true); let mut d = h.open("own", Some(b)).unwrap();
    tier1(&mut e, &mut d);
    let p = acquire(&mut e, &mut d, None, 1); d.apply(&p, false).unwrap();
    // enqueue is the existing import/recovery path, unlike new admission,
    // which cannot predict during cold acquisition in this increment.
    let q: Queued = serde_json::from_value(json!({"id":"own-bump","seq":1,"op":"bump","args":{"m":"b4"},"viewer":"dev:alice","now":100,"predictable":true})).unwrap();
    d.enqueue(&q).unwrap();
    let result = e.mutate("bump", Some("own-bump"), context("dev:alice", &[("m", id("b4"))]).at(100)).unwrap();
    assert!(matches!(result.state, WriteState::Sent { .. }));
    let before = d.sync_state_read().unwrap(); let p = acquire(&mut e, &mut d, None, 1);
    assert!(p.committed_above.contains_key("own-bump"));
    assert!(p.events.iter().any(|event|event.id == "b4" && event.data.as_ref().unwrap()["n"] == 1));
    assert_eq!(d.apply_publication(&p, false).unwrap(), (vec![], false));
    h.close("own", d); let mut d = h.open("own", None).unwrap();
    let after = d.sync_state_read().unwrap(); assert_eq!(after.acquisition_cursor, before.acquisition_cursor);
    assert_eq!(after.floored_groups, before.floored_groups); assert!(history(&mut d, "b").1);
    drain(&mut e, &mut d);
    let row = d.query("one", "dev:alice", &json!({"m":"b4"}), 100).unwrap();
    assert_eq!(row.data.field("n").unwrap(), &Value::Int(1), "own effect must not double");
    assert_eq!(d.queued().unwrap()[0].observed_seq, Some(e.seq().unwrap()));
    assert!(!d.sync_state_read().unwrap().acquired, "ordinary catch-up does not exhaust the walk");
}
stores!(real_server_own_write_image_defers_acquisition_and_survives_reopen, own_write);

fn packed_publication<H: Host>(h: &mut H) where H::Store: BoundaryMetadata {
    let (mut e, b) = fixture(true); let mut d = h.open("packed", Some(b.clone())).unwrap();
    let page = acquire(&mut e, &mut d, Some("c"), 12);
    assert_eq!(page.acquire.as_ref().unwrap().units.len(), 4);
    d.apply(&page, false).unwrap();
    let state = d.sync_state_read().unwrap();
    assert_eq!(state.acquired_tables, ["participants", "threads"]);
    assert_eq!(state.floored_groups, 2); assert!(!state.acquired);
    assert!(!history(&mut d, "a").1 && !history(&mut d, "c").1 && history(&mut d, "b").1);
    h.close("packed", d); let mut d = h.open("packed", None).unwrap();
    assert_eq!(d.sync_state_read().unwrap().floored_groups, 2);
    assert!(d.query("thread", "dev:alice", &json!({"c":"a"}), 100).unwrap().complete);
    let page = acquire(&mut e, &mut d, None, 12); d.apply(&page, false).unwrap();
    assert!(d.sync_state_read().unwrap().acquired);
    let mut oracle = h.open("packed-oracle", Some(b)).unwrap();
    for (i,p) in snapshot_pages(&mut e, "dev:alice", 2).iter().enumerate() { oracle.apply(p, i == 0).unwrap(); }
    drain(&mut e, &mut oracle);
    assert_eq!(d.sync_state_read().unwrap().acquired_tables, oracle.sync_state_read().unwrap().acquired_tables);
    assert_eq!(d.store().boundary_entries(), oracle.store().boundary_entries());
    for table in ["threads", "participants", "messages"] { assert_eq!(d.store().raw_rows(table), oracle.store().raw_rows(table)); }
    for group in ["a", "b", "c", "empty"] {
        let a = history(&mut d, group); let b = history(&mut oracle, group);
        assert_eq!(a.1, b.1); assert_eq!(serde_json::to_value(a.0.unwrap()).unwrap(), serde_json::to_value(b.0.unwrap()).unwrap());
    }
}
stores!(packed_page_facts_survive_reopen_and_match_the_quiescent_oracle, packed_publication);
