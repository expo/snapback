//! Record the final row/metadata delta of the existing applicator. Reads and
//! indexes still use the real transaction; its enclosing savepoint rolls back.
use super::*;

pub(super) struct Recording<'a, T> {
    tx: &'a T,
    pub rows: RefCell<BTreeMap<(String, String), bool>>,
    pub admission: RefCell<BTreeMap<(String, String), Option<Value>>>,
    pub meta: RefCell<BTreeMap<String, Option<String>>>,
}
impl<'a, T> Recording<'a, T> {
    pub fn new(tx: &'a T, inherited: BTreeMap<(String, String), Option<Value>>, meta: BTreeMap<String, Option<String>>) -> Self { Self { tx, admission: RefCell::new(inherited), rows: RefCell::default(), meta: RefCell::new(meta) } }
}
impl<T: DeviceTx> Rows for Recording<'_, T> {
    fn get(&self, t: &str, id: &str) -> Result<Option<Value>, RuntimeError> { self.tx.get(t, id) }
    fn lookup(&self, t: &str, n: &str, i: &Index, k: &[Value]) -> Result<Option<Value>, RuntimeError> { self.tx.lookup(t, n, i, k) }
    fn scan(&self, t: &str, i: &str, p: &[Value], b: &Bounds, d: Dir, l: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { self.tx.scan(t, i, p, b, d, l) }
    fn count_prefix(&self, t: &str, i: &str, p: &[Value], l: u64) -> Result<u64, RuntimeError> { self.tx.count_prefix(t, i, p, l) }
    fn put(&self, name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        let key = (name.into(), row.field("id")?.as_str()?.into());
        let changed = self.tx.put(name, table, row, old)?;
        // Presence is final presence, never a proxy for holding provenance.
        // A newly admitted row keeps its first candidate across later moves;
        // delete/recreate starts a fresh acquisition candidate.
        if old.is_none() { self.admission.borrow_mut().insert(key.clone(), Some(row.clone())); }
        else { self.admission.borrow_mut().entry(key.clone()).or_insert(None); }
        self.rows.borrow_mut().insert(key, true);
        Ok(changed)
    }
    fn delete(&self, name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        let key = (name.into(), old.field("id")?.as_str()?.into());
        let changed = self.tx.delete(name, table, old)?;
        self.rows.borrow_mut().insert(key, false);
        Ok(changed)
    }
}
impl<T: DeviceTx> DeviceTx for Recording<'_, T> {
    fn commit(self) -> Result<(), RuntimeError> { unreachable!("recording cannot own its transaction") }
    fn rollback(self) -> Result<(), RuntimeError> { unreachable!("recording cannot own its transaction") }
    fn meta(&self, k: &str) -> Result<Option<String>, RuntimeError> { self.tx.meta(k) }
    fn meta_prefix(&self, k: &str) -> Result<Vec<(String, String)>, RuntimeError> { self.tx.meta_prefix(k) }
    fn set_meta(&self, k: &str, v: &str) -> Result<(), RuntimeError> {
        self.tx.set_meta(k, v)?;
        self.meta.borrow_mut().insert(k.into(), Some(v.into()));
        Ok(())
    }
    fn delete_meta(&self, keys: &[&str]) -> Result<(), RuntimeError> {
        self.tx.delete_meta(keys)?;
        let mut meta = self.meta.borrow_mut();
        for k in keys {
            if k.ends_with(':') { meta.retain(|key, _| !key.starts_with(k)); }
            // Prefix tombstones sort before later child writes at installation.
            meta.insert((*k).into(), None);
        }
        Ok(())
    }
    fn savepoint(&self, _: &str) -> Result<(), RuntimeError> { unreachable!("stream applicator cannot nest recording savepoints") }
    fn release(&self, _: &str) -> Result<(), RuntimeError> { unreachable!("stream applicator cannot nest recording savepoints") }
    fn rollback_to(&self, _: &str) -> Result<(), RuntimeError> { unreachable!("stream applicator cannot nest recording savepoints") }
    fn clear_rows(&self) -> Result<(), RuntimeError> { unreachable!("stream effects delete named rows") }
    fn outbox_insert(&self, s: u64, id: &str, v: &str) -> Result<(), RuntimeError> { self.tx.outbox_insert(s, id, v) }
    fn outbox_upsert(&self, s: u64, id: &str, v: &str) -> Result<(), RuntimeError> { self.tx.outbox_upsert(s, id, v) }
    fn outbox_delete(&self, id: &str) -> Result<(), RuntimeError> { self.tx.outbox_delete(id) }
    fn outbox_get(&self, id: &str) -> Result<Option<String>, RuntimeError> { self.tx.outbox_get(id) }
    fn outbox_entries(&self) -> Result<Vec<String>, RuntimeError> { self.tx.outbox_entries() }
    fn outbox_max_seq(&self) -> Result<u64, RuntimeError> { self.tx.outbox_max_seq() }
    fn base_remember(&self, t: &str, id: &str, v: Option<&str>) -> Result<(), RuntimeError> { self.tx.base_remember(t, id, v) }
    fn base_entries(&self) -> Result<Vec<(String, String, Option<String>)>, RuntimeError> { self.tx.base_entries() }
    fn base_clear(&self) -> Result<(), RuntimeError> { self.tx.base_clear() }
    fn staged_put(&self, k: &str, t: &str, v: &str) -> Result<(), RuntimeError> { self.tx.staged_put(k, t, v) }
    fn staged_delete(&self, k: &str) -> Result<(), RuntimeError> { self.tx.staged_delete(k) }
    fn staged_after(&self, k: &str, n: usize) -> Result<Vec<(String, String, String)>, RuntimeError> { self.tx.staged_after(k, n) }
    fn staged_table_after(&self, t: &str, k: &str, n: usize) -> Result<Vec<(String, String)>, RuntimeError> { self.tx.staged_table_after(t, k, n) }
    fn staged_clear(&self) -> Result<(), RuntimeError> { self.tx.staged_clear() }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn prefix<S: DeviceStore>(mut store: S) {
        let tx = store.transaction().unwrap();
        // The delta must retain a deletion even if no matching key is live.
        let inherited = BTreeMap::from([("history:earlier".into(), Some("old".into()))]);
        let recording = Recording::new(&tx, BTreeMap::new(), inherited);
        recording.delete_meta(&["history:"]).unwrap();
        recording.set_meta("history:new", "new").unwrap();
        recording.set_meta("other:keep", "kept").unwrap();
        assert_eq!(*recording.meta.borrow(), BTreeMap::from([
            ("history:".into(), None), ("history:new".into(), Some("new".into())), ("other:keep".into(), Some("kept".into())),
        ]));
        tx.set_meta("history:earlier", "old").unwrap();
        for (key, value) in recording.meta.borrow().iter() {
            tx.set_meta(&format!("{META}{key}"), &encoded(value).unwrap()).unwrap();
        }
        install_metadata(&tx).unwrap();
        assert_eq!(tx.meta_prefix("history:").unwrap(), vec![("history:new".into(), "new".into())]);
        tx.rollback().unwrap();
    }
    #[test]
    fn prefix_deletion_is_an_ordered_fold_operation() {
        prefix(crate::memory::MemoryStore::new());
        #[cfg(feature = "native")]
        crate::device::publication_tests::with_sqlite(prefix);
    }
}

#[cfg(all(test, feature = "native"))]
#[test]
fn failed_metadata_operation_is_not_recorded() {
    crate::device::publication_tests::with_sqlite(|mut store| {
        let tx = DeviceStore::transaction(&mut store).unwrap();
        tx.conn().execute_batch("CREATE TRIGGER reject_meta BEFORE INSERT ON _meta WHEN NEW.key = 'reject' BEGIN SELECT RAISE(ABORT, 'injected metadata error'); END;").unwrap();
        let recording = Recording::new(&tx, BTreeMap::new(), BTreeMap::new());
        assert!(recording.set_meta("reject", "uncommitted").is_err());
        assert!(recording.meta.borrow().is_empty());
        tx.rollback().unwrap();
    });
}

#[cfg(test)]
#[test]
#[should_panic(expected = "stream applicator cannot nest recording savepoints")]
fn recording_refuses_unsupported_nested_savepoints() {
    let mut store = crate::memory::MemoryStore::new();
    let tx = store.transaction().unwrap();
    let recording = Recording::new(&tx, BTreeMap::new(), BTreeMap::new());
    recording.savepoint("inner").unwrap();
}
