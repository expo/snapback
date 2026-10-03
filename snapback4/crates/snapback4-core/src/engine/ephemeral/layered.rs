//! Routing and transactional undo for memory rows over a durable snapshot.
use crate::{
    RuntimeError, Value,
    rows::{Bounds, Dir, MemoryRows, PrefetchRequest, Rows},
    schema::{Index, Schema, Table},
};
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
};

pub struct Layered<'a> {
    durable: &'a dyn Rows,
    pub(super) eph: &'a MemoryRows,
    schema: &'a Schema,
    journal: RefCell<BTreeMap<(String, String), Option<Value>>>,
    committed: Cell<bool>,
    mutation: bool,
}
impl<'a> Layered<'a> {
    pub fn new(
        durable: &'a dyn Rows,
        eph: &'a MemoryRows,
        schema: &'a Schema,
        mutation: bool,
    ) -> Self {
        Self {
            durable,
            eph,
            schema,
            mutation,
            journal: RefCell::new(BTreeMap::new()),
            committed: Cell::new(false),
        }
    }
    fn memory(&self, name: &str) -> bool {
        self.schema
            .table(name)
            .is_some_and(|t| t.ephemeral.is_some())
    }
    fn read(&self, name: &str) -> &dyn Rows {
        if self.memory(name) {
            self.eph
        } else {
            self.durable
        }
    }
    fn durable_write(&self) -> Result<(), RuntimeError> {
        if self.mutation {
            Err(RuntimeError::Store(
                "ephemeral execution attempted a durable write".into(),
            ))
        } else {
            Err(RuntimeError::Store("query attempted a write".into()))
        }
    }
    fn remember(&self, table: &str, id: &str) -> Result<(), RuntimeError> {
        if !self.mutation {
            return self.durable_write();
        }
        let key = (table.into(), id.into());
        if !self.journal.borrow().contains_key(&key) {
            let old = self.eph.get(table, id)?;
            self.journal.borrow_mut().insert(key, old);
        }
        Ok(())
    }
    pub(super) fn changed(&self) -> Vec<(String, String)> {
        self.journal.borrow().keys().cloned().collect()
    }
    pub(super) fn footprint(&self) -> crate::revocation::Footprint {
        let mut out = crate::revocation::Recorder::default();
        for ((table, id), old) in self.journal.borrow().iter() {
            let new = self.eph.get(table,id).expect("memory read");
            out.record(table,&self.schema.tables[table],old.as_ref(),new.as_ref());
        }
        out.footprint()
    }
    pub(super) fn commit(&self) {
        self.committed.set(true);
    }
}
// @ref LLP 3000.017#2.2 — every non-commit exit, including unwind, undoes memory.
impl Drop for Layered<'_> {
    fn drop(&mut self) {
        if self.committed.get() {
            return;
        }
        for ((name, id), before) in self.journal.get_mut().iter() {
            let table = &self.schema.tables[name];
            let current = self.eph.get(name, id).expect("memory read cannot fail");
            match (before, current.as_ref()) {
                (Some(before), current) => {
                    self.eph
                        .put(name, table, before, current)
                        .expect("previously admitted memory image");
                }
                (None, Some(current)) => {
                    self.eph
                        .delete(name, table, current)
                        .expect("memory delete cannot fail");
                }
                (None, None) => {}
            }
        }
    }
}
impl Rows for Layered<'_> {
    fn asset_unviewed(&self, id: &str, viewer: &str) -> bool { self.durable.asset_unviewed(id, viewer) }

    fn get(&self, t: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.read(t).get(t, id)
    }
    fn lookup(
        &self,
        t: &str,
        n: &str,
        i: &Index,
        k: &[Value],
    ) -> Result<Option<Value>, RuntimeError> {
        self.read(t).lookup(t, n, i, k)
    }
    fn scan(
        &self,
        t: &str,
        i: &str,
        p: &[Value],
        b: &Bounds,
        d: Dir,
        n: usize,
    ) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        self.read(t).scan(t, i, p, b, d, n)
    }
    fn scan_metered(
        &self,
        t: &str,
        i: &str,
        p: &[Value],
        b: &Bounds,
        d: Dir,
        n: usize,
        s: &crate::engine::Authorization,
        m: &mut crate::engine::InternalMeter<'_>,
    ) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        self.read(t).scan_metered(t, i, p, b, d, n, s, m)
    }
    fn index_head(
        &self,
        t: &str,
        i: &str,
        p: &[Value],
        b: &Bounds,
        d: Dir,
    ) -> Result<Option<Vec<Value>>, RuntimeError> {
        self.read(t).index_head(t, i, p, b, d)
    }
    fn count_prefix(&self, t: &str, i: &str, p: &[Value], n: u64) -> Result<u64, RuntimeError> {
        self.read(t).count_prefix(t, i, p, n)
    }
    fn cap_count(&self, t: &str, by: &[String], group: &[Value]) -> Result<u64, RuntimeError> {
        self.read(t).cap_count(t, by, group)
    }
    fn put(
        &self,
        name: &str,
        table: &Table,
        row: &Value,
        old: Option<&Value>,
    ) -> Result<u64, RuntimeError> {
        if !self.memory(name) {
            self.durable_write()?;
        }
        self.remember(name, row.field("id")?.as_str()?)?;
        self.eph.put(name, table, row, old)
    }
    fn delete(&self, name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        if !self.memory(name) {
            self.durable_write()?;
        }
        self.remember(name, old.field("id")?.as_str()?)?;
        self.eph.delete(name, table, old)
    }
    fn sequence_value(&self, t: &str, id: &str) -> Result<i64, RuntimeError> {
        self.durable.sequence_value(t, id)
    }
    fn set_sequence(&self, _: &str, _: &str, _: i64) -> Result<(), RuntimeError> {
        self.durable_write()
    }
    fn effect_once(&self, _: &str, _: &str) -> Result<bool, RuntimeError> {
        self.durable_write()?;
        unreachable!()
    }
    fn holds_assets(&self) -> bool {
        self.durable.holds_assets()
    }
    fn asset(&self, id: &str) -> Result<Option<crate::assets::Asset>, RuntimeError> {
        self.durable.asset(id)
    }
    fn claim_asset(
        &self,
        _: &str,
        _: &str,
        _: &str,
        _: &str,
        _: &str,
    ) -> Result<crate::assets::Asset, RuntimeError> {
        self.durable_write()?;
        unreachable!()
    }
    fn release_asset(&self, _: &str, _: &str, _: &str, _: &str, _: i64) -> Result<(), RuntimeError> {
        self.durable_write()
    }
    fn prefetch(&self, requests: &[PrefetchRequest]) {
        let durable: Vec<_> = requests
            .iter()
            .filter(|r| match r {
                PrefetchRequest::Get { table, .. } | PrefetchRequest::Lookup { table, .. } => {
                    !self.memory(table)
                }
            })
            .cloned()
            .collect();
        self.durable.prefetch(&durable)
    }
    fn prefetch_enabled(&self) -> bool {
        self.durable.prefetch_enabled()
    }
}
