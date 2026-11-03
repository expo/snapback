//! @ref LLP 3000.001.001#9-scope-compatibility-and-costs — inherited families retain their full-acquisition prediction and retention proofs.
mod common;
use common::*;
use serde_json::{json, Value as Json};
use snapback4_core::{Engine, WriteState};
use snapback4_device::{device::{Device, Queued, StreamPage}, store::DeviceStore};

fn source() -> String {
    include_str!("../../snapback4-lang/tests/fixtures/read-through-device.q")
        .replace("table comments:", "table comments:\n  retain delivered-history\n  unique task")
        + "\nmutation setComment(task: tasks, body: text <=40):\n  return upsert comments[task] {body, at: 1}\nmutation leave(org: orgs):\n  delete members[org, viewer]\nmutation dropComment(id: comments):\n  delete comments[id]\n"
}
fn call<S: DeviceStore>(d: &mut Device<S>, request: Json) -> Json {
    let reply = snapback4_device::call::call(d, request);
    assert!(reply.get("denied").is_none(), "{reply}");
    reply["ok"].clone()
}
fn write(e: &mut Engine, op: &str, args: Json) -> WriteState {
    let args = args.as_object().unwrap().iter().map(|(k,v)| (k.clone(), if v.is_null() { snapback4_core::Value::Null }
        else if k == "body" { snapback4_core::Value::String(v.as_str().unwrap().into()) } else { id(v.as_str().unwrap()) })).collect();
    e.mutate(op, None, snapback4_core::Context::new("alice", args).at(100)).unwrap().state
}
fn acquire<H: Host>(host: &mut H, e: &mut Engine, mut d: Device<H::Store>) -> Device<H::Store> {
    while !d.sync_state_read().unwrap().acquisition_exhausted {
        let s = d.sync_state().unwrap();
        let p = e.acquisition_page_at("alice", s.acquisition_cursor.as_deref(), None, &[], s.transfer_watermark, 1, 100, &s.pending_ids).unwrap();
        assert!(!p.acquire.whole_tables.iter().any(|name| ["comments", "projects", "tasks"].contains(&name.as_str())));
        let events: Vec<_> = p.page.events.iter().map(|ev| json!({"table":ev.table,"kind":ev.kind,"id":ev.id,"data":ev.data.as_ref().map(snapback4_core::wire::to_json)})).collect();
        let page: StreamPage = serde_json::from_value(json!({"snapshot":false,"events":events,"joined":p.page.joined,
            "acquire":p.acquire,"watermark":p.page.watermark,"more":p.page.more,"images_at":p.page.images_at,"now":100,
            "acknowledged":p.acknowledged,"committed_above":p.committed_above,"requested_watermark":s.transfer_watermark})).unwrap();
        d.apply(&page, false).unwrap();
        host.close("inherited", d); d = host.open("inherited", None).unwrap();
    }
    let from = d.sync_state_read().unwrap().transfer_watermark;
    d.apply(&stream_page(e, "alice", from), false).unwrap();
    assert!(d.sync_state_read().unwrap().acquired);
    d
}
fn setup<H: Host>(h: &mut H) -> (Engine, Device<H::Store>) {
    let (mut e, b) = compile(&source());
    for (org, project, task) in [("o", "p", "t"), ("o2", "p2", "other")] {
        assert!(matches!(write(&mut e, "setup", json!({"org":org,"project":project,"task":task,"until":null})), WriteState::Sent {..}));
    }
    let d = h.open("inherited", Some(b)).unwrap();
    (e, d)
}
fn admit<S: DeviceStore>(d: &mut Device<S>, id: &str, op: &str, args: Json) -> Queued {
    d.admit(serde_json::from_value(json!({"id":id,"seq":0,"op":op,"args":args,"viewer":"alice","now":100,"predictable":true})).unwrap()).unwrap()
}
fn read<S: DeviceStore>(d: &mut Device<S>) -> Json {
    call(d, json!({"op":"query","name":"page","args":{"task":"t"},"viewer":"alice","now":100}))
}
fn upsert<H: Host>(h: &mut H) {
    let (mut e, d) = setup(h);
    let mut d = acquire(h, &mut e, d);
    let first = admit(&mut d, "first", "setComment", json!({"task":"t","body":"one"}));
    assert!(first.predictable, "{first:?}"); assert!(!first.predicted.is_empty());
    assert_eq!(read(&mut d)["data"][0]["body"], "one");
    let second = admit(&mut d, "second", "setComment", json!({"task":"t","body":"two"}));
    assert!(second.predictable); assert_eq!(first.predicted, second.predicted);
    assert_eq!(read(&mut d)["data"][0]["body"], "two");
    d.settle("second", None).unwrap(); assert_eq!(read(&mut d)["data"][0]["body"], "one");
    assert!(matches!(write(&mut e, "leave", json!({"org":"o"})), WriteState::Sent {..}));
    assert!(matches!(write(&mut e, "setComment", json!({"task":"t","body":"one"})), WriteState::Failed {..}));
    d.settle("first", None).unwrap(); assert_eq!(read(&mut d)["data"], json!([]));
}
fn reuse<H: Host>(h: &mut H) {
    let (mut e, d) = setup(h);
    assert!(matches!(write(&mut e, "post", json!({"id":"old","task":"t","body":"old"})), WriteState::Sent {..}));
    let mut d = acquire(h, &mut e, d);
    let watermark = d.state().unwrap().0;
    let apply = |d: &mut Device<H::Store>, events: Json| call(d, json!({"op":"apply","page":{"snapshot":false,"events":events,"watermark":watermark,"more":false}}));
    apply(&mut d, json!([{"table":"comments","kind":"scope","id":"left","data":["o"]}]));
    for (op, args) in [("dropComment", json!({"id":"old"})), ("dropTask", json!({"id":"t"})), ("newTask", json!({"id":"t","project":"p2"}))] {
        assert!(matches!(write(&mut e, op, args), WriteState::Sent {..}));
    }
    let image = |e: &mut Engine, table: &str, id: &str| {
        let p = e.snapshot_acquisition_page_at("alice", None, 100, 100).unwrap();
        let ev = p.events.iter().find(|ev| ev.table == table && ev.id == id).unwrap();
        json!({"table":table,"kind":"put","id":id,"data":ev.data.as_ref().map(snapback4_core::wire::to_json)})
    };
    apply(&mut d, json!([image(&mut e, "tasks", "t")]));
    assert_eq!(read(&mut d)["data"][0]["retained"], true);
    assert!(matches!(write(&mut e, "post", json!({"id":"z-live","task":"t","body":"live"})), WriteState::Sent {..}));
    apply(&mut d, json!([image(&mut e, "comments", "z-live")]));
    let blocked = snapback4_device::call::call(&mut d, json!({"op":"admit","entry":{"id":"blocked","seq":0,"op":"dropTask","args":{"id":"t"},"viewer":"alice","now":100,"predictable":true}}));
    assert_eq!(blocked["denied"]["code"], "E_PARENT_HAS_CHILDREN", "{blocked}");
    assert!(matches!(write(&mut e, "dropComment", json!({"id":"z-live"})), WriteState::Sent {..}));
    apply(&mut d, json!([{"table":"comments","kind":"del","id":"z-live"}]));
    let deletion = admit(&mut d, "delete", "dropTask", json!({"id":"t"}));
    assert!(deletion.predictable, "{deletion:?}"); assert_eq!(deletion.predicted, ["tasks/t"]);
    assert!(matches!(write(&mut e, "dropTask", json!({"id":"t"})), WriteState::Sent {..}));
}
#[test] fn upsert_memory() { upsert(&mut Memory::new()); }
#[test] fn upsert_sqlite() { upsert(&mut Sqlite::new("progressive-upsert")); }
#[test] fn reuse_memory() { reuse(&mut Memory::new()); }
#[test] fn reuse_sqlite() { reuse(&mut Sqlite::new("progressive-reuse")); }
