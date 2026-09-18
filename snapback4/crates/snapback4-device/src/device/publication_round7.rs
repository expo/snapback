use super::*;
use std::cell::Cell;
use std::rc::Rc;

fn capture_lifetimes<S: DeviceStore>(mut store: S) {
    let tx = store.transaction().unwrap();
    tx.set_meta("device:declaration:capture", r#"{"ids":[],"declaration":[0,true,0],"send_revision":1}"#).unwrap();
    tx.set_meta(SEND_REVISION, "2").unwrap();
    tx.set_meta("device:declaration:published", "[1,9]").unwrap();
    let mut page: StreamPage = decoded(r#"{"snapshot":false,"watermark":10,"more":false,"events":[]}"#).unwrap();
    for revision in [None, Some(2)] {
        page.send_revision = revision;
        assert_eq!(predictions::declaration(&tx, &page).unwrap(), (1, false, 9), "an un-echoed page cannot inherit another revision's capture");
    }
    page.send_revision = Some(1);
    assert_eq!(predictions::declaration(&tx, &page).unwrap(), (0, true, 0), "a late response still names its own capture");
    tx.set_meta("device:declaration:capture", "[10,true,2]").unwrap();
    assert!(predictions::capture(&tx).err().unwrap().to_string().contains("inverted bounds"));
    tx.set_meta("device:declaration:capture", r#"{"ids":[],"declaration":[0,true,0],"send_revision":1}"#).unwrap();
    page.pending_through = Some(0); page.pending_complete = Some(true); page.pending_bound = None;
    predictions::reject_capture(&tx, &page).unwrap();
    assert!(tx.meta("device:declaration:capture").unwrap().is_none(), "accepted optional-bound echoes also release on rejection");
    tx.rollback().unwrap();
}
#[test] fn capture_revision_checkpoint_and_optional_echo() {
    capture_lifetimes(crate::memory::MemoryStore::new());
    publication_tests::with_sqlite(capture_lifetimes);
}

fn recover_capture<S: DeviceStore>(store: S) {
    let backend = Backend { generation: 1, schema: Schema::default(), programs: vec![] };
    let mut d = Device::open_store(store, Some(backend.clone())).unwrap();
    let tx = d.store.transaction().unwrap();
    tx.set_meta("device:declaration:capture", "invalid checkpoint").unwrap();
    tx.set_meta("device:declaration:published", "[1,9]").unwrap();
    tx.set_meta(deferred::CURSOR, "7").unwrap();
    tx.set_meta(deferred::ACKS, "{}").unwrap();
    tx.commit().unwrap();
    let mut d = Device::open_store(d.store, Some(backend)).unwrap();
    assert!(d.store.meta("device:declaration:capture").unwrap().is_none());
    assert_eq!(d.store.meta("device:declaration:published").unwrap().as_deref(), Some("[1,9]"));
    assert!(d.publication_pending().unwrap());
    let state = d.sync_state().unwrap();
    assert_eq!((state.watermark, state.transfer_watermark, state.send_revision), (0, 7, 1));
}
#[test] fn recovery_discards_corrupt_capture_without_discarding_private_pages() {
    recover_capture(crate::memory::MemoryStore::new());
    publication_tests::with_sqlite(recover_capture);
}

fn bind_receipts<S: DeviceStore>(mut store: S) {
    let tx = store.transaction().unwrap();
    for id in ["missing", "null", "foreign"] {
        let mut q: Queued = decoded(&format!(r#"{{"id":"{id}","seq":{},"op":"bump","args":{{}},"sent_seq":8}}"#, match id { "missing" => 1, "null" => 2, _ => 3 })).unwrap();
        q.receipt_store = match id { "missing" => None, "null" => Some(ReceiptStore { id: None }), _ => Some(ReceiptStore { id: Some("old".into()) }) };
        predictions::enqueue(&tx, &q).unwrap();
    }
    predictions::bind_legacy_receipts(&tx).unwrap();
    let q: Queued = decoded(&tx.outbox_get("missing").unwrap().unwrap()).unwrap();
    assert!(q.receipt_store.is_none());
    tx.set_meta(deferred::IDENTITY, "S").unwrap();
    predictions::bind_legacy_receipts(&tx).unwrap();
    for id in ["missing", "null", "foreign"] {
        let q: Queued = decoded(&tx.outbox_get(id).unwrap().unwrap()).unwrap();
        assert_eq!(q.receipt_store.unwrap().id.as_deref(), Some(if id == "foreign" { "old" } else { "S" }));
    }
    tx.rollback().unwrap();
}
#[test] fn only_unbound_receipts_bind_to_first_private_identity() {
    bind_receipts(crate::memory::MemoryStore::new());
    publication_tests::with_sqlite(bind_receipts);
}

struct FailCleanup<S> { store: S, remaining: Rc<Cell<usize>> }
impl<S: DeviceStore> DeviceStore for FailCleanup<S> {
    type Tx<'a> = S::Tx<'a> where Self: 'a;
    fn install(&mut self, s: &Schema, m: &BTreeMap<String, String>, r: bool) -> Result<(), RuntimeError> { self.store.install(s, m, r) }
    fn meta(&self, k: &str) -> Result<Option<String>, RuntimeError> { self.store.meta(k) }
    fn set_meta(&mut self, k: &str, v: &str) -> Result<(), RuntimeError> { self.store.set_meta(k, v) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> {
        let remaining = self.remaining.get();
        if remaining == 0 { return Err(RuntimeError::Store("injected cleanup failure".into())); }
        self.remaining.set(remaining - 1);
        self.store.transaction()
    }
}
fn original_error<S: DeviceStore>(store: S) {
    let remaining = Rc::new(Cell::new(usize::MAX));
    let mut d = Device::open_store(FailCleanup { store, remaining: remaining.clone() }, Some(Backend { generation: 1, schema: Schema::default(), programs: vec![] })).unwrap();
    let page: StreamPage = decoded(r#"{"snapshot":false,"watermark":0,"more":false,"events":[],"send_revision":9}"#).unwrap();
    remaining.set(1);
    assert!(d.apply(&page, false).unwrap_err().to_string().contains("overlapped"));
    remaining.set(1);
    assert!(d.observe_store(&page).unwrap_err().to_string().contains("overlapped"));
}
#[test] fn cleanup_failure_preserves_the_original_apply_and_observe_error() {
    original_error(crate::memory::MemoryStore::new());
    publication_tests::with_sqlite(original_error);
}
