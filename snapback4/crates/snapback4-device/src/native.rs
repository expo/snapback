//! The native device: the partition in the core's own SQLite (the server's
//! two-table layout, the same code), the stream applied a page at a time
//! with the watermark, the outbox as a side table, queries and predictions
//! through `engine::local`. Everything the TypeScript replica does, in the
//! language the server is written in, so the conformance obligation
//! between two interpreters is the web's alone (LLP 3000 §7).

use serde::{Deserialize, Serialize};
use snapback4_core::engine::local;
use snapback4_core::error::{Refusal, RuntimeError};
use snapback4_core::ir::Program;
use snapback4_core::meter::Ceilings;
use snapback4_core::rows::{Bounds, Dir, Rows};
use snapback4_core::schema::{Audience, Index, LeavePolicy, Schema, Table};
use snapback4_core::store::{Store, Tx};
use snapback4_core::value::Value;
use snapback4_core::{Context, QueryOutcome, wire};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// The compiled backend, as `GET /schema` sends it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Backend {
    pub generation: u64,
    pub schema: Schema,
    pub programs: Vec<Program>,
}

/// One event of the stream or a snapshot, as `GET /sync` sends it.
#[derive(Clone, Debug, Deserialize)]
pub struct StreamEvent {
    pub table: String,
    pub kind: String,
    pub id: String,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

/// One page of `GET /sync`.
#[derive(Clone, Debug, Deserialize)]
pub struct StreamPage {
    pub snapshot: bool,
    pub events: Vec<StreamEvent>,
    pub watermark: u64,
    pub more: bool,
    #[serde(default)]
    pub next: Option<String>,
    #[serde(default)]
    pub generation: Option<u64>,
}

/// A queued write: the device's submission order, the op, its arguments,
/// the ids it minted, and the rows it predicted (`table/id`).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Queued {
    pub id: String,
    pub seq: u64,
    pub op: String,
    pub args: serde_json::Value,
    #[serde(default)]
    pub new_ids: Vec<String>,
    #[serde(default)]
    pub predicted: Vec<String>,
}

/// What a prediction left behind.
#[derive(Clone, Debug, Serialize)]
pub struct Predicted {
    pub result: serde_json::Value,
    pub written: Vec<String>,
    pub read: Vec<String>,
    /// The rows written, `table/id`, to withdraw if the server refuses.
    pub predicted: Vec<String>,
}

const WATERMARK: &str = "device:watermark";
const GENERATION: &str = "device:generation";
const BACKEND: &str = "device:backend";

pub struct Device {
    store: Store,
    schema: Schema,
    programs: BTreeMap<String, Program>,
    generation: u64,
}

/// Rows written by a prediction carry `pending: true`, the card's word for
/// a row the server has not confirmed; the server's image replaces it.
struct Predicting<'a> {
    tx: &'a Tx<'a>,
    written: RefCell<Vec<String>>,
}

impl Rows for Predicting<'_> {
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.tx.get(table, id)
    }
    fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        self.tx.lookup(table, index_name, index, key)
    }
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        self.tx.scan(table, index_name, prefix, bounds, dir, limit)
    }
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> {
        self.tx.count_prefix(table, index_name, prefix, limit)
    }
    fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        let mut fields = row.as_object()?.clone();
        fields.insert("pending".to_owned(), Value::Bool(true));
        let pending = Value::Row(fields.into());
        self.written.borrow_mut().push(format!("{table_name}/{}", row.field("id")?.as_str()?));
        self.tx.put(table_name, table, &pending, old)
    }
    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        self.tx.delete(table_name, table, old)
    }
}

impl Device {
    /// Open the device's store at `path` (created when absent) for the
    /// backend the server sent — or, with none, for the backend kept from
    /// last time, so a device that starts with no network opens on what it
    /// holds. The schema's indexes are installed; the rows kept stay unless
    /// the generation moved.
    pub fn open(path: &Path, backend: Option<Backend>) -> Result<Self, RuntimeError> {
        let mut store = Store::open(path)?;
        store.conn().execute_batch("CREATE TABLE IF NOT EXISTS _device_outbox (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, entry TEXT NOT NULL);")?;
        let backend = match backend {
            Some(backend) => {
                store.set_meta(BACKEND, &serde_json::to_string(&backend).map_err(|e| RuntimeError::Store(e.to_string()))?)?;
                backend
            }
            None => {
                let kept = store.meta(BACKEND)?.ok_or_else(|| RuntimeError::Auth("this device has never synced: the server must be reachable once to open".into()))?;
                serde_json::from_str(&kept).map_err(|e| RuntimeError::Store(format!("the kept backend does not parse: {e}")))?
            }
        };
        store.install(&backend.schema)?;
        let mut device = Self { store, schema: backend.schema, programs: backend.programs.into_iter().map(|p| (p.name.clone(), p)).collect(), generation: backend.generation };
        let held = device.meta_u64(GENERATION)?;
        if held != 0 && held != device.generation {
            // A new generation re-derives the partition: drop rows, keep the outbox.
            device.clear_rows()?;
        }
        device.store.set_meta(GENERATION, &device.generation.to_string())?;
        Ok(device)
    }

    /// The backend changed (a new generation from `/schema`): adopt it and
    /// keep it; the next sync is a snapshot.
    pub fn adopt(&mut self, backend: Backend) -> Result<(), RuntimeError> {
        self.store.set_meta(BACKEND, &serde_json::to_string(&backend).map_err(|e| RuntimeError::Store(e.to_string()))?)?;
        self.store.install(&backend.schema)?;
        self.schema = backend.schema;
        self.programs = backend.programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        if backend.generation != self.generation {
            self.generation = backend.generation;
            self.clear_rows()?;
            self.store.set_meta(GENERATION, &self.generation.to_string())?;
        }
        Ok(())
    }

    fn meta_u64(&self, key: &str) -> Result<u64, RuntimeError> {
        Ok(self.store.meta(key)?.and_then(|v| v.parse().ok()).unwrap_or(0))
    }

    /// The watermark the device has applied through, and its generation.
    pub fn state(&self) -> Result<(u64, u64), RuntimeError> {
        Ok((self.meta_u64(WATERMARK)?, self.generation))
    }

    /// Drop every row and index entry; the outbox and the watermark reset.
    pub fn clear_rows(&mut self) -> Result<(), RuntimeError> {
        self.store.conn().execute_batch("DELETE FROM r; DELETE FROM i;")?;
        self.store.set_meta(WATERMARK, "0")?;
        Ok(())
    }

    /// Apply one page atomically: rows, tombstones, and the watermark with
    /// the last page of a snapshot or any page of the stream. Returns the
    /// tables touched. `first` says this is a snapshot's first page (the
    /// rows are cleared before it).
    pub fn apply(&mut self, page: &StreamPage, first: bool) -> Result<Vec<String>, RuntimeError> {
        if let Some(generation) = page.generation
            && generation != self.generation
        {
            return Err(RuntimeError::Generation(format!("the page is generation {generation}; this device runs {}", self.generation)));
        }
        let mut touched = BTreeSet::new();
        if page.snapshot && first {
            self.clear_rows()?;
            touched.extend(self.schema.tables.keys().cloned());
        }
        let tx = self.store.transaction()?;
        for event in &page.events {
            touched.insert(event.table.clone());
            let Some(table) = self.schema.table(&event.table) else { continue };
            match event.kind.as_str() {
                "put" => {
                    let Some(data) = &event.data else { continue };
                    let row = wire::row_from_json(table, data).map_err(RuntimeError::Store)?;
                    let old = tx.get(&event.table, &event.id)?;
                    tx.put(&event.table, table, &row, old.as_ref())?;
                }
                "del" => {
                    if let Some(old) = tx.get(&event.table, &event.id)? {
                        tx.delete(&event.table, table, &old)?;
                    }
                }
                "scope" => {
                    // The group's prefix values, typed by the audience columns
                    // (an id on the wire is a string; in a key it is an id).
                    let columns = audience_prefix(table);
                    let group: Vec<Value> = match &event.data {
                        Some(serde_json::Value::Array(items)) => items.iter().zip(&columns).map(|(item, column)| table.columns.get(column).map(|kind| wire::column_from_json(kind, item).unwrap_or_else(|_| wire::untyped(item))).unwrap_or_else(|| wire::untyped(item))).collect(),
                        _ => Vec::new(),
                    };
                    leave(&tx, &self.schema, &event.table, &group)?;
                }
                _ => {}
            }
        }
        if !(page.snapshot && page.more) {
            tx.set_meta(WATERMARK, &page.watermark.to_string())?;
        }
        tx.commit()?;
        Ok(touched.into_iter().collect())
    }

    /// A query over the device's rows, with the device's words.
    pub fn query(&mut self, name: &str, viewer: &str, args: &serde_json::Value, now: i64) -> Result<QueryOutcome, Refusal> {
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
        let context = Context::new(viewer, typed_args(&program, args)?).at(now);
        let tx = self.store.transaction()?;
        let outcome = local::query(&tx, &self.schema, &program, context, Ceilings::default());
        tx.rollback()?;
        outcome
    }

    /// Predict a mutation: its rows land in the store marked `pending`, in
    /// one transaction that a refusal rolls back whole.
    pub fn predict(&mut self, name: &str, viewer: &str, args: &serde_json::Value, now: i64, new_ids: Vec<String>, entropy: u64) -> Result<Predicted, RuntimeError> {
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
        let context = Context::new(viewer, typed_args(&program, args)?).at(now).with_ids(new_ids).with_entropy(entropy.max(1));
        let tx = self.store.transaction()?;
        let predicting = Predicting { tx: &tx, written: RefCell::new(Vec::new()) };
        match local::predict(&predicting, &self.schema, &program, context, Ceilings::default()) {
            Ok(prediction) => {
                let predicted = predicting.written.into_inner();
                tx.commit()?;
                Ok(Predicted { result: wire::to_json(&prediction.result), written: prediction.written, read: prediction.read, predicted })
            }
            Err(error) => {
                tx.rollback()?;
                Err(error)
            }
        }
    }

    /// Withdraw a refused write's rows: those still pending go; the
    /// stream restores anything the prediction replaced.
    pub fn withdraw(&mut self, predicted: &[String]) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        for key in predicted {
            let Some((table_name, id)) = key.split_once('/') else { continue };
            let Some(table) = self.schema.table(table_name) else { continue };
            if let Some(row) = tx.get(table_name, id)?
                && row.field("pending").ok() == Some(&Value::Bool(true))
            {
                tx.delete(table_name, table, &row)?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn enqueue(&mut self, entry: &Queued) -> Result<(), RuntimeError> {
        let json = serde_json::to_string(entry).map_err(|e| RuntimeError::Store(e.to_string()))?;
        self.store.conn().execute("INSERT INTO _device_outbox(seq, id, entry) VALUES (?1, ?2, ?3)", rusqlite::params![entry.seq as i64, entry.id, json])?;
        Ok(())
    }

    /// Every queued write in submission order.
    pub fn queued(&self) -> Result<Vec<Queued>, RuntimeError> {
        let mut statement = self.store.conn().prepare("SELECT entry FROM _device_outbox ORDER BY seq")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|entry| serde_json::from_str(&entry?).map_err(|e| RuntimeError::Store(e.to_string()))).collect()
    }

    /// The next submission number.
    pub fn next_submission(&self) -> Result<u64, RuntimeError> {
        Ok(self.store.conn().query_row("SELECT COALESCE(MAX(seq), 0) + 1 FROM _device_outbox", [], |row| row.get::<_, i64>(0))? as u64)
    }

    pub fn dequeue(&mut self, id: &str) -> Result<(), RuntimeError> {
        self.store.conn().execute("DELETE FROM _device_outbox WHERE id = ?1", [id])?;
        Ok(())
    }

    /// A key the JavaScript client keeps beside the rows (the cached backend, a session's mark).
    pub fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        self.store.meta(&format!("client:{key}"))
    }

    pub fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.store.set_meta(&format!("client:{key}"), value)
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }
}

/// A group the device left: drop its rows (`until-revoked`) or keep what
/// was delivered (`delivered-history`).
fn leave(tx: &Tx<'_>, schema: &Schema, table_name: &str, group: &[Value]) -> Result<(), RuntimeError> {
    let Some(table) = schema.table(table_name) else { return Ok(()) };
    if table.leave == LeavePolicy::DeliveredHistory {
        return Ok(());
    }
    let Some(sync) = &table.sync else { return Ok(()) };
    let prefix = audience_prefix(table);
    let index = sync.horizon.as_ref().map(|h| h.by.clone()).or_else(|| table.indexes.iter().find(|(_, index)| index.columns().starts_with(&prefix)).map(|(name, _)| name.clone()));
    let Some(index) = index else { return Ok(()) };
    loop {
        let rows = tx.scan(table_name, &index, group, &Bounds::default(), Dir::Asc, 500)?;
        let count = rows.len();
        for (row, _) in rows {
            tx.delete(table_name, table, &row)?;
        }
        if count < 500 {
            return Ok(());
        }
    }
}

fn typed_args(program: &Program, args: &serde_json::Value) -> Result<BTreeMap<String, Value>, RuntimeError> {
    let mut typed = BTreeMap::new();
    if let serde_json::Value::Object(fields) = args {
        for (name, value) in fields {
            let kind = program.args.get(name).ok_or_else(|| RuntimeError::Input(format!("{} takes no argument {name}", program.name)))?;
            typed.insert(name.clone(), wire::from_json(kind, value).map_err(|why| RuntimeError::Input(format!("argument {name}: {why}")))?);
        }
    }
    Ok(typed)
}

/// The columns a table's audience pins: a group's prefix.
fn audience_prefix(table: &Table) -> Vec<String> {
    match table.sync.as_ref().map(|sync| &sync.audience) {
        Some(Audience::Column(column)) => vec![column.clone()],
        Some(Audience::Target { prefix, .. }) => prefix.clone(),
        _ => Vec::new(),
    }
}
