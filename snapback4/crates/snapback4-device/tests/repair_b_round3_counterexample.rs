//! Regression: the capped declaration must not replay its undeclared suffix.
mod common;
use common::*;
use snapback4_core::engine::{Engine, WriteState};
use snapback4_core::value::{Value, object};
use snapback4_device::device::{Device, Queued, StreamPage};
use snapback4_device::store::DeviceStore;

const SOURCE: &str = r#"
use personas alice
table counters:
  n: int
  read <- allow
  update <- allow
  sync public
query counter(counterId: counters):
  return counters[counterId]
mutation bump(counterId: counters):
  c = counters[counterId] ! else NOT_FOUND
  update counters[counterId] {n: c.n + 1}
"#;

fn value<S: DeviceStore>(device: &mut Device<S>, row: &str) -> i64 {
    device.query("counter", "dev:alice", &serde_json::json!({"counterId": row}), 1000)
        .unwrap().data.field("n").unwrap().as_int().unwrap()
}

fn page(engine: &mut Engine, from: u64, limit: usize) -> StreamPage {
    let stream = engine.stream("dev:alice", from, limit).unwrap();
    serde_json::from_value(serde_json::json!({
        "snapshot": false, "images_at": stream.images_at, "watermark": stream.watermark, "more": stream.more,
        "generation": engine.generation(), "joined": stream.joined,
        "acquisitions": stream.acquisitions,
        "events": stream.events.iter().map(|event| serde_json::json!({
            "table": event.table, "kind": event.kind, "id": event.id,
            "data": event.data.as_ref().map(snapback4_core::wire::to_json),
        })).collect::<Vec<_>>(),
    })).unwrap()
}

fn probe<H: Host>(host: &mut H, write_count: usize, first_deferred: bool) {
    let name = "round3-capped-acknowledgements";
    let (mut engine, backend) = compile(SOURCE);
    engine.seed([
        ("counters".into(), object([("id", id("a")), ("n", Value::Int(1))])),
        ("counters".into(), object([("id", id("filler")), ("n", Value::Int(0))])),
    ]).unwrap();
    let mut device = host.open(name, Some(backend)).unwrap();
    for (index, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() {
        device.apply(page, index == 0).unwrap();
    }
    let published = device.state().unwrap().0;
    let mut images_at = published;
    for index in 0..write_count {
        let row = if index + 1 == write_count { "a" } else { "filler" };
        let write_id = format!("write-{index:03}");
        device.admit(Queued {
            id: write_id.clone(), seq: 0, op: "bump".into(),
            args: serde_json::json!({"counterId": row}), new_ids: vec![],
            predicted: vec![], viewer: "dev:alice".into(), now: 1000,
            predictable: true, sent_seq: None, receipt_store: None, observed_seq: None,
        }).unwrap();
        device.begin_send().unwrap();
        let result = engine.mutate("bump", Some(&write_id),
            context("dev:alice", &[("counterId", id(row))]).at(1000)).unwrap();
        let WriteState::Sent { seq, .. } = result.state else { panic!("write did not commit") };
        images_at = seq;
        // Mutation responses are unavailable. Sync must correlate their IDs.
        // This is a Device protocol probe, not a client scheduling witness.
    }
    assert_eq!(value(&mut device, "a"), 2);
    assert_eq!(engine.query("counter", context("dev:alice", &[("counterId", id("a"))]))
        .unwrap().data.field("n").unwrap().as_int().unwrap(), 2);
    let capture = device.sync_state().unwrap();
    let entries = device.queued().unwrap();
    assert!(entries.iter().all(|entry| entry.predictable
        && entry.sent_seq.is_none() && entry.observed_seq.is_none()));
    assert_eq!(entries.len(), write_count);
    assert_eq!(capture.pending_ids.len(), 256);
    let complete = capture.pending_ids.len() == entries.len();
    assert_eq!(complete, write_count == 256);
    if !complete {
        let all_ids: Vec<_> = entries.iter().map(|entry| entry.id.clone()).collect();
        let error = engine.acknowledged("dev:alice", &all_ids, images_at).unwrap_err();
        assert!(error.to_string().contains("at most 256 pending ids"));
    }
    let last_id = entries.last().unwrap().id.clone();
    assert_eq!(capture.pending_ids.contains(&last_id), complete);

    let mut transfer = published;
    if first_deferred {
        let mut first = page(&mut engine, transfer, 1);
        assert!(first.more && first.watermark < images_at);
        (first.acknowledged, first.committed_above) = engine.acknowledged_at("dev:alice", &capture.pending_ids, first.watermark, images_at).unwrap();
        device.apply(&first, false).unwrap();
        transfer = first.watermark;
        assert_eq!(device.state().unwrap().0, published);
        assert_eq!(device.queued().unwrap(), entries);
        assert_eq!(device.sync_state().unwrap().pending_ids, capture.pending_ids);
        assert_eq!(value(&mut device, "a"), 2);
    }
    let mut terminal = page(&mut engine, transfer, 1_000);
    assert!(!terminal.more);
    assert_eq!(terminal.watermark, images_at);
    (terminal.acknowledged, terminal.committed_above) = engine.acknowledged_at("dev:alice", &capture.pending_ids, terminal.watermark, images_at).unwrap();
    assert!(terminal.committed_above.is_empty());
    assert_eq!(terminal.acknowledged.len(), 256);
    terminal.send_revision = Some(capture.send_revision);
    terminal.requested_watermark = Some(transfer);
    terminal.captured_watermark = Some(published);
    device.apply(&terminal, false).unwrap();

    let expected = 2;
    assert_eq!(device.state().unwrap().0, images_at);
    assert_eq!(value(&mut device, "a"), expected,
        "the undeclared write replays over its own effect, even at more:false");
    let last = device.queued().unwrap().into_iter().find(|entry| entry.id == last_id).unwrap();
    assert_eq!(last.observed_seq, complete.then_some(images_at));
    host.close(name, device);
    let mut reopened = host.open(name, None).unwrap();
    assert_eq!(value(&mut reopened, "a"), expected);
    assert_eq!(reopened.state().unwrap().0, images_at);
    println!("{} writes={write_count} first_deferred={first_deferred}: declared=256, acknowledged=256, terminal more=false watermark=images_at={images_at}, committed_above=0, server a=2, published a={expected}, reopened a={expected}", host.label());
    host.close(name, reopened);
}

#[test]
fn round3_capped_terminal_memory() { probe(&mut Memory::new(), 257, false); }
#[test]
fn round3_capped_terminal_sqlite() { probe(&mut Sqlite::new("round3-terminal"), 257, false); }
#[test]
fn round3_capped_deferred_then_terminal_memory() { probe(&mut Memory::new(), 257, true); }
#[test]
fn round3_capped_deferred_then_terminal_sqlite() { probe(&mut Sqlite::new("round3-deferred"), 257, true); }
#[test]
fn round3_complete_declaration_control_memory() { probe(&mut Memory::new(), 256, true); }
#[test]
fn round3_complete_declaration_control_sqlite() { probe(&mut Sqlite::new("round3-complete"), 256, true); }
