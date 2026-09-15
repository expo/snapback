//! What the interpreter needs of a store: rows by id, index lookups and
//! ordered scans, writes that keep the indexes. The server's SQLite
//! transaction implements it; a device implements it over its own store —
//! the same SQLite layout through the same code on a native host, or the
//! host's store through callbacks on the web — so one interpreter runs on
//! every host and the language is bound once.

use crate::assets::Asset;
use crate::error::RuntimeError;
use crate::key;
use crate::schema::{Index, Table};
use crate::value::Value;

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
    if let Some(crate::schema::IndexComponent::Contribution(maintain)) = index.components.first() { return maintain.source_key(row); }
    index.columns().iter().map(|column| row.field(column).cloned().unwrap_or(Value::Null)).collect()
}

/// The store as the interpreter sees it.
pub trait Rows {
    /// A device-only fact: this scan pins a delivered-history group it left.
    fn retained_group(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<bool, RuntimeError> { Ok(false) }

    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError>;
    /// The first row whose index components equal `key` exactly.
    fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError>;
    /// Rows under `prefix` in index order, bounded, at most `limit`, each
    /// with its stored key so a cursor can be minted from the last.
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError>;
    /// How many entries sit under `prefix`, counting at most `limit`.
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError>;
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
    fn release_asset(&self, _id: &str, _now: i64) -> Result<(), RuntimeError> {
        Ok(())
    }
}

/// The store in memory: rows by (table, id) and index entries by their key
/// bytes, the server's layout without SQLite. For tests of the device path
/// and for a host that keeps a partition on the heap.
#[derive(Debug, Default)]
pub struct MemoryRows {
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
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> {
        let base = key::encode(prefix);
        Ok(self.range(table, index_name, &base, &key::upper_bound(&base), Dir::Asc, limit as usize).len() as u64)
    }
    fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        let id = row.field("id")?.as_str()?.to_owned();
        let mut entries = self.entries.borrow_mut();
        let mut written = 0;
        for (index_name, index) in &table.indexes {
            let ti = format!("{table_name}.{index_name}");
            if let Some(old) = old {
                for key in index_keys(index, old, &id) {
                    entries.remove(&(ti.clone(), key));
                }
            }
            for key in index_keys(index, row, &id) {
                entries.insert((ti.clone(), key), id.clone());
                written += 1;
            }
        }
        self.rows.borrow_mut().insert((table_name.to_owned(), id), row.clone());
        Ok(written)
    }
    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        let id = old.field("id")?.as_str()?.to_owned();
        let mut entries = self.entries.borrow_mut();
        let mut removed = 0;
        for (index_name, index) in &table.indexes {
            for key in index_keys(index, old, &id) {
                entries.remove(&(format!("{table_name}.{index_name}"), key));
                removed += 1;
            }
        }
        self.rows.borrow_mut().remove(&(table_name.to_owned(), id));
        Ok(removed)
    }
}
