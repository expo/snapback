use crate::cron::CronRunMetadata;
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::live_matcher::{
    compare_sort_keys, query_dependency_metadata, row_matches_query_filters, sort_key,
};
use crate::manifest::{HandlerInput, IbexModule, MutationOutput, QueryOutput, QueryPlan};
use crate::storage::{
    BufferedWrite, CapturedReadDependency, CapturedReadKind, ClientMutationIdentity, DbRead,
    LocalDatabase, MutationCommit,
};
use crate::warm_vm::WarmVmPool;
use libc::{c_char, c_int, c_void, size_t};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{BTreeSet, HashSet};
use std::env;
use std::ffi::{CStr, CString};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::ptr;
#[cfg(debug_assertions)]
use std::sync::{Mutex as StdMutex, OnceLock, mpsc};
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
    /// `function.explain` kind `mutationDryRun` is served for queries'
    /// sibling tier pair — HostPlan (IR) and IbexModule mutations
    /// (LLP 0051 D8 / Increment 4). The per-function `dryRunSupported`
    /// catalog bit (LLP 0024 §Catalog) rides LLP 0042's generated catalog;
    /// until that lands this capability is the honest wire marker.
    pub mutation_dry_run: bool,
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
                mutation_dry_run: true,
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
                // Detail keys are payload keys — camelCase per the LLP 0032
                // P8 casing rule (tests/inspect_casing_v0.rs walks these when
                // the diagnostic lands in recentDiagnostics).
                .with_details(json!({
                    "canonicalEngine": self.capabilities.canonical_engine,
                    "ibexSubmodule": self.capabilities.ibex_submodule,
                    "hostPlanRuntime": self.capabilities.host_plan_runtime,
                    "ibexCtxDbHostBridge": self.capabilities.ibex_ctx_db_host_bridge
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
        identity: Option<&ClientMutationIdentity>,
    ) -> SnapbackResult<MutationCommit> {
        let mut invocation = IbexHostContext::new(DbRead::Live(db), input.clone(), true)?;
        let result = run_ibex_handler_with_context(module, &mut invocation, pool)?;
        // The recorded (or replayed) ctx-answer ledger rides the output
        // (LLP 0051 D1) so LLP 0043 M2 producers and dry-run consumers have
        // the captured environment as a defined channel.
        let ctx_ledger = invocation.take_ctx_ledger()?;
        let IbexHostContext { writes, reads, .. } = invocation;
        db.commit_buffered_writes_idempotent(&input, writes, reads, result, ctx_ledger, identity)
    }

    /// Dry-run an Ibex-module mutation (LLP 0051 D8): the handler runs for
    /// real against the buffered ctx — recording its ctx-answer ledger —
    /// and the buffered writes are validated and applied through the same
    /// path as a commit, then rolled back. Same fidelity, no durable effect.
    pub(crate) fn dry_run_ibex_mutation(
        &self,
        module: &IbexModule,
        input: HandlerInput,
        db: &mut LocalDatabase,
        pool: Option<&WarmVmPool>,
    ) -> SnapbackResult<MutationCommit> {
        let mut invocation = IbexHostContext::new(DbRead::Live(db), input.clone(), true)?;
        let result = run_ibex_handler_with_context(module, &mut invocation, pool)?;
        let ctx_ledger = invocation.take_ctx_ledger()?;
        let IbexHostContext { writes, reads, .. } = invocation;
        let mut commit = db.dry_run_buffered_writes(&input, writes, reads, result)?;
        commit.output.ctx_ledger = Some(ctx_ledger);
        Ok(commit)
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
    let mut invocation = IbexHostContext::new(db, input, false)?;
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

/// Validate a supplied replay ledger before the invocation runs (LLP 0051
/// D1): the format version must be known, and when the ledger carries an auth
/// fingerprint it must match the invocation's resolved auth context — a
/// mismatch surfaces `SNAPBACK_AUTH_STALE_RESULT` (LLP 0043 §Auth posture)
/// rather than replaying under new authority.
fn validate_replay_ledger(input: &HandlerInput) -> SnapbackResult<Option<ReplayLedger>> {
    let Some(ledger) = &input.ctx_ledger else {
        return Ok(None);
    };
    if ledger.version != crate::manifest::CTX_ANSWER_LEDGER_VERSION {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED",
            "runtime",
            format!(
                "ctx-answer ledger version {} is not supported (current: {})",
                ledger.version,
                crate::manifest::CTX_ANSWER_LEDGER_VERSION
            ),
        ));
    }
    if ledger.ids.len() > crate::manifest::CTX_ANSWER_LEDGER_MAX_IDS {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
            "runtime",
            format!(
                "ctx-answer ledger contains {} ids, past the declared bound ({})",
                ledger.ids.len(),
                crate::manifest::CTX_ANSWER_LEDGER_MAX_IDS
            ),
        ));
    }
    if let Some((index, _)) = ledger
        .ids
        .iter()
        .enumerate()
        .find(|(_, id)| !crate::manifest::replay_opaque_id_is_valid(id))
    {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_ID_INVALID",
            "runtime",
            format!("ctx-answer ledger id at index {index} is not a valid opaque replay id"),
        ));
    }
    if let Some(fingerprint) = &ledger.auth_fingerprint {
        let current = crate::manifest::auth_fingerprint(&input.auth);
        if *fingerprint != current {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_STALE_RESULT",
                "runtime",
                "ctx-answer ledger was recorded under a different auth context; \
                 refusing to replay under new authority (LLP 0043 §Auth posture)",
            ));
        }
    }
    Ok(Some(ReplayLedger {
        ids: ledger.ids.clone(),
        cursor: 0,
    }))
}

pub(crate) struct IbexHostContext<'a> {
    /// The storage view for query/mutation invocations. Actions carry `None`:
    /// their `ctx.db` reads route through the action host, whose
    /// implementation chooses the locking policy (ENG-23324).
    db: Option<DbRead<'a>>,
    input: HandlerInput,
    mode: IbexInvocationMode,
    writes: Vec<BufferedWrite>,
    reads: Vec<CapturedReadDependency>,
    read_keys: HashSet<String>,
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
    /// Record-mode ctx-answer ledger (LLP 0051 D1): every host-generated id
    /// this invocation answered, in order. Queries/mutations only; actions
    /// never record — they are outside the deterministic tier.
    recorded_ids: Vec<String>,
    /// Replay-mode state; `Some` iff the input carried a `ctx_ledger`.
    replay: Option<ReplayLedger>,
}

/// Replay-mode cursor over a supplied ctx-answer ledger (LLP 0051 D1).
struct ReplayLedger {
    ids: Vec<String>,
    cursor: usize,
}

impl<'a> IbexHostContext<'a> {
    pub(crate) fn new(
        db: DbRead<'a>,
        input: HandlerInput,
        writable: bool,
    ) -> SnapbackResult<Self> {
        let replay = validate_replay_ledger(&input)?;
        let now_ms = input
            .ctx_ledger
            .as_ref()
            .map(|ledger| ledger.now)
            .unwrap_or_else(now_millis);
        let reads = auth_dependencies(&input);
        let read_keys = read_dependency_keys(&reads);
        Ok(Self {
            db: Some(db),
            input,
            mode: if writable {
                IbexInvocationMode::Mutation
            } else {
                IbexInvocationMode::Query
            },
            writes: Vec::new(),
            reads,
            read_keys,
            now_ms,
            action_run: None,
            action_host: None,
            epoch: next_invocation_epoch(),
            grants: Value::Null,
            recorded_ids: Vec::new(),
            replay,
        })
    }

    fn new_action(
        input: HandlerInput,
        run: CronRunMetadata,
        host: &'a mut dyn IbexActionHost,
        grants: Value,
    ) -> Self {
        let reads = auth_dependencies(&input);
        let read_keys = read_dependency_keys(&reads);
        Self {
            db: None,
            input,
            mode: IbexInvocationMode::Action,
            writes: Vec::new(),
            reads,
            read_keys,
            now_ms: run.due_at_ms,
            action_run: Some(run),
            action_host: Some(host),
            epoch: next_invocation_epoch(),
            grants,
            recorded_ids: Vec::new(),
            replay: None,
        }
    }

    /// Take the recorded ctx-answer ledger (LLP 0051 D1) after the handler
    /// settles. Replay mode echoes the consumed ledger (minus the
    /// server-retained fingerprint); record mode packages what was answered.
    /// The `auth_fingerprint` is deliberately left unset — that channel is
    /// server-retained per the D1 wire split; producers that retain it attach
    /// it themselves.
    pub(crate) fn take_ctx_ledger(&mut self) -> SnapbackResult<crate::manifest::CtxAnswerLedger> {
        if let Some(replay) = self.replay.as_ref()
            && replay.cursor != replay.ids.len()
        {
            return Err(SnapbackError::error(
                "SNAPBACK_CTX_LEDGER_UNUSED_IDS",
                "runtime",
                format!(
                    "replay consumed {} of {} ledgered ids; the handler diverged from its recording",
                    replay.cursor,
                    replay.ids.len()
                ),
            ));
        }
        Ok(crate::manifest::CtxAnswerLedger {
            version: crate::manifest::CTX_ANSWER_LEDGER_VERSION,
            ids: match &self.replay {
                Some(replay) => replay.ids.clone(),
                None => std::mem::take(&mut self.recorded_ids),
            },
            now: self.now_ms,
            auth_fingerprint: None,
        })
    }

    /// The single host id source for the deterministic tier (LLP 0051 D1):
    /// `ctx.runtime.id()` and `ctx.db.insert` row-id generation both answer
    /// through here, so record and replay cover every host-generated id in
    /// one ordered `generatedIds` sequence (LLP 0008's wire pin). Actions
    /// bypass the ledger — they are outside the deterministic tier.
    fn next_host_id(&mut self) -> SnapbackResult<String> {
        if self.mode == IbexInvocationMode::Action {
            return Ok(crate::storage::new_id());
        }
        if let Some(replay) = self.replay.as_mut() {
            let id = replay.ids.get(replay.cursor).cloned().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_CTX_LEDGER_EXHAUSTED",
                    "runtime",
                    format!(
                        "replay consumed all {} ledgered ids and the handler asked for another — \
                         the handler diverged from its recording (LLP 0051 D1; dropped and marked \
                         failed, mirroring LLP 0043)",
                        replay.ids.len()
                    ),
                )
            })?;
            replay.cursor += 1;
            return Ok(id);
        }
        if self.recorded_ids.len() >= crate::manifest::CTX_ANSWER_LEDGER_MAX_IDS {
            // Declared LLP 0047-style limit row: the cap turns an
            // id-generation loop into a typed error, not an unbounded artifact.
            return Err(SnapbackError::error(
                "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
                "runtime",
                format!(
                    "invocation generated more than {} host ids (LLP 0051 D1 ledger cap)",
                    crate::manifest::CTX_ANSWER_LEDGER_MAX_IDS
                ),
            ));
        }
        let id = crate::storage::new_id();
        self.recorded_ids.push(id.clone());
        Ok(id)
    }

    fn db(&self) -> &DbRead<'a> {
        self.db
            .as_ref()
            .expect("query/mutation invocation carries a db view")
    }

    pub(crate) fn epoch(&self) -> u64 {
        self.epoch
    }

    pub(crate) fn input(&self) -> &HandlerInput {
        &self.input
    }

    pub(crate) fn mode_str(&self) -> &'static str {
        match self.mode {
            IbexInvocationMode::Query => "query",
            IbexInvocationMode::Mutation => "mutation",
            IbexInvocationMode::Action => "action",
        }
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
                    let host = self
                        .action_host
                        .as_deref_mut()
                        .ok_or_else(action_host_missing)?;
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
                        rows: self.merge_buffered_into_query(&plan, base_rows)?,
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
                    let host = self
                        .action_host
                        .as_deref_mut()
                        .ok_or_else(action_host_missing)?;
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
                // Row ids are host-generated entropy: they answer through the
                // ctx-answer ledger like `runtime.id` (LLP 0051 D1).
                let id = self.next_host_id()?;
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
            // Diagnostics-routed console (LLP 0048 allowlist slice 1): the
            // routed console shim forwards handler console output here. It is
            // diagnostics, never data — recorded on the host-call trace (both
            // engines route through dispatch_host_call) and optionally echoed
            // to stderr, but the handler-visible result is always null.
            "runtime.log" => {
                if matches!(
                    env::var("SNAPBACK_HANDLER_CONSOLE").ok().as_deref(),
                    Some("stderr")
                ) {
                    let level = args.get("level").and_then(Value::as_str).unwrap_or("log");
                    let message = args.get("message").cloned().unwrap_or(Value::Null);
                    eprintln!("[snapback handler console.{level}] {message}");
                }
                Ok(Value::Null)
            }
            // Id generation is storage-independent, so it stays available to
            // actions, whose context carries no db view (ENG-23324). For
            // queries/mutations the answer routes through the ctx-answer
            // ledger (LLP 0051 D1): recorded in record mode, consumed in
            // order in replay mode.
            "runtime.id" => Ok(Value::String(self.next_host_id()?)),
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
                    ctx_ledger: None,                };
                let host = self
                    .action_host
                    .as_deref_mut()
                    .ok_or_else(action_host_missing)?;
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
    fn merge_buffered_into_query(
        &self,
        plan: &QueryPlan,
        base_rows: Vec<Value>,
    ) -> SnapbackResult<Vec<Value>> {
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
            let stored = self.db().get(&plan.table, id)?;
            if let Some(row) = self.apply_buffered_to_point(&plan.table, id, stored)
                && row_matches_query_filters(plan, &self.input, &row) == Some(true)
            {
                merged.push(row);
            }
        }

        if !plan.order.is_empty() {
            merged.sort_by(|left, right| {
                let ordering = match (sort_key(plan, left), sort_key(plan, right)) {
                    (Some(left_key), Some(right_key)) => {
                        compare_sort_keys(plan, &left_key, &right_key).unwrap_or(Ordering::Equal)
                    }
                    _ => Ordering::Equal,
                };
                if ordering == Ordering::Equal {
                    row_id_for_sort(left).cmp(row_id_for_sort(right))
                } else {
                    ordering
                }
            });
        }
        if let Some(limit) = plan.limit {
            merged.truncate(limit);
        }
        Ok(merged)
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
        notify_captured_point_read(table, id);
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
        let key = read_dependency_key(&dependency);
        if self.read_keys.insert(key) {
            self.reads.push(dependency);
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum IbexInvocationMode {
    Query,
    Mutation,
    Action,
}

/// One recorded handler host call. The trace is the LLP 0048 equivalence
/// artifact: the V8 and Ibex legs must produce equivalent traces before their
/// user-visible outputs are compared, so both engines' host calls route
/// through [`dispatch_host_call`], which records identically for either leg.
#[derive(Clone, Debug, Serialize)]
pub struct HostCallTraceEntry {
    pub seq: usize,
    pub op: String,
    pub args: Value,
    pub ok: bool,
    /// The successful result value, or the stable diagnostic code on failure.
    pub outcome: Value,
}

thread_local! {
    static HOST_CALL_TRACE: RefCell<Option<Vec<HostCallTraceEntry>>> = const { RefCell::new(None) };
}

/// Run `f` while recording every handler host call on this thread, returning
/// the result alongside the machine-readable trace (LLP 0048 §Architecture:
/// the logical protocol is the invariant; the trace is its evidence).
pub fn with_host_call_trace<T>(f: impl FnOnce() -> T) -> (T, Vec<HostCallTraceEntry>) {
    let previous = HOST_CALL_TRACE.with(|slot| slot.borrow_mut().replace(Vec::new()));
    let result = f();
    let trace = HOST_CALL_TRACE.with(|slot| {
        let mut borrowed = slot.borrow_mut();
        let trace = borrowed.take().unwrap_or_default();
        *borrowed = previous;
        trace
    });
    (result, trace)
}

/// The single host-call dispatch seam shared by both engines: the Ibex FFI
/// trampoline and the workerd HTTP host server both land here, so the op
/// table, its diagnostics, and the recorded trace cannot differ per engine.
pub(crate) fn dispatch_host_call(
    ctx: &mut IbexHostContext<'_>,
    op: &str,
    args: Value,
) -> SnapbackResult<Value> {
    let tracing = HOST_CALL_TRACE.with(|slot| slot.borrow().is_some());
    let traced_args = if tracing { Some(args.clone()) } else { None };
    let result = ctx.handle_host_call(op, args);
    if let Some(args) = traced_args {
        HOST_CALL_TRACE.with(|slot| {
            if let Some(trace) = slot.borrow_mut().as_mut() {
                let (ok, outcome) = match &result {
                    Ok(value) => (true, value.clone()),
                    Err(error) => (false, Value::String(error.diagnostic.code.clone())),
                };
                trace.push(HostCallTraceEntry {
                    seq: trace.len(),
                    op: op.to_owned(),
                    args,
                    ok,
                    outcome,
                });
            }
        });
    }
    result
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
    // @ref LLP 0048#architecture — the twin swaps only the handler executor:
    // storage, host-op implementation, and the logical host-call protocol are
    // this same context either way. Actions stay on Ibex (egress and secrets
    // powers are not in the twin's scope; the capability manifest says so).
    if matches!(
        crate::workerd_exec::selected_backend(),
        crate::workerd_exec::HandlerBackend::WorkerdV8
    ) && !matches!(invocation.mode, IbexInvocationMode::Action)
    {
        return crate::workerd_exec::run_handler_workerd(module, invocation);
    }
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

    let output = eval_result?;
    let rejections = take_unhandled_rejections(runtime.0)?;
    if !rejections.is_empty() {
        return Err(unhandled_rejection_error(module, rejections));
    }
    parse_handler_output(module, output)
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
        Ok(output) => match take_unhandled_rejections(vm.runtime()) {
            Ok(rejections) => {
                // The sweep drained the ledger, so the VM carries no stale
                // rejection state into the next invocation; the pool's
                // reset-and-verify decides whether it survives as usual.
                pool.reset_and_check_in(vm);
                if !rejections.is_empty() {
                    return Err(unhandled_rejection_error(module, rejections));
                }
                parse_handler_output(module, output)
            }
            Err(error) => {
                drop(vm); // burn: the sweep eval itself failed, state untrusted
                Err(error)
            }
        },
        Err(error) => {
            drop(vm); // burn: an errored eval's VM state is not trusted
            Err(error)
        }
    }
}

/// Post-eval sweep of the bootstrap's unhandled-rejection ledger (ENG-23361).
/// Runs after `ex_hermes_eval` returned, i.e. after the *full* microtask
/// drain — so it also observes detached chains that rejected after the
/// invocation promise settled, which an in-IIFE check would miss. The source
/// is a fixed string that makes no host calls, so (like the warm reset eval)
/// it runs outside the host-context window.
fn take_unhandled_rejections(runtime: *mut HermesRuntimeOpaque) -> SnapbackResult<Vec<String>> {
    const TAKE_SOURCE: &str = r#"(function() {
  var take = globalThis.__snapbackTakeUnhandledRejections;
  if (typeof take !== "function") { return "null"; }
  try { return JSON.stringify(take()); } catch (_) { return "null"; }
})()"#;
    let output = eval(runtime, "<snapback-rejection-sweep>", TAKE_SOURCE)?;
    let report = serde_json::from_str::<Value>(&output).unwrap_or(Value::Null);
    Ok(report
        .get("rejections")
        .and_then(Value::as_array)
        .map(|rejections| {
            rejections
                .iter()
                .map(|reason| reason.as_str().unwrap_or("unserializable rejection reason"))
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default())
}

/// A handler that completes while a detached promise chain it spawned
/// rejected unobserved did *partial* work: the chain's earlier host calls
/// are buffered, its later ones silently skipped. Reporting success would
/// commit that partial work (ENG-23361), so the invocation fails closed and
/// the buffer is discarded — Node crashes on unhandled rejections and Convex
/// fails the mutation; silently swallowing them is the one wrong option.
pub(crate) fn unhandled_rejection_error(module: &IbexModule, rejections: Vec<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION",
        "runtime",
        "handler completed with unhandled promise rejection(s) — the invocation failed and committed no writes",
    )
    .with_details(json!({
        "function": module.export,
        "rejections": rejections,
    }))
}

/// Unwrap the invoke IIFE's tagged completion envelope. The tag is
/// load-bearing: a status-0 eval does NOT prove the handler ran to
/// completion, because the eval loop's no-progress fallback returns the
/// still-pending invocation promise (stringified to "{}"). Only the IIFE
/// constructs the {"r": ...} envelope, and only after the awaited handler
/// value exists — so anything untagged on this channel means the handler
/// never settled and must fail closed with nothing committed (ENG-23430).
/// That includes a `{"r": ...}` whose `r` carries no boolean `__snapbackOk`:
/// the settle wrapper always tags, so an untagged `r` proves nothing about
/// settlement and fails closed too, matching the JS decoder in
/// `packages/snapback-harness/envelope.mjs` (ENG-23603).
pub(crate) fn parse_handler_output(module: &IbexModule, output: String) -> SnapbackResult<Value> {
    if let Ok(Value::Object(mut envelope)) = serde_json::from_str(&output)
        && envelope.len() == 1
        && let Some(result) = envelope.remove("r")
        && let Some(object) = result.as_object()
        && let Some(ok) = object.get("__snapbackOk").and_then(Value::as_bool)
    {
        if ok {
            return Ok(object.get("value").cloned().unwrap_or(Value::Null));
        }
        let code = object
            .get("code")
            .and_then(Value::as_str)
            .map(handler_envelope_code)
            .unwrap_or("SNAPBACK_HANDLER_FAILED");
        let message = object
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("JavaScript handler failed");
        return Err(
            SnapbackError::error(code, "runtime", "JavaScript handler failed").with_details(
                json!({
                    "function": module.export,
                    "message": message,
                }),
            ),
        );
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
            dispatch_host_call(ctx, op, args)
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
        "{}\n{}\n{}\n{}\n{}",
        ambient_restriction_source(invocation.mode, outbound_actions_enabled()),
        allowlist_install_source(),
        module.source,
        ctx_bootstrap_source(),
        invocation_iife_source(module, invocation)?,
    ))
}

/// The additive half of the Workers-dialect allowlist (LLP 0048
/// §Handler-visible API surface): single-sourced with the workerd leg, where
/// the same file evaluates as a side-effect module. It runs before the module
/// source so top-level handler code observes the same surface on both
/// engines.
fn allowlist_install_source() -> &'static str {
    include_str!("../packages/snapback-harness/allowlist-install.js")
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
    Ok(include_str!("../packages/snapback-harness/invocation-iife.js")
    .replace("__SNAPBACK_EXPORT__", &export_json)
    .replace("__SNAPBACK_ARGS__", &args_literal)
    .replace("__SNAPBACK_AUTH__", &auth_literal)
    .replace("__SNAPBACK_MODE__", &mode_json)
    .replace("__SNAPBACK_RUN__", &run_literal)
    .replace("__SNAPBACK_SECRETS__", &secrets_literal)
    .replace("__SNAPBACK_EPOCH__", &epoch_literal))
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
        "{}\n{}\n{}\n{}\n{}",
        ambient_restriction_source(IbexInvocationMode::Query, outbound_actions_enabled()),
        allowlist_install_source(),
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
/// Ambient names an egress-enabled ACTION still denies (ENG-23581). Egress
/// actions keep the wide compute-plus-fetch surface they always had (the
/// all-aboard 511.org poller uses fetch/URL/Headers/AbortController/crypto):
/// the LLP 0048 data-driven denial applies only to queries and mutations,
/// while egress actions restore the pre-0048 posture — deny exactly the
/// process/require introspection pair and WebSocket. In particular, `fetch`
/// must never be pre-shadowed here: Ibex installs it lazily as a
/// *configurable* property, and a non-configurable deny stub in its slot
/// makes the installer itself throw.
const EGRESS_DENIED_AMBIENT: [&str; 3] = ["process", "require", "WebSocket"];

/// Banned names shadowed as plain `undefined` rather than a denier function:
/// host/introspection objects where "absent" is the truthful surface (and the
/// historical behavior for `process`/`require`).
const UNDEFINED_SHADOWED_AMBIENT: [&str; 3] = ["process", "require", "HermesInternal"];

/// The Ibex leg's ambient denial list is generated from the same
/// `allowlist.json` data the V8 strip consumes (LLP 0048 §Handler-visible API
/// surface): banned-everywhere globals are denied here, so surface parity is
/// data-driven rather than two hand-maintained lists.
fn banned_ambient_globals() -> &'static Vec<String> {
    static BANNED: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    BANNED.get_or_init(|| {
        let allowlist: Value =
            serde_json::from_str(include_str!("../packages/snapback-harness/allowlist.json"))
                .expect("packages/snapback-harness/allowlist.json parses");
        allowlist
            .get("bannedEverywhere")
            .and_then(|banned| banned.get("globals"))
            .and_then(Value::as_array)
            .map(|names| {
                names
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .expect("allowlist bannedEverywhere.globals is a string array")
    })
}

/// The deterministic-member denial list, single-sourced from the same
/// allowlist `members` list the V8 strip consumes (LLP 0051 D1 / Increment 2:
/// the Ibex deterministic-member gap is closed at runtime for the
/// deterministic tier, not just by the LLP 0009 codegen ban).
fn banned_ambient_members() -> &'static Vec<String> {
    static BANNED: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    BANNED.get_or_init(|| {
        let allowlist: Value =
            serde_json::from_str(include_str!("../packages/snapback-harness/allowlist.json"))
                .expect("packages/snapback-harness/allowlist.json parses");
        allowlist
            .get("bannedEverywhere")
            .and_then(|banned| banned.get("members"))
            .and_then(Value::as_array)
            .map(|names| {
                names
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .expect("allowlist bannedEverywhere.members is a string array")
    })
}

/// The zero-arg `Date`-constructor denial (ENG-23588), `workerd/strip.mjs`'s
/// shape ported to the Ibex leg: zero-arg `new Date()` and `Date()` as a
/// function read the ambient wall clock and are denied; explicit-timestamp
/// construction and the static parsers are pure functions of their arguments
/// and stay. This is a constructor wrapper, not a `members` entry — a
/// members-only port would silently miss it.
const DATE_CONSTRUCTOR_DENY_SOURCE: &str = r#"  var NativeDate = g.Date;
  try {
    var WrappedDate = function Date() {
      if (!new.target) {
        throw snapbackError("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED", "Date()");
      }
      if (arguments.length === 0) {
        throw snapbackError("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED", "new Date()");
      }
      return Reflect.construct(NativeDate, arguments, new.target);
    };
    WrappedDate.prototype = NativeDate.prototype;
    WrappedDate.parse = NativeDate.parse;
    WrappedDate.UTC = NativeDate.UTC;
    WrappedDate.now = deny("Date.now");
    Object.defineProperty(NativeDate.prototype, "constructor", { value: WrappedDate });
    Object.defineProperty(g, "Date", { value: WrappedDate, configurable: false, writable: false });
  } catch (_) {}
"#;

fn ambient_restriction_source(mode: IbexInvocationMode, outbound_enabled: bool) -> String {
    let egress = outbound_enabled && matches!(mode, IbexInvocationMode::Action);
    let mut denials = String::new();
    // Names installed as callable deny stubs, collected for the post-install
    // probe below (ENG-23590): every one of them must be unreachable after
    // this source evaluates, or the invocation fails instead of running with
    // a survivor.
    let mut probed: Vec<&str> = Vec::new();
    let denied: Vec<&str> = if egress {
        EGRESS_DENIED_AMBIENT.to_vec()
    } else {
        banned_ambient_globals()
            .iter()
            .map(String::as_str)
            .collect()
    };
    for name in denied {
        if UNDEFINED_SHADOWED_AMBIENT.contains(&name) {
            // Some engine-provided globals (HermesInternal) are
            // non-configurable, so defineProperty throws; fall through
            // delete -> defineProperty -> plain assignment until one sticks.
            denials.push_str(&format!(
                "  try {{ delete g[\"{name}\"]; }} catch (_) {{}}\n  if (g[\"{name}\"] !== undefined) {{ try {{ Object.defineProperty(g, \"{name}\", {{ value: undefined, configurable: false, writable: false }}); }} catch (_) {{}} }}\n  if (g[\"{name}\"] !== undefined) {{ try {{ g[\"{name}\"] = undefined; }} catch (_) {{}} }}\n"
            ));
            // HermesInternal is non-configurable AND non-writable on the
            // vendored engine — a declared engine fact pinned by
            // tests/workerd_twin_v0.rs — so it is the one shadow the probe
            // must tolerate surviving.
            if name != "HermesInternal" {
                probed.push(name);
            }
        } else {
            denials.push_str(&format!(
                "  try {{ Object.defineProperty(g, \"{name}\", {{ value: deny(\"{name}\"), configurable: false, writable: false }}); }} catch (_) {{}}\n"
            ));
            probed.push(name);
        }
    }
    // The deterministic tier (queries/mutations) additionally denies the
    // allowlist's `members` list at runtime — the same list the V8 strip
    // consumes — plus the zero-arg `Date`-constructor rule, which is a
    // constructor wrapper, not a `members` entry (LLP 0051 D1 / Increment 2,
    // ENG-23588). Actions keep today's surface: they are the
    // ambient-powered, non-deterministic class, and the wall-clock watchdog
    // busy-waits are action behavior by design.
    let deterministic_tier = !matches!(mode, IbexInvocationMode::Action);
    let mut member_denials = String::new();
    let mut member_probe = String::new();
    if deterministic_tier {
        for member in banned_ambient_members() {
            let Some((holder, prop)) = member.split_once('.') else {
                continue;
            };
            member_denials.push_str(&format!(
                "  try {{ Object.defineProperty(g[\"{holder}\"], \"{prop}\", {{ value: deny(\"{member}\"), configurable: false, writable: false }}); }} catch (_) {{}}\n"
            ));
        }
        member_denials.push_str(DATE_CONSTRUCTOR_DENY_SOURCE);
        let member_list = banned_ambient_members()
            .iter()
            .map(|member| format!("\"{member}\""))
            .collect::<Vec<_>>()
            .join(", ");
        member_probe = format!(
            "  [{member_list}].forEach(function(member) {{\n    var parts = member.split(\".\");\n    var target = g[parts[0]];\n    var value = target ? target[parts[1]] : undefined;\n    if (typeof value !== \"function\") {{ __snapbackDenySurvivors.push(member); return; }}\n    try {{ value.call(target); __snapbackDenySurvivors.push(member); }} catch (error) {{\n      if (String((error && error.message) || \"\").indexOf(\"SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED\") !== 0) {{ __snapbackDenySurvivors.push(member); }}\n    }}\n  }});\n  try {{ new g.Date(); __snapbackDenySurvivors.push(\"new Date()\"); }} catch (error) {{\n    if (String((error && error.message) || \"\").indexOf(\"SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED\") !== 0) {{ __snapbackDenySurvivors.push(\"new Date()\"); }}\n  }}\n  try {{ if (new g.Date(0).getTime() !== 0) {{ __snapbackDenySurvivors.push(\"new Date(ms) broke\"); }} }} catch (_) {{ __snapbackDenySurvivors.push(\"new Date(ms) broke\"); }}\n"
        );
    }
    // Symmetric to the V8 strip's init self-check (ENG-23590): the denial
    // loop above swallows defineProperty failures, so verify every denied
    // name actually became unreachable and fail the eval — and with it the
    // invocation — on any survivor.
    let probe_list = probed
        .iter()
        .map(|name| format!("\"{name}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let probe = format!(
        "  var __snapbackDenySurvivors = [];\n  [{probe_list}].forEach(function(name) {{\n    var value;\n    try {{ value = g[name]; }} catch (_) {{ return; }}\n    if (value === undefined || value === null) {{ return; }}\n    if (typeof value === \"function\") {{\n      try {{ value(); }} catch (error) {{\n        if (String((error && error.message) || \"\").indexOf(\"SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED\") === 0) {{ return; }}\n      }}\n    }}\n    __snapbackDenySurvivors.push(name);\n  }});\n{member_probe}  if (__snapbackDenySurvivors.length > 0) {{\n    throw snapbackError(\"SNAPBACK_IBEX_GLOBAL_DENY_INCOMPLETE\", \"banned globals survived the ambient denial: \" + __snapbackDenySurvivors.join(\", \"));\n  }}\n"
    );
    format!(
        "(function(g) {{\n  function snapbackError(code, message) {{\n    var error = new Error(code + \": \" + message);\n    try {{ Object.defineProperty(error, \"__snapbackCode\", {{ value: code }}); }} catch (_) {{ error.__snapbackCode = code; }}\n    return error;\n  }}\n  function deny(name) {{\n    return function() {{ throw snapbackError(\"SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED\", name); }};\n  }}\n{denials}{member_denials}{probe}}})(globalThis);\n"
    )
}

fn ctx_bootstrap_source() -> &'static str {
    // @ref LLP 0048#architecture — the ctx bootstrap is the single-sourced
    // handler harness core, shared byte-for-byte with the workerd/V8 leg and
    // the LLP 0040 deploy template.
    include_str!("../packages/snapback-harness/ctx-bootstrap.js")
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

fn read_dependency_keys(reads: &[CapturedReadDependency]) -> HashSet<String> {
    reads.iter().map(read_dependency_key).collect()
}

fn read_dependency_key(dependency: &CapturedReadDependency) -> String {
    serde_json::to_string(dependency).unwrap_or_else(|_| format!("{dependency:?}"))
}

fn row_id_for_sort(row: &Value) -> &str {
    row.get("_id").and_then(Value::as_str).unwrap_or("")
}

fn handler_envelope_code(code: &str) -> &str {
    match code {
        "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED" => "SNAPBACK_HANDLER_CAPABILITY_DENIED",
        "SNAPBACK_HANDLER_WRITE_IN_QUERY"
        | "SNAPBACK_HANDLER_EXPORT_MISSING"
        | "SNAPBACK_HANDLER_RESULT_INVALID"
        | "SNAPBACK_HANDLER_STALE_CONTINUATION"
        | "SNAPBACK_CONFIG_UNDECLARED"
        | "SNAPBACK_CONFIG_MISSING"
        | "SNAPBACK_ACTION_CONTEXT_UNAVAILABLE"
        | "SNAPBACK_OVERLOADED"
        | "SNAPBACK_VALUE_TOO_LARGE"
        // LLP 0051 D1: ledger divergence and the ledger-length limit are
        // typed results, not generic handler failures.
        | "SNAPBACK_CTX_LEDGER_EXHAUSTED"
        | "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED" => code,
        code if code.starts_with("SNAPBACK_HANDLER_HOST_CALL_") => code,
        _ => "SNAPBACK_HANDLER_FAILED",
    }
}

#[cfg(debug_assertions)]
#[derive(Clone)]
struct CapturedPointReadDebugHook {
    table: String,
    id: String,
    sender: mpsc::Sender<()>,
}

#[cfg(debug_assertions)]
static CAPTURED_POINT_READ_DEBUG_HOOK: OnceLock<StdMutex<Option<CapturedPointReadDebugHook>>> =
    OnceLock::new();

#[cfg(debug_assertions)]
#[doc(hidden)]
pub struct CapturedPointReadDebugHookGuard;

#[cfg(debug_assertions)]
impl Drop for CapturedPointReadDebugHookGuard {
    fn drop(&mut self) {
        *captured_point_read_debug_hook()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }
}

#[cfg(debug_assertions)]
#[doc(hidden)]
pub fn set_captured_point_read_debug_hook(
    table: &str,
    id: &str,
    sender: mpsc::Sender<()>,
) -> CapturedPointReadDebugHookGuard {
    *captured_point_read_debug_hook()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(CapturedPointReadDebugHook {
        table: table.to_owned(),
        id: id.to_owned(),
        sender,
    });
    CapturedPointReadDebugHookGuard
}

#[cfg(debug_assertions)]
fn captured_point_read_debug_hook() -> &'static StdMutex<Option<CapturedPointReadDebugHook>> {
    CAPTURED_POINT_READ_DEBUG_HOOK.get_or_init(|| StdMutex::new(None))
}

#[cfg(debug_assertions)]
fn notify_captured_point_read(table: &str, id: &str) {
    let sender = captured_point_read_debug_hook()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .filter(|hook| hook.table == table && hook.id == id)
        .map(|hook| hook.sender.clone());
    if let Some(sender) = sender {
        let _ = sender.send(());
    }
}

#[cfg(not(debug_assertions))]
fn notify_captured_point_read(_table: &str, _id: &str) {}

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

#[cfg(test)]
mod parse_handler_output_tests {
    use super::parse_handler_output;
    use crate::manifest::IbexModule;
    use serde_json::{Value, json};

    fn module() -> IbexModule {
        IbexModule {
            source: String::new(),
            export: "handler".to_owned(),
        }
    }

    fn parse(output: &str) -> Result<Value, String> {
        parse_handler_output(&module(), output.to_owned())
            .map_err(|error| error.diagnostic.code.clone())
    }

    #[test]
    fn tagged_success_unwraps_value() {
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":true,"value":{"a":1}}}"#),
            Ok(json!({"a": 1}))
        );
        assert_eq!(parse(r#"{"r":{"__snapbackOk":true}}"#), Ok(Value::Null));
    }

    #[test]
    fn tagged_failure_maps_code() {
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_HANDLER_RESULT_INVALID"}}"#),
            Err("SNAPBACK_HANDLER_RESULT_INVALID".to_owned())
        );
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_OVERLOADED"}}"#),
            Err("SNAPBACK_OVERLOADED".to_owned())
        );
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_VALUE_TOO_LARGE"}}"#),
            Err("SNAPBACK_VALUE_TOO_LARGE".to_owned())
        );
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":false,"code":"MADE_UP_BY_HANDLER"}}"#),
            Err("SNAPBACK_HANDLER_FAILED".to_owned())
        );
    }

    // ENG-23603: an untagged `r` proves nothing about settlement and must
    // fail closed, exactly like the JS decoder in
    // packages/snapback-harness/envelope.mjs.
    #[test]
    fn untagged_r_object_fails_closed() {
        assert_eq!(
            parse(r#"{"r":{"looksLike":"a result"}}"#),
            Err("SNAPBACK_HANDLER_DID_NOT_SETTLE".to_owned())
        );
    }

    #[test]
    fn non_boolean_snapback_ok_fails_closed() {
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":"true","value":1}}"#),
            Err("SNAPBACK_HANDLER_DID_NOT_SETTLE".to_owned())
        );
    }

    #[test]
    fn non_object_r_fails_closed() {
        for output in [
            r#"{"r":42}"#,
            r#"{"r":"done"}"#,
            r#"{"r":[1,2]}"#,
            r#"{"r":null}"#,
        ] {
            assert_eq!(
                parse(output),
                Err("SNAPBACK_HANDLER_DID_NOT_SETTLE".to_owned()),
                "output: {output}"
            );
        }
    }

    #[test]
    fn non_envelope_shapes_fail_closed() {
        for output in [
            "{}",
            "not json",
            r#"{"r":{"__snapbackOk":true},"extra":1}"#,
            "[]",
        ] {
            assert_eq!(
                parse(output),
                Err("SNAPBACK_HANDLER_DID_NOT_SETTLE".to_owned()),
                "output: {output}"
            );
        }
    }
}
