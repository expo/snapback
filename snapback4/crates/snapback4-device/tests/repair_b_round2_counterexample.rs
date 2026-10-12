//! Regression: deferred receipts cannot retire predictions before their effects.
mod common;
use common::*;
use snapback4_core::engine::WriteState;
use snapback4_core::value::{Value, object};
use snapback4_device::device::{Device, Queued, StreamPage};
use snapback4_device::store::DeviceStore;
use std::collections::BTreeMap;

const SOURCE: &str = r#"
use personas alice
table counters:
  n: int
  read <- allow
  update <- allow
  sync public
query counter():
  return counters['a']
mutation adjust(delta: int):
  c = counters['a'] ! else NOT_FOUND
  update counters['a'] {n: c.n + delta}
"#;

fn value<S: DeviceStore>(device: &mut Device<S>) -> i64 {
    device.query("counter", "dev:alice", &serde_json::json!({}), 1000)
        .unwrap().data.field("n").unwrap().as_int().unwrap()
}

fn counterexample<H: Host>(host: &mut H, receive_write_responses: bool) {
    let name = "round2-counterexample";
    let (mut engine, backend) = compile(SOURCE);
    engine.seed([("counters".into(), object([
        ("id", id("a")), ("n", Value::Int(2)),
    ]))]).unwrap();
    let mut device = host.open(name, Some(backend.clone())).unwrap();
    for (i, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let from = device.state().unwrap().0;
    assert_eq!(value(&mut device), 2);

    let mut sequences = Vec::new();
    let mut server_values = vec![2];
    for (write_id, delta) in [("decrement", -1), ("increment", 2)] {
        device.admit(Queued { upload: None,
            id: write_id.into(), seq: 0, op: "adjust".into(),
            args: serde_json::json!({"delta": delta}), new_ids: vec![],
            predicted: vec![], viewer: "dev:alice".into(), now: 1000,
            predictable: true, sent_seq: None, receipt_store: None, observed_seq: None, dispatch: None,
        }).unwrap();
        let result = engine.mutate("adjust", Some(write_id),
            context("dev:alice", &[("delta", Value::Int(delta))]).at(1000)).unwrap();
        let WriteState::Sent { seq, .. } = result.state else { panic!("write did not commit") };
        sequences.push(seq);
        if receive_write_responses {
            device.settle(write_id, Some(seq)).unwrap();
        }
        server_values.push(engine.query("counter", context("dev:alice", &[]).at(1000))
            .unwrap().data.field("n").unwrap().as_int().unwrap());
        assert_eq!(value(&mut device), *server_values.last().unwrap());
    }
    assert_eq!(server_values, [2, 1, 3]);
    assert_eq!(device.queued().unwrap().len(), 2);
    let pending: Vec<_> = device.queued().unwrap().into_iter().map(|q| q.id).collect();
    if !receive_write_responses {
        // Even today's declaration is complete in this variant: no cap and
        // no omitted sent_seq entries can explain the counterexample.
        assert_eq!(device.sync_state().unwrap().pending_ids, pending);
    }
    device.sync_state().unwrap();
    let stream = engine.stream("dev:alice", from, 1).unwrap();
    let images_at = *sequences.last().unwrap();
    assert_eq!(stream.watermark, sequences[0]);
    assert!(stream.more);
    assert!(stream.watermark < images_at);
    assert_eq!(stream.events.len(), 1);
    assert_eq!(stream.events[0].data.as_ref().unwrap().field("n").unwrap().as_int().unwrap(), 3);
    assert!(stream.acquisitions.is_empty() && stream.joined.is_empty());

    // The second bound uses the same existing _ops lookup as acknowledged.
    // This supplies exactly B2's answer without adding production machinery.
    let acknowledged = engine.acknowledged("dev:alice", &pending, stream.watermark).unwrap();
    let committed_above: BTreeMap<_, _> = engine.acknowledged("dev:alice", &pending, images_at)
        .unwrap().into_iter().filter(|(_, seq)| *seq > stream.watermark).collect();
    assert_eq!(acknowledged, BTreeMap::from([("decrement".into(), sequences[0])]));
    assert_eq!(committed_above, BTreeMap::from([("increment".into(), sequences[1])]));
    assert!(committed_above.values().all(|seq| stream.watermark < *seq && *seq <= images_at));
    let increment = device.queued().unwrap().into_iter().find(|q| q.id == "increment").unwrap();
    assert!(increment.predictable && !increment.viewer.is_empty());
    assert!(backend.programs.iter().any(|p| p.name == increment.op));
    assert!(!increment.sent_seq.is_some_and(|seq| seq <= stream.watermark));
    assert!(!increment.observed_seq.is_some_and(|seq| seq <= stream.watermark));

    let events = stream.events.iter().map(|e| serde_json::json!({
        "table": e.table, "kind": e.kind, "id": e.id,
        "data": e.data.as_ref().map(snapback4_core::wire::to_json),
    })).collect::<Vec<_>>();
    let page: StreamPage = serde_json::from_value(serde_json::json!({
        "snapshot": false, "events": events, "watermark": stream.watermark,
        "more": stream.more, "generation": engine.generation(),
        "acknowledged": acknowledged,"sent":acknowledged, "committed_above": committed_above, "images_at": images_at,
    })).unwrap();

    device.apply(&page, false).unwrap();
    assert_eq!(device.state().unwrap().0, from);
    assert_eq!(device.queued().unwrap().len(), 2);
    assert!(device.queued().unwrap().iter().all(|q| q.observed_seq.is_none()));
    assert_eq!(device.sync_state().unwrap().pending_ids, pending);
    assert_eq!(value(&mut device), 3);
    host.close(name, device);
    let mut reopened = host.open(name, None).unwrap();
    assert_eq!(value(&mut reopened), 3);
    assert_eq!(reopened.sync_state().unwrap().transfer_watermark, sequences[0]);
    assert_eq!(reopened.state().unwrap().0, from);
    assert_eq!(reopened.queued().unwrap().len(), 2);
    assert!(reopened.queued().unwrap().iter().all(|q| q.observed_seq.is_none()));
    let transfer = reopened.sync_state().unwrap().transfer_watermark;
    let mut covering = stream_page(&mut engine, "dev:alice", transfer);
    assert_eq!(covering.watermark, images_at);
    assert!(!covering.more);
    covering.acknowledged = engine.acknowledged("dev:alice", &pending, covering.watermark).unwrap();
    covering.sent = covering.acknowledged.clone();
    reopened.apply(&covering, false).unwrap();
    assert_eq!(value(&mut reopened), 3);
    assert!(reopened.queued().unwrap().iter().all(|q| q.observed_seq.is_some()));
    host.close(name, reopened);
}

#[test]
fn round2_partial_ack_counterexample_memory() {
    counterexample(&mut Memory::new(), false);
}

#[test]
fn round2_partial_ack_counterexample_sqlite() {
    counterexample(&mut Sqlite::new("repair-b-round2-ack"), false);
}

#[test]
fn round2_partial_retirement_counterexample_memory() {
    counterexample(&mut Memory::new(), true);
}

#[test]
fn round2_partial_retirement_counterexample_sqlite() {
    counterexample(&mut Sqlite::new("repair-b-round2-retirement"), true);
}
