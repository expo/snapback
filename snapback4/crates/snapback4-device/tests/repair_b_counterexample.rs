//! Regression: an incoming selector changes the pending write set.
mod common;
use common::*;
use snapback4_core::engine::WriteState;
use snapback4_core::value::{Value, object};
use snapback4_device::device::{Device, Queued, StreamPage};
use snapback4_device::store::DeviceStore;

const SOURCE: &str = r#"
use personas alice, bob
table counters:
  n: int
  read <- allow
  update <- allow
  sync public
table selectors:
  target: counters
  read <- allow
  update <- allow
  sync public
query counter(counterId: counters):
  return counters[counterId]
mutation bumpSelected():
  s = selectors['selected'] ! else NOT_FOUND
  c = counters[s.target] ! else NOT_FOUND
  update counters[s.target] {n: c.n + 1}
mutation retargetAndBump():
  update selectors['selected'] {target: 'b'}
  c = counters['b'] ! else NOT_FOUND
  update counters['b'] {n: c.n + 1}
"#;

fn value<S: DeviceStore>(device: &mut Device<S>, row: &str) -> i64 {
    device.query("counter", "dev:alice", &serde_json::json!({"counterId":row}), 1000)
        .unwrap().data.field("n").unwrap().as_int().unwrap()
}

fn counterexample<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(SOURCE);
    engine.seed([
        ("counters".into(), object([("id", id("a")), ("n", Value::Int(0))])),
        ("counters".into(), object([("id", id("b")), ("n", Value::Int(0))])),
        ("selectors".into(), object([("id", id("selected")), ("target", id("a"))])),
    ]).unwrap();
    let mut device = host.open("counterexample", Some(backend.clone())).unwrap();
    for (i, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let from = device.state().unwrap().0;
    let admitted = device.admit(Queued {
        id: "alice-1".into(), seq: 1, op: "bumpSelected".into(),
        args: serde_json::json!({}), new_ids: vec![], predicted: vec![],
        viewer: "dev:alice".into(), now: 1000, predictable: true,
        sent_seq: None, receipt_store: None, observed_seq: None,
    }).unwrap();
    assert_eq!(admitted.predicted, ["counters/a"]);
    assert_eq!((value(&mut device, "a"), value(&mut device, "b")), (1, 0));
    let bob = engine.mutate("retargetAndBump", Some("bob-1"), context("dev:bob", &[]).at(1000)).unwrap();
    let alice = engine.mutate("bumpSelected", Some("alice-1"), context("dev:alice", &[]).at(1000)).unwrap();
    let WriteState::Sent { seq: bob_seq, .. } = bob.state else { panic!("Bob did not commit") };
    let WriteState::Sent { seq: alice_seq, .. } = alice.state else { panic!("Alice did not commit") };
    device.settle("alice-1", Some(alice_seq)).unwrap();
    assert_eq!((value(&mut device, "a"), value(&mut device, "b")), (1, 0),
        "immediately before the page, replay still writes a; refreshing predicted cannot name b yet");
    let server = engine.query("counter", context("dev:alice", &[("counterId", id("b"))]).at(1000)).unwrap();
    assert_eq!(server.data.field("n").unwrap().as_int().unwrap(), 2);

    // Commit-indivisible paging includes Bob's two events, but not Alice's.
    let stream = engine.stream("dev:alice", from, 1).unwrap();
    assert_eq!(stream.watermark, bob_seq);
    assert!(stream.more);
    assert!(alice_seq > stream.watermark);
    let events = stream.events.iter().map(|e| serde_json::json!({
        "table": e.table, "kind": e.kind, "id": e.id,
        "data": e.data.as_ref().map(snapback4_core::wire::to_json),
    })).collect::<Vec<_>>();
    let capture = device.sync_state().unwrap();
    let (acknowledged, committed_above) = engine.acknowledged_at("dev:alice", &capture.pending_ids, stream.watermark, alice_seq).unwrap();
    let page: StreamPage = serde_json::from_value(serde_json::json!({
        "snapshot":false, "events":events, "watermark":stream.watermark,
        "more":stream.more, "generation":engine.generation(),
        "images_at":alice_seq, "acknowledged":acknowledged,"sent":acknowledged, "committed_above":committed_above,
    })).unwrap();
    assert!(page.acknowledged.is_empty());
    assert_eq!(page.committed_above.get("alice-1"), Some(&alice_seq));
    assert_eq!(page.events.len(), 2);
    assert!(page.events.iter().any(|e| e.table == "selectors" && e.data.as_ref().unwrap()["target"] == "b"));
    assert!(page.events.iter().any(|e| e.table == "counters" && e.id == "b" && e.data.as_ref().unwrap()["n"] == 2));

    device.apply(&page, false).unwrap();
    assert_eq!((value(&mut device, "a"), value(&mut device, "b")), (1, 0));
    assert_eq!(device.state().unwrap().0, from);
    host.close("counterexample", device);
    let mut reopened = host.open("counterexample", None).unwrap();
    assert_eq!((value(&mut reopened, "a"), value(&mut reopened, "b")), (1, 0));
    assert_eq!(reopened.state().unwrap().0, from);
    let capture = reopened.sync_state().unwrap();
    let mut covering = stream_page(&mut engine, "dev:alice", capture.transfer_watermark);
    covering.acknowledged = engine.acknowledged("dev:alice", &capture.pending_ids, covering.watermark).unwrap();
    covering.sent = covering.acknowledged.clone();
    reopened.apply(&covering, false).unwrap();
    assert_eq!((value(&mut reopened, "a"), value(&mut reopened, "b")), (0, 2));
    reopened.admit(Queued { id: "alice-2".into(), seq: 0, op: "bumpSelected".into(),
        args: serde_json::json!({}), new_ids: vec![], predicted: vec![], viewer: "dev:alice".into(),
        now: 1000, predictable: true, sent_seq: None, receipt_store: None, observed_seq: None }).unwrap();
    assert_eq!((value(&mut reopened, "a"), value(&mut reopened, "b")), (0, 3), "the deferred selector must survive");
    host.close("counterexample", reopened);
}

#[test]
fn repair_b_predicate_misses_the_current_pages_changed_write_set_memory() {
    counterexample(&mut Memory::new());
}

#[test]
fn repair_b_predicate_misses_the_current_pages_changed_write_set_sqlite() {
    counterexample(&mut Sqlite::new("repair-b-counterexample"));
}
