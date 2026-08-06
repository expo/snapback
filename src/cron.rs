use crate::diagnostic::{Diagnostic, DiagnosticSeverity, SnapbackError, SnapbackResult};
use crate::manifest::{
    AuthRequirement, CronActivationKind, CronJitterPolicy, CronJobDefinition, CronOverlapPolicy,
    CronRetryMode, CronSchedule, FunctionKind, FunctionManifest, PORTABLE_STORAGE_VERSION_MAX,
    SNAPBACK_SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const MAX_RECENT_RUNS: usize = 50;
const LOCAL_MIN_INTERVAL_MS: u64 = 1_000;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronInspectState {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    pub jobs: Vec<CronJobInspect>,
    #[serde(rename = "recentRuns")]
    pub recent_runs: Vec<CronRunRecord>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Operator-safe cron inventory projected from the already-computed runtime
/// inspection state. This intentionally excludes run identities, handler
/// diagnostics/results, jitter seeds, and recent-run payloads.
///
/// @ref LLP 0184#p1-read-and-diagnose — cron inspection is a read-only direct
/// projection of existing manifest/runtime facts, not a mutating-route proxy.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronListState {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    pub jobs: Vec<CronListJob>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronListJob {
    pub name: String,
    pub action: String,
    pub enabled: bool,
    pub schedule: CronSchedule,
    #[serde(rename = "activationPolicy")]
    pub activation_policy: String,
    #[serde(rename = "activationState")]
    pub activation_state: CronActivationState,
    #[serde(rename = "nextNominalAtMs")]
    pub next_nominal_at_ms: Option<u64>,
    #[serde(rename = "nextDueAtMs")]
    pub next_due_at_ms: Option<u64>,
    #[serde(rename = "inFlight")]
    pub in_flight: bool,
    #[serde(rename = "lastRunAtMs")]
    pub last_run_at_ms: Option<u64>,
    #[serde(rename = "lastOutcome")]
    pub last_outcome: Option<CronRunOutcome>,
    #[serde(rename = "consecutiveFailures")]
    #[schemars(range(max = PORTABLE_STORAGE_VERSION_MAX))]
    pub consecutive_failures: u64,
}

impl From<CronInspectState> for CronListState {
    fn from(inspect: CronInspectState) -> Self {
        Self {
            artifact_kind: "snapback.cron-list/v1".to_owned(),
            schema_version: inspect.schema_version,
            jobs: inspect
                .jobs
                .into_iter()
                .map(|job| CronListJob {
                    name: job.name,
                    action: job.action,
                    enabled: job.enabled,
                    schedule: job.schedule,
                    activation_policy: job.activation_policy,
                    activation_state: job.activation_state,
                    next_nominal_at_ms: job.next_nominal_at_ms,
                    next_due_at_ms: job.next_due_at_ms,
                    in_flight: job.in_flight_run_id.is_some(),
                    last_run_at_ms: job.last_run_at_ms,
                    last_outcome: job.last_outcome,
                    consecutive_failures: job.consecutive_failures,
                })
                .collect(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronJobInspect {
    pub name: String,
    pub action: String,
    pub enabled: bool,
    pub schedule: CronSchedule,
    #[serde(rename = "scheduleHash")]
    pub schedule_hash: String,
    #[serde(rename = "activationPolicy")]
    pub activation_policy: String,
    #[serde(rename = "activationState")]
    pub activation_state: CronActivationState,
    #[serde(rename = "jitterPolicy")]
    pub jitter_policy: CronJitterPolicy,
    #[serde(rename = "jitterSeed")]
    pub jitter_seed: String,
    #[serde(rename = "jitterOffsetMs")]
    pub jitter_offset_ms: u64,
    #[serde(rename = "nextNominalAtMs")]
    pub next_nominal_at_ms: Option<u64>,
    #[serde(rename = "nextDueAtMs")]
    pub next_due_at_ms: Option<u64>,
    #[serde(rename = "inFlightRunId")]
    pub in_flight_run_id: Option<String>,
    #[serde(rename = "lastRunAtMs")]
    pub last_run_at_ms: Option<u64>,
    #[serde(rename = "lastOutcome")]
    pub last_outcome: Option<CronRunOutcome>,
    #[serde(rename = "lastError")]
    pub last_error: Option<Diagnostic>,
    #[serde(rename = "consecutiveFailures")]
    #[schemars(range(max = PORTABLE_STORAGE_VERSION_MAX))]
    pub consecutive_failures: u64,
    #[serde(rename = "recentRuns")]
    pub recent_runs: Vec<CronRunRecord>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronActivationState {
    Armed,
    InactiveNoDemand,
    Disabled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronRunTrigger {
    Scheduled,
    Manual,
    Recovery,
    DemandCatchUp,
}

impl CronRunTrigger {
    pub(crate) fn telemetry_name(&self) -> &'static str {
        match self {
            Self::Scheduled => "scheduled",
            Self::Manual => "manual",
            Self::Recovery => "recovery",
            Self::DemandCatchUp => "demand_catch_up",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronRunOutcome {
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronRunRecord {
    #[serde(rename = "runId")]
    pub run_id: String,
    #[serde(rename = "jobName")]
    pub job_name: String,
    #[serde(rename = "scheduledAtMs")]
    pub scheduled_at_ms: Option<u64>,
    #[serde(rename = "dueAtMs")]
    pub due_at_ms: u64,
    #[serde(rename = "startedAtMs")]
    pub started_at_ms: u64,
    #[serde(rename = "finishedAtMs")]
    pub finished_at_ms: Option<u64>,
    pub trigger: CronRunTrigger,
    pub attempt: u32,
    pub outcome: CronRunOutcome,
    #[serde(rename = "durationMs")]
    pub duration_ms: Option<u64>,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: String,
    #[serde(rename = "slotKey")]
    pub slot_key: String,
    pub diagnostic: Option<Diagnostic>,
    #[serde(default)]
    pub result: Option<Value>,
}

impl CronRunRecord {
    /// Closed terminal facts for the `job_run` observation wrapper.
    /// The invoked action has its own `function_run`; this carrier stays a
    /// separate non-billable classification seam.
    ///
    /// @ref LLP 0154#d2--the-observation-span-classification-registry-and-phase-1-kinds
    pub(crate) fn telemetry_terminal(&self) -> (i64, Option<&str>) {
        match self.outcome {
            CronRunOutcome::Succeeded => (200, None),
            CronRunOutcome::Failed => (
                500,
                self.diagnostic
                    .as_ref()
                    .map(|diagnostic| diagnostic.code.as_str()),
            ),
            CronRunOutcome::Skipped => (
                429,
                self.diagnostic
                    .as_ref()
                    .map(|diagnostic| diagnostic.code.as_str()),
            ),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CronRunMetadata {
    #[serde(rename = "jobName")]
    pub job_name: String,
    #[serde(rename = "runId")]
    pub run_id: String,
    #[serde(rename = "scheduledAtMs")]
    pub scheduled_at_ms: Option<u64>,
    #[serde(rename = "dueAtMs")]
    pub due_at_ms: u64,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: String,
    #[serde(rename = "slotKey")]
    pub slot_key: String,
    pub attempt: u32,
    pub trigger: CronRunTrigger,
}

impl CronRunMetadata {
    pub(crate) fn telemetry_details(&self) -> Value {
        serde_json::json!({
            "attempt": self.attempt,
            "trigger": self.trigger.telemetry_name(),
        })
    }
}

#[derive(Clone, Debug)]
pub struct CronRunClaim {
    pub job: CronJobDefinition,
    pub metadata: CronRunMetadata,
    pub started_at_ms: u64,
    /// Monotonic identity of the installed definition that created this
    /// claim. Kept separate from the content hash so an A -> B -> A reload
    /// cannot make the first A's completion look current again.
    pub definition_generation: u64,
}

/// @ref LLP 0028#scheduler-state-and-run-ledger — cron definitions are source
/// authored, while next/last/in-flight/history state is runtime-owned.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LocalCronRuntime {
    #[serde(default = "current_cron_runtime_version")]
    version: u32,
    states: BTreeMap<String, CronJobRuntimeState>,
    recent_runs: VecDeque<CronRunRecord>,
    diagnostics: VecDeque<Diagnostic>,
    next_run_seq: u64,
    #[serde(default)]
    next_definition_generation: u64,
}

const CRON_RUNTIME_FORMAT_VERSION: u32 = 1;
/// `overlap: allow` is concurrency permission, not an unbounded queue. A
/// single job may own at most this many live run ids across automatic and
/// manual dispatch; process-wide dispatcher/action limits are additional
/// ceilings.
pub const CRON_MAX_ACTIVE_RUNS_PER_JOB: usize = 32;

const fn current_cron_runtime_version() -> u32 {
    CRON_RUNTIME_FORMAT_VERSION
}

impl Default for LocalCronRuntime {
    fn default() -> Self {
        Self {
            version: CRON_RUNTIME_FORMAT_VERSION,
            states: BTreeMap::new(),
            recent_runs: VecDeque::new(),
            diagnostics: VecDeque::new(),
            next_run_seq: 0,
            next_definition_generation: 0,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
struct CronJobRuntimeState {
    schedule_hash: String,
    #[serde(default)]
    definition_generation: u64,
    jitter_seed: String,
    jitter_offset_ms: u64,
    next_nominal_at_ms: Option<u64>,
    next_due_at_ms: Option<u64>,
    in_flight_run_id: Option<String>,
    /// All runs currently owned by this scheduler state. The singular field
    /// above remains the stable inspect/persist compatibility projection; this
    /// set is the authority needed by `overlap: allow` and ownership-safe
    /// completion.
    #[serde(default)]
    in_flight_run_ids: BTreeSet<String>,
    last_run_at_ms: Option<u64>,
    last_outcome: Option<CronRunOutcome>,
    last_error: Option<Diagnostic>,
    consecutive_failures: u64,
}

impl CronJobRuntimeState {
    fn normalize_in_flight(&mut self) {
        if let Some(run_id) = self.in_flight_run_id.clone() {
            self.in_flight_run_ids.insert(run_id);
        }
        self.sync_in_flight_projection();
    }

    fn sync_in_flight_projection(&mut self) {
        self.in_flight_run_id = self.in_flight_run_ids.iter().next().cloned();
    }

    fn has_in_flight(&self) -> bool {
        !self.in_flight_run_ids.is_empty() || self.in_flight_run_id.is_some()
    }

    fn active_run_count(&self) -> usize {
        self.in_flight_run_ids.len()
            + usize::from(
                self.in_flight_run_id
                    .as_ref()
                    .is_some_and(|run_id| !self.in_flight_run_ids.contains(run_id)),
            )
    }

    fn claim_run(&mut self, run_id: String) {
        self.normalize_in_flight();
        self.in_flight_run_ids.insert(run_id);
        self.sync_in_flight_projection();
    }

    fn finish_owned_run(&mut self, run_id: &str) -> bool {
        self.normalize_in_flight();
        let owned = self.in_flight_run_ids.remove(run_id);
        self.sync_in_flight_projection();
        owned
    }

    fn take_in_flight_runs(&mut self) -> Vec<String> {
        self.normalize_in_flight();
        let run_ids = std::mem::take(&mut self.in_flight_run_ids)
            .into_iter()
            .collect();
        self.in_flight_run_id = None;
        run_ids
    }
}

fn validate_portable_cron_counter(field: &str, value: u64) -> SnapbackResult<()> {
    if value <= PORTABLE_STORAGE_VERSION_MAX {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_CRON_STATE_INVALID",
        "cron",
        "stored cron runtime state contains a counter outside the portable integer domain",
    )
    .with_details(json!({
        "field": field,
        "value": value,
        "maximum": PORTABLE_STORAGE_VERSION_MAX,
    })))
}

fn checked_cron_identity_successor(
    current: u64,
    code: &'static str,
    identity: &'static str,
    job_name: &str,
    trigger: &'static str,
) -> SnapbackResult<u64> {
    current
        .checked_add(1)
        .filter(|next| *next <= PORTABLE_STORAGE_VERSION_MAX)
        .ok_or_else(|| {
            SnapbackError::error(
                code,
                "cron",
                format!("{identity} is exhausted and cannot be reused"),
            )
            .with_details(json!({
                "jobName": job_name,
                "trigger": trigger,
                "current": current,
                "maximum": PORTABLE_STORAGE_VERSION_MAX,
            }))
        })
}

impl LocalCronRuntime {
    pub fn from_persisted(value: Option<Value>) -> SnapbackResult<Self> {
        let Some(value) = value else {
            return Ok(Self::default());
        };
        let mut runtime: Self = serde_json::from_value(value).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CRON_STATE_INVALID",
                "cron",
                "stored cron runtime state exists but has an invalid shape; refusing to discard it",
            )
            .with_details(json!({ "error": error.to_string() }))
        })?;
        if runtime.version != CRON_RUNTIME_FORMAT_VERSION {
            return Err(SnapbackError::error(
                "SNAPBACK_CRON_STATE_INVALID",
                "cron",
                "stored cron runtime state has an unsupported format version",
            )
            .with_details(json!({
                "version": runtime.version,
                "supportedVersion": CRON_RUNTIME_FORMAT_VERSION,
            })));
        }
        runtime.validate_portable_counters()?;
        runtime.next_definition_generation = runtime.next_definition_generation.max(
            runtime
                .states
                .values()
                .map(|state| state.definition_generation)
                .max()
                .unwrap_or(0),
        );
        // Persisted in-flight ownership cannot survive a process restart: no
        // worker from the old process can finish it. Recover that state once,
        // at load time. Live manifest reconciliation must preserve ownership
        // because the detached worker is still running in this process.
        //
        // @ref LLP 0028#scheduler-state-and-run-ledger — restart recovery is
        // distinct from source-manifest reconciliation.
        let mut recovered = Vec::new();
        for (job_name, state) in &mut runtime.states {
            for run_id in state.take_in_flight_runs() {
                recovered.push(
                    Diagnostic::warning(
                        "SNAPBACK_CRON_STALE_IN_FLIGHT_CLEARED",
                        "cron",
                        format!(
                            "cron job {job_name} had stale in-flight run state and was recovered"
                        ),
                    )
                    .with_details(json!({ "jobName": job_name, "runId": run_id })),
                );
            }
        }
        runtime.record_diagnostics(recovered);
        runtime.strip_result_payloads();
        Ok(runtime)
    }

    pub fn persisted_value(&self) -> SnapbackResult<Value> {
        self.validate_portable_counters()?;
        serde_json::to_value(self).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CRON_STATE_SERIALIZE_FAILED",
                "cron",
                "cron runtime state could not be serialized",
            )
            .with_details(json!({ "error": error.to_string() }))
        })
    }

    fn validate_portable_counters(&self) -> SnapbackResult<()> {
        validate_portable_cron_counter("next_run_seq", self.next_run_seq)?;
        validate_portable_cron_counter(
            "next_definition_generation",
            self.next_definition_generation,
        )?;
        for (job_name, state) in &self.states {
            validate_portable_cron_counter(
                &format!("states.{job_name}.definition_generation"),
                state.definition_generation,
            )?;
            validate_portable_cron_counter(
                &format!("states.{job_name}.consecutive_failures"),
                state.consecutive_failures,
            )?;
        }
        Ok(())
    }

    /// @ref LLP 0028#scheduler-state-and-run-ledger — definition identities
    /// are monotonic ABA fences and may never wrap or leave the portable JSON
    /// integer domain.
    fn reserve_definition_generation(&mut self, job_name: &str) -> SnapbackResult<u64> {
        let generation = checked_cron_identity_successor(
            self.next_definition_generation,
            "SNAPBACK_CRON_DEFINITION_GENERATION_EXHAUSTED",
            "cron definition generation",
            job_name,
            "definition",
        )?;
        self.next_definition_generation = generation;
        Ok(generation)
    }

    /// Whether any enabled cron job is currently armed (its demand condition is
    /// met). Arming changes only when live-query subscriptions or the function
    /// manifest change, so this drives the ticker's lock-skip without per-tick
    /// work.
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L5.
    pub fn any_armed(
        &self,
        manifest: &FunctionManifest,
        active_live_functions: &BTreeSet<String>,
    ) -> bool {
        manifest.cron_jobs.iter().any(|job| {
            self.states.contains_key(&job.name)
                && job.enabled
                && activation_state(job, active_live_functions) == CronActivationState::Armed
        })
    }

    pub fn reconcile(&mut self, manifest: &FunctionManifest) -> Vec<Diagnostic> {
        let mut diagnostics = validate_cron_manifest(manifest);
        let rejected_names = error_job_names(&diagnostics);
        let job_names = manifest
            .cron_jobs
            .iter()
            .map(|job| job.name.clone())
            .collect::<BTreeSet<_>>();
        // Fail closed on redeploy, not just first deploy: a job whose *new*
        // definition fails validation loses the runtime state its previously
        // valid definition earned. Keeping it would leave a stale claimable
        // nominal — the rejected action would still fire, and for an invalid
        // cron expression `finish_run` can never advance the nominal, so the
        // job would be re-claimed on every tick (ENG-23417).
        //
        // @ref LLP 0028#scheduler-state-and-run-ledger — validation-rejected
        // jobs hold no runtime state; the manifest still installs, so state
        // removal here is what keeps the rejection fail-closed.
        self.states.retain(|job_name, _state| {
            job_names.contains(job_name) && !rejected_names.contains(job_name)
        });

        for job in &manifest.cron_jobs {
            if rejected_names.contains(&job.name) {
                continue;
            }
            let schedule_hash = schedule_hash(job);
            let jitter_seed = format!(
                "fnv1a:{:016x}",
                stable_hash(&format!(
                    "{}\0{}\0{}",
                    manifest.app_id, job.name, schedule_hash
                ))
            );
            let jitter_offset_ms = jitter_offset(job, &schedule_hash, &jitter_seed);
            let replacement_generation = if self
                .states
                .get(&job.name)
                .is_none_or(|state| state.schedule_hash != schedule_hash)
            {
                match self.reserve_definition_generation(&job.name) {
                    Ok(generation) => Some(generation),
                    Err(error) => {
                        // The current definition, if any, remains untouched.
                        // Its schedule hash no longer matches the manifest, so
                        // the claim path keeps it inert while inspect exposes
                        // the terminal diagnostic.
                        diagnostics.push(error.diagnostic);
                        continue;
                    }
                }
            } else {
                None
            };
            match self.states.get_mut(&job.name) {
                Some(state) => {
                    state.normalize_in_flight();
                    if state.schedule_hash == schedule_hash {
                        state.jitter_seed = jitter_seed;
                        state.jitter_offset_ms = jitter_offset_ms;
                        // A same-schedule hot reload happens while detached
                        // workers are still alive. Preserve their ownership;
                        // startup-only stale recovery occurs in
                        // `from_persisted` above.
                        if let Some(nominal) = state.next_nominal_at_ms {
                            state.next_due_at_ms = Some(nominal.saturating_add(jitter_offset_ms));
                        }
                    } else {
                        // A changed definition starts a fresh schedule
                        // generation, but its detached predecessors still own
                        // capacity under the logical job name. Carry that
                        // ownership into the replacement so NoOverlap and the
                        // Allow ceiling span hot reloads. Completion removes
                        // the exact run id below, while generation-specific
                        // outcome fields remain protected by the hash check.
                        //
                        // @ref LLP 0028#scheduler-state-and-run-ledger — live
                        // ownership survives definition replacement; ordinary
                        // reconciliation never treats live workers as stale.
                        let in_flight_run_ids = std::mem::take(&mut state.in_flight_run_ids);
                        *state = CronJobRuntimeState {
                            schedule_hash,
                            definition_generation: replacement_generation
                                .expect("changed definition allocated a generation"),
                            jitter_seed,
                            jitter_offset_ms,
                            next_nominal_at_ms: None,
                            next_due_at_ms: None,
                            in_flight_run_id: None,
                            in_flight_run_ids,
                            last_run_at_ms: None,
                            last_outcome: None,
                            last_error: None,
                            consecutive_failures: 0,
                        };
                        state.sync_in_flight_projection();
                    }
                }
                None => {
                    self.states.insert(
                        job.name.clone(),
                        CronJobRuntimeState {
                            schedule_hash,
                            definition_generation: replacement_generation
                                .expect("new definition allocated a generation"),
                            jitter_seed,
                            jitter_offset_ms,
                            next_nominal_at_ms: None,
                            next_due_at_ms: None,
                            in_flight_run_id: None,
                            in_flight_run_ids: BTreeSet::new(),
                            last_run_at_ms: None,
                            last_outcome: None,
                            last_error: None,
                            consecutive_failures: 0,
                        },
                    );
                }
            }
        }
        self.record_diagnostics(diagnostics.clone());
        diagnostics
    }

    pub fn reset_runtime_state(&mut self, manifest: &FunctionManifest) {
        self.states.clear();
        self.recent_runs.clear();
        self.diagnostics.clear();
        // Keep both identity sequences monotonic. Detached pre-reset workers
        // may still return a generation-conflict result; reusing their run id
        // could let that stale completion release a post-reset run's ownership.
        let _ = self.reconcile(manifest);
    }

    pub fn inspect(
        &self,
        manifest: &FunctionManifest,
        active_live_functions: &BTreeSet<String>,
        now_ms: u64,
    ) -> CronInspectState {
        let mut jobs = Vec::new();
        for job in &manifest.cron_jobs {
            let mut state = self.states.get(&job.name).cloned().unwrap_or_else(|| {
                let hash = schedule_hash(job);
                let seed = format!("fnv1a:{:016x}", stable_hash(&hash));
                CronJobRuntimeState {
                    schedule_hash: hash.clone(),
                    definition_generation: 0,
                    jitter_seed: seed.clone(),
                    jitter_offset_ms: jitter_offset(job, &hash, &seed),
                    next_nominal_at_ms: None,
                    next_due_at_ms: None,
                    in_flight_run_id: None,
                    in_flight_run_ids: BTreeSet::new(),
                    last_run_at_ms: None,
                    last_outcome: None,
                    last_error: None,
                    consecutive_failures: 0,
                }
            });
            ensure_next_due(job, &mut state, now_ms);
            let activation_state = activation_state(job, active_live_functions);
            let recent_runs = self
                .recent_runs
                .iter()
                .filter(|run| run.job_name == job.name)
                .cloned()
                .collect();
            jobs.push(CronJobInspect {
                name: job.name.clone(),
                action: job.action.clone(),
                enabled: job.enabled,
                schedule: job.schedule.clone(),
                schedule_hash: state.schedule_hash,
                activation_policy: activation_policy_label(job),
                activation_state,
                jitter_policy: normalized_jitter_policy(job),
                jitter_seed: state.jitter_seed,
                jitter_offset_ms: state.jitter_offset_ms,
                next_nominal_at_ms: state.next_nominal_at_ms,
                next_due_at_ms: state.next_due_at_ms,
                in_flight_run_id: state.in_flight_run_id,
                last_run_at_ms: state.last_run_at_ms,
                last_outcome: state.last_outcome,
                last_error: state.last_error,
                consecutive_failures: state.consecutive_failures,
                recent_runs,
            });
        }

        CronInspectState {
            artifact_kind: "cronRuntimeState".to_owned(),
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            jobs,
            recent_runs: self.recent_runs.iter().cloned().collect(),
            diagnostics: self.diagnostics.iter().cloned().collect(),
        }
    }

    pub fn claim_due_runs(
        &mut self,
        manifest: &FunctionManifest,
        active_live_functions: &BTreeSet<String>,
        now_ms: u64,
    ) -> Vec<CronRunClaim> {
        // A due pass can touch several jobs and both claims and skipped-run
        // records consume the shared run sequence. Stage the complete pass so
        // identity exhaustion cannot leave an earlier nominal consumed or an
        // ownership token installed without returning its claim.
        let mut staged = self.clone();
        match staged.claim_due_runs_checked(manifest, active_live_functions, now_ms) {
            Ok(claims) => {
                *self = staged;
                claims
            }
            Err(error) => {
                let diagnostic = error.diagnostic;
                let duplicate = self.diagnostics.iter().any(|existing| {
                    existing.code == diagnostic.code
                        && existing.details.get("jobName") == diagnostic.details.get("jobName")
                        && existing.details.get("trigger") == diagnostic.details.get("trigger")
                });
                if !duplicate {
                    self.record_diagnostics(vec![diagnostic]);
                }
                Vec::new()
            }
        }
    }

    fn claim_due_runs_checked(
        &mut self,
        manifest: &FunctionManifest,
        active_live_functions: &BTreeSet<String>,
        now_ms: u64,
    ) -> SnapbackResult<Vec<CronRunClaim>> {
        let mut claims = Vec::new();
        for job in &manifest.cron_jobs {
            let Some(state) = self.states.get_mut(&job.name) else {
                continue;
            };
            // Defense in depth against stale state: a claimable nominal is
            // only trusted when it was computed for *this* definition.
            // `reconcile` resets state on any schedule change, so a mismatch
            // here means the manifest changed without a reconcile — never
            // execute from a nominal the current definition did not produce
            // (ENG-23417).
            if state.schedule_hash != schedule_hash(job) {
                continue;
            }
            ensure_next_due(job, state, now_ms);
            if !job.enabled
                || activation_state(job, active_live_functions) != CronActivationState::Armed
            {
                continue;
            }
            let Some(due_at_ms) = state.next_due_at_ms else {
                continue;
            };
            if due_at_ms > now_ms {
                continue;
            }
            let scheduled_at_ms = state.next_nominal_at_ms;
            let overlap_blocked =
                matches!(job.overlap_policy, CronOverlapPolicy::NoOverlap) && state.has_in_flight();
            let capacity_blocked = matches!(job.overlap_policy, CronOverlapPolicy::Allow)
                && state.active_run_count() >= CRON_MAX_ACTIVE_RUNS_PER_JOB;
            if overlap_blocked || capacity_blocked {
                let run_sequence = checked_cron_identity_successor(
                    self.next_run_seq,
                    "SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED",
                    "cron run sequence",
                    &job.name,
                    "skipped",
                )?;
                self.next_run_seq = run_sequence;
                if let Some(next_nominal) = next_nominal_after(job, scheduled_at_ms, now_ms) {
                    state.next_nominal_at_ms = Some(next_nominal);
                    state.next_due_at_ms =
                        Some(next_nominal.saturating_add(state.jitter_offset_ms));
                }
                let record = self.skipped_record(
                    job,
                    scheduled_at_ms,
                    due_at_ms,
                    now_ms,
                    capacity_blocked,
                    run_sequence,
                );
                self.record_run(record);
                continue;
            }
            let run_sequence = checked_cron_identity_successor(
                self.next_run_seq,
                "SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED",
                "cron run sequence",
                &job.name,
                "scheduled",
            )?;
            self.next_run_seq = run_sequence;
            // Consume the nominal before dispatch. A duplicate ticker now sees
            // the next slot, never this same `(job, scheduledAt)` identity.
            if let Some(next_nominal) = next_nominal_after(job, scheduled_at_ms, now_ms) {
                state.next_nominal_at_ms = Some(next_nominal);
                state.next_due_at_ms = Some(next_nominal.saturating_add(state.jitter_offset_ms));
            }
            let run_id = format!(
                "cron:{}:scheduled:{}:{}",
                job.name,
                scheduled_at_ms.unwrap_or(now_ms),
                run_sequence
            );
            state.claim_run(run_id.clone());
            let slot_key = format!(
                "cron:{}:scheduled:{}",
                job.name,
                scheduled_at_ms.unwrap_or(now_ms)
            );
            claims.push(CronRunClaim {
                job: job.clone(),
                metadata: CronRunMetadata {
                    job_name: job.name.clone(),
                    run_id,
                    scheduled_at_ms,
                    due_at_ms,
                    idempotency_key: slot_key.clone(),
                    slot_key,
                    attempt: 1,
                    trigger: CronRunTrigger::Scheduled,
                },
                started_at_ms: now_ms,
                definition_generation: state.definition_generation,
            });
        }
        Ok(claims)
    }

    pub fn claim_manual_run(
        &mut self,
        manifest: &FunctionManifest,
        name: &str,
        now_ms: u64,
    ) -> SnapbackResult<CronRunClaim> {
        let job = manifest
            .cron_jobs
            .iter()
            .find(|job| job.name == name)
            .cloned()
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_UNKNOWN_CRON_JOB",
                    "cron",
                    format!("unknown cron job {name}"),
                )
            })?;
        if !job.enabled {
            return Err(SnapbackError::error(
                "SNAPBACK_CRON_JOB_DISABLED",
                "cron",
                format!("cron job {name} is disabled"),
            ));
        }
        // A manual run of a validation-rejected job must be refused, not just
        // for the run itself: creating runtime state below would permanently
        // arm a job `reconcile` deliberately gave none (ENG-23417).
        let validation_errors = validate_cron_manifest(manifest)
            .into_iter()
            .filter(|diagnostic| {
                diagnostic.severity == DiagnosticSeverity::Error
                    && diagnostic.details.get("jobName").and_then(Value::as_str)
                        == Some(job.name.as_str())
            })
            .map(|diagnostic| diagnostic.code)
            .collect::<Vec<_>>();
        if !validation_errors.is_empty() {
            return Err(SnapbackError::error(
                "SNAPBACK_CRON_JOB_INVALID",
                "cron",
                format!("cron job {name} failed validation and cannot run"),
            )
            .with_details(json!({
                "jobName": job.name,
                "validationErrors": validation_errors,
            })));
        }
        let needs_definition_generation = !self.states.contains_key(&job.name);
        if let Some(state) = self.states.get(&job.name) {
            if matches!(job.overlap_policy, CronOverlapPolicy::NoOverlap) && state.has_in_flight() {
                return Err(SnapbackError::error(
                    "SNAPBACK_CRON_JOB_IN_FLIGHT",
                    "cron",
                    format!("cron job {name} already has a run in flight"),
                ));
            }
            if matches!(job.overlap_policy, CronOverlapPolicy::Allow)
                && state.active_run_count() >= CRON_MAX_ACTIVE_RUNS_PER_JOB
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED",
                    "cron",
                    format!(
                        "cron job {name} already owns the maximum {CRON_MAX_ACTIVE_RUNS_PER_JOB} active runs"
                    ),
                )
                .with_details(json!({
                    "jobName": name,
                    "maxActiveRuns": CRON_MAX_ACTIVE_RUNS_PER_JOB,
                })));
            }
        }

        // Preflight every identity this claim needs before creating scheduler
        // state or ownership. The assignments below are then infallible.
        let run_sequence = checked_cron_identity_successor(
            self.next_run_seq,
            "SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED",
            "cron run sequence",
            &job.name,
            "manual",
        )?;
        let definition_generation = needs_definition_generation
            .then(|| {
                checked_cron_identity_successor(
                    self.next_definition_generation,
                    "SNAPBACK_CRON_DEFINITION_GENERATION_EXHAUSTED",
                    "cron definition generation",
                    &job.name,
                    "definition",
                )
            })
            .transpose()?;

        if let Some(definition_generation) = definition_generation {
            let hash = schedule_hash(&job);
            let seed = format!("fnv1a:{:016x}", stable_hash(&hash));
            self.next_definition_generation = definition_generation;
            self.states.insert(
                job.name.clone(),
                CronJobRuntimeState {
                    schedule_hash: hash.clone(),
                    definition_generation,
                    jitter_seed: seed.clone(),
                    jitter_offset_ms: jitter_offset(&job, &hash, &seed),
                    next_nominal_at_ms: None,
                    next_due_at_ms: None,
                    in_flight_run_id: None,
                    in_flight_run_ids: BTreeSet::new(),
                    last_run_at_ms: None,
                    last_outcome: None,
                    last_error: None,
                    consecutive_failures: 0,
                },
            );
        }
        self.next_run_seq = run_sequence;
        let state = self
            .states
            .get_mut(&job.name)
            .expect("manual claim state exists");
        let run_id = format!("cron:{}:manual:{}:{}", job.name, now_ms, run_sequence);
        state.claim_run(run_id.clone());
        let slot_key = format!("cron:{}:manual:{}", job.name, now_ms);
        Ok(CronRunClaim {
            job: job.clone(),
            metadata: CronRunMetadata {
                job_name: job.name,
                run_id,
                scheduled_at_ms: None,
                due_at_ms: now_ms,
                idempotency_key: slot_key.clone(),
                slot_key,
                attempt: 1,
                trigger: CronRunTrigger::Manual,
            },
            started_at_ms: now_ms,
            definition_generation: state.definition_generation,
        })
    }

    pub fn finish_run(
        &mut self,
        claim: CronRunClaim,
        finished_at_ms: u64,
        result: Result<Value, Diagnostic>,
    ) -> CronRunRecord {
        let (outcome, diagnostic, result_value) = match result {
            Ok(value) => (CronRunOutcome::Succeeded, None, Some(value)),
            Err(diagnostic) => (CronRunOutcome::Failed, Some(diagnostic), None),
        };
        let duration_ms = finished_at_ms.saturating_sub(claim.started_at_ms);
        let record = CronRunRecord {
            run_id: claim.metadata.run_id.clone(),
            job_name: claim.job.name.clone(),
            scheduled_at_ms: claim.metadata.scheduled_at_ms,
            due_at_ms: claim.metadata.due_at_ms,
            started_at_ms: claim.started_at_ms,
            finished_at_ms: Some(finished_at_ms),
            trigger: claim.metadata.trigger.clone(),
            attempt: claim.metadata.attempt,
            outcome: outcome.clone(),
            duration_ms: Some(duration_ms),
            idempotency_key: claim.metadata.idempotency_key.clone(),
            slot_key: claim.metadata.slot_key.clone(),
            diagnostic: diagnostic.clone(),
            result: result_value,
        };

        if let Some(state) = self.states.get_mut(&claim.job.name) {
            let current_generation = state.definition_generation == claim.definition_generation
                && state.schedule_hash == schedule_hash(&claim.job);
            // Ownership is logical-job-wide and must be released even when
            // this detached worker belongs to an older definition. Outcome
            // state is generation-specific: a predecessor must not overwrite
            // the replacement's last-run summary after a hot reload.
            if state.finish_owned_run(&claim.metadata.run_id) && current_generation {
                state.last_run_at_ms = Some(finished_at_ms);
                state.last_outcome = Some(outcome.clone());
                state.last_error = diagnostic.clone();
                if outcome == CronRunOutcome::Failed {
                    state.consecutive_failures = state
                        .consecutive_failures
                        .saturating_add(1)
                        .min(PORTABLE_STORAGE_VERSION_MAX);
                } else {
                    state.consecutive_failures = 0;
                }
            }
        }
        self.record_run(ledger_record(&record));
        record
    }

    fn skipped_record(
        &mut self,
        job: &CronJobDefinition,
        scheduled_at_ms: Option<u64>,
        due_at_ms: u64,
        now_ms: u64,
        capacity_blocked: bool,
        run_sequence: u64,
    ) -> CronRunRecord {
        let slot_key = format!(
            "cron:{}:scheduled:{}",
            job.name,
            scheduled_at_ms.unwrap_or(now_ms)
        );
        CronRunRecord {
            run_id: format!(
                "cron:{}:skipped:{}:{}",
                job.name,
                scheduled_at_ms.unwrap_or(now_ms),
                run_sequence
            ),
            job_name: job.name.clone(),
            scheduled_at_ms,
            due_at_ms,
            started_at_ms: now_ms,
            finished_at_ms: Some(now_ms),
            trigger: CronRunTrigger::Scheduled,
            attempt: 1,
            outcome: CronRunOutcome::Skipped,
            duration_ms: Some(0),
            idempotency_key: slot_key.clone(),
            slot_key,
            diagnostic: Some(if capacity_blocked {
                Diagnostic::warning(
                    "SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED",
                    "cron",
                    format!(
                        "cron job {} skipped because it already owns the maximum {CRON_MAX_ACTIVE_RUNS_PER_JOB} active runs",
                        job.name
                    ),
                )
                .with_details(json!({
                    "jobName": job.name,
                    "maxActiveRuns": CRON_MAX_ACTIVE_RUNS_PER_JOB,
                }))
            } else {
                Diagnostic::warning(
                    "SNAPBACK_CRON_RUN_SKIPPED_OVERLAP",
                    "cron",
                    format!(
                        "cron job {} skipped because a prior run is still in flight",
                        job.name
                    ),
                )
            }),
            result: None,
        }
    }

    fn record_run(&mut self, record: CronRunRecord) {
        self.recent_runs.push_front(record);
        while self.recent_runs.len() > MAX_RECENT_RUNS {
            self.recent_runs.pop_back();
        }
    }

    fn record_diagnostics(&mut self, diagnostics: Vec<Diagnostic>) {
        for diagnostic in diagnostics {
            self.diagnostics.push_front(diagnostic);
        }
        while self.diagnostics.len() > MAX_RECENT_RUNS {
            self.diagnostics.pop_back();
        }
    }

    fn strip_result_payloads(&mut self) {
        for record in &mut self.recent_runs {
            record.result = None;
        }
    }
}

pub fn validate_cron_manifest(manifest: &FunctionManifest) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let mut names = BTreeSet::new();
    for job in &manifest.cron_jobs {
        if !names.insert(job.name.clone()) {
            diagnostics.push(cron_error(
                "SNAPBACK_CRON_DUPLICATE_JOB",
                job,
                format!("duplicate cron job {}", job.name),
            ));
        }
        if job.jitter_policy.enabled
            && normalized_jitter_policy(job)
                .max_offset_ms
                .checked_add(1)
                .is_none()
        {
            diagnostics.push(cron_error(
                "SNAPBACK_CRON_JITTER_INVALID",
                job,
                format!("cron job {} jitter maxOffsetMs is too large", job.name),
            ));
        }
        match (&job.schedule.every_ms, &job.schedule.cron) {
            (Some(_), Some(_)) | (None, None) => diagnostics.push(cron_error(
                "SNAPBACK_CRON_INVALID_SCHEDULE",
                job,
                format!("cron job {} must specify exactly one schedule", job.name),
            )),
            (Some(0), None) => diagnostics.push(cron_error(
                "SNAPBACK_CRON_INVALID_INTERVAL",
                job,
                format!("cron job {} everyMs must be positive", job.name),
            )),
            (Some(ms), None) if *ms < LOCAL_MIN_INTERVAL_MS => diagnostics.push(cron_error(
                "SNAPBACK_CRON_TARGET_CADENCE_UNSUPPORTED",
                job,
                format!(
                    "cron job {} asks for everyMs {}, below the local scheduler floor",
                    job.name, ms
                ),
            )),
            (None, Some(expr)) => match parse_cron_expr(expr) {
                Err(()) => diagnostics.push(cron_error(
                    "SNAPBACK_CRON_INVALID_EXPRESSION",
                    job,
                    format!("cron job {} has an invalid cron expression", job.name),
                )),
                // An expression with no match within the scan bound can
                // never fire (the bound exceeds the widest gap between
                // fires of any satisfiable expression), so scanning from 0
                // is a complete satisfiability check. Rejecting it here is
                // what keeps a Feb 30 job from silently never scheduling.
                //
                // @ref LLP 0028#calendar-expression-semantics — fail closed
                // with a structured diagnostic, never a silent no-op.
                Ok(spec) if next_cron_match_after(&spec, 0).is_none() => {
                    diagnostics.push(cron_error(
                        "SNAPBACK_CRON_UNSATISFIABLE_EXPRESSION",
                        job,
                        format!(
                            "cron job {} has a cron expression that can never fire",
                            job.name
                        ),
                    ));
                }
                Ok(_) => {}
            },
            _ => {}
        }

        // No retry logic exists for any mode yet (`NextTick` is the implicit
        // skip-to-next-tick default). A job that asks for backoff would
        // parse, then silently get no retries — reject it instead.
        //
        // @ref LLP 0028#failure-and-retry — `retry: backoff` is declared but
        // unimplemented; the LLP 0032 test-debt fail-closed rule rejects it
        // at validation until real retry logic lands.
        if job.retry_policy.mode == CronRetryMode::Backoff {
            diagnostics.push(cron_error(
                "SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED",
                job,
                format!(
                    "cron job {} requests retry mode Backoff, which is not implemented; \
                     use NextTick or remove the retry policy",
                    job.name
                ),
            ));
        }

        match manifest.function(&job.action) {
            Some(function)
                if function.kind == FunctionKind::Action
                    && function.effective_auth_requirement() == AuthRequirement::Authenticated =>
            {
                // @ref LLP 0058#closed-function-requirement — cron executes as
                // `System`, which carries no app user; reject an impossible
                // authenticated target before the scheduler can admit it.
                diagnostics.push(cron_error(
                    "SNAPBACK_CRON_AUTH_REQUIREMENT_INVALID",
                    job,
                    format!(
                        "cron job {} targets authenticated action {}, but system authority has no user",
                        job.name, job.action
                    ),
                ));
            }
            Some(function) if function.kind == FunctionKind::Action => {}
            Some(_) => diagnostics.push(cron_error(
                "SNAPBACK_CRON_ACTION_KIND_MISMATCH",
                job,
                format!(
                    "cron job {} action {} is not an action",
                    job.name, job.action
                ),
            )),
            None => diagnostics.push(cron_error(
                "SNAPBACK_CRON_ACTION_MISSING",
                job,
                format!(
                    "cron job {} references unknown action {}",
                    job.name, job.action
                ),
            )),
        }

        if job.activation.kind == CronActivationKind::WhileLive {
            if job.activation.while_live.is_empty() {
                diagnostics.push(cron_error(
                    "SNAPBACK_CRON_WHILE_LIVE_EMPTY",
                    job,
                    format!(
                        "cron job {} has whileLive activation with no live query names",
                        job.name
                    ),
                ));
            }
            for name in &job.activation.while_live {
                match manifest.function(name) {
                    Some(function) if function.kind == FunctionKind::LiveQuery => {}
                    Some(_) => diagnostics.push(cron_error(
                        "SNAPBACK_CRON_WHILE_LIVE_KIND_MISMATCH",
                        job,
                        format!(
                            "cron job {} whileLive target {} is not a live query",
                            job.name, name
                        ),
                    )),
                    None => diagnostics.push(cron_error(
                        "SNAPBACK_CRON_WHILE_LIVE_MISSING",
                        job,
                        format!(
                            "cron job {} references unknown whileLive target {}",
                            job.name, name
                        ),
                    )),
                }
            }
        }
    }
    diagnostics
}

/// Names of jobs that carry an error-severity validation diagnostic — the
/// jobs `reconcile` refuses runtime state for.
fn error_job_names(diagnostics: &[Diagnostic]) -> BTreeSet<String> {
    diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error)
        .filter_map(|diagnostic| {
            diagnostic
                .details
                .get("jobName")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect()
}

fn cron_error(
    code: impl Into<String>,
    job: &CronJobDefinition,
    message: impl Into<String>,
) -> Diagnostic {
    let mut details = json!({ "jobName": job.name });
    if let Some(span) = &job.source_span {
        details["sourceSpan"] = serde_json::to_value(span).unwrap_or(Value::Null);
    }
    Diagnostic::error(code, "cron", message).with_details(details)
}

fn ensure_next_due(job: &CronJobDefinition, state: &mut CronJobRuntimeState, now_ms: u64) {
    if state.next_nominal_at_ms.is_none() {
        state.next_nominal_at_ms = initial_nominal(job, now_ms);
    }
    if let Some(nominal) = state.next_nominal_at_ms {
        state.next_due_at_ms = Some(nominal.saturating_add(state.jitter_offset_ms));
    }
}

fn initial_nominal(job: &CronJobDefinition, now_ms: u64) -> Option<u64> {
    if let Some(every_ms) = job.schedule.every_ms {
        if every_ms == 0 {
            // Rejected by validation; keep the historical inert value for a
            // stale persisted artifact (`next_nominal_after` never advances it).
            return Some(0);
        }
        // @ref LLP 0028#inspection-and-query-surface — interval nominals stay
        // on the epoch-anchored grid ("every 1m" means whole-minute
        // boundaries), but a never-run job seeds at the MOST RECENT past
        // slot, not slot 0: the run's trusted clock is bound to its due time
        // (ctx.runtime.now()), and the epoch-0 seed executed the catch-up
        // run with trusted time ~0 — time-gated handler logic silently
        // no-oped while the ledger recorded Succeeded, and any committed
        // timestamps were 1970-dated (0137 a4-f4).
        Some(now_ms / every_ms * every_ms)
    } else if job.schedule.cron.is_some() {
        next_calendar_nominal_after(job, None, now_ms)
    } else {
        None
    }
}

fn next_nominal_after(
    job: &CronJobDefinition,
    previous_nominal_at_ms: Option<u64>,
    now_ms: u64,
) -> Option<u64> {
    if let Some(every_ms) = job.schedule.every_ms {
        if every_ms == 0 {
            return None;
        }
        let previous = previous_nominal_at_ms.unwrap_or(0);
        if previous > now_ms {
            return Some(previous);
        }
        let missed = now_ms.saturating_sub(previous) / every_ms + 1;
        return Some(previous.saturating_add(missed.saturating_mul(every_ms)));
    }
    next_calendar_nominal_after(job, previous_nominal_at_ms, now_ms)
}

fn ledger_record(record: &CronRunRecord) -> CronRunRecord {
    let mut record = record.clone();
    record.result = None;
    record
}

/// Upper bound (in days) on the calendar scan in [`next_cron_match_after`].
/// Under the DK-6 day-matching rule the rarest satisfiable expression is a
/// leap-day date with an unrestricted weekday (`0 0 29 2 *`): consecutive
/// fires are at most 2,921 days apart (2096-02-29 → 2104-02-29, across the
/// non-leap century year 2100). An expression with no match inside the
/// bound therefore can never fire at all, from any starting instant.
///
/// @ref LLP 0028#calendar-expression-semantics — the bound is what turns an
/// unsatisfiable expression (Feb 30) into a detectable validation error
/// instead of a job that silently never fires.
const MAX_CALENDAR_SCAN_DAYS: u64 = 3_000;

fn next_calendar_nominal_after(
    job: &CronJobDefinition,
    previous_nominal_at_ms: Option<u64>,
    now_ms: u64,
) -> Option<u64> {
    let expr = job.schedule.cron.as_deref()?;
    let spec = parse_cron_expr(expr).ok()?;
    // A stale persisted nominal (downtime, WhileLive re-arm after idle days,
    // a run finishing past the next slot boundary) must coalesce past now —
    // one catch-up slot fires and the next nominal lands strictly in the
    // future, matching the interval branch in `next_nominal_after`.
    // @ref LLP 0028#delivery-overlap-and-missed-ticks — missed ticks run
    // once on recovery; never backfill every missed slot.
    let floor = previous_nominal_at_ms.map_or(now_ms, |prev| prev.max(now_ms));
    next_cron_match_after(&spec, floor)
}

/// First minute-aligned time strictly after `floor_ms` that matches `spec`.
///
/// Steps by civil day — date fields first, then the earliest matching
/// hour/minute inside a matching day — so the bounded scan costs at most
/// [`MAX_CALENDAR_SCAN_DAYS`] cheap iterations rather than the ~527k minute
/// steps a year-long minute walk took. Returns `None` only for expressions
/// that can never fire; `validate_cron_manifest` rejects those up front, so
/// a scheduled job never silently no-ops here.
fn next_cron_match_after(spec: &CronExpr, floor_ms: u64) -> Option<u64> {
    const MINUTES_PER_DAY: u64 = 24 * 60;
    let start_minute = floor_ms / 60_000 + 1;
    let start_day = start_minute / MINUTES_PER_DAY;
    let start_minute_of_day = (start_minute % MINUTES_PER_DAY) as u32;
    for day in start_day..start_day.saturating_add(MAX_CALENDAR_SCAN_DAYS) {
        let (_year, month, day_of_month) = civil_from_days(day as i64)?;
        let weekday = (day as i64 + 4).rem_euclid(7) as u32;
        if !spec.months.matches(month) || !spec.day_matches(day_of_month, weekday) {
            continue;
        }
        let from = if day == start_day {
            start_minute_of_day
        } else {
            0
        };
        if let Some(minute_of_day) = spec.first_time_at_or_after(from) {
            let at_ms = (day * MINUTES_PER_DAY + u64::from(minute_of_day)) * 60_000;
            debug_assert!(
                utc_parts(at_ms).is_some_and(|parts| spec.matches(
                    parts.minute,
                    parts.hour,
                    parts.day,
                    parts.month,
                    parts.weekday
                )),
                "day-stepping scan returned a minute the full matcher rejects"
            );
            return Some(at_ms);
        }
    }
    None
}

fn activation_state(
    job: &CronJobDefinition,
    active_live_functions: &BTreeSet<String>,
) -> CronActivationState {
    if !job.enabled {
        return CronActivationState::Disabled;
    }
    match job.activation.kind {
        CronActivationKind::Always => CronActivationState::Armed,
        CronActivationKind::WhileLive => {
            if job
                .activation
                .while_live
                .iter()
                .any(|name| active_live_functions.contains(name))
            {
                CronActivationState::Armed
            } else {
                CronActivationState::InactiveNoDemand
            }
        }
    }
}

fn activation_policy_label(job: &CronJobDefinition) -> String {
    match job.activation.kind {
        CronActivationKind::Always => "always".to_owned(),
        CronActivationKind::WhileLive => {
            format!("whileLive:{}", job.activation.while_live.join(","))
        }
    }
}

fn schedule_hash(job: &CronJobDefinition) -> String {
    let schedule = serde_json::to_string(&json!({
        "schedule": job.schedule,
        "action": job.action,
        "enabled": job.enabled,
        "activation": job.activation,
        "jitterPolicy": normalized_jitter_policy(job),
        "overlapPolicy": job.overlap_policy,
        "retryPolicy": job.retry_policy,
    }))
    .unwrap_or_else(|_| job.name.clone());
    format!("fnv1a:{:016x}", stable_hash(&schedule))
}

fn normalized_jitter_policy(job: &CronJobDefinition) -> CronJitterPolicy {
    let mut policy = job.jitter_policy.clone();
    if policy.max_offset_ms == 0 {
        policy.max_offset_ms = default_jitter_max_ms(job);
    }
    policy
}

fn default_jitter_max_ms(job: &CronJobDefinition) -> u64 {
    if let Some(every_ms) = job.schedule.every_ms {
        (every_ms / 10).min(60_000)
    } else {
        5 * 60_000
    }
}

fn jitter_offset(job: &CronJobDefinition, schedule_hash: &str, seed: &str) -> u64 {
    // @ref LLP 0028#jitter — default jitter is deterministic from stable app/job
    // inputs, never from ambient randomness.
    let policy = normalized_jitter_policy(job);
    if !policy.enabled || policy.max_offset_ms == 0 {
        return 0;
    }
    let Some(modulus) = policy.max_offset_ms.checked_add(1) else {
        // Whole-manifest validation rejects this value before install. Keep
        // the scheduler defensive if an older persisted artifact reaches it.
        return 0;
    };
    stable_hash(&format!("{}\0{}\0{}", job.name, schedule_hash, seed)) % modulus
}

fn stable_hash(input: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[derive(Clone, Copy, Debug)]
struct UtcParts {
    minute: u32,
    hour: u32,
    day: u32,
    month: u32,
    /// Sunday = 0, matching five-field cron.
    weekday: u32,
}

fn utc_parts(ms: u64) -> Option<UtcParts> {
    let seconds = (ms / 1_000) as i64;
    let days = seconds.div_euclid(86_400);
    let second_of_day = seconds.rem_euclid(86_400);
    let hour = (second_of_day / 3_600) as u32;
    let minute = ((second_of_day % 3_600) / 60) as u32;
    let (_year, month, day) = civil_from_days(days)?;
    let weekday = (days + 4).rem_euclid(7) as u32;
    Some(UtcParts {
        minute,
        hour,
        day,
        month,
        weekday,
    })
}

pub(crate) fn civil_from_days(days_since_epoch: i64) -> Option<(i32, u32, u32)> {
    let z = days_since_epoch.checked_add(719_468)?;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096).div_euclid(365);
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2).div_euclid(153);
    let day = doy - (153 * mp + 2).div_euclid(5) + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    Some((year as i32, month as u32, day as u32))
}

#[derive(Clone, Debug)]
struct CronExpr {
    minutes: CronField,
    hours: CronField,
    days: CronField,
    months: CronField,
    weekdays: CronField,
}

impl CronExpr {
    fn matches(&self, minute: u32, hour: u32, day: u32, month: u32, weekday: u32) -> bool {
        self.minutes.matches(minute)
            && self.hours.matches(hour)
            && self.months.matches(month)
            && self.day_matches(day, weekday)
    }

    /// Five-field cron day matching, DK-6 semantics: when both day-of-month
    /// and day-of-week are restricted, a day matches when EITHER field
    /// matches (POSIX OR — `0 0 13 * 5` fires on every 13th and on every
    /// Friday). When at most one is restricted, the bare `*` matches
    /// everything, so the conjunction is AND-equivalent standard cron. A
    /// field is restricted whenever it is anything but a bare `*`; a stepped
    /// day field (`*/2`) counts as restricted — a deliberate divergence from
    /// Vixie's `*`-spelling flag so every validation-passing expression
    /// provably fires within [`MAX_CALENDAR_SCAN_DAYS`].
    ///
    /// @ref LLP 0028#calendar-expression-semantics — DK-6 ratified POSIX OR;
    /// breaking change from the pre-2026-07 AND matching.
    fn day_matches(&self, day: u32, weekday: u32) -> bool {
        if !self.days.any && !self.weekdays.any {
            self.days.matches(day) || self.weekdays.matches(weekday)
        } else {
            self.days.matches(day) && self.weekdays.matches(weekday)
        }
    }

    /// Smallest minute-of-day at or after `from_minute_of_day` whose hour
    /// and minute fields both match, or `None` when nothing later today can.
    fn first_time_at_or_after(&self, from_minute_of_day: u32) -> Option<u32> {
        let from_hour = from_minute_of_day / 60;
        let mut hour_floor = from_hour;
        while let Some(hour) = self.hours.first_at_or_after(hour_floor, 23) {
            let minute_floor = if hour == from_hour {
                from_minute_of_day % 60
            } else {
                0
            };
            if let Some(minute) = self.minutes.first_at_or_after(minute_floor, 59) {
                return Some(hour * 60 + minute);
            }
            hour_floor = hour + 1;
        }
        None
    }
}

#[derive(Clone, Debug)]
struct CronField {
    any: bool,
    values: BTreeSet<u32>,
}

impl CronField {
    fn matches(&self, value: u32) -> bool {
        self.any || self.values.contains(&value)
    }

    /// Smallest matching value in `floor..=max`, if any.
    fn first_at_or_after(&self, floor: u32, max: u32) -> Option<u32> {
        if floor > max {
            return None;
        }
        if self.any {
            Some(floor)
        } else {
            self.values.range(floor..=max).next().copied()
        }
    }
}

fn parse_cron_expr(expr: &str) -> Result<CronExpr, ()> {
    let parts = expr.split_whitespace().collect::<Vec<_>>();
    if parts.len() != 5 {
        return Err(());
    }
    Ok(CronExpr {
        minutes: parse_cron_field(parts[0], 0, 59, false)?,
        hours: parse_cron_field(parts[1], 0, 23, false)?,
        days: parse_cron_field(parts[2], 1, 31, false)?,
        months: parse_cron_field(parts[3], 1, 12, false)?,
        weekdays: parse_cron_field(parts[4], 0, 7, true)?,
    })
}

fn parse_cron_field(
    value: &str,
    min: u32,
    max: u32,
    normalize_weekdays: bool,
) -> Result<CronField, ()> {
    if value == "*" {
        return Ok(CronField {
            any: true,
            values: BTreeSet::new(),
        });
    }
    if let Some(step) = value.strip_prefix("*/") {
        let step = step.parse::<u32>().map_err(|_| ())?;
        if step == 0 {
            return Err(());
        }
        let values = (min..=max)
            .filter(|candidate| (candidate - min).is_multiple_of(step))
            .map(|candidate| normalize_cron_value(candidate, normalize_weekdays))
            .collect();
        return Ok(CronField { any: false, values });
    }
    let mut values = BTreeSet::new();
    for part in value.split(',') {
        let parsed = part.parse::<u32>().map_err(|_| ())?;
        if parsed < min || parsed > max {
            return Err(());
        }
        values.insert(normalize_cron_value(parsed, normalize_weekdays));
    }
    Ok(CronField { any: false, values })
}

fn normalize_cron_value(value: u32, normalize_weekdays: bool) -> u32 {
    if normalize_weekdays && value == 7 {
        0
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        CronActivationPolicy, CronRetryPolicy, FunctionDefinition, FunctionRuntime, IbexModule,
    };

    /// Inverse of `civil_from_days` (Howard Hinnant's `days_from_civil`),
    /// kept test-local so the tests cross-check the production math with an
    /// independent implementation instead of reusing it.
    fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
        let y = year - i64::from(month <= 2);
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = i64::from((month + 9) % 12);
        let doy = (153 * mp + 2) / 5 + i64::from(day) - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146_097 + doe - 719_468
    }

    fn ms_at(year: i64, month: u32, day: u32, hour: u32, minute: u32) -> u64 {
        let days = days_from_civil(year, month, day);
        assert!(days >= 0, "test dates must be at or after the epoch");
        ((days as u64 * 24 + u64::from(hour)) * 60 + u64::from(minute)) * 60_000
    }

    fn parse(expr: &str) -> CronExpr {
        parse_cron_expr(expr).expect("cron expression should parse")
    }

    /// Evaluates `spec` at a civil UTC instant via the production
    /// `utc_parts` decomposition.
    fn matches_at(
        spec: &CronExpr,
        year: i64,
        month: u32,
        day: u32,
        hour: u32,
        minute: u32,
    ) -> bool {
        let parts = utc_parts(ms_at(year, month, day, hour, minute)).expect("representable time");
        spec.matches(
            parts.minute,
            parts.hour,
            parts.day,
            parts.month,
            parts.weekday,
        )
    }

    fn action_stub(name: &str) -> FunctionDefinition {
        FunctionDefinition::new(
            name,
            FunctionKind::Action,
            FunctionRuntime::IbexModule(IbexModule {
                source: "bundle.js".to_owned(),
                export: name.to_owned(),
            }),
        )
    }

    fn live_query_stub(name: &str) -> FunctionDefinition {
        FunctionDefinition::new(
            name,
            FunctionKind::LiveQuery,
            FunctionRuntime::IbexModule(IbexModule {
                source: "bundle.js".to_owned(),
                export: name.to_owned(),
            }),
        )
    }

    fn cron_job(name: &str, schedule: CronSchedule) -> CronJobDefinition {
        CronJobDefinition {
            name: name.to_owned(),
            schedule,
            action: "refreshAction".to_owned(),
            enabled: true,
            activation: CronActivationPolicy::default(),
            jitter_policy: CronJitterPolicy::default(),
            overlap_policy: CronOverlapPolicy::default(),
            retry_policy: CronRetryPolicy::default(),
            required_capabilities: Vec::new(),
            target_wakeup: None,
            source_span: None,
        }
    }

    fn calendar_job(name: &str, expr: &str) -> CronJobDefinition {
        cron_job(
            name,
            CronSchedule {
                every_ms: None,
                cron: Some(expr.to_owned()),
            },
        )
    }

    fn interval_job(name: &str, every_ms: u64) -> CronJobDefinition {
        cron_job(
            name,
            CronSchedule {
                every_ms: Some(every_ms),
                cron: None,
            },
        )
    }

    fn manifest_with_jobs(jobs: Vec<CronJobDefinition>) -> FunctionManifest {
        FunctionManifest {
            functions: vec![action_stub("refreshAction")],
            cron_jobs: jobs,
            ..FunctionManifest::default()
        }
    }

    #[test]
    fn list_projection_keeps_operator_posture_and_drops_sensitive_runtime_detail() {
        let mut job = interval_job("poll", 60_000);
        job.jitter_policy.enabled = false;
        let manifest = manifest_with_jobs(vec![job]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        let inspect = runtime.inspect(&manifest, &BTreeSet::new(), 120_000);
        let listed = CronListState::from(inspect);

        assert_eq!(listed.artifact_kind, "snapback.cron-list/v1");
        assert_eq!(listed.jobs.len(), 1);
        assert_eq!(listed.jobs[0].name, "poll");
        assert_eq!(listed.jobs[0].action, "refreshAction");
        assert_eq!(listed.jobs[0].next_nominal_at_ms, Some(120_000));
        assert_eq!(listed.jobs[0].next_due_at_ms, Some(120_000));

        let wire = serde_json::to_value(listed).unwrap();
        assert!(wire["jobs"][0].get("inFlightRunId").is_none());
        assert!(wire["jobs"][0].get("lastError").is_none());
        assert!(wire["jobs"][0].get("jitterSeed").is_none());
        assert!(wire["jobs"][0].get("recentRuns").is_none());
    }

    /// ENG-24369 — keep the local scheduler's strict-next arithmetic pinned to
    /// the same boundary/downtime vectors as `cloudflare/test/cron-utils.mjs`.
    /// @ref LLP 0028#delivery-overlap-and-missed-ticks — coalesce missed slots,
    /// then advance to the smallest nominal strictly after now.
    #[test]
    fn interval_strict_next_vectors_match_cloudflare() {
        for (previous, interval, now, expected) in [
            (0, 10, 9, 10),
            (0, 10, 10, 20),
            (0, 10, 11, 20),
            (0, 10, 35, 40),
            (0, 10, 40, 50),
            (
                1_700_000_000_000,
                180_000,
                1_700_000_999_999,
                1_700_001_080_000,
            ),
        ] {
            let job = interval_job("strictNext", interval);
            assert_eq!(
                next_nominal_after(&job, Some(previous), now),
                Some(expected),
                "previous={previous} interval={interval} now={now}"
            );
        }
    }

    // 0137 a4-f4: a never-run `everyMs` job seeds its catch-up nominal at
    // the most recent epoch-aligned slot, never slot 0. The run's trusted
    // clock is bound to its due time (`ctx.runtime.now()` == due), so the
    // old epoch-0 seed executed the catch-up run with trusted time ~0:
    // time-gated handler logic (`remindAt <= now`) silently no-oped while
    // the ledger recorded Succeeded, and committed timestamps were
    // 1970-dated. The grid stays epoch-anchored — the seeded slot is a
    // whole multiple of the interval — and the catch-up still fires
    // immediately (due <= now with default jitter).
    #[test]
    fn first_interval_claim_seeds_at_the_most_recent_slot_not_epoch_zero() {
        let mut job = interval_job("poll", 60_000);
        job.jitter_policy = CronJitterPolicy {
            enabled: false,
            max_offset_ms: 0,
        };
        let manifest = manifest_with_jobs(vec![job]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        let now = 1_753_000_000_123_u64;
        let slot = now / 60_000 * 60_000;
        let claims = runtime.claim_due_runs(&manifest, &BTreeSet::new(), now);
        assert_eq!(
            claims.len(),
            1,
            "the seeded catch-up run still claims immediately"
        );
        let metadata = &claims[0].metadata;
        assert_eq!(
            metadata.scheduled_at_ms,
            Some(slot),
            "catch-up nominal must be the most recent epoch-aligned slot"
        );
        assert_eq!(
            metadata.due_at_ms, slot,
            "jitter disabled: due is the seeded slot"
        );
        assert!(
            now - metadata.due_at_ms < 60_000,
            "the run's trusted clock stays within one interval of wall clock"
        );
        // The consumed nominal advances to the strictly-future slot: nothing
        // else is due at this instant (grid advancement itself is pinned by
        // `interval_strict_next_vectors_match_cloudflare`).
        assert!(
            runtime
                .claim_due_runs(&manifest, &BTreeSet::new(), now)
                .is_empty(),
            "next nominal must be strictly in the future"
        );
    }

    #[test]
    fn parse_accepts_v0_grammar() {
        let nightly = parse("0 3 * * *");
        assert!(nightly.minutes.matches(0) && !nightly.minutes.matches(1));
        assert!(nightly.hours.matches(3) && !nightly.hours.matches(4));
        assert!(nightly.days.any && nightly.months.any && nightly.weekdays.any);

        let steps = parse("*/15 * * * *");
        assert!(!steps.minutes.any);
        for minute in [0, 15, 30, 45] {
            assert!(steps.minutes.matches(minute));
        }
        assert!(!steps.minutes.matches(5));

        let list = parse("0 0 1,15 * *");
        assert!(list.days.matches(1) && list.days.matches(15) && !list.days.matches(2));

        // Day-of-week 7 normalizes to Sunday (0), matching five-field cron.
        let sunday = parse("0 0 * * 7");
        assert!(sunday.weekdays.matches(0));

        let stepped_weekdays = parse("0 0 * * */2");
        assert!(!stepped_weekdays.weekdays.any);
        for weekday in [0, 2, 4, 6] {
            assert!(stepped_weekdays.weekdays.matches(weekday));
        }
        assert!(!stepped_weekdays.weekdays.matches(1));
    }

    #[test]
    fn parse_rejects_malformed_expressions() {
        for expr in [
            "",
            "* * * *",
            "* * * * * *",
            "60 * * * *",
            "* 24 * * *",
            "* * 0 * *",
            "* * 32 * *",
            "* * * 0 *",
            "* * * 13 *",
            "* * * * 8",
            "*/0 * * * *",
            // Ranges and names are not part of the v0 grammar (LLP 0028
            // #calendar-expression-semantics); they must fail loudly, not
            // parse as something else.
            "1-5 * * * *",
            "0 0 * * MON",
        ] {
            assert!(
                parse_cron_expr(expr).is_err(),
                "expected {expr:?} to be rejected"
            );
        }
    }

    // DK-6 matrix: both day fields restricted -> POSIX OR (either matches).
    #[test]
    fn dom_dow_both_restricted_matches_either() {
        let spec = parse("0 0 13 * 5");
        // 2026-02-13 is a Friday the 13th: both sides hit.
        assert!(matches_at(&spec, 2026, 2, 13, 0, 0));
        // 2026-01-13 is a Tuesday: day-of-month side hits.
        assert!(matches_at(&spec, 2026, 1, 13, 0, 0));
        // 2026-02-06 is a Friday: day-of-week side hits.
        assert!(matches_at(&spec, 2026, 2, 6, 0, 0));
        // 2026-02-11 is a Wednesday the 11th: neither side hits.
        assert!(!matches_at(&spec, 2026, 2, 11, 0, 0));
        // Minute/hour fields still AND with the day match.
        assert!(!matches_at(&spec, 2026, 2, 13, 0, 1));
        assert!(!matches_at(&spec, 2026, 2, 13, 1, 0));
    }

    #[test]
    fn dom_only_restricted_requires_day_of_month() {
        let spec = parse("0 0 13 * *");
        assert!(matches_at(&spec, 2026, 1, 13, 0, 0));
        assert!(matches_at(&spec, 2026, 2, 13, 0, 0));
        assert!(!matches_at(&spec, 2026, 2, 14, 0, 0));
    }

    #[test]
    fn dow_only_restricted_requires_day_of_week() {
        let spec = parse("0 0 * * 5");
        // Fridays match whether or not they are the 13th...
        assert!(matches_at(&spec, 2026, 2, 6, 0, 0));
        assert!(matches_at(&spec, 2026, 2, 13, 0, 0));
        // ...and non-Fridays never do.
        assert!(!matches_at(&spec, 2026, 2, 14, 0, 0));
        assert!(!matches_at(&spec, 2026, 2, 11, 0, 0));
    }

    #[test]
    fn dom_dow_wildcards_match_every_day() {
        let spec = parse("0 0 * * *");
        for (month, day) in [(1, 13), (2, 6), (2, 11), (2, 14)] {
            assert!(matches_at(&spec, 2026, month, day, 0, 0));
        }
    }

    // A stepped day field (`*/2`) counts as restricted, so the OR rule
    // applies. Vixie cron would treat the `*`-spelled field as unrestricted
    // and AND the two; the divergence is deliberate (see `day_matches`).
    #[test]
    fn stepped_day_field_counts_as_restricted() {
        let spec = parse("0 0 13 * */2");
        // 2026-02-13, Friday (5): weekday side misses, day side hits -> OR fires.
        assert!(matches_at(&spec, 2026, 2, 13, 0, 0));
        // 2026-02-08, Sunday (0): day side misses, weekday side hits -> OR fires.
        assert!(matches_at(&spec, 2026, 2, 8, 0, 0));
        // 2026-02-11, Wednesday (3): neither side hits.
        assert!(!matches_at(&spec, 2026, 2, 11, 0, 0));
    }

    #[test]
    fn next_calendar_nominal_crosses_month_boundaries() {
        let monthly = calendar_job("monthly", "0 0 1 * *");
        // The fire after the Jan 1 slot is Feb 1 (31-day month boundary).
        assert_eq!(
            next_calendar_nominal_after(&monthly, Some(ms_at(2026, 1, 1, 0, 0)), 0),
            Some(ms_at(2026, 2, 1, 0, 0))
        );
        // ...and after Feb 1 comes Mar 1 (28-day February, non-leap year).
        assert_eq!(
            next_calendar_nominal_after(&monthly, Some(ms_at(2026, 2, 1, 0, 0)), 0),
            Some(ms_at(2026, 3, 1, 0, 0))
        );

        // A daily time earlier than "now" rolls into the next month when
        // today is the last day of the month.
        let daily = calendar_job("daily", "30 3 * * *");
        assert_eq!(
            next_calendar_nominal_after(&daily, None, ms_at(2026, 1, 31, 4, 0)),
            Some(ms_at(2026, 2, 1, 3, 30))
        );
        // The result is strictly after the floor: from exactly 03:30 the
        // next nominal is tomorrow's 03:30.
        assert_eq!(
            next_calendar_nominal_after(&daily, None, ms_at(2026, 1, 15, 3, 30)),
            Some(ms_at(2026, 1, 16, 3, 30))
        );
    }

    // A previous nominal far in the past (server downtime with persisted
    // cron state, or a WhileLive job re-armed after idle days) must not
    // replay every missed slot: the scan floors at now, so exactly one
    // past-due slot fires and the next nominal is strictly in the future.
    // @ref LLP 0028#delivery-overlap-and-missed-ticks — run once on
    // recovery; do not backfill every missed interval.
    #[test]
    fn next_calendar_nominal_coalesces_missed_slots_past_now() {
        let daily = calendar_job("daily", "0 3 * * *");
        // Down since the Jul 1 03:00 slot, back at Jul 4 12:00: the slot
        // after the stale nominal is Jul 5 03:00, not Jul 2 03:00.
        assert_eq!(
            next_calendar_nominal_after(
                &daily,
                Some(ms_at(2026, 7, 1, 3, 0)),
                ms_at(2026, 7, 4, 12, 0)
            ),
            Some(ms_at(2026, 7, 5, 3, 0))
        );
        // Every-minute job after a long outage coalesces the same way
        // instead of queueing thousands of back-to-back stale replays.
        let minutely = calendar_job("minutely", "* * * * *");
        assert_eq!(
            next_calendar_nominal_after(
                &minutely,
                Some(ms_at(2026, 7, 1, 3, 0)),
                ms_at(2026, 7, 4, 12, 0)
            ),
            Some(ms_at(2026, 7, 4, 12, 1))
        );
    }

    #[test]
    fn next_calendar_nominal_handles_leap_day() {
        let leap = calendar_job("leapDay", "0 0 29 2 *");
        assert_eq!(
            next_calendar_nominal_after(&leap, None, ms_at(2027, 6, 15, 0, 0)),
            Some(ms_at(2028, 2, 29, 0, 0))
        );
        // The next fire can be almost four years out — well beyond the 366
        // days the pre-DK-6 scan covered.
        assert_eq!(
            next_calendar_nominal_after(&leap, None, ms_at(2028, 3, 1, 0, 0)),
            Some(ms_at(2032, 2, 29, 0, 0))
        );
    }

    // The bounded scan must terminate for an expression that can never
    // fire, and validation must turn that into a structured diagnostic
    // rather than a job that silently never schedules.
    #[test]
    fn unsatisfiable_expression_scan_terminates_with_error() {
        let feb_30 = calendar_job("febThirtieth", "0 0 30 2 *");
        assert_eq!(
            next_calendar_nominal_after(&feb_30, None, ms_at(2026, 1, 1, 0, 0)),
            None
        );
        // Days that exist in no allowed month are equally unsatisfiable.
        let spec = parse("0 0 31 4,6,9,11 *");
        assert_eq!(next_cron_match_after(&spec, 0), None);

        let manifest = manifest_with_jobs(vec![feb_30]);
        let diagnostics = validate_cron_manifest(&manifest);
        let diagnostic = diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == "SNAPBACK_CRON_UNSATISFIABLE_EXPRESSION")
            .expect("unsatisfiable expression should be rejected");
        assert_eq!(diagnostic.severity, DiagnosticSeverity::Error);
        assert_eq!(
            diagnostic.details.get("jobName").and_then(Value::as_str),
            Some("febThirtieth")
        );

        // Fail closed: the job gets no runtime state and is never claimed.
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        let claims = runtime.claim_due_runs(&manifest, &BTreeSet::new(), ms_at(2026, 7, 1, 0, 0));
        assert!(claims.is_empty(), "unsatisfiable job must not be scheduled");
    }

    #[test]
    fn validate_accepts_satisfiable_calendar_jobs() {
        let manifest = manifest_with_jobs(vec![
            calendar_job("nightly", "0 3 * * *"),
            // A leap-day-only schedule is rare but satisfiable; the scan
            // bound must be wide enough not to misreport it.
            calendar_job("leapDay", "0 0 29 2 *"),
            interval_job("poll", 60_000),
        ]);
        let diagnostics = validate_cron_manifest(&manifest);
        assert!(
            diagnostics.is_empty(),
            "unexpected diagnostics: {diagnostics:?}"
        );
    }

    // `retry: backoff` parses but no retry logic exists; the fail-closed
    // rule rejects it at validation instead of silently never retrying.
    #[test]
    fn backoff_retry_mode_is_rejected_fail_closed() {
        let mut backoff = interval_job("pollWithBackoff", 60_000);
        backoff.retry_policy = CronRetryPolicy {
            mode: CronRetryMode::Backoff,
        };
        let manifest = manifest_with_jobs(vec![backoff]);
        let diagnostics = validate_cron_manifest(&manifest);
        let diagnostic = diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == "SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED")
            .expect("backoff retry mode should be rejected");
        assert_eq!(diagnostic.severity, DiagnosticSeverity::Error);
        assert!(diagnostic.message.contains("not implemented"));
        assert_eq!(
            diagnostic.details.get("jobName").and_then(Value::as_str),
            Some("pollWithBackoff")
        );

        // Fail closed: the job gets no runtime state and is never claimed,
        // even when a tick is due.
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        let claims = runtime.claim_due_runs(&manifest, &BTreeSet::new(), 600_000);
        assert!(claims.is_empty(), "backoff job must not be scheduled");

        // The implemented default passes validation untouched.
        let next_tick = interval_job("poll", 60_000);
        assert_eq!(next_tick.retry_policy.mode, CronRetryMode::NextTick);
        assert!(validate_cron_manifest(&manifest_with_jobs(vec![next_tick])).is_empty());
    }

    // ENG-23417 redeploy door: a job that was valid (and earned a nominal)
    // then redeploys with an invalid definition must lose its runtime state.
    // Before the fix, `reconcile` retained the stale nominal, the rejected
    // action fired at the old due time, and — because an invalid expression
    // can never compute a next nominal — was re-claimed on every tick.
    #[test]
    fn redeploy_to_invalid_definition_drops_state_and_never_claims() {
        let valid = manifest_with_jobs(vec![calendar_job("poll", "0 3 * * *")]);
        let mut runtime = LocalCronRuntime::default();
        assert!(runtime.reconcile(&valid).is_empty());
        // A not-yet-due claim pass materializes the next nominal.
        assert!(
            runtime
                .claim_due_runs(&valid, &BTreeSet::new(), ms_at(2026, 7, 1, 12, 0))
                .is_empty()
        );
        assert!(
            runtime
                .states
                .get("poll")
                .is_some_and(|state| state.next_due_at_ms.is_some())
        );

        // Redeploy with a definition the v0 grammar rejects (day names).
        let invalid = manifest_with_jobs(vec![calendar_job("poll", "0 3 * * MON")]);
        let diagnostics = runtime.reconcile(&invalid);
        assert!(
            diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "SNAPBACK_CRON_INVALID_EXPRESSION")
        );
        assert!(
            !runtime.states.contains_key("poll"),
            "rejected redeploy must drop the job's runtime state"
        );

        // The stale nominal must not fire: not at the old due time, not on
        // the next tick, not ever.
        for now_ms in [
            ms_at(2026, 7, 2, 3, 30),
            ms_at(2026, 7, 2, 3, 30) + 1_000,
            ms_at(2026, 8, 1, 0, 0),
        ] {
            assert!(
                runtime
                    .claim_due_runs(&invalid, &BTreeSet::new(), now_ms)
                    .is_empty(),
                "validation-rejected job must never be claimed"
            );
        }

        // Redeploying a valid definition recovers normal scheduling: the
        // first pass materializes a fresh future nominal, and the pass after
        // that slot claims it.
        assert!(runtime.reconcile(&valid).is_empty());
        assert!(
            runtime
                .claim_due_runs(&valid, &BTreeSet::new(), ms_at(2026, 8, 2, 4, 0))
                .is_empty()
        );
        let claims = runtime.claim_due_runs(&valid, &BTreeSet::new(), ms_at(2026, 8, 3, 3, 30));
        assert_eq!(claims.len(), 1);
    }

    // ENG-23417 manual door: POST run-now for a validation-rejected job must
    // be refused. Before the fix it created runtime state for any enabled
    // job, permanently arming computable-rejection-class jobs (Backoff
    // retry, sub-floor cadence, everyMs 0, duplicates) for scheduled claims.
    #[test]
    fn manual_run_refuses_validation_rejected_jobs() {
        let mut backoff = interval_job("pollWithBackoff", 60_000);
        backoff.retry_policy = CronRetryPolicy {
            mode: CronRetryMode::Backoff,
        };
        let manifest = manifest_with_jobs(vec![backoff]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);

        let error = runtime
            .claim_manual_run(&manifest, "pollWithBackoff", 600_000)
            .expect_err("validation-rejected job must not be manually runnable");
        assert_eq!(error.diagnostic.code, "SNAPBACK_CRON_JOB_INVALID");
        assert_eq!(
            error
                .diagnostic
                .details
                .get("validationErrors")
                .and_then(Value::as_array)
                .map(|codes| codes.iter().filter_map(Value::as_str).collect::<Vec<_>>()),
            Some(vec!["SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED"])
        );

        // The refusal must not leave claimable runtime state behind.
        assert!(!runtime.states.contains_key("pollWithBackoff"));
        assert!(
            runtime
                .claim_due_runs(&manifest, &BTreeSet::new(), 1_200_000)
                .is_empty()
        );

        // A valid job in the same manifest stays manually runnable.
        let mixed = manifest_with_jobs(vec![
            {
                let mut rejected = interval_job("pollWithBackoff", 60_000);
                rejected.retry_policy = CronRetryPolicy {
                    mode: CronRetryMode::Backoff,
                };
                rejected
            },
            interval_job("poll", 60_000),
        ]);
        runtime.reconcile(&mixed);
        assert!(runtime.claim_manual_run(&mixed, "poll", 600_000).is_ok());
    }

    // ENG-23417 defense in depth: a nominal is only trusted when it was
    // computed for the current definition. Reconcile resets state on any
    // schedule change, so a hash mismatch means the manifest changed without
    // a reconcile — never claim from it.
    #[test]
    fn claim_due_runs_ignores_state_with_stale_schedule_hash() {
        let manifest = manifest_with_jobs(vec![interval_job("poll", 60_000)]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        runtime
            .states
            .get_mut("poll")
            .expect("state exists")
            .schedule_hash = "fnv1a:stale".to_owned();
        assert!(
            runtime
                .claim_due_runs(&manifest, &BTreeSet::new(), 600_000)
                .is_empty(),
            "stale-hash state must not produce claims"
        );
    }

    #[test]
    fn scheduled_claim_consumes_slot_and_allow_tracks_each_active_run() {
        let mut job = interval_job("poll", 60_000);
        job.overlap_policy = CronOverlapPolicy::Allow;
        job.jitter_policy.enabled = false;
        let manifest = manifest_with_jobs(vec![job]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);

        let first = runtime
            .claim_due_runs(&manifest, &BTreeSet::new(), 60_000)
            .pop()
            .expect("first due slot");
        assert!(
            runtime
                .claim_due_runs(&manifest, &BTreeSet::new(), 60_000)
                .is_empty(),
            "a duplicate tick must not claim the same nominal twice"
        );

        let second = runtime
            .claim_due_runs(&manifest, &BTreeSet::new(), 120_000)
            .pop()
            .expect("next due slot may overlap");
        let state = runtime.states.get("poll").expect("poll state");
        assert_eq!(state.in_flight_run_ids.len(), 2);
        assert_ne!(first.metadata.slot_key, second.metadata.slot_key);

        runtime.finish_run(first.clone(), 121_000, Ok(Value::Null));
        let state = runtime.states.get("poll").expect("poll state");
        assert_eq!(state.in_flight_run_ids.len(), 1);
        assert!(state.in_flight_run_ids.contains(&second.metadata.run_id));
        runtime.finish_run(second, 122_000, Ok(Value::Null));
        assert!(!runtime.states["poll"].has_in_flight());
    }

    #[test]
    fn allow_active_run_ownership_is_bounded_for_manual_and_scheduled_claims() {
        let mut job = interval_job("poll", 60_000);
        job.overlap_policy = CronOverlapPolicy::Allow;
        job.jitter_policy.enabled = false;
        let manifest = manifest_with_jobs(vec![job]);

        let mut manual = LocalCronRuntime::default();
        manual.reconcile(&manifest);
        let mut claims = Vec::new();
        for now in 0..CRON_MAX_ACTIVE_RUNS_PER_JOB {
            claims.push(
                manual
                    .claim_manual_run(&manifest, "poll", now as u64)
                    .expect("claim below the active-run ceiling"),
            );
        }
        let error = manual
            .claim_manual_run(&manifest, "poll", 1_000_000)
            .expect_err("manual allow claims must fail at the active-run ceiling");
        assert_eq!(error.diagnostic.code, "SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED");
        assert_eq!(
            manual.states["poll"].in_flight_run_ids.len(),
            CRON_MAX_ACTIVE_RUNS_PER_JOB
        );
        manual.finish_run(claims.remove(0), 1_000_001, Ok(Value::Null));
        assert!(
            manual
                .claim_manual_run(&manifest, "poll", 1_000_002)
                .is_ok(),
            "completion must release active-run capacity"
        );

        let mut scheduled = LocalCronRuntime::default();
        scheduled.reconcile(&manifest);
        for slot in 1..=CRON_MAX_ACTIVE_RUNS_PER_JOB {
            let claims =
                scheduled.claim_due_runs(&manifest, &BTreeSet::new(), slot as u64 * 60_000);
            assert_eq!(claims.len(), 1, "slot {slot} should be claimable");
        }
        assert!(
            scheduled
                .claim_due_runs(
                    &manifest,
                    &BTreeSet::new(),
                    (CRON_MAX_ACTIVE_RUNS_PER_JOB as u64 + 1) * 60_000,
                )
                .is_empty(),
            "the first slot beyond the active-run ceiling must be skipped"
        );
        assert_eq!(
            scheduled.recent_runs.front().and_then(|run| run
                .diagnostic
                .as_ref()
                .map(|diagnostic| diagnostic.code.as_str())),
            Some("SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED")
        );
        assert_eq!(
            scheduled.states["poll"].in_flight_run_ids.len(),
            CRON_MAX_ACTIVE_RUNS_PER_JOB
        );
    }

    // A definition change does not stop a detached worker. NoOverlap is
    // therefore keyed by logical job name, not by schedule generation.
    // @ref LLP 0028#scheduler-state-and-run-ledger — hot replacement carries
    // live ownership forward while generation-specific schedule state resets.
    #[test]
    fn changed_schedule_no_overlap_waits_for_predecessor() {
        let mut original_job = interval_job("poll", 60_000);
        original_job.jitter_policy.enabled = false;
        let original = manifest_with_jobs(vec![original_job]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&original);
        let old_claim = runtime
            .claim_due_runs(&original, &BTreeSet::new(), 60_000)
            .pop()
            .expect("old claim");

        assert!(runtime.reconcile(&original).is_empty());
        assert!(runtime.states["poll"].has_in_flight());
        let error = runtime
            .claim_manual_run(&original, "poll", 61_000)
            .expect_err("same-schedule reload must preserve no-overlap ownership");
        assert_eq!(error.diagnostic.code, "SNAPBACK_CRON_JOB_IN_FLIGHT");

        let mut replacement_job = interval_job("poll", 30_000);
        replacement_job.jitter_policy.enabled = false;
        let replacement = manifest_with_jobs(vec![replacement_job]);
        runtime.reconcile(&replacement);
        assert!(runtime.states["poll"].has_in_flight());
        assert!(
            runtime
                .claim_due_runs(&replacement, &BTreeSet::new(), 60_000)
                .is_empty(),
            "a changed schedule must not overlap its still-running predecessor"
        );
        assert_eq!(
            runtime.recent_runs.front().and_then(|run| run
                .diagnostic
                .as_ref()
                .map(|diagnostic| diagnostic.code.as_str())),
            Some("SNAPBACK_CRON_RUN_SKIPPED_OVERLAP")
        );

        runtime.finish_run(old_claim, 62_000, Ok(Value::Null));
        assert!(!runtime.states["poll"].has_in_flight());
        assert_eq!(
            runtime.states["poll"].last_run_at_ms, None,
            "an old generation must not write the replacement's outcome state"
        );
        let replacement_claim = runtime
            .claim_due_runs(&replacement, &BTreeSet::new(), 90_000)
            .pop()
            .expect("replacement may run after predecessor completion");
        runtime.finish_run(replacement_claim, 91_000, Ok(Value::Null));
        assert_eq!(runtime.states["poll"].last_run_at_ms, Some(91_000));
    }

    #[test]
    fn definition_generation_prevents_reload_aba_outcome_clobber() {
        let mut original_job = interval_job("poll", 60_000);
        original_job.overlap_policy = CronOverlapPolicy::Allow;
        original_job.jitter_policy.enabled = false;
        let original = manifest_with_jobs(vec![original_job]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&original);
        let old_claim = runtime
            .claim_due_runs(&original, &BTreeSet::new(), 60_000)
            .pop()
            .expect("old claim");

        let mut replacement_job = interval_job("poll", 30_000);
        replacement_job.overlap_policy = CronOverlapPolicy::Allow;
        replacement_job.jitter_policy.enabled = false;
        let replacement = manifest_with_jobs(vec![replacement_job]);
        runtime.reconcile(&replacement);
        runtime.reconcile(&original);
        let current_claim = runtime
            .claim_due_runs(&original, &BTreeSet::new(), 60_000)
            .pop()
            .expect("restored definition claim");
        assert_eq!(
            schedule_hash(&old_claim.job),
            schedule_hash(&current_claim.job),
            "the regression requires the definition hash to return to A"
        );
        assert_ne!(
            old_claim.definition_generation, current_claim.definition_generation,
            "definition generations must distinguish an A -> B -> A reload"
        );
        assert!(
            runtime.states["poll"]
                .in_flight_run_ids
                .contains(&old_claim.metadata.run_id),
            "the restored definition must retain predecessor ownership"
        );

        let current_failure = Diagnostic::error(
            "SNAPBACK_TEST_REPLACEMENT_FAILED",
            "cron",
            "replacement failed",
        );
        runtime.finish_run(current_claim, 63_000, Err(current_failure.clone()));
        assert_eq!(runtime.states["poll"].last_run_at_ms, Some(63_000));
        assert_eq!(
            runtime.states["poll"].last_outcome,
            Some(CronRunOutcome::Failed)
        );
        assert_eq!(runtime.states["poll"].last_error, Some(current_failure));

        runtime.finish_run(old_claim, 64_000, Ok(Value::Null));
        assert!(!runtime.states["poll"].has_in_flight());
        assert_eq!(
            runtime.states["poll"].last_run_at_ms,
            Some(63_000),
            "old completion must not replace the current generation summary"
        );
        assert_eq!(
            runtime.states["poll"].last_outcome,
            Some(CronRunOutcome::Failed)
        );
        assert_eq!(runtime.states["poll"].consecutive_failures, 1);
    }

    #[test]
    fn definition_generation_allocates_portable_max_then_refuses_reconcile_without_replacement() {
        let original = manifest_with_jobs(vec![interval_job("poll", 60_000)]);
        let mut runtime = LocalCronRuntime {
            next_definition_generation: PORTABLE_STORAGE_VERSION_MAX - 1,
            ..LocalCronRuntime::default()
        };
        assert!(runtime.reconcile(&original).is_empty());
        assert_eq!(
            runtime.states["poll"].definition_generation,
            PORTABLE_STORAGE_VERSION_MAX
        );

        // Same-definition reconciliation needs no new identity and remains
        // usable at the terminal generation.
        assert!(runtime.reconcile(&original).is_empty());

        let replacement = manifest_with_jobs(vec![interval_job("poll", 30_000)]);
        let predecessor = runtime.states["poll"].clone();
        let diagnostics = runtime.reconcile(&replacement);
        assert!(diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "SNAPBACK_CRON_DEFINITION_GENERATION_EXHAUSTED"
        }));
        assert_eq!(
            runtime.next_definition_generation,
            PORTABLE_STORAGE_VERSION_MAX
        );
        assert_eq!(runtime.states["poll"], predecessor);
        assert!(
            runtime
                .claim_due_runs(&replacement, &BTreeSet::new(), 60_000)
                .is_empty(),
            "the retained predecessor hash must not execute under the replacement manifest"
        );
    }

    #[test]
    fn scheduled_run_sequence_allocates_portable_max_then_refuses_before_nominal_or_ownership() {
        let mut job = interval_job("poll", 60_000);
        job.overlap_policy = CronOverlapPolicy::Allow;
        job.jitter_policy.enabled = false;
        let manifest = manifest_with_jobs(vec![job]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        runtime.next_run_seq = PORTABLE_STORAGE_VERSION_MAX - 1;

        let final_claim = runtime
            .claim_due_runs(&manifest, &BTreeSet::new(), 60_000)
            .pop()
            .expect("the final portable run sequence is allocatable");
        assert!(
            final_claim
                .metadata
                .run_id
                .ends_with(&format!(":{PORTABLE_STORAGE_VERSION_MAX}"))
        );
        let predecessor = runtime.states["poll"].clone();
        let recent_runs = runtime.recent_runs.clone();

        assert!(
            runtime
                .claim_due_runs(&manifest, &BTreeSet::new(), 120_000)
                .is_empty()
        );
        assert_eq!(runtime.next_run_seq, PORTABLE_STORAGE_VERSION_MAX);
        assert_eq!(runtime.states["poll"], predecessor);
        assert_eq!(runtime.recent_runs, recent_runs);
        assert!(runtime.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED"
                && diagnostic.details["trigger"] == "scheduled"
        }));
    }

    #[test]
    fn skipped_run_sequence_exhaustion_does_not_consume_the_nominal_slot() {
        let mut job = interval_job("poll", 60_000);
        job.jitter_policy.enabled = false;
        let manifest = manifest_with_jobs(vec![job]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        let _in_flight = runtime
            .claim_due_runs(&manifest, &BTreeSet::new(), 60_000)
            .pop()
            .expect("the first scheduled run owns the overlap slot");
        runtime.next_run_seq = PORTABLE_STORAGE_VERSION_MAX - 1;
        assert!(
            runtime
                .claim_due_runs(&manifest, &BTreeSet::new(), 120_000)
                .is_empty(),
            "an overlap skip returns no executable claim"
        );
        assert_eq!(runtime.next_run_seq, PORTABLE_STORAGE_VERSION_MAX);
        assert!(
            runtime.recent_runs.front().is_some_and(|record| record
                .run_id
                .ends_with(&format!(":{PORTABLE_STORAGE_VERSION_MAX}"))),
            "the final portable sequence may identify one skipped record"
        );
        let predecessor = runtime.states["poll"].clone();
        let recent_runs = runtime.recent_runs.clone();

        assert!(
            runtime
                .claim_due_runs(&manifest, &BTreeSet::new(), 180_000)
                .is_empty(),
            "an overlap skip still requires a unique run-record identity"
        );
        assert_eq!(runtime.states["poll"], predecessor);
        assert_eq!(runtime.recent_runs, recent_runs);
        assert!(runtime.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED"
                && diagnostic.details["trigger"] == "skipped"
        }));
    }

    #[test]
    fn manual_run_sequence_allocates_portable_max_then_refuses_without_ownership() {
        let mut job = interval_job("poll", 60_000);
        job.overlap_policy = CronOverlapPolicy::Allow;
        let manifest = manifest_with_jobs(vec![job]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        runtime.next_run_seq = PORTABLE_STORAGE_VERSION_MAX - 1;

        let claim = runtime
            .claim_manual_run(&manifest, "poll", 1_000)
            .expect("the final portable manual run id is allocatable");
        assert!(
            claim
                .metadata
                .run_id
                .ends_with(&format!(":{PORTABLE_STORAGE_VERSION_MAX}"))
        );
        runtime.finish_run(claim, 1_001, Ok(Value::Null));
        let predecessor = runtime.states["poll"].clone();

        let error = runtime
            .claim_manual_run(&manifest, "poll", 2_000)
            .expect_err("manual run ids cannot wrap or leave the portable domain");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED"
        );
        assert_eq!(runtime.states["poll"], predecessor);
        assert_eq!(runtime.next_run_seq, PORTABLE_STORAGE_VERSION_MAX);
    }

    #[test]
    fn manual_run_sequence_exhaustion_never_creates_missing_state() {
        let manifest = manifest_with_jobs(vec![interval_job("poll", 60_000)]);
        let mut runtime = LocalCronRuntime {
            next_run_seq: PORTABLE_STORAGE_VERSION_MAX,
            ..LocalCronRuntime::default()
        };

        let error = runtime
            .claim_manual_run(&manifest, "poll", 1_000)
            .expect_err("manual run ids cannot wrap or leave the portable domain");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED"
        );
        assert!(runtime.states.is_empty());
        assert_eq!(runtime.next_definition_generation, 0);
        assert_eq!(runtime.next_run_seq, PORTABLE_STORAGE_VERSION_MAX);
    }

    #[test]
    fn consecutive_failure_telemetry_saturates_at_the_portable_maximum() {
        let manifest = manifest_with_jobs(vec![interval_job("poll", 60_000)]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        let claim = runtime
            .claim_manual_run(&manifest, "poll", 1_000)
            .expect("manual claim");
        runtime.states.get_mut("poll").unwrap().consecutive_failures = PORTABLE_STORAGE_VERSION_MAX;

        runtime.finish_run(
            claim,
            1_001,
            Err(Diagnostic::error(
                "SNAPBACK_TEST_CRON_FAILED",
                "cron",
                "expected failure",
            )),
        );
        assert_eq!(
            runtime.states["poll"].consecutive_failures,
            PORTABLE_STORAGE_VERSION_MAX
        );
        runtime
            .persisted_value()
            .expect("saturated telemetry remains portable and persistable");
    }

    #[test]
    fn repeated_allow_schedule_reloads_cannot_bypass_active_run_cap() {
        let mut first_job = interval_job("poll", 60_000);
        first_job.overlap_policy = CronOverlapPolicy::Allow;
        first_job.jitter_policy.enabled = false;
        let first_manifest = manifest_with_jobs(vec![first_job]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&first_manifest);
        let mut claims = vec![
            runtime
                .claim_due_runs(&first_manifest, &BTreeSet::new(), 10_000_000)
                .pop()
                .expect("first generation claim"),
        ];

        for generation in 1..CRON_MAX_ACTIVE_RUNS_PER_JOB {
            let mut job = interval_job("poll", 60_000 + generation as u64 * 1_000);
            job.overlap_policy = CronOverlapPolicy::Allow;
            job.jitter_policy.enabled = false;
            let manifest = manifest_with_jobs(vec![job]);
            runtime.reconcile(&manifest);
            claims.push(
                runtime
                    .claim_due_runs(&manifest, &BTreeSet::new(), 10_000_000)
                    .pop()
                    .expect("reload below the logical-job active-run ceiling"),
            );
        }
        assert_eq!(
            runtime.states["poll"].in_flight_run_ids.len(),
            CRON_MAX_ACTIVE_RUNS_PER_JOB
        );

        let mut saturated_job =
            interval_job("poll", 60_000 + CRON_MAX_ACTIVE_RUNS_PER_JOB as u64 * 1_000);
        saturated_job.overlap_policy = CronOverlapPolicy::Allow;
        saturated_job.jitter_policy.enabled = false;
        let saturated = manifest_with_jobs(vec![saturated_job]);
        runtime.reconcile(&saturated);
        assert!(
            runtime
                .claim_due_runs(&saturated, &BTreeSet::new(), 10_000_000)
                .is_empty(),
            "a new definition generation must not reset active-run capacity"
        );
        assert_eq!(
            runtime.recent_runs.front().and_then(|run| run
                .diagnostic
                .as_ref()
                .map(|diagnostic| diagnostic.code.as_str())),
            Some("SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED")
        );
        assert_eq!(
            runtime.states["poll"].in_flight_run_ids.len(),
            CRON_MAX_ACTIVE_RUNS_PER_JOB
        );

        for claim in claims {
            runtime.finish_run(claim, 10_000_001, Ok(Value::Null));
        }
        assert!(
            !runtime.states["poll"].has_in_flight(),
            "old-generation completions must release logical-job capacity"
        );
    }

    #[test]
    fn reset_does_not_reuse_live_run_identity() {
        let mut job = interval_job("poll", 60_000);
        job.overlap_policy = CronOverlapPolicy::Allow;
        job.jitter_policy.enabled = false;
        let manifest = manifest_with_jobs(vec![job]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        let stale = runtime
            .claim_due_runs(&manifest, &BTreeSet::new(), 60_000)
            .pop()
            .expect("pre-reset claim");

        runtime.reset_runtime_state(&manifest);
        let current = runtime
            .claim_due_runs(&manifest, &BTreeSet::new(), 60_000)
            .pop()
            .expect("post-reset claim");
        assert_ne!(stale.metadata.run_id, current.metadata.run_id);
        assert_ne!(stale.definition_generation, current.definition_generation);

        runtime.finish_run(stale, 61_000, Ok(Value::Null));
        assert!(
            runtime.states["poll"]
                .in_flight_run_ids
                .contains(&current.metadata.run_id),
            "a stale pre-reset completion must not release the post-reset run"
        );
    }

    #[test]
    fn persisted_in_flight_runs_are_recovered_only_on_process_load() {
        let manifest = manifest_with_jobs(vec![interval_job("poll", 60_000)]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        // 70s: past the seeded slot (60s) plus the default jitter ceiling
        // (every/10), so the first claim is unambiguously due (0137 a4-f4
        // moved the never-run seed from epoch 0 to the most recent slot).
        let claim = runtime
            .claim_due_runs(&manifest, &BTreeSet::new(), 70_000)
            .pop()
            .expect("claim");
        let persisted = runtime.persisted_value().expect("persist cron state");

        let reloaded = LocalCronRuntime::from_persisted(Some(persisted)).expect("reload state");
        assert!(!reloaded.states["poll"].has_in_flight());
        assert!(reloaded.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "SNAPBACK_CRON_STALE_IN_FLIGHT_CLEARED"
                && diagnostic.details.get("runId").and_then(Value::as_str)
                    == Some(claim.metadata.run_id.as_str())
        }));
    }

    #[test]
    fn while_live_targets_are_validated_and_do_not_arm_invalid_jobs() {
        let mut typo = interval_job("typoDemand", 60_000);
        typo.activation = CronActivationPolicy {
            kind: CronActivationKind::WhileLive,
            while_live: vec!["missingQuery".to_owned()],
        };
        let mut wrong_kind = interval_job("wrongKindDemand", 60_000);
        wrong_kind.activation = CronActivationPolicy {
            kind: CronActivationKind::WhileLive,
            while_live: vec!["refreshAction".to_owned()],
        };
        let manifest = FunctionManifest {
            functions: vec![action_stub("refreshAction"), live_query_stub("listTodos")],
            cron_jobs: vec![typo, wrong_kind],
            ..FunctionManifest::default()
        };

        let diagnostics = validate_cron_manifest(&manifest);
        assert!(
            diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "SNAPBACK_CRON_WHILE_LIVE_MISSING")
        );
        assert!(
            diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "SNAPBACK_CRON_WHILE_LIVE_KIND_MISMATCH")
        );

        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        assert!(
            !runtime.any_armed(&manifest, &BTreeSet::from(["missingQuery".to_owned()])),
            "invalid demand-gated jobs must not arm the ticker"
        );
    }

    #[test]
    fn zero_interval_jobs_fail_closed_without_scheduler_division() {
        let zero = interval_job("zero", 0);
        let manifest = manifest_with_jobs(vec![zero.clone()]);
        let diagnostics = validate_cron_manifest(&manifest);
        assert!(
            diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "SNAPBACK_CRON_INVALID_INTERVAL")
        );
        assert_eq!(next_nominal_after(&zero, Some(0), 1_000), None);

        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        assert!(!runtime.any_armed(&manifest, &BTreeSet::new()));
        assert!(
            runtime
                .claim_due_runs(&manifest, &BTreeSet::new(), 1_000)
                .is_empty()
        );
    }

    #[test]
    fn retained_run_ledger_strips_action_result_payloads() {
        let mut runtime = LocalCronRuntime::default();
        let manifest = manifest_with_jobs(vec![interval_job("poll", 60_000)]);
        runtime.reconcile(&manifest);
        // 70s: past the seeded slot plus the default jitter ceiling (a4-f4).
        let claim = runtime
            .claim_due_runs(&manifest, &BTreeSet::new(), 70_000)
            .pop()
            .expect("claim");

        let returned = runtime.finish_run(
            claim,
            5,
            Ok(json!({ "large": "x".repeat(1024), "keptForCaller": true })),
        );
        assert!(
            returned.result.is_some(),
            "the immediate caller keeps the result"
        );
        assert_eq!(
            runtime.recent_runs.front().expect("ledger record").result,
            None,
            "retained cron history must not keep action payloads"
        );
        let persisted = runtime.persisted_value().expect("persist cron");
        assert!(
            !persisted.to_string().contains("keptForCaller"),
            "persisted cron state must not include stripped result payloads"
        );

        let mut legacy = persisted;
        legacy["recent_runs"][0]["result"] = json!({ "legacy": "payload" });
        // Versionless persisted values are the one supported older shape.
        legacy.as_object_mut().unwrap().remove("version");
        let reloaded = LocalCronRuntime::from_persisted(Some(legacy)).expect("migrate old state");
        assert_eq!(
            reloaded
                .recent_runs
                .front()
                .and_then(|record| record.result.as_ref()),
            None
        );
    }

    #[test]
    fn persisted_cron_state_fails_closed_on_incompatible_shapes() {
        for invalid in [
            json!({
                "version": 999,
                "states": {},
                "recent_runs": [],
                "diagnostics": [],
                "next_run_seq": 0
            }),
            json!({
                "version": 1,
                "states": [],
                "recent_runs": [],
                "diagnostics": [],
                "next_run_seq": 0
            }),
            json!({ "version": 1, "states": {} }),
        ] {
            let error = LocalCronRuntime::from_persisted(Some(invalid))
                .expect_err("incompatible durable state must not become empty state");
            assert_eq!(error.diagnostic.code, "SNAPBACK_CRON_STATE_INVALID");
        }
    }

    #[test]
    fn persisted_cron_state_rejects_nonportable_identity_and_telemetry_counters() {
        let manifest = manifest_with_jobs(vec![interval_job("poll", 60_000)]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        let persisted = runtime.persisted_value().expect("persist valid cron state");

        for field in [
            "next_run_seq",
            "next_definition_generation",
            "states.poll.definition_generation",
            "states.poll.consecutive_failures",
        ] {
            let mut corrupt = persisted.clone();
            let value = serde_json::Number::from(PORTABLE_STORAGE_VERSION_MAX + 1);
            match field {
                "next_run_seq" => corrupt["next_run_seq"] = Value::Number(value),
                "next_definition_generation" => {
                    corrupt["next_definition_generation"] = Value::Number(value)
                }
                "states.poll.definition_generation" => {
                    corrupt["states"]["poll"]["definition_generation"] = Value::Number(value)
                }
                "states.poll.consecutive_failures" => {
                    corrupt["states"]["poll"]["consecutive_failures"] = Value::Number(value)
                }
                _ => unreachable!(),
            }
            let error = LocalCronRuntime::from_persisted(Some(corrupt))
                .expect_err("nonportable durable counters must fail closed");
            assert_eq!(error.diagnostic.code, "SNAPBACK_CRON_STATE_INVALID");
            assert_eq!(
                error.diagnostic.details["field"], field,
                "the operator diagnostic identifies the corrupt counter"
            );
        }
    }

    #[test]
    fn cron_persistence_accepts_the_final_portable_counter_values() {
        let manifest = manifest_with_jobs(vec![interval_job("poll", 60_000)]);
        let mut runtime = LocalCronRuntime::default();
        runtime.reconcile(&manifest);
        runtime.next_run_seq = PORTABLE_STORAGE_VERSION_MAX;
        runtime.next_definition_generation = PORTABLE_STORAGE_VERSION_MAX;
        let state = runtime.states.get_mut("poll").unwrap();
        state.definition_generation = PORTABLE_STORAGE_VERSION_MAX;
        state.consecutive_failures = PORTABLE_STORAGE_VERSION_MAX;

        let persisted = runtime
            .persisted_value()
            .expect("portable maximum persists");
        let reloaded = LocalCronRuntime::from_persisted(Some(persisted))
            .expect("portable maximum reloads exactly");
        assert_eq!(reloaded.next_run_seq, PORTABLE_STORAGE_VERSION_MAX);
        assert_eq!(
            reloaded.next_definition_generation,
            PORTABLE_STORAGE_VERSION_MAX
        );
        assert_eq!(
            reloaded.states["poll"].definition_generation,
            PORTABLE_STORAGE_VERSION_MAX
        );
        assert_eq!(
            reloaded.states["poll"].consecutive_failures,
            PORTABLE_STORAGE_VERSION_MAX
        );
    }

    #[test]
    fn cron_persistence_refuses_an_internal_nonportable_counter() {
        let runtime = LocalCronRuntime {
            next_run_seq: PORTABLE_STORAGE_VERSION_MAX + 1,
            ..LocalCronRuntime::default()
        };
        let error = runtime
            .persisted_value()
            .expect_err("nonportable in-memory counters must not reach disk");
        assert_eq!(error.diagnostic.code, "SNAPBACK_CRON_STATE_INVALID");
        assert_eq!(error.diagnostic.details["field"], "next_run_seq");
    }

    #[test]
    fn civil_date_math_round_trips() {
        // Anchors: the Unix epoch was Thursday 1970-01-01; 2000-01-01 is
        // day 10,957 (946684800 / 86400).
        assert_eq!(civil_from_days(0), Some((1970, 1, 1)));
        assert_eq!(days_from_civil(2000, 1, 1), 10_957);
        assert_eq!(civil_from_days(10_957), Some((2000, 1, 1)));

        for (year, month, day) in [
            (1999, 12, 31),
            (2000, 1, 1),
            (2000, 2, 29),
            (2024, 2, 29),
            (2026, 7, 2),
            (2100, 2, 28),
            (2100, 3, 1),
            (2400, 2, 29),
        ] {
            assert_eq!(
                civil_from_days(days_from_civil(year, month, day)),
                Some((year as i32, month, day)),
                "round-trip failed for {year}-{month:02}-{day:02}"
            );
        }

        // Century rules: 2000 is a leap year (divisible by 400), 2100 is not.
        assert_eq!(
            civil_from_days(days_from_civil(2000, 2, 28) + 1),
            Some((2000, 2, 29))
        );
        assert_eq!(
            civil_from_days(days_from_civil(2100, 2, 28) + 1),
            Some((2100, 3, 1))
        );

        // utc_parts decomposes a timestamp into the fields cron matches on;
        // 2026-02-13 14:45 UTC is a Friday (weekday 5, Sunday = 0).
        let parts = utc_parts(ms_at(2026, 2, 13, 14, 45)).expect("representable time");
        assert_eq!(
            (
                parts.minute,
                parts.hour,
                parts.day,
                parts.month,
                parts.weekday
            ),
            (45, 14, 13, 2, 5)
        );
    }
}
