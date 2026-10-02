//! Indexed live basis and the timestamp that owns physical expiry subtraction.
use super::*;
use crate::schema::Table;
#[cfg(feature = "sqlite")]
use crate::maintain::RowKey;

pub(super) fn expiry(table: &Table, row: &Value) -> Option<i64> {
    table.deadline(row)
}
pub(super) fn live_at(table: &Table, row: &Value, at: i64) -> bool {
    expiry(table,row).is_none_or(|until|until>at)
}
#[cfg(feature = "sqlite")]
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
    /// A small necessary predicate range can certify a live count directly.
    /// Probe at most 65 stored keys first: expired history cannot turn this
    /// optimization into an unbounded walk. Member/source authority is already
    /// established, and all work stays in the caller's internal ledger.
    #[cfg(feature = "sqlite")]
    pub(super) fn small_view_range(&mut self, m: &Maintain, member: &Value) -> Result<Option<i64>, RuntimeError> {
        const LIMIT: usize = 64;
        // An optional probe must not consume the allowance of a small writer
        // that can otherwise publish a bounded recount. Selection depends on
        // public schema/budget, never on a hidden population or pending bit.
        let scratch = crate::rows::MAX_INDEX_KEY_BYTES as u64 * 8;
        let decode = crate::rows::disclosed::decode_reservation(&self.schema.tables[&m.source]);
        if self.scan_room(m) < LIMIT * 3 + 2 || !self.meter.room(MeterKind::HeapBytes, scratch.saturating_add(decode)) {
            return Ok(None);
        }
        let k = m.row_key.as_ref().unwrap();
        let mark = self.meter.mark();
        let result = (|| {
            self.meter.heap(scratch)?;
            self.meter.step(k.predicate.steps() + 1)?;
            let (index, bounds) = k.live_range(member);
            let prefix = std::slice::from_ref(member.field(&k.member_key)?);
            let mut probe = bounds.clone();
            for n in 0..=LIMIT {
                self.meter.charge(MeterKind::Examined, 1)?;
                let head = self.metered_scan(|runner, scope| runner.tx.index_head(scope, &m.source, &index, prefix, &probe, Dir::Asc))?;
                let Some(key) = head else {
                    if n == 0 { return Ok(Some(0)); }
                    let mut cursor = bounds;
                    let mut total = 0;
                    for _ in 0..n {
                        let mark = self.meter.mark();
                        self.meter.charge(MeterKind::Examined, 1)?;
                        let row = self.scan_authorized(&m.source, &index, prefix, &cursor, Dir::Asc, 1, true, true, #[cfg(feature = "server-search")] None)?.pop();
                        if let Some((row, key)) = row {
                            cursor.after = crate::key::decode(&key).map(|v| v.into_iter().skip(prefix.len()).collect());
                            // Uniform source-group authority preceded the probe;
                            // expired/rejected candidates contribute nothing.
                            if let Some(row) = row {
                                let row = row.into_value();
                                self.rebuilt_source_rows = self.rebuilt_source_rows.saturating_add(1);
                                self.meter.step(k.predicate.steps() * 2 + 4)?;
                                let source = &self.schema.tables[&m.source];
                                if !self.expired(source, &row) && k.matches(&row, member) {
                                    total += 1;
                                    self.note_expiry(source, &row);
                                }
                            }
                        }
                        self.meter.release_heap(mark);
                    }
                    return Ok(Some(total));
                };
                if n == LIMIT { return Ok(None); }
                probe.after = Some(key.into_iter().skip(prefix.len()).collect());
            }
            unreachable!()
        })();
        self.meter.release_heap(mark);
        result
    }

    // @ref LLP 3000.015#3 — seek around expired inputs; never filter a stored-parent walk.
    pub(super) fn live_basis_scan(&mut self, m: &Maintain, member: &Value, cursor: Option<&Value>, limit: usize) -> Result<(i64,bool,Option<Value>),RuntimeError> {
        // @ref LLP 3000.015#3 — bounded authorized predicate ranges avoid visiting history.
        #[cfg(feature = "sqlite")]
        let limit = if !self.device && cursor.is_none() {
            let before = self.meter.used.examined;
            if let Some(n) = self.small_view_range(m, member)? { return Ok((n, true, None)); }
            // The caller reserved publication headroom before the probe. Keep
            // its charges and spend only the remainder on the fallback walk.
            limit.saturating_sub((self.meter.used.examined - before) as usize)
        } else { limit };
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
    #[cfg(feature = "sqlite")]
    pub(super) fn view_basis(&mut self, m: &Maintain, id: &str) -> Result<i64,RuntimeError> {
        if self.device || !self.schema.tables[&m.source].is_expiring() { return Ok(i64::MIN); }
        Ok(self.view_get(&format!("$basis:{}",m.target),id)?.as_ref().map_or(i64::MIN,|row|number(row,"at")))
    }
    // The basis update and count share the source/member transaction. A later
    // sweep subtracts only inputs live in this basis, never a second time.
    #[cfg(feature = "sqlite")]
    pub(super) fn set_view_basis(&mut self, m: &Maintain, id: &str, deadline: Option<i64>) -> Result<(),RuntimeError> {
        if self.device || !self.schema.tables[&m.source].is_expiring() { return Ok(()); }
        let table = format!("$basis:{}",m.target);
        let old = self.view_get(&table,id)?;
        let version = self.view_certification_version(m);
        self.view_put(&table,&object([("id",Value::Id(id.into())),("at",Value::Int(self.context.now.unwrap_or(0))),
            ("deadline", deadline.map(Value::Int).unwrap_or(Value::Null)),
            ("version", Value::String(version))]),old.as_ref(),true)
    }
}
