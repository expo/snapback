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
    // Digest-addressed maintained rows use the same fixed identity on the
    // server and each device store, even for the largest composite values in
    // this generated family.
    let aggregate = r#"
table groups:
  public
  sync public
table entries:
  owner: principal
  parent: groups
  token: text <=64
  amount: int
  public
  sync public
view totals: sum entries of .amount by .owner, .parent, .token
  public
"#;
    let (mut e, b) = compile(aggregate);
    let principal = "p".repeat(64);
    let parent = "r".repeat(64);
    let token = "x".repeat(64);
    e.seed_at([
        ("groups".into(), snapback4_core::value::object([("id", id(&parent))])),
        ("entries".into(), snapback4_core::value::object([
            ("id", id("entry")), ("owner", id(&principal)), ("parent", id(&parent)),
            ("token", snapback4_core::Value::String(token.clone())),
            ("amount", snapback4_core::Value::Int(7)),
        ])),
    ], 0).unwrap();
    let expected = snapback4_core::schema::maintained_id(&[
        id(&principal), id(&parent), snapback4_core::Value::String(token),
    ]);
    assert_eq!(expected.len(), 64);
    let mut d = host.open("aggregate-digest", Some(b)).unwrap();
    acquire(&mut e, &mut d, &principal, 0);
    let rows = d.store().raw_rows("totals");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].field("id").unwrap(), &id(&expected));
    host.close("aggregate-digest", d);

    // Server expiry is a physical retirement with the schema's declared
    // referential effects. Devices receive that one committed closure just as
    // they receive an authored parent delete.
    let expiring = r#"
table parents:
  until: time
  expire at .until
  public 'parents'
  sync public
table cascadeChildren:
  parent: parents on delete cascade
  cap 1 by parent
  public 'cascadeChildren'
  sync public
table nullableChildren:
  parent: parents ? on delete set null
  cap 1 by parent
  public 'nullableChildren'
  sync public
table dualNullableChildren:
  left: parents ? on delete set null
  right: parents ? on delete set null
  cap 1 by left
  cap 1 by right
  public 'dualNullableChildren'
  sync public
"#;
    let (mut e, b) = compile(expiring);
    e.seed_at([
        ("parents".into(), snapback4_core::value::object([("id", id("p")), ("until", snapback4_core::Value::Int(10))])),
        ("cascadeChildren".into(), snapback4_core::value::object([("id", id("c")), ("parent", id("p"))])),
        ("nullableChildren".into(), snapback4_core::value::object([("id", id("n")), ("parent", id("p"))])),
        ("dualNullableChildren".into(), snapback4_core::value::object([("id", id("dn")), ("left", id("p")), ("right", id("p"))])),
    ], 0).unwrap();
    let mut d = host.open("expiry-actions", Some(b)).unwrap();
    acquire(&mut e, &mut d, "alice", 0);
    let from = d.state().unwrap().0;
    assert_eq!(e.sweep_expired(10, 100).unwrap(), 1);
    d.apply(&stream_page(&mut e, "alice", from), false).unwrap();
    assert!(d.store().raw_rows("parents").is_empty());
    assert!(d.store().raw_rows("cascadeChildren").is_empty());
    let nullable = d.store().raw_rows("nullableChildren");
    assert_eq!(nullable.len(), 1);
    assert_eq!(nullable[0].field("parent").unwrap(), &snapback4_core::Value::Null);
    let dual = d.store().raw_rows("dualNullableChildren");
    assert_eq!(dual[0].field("left").unwrap(), &snapback4_core::Value::Null);
    assert_eq!(dual[0].field("right").unwrap(), &snapback4_core::Value::Null);
    host.close("expiry-actions", d);

    // A hidden expired predecessor is absent from the device's logical
    // snapshot, but replacing it on the server retires its cascade child.
    // The device cannot predict only the new parent and retain that child.
    let replacement = r#"
table parents:
  owner: principal
  until: time ?
  expire at .until
  read <- .owner = viewer
  insert <- allow
  sync to .owner
table children:
  parent: parents on delete cascade
  holder: principal
  cap 1 by parent
  public
  sync public
mutation replace(id: id):
  insert parents { id, owner: viewer }
"#;
    let (mut e, b) = compile(replacement);
    e.seed_at([
        ("parents".into(), snapback4_core::value::object([
            ("id", id("p")), ("owner", id("alice")), ("until", snapback4_core::Value::Int(10)),
        ])),
        ("children".into(), snapback4_core::value::object([
            ("id", id("c")), ("parent", id("p")), ("holder", id("bob")),
        ])),
    ], 0).unwrap();
    let mut d = host.open("expiry-same-id-replacement", Some(b)).unwrap();
    acquire(&mut e, &mut d, "bob", 100);
    assert!(d.store().raw_rows("parents").is_empty());
    assert_eq!(d.store().raw_rows("children").len(), 1);
    let from = d.state().unwrap().0;
    let queued = d.predict("replace", "bob", &json!({"id":"p"}), 100, vec![], 1).unwrap_err();
    assert_eq!(queued.code(), "E_PREDICT", "{}: {queued:?}", host.label());
    assert!(d.store().raw_rows("parents").is_empty());
    assert_eq!(d.store().raw_rows("children").len(), 1, "prediction rolls back completely");
    assert_eq!(write(&mut e, "replace", "bob", &[("id", id("p"))]), "ok");
    d.apply(&stream_page(&mut e, "bob", from), false).unwrap();
    assert_eq!(d.store().raw_rows("parents").len(), 1);
    assert!(d.store().raw_rows("children").is_empty());
    host.close("expiry-same-id-replacement", d);

    // An expiring row-keyed-view source follows the same server action path;
    // derived maintenance cannot delete it before cascade/set-null run. The
    // device receives the committed source and child changes together.
    let row_view_expiry = r#"
table conversations:
  public
  sync public
table members:
  conversation: conversations
  principal: principal
  cap 4 by conversation
  public
  sync public
table messages:
  conversation: conversations
  ordinal: int
  sender: principal
  until: time ?
  expire at .until
  public
  update <- allow
  sync public
view unread: count messages by members m
  where .conversation = m.conversation and .sender != m.principal
table cascadeKids:
  message: messages on delete cascade
  cap 1 by message
  public
  sync public
table nullableKids:
  message: messages ? on delete set null
  cap 1 by message
  public
  sync public
mutation expire(message: messages):
  update messages[message] { until: now }
"#;
    let (mut e, b) = compile(row_view_expiry);
    e.seed_at([
        ("conversations".into(), snapback4_core::value::object([("id", id("c"))])),
        ("members".into(), snapback4_core::value::object([("id", id("member")), ("conversation", id("c")), ("principal", id("alice"))])),
        ("messages".into(), snapback4_core::value::object([("id", id("message")), ("conversation", id("c")), ("ordinal", snapback4_core::Value::Int(1)), ("sender", id("bob")), ("until", snapback4_core::Value::Null)])),
        ("cascadeKids".into(), snapback4_core::value::object([("id", id("cascade")), ("message", id("message"))])),
        ("nullableKids".into(), snapback4_core::value::object([("id", id("nullable")), ("message", id("message"))])),
    ], 0).unwrap();
    let mut d = host.open("row-view-expiry-actions", Some(b)).unwrap();
    acquire(&mut e, &mut d, "alice", 0);
    let from = d.state().unwrap().0;
    assert_eq!(write(&mut e, "expire", "alice", &[("message", id("message"))]), "ok");
    assert_eq!(e.store().rows("unread").unwrap()[0].field("value").unwrap(), &snapback4_core::Value::Int(0));
    d.apply(&stream_page(&mut e, "alice", from), false).unwrap();
    assert!(d.store().raw_rows("messages").is_empty());
    assert!(d.store().raw_rows("cascadeKids").is_empty());
    assert_eq!(d.store().raw_rows("nullableKids")[0].field("message").unwrap(), &snapback4_core::Value::Null);
    host.close("row-view-expiry-actions", d);

    // A read-through child below a cascade is a physical-retention blocker.
    // The server preflights it before set-null writes and continues to a later
    // due root; devices receive only that committed result.
    let retained_expiry = r#"
table roots:
  until: time
  expire at .until
  public
  sync public
table nullableKids:
  root: roots ? on delete set null
  cap 1 by root
  public
  sync public
table children:
  root: roots on delete cascade
  cap 1 by root
  public
  sync public
table grandchildren:
  child: children
  immutable child
  read through .child
table cascadeGrandchildren:
  child: children on delete cascade
  cap 1 by child
  immutable child
  read through .child
"#;
    let (mut e, b) = compile(retained_expiry);
    e.seed_at([
        ("roots".into(), snapback4_core::value::object([("id", id("p")), ("until", snapback4_core::Value::Int(10))])),
        ("roots".into(), snapback4_core::value::object([("id", id("q")), ("until", snapback4_core::Value::Int(10))])),
        ("roots".into(), snapback4_core::value::object([("id", id("z")), ("until", snapback4_core::Value::Int(10))])),
        ("nullableKids".into(), snapback4_core::value::object([("id", id("n")), ("root", id("p"))])),
        ("children".into(), snapback4_core::value::object([("id", id("c")), ("root", id("p"))])),
        ("children".into(), snapback4_core::value::object([("id", id("d")), ("root", id("q"))])),
        ("grandchildren".into(), snapback4_core::value::object([("id", id("g")), ("child", id("c"))])),
        ("cascadeGrandchildren".into(), snapback4_core::value::object([("id", id("h")), ("child", id("d"))])),
    ], 0).unwrap();
    let mut d = host.open("expiry-retained-cascade", Some(b)).unwrap();
    acquire(&mut e, &mut d, "alice", 0);
    let from = d.state().unwrap().0;
    assert_eq!(e.sweep_expired(10, 10).unwrap(), 2);
    d.apply(&stream_page(&mut e, "alice", from), false).unwrap();
    assert_eq!(d.store().raw_rows("roots").len(), 1);
    assert_eq!(d.store().raw_rows("nullableKids")[0].field("root").unwrap(), &id("p"));
    assert_eq!(d.store().raw_rows("children").len(), 1);
    host.close("expiry-retained-cascade", d);

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
  read <- exists members[.id, viewer]
  sync
table members:
  group: groups on delete keep
  principal: principal
  unique group, principal
  read <- .principal = viewer
  sync
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
        row("members", &[("id", id("mo")), ("group", id("old")), ("principal", id("alice"))]),
        row("members", &[("id", id("mn")), ("group", id("new")), ("principal", id("alice"))]),
        row("parents", &[("id", id("p")), ("group", id("old"))]),
        row("children", &[("id", id("a")), ("parent", id("p"))])], 100).unwrap();
    let mut d = host.open("retained-cascade", Some(b)).unwrap();
    acquire(&mut e, &mut d, "alice", 100);
    let (mut current, _) = compile(source);
    current.seed_at([row("groups", &[("id", id("new"))]),
        row("members", &[("id", id("mn")), ("group", id("new")), ("principal", id("alice"))]),
        row("parents", &[("id", id("p")), ("group", id("new"))]),
        row("children", &[("id", id("b")), ("parent", id("p"))])], 100).unwrap();
    let snapshot = current.snapshot_acquisition_page_at("alice", None, 100, 100).unwrap();
    let (watermark, generation) = d.state().unwrap();
    let mut events = vec![json!({"table":"children","kind":"scope","id":"scope","data":["old"]})];
    events.extend(snapshot.events.iter().filter(|e| e.table == "parents" || e.table == "children")
        .map(|e| json!({"table":e.table,"kind":"put","id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})));
    let page: StreamPage = serde_json::from_value(json!({"snapshot":false,"events":events,
        "watermark":watermark,"more":false,"generation":generation})).unwrap();
    d.apply(&page, false).unwrap();
    assert_eq!(d.store().raw_rows("children").len(), 2, "old history and one current child");
    let queued = d.predict("drop", "alice", &json!({"id":"p"}), 100, vec![], 1).unwrap_err();
    assert_eq!(queued.code(), "E_PREDICT", "{queued:?}");
    assert!(queued.to_string().contains("retained"), "{queued:?}");
    assert_eq!(d.store().raw_rows("children").len(), 2, "queue rolls back all local writes");
    host.close("retained-cascade", d);
}

#[test]
fn authoritative_memory_sweeps_resume_and_wrap_past_restricted_roots() {
    let source = r#"
table roots:
  expiresAt: time ?
  expire at .expiresAt
  public 'roots'
table cascadeKids:
  root: roots on delete cascade
  cap 4 by root
  public 'cascade kids'
table nullableKids:
  root: roots ? on delete set null
  cap 4 by root
  public 'nullable kids'
table blockers:
  root: roots
  public 'blockers'
"#;
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut store = snapback4_device::memory::MemoryStore::new();
    store.activate_server_at(bound.schema, 0).unwrap();
    store.seed_server_at([
        ("roots".into(), snapback4_core::value::object([("id", id("a-blocked")), ("expiresAt", snapback4_core::Value::Int(10))])),
        ("roots".into(), snapback4_core::value::object([("id", id("b-blocked")), ("expiresAt", snapback4_core::Value::Int(10))])),
        ("roots".into(), snapback4_core::value::object([("id", id("c-blocked")), ("expiresAt", snapback4_core::Value::Int(10))])),
        ("roots".into(), snapback4_core::value::object([("id", id("z-free")), ("expiresAt", snapback4_core::Value::Int(10))])),
        ("cascadeKids".into(), snapback4_core::value::object([("id", id("cz")), ("root", id("z-free"))])),
        ("nullableKids".into(), snapback4_core::value::object([("id", id("nz")), ("root", id("z-free"))])),
        ("blockers".into(), snapback4_core::value::object([("id", id("ba")), ("root", id("a-blocked"))])),
        ("blockers".into(), snapback4_core::value::object([("id", id("bb")), ("root", id("b-blocked"))])),
        ("blockers".into(), snapback4_core::value::object([("id", id("bc")), ("root", id("c-blocked"))])),
    ], 0).unwrap();
    let wrapped_removed: u64 = (0..4).map(|_| store.sweep_server_at(10, 1).unwrap()).sum();
    assert_eq!(wrapped_removed, 1, "continuation reaches the free root within one bounded turn per due root");
    assert!(store.raw_rows("cascadeKids").is_empty());
    assert_eq!(store.raw_rows("nullableKids")[0].field("root").unwrap(), &snapback4_core::Value::Null);

    // The cursor is after z. A lower new key is found after the scan wraps;
    // each restricted root still consumes one bounded visit.
    store.seed_server_at([("roots".into(), snapback4_core::value::object([
        ("id", id("aa-free")), ("expiresAt", snapback4_core::Value::Int(10)),
    ]))], 0).unwrap();
    let wrapped_removed: u64 = (0..4).map(|_| store.sweep_server_at(10, 1).unwrap()).sum();
    assert_eq!(wrapped_removed, 1, "a wrapped scan reaches the new lower key within one bounded turn per due root");
    assert!(!store.raw_rows("roots").iter().any(|row| row.field("id").unwrap() == &id("aa-free")));

    // Row continuation is insufficient on its own: a permanently blocked
    // table must yield the next bounded call to later expiry tables.
    let source = r#"
table aFree:
  expiresAt: time
  expire at .expiresAt
  public
table zBlocked:
  expiresAt: time
  expire at .expiresAt
  public
table zReferences:
  root: zBlocked on delete restrict
  public
"#;
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut store = snapback4_device::memory::MemoryStore::new();
    store.activate_server_at(bound.schema, 0).unwrap();
    store.seed_server_at([
        ("zBlocked".into(), snapback4_core::value::object([("id", id("blocked")), ("expiresAt", snapback4_core::Value::Int(10))])),
        ("zReferences".into(), snapback4_core::value::object([("id", id("witness")), ("root", id("blocked"))])),
        ("aFree".into(), snapback4_core::value::object([("id", id("free")), ("expiresAt", snapback4_core::Value::Int(10))])),
    ], 0).unwrap();
    assert_eq!(store.sweep_server_at(10, 1).unwrap(), 0);
    assert_eq!(store.sweep_server_at(10, 1).unwrap(), 1, "the table cursor advances past a blocked expiry table");
    assert!(store.raw_rows("aFree").is_empty());
}

#[test] fn reference_actions_memory() { run(&mut Memory::new()); }
#[test] fn reference_actions_sqlite() { run(&mut Sqlite::new("reference-actions")); }

/// Every host prices a delete alike: the device's projection of the schema
/// gives the reservation the full schema gives (LLP 3000.039 §5.1).
#[test]
fn the_device_projection_prices_every_delete_as_the_server_does() {
    for source in [PUBLIC.to_owned(), private(), PUBLIC.replace("table projects:\n  owner: principal", "table projects:\n  owner: principal\n  body: text <=1000 default ''\n  taskCount: count tasks by project")] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let projected = bound.schema.public_projection();
        for name in bound.schema.tables.keys() {
            assert_eq!(bound.schema.delete_reservation(name), projected.delete_reservation(name), "{name}");
            assert_eq!(bound.schema.action_tables(name).written, projected.action_tables(name).written, "{name}'s event envelope");
        }
    }
}
