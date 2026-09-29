//! The device's store in memory: the rows and their index entries, the
//! metadata, the outbox, the confirmed images and the staged snapshot in
//! B-trees, with transactions as an undo log and savepoints as marks in
//! it. Every commit reports what it changed, so a host that cannot give
//! the device synchronous durable storage — the web, where IndexedDB is
//! asynchronous — keeps the partition here and writes the changes behind
//! each call; on the next open it hands them back, and the store is what
//! it was. Index entries are not reported: they are rebuilt on install.

use crate::store::{DeviceStore, DeviceTx};
use serde::{Deserialize, Serialize};
use snapback4_core::error::RuntimeError;
use snapback4_core::key;
use snapback4_core::rows::caps;
use snapback4_core::rows::{Bounds, Dir, Rows, stored_index_keys, scan_range};
use snapback4_core::schema::{Index, Schema, Table};
use snapback4_core::value::Value;
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;
#[path = "memory_key.rs"]
mod compact_key;
use compact_key::Key;
#[path = "memory_index.rs"]
mod compact_index;
type IndexKey = (String, Key);
type Entries = BTreeMap<String, compact_index::Index>;
#[cfg(test)]
#[path = "memory_tests.rs"]
mod tests;

/// One change to what the store keeps, for the host to persist: the store
/// (`r` rows, `m` metadata, `o` outbox, `b` confirmed images, `s` staged
/// snapshot), the key, and the value — `None` removes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Change {
    pub s: char,
    pub k: String,
    pub v: Option<String>,
}

#[derive(Clone)]
struct Image { text: Rc<str>, start: usize, end: usize }
impl From<String> for Image {
    fn from(text: String) -> Self { let end = text.len(); Self { text: text.into(), start: 0, end } }
}
impl std::ops::Deref for Image {
    type Target = str;
    fn deref(&self) -> &str { &self.text[self.start..self.end] }
}
impl Serialize for Image {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> { self.deref_text().serialize(s) }
}
impl Image {
    fn deref_text(&self) -> &str { self }
    fn staged(text: Rc<str>) -> Option<Self> {
        if !text.starts_with("{\"row\":{") { return None; }
        let (mut depth, mut quoted, mut escaped) = (0, false, false);
        for (at, byte) in text.bytes().enumerate().skip(7) {
            if quoted {
                if escaped { escaped = false; }
                else if byte == b'\\' { escaped = true; }
                else if byte == b'"' { quoted = false; }
                continue;
            }
            match byte { b'"' => quoted = true, b'{' => depth += 1, b'}' => depth -= 1, _ => {} }
            if depth == 0 {
                let end = at + 1;
                return matches!(&text[end..], ",\"acquired\":true}" | ",\"acquired\":false}")
                    .then(|| Self { text, start: 7, end });
            }
        }
        None
    }
}

#[derive(Clone, Serialize)]
struct PendingChange {
    s: char,
    k: String,
    v: Option<Image>,
}

impl From<Change> for PendingChange {
    fn from(change: Change) -> Self { Self { s: change.s, k: change.k, v: change.v.map(Into::into) } }
}
impl From<PendingChange> for Change {
    fn from(change: PendingChange) -> Self { Self { s: change.s, k: change.k, v: change.v.map(|v| v.to_string()) } }
}

#[derive(Clone, Default)]
struct State {
    rows: BTreeMap<(String, String), Image>,
    entries: Entries,
    meta: BTreeMap<String, String>,
    outbox: BTreeMap<String, (u64, String)>,
    // The same image map as rows, carrying the unchanged Option<String> JSON.
    base: BTreeMap<(String, String), Image>,
    staged: BTreeMap<String, (String, Rc<str>)>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Dirty {
    Row(String, String),
    Meta(String),
    Outbox(String),
    Base(String, String),
    Staged(String),
}

enum Undo {
    Row((String, String), Option<Image>),
    Entry(IndexKey, Option<Rc<str>>),
    Entries(Entries),
    Rows(BTreeMap<(String, String), Image>),
    Meta(String, Option<String>),
    Outbox(String, Option<(u64, String)>),
    Base((String, String), Option<Image>),
    Staged(String, Option<(String, Rc<str>)>),
}

const SCHEMA_HASH: &str = "memory:schema";

#[derive(Default)]
pub struct MemoryStore {
    state: RefCell<State>,
    schema: Option<Schema>,
    changes: RefCell<Vec<PendingChange>>,
    drained: Cell<usize>,
}

fn row_key(table: &str, id: &str) -> String {
    snapback4_core::json_codec::to_text(&(table, id)).expect("a key")
}

fn parse_row_key(key: &str) -> Result<(String, String), RuntimeError> {
    snapback4_core::json_codec::from_text(key).map_err(|e| RuntimeError::Store(format!("a kept row key does not parse: {e}")))
}

fn stored<T: Serialize + ?Sized>(value: &T) -> String {
    snapback4_core::json_codec::to_text(value).expect("a stored value")
}

fn parsed<T: for<'de> Deserialize<'de>>(what: &str, text: &str) -> Result<T, RuntimeError> {
    snapback4_core::json_codec::from_text(text).map_err(|e| RuntimeError::Store(format!("a kept {what} does not parse: {e}")))
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Hand back what the host kept: the changes every commit reported,
    /// in order, before the schema is installed.
    pub fn load(&mut self, changes: impl IntoIterator<Item = Change>) -> Result<(), RuntimeError> {
        let mut state = self.state.borrow_mut();
        for change in changes {
            match change.s {
                'r' => {
                    let key = parse_row_key(&change.k)?;
                    match change.v {
                        Some(image) => {
                            let row: Value = parsed("row", &image)?;
                            state.rows.insert(key, Image::from(stored(&row)));
                        }
                        None => {
                            state.rows.remove(&key);
                        }
                    }
                }
                'm' => match change.v {
                    Some(value) => {
                        state.meta.insert(change.k, value);
                    }
                    None => {
                        state.meta.remove(&change.k);
                    }
                },
                'o' => match change.v {
                    Some(entry) => {
                        #[derive(Deserialize)]
                        struct Seq {
                            seq: u64,
                        }
                        let seq: Seq = parsed("outbox entry", &entry)?;
                        state.outbox.insert(change.k, (seq.seq, entry));
                    }
                    None => {
                        state.outbox.remove(&change.k);
                    }
                },
                'b' => {
                    let key = parse_row_key(&change.k)?;
                    match change.v {
                        Some(image) => {
                            let image: Option<String> = parsed("image", &image)?;
                            state.base.insert(key, stored(&image).into());
                        }
                        None => {
                            state.base.remove(&key);
                        }
                    }
                }
                's' => match change.v {
                    Some(staged) => {
                        state.staged.insert(change.k, parsed("staged row", &staged)?);
                    }
                    None => {
                        state.staged.remove(&change.k);
                    }
                },
                other => return Err(RuntimeError::Store(format!("a kept change names store {other:?}"))),
            }
        }
        Ok(())
    }

    /// The changes committed since the last drain, for the host to persist.
    pub fn drain(&self) -> Vec<Change> {
        std::mem::take(&mut *self.changes.borrow_mut()).into_iter().skip(self.drained.replace(0)).map(Into::into).collect()
    }

    /// The JS bridge collects these pieces into the same strict transaction.
    pub fn drain_chunk(&self) -> String {
        let mut changes = self.changes.borrow_mut();
        let start = self.drained.get();
        let mut bytes = 0;
        let count = changes[start..].iter().take(512).take_while(|c| {
            let take = bytes < 256 * 1024;
            bytes += c.k.len() + c.v.as_ref().map_or(0, |v| v.len()) + 32;
            take
        }).count();
        let text = stored(&changes[start..start+count]);
        for change in &mut changes[start..start+count] { change.v = None; change.k.clear(); }
        if start + count == changes.len() { *changes = Vec::new(); self.drained.set(0); }
        else { self.drained.set(start + count); }
        text
    }

    /// Everything the store keeps, as the changes that would rebuild it.
    pub fn export(&self) -> Vec<Change> {
        let state = self.state.borrow();
        let mut out = Vec::new();
        for ((table, id), row) in &state.rows {
            out.push(Change { s: 'r', k: row_key(table, id), v: Some(row.to_string()) });
        }
        for (key, value) in &state.meta {
            out.push(Change { s: 'm', k: key.clone(), v: Some(value.clone()) });
        }
        for (id, (_, entry)) in &state.outbox {
            out.push(Change { s: 'o', k: id.clone(), v: Some(entry.clone()) });
        }
        for ((table, id), image) in &state.base {
            out.push(Change { s: 'b', k: row_key(table, id), v: Some(image.to_string()) });
        }
        for (key, staged) in &state.staged {
            out.push(Change { s: 's', k: key.clone(), v: Some(stored(staged)) });
        }
        out
    }

    // Check before publishing any metadata or clearing entries. The actual
    // rebuild remains infallible; charge both this pass and its evaluation.
    // @ref LLP 3000.007#20.9.3 — contribution-format adoption uses bounded work chunks on the memory host too.
    fn check_contribution_rebuild(&self, schema: &Schema) -> Result<(), RuntimeError> {
        use snapback4_core::{meter::{Meter, Cut, Ceilings}, error::MeterKind, schema::IndexComponent};
        let state = self.state.borrow();
        let mut ledger = snapback4_core::engine::InternalLedger::new(Meter::new(Ceilings::job(), Cut::Abort));
        for (n, ((table_name, id), row)) in state.rows.iter().enumerate() {
            if n % 32 == 0 { ledger = snapback4_core::engine::InternalLedger::new(Meter::new(Ceilings::job(), Cut::Abort)); }
            let Some(table) = schema.table(table_name) else { continue };
            if !table.indexes.values().any(|index| matches!(index.components.first(), Some(IndexComponent::Contribution(_)))) { continue; }
            let row: Value = parsed("row", row)?;
            ledger.run(|meter, scope| {
            for (name, index) in &table.indexes {
                if let Some(IndexComponent::Contribution(maintain)) = index.components.first() {
                    meter.at(&format!("adopt {table_name}.{name}"));
                    meter.scratch(|meter| {
                        meter.charge(MeterKind::Examined, 1)?;
                        meter.step(maintain.evaluation_steps().saturating_mul(2))?;
                        row.retained_internal(scope).times(4).fixed(4096).charge(meter, scope)?;
                        // At most one physical contribution per row, even when
                        // its predicate will exclude it from the rebuilt index.
                        meter.charge(MeterKind::IndexEntries, 1)?;
                        for key in stored_index_keys(table, index, &row, &id) {
                            if key.len() > snapback4_core::rows::MAX_INDEX_KEY_BYTES {
                                return Err(snapback4_core::rows::index_key_refusal(table_name, name, 1));
                            }
                        }
                        Ok::<_, RuntimeError>(())
                    })?;
                }
            }
            Ok::<_, RuntimeError>(())
            })?;
        }
        Ok(())
    }

    fn rebuild_entries(state: &mut State, schema: &Schema) {
        state.entries.clear();
        for ((table_name, id), row) in &state.rows {
            let Some(table) = schema.table(table_name) else { continue };
            let row: Value = parsed("row", row).expect("validated memory row");
            for (key, delta) in caps::deltas(table, None, Some(&row)) {
                let key = (caps::slot(table_name), Key::plain(&key));
                let count = caps::next(state.entries.get(&key.0).and_then(|index| index.get(&key.1)).map(|s| s.as_ref()), delta).expect("increased count");
                state.entries.entry(key.0).or_default().insert(key.1, count.into());
            }
            let tails = Key::tails(id);
            let id: Rc<str> = id.as_str().into();
            for (index_name, index) in &table.indexes {
                for key in stored_index_keys(table, index, &row, &id) {
                    state.entries.entry(format!("{table_name}.{index_name}")).or_default().insert(Key::packed(key, &tails), id.clone());
                }
            }
        }
    }
}

#[cfg(feature = "native")]
#[path = "memory_server.rs"]
mod server;

/// A row projected onto its table: columns the schema no longer has go,
/// columns it gained are materialized by the runner. `pending` is the device's own mark on
/// a predicted row, not a column; it stays.
fn project(row: &mut Value, table: &Table) -> bool {
    let Value::Row(fields) = row else { return false };
    let before = fields.len();
    fields.retain(|column, _| column == "pending" || table.columns.contains_key(column));
    fields.len() != before
}

// @ref LLP 3000.007#20.4 — retain the durable image, decode only a bounded read page.
// Raw rows remain tagged JSON, so restoration and format-3 persistence keep
// their existing bytes and interpretation. Indexes are built from Value once.
fn project_image(image: &mut Image, table: &Table) -> bool {
    let mut row: Value = parsed("row", image).expect("validated memory row");
    if !project(&mut row, table) { return false; }
    *image = Image::from(stored(&row));
    true
}

impl DeviceStore for MemoryStore {
    #[cfg(not(target_arch = "wasm32"))]
    fn witness_count(&self, table: &str) -> Result<u64, RuntimeError> {
        Ok(self.state.borrow().rows.range((table.to_owned(), String::new())..).take_while(|((t, _), _)| t == table).count() as u64)
    }
    type Tx<'a> = MemoryTx<'a>;

    fn install_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>) -> Result<(), RuntimeError> {
        for (key, value) in expected {
            if &self.meta(key)? != value { return Err(RuntimeError::Generation("the backend adoption capture is obsolete; retry sync".into())); }
        }
        self.install(schema, metadata, reset)
    }
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> {
        if !reset { self.check_contribution_rebuild(schema)?; }
        // Installation below is infallible and memory has one exclusive owner.
        // Run fallible cleanup first; the host persists this whole call together.
        let tx = self.transaction()?;
        crate::device::reset_for_install(&tx, metadata, reset)?;
        tx.commit()?;
        let mut state = self.state.borrow_mut();
        let mut changes = self.changes.borrow_mut();
        for (key, value) in metadata {
            if key.ends_with(':') {
                let keys: Vec<_> = state.meta.range(key.clone()..).take_while(|(k, _)| k.starts_with(key)).map(|(k, _)| k.clone()).collect();
                for k in keys { state.meta.remove(&k); changes.push(Change { s: 'm', k, v: None }.into()); }
                continue;
            }
            state.meta.insert(key.clone(), value.clone());
            changes.push(Change { s: 'm', k: key.clone(), v: Some(value.clone()) }.into());
        }
        if reset {
            for (table, id) in state.rows.keys() {
                changes.push(Change { s: 'r', k: row_key(table, id), v: None }.into());
            }
            for (table, id) in state.base.keys() {
                changes.push(Change { s: 'b', k: row_key(table, id), v: None }.into());
            }
            for key in state.staged.keys() {
                changes.push(Change { s: 's', k: key.clone(), v: None }.into());
            }
            state.rows.clear();
            state.base.clear();
            state.staged.clear();
        }
        // Rows are projected onto the schema only when it changed since they
        // were kept (the hash rides in the metadata); index entries are
        // rebuilt on every install.
        let hash = schema.hash();
        if state.meta.get(SCHEMA_HASH) != Some(&hash) {
            let mut rows = std::mem::take(&mut state.rows);
            rows.retain(|(table, id), _| {
                let kept = schema.tables.contains_key(table);
                if !kept {
                    changes.push(Change { s: 'r', k: row_key(table, id), v: None }.into());
                }
                kept
            });
            for ((table_name, id), row) in rows.iter_mut() {
                if let Some(table) = schema.table(table_name)
                    && project_image(row, table)
                {
                    changes.push(Change { s: 'r', k: row_key(table_name, id), v: Some(row.to_string()) }.into());
                }
            }
            state.rows = rows;
            state.meta.insert(SCHEMA_HASH.to_owned(), hash.clone());
            changes.push(Change { s: 'm', k: SCHEMA_HASH.to_owned(), v: Some(hash) }.into());
        }
        Self::rebuild_entries(&mut state, schema);
        self.schema = Some(schema.clone());
        Ok(())
    }

    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.state.borrow().meta.get(key).cloned())
    }

    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.state.borrow_mut().meta.insert(key.to_owned(), value.to_owned());
        self.changes.borrow_mut().push(Change { s: 'm', k: key.to_owned(), v: Some(value.to_owned()) }.into());
        Ok(())
    }

    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> {
        Ok(MemoryTx { store: self, undo: RefCell::new(Vec::new()), savepoints: RefCell::new(Vec::new()), dirty: RefCell::new(BTreeSet::new()), replacing: Cell::new(false) })
    }
}

pub struct MemoryTx<'a> {
    store: &'a MemoryStore,
    undo: RefCell<Vec<Undo>>,
    savepoints: RefCell<Vec<(String, usize)>>,
    dirty: RefCell<BTreeSet<Dirty>>,
    replacing: Cell<bool>,
}

impl MemoryTx<'_> {
    fn put_image(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>, image: Image) -> Result<u64, RuntimeError> {
        let id = row.field("id")?.as_str()?.to_owned();
        let keys = snapback4_core::rows::index_write(table_name, table, row, old, &id)?;
        let tails = Key::tails(&id);
        let indexed_id: Rc<str> = id.as_str().into();
        let mut written = 0;
        for snapback4_core::rows::IndexWrite { name, before, after } in keys {
            let ti = format!("{table_name}.{name}");
            for key in before.iter().filter(|key| !after.contains(key)) {
                self.set_entry((ti.clone(), Key::plain(key)), None);
                written += 1;
            }
            for key in after.into_iter().filter(|key| !before.contains(key)) {
                let key = Key::packed(key, &tails);
                if self.replacing.get() {
                    self.store.state.borrow_mut().entries.entry(ti.clone()).or_default().push_unsorted(key, indexed_id.clone());
                } else { self.set_entry((ti.clone(), key), Some(indexed_id.clone())); }
                written += 1;
            }
        }
        written += self.update_cap_counts(table_name, table, old, Some(row));
        self.set_row((table_name.to_owned(), id), Some(image));
        Ok(written)
    }

    fn update_cap_counts(&self, table_name: &str, table: &Table, old: Option<&Value>, new: Option<&Value>) -> u64 {
        let changes = caps::deltas(table, old, new);
        for (key, delta) in &changes {
            let key = (caps::slot(table_name), Key::plain(key));
            let value = caps::next(self.store.state.borrow().entries.get(&key.0).and_then(|index| index.get(&key.1)).map(|s| s.as_ref()), *delta);
            self.set_entry(key, value.map(Into::into));
        }
        changes.len() as u64
    }

    fn set_row(&self, key: (String, String), value: Option<Image>) {
        let mut state = self.store.state.borrow_mut();
        let old = match value {
            Some(row) => state.rows.insert(key.clone(), row),
            None => state.rows.remove(&key),
        };
        if !self.replacing.get() { self.undo.borrow_mut().push(Undo::Row(key.clone(), old)); }
        self.dirty.borrow_mut().insert(Dirty::Row(key.0, key.1));
    }
    fn set_entry(&self, key: IndexKey, id: Option<Rc<str>>) {
        let mut state = self.store.state.borrow_mut();
        let undo_key = (!self.replacing.get()).then(|| key.clone());
        let old = match id {
            Some(id) => state.entries.entry(key.0).or_default().insert(key.1, id),
            None => state.entries.get_mut(&key.0).and_then(|index| index.remove(&key.1)),
        };
        if let Some(key) = undo_key { self.undo.borrow_mut().push(Undo::Entry(key, old)); }
    }
    fn set_meta_value(&self, key: &str, value: Option<String>) {
        let mut state = self.store.state.borrow_mut();
        let old = match value {
            Some(value) => state.meta.insert(key.to_owned(), value),
            None => state.meta.remove(key),
        };
        self.undo.borrow_mut().push(Undo::Meta(key.to_owned(), old));
        self.dirty.borrow_mut().insert(Dirty::Meta(key.to_owned()));
    }
    fn set_outbox(&self, id: &str, value: Option<(u64, String)>) {
        let mut state = self.store.state.borrow_mut();
        let old = match value {
            Some(value) => state.outbox.insert(id.to_owned(), value),
            None => state.outbox.remove(id),
        };
        self.undo.borrow_mut().push(Undo::Outbox(id.to_owned(), old));
        self.dirty.borrow_mut().insert(Dirty::Outbox(id.to_owned()));
    }
    fn set_base(&self, key: (String, String), value: Option<Image>) {
        let mut state = self.store.state.borrow_mut();
        let old = match value {
            Some(image) => state.base.insert(key.clone(), image),
            None => state.base.remove(&key),
        };
        self.undo.borrow_mut().push(Undo::Base(key.clone(), old));
        self.dirty.borrow_mut().insert(Dirty::Base(key.0, key.1));
    }
    fn set_staged(&self, key: &str, value: Option<(String, Rc<str>)>) {
        let mut state = self.store.state.borrow_mut();
        let old = match value {
            Some(value) => state.staged.insert(key.to_owned(), value),
            None => state.staged.remove(key),
        };
        self.undo.borrow_mut().push(Undo::Staged(key.to_owned(), old));
        self.dirty.borrow_mut().insert(Dirty::Staged(key.to_owned()));
    }

    /// Undo everything after `mark`, newest first.
    fn unwind(&self, mark: usize) {
        let mut undo = self.undo.borrow_mut();
        let mut state = self.store.state.borrow_mut();
        while undo.len() > mark {
            match undo.pop().expect("an undo") {
                Undo::Row(key, old) => {
                    match old {
                        Some(row) => state.rows.insert(key, row),
                        None => state.rows.remove(&key),
                    };
                }
                Undo::Entry(key, old) => {
                    match old {
                        Some(id) => state.entries.entry(key.0).or_default().insert(key.1, id),
                        None => state.entries.get_mut(&key.0).and_then(|index| index.remove(&key.1)),
                    };
                }
                Undo::Entries(entries) => state.entries = entries,
                Undo::Rows(rows) => state.rows = rows,
                Undo::Meta(key, old) => {
                    match old {
                        Some(value) => state.meta.insert(key, value),
                        None => state.meta.remove(&key),
                    };
                }
                Undo::Outbox(id, old) => {
                    match old {
                        Some(value) => state.outbox.insert(id, value),
                        None => state.outbox.remove(&id),
                    };
                }
                Undo::Base(key, old) => {
                    match old {
                        Some(image) => state.base.insert(key, image),
                        None => state.base.remove(&key),
                    };
                }
                Undo::Staged(key, old) => {
                    match old {
                        Some(value) => state.staged.insert(key, value),
                        None => state.staged.remove(&key),
                    };
                }
            }
        }
    }

    fn range(&self, table: &str, index_name: &str, lo: &[u8], hi: &[u8], dir: Dir, limit: usize) -> Vec<(Value, Vec<u8>)> {
        let state = self.store.state.borrow();
        let ti = format!("{table}.{index_name}");
        let Some(index) = state.entries.get(&ti) else { return Vec::new() };
        let within = index.range(Key::plain(lo)..Key::plain(hi));
        let pick = |(k, id): (&Key, &Rc<str>)| state.rows.get(&(table.to_owned(), id.to_string())).map(|row| (parsed("row", row).expect("validated memory row"), k.bytes()));
        match dir {
            Dir::Asc => within.take(limit).filter_map(pick).collect(),
            Dir::Desc => within.rev().take(limit).filter_map(pick).collect(),
        }
    }
}

impl Rows for MemoryTx<'_> {
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.store.state.borrow().rows.get(&(table.to_owned(), id.to_owned())).map(|row| parsed("row", row)).transpose()
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
        let state = self.store.state.borrow();
        let Some(index) = state.entries.get(&ti) else { return Ok(None) };
        let mut range = index.range(Key::plain(&lo)..Key::plain(&hi));
        Ok((if dir == Dir::Asc { range.next() } else { range.next_back() }).and_then(|(key,_)|key::decode(&key.bytes())))
    }
    fn scan_metered(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, scope: &snapback4_core::engine::Authorization, meter: &mut snapback4_core::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        use snapback4_core::rows::word_heap;
        word_heap::range(prefix, bounds, scope).charge(meter,scope)?;
        meter.heap(2 * word_heap::allocation(table.len() + index_name.len() + 1))?;
        let Some((lo, hi)) = scan_range(prefix, bounds, dir) else { return Ok(Vec::new()) };
        meter.heap(word_heap::allocation(lo.len()) + word_heap::allocation(hi.len()))?;
        let ti = format!("{table}.{index_name}");
        let state = self.store.state.borrow();
        let Some(index) = state.entries.get(&ti) else { return Ok(Vec::new()) };
        let within = index.range(Key::plain(&lo)..Key::plain(&hi));
        let mut out = Vec::new();
        let mut pick = |(key, id): (&Key, &Rc<str>)| -> Result<(), RuntimeError> {
            meter.heap(word_heap::text(table) + word_heap::text(id))?;
            if let Some(row) = state.rows.get(&(table.to_owned(), id.to_string())) {
                word_heap::stored_row(row, scope).charge(meter, scope)?;
                meter.heap(word_heap::allocation(key.len()))?;
                if out.len() == out.capacity() {
                    let next = out.capacity().saturating_mul(2).max(1);
                    meter.heap(word_heap::slots::<(Value, Vec<u8>)>(next))?;
                    out.reserve_exact(next - out.len());
                }
                out.push((parsed("row", row)?, key.bytes()));
            }
            Ok(())
        };
        match dir { Dir::Asc => { for entry in within.take(limit) { pick(entry)?; } }, Dir::Desc => { for entry in within.rev().take(limit) { pick(entry)?; } } }
        Ok(out)
    }
    fn cap_count(&self, table: &str, by: &[String], group: &[Value]) -> Result<u64, RuntimeError> {
        Ok(self.store.state.borrow().entries.get(&caps::slot(table)).and_then(|index| index.get(&Key::plain(&caps::key(by, group)))).map_or(0, |n| n.parse().expect("cap count")))
    }
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> {
        let base = key::encode(prefix);
        let state = self.store.state.borrow();
        Ok(state.entries.get(&format!("{table}.{index_name}")).map_or(0, |index|
            index.range(Key::plain(&base)..Key::plain(&key::upper_bound(&base))).take(limit as usize).count() as u64))
    }
    fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        self.put_image(table_name, table, row, old, stored(row).into())
    }
    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        let id = old.field("id")?.as_str()?.to_owned();
        let mut removed = 0;
        for (index_name, index) in &table.indexes {
            for key in stored_index_keys(table, index, old, &id) {
                self.set_entry((format!("{table_name}.{index_name}"), Key::plain(&key)), None);
                removed += 1;
            }
        }
        removed += self.update_cap_counts(table_name, table, Some(old), None);
        self.set_row((table_name.to_owned(), id), None);
        Ok(removed)
    }
}

impl DeviceTx for MemoryTx<'_> {
    fn commit(self) -> Result<(), RuntimeError> {
        let state = self.store.state.borrow();
        let mut changes = self.store.changes.borrow_mut();
        for dirty in self.dirty.borrow().iter() {
            changes.push(match dirty {
                Dirty::Row(table, id) => PendingChange { s: 'r', k: row_key(table, id), v: state.rows.get(&(table.clone(), id.clone())).cloned() },
                Dirty::Meta(key) => Change { s: 'm', k: key.clone(), v: state.meta.get(key).cloned() }.into(),
                Dirty::Outbox(id) => Change { s: 'o', k: id.clone(), v: state.outbox.get(id).map(|(_, entry)| entry.clone()) }.into(),
                Dirty::Base(table, id) => Change { s: 'b', k: row_key(table, id), v: state.base.get(&(table.clone(), id.clone())).map(|image| image.to_string()) }.into(),
                Dirty::Staged(key) => Change { s: 's', k: key.clone(), v: state.staged.get(key).map(stored) }.into(),
            });
        }
        // Committed: there is nothing left to undo when this drops.
        self.undo.borrow_mut().clear();
        self.savepoints.borrow_mut().clear();
        Ok(())
    }
    fn rollback(self) -> Result<(), RuntimeError> {
        self.unwind(0);
        Ok(())
    }
    fn savepoint(&self, name: &str) -> Result<(), RuntimeError> {
        let mark = self.undo.borrow().len();
        self.savepoints.borrow_mut().push((name.to_owned(), mark));
        Ok(())
    }
    fn release(&self, name: &str) -> Result<(), RuntimeError> {
        let mut savepoints = self.savepoints.borrow_mut();
        let at = savepoints.iter().rposition(|(n, _)| n == name).ok_or_else(|| RuntimeError::Store(format!("no savepoint {name}")))?;
        savepoints.truncate(at);
        Ok(())
    }
    fn rollback_to(&self, name: &str) -> Result<(), RuntimeError> {
        let mark = {
            let mut savepoints = self.savepoints.borrow_mut();
            let at = savepoints.iter().rposition(|(n, _)| n == name).ok_or_else(|| RuntimeError::Store(format!("no savepoint {name}")))?;
            let mark = savepoints[at].1;
            savepoints.truncate(at);
            mark
        };
        self.unwind(mark);
        Ok(())
    }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.store.state.borrow().meta.get(key).cloned())
    }
    fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.set_meta_value(key, Some(value.to_owned()));
        Ok(())
    }
    fn meta_prefix(&self, prefix: &str) -> Result<Vec<(String, String)>, RuntimeError> {
        Ok(self.store.state.borrow().meta.range(prefix.to_owned()..).take_while(|(k, _)| k.starts_with(prefix)).map(|(k, v)| (k.clone(), v.clone())).collect())
    }
    fn delete_meta(&self, keys: &[&str]) -> Result<(), RuntimeError> {
        for key in keys {
            if key.ends_with(':') {
                for (k, _) in self.meta_prefix(key)? { self.set_meta_value(&k, None); }
            } else { self.set_meta_value(key, None); }
        }
        Ok(())
    }
    fn clear_rows(&self) -> Result<(), RuntimeError> {
        let keys: Vec<(String, String)> = self.store.state.borrow().rows.keys().cloned().collect();
        for key in keys {
            self.set_row(key, None);
        }
        let entries = std::mem::take(&mut self.store.state.borrow_mut().entries);
        self.undo.borrow_mut().push(Undo::Entries(entries));
        Ok(())
    }
    fn replace_rows(&self, load: impl FnOnce() -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
        // @ref LLP 3000.019#3.3 — publication still has one undo boundary;
        // indexes are complete before prediction replay or any query can read.
        let mut state = self.store.state.borrow_mut();
        let rows = std::mem::take(&mut state.rows);
        for (table, id) in rows.keys() { self.dirty.borrow_mut().insert(Dirty::Row(table.clone(), id.clone())); }
        self.undo.borrow_mut().push(Undo::Rows(rows));
        self.undo.borrow_mut().push(Undo::Entries(std::mem::take(&mut state.entries)));
        drop(state);
        self.replacing.set(true);
        let result = load();
        self.replacing.set(false);
        if result.is_ok() {
            let mut state = self.store.state.borrow_mut();
            for index in state.entries.values_mut() { index.finish(); }
        }
        result
    }

    fn put_staged(&self, key: &str, name: &str, table: &Table, row: &Value) -> Result<u64, RuntimeError> {
        // Canonical stages can share their row substring through publication,
        // undo and draining. Noncanonical format-3 images use the same codec.
        let image = self.store.state.borrow().staged.get(key)
            .and_then(|(_, text)| Image::staged(text.clone())).unwrap_or_else(|| stored(row).into());
        self.put_image(name, table, row, None, image)
    }

    fn outbox_insert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError> {
        {
            let state = self.store.state.borrow();
            if state.outbox.contains_key(id) {
                return Err(RuntimeError::Store(format!("the outbox already holds {id}")));
            }
            if state.outbox.values().any(|(held, _)| *held == seq) {
                return Err(RuntimeError::Store(format!("the outbox already holds submission {seq}")));
            }
        }
        self.set_outbox(id, Some((seq, entry.to_owned())));
        Ok(())
    }
    fn outbox_upsert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError> {
        self.set_outbox(id, Some((seq, entry.to_owned())));
        Ok(())
    }
    fn outbox_delete(&self, id: &str) -> Result<(), RuntimeError> {
        if self.store.state.borrow().outbox.contains_key(id) {
            self.set_outbox(id, None);
        }
        Ok(())
    }
    fn outbox_get(&self, id: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.store.state.borrow().outbox.get(id).map(|(_, entry)| entry.clone()))
    }
    fn outbox_entries(&self) -> Result<Vec<String>, RuntimeError> {
        let state = self.store.state.borrow();
        let mut entries: Vec<(u64, &String)> = state.outbox.values().map(|(seq, entry)| (*seq, entry)).collect();
        entries.sort_by_key(|(seq, _)| *seq);
        Ok(entries.into_iter().map(|(_, entry)| entry.clone()).collect())
    }
    fn outbox_max_seq(&self) -> Result<u64, RuntimeError> {
        Ok(self.store.state.borrow().outbox.values().map(|(seq, _)| *seq).max().unwrap_or(0))
    }
    fn base_remember(&self, table: &str, id: &str, image: Option<&str>) -> Result<(), RuntimeError> {
        let key = (table.to_owned(), id.to_owned());
        if !self.store.state.borrow().base.contains_key(&key) {
            self.set_base(key, Some(stored(&image).into()));
        }
        Ok(())
    }
    fn base_entries(&self) -> Result<Vec<(String, String, Option<String>)>, RuntimeError> {
        self.store.state.borrow().base.iter().map(|((table, id), image)| Ok((table.clone(), id.clone(), parsed("image", image)?))).collect()
    }
    fn base_id_after(&self, table: &str, after: &str) -> Result<Option<String>, RuntimeError> {
        let mut next = String::with_capacity(after.len() + 1);
        next.push_str(after);
        next.push('\0'); // The smallest string strictly after this id.
        Ok(self.store.state.borrow().base.range((table.into(), next)..)
            .next().filter(|((name, _), _)| name == table).map(|((_, id), _)| id.clone()))
    }
    fn base_clear(&self) -> Result<(), RuntimeError> {
        let keys: Vec<(String, String)> = self.store.state.borrow().base.keys().cloned().collect();
        for key in keys {
            self.set_base(key, None);
        }
        Ok(())
    }
    fn staged_put(&self, key: &str, table: &str, image: &str) -> Result<(), RuntimeError> {
        self.set_staged(key, Some((table.to_owned(), image.into())));
        Ok(())
    }
    fn staged_delete(&self, key: &str) -> Result<(), RuntimeError> {
        if self.store.state.borrow().staged.contains_key(key) {
            self.set_staged(key, None);
        }
        Ok(())
    }
    fn staged_after(&self, after: &str, limit: usize) -> Result<Vec<(String, String, String)>, RuntimeError> {
        use std::ops::Bound::{Excluded, Unbounded};
        Ok(self.store.state.borrow().staged.range::<str, _>((Excluded(after), Unbounded)).take(limit).map(|(key, (table, image))| (key.clone(), table.clone(), image.to_string())).collect())
    }
    fn staged_table_after(&self, table: &str, after: &str, limit: usize) -> Result<Vec<(String, String)>, RuntimeError> {
        use std::ops::Bound::{Excluded, Unbounded};
        Ok(self.store.state.borrow().staged.range::<str, _>((Excluded(after), Unbounded)).filter(|(_, (held, _))| held == table).take(limit).map(|(key, (_, image))| (key.clone(), image.to_string())).collect())
    }
    fn staged_clear(&self) -> Result<(), RuntimeError> {
        let keys: Vec<String> = self.store.state.borrow().staged.keys().cloned().collect();
        for key in keys {
            self.set_staged(&key, None);
        }
        Ok(())
    }
}

impl<'a> Drop for MemoryTx<'a> {
    // A transaction dropped without commit or rollback rolls back.
    fn drop(&mut self) {
        if !self.undo.borrow().is_empty() {
            self.unwind(0);
        }
    }
}
