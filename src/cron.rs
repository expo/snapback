use crate::diagnostic::{Diagnostic, DiagnosticSeverity, SnapbackError, SnapbackResult};
use crate::manifest::{
    CronActivationKind, CronJitterPolicy, CronJobDefinition, CronOverlapPolicy, CronSchedule,
    FunctionKind, FunctionManifest, SNAPBACK_SCHEMA_VERSION,
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
            (None, Some(expr)) if parse_cron_expr(expr).is_err() => diagnostics.push(cron_error(
                "SNAPBACK_CRON_INVALID_EXPRESSION",
                job,
                format!("cron job {} has an invalid cron expression", job.name),
            )),
            _ => {}
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

fn next_calendar_nominal_after(
    job: &CronJobDefinition,
    previous_nominal_at_ms: Option<u64>,
    now_ms: u64,
) -> Option<u64> {
    let expr = job.schedule.cron.as_deref()?;
    let spec = parse_cron_expr(expr).ok()?;
    let floor = previous_nominal_at_ms.unwrap_or(now_ms);
    let mut candidate = ((floor / 60_000) + 1) * 60_000;
    let deadline = candidate.saturating_add(366 * 24 * 60 * 60 * 1_000);
    while candidate <= deadline {
        let Some(dt) = utc_parts(candidate) else {
            return None;
        };
        if spec.matches(dt.minute, dt.hour, dt.day, dt.month, dt.weekday) {
            return Some(candidate);
        }
        candidate = candidate.saturating_add(60_000);
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
            && self.days.matches(day)
            && self.months.matches(month)
            && self.weekdays.matches(weekday)
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
