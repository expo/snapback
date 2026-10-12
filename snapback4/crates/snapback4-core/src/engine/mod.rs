//! The engine: one program, one principal, one SQLite transaction. A query
//! reads under the meter and returns `complete` or `capped`; a mutation
//! writes under the meter and returns `sent` with its sequence or `failed`
//! with a refusal, and applies at most once per client-minted id.

#[cfg(feature = "sqlite")]
pub mod effects;
#[cfg(feature = "sqlite")]
mod asset_columns;
mod write_reservations;
#[cfg(feature = "sqlite")]
pub mod ephemeral;
#[cfg(feature = "sqlite")]
mod effect_steps;
#[cfg(feature = "sqlite")]
pub mod actions;
#[cfg(feature = "sqlite")]
pub(crate) mod steps;
#[cfg(feature = "sqlite")]
pub mod routes;
#[cfg(feature = "sqlite")]
pub mod job;
#[cfg(feature = "wasm-host")]
pub mod native;
pub mod local;
pub mod components;
pub mod prediction;
#[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
pub mod admission;
#[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
mod read_only;
#[cfg(feature = "sqlite")]
mod job_reads;
mod pages;
mod search_decoration;
pub use pages::drain_cursor;
pub use pages::expression_page_site;
mod shaping;
#[cfg(feature = "sqlite")]
pub(crate) struct ImportInput(());
pub use pages::{returned_page_sites, uncontinued_page_sites};
pub mod read;
pub(crate) use runner::extrema;
mod read_auth;
mod aggregate_expiry;
pub(crate) mod authorized_scan;
pub use authorized_scan::{Authorization, InternalLedger, InternalMeter};
pub(crate) mod authorized_point;
mod read_point;
#[cfg(all(test, feature = "sqlite"))]
mod read_candidate;
mod provenance;
#[cfg(feature = "sqlite")]
pub mod delivery;
mod expiry;
pub mod rules;
mod rule_reference;
#[cfg(test)]
mod qe2_allocation_tests;
#[cfg(all(test, feature = "sqlite"))]
mod null_point_tests;
pub mod runner;
pub mod validate;
pub mod write;
mod field_authority;
#[cfg(test)]
#[cfg(feature = "sqlite")]
mod field_authority_tests;
mod maintains;
pub mod row_views;
mod live_aggregate;
pub(crate) mod timeline;
mod timeline_authority;
mod recorded;
mod sequences;
pub(crate) mod through;
mod through_read;
#[cfg(feature = "sqlite")]
pub mod through_activation;
pub(crate) mod columns;
#[cfg(feature = "sqlite")]
mod column_activation;
#[cfg(feature = "sqlite")]
pub use recorded::RecordedNulls;
use write::target as write_target;
pub(crate) use write_target::row_copy_ceiling;
mod receipt;
pub mod refusal_trace;
#[cfg(test)]
#[cfg(feature = "sqlite")]
mod retire_tests;
#[cfg(test)]
#[cfg(feature = "sqlite")]
mod aggregate_metadata_tests;
pub(crate) mod presence;
#[cfg(feature = "postgres")]
pub mod postgres;

#[cfg(feature = "sqlite")]
use crate::assets::{self, Asset, AssetKind, asset_id};
use crate::error::{MeterKind, Refusal};
#[cfg(feature = "sqlite")]
use crate::error::RuntimeError;
#[cfg(feature = "sqlite")]
use crate::ir::{Program, ProgramKind};
use crate::meter::Metered;
#[cfg(feature = "sqlite")]
use crate::meter::{Ceilings, Cut, Meter};
#[cfg(feature = "sqlite")]
use crate::partition::{self, Event};
#[cfg(feature = "sqlite")]
use crate::schema::{ColumnType, Effect, Schema, materialize_optional_fields};
#[cfg(feature = "sqlite")]
use crate::store::Store;
use crate::value::Value;
#[cfg(feature = "sqlite")]
use runner::Runner;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

// @ref LLP 3000.007#21.3 — the host and abstract presence providers share one confirmation window on the commit clock.
pub const PRESENCE_GRACE: std::time::Duration = std::time::Duration::from_secs(35);
pub const PRESENCE_CONFIRMATION: std::time::Duration = std::time::Duration::from_secs(5);
/// How soon a client re-runs a live query that read `connected[p]`. Presence
/// changes without a commit, so no change feed names it (LLP 3000.018 §3).
pub const PRESENCE_REFRESH: std::time::Duration = std::time::Duration::from_secs(5);

/// Who is connected right now: what a server knows from the long polls it
/// holds open, answered to a program's `connected[p]`. Only a server has
/// one; a device treats every principal as connected and lets the server
/// decide (`Runner::presence_unknown`).
pub trait Presence: std::fmt::Debug + Send + Sync {
    /// How many connections `principal` holds open now.
    fn connections(&self, principal: &str) -> u64;
    /// A single observation: (live connections, grace deadline in engine time).
    fn effect_presence(&self, principal: &str) -> (u64, Option<i64>) { (self.connections(principal), None) }
    /// Pin an unconfirmed poll's deadline to the mutation's commit clock.
    fn effect_presence_at(&self, principal: &str, now: i64) -> (u64, Option<i64>) {
        let (live, deadline) = self.effect_presence(principal);
        (live, if live > 0 { Some(now.saturating_add(PRESENCE_CONFIRMATION.as_millis() as i64)) } else { deadline })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadMode { Import, Restore }

/// Who runs the program, with what, and when.
#[derive(Clone, Debug)]
pub struct Context {
    #[cfg(feature = "sqlite")]
    pub(crate) refusal_trace: Option<refusal_trace::RefusalTrace>,
    pub retained_search: bool,
    /// Bounded retained ordering keys supplied by the coordinator, never authority.
    #[cfg(feature = "server-search")]
    pub search_retained_order: Option<(Vec<i64>, bool)>,
    #[cfg(feature = "server-search")]
    pub(crate) search_retained_candidates: Vec<(String, i64, bool)>,
    pub read_spent: Option<crate::meter::Metered>,
    pub viewer: String,
    pub kind: String,
    pub args: BTreeMap<String, Value>,
    pub now: Option<i64>,
    pub read_time: Option<i64>,
    pub(crate) row_provenance: bool,
    /// Digest only: the core resolves it in the admission transaction.
    pub(crate) session_digest: Option<String>,
    /// Original HTTP arguments, before typed decoding or default insertion.
    pub wire_args: Option<serde_json::Value>,
    #[cfg(feature = "sqlite")]
    pub delivery_fingerprint: Option<String>,
    pub(crate) generation: u64,
    /// Ids the caller minted for this run, consumed in order by `new`.
    pub new_ids: VecDeque<String>,
    entropy: u64,
    /// Every id consumed by this execution, including newly minted ids.
    pub(crate) minted_ids: Vec<String>,
    /// The server's live registry behind `connected[p]`, when there is one.
    pub presence: Option<std::sync::Arc<dyn Presence>>,
}


impl Context {
    pub fn new(viewer: impl Into<String>, args: BTreeMap<String, Value>) -> Self {
        Self { #[cfg(feature = "sqlite")] refusal_trace: None, #[cfg(feature = "server-search")] search_retained_order: None, #[cfg(feature = "server-search")] search_retained_candidates: Vec::new(), retained_search: false, read_spent: None, viewer: viewer.into(), kind: "user".into(), args, now: None, read_time: None, row_provenance: false, session_digest: None, wire_args: None, #[cfg(feature = "sqlite")] delivery_fingerprint: None, generation: 0, new_ids: VecDeque::new(), entropy: 0, minted_ids: Vec::new(), presence: None }
    }

    #[cfg(feature = "sqlite")]
    pub fn with_session(mut self, token: &str) -> Self {
        self.session_digest = Some(crate::identity::digest(token));
        self
    }

    /// Developer host instrumentation; never accepted from wire arguments.
    #[cfg(feature = "sqlite")]
    pub fn with_refusal_trace(mut self, trace: refusal_trace::RefusalTrace) -> Self {
        self.refusal_trace = Some(trace); self
    }

    /// Request the metered, output-only source-identity envelope for a query.
    pub fn with_row_provenance(mut self) -> Self { self.row_provenance = true; self }

    pub fn with_wire_args(mut self, args: serde_json::Value) -> Self {
        self.wire_args = Some(args);
        self
    }

    /// The host supplies its active backend generation for opaque page cursors.
    pub fn with_generation(mut self, generation: u64) -> Self { self.generation = generation; self }

    pub fn with_presence(mut self, presence: Option<std::sync::Arc<dyn Presence>>) -> Self {
        self.presence = presence;
        self
    }

    pub fn system() -> Self {
        let mut context = Self::new(crate::SYSTEM_PRINCIPAL, BTreeMap::new());
        context.kind = "system".into();
        context
    }

    pub fn at(mut self, now: i64) -> Self {
        self.now = Some(now);
        self
    }

    pub fn with_ids(mut self, ids: impl IntoIterator<Item = String>) -> Self {
        self.new_ids = ids.into_iter().collect();
        self
    }

    pub fn with_entropy(mut self, entropy: u64) -> Self {
        self.entropy = entropy;
        self
    }

    pub fn is_system(&self) -> bool {
        self.viewer == crate::SYSTEM_PRINCIPAL
    }

    pub(crate) fn mint(&mut self) -> Result<String, crate::RuntimeError> {
        let id = if let Some(id) = self.new_ids.pop_front() { id } else {
            if self.entropy == 0 { self.entropy = crate::ids::seed(); }
            crate::ids::mint(self.now.unwrap_or(0), &mut self.entropy)?
        };
        self.minted_ids.push(id.clone());
        Ok(id)
    }
}

/// Disclosed cut reason; non-uniform server reads withhold it. Sites and
/// counters remain operator detail.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReadCut { Meter, Words }

// @ref LLP 3000.007#20.22.7 — held search stays on the device; server search uses the grouped or newest form.
#[cfg(any(feature = "sqlite", feature = "postgres"))]
pub(crate) fn server_query_allowed(schema: &crate::schema::Schema, name: &str) -> Result<(), Refusal> {
    if schema.operations.get(name).is_some_and(|fact| fact.held) {
        return Err(Refusal::new("E_QUERY_HELD", "residency", format!("query {name} is held: it runs only on the device"))
            .rewrite("call this query with the local client; for server search, use the grouped or newest form in `snapback4 guide search`, section \"Search every chat I'm in\"")
            .guide("search"));
    }
    Ok(())
}

/// A query's outcome: the card's read, minus `fresh` (transport truth).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueryOutcome {
    /// Complete, authorized current audience of an inferred ordinary search.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_scopes: Option<Vec<String>>,
    /// Source ordering keys, separate from an arbitrary presentation projection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_rows: Option<Value>,
    /// Value reobservation only; never withdraws the source page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decoration_expiry: Option<i64>,
    #[cfg(feature = "sqlite")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery: Option<delivery::Manifest>,
    #[cfg(feature = "sqlite")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_meter: Option<delivery::DeliveryMeter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ephemeral: Option<crate::schema::ephemeral::Version>,
    pub data: Value,
    /// Evaluation stopped before producing a value. `data` is only an internal
    /// placeholder; client transports publish loading, never a ready null.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unavailable: bool,
    pub complete: bool,
    pub cut: Option<ReadCut>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capped_at: Option<(MeterKind, String)>,
    /// Operator detail: a scope passed the word bound, independently of the meter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word_cut_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
    /// The store's sequence when the read ran.
    pub seq: u64,
    pub metered: Metered,
    pub tables: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_expiry: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "sqlite", derive(Deserialize))]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum WriteState {
    Sent { seq: u64, result: Value },
    Failed { why: Refusal, #[serde(default, skip_serializing_if = "Option::is_none")] current: Option<Value> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "sqlite", derive(Deserialize))]
pub struct MutationOutcome {
    /// A delivery report retained only a receipt; persists across replay.
    #[serde(skip)]
    pub receipt_only: bool,
    #[serde(flatten)]
    pub state: WriteState,
    pub metered: Metered,
    pub tables: Vec<String>,
    /// Source/ordinary events only; private row-keyed recipient changes are not observable.
    pub events: usize,
    /// Whether this call applied the write, or found it already applied.
    pub replayed: bool,
}

/// Leave to serve an asset's bytes: where they are and what they are.
#[cfg(feature = "sqlite")]
#[derive(Clone, Debug)]
pub struct AssetGrant {
    /// Store identity captured in the same transaction as the placement grant.
    pub store_id: String,
    /// Ledger-confirmed placement; upload previews have no home.
    pub home: Option<(String, String, String)>,
    pub path: std::path::PathBuf,
    pub content_type: String,
    pub bytes: u64,
    /// One view: never cache it anywhere.
    pub once: bool,
    /// `File` is served only as an attachment (LLP 3000.038 §5).
    pub kind: AssetKind,
    /// A file's stored filename.
    pub name: Option<String>,
}

#[cfg(feature = "sqlite")]
pub struct Engine {
    timeline_schedule: timeline::Schedule,
    ephemeral: std::sync::Arc<ephemeral::Hub>,
    store: Store,
    schema: Schema,
    programs: BTreeMap<String, Program>,
    ceilings: Ceilings,
    entropy: u64,
    generation: u64,
    /// Dev engines may consult replay policy; release engines never suppress effects.
    dev_effects: bool,
    /// The app's native module, once installed (LLP 3000.005).
    #[cfg(feature = "native")]
    native: Option<std::sync::Arc<native::Module>>,
    /// Lines native jobs logged, for the host to print.
    #[cfg(feature = "native")]
    native_logs: native::Logs,
    /// The server's registry of open connections, given to every context
    /// that does not bring its own; none in tests and `run`.
    presence: Option<std::sync::Arc<dyn Presence>>,
}

#[cfg(feature = "sqlite")]
impl Engine {
    pub fn new(store: Store, schema: Schema, programs: impl IntoIterator<Item = Program>) -> Result<Self, RuntimeError> {
        Self::new_at(store, schema, programs, crate::now_ms())
    }

    /// Activate using the owning host's clock for parent liveness and captures.
    pub fn new_at(mut store: Store, mut schema: Schema, programs: impl IntoIterator<Item = Program>, now: i64) -> Result<Self, RuntimeError> {
        columns::validate_before_prepare(&schema)?;
        schema.check_row_view_audiences()?;
        schema.prepare_contribution_indexes();
        schema.prepare_delivery_lookup();
        let issues = crate::schema::validate(&schema);
        if let Some(issue) = issues.first() {
            return Err(RuntimeError::Schema(format!("{}: {}", issue.path, issue.message)));
        }
        let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        let (generation, metadata) = Self::activate(&mut store, &schema, &programs, None, now, true, None, None)?;
        let dev_effects = metadata.dev_effects;
        store.exclude_ephemeral(&schema);
        Ok(Self { timeline_schedule: timeline::Schedule::default(), ephemeral: std::sync::Arc::new(ephemeral::Hub::new(metadata.store_id, generation, &schema)), store, schema, programs, generation, dev_effects, ceilings: Ceilings::default(), entropy: crate::ids::seed(), #[cfg(feature = "native")] native: None, #[cfg(feature = "native")] native_logs: native::Logs::default(), presence: None })
    }

    /// A detached read owner for HTTP query/sync computation. Creating it is
    /// brief; materializing its response does not hold the serving engine.
    pub fn reader(&self) -> Result<Self, RuntimeError> {
        Ok(Self { timeline_schedule: timeline::Schedule::default(), ephemeral: self.ephemeral.clone(), store: self.store.reader()?, schema: self.schema.clone(), programs: self.programs.clone(),
            ceilings: self.ceilings, entropy: 0, generation: self.generation, dev_effects: self.dev_effects,
            #[cfg(feature = "native")] native: self.native.clone(),
            #[cfg(feature = "native")] native_logs: native::Logs::default(), presence: self.presence.clone() })
    }

    /// The registry every program's `connected[p]` reads, on this engine.
    pub fn set_presence(&mut self, presence: Option<std::sync::Arc<dyn Presence>>) {
        self.presence = presence;
    }


    /// Activate an immutable source release. Its pointer lives in the same
    /// transaction as rows/programs/generation; the filesystem pointer is a
    /// checked convenience copy, never an independent authority.
    pub fn new_release(store: Store, schema: Schema, programs: impl IntoIterator<Item = Program>, release: u64, expected_previous: Option<u64>) -> Result<Self, RuntimeError> {
        Self::new_release_with_feed_adoption(store, schema, programs, release, expected_previous, false)
    }

    pub fn new_release_with_feed_adoption(mut store: Store, mut schema: Schema, programs: impl IntoIterator<Item = Program>, release: u64, expected_previous: Option<u64>, allow_feed_adoption: bool) -> Result<Self, RuntimeError> {
        columns::validate_before_prepare(&schema)?;
        schema.check_row_view_audiences()?;
        schema.prepare_contribution_indexes();
        schema.prepare_delivery_lookup();
        if let Some(issue) = crate::schema::validate(&schema).first() { return Err(RuntimeError::Schema(format!("{}: {}", issue.path, issue.message))); }
        let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        let (generation, metadata) = Self::activate(&mut store, &schema, &programs, Some((release, expected_previous)), crate::now_ms(), allow_feed_adoption, None, None)?;
        store.exclude_ephemeral(&schema);
        Ok(Self { timeline_schedule: timeline::Schedule::default(), ephemeral: std::sync::Arc::new(ephemeral::Hub::new(metadata.store_id, generation, &schema)), store, schema, programs, generation, dev_effects: false, ceilings: Ceilings::default(), entropy: crate::ids::seed(), #[cfg(feature = "native")] native: None, #[cfg(feature = "native")] native_logs: native::Logs::default(), presence: None })
    }

    /// Attach to an already activated semantic generation without installing
    /// caller source. Reads of its identity and compiled content are one snapshot.
    pub fn open(store: Store) -> Result<Self, RuntimeError> {
        Self::open_at(store, crate::now_ms())
    }

    pub fn open_at(store: Store, now: i64) -> Result<Self, RuntimeError> {
        Self::open_selected_at(store, now, None)
    }

    fn open_selected_at(mut store: Store, now: i64, expected_release: Option<u64>) -> Result<Self, RuntimeError> {
        let tx = store.opening_transaction()?;
        Store::check_selected_release(tx.conn(), expected_release)?;
        let (generation, schema, programs): (i64, String, String) = tx.conn().query_row(
            "SELECT g.generation, g.schema, g.programs FROM _generations g JOIN _meta m ON m.key = 'generation' AND g.generation = CAST(m.value AS INTEGER)",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| RuntimeError::Store(format!("no readable activated backend in this store: {e}")))?;
        let kept = crate::store::opening::Backend(generation, schema.clone(), programs.clone());
        let generation = u64::try_from(generation).map_err(|_| RuntimeError::Store("negative stored generation".into()))?;
        let schema = serde_json::from_str(&schema).map_err(|e| RuntimeError::decode(e, |e| RuntimeError::Store(format!("invalid stored schema: {e}"))))?;
        crate::schema::timeline::check_version(&schema)?;
        timeline::check_no_rebuilds(&tx, &schema)?;
        schema.check_row_view_audiences()?;
        let programs = serde_json::from_str(&programs).map_err(|e| RuntimeError::Store(format!("invalid stored programs: {e}")))?;
        let mut schema: Schema = schema;
        let stored_schema_hash = schema.hash();
        schema.prepare_contribution_indexes();
        schema.prepare_delivery_lookup();
        let schema_hash = schema.hash();
        // Upgrade derived candidates from older binaries using the stored
        // backend, never a caller's source. The repair logs its row changes.
        // @ref LLP 3000.007#20.9.3 — expiry index adoption is required even without physical cap counters.
        let (generation, metadata) = if stored_schema_hash == schema_hash
            && tx.meta("live_sum_candidates")?.as_deref() == Some("1")
            && (!crate::rows::caps::required(&schema) || tx.meta("cap_counts_schema")?.as_deref() == Some(&schema_hash)) { (generation, Store::finish_open(tx)?) }
            else { tx.rollback()?; Self::activate(&mut store, &schema, &programs, None, now, true, expected_release, Some(&kept))? };
        let dev_effects = metadata.dev_effects;
        store.accept_open(); store.exclude_ephemeral(&schema);
        Ok(Self { timeline_schedule: timeline::Schedule::default(), ephemeral: std::sync::Arc::new(ephemeral::Hub::new(metadata.store_id, generation, &schema)), store, schema, programs, generation, dev_effects, ceilings: Ceilings::default(), entropy: crate::ids::seed(), #[cfg(feature = "native")] native: None, #[cfg(feature = "native")] native_logs: native::Logs::default(), presence: None })
    }

    /// Serving a selected immutable release may attach only while that release
    /// is still current. A racing deployment makes startup retry, never adopt.
    pub fn attach_release(store: Store, expected: u64) -> Result<Self, RuntimeError> {
        Self::attach_release_at(store, expected, crate::now_ms())
    }

    pub fn attach_release_at(store: Store, expected: u64, now: i64) -> Result<Self, RuntimeError> {
        let mut engine = Self::open_selected_at(store, now, Some(expected))?;
        engine.dev_effects = false;
        Ok(engine)
    }

    pub fn memory(schema: Schema, programs: impl IntoIterator<Item = Program>) -> Result<Self, RuntimeError> {
        Self::new(Store::memory()?, schema, programs)
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut Store {
        &mut self.store
    }

    pub fn program(&self, name: &str) -> Option<&Program> {
        self.programs.get(name)
    }

    pub fn programs(&self) -> impl Iterator<Item = &Program> {
        self.programs.values()
    }

    /// Install the app's native module (LLP 3000.005): compiled once, run
    /// one chunk per instantiation by `run_job_chunk`. Returns the jobs it
    /// implements; the host checks them against the declared native jobs.
    #[cfg(feature = "native")]
    pub fn install_native(&mut self, bytes: &[u8]) -> Result<Vec<String>, RuntimeError> {
        let module = native::Module::compile(bytes)?;
        let jobs = module.jobs().to_vec();
        self.native = Some(std::sync::Arc::new(module));
        Ok(jobs)
    }

    #[cfg(feature = "native")]
    pub fn has_native(&self) -> bool {
        self.native.is_some()
    }

    /// The installed module: what it implements, for the host to check
    /// against the declared native programs.
    #[cfg(feature = "native")]
    pub fn native_module(&self) -> Option<&native::Module> {
        self.native.as_deref()
    }

    /// What native jobs logged since the last call.
    #[cfg(feature = "native")]
    pub fn take_native_logs(&mut self) -> Vec<String> {
        self.native_logs.take()
    }

    /// The jobs the schema declares as native, in name order.
    pub fn declared_native_jobs(&self) -> Vec<String> {
        self.programs.values().filter(|program| program.native && program.kind == ProgramKind::Job).map(|program| program.name.clone()).collect()
    }

    /// The reads (`query name(): native`) the schema declares, in name order.
    pub fn declared_native_reads(&self) -> Vec<String> {
        self.programs.values().filter(|program| program.native && program.kind == ProgramKind::Query).map(|program| program.name.clone()).collect()
    }

    pub fn set_ceilings(&mut self, ceilings: Ceilings) {
        self.ceilings = ceilings;
    }

    pub fn ceilings(&self) -> Ceilings {
        self.ceilings
    }

    /// Counts shortened by the last schema activation, committed with its generation.
    pub fn read_through_shortened(&self) -> Result<BTreeMap<String,u64>,RuntimeError> {
        self.store.meta("read_through_shortened")?.map(|s|crate::json_codec::from_text(&s).map_err(|e|RuntimeError::Store(e.to_string()))).transpose().map(Option::unwrap_or_default)
    }

    /// Replace the schema and programs in place (a successor generation);
    /// the store keeps every row and rebuilds changed indexes; the
    /// generation advances so every device re-derives its partition.
    pub fn adopt(&mut self, schema: Schema, programs: impl IntoIterator<Item = Program>) -> Result<u64, RuntimeError> {
        self.adopt_at(schema, programs, crate::now_ms())
    }

    pub fn adopt_at(&mut self, mut schema: Schema, programs: impl IntoIterator<Item = Program>, now: i64) -> Result<u64, RuntimeError> {
        columns::validate_before_prepare(&schema)?;
        schema.check_row_view_audiences()?;
        schema.prepare_contribution_indexes();
        schema.prepare_delivery_lookup();
        let issues = crate::schema::validate(&schema);
        if let Some(issue) = issues.first() {
            return Err(RuntimeError::Schema(format!("{}: {}", issue.path, issue.message)));
        }
        let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        drop(self.ephemeral.lock()?);
        let (generation, metadata) = Self::activate(&mut self.store, &schema, &programs, None, now, true, None, None)?;
        self.timeline_schedule = timeline::Schedule::default();
        self.schema = schema;
        self.programs = programs;
        self.generation = generation;
        self.ephemeral.rebind_committed(metadata.store_id, generation, &self.schema);
        Ok(generation)
    }

    fn activate(store: &mut Store, schema: &Schema, programs: &BTreeMap<String, Program>, release: Option<(u64, Option<u64>)>, now: i64, allow_feed_adoption: bool, expected_release: Option<u64>, expected_backend: Option<&crate::store::opening::Backend>) -> Result<(u64, crate::store::opening::Metadata), RuntimeError> {
        schema.validate_column_owners()?;
        for program in programs.values() {
            crate::schema::ephemeral::admit_program(schema, program)?;
            admission::check_state_predicates(schema, program)?;
        }
        for program in programs.values() {
            for table in crate::ir::read_sites(program).into_iter().map(|s|s.table).chain(crate::ir::write_tables(program).into_iter().map(|(t,_)|t)) { schema.refuse_private(&table)?; }
        }
        for schedule in &schema.schedules {
            if !schedule.valid() {
                return Err(RuntimeError::Schema(format!("schedule {} has an invalid period or offset", schedule.name)));
            }
            let Some(program) = programs.get(&schedule.target).filter(|p| matches!(p.kind, ProgramKind::Job | ProgramKind::Action)) else {
                return Err(RuntimeError::Schema(format!("schedule {} names missing job or action {}; restore or remove the schedule", schedule.name, schedule.target)));
            };
            if program.kind == ProgramKind::Action {
                let seat = schedule.service.as_deref().filter(|seat| crate::identity::is_service(seat)).ok_or_else(|| RuntimeError::Schema("a scheduled action requires its declared service seat".into()))?;
                actions::authorize(program, seat)?;
            } else if schedule.service.is_some() { return Err(RuntimeError::Schema("a scheduled job cannot name a service seat".into())); }
            if program.args.iter().any(|(name, kind)| !matches!(name.as_str(), "periodStart" | "periodEnd") || *kind != crate::ir::ArgType::Time) {
                return Err(RuntimeError::Schema("scheduled work takes periodStart: time and periodEnd: time, or nothing".into()));
            }
        }
        store.activate_at_with_launch(schema, Some(programs), false, now, allow_feed_adoption, |conn| {
            Store::check_selected_release(conn, expected_release)?;
            if let Some(backend) = expected_backend { backend.check(conn)?; }
            Ok(())
        }, |tx, changed, report| {
            if let Some((release, expected)) = release {
                use rusqlite::OptionalExtension;
                let actual: Option<String> = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'release'", [], |row| row.get(0)).optional()?;
                // Legacy stores have no DB pointer yet. Their predecessor
                // was checked from the file; the first adoption establishes it.
                if actual.as_ref().is_some_and(|s| s.parse::<u64>().ok() != expected) {
                    return Err(RuntimeError::Generation("the current release changed during deployment; retry against its new schema".into()));
                }
                tx.set_meta("release", &release.to_string())?;
            }
            use rusqlite::OptionalExtension;
            let repair_live_sums = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'live_sum_candidates'", [], |row| row.get::<_, String>(0)).optional()?.as_deref() != Some("1");
            if !changed && !repair_live_sums { return Ok(()); }
            let previous: Option<String> = tx.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |row| row.get(0)).optional()?;
            let previous: Option<Schema> = previous.map(|text| serde_json::from_str(&text).map_err(|e| RuntimeError::decode(e, RuntimeError::Store))).transpose()?;
            let rebuild: Vec<_> = schema.maintains.iter().filter(|m| {
                (changed && previous.as_ref().is_none_or(|old| crate::successor::maintain_rebuild_needed(old, schema, m)))
                    || (repair_live_sums && matches!(m.kind, crate::schema::MaintainKind::Sum { .. }) && schema.table(&m.source).is_some_and(|source| source.is_expiring()))
            }).collect();
            tx.set_meta("live_sum_candidates", "1")?;
            let attribution = recorded::paths_changed(schema, previous.as_ref());
            let columns = column_activation::changed_parents(schema, previous.as_ref());
            if rebuild.is_empty() && !attribution && columns.is_empty() { return Ok(()); }
            let seq = tx.next_seq()?;
            let phase = std::time::Instant::now();
            if attribution {
                // This runner owns only activation rewrites; ordinary rebuilds
                // below retain their commit and partition accounting.
                let mut capture = Runner::new(tx, schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
                capture.capture_activation(previous.as_ref(), Some(report))?;
                report.detail("capture recorded paths", phase);
                capture.rebuild_recorded_activation(previous.as_ref(), &rebuild.iter().copied().filter(|m| m.private.is_none()).collect::<Vec<_>>(), report)?;
            }
            let mut runner = Runner::new(tx, schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
            runner.activate_columns(previous.as_ref(), &rebuild, &columns, Some(report))?;
            for maintain in rebuild.into_iter().filter(|m| m.private.is_none()) {
                if !recorded::table_paths_changed(schema.table(&maintain.source), previous.as_ref().and_then(|s| s.table(&maintain.source))) {
                    runner.rebuild_maintain_reported(maintain, report)?;
                }
            }
            let events = runner.events.take();
            let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
            let written = runner.rows_written;
            drop(runner);
            if written > 0 || !columns.is_empty() {
                tx.record_commit(seq, now, "rebuild", crate::SYSTEM_PRINCIPAL, "rebuild", &tables, written)?;
                partition::append(tx, seq, &events)?;
            }
            Ok(())
        }, crate::store::opening::Metadata::read)
    }

    /// Record an upload under `owner`: sniffed, bounded by the largest
    /// column of its kind in this schema, written beside the store. The
    /// asset is nobody's to see until a row claims it (the owner may).
    pub fn store_asset(&mut self, owner: &str, bytes: &[u8], now: i64) -> Result<Asset, RuntimeError> {
        let sniffed = assets::sniff(bytes)?;
        let upload = self.prepare_asset(owner, sniffed, bytes.len() as u64, now)?;
        let upload = upload.write(bytes)?;
        self.finish_asset(upload)
    }

    /// Admit an upload and reserve its identity while the engine is held.
    /// The returned upload writes its bytes without borrowing this engine.
    pub fn prepare_asset(
        &mut self,
        owner: &str,
        sniffed: assets::Sniffed,
        byte_count: u64,
        now: i64,
    ) -> Result<assets::Upload, RuntimeError> {
        let ceiling = self
            .schema
            .tables
            .values()
            .flat_map(|table| table.columns.values())
            .filter_map(|kind| match (asset_columns::leaf(kind), sniffed.kind) {
                (ColumnType::Image { max, .. }, AssetKind::Image) | (ColumnType::Video { max }, AssetKind::Video) => Some(*max),
                _ => None,
            })
            .max();
        let Some(ceiling) = ceiling else {
            return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("no column of this backend takes {} bytes; declare one (`photo: image <=10000000`)", sniffed.kind.word()) });
        };
        if byte_count > u64::from(ceiling) {
            return Err(RuntimeError::Asset { code: "E_ASSET_TOO_LARGE", message: format!("the {} is {} bytes; the largest {} column takes {ceiling}", sniffed.kind.word(),
                    byte_count, sniffed.kind.word()) });
        }
        self.stage_upload(Asset { id: String::new(), owner: owner.to_owned(), kind: sniffed.kind, content_type: sniffed.content_type.to_owned(), bytes: byte_count, width: sniffed.width, height: sniffed.height, duration: sniffed.duration, created_at: now, home: None, released_at: None, name: None })
    }

    /// Record a file upload under `owner`: `declared` checked against the
    /// bytes (LLP 3000.038 §2), the name sanitized, bounded by the largest
    /// file column that accepts the type.
    pub fn store_file(&mut self, owner: &str, bytes: &[u8], declared: Option<&str>, name: &str, now: i64) -> Result<Asset, RuntimeError> {
        let content_type = assets::verify_file(bytes, declared)?;
        let upload = self.prepare_file(owner, content_type, name, bytes.len() as u64, now)?;
        let upload = upload.write(bytes)?;
        self.finish_asset(upload)
    }

    /// The most bytes any `file` column of this schema takes: the host reads
    /// a file upload's body up to this bound (LLP 3000.038 §3). None when the
    /// schema has no file column.
    pub fn file_upload_ceiling(&self) -> Option<u32> {
        self.schema.tables.values().flat_map(|table| table.columns.values())
            .filter_map(|kind| match asset_columns::leaf(kind) { ColumnType::File { max, .. } => Some(*max), _ => None })
            .max()
    }

    /// Admit a verified file upload, as `prepare_asset` admits media.
    // @ref LLP 3000.038#3 — column-less admission: some file column must accept the type, and the largest such bound applies.
    pub fn prepare_file(&mut self, owner: &str, content_type: &str, name: &str, byte_count: u64, now: i64) -> Result<assets::Upload, RuntimeError> {
        let files: Vec<(u32, &[String])> = self.schema.tables.values().flat_map(|table| table.columns.values())
            .filter_map(|kind| match asset_columns::leaf(kind) { ColumnType::File { max, types } => Some((*max, &types[..])), _ => None })
            .collect();
        if files.is_empty() {
            return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: "no column of this backend takes a file; declare one (`doc: file <=10000000`)".into() });
        }
        let Some(ceiling) = files.iter().filter(|(_, types)| assets::file_accepts(types, content_type)).map(|(max, _)| *max).max() else {
            let mut accepted: Vec<&str> = files.iter().flat_map(|(_, types)| if types.is_empty() { assets::FILE_TYPES.to_vec() } else { types.iter().map(String::as_str).collect() }).collect();
            accepted.sort_unstable();
            accepted.dedup();
            return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("no file column of this backend accepts {content_type}; they accept {}", accepted.join(", ")) });
        };
        if byte_count > u64::from(ceiling) {
            return Err(RuntimeError::Asset { code: "E_ASSET_TOO_LARGE", message: format!("the file is {byte_count} bytes; the largest file column accepting {content_type} takes {ceiling}") });
        }
        if byte_count == 0 {
            return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: "the upload is empty: POST the file's bytes as the body".into() });
        }
        self.stage_upload(Asset { id: String::new(), owner: owner.to_owned(), kind: AssetKind::File, content_type: content_type.to_owned(), bytes: byte_count, width: None, height: None, duration: None, created_at: now, home: None, released_at: None, name: Some(assets::sanitize_name(name)) })
    }

    fn stage_upload(&mut self, mut asset: Asset) -> Result<assets::Upload, RuntimeError> {
        asset.id = crate::ids::mint(asset.created_at, &mut self.entropy)?;
        let path = self.store.asset_path(&asset.id);
        Ok(assets::Upload {
            asset,
            path,
            generation: self.generation,
            written: false,
            committed: false,
            ephemeral_directory: self.store.ephemeral_assets(),
        })
    }

    /// Commit a staged upload only if this engine still serves the schema
    /// generation under which it was admitted.
    pub fn finish_asset(&mut self, mut upload: assets::Upload) -> Result<Asset, RuntimeError> {
        if upload.generation != self.generation {
            return Err(RuntimeError::Generation(
                "schema changed during upload; retry".into(),
            ));
        }
        if !upload.written {
            return Err(RuntimeError::Input(
                "upload bytes have not been written".into(),
            ));
        }
        // Check shared-store activation too, not just this engine's identity.
        let tx = self.store.transaction()?;
        tx.record_asset(&upload.asset)?;
        tx.commit()?;
        upload.committed = true;
        Ok(upload.asset.clone())
    }

    /// Whether `principal` may have the bytes of `id` now: the uploader
    /// before placement; after placement, the home must still name it and
    /// be unexpired. Every viewer follows its read rule. This grants a
    /// delivery without consuming a `once` view; the host records success.
    /// A previously completed view is refused. Hidden,
    /// released and absent are one word.
    pub fn asset_access(&mut self, principal: &str, id: &str, now: i64,
    ) -> Result<AssetGrant, RuntimeError> {
        self.asset_access_request(principal, id, now, false)
    }

    pub fn asset_access_request(
        &mut self,
        principal: &str,
        id: &str,
        now: i64,
        range: bool,
    ) -> Result<AssetGrant, RuntimeError> {
        let unknown = || RuntimeError::Asset { code: "E_ASSET_UNKNOWN", message: "no asset is served under that id to this viewer".into() };
        let path = self.store.asset_path(id);
        let tx = self.store.transaction()?;
        let Some(asset) = tx.asset(id)? else { return Err(unknown()) };
        if asset.released_at.is_some() {
            return Err(unknown());
        }
        // @ref LLP 3000.019#3.5 — a delayed download cannot confer custody in a replacement store.
        let store_id = tx.meta("store_id")?.ok_or_else(unknown)?;
        let grant = |once: bool| AssetGrant { store_id: store_id.clone(), home: asset.home.clone(), path: path.clone(), content_type: asset.content_type.clone(), bytes: asset.bytes, once, kind: asset.kind, name: asset.name.clone() };
        let Some((table_name, row_id, column)) = &asset.home else {
            if asset.owner == principal {
                tx.rollback()?;
                return Ok(grant(false));
            }
            return Err(unknown());
        };
        let table = self.schema.table(table_name).ok_or_else(unknown)?;
        let Some(row) = tx.get(table_name, row_id)? else { return Err(unknown()) };
        if !table.columns.get(column).is_some_and(|kind| asset_columns::contains(kind, row.field(column).ok(), id)) || table.expired(&row, now) {
            return Err(unknown());
        }
        let mut image = row.clone();
        materialize_optional_fields(&mut image, table);
        let mut runner = Runner::new(&tx, &self.schema, Context::new(principal, BTreeMap::new()).at(now), Meter::new(self.ceilings, Cut::Cap), 0);
        let allowed = runner.check_rule(table_name, Effect::Read, None, &image)?
            && (runner.context.is_system() || !table.written_by.get(column).is_some_and(|authority| !authority.audience
                && image.field(&authority.owner).ok() != Some(&Value::Id(principal.into()))));
        drop(runner);
        if !allowed {
            tx.rollback()?;
            return Err(unknown());
        }
        let once = matches!(table.columns.get(column).map(asset_columns::leaf), Some(ColumnType::Image { once: true, .. }));
        if once {
            if range {
                return Err(RuntimeError::Asset { code: "E_ASSET_RANGE", message: "one-view photos require a complete request without Range; the view was not consumed".into() });
            }
            if tx.asset_viewed(id, principal)? {
                tx.rollback()?;
                return Err(RuntimeError::Asset { code: "E_ASSET_VIEWED", message: "this photo was for one view, and it was viewed".into() });
            }
        }
        tx.rollback()?;
        Ok(grant(once))
    }

    /// Complete a view after the host has successfully sent the bytes.
    /// Hosts serialize deliveries for the same asset and principal.
    pub fn record_asset_view(&mut self, principal: &str, id: &str, now: i64) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        if tx.asset_viewed(id, principal)? {
            return Err(RuntimeError::Asset { code: "E_ASSET_VIEWED", message: "this photo was for one view, and it was viewed".into() });
        }
        tx.record_asset_view(id, principal, now)?;
        tx.commit()
    }

    /// Unlink and forget the assets nobody serves any more: released by
    /// their home, or never claimed within the grace period.
    pub fn sweep_assets(&mut self, now: i64) -> Result<u64, RuntimeError> {
        let sweep = self.prepare_asset_sweep(now)?;
        sweep.remove_files()?;
        self.finish_asset_sweep(&sweep)
    }

    /// Make a bounded stale batch unclaimable. The returned file work owns
    /// no engine borrow and should run after releasing the host mutex.
    pub fn prepare_asset_sweep(&mut self, now: i64) -> Result<assets::AssetSweep, RuntimeError> {
        self.prepare_asset_sweep_for(now, std::time::Duration::MAX)
    }

    pub fn prepare_asset_sweep_for(&mut self, now: i64, budget: std::time::Duration) -> Result<assets::AssetSweep, RuntimeError> {
        let directory = self.store.assets_dir().to_path_buf();
        let tx = self.store.transaction()?;
        let stale = tx.stage_stale_assets_for(now, budget)?;
        let sweep = assets::AssetSweep::new(&stale, &directory);
        tx.commit()?;
        Ok(sweep)
    }

    /// Forget a prepared batch after its files have been removed.
    pub fn finish_asset_sweep(&mut self, sweep: &assets::AssetSweep) -> Result<u64, RuntimeError> {
        self.finish_asset_sweep_slice(sweep, std::time::Duration::MAX)
    }

    /// Advance the prepared batch only after the forget transaction commits.
    pub fn finish_asset_sweep_for(&mut self, sweep: &mut assets::AssetSweep, budget: std::time::Duration) -> Result<u64, RuntimeError> {
        let removed = self.finish_asset_sweep_slice(sweep, budget)?;
        sweep.forget_prefix(removed as usize);
        Ok(removed)
    }

    fn finish_asset_sweep_slice(&mut self, sweep: &assets::AssetSweep, budget: std::time::Duration) -> Result<u64, RuntimeError> {
        let started = std::time::Instant::now();
        let tx = self.store.transaction()?;
        let mut removed = 0;
        for id in sweep.ids() {
            if removed > 0 && started.elapsed() >= budget { break; }
            tx.forget_asset(id)?;
            removed += 1;
        }
        tx.commit()?;
        Ok(removed)
    }

    /// Delete the rows past their `expire` column. They were absent to
    /// every reader from the moment they expired; the sweep makes that
    /// physical, so the log carries the deletion to each device holding
    /// them. At most `limit` rows go in one commit; the next pass continues.
    pub fn sweep_expired(&mut self, now: i64, limit: usize) -> Result<u64, RuntimeError> {
        self.sweep_expired_for(now, limit, std::time::Duration::MAX)
    }

    /// Stop between row removals; a short sweep can still leave due rows.
    pub fn sweep_expired_for(&mut self, now: i64, limit: usize, budget: std::time::Duration) -> Result<u64, RuntimeError> {
        let started = std::time::Instant::now();
        let expiring: Vec<(String, String)> = self.schema.through_order().into_iter().rev().filter(|name| self.schema.tables[name].ephemeral.is_none()).filter_map(|name| self.schema.tables[&name].expiry_index().map(|(index, _)| (name.clone(), index.to_owned()))).collect();
        if expiring.is_empty() {
            return Ok(0);
        }
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let mut removed = 0_u64;
        let due = crate::store::Bounds { gte: Some(Value::Int(i64::MIN)), lte: Some(Value::Int(now)), ..Default::default() };
        'tables: for (table_name, index) in &expiring {
            loop {
                let batch = (limit - removed as usize).min(256);
                if batch == 0 {
                    break 'tables;
                }
                let rows = tx.scan(table_name, index, &[], &due, crate::store::Dir::Asc, batch)?;
                let count = rows.len();
                for (row, _) in rows {
                    if removed > 0 && started.elapsed() >= budget { break 'tables; }
                    if runner.physical_children(table_name,row.field("id")?)? { break 'tables; }
                    runner.remove(table_name, &row)?;
                    removed += 1;
                }
                if count < batch {
                    break;
                }
            }
        }
        let events = runner.events.take();
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        let written = runner.rows_written;
        drop(runner);
        if written > 0 {
            tx.record_commit(seq, now, "expire", crate::SYSTEM_PRINCIPAL, "sweep", &tables, written)?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(removed)
    }

    /// The schema generation the store serves; a device holds a partition
    /// of exactly one.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Run a query. Refusals (a `require`, a rule, bad input) are the
    /// card's `denied`; store failures surface as retryable refusals too.
    pub fn query(&mut self, name: &str, context: Context) -> Result<QueryOutcome, Refusal> {
        self.query_at(name, context).0
    }

    /// A query and the store cut its transaction read, which a refusal also
    /// carries, so a client can order it against answers (LLP 3000.018 §3.2).
    pub fn query_at(&mut self, name: &str, context: Context) -> (Result<QueryOutcome, Refusal>, Option<u64>) {
        let mut cut = None;
        let result = self.query_reading(name, context, &mut cut, None, &mut None, DeliveryManifest::Build);
        (result, cut)
    }

    // @ref LLP 3000.028#3.3 — point overlap and page share one transaction/ledger.
    #[cfg(feature = "server-search")]
    pub fn query_search_at(&mut self, name: &str, context: Context, retained: Option<&[String]>) -> (Result<QueryOutcome, Refusal>, Option<u64>, Option<Vec<String>>) {
        self.query_search_with_delivery_at(name, context, retained, DeliveryManifest::Build)
    }

    // @ref LLP 3000.033#1.6 — request-local selection, never a reader-wide toggle.
    #[cfg(feature = "server-search")]
    pub fn query_search_with_delivery_at(&mut self, name: &str, context: Context, retained: Option<&[String]>, manifest: DeliveryManifest) -> (Result<QueryOutcome, Refusal>, Option<u64>, Option<Vec<String>>) {
        let (mut cut, mut current) = (None, None);
        let result = self.query_reading(name, context, &mut cut, retained, &mut current, manifest);
        (result, cut, current)
    }

    fn query_reading(&mut self, name: &str, mut context: Context, cut: &mut Option<u64>, _retained: Option<&[String]>, _current: &mut Option<Vec<String>>, manifest: DeliveryManifest) -> Result<QueryOutcome, Refusal> {
        context.generation = self.generation;
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
        if program.kind != ProgramKind::Query {
            return Err(RuntimeError::UnknownOp(format!("{name} is a {}, not a query", program.kind.word())).into());
        }
        server_query_allowed(&self.schema, name)?;
        validate::validate_inputs(&self.schema, &program, &mut context.args)?;
        if context.now.is_none() {
            context.now = Some(crate::now_ms());
        }
        if context.presence.is_none() {
            context.presence = self.presence.clone();
        }
        let tx = self.store.read_transaction()?;
        let seq = tx.next_seq()? - 1;
        *cut = Some(seq);
        let touches = self.schema.operations.get(name).is_some_and(|f| !f.ephemeral_reads.is_empty());
        let mut hub = if touches { Some(self.ephemeral.lock()?) } else { None };
        if let Some(hub) = &mut hub {
            hub.bind(&tx.meta("store_id")?.unwrap_or_default(), self.generation, &self.schema)?;
        }
        let version = hub.as_ref().map(|h| h.version());
        let layered = hub.as_ref().map(|h| ephemeral::Layered::new(&tx, &h.rows, &self.schema, false));
        let rows: &dyn crate::rows::Rows = layered.as_ref().map_or(&tx as &dyn crate::rows::Rows, |l| l);
        if program.native {
            // A native read (LLP 3000.005 §9): the module over this viewer's
            // rules under the read meter; the same call a device makes over
            // its held rows.
            #[cfg(feature = "native")]
            {
                let module = self.native.as_deref().ok_or_else(|| RuntimeError::Native { code: "E_NATIVE".into(), message: format!("{name} is a native read but no module is installed; `snapback4 check` builds it") })?;
                let args = context.args.clone();
                let now = context.now.unwrap_or(0);
                let runner = Runner::new(rows, &self.schema, context, Meter::new(self.ceilings, Cut::Cap), seq);
                let (value, mut runner) = native::run_read(module, runner, name, &args, now);
                let data = value?;
                runner.charge_output(&data)?;
                let (delivery, delivery_meter) = match manifest { DeliveryManifest::Build => runner.delivery_manifest(&data), DeliveryManifest::Skip => (None, None) };
                let outcome = QueryOutcome { decoration_expiry: None, search_rows: None, search_scopes: None, delivery, delivery_meter, ephemeral: version, unavailable: runner.query_unavailable, complete: runner.meter.capped_at.is_none() && runner.word_cut_at.is_none() && !runner.non_uniform && !runner.page_position_lost() && !runner.timeline_pending, cut: runner.read_cut(), capped_at: runner.meter.capped_at.clone(), word_cut_at: runner.word_cut_at.clone(), next: None, data, seq, metered: runner.meter.used, tables: runner.read_tables.iter().cloned().collect(), next_expiry: runner.next_expiry.get() };
                drop(runner);
                drop(layered); drop(hub);
                tx.rollback()?;
                return Ok(outcome);
            }
            #[cfg(not(feature = "native"))]
            {
                return Err(RuntimeError::Native { code: "E_NATIVE".into(), message: format!("{name} is a native read and this server was built without the wasm host") }.into());
            }
        }
        let mut runner = Runner::new(rows, &self.schema, context, Meter::new(self.ceilings, Cut::Cap), seq);
        #[cfg(feature = "server-search")]
        if let Some(ids) = _retained {
            let original = &self.programs[name];
            let descriptor = crate::search_plan::ordinary::composition(&self.schema, original)
                .ok_or_else(|| RuntimeError::Input("this query does not support retained search overlap".into()))?;
            *_current = Some(runner.search_overlap(&descriptor, ids)?);
            if let Some((order, _)) = &runner.context.search_retained_order {
                if order.len() != ids.len() { return Err(RuntimeError::Input("retained search keys must match candidate IDs".into()).into()); }
                let current: std::collections::BTreeSet<_> = _current.as_ref().unwrap().iter().collect();
                runner.meter.heap((ids.len() * 160) as u64)?;
                runner.meter.step((ids.len() * 4) as u64)?;
                runner.context.search_retained_candidates = ids.iter().zip(order).map(|(id, at)| (id.clone(), *at, current.contains(id))).collect();
            }
        }
        let data = runner.run_server_query(&program)?;
        runner.charge_output(&data)?;
        let next = runner.outcome_next_cursor()?;
        // `complete` is a class, not a count: a query with a scan the prefix
        // does not decide is capped whatever the meter found (LLP 1001 §3).
        let (delivery, delivery_meter) = match manifest { DeliveryManifest::Build => runner.delivery_manifest(&data), DeliveryManifest::Skip => (None, None) };
        let outcome = QueryOutcome {
            decoration_expiry: runner.decoration_expiry, search_rows: runner.search_rows.take(),
            #[cfg(feature = "server-search")] search_scopes: runner.search_scopes.take(),
            #[cfg(not(feature = "server-search"))] search_scopes: None,
            delivery, delivery_meter, ephemeral: version,
            unavailable: runner.query_unavailable,
            complete: runner.meter.capped_at.is_none() && runner.word_cut_at.is_none() && !runner.non_uniform && !runner.page_overflow && !runner.value_source_incomplete && !runner.page_position_lost() && !runner.timeline_pending,
            cut: runner.read_cut(),
            capped_at: runner.meter.capped_at.clone(),
            word_cut_at: runner.word_cut_at.clone(),
            next,
            data,
            seq,
            metered: runner.meter.used,
            tables: runner.read_tables.iter().cloned().collect(),
            next_expiry: runner.next_expiry.get(),
        };
        drop(runner);
        drop(layered); drop(hub);
        tx.rollback()?;
        Ok(outcome)
    }

    /// Correlate a bounded pending outbox with authority already present in
    /// a stream page. Devices suppress those overlays before the mutation
    /// response arrives, but keep retrying for its complete result.
    pub fn acknowledged(&mut self, principal: &str, pending: &[String], through: u64) -> Result<BTreeMap<String, u64>, RuntimeError> {
        self.acknowledged_at(principal, pending, through, through).map(|(covered, _)| covered)
    }

    /// The same receipt lookup split at the event cut and the image read head.
    pub fn acknowledged_at(&mut self, principal: &str, pending: &[String], through: u64, images_at: u64) -> Result<(BTreeMap<String, u64>, BTreeMap<String, u64>), RuntimeError> {
        use rusqlite::OptionalExtension;
        if images_at < through { return Err(RuntimeError::Input("image head precedes the event watermark".into())); }
        if pending.len() > 256 || pending.iter().any(|id| id.len() > 128) { return Err(RuntimeError::Input("sync accepts at most 256 pending ids of at most 128 bytes".into())); }
        let tx = self.store.read_transaction()?;
        let mut acknowledged = BTreeMap::new();
        let mut committed_above = BTreeMap::new();
        for id in pending {
            // @ref LLP 3000.013#6 — idempotency also records refusals; only
            // committed success can acknowledge execution in a device outbox.
            let seq: Option<i64> = tx.conn().query_row("SELECT seq FROM _ops WHERE principal = ?1 AND id = ?2 AND seq <= ?3 AND json_extract(outcome, '$.state') = 'sent'", rusqlite::params![principal, id, images_at.max(through).min(i64::MAX as u64) as i64], |row| row.get(0)).optional()?;
            if let Some(seq) = seq {
                let seq = u64::try_from(seq).map_err(|_| RuntimeError::Store("negative stored operation sequence".into()))?;
                if seq <= through { acknowledged.insert(id.clone(), seq); }
                else { committed_above.insert(id.clone(), seq); }
            }
        }
        tx.rollback()?;
        Ok((acknowledged, committed_above))
    }

    /// Inspect an existing receipt by id. This grants no historical result
    /// authority. A host answering a resend must use `replay_mutation` to
    /// compare the operation name and raw arguments before decoding.
    pub fn replay(&self, viewer: &str, op: &str) -> Result<Option<MutationOutcome>, RuntimeError> {
        let Some(outcome) = self.store.applied_outcome(viewer, op)? else {
            return Ok(None);
        };
        let outcome = MutationOutcome::from_receipt(&outcome)?;
        Ok(Some(outcome))
    }

    /// Compare wire identity before decoding against a possibly newer schema.
    // @ref LLP 3000.009#5.1 — an id binds the admitted operation and arguments.
    pub fn replay_mutation(&self, viewer: &str, id: &str, name: &str, args: &serde_json::Value) -> Result<Option<MutationOutcome>, RuntimeError> {
        crate::store::replay_bound(self.store.conn(), viewer, id, name, args)?
            .map(|receipt| MutationOutcome::from_receipt(&receipt)).transpose()
    }

    /// Run a mutation. With an `op` id the write applies at most once: a
    /// replay returns the recorded outcome. The replay check comes before
    /// anything the current generation could refuse (an op renamed, an
    /// argument narrowed), so a write that applied under an earlier schema
    /// is never re-judged: its row is on the server, and the device that
    /// queued it must learn `sent`, not `failed`.
    pub fn mutate(&mut self, name: &str, op: Option<&str>, mut context: Context) -> Result<MutationOutcome, RuntimeError> {
        context.generation = self.generation;
        let wire_args = if op.is_some() { context.wire_args.take().unwrap_or_else(|| serde_json::Value::Object(crate::wire::map_to_json(&context.args))) } else { serde_json::Value::Null };
        if let Some(op) = op
            && let Some(outcome) = self.replay_mutation(&context.viewer, op, name, &wire_args)?
        {
            return Ok(outcome);
        }
        // An existing durable receipt owns its id even after conversion to ephemeral.
        if self.schema.operations.get(name).is_some_and(|f| f.ephemeral) {
            self.schema.check_delivery(name, context.delivery_fingerprint.as_deref())?;
            return match self.mutate_ephemeral(name, context) {
                Ok(out) => Ok(MutationOutcome { receipt_only: false, state: WriteState::Sent { seq: out.seq, result: out.result }, metered: out.metered, tables: out.ephemeral.tables, events: 0, replayed: false }),
                Err(error) if error.is_refusal() => Ok(MutationOutcome { receipt_only: false, state: WriteState::Failed { why: error.refusal(), current: None }, metered: Metered::default(), tables: Vec::new(), events: 0, replayed: false }),
                Err(error) => Err(error),
            };
        }
        let tx = self.store.transaction()?;
        if let Some(op) = op
            && let Some(outcome) = crate::store::replay_bound(tx.conn(), &context.viewer, op, name, &wire_args)?
        {
            // Applied between the check above and this transaction.
            let outcome = MutationOutcome::from_receipt(&outcome)?;
            tx.rollback()?;
            return Ok(outcome);
        }
        self.schema.check_delivery(name, context.delivery_fingerprint.as_deref())?;
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
        if program.kind == ProgramKind::Query {
            return Err(RuntimeError::UnknownOp(format!("{name} is a query, not a mutation")));
        }
        if program.kind == ProgramKind::Action {
            return Err(RuntimeError::UnknownOp(format!("{name} is an action: call it with client.act")));
        }
        if program.kind == ProgramKind::Job {
            return Err(RuntimeError::UnknownOp(format!("{name} is a job: a schedule fires it, or `snapback4 run {name}` does; no caller can")));
        }
        if let Err(error) = validate::validate_inputs(&self.schema, &program, &mut context.args) {
            return Ok(MutationOutcome { receipt_only: false, state: WriteState::Failed { why: error.refusal(), current: None }, metered: Metered::default(), tables: Vec::new(), events: 0, replayed: false });
        }
        if context.now.is_none() {
            context.now = Some(crate::now_ms());
        }
        if context.presence.is_none() {
            context.presence = self.presence.clone();
        }
        context.entropy = self.entropy;
        let ceilings = self.ceilings;
        let viewer = context.viewer.clone();
        let now = context.now.unwrap_or(0);
        // An `image`/`video` argument names an upload by id; the program
        // reads the facts the server established (`clip.duration`), so
        // they are put in place before it runs. An id that is not the
        // writer's own upload stays as sent and the write refuses it.
        for (name, kind) in &program.args {
            let inner = match kind {
                crate::ir::ArgType::Optional(inner) => inner.as_ref(),
                other => other,
            };
            if !matches!(inner, crate::ir::ArgType::Image { .. } | crate::ir::ArgType::Video { .. } | crate::ir::ArgType::File { .. }) {
                continue;
            }
            let Some(id) = asset_id(context.args.get(name)).map(str::to_owned) else { continue };
            if let Some(asset) = tx.asset(&id)?
                && (asset.owner == viewer || context.is_system())
            {
                // @ref LLP 3000.038#3 — a file argument never reads an image's facts, nor an image argument a file's.
                if (asset.kind == AssetKind::File) != matches!(inner, crate::ir::ArgType::File { .. }) {
                    let wanted = if matches!(inner, crate::ir::ArgType::File { .. }) { "a file" } else { "an image or video" };
                    let error = RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("{name} takes {wanted} and {id} is {}; upload it as {wanted}", asset.kind.word()) };
                    return Ok(MutationOutcome { receipt_only: false, state: WriteState::Failed { why: error.refusal(), current: None }, metered: Metered::default(), tables: Vec::new(), events: 0, replayed: false });
                }
                context.args.insert(name.clone(), asset.column_value());
            }
        }
        tx.savepoint("program")?;
        let mut runner = Runner::new(&tx, &self.schema, context, Meter::new(ceilings, Cut::Abort), tx.next_seq()?);
        let ran = runner.run(&program).and_then(|value| {
            runner.check_final_exists()?;
            runner.charge_output(&value)?;
            Ok(value)
        });
        let metered = runner.meter.used;
        let ran = ran.and_then(|value| runner.retire_expired_births().map(|_| value));
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        let events: Vec<Event> = runner.events.take();
        let action_tables = std::mem::take(&mut runner.action_tables);
        let outbox = std::mem::take(&mut runner.outbox);
        let rows_written = runner.rows_written;
        let mut read_tables = runner.read_tables.clone();
        self.entropy = runner.context.entropy;
        drop(runner);
        let outcome = match ran {
            Ok(result) => {
                tx.release("program")?;
                // @ref LLP 3000.019#4 — P7 reports keep at-most-once custody.
                // @ref LLP 3000.022#6 — a covered report keeps only a receipt at the committed head.
                let receipt_only = rows_written == 0 && outbox.is_empty()
                    && self.schema.delivery.iter().any(|binding| binding.mutation == name);
                let seq = tx.next_seq()? - u64::from(receipt_only);
                read_tables.extend(tables.iter().cloned());
                if !receipt_only {
                    tx.record_commit(seq, now, name, &viewer, program.kind.word(), &tables, rows_written)?;
                    partition::append(&tx, seq, &events)?;
                    effects::record(&tx, &outbox, seq, now, self.dev_effects, &self.schema)?;
                }
                MutationOutcome { receipt_only, state: WriteState::Sent { seq, result }, metered, tables, events: partition::disclosed_event_count(&self.schema, &events, &action_tables), replayed: false }
            }
            Err(error) if error.is_refusal() => {
                tx.rollback_to("program")?;
                let current = match &error {
                    RuntimeError::Conflict { current } => {
                        let mut probe = Runner::new(&tx, &self.schema, Context::new(viewer.clone(), BTreeMap::new()).at(now), Meter::new(Ceilings::default(), Cut::Cap), 0);
                        let value = probe.get(current).ok();
                        value
                    }
                    _ => None,
                };
                MutationOutcome { receipt_only: false, state: WriteState::Failed { why: error.refusal(), current }, metered, tables: Vec::new(), events: 0, replayed: false }
            }
            Err(error) => {
                tx.rollback()?;
                return Err(error);
            }
        };
        if let Some(op) = op {
            let seq = match &outcome.state {
                WriteState::Sent { seq, .. } => *seq,
                WriteState::Failed { .. } => tx.next_seq()? - 1,
            };
            tx.record_applied(&viewer, op, seq, &serde_json::to_string(&outcome.receipt(Some(op))).map_err(|e| RuntimeError::Store(e.to_string()))?)?;
            tx.bind_applied(&viewer, op, name, &wire_args, now)?;
        }
        tx.commit()?;
        Ok(outcome)
    }

    /// Write rows as the system principal: rules are bypassed, validation,
    /// constraints, aggregates and partition events are not. One commit.
    pub fn seed(&mut self, rows: impl IntoIterator<Item = (String, Value)>) -> Result<u64, RuntimeError> {
        self.seed_at(rows, crate::now_ms())
    }

    /// Development hosts supply their clock so seed commits share operation and stream time.
    pub fn seed_at(&mut self, rows: impl IntoIterator<Item = (String, Value)>, now: i64) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction()?;
        let count = seed_rows(&self.schema, &tx, rows, now)?;
        tx.commit()?;
        Ok(count)
    }

    /// Delete a row as the system principal: constraints, aggregates and
    /// partition events apply. Returns the number of rows removed (0 or 1).
    pub fn seed_delete(&mut self, table: &str, id: &str) -> Result<u64, RuntimeError> {
        self.schema.refuse_ephemeral_import(table)?;
        timeline::check_import(&self.schema, table)?;
        let now = crate::now_ms();
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let removed = match runner.delete(table, id) {
            Ok(()) => 1,
            Err(RuntimeError::Require { .. }) => 0,
            Err(error) => return Err(error),
        };
        let events = runner.events.take();
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        if removed > 0 {
            tx.record_commit(seq, now, "seed", crate::SYSTEM_PRINCIPAL, "seed", &tables, removed)?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(removed)
    }

    /// Untrusted fixture import. All targets are installed before attribution
    /// is captured, so import order cannot invent dangling references.
    pub fn load(&mut self, rows: impl IntoIterator<Item = (String, Value)>) -> Result<u64, RuntimeError> {
        self.load_mode(rows, LoadMode::Import)
    }

    /// Restore trusted durable images, including timeline and attribution history.
    pub fn load_trusted(&mut self, rows: impl IntoIterator<Item = (String, Value)>) -> Result<u64, RuntimeError> {
        self.load_mode(rows, LoadMode::Restore)
    }

    /// Persistence restores keep historical attribution verbatim; imports
    /// cannot supply it. Device stores restore/page-apply at their own trusted
    /// transaction boundary with the same stored row representation.
    pub fn load_mode(&mut self, rows: impl IntoIterator<Item = (String, Value)>, mode: LoadMode) -> Result<u64, RuntimeError> {
        if mode == LoadMode::Import && self.schema.tables.values().any(|t| t.through.is_some()) { return self.seed(rows); }
        if mode == LoadMode::Restore || self.schema.tables.values().all(|table| table.recorded.is_empty() && table.maintained.is_empty()) { return self.load_stored_rows(rows, mode); }
        let now = crate::now_ms();
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let mut imported = BTreeMap::new();
        let mut count = 0;
        for (name, row) in rows {
            self.schema.refuse_ephemeral_import(&name)?;
            timeline::check_import(&self.schema, &name)?;
            let table = self.schema.table(&name).ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))?;
            self.schema.refuse_private(&name)?;
            let row = columns::write_result(table, row);
            if mode == LoadMode::Import { recorded::refuse_fields(table, &name, &row)?; }
            let old = tx.get(&name, row.field("id")?.as_str()?)?;
            let row = runner.import_sequences(&name, row, old.as_ref(), false)?;
            validate::validate_row(&self.schema, &name, &row)?;
            // Importing an existing source cannot erase its contribution history.
            let mut row = row;
            if mode == LoadMode::Import && let (Some(old), Value::Row(fields) | Value::Map(fields)) = (&old, &mut row) {
                for path in table.recorded.keys() { fields.insert(path.clone(), old.field(path).cloned().unwrap_or(Value::Null)); }
                for field in table.recorded.values() {
                    if crate::schema::row_image(old, table).field(&field.reference).ok() != crate::schema::row_image(&row, table).field(&field.reference).ok() { return Err(RuntimeError::Structural { code: "E_RECORDED_FIELD", message: format!("{name}.{} cannot change after attribution capture; import a new source id (guide maintains)", field.reference) }); }
                }
            }
            tx.put(&name, table, &row, old.as_ref())?;
            imported.entry((name, row.field("id")?.as_str()?.to_owned())).or_insert(old);
            count += 1;
        }
        for ((name, id), old) in imported {
            let mut row = tx.get(&name, &id)?.expect("imported row exists in the writing transaction");
            let table = &self.schema.tables[&name];
            if mode == LoadMode::Import && old.is_none() {
                let captured = runner.record_insert(&name, row.clone())?;
                validate::validate_row(&self.schema, &name, &captured)?;
                tx.put(&name, table, &captured, Some(&row))?;
                row = captured;
            }
            partition::row_changed(&mut runner, &name, old.as_ref(), Some(&row), crate::engine::write::Origin::Source)?;
            runner.written_tables.insert(name);
        }
        if count > 0 { runner.rebuild_imported_columns()?; }
        let events = runner.events.take();
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        if count > 0 {
            tx.record_commit(seq, now, "load", crate::SYSTEM_PRINCIPAL, "load", &tables, count)?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(count)
    }

    // Persistence restoration and schemas without captures retain the streaming
    // import path; attribution imports alone need staged target resolution.
    fn load_stored_rows(&mut self, rows: impl IntoIterator<Item = (String, Value)>, mode: LoadMode) -> Result<u64, RuntimeError> {
        let now = crate::now_ms();
        let tx = self.store.transaction()?;
        let mut seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let mut count = 0;
        for (table_name, mut row) in rows {
            self.schema.refuse_ephemeral_import(&table_name)?;
            if let Some(table) = self.schema.table(&table_name) { table.recompute_deadline(&mut row)?; }
            if mode == LoadMode::Import { timeline::check_import(&self.schema, &table_name)?; }
            let old = tx.get(&table_name, row.field("id")?.as_str()?)?;
            let row = runner.import_sequences(&table_name, row, old.as_ref(), mode == LoadMode::Restore)?;
            validate::validate_row(&self.schema, &table_name, &row)?;
            if mode == LoadMode::Restore { seq = seq.max(timeline::restored_sequence(&self.schema, &table_name, &row)?); }
            let table = self.schema.table(&table_name).expect("validated").clone();
            let id = row.field("id")?.as_str()?.to_owned();
            let old = tx.get(&table_name, &id)?;
            tx.put(&table_name, &table, &row, old.as_ref())?;
            partition::row_changed(&mut runner, &table_name, old.as_ref(), Some(&row), crate::engine::write::Origin::Source)?;
            if self.schema.visible(&table_name) { runner.written_tables.insert(table_name); }
            count += 1;
        }
        through_activation::validate_restore(&tx,&self.schema,now)?;
        let events = runner.events.take();
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        if count > 0 {
            tx.record_commit(seq, now, "load", crate::SYSTEM_PRINCIPAL, "load", &tables, count)?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(count)
    }

    /// One page of the snapshot a device takes before it follows the log:
    /// `after` is the token the previous page returned, `next` the token
    /// for the following one (none on the last). Each page is one short
    /// transaction; the watermark is the one the first page pinned.
    pub fn snapshot_page(&mut self, principal: &str, after: Option<&str>, limit: usize) -> Result<(Vec<Event>, u64, Option<String>), RuntimeError> {
        self.snapshot_page_at(principal, after, limit, crate::now_ms())
    }

    pub fn snapshot_page_at(&mut self, principal: &str, after: Option<&str>, limit: usize, now: i64) -> Result<(Vec<Event>, u64, Option<String>), RuntimeError> {
        let (events, watermark, next, _) = self.snapshot_page_with_groups_at(principal, after, limit, now)?;
        Ok((events, watermark, next))
    }

    pub fn snapshot_page_with_groups_at(&mut self, principal: &str, after: Option<&str>, limit: usize, now: i64) -> Result<(Vec<Event>, u64, Option<String>, Option<crate::wire::HeldGroups>), RuntimeError> {
        let page = self.snapshot_acquisition_page_at(principal, after, limit, now)?;
        Ok((page.events, page.watermark, page.next.map(|next| next.encode()), page.held))
    }

    pub fn snapshot_acquisition_page_at(&mut self, principal: &str, after: Option<&str>, limit: usize, now: i64) -> Result<partition::SnapshotPage, RuntimeError> {
        let cursor = match after {
            Some(token) => Some(partition::SnapshotCursor::decode(token).ok_or_else(|| RuntimeError::Input("the snapshot cursor is not one this server minted".into()))?),
            None => None,
        };
        let tx = self.store.read_transaction()?;
        let page = partition::snapshot_page(&tx, &self.schema, principal, cursor, limit, now)?;
        tx.rollback()?;
        Ok(page)
    }

    /// The whole snapshot at once (the simulator's device, tests).
    pub fn snapshot(&mut self, principal: &str) -> Result<(Vec<Event>, u64), RuntimeError> {
        self.snapshot_at(principal, crate::now_ms())
    }

    pub fn snapshot_at(&mut self, principal: &str, now: i64) -> Result<(Vec<Event>, u64), RuntimeError> {
        let tx = self.store.read_transaction()?;
        let watermark = tx.next_seq()? - 1;
        let events = partition::snapshot(&tx, &self.schema, principal, now)?;
        tx.rollback()?;
        Ok((events, watermark))
    }

    pub fn stream(&mut self, principal: &str, watermark: u64, limit: usize) -> Result<partition::StreamPage, RuntimeError> {
        self.stream_at(principal, watermark, limit, crate::now_ms())
    }

    pub fn stream_at(&mut self, principal: &str, watermark: u64, limit: usize, now: i64) -> Result<partition::StreamPage, RuntimeError> {
        let tx = self.store.read_transaction()?;
        let page = partition::stream(&tx, &self.schema, principal, watermark, limit, now)?;
        tx.rollback()?;
        Ok(page)
    }

    /// Commits after `seq`, as the tables each touched: the online tier's
    /// invalidation signal.
    pub fn changes(&mut self, seq: u64, limit: usize) -> Result<Vec<(u64, Vec<String>)>, RuntimeError> {
        let tx = self.store.read_transaction()?;
        let out = tx.commits_after(seq, limit)?;
        tx.rollback()?;
        Ok(out)
    }

    pub fn seq(&self) -> Result<u64, RuntimeError> {
        self.store.seq()
    }
}

#[cfg(feature = "sqlite")]
pub use row_views::ViewChunk;

mod receipts;

#[cfg(feature = "sqlite")]
mod dev_reset;
#[cfg(feature = "sqlite")]
pub use dev_reset::DevReset;

/// Server-only exact Following history and resumable protocol custody.
#[cfg(feature = "sqlite")]
pub mod following_history;
// @ref LLP 3000.033#1.6 — the device has no Engine; this option is server-only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeliveryManifest { Build, Skip }

/// `/seed`'s write inside the caller's transaction: one commit when any row is written.
#[cfg(feature = "sqlite")]
pub(crate) fn seed_rows(schema: &Schema, tx: &crate::store::Tx<'_>, rows: impl IntoIterator<Item = (String, Value)>, now: i64) -> Result<u64, RuntimeError> {
    let rows = through_activation::ancestor_order(schema, rows);
    let targets: std::collections::BTreeSet<_> = schema.tables.values().flat_map(|table| table.recorded.values().map(|field| field.table.as_str())).collect();
    let mut imports = BTreeMap::<(String, String), Value>::new();
    let rows: Box<dyn Iterator<Item = (String, Value)> + '_> = if targets.is_empty() { Box::new(rows.into_iter()) } else {
        let rows: Vec<_> = rows.into_iter().collect();
        // A capture sees the imported target's eventual image, including
        // fields retained by patches, defaults and assigned ordinals.
        // Preview every allocation in input order (counters cross tables),
        // then undo the preview; ordinary writes allocate in that same
        // transaction and still own all validation, events and rollback.
        tx.savepoint("seed_sequences")?;
        let mut staging = Runner::new(tx, schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
        for (name, row) in &rows {
            schema.refuse_ephemeral_import(name)?;
            let table = schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))?;
            sequences::refuse_fields(table, name, row)?;
            let id = row.field("id")?.as_str()?.to_owned();
            let old = match imports.get(&(name.clone(), id.clone())) { Some(row) => Some(row.clone()), None => tx.get(name, &id)? }.filter(|row| !table.expired(row, now));
            let mut fields = old.as_ref().map(|row| row.as_object().cloned()).transpose()?.unwrap_or_default();
            fields.extend(row.as_object()?.clone());
            if old.is_none() { for (field, default) in &table.defaults { fields.entry(field.clone()).or_insert_with(|| default.value(now, crate::SYSTEM_PRINCIPAL)); } }
            let mut image = Value::Row(fields.into());
            if old.is_none() {
                let (assigned, full) = staging.sequence_fields(name, image.import_input(&ImportInput(())))?;
                if full { return Err(sequences::exhausted()); }
                staging.commit_sequences(name, &assigned)?;
                image = assigned;
            }
            imports.insert((name.clone(), id), image);
        }
        drop(staging);
        tx.rollback_to("seed_sequences")?;
        Box::new(rows.into_iter())
    };
    let seq = tx.next_seq()?;
    let mut runner = Runner::new(tx, schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
    runner.import_targets = Some(&imports);
    let mut count = 0;
    for (table, row) in rows {
        schema.refuse_ephemeral_import(&table)?;
        timeline::check_import(schema, &table)?;
        runner.upsert(&table, &row.field("id")?.clone(), row.import_input(&ImportInput(())))?;
        count += 1;
    }
    let events = runner.events.take();
    let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
    drop(runner);
    if count > 0 {
        tx.record_commit(seq, now, "seed", crate::SYSTEM_PRINCIPAL, "seed", &tables, count)?;
        partition::append(tx, seq, &events)?;
    }
    Ok(count)
    }
