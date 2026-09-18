//! The identical old-wire probe also runs against base 27a8a4d66.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, value::object};
use snapback4_device::device::{Queued, StreamPage};

fn legacy<H: Host>(h: &mut H, abandon: bool) {
    let (mut e, backend) = compile(r#"
use personas alice
table counters:
  n: int
  read <- allow
  update <- allow
  sync public
query one():
  return counters['a']
mutation bump():
  c = counters['a'] ! else NOT_FOUND
  update counters['a'] {n: c.n + 1}
"#);
    e.seed([("counters".into(), object([("id", id("a")), ("n", Value::Int(0))]))]).unwrap();
    let mut d = h.open("legacy", Some(backend)).unwrap();
    d.apply(&snapshot_pages(&mut e, "dev:alice", 100).remove(0), true).unwrap();
    if abandon {
        assert!(d.sync_state().unwrap().pending_ids.is_empty());
        // Fetch failed before any response arrived: no apply or rejection.
    }
    let q: Queued = serde_json::from_value(json!({"id":"q","seq":0,"op":"bump","args":{},
        "new_ids":[],"predicted":[],"viewer":"dev:alice","now":100,"predictable":true})).unwrap();
    d.admit(q).unwrap();
    d.begin_send().unwrap();
    e.mutate("bump", Some("q"), context("dev:alice", &[]).at(100)).unwrap();
    // Mutation response is lost too; sync must discover the execution.
    let request = d.sync_state().unwrap();
    let wire = e.stream("dev:alice", request.watermark, 100).unwrap();
    assert!(!wire.more);
    let ack = e.acknowledged("dev:alice", &request.pending_ids, wire.watermark).unwrap();
    let captured = serde_json::to_value(&request).unwrap();
    let page = json!({"snapshot":false,"watermark":wire.watermark,"more":false,
        "requested_watermark":request.watermark,"captured_watermark":request.watermark,
        "send_revision":request.send_revision,"acknowledged":ack,
        "pending_through":captured.get("pending_through"),"pending_complete":captured.get("pending_complete"),
        "pending_bound":captured.get("pending_bound"),"joined":wire.joined,"acquisitions":wire.acquisitions,
        "events":wire.events.iter().map(|ev| json!({"table":ev.table,"kind":ev.kind,"id":ev.id,
            "data":ev.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>()});
    assert!(page.get("images_at").is_none() && page.get("committed_above").is_none());
    let page: StreamPage = serde_json::from_value(page).unwrap();
    d.apply(&page, false).unwrap();
    let server = e.query("one", context("dev:alice", &[]).at(100)).unwrap().data.field("n").unwrap().as_int().unwrap();
    let device = d.query("one", "dev:alice", &json!({}), 100).unwrap().data.field("n").unwrap().as_int().unwrap();
    h.close("legacy", d);
    let mut d = h.open("legacy", None).unwrap();
    let reopened = d.query("one", "dev:alice", &json!({}), 100).unwrap().data.field("n").unwrap().as_int().unwrap();
    println!("{} abandon={abandon}: server={server}, device={device}, reopened={reopened}, pending={:?}, ack={ack:?}", h.label(), request.pending_ids);
    assert_eq!((server, device, reopened), (1, 1, 1), "caught-up old-server behavior must match base");
}
#[test] fn abandoned_legacy_capture_memory() { legacy(&mut Memory::new(), true); }
#[test] fn abandoned_legacy_capture_sqlite() { legacy(&mut Sqlite::new("legacy-abandoned"), true); }
#[test] fn fresh_legacy_capture_memory() { legacy(&mut Memory::new(), false); }
#[test] fn fresh_legacy_capture_sqlite() { legacy(&mut Sqlite::new("legacy-fresh"), false); }
