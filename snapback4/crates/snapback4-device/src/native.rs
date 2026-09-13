//! The native device: the partition in the core's own SQLite (the server's
//! two-table layout, the same code), the stream applied a page at a time
//! with the watermark, the outbox as a side table, queries and predictions
//! through `engine::local`. Everything the TypeScript replica does, in the
//! language the server is written in, so the conformance obligation
//! between two interpreters is the web's alone (LLP 3000 §7).

use serde::{Deserialize, Serialize};
use rusqlite::OptionalExtension;
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

mod predictions;

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
    #[serde(default)]
    pub acknowledged: BTreeMap<String, u64>,
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
    #[serde(default)]
    pub viewer: String,
    #[serde(default)]
    pub now: i64,
    #[serde(default)]
    pub predictable: bool,
    #[serde(default)]
    pub sent_seq: Option<u64>,
    #[serde(default)]
    pub observed_seq: Option<u64>,
}

/// What a prediction left behind.
#[derive(Clone, Debug, Serialize)]
pub struct Predicted {
    pub new_ids: Vec<String>,
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
    snapshot_owner: Option<String>,
}

/// Rows written by a prediction carry `pending: true`, the card's word for
/// a row the server has not confirmed; the server's image replaces it.
struct Predicting<'a> {
    tx: &'a Tx<'a>,
    written: RefCell<Vec<String>>,
}

impl Rows for Predicting<'_> {
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.tx.get(table, id).map(|row| row.map(predictions::without_pending))
    }
    fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        self.tx.lookup(table, index_name, index, key).map(|row| row.map(predictions::without_pending))
    }
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        self.tx.scan(table, index_name, prefix, bounds, dir, limit).map(|rows| rows.into_iter().map(|(row, key)| (predictions::without_pending(row), key)).collect())
    }
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> {
        self.tx.count_prefix(table, index_name, prefix, limit)
    }
    fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        predictions::remember(self.tx, table_name, row.field("id")?.as_str()?)?;
        let mut fields = row.as_object()?.clone();
        fields.insert("pending".to_owned(), Value::Bool(true));
        let pending = Value::Row(fields.into());
        self.written.borrow_mut().push(format!("{table_name}/{}", row.field("id")?.as_str()?));
        self.tx.put(table_name, table, &pending, old)
    }
    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        predictions::remember(self.tx, table_name, old.field("id")?.as_str()?)?;
        self.written.borrow_mut().push(format!("{table_name}/{}", old.field("id")?.as_str()?));
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
        store.conn().execute_batch("CREATE TABLE IF NOT EXISTS _device_outbox (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, entry TEXT NOT NULL); CREATE TABLE IF NOT EXISTS _device_base (t TEXT NOT NULL, id TEXT NOT NULL, data TEXT, PRIMARY KEY(t, id)) WITHOUT ROWID; CREATE TABLE IF NOT EXISTS _device_snapshot (k TEXT PRIMARY KEY, t TEXT NOT NULL, data TEXT NOT NULL);")?;
        let backend = match backend {
            Some(backend) => {
                backend
            }
            None => {
                let kept = store.meta(BACKEND)?.ok_or_else(|| RuntimeError::Auth("this device has never synced: the server must be reachable once to open".into()))?;
                serde_json::from_str(&kept).map_err(|e| RuntimeError::Store(format!("the kept backend does not parse: {e}")))?
            }
        };
        let held = store.meta(GENERATION)?.and_then(|g| g.parse::<u64>().ok()).unwrap_or(0);
        let reset = held != 0 && held != backend.generation;
        let mut metadata = BTreeMap::from([(BACKEND.to_owned(), serde_json::to_string(&backend).map_err(|e| RuntimeError::Store(e.to_string()))?), (GENERATION.to_owned(), backend.generation.to_string())]);
        if reset { metadata.insert(WATERMARK.to_owned(), "0".into()); }
        store.install_device(&backend.schema, &metadata, reset)?;
        Ok(Self { store, schema: backend.schema, programs: backend.programs.into_iter().map(|p| (p.name.clone(), p)).collect(), generation: backend.generation, snapshot_owner: None })
    }

    pub fn adopt(&mut self, backend: Backend) -> Result<(), RuntimeError> {
        let reset = backend.generation != self.generation;
        let mut metadata = BTreeMap::from([(BACKEND.to_owned(), serde_json::to_string(&backend).map_err(|e| RuntimeError::Store(e.to_string()))?), (GENERATION.to_owned(), backend.generation.to_string())]);
        if reset { metadata.insert(WATERMARK.to_owned(), "0".into()); }
        self.store.install_device(&backend.schema, &metadata, reset)?;
        self.schema = backend.schema;
        self.programs = backend.programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        self.generation = backend.generation;
        self.snapshot_owner = None;
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
        let tx = self.store.transaction()?;
        tx.conn().execute_batch("DELETE FROM r; DELETE FROM i; DELETE FROM _device_base; DELETE FROM _device_snapshot;")?;
        tx.set_meta(WATERMARK, "0")?;
        tx.conn().execute("DELETE FROM _meta WHERE key IN ('device:snapshot:owner', 'device:snapshot:watermark')", [])?;
        tx.commit()?;
        self.snapshot_owner = None;
        Ok(())
    }

    /// Paged snapshots stage separately; the last page atomically replaces
    /// the confirmed partition and rebases all remaining predictions.
    pub fn apply(&mut self, page: &StreamPage, first: bool) -> Result<Vec<String>, RuntimeError> {
        if page.generation.is_some_and(|g| g != self.generation) { return Err(RuntimeError::Generation("stale device page".into())); }
        let owner = if page.snapshot && first { Some(format!("{}-{:x}", std::process::id(), snapback4_core::ids::seed())) } else { self.snapshot_owner.clone() };
        let tx = self.store.transaction()?;
        let watermark: u64 = tx.conn().query_row("SELECT value FROM _meta WHERE key = ?1", [WATERMARK], |r| r.get::<_, String>(0)).optional()?.map(|s| s.parse::<u64>().map_err(|_| RuntimeError::Store("invalid device watermark".into()))).transpose()?.unwrap_or(0);
        if page.watermark < watermark { return Err(RuntimeError::Generation("device watermark would move backwards".into())); }
        let mut touched = BTreeSet::new();
        if page.snapshot {
            if first {
                tx.conn().execute("DELETE FROM _device_snapshot", [])?;
                tx.set_meta("device:snapshot:watermark", &page.watermark.to_string())?;
                tx.set_meta("device:snapshot:owner", owner.as_deref().expect("first page owner"))?;
            }
            let held_owner: Option<String> = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'device:snapshot:owner'", [], |r| r.get(0)).optional()?;
            if owner.is_none() || held_owner != owner { return Err(RuntimeError::Generation("snapshot is finished or belongs to another device sync; restart at its first page".into())); }
            let pinned: String = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'device:snapshot:watermark'", [], |r| r.get(0))?;
            if pinned != page.watermark.to_string() { return Err(RuntimeError::Generation("snapshot watermark changed between pages".into())); }
            for event in &page.events {
                if event.kind != "put" { return Err(RuntimeError::Input("snapshots contain only row images".into())); }
                let table = self.schema.table(&event.table).ok_or_else(|| RuntimeError::Schema(format!("unknown table {}", event.table)))?;
                let row = wire::row_from_json(table, event.data.as_ref().ok_or_else(|| RuntimeError::Input("snapshot row is missing".into()))?).map_err(RuntimeError::Input)?;
                if row.field("id")?.as_str()? != event.id { return Err(RuntimeError::Input("snapshot row identity does not match its event".into())); }
                tx.conn().execute("INSERT INTO _device_snapshot(k, t, data) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET data = excluded.data", rusqlite::params![serde_json::to_string(&(&event.table, &event.id)).unwrap(), event.table, serde_json::to_string(&row).unwrap()])?;
            }
            if page.more { tx.commit()?; self.snapshot_owner = owner; return Ok(Vec::new()); }
        }
        predictions::restore(&tx, &self.schema)?;
        if page.snapshot {
            tx.conn().execute_batch("DELETE FROM r; DELETE FROM i;")?;
            touched.extend(self.schema.tables.keys().cloned());
            let mut after = String::new();
            loop {
                let rows: Vec<(String, String, String)> = tx.conn().prepare("SELECT k, t, data FROM _device_snapshot WHERE k > ?1 ORDER BY k LIMIT 500")?.query_map([&after], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<Result<_, _>>()?;
                for (key, table_name, data) in &rows {
                    let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("unknown table {table_name}")))?;
                    let row: Value = serde_json::from_str(data).map_err(|e| RuntimeError::Store(e.to_string()))?;
                    tx.put(table_name, table, &row, None)?;
                    after = key.clone();
                }
                if rows.len() < 500 { break; }
            }
            tx.conn().execute("DELETE FROM _device_snapshot", [])?;
            tx.conn().execute("DELETE FROM _meta WHERE key IN ('device:snapshot:owner', 'device:snapshot:watermark')", [])?;
        } else {
            for event in &page.events {
                touched.insert(event.table.clone());
                let table = self.schema.table(&event.table).ok_or_else(|| RuntimeError::Schema(format!("unknown table {}", event.table)))?;
                match event.kind.as_str() {
                    "put" => {
                        let row = wire::row_from_json(table, event.data.as_ref().ok_or_else(|| RuntimeError::Input("event row is missing".into()))?).map_err(RuntimeError::Input)?;
                        if row.field("id")?.as_str()? != event.id { return Err(RuntimeError::Input("row identity does not match its event".into())); }
                        let old = tx.get(&event.table, &event.id)?;
                        tx.put(&event.table, table, &row, old.as_ref())?;
                    }
                    "del" => if let Some(old) = tx.get(&event.table, &event.id)? { tx.delete(&event.table, table, &old)?; },
                    "scope" => {
                        let columns = audience_prefix(table);
                        let group: Vec<Value> = match &event.data {
                            Some(serde_json::Value::Array(items)) if items.len() == columns.len() => items.iter().zip(&columns).map(|(item, column)| wire::column_from_json(&table.columns[column], item)).collect::<Result<_, _>>().map_err(RuntimeError::Input)?,
                            _ => return Err(RuntimeError::Input("scope is not a key".into())),
                        };
                        leave(&tx, &self.schema, &event.table, &group)?;
                    }
                    _ => return Err(RuntimeError::Input("unknown stream event".into())),
                }
            }
        }
        tx.set_meta(WATERMARK, &page.watermark.to_string())?;
        for (id, seq) in &page.acknowledged {
            if *seq > page.watermark { return Err(RuntimeError::Input("acknowledgement is beyond the applied watermark".into())); }
            let data: Option<String> = tx.conn().query_row("SELECT entry FROM _device_outbox WHERE id = ?1", [id], |r|r.get(0)).optional()?;
            if let Some(data) = data {
                let mut entry: Queued = serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))?;
                entry.observed_seq = Some(*seq); predictions::enqueue(&tx, &entry)?;
            }
        }
        predictions::replay(&tx, &self.schema, &self.programs, page.watermark)?;
        tx.commit()?;
        if page.snapshot { self.snapshot_owner = None; }
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

    pub fn query_with_coverage(&mut self, name: &str, viewer: &str, args: &serde_json::Value, now: i64) -> (Result<QueryOutcome, Refusal>, bool) {
        let mut unknown = false;
        let result = (|| {
            let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
            let context = Context::new(viewer, typed_args(&program, args)?).at(now);
            let tx = self.store.transaction()?;
            let (result, coverage) = local::query_with_coverage(&tx, &self.schema, &program, context, Ceilings::default());
            unknown = coverage;
            tx.rollback()?;
            result
        })();
        (result, unknown)
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
                Ok(Predicted { new_ids: prediction.new_ids, result: wire::to_json(&prediction.result), written: prediction.written, read: prediction.read, predicted })
            }
            Err(error) => {
                tx.rollback()?;
                Err(error)
            }
        }
    }

    /// Withdraw a refused write's rows: those still pending go; the
    /// stream restores anything the prediction replaced.
    pub fn withdraw(&mut self, _predicted: &[String]) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        predictions::restore(&tx, &self.schema)?;
        tx.commit()
    }

    pub fn admit(&mut self, mut entry: Queued) -> Result<Queued, RuntimeError> {
        let program = self.programs.get(&entry.op).ok_or_else(|| RuntimeError::UnknownOp(entry.op.clone()))?;
        let tx = self.store.transaction()?;
        if entry.predictable {
        tx.savepoint("admit")?;
        match predictions::run(&tx, &self.schema, program, &entry) {
            Ok((predicted, new_ids)) => { entry.predicted = predicted; entry.new_ids = new_ids; entry.predictable = true; tx.release("admit")?; }
            Err(RuntimeError::Prediction(_)) => { tx.rollback_to("admit")?; tx.release("admit")?; entry.predictable = false; }
            Err(error) => return Err(error),
        }
        }
        predictions::enqueue(&tx, &entry)?;
        tx.set_meta("device:submission", &entry.seq.to_string())?;
        tx.commit()?;
        Ok(entry)
    }

    pub fn settle(&mut self, id: &str, seq: Option<u64>) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        let watermark: u64 = tx.conn().query_row("SELECT value FROM _meta WHERE key = ?1", [WATERMARK], |r| r.get::<_, String>(0)).optional()?.map(|s| s.parse::<u64>().map_err(|_| RuntimeError::Store("invalid device watermark".into()))).transpose()?.unwrap_or(0);
        predictions::restore(&tx, &self.schema)?;
        if let Some(seq) = seq {
            let data: String = tx.conn().query_row("SELECT entry FROM _device_outbox WHERE id = ?1", [id], |r| r.get(0))?;
            let mut entry: Queued = serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))?;
            entry.sent_seq = Some(seq);
            predictions::enqueue(&tx, &entry)?;
        } else { tx.conn().execute("DELETE FROM _device_outbox WHERE id = ?1", [id])?; }
        predictions::replay(&tx, &self.schema, &self.programs, watermark)?;
        tx.commit()
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
        Ok(self.store.conn().query_row("SELECT MAX(COALESCE((SELECT MAX(seq) FROM _device_outbox), 0), COALESCE((SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'device:submission'), 0)) + 1", [], |row| row.get::<_, i64>(0))? as u64)
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

    pub fn backend(&self) -> Backend { Backend { generation: self.generation, schema: self.schema.clone(), programs: self.programs.values().cloned().collect() } }

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
