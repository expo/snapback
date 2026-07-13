use crate::admin::{AppState, ServerContext};
use crate::cron::{CronRunClaim, CronRunMetadata, CronRunRecord};
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::ephemeral::{
    DeleteRequest, EphemeralCollection, PublishRequest, Scope, SubscribeRequest,
};
use crate::live_wire::{
    LiveSocketClientMessage, LiveSocketServerFrame, Receipt, SubscriptionReceiptEvent,
};
use crate::local::{
    AppActionStage, ConfigVerifyStage, DetachedMutationRead, EphemeralApi, FunctionRunResult,
    InspectState, LiveResumeInput, LiveSubscribeInput, LiveUnsubscribeInput, LocalSnapback,
    StagedAction, StagedAppAction, StagedConfigVerify, StagedNestedMutation,
};
use crate::manifest::{
    AuthInput, CtxAnswerLedger, FunctionManifest, FunctionRuntime, HandlerInput,
    MutationAcknowledgementRequest, MutationAcknowledgementResponse, MutationOutput,
    MutationRequest, SchemaManifest, SeedData,
};
use crate::runtime::{CapabilityState, IbexActionHost};
use axum::extract::rejection::{BytesRejection, JsonRejection};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{
    Json, Router,
    body::{Body, Bytes},
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinHandle;
use tokio::time::{Duration, interval};
use uuid::Uuid;

pub type SharedSnapback = Arc<Mutex<LocalSnapback>>;

static DETACHED_ACTION_WORKERS: AtomicUsize = AtomicUsize::new(0);
static DETACHED_ACTION_REJECTIONS: AtomicU64 = AtomicU64::new(0);
static DETACHED_ACTION_LIMITER: OnceLock<DetachedActionLimiter> = OnceLock::new();

const ACTION_WORKER_LIMIT_DEFAULT: usize = 32;
const ACTION_WORKER_LIMIT_MAX: usize = 1_024;
const CRON_DISPATCH_CONCURRENCY_DEFAULT: usize = 8;
const CRON_DISPATCH_CONCURRENCY_MAX: usize = 1_024;

struct DetachedActionLimiter {
    semaphore: Arc<Semaphore>,
    limit: usize,
}

/// Diagnostic/test visibility for the bounded-action worker invariant. A
/// timed-out action must interrupt its VM and return this count to baseline;
/// otherwise repeated hostile handlers would accumulate live CPU threads.
#[doc(hidden)]
pub fn detached_action_worker_count() -> usize {
    DETACHED_ACTION_WORKERS.load(Ordering::SeqCst)
}

/// Process-wide ceiling for detached native action workers. This is an
/// admission boundary, not merely a metric: once every permit is held, new
/// detached actions fail with a stable overload diagnostic instead of
/// allocating another OS thread.
#[doc(hidden)]
pub fn detached_action_worker_limit() -> usize {
    detached_action_limiter().limit
}

/// Workers admitted by the process-wide semaphore, including a worker that
/// has reserved capacity but has not entered its native execution thread yet.
#[doc(hidden)]
pub fn detached_action_admitted_count() -> usize {
    let limiter = detached_action_limiter();
    limiter
        .limit
        .saturating_sub(limiter.semaphore.available_permits())
}

#[doc(hidden)]
pub fn detached_action_rejection_count() -> u64 {
    DETACHED_ACTION_REJECTIONS.load(Ordering::SeqCst)
}

fn configured_action_worker_limit(raw: Option<&str>) -> usize {
    raw.and_then(|value| value.parse::<usize>().ok())
        .filter(|limit| *limit > 0)
        .map(|limit| limit.min(ACTION_WORKER_LIMIT_MAX))
        .unwrap_or(ACTION_WORKER_LIMIT_DEFAULT)
}

fn configured_cron_dispatch_concurrency(raw: Option<&str>) -> usize {
    raw.and_then(|value| value.parse::<usize>().ok())
        .filter(|limit| *limit > 0)
        .map(|limit| limit.min(CRON_DISPATCH_CONCURRENCY_MAX))
        .unwrap_or(CRON_DISPATCH_CONCURRENCY_DEFAULT)
}

fn detached_action_limiter() -> &'static DetachedActionLimiter {
    DETACHED_ACTION_LIMITER.get_or_init(|| {
        let limit = configured_action_worker_limit(
            std::env::var("SNAPBACK_ACTION_MAX_CONCURRENCY")
                .ok()
                .as_deref(),
        );
        DetachedActionLimiter {
            semaphore: Arc::new(Semaphore::new(limit)),
            limit,
        }
    })
}

#[derive(Clone, Copy)]
struct DetachedActionWorkerCounters {
    active: &'static AtomicUsize,
    rejections: &'static AtomicU64,
}

fn global_detached_action_worker_counters() -> DetachedActionWorkerCounters {
    DetachedActionWorkerCounters {
        active: &DETACHED_ACTION_WORKERS,
        rejections: &DETACHED_ACTION_REJECTIONS,
    }
}

#[cfg(test)]
fn reserve_detached_action_worker(
    limiter: Arc<Semaphore>,
    limit: usize,
) -> SnapbackResult<OwnedSemaphorePermit> {
    reserve_detached_action_worker_with_counters(
        limiter,
        limit,
        global_detached_action_worker_counters(),
    )
}

fn reserve_detached_action_worker_with_counters(
    limiter: Arc<Semaphore>,
    limit: usize,
    counters: DetachedActionWorkerCounters,
) -> SnapbackResult<OwnedSemaphorePermit> {
    limiter.try_acquire_owned().map_err(|_| {
        counters.rejections.fetch_add(1, Ordering::SeqCst);
        SnapbackError::error(
            "SNAPBACK_ACTION_CAPACITY_EXCEEDED",
            "runtime",
            format!(
                "all {limit} detached action worker slots are busy; retry after an action finishes"
            ),
        )
        .with_details(json!({
            "activeWorkers": counters.active.load(Ordering::SeqCst),
            "workerLimit": limit,
        }))
    })
}

struct DetachedActionWorkerGuard {
    active: &'static AtomicUsize,
}

impl DetachedActionWorkerGuard {
    fn enter(counters: DetachedActionWorkerCounters) -> Self {
        counters.active.fetch_add(1, Ordering::SeqCst);
        Self {
            active: counters.active,
        }
    }
}

impl Drop for DetachedActionWorkerGuard {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::SeqCst);
    }
}

fn spawn_detached_action_worker<T, R, F, Complete>(
    permit: OwnedSemaphorePermit,
    counters: DetachedActionWorkerCounters,
    task: F,
    complete: Complete,
) -> std::io::Result<std::thread::JoinHandle<R>>
where
    T: Send + 'static,
    R: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
    Complete: FnOnce(T) -> R + Send + 'static,
{
    std::thread::Builder::new()
        .name("snapback-action".to_owned())
        .spawn(move || {
            // Both guards live in the native thread. In particular, an outer
            // watchdog returning cannot release admission for a native call
            // that has not actually unwound yet.
            let result = {
                let _worker_permit = permit;
                let _worker = DetachedActionWorkerGuard::enter(counters);
                task()
            };
            // Publication runs only after actual native teardown and permit
            // release. A completed response therefore never races a stale
            // worker count or spuriously leaves capacity exhausted.
            complete(result)
        })
}

/// Run write-lane work against the instance without blocking a tokio worker.
///
/// Waiting for the global mutex stays async (`lock_owned` — queued callers
/// burn no thread); only actual execution occupies a blocking-pool thread,
/// with the owned guard moved into the closure. Every server path that can
/// reach Hermes eval or rusqlite goes through here (or the read lane), which
/// is what keeps the exec-guard assertion true. Ephemeral operations and
/// outbox drains no longer take this mutex at all (LLP 0032 L9 — they go to
/// the internally synchronized `EphemeralApi`); disconnect still locks
/// inline because it tears down durable subscriptions, which is memory-only.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L7.
pub(crate) async fn with_snapback<T, F>(state: &SharedSnapback, work: F) -> T
where
    F: FnOnce(&mut LocalSnapback) -> T + Send + 'static,
    T: Send + 'static,
{
    let mut guard = state.clone().lock_owned().await;
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        work(&mut guard)
    })
    .await
    .expect("snapback blocking task panicked")
}

/// Run read-lane work (no global mutex) on a blocking-pool thread: the lane
/// still evals Hermes and reads SQLite, so it must not occupy a tokio worker.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6+L7.
pub(crate) async fn with_read_lane<T, F>(read: &crate::local::ReadLane, work: F) -> T
where
    F: FnOnce(&crate::local::ReadLane) -> T + Send + 'static,
    T: Send + 'static,
{
    let read = read.clone();
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        work(&read)
    })
    .await
    .expect("read-lane blocking task panicked")
}

/// Default coarse wall-clock watchdog for detached Ibex actions (ENG-23324):
/// the watchdog fires after this long even when the action's VM thread is
/// stuck inside a hung outbound fetch. Publishing the timeout may then wait
/// through the bounded interrupt-teardown grace below.
const ACTION_WATCHDOG_DEFAULT_MS: u64 = 30_000;
/// Local actions may raise the default for slow external APIs, but a malformed
/// environment value must not create an unrepresentable `Instant` or an
/// effectively unbounded worker lifetime.
const ACTION_WATCHDOG_MAX_MS: u64 = 15 * 60 * 1_000;
/// Bounded grace for Hermes async-break teardown after the public deadline.
/// Six simultaneous outer+nested VMs can need more than 500ms to unwind on a
/// saturated 2-core runner. Two seconds preserves pre-publication teardown for
/// CPU-bound JavaScript while keeping the native-host fallback finite.
const ACTION_INTERRUPT_GRACE_MS: u64 = 2_000;
const ACTION_LOCK_POLL_MS: u64 = 5;

fn action_watchdog_timeout_ms() -> u64 {
    parse_action_watchdog_timeout(std::env::var("SNAPBACK_ACTION_TIMEOUT_MS").ok().as_deref())
}

fn parse_action_watchdog_timeout(raw: Option<&str>) -> u64 {
    raw.and_then(|value| value.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .map(|ms| ms.min(ACTION_WATCHDOG_MAX_MS))
        .unwrap_or(ACTION_WATCHDOG_DEFAULT_MS)
}

/// The action host for detached (off-mutex) Ibex action runs. Raw action
/// `ctx.db` operations are rejected before host dispatch; the trait's read
/// methods retain a short-lock defense in depth. Ibex mutations execute into
/// an owned effect buffer against an isolated read view. Instance/gate
/// acquisition is deadline-aware; HostPlan and buffered-write iteration poll
/// lifecycle outside the independent gate, which is returned only for final
/// SQLite commit. The gate linearizes that commit with watchdog abandonment,
/// so a mutation either commits before abandonment or is discarded — never
/// after the caller was told the action failed.
///
/// @ref LLP 0028#execution-the-action-class — ENG-23324: actions no longer
/// hold the global write mutex for the duration of the run.
struct DetachedActionHost {
    state: SharedSnapback,
    abandoned: Arc<AtomicBool>,
    commit_gate: Arc<StdMutex<()>>,
    deadline: Instant,
    app_generation: u64,
    app_generation_fence: Arc<AtomicU64>,
}

impl DetachedActionHost {
    fn validate_live(&self, op: &str) -> SnapbackResult<()> {
        if self.abandoned.load(Ordering::SeqCst) {
            return Err(action_abandoned(op));
        }
        let current_generation = self.app_generation_fence.load(Ordering::SeqCst);
        if current_generation != self.app_generation {
            return Err(action_generation_conflict(
                op,
                self.app_generation,
                current_generation,
            ));
        }
        if Instant::now() >= self.deadline {
            return Err(action_deadline_elapsed(op));
        }
        Ok(())
    }

    fn lock_live(&self, op: &str) -> SnapbackResult<tokio::sync::OwnedMutexGuard<LocalSnapback>> {
        loop {
            self.validate_live(op)?;
            if let Ok(guard) = self.state.clone().try_lock_owned() {
                // Abandonment, deadline, or generation can advance between the
                // optimistic check and lock acquisition. Recheck before using
                // any instance authority.
                self.validate_live(op)?;
                let current_generation = guard.app_generation();
                if current_generation != self.app_generation {
                    return Err(action_generation_conflict(
                        op,
                        self.app_generation,
                        current_generation,
                    ));
                }
                return Ok(guard);
            }

            let remaining = self.deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(action_deadline_elapsed(op));
            }
            // Never park while holding the commit gate or instance mutex. The
            // watchdog can therefore mark abandonment independently, and this
            // worker observes it within one short polling interval.
            std::thread::park_timeout(remaining.min(Duration::from_millis(ACTION_LOCK_POLL_MS)));
        }
    }

    fn lock_commit_live(&self, op: &str) -> SnapbackResult<std::sync::MutexGuard<'_, ()>> {
        loop {
            self.validate_live(op)?;
            let guard = match self.commit_gate.try_lock() {
                Ok(guard) => Some(guard),
                Err(std::sync::TryLockError::Poisoned(poisoned)) => Some(poisoned.into_inner()),
                Err(std::sync::TryLockError::WouldBlock) => None,
            };
            if let Some(guard) = guard {
                self.validate_live(op)?;
                return Ok(guard);
            }

            let remaining = self.deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(action_deadline_elapsed(op));
            }
            std::thread::park_timeout(remaining.min(Duration::from_millis(ACTION_LOCK_POLL_MS)));
        }
    }
}

impl IbexActionHost for DetachedActionHost {
    fn validate_host_call(&mut self, op: &str) -> SnapbackResult<()> {
        // This atomic generation fence keeps ordinary runtime/id/log calls off
        // the global instance mutex. A mutation rechecks while holding that
        // mutex, and detached mutation commit retains its own generation bind.
        self.validate_live(op)
    }

    fn run_mutation(&mut self, name: &str, input: HandlerInput) -> SnapbackResult<MutationOutput> {
        let mut snapback = self.lock_live("runMutation")?;
        match snapback.stage_nested_mutation(name, &input)? {
            StagedNestedMutation::InLock => snapback.invoke_host_plan_mutation_guarded(
                name,
                input,
                || self.validate_live("runMutation"),
                || self.lock_commit_live("runMutation"),
            ),
            StagedNestedMutation::Detached(staged) => {
                drop(snapback);
                let module = match &staged.binding.function.runtime {
                    FunctionRuntime::IbexModule(module) => module,
                    _ => unreachable!("detached nested mutation must be an Ibex module"),
                };
                let executed = match staged.read {
                    DetachedMutationRead::Lane(read) => read.execute_detached_ibex_mutation(
                        module,
                        input.clone(),
                        &staged.binding.schema,
                        self.deadline,
                    )?,
                    DetachedMutationRead::Snapshot(db) => crate::runtime::execute_ibex_mutation(
                        module,
                        input.clone(),
                        crate::storage::DbRead::Live(db.as_ref()),
                        None,
                        Some(self.deadline),
                    )?,
                };

                // Acquire the instance before the independent commit gate. A
                // wedged writer cannot strand this action worker: lock_live
                // polls abandonment/deadline without holding either lock. If
                // this call gets the gate first, the watchdog waits only for
                // the bounded validation/SQLite commit (ENG-24340).
                let mut snapback = self.lock_live("runMutation")?;
                snapback.commit_detached_ibex_mutation_guarded(
                    name,
                    input,
                    staged.binding,
                    executed,
                    || self.validate_live("runMutation"),
                    || self.lock_commit_live("runMutation"),
                )
            }
        }
    }
}

fn action_abandoned(op: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ACTION_TIMEOUT",
        "runtime",
        format!("ctx.{op} rejected: the action exceeded its wall-clock watchdog and was abandoned"),
    )
}

fn action_deadline_elapsed(op: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ACTION_TIMEOUT",
        "runtime",
        format!(
            "ctx.{op} rejected: the action exceeded its wall-clock execution deadline before the host operation could complete"
        ),
    )
}

fn action_generation_conflict(op: &str, staged: u64, current: u64) -> SnapbackError {
    // @ref LLP 0028#execution-the-action-class — the outer detached action and
    // every host call retain the staging-time code/schema/reset authority.
    SnapbackError::error(
        "SNAPBACK_ACTION_GENERATION_CONFLICT",
        "runtime",
        format!(
            "ctx.{op} rejected: app code, schema, or state reset changed while the action was running"
        ),
    )
    .with_details(json!({
        "stagedAppGeneration": staged,
        "currentAppGeneration": current,
    }))
}

/// Run a staged Ibex action on a detached thread under a wall-clock watchdog.
///
/// The action holds no instance lock while it runs; nested Ibex handlers also
/// execute outside it, so a hung fetch or mutation stalls only this action,
/// not writes, cron, or in-memory queries. On timeout Hermes asynchronously
/// breaks the eval and the fresh runtime is destroyed. The abandonment gate
/// rejects any host call that races with that teardown.
/// Mutations the action committed before the timeout remain committed —
/// actions are not transactions (LLP 0028).
async fn run_detached_ibex_action(
    state: &SharedSnapback,
    action: Box<crate::local::DetachedIbexAction>,
    input: HandlerInput,
    metadata: CronRunMetadata,
) -> SnapbackResult<Value> {
    let limiter = detached_action_limiter();
    run_detached_ibex_action_with_admission(
        state,
        action,
        input,
        metadata,
        limiter.semaphore.clone(),
        limiter.limit,
    )
    .await
}

async fn run_detached_ibex_action_with_admission(
    state: &SharedSnapback,
    action: Box<crate::local::DetachedIbexAction>,
    input: HandlerInput,
    metadata: CronRunMetadata,
    admission: Arc<Semaphore>,
    worker_limit: usize,
) -> SnapbackResult<Value> {
    run_detached_ibex_action_with_admission_and_counters(
        state,
        action,
        input,
        metadata,
        admission,
        worker_limit,
        global_detached_action_worker_counters(),
    )
    .await
}

async fn run_detached_ibex_action_with_admission_and_counters(
    state: &SharedSnapback,
    action: Box<crate::local::DetachedIbexAction>,
    input: HandlerInput,
    metadata: CronRunMetadata,
    admission: Arc<Semaphore>,
    worker_limit: usize,
    counters: DetachedActionWorkerCounters,
) -> SnapbackResult<Value> {
    // @ref LLP 0028#execution-the-action-class — detached native work has a
    // hard process-wide admission ceiling. A timed-out native call may retain
    // its permit until it actually exits, but it can never cause unbounded
    // thread growth.
    let worker_permit =
        reserve_detached_action_worker_with_counters(admission, worker_limit, counters)?;
    let timeout_ms = action_watchdog_timeout_ms();
    let started = Instant::now();
    let deadline = started
        .checked_add(Duration::from_millis(timeout_ms))
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ACTION_TIMEOUT_INVALID",
                "runtime",
                "configured action watchdog cannot be represented by the host clock",
            )
        })?;
    // Give Hermes' async-break monitor a small teardown margin before the
    // public watchdog fires. Normal timeout responses therefore come only
    // after the runtime and its OS worker have been destroyed; the outer
    // timer remains the fail-safe for a native host call that cannot unwind.
    let interrupt_cushion_ms = (timeout_ms / 10).clamp(1, 50);
    let execution_deadline = deadline
        .checked_sub(Duration::from_millis(interrupt_cushion_ms))
        .unwrap_or(deadline);
    let abandoned = Arc::new(AtomicBool::new(false));
    let commit_gate = Arc::new(StdMutex::new(()));
    let (sender, mut receiver) = tokio::sync::oneshot::channel();
    let spawned = spawn_detached_action_worker(
        worker_permit,
        counters,
        {
            let state = state.clone();
            let abandoned = abandoned.clone();
            let commit_gate = commit_gate.clone();
            move || {
                let crate::local::DetachedIbexAction {
                    module,
                    grants,
                    redactor,
                    runtime,
                    app_generation,
                    app_generation_fence,
                } = *action;
                let mut host = DetachedActionHost {
                    state,
                    abandoned,
                    commit_gate,
                    deadline: execution_deadline,
                    app_generation,
                    app_generation_fence,
                };
                let result = runtime.invoke_ibex_action(
                    &module,
                    input,
                    metadata,
                    &mut host,
                    grants,
                    Some(execution_deadline),
                );
                let result = match result {
                    Err(_error) if Instant::now() >= execution_deadline => {
                        Err(action_deadline_elapsed("action.execute"))
                    }
                    other => other,
                };
                // @ref LLP 0028#execution-the-action-class — an action may
                // await native fetch/timer work and return without making
                // another Snapback host call. Linearize successful
                // completion against the same staging generation so a
                // reload/reset during that await cannot escape as success.
                result
                    .and_then(|value| {
                        host.validate_live("action.complete")?;
                        Ok(value)
                    })
                    // This is the earliest common envelope boundary and
                    // carries the staging-time values, so rotation cannot
                    // make an old secret invisible to the scrubber.
                    .map_err(|error| redactor.redact_error(error))
            }
        },
        move |result| {
            // Runtime/host/worker guards are gone before publishing the
            // result, so a returned timeout proves no CPU worker leaked.
            let _ = sender.send(result);
        },
    );
    if let Err(error) = spawned {
        return Err(SnapbackError::error(
            "SNAPBACK_ACTION_THREAD_SPAWN_FAILED",
            "runtime",
            "action execution thread could not be spawned",
        )
        .with_details(json!({ "error": error.to_string() })));
    }
    match tokio::time::timeout(Duration::from_millis(timeout_ms), &mut receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_closed)) => Err(SnapbackError::error(
            "SNAPBACK_ACTION_THREAD_FAILED",
            "runtime",
            "action execution thread terminated without reporting a result",
        )),
        Err(_elapsed) => {
            // Linearize timeout against the bounded commit gate, independent
            // of the global instance lock. A nested handler can be permanently
            // hung, so waiting for that lock here would defeat the watchdog.
            let gate = commit_gate.clone();
            let abandoned_for_timeout = abandoned.clone();
            tokio::task::spawn_blocking(move || {
                // Detached workers return this gate only from their final
                // precommit callback, so the sole possible owner spans an
                // already-built SQLite transaction's identity write + COMMIT,
                // never handler code, plan iteration, instance-lock waiting,
                // or realtime fan-out.
                let _gate = gate
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                abandoned_for_timeout.store(true, Ordering::SeqCst);
            })
            .await
            .map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_ACTION_THREAD_FAILED",
                    "runtime",
                    "action watchdog commit gate task failed",
                )
                .with_details(json!({ "error": error.to_string() }))
            })?;

            // Hermes' own async-break deadline should already be unwinding
            // the VM. Give that bounded termination path a short grace window
            // before publishing the watchdog response. The action thread
            // sends only after destroying its runtime and decrementing the
            // worker counter, so success here proves there is no live CPU
            // worker left behind by this timeout.
            let worker_terminated = tokio::time::timeout(
                Duration::from_millis(ACTION_INTERRUPT_GRACE_MS),
                &mut receiver,
            )
            .await
            .is_ok();
            Err(SnapbackError::error(
                "SNAPBACK_ACTION_TIMEOUT",
                "runtime",
                format!(
                    "action exceeded the {timeout_ms}ms wall-clock watchdog and was abandoned; \
                     mutations it committed before the timeout remain committed"
                ),
            )
            .with_details(json!({
                "timeoutMs": timeout_ms,
                "workerTerminated": worker_terminated,
            })))
        }
    }
}

/// Execute a staged app/admin action and shape the run-result envelope.
/// `metadata_prefix` names the triggering surface (`action` for the app-data
/// route, `admin` for the function runner).
pub(crate) async fn run_staged_app_action(
    state: &SharedSnapback,
    name: &str,
    input: HandlerInput,
    stage: AppActionStage,
    metadata_prefix: &str,
) -> FunctionRunResult {
    let started = Instant::now();
    let metadata = crate::local::manual_action_metadata(metadata_prefix, name);
    let result = match stage.mode {
        StagedAction::InLock => {
            let name = name.to_owned();
            with_snapback(state, move |snapback| {
                snapback.invoke_action(&name, input, metadata)
            })
            .await
        }
        StagedAction::Detached(action) => {
            run_detached_ibex_action(state, action, input, metadata).await
        }
    };
    crate::local::action_run_result(
        name,
        stage.reads,
        stage.writes,
        started.elapsed().as_millis() as u64,
        result,
    )
}

/// One cron tick in the detached flow: claim due runs under the lock, execute
/// each claim off the lock (watchdogged for Ibex actions), finish each claim
/// back under the lock (ENG-23324).
pub(crate) async fn cron_tick_detached(
    state: &SharedSnapback,
    now_ms: u64,
) -> SnapbackResult<Vec<CronRunRecord>> {
    let claims = with_snapback(state, move |snapback| snapback.claim_due_cron_runs(now_ms)).await?;
    // Independent jobs must not head-of-line block one another, but dispatch
    // remains bounded separately from the process-wide worker admission cap.
    // Preserve claim order in the returned test/admin envelope even though
    // execution finishes out of order.
    let mut completed =
        futures_util::stream::iter(claims.into_iter().enumerate().map(|(index, claim)| {
            let state = state.clone();
            async move { (index, execute_cron_claim_detached(&state, claim).await) }
        }))
        .buffer_unordered(configured_cron_dispatch_concurrency(
            std::env::var("SNAPBACK_CRON_DISPATCH_CONCURRENCY")
                .ok()
                .as_deref(),
        ))
        .collect::<Vec<_>>()
        .await;
    completed.sort_by_key(|(index, _)| *index);
    let mut records = Vec::with_capacity(completed.len());
    for (_, result) in completed {
        records.push(result?);
    }
    Ok(records)
}

/// Claim one scheduler tick and hand each run to the process-wide bounded
/// cron dispatcher. This returns after dispatch, not after handler completion,
/// so `overlap: allow` can claim a later due slot while an earlier run is
/// still executing. Saturation becomes a recorded run outcome instead of an
/// unbounded task queue.
async fn dispatch_cron_tick_background(
    state: &SharedSnapback,
    dispatcher: &Arc<Semaphore>,
    dispatcher_limit: usize,
    now_ms: u64,
) -> SnapbackResult<usize> {
    let claims = with_snapback(state, move |snapback| snapback.claim_due_cron_runs(now_ms)).await?;
    let mut dispatched = 0;
    for claim in claims {
        match dispatcher.clone().try_acquire_owned() {
            Ok(permit) => {
                dispatched += 1;
                let state = state.clone();
                tokio::spawn(async move {
                    let _permit = permit;
                    if let Err(error) = execute_cron_claim_detached(&state, claim).await {
                        state.lock().await.record_cron_tick_error(error);
                    }
                });
            }
            Err(_) => {
                let started_wall_ms = now_millis();
                let job_name = claim.job.name.clone();
                let finish = with_snapback(state, move |snapback| {
                    snapback.finish_cron_claim(
                        claim,
                        started_wall_ms,
                        Err(Diagnostic::error(
                            "SNAPBACK_CRON_DISPATCH_CAPACITY_EXCEEDED",
                            "cron",
                            format!(
                                "cron job {job_name} could not start because every bounded dispatcher slot is busy"
                            ),
                        )
                        .with_details(json!({
                            "dispatcherLimit": dispatcher_limit,
                            "availableSlots": 0,
                        }))),
                    )
                })
                .await;
                // Every claim was already persisted as active. A failure to
                // persist this capacity outcome must not abandon later claims
                // in the batch; record it and continue draining ownership.
                if let Err(error) = finish {
                    state.lock().await.record_cron_tick_error(error);
                }
            }
        }
    }
    Ok(dispatched)
}

/// Execute one claimed cron run without holding the global mutex across the
/// action, then finish the claim.
pub(crate) async fn execute_cron_claim_detached(
    state: &SharedSnapback,
    claim: CronRunClaim,
) -> SnapbackResult<CronRunRecord> {
    let started_wall_ms = now_millis();
    let input = crate::local::cron_claim_input(&claim);
    let metadata = claim.metadata.clone();
    let action = claim.job.action.clone();
    let staged = {
        let action = action.clone();
        with_snapback(state, move |snapback| {
            snapback.stage_action_invocation(&action)
        })
        .await
    };
    let result = match staged {
        Ok(StagedAction::Detached(action)) => {
            run_detached_ibex_action(state, action, input, metadata).await
        }
        Ok(StagedAction::InLock) => {
            with_snapback(state, move |snapback| {
                snapback.invoke_action(&action, input, metadata)
            })
            .await
        }
        Err(error) => Err(error),
    }
    .map_err(|error| error.diagnostic);
    with_snapback(state, move |snapback| {
        snapback.finish_cron_claim(claim, started_wall_ms, result)
    })
    .await
}

/// Transport-level connection grants (ENG-23442). Connection ids used to be
/// caller-chosen bearerless capabilities: knowledge of an id alone was enough
/// to drain `/outbox/{id}` or attach `/live/{id}/stream` and read another
/// client's queued live results. Connections are now opened through
/// `POST /connection/open`, which returns the connection id paired with a
/// server-minted `connectionToken`; every connection-scoped operation must
/// present that token. A grant normally survives socket close so the kit can
/// reconnect. The registry itself is fixed-cap: unopened/unused grants are
/// evicted first; used grants become evictable only after an idle lease. If
/// every grant is both used and current, admission refuses transiently rather
/// than displacing live authority. Once a used id is retired under pressure,
/// caller-suggested ids stay disabled for this process so stale room/outbox
/// state can never be adopted by a new bearer; the client receives a fresh
/// minted id instead.
///
/// @ref LLP 0031#connection-capability-grants — server-issued grants; the
/// ConnectionAuth policy class marks every route this gate covers.
#[derive(Clone, Default)]
pub struct ConnectionRegistry {
    grants: Arc<std::sync::Mutex<ConnectionRegistryState>>,
}

#[derive(Default)]
struct ConnectionRegistryState {
    grants: std::collections::HashMap<String, ConnectionGrantRecord>,
    unused: std::collections::BTreeSet<(u64, String)>,
    used: std::collections::BTreeSet<(u64, String)>,
    pressure_mint_only: bool,
}

struct ConnectionGrantRecord {
    token: String,
    last_use_ms: u64,
    used: bool,
}

impl ConnectionRegistryState {
    fn touch(&mut self, connection_id: &str, now_ms: u64) {
        let Some((previous, was_used)) = self
            .grants
            .get(connection_id)
            .map(|record| (record.last_use_ms, record.used))
        else {
            return;
        };
        let index = if was_used {
            &mut self.used
        } else {
            &mut self.unused
        };
        index.remove(&(previous, connection_id.to_owned()));
        if let Some(record) = self.grants.get_mut(connection_id) {
            record.last_use_ms = now_ms;
            record.used = true;
        }
        self.used.insert((now_ms, connection_id.to_owned()));
    }

    fn admit_slot(&mut self, now_ms: u64) -> SnapbackResult<()> {
        if self.grants.len() < MAX_CONNECTION_GRANTS {
            return Ok(());
        }
        if let Some((_last_use, connection_id)) = self.unused.pop_first() {
            self.grants.remove(&connection_id);
            return Ok(());
        }
        let expired_before = now_ms.saturating_sub(CONNECTION_GRANT_IDLE_TTL_MS);
        if self
            .used
            .first()
            .is_some_and(|(last_use, _)| *last_use <= expired_before)
            && let Some((_last_use, connection_id)) = self.used.pop_first()
        {
            self.grants.remove(&connection_id);
            self.pressure_mint_only = true;
            return Ok(());
        }
        Err(SnapbackError::error(
            "SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED",
            "realtime",
            format!(
                "connection grant limit ({MAX_CONNECTION_GRANTS}) is occupied by active leases; retry after an idle lease expires"
            ),
        ))
    }

    fn insert(&mut self, connection_id: String, token: String, now_ms: u64) {
        self.unused.insert((now_ms, connection_id.clone()));
        self.grants.insert(
            connection_id,
            ConnectionGrantRecord {
                token,
                last_use_ms: now_ms,
                used: false,
            },
        );
    }
}

/// The `POST /connection/open` response: the (possibly adopted) connection id
/// and the bearer the caller must present on every connection-scoped call.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ConnectionGrant {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    #[serde(rename = "connectionToken")]
    pub connection_token: String,
}

/// The `POST /connection/open` request. `previousToken` is a bearer secret
/// used only to prove ownership of an existing grant; it is request-only and
/// must never enter diagnostics, receipts, retained client state, or logs.
///
/// @ref LLP 0051#d4-finish-dk-7-the-live-envelope-becomes-schema-governed —
///   the complete non-JS client HTTP surface is Rust-owned and generated.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenConnectionRequest {
    #[serde(default, alias = "connection_id")]
    pub connection_id: Option<String>,
    /// A prior grant's bearer. This field is deliberately absent from every
    /// server response and from all receipt/capsule schemas.
    #[serde(default, alias = "previous_token")]
    pub previous_token: Option<String>,
}

impl ConnectionRegistry {
    /// Open a grant. A caller-suggested id is adopted only in non-prod
    /// profiles (trusted local: readable ids keep demos, acceptance suites,
    /// and gated-inspect output debuggable) and only while unclaimed — a
    /// suggestion that collides with a live grant gets a minted id instead of
    /// a token rotation, so an existing connection's bearer can never be
    /// displaced by a later caller. Prod always mints: connection ids leaving
    /// the trusted posture are unguessable, never caller-selected.
    ///
    /// Re-open idempotence: a caller presenting the id's CURRENT token gets
    /// the same grant back (any profile — possession of the bearer already
    /// proves ownership). This is what lets a client hold one connection
    /// identity across reconnects and server restarts: after a restart the
    /// registry is empty, so the suggestion is simply adopted afresh.
    pub fn open(
        &self,
        suggested: Option<String>,
        previous_token: Option<&str>,
        allow_suggested: bool,
    ) -> SnapbackResult<ConnectionGrant> {
        let mut grants = self.lock();
        let now_ms = now_millis();
        if let (Some(id), Some(previous)) = (suggested.as_ref(), previous_token)
            && let Some(existing) = grants.grants.get(id)
            && constant_time_str_eq(&existing.token, previous)
        {
            let connection_token = existing.token.clone();
            grants.touch(id, now_ms);
            return Ok(ConnectionGrant {
                connection_id: id.clone(),
                connection_token,
            });
        }
        grants.admit_slot(now_ms)?;
        let connection_id = match suggested {
            Some(id)
                if allow_suggested
                    && !grants.pressure_mint_only
                    && valid_suggested_connection_id(&id)
                    && !grants.grants.contains_key(&id) =>
            {
                id
            }
            _ => loop {
                let minted = format!("conn_{}", Uuid::new_v4().simple());
                if !grants.grants.contains_key(&minted) {
                    break minted;
                }
            },
        };
        let connection_token = format!("sct_{}", Uuid::new_v4().simple());
        grants.insert(connection_id.clone(), connection_token.clone(), now_ms);
        Ok(ConnectionGrant {
            connection_id,
            connection_token,
        })
    }

    /// Verify a presented token for one connection-scoped operation. Unknown
    /// connections and token mismatches share one diagnostic code so the gate
    /// is not an existence oracle for the connection-id namespace.
    pub fn verify(&self, connection_id: &str, presented: Option<&str>) -> Result<(), ApiError> {
        let Some(presented) = presented else {
            return Err(connection_auth_error(
                "SNAPBACK_CONNECTION_TOKEN_REQUIRED",
                "connection-scoped operations require the connection token issued by POST /connection/open",
                connection_id,
            ));
        };
        let mut grants = self.lock();
        let valid = grants
            .grants
            .get(connection_id)
            .is_some_and(|expected| constant_time_str_eq(&expected.token, presented));
        if valid {
            grants.touch(connection_id, now_millis());
            Ok(())
        } else {
            Err(connection_auth_error(
                "SNAPBACK_CONNECTION_TOKEN_INVALID",
                "connection is not open on this server or the token does not match",
                connection_id,
            ))
        }
    }

    /// Renew an already-authenticated WebSocket lease on frame traffic. The
    /// upgrade verified the bearer once; subsequent frames do not carry it,
    /// but they are still proof that this exact authorized socket is active.
    fn touch_verified_socket(&self, connection_id: &str) -> bool {
        let mut grants = self.lock();
        if !grants.grants.contains_key(connection_id) {
            return false;
        }
        grants.touch(connection_id, now_millis());
        true
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ConnectionRegistryState> {
        self.grants
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn connection_auth_error(code: &str, message: &str, connection_id: &str) -> ApiError {
    ApiError(
        SnapbackError::new(
            Diagnostic::error(code, "realtime", message)
                .with_details(json!({ "connection_id": connection_id })),
        ),
        None,
    )
}

/// Constant-time token comparison (length is public: tokens are fixed-form).
fn constant_time_str_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The connection-token transports: the header for HTTP callers, the query
/// parameter and `snapback.connection-token.<token>` subprotocol for WebSocket
/// upgrades (a browser `WebSocket` cannot set request headers).
const CONNECTION_TOKEN_HEADER: &str = "x-snapback-connection-token";
const CONNECTION_TOKEN_SUBPROTOCOL_PREFIX: &str = "snapback.connection-token.";
/// The negotiated live-stream subprotocol. The kit always offers this
/// alongside the token subprotocol so the server has a legal echo (a browser
/// fails the connection when it offered subprotocols and the server selected
/// none).
const LIVE_STREAM_SUBPROTOCOL: &str = "snapback.v1";
const MAX_LIVE_SOCKET_FRAME_BYTES: usize = 64 * 1_024;
const MAX_CONNECTION_GRANTS: usize = 16_384;
const CONNECTION_GRANT_IDLE_TTL_MS: u64 = CONNECTION_IDLE_TTL_MS;

fn valid_suggested_connection_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= crate::ephemeral::MAX_EPHEMERAL_CONNECTION_ID_BYTES
        && bytes[0].is_ascii_alphanumeric()
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn header_connection_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(CONNECTION_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn subprotocol_connection_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::SEC_WEBSOCKET_PROTOCOL)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .find_map(|proto| proto.strip_prefix(CONNECTION_TOKEN_SUBPROTOCOL_PREFIX))
        .map(str::to_owned)
}

#[derive(Debug, Default, Deserialize)]
struct ConnectionTokenQuery {
    #[serde(default)]
    connection_token: Option<String>,
}

/// `POST /connection/open` — the connection handshake (ENG-23442). Public by
/// design: it GRANTS a capability rather than exercising one, exactly like
/// `/app/ensure`. The profile decides whether a caller-suggested id may be
/// adopted (non-prod only).
async fn open_connection(
    State(connections): State<ConnectionRegistry>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<ConnectionGrant>, ApiError> {
    let body = parse_optional_json::<OpenConnectionRequest>(&headers, body)?;
    let (suggested, previous_token) = body
        .map(|body| (body.connection_id, body.previous_token))
        .unwrap_or_default();
    let allow_suggested = ctx.profile.allows_provisioning();
    Ok(Json(connections.open(
        suggested,
        previous_token.as_deref(),
        allow_suggested,
    )?))
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub target: String,
    pub sqlite_version: u64,
    pub ibex_available: bool,
    /// Server-binary identity (ENG-22798): build/git provenance + a per-process
    /// startup nonce, so an externally started — possibly unprovisioned or
    /// schema-only — server is provenance-verifiable before any app bundle loads.
    ///
    /// @ref LLP 0031#server-binary-identity-on-health — build identity rides the
    /// ungated public /health; the reuse-provenance verdict falls back to it when
    /// bundle identity (`/inspect` appId/bundleHash) is unavailable.
    pub binary: crate::identity::BinaryIdentity,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DiagnosticsResponse {
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ErrorResponse {
    pub diagnostic: Diagnostic,
    /// Present only when a mutation reached the provider receipt boundary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Receipt>,
}

/// Successful `POST /mutation/{name}` response. The mutation output and its
/// terminal receipt are one closed, typed envelope; rejected mutations keep
/// using [`ErrorResponse`] with the same receipt attached by the error path.
///
/// @ref LLP 0051#d4-finish-dk-7-the-live-envelope-becomes-schema-governed —
///   direct mutation results are part of the generated client-visible wire.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MutationResponse {
    pub version: u64,
    pub changed_count: usize,
    pub result: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctx_ledger: Option<CtxAnswerLedger>,
    pub receipt: Receipt,
}

impl MutationResponse {
    fn from_output(output: MutationOutput, receipt: Receipt) -> Self {
        // Exhaustive destructuring makes an added MutationOutput field a
        // compile error here instead of silent drift in the public envelope.
        let MutationOutput {
            version,
            changed_count,
            result,
            ctx_ledger,
        } = output;
        Self {
            version,
            changed_count,
            result,
            ctx_ledger,
            receipt,
        }
    }
}

/// The app-data routes: the operations an ordinary app client calls. Every one
/// lives at the server root, carries app-supplied `ctx.auth` or is explicitly
/// public, and never performs instance-level control.
///
/// @ref LLP 0003#agent-and-test-surface — the local core exposes inspect, query, mutation, live, and ephemeral endpoints.
/// @ref LLP 0031#the-invariant — app-data routes live at the root; system routes live under `/_snapback/*`. The classification is declared once in `route_registry`.
fn core_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(instance_home))
        .route("/health", get(health))
        .route("/inspect", get(inspect))
        .route("/query/{name}", post(invoke_query))
        .route("/client-mutations/acknowledge", post(acknowledge_mutations))
        .route("/mutation/{name}", post(invoke_mutation))
        .route("/action/{name}", post(invoke_action))
        .route("/app/ensure", post(ensure_app))
        .route("/connection/open", post(open_connection))
        .route("/live/{name}/subscribe", post(subscribe_live))
        .route("/live/{name}/resume", post(resume_live))
        .route("/live/{name}/unsubscribe", post(unsubscribe_live))
        .route("/live/{connection_id}/stream", get(stream_live))
        .route("/outbox/{connection_id}", get(drain_outbox))
        .route(
            "/ephemeral/collections/ensure",
            post(ensure_ephemeral_collections),
        )
        .route("/ephemeral/publish", post(publish_ephemeral))
        .route("/ephemeral/subscribe", post(subscribe_ephemeral))
        .route("/ephemeral/delete", post(delete_ephemeral))
}

/// The migrated system routes that used to hide at the root as ungated
/// `/admin/*` aliases (schema/functions/reset load, connection teardown). They
/// now live under `/_snapback/api/*` behind the admin write policy, projecting
/// the LLP 0024 host-ops nouns (`schema.load`, `functions.load`, `app.reset`).
///
/// @ref LLP 0031#migration-plan — D5 flat `subsystem/verb` writes and the D2 disconnect move.
fn system_routes() -> Router<AppState> {
    Router::new()
        .route("/_snapback/api/schema/load", post(apply_schema))
        .route("/_snapback/api/functions/load", post(load_functions))
        .route("/_snapback/api/app/reset", post(app_reset))
        .route(
            "/_snapback/api/client-mutations/purge",
            post(purge_client_mutation_settlements),
        )
        // @ref LLP 0024#result-envelope — the host-ops first slice (LLP 0032
        // P6): one operation endpoint, one hostOpsResult envelope per call;
        // the legacy per-noun routes above stay as documented aliases.
        .route("/_snapback/api/host-ops", post(host_ops_handler))
        .route(
            "/_snapback/api/connections/{connection_id}/disconnect",
            post(disconnect),
        )
        // @ref LLP 0036#operations-and-projections-llp-0024 — the config ops:
        // status/plan read-gated, set/unset/verify write-gated; the wizard is
        // a projection of these, not a second implementation.
        .route("/_snapback/api/config/status", get(config_status))
        .route("/_snapback/api/config/plan", get(config_plan))
        .route("/_snapback/api/config/set", post(config_set))
        .route("/_snapback/api/config/unset", post(config_unset))
        .route("/_snapback/api/config/verify", post(config_verify))
}

/// The full Snapback HTTP surface: app-data root routes, the migrated
/// `/_snapback/api/*` system writes, and the admin console/API — one server,
/// one declared boundary (`route_registry`).
///
/// @ref LLP 0031#the-invariant — no system operation lives at the root; the enforcement test guards it.
pub fn app(state: AppState) -> Router {
    core_routes()
        .merge(system_routes())
        .merge(crate::admin::admin_routes())
        .with_state(state)
        .layer(middleware::from_fn(local_dev_cors))
}

/// The path class of a route or a multiplexed operation.
///
/// @ref LLP 0031#route-classification — every operation is app-data or system.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RouteClass {
    /// An operation an app client may call; lives at the server root.
    AppData,
    /// Static console shell/assets under `/_snapback/admin*`; public presentation only.
    SystemStatic,
    /// A system API operation under `/_snapback/api/*`; admin-gated.
    SystemApi,
}

/// The authorization policy a route carries. `AppAuth` means the handler may
/// enforce the app-supplied `ctx.auth` — not that the transport authenticates
/// the caller (in local v0 it does not; see LLP 0031 §The invariant).
/// `ConnectionAuth` strengthens that: the transport requires the
/// server-issued per-connection token from `POST /connection/open` (the
/// handler may still additionally enforce `ctx.auth`).
///
/// @ref LLP 0031#connection-capability-grants — ConnectionAuth marks every
/// route that exercises a connection-scoped capability.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RoutePolicy {
    Public,
    AppAuth,
    ConnectionAuth,
    AdminRead,
    AdminWrite,
}

/// A declared route in the registry.
#[derive(Clone, Copy, Debug)]
pub struct RouteSpec {
    pub method: &'static str,
    pub path: &'static str,
    pub class: RouteClass,
    pub policy: RoutePolicy,
}

/// The declared route registry — the single source of truth for the
/// app-data/system boundary. `app()` builds the router from these exact paths;
/// because axum's `Router` cannot be introspected at runtime, this declaration
/// is the mechanical guarantee a proxy relies on, and the enforcement test
/// (`route_registry_matches_the_invariant`) asserts the invariant over it. Keep
/// this list in lockstep with `core_routes`/`system_routes`/`admin_routes`.
///
/// @ref LLP 0031#enforcement — registry-driven enforcement; the classified unit is the operation.
pub fn route_registry() -> Vec<RouteSpec> {
    use RouteClass::{AppData, SystemApi, SystemStatic};
    use RoutePolicy::{AdminRead, AdminWrite, AppAuth, ConnectionAuth, Public};
    let spec = |method, path, class, policy| RouteSpec {
        method,
        path,
        class,
        policy,
    };
    vec![
        // App-data — root.
        spec("GET", "/", AppData, Public),
        spec("GET", "/health", AppData, Public),
        spec("GET", "/inspect", AppData, Public),
        spec("POST", "/query/{name}", AppData, AppAuth),
        spec("POST", "/client-mutations/acknowledge", AppData, AppAuth),
        spec("POST", "/mutation/{name}", AppData, AppAuth),
        spec("POST", "/action/{name}", AppData, AppAuth),
        spec("POST", "/app/ensure", AppData, Public),
        // Grants the connection capability (like /app/ensure grants app
        // provisioning): public entry, everything it guards is ConnectionAuth.
        spec("POST", "/connection/open", AppData, Public),
        spec("POST", "/live/{name}/subscribe", AppData, ConnectionAuth),
        spec("POST", "/live/{name}/resume", AppData, ConnectionAuth),
        spec("POST", "/live/{name}/unsubscribe", AppData, ConnectionAuth),
        spec(
            "GET",
            "/live/{connection_id}/stream",
            AppData,
            ConnectionAuth,
        ),
        spec("GET", "/outbox/{connection_id}", AppData, ConnectionAuth),
        spec("POST", "/ephemeral/collections/ensure", AppData, Public),
        spec("POST", "/ephemeral/publish", AppData, ConnectionAuth),
        spec("POST", "/ephemeral/subscribe", AppData, ConnectionAuth),
        spec("POST", "/ephemeral/delete", AppData, ConnectionAuth),
        // System API — migrated gated writes (LLP 0031 D5/D2).
        spec("POST", "/_snapback/api/schema/load", SystemApi, AdminWrite),
        spec(
            "POST",
            "/_snapback/api/functions/load",
            SystemApi,
            AdminWrite,
        ),
        spec("POST", "/_snapback/api/app/reset", SystemApi, AdminWrite),
        spec(
            "POST",
            "/_snapback/api/client-mutations/purge",
            SystemApi,
            AdminWrite,
        ),
        spec("POST", "/_snapback/api/host-ops", SystemApi, AdminWrite),
        spec(
            "POST",
            "/_snapback/api/connections/{connection_id}/disconnect",
            SystemApi,
            AdminWrite,
        ),
        // System API — existing admin surface.
        spec("GET", "/_snapback/api/health", SystemApi, AdminRead),
        // Full inspect carries raw operational text/source/path facts; unlike
        // health and the typed root projection it requires the configured
        // admin bearer even though the HTTP method is GET.
        spec("GET", "/_snapback/api/inspect", SystemApi, AdminWrite),
        spec("GET", "/_snapback/api/receipts", SystemApi, AdminRead),
        spec("GET", "/_snapback/api/data/{table}", SystemApi, AdminRead),
        // Function runner gates dynamically (read for queries, write for
        // mutations); declared as the stronger write policy.
        spec(
            "POST",
            "/_snapback/api/functions/{name}/run",
            SystemApi,
            AdminWrite,
        ),
        spec("POST", "/_snapback/api/cron/tick", SystemApi, AdminWrite),
        spec(
            "POST",
            "/_snapback/api/cron/{name}/run",
            SystemApi,
            AdminWrite,
        ),
        spec(
            "POST",
            "/_snapback/api/ephemeral/cleanup",
            SystemApi,
            AdminWrite,
        ),
        // System API — app config ops (LLP 0036 §Route placement).
        spec("GET", "/_snapback/api/config/status", SystemApi, AdminRead),
        spec("GET", "/_snapback/api/config/plan", SystemApi, AdminRead),
        spec("POST", "/_snapback/api/config/set", SystemApi, AdminWrite),
        spec("POST", "/_snapback/api/config/unset", SystemApi, AdminWrite),
        spec(
            "POST",
            "/_snapback/api/config/verify",
            SystemApi,
            AdminWrite,
        ),
        // System static — console shell/assets (public presentation only).
        spec("GET", "/_snapback/admin", SystemStatic, Public),
        spec("GET", "/_snapback/admin/", SystemStatic, Public),
        spec("GET", "/_snapback/admin/setup", SystemStatic, Public),
        spec("GET", "/_snapback/admin/{*path}", SystemStatic, Public),
    ]
}

/// The operations multiplexed over the `/live/{id}/stream` socket. Per LLP 0031
/// the classified unit is the *operation*, so these are classified in their own
/// right — all app-data today — so an app-data route cannot smuggle a system
/// operation. Kept in lockstep with `LiveSocketClientMessage` by the exhaustive
/// match in `live_socket_operation_name` (test build); the enforcement test
/// asserts every one is app-data.
///
/// @ref LLP 0031#enforcement — WebSocket message kinds are asserted against the registry directly.
pub fn live_socket_operations() -> Vec<(&'static str, RouteClass)> {
    vec![
        ("ephemeral_subscribe", RouteClass::AppData),
        ("ephemeral_publish", RouteClass::AppData),
        ("ephemeral_delete", RouteClass::AppData),
        ("ephemeral_unsubscribe", RouteClass::AppData),
        ("live_ping", RouteClass::AppData),
    ]
}

/// Browser-friendly default route for a running Snapback instance.
///
/// One public metadata object ([`InstanceStatus`]), four renderings, chosen by
/// content negotiation: HTML for browsers, and JSON, Markdown, or YAML for
/// clients that ask for them. YAML stays the default so `curl /` keeps reading
/// the way it always has; `?format=` overrides the header for direct machine
/// rendering requests.
///
/// @ref LLP 0017#serving-model — system surfaces live under the reserved
/// `/_snapback/*` namespace; the default route can point humans at them without
/// becoming another privileged API.
/// @ref LLP 0024#http-projection — agent operations remain admin API/MCP
/// projections, not the root browser URL.
async fn instance_home(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    Query(query): Query<HomeQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    // inspect() reads SQLite (storage version), so this goes through the
    // offload like every other rusqlite-touching handler (L7). The review of
    // this arc caught the original inline lock here: it panicked the exec
    // guard on every debug-build GET / while current-thread tests stayed green.
    let inspect = with_snapback(&state, |snapback| snapback.inspect()).await?;
    let status = instance_status(&inspect, &ctx);
    let accept = headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok());
    Ok(
        match negotiate_home_format(query.format.as_deref(), accept) {
            HomeFormat::Html => (
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                instance_home_html(&status),
            )
                .into_response(),
            HomeFormat::Json => Json(&status).into_response(),
            HomeFormat::Markdown => (
                [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
                instance_home_markdown(&status),
            )
                .into_response(),
            HomeFormat::Yaml => (
                [(header::CONTENT_TYPE, "text/yaml; charset=utf-8")],
                instance_home_yaml(&status),
            )
                .into_response(),
        },
    )
}

#[derive(Debug, Deserialize)]
struct HomeQuery {
    format: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum HomeFormat {
    Yaml,
    Json,
    Markdown,
    Html,
}

/// `?format=` wins, then the earliest recognized media type in `Accept`, then
/// YAML — the shape `/` has always served to non-browser clients, so agents
/// and `curl` (which sends `*/*`) see no change.
fn negotiate_home_format(format_param: Option<&str>, accept: Option<&str>) -> HomeFormat {
    match format_param.map(str::to_ascii_lowercase).as_deref() {
        Some("html") => return HomeFormat::Html,
        Some("json") => return HomeFormat::Json,
        Some("md") | Some("markdown") => return HomeFormat::Markdown,
        Some("yaml") | Some("yml") => return HomeFormat::Yaml,
        _ => {}
    }
    for entry in accept.unwrap_or_default().split(',') {
        let media = entry
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        match media.as_str() {
            "text/html" | "application/xhtml+xml" => return HomeFormat::Html,
            "application/json" | "text/json" => return HomeFormat::Json,
            "text/markdown" | "text/x-markdown" => return HomeFormat::Markdown,
            "text/yaml" | "text/x-yaml" | "application/yaml" | "application/x-yaml"
            | "text/plain" => return HomeFormat::Yaml,
            _ => {}
        }
    }
    HomeFormat::Yaml
}

/// The public instance-status metadata object behind every `/` rendering.
/// Everything here must be safe on the open, unauthenticated root.
///
/// @ref LLP 0031#resolved-decisions — D3: the public `/` must not reveal the
/// absolute on-disk DB path; report the mode, not the location.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceStatus {
    schema_version: String,
    status_kind: String,
    name: String,
    target: String,
    runtime_engine: String,
    app: AppStatus,
    storage: StorageStatus,
    server: ServerStatus,
    admin: AdminStatus,
    artifacts: ArtifactsStatus,
    counts: CountsStatus,
    capabilities: CapabilitiesStatus,
    links: LinksStatus,
}

/// App identity as declared by the loaded schema manifest (`app` block); the
/// id field is present in the payload, and may be empty before an app is
/// loaded. Presentation fields appear only when the app declares them.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    wordmark_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStatus {
    engine: String,
    mode: String,
    detail: String,
    database_version: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerStatus {
    bind: String,
    host: String,
    port: u16,
    loopback: bool,
    uptime_ms: u64,
    uptime: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminStatus {
    access: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactsStatus {
    schema_hash: String,
    bundle_hash: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CountsStatus {
    loaded_tables: usize,
    loaded_functions: usize,
    live_subscriptions: usize,
    cron_jobs: usize,
    recent_diagnostics: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilitiesStatus {
    summary: String,
    gaps: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinksStatus {
    admin_console: String,
    health_json: String,
    inspect_json: String,
}

fn instance_status(inspect: &InspectState, ctx: &ServerContext) -> InstanceStatus {
    let storage_mode = if inspect.storage.sqlite_path.is_some() {
        "file"
    } else {
        "memory"
    };
    let storage_detail = if inspect.storage.sqlite_path.is_some() {
        "on-disk database"
    } else {
        "in-memory database"
    };
    let capability_summary = if inspect.capability_gaps.is_empty() {
        "No reported capability gaps".to_owned()
    } else {
        format!(
            "{} capability {} reported",
            inspect.capability_gaps.len(),
            if inspect.capability_gaps.len() == 1 {
                "gap"
            } else {
                "gaps"
            }
        )
    };
    let app = inspect.schema.app.clone().unwrap_or_default();
    InstanceStatus {
        schema_version: inspect.schema_version.clone(),
        status_kind: "snapbackInstanceStatus".to_owned(),
        name: "Snapback local server".to_owned(),
        target: inspect.target.clone(),
        runtime_engine: inspect.capability_manifest.runtime_engine.clone(),
        app: AppStatus {
            id: inspect.schema.app_id.clone(),
            name: app.name,
            description: app.description,
            icon_url: app.icon_url,
            wordmark_url: app.wordmark_url,
        },
        storage: StorageStatus {
            engine: inspect.capability_manifest.storage_engine.clone(),
            mode: storage_mode.to_owned(),
            detail: storage_detail.to_owned(),
            database_version: inspect.storage.version,
        },
        server: ServerStatus {
            bind: format!("{}:{}", ctx.host, ctx.port),
            host: ctx.host.clone(),
            port: ctx.port,
            loopback: ctx.loopback,
            uptime_ms: ctx.uptime_ms(),
            uptime: format_duration(ctx.uptime_ms()),
        },
        admin: AdminStatus {
            access: admin_access_summary(ctx),
        },
        artifacts: ArtifactsStatus {
            schema_hash: inspect
                .schema
                .schema_hash
                .clone()
                .unwrap_or_else(|| "not loaded".to_owned()),
            bundle_hash: inspect
                .functions
                .bundle_hash
                .clone()
                .unwrap_or_else(|| "not loaded".to_owned()),
        },
        counts: CountsStatus {
            loaded_tables: inspect.storage.tables.len(),
            loaded_functions: inspect.functions.functions.len(),
            live_subscriptions: inspect.subscriptions.len(),
            cron_jobs: inspect.cron.jobs.len(),
            recent_diagnostics: inspect.recent_diagnostics.len(),
        },
        capabilities: CapabilitiesStatus {
            summary: capability_summary,
            gaps: inspect.capability_gaps.clone(),
        },
        links: LinksStatus {
            admin_console: "/_snapback/admin".to_owned(),
            health_json: "/_snapback/api/health".to_owned(),
            inspect_json: "/_snapback/api/inspect".to_owned(),
        },
    }
}

fn instance_home_yaml(status: &InstanceStatus) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "schemaVersion: {}\n",
        yaml_string(&status.schema_version)
    ));
    out.push_str(&format!(
        "statusKind: {}\n",
        yaml_string(&status.status_kind)
    ));
    out.push_str(&format!("name: {}\n", yaml_string(&status.name)));
    out.push_str(&format!("target: {}\n", yaml_string(&status.target)));
    out.push_str(&format!(
        "runtimeEngine: {}\n",
        yaml_string(&status.runtime_engine)
    ));
    out.push_str("app:\n");
    out.push_str(&format!("  id: {}\n", yaml_string(&status.app.id)));
    for (key, value) in [
        ("name", &status.app.name),
        ("description", &status.app.description),
        ("iconUrl", &status.app.icon_url),
        ("wordmarkUrl", &status.app.wordmark_url),
    ] {
        if let Some(value) = value {
            out.push_str(&format!("  {key}: {}\n", yaml_string(value)));
        }
    }
    out.push_str("storage:\n");
    out.push_str(&format!(
        "  engine: {}\n",
        yaml_string(&status.storage.engine)
    ));
    out.push_str(&format!("  mode: {}\n", yaml_string(&status.storage.mode)));
    out.push_str(&format!(
        "  detail: {}\n",
        yaml_string(&status.storage.detail)
    ));
    out.push_str(&format!(
        "  databaseVersion: {}\n",
        status.storage.database_version
    ));
    out.push_str("server:\n");
    out.push_str(&format!("  bind: {}\n", yaml_string(&status.server.bind)));
    out.push_str(&format!("  host: {}\n", yaml_string(&status.server.host)));
    out.push_str(&format!("  port: {}\n", status.server.port));
    out.push_str(&format!("  loopback: {}\n", status.server.loopback));
    out.push_str(&format!("  uptimeMs: {}\n", status.server.uptime_ms));
    out.push_str(&format!(
        "  uptime: {}\n",
        yaml_string(&status.server.uptime)
    ));
    out.push_str("admin:\n");
    out.push_str(&format!(
        "  access: {}\n",
        yaml_string(&status.admin.access)
    ));
    out.push_str("artifacts:\n");
    out.push_str(&format!(
        "  schemaHash: {}\n",
        yaml_string(&status.artifacts.schema_hash)
    ));
    out.push_str(&format!(
        "  bundleHash: {}\n",
        yaml_string(&status.artifacts.bundle_hash)
    ));
    out.push_str("counts:\n");
    out.push_str(&format!(
        "  loadedTables: {}\n",
        status.counts.loaded_tables
    ));
    out.push_str(&format!(
        "  loadedFunctions: {}\n",
        status.counts.loaded_functions
    ));
    out.push_str(&format!(
        "  liveSubscriptions: {}\n",
        status.counts.live_subscriptions
    ));
    out.push_str(&format!("  cronJobs: {}\n", status.counts.cron_jobs));
    out.push_str(&format!(
        "  recentDiagnostics: {}\n",
        status.counts.recent_diagnostics
    ));
    out.push_str("capabilities:\n");
    out.push_str(&format!(
        "  summary: {}\n",
        yaml_string(&status.capabilities.summary)
    ));
    out.push_str(&format!(
        "  gaps: {}\n",
        yaml_string_list(&status.capabilities.gaps)
    ));
    out.push_str("links:\n");
    out.push_str(&format!(
        "  adminConsole: {}\n",
        yaml_string(&status.links.admin_console)
    ));
    out.push_str(&format!(
        "  healthJson: {}\n",
        yaml_string(&status.links.health_json)
    ));
    out.push_str(&format!(
        "  inspectJson: {}\n",
        yaml_string(&status.links.inspect_json)
    ));
    out
}

fn instance_home_markdown(status: &InstanceStatus) -> String {
    let mut out = String::new();
    let title = status.app.name.as_deref().unwrap_or(&status.name);
    out.push_str(&format!("# {title}\n\n"));
    if let Some(description) = &status.app.description {
        out.push_str(&format!("{description}\n\n"));
    }
    out.push_str("A Snapback instance is running here.\n\n");
    out.push_str(&format!("- schemaVersion: `{}`\n", status.schema_version));
    out.push_str(&format!("- statusKind: `{}`\n", status.status_kind));
    out.push_str(&format!("- name: {}\n", status.name));
    out.push_str(&format!("- target: `{}`\n", status.target));
    out.push_str(&format!("- runtimeEngine: `{}`\n", status.runtime_engine));
    out.push_str("\n## app\n\n");
    out.push_str(&format!("- id: `{}`\n", status.app.id));
    for (key, value) in [
        ("name", &status.app.name),
        ("description", &status.app.description),
        ("iconUrl", &status.app.icon_url),
        ("wordmarkUrl", &status.app.wordmark_url),
    ] {
        if let Some(value) = value {
            out.push_str(&format!("- {key}: {value}\n"));
        }
    }
    out.push_str("\n## storage\n\n");
    out.push_str(&format!("- engine: `{}`\n", status.storage.engine));
    out.push_str(&format!("- mode: `{}`\n", status.storage.mode));
    out.push_str(&format!("- detail: {}\n", status.storage.detail));
    out.push_str(&format!(
        "- databaseVersion: {}\n",
        status.storage.database_version
    ));
    out.push_str("\n## server\n\n");
    out.push_str(&format!("- bind: `{}`\n", status.server.bind));
    out.push_str(&format!("- host: `{}`\n", status.server.host));
    out.push_str(&format!("- port: {}\n", status.server.port));
    out.push_str(&format!("- loopback: {}\n", status.server.loopback));
    out.push_str(&format!("- uptimeMs: {}\n", status.server.uptime_ms));
    out.push_str(&format!("- uptime: {}\n", status.server.uptime));
    out.push_str("\n## admin\n\n");
    out.push_str(&format!("- access: {}\n", status.admin.access));
    out.push_str("\n## artifacts\n\n");
    out.push_str(&format!(
        "- schemaHash: `{}`\n",
        status.artifacts.schema_hash
    ));
    out.push_str(&format!(
        "- bundleHash: `{}`\n",
        status.artifacts.bundle_hash
    ));
    out.push_str("\n## counts\n\n");
    out.push_str(&format!(
        "- loadedTables: {}\n",
        status.counts.loaded_tables
    ));
    out.push_str(&format!(
        "- loadedFunctions: {}\n",
        status.counts.loaded_functions
    ));
    out.push_str(&format!(
        "- liveSubscriptions: {}\n",
        status.counts.live_subscriptions
    ));
    out.push_str(&format!("- cronJobs: {}\n", status.counts.cron_jobs));
    out.push_str(&format!(
        "- recentDiagnostics: {}\n",
        status.counts.recent_diagnostics
    ));
    out.push_str("\n## capabilities\n\n");
    out.push_str(&format!("- summary: {}\n", status.capabilities.summary));
    if status.capabilities.gaps.is_empty() {
        out.push_str("- gaps: none\n");
    } else {
        for gap in &status.capabilities.gaps {
            out.push_str(&format!("- gap: {gap}\n"));
        }
    }
    out.push_str("\n## links\n\n");
    out.push_str(&format!(
        "- [Admin console]({})\n",
        status.links.admin_console
    ));
    out.push_str(&format!("- [Health JSON]({})\n", status.links.health_json));
    out.push_str(&format!(
        "- [Inspect JSON]({})\n",
        status.links.inspect_json
    ));
    out
}

/// The embedded browser homepage. Like the embedded admin console it is a
/// single self-contained file — inline styles, inline brand SVG, no external
/// assets — so a bare `cargo run` serves it with no toolchain.
const INSTANCE_HOME_HTML: &str = include_str!("server/instance_home.html");
const SNAPBACK_MARK_SVG: &str = include_str!("../brand/snapback-mark.svg");
const SNAPBACK_FAVICON_SVG: &str = include_str!("../brand/favicon.svg");
const LOCK_ICON_SVG: &str = r#"<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>"#;

fn instance_home_html(status: &InstanceStatus) -> String {
    let title = match &status.app.name {
        Some(name) => format!("{name} — Snapback"),
        None => "Snapback".to_owned(),
    };
    INSTANCE_HOME_HTML
        .replace("__TITLE__", &html_escape(&title))
        .replace("__FAVICON_HREF__", &svg_data_uri(SNAPBACK_FAVICON_SVG))
        .replace("__SNAPBACK_MARK__", SNAPBACK_MARK_SVG)
        .replace("__LOCK_ICON__", LOCK_ICON_SVG)
        .replace("__HERO__", &instance_home_hero(status))
        .replace("__FACTS__", &instance_home_facts(status))
        .replace(
            "__DETAILS_YAML__",
            &html_escape(&instance_home_yaml(status)),
        )
}

/// App-branded hero when the manifest declares an identity, Snapback-branded
/// otherwise. Every app-supplied value is escaped: the manifest is app-authored
/// input, and this page renders on the open root.
fn instance_home_hero(status: &InstanceStatus) -> String {
    let app = &status.app;
    let app_id = if status.artifacts.schema_hash == "not loaded" {
        ""
    } else {
        app.id.trim()
    };
    let name = non_empty(&app.name);
    let description = non_empty(&app.description);
    let icon_url = non_empty(&app.icon_url);
    let wordmark_url = non_empty(&app.wordmark_url);
    let has_identity = name.is_some()
        || description.is_some()
        || icon_url.is_some()
        || wordmark_url.is_some()
        || !app_id.is_empty();
    if !has_identity {
        return String::new();
    }
    let mut out = String::new();
    if let Some(icon_url) = icon_url {
        out.push_str("<div class=\"identity\">\n");
        out.push_str(&format!(
            "<img class=\"app-icon\" src=\"{}\" alt=\"\" />\n<div>\n",
            html_escape(icon_url)
        ));
    }
    let display_name = name.unwrap_or(app_id);
    match wordmark_url {
        Some(wordmark_url) => out.push_str(&format!(
            "<img class=\"app-wordmark\" src=\"{}\" alt=\"{}\" />\n",
            html_escape(wordmark_url),
            html_escape(display_name)
        )),
        None if !display_name.is_empty() => {
            out.push_str(&format!("<h1>{}</h1>\n", html_escape(display_name)))
        }
        None => {}
    }
    if let Some(description) = description {
        out.push_str(&format!(
            "<p class=\"desc\">{}</p>\n",
            html_escape(description)
        ));
    }
    if !app_id.is_empty() {
        let sub = if name.is_some()
            || description.is_some()
            || icon_url.is_some()
            || wordmark_url.is_some()
        {
            format!(
                "app id <code>{}</code> &middot; running on Snapback",
                html_escape(app_id)
            )
        } else {
            "running on Snapback".to_owned()
        };
        out.push_str(&format!("<p class=\"sub\">{sub}</p>\n"));
    }
    if icon_url.is_some() {
        out.push_str("</div>\n</div>\n");
    }
    out
}

/// The most important public facts, as a four-column table: two key/value
/// pairs per row, so the list reads as two side-by-side columns instead of one
/// tall one. Everything shown is drawn from the same public `InstanceStatus`
/// the machine formats serve.
fn instance_home_facts(status: &InstanceStatus) -> String {
    let facts: [(&str, String, bool); 10] = [
        ("Uptime", status.server.uptime.clone(), false),
        ("Bind", status.server.bind.clone(), true),
        ("Target", status.target.clone(), true),
        ("Runtime", status.runtime_engine.clone(), true),
        (
            "Storage",
            format!("{} ({})", status.storage.engine, status.storage.mode),
            false,
        ),
        ("Tables", status.counts.loaded_tables.to_string(), false),
        (
            "Functions",
            status.counts.loaded_functions.to_string(),
            false,
        ),
        ("Cron jobs", status.counts.cron_jobs.to_string(), false),
        (
            "Live subscriptions",
            status.counts.live_subscriptions.to_string(),
            false,
        ),
        ("Capabilities", status.capabilities.summary.clone(), false),
    ];
    let cell = |key: &str, value: &str, mono: bool| {
        format!(
            "<th scope=\"row\">{}</th><td{}>{}</td>",
            html_escape(key),
            if mono { " class=\"mono\"" } else { "" },
            html_escape(value)
        )
    };
    let mut out = String::new();
    out.push_str("<table>\n<tbody>\n");
    for pair in facts.chunks(2) {
        out.push_str("<tr>");
        for (key, value, mono) in pair {
            out.push_str(&cell(key, value, *mono));
        }
        if pair.len() == 1 {
            out.push_str("<th scope=\"row\"></th><td></td>");
        }
        out.push_str("</tr>\n");
    }
    // The one sentence-length fact gets the full row width instead of
    // squeezing into a half-width value cell.
    out.push_str(&format!(
        "<tr><th scope=\"row\">Admin access</th><td colspan=\"3\">{}</td></tr>\n",
        html_escape(&status.admin.access)
    ));
    out.push_str("</tbody>\n</table>\n");
    out
}

fn non_empty(value: &Option<String>) -> Option<&str> {
    value.as_deref().filter(|value| !value.trim().is_empty())
}

fn html_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
    out
}

/// Minimal percent-encoding for an SVG `data:` URI (favicon): enough to keep
/// the document valid inside an HTML attribute without a base64 dependency.
fn svg_data_uri(svg: &str) -> String {
    let mut out = String::with_capacity(svg.len() + 24);
    out.push_str("data:image/svg+xml,");
    for ch in svg.chars() {
        match ch {
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            '#' => out.push_str("%23"),
            '%' => out.push_str("%25"),
            '{' => out.push_str("%7B"),
            '}' => out.push_str("%7D"),
            '"' => out.push('\''),
            '\n' => out.push(' '),
            other => out.push(other),
        }
    }
    out
}

fn admin_access_summary(ctx: &ServerContext) -> String {
    match (ctx.loopback, ctx.admin_token.is_some()) {
        (true, false) => {
            // Reachable only from embedded routers: the serve path always
            // resolves a token on loopback (ENG-23443).
            "Open on loopback; set SNAPBACK_ADMIN_TOKEN to require a token for writes".to_owned()
        }
        // The absolute capability-file path is an authenticated operator fact,
        // never public homepage metadata. Same-user tools discover it from the
        // trusted ready descriptor or gated admin inspect surface.
        (true, true) if ctx.admin_token_minted => {
            "Reads open on loopback; writes require the minted admin token".to_owned()
        }
        (true, true) => "Reads open on loopback; writes require SNAPBACK_ADMIN_TOKEN".to_owned(),
        (false, false) => {
            "Admin API disabled on this non-loopback bind until SNAPBACK_ADMIN_TOKEN is set"
                .to_owned()
        }
        (false, true) => {
            "Admin API requires SNAPBACK_ADMIN_TOKEN on this non-loopback bind".to_owned()
        }
    }
}

fn format_duration(ms: u64) -> String {
    let seconds = ms / 1000;
    if seconds < 60 {
        format!("{seconds}s")
    } else if seconds < 3600 {
        format!("{}m {}s", seconds / 60, seconds % 60)
    } else {
        format!("{}h {}m", seconds / 3600, (seconds % 3600) / 60)
    }
}

fn yaml_string(value: &str) -> String {
    serde_json::to_string(value).expect("string serialization cannot fail")
}

fn yaml_string_list(values: &[String]) -> String {
    if values.is_empty() {
        "[]".to_owned()
    } else {
        format!(
            "[{}]",
            values
                .iter()
                .map(|value| yaml_string(value))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }
}

/// Backwards-compatible entry point: build the full app with a detached
/// (loopback, address-unknown) server context.
pub fn router(snapback: LocalSnapback) -> Router {
    app(AppState::detached(snapback))
}

/// How long a connection may be idle before the reaper tears it down, and how
/// often the reaper runs. HTTP-polling clients poll well within this window;
/// WS clients are normally reaped on socket close. A WS peer that vanishes
/// without FIN/RST (suspend, cable pull) is covered twice (ENG-23424): the
/// safety-net Ping in `live_stream` errors the socket within the TCP
/// retransmission timeout, and — because an empty server-initiated drain no
/// longer counts as liveness — an idle dead peer also ages past this TTL and
/// is reaped even before the socket error lands.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2.
const CONNECTION_IDLE_TTL_MS: u64 = 120_000;
const MAINTENANCE_INTERVAL_MS: u64 = 30_000;
// @ref LLP 0032 L3 / LLP 0008 §Retention — keep the last N commit versions and
// anything newer than the time window; prune the rest.
const JOURNAL_RETAIN_VERSIONS: u64 = 10_000;
const JOURNAL_RETAIN_MS: u64 = 24 * 60 * 60 * 1_000;

/// Periodic lifecycle maintenance: reap connections idle past the TTL (L2) so an
/// abandoned HTTP-polling client's subscriptions and ephemeral state do not live
/// forever, prune the change journal to its retention window (L3) so it does
/// not grow without bound, and prune expired ephemeral entries through the
/// expiry index (L9) — the index makes this cheap, and it never takes the
/// global mutex.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2, L3, L9.
pub fn spawn_maintenance_worker(state: SharedSnapback, ephemeral: EphemeralApi) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticks = interval(Duration::from_millis(MAINTENANCE_INTERVAL_MS));
        loop {
            ticks.tick().await;
            let now = now_millis();
            // Room-authority TTL sweep: index-driven, off the global mutex
            // (server-side remove deltas are best effort — clients also prune
            // by TTL, LLP 0013 §TTL and leases).
            ephemeral.cleanup_expired(now);
            // The journal prune is rusqlite work — off the async worker (L7).
            with_snapback(&state, move |snapback| {
                snapback.reap_stale_connections(now, CONNECTION_IDLE_TTL_MS);
                // Best-effort; a transient prune error is retried next tick.
                let _ =
                    snapback.prune_change_journal(now, JOURNAL_RETAIN_VERSIONS, JOURNAL_RETAIN_MS);
            })
            .await;
        }
    })
}

pub fn spawn_cron_scheduler(state: SharedSnapback) -> JoinHandle<()> {
    tokio::spawn(async move {
        // Clone the activity flag once, then poll it lock-free. When no cron
        // jobs are loaded the tick takes the global lock zero times — idle
        // means idle.
        //
        // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L5.
        let cron_active = state.lock().await.cron_activity_flag();
        let dispatch_limit = configured_cron_dispatch_concurrency(
            std::env::var("SNAPBACK_CRON_DISPATCH_CONCURRENCY")
                .ok()
                .as_deref(),
        );
        let dispatcher = Arc::new(Semaphore::new(dispatch_limit));
        let mut ticks = interval(Duration::from_secs(1));
        loop {
            ticks.tick().await;
            if !cron_active.load(std::sync::atomic::Ordering::Relaxed) {
                continue;
            }
            // Claim and dispatch, then resume polling without awaiting action
            // completion. The shared semaphore bounds all automatic runs
            // across ticks; the per-job active-run ceiling bounds Allow
            // ownership, and the action limiter remains the final native
            // thread admission gate.
            let now = now_millis();
            if let Err(error) =
                dispatch_cron_tick_background(&state, &dispatcher, dispatch_limit, now).await
            {
                // Tick-machinery errors go to the diagnostics ring; the
                // recording is memory-only, so an inline lock is fine (the
                // same argument as disconnect's inline lock).
                state.lock().await.record_cron_tick_error(error);
            }
        }
    })
}

async fn local_dev_cors(request: Request<Body>, next: Next) -> Response {
    // @ref LLP 0025#demo-shape — web-only demos may be served by an ordinary
    // static/Vite origin while talking to the local Snapback server.
    let allowed_origin = loopback_origin(request.headers().get(header::ORIGIN));
    if request.method() == Method::OPTIONS {
        return with_cors_headers(StatusCode::NO_CONTENT.into_response(), allowed_origin);
    }
    with_cors_headers(next.run(request).await, allowed_origin)
}

fn with_cors_headers(mut response: Response, allowed_origin: Option<HeaderValue>) -> Response {
    let headers = response.headers_mut();
    if let Some(origin) = allowed_origin {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static(
            "content-type, authorization, x-snapback-admin-token, x-snapback-connection-token",
        ),
    );
    response
}

fn loopback_origin(origin: Option<&HeaderValue>) -> Option<HeaderValue> {
    let origin = origin?.to_str().ok()?;
    let allowed = [
        "http://127.0.0.1:",
        "https://127.0.0.1:",
        "http://localhost:",
        "https://localhost:",
        "http://[::1]:",
        "https://[::1]:",
    ];
    allowed
        .iter()
        .any(|prefix| origin.starts_with(prefix))
        .then(|| HeaderValue::from_str(origin).ok())
        .flatten()
}

/// `/health` prefers the lock-free read lane (a busy write must not make the
/// instance look down); in-memory instances fall back to the write lane.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
async fn health(
    State(state): State<SharedSnapback>,
    State(read): State<crate::local::ReadLane>,
) -> Result<Json<HealthResponse>, ApiError> {
    let (version, capabilities) = if read.available() {
        let health = with_read_lane(&read, |lane| lane.health()).await?;
        (health.version, health.capabilities)
    } else {
        let inspect = with_snapback(&state, |snapback| snapback.inspect()).await?;
        (inspect.storage.version, inspect.runtime)
    };
    Ok(Json(HealthResponse {
        ok: true,
        target: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
        sqlite_version: version,
        ibex_available: capabilities.ibex_cli.available
            || capabilities.ibex_ctx_db_host_bridge == CapabilityState::Available,
        binary: crate::identity::binary_identity(),
    }))
}

/// Public `/inspect` — the trimmed identity descriptor. Operational and posture
/// facts (connection ids, the on-disk DB path) live only in the gated
/// `/_snapback/api/inspect` twin.
///
/// @ref LLP 0031#resolved-decisions — D3: the public payload is a typed projection of `InspectState`.
async fn inspect(
    State(state): State<SharedSnapback>,
) -> Result<Json<crate::local::PublicInspect>, ApiError> {
    let inspect = with_snapback(&state, |snapback| snapback.inspect()).await?;
    Ok(Json(inspect.into()))
}

/// The v0 admin aliases perform system writes, so they share the
/// `/_snapback/*` write gate until LLP 0031's gated twins land and these
/// aliases retire.
///
/// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S0: the root
/// admin aliases fail closed like their `/_snapback/*` twins on every bind.
async fn apply_schema(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(manifest): Json<SchemaManifest>,
) -> Result<Json<DiagnosticsResponse>, ApiError> {
    crate::admin::authorize_operation(&ctx, &headers, "schema.load", None)?;
    crate::admin::require_operation_profile(&ctx, "schema.load", false)?;
    let diagnostics =
        with_snapback(&state, move |snapback| snapback.apply_schema(manifest)).await?;
    Ok(Json(DiagnosticsResponse { diagnostics }))
}

async fn load_functions(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(manifest): Json<FunctionManifest>,
) -> Result<Json<DiagnosticsResponse>, ApiError> {
    crate::admin::authorize_operation(&ctx, &headers, "functions.load", None)?;
    crate::admin::require_operation_profile(&ctx, "functions.load", false)?;
    let diagnostics =
        with_snapback(&state, move |snapback| snapback.load_functions(manifest)).await;
    // @ref LLP 0036#the-setup-wizard-d3 — the printed line is the install
    // instruction: a manifest that declares required config the store cannot
    // satisfy points the operator straight at the wizard.
    let missing = with_snapback(&state, |snapback| snapback.required_missing_config()).await;
    if !missing.is_empty() {
        println!(
            "config: {} required entr{} missing ({}) → http://{}:{}/_snapback/admin/setup",
            missing.len(),
            if missing.len() == 1 { "y" } else { "ies" },
            missing.join(", "),
            ctx.host,
            ctx.port,
        );
    }
    Ok(Json(DiagnosticsResponse { diagnostics }))
}

/// `config.status` — the LLP 0036 status primitive: declared × set ×
/// verified × applied, names and states only. Read-gated like inspect.
async fn config_status(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
) -> Result<Json<crate::local::ConfigStatus>, ApiError> {
    crate::admin::authorize(&ctx, &headers, false)?;
    let status = with_snapback(&state, |snapback| snapback.config_status()).await;
    Ok(Json(status))
}

#[derive(Debug, Default, Deserialize)]
struct ConfigPlanQuery {
    #[serde(default)]
    entry: Option<String>,
}

/// `config.plan` — dry-run facts: write locus, apply boundary, and whether
/// this transport would accept a value write. Nearly free locally; pins the
/// contract hosted targets need.
async fn config_plan(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Query(query): Query<ConfigPlanQuery>,
) -> Result<Json<crate::local::ConfigPlan>, ApiError> {
    crate::admin::authorize(&ctx, &headers, false)?;
    let value_writes_accepted = ctx.loopback;
    let plan = with_snapback(&state, move |snapback| {
        snapback.config_plan(query.entry.as_deref(), value_writes_accepted)
    })
    .await?;
    Ok(Json(plan))
}

#[derive(Debug, Deserialize)]
struct ConfigSetBody {
    entry: String,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    values: Option<Vec<String>>,
    #[serde(default)]
    append: bool,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConfigEntryBody {
    entry: String,
    #[serde(default)]
    source: Option<String>,
}

/// The audited write sources (LLP 0036 §Operations and projections). Anything
/// unrecognized is recorded as plain `http`.
fn sanitize_config_source(source: Option<String>) -> String {
    match source.as_deref() {
        Some(source @ ("wizard" | "cli" | "mcp" | "agent" | "http")) => source.to_owned(),
        _ => "http".to_owned(),
    }
}

/// @ref LLP 0036#the-store-and-the-target-seam-d1-d2-d7 — the transit rule:
/// value-carrying writes are accepted only over loopback or TLS, and this
/// local server terminates no TLS, so a non-loopback bind refuses them. An
/// SSH tunnel (loopback at the server) is the blessed remote path.
fn require_value_write_transport(ctx: &ServerContext) -> Result<(), ApiError> {
    if ctx.loopback {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_CONFIG_TRANSIT_RULE",
        "config",
        "value-carrying config writes are accepted only over loopback or TLS; this bind is \
         non-loopback plaintext — use an SSH tunnel to the instance instead",
    )
    .into())
}

/// `config.set` — set a declared entry or add a pool member. Values never
/// appear in the response, the diagnostics ring, or any log line.
async fn config_set(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(body): Json<ConfigSetBody>,
) -> Result<Json<crate::local::ConfigWriteOutcome>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    require_value_write_transport(&ctx)?;
    let values = match (body.value, body.values) {
        (Some(value), None) => vec![value],
        (None, Some(values)) => values,
        _ => {
            return Err(SnapbackError::error(
                "SNAPBACK_CONFIG_VALUE_INVALID",
                "config",
                "provide exactly one of value or values",
            )
            .into());
        }
    };
    let entry = body.entry;
    let append = body.append;
    let source = sanitize_config_source(body.source);
    let outcome = with_snapback(&state, move |snapback| {
        snapback.set_config_entry(&entry, values, append, &source)
    })
    .await?;
    Ok(Json(outcome))
}

/// `config.unset` — remove an entry's stored value. Carries no value, so the
/// transit rule does not apply; the admin write gate does.
async fn config_unset(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(body): Json<ConfigEntryBody>,
) -> Result<Json<crate::local::ConfigWriteOutcome>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    let entry = body.entry;
    let source = sanitize_config_source(body.source);
    let outcome = with_snapback(&state, move |snapback| {
        snapback.unset_config_entry(&entry, &source)
    })
    .await?;
    Ok(Json(outcome))
}

/// `config.verify` — run the entry's probe action under the cooldown.
///
/// Entry checks and the cooldown claim stage under the lock; an Ibex probe
/// then runs detached under the action watchdog so a hung probe fetch cannot
/// wedge the instance, and a second short lock window records the
/// verification outcome (ENG-23493, the same staged flow as ENG-23324).
async fn config_verify(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(body): Json<ConfigEntryBody>,
) -> Result<Json<crate::local::ConfigVerifyOutcome>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    let entry = body.entry;
    let staged = {
        let entry = entry.clone();
        with_snapback(&state, move |snapback| snapback.stage_config_verify(&entry)).await?
    };
    let outcome = match staged {
        StagedConfigVerify::Done(outcome) => *outcome,
        StagedConfigVerify::Ready(stage) => {
            let ConfigVerifyStage {
                probe,
                entry_revision,
                started_ms,
                input,
                metadata,
                mode,
            } = *stage;
            let result = match mode {
                StagedAction::Detached(action) => {
                    run_detached_ibex_action(&state, action, input, metadata).await
                }
                StagedAction::InLock => {
                    with_snapback(&state, move |snapback| {
                        snapback.invoke_action(&probe, input, metadata)
                    })
                    .await
                }
            };
            with_snapback(&state, move |snapback| {
                snapback.finish_config_verify(&entry, entry_revision, started_ms, result)
            })
            .await?
        }
    };
    Ok(Json(outcome))
}

/// The host-ops operation endpoint (LLP 0032 P6): every served operation goes
/// through one gate and returns one `hostOpsResult` envelope. Transport is a
/// projection — HTTP is always 200 once an envelope exists; `ok` and
/// `diagnostics[]` carry the outcome (LLP 0024 §Result Envelope).
async fn host_ops_handler(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(request): Json<crate::host_ops::HostOpsRequest>,
) -> Result<Json<crate::host_ops::HostOpsResult>, ApiError> {
    let server_url = Some(format!("http://{}:{}", ctx.host, ctx.port));
    let profile = ctx.profile;
    let result = with_snapback(&state, move |snapback| -> Result<_, ApiError> {
        let function_kind = request
            .function
            .as_deref()
            .and_then(|name| snapback.function_kind(name));
        crate::admin::authorize_operation(
            &ctx,
            &headers,
            &request.operation,
            function_kind.as_ref(),
        )?;
        Ok(crate::host_ops::execute_host_op_with_profile(
            snapback, request, server_url, profile,
        ))
    })
    .await?;
    Ok(Json(result))
}

/// `app.reset` — the gated system write that resets the instance and, per
/// LLP 0024/LLP 0031 D5, optionally seeds it in the same call. Seed is folded
/// in here rather than living as a standalone route, so an empty body resets
/// and `{ "seed": … }` resets-then-seeds.
///
/// @ref LLP 0031#resolved-decisions — D5: seed is an optional argument to `app.reset`, not a fourth route.
async fn app_reset(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<AppResetResponse>, ApiError> {
    crate::admin::authorize_operation(&ctx, &headers, "app.reset", None)?;
    crate::admin::require_operation_profile(&ctx, "app.reset", false)?;
    let seed = parse_optional_json::<AppResetBody>(&headers, body)?.and_then(|body| body.seed);
    let seeded = with_snapback(&state, move |snapback| snapback.reset_with_seed(seed)).await?;
    Ok(Json(AppResetResponse { seeded }))
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct AppResetBody {
    #[serde(default)]
    seed: Option<SeedData>,
}

#[derive(Debug, Serialize)]
struct AppResetResponse {
    seeded: Option<crate::manifest::MutationOutput>,
}

/// Deliberately explicit selector for destructive exactly-once-ledger
/// recovery. An empty object is rejected: an operator must name one resolved
/// auth context or affirm that every retained settlement should be removed.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientMutationPurgeBody {
    #[serde(default)]
    auth: Option<AuthInput>,
    #[serde(default)]
    all: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientMutationPurgeResponse {
    purged: u64,
}

async fn purge_client_mutation_settlements(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    input: Result<Json<ClientMutationPurgeBody>, JsonRejection>,
) -> Result<Json<ClientMutationPurgeResponse>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    let Json(body) = input.map_err(ApiError::from_json_rejection)?;
    let auth = match (body.auth, body.all) {
        (Some(auth), false) => Some(auth),
        (None, true) => None,
        _ => {
            return Err(SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_PURGE_SELECTOR_INVALID",
                "sync",
                "choose exactly one purge selector: auth or all=true",
            )
            .into());
        }
    };
    let purged = with_snapback(&state, move |snapback| {
        snapback.purge_client_mutation_settlements(auth.as_ref())
    })
    .await?;
    Ok(Json(ClientMutationPurgeResponse { purged }))
}

fn parse_optional_json<T: serde::de::DeserializeOwned>(
    headers: &HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Option<T>, ApiError> {
    let body = body.map_err(|error| ApiError::request_json_invalid(error.to_string()))?;
    if body.is_empty() {
        return Ok(None);
    }
    let is_json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
    if !is_json {
        return Err(ApiError::request_json_invalid(
            "nonempty request body requires Content-Type: application/json",
        ));
    }
    let value: Value = serde_json::from_slice(&body)
        .map_err(|error| ApiError::request_json_invalid(error.to_string()))?;
    if !value.is_object() {
        return Err(ApiError::request_json_invalid(
            "request body must be a JSON object",
        ));
    }
    // Deserialize the original bytes so serde's typed visitor still observes
    // duplicate object keys. Converting the intermediate Value into T would
    // collapse duplicates first and silently let the last destructive/reset
    // or capability field win.
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|error| ApiError::request_json_invalid(error.to_string()))
}

/// `/query/{name}` runs on the lock-free read lane when the instance is
/// file-backed: a pooled WAL reader inside a pinned read transaction, so
/// queries proceed during long writes. In-memory instances (no WAL) keep the
/// serialized write-lane path.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
async fn invoke_query(
    State(state): State<SharedSnapback>,
    State(read): State<crate::local::ReadLane>,
    Path(name): Path<String>,
    input: Result<Json<HandlerInput>, JsonRejection>,
) -> Result<Json<crate::manifest::QueryOutput>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    let output = if read.available() {
        with_read_lane(&read, move |lane| lane.invoke_query(&name, input)).await?
    } else {
        with_snapback(&state, move |snapback| snapback.invoke_query(&name, input)).await?
    };
    Ok(Json(output))
}

/// Standalone authenticated settlement acknowledgement. A consumed replay
/// result must be reclaimable even when it was the client's final mutation;
/// requiring a later write to piggyback the ACK otherwise strands every
/// one-shot client's durable result indefinitely.
async fn acknowledge_mutations(
    State(state): State<SharedSnapback>,
    input: Result<Json<MutationAcknowledgementRequest>, JsonRejection>,
) -> Result<Json<MutationAcknowledgementResponse>, ApiError> {
    let Json(request) = input.map_err(ApiError::from_json_rejection)?;
    let acknowledged = with_snapback(&state, move |snapback| {
        snapback.acknowledge_client_mutations(&request.auth, &request.client_mutation_ids)
    })
    .await?;
    Ok(Json(MutationAcknowledgementResponse { acknowledged }))
}

/// Mutations respond with the MutationOutput fields plus the provider-core
/// MutationReceipt (LLP 0034 §3.2, ENG-22478). A REJECTED mutation still
/// produces a receipt; it rides the error envelope.
async fn invoke_mutation(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    input: Result<Json<MutationRequest>, JsonRejection>,
) -> Result<Json<MutationResponse>, ApiError> {
    let Json(request) = input.map_err(ApiError::from_json_rejection)?;
    if let Some(current_id) = request.client_mutation_id.as_deref()
        && request
            .acknowledged_client_mutation_ids
            .iter()
            .any(|acknowledged| acknowledged == current_id)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_ACK_OVERLAP",
            "sync",
            "the current client mutation id cannot be acknowledged by the same request",
        )
        .with_details(json!({ "clientMutationId": current_id }))
        .into());
    }
    if !request.acknowledged_client_mutation_ids.is_empty() {
        let auth = request.input.auth.clone();
        let ids = request.acknowledged_client_mutation_ids.clone();
        with_snapback(&state, move |snapback| {
            snapback.acknowledge_client_mutations(&auth, &ids)
        })
        .await?;
    }
    // Receipt emission rides the L7 blocking offload: the recording call
    // (Hermes eval + rusqlite) runs via with_snapback, and the envelope is
    // assembled from its (result, receipt) pair back on the async side.
    let (result, receipt) = with_snapback(&state, move |snapback| {
        snapback.invoke_mutation_recording_with_id(
            &name,
            request.input,
            request.client_mutation_id,
            "http",
        )
    })
    .await;
    match result {
        Ok(output) => Ok(Json(MutationResponse::from_output(output, receipt))),
        Err(error) => Err(ApiError::with_receipt(error, receipt)),
    }
}

/// App-data action runner for side-effectful app work that is not a transaction:
/// browser clients can trigger action egress without reaching through the admin
/// function runner, while writes still happen only through declared mutations.
///
/// Ibex actions are staged under the lock, then run detached from it under a
/// wall-clock watchdog, so a hung outbound fetch cannot wedge the instance.
///
/// @ref LLP 0031#the-invariant — app-data routes live at the root.
/// @ref LLP 0028#open-questions — per-request app actions
/// include the All Aboard walk/bike routing call, not just cron jobs.
/// @ref LLP 0028#execution-the-action-class — ENG-23324 detached execution.
async fn invoke_action(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    input: Result<Json<HandlerInput>, JsonRejection>,
) -> Result<Json<crate::local::FunctionRunResult>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    let staged = {
        let name = name.clone();
        with_snapback(&state, move |snapback| snapback.stage_app_action(&name)).await
    };
    let result = match staged {
        StagedAppAction::Done(result) => *result,
        StagedAppAction::Ready(stage) => {
            run_staged_app_action(&state, &name, input, stage, "action").await
        }
    };
    Ok(Json(result))
}

/// The mount-lifecycle ensure-everything operation (LLP 0034 §5 / ENG-22527):
/// app-data at the root like the ephemeral ensure it generalizes — idempotent
/// and non-destructive by construction; the PROVISIONING half is gated by the
/// server profile (prod inspects and reports 'gated' instead of writing).
async fn ensure_app(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    input: Result<Json<crate::local::EnsureAppInput>, JsonRejection>,
) -> Result<Json<crate::local::EnsureAppOutcome>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    let provisioning_allowed = ctx.profile.allows_provisioning();
    let profile = ctx.profile.as_str().to_owned();
    let outcome = with_snapback(&state, move |snapback| {
        snapback.ensure_app(input, provisioning_allowed, &profile)
    })
    .await?;
    Ok(Json(outcome))
}

async fn subscribe_live(
    State(state): State<SharedSnapback>,
    State(connections): State<ConnectionRegistry>,
    Path(name): Path<String>,
    headers: HeaderMap,
    input: Result<Json<LiveSubscribeInput>, JsonRejection>,
) -> Result<Json<crate::local::LiveSubscribeOutput>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    connections.verify(
        &input.connection_id,
        header_connection_token(&headers).as_deref(),
    )?;
    let output = with_snapback(&state, move |snapback| {
        snapback.subscribe_live(&name, input)
    })
    .await?;
    Ok(Json(output))
}

async fn resume_live(
    State(state): State<SharedSnapback>,
    State(connections): State<ConnectionRegistry>,
    Path(name): Path<String>,
    headers: HeaderMap,
    input: Result<Json<LiveResumeInput>, JsonRejection>,
) -> Result<Json<crate::local::LiveResumeOutput>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    connections.verify(
        &input.connection_id,
        header_connection_token(&headers).as_deref(),
    )?;
    let output = with_snapback(&state, move |snapback| snapback.resume_live(&name, input)).await?;
    Ok(Json(output))
}

async fn unsubscribe_live(
    State(state): State<SharedSnapback>,
    State(connections): State<ConnectionRegistry>,
    Path(name): Path<String>,
    headers: HeaderMap,
    input: Result<Json<LiveUnsubscribeInput>, JsonRejection>,
) -> Result<Json<crate::local::LiveUnsubscribeOutput>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    connections.verify(
        &input.connection_id,
        header_connection_token(&headers).as_deref(),
    )?;
    // L7 offload: disposal reads the storage version (rusqlite) for its
    // receipt, so it runs on the blocking lane like every other write path.
    let output = with_snapback(&state, move |snapback| {
        snapback.unsubscribe_live(&name, input)
    })
    .await?;
    Ok(Json(output))
}

async fn stream_live(
    State(state): State<SharedSnapback>,
    State(ephemeral): State<EphemeralApi>,
    State(connections): State<ConnectionRegistry>,
    Path(connection_id): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // The token gate runs BEFORE the upgrade: an unauthorized caller gets the
    // structured 401/403 diagnostic, never a socket. Browser WebSockets cannot
    // set headers, so the token rides the
    // `snapback.connection-token.<token>` subprotocol instead. Query-string
    // credentials are intentionally ignored because URLs leak into logs,
    // history, proxies, and telemetry (ENG-24354).
    let presented =
        header_connection_token(&headers).or_else(|| subprotocol_connection_token(&headers));
    if let Err(error) = connections.verify(&connection_id, presented.as_deref()) {
        return error.into_response();
    }
    // Select the negotiated subprotocol when offered (a browser fails the
    // connection if it offered subprotocols and the server echoed none).
    ws.max_message_size(MAX_LIVE_SOCKET_FRAME_BYTES)
        .max_frame_size(MAX_LIVE_SOCKET_FRAME_BYTES)
        .protocols([LIVE_STREAM_SUBPROTOCOL])
        .on_upgrade(move |socket| live_stream(socket, state, ephemeral, connections, connection_id))
}

async fn live_stream(
    socket: WebSocket,
    state: SharedSnapback,
    ephemeral: EphemeralApi,
    connections: ConnectionRegistry,
    connection_id: String,
) {
    let (mut sender, mut receiver) = socket.split();
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L8: an enqueue
    // wakes this task immediately (sub-poll-interval delivery, and no periodic
    // lock traffic while idle). The long interval is a safety net only, in case
    // a wake is ever missed; register before draining so no push is lost.
    let notify = ephemeral.delivery_notifier();
    let (generation, waker) = notify.register(&connection_id);
    // Delivery is event-driven (the 25ms poll is gone); this heartbeat is only a
    // defensive fallback if a wake is ever missed. At 30s it is ~1200× less lock
    // traffic than the old poll, so an idle connection is effectively idle.
    let mut safety_net = interval(Duration::from_secs(30));
    safety_net.tick().await; // consume the immediate first tick

    // Flush anything enqueued before (or racing) registration, then rely on
    // wakeups. Enqueues are no longer serialized by the global mutex (L9);
    // the no-lost-wakeup argument is push-before-wake at every enqueue site
    // plus this register-before-first-drain: a push the drain below misses
    // happened after the drain took the outbox lock, and its wake then finds
    // the already-registered waker and stores a permit.
    if !connections.touch_verified_socket(&connection_id)
        || !notify.is_current(&connection_id, generation)
        || drain_and_send(&ephemeral, &connection_id, &mut sender)
            .await
            .is_break()
    {
        teardown_live_stream(&state, &notify, &connection_id, generation).await;
        return;
    }

    // @ref LLP 0020#phase-4-upgrade-realtime-from-v0-outbox-to-app-grade-live-delivery — WebSocket push is a transport over the existing ordered live queue; deterministic drain stays available for tests.
    'stream: loop {
        let drain = tokio::select! {
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(Message::Text(text))) => {
                        if !connections.touch_verified_socket(&connection_id) {
                            break 'stream;
                        }
                        let response = handle_live_socket_text(&ephemeral, &connection_id, &text);
                        if sender.send(Message::Text(response.into())).await.is_err() {
                            break 'stream;
                        }
                        false
                    }
                    // A protocol Ping/Pong from the peer is client-initiated
                    // liveness for the L2 reaper (ENG-23424) — most
                    // importantly the Pong answering the safety-net Ping
                    // below, which every conforming peer sends even when the
                    // app is otherwise idle. (Ephemeral text ops touch
                    // activity through their EphemeralApi calls; `live_ping`
                    // stays deliberately stateless.)
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {
                        if !connections.touch_verified_socket(&connection_id) {
                            break 'stream;
                        }
                        ephemeral.touch_connection(&connection_id);
                        false
                    }
                    Some(Ok(Message::Binary(_))) => {
                        if !connections.touch_verified_socket(&connection_id) {
                            break 'stream;
                        }
                        false
                    },
                }
            }
            _ = waker.notified() => {
                if !connections.touch_verified_socket(&connection_id) {
                    break 'stream;
                }
                true
            },
            _ = safety_net.tick() => {
                // ENG-23424: probe the peer, don't just drain. A peer that
                // vanished without FIN/RST (suspend, cable pull) never errors
                // on an *empty* drain — no bytes are written — so without this
                // Ping the task would live forever. The Ping forces socket
                // I/O every 30s: a dead peer surfaces a send error within the
                // TCP retransmission timeout, and a live one answers with a
                // Pong that refreshes its activity above.
                if !connections.touch_verified_socket(&connection_id)
                    || sender.send(Message::Ping(Vec::new().into())).await.is_err()
                {
                    break 'stream;
                }
                true
            }
        };
        if drain {
            // ENG-23425: a superseded task must not drain. The outbox is
            // keyed by connection id alone, so after a reconnect replaces
            // this registration the queued messages belong to the NEW
            // socket's task — draining them here writes them into a dead,
            // half-open socket (or discards them on send failure) and they
            // never reach the live client. Exit instead; the
            // generation-guarded teardown below then skips `disconnect`,
            // leaving the new socket's registration and subscriptions intact.
            if !notify.is_current(&connection_id, generation) {
                break 'stream;
            }
            if drain_and_send(&ephemeral, &connection_id, &mut sender)
                .await
                .is_break()
            {
                break 'stream;
            }
        }
    }

    teardown_live_stream(&state, &notify, &connection_id, generation).await;
}

/// Generation-guarded stream teardown (LLP 0034 review fix 1): a task tears a
/// connection down ONLY while its registration still owns the connection. A
/// reconnect reuses the connection id — the new socket's `register` supersedes
/// this task's generation — and a half-open old socket can die arbitrarily
/// late; without the guard its teardown would remove the NEW socket's waker
/// and destroy the NEW subscriptions while the new socket keeps answering
/// pings (permanent silent staleness reported as 'live').
///
/// The ownership check is atomic with the destructive act (ENG-23426): the
/// global mutex is acquired FIRST and `unregister` runs under it. Unregister-
/// before-lock was check-then-act — a reconnect that registered and
/// re-subscribed during the (unbounded, behind any slow write) mutex await
/// got its fresh state wiped by the stalled task. A reconnect's durable
/// `subscribe_live` serializes behind this same mutex and its socket
/// registers before it re-subscribes, so a fresh durable subscription always
/// implies a registration this unregister then fails on. WS-lane ephemeral
/// subscribes bypass the mutex entirely; `disconnect_guarded` covers them by
/// re-verifying ownership under each room/outbox lock as it wipes.
async fn teardown_live_stream(
    state: &SharedSnapback,
    notify: &crate::ephemeral::DeliveryNotifier,
    connection_id: &str,
    generation: u64,
) {
    // Fast path: a task that already knows it is superseded (ENG-23425 exits,
    // pre-drain supersession) never contends on the global mutex.
    if !notify.is_current(connection_id, generation) {
        return;
    }
    let mut snapback = state.lock().await;
    if !notify.unregister(connection_id, generation) {
        return;
    }
    snapback.disconnect_guarded(connection_id, now_millis());
}

/// Drain a connection's outbox and send each message. The drain reaches the
/// room authority's per-connection queue directly — no global mutex (L9).
/// Returns `Break` if the socket send failed (the caller should tear down).
async fn drain_and_send(
    ephemeral: &EphemeralApi,
    connection_id: &str,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) -> std::ops::ControlFlow<()> {
    let messages = ephemeral.drain_live_stream(connection_id);
    for message in messages {
        if sender.send(Message::Text(message.into())).await.is_err() {
            return std::ops::ControlFlow::Break(());
        }
    }
    std::ops::ControlFlow::Continue(())
}

// `LiveSocketClientMessage` moved to `crate::live_wire` (LLP 0051 D4 /
// ENG-23891): the client→server socket family is schema-governed now,
// generated into `schemas/live.socket-client.schema.json` and drift-gated.
// The `frame_connection != connection_id` sender gate below is unchanged.

/// The serde tag each live-socket message is classified under. This exhaustive
/// match is the forcing function for LLP 0031's WebSocket rule: a new
/// `LiveSocketClientMessage` variant fails to compile here until it is named,
/// and the enforcement test asserts every name is a registered **app-data**
/// operation — so a system-authority message kind cannot be smuggled onto the
/// app-data `/live/*` socket.
///
/// @ref LLP 0031#enforcement — enumerate the accepted socket variants; fail if any is not app-data.
#[cfg(test)]
fn live_socket_operation_name(message: &LiveSocketClientMessage) -> &'static str {
    match message {
        LiveSocketClientMessage::EphemeralSubscribe { .. } => "ephemeral_subscribe",
        LiveSocketClientMessage::EphemeralPublish { .. } => "ephemeral_publish",
        LiveSocketClientMessage::EphemeralDelete { .. } => "ephemeral_delete",
        LiveSocketClientMessage::EphemeralUnsubscribe { .. } => "ephemeral_unsubscribe",
        LiveSocketClientMessage::Ping { .. } => "live_ping",
    }
}

/// Handle a socket-text operation. Ephemeral operations reach the room
/// authority directly — a busy mutation holding the global write mutex cannot
/// delay a cursor publish on this socket (LLP 0032 L9).
fn handle_live_socket_text(ephemeral: &EphemeralApi, connection_id: &str, text: &str) -> String {
    if text.len() > MAX_LIVE_SOCKET_FRAME_BYTES {
        return socket_error(
            None,
            "decode",
            Diagnostic::error(
                "SNAPBACK_WEBSOCKET_MESSAGE_TOO_LARGE",
                "realtime",
                "WebSocket message exceeded the ephemeral control-frame limit",
            )
            .with_details(json!({
                "bytes": text.len(),
                "maxBytes": MAX_LIVE_SOCKET_FRAME_BYTES,
            })),
        );
    }
    let message = match serde_json::from_str::<LiveSocketClientMessage>(text) {
        Ok(message) => message,
        Err(error) => {
            return socket_error(
                None,
                "decode",
                Diagnostic::error(
                    "SNAPBACK_WEBSOCKET_MESSAGE_INVALID",
                    "realtime",
                    "WebSocket message could not be decoded",
                )
                .with_details(json!({ "error": error.to_string() })),
            );
        }
    };

    // Liveness probe: answered immediately and statelessly (no lock, no
    // connection binding to check — the probe carries no connection_id and
    // performs no operation on connection state).
    if let LiveSocketClientMessage::Ping { request_id } = &message {
        return socket_pong(request_id.clone());
    }

    // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S3: a socket
    // may only speak for its own connection; the client-chosen connection_id
    // inside a frame is bound to the socket identity, never trusted.
    let (frame_request_id, frame_operation, frame_connection) = match &message {
        LiveSocketClientMessage::EphemeralSubscribe {
            request_id,
            request,
        } => (request_id.clone(), "subscribe", &request.connection_id),
        LiveSocketClientMessage::EphemeralPublish {
            request_id,
            request,
        } => (request_id.clone(), "publish", &request.connection_id),
        LiveSocketClientMessage::EphemeralDelete {
            request_id,
            request,
        } => (request_id.clone(), "delete", &request.connection_id),
        LiveSocketClientMessage::EphemeralUnsubscribe {
            request_id,
            request,
        } => (request_id.clone(), "unsubscribe", &request.connection_id),
        LiveSocketClientMessage::Ping { .. } => unreachable!("handled above"),
    };
    if frame_connection != connection_id {
        return socket_error(
            frame_request_id,
            frame_operation,
            Diagnostic::error(
                "SNAPBACK_WEBSOCKET_SENDER_MISMATCH",
                "realtime",
                "message connection_id does not match this socket's connection",
            )
            .with_details(json!({
                "socket_connection_id": connection_id,
                "message_connection_id": frame_connection,
            })),
        );
    }

    match message {
        LiveSocketClientMessage::EphemeralSubscribe {
            request_id,
            request,
        } => match ephemeral.subscribe(request, now_millis()) {
            Ok(message) => socket_ack(request_id, "subscribe", json!({ "message": message })),
            Err(error) => socket_error(request_id, "subscribe", diagnostic_from_ephemeral(error)),
        },
        LiveSocketClientMessage::EphemeralPublish {
            request_id,
            request,
        } => match ephemeral.publish(request, now_millis()) {
            Ok(outcome) => socket_ack(request_id, "publish", json!({ "outcome": outcome })),
            Err(error) => socket_error(request_id, "publish", diagnostic_from_ephemeral(error)),
        },
        LiveSocketClientMessage::EphemeralDelete {
            request_id,
            request,
        } => match ephemeral.delete(request, now_millis()) {
            Ok(message) => socket_ack(request_id, "delete", json!({ "message": message })),
            Err(error) => socket_error(request_id, "delete", diagnostic_from_ephemeral(error)),
        },
        LiveSocketClientMessage::EphemeralUnsubscribe {
            request_id,
            request,
        } => {
            let receipt_scope = request.scope.clone();
            let collection = request.collection.clone();
            match ephemeral.unsubscribe(request, now_millis()) {
                Ok(removed) => {
                    let receipt = ephemeral_unsubscribe_receipt(
                        &collection,
                        &receipt_scope,
                        removed,
                        now_millis(),
                    );
                    socket_ack(
                        request_id,
                        "unsubscribe",
                        json!({ "removed": removed, "receipt": receipt }),
                    )
                }
                Err(error) => {
                    socket_error(request_id, "unsubscribe", diagnostic_from_ephemeral(error))
                }
            }
        }
        LiveSocketClientMessage::Ping { .. } => unreachable!("handled above"),
    }
}

/// The disposal receipt for an ephemeral unsubscribe (ENG-22527 item 3). Shape
/// matches the durable subscription-disposal receipts (kind `subscription`,
/// lane `ephemeral`): the kit records it client-side so an idle-linger
/// teardown is observable. Privacy (§3.3): opaque ids, scope, and a boolean —
/// never a payload value.
fn ephemeral_unsubscribe_receipt(
    collection: &str,
    scope: &Scope,
    removed: bool,
    now_ms: u64,
) -> Value {
    Receipt::Subscription {
        event: SubscriptionReceiptEvent::Disposed,
        reason: Some("unsubscribed".to_owned()),
        subscription_id: None,
        superseded_by: None,
        lane: Some("ephemeral".to_owned()),
        binding_id: Some(collection.to_owned()),
        collection: Some(collection.to_owned()),
        removed: Some(removed),
        scope: serde_json::to_value(scope).unwrap_or(Value::Null),
        snapshot_version: None,
        correlation: None,
        received_at_ms: now_ms,
    }
    .into_value()
}

/// The `live_ping` response envelope. `serverTimeMs` lets a client measure
/// round-trip freshness against its heartbeat budget (LLP 0034 §2.2: `live` =
/// heartbeat within budget; `stale` = budget missed while retrying).
fn socket_pong(request_id: Option<String>) -> String {
    serde_json::to_string(&LiveSocketServerFrame::Pong {
        request_id,
        server_time_ms: now_millis(),
    })
    .unwrap_or_else(|_| "{\"kind\":\"pong\"}".to_owned())
}

fn socket_ack(request_id: Option<String>, operation: &str, body: Value) -> String {
    let body = match body {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    serde_json::to_string(&LiveSocketServerFrame::EphemeralAck {
        request_id,
        operation: operation.to_owned(),
        body,
    })
    .unwrap_or_else(|_| "{\"kind\":\"ephemeral_error\",\"operation\":\"serialize\"}".to_owned())
}

fn socket_error(request_id: Option<String>, operation: &str, diagnostic: Diagnostic) -> String {
    serde_json::to_string(&LiveSocketServerFrame::EphemeralError {
        request_id,
        operation: operation.to_owned(),
        diagnostic,
    })
    .unwrap_or_else(|_| "{\"kind\":\"ephemeral_error\",\"operation\":\"serialize\"}".to_owned())
}

/// Outbox drain reaches the room authority directly — no global mutex (L9).
/// The drain is destructive (a bearerless drain was the ENG-23442 data-theft
/// vector), so it demands the connection token like every connection-scoped
/// operation; polling clients may pass it as `?connection_token=` when headers
/// are inconvenient.
async fn drain_outbox(
    State(ephemeral): State<EphemeralApi>,
    State(connections): State<ConnectionRegistry>,
    Path(connection_id): Path<String>,
    Query(query): Query<ConnectionTokenQuery>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::ephemeral::RealtimeEnvelope>>, ApiError> {
    let presented = header_connection_token(&headers).or(query.connection_token);
    connections.verify(&connection_id, presented.as_deref())?;
    Ok(Json(ephemeral.drain_outbox(&connection_id)))
}

#[derive(Debug, Deserialize)]
struct EnsureEphemeralCollectionsInput {
    #[serde(default)]
    collections: Vec<EphemeralCollection>,
    #[serde(
        default,
        rename = "ephemeralCollections",
        alias = "ephemeral_collections"
    )]
    ephemeral_collections: Vec<EphemeralCollection>,
}

impl EnsureEphemeralCollectionsInput {
    fn into_collections(self) -> Vec<EphemeralCollection> {
        if self.collections.is_empty() {
            self.ephemeral_collections
        } else {
            self.collections
        }
    }
}

/// The ephemeral endpoints reach the sharded room authority directly: no
/// global mutex, so a busy mutation on the write lane cannot delay presence
/// (LLP 0013 §Delivery lanes; LLP 0032 L9). They are pure memory operations —
/// no Hermes, no SQLite — so they run inline on async workers by design (the
/// L7 exec guard's blocking classes do not apply).
async fn ensure_ephemeral_collections(
    State(ephemeral): State<EphemeralApi>,
    input: Result<Json<EnsureEphemeralCollectionsInput>, JsonRejection>,
) -> Result<Json<crate::ephemeral::CollectionEnsureOutcome>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    ephemeral
        .ensure_collections(input.into_collections())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn publish_ephemeral(
    State(ephemeral): State<EphemeralApi>,
    State(connections): State<ConnectionRegistry>,
    headers: HeaderMap,
    request: Result<Json<PublishRequest>, JsonRejection>,
) -> Result<Json<crate::ephemeral::PublishOutcome>, ApiError> {
    let Json(request) = request.map_err(ApiError::from_json_rejection)?;
    connections.verify(
        &request.connection_id,
        header_connection_token(&headers).as_deref(),
    )?;
    ephemeral
        .publish(request, now_millis())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn subscribe_ephemeral(
    State(ephemeral): State<EphemeralApi>,
    State(connections): State<ConnectionRegistry>,
    headers: HeaderMap,
    request: Result<Json<SubscribeRequest>, JsonRejection>,
) -> Result<Json<crate::ephemeral::EphemeralMessage>, ApiError> {
    let Json(request) = request.map_err(ApiError::from_json_rejection)?;
    connections.verify(
        &request.connection_id,
        header_connection_token(&headers).as_deref(),
    )?;
    ephemeral
        .subscribe(request, now_millis())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn delete_ephemeral(
    State(ephemeral): State<EphemeralApi>,
    State(connections): State<ConnectionRegistry>,
    headers: HeaderMap,
    request: Result<Json<DeleteRequest>, JsonRejection>,
) -> Result<Json<Option<crate::ephemeral::EphemeralMessage>>, ApiError> {
    let Json(request) = request.map_err(ApiError::from_json_rejection)?;
    connections.verify(
        &request.connection_id,
        header_connection_token(&headers).as_deref(),
    )?;
    ephemeral
        .delete(request, now_millis())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

/// Connection teardown is instance control (it tears down the connection *and*
/// its durable subscriptions), so it is a gated system write under
/// `/_snapback/api/*`, not a root app route.
///
/// @ref LLP 0031#resolved-decisions — D2: `/connections/{id}/disconnect` is system/control.
async fn disconnect(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Path(connection_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    let mut snapback = state.lock().await;
    snapback.disconnect(&connection_id, now_millis());
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug)]
pub struct ApiError(SnapbackError, Option<Receipt>);

impl ApiError {
    fn from_ephemeral(error: crate::ephemeral::EphemeralError) -> Self {
        Self(SnapbackError::new(diagnostic_from_ephemeral(error)), None)
    }

    fn from_json_rejection(error: JsonRejection) -> Self {
        Self::request_json_invalid(error.to_string())
    }

    fn request_json_invalid(error: impl Into<String>) -> Self {
        Self(
            SnapbackError::error(
                "SNAPBACK_REQUEST_JSON_INVALID",
                "server",
                "request body was not valid JSON for this operation",
            )
            .with_details(json!({ "error": error.into() })),
            None,
        )
    }

    /// Attach a receipt to an error response (a REJECTED mutation still
    /// produces its receipt — LLP 0034 §3.2, ENG-22478).
    fn with_receipt(error: SnapbackError, receipt: Receipt) -> Self {
        Self(error, Some(receipt))
    }
}

fn diagnostic_from_ephemeral(error: crate::ephemeral::EphemeralError) -> Diagnostic {
    let mut diagnostic =
        Diagnostic::error(error.code.diagnostic_code(), "ephemeral", error.message);
    diagnostic.details = json!({ "code": error.code });
    diagnostic
}

impl From<SnapbackError> for ApiError {
    fn from(value: SnapbackError) -> Self {
        Self(value, None)
    }
}

/// Map a diagnostic code to an HTTP status.
///
/// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D10: an
/// internal-error class (5xx) so a client or agent can tell "you erred" (4xx)
/// from "the server erred" (5xx). Client faults are allow-listed; every new or
/// unrecognized code fails conservatively as 500 so a runtime/storage failure
/// can never silently masquerade as bad input (ENG-24357).
fn status_for_diagnostic_code(code: &str) -> StatusCode {
    match code {
        "SNAPBACK_UNKNOWN_FUNCTION" | "SNAPBACK_UNKNOWN_TABLE" | "SNAPBACK_UNKNOWN_FIELD" => {
            StatusCode::NOT_FOUND
        }
        "SNAPBACK_UNKNOWN_CRON_JOB" | "SNAPBACK_UNKNOWN_SUBSCRIPTION" => StatusCode::NOT_FOUND,
        "SNAPBACK_MUTATION_CONFLICT"
        | "SNAPBACK_ACTION_GENERATION_CONFLICT"
        | "SNAPBACK_CONFIG_VERIFY_STALE"
        | "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
        | "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED"
        | "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
        | "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED" => StatusCode::CONFLICT,
        // @ref LLP 0017#security-defaults — admin gating distinguishes "disabled"
        // (forbidden) from "needs the configured token" (unauthorized).
        "SNAPBACK_ADMIN_DISABLED"
        | "SNAPBACK_LIVE_RESUME_OWNERSHIP"
        | "SNAPBACK_CONNECTION_TOKEN_INVALID"
        | "SNAPBACK_PROFILE_FORBIDS" => StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_TOKEN_REQUIRED" | "SNAPBACK_CONNECTION_TOKEN_REQUIRED" => {
            StatusCode::UNAUTHORIZED
        }
        "SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED"
        | "SNAPBACK_EPHEMERAL_RATE_LIMITED"
        | "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT"
        | "SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT" => StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_VALUE_TOO_LARGE"
        | "SNAPBACK_EPHEMERAL_METADATA_TOO_LARGE"
        | "SNAPBACK_EPHEMERAL_VALUE_TOO_LARGE"
        | "SNAPBACK_HANDLER_HOST_CALL_BODY_TOO_LARGE"
        | "SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE"
        | "SNAPBACK_WEBSOCKET_MESSAGE_TOO_LARGE" => StatusCode::PAYLOAD_TOO_LARGE,
        "SNAPBACK_ACTION_TIMEOUT" | "SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED" => {
            StatusCode::GATEWAY_TIMEOUT
        }
        "SNAPBACK_ACTION_CAPACITY_EXCEEDED"
        | "SNAPBACK_CRON_DISPATCH_CAPACITY_EXCEEDED"
        | "SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED"
        | "SNAPBACK_OVERLOADED"
        | "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL"
        | "SNAPBACK_READ_LANE_UNAVAILABLE"
        | "SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING"
        | "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE"
        | "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACT_MISSING"
        | "SNAPBACK_CAPABILITY_MINIFLARE_MISSING"
        | "SNAPBACK_CAPABILITY_WORKERD_MISSING"
        | "SNAPBACK_V8_RUNNER_HOST_UNSUPPORTED" => StatusCode::SERVICE_UNAVAILABLE,
        // Exhaustive allow-list of request, declaration, authorization, and
        // application-handler diagnostics. Adding a new code does not add it
        // here automatically: the default below remains a truthful 500 until
        // its producer deliberately chooses a client class.
        "SNAPBACK_ARG_MISSING"
        | "SNAPBACK_ACTION_MUTATION_REFERENCE_INVALID"
        | "SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED"
        | "SNAPBACK_CLIENT_MUTATION_ACK_LIMIT_EXCEEDED"
        | "SNAPBACK_CLIENT_MUTATION_ACK_OVERLAP"
        | "SNAPBACK_CLIENT_MUTATION_PURGE_SELECTOR_INVALID"
        | "SNAPBACK_AUTH_STALE_RESULT"
        | "SNAPBACK_AUTH_USER_MISSING"
        | "SNAPBACK_BINDING_MISSING"
        | "SNAPBACK_CAPTURED_READ_INVALID"
        | "SNAPBACK_CLIENT_MUTATION_ID_INVALID"
        | "SNAPBACK_CONFIG_DEFAULT_UNIMPLEMENTED"
        | "SNAPBACK_CONFIG_ENTRY_INVALID"
        | "SNAPBACK_CONFIG_MISSING"
        | "SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED"
        | "SNAPBACK_CONFIG_PROBE_INVALID"
        | "SNAPBACK_CONFIG_PROBE_MISSING"
        | "SNAPBACK_CONFIG_REQUIRED_MISSING"
        | "SNAPBACK_CONFIG_TRANSIT_RULE"
        | "SNAPBACK_CONFIG_UNDECLARED"
        | "SNAPBACK_CONFIG_USES_UNKNOWN"
        | "SNAPBACK_CONFIG_VALUE_INVALID"
        | "SNAPBACK_CONFIG_VERIFY_COOLDOWN"
        | "SNAPBACK_CRON_ACTION_KIND_MISMATCH"
        | "SNAPBACK_CRON_ACTION_MISSING"
        | "SNAPBACK_CRON_DUPLICATE_JOB"
        | "SNAPBACK_CRON_INVALID_EXPRESSION"
        | "SNAPBACK_CRON_INVALID_INTERVAL"
        | "SNAPBACK_CRON_INVALID_SCHEDULE"
        | "SNAPBACK_CRON_JITTER_INVALID"
        | "SNAPBACK_CRON_JOB_DISABLED"
        | "SNAPBACK_CRON_JOB_IN_FLIGHT"
        | "SNAPBACK_CRON_JOB_INVALID"
        | "SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED"
        | "SNAPBACK_CRON_TARGET_CADENCE_UNSUPPORTED"
        | "SNAPBACK_CRON_UNSATISFIABLE_EXPRESSION"
        | "SNAPBACK_CRON_WHILE_LIVE_EMPTY"
        | "SNAPBACK_CRON_WHILE_LIVE_KIND_MISMATCH"
        | "SNAPBACK_CRON_WHILE_LIVE_MISSING"
        | "SNAPBACK_CTX_LEDGER_EXHAUSTED"
        | "SNAPBACK_CTX_LEDGER_ID_INVALID"
        | "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED"
        | "SNAPBACK_CTX_LEDGER_UNUSED_IDS"
        | "SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED"
        | "SNAPBACK_DATA_TIER_VERSION_REQUIRED"
        | "SNAPBACK_DATA_TIER_VERSION_UNSUPPORTED"
        | "SNAPBACK_EPHEMERAL_INVALID_SCOPE"
        | "SNAPBACK_EPHEMERAL_INVALID_TTL"
        | "SNAPBACK_EPHEMERAL_MISSING_KEY"
        | "SNAPBACK_EPHEMERAL_MISSING_OWNER"
        | "SNAPBACK_EPHEMERAL_ROOM_LIMIT_EXCEEDED"
        | "SNAPBACK_EPHEMERAL_UNAUTHORIZED"
        | "SNAPBACK_EPHEMERAL_UNKNOWN_COLLECTION"
        | "SNAPBACK_EXPECTED_STRING"
        | "SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED"
        | "SNAPBACK_EXPLAIN_KIND_UNKNOWN"
        | "SNAPBACK_EXPR_TYPE"
        | "SNAPBACK_EXPR_UNANALYZABLE"
        | "SNAPBACK_EXPR_UNSUPPORTED_FUNCTION"
        | "SNAPBACK_FIELD_MISSING"
        | "SNAPBACK_FIELD_TYPE_MISMATCH"
        | "SNAPBACK_FUNCTION_IDENTITY_COLLISION"
        | "SNAPBACK_FUNCTION_IDENTITY_INVALID"
        | "SNAPBACK_FUNCTION_KIND_MISMATCH"
        | "SNAPBACK_FUNCTION_KIND_RUNTIME_MISMATCH"
        | "SNAPBACK_FUNCTION_NOT_LIVE"
        | "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID"
        | "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED"
        | "SNAPBACK_HANDLER_CAPABILITY_DENIED"
        | "SNAPBACK_HANDLER_DID_NOT_SETTLE"
        | "SNAPBACK_HANDLER_EXPORT_MISSING"
        | "SNAPBACK_HANDLER_FAILED"
        | "SNAPBACK_HANDLER_HOST_CALL_INVALID"
        | "SNAPBACK_HANDLER_HOST_CALL_INVALID_JSON"
        | "SNAPBACK_HANDLER_HOST_CALL_MALFORMED"
        | "SNAPBACK_HANDLER_HOST_CALL_UNKNOWN"
        | "SNAPBACK_HANDLER_RESULT_INVALID"
        | "SNAPBACK_HANDLER_STALE_CONTINUATION"
        | "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
        | "SNAPBACK_HANDLER_WRITE_IN_QUERY"
        | "SNAPBACK_HOST_OP_CLI_ONLY"
        | "SNAPBACK_HOST_OP_FUNCTION_KIND_UNSUPPORTED"
        | "SNAPBACK_HOST_OP_FUNCTION_UNKNOWN"
        | "SNAPBACK_HOST_OP_INPUT_MISSING"
        | "SNAPBACK_HOST_OP_UNIMPLEMENTED"
        | "SNAPBACK_HOST_OP_UNKNOWN"
        | "SNAPBACK_INVALID_FLOAT"
        | "SNAPBACK_INVALID_IDENTIFIER"
        | "SNAPBACK_LIVE_RESUME_FUNCTION_MISMATCH"
        | "SNAPBACK_PERMISSION_SCOPE_MISSING"
        | "SNAPBACK_PLAN_BOUNDS"
        | "SNAPBACK_PLAN_INVALID"
        | "SNAPBACK_PLAN_SOURCE_INVALID"
        | "SNAPBACK_QUERY_FILTER_UNSUPPORTED_FIELD_TYPE"
        | "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED"
        | "SNAPBACK_QUERY_FILTER_VALUE_INVALID"
        | "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED"
        | "SNAPBACK_QUERY_LIMIT_INVALID"
        | "SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE"
        | "SNAPBACK_QUERY_UNKNOWN_INDEX"
        | "SNAPBACK_REQUEST_JSON_INVALID"
        | "SNAPBACK_SEED_INVALID"
        | "SNAPBACK_SCHEMA_DUPLICATE_FIELD"
        | "SNAPBACK_SCHEMA_DUPLICATE_INDEX"
        | "SNAPBACK_SCHEMA_DUPLICATE_TABLE"
        | "SNAPBACK_SCHEMA_EMPTY_INDEX"
        | "SNAPBACK_SCHEMA_FIELD_RETYPED"
        | "SNAPBACK_SCHEMA_INDEX_NAME_COLLISION"
        | "SNAPBACK_SCHEMA_PARSE_FAILED"
        | "SNAPBACK_SCHEMA_SYSTEM_FIELD"
        | "SNAPBACK_STALE_FUNCTION_ARTIFACT_KIND"
        | "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION"
        | "SNAPBACK_STALE_SCHEMA_ARTIFACT_KIND"
        | "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION"
        | "SNAPBACK_SYSTEM_FIELD_WRITE"
        | "SNAPBACK_TIMESTAMP_OUT_OF_RANGE"
        | "SNAPBACK_UNSUPPORTED_BLOB"
        | "SNAPBACK_V8_COMPAT_CONFIG_INVALID"
        | "SNAPBACK_V8_COMPAT_FLAG_REFUSED"
        | "SNAPBACK_WEBSOCKET_MESSAGE_INVALID"
        | "SNAPBACK_WEBSOCKET_SENDER_MISMATCH" => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = status_for_diagnostic_code(self.0.diagnostic.code.as_str());
        (
            status,
            Json(ErrorResponse {
                diagnostic: self.0.diagnostic,
                receipt: self.1,
            }),
        )
            .into_response()
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::{
        ACTION_WATCHDOG_DEFAULT_MS, ACTION_WATCHDOG_MAX_MS, ACTION_WORKER_LIMIT_DEFAULT,
        ACTION_WORKER_LIMIT_MAX, CRON_DISPATCH_CONCURRENCY_DEFAULT, CRON_DISPATCH_CONCURRENCY_MAX,
        DetachedActionHost, DetachedActionWorkerCounters, OpenConnectionRequest, SharedSnapback,
        configured_action_worker_limit, configured_cron_dispatch_concurrency,
        dispatch_cron_tick_background, parse_action_watchdog_timeout, parse_optional_json,
        reserve_detached_action_worker, reserve_detached_action_worker_with_counters,
        run_detached_ibex_action_with_admission_and_counters, spawn_detached_action_worker,
        status_for_diagnostic_code,
    };
    use crate::cron::CronRunOutcome;
    use crate::local::{LocalSnapback, StagedAction};
    use crate::manifest::{
        CronActivationPolicy, CronJitterPolicy, CronJobDefinition, CronOverlapPolicy,
        CronRetryMode, CronRetryPolicy, CronSchedule, FunctionDefinition, FunctionKind,
        FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, MutationPlan,
        SchemaManifest,
    };
    use crate::runtime::IbexActionHost;
    use axum::body::Bytes;
    use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
    use futures_util::StreamExt as _;
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::{Arc, Condvar, Mutex as StdMutex};
    use std::time::{Duration, Instant};
    use syn::visit::Visit;
    use tokio::net::TcpListener;
    use tokio::sync::{Mutex, Semaphore};

    #[test]
    fn optional_json_rejects_non_objects_and_duplicate_struct_fields() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        let error = parse_optional_json::<OpenConnectionRequest>(
            &headers,
            Ok(Bytes::from_static(br#"["sequence-as-connection-id"]"#)),
        )
        .expect_err("optional JSON routes accept objects, never serde struct sequences");
        assert_eq!(error.0.diagnostic.code, "SNAPBACK_REQUEST_JSON_INVALID");
        assert_eq!(
            error.0.diagnostic.message,
            "request body was not valid JSON for this operation"
        );
        assert_eq!(
            error.0.diagnostic.details["error"],
            "request body must be a JSON object"
        );

        let duplicate = parse_optional_json::<OpenConnectionRequest>(
            &headers,
            Ok(Bytes::from_static(
                br#"{"connectionId":"first","connectionId":"second"}"#,
            )),
        )
        .expect_err("duplicate capability fields must not silently use the last value");
        assert_eq!(duplicate.0.diagnostic.code, "SNAPBACK_REQUEST_JSON_INVALID");
        assert!(
            duplicate.0.diagnostic.details["error"]
                .as_str()
                .is_some_and(|message| message.contains("duplicate field")),
            "typed serde visitor should preserve the duplicate-field diagnostic: {}",
            duplicate.0.diagnostic.details["error"]
        );
    }

    fn has_cfg_test(attributes: &[syn::Attribute]) -> bool {
        attributes.iter().any(|attribute| {
            if !attribute.path().is_ident("cfg") {
                return false;
            }
            let syn::Meta::List(arguments) = &attribute.meta else {
                return false;
            };
            // Skip only the exact test-only form. A future `cfg(not(test))` or
            // mixed feature predicate must remain in the conservative source
            // inventory rather than disappearing merely because it mentions
            // the token `test`.
            arguments.tokens.to_string() == "test"
        })
    }

    fn item_attributes(item: &syn::Item) -> &[syn::Attribute] {
        match item {
            syn::Item::Const(item) => &item.attrs,
            syn::Item::Enum(item) => &item.attrs,
            syn::Item::ExternCrate(item) => &item.attrs,
            syn::Item::Fn(item) => &item.attrs,
            syn::Item::ForeignMod(item) => &item.attrs,
            syn::Item::Impl(item) => &item.attrs,
            syn::Item::Macro(item) => &item.attrs,
            syn::Item::Mod(item) => &item.attrs,
            syn::Item::Static(item) => &item.attrs,
            syn::Item::Struct(item) => &item.attrs,
            syn::Item::Trait(item) => &item.attrs,
            syn::Item::TraitAlias(item) => &item.attrs,
            syn::Item::Type(item) => &item.attrs,
            syn::Item::Union(item) => &item.attrs,
            syn::Item::Use(item) => &item.attrs,
            _ => &[],
        }
    }

    #[derive(Default)]
    struct SnapbackLiteralVisitor {
        literals: BTreeSet<String>,
    }

    impl SnapbackLiteralVisitor {
        fn record_literal(&mut self, literal: &str) {
            let bytes = literal.as_bytes();
            let mut cursor = 0;
            while let Some(relative_start) = literal[cursor..].find("SNAPBACK_") {
                let start = cursor + relative_start;
                let mut end = start + "SNAPBACK_".len();
                while end < bytes.len()
                    && (bytes[end].is_ascii_uppercase()
                        || bytes[end].is_ascii_digit()
                        || bytes[end] == b'_')
                {
                    end += 1;
                }
                self.literals.insert(literal[start..end].to_owned());
                cursor = end;
            }
        }
    }

    impl<'ast> Visit<'ast> for SnapbackLiteralVisitor {
        fn visit_item(&mut self, item: &'ast syn::Item) {
            if !has_cfg_test(item_attributes(item)) {
                syn::visit::visit_item(self, item);
            }
        }

        fn visit_impl_item_fn(&mut self, function: &'ast syn::ImplItemFn) {
            if !has_cfg_test(&function.attrs) {
                syn::visit::visit_impl_item_fn(self, function);
            }
        }

        fn visit_stmt_macro(&mut self, invocation: &'ast syn::StmtMacro) {
            if !has_cfg_test(&invocation.attrs) {
                syn::visit::visit_stmt_macro(self, invocation);
            }
        }

        fn visit_lit_str(&mut self, literal: &'ast syn::LitStr) {
            self.record_literal(&literal.value());
        }

        fn visit_macro(&mut self, invocation: &'ast syn::Macro) {
            // `syn` deliberately leaves a macro's arguments as tokens. Scan
            // those tokens too so `format!`, `json!`, and helper macros cannot
            // hide a newly emitted diagnostic from the inventory gate.
            self.record_literal(&invocation.tokens.to_string());
            syn::visit::visit_macro(self, invocation);
        }
    }

    fn rust_sources_below(path: &Path, sources: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(path).expect("read Rust source directory") {
            let path = entry.expect("read Rust source entry").path();
            if path.is_dir() {
                rust_sources_below(&path, sources);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                sources.push(path);
            }
        }
    }

    fn production_snapback_literals() -> BTreeSet<String> {
        let mut sources = Vec::new();
        rust_sources_below(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut sources,
        );
        sources.sort();

        let mut visitor = SnapbackLiteralVisitor::default();
        for source in sources {
            let contents = fs::read_to_string(&source).expect("read Rust source");
            let syntax = syn::parse_file(&contents)
                .unwrap_or_else(|error| panic!("parse {}: {error}", source.display()));
            visitor.visit_file(&syntax);
        }
        visitor.literals
    }

    // These are the only production `SNAPBACK_*` literals that are not
    // diagnostic codes. Keep the reason beside each exclusion: the source
    // inventory is intentionally broad enough to catch literals passed through
    // helper constructors, embedded runtime source, and macros.
    const NON_DIAGNOSTIC_SNAPBACK_LITERALS: &[(&str, &str)] = &[
        (
            "SNAPBACK_ACTION_MAX_CONCURRENCY",
            "environment variable configuring detached action worker admission",
        ),
        (
            "SNAPBACK_ACTION_SECRETS",
            "legacy environment variable containing action secrets",
        ),
        (
            "SNAPBACK_ACTION_TIMEOUT_MS",
            "environment variable configuring the action watchdog",
        ),
        (
            "SNAPBACK_ADMIN_DIST",
            "environment variable naming the built admin snapshot",
        ),
        (
            "SNAPBACK_ADMIN_TOKEN",
            "environment variable carrying the admin bearer token",
        ),
        (
            "SNAPBACK_ARGS__",
            "suffix of the __SNAPBACK_ARGS__ embedded-runtime placeholder",
        ),
        (
            "SNAPBACK_AUTH__",
            "suffix of the __SNAPBACK_AUTH__ embedded-runtime placeholder",
        ),
        (
            "SNAPBACK_BUILD_GIT_COMMIT",
            "compile-time environment variable carrying build provenance",
        ),
        (
            "SNAPBACK_BUILD_GIT_DIRTY",
            "compile-time environment variable carrying build provenance",
        ),
        (
            "SNAPBACK_CRON_DISPATCH_CONCURRENCY",
            "environment variable configuring bounded cron dispatch",
        ),
        (
            "SNAPBACK_EPOCH__",
            "suffix of the __SNAPBACK_EPOCH__ embedded-runtime placeholder",
        ),
        (
            "SNAPBACK_EXPORT__",
            "suffix of the __SNAPBACK_EXPORT__ embedded-runtime placeholder",
        ),
        (
            "SNAPBACK_FRESH_VM",
            "environment variable opting out of the warm VM pool",
        ),
        (
            "SNAPBACK_HANDLER_BACKEND",
            "environment variable selecting the handler backend",
        ),
        (
            "SNAPBACK_HANDLER_CONSOLE",
            "environment variable selecting handler-console forwarding",
        ),
        (
            "SNAPBACK_HANDLER_HOST_CALL_",
            "diagnostic-code prefix used to recognize host-call failures",
        ),
        (
            "SNAPBACK_INVOKE_TOKEN",
            "private workerd text binding carrying the local invocation capability",
        ),
        (
            "SNAPBACK_HOST_TOKEN",
            "private workerd text binding carrying the independent host-call capability",
        ),
        (
            "SNAPBACK_RESPONSE_TOKEN",
            "private workerd text binding authenticating readiness and invoke responses",
        ),
        (
            "SNAPBACK_IBEX",
            "environment variable overriding the Ibex executable",
        ),
        (
            "SNAPBACK_MARK__",
            "suffix of the __SNAPBACK_MARK__ HTML template placeholder",
        ),
        (
            "SNAPBACK_MODE__",
            "suffix of the __SNAPBACK_MODE__ embedded-runtime placeholder",
        ),
        (
            "SNAPBACK_OUTBOUND_ACTIONS",
            "environment variable enabling outbound action capabilities",
        ),
        (
            "SNAPBACK_PROFILE",
            "environment variable selecting the server profile",
        ),
        (
            "SNAPBACK_RUN__",
            "suffix of the __SNAPBACK_RUN__ embedded-runtime placeholder",
        ),
        (
            "SNAPBACK_SCHEMA_VERSION",
            "Rust constant name interpolated into schema-export text",
        ),
        (
            "SNAPBACK_SECRETS__",
            "suffix of the __SNAPBACK_SECRETS__ embedded-runtime placeholder",
        ),
        (
            "SNAPBACK_V8_WALL_CLOCK_TIMEOUT_MS",
            "environment variable configuring the V8 watchdog",
        ),
        (
            "SNAPBACK_WORKERD_BIN",
            "environment variable overriding the workerd executable",
        ),
    ];

    const BAD_REQUEST_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ACTION_MUTATION_REFERENCE_INVALID",
        "SNAPBACK_ARG_MISSING",
        "SNAPBACK_AUTH_STALE_RESULT",
        "SNAPBACK_AUTH_USER_MISSING",
        "SNAPBACK_BINDING_MISSING",
        "SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED",
        "SNAPBACK_CAPTURED_READ_INVALID",
        "SNAPBACK_CLIENT_MUTATION_ACK_LIMIT_EXCEEDED",
        "SNAPBACK_CLIENT_MUTATION_ACK_OVERLAP",
        "SNAPBACK_CLIENT_MUTATION_ID_INVALID",
        "SNAPBACK_CLIENT_MUTATION_PURGE_SELECTOR_INVALID",
        "SNAPBACK_CONFIG_DEFAULT_UNIMPLEMENTED",
        "SNAPBACK_CONFIG_ENTRY_INVALID",
        "SNAPBACK_CONFIG_MISSING",
        "SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED",
        "SNAPBACK_CONFIG_PROBE_INVALID",
        "SNAPBACK_CONFIG_PROBE_MISSING",
        "SNAPBACK_CONFIG_REQUIRED_MISSING",
        "SNAPBACK_CONFIG_TRANSIT_RULE",
        "SNAPBACK_CONFIG_UNDECLARED",
        "SNAPBACK_CONFIG_USES_UNKNOWN",
        "SNAPBACK_CONFIG_VALUE_INVALID",
        "SNAPBACK_CONFIG_VERIFY_COOLDOWN",
        "SNAPBACK_CRON_ACTION_KIND_MISMATCH",
        "SNAPBACK_CRON_ACTION_MISSING",
        "SNAPBACK_CRON_DUPLICATE_JOB",
        "SNAPBACK_CRON_INVALID_EXPRESSION",
        "SNAPBACK_CRON_INVALID_INTERVAL",
        "SNAPBACK_CRON_INVALID_SCHEDULE",
        "SNAPBACK_CRON_JITTER_INVALID",
        "SNAPBACK_CRON_JOB_DISABLED",
        "SNAPBACK_CRON_JOB_IN_FLIGHT",
        "SNAPBACK_CRON_JOB_INVALID",
        "SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED",
        "SNAPBACK_CRON_TARGET_CADENCE_UNSUPPORTED",
        "SNAPBACK_CRON_UNSATISFIABLE_EXPRESSION",
        "SNAPBACK_CRON_WHILE_LIVE_EMPTY",
        "SNAPBACK_CRON_WHILE_LIVE_KIND_MISMATCH",
        "SNAPBACK_CRON_WHILE_LIVE_MISSING",
        "SNAPBACK_CTX_LEDGER_EXHAUSTED",
        "SNAPBACK_CTX_LEDGER_ID_INVALID",
        "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
        "SNAPBACK_CTX_LEDGER_UNUSED_IDS",
        "SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED",
        "SNAPBACK_DATA_TIER_VERSION_REQUIRED",
        "SNAPBACK_DATA_TIER_VERSION_UNSUPPORTED",
        "SNAPBACK_EPHEMERAL_INVALID_SCOPE",
        "SNAPBACK_EPHEMERAL_INVALID_TTL",
        "SNAPBACK_EPHEMERAL_MISSING_KEY",
        "SNAPBACK_EPHEMERAL_MISSING_OWNER",
        "SNAPBACK_EPHEMERAL_ROOM_LIMIT_EXCEEDED",
        "SNAPBACK_EPHEMERAL_UNAUTHORIZED",
        "SNAPBACK_EPHEMERAL_UNKNOWN_COLLECTION",
        "SNAPBACK_EXPECTED_STRING",
        "SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED",
        "SNAPBACK_EXPLAIN_KIND_UNKNOWN",
        "SNAPBACK_EXPR_TYPE",
        "SNAPBACK_EXPR_UNANALYZABLE",
        "SNAPBACK_EXPR_UNSUPPORTED_FUNCTION",
        "SNAPBACK_FIELD_MISSING",
        "SNAPBACK_FIELD_TYPE_MISMATCH",
        "SNAPBACK_FUNCTION_IDENTITY_COLLISION",
        "SNAPBACK_FUNCTION_IDENTITY_INVALID",
        "SNAPBACK_FUNCTION_KIND_MISMATCH",
        "SNAPBACK_FUNCTION_KIND_RUNTIME_MISMATCH",
        "SNAPBACK_FUNCTION_NOT_LIVE",
        "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID",
        "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED",
        "SNAPBACK_HANDLER_CAPABILITY_DENIED",
        "SNAPBACK_HANDLER_DID_NOT_SETTLE",
        "SNAPBACK_HANDLER_EXPORT_MISSING",
        "SNAPBACK_HANDLER_FAILED",
        "SNAPBACK_HANDLER_HOST_CALL_INVALID",
        "SNAPBACK_HANDLER_HOST_CALL_INVALID_JSON",
        "SNAPBACK_HANDLER_HOST_CALL_MALFORMED",
        "SNAPBACK_HANDLER_HOST_CALL_UNKNOWN",
        "SNAPBACK_HANDLER_RESULT_INVALID",
        "SNAPBACK_HANDLER_STALE_CONTINUATION",
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION",
        "SNAPBACK_HANDLER_WRITE_IN_QUERY",
        "SNAPBACK_HOST_OP_CLI_ONLY",
        "SNAPBACK_HOST_OP_FUNCTION_KIND_UNSUPPORTED",
        "SNAPBACK_HOST_OP_FUNCTION_UNKNOWN",
        "SNAPBACK_HOST_OP_INPUT_MISSING",
        "SNAPBACK_HOST_OP_UNIMPLEMENTED",
        "SNAPBACK_HOST_OP_UNKNOWN",
        "SNAPBACK_INVALID_FLOAT",
        "SNAPBACK_INVALID_IDENTIFIER",
        "SNAPBACK_LIVE_RESUME_FUNCTION_MISMATCH",
        "SNAPBACK_PERMISSION_SCOPE_MISSING",
        "SNAPBACK_PLAN_BOUNDS",
        "SNAPBACK_PLAN_INVALID",
        "SNAPBACK_PLAN_SOURCE_INVALID",
        "SNAPBACK_QUERY_FILTER_UNSUPPORTED_FIELD_TYPE",
        "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED",
        "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
        "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED",
        "SNAPBACK_QUERY_LIMIT_INVALID",
        "SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE",
        "SNAPBACK_QUERY_UNKNOWN_INDEX",
        "SNAPBACK_REQUEST_JSON_INVALID",
        "SNAPBACK_SEED_INVALID",
        "SNAPBACK_SCHEMA_DUPLICATE_FIELD",
        "SNAPBACK_SCHEMA_DUPLICATE_INDEX",
        "SNAPBACK_SCHEMA_DUPLICATE_TABLE",
        "SNAPBACK_SCHEMA_EMPTY_INDEX",
        "SNAPBACK_SCHEMA_FIELD_RETYPED",
        "SNAPBACK_SCHEMA_INDEX_NAME_COLLISION",
        "SNAPBACK_SCHEMA_PARSE_FAILED",
        "SNAPBACK_SCHEMA_SYSTEM_FIELD",
        "SNAPBACK_STALE_FUNCTION_ARTIFACT_KIND",
        "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION",
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_KIND",
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION",
        "SNAPBACK_SYSTEM_FIELD_WRITE",
        "SNAPBACK_TIMESTAMP_OUT_OF_RANGE",
        "SNAPBACK_UNSUPPORTED_BLOB",
        "SNAPBACK_V8_COMPAT_CONFIG_INVALID",
        "SNAPBACK_V8_COMPAT_FLAG_REFUSED",
        "SNAPBACK_WEBSOCKET_MESSAGE_INVALID",
        "SNAPBACK_WEBSOCKET_SENDER_MISMATCH",
    ];

    const UNAUTHORIZED_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ADMIN_TOKEN_REQUIRED",
        "SNAPBACK_CONNECTION_TOKEN_REQUIRED",
    ];

    const FORBIDDEN_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ADMIN_DISABLED",
        "SNAPBACK_CONNECTION_TOKEN_INVALID",
        "SNAPBACK_LIVE_RESUME_OWNERSHIP",
        "SNAPBACK_PROFILE_FORBIDS",
    ];

    const NOT_FOUND_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_UNKNOWN_CRON_JOB",
        "SNAPBACK_UNKNOWN_FIELD",
        "SNAPBACK_UNKNOWN_FUNCTION",
        "SNAPBACK_UNKNOWN_SUBSCRIPTION",
        "SNAPBACK_UNKNOWN_TABLE",
    ];

    const CONFLICT_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ACTION_GENERATION_CONFLICT",
        "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
        "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED",
        "SNAPBACK_CONFIG_VERIFY_STALE",
        "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION",
        "SNAPBACK_MUTATION_CONFLICT",
        "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
    ];

    const PAYLOAD_TOO_LARGE_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE",
        "SNAPBACK_EPHEMERAL_METADATA_TOO_LARGE",
        "SNAPBACK_EPHEMERAL_VALUE_TOO_LARGE",
        "SNAPBACK_HANDLER_HOST_CALL_BODY_TOO_LARGE",
        "SNAPBACK_VALUE_TOO_LARGE",
        "SNAPBACK_WEBSOCKET_MESSAGE_TOO_LARGE",
    ];

    const TOO_MANY_REQUESTS_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED",
        "SNAPBACK_EPHEMERAL_RATE_LIMITED",
        "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT",
        "SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT",
    ];

    const GATEWAY_TIMEOUT_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ACTION_TIMEOUT",
        "SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED",
    ];

    const SERVICE_UNAVAILABLE_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ACTION_CAPACITY_EXCEEDED",
        "SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING",
        "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE",
        "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACT_MISSING",
        "SNAPBACK_CAPABILITY_MINIFLARE_MISSING",
        "SNAPBACK_CAPABILITY_WORKERD_MISSING",
        "SNAPBACK_CRON_DISPATCH_CAPACITY_EXCEEDED",
        "SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED",
        "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL",
        "SNAPBACK_OVERLOADED",
        "SNAPBACK_READ_LANE_UNAVAILABLE",
        "SNAPBACK_V8_RUNNER_HOST_UNSUPPORTED",
    ];

    // These literals include internal errors plus informational/warning
    // diagnostics that never normally become an `ApiError`. If one does reach
    // that boundary, the fail-safe class is still 500 rather than a false 4xx.
    const INTERNAL_SERVER_ERROR_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ACTION_CONTEXT_UNAVAILABLE",
        "SNAPBACK_ACTION_HOST_MISSING",
        "SNAPBACK_ACTION_METADATA_SERIALIZE_FAILED",
        "SNAPBACK_ACTION_SECRETS_DEPRECATED",
        "SNAPBACK_ACTION_SECRETS_INVALID",
        "SNAPBACK_ACTION_THREAD_FAILED",
        "SNAPBACK_ACTION_THREAD_SPAWN_FAILED",
        "SNAPBACK_ACTION_TIMEOUT_INVALID",
        "SNAPBACK_ACTION_TIMEOUT_SETUP_FAILED",
        "SNAPBACK_BENCH_EPHEMERAL",
        "SNAPBACK_BENCH_TEMPDIR",
        "SNAPBACK_CAPTURED_READ_SERIALIZE_FAILED",
        "SNAPBACK_CLIENT_MUTATION_RETENTION_STATE_INVALID",
        "SNAPBACK_CLIENT_MUTATION_RESULT_INVALID",
        "SNAPBACK_CONFIG_ENV_IMPORTED",
        "SNAPBACK_CONFIG_GENERATION_EXHAUSTED",
        "SNAPBACK_CONFIG_STORE_INVALID",
        "SNAPBACK_CONFIG_STORE_IO",
        "SNAPBACK_CONFIG_STORE_VERSION_UNSUPPORTED",
        "SNAPBACK_CONFIG_VERIFY",
        "SNAPBACK_CONFIG_WRITE",
        "SNAPBACK_CRON_RUN_RECORD_MISSING",
        "SNAPBACK_CRON_RUN_SKIPPED_OVERLAP",
        "SNAPBACK_CRON_STALE_IN_FLIGHT_CLEARED",
        "SNAPBACK_CRON_STATE_INVALID",
        "SNAPBACK_CRON_STATE_PARSE_FAILED",
        "SNAPBACK_CRON_STATE_SERIALIZE_FAILED",
        "SNAPBACK_DRY_RUN_LEDGER_ELIDED",
        "SNAPBACK_HANDLER_HOST_CALL_HEADERS_TOO_LARGE",
        "SNAPBACK_HANDLER_HOST_CALL_PANIC",
        "SNAPBACK_HANDLER_HOST_CALL_SERIALIZE_FAILED",
        "SNAPBACK_HANDLER_HOST_CALL_UNAUTHORIZED",
        "SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT",
        "SNAPBACK_HANDLER_INPUT_SERIALIZE_FAILED",
        "SNAPBACK_HANDLER_REJECTION_DETECTION_UNAVAILABLE",
        "SNAPBACK_HANDLER_REJECTION_INSPECTION_INVALID",
        "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR",
        "SNAPBACK_HOST_STOP_UNVERIFIABLE",
        "SNAPBACK_IBEX_CLI_UNAVAILABLE",
        "SNAPBACK_IBEX_FUNCTIONS_LOADED",
        "SNAPBACK_IBEX_GLOBAL_DENY_INCOMPLETE",
        "SNAPBACK_JSON_PARSE_FAILED",
        "SNAPBACK_JSON_SERIALIZE_FAILED",
        "SNAPBACK_LIVE_DELTA_SERIALIZE_FAILED",
        "SNAPBACK_LIVE_UPDATE_SERIALIZE_FAILED",
        "SNAPBACK_READY_FILE_PATH_COLLISION",
        "SNAPBACK_RUNTIME_CREATE_FAILED",
        "SNAPBACK_SCHEMA_PHYSICAL_COLUMN_INVALID",
        "SNAPBACK_SCHEMA_SERIALIZE_FAILED",
        "SNAPBACK_SQLITE_ERROR",
        "SNAPBACK_V8_REJECTION_DETECTION_UNAVAILABLE",
        "SNAPBACK_V8_RUNNER_INVOKE_FAILED",
        "SNAPBACK_V8_RUNNER_START_FAILED",
        "SNAPBACK_VERSION_OUT_OF_RANGE",
    ];

    const HTTP_STATUS_FAMILIES: &[(StatusCode, &[&str])] = &[
        (StatusCode::BAD_REQUEST, BAD_REQUEST_DIAGNOSTICS),
        (StatusCode::UNAUTHORIZED, UNAUTHORIZED_DIAGNOSTICS),
        (StatusCode::FORBIDDEN, FORBIDDEN_DIAGNOSTICS),
        (StatusCode::NOT_FOUND, NOT_FOUND_DIAGNOSTICS),
        (StatusCode::CONFLICT, CONFLICT_DIAGNOSTICS),
        (StatusCode::PAYLOAD_TOO_LARGE, PAYLOAD_TOO_LARGE_DIAGNOSTICS),
        (StatusCode::TOO_MANY_REQUESTS, TOO_MANY_REQUESTS_DIAGNOSTICS),
        (StatusCode::GATEWAY_TIMEOUT, GATEWAY_TIMEOUT_DIAGNOSTICS),
        (
            StatusCode::SERVICE_UNAVAILABLE,
            SERVICE_UNAVAILABLE_DIAGNOSTICS,
        ),
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            INTERNAL_SERVER_ERROR_DIAGNOSTICS,
        ),
    ];

    const STALE_ARTIFACT_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_STALE_FUNCTION_ARTIFACT_KIND",
        "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION",
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_KIND",
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION",
    ];

    // `validate_artifact_header` assembles these four codes from a format
    // template. Name the exact expansion so the source inventory cannot treat
    // the template prefix as a concrete diagnostic or silently miss a family.
    const DYNAMIC_DIAGNOSTIC_TEMPLATES: &[(&str, &[&str])] =
        &[("SNAPBACK_STALE_", STALE_ARTIFACT_DIAGNOSTICS)];

    fn expected_http_diagnostic_codes() -> BTreeSet<String> {
        let mut expected = BTreeSet::new();
        for (_, codes) in HTTP_STATUS_FAMILIES {
            for code in *codes {
                assert!(
                    expected.insert((*code).to_owned()),
                    "duplicate diagnostic status classification: {code}"
                );
            }
        }
        expected
    }

    /// LLP 0032 S5.D10 / ENG-24357 — every diagnostic emitted by the Rust
    /// implementation has a reviewed HTTP result, across every status family.
    #[test]
    fn s5_d10_all_emitted_diagnostics_have_reviewed_http_status() {
        for (expected_status, codes) in HTTP_STATUS_FAMILIES {
            for code in *codes {
                assert_eq!(
                    status_for_diagnostic_code(code),
                    *expected_status,
                    "{code} drifted out of its reviewed HTTP family"
                );
            }
        }

        // Production remains fail-safe between reviews: a genuinely new code
        // is 500, never the pre-ENG-24357 blanket 400.
        for unknown in ["SNAPBACK_INTERNAL_ERROR", "SNAPBACK_FUTURE_DIAGNOSTIC"] {
            assert_eq!(
                status_for_diagnostic_code(unknown),
                StatusCode::INTERNAL_SERVER_ERROR
            );
        }
    }

    /// The forcing function: derive `SNAPBACK_*` literals from production Rust
    /// ASTs (including helper arguments and macro token streams), normalize the
    /// one audited format family, and require exact equality with the status
    /// table. A new producer cannot inherit a status without a reviewable edit.
    #[test]
    fn s5_d10_production_diagnostic_inventory_cannot_drift() {
        let mut emitted = production_snapback_literals();
        let mut exclusions = BTreeSet::new();
        for (literal, reason) in NON_DIAGNOSTIC_SNAPBACK_LITERALS {
            assert!(!reason.is_empty(), "{literal} exclusion needs a reason");
            assert!(
                exclusions.insert(*literal),
                "duplicate non-diagnostic exclusion: {literal}"
            );
            assert!(emitted.remove(*literal), "stale exclusion: {literal}");
        }

        for (template, expansions) in DYNAMIC_DIAGNOSTIC_TEMPLATES {
            assert!(
                emitted.remove(*template),
                "dynamic diagnostic template changed or disappeared: {template}"
            );
            assert!(
                !expansions.is_empty(),
                "{template} needs explicit expansions"
            );
            for code in *expansions {
                assert!(
                    code.starts_with(template),
                    "{code} is not an expansion of {template}"
                );
                assert!(
                    emitted.contains(*code),
                    "{code} must be explicit in the HTTP mapper as well as the format family"
                );
            }
        }

        assert_eq!(
            emitted,
            expected_http_diagnostic_codes(),
            "production diagnostics and the reviewed HTTP table drifted"
        );
    }

    #[test]
    fn s5_d10_stale_artifact_diagnostics_are_bad_requests() {
        let schema_kind = SchemaManifest {
            artifact_kind: "functionManifest".to_owned(),
            ..SchemaManifest::default()
        };
        let schema_version = SchemaManifest {
            schema_version: "snapback.v999".to_owned(),
            ..SchemaManifest::default()
        };
        let function_kind = FunctionManifest {
            artifact_kind: "schemaManifest".to_owned(),
            ..FunctionManifest::default()
        };
        let function_version = FunctionManifest {
            schema_version: "snapback.v999".to_owned(),
            ..FunctionManifest::default()
        };

        let emitted = [
            schema_kind
                .validate_artifact()
                .expect_err("schema kind")
                .diagnostic
                .code,
            schema_version
                .validate_artifact()
                .expect_err("schema version")
                .diagnostic
                .code,
            function_kind
                .validate_artifact()
                .expect_err("function kind")
                .diagnostic
                .code,
            function_version
                .validate_artifact()
                .expect_err("function version")
                .diagnostic
                .code,
        ];
        let expected = [
            "SNAPBACK_STALE_SCHEMA_ARTIFACT_KIND",
            "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION",
            "SNAPBACK_STALE_FUNCTION_ARTIFACT_KIND",
            "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION",
        ];

        assert_eq!(emitted, expected);
        for code in emitted {
            assert_eq!(status_for_diagnostic_code(&code), StatusCode::BAD_REQUEST);
        }
    }

    #[test]
    fn action_watchdog_timeout_clamps_untrusted_environment_values() {
        assert_eq!(
            parse_action_watchdog_timeout(None),
            ACTION_WATCHDOG_DEFAULT_MS
        );
        assert_eq!(
            parse_action_watchdog_timeout(Some("not-a-number")),
            ACTION_WATCHDOG_DEFAULT_MS
        );
        assert_eq!(
            parse_action_watchdog_timeout(Some("0")),
            ACTION_WATCHDOG_DEFAULT_MS
        );
        assert_eq!(parse_action_watchdog_timeout(Some("1")), 1);
        assert_eq!(
            parse_action_watchdog_timeout(Some(&u64::MAX.to_string())),
            ACTION_WATCHDOG_MAX_MS
        );

        assert_eq!(
            configured_action_worker_limit(None),
            ACTION_WORKER_LIMIT_DEFAULT
        );
        assert_eq!(
            configured_action_worker_limit(Some("not-a-number")),
            ACTION_WORKER_LIMIT_DEFAULT
        );
        assert_eq!(
            configured_action_worker_limit(Some("0")),
            ACTION_WORKER_LIMIT_DEFAULT
        );
        assert_eq!(configured_action_worker_limit(Some("1")), 1);
        assert_eq!(
            configured_action_worker_limit(Some(&usize::MAX.to_string())),
            ACTION_WORKER_LIMIT_MAX
        );

        assert_eq!(
            configured_cron_dispatch_concurrency(None),
            CRON_DISPATCH_CONCURRENCY_DEFAULT
        );
        assert_eq!(
            configured_cron_dispatch_concurrency(Some("not-a-number")),
            CRON_DISPATCH_CONCURRENCY_DEFAULT
        );
        assert_eq!(
            configured_cron_dispatch_concurrency(Some("0")),
            CRON_DISPATCH_CONCURRENCY_DEFAULT
        );
        assert_eq!(configured_cron_dispatch_concurrency(Some("1")), 1);
        assert_eq!(
            configured_cron_dispatch_concurrency(Some(&usize::MAX.to_string())),
            CRON_DISPATCH_CONCURRENCY_MAX
        );
    }

    #[test]
    fn detached_action_admission_rejects_at_capacity_and_recovers() {
        let limiter = Arc::new(Semaphore::new(1));
        let permit = reserve_detached_action_worker(limiter.clone(), 1).expect("first worker");
        let error = reserve_detached_action_worker(limiter.clone(), 1)
            .expect_err("second worker must be rejected");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_CAPACITY_EXCEEDED");
        assert_eq!(
            status_for_diagnostic_code(&error.diagnostic.code),
            StatusCode::SERVICE_UNAVAILABLE
        );

        drop(permit);
        assert!(reserve_detached_action_worker(limiter, 1).is_ok());
    }

    fn isolated_worker_counters() -> DetachedActionWorkerCounters {
        // Native worker closures require 'static counters. Leaking these two
        // tiny atomics keeps each parallel test isolated from process-global
        // admin metrics without introducing test-only synchronization into
        // production paths.
        DetachedActionWorkerCounters {
            active: Box::leak(Box::new(AtomicUsize::new(0))),
            rejections: Box::leak(Box::new(AtomicU64::new(0))),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn detached_action_execution_stays_bounded_under_repeated_saturation() {
        let state = slow_cron_state(CronOverlapPolicy::Allow);
        let counters = isolated_worker_counters();
        let mut staged = Vec::new();
        for _ in 0..10 {
            let action = super::with_snapback(&state, |snapback| {
                snapback.stage_action_invocation("slowCron")
            })
            .await
            .expect("stage slow action");
            let StagedAction::Detached(action) = action else {
                panic!("Ibex action must detach");
            };
            staged.push(action);
        }

        let admission = Arc::new(Semaphore::new(2));
        let first = staged.remove(0);
        let second = staged.remove(0);
        let first_run = {
            let state = state.clone();
            let admission = admission.clone();
            tokio::spawn(async move {
                run_detached_ibex_action_with_admission_and_counters(
                    &state,
                    first,
                    HandlerInput::default(),
                    crate::local::manual_action_metadata("test", "first"),
                    admission,
                    2,
                    counters,
                )
                .await
            })
        };
        let second_run = {
            let state = state.clone();
            let admission = admission.clone();
            tokio::spawn(async move {
                run_detached_ibex_action_with_admission_and_counters(
                    &state,
                    second,
                    HandlerInput::default(),
                    crate::local::manual_action_metadata("test", "second"),
                    admission,
                    2,
                    counters,
                )
                .await
            })
        };
        wait_for_dispatcher_permits(&admission, 0).await;
        tokio::time::timeout(Duration::from_secs(2), async {
            while counters.active.load(Ordering::SeqCst) < 2 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("both admitted actions enter their native VM workers");
        assert_eq!(
            counters.active.load(Ordering::SeqCst),
            2,
            "the injected N=2 ceiling must bound actual native workers"
        );

        for action in staged {
            let error = run_detached_ibex_action_with_admission_and_counters(
                &state,
                action,
                HandlerInput::default(),
                crate::local::manual_action_metadata("test", "rejected"),
                admission.clone(),
                2,
                counters,
            )
            .await
            .expect_err("work beyond the configured ceiling must fail closed");
            assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_CAPACITY_EXCEEDED");
            assert_eq!(admission.available_permits(), 0);
        }
        assert!(
            counters.rejections.load(Ordering::SeqCst) == 8,
            "every rejected N+1 attempt must reach the exported overload metric"
        );

        first_run
            .await
            .expect("first task joins")
            .expect("first action");
        second_run
            .await
            .expect("second task joins")
            .expect("second action");
        assert_eq!(admission.available_permits(), 2);
        assert_eq!(counters.active.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn stuck_native_workers_retain_capacity_until_they_actually_exit() {
        let counters = isolated_worker_counters();
        let admission = Arc::new(Semaphore::new(2));
        let release = Arc::new((StdMutex::new(false), Condvar::new()));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let permit =
                reserve_detached_action_worker_with_counters(admission.clone(), 2, counters)
                    .expect("worker admitted below N");
            let release = release.clone();
            workers.push(
                spawn_detached_action_worker(
                    permit,
                    counters,
                    move || {
                        let (released, wake) = &*release;
                        let mut released = released.lock().expect("release lock");
                        while !*released {
                            released = wake.wait(released).expect("release wait");
                        }
                    },
                    |()| (),
                )
                .expect("spawn blocking native worker"),
            );
        }
        while counters.active.load(Ordering::SeqCst) != 2 {
            std::thread::yield_now();
        }

        // Model the period after an outer watchdog has returned but a native
        // call cannot yet unwind. Admission remains exhausted throughout;
        // repeated callers fail rather than allocating additional OS threads.
        std::thread::sleep(Duration::from_millis(25));
        for _ in 0..8 {
            let error =
                reserve_detached_action_worker_with_counters(admission.clone(), 2, counters)
                    .expect_err("N+1 stuck worker must be rejected");
            assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_CAPACITY_EXCEEDED");
        }
        assert_eq!(admission.available_permits(), 0);
        assert_eq!(counters.active.load(Ordering::SeqCst), 2);
        assert_eq!(counters.rejections.load(Ordering::SeqCst), 8);

        let (released, wake) = &*release;
        *released.lock().expect("release lock") = true;
        wake.notify_all();
        for worker in workers {
            worker.join().expect("native worker exits after release");
        }
        assert_eq!(admission.available_permits(), 2);
        assert_eq!(counters.active.load(Ordering::SeqCst), 0);
    }

    fn slow_cron_state(overlap_policy: CronOverlapPolicy) -> SharedSnapback {
        let source = r#"
globalThis.__snapbackHandlers = {
  async slowCron() {
    const started = Date.now();
    while (Date.now() - started < 500) {}
    return { ok: true };
  }
};
"#;
        let manifest = FunctionManifest {
            functions: vec![FunctionDefinition::new(
                "slowCron",
                FunctionKind::Action,
                FunctionRuntime::IbexModule(IbexModule {
                    source: source.to_owned(),
                    export: "slowCron".to_owned(),
                }),
            )],
            cron_jobs: vec![CronJobDefinition {
                name: "slow".to_owned(),
                schedule: CronSchedule {
                    every_ms: Some(60_000),
                    cron: None,
                },
                action: "slowCron".to_owned(),
                enabled: true,
                activation: CronActivationPolicy::default(),
                jitter_policy: CronJitterPolicy {
                    enabled: false,
                    max_offset_ms: 0,
                },
                overlap_policy,
                retry_policy: CronRetryPolicy {
                    mode: CronRetryMode::NextTick,
                },
                required_capabilities: Vec::new(),
                target_wakeup: None,
                source_span: None,
            }],
            ..FunctionManifest::default()
        };
        let mut snapback = LocalSnapback::memory().expect("cron test state");
        let diagnostics = snapback.load_functions(manifest);
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.severity
                    != crate::diagnostic::DiagnosticSeverity::Error),
            "slow cron manifest must install: {diagnostics:?}"
        );
        Arc::new(Mutex::new(snapback))
    }

    async fn wait_for_dispatcher_permits(dispatcher: &Semaphore, expected: usize) {
        tokio::time::timeout(Duration::from_secs(3), async {
            while dispatcher.available_permits() != expected {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("detached cron action did not reach the expected dispatcher state");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn background_scheduler_allows_overlap_but_no_overlap_skips() {
        let dispatcher = Arc::new(Semaphore::new(4));
        let allow = slow_cron_state(CronOverlapPolicy::Allow);
        assert_eq!(
            dispatch_cron_tick_background(&allow, &dispatcher, 4, 60_000)
                .await
                .unwrap(),
            1
        );
        wait_for_dispatcher_permits(&dispatcher, 3).await;
        assert_eq!(
            dispatch_cron_tick_background(&allow, &dispatcher, 4, 120_000)
                .await
                .unwrap(),
            1,
            "the next automatic Allow slot must dispatch before the prior run finishes"
        );
        wait_for_dispatcher_permits(&dispatcher, 2).await;
        wait_for_dispatcher_permits(&dispatcher, 4).await;

        let no_overlap = slow_cron_state(CronOverlapPolicy::NoOverlap);
        assert_eq!(
            dispatch_cron_tick_background(&no_overlap, &dispatcher, 4, 60_000)
                .await
                .unwrap(),
            1
        );
        wait_for_dispatcher_permits(&dispatcher, 3).await;
        assert_eq!(
            dispatch_cron_tick_background(&no_overlap, &dispatcher, 4, 120_000)
                .await
                .unwrap(),
            0,
            "NoOverlap must skip while its prior automatic run is active"
        );
        let inspect = super::with_snapback(&no_overlap, |snapback| snapback.inspect())
            .await
            .unwrap();
        assert!(inspect.cron.recent_runs.iter().any(|run| {
            run.outcome == CronRunOutcome::Skipped
                && run.diagnostic.as_ref().is_some_and(|diagnostic| {
                    diagnostic.code == "SNAPBACK_CRON_RUN_SKIPPED_OVERLAP"
                })
        }));
        wait_for_dispatcher_permits(&dispatcher, 4).await;
    }

    fn generation_test_manifest() -> FunctionManifest {
        FunctionManifest {
            functions: vec![
                FunctionDefinition::new(
                    "heldAction",
                    FunctionKind::Action,
                    FunctionRuntime::IbexModule(IbexModule {
                        source: "globalThis.__snapbackHandlers = { async heldAction() { return null; } };"
                            .to_owned(),
                        export: "heldAction".to_owned(),
                    }),
                ),
                FunctionDefinition::new(
                    "hostPlanWrite",
                    FunctionKind::Mutation,
                    FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                        steps: Vec::new(),
                        return_value: None,
                    })),
                ),
            ],
            ..FunctionManifest::default()
        }
    }

    fn stage_held_action(state: &SharedSnapback) -> Box<crate::local::DetachedIbexAction> {
        let mut snapback = state.try_lock().expect("test owns instance lock");
        match snapback
            .stage_action_invocation("heldAction")
            .expect("stage detached action")
        {
            StagedAction::Detached(action) => action,
            StagedAction::InLock => panic!("Ibex action must detach"),
        }
    }

    fn held_action_host(
        state: SharedSnapback,
        action: &crate::local::DetachedIbexAction,
    ) -> DetachedActionHost {
        DetachedActionHost {
            state,
            abandoned: Arc::new(AtomicBool::new(false)),
            commit_gate: Arc::new(StdMutex::new(())),
            deadline: Instant::now() + Duration::from_secs(5),
            app_generation: action.app_generation,
            app_generation_fence: action.app_generation_fence.clone(),
        }
    }

    /// ENG-24340 review follow-up: holding an outer detached action across an
    /// app reload/reset cannot let that old action use any later host power.
    /// The host-plan leg is important: it executes under the instance lock and
    /// therefore bypassed the detached-Ibex mutation's commit-time binding.
    #[test]
    fn detached_action_rejects_every_host_call_after_reload_or_reset() {
        let mut snapback = LocalSnapback::memory().expect("memory instance");
        snapback.load_functions(generation_test_manifest());
        let state = Arc::new(Mutex::new(snapback));

        let staged_before_reload = stage_held_action(&state);
        state
            .try_lock()
            .expect("test owns instance lock")
            .load_functions(generation_test_manifest());
        let mut stale_after_reload = held_action_host(state.clone(), &staged_before_reload);
        let runtime_error = stale_after_reload
            .validate_host_call("runtime.id")
            .expect_err("ordinary action host calls reject function reload drift");
        assert_eq!(
            runtime_error.diagnostic.code,
            "SNAPBACK_ACTION_GENERATION_CONFLICT"
        );
        let host_plan_error = stale_after_reload
            .run_mutation("hostPlanWrite", HandlerInput::default())
            .expect_err("host-plan mutation rejects outer action generation drift");
        assert_eq!(
            host_plan_error.diagnostic.code,
            "SNAPBACK_ACTION_GENERATION_CONFLICT"
        );

        let staged_before_reset = stage_held_action(&state);
        state
            .try_lock()
            .expect("test owns instance lock")
            .reset()
            .expect("reset app state");
        let mut stale_after_reset = held_action_host(state.clone(), &staged_before_reset);
        let reset_error = stale_after_reset
            .validate_host_call("runtime.now")
            .expect_err("ordinary action host calls reject reset drift");
        assert_eq!(
            reset_error.diagnostic.code,
            "SNAPBACK_ACTION_GENERATION_CONFLICT"
        );

        let staged_before_schema = stage_held_action(&state);
        state
            .try_lock()
            .expect("test owns instance lock")
            .apply_schema(SchemaManifest {
                schema_hash: Some("held-action-schema-reload".to_owned()),
                ..SchemaManifest::default()
            })
            .expect("reload schema");
        let mut stale_after_schema = held_action_host(state, &staged_before_schema);
        let schema_error = stale_after_schema
            .validate_host_call("action.metadata")
            .expect_err("ordinary action host calls reject schema drift");
        assert_eq!(
            schema_error.diagnostic.code,
            "SNAPBACK_ACTION_GENERATION_CONFLICT"
        );
    }

    use super::{
        ConnectionRegistry, LiveSocketClientMessage, MAX_CONNECTION_GRANTS, RouteClass,
        RoutePolicy, live_socket_operation_name, live_socket_operations, route_registry,
    };
    use crate::ephemeral::{DeleteRequest, PublishRequest, Scope, SubscribeRequest};

    /// ENG-23442 — grant semantics: adopted suggestions, collision minting,
    /// prod minting, and token verification outcomes.
    #[test]
    fn connection_registry_grants_and_verifies() {
        let registry = ConnectionRegistry::default();

        let adopted = registry
            .open(Some("readable".to_owned()), None, true)
            .expect("adopt grant");
        assert_eq!(adopted.connection_id, "readable");
        assert!(adopted.connection_token.starts_with("sct_"));

        // A colliding suggestion mints instead of rotating the live grant.
        let collided = registry
            .open(Some("readable".to_owned()), None, true)
            .expect("mint collision grant");
        assert_ne!(collided.connection_id, "readable");
        assert!(collided.connection_id.starts_with("conn_"));
        assert!(
            registry
                .verify("readable", Some(&adopted.connection_token))
                .is_ok(),
            "the original grant must survive a colliding open"
        );

        // Idempotent re-open: presenting the current token returns the same
        // grant (any profile) — a wrong previous token mints instead.
        let reopened = registry
            .open(
                Some("readable".to_owned()),
                Some(&adopted.connection_token),
                false,
            )
            .expect("reopen grant");
        assert_eq!(reopened.connection_id, "readable");
        assert_eq!(reopened.connection_token, adopted.connection_token);
        let stolen = registry
            .open(Some("readable".to_owned()), Some("sct_wrong"), true)
            .expect("wrong bearer mints");
        assert_ne!(stolen.connection_id, "readable");

        // Prod never adopts caller-selected ids.
        let minted = registry
            .open(Some("chosen".to_owned()), None, false)
            .expect("prod mint");
        assert!(minted.connection_id.starts_with("conn_"));

        // Verification: missing token, unknown connection, mismatched token.
        assert!(registry.verify("readable", None).is_err());
        assert!(registry.verify("never_opened", Some("sct_x")).is_err());
        assert!(
            registry
                .verify("readable", Some(&collided.connection_token))
                .is_err()
        );
        assert!(
            registry
                .verify(&collided.connection_id, Some(&collided.connection_token))
                .is_ok()
        );
    }

    #[test]
    fn connection_registry_pressure_evicts_lru_instead_of_permanently_wedging() {
        let registry = ConnectionRegistry::default();
        let first = registry
            .open(Some("first".to_owned()), None, true)
            .expect("first grant");
        let mut second = None;
        for index in 0..(MAX_CONNECTION_GRANTS - 1) {
            let grant = registry
                .open(Some(format!("bulk_{index}")), None, true)
                .expect("bounded grant admission");
            if index == 0 {
                second = Some(grant);
            }
        }
        registry
            .verify(&first.connection_id, Some(&first.connection_token))
            .expect("touch first grant");
        let after_pressure = registry
            .open(Some("after_pressure".to_owned()), None, true)
            .expect("the cap must not wedge future opens");
        assert_eq!(after_pressure.connection_id, "after_pressure");
        assert!(
            registry
                .verify(&first.connection_id, Some(&first.connection_token))
                .is_ok(),
            "recently used grants survive pressure"
        );
        let second = second.expect("second grant");
        assert!(
            registry
                .verify(&second.connection_id, Some(&second.connection_token))
                .is_err(),
            "the least recently used grant is the bounded eviction victim"
        );

        // Mark every remaining grant used and current: admission must refuse
        // instead of revoking live authority.
        {
            let mut state = registry.lock();
            let now = super::now_millis();
            let ids = state.grants.keys().cloned().collect::<Vec<_>>();
            state.unused.clear();
            state.used.clear();
            for id in ids {
                let record = state.grants.get_mut(&id).expect("grant record");
                record.used = true;
                record.last_use_ms = now;
                state.used.insert((now, id));
            }
        }
        let full = registry
            .open(Some("must_wait".to_owned()), None, true)
            .expect_err("current used leases cannot be displaced");
        assert_eq!(
            full.diagnostic.code,
            "SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED"
        );

        // Once those leases are idle-expired, pressure can retire one. The
        // retired readable id is never re-adopted by the new bearer: pressure
        // permanently switches this process to minted ids.
        {
            let mut state = registry.lock();
            let ids = state.grants.keys().cloned().collect::<Vec<_>>();
            state.used.clear();
            for id in ids {
                let record = state.grants.get_mut(&id).expect("grant record");
                record.last_use_ms = 0;
                state.used.insert((0, id));
            }
        }
        assert!(registry.touch_verified_socket(&first.connection_id));
        let retired_id = registry
            .lock()
            .used
            .first()
            .expect("oldest used grant")
            .1
            .clone();
        assert_ne!(retired_id, first.connection_id);
        let replacement = registry
            .open(Some(retired_id.clone()), None, true)
            .expect("expired lease makes bounded room");
        assert_ne!(replacement.connection_id, retired_id);
        assert!(replacement.connection_id.starts_with("conn_"));
        assert!(
            !registry.touch_verified_socket(&retired_id),
            "a pressure-retired socket must fail renewal before its next frame is processed"
        );
        assert!(
            registry
                .verify(&first.connection_id, Some(&first.connection_token))
                .is_ok(),
            "authenticated socket traffic renews the active grant past the idle cutoff"
        );
    }

    #[tokio::test]
    async fn pressure_evicted_socket_cannot_receive_notifier_delivery() {
        let state = crate::admin::AppState::detached(
            LocalSnapback::memory().expect("in-memory socket test state"),
        );
        let registry = state.connections.clone();
        let ephemeral = state.ephemeral.clone();
        let grant = registry
            .open(Some("retired_socket".to_owned()), None, true)
            .expect("socket grant");

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        let server = tokio::spawn(async move {
            axum::serve(listener, super::app(state))
                .await
                .expect("serve socket test");
        });

        use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
        let mut request = format!("ws://{address}/live/{}/stream", grant.connection_id)
            .into_client_request()
            .expect("websocket request");
        request.headers_mut().insert(
            "x-snapback-connection-token",
            grant
                .connection_token
                .parse()
                .expect("connection token header"),
        );
        let (mut socket, _) = tokio_tungstenite::connect_async(request)
            .await
            .expect("connect authorized socket");

        let notifier = ephemeral.delivery_notifier();
        tokio::time::timeout(Duration::from_secs(2), async {
            while !notifier.is_registered(&grant.connection_id) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("live stream registered its notifier");

        for index in 0..(MAX_CONNECTION_GRANTS - 1) {
            registry
                .open(Some(format!("pressure_{index}")), None, true)
                .expect("fill bounded registry");
        }
        {
            let mut grants = registry.lock();
            let ids = grants.grants.keys().cloned().collect::<Vec<_>>();
            grants.unused.clear();
            grants.used.clear();
            for id in ids {
                let last_use_ms = u64::from(id != grant.connection_id);
                let record = grants.grants.get_mut(&id).expect("grant record");
                record.used = true;
                record.last_use_ms = last_use_ms;
                grants.used.insert((last_use_ms, id));
            }
        }
        registry
            .open(Some("after_retirement".to_owned()), None, true)
            .expect("expired socket grant makes bounded room");
        assert!(
            registry
                .verify(&grant.connection_id, Some(&grant.connection_token))
                .is_err(),
            "the connected socket grant was the pressure victim"
        );

        ephemeral.enqueue_durable_for_test(
            &grant.connection_id,
            br#"{"kind":"private-after-retirement"}"#.to_vec(),
        );
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match socket.next().await {
                    Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                        panic!("retired socket received queued data: {text}");
                    }
                    Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_)))
                    | Some(Err(_))
                    | None => break,
                    Some(Ok(_)) => {}
                }
            }
        })
        .await
        .expect("retired socket must terminate instead of draining");
        server.abort();
    }

    const RESERVED_PREFIX: &str = "/_snapback/";

    /// LLP 0031 §The invariant — the declared registry holds the boundary: every
    /// app-data entry is a root path, every system entry is under the reserved
    /// prefix, every system-api entry is admin-gated, static console entries are
    /// public presentation, and no privileged operation lives at the root.
    #[test]
    fn s1_route_registry_matches_the_invariant() {
        let registry = route_registry();
        assert!(!registry.is_empty());
        let mut seen = std::collections::BTreeSet::new();
        for route in &registry {
            assert!(
                seen.insert((route.method, route.path)),
                "duplicate registry entry: {} {}",
                route.method,
                route.path
            );
            let reserved = route.path.starts_with(RESERVED_PREFIX);
            match route.class {
                RouteClass::AppData => {
                    assert!(
                        !reserved,
                        "app-data route must live at the root: {}",
                        route.path
                    );
                    assert!(
                        matches!(
                            route.policy,
                            RoutePolicy::Public
                                | RoutePolicy::AppAuth
                                | RoutePolicy::ConnectionAuth
                        ),
                        "app-data route carries an admin policy: {}",
                        route.path
                    );
                }
                RouteClass::SystemStatic => {
                    assert!(
                        route.path.starts_with("/_snapback/admin"),
                        "system-static must be console shell/assets: {}",
                        route.path
                    );
                    assert_eq!(
                        route.policy,
                        RoutePolicy::Public,
                        "console shell is public presentation: {}",
                        route.path
                    );
                }
                RouteClass::SystemApi => {
                    assert!(
                        route.path.starts_with("/_snapback/api/"),
                        "system-api must live under /_snapback/api/: {}",
                        route.path
                    );
                    assert!(
                        matches!(
                            route.policy,
                            RoutePolicy::AdminRead | RoutePolicy::AdminWrite
                        ),
                        "system-api must be admin-gated: {}",
                        route.path
                    );
                }
            }
        }
    }

    /// LLP 0031 §Enforcement — the retired/moved privileged operations must not
    /// reappear at the root in the declared registry.
    #[test]
    fn s1_retired_root_operations_are_absent_from_the_registry() {
        let registry = route_registry();
        for banned in [
            "/admin/schema",
            "/admin/functions",
            "/admin/reset",
            "/admin/seed",
            "/ephemeral/collections",
            "/ephemeral/cleanup",
            "/connections/{connection_id}/disconnect",
        ] {
            assert!(
                !registry.iter().any(|route| route.path == banned),
                "{banned} must not be a registered root route after migration"
            );
        }
    }

    /// LLP 0031 §Enforcement — every operation multiplexed over the app-data
    /// `/live/*` socket is itself app-data, and the declared list matches the
    /// enum's variants (the exhaustive `live_socket_operation_name` forces a new
    /// variant to be classified).
    #[test]
    fn s1_live_socket_operations_are_all_app_data() {
        let declared = live_socket_operations();
        for (name, class) in &declared {
            assert_eq!(
                *class,
                RouteClass::AppData,
                "live-socket operation {name} must be app-data"
            );
        }

        let scope = Scope::from_pairs([("roomId", "room_1")]);
        let samples = [
            LiveSocketClientMessage::EphemeralSubscribe {
                request_id: None,
                request: SubscribeRequest {
                    collection: "c".to_owned(),
                    scope: scope.clone(),
                    connection_id: "conn".to_owned(),
                    auth: Default::default(),
                },
            },
            LiveSocketClientMessage::EphemeralPublish {
                request_id: None,
                request: PublishRequest {
                    collection: "c".to_owned(),
                    scope: scope.clone(),
                    connection_id: "conn".to_owned(),
                    session_id: None,
                    user_id: None,
                    custom_key: None,
                    value: Vec::new(),
                    ttl_ms: None,
                    auth: Default::default(),
                },
            },
            LiveSocketClientMessage::EphemeralDelete {
                request_id: None,
                request: DeleteRequest {
                    collection: "c".to_owned(),
                    scope: scope.clone(),
                    connection_id: "conn".to_owned(),
                    session_id: None,
                    user_id: None,
                    custom_key: None,
                    auth: Default::default(),
                },
            },
            LiveSocketClientMessage::EphemeralUnsubscribe {
                request_id: None,
                request: SubscribeRequest {
                    collection: "c".to_owned(),
                    scope,
                    connection_id: "conn".to_owned(),
                    auth: Default::default(),
                },
            },
            LiveSocketClientMessage::Ping { request_id: None },
        ];
        let sample_names: std::collections::BTreeSet<_> =
            samples.iter().map(live_socket_operation_name).collect();
        let declared_names: std::collections::BTreeSet<_> =
            declared.iter().map(|(name, _)| *name).collect();
        assert_eq!(
            sample_names, declared_names,
            "every LiveSocketClientMessage variant must be a declared app-data operation"
        );
    }

    #[test]
    fn live_socket_rejects_oversized_control_frames_before_json_decode() {
        let snapback = LocalSnapback::memory().expect("memory instance");
        let ephemeral = snapback.ephemeral_api();
        let frame = "x".repeat(super::MAX_LIVE_SOCKET_FRAME_BYTES + 1);
        let response: serde_json::Value =
            serde_json::from_str(&super::handle_live_socket_text(&ephemeral, "conn", &frame))
                .expect("typed socket error");
        assert_eq!(
            response["diagnostic"]["code"],
            "SNAPBACK_WEBSOCKET_MESSAGE_TOO_LARGE"
        );
    }
}
