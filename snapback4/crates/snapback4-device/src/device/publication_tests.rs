//! Storage contracts beneath the end-to-end lifecycle probes.
use super::*;
use crate::memory::MemoryStore;
use std::cell::Cell;
use std::rc::Rc;

fn cursor_and_recording<S: DeviceStore>(store: S) {
    let backend = Backend { generation: 1, schema: Schema::default(), programs: vec![] };
    let mut device = Device::open_store(store, Some(backend)).unwrap();
    let tx = device.store.transaction().unwrap();
    tx.set_meta(deferred::CURSOR, "").unwrap();
    assert_eq!(deferred::cursor(&tx).unwrap(), None, "empty means no transfer");
    tx.commit().unwrap();
    assert!(!device.publication_pending().unwrap());
    let tx = device.store.transaction().unwrap();
    tx.set_meta("device:deferred:rows:held", "payload").unwrap();
    tx.set_meta("device:declaration:first-capture", "[9,true,9]").unwrap();
    tx.set_meta("device:declaration:capture", "obsolete").unwrap();
    tx.set_meta("device:declaration:published", "[1,9]").unwrap();
    tx.set_meta(SNAPSHOT_THROUGH, "88").unwrap();
    reset_publication(&tx, false).unwrap();
    assert!(tx.meta_prefix("device:deferred:").unwrap().is_empty());
    assert!(tx.meta_prefix("device:declaration:").unwrap().is_empty());
    assert!(tx.meta(SNAPSHOT_THROUGH).unwrap().is_none());
    tx.commit().unwrap();
}

#[test]
fn empty_cursor_and_reset_remove_all_publication_keys() {
    cursor_and_recording(MemoryStore::new());
    #[cfg(feature = "native")]
    with_sqlite(cursor_and_recording);
}

// A dispatcher must not issue a new fallible store read after apply committed.
struct RejectMetadataReads<S> { store: S, reject: Rc<Cell<bool>> }
impl<S: DeviceStore> DeviceStore for RejectMetadataReads<S> {
    type Tx<'a> = S::Tx<'a> where Self: 'a;
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> { self.store.install(schema, metadata, reset) }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        if self.reject.get() { Err(RuntimeError::Store("post-commit metadata read refused".into())) } else { self.store.meta(key) }
    }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> { self.store.set_meta(key, value) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> { self.store.transaction() }
}
fn publication_result<S: DeviceStore>(store: S) {
    let reject = Rc::new(Cell::new(false));
    let backend = Backend { generation: 1, schema: Schema::default(), programs: vec![] };
    let mut device = Device::open_store(RejectMetadataReads { store, reject: reject.clone() }, Some(backend)).unwrap();
    reject.set(true);
    let response = crate::call::call(&mut device, serde_json::json!({"op":"apply", "first":true,
        "page":{"snapshot":true,"stage_snapshot":true,"watermark":1,"more":false,"events":[]}}));
    assert_eq!(response["ok"]["published"], false, "{response}");
    let response = crate::call::call(&mut device, serde_json::json!({"op":"apply", "first":false,
        "page":{"snapshot":false,"snapshot_catchup":true,"watermark":1,"images_at":1,"more":false,"events":[]}}));
    assert_eq!(response["ok"]["published"], true, "{response}");
}
#[test]
fn apply_returns_publication_without_a_second_store_read() {
    publication_result(MemoryStore::new());
    #[cfg(feature = "native")]
    with_sqlite(publication_result);
}

#[cfg(feature = "native")]
pub(super) fn with_sqlite(test: impl FnOnce(snapback4_core::store::Store)) {
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let directory = std::env::temp_dir().join(format!("sb4-publication-{}-{nonce}", std::process::id()));
    std::fs::create_dir(&directory).unwrap();
    test(crate::sqlite::open(&directory.join("device.sqlite")).unwrap());
    std::fs::remove_dir_all(directory).unwrap();
}

fn checkpoint_capture<S: DeviceStore>(mut store: S) {
    let tx = store.transaction().unwrap();
    tx.set_meta("device:declaration:capture", "[10,true,10]").unwrap();
    let page: StreamPage = decoded(r#"{"snapshot":false,"watermark":0,"more":false,"events":[]}"#).unwrap();
    assert_eq!(predictions::declaration(&tx, &page).unwrap(), (10, true, 10));
    assert_eq!(predictions::capture(&tx).unwrap().declaration, (10, true, 10));
    tx.rollback().unwrap();
}
#[test]
fn checkpoint_capture_remains_readable_without_widening() {
    checkpoint_capture(MemoryStore::new());
    #[cfg(feature = "native")]
    with_sqlite(checkpoint_capture);
}

fn unordered_capture<S: DeviceStore>(mut store: S) {
    let tx = store.transaction().unwrap();
    // Adversarial adapter order: payload sequence is opposite its storage key.
    for seq in 1..=257 {
        let q: Queued = decoded(&format!(r#"{{"id":"q{seq}","seq":{seq},"op":"bump","args":{{}},"viewer":"alice","now":0}}"#)).unwrap();
        tx.outbox_upsert(258-seq, &q.id, &encoded(&q).unwrap()).unwrap();
    }
    let capture = predictions::capture(&tx).unwrap();
    assert_eq!(capture.declaration, (256, false, 257));
    assert_eq!(capture.ids, (1..=256).map(|seq| format!("q{seq}")).collect::<Vec<_>>());
    predictions::clear_capture(&tx).unwrap();
    tx.set_meta("device:declaration:capture", "[256,false,257]").unwrap();
    assert_eq!(predictions::capture(&tx).unwrap().ids, capture.ids, "checkpoint recovery is the same prefix");
    tx.set_meta("device:declaration:capture", "[257,false,257]").unwrap();
    assert!(predictions::capture(&tx).err().unwrap().to_string().contains("prefix limit"), "never truncate an inconsistent checkpoint into a different declared set");
    tx.rollback().unwrap();
}
mod capture_orders_its_declared_prefix_and_checkpoint_recovery {
    use super::*;
    #[test] fn memory() { unordered_capture(MemoryStore::new()); }
    #[cfg(feature = "native")]
    #[test] fn sqlite() { with_sqlite(unordered_capture); }
}

fn capture_echo<S: DeviceStore>(mut store: S) {
    let tx = store.transaction().unwrap();
    tx.set_meta("device:declaration:capture", r#"{"ids":["q"],"declaration":[1,false,9]}"#).unwrap();
    let mut page: StreamPage = decoded(r#"{"snapshot":false,"watermark":0,"more":false,"events":[],"pending_through":1,"pending_complete":false,"pending_bound":1}"#).unwrap();
    assert!(predictions::declaration(&tx, &page).unwrap_err().to_string().contains("echo differs"));
    page.pending_bound = None;
    assert_eq!(predictions::declaration(&tx, &page).unwrap(), (1, false, 9));
    page.pending_bound = Some(9);
    assert_eq!(predictions::declaration(&tx, &page).unwrap(), (1, false, 9));
    tx.rollback().unwrap();
}
mod echoed_bound_cannot_widen_the_captured_declaration {
    use super::*;
    #[test] fn memory() { capture_echo(MemoryStore::new()); }
    #[cfg(feature = "native")]
    #[test] fn sqlite() { with_sqlite(capture_echo); }
}
