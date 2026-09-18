//! Record the final row/metadata delta of the existing applicator. Reads and
//! indexes still use the real transaction; its enclosing savepoint rolls back.
use super::*;

pub(super) struct Recording<'a, T> {
    tx: &'a T,
    pub rows: RefCell<BTreeMap<(String, String), bool>>,
    pub admission: RefCell<BTreeMap<(String, String), Option<Value>>>,
    pub meta: RefCell<BTreeSet<String>>,
}
impl<'a, T> Recording<'a, T> {
    pub fn new(tx: &'a T, inherited: BTreeMap<(String, String), Option<Value>>) -> Self { Self { tx, admission: RefCell::new(inherited), rows: RefCell::default(), meta: RefCell::default() } }
}
impl<T: DeviceTx> Rows for Recording<'_, T> {
    fn get(&self, t: &str, id: &str) -> Result<Option<Value>, RuntimeError> { self.tx.get(t, id) }
    fn lookup(&self, t: &str, n: &str, i: &Index, k: &[Value]) -> Result<Option<Value>, RuntimeError> { self.tx.lookup(t, n, i, k) }
    fn scan(&self, t: &str, i: &str, p: &[Value], b: &Bounds, d: Dir, l: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { self.tx.scan(t, i, p, b, d, l) }
    fn count_prefix(&self, t: &str, i: &str, p: &[Value], l: u64) -> Result<u64, RuntimeError> { self.tx.count_prefix(t, i, p, l) }
    fn put(&self, name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        let key = (name.into(), row.field("id")?.as_str()?.into());
        // Presence is final presence, never a proxy for holding provenance.
        // A newly admitted row keeps its first candidate across later moves;
        // delete/recreate starts a fresh acquisition candidate.
        if old.is_none() { self.admission.borrow_mut().insert(key.clone(), Some(row.clone())); }
        else { self.admission.borrow_mut().entry(key.clone()).or_insert(None); }
        self.rows.borrow_mut().insert(key, true);
        self.tx.put(name, table, row, old)
    }
    fn delete(&self, name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        self.rows.borrow_mut().insert((name.into(), old.field("id")?.as_str()?.into()), false);
        self.tx.delete(name, table, old)
    }
}
impl<T: DeviceTx> DeviceTx for Recording<'_, T> {
    fn commit(self) -> Result<(), RuntimeError> { unreachable!("recording cannot own its transaction") }
    fn rollback(self) -> Result<(), RuntimeError> { unreachable!("recording cannot own its transaction") }
    fn meta(&self, k: &str) -> Result<Option<String>, RuntimeError> { self.tx.meta(k) }
    fn meta_prefix(&self, k: &str) -> Result<Vec<(String, String)>, RuntimeError> { self.tx.meta_prefix(k) }
    fn set_meta(&self, k: &str, v: &str) -> Result<(), RuntimeError> { self.meta.borrow_mut().insert(k.into()); self.tx.set_meta(k, v) }
    fn delete_meta(&self, keys: &[&str]) -> Result<(), RuntimeError> {
        for k in keys {
            if k.ends_with(':') { self.meta.borrow_mut().extend(self.tx.meta_prefix(k)?.into_iter().map(|(k, _)| k)); }
            else { self.meta.borrow_mut().insert((*k).into()); }
        }
        self.tx.delete_meta(keys)
    }
    fn savepoint(&self, n: &str) -> Result<(), RuntimeError> { self.tx.savepoint(n) }
    fn release(&self, n: &str) -> Result<(), RuntimeError> { self.tx.release(n) }
    fn rollback_to(&self, n: &str) -> Result<(), RuntimeError> { self.tx.rollback_to(n) }
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
