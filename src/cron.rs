use crate::diagnostic::{Diagnostic, DiagnosticSeverity, SnapbackError, SnapbackResult};
use crate::manifest::{
    CronActivationKind, CronJitterPolicy, CronJobDefinition, CronOverlapPolicy, CronRetryMode,
    CronSchedule, FunctionKind, FunctionManifest, SNAPBACK_SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const MAX_RECENT_RUNS: usize = 50;
const LOCAL_MIN_INTERVAL_MS: u64 = 1_000;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
    pub consecutive_failures: u64,
    #[serde(rename = "recentRuns")]
    pub recent_runs: Vec<CronRunRecord>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CronActivationState {
    Armed,
    InactiveNoDemand,
    Disabled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CronRunTrigger {
    Scheduled,
    Manual,
    Recovery,
    DemandCatchUp,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CronRunOutcome {
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug)]
pub struct CronRunClaim {
    pub job: CronJobDefinition,
    pub metadata: CronRunMetadata,
    pub started_at_ms: u64,
}

/// @ref LLP 0028#scheduler-state-and-run-ledger — cron definitions are source
/// authored, while next/last/in-flight/history state is runtime-owned.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct LocalCronRuntime {
    states: BTreeMap<String, CronJobRuntimeState>,
    recent_runs: VecDeque<CronRunRecord>,
    diagnostics: VecDeque<Diagnostic>,
    next_run_seq: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
struct CronJobRuntimeState {
    schedule_hash: String,
    jitter_seed: String,
    jitter_offset_ms: u64,
    next_nominal_at_ms: Option<u64>,
    next_due_at_ms: Option<u64>,
    in_flight_run_id: Option<String>,
    last_run_at_ms: Option<u64>,
    last_outcome: Option<CronRunOutcome>,
    last_error: Option<Diagnostic>,
    consecutive_failures: u64,
}

impl LocalCronRuntime {
    pub fn from_persisted(value: Option<Value>) -> Self {
        let Some(value) = value else {
            return Self::default();
        };
        serde_json::from_value(value).unwrap_or_default()
    }

    pub fn persisted_value(&self) -> SnapbackResult<Value> {
        serde_json::to_value(self).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CRON_STATE_SERIALIZE_FAILED",
                "cron",
                "cron runtime state could not be serialized",
            )
            .with_details(json!({ "error": error.to_string() }))
        })
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
            job.enabled
                && activation_state(job, active_live_functions) == CronActivationState::Armed
        })
    }

    pub fn reconcile(&mut self, manifest: &FunctionManifest) -> Vec<Diagnostic> {
        let diagnostics = validate_cron_manifest(manifest);
        let mut recovery_diagnostics = Vec::new();
        let job_names = manifest
            .cron_jobs
            .iter()
            .map(|job| job.name.clone())
            .collect::<BTreeSet<_>>();
        self.states
            .retain(|job_name, _state| job_names.contains(job_name));

        for job in &manifest.cron_jobs {
            if diagnostics.iter().any(|diagnostic| {
                diagnostic.severity == DiagnosticSeverity::Error
                    && diagnostic.details.get("jobName").and_then(Value::as_str)
                        == Some(job.name.as_str())
            }) {
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
            match self.states.get_mut(&job.name) {
                Some(state) if state.schedule_hash == schedule_hash => {
                    state.jitter_seed = jitter_seed;
                    state.jitter_offset_ms = jitter_offset_ms;
                    if let Some(run_id) = state.in_flight_run_id.take() {
                        recovery_diagnostics.push(
                            Diagnostic::warning(
                                "SNAPBACK_CRON_STALE_IN_FLIGHT_CLEARED",
                                "cron",
                                format!(
                                    "cron job {} had stale in-flight run state and was recovered",
                                    job.name
                                ),
                            )
                            .with_details(json!({ "jobName": job.name, "runId": run_id })),
                        );
                    }
                    if let Some(nominal) = state.next_nominal_at_ms {
                        state.next_due_at_ms = Some(nominal.saturating_add(jitter_offset_ms));
                    }
                }
                _ => {
                    self.states.insert(
                        job.name.clone(),
                        CronJobRuntimeState {
                            schedule_hash,
                            jitter_seed,
                            jitter_offset_ms,
                            next_nominal_at_ms: None,
                            next_due_at_ms: None,
                            in_flight_run_id: None,
                            last_run_at_ms: None,
                            last_outcome: None,
                            last_error: None,
                            consecutive_failures: 0,
                        },
                    );
                }
            }
        }
        let mut all_diagnostics = diagnostics.clone();
        all_diagnostics.extend(recovery_diagnostics);
        self.record_diagnostics(all_diagnostics.clone());
        all_diagnostics
    }

    pub fn reset_runtime_state(&mut self, manifest: &FunctionManifest) {
        self.states.clear();
        self.recent_runs.clear();
        self.diagnostics.clear();
        self.next_run_seq = 0;
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
                    jitter_seed: seed.clone(),
                    jitter_offset_ms: jitter_offset(job, &hash, &seed),
                    next_nominal_at_ms: None,
                    next_due_at_ms: None,
                    in_flight_run_id: None,
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
        let mut claims = Vec::new();
        for job in &manifest.cron_jobs {
            let Some(state) = self.states.get_mut(&job.name) else {
                continue;
            };
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
            if matches!(job.overlap_policy, CronOverlapPolicy::NoOverlap)
                && state.in_flight_run_id.is_some()
            {
                if let Some(next_nominal) = next_nominal_after(job, scheduled_at_ms, now_ms) {
                    state.next_nominal_at_ms = Some(next_nominal);
                    state.next_due_at_ms =
                        Some(next_nominal.saturating_add(state.jitter_offset_ms));
                }
                let record = self.skipped_record(job, scheduled_at_ms, due_at_ms, now_ms);
                self.record_run(record);
                continue;
            }
            self.next_run_seq += 1;
            let run_id = format!(
                "cron:{}:scheduled:{}:{}",
                job.name,
                scheduled_at_ms.unwrap_or(now_ms),
                self.next_run_seq
            );
            state.in_flight_run_id = Some(run_id.clone());
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
            });
        }
        claims
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
        let state = self.states.entry(job.name.clone()).or_insert_with(|| {
            let hash = schedule_hash(&job);
            let seed = format!("fnv1a:{:016x}", stable_hash(&hash));
            CronJobRuntimeState {
                schedule_hash: hash.clone(),
                jitter_seed: seed.clone(),
                jitter_offset_ms: jitter_offset(&job, &hash, &seed),
                next_nominal_at_ms: None,
                next_due_at_ms: None,
                in_flight_run_id: None,
                last_run_at_ms: None,
                last_outcome: None,
                last_error: None,
                consecutive_failures: 0,
            }
        });
        if matches!(job.overlap_policy, CronOverlapPolicy::NoOverlap)
            && state.in_flight_run_id.is_some()
        {
            return Err(SnapbackError::error(
                "SNAPBACK_CRON_JOB_IN_FLIGHT",
                "cron",
                format!("cron job {name} already has a run in flight"),
            ));
        }
        self.next_run_seq += 1;
        let run_id = format!("cron:{}:manual:{}:{}", job.name, now_ms, self.next_run_seq);
        state.in_flight_run_id = Some(run_id.clone());
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
            state.in_flight_run_id = None;
            state.last_run_at_ms = Some(finished_at_ms);
            state.last_outcome = Some(outcome.clone());
            state.last_error = diagnostic.clone();
            if outcome == CronRunOutcome::Failed {
                state.consecutive_failures += 1;
            } else {
                state.consecutive_failures = 0;
            }
            if claim.metadata.trigger == CronRunTrigger::Scheduled {
                if let Some(next_nominal) =
                    next_nominal_after(&claim.job, claim.metadata.scheduled_at_ms, finished_at_ms)
                {
                    state.next_nominal_at_ms = Some(next_nominal);
                    state.next_due_at_ms =
                        Some(next_nominal.saturating_add(state.jitter_offset_ms));
                }
            }
        }
        self.record_run(record.clone());
        record
    }

    fn skipped_record(
        &mut self,
        job: &CronJobDefinition,
        scheduled_at_ms: Option<u64>,
        due_at_ms: u64,
        now_ms: u64,
    ) -> CronRunRecord {
        self.next_run_seq += 1;
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
                self.next_run_seq
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
            diagnostic: Some(Diagnostic::warning(
                "SNAPBACK_CRON_RUN_SKIPPED_OVERLAP",
                "cron",
                format!(
                    "cron job {} skipped because a prior run is still in flight",
                    job.name
                ),
            )),
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
    }
    diagnostics
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
    if job.schedule.every_ms.is_some() {
        // @ref LLP 0028#inspection-and-query-surface — interval nominals
        // anchor at epoch 0 so "every 1m" means whole-minute boundaries; the
        // anchor reads as "due at the next tick" and surfaces in inspect, so
        // display layers must not render it as a wall-clock date.
        Some(0)
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
        let previous = previous_nominal_at_ms.unwrap_or(0);
        if previous > now_ms {
            return Some(previous);
        }
        let missed = now_ms.saturating_sub(previous) / every_ms + 1;
        return Some(previous.saturating_add(missed.saturating_mul(every_ms)));
    }
    next_calendar_nominal_after(job, previous_nominal_at_ms, now_ms)
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
    let floor = previous_nominal_at_ms.unwrap_or(now_ms);
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
    stable_hash(&format!("{}\0{}\0{}", job.name, schedule_hash, seed)) % (policy.max_offset_ms + 1)
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

fn civil_from_days(days_since_epoch: i64) -> Option<(i32, u32, u32)> {
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
            .filter(|candidate| (candidate - min) % step == 0)
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
    fn matches_at(spec: &CronExpr, year: i64, month: u32, day: u32, hour: u32, minute: u32) -> bool {
        let parts = utc_parts(ms_at(year, month, day, hour, minute)).expect("representable time");
        spec.matches(parts.minute, parts.hour, parts.day, parts.month, parts.weekday)
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
        let claims =
            runtime.claim_due_runs(&manifest, &BTreeSet::new(), ms_at(2026, 7, 1, 0, 0));
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
