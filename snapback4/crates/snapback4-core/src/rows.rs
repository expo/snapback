//! What the interpreter needs of a store: rows by id, index lookups and
//! ordered scans, writes that keep the indexes. The server's SQLite
//! transaction implements it; a device implements it over its own store —
//! the same SQLite layout through the same code on a native host, or the
//! host's store through callbacks on the web — so one interpreter runs on
//! every host and the language is bound once.

#[path = "engine/word_heap.rs"]
pub mod word_heap;
pub mod caps;
#[cfg(any(feature = "sqlite", feature = "postgres"))]
pub(crate) mod adoption;
pub mod disclosed;

use crate::assets::Asset;
use crate::error::RuntimeError;
use crate::key;
use crate::schema::{Index, Table};
use crate::value::Value;

/// Portable encoded composite key ceiling, including the appended row id.
/// @ref LLP 3000.009#4.3 — one admission bound on every store and host.
pub const MAX_INDEX_KEY_BYTES: usize = 2048;
/// The prototype also stores both labels in its B-tree primary key. Reserve
/// their space explicitly rather than assuming identifiers have bounded size.
pub const MAX_INDEX_LABEL_BYTES: usize = 512;

/// Compute once, validate before any store changes, then reuse for the writes.
/// Existing violations may stay equal or shrink; deletion never uses this gate.
pub struct IndexWrite<'a> {
    pub name: &'a str,
    pub before: Vec<Vec<u8>>,
    pub after: Vec<Vec<u8>>,
}

pub fn index_write<'a>(name: &str, table: &'a Table, row: &Value, old: Option<&Value>, id: &str) -> Result<Vec<IndexWrite<'a>>, RuntimeError> {
    let row = crate::schema::row_image(row, table);
    let old = old.map(|row| crate::schema::row_image(row, table));
    table.indexes.iter().map(|(index_name, index)| {
        let before = old.as_ref().map(|row| index_keys(index, row, id)).unwrap_or_default();
        let after = index_keys(index, &row, id);
        if name.len().saturating_add(index_name.len()) > MAX_INDEX_LABEL_BYTES && before.is_empty() && !after.is_empty() {
            return Err(RuntimeError::Structural { code: "E_INDEX_KEY_BYTES", message: format!("table and index names for {name}.{index_name} exceed {MAX_INDEX_LABEL_BYTES} combined UTF-8 bytes; shorten the names (guide indexes)") });
        }
        // Pair oversized entries longest-first. A word index may have many;
        // neither their lengths nor their count may grow past the old keys.
        if after.iter().any(|key| key.len() > MAX_INDEX_KEY_BYTES) {
            let mut previous: Vec<_> = before.iter().map(Vec::len).filter(|n| *n > MAX_INDEX_KEY_BYTES).collect();
            let mut next: Vec<_> = after.iter().map(Vec::len).filter(|n| *n > MAX_INDEX_KEY_BYTES).collect();
            previous.sort_unstable_by(|a, b| b.cmp(a));
            next.sort_unstable_by(|a, b| b.cmp(a));
            if next.len() > previous.len() || next.iter().zip(&previous).any(|(a, b)| a > b) {
                return Err(index_key_refusal(name, index_name, next.len() as u64));
            }
        }
        Ok(IndexWrite { name: index_name, before, after })
    }).collect()
}

pub fn index_key_refusal(table: &str, index: &str, count: u64) -> RuntimeError {
    RuntimeError::Structural { code: "E_INDEX_KEY_BYTES", message: format!("{table}.{index}: {count} index entries exceed {MAX_INDEX_KEY_BYTES} encoded bytes including the id; delete or shorten the indexed values, then declare text <=N bounds that fit and retry adoption (guide indexes)") }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dir {
    Asc,
    Desc,
}

/// Bounds on the components after a scan prefix (`after` a cursor position,
/// or a value range on the first free component).
#[derive(Clone, Debug, Default)]
pub struct Bounds {
    /// Resume strictly after this suffix position.
    pub after: Option<Vec<Value>>,
    /// Initial inclusive resume; subsequent scan batches still advance `after` exclusively.
    pub at_or_after: Option<Vec<Value>>,
    /// Stop strictly before this suffix position.
    pub before: Option<Vec<Value>>,
    pub gt: Option<Value>,
    pub gte: Option<Value>,
    pub lt: Option<Value>,
    pub lte: Option<Value>,
    /// The first free component is a word that starts with this text: the
    /// range of a `matching` read over a `words(..)` index (`key::word_range`).
    pub word: Option<String>,
}

/// The byte range a scan covers: every key extending the encoded prefix,
/// narrowed by the bounds. `None` when the range is empty.
pub fn scan_range(prefix: &[Value], bounds: &Bounds, dir: Dir) -> Option<(Vec<u8>, Vec<u8>)> {
    let base = key::encode(prefix);
    let (mut lo, mut hi) = match &bounds.word {
        Some(word) => key::word_range(&base, word),
        None => (base.clone(), key::upper_bound(&base)),
    };
    let with = |value: &Value| {
        let mut extended = prefix.to_vec();
        extended.push(value.clone());
        key::encode(&extended)
    };
    if let Some(value) = &bounds.gte {
        lo = lo.max(with(value));
    }
    if let Some(value) = &bounds.gt {
        lo = lo.max(key::upper_bound(&with(value)));
    }
    if let Some(value) = &bounds.lte {
        hi = hi.min(key::upper_bound(&with(value)));
    }
    if let Some(value) = &bounds.lt {
        hi = hi.min(with(value));
    }
    if let Some(start) = &bounds.at_or_after {
        let mut position = prefix.to_vec();
        position.extend(start.iter().cloned());
        let position = key::encode(&position);
        match dir {
            Dir::Asc => lo = lo.max(position),
            Dir::Desc => hi = hi.min(key::upper_bound(&position)),
        }
    }
    if let Some(after) = &bounds.after {
        let mut position = prefix.to_vec();
        position.extend(after.iter().cloned());
        let position = key::encode(&position);
        match dir {
            Dir::Asc => lo = lo.max(key::upper_bound(&position)),
            Dir::Desc => hi = hi.min(position),
        }
    }
    if let Some(before) = &bounds.before {
        let mut position = prefix.to_vec();
        position.extend(before.iter().cloned());
        let position = key::encode(&position);
        match dir {
            Dir::Asc => hi = hi.min(position),
            Dir::Desc => lo = lo.max(key::upper_bound(&position)),
        }
    }
    (lo < hi).then_some((lo, hi))
}

/// The stored key of one index entry of a plain index: the components,
/// then the id. A `words(..)` index has one entry per token: `index_keys`.
pub fn index_key(index: &Index, row: &Value, id: &str) -> Vec<u8> {
    let mut components = index_values(index, row);
    components.push(Value::Id(id.to_owned()));
    key::encode(&components)
}

/// Every stored key of a row in an index: one for a plain index; for an
/// index with a `words(..)` component, one per distinct token of the named
/// text columns, the token in the component's position (none when the
/// text has no token: the row is absent from that index, as a null key
/// would be from a point read). Every store writes and deletes exactly
/// these, on every host.
pub fn index_keys(index: &Index, row: &Value, id: &str) -> Vec<Vec<u8>> {
    if let Some(crate::schema::IndexComponent::Contribution(maintain)) = index.components.first() {
        return if maintain.selected(row) { vec![index_key(index, row, id)] } else { Vec::new() };
    }
    let Some((position, fields)) = index.word_component() else { return vec![index_key(index, row, id)] };
    let texts: Vec<&str> = fields.iter().filter_map(|field| row.field(field).ok().and_then(|value| value.as_str().ok())).collect();
    let tokens = crate::words::row_tokens(texts);
    let values = index_values(index, row);
    tokens
        .into_iter()
        .map(|token| {
            let mut components: Vec<Value> = values[..position].to_vec();
            components.push(Value::String(token));
            components.extend(values[position..].iter().cloned());
            components.push(Value::Id(id.to_owned()));
            key::encode(&components)
        })
        .collect()
}

/// Raw stored/confirmed images may predate required literal defaults.
pub fn stored_index_keys(table: &Table, index: &Index, row: &Value, id: &str) -> Vec<Vec<u8>> {
    index_keys(index, &crate::schema::row_image(row, table), id)
}

/// The index's column values from a row image, in component order, the
/// word component skipped; absent optionals are null.
pub fn index_values(index: &Index, row: &Value) -> Vec<Value> {
    if let Some(crate::schema::IndexComponent::Contribution(maintain)) = index.components.first() {
        let mut values = maintain.source_key(row);
        // @ref LLP 3000.007#20.9.3 — expiry follows the group; a string sentinel sorts after every integer instant.
        if let Some(expiry) = index.components.get(1).and_then(|part| part.column()) {
            values.push(match row.field(expiry) { Ok(Value::Int(at)) => Value::Int(*at), _ => Value::String(String::new()) });
        }
        return values;
    }
    index.components.iter().filter_map(|component| component.value(row)).collect()
}

/// The store as the interpreter sees it.
#[derive(Clone, Debug)]
pub enum PrefetchRequest {
    Get { table: String, id: String },
    Lookup { table: String, index: String, key: Vec<Value> },
}

#[derive(Clone, Debug)]
pub enum AcquiredBoundary { Whole, Key(Vec<u8>) }

pub trait Rows {
    fn change_footprint(&self) -> crate::revocation::Footprint { crate::revocation::Footprint { unknown: true, ..Default::default() } }
    /// Record this transaction's change evidence as unknown (LLP 3000.038 §4.2:
    /// a delete's actions publish no footprint of the rows they reached).
    fn widen_change_evidence(&self) {}
    /// A device keeps the floor of settled rows hidden by pending deletions.
    fn provisional_sequence_floor(&self, _parent: &str, _id: &str) -> Result<i64, RuntimeError> { Ok(0) }

    /// Read/advance a parent counter inside the writer's transaction; never a SQL sequence.
    fn sequence_value(&self, _parent: &str, _id: &str) -> Result<i64, RuntimeError> {
        Err(RuntimeError::Store("sequence counter requires a server write transaction".into()))
    }
    fn set_sequence(&self, _parent: &str, _id: &str, _value: i64) -> Result<(), RuntimeError> {
        Err(RuntimeError::Store("sequence counter requires a server write transaction".into()))
    }

    /// Claim an effect's canonical lifetime key inside the current transaction.
    /// Devices discard emits before reaching this operation.
    fn effect_once(&self, _effect: &str, _key: &str) -> Result<bool, RuntimeError> {
        Err(RuntimeError::Store("effect keys require a writable server transaction".into()))
    }

    /// Next overlay metadata id, including deleted rows; no confirmed-history scan.
    fn provisional_id_after(&self, _table: &str, _after: &str) -> Result<Option<String>, RuntimeError> { Ok(None) }

    /// Any touched row, including an empty identity or a provisional deletion.
    fn has_provisional(&self, _table: &str) -> Result<bool, RuntimeError> { Ok(false) }

    /// Ordinary group keys of both base and current overlay images. None means
    /// a touched image has no recoverable group; callers must freeze all groups.
    fn provisional_groups(&self, table: &str, _fields: &[String]) -> Result<Option<Vec<Vec<Value>>>, RuntimeError> {
        Ok(if self.has_provisional(table)? { None } else { Some(Vec::new()) })
    }

    /// Whether the current image comes from the device prediction overlay.
    fn provisional_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { Ok(false) }
    /// A predicted attribution may use only a currently covered target image.
    /// The supplied meter is the device allowance, not the mutation's meter.
    fn recording_covered(&self, _table: &str, _row: &Value, _viewer: &str, _now: i64, _scope: &crate::engine::Authorization, _meter: &mut crate::engine::InternalMeter<'_>) -> Result<bool, RuntimeError> { Ok(false) }
    /// Current acquisition, excluding retained images and partial rejoins.
    fn current_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { Ok(false) }
    fn current_group(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<bool, RuntimeError> { Ok(false) }
    /// The server-selected suffix of a device partition, independent of holdings.
    fn acquired_boundary(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<Option<AcquiredBoundary>, RuntimeError> { Ok(None) }
    /// A device-only fact: this scan pins a delivered-history group it left.
    /// A found row belongs to retained history, without changing whole-query coverage.
    /// Certified departed scopes only; rejoined images belong to the server lane.
    fn search_retained_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { Ok(false) }
    fn retained_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { Ok(false) }
    fn retained_group(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<bool, RuntimeError> { Ok(false) }

    /// Speculative physical reads only; errors, rules and charges stay with
    /// the eventual logical read. Devices and SQLite deliberately do nothing.
    fn prefetch(&self, _requests: &[PrefetchRequest]) {}
    /// Avoid planning and constructing speculative keys on hosts with no fill.
    fn prefetch_enabled(&self) -> bool { false }

    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError>;
    /// The first row whose index components equal `key` exactly.
    fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError>;
    /// Rows under `prefix` in index order, bounded, at most `limit`, each
    /// with its stored key so a cursor can be minted from the last.
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError>;
    /// Compact search candidates: adapters decode only requested fields where
    /// possible. The caller reserves the declared decoder bound before access.
    #[cfg(feature = "server-search")]
    fn scan_selected(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, fields: &[String]) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        self.scan(table, index, prefix, bounds, dir, 1).map(|rows| rows.into_iter().map(|(row,key)| {
            let selected = fields.iter().filter_map(|name| row.field(name).ok().map(|v|(name.clone(),v.clone()))).collect();
            (Value::Row(selected), key)
        }).collect())
    }
    /// Word expansion cannot bound nominal ID payloads from schema alone. A
    /// store must charge before decoding/cloning its fetched row/key and before
    /// result-vector growth. The default refuses before calling an unpriced store.
    /// First index entry only: existence/expiry metadata without decoding a row.
    fn index_head(&self, _table: &str, _index: &str, _prefix: &[Value], _bounds: &Bounds, _dir: Dir) -> Result<Option<Vec<Value>>, RuntimeError> {
        Err(RuntimeError::Store("key-only witness unsupported by this store".into()))
    }
    fn scan_metered(&self, _table: &str, _index_name: &str, _prefix: &[Value], _bounds: &Bounds, _dir: Dir, _limit: usize, _scope: &crate::engine::Authorization, meter: &mut crate::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        meter.heap(u64::MAX)?;
        Err(RuntimeError::Store("word fetch requires a metered store adapter".into()))
    }
    /// How many entries sit under `prefix`, counting at most `limit`.
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError>;
    /// Maintained physical occupancy for a cap on an expiring table. No scan.
    fn cap_count(&self, _table: &str, _by: &[String], _group: &[Value]) -> Result<u64, RuntimeError> {
        Err(RuntimeError::Store("adapter has no maintained cap counts".into()))
    }
    /// Write a row image (a fresh insert when `old` is none); returns the
    /// number of index entries written.
    fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError>;
    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError>;
    /// Whether this store keeps the asset ledger. The server's does; a
    /// device holds none and keeps a row's asset value as it was sent, the
    /// server establishing the facts when the write arrives.
    fn holds_assets(&self) -> bool {
        false
    }
    fn asset(&self, _id: &str) -> Result<Option<Asset>, RuntimeError> {
        Ok(None)
    }
    fn claim_asset(&self, id: &str, _by: &str, _table: &str, _row_id: &str, _column: &str) -> Result<Asset, RuntimeError> {
        Err(RuntimeError::Asset { code: "E_ASSET_UNKNOWN", message: format!("this store keeps no asset ledger; {id} cannot be placed here") })
    }
    fn release_asset(&self, _id: &str, #[cfg(feature = "sqlite")] _table: &str, #[cfg(feature = "sqlite")] _row_id: &str, #[cfg(feature = "sqlite")] _column: &str, _now: i64) -> Result<(), RuntimeError> {
        Ok(())
    }
}

/// The store in memory: rows by (table, id) and index entries by their key
/// bytes, the server's layout without SQLite. For tests of the device path
/// and for a host that keeps a partition on the heap.
#[derive(Debug, Default)]
pub struct MemoryRows {
    sequences: std::cell::RefCell<std::collections::BTreeMap<(String, String), i64>>,
    rows: std::cell::RefCell<std::collections::BTreeMap<(String, String), Value>>,
    entries: std::cell::RefCell<std::collections::BTreeMap<(String, Vec<u8>), String>>,
}

impl MemoryRows {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every row of a table, by id.
    pub fn rows(&self, table: &str) -> Vec<Value> {
        self.rows.borrow().iter().filter(|((t, _), _)| t == table).map(|(_, row)| row.clone()).collect()
    }

    fn range(&self, table: &str, index_name: &str, lo: &[u8], hi: &[u8], dir: Dir, limit: usize) -> Vec<(Value, Vec<u8>)> {
        let ti = format!("{table}.{index_name}");
        let entries = self.entries.borrow();
        let rows = self.rows.borrow();
        let within = entries.range((ti.clone(), lo.to_vec())..(ti, hi.to_vec()));
        let picked: Vec<(Value, Vec<u8>)> = match dir {
            Dir::Asc => within.take(limit).filter_map(|((_, k), id)| rows.get(&(table.to_owned(), id.clone())).map(|row| (row.clone(), k.clone()))).collect(),
            Dir::Desc => within.rev().take(limit).filter_map(|((_, k), id)| rows.get(&(table.to_owned(), id.clone())).map(|row| (row.clone(), k.clone()))).collect(),
        };
        picked
    }
}

impl Rows for MemoryRows {
    fn sequence_value(&self, parent: &str, id: &str) -> Result<i64, RuntimeError> {
        Ok(*self.sequences.borrow().get(&(parent.into(), id.into())).unwrap_or(&0))
    }
    fn set_sequence(&self, parent: &str, id: &str, value: i64) -> Result<(), RuntimeError> {
        self.sequences.borrow_mut().insert((parent.into(), id.into()), value);
        Ok(())
    }
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        Ok(self.rows.borrow().get(&(table.to_owned(), id.to_owned())).cloned())
    }
    fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        if key.len() != index.components.len() {
            return Err(RuntimeError::Schema(format!("point read {table}.{index_name} supplied {} of {} key columns", key.len(), index.components.len())));
        }
        let prefix = key::encode(key);
        Ok(self.range(table, index_name, &prefix, &key::upper_bound(&prefix), Dir::Asc, 1).pop().map(|(row, _)| row))
    }
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        Ok(match scan_range(prefix, bounds, dir) {
            Some((lo, hi)) => self.range(table, index_name, &lo, &hi, dir, limit),
            None => Vec::new(),
        })
    }
    fn index_head(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir) -> Result<Option<Vec<Value>>, RuntimeError> {
        let Some((lo,hi)) = scan_range(prefix,bounds,dir) else { return Ok(None); };
        let ti = format!("{table}.{index}");
        let entries = self.entries.borrow();
        let mut range = entries.range((ti.clone(),lo)..(ti,hi));
        Ok((if dir == Dir::Asc { range.next() } else { range.next_back() }).and_then(|((_,key),_)| key::decode(key)))
    }
    fn scan_metered(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, scope: &crate::engine::Authorization, meter: &mut crate::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        // @ref LLP 3000.007#20.24.5 — the stores' logical charge, priced on each row's canonical image.
        word_heap::scan_open(meter, table, index_name, prefix, bounds, scope)?;
        let mut guard = word_heap::StoreGuard::open(meter, 64 << 20);
        let Some((lo, hi)) = scan_range(prefix, bounds, dir) else { return Ok(Vec::new()) };
        let ti = format!("{table}.{index_name}");
        let entries = self.entries.borrow();
        let rows = self.rows.borrow();
        let within = entries.range((ti.clone(), lo)..(ti, hi));
        let mut out = Vec::new();
        let mut pick = |((_, key), id): (&(String, Vec<u8>), &String)| -> Result<(), RuntimeError> {
            if let Some(row) = rows.get(&(table.to_owned(), id.clone())) {
                let additional = word_heap::scan_value_entry(meter, &mut guard, out.len(), out.capacity(), row, key)?;
                if additional != 0 { out.reserve_exact(additional); }
                out.push((row.clone(), key.clone()));
            }
            Ok(())
        };
        match dir { Dir::Asc => { for entry in within.take(limit) { pick(entry)?; } }, Dir::Desc => { for entry in within.rev().take(limit) { pick(entry)?; } } }
        Ok(out)
    }
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> {
        let base = key::encode(prefix);
        Ok(self.range(table, index_name, &base, &key::upper_bound(&base), Dir::Asc, limit as usize).len() as u64)
    }
    fn cap_count(&self, table: &str, by: &[String], group: &[Value]) -> Result<u64, RuntimeError> {
        Ok(self.entries.borrow().get(&(caps::slot(table), caps::key(by, group))).map_or(0, |n| n.parse().expect("cap count")))
    }
    fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        let id = row.field("id")?.as_str()?.to_owned();
        let keys = index_write(table_name, table, row, old, &id)?;
        let mut entries = self.entries.borrow_mut();
        let mut written = 0;
        for IndexWrite { name, before, after } in keys {
            let ti = format!("{table_name}.{name}");
            for key in before.iter().filter(|key| !after.contains(key)) {
                entries.remove(&(ti.clone(), key.clone()));
                written += 1;
            }
            for key in after.iter().filter(|key| !before.contains(key)) {
                entries.insert((ti.clone(), key.clone()), id.clone());
                written += 1;
            }
        }
        for (key, delta) in caps::deltas(table, old, Some(row)) {
            let key = (caps::slot(table_name), key);
            match caps::next(entries.get(&key).map(String::as_str), delta) {
                Some(n) => { entries.insert(key, n); }
                None => { entries.remove(&key); }
            }
            written += 1;
        }
        self.rows.borrow_mut().insert((table_name.to_owned(), id), row.clone());
        Ok(written)
    }
    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        let id = old.field("id")?.as_str()?.to_owned();
        let mut entries = self.entries.borrow_mut();
        let mut removed = 0;
        for (index_name, index) in &table.indexes {
            for key in stored_index_keys(table, index, old, &id) {
                entries.remove(&(format!("{table_name}.{index_name}"), key));
                removed += 1;
            }
        }
        for (key, delta) in caps::deltas(table, Some(old), None) {
            let key = (caps::slot(table_name), key);
            match caps::next(entries.get(&key).map(String::as_str), delta) {
                Some(n) => { entries.insert(key, n); }
                None => { entries.remove(&key); }
            }
            removed += 1;
        }
        self.rows.borrow_mut().remove(&(table_name.to_owned(), id));
        Ok(removed)
    }
}

#[cfg(test)]
mod index_encoding_tests {
    use super::*;
    use crate::{maintain::CalendarKey, schema::IndexComponent, value::object};

    #[test]
    fn borrowed_columns_keep_the_persisted_composite_key_bytes() {
        let mut index = Index::of(&["value", "absent"], false);
        index.components.push(IndexComponent::Calendar(CalendarKey {
            function: "hour".into(), column: "at".into(), millis: 3_600_000, offset: 1000,
        }));
        for value in [Value::Null, Value::Bool(false), Value::Bool(true), Value::Int(i64::MIN),
            Value::Int(i64::MAX), Value::String("\0é🦀\0".into()), Value::Id("id\0tail".into()),
            Value::Bytes(vec![0, 255, 0]), Value::Array(vec![Value::Int(1)])] {
            let row = object([("value", value.clone()), ("at", Value::Int(-1))]);
            // Independent expected tuple: optional missing column is null,
            // the offset hour is -1, and the suffix is an Id, not a String.
            let expected = key::encode(&[value, Value::Null, Value::Int(-1), Value::Id("row\0é".into())]);
            assert_eq!(index_key(&index, &row, "row\0é"), expected);
        }
    }
}
