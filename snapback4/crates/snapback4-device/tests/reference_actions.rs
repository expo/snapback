//! Referential actions on a device (LLP 3000.039 §6.4), the same scenarios on
//! native SQLite and the wasm memory adapter: a device predicts a parent
//! delete, cascade and refusal included, only over referencing groups it holds
//! completely; otherwise the call queues and the server decides.
mod common;
use common::*;
use snapback4_core::{Context, Engine, WriteState};
use snapback4_device::{device::{Device, StreamPage}, store::DeviceStore};
use serde_json::{Value as Json, json};

const PUBLIC: &str = r#"use personas alice, bob
table projects:
  owner: principal
  public 'projects'
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync public
table tasks:
  project: projects on delete cascade
  owner: principal
  cap 20 by project
  public 'tasks'
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync public
table notes:
  task: tasks on delete restrict
  author: principal
  public 'notes'
  insert <- .author = viewer
  delete <- .author = viewer
  sync public
mutation setup():
  insert projects { id: 'p', owner: viewer }
  insert tasks { id: 't1', project: 'p', owner: viewer }
  insert tasks { id: 't2', project: 'p', owner: viewer }
mutation note(task: tasks):
  insert notes { id: 'n', task, author: viewer }
mutation dropProject(id: projects):
  delete projects[id]
query taskIds(c: cursor ?):
  return tasks first 20 by .id after c { id }
"#;

/// A second referencing table whose rows are private to their author: no
/// viewer can prove it holds every row that names a project.
fn private() -> String {
    PUBLIC.replace("mutation setup():", "table secrets:\n  project: projects on delete restrict\n  author: principal\n  read <- .author = viewer\n  insert <- .author = viewer\n  sync to .author\nmutation setup():")
}

fn acquire<S: DeviceStore>(engine: &mut Engine, device: &mut Device<S>, viewer: &str, now: i64) {
    let mut after = None;
    let mut first = true;
    loop {
        let page = engine.snapshot_acquisition_page_at(viewer, after.as_deref(), 100, now).unwrap();
        let next = page.next.map(|n| n.encode());
        let page: StreamPage = serde_json::from_value(json!({"snapshot":true,"after":after,"held":page.held,"acquisitions":page.acquisitions,
            "events":page.events.iter().map(|e| json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
            "watermark":page.watermark,"more":next.is_some(),"next":next,"generation":engine.generation()})).unwrap();
        device.apply(&page, first).unwrap();
        if next.is_none() { break; }
        after = next;
        first = false;
    }
}

fn write(e: &mut Engine, op: &str, viewer: &str, values: &[(&str, snapback4_core::Value)]) -> String {
    match e.mutate(op, None, Context::new(viewer, args(values)).at(100)).unwrap().state {
        WriteState::Sent { .. } => "ok".into(),
        WriteState::Failed { why, .. } => why.code,
    }
}

fn task_ids<S: DeviceStore>(d: &mut Device<S>) -> Json {
    let answer = snapback4_device::call::call(d, json!({"op":"query","name":"taskIds","viewer":"alice","args":{"c":null},"now":100}));
    answer["ok"]["data"].clone()
}

fn run<H: Host>(host: &mut H) {
    // Every referencing group is public and held: the cascade predicts, deleting the held tasks.
    let (mut e, b) = compile(PUBLIC);
    assert_eq!(write(&mut e, "setup", "alice", &[]), "ok");
    let mut d = host.open("cascade", Some(b.clone())).unwrap();
    acquire(&mut e, &mut d, "alice", 100);
    assert_eq!(task_ids(&mut d), json!([{"id":"t1"},{"id":"t2"}]));
    let predicted = d.predict("dropProject", "alice", &json!({"id":"p"}), 100, vec![], 1);
    assert!(predicted.is_ok(), "{predicted:?}");
    assert_eq!(task_ids(&mut d), json!([]), "the predicted delete predicts its cascade");
    assert_eq!(write(&mut e, "dropProject", "alice", &[("id", id("p"))]), "ok");
    assert!(e.store().rows("tasks").unwrap().is_empty());
    host.close("cascade", d);

    // A held, current note on a cascaded task refuses on the device as on the server.
    let (mut e, b) = compile(PUBLIC);
    assert_eq!(write(&mut e, "setup", "alice", &[]), "ok");
    assert_eq!(write(&mut e, "note", "bob", &[("task", id("t1"))]), "ok");
    let mut d = host.open("restrict", Some(b)).unwrap();
    acquire(&mut e, &mut d, "alice", 100);
    let refused = d.predict("dropProject", "alice", &json!({"id":"p"}), 100, vec![], 1).unwrap_err();
    assert_eq!(refused.code(), "E_REFERENCED", "{refused:?}");
    assert_eq!(write(&mut e, "dropProject", "alice", &[("id", id("p"))]), "E_REFERENCED");
    assert_eq!(task_ids(&mut d), json!([{"id":"t1"},{"id":"t2"}]));
    host.close("restrict", d);

    // A referencing group the device cannot hold whole (another author's private
    // rows) queues the delete: it never predicts half of it.
    let (mut e, b) = compile(&private());
    assert_eq!(write(&mut e, "setup", "alice", &[]), "ok");
    let mut d = host.open("queued", Some(b)).unwrap();
    acquire(&mut e, &mut d, "alice", 100);
    let queued = d.predict("dropProject", "alice", &json!({"id":"p"}), 100, vec![], 1).unwrap_err();
    assert_eq!(queued.code(), "E_PREDICT", "{queued:?}");
    assert_eq!(task_ids(&mut d), json!([{"id":"t1"},{"id":"t2"}]), "nothing was predicted");
    assert_eq!(write(&mut e, "dropProject", "alice", &[("id", id("p"))]), "ok", "the server decides: no secret names p");
    host.close("queued", d);

    // A reused read-through parent has a current child and a retained image
    // from its former audience. History cannot be skipped into a successful
    // cascade: it is outside the schema's live cap and reservation.
    let source = r#"
table groups:
  public 'groups'
  sync public
table parents:
  group: groups
  immutable group
  read through .group
  delete <- allow
  sync
table children:
  parent: parents on delete cascade
  cap 1 by parent
  immutable parent
  read through .parent
  retain delivered-history
  sync
mutation drop(id: parents):
  delete parents[id]
"#;
    let (mut e, b) = compile(source);
    let row = |table: &str, fields: &[(&str, snapback4_core::Value)]| (table.to_owned(), snapback4_core::value::object(fields.iter().cloned()));
    e.seed_at([row("groups", &[("id", id("old"))]), row("groups", &[("id", id("new"))]),
        row("parents", &[("id", id("p")), ("group", id("old"))]),
        row("children", &[("id", id("a")), ("parent", id("p"))])], 100).unwrap();
    let mut d = host.open("retained-cascade", Some(b)).unwrap();
    acquire(&mut e, &mut d, "alice", 100);
    let (watermark, generation) = d.state().unwrap();
    let page: StreamPage = serde_json::from_value(json!({"snapshot":false,"events":[
        {"table":"children","kind":"scope","id":"scope","data":["old"]},
        {"table":"parents","kind":"put","id":"p","data":{"id":"p","group":"new","$scope":"new","$deadline":null}},
        {"table":"children","kind":"put","id":"b","data":{"id":"b","parent":"p","$scope":"new","$deadline":null}}
    ],"watermark":watermark,"more":false,"generation":generation})).unwrap();
    d.apply(&page, false).unwrap();
    assert_eq!(d.store().raw_rows("children").len(), 2, "old history and one current child");
    let queued = d.predict("drop", "alice", &json!({"id":"p"}), 100, vec![], 1).unwrap_err();
    assert_eq!(queued.code(), "E_PREDICT", "{queued:?}");
    assert!(queued.to_string().contains("retained"), "{queued:?}");
    assert_eq!(d.store().raw_rows("children").len(), 2, "queue rolls back all local writes");
    host.close("retained-cascade", d);
}

#[test] fn reference_actions_memory() { run(&mut Memory::new()); }
#[test] fn reference_actions_sqlite() { run(&mut Sqlite::new("reference-actions")); }

/// Every host prices a delete alike: the device's projection of the schema
/// gives the reservation the full schema gives (LLP 3000.039 §5.1).
#[test]
fn the_device_projection_prices_every_delete_as_the_server_does() {
    for source in [PUBLIC.to_owned(), private()] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let projected = bound.schema.public_projection();
        for name in bound.schema.tables.keys() {
            assert_eq!(bound.schema.delete_reservation(name), projected.delete_reservation(name), "{name}");
        }
    }
}
