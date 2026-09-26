//! Indexed live basis and the timestamp that owns physical expiry subtraction.
use super::*;
use crate::{schema::Table, maintain::RowKey};

pub(super) fn expiry(table: &Table, row: &Value) -> Option<i64> {
    table.deadline(row)
}
pub(super) fn live_at(table: &Table, row: &Value, at: i64) -> bool {
    expiry(table,row).is_none_or(|until|until>at)
}
pub(super) fn before_cursor(k: &RowKey, table: &Table, row: &Value, cursor: &Value) -> bool {
    match cursor {
        Value::Id(cursor) => row.field("id").ok().and_then(|v|v.as_str().ok()).is_some_and(|id|id<=cursor.as_str()),
        Value::Array(cursor) => {
            let index = k.range_index(table.expiry_column().unwrap());
            let key = crate::rows::index_key(&table.indexes[&index],row,row.field("id").unwrap().as_str().unwrap());
            let suffix: Vec<_> = crate::key::decode(&key).unwrap().into_iter().skip(1).collect();
            crate::key::encode(&suffix)<=crate::key::encode(cursor)
        }
        _ => false,
    }
}
impl Runner<'_> {
    // @ref LLP 3000.015#3 — seek around expired inputs; never filter a stored-parent walk.
    pub(super) fn live_basis_scan(&mut self, m: &Maintain, member: &Value, cursor: Option<&Value>, limit: usize) -> Result<(i64,bool,Option<Value>),RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let source = &self.schema.tables[&m.source];
        let Some(expire) = source.expiry_column() else {
            return self.view_scan(m,member,None,&k.source_index(),Bounds::default(),limit,true);
        };
        let index = k.range_index(expire);
        let after = cursor.and_then(|v|if let Value::Array(a)=v { Some(a.clone()) } else { None });
        let mut remaining = limit;
        let mut total = 0;
        let mut last = None;
        for mut bounds in [Bounds {lte:Some(Value::Null),..Default::default()},Bounds {gt:Some(Value::Int(self.context.now.unwrap_or(0))),..Default::default()}] {
            bounds.after = after.clone();
            let before = self.meter.used.examined;
            let (n,complete,next) = self.view_scan(m,member,None,&index,bounds,remaining,true)?;
            remaining = remaining.saturating_sub((self.meter.used.examined-before) as usize);
            total += n;
            if next.is_some() { last = next; }
            if !complete { return Ok((total,false,last)); }
        }
        Ok((total,true,last))
    }
    pub(super) fn view_basis(&mut self, m: &Maintain, id: &str) -> Result<i64,RuntimeError> {
        if self.device || !self.schema.tables[&m.source].is_expiring() { return Ok(i64::MIN); }
        Ok(self.view_get(&format!("$basis:{}",m.target),id)?.as_ref().map_or(i64::MIN,|row|number(row,"at")))
    }
    // The basis update and count share the source/member transaction. A later
    // sweep subtracts only inputs live in this basis, never a second time.
    pub(super) fn set_view_basis(&mut self, m: &Maintain, id: &str) -> Result<(),RuntimeError> {
        if self.device || !self.schema.tables[&m.source].is_expiring() { return Ok(()); }
        let table = format!("$basis:{}",m.target);
        let old = self.view_get(&table,id)?;
        self.view_put(&table,&object([("id",Value::Id(id.into())),("at",Value::Int(self.context.now.unwrap_or(0)))]),old.as_ref(),true)
    }
}
