use crate::cron::CronRunMetadata;
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::live_matcher::{
    compare_sort_keys, query_dependency_metadata, row_matches_query_filters, sort_key,
};
use crate::manifest::{HandlerInput, IbexModule, MutationOutput, QueryOutput, QueryPlan};
use crate::storage::{
    BufferedWrite, CapturedReadDependency, CapturedReadKind, DbRead, LocalDatabase, MutationCommit,
};
use crate::warm_vm::WarmVmPool;
use libc::{c_char, c_int, c_void, size_t};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::env;
use std::ffi::{CStr, CString};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::ptr;
use std::time::Instant;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub canonical_engine: String,
    pub ibex_submodule: IbexSubmoduleCapability,
    pub ibex_cli: IbexCliCapability,
    pub host_plan_runtime: bool,
    pub ibex_ctx_db_host_bridge: CapabilityState,
    pub async_handler_completion: CapabilityState,
    pub sqlite_lock_held_across_async: CapabilityState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct IbexSubmoduleCapability {
    pub present: bool,
    pub path: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct IbexCliCapability {
    pub available: bool,
    pub path: Option<PathBuf>,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CapabilityState {
    Available,
    Unavailable,
    NotYetWired,
}

#[derive(Clone, Debug)]
pub struct RuntimeManager {
    capabilities: RuntimeCapabilities,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct IbexQueryRun {
    pub output: QueryOutput,
    pub read_dependencies: Vec<CapturedReadDependency>,
}

/// The seam through which an action reaches instance state. Every db-touching
/// host call an action-mode VM can make flows through one host, so the host
/// implementation decides the locking policy: the in-lock host serves calls
/// through the borrow it already holds, while the server's detached host
/// reacquires the instance mutex per call so the action itself never holds it
/// (ENG-23324). The JS ambient layer denies `ctx.db` to actions today —
/// `query`/`get` here are the fail-safe boundary for a raw `db.*` host call
/// arriving in action mode, not a sanctioned surface.
pub trait IbexActionHost {
    fn run_mutation(&mut self, name: &str, input: HandlerInput) -> SnapbackResult<MutationOutput>;
    fn query(&mut self, plan: &QueryPlan, input: &HandlerInput) -> SnapbackResult<QueryOutput>;
    fn get(&mut self, table: &str, id: &str) -> SnapbackResult<Option<Value>>;
}

impl RuntimeManager {
    pub fn detect() -> Self {
        // @ref LLP 0002#decision — local dev reports Ibex as the canonical engine.
        // @ref LLP 0009#runtime-boundary — Ibex availability is a runtime capability, not an implicit fallback.
        Self {
            capabilities: RuntimeCapabilities {
                canonical_engine: "ibex".to_owned(),
                ibex_submodule: detect_ibex_submodule(),
                ibex_cli: detect_ibex_cli(),
                host_plan_runtime: true,
                ibex_ctx_db_host_bridge: CapabilityState::Available,
                async_handler_completion: CapabilityState::Available,
                sqlite_lock_held_across_async: CapabilityState::Unavailable,
            },
        }
    }

    pub fn capabilities(&self) -> &RuntimeCapabilities {
        &self.capabilities
    }

    pub fn diagnostics(&self) -> Vec<Diagnostic> {
        let mut diagnostics = Vec::new();
        if !self.capabilities.ibex_cli.available {
            diagnostics.push(
                Diagnostic::info(
                    "SNAPBACK_IBEX_CLI_UNAVAILABLE",
                    "runtime",
                    "ibex binary was not found; embedded Ibex handlers still run through the vendored runtime",
                )
                .with_details(json!({
                    "canonical_engine": self.capabilities.canonical_engine,
                    "ibex_submodule": self.capabilities.ibex_submodule,
                    "host_plan_runtime": self.capabilities.host_plan_runtime,
                    "ibex_ctx_db_host_bridge": self.capabilities.ibex_ctx_db_host_bridge
                })),
            );
        }
        diagnostics
    }

    /// Fresh-path query invocation (no warm pool). The pooled paths run
    /// through `LocalSnapback`/`ReadLane`, which own the per-instance pool.
    pub fn invoke_ibex_query(
        &self,
        module: &IbexModule,
        input: HandlerInput,
        db: &LocalDatabase,
    ) -> SnapbackResult<QueryOutput> {
        Ok(self.invoke_ibex_query_with_reads(module, input, db)?.output)
    }

    pub fn invoke_ibex_query_with_reads(
        &self,
        module: &IbexModule,
        input: HandlerInput,
        db: &LocalDatabase,
    ) -> SnapbackResult<IbexQueryRun> {
        run_ibex_query_with_reads(module, input, DbRead::Live(db), None)
    }

    pub(crate) fn invoke_ibex_mutation(
        &self,
        module: &IbexModule,
        input: HandlerInput,
        db: &mut LocalDatabase,
        pool: Option<&WarmVmPool>,
    ) -> SnapbackResult<MutationCommit> {
        let mut invocation = IbexHostContext::new(DbRead::Live(db), input.clone(), true);
        let result = run_ibex_handler_with_context(module, &mut invocation, pool)?;
        let IbexHostContext { writes, reads, .. } = invocation;
        db.commit_buffered_writes(&input, writes, reads, result)
    }

    pub fn invoke_ibex_action(
        &self,
        module: &IbexModule,
        input: HandlerInput,
        run: CronRunMetadata,
        host: &mut dyn IbexActionHost,
        grants: Value,
    ) -> SnapbackResult<Value> {
        let mut invocation = IbexHostContext::new_action(input, run, host, grants);
        // Actions always run fresh — no pool, by the DK-4 scope fence. That
        // fence is also what keeps per-invocation config grants (LLP 0036)
        // out of any reused VM: granted values ride the composed source of a
        // fresh runtime, never a pooled one.
        run_ibex_handler_with_context(module, &mut invocation, None)
    }
}

/// Run an Ibex query handler against any read view — the write lane passes the
/// live connection; the read lane passes a pinned reader so the eval's every
/// `ctx.db` host call and the reported version come from one WAL snapshot.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
pub(crate) fn run_ibex_query_with_reads(
    module: &IbexModule,
    input: HandlerInput,
    db: DbRead<'_>,
    pool: Option<&WarmVmPool>,
) -> SnapbackResult<IbexQueryRun> {
    let mut invocation = IbexHostContext::new(db, input, false);
    let value = run_ibex_handler_with_context(module, &mut invocation, pool)?;
    // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D9: a
    // query handler that returns a non-array is a fail-closed error, not a
    // silently-empty result set (the corpus's cardinal no-silent-drop rule).
    let rows = value.as_array().cloned().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_HANDLER_RESULT_INVALID",
            "runtime",
            "live query handler must return an array of rows",
        )
    })?;
    let output = QueryOutput {
        version: invocation.db().current_version()?,
        rows,
    };
    Ok(IbexQueryRun {
        output,
        read_dependencies: invocation.reads,
    })
}

#[repr(C)]
pub(crate) struct HermesRuntimeOpaque {
    _private: [u8; 0],
}

unsafe extern "C" {
    fn ex_hermes_create() -> *mut HermesRuntimeOpaque;
    fn ex_hermes_destroy(runtime: *mut HermesRuntimeOpaque);
    fn ex_hermes_eval(
        runtime: *mut HermesRuntimeOpaque,
        data: *const u8,
        len: size_t,
        source_url: *const c_char,
        is_bytecode: c_int,
        out_value: *mut *mut c_char,
    ) -> c_int;
    fn ex_hermes_free_string(value: *mut c_char);
    fn ex_hermes_set_host_call(
        runtime: *mut HermesRuntimeOpaque,
        callback: extern "C" fn(*const c_char, *const c_char) -> *mut c_char,
    );
}

pub(crate) struct RuntimeGuard(*mut HermesRuntimeOpaque);

/// The process-global Ibex host is a fixed capability *policy* (strict, plus a
/// coarse `network:fetch` grant when outbound actions are enabled), not
/// per-invocation state. Building and installing it on every invocation was
/// pure overhead — and, per M1, per-invocation VM cost dominates the whole
/// system. Install it exactly once per process. The per-invocation *context*
/// (reads/writes) stays thread-local and separate.
///
/// @ref LLP 0009#invocation-isolation — DK-4 cheapest safe step: cache what
/// carries no per-invocation user state.
/// @ref LLP 0032#phase-4--measurement — M2.
fn ensure_host_installed() {
    static INSTALLED: std::sync::Once = std::sync::Once::new();
    INSTALLED.call_once(|| {
        // @ref LLP 0009#capability-model — static checks are defense-in-depth;
        // the runtime host itself must deny ambient powers. The coarse
        // network:fetch gate is opened only when outbound actions are enabled;
        // the JS ambient layer still restricts fetch to the action class.
        let host = ibex_runtime::host::Host::strict();
        if outbound_actions_enabled() {
            host.capabilities().grant("*", "network:fetch", None);
        }
        ibex_runtime::host::abi::install_host(host);
    });
}

impl RuntimeGuard {
    pub(crate) fn create() -> SnapbackResult<Self> {
        ensure_host_installed();
        let runtime = unsafe { ex_hermes_create() };
        if runtime.is_null() {
            return Err(SnapbackError::error(
                "SNAPBACK_RUNTIME_CREATE_FAILED",
                "runtime",
                "Ibex runtime could not be created",
            ));
        }
        unsafe { ex_hermes_set_host_call(runtime, snapback_host_call) };
        Ok(Self(runtime))
    }

    pub(crate) fn ptr(&self) -> *mut HermesRuntimeOpaque {
        self.0
    }
}

impl Drop for RuntimeGuard {
    fn drop(&mut self) {
        unsafe { ex_hermes_destroy(self.0) };
    }
}

/// Mean microseconds to create + destroy a runtime (`ex_hermes_create` +
/// host-call wiring + drop), with the host install already cached. Lets the M1
/// harness attribute the per-invocation VM cost to *creation* (which a warm VM
/// would avoid) versus *eval* (the handler run itself).
///
/// @ref LLP 0032#phase-4--measurement — M2 VM-cost decomposition.
pub fn bench_runtime_create_us(iterations: usize) -> f64 {
    for _ in 0..4 {
        let _ = RuntimeGuard::create();
    }
    let start = Instant::now();
    for _ in 0..iterations {
        let _guard = RuntimeGuard::create();
    }
    start.elapsed().as_micros() as f64 / iterations.max(1) as f64
}

/// Process-monotonic invocation epoch. Every invocation (fresh or warm) gets
/// a unique one; it is baked into that invocation's JS `ctx` closures and
/// carried on every host call so a continuation from a *prior* invocation —
/// firing during a *later* one on the same warm VM — is rejected instead of
/// silently routed to the current invocation's context (cross-user write
/// injection). See [`snapback_host_call`].
///
/// @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 — stale-continuation guard.
static NEXT_INVOCATION_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn next_invocation_epoch() -> u64 {
    NEXT_INVOCATION_EPOCH.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

fn action_host_missing() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ACTION_HOST_MISSING",
        "runtime",
        "action host call ran without an action host",
    )
}

struct IbexHostContext<'a> {
    /// The storage view for query/mutation invocations. Actions carry `None`:
    /// their `ctx.db` reads route through the action host, whose
    /// implementation chooses the locking policy (ENG-23324).
    db: Option<DbRead<'a>>,
    input: HandlerInput,
    mode: IbexInvocationMode,
    writes: Vec<BufferedWrite>,
    reads: Vec<CapturedReadDependency>,
    now_ms: u64,
    action_run: Option<CronRunMetadata>,
    action_host: Option<&'a mut dyn IbexActionHost>,
    /// This invocation's identity. A host call whose carried epoch does not
    /// equal this is a stale continuation and is rejected.
    epoch: u64,
    /// The granted-config payload for this invocation (actions only) — the
    /// host-computed `uses` grant, never a process-wide blob.
    ///
    /// @ref LLP 0036#runtime-exposure-d5-d8 — per-invocation grants replace
    /// the deprecated `SNAPBACK_ACTION_SECRETS` env seam (LLP 0029 G4).
    grants: Value,
}

impl<'a> IbexHostContext<'a> {
    fn new(db: DbRead<'a>, input: HandlerInput, writable: bool) -> Self {
        let reads = auth_dependencies(&input);
        Self {
            db: Some(db),
            input,
            mode: if writable {
                IbexInvocationMode::Mutation
            } else {
                IbexInvocationMode::Query
            },
            writes: Vec::new(),
            reads,
            now_ms: now_millis(),
            action_run: None,
            action_host: None,
            epoch: next_invocation_epoch(),
            grants: Value::Null,
        }
    }

    fn new_action(
        input: HandlerInput,
        run: CronRunMetadata,
        host: &'a mut dyn IbexActionHost,
        grants: Value,
    ) -> Self {
        let reads = auth_dependencies(&input);
        Self {
            db: None,
            input,
            mode: IbexInvocationMode::Action,
            writes: Vec::new(),
            reads,
            now_ms: run.due_at_ms,
            action_run: Some(run),
            action_host: Some(host),
            epoch: next_invocation_epoch(),
            grants,
        }
    }

    fn db(&self) -> &DbRead<'a> {
        self.db
            .as_ref()
            .expect("query/mutation invocation carries a db view")
    }

    fn epoch(&self) -> u64 {
        self.epoch
    }

    fn handle_host_call(&mut self, op: &str, args: Value) -> SnapbackResult<Value> {
        match op {
            "db.query" => {
                let plan = serde_json::from_value::<QueryPlan>(
                    args.get("plan").cloned().unwrap_or(Value::Null),
                )
                .map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                        "runtime",
                        "ctx.db.query received an invalid query plan",
                    )
                    .with_details(json!({ "error": error.to_string() }))
                })?;
                if self.mode == IbexInvocationMode::Action {
                    // Actions read through the host (which decides locking —
                    // ENG-23324) and skip read capture: an action is not a
                    // transaction, so its read set is never consumed. No
                    // buffered-write overlay either — actions cannot buffer
                    // writes (`ensure_writable` rejects them).
                    let host = self.action_host.as_deref_mut().ok_or_else(action_host_missing)?;
                    let output = host.query(&plan, &self.input)?;
                    return serde_json::to_value(output).map_err(|error| {
                        SnapbackError::error(
                            "SNAPBACK_HANDLER_HOST_CALL_SERIALIZE_FAILED",
                            "runtime",
                            "ctx.db.query output could not be serialized",
                        )
                        .with_details(json!({ "error": error.to_string() }))
                    });
                }
                let output = self.db().query(&plan, &self.input)?;
                // Capture the read dependency on the storage result the plan
                // declared (its limit included) — the buffered overlay below is
                // the handler's own uncommitted writes, not a storage dependency.
                self.capture_query_read(&plan, &output)?;
                // @ref LLP 0032#phase-2--execution-semantics-honesty — E2: layer
                // this invocation's buffered writes over the storage result so
                // the handler reads its own writes (read-your-writes).
                let output = if self.has_buffered_writes_for(&plan.table) {
                    let version = output.version;
                    // With a limit, merge over the *unlimited* base so a buffered
                    // insert can surface a row the SQL limit would have hidden.
                    let base_rows = if plan.limit.is_some() {
                        let mut unlimited = plan.clone();
                        unlimited.limit = None;
                        self.db().query(&unlimited, &self.input)?.rows
                    } else {
                        output.rows
                    };
                    QueryOutput {
                        version,
                        rows: self.merge_buffered_into_query(&plan, base_rows),
                    }
                } else {
                    output
                };
                serde_json::to_value(output).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_HANDLER_HOST_CALL_SERIALIZE_FAILED",
                        "runtime",
                        "ctx.db.query output could not be serialized",
                    )
                    .with_details(json!({ "error": error.to_string() }))
                })
            }
            "db.get" => {
                let table = required_string(&args, "table")?;
                let id = required_string(&args, "id")?;
                if self.mode == IbexInvocationMode::Action {
                    // Host-routed, capture-free read — same rationale as the
                    // action arm of db.query above (ENG-23324).
                    let host = self.action_host.as_deref_mut().ok_or_else(action_host_missing)?;
                    return Ok(host.get(&table, &id)?.unwrap_or(Value::Null));
                }
                let stored = self.db().get(&table, &id)?;
                self.capture_point_read(&table, &id, stored.as_ref())?;
                // E2: read-your-writes — fold buffered writes over the stored row.
                Ok(self
                    .apply_buffered_to_point(&table, &id, stored)
                    .unwrap_or(Value::Null))
            }
            "db.insert" => {
                self.ensure_writable("insert")?;
                let table = required_string(&args, "table")?;
                let values = required_object(&args, "values")?;
                let id = self.db().generate_id();
                self.writes.push(BufferedWrite::Insert {
                    table,
                    id: id.clone(),
                    values,
                });
                Ok(Value::String(id))
            }
            "db.patch" => {
                self.ensure_writable("patch")?;
                let table = required_string(&args, "table")?;
                let id = required_string(&args, "id")?;
                let values = required_object(&args, "values")?;
                let stored = self.db().get(&table, &id)?;
                self.capture_point_read(&table, &id, stored.as_ref())?;
                // E2: `existed` reflects the effective view — a row buffered-inserted
                // earlier in this handler exists even though it is not yet committed.
                let existed = self.apply_buffered_to_point(&table, &id, stored).is_some();
                self.writes.push(BufferedWrite::Patch { table, id, values });
                Ok(Value::Bool(existed))
            }
            "db.delete" => {
                self.ensure_writable("delete")?;
                let table = required_string(&args, "table")?;
                let id = required_string(&args, "id")?;
                let stored = self.db().get(&table, &id)?;
                self.capture_point_read(&table, &id, stored.as_ref())?;
                let existed = self.apply_buffered_to_point(&table, &id, stored).is_some();
                self.writes.push(BufferedWrite::Delete { table, id });
                Ok(Value::Bool(existed))
            }
            "runtime.now" => Ok(json!(self.now_ms)),
            // Id generation is storage-independent, so it stays available to
            // actions, whose context carries no db view (ENG-23324).
            "runtime.id" => Ok(Value::String(crate::storage::new_id())),
            "action.metadata" => serde_json::to_value(self.action_run.as_ref()).map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_ACTION_METADATA_SERIALIZE_FAILED",
                    "runtime",
                    "action run metadata could not be serialized",
                )
                .with_details(json!({ "error": error.to_string() }))
            }),
            "action.runMutation" => {
                self.ensure_action("runMutation")?;
                let name = required_string(&args, "name")?;
                let mutation_args = args
                    .get("args")
                    .cloned()
                    .unwrap_or(Value::Object(Map::new()));
                let input = HandlerInput {
                    args: mutation_args,
                    auth: self.input.auth.clone(),
                    read_set: Vec::new(),
                    correlation: None,
                };
                let host = self.action_host.as_deref_mut().ok_or_else(action_host_missing)?;
                let output = host.run_mutation(&name, input)?;
                Ok(output.result)
            }
            _ => Err(SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_UNKNOWN",
                "runtime",
                format!("unknown handler host call {op}"),
            )),
        }
    }

    fn ensure_writable(&self, op: &str) -> SnapbackResult<()> {
        if self.mode == IbexInvocationMode::Mutation {
            return Ok(());
        }
        Err(SnapbackError::error(
            "SNAPBACK_HANDLER_WRITE_IN_QUERY",
            "runtime",
            format!("query handler attempted ctx.db.{op}"),
        ))
    }

    /// Whether this invocation has buffered any write targeting `table`.
    ///
    /// @ref LLP 0032#phase-2--execution-semantics-honesty — E2.
    fn has_buffered_writes_for(&self, table: &str) -> bool {
        self.writes.iter().any(|write| write.table() == table)
    }

    /// Fold this invocation's buffered writes for `(table, id)` over a stored
    /// row, producing the row the handler should observe. A buffered insert's
    /// system fields mirror `insert_document`'s shape with a provisional
    /// `_createdAt`/`_updatedAt` (the frozen handler clock); the authoritative
    /// version and timestamps are assigned at commit.
    ///
    /// @ref LLP 0032#phase-2--execution-semantics-honesty — E2 read-your-writes overlay.
    fn apply_buffered_to_point(
        &self,
        table: &str,
        id: &str,
        stored: Option<Value>,
    ) -> Option<Value> {
        let mut current = stored;
        for write in &self.writes {
            if write.table() != table || write.id() != id {
                continue;
            }
            match write {
                BufferedWrite::Insert { values, .. } => {
                    current = Some(self.materialize_insert(id, values));
                }
                BufferedWrite::Patch { values, .. } => {
                    // A patch against a row that does not exist yet is a no-op at
                    // commit; the effective view stays a miss.
                    if let Some(Value::Object(mut row)) = current.take() {
                        for (key, value) in values {
                            row.insert(key.clone(), value.clone());
                        }
                        row.insert("_updatedAt".to_owned(), json!(self.now_ms));
                        current = Some(Value::Object(row));
                    }
                }
                BufferedWrite::Delete { .. } => {
                    current = None;
                }
            }
        }
        current
    }

    fn materialize_insert(&self, id: &str, values: &Map<String, Value>) -> Value {
        let mut document = Map::new();
        document.insert("_id".to_owned(), Value::String(id.to_owned()));
        document.insert("_createdAt".to_owned(), json!(self.now_ms));
        document.insert("_updatedAt".to_owned(), json!(self.now_ms));
        for (key, value) in values {
            document.insert(key.clone(), value.clone());
        }
        Value::Object(document)
    }

    /// Layer buffered writes over a storage query result: drop rows this
    /// invocation has since deleted, recompute patched/inserted rows from their
    /// effective view, keep only those still matching the plan's filters, then
    /// re-sort and re-apply the limit with the same primitives the live matcher
    /// uses. `base_rows` must be unlimited when the plan carries a limit.
    ///
    /// @ref LLP 0032#phase-2--execution-semantics-honesty — E2.
    fn merge_buffered_into_query(&self, plan: &QueryPlan, base_rows: Vec<Value>) -> Vec<Value> {
        let touched: BTreeSet<&str> = self
            .writes
            .iter()
            .filter(|write| write.table() == plan.table)
            .map(|write| write.id())
            .collect();

        let mut merged: Vec<Value> = base_rows
            .into_iter()
            .filter(|row| {
                row.get("_id")
                    .and_then(Value::as_str)
                    .map(|id| !touched.contains(id))
                    .unwrap_or(true)
            })
            .collect();

        for id in &touched {
            let stored = self.db().get(&plan.table, id).ok().flatten();
            if let Some(row) = self.apply_buffered_to_point(&plan.table, id, stored)
                && row_matches_query_filters(plan, &self.input, &row) == Some(true)
            {
                merged.push(row);
            }
        }

        if !plan.order.is_empty() {
            merged.sort_by(
                |left, right| match (sort_key(plan, left), sort_key(plan, right)) {
                    (Some(left_key), Some(right_key)) => {
                        compare_sort_keys(plan, &left_key, &right_key).unwrap_or(Ordering::Equal)
                    }
                    _ => Ordering::Equal,
                },
            );
        }
        if let Some(limit) = plan.limit {
            merged.truncate(limit);
        }
        merged
    }

    fn ensure_action(&self, op: &str) -> SnapbackResult<()> {
        if self.mode == IbexInvocationMode::Action {
            return Ok(());
        }
        Err(SnapbackError::error(
            "SNAPBACK_ACTION_CONTEXT_UNAVAILABLE",
            "runtime",
            format!("ctx.{op} is only available to action handlers"),
        ))
    }

    fn capture_point_read(
        &mut self,
        table: &str,
        id: &str,
        row: Option<&Value>,
    ) -> SnapbackResult<()> {
        let dependency = if let Some(row) = row {
            CapturedReadDependency {
                kind: CapturedReadKind::Row,
                table: Some(table.to_owned()),
                id: Some(id.to_owned()),
                version: Some(row_version(row)?),
                predicate: None,
                rows: Vec::new(),
                field: None,
                value: None,
                order: None,
                limit: None,
                result_count: None,
                boundary: None,
            }
        } else {
            CapturedReadDependency {
                kind: CapturedReadKind::MissingRow,
                table: Some(table.to_owned()),
                id: Some(id.to_owned()),
                version: Some(self.db().table_change_version(table)?),
                predicate: None,
                rows: Vec::new(),
                field: None,
                value: None,
                order: None,
                limit: None,
                result_count: None,
                boundary: None,
            }
        };
        self.push_read_dependency(dependency);
        Ok(())
    }

    fn capture_query_read(&mut self, plan: &QueryPlan, output: &QueryOutput) -> SnapbackResult<()> {
        let rows = output
            .rows
            .iter()
            .filter_map(|row| {
                row.get("_id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Vec<_>>();
        for row in &output.rows {
            if let (Some(id), Some(version)) = (
                row.get("_id").and_then(Value::as_str),
                row.get("_version").and_then(Value::as_u64),
            ) {
                self.push_read_dependency(CapturedReadDependency {
                    kind: CapturedReadKind::Row,
                    table: Some(plan.table.clone()),
                    id: Some(id.to_owned()),
                    version: Some(version),
                    predicate: None,
                    rows: Vec::new(),
                    field: None,
                    value: None,
                    order: None,
                    limit: None,
                    result_count: None,
                    boundary: None,
                });
            }
        }
        let (order, limit, result_count, boundary) = query_dependency_metadata(plan, &output.rows)?;
        let predicate = serde_json::to_value(plan).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CAPTURED_READ_SERIALIZE_FAILED",
                "runtime",
                "query dependency could not be serialized",
            )
            .with_details(json!({ "error": error.to_string() }))
        })?;
        self.push_read_dependency(CapturedReadDependency {
            kind: CapturedReadKind::Query,
            table: Some(plan.table.clone()),
            id: None,
            version: Some(self.db().table_change_version(&plan.table)?),
            predicate: Some(predicate),
            rows,
            field: None,
            value: None,
            order,
            limit,
            result_count,
            boundary,
        });
        Ok(())
    }

    fn push_read_dependency(&mut self, dependency: CapturedReadDependency) {
        if !self.reads.contains(&dependency) {
            self.reads.push(dependency);
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum IbexInvocationMode {
    Query,
    Mutation,
    Action,
}

/// Test seam for the DK-4 keying invariant: the warm pool keys by module
/// source alone, which is sound only while the query and mutation ambient
/// restriction texts are identical.
#[cfg(test)]
pub(crate) fn ambient_restriction_source_for_tests(mutation: bool, outbound: bool) -> String {
    let mode = if mutation {
        IbexInvocationMode::Mutation
    } else {
        IbexInvocationMode::Query
    };
    ambient_restriction_source(mode, outbound)
}

thread_local! {
    static CURRENT_IBEX_HOST_CONTEXT: RefCell<*mut c_void> = const { RefCell::new(ptr::null_mut()) };
}

fn run_ibex_handler_with_context(
    module: &IbexModule,
    invocation: &mut IbexHostContext<'_>,
    pool: Option<&WarmVmPool>,
) -> SnapbackResult<Value> {
    // @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
    // scope fences: only queries and mutations take the warm path; actions
    // always run fresh (secrets/cron/egress powers, and keeping the outer
    // invocation of the only nested shape — action→mutation — off the pool
    // makes checkout re-entrancy-proof). Hosted/untrusted is untouched: no
    // pool handle, no warm path.
    if let Some(pool) = pool
        && !matches!(invocation.mode, IbexInvocationMode::Action)
        && pool.enabled()
    {
        return run_warm_handler_with_context(module, invocation, pool);
    }

    let runtime = RuntimeGuard::create()?;
    let source = invocation_source(module, invocation)?;

    // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D1: the
    // context pointer is saved and restored (a stack, via recursion), not
    // unconditionally nulled. An Ibex action whose `ctx.runMutation` targets
    // an Ibex mutation re-enters this function synchronously on the same
    // thread; nulling on the inner exit would strand the outer invocation so
    // its next host call fails with SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT.
    let previous_context = CURRENT_IBEX_HOST_CONTEXT.with(|slot| {
        let previous = *slot.borrow();
        *slot.borrow_mut() = invocation as *mut IbexHostContext<'_> as *mut c_void;
        previous
    });
    let eval_result = eval(runtime.0, &module.export, &source);
    CURRENT_IBEX_HOST_CONTEXT.with(|slot| {
        *slot.borrow_mut() = previous_context;
    });

    parse_handler_output(module, eval_result?)
}

/// The DK-4 warm path: check out a VM keyed by the exact module source, run
/// the setup eval once per VM (inside the invocation's host-context window,
/// so first-invocation module top-level host calls match the fresh path),
/// eval only the small invoke IIFE per invocation, then let the pool's
/// reset-and-verify decide whether the VM survives. Any eval error burns the
/// VM (drop = destroy); fresh-per-invocation is always the fallback.
///
/// @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 — warm structure.
fn run_warm_handler_with_context(
    module: &IbexModule,
    invocation: &mut IbexHostContext<'_>,
    pool: &WarmVmPool,
) -> SnapbackResult<Value> {
    let mut vm = pool.checkout(&module.source)?;
    let iife = invocation_iife_source(module, invocation)?;

    // S5.D1: same save/restore stack as the fresh path. The reset eval below
    // runs *after* the restore — its source is a fixed string that makes no
    // host calls, so it can never observe a stale or outer context.
    let previous_context = CURRENT_IBEX_HOST_CONTEXT.with(|slot| {
        let previous = *slot.borrow();
        *slot.borrow_mut() = invocation as *mut IbexHostContext<'_> as *mut c_void;
        previous
    });
    let eval_result = (|| {
        if !vm.is_set_up() {
            eval(
                vm.runtime(),
                crate::warm_vm::WARM_SETUP_SOURCE_URL,
                &warm_setup_source(module),
            )?;
            vm.mark_set_up();
        }
        eval(vm.runtime(), &module.export, &iife)
    })();
    CURRENT_IBEX_HOST_CONTEXT.with(|slot| {
        *slot.borrow_mut() = previous_context;
    });

    match eval_result {
        Ok(output) => {
            pool.reset_and_check_in(vm);
            parse_handler_output(module, output)
        }
        Err(error) => {
            drop(vm); // burn: an errored eval's VM state is not trusted
            Err(error)
        }
    }
}

/// Unwrap the invoke IIFE's tagged completion envelope. The tag is
/// load-bearing: a status-0 eval does NOT prove the handler ran to
/// completion, because the eval loop's no-progress fallback returns the
/// still-pending invocation promise (stringified to "{}"). Only the IIFE
/// constructs the {"r": ...} envelope, and only after the awaited handler
/// value exists — so anything untagged on this channel means the handler
/// never settled and must fail closed with nothing committed (ENG-23430).
fn parse_handler_output(module: &IbexModule, output: String) -> SnapbackResult<Value> {
    if let Ok(Value::Object(mut envelope)) = serde_json::from_str(&output)
        && envelope.len() == 1
        && let Some(result) = envelope.remove("r")
    {
        return Ok(result);
    }
    Err(SnapbackError::error(
        "SNAPBACK_HANDLER_DID_NOT_SETTLE",
        "runtime",
        "handler promise never settled — the invocation produced no result and committed no writes",
    )
    .with_details(json!({
        "function": module.export,
        "output": output,
    })))
}

pub(crate) fn eval(
    runtime: *mut HermesRuntimeOpaque,
    source_url: &str,
    source: &str,
) -> SnapbackResult<String> {
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L7: a Hermes
    // eval is synchronous FFI for the whole handler run and must never occupy
    // a tokio async worker.
    crate::exec_guard::debug_assert_off_async_worker("ex_hermes_eval");
    let source_url =
        CString::new(source_url).unwrap_or_else(|_| CString::new("handler.js").unwrap());
    let mut out: *mut c_char = ptr::null_mut();
    let status = unsafe {
        ex_hermes_eval(
            runtime,
            source.as_ptr(),
            source.len(),
            source_url.as_ptr(),
            0,
            &mut out,
        )
    };
    let output = if out.is_null() {
        String::new()
    } else {
        let text = unsafe { CStr::from_ptr(out) }
            .to_string_lossy()
            .into_owned();
        unsafe { ex_hermes_free_string(out) };
        text
    };
    if status == 0 {
        return Ok(output);
    }

    let code = if output.contains("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED") {
        "SNAPBACK_HANDLER_CAPABILITY_DENIED"
    } else if output.contains("SNAPBACK_HANDLER_EXPORT_MISSING") {
        "SNAPBACK_HANDLER_EXPORT_MISSING"
    } else if output.contains("SNAPBACK_HANDLER_STALE_CONTINUATION") {
        // A stale continuation's host call threw and propagated to the
        // handler top level (the synchronous-fire case). Surface it distinctly
        // so it is diagnosable rather than a generic failure.
        "SNAPBACK_HANDLER_STALE_CONTINUATION"
    } else if output.contains("SNAPBACK_CONFIG_UNDECLARED") {
        // @ref LLP 0036#declared-configuration-in-the-manifest — D8: access
        // outside the `uses` grant is its own diagnostic, distinct from a
        // declared-but-unset entry.
        "SNAPBACK_CONFIG_UNDECLARED"
    } else if output.contains("SNAPBACK_CONFIG_MISSING") {
        "SNAPBACK_CONFIG_MISSING"
    } else if output.contains("SNAPBACK_HANDLER_RESULT_INVALID") {
        // The invoke IIFE throws this for non-JSON-serializable returns
        // (function/symbol), which only JS can still distinguish from a
        // pending promise (ENG-23430).
        "SNAPBACK_HANDLER_RESULT_INVALID"
    } else {
        "SNAPBACK_HANDLER_FAILED"
    };
    Err(
        SnapbackError::error(code, "runtime", "JavaScript handler failed").with_details(json!({
            "message": first_line(&output),
        })),
    )
}

extern "C" fn snapback_host_call(op: *const c_char, args_json: *const c_char) -> *mut c_char {
    let result = std::panic::catch_unwind(|| {
        let raw_op = c_string_to_string(op)?;
        // Every legitimate host call is emitted by the per-invocation `host()`
        // closure as "<epoch>|<op>" — the epoch is baked into that closure at
        // invocation time, so a stale continuation carries the *prior*
        // invocation's epoch. A bare op (no separator) can only come from code
        // calling `__hostCall` directly, bypassing `ctx`; that is unsupported
        // and fails closed.
        let (epoch_str, op) = raw_op.split_once('|').ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_MALFORMED",
                "runtime",
                "handler host call was not issued through ctx",
            )
        })?;
        let call_epoch = epoch_str.parse::<u64>().map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_MALFORMED",
                "runtime",
                "handler host call carried an unparseable invocation epoch",
            )
        })?;
        let args_json = c_string_to_string(args_json)?;
        let args = serde_json::from_str::<Value>(&args_json).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_INVALID_JSON",
                "runtime",
                "handler host call arguments were not valid JSON",
            )
            .with_details(json!({ "error": error.to_string() }))
        })?;

        CURRENT_IBEX_HOST_CONTEXT.with(|slot| {
            let ptr = *slot.borrow();
            if ptr.is_null() {
                return Err(SnapbackError::error(
                    "SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT",
                    "runtime",
                    "handler host call ran without an invocation context",
                ));
            }
            let ctx = unsafe { &mut *(ptr as *mut IbexHostContext<'_>) };
            // @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
            // the stale-continuation guard: a continuation captured in module
            // scope by invocation A, fired during invocation B's microtask
            // pump on the same warm VM, would otherwise route A's `ctx.db.*`
            // through B's live context (B's auth, B's commit buffer). Reject
            // the mismatch fail-closed rather than execute A against B.
            if ctx.epoch() != call_epoch {
                return Err(SnapbackError::error(
                    "SNAPBACK_HANDLER_STALE_CONTINUATION",
                    "runtime",
                    "a handler continuation from a prior invocation attempted a \
                     host call against the current invocation; rejected",
                ));
            }
            ctx.handle_host_call(op, args)
        })
    });

    match result {
        Ok(Ok(value)) => c_host_response('+', value.to_string()),
        Ok(Err(error)) => c_host_response('-', error.to_string()),
        Err(_) => c_host_response('-', "SNAPBACK_HANDLER_HOST_CALL_PANIC".to_owned()),
    }
}

fn invocation_source(
    module: &IbexModule,
    invocation: &IbexHostContext<'_>,
) -> SnapbackResult<String> {
    Ok(format!(
        "{}\n{}\n{}\n{}",
        ambient_restriction_source(invocation.mode, outbound_actions_enabled()),
        module.source,
        ctx_bootstrap_source(),
        invocation_iife_source(module, invocation)?,
    ))
}

/// The per-invocation tail of the eval source: the async IIFE that calls
/// `__snapbackInvoke` with this invocation's literals. The fresh path appends
/// it to ambient + module + bootstrap in one eval; the warm path evals it
/// alone against an already-set-up VM — same text either way, so the two
/// paths cannot drift.
fn invocation_iife_source(
    module: &IbexModule,
    invocation: &IbexHostContext<'_>,
) -> SnapbackResult<String> {
    let input = &invocation.input;
    let args_json = serde_json::to_string(&input.args).map_err(handler_serialize_error)?;
    let auth_json = serde_json::to_string(&input.auth).map_err(handler_serialize_error)?;
    let export_json = serde_json::to_string(&module.export).map_err(handler_serialize_error)?;
    let args_literal = serde_json::to_string(&args_json).map_err(handler_serialize_error)?;
    let auth_literal = serde_json::to_string(&auth_json).map_err(handler_serialize_error)?;
    let mode = match invocation.mode {
        IbexInvocationMode::Query => "query",
        IbexInvocationMode::Mutation => "mutation",
        IbexInvocationMode::Action => "action",
    };
    let mode_json = serde_json::to_string(mode).map_err(handler_serialize_error)?;
    let run_json =
        serde_json::to_string(&invocation.action_run).map_err(handler_serialize_error)?;
    let run_literal = serde_json::to_string(&run_json).map_err(handler_serialize_error)?;

    // The granted-config payload is exposed only to actions (and is never
    // client-visible): the host-computed per-invocation `uses` grant.
    //
    // @ref LLP 0036#runtime-exposure-d5-d8 — handles, actions only.
    let secrets_json = if matches!(invocation.mode, IbexInvocationMode::Action) {
        invocation.grants.to_string()
    } else {
        "null".to_string()
    };
    let secrets_literal = serde_json::to_string(&secrets_json).map_err(handler_serialize_error)?;
    // The epoch travels as a decimal *string* literal so it is exact past the
    // f64 safe-integer range; JS concatenates it onto every host op. Baking it
    // into this per-invocation IIFE (and thus into the `ctx` closures the
    // bootstrap builds) is what lets the host reject a stale continuation.
    let epoch_literal =
        serde_json::to_string(&invocation.epoch().to_string()).map_err(handler_serialize_error)?;

    // The IIFE resolves to a tagged envelope ({"r": ...}), never a bare
    // value. The vendored eval loop cannot always drive the promise to
    // settlement: with no timers and no pending host work it falls back to
    // returning the still-pending Promise with SUCCESS status, which
    // JSON-stringifies to "{}" — indistinguishable from a handler that
    // legitimately returned {} if the channel is untagged. The envelope is
    // only ever constructed after the awaited handler value exists, so an
    // untagged output proves the handler never settled (ENG-23430).
    // Non-JSON-serializable returns (function/symbol) are rejected here in
    // JS, the only place they are still distinguishable — JSON.stringify
    // yields undefined for them, which an untagged channel silently turned
    // into a null result.
    //
    // @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
    // Obligation 3's settlement assumption is enforced, not assumed: an
    // unsettled invocation is a failed invocation, and its buffered writes
    // never commit.
    Ok(format!(
        "(async function() {{\n  var value = await globalThis.__snapbackInvoke({}, {}, {}, {}, {}, {}, {});\n  var body = JSON.stringify(value === undefined ? null : value);\n  if (body === undefined) {{\n    throw new Error(\"SNAPBACK_HANDLER_RESULT_INVALID: handler returned a value that is not JSON-serializable\");\n  }}\n  return '{{\"r\":' + body + '}}';\n}})()",
        export_json,
        args_literal,
        auth_literal,
        mode_json,
        run_literal,
        secrets_literal,
        epoch_literal,
    ))
}

/// The once-per-VM warm setup eval: ambient restriction + module source +
/// ctx bootstrap + the reset installer (which captures the post-setup
/// baseline). The ambient text is the query/mutation deny set — identical for
/// both warm modes (pinned by `dk4_query_and_mutation_share_one_ambient_restriction`);
/// actions, whose ambient differs, never take this path.
///
/// @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 — keying.
fn warm_setup_source(module: &IbexModule) -> String {
    format!(
        "{}\n{}\n{}\n{}",
        ambient_restriction_source(IbexInvocationMode::Query, outbound_actions_enabled()),
        module.source,
        ctx_bootstrap_source(),
        crate::warm_vm::RESET_INSTALL_SOURCE,
    )
}

/// Outbound action egress is opt-in and off by default. When enabled, an ACTION
/// (only) keeps `fetch` + timers and is granted `network:fetch`; queries and
/// mutations stay fully denied. This is the [LLP 0027#external-data-and-action-egress]
/// seam — sandbox-policy territory owned by [LLP 0009], so the default posture is
/// unchanged (everything denied, strict).
fn outbound_actions_enabled() -> bool {
    matches!(
        std::env::var("SNAPBACK_OUTBOUND_ACTIONS").ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE")
    )
}

// @ref LLP 0027#external-data-and-action-egress — un-deny fetch for the action
//   execution class only; the transactional query/mutation path never gets network.
// @ref LLP 0009#capability-model — the JS ambient layer gates ambient powers by
//   handler kind; the coarse Ibex network:fetch grant is opened only for egress.
fn ambient_restriction_source(mode: IbexInvocationMode, outbound_enabled: bool) -> String {
    let egress = outbound_enabled && matches!(mode, IbexInvocationMode::Action);
    let mut denials = String::from(
        r#"  try { Object.defineProperty(g, "process", { value: undefined, configurable: false, writable: false }); } catch (_) {}
  try { Object.defineProperty(g, "require", { value: undefined, configurable: false, writable: false }); } catch (_) {}
  try { Object.defineProperty(g, "WebSocket", { value: deny("WebSocket"), configurable: false, writable: false }); } catch (_) {}
"#,
    );
    if !egress {
        denials.push_str(
            r#"  try { Object.defineProperty(g, "fetch", { value: deny("fetch"), configurable: false, writable: false }); } catch (_) {}
  try { Object.defineProperty(g, "setTimeout", { value: deny("setTimeout"), configurable: false, writable: false }); } catch (_) {}
  try { Object.defineProperty(g, "setInterval", { value: deny("setInterval"), configurable: false, writable: false }); } catch (_) {}
"#,
        );
    }
    format!(
        "(function(g) {{\n  function deny(name) {{\n    return function() {{ throw new Error(\"SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED: \" + name); }};\n  }}\n{denials}}})(globalThis);\n"
    )
}

fn ctx_bootstrap_source() -> &'static str {
    r#"
(function(g) {
  function literal(value) { return { Literal: value }; }
  function normalizeDirection(direction) {
    return String(direction || "asc").toLowerCase() === "desc" ? "Desc" : "Asc";
  }
  function readonlyDenied(op) {
    return function() { throw new Error("SNAPBACK_HANDLER_WRITE_IN_QUERY: " + op); };
  }
  // The opaque secret handle (LLP 0036 D5/D8): every accidental
  // materialization path — stringify, JSON, template coercion, console —
  // yields a redacted marker; expose() is the explicit, greppable escape
  // hatch; asBearer() is v1 sugar over expose() (a true host-boundary unwrap
  // awaits host-mediated fetch on the egress seam). Pure helpers: they close
  // over nothing invocation-specific, and actions run on fresh VMs (DK-4
  // scope fence), so module scope is safe.
  function makeSecretHandle(name, value) {
    var marker = "[snapback secret " + name + "]";
    var handle = {
      expose: function() { return value; },
      asBearer: function() { return "Bearer " + value; },
      toString: function() { return marker; },
      toJSON: function() { return marker; }
    };
    try {
      Object.defineProperty(handle, Symbol.toPrimitive, {
        value: function() { return marker; }
      });
    } catch (_) {}
    return handle;
  }
  function makeSecrets(grants) {
    var entries = (grants && grants.entries) || {};
    function lookup(name, rotate) {
      var entry = entries[name];
      if (!entry) {
        throw new Error("SNAPBACK_CONFIG_UNDECLARED: " + name + " is not in this function's uses grant");
      }
      if (!entry.set || !entry.values || !entry.values.length) {
        throw new Error("SNAPBACK_CONFIG_MISSING: " + name + " has no value set");
      }
      var index = rotate ? (entry.cursor || 0) % entry.values.length : 0;
      return makeSecretHandle(name, entry.values[index]);
    }
    return {
      get: function(name) { return lookup(name, false); },
      rotating: function(name) { return lookup(name, true); }
    };
  }
  // `host`, `makeBuilder`, and the whole `ctx` are built *per invocation* so
  // that they close over this invocation's `epoch`. A continuation captured
  // in module scope by a prior invocation therefore carries that prior
  // epoch, and the host rejects it (stale-continuation guard) rather than
  // routing it through whatever invocation is currently live on this VM.
  g.__snapbackInvoke = async function(name, argsJson, authJson, mode, runJson, secretsJson, epoch) {
    function host(op, args) {
      return g.__hostCall(epoch + "|" + op, JSON.stringify(args || {}));
    }
    function makeBuilder(table) {
      var plan = { table: table, filters: [], order: [], limit: null, indexed_by: null };
      var builder = {
        withIndex: function(name) { plan.indexed_by = name; return builder; },
        eq: function(field, value) {
          plan.filters.push({ field: field, op: "Eq", value: literal(value) });
          return builder;
        },
        in: function(field, values) {
          plan.filters.push({ field: field, op: "In", value: literal(values) });
          return builder;
        },
        lt: function(field, value) {
          plan.filters.push({ field: field, op: "Lt", value: literal(value) });
          return builder;
        },
        lte: function(field, value) {
          plan.filters.push({ field: field, op: "Lte", value: literal(value) });
          return builder;
        },
        gt: function(field, value) {
          plan.filters.push({ field: field, op: "Gt", value: literal(value) });
          return builder;
        },
        gte: function(field, value) {
          plan.filters.push({ field: field, op: "Gte", value: literal(value) });
          return builder;
        },
        order: function(field, direction) {
          plan.order.push({ field: field, direction: normalizeDirection(direction) });
          return builder;
        },
        take: function(limit) { plan.limit = Number(limit); return builder; },
        collect: function() { return host("db.query", { plan: plan }).rows; },
        first: function() {
          var old = plan.limit;
          plan.limit = 1;
          var rows = host("db.query", { plan: plan }).rows;
          plan.limit = old;
          return rows.length ? rows[0] : null;
        }
      };
      return builder;
    }
    var args = JSON.parse(argsJson || "{}");
    var auth = JSON.parse(authJson || "{}");
    var run = runJson ? JSON.parse(runJson) : null;
    if (auth.user_id && !auth.userId) auth.userId = auth.user_id;
    var db = {
      get: function(table, id) { return host("db.get", { table: table, id: id }); },
      query: makeBuilder,
      insert: function(table, values) { return host("db.insert", { table: table, values: values }); },
      patch: function(table, id, values) { return host("db.patch", { table: table, id: id, values: values }); },
      delete: function(table, id) { return host("db.delete", { table: table, id: id }); }
    };
    if (mode !== "mutation") {
      db.insert = readonlyDenied("insert");
      db.patch = readonlyDenied("patch");
      db.delete = readonlyDenied("delete");
    }
    if (mode === "action") {
      db.get = readonlyDenied("get");
      db.query = readonlyDenied("query");
    }
    var ctx = {
      auth: auth,
      db: db,
      runtime: {
        now: function() { return host("runtime.now", {}); },
        id: function() { return host("runtime.id", {}); }
      }
    };
    if (mode === "action") {
      ctx.run = run || host("action.metadata", {});
      ctx.cron = ctx.run;
      ctx.secrets = makeSecrets(secretsJson ? JSON.parse(secretsJson) : null);
      ctx.runMutation = function(mutationName, mutationArgs) {
        return host("action.runMutation", { name: mutationName, args: mutationArgs || {} });
      };
    } else {
      ctx.runMutation = function() {
        throw new Error("SNAPBACK_ACTION_CONTEXT_UNAVAILABLE: runMutation");
      };
    }
    var handlers = g.__snapbackHandlers || {};
    var handler = handlers[name] || g[name];
    if (typeof handler !== "function") {
      throw new Error("SNAPBACK_HANDLER_EXPORT_MISSING: " + name);
    }
    return await handler(ctx, args);
  };
})(globalThis);
"#
}

fn required_string(args: &Value, key: &str) -> SnapbackResult<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                "runtime",
                format!("handler host call missing string field {key}"),
            )
        })
}

fn required_object(args: &Value, key: &str) -> SnapbackResult<Map<String, Value>> {
    args.get(key)
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                "runtime",
                format!("handler host call missing object field {key}"),
            )
        })
}

fn row_version(row: &Value) -> SnapbackResult<u64> {
    row.get("_version").and_then(Value::as_u64).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_CAPTURED_READ_INVALID",
            "runtime",
            "read row was missing a numeric _version",
        )
    })
}

fn auth_dependencies(input: &HandlerInput) -> Vec<CapturedReadDependency> {
    let mut reads = Vec::new();
    if let Some(user_id) = &input.auth.user_id {
        reads.push(CapturedReadDependency {
            kind: CapturedReadKind::Auth,
            table: None,
            id: None,
            version: None,
            predicate: None,
            rows: Vec::new(),
            field: Some("userId".to_owned()),
            value: Some(Value::String(user_id.clone())),
            order: None,
            limit: None,
            result_count: None,
            boundary: None,
        });
    }
    reads
}

fn c_string_to_string(ptr: *const c_char) -> SnapbackResult<String> {
    if ptr.is_null() {
        return Ok(String::new());
    }
    Ok(unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned())
}

fn c_host_response(prefix: char, text: String) -> *mut c_char {
    let sanitized = text.replace('\0', "\\0");
    let value = format!("{prefix}{sanitized}");
    let bytes = value.as_bytes();
    unsafe {
        let ptr = libc::malloc(bytes.len() + 1) as *mut u8;
        if ptr.is_null() {
            return ptr::null_mut();
        }
        ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        *ptr.add(bytes.len()) = 0;
        ptr as *mut c_char
    }
}

fn handler_serialize_error(error: serde_json::Error) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_HANDLER_INPUT_SERIALIZE_FAILED",
        "runtime",
        "handler invocation input could not be serialized",
    )
    .with_details(json!({ "error": error.to_string() }))
}

fn first_line(value: &str) -> String {
    value.lines().next().unwrap_or(value).to_owned()
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn detect_ibex_cli() -> IbexCliCapability {
    let path = env::var_os("SNAPBACK_IBEX")
        .map(PathBuf::from)
        .or_else(find_vendored_ibex_cli)
        .or_else(|| find_on_path("ibex"));
    let Some(path) = path else {
        return IbexCliCapability {
            available: false,
            path: None,
            version: None,
        };
    };

    let version = Command::new(&path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
            } else {
                None
            }
        })
        .filter(|value| !value.is_empty());

    IbexCliCapability {
        available: true,
        path: Some(path),
        version,
    }
}

fn detect_ibex_submodule() -> IbexSubmoduleCapability {
    let path = snapback_root().join("vendor").join("ibex");
    let present = path.join("Cargo.toml").is_file();
    IbexSubmoduleCapability {
        present,
        path: present.then_some(path),
    }
}

fn find_vendored_ibex_cli() -> Option<PathBuf> {
    let root = snapback_root();
    let binary = if cfg!(windows) { "ibex.exe" } else { "ibex" };
    [
        root.join("vendor")
            .join("ibex")
            .join("target")
            .join("debug")
            .join(binary),
        root.join("vendor")
            .join("ibex")
            .join("target")
            .join("release")
            .join(binary),
    ]
    .into_iter()
    .find(|path| is_executable(path))
}

fn snapback_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn find_on_path(binary: &str) -> Option<PathBuf> {
    let paths = env::var_os("PATH")?;
    env::split_paths(&paths)
        .map(|path| path.join(binary))
        .find(|path| is_executable(path))
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}
