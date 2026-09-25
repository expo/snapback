//! An admission's issued time belongs to its durable transaction, not its lifetime.
mod common;
use common::{Host, Memory, Sqlite, compile};
use snapback4_device::device::Queued;

const SOURCE: &str = "table stamps:\n  at: time default now\n  read <- allow\n  insert <- allow\n  sync public\nmutation stamp():\n  insert stamps {}\n";
fn entry(id: &str, now: i64) -> Queued {
    Queued { id: id.into(), seq: 0, op: "stamp".into(), args: serde_json::json!({}), new_ids: vec![], predicted: vec![],
        viewer: "alice".into(), now, predictable: false, sent_seq: None, receipt_store: None, observed_seq: None }
}
fn retirement<H: Host>(host: &mut H) {
    let (_, backend) = compile(SOURCE);
    let mut device = host.open("clock", Some(backend)).unwrap();
    device.admit(entry("a", 1_004_000)).unwrap();
    device.settle("a", None).unwrap();
    assert!(device.queued().unwrap().is_empty());
    // The Rust host performs no client clock flush on close: this retains only
    // the device's committed transactions, as a process restart would.
    host.close("clock", device);
    let mut device = host.open("clock", None).unwrap();
    assert_eq!(device.meta("server-clock-floor").unwrap().as_deref(), Some("1004000"));
    device.admit(entry("b", 1_000_000)).unwrap();
    assert_eq!(device.meta("server-clock-floor").unwrap().as_deref(), Some("1004000"));
}
#[test] fn settled_admission_floor_survives_memory_restart() { retirement(&mut Memory::new()); }
#[test] fn settled_admission_floor_survives_sqlite_restart() { retirement(&mut Sqlite::new("clock")); }

#[test]
fn admission_change_batch_contains_outbox_and_clock_floor_together() {
    let (_, backend) = compile(SOURCE);
    let mut device = Memory::new().open("clock", Some(backend)).unwrap();
    device.store().drain();
    device.admit(entry("a", 1_004_000)).unwrap();
    let committed = device.store().drain();
    assert!(committed.iter().any(|c| c.s == 'o' && c.k == "a" && c.v.is_some()));
    assert!(committed.iter().any(|c| c.s == 'm' && c.k == "client:server-clock-floor" && c.v.as_deref() == Some("1004000")));
    // Force an error after outbox insertion: rollback must publish neither half.
    device.set_meta("server-clock-floor", "malformed").unwrap();
    device.store().drain();
    assert!(device.admit(entry("b", 1_005_000)).is_err());
    assert!(device.store().drain().is_empty());
    assert_eq!(device.queued().unwrap().len(), 1);
}
