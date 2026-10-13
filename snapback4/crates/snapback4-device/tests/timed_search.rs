mod common;

use common::*;
use snapback4_core::{Context, QueryOutcome, Rows, Value, engine::local, meter::Ceilings, value::object};
use snapback4_device::store::DeviceStore;
use std::collections::BTreeMap;

const SOURCE: &str = r#"table documents:
  opensAt: time
  visible: bool
  body: text <=100
  by byOpening: opensAt
  by byWords: words(body), id
  not before .opensAt
  read <- .visible = true
  online only
query search(c: cursor ?):
  return documents matching 'a' first 2 by byWords after c
"#;

const MEMBERSHIP_SOURCE: &str = r#"table members:
  room: id
  principal: principal
  unique room, principal
  read <- exists members[.room, viewer]
  sync to members[.room]
table messages:
  room: id
  opensAt: time
  body: text <=100
  at: time
  by byOpening: opensAt
  search body
  not before .opensAt
  read <- exists members[.room, viewer]
  sync to members[.room] last 10 by .at
query search(c: cursor ?):
  return messages matching 'a' first 1 by .at after c
"#;

fn row(id: &str, opens_at: i64, visible: bool, body: &str) -> Value {
    object([
        ("id", Value::Id(id.into())),
        ("opensAt", Value::Int(opens_at)),
        ("visible", Value::Bool(visible)),
        ("body", Value::String(body.into())),
    ])
}

fn pages<S: DeviceStore>(mut store: S, future: bool) -> Vec<QueryOutcome> {
    let (_, backend) = compile(SOURCE);
    store.install(&backend.schema, &Default::default(), true).unwrap();
    let transaction = store.transaction().unwrap();
    for value in [
        row("b-live", 0, true, "ashared"),
        row("c-live", 0, true, "ashared"),
    ].into_iter().chain(future.then(|| row("a-head", 100, false, "ashared"))) {
        transaction.put("documents", &backend.schema.tables["documents"], &value, None).unwrap();
    }
    if future {
        transaction.put("documents", &backend.schema.tables["documents"], &row("future-word", 100, false, "a000"), None).unwrap();
    }
    let mut cursor = Value::Null;
    let mut outcomes = Vec::new();
    loop {
        let outcome = local::query(&transaction, &backend.schema, &backend.programs[0],
            Context::new("alice", BTreeMap::from([("c".into(), cursor)])).at(50), Ceilings::default())
            .expect("timed search must not refuse");
        cursor = outcome.next.clone().map(Value::String).unwrap_or(Value::Null);
        let done = outcome.next.is_none();
        outcomes.push(outcome);
        if done { break }
    }
    outcomes
}

fn assert_pair(label: &str, absent: Vec<QueryOutcome>, present: Vec<QueryOutcome>) {
    let ids = |pages: &[QueryOutcome]| pages.iter().map(|page| {
        page.data.as_array().unwrap()[0].field("id").unwrap().as_str().unwrap().to_owned()
    }).collect::<Vec<_>>();
    assert_eq!(ids(&absent), ["b-live", "c-live"], "{label}: absent control must expose both live siblings");
    assert_eq!(ids(&present), ["b-live", "c-live"], "{label}: a future head must not skip the shared-word siblings");
    assert!(absent[0].next.is_some() && present[0].next.is_some(), "{label}: first pages must continue");
    assert!(absent[1].next.is_none() && present[1].next.is_none(), "{label}: second pages must finish");
    assert_eq!(absent, present, "{label}: future heads changed data, refusal, meter, or continuation");
}

fn assert_online_pair(label: &str, absent: Vec<QueryOutcome>, present: Vec<QueryOutcome>) {
    let ids = |pages: &[QueryOutcome]| pages[0].data.as_array().unwrap().iter().map(|row| {
        row.field("id").unwrap().as_str().unwrap().to_owned()
    }).collect::<Vec<_>>();
    assert_eq!(ids(&absent), ["b-live", "c-live"], "{label}: absent control must expose both live siblings");
    assert_eq!(ids(&present), ["b-live", "c-live"], "{label}: a future head must not skip the shared-word siblings");
    assert_eq!(absent.len(), 1, "{label}: online-only search must withhold continuation");
    assert_eq!(present.len(), 1, "{label}: online-only search must withhold continuation");
    assert!(absent[0].next.is_none() && present[0].next.is_none());
    assert_eq!(absent, present, "{label}: future heads changed data, refusal, meter, or continuation");
}

fn membership_pages<S: DeviceStore>(mut store: S, future: bool) -> Vec<QueryOutcome> {
    let (_, backend) = compile(MEMBERSHIP_SOURCE);
    store.install(&backend.schema, &Default::default(), true).unwrap();
    let transaction = store.transaction().unwrap();
    transaction.put("members", &backend.schema.tables["members"], &object([
        ("id", Value::Id("member".into())), ("room", Value::Id("room".into())),
        ("principal", Value::Id("alice".into())),
    ]), None).unwrap();
    for (id, opens_at, at) in [("b-live", 0, 1), ("c-live", 0, 2)]
        .into_iter().chain(future.then_some(("a-head", 100, 0)))
    {
        transaction.put("messages", &backend.schema.tables["messages"], &object([
            ("id", Value::Id(id.into())), ("room", Value::Id("room".into())),
            ("opensAt", Value::Int(opens_at)), ("body", Value::String("ashared".into())),
            ("at", Value::Int(at)),
        ]), None).unwrap();
    }
    let mut cursor = Value::Null;
    let mut outcomes = Vec::new();
    loop {
        let outcome = local::query(&transaction, &backend.schema, &backend.programs[0],
            Context::new("alice", BTreeMap::from([("c".into(), cursor)])).at(50), Ceilings::default())
            .expect("timed membership search must not refuse");
        cursor = outcome.next.clone().map(Value::String).unwrap_or(Value::Null);
        let done = outcome.next.is_none();
        outcomes.push(outcome);
        if done { break }
    }
    outcomes
}

#[test]
fn timed_search_word_heads_memory() {
    assert_online_pair("memory", pages(snapback4_device::memory::MemoryStore::new(), false),
        pages(snapback4_device::memory::MemoryStore::new(), true));
    assert_pair("memory-membership", membership_pages(snapback4_device::memory::MemoryStore::new(), false),
        membership_pages(snapback4_device::memory::MemoryStore::new(), true));
}

#[test]
fn timed_search_word_heads_sqlite() {
    let host = Sqlite::new("timed-search");
    let stores = ["absent", "present"].map(|name| {
        let path = host.path(name);
        let (_, backend) = compile(SOURCE);
        drop(snapback4_device::device::Device::open(&path, Some(backend)).unwrap());
        snapback4_core::Store::open(&path).unwrap()
    });
    let [absent, present] = stores;
    assert_online_pair("sqlite", pages(absent, false), pages(present, true));

    let stores = ["membership-absent", "membership-present"].map(|name| {
        let path = host.path(name);
        let (_, backend) = compile(MEMBERSHIP_SOURCE);
        drop(snapback4_device::device::Device::open(&path, Some(backend)).unwrap());
        snapback4_core::Store::open(&path).unwrap()
    });
    let [absent, present] = stores;
    assert_pair("sqlite-membership", membership_pages(absent, false), membership_pages(present, true));
}
