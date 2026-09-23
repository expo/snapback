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
mod deferred;
mod media;
mod snapshot;
mod history;
mod boundary;
mod store_identity;
pub use store_identity::StoreObservation;

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
    pub acquired: bool,
    pub backend_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restore_refusal: Option<Refusal>,
    pub store_id: Option<String>,
    pub watermark: u64,
    pub generation: u64,
    pub pending_ids: Vec<String>,
    pub pending_through: u64,
    pub pending_complete: bool,
    pub pending_bound: u64,
    pub transfer_watermark: u64,
    /// Cut echoed by head-only observations, including an abandoned snapshot
    /// whose images remain restore evidence but cannot authorize continuation.
    pub restore_watermark: u64,
    /// Highest retained image head at request time, not at response time.
    pub restore_images_at: u64,
    /// Raw expected metadata for atomic installation after a schema request.
    pub adoption_capture: BTreeMap<String, Option<String>>,
    pub transfer_store_id: Option<String>,
    pub snapshot_catchup: bool,
    pub send_revision: u64,
}

/// One event of the stream or a snapshot, as `POST /sync` sends it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamEvent {
    pub table: String,
    pub kind: String,
    pub id: String,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

/// One page of `POST /sync`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamPage {
    /// Private restore cut captured separately from a restarted snapshot's
    /// request cursor. It validates head evidence, never acquisition progress.
    #[serde(default)]
    pub captured_restore_watermark: Option<u64>,
    #[serde(default)]
    pub captured_restore_images_at: Option<u64>,
    #[serde(default)]
    pub images_at: Option<u64>,
    #[serde(default)]
    pub committed_above: BTreeMap<String, u64>,
    /// Local declaration captured by sync_state, echoed by the transport.
    #[serde(default)]
    pub pending_through: Option<u64>,
    #[serde(default)]
    pub pending_complete: Option<bool>,
    #[serde(default)]
    pub pending_bound: Option<u64>,
    #[serde(default)]
    pub acquisitions: Vec<wire::Acquisition>,
    /// Local request watermark and persisted acquisition watermark at capture.
    #[serde(default)]
    pub requested_watermark: Option<u64>,
    #[serde(default)]
    pub captured_watermark: Option<u64>,
    #[serde(default)]
    pub store_id: Option<String>,
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
    /// The server echoes the cursor that selected this snapshot page.
    #[serde(default)]
    pub after: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt_store: Option<ReceiptStore>,
    #[serde(default)]
    pub observed_seq: Option<u64>,
}

/// A receipt binds only to an advertised incarnation. Missing outer or inner
/// identity is unbound until the first real identity; replacement binds known
/// legacy receipts before changing the store.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReceiptStore {
    pub id: Option<String>,
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

const BACKEND_IDENTITY: &str = "device:backend-identity";
const BACKEND_REQUIRED: &str = "device:backend-required";
const STORE_ID: &str = "device:store_id";
const WATERMARK: &str = "device:watermark";
const GENERATION: &str = "device:generation";
const ACQUIRED: &str = "device:acquired-generation";
const BACKEND: &str = "device:backend";
const SEND_REVISION: &str = "device:send_revision";
const SUBMISSION: &str = "device:submission";
const SNAPSHOT_OWNER: &str = "device:snapshot:owner";
const SNAPSHOT_OWNERS: &str = "device:snapshot:owners";
const SNAPSHOT_WATERMARK: &str = "device:snapshot:watermark";
const SNAPSHOT_SEND_REVISION: &str = "device:snapshot:send_revision";
const SNAPSHOT_THROUGH: &str = "device:snapshot:through";
const SNAPSHOT_IMAGES_AT: &str = "device:snapshot:images_at";
const SNAPSHOT_NEXT: &str = "device:snapshot:next";
const SNAPSHOT_ACKS: &str = "device:snapshot:acks";
const SNAPSHOT_KEYS: [&str; 9] = [SNAPSHOT_ACKS, SNAPSHOT_NEXT, boundary::STAGED, SNAPSHOT_OWNER, SNAPSHOT_WATERMARK, SNAPSHOT_SEND_REVISION, SNAPSHOT_THROUGH, SNAPSHOT_IMAGES_AT, history::STAGED_GROUPS];
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
    backend_identity: String,
    store_identity: Option<String>,
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
    schema: &'a Schema,
    groups: history::Groups,
    boundaries: boundary::Boundaries,
    written: RefCell<Vec<String>>,
}

impl<T: DeviceTx> Rows for Predicting<'_, T> {
    fn provisional_row(&self, table: &str, row: &Value) -> Result<bool, RuntimeError> {
        Ok(self.tx.get(table, row.field("id")?.as_str()?)?.is_some_and(|image| image.field("pending") == Ok(&Value::Bool(true))))
    }
    fn acquired_boundary(&self, table: &str, index: &str, prefix: &[Value]) -> Result<Option<snapback4_core::rows::AcquiredBoundary>, RuntimeError> {
        boundary::read(&self.boundaries, self.schema, table, index, prefix)
    }
    fn retained_row(&self, name: &str, row: &Value) -> Result<bool, RuntimeError> {
        history::retained(self.schema, &self.groups, name, history::Coverage::Row(row))
    }
    fn retained_group(&self, table: &str, index: &str, prefix: &[Value]) -> Result<bool, RuntimeError> {
        history::retained(self.schema, &self.groups, table, history::Coverage::Range(index, prefix))
    }
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.tx.get(table, id).map(|row| row.map(predictions::without_pending))
    }
    fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        self.tx.lookup(table, index_name, index, key).map(|row| row.map(predictions::without_pending))
    }
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        self.tx.scan(table, index_name, prefix, bounds, dir, limit).map(|rows| rows.into_iter().map(|(row, key)| (predictions::without_pending(row), key)).collect())
    }
    fn scan_metered(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, meter: &mut snapback4_core::meter::Meter) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let mut rows = self.tx.scan_metered(table, index, prefix, bounds, dir, limit, meter)?;
        for (row, _) in &mut rows {
            meter.heap(snapback4_core::rows::word_heap::object_copy(row))?;
            *row = predictions::without_pending(std::mem::replace(row, Value::Null));
        }
        Ok(rows)
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

// @ref LLP 3000.008.001#4-read-and-write-outcomes — unacquired facts cannot justify a value or a predicted refusal.
fn require_acquired<T: DeviceTx>(tx: &T, schema: &Schema, program: &Program) -> Result<(), RuntimeError> {
    store_identity::require_healthy(tx)?;
    if tx.meta(BACKEND_REQUIRED)?.is_some_and(|value| !value.is_empty()) {
        return Err(RuntimeError::Prediction("this store's backend has not been adopted; reconnect to acquire it".into()));
    }
    let generation = tx.meta(GENERATION)?;
    if generation.is_some() && tx.meta(ACQUIRED)? == generation { return Ok(()); }
    // Constants need no partition, and online-only reads retain their own
    // unknown-coverage behavior. Native reads have opaque dependencies.
    let synced = |name: &str| schema.tables.get(name).is_some_and(|table| table.sync.is_some());
    if !program.native && !snapback4_core::ir::read_sites(program).iter().any(|site| synced(&site.table))
        && !snapback4_core::ir::write_tables(program).iter().any(|(table, _)| synced(table)) { return Ok(()); }
    Err(RuntimeError::Prediction("this generation's partition has not completed acquisition; reconnect to acquire it".into()))
}

fn encoded<T: Serialize>(value: &T) -> Result<String, RuntimeError> {
    snapback4_core::json_codec::to_text(value).map_err(|e| RuntimeError::Store(e.to_string()))
}

fn decoded<T: for<'de> Deserialize<'de>>(text: &str) -> Result<T, RuntimeError> {
    snapback4_core::json_codec::from_text(text).map_err(|e| RuntimeError::Store(e.to_string()))
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

pub(crate) fn reset_for_install<T: DeviceTx>(tx: &T, metadata: &BTreeMap<String, String>, drop_images: bool) -> Result<(), RuntimeError> {
    let old = meta_u64(tx, GENERATION)?;
    let changed = metadata.get(GENERATION).is_some_and(|new| new != &old.to_string());
    if drop_images || (old != 0 && changed) {
        // A generation changes the interpreter and invalidates its transfer,
        // not the incarnation that authenticated it or executed its receipts.
        let identity = tx.meta(deferred::IDENTITY)?;
        reset_publication(tx, !drop_images)?;
        deferred::stage_identity(tx, identity.as_deref())?;
    }
    Ok(())
}

// One lifecycle boundary for every private publication key: deferred cursor,
// effects/receipts, request capture, snapshot keys and staged rows always clear.
// keep_images controls only published replay evidence, never private progress.
fn reset_publication<T: DeviceTx>(tx: &T, keep_images: bool) -> Result<(), RuntimeError> {
    deferred::clear(tx)?;
    predictions::reset(tx, keep_images)?;
    snapshot::clear(tx)
}

impl<S: DeviceStore> Device<S> {
    /// The device over an opened store, for the backend the server sent —
    /// or, with none, for the backend kept from last time, so a device
    /// that starts with no network opens on what it holds. The schema is
    /// installed; a literal-default addition can keep older row images.
    pub fn open_store(store: S, backend: Option<Backend>) -> Result<Self, RuntimeError> {
        Self::open_store_mode(store, backend, false)
    }

    /// Open the kept backend, installing the supplied one only if still empty.
    /// A concurrent installer may win; it must never lose its replica evidence.
    pub fn open_store_initial(store: S, backend: Backend) -> Result<Self, RuntimeError> {
        Self::open_store_mode(store, Some(backend), true)
    }

    fn open_store_mode(mut store: S, backend: Option<Backend>, initial: bool) -> Result<Self, RuntimeError> {
        let kept = store.meta(BACKEND)?;
        let expected = if initial || backend.is_none() { BTreeMap::from([(BACKEND.to_owned(), kept.clone())]) } else { BTreeMap::new() };
        let mut backend = if backend.is_none() || (initial && kept.is_some()) {
            let text = kept.as_ref().ok_or_else(|| RuntimeError::Auth("this device has never synced: the server must be reachable once to open".into()))?;
            snapback4_core::json_codec::from_text(text).map_err(|e| RuntimeError::Store(format!("the kept backend does not parse: {e}")))?
        } else { backend.unwrap() };
        backend.schema.prepare_contribution_indexes();
        let held = store.meta(GENERATION)?.and_then(|g| g.parse::<u64>().ok()).unwrap_or(0);
        let reset = held != 0 && held != backend.generation;
        let previous = store.meta(BACKEND)?.and_then(|text| snapback4_core::json_codec::from_text::<Backend>(&text).ok());
        let keep_images = reset && previous.as_ref()
            .is_some_and(|old| snapback4_core::successor::keeps_literal_default_images(&old.schema, &backend.schema));
        let keep_acquired = keep_images && previous.as_ref().is_some_and(|old| old.schema.tables.len() == backend.schema.tables.len())
            && store.meta(ACQUIRED)? == Some(held.to_string());
        let backend_identity = store_identity::backend_identity(&backend);
        let mut metadata = BTreeMap::from([(BACKEND.to_owned(), encoded(&backend)?), (GENERATION.to_owned(), backend.generation.to_string()), (BACKEND_IDENTITY.to_owned(), backend_identity.clone())]);
        if reset {
            metadata.insert(WATERMARK.to_owned(), "0".into());
            metadata.insert(ACQUIRED.to_owned(), if keep_acquired { backend.generation.to_string() } else { String::new() });
            invalidate_native(&mut metadata);
            metadata.insert(history::GROUPS.to_owned(), "{}".into());
            metadata.insert(history::STAGED_GROUPS.to_owned(), "{}".into());
            metadata.insert(boundary::STAGED.to_owned(), "{}".into());
            if !keep_acquired { metadata.insert(boundary::BOUNDARIES.to_owned(), "{}".into()); }
        }
        // @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — consume the kept-backend/absence observation inside installation's transaction.
        store.install_checked(&backend.schema, &metadata, reset && !keep_images, &expected)?;
        // @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — a recovered request cannot
        // reuse a declaration from before a teardown send whose host-persisted
        // revision was lost. Published replay evidence and private pages stay.
        let tx = store.transaction()?;
        predictions::abandon_capture(&tx)?;
        tx.commit()?;
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
        let store_identity = store.meta(STORE_ID)?;
        Ok(Self {
            store,
            schema: backend.schema,
            programs: backend.programs.into_iter().map(|p| (p.name.clone(), p)).collect(),
            generation: backend.generation,
            backend_identity,
            store_identity,
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
            store_identity::require_backend(&tx, &self.backend_identity, &self.store_identity)?;
            store_identity::require_healthy(&tx)?;
            if tx.meta(BACKEND_REQUIRED)?.is_some_and(|value| !value.is_empty()) {
                return Err(RuntimeError::Prediction("this store's backend has not been adopted; reconnect to acquire it".into()));
            }
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
        self.adopt_captured(backend, BTreeMap::new())
    }

    pub fn adopt_captured(&mut self, mut backend: Backend, mut expected: BTreeMap<String, Option<String>>) -> Result<(), RuntimeError> {
        backend.schema.prepare_contribution_indexes();
        let required = self.store.meta(BACKEND_REQUIRED)?;
        expected.entry(BACKEND_REQUIRED.into()).or_insert(required.clone());
        expected.entry(STORE_ID.into()).or_insert(self.store.meta(STORE_ID)?);
        expected.entry(SEND_REVISION.into()).or_insert(self.store.meta(SEND_REVISION)?);
        let adopted_store = expected.get(STORE_ID).cloned().flatten();
        let cached_native = self.store.meta(NATIVE_DIGEST)?;
        expected.entry(NATIVE_DIGEST.into()).or_insert(cached_native.clone());
        let obsolete_native = adopted_store != self.store_identity || cached_native.filter(|s| !s.is_empty()).as_deref() != self.native_digest.as_deref();
        let replacement = required.as_ref().is_some_and(|value| !value.is_empty());
        let reset = backend.generation != self.generation;
        let keep_images = snapback4_core::successor::keeps_literal_default_images(&self.schema, &backend.schema);
        // @ref LLP 3000.007#18.3 — literal-default-only evolution keeps already acquired images readable.
        // The image predicate permits added tables; those require acquisition.
        let keep_acquired = keep_images && self.schema.tables.len() == backend.schema.tables.len()
            && self.store.meta(ACQUIRED)? == Some(self.generation.to_string());
        let backend_identity = store_identity::backend_identity(&backend);
        let mut metadata = BTreeMap::from([(BACKEND.to_owned(), encoded(&backend)?), (GENERATION.to_owned(), backend.generation.to_string()), (BACKEND_IDENTITY.to_owned(), backend_identity.clone())]);
        metadata.insert(BACKEND_REQUIRED.to_owned(), String::new());
        if reset {
            metadata.insert(WATERMARK.to_owned(), "0".into());
            metadata.insert(ACQUIRED.to_owned(), if keep_acquired { backend.generation.to_string() } else { String::new() });
            invalidate_native(&mut metadata);
            metadata.insert(history::GROUPS.to_owned(), "{}".into());
            metadata.insert(history::STAGED_GROUPS.to_owned(), "{}".into());
            metadata.insert(boundary::STAGED.to_owned(), "{}".into());
            if !keep_acquired { metadata.insert(boundary::BOUNDARIES.to_owned(), "{}".into()); }
        }
        if replacement { invalidate_native(&mut metadata); }
        self.store.install_checked(&backend.schema, &metadata, reset && !keep_images, &expected)?;
        if reset || replacement || obsolete_native {
            #[cfg(feature = "wasm-host")]
            {
                self.native = None;
            }
            self.native_digest = None;
        }
        self.schema = backend.schema;
        self.programs = backend.programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        self.generation = backend.generation;
        self.backend_identity = backend_identity;
        self.store_identity = adopted_store;
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
        store_identity::require_healthy(&tx)?;
        let revision = meta_u64(&tx, SEND_REVISION)?.checked_add(1).filter(|n| *n <= 9_007_199_254_740_991).ok_or_else(|| RuntimeError::Store("send revision overflow".into()))?;
        tx.set_meta(SEND_REVISION, &revision.to_string())?;
        // A send invalidates snapshot paging, but a terminal snapshot already
        // owns a live catch-up cut. Keep it and bind future catch-up to this send.
        let paging = tx.meta(SNAPSHOT_NEXT)?.is_some_and(|next| !next.is_empty());
        if paging { snapshot::clear(&tx)?; }
        else if tx.meta(SNAPSHOT_OWNER)?.is_some() { tx.set_meta(SNAPSHOT_SEND_REVISION, &revision.to_string())?; }
        tx.commit()?;
        if paging { self.snapshot_owner = None; }
        Ok(revision)
    }

    /// What a sync request is made from: the watermark, the generation,
    /// the writes sent but not yet seen, and the send revision.
    pub fn sync_state(&mut self) -> Result<SyncState, RuntimeError> {
        self.sync_state_inner(true)
    }

    /// Inspect current progress without declaring a new in-flight request.
    pub fn sync_state_read(&mut self) -> Result<SyncState, RuntimeError> {
        self.sync_state_inner(false)
    }

    fn sync_state_inner(&mut self, capture_request: bool) -> Result<SyncState, RuntimeError> {
        let tx = if capture_request { self.store.transaction()? } else { self.store.read_transaction()? };
        let capture = if capture_request { predictions::capture(&tx)? } else { predictions::pending_capture(&tx)? };
        let (pending_through, pending_complete, pending_bound) = capture.declaration;
        let pending_ids = capture.ids;
        // Snapshot continuation requests still use from=0; after its terminal
        // page, catch-up starts at its staged cut. A reopened owner restarts it.
        let snapshot_transfer = if self.snapshot_owner.is_some() && tx.meta(SNAPSHOT_OWNER)? == self.snapshot_owner
            && tx.meta(SNAPSHOT_NEXT)?.as_deref() == Some("") { Some(meta_u64(&tx, SNAPSHOT_THROUGH)?) } else { None };
        let restore_refusal = tx.meta(store_identity::RESTORE_REFUSED)?.map(|_| store_identity::restore_error().refusal());
        // @ref LLP 3000.007#18.2 — expose acquisition for this healthy owner, never a superseded store's marker.
        let acquired = restore_refusal.is_none() && tx.meta(ACQUIRED)? == Some(self.generation.to_string());
        let mut state = SyncState { acquired, backend_required: tx.meta(BACKEND_REQUIRED)?.is_some_and(|value| !value.is_empty()) || store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref()).is_err(), restore_refusal, store_id: tx.meta(STORE_ID)?, watermark: meta_u64(&tx, WATERMARK)?, generation: self.generation, pending_ids, pending_through, pending_complete, pending_bound, transfer_watermark: deferred::cursor(&tx)?.or(snapshot_transfer).unwrap_or(meta_u64(&tx, WATERMARK)?), restore_watermark: store_identity::restore_cursor(&tx)?.unwrap_or(meta_u64(&tx, WATERMARK)?), snapshot_catchup: snapshot_transfer.is_some(), restore_images_at: store_identity::restore_images_at(&tx)?, adoption_capture: store_identity::adoption_capture(&tx)?, transfer_store_id: tx.meta(deferred::IDENTITY)?.or(tx.meta(STORE_ID)?), send_revision: meta_u64(&tx, SEND_REVISION)? };
        state.acquired &= !state.backend_required;
        if capture_request { tx.commit()?; } else { tx.rollback()?; }
        Ok(state)
    }

    /// Drop every row and index entry, the images and the staged snapshot;
    /// the watermark resets, the outbox stays.
    pub fn clear_rows(&mut self) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        tx.clear_rows()?;
        tx.base_clear()?;
        let identity = tx.meta(deferred::IDENTITY)?;
        reset_publication(&tx, false)?;
        deferred::stage_identity(&tx, identity.as_deref())?;
        tx.set_meta(WATERMARK, "0")?;
        tx.delete_meta(&[ACQUIRED])?;
        tx.delete_meta(&[history::GROUPS, boundary::BOUNDARIES, boundary::REPORT])?;
        tx.commit()?;
        self.snapshot_owner = None;
        Ok(())
    }

    /// Apply one page atomically. A paged snapshot stages separately; its
    /// last page atomically replaces the confirmed partition and rebases
    /// every remaining prediction. Returns the tables touched.
    /// Requests must use `sync_state().transfer_watermark`; an empty result
    /// can mean private progress. `apply_publication` also reports publication.
    pub fn apply(&mut self, page: &StreamPage, first: bool) -> Result<Vec<String>, RuntimeError> {
        self.apply_publication(page, first).map(|(touched, _)| touched)
    }

    pub fn apply_publication(&mut self, page: &StreamPage, first: bool) -> Result<(Vec<String>, bool), RuntimeError> {
        let result = self.apply_publication_inner(page, first);
        if result.is_err() { let _ = self.reject_sync_capture(page); }
        result
    }

    fn reject_sync_capture(&mut self, page: &StreamPage) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        predictions::reject_capture(&tx, page)?;
        tx.commit()
    }

    fn apply_publication_inner(&mut self, page: &StreamPage, first: bool) -> Result<(Vec<String>, bool), RuntimeError> {
        let tx = self.store.transaction()?;
        let observed = store_identity::observe(&tx, page, false)?;
        if observed.restore_refused {
            tx.commit()?;
            return Err(store_identity::restore_error());
        }
        if observed.reset {
            tx.commit()?;
            self.snapshot_owner = None;
            return Err(RuntimeError::Generation("the backend store was replaced; reacquire its partition".into()));
        }
        if observed.backend_required || store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref()).is_err() {
            return Err(RuntimeError::Generation("the backend store requires backend adoption before acquisition".into()));
        }
        if page.generation.is_some_and(|g| g != self.generation) {
            return Err(RuntimeError::Generation("stale device page".into()));
        }
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
        if observed.send_revision != send_revision {
            return Err(RuntimeError::Generation("a mutation send overlapped the sync response; retry sync".into()));
        }
        let watermark = meta_u64(&tx, WATERMARK)?;
        if page.watermark < watermark {
            return Err(RuntimeError::Generation("device watermark would move backwards".into()));
        }
        deferred::validate(page)?;
        let declaration = predictions::declaration(&tx, page)?;
        let mut touched = BTreeSet::new();
        let replacing = page.snapshot || page.snapshot_catchup;
        let transfer = deferred::cursor(&tx)?.unwrap_or(watermark);
        // Snapshot pages are requested from zero with an opaque continuation;
        // only their log catch-up requests the staged cut.
        let requested = if page.snapshot { 0 } else if page.snapshot_catchup { meta_u64(&tx, SNAPSHOT_THROUGH)? } else { transfer };
        let first_replacement = page.snapshot && first;
        let from_ok = first_replacement || match page.requested_watermark {
            Some(from) => from == requested,
            // Snapshot ownership/continuation and its own monotonic floor still
            // fence catch-up. Only an advanced ordinary slot requires an echo.
            None => transfer == watermark,
        };
        if !from_ok || page.watermark < requested {
            return Err(RuntimeError::Generation("obsolete deferred transfer page; retry sync".into()));
        }
        let defer = deferred::should_defer(&tx, &self.programs, page, watermark, declaration)?;
        if !replacing && defer {
            deferred::stage(&tx, &self.schema, self.generation, page)?;
            predictions::clear_capture(&tx)?;
            tx.commit()?;
            return Ok((Vec::new(), false));
        }
        if replacing {
            if page.snapshot && first {
                let images_at = store_identity::restore_images_at(&tx)?;
                tx.staged_clear()?;
                tx.delete_meta(&[SNAPSHOT_ACKS, SNAPSHOT_IMAGES_AT])?;
                // @ref LLP 3000.001#authoritative-replacement-disposes-of-the-deferred-slot — an authoritative replacement discards private effects and their receipts together.
                // Keep incarnation and maximum head evidence, but publish no
                // old effects and retire no prediction as part of disposal.
                let identity = tx.meta(deferred::IDENTITY)?;
                deferred::clear(&tx)?;
                deferred::stage_identity(&tx, identity.as_deref())?;
                tx.set_meta(SNAPSHOT_IMAGES_AT, &images_at.to_string())?;
                snapshot::retain(&tx, &self.schema, page.held.as_ref())?;
                boundary::retain(&tx, &self.schema)?;
                tx.set_meta(SNAPSHOT_WATERMARK, &page.watermark.to_string())?;
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
            snapshot::continuation(&tx, page, first)?;
            snapshot::stage(&tx, &self.schema, page)?;
            history::events(&tx, &self.schema, &page.events, &page.joined, true)?;
            tx.set_meta(SNAPSHOT_THROUGH, &page.watermark.to_string())?;
            tx.set_meta(SNAPSHOT_IMAGES_AT, &meta_u64(&tx, SNAPSHOT_IMAGES_AT)?.max(page.images_at.unwrap_or(page.watermark)).to_string())?;
            let mut acks: BTreeMap<String, u64> = tx.meta(SNAPSHOT_ACKS)?.map(|s| decoded(&s)).transpose()?.unwrap_or_default();
            acks.extend(page.acknowledged.clone());
            tx.set_meta(SNAPSHOT_ACKS, &encoded(&acks)?)?;
            // Paged snapshots read different server transactions. Keep every
            // image private until log catch-up repairs intervening commits.
            if page.more || (page.snapshot && page.stage_snapshot) {
                predictions::clear_capture(&tx)?;
                tx.commit()?;
                self.snapshot_owner = owner;
                return Ok((Vec::new(), false));
            }
        }
        // Only publication promotes the first authenticated identity/revision.
        // Resolve it before consuming the slot, including an omitted page id.
        store_identity::observe(&tx, page, true)?;
        let owner_store = tx.meta(STORE_ID)?;
        let mut acknowledgements = page.acknowledged.clone();
        if replacing {
            let staged: BTreeMap<String, u64> = tx.meta(SNAPSHOT_ACKS)?.map(|s| decoded(&s)).transpose()?.unwrap_or_default();
            acknowledgements.extend(staged);
            touched.extend(page.joined.keys().cloned());
            touched.extend(page.acquisitions.iter().map(|marker| marker.table.clone()));
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
            boundary::Boundaries::load(&tx, true)?.save(&tx, false)?;
            snapshot::clear(&tx)?;
            // Consume private identity after promotion; ordinary effects and
            // receipts were discarded when this replacement started.
            deferred::clear(&tx)?;
        } else {
            let mut installed = deferred::install(&tx, &self.schema, &mut touched)?;
            installed.extend(acknowledgements);
            acknowledgements = installed;
            deferred::events(&tx, &self.schema, self.generation, page, &mut touched)?;
        }
        debug_assert!(tx.meta_prefix(deferred::PREFIX)?.is_empty(), "publication requires a disposed deferred slot");
        tx.set_meta(WATERMARK, &page.watermark.to_string())?;
        // @ref LLP 3000.008.001#2-three-facts-to-distinguish — schema availability is not acquisition.
        // A staged snapshot reaches here only after catch-up publishes its
        // confirmed rows. Commit readiness with those rows, even at seq zero;
        // a later interrupted refresh retains the prior acquired partition.
        if !page.more { tx.set_meta(ACQUIRED, &self.generation.to_string())?; }
        deferred::acknowledge(&tx, page.watermark, &acknowledgements)?;
        predictions::publish_declaration(&tx, declaration)?;
        predictions::replay(&tx, &self.schema, &self.programs, page.watermark)?;
        tx.commit()?;
        self.store_identity = owner_store.clone();
        if replacing {
            self.snapshot_owner = None;
        }
        Ok((touched.into_iter().collect(), true))
    }

    /// Whether apply still has private effects; an empty touched set alone
    /// says nothing about publication (an empty terminal page can publish).
    pub fn publication_pending(&self) -> Result<bool, RuntimeError> {
        Ok(self.store.meta(deferred::ACKS)?.is_some() || self.store.meta(SNAPSHOT_OWNER)?.is_some())
    }

    /// A query over the device's rows, with the device's words.
    pub fn query(&mut self, name: &str, viewer: &str, args: &serde_json::Value, now: i64) -> Result<QueryOutcome, Refusal> {
        self.query_with_coverage(name, viewer, args, now).0
    }

    /// The query, and whether it touched something the device does not
    /// hold (an online-only table, a row past the horizon).
    pub fn query_with_coverage(&mut self, name: &str, viewer: &str, args: &serde_json::Value, now: i64) -> (Result<QueryOutcome, Refusal>, bool, bool) {
        let (result, unknown, retained, _) = self.query_observation(name, viewer, args, now, false);
        (result, unknown, retained)
    }

    pub fn query_with_components(&mut self, name: &str, viewer: &str, args: &serde_json::Value, now: i64) -> (Result<QueryOutcome, Refusal>, bool, bool, std::collections::BTreeMap<String, snapback4_core::engine::components::Coverage>) {
        self.query_observation(name, viewer, args, now, true)
    }

    fn query_observation(&mut self, name: &str, viewer: &str, args: &serde_json::Value, now: i64, observe_components: bool) -> (Result<QueryOutcome, Refusal>, bool, bool, std::collections::BTreeMap<String, snapback4_core::engine::components::Coverage>) {
        let mut unknown = false;
        let mut retained = false;
        let mut components = Default::default();
        let result = (|| {
            let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?;
            let context = Context::new(viewer, typed_args(&program, args)?).at(now).with_generation(self.generation);
            let tx = self.store.read_transaction()?;
            if let Err(error) = store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref()) {
                unknown = true;
                return Err(error.refusal());
            }
            if let Err(error) = require_acquired(&tx, &self.schema, &program) {
                unknown = matches!(&error, RuntimeError::Prediction(_));
                return Err(error.refusal());
            }
            let reading = history::Reading { tx: &tx, schema: &self.schema, groups: history::load(&tx, history::GROUPS)?, boundaries: boundary::Boundaries::load(&tx, false)?, retained: std::cell::Cell::new(false) };
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
            } else if !observe_components {
                local::query_with_coverage(&reading, &self.schema, &program, context, Ceilings::default())
            } else {
                let (result, unknown, retained, coverage) = local::query_with_components(&reading, &self.schema, &program, context, Ceilings::default());
                components = coverage;
                (result, unknown, retained)
            };
            unknown = coverage;
            retained = reading.retained.get() && history_only;
            drop(reading);
            tx.rollback()?;
            result
        })();
        (result, unknown, retained, components)
    }

    /// Predict a mutation: its rows land in the store marked `pending`, in
    /// one transaction that a refusal rolls back whole.
    pub fn predict(&mut self, name: &str, viewer: &str, args: &serde_json::Value, now: i64, new_ids: Vec<String>, entropy: u64) -> Result<Predicted, RuntimeError> {
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?;
        let tx = self.store.transaction()?;
        store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref())?;
        require_acquired(&tx, &self.schema, &program)?;
        let context = Context::new(viewer, media::inputs(&tx, &program, viewer, args)?).at(now).with_generation(self.generation).with_ids(new_ids).with_entropy(entropy.max(1));
        let predicting = Predicting { tx: &tx, schema: &self.schema, groups: history::load(&tx, history::GROUPS)?, boundaries: boundary::Boundaries::load(&tx, false)?, written: RefCell::new(Vec::new()) };
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
        store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref())?;
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
    pub fn admit(&mut self, entry: Queued) -> Result<Queued, RuntimeError> {
        self.admit_with_replay(entry, false)
    }

    /// A caller-supplied id may already have executed beyond the local receipt
    /// window. Its prediction refusal cannot decide the server's replay outcome.
    pub fn admit_with_replay(&mut self, mut entry: Queued, replay_candidate: bool) -> Result<Queued, RuntimeError> {
        let tx = self.store.transaction()?;
        store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref())?;
        store_identity::require_healthy(&tx)?;
        // @ref LLP 3000#6-the-simulators-invariants — at-most-once admission compares under the store's writer transaction, before any speculative row or id changes.
        if let Some(data) = tx.outbox_get(&entry.id)? {
            let original: Queued = decoded(&data)?;
            if original.op != entry.op || original.args != entry.args || original.viewer != entry.viewer {
                return Err(RuntimeError::Structural { code: "E_WRITE_ID_REUSE", message: "write id already belongs to a different operation or arguments; retry the original input or use a new id".into() });
            }
            tx.rollback()?;
            return Ok(original);
        }
        let program = self.programs.get(&entry.op);
        match program {
            Some(program) if program.kind == snapback4_core::ProgramKind::Action && !replay_candidate => return Err(RuntimeError::UnknownOp("an action cannot enter the device outbox; call client.act".into())),
            None if !replay_candidate => return Err(RuntimeError::UnknownOp(entry.op.clone())),
            _ => {}
        }
        entry.seq = entry.seq.max(tx.outbox_max_seq()?.max(meta_u64(&tx, SUBMISSION)?) + 1);
        entry.predictable &= program.is_some_and(|p| p.kind == snapback4_core::ProgramKind::Mutation);
        if entry.predictable {
            tx.savepoint("admit")?;
            match predictions::run(&tx, &self.schema, program.unwrap(), &entry) {
                Ok((predicted, new_ids)) => {
                    entry.predicted = predicted;
                    entry.new_ids = new_ids;
                    entry.predictable = true;
                    tx.release("admit")?;
                }
                Err(error) if matches!(error, RuntimeError::Prediction(_)) || (replay_candidate && error.is_refusal()) => {
                    tx.rollback_to("admit")?;
                    entry.predictable = false;
                    entry.predicted.clear();
                }
                Err(error) => return Err(error),
            }
        }
        tx.outbox_insert(entry.seq, &entry.id, &encoded(&entry)?)?;
        tx.set_meta(SUBMISSION, &entry.seq.to_string())?;
        tx.commit()?;
        Ok(entry)
    }

    /// The server answered a write: sent at `seq` (the entry waits for the
    /// stream to carry it) or refused (`None`: the entry goes); the
    /// survivors are replayed over the confirmed images.
    pub fn settle(&mut self, id: &str, seq: Option<u64>) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref())?;
        let watermark = meta_u64(&tx, WATERMARK)?;
        predictions::restore(&tx, &self.schema)?;
        match seq {
            Some(seq) => {
                let data = tx.outbox_get(id)?.ok_or_else(|| RuntimeError::Store(format!("the outbox holds no write {id}")))?;
                let mut entry: Queued = decoded(&data)?;
                predictions::record_receipt(&tx, &mut entry, seq, false)?;
            }
            None => predictions::remove(&tx, id)?,
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
        predictions::restore(&tx, &self.schema)?;
        predictions::remove(&tx, id)?;
        predictions::replay(&tx, &self.schema, &self.programs, meta_u64(&tx, WATERMARK)?)?;
        tx.commit()
    }

    /// A key the JavaScript client keeps beside the rows (a session's mark, the last sync).
    pub fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        self.store.meta(&format!("client:{key}"))
    }

    pub fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.store.set_meta(&format!("client:{key}"), value)
    }

    /// Replace the bounded terminal history atomically, also across native owners.
    /// An adopted list precedes the destination window, which wins id collisions.
    /// Unresolved writes live independently in the executable outbox.
    // @ref LLP 3000.007#20.4 — receipt retention cannot evict an unresolved durable write.
    pub fn keep_write(&mut self, value: &str) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        store_identity::keep_write(&tx, value)?;
        tx.commit()
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

#[cfg(test)]
mod publication_tests;

#[cfg(test)]
mod opening_tests;

#[cfg(all(test, feature = "native"))]
mod publication_round5;

#[cfg(all(test, feature = "native"))]
mod publication_round6;

#[cfg(all(test, feature = "native"))]
mod publication_round7;
