use crate::admin::{AppState, ServerContext, ServerProfile};
use crate::admin_secret_read::{
    SECRET_READ_LEASE_HEADER, SecretReadLeaseRegistry, SecretReadMintEnvelope, SecretReadScope,
};
use crate::auth::admission::{AdmissionLease, AuthAdmissionController, ModeCommitFailure};
use crate::auth::coordinator::{AuthCoordinator, IssuanceFinish, RevocationFinish, RotationFinish};
use crate::auth::handshake::{
    AUTH_PROTOCOL_V1, AuthClientProtocolOffers, AuthSessionAuthority, AuthSessionFacts,
    AuthSessionResponse,
};
use crate::auth::invocation::{
    HandlerAuthProjection, InvocationGate, InvocationSource, PreparedAuthority,
    ResolvedAppAuthority, WireAuthorityFields,
};
use crate::auth::provider::{
    AddressAdmission, AuthProvider, AuthProviderReadiness, CredentialIssue, ExchangeAdmission,
    PlannedExchange, PlannedFamilyAlarmCommit, PlannedLogout, PlannedRefresh,
    PlannedRevocationCommit, ProviderError, auth_required as provider_auth_required,
    credential_superseded as provider_credential_superseded,
    refresh_superseded as provider_refresh_superseded, session_expired as provider_session_expired,
};
use crate::auth::wire::{
    CredentialResponse, EmptyAuthRequest, ExchangeRequest, FamilyAlarmResponse, MailboxQuery,
    MailboxResponse, MintSessionRequest, RequestCodeRequest, RequestCodeResponse,
    RescueCollidingTableRequest, SecretInput,
};
use crate::cron::{CronRunMetadata, CronRunRecord};
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::ephemeral::{
    DeleteRequest, EphemeralCollection, PublishRequest, Scope, SubscribeRequest,
};
use crate::live_wire::{
    LiveSocketClientMessage, LiveSocketServerFrame, Receipt, SubscriptionReceiptEvent,
};
use crate::local::{
    AdmittedCronClaim, AppActionStage, ConfigVerifyStage, DetachedMutationRead,
    EnsureAppExplicitInput, EnsureAppMode, EnsureAppRequest, EnsureAppResponse, EphemeralApi,
    FunctionRunResult, InspectState, LiveResumeInput, LiveSubscribeInput, LiveUnsubscribeInput,
    LocalSnapback, StagedAction, StagedAppAction, StagedConfigVerify, StagedNestedMutation,
};
use crate::manifest::{
    AuthInput, AuthMode, CtxAnswerLedger, FunctionKind, FunctionManifest, FunctionRuntime,
    HandlerInput, MutationAcknowledgementRequest, MutationAcknowledgementResponse, MutationOutput,
    MutationRequest, SchemaManifest, SeedData,
};
use crate::runtime::{CapabilityState, IbexActionHost};
use crate::storage::auth::AuthTransactionAttempt;
use axum::extract::rejection::{BytesRejection, JsonRejection, QueryRejection};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Extension, OriginalUri, Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{MethodRouter, get, post};
use axum::{
    Json, Router,
    body::{Body, Bytes, to_bytes},
};
use futures_util::{SinkExt, StreamExt};
use http_body::Body as HttpBody;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore, mpsc, oneshot};
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
    authority: PreparedAuthority,
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
        let authority = self
            .authority
            .inherit_for(InvocationSource::NestedMutation)?;
        match snapback.stage_nested_mutation(name, &input, authority)? {
            StagedNestedMutation::InLock(prepared) => snapback.invoke_host_plan_mutation_guarded(
                name,
                input,
                prepared,
                || self.validate_live("runMutation"),
                || self.lock_commit_live("runMutation"),
            ),
            StagedNestedMutation::Detached(staged) => {
                let input = staged.binding.invocation.canonicalize_input(input);
                drop(snapback);
                let module = match &staged.binding.function.runtime {
                    FunctionRuntime::IbexModule(module) => module,
                    _ => unreachable!("detached nested mutation must be an Ibex module"),
                };
                let executed = match staged.read {
                    DetachedMutationRead::Lane(read) => read.execute_detached_ibex_mutation(
                        module,
                        input.clone(),
                        &staged.binding.invocation,
                        &staged.binding.schema,
                        self.deadline,
                    )?,
                    DetachedMutationRead::Snapshot(db) => {
                        crate::runtime::execute_ibex_mutation_prepared(
                            module,
                            input.clone(),
                            &staged.binding.invocation,
                            crate::storage::DbRead::Live(db.as_ref()),
                            None,
                            Some(self.deadline),
                        )?
                    }
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
                    invocation,
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
                    authority: invocation.authority().clone(),
                };
                let input = invocation.canonicalize_input(input);
                let result = runtime.invoke_ibex_action_prepared(
                    &module,
                    input,
                    &invocation,
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
        StagedAction::InLock(prepared) => {
            let name = name.to_owned();
            with_snapback(state, move |snapback| {
                snapback.invoke_action_prepared(&name, input, metadata, prepared)
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
    claim: AdmittedCronClaim,
) -> SnapbackResult<CronRunRecord> {
    let started_wall_ms = now_millis();
    let input = crate::local::cron_claim_input(&claim);
    let metadata = claim.metadata.clone();
    let action = claim.job.action.clone();
    let staged = {
        let action = action.clone();
        let admission = claim.admission_lease().clone();
        with_snapback(state, move |snapback| {
            snapback.stage_action_invocation_with_admission(&action, admission)
        })
        .await
    };
    let result = match staged {
        Ok(StagedAction::Detached(action)) => {
            run_detached_ibex_action(state, action, input, metadata).await
        }
        Ok(StagedAction::InLock(prepared)) => {
            with_snapback(state, move |snapback| {
                snapback.invoke_action_prepared(&action, input, metadata, prepared)
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
#[derive(Clone, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ConnectionGrant {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    #[serde(rename = "connectionToken")]
    pub connection_token: String,
}

impl std::fmt::Debug for ConnectionGrant {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // @ref LLP 0039#diagnostics-and-route-registry — bearer capabilities
        // never enter logs or diagnostic/debug projections.
        formatter
            .debug_struct("ConnectionGrant")
            .field("connection_id", &self.connection_id)
            .field("connection_token", &"[REDACTED]")
            .finish()
    }
}

/// The `POST /connection/open` request. `previousToken` is a bearer secret
/// used only to prove ownership of an existing grant; it is request-only and
/// must never enter diagnostics, receipts, retained client state, or logs.
///
/// @ref LLP 0051#d4-finish-dk-7-the-live-envelope-becomes-schema-governed —
///   the complete non-JS client HTTP surface is Rust-owned and generated.
#[derive(Clone, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenConnectionRequest {
    #[serde(default, alias = "connection_id")]
    pub connection_id: Option<String>,
    /// A prior grant's bearer. This field is deliberately absent from every
    /// server response and from all receipt/capsule schemas.
    #[serde(default, alias = "previous_token")]
    pub previous_token: Option<String>,
}

impl std::fmt::Debug for OpenConnectionRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OpenConnectionRequest")
            .field("connection_id", &self.connection_id)
            .field(
                "previous_token",
                &self.previous_token.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
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

    /// Authenticate a bearer before a body-carried connection id is decoded.
    /// The exact id↔token pair is still checked after the bounded JSON peek,
    /// but an invalid bearer cannot reach JSON extraction or a handler side
    /// effect merely because this transport places its id in the body.
    fn verify_presented_bearer(&self, presented: Option<&str>) -> Result<(), ApiError> {
        let Some(presented) = presented else {
            return Err(connection_auth_error(
                "SNAPBACK_CONNECTION_TOKEN_REQUIRED",
                "connection-scoped operations require the connection token issued by POST /connection/open",
                "",
            ));
        };
        let grants = self.lock();
        let valid = grants.grants.values().fold(false, |valid, record| {
            constant_time_str_eq(&record.token, presented) || valid
        });
        if valid {
            Ok(())
        } else {
            Err(connection_auth_error(
                "SNAPBACK_CONNECTION_TOKEN_INVALID",
                "connection token is not open on this server",
                "",
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

fn header_secret_read_lease(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(SECRET_READ_LEASE_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn single_header_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?.to_str().ok()?;
    values.next().is_none().then_some(value)
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

fn connection_token_for_request(
    effective: EffectiveRoutePolicy,
    request: &Request<Body>,
) -> Option<String> {
    match effective.credential_resolution {
        CredentialResolution::ConnectionGrantHeader => header_connection_token(request.headers()),
        CredentialResolution::ConnectionGrantHeaderOrWebSocketSubprotocol => {
            header_connection_token(request.headers())
                .or_else(|| subprotocol_connection_token(request.headers()))
        }
        CredentialResolution::ConnectionGrantHeaderOrDevQuery => {
            header_connection_token(request.headers()).or_else(|| {
                request.uri().query().and_then(|query| {
                    query.split('&').find_map(|pair| {
                        pair.strip_prefix("connection_token=")
                            .filter(|value| !value.is_empty())
                            .map(ToOwned::to_owned)
                    })
                })
            })
        }
        // Route validation rejects ConnectionAuth entries whose credential
        // axis does not name an HTTP connection carrier.
        _ => None,
    }
}

fn connection_id_from_request_path(path: &str) -> Option<&str> {
    path.strip_prefix("/live/")
        .and_then(|path| path.strip_suffix("/stream"))
        .or_else(|| path.strip_prefix("/outbox/"))
}

#[derive(Default, Deserialize)]
struct ConnectionTokenQuery {
    #[serde(default)]
    connection_token: Option<String>,
}

impl std::fmt::Debug for ConnectionTokenQuery {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConnectionTokenQuery")
            .field(
                "connection_token",
                &self.connection_token.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

/// `POST /connection/open` — the connection handshake (ENG-23442). Public by
/// design: it GRANTS a capability rather than exercising one, exactly like
/// `/app/ensure`. The profile decides whether a caller-suggested id may be
/// adopted (non-prod only).
async fn open_connection(
    State(connections): State<ConnectionRegistry>,
    State(ctx): State<Arc<ServerContext>>,
    Extension(_authority): Extension<PreparedAuthority>,
    Extension(admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<ConnectionGrant>, ApiError> {
    let body = parse_optional_json::<OpenConnectionRequest>(&headers, body)?;
    let (suggested, previous_token) = body
        .map(|body| (body.connection_id, body.previous_token))
        .unwrap_or_default();
    let allow_suggested = ctx.profile.allows_provisioning();
    let _effect = admission.effect_guard("connection grant publication")?;
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
    /// Closed auth-provider readiness. Missing/corrupt keyring details never
    /// cross the public health boundary.
    #[serde(rename = "authProvider", default)]
    pub auth_provider: crate::auth::runtime::AuthProviderHealth,
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
    SessionAuth,
    AdminRead,
    AdminWrite,
    AdminSecretRead,
}

/// The credential carrier a route resolves. This is deliberately independent
/// from [`RoutePolicy`]: an `AdminWrite` path plus an
/// `ImpersonationCapability` effect, for example, needs two distinct carriers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CredentialResolution {
    None,
    /// A closed email-code challenge body proves authority only to exchange
    /// that challenge for a fresh credential; it is never a caller identity.
    ChallengeProof,
    /// A bearer accepted only by the opaque revoke-only family alarm.
    FamilyAlarmBearer,
    LegacyBodyAuth,
    ConnectionGrantHeader,
    ConnectionGrantHeaderOrWebSocketSubprotocol,
    ConnectionGrantHeaderOrDevQuery,
    BoundConnectionGrant,
    AdminCredential,
    OptionalSessionBearer,
    RequiredSessionBearer,
    AdminSecretReadLease,
    OperationSpecific,
}

/// The server-side authority installed for an invocation after credential
/// resolution. No client-provided structure is a `ResolvedCaller`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InvocationAuthority {
    None,
    ClientAsserted,
    ResolvedCaller,
    ConnectionBound,
    DevImpersonation,
    Operator,
    AnonymousAdminBypass,
    System,
}

/// Whether an ingress accepts the legacy body `auth` shape. Session-mode
/// overlays turn every applicable `Allowed` entry into `Rejected`; omission is
/// different from a body that was accepted and ignored.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LegacyBodyPolicy {
    NotApplicable,
    Allowed,
    Rejected,
}

/// An additional effect gate composed with the path policy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EffectPolicy {
    None,
    Provisioning,
    FunctionKind,
    OperationSpecific,
    SecretReadMintProof,
    ImpersonationCapability,
    Unavailable,
}

/// What a successful response is allowed to carry. The middleware applies
/// no-store to every non-public class; field-level typed projections remain the
/// stronger protection for public payloads.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResponseSensitivity {
    StaticPublic,
    PublicProjection,
    /// A public typed response whose contents must never be cached. This is
    /// distinct from operator/application data: request-code and family-alarm
    /// reveal no protected row, but caching either protocol response is still
    /// invalid.
    PublicNoStore,
    ApplicationData,
    ConnectionSecret,
    OperatorMetadata,
    SensitiveApplicationData,
    CredentialSecret,
}

/// Auth mode used only to evaluate route metadata. Item 4 owns the persisted,
/// staged runtime mode and will feed it into this already-closed evaluator.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PolicyAuthMode {
    Dev,
    Sessions,
}

impl From<EnsureAppMode> for PolicyAuthMode {
    fn from(mode: EnsureAppMode) -> Self {
        match mode {
            EnsureAppMode::Dev => Self::Dev,
            EnsureAppMode::Sessions => Self::Sessions,
        }
    }
}

impl From<crate::manifest::AuthMode> for PolicyAuthMode {
    fn from(mode: crate::manifest::AuthMode) -> Self {
        match mode {
            crate::manifest::AuthMode::Dev => Self::Dev,
            crate::manifest::AuthMode::Sessions => Self::Sessions,
        }
    }
}

/// Active and desired auth-policy facts consumed by pre-effect gates. Item 2
/// supplies this explicit seam so an active-dev server cannot treat a request
/// or already-staged desired-sessions posture as Public provisioning. Item 4
/// replaces the constructor default with persisted pre-bind resolution.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PolicyAuthPosture {
    pub active: PolicyAuthMode,
    pub desired: PolicyAuthMode,
}

impl PolicyAuthPosture {
    pub const fn settled(mode: PolicyAuthMode) -> Self {
        Self {
            active: mode,
            desired: mode,
        }
    }

    fn settled_at(self, mode: PolicyAuthMode) -> bool {
        self.active == mode && self.desired == mode
    }
}

/// Per-axis changes that become effective in session mode. `None` means the
/// dev value remains in force; this makes mode-dependent behavior explicit
/// without multiplying route literals.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SessionModeOverlay {
    pub path_policy: Option<RoutePolicy>,
    pub credential_resolution: Option<CredentialResolution>,
    pub invocation_authority: Option<InvocationAuthority>,
    pub legacy_body_policy: Option<LegacyBodyPolicy>,
    pub effect_policy: Option<EffectPolicy>,
    pub response_sensitivity: Option<ResponseSensitivity>,
}

impl SessionModeOverlay {
    pub const NONE: Self = Self {
        path_policy: None,
        credential_resolution: None,
        invocation_authority: None,
        legacy_body_policy: None,
        effect_policy: None,
        response_sensitivity: None,
    };

    pub const fn app_session() -> Self {
        Self {
            // Ordinary app invocation paths are optional-user at the route
            // boundary. A function's closed authRequirement may strengthen
            // that to required at the shared invocation gate (item 4).
            path_policy: Some(RoutePolicy::Public),
            credential_resolution: Some(CredentialResolution::OptionalSessionBearer),
            invocation_authority: Some(InvocationAuthority::ResolvedCaller),
            legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
            effect_policy: None,
            response_sensitivity: None,
        }
    }

    pub const fn connection_bound() -> Self {
        Self {
            path_policy: None,
            credential_resolution: None,
            invocation_authority: Some(InvocationAuthority::ConnectionBound),
            legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
            effect_policy: None,
            response_sensitivity: None,
        }
    }

    pub const fn secret_read() -> Self {
        Self {
            path_policy: Some(RoutePolicy::AdminSecretRead),
            credential_resolution: Some(CredentialResolution::AdminSecretReadLease),
            invocation_authority: None,
            legacy_body_policy: None,
            effect_policy: None,
            response_sensitivity: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EffectiveRoutePolicy {
    pub path_policy: RoutePolicy,
    pub credential_resolution: CredentialResolution,
    pub invocation_authority: InvocationAuthority,
    pub legacy_body_policy: LegacyBodyPolicy,
    pub effect_policy: EffectPolicy,
    pub response_sensitivity: ResponseSensitivity,
}

/// A declared route in the registry. `policy` is retained as a source
/// compatible spelling of `path_policy`; constructors set both and the router
/// refuses registrations where they differ.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RouteSpec {
    pub method: &'static str,
    pub path: &'static str,
    pub class: RouteClass,
    pub path_policy: RoutePolicy,
    pub policy: RoutePolicy,
    pub credential_resolution: CredentialResolution,
    pub invocation_authority: InvocationAuthority,
    pub legacy_body_policy: LegacyBodyPolicy,
    pub effect_policy: EffectPolicy,
    pub response_sensitivity: ResponseSensitivity,
    pub session_overlay: SessionModeOverlay,
}

impl RouteSpec {
    // Keeping the independent policy axes explicit is the point of this
    // constructor; hiding them in an untyped options bag would recreate the
    // registry drift ENG-24594 closes.
    #[allow(clippy::too_many_arguments)]
    pub const fn new(
        method: &'static str,
        path: &'static str,
        class: RouteClass,
        path_policy: RoutePolicy,
        credential_resolution: CredentialResolution,
        invocation_authority: InvocationAuthority,
        legacy_body_policy: LegacyBodyPolicy,
        response_sensitivity: ResponseSensitivity,
    ) -> Self {
        Self {
            method,
            path,
            class,
            path_policy,
            policy: path_policy,
            credential_resolution,
            invocation_authority,
            legacy_body_policy,
            effect_policy: EffectPolicy::None,
            response_sensitivity,
            session_overlay: SessionModeOverlay::NONE,
        }
    }

    pub const fn with_effect(mut self, effect_policy: EffectPolicy) -> Self {
        self.effect_policy = effect_policy;
        self
    }

    pub const fn with_invocation_authority(
        mut self,
        invocation_authority: InvocationAuthority,
    ) -> Self {
        self.invocation_authority = invocation_authority;
        self
    }

    pub const fn with_session_overlay(mut self, session_overlay: SessionModeOverlay) -> Self {
        self.session_overlay = session_overlay;
        self
    }

    /// Methods structurally installed for this path. Axum's `get` includes
    /// HEAD, and the registry builder attaches one inert CORS preflight to
    /// every known path; no middleware manufactures methods for unknown paths.
    pub fn accepts_http_method(&self, method: &str) -> bool {
        method == self.method || method == "OPTIONS" || (self.method == "GET" && method == "HEAD")
    }

    pub fn effective_for(self, mode: PolicyAuthMode) -> EffectiveRoutePolicy {
        let mut effective = EffectiveRoutePolicy {
            path_policy: self.path_policy,
            credential_resolution: self.credential_resolution,
            invocation_authority: self.invocation_authority,
            legacy_body_policy: self.legacy_body_policy,
            effect_policy: self.effect_policy,
            response_sensitivity: self.response_sensitivity,
        };
        if matches!(mode, PolicyAuthMode::Sessions) {
            let overlay = self.session_overlay;
            effective.path_policy = overlay.path_policy.unwrap_or(effective.path_policy);
            effective.credential_resolution = overlay
                .credential_resolution
                .unwrap_or(effective.credential_resolution);
            effective.invocation_authority = overlay
                .invocation_authority
                .unwrap_or(effective.invocation_authority);
            effective.legacy_body_policy = overlay
                .legacy_body_policy
                .unwrap_or(effective.legacy_body_policy);
            effective.effect_policy = overlay.effect_policy.unwrap_or(effective.effect_policy);
            effective.response_sensitivity = overlay
                .response_sensitivity
                .unwrap_or(effective.response_sensitivity);
        }
        effective
    }

    /// Validate the complete route-policy tuple in both modes. Registration
    /// turns an error into a startup panic; exposing the result lets the
    /// acceptance suite prove malformed tuples are rejected without building
    /// a deliberately broken router.
    pub fn validate(&self) -> Result<(), String> {
        let fail = |message: &str| {
            Err(format!(
                "invalid policy for {} {}: {message}",
                self.method, self.path
            ))
        };
        if self.path_policy != self.policy {
            return fail("path-policy aliases diverged");
        }
        match self.class {
            RouteClass::AppData if self.path.starts_with("/_snapback/") => {
                return fail("app-data route escaped the root namespace");
            }
            RouteClass::SystemStatic => {
                if !self.path.starts_with("/_snapback/admin")
                    || self.path_policy != RoutePolicy::Public
                    || self.credential_resolution != CredentialResolution::None
                    || self.invocation_authority != InvocationAuthority::None
                    || self.legacy_body_policy != LegacyBodyPolicy::NotApplicable
                    || self.effect_policy != EffectPolicy::None
                    || self.response_sensitivity != ResponseSensitivity::StaticPublic
                    || self.session_overlay != SessionModeOverlay::NONE
                {
                    return fail("system-static entries must be inert public assets");
                }
            }
            RouteClass::SystemApi => {
                if !self.path.starts_with("/_snapback/api/") {
                    return fail("system API escaped the reserved namespace");
                }
                if !matches!(
                    self.path_policy,
                    RoutePolicy::AdminRead
                        | RoutePolicy::AdminWrite
                        | RoutePolicy::AdminSecretRead
                        | RoutePolicy::SessionAuth
                ) {
                    return fail("system API has a non-system path policy");
                }
            }
            RouteClass::AppData => {}
        }

        let valid_base_carrier = match self.path_policy {
            RoutePolicy::Public => matches!(
                self.credential_resolution,
                CredentialResolution::None
                    | CredentialResolution::ChallengeProof
                    | CredentialResolution::FamilyAlarmBearer
                    | CredentialResolution::OperationSpecific
            ),
            RoutePolicy::AppAuth => {
                self.credential_resolution == CredentialResolution::LegacyBodyAuth
            }
            RoutePolicy::ConnectionAuth => matches!(
                self.credential_resolution,
                CredentialResolution::ConnectionGrantHeader
                    | CredentialResolution::ConnectionGrantHeaderOrWebSocketSubprotocol
                    | CredentialResolution::ConnectionGrantHeaderOrDevQuery
                    | CredentialResolution::BoundConnectionGrant
            ),
            RoutePolicy::SessionAuth => {
                self.credential_resolution == CredentialResolution::RequiredSessionBearer
            }
            RoutePolicy::AdminRead | RoutePolicy::AdminWrite => {
                self.credential_resolution == CredentialResolution::AdminCredential
            }
            RoutePolicy::AdminSecretRead => {
                self.credential_resolution == CredentialResolution::AdminSecretReadLease
            }
        };
        if !valid_base_carrier {
            return fail("path policy and credential carrier are incompatible");
        }

        if self.path_policy == RoutePolicy::AppAuth
            && (self.invocation_authority != InvocationAuthority::ClientAsserted
                || self.legacy_body_policy != LegacyBodyPolicy::Allowed)
        {
            return fail("AppAuth must explicitly resolve allowed dev body authority");
        }
        if self.legacy_body_policy == LegacyBodyPolicy::Allowed
            && self.invocation_authority != InvocationAuthority::ClientAsserted
        {
            return fail("allowed legacy body auth must install client-asserted authority");
        }
        if self.legacy_body_policy == LegacyBodyPolicy::Rejected
            && self.invocation_authority == InvocationAuthority::ClientAsserted
        {
            return fail("rejected legacy body auth cannot install client authority");
        }
        if self.path_policy == RoutePolicy::SessionAuth
            && self.invocation_authority != InvocationAuthority::ResolvedCaller
        {
            return fail("SessionAuth must install a server-resolved caller");
        }
        if self.method != "OPERATION"
            && self.credential_resolution == CredentialResolution::OperationSpecific
            && self.effect_policy != EffectPolicy::OperationSpecific
        {
            return fail("operation-specific credentials require an operation-specific gate");
        }
        if self.credential_resolution == CredentialResolution::ChallengeProof
            && (self.path_policy != RoutePolicy::Public
                || self.invocation_authority != InvocationAuthority::None
                || self.response_sensitivity != ResponseSensitivity::CredentialSecret)
        {
            return fail(
                "challenge proof must be public, install no caller, and return only a credential-secret response",
            );
        }
        if self.credential_resolution == CredentialResolution::FamilyAlarmBearer
            && (self.path_policy != RoutePolicy::Public
                || self.invocation_authority != InvocationAuthority::None
                || self.response_sensitivity != ResponseSensitivity::PublicNoStore)
        {
            return fail(
                "family-alarm bearer must be public, install no caller, and return an opaque no-store response",
            );
        }
        if self.effect_policy == EffectPolicy::ImpersonationCapability
            && self.path_policy != RoutePolicy::AdminWrite
        {
            return fail("impersonation capability must compose with AdminWrite");
        }
        if self.effect_policy == EffectPolicy::SecretReadMintProof
            && (self.path_policy != RoutePolicy::AdminWrite
                || self.response_sensitivity != ResponseSensitivity::CredentialSecret)
        {
            return fail(
                "secret-read mint proof must compose with AdminWrite and CredentialSecret",
            );
        }

        // A wholly anonymous public route may issue a freshly minted
        // connection capability, but it may not expose app/identity rows or a
        // general credential response without a typed proof/resolution seam.
        if self.path_policy == RoutePolicy::Public
            && self.credential_resolution == CredentialResolution::None
            && self.invocation_authority == InvocationAuthority::None
            && matches!(
                self.response_sensitivity,
                ResponseSensitivity::ApplicationData
                    | ResponseSensitivity::SensitiveApplicationData
                    | ResponseSensitivity::CredentialSecret
            )
        {
            return fail("anonymous public route has an unsafe response classification");
        }

        let sessions = self.effective_for(PolicyAuthMode::Sessions);
        if self.path_policy == RoutePolicy::AppAuth
            && (sessions.path_policy != RoutePolicy::Public
                || sessions.credential_resolution != CredentialResolution::OptionalSessionBearer
                || sessions.invocation_authority != InvocationAuthority::ResolvedCaller
                || sessions.legacy_body_policy != LegacyBodyPolicy::Rejected)
        {
            return fail("AppAuth has an incomplete sessions overlay");
        }
        if self.legacy_body_policy == LegacyBodyPolicy::Allowed
            && (sessions.legacy_body_policy != LegacyBodyPolicy::Rejected
                || sessions.invocation_authority == InvocationAuthority::ClientAsserted)
        {
            return fail("client-asserted body authority remains live in sessions");
        }
        if self.credential_resolution == CredentialResolution::ConnectionGrantHeaderOrDevQuery
            && sessions.credential_resolution != CredentialResolution::ConnectionGrantHeader
        {
            return fail("dev query credential fallback remains live in sessions");
        }
        if self.path_policy == RoutePolicy::ConnectionAuth
            && sessions.invocation_authority != InvocationAuthority::ConnectionBound
        {
            return fail("ConnectionAuth lacks bound authority in sessions");
        }
        if sessions.path_policy == RoutePolicy::SessionAuth
            && (sessions.invocation_authority != InvocationAuthority::ResolvedCaller
                || sessions.legacy_body_policy == LegacyBodyPolicy::Allowed)
        {
            return fail("SessionAuth effective policy is incomplete");
        }
        if sessions.effect_policy == EffectPolicy::ImpersonationCapability
            && sessions.path_policy != RoutePolicy::AdminWrite
        {
            return fail("sessions impersonation capability lost its AdminWrite gate");
        }
        if self.path_policy == RoutePolicy::AdminRead
            && self.response_sensitivity == ResponseSensitivity::SensitiveApplicationData
            && !matches!(
                self.effect_policy,
                EffectPolicy::FunctionKind | EffectPolicy::OperationSpecific
            )
            && (sessions.path_policy != RoutePolicy::AdminSecretRead
                || sessions.credential_resolution != CredentialResolution::AdminSecretReadLease)
        {
            return fail("sensitive AdminRead route lacks its sessions secret-read gate");
        }
        let valid_sessions_carrier = match sessions.path_policy {
            RoutePolicy::Public => matches!(
                sessions.credential_resolution,
                CredentialResolution::None
                    | CredentialResolution::ChallengeProof
                    | CredentialResolution::FamilyAlarmBearer
                    | CredentialResolution::OptionalSessionBearer
                    | CredentialResolution::OperationSpecific
            ),
            RoutePolicy::AppAuth => false,
            RoutePolicy::ConnectionAuth => matches!(
                sessions.credential_resolution,
                CredentialResolution::ConnectionGrantHeader
                    | CredentialResolution::ConnectionGrantHeaderOrWebSocketSubprotocol
                    | CredentialResolution::BoundConnectionGrant
            ),
            RoutePolicy::SessionAuth => {
                sessions.credential_resolution == CredentialResolution::RequiredSessionBearer
            }
            RoutePolicy::AdminRead | RoutePolicy::AdminWrite => {
                sessions.credential_resolution == CredentialResolution::AdminCredential
            }
            RoutePolicy::AdminSecretRead => {
                sessions.credential_resolution == CredentialResolution::AdminSecretReadLease
            }
        };
        if !valid_sessions_carrier {
            return fail("sessions path policy and credential carrier are incompatible");
        }
        if sessions.legacy_body_policy == LegacyBodyPolicy::Allowed
            || sessions.invocation_authority == InvocationAuthority::ClientAsserted
        {
            return fail("sessions effective policy retains client-asserted authority");
        }
        Ok(())
    }

    fn assert_valid(self) {
        if let Err(error) = self.validate() {
            panic!("{error}");
        }
    }
}

/// One installed route: metadata and its axum handler travel together. The
/// application router and the public registry are both projections of these
/// values, so a runtime route cannot exist without policy metadata.
pub(crate) struct RegisteredRoute {
    pub spec: RouteSpec,
    pub method_router: MethodRouter<AppState>,
}

impl RegisteredRoute {
    pub(crate) fn new(spec: RouteSpec, method_router: MethodRouter<AppState>) -> Self {
        spec.assert_valid();
        Self {
            spec,
            method_router,
        }
    }
}

const fn public_route(
    method: &'static str,
    path: &'static str,
    sensitivity: ResponseSensitivity,
) -> RouteSpec {
    RouteSpec::new(
        method,
        path,
        RouteClass::AppData,
        RoutePolicy::Public,
        CredentialResolution::None,
        InvocationAuthority::None,
        LegacyBodyPolicy::NotApplicable,
        sensitivity,
    )
}

const fn app_auth_route(method: &'static str, path: &'static str) -> RouteSpec {
    RouteSpec::new(
        method,
        path,
        RouteClass::AppData,
        RoutePolicy::AppAuth,
        CredentialResolution::LegacyBodyAuth,
        InvocationAuthority::ClientAsserted,
        LegacyBodyPolicy::Allowed,
        ResponseSensitivity::ApplicationData,
    )
    .with_session_overlay(SessionModeOverlay::app_session())
}

const fn connection_route(
    method: &'static str,
    path: &'static str,
    credential_resolution: CredentialResolution,
    body_auth: bool,
    sensitivity: ResponseSensitivity,
) -> RouteSpec {
    let overlay = if body_auth {
        SessionModeOverlay::connection_bound()
    } else {
        SessionModeOverlay {
            path_policy: None,
            credential_resolution: None,
            invocation_authority: Some(InvocationAuthority::ConnectionBound),
            legacy_body_policy: None,
            effect_policy: None,
            response_sensitivity: None,
        }
    };
    RouteSpec::new(
        method,
        path,
        RouteClass::AppData,
        RoutePolicy::ConnectionAuth,
        credential_resolution,
        if body_auth {
            InvocationAuthority::ClientAsserted
        } else {
            InvocationAuthority::None
        },
        if body_auth {
            LegacyBodyPolicy::Allowed
        } else {
            LegacyBodyPolicy::NotApplicable
        },
        sensitivity,
    )
    .with_session_overlay(overlay)
}

pub(crate) const fn system_api_route(
    method: &'static str,
    path: &'static str,
    policy: RoutePolicy,
    sensitivity: ResponseSensitivity,
) -> RouteSpec {
    RouteSpec::new(
        method,
        path,
        RouteClass::SystemApi,
        policy,
        CredentialResolution::AdminCredential,
        InvocationAuthority::Operator,
        LegacyBodyPolicy::NotApplicable,
        sensitivity,
    )
}

pub(crate) const fn system_static_route(method: &'static str, path: &'static str) -> RouteSpec {
    RouteSpec::new(
        method,
        path,
        RouteClass::SystemStatic,
        RoutePolicy::Public,
        CredentialResolution::None,
        InvocationAuthority::None,
        LegacyBodyPolicy::NotApplicable,
        ResponseSensitivity::StaticPublic,
    )
}

/// The app-data route registrations. Each handler literal appears only here;
/// `app()` installs these entries and `route_registry()` projects their specs.
///
/// @ref LLP 0003#agent-and-test-surface — the local core exposes inspect, query, mutation, live, and ephemeral endpoints.
/// @ref LLP 0031#the-invariant — app-data routes live at the root; system routes live under `/_snapback/*`.
fn core_route_registrations() -> Vec<RegisteredRoute> {
    vec![
        RegisteredRoute::new(
            public_route("GET", "/", ResponseSensitivity::PublicProjection),
            get(instance_home),
        ),
        RegisteredRoute::new(
            public_route("GET", "/health", ResponseSensitivity::PublicProjection),
            get(health),
        ),
        // @ref LLP 0055#bootstrap-handshake — discovery is the sole auth path
        // available in every mode and while a transition is pending.
        RegisteredRoute::new(
            RouteSpec::new(
                "GET",
                "/auth/session",
                RouteClass::AppData,
                RoutePolicy::Public,
                CredentialResolution::None,
                InvocationAuthority::None,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::PublicNoStore,
            )
            .with_session_overlay(SessionModeOverlay {
                path_policy: None,
                credential_resolution: Some(CredentialResolution::OptionalSessionBearer),
                invocation_authority: Some(InvocationAuthority::ResolvedCaller),
                legacy_body_policy: None,
                effect_policy: None,
                response_sensitivity: None,
            }),
            get(auth_session).layer(DefaultBodyLimit::max(0)),
        ),
        RegisteredRoute::new(
            public_route("GET", "/inspect", ResponseSensitivity::PublicProjection),
            get(inspect),
        ),
        // @ref LLP 0054#routes-operations-and-dtos — provider routes carry
        // closed, independently enforced credential and response axes. Item 3
        // installs their state machines; item 4 supplies persisted activation.
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/request-code",
                RouteClass::AppData,
                RoutePolicy::Public,
                CredentialResolution::None,
                InvocationAuthority::None,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::PublicNoStore,
            ),
            post(auth_request_code).layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/exchange",
                RouteClass::AppData,
                RoutePolicy::Public,
                CredentialResolution::ChallengeProof,
                InvocationAuthority::None,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::CredentialSecret,
            ),
            post(auth_exchange).layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/refresh",
                RouteClass::AppData,
                RoutePolicy::SessionAuth,
                CredentialResolution::RequiredSessionBearer,
                InvocationAuthority::ResolvedCaller,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::CredentialSecret,
            ),
            post(auth_refresh).layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/logout",
                RouteClass::AppData,
                RoutePolicy::SessionAuth,
                CredentialResolution::RequiredSessionBearer,
                InvocationAuthority::ResolvedCaller,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::CredentialSecret,
            ),
            post(auth_logout).layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/family-alarm",
                RouteClass::AppData,
                RoutePolicy::Public,
                CredentialResolution::FamilyAlarmBearer,
                InvocationAuthority::None,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::PublicNoStore,
            ),
            post(auth_family_alarm).layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(app_auth_route("POST", "/query/{name}"), post(invoke_query)),
        RegisteredRoute::new(
            app_auth_route("POST", "/client-mutations/acknowledge"),
            post(acknowledge_mutations),
        ),
        RegisteredRoute::new(
            app_auth_route("POST", "/mutation/{name}"),
            post(invoke_mutation),
        ),
        RegisteredRoute::new(
            app_auth_route("POST", "/action/{name}"),
            post(invoke_action),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/app/ensure",
                RouteClass::AppData,
                RoutePolicy::Public,
                CredentialResolution::OperationSpecific,
                InvocationAuthority::None,
                LegacyBodyPolicy::NotApplicable,
                // The carrier is conservatively no-store; the selected
                // operation row distinguishes public attest from privileged
                // provisioning without risking a cacheable provision result.
                ResponseSensitivity::OperatorMetadata,
            )
            .with_effect(EffectPolicy::OperationSpecific),
            post(ensure_app),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/connection/open",
                RouteClass::AppData,
                RoutePolicy::Public,
                CredentialResolution::None,
                InvocationAuthority::None,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::ConnectionSecret,
            )
            .with_session_overlay(SessionModeOverlay {
                path_policy: None,
                credential_resolution: Some(CredentialResolution::OptionalSessionBearer),
                invocation_authority: Some(InvocationAuthority::ResolvedCaller),
                legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
                effect_policy: None,
                response_sensitivity: None,
            }),
            post(open_connection),
        ),
        RegisteredRoute::new(
            connection_route(
                "POST",
                "/live/{name}/subscribe",
                CredentialResolution::ConnectionGrantHeader,
                true,
                ResponseSensitivity::ApplicationData,
            ),
            post(subscribe_live),
        ),
        RegisteredRoute::new(
            connection_route(
                "POST",
                "/live/{name}/resume",
                CredentialResolution::ConnectionGrantHeader,
                true,
                ResponseSensitivity::ApplicationData,
            ),
            post(resume_live),
        ),
        RegisteredRoute::new(
            connection_route(
                "POST",
                "/live/{name}/unsubscribe",
                CredentialResolution::ConnectionGrantHeader,
                true,
                ResponseSensitivity::ApplicationData,
            ),
            post(unsubscribe_live),
        ),
        RegisteredRoute::new(
            connection_route(
                "GET",
                "/live/{connection_id}/stream",
                CredentialResolution::ConnectionGrantHeaderOrWebSocketSubprotocol,
                false,
                ResponseSensitivity::ApplicationData,
            ),
            get(stream_live),
        ),
        RegisteredRoute::new(
            connection_route(
                "GET",
                "/outbox/{connection_id}",
                CredentialResolution::ConnectionGrantHeaderOrDevQuery,
                false,
                ResponseSensitivity::ApplicationData,
            )
            .with_session_overlay(SessionModeOverlay {
                path_policy: None,
                credential_resolution: Some(CredentialResolution::ConnectionGrantHeader),
                invocation_authority: Some(InvocationAuthority::ConnectionBound),
                legacy_body_policy: None,
                effect_policy: None,
                response_sensitivity: None,
            }),
            get(drain_outbox),
        ),
        RegisteredRoute::new(
            public_route(
                "POST",
                "/ephemeral/collections/ensure",
                ResponseSensitivity::PublicProjection,
            ),
            post(ensure_ephemeral_collections),
        ),
        RegisteredRoute::new(
            connection_route(
                "POST",
                "/ephemeral/publish",
                CredentialResolution::ConnectionGrantHeader,
                true,
                ResponseSensitivity::ApplicationData,
            ),
            post(publish_ephemeral),
        ),
        RegisteredRoute::new(
            connection_route(
                "POST",
                "/ephemeral/subscribe",
                CredentialResolution::ConnectionGrantHeader,
                true,
                ResponseSensitivity::ApplicationData,
            ),
            post(subscribe_ephemeral),
        ),
        RegisteredRoute::new(
            connection_route(
                "POST",
                "/ephemeral/delete",
                CredentialResolution::ConnectionGrantHeader,
                true,
                ResponseSensitivity::ApplicationData,
            ),
            post(delete_ephemeral),
        ),
    ]
}

/// The system routes owned by the server module. Admin/static routes are
/// registered by `admin_route_registrations()` through the same type.
///
/// @ref LLP 0031#migration-plan — D5 flat `subsystem/verb` writes and the D2 disconnect move.
fn system_route_registrations() -> Vec<RegisteredRoute> {
    let write =
        |path, sensitivity| system_api_route("POST", path, RoutePolicy::AdminWrite, sensitivity);
    vec![
        // @ref LLP 0054#routes-operations-and-dtos — capture plaintext is an
        // exact operator-only projection requiring both AdminWrite and the
        // independent, process-bound impersonation capability.
        RegisteredRoute::new(
            system_api_route(
                "GET",
                "/_snapback/api/auth/mailbox",
                RoutePolicy::AdminWrite,
                ResponseSensitivity::CredentialSecret,
            )
            .with_effect(EffectPolicy::ImpersonationCapability),
            get(auth_mailbox),
        ),
        RegisteredRoute::new(
            write(
                "/_snapback/api/schema/load",
                ResponseSensitivity::OperatorMetadata,
            ),
            post(apply_schema),
        ),
        RegisteredRoute::new(
            write(
                "/_snapback/api/functions/load",
                ResponseSensitivity::OperatorMetadata,
            ),
            post(load_functions),
        ),
        RegisteredRoute::new(
            write(
                "/_snapback/api/app/reset",
                ResponseSensitivity::SensitiveApplicationData,
            ),
            post(app_reset),
        ),
        RegisteredRoute::new(
            write(
                "/_snapback/api/client-mutations/purge",
                ResponseSensitivity::OperatorMetadata,
            ),
            post(purge_client_mutation_settlements),
        ),
        // @ref LLP 0024#result-envelope — host ops resolve their per-operation
        // authority after the shared route-level AdminRead floor.
        RegisteredRoute::new(
            system_api_route(
                "POST",
                "/_snapback/api/host-ops",
                RoutePolicy::AdminRead,
                ResponseSensitivity::SensitiveApplicationData,
            )
            .with_effect(EffectPolicy::OperationSpecific),
            post(host_ops_handler),
        ),
        RegisteredRoute::new(
            write(
                "/_snapback/api/connections/{connection_id}/disconnect",
                ResponseSensitivity::OperatorMetadata,
            ),
            post(disconnect),
        ),
        // @ref LLP 0036#operations-and-projections-llp-0024 — config reads
        // exclude values; set/unset/verify remain write-gated.
        RegisteredRoute::new(
            system_api_route(
                "GET",
                "/_snapback/api/config/status",
                RoutePolicy::AdminRead,
                ResponseSensitivity::OperatorMetadata,
            ),
            get(config_status),
        ),
        RegisteredRoute::new(
            system_api_route(
                "GET",
                "/_snapback/api/config/plan",
                RoutePolicy::AdminRead,
                ResponseSensitivity::OperatorMetadata,
            ),
            get(config_plan),
        ),
        RegisteredRoute::new(
            write(
                "/_snapback/api/config/set",
                ResponseSensitivity::OperatorMetadata,
            ),
            post(config_set),
        ),
        RegisteredRoute::new(
            write(
                "/_snapback/api/config/unset",
                ResponseSensitivity::OperatorMetadata,
            ),
            post(config_unset),
        ),
        RegisteredRoute::new(
            write(
                "/_snapback/api/config/verify",
                ResponseSensitivity::OperatorMetadata,
            ),
            post(config_verify),
        ),
    ]
}

fn all_route_registrations() -> Vec<RegisteredRoute> {
    core_route_registrations()
        .into_iter()
        .chain(system_route_registrations())
        .chain(crate::admin::admin_route_registrations())
        .collect()
}

fn apply_registered_response_controls(
    effective: EffectiveRoutePolicy,
    mut response: Response,
) -> Response {
    if !matches!(
        effective.response_sensitivity,
        ResponseSensitivity::StaticPublic | ResponseSensitivity::PublicProjection
    ) {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store, private"),
        );
    }
    response
}

const POLICY_BODY_PEEK_LIMIT: usize = 2 * 1024 * 1024;

/// Find a legacy authority field without mistaking ordinary app arguments
/// (which may legitimately contain columns named `user_id`) for transport
/// authority. `auth` is forbidden wherever a legacy wrapper placed it;
/// sibling owner fields are forbidden only on the transport object itself.
pub fn legacy_body_auth_field(value: &Value) -> Option<&str> {
    const FORBIDDEN: &[&str] = &[
        "auth",
        "principal",
        "user_id",
        "userId",
        "session_id",
        "sessionId",
        "custom_key",
        "customKey",
        "auth_fingerprint",
        "authFingerprint",
    ];
    fn envelope_auth(value: &Value) -> Option<&str> {
        let fields = value.as_object()?;
        for name in FORBIDDEN.iter().copied() {
            if fields.contains_key(name) {
                return Some(name);
            }
        }
        // Recurse only through the closed legacy transport wrappers. App
        // values in args/scope/value/correlation and permission-epoch maps
        // are opaque domain data even when a key happens to be `user_id`.
        ["request", "input", "ctx_ledger", "ctxLedger"]
            .into_iter()
            .filter_map(|name| fields.get(name))
            .find_map(envelope_auth)
    }

    envelope_auth(value)
}

fn body_auth_unsupported(field: &str) -> ApiError {
    SnapbackError::error(
        "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED",
        "auth",
        "client-provided identity fields are not accepted when session authority is server-resolved",
    )
    .with_details(json!({ "field": field }))
    .into()
}

async fn peek_policy_json_body(
    request: Request<Body>,
) -> Result<(Request<Body>, Option<Value>), ApiError> {
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body, POLICY_BODY_PEEK_LIMIT)
        .await
        .map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_VALUE_TOO_LARGE",
                "server",
                "request body exceeded the policy-gate inspection limit",
            )
            .with_details(json!({
                "limitBytes": POLICY_BODY_PEEK_LIMIT,
                "error": error.to_string(),
            }))
        })?;
    let value = if bytes.is_empty() {
        None
    } else {
        serde_json::from_slice(&bytes).ok()
    };
    Ok((Request::from_parts(parts, Body::from(bytes)), value))
}

enum HttpOperationSelection {
    Selected(OperationSpec),
    UnknownHost,
    Indeterminate,
}

fn ensure_operation_from_body(body: Option<&Value>) -> Option<OperationSpec> {
    let fields = body?.as_object()?;
    let operation = match fields.get("intent") {
        None => "app.ensure.legacy",
        Some(Value::String(intent)) if intent == "attest" => "app.ensure.attest",
        Some(Value::String(intent)) if intent == "provision" => "app.ensure.provision",
        Some(_) => return None,
    };
    operation_by_name(operation)
}

fn ensure_requested_mode(body: Option<&Value>) -> Option<PolicyAuthMode> {
    match body?.as_object()?.get("requestedMode")?.as_str()? {
        "dev" => Some(PolicyAuthMode::Dev),
        "sessions" => Some(PolicyAuthMode::Sessions),
        _ => None,
    }
}

/// Evaluate the ensure branch against all three mode facts before a loaded
/// artifact hash is inspected. Explicit provisioning is always AdminWrite, so
/// it remains the correction/re-stage branch for any posture. Legacy is only
/// the settled v0-dev compatibility form; Public attestation requires a
/// settled posture matching its requested mode.
fn authorize_ensure_posture(
    operation: OperationSpec,
    body: Option<&Value>,
    posture: PolicyAuthPosture,
) -> Result<(), ApiError> {
    if operation.operation != "app.ensure.provision" && posture.active != posture.desired {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_MODE_PENDING",
            "auth",
            "app.ensure intent is unavailable while desired auth mode differs from active auth mode",
        )
        .into());
    }
    let allowed = match operation.operation {
        "app.ensure.provision" => true,
        "app.ensure.legacy" => posture.settled_at(PolicyAuthMode::Dev),
        "app.ensure.attest" => {
            posture.active == posture.desired
                && ensure_requested_mode(body).is_none_or(|requested| posture.settled_at(requested))
        }
        _ => true,
    };
    if allowed {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
        "auth",
        "app.ensure intent is unavailable for the requested, active, and desired auth-mode posture",
    )
    .into())
}

async fn select_http_operation(
    spec: RouteSpec,
    runtime: &AppState,
    request_path: &str,
    body: Option<&Value>,
) -> HttpOperationSelection {
    match spec.effect_policy {
        EffectPolicy::FunctionKind => {
            let Some(name) = request_path
                .strip_prefix("/_snapback/api/functions/")
                .and_then(|path| path.strip_suffix("/run"))
            else {
                return HttpOperationSelection::Indeterminate;
            };
            let name = name.to_owned();
            let kind = with_snapback(&runtime.snapback, move |snapback| {
                snapback.function_kind(&name)
            })
            .await;
            HttpOperationSelection::Selected(direct_runner_operation_spec(kind.as_ref()))
        }
        EffectPolicy::OperationSpecific if spec.path == "/app/ensure" => {
            ensure_operation_from_body(body)
                .map(HttpOperationSelection::Selected)
                .unwrap_or(HttpOperationSelection::Indeterminate)
        }
        EffectPolicy::OperationSpecific if spec.path == "/_snapback/api/host-ops" => {
            let Some(fields) = body.and_then(Value::as_object) else {
                return HttpOperationSelection::Indeterminate;
            };
            let Some(operation) = fields.get("operation").and_then(Value::as_str) else {
                return HttpOperationSelection::Indeterminate;
            };
            let function = fields.get("function").and_then(Value::as_str);
            let kind = if let Some(function) = function {
                let function = function.to_owned();
                with_snapback(&runtime.snapback, move |snapback| {
                    snapback.function_kind(&function)
                })
                .await
            } else {
                None
            };
            let impersonated = fields
                .get("userId")
                .or_else(|| fields.get("user_id"))
                .is_some_and(|value| !value.is_null());
            match host_ops_operation_spec(operation, kind.as_ref(), impersonated) {
                Some(spec) => HttpOperationSelection::Selected(spec),
                None => HttpOperationSelection::UnknownHost,
            }
        }
        _ => HttpOperationSelection::Indeterminate,
    }
}

fn auth_transition_pending(runtime: &AppState) -> bool {
    let state = runtime.auth_mode_state();
    let posture = runtime.policy_auth_posture();
    state.active != state.desired
        || state.mode_state != crate::auth::mode::AuthModeStatus::Settled
        || state.app_data_availability != crate::auth::mode::AppDataAvailability::Available
        || posture.active != posture.desired
}

fn auth_diagnostic_app_route(path: &str) -> bool {
    matches!(path, "/" | "/health" | "/auth/session")
}

/// Central app-data availability fence. System/operator routes retain their
/// own registered policies; the one pending recovery branch is selected and
/// authorized later by the `/app/ensure` operation gate.
fn auth_app_data_refusal(spec: RouteSpec, runtime: &AppState) -> Option<SnapbackError> {
    if spec.class != RouteClass::AppData || auth_diagnostic_app_route(spec.path) {
        return None;
    }
    if auth_transition_pending(runtime) && spec.path != "/app/ensure" {
        return Some(SnapbackError::error(
            "SNAPBACK_AUTH_MODE_PENDING",
            "auth",
            "ordinary app data is unavailable while the auth-mode transition is pending",
        ));
    }
    let policy_mode = runtime.active_policy_auth_mode();
    if spec.path != "/app/ensure"
        && policy_mode == PolicyAuthMode::Dev
        && matches!(runtime.server.profile, ServerProfile::Prod)
    {
        return Some(SnapbackError::error(
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
            "auth",
            "production profile refuses app data while auth mode is dev",
        ));
    }
    if !runtime.server.loopback {
        let insecure_dev_override = runtime.allow_insecure_dev_auth
            && !matches!(runtime.server.profile, ServerProfile::Prod);
        if policy_mode == PolicyAuthMode::Sessions || !insecure_dev_override {
            return Some(SnapbackError::error(
                "SNAPBACK_AUTH_TRANSPORT_INSECURE",
                "auth",
                "the active auth mode cannot serve app data on a plaintext non-loopback bind",
            ));
        }
    }
    None
}

fn session_online_protocol_refusal(
    spec: RouteSpec,
    runtime: &AppState,
    headers: &HeaderMap,
) -> Option<SnapbackError> {
    if spec.class != RouteClass::AppData
        || auth_diagnostic_app_route(spec.path)
        || spec.path == "/app/ensure"
        || runtime.auth_mode_state().active != crate::manifest::AuthMode::Sessions
    {
        return None;
    }
    if !runtime.auth_program_readiness().session_activation_ready {
        return Some(
            SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "session-mode online request/response is not enabled by this process",
            )
            .with_details(json!({ "capability": "onlineRequestResponse" })),
        );
    }
    if AuthClientProtocolOffers::from_headers(headers).auth_client != Some(AUTH_PROTOCOL_V1) {
        return Some(
            SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "the request does not offer the exact supported auth-client protocol",
            )
            .with_details(json!({
                "capability": "onlineRequestResponse",
                "minimumAuthClientProtocol": AUTH_PROTOCOL_V1,
            })),
        );
    }
    None
}

fn registered_invocation_source(spec: RouteSpec) -> Option<InvocationSource> {
    match spec.path {
        "/auth/session" => Some(InvocationSource::BootstrapHandshake),
        "/query/{name}" => Some(InvocationSource::HttpQuery),
        "/mutation/{name}" => Some(InvocationSource::HttpMutation),
        "/action/{name}" => Some(InvocationSource::HttpAction),
        "/client-mutations/acknowledge" => Some(InvocationSource::StandaloneAcknowledgement),
        "/connection/open" => Some(InvocationSource::ConnectionOpen),
        "/live/{name}/subscribe" => Some(InvocationSource::LiveInitialQuery),
        "/live/{name}/resume" => Some(InvocationSource::LiveResume),
        "/live/{name}/unsubscribe" => Some(InvocationSource::LiveUnsubscribe),
        "/live/{connection_id}/stream" => Some(InvocationSource::LiveStream),
        "/outbox/{connection_id}" => Some(InvocationSource::OutboxDrain),
        "/ephemeral/collections/ensure" => Some(InvocationSource::EphemeralRegister),
        "/ephemeral/publish" => Some(InvocationSource::EphemeralPublish),
        "/ephemeral/subscribe" => Some(InvocationSource::EphemeralSubscribe),
        "/ephemeral/delete" => Some(InvocationSource::EphemeralDelete),
        "/_snapback/api/functions/{name}/run" => Some(InvocationSource::DirectAdminRunner),
        _ => None,
    }
}

fn selected_invocation_source(
    spec: RouteSpec,
    operation: Option<OperationSpec>,
) -> Option<InvocationSource> {
    registered_invocation_source(spec).or_else(|| {
        let operation = operation?.operation;
        if operation.starts_with("host_ops.function.run.") {
            Some(InvocationSource::HostOperationFunctionRun)
        } else if operation.starts_with("host_ops.function.explain") {
            Some(InvocationSource::HostOperationMutationDryRun)
        } else {
            None
        }
    })
}

fn invocation_authority_value(source: InvocationSource, body: Option<&Value>) -> Option<&Value> {
    // `MutationRequest` flattens `HandlerInput`; query/action inputs and all
    // authority-only DTOs are rooted at the request object. Durable live
    // subscribe is the one wrapper whose handler authority lives in `input`.
    let body = body?;
    if source == InvocationSource::LiveInitialQuery {
        body.as_object()?.get("input")
    } else {
        Some(body)
    }
}

fn invocation_wire_authority(
    source: InvocationSource,
    authority_value: Option<&Value>,
) -> WireAuthorityFields {
    let Some(value) = authority_value else {
        return WireAuthorityFields::default();
    };
    match source {
        InvocationSource::LiveInitialQuery
        | InvocationSource::LiveResume
        | InvocationSource::LiveUnsubscribe => WireAuthorityFields::inspect_live_owner(value),
        InvocationSource::EphemeralRegister
        | InvocationSource::EphemeralPublish
        | InvocationSource::EphemeralSubscribe
        | InvocationSource::EphemeralDelete => WireAuthorityFields::inspect_ephemeral(value),
        _ => WireAuthorityFields::inspect_handler(value),
    }
}

fn dev_body_authority(value: Option<&Value>) -> ResolvedAppAuthority {
    let auth = value
        .and_then(Value::as_object)
        .and_then(|object| object.get("auth"))
        .cloned()
        .and_then(|auth| serde_json::from_value::<AuthInput>(auth).ok())
        .unwrap_or_default();
    ResolvedAppAuthority::dev_from_auth(&auth)
}

fn dev_host_operation_authority(value: Option<&Value>) -> ResolvedAppAuthority {
    value
        .and_then(Value::as_object)
        .and_then(|object| object.get("userId").or_else(|| object.get("user_id")))
        .and_then(Value::as_str)
        .map_or(ResolvedAppAuthority::Anonymous, |user_id| {
            ResolvedAppAuthority::DevImpersonation {
                user_id: user_id.to_owned(),
                roles: Vec::new(),
                local_dev_only: true,
            }
        })
}

fn queued_replay_requested(source: InvocationSource, body: Option<&Value>) -> bool {
    match source {
        InvocationSource::StandaloneAcknowledgement => true,
        InvocationSource::HttpMutation => body.and_then(Value::as_object).is_some_and(|object| {
            object.contains_key("clientMutationId")
                || object.contains_key("client_mutation_id")
                || object.contains_key("acknowledgedClientMutationIds")
                || object.contains_key("acknowledged_client_mutation_ids")
        }),
        _ => false,
    }
}

async fn prepare_registered_route_authority(
    source: Option<InvocationSource>,
    effective: EffectiveRoutePolicy,
    runtime: &AppState,
    admission: Option<&AdmissionLease>,
    headers: &HeaderMap,
    body: Option<&Value>,
) -> Result<Option<PreparedAuthority>, ApiError> {
    let Some(source) = source else {
        return Ok(None);
    };
    let Some(admission) = admission else {
        debug_assert_eq!(source, InvocationSource::BootstrapHandshake);
        return Ok(None);
    };
    let handler_value = invocation_authority_value(source, body);
    let wire = invocation_wire_authority(source, handler_value);
    let mode_state = runtime.auth_mode_state();
    let active_mode = mode_state.active;
    if active_mode == crate::manifest::AuthMode::Sessions && queued_replay_requested(source, body) {
        let offered = AuthClientProtocolOffers::from_headers(headers).authority_descriptor;
        if !runtime.auth_program_readiness().authority_descriptor
            || offered != Some(AUTH_PROTOCOL_V1)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "queued replay is not available for this request",
            )
            .with_details(json!({ "capability": "queuedReplay" }))
            .into());
        }
    }
    let resolved = match active_mode {
        crate::manifest::AuthMode::Dev => {
            if source == InvocationSource::BootstrapHandshake
                && headers.contains_key(header::AUTHORIZATION)
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_REQUIRED",
                    "auth",
                    "session credentials are unavailable while auth mode is dev",
                )
                .into());
            }
            if matches!(
                source,
                InvocationSource::HostOperationFunctionRun
                    | InvocationSource::HostOperationMutationDryRun
            ) {
                dev_host_operation_authority(handler_value)
            } else if effective.invocation_authority == InvocationAuthority::ClientAsserted
                || source == InvocationSource::DirectAdminRunner
            {
                dev_body_authority(handler_value)
            } else {
                ResolvedAppAuthority::Anonymous
            }
        }
        crate::manifest::AuthMode::Sessions => {
            if matches!(
                source,
                InvocationSource::DirectAdminRunner
                    | InvocationSource::HostOperationFunctionRun
                    | InvocationSource::HostOperationMutationDryRun
            ) {
                ResolvedAppAuthority::AdminBypass {
                    reason: "administrative application invocation".to_owned(),
                }
            } else if effective.credential_resolution == CredentialResolution::OptionalSessionBearer
                && headers.contains_key(header::AUTHORIZATION)
            {
                // Invalid and duplicate Authorization values remain
                // presented-invalid credentials; they never fall through to
                // anonymous authority.
                let bearer = auth_bearer(headers).unwrap_or_default().to_owned();
                let provider = installed_auth_provider(runtime)?;
                let provider_admission = provider.admit().await;
                let route_admission = admission.clone();
                let now_ms = provider.now_ms();
                let session = with_snapback(&runtime.snapback, move |snapback| {
                    let _effect = route_admission
                        .effect_guard("bootstrap session resolution")
                        .map_err(ProviderError::from)?;
                    provider_admission.resolve_session(
                        snapback.auth_database_mut(),
                        bearer.as_str(),
                        now_ms,
                    )
                })
                .await
                .map_err(map_provider_error)?;
                ResolvedAppAuthority::from_session(session)
            } else {
                ResolvedAppAuthority::Anonymous
            }
        }
    };
    InvocationGate::prepare_admitted_authority(
        source,
        active_mode,
        runtime.server.profile,
        admission.clone(),
        &wire,
        resolved,
    )
    .map(Some)
    .map_err(ApiError::from)
}

fn deferred_secret_read_scope(
    spec: RouteSpec,
    request_path: &str,
    body: Option<&Value>,
) -> Option<SecretReadScope> {
    match spec.effect_policy {
        EffectPolicy::FunctionKind => request_path
            .strip_prefix("/_snapback/api/functions/")
            .and_then(|path| path.strip_suffix("/run"))
            .map(|name| SecretReadScope::FunctionRun(name.to_owned())),
        EffectPolicy::OperationSpecific if spec.path == "/_snapback/api/host-ops" => {
            let fields = body?.as_object()?;
            let operation = fields.get("operation")?.as_str()?;
            let function = fields.get("function")?.as_str()?.to_owned();
            match operation {
                "function.run" => Some(SecretReadScope::FunctionRun(function)),
                "function.explain" => Some(SecretReadScope::FunctionExplain(function)),
                _ => None,
            }
        }
        _ => None,
    }
}

fn route_uses_managed_admission(spec: RouteSpec) -> bool {
    (spec.class == RouteClass::AppData && !matches!(spec.path, "/" | "/health" | "/app/ensure"))
        || matches!(
            spec.path,
            "/_snapback/api/functions/{name}/run"
                | "/_snapback/api/host-ops"
                | "/_snapback/api/auth/mailbox"
                | "/_snapback/api/admin-secret-read/mint"
        )
}

fn acquire_registered_route_admission(
    spec: RouteSpec,
    runtime: &AppState,
) -> Result<Option<AdmissionLease>, ApiError> {
    if !route_uses_managed_admission(spec) {
        return Ok(None);
    }
    let controller = runtime.auth_admission_controller();
    let snapshot = controller.diagnostic_snapshot();
    // The handshake is the diagnostic exception: it remains available while
    // the current epoch is closing or a committed mode is pending, and merely
    // reports the durable/controller snapshot without manufacturing a root.
    if spec.path == "/auth/session" && !snapshot.accepting {
        return Ok(None);
    }
    controller
        .admit_for_mode(runtime.auth_mode_state().active)
        .map(Some)
        .map_err(ApiError::from)
}

fn finish_registered_response(
    effective: EffectiveRoutePolicy,
    response: Response,
    admission: Option<&AdmissionLease>,
    authority: Option<&PreparedAuthority>,
) -> Response {
    let mut response = if let Some(admission) = admission {
        match admission.effect_guard("HTTP response publication") {
            Ok(publication) => {
                let response = apply_registered_response_controls(effective, response);
                drop(publication);
                response
            }
            Err(error) => {
                apply_registered_response_controls(effective, ApiError::from(error).into_response())
            }
        }
    } else {
        apply_registered_response_controls(effective, response)
    };
    if let Some(admission) = admission {
        // Clones share one root token, so retaining both the bare route lease
        // and any prepared authority does not inflate the in-flight count.
        response.extensions_mut().insert(admission.clone());
    }
    if let Some(authority) = authority {
        response.extensions_mut().insert(authority.clone());
    }
    if let Some(admission) = admission {
        let (parts, body) = response.into_parts();
        let body = Body::new(RetainedAdmissionBody {
            inner: body,
            _admission: admission.clone(),
            _authority: authority.cloned(),
        });
        Response::from_parts(parts, body)
    } else {
        response
    }
}

/// Response extensions may be discarded after the headers are encoded. Keep
/// the counted root (and exact authority when present) inside the body itself
/// so transition quiescence covers every frame through end/error/drop.
struct RetainedAdmissionBody {
    inner: Body,
    _admission: AdmissionLease,
    _authority: Option<PreparedAuthority>,
}

impl HttpBody for RetainedAdmissionBody {
    type Data = Bytes;
    type Error = axum::Error;

    fn poll_frame(
        self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Result<http_body::Frame<Self::Data>, Self::Error>>> {
        let this = self.get_mut();
        let Ok(publication) = this
            ._admission
            .effect_guard("HTTP response body frame publication")
        else {
            return std::task::Poll::Ready(None);
        };
        let frame = std::pin::Pin::new(&mut this.inner).poll_frame(context);
        drop(publication);
        frame
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> http_body::SizeHint {
        self.inner.size_hint()
    }
}

async fn enforce_registered_route_policy(
    spec: RouteSpec,
    runtime: AppState,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let policy_mode = runtime.active_policy_auth_mode();
    let effective = spec.effective_for(policy_mode);
    if request.method() == Method::OPTIONS {
        request.extensions_mut().insert(spec);
        request.extensions_mut().insert(effective);
        return apply_registered_response_controls(effective, next.run(request).await);
    }
    if let Some(error) = auth_app_data_refusal(spec, &runtime) {
        return apply_registered_response_controls(
            effective,
            ApiError::from(error).into_response(),
        );
    }
    if let Some(error) = session_online_protocol_refusal(spec, &runtime, request.headers()) {
        return apply_registered_response_controls(
            effective,
            ApiError::from(error).into_response(),
        );
    }
    // Provider paths are intentionally absent in active dev mode. Perform
    // this refusal before credential or body handling so a disabled provider
    // cannot become an oracle for bearer/body shape. `/auth/session`, added by
    // item 4, is the sole bootstrap-handshake exception.
    if policy_mode == PolicyAuthMode::Dev
        && spec.path.starts_with("/auth/")
        && spec.path != "/auth/session"
    {
        return apply_registered_response_controls(
            effective,
            ApiError::from(SnapbackError::error(
                "SNAPBACK_AUTH_MODE_DEV",
                "auth",
                "the session provider is unavailable while auth mode is dev",
            ))
            .into_response(),
        );
    }
    let route_admission = match acquire_registered_route_admission(spec, &runtime) {
        Ok(admission) => admission,
        Err(error) => {
            return apply_registered_response_controls(effective, error.into_response());
        }
    };
    // @ref LLP 0031#enforcement — authenticate every connection carrier
    // before bounded JSON inspection. Body-carried connection ids get a
    // second exact id↔bearer check after decoding; an attacker-controlled
    // body never gets parsed merely to discover which bearer it claims.
    let mut presented_connection_token = None;
    if effective.path_policy == RoutePolicy::ConnectionAuth {
        let presented = connection_token_for_request(effective, &request);
        let verified = match route_admission
            .as_ref()
            .expect("connection-auth app routes are managed")
            .effect_guard("connection bearer verification")
        {
            Ok(_effect) => match connection_id_from_request_path(request.uri().path()) {
                Some(connection_id) => runtime
                    .connections
                    .verify(connection_id, presented.as_deref()),
                None => runtime
                    .connections
                    .verify_presented_bearer(presented.as_deref()),
            },
            Err(error) => Err(ApiError::from(error)),
        };
        if let Err(error) = verified {
            return finish_registered_response(
                effective,
                error.into_response(),
                route_admission.as_ref(),
                None,
            );
        }
        presented_connection_token = presented;
    }

    let operation_deferred = matches!(
        effective.effect_policy,
        EffectPolicy::FunctionKind | EffectPolicy::OperationSpecific
    );
    // @ref LLP 0031#enforcement — the direct runner and host-ops multiplexer
    // must authenticate an authority that could satisfy one of their branches
    // before parsing the branch selector or looking up a function kind. The
    // public app.ensure attestation/provisioning multiplexer is intentionally
    // excluded and retains its operation-local posture gate below.
    if operation_deferred
        && matches!(
            spec.path,
            "/_snapback/api/functions/{name}/run" | "/_snapback/api/host-ops"
        )
    {
        let coarse_authorization = match policy_mode {
            PolicyAuthMode::Dev => crate::admin::authorize_for_mode(
                &runtime.server,
                request.headers(),
                false,
                PolicyAuthMode::Dev,
            ),
            PolicyAuthMode::Sessions => {
                let admin = crate::admin::authorize_for_mode(
                    &runtime.server,
                    request.headers(),
                    true,
                    PolicyAuthMode::Sessions,
                );
                if admin.is_ok()
                    || authorize_secret_read(&runtime.secret_reads, request.headers()).is_ok()
                {
                    Ok(())
                } else {
                    // One stable outer denial avoids turning the preflight
                    // into an oracle for lease validity or operation kind.
                    admin
                }
            }
        };
        if let Err(error) = coarse_authorization {
            return finish_registered_response(
                effective,
                error.into_response(),
                route_admission.as_ref(),
                None,
            );
        }
    }

    let connection_id_in_body = effective.path_policy == RoutePolicy::ConnectionAuth
        && connection_id_from_request_path(request.uri().path()).is_none();
    let inspect_body = effective.legacy_body_policy == LegacyBodyPolicy::Rejected
        || connection_id_in_body
        || operation_deferred
        || registered_invocation_source(spec).is_some()
        || effective.effect_policy == EffectPolicy::SecretReadMintProof;
    let mut policy_body = None;
    if inspect_body {
        match peek_policy_json_body(request).await {
            Ok((rebuilt, body)) => {
                request = rebuilt;
                policy_body = body;
            }
            Err(error) => {
                return finish_registered_response(
                    effective,
                    error.into_response(),
                    route_admission.as_ref(),
                    None,
                );
            }
        }
    }
    if effective.legacy_body_policy == LegacyBodyPolicy::Rejected
        && let Some(field) = policy_body.as_ref().and_then(legacy_body_auth_field)
    {
        return finish_registered_response(
            effective,
            body_auth_unsupported(field).into_response(),
            route_admission.as_ref(),
            None,
        );
    }
    // A lease-only caller must prove the statically named function scope
    // before kind lookup. This makes an existing and an unknown function
    // indistinguishable to an under-scoped lease while preserving the normal
    // AdminWrite path for mutation/action callers.
    if operation_deferred
        && policy_mode == PolicyAuthMode::Sessions
        && crate::admin::authorize_for_mode(&runtime.server, request.headers(), true, policy_mode)
            .is_err()
        && let Some(scope) =
            deferred_secret_read_scope(spec, request.uri().path(), policy_body.as_ref())
        && let Err(error) = crate::admin::preflight_secret_read(
            &runtime.secret_reads,
            request.headers(),
            std::collections::BTreeSet::from([scope]),
        )
    {
        return finish_registered_response(
            effective,
            error.into_response(),
            route_admission.as_ref(),
            None,
        );
    }

    let mut selected_operation = None;
    let operation_authorization = if operation_deferred {
        match select_http_operation(spec, &runtime, request.uri().path(), policy_body.as_ref())
            .await
        {
            HttpOperationSelection::Selected(operation) => {
                let operation_policy = operation.effective_for(policy_mode);
                selected_operation = Some((operation, operation_policy));
                if operation_policy.legacy_body_policy == LegacyBodyPolicy::Rejected
                    && let Some(field) = policy_body.as_ref().and_then(legacy_body_auth_field)
                {
                    Err(body_auth_unsupported(field))
                } else if operation.transport == OperationTransport::EnsureApp {
                    authorize_ensure_posture(
                        operation,
                        policy_body.as_ref(),
                        runtime.policy_auth_posture(),
                    )
                    .and_then(|()| {
                        authorize_operation_spec(
                            &runtime.server,
                            request.headers(),
                            operation,
                            policy_mode,
                        )
                    })
                } else {
                    authorize_operation_path_spec_with_secret_reads(
                        &runtime.server,
                        request.headers(),
                        operation,
                        policy_mode,
                        &runtime.secret_reads,
                    )
                }
            }
            HttpOperationSelection::UnknownHost => {
                match crate::admin::authorize_for_mode(
                    &runtime.server,
                    request.headers(),
                    true,
                    policy_mode,
                ) {
                    Ok(()) => Err(SnapbackError::error(
                        "SNAPBACK_HOST_OP_UNKNOWN",
                        "host-ops",
                        "unknown or unregistered host operation",
                    )
                    .with_details(serde_json::json!({ "operation": "unrecognized" }))
                    .into()),
                    Err(error) => Err(error),
                }
            }
            // A malformed/partial operation body is still authenticated at
            // the strongest possible branch before the typed extractor emits
            // its shape diagnostic.
            HttpOperationSelection::Indeterminate => crate::admin::authorize_for_mode(
                &runtime.server,
                request.headers(),
                true,
                policy_mode,
            ),
        }
    } else {
        Ok(())
    };
    let selected_policy = selected_operation
        .map(|(_, operation_policy)| operation_policy)
        .unwrap_or(effective);
    let response_policy = if selected_operation.is_some()
        && !matches!(
            effective.response_sensitivity,
            ResponseSensitivity::StaticPublic | ResponseSensitivity::PublicProjection
        ) {
        EffectiveRoutePolicy {
            response_sensitivity: effective.response_sensitivity,
            ..selected_policy
        }
    } else {
        selected_policy
    };
    let authorization = if selected_policy.effect_policy == EffectPolicy::Unavailable {
        Err(SnapbackError::error(
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
            "auth",
            "this operation is unavailable under the active auth policy",
        )
        .into())
    } else if operation_deferred {
        operation_authorization
    } else {
        match effective.path_policy {
            RoutePolicy::AdminRead => crate::admin::authorize_for_mode(
                &runtime.server,
                request.headers(),
                false,
                policy_mode,
            ),
            RoutePolicy::AdminWrite => crate::admin::authorize_for_mode(
                &runtime.server,
                request.headers(),
                true,
                policy_mode,
            ),
            RoutePolicy::AdminSecretRead => {
                authorize_secret_read(&runtime.secret_reads, request.headers())
            }
            RoutePolicy::SessionAuth => Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "session policy cannot become active before staged auth-mode enforcement lands",
            )
            .into()),
            RoutePolicy::Public | RoutePolicy::AppAuth | RoutePolicy::ConnectionAuth => Ok(()),
        }
    };
    if let Err(error) = authorization {
        return finish_registered_response(
            response_policy,
            error.into_response(),
            route_admission.as_ref(),
            None,
        );
    }
    if selected_policy.effect_policy == EffectPolicy::ImpersonationCapability {
        if !runtime.server.profile.allows_provisioning() {
            let diagnostic = crate::admin::operation_profile_diagnostic(
                runtime.server.profile,
                "auth impersonation",
                crate::admin::OperationProfileRequirement::NonProd,
            )
            .expect("prod is the only profile that forbids impersonation");
            return finish_registered_response(
                response_policy,
                ApiError::from(SnapbackError::new(diagnostic)).into_response(),
                route_admission.as_ref(),
                None,
            );
        }
        let verified = runtime
            .impersonation_capabilities
            .as_ref()
            .ok_or_else(crate::admin_impersonation::impersonation_required)
            .and_then(|registry| {
                let _effect = route_admission
                    .as_ref()
                    .expect("impersonation app routes are managed")
                    .effect_guard("impersonation capability claim")?;
                registry.authorize(single_header_value(
                    request.headers(),
                    crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER,
                ))
            });
        match verified {
            Ok(verified) => {
                request.extensions_mut().insert(verified);
            }
            Err(error) => {
                return finish_registered_response(
                    response_policy,
                    ApiError::from(error).into_response(),
                    route_admission.as_ref(),
                    None,
                );
            }
        }
    }
    if selected_policy.effect_policy == EffectPolicy::SecretReadMintProof {
        let Some(bridge) = runtime.secret_read_mint.as_ref() else {
            return finish_registered_response(
                response_policy,
                ApiError::from(crate::admin_secret_read::mint_proof_required()).into_response(),
                route_admission.as_ref(),
                None,
            );
        };
        let envelope = policy_body
            .as_ref()
            .cloned()
            .ok_or_else(crate::admin_secret_read::mint_proof_invalid)
            .and_then(|body| {
                serde_json::from_value::<SecretReadMintEnvelope>(body)
                    .map_err(|_| crate::admin_secret_read::mint_proof_invalid())
            });
        let verified = match envelope.and_then(|envelope| {
            let _effect = route_admission
                .as_ref()
                .expect("secret-read mint app routes are managed")
                .effect_guard("secret-read mint proof claim")?;
            bridge.verify_and_claim(&envelope)
        }) {
            Ok(verified) => verified,
            Err(error) => {
                return finish_registered_response(
                    response_policy,
                    ApiError::from(error).into_response(),
                    route_admission.as_ref(),
                    None,
                );
            }
        };
        request.extensions_mut().insert(verified);
    }
    if effective.path_policy == RoutePolicy::ConnectionAuth {
        let body_connection_id = policy_body
            .as_ref()
            .and_then(Value::as_object)
            .and_then(|body| {
                body.get("connection_id")
                    .or_else(|| body.get("connectionId"))
            })
            .and_then(Value::as_str);
        let verified = match body_connection_id {
            Some(connection_id) if connection_id_in_body => match route_admission
                .as_ref()
                .expect("connection-auth app routes are managed")
                .effect_guard("body-carried connection verification")
            {
                Ok(_effect) => runtime
                    .connections
                    .verify(connection_id, presented_connection_token.as_deref()),
                Err(error) => Err(ApiError::from(error)),
            },
            // Invalid JSON/missing fields are left to the closed typed
            // extractor, after the presented bearer was authenticated above.
            _ => Ok(()),
        };
        if let Err(error) = verified {
            return finish_registered_response(
                response_policy,
                error.into_response(),
                route_admission.as_ref(),
                None,
            );
        }
    }
    let invocation_source =
        selected_invocation_source(spec, selected_operation.map(|(operation, _)| operation));
    let prepared_authority = match prepare_registered_route_authority(
        invocation_source,
        selected_policy,
        &runtime,
        route_admission.as_ref(),
        request.headers(),
        policy_body.as_ref(),
    )
    .await
    {
        Ok(authority) => authority,
        Err(error) => {
            return finish_registered_response(
                response_policy,
                error.into_response(),
                route_admission.as_ref(),
                None,
            );
        }
    };
    if let Some(authority) = prepared_authority.as_ref() {
        request.extensions_mut().insert(authority.clone());
    }
    if let Some(admission) = route_admission.as_ref() {
        request.extensions_mut().insert(admission.clone());
    }
    request.extensions_mut().insert(spec);
    if let Some((operation, operation_policy)) = selected_operation {
        request.extensions_mut().insert(operation);
        request.extensions_mut().insert(operation_policy);
    } else {
        request.extensions_mut().insert(effective);
    }
    finish_registered_response(
        response_policy,
        next.run(request).await,
        route_admission.as_ref(),
        prepared_authority.as_ref(),
    )
}

const AUTH_REQUEST_BODY_LIMIT: usize = 4 * 1024;

fn auth_request_invalid() -> ApiError {
    SnapbackError::error(
        "SNAPBACK_AUTH_REQUEST_INVALID",
        "auth",
        "authentication request is invalid",
    )
    .into()
}

fn auth_provider_unavailable() -> ApiError {
    auth_provider_unavailable_error().into()
}

fn auth_provider_unavailable_error() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
        "auth",
        "authentication provider is unavailable",
    )
}

fn map_provider_error(error: ProviderError) -> ApiError {
    error.into_snapback_error().into()
}

fn installed_auth_provider(runtime: &AppState) -> Result<Arc<AuthProvider>, ApiError> {
    runtime
        .auth_provider
        .clone()
        .ok_or_else(auth_provider_unavailable)
}

/// Public bootstrap discovery. It accepts no body or query and echoes only
/// exact supported protocol offers; every presented session credential is
/// still validated on this request.
///
/// @ref LLP 0055#exact-response-dto — this handler publishes the closed v1
/// response authority and never includes bearer or provider internals.
async fn auth_session(
    State(runtime): State<AppState>,
    authority: Option<Extension<PreparedAuthority>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let body = body.map_err(|_| auth_request_invalid())?;
    if uri.query().is_some() || !body.is_empty() {
        return Err(auth_request_invalid());
    }
    let offers = AuthClientProtocolOffers::from_headers(&headers);
    let state = runtime.auth_mode_state();
    let projection = match authority {
        Some(Extension(authority)) => authority.projection().clone(),
        None => {
            // A closed admission epoch is the handshake's diagnostic-only
            // path. Resolve a presented bearer against the still-active
            // durable mode, but do not manufacture managed invocation
            // authority while ordinary app admission is suspended.
            let resolved = match state.active {
                AuthMode::Dev => {
                    if headers.contains_key(header::AUTHORIZATION) {
                        return Err(SnapbackError::error(
                            "SNAPBACK_AUTH_REQUIRED",
                            "auth",
                            "session credentials are unavailable while auth mode is dev",
                        )
                        .into());
                    }
                    ResolvedAppAuthority::Anonymous
                }
                AuthMode::Sessions => {
                    if headers.contains_key(header::AUTHORIZATION) {
                        let bearer = auth_bearer(&headers).unwrap_or_default().to_owned();
                        let provider = installed_auth_provider(&runtime)?;
                        let admission = provider.admit().await;
                        let now_ms = provider.now_ms();
                        let session = with_snapback(&runtime.snapback, move |snapback| {
                            admission.resolve_session(snapback.auth_database_mut(), &bearer, now_ms)
                        })
                        .await
                        .map_err(map_provider_error)?;
                        ResolvedAppAuthority::from_session(session)
                    } else {
                        ResolvedAppAuthority::Anonymous
                    }
                }
            };
            HandlerAuthProjection::from_authority(&resolved)
        }
    };
    let provider_ready = runtime.auth_catalog_ready
        && runtime
            .auth_provider
            .as_ref()
            .is_some_and(|provider| provider.readiness() == AuthProviderReadiness::Available);
    let response = AuthSessionResponse::from_facts(
        AuthSessionFacts {
            server_startup_nonce: runtime.server_startup_nonce().to_owned(),
            transition_generation: state.transition_generation,
            active_mode: state.active,
            desired_mode: state.desired,
            mode_state: state.mode_state,
            app_data_availability: state.app_data_availability,
            quarantine_code: state
                .quarantine
                .as_ref()
                .map(|quarantine| quarantine.code.clone()),
            readiness: runtime.auth_program_readiness().clone(),
            provider_key: "email-code".to_owned(),
            provider_ready,
            authority: AuthSessionAuthority {
                user_id: projection.user_id().map(str::to_owned),
                session_id: projection.session_id().map(str::to_owned),
                is_authenticated: projection.is_authenticated(),
            },
        },
        offers,
    );
    Ok(Json(response))
}

fn installed_auth_coordinator(runtime: &AppState) -> Result<Arc<AuthCoordinator>, ApiError> {
    runtime.auth_coordinator.clone().ok_or_else(|| {
        ApiError::from(SnapbackError::error(
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "auth",
            "authentication projection is unavailable",
        ))
    })
}

async fn coordinated_mint_session(
    runtime: &AppState,
    provider: &Arc<AuthProvider>,
    mut admission: AddressAdmission,
    route_admission: &AdmissionLease,
) -> Result<CredentialIssue, SnapbackError> {
    let coordinator = runtime.auth_coordinator.clone().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "auth",
            "authentication projection is unavailable",
        )
    })?;
    for _ in 0..crate::auth::provider::AUTH_MAX_COLLISION_ATTEMPTS {
        let now_ms = provider.now_ms();
        let (returned_admission, plan) = with_snapback(&runtime.snapback, move |snapback| {
            let plan = admission.plan_mint_session(snapback.auth_database_mut(), now_ms);
            (admission, plan)
        })
        .await;
        admission = returned_admission;
        let plan = plan.map_err(ProviderError::into_snapback_error)?;
        let carrier = coordinator.premark_issuance(plan)?;
        let commit_plan = carrier.plan().commit_plan();
        let effect_admission = route_admission.clone();
        let (returned_admission, attempt) = with_snapback(&runtime.snapback, move |snapback| {
            let attempt = match effect_admission.effect_guard("auth mint-session transaction") {
                Ok(_effect) => {
                    admission.commit_planned_issuance(snapback.auth_database_mut(), &commit_plan)
                }
                Err(error) => AuthTransactionAttempt::RolledBack(error),
            };
            (admission, attempt)
        })
        .await;
        admission = returned_admission;
        match coordinator.finish_issuance(
            carrier,
            attempt,
            provider.now_ms(),
            provider.monotonic_now(),
        )? {
            IssuanceFinish::Committed(issue) => return Ok(issue),
            IssuanceFinish::CodeInvalid | IssuanceFinish::CodeLocked => {
                return Err(auth_provider_unavailable_error());
            }
            IssuanceFinish::PredecessorChanged => continue,
        }
    }
    Err(auth_provider_unavailable_error())
}

async fn coordinated_exchange_session(
    runtime: &AppState,
    provider: &Arc<AuthProvider>,
    mut exchange: ExchangeAdmission,
    code: String,
    route_admission: &AdmissionLease,
) -> Result<CredentialIssue, ProviderError> {
    let coordinator = runtime.auth_coordinator.clone().ok_or_else(|| {
        ProviderError::from(SnapbackError::error(
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "auth",
            "authentication projection is unavailable",
        ))
    })?;
    for _ in 0..crate::auth::provider::AUTH_MAX_COLLISION_ATTEMPTS {
        let plan_code = code.clone();
        let now_ms = provider.now_ms();
        let (returned_exchange, planned) = with_snapback(&runtime.snapback, move |snapback| {
            let planned = exchange.plan_exchange(snapback.auth_database_mut(), &plan_code, now_ms);
            (exchange, planned)
        })
        .await;
        exchange = returned_exchange;
        match planned? {
            PlannedExchange::Reject => {
                let commit_code = code.clone();
                let effect_admission = route_admission.clone();
                let (returned_exchange, outcome) =
                    with_snapback(&runtime.snapback, move |snapback| {
                        let outcome = match effect_admission
                            .effect_guard("auth exchange rejection transaction")
                        {
                            Ok(_effect) => exchange.commit_planned_rejection(
                                snapback.auth_database_mut(),
                                &commit_code,
                                now_ms,
                            ),
                            Err(error) => Err(ProviderError::from(error)),
                        };
                        (exchange, outcome)
                    })
                    .await;
                exchange = returned_exchange;
                let _ = outcome?;
                continue;
            }
            PlannedExchange::Issue(plan) => {
                let commit_code = code.clone();
                let carrier = coordinator
                    .premark_issuance(plan)
                    .map_err(ProviderError::from)?;
                let commit_plan = carrier.plan().commit_plan();
                let effect_admission = route_admission.clone();
                let (returned_exchange, attempt) =
                    with_snapback(&runtime.snapback, move |snapback| {
                        let attempt = match effect_admission
                            .effect_guard("auth exchange issuance transaction")
                        {
                            Ok(_effect) => exchange.commit_planned_issuance(
                                snapback.auth_database_mut(),
                                &commit_plan,
                                &commit_code,
                            ),
                            Err(error) => AuthTransactionAttempt::RolledBack(error),
                        };
                        (exchange, attempt)
                    })
                    .await;
                exchange = returned_exchange;
                match coordinator
                    .finish_issuance(
                        carrier,
                        attempt,
                        provider.now_ms(),
                        provider.monotonic_now(),
                    )
                    .map_err(ProviderError::from)?
                {
                    IssuanceFinish::Committed(issue) => {
                        exchange.finish_exchange_cleanup();
                        return Ok(issue);
                    }
                    IssuanceFinish::CodeInvalid => {
                        return Err(crate::auth::provider::code_invalid());
                    }
                    IssuanceFinish::CodeLocked => {
                        return Err(crate::auth::provider::code_locked());
                    }
                    IssuanceFinish::PredecessorChanged => continue,
                }
            }
        }
    }
    Err(ProviderError::from(auth_provider_unavailable_error()))
}

/// The provider protocol accepts exactly one `Authorization: Bearer …`
/// header. Axum's ordinary `HeaderMap::get` would silently select one value
/// from a duplicate header set, so keep the cardinality check explicit.
fn auth_bearer(headers: &HeaderMap) -> Option<&str> {
    let value = single_header_value(headers, header::AUTHORIZATION.as_str())?;
    let bearer = value.strip_prefix("Bearer ")?;
    (!bearer.is_empty() && bearer.trim() == bearer && !bearer.chars().any(char::is_whitespace))
        .then_some(bearer)
}

/// Parse one exact provider DTO without leaking parser details. The raw-byte
/// bound is checked before serde, and deserializing the original bytes keeps
/// duplicate-field rejection observable by the typed visitor.
///
/// @ref LLP 0054#routes-operations-and-dtos — provider requests are closed,
/// camelCase DTOs with a 4 KiB request-body ceiling.
fn parse_auth_json<T: serde::de::DeserializeOwned>(
    headers: &HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<T, ApiError> {
    let body = body.map_err(|_| auth_request_invalid())?;
    if body.is_empty() || body.len() > AUTH_REQUEST_BODY_LIMIT {
        return Err(auth_request_invalid());
    }
    let is_json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
    if !is_json {
        return Err(auth_request_invalid());
    }
    serde_json::from_slice(&body).map_err(|_| auth_request_invalid())
}

/// Request-code admission (maintenance + address stripe) is acquired before
/// entering the outer app-instance lock and moved into the blocking closure.
///
/// @ref LLP 0054#email-code-provider — challenge creation commits before the
/// capture response is published and never enters the app event stream.
async fn auth_request_code(
    State(runtime): State<AppState>,
    Extension(route_admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<RequestCodeResponse>, ApiError> {
    let provider = installed_auth_provider(&runtime)?;
    let request = parse_auth_json::<RequestCodeRequest>(&headers, body)?;
    let admission = provider
        .admit_email(&request.email)
        .await
        .map_err(map_provider_error)?;
    let now_ms = provider.now_ms();
    let response = with_snapback(&runtime.snapback, move |snapback| {
        let _effect = route_admission
            .effect_guard("auth request-code transaction")
            .map_err(ProviderError::from)?;
        admission.request_code(snapback.auth_database_mut(), now_ms)
    })
    .await
    .map_err(map_provider_error)?;
    Ok(Json(response))
}

/// Exchange uses the required two-pass choreography: a preliminary read under
/// shared maintenance, then the canonical-address stripe, then a fresh writer
/// transaction. Missing rows still take the uniform writer+HMAC path.
///
/// @ref LLP 0054#email-code-provider — preliminary lookup selects locks and
/// key material only; authorization comes from the rechecked transaction.
async fn auth_exchange(
    State(runtime): State<AppState>,
    Extension(route_admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<CredentialResponse>, ApiError> {
    let provider = installed_auth_provider(&runtime)?;
    let request = parse_auth_json::<ExchangeRequest>(&headers, body)?;
    let admission = provider.admit().await;
    let challenge_id = request.challenge_id;
    let preliminary_challenge_id = challenge_id.clone();
    let code = request.code;
    let coordination_admission = route_admission.clone();
    let (admission, coordination) = with_snapback(&runtime.snapback, move |snapback| {
        let _effect = match coordination_admission.effect_guard("auth exchange coordination read") {
            Ok(effect) => effect,
            Err(error) => return (admission, Err(ProviderError::from(error))),
        };
        let coordination = admission.exchange_coordination(
            snapback.auth_database_mut(),
            preliminary_challenge_id.as_str(),
        );
        (admission, coordination)
    })
    .await;
    let coordination = coordination.map_err(map_provider_error)?;
    let issue = match coordination {
        Some(coordination) => {
            let exchange = admission
                .for_exchange(coordination)
                .await
                .map_err(map_provider_error)?;
            coordinated_exchange_session(
                &runtime,
                &provider,
                exchange,
                code.as_str().to_owned(),
                &route_admission,
            )
            .await
        }
        None => {
            let now_ms = provider.now_ms();
            with_snapback(&runtime.snapback, move |snapback| {
                let _effect = route_admission
                    .effect_guard("unknown auth exchange transaction")
                    .map_err(ProviderError::from)?;
                admission.exchange_unknown(
                    snapback.auth_database_mut(),
                    challenge_id.as_str(),
                    code.as_str(),
                    now_ms,
                )
            })
            .await
        }
    }
    .map_err(map_provider_error)?;
    let (response, committed_revocation) = issue.into_parts();
    // Any cap eviction was finalized together with issuance before the
    // plaintext response reached this boundary.
    let _ = committed_revocation;
    Ok(Json(response))
}

/// Rotate one exact bearer after provider admission. Item 4 supplies the
/// central resolved-session authority gate; direct handler tests cover this
/// item-3 projection while that gate remains deliberately fenced.
///
/// @ref LLP 0054#rotation — refresh rotates the current token and publishes
/// the same closed credential response as exchange.
async fn auth_refresh(
    State(runtime): State<AppState>,
    Extension(route_admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<CredentialResponse>, ApiError> {
    let provider = installed_auth_provider(&runtime)?;
    let coordinator = installed_auth_coordinator(&runtime)?;
    let _: EmptyAuthRequest = parse_auth_json(&headers, body)?;
    let bearer = SecretInput::new(auth_bearer(&headers).unwrap_or_default().to_owned());
    for _ in 0..crate::auth::provider::AUTH_MAX_COLLISION_ATTEMPTS {
        let admission = provider.admit().await;
        let plan_bearer = bearer.as_str().to_owned();
        let now_ms = provider.now_ms();
        let (admission, planned) = with_snapback(&runtime.snapback, move |snapback| {
            let planned =
                admission.plan_refresh(snapback.auth_database_mut(), &plan_bearer, now_ms);
            (admission, planned)
        })
        .await;
        match planned.map_err(map_provider_error)? {
            PlannedRefresh::AuthRequired => {
                return Err(map_provider_error(provider_auth_required()));
            }
            PlannedRefresh::SessionExpired => {
                return Err(map_provider_error(provider_session_expired()));
            }
            PlannedRefresh::SupersededInsideGrace => {
                return Err(map_provider_error(provider_refresh_superseded()));
            }
            PlannedRefresh::Rotate(plan) => {
                let carrier = coordinator.premark_rotation(plan).map_err(ApiError::from)?;
                let commit_plan = carrier.plan().commit_plan();
                let effect_admission = route_admission.clone();
                let attempt = with_snapback(&runtime.snapback, move |snapback| {
                    match effect_admission.effect_guard("auth refresh rotation transaction") {
                        Ok(_effect) => admission
                            .commit_planned_rotation(snapback.auth_database_mut(), &commit_plan),
                        Err(error) => AuthTransactionAttempt::RolledBack(error),
                    }
                })
                .await;
                match coordinator
                    .finish_rotation(carrier, attempt)
                    .map_err(ApiError::from)?
                {
                    RotationFinish::Committed(issue) => {
                        let (response, committed_revocation) = issue.into_parts();
                        debug_assert!(committed_revocation.is_none());
                        return Ok(Json(response));
                    }
                    RotationFinish::PredecessorChanged => continue,
                }
            }
            PlannedRefresh::ReuseRevoke(plan) => {
                let carrier = coordinator
                    .premark_revocation(plan)
                    .map_err(ApiError::from)?;
                let commit_plan = carrier.plan().clone();
                let effect_admission = route_admission.clone();
                let attempt = with_snapback(&runtime.snapback, move |snapback| {
                    match effect_admission.effect_guard("auth refresh reuse transaction") {
                        Ok(_effect) => admission.commit_planned_revocation(
                            snapback.auth_database_mut(),
                            &commit_plan,
                            now_ms,
                        ),
                        Err(error) => AuthTransactionAttempt::RolledBack(error),
                    }
                })
                .await;
                match coordinator
                    .finish_revocation(carrier, attempt)
                    .map_err(ApiError::from)?
                {
                    RevocationFinish::Committed(_) | RevocationFinish::AlreadyTerminal { .. } => {
                        return Err(map_provider_error(provider_session_expired()));
                    }
                    RevocationFinish::PredecessorChanged => continue,
                }
            }
        }
    }
    Err(auth_provider_unavailable())
}

/// Revoke the family addressed by one exact current/in-grace bearer. The
/// response is intentionally empty; the committed revocation remains an
/// explicit item-5 projection seam.
///
/// @ref LLP 0054#session-and-token-family-protocol — logout succeeds with an
/// empty 204 response and never aliases a bearer through JSON or query input.
async fn auth_logout(
    State(runtime): State<AppState>,
    Extension(route_admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<StatusCode, ApiError> {
    let provider = installed_auth_provider(&runtime)?;
    let coordinator = installed_auth_coordinator(&runtime)?;
    let _: EmptyAuthRequest = parse_auth_json(&headers, body)?;
    let bearer = SecretInput::new(auth_bearer(&headers).unwrap_or_default().to_owned());
    for _ in 0..crate::auth::provider::AUTH_MAX_COLLISION_ATTEMPTS {
        let admission = provider.admit().await;
        let plan_bearer = bearer.as_str().to_owned();
        let now_ms = provider.now_ms();
        let (admission, planned) = with_snapback(&runtime.snapback, move |snapback| {
            let planned = admission.plan_logout(snapback.auth_database_mut(), &plan_bearer, now_ms);
            (admission, planned)
        })
        .await;
        let plan = match planned.map_err(map_provider_error)? {
            PlannedLogout::AuthRequired => {
                return Err(map_provider_error(provider_auth_required()));
            }
            PlannedLogout::SessionExpired => {
                return Err(map_provider_error(provider_session_expired()));
            }
            PlannedLogout::CredentialSuperseded => {
                return Err(map_provider_error(provider_credential_superseded()));
            }
            PlannedLogout::Revoke(plan) => plan,
        };
        let carrier = coordinator
            .premark_revocation(plan)
            .map_err(ApiError::from)?;
        let commit_plan = carrier.plan().clone();
        let effect_admission = route_admission.clone();
        let attempt = with_snapback(&runtime.snapback, move |snapback| {
            match effect_admission.effect_guard("auth logout transaction") {
                Ok(_effect) => admission.commit_planned_revocation(
                    snapback.auth_database_mut(),
                    &commit_plan,
                    now_ms,
                ),
                Err(error) => AuthTransactionAttempt::RolledBack(error),
            }
        })
        .await;
        match coordinator
            .finish_revocation(carrier, attempt)
            .map_err(ApiError::from)?
        {
            RevocationFinish::Committed(_) | RevocationFinish::AlreadyTerminal { .. } => {
                return Ok(StatusCode::NO_CONTENT);
            }
            RevocationFinish::PredecessorChanged => continue,
        }
    }
    Err(auth_provider_unavailable())
}

/// Opaque revoke-only alarm. Every bearer shape enters the provider's fixed
/// transaction and waits for its admission-selected publication deadline.
/// The optional revocation is internal and never influences the response.
///
/// @ref LLP 0054#logout-ordinary-supersession-and-family-alarm — malformed, unknown, current,
/// tombstone, and already-revoked bearers all publish the same delayed 202.
async fn auth_family_alarm(
    State(runtime): State<AppState>,
    Extension(route_admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<(StatusCode, Json<FamilyAlarmResponse>), ApiError> {
    let provider = installed_auth_provider(&runtime)?;
    let coordinator = installed_auth_coordinator(&runtime)?;
    let _: EmptyAuthRequest = parse_auth_json(&headers, body)?;
    let bearer = SecretInput::new(auth_bearer(&headers).unwrap_or_default().to_owned());
    let mut publish_not_before = provider.monotonic_now();
    let mut accepted = false;
    for _ in 0..crate::auth::provider::AUTH_MAX_COLLISION_ATTEMPTS {
        let admission = provider.admit().await;
        let plan_bearer = bearer.as_str().to_owned();
        let now_ms = provider.now_ms();
        let (admission, planned) = with_snapback(&runtime.snapback, move |snapback| {
            let planned =
                admission.plan_family_alarm(snapback.auth_database_mut(), &plan_bearer, now_ms);
            (admission, planned)
        })
        .await;
        let plan = planned.map_err(map_provider_error)?;
        publish_not_before = publish_not_before.max(plan.publish_not_before());
        let revocation = plan.revocation_plan();
        let commit_plan = plan.clone();
        match revocation {
            None => {
                let effect_admission = route_admission.clone();
                match with_snapback(&runtime.snapback, move |snapback| {
                    match effect_admission.effect_guard("auth family-alarm transaction") {
                        Ok(_effect) => admission.commit_planned_family_alarm(
                            snapback.auth_database_mut(),
                            &commit_plan,
                        ),
                        Err(error) => AuthTransactionAttempt::RolledBack(error),
                    }
                })
                .await
                {
                    AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Noop)
                    | AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Retry) => {
                        accepted = true;
                        break;
                    }
                    AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Revoked(_)) => {
                        return Err(ApiError::from(SnapbackError::error(
                            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                            "auth",
                            "dummy family alarm unexpectedly changed authority",
                        )));
                    }
                    AuthTransactionAttempt::RolledBack(error) => {
                        return Err(ApiError::from(error));
                    }
                    AuthTransactionAttempt::CommitUncertain(_) => {
                        return Err(ApiError::from(SnapbackError::error(
                            "SNAPBACK_AUTH_REVOCATION_UNCERTAIN",
                            "auth",
                            "family alarm commit could not be reconciled",
                        )));
                    }
                }
            }
            Some(revocation) => {
                let carrier = coordinator
                    .premark_revocation(revocation)
                    .map_err(ApiError::from)?;
                let effect_admission = route_admission.clone();
                let family_attempt = with_snapback(&runtime.snapback, move |snapback| {
                    match effect_admission.effect_guard("auth family-alarm revoke transaction") {
                        Ok(_effect) => admission.commit_planned_family_alarm(
                            snapback.auth_database_mut(),
                            &commit_plan,
                        ),
                        Err(error) => AuthTransactionAttempt::RolledBack(error),
                    }
                })
                .await;
                let attempt = match family_attempt {
                    AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Revoked(
                        revocation,
                    )) => AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(
                        revocation,
                    )),
                    AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Retry)
                    | AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Noop) => {
                        AuthTransactionAttempt::Committed(
                            PlannedRevocationCommit::PredecessorChanged,
                        )
                    }
                    AuthTransactionAttempt::RolledBack(error) => {
                        AuthTransactionAttempt::RolledBack(error)
                    }
                    AuthTransactionAttempt::CommitUncertain(error) => {
                        AuthTransactionAttempt::CommitUncertain(error)
                    }
                };
                match coordinator
                    .finish_revocation(carrier, attempt)
                    .map_err(ApiError::from)?
                {
                    RevocationFinish::Committed(_) | RevocationFinish::AlreadyTerminal { .. } => {
                        accepted = true;
                        break;
                    }
                    RevocationFinish::PredecessorChanged => continue,
                }
            }
        }
    }
    if !accepted {
        return Err(auth_provider_unavailable());
    }
    tokio::time::sleep_until(tokio::time::Instant::from_std(publish_not_before)).await;
    Ok((StatusCode::ACCEPTED, Json(FamilyAlarmResponse::default())))
}

/// Exact capture-mailbox projection. The handler requires the middleware-
/// installed proof as a structural backstop; the registered route is what
/// authenticates both independent authority axes before query parsing.
///
/// @ref LLP 0054#capture-mailbox — mailbox lookup performs shared
/// maintenance, peek, address-stripe acquisition, and an exact re-read.
async fn auth_mailbox(
    State(runtime): State<AppState>,
    Extension(route_admission): Extension<AdmissionLease>,
    Extension(_verified): Extension<crate::admin_impersonation::VerifiedImpersonationCapability>,
    query: Result<Query<MailboxQuery>, QueryRejection>,
) -> Result<Json<MailboxResponse>, ApiError> {
    let provider = installed_auth_provider(&runtime)?;
    let Query(query) = query.map_err(|_| auth_request_invalid())?;
    let response = provider
        .mailbox_entry(&query.challenge_id)
        .await
        .map_err(map_provider_error)?;
    route_admission.validate("auth mailbox response")?;
    Ok(Json(response))
}

pub(crate) fn router_from_registrations(
    registrations: Vec<RegisteredRoute>,
    runtime: AppState,
) -> Router<AppState> {
    registrations
        .into_iter()
        .fold(Router::new(), |router, registration| {
            let spec = registration.spec;
            let runtime = runtime.clone();
            let method_router = registration
                .method_router
                .options(|| async { StatusCode::NO_CONTENT })
                .route_layer(middleware::from_fn(
                    move |request: Request<Body>, next: Next| {
                        let runtime = runtime.clone();
                        async move {
                            enforce_registered_route_policy(spec, runtime, request, next).await
                        }
                    },
                ));
            router.route(spec.path, method_router)
        })
}

/// The full Snapback HTTP surface is installed only from registered entries;
/// there is no second route-literal list that can drift outside policy.
///
/// @ref LLP 0031#enforcement — router↔registry parity is structural.
pub fn app(state: AppState) -> Router {
    router_from_registrations(all_route_registrations(), state.clone())
        .with_state(state)
        .layer(middleware::from_fn(local_dev_cors))
}

/// The registry is the metadata projection of the exact entries `app()`
/// installs. Axum has no route-introspection API, so sharing registrations is
/// the mechanical parity guarantee.
///
/// @ref LLP 0031#enforcement — registry-driven enforcement; the classified unit is the operation.
pub fn route_registry() -> Vec<RouteSpec> {
    all_route_registrations()
        .into_iter()
        .map(|registration| registration.spec)
        .collect()
}

/// Transport for an authority-bearing operation multiplexed inside one HTTP
/// route. These entries close the gap a path-only router cannot see.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationTransport {
    EnsureApp,
    LiveSocket,
    DirectFunctionRunner,
    HostOps,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OperationSpec {
    pub operation: &'static str,
    pub parent_path: &'static str,
    pub transport: OperationTransport,
    pub class: RouteClass,
    pub path_policy: RoutePolicy,
    pub credential_resolution: CredentialResolution,
    pub invocation_authority: InvocationAuthority,
    pub legacy_body_policy: LegacyBodyPolicy,
    pub effect_policy: EffectPolicy,
    pub response_sensitivity: ResponseSensitivity,
    pub session_overlay: SessionModeOverlay,
}

impl OperationSpec {
    pub fn effective_for(self, mode: PolicyAuthMode) -> EffectiveRoutePolicy {
        RouteSpec {
            method: "OPERATION",
            path: self.parent_path,
            class: self.class,
            path_policy: self.path_policy,
            policy: self.path_policy,
            credential_resolution: self.credential_resolution,
            invocation_authority: self.invocation_authority,
            legacy_body_policy: self.legacy_body_policy,
            effect_policy: self.effect_policy,
            response_sensitivity: self.response_sensitivity,
            session_overlay: self.session_overlay,
        }
        .effective_for(mode)
    }

    pub fn validate(&self) -> Result<(), String> {
        RouteSpec {
            method: "OPERATION",
            path: self.parent_path,
            class: self.class,
            path_policy: self.path_policy,
            policy: self.path_policy,
            credential_resolution: self.credential_resolution,
            invocation_authority: self.invocation_authority,
            legacy_body_policy: self.legacy_body_policy,
            effect_policy: self.effect_policy,
            response_sensitivity: self.response_sensitivity,
            session_overlay: self.session_overlay,
        }
        .validate()
        .map_err(|error| format!("operation {}: {error}", self.operation))
    }
}

// Operation entries carry the same independent axes as HTTP entries plus
// their multiplexed transport identity. Spell every axis at the call site so
// a new branch cannot inherit an accidental default.
#[allow(clippy::too_many_arguments)]
const fn operation(
    operation: &'static str,
    parent_path: &'static str,
    transport: OperationTransport,
    class: RouteClass,
    path_policy: RoutePolicy,
    credential_resolution: CredentialResolution,
    invocation_authority: InvocationAuthority,
    legacy_body_policy: LegacyBodyPolicy,
    effect_policy: EffectPolicy,
    response_sensitivity: ResponseSensitivity,
    session_overlay: SessionModeOverlay,
) -> OperationSpec {
    OperationSpec {
        operation,
        parent_path,
        transport,
        class,
        path_policy,
        credential_resolution,
        invocation_authority,
        legacy_body_policy,
        effect_policy,
        response_sensitivity,
        session_overlay,
    }
}

/// Multiplexed operations whose authority cannot be represented by one HTTP
/// path row. Names are stable audit identifiers, not handler display strings.
///
/// @ref LLP 0031#enforcement — WebSocket kinds and dynamic admin operations
/// are classified explicitly rather than smuggled through a registered path.
pub fn operation_registry() -> Vec<OperationSpec> {
    use OperationTransport::{DirectFunctionRunner, EnsureApp, HostOps, LiveSocket};
    let live = |name| {
        operation(
            name,
            "/live/{connection_id}/stream",
            LiveSocket,
            RouteClass::AppData,
            RoutePolicy::ConnectionAuth,
            CredentialResolution::BoundConnectionGrant,
            InvocationAuthority::ClientAsserted,
            LegacyBodyPolicy::Allowed,
            EffectPolicy::None,
            ResponseSensitivity::ApplicationData,
            SessionModeOverlay::connection_bound(),
        )
    };
    let direct = |name, path_policy, effect_policy, session_overlay| {
        operation(
            name,
            "/_snapback/api/functions/{name}/run",
            DirectFunctionRunner,
            RouteClass::SystemApi,
            path_policy,
            CredentialResolution::AdminCredential,
            InvocationAuthority::ClientAsserted,
            LegacyBodyPolicy::Allowed,
            effect_policy,
            ResponseSensitivity::SensitiveApplicationData,
            session_overlay,
        )
    };
    let host = |name, path_policy, effect_policy, session_overlay| {
        operation(
            name,
            "/_snapback/api/host-ops",
            HostOps,
            RouteClass::SystemApi,
            path_policy,
            CredentialResolution::AdminCredential,
            // The admin credential authorizes the transport; ordinary host
            // operations do not install an app caller. Identity selection is
            // represented only by the explicit DevImpersonation branches.
            InvocationAuthority::None,
            LegacyBodyPolicy::NotApplicable,
            effect_policy,
            ResponseSensitivity::SensitiveApplicationData,
            session_overlay,
        )
    };
    let operations = vec![
        operation(
            "app.ensure.legacy",
            "/app/ensure",
            EnsureApp,
            RouteClass::AppData,
            RoutePolicy::Public,
            CredentialResolution::OperationSpecific,
            InvocationAuthority::None,
            LegacyBodyPolicy::NotApplicable,
            EffectPolicy::Provisioning,
            ResponseSensitivity::PublicProjection,
            SessionModeOverlay {
                path_policy: None,
                credential_resolution: None,
                invocation_authority: None,
                legacy_body_policy: None,
                effect_policy: Some(EffectPolicy::Unavailable),
                response_sensitivity: None,
            },
        ),
        operation(
            "app.ensure.attest",
            "/app/ensure",
            EnsureApp,
            RouteClass::AppData,
            RoutePolicy::Public,
            CredentialResolution::None,
            InvocationAuthority::None,
            LegacyBodyPolicy::NotApplicable,
            EffectPolicy::None,
            ResponseSensitivity::PublicProjection,
            SessionModeOverlay::NONE,
        ),
        operation(
            "app.ensure.provision",
            "/app/ensure",
            EnsureApp,
            RouteClass::AppData,
            RoutePolicy::AdminWrite,
            CredentialResolution::AdminCredential,
            InvocationAuthority::Operator,
            LegacyBodyPolicy::NotApplicable,
            EffectPolicy::Provisioning,
            ResponseSensitivity::OperatorMetadata,
            SessionModeOverlay::NONE,
        ),
        live("ephemeral_subscribe"),
        live("ephemeral_publish"),
        live("ephemeral_delete"),
        live("ephemeral_unsubscribe"),
        operation(
            "live_ping",
            "/live/{connection_id}/stream",
            LiveSocket,
            RouteClass::AppData,
            RoutePolicy::ConnectionAuth,
            CredentialResolution::BoundConnectionGrant,
            InvocationAuthority::None,
            LegacyBodyPolicy::NotApplicable,
            EffectPolicy::None,
            ResponseSensitivity::PublicProjection,
            SessionModeOverlay {
                path_policy: None,
                credential_resolution: None,
                invocation_authority: Some(InvocationAuthority::ConnectionBound),
                // The typed ping has no identity field, but serde otherwise
                // ignores unknown siblings. Sessions therefore records an
                // explicit rejection policy and the raw-frame gate enforces it.
                legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
                effect_policy: None,
                response_sensitivity: None,
            },
        ),
        direct(
            "direct_runner.query",
            RoutePolicy::AdminRead,
            EffectPolicy::FunctionKind,
            SessionModeOverlay {
                path_policy: Some(RoutePolicy::AdminSecretRead),
                credential_resolution: Some(CredentialResolution::AdminSecretReadLease),
                invocation_authority: Some(InvocationAuthority::AnonymousAdminBypass),
                legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
                effect_policy: None,
                response_sensitivity: None,
            },
        ),
        direct(
            "direct_runner.mutation",
            RoutePolicy::AdminWrite,
            EffectPolicy::FunctionKind,
            SessionModeOverlay {
                path_policy: None,
                credential_resolution: None,
                invocation_authority: Some(InvocationAuthority::AnonymousAdminBypass),
                legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
                effect_policy: None,
                response_sensitivity: None,
            },
        ),
        direct(
            "direct_runner.action",
            RoutePolicy::AdminWrite,
            EffectPolicy::FunctionKind,
            SessionModeOverlay {
                path_policy: None,
                credential_resolution: None,
                invocation_authority: Some(InvocationAuthority::AnonymousAdminBypass),
                legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
                effect_policy: None,
                response_sensitivity: None,
            },
        ),
        direct(
            "direct_runner.unknown",
            RoutePolicy::AdminWrite,
            EffectPolicy::FunctionKind,
            SessionModeOverlay {
                path_policy: None,
                credential_resolution: None,
                invocation_authority: Some(InvocationAuthority::AnonymousAdminBypass),
                legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
                effect_policy: Some(EffectPolicy::Unavailable),
                response_sensitivity: None,
            },
        ),
        host(
            "host_ops.app.inspect",
            RoutePolicy::AdminWrite,
            EffectPolicy::None,
            SessionModeOverlay::secret_read(),
        ),
        host(
            "host_ops.function.explain",
            RoutePolicy::AdminRead,
            EffectPolicy::None,
            SessionModeOverlay {
                path_policy: Some(RoutePolicy::AdminSecretRead),
                credential_resolution: Some(CredentialResolution::AdminSecretReadLease),
                invocation_authority: Some(InvocationAuthority::AnonymousAdminBypass),
                legacy_body_policy: None,
                effect_policy: None,
                response_sensitivity: None,
            },
        ),
        operation(
            "host_ops.function.explain.impersonated",
            "/_snapback/api/host-ops",
            HostOps,
            RouteClass::SystemApi,
            RoutePolicy::AdminRead,
            CredentialResolution::AdminCredential,
            InvocationAuthority::DevImpersonation,
            LegacyBodyPolicy::NotApplicable,
            EffectPolicy::None,
            ResponseSensitivity::SensitiveApplicationData,
            SessionModeOverlay {
                path_policy: Some(RoutePolicy::AdminSecretRead),
                credential_resolution: Some(CredentialResolution::AdminSecretReadLease),
                invocation_authority: None,
                legacy_body_policy: None,
                effect_policy: Some(EffectPolicy::Unavailable),
                response_sensitivity: None,
            },
        ),
        host(
            "host_ops.app.reset",
            RoutePolicy::AdminWrite,
            EffectPolicy::None,
            SessionModeOverlay::NONE,
        ),
        host(
            "host_ops.schema.load",
            RoutePolicy::AdminWrite,
            EffectPolicy::None,
            SessionModeOverlay::NONE,
        ),
        host(
            "host_ops.functions.load",
            RoutePolicy::AdminWrite,
            EffectPolicy::None,
            SessionModeOverlay::NONE,
        ),
        operation(
            "host_ops.auth.mintSession",
            "/_snapback/api/host-ops",
            HostOps,
            RouteClass::SystemApi,
            RoutePolicy::AdminWrite,
            CredentialResolution::AdminCredential,
            InvocationAuthority::Operator,
            LegacyBodyPolicy::NotApplicable,
            EffectPolicy::Unavailable,
            ResponseSensitivity::CredentialSecret,
            SessionModeOverlay {
                path_policy: None,
                credential_resolution: None,
                invocation_authority: None,
                legacy_body_policy: None,
                effect_policy: Some(EffectPolicy::ImpersonationCapability),
                response_sensitivity: None,
            },
        ),
        operation(
            "host_ops.auth.rescueCollidingTable",
            "/_snapback/api/host-ops",
            HostOps,
            RouteClass::SystemApi,
            RoutePolicy::AdminWrite,
            CredentialResolution::AdminCredential,
            InvocationAuthority::Operator,
            LegacyBodyPolicy::NotApplicable,
            EffectPolicy::ImpersonationCapability,
            ResponseSensitivity::OperatorMetadata,
            SessionModeOverlay::NONE,
        ),
        host(
            "host_ops.function.run.query",
            RoutePolicy::AdminRead,
            EffectPolicy::FunctionKind,
            SessionModeOverlay {
                path_policy: Some(RoutePolicy::AdminSecretRead),
                credential_resolution: Some(CredentialResolution::AdminSecretReadLease),
                invocation_authority: Some(InvocationAuthority::AnonymousAdminBypass),
                legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
                effect_policy: None,
                response_sensitivity: None,
            },
        ),
        host(
            "host_ops.function.run.mutation",
            RoutePolicy::AdminWrite,
            EffectPolicy::FunctionKind,
            SessionModeOverlay {
                path_policy: None,
                credential_resolution: None,
                invocation_authority: Some(InvocationAuthority::AnonymousAdminBypass),
                legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
                effect_policy: None,
                response_sensitivity: None,
            },
        ),
        host(
            "host_ops.function.run.action",
            RoutePolicy::AdminWrite,
            EffectPolicy::FunctionKind,
            SessionModeOverlay {
                path_policy: None,
                credential_resolution: None,
                invocation_authority: Some(InvocationAuthority::AnonymousAdminBypass),
                legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
                effect_policy: None,
                response_sensitivity: None,
            },
        ),
        host(
            "host_ops.function.run.unknown",
            RoutePolicy::AdminWrite,
            EffectPolicy::FunctionKind,
            SessionModeOverlay {
                path_policy: None,
                credential_resolution: None,
                invocation_authority: Some(InvocationAuthority::AnonymousAdminBypass),
                legacy_body_policy: Some(LegacyBodyPolicy::Rejected),
                effect_policy: Some(EffectPolicy::Unavailable),
                response_sensitivity: None,
            },
        ),
        operation(
            "host_ops.function.run.impersonated",
            "/_snapback/api/host-ops",
            HostOps,
            RouteClass::SystemApi,
            RoutePolicy::AdminWrite,
            CredentialResolution::AdminCredential,
            InvocationAuthority::DevImpersonation,
            LegacyBodyPolicy::NotApplicable,
            EffectPolicy::ImpersonationCapability,
            ResponseSensitivity::SensitiveApplicationData,
            SessionModeOverlay {
                path_policy: None,
                credential_resolution: None,
                invocation_authority: None,
                legacy_body_policy: None,
                effect_policy: None,
                response_sensitivity: None,
            },
        ),
    ];
    for entry in &operations {
        if let Err(error) = entry.validate() {
            panic!("{error}");
        }
        let carrier = route_registry()
            .into_iter()
            .find(|route| route.path == entry.parent_path)
            .unwrap_or_else(|| {
                panic!(
                    "operation {} names unregistered carrier {}",
                    entry.operation, entry.parent_path
                )
            });
        assert_eq!(
            carrier.class, entry.class,
            "operation {} class differs from carrier {}",
            entry.operation, entry.parent_path
        );
    }
    operations
}

/// Startup uses the same compiled metadata the gate consumes. A process mints
/// no independent bearer unless at least one route or selected operation is
/// actually enabled with the impersonation effect in the active auth mode.
pub(crate) fn impersonation_registry_enabled(mode: PolicyAuthMode) -> bool {
    route_registry().into_iter().any(|route| {
        route.effective_for(mode).effect_policy == EffectPolicy::ImpersonationCapability
    }) || operation_registry().into_iter().any(|operation| {
        operation.effective_for(mode).effect_policy == EffectPolicy::ImpersonationCapability
    })
}

fn operation_by_name(name: &str) -> Option<OperationSpec> {
    operation_registry()
        .into_iter()
        .find(|entry| entry.operation == name)
}

/// Consume an operation row at the runtime authorization boundary. Outer
/// FunctionKind/OperationSpecific HTTP rows deliberately defer here so the
/// selected branch, rather than the weakest outer floor, decides 401/403.
pub(crate) fn authorize_operation_spec(
    ctx: &ServerContext,
    headers: &HeaderMap,
    spec: OperationSpec,
    mode: PolicyAuthMode,
) -> Result<(), ApiError> {
    authorize_operation_path_spec(ctx, headers, spec, mode)?;
    authorize_operation_effect(spec.effective_for(mode), None)
}

fn authorize_operation_path_spec(
    ctx: &ServerContext,
    headers: &HeaderMap,
    spec: OperationSpec,
    mode: PolicyAuthMode,
) -> Result<(), ApiError> {
    let effective = spec.effective_for(mode);
    match effective.path_policy {
        RoutePolicy::AdminRead => crate::admin::authorize_for_mode(ctx, headers, false, mode),
        RoutePolicy::AdminWrite => crate::admin::authorize_for_mode(ctx, headers, true, mode),
        RoutePolicy::AdminSecretRead | RoutePolicy::SessionAuth => Err(SnapbackError::error(
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
            "auth",
            "session credential resolution is not installed yet",
        )
        .into()),
        RoutePolicy::Public | RoutePolicy::AppAuth | RoutePolicy::ConnectionAuth => Ok(()),
    }
}

/// Operation-policy authorization with the installed secret-read resolver.
/// Kept separate from the legacy helper so non-HTTP callers cannot
/// accidentally manufacture a lease from an ordinary admin credential.
pub(crate) fn authorize_operation_spec_with_secret_reads(
    ctx: &ServerContext,
    headers: &HeaderMap,
    spec: OperationSpec,
    mode: PolicyAuthMode,
    secret_reads: &SecretReadLeaseRegistry,
) -> Result<(), ApiError> {
    authorize_operation_path_spec_with_secret_reads(ctx, headers, spec, mode, secret_reads)?;
    authorize_operation_effect(spec.effective_for(mode), None)
}

fn authorize_operation_path_spec_with_secret_reads(
    ctx: &ServerContext,
    headers: &HeaderMap,
    spec: OperationSpec,
    mode: PolicyAuthMode,
    secret_reads: &SecretReadLeaseRegistry,
) -> Result<(), ApiError> {
    let effective = spec.effective_for(mode);
    match effective.path_policy {
        RoutePolicy::AdminSecretRead => authorize_secret_read(secret_reads, headers),
        _ => authorize_operation_path_spec(ctx, headers, spec, mode),
    }
}

fn authorize_operation_effect(
    effective: EffectiveRoutePolicy,
    impersonation: Option<&crate::admin_impersonation::VerifiedImpersonationCapability>,
) -> Result<(), ApiError> {
    match effective.effect_policy {
        EffectPolicy::Unavailable => Err(SnapbackError::error(
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
            "auth",
            "this operation is unavailable under the active auth policy",
        )
        .into()),
        EffectPolicy::ImpersonationCapability if impersonation.is_none() => {
            Err(crate::admin_impersonation::impersonation_required().into())
        }
        _ => Ok(()),
    }
}

pub(crate) fn authorize_operation_spec_with_secret_reads_and_impersonation(
    ctx: &ServerContext,
    headers: &HeaderMap,
    spec: OperationSpec,
    mode: PolicyAuthMode,
    secret_reads: &SecretReadLeaseRegistry,
    impersonation: &crate::admin_impersonation::VerifiedImpersonationCapability,
) -> Result<(), ApiError> {
    authorize_operation_path_spec_with_secret_reads(ctx, headers, spec, mode, secret_reads)?;
    authorize_operation_effect(spec.effective_for(mode), Some(impersonation))
}

fn authorize_secret_read(
    secret_reads: &SecretReadLeaseRegistry,
    headers: &HeaderMap,
) -> Result<(), ApiError> {
    secret_reads
        .authorize(header_secret_read_lease(headers))
        .map(|_| ())
        .map_err(Into::into)
}

/// Exhaustive function-kind mapping used by the direct runner's actual
/// authorization gate. Unknown functions take the stronger outer gate and
/// remain unavailable under sessions; they never inherit the query branch.
pub(crate) fn direct_runner_operation_spec(kind: Option<&FunctionKind>) -> OperationSpec {
    let name = match kind {
        Some(FunctionKind::Mutation) => "direct_runner.mutation",
        Some(FunctionKind::Action) => "direct_runner.action",
        Some(FunctionKind::Query | FunctionKind::LiveQuery) => "direct_runner.query",
        None => "direct_runner.unknown",
    };
    operation_by_name(name).expect("direct-runner operation must be registered")
}

/// Resolve a served host operation to its registered policy. Returning `None`
/// is intentional fail-closed input to the admin gate for unknown/unbuilt
/// operation strings.
pub(crate) fn host_ops_operation_spec(
    operation: &str,
    kind: Option<&FunctionKind>,
    impersonated: bool,
) -> Option<OperationSpec> {
    let name = match operation {
        "app.inspect" => "host_ops.app.inspect",
        "app.reset" => "host_ops.app.reset",
        "schema.load" => "host_ops.schema.load",
        "functions.load" => "host_ops.functions.load",
        "auth.mintSession" => "host_ops.auth.mintSession",
        "auth.rescueCollidingTable" => "host_ops.auth.rescueCollidingTable",
        "function.explain" if impersonated => "host_ops.function.explain.impersonated",
        "function.explain" => "host_ops.function.explain",
        "function.run" if impersonated => "host_ops.function.run.impersonated",
        "function.run" => match kind {
            Some(FunctionKind::Mutation) => "host_ops.function.run.mutation",
            Some(FunctionKind::Action) => "host_ops.function.run.action",
            Some(FunctionKind::Query | FunctionKind::LiveQuery) => "host_ops.function.run.query",
            None => "host_ops.function.run.unknown",
        },
        _ => return None,
    };
    operation_by_name(name)
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
    operation_registry()
        .into_iter()
        .filter(|entry| matches!(entry.transport, OperationTransport::LiveSocket))
        .map(|entry| (entry.operation, entry.class))
        .collect()
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
            "content-type, authorization, x-snapback-admin-token, x-snapback-console-credential, x-snapback-connection-token, x-snapback-secret-read-lease, x-snapback-auth-client-protocol, x-snapback-auth-invalidation-protocol, x-snapback-authority-descriptor-protocol, x-snapback-authorized-lease-protocol",
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
    State(auth_provider): State<crate::auth::runtime::AuthProviderHealth>,
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
        auth_provider,
        binary: crate::identity::binary_identity(),
    }))
}

/// Public `/inspect` — the trimmed identity descriptor. Operational and posture
/// facts (connection ids, the on-disk DB path) live only in the gated
/// `/_snapback/api/inspect` twin.
///
/// @ref LLP 0031#resolved-decisions — D3: the public payload is a typed projection of `InspectState`.
async fn inspect(
    State(runtime): State<AppState>,
) -> Result<Json<crate::local::PublicInspect>, ApiError> {
    let mut inspect = with_snapback(&runtime.snapback, |snapback| snapback.inspect()).await?;
    project_auth_runtime_facts(&mut inspect, &runtime);
    Ok(Json(inspect.into()))
}

/// Add process-composed auth facts to the capability authority without
/// placing socket/ready-file state inside `LocalSnapback`.
///
/// @ref LLP 0055#activation-readiness-and-later-item-fences — the exact
/// `authProgramReadiness` object is a server-owned runtime fact.
pub(crate) fn project_auth_runtime_facts(inspect: &mut InspectState, runtime: &AppState) {
    let facts = inspect
        .capability_manifest
        .runtime_facts
        .get_or_insert_with(|| Value::Object(serde_json::Map::new()));
    if !facts.is_object() {
        *facts = Value::Object(serde_json::Map::new());
    }
    facts
        .as_object_mut()
        .expect("runtime facts were normalized to an object")
        .insert(
            "authProgramReadiness".to_owned(),
            serde_json::to_value(runtime.auth_program_readiness())
                .expect("AuthProgramReadiness is infallibly serializable"),
        );
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
                admission,
            } = *stage;
            let result = match mode {
                StagedAction::Detached(action) => {
                    run_detached_ibex_action(&state, action, input, metadata).await
                }
                StagedAction::InLock(prepared) => {
                    with_snapback(&state, move |snapback| {
                        snapback.invoke_action_prepared(&probe, input, metadata, prepared)
                    })
                    .await
                }
            };
            with_snapback(&state, move |snapback| {
                snapback.finish_config_verify(&entry, entry_revision, started_ms, result, admission)
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
fn auth_host_operation_input<T: serde::de::DeserializeOwned>(
    request: &crate::host_ops::HostOpsRequest,
) -> Result<T, SnapbackError> {
    let has_unrelated_fields = request.schema.is_some()
        || request.functions.is_some()
        || request.seed.is_some()
        || request.function.is_some()
        || request.user_id.is_some()
        || request.kind.is_some();
    let Some(args) = request.args.clone().filter(|_| !has_unrelated_fields) else {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_REQUEST_INVALID",
            "auth",
            "authentication request is invalid",
        ));
    };
    serde_json::from_value(args).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_AUTH_REQUEST_INVALID",
            "auth",
            "authentication request is invalid",
        )
    })
}

async fn auth_host_result(
    runtime: &AppState,
    request: crate::host_ops::HostOpsRequest,
    server_url: Option<String>,
    outcome: Result<Value, SnapbackError>,
) -> crate::host_ops::HostOpsResult {
    let profile = runtime.server.profile;
    with_snapback(&runtime.snapback, move |snapback| {
        crate::host_ops::auth_operator_result(snapback, &request, server_url, profile, outcome)
    })
    .await
}

/// Auth host operations acquire provider coordination before the outer
/// app-instance lock. The handler repeats the selected-operation gate as a
/// backstop so a direct invocation cannot substitute an admin, console,
/// secret-read, session, or impersonation credential for either required
/// axis.
///
/// @ref LLP 0054#concurrency-locks-and-linearization — maintenance/address
/// admission precedes the outer app lock for mint and rescue.
/// @ref LLP 0054#routes-operations-and-dtos — both host operations use closed
/// args and the ordinary hostOpsResult envelope.
async fn execute_auth_host_operation(
    runtime: &AppState,
    headers: &HeaderMap,
    impersonation: Option<&crate::admin_impersonation::VerifiedImpersonationCapability>,
    route_admission: &AdmissionLease,
    request: crate::host_ops::HostOpsRequest,
    server_url: Option<String>,
) -> Result<crate::host_ops::HostOpsResult, ApiError> {
    crate::admin::authorize_host_operation(
        &runtime.server,
        headers,
        &request.operation,
        None,
        false,
        runtime.active_policy_auth_mode(),
        &runtime.secret_reads,
        impersonation,
    )?;
    crate::admin::require_operation_profile(&runtime.server, &request.operation, false)?;

    if request.operation == "auth.mintSession" {
        let mode = runtime.auth_mode_state();
        if mode.active != crate::manifest::AuthMode::Sessions
            || mode.desired != crate::manifest::AuthMode::Sessions
            || mode.mode_state != crate::auth::mode::AuthModeStatus::Settled
            || mode.app_data_availability != crate::auth::mode::AppDataAvailability::Available
        {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "auth.mintSession requires settled and available sessions mode",
            )
            .into());
        }
        if !runtime.auth_catalog_ready
            || runtime
                .auth_provider
                .as_ref()
                .is_none_or(|provider| provider.readiness() != AuthProviderReadiness::Available)
        {
            return Err(auth_provider_unavailable());
        }
    }

    match request.operation.as_str() {
        "auth.mintSession" => {
            let args = match auth_host_operation_input::<MintSessionRequest>(&request) {
                Ok(args) => args,
                Err(error) => {
                    return Ok(auth_host_result(runtime, request, server_url, Err(error)).await);
                }
            };
            let Some(provider) = runtime.auth_provider.clone() else {
                return Ok(auth_host_result(
                    runtime,
                    request,
                    server_url,
                    Err(auth_provider_unavailable_error()),
                )
                .await);
            };
            let admission = match provider.admit_email(&args.email).await {
                Ok(admission) => admission,
                Err(error) => {
                    let (error, _committed_revocation) = error.into_parts();
                    return Ok(auth_host_result(runtime, request, server_url, Err(error)).await);
                }
            };
            let outcome = coordinated_mint_session(runtime, &provider, admission, route_admission)
                .await
                .and_then(|issue| {
                    let (credential, committed_revocation) = issue.into_parts();
                    // Cap finalization has already completed before plaintext
                    // reaches this serialization boundary.
                    let _ = committed_revocation;
                    serde_json::to_value(credential).map_err(|_| auth_provider_unavailable_error())
                });
            Ok(auth_host_result(runtime, request, server_url, outcome).await)
        }
        "auth.rescueCollidingTable" => {
            let args = match auth_host_operation_input::<RescueCollidingTableRequest>(&request) {
                Ok(args) => args,
                Err(error) => {
                    return Ok(auth_host_result(runtime, request, server_url, Err(error)).await);
                }
            };
            let Some(provider) = runtime.auth_provider.clone() else {
                return Ok(auth_host_result(
                    runtime,
                    request,
                    server_url,
                    Err(auth_provider_unavailable_error()),
                )
                .await);
            };
            let maintenance = provider.exclusive_maintenance().await;
            let profile = runtime.server.profile;
            let outcome = with_snapback(&runtime.snapback, move |snapback| {
                let outcome = crate::auth::rescue::rescue_colliding_table(
                    snapback.auth_database_mut(),
                    &args,
                )
                .and_then(|result| {
                    serde_json::to_value(result).map_err(|_| auth_provider_unavailable_error())
                });
                // Keep the exclusive maintenance guard across the complete
                // rescue transaction and result projection.
                let result = crate::host_ops::auth_operator_result(
                    snapback, &request, server_url, profile, outcome,
                );
                drop(maintenance);
                result
            })
            .await;
            Ok(outcome)
        }
        _ => unreachable!("caller dispatches only registered auth host operations"),
    }
}

async fn host_ops_handler(
    State(runtime): State<AppState>,
    Extension(route_admission): Extension<AdmissionLease>,
    authority: Option<Extension<PreparedAuthority>>,
    impersonation: Option<Extension<crate::admin_impersonation::VerifiedImpersonationCapability>>,
    headers: HeaderMap,
    Json(mut request): Json<crate::host_ops::HostOpsRequest>,
) -> Result<Json<crate::host_ops::HostOpsResult>, ApiError> {
    let state = runtime.snapback.clone();
    let ctx = runtime.server.clone();
    let policy_mode = runtime.active_policy_auth_mode();
    let secret_reads = runtime.secret_reads.clone();
    let server_url = Some(format!("http://{}:{}", ctx.host, ctx.port));
    let profile = ctx.profile;
    let requested_operation = request.operation.clone();
    let requested_function = request.function.clone();
    let prepared_authority = authority.map(|Extension(authority)| authority);

    if matches!(
        request.operation.as_str(),
        "auth.mintSession" | "auth.rescueCollidingTable"
    ) {
        let result = execute_auth_host_operation(
            &runtime,
            &headers,
            impersonation.as_ref().map(|Extension(verified)| verified),
            &route_admission,
            request,
            server_url,
        )
        .await?;
        return Ok(Json(result));
    }

    let reset_preauthorized = requested_operation == "app.reset";
    if reset_preauthorized {
        // `app.reset` has no function-dependent policy. Run its complete
        // handler backstop before waiting for exclusive maintenance so an
        // unauthorized request cannot stall admitted provider work.
        crate::admin::authorize_host_operation(
            &ctx,
            &headers,
            &request.operation,
            None,
            request.user_id.is_some(),
            policy_mode,
            &secret_reads,
            impersonation.as_ref().map(|Extension(verified)| verified),
        )?;
    }
    // Reset is the one host-op branch that crosses the auth lifecycle
    // boundary. Take exclusive maintenance before the outer app mutex; clear
    // capture plaintext only after the returned envelope proves commit.
    // @ref LLP 0054#concurrency-locks-and-linearization — reset takes exclusive auth maintenance before the app/database writer.
    let reset_maintenance = if requested_operation == "app.reset" {
        match runtime.auth_provider.clone() {
            Some(provider) => Some(provider.exclusive_maintenance().await),
            None => None,
        }
    } else {
        None
    };
    let secret_reads_for_gate = secret_reads.clone();
    let gate_headers = headers.clone();
    let result = with_snapback(&state, move |snapback| -> Result<_, ApiError> {
        let function_kind = request
            .function
            .as_deref()
            .and_then(|name| snapback.function_kind(name));
        if !reset_preauthorized {
            crate::admin::authorize_host_operation(
                &ctx,
                &gate_headers,
                &request.operation,
                function_kind.as_ref(),
                request.user_id.is_some(),
                policy_mode,
                &secret_reads_for_gate,
                impersonation.as_ref().map(|Extension(verified)| verified),
            )?;
        }
        if policy_mode == PolicyAuthMode::Sessions {
            let mut scopes = std::collections::BTreeSet::new();
            match request.operation.as_str() {
                "app.inspect" => {
                    scopes.insert(crate::admin_secret_read::SecretReadScope::AdminInspect);
                }
                "function.run"
                    if matches!(
                        function_kind,
                        Some(FunctionKind::Query | FunctionKind::LiveQuery)
                    ) =>
                {
                    if let Some(function) = request.function.as_ref() {
                        scopes.insert(crate::admin_secret_read::SecretReadScope::FunctionRun(
                            function.clone(),
                        ));
                        scopes.extend(
                            snapback
                                .function_declared_read_tables(function)
                                .into_iter()
                                .map(crate::admin_secret_read::SecretReadScope::Table),
                        );
                    }
                }
                "function.explain" => {
                    if let Some(function) = request.function.as_ref() {
                        scopes.insert(crate::admin_secret_read::SecretReadScope::FunctionExplain(
                            function.clone(),
                        ));
                        scopes.extend(
                            snapback
                                .function_declared_read_tables(function)
                                .into_iter()
                                .map(crate::admin_secret_read::SecretReadScope::Table),
                        );
                    }
                }
                _ => {}
            }
            if !scopes.is_empty() {
                crate::admin::preflight_secret_read(&secret_reads_for_gate, &gate_headers, scopes)?;
            }
            request.user_id = None;
        }
        let mut result = crate::host_ops::execute_host_op_with_profile_and_authority(
            snapback,
            request,
            server_url,
            profile,
            prepared_authority,
        );
        if policy_mode == PolicyAuthMode::Sessions
            && matches!(
                result.operation.as_str(),
                "function.run" | "function.explain"
            )
        {
            result.mark_admin_bypass("session-mode anonymous administrative invocation");
        }
        Ok(result)
    })
    .await?;
    if result.ok
        && requested_operation == "app.reset"
        && let Some(maintenance) = reset_maintenance.as_ref()
    {
        maintenance.clear_mailbox_after_committed_reset();
    }
    if policy_mode == PolicyAuthMode::Sessions {
        if (result.secret_read_query || requested_operation == "function.explain")
            && (!result.ok || !result.secret_read_provenance_complete)
        {
            // Query/explain failures can currently discard ctx.db dependency
            // capture. Never forward handler-controlled diagnostics when the
            // server cannot prove the complete secret namespace they depend on.
            return Err(crate::admin::secret_read_provenance_unavailable().into());
        }
        let mut scopes = std::collections::BTreeSet::new();
        match requested_operation.as_str() {
            "app.inspect" => {
                scopes.insert(crate::admin_secret_read::SecretReadScope::AdminInspect);
            }
            "function.run" if result.secret_read_query => {
                if let Some(function) = requested_function.as_ref() {
                    scopes.insert(crate::admin_secret_read::SecretReadScope::FunctionRun(
                        function.clone(),
                    ));
                }
                scopes.extend(
                    result
                        .secret_read_tables
                        .iter()
                        .cloned()
                        .map(crate::admin_secret_read::SecretReadScope::Table),
                );
            }
            "function.explain" => {
                if let Some(function) = requested_function.as_ref() {
                    scopes.insert(crate::admin_secret_read::SecretReadScope::FunctionExplain(
                        function.clone(),
                    ));
                }
                scopes.extend(
                    result
                        .secret_read_tables
                        .iter()
                        .cloned()
                        .map(crate::admin_secret_read::SecretReadScope::Table),
                );
            }
            _ => {}
        }
        if !scopes.is_empty() {
            crate::admin::reserve_secret_read_json(
                &secret_reads,
                &headers,
                scopes,
                result.secret_read_rows,
                &result,
            )?;
        }
    }
    Ok(Json(result))
}

/// `app.reset` — the gated system write that resets the instance and, per
/// LLP 0024/LLP 0031 D5, optionally seeds it in the same call. Seed is folded
/// in here rather than living as a standalone route, so an empty body resets
/// and `{ "seed": … }` resets-then-seeds.
///
/// @ref LLP 0031#resolved-decisions — D5: seed is an optional argument to `app.reset`, not a fourth route.
async fn app_reset(
    State(runtime): State<AppState>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<AppResetResponse>, ApiError> {
    crate::admin::authorize_operation(&ctx, &headers, "app.reset", None)?;
    crate::admin::require_operation_profile(&ctx, "app.reset", false)?;
    let seed = parse_optional_json::<AppResetBody>(&headers, body)?.and_then(|body| body.seed);
    // The maintenance guard is intentionally acquired before `with_snapback`;
    // a rejected transaction returns through `?` without clearing the mailbox.
    // @ref LLP 0054#catalog-write-and-lifecycle-rules — app reset commits auth deletion with app data and retains the catalog/keyring.
    let maintenance = match runtime.auth_provider.clone() {
        Some(provider) => Some(provider.exclusive_maintenance().await),
        None => None,
    };
    let seeded = with_snapback(&runtime.snapback, move |snapback| {
        snapback.reset_with_seed(seed)
    })
    .await?;
    if let Some(maintenance) = maintenance.as_ref() {
        maintenance.clear_mailbox_after_committed_reset();
    }
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
    Extension(authority): Extension<PreparedAuthority>,
    Path(name): Path<String>,
    input: Result<Json<HandlerInput>, JsonRejection>,
) -> Result<Json<crate::manifest::QueryOutput>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    let output = if read.available() {
        with_read_lane(&read, move |lane| {
            lane.invoke_query_prepared(&name, input, authority)
        })
        .await?
    } else {
        with_snapback(&state, move |snapback| {
            snapback
                .invoke_query_with_dependencies_prepared(&name, input, authority)
                .map(|invocation| invocation.output)
        })
        .await?
    };
    Ok(Json(output))
}

/// Standalone authenticated settlement acknowledgement. A consumed replay
/// result must be reclaimable even when it was the client's final mutation;
/// requiring a later write to piggyback the ACK otherwise strands every
/// one-shot client's durable result indefinitely.
async fn acknowledge_mutations(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    input: Result<Json<MutationAcknowledgementRequest>, JsonRejection>,
) -> Result<Json<MutationAcknowledgementResponse>, ApiError> {
    let Json(request) = input.map_err(ApiError::from_json_rejection)?;
    let acknowledged = with_snapback(&state, move |snapback| {
        snapback
            .acknowledge_client_mutations_with_authority(&authority, &request.client_mutation_ids)
    })
    .await?;
    Ok(Json(MutationAcknowledgementResponse { acknowledged }))
}

/// Mutations respond with the MutationOutput fields plus the provider-core
/// MutationReceipt (LLP 0034 §3.2, ENG-22478). A REJECTED mutation still
/// produces a receipt; it rides the error envelope.
async fn invoke_mutation(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
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
        let ids = request.acknowledged_client_mutation_ids.clone();
        let acknowledgement_authority = authority.clone();
        with_snapback(&state, move |snapback| {
            snapback.acknowledge_client_mutations_with_authority(&acknowledgement_authority, &ids)
        })
        .await?;
    }
    // Receipt emission rides the L7 blocking offload: the recording call
    // (Hermes eval + rusqlite) runs via with_snapback, and the envelope is
    // assembled from its (result, receipt) pair back on the async side.
    let (result, receipt) = with_snapback(&state, move |snapback| {
        snapback.invoke_mutation_recording_with_authority(
            &name,
            request.input,
            request.client_mutation_id,
            "http",
            authority,
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
    Extension(authority): Extension<PreparedAuthority>,
    Path(name): Path<String>,
    input: Result<Json<HandlerInput>, JsonRejection>,
) -> Result<Json<crate::local::FunctionRunResult>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    let staged = {
        let name = name.clone();
        with_snapback(&state, move |snapback| {
            snapback.stage_app_action_with_authority(&name, authority)
        })
        .await
    };
    let result = match staged {
        StagedAppAction::Done(result) => *result,
        StagedAppAction::Ready(stage) => {
            run_staged_app_action(&state, &name, input, stage, "action").await
        }
    };
    Ok(Json(result))
}

/// The closed mount-lifecycle ensure family (LLP 0012 / LLP 0034): legacy
/// v0-dev compatibility remains idempotent; explicit attestation is
/// observational; explicit provisioning is centrally AdminWrite and then
/// profile-gated before entering the local core.
async fn ensure_app(
    State(runtime): State<AppState>,
    input: Result<Json<EnsureAppRequest>, JsonRejection>,
) -> Result<Json<EnsureAppResponse>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    match input {
        EnsureAppRequest::Legacy(input) => {
            let provisioning_allowed = runtime.server.profile.allows_provisioning();
            let profile = runtime.server.profile.as_str().to_owned();
            let outcome = with_snapback(&runtime.snapback, move |snapback| {
                snapback.ensure_app(*input, provisioning_allowed, &profile)
            })
            .await?;
            Ok(Json(EnsureAppResponse::Legacy(outcome)))
        }
        EnsureAppRequest::Explicit(explicit) => {
            explicit.validate()?;
            match explicit {
                EnsureAppExplicitInput::Attest {
                    requested_mode,
                    pair,
                } => {
                    let outcome = with_snapback(&runtime.snapback, move |snapback| {
                        snapback.attest_app(requested_mode, *pair)
                    })
                    .await?;
                    Ok(Json(EnsureAppResponse::Attest(outcome)))
                }
                EnsureAppExplicitInput::Provision {
                    requested_mode,
                    schema,
                    functions,
                    seed,
                } => {
                    // HTTP provisioning always needs both AdminWrite (already
                    // consumed by the centralized operation gate) and the
                    // positive non-production profile capability. The latter
                    // runs before the core can inspect hashes or take effects.
                    crate::admin::require_operation_profile(
                        &runtime.server,
                        "app.ensure.provision",
                        false,
                    )?;
                    let prepared = with_snapback(&runtime.snapback, move |snapback| {
                        snapback.prepare_auth_provision(
                            requested_mode,
                            schema.map(|manifest| *manifest),
                            functions.map(|manifest| *manifest),
                            seed.map(|seed| *seed),
                        )
                    })
                    .await?;
                    let profile = runtime.server.profile.as_str().to_owned();
                    let cross_mode = prepared.requested_mode() != runtime.auth_mode_state().active;
                    let (outcome, committed) = if cross_mode {
                        // `/app/ensure` is the transition owner and therefore
                        // never self-admits. Close the current epoch only after
                        // the complete candidate pair passed the read-only
                        // pass, then repeat and commit under the write lane.
                        let controller = runtime.auth_admission_controller();
                        let transition =
                            tokio::task::spawn_blocking(move || controller.begin_transition())
                                .await
                                .expect("auth-mode transition task panicked")?;
                        let (outcome, committed, _published) =
                            with_snapback(&runtime.snapback, move |snapback| {
                                transition.commit_and_publish_mode_state(|| {
                                    snapback.commit_auth_provision_classified(prepared, &profile)
                                })
                            })
                            .await?;
                        (outcome, committed)
                    } else {
                        // Same-mode hot apply is serialized by the write lane
                        // but does not suspend unrelated app-data roots.
                        match with_snapback(&runtime.snapback, move |snapback| {
                            snapback.commit_auth_provision_classified(prepared, &profile)
                        })
                        .await
                        {
                            Ok(committed) => committed,
                            Err(ModeCommitFailure::RolledBack(error)) => {
                                return Err(ApiError::from(error));
                            }
                            Err(ModeCommitFailure::Uncertain(error)) => {
                                runtime
                                    .auth_admission_controller()
                                    .fail_closed_after_uncertain_commit()?;
                                return Err(ApiError::from(error));
                            }
                        }
                    };
                    // The controller already published cross-mode state at the
                    // durable cut. Swap the clone-shared request projection
                    // only afterward; same-mode synchronization is idempotent.
                    if let Err(error) = runtime.publish_auth_mode_state(committed) {
                        // A durable write already succeeded. If the exact
                        // record cannot be installed in the request projection,
                        // serving the predecessor would be authority drift.
                        runtime
                            .auth_admission_controller()
                            .fail_closed_after_uncertain_commit()?;
                        return Err(ApiError::from(error));
                    }
                    Ok(Json(EnsureAppResponse::Provision(outcome)))
                }
            }
        }
    }
}

async fn subscribe_live(
    State(state): State<SharedSnapback>,
    State(connections): State<ConnectionRegistry>,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(admission): Extension<AdmissionLease>,
    Path(name): Path<String>,
    headers: HeaderMap,
    input: Result<Json<LiveSubscribeInput>, JsonRejection>,
) -> Result<Json<crate::local::LiveSubscribeOutput>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    {
        let _effect = admission.effect_guard("live subscribe connection verification")?;
        connections.verify(
            &input.connection_id,
            header_connection_token(&headers).as_deref(),
        )?;
    }
    let output = with_snapback(&state, move |snapback| {
        snapback.subscribe_live_prepared(&name, input, authority)
    })
    .await?;
    Ok(Json(output))
}

async fn resume_live(
    State(state): State<SharedSnapback>,
    State(connections): State<ConnectionRegistry>,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(admission): Extension<AdmissionLease>,
    Path(name): Path<String>,
    headers: HeaderMap,
    input: Result<Json<LiveResumeInput>, JsonRejection>,
) -> Result<Json<crate::local::LiveResumeOutput>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    {
        let _effect = admission.effect_guard("live resume connection verification")?;
        connections.verify(
            &input.connection_id,
            header_connection_token(&headers).as_deref(),
        )?;
    }
    let output = with_snapback(&state, move |snapback| {
        snapback.resume_live_prepared(&name, input, authority)
    })
    .await?;
    Ok(Json(output))
}

async fn unsubscribe_live(
    State(state): State<SharedSnapback>,
    State(connections): State<ConnectionRegistry>,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(admission): Extension<AdmissionLease>,
    Path(name): Path<String>,
    headers: HeaderMap,
    input: Result<Json<LiveUnsubscribeInput>, JsonRejection>,
) -> Result<Json<crate::local::LiveUnsubscribeOutput>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    {
        let _effect = admission.effect_guard("live unsubscribe connection verification")?;
        connections.verify(
            &input.connection_id,
            header_connection_token(&headers).as_deref(),
        )?;
    }
    // L7 offload: disposal reads the storage version (rusqlite) for its
    // receipt, so it runs on the blocking lane like every other write path.
    let output = with_snapback(&state, move |snapback| {
        snapback.unsubscribe_live_prepared(&name, input, authority)
    })
    .await?;
    Ok(Json(output))
}

async fn stream_live(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(connection_id): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let state = runtime.snapback.clone();
    let ephemeral = runtime.ephemeral.clone();
    let connections = runtime.connections.clone();
    let policy_mode = runtime.active_policy_auth_mode();
    let admission = runtime.auth_admission_controller();
    let active_mode = authority.active_mode();
    let admission_epoch = authority.admission_epoch();
    // The token gate runs BEFORE the upgrade: an unauthorized caller gets the
    // structured 401/403 diagnostic, never a socket. Browser WebSockets cannot
    // set headers, so the token rides the
    // `snapback.connection-token.<token>` subprotocol instead. Query-string
    // credentials are intentionally ignored because URLs leak into logs,
    // history, proxies, and telemetry (ENG-24354).
    let presented =
        header_connection_token(&headers).or_else(|| subprotocol_connection_token(&headers));
    let verified = match authority
        .admission_lease()
        .effect_guard("WebSocket upgrade connection verification")
    {
        Ok(_effect) => connections.verify(&connection_id, presented.as_deref()),
        Err(error) => Err(ApiError::from(error)),
    };
    if let Err(error) = verified {
        return error.into_response();
    }
    // Select the negotiated subprotocol when offered (a browser fails the
    // connection if it offered subprotocols and the server echoed none).
    ws.max_message_size(MAX_LIVE_SOCKET_FRAME_BYTES)
        .max_frame_size(MAX_LIVE_SOCKET_FRAME_BYTES)
        .protocols([LIVE_STREAM_SUBPROTOCOL])
        .on_upgrade(move |socket| {
            live_stream(
                socket,
                state,
                ephemeral,
                connections,
                connection_id,
                policy_mode,
                admission,
                active_mode,
                admission_epoch,
            )
        })
}

/// Acquire one short socket-act root, suspending without polling while the
/// current epoch is transiently closed. An abort reopens under a fresh epoch;
/// a committed pending epoch or mode change closes the old socket boundary.
async fn acquire_live_act_admission(
    controller: &AuthAdmissionController,
    active_mode: AuthMode,
    current_epoch: &mut u64,
) -> Option<AdmissionLease> {
    loop {
        match controller.admit_for_mode(active_mode) {
            Ok(admission) => {
                *current_epoch = admission.admission_epoch();
                return Some(admission);
            }
            Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_MODE_PENDING" => {
                let observed = controller.diagnostic_snapshot();
                if observed.admission_epoch != *current_epoch {
                    if !observed.accepting || observed.active_mode != active_mode {
                        return None;
                    }
                    *current_epoch = observed.admission_epoch;
                    continue;
                }
                let changed = controller.changed(observed).await;
                if changed.admission_epoch != *current_epoch {
                    if !changed.accepting || changed.active_mode != active_mode {
                        return None;
                    }
                    *current_epoch = changed.admission_epoch;
                }
            }
            Err(_) => return None,
        }
    }
}

struct AdmittedLiveWrite {
    message: Message,
    admission: AdmissionLease,
    completed: oneshot::Sender<bool>,
}

async fn live_socket_writer(
    mut sender: futures_util::stream::SplitSink<WebSocket, Message>,
    mut writes: mpsc::Receiver<AdmittedLiveWrite>,
    notify: Arc<crate::ephemeral::DeliveryNotifier>,
    connection_id: String,
    generation: u64,
) {
    while let Some(write) = writes.recv().await {
        if !notify.is_current(&connection_id, generation) {
            let _ = write.completed.send(false);
            break;
        }
        let sent = tokio::select! {
            biased;
            _ = write.admission.cancelled() => false,
            result = sender.send(write.message) => result.is_ok(),
        };
        let _ = write.completed.send(sent);
        if !sent {
            break;
        }
    }
}

async fn send_live_with_admission(
    writer: &mpsc::Sender<AdmittedLiveWrite>,
    message: Message,
    admission: &AdmissionLease,
) -> bool {
    let (completed, completion) = oneshot::channel();
    // The complete frame crosses into the bounded writer queue under the same
    // mutex that retires an epoch. Socket I/O may await afterward, but no frame
    // can begin its writer handoff after the retirement cut.
    let handed_off = {
        let Ok(_publication) = admission.effect_guard("WebSocket writer handoff") else {
            return false;
        };
        writer
            .try_send(AdmittedLiveWrite {
                message,
                admission: admission.clone(),
                completed,
            })
            .is_ok()
    };
    if !handed_off {
        return false;
    }
    tokio::select! {
        biased;
        _ = admission.cancelled() => false,
        result = completion => result.unwrap_or(false),
    }
}

async fn live_stream(
    socket: WebSocket,
    state: SharedSnapback,
    ephemeral: EphemeralApi,
    connections: ConnectionRegistry,
    connection_id: String,
    policy_mode: PolicyAuthMode,
    admission_controller: AuthAdmissionController,
    active_mode: AuthMode,
    mut admission_epoch: u64,
) {
    let (sender, mut receiver) = socket.split();
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L8: an enqueue
    // wakes this task immediately (sub-poll-interval delivery, and no periodic
    // lock traffic while idle). The long interval is a safety net only, in case
    // a wake is ever missed; register before draining so no push is lost.
    let notify = ephemeral.delivery_notifier();
    let Ok((generation, waker)) = notify.register(&connection_id) else {
        // Generation reuse could transfer drain/teardown ownership to a stale
        // socket. Exhaustion is process-terminal for new live streams.
        return;
    };
    let (writer, writes) = mpsc::channel(1);
    let writer_task = tokio::spawn(live_socket_writer(
        sender,
        writes,
        notify.clone(),
        connection_id.clone(),
        generation,
    ));
    // Delivery is event-driven (the 25ms poll is gone); this heartbeat is only a
    // defensive fallback if a wake is ever missed. At 30s it is ~1200× less lock
    // traffic than the old poll, so an idle connection is effectively idle.
    let mut safety_net = interval(Duration::from_secs(30));
    safety_net.tick().await; // consume the immediate first tick

    // Flush anything enqueued before (or racing) registration under one short
    // managed root. The HTTP upgrade root ends with the 101 response; it is
    // never retained for the lifetime of the socket.
    let Some(initial_admission) =
        acquire_live_act_admission(&admission_controller, active_mode, &mut admission_epoch).await
    else {
        drop(writer);
        let _ = writer_task.await;
        teardown_live_stream(&state, &notify, &connection_id, generation).await;
        return;
    };
    let initial_current = initial_admission
        .effect_guard("initial WebSocket drain")
        .is_ok_and(|_effect| {
            connections.touch_verified_socket(&connection_id)
                && notify.is_current(&connection_id, generation)
        });
    if !initial_current
        || drain_and_send(
            &ephemeral,
            &connection_id,
            generation,
            &writer,
            &initial_admission,
        )
        .await
        .is_break()
    {
        drop(writer);
        let _ = writer_task.await;
        teardown_live_stream(&state, &notify, &connection_id, generation).await;
        return;
    }
    drop(initial_admission);

    // @ref LLP 0020#phase-4-upgrade-realtime-from-v0-outbox-to-app-grade-live-delivery — WebSocket push is a transport over the existing ordered live queue; deterministic drain stays available for tests.
    'stream: loop {
        let admission_snapshot = admission_controller.diagnostic_snapshot();
        let drain_admission = tokio::select! {
            biased;
            _ = admission_controller.changed(admission_snapshot) => {
                // Closing the old epoch wakes the idle socket immediately.
                // Wait for a fresh accepting epoch after abort, or close when
                // staging committed a pending/mode-changed epoch.
                let Some(admission) = acquire_live_act_admission(
                    &admission_controller,
                    active_mode,
                    &mut admission_epoch,
                ).await else {
                    break 'stream;
                };
                drop(admission);
                None
            }
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(Message::Text(text))) => {
                        let Some(admission) = acquire_live_act_admission(
                            &admission_controller,
                            active_mode,
                            &mut admission_epoch,
                        ).await else {
                            break 'stream;
                        };
                        let response = {
                            let Ok(_effect) = admission.effect_guard("WebSocket inbound act") else {
                                break 'stream;
                            };
                            if !connections.touch_verified_socket(&connection_id) {
                                break 'stream;
                            }
                            handle_live_socket_text(
                                &ephemeral,
                                &connection_id,
                                &text,
                                policy_mode,
                            )
                        };
                        if !send_live_with_admission(
                            &writer,
                            Message::Text(response.into()),
                            &admission,
                        ).await {
                            break 'stream;
                        }
                        None
                    }
                    // A protocol Ping/Pong from the peer is client-initiated
                    // liveness for the L2 reaper (ENG-23424) — most
                    // importantly the Pong answering the safety-net Ping
                    // below, which every conforming peer sends even when the
                    // app is otherwise idle. (Ephemeral text ops touch
                    // activity through their EphemeralApi calls; `live_ping`
                    // stays deliberately stateless.)
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {
                        let Some(admission) = acquire_live_act_admission(
                            &admission_controller,
                            active_mode,
                            &mut admission_epoch,
                        ).await else {
                            break 'stream;
                        };
                        let Ok(_effect) = admission.effect_guard("WebSocket liveness act") else {
                            break 'stream;
                        };
                        if !connections.touch_verified_socket(&connection_id) {
                            break 'stream;
                        }
                        ephemeral.touch_connection(&connection_id);
                        None
                    }
                    Some(Ok(Message::Binary(_))) => {
                        let Some(admission) = acquire_live_act_admission(
                            &admission_controller,
                            active_mode,
                            &mut admission_epoch,
                        ).await else {
                            break 'stream;
                        };
                        let Ok(_effect) = admission.effect_guard("WebSocket binary act") else {
                            break 'stream;
                        };
                        if !connections.touch_verified_socket(&connection_id) {
                            break 'stream;
                        }
                        None
                    },
                }
            }
            _ = waker.notified() => {
                let Some(admission) = acquire_live_act_admission(
                    &admission_controller,
                    active_mode,
                    &mut admission_epoch,
                ).await else {
                    break 'stream;
                };
                let Ok(_effect) = admission.effect_guard("WebSocket drain wake") else {
                    break 'stream;
                };
                if !connections.touch_verified_socket(&connection_id) {
                    break 'stream;
                }
                drop(_effect);
                Some(admission)
            },
            _ = safety_net.tick() => {
                // ENG-23424: probe the peer, don't just drain. A peer that
                // vanished without FIN/RST (suspend, cable pull) never errors
                // on an *empty* drain — no bytes are written — so without this
                // Ping the task would live forever. The Ping forces socket
                // I/O every 30s: a dead peer surfaces a send error within the
                // TCP retransmission timeout, and a live one answers with a
                // Pong that refreshes its activity above.
                let Some(admission) = acquire_live_act_admission(
                    &admission_controller,
                    active_mode,
                    &mut admission_epoch,
                ).await else {
                    break 'stream;
                };
                let current = admission
                    .effect_guard("WebSocket safety-net liveness")
                    .is_ok_and(|_effect| connections.touch_verified_socket(&connection_id));
                if !current || !send_live_with_admission(
                    &writer,
                    Message::Ping(Vec::new().into()),
                    &admission,
                ).await {
                    break 'stream;
                }
                Some(admission)
            }
        };
        if let Some(admission) = drain_admission {
            // ENG-23425: a superseded task must not drain. The outbox is
            // keyed by connection id alone, so after a reconnect replaces
            // this registration the queued messages belong to the NEW
            // socket's task — draining them here writes them into a dead,
            // half-open socket (or discards them on send failure) and they
            // never reach the live client. Exit instead; the
            // generation-guarded teardown below then skips `disconnect`,
            // leaving the new socket's registration and subscriptions intact.
            let current = admission
                .effect_guard("WebSocket drain ownership")
                .is_ok_and(|_effect| notify.is_current(&connection_id, generation));
            if !current {
                break 'stream;
            }
            if drain_and_send(&ephemeral, &connection_id, generation, &writer, &admission)
                .await
                .is_break()
            {
                break 'stream;
            }
        }
    }

    drop(writer);
    let _ = writer_task.await;
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
    generation: u64,
    writer: &mpsc::Sender<AdmittedLiveWrite>,
    admission: &AdmissionLease,
) -> std::ops::ControlFlow<()> {
    let messages = {
        let Ok(_effect) = admission.effect_guard("WebSocket outbox drain") else {
            return std::ops::ControlFlow::Break(());
        };
        let Some(messages) = ephemeral.drain_live_stream_if_current(connection_id, generation)
        else {
            return std::ops::ControlFlow::Break(());
        };
        messages
    };
    for message in messages {
        if !send_live_with_admission(writer, Message::Text(message.into()), admission).await {
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
fn live_socket_operation_name(message: &LiveSocketClientMessage) -> &'static str {
    match message {
        LiveSocketClientMessage::EphemeralSubscribe { .. } => "ephemeral_subscribe",
        LiveSocketClientMessage::EphemeralPublish { .. } => "ephemeral_publish",
        LiveSocketClientMessage::EphemeralDelete { .. } => "ephemeral_delete",
        LiveSocketClientMessage::EphemeralUnsubscribe { .. } => "ephemeral_unsubscribe",
        LiveSocketClientMessage::Ping { .. } => "live_ping",
    }
}

fn live_socket_request_id(message: &LiveSocketClientMessage) -> Option<String> {
    match message {
        LiveSocketClientMessage::EphemeralSubscribe { request_id, .. }
        | LiveSocketClientMessage::EphemeralPublish { request_id, .. }
        | LiveSocketClientMessage::EphemeralDelete { request_id, .. }
        | LiveSocketClientMessage::EphemeralUnsubscribe { request_id, .. }
        | LiveSocketClientMessage::Ping { request_id } => request_id.clone(),
    }
}

/// Handle a socket-text operation. Ephemeral operations reach the room
/// authority directly — a busy mutation holding the global write mutex cannot
/// delay a cursor publish on this socket (LLP 0032 L9).
fn handle_live_socket_text(
    ephemeral: &EphemeralApi,
    connection_id: &str,
    text: &str,
    policy_mode: PolicyAuthMode,
) -> String {
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
    let raw = match serde_json::from_str::<Value>(text) {
        Ok(value) => value,
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
    if matches!(policy_mode, PolicyAuthMode::Sessions)
        && let Some(field) = legacy_body_auth_field(&raw)
    {
        let request_id = raw
            .get("requestId")
            .or_else(|| raw.get("request_id"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let operation = raw.get("type").and_then(Value::as_str).unwrap_or("decode");
        return socket_error(
            request_id,
            operation,
            body_auth_unsupported(field).0.diagnostic,
        );
    }
    let message = match serde_json::from_value::<LiveSocketClientMessage>(raw.clone()) {
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
    let operation_name = live_socket_operation_name(&message);
    let operation = operation_by_name(operation_name)
        .expect("every decoded live-socket variant must have registered policy");
    assert_eq!(operation.transport, OperationTransport::LiveSocket);
    let effective = operation.effective_for(policy_mode);
    if effective.effect_policy == EffectPolicy::Unavailable {
        return socket_error(
            live_socket_request_id(&message),
            operation_name,
            Diagnostic::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "this socket operation is unavailable under the active auth policy",
            ),
        );
    }

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
    Extension(_authority): Extension<PreparedAuthority>,
    Extension(admission): Extension<AdmissionLease>,
    Path(connection_id): Path<String>,
    Query(query): Query<ConnectionTokenQuery>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::ephemeral::RealtimeEnvelope>>, ApiError> {
    let presented = header_connection_token(&headers).or(query.connection_token);
    let _effect = admission.effect_guard("HTTP outbox drain publication")?;
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
    Extension(_authority): Extension<PreparedAuthority>,
    Extension(admission): Extension<AdmissionLease>,
    input: Result<Json<EnsureEphemeralCollectionsInput>, JsonRejection>,
) -> Result<Json<crate::ephemeral::CollectionEnsureOutcome>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    let _effect = admission.effect_guard("ephemeral collection publication")?;
    ephemeral
        .ensure_collections(input.into_collections())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn publish_ephemeral(
    State(ephemeral): State<EphemeralApi>,
    State(connections): State<ConnectionRegistry>,
    Extension(_authority): Extension<PreparedAuthority>,
    Extension(admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    request: Result<Json<PublishRequest>, JsonRejection>,
) -> Result<Json<crate::ephemeral::PublishOutcome>, ApiError> {
    let Json(request) = request.map_err(ApiError::from_json_rejection)?;
    let _effect = admission.effect_guard("ephemeral publish")?;
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
    Extension(_authority): Extension<PreparedAuthority>,
    Extension(admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    request: Result<Json<SubscribeRequest>, JsonRejection>,
) -> Result<Json<crate::ephemeral::EphemeralMessage>, ApiError> {
    let Json(request) = request.map_err(ApiError::from_json_rejection)?;
    let _effect = admission.effect_guard("ephemeral subscribe")?;
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
    Extension(_authority): Extension<PreparedAuthority>,
    Extension(admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    request: Result<Json<DeleteRequest>, JsonRejection>,
) -> Result<Json<Option<crate::ephemeral::EphemeralMessage>>, ApiError> {
    let Json(request) = request.map_err(ApiError::from_json_rejection)?;
    let _effect = admission.effect_guard("ephemeral delete")?;
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
        "SNAPBACK_UNKNOWN_CRON_JOB"
        | "SNAPBACK_UNKNOWN_SUBSCRIPTION"
        | "SNAPBACK_AUTH_MODE_DEV"
        | "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND" => StatusCode::NOT_FOUND,
        "SNAPBACK_MUTATION_CONFLICT"
        | "SNAPBACK_ACTION_GENERATION_CONFLICT"
        | "SNAPBACK_CONFIG_VERIFY_STALE"
        | "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
        | "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED"
        | "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
        | "SNAPBACK_AUTH_TABLE_COLLISION"
        | "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION"
        | "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED" => StatusCode::CONFLICT,
        "SNAPBACK_AUTH_REFRESH_SUPERSEDED" => StatusCode::CONFLICT,
        // @ref LLP 0017#security-defaults — admin gating distinguishes "disabled"
        // (forbidden) from "needs the configured token" (unauthorized).
        "SNAPBACK_ADMIN_DISABLED"
        | "SNAPBACK_ADMIN_SECRET_READ_SCOPE_DENIED"
        | "SNAPBACK_ADMIN_SECRET_READ_MINT_DENIED"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_REQUIRED"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_REPLAYED"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_STALE"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_STARTUP_MISMATCH"
        | "SNAPBACK_LIVE_RESUME_OWNERSHIP"
        | "SNAPBACK_CONNECTION_TOKEN_INVALID"
        | "SNAPBACK_AUTH_CODE_LOCKED"
        | "SNAPBACK_AUTH_IMPERSONATION_REQUIRED"
        | "SNAPBACK_PROFILE_FORBIDS" => StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_TOKEN_REQUIRED"
        | "SNAPBACK_ADMIN_SECRET_READ_REQUIRED"
        | "SNAPBACK_CONNECTION_TOKEN_REQUIRED"
        | "SNAPBACK_AUTH_REQUIRED"
        | "SNAPBACK_AUTH_SESSION_EXPIRED"
        | "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED"
        | "SNAPBACK_AUTH_CODE_INVALID" => StatusCode::UNAUTHORIZED,
        "SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED"
        | "SNAPBACK_ADMIN_SECRET_READ_BUDGET_EXHAUSTED"
        | "SNAPBACK_ADMIN_SECRET_READ_LEASE_CAPACITY_EXCEEDED"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_CAPACITY_EXCEEDED"
        | "SNAPBACK_AUTH_THROTTLED"
        | "SNAPBACK_EPHEMERAL_RATE_LIMITED"
        | "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT"
        | "SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT" => StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_VALUE_TOO_LARGE"
        | "SNAPBACK_EPHEMERAL_METADATA_TOO_LARGE"
        | "SNAPBACK_EPHEMERAL_VALUE_TOO_LARGE"
        | "SNAPBACK_HANDLER_HOST_CALL_BODY_TOO_LARGE"
        | "SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE"
        | "SNAPBACK_WEBSOCKET_MESSAGE_TOO_LARGE" => StatusCode::PAYLOAD_TOO_LARGE,
        "SNAPBACK_ADMIN_SECRET_READ_LEASE_INVALID" => StatusCode::BAD_REQUEST,
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
        | "SNAPBACK_AUTH_CATALOG_CORRUPT"
        | "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED"
        | "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED"
        | "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE"
        | "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
        | "SNAPBACK_AUTH_MODE_PENDING"
        | "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        | "SNAPBACK_AUTH_PROJECTION_CORRUPT"
        | "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        | "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        | "SNAPBACK_CAPABILITY_UNSUPPORTED"
        | "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED"
        | "SNAPBACK_AUTH_REVOCATION_UNCERTAIN"
        | "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT"
        | "SNAPBACK_V8_RUNNER_HOST_UNSUPPORTED" => StatusCode::SERVICE_UNAVAILABLE,
        // Exhaustive allow-list of request, declaration, authorization, and
        // application-handler diagnostics. Adding a new code does not add it
        // here automatically: the default below remains a truthful 500 until
        // its producer deliberately chooses a client class.
        "SNAPBACK_ARG_MISSING"
        | "SNAPBACK_ACTION_MUTATION_REFERENCE_INVALID"
        | "SNAPBACK_AUTHORITY_INDEPENDENT_INVALID"
        | "SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED"
        | "SNAPBACK_CLIENT_MUTATION_ACK_LIMIT_EXCEEDED"
        | "SNAPBACK_CLIENT_MUTATION_ACK_OVERLAP"
        | "SNAPBACK_CLIENT_MUTATION_PURGE_SELECTOR_INVALID"
        | "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED"
        | "SNAPBACK_AUTH_REQUEST_INVALID"
        | "SNAPBACK_AUTH_RESCUE_INVALID"
        | "SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED"
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
        | "SNAPBACK_CRON_AUTH_REQUIREMENT_INVALID"
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
        ACTION_WORKER_LIMIT_MAX, AdmissionLease, CRON_DISPATCH_CONCURRENCY_DEFAULT,
        CRON_DISPATCH_CONCURRENCY_MAX, ConnectionGrant, ConnectionTokenQuery, DetachedActionHost,
        DetachedActionWorkerCounters, OpenConnectionRequest, PolicyAuthMode, PreparedAuthority,
        SharedSnapback, app, configured_action_worker_limit, configured_cron_dispatch_concurrency,
        dispatch_cron_tick_background, parse_action_watchdog_timeout, parse_optional_json,
        reserve_detached_action_worker, reserve_detached_action_worker_with_counters,
        run_detached_ibex_action_with_admission_and_counters, spawn_detached_action_worker,
        status_for_diagnostic_code,
    };
    use crate::admin::{AppState, ServerContext, ServerProfile};
    use crate::admin_impersonation::{
        IMPERSONATION_CAPABILITY_HEADER, ImpersonationCapabilityRegistry,
    };
    use crate::auth::crypto::{OsRandom, SessionBearer};
    use crate::auth::invocation::{
        InvocationGate, InvocationSource, ResolvedAppAuthority, WireAuthorityFields,
    };
    use crate::auth::keyring::AuthKeyringStore;
    use crate::auth::lifecycle::activate_catalog;
    use crate::auth::mode::{
        AppDataAvailability, AuthModeQuarantine, AuthModeStateRecord, AuthModeStatus,
        AuthProgramReadiness, DeploymentIdentity, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX,
        SCHEMA_V1_PREFIX,
    };
    use crate::auth::provider::{AuthProvider, AuthProviderProfile};
    use crate::cron::CronRunOutcome;
    use crate::local::{LocalSnapback, StagedAction};
    use crate::manifest::{
        AuthInput, AuthMode, CronActivationPolicy, CronJitterPolicy, CronJobDefinition,
        CronOverlapPolicy, CronRetryMode, CronRetryPolicy, CronSchedule, FunctionDefinition,
        FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule,
        MutationAcknowledgementRequest, MutationPlan, ReturnValue, SchemaManifest,
    };
    use crate::runtime::IbexActionHost;
    use crate::storage::ClientMutationIdentity;
    use axum::Json;
    use axum::body::{Body, Bytes, to_bytes};
    use axum::extract::{Extension, State};
    use axum::http::{HeaderMap, HeaderValue, Request, StatusCode, header};
    use futures_util::StreamExt as _;
    use serde_json::{Value, json};
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::{Arc, Condvar, Mutex as StdMutex};
    use std::time::{Duration, Instant};
    use syn::visit::Visit;
    use tokio::net::TcpListener;
    use tokio::sync::{Mutex, Semaphore};
    use tower::ServiceExt as _;

    fn auth_runtime_fixture(mode: PolicyAuthMode) -> (AppState, String) {
        let mut snapback = LocalSnapback::memory().expect("memory auth HTTP fixture");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            super::now_millis(),
            &OsRandom,
        )
        .expect("activate auth catalog");
        let provider = Arc::new(
            AuthProvider::new(AuthProviderProfile::Test, keyring).expect("construct auth provider"),
        );
        let (registry, operator) =
            ImpersonationCapabilityRegistry::generate("auth-http-fixture".to_owned(), &OsRandom)
                .expect("generate impersonation capability");
        let mut capability = None;
        operator
            .emit_once_to_terminal(|value| {
                capability = Some(value.to_owned());
                Ok(())
            })
            .expect("capture test impersonation capability");
        let mut context = ServerContext::detached();
        context.profile = ServerProfile::Test;
        context.admin_token = Some("auth-http-admin".to_owned());
        let state = AppState::from_snapback(snapback, context)
            .with_policy_auth_mode(mode)
            .with_impersonation_capabilities(registry)
            .with_auth_provider(provider);
        (state, capability.expect("captured capability"))
    }

    fn auth_http_fixture_with_provider(
        mode: PolicyAuthMode,
    ) -> (axum::Router, String, Arc<AuthProvider>) {
        let (state, capability) = auth_runtime_fixture(mode);
        let provider = state
            .auth_provider
            .clone()
            .expect("installed auth provider");
        (app(state), capability, provider)
    }

    fn auth_http_fixture(mode: PolicyAuthMode) -> (axum::Router, String) {
        let (state, capability) = auth_runtime_fixture(mode);
        (app(state), capability)
    }

    fn sessions_deployment() -> DeploymentIdentity {
        DeploymentIdentity {
            schema_version: "snapback.v1".to_owned(),
            auth_mode: AuthMode::Sessions,
            app_id: "auth-http-fixture".to_owned(),
            schema_hash: format!("{SCHEMA_V1_PREFIX}{}", "1".repeat(64)),
            bundle_hash: format!("{FUNCTION_V1_PREFIX}{}", "2".repeat(64)),
            inputs_hash: format!("{INPUTS_V1_PREFIX}{}", "3".repeat(64)),
        }
    }

    fn settled_sessions_state() -> AuthModeStateRecord {
        AuthModeStateRecord {
            format_version: crate::auth::mode::AUTH_MODE_FORMAT_VERSION,
            transition_generation: 7,
            active: AuthMode::Sessions,
            desired: AuthMode::Sessions,
            mode_state: AuthModeStatus::Settled,
            app_data_availability: AppDataAvailability::Available,
            sessions_ever_activated: true,
            active_deployment: Some(sessions_deployment()),
            requested_deployment: None,
            quarantine: None,
        }
    }

    fn pending_sessions_state(quarantined: bool) -> AuthModeStateRecord {
        let generation = 8;
        AuthModeStateRecord {
            format_version: crate::auth::mode::AUTH_MODE_FORMAT_VERSION,
            transition_generation: generation,
            active: AuthMode::Dev,
            desired: AuthMode::Sessions,
            mode_state: if quarantined {
                AuthModeStatus::Quarantined
            } else {
                AuthModeStatus::PendingRestart
            },
            app_data_availability: AppDataAvailability::RefusedPending,
            sessions_ever_activated: false,
            active_deployment: None,
            requested_deployment: Some(sessions_deployment()),
            quarantine: quarantined.then(|| AuthModeQuarantine {
                transition_generation: generation,
                code: "SNAPBACK_AUTH_POLICY_UNAVAILABLE".to_owned(),
            }),
        }
    }

    async fn mint_test_credential(state: &AppState, email: &str) -> serde_json::Value {
        let provider = state
            .auth_provider
            .clone()
            .expect("installed auth provider");
        let admission = provider.admit_email(email).await.expect("admit test email");
        let route_admission = super::test_route_admission(state).0;
        let issue = super::coordinated_mint_session(state, &provider, admission, &route_admission)
            .await
            .expect("mint test session");
        let (credential, _committed_revocation) = issue.into_parts();
        serde_json::to_value(credential).expect("serialize test credential")
    }

    fn auth_provider_headers(bearer: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        if let Some(bearer) = bearer {
            headers.insert(
                header::AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {bearer}")).expect("bearer header"),
            );
        }
        headers
    }

    fn test_route_admission(state: &AppState) -> Extension<AdmissionLease> {
        Extension(
            state
                .auth_admission_controller()
                .admit_for_mode(state.auth_mode_state().active)
                .expect("admit direct handler test route"),
        )
    }

    fn auth_http_request(
        method: &str,
        uri: &str,
        body: Vec<u8>,
        content_type: bool,
        admin: Option<&str>,
        impersonation: Option<&str>,
    ) -> Request<Body> {
        let mut builder = Request::builder().method(method).uri(uri);
        if content_type {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        if let Some(admin) = admin {
            builder = builder.header("x-snapback-admin-token", admin);
        }
        if let Some(impersonation) = impersonation {
            builder = builder.header(IMPERSONATION_CAPABILITY_HEADER, impersonation);
        }
        builder.body(Body::from(body)).expect("auth HTTP request")
    }

    async fn response_json(response: axum::response::Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read auth HTTP response");
        serde_json::from_slice(&bytes).expect("auth HTTP JSON response")
    }

    #[tokio::test]
    async fn settlement_acknowledgement_uses_prepared_authority_not_body_identity() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        let retained_auth = AuthInput {
            principal: None,
            session_id: None,
            user_id: Some("settlement-owner".to_owned()),
        };
        let retained_input = HandlerInput {
            auth: retained_auth.clone(),
            ..HandlerInput::default()
        };
        let identity = ClientMutationIdentity::new(
            "cm_prepared_authority_ack",
            "settlement-test",
            &retained_input,
        );
        let retained_id = identity.id.clone();
        super::with_snapback(&state.snapback, move |snapback| {
            snapback
                .auth_database_mut()
                .execute_mutation_idempotent(
                    &MutationPlan {
                        steps: Vec::new(),
                        return_value: Some(ReturnValue::ChangedCount),
                    },
                    &retained_input,
                    &identity,
                )
                .expect("retain settlement for authority A");
        })
        .await;

        let prepared = |user_id: &str| {
            InvocationGate::prepare_admitted_authority(
                InvocationSource::StandaloneAcknowledgement,
                AuthMode::Dev,
                ServerProfile::Test,
                state.auth_admission_controller().admit_dev().unwrap(),
                &WireAuthorityFields::default(),
                ResolvedAppAuthority::DevImpersonation {
                    user_id: user_id.to_owned(),
                    roles: Vec::new(),
                    local_dev_only: true,
                },
            )
            .unwrap()
        };
        let Json(wrong) = super::acknowledge_mutations(
            State(state.snapback.clone()),
            Extension(prepared("different-owner")),
            Ok(Json(MutationAcknowledgementRequest {
                auth: retained_auth.clone(),
                client_mutation_ids: vec![retained_id.clone()],
            })),
        )
        .await
        .unwrap();
        assert_eq!(wrong.acknowledged, 0);

        let Json(owner) = super::acknowledge_mutations(
            State(state.snapback.clone()),
            Extension(prepared("settlement-owner")),
            Ok(Json(MutationAcknowledgementRequest {
                auth: AuthInput {
                    principal: None,
                    session_id: None,
                    user_id: Some("different-owner".to_owned()),
                },
                client_mutation_ids: vec![retained_id],
            })),
        )
        .await
        .unwrap();
        assert_eq!(owner.acknowledged, 1);
    }

    #[tokio::test]
    async fn auth_session_dev_is_closed_no_store_and_rejects_credentials() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        let state = state
            .with_server_startup_nonce("handshake-dev")
            .expect("install startup nonce");
        let router = app(state);
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .header("x-snapback-auth-client-protocol", "1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            HeaderValue::from_static("no-store, private")
        );
        let body = response_json(response).await;
        assert_eq!(body["protocolVersion"], 1);
        assert_eq!(body["serverStartupNonce"], "handshake-dev");
        assert_eq!(body["activeMode"], "dev");
        assert_eq!(body["desiredMode"], "dev");
        assert_eq!(body["clientProtocols"]["authClient"], 1);
        assert_eq!(
            body["provider"],
            json!({"key": "email-code", "available": false})
        );
        assert_eq!(
            body["authority"],
            json!({"userId": null, "sessionId": null, "isAuthenticated": false})
        );

        let credential = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .header(header::AUTHORIZATION, "Bearer not-a-session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(credential.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(credential).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_REQUIRED"
        );

        for request in [
            Request::builder()
                .uri("/auth/session?smuggled=true")
                .body(Body::empty())
                .unwrap(),
            Request::builder()
                .uri("/auth/session")
                .body(Body::from("{}"))
                .unwrap(),
        ] {
            let rejected = router.clone().oneshot(request).await.unwrap();
            assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
            assert_eq!(
                response_json(rejected).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_REQUEST_INVALID"
            );
        }
    }

    #[tokio::test]
    async fn handshake_holds_one_root_through_body_and_pending_is_snapshot_only() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        let controller = state.auth_admission_controller();
        let response = app(state)
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(controller.snapshot().in_flight, 1);
        let authority = response
            .extensions()
            .get::<PreparedAuthority>()
            .expect("stable handshake carries exact authority");
        assert_eq!(
            authority.source(),
            crate::auth::invocation::InvocationSource::BootstrapHandshake
        );
        assert_eq!(
            response
                .extensions()
                .get::<AdmissionLease>()
                .expect("stable handshake carries its counted root")
                .admission_epoch(),
            authority.admission_epoch()
        );
        let _ = response_json(response).await;
        assert_eq!(controller.snapshot().in_flight, 0);

        let (pending, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        pending
            .publish_auth_mode_state(pending_sessions_state(false))
            .unwrap();
        let pending_controller = pending.auth_admission_controller();
        let response = app(pending)
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(response.extensions().get::<PreparedAuthority>().is_none());
        assert!(response.extensions().get::<AdmissionLease>().is_none());
        assert_eq!(pending_controller.snapshot().in_flight, 0);
        assert_eq!(response_json(response).await["modeState"], "pendingRestart");
        assert_eq!(pending_controller.snapshot().in_flight, 0);
    }

    #[tokio::test]
    async fn retired_handshake_body_emits_no_frame_after_transition_cut() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        let controller = state.auth_admission_controller();
        let response = app(state)
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let lease = response
            .extensions()
            .get::<AdmissionLease>()
            .expect("stable handshake root")
            .clone();
        assert_eq!(controller.snapshot().in_flight, 1);
        let transition = {
            let controller = controller.clone();
            tokio::task::spawn_blocking(move || {
                controller.begin_transition_for_test(Duration::from_millis(10))
            })
        };
        let error = transition.await.unwrap().unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
        );
        assert!(lease.is_cancelled());
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert!(bytes.is_empty(), "retired response body must be suppressed");
        assert!(controller.snapshot().accepting);
    }

    #[tokio::test]
    async fn auth_session_sessions_resolves_presented_bearer_through_shared_authority() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let state = state
            .with_auth_runtime_facts(settled_sessions_state(), AuthProgramReadiness::item4(true))
            .expect("install sessions mode")
            .with_server_startup_nonce("handshake-sessions")
            .expect("install startup nonce");
        let credential = mint_test_credential(&state, "handshake@example.com").await;
        let token = credential["token"].as_str().unwrap().to_owned();
        let router = app(state);
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .header("x-snapback-auth-client-protocol", "1")
                    .header("x-snapback-auth-invalidation-protocol", "99")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert_eq!(body["activeMode"], "sessions");
        assert_eq!(body["transitionGeneration"], 7);
        assert_eq!(body["clientProtocols"]["authClient"], 1);
        assert_eq!(body["clientProtocols"]["authInvalidation"], Value::Null);
        assert_eq!(body["provider"]["available"], true);
        assert_eq!(body["authority"]["userId"], credential["session"]["userId"]);
        assert_eq!(body["authority"]["sessionId"], credential["session"]["id"]);
        assert_eq!(body["authority"]["isAuthenticated"], true);
        assert_eq!(
            body["availability"]["onlineRequestResponse"]["reason"],
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );

        let malformed = router
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .header(header::AUTHORIZATION, "Bearer malformed")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(malformed.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(malformed).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_REQUIRED"
        );
    }

    #[tokio::test]
    async fn pending_and_quarantined_modes_refuse_ordinary_app_data_but_serve_handshake() {
        for quarantined in [false, true] {
            let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
            let state = state
                .with_auth_runtime_facts(
                    pending_sessions_state(quarantined),
                    AuthProgramReadiness::item4(false),
                )
                .expect("install pending mode");
            let router = app(state);
            let inspect = router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/inspect")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(inspect.status(), StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(
                response_json(inspect).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_MODE_PENDING"
            );

            let handshake = router
                .oneshot(
                    Request::builder()
                        .uri("/auth/session")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(handshake.status(), StatusCode::OK);
            let body = response_json(handshake).await;
            assert_eq!(
                body["modeState"],
                if quarantined {
                    "quarantined"
                } else {
                    "pendingRestart"
                }
            );
            assert_eq!(
                body["quarantineCode"],
                if quarantined {
                    json!("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
                } else {
                    Value::Null
                }
            );
            assert_eq!(
                body["availability"]["onlineRequestResponse"]["reason"],
                "SNAPBACK_AUTH_MODE_PENDING"
            );
        }
    }

    #[tokio::test]
    async fn published_mode_state_is_visible_to_router_clones_before_stage_response() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        let router = app(state.clone());
        state
            .publish_auth_mode_state(pending_sessions_state(false))
            .expect("publish committed pending state");

        let inspect = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/inspect")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(inspect.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(inspect).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_MODE_PENDING"
        );

        let handshake = router
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = response_json(handshake).await;
        assert_eq!(body["transitionGeneration"], 8);
        assert_eq!(body["desiredMode"], "sessions");
    }

    #[tokio::test]
    async fn same_mode_post_commit_publication_failure_cancels_and_closes_admission() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        let controller = state.auth_admission_controller();
        let predecessor = controller.admit().expect("predecessor root");
        let shared = state.snapback.clone();
        state.inject_auth_mode_publication_failure();
        let router = app(state);
        let schema = SchemaManifest {
            schema_version: "snapback.v0".to_owned(),
            app_id: "auth-http-fixture".to_owned(),
            schema_hash: Some("sha256:publication-schema".to_owned()),
            inputs_hash: Some("sha256:publication-inputs".to_owned()),
            ..SchemaManifest::default()
        };
        let functions = FunctionManifest {
            schema_version: "snapback.v0".to_owned(),
            app_id: "auth-http-fixture".to_owned(),
            bundle_hash: Some("sha256:publication-functions".to_owned()),
            inputs_hash: Some("sha256:publication-inputs".to_owned()),
            ..FunctionManifest::default()
        };
        let response = router
            .oneshot(auth_http_request(
                "POST",
                "/app/ensure",
                serde_json::to_vec(&json!({
                    "intent": "provision",
                    "requestedMode": "dev",
                    "schema": schema,
                    "functions": functions,
                }))
                .unwrap(),
                true,
                Some("auth-http-admin"),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "TEST_AUTH_MODE_PUBLICATION_FAILURE"
        );

        let durable = super::with_snapback(&shared, |snapback| {
            snapback
                .auth_database_mut()
                .auth_mode_snapshot()
                .expect("durable committed deployment")
        })
        .await;
        assert!(durable.state.active_deployment.is_some());
        assert!(predecessor.is_cancelled());
        let closed = controller.snapshot();
        assert!(!closed.accepting);
        assert_eq!(
            controller.admit().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
    }

    #[tokio::test]
    async fn sessions_online_and_live_are_fenced_until_item5_then_require_protocol_v1() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let state = state
            .with_auth_runtime_facts(settled_sessions_state(), AuthProgramReadiness::item4(true))
            .expect("install pre-item-5 sessions fixture");
        let router = app(state);
        for uri in ["/inspect", "/live/guessed/subscribe"] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method(if uri.starts_with("/live/") {
                            "POST"
                        } else {
                            "GET"
                        })
                        .uri(uri)
                        .header("x-snapback-auth-client-protocol", "1")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(
                response_json(response).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
            );
        }

        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let item5 = AuthProgramReadiness::new(true, true, true, true, false, false, false);
        let state = state
            .with_auth_runtime_facts(settled_sessions_state(), item5)
            .expect("install item-5 sessions fixture");
        let router = app(state);
        let missing = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/inspect")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::SERVICE_UNAVAILABLE);
        let supported = router
            .oneshot(
                Request::builder()
                    .uri("/inspect")
                    .header("x-snapback-auth-client-protocol", "1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(supported.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn pre_item7_queued_replay_is_refused_before_mutation_lookup() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let item5 = AuthProgramReadiness::new(true, true, true, true, false, false, false);
        let state = state
            .with_auth_runtime_facts(settled_sessions_state(), item5)
            .expect("install item-5 sessions fixture");
        let response = app(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/mutation/does-not-exist")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-snapback-auth-client-protocol", "1")
                    .body(Body::from(r#"{"args":{},"clientMutationId":"queued-1"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = response_json(response).await;
        assert_eq!(
            body["diagnostic"]["code"],
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
        assert_eq!(body["diagnostic"]["details"]["capability"], "queuedReplay");
    }

    #[tokio::test]
    async fn dev_transport_and_prod_profile_fail_closed_but_keep_health_available() {
        let (mut non_loopback, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        Arc::make_mut(&mut non_loopback.server).loopback = false;
        let router = app(non_loopback.clone());
        let refused = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/inspect")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(refused.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            response_json(refused).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_TRANSPORT_INSECURE"
        );
        let health = router
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);

        let allowed = non_loopback.with_insecure_dev_auth_override(true);
        let inspect = app(allowed)
            .oneshot(
                Request::builder()
                    .uri("/inspect")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(inspect.status(), StatusCode::OK);

        let (mut prod, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        Arc::make_mut(&mut prod.server).profile = ServerProfile::Prod;
        let refused = app(prod)
            .oneshot(
                Request::builder()
                    .uri("/inspect")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(refused.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(refused).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
    }

    #[tokio::test]
    async fn public_and_admin_inspect_project_exact_auth_program_readiness() {
        let readiness = AuthProgramReadiness::new(true, true, true, true, true, true, true);
        let expected = serde_json::to_value(&readiness).unwrap();
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        let state = state
            .with_auth_runtime_facts(AuthModeStateRecord::initial_dev(None), readiness)
            .expect("install readiness");
        let router = app(state);
        for (uri, admin) in [
            ("/inspect", None),
            ("/_snapback/api/inspect", Some("auth-http-admin")),
        ] {
            let mut request = Request::builder().uri(uri);
            if let Some(admin) = admin {
                request = request.header("x-snapback-admin-token", admin);
            }
            let response = router
                .clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{uri}");
            let body = response_json(response).await;
            assert_eq!(
                body["capabilityManifest"]["runtimeFacts"]["authProgramReadiness"], expected,
                "{uri}"
            );
        }
    }

    #[tokio::test]
    async fn route_middleware_installs_generation_and_epoch_bound_prepared_authority() {
        async fn echo_authority(Extension(authority): Extension<PreparedAuthority>) -> Json<Value> {
            Json(json!({
                "transitionGeneration": authority.transition_generation(),
                "admissionEpoch": authority.admission_epoch(),
                "userId": authority.projection().user_id(),
                "authenticated": authority.projection().is_authenticated(),
            }))
        }

        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        let mut mode = AuthModeStateRecord::initial_dev(None);
        mode.transition_generation = 4;
        let state = state
            .with_auth_runtime_facts(mode, AuthProgramReadiness::item4(false))
            .expect("install durable mode");
        let admission_epoch = state
            .auth_admission_controller()
            .diagnostic_snapshot()
            .admission_epoch;
        let router = super::router_from_registrations(
            vec![
                super::RegisteredRoute::new(
                    super::app_auth_route("POST", "/query/{name}"),
                    axum::routing::post(echo_authority),
                ),
                super::RegisteredRoute::new(
                    super::app_auth_route("POST", "/mutation/{name}"),
                    axum::routing::post(echo_authority),
                ),
            ],
            state.clone(),
        )
        .with_state(state);
        for uri in ["/query/authority", "/mutation/authority"] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(uri)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(r#"{"args":{},"auth":{"user_id":"user-1"}}"#))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{uri}");
            assert_eq!(
                response_json(response).await,
                json!({
                    "transitionGeneration": 4,
                    "admissionEpoch": admission_epoch,
                    "userId": "user-1",
                    "authenticated": true,
                }),
                "{uri}"
            );
        }
    }

    #[tokio::test]
    async fn session_bearer_is_resolved_for_each_online_invocation_request() {
        async fn echo_authority(Extension(authority): Extension<PreparedAuthority>) -> Json<Value> {
            Json(json!({
                "userId": authority.projection().user_id(),
                "sessionId": authority.projection().session_id(),
                "authenticated": authority.projection().is_authenticated(),
            }))
        }

        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let item5 = AuthProgramReadiness::new(true, true, true, true, false, false, false);
        let state = state
            .with_auth_runtime_facts(settled_sessions_state(), item5)
            .expect("install item-5 sessions fixture");
        let credential = mint_test_credential(&state, "query@example.com").await;
        let token = credential["token"].as_str().unwrap();
        let router = super::router_from_registrations(
            vec![super::RegisteredRoute::new(
                super::app_auth_route("POST", "/query/{name}"),
                axum::routing::post(echo_authority),
            )],
            state.clone(),
        )
        .with_state(state);
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/query/authority")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .header("x-snapback-auth-client-protocol", "1")
                    .body(Body::from(r#"{"args":{}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response_json(response).await,
            json!({
                "userId": credential["session"]["userId"],
                "sessionId": credential["session"]["id"],
                "authenticated": true,
            })
        );
    }

    async fn request_captured_challenge(router: &axum::Router, email: &str) -> String {
        let response = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/auth/request-code",
                serde_json::to_vec(&serde_json::json!({"email": email})).unwrap(),
                true,
                None,
                None,
            ))
            .await
            .expect("request capture challenge");
        assert_eq!(response.status(), StatusCode::OK);
        response_json(response).await["challengeId"]
            .as_str()
            .unwrap()
            .to_owned()
    }

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

    /// @ref LLP 0054#routes-operations-and-dtos — the HTTP projection enforces the
    /// exact 4 KiB ceiling and collapses every closed-DTO parse failure to the
    /// non-reflective auth diagnostic.
    #[tokio::test]
    async fn auth_http_json_is_closed_and_bounded_at_exactly_four_kibibytes() {
        let (router, _) = auth_http_fixture(PolicyAuthMode::Sessions);
        let mut exact = br#"{"email":"four-kib@example.com"}"#.to_vec();
        exact.resize(super::AUTH_REQUEST_BODY_LIMIT, b' ');
        let accepted = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/auth/request-code",
                exact.clone(),
                true,
                None,
                None,
            ))
            .await
            .expect("exact-limit provider request");
        assert_eq!(accepted.status(), StatusCode::OK);
        assert_eq!(
            accepted.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );

        let mut oversized = exact;
        oversized.push(b' ');
        let invalid_bodies = [
            (oversized, true),
            (br#"{"email":"a@example.com","extra":true}"#.to_vec(), true),
            (
                br#"{"email":"a@example.com","email":"b@example.com"}"#.to_vec(),
                true,
            ),
            (br#"{"email":}"#.to_vec(), true),
            (br#"{"email":"a@example.com"}"#.to_vec(), false),
        ];
        for (body, content_type) in invalid_bodies {
            let response = router
                .clone()
                .oneshot(auth_http_request(
                    "POST",
                    "/auth/request-code",
                    body,
                    content_type,
                    None,
                    None,
                ))
                .await
                .expect("invalid provider request");
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert_eq!(
                response.headers()[header::CACHE_CONTROL],
                "no-store, private"
            );
            let body = response_json(response).await;
            assert_eq!(body["diagnostic"]["code"], "SNAPBACK_AUTH_REQUEST_INVALID");
            assert_eq!(
                body["diagnostic"]["details"],
                serde_json::json!({}),
                "parser internals must not be reflected"
            );
        }
    }

    /// @ref LLP 0054#email-code-provider — exercise the real request transaction,
    /// exact gated mailbox projection, and known/unknown two-pass exchange
    /// paths through the registered router.
    #[tokio::test]
    async fn auth_http_request_mailbox_exchange_flow_and_carriers_are_exact() {
        let (router, impersonation) = auth_http_fixture(PolicyAuthMode::Sessions);
        let request_code = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/auth/request-code",
                serde_json::to_vec(&serde_json::json!({"email": "Person@Example.com"})).unwrap(),
                true,
                None,
                None,
            ))
            .await
            .expect("request verification code");
        assert_eq!(request_code.status(), StatusCode::OK);
        assert_eq!(
            request_code.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let requested = response_json(request_code).await;
        assert_eq!(
            requested
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["challengeId".to_owned(), "expiresAt".to_owned()])
        );
        let challenge_id = requested["challengeId"].as_str().unwrap().to_owned();
        let mailbox_uri = format!("/_snapback/api/auth/mailbox?challengeId={challenge_id}");

        let effect_without_admin = router
            .clone()
            .oneshot(auth_http_request(
                "GET",
                &mailbox_uri,
                Vec::new(),
                false,
                None,
                Some(&impersonation),
            ))
            .await
            .expect("effect-only mailbox request");
        assert_ne!(effect_without_admin.status(), StatusCode::OK);
        assert_ne!(
            response_json(effect_without_admin).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND",
            "the effect carrier cannot substitute for AdminWrite"
        );

        for presented_effect in [None, Some("sbs_not-an-impersonation-capability")] {
            let admin_without_effect = router
                .clone()
                .oneshot(auth_http_request(
                    "GET",
                    &mailbox_uri,
                    Vec::new(),
                    false,
                    Some("auth-http-admin"),
                    presented_effect,
                ))
                .await
                .expect("admin-only mailbox request");
            assert_eq!(admin_without_effect.status(), StatusCode::FORBIDDEN);
            assert_eq!(
                response_json(admin_without_effect).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_IMPERSONATION_REQUIRED"
            );
        }

        let mailbox = router
            .clone()
            .oneshot(auth_http_request(
                "GET",
                &mailbox_uri,
                Vec::new(),
                false,
                Some("auth-http-admin"),
                Some(&impersonation),
            ))
            .await
            .expect("fully authorized mailbox request");
        assert_eq!(mailbox.status(), StatusCode::OK);
        assert_eq!(
            mailbox.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let mailbox = response_json(mailbox).await;
        assert_eq!(mailbox["challengeId"], challenge_id);
        assert_eq!(mailbox["canonicalAddress"], "person@example.com");
        let code = mailbox["code"].as_str().unwrap().to_owned();

        let wrong_code = if code == "000000" { "999999" } else { "000000" };
        let rejected_exchange = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/auth/exchange",
                serde_json::to_vec(&serde_json::json!({
                    "challengeId": challenge_id,
                    "code": wrong_code,
                }))
                .unwrap(),
                true,
                None,
                None,
            ))
            .await
            .expect("reject incorrect verification code");
        assert_eq!(rejected_exchange.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(rejected_exchange).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_CODE_INVALID"
        );

        let exchange = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/auth/exchange",
                serde_json::to_vec(&serde_json::json!({
                    "challengeId": challenge_id,
                    "code": code,
                }))
                .unwrap(),
                true,
                None,
                None,
            ))
            .await
            .expect("exchange verification code");
        assert_eq!(exchange.status(), StatusCode::OK);
        assert_eq!(
            exchange.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let credential = response_json(exchange).await;
        assert_eq!(credential["tokenType"], "Bearer");
        assert!(credential["token"].as_str().unwrap().starts_with("sbs_"));
        assert_eq!(credential["session"]["provider"], "email-code");

        let consumed_mailbox = router
            .clone()
            .oneshot(auth_http_request(
                "GET",
                &mailbox_uri,
                Vec::new(),
                false,
                Some("auth-http-admin"),
                Some(&impersonation),
            ))
            .await
            .expect("consumed mailbox request");
        assert_eq!(consumed_mailbox.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response_json(consumed_mailbox).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
        );

        let unknown = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/auth/exchange",
                serde_json::to_vec(&serde_json::json!({
                    "challengeId": "sbc_AAAAAAAAAAAAAAAAAAAAAA",
                    "code": "000000",
                }))
                .unwrap(),
                true,
                None,
                None,
            ))
            .await
            .expect("unknown exchange request");
        assert_eq!(unknown.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(unknown).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_CODE_INVALID"
        );
    }

    /// @ref LLP 0054#catalog-write-and-lifecycle-rules — the dedicated reset holds
    /// exclusive maintenance, clears capture plaintext only after commit, and
    /// retains both catalog and keyring (proved by issuing again afterward).
    #[tokio::test]
    async fn direct_app_reset_clears_mailbox_on_commit_and_preserves_it_on_rejection() {
        let (router, _, provider) = auth_http_fixture_with_provider(PolicyAuthMode::Sessions);
        let committed_challenge =
            request_captured_challenge(&router, "direct-commit@example.com").await;
        let committed = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/app/reset",
                b"{}".to_vec(),
                true,
                Some("auth-http-admin"),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(committed.status(), StatusCode::OK);
        assert_eq!(
            provider
                .mailbox_entry(&committed_challenge)
                .await
                .unwrap_err()
                .diagnostic()
                .code,
            "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
        );

        let rejected_challenge =
            request_captured_challenge(&router, "direct-reject@example.com").await;
        let rejected = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/app/reset",
                serde_json::to_vec(&serde_json::json!({
                    "seed": {"tables": {"missing_table": [{}]}}
                }))
                .unwrap(),
                true,
                Some("auth-http-admin"),
                None,
            ))
            .await
            .unwrap();
        assert_ne!(rejected.status(), StatusCode::OK);
        assert_eq!(
            provider
                .mailbox_entry(&rejected_challenge)
                .await
                .expect("rejected reset preserves capture plaintext")
                .challenge_id,
            rejected_challenge
        );
    }

    /// @ref LLP 0054#concurrency-locks-and-linearization — the multiplexed reset
    /// projection observes the same post-commit mailbox boundary as its direct
    /// route; a negative host-op envelope is not a committed reset.
    #[tokio::test]
    async fn host_ops_app_reset_clears_mailbox_only_for_a_success_envelope() {
        let (router, _, provider) = auth_http_fixture_with_provider(PolicyAuthMode::Sessions);
        let committed_challenge =
            request_captured_challenge(&router, "host-commit@example.com").await;
        let committed = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                serde_json::to_vec(&serde_json::json!({"operation": "app.reset"})).unwrap(),
                true,
                Some("auth-http-admin"),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(committed.status(), StatusCode::OK);
        assert_eq!(response_json(committed).await["ok"], true);
        assert_eq!(
            provider
                .mailbox_entry(&committed_challenge)
                .await
                .unwrap_err()
                .diagnostic()
                .code,
            "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
        );

        let rejected_challenge =
            request_captured_challenge(&router, "host-reject@example.com").await;
        let rejected = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                serde_json::to_vec(&serde_json::json!({
                    "operation": "app.reset",
                    "seed": {"tables": {"missing_table": [{}]}}
                }))
                .unwrap(),
                true,
                Some("auth-http-admin"),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::OK);
        assert_eq!(response_json(rejected).await["ok"], false);
        assert_eq!(
            provider
                .mailbox_entry(&rejected_challenge)
                .await
                .expect("negative host-op envelope preserves capture plaintext")
                .challenge_id,
            rejected_challenge
        );
    }

    #[tokio::test]
    async fn unknown_host_operation_middleware_does_not_echo_caller_bytes() {
        const SENTINEL: &str = "sbs_HTTP_DIAGNOSTIC_SMUGGLING_SENTINEL";
        let (router, _) = auth_http_fixture(PolicyAuthMode::Sessions);
        let response = router
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                serde_json::to_vec(&serde_json::json!({ "operation": SENTINEL })).unwrap(),
                true,
                Some("auth-http-admin"),
                None,
            ))
            .await
            .unwrap();
        let payload = response_json(response).await;
        let serialized = serde_json::to_string(&payload).unwrap();
        assert_eq!(payload["diagnostic"]["code"], "SNAPBACK_HOST_OP_UNKNOWN");
        assert_eq!(
            payload["diagnostic"]["details"]["operation"],
            "unrecognized"
        );
        assert!(!serialized.contains(SENTINEL), "{serialized}");
    }

    #[tokio::test]
    async fn rejected_host_ops_reset_does_not_wait_for_exclusive_auth_maintenance() {
        let (router, _, provider) = auth_http_fixture_with_provider(PolicyAuthMode::Sessions);
        let admission = provider.admit().await;
        let response = tokio::time::timeout(
            Duration::from_millis(100),
            router.oneshot(auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                serde_json::to_vec(&serde_json::json!({"operation": "app.reset"})).unwrap(),
                true,
                None,
                None,
            )),
        )
        .await
        .expect("authorization rejects without waiting for exclusive maintenance")
        .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        drop(admission);
    }

    #[tokio::test]
    async fn public_health_revalidates_provider_readiness_without_leaking_keyring_details() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("health.sqlite3");
        let mut snapback = LocalSnapback::open(&database_path).unwrap();
        let keyring = Arc::new(AuthKeyringStore::file_for_database(&database_path));
        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            super::now_millis(),
            &OsRandom,
        )
        .unwrap();
        let provider = Arc::new(AuthProvider::new(AuthProviderProfile::Test, keyring).unwrap());
        let keyring_path = AuthKeyringStore::keyring_path(&database_path);
        let retained = std::fs::read(&keyring_path).unwrap();
        let router = app(AppState::from_snapback(snapback, ServerContext::detached())
            .with_auth_provider(provider));

        let available = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response_json(available).await["authProvider"], "available");

        std::fs::remove_file(&keyring_path).unwrap();
        let unavailable = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let unavailable = response_json(unavailable).await;
        assert_eq!(unavailable["authProvider"], "unavailable");
        let serialized = serde_json::to_string(&unavailable).unwrap();
        assert!(!serialized.contains("keyring"));
        assert!(!serialized.contains(database_path.to_string_lossy().as_ref()));

        crate::secure_file::write_new_owner_only(&keyring_path, &retained).unwrap();
        let repaired = router
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response_json(repaired).await["authProvider"], "available");
    }

    /// @ref LLP 0054#rotation — direct handler acceptance pins the item-3 bearer,
    /// body, status, and credential projection while item 4 deliberately
    /// keeps registered SessionAuth routes centrally fenced.
    #[tokio::test]
    async fn auth_refresh_and_logout_handlers_enforce_exact_carriers_and_statuses() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let initial = mint_test_credential(&state, "refresh@example.com").await;
        let initial_token = initial["token"].as_str().unwrap().to_owned();

        let refreshed = super::auth_refresh(
            State(state.clone()),
            test_route_admission(&state),
            auth_provider_headers(Some(&initial_token)),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect("refresh current bearer");
        let refreshed = serde_json::to_value(refreshed.0).expect("serialize refresh response");
        assert_eq!(
            refreshed
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "refreshAfter".to_owned(),
                "session".to_owned(),
                "token".to_owned(),
                "tokenType".to_owned(),
            ])
        );
        assert_eq!(refreshed["tokenType"], "Bearer");
        let current_token = refreshed["token"].as_str().unwrap().to_owned();
        assert_ne!(current_token, initial_token);

        let superseded = super::auth_refresh(
            State(state.clone()),
            test_route_admission(&state),
            auth_provider_headers(Some(&initial_token)),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect_err("in-grace predecessor cannot rotate twice");
        assert_eq!(
            superseded.0.diagnostic.code,
            "SNAPBACK_AUTH_REFRESH_SUPERSEDED"
        );

        let mut duplicate = auth_provider_headers(None);
        duplicate.append(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {current_token}")).unwrap(),
        );
        duplicate.append(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {current_token}")).unwrap(),
        );
        for headers in [
            auth_provider_headers(None),
            {
                let mut headers = auth_provider_headers(None);
                headers.insert(
                    header::AUTHORIZATION,
                    HeaderValue::from_static("Basic not-a-bearer"),
                );
                headers
            },
            duplicate,
        ] {
            let error = super::auth_refresh(
                State(state.clone()),
                test_route_admission(&state),
                headers,
                Ok(Bytes::from_static(br#"{}"#)),
            )
            .await
            .expect_err("only one exact bearer header is accepted");
            assert_eq!(error.0.diagnostic.code, "SNAPBACK_AUTH_REQUIRED");
        }

        let body_alias = super::auth_logout(
            State(state.clone()),
            test_route_admission(&state),
            auth_provider_headers(Some(&current_token)),
            Ok(Bytes::from_static(br#"{"token":"body-alias"}"#)),
        )
        .await
        .expect_err("logout body is the exact empty object");
        assert_eq!(
            body_alias.0.diagnostic.code,
            "SNAPBACK_AUTH_REQUEST_INVALID"
        );

        assert_eq!(
            super::auth_logout(
                State(state.clone()),
                test_route_admission(&state),
                auth_provider_headers(Some(&current_token)),
                Ok(Bytes::from_static(br#"{}"#)),
            )
            .await
            .expect("logout current bearer"),
            StatusCode::NO_CONTENT
        );
        let repeated = super::auth_logout(
            State(state.clone()),
            test_route_admission(&state),
            auth_provider_headers(Some(&current_token)),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect_err("revoked session cannot log out twice");
        assert_eq!(repeated.0.diagnostic.code, "SNAPBACK_AUTH_SESSION_EXPIRED");
    }

    /// @ref LLP 0054#logout-ordinary-supersession-and-family-alarm — every bearer class publishes the
    /// same delayed response, while only an attributable tombstone revokes.
    #[tokio::test]
    async fn auth_family_alarm_is_delayed_opaque_and_revoke_only() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let initial = mint_test_credential(&state, "alarm@example.com").await;
        let predecessor = initial["token"].as_str().unwrap().to_owned();
        let unknown = SessionBearer::generate(&OsRandom)
            .unwrap()
            .expose_secret()
            .to_owned();

        for bearer in [None, Some("malformed"), Some(unknown.as_str())] {
            let started = Instant::now();
            let (status, response) = super::auth_family_alarm(
                State(state.clone()),
                test_route_admission(&state),
                auth_provider_headers(bearer),
                Ok(Bytes::from_static(br#"{}"#)),
            )
            .await
            .expect("opaque alarm response");
            assert_eq!(status, StatusCode::ACCEPTED);
            assert!(response.0.accepted);
            assert!(started.elapsed() >= Duration::from_millis(20));
        }

        // A current bearer is an opaque no-op and remains refreshable.
        let (status, response) = super::auth_family_alarm(
            State(state.clone()),
            test_route_admission(&state),
            auth_provider_headers(Some(&predecessor)),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect("current alarm response");
        assert_eq!((status, response.0.accepted), (StatusCode::ACCEPTED, true));
        let rotated = super::auth_refresh(
            State(state.clone()),
            test_route_admission(&state),
            auth_provider_headers(Some(&predecessor)),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect("current bearer survived alarm");
        let rotated = serde_json::to_value(rotated.0).unwrap();
        let successor = rotated["token"].as_str().unwrap().to_owned();

        // The predecessor is now an attributable tombstone. Its response is
        // unchanged, but the successor's family is revoked before publish.
        for _ in 0..2 {
            let started = Instant::now();
            let (status, response) = super::auth_family_alarm(
                State(state.clone()),
                test_route_admission(&state),
                auth_provider_headers(Some(&predecessor)),
                Ok(Bytes::from_static(br#"{}"#)),
            )
            .await
            .expect("tombstone/already-revoked alarm response");
            assert_eq!((status, response.0.accepted), (StatusCode::ACCEPTED, true));
            assert!(started.elapsed() >= Duration::from_millis(20));
        }
        let revoked = super::auth_logout(
            State(state.clone()),
            test_route_admission(&state),
            auth_provider_headers(Some(&successor)),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect_err("tombstone alarm revoked the successor family");
        assert_eq!(revoked.0.diagnostic.code, "SNAPBACK_AUTH_SESSION_EXPIRED");

        let invalid_body = super::auth_family_alarm(
            State(state.clone()),
            test_route_admission(&state),
            auth_provider_headers(None),
            Ok(Bytes::from_static(br#"{"bearer":"body-alias"}"#)),
        )
        .await
        .expect_err("family alarm body is closed");
        assert_eq!(
            invalid_body.0.diagnostic.code,
            "SNAPBACK_AUTH_REQUEST_INVALID"
        );
    }

    /// @ref LLP 0054#routes-operations-and-dtos — active dev refusal precedes the
    /// installed provider, bearer, and even an over-limit malformed body.
    #[tokio::test]
    async fn auth_http_dev_refusal_precedes_provider_and_body_handling() {
        let (router, _) = auth_http_fixture(PolicyAuthMode::Dev);
        for uri in ["/auth/request-code", "/auth/family-alarm"] {
            let response = router
                .clone()
                .oneshot(auth_http_request(
                    "POST",
                    uri,
                    vec![b'x'; super::AUTH_REQUEST_BODY_LIMIT + 1],
                    false,
                    None,
                    None,
                ))
                .await
                .expect("dev-mode provider refusal");
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
            assert_eq!(
                response.headers()[header::CACHE_CONTROL],
                "no-store, private"
            );
            assert_eq!(
                response_json(response).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_MODE_DEV"
            );
        }
    }

    #[tokio::test]
    async fn registered_session_auth_routes_remain_item_four_fenced() {
        let (router, _) = auth_http_fixture(PolicyAuthMode::Sessions);
        for uri in ["/auth/refresh", "/auth/logout"] {
            let response = router
                .clone()
                .oneshot(auth_http_request(
                    "POST",
                    uri,
                    br#"{}"#.to_vec(),
                    true,
                    None,
                    None,
                ))
                .await
                .expect("registered SessionAuth route");
            assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(
                response_json(response).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
            );
        }
    }

    /// @ref LLP 0054#host-operation-dtos — mint projects the exact credential as a
    /// named host-ops datum and records its administrative issue provenance;
    /// active Dev keeps the operation unavailable until item 4 activates
    /// Sessions.
    #[tokio::test]
    async fn auth_mint_host_op_has_exact_projection_and_sessions_only_activation() {
        let body = serde_json::to_vec(&serde_json::json!({
            "operation": "auth.mintSession",
            "requestId": "hop_auth_mint_exact",
            "args": { "email": "operator@example.com" },
        }))
        .unwrap();

        let (sessions, impersonation) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let sessions = sessions
            .with_auth_runtime_facts(settled_sessions_state(), AuthProgramReadiness::item4(true))
            .expect("install settled sessions mint posture");
        let sessions = app(sessions);
        let response = sessions
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                body.clone(),
                true,
                Some("auth-http-admin"),
                Some(&impersonation),
            ))
            .await
            .expect("mint session host operation");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let response = response_json(response).await;
        assert_eq!(response["resultKind"], "hostOpsResult");
        assert_eq!(response["requestId"], "hop_auth_mint_exact");
        assert_eq!(response["operation"], "auth.mintSession");
        assert_eq!(response["ok"], true);
        assert_eq!(response["authority"]["mode"], "devAdminBypass");
        assert_eq!(response["authority"]["reason"], "issuedBy: admin");
        assert_eq!(
            response["data"]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "refreshAfter".to_owned(),
                "session".to_owned(),
                "token".to_owned(),
                "tokenType".to_owned(),
            ])
        );
        assert_eq!(response["data"]["tokenType"], "Bearer");
        assert!(
            response["data"]["token"]
                .as_str()
                .unwrap()
                .starts_with("sbs_")
        );

        for invalid in [
            serde_json::json!({
                "operation": "auth.mintSession",
                "args": { "email": "operator@example.com", "role": "admin" },
            }),
            serde_json::json!({
                "operation": "auth.mintSession",
                "args": { "email": "operator@example.com" },
                "userId": "credential-substitution",
            }),
        ] {
            let invalid = sessions
                .clone()
                .oneshot(auth_http_request(
                    "POST",
                    "/_snapback/api/host-ops",
                    serde_json::to_vec(&invalid).unwrap(),
                    true,
                    Some("auth-http-admin"),
                    Some(&impersonation),
                ))
                .await
                .expect("closed mint args");
            assert_eq!(invalid.status(), StatusCode::OK);
            let invalid = response_json(invalid).await;
            assert_eq!(invalid["ok"], false);
            assert_eq!(
                invalid["diagnostics"][0]["code"],
                "SNAPBACK_AUTH_REQUEST_INVALID"
            );
        }

        let (injected_sessions_policy, injected_impersonation) =
            auth_http_fixture(PolicyAuthMode::Sessions);
        let unavailable = injected_sessions_policy
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                body.clone(),
                true,
                Some("auth-http-admin"),
                Some(&injected_impersonation),
            ))
            .await
            .expect("policy injection cannot replace durable sessions state");
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(unavailable).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );

        let (dev, dev_impersonation) = auth_http_fixture(PolicyAuthMode::Dev);
        let unavailable = dev
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                body,
                true,
                Some("auth-http-admin"),
                Some(&dev_impersonation),
            ))
            .await
            .expect("dev mint activation fence");
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(unavailable).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
    }

    #[tokio::test]
    async fn auth_host_handler_backstop_requires_both_authority_axes() {
        let (state, impersonation) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let request = || {
            serde_json::from_value::<crate::host_ops::HostOpsRequest>(serde_json::json!({
                "operation": "auth.mintSession",
                "args": { "email": "backstop@example.com" },
            }))
            .unwrap()
        };
        let mut admin_headers = HeaderMap::new();
        admin_headers.insert(
            "x-snapback-admin-token",
            HeaderValue::from_static("auth-http-admin"),
        );
        let route_admission = super::test_route_admission(&state).0;
        let missing_effect = super::execute_auth_host_operation(
            &state,
            &admin_headers,
            None,
            &route_admission,
            request(),
            None,
        )
        .await
        .expect_err("AdminWrite cannot substitute for impersonation capability");
        assert_eq!(
            missing_effect.0.diagnostic.code,
            "SNAPBACK_AUTH_IMPERSONATION_REQUIRED"
        );

        let verified = state
            .impersonation_capabilities
            .as_ref()
            .unwrap()
            .authorize(Some(&impersonation))
            .expect("verify test impersonation capability");
        let missing_admin = super::execute_auth_host_operation(
            &state,
            &HeaderMap::new(),
            Some(&verified),
            &route_admission,
            request(),
            None,
        )
        .await
        .expect_err("impersonation capability cannot substitute for AdminWrite");
        assert_eq!(
            missing_admin.0.diagnostic.code,
            "SNAPBACK_ADMIN_TOKEN_REQUIRED"
        );
    }

    /// @ref LLP 0054#host-operation-dtos — ordinary dormant collisions use the
    /// shared rescue core and exact six-field metadata projection; unlike the
    /// stored-manifest recovery router, ordinary service remains live.
    #[tokio::test]
    async fn auth_rescue_host_op_returns_pinned_metadata_and_keeps_service_live() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("rescue.sqlite3");
        {
            let connection = rusqlite::Connection::open(&database_path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE _auth_legacy_first(id TEXT PRIMARY KEY, value TEXT);
                     INSERT INTO _auth_legacy_first(id, value) VALUES('one', 'first');
                     CREATE INDEX legacy_first_value ON _auth_legacy_first(value);
                     CREATE TABLE _auth_legacy_second(id TEXT PRIMARY KEY, value TEXT);
                     INSERT INTO _auth_legacy_second(id, value) VALUES('two', 'second');",
                )
                .unwrap();
        }
        let snapback = LocalSnapback::open(&database_path).expect("open dormant collision");
        let provider = Arc::new(
            AuthProvider::new(
                AuthProviderProfile::Test,
                Arc::new(AuthKeyringStore::in_memory()),
            )
            .expect("construct rescue provider"),
        );
        let (registry, operator) =
            ImpersonationCapabilityRegistry::generate("auth-rescue-fixture".to_owned(), &OsRandom)
                .unwrap();
        let mut impersonation = None;
        operator
            .emit_once_to_terminal(|value| {
                impersonation = Some(value.to_owned());
                Ok(())
            })
            .unwrap();
        let impersonation = impersonation.unwrap();
        let mut context = ServerContext::detached();
        context.profile = ServerProfile::Test;
        context.admin_token = Some("auth-rescue-admin".to_owned());
        let state = AppState::from_snapback(snapback, context)
            .with_policy_auth_mode(PolicyAuthMode::Dev)
            .with_impersonation_capabilities(registry)
            .with_auth_provider(provider);
        let router = app(state);

        let rescue = |source: &str, target: &str| {
            auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                serde_json::to_vec(&serde_json::json!({
                    "operation": "auth.rescueCollidingTable",
                    "args": { "sourceTable": source, "targetTable": target },
                }))
                .unwrap(),
                true,
                Some("auth-rescue-admin"),
                Some(&impersonation),
            )
        };
        let first = router
            .clone()
            .oneshot(rescue("_auth_legacy_first", "legacy_auth_first"))
            .await
            .expect("first collision rescue");
        assert_eq!(first.status(), StatusCode::OK);
        let first = response_json(first).await;
        assert_eq!(first["ok"], true, "{first}");
        assert_eq!(
            first["data"]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "catalogCollisionCleared".to_owned(),
                "copiedExplicitIndexCount".to_owned(),
                "copiedRowCount".to_owned(),
                "manifestUpdated".to_owned(),
                "source".to_owned(),
                "target".to_owned(),
            ])
        );
        assert_eq!(first["data"]["source"], "_auth_legacy_first");
        assert_eq!(first["data"]["target"], "legacy_auth_first");
        assert_eq!(first["data"]["copiedRowCount"], 1);
        assert_eq!(first["data"]["copiedExplicitIndexCount"], 1);

        let inspect = router
            .clone()
            .oneshot(auth_http_request(
                "GET",
                "/inspect",
                Vec::new(),
                false,
                None,
                None,
            ))
            .await
            .expect("ordinary app service remains live");
        assert_eq!(inspect.status(), StatusCode::OK);
        let health = router
            .clone()
            .oneshot(auth_http_request(
                "GET",
                "/health",
                Vec::new(),
                false,
                None,
                None,
            ))
            .await
            .expect("health remains available");
        assert_eq!(health.status(), StatusCode::OK);

        let second = router
            .oneshot(rescue("_auth_legacy_second", "legacy_auth_second"))
            .await
            .expect("repeated collision rescue");
        assert_eq!(second.status(), StatusCode::OK);
        let second = response_json(second).await;
        assert_eq!(second["ok"], true, "{second}");
        assert!(second["data"].get("restartRequired").is_none());
    }

    #[test]
    fn connection_credential_debug_is_redacted() {
        const SENTINEL: &str = "CONNECTION_CREDENTIAL_SENTINEL_MUST_NOT_ESCAPE";
        let grant = ConnectionGrant {
            connection_id: "conn_debug".to_owned(),
            connection_token: SENTINEL.to_owned(),
        };
        let grant_debug = format!("{grant:?}");
        assert!(!grant_debug.contains(SENTINEL), "{grant_debug}");
        assert!(grant_debug.contains("[REDACTED]"), "{grant_debug}");

        let open = OpenConnectionRequest {
            connection_id: Some("conn_debug".to_owned()),
            previous_token: Some(SENTINEL.to_owned()),
        };
        let open_debug = format!("{open:?}");
        assert!(!open_debug.contains(SENTINEL), "{open_debug}");
        assert!(open_debug.contains("[REDACTED]"), "{open_debug}");

        let query = ConnectionTokenQuery {
            connection_token: Some(SENTINEL.to_owned()),
        };
        let query_debug = format!("{query:?}");
        assert!(!query_debug.contains(SENTINEL), "{query_debug}");
        assert!(query_debug.contains("[REDACTED]"), "{query_debug}");
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
            "SNAPBACK_",
            "diagnostic-code prefix validated by the durable auth-mode parser",
        ),
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
            "SNAPBACK_ADMIN_SECRET_READ_ROOT_PATH_INVALID",
            "CLI-local readiness path validation code; never emitted as an HTTP diagnostic",
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
            "SNAPBACK_SESSIONS_MANIFEST_RELOCATED",
            "embedded relocation poison marker, not an emitted diagnostic code",
        ),
        (
            "SNAPBACK_SESSIONS_SCHEMA_VERSION",
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
        "SNAPBACK_ADMIN_SECRET_READ_LEASE_INVALID",
        "SNAPBACK_ARG_MISSING",
        "SNAPBACK_AUTHORITY_INDEPENDENT_INVALID",
        "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED",
        "SNAPBACK_AUTH_REQUEST_INVALID",
        "SNAPBACK_AUTH_RESCUE_INVALID",
        "SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED",
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
        "SNAPBACK_CRON_AUTH_REQUIREMENT_INVALID",
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
        "SNAPBACK_ADMIN_SECRET_READ_REQUIRED",
        "SNAPBACK_ADMIN_TOKEN_REQUIRED",
        "SNAPBACK_AUTH_CODE_INVALID",
        "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED",
        "SNAPBACK_AUTH_REQUIRED",
        "SNAPBACK_AUTH_SESSION_EXPIRED",
        "SNAPBACK_CONNECTION_TOKEN_REQUIRED",
    ];

    const FORBIDDEN_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ADMIN_DISABLED",
        "SNAPBACK_ADMIN_SECRET_READ_MINT_DENIED",
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID",
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_REQUIRED",
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_REPLAYED",
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_STALE",
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_STARTUP_MISMATCH",
        "SNAPBACK_ADMIN_SECRET_READ_SCOPE_DENIED",
        "SNAPBACK_AUTH_CODE_LOCKED",
        "SNAPBACK_AUTH_IMPERSONATION_REQUIRED",
        "SNAPBACK_CONNECTION_TOKEN_INVALID",
        "SNAPBACK_LIVE_RESUME_OWNERSHIP",
        "SNAPBACK_PROFILE_FORBIDS",
    ];

    const NOT_FOUND_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND",
        "SNAPBACK_AUTH_MODE_DEV",
        "SNAPBACK_UNKNOWN_CRON_JOB",
        "SNAPBACK_UNKNOWN_FIELD",
        "SNAPBACK_UNKNOWN_FUNCTION",
        "SNAPBACK_UNKNOWN_SUBSCRIPTION",
        "SNAPBACK_UNKNOWN_TABLE",
    ];

    const CONFLICT_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ACTION_GENERATION_CONFLICT",
        "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION",
        "SNAPBACK_AUTH_REFRESH_SUPERSEDED",
        "SNAPBACK_AUTH_TABLE_COLLISION",
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
        "SNAPBACK_ADMIN_SECRET_READ_BUDGET_EXHAUSTED",
        "SNAPBACK_ADMIN_SECRET_READ_LEASE_CAPACITY_EXCEEDED",
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_CAPACITY_EXCEEDED",
        "SNAPBACK_AUTH_THROTTLED",
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
        "SNAPBACK_AUTH_CATALOG_CORRUPT",
        "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED",
        "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
        "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
        "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT",
        "SNAPBACK_AUTH_MODE_PENDING",
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
        "SNAPBACK_AUTH_PROJECTION_CORRUPT",
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
        "SNAPBACK_CAPABILITY_UNSUPPORTED",
        "SNAPBACK_AUTH_REVOCATION_UNCERTAIN",
        "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT",
        "SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING",
        "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE",
        "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACT_MISSING",
        "SNAPBACK_CAPABILITY_MINIFLARE_MISSING",
        "SNAPBACK_CAPABILITY_WORKERD_MISSING",
        "SNAPBACK_CRON_DISPATCH_CAPACITY_EXCEEDED",
        "SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED",
        "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL",
        "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED",
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
        "SNAPBACK_ADMIN_SECRET_READ_SERIALIZATION_FAILED",
        "SNAPBACK_ADMIN_SECRET_READ_PROVENANCE_UNAVAILABLE",
        // Local backup/restore validation is a CLI/operator diagnostic. It is
        // deliberately not a request-path 4xx; if it ever crosses ApiError,
        // the fail-safe HTTP projection remains 500.
        "SNAPBACK_AUTH_BACKUP_INVALID",
        "SNAPBACK_AUTH_MODE_DOWNGRADE",
        "SNAPBACK_AUTH_MODE_STATE_CORRUPT",
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH",
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED",
        "SNAPBACK_AUTH_TRANSPORT_INSECURE",
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
        "SNAPBACK_INVOCATION_FUNCTION_MISMATCH",
        "SNAPBACK_INVOCATION_SOURCE_INVALID",
        "SNAPBACK_JSON_PARSE_FAILED",
        "SNAPBACK_JSON_SERIALIZE_FAILED",
        "SNAPBACK_LIVE_DELTA_SERIALIZE_FAILED",
        "SNAPBACK_LIVE_UPDATE_SERIALIZE_FAILED",
        "SNAPBACK_READY_FILE_PATH_COLLISION",
        "SNAPBACK_RUNTIME_CREATE_FAILED",
        "SNAPBACK_SCHEMA_PHYSICAL_COLUMN_INVALID",
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
            StagedAction::InLock(_) => panic!("Ibex action must detach"),
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
            authority: action.invocation.authority().clone(),
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
                                | RoutePolicy::SessionAuth
                        ),
                        "app-data route carries a system-admin policy: {}",
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
        let response: serde_json::Value = serde_json::from_str(&super::handle_live_socket_text(
            &ephemeral,
            "conn",
            &frame,
            super::PolicyAuthMode::Dev,
        ))
        .expect("typed socket error");
        assert_eq!(
            response["diagnostic"]["code"],
            "SNAPBACK_WEBSOCKET_MESSAGE_TOO_LARGE"
        );
    }
}
