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
    assert_eq!(deferred::cursor(&tx).unwrap(), None, "empty cursor remains absent after commit");
    tx.set_meta(deferred::CURSOR, "77").unwrap();
    tx.set_meta("device:deferred:rows:held", "payload").unwrap();
    tx.set_meta("device:deferred:meta:device:held", "payload").unwrap();
    tx.set_meta(deferred::ACKS, r#"{"q":77}"#).unwrap();
    tx.set_meta(deferred::IDENTITY, "private").unwrap();
    tx.set_meta("device:declaration:first-capture", "[9,true,9]").unwrap();
    tx.set_meta("device:declaration:capture", "obsolete").unwrap();
    tx.set_meta("device:declaration:published", "[1,9]").unwrap();
    for key in SNAPSHOT_KEYS { tx.set_meta(key, "88").unwrap(); }
    tx.staged_put("row", "table", "payload").unwrap();
    tx.commit().unwrap();
    let tx = device.store.transaction().unwrap();
    assert_eq!(deferred::cursor(&tx).unwrap(), Some(77));
    reset_publication(&tx, false).unwrap();
    assert!(tx.meta_prefix("device:deferred:").unwrap().is_empty());
    assert!(tx.meta_prefix("device:declaration:").unwrap().is_empty());
    for key in SNAPSHOT_KEYS { assert!(tx.meta(key).unwrap().is_none(), "{key}"); }
    assert!(tx.staged_after("", 1).unwrap().is_empty());
    tx.commit().unwrap();
    let tx = device.store.transaction().unwrap();
    assert!(tx.meta_prefix("device:deferred:").unwrap().is_empty());
    assert!(tx.meta_prefix("device:declaration:").unwrap().is_empty());
    for key in SNAPSHOT_KEYS { assert!(tx.meta(key).unwrap().is_none(), "{key}"); }
    assert!(tx.staged_after("", 1).unwrap().is_empty());
    tx.rollback().unwrap();
}

#[test]
fn empty_cursor_and_reset_remove_all_publication_keys() {
    cursor_and_recording(MemoryStore::new());
    #[cfg(feature = "native")]
    with_sqlite(cursor_and_recording);
}

// A dispatcher must not issue a new fallible store read after apply committed.
struct RejectMetadataReads<S> { store: S, reject: Rc<Cell<bool>>, transactions: Rc<Cell<usize>> }
impl<S: DeviceStore> DeviceStore for RejectMetadataReads<S> {
    type Tx<'a> = S::Tx<'a> where Self: 'a;
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> { self.store.install(schema, metadata, reset) }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        if self.reject.get() { Err(RuntimeError::Store("post-commit metadata read refused".into())) } else { self.store.meta(key) }
    }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> { self.store.set_meta(key, value) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> {
        self.transactions.set(self.transactions.get() + 1);
        self.store.transaction()
    }
}
fn publication_result<S: DeviceStore>(store: S) {
    let reject = Rc::new(Cell::new(false));
    let transactions = Rc::new(Cell::new(0));
    let backend = Backend { generation: 1, schema: Schema::default(), programs: vec![] };
    let mut device = Device::open_store(RejectMetadataReads { store, reject: reject.clone(), transactions: transactions.clone() }, Some(backend)).unwrap();
    reject.set(true);
    let before = transactions.get();
    let response = crate::call::call(&mut device, serde_json::json!({"op":"apply", "first":true,
        "page":{"snapshot":true,"stage_snapshot":true,"watermark":1,"more":false,"events":[]}}));
    assert_eq!(response["ok"]["published"], false, "{response}");
    assert_eq!(transactions.get(), before + 1, "apply may not reopen a transaction after commit");
    let response = crate::call::call(&mut device, serde_json::json!({"op":"apply", "first":false,
        "page":{"snapshot":false,"snapshot_catchup":true,"requested_watermark":1,"watermark":1,"images_at":1,"more":false,"events":[]}}));
    assert_eq!(response["ok"]["published"], true, "{response}");
    assert_eq!(transactions.get(), before + 2, "each apply supplies its result from its own transaction");
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
    let mut page: StreamPage = decoded(r#"{"snapshot":false,"watermark":0,"more":false,"events":[]}"#).unwrap();
    assert_eq!(predictions::declaration(&tx, &page).unwrap(), (10, true, 10));
    assert_eq!(predictions::capture(&tx).unwrap().declaration, (10, true, 10));
    page.pending_through = Some(11); page.pending_complete = Some(true); page.pending_bound = Some(11);
    assert!(predictions::declaration(&tx, &page).unwrap_err().to_string().contains("echo differs"));
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
        let q: Queued = decoded(&format!(r#"{{"id":"q{seq}","seq":{},"op":"bump","args":{{}},"viewer":"alice","now":0}}"#, 100 + seq * 10)).unwrap();
        tx.outbox_upsert(258-seq, &q.id, &encoded(&q).unwrap()).unwrap();
    }
    let before = tx.outbox_entries().unwrap();
    let capture = predictions::capture(&tx).unwrap();
    assert_eq!(tx.outbox_entries().unwrap(), before, "capturing the prefix preserves all 257 writes");
    assert_eq!(capture.declaration, (2660, false, 2670));
    assert_eq!(capture.ids, (1..=256).map(|seq| format!("q{seq}")).collect::<Vec<_>>());
    predictions::clear_capture(&tx).unwrap();
    tx.set_meta("device:declaration:capture", "[2660,false,2670]").unwrap();
    assert_eq!(predictions::capture(&tx).unwrap().ids, capture.ids, "checkpoint recovery is the same prefix");
    assert_eq!(tx.outbox_entries().unwrap(), before, "checkpoint recovery preserves the overflow write");
    tx.set_meta("device:declaration:capture", "[2670,false,2670]").unwrap();
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
    for (through, complete, bound) in [(1, false, 10), (2, false, 9), (1, true, 9)] {
        page.pending_through = Some(through); page.pending_complete = Some(complete); page.pending_bound = Some(bound);
        assert!(predictions::declaration(&tx, &page).unwrap_err().to_string().contains("echo differs"));
    }
    tx.rollback().unwrap();
}
mod echoed_bound_cannot_widen_the_captured_declaration {
    use super::*;
    #[test] fn memory() { capture_echo(MemoryStore::new()); }
    #[cfg(feature = "native")]
    #[test] fn sqlite() { with_sqlite(capture_echo); }
}

fn slot_occupancy<S: DeviceStore>(store: S) {
    let backend = Backend { generation: 1, schema: Schema::default(), programs: vec![] };
    let mut device = Device::open_store(store, Some(backend)).unwrap();
    device.store.set_meta(deferred::CURSOR, "12").unwrap();
    assert!(!device.publication_pending().unwrap(), "request position alone is not private effects");
    let tx = device.store.transaction().unwrap();
    tx.delete_meta(&[deferred::CURSOR]).unwrap();
    // stage writes ACKS even for a metadata-only or receipt-free bundle.
    tx.set_meta(deferred::ACKS, "{}").unwrap();
    tx.commit().unwrap();
    assert!(device.publication_pending().unwrap(), "a slot does not depend on its cursor");
    device.store.set_meta(deferred::CURSOR, "12").unwrap();
    assert!(device.publication_pending().unwrap(), "the committed slot remains pending with its cursor");
    let page = decoded(r#"{"snapshot":false,"requested_watermark":12,"watermark":12,"images_at":12,"more":true,"events":[]}"#).unwrap();
    assert!(device.apply_publication(&page, false).unwrap().1);
    assert!(!device.publication_pending().unwrap(), "published nonterminal pages have no private effects");
    let page = decoded(r#"{"snapshot":false,"watermark":13,"images_at":13,"more":false,"events":[]}"#).unwrap();
    assert!(device.apply_publication(&page, false).unwrap().1);
    assert!(!device.publication_pending().unwrap(), "terminal publication stays empty");
}
#[test]
fn pending_publication_reads_the_slot_not_request_progress() {
    slot_occupancy(MemoryStore::new());
    #[cfg(feature = "native")]
    with_sqlite(slot_occupancy);
}

// @ref LLP 3000.019#3.5 — an owned continuation's pinned cut is not a fresh head, even when terminal.
fn leased_continuation<S: DeviceStore>(store: S, terminal: bool, publish_peer: impl FnOnce(&mut Device<S>, &StreamPage)) -> Device<S> {
    let backend = Backend { generation: 1, schema: Schema::default(), programs: vec![] };
    let mut a = Device::open_store(store, Some(backend)).unwrap();
    let initial = decoded(r#"{"snapshot":true,"store_id":"shared-store","watermark":0,"more":false,"events":[]}"#).unwrap();
    a.apply(&initial, true).unwrap();
    let first = decoded(r#"{"snapshot":true,"store_id":"shared-store","watermark":8,"more":true,"next":"a-next","events":[]}"#).unwrap();
    assert!(!a.apply_publication(&first, true).unwrap().1);
    let owner = a.store.meta(SNAPSHOT_OWNER).unwrap();
    assert!(owner.is_some());
    assert_eq!(a.snapshot_owner, owner);
    let stream = decoded(r#"{"snapshot":false,"store_id":"shared-store","requested_watermark":0,"watermark":20,"more":false,"events":[]}"#).unwrap();
    publish_peer(&mut a, &stream);
    assert_eq!(a.snapshot_owner, owner, "A stays open throughout B's publication");
    assert_eq!(a.store.meta(SNAPSHOT_OWNER).unwrap(), owner, "ordinary stream publication keeps A's lease");
    assert_eq!(a.store.meta(SNAPSHOT_NEXT).unwrap().as_deref(), Some("a-next"));
    assert_eq!(a.store.meta(SNAPSHOT_WATERMARK).unwrap().as_deref(), Some("8"));
    let capture = a.sync_state().unwrap();
    assert_eq!(capture.watermark, 20);
    assert!(capture.restore_refusal.is_none());
    let continuation: StreamPage = decoded(&serde_json::json!({
        "snapshot":true, "store_id":"shared-store", "after":"a-next", "watermark":8,
        "more":!terminal, "next":if terminal { None } else { Some("a-later") }, "events":[],
        "requested_watermark":0, "captured_watermark":capture.watermark,
        "captured_restore_watermark":capture.restore_watermark,
        "captured_restore_images_at":capture.restore_images_at, "send_revision":capture.send_revision
    }).to_string()).unwrap();
    assert!(continuation.images_at.is_none());
    let observation = a.observe_store(&continuation).unwrap();
    assert!(!observation.reset);
    assert!(!observation.backend_required);
    assert!(a.sync_state_read().unwrap().restore_refusal.is_none(), "observation must not persist a restore halt");
    let error = a.apply(&continuation, false).unwrap_err();
    assert_eq!(error.refusal().code, "E_GENERATION");
    assert!(error.to_string().contains("device watermark would move backwards"), "the continuation passes the lease and head checks: {error}");
    let state = a.sync_state_read().unwrap();
    assert_eq!(state.watermark, 20);
    assert!(state.restore_refusal.is_none(), "application must not persist a restore halt");
    a
}

fn reopened_continuation<S: DeviceStore>(mut reopened: Device<S>) {
    let state = reopened.sync_state_read().unwrap();
    assert_eq!(state.watermark, 20);
    assert!(state.acquired);
    assert!(state.restore_refusal.is_none(), "no restore halt after reopen");
}

fn leased_continuation_memory(terminal: bool) {
    let a = leased_continuation(MemoryStore::new(), terminal, |a, stream| {
        // Transfer the same memory store between calls, keeping A's interpreter
        // and snapshot lease alive; no fixture writes to snapshot metadata.
        let mut b = Device::open_store(std::mem::take(&mut a.store), None).unwrap();
        assert!(b.apply_publication(stream, false).unwrap().1);
        a.store = b.store;
    });
    let mut persisted = MemoryStore::new();
    persisted.load(a.store.export()).unwrap();
    drop(a);
    reopened_continuation(Device::open_store(persisted, None).unwrap());
}

#[cfg(feature = "native")]
fn leased_continuation_sqlite(terminal: bool) {
    with_sqlite(|store| {
        let path = std::path::PathBuf::from(store.conn().path().unwrap());
        let a = leased_continuation(store, terminal, |_, stream| {
            let mut b = Device::open(&path, None).unwrap();
            assert!(b.apply_publication(stream, false).unwrap().1);
        });
        drop(a);
        reopened_continuation(Device::open(&path, None).unwrap());
    });
}

#[test]
fn leased_terminal_continuation_memory() { leased_continuation_memory(true); }
#[test]
fn leased_nonterminal_continuation_memory() { leased_continuation_memory(false); }
#[cfg(feature = "native")]
#[test]
fn leased_terminal_continuation_sqlite() { leased_continuation_sqlite(true); }
#[cfg(feature = "native")]
#[test]
fn leased_nonterminal_continuation_sqlite() { leased_continuation_sqlite(false); }
