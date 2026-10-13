//! Lower read lifetimes cross the server boundary before either production
//! device store can observe their payload.
mod common;

use common::*;
use serde_json::json;
use snapback4_core::{Context, Engine, Store, Value, WriteState, value::object, wire};
use snapback4_device::device::{Backend, StreamPage};
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
