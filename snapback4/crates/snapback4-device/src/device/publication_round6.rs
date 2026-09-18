//! The public partition reset must reach every private durable key.
use super::*;

fn clear_rows_lifetime<S: DeviceStore>(store: S) {
    let mut d = Device::open_store(store, Some(Backend { generation: 1, schema: Schema::default(), programs: vec![] })).unwrap();
    d.snapshot_owner = Some("owner".into());
    let tx = d.store.transaction().unwrap();
    for key in SNAPSHOT_KEYS { tx.set_meta(key, "88").unwrap(); }
    tx.set_meta(SNAPSHOT_OWNER, "owner").unwrap();
    tx.set_meta(SNAPSHOT_NEXT, "").unwrap();
    tx.set_meta(SNAPSHOT_OWNERS, "17").unwrap();
    tx.set_meta(WATERMARK, "80").unwrap();
    tx.set_meta(ACQUIRED, "1").unwrap();
    for key in [history::GROUPS, boundary::BOUNDARIES, boundary::REPORT] { tx.set_meta(key, "{}").unwrap(); }
    tx.set_meta(deferred::CURSOR, "99").unwrap();
    tx.set_meta(deferred::ACKS, "{}").unwrap();
    tx.set_meta("device:deferred:rows:row", "payload").unwrap();
    tx.set_meta("device:deferred:meta:key", "payload").unwrap();
    tx.set_meta(deferred::IDENTITY, "S").unwrap();
    tx.set_meta("device:declaration:capture", "obsolete").unwrap();
    tx.set_meta("device:declaration:first-capture", "obsolete").unwrap();
    tx.set_meta("device:declaration:published", "[1,9]").unwrap();
    tx.staged_put("row", "table", "payload").unwrap();
    tx.base_remember("table", "row", None).unwrap();
    tx.commit().unwrap();
    d.clear_rows().unwrap();
    assert!(d.snapshot_owner.is_none());
    let tx = d.store.transaction().unwrap();
    for key in SNAPSHOT_KEYS { assert!(tx.meta(key).unwrap().is_none(), "{key} survived clear_rows"); }
    assert_eq!(tx.meta(SNAPSHOT_OWNERS).unwrap().as_deref(), Some("17"), "owner allocator must never reset");
    assert_eq!(tx.meta_prefix(deferred::PREFIX).unwrap(), vec![(deferred::IDENTITY.into(), "S".into())]);
    assert!(tx.meta_prefix("device:declaration:").unwrap().is_empty());
    for key in [ACQUIRED, history::GROUPS, boundary::BOUNDARIES, boundary::REPORT] { assert!(tx.meta(key).unwrap().is_none(), "{key}"); }
    assert!(tx.staged_after("", 1).unwrap().is_empty());
    assert!(tx.base_entries().unwrap().is_empty());
    tx.rollback().unwrap();
    let mut d = Device::open_store(d.store, None).unwrap();
    let state = d.sync_state_read().unwrap();
    assert_eq!((state.watermark, state.transfer_watermark), (0, 0));
    assert!(!state.snapshot_catchup && !state.acquired);
    assert_eq!(state.transfer_store_id.as_deref(), Some("S"));
    assert!(!d.publication_pending().unwrap());
}
#[test] fn clear_rows_consumes_all_private_progress_and_keeps_incarnation() {
    clear_rows_lifetime(crate::memory::MemoryStore::new());
    publication_tests::with_sqlite(clear_rows_lifetime);
}
