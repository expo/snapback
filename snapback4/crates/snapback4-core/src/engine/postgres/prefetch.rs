//! Transaction-owned exact physical answers. Never authorizes, meters or logs.
use super::store::{Tx, decode};
use crate::{RuntimeError, Value, key, rows::{Bounds, Dir, PrefetchRequest, scan_range}};
use std::collections::{BTreeMap, BTreeSet};

pub const PREFETCH_ROW_BYTES: usize = 4 * 1024 * 1024;
// SAVEPOINT + RELEASE. Only distinct, uncached, fillable requests count
// toward amortizing these calls; a three-key single-table page breaks even.
const FILL_CONTROL_CALLS: usize = 2;
// Tagged Value JSON is smaller than its decoded map/array allocation. Reserve
// 32 bytes of cache space per serialized byte (including container capacity)
// before transferring payloads; retain exact heap accounting as a backstop.
const DECODE_RESERVE: usize = 32;

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Call { Get(String, String), Lookup(String, String, Vec<u8>) }
impl Call {
    fn table(&self) -> &str { match self { Self::Get(t, _) | Self::Lookup(t, _, _) => t } }
    fn bytes(&self) -> usize { match self { Self::Get(t, id) => t.len() + id.len(), Self::Lookup(t, ix, key) => t.len() + ix.len() + key.len() } }
}

#[derive(Default)]
pub(super) struct Cache { answers: BTreeMap<Call, (Option<Value>, usize)>, bytes: usize }
impl Cache {
    pub fn clear(&mut self) { self.answers.clear(); self.bytes = 0; }
    pub fn invalidate(&mut self, table: &str) {
        self.answers.retain(|key, (_, bytes)| { if key.table() == table { self.bytes = self.bytes.saturating_sub(*bytes); false } else { true } });
    }
    pub fn get(&self, table: &str, id: &str) -> Option<Option<Value>> { self.answers.get(&Call::Get(table.into(), id.into())).map(|(v, _)| v.clone()) }
    pub fn lookup(&self, table: &str, index: &str, values: &[Value]) -> Option<Option<Value>> {
        self.answers.get(&Call::Lookup(table.into(), index.into(), key::encode(values))).map(|(v, _)| v.clone())
    }
}

impl Tx<'_> {
    // Count every returned payload before cardinality checks or decoding, so
    // the transfer witness cannot hide bytes discarded by a rejected fill.
    fn prefetch_query(&self, sql: &'static str, params: &[&(dyn postgres::types::ToSql + Sync)]) -> Result<Vec<postgres::Row>, RuntimeError> {
        let rows = self.query(sql, params)?;
        for row in &rows {
            if let Some(text) = row.get::<_, Option<&str>>(1) {
                self.prefetch_rows.set(self.prefetch_rows.get() + 1);
                self.prefetch_bytes.set(self.prefetch_bytes.get() + text.len() as u64);
            }
        }
        Ok(rows)
    }

    pub(super) fn fill_prefetch(&self, requests: &[PrefetchRequest]) {
        if !self.prefetch_enabled || requests.is_empty() { return; }
        self.marked_reads.set(self.marked_reads.get() + requests.len() as u64);
        self.page_reads.set(self.page_reads.get().max(requests.len() as u64));
        let mut gets: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        let mut lookups: BTreeMap<(String, String), BTreeMap<Vec<u8>, Vec<u8>>> = BTreeMap::new();
        let mut calls = BTreeSet::new();
        for request in requests {
            let call = match request {
                PrefetchRequest::Get { table, id } => Call::Get(table.clone(), id.clone()),
                PrefetchRequest::Lookup { table, index, key: values } => Call::Lookup(table.clone(), index.clone(), key::encode(values)),
            };
            if let PrefetchRequest::Lookup { key, .. } = request {
                if scan_range(key, &Bounds::default(), Dir::Asc).is_none() { continue; }
            }
            if self.rows_cache.borrow().answers.contains_key(&call) || !calls.insert(call) { continue; }
            match request {
                PrefetchRequest::Get { table, id } => { gets.entry(table.clone()).or_default().insert(id.clone()); }
                PrefetchRequest::Lookup { table, index, key } => if let Some((lo, hi)) = scan_range(key, &Bounds::default(), Dir::Asc) {
                    lookups.entry((table.clone(), index.clone())).or_default().insert(lo, hi);
                },
            }
        }
        if calls.len() <= gets.len() + lookups.len() + FILL_CONTROL_CALLS { return; }
        let available = PREFETCH_ROW_BYTES.saturating_sub(self.rows_cache.borrow().bytes);
        let overhead = calls.iter().map(|call| call.bytes() + std::mem::size_of::<(Call, Option<Value>)>()).sum::<usize>();
        if overhead > available { return; }
        let mut payload_budget = (available - overhead) / DECODE_RESERVE;
        if self.batch("SAVEPOINT prefetch").is_err() { return; }
        let fill = (|| -> Result<Cache, RuntimeError> {
            let mut added = Cache::default();
            let mut insert = |call: Call, text: Option<&str>| -> Result<(), RuntimeError> {
                let value: Option<Value> = text.map(decode).transpose()?;
                let bytes = call.bytes() + value.as_ref().map_or(0, |v| v.heap_bytes() as usize) + std::mem::size_of::<(Call, Option<Value>)>();
                added.bytes = added.bytes.saturating_add(bytes);
                if added.bytes > available { return Err(RuntimeError::Store("prefetch byte budget".into())); }
                added.answers.insert(call, (value, bytes));
                Ok(())
            };
            for (table, ids) in gets {
                let ids: Vec<_> = ids.into_iter().collect();
                // The server returns either the entire group (including misses)
                // or zero rows. A rejected group never transfers a row image.
                let rows = self.prefetch_query("WITH hits AS MATERIALIZED (SELECT q.id, r.data FROM unnest($2::text[]) q(id) LEFT JOIN r ON r.t = $1 AND r.id = q.id) SELECT id, data FROM hits WHERE (SELECT COALESCE(SUM(octet_length(data)),0) FROM hits) <= $3::bigint", &[&table, &ids, &(payload_budget as i64)])?;
                if rows.len() != ids.len() { return Err(RuntimeError::Store("prefetch byte budget".into())); }
                for row in rows {
                    let text: Option<&str> = row.get(1);
                    payload_budget = payload_budget.saturating_sub(text.map_or(0, str::len));
                    insert(Call::Get(table.clone(), row.get(0)), text)?;
                }
            }
            for ((table, index), ranges) in lookups {
                let (lo, hi): (Vec<Vec<u8>>, Vec<Vec<u8>>) = ranges.into_iter().unzip();
                let rows = self.prefetch_query("WITH hits AS MATERIALIZED (SELECT q.ord, hit.data FROM unnest($3::bytea[], $4::bytea[]) WITH ORDINALITY AS q(lo,hi,ord) LEFT JOIN LATERAL (SELECT r.data FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= q.lo AND i.k < q.hi ORDER BY i.k LIMIT 1) hit ON true) SELECT ord, data FROM hits WHERE (SELECT COALESCE(SUM(octet_length(data)),0) FROM hits) <= $5::bigint ORDER BY ord", &[&table, &index, &lo, &hi, &(payload_budget as i64)])?;
                if rows.len() != lo.len() { return Err(RuntimeError::Store("prefetch byte budget".into())); }
                for row in rows {
                    let n = row.get::<_, i64>(0) as usize - 1;
                    let text: Option<&str> = row.get(1);
                    payload_budget = payload_budget.saturating_sub(text.map_or(0, str::len));
                    insert(Call::Lookup(table.clone(), index.clone(), lo[n].clone()), text)?;
                }
            }
            Ok(added)
        })();
        match fill {
            Ok(added) if self.batch("RELEASE SAVEPOINT prefetch").is_ok() => {
                let mut cache = self.rows_cache.borrow_mut();
                cache.bytes += added.bytes;
                cache.answers.extend(added.answers);
            }
            _ => {
                // This rollback only undoes speculative SQL. Keep earlier
                // successful fills exactly as they were (including misses).
                // Use the explicit speculative rollback that preserves them.
                let _ = self.rollback_prefetch();
            }
        }
    }
}
