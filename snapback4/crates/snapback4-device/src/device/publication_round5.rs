//! Isolate storage-only cases without inventing an alternate transport.
use super::*;
use crate::memory::MemoryStore;
fn both(test: impl Fn(MemoryStore), native: impl Fn(snapback4_core::store::Store)) {
    test(MemoryStore::new());
    publication_tests::with_sqlite(native);
}
fn live_cursor<S: DeviceStore>(store: S) {
    let mut d = Device::open_store(store, Some(Backend { generation: 1, schema: Schema::default(), programs: vec![] })).unwrap();
    d.snapshot_owner = Some("owner".into());
    let tx = d.store.transaction().unwrap();
    tx.set_meta(SNAPSHOT_OWNER, "owner").unwrap();
    tx.set_meta(SNAPSHOT_NEXT, "").unwrap();
    tx.set_meta(SNAPSHOT_THROUGH, "100").unwrap();
    tx.set_meta(deferred::CURSOR, "150").unwrap();
    tx.commit().unwrap();
    assert_eq!(d.sync_state().unwrap().transfer_watermark, 150, "live progress wins over a terminal snapshot cut");
}
#[test] fn live_cursor_precedes_terminal_snapshot_cut() { both(live_cursor, live_cursor); }

fn terminal_guard<S: DeviceStore>(store: S) {
    let mut d = Device::open_store(store, Some(Backend { generation: 1, schema: Schema::default(), programs: vec![] })).unwrap();
    for snapshot in [false, true] {
        let mut p: StreamPage = decoded(r#"{"snapshot":true,"watermark":1,"images_at":2,"more":false,"committed_above":{"q":2},"events":[]}"#).unwrap();
        p.snapshot = snapshot;
        assert!(d.apply_publication(&p, true).unwrap_err().to_string().contains("terminal stream page"));
        assert_eq!(d.state().unwrap().0, 0);
        assert!(!d.publication_pending().unwrap());
    }
}
#[test] fn terminal_gap_is_a_protocol_refusal() { both(terminal_guard, terminal_guard); }

fn missing_declaration<S: DeviceStore>(store: S) {
    let mut d = Device::open_store(store, Some(Backend { generation: 1, schema: Schema::default(), programs: vec![] })).unwrap();
    let tx = d.store.transaction().unwrap();
    tx.set_meta("device:declaration:published", "[100,150]").unwrap();
    tx.commit().unwrap();
    let p: StreamPage = decoded(r#"{"snapshot":false,"watermark":10,"more":false,"events":[]}"#).unwrap();
    assert!(d.apply_publication(&p, false).unwrap().1);
    let tx = d.store.transaction().unwrap();
    assert_eq!(predictions::replay_limit(&tx).unwrap(), (100, 150), "legacy pages cannot erase the published exclusion band");
    tx.rollback().unwrap();
}
#[test] fn absent_capture_and_echo_preserve_published_exclusion() { both(missing_declaration, missing_declaration); }

fn corrupt_capture<S: DeviceStore>(mut store: S) {
    let tx = store.transaction().unwrap();
    let q: Queued = decoded(r#"{"id":"q","seq":1,"op":"bump","args":{},"viewer":"alice","now":0}"#).unwrap();
    predictions::enqueue(&tx, &q).unwrap();
    for capture in [
        serde_json::json!({"ids":std::iter::once("q".to_owned()).chain((0..256).map(|i|format!("q{i}"))).collect::<Vec<_>>(),"declaration":[257,true,257]}),
        serde_json::json!({"ids":[],"declaration":[1,true,1]}),
        serde_json::json!({"ids":["q"],"declaration":[0,false,1]}),
        serde_json::json!({"ids":["q","q"],"declaration":[1,true,1]}),
    ] {
        tx.set_meta("device:declaration:capture", &capture.to_string()).unwrap();
        assert!(predictions::capture(&tx).is_err(), "invalid capture was accepted: {capture}");
    }
    tx.rollback().unwrap();
}
#[test] fn stored_capture_must_be_a_bounded_prefix() { both(corrupt_capture, corrupt_capture); }
