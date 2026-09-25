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

fn legacy_retirement<H: Host>(host: &mut H) {
    for (n, saved) in [None, Some(1_002_000), Some(1_008_000)].into_iter().enumerate() {
        let name = format!("legacy-{n}");
        let (_, backend) = compile(SOURCE);
        let mut device = host.open(&name, Some(backend)).unwrap();
        if let Some(floor) = saved { device.set_meta("server-clock-floor", &floor.to_string()).unwrap(); }
        // 0.4.1 wrote these durable entries without writing a clock floor.
        for (n, now) in [1_004_000, 1_001_000, 1_003_000].into_iter().enumerate() {
            let mut queued = entry(&format!("a{n}"), now);
            queued.seq = n as u64 + 1;
            device.enqueue(&queued).unwrap();
        }
        host.close(&name, device);
        let mut device = host.open(&name, None).unwrap();
        assert_eq!(device.meta("server-clock-floor").unwrap(), saved.map(|floor| floor.to_string()));
        let entries = device.queued_with_clock_floor(true).unwrap();
        let expected = saved.unwrap_or(0).max(1_004_000).to_string();
        assert_eq!(device.meta("server-clock-floor").unwrap().as_deref(), Some(expected.as_str()));
        for queued in entries { device.settle(&queued.id, None).unwrap(); }
        assert!(device.queued().unwrap().is_empty());
        host.close(&name, device);
        let device = host.open(&name, None).unwrap();
        assert_eq!(device.meta("server-clock-floor").unwrap().as_deref(), Some(expected.as_str()));
        host.close(&name, device);
    }
}
#[test] fn legacy_admission_floor_survives_retirement_memory() { legacy_retirement(&mut Memory::new()); }
#[test] fn legacy_admission_floor_survives_retirement_sqlite() { legacy_retirement(&mut Sqlite::new("legacy-clock")); }

#[test]
fn legacy_floor_backfill_is_idempotent_and_failure_keeps_the_queue() {
    let (_, backend) = compile(SOURCE);
    let mut device = Memory::new().open("clock", Some(backend)).unwrap();
    device.enqueue(&entry("legacy", 1_004_000)).unwrap();
    device.set_meta("server-clock-floor", "malformed").unwrap();
    device.store().drain();
    assert!(device.queued_with_clock_floor(true).is_err());
    assert!(device.store().drain().is_empty());
    assert_eq!(device.queued().unwrap().len(), 1);
    device.set_meta("server-clock-floor", "0").unwrap();
    device.store().drain();
    device.queued_with_clock_floor(true).unwrap();
    let committed = device.store().drain();
    assert_eq!(committed.len(), 1);
    assert_eq!((committed[0].s, committed[0].k.as_str(), committed[0].v.as_deref()),
        ('m', "client:server-clock-floor", Some("1004000")));
    device.queued_with_clock_floor(true).unwrap();
    assert!(device.store().drain().is_empty(), "attachment does not rewrite an unchanged floor");
}

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
