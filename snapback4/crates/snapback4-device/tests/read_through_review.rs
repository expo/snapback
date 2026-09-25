//! Round-9 device regressions on both storage adapters.
mod common;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_device::{
    device::{Device, StreamPage},
    store::DeviceStore,
};

const SOURCE: &str = r#"table parents:
  owner: principal
  until: time ?
  immutable owner, until
  expire at .until
  read <- .owner = viewer
  insert <- allow
  delete <- allow
  sync

table children:
  parent: parents
  immutable parent
  read through .parent
  insert <- allow
  delete <- allow
  sync

mutation setup():
  insert parents {id: 'p', owner: viewer, until: 300}
  insert children {id: 'c', parent: 'p'}

mutation replace(until: time ?):
  delete children['c']
  delete parents['p']
  insert parents {id: 'p', owner: viewer, until}

mutation drop():
  delete parents['p']

query page():
  children where .parent = 'p' first 10 by .id
"#;
fn apply<S: DeviceStore>(d: &mut Device<S>, now: i64, events: Json) -> Vec<String> {
    let (watermark, generation) = d.state().unwrap();
    let page: StreamPage = serde_json::from_value(json!({"snapshot":false,"watermark":watermark,"generation":generation,"more":false,"now":now,"events":events})).unwrap();
    d.apply(&page, false).unwrap()
}
fn query<S: DeviceStore>(d: &mut Device<S>, name: &str) -> Json {
    snapback4_device::call::call(
        d,
        json!({"op":"query","name":name,"viewer":"alice","args":{},"now":100}),
    )["ok"]
        .clone()
}
fn deadline_reuse<H: Host>(host: &mut H) {
    let (mut e, b) = compile(SOURCE);
    e.mutate("setup", None, context("alice", &[]).at(100))
        .unwrap();
    let mut d = host.open("deadline-reuse", Some(b)).unwrap();
    let page = e
        .snapshot_acquisition_page_at("alice", None, 100, 100)
        .unwrap();
    let snapshot:StreamPage=serde_json::from_value(json!({"snapshot":true,"held":page.held,"acquisitions":page.acquisitions,"events":page.events.iter().map(|e|json!({"table":e.table,"kind":"put","id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":page.watermark,"generation":e.generation(),"more":false,"now":100})).unwrap();
    d.apply(&snapshot, true).unwrap();
    let before = query(&mut d, "page");
    assert_eq!(before["data"][0]["id"], "c", "{before}");
    assert_eq!(before["complete"], true);
    assert_eq!(before["nextExpiry"], 300);
    e.mutate(
        "replace",
        None,
        context("alice", &[("until", snapback4_core::Value::Int(500))]).at(100),
    )
    .unwrap();
    let page = e
        .snapshot_acquisition_page_at("alice", None, 100, 100)
        .unwrap();
    let events=page.events.iter().filter(|e|e.table=="parents").map(|e|json!({"table":e.table,"kind":"put","id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect();
    apply(&mut d, 100, Json::Array(events));
    let after = query(&mut d, "page");
    assert_eq!(
        after["data"],
        json!([]),
        "deadline-only mismatch must not borrow the replacement parent's verdict: {after}"
    );
    assert_eq!(after["unknown"], true);
    assert_eq!(after["complete"], false);
    assert_ne!(after["unavailable"], true);
    let queued=d.admit(serde_json::from_value(json!({"id":"drop","seq":0,"op":"drop","args":{},"viewer":"alice","now":100,"predictable":true})).unwrap()).unwrap();
    assert!(
        !queued.predictable && queued.predicted.is_empty(),
        "a mismatched child is uncertainty, not a terminal refusal: {queued:?}"
    );
}

fn replay_touched<H: Host>(host: &mut H) {
    let source = r#"table notes:
  at: time
  read <- allow
  insert <- allow
  sync

table later:
  at: time
  read <- allow
  insert <- allow
  sync

mutation add():
  if now < 300:
    insert notes {id: 'n', at: now}
  if now >= 200 and now < 300:
    insert later {id: 'l', at: now}

query laterPage():
  later first 10 by .id

query page():
  notes first 10 by .id
"#;
    let (mut e, b) = compile(source);
    let mut d = host.open("replay-touched", Some(b)).unwrap();
    // No expiring table or stream row can supply the missing invalidation.
    for page in snapshot_pages(&mut e, "alice", 100) {
        d.apply(&page, true).unwrap();
    }
    d.admit(serde_json::from_value(json!({"id":"add","seq":0,"op":"add","args":{},"viewer":"alice","now":100,"predictable":true})).unwrap()).unwrap();
    assert_eq!(query(&mut d, "page")["data"][0]["at"], 100);
    let touched = apply(&mut d, 200, json!([]));
    assert_eq!(query(&mut d, "page")["data"][0]["at"], 200);
    assert_eq!(query(&mut d, "laterPage")["data"][0]["at"], 200);
    assert_eq!(
        touched,
        vec!["later", "notes"],
        "rewriting the same pending id must wake its watch"
    );
    let touched = apply(&mut d, 300, json!([]));
    assert_eq!(query(&mut d, "page")["data"], json!([]));
    assert_eq!(query(&mut d, "laterPage")["data"], json!([]));
    assert_eq!(
        touched,
        vec!["later", "notes"],
        "a withdrawn prediction must also wake its watch"
    );
}
#[test]
fn reused_deadline_is_part_of_current_capture_identity() {
    deadline_reuse(&mut Memory::new());
    deadline_reuse(&mut Sqlite::new("deadline-reuse"));
}
#[test]
fn authoritative_replay_invalidates_written_and_withdrawn_tables() {
    replay_touched(&mut Memory::new());
    replay_touched(&mut Sqlite::new("replay-touched"));
}
