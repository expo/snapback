//! The engine: one program, one principal, one SQLite transaction. A query
//! reads under the meter and returns `complete` or `capped`; a mutation
//! writes under the meter and returns `sent` with its sequence or `failed`
//! with a refusal, and applies at most once per client-minted id.

#[cfg(feature = "sqlite")]
pub mod job;
pub mod local;
pub mod admission;
mod pages;
pub mod read;
pub mod rules;
pub mod runner;
pub mod validate;
pub mod write;

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
use crate::value::canonical_json;
#[cfg(feature = "sqlite")]
use runner::Runner;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

/// Who runs the program, with what, and when.
#[derive(Clone, Debug)]
pub struct Context {
    pub viewer: String,
    pub kind: String,
    pub args: BTreeMap<String, Value>,
    pub now: Option<i64>,
    pub read_time: Option<i64>,
    /// Ids the caller minted for this run, consumed in order by `new`.
    pub new_ids: VecDeque<String>,
    entropy: u64,
    /// Every id consumed by this execution, including newly minted ids.
    pub(crate) minted_ids: Vec<String>,
}

impl Context {
    pub fn new(viewer: impl Into<String>, args: BTreeMap<String, Value>) -> Self {
        Self { viewer: viewer.into(), kind: "user".into(), args, now: None, read_time: None, new_ids: VecDeque::new(), entropy: 0, minted_ids: Vec::new() }
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

    pub(crate) fn mint(&mut self) -> String {
        let id = if let Some(id) = self.new_ids.pop_front() { id } else {
            if self.entropy == 0 { self.entropy = crate::ids::seed(); }
            crate::ids::mint(self.now.unwrap_or(0), &mut self.entropy)
        };
        self.minted_ids.push(id.clone());
        id
    }
}

/// A query's outcome: the card's read, minus `fresh` (transport truth).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueryOutcome {
    pub data: Value,
    pub complete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capped_at: Option<(MeterKind, String)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
    /// The store's sequence when the read ran.
    pub seq: u64,
    pub metered: Metered,
    pub tables: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum WriteState {
    Sent { seq: u64, result: Value },
    Failed { why: Refusal, #[serde(default, skip_serializing_if = "Option::is_none")] current: Option<Value> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutationOutcome {
    #[serde(flatten)]
    pub state: WriteState,
    pub metered: Metered,
    pub tables: Vec<String>,
    pub events: usize,
    /// Whether this call applied the write, or found it already applied.
    pub replayed: bool,
}

/// Leave to serve an asset's bytes: where they are and what they are.
#[cfg(feature = "sqlite")]
#[derive(Clone, Debug)]
pub struct AssetGrant {
    pub path: std::path::PathBuf,
    pub content_type: String,
    pub bytes: u64,
    /// One view: never cache it anywhere.
    pub once: bool,
}

#[cfg(feature = "sqlite")]
pub struct Engine {
    store: Store,
    schema: Schema,
    programs: BTreeMap<String, Program>,
    ceilings: Ceilings,
    entropy: u64,
    generation: u64,
}

#[cfg(feature = "sqlite")]
impl Engine {
    pub fn new(mut store: Store, schema: Schema, programs: impl IntoIterator<Item = Program>) -> Result<Self, RuntimeError> {
        let issues = crate::schema::validate(&schema);
        if let Some(issue) = issues.first() {
            return Err(RuntimeError::Schema(format!("{}: {}", issue.path, issue.message)));
        }
        let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        let generation = Self::activate(&mut store, &schema, &programs, None)?;
        Ok(Self { store, schema, programs, generation, ceilings: Ceilings::default(), entropy: crate::ids::seed() })
    }

    /// Activate an immutable source release. Its pointer lives in the same
    /// transaction as rows/programs/generation; the filesystem pointer is a
    /// checked convenience copy, never an independent authority.
    pub fn new_release(mut store: Store, schema: Schema, programs: impl IntoIterator<Item = Program>, release: u64, expected_previous: Option<u64>) -> Result<Self, RuntimeError> {
        if let Some(issue) = crate::schema::validate(&schema).first() { return Err(RuntimeError::Schema(format!("{}: {}", issue.path, issue.message))); }
        let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        let generation = Self::activate(&mut store, &schema, &programs, Some((release, expected_previous)))?;
        Ok(Self { store, schema, programs, generation, ceilings: Ceilings::default(), entropy: crate::ids::seed() })
    }

    /// Attach to an already activated semantic generation without installing
    /// caller source. Reads of its identity and compiled content are one snapshot.
    pub fn open(mut store: Store) -> Result<Self, RuntimeError> {
        let tx = store.transaction()?;
        let (generation, schema, programs): (u64, String, String) = tx.conn().query_row(
            "SELECT g.generation, g.schema, g.programs FROM _generations g JOIN _meta m ON m.key = 'generation' AND g.generation = CAST(m.value AS INTEGER)",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| RuntimeError::Store(format!("no readable activated backend in this store: {e}")))?;
        let schema = serde_json::from_str(&schema).map_err(|e| RuntimeError::Store(format!("invalid stored schema: {e}")))?;
        let programs = serde_json::from_str(&programs).map_err(|e| RuntimeError::Store(format!("invalid stored programs: {e}")))?;
        tx.rollback()?;
        Ok(Self { store, schema, programs, generation, ceilings: Ceilings::default(), entropy: crate::ids::seed() })
    }

    /// Serving a selected immutable release may attach only while that release
    /// is still current. A racing deployment makes startup retry, never adopt.
    pub fn attach_release(store: Store, expected: u64) -> Result<Self, RuntimeError> {
        let mut engine = Self::open(store)?;
        let tx = engine.store.transaction()?;
        let release: String = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'release'", [], |row| row.get(0))?;
        if release.parse::<u64>().ok() != Some(expected) {
            return Err(RuntimeError::Generation("the current release changed while starting; retry serve".into()));
        }
        tx.rollback()?;
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

    pub fn set_ceilings(&mut self, ceilings: Ceilings) {
        self.ceilings = ceilings;
    }

    pub fn ceilings(&self) -> Ceilings {
        self.ceilings
    }

    /// Replace the schema and programs in place (a successor generation);
    /// the store keeps every row and rebuilds changed indexes; the
    /// generation advances so every device re-derives its partition.
    pub fn adopt(&mut self, schema: Schema, programs: impl IntoIterator<Item = Program>) -> Result<u64, RuntimeError> {
        let issues = crate::schema::validate(&schema);
        if let Some(issue) = issues.first() {
            return Err(RuntimeError::Schema(format!("{}: {}", issue.path, issue.message)));
        }
        let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        let generation = Self::activate(&mut self.store, &schema, &programs, None)?;
        self.schema = schema;
        self.programs = programs;
        self.generation = generation;
        Ok(generation)
    }

    fn activate(store: &mut Store, schema: &Schema, programs: &BTreeMap<String, Program>, release: Option<(u64, Option<u64>)>) -> Result<u64, RuntimeError> {
        store.activate(schema, Some(programs), false, |tx, changed| {
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
            if !changed { return Ok(()); }
            use rusqlite::OptionalExtension;
            let previous: Option<String> = tx.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |row| row.get(0)).optional()?;
            let previous: Option<Schema> = previous.map(|text| serde_json::from_str(&text).map_err(|e| RuntimeError::Store(e.to_string()))).transpose()?;
            let rebuild: Vec<_> = schema.maintains.iter().filter(|m| previous.as_ref().is_none_or(|old| !old.maintains.contains(m))).collect();
            if rebuild.is_empty() { return Ok(()); }
            let now = crate::now_ms();
            let seq = tx.next_seq()?;
            let mut runner = Runner::new(tx, schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
            for maintain in rebuild { runner.rebuild_maintain(maintain)?; }
            let events = std::mem::take(&mut runner.events);
            let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
            let written = runner.rows_written;
            drop(runner);
            if written > 0 {
                tx.record_commit(seq, now, "rebuild", crate::SYSTEM_PRINCIPAL, "rebuild", &tables, written)?;
                partition::append(tx, seq, &events)?;
            }
            Ok(())
        })
    }

    /// Record an upload under `owner`: sniffed, bounded by the largest
    /// column of its kind in this schema, written beside the store. The
    /// asset is nobody's to see until a row claims it (the owner may).
    pub fn store_asset(&mut self, owner: &str, bytes: &[u8], now: i64) -> Result<Asset, RuntimeError> {
        let sniffed = assets::sniff(bytes)?;
        let ceiling = self
            .schema
            .tables
            .values()
            .flat_map(|table| table.columns.values())
            .filter_map(|kind| match (kind.required(), sniffed.kind) {
                (ColumnType::Image { max, .. }, AssetKind::Image) | (ColumnType::Video { max }, AssetKind::Video) => Some(*max),
                _ => None,
            })
            .max();
        let Some(ceiling) = ceiling else {
            return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("no column of this backend takes {} bytes; declare one (`photo: image <=10000000`)", sniffed.kind.word()) });
        };
        if bytes.len() as u64 > u64::from(ceiling) {
            return Err(RuntimeError::Asset { code: "E_ASSET_TOO_LARGE", message: format!("the {} is {} bytes; the largest {} column takes {ceiling}", sniffed.kind.word(), bytes.len(), sniffed.kind.word()) });
        }
        let id = crate::ids::mint(now, &mut self.entropy);
        let path = self.store.asset_path(&id);
        let io = |error: std::io::Error| RuntimeError::Store(format!("cannot keep the upload: {error}"));
        std::fs::create_dir_all(self.store.assets_dir()).map_err(io)?;
        let staging = path.with_extension("part");
        std::fs::write(&staging, bytes).map_err(io)?;
        std::fs::rename(&staging, &path).map_err(io)?;
        let asset = Asset { id, owner: owner.to_owned(), kind: sniffed.kind, content_type: sniffed.content_type.to_owned(), bytes: bytes.len() as u64, width: sniffed.width, height: sniffed.height, duration: sniffed.duration, created_at: now, home: None, released_at: None };
        if let Err(error) = self.store.record_asset(&asset) {
            let _ = std::fs::remove_file(&path);
            return Err(error);
        }
        Ok(asset)
    }

    /// Whether `principal` may have the bytes of `id` now: the uploader
    /// always; anyone else through the home row's read rule, on the row as
    /// it stands (present, still naming the asset, not expired). A
    /// `once` image records the view; the second view is refused. Hidden,
    /// released and absent are one word.
    pub fn asset_access(&mut self, principal: &str, id: &str, now: i64) -> Result<AssetGrant, RuntimeError> {
        let unknown = || RuntimeError::Asset { code: "E_ASSET_UNKNOWN", message: "no asset is served under that id to this viewer".into() };
        let path = self.store.asset_path(id);
        let tx = self.store.transaction()?;
        let Some(asset) = tx.asset(id)? else { return Err(unknown()) };
        if asset.released_at.is_some() {
            return Err(unknown());
        }
        let grant = |once: bool| AssetGrant { path: path.clone(), content_type: asset.content_type.clone(), bytes: asset.bytes, once };
        if asset.owner == principal {
            tx.rollback()?;
            return Ok(grant(false));
        }
        let Some((table_name, row_id, column)) = &asset.home else { return Err(unknown()) };
        let table = self.schema.table(table_name).ok_or_else(unknown)?;
        let Some(row) = tx.get(table_name, row_id)? else { return Err(unknown()) };
        if asset_id(row.field(column).ok()) != Some(id) || table.expired(&row, now) {
            return Err(unknown());
        }
        let mut image = row.clone();
        materialize_optional_fields(&mut image, table);
        let mut runner = Runner::new(&tx, &self.schema, Context::new(principal, BTreeMap::new()).at(now), Meter::new(self.ceilings, Cut::Cap), 0);
        let allowed = runner.check_rule(table_name, Effect::Read, None, &image)?;
        drop(runner);
        if !allowed {
            tx.rollback()?;
            return Err(unknown());
        }
        let once = matches!(table.columns.get(column).map(ColumnType::required), Some(ColumnType::Image { once: true, .. }));
        if once {
            if tx.asset_viewed(id, principal)? {
                tx.rollback()?;
                return Err(RuntimeError::Asset { code: "E_ASSET_VIEWED", message: "this photo was for one view, and it was viewed".into() });
            }
            tx.record_asset_view(id, principal, now)?;
        }
        tx.commit()?;
        Ok(grant(once))
    }

    /// Unlink and forget the assets nobody serves any more: released by
    /// their home, or never claimed within the grace period.
    pub fn sweep_assets(&mut self, now: i64) -> Result<u64, RuntimeError> {
        let stale = self.store.stale_assets(now)?;
        for asset in &stale {
            let _ = std::fs::remove_file(self.store.asset_path(&asset.id));
            self.store.forget_asset(&asset.id)?;
        }
        Ok(stale.len() as u64)
    }

    /// Delete the rows past their `expire` column. They were absent to
    /// every reader from the moment they expired; the sweep makes that
    /// physical, so the log carries the deletion to each device holding
    /// them. At most `limit` rows go in one commit; the next pass continues.
    pub fn sweep_expired(&mut self, now: i64, limit: usize) -> Result<u64, RuntimeError> {
        let expiring: Vec<(String, String)> = self.schema.tables.iter().filter_map(|(name, table)| table.expiry_index().map(|(index, _)| (name.clone(), index.to_owned()))).collect();
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
                    runner.remove(table_name, &row)?;
                    removed += 1;
                }
                if count < batch {
                    break;
                }
            }
        }
        let events = std::mem::take(&mut runner.events);
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
    pub fn query(&mut self, name: &str, mut context: Context) -> Result<QueryOutcome, Refusal> {
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
        if program.kind != ProgramKind::Query {
            return Err(RuntimeError::UnknownOp(format!("{name} is a {}, not a query", program.kind.word())).into());
        }
        validate::validate_inputs(&self.schema, &program, &mut context.args)?;
        if context.now.is_none() {
            context.now = Some(crate::now_ms());
        }
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()? - 1;
        let mut runner = Runner::new(&tx, &self.schema, context, Meter::new(self.ceilings, Cut::Cap), seq);
        let data = runner.run(&program)?;
        runner.charge_output(&data)?;
        let next = runner.next_cursor()?;
        // `complete` is a class, not a count: a query with a scan the prefix
        // does not decide is capped whatever the meter found (LLP 1001 §3).
        let outcome = QueryOutcome {
            complete: runner.meter.capped_at.is_none() && !runner.non_uniform && !runner.page_overflow,
            capped_at: runner.meter.capped_at.clone(),
            next,
            data,
            seq,
            metered: runner.meter.used,
            tables: runner.read_tables.iter().cloned().collect(),
        };
        drop(runner);
        tx.rollback()?;
        Ok(outcome)
    }

    /// Correlate a bounded pending outbox with authority already present in
    /// a stream page. Devices suppress those overlays before the mutation
    /// response arrives, but keep retrying for its complete result.
    pub fn acknowledged(&mut self, principal: &str, pending: &[String], through: u64) -> Result<BTreeMap<String, u64>, RuntimeError> {
        use rusqlite::OptionalExtension;
        if pending.len() > 256 || pending.iter().any(|id| id.len() > 128) { return Err(RuntimeError::Input("sync accepts at most 256 pending ids of at most 128 bytes".into())); }
        let tx = self.store.transaction()?;
        let mut acknowledged = BTreeMap::new();
        for id in pending {
            let seq: Option<u64> = tx.conn().query_row("SELECT seq FROM _ops WHERE principal = ?1 AND id = ?2 AND seq <= ?3", rusqlite::params![principal, id, through], |row| row.get(0)).optional()?;
            if let Some(seq) = seq { acknowledged.insert(id.clone(), seq); }
        }
        tx.rollback()?;
        Ok(acknowledged)
    }

    /// The recorded outcome of a client-minted op that already applied, so a
    /// host can answer a resend before it decodes the arguments against the
    /// current generation: the op may have been renamed since.
    pub fn replay(&self, viewer: &str, op: &str) -> Result<Option<MutationOutcome>, RuntimeError> {
        let Some(outcome) = self.store.applied_outcome(viewer, op)? else {
            return Ok(None);
        };
        let mut outcome: MutationOutcome = serde_json::from_str(&outcome).map_err(|e| RuntimeError::Store(e.to_string()))?;
        outcome.replayed = true;
        Ok(Some(outcome))
    }

    /// Run a mutation. With an `op` id the write applies at most once: a
    /// replay returns the recorded outcome. The replay check comes before
    /// anything the current generation could refuse (an op renamed, an
    /// argument narrowed), so a write that applied under an earlier schema
    /// is never re-judged: its row is on the server, and the device that
    /// queued it must learn `sent`, not `failed`.
    pub fn mutate(&mut self, name: &str, op: Option<&str>, mut context: Context) -> Result<MutationOutcome, RuntimeError> {
        if let Some(op) = op
            && let Some(outcome) = self.replay(&context.viewer, op)?
        {
            return Ok(outcome);
        }
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
        if program.kind == ProgramKind::Query {
            return Err(RuntimeError::UnknownOp(format!("{name} is a query, not a mutation")));
        }
        if program.kind == ProgramKind::Job {
            return Err(RuntimeError::UnknownOp(format!("{name} is a job: a schedule fires it, or `snapback4 run {name}` does; no caller can")));
        }
        if let Err(error) = validate::validate_inputs(&self.schema, &program, &mut context.args) {
            return Ok(MutationOutcome { state: WriteState::Failed { why: error.refusal(), current: None }, metered: Metered::default(), tables: Vec::new(), events: 0, replayed: false });
        }
        if context.now.is_none() {
            context.now = Some(crate::now_ms());
        }
        context.entropy = self.entropy;
        let ceilings = self.ceilings;
        let tx = self.store.transaction()?;
        if let Some(op) = op
            && let Some((_, outcome)) = tx.applied(&context.viewer, op)?
        {
            // Applied between the check above and this transaction.
            let mut outcome: MutationOutcome = serde_json::from_str(&outcome).map_err(|e| RuntimeError::Store(e.to_string()))?;
            outcome.replayed = true;
            tx.rollback()?;
            return Ok(outcome);
        }
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
            if !matches!(inner, crate::ir::ArgType::Image { .. } | crate::ir::ArgType::Video { .. }) {
                continue;
            }
            let Some(id) = asset_id(context.args.get(name)).map(str::to_owned) else { continue };
            if let Some(asset) = tx.asset(&id)?
                && (asset.owner == viewer || context.is_system())
            {
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
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        let events: Vec<Event> = std::mem::take(&mut runner.events);
        let outbox = std::mem::take(&mut runner.outbox);
        let rows_written = runner.rows_written;
        let mut read_tables = runner.read_tables.clone();
        self.entropy = runner.context.entropy;
        drop(runner);
        let outcome = match ran {
            Ok(result) => {
                tx.release("program")?;
                let seq = tx.next_seq()?;
                read_tables.extend(tables.iter().cloned());
                tx.record_commit(seq, now, name, &viewer, program.kind.word(), &tables, rows_written)?;
                partition::append(&tx, seq, &events)?;
                for (id, effect, payload) in &outbox {
                    tx.conn().execute(
                        "INSERT INTO _outbox(id, seq, effect, payload, state, attempts, at) VALUES (?1, ?2, ?3, ?4, 'queued', 0, ?5)",
                        rusqlite::params![id, seq as i64, effect, canonical_json(payload), now],
                    )?;
                }
                MutationOutcome { state: WriteState::Sent { seq, result }, metered, tables, events: events.len(), replayed: false }
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
                MutationOutcome { state: WriteState::Failed { why: error.refusal(), current }, metered, tables: Vec::new(), events: 0, replayed: false }
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
            tx.record_applied(&viewer, op, seq, &serde_json::to_string(&outcome).map_err(|e| RuntimeError::Store(e.to_string()))?)?;
        }
        tx.commit()?;
        Ok(outcome)
    }

    /// Write rows as the system principal: rules are bypassed, validation,
    /// constraints, aggregates and partition events are not. One commit.
    pub fn seed(&mut self, rows: impl IntoIterator<Item = (String, Value)>) -> Result<u64, RuntimeError> {
        let now = crate::now_ms();
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let mut count = 0;
        for (table, row) in rows {
            runner.upsert(&table, &row.field("id")?.clone(), row)?;
            count += 1;
        }
        let events = std::mem::take(&mut runner.events);
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        if count > 0 {
            tx.record_commit(seq, now, "seed", crate::SYSTEM_PRINCIPAL, "seed", &tables, count)?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(count)
    }

    /// Delete a row as the system principal: constraints, aggregates and
    /// partition events apply. Returns the number of rows removed (0 or 1).
    pub fn seed_delete(&mut self, table: &str, id: &str) -> Result<u64, RuntimeError> {
        let now = crate::now_ms();
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let removed = match runner.delete(table, id) {
            Ok(()) => 1,
            Err(RuntimeError::Require { .. }) => 0,
            Err(error) => return Err(error),
        };
        let events = std::mem::take(&mut runner.events);
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        if removed > 0 {
            tx.record_commit(seq, now, "seed", crate::SYSTEM_PRINCIPAL, "seed", &tables, removed)?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(removed)
    }

    /// Load rows exactly as given: validated and indexed, rules, constraints
    /// and aggregates skipped, partition events emitted. For fixtures whose
    /// aggregates are already computed and for the conformance corpus.
    pub fn load(&mut self, rows: impl IntoIterator<Item = (String, Value)>) -> Result<u64, RuntimeError> {
        let now = crate::now_ms();
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let mut count = 0;
        for (table_name, row) in rows {
            validate::validate_row(&self.schema, &table_name, &row)?;
            let table = self.schema.table(&table_name).expect("validated").clone();
            let id = row.field("id")?.as_str()?.to_owned();
            let old = tx.get(&table_name, &id)?;
            tx.put(&table_name, &table, &row, old.as_ref())?;
            partition::row_changed(&mut runner, &table_name, old.as_ref(), Some(&row))?;
            runner.written_tables.insert(table_name);
            count += 1;
        }
        let events = std::mem::take(&mut runner.events);
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
        let cursor = match after {
            Some(token) => Some(partition::SnapshotCursor::decode(token).ok_or_else(|| RuntimeError::Input("the snapshot cursor is not one this server minted".into()))?),
            None => None,
        };
        let tx = self.store.transaction()?;
        let page = partition::snapshot_page(&tx, &self.schema, principal, cursor, limit)?;
        tx.rollback()?;
        Ok((page.events, page.watermark, page.next.map(|next| next.encode())))
    }

    /// The whole snapshot at once (the simulator's device, tests).
    pub fn snapshot(&mut self, principal: &str) -> Result<(Vec<Event>, u64), RuntimeError> {
        let tx = self.store.transaction()?;
        let watermark = tx.next_seq()? - 1;
        let events = partition::snapshot(&tx, &self.schema, principal)?;
        tx.rollback()?;
        Ok((events, watermark))
    }

    pub fn stream(&mut self, principal: &str, watermark: u64, limit: usize) -> Result<partition::StreamPage, RuntimeError> {
        let tx = self.store.transaction()?;
        let page = partition::stream(&tx, &self.schema, principal, watermark, limit)?;
        tx.rollback()?;
        Ok(page)
    }

    /// Commits after `seq`, as the tables each touched: the online tier's
    /// invalidation signal.
    pub fn changes(&mut self, seq: u64, limit: usize) -> Result<Vec<(u64, Vec<String>)>, RuntimeError> {
        let tx = self.store.transaction()?;
        let out = tx.commits_after(seq, limit)?;
        tx.rollback()?;
        Ok(out)
    }

    pub fn seq(&self) -> Result<u64, RuntimeError> {
        self.store.seq()
    }
}
