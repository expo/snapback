//! Lower read lifetimes cross the server boundary before either production
//! device store can observe their payload.
mod common;

use common::*;
use serde_json::json;
use snapback4_core::{Context, Engine, Store, Value, WriteState, value::object, wire};
use snapback4_device::device::{Backend, Queued, StreamPage};
use std::collections::BTreeMap;

const OPEN: i64 = 100;
const SOURCE: &str = r#"table releases:
  group: text <=20
  opensAt: time
  expiresAt: time ?
  payload: text <=200
  by byOpening: opensAt
  by byExpiry: expiresAt
  cap 3
  immutable group
  not before .opensAt
  expire at .expiresAt
  public 'released material is public during its lifetime'
  insert <- allow
  update <- allow
  delete <- allow
  sync public last 20 by .id

query visible(c: cursor ?):
  return releases first 20 by .id after c

mutation reschedule(key: releases, opensAt: time):
  update releases[key] { opensAt }
  return null

mutation remove(key: releases):
  delete releases[key]
  return null
"#;

const PENDING_SOURCE: &str = r#"table gates:
  opensAt: time
  closesAt: time
  by byOpening: opensAt
  by byExpiry: closesAt
  not before .opensAt
  expire at .closesAt
  public 'scheduled gates'
  sync public
table awards:
  label: text <=20
  public 'awards'
  insert <- allow
  sync public
query asserted(id: gates):
  gate = gates[id] ! else NOT_FOUND
  return gate
mutation grant(id: gates, award: id):
  insert awards { id: award, label: 'granted' }
  require exists gates[id] else NOT_FOUND
  return true
"#;

fn membership_source(timed: bool) -> String {
    let opening = if timed { "  not before .opensAt\n" } else { "" };
    format!(r#"table members:
  room: text <=20
  principal: principal
  opensAt: time
  unique byRoomPrincipal: room, principal
  by byOpening: opensAt
  read <- .principal = viewer
{opening}  sync to .principal
table notes:
  room: text <=20
  body: text <=100
  read <- exists members[.room, viewer]
  sync to members[.room]
query visibleNotes():
  return notes first 20 by .id
"#)
}

fn compile_at(now: i64) -> (Engine, Backend) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    let programs: Vec<_> = bound
        .programs
        .into_iter()
        .map(|program| program.program)
        .collect();
    let engine = Engine::new_at(
        Store::memory().unwrap(),
        bound.schema.clone(),
        programs.clone(),
        now,
    )
    .unwrap();
    let backend = Backend {
        generation: engine.generation(),
        schema: bound.schema,
        programs,
    };
    (engine, backend)
}

fn compile_pending() -> (Engine, Backend) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), PENDING_SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    let programs: Vec<_> = bound.programs.into_iter().map(|program| program.program).collect();
    let engine = Engine::new_at(
        Store::memory().unwrap(),
        bound.schema.clone(),
        programs.clone(),
        0,
    ).unwrap();
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs };
    (engine, backend)
}

fn release(id_value: &str, opens_at: i64, expires_at: Value, payload: &str) -> Value {
    object([
        ("id", id(id_value)),
        ("group", Value::String("g".into())),
        ("opensAt", Value::Int(opens_at)),
        ("expiresAt", expires_at),
        ("payload", Value::String(payload.into())),
    ])
}

fn snapshot(engine: &mut Engine, viewer: &str, now: i64) -> StreamPage {
    let page = engine
        .snapshot_acquisition_page_at(viewer, None, 100, now)
        .unwrap();
    serde_json::from_value(json!({
        "snapshot": true,
        "now": now,
        "events": page.events.iter().map(|event| json!({
            "table": event.table,
            "kind": event.kind.word(),
            "id": event.id,
            "data": event.data.as_ref().map(wire::to_json),
        })).collect::<Vec<_>>(),
        "acquisitions": page.acquisitions,
        "held": page.held,
        "watermark": page.watermark,
        "more": false,
        "generation": engine.generation(),
    }))
    .unwrap()
}

fn stream(engine: &mut Engine, viewer: &str, from: u64, now: i64) -> StreamPage {
    let page = engine.stream_at(viewer, from, 100, now).unwrap();
    serde_json::from_value(json!({
        "snapshot": false,
        "now": now,
        "requested_watermark": from,
        "events": page.events.iter().map(|event| json!({
            "table": event.table,
            "kind": event.kind,
            "id": event.id,
            "data": event.data.as_ref().map(wire::to_json),
        })).collect::<Vec<_>>(),
        "images_at": page.images_at,
        "joined": page.joined,
        "acquisitions": page.acquisitions,
        "watermark": page.watermark,
        "more": page.more,
        "generation": engine.generation(),
    }))
    .unwrap()
}

fn visible_server(engine: &mut Engine, now: i64) -> snapback4_core::QueryOutcome {
    engine
        .query(
            "visible",
            Context::new("alice", BTreeMap::from([("c".into(), Value::Null)])).at(now),
        )
        .unwrap()
}

fn visible_device<S: snapback4_device::store::DeviceStore>(
    device: &mut snapback4_device::device::Device<S>,
    now: i64,
) -> snapback4_core::QueryOutcome {
    device
        .query("visible", "alice", &json!({"c": null}), now)
        .unwrap()
}

fn lifecycle<H: Host>(host: &mut H) {
    let (mut server, backend) = compile_at(0);
    server
        .seed_at(
            [(
                "releases".into(),
                release("scheduled", OPEN, Value::Null, "secret"),
            )],
            0,
        )
        .unwrap();

    let before = snapshot(&mut server, "alice", OPEN - 1);
    assert!(
        before.events.is_empty(),
        "future payload crossed the snapshot: {before:?}"
    );
    let mut device = host.open("time-audience", Some(backend)).unwrap();
    device.apply(&before, true).unwrap();

    let server_before = visible_server(&mut server, OPEN - 1);
    let device_before = visible_device(&mut device, OPEN - 1);
    assert_eq!(server_before.data, device_before.data);
    assert_eq!(server_before.metered, device_before.metered);
    assert!(server_before.data.as_array().unwrap().is_empty());
    assert!(
        visible_device(&mut device, OPEN + 10_000)
            .data
            .as_array()
            .unwrap()
            .is_empty(),
        "a hostile device clock cannot reveal payload the server has not published"
    );

    host.close("time-audience", device);
    let mut device = host.open("time-audience", None).unwrap();
    assert!(
        visible_device(&mut device, OPEN + 10_000)
            .data
            .as_array()
            .unwrap()
            .is_empty(),
        "restart cannot manufacture a future payload"
    );

    let from = device.state().unwrap().0;
    let opening = stream(&mut server, "alice", from, OPEN);
    assert_eq!(
        opening
            .events
            .iter()
            .filter(|event| event.table == "releases"
                && event.id == "scheduled"
                && event.kind == "put")
            .count(),
        1,
        "the exact boundary publishes one ordinary put: {opening:?}"
    );
    device.apply(&opening, false).unwrap();
    let server_open = visible_server(&mut server, OPEN);
    let device_open = visible_device(&mut device, 0);
    assert_eq!(
        server_open.data, device_open.data,
        "the applied server clock survives local rollback"
    );
    assert_eq!(server_open.metered, device_open.metered);

    host.close("time-audience", device);
    let mut device = host.open("time-audience", None).unwrap();
    assert_eq!(
        visible_device(&mut device, 0).data,
        server_open.data,
        "the authoritative opening and its payload survive restart"
    );

    let moved = server
        .mutate(
            "reschedule",
            None,
            Context::new(
                "alice",
                BTreeMap::from([
                    ("key".into(), id("scheduled")),
                    ("opensAt".into(), Value::Int(OPEN + 100)),
                ]),
            )
            .at(OPEN + 1),
        )
        .unwrap();
    assert!(matches!(moved.state, WriteState::Sent { .. }), "{moved:?}");
    let from = device.state().unwrap().0;
    let revoked = stream(&mut server, "alice", from, OPEN + 1);
    assert!(
        revoked
            .events
            .iter()
            .any(|event| event.id == "scheduled" && event.kind == "del")
    );
    device.apply(&revoked, false).unwrap();
    assert!(
        visible_device(&mut device, OPEN + 10_000)
            .data
            .as_array()
            .unwrap()
            .is_empty()
    );

    let from = device.state().unwrap().0;
    let reopened = stream(&mut server, "alice", from, OPEN + 100);
    assert!(
        reopened
            .events
            .iter()
            .any(|event| event.id == "scheduled" && event.kind == "put")
    );
    device.apply(&reopened, false).unwrap();
    assert_eq!(
        visible_device(&mut device, 0)
            .data
            .as_array()
            .unwrap()
            .len(),
        1
    );
    host.close("time-audience", device);
}

#[test]
fn time_audience_lifecycle_memory_device() {
    lifecycle(&mut Memory::new());
}

#[test]
fn time_audience_lifecycle_sqlite_device() {
    lifecycle(&mut Sqlite::new("time-audience"));
}

fn adoption_withholds_previously_held_group<H: Host>(host: &mut H) {
    let plain = snapback4_lang::compile(&[("schema.q".into(), membership_source(false))]);
    assert!(plain.diagnostics.is_empty(), "{:#?}", plain.diagnostics);
    let plain_programs: Vec<_> = plain.programs.into_iter().map(|program| program.program).collect();
    let mut server = Engine::new_at(Store::memory().unwrap(), plain.schema.clone(), plain_programs.clone(), 0).unwrap();
    server.seed_at([
        ("members".into(), object([
            ("id", id("member")),
            ("room", Value::String("room".into())),
            ("principal", id("alice")),
            ("opensAt", Value::Int(OPEN)),
        ])),
        ("notes".into(), object([
            ("id", id("note")),
            ("room", Value::String("room".into())),
            ("body", Value::String("secret".into())),
        ])),
    ], 0).unwrap();
    let mut device = host.open("time-audience-adoption", Some(Backend {
        generation: server.generation(),
        schema: plain.schema,
        programs: plain_programs,
    })).unwrap();
    device.apply(&snapshot(&mut server, "alice", 0), true).unwrap();
    assert_eq!(device.query("visibleNotes", "alice", &json!({}), 0).unwrap().data.as_array().unwrap().len(), 1);

    let timed = snapback4_lang::compile(&[("schema.q".into(), membership_source(true))]);
    assert!(timed.diagnostics.is_empty(), "{:#?}", timed.diagnostics);
    let timed_programs: Vec<_> = timed.programs.into_iter().map(|program| program.program).collect();
    server.adopt_at(timed.schema.clone(), timed_programs.clone(), 0).unwrap();
    device.adopt(Backend { generation: server.generation(), schema: timed.schema, programs: timed_programs }).unwrap();
    assert!(device.query("visibleNotes", "alice", &json!({}), OPEN + 10_000).is_err(), "the new generation is fenced before its snapshot");

    let hidden = snapshot(&mut server, "alice", 0);
    assert!(!hidden.events.iter().any(|event| event.table == "notes" && event.id == "note"));
    device.apply(&hidden, true).unwrap();
    assert!(device.query("visibleNotes", "alice", &json!({}), OPEN + 10_000).unwrap().data.as_array().unwrap().is_empty(), "a hostile local clock cannot restore the old row or group grant");

    let from = device.state().unwrap().0;
    let opened = stream(&mut server, "alice", from, OPEN);
    assert!(opened.events.iter().any(|event| event.table == "notes" && event.id == "note" && event.kind == "put"));
    device.apply(&opened, false).unwrap();
    assert_eq!(device.query("visibleNotes", "alice", &json!({}), 0).unwrap().data.as_array().unwrap().len(), 1, "the authoritative opening restores the group and payload under the applied server clock");
    host.close("time-audience-adoption", device);
}

#[test]
fn time_audience_adoption_memory_device() {
    adoption_withholds_previously_held_group(&mut Memory::new());
}

#[test]
fn time_audience_adoption_sqlite_device() {
    adoption_withholds_previously_held_group(&mut Sqlite::new("time-audience-adoption"));
}

fn pending_write_retries_from_the_durable_outbox<H: Host>(host: &mut H) {
    let (mut server, backend) = compile_pending();
    server.seed_at(["a", "b"].map(|key| (
        "gates".into(),
        object([
            ("id", id(key)),
            ("opensAt", Value::Int(OPEN)),
            ("closesAt", Value::Int(500)),
        ]),
    )), 0).unwrap();
    let mut device = host.open("pending-write", Some(backend)).unwrap();
    device.apply(&snapshot(&mut server, "alice", 0), true).unwrap();
    let queued = device.admit(Queued {
        upload: None,
        id: "same-write".into(),
        seq: 1,
        op: "grant".into(),
        args: json!({"id":"b", "award":"award"}),
        new_ids: vec![],
        predicted: vec![],
        viewer: "alice".into(),
        now: OPEN,
        predictable: false,
        sent_seq: None,
        receipt_store: None,
        observed_seq: None,
        dispatch: None,
    }).unwrap();
    assert!(device.store().raw_rows("awards").is_empty(), "admission invented award authority");
    device.begin_send_for(Some(&queued.id)).unwrap();
    let args = BTreeMap::from([
        ("id".into(), id("b")),
        ("award".into(), id("award")),
    ]);
    let error = server.mutate(
        "grant",
        Some(&queued.id),
        Context::new("alice", args.clone()).at(OPEN),
    ).unwrap_err();
    assert_eq!(error.code(), "E_TIME_AUDIENCE_PENDING");
    assert!(error.refusal().retryable);
    device.hold_write(&queued.id, error.code().as_ref()).unwrap();
    let held = device.queued().unwrap();
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].id, queued.id);
    assert_eq!(held[0].dispatch.as_deref(), Some("E_TIME_AUDIENCE_PENDING"));
    assert_eq!(held[0].receipt_store, None);
    assert_eq!(held[0].sent_seq, None);
    assert_eq!(server.store().count("awards").unwrap(), 0);
    assert!(device.store().raw_rows("awards").is_empty());

    host.close("pending-write", device);
    let mut device = host.open("pending-write", None).unwrap();
    let restored = device.queued().unwrap();
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].id, "same-write");
    assert_eq!(restored[0].dispatch.as_deref(), Some("E_TIME_AUDIENCE_PENDING"));
    assert_eq!(restored[0].receipt_store, None);

    let opened = server.query(
        "asserted",
        Context::new("alice", BTreeMap::from([("id".into(), id("b"))])).at(OPEN),
    ).unwrap();
    assert_eq!(opened.data.as_object().unwrap().get("id"), Some(&id("b")));
    device.begin_send_for(Some("same-write")).unwrap();
    assert_eq!(device.queued().unwrap()[0].dispatch.as_deref(), Some(""));
    let sent = server.mutate(
        "grant",
        Some("same-write"),
        Context::new("alice", args.clone()).at(OPEN),
    ).unwrap();
    let WriteState::Sent { seq, .. } = sent.state else { panic!("retry failed: {sent:?}") };
    let replay = server.mutate(
        "grant",
        Some("same-write"),
        Context::new("alice", args).at(OPEN),
    ).unwrap();
    assert!(replay.replayed, "the original id was not recognized after success");
    assert_eq!(server.store().count("awards").unwrap(), 1);

    device.settle("same-write", Some(seq)).unwrap();
    let from = device.state().unwrap().0;
    device.apply(&stream(&mut server, "alice", from, OPEN), false).unwrap();
    assert!(device.queued().unwrap().is_empty());
    let awards = device.store().raw_rows("awards");
    assert_eq!(awards.len(), 1);
    assert_eq!(awards[0].as_object().unwrap().get("id"), Some(&id("award")));
    host.close("pending-write", device);
    let mut device = host.open("pending-write", None).unwrap();
    assert!(device.queued().unwrap().is_empty());
    assert_eq!(device.store().raw_rows("awards").len(), 1);
}

#[test]
fn pending_write_retries_from_memory_device_outbox() {
    pending_write_retries_from_the_durable_outbox(&mut Memory::new());
}

#[test]
fn pending_write_retries_from_sqlite_device_outbox() {
    pending_write_retries_from_the_durable_outbox(&mut Sqlite::new("pending-write"));
}
