//! The device: the partition held in a store the host brings, the stream
//! applied a page at a time with the watermark, the outbox in submission
//! order beneath predictions kept over confirmed images, queries and
//! predictions through `engine::local`. One implementation, over
//! `DeviceStore` — SQLite on a native host, memory on the web — so the
//! language is bound once and every host answers alike (LLP 3000 §7).

use crate::store::{DeviceStore, DeviceTx};
use serde::{Deserialize, Serialize};
use snapback4_core::engine::local;
use snapback4_core::error::{Refusal, RuntimeError};
use snapback4_core::ir::Program;
use snapback4_core::meter::Ceilings;
use snapback4_core::rows::{Bounds, Dir, Rows};
use snapback4_core::schema::{Audience, Index, LeavePolicy, Schema, Table};
use snapback4_core::value::Value;
use snapback4_core::{Context, QueryOutcome, wire};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

mod predictions;
mod media;
mod snapshot;
mod history;

/// The compiled backend, as `GET /schema` sends it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Backend {
    pub generation: u64,
    pub schema: Schema,
    pub programs: Vec<Program>,
}

/// One transaction's stream request inputs. A response may apply only while
/// no other owner has started a mutation send after this capture.
#[derive(Clone, Debug, Serialize)]
pub struct SyncState {
    pub watermark: u64,
    pub generation: u64,
    pub pending_ids: Vec<String>,
    pub send_revision: u64,
}

/// One event of the stream or a snapshot, as `POST /sync` sends it.
#[derive(Clone, Debug, Deserialize)]
pub struct StreamEvent {
    pub table: String,
    pub kind: String,
    pub id: String,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

/// One page of `POST /sync`.
#[derive(Clone, Debug, Deserialize)]
pub struct StreamPage {
    /// Local receipt captured before transport, not server-supplied metadata.
    #[serde(default)]
    pub send_revision: Option<u64>,
    #[serde(default)]
    pub stage_snapshot: bool,
    #[serde(default)]
    pub snapshot_catchup: bool,
    #[serde(default)]
    pub acknowledged: BTreeMap<String, u64>,
    #[serde(default)]
    pub held: Option<wire::HeldGroups>,
    #[serde(default)]
    pub joined: wire::HeldGroups,
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
const SEND_REVISION: &str = "device:send_revision";
const SUBMISSION: &str = "device:submission";
const SNAPSHOT_OWNER: &str = "device:snapshot:owner";
const SNAPSHOT_OWNERS: &str = "device:snapshot:owners";
const SNAPSHOT_WATERMARK: &str = "device:snapshot:watermark";
const SNAPSHOT_SEND_REVISION: &str = "device:snapshot:send_revision";
const SNAPSHOT_THROUGH: &str = "device:snapshot:through";
const SNAPSHOT_KEYS: [&str; 5] = [SNAPSHOT_OWNER, SNAPSHOT_WATERMARK, SNAPSHOT_SEND_REVISION, SNAPSHOT_THROUGH, history::STAGED_GROUPS];
/// The app's native module (LLP 3000.005 §9), kept so a cold start offline
/// answers native reads too: the bytes as hex, and the digest the server named.
const NATIVE: &str = "device:native";
const NATIVE_DIGEST: &str = "device:native:digest";
const NATIVE_GENERATION: &str = "device:native:generation";

pub struct Device<S: DeviceStore> {
    store: S,
    schema: Schema,
    programs: BTreeMap<String, Program>,
    generation: u64,
    snapshot_owner: Option<String>,
    /// The app's native module, once installed or reloaded from the store.
    #[cfg(feature = "wasm-host")]
    native: Option<std::sync::Arc<snapback4_core::engine::native::Module>>,
    native_digest: Option<String>,
}

/// Rows written by a prediction carry `pending: true`, the card's word for
/// a row the server has not confirmed; the server's image replaces it.
struct Predicting<'a, T: DeviceTx> {
    tx: &'a T,
    written: RefCell<Vec<String>>,
}

impl<T: DeviceTx> Rows for Predicting<'_, T> {
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

fn meta_u64<T: DeviceTx>(tx: &T, key: &str) -> Result<u64, RuntimeError> {
    tx.meta(key)?.map(|s| s.parse::<u64>().map_err(|_| RuntimeError::Store(format!("invalid device metadata {key}")))).transpose().map(|n| n.unwrap_or(0))
}

fn encoded<T: Serialize>(value: &T) -> Result<String, RuntimeError> {
    serde_json::to_string(value).map_err(|e| RuntimeError::Store(e.to_string()))
}

fn decoded<T: for<'de> Deserialize<'de>>(text: &str) -> Result<T, RuntimeError> {
    serde_json::from_str(text).map_err(|e| RuntimeError::Store(e.to_string()))
}

#[cfg(feature = "wasm-host")]
fn sha256(bytes: &[u8]) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

fn clear_native<S: DeviceStore>(store: &mut S) -> Result<(), RuntimeError> {
    let tx = store.transaction()?;
    tx.delete_meta(&[NATIVE, NATIVE_DIGEST, NATIVE_GENERATION])?;
    tx.commit()
}

fn invalidate_native(metadata: &mut BTreeMap<String, String>) {
    metadata.insert(NATIVE.to_owned(), String::new());
    metadata.insert(NATIVE_DIGEST.to_owned(), String::new());
    metadata.insert(NATIVE_GENERATION.to_owned(), String::new());
}

impl<S: DeviceStore> Device<S> {
    /// The device over an opened store, for the backend the server sent —
    /// or, with none, for the backend kept from last time, so a device
    /// that starts with no network opens on what it holds. The schema is
    /// installed; a literal-default addition can keep older row images.
    pub fn open_store(mut store: S, backend: Option<Backend>) -> Result<Self, RuntimeError> {
        let backend = match backend {
            Some(backend) => backend,
            None => {
                let kept = store.meta(BACKEND)?.ok_or_else(|| RuntimeError::Auth("this device has never synced: the server must be reachable once to open".into()))?;
                serde_json::from_str(&kept).map_err(|e| RuntimeError::Store(format!("the kept backend does not parse: {e}")))?
            }
        };
        let held = store.meta(GENERATION)?.and_then(|g| g.parse::<u64>().ok()).unwrap_or(0);
        let reset = held != 0 && held != backend.generation;
        let keep_images = reset && store.meta(BACKEND)?.and_then(|text| serde_json::from_str::<Backend>(&text).ok())
            .is_some_and(|old| snapback4_core::successor::keeps_literal_default_images(&old.schema, &backend.schema));
        let mut metadata = BTreeMap::from([(BACKEND.to_owned(), encoded(&backend)?), (GENERATION.to_owned(), backend.generation.to_string())]);
        if reset {
            metadata.insert(WATERMARK.to_owned(), "0".into());
            invalidate_native(&mut metadata);
            metadata.insert(history::GROUPS.to_owned(), "{}".into());
            metadata.insert(history::STAGED_GROUPS.to_owned(), "{}".into());
        }
        store.install(&backend.schema, &metadata, reset && !keep_images)?;
        let cached_digest = store.meta(NATIVE_DIGEST)?;
        let cached_module = store.meta(NATIVE)?;
        let cached_generation = store.meta(NATIVE_GENERATION)?;
        #[cfg(feature = "wasm-host")]
        let native = match (&cached_module, &cached_digest, &cached_generation) {
            (Some(hex), Some(digest), Some(generation)) if generation.parse::<u64>().ok() == Some(backend.generation) => snapback4_core::value::decode_bytes_hex(hex)
                .filter(|bytes| sha256(bytes) == *digest)
                .and_then(|bytes| snapback4_core::engine::native::Module::compile(&bytes).ok())
                .map(std::sync::Arc::new),
            _ => None,
        };
        #[cfg(not(feature = "wasm-host"))]
        let valid_native = false;
        #[cfg(feature = "wasm-host")]
        let valid_native = native.is_some();
        let cache_present = cached_module.is_some() || cached_digest.is_some() || cached_generation.is_some();
        let native_digest = if valid_native { cached_digest } else { None };
        if !valid_native && cache_present {
            // A partial, corrupt, mismatched or no-longer-loadable cache is
            // absent. Do not advertise its digest and suppress repair.
            clear_native(&mut store)?;
        }
        Ok(Self {
            store,
            schema: backend.schema,
            programs: backend.programs.into_iter().map(|p| (p.name.clone(), p)).collect(),
            generation: backend.generation,
            snapshot_owner: None,
            #[cfg(feature = "wasm-host")]
            native,
            native_digest,
        })
    }

    /// Install the app's native module the server serves at `/native.wasm`
    /// (LLP 3000.005 §9), keeping its bytes so a cold start offline has it.
    /// Returns the jobs and the reads it implements.
    pub fn install_native(&mut self, bytes: &[u8], digest: &str, generation: u64) -> Result<(Vec<String>, Vec<String>), RuntimeError> {
        if generation != self.generation {
            return Err(RuntimeError::Generation("the native module belongs to an obsolete backend generation".into()));
        }
        #[cfg(feature = "wasm-host")]
        {
            if sha256(bytes) != digest {
                return Err(RuntimeError::Native { code: "E_NATIVE".into(), message: "the native module does not match its SHA-256 digest".into() });
            }
            let module = snapback4_core::engine::native::Module::compile(bytes)?;
            let names = (module.jobs().to_vec(), module.reads().to_vec());
            let tx = self.store.transaction()?;
            tx.set_meta(NATIVE, &snapback4_core::value::encode_bytes_hex(bytes))?;
            tx.set_meta(NATIVE_DIGEST, digest)?;
            tx.set_meta(NATIVE_GENERATION, &generation.to_string())?;
            tx.commit()?;
            self.native = Some(std::sync::Arc::new(module));
            self.native_digest = Some(digest.to_owned());
            Ok(names)
        }
        #[cfg(not(feature = "wasm-host"))]
        {
            let _ = (bytes, digest);
            Err(RuntimeError::Native { code: "E_NATIVE".into(), message: "this device was built without the wasm host; native reads go to the server".into() })
        }
    }

    /// The digest of the module installed, as the server named it.
    pub fn native_digest(&self) -> Option<&str> {
        self.native_digest.as_deref()
    }

    /// The backend changed (a new generation from `/schema`): adopt it and
    /// keep it; a literal-default addition keeps the old images readable.
    /// A changed generation still requests a fresh snapshot.
    pub fn adopt(&mut self, backend: Backend) -> Result<(), RuntimeError> {
        let reset = backend.generation != self.generation;
        let keep_images = snapback4_core::successor::keeps_literal_default_images(&self.schema, &backend.schema);
        let mut metadata = BTreeMap::from([(BACKEND.to_owned(), encoded(&backend)?), (GENERATION.to_owned(), backend.generation.to_string())]);
        if reset {
            metadata.insert(WATERMARK.to_owned(), "0".into());
            invalidate_native(&mut metadata);
            metadata.insert(history::GROUPS.to_owned(), "{}".into());
            metadata.insert(history::STAGED_GROUPS.to_owned(), "{}".into());
        }
        self.store.install(&backend.schema, &metadata, reset && !keep_images)?;
        if reset {
            #[cfg(feature = "wasm-host")]
            {
                self.native = None;
            }
            self.native_digest = None;
        }
        self.schema = backend.schema;
        self.programs = backend.programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        self.generation = backend.generation;
        self.snapshot_owner = None;
        Ok(())
    }

    /// The watermark the device has applied through, and its generation.
    pub fn state(&self) -> Result<(u64, u64), RuntimeError> {
        Ok((self.store.meta(WATERMARK)?.and_then(|v| v.parse().ok()).unwrap_or(0), self.generation))
    }

    /// Persist before starting a POST, so another owner of the store
    /// cannot apply an older sync response that omitted the write being sent.
    pub fn begin_send(&mut self) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction()?;
        let revision = meta_u64(&tx, SEND_REVISION)?.checked_add(1).filter(|n| *n <= 9_007_199_254_740_991).ok_or_else(|| RuntimeError::Store("send revision overflow".into()))?;
        tx.set_meta(SEND_REVISION, &revision.to_string())?;
        tx.commit()?;
        Ok(revision)
    }

    /// What a sync request is made from: the watermark, the generation,
    /// the writes sent but not yet seen, and the send revision.
    pub fn sync_state(&mut self) -> Result<SyncState, RuntimeError> {
        let tx = self.store.read_transaction()?;
        let mut pending_ids = Vec::new();
        for entry in tx.outbox_entries()? {
            let queued: Queued = decoded(&entry)?;
            if queued.sent_seq.is_none() {
                pending_ids.push(queued.id);
                if pending_ids.len() == 256 {
                    break;
                }
            }
        }
        let state = SyncState { watermark: meta_u64(&tx, WATERMARK)?, generation: self.generation, pending_ids, send_revision: meta_u64(&tx, SEND_REVISION)? };
        tx.rollback()?;
        Ok(state)
    }

    /// Drop every row and index entry, the images and the staged snapshot;
    /// the watermark resets, the outbox stays.
    pub fn clear_rows(&mut self) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        tx.clear_rows()?;
        tx.base_clear()?;
        tx.staged_clear()?;
        tx.set_meta(WATERMARK, "0")?;
        tx.delete_meta(&[history::GROUPS])?;
        tx.delete_meta(&SNAPSHOT_KEYS)?;
        tx.commit()?;
        self.snapshot_owner = None;
        Ok(())
    }

    /// Apply one page atomically. A paged snapshot stages separately; its
    /// last page atomically replaces the confirmed partition and rebases
    /// every remaining prediction. Returns the tables touched.
    pub fn apply(&mut self, page: &StreamPage, first: bool) -> Result<Vec<String>, RuntimeError> {
        if page.generation.is_some_and(|g| g != self.generation) {
            return Err(RuntimeError::Generation("stale device page".into()));
        }
        let tx = self.store.transaction()?;
        let owner = if page.snapshot && first {
            // A snapshot's owner: a number from the store, so two devices
            // over one store cannot finish each other's snapshots.
            let n = meta_u64(&tx, SNAPSHOT_OWNERS)? + 1;
            tx.set_meta(SNAPSHOT_OWNERS, &n.to_string())?;
            Some(n.to_string())
        } else {
            self.snapshot_owner.clone()
        };
        let send_revision = meta_u64(&tx, SEND_REVISION)?;
        if page.send_revision.is_some_and(|expected| expected != send_revision) {
            return Err(RuntimeError::Generation("a mutation send overlapped the sync response; retry sync".into()));
        }
        let watermark = meta_u64(&tx, WATERMARK)?;
        if page.watermark < watermark {
            return Err(RuntimeError::Generation("device watermark would move backwards".into()));
        }
        let mut touched = BTreeSet::new();
        let replacing = page.snapshot || page.snapshot_catchup;
        if replacing {
            if page.snapshot && first {
                tx.staged_clear()?;
                snapshot::retain(&tx, &self.schema, page.held.as_ref())?;
                tx.set_meta(SNAPSHOT_WATERMARK, &page.watermark.to_string())?;
                tx.set_meta(SNAPSHOT_THROUGH, &page.watermark.to_string())?;
                tx.set_meta(SNAPSHOT_OWNER, owner.as_deref().expect("first page owner"))?;
                tx.set_meta(SNAPSHOT_SEND_REVISION, &send_revision.to_string())?;
            }
            let held_owner = tx.meta(SNAPSHOT_OWNER)?;
            if owner.is_none() || held_owner != owner {
                return Err(RuntimeError::Generation("snapshot is finished or belongs to another device sync; restart at its first page".into()));
            }
            if meta_u64(&tx, SNAPSHOT_SEND_REVISION)? != send_revision {
                return Err(RuntimeError::Generation("a mutation send overlapped the paged snapshot; restart at its first page".into()));
            }
            if page.snapshot && meta_u64(&tx, SNAPSHOT_WATERMARK)? != page.watermark {
                return Err(RuntimeError::Generation("snapshot watermark changed between pages".into()));
            }
            if page.watermark < meta_u64(&tx, SNAPSHOT_THROUGH)? {
                return Err(RuntimeError::Generation("snapshot catch-up moved backwards".into()));
            }
            snapshot::stage(&tx, &self.schema, &page.events, page.snapshot)?;
            history::events(&tx, &self.schema, &page.events, &page.joined, true)?;
            tx.set_meta(SNAPSHOT_THROUGH, &page.watermark.to_string())?;
            // Paged snapshots read different server transactions. Keep every
            // image private until log catch-up repairs intervening commits.
            if page.more || (page.snapshot && page.stage_snapshot) {
                tx.commit()?;
                self.snapshot_owner = owner;
                return Ok(Vec::new());
            }
        }
        predictions::restore(&tx, &self.schema)?;
        if replacing {
            let groups = history::load(&tx, history::STAGED_GROUPS)?;
            tx.clear_rows()?;
            touched.extend(self.schema.tables.keys().cloned());
            let mut after = String::new();
            loop {
                let rows = tx.staged_after(&after, 500)?;
                for (key, table_name, data) in &rows {
                    let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("unknown table {table_name}")))?;
                    let staged: snapshot::Staged = decoded(data)?;
                    after = key.clone();
                    if !staged.acquired && !history::is_left(&groups, table_name, &history::row_key(table, &staged.row)?) { continue; }
                    tx.put(table_name, table, &staged.row, None)?;
                    if staged.acquired {
                        media::remember(&tx, table_name, table, &staged.row, self.generation)?;
                    } else {
                        media::forget(&tx, table, &staged.row)?;
                    }
                }
                if rows.len() < 500 {
                    break;
                }
            }
            tx.set_meta(history::GROUPS, &encoded(&groups)?)?;
            tx.staged_clear()?;
            tx.delete_meta(&SNAPSHOT_KEYS)?;
        } else {
            for event in &page.events {
                touched.insert(event.table.clone());
                let table = self.schema.table(&event.table).ok_or_else(|| RuntimeError::Schema(format!("unknown table {}", event.table)))?;
                match event.kind.as_str() {
                    "put" => {
                        let row = wire::row_from_json(table, event.data.as_ref().ok_or_else(|| RuntimeError::Input("event row is missing".into()))?).map_err(RuntimeError::Input)?;
                        if row.field("id")?.as_str()? != event.id {
                            return Err(RuntimeError::Input("row identity does not match its event".into()));
                        }
                        let old = tx.get(&event.table, &event.id)?;
                        if let Some(old) = &old { media::forget(&tx, table, old)?; }
                        tx.put(&event.table, table, &row, old.as_ref())?;
                        media::remember(&tx, &event.table, table, &row, self.generation)?;
                    }
                    "del" => {
                        if let Some(old) = tx.get(&event.table, &event.id)? {
                            media::forget(&tx, table, &old)?;
                            tx.delete(&event.table, table, &old)?;
                        }
                    }
                    "scope" => {
                        let group = scope_group(table, event)?;
                        leave(&tx, &self.schema, &event.table, &group)?;
                    }
                    _ => return Err(RuntimeError::Input("unknown stream event".into())),
                }
            }
        }
        if !replacing { history::events(&tx, &self.schema, &page.events, &page.joined, false)?; }
        touched.extend(page.joined.keys().cloned());
        tx.set_meta(WATERMARK, &page.watermark.to_string())?;
        for (id, seq) in &page.acknowledged {
            if *seq > page.watermark {
                return Err(RuntimeError::Input("acknowledgement is beyond the applied watermark".into()));
            }
            if let Some(data) = tx.outbox_get(id)? {
                let mut entry: Queued = decoded(&data)?;
                entry.observed_seq = Some(*seq);
                predictions::enqueue(&tx, &entry)?;
            }
        }
        predictions::replay(&tx, &self.schema, &self.programs, page.watermark)?;
        tx.commit()?;
        if replacing {
            self.snapshot_owner = None;
        }
        Ok(touched.into_iter().collect())
    }

    /// A query over the device's rows, with the device's words.
    pub fn query(&mut self, name: &str, viewer: &str, args: &serde_json::Value, now: i64) -> Result<QueryOutcome, Refusal> {
        self.query_with_coverage(name, viewer, args, now).0
    }

    /// The query, and whether it touched something the device does not
    /// hold (an online-only table, a row past the horizon).
    pub fn query_with_coverage(&mut self, name: &str, viewer: &str, args: &serde_json::Value, now: i64) -> (Result<QueryOutcome, Refusal>, bool, bool) {
        let mut unknown = false;
        let mut retained = false;
        let result = (|| {
            let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
            let context = Context::new(viewer, typed_args(&program, args)?).at(now);
            let tx = self.store.read_transaction()?;
            let reading = history::Reading { tx: &tx, schema: &self.schema, groups: history::load(&tx, history::GROUPS)?, retained: std::cell::Cell::new(false) };
            let (result, coverage, history_only) = if program.native {
                // A native read over the rows held (LLP 3000.005 §9); without
                // the module the device does not know, and the host asks the
                // server.
                #[cfg(feature = "wasm-host")]
                match &self.native {
                    Some(module) => local::native_query(&reading, &self.schema, module, &program, context, Ceilings::default()),
                    None => (Err(RuntimeError::Native { code: "E_NATIVE".into(), message: format!("{name} is a native read and this device has no module yet") }.refusal()), true, false),
                }
                #[cfg(not(feature = "wasm-host"))]
                (Err(RuntimeError::Native { code: "E_NATIVE".into(), message: format!("{name} is a native read and this device was built without the wasm host") }.refusal()), true, false)
            } else {
                local::query_with_coverage(&reading, &self.schema, &program, context, Ceilings::default())
            };
            unknown = coverage;
            retained = reading.retained.get() && history_only;
            drop(reading);
            tx.rollback()?;
            result
        })();
        (result, unknown, retained)
    }

    /// Predict a mutation: its rows land in the store marked `pending`, in
    /// one transaction that a refusal rolls back whole.
    pub fn predict(&mut self, name: &str, viewer: &str, args: &serde_json::Value, now: i64, new_ids: Vec<String>, entropy: u64) -> Result<Predicted, RuntimeError> {
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
        let tx = self.store.transaction()?;
        let context = Context::new(viewer, media::inputs(&tx, &program, viewer, args)?).at(now).with_ids(new_ids).with_entropy(entropy.max(1));
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

    /// Withdraw predictions: the confirmed images come back; the stream
    /// restores anything else.
    pub fn withdraw(&mut self, _predicted: &[String]) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        let watermark = meta_u64(&tx, WATERMARK)?;
        predictions::restore(&tx, &self.schema)?;
        // Base images are shared by overlapping predictions, so restore the
        // complete speculative overlay and rebuild the writes that remain.
        predictions::replay(&tx, &self.schema, &self.programs, watermark)?;
        tx.commit()
    }

    /// Admit a write: predict it where the device can (its rows land
    /// pending over their confirmed images) and queue it durably in
    /// submission order, in one transaction.
    pub fn admit(&mut self, mut entry: Queued) -> Result<Queued, RuntimeError> {
        let program = self.programs.get(&entry.op).ok_or_else(|| RuntimeError::UnknownOp(entry.op.clone()))?;
        if program.kind == snapback4_core::ProgramKind::Action { return Err(RuntimeError::UnknownOp("an action cannot enter the device outbox; call client.act".into())); }
        let tx = self.store.transaction()?;
        if entry.predictable {
            tx.savepoint("admit")?;
            match predictions::run(&tx, &self.schema, program, &entry) {
                Ok((predicted, new_ids)) => {
                    entry.predicted = predicted;
                    entry.new_ids = new_ids;
                    entry.predictable = true;
                    tx.release("admit")?;
                }
                Err(RuntimeError::Prediction(_)) => {
                    tx.rollback_to("admit")?;
                    entry.predictable = false;
                    entry.predicted.clear();
                }
                Err(error) => return Err(error),
            }
        }
        predictions::enqueue(&tx, &entry)?;
        tx.set_meta(SUBMISSION, &entry.seq.to_string())?;
        tx.commit()?;
        Ok(entry)
    }

    /// The server answered a write: sent at `seq` (the entry waits for the
    /// stream to carry it) or refused (`None`: the entry goes); the
    /// survivors are replayed over the confirmed images.
    pub fn settle(&mut self, id: &str, seq: Option<u64>) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        let watermark = meta_u64(&tx, WATERMARK)?;
        predictions::restore(&tx, &self.schema)?;
        match seq {
            Some(seq) => {
                let data = tx.outbox_get(id)?.ok_or_else(|| RuntimeError::Store(format!("the outbox holds no write {id}")))?;
                let mut entry: Queued = decoded(&data)?;
                entry.sent_seq = Some(seq);
                predictions::enqueue(&tx, &entry)?;
            }
            None => tx.outbox_delete(id)?,
        }
        predictions::replay(&tx, &self.schema, &self.programs, watermark)?;
        tx.commit()
    }

    /// Queue a write as given (no prediction); a duplicate submission
    /// number or id is refused.
    pub fn enqueue(&mut self, entry: &Queued) -> Result<(), RuntimeError> {
        if self.programs.get(&entry.op).is_some_and(|p| p.kind == snapback4_core::ProgramKind::Action) { return Err(RuntimeError::UnknownOp("an action cannot enter the device outbox; call client.act".into())); }
        let tx = self.store.transaction()?;
        tx.outbox_insert(entry.seq, &entry.id, &encoded(entry)?)?;
        tx.commit()
    }

    /// Every queued write in submission order.
    pub fn queued(&mut self) -> Result<Vec<Queued>, RuntimeError> {
        let tx = self.store.read_transaction()?;
        let entries = tx.outbox_entries()?.iter().map(|entry| decoded(entry)).collect::<Result<Vec<Queued>, _>>()?;
        tx.rollback()?;
        Ok(entries)
    }

    /// The next submission number: after everything queued or ever admitted.
    pub fn next_submission(&mut self) -> Result<u64, RuntimeError> {
        let tx = self.store.read_transaction()?;
        let next = tx.outbox_max_seq()?.max(meta_u64(&tx, SUBMISSION)?) + 1;
        tx.rollback()?;
        Ok(next)
    }

    pub fn dequeue(&mut self, id: &str) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        tx.outbox_delete(id)?;
        tx.commit()
    }

    /// A key the JavaScript client keeps beside the rows (a session's mark, the last sync).
    pub fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        self.store.meta(&format!("client:{key}"))
    }

    pub fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.store.set_meta(&format!("client:{key}"), value)
    }

    pub fn backend(&self) -> Backend {
        Backend { generation: self.generation, schema: self.schema.clone(), programs: self.programs.values().cloned().collect() }
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn store(&self) -> &S {
        &self.store
    }
}

/// A scope tombstone's group: the prefix values, typed by the audience
/// columns (an id on the wire is a string; in a key it is an id).
fn scope_group(table: &Table, event: &StreamEvent) -> Result<Vec<Value>, RuntimeError> {
    let columns = audience_prefix(table);
    match &event.data {
        Some(serde_json::Value::Array(items)) if items.len() == columns.len() => items.iter().zip(&columns).map(|(item, column)| wire::column_from_json(&table.columns[column], item)).collect::<Result<_, _>>().map_err(RuntimeError::Input),
        _ => Err(RuntimeError::Input("scope is not a key".into())),
    }
}

/// A group the device left: drop its rows (`until-revoked`) or keep what
/// was delivered (`delivered-history`).
fn leave<T: DeviceTx>(tx: &T, schema: &Schema, table_name: &str, group: &[Value]) -> Result<(), RuntimeError> {
    let Some(table) = schema.table(table_name) else { return Ok(()) };
    if table.leave == LeavePolicy::DeliveredHistory { return media::leave(tx, table_name, table, group); }
    let Some(sync) = &table.sync else { return Ok(()) };
    let prefix = audience_prefix(table);
    let index = sync.horizon.as_ref().map(|h| h.by.clone()).or_else(|| table.indexes.iter().find(|(_, index)| index.columns().starts_with(&prefix)).map(|(name, _)| name.clone()));
    let Some(index) = index else { return Ok(()) };
    loop {
        let rows = tx.scan(table_name, &index, group, &Bounds::default(), Dir::Asc, 500)?;
        let count = rows.len();
        for (row, _) in rows {
            media::forget(tx, table, &row)?;
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
