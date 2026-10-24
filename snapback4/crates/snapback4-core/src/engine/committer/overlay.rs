//! Bounded ordinary-row overlay. No connection and no durable writes.
use super::reads::ReadSet;
use crate::{RuntimeError, Value, rows::{Rows, Bounds, Dir}, schema::{Index, Table}};
use std::{cell::RefCell, collections::BTreeMap};

pub(crate) type RowKey = (String, String);
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Access {
    pub table: String,
    pub index: String,
    pub key: Vec<Value>,
}
impl Access {
    pub fn point(table: &str, id: &str) -> Self {
        Self { table: table.into(), index: "byId".into(), key: vec![Value::Id(id.into())] }
    }
    pub fn cache_key(&self) -> (String, String, Vec<u8>) {
        (self.table.clone(), self.index.clone(), crate::key::encode(&self.key))
    }
}
#[derive(Default)]
pub(crate) struct Base(BTreeMap<(String, String, Vec<u8>), Option<Value>>);
impl Base {
    pub fn insert(&mut self, access: &Access, row: Option<Value>) { self.0.insert(access.cache_key(), row); }
    pub fn contains(&self, access: &Access) -> bool { self.0.contains_key(&access.cache_key()) }
    pub fn answer(&self, access: &Access) -> Result<Option<Value>, RuntimeError> {
        self.0.get(&access.cache_key()).cloned().ok_or_else(|| RuntimeError::Store("uncovered batch overlay dependency".into()))
    }
}
#[derive(Clone)]
pub(crate) struct Image {
    pub table: String,
    pub old: Value,
    pub new: Value,
}
impl Image {
    pub fn key(&self) -> RowKey { (self.table.clone(), self.new.field("id").unwrap().as_str().unwrap().into()) }
}

// @ref LLP 3000.009.001.000.002#3.3 — a private attempt sees its own writes, accepted predecessors, then immutable base facts.
pub(crate) struct Overlay<'a> {
    pub base: &'a Base,
    pub predecessors: &'a BTreeMap<RowKey, Value>,
    pub writes: RefCell<BTreeMap<RowKey, Image>>,
    pub reads: RefCell<ReadSet>,
    pub changes: RefCell<crate::revocation::Recorder>,
}
impl<'a> Overlay<'a> {
    pub fn new(base: &'a Base, predecessors: &'a BTreeMap<RowKey, Value>) -> Self {
        Self { base, predecessors, writes: Default::default(), reads: Default::default(), changes: Default::default() }
    }
    pub fn rollback(&self) { self.writes.borrow_mut().clear(); self.changes.borrow_mut().widen(); }
    fn latest(&self, table: &str, id: &str, base: Option<Value>) -> Option<Value> {
        let key = (table.into(), id.into());
        self.writes.borrow().get(&key).map(|image| image.new.clone())
            .or_else(|| self.predecessors.get(&key).cloned()).or(base)
    }
}
fn unsupported<T>() -> Result<T, RuntimeError> { Err(RuntimeError::Store("operation outside qualified batch overlay".into())) }
impl Rows for Overlay<'_> {
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.reads.borrow_mut().get(table, id);
        Ok(self.latest(table, id, self.base.answer(&Access::point(table, id))?))
    }
    fn lookup(&self, table: &str, name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        let base = self.base.answer(&Access { table: table.into(), index: name.into(), key: key.to_vec() })?;
        // Qualified updates never change an index key or row population.
        let row = match base { Some(row) => self.latest(table, row.field("id")?.as_str()?, Some(row.clone())), None => None };
        self.reads.borrow_mut().lookup(table, name, index, key, row.as_ref());
        Ok(row)
    }
    fn put(&self, name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        let Some(old) = old else { return unsupported(); };
        let id = row.field("id")?.as_str()?;
        // @ref LLP 3000.009.001.000.000.000#2 — use shared preparation and retain its exact error ordering and index charge.
        let keys = crate::rows::index_write(name, table, row, Some(old), id)?;
        if keys.iter().any(|key| key.before != key.after) { return unsupported(); }
        let key = (name.into(), id.into());
        self.changes.borrow_mut().record(name, table, Some(old), Some(row));
        self.writes.borrow_mut().entry(key).and_modify(|image| image.new = row.clone())
            .or_insert_with(|| Image { table: name.into(), old: old.clone(), new: row.clone() });
        Ok(0)
    }
    fn change_footprint(&self) -> crate::revocation::Footprint { self.changes.borrow().footprint() }
    fn widen_change_evidence(&self) { self.changes.borrow_mut().widen(); }
    fn delete(&self, _: &str, _: &Table, _: &Value) -> Result<u64, RuntimeError> { unsupported() }
    fn scan(&self, _: &str, _: &str, _: &[Value], _: &Bounds, _: Dir, _: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { unsupported() }
    fn count_prefix(&self, _: &str, _: &str, _: &[Value], _: u64) -> Result<u64, RuntimeError> { unsupported() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_writes_read_own_then_predecessors_and_never_mutate_base() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table c:\n  n: int\n  public\n  update <- allow\n".into())]);
        let schema: crate::Schema = serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
        let table = schema.tables["c"].clone();
        let row = |n| Value::Row([("id".into(),Value::Id("a".into())),("n".into(),Value::Int(n))].into_iter().collect::<BTreeMap<_,_>>().into());
        let mut base = Base::default();
        base.insert(&Access::point("c", "a"), Some(row(0)));
        base.insert(&Access::point("c", "absent"), None);
        let predecessors = [( ("c".into(),"a".into()),row(1))].into();
        let attempt = Overlay::new(&base, &predecessors);
        assert_eq!(attempt.get("c","a").unwrap(),Some(row(1)));
        assert_eq!(attempt.put("c",&table,&row(2),Some(&row(1))).unwrap(),0);
        assert_eq!(attempt.get("c","a").unwrap(),Some(row(2)));
        assert_eq!(base.answer(&Access::point("c","a")).unwrap(),Some(row(0)));
        assert_eq!(attempt.get("c","absent").unwrap(),None);
        assert!(attempt.reads.borrow().rows.contains(&("c".into(),"absent".into())));
        attempt.rollback();
        assert_eq!(attempt.get("c","a").unwrap(),Some(row(1)));
    }
}
