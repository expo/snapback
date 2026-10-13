//! Deterministic server-clock coverage for lower read lifetimes.
use serde_json::{Value as Json, json};
use snapback4_core::rows::Rows;
use snapback4_core::{Context, Engine, Store, Value, WriteState, value::object};
use snapback4_sim::host::ServerHost;
use snapback4_sim::{Ctx, Event, Host, HostId, Sim};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

fn id(value: &str) -> Value {
    Value::Id(value.into())
}

fn text(value: &str) -> Value {
    Value::String(value.into())
}

fn engine(source: &str, now: i64) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    Engine::new_at(
        Store::memory().unwrap(),
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
        now,
    )
    .unwrap()
}

const PUBLIC: &str = r#"table releases:
  opensAt: time
  expiresAt: time ?
  payload: text <=200
  by byOpening: opensAt
  by byExpiry: expiresAt
  cap 3
  not before .opensAt
  expire at .expiresAt
  public 'released material is public during its lifetime'
  insert <- allow
  delete <- allow
  sync public last 20 by .id

query visible(c: cursor ?):
  return releases first 20 by .id after c

mutation remove(key: releases):
  delete releases[key]
  return null
"#;

fn release(id_value: &str, opens_at: i64, expires_at: Value) -> (String, Value) {
    (
        "releases".into(),
        object([
            ("id", id(id_value)),
            ("opensAt", Value::Int(opens_at)),
            ("expiresAt", expires_at),
            ("payload", text(&format!("secret-{id_value}"))),
        ]),
    )
}

struct SyncProbe {
    server: HostId,
    replies: Rc<RefCell<Vec<(u64, Json)>>>,
}

impl Host for SyncProbe {
    fn start(&mut self, ctx: &mut Ctx<'_>) {
        ctx.timer(49, 49);
        ctx.timer(50, 50);
    }

    fn on(&mut self, ctx: &mut Ctx<'_>, event: Event) {
        match event {
            Event::Timer { tag } => ctx.send(
                self.server,
                json!({"t":"sync", "rid":tag, "viewer":"alice", "from":0}).to_string(),
            ),
            Event::Deliver { payload, .. } => {
                let reply: Json = serde_json::from_slice(&payload).unwrap();
                self.replies.borrow_mut().push((ctx.now, reply));
            }
        }
    }

    fn state(&self) -> String {
        json!({"role":"time-audience-probe", "replies":self.replies.borrow().len()}).to_string()
    }
}

#[test]
fn simulated_server_publishes_at_the_exact_virtual_clock_boundary() {
    let mut server = engine(PUBLIC, 0);
    server
        .seed_at([release("scheduled", 50, Value::Null)], 0)
        .unwrap();
    let server = Rc::new(RefCell::new(server));
    let replies = Rc::new(RefCell::new(Vec::new()));
    let mut sim = Sim::new(7);
    sim.faults.delay = (0, 0);
    let server_id = sim.add(ServerHost::factory(server.clone()));
    let saved = replies.clone();
    sim.add(Box::new(move || {
        Box::new(SyncProbe {
            server: server_id,
            replies: saved.clone(),
        })
    }));
    sim.run_until(50);

    let replies = replies.borrow();
    assert_eq!(replies.len(), 2, "{}", sim.trace.tail(20));
    assert_eq!(replies[0].0, 49);
    assert!(replies[0].1["events"].as_array().unwrap().is_empty());
    assert_eq!(replies[1].0, 50);
    let events = replies[1].1["events"].as_array().unwrap();
    assert_eq!(events.len(), 1, "{}", sim.trace.tail(20));
    assert_eq!(events[0]["id"], "scheduled");
    assert_eq!(events[0]["data"]["payload"], "secret-scheduled");
    assert_eq!(
        server.borrow().seq().unwrap(),
        2,
        "the boundary is an ordinary commit"
    );
}

#[test]
fn future_rows_occupy_caps_but_delete_and_expiry_disclose_nothing() {
    let mut server = engine(PUBLIC, 0);
    server
        .seed_at(
            [
                release("future", 100, Value::Null),
                release("deleted", 100, Value::Null),
                release("never-live", 100, Value::Int(50)),
            ],
            0,
        )
        .unwrap();
    let tx = server.store_mut().transaction().unwrap();
    assert_eq!(tx.cap_count("releases", &[], &[]).unwrap(), 3);
    tx.rollback().unwrap();

    let removed = server
        .mutate(
            "remove",
            None,
            Context::new("alice", BTreeMap::from([("key".into(), id("deleted"))])).at(10),
        )
        .unwrap();
    assert!(
        matches!(removed.state, WriteState::Sent { .. }),
        "{removed:?}"
    );
    assert_eq!(server.sweep_expired(50, 100).unwrap(), 1);
    let tx = server.store_mut().transaction().unwrap();
    assert_eq!(tx.cap_count("releases", &[], &[]).unwrap(), 1);
    assert!(tx.get("releases", "future").unwrap().is_some());
    tx.rollback().unwrap();

    let before = server.stream_at("alice", 0, 100, 99).unwrap();
    assert!(
        before.events.is_empty(),
        "delete/expiry before opening emitted payload or identity: {before:?}"
    );
    let mut events = Vec::new();
    let mut watermark = before.watermark;
    for _ in 0..4 {
        let at = server.stream_at("alice", watermark, 100, 100).unwrap();
        watermark = at.watermark;
        events.extend(at.events);
        if !events.is_empty() {
            break;
        }
    }
    assert_eq!(
        events.len(),
        1,
        "stale private openings must make bounded progress"
    );
    assert_eq!(events[0].id, "future");
    assert!(events[0].data.is_some());
}

const MEMBERSHIP: &str = r#"table members:
  team: text <=20
  principal: principal
  opensAt: time
  by byOpening: opensAt
  unique team, principal
  cap 1000 by team
  immutable team, principal
  not before .opensAt
  read <- .principal = viewer
  insert <- exists members[.team, viewer]
  sync

table notes:
  team: text <=20
  body: text <=200
  read <- exists members[.team, viewer]
  insert <- allow
  sync

query feed(c: cursor ?):
  return notes first 20 by .id after c
"#;

#[test]
fn future_membership_grants_no_group_until_its_opening_commit() {
    let mut server = engine(MEMBERSHIP, 0);
    server
        .seed_at(
            [
                (
                    "members".into(),
                    object([
                        ("id", id("member")),
                        ("team", text("g")),
                        ("principal", id("alice")),
                        ("opensAt", Value::Int(100)),
                    ]),
                ),
                (
                    "notes".into(),
                    object([
                        ("id", id("note")),
                        ("team", text("g")),
                        ("body", text("group secret")),
                    ]),
                ),
            ],
            0,
        )
        .unwrap();

    let before = server.snapshot_at("alice", 99).unwrap().0;
    assert!(
        before.is_empty(),
        "future membership granted early: {before:?}"
    );
    let at = server.snapshot_at("alice", 100).unwrap().0;
    assert!(
        at.iter()
            .any(|event| event.table == "members" && event.id == "member")
    );
    assert!(
        at.iter()
            .any(|event| event.table == "notes" && event.id == "note")
    );
    let answer = server
        .query(
            "feed",
            Context::new("alice", BTreeMap::from([("c".into(), Value::Null)])).at(100),
        )
        .unwrap();
    assert_eq!(answer.data.as_array().unwrap().len(), 1);
}
