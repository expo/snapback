use crate::admin::{AppState, ServerContext, ServerProfile};
use crate::admin_secret_read::{
    SECRET_READ_LEASE_HEADER, SecretReadLeaseRegistry, SecretReadMintEnvelope, SecretReadScope,
};
use crate::auth::admission::{AdmissionLease, AuthAdmissionController, ModeCommitFailure};
use crate::auth::coordinator::{
    AuthCoordinator, AuthFinish, CommittedAuthOutcome, CommittedAuthResponseClass,
    CommittedRevocationTarget, ConnectionBearerResolution, ConnectionSessionThrottleKey,
    IssuanceFinish, RevocationFinish, RotationFinish,
};
use crate::auth::crypto::{
    AgentCredential, CredentialClass, PairingCode, ScopedToken, SessionBearer,
    classify_credential, dispatch_credential_class,
};
use crate::auth::descriptor::descriptor_for_resolved_authority;
use crate::auth::handshake::{
    AUTH_PROTOCOL_V1, AuthClientProtocolOffers, AuthSessionAuthority, AuthSessionFacts,
    AuthSessionResponse,
};
use crate::auth::invocation::{
    FunctionAttribution, HandlerAuthProjection, InvocationGate, InvocationSource,
    PreparedAuthority, ResolvedAppAuthority, WireAuthorityFields,
};
use crate::auth::lease::{
    AUTHORIZED_LEASE_PROTOCOL_VERSION, AuthorizedLease, AuthorizedLeaseRequestIdentity,
};
use crate::auth::provider::{
    AddressAdmission, AuthProvider, AuthProviderReadiness, CredentialIssue, ExchangeAdmission,
    PlannedExchange, PlannedFamilyAlarmCommit, PlannedLogout, PlannedRefresh,
    PlannedRevocationCommit, ProviderError, StepUpBinding,
    auth_required as provider_auth_required,
    credential_superseded as provider_credential_superseded,
    refresh_superseded as provider_refresh_superseded, session_expired as provider_session_expired,
};
use crate::auth::session_projection::FencedPublication;
use crate::auth::wire::{
    CredentialResponse, EmptyAuthRequest, ExchangeRequest, FamilyAlarmResponse, MailboxQuery,
    MailboxResponse, MintSessionRequest, RequestCodeRequest, RequestCodeResponse,
    RescueCollidingTableRequest, SecretInput,
};
use crate::cron::{CronRunMetadata, CronRunRecord};
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::ephemeral::{
    AuthContext, DeleteRequest, EphemeralCollection, PublishRequest, RealtimeEnvelope,
    RealtimePublicationPermit, RoomAuthorityPermit, Scope, SubscribeRequest,
};
use crate::live_wire::{
    LiveEnvelope, LiveSocketClientMessage, LiveSocketServerFrame, Receipt, SubscriptionReceiptEvent,
};
use crate::local::{
    AdmittedCronClaim, AppActionStage, AuthProvisionCommit, AuthorizationInvalidationAckInput,
    AuthorizationInvalidationManualRetryInput, ConfigVerifyStage, DetachedMutationRead,
    EnsureAppExplicitInput, EnsureAppMode, EnsureAppRequest, EnsureAppResponse, EphemeralApi,
    FunctionRunResult, InspectState, LiveInvalidationAdmission, LiveResumeInput,
    LiveSubscribeInput, LiveUnsubscribeInput, LocalSnapback, PreparedAuthProvision, StagedAction,
    StagedAppAction, StagedConfigVerify, StagedNestedMutation, live_stream_text,
};
use crate::manifest::{
    AuthInput, AuthMode, CtxAnswerLedger, FunctionKind, FunctionManifest, FunctionRuntime,
    HandlerInput, MutationAcknowledgementRequest, MutationAcknowledgementResponse, MutationOutput,
    MutationRequest, QueryOutput, ReadDependency, SchemaManifest, SeedData,
};
use crate::runtime::{CapabilityState, IbexActionHost};
use crate::storage::auth::AuthTransactionAttempt;
use axum::extract::rejection::{BytesRejection, JsonRejection, QueryRejection};
use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Extension, OriginalUri, Path, Query, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{MethodRouter, delete, get, post};
use axum::{
    Json, Router,
    body::{Body, Bytes, to_bytes},
};
use futures_util::{SinkExt, StreamExt};
use http_body::Body as HttpBody;
use serde::{Deserialize, Serialize};
use serde::ser::SerializeStruct as _;
use serde_json::{Value, json};
use std::convert::Infallible;
use std::future::Future;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore, mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::{Duration, interval};
use tower_service::Service;
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
                // another Snapback host call. Linearize completion against the
                // same staging generation so a reload/reset during that await
                // cannot escape as success — and so a spurious settlement-floor
                // diagnostic cannot mask that fence (ENG-24530). ENG-25006
                // closes Ibex's historical erase-before-enqueue fetch window,
                // but this caller-side precedence remains defense in depth:
                // when a reload/reset crossed the async span,
                // SNAPBACK_ACTION_GENERATION_CONFLICT is the precise, stable
                // cause and must still win over a settlement floor. The
                // watchdog is the hard upper bound: validate_live reports
                // abandonment/deadline (SNAPBACK_ACTION_TIMEOUT) ahead of the
                // generation fence, so a genuinely stuck native op keeps timing
                // out and a truly unsettled handler with no generation drift
                // keeps its SNAPBACK_HANDLER_DID_NOT_SETTLE.
                let fenced = match result {
                    Ok(value) => host.validate_live("action.complete").map(|()| value),
                    Err(error) if error.diagnostic.code == "SNAPBACK_HANDLER_DID_NOT_SETTLE" => {
                        match host.validate_live("action.complete") {
                            Ok(()) => Err(error),
                            Err(fence) => Err(fence),
                        }
                    }
                    Err(error) => Err(error),
                };
                fenced
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

type ConnectionRetirementSink = Arc<dyn Fn(BoundConnectionTerminalCapture) + Send + Sync + 'static>;

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
/// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — the exact-v1
/// offer binds a never-reused issuer and connection generation into the grant.
#[derive(Clone, Default)]
pub struct ConnectionRegistry {
    grants: Arc<std::sync::Mutex<ConnectionRegistryState>>,
    invalidation_issuer:
        Arc<std::sync::Mutex<Option<crate::auth::invalidation::LiveInvalidationIssuer>>>,
    retirement_sink: Arc<std::sync::Mutex<Option<ConnectionRetirementSink>>>,
}

#[derive(Default)]
struct ConnectionRegistryState {
    grants: std::collections::HashMap<String, ConnectionGrantRecord>,
    unused: std::collections::BTreeSet<(u64, String)>,
    used: std::collections::BTreeSet<(u64, String)>,
    anonymous_grants: std::collections::HashMap<String, std::collections::BTreeSet<String>>,
    session_grants: std::collections::HashMap<BoundSessionKey, std::collections::BTreeSet<String>>,
    anonymous_open_attempts: std::collections::HashMap<String, std::collections::VecDeque<Instant>>,
    unknown_open_attempts: std::collections::HashMap<String, std::collections::VecDeque<Instant>>,
    session_open_attempts:
        std::collections::HashMap<BoundSessionKey, std::collections::VecDeque<Instant>>,
    service_open_attempts: std::collections::HashMap<[u8; 32], std::collections::VecDeque<Instant>>,
    agent_route_attempts:
        std::collections::HashMap<AgentRouteThrottleKey, std::collections::VecDeque<Instant>>,
    pressure_mint_only: bool,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct AgentRouteThrottleKey {
    path: &'static str,
    source: AgentRouteThrottleSource,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
enum AgentRouteThrottleSource {
    Session(String),
    Credential([u8; 32]),
    Malformed,
}

struct ConnectionGrantRecord {
    grant_id: String,
    token: String,
    last_use_ms: u64,
    used: bool,
    managed_authority: bool,
    authority: BoundGrantAuthority,
    authorization_invalidation:
        Option<crate::auth::invalidation::AuthorizationInvalidationConnection>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct BoundSessionKey {
    authorization_stream_incarnation: String,
    session_id: String,
    generation: u64,
}

impl From<ConnectionSessionThrottleKey> for BoundSessionKey {
    fn from(value: ConnectionSessionThrottleKey) -> Self {
        Self {
            authorization_stream_incarnation: value.authorization_stream_incarnation,
            session_id: value.session_id,
            generation: value.generation,
        }
    }
}

#[derive(Clone)]
enum BoundGrantAuthority {
    Anonymous {
        authorization_stream_incarnation: String,
        publication: FencedPublication,
    },
    Session {
        authorization_stream_incarnation: String,
        session_id: String,
        user_id: String,
        provider: String,
        generation: u64,
        deadline_ms: u64,
        publication: FencedPublication,
    },
    /// A finite-only G5 carrier. The connection can be minted and resumed,
    /// but every connection act refuses before an effect fence is produced;
    /// G6 replaces that refusal with live validation and the carrier-axis
    /// invalidation machinery.
    ///
    /// @ref LLP 0055#plane-boundary — scoped tokens address connection open,
    /// while grant-backed live registration remains unavailable until item 6.
    ServicePrincipal {
        authorization_stream_incarnation: String,
        authority: ResolvedAppAuthority,
        token_id: String,
        deadline_ms: u64,
        publication: FencedPublication,
    },
}

impl std::fmt::Debug for BoundGrantAuthority {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Anonymous {
                authorization_stream_incarnation,
                ..
            } => formatter
                .debug_struct("BoundGrantAuthority::Anonymous")
                .field(
                    "authorization_stream_incarnation",
                    authorization_stream_incarnation,
                )
                .finish(),
            Self::Session {
                authorization_stream_incarnation,
                session_id,
                user_id,
                provider,
                generation,
                deadline_ms,
                ..
            } => formatter
                .debug_struct("BoundGrantAuthority::Session")
                .field(
                    "authorization_stream_incarnation",
                    authorization_stream_incarnation,
                )
                .field("session_id", session_id)
                .field("user_id", user_id)
                .field("provider", provider)
                .field("generation", generation)
                .field("deadline_ms", deadline_ms)
                .finish(),
            Self::ServicePrincipal {
                authorization_stream_incarnation,
                token_id,
                deadline_ms,
                ..
            } => formatter
                .debug_struct("BoundGrantAuthority::ServicePrincipal")
                .field(
                    "authorization_stream_incarnation",
                    authorization_stream_incarnation,
                )
                .field("token_id", token_id)
                .field("deadline_ms", deadline_ms)
                .finish_non_exhaustive(),
        }
    }
}

impl BoundGrantAuthority {
    fn publication(&self) -> &FencedPublication {
        match self {
            Self::Anonymous { publication, .. }
            | Self::Session { publication, .. }
            | Self::ServicePrincipal { publication, .. } => publication,
        }
    }

    fn effect_fence(&self, grant_id: &str) -> crate::ephemeral::ConnectionEffectFence {
        match self {
            Self::Anonymous {
                authorization_stream_incarnation,
                ..
            } => crate::ephemeral::ConnectionEffectFence::anonymous(
                authorization_stream_incarnation.clone(),
                grant_id.to_owned(),
            ),
            Self::Session {
                authorization_stream_incarnation,
                session_id,
                generation,
                ..
            } => crate::ephemeral::ConnectionEffectFence::session(
                authorization_stream_incarnation.clone(),
                grant_id.to_owned(),
                session_id.clone(),
                *generation,
            ),
            Self::ServicePrincipal { .. } => {
                unreachable!("G5 service-principal connections cannot own live effects")
            }
        }
    }

    fn reverse_key(&self) -> GrantReverseKey {
        match self {
            Self::Anonymous {
                authorization_stream_incarnation,
                ..
            } => GrantReverseKey::Anonymous(authorization_stream_incarnation.clone()),
            Self::Session {
                authorization_stream_incarnation,
                session_id,
                generation,
                ..
            } => GrantReverseKey::Session(BoundSessionKey {
                authorization_stream_incarnation: authorization_stream_incarnation.clone(),
                session_id: session_id.clone(),
                generation: *generation,
            }),
            Self::ServicePrincipal {
                authorization_stream_incarnation,
                ..
            } => GrantReverseKey::Anonymous(authorization_stream_incarnation.clone()),
        }
    }

    fn same_identity(&self, other: &Self) -> bool {
        match (self, other) {
            (
                Self::Anonymous {
                    authorization_stream_incarnation: left,
                    ..
                },
                Self::Anonymous {
                    authorization_stream_incarnation: right,
                    ..
                },
            ) => left == right,
            (
                Self::Session {
                    authorization_stream_incarnation: left_incarnation,
                    session_id: left_session,
                    user_id: left_user,
                    provider: left_provider,
                    generation: left_generation,
                    ..
                },
                Self::Session {
                    authorization_stream_incarnation: right_incarnation,
                    session_id: right_session,
                    user_id: right_user,
                    provider: right_provider,
                    generation: right_generation,
                    ..
                },
            ) => {
                left_incarnation == right_incarnation
                    && left_session == right_session
                    && left_user == right_user
                    && left_provider == right_provider
                    && left_generation == right_generation
            }
            (
                Self::ServicePrincipal {
                    authorization_stream_incarnation: left_incarnation,
                    authority: left_authority,
                    token_id: left_token,
                    ..
                },
                Self::ServicePrincipal {
                    authorization_stream_incarnation: right_incarnation,
                    authority: right_authority,
                    token_id: right_token,
                    ..
                },
            ) => {
                left_incarnation == right_incarnation
                    && left_authority == right_authority
                    && left_token == right_token
            }
            _ => false,
        }
    }

    fn stale_error(&self) -> SnapbackError {
        match self {
            Self::Anonymous { .. } => SnapbackError::error(
                "SNAPBACK_AUTH_STREAM_RESET",
                "auth",
                "the connection authorization stream is no longer current",
            ),
            Self::Session { .. } => SnapbackError::error(
                "SNAPBACK_AUTH_SESSION_EXPIRED",
                "auth",
                "the connection session is no longer current",
            ),
            Self::ServicePrincipal { .. } => SnapbackError::error(
                "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                "auth",
                "the connection scoped token is no longer current",
            ),
        }
    }

    fn terminal_capture(
        &self,
        connection_id: String,
        grant_id: String,
    ) -> BoundConnectionTerminalCapture {
        match self {
            Self::Anonymous {
                authorization_stream_incarnation,
                ..
            } => BoundConnectionTerminalCapture {
                connection_id,
                grant_id,
                authorization_stream_incarnation: authorization_stream_incarnation.clone(),
                session_id: None,
                generation: None,
            },
            Self::Session {
                authorization_stream_incarnation,
                session_id,
                generation,
                ..
            } => BoundConnectionTerminalCapture {
                connection_id,
                grant_id,
                authorization_stream_incarnation: authorization_stream_incarnation.clone(),
                session_id: Some(session_id.clone()),
                generation: Some(*generation),
            },
            Self::ServicePrincipal {
                authorization_stream_incarnation,
                ..
            } => BoundConnectionTerminalCapture {
                connection_id,
                grant_id,
                authorization_stream_incarnation: authorization_stream_incarnation.clone(),
                session_id: None,
                generation: None,
            },
        }
    }
}

enum GrantReverseKey {
    Anonymous(String),
    Session(BoundSessionKey),
}

enum ResolvedRoomConnectionAuthority {
    Absent,
    Current {
        auth: Option<AuthContext>,
        effect_fence: crate::ephemeral::ConnectionEffectFence,
    },
    Replaced,
}

#[derive(Clone, Debug)]
struct PreparedConnectionOpenAuthority {
    resolved: ResolvedAppAuthority,
    bound: BoundGrantAuthority,
    managed_authority: bool,
}

struct ConnectionOpenAttempt<'a> {
    suggested: Option<String>,
    previous_token: Option<&'a str>,
    allow_suggested: bool,
    prepared: PreparedConnectionOpenAuthority,
    now_ms: u64,
    monotonic_now: Instant,
    auth_invalidation_protocol: Option<u32>,
}

impl<'a> ConnectionOpenAttempt<'a> {
    fn new(
        suggested: Option<String>,
        previous_token: Option<&'a str>,
        allow_suggested: bool,
        prepared: PreparedConnectionOpenAuthority,
        now_ms: u64,
        monotonic_now: Instant,
        auth_invalidation_protocol: Option<u32>,
    ) -> Self {
        Self {
            suggested,
            previous_token,
            allow_suggested,
            prepared,
            now_ms,
            monotonic_now,
            auth_invalidation_protocol,
        }
    }
}

#[derive(Clone, Debug)]
struct OpenedConnectionGrant {
    grant: ConnectionGrant,
    grant_id: String,
    newly_minted: bool,
}

#[derive(Clone, Debug)]
struct PreparedConnectionAct {
    connection_id: String,
    grant_id: String,
    resolved: ResolvedAppAuthority,
    bound: BoundGrantAuthority,
    authorization_invalidation:
        Option<crate::auth::invalidation::AuthorizationInvalidationConnection>,
}

impl PreparedConnectionOpenAuthority {
    fn authenticated_use_key(&self) -> Option<(String, u64)> {
        match &self.bound {
            BoundGrantAuthority::Anonymous { .. }
            | BoundGrantAuthority::ServicePrincipal { .. } => None,
            BoundGrantAuthority::Session {
                session_id,
                generation,
                ..
            } => Some((session_id.clone(), *generation)),
        }
    }
}

impl PreparedConnectionAct {
    fn effect_fence(&self) -> crate::ephemeral::ConnectionEffectFence {
        self.bound.effect_fence(&self.grant_id)
    }

    fn authenticated_use_key(&self) -> Option<(String, u64)> {
        match &self.bound {
            BoundGrantAuthority::Anonymous { .. }
            | BoundGrantAuthority::ServicePrincipal { .. } => None,
            BoundGrantAuthority::Session {
                session_id,
                generation,
                ..
            } => Some((session_id.clone(), *generation)),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BoundConnectionTerminalCapture {
    pub(crate) connection_id: String,
    pub(crate) grant_id: String,
    pub(crate) authorization_stream_incarnation: String,
    pub(crate) session_id: Option<String>,
    pub(crate) generation: Option<u64>,
}

impl BoundConnectionTerminalCapture {
    fn effect_fence(&self) -> crate::ephemeral::ConnectionEffectFence {
        match (&self.session_id, self.generation) {
            (Some(session_id), Some(generation)) => {
                crate::ephemeral::ConnectionEffectFence::session(
                    self.authorization_stream_incarnation.clone(),
                    self.grant_id.clone(),
                    session_id.clone(),
                    generation,
                )
            }
            (None, None) => crate::ephemeral::ConnectionEffectFence::anonymous(
                self.authorization_stream_incarnation.clone(),
                self.grant_id.clone(),
            ),
            _ => unreachable!("terminal capture preserves complete session authority"),
        }
    }
}

/// Clone-shared server half of item 5 terminal propagation. Registry removal
/// invalidates every future act; notifier terminalization makes already-
/// queued effects non-deliverable and wakes only the exact bound socket. The
/// socket's generation-guarded teardown then performs physical room/outbox
/// cleanup without risking a replacement grant that reused the readable id.
#[derive(Clone)]
pub(crate) struct AuthTerminalLifecycle {
    connections: ConnectionRegistry,
    delivery: Arc<crate::ephemeral::DeliveryNotifier>,
    ephemeral: EphemeralApi,
    snapback: SharedSnapback,
}

pub(crate) fn committed_mode_terminal_reason(
    predecessor: &crate::auth::mode::AuthModeStateRecord,
    committed: &crate::auth::mode::AuthModeStateRecord,
) -> Option<crate::live_wire::LiveAuthErrorReason> {
    (predecessor.active == crate::manifest::AuthMode::Sessions
        && (committed.active != crate::manifest::AuthMode::Sessions
            || committed.mode_state != crate::auth::mode::AuthModeStatus::Settled))
        .then_some(if committed.desired == crate::manifest::AuthMode::Dev {
            crate::live_wire::LiveAuthErrorReason::Downgrade
        } else {
            crate::live_wire::LiveAuthErrorReason::ModeTransition
        })
}

fn purge_connection_capture(
    ephemeral: &EphemeralApi,
    snapback: &SharedSnapback,
    capture: &BoundConnectionTerminalCapture,
) {
    let effect_fence = capture.effect_fence();
    ephemeral.purge_connection_effects(&capture.connection_id, &effect_fence);
    if let Ok(mut snapback) = snapback.try_lock() {
        snapback.purge_connection_topology(&capture.connection_id, &effect_fence);
    } else if let Ok(runtime) = tokio::runtime::Handle::try_current() {
        let snapback = snapback.clone();
        let connection_id = capture.connection_id.clone();
        runtime.spawn(async move {
            snapback
                .lock()
                .await
                .purge_connection_topology(&connection_id, &effect_fence);
        });
    }
}

impl AuthTerminalLifecycle {
    pub(crate) fn new(
        connections: ConnectionRegistry,
        ephemeral: &EphemeralApi,
        snapback: SharedSnapback,
    ) -> Self {
        let delivery = ephemeral.delivery_notifier();
        let retirement_delivery = delivery.clone();
        let retirement_ephemeral = ephemeral.clone();
        let retirement_snapback = snapback.clone();
        connections.install_retirement_sink(move |capture| {
            purge_connection_capture(&retirement_ephemeral, &retirement_snapback, &capture);
            let _ = retirement_delivery.retire_bound(&capture.connection_id, &capture.grant_id);
        });
        Self {
            connections,
            delivery,
            ephemeral: ephemeral.clone(),
            snapback,
        }
    }

    pub(crate) fn expiry_sink(&self) -> crate::auth::runtime::AuthExpiryTerminalSink {
        let lifecycle = self.clone();
        crate::auth::runtime::AuthExpiryTerminalSink::new(move |expired| {
            lifecycle.expire_sessions(expired);
        })
    }

    fn expire_sessions(&self, expired: Vec<crate::auth::session_projection::ExpiredSession>) {
        for expired in expired {
            self.terminate_session_generation(
                &expired.authorization_stream_incarnation,
                &expired.session_id,
                expired.generation,
                crate::live_wire::LiveAuthErrorReason::Expired,
                expired.close_by,
            );
        }
    }

    pub(crate) fn terminate_session_generation(
        &self,
        authorization_stream_incarnation: &str,
        session_id: &str,
        generation: u64,
        reason: crate::live_wire::LiveAuthErrorReason,
        close_by: Instant,
    ) {
        let captures = self.connections.invalidate_session_generation(
            authorization_stream_incarnation,
            session_id,
            generation,
        );
        self.terminalize_captures(
            captures,
            crate::live_wire::LiveAuthErrorCode::SessionExpired,
            reason,
            close_by,
        );
    }

    pub(crate) fn committed_stream_reset(
        &self,
        reason: crate::live_wire::LiveAuthErrorReason,
        close_by: Instant,
    ) {
        let captures = self.connections.clear_after_committed_reset();
        self.terminalize_captures(
            captures,
            crate::live_wire::LiveAuthErrorCode::StreamReset,
            reason,
            close_by,
        );
    }

    pub(crate) fn committed_mode_transition(
        &self,
        reason: crate::live_wire::LiveAuthErrorReason,
        close_by: Instant,
    ) {
        let captures = self.connections.clear_after_committed_reset();
        self.terminalize_captures(
            captures,
            crate::live_wire::LiveAuthErrorCode::ModePending,
            reason,
            close_by,
        );
    }

    fn terminalize_captures(
        &self,
        captures: Vec<BoundConnectionTerminalCapture>,
        code: crate::live_wire::LiveAuthErrorCode,
        reason: crate::live_wire::LiveAuthErrorReason,
        close_by: Instant,
    ) {
        let event = crate::ephemeral::DeliveryTerminalEvent {
            code,
            reason,
            close_by,
        };
        for capture in captures {
            purge_connection_capture(&self.ephemeral, &self.snapback, &capture);
            let _ =
                self.delivery
                    .terminalize_bound(&capture.connection_id, &capture.grant_id, event);
        }
    }
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

    fn admit_slot(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<Option<BoundConnectionTerminalCapture>> {
        if self.grants.len() < MAX_CONNECTION_GRANTS {
            return Ok(None);
        }
        if let Some((_last_use, connection_id)) = self.unused.pop_first() {
            let record = self
                .remove_grant(&connection_id)
                .expect("unused LRU entry names an installed grant");
            return Ok(Some(
                record
                    .authority
                    .terminal_capture(connection_id, record.grant_id),
            ));
        }
        let expired_before = now_ms.saturating_sub(CONNECTION_GRANT_IDLE_TTL_MS);
        if self
            .used
            .first()
            .is_some_and(|(last_use, _)| *last_use <= expired_before)
            && let Some((_last_use, connection_id)) = self.used.pop_first()
        {
            let record = self
                .remove_grant(&connection_id)
                .expect("used LRU entry names an installed grant");
            self.pressure_mint_only = true;
            return Ok(Some(
                record
                    .authority
                    .terminal_capture(connection_id, record.grant_id),
            ));
        }
        Err(SnapbackError::error(
            "SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED",
            "realtime",
            format!(
                "connection grant limit ({MAX_CONNECTION_GRANTS}) is occupied by active leases; retry after an idle lease expires"
            ),
        ))
    }

    fn insert(&mut self, connection_id: String, record: ConnectionGrantRecord) {
        self.unused
            .insert((record.last_use_ms, connection_id.clone()));
        self.index_grant(&connection_id, &record.authority);
        self.grants.insert(connection_id, record);
    }

    fn index_grant(&mut self, connection_id: &str, authority: &BoundGrantAuthority) {
        match authority.reverse_key() {
            GrantReverseKey::Anonymous(incarnation) => {
                self.anonymous_grants
                    .entry(incarnation)
                    .or_default()
                    .insert(connection_id.to_owned());
            }
            GrantReverseKey::Session(key) => {
                self.session_grants
                    .entry(key)
                    .or_default()
                    .insert(connection_id.to_owned());
            }
        }
    }

    fn unindex_grant(&mut self, connection_id: &str, authority: &BoundGrantAuthority) {
        match authority.reverse_key() {
            GrantReverseKey::Anonymous(incarnation) => {
                if let Some(ids) = self.anonymous_grants.get_mut(&incarnation) {
                    ids.remove(connection_id);
                    if ids.is_empty() {
                        self.anonymous_grants.remove(&incarnation);
                    }
                }
            }
            GrantReverseKey::Session(key) => {
                if let Some(ids) = self.session_grants.get_mut(&key) {
                    ids.remove(connection_id);
                    if ids.is_empty() {
                        self.session_grants.remove(&key);
                    }
                }
            }
        }
    }

    fn remove_grant(&mut self, connection_id: &str) -> Option<ConnectionGrantRecord> {
        let record = self.grants.remove(connection_id)?;
        let index = if record.used {
            &mut self.used
        } else {
            &mut self.unused
        };
        index.remove(&(record.last_use_ms, connection_id.to_owned()));
        self.unindex_grant(connection_id, &record.authority);
        Some(record)
    }

    fn consume_bucket(
        bucket: &mut std::collections::VecDeque<Instant>,
        limit: usize,
        window: Duration,
        now: Instant,
    ) -> Result<(), u64> {
        while bucket.front().is_some_and(|attempt| {
            now.saturating_duration_since(*attempt) >= window
        }) {
            bucket.pop_front();
        }
        if bucket.len() >= limit {
            let remaining = bucket
                .front()
                .and_then(|oldest| {
                    oldest
                        .checked_add(window)
                        .map(|deadline| deadline.saturating_duration_since(now))
                })
                .unwrap_or(window);
            let millis = remaining.as_millis().max(1);
            let seconds = millis.div_ceil(1_000).min(u128::from(u64::MAX)) as u64;
            return Err(seconds.max(1));
        }
        bucket.push_back(now);
        Ok(())
    }

    fn prune_bucket(
        bucket: &mut std::collections::VecDeque<Instant>,
        window: Duration,
        now: Instant,
    ) {
        while bucket.front().is_some_and(|attempt| {
            now.saturating_duration_since(*attempt) >= window
        }) {
            bucket.pop_front();
        }
    }

    fn consume_anonymous_open(&mut self, incarnation: &str, now: Instant) -> Result<(), u64> {
        Self::consume_bucket(
            self.anonymous_open_attempts
                .entry(incarnation.to_owned())
                .or_default(),
            CONNECTION_OPEN_COARSE_LIMIT,
            CONNECTION_OPEN_WINDOW,
            now,
        )
    }

    fn consume_unknown_open(&mut self, incarnation: &str, now: Instant) -> Result<(), u64> {
        Self::consume_bucket(
            self.unknown_open_attempts
                .entry(incarnation.to_owned())
                .or_default(),
            CONNECTION_OPEN_COARSE_LIMIT,
            CONNECTION_OPEN_WINDOW,
            now,
        )
    }

    fn consume_session_open(&mut self, key: BoundSessionKey, now: Instant) -> Result<(), u64> {
        // Rejected opens can name sessions that never own a grant. Expire
        // their empty buckets independently of grant pressure so this local
        // throttle cannot become an unbounded process-lifetime index.
        self.session_open_attempts.retain(|_, bucket| {
            Self::prune_bucket(bucket, CONNECTION_OPEN_WINDOW, now);
            !bucket.is_empty()
        });
        Self::consume_bucket(
            self.session_open_attempts.entry(key).or_default(),
            CONNECTION_OPEN_SESSION_LIMIT,
            CONNECTION_OPEN_WINDOW,
            now,
        )
    }

    fn consume_service_open(&mut self, token_hash: [u8; 32], now: Instant) -> Result<(), u64> {
        self.service_open_attempts.retain(|_, bucket| {
            Self::prune_bucket(bucket, CONNECTION_OPEN_WINDOW, now);
            !bucket.is_empty()
        });
        Self::consume_bucket(
            self.service_open_attempts.entry(token_hash).or_default(),
            CONNECTION_OPEN_SESSION_LIMIT,
            CONNECTION_OPEN_WINDOW,
            now,
        )
    }

    fn consume_agent_route(
        &mut self,
        path: &'static str,
        mut source: AgentRouteThrottleSource,
        limit: usize,
        now: Instant,
    ) -> Result<(), u64> {
        self.agent_route_attempts.retain(|_, bucket| {
            Self::prune_bucket(bucket, AGENT_ROUTE_THROTTLE_WINDOW, now);
            !bucket.is_empty()
        });
        let mut key = AgentRouteThrottleKey {
            path,
            source: source.clone(),
        };
        if !self.agent_route_attempts.contains_key(&key)
            && self.agent_route_attempts.len() >= AGENT_ROUTE_THROTTLE_SOURCE_CAP
        {
            source = AgentRouteThrottleSource::Malformed;
            key = AgentRouteThrottleKey { path, source };
        }
        Self::consume_bucket(
            self.agent_route_attempts.entry(key).or_default(),
            limit,
            AGENT_ROUTE_THROTTLE_WINDOW,
            now,
        )
    }

    #[cfg(test)]
    fn assert_grant_indexes_consistent(&self) {
        assert_eq!(self.grants.len(), self.unused.len() + self.used.len());
        for (connection_id, record) in &self.grants {
            let lru_key = (record.last_use_ms, connection_id.clone());
            assert_eq!(
                (self.unused.contains(&lru_key), self.used.contains(&lru_key)),
                (!record.used, record.used),
                "grant must occur in exactly its declared LRU index"
            );
            match record.authority.reverse_key() {
                GrantReverseKey::Anonymous(incarnation) => assert!(
                    self.anonymous_grants
                        .get(&incarnation)
                        .is_some_and(|ids| ids.contains(connection_id))
                ),
                GrantReverseKey::Session(key) => assert!(
                    self.session_grants
                        .get(&key)
                        .is_some_and(|ids| ids.contains(connection_id))
                ),
            }
        }
        for (incarnation, ids) in &self.anonymous_grants {
            assert!(!ids.is_empty(), "anonymous reverse index has a ghost set");
            for connection_id in ids {
                assert!(matches!(
                    self.grants.get(connection_id).map(|record| &record.authority),
                    Some(BoundGrantAuthority::Anonymous {
                        authorization_stream_incarnation,
                        ..
                    }) | Some(BoundGrantAuthority::ServicePrincipal {
                        authorization_stream_incarnation,
                        ..
                    }) if authorization_stream_incarnation == incarnation
                ));
            }
        }
        for (key, ids) in &self.session_grants {
            assert!(!ids.is_empty(), "session reverse index has a ghost set");
            for connection_id in ids {
                assert!(matches!(
                    self.grants.get(connection_id).map(|record| &record.authority),
                    Some(BoundGrantAuthority::Session {
                        authorization_stream_incarnation,
                        session_id,
                        generation,
                        ..
                    }) if authorization_stream_incarnation == &key.authorization_stream_incarnation
                        && session_id == &key.session_id
                        && generation == &key.generation
                ));
            }
        }
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
    #[serde(
        rename = "authorizationInvalidation",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_invalidation:
        Option<crate::auth::invalidation::AuthorizationInvalidationConnection>,
}

impl std::fmt::Debug for ConnectionGrant {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // @ref LLP 0039#diagnostics-and-route-registry — bearer capabilities
        // never enter logs or diagnostic/debug projections.
        formatter
            .debug_struct("ConnectionGrant")
            .field("connection_id", &self.connection_id)
            .field("connection_token", &"[REDACTED]")
            .field(
                "authorization_invalidation",
                &self.authorization_invalidation,
            )
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
    /// Exact must-understand offer. Missing or any value other than v1 opens a
    /// legacy connection that cannot admit session-mode auth-scoped live work.
    #[serde(default, alias = "auth_invalidation_protocol")]
    pub auth_invalidation_protocol: Option<u32>,
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
            .field(
                "auth_invalidation_protocol",
                &self.auth_invalidation_protocol,
            )
            .finish()
    }
}

impl ConnectionRegistry {
    fn install_retirement_sink(
        &self,
        sink: impl Fn(BoundConnectionTerminalCapture) + Send + Sync + 'static,
    ) {
        *self
            .retirement_sink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Arc::new(sink));
    }

    fn publish_retirement(&self, capture: BoundConnectionTerminalCapture) {
        let sink = self
            .retirement_sink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if let Some(sink) = sink {
            sink(capture);
        }
    }

    /// Invalidate every process-local connection capability after the shared
    /// authorization stream rotates at a committed app reset.
    pub(crate) fn clear_after_committed_reset(&self) -> Vec<BoundConnectionTerminalCapture> {
        let mut state = self.lock();
        let captures = state
            .grants
            .iter()
            .map(|(connection_id, record)| {
                record
                    .authority
                    .terminal_capture(connection_id.clone(), record.grant_id.clone())
            })
            .collect::<Vec<_>>();
        let retired_any = !captures.is_empty();
        *state = ConnectionRegistryState::default();
        state.pressure_mint_only = retired_any;
        *self
            .invalidation_issuer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        captures
    }

    pub(crate) fn install_invalidation_issuer(
        &self,
        issuer: crate::auth::invalidation::LiveInvalidationIssuer,
    ) {
        *self
            .invalidation_issuer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(issuer);
    }

    pub(crate) fn clear_invalidation_issuer(&self) {
        *self
            .invalidation_issuer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }

    #[cfg(test)]
    fn invalidation_expectation_for_test(&self) -> Option<crate::storage::AuthorizationVersion> {
        self.invalidation_issuer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .map(|issuer| {
                issuer
                    .authorization_expectation()
                    .expect("test issuer expectation")
            })
    }

    /// Remove every grant bound to one exact predecessor session generation.
    /// The reverse index keeps this proportional to the affected authority,
    /// not to the 16,384-entry registry.
    pub(crate) fn invalidate_session_generation(
        &self,
        authorization_stream_incarnation: &str,
        session_id: &str,
        generation: u64,
    ) -> Vec<BoundConnectionTerminalCapture> {
        let key = BoundSessionKey {
            authorization_stream_incarnation: authorization_stream_incarnation.to_owned(),
            session_id: session_id.to_owned(),
            generation,
        };
        let mut state = self.lock();
        let ids = state.session_grants.get(&key).cloned().unwrap_or_default();
        let captures = ids
            .iter()
            .filter_map(|connection_id| {
                let record = state.grants.get(connection_id)?;
                Some(
                    record
                        .authority
                        .terminal_capture(connection_id.clone(), record.grant_id.clone()),
                )
            })
            .collect::<Vec<_>>();
        for connection_id in &ids {
            state.remove_grant(connection_id);
        }
        if !ids.is_empty() {
            state.pressure_mint_only = true;
        }
        captures
    }

    /// Resolve and account for one connection-open credential before the
    /// handler considers id reuse. This is the only production constructor
    /// for `BoundGrantAuthority`.
    fn prepare_open_authority(
        &self,
        coordinator: &AuthCoordinator,
        presented: PresentedSessionBearer<'_>,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> Result<PreparedConnectionOpenAuthority, ApiError> {
        let incarnation = coordinator
            .authorization_stream_incarnation()
            .map_err(ApiError::from)?;
        match presented {
            PresentedSessionBearer::Absent => {
                self.consume_anonymous_open(&incarnation, monotonic_now)?;
                let prepared = coordinator
                    .prepare_anonymous_connection()
                    .map_err(ApiError::from)?;
                Ok(PreparedConnectionOpenAuthority {
                    resolved: ResolvedAppAuthority::Anonymous,
                    managed_authority: true,
                    bound: BoundGrantAuthority::Anonymous {
                        authorization_stream_incarnation: prepared.authorization_stream_incarnation,
                        publication: prepared.publication,
                    },
                })
            }
            PresentedSessionBearer::Malformed => {
                self.consume_anonymous_open(&incarnation, monotonic_now)?;
                Err(ApiError::from(SnapbackError::error(
                    "SNAPBACK_AUTH_REQUIRED",
                    "auth",
                    "authentication is required",
                )))
            }
            PresentedSessionBearer::Candidate(raw) => {
                let Ok(bearer) = SessionBearer::parse(raw) else {
                    self.consume_anonymous_open(&incarnation, monotonic_now)?;
                    return Err(ApiError::from(SnapbackError::error(
                        "SNAPBACK_AUTH_REQUIRED",
                        "auth",
                        "authentication is required",
                    )));
                };
                match coordinator
                    .classify_connection_bearer(&bearer, epoch_now_ms, monotonic_now)
                    .map_err(ApiError::from)?
                {
                    ConnectionBearerResolution::Current(prepared) => {
                        let (resolved, incarnation, deadline_ms, publication) =
                            prepared.into_parts();
                        let ResolvedAppAuthority::Session {
                            user_id,
                            session_id,
                            provider,
                            generation,
                            ..
                        } = &resolved
                        else {
                            unreachable!("connection session preparation is session authority")
                        };
                        self.consume_session_open(
                            BoundSessionKey {
                                authorization_stream_incarnation: incarnation.clone(),
                                session_id: session_id.clone(),
                                generation: *generation,
                            },
                            monotonic_now,
                        )?;
                        Ok(PreparedConnectionOpenAuthority {
                            managed_authority: true,
                            bound: BoundGrantAuthority::Session {
                                authorization_stream_incarnation: incarnation,
                                session_id: session_id.clone(),
                                user_id: user_id.clone(),
                                provider: provider.clone(),
                                generation: *generation,
                                deadline_ms,
                                publication,
                            },
                            resolved,
                        })
                    }
                    ConnectionBearerResolution::Superseded(key) => {
                        self.consume_session_open(key.into(), monotonic_now)?;
                        Err(ApiError::from(SnapbackError::error(
                            "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED",
                            "auth",
                            "authentication credential has been superseded",
                        )))
                    }
                    ConnectionBearerResolution::Unavailable(key) => {
                        self.consume_session_open(key.into(), monotonic_now)?;
                        Err(ApiError::from(SnapbackError::error(
                            "SNAPBACK_AUTH_REQUIRED",
                            "auth",
                            "authentication is required",
                        )))
                    }
                    ConnectionBearerResolution::Unknown {
                        authorization_stream_incarnation,
                    } => {
                        self.consume_unknown_open(
                            &authorization_stream_incarnation,
                            monotonic_now,
                        )?;
                        Err(ApiError::from(SnapbackError::error(
                            "SNAPBACK_AUTH_REQUIRED",
                            "auth",
                            "authentication is required",
                        )))
                    }
                }
            }
        }
    }

    /// Detached/test embeddings may intentionally run active Dev without the
    /// pre-bind AuthRuntime composition used by the CLI. Keep that legacy
    /// posture anonymous-only while still applying the same coarse throttle;
    /// Sessions mode never enters this seam.
    fn prepare_unmanaged_dev_open(
        &self,
        presented: PresentedSessionBearer<'_>,
        monotonic_now: Instant,
    ) -> Result<PreparedConnectionOpenAuthority, ApiError> {
        let (incarnation, publication) =
            FencedPublication::anonymous_for_unmanaged_dev_connection();
        self.consume_anonymous_open(&incarnation, monotonic_now)?;
        match presented {
            PresentedSessionBearer::Absent => Ok(PreparedConnectionOpenAuthority {
                resolved: ResolvedAppAuthority::Anonymous,
                managed_authority: false,
                bound: BoundGrantAuthority::Anonymous {
                    authorization_stream_incarnation: incarnation,
                    publication,
                },
            }),
            PresentedSessionBearer::Malformed | PresentedSessionBearer::Candidate(_) => {
                Err(ApiError::from(SnapbackError::error(
                    "SNAPBACK_AUTH_REQUIRED",
                    "auth",
                    "session credentials are unavailable while auth mode is dev",
                )))
            }
        }
    }

    fn consume_anonymous_open(
        &self,
        incarnation: &str,
        monotonic_now: Instant,
    ) -> Result<(), ApiError> {
        self.lock()
            .consume_anonymous_open(incarnation, monotonic_now)
            .map_err(ApiError::auth_throttled)
    }

    fn consume_unknown_open(
        &self,
        incarnation: &str,
        monotonic_now: Instant,
    ) -> Result<(), ApiError> {
        self.lock()
            .consume_unknown_open(incarnation, monotonic_now)
            .map_err(ApiError::auth_throttled)
    }

    fn consume_session_open(
        &self,
        key: BoundSessionKey,
        monotonic_now: Instant,
    ) -> Result<(), ApiError> {
        self.lock()
            .consume_session_open(key, monotonic_now)
            .map_err(ApiError::auth_throttled)
    }

    fn consume_service_open(
        &self,
        token_hash: [u8; 32],
        monotonic_now: Instant,
    ) -> Result<(), ApiError> {
        self.lock()
            .consume_service_open(token_hash, monotonic_now)
            .map_err(ApiError::auth_throttled)
    }

    fn consume_agent_route(
        &self,
        path: &'static str,
        source: AgentRouteThrottleSource,
        monotonic_now: Instant,
    ) -> Result<(), ApiError> {
        let Some(limit) = agent_route_throttle_limit(path) else {
            return Ok(());
        };
        self.lock()
            .consume_agent_route(path, source, limit, monotonic_now)
            .map_err(ApiError::auth_throttled)
    }

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
    fn open_prepared(
        &self,
        attempt: ConnectionOpenAttempt<'_>,
    ) -> SnapbackResult<OpenedConnectionGrant> {
        let ConnectionOpenAttempt {
            suggested,
            previous_token,
            allow_suggested,
            prepared,
            now_ms,
            monotonic_now,
            auth_invalidation_protocol,
        } = attempt;
        let stale = prepared.bound.stale_error();
        let publication = prepared.bound.publication().clone();
        let mut retirement = None;
        let result = publication.try_publish(now_ms, monotonic_now, || {
            let mut grants = self.lock();
            if let (Some(id), Some(previous)) = (suggested.as_ref(), previous_token)
                && grants
                    .grants
                    .get(id)
                    .is_some_and(|existing| constant_time_str_eq(&existing.token, previous))
            {
                let same_authority = grants
                    .grants
                    .get(id)
                    .is_some_and(|existing| existing.authority.same_identity(&prepared.bound));
                if !same_authority {
                    if let Some(record) = grants.remove_grant(id) {
                        retirement = Some(
                            record
                                .authority
                                .terminal_capture(id.clone(), record.grant_id),
                        );
                    }
                    grants.pressure_mint_only = true;
                    return Err(SnapbackError::error(
                        "SNAPBACK_CONNECTION_AUTHORITY_MISMATCH",
                        "auth",
                        "the previous connection token is bound to different authority",
                    ));
                }
                let existing = grants
                    .grants
                    .get_mut(id)
                    .expect("exact previous grant remains installed");
                existing.authority = prepared.bound.clone();
                existing.managed_authority = prepared.managed_authority;
                let grant_id = existing.grant_id.clone();
                let connection_token = existing.token.clone();
                let authorization_invalidation = existing.authorization_invalidation.clone();
                grants.touch(id, now_ms);
                return Ok(OpenedConnectionGrant {
                    grant: ConnectionGrant {
                        connection_id: id.clone(),
                        connection_token,
                        authorization_invalidation,
                    },
                    grant_id,
                    newly_minted: false,
                });
            }
            retirement = grants.admit_slot(now_ms)?;
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
            let grant_id = Uuid::now_v7().to_string();
            let connection_token = format!("sct_{}", Uuid::new_v4().simple());
            let authorization_invalidation = if auth_invalidation_protocol
                == Some(crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION)
            {
                self.invalidation_issuer
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .clone()
                    .map(|issuer| {
                        let issuer_retirement = issuer.authenticate_prior_issuer_retirement()?;
                        Ok::<_, SnapbackError>(
                            crate::auth::invalidation::AuthorizationInvalidationConnection {
                                protocol_version:
                                    crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION,
                                issuer_id: issuer.authenticated().issuer_id.clone(),
                                connection_generation: issuer.reserve_connection_generation()?,
                                authorization: issuer.authorization_expectation()?,
                                version_stream: issuer.version_stream()?,
                                issuer_retirement,
                            },
                        )
                    })
                    .transpose()?
            } else {
                None
            };
            grants.insert(
                connection_id.clone(),
                ConnectionGrantRecord {
                    grant_id: grant_id.clone(),
                    token: connection_token.clone(),
                    authority: prepared.bound,
                    managed_authority: prepared.managed_authority,
                    last_use_ms: now_ms,
                    used: false,
                    authorization_invalidation: authorization_invalidation.clone(),
                },
            );
            Ok(OpenedConnectionGrant {
                grant: ConnectionGrant {
                    connection_id,
                    connection_token,
                    authorization_invalidation,
                },
                grant_id,
                newly_minted: true,
            })
        });
        if let Some(capture) = retirement {
            // Never call into outbox/room/notifier state while the registry or
            // leaf publication locks are held. The exact-act cut above makes
            // the remove→purge interval non-deliverable.
            self.publish_retirement(capture);
        }
        result?.ok_or(stale)
    }

    /// Retract a fresh grant whose bearer has not been published because the
    /// qualifying-use or final response fence failed. Exact grant identity
    /// prevents cleanup from deleting a replacement that reused the wire id.
    fn discard_unpublished_open(&self, opened: &OpenedConnectionGrant) {
        if !opened.newly_minted {
            return;
        }
        let capture = {
            let mut state = self.lock();
            if state
                .grants
                .get(&opened.grant.connection_id)
                .is_some_and(|record| record.grant_id == opened.grant_id)
            {
                state
                    .remove_grant(&opened.grant.connection_id)
                    .map(|record| {
                        record
                            .authority
                            .terminal_capture(opened.grant.connection_id.clone(), record.grant_id)
                    })
            } else {
                None
            }
        };
        if let Some(capture) = capture {
            self.publish_retirement(capture);
        }
    }

    /// Refresh the grant's mutable cached lease after authenticated-use
    /// publication. The immutable authority identity and grant id must still
    /// match at the session fence cut.
    fn refresh_open_deadline(
        &self,
        opened: &OpenedConnectionGrant,
        prepared: &PreparedConnectionOpenAuthority,
        deadline_ms: u64,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<()> {
        let stale = prepared.bound.stale_error();
        prepared
            .bound
            .publication()
            .try_publish(epoch_now_ms, monotonic_now, || {
                let mut state = self.lock();
                let Some(record) = state.grants.get_mut(&opened.grant.connection_id) else {
                    return Ok(false);
                };
                if record.grant_id != opened.grant_id
                    || !record.authority.same_identity(&prepared.bound)
                {
                    return Ok(false);
                }
                if let BoundGrantAuthority::Session {
                    deadline_ms: cached,
                    ..
                } = &mut record.authority
                {
                    *cached = deadline_ms;
                }
                Ok(true)
            })?
            .filter(|updated| *updated)
            .map(|_| ())
            .ok_or(stale)
    }

    fn refresh_act_deadline(
        &self,
        prepared: &PreparedConnectionAct,
        deadline_ms: u64,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<()> {
        let stale = prepared.bound.stale_error();
        prepared
            .bound
            .publication()
            .try_publish(epoch_now_ms, monotonic_now, || {
                let mut state = self.lock();
                let Some(record) = state.grants.get_mut(&prepared.connection_id) else {
                    return Ok(false);
                };
                if record.grant_id != prepared.grant_id
                    || !record.authority.same_identity(&prepared.bound)
                {
                    return Ok(false);
                }
                if let BoundGrantAuthority::Session {
                    deadline_ms: cached,
                    ..
                } = &mut record.authority
                {
                    *cached = deadline_ms;
                }
                Ok(true)
            })?
            .filter(|updated| *updated)
            .map(|_| ())
            .ok_or(stale)
    }

    /// Legacy Rust embedding seam used by dev/test harnesses that construct
    /// grants before installing an auth coordinator. The record is marked
    /// unmanaged and sessions-mode middleware refuses it; production HTTP
    /// opens exclusively through projection-backed `open_prepared`.
    #[doc(hidden)]
    pub fn open(
        &self,
        suggested: Option<String>,
        previous_token: Option<&str>,
        allow_suggested: bool,
    ) -> SnapbackResult<ConnectionGrant> {
        let (incarnation, publication) =
            FencedPublication::anonymous_for_unmanaged_dev_connection();
        self.open_prepared(ConnectionOpenAttempt::new(
            suggested,
            previous_token,
            allow_suggested,
            PreparedConnectionOpenAuthority {
                resolved: ResolvedAppAuthority::Anonymous,
                managed_authority: false,
                bound: BoundGrantAuthority::Anonymous {
                    authorization_stream_incarnation: incarnation,
                    publication,
                },
            },
            now_millis(),
            Instant::now(),
            None,
        ))
        .map(|opened| opened.grant)
    }

    fn resolve_room_connection_authority(
        &self,
        connection_id: &str,
        expected_effect_fence: Option<&crate::ephemeral::ConnectionEffectFence>,
        coordinator: Option<&AuthCoordinator>,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ResolvedRoomConnectionAuthority> {
        let (grant_id, managed_authority, bound) = {
            let state = self.lock();
            let Some(record) = state.grants.get(connection_id) else {
                return Ok(ResolvedRoomConnectionAuthority::Absent);
            };
            (
                record.grant_id.clone(),
                record.managed_authority,
                record.authority.clone(),
            )
        };
        if matches!(bound, BoundGrantAuthority::ServicePrincipal { .. }) {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "grant-backed live and ephemeral operations are unavailable until the agent live fence is ready",
            )
            .with_details(json!({ "capability": "grantBackedLive" })));
        }
        let effect_fence = bound.effect_fence(&grant_id);
        if expected_effect_fence.is_some_and(|expected| expected != &effect_fence) {
            return Ok(ResolvedRoomConnectionAuthority::Replaced);
        }
        if !managed_authority {
            return Ok(ResolvedRoomConnectionAuthority::Current {
                auth: None,
                effect_fence,
            });
        }
        let resolved = match &bound {
            BoundGrantAuthority::Anonymous { .. } => ResolvedAppAuthority::Anonymous,
            BoundGrantAuthority::ServicePrincipal { .. } => {
                unreachable!("service-principal room authority refused above")
            }
            BoundGrantAuthority::Session {
                authorization_stream_incarnation,
                session_id,
                user_id,
                provider,
                generation,
                ..
            } => {
                let Some(coordinator) = coordinator else {
                    return Ok(ResolvedRoomConnectionAuthority::Current {
                        auth: None,
                        effect_fence,
                    });
                };
                let Some(resolved) = coordinator.resolve_bound_connection_session(
                    authorization_stream_incarnation,
                    session_id,
                    user_id,
                    provider,
                    *generation,
                    epoch_now_ms,
                    monotonic_now,
                )?
                else {
                    return Ok(ResolvedRoomConnectionAuthority::Current {
                        auth: None,
                        effect_fence,
                    });
                };
                resolved
            }
        };
        let current = bound
            .publication()
            .try_publish(epoch_now_ms, monotonic_now, || {
                Ok(self.lock().grants.get(connection_id).is_some_and(|record| {
                    record.grant_id == grant_id
                        && record.authority.effect_fence(&record.grant_id) == effect_fence
                }))
            })?;
        if current != Some(true) {
            return Ok(ResolvedRoomConnectionAuthority::Replaced);
        }
        Ok(ResolvedRoomConnectionAuthority::Current {
            auth: Some(ephemeral_auth_from_authority(&resolved)),
            effect_fence,
        })
    }

    /// Verify a presented token for one connection-scoped operation. Unknown
    /// connections and token mismatches share one diagnostic code so the gate
    /// is not an existence oracle for the connection-id namespace.
    fn prepare_act(
        &self,
        connection_id: &str,
        presented: Option<&str>,
        coordinator: Option<&AuthCoordinator>,
        allow_unmanaged_dev: bool,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> Result<PreparedConnectionAct, ApiError> {
        let Some(presented) = presented else {
            return Err(connection_auth_error(
                "SNAPBACK_CONNECTION_TOKEN_REQUIRED",
                "connection-scoped operations require the connection token issued by POST /connection/open",
                connection_id,
            ));
        };
        let (grant_id, bound, authorization_invalidation) = {
            let grants = self.lock();
            let Some(record) = grants
                .grants
                .get(connection_id)
                .filter(|expected| constant_time_str_eq(&expected.token, presented))
            else {
                return Err(connection_auth_error(
                    "SNAPBACK_CONNECTION_TOKEN_INVALID",
                    "connection is not open on this server or the token does not match",
                    connection_id,
                ));
            };
            if !record.managed_authority && !allow_unmanaged_dev {
                return Err(connection_auth_error(
                    "SNAPBACK_CONNECTION_TOKEN_INVALID",
                    "connection authority is unavailable in sessions mode",
                    connection_id,
                ));
            }
            (
                record.grant_id.clone(),
                record.authority.clone(),
                record.authorization_invalidation.clone(),
            )
        };
        let resolved = match &bound {
            BoundGrantAuthority::Anonymous { .. } => ResolvedAppAuthority::Anonymous,
            BoundGrantAuthority::ServicePrincipal { .. } => {
                return Err(ApiError::from(
                    SnapbackError::error(
                        "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                        "auth",
                        "grant-backed live and connection operations are unavailable until the agent live fence is ready",
                    )
                    .with_details(json!({ "capability": "grantBackedLive" })),
                ))
            }
            BoundGrantAuthority::Session {
                authorization_stream_incarnation,
                session_id,
                user_id,
                provider,
                generation,
                ..
            } => {
                let coordinator = coordinator.ok_or_else(|| {
                    ApiError::from(SnapbackError::error(
                        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                        "auth",
                        "authentication projection is unavailable",
                    ))
                })?;
                coordinator
                    .resolve_bound_connection_session(
                        authorization_stream_incarnation,
                        session_id,
                        user_id,
                        provider,
                        *generation,
                        epoch_now_ms,
                        monotonic_now,
                    )
                    .map_err(ApiError::from)?
                    .ok_or_else(|| ApiError::from(bound.stale_error()))?
            }
        };
        Ok(PreparedConnectionAct {
            connection_id: connection_id.to_owned(),
            grant_id,
            resolved,
            bound,
            authorization_invalidation,
        })
    }

    #[cfg(test)]
    pub fn verify(&self, connection_id: &str, presented: Option<&str>) -> Result<(), ApiError> {
        let prepared = self.prepare_act(
            connection_id,
            presented,
            None,
            true,
            now_millis(),
            Instant::now(),
        )?;
        prepared.try_act(self, now_millis(), Instant::now(), || Ok(()))
    }

    fn authenticate_presented_bearer(&self, presented: Option<&str>) -> Result<(), ApiError> {
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
    #[cfg(test)]
    fn touch_verified_socket(&self, connection_id: &str) -> bool {
        let prepared = {
            let state = self.lock();
            let Some(record) = state.grants.get(connection_id) else {
                return false;
            };
            PreparedConnectionAct {
                connection_id: connection_id.to_owned(),
                grant_id: record.grant_id.clone(),
                resolved: ResolvedAppAuthority::Anonymous,
                bound: record.authority.clone(),
                authorization_invalidation: record.authorization_invalidation.clone(),
            }
        };
        prepared
            .try_act(self, now_millis(), Instant::now(), || Ok(()))
            .is_ok()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ConnectionRegistryState> {
        self.grants
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl PreparedConnectionAct {
    pub(crate) fn terminal_capture(&self) -> BoundConnectionTerminalCapture {
        self.bound
            .terminal_capture(self.connection_id.clone(), self.grant_id.clone())
    }

    fn try_act<T>(
        &self,
        registry: &ConnectionRegistry,
        epoch_now_ms: u64,
        monotonic_now: Instant,
        act: impl FnOnce() -> Result<T, ApiError>,
    ) -> Result<T, ApiError> {
        let mut outcome = None;
        // Publication → registry is the canonical order also used by open and
        // retirement. Keep the registry guard through the bounded synchronous
        // act so removal cannot linearize between exact-grant validation and
        // an outbox acknowledgement or writer `try_send`.
        let published = self
            .bound
            .publication()
            .try_publish(epoch_now_ms, monotonic_now, || {
                let mut state = registry.lock();
                let current = state
                    .grants
                    .get(&self.connection_id)
                    .is_some_and(|record| record.grant_id == self.grant_id);
                if !current {
                    return Err(SnapbackError::error(
                        "SNAPBACK_CONNECTION_TOKEN_INVALID",
                        "realtime",
                        "the connection grant is no longer current",
                    ));
                }
                state.touch(&self.connection_id, epoch_now_ms);
                outcome = Some(act());
                Ok(())
            })
            .map_err(ApiError::from)?;
        if published.is_none() {
            return Err(ApiError::from(self.bound.stale_error()));
        }
        outcome.expect("a successful fenced connection act records its outcome")
    }
}

fn connection_auth_error(code: &str, message: &str, connection_id: &str) -> ApiError {
    ApiError(
        SnapbackError::new(
            Diagnostic::error(code, "realtime", message)
                .with_details(json!({ "connection_id": connection_id })),
        ),
        None,
        None,
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
const CONNECTION_OPEN_SESSION_LIMIT: usize = 60;
const CONNECTION_OPEN_COARSE_LIMIT: usize = 240;
const CONNECTION_OPEN_WINDOW: Duration = Duration::from_secs(60);
const AGENT_ROUTE_THROTTLE_WINDOW: Duration = Duration::from_secs(60);
const AGENT_ROUTE_THROTTLE_SOURCE_CAP: usize = 4_096;

/// Each agent-management route owns a distinct closed budget. Equal limits do
/// not share accounting: the canonical route path is the bucket key.
///
/// @ref LLP 0055#routes-and-credential-classes — every route has its own
/// throttle budget, independent of its credential class.
fn agent_route_throttle_limit(path: &str) -> Option<usize> {
    match path {
        "/auth/pairing-codes" => Some(20),
        "/auth/agents/pair" => Some(60),
        "/auth/grant-requests" => Some(120),
        "/auth/grant-requests/{id}/approve" => Some(60),
        "/auth/grant-requests/{id}/deny" => Some(60),
        "/auth/grants" => Some(120),
        "/auth/grants/by-actor/{actor_id}" => Some(60),
        "/auth/grants/{id}" => Some(60),
        "/auth/agents/rotate" => Some(10),
        "/auth/agents/token" => Some(120),
        "/auth/agents/revoke-self" => Some(20),
        _ => None,
    }
}

fn agent_body_throttle_source(body: Option<&Value>) -> AgentRouteThrottleSource {
    let credential = body
        .and_then(Value::as_object)
        .and_then(|body| body.get("credential"))
        .and_then(Value::as_str)
        .and_then(|credential| AgentCredential::parse(credential).ok());
    match credential {
        Some(credential) => {
            AgentRouteThrottleSource::Credential(*credential.token_hash().as_bytes())
        }
        None => AgentRouteThrottleSource::Malformed,
    }
}

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

/// `POST /connection/open` — the connection handshake (ENG-23442). Public by
/// design: it GRANTS a capability rather than exercising one, exactly like
/// `/app/ensure`. The profile decides whether a caller-suggested id may be
/// adopted (non-prod only).
async fn open_connection(
    State(runtime): State<AppState>,
    Extension(_authority): Extension<PreparedAuthority>,
    Extension(prepared): Extension<PreparedConnectionOpenAuthority>,
    Extension(admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<ConnectionGrant>, ApiError> {
    let body = parse_optional_json::<OpenConnectionRequest>(&headers, body)?;
    let (suggested, previous_token, auth_invalidation_protocol) = body
        .map(|body| {
            (
                body.connection_id,
                body.previous_token,
                body.auth_invalidation_protocol,
            )
        })
        .unwrap_or_default();
    let allow_suggested = runtime.server.profile.allows_provisioning();
    let use_key = prepared.authenticated_use_key();
    let opened = {
        let _effect = admission.effect_guard("connection grant publication")?;
        let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
        runtime
            .connections
            .open_prepared(ConnectionOpenAttempt::new(
                suggested,
                previous_token.as_deref(),
                allow_suggested,
                prepared.clone(),
                epoch_now_ms,
                monotonic_now,
                auth_invalidation_protocol,
            ))?
    };
    let deadline = match record_connection_authenticated_use(&runtime, use_key, &admission).await {
        Ok(deadline) => deadline,
        Err(error) => {
            runtime.connections.discard_unpublished_open(&opened);
            return Err(error);
        }
    };
    if let Some(deadline_ms) = deadline {
        let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
        if let Err(error) = runtime.connections.refresh_open_deadline(
            &opened,
            &prepared,
            deadline_ms,
            epoch_now_ms,
            monotonic_now,
        ) {
            runtime.connections.discard_unpublished_open(&opened);
            return Err(ApiError::from(error));
        }
    }
    // Establish reaper-visible continuity before the first drain. Reaping
    // removes this marker before room/outbox teardown, so an old grant cannot
    // make an extinct drain look like a healthy empty queue.
    runtime
        .ephemeral
        .touch_connection(&opened.grant.connection_id);
    if opened.grant.authorization_invalidation.is_some() {
        let projection_connection = opened.grant.connection_id.clone();
        let projection_admission = admission.clone();
        with_snapback(&runtime.snapback, move |snapback| {
            snapback.reproject_authorization_invalidations(
                &projection_connection,
                &projection_admission,
            )
        })
        .await?;
    }
    Ok(Json(opened.grant))
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<FunctionAttribution>,
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

#[derive(Serialize)]
struct FunctionResponse<T> {
    #[serde(flatten)]
    output: T,
    #[serde(skip_serializing_if = "Option::is_none")]
    attribution: Option<FunctionAttribution>,
}

impl<T> FunctionResponse<T> {
    fn new(output: T, attribution: Option<FunctionAttribution>) -> Self {
        Self {
            output,
            attribution,
        }
    }
}

/// Closed request carrier for the sole full-query lease issuance path. The
/// ordinary query fields stay at their usual top-level wire names so route
/// middleware sees body-carried dev authority in the same place; spelling the
/// complete v1 map here lets serde and the generated schema reject additions.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AuthorizedLeaseQueryRequest {
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub auth: AuthInput,
    #[serde(default)]
    pub read_set: Vec<ReadDependency>,
    /// Opaque adapter-stitched correlation (LLP 0034 §3.2, ENG-22478): the
    /// Exact adapter's join keys (`actionInvocationId`, `optimisticWaveId`,
    /// `rootId`, `bindingIds`) live inside. The provider echoes it verbatim
    /// on receipts and never interprets it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation: Option<Value>,
    /// Replay ledger (LLP 0051 D1): when present, the invocation runs in
    /// REPLAY mode — `ctx.runtime.now()` answers `ledger.now` and every
    /// host-generated id (`ctx.runtime.id()` and `ctx.db.insert` row ids)
    /// consumes `ledger.ids` in order. Consuming past the end is a typed
    /// divergence error. Additive: absent means record mode, today's
    /// behavior. Queries and mutations only; actions never carry one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctx_ledger: Option<CtxAnswerLedger>,
    #[serde(rename = "leaseRequestId")]
    pub lease_request_id: String,
    #[serde(rename = "clientStoreId")]
    pub client_store_id: String,
    #[serde(rename = "queryKey")]
    pub query_key: String,
    #[serde(rename = "queryInstanceId")]
    pub query_instance_id: u64,
}

impl AuthorizedLeaseQueryRequest {
    fn into_parts(self) -> (HandlerInput, AuthorizedLeaseRequestIdentity) {
        (
            HandlerInput {
                args: self.args,
                auth: self.auth,
                read_set: self.read_set,
                correlation: self.correlation,
                ctx_ledger: self.ctx_ledger,
            },
            AuthorizedLeaseRequestIdentity {
                lease_request_id: self.lease_request_id,
                client_store_id: self.client_store_id,
                query_key: self.query_key,
                query_instance_id: self.query_instance_id,
            },
        )
    }
}

/// Query rows and their authorization proof are one response boundary. The
/// client must commit both together or delete the attempted retained result.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizedLeaseQueryResponse {
    pub version: u64,
    pub rows: Vec<Value>,
    pub authorized_lease: AuthorizedLease,
}

impl AuthorizedLeaseQueryResponse {
    fn from_parts(output: QueryOutput, authorized_lease: AuthorizedLease) -> Self {
        let QueryOutput { version, rows } = output;
        Self {
            version,
            rows,
            authorized_lease,
        }
    }
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
    AgentCredentialBody,
    AgentFamilySecretBody,
    /// A bearer accepted only by the opaque revoke-only family alarm.
    FamilyAlarmBearer,
    LegacyBodyAuth,
    ConnectionGrantHeader,
    ConnectionGrantHeaderOrWebSocketSubprotocol,
    ConnectionGrantHeaderOrDevQuery,
    BoundConnectionGrant,
    AdminCredential,
    OptionalSessionBearer,
    OptionalSessionOrScopedToken,
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

    pub const fn app_function_session() -> Self {
        Self {
            path_policy: Some(RoutePolicy::Public),
            credential_resolution: Some(CredentialResolution::OptionalSessionOrScopedToken),
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
                    | CredentialResolution::AgentCredentialBody
                    | CredentialResolution::AgentFamilySecretBody
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
        if self.credential_resolution == CredentialResolution::AgentCredentialBody
            && (self.path_policy != RoutePolicy::Public
                || self.invocation_authority != InvocationAuthority::None
                || self.response_sensitivity != ResponseSensitivity::CredentialSecret)
        {
            return fail(
                "agent credential body must be public, install no caller, and return only a credential-secret response",
            );
        }
        if self.credential_resolution == CredentialResolution::AgentFamilySecretBody
            && (self.path_policy != RoutePolicy::Public
                || self.invocation_authority != InvocationAuthority::None
                || self.response_sensitivity != ResponseSensitivity::PublicNoStore)
        {
            return fail(
                "agent family secret body must be public, install no caller, and return an opaque no-store response",
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
                || !matches!(
                    sessions.credential_resolution,
                    CredentialResolution::OptionalSessionBearer
                        | CredentialResolution::OptionalSessionOrScopedToken
                )
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
                    | CredentialResolution::AgentCredentialBody
                    | CredentialResolution::AgentFamilySecretBody
                    | CredentialResolution::FamilyAlarmBearer
                    | CredentialResolution::OptionalSessionBearer
                    | CredentialResolution::OptionalSessionOrScopedToken
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

const fn app_function_route(method: &'static str, path: &'static str) -> RouteSpec {
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
    .with_session_overlay(SessionModeOverlay::app_function_session())
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
        // @ref LLP 0058#bootstrap-handshake — discovery is the sole auth path
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
        // @ref LLP 0057#routes-operations-and-dtos — provider routes carry
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
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/step-up/request",
                RouteClass::AppData,
                RoutePolicy::SessionAuth,
                CredentialResolution::RequiredSessionBearer,
                InvocationAuthority::ResolvedCaller,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::SensitiveApplicationData,
            ),
            post(auth_step_up_request).layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/pairing-codes",
                RouteClass::AppData,
                RoutePolicy::SessionAuth,
                CredentialResolution::RequiredSessionBearer,
                InvocationAuthority::ResolvedCaller,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::CredentialSecret,
            ),
            post(auth_pairing_code).layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/agents/pair",
                RouteClass::AppData,
                RoutePolicy::Public,
                CredentialResolution::AgentCredentialBody,
                InvocationAuthority::None,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::CredentialSecret,
            ),
            post(auth_agent_pair).layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "GET",
                "/auth/grant-requests",
                RouteClass::AppData,
                RoutePolicy::SessionAuth,
                CredentialResolution::RequiredSessionBearer,
                InvocationAuthority::ResolvedCaller,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::SensitiveApplicationData,
            ),
            get(auth_grant_requests).layer(DefaultBodyLimit::max(0)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/grant-requests/{id}/approve",
                RouteClass::AppData,
                RoutePolicy::SessionAuth,
                CredentialResolution::RequiredSessionBearer,
                InvocationAuthority::ResolvedCaller,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::SensitiveApplicationData,
            ),
            post(auth_grant_request_approve)
                .layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/grant-requests/{id}/deny",
                RouteClass::AppData,
                RoutePolicy::SessionAuth,
                CredentialResolution::RequiredSessionBearer,
                InvocationAuthority::ResolvedCaller,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::SensitiveApplicationData,
            ),
            post(auth_grant_request_deny)
                .layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "GET",
                "/auth/grants",
                RouteClass::AppData,
                RoutePolicy::SessionAuth,
                CredentialResolution::RequiredSessionBearer,
                InvocationAuthority::ResolvedCaller,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::SensitiveApplicationData,
            ),
            get(auth_grants).layer(DefaultBodyLimit::max(0)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "DELETE",
                "/auth/grants/by-actor/{actor_id}",
                RouteClass::AppData,
                RoutePolicy::SessionAuth,
                CredentialResolution::RequiredSessionBearer,
                InvocationAuthority::ResolvedCaller,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::SensitiveApplicationData,
            ),
            delete(auth_grants_revoke_by_actor).layer(DefaultBodyLimit::max(0)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "DELETE",
                "/auth/grants/{id}",
                RouteClass::AppData,
                RoutePolicy::SessionAuth,
                CredentialResolution::RequiredSessionBearer,
                InvocationAuthority::ResolvedCaller,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::SensitiveApplicationData,
            ),
            delete(auth_grant_revoke).layer(DefaultBodyLimit::max(0)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/agents/rotate",
                RouteClass::AppData,
                RoutePolicy::Public,
                CredentialResolution::AgentCredentialBody,
                InvocationAuthority::None,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::CredentialSecret,
            ),
            post(auth_agent_rotate).layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/agents/token",
                RouteClass::AppData,
                RoutePolicy::Public,
                CredentialResolution::AgentCredentialBody,
                InvocationAuthority::None,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::CredentialSecret,
            ),
            post(auth_agent_token).layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(
            RouteSpec::new(
                "POST",
                "/auth/agents/revoke-self",
                RouteClass::AppData,
                RoutePolicy::Public,
                CredentialResolution::AgentFamilySecretBody,
                InvocationAuthority::None,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::PublicNoStore,
            ),
            post(auth_agent_revoke_self).layer(DefaultBodyLimit::max(AUTH_REQUEST_BODY_LIMIT)),
        ),
        RegisteredRoute::new(app_function_route("POST", "/query/{name}"), post(invoke_query)),
        RegisteredRoute::new(
            app_auth_route("POST", "/query/{name}/authorized-lease"),
            post(invoke_authorized_lease_query),
        ),
        RegisteredRoute::new(
            app_auth_route("POST", "/client-mutations/acknowledge"),
            post(acknowledge_mutations),
        ),
        RegisteredRoute::new(
            app_function_route("POST", "/mutation/{name}"),
            post(invoke_mutation),
        ),
        RegisteredRoute::new(
            app_function_route("POST", "/action/{name}"),
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
                credential_resolution: Some(CredentialResolution::OptionalSessionOrScopedToken),
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
                "/live/authorization-invalidation/acknowledge",
                CredentialResolution::ConnectionGrantHeader,
                true,
                ResponseSensitivity::ApplicationData,
            ),
            post(acknowledge_authorization_invalidation),
        ),
        RegisteredRoute::new(
            connection_route(
                "POST",
                "/live/authorization-invalidation/manual-retry",
                CredentialResolution::ConnectionGrantHeader,
                true,
                ResponseSensitivity::ApplicationData,
            ),
            post(manual_retry_authorization_invalidation),
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
        // @ref LLP 0057#routes-operations-and-dtos — capture plaintext is an
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
    // @ref LLP 0060#c2-defenses-that-do-not-change-the-boundary — observable
    // browser defenses for Snapback-owned pages, without claiming that these
    // headers make an app-origin-readable bearer XSS-proof.
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static(
            "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
        ),
    );
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        HeaderName::from_static("x-permitted-cross-domain-policies"),
        HeaderValue::from_static("none"),
    );
    if effective.response_sensitivity == ResponseSensitivity::StaticPublic {
        // The setup page has one embedded script. The built Exact shell has
        // build-specific inline bootstrap/manifest blocks and installs its own
        // exact-byte hashes in the handler. Never overwrite that narrower
        // response-specific policy with the setup fallback.
        let csp = HeaderName::from_static("content-security-policy");
        if !headers.contains_key(&csp) {
            headers.insert(
                csp,
                static_public_content_security_policy([SETUP_SCRIPT_SHA256]),
            );
        }
        headers.insert(
            HeaderName::from_static("cross-origin-opener-policy"),
            HeaderValue::from_static("same-origin"),
        );
        headers.insert(
            HeaderName::from_static("cross-origin-resource-policy"),
            HeaderValue::from_static("same-origin"),
        );
    }
    if !matches!(
        effective.response_sensitivity,
        ResponseSensitivity::StaticPublic | ResponseSensitivity::PublicProjection
    ) {
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store, private"),
        );
    }
    response
}

const SETUP_SCRIPT_SHA256: &str = "u1Sek3P+3TIyUpvpb+7TgEM7h9B3+2FFfOgjaAdaIH0=";

/// Construct the one restrictive policy shared by Snapback-owned documents,
/// admitting only same-origin external scripts and explicitly hashed inline
/// bytes supplied by the concrete response handler.
pub(crate) fn static_public_content_security_policy<'a>(
    inline_script_sha256: impl IntoIterator<Item = &'a str>,
) -> HeaderValue {
    let mut value = String::from(
        "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'",
    );
    for digest in inline_script_sha256 {
        value.push_str(" 'sha256-");
        value.push_str(digest);
        value.push('\'');
    }
    value.push_str(
        "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; require-trusted-types-for 'script'; trusted-types snapback",
    );
    HeaderValue::try_from(value).expect("base64 SHA-256 digests form a valid CSP header")
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

/// Monotonic deadline for ingesting the body of a request that holds a
/// managed admission root. It is deliberately strictly below the auth-mode
/// quiescence deadline so every admitted finite HTTP request leaves the epoch
/// before staging's drain barrier can expire.
// @ref LLP 0058#admitted-body-ingestion — exact 20000 ms bound, strictly
// below the 30000 ms quiescence deadline (ENG-24988).
const ADMITTED_BODY_INGEST_DEADLINE_MS: u64 = 20_000;
const _: () = assert!(
    ADMITTED_BODY_INGEST_DEADLINE_MS
        < crate::auth::admission::AUTH_MODE_QUIESCENCE_TIMEOUT_MS
);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AdmittedBodyTripReason {
    /// The monotonic ingest deadline elapsed before the body finished.
    DeadlineExceeded,
    /// The admitted epoch stopped accepting (staging closed or retired it)
    /// while the body was still arriving.
    AdmissionClosed,
}

/// Shared record of whether guarded ingestion actually surfaced a refusal.
/// The middleware consults it to publish the canonical diagnostic instead of
/// whatever shape error a downstream extractor derived from the cut body.
#[derive(Default)]
struct AdmittedBodyTrip(OnceLock<AdmittedBodyTripReason>);

impl AdmittedBodyTrip {
    fn reason(&self) -> Option<AdmittedBodyTripReason> {
        self.0.get().copied()
    }

    fn record(&self, reason: AdmittedBodyTripReason) -> AdmittedBodyTripReason {
        let _ = self.0.set(reason);
        self.reason().expect("admitted body trip was just recorded")
    }
}

fn admitted_body_trip_error(reason: AdmittedBodyTripReason) -> SnapbackError {
    match reason {
        AdmittedBodyTripReason::DeadlineExceeded => SnapbackError::error(
            "SNAPBACK_REQUEST_BODY_TIMEOUT",
            "server",
            "request body was not received within the admitted ingest deadline",
        )
        .with_details(json!({ "deadlineMs": ADMITTED_BODY_INGEST_DEADLINE_MS })),
        AdmittedBodyTripReason::AdmissionClosed => SnapbackError::error(
            "SNAPBACK_AUTH_MODE_PENDING",
            "auth",
            "request body ingestion was cancelled because app-data admission closed for an auth-mode transition",
        ),
    }
}

/// Request-body wrapper for invocations holding a managed admission root.
///
/// Body bytes arrive at a rate the remote client controls, so an unterminated
/// chunked upload would otherwise retain its admission root indefinitely and
/// force every auth-mode activation into `SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT`.
/// This guard bounds ingestion with a monotonic deadline strictly below the
/// quiescence deadline and cancels the read as soon as the admitted epoch
/// stops accepting, releasing the lease without waiting for the client.
///
/// @ref LLP 0058#admitted-body-ingestion — admitted ingestion is finite and
/// epoch-close aware; size-bound refusals keep their own diagnostic.
struct AdmittedBodyGuard {
    inner: Body,
    trip: Arc<AdmittedBodyTrip>,
    deadline: std::pin::Pin<Box<tokio::time::Sleep>>,
    epoch_close: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'static>>,
}

impl AdmittedBodyGuard {
    fn wrap(
        request: Request<Body>,
        admission: &AdmissionLease,
        controller: AuthAdmissionController,
    ) -> (Request<Body>, Arc<AdmittedBodyTrip>) {
        let trip = Arc::new(AdmittedBodyTrip::default());
        let admitted_epoch = admission.admission_epoch();
        // The watch owns only the controller handle, never a lease clone, so
        // the guard cannot extend the in-flight lifetime it exists to bound.
        let epoch_close = Box::pin(async move {
            let mut snapshot = controller.snapshot();
            while snapshot.admission_epoch == admitted_epoch && snapshot.accepting {
                snapshot = controller.changed(snapshot).await;
            }
        });
        let (parts, body) = request.into_parts();
        let guard = Self {
            inner: body,
            trip: trip.clone(),
            deadline: Box::pin(tokio::time::sleep(tokio::time::Duration::from_millis(
                ADMITTED_BODY_INGEST_DEADLINE_MS,
            ))),
            epoch_close,
        };
        (Request::from_parts(parts, Body::new(guard)), trip)
    }

    fn trip_frame(
        &self,
        reason: AdmittedBodyTripReason,
    ) -> std::task::Poll<Option<Result<http_body::Frame<Bytes>, axum::Error>>> {
        std::task::Poll::Ready(Some(Err(axum::Error::new(admitted_body_trip_error(
            reason,
        )))))
    }
}

impl HttpBody for AdmittedBodyGuard {
    type Data = Bytes;
    type Error = axum::Error;

    fn poll_frame(
        self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Result<http_body::Frame<Self::Data>, Self::Error>>> {
        let this = self.get_mut();
        // A tripped guard is terminal even if the consumer keeps polling.
        if let Some(reason) = this.trip.reason() {
            return this.trip_frame(reason);
        }
        // Frames that already arrived always win the race; the guard only
        // decides what happens while the network has nothing to deliver.
        if let std::task::Poll::Ready(frame) = std::pin::Pin::new(&mut this.inner).poll_frame(context)
        {
            return std::task::Poll::Ready(frame);
        }
        if this.epoch_close.as_mut().poll(context).is_ready() {
            let reason = this.trip.record(AdmittedBodyTripReason::AdmissionClosed);
            return this.trip_frame(reason);
        }
        if this.deadline.as_mut().poll(context).is_ready() {
            let reason = this.trip.record(AdmittedBodyTripReason::DeadlineExceeded);
            return this.trip_frame(reason);
        }
        std::task::Poll::Pending
    }

    fn is_end_stream(&self) -> bool {
        self.trip.reason().is_none() && self.inner.is_end_stream()
    }

    fn size_hint(&self) -> http_body::SizeHint {
        self.inner.size_hint()
    }
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

fn settled_function_load_mode(runtime: &AppState) -> SnapbackResult<AuthMode> {
    if auth_transition_pending(runtime) {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_MODE_PENDING",
            "auth",
            "functions.load is unavailable until auth mode is settled and app data is available",
        ));
    }
    Ok(runtime.auth_mode_state().active)
}

fn auth_diagnostic_app_route(path: &str) -> bool {
    matches!(path, "/" | "/health" | "/auth/session")
}

/// Central app-data availability fence. System/operator routes retain their
/// own registered policies; the one pending recovery branch is selected and
/// authorized later by the `/app/ensure` operation gate.
// @ref LLP 0060#d1-plaintext-listener-fence — repeat the startup transport
// refusal for embedded/router composition without claiming proxy/TLS posture.
fn auth_app_data_refusal(spec: RouteSpec, runtime: &AppState) -> Option<SnapbackError> {
    if spec.class != RouteClass::AppData {
        return None;
    }
    // @ref LLP 0060#d5-hosted-readiness-is-conjunctive — the local target
    // cannot turn operator flags or proxy topology into hosted edge authority.
    // CLI composition refuses pre-bind; this repeats the refusal for embedded
    // routers while leaving diagnostic health/identity reachable.
    if runtime.server.auth_deployment == crate::auth::deployment::AuthDeploymentTarget::Hosted
        && !matches!(spec.path, "/" | "/health")
    {
        return Some(crate::auth::deployment::deployment_unsupported(
            crate::auth::deployment::HostedAuthCapabilities::local_target(),
        ));
    }
    // Health is the sole request-path diagnostic that may remain reachable on
    // an already-composed insecure listener. Apply the shared transport fence
    // before the `/` and bootstrap-handshake diagnostic exemptions so neither
    // active nor merely desired sessions can consume a bearer over plaintext.
    if spec.path == "/health" {
        return None;
    }
    let mode_state = runtime.auth_mode_state();
    let policy_posture = runtime.policy_auth_posture();
    let transport_active = if mode_state.active == crate::manifest::AuthMode::Sessions
        || policy_posture.active == PolicyAuthMode::Sessions
    {
        crate::manifest::AuthMode::Sessions
    } else {
        crate::manifest::AuthMode::Dev
    };
    let transport_desired = if mode_state.desired == crate::manifest::AuthMode::Sessions
        || policy_posture.desired == PolicyAuthMode::Sessions
    {
        crate::manifest::AuthMode::Sessions
    } else {
        crate::manifest::AuthMode::Dev
    };
    let session_transport = transport_active == crate::manifest::AuthMode::Sessions
        || transport_desired == crate::manifest::AuthMode::Sessions;
    let listener_loopback = match runtime.server.listener_transport_loopback() {
        Some(loopback) => loopback,
        None if session_transport => {
            return Some(SnapbackError::error(
                "SNAPBACK_AUTH_TRANSPORT_INSECURE",
                "auth",
                "desired or active sessions require listener-owned loopback transport evidence",
            ));
        }
        None => runtime.server.loopback,
    };
    if let Err(error) = crate::admin::validate_plaintext_auth_transport(
        listener_loopback,
        runtime.server.profile,
        transport_active,
        transport_desired,
        runtime.allow_insecure_dev_auth,
    ) {
        return Some(error);
    }
    if auth_diagnostic_app_route(spec.path) {
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
    if AuthClientProtocolOffers::from_http_headers(headers).auth_client != Some(AUTH_PROTOCOL_V1) {
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

fn live_function_name(spec: RouteSpec, path: &str) -> Option<&str> {
    let suffix = match spec.path {
        "/live/{name}/subscribe" => "/subscribe",
        "/live/{name}/resume" => "/resume",
        "/live/{name}/unsubscribe" => "/unsubscribe",
        _ => return None,
    };
    let name = path.strip_prefix("/live/")?.strip_suffix(suffix)?;
    (!name.is_empty() && !name.contains('/')).then_some(name)
}

/// Item 5 deliberately enables finite session work before LLP 0053's
/// invalidation protocol lands. The exception is narrow: only a manifest-
/// proved authority-independent durable live function, or an unprotected
/// ephemeral room, may cross the live gate in that interval.
///
/// @ref LLP 0058#live-and-replay-admission-before-later-items — refuse
///   auth-scoped live before query/materialization until invalidation exists.
async fn session_live_protocol_refusal(
    spec: RouteSpec,
    runtime: &AppState,
    headers: &HeaderMap,
    path: &str,
    body: Option<&Value>,
) -> Option<SnapbackError> {
    if runtime.auth_mode_state().active != crate::manifest::AuthMode::Sessions {
        return None;
    }

    let auth_scoped = if let Some(function) = live_function_name(spec, path) {
        let function = function.to_owned();
        !with_snapback(&runtime.snapback, move |snapback| {
            snapback.function_is_authority_independent(&function)
        })
        .await
    } else if spec.path == "/ephemeral/subscribe" {
        body.and_then(Value::as_object)
            .and_then(|body| body.get("collection"))
            .and_then(Value::as_str)
            .and_then(|collection| {
                runtime
                    .ephemeral
                    .subscription_requires_permission(collection)
            })
            .unwrap_or(false)
    } else {
        false
    };
    if !auth_scoped {
        return None;
    }

    if !runtime.auth_program_readiness().authorization_invalidation {
        return Some(
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                "auth",
                "auth-scoped live work is unavailable until authorization invalidation is ready",
            )
            .with_details(json!({ "capability": "authScopedLive" })),
        );
    }
    if AuthClientProtocolOffers::from_http_headers(headers).auth_invalidation
        != Some(AUTH_PROTOCOL_V1)
    {
        return Some(
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                "auth",
                "auth-scoped live work requires the exact authorization-invalidation protocol",
            )
            .with_details(json!({
                "capability": "authScopedLive",
                "minimumAuthInvalidationProtocol": AUTH_PROTOCOL_V1,
            })),
        );
    }
    None
}

fn registered_invocation_source(spec: RouteSpec) -> Option<InvocationSource> {
    match spec.path {
        "/auth/session" => Some(InvocationSource::BootstrapHandshake),
        "/auth/refresh" => Some(InvocationSource::AuthRefresh),
        "/auth/logout" => Some(InvocationSource::AuthLogout),
        "/auth/step-up/request"
        | "/auth/pairing-codes"
        | "/auth/grant-requests"
        | "/auth/grant-requests/{id}/approve"
        | "/auth/grant-requests/{id}/deny"
        | "/auth/grants"
        | "/auth/grants/by-actor/{actor_id}"
        | "/auth/grants/{id}" => Some(InvocationSource::AgentGrantManagement),
        "/query/{name}" => Some(InvocationSource::HttpQuery),
        "/query/{name}/authorized-lease" => Some(InvocationSource::HttpQuery),
        "/mutation/{name}" => Some(InvocationSource::HttpMutation),
        "/action/{name}" => Some(InvocationSource::HttpAction),
        "/client-mutations/acknowledge"
        | "/live/authorization-invalidation/acknowledge"
        | "/live/authorization-invalidation/manual-retry" => {
            Some(InvocationSource::StandaloneAcknowledgement)
        }
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
    resolved_connection_authority: Option<&ResolvedAppAuthority>,
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
        let offered =
            AuthClientProtocolOffers::from_http_headers(headers).authority_descriptor;
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
    let (resolved, fenced_publication) = if let Some(resolved) = resolved_connection_authority {
        // Connection open/acts already carry the exact bound publication
        // fence. The caller installs that fence after the shared invocation
        // gate has projected this resolved authority.
        (resolved.clone(), None)
    } else {
        match active_mode {
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
                    (dev_host_operation_authority(handler_value), None)
                } else if effective.invocation_authority == InvocationAuthority::ClientAsserted
                    || source == InvocationSource::DirectAdminRunner
                {
                    (dev_body_authority(handler_value), None)
                } else {
                    (ResolvedAppAuthority::Anonymous, None)
                }
            }
            crate::manifest::AuthMode::Sessions => {
                let coordinator = installed_auth_coordinator(runtime)?;
                if matches!(
                    source,
                    InvocationSource::DirectAdminRunner
                        | InvocationSource::HostOperationFunctionRun
                        | InvocationSource::HostOperationMutationDryRun
                ) {
                    (
                        ResolvedAppAuthority::AdminBypass {
                            reason: "administrative application invocation".to_owned(),
                        },
                        Some(
                            coordinator
                                .prepare_anonymous_publication()
                                .map_err(ApiError::from)?,
                        ),
                    )
                } else if matches!(
                    effective.credential_resolution,
                    CredentialResolution::OptionalSessionBearer
                        | CredentialResolution::OptionalSessionOrScopedToken
                        | CredentialResolution::RequiredSessionBearer
                ) && (effective.credential_resolution
                    == CredentialResolution::RequiredSessionBearer
                    || headers.contains_key(header::AUTHORIZATION))
                {
                    // Invalid and duplicate Authorization values remain
                    // presented-invalid credentials. Finite request resolution
                    // is projection-only and never falls through to provider or
                    // SQLite.
                    let bearer = auth_bearer(headers).unwrap_or_default().to_owned();
                    let provider = installed_auth_provider(runtime)?;
                    let now_ms = provider.now_ms();
                    if effective.credential_resolution
                        == CredentialResolution::OptionalSessionOrScopedToken
                        && classify_credential(&bearer) == Some(CredentialClass::ScopedToken)
                    {
                        dispatch_credential_class(&bearer, CredentialClass::ScopedToken)
                            .map_err(|error| ApiError::from(error.into_snapback_error()))?;
                        let token = ScopedToken::parse(&bearer).map_err(|_| {
                            ApiError::from(SnapbackError::error(
                                "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                                "auth",
                                "scoped agent token is invalid",
                            ))
                        })?;
                        let resolved = with_snapback(&runtime.snapback, move |snapback| {
                            snapback
                                .auth_database_mut()
                                .resolve_scoped_token(&token, now_ms)
                        })
                        .await?;
                        (ResolvedAppAuthority::from_scoped_token(resolved), None)
                    } else {
                        if classify_credential(&bearer).is_some_and(|class| {
                            class != CredentialClass::Session
                        }) {
                            dispatch_credential_class(&bearer, CredentialClass::Session)
                                .map_err(|error| {
                                    ApiError::from(error.into_snapback_error())
                                })?;
                            unreachable!("wrong-class dispatch always refuses");
                        }
                        let prepared = if matches!(
                            source,
                            InvocationSource::AuthRefresh | InvocationSource::AuthLogout
                        ) {
                            coordinator.resolve_family_bearer(
                                &bearer,
                                now_ms,
                                provider.monotonic_now(),
                            )
                        } else {
                            coordinator.resolve_required_bearer(
                                &bearer,
                                now_ms,
                                provider.monotonic_now(),
                            )
                        }
                        .map_err(ApiError::from)?;
                        let (resolved, publication) = prepared.into_parts();
                        (resolved, Some(publication))
                    }
                } else {
                    (
                        ResolvedAppAuthority::Anonymous,
                        Some(
                            coordinator
                                .prepare_anonymous_publication()
                                .map_err(ApiError::from)?,
                        ),
                    )
                }
            }
        }
    };
    let authority = InvocationGate::prepare_admitted_authority(
        source,
        active_mode,
        runtime.server.profile,
        admission.clone(),
        &wire,
        resolved,
    )
    .map_err(ApiError::from)?;
    Ok(Some(match fenced_publication {
        Some(publication) => authority.with_fenced_publication(publication),
        None => authority,
    }))
}

async fn record_successful_finite_session_use(
    runtime: &AppState,
    authority: &PreparedAuthority,
) -> Result<(), ApiError> {
    let ResolvedAppAuthority::Session {
        session_id,
        generation,
        ..
    } = authority.resolved()
    else {
        return Ok(());
    };
    let provider = installed_auth_provider(runtime)?;
    let coordinator = installed_auth_coordinator(runtime)?;
    let provider_admission = provider.admit().await;
    let session_id = session_id.clone();
    let expected_generation = *generation;
    let now_ms = provider.now_ms();
    let effect_authority = authority.clone();
    let outcome = with_snapback(&runtime.snapback, move |snapback| {
        let _effect = effect_authority
            .effect_guard("authenticated-use expiry transaction")
            .map_err(ProviderError::from)?;
        provider_admission.record_authenticated_use(
            snapback.auth_database_mut(),
            &session_id,
            expected_generation,
            now_ms,
        )
    })
    .await
    .map_err(map_provider_error)?;
    coordinator
        .finalize_authenticated_use(
            match authority.resolved() {
                ResolvedAppAuthority::Session { session_id, .. } => session_id,
                _ => unreachable!("checked session authority"),
            },
            expected_generation,
            outcome,
            now_ms,
            provider.monotonic_now(),
        )
        .map_err(ApiError::from)?;
    Ok(())
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
                | "/_snapback/api/functions/load"
                | "/_snapback/api/host-ops"
                | "/_snapback/api/app/reset"
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
            Ok(mode_publication) => {
                let controlled = apply_registered_response_controls(effective, response);
                let committed_outcome = controlled
                    .extensions()
                    .get::<CommittedAuthOutcome>()
                    .cloned();
                let published = match committed_outcome {
                    Some(outcome) => {
                        let response_class = match controlled.status() {
                            StatusCode::NO_CONTENT => {
                                Some(CommittedAuthResponseClass::LogoutNoContent)
                            }
                            StatusCode::ACCEPTED => {
                                Some(CommittedAuthResponseClass::FamilyAlarmAccepted)
                            }
                            _ => None,
                        };
                        match response_class {
                            Some(response_class) => outcome.try_publish(
                                response_class,
                                now_millis(),
                                Instant::now(),
                                || Ok(controlled),
                            ),
                            None => Err(SnapbackError::error(
                                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                                "auth",
                                "committed auth outcome was attached to an unsupported response",
                            )),
                        }
                    }
                    None => match authority {
                        Some(authority) => {
                            authority
                                .try_publish_fenced(now_millis(), Instant::now(), || Ok(controlled))
                        }
                        None => Ok(Some(controlled)),
                    },
                };
                let response = match published {
                    Ok(Some(response)) => response,
                    Ok(None) => {
                        let error = match authority {
                            Some(authority) => stale_prepared_authority(authority),
                            None => SnapbackError::error(
                                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                                "auth",
                                "the authorization stream changed before response publication",
                            ),
                        };
                        apply_registered_response_controls(
                            effective,
                            ApiError::from(error).into_response(),
                        )
                    }
                    Err(error) => apply_registered_response_controls(
                        effective,
                        ApiError::from(error).into_response(),
                    ),
                };
                drop(mode_publication);
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
    let publication_authority = response
        .extensions_mut()
        .remove::<RetainedRealtimeAuthority>();
    if let Some(admission) = admission {
        let (parts, body) = response.into_parts();
        let body = Body::new(RetainedAdmissionBody {
            inner: body,
            _admission: admission.clone(),
            _authority: authority.cloned(),
            _publication_authority: publication_authority,
            realtime_handoff_committed: false,
            realtime_handoff_failed: false,
        });
        Response::from_parts(parts, body)
    } else {
        debug_assert!(publication_authority.is_none());
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
    _publication_authority: Option<RetainedRealtimeAuthority>,
    realtime_handoff_committed: bool,
    realtime_handoff_failed: bool,
}

/// Response extensions can be discarded after header encoding. The Arc makes
/// the extension cloneable while keeping the exact durable/room publication
/// permits alive until the wrapped HTTP body reaches its final transport sink
/// (or is dropped).
#[derive(Clone)]
struct RetainedRealtimeAuthority {
    _permits: Arc<Vec<RealtimePublicationPermit>>,
    outbox_leases: Arc<Vec<crate::ephemeral::OutboxDrainLease>>,
    connection_handoff: Option<RetainedConnectionHandoff>,
}

#[derive(Clone)]
struct RetainedConnectionHandoff {
    connections: ConnectionRegistry,
    ephemeral: EphemeralApi,
    connection_act: PreparedConnectionAct,
    auth_provider: Option<Arc<AuthProvider>>,
}

impl RetainedRealtimeAuthority {
    fn acknowledge_outbox_leases(&self) -> bool {
        match self.connection_handoff.as_ref() {
            None => crate::ephemeral::OutboxDrainLease::acknowledge_all(&self.outbox_leases),
            Some(handoff) => {
                // @ref LLP 0059#act-time-validation — the exact leaf/grant
                // check and leased HTTP ownership acceptance share one final
                // publication -> registry -> outbox cut.
                // Connection routes install the same stream/session
                // publication handle in PreparedAuthority and this exact act.
                // Use it once (non-reentrant) to make leaf validation,
                // grant-current validation, and batch acknowledgement one
                // publication → registry → outbox cut.
                let (epoch_now_ms, monotonic_now) = handoff.auth_provider.as_ref().map_or_else(
                    || (now_millis(), Instant::now()),
                    |provider| (provider.now_ms(), provider.monotonic_now()),
                );
                handoff
                    .connection_act
                    .try_act(&handoff.connections, epoch_now_ms, monotonic_now, || {
                        Ok(handoff.ephemeral.acknowledge_outbox_handoff_bound(
                            &handoff.connection_act.connection_id,
                            &handoff.connection_act.effect_fence(),
                            &self.outbox_leases,
                        ))
                    })
                    .unwrap_or(false)
            }
        }
    }
}

fn retain_room_authority(mut response: Response, permit: Option<RoomAuthorityPermit>) -> Response {
    if let Some(permit) = permit {
        retain_realtime_authority_in(&mut response, vec![RealtimePublicationPermit::Room(permit)]);
    }
    response
}

fn retain_realtime_authority_in(response: &mut Response, permits: Vec<RealtimePublicationPermit>) {
    retain_realtime_handoff_in(response, permits, Vec::new(), None);
}

fn retain_realtime_handoff_in(
    response: &mut Response,
    permits: Vec<RealtimePublicationPermit>,
    outbox_leases: Vec<crate::ephemeral::OutboxDrainLease>,
    connection_handoff: Option<RetainedConnectionHandoff>,
) {
    if !permits.is_empty() || !outbox_leases.is_empty() || connection_handoff.is_some() {
        response.extensions_mut().insert(RetainedRealtimeAuthority {
            _permits: Arc::new(permits),
            outbox_leases: Arc::new(outbox_leases),
            connection_handoff,
        });
    }
}

impl HttpBody for RetainedAdmissionBody {
    type Data = Bytes;
    type Error = axum::Error;

    fn poll_frame(
        self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Result<http_body::Frame<Self::Data>, Self::Error>>> {
        let this = self.get_mut();
        if this.realtime_handoff_failed {
            return std::task::Poll::Ready(None);
        }
        let Ok(publication) = this
            ._admission
            .effect_guard("HTTP response body frame publication")
        else {
            // EOF is terminal even if the consumer retains the Body object.
            // Release every leased frame/publication permit at the failed
            // mode-root cut instead of parking the globally active batch
            // until object destruction.
            this.realtime_handoff_failed = true;
            this._publication_authority = None;
            return std::task::Poll::Ready(None);
        };
        // Authority was validated exactly once when the complete response was
        // transferred into this body. Network flushing happens later without
        // rechecking the leaf; only the mode-admission root remains live per
        // frame so a retired mode cannot keep producing bytes.
        // Poll into a local first. No byte is yielded until the complete leased
        // set validates and is acknowledged at this response-body ownership
        // boundary. Pending/error/drop leaves every frame physically queued.
        let frame = std::pin::Pin::new(&mut this.inner).poll_frame(context);
        if !this.realtime_handoff_committed {
            match &frame {
                std::task::Poll::Ready(Some(Ok(_))) => {
                    let committed = this
                        ._publication_authority
                        .as_ref()
                        .is_none_or(RetainedRealtimeAuthority::acknowledge_outbox_leases);
                    if !committed {
                        this.realtime_handoff_failed = true;
                        this._publication_authority = None;
                        drop(publication);
                        return std::task::Poll::Ready(None);
                    }
                    this.realtime_handoff_committed = true;
                }
                std::task::Poll::Ready(Some(Err(_))) | std::task::Poll::Ready(None) => {
                    this.realtime_handoff_failed = true;
                    this._publication_authority = None;
                }
                std::task::Poll::Pending => {}
            }
        }
        drop(publication);
        frame
    }

    fn is_end_stream(&self) -> bool {
        self.realtime_handoff_failed || self.inner.is_end_stream()
    }

    fn size_hint(&self) -> http_body::SizeHint {
        self.inner.size_hint()
    }
}

fn stale_prepared_authority(authority: &PreparedAuthority) -> SnapbackError {
    match authority.resolved() {
        ResolvedAppAuthority::Session { .. } => SnapbackError::error(
            "SNAPBACK_AUTH_SESSION_EXPIRED",
            "auth",
            "authentication session is no longer current",
        ),
        _ => SnapbackError::error(
            "SNAPBACK_AUTH_STREAM_RESET",
            "auth",
            "the authorization stream is no longer current",
        ),
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
    if spec.path != "/connection/open"
        && let Some(error) = session_online_protocol_refusal(spec, &runtime, request.headers())
    {
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
    let mut route_admission = match acquire_registered_route_admission(spec, &runtime) {
        Ok(admission) => admission,
        Err(error) => {
            return apply_registered_response_controls(effective, error.into_response());
        }
    };
    // @ref LLP 0058#admitted-body-ingestion — the moment a request owns a
    // managed admission root, its remaining body ingestion must be finite and
    // epoch-close aware. Wrapping here covers both the policy-gate peek below
    // and handler-side extraction on routes whose body is not inspected.
    let mut admitted_body_trip = None;
    if let Some(admission) = route_admission.as_ref() {
        let (guarded, trip) =
            AdmittedBodyGuard::wrap(request, admission, runtime.auth_admission_controller());
        request = guarded;
        admitted_body_trip = Some(trip);
    }
    let registered_source = registered_invocation_source(spec);
    // @ref LLP 0058#gate-algorithm — provider SessionAuth resolves before body parsing.
    // Provider operations carry no body authority. Resolve their required
    // family bearer through the shared gate before reading or parsing the
    // handler body, and retain that exact authority through final response
    // publication. This is intentionally narrower than optional-user app
    // operations, whose wire-authority presence must be inspected first.
    let early_prepared_authority = if effective.path_policy == RoutePolicy::SessionAuth {
        let Some(source) = registered_source else {
            return finish_registered_response(
                effective,
                ApiError::from(SnapbackError::error(
                    "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                    "auth",
                    "a SessionAuth route has no registered invocation source",
                ))
                .into_response(),
                route_admission.as_ref(),
                None,
            );
        };
        match prepare_registered_route_authority(
            Some(source),
            effective,
            &runtime,
            route_admission.as_ref(),
            request.headers(),
            None,
            None,
        )
        .await
        {
            Ok(Some(authority)) => Some(authority),
            Ok(None) => {
                return finish_registered_response(
                    effective,
                    ApiError::from(SnapbackError::error(
                        "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                        "auth",
                        "a SessionAuth route did not produce prepared authority",
                    ))
                    .into_response(),
                    route_admission.as_ref(),
                    None,
                );
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
    } else {
        None
    };
    // Session-owned management routes account against the resolved effective
    // user before body inspection. One user's malformed requests therefore
    // cannot consume another user's budget.
    if let Some(authority) = early_prepared_authority.as_ref()
        && agent_route_throttle_limit(spec.path).is_some()
    {
        let ResolvedAppAuthority::Session { user_id, .. } = authority.resolved() else {
            unreachable!("session-owned agent route resolved non-session authority")
        };
        if let Err(error) = runtime.connections.consume_agent_route(
            spec.path,
            AgentRouteThrottleSource::Session(user_id.clone()),
            Instant::now(),
        ) {
            return finish_registered_response(
                effective,
                error.into_response(),
                route_admission.as_ref(),
                None,
            );
        }
    }
    // @ref LLP 0031#enforcement — authenticate every connection carrier
    // before bounded JSON inspection. Body-carried connection ids get a
    // second exact id↔bearer check after decoding; an attacker-controlled
    // body never gets parsed merely to discover which bearer it claims.
    let mut presented_connection_token = None;
    let mut prepared_connection_act = None;
    if effective.path_policy == RoutePolicy::ConnectionAuth {
        let presented = connection_token_for_request(effective, &request);
        let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
        let verified: Result<Option<PreparedConnectionAct>, ApiError> =
            match connection_id_from_request_path(request.uri().path()) {
                Some(connection_id) => runtime
                    .connections
                    .prepare_act(
                        connection_id,
                        presented.as_deref(),
                        runtime.auth_coordinator.as_deref(),
                        runtime.auth_mode_state().active == AuthMode::Dev,
                        epoch_now_ms,
                        monotonic_now,
                    )
                    .map(Some),
                None => runtime
                    .connections
                    .authenticate_presented_bearer(presented.as_deref())
                    .map(|()| None),
            };
        match verified {
            Ok(prepared) => prepared_connection_act = prepared,
            Err(error) => {
                return finish_registered_response(
                    effective,
                    error.into_response(),
                    route_admission.as_ref(),
                    None,
                );
            }
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
        || agent_route_throttle_limit(spec.path).is_some()
        || registered_source.is_some_and(|source| {
            !matches!(
                source,
                InvocationSource::AuthRefresh | InvocationSource::AuthLogout
            )
        })
        || effective.effect_policy == EffectPolicy::SecretReadMintProof;
    let connection_open_bearer = (spec.path == "/connection/open")
        .then(|| OwnedPresentedSessionBearer::from_headers(request.headers()));
    let mut policy_body = None;
    if inspect_body {
        match peek_policy_json_body(request).await {
            Ok((rebuilt, body)) => {
                request = rebuilt;
                policy_body = body;
            }
            Err(error) => {
                // A guarded ingest refusal outranks the peek's size-bound
                // shape error: the buffering was cut by the ingest deadline or
                // an epoch close, not by the request exceeding the limit. The
                // size-bound diagnostic is untouched when the guard did not
                // trip (LLP 0058#admitted-body-ingestion).
                let error = match admitted_body_trip.as_ref().and_then(|trip| trip.reason()) {
                    Some(reason) => ApiError::from(admitted_body_trip_error(reason)),
                    None => error,
                };
                // Request-shape parsing is ordered before credential
                // classification, but rejected attempts still consume their
                // exact closed source bucket. Only a throttle replaces the
                // already-selected shape error; every other credential result
                // stays private on this rejected request.
                if let Some(presented) = connection_open_bearer.as_ref() {
                    let (_, monotonic_now) = auth_runtime_now(&runtime);
                    if let Err(accounting_error) = account_connection_open_attempt(
                        &runtime,
                        presented.as_presented(),
                        monotonic_now,
                    ) && accounting_error.0.diagnostic.code == "SNAPBACK_AUTH_THROTTLED"
                    {
                        return finish_registered_response(
                            effective,
                            accounting_error.into_response(),
                            route_admission.as_ref(),
                            None,
                        );
                    }
                }
                if agent_route_throttle_limit(spec.path).is_some()
                    && early_prepared_authority.is_none()
                    && let Err(accounting_error) = runtime.connections.consume_agent_route(
                        spec.path,
                        AgentRouteThrottleSource::Malformed,
                        Instant::now(),
                    )
                    && accounting_error.0.diagnostic.code == "SNAPBACK_AUTH_THROTTLED"
                {
                    return finish_registered_response(
                        effective,
                        accounting_error.into_response(),
                        route_admission.as_ref(),
                        None,
                    );
                }
                return finish_registered_response(
                    effective,
                    error.into_response(),
                    route_admission.as_ref(),
                    None,
                );
            }
        }
    }
    // Body-credential routes key valid attempts by the one-way bearer hash.
    // Invalid shapes and the bounded overflow of distinct presented hashes
    // share a coarse malformed bucket, preventing an attacker from growing
    // the process-local key set without limit.
    if agent_route_throttle_limit(spec.path).is_some() && early_prepared_authority.is_none() {
        let source = agent_body_throttle_source(policy_body.as_ref());
        if let Err(error) = runtime
            .connections
            .consume_agent_route(spec.path, source, Instant::now())
        {
            return finish_registered_response(
                effective,
                error.into_response(),
                route_admission.as_ref(),
                None,
            );
        }
    }
    let connection_open_protocol_error = connection_open_bearer
        .as_ref()
        .and_then(|_| session_online_protocol_refusal(spec, &runtime, request.headers()));
    let prepared_connection_open = if let Some(presented) = connection_open_bearer.as_ref() {
        if connection_open_protocol_error.is_some() {
            let (_, monotonic_now) = auth_runtime_now(&runtime);
            if let Err(accounting_error) =
                account_connection_open_attempt(&runtime, presented.as_presented(), monotonic_now)
                && accounting_error.0.diagnostic.code == "SNAPBACK_AUTH_THROTTLED"
            {
                return finish_registered_response(
                    effective,
                    accounting_error.into_response(),
                    route_admission.as_ref(),
                    None,
                );
            }
            None
        } else {
            let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
            match prepare_connection_open_authority_with_scoped_token(
                &runtime,
                presented.as_presented(),
                epoch_now_ms,
                monotonic_now,
            )
            .await
            {
                Ok(prepared) => Some(prepared),
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
    } else {
        None
    };
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
    if let Some(protocol_error) = connection_open_protocol_error {
        return finish_registered_response(
            effective,
            ApiError::from(protocol_error).into_response(),
            route_admission.as_ref(),
            None,
        );
    }
    if let Some(error) = session_live_protocol_refusal(
        spec,
        &runtime,
        request.headers(),
        request.uri().path(),
        policy_body.as_ref(),
    )
    .await
    {
        return finish_registered_response(
            effective,
            ApiError::from(error).into_response(),
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
            // The projection-backed credential resolver below is the
            // SessionAuth enforcement point. No admin/public policy may
            // substitute for its required bearer.
            RoutePolicy::SessionAuth => Ok(()),
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
    let owns_auth_transition = policy_mode == PolicyAuthMode::Sessions
        && (spec.path == "/_snapback/api/functions/load"
            || selected_operation
                .is_some_and(|(operation, _)| operation.operation == "host_ops.functions.load"));
    if owns_auth_transition {
        // Both legacy function-load ingresses are transition owners, like
        // `/app/ensure`. Authentication (and host-operation selection, when
        // applicable) has completed; release the middleware root before
        // entering the handler so the transition never waits on its own
        // response lease.
        // @ref LLP 0058#complete-candidate-pair-preflight — sessions-mode
        // legacy load carriers are one-half provisioning, never raw swaps.
        route_admission.take();
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
        let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
        let verified = match body_connection_id {
            Some(connection_id) if connection_id_in_body => runtime.connections.prepare_act(
                connection_id,
                presented_connection_token.as_deref(),
                runtime.auth_coordinator.as_deref(),
                runtime.auth_mode_state().active == AuthMode::Dev,
                epoch_now_ms,
                monotonic_now,
            ),
            _ if connection_id_in_body && policy_body.is_none() => Err(
                ApiError::request_json_invalid("connection request body was empty or malformed"),
            ),
            _ => prepared_connection_act.clone().ok_or_else(|| {
                connection_auth_error(
                    "SNAPBACK_CONNECTION_TOKEN_INVALID",
                    "connection request does not identify its authenticated grant",
                    "",
                )
            }),
        };
        match verified {
            Ok(prepared) => prepared_connection_act = Some(prepared),
            Err(error) => {
                return finish_registered_response(
                    response_policy,
                    error.into_response(),
                    route_admission.as_ref(),
                    None,
                );
            }
        }
    }

    let invocation_source =
        selected_invocation_source(spec, selected_operation.map(|(operation, _)| operation));
    let resolved_connection_authority = if policy_mode == PolicyAuthMode::Sessions {
        prepared_connection_act
            .as_ref()
            .map(|prepared| &prepared.resolved)
            .or_else(|| {
                prepared_connection_open
                    .as_ref()
                    .map(|prepared| &prepared.resolved)
            })
    } else {
        None
    };
    let prepared_authority = if let Some(authority) = early_prepared_authority {
        Some(authority)
    } else {
        match prepare_registered_route_authority(
            invocation_source,
            selected_policy,
            &runtime,
            route_admission.as_ref(),
            request.headers(),
            policy_body.as_ref(),
            resolved_connection_authority,
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
        }
    };
    let prepared_authority = prepared_authority.map(|authority| {
        let publication = prepared_connection_act
            .as_ref()
            .map(|prepared| prepared.bound.publication().clone())
            .or_else(|| {
                prepared_connection_open
                    .as_ref()
                    .map(|prepared| prepared.bound.publication().clone())
            });
        match publication {
            Some(publication) => authority.with_fenced_publication(publication),
            None => authority,
        }
    });
    if let Some(authority) = prepared_authority.as_ref() {
        request.extensions_mut().insert(authority.clone());
    }
    if let Some(admission) = route_admission.as_ref() {
        request.extensions_mut().insert(admission.clone());
    }
    if let Some(prepared) = prepared_connection_act.as_ref() {
        request.extensions_mut().insert(prepared.clone());
    }
    if let Some(prepared) = prepared_connection_open.as_ref() {
        request.extensions_mut().insert(prepared.clone());
    }
    request.extensions_mut().insert(spec);
    if let Some((operation, operation_policy)) = selected_operation {
        request.extensions_mut().insert(operation);
        request.extensions_mut().insert(operation_policy);
    } else {
        request.extensions_mut().insert(effective);
    }
    let mut response = next.run(request).await;
    // Routes whose body is consumed by the handler (not the policy peek) see
    // the guard's refusal as an extractor error of arbitrary shape. Publish
    // the canonical ingest diagnostic instead; a tripped guard proves the
    // handler could not have observed a complete request body.
    if let Some(reason) = admitted_body_trip.as_ref().and_then(|trip| trip.reason()) {
        response = ApiError::from(admitted_body_trip_error(reason)).into_response();
    }
    if response.status().is_success()
        && matches!(
            invocation_source,
            Some(
                InvocationSource::HttpQuery
                    | InvocationSource::HttpMutation
                    | InvocationSource::HttpAction
            )
        )
        && let Some(authority) = prepared_authority.as_ref()
        && let Err(error) = record_successful_finite_session_use(&runtime, authority).await
    {
        response = error.into_response();
    }
    finish_registered_response(
        response_policy,
        response,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentCredentialRequest {
    credential: SecretInput,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum AgentTokenRequest {
    Grant(AgentGrantTokenRequest),
    Pairing(AgentPairingTokenRequest),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentGrantTokenRequest {
    credential: SecretInput,
    grant_id: String,
    ttl_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentPairingTokenRequest {
    credential: SecretInput,
    pairing_request_id: String,
    ttl_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentPairRequest {
    credential: SecretInput,
    pairing_request_id: String,
    pairing_code: SecretInput,
    requested_scopes: Vec<crate::storage::auth_grants::GrantScopeRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrantApprovalRequest {
    requested_ttl_ms: Option<u64>,
    step_up: Option<StepUpProofRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StepUpProofRequest {
    challenge_id: String,
    code: SecretInput,
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
enum StepUpRequest {
    GrantApproval {
        #[serde(rename = "requestId")]
        request_id: String,
    },
}

struct PairingCodeSecretResponse {
    pairing_request_id: String,
    expires_at_ms: u64,
    pairing_code: PairingCode,
}

impl Serialize for PairingCodeSecretResponse {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("PairingCodeResponse", 3)?;
        state.serialize_field("pairingRequestId", &self.pairing_request_id)?;
        state.serialize_field("expiresAtMs", &self.expires_at_ms)?;
        state.serialize_field("pairingCode", self.pairing_code.expose_secret())?;
        state.end()
    }
}

struct AgentCredentialSecretResponse {
    credential_id: String,
    user_id: String,
    generation: u64,
    credential: AgentCredential,
}

impl Serialize for AgentCredentialSecretResponse {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("AgentCredentialResponse", 4)?;
        state.serialize_field("credentialId", &self.credential_id)?;
        state.serialize_field("userId", &self.user_id)?;
        state.serialize_field("generation", &self.generation)?;
        state.serialize_field("credential", self.credential.expose_secret())?;
        state.end()
    }
}

struct AgentTokenSecretResponse {
    token_id: String,
    grant_id: String,
    credential_id: String,
    credential_generation: u64,
    expires_at_ms: u64,
    grant_expires_at_ms: Option<u64>,
    scopes: serde_json::Value,
    token: crate::auth::crypto::ScopedToken,
}

impl Serialize for AgentTokenSecretResponse {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("AgentTokenResponse", 8)?;
        state.serialize_field("tokenId", &self.token_id)?;
        state.serialize_field("grantId", &self.grant_id)?;
        state.serialize_field("credentialId", &self.credential_id)?;
        state.serialize_field("credentialGeneration", &self.credential_generation)?;
        state.serialize_field("expiresAtMs", &self.expires_at_ms)?;
        state.serialize_field("grantExpiresAtMs", &self.grant_expires_at_ms)?;
        state.serialize_field("scopes", &self.scopes)?;
        state.serialize_field("token", self.token.expose_secret())?;
        state.end()
    }
}

fn parse_agent_credential(input: &SecretInput) -> Result<AgentCredential, ApiError> {
    dispatch_credential_class(input.as_str(), CredentialClass::AgentCredential)
        .map_err(|error| ApiError::from(error.into_snapback_error()))?;
    AgentCredential::parse(input.as_str()).map_err(|_| {
        ApiError::from(SnapbackError::error(
            "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID",
            "auth",
            "agent credential is invalid",
        ))
    })
}

fn parse_pairing_code(input: &SecretInput) -> Result<PairingCode, ApiError> {
    dispatch_credential_class(input.as_str(), CredentialClass::PairingCode)
        .map_err(|error| ApiError::from(error.into_snapback_error()))?;
    PairingCode::parse(input.as_str()).map_err(|_| {
        ApiError::from(SnapbackError::error(
            "SNAPBACK_AUTH_GRANT_INVALID",
            "auth",
            "agent grant is invalid",
        ))
    })
}

fn reject_agent_route_authorization_header(headers: &HeaderMap) -> Result<(), ApiError> {
    if !headers.contains_key(header::AUTHORIZATION) {
        return Ok(());
    }
    Err(auth_request_invalid())
}

fn require_agent_routes_available(runtime: &AppState) -> Result<Arc<AuthProvider>, ApiError> {
    if runtime.auth_mode_state().active != AuthMode::Sessions {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
            "auth",
            "agent credential routes require active sessions mode",
        )
        .into());
    }
    installed_auth_provider(runtime)
}

fn require_grant_session(authority: &PreparedAuthority) -> Result<(String, String), ApiError> {
    require_provider_session_authority(authority, InvocationSource::AgentGrantManagement)?;
    let ResolvedAppAuthority::Session {
        user_id,
        session_id,
        ..
    } = authority.resolved()
    else {
        unreachable!("grant-management source requires session authority");
    };
    Ok((user_id.clone(), session_id.clone()))
}

fn grant_step_up_binding(
    authority: &PreparedAuthority,
    request_id: String,
) -> Result<StepUpBinding, ApiError> {
    require_provider_session_authority(authority, InvocationSource::AgentGrantManagement)?;
    let ResolvedAppAuthority::Session {
        user_id,
        session_id,
        generation,
        authority_instance_id,
        ..
    } = authority.resolved()
    else {
        unreachable!("grant-management source requires session authority");
    };
    Ok(StepUpBinding::grant_approval(
        user_id.clone(),
        session_id.clone(),
        *generation,
        authority_instance_id.clone(),
        request_id,
    ))
}

/// Fresh-authentication requests derive their human address from the exact
/// live session. The wire chooses only a closed operation and target; it can
/// neither redirect delivery nor mint an unbound proof.
///
/// @ref LLP 0055#re-credentialing-recovery-and-the-production-profile-invariant — step-up is operation/target bound,
/// five-minute, single-use, and capture-only outside production until LLP 0045.
async fn auth_step_up_request(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<RequestCodeResponse>, ApiError> {
    let provider = require_agent_routes_available(&runtime)?;
    let request: StepUpRequest = parse_auth_json(&headers, body)?;
    let binding = match request {
        StepUpRequest::GrantApproval { request_id } => {
            grant_step_up_binding(&authority, request_id)?
        }
    };
    let admission = provider.admit().await;
    let now_ms = provider.now_ms();
    let lookup_binding = binding.clone();
    let (admission, address) = with_snapback(&runtime.snapback, move |snapback| {
        let address =
            admission.step_up_address(snapback.auth_database_mut(), &lookup_binding, now_ms);
        (admission, address)
    })
    .await;
    let address = address.map_err(map_provider_error)?;
    let admission = admission
        .for_address(address)
        .await
        .map_err(map_provider_error)?;
    let effect_authority = authority.clone();
    let response = with_snapback(&runtime.snapback, move |snapback| {
        let _effect = effect_authority
            .effect_guard("step-up challenge transaction")
            .map_err(ProviderError::from)?;
        admission.request_step_up(snapback.auth_database_mut(), &binding)
    })
    .await
    .map_err(map_provider_error)?;
    Ok(Json(response))
}

async fn auth_pairing_code(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<PairingCodeSecretResponse>, ApiError> {
    let (user_id, _) = require_grant_session(&authority)?;
    let provider = require_agent_routes_available(&runtime)?;
    let _: EmptyAuthRequest = parse_auth_json(&headers, body)?;
    let now_ms = provider.now_ms();
    let effect_authority = authority.clone();
    let minted = with_snapback(&runtime.snapback, move |snapback| {
        let _effect = effect_authority.effect_guard("pairing-code mint transaction")?;
        snapback.auth_database_mut().mint_pairing_code(
            &user_id,
            now_ms,
            provider.agent_random_source(),
        )
    })
    .await?;
    Ok(Json(PairingCodeSecretResponse {
        pairing_request_id: minted.request_id,
        expires_at_ms: minted.expires_at_ms,
        pairing_code: minted.secret,
    }))
}

async fn auth_agent_pair(
    State(runtime): State<AppState>,
    Extension(route_admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<crate::storage::auth_grants::PendingGrantRequest>, ApiError> {
    let _provider = require_agent_routes_available(&runtime)?;
    reject_agent_route_authorization_header(&headers)?;
    let request: AgentPairRequest = parse_auth_json(&headers, body)?;
    let credential = parse_agent_credential(&request.credential)?;
    let pairing_code = parse_pairing_code(&request.pairing_code)?;
    let now_ms = _provider.now_ms();
    let presentation = with_snapback(&runtime.snapback, move |snapback| {
        let _effect = route_admission.effect_guard("agent pairing transaction")?;
        snapback.auth_database_mut().present_pairing_code(
            &credential,
            &request.pairing_request_id,
            &pairing_code,
            &request.requested_scopes,
            now_ms,
        )
    })
    .await?;
    Ok(Json(match presentation {
        crate::storage::auth_grants::PairingPresentation::Created(request)
        | crate::storage::auth_grants::PairingPresentation::Existing(request) => request,
    }))
}

async fn auth_grant_requests(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    OriginalUri(uri): OriginalUri,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<Vec<crate::storage::auth_grants::PendingGrantRequest>>, ApiError> {
    let (user_id, _) = require_grant_session(&authority)?;
    let provider = require_agent_routes_available(&runtime)?;
    let body = body.map_err(|_| auth_request_invalid())?;
    if uri.query().is_some() || !body.is_empty() {
        return Err(auth_request_invalid());
    }
    let now_ms = provider.now_ms();
    Ok(Json(
        with_snapback(&runtime.snapback, move |snapback| {
            snapback
                .auth_database_mut()
                .pending_grant_requests(&user_id, now_ms)
        })
        .await?,
    ))
}

async fn auth_grant_request_approve(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(request_id): Path<String>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<crate::storage::auth_grants::ApprovedGrant>, ApiError> {
    let (user_id, session_id) = require_grant_session(&authority)?;
    let provider = require_agent_routes_available(&runtime)?;
    let request: GrantApprovalRequest = parse_auth_json(&headers, body)?;
    let requested_ttl_ms = request.requested_ttl_ms;
    let proof_admission = match request.step_up {
        Some(step_up) => {
            let binding = grant_step_up_binding(&authority, request_id.clone())?;
            let admission = provider.admit().await;
            let challenge_id = step_up.challenge_id.clone();
            let (admission, coordination) = with_snapback(&runtime.snapback, move |snapback| {
                let coordination =
                    admission.step_up_coordination(snapback.auth_database_mut(), &challenge_id);
                (admission, coordination)
            })
            .await;
            let coordination = coordination.map_err(map_provider_error)?;
            Some(
                admission
                    .for_step_up(coordination, binding, step_up.code.as_str())
                    .await
                    .map_err(map_provider_error)?,
            )
        }
        None => None,
    };
    let effect_authority = authority.clone();
    let effect_provider = provider.clone();
    let approval = with_snapback(&runtime.snapback, move |snapback| {
        let _effect = effect_authority.effect_guard("grant approval transaction")?;
        // Freshness and grant TTL linearize here, after proof coordination and
        // its asynchronous address-stripe wait.
        let now_ms = effect_provider.now_ms();
        snapback.auth_database_mut().approve_grant_request(
            &user_id,
            &session_id,
            &request_id,
            requested_ttl_ms,
            proof_admission.as_ref().map(|admission| admission.proof()),
            now_ms,
        )
    })
    .await?;
    Ok(Json(match approval {
        crate::storage::auth_grants::GrantApproval::Created(grant)
        | crate::storage::auth_grants::GrantApproval::Existing(grant) => grant,
    }))
}

async fn auth_grant_request_deny(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(request_id): Path<String>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let (user_id, _) = require_grant_session(&authority)?;
    let provider = require_agent_routes_available(&runtime)?;
    let _: EmptyAuthRequest = parse_auth_json(&headers, body)?;
    let now_ms = provider.now_ms();
    let effect_authority = authority.clone();
    with_snapback(&runtime.snapback, move |snapback| {
        let _effect = effect_authority.effect_guard("grant denial transaction")?;
        snapback
            .auth_database_mut()
            .deny_grant_request(&user_id, &request_id, now_ms)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn auth_grants(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    OriginalUri(uri): OriginalUri,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<Vec<crate::storage::auth_grants::UserGrant>>, ApiError> {
    let (user_id, _) = require_grant_session(&authority)?;
    let provider = require_agent_routes_available(&runtime)?;
    let body = body.map_err(|_| auth_request_invalid())?;
    if uri.query().is_some() || !body.is_empty() {
        return Err(auth_request_invalid());
    }
    let now_ms = provider.now_ms();
    Ok(Json(
        with_snapback(&runtime.snapback, move |snapback| {
            snapback.auth_database_mut().grants_for_user(&user_id, now_ms)
        })
        .await?,
    ))
}

async fn auth_grant_revoke(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(grant_id): Path<String>,
    OriginalUri(uri): OriginalUri,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let (user_id, _) = require_grant_session(&authority)?;
    let provider = require_agent_routes_available(&runtime)?;
    let body = body.map_err(|_| auth_request_invalid())?;
    if uri.query().is_some() || !body.is_empty() {
        return Err(auth_request_invalid());
    }
    let now_ms = provider.now_ms();
    let effect_authority = authority.clone();
    let _revocation = with_snapback(&runtime.snapback, move |snapback| {
        let _effect = effect_authority.effect_guard("grant revocation transaction")?;
        snapback
            .auth_database_mut()
            .revoke_grant_for_user(&user_id, &grant_id, now_ms)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn auth_grants_revoke_by_actor(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(actor_id): Path<String>,
    OriginalUri(uri): OriginalUri,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let (user_id, _) = require_grant_session(&authority)?;
    let provider = require_agent_routes_available(&runtime)?;
    let body = body.map_err(|_| auth_request_invalid())?;
    if uri.query().is_some() || !body.is_empty() {
        return Err(auth_request_invalid());
    }
    let now_ms = provider.now_ms();
    let effect_authority = authority.clone();
    let _revocation = with_snapback(&runtime.snapback, move |snapback| {
        let _effect = effect_authority.effect_guard("bulk grant revocation transaction")?;
        snapback
            .auth_database_mut()
            .revoke_grants_by_actor_for_user(&user_id, &actor_id, now_ms)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// Rotate a long-lived agent credential. The request is body-credential-only:
/// session/admin/AppData bearer classes are structurally refused before the
/// resolver, and the response carries one typed zeroizing secret wrapper.
///
/// @ref LLP 0055#credentials-and-tokens — rotation is revocation-strength and
///   invalidates the predecessor generation immediately.
async fn auth_agent_rotate(
    State(runtime): State<AppState>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<AgentCredentialSecretResponse>, ApiError> {
    let provider = require_agent_routes_available(&runtime)?;
    reject_agent_route_authorization_header(&headers)?;
    let request: AgentCredentialRequest = parse_auth_json(&headers, body)?;
    let credential = parse_agent_credential(&request.credential)?;
    let now_ms = provider.now_ms();
    let issued = with_snapback(&runtime.snapback, move |snapback| {
        snapback.auth_database_mut().rotate_agent_credential(
            &credential,
            now_ms,
            provider.agent_random_source(),
        )
    })
    .await?;
    // `invalidated_token_ids` is the exact connection-projection input. The
    // service-principal connection registry lands with G7; no session-shaped
    // connection may be guessed here.
    let _invalidated = issued.invalidated_token_ids;
    Ok(Json(AgentCredentialSecretResponse {
        credential_id: issued.credential_id,
        user_id: issued.user_id,
        generation: issued.generation,
        credential: issued.secret,
    }))
}

/// Mint a short-lived token bound to one live grant and exact credential
/// generation. Cap evictions are returned by storage as projection witnesses.
async fn auth_agent_token(
    State(runtime): State<AppState>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<AgentTokenSecretResponse>, ApiError> {
    let provider = require_agent_routes_available(&runtime)?;
    reject_agent_route_authorization_header(&headers)?;
    let request: AgentTokenRequest = parse_auth_json(&headers, body)?;
    let now_ms = provider.now_ms();
    let issued = match request {
        AgentTokenRequest::Grant(request) => {
            let credential = parse_agent_credential(&request.credential)?;
            with_snapback(&runtime.snapback, move |snapback| {
                snapback.auth_database_mut().mint_scoped_token(
                    &credential,
                    &request.grant_id,
                    request.ttl_ms,
                    now_ms,
                    provider.agent_random_source(),
                )
            })
            .await?
        }
        AgentTokenRequest::Pairing(request) => {
            let credential = parse_agent_credential(&request.credential)?;
            with_snapback(&runtime.snapback, move |snapback| {
                snapback
                    .auth_database_mut()
                    .mint_scoped_token_for_pairing_request(
                        &credential,
                        &request.pairing_request_id,
                        request.ttl_ms,
                        now_ms,
                        provider.agent_random_source(),
                    )
            })
            .await?
        }
    };
    let _evicted = issued.evicted_token_ids;
    Ok(Json(AgentTokenSecretResponse {
        token_id: issued.token_id,
        grant_id: issued.grant_id,
        credential_id: issued.credential_id,
        credential_generation: issued.credential_generation,
        expires_at_ms: issued.expires_at_ms,
        grant_expires_at_ms: issued.grant_expires_at_ms,
        scopes: issued.scopes,
        token: issued.secret,
    }))
}

/// Destroy the complete attributable credential family. The response is
/// intentionally empty and identical across already-terminal family state.
async fn auth_agent_revoke_self(
    State(runtime): State<AppState>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let _provider = require_agent_routes_available(&runtime)?;
    reject_agent_route_authorization_header(&headers)?;
    let request: AgentCredentialRequest = parse_auth_json(&headers, body)?;
    let credential = parse_agent_credential(&request.credential)?;
    let now_ms = _provider.now_ms();
    let _revoked = with_snapback(&runtime.snapback, move |snapback| {
        snapback
            .auth_database_mut()
            .revoke_agent_credential_family(&credential, now_ms)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// Public bootstrap discovery. It accepts no body or query and echoes only
/// exact supported protocol offers; every presented session credential is
/// still validated on this request.
///
/// @ref LLP 0058#exact-response-dto — this handler publishes the closed v1
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
    let offers = AuthClientProtocolOffers::from_http_headers(&headers);
    let state = runtime.auth_mode_state();
    let (resolved_authority, projection, captured_incarnation) = match authority {
        Some(Extension(authority)) => (
            authority.resolved().clone(),
            authority.projection().clone(),
            authority
                .authorization_stream_incarnation()
                .map(str::to_owned),
        ),
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
                        installed_auth_coordinator(&runtime)?
                            .resolve_required_bearer(
                                &bearer,
                                provider.now_ms(),
                                provider.monotonic_now(),
                            )
                            .map_err(ApiError::from)?
                            .into_parts()
                            .0
                    } else {
                        ResolvedAppAuthority::Anonymous
                    }
                }
            };
            (
                resolved.clone(),
                HandlerAuthProjection::from_authority(&resolved),
                None,
            )
        }
    };
    let provider_ready = runtime.auth_catalog_ready
        && runtime
            .auth_provider
            .as_ref()
            .is_some_and(|provider| provider.readiness() == AuthProviderReadiness::Available);
    let authorization_stream_incarnation = match captured_incarnation {
        Some(incarnation) => incarnation,
        None => installed_auth_coordinator(&runtime)?
            .authorization_stream_incarnation()
            .map_err(ApiError::from)?,
    };
    let authority_descriptor =
        descriptor_for_resolved_authority(&resolved_authority, &authorization_stream_incarnation)?;
    let response = AuthSessionResponse::from_facts(
        AuthSessionFacts {
            server_startup_nonce: runtime.server_startup_nonce().to_owned(),
            transition_generation: state.transition_generation,
            authorization_stream_incarnation,
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
            authority_descriptor,
            authorized_lease_config: runtime.authorized_lease_config,
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

/// Charge a rejected connection-open request to the same bounded source bucket
/// as a well-formed attempt without resolving durable service authority. In
/// particular, malformed JSON or a missing protocol offer must not update an
/// agent credential/grant's last-used facts merely because its token was valid.
fn account_connection_open_attempt(
    runtime: &AppState,
    presented: PresentedSessionBearer<'_>,
    monotonic_now: Instant,
) -> Result<(), ApiError> {
    if let PresentedSessionBearer::Candidate(raw) = presented
        && classify_credential(raw) == Some(CredentialClass::ScopedToken)
        && let Ok(token) = ScopedToken::parse(raw)
    {
        return runtime
            .connections
            .consume_service_open(*token.token_hash().as_bytes(), monotonic_now);
    }
    let (epoch_now_ms, _) = auth_runtime_now(runtime);
    prepare_connection_open_authority(runtime, presented, epoch_now_ms, monotonic_now).map(drop)
}

async fn prepare_connection_open_authority_with_scoped_token(
    runtime: &AppState,
    presented: PresentedSessionBearer<'_>,
    epoch_now_ms: u64,
    monotonic_now: Instant,
) -> Result<PreparedConnectionOpenAuthority, ApiError> {
    if let PresentedSessionBearer::Candidate(raw) = presented
        && classify_credential(raw).is_some_and(|class| {
            !matches!(
                class,
                CredentialClass::Session | CredentialClass::ScopedToken
            )
        })
    {
        dispatch_credential_class(raw, CredentialClass::Session)
            .map_err(|error| ApiError::from(error.into_snapback_error()))?;
        unreachable!("wrong-class dispatch always refuses");
    }
    if let PresentedSessionBearer::Candidate(raw) = presented
        && classify_credential(raw) == Some(CredentialClass::ScopedToken)
    {
        if runtime.auth_mode_state().active != AuthMode::Sessions {
            return Err(ApiError::from(SnapbackError::error(
                "SNAPBACK_AUTH_REQUIRED",
                "auth",
                "scoped agent tokens are unavailable while auth mode is dev",
            )));
        }
        dispatch_credential_class(raw, CredentialClass::ScopedToken)
            .map_err(|error| ApiError::from(error.into_snapback_error()))?;
        let token = ScopedToken::parse(raw).map_err(|_| {
            ApiError::from(SnapbackError::error(
                "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                "auth",
                "scoped agent token is invalid",
            ))
        })?;
        runtime
            .connections
            .consume_service_open(*token.token_hash().as_bytes(), monotonic_now)?;
        let now_ms = installed_auth_provider(runtime)?.now_ms();
        let resolved = with_snapback(&runtime.snapback, move |snapback| {
            snapback
                .auth_database_mut()
                .resolve_scoped_token(&token, now_ms)
        })
        .await?;
        let token_id = resolved.token_id.clone();
        let deadline_ms = resolved.expires_at_ms;
        let authority = ResolvedAppAuthority::from_scoped_token(resolved);
        let prepared = installed_auth_coordinator(runtime)?
            .prepare_anonymous_connection()
            .map_err(ApiError::from)?;
        return Ok(PreparedConnectionOpenAuthority {
            resolved: authority.clone(),
            managed_authority: true,
            bound: BoundGrantAuthority::ServicePrincipal {
                authorization_stream_incarnation: prepared.authorization_stream_incarnation,
                authority,
                token_id,
                deadline_ms,
                publication: prepared.publication,
            },
        });
    }
    prepare_connection_open_authority(runtime, presented, epoch_now_ms, monotonic_now)
}

fn prepare_connection_open_authority(
    runtime: &AppState,
    presented: PresentedSessionBearer<'_>,
    epoch_now_ms: u64,
    monotonic_now: Instant,
) -> Result<PreparedConnectionOpenAuthority, ApiError> {
    match runtime.auth_coordinator.as_deref() {
        Some(coordinator) => runtime.connections.prepare_open_authority(
            coordinator,
            presented,
            epoch_now_ms,
            monotonic_now,
        ),
        None if runtime.auth_mode_state().active == AuthMode::Dev => runtime
            .connections
            .prepare_unmanaged_dev_open(presented, monotonic_now),
        None => Err(ApiError::from(SnapbackError::error(
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "auth",
            "authentication projection is unavailable",
        ))),
    }
}

fn auth_runtime_now(runtime: &AppState) -> (u64, Instant) {
    runtime.auth_provider.as_ref().map_or_else(
        || (now_millis(), Instant::now()),
        |provider| (provider.now_ms(), provider.monotonic_now()),
    )
}

/// Record one LLP 0057 qualifying use after the connection act itself has
/// passed its exact grant/session fence. Bearer classification never reaches
/// this path: the immutable session id and generation came from the projection
/// and the provider transaction can only extend that exact durable row.
async fn record_connection_authenticated_use(
    runtime: &AppState,
    key: Option<(String, u64)>,
    route_admission: &AdmissionLease,
) -> Result<Option<u64>, ApiError> {
    let Some((session_id, generation)) = key else {
        return Ok(None);
    };
    let provider = installed_auth_provider(runtime)?;
    let coordinator = installed_auth_coordinator(runtime)?;
    let provider_admission = provider.admit().await;
    let durable_now_ms = provider.now_ms();
    let effect_admission = route_admission.clone();
    let session_for_write = session_id.clone();
    let outcome = with_snapback(&runtime.snapback, move |snapback| {
        let _effect = effect_admission
            .effect_guard("authenticated connection use")
            .map_err(ProviderError::from)?;
        provider_admission.record_authenticated_use(
            snapback.auth_database_mut(),
            &session_for_write,
            generation,
            durable_now_ms,
        )
    })
    .await
    .map_err(map_provider_error)?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(runtime);
    coordinator
        .finalize_authenticated_use(
            &session_id,
            generation,
            outcome,
            epoch_now_ms,
            monotonic_now,
        )
        .map_err(ApiError::from)?
        .map(Some)
        .ok_or_else(|| ApiError::from(provider_session_expired().into_snapback_error()))
}

/// Consume the terminal side of a coordinator finish before returning its
/// request outcome. A known durable commit may still carry a projection
/// diagnostic; terminal propagation is mandatory and does not replace that
/// diagnostic.
///
/// @ref LLP 0059#plan-begin-commit-finalize — Propagate is an independent,
/// mandatory phase after known commit, including when Finalize fails closed.
fn finish_auth_with_terminal_propagation<T>(
    runtime: &AppState,
    provider: &AuthProvider,
    finish: AuthFinish<T>,
) -> SnapbackResult<T> {
    let (outcome, committed_revocation) = finish.into_parts();
    if let Some(committed_revocation) = committed_revocation {
        propagate_committed_revocation(runtime, provider, &committed_revocation);
    }
    outcome
}

fn propagate_committed_revocation(
    runtime: &AppState,
    provider: &AuthProvider,
    target: &CommittedRevocationTarget,
) {
    let monotonic_now = provider.monotonic_now();
    let close_by = monotonic_now
        .checked_add(crate::auth::session_projection::TERMINAL_CLOSE_GRACE)
        .unwrap_or(monotonic_now);
    runtime
        .auth_terminal_lifecycle
        .terminate_session_generation(
            target.authorization_stream_incarnation(),
            target.session_id(),
            target.predecessor_generation(),
            crate::live_wire::LiveAuthErrorReason::Revoked,
            close_by,
        );
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
        let finish = coordinator.finish_issuance(
            carrier,
            attempt,
            provider.now_ms(),
            provider.monotonic_now(),
        );
        match finish_auth_with_terminal_propagation(runtime, provider, finish)? {
            IssuanceFinish::Committed(issue) => return Ok(issue),
            IssuanceFinish::CodeInvalid | IssuanceFinish::CodeLocked => {
                return Err(auth_provider_unavailable_error());
            }
            IssuanceFinish::CandidateCollision => continue,
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
                let finish = coordinator.finish_issuance(
                    carrier,
                    attempt,
                    provider.now_ms(),
                    provider.monotonic_now(),
                );
                match finish_auth_with_terminal_propagation(runtime, provider, finish)
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
                    IssuanceFinish::CandidateCollision => continue,
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

/// Preserve absence versus malformed/duplicate Authorization syntax so
/// connection-open can account both in the coarse prebudget without ever
/// hashing malformed bytes or consulting the projection.
#[derive(Clone, Copy)]
enum PresentedSessionBearer<'a> {
    Absent,
    Malformed,
    Candidate(&'a str),
}

#[derive(Clone, Debug)]
enum OwnedPresentedSessionBearer {
    Absent,
    Malformed,
    Candidate(String),
}

impl OwnedPresentedSessionBearer {
    fn from_headers(headers: &HeaderMap) -> Self {
        match presented_session_bearer(headers) {
            PresentedSessionBearer::Absent => Self::Absent,
            PresentedSessionBearer::Malformed => Self::Malformed,
            PresentedSessionBearer::Candidate(bearer) => Self::Candidate(bearer.to_owned()),
        }
    }

    fn as_presented(&self) -> PresentedSessionBearer<'_> {
        match self {
            Self::Absent => PresentedSessionBearer::Absent,
            Self::Malformed => PresentedSessionBearer::Malformed,
            Self::Candidate(bearer) => PresentedSessionBearer::Candidate(bearer),
        }
    }
}

fn presented_session_bearer(headers: &HeaderMap) -> PresentedSessionBearer<'_> {
    if !headers.contains_key(header::AUTHORIZATION) {
        return PresentedSessionBearer::Absent;
    }
    match auth_bearer(headers) {
        Some(bearer) => PresentedSessionBearer::Candidate(bearer),
        None => PresentedSessionBearer::Malformed,
    }
}

/// Parse one exact provider DTO without leaking parser details. The raw-byte
/// bound is checked before serde, and deserializing the original bytes keeps
/// duplicate-field rejection observable by the typed visitor.
///
/// @ref LLP 0057#routes-operations-and-dtos — provider requests are closed,
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
/// @ref LLP 0057#email-code-provider — challenge creation commits before the
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
/// @ref LLP 0057#email-code-provider — preliminary lookup selects locks and
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

/// Rotate one exact bearer after central resolved-session authority admission.
///
/// @ref LLP 0057#rotation — refresh rotates the current token and publishes
/// the same closed credential response as exchange.
async fn auth_refresh(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<CredentialResponse>, ApiError> {
    require_provider_session_authority(&authority, InvocationSource::AuthRefresh)?;
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
                let effect_authority = authority.clone();
                let attempt = with_snapback(&runtime.snapback, move |snapback| {
                    match effect_authority.effect_guard("auth refresh rotation transaction") {
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
                    RotationFinish::CandidateCollision => continue,
                    RotationFinish::PredecessorChanged => continue,
                }
            }
            PlannedRefresh::ReuseRevoke(plan) => {
                let carrier = coordinator
                    .premark_revocation(plan)
                    .map_err(ApiError::from)?;
                let commit_plan = carrier.plan().clone();
                let effect_authority = authority.clone();
                let attempt = with_snapback(&runtime.snapback, move |snapback| {
                    match effect_authority.effect_guard("auth refresh reuse transaction") {
                        Ok(_effect) => admission.commit_planned_revocation(
                            snapback.auth_database_mut(),
                            &commit_plan,
                            now_ms,
                        ),
                        Err(error) => AuthTransactionAttempt::RolledBack(error),
                    }
                })
                .await;
                let finish = coordinator.finish_revocation(carrier, attempt);
                match finish_auth_with_terminal_propagation(&runtime, &provider, finish)
                    .map_err(ApiError::from)?
                {
                    RevocationFinish::Committed { .. } => {
                        return Err(map_provider_error(provider_session_expired()));
                    }
                    RevocationFinish::AlreadyTerminal { .. } => {
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
/// @ref LLP 0057#session-and-token-family-protocol — logout succeeds with an
/// empty 204 response and never aliases a bearer through JSON or query input.
async fn auth_logout(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    require_provider_session_authority(&authority, InvocationSource::AuthLogout)?;
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
        let effect_authority = authority.clone();
        let attempt = with_snapback(&runtime.snapback, move |snapback| {
            match effect_authority.effect_guard("auth logout transaction") {
                Ok(_effect) => admission.commit_planned_revocation(
                    snapback.auth_database_mut(),
                    &commit_plan,
                    now_ms,
                ),
                Err(error) => AuthTransactionAttempt::RolledBack(error),
            }
        })
        .await;
        let finish = coordinator.finish_revocation(carrier, attempt);
        match finish_auth_with_terminal_propagation(&runtime, &provider, finish)
            .map_err(ApiError::from)?
        {
            RevocationFinish::Committed { outcome, .. } => {
                let mut response = StatusCode::NO_CONTENT.into_response();
                response.extensions_mut().insert(outcome);
                return Ok(response);
            }
            RevocationFinish::AlreadyTerminal { .. } => {
                return Err(map_provider_error(provider_session_expired()));
            }
            RevocationFinish::PredecessorChanged => continue,
        }
    }
    Err(auth_provider_unavailable())
}

fn require_provider_session_authority(
    authority: &PreparedAuthority,
    expected_source: InvocationSource,
) -> Result<(), ApiError> {
    authority
        .validate_admission("provider session operation")
        .map_err(ApiError::from)?;
    if authority.source() != expected_source
        || authority.active_mode() != AuthMode::Sessions
        || !matches!(authority.resolved(), ResolvedAppAuthority::Session { .. })
    {
        return Err(SnapbackError::error(
            "SNAPBACK_INVOCATION_SOURCE_INVALID",
            "auth",
            "provider session operation requires exact shared-gate authority",
        )
        .into());
    }
    Ok(())
}

/// Opaque revoke-only alarm. Every bearer shape enters the provider's fixed
/// transaction and waits for its admission-selected publication deadline.
/// The optional revocation is internal and never influences the response.
///
/// @ref LLP 0057#logout-ordinary-supersession-and-family-alarm — malformed, unknown, current,
/// tombstone, and already-revoked bearers all publish the same delayed 202.
async fn auth_family_alarm(
    State(runtime): State<AppState>,
    Extension(route_admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let provider = installed_auth_provider(&runtime)?;
    let coordinator = installed_auth_coordinator(&runtime)?;
    let _: EmptyAuthRequest = parse_auth_json(&headers, body)?;
    let bearer = SecretInput::new(auth_bearer(&headers).unwrap_or_default().to_owned());
    let mut publish_not_before = provider.monotonic_now();
    let mut accepted = false;
    let mut committed_outcome = None;
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
                let finish = coordinator.finish_revocation(carrier, attempt);
                match finish_auth_with_terminal_propagation(&runtime, &provider, finish)
                    .map_err(ApiError::from)?
                {
                    RevocationFinish::Committed { outcome, .. } => {
                        committed_outcome = Some(outcome);
                        accepted = true;
                        break;
                    }
                    RevocationFinish::AlreadyTerminal { .. } => {
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
    let mut response = (StatusCode::ACCEPTED, Json(FamilyAlarmResponse::default())).into_response();
    if let Some(outcome) = committed_outcome {
        response.extensions_mut().insert(outcome);
    }
    Ok(response)
}

/// Exact capture-mailbox projection. The handler requires the middleware-
/// installed proof as a structural backstop; the registered route is what
/// authenticates both independent authority axes before query parsing.
///
/// @ref LLP 0057#capture-mailbox — mailbox lookup performs shared
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

/// A direct Snapback HTTP service.
///
/// This deliberately implements request service only, not Axum's incoming
/// connection make-service. Network embedders must call [`SnapbackApp::bind`],
/// which consumes the listener that supplies transport posture. Keeping the
/// inner `Router` private prevents the former accidental composition where a
/// context derived from one listener was served on another.
#[derive(Clone)]
pub struct SnapbackApp {
    state: AppState,
    router: Router,
}

impl SnapbackApp {
    /// Couple this application to the exact listener that will serve it.
    ///
    /// @ref LLP 0060#d1-plaintext-listener-fence — listener-owned transport
    /// posture is refreshed from the consumed socket at the network boundary.
    pub fn bind(self, listener: tokio::net::TcpListener) -> std::io::Result<BoundSnapbackApp> {
        let address = listener.local_addr()?;
        let mut state = self.state;
        Arc::make_mut(&mut state.server).record_bound_address(address);
        Ok(BoundSnapbackApp {
            listener,
            router: router_for_state(state),
        })
    }
}

impl Service<Request<Body>> for SnapbackApp {
    type Response = Response;
    type Error = Infallible;
    type Future = <Router as Service<Request<Body>>>::Future;

    fn poll_ready(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        <Router as Service<Request<Body>>>::poll_ready(&mut self.router, cx)
    }

    fn call(&mut self, request: Request<Body>) -> Self::Future {
        self.router.call(request)
    }
}

/// A Snapback application whose transport posture and serving listener are one
/// private, inseparable value.
pub struct BoundSnapbackApp {
    listener: tokio::net::TcpListener,
    router: Router,
}

impl BoundSnapbackApp {
    pub fn local_addr(&self) -> std::io::Result<std::net::SocketAddr> {
        self.listener.local_addr()
    }

    pub async fn serve(self) -> std::io::Result<()> {
        axum::serve(self.listener, self.router).await
    }

    pub async fn serve_with_graceful_shutdown<F>(self, signal: F) -> std::io::Result<()>
    where
        F: Future<Output = ()> + Send + 'static,
    {
        axum::serve(self.listener, self.router)
            .with_graceful_shutdown(signal)
            .await
    }
}

fn router_for_state(state: AppState) -> Router {
    router_from_registrations(all_route_registrations(), state.clone())
        .with_state(state)
        .layer(middleware::from_fn(local_dev_cors))
}

/// The full Snapback HTTP surface is installed only from registered entries;
/// there is no second route-literal list that can drift outside policy. The
/// returned value is safe for direct `Service<Request>` use; call `.bind()` to
/// serve it on a network listener.
///
/// @ref LLP 0031#enforcement — router↔registry parity is structural.
pub fn app(state: AppState) -> SnapbackApp {
    SnapbackApp {
        router: router_for_state(state.clone()),
        state,
    }
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
pub fn router(snapback: LocalSnapback) -> SnapbackApp {
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
const ROOM_REAUTHORIZATION_INTERVAL_MS: u64 =
    crate::auth::invalidation::AUTH_INVALIDATION_REFIRE_MAX_MS;
const MAINTENANCE_TICKS_PER_SWEEP: u64 = MAINTENANCE_INTERVAL_MS / ROOM_REAUTHORIZATION_INTERVAL_MS;
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
pub fn spawn_maintenance_worker(runtime: AppState) -> JoinHandle<()> {
    tokio::spawn(async move {
        let state = runtime.snapback.clone();
        let ephemeral = runtime.ephemeral.clone();
        let mut ticks = interval(Duration::from_millis(ROOM_REAUTHORIZATION_INTERVAL_MS));
        let mut maintenance_tick = 0;
        loop {
            ticks.tick().await;
            let now = now_millis();
            let run_maintenance = maintenance_tick == 0;
            maintenance_tick = (maintenance_tick + 1) % MAINTENANCE_TICKS_PER_SWEEP;
            if run_maintenance {
                // Room-authority TTL sweep: index-driven, off the global mutex
                // (server-side remove deltas are best effort — clients also
                // prune by TTL, LLP 0013 §TTL and leases).
                ephemeral.cleanup_expired(now);
            }
            // Resolve connection grants before entering the database owner.
            // A room obligation remains pending if any readable id was
            // replaced between snapshot and resolution; the next tick starts
            // again from the replacement's exact effect fence.
            let connections = runtime.connections.clone();
            let coordinator = runtime.auth_coordinator.clone();
            let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
            let mut resolved_rooms = Vec::new();
            for room in ephemeral.pending_room_reauthorizations() {
                let mut fresh_authorities = Vec::with_capacity(room.subscribers.len());
                let mut replaced = false;
                for subscriber in &room.subscribers {
                    match connections.resolve_room_connection_authority(
                        &subscriber.connection_id,
                        subscriber.effect_fence.as_ref(),
                        coordinator.as_deref(),
                        epoch_now_ms,
                        monotonic_now,
                    ) {
                        Ok(ResolvedRoomConnectionAuthority::Absent) => {
                            fresh_authorities.push(None);
                        }
                        Ok(ResolvedRoomConnectionAuthority::Current { auth, effect_fence })
                            if subscriber.effect_fence.as_ref() == Some(&effect_fence) =>
                        {
                            fresh_authorities.push(auth);
                        }
                        Ok(ResolvedRoomConnectionAuthority::Current { .. })
                        | Ok(ResolvedRoomConnectionAuthority::Replaced)
                        | Err(_) => {
                            replaced = true;
                            break;
                        }
                    }
                }
                if !replaced {
                    resolved_rooms.push((room, fresh_authorities));
                }
            }

            // The permission query and journal prune are rusqlite work — off
            // the async worker (L7). No registry/coordinator lock is acquired
            // while LocalSnapback is held.
            let planned = with_snapback(&state, move |snapback| {
                if run_maintenance {
                    snapback.reap_stale_connections(now, CONNECTION_IDLE_TTL_MS);
                }
                let mut planned = Vec::new();
                for (room, fresh_authorities) in resolved_rooms {
                    let room_id = room.room.clone();
                    let generation = room.obligation.room_authority_generation;
                    if let Ok(resolutions) =
                        snapback.resolve_pending_ephemeral_room_permissions(room, fresh_authorities)
                    {
                        planned.push((room_id, generation, resolutions));
                    }
                }
                if run_maintenance {
                    // Best-effort; a transient prune error is retried on the
                    // next ordinary maintenance sweep.
                    let _ = snapback.prune_change_journal(
                        now,
                        JOURNAL_RETAIN_VERSIONS,
                        JOURNAL_RETAIN_MS,
                    );
                }
                planned
            })
            .await;
            for (room_id, generation, resolutions) in planned {
                let _ = ephemeral.complete_room_reauthorization(&room_id, generation, resolutions);
            }
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
/// @ref LLP 0058#activation-readiness-and-later-item-fences — the exact
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
    State(runtime): State<AppState>,
    headers: HeaderMap,
    Json(manifest): Json<FunctionManifest>,
) -> Result<Json<DiagnosticsResponse>, ApiError> {
    crate::admin::authorize_operation(&runtime.server, &headers, "functions.load", None)?;
    crate::admin::require_operation_profile(&runtime.server, "functions.load", false)?;
    let diagnostics = if settled_function_load_mode(&runtime)? == AuthMode::Sessions {
        let prepared = with_snapback(&runtime.snapback, move |snapback| {
            snapback.prepare_auth_provision(EnsureAppMode::Sessions, None, Some(manifest), None)
        })
        .await?;
        commit_prepared_auth_provision(
            &runtime,
            prepared,
            runtime.server.profile.as_str().to_owned(),
        )
        .await?
        .diagnostics
    } else {
        with_snapback(&runtime.snapback, move |snapback| {
            snapback.load_functions_in_settled_dev(manifest)
        })
        .await?
    };
    // @ref LLP 0036#the-setup-wizard-d3 — the printed line is the install
    // instruction: a manifest that declares required config the store cannot
    // satisfy points the operator straight at the wizard.
    let missing = with_snapback(&runtime.snapback, |snapback| {
        snapback.required_missing_config()
    })
    .await;
    if !missing.is_empty() {
        println!(
            "config: {} required entr{} missing ({}) → http://{}:{}/_snapback/admin/setup",
            missing.len(),
            if missing.len() == 1 { "y" } else { "ies" },
            missing.join(", "),
            runtime.server.host,
            runtime.server.port,
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
/// @ref LLP 0057#concurrency-locks-and-linearization — maintenance/address
/// admission precedes the outer app lock for mint and rescue.
/// @ref LLP 0057#routes-operations-and-dtos — both host operations use closed
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
    route_admission: Option<Extension<AdmissionLease>>,
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
    let route_admission = route_admission.map(|Extension(admission)| admission);

    if matches!(
        request.operation.as_str(),
        "auth.mintSession" | "auth.rescueCollidingTable"
    ) {
        let result = execute_auth_host_operation(
            &runtime,
            &headers,
            impersonation.as_ref().map(|Extension(verified)| verified),
            route_admission.as_ref().ok_or_else(|| {
                ApiError::from(SnapbackError::error(
                    "SNAPBACK_AUTH_MODE_PENDING",
                    "auth",
                    "host auth operation is missing managed admission",
                ))
            })?,
            request,
            server_url,
        )
        .await?;
        return Ok(Json(result));
    }

    if request.operation == "functions.load" {
        // The route middleware has already selected and authenticated this
        // exact operation. In sessions it also released its own admission
        // root so this handler can own the activation transition without
        // self-deadlocking. Raw loading remains available only in exact
        // settled+available dev posture.
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
        let functions = request.functions.clone();
        let function_count = functions
            .as_ref()
            .map(|functions| functions.functions.len())
            .unwrap_or(0);
        let outcome = match crate::admin::require_operation_profile(
            &ctx,
            &request.operation,
            request.user_id.is_some(),
        ) {
            Err(error) => Err(error.0),
            Ok(()) => match functions {
                None => Err(SnapbackError::error(
                    "SNAPBACK_HOST_OP_INPUT_MISSING",
                    "host-ops",
                    "functions.load requires a `functions` manifest in the request body",
                )),
                Some(functions) => match settled_function_load_mode(&runtime) {
                    Err(error) => Err(error),
                    Ok(AuthMode::Sessions) => {
                        match with_snapback(&state, move |snapback| {
                            snapback.prepare_auth_provision(
                                EnsureAppMode::Sessions,
                                None,
                                Some(functions),
                                None,
                            )
                        })
                        .await
                        {
                            Ok(prepared) => commit_prepared_auth_provision(
                                &runtime,
                                prepared,
                                profile.as_str().to_owned(),
                            )
                            .await
                            .map(|committed| committed.diagnostics)
                            .map_err(|error| error.0),
                            Err(error) => Err(error),
                        }
                    }
                    Ok(AuthMode::Dev) => {
                        with_snapback(&state, move |snapback| {
                            snapback.load_functions_in_settled_dev(functions)
                        })
                        .await
                    }
                },
            },
        };
        let result = with_snapback(&state, move |snapback| {
            crate::host_ops::coordinated_functions_load_result(
                snapback,
                &request,
                server_url,
                profile,
                function_count,
                outcome,
            )
        })
        .await;
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

        let outcome = match crate::admin::require_operation_profile(
            &ctx,
            &request.operation,
            request.user_id.is_some(),
        ) {
            Ok(()) => {
                let route_admission = route_admission.as_ref().ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_AUTH_MODE_PENDING",
                        "auth",
                        "host reset operation is missing managed admission",
                    )
                });
                match route_admission {
                    Ok(route_admission) => {
                        coordinated_app_reset(&runtime, route_admission, request.seed.clone()).await
                    }
                    Err(error) => Err(error),
                }
            }
            Err(error) => Err(error.0),
        };
        let result = with_snapback(&state, move |snapback| {
            crate::host_ops::coordinated_reset_result(
                snapback, &request, server_url, profile, outcome,
            )
        })
        .await;
        return Ok(Json(result));
    }
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

/// Execute the sole production app-reset primitive. Provider maintenance is
/// acquired before the app mutex; the shared stream is blocked before SQLite;
/// all auxiliary process capabilities are cleared only after exact finalize.
///
/// @ref LLP 0059#reset-restore-and-stream-publication — destructive authority
/// changes use premark → durable attempt → exact finalize.
async fn coordinated_app_reset(
    runtime: &AppState,
    route_admission: &AdmissionLease,
    seed: Option<SeedData>,
) -> SnapbackResult<Option<crate::manifest::MutationOutput>> {
    let active_auth_mode = runtime.auth_mode_state().active;
    if active_auth_mode == AuthMode::Dev
        && runtime.auth_provider.is_none()
        && runtime.auth_coordinator.is_none()
    {
        let effect_admission = route_admission.clone();
        return with_snapback(&runtime.snapback, move |snapback| {
            let _effect = effect_admission.effect_guard("app reset transaction")?;
            snapback.reset_with_seed(seed)
        })
        .await;
    }

    let provider = runtime
        .auth_provider
        .clone()
        .ok_or_else(auth_provider_unavailable_error)?;
    let coordinator = runtime.auth_coordinator.clone().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "auth",
            "authentication projection is unavailable",
        )
    })?;
    // @ref LLP 0057#concurrency-locks-and-linearization — reset takes
    // exclusive auth maintenance before the app/database writer.
    let maintenance = provider.exclusive_maintenance().await;
    let carrier = coordinator.premark_stream_reset()?;
    let predecessor = carrier.predecessor().clone();
    let successor = carrier.successor().clone();
    let durable_successor = successor.clone();
    let effect_admission = route_admission.clone();
    let attempt = with_snapback(&runtime.snapback, move |snapback| {
        let _effect = match effect_admission.effect_guard("app reset transaction") {
            Ok(effect) => effect,
            Err(error) => return AuthTransactionAttempt::RolledBack(error),
        };
        snapback.attempt_reset_with_seed_and_authorization_stream(
            seed,
            &predecessor,
            &durable_successor,
        )
    })
    .await;
    let committed = match attempt {
        AuthTransactionAttempt::Committed(committed) => committed,
        AuthTransactionAttempt::RolledBack(error) => {
            return coordinator.finish_stream_reset(
                carrier,
                AuthTransactionAttempt::<Option<crate::manifest::MutationOutput>>::RolledBack(
                    error,
                ),
            );
        }
        AuthTransactionAttempt::CommitUncertain(error) => {
            return coordinator.finish_stream_reset(
                carrier,
                AuthTransactionAttempt::<Option<crate::manifest::MutationOutput>>::CommitUncertain(
                    error,
                ),
            );
        }
    };

    // The durable successor is known committed, but the coordinator's stream
    // ticket remains installed. Terminalize every predecessor carrier and
    // clear the router issuer before publishing reset-owned in-memory state;
    // no request can observe a half-installed successor through this window.
    let close_by = provider
        .monotonic_now()
        .checked_add(crate::auth::session_projection::TERMINAL_CLOSE_GRACE)
        .unwrap_or_else(|| provider.monotonic_now());
    runtime
        .auth_terminal_lifecycle
        .committed_stream_reset(crate::live_wire::LiveAuthErrorReason::Reset, close_by);
    runtime.clear_reset_auth_invalidation();
    let seeded = with_snapback(&runtime.snapback, move |snapback| {
        snapback.publish_coordinated_reset(committed)
    })
    .await;
    runtime.secret_reads.clear_after_committed_reset();
    maintenance.clear_mailbox_after_committed_reset();

    // Active sessions owns an authenticated invalidation issuer. Active dev
    // deliberately does not, even when a ReadyV1 catalog is present (for
    // example during a staged or downgraded deployment). Both modes rotate
    // and publish the durable stream successor; only sessions reconstructs
    // the mode-owned issuer before the final stream-ticket release.
    if active_auth_mode == AuthMode::Sessions {
        // Reserve and authenticate a boot issuer for the already-durable
        // successor while publication is still blocked. The old issuer is
        // scoped to the predecessor incarnation and must never be asked to
        // cross it.
        let successor_incarnation = successor.as_str().to_owned();
        let rebuild: SnapbackResult<crate::auth::invalidation::LiveInvalidationIssuer> = async {
            let reservation = with_snapback(&runtime.snapback, move |snapback| {
                let (app_id, target_profile_id) = {
                    let schema = snapback.auth_database_mut().schema();
                    (
                        schema.app_id.clone(),
                        schema.target_profile.clone().unwrap_or_else(|| {
                            crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned()
                        }),
                    )
                };
                let (authorization, version_stream, boot_sequence) = snapback
                    .auth_database_mut()
                    .reserve_invalidation_boot_issuer()?;
                if authorization.incarnation != successor_incarnation {
                    return Err(SnapbackError::error(
                        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                        "auth",
                        "reset successor issuer reservation observed another authorization incarnation",
                    ));
                }
                Ok((
                    app_id,
                    target_profile_id,
                    authorization,
                    version_stream,
                    boot_sequence,
                ))
            })
            .await?;
            let (app_id, target_profile_id, authorization, version_stream, boot_sequence) =
                reservation;
            let issuer_id = crate::auth::invalidation::IssuerId::fresh(
                authorization.incarnation.clone(),
                boot_sequence,
            )?;
            let successor_issuer = provider
                .authenticate_invalidation_boot_issuer(issuer_id, &target_profile_id, &app_id)
                .map_err(crate::auth::provider::ProviderError::into_snapback_error)?;
            let installed_issuer = successor_issuer.clone();
            with_snapback(&runtime.snapback, move |snapback| {
                snapback.install_auth_invalidation(installed_issuer, authorization, version_stream)
            })
            .await?;
            Ok(successor_issuer)
        }
        .await;
        let successor_issuer = match rebuild {
            Ok(issuer) => issuer,
            Err(error) => {
                with_snapback(&runtime.snapback, |snapback| {
                    snapback.clear_auth_invalidation_after_failed_reset();
                })
                .await;
                let classified = coordinator.finish_stream_reset(
                    carrier,
                    AuthTransactionAttempt::<Option<crate::manifest::MutationOutput>>::CommitUncertain(
                        error,
                    ),
                );
                return match classified {
                    Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_REVOCATION_UNCERTAIN" => {
                        Err(error)
                    }
                    _ => {
                        let _ = coordinator.fail_global_closed();
                        Err(SnapbackError::error(
                            "SNAPBACK_AUTH_REVOCATION_UNCERTAIN",
                            "auth",
                            "committed reset successor projection could not be reconstructed",
                        ))
                    }
                };
            }
        };
        runtime.install_reset_auth_invalidation(successor_issuer);
    }
    if coordinator
        .finish_stream_reset(carrier, AuthTransactionAttempt::Committed(()))
        .is_err()
    {
        runtime.clear_reset_auth_invalidation();
        with_snapback(&runtime.snapback, |snapback| {
            snapback.clear_auth_invalidation_after_failed_reset();
        })
        .await;
        let _ = coordinator.fail_global_closed();
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_REVOCATION_UNCERTAIN",
            "auth",
            "committed reset successor projection could not be reconciled",
        ));
    }
    Ok(seeded)
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
    Extension(route_admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<AppResetResponse>, ApiError> {
    crate::admin::authorize_operation(&ctx, &headers, "app.reset", None)?;
    crate::admin::require_operation_profile(&ctx, "app.reset", false)?;
    let seed = parse_optional_json::<AppResetBody>(&headers, body)?.and_then(|body| body.seed);
    let seeded = coordinated_app_reset(&runtime, &route_admission, seed).await?;
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
) -> Result<Json<FunctionResponse<crate::manifest::QueryOutput>>, ApiError> {
    let attribution = authority.function_attribution();
    let Json(input) = input
        .map_err(ApiError::from_json_rejection)
        .map_err(|error| error.with_attribution(attribution.clone()))?;
    let output = if read.available() {
        with_read_lane(&read, move |lane| {
            lane.invoke_query_prepared(&name, input, authority)
        })
        .await
    } else {
        with_snapback(&state, move |snapback| {
            snapback
                .invoke_query_with_dependencies_prepared(&name, input, authority)
                .map(|invocation| invocation.output)
        })
        .await
    }
    .map_err(ApiError::from)
    .map_err(|error| error.with_attribution(attribution.clone()))?;
    Ok(Json(FunctionResponse::new(output, attribution)))
}

/// Run a fresh full query, sign outside the app lock (preserving the global
/// provider-before-app lock order), then reacquire the app lane for one exact
/// head/auth/activation/no-pending reservation transaction.
async fn invoke_authorized_lease_query(
    State(runtime): State<AppState>,
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(name): Path<String>,
    headers: HeaderMap,
    request: Result<Json<AuthorizedLeaseQueryRequest>, JsonRejection>,
) -> Result<Json<AuthorizedLeaseQueryResponse>, ApiError> {
    if !runtime.auth_program_readiness().authorized_lease {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
            "auth",
            "authorized retained reads are unavailable in this process",
        )
        .into());
    }
    let offers = AuthClientProtocolOffers::from_headers(&headers);
    if offers.authorized_lease != Some(u64::from(AUTHORIZED_LEASE_PROTOCOL_VERSION))
        || offers.auth_invalidation != Some(AUTH_PROTOCOL_V1)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
            "auth",
            "authorized retained reads require exact lease and invalidation protocol offers",
        )
        .into());
    }
    let Json(request) = request.map_err(ApiError::from_json_rejection)?;
    let (input, lease_request) = request.into_parts();
    let capture = with_snapback(&state, move |snapback| {
        snapback.capture_authorized_lease_query(&name, input, authority, lease_request)
    })
    .await?;

    // Never acquire the protocol keyring while the app instance lock is held.
    let provider = installed_auth_provider(&runtime)?;
    let issued_at_server_ms = provider.now_ms();
    let config = runtime.authorized_lease_config;
    let target_profile_id = capture.target_profile_id.clone();
    let app_id = capture.app_id.clone();
    let lease = provider
        .issue_authorized_lease_at(
            capture.issue.clone(),
            config,
            issued_at_server_ms,
            &target_profile_id,
            &app_id,
        )
        .map_err(ApiError::from)?;
    let lease_for_reservation = lease.clone();
    let output = with_snapback(&state, move |snapback| {
        snapback.reserve_captured_authorized_lease(
            capture,
            &lease_for_reservation,
            config,
            issued_at_server_ms,
        )
    })
    .await?;
    Ok(Json(AuthorizedLeaseQueryResponse::from_parts(
        output, lease,
    )))
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
) -> Result<Json<FunctionResponse<MutationResponse>>, ApiError> {
    let attribution = authority.function_attribution();
    let Json(request) = input
        .map_err(ApiError::from_json_rejection)
        .map_err(|error| error.with_attribution(attribution.clone()))?;
    if let Some(current_id) = request.client_mutation_id.as_deref()
        && request
            .acknowledged_client_mutation_ids
            .iter()
            .any(|acknowledged| acknowledged == current_id)
    {
        return Err(ApiError::from(SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_ACK_OVERLAP",
            "sync",
            "the current client mutation id cannot be acknowledged by the same request",
        )
        .with_details(json!({ "clientMutationId": current_id })))
        .with_attribution(attribution));
    }
    // Receipt emission rides the L7 blocking offload: the recording call
    // (Hermes eval + rusqlite) runs via with_snapback, and the envelope is
    // assembled from its (result, receipt) pair back on the async side.
    let (result, receipt) = with_snapback(&state, move |snapback| {
        snapback.invoke_mutation_recording_with_authority_descriptor_and_acknowledgements(
            &name,
            request.input,
            request.client_mutation_id,
            request.authority_descriptor,
            &request.acknowledged_client_mutation_ids,
            "http",
            authority,
        )
    })
    .await
    .map_err(ApiError::from)
    .map_err(|error| error.with_attribution(attribution.clone()))?;
    match result {
        Ok(output) => Ok(Json(FunctionResponse::new(
            MutationResponse::from_output(output, receipt),
            attribution,
        ))),
        Err(error) => Err(
            ApiError::with_receipt(error, receipt).with_attribution(attribution),
        ),
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
) -> Result<Json<FunctionResponse<crate::local::FunctionRunResult>>, ApiError> {
    let attribution = authority.function_attribution();
    let Json(input) = input
        .map_err(ApiError::from_json_rejection)
        .map_err(|error| error.with_attribution(attribution.clone()))?;
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
    Ok(Json(FunctionResponse::new(result, attribution)))
}

/// Commit one already-preflighted provisioning pair. Cross-mode changes and
/// every settled-sessions same-mode request own the admission transition:
/// predecessor finite work drains before SQLite can activate, and the local
/// authorization projection completes under the closed epoch before the
/// successor reopens.
async fn commit_prepared_auth_provision(
    runtime: &AppState,
    prepared: PreparedAuthProvision,
    profile: String,
) -> Result<AuthProvisionCommit, ApiError> {
    let predecessor = runtime.auth_mode_state();
    let owns_transition =
        prepared.requested_mode() != predecessor.active || predecessor.active == AuthMode::Sessions;
    let (committed, runtime_state_published) = if owns_transition {
        let controller = runtime.auth_admission_controller();
        let terminal_lifecycle = runtime.auth_terminal_lifecycle.clone();
        let runtime_projection = runtime.clone();
        let transition = tokio::task::spawn_blocking(move || controller.begin_transition())
            .await
            .expect("auth-mode transition task panicked")?;
        let (committed, _state, _published) = with_snapback(&runtime.snapback, move |snapback| {
            transition.commit_project_and_publish_mode_state(|projection_admission| {
                let committed = snapback.commit_auth_provision_classified(
                    prepared,
                    &profile,
                    Some(projection_admission),
                )?;
                if let Some(reason) =
                    committed_mode_terminal_reason(predecessor.as_ref(), &committed.state)
                {
                    let close_by = Instant::now()
                        .checked_add(crate::auth::session_projection::TERMINAL_CLOSE_GRACE)
                        .unwrap_or_else(Instant::now);
                    terminal_lifecycle.committed_mode_transition(reason, close_by);
                }
                runtime_projection
                    .publish_auth_mode_state_while_transition_closed(committed.state.clone())
                    .map_err(ModeCommitFailure::Uncertain)?;
                let state = committed.state.clone();
                Ok((committed, state))
            })
        })
        .await?;
        (committed, true)
    } else {
        let committed = match with_snapback(&runtime.snapback, move |snapback| {
            snapback.commit_auth_provision_classified(prepared, &profile, None)
        })
        .await
        {
            Ok(committed) => committed,
            Err(ModeCommitFailure::RolledBack(error)) => return Err(ApiError::from(error)),
            Err(ModeCommitFailure::Uncertain(error)) => {
                runtime
                    .auth_admission_controller()
                    .fail_closed_after_uncertain_commit()?;
                return Err(ApiError::from(error));
            }
        };
        (committed, false)
    };

    if !runtime_state_published
        && let Err(error) = runtime.publish_auth_mode_state(committed.state.clone())
    {
        runtime
            .auth_admission_controller()
            .fail_closed_after_uncertain_commit()?;
        return Err(ApiError::from(error));
    }
    Ok(committed)
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
                    let committed = commit_prepared_auth_provision(
                        &runtime,
                        prepared,
                        runtime.server.profile.as_str().to_owned(),
                    )
                    .await?;
                    Ok(Json(EnsureAppResponse::Provision(committed.outcome)))
                }
            }
        }
    }
}

async fn acknowledge_authorization_invalidation(
    State(runtime): State<AppState>,
    Extension(_authority): Extension<PreparedAuthority>,
    Extension(connection_act): Extension<PreparedConnectionAct>,
    Extension(admission): Extension<AdmissionLease>,
    input: Result<Json<AuthorizationInvalidationAckInput>, JsonRejection>,
) -> Result<Json<crate::local::AuthorizationInvalidationAckOutput>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    let connection = connection_act
        .authorization_invalidation
        .clone()
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                "auth",
                "connection did not negotiate authInvalidationProtocol: 1",
            )
        })?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || Ok(()))?;
    let ack_admission = admission.clone();
    let output = with_snapback(&runtime.snapback, move |snapback| {
        snapback.acknowledge_authorization_invalidation(input, connection, &ack_admission)
    })
    .await?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || Ok(()))?;
    Ok(Json(output))
}

async fn manual_retry_authorization_invalidation(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(connection_act): Extension<PreparedConnectionAct>,
    Extension(_admission): Extension<AdmissionLease>,
    input: Result<Json<AuthorizationInvalidationManualRetryInput>, JsonRejection>,
) -> Result<Json<crate::local::AuthorizationInvalidationManualRetryOutput>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    let connection = connection_act
        .authorization_invalidation
        .clone()
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                "auth",
                "connection did not negotiate authInvalidationProtocol: 1",
            )
        })?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || Ok(()))?;
    let output = with_snapback(&runtime.snapback, move |snapback| {
        snapback.manual_retry_authorization_invalidation(input, connection, authority)
    })
    .await?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || Ok(()))?;
    Ok(Json(output))
}

async fn subscribe_live(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(connection_act): Extension<PreparedConnectionAct>,
    Path(name): Path<String>,
    input: Result<Json<LiveSubscribeInput>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || Ok(()))?;
    let invalidation = LiveInvalidationAdmission {
        connection: connection_act.authorization_invalidation.clone(),
        effect_fence: Some(connection_act.effect_fence()),
        #[cfg(test)]
        session_mode: false,
    };
    let publication = with_snapback(&runtime.snapback, move |snapback| {
        snapback.subscribe_live_for_transport(&name, input, authority, invalidation)
    })
    .await?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || Ok(()))?;
    let publication_authority = if let Some(authorization) = publication.authorization {
        runtime
            .ephemeral
            .begin_final_send(&RealtimeEnvelope::Durable(
                crate::ephemeral::DurableMessage::authorized(Vec::new(), authorization),
            ))
            .map_err(|error| ApiError::from(SnapbackError::new(diagnostic_from_ephemeral(error))))?
    } else {
        None
    };
    let mut response = Json(publication.output).into_response();
    if let Some(permit) = publication_authority {
        retain_realtime_authority_in(&mut response, vec![permit]);
    }
    Ok(response)
}

async fn resume_live(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(connection_act): Extension<PreparedConnectionAct>,
    Path(name): Path<String>,
    input: Result<Json<LiveResumeInput>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || Ok(()))?;
    let invalidation = LiveInvalidationAdmission {
        connection: connection_act.authorization_invalidation.clone(),
        effect_fence: Some(connection_act.effect_fence()),
        #[cfg(test)]
        session_mode: false,
    };
    let publication = with_snapback(&runtime.snapback, move |snapback| {
        snapback.resume_live_for_transport(&name, input, authority, invalidation)
    })
    .await?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || Ok(()))?;
    let publication_authority = if let Some(authorization) = publication.authorization {
        runtime
            .ephemeral
            .begin_final_send(&RealtimeEnvelope::Durable(
                crate::ephemeral::DurableMessage::authorized(Vec::new(), authorization),
            ))
            .map_err(|error| ApiError::from(SnapbackError::new(diagnostic_from_ephemeral(error))))?
    } else {
        None
    };
    let mut response = Json(publication.output).into_response();
    if let Some(permit) = publication_authority {
        retain_realtime_authority_in(&mut response, vec![permit]);
    }
    Ok(response)
}

async fn unsubscribe_live(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(connection_act): Extension<PreparedConnectionAct>,
    Path(name): Path<String>,
    input: Result<Json<LiveUnsubscribeInput>, JsonRejection>,
) -> Result<Json<crate::local::LiveUnsubscribeOutput>, ApiError> {
    let Json(input) = input.map_err(ApiError::from_json_rejection)?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || Ok(()))?;
    let effect_fence = connection_act.effect_fence();
    // L7 offload: disposal reads the storage version (rusqlite) for its
    // receipt, so it runs on the blocking lane like every other write path.
    let output = with_snapback(&runtime.snapback, move |snapback| {
        snapback.unsubscribe_live_prepared(&name, input, authority, Some(&effect_fence))
    })
    .await?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || Ok(()))?;
    Ok(Json(output))
}

async fn stream_live(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(connection_act): Extension<PreparedConnectionAct>,
    Path(connection_id): Path<String>,
    ws: WebSocketUpgrade,
) -> Response {
    let connections = runtime.connections.clone();
    let policy_mode = runtime.active_policy_auth_mode();
    let authorization_invalidation_ready =
        runtime.auth_program_readiness().authorization_invalidation;
    let admission = runtime.auth_admission_controller();
    let active_mode = authority.active_mode();
    let admission_epoch = authority.admission_epoch();
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    if let Err(error) = connection_act.try_act(&connections, epoch_now_ms, monotonic_now, || Ok(()))
    {
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
                LiveStreamTask {
                    runtime,
                    connection_act,
                    connection_id,
                    policy_mode,
                    authorization_invalidation_ready,
                    admission_controller: admission,
                    active_mode,
                    admission_epoch,
                },
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
    _publication_authority: Option<RealtimePublicationPermit>,
    completed: oneshot::Sender<bool>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LiveHandoffOutcome {
    Sent,
    Superseded,
    Failed,
}

const TERMINAL_AUTH_CLOSE_CODE: u16 = 4401;
const LIVE_WRITE_HANDOFF_TIMEOUT: Duration = Duration::from_millis(5_000);

async fn bounded_live_write<F, E>(write: F, close_by: tokio::time::Instant) -> bool
where
    F: std::future::Future<Output = Result<(), E>>,
{
    tokio::time::timeout_at(close_by, write)
        .await
        .is_ok_and(|result| result.is_ok())
}

async fn finish_terminal_live_write(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    event: crate::ephemeral::DeliveryTerminalEvent,
) {
    let frame = LiveSocketServerFrame::AuthError {
        code: event.code,
        reason: event.reason,
    };
    let payload = match serde_json::to_string(&frame) {
        Ok(payload) => payload,
        Err(_) => return,
    };
    let close_by = tokio::time::Instant::from_std(event.close_by);
    let _ = tokio::time::timeout_at(close_by, async {
        // Failure to send the typed frame never postpones the hard close.
        let _ = sender.send(Message::Text(payload.into())).await;
        let _ = sender
            .send(Message::Close(Some(CloseFrame {
                code: TERMINAL_AUTH_CLOSE_CODE,
                reason: Utf8Bytes::from_static("auth_error"),
            })))
            .await;
    })
    .await;
}

async fn live_socket_writer(
    mut sender: futures_util::stream::SplitSink<WebSocket, Message>,
    mut writes: mpsc::Receiver<AdmittedLiveWrite>,
    mut terminal_writes: mpsc::Receiver<crate::ephemeral::DeliveryTerminalEvent>,
    notify: Arc<crate::ephemeral::DeliveryNotifier>,
    connection_id: String,
    generation: u64,
) {
    loop {
        let write = tokio::select! {
            biased;
            Some(event) = terminal_writes.recv() => {
                finish_terminal_live_write(&mut sender, event).await;
                break;
            }
            write = writes.recv() => write,
        };
        let Some(write) = write else {
            break;
        };
        let AdmittedLiveWrite {
            message,
            admission,
            _publication_authority: publication_authority,
            completed,
        } = write;
        if !notify.is_deliverable(&connection_id, generation) {
            let _ = completed.send(false);
            drop(publication_authority);
            drop(admission);
            if let Some(event) = notify.terminal_if_current(&connection_id, generation) {
                finish_terminal_live_write(&mut sender, event).await;
            }
            break;
        }
        let mut terminal = None;
        let sent = tokio::select! {
            biased;
            Some(event) = terminal_writes.recv() => {
                terminal = Some(event);
                false
            },
            _ = admission.cancelled() => false,
            sent = bounded_live_write(
                sender.send(message),
                tokio::time::Instant::now() + LIVE_WRITE_HANDOFF_TIMEOUT,
            ) => sent,
        };
        let _ = completed.send(sent);
        // Quiescence depends on these guards, not on the socket close. Drop
        // them before a best-effort terminal frame or any subsequent await.
        drop(publication_authority);
        drop(admission);
        if let Some(event) = terminal {
            finish_terminal_live_write(&mut sender, event).await;
            break;
        }
        if !sent {
            break;
        }
    }
}

fn offer_terminal_live_write(
    terminal_writer: &mpsc::Sender<crate::ephemeral::DeliveryTerminalEvent>,
    event: crate::ephemeral::DeliveryTerminalEvent,
) {
    // This dedicated one-slot channel is never occupied by ordinary effects.
    // A failed offer means the writer has already stopped; it must not extend
    // the close deadline or resume ordinary draining.
    let _ = terminal_writer.try_send(event);
}

#[derive(Clone, Copy)]
struct LiveHandoffCut<'a> {
    writer: &'a mpsc::Sender<AdmittedLiveWrite>,
    notify: &'a crate::ephemeral::DeliveryNotifier,
    connection_id: &'a str,
    generation: u64,
    connections: &'a ConnectionRegistry,
    connection_act: &'a PreparedConnectionAct,
}

async fn send_live_with_admission(
    cut: LiveHandoffCut<'_>,
    message: Message,
    admission: &AdmissionLease,
    publication_authority: Option<RealtimePublicationPermit>,
    outbox_lease: Option<crate::ephemeral::OutboxDrainLease>,
    projection_outbox: Option<&EphemeralApi>,
) -> LiveHandoffOutcome {
    let LiveHandoffCut {
        writer,
        notify,
        connection_id,
        generation,
        connections,
        connection_act,
    } = cut;
    let (completed, completion) = oneshot::channel();
    // The complete frame crosses into the bounded writer queue under the same
    // mutex that retires an epoch. Socket I/O may await afterward, but no frame
    // can begin its writer handoff after the retirement cut.
    let write = AdmittedLiveWrite {
        message,
        admission: admission.clone(),
        _publication_authority: publication_authority,
        completed,
    };
    let handed_off = {
        let Ok(_publication) = admission.effect_guard("WebSocket writer handoff") else {
            return LiveHandoffOutcome::Failed;
        };
        connection_act
            .try_act(connections, now_millis(), Instant::now(), move || {
                Ok(match (outbox_lease, projection_outbox) {
                    (Some(outbox_lease), _) => {
                        let outcome = notify.act_if_current(connection_id, generation, || {
                            outbox_lease.try_commit(write, |write| {
                                writer.try_send(write).map_err(|error| error.into_inner())
                            })
                        });
                        // `act_if_current` released the notifier lock. Waking
                        // here preserves registry -> notifier -> outbox order.
                        outbox_lease.wake();
                        match outcome {
                            Some(crate::ephemeral::OutboxLeaseCommit::Committed) => {
                                LiveHandoffOutcome::Sent
                            }
                            Some(crate::ephemeral::OutboxLeaseCommit::Superseded(write)) => {
                                drop(write);
                                LiveHandoffOutcome::Superseded
                            }
                            Some(crate::ephemeral::OutboxLeaseCommit::OfferFailed(write)) => {
                                drop(write);
                                LiveHandoffOutcome::Failed
                            }
                            None => LiveHandoffOutcome::Failed,
                        }
                    }
                    (None, Some(ephemeral)) => {
                        let outcome = notify.act_if_current(connection_id, generation, || {
                            ephemeral.try_offer_outbox_projection_bound(
                                connection_id,
                                &connection_act.effect_fence(),
                                write,
                                |write| writer.try_send(write).map_err(|error| error.into_inner()),
                            )
                        });
                        match outcome {
                            Some(crate::ephemeral::OutboxLeaseCommit::Committed) => {
                                LiveHandoffOutcome::Sent
                            }
                            Some(crate::ephemeral::OutboxLeaseCommit::Superseded(write)) => {
                                drop(write);
                                LiveHandoffOutcome::Superseded
                            }
                            Some(crate::ephemeral::OutboxLeaseCommit::OfferFailed(write)) => {
                                drop(write);
                                LiveHandoffOutcome::Failed
                            }
                            None => LiveHandoffOutcome::Failed,
                        }
                    }
                    (None, None) => {
                        if writer.try_send(write).is_ok() {
                            LiveHandoffOutcome::Sent
                        } else {
                            LiveHandoffOutcome::Failed
                        }
                    }
                })
            })
            .unwrap_or(LiveHandoffOutcome::Failed)
    };
    if handed_off != LiveHandoffOutcome::Sent {
        return handed_off;
    }
    if tokio::select! {
        biased;
        _ = admission.cancelled() => false,
        result = completion => result.unwrap_or(false),
    } {
        LiveHandoffOutcome::Sent
    } else {
        LiveHandoffOutcome::Failed
    }
}

struct LiveStreamTask {
    runtime: AppState,
    connection_act: PreparedConnectionAct,
    connection_id: String,
    policy_mode: PolicyAuthMode,
    authorization_invalidation_ready: bool,
    admission_controller: AuthAdmissionController,
    active_mode: AuthMode,
    admission_epoch: u64,
}

async fn live_stream(socket: WebSocket, task: LiveStreamTask) {
    let LiveStreamTask {
        runtime,
        connection_act,
        connection_id,
        policy_mode,
        authorization_invalidation_ready,
        admission_controller,
        active_mode,
        mut admission_epoch,
    } = task;
    let state = runtime.snapback.clone();
    let read = runtime.read.clone();
    let ephemeral = runtime.ephemeral.clone();
    let connections = runtime.connections.clone();
    let (sender, mut receiver) = socket.split();
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L8: an enqueue
    // wakes this task immediately (sub-poll-interval delivery, and no periodic
    // lock traffic while idle). The long interval is a safety net only, in case
    // a wake is ever missed; register before draining so no push is lost.
    let notify = ephemeral.delivery_notifier();
    let terminal_capture = connection_act.terminal_capture();
    let Ok((generation, waker)) = notify.register_bound(&connection_id, terminal_capture.grant_id)
    else {
        // Generation reuse could transfer drain/teardown ownership to a stale
        // socket. Exhaustion is process-terminal for new live streams.
        return;
    };
    let (writer, writes) = mpsc::channel(1);
    let (terminal_writer, terminal_writes) = mpsc::channel(1);
    let writer_task = tokio::spawn(live_socket_writer(
        sender,
        writes,
        terminal_writes,
        notify.clone(),
        connection_id.clone(),
        generation,
    ));
    let handoff_cut = LiveHandoffCut {
        writer: &writer,
        notify: &notify,
        connection_id: &connection_id,
        generation,
        connections: &connections,
        connection_act: &connection_act,
    };
    let authorization_invalidation_negotiated =
        active_mode == AuthMode::Sessions && connection_act.authorization_invalidation.is_some();
    // Session invalidation is level-triggered, so its safety-net tick is also
    // the bounded re-fire. Dev retains the lower-traffic 30s fallback.
    let heartbeat_ms = if authorization_invalidation_negotiated {
        crate::auth::invalidation::AUTH_INVALIDATION_REFIRE_MAX_MS
    } else {
        30_000
    };
    let mut safety_net = interval(Duration::from_millis(heartbeat_ms));
    safety_net.tick().await; // consume the immediate first tick

    // Flush anything enqueued before (or racing) registration under one short
    // managed root. The HTTP upgrade root ends with the 101 response; it is
    // never retained for the lifetime of the socket.
    let Some(initial_admission) =
        acquire_live_act_admission(&admission_controller, active_mode, &mut admission_epoch).await
    else {
        drop(writer);
        drop(terminal_writer);
        let _ = writer_task.await;
        teardown_live_stream(&state, &notify, &connection_id, generation).await;
        return;
    };
    if let Some(event) = notify.terminal_if_current(&connection_id, generation) {
        offer_terminal_live_write(&terminal_writer, event);
        drop(writer);
        drop(terminal_writer);
        let _ = writer_task.await;
        teardown_live_stream(&state, &notify, &connection_id, generation).await;
        return;
    }
    let initial_current = initial_admission
        .effect_guard("initial WebSocket drain")
        .is_ok_and(|_effect| {
            connection_act
                .try_act(&connections, now_millis(), Instant::now(), || {
                    Ok(notify.is_current(&connection_id, generation))
                })
                .unwrap_or(false)
        });
    if !initial_current
        || drain_and_send(LiveDrain {
            state: &state,
            ephemeral: &ephemeral,
            connection_id: &connection_id,
            generation,
            writer: &writer,
            notify: &notify,
            admission: &initial_admission,
            connections: &connections,
            connection_act: &connection_act,
            reproject_authorization: authorization_invalidation_negotiated
                && read.connection_has_auth_scoped_live(&connection_id),
        })
        .await
        .is_break()
    {
        if let Some(event) = notify.terminal_if_current(&connection_id, generation) {
            offer_terminal_live_write(&terminal_writer, event);
        }
        drop(writer);
        drop(terminal_writer);
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
                        {
                            let Ok(_effect) = admission.effect_guard("WebSocket inbound preflight") else {
                                break 'stream;
                            };
                            if connection_act
                                .try_act(&connections, now_millis(), Instant::now(), || Ok(()))
                                .is_err()
                            {
                                break 'stream;
                            }
                        }
                        let room_authorization = match authorize_live_socket_room(
                            &runtime,
                            &connection_id,
                            &text,
                            policy_mode,
                            &connection_act.resolved,
                            connection_act.authorization_invalidation.is_some(),
                        )
                        .await
                        {
                            Ok(room_authorization) => room_authorization,
                            Err(response) => {
                                if send_live_with_admission(
                                    handoff_cut,
                                    Message::Text(response.text.into()),
                                    &admission,
                                    response
                                        .room_authority
                                        .map(RealtimePublicationPermit::Room),
                                    None,
                                    None,
                                )
                                .await
                                    != LiveHandoffOutcome::Sent
                                {
                                    break 'stream;
                                }
                                continue 'stream;
                            }
                        };
                        let response = {
                            let Ok(_effect) = admission.effect_guard("WebSocket inbound act") else {
                                break 'stream;
                            };
                            let Ok(response) = connection_act.try_act(
                                &connections,
                                now_millis(),
                                Instant::now(),
                                || Ok(handle_live_socket_text_authorized(
                                    &ephemeral,
                                    &connection_id,
                                    &text,
                                    policy_mode,
                                    authorization_invalidation_ready,
                                    &connection_act.resolved,
                                    LiveSocketEffectContext {
                                        protected_room: room_authorization.as_ref(),
                                        effect_fence: Some(&connection_act.effect_fence()),
                                    },
                                )),
                            ) else {
                                break 'stream;
                            };
                            response
                        };
                        let outer_room_authority =
                            room_authorization.and_then(|authorization| authorization.permit);
                        if send_live_with_admission(
                            handoff_cut,
                            Message::Text(response.text.into()),
                            &admission,
                            response
                                .room_authority
                                .or(outer_room_authority)
                                .map(RealtimePublicationPermit::Room),
                            None,
                            None,
                        ).await != LiveHandoffOutcome::Sent {
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
                        {
                            let Ok(_effect) = admission.effect_guard("WebSocket liveness act") else {
                                break 'stream;
                            };
                            if connection_act
                                .try_act(&connections, now_millis(), Instant::now(), || {
                                    ephemeral.touch_connection(&connection_id);
                                    Ok(())
                                })
                                .is_err()
                            {
                                break 'stream;
                            }
                        }
                        let deadline = match record_connection_authenticated_use(
                            &runtime,
                            connection_act.authenticated_use_key(),
                            &admission,
                        ).await {
                            Ok(deadline) => deadline,
                            Err(_) => break 'stream,
                        };
                        if let Some(deadline_ms) = deadline {
                            let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
                            if connections
                                .refresh_act_deadline(
                                    &connection_act,
                                    deadline_ms,
                                    epoch_now_ms,
                                    monotonic_now,
                                )
                                .is_err()
                            {
                                break 'stream;
                            }
                        }
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
                        if connection_act
                            .try_act(&connections, now_millis(), Instant::now(), || Ok(()))
                            .is_err()
                        {
                            break 'stream;
                        }
                        None
                    },
                }
            }
            _ = waker.notified() => {
                if let Some(event) = notify.terminal_if_current(&connection_id, generation) {
                    offer_terminal_live_write(&terminal_writer, event);
                    break 'stream;
                }
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
                if connection_act
                    .try_act(&connections, now_millis(), Instant::now(), || Ok(()))
                    .is_err()
                {
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
                    .is_ok_and(|_effect| {
                        connection_act
                            .try_act(&connections, now_millis(), Instant::now(), || Ok(()))
                            .is_ok()
                    });
                if !current || send_live_with_admission(
                    handoff_cut,
                    Message::Ping(Vec::new().into()),
                    &admission,
                    None,
                    None,
                    None,
                ).await != LiveHandoffOutcome::Sent {
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
                .is_ok_and(|_effect| {
                    connection_act
                        .try_act(&connections, now_millis(), Instant::now(), || {
                            Ok(notify.is_current(&connection_id, generation))
                        })
                        .unwrap_or(false)
                });
            if !current {
                break 'stream;
            }
            if drain_and_send(LiveDrain {
                state: &state,
                ephemeral: &ephemeral,
                connection_id: &connection_id,
                generation,
                writer: &writer,
                notify: &notify,
                admission: &admission,
                connections: &connections,
                connection_act: &connection_act,
                reproject_authorization: authorization_invalidation_negotiated
                    && read.connection_has_auth_scoped_live(&connection_id),
            })
            .await
            .is_break()
            {
                break 'stream;
            }
        }
    }

    if let Some(event) = notify.terminal_if_current(&connection_id, generation) {
        offer_terminal_live_write(&terminal_writer, event);
    }
    drop(writer);
    drop(terminal_writer);
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
struct LiveDrain<'a> {
    state: &'a SharedSnapback,
    ephemeral: &'a EphemeralApi,
    connection_id: &'a str,
    generation: u64,
    writer: &'a mpsc::Sender<AdmittedLiveWrite>,
    notify: &'a crate::ephemeral::DeliveryNotifier,
    admission: &'a AdmissionLease,
    connections: &'a ConnectionRegistry,
    connection_act: &'a PreparedConnectionAct,
    reproject_authorization: bool,
}

fn defer_ws_projections_for_recovery_marker(
    projections: &mut Vec<crate::ephemeral::DurableMessage>,
    messages: &[crate::ephemeral::AdmittedRealtimeEnvelope],
) {
    if messages
        .first()
        .is_some_and(crate::ephemeral::AdmittedRealtimeEnvelope::is_recovery_marker)
    {
        // Recovery is the sole WS frame for this drain. Projection obligations
        // are level-triggered and regenerate after the marker is accepted.
        projections.clear();
    }
}

async fn drain_and_send(drain: LiveDrain<'_>) -> std::ops::ControlFlow<()> {
    let LiveDrain {
        state,
        ephemeral,
        connection_id,
        generation,
        writer,
        notify,
        admission,
        connections,
        connection_act,
        reproject_authorization,
    } = drain;
    let handoff_cut = LiveHandoffCut {
        writer,
        notify,
        connection_id,
        generation,
        connections,
        connection_act,
    };
    // Re-run durable projections before acquiring publication permits: a
    // prepared authorization commit holds the write lane while waiting for
    // them, so taking one and then waiting on `with_snapback` would invert the
    // commit order.
    let recovery_marker_pending = {
        let Ok(_effect) = admission.effect_guard("WebSocket recovery priority check") else {
            return std::ops::ControlFlow::Break(());
        };
        let Ok(pending) = connection_act.try_act(connections, now_millis(), Instant::now(), || {
            Ok(ephemeral
                .has_eligible_recovery_marker_bound_if_active(
                    connection_id,
                    &connection_act.effect_fence(),
                )
                .unwrap_or(false))
        }) else {
            return std::ops::ControlFlow::Break(());
        };
        pending
    };
    let mut projections = if reproject_authorization && !recovery_marker_pending {
        let connection = connection_id.to_owned();
        let rerun_admission = admission.clone();
        match with_snapback(state, move |snapback| {
            snapback.authorization_invalidation_frames(&connection, &rerun_admission)
        })
        .await
        {
            Ok(projections) => projections,
            Err(_) => return std::ops::ControlFlow::Break(()),
        }
    } else {
        Vec::new()
    };
    let projection_handoff_bytes = projections.iter().fold(0_usize, |total, projection| {
        total.saturating_add(crate::ephemeral::estimated_durable_handoff_bytes(
            projection,
        ))
    });
    let outbox_handoff_limit =
        crate::ephemeral::MAX_OUTBOX_HANDOFF_BYTES.saturating_sub(projection_handoff_bytes);
    // @ref LLP 0059#durable-and-ephemeral-outboxes — direct projections and
    // the selected queue clone share one eager transport handoff budget.
    let messages = {
        let Ok(_effect) = admission.effect_guard("WebSocket outbox drain") else {
            return std::ops::ControlFlow::Break(());
        };
        let Ok(Some(messages)) =
            connection_act.try_act(connections, now_millis(), Instant::now(), || {
                Ok(
                    ephemeral.drain_live_stream_for_send_bound_if_current_with_handoff_limit(
                        connection_id,
                        generation,
                        &connection_act.effect_fence(),
                        outbox_handoff_limit,
                    ),
                )
            })
        else {
            return std::ops::ControlFlow::Break(());
        };
        messages
    };
    defer_ws_projections_for_recovery_marker(&mut projections, &messages);
    for admitted in messages {
        let (envelope, publication_authority, outbox_lease) = admitted.into_leased_parts();
        let Some(message) = live_stream_text(envelope) else {
            continue;
        };
        match send_live_with_admission(
            handoff_cut,
            Message::Text(message.into()),
            admission,
            publication_authority,
            Some(outbox_lease),
            None,
        )
        .await
        {
            LiveHandoffOutcome::Sent => {}
            LiveHandoffOutcome::Superseded => continue,
            LiveHandoffOutcome::Failed => return std::ops::ControlFlow::Break(()),
        }
    }
    for projection in projections {
        let envelope = RealtimeEnvelope::Durable(projection);
        let publication_authority = match ephemeral.begin_final_send(&envelope) {
            Ok(publication_authority) => publication_authority,
            Err(_) => return std::ops::ControlFlow::Break(()),
        };
        let Some(message) = live_stream_text(envelope) else {
            continue;
        };
        match send_live_with_admission(
            handoff_cut,
            Message::Text(message.into()),
            admission,
            publication_authority,
            None,
            Some(ephemeral),
        )
        .await
        {
            LiveHandoffOutcome::Sent => {}
            LiveHandoffOutcome::Superseded => {
                // A recovery marker won after projection computation. Its
                // enqueue wake is level-triggered; defer every remaining
                // projection to the next drain rather than closing the socket.
                return std::ops::ControlFlow::Continue(());
            }
            LiveHandoffOutcome::Failed => return std::ops::ControlFlow::Break(()),
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

/// Session-mode socket requests deliberately omit every client-asserted
/// identity field. The connection grant supplies authority after this closed
/// shape has decoded; dev mode continues to decode the legacy DTO unchanged.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum SessionLiveSocketClientMessage {
    EphemeralSubscribe {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: SessionSubscribeRequest,
    },
    EphemeralPublish {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: SessionPublishRequest,
    },
    EphemeralDelete {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: SessionDeleteRequest,
    },
    EphemeralUnsubscribe {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: SessionSubscribeRequest,
    },
    Ping {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionSubscribeRequest {
    collection: String,
    scope: Scope,
    connection_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionPublishRequest {
    collection: String,
    scope: Scope,
    connection_id: String,
    value: Vec<u8>,
    ttl_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionDeleteRequest {
    collection: String,
    scope: Scope,
    connection_id: String,
}

impl SessionSubscribeRequest {
    fn resolve(self, authority: &ResolvedAppAuthority) -> SubscribeRequest {
        SubscribeRequest {
            collection: self.collection,
            scope: self.scope,
            connection_id: self.connection_id,
            auth: ephemeral_auth_from_authority(authority),
        }
    }
}

impl SessionPublishRequest {
    fn resolve(self, authority: &ResolvedAppAuthority) -> PublishRequest {
        let auth = ephemeral_auth_from_authority(authority);
        PublishRequest {
            collection: self.collection,
            scope: self.scope,
            connection_id: self.connection_id,
            session_id: auth.session_id.clone(),
            user_id: auth.user_id.clone(),
            custom_key: None,
            value: self.value,
            ttl_ms: self.ttl_ms,
            auth,
        }
    }
}

impl SessionDeleteRequest {
    fn resolve(self, authority: &ResolvedAppAuthority) -> DeleteRequest {
        let auth = ephemeral_auth_from_authority(authority);
        DeleteRequest {
            collection: self.collection,
            scope: self.scope,
            connection_id: self.connection_id,
            session_id: auth.session_id.clone(),
            user_id: auth.user_id.clone(),
            custom_key: None,
            auth,
        }
    }
}

fn ephemeral_auth_from_authority(authority: &ResolvedAppAuthority) -> AuthContext {
    match authority {
        ResolvedAppAuthority::Session {
            user_id,
            session_id,
            ..
        } => AuthContext {
            principal: None,
            session_id: Some(session_id.clone()),
            user_id: Some(user_id.clone()),
            permissions: Default::default(),
        },
        ResolvedAppAuthority::DevImpersonation { user_id, .. } => AuthContext {
            principal: None,
            session_id: None,
            user_id: Some(user_id.clone()),
            permissions: Default::default(),
        },
        // The invocation gate refuses service-principal authority for every
        // ephemeral source in v1. Keep the projection userless as a second
        // fail-closed wall if a caller reaches this conversion unexpectedly.
        ResolvedAppAuthority::ServicePrincipal { .. } => AuthContext::default(),
        ResolvedAppAuthority::Anonymous
        | ResolvedAppAuthority::AdminBypass { .. }
        | ResolvedAppAuthority::System => AuthContext::default(),
    }
}

struct BoundRoomAuthorization {
    auth: AuthContext,
    permit: Option<RoomAuthorityPermit>,
}

/// Convert freshly bound connection authority into a durable room grant while
/// holding the targeted room permit from before the pinned lookup through the
/// caller's room act and final transport sink. Commit preparation therefore
/// either arrives first and rejects admission, or waits for this exact lookup
/// and act to finish; unrelated rooms never queue behind the writer mutex.
///
/// @ref LLP 0053#ephemeral-room-authority-invalidation — lookup and every
/// effect sink remain on one side of the commit-ordered room barrier.
async fn authorize_bound_ephemeral_room(
    runtime: &AppState,
    collection: &str,
    scope: &Scope,
    base_auth: AuthContext,
    invalidation_negotiated: bool,
) -> Result<BoundRoomAuthorization, ApiError> {
    if !runtime
        .ephemeral
        .collection_requires_room_permission(collection)
    {
        return Ok(BoundRoomAuthorization {
            auth: base_auth,
            permit: None,
        });
    }
    if !invalidation_negotiated {
        return Err(ApiError::from(SnapbackError::error(
            "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
            "auth",
            "protected room operations require authInvalidationProtocol: 1",
        )));
    }
    let issuer = runtime
        .auth_invalidation
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
        .ok_or_else(|| {
            ApiError::from(SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                "auth",
                "protected room authority requires an authenticated invalidation issuer",
            ))
        })?;
    let collection_definition = runtime
        .ephemeral
        .collection_definition(collection)
        .ok_or_else(|| {
            ApiError::from(SnapbackError::error(
                "SNAPBACK_EPHEMERAL_UNKNOWN_COLLECTION",
                "ephemeral",
                "ephemeral collection is not loaded",
            ))
        })?;
    for _ in 0..3 {
        let (auth, observed, permit) = if runtime.read.available() {
            let permit = runtime
                .ephemeral
                .begin_server_authorized_room_act(collection, scope)
                .map_err(ApiError::from_ephemeral)?
                .ok_or_else(|| {
                    ApiError::from(SnapbackError::error(
                        "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                        "auth",
                        "protected room did not publish a room-authority permit",
                    ))
                })?;
            let read = runtime.read.clone();
            let candidate = base_auth.clone();
            let room_scope = scope.clone();
            let definition = collection_definition.clone();
            let (auth, observed) = with_read_lane(&read, move |lane| {
                lane.authorize_ephemeral_room_observed(definition, room_scope, candidate)
            })
            .await?;
            (auth, observed, permit)
        } else {
            // In-memory SQLite has no independent snapshot lane. Preserve the
            // serialized compatibility path: the write mutex orders lookup
            // against prepare, and the post-lookup permit + witness comparison
            // still prevents a stale act from crossing commit.
            let collection_name = collection.to_owned();
            let room_scope = scope.clone();
            let candidate = base_auth.clone();
            let (auth, observed) = with_snapback(&runtime.snapback, move |snapback| {
                snapback.authorize_ephemeral_room_observed(&collection_name, &room_scope, candidate)
            })
            .await?;
            let permit = runtime
                .ephemeral
                .begin_server_authorized_room_act(collection, scope)
                .map_err(ApiError::from_ephemeral)?
                .ok_or_else(|| {
                    ApiError::from(SnapbackError::error(
                        "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                        "auth",
                        "protected room did not publish a room-authority permit",
                    ))
                })?;
            (auth, observed, permit)
        };
        if issuer.authorization_expectation()? == observed {
            return Ok(BoundRoomAuthorization {
                auth,
                permit: Some(permit),
            });
        }
        drop(permit);
    }
    Err(ApiError::from(SnapbackError::error(
        "SNAPBACK_EPHEMERAL_AUTHORITY_PENDING",
        "ephemeral",
        "room authority changed while its durable permission was being resolved",
    )))
}

impl SessionLiveSocketClientMessage {
    fn room_target(&self) -> Option<(Option<String>, &'static str, &str, &Scope, &str)> {
        match self {
            Self::EphemeralSubscribe {
                request_id,
                request,
            } => Some((
                request_id.clone(),
                "subscribe",
                &request.collection,
                &request.scope,
                &request.connection_id,
            )),
            Self::EphemeralPublish {
                request_id,
                request,
            } => Some((
                request_id.clone(),
                "publish",
                &request.collection,
                &request.scope,
                &request.connection_id,
            )),
            Self::EphemeralDelete {
                request_id,
                request,
            } => Some((
                request_id.clone(),
                "delete",
                &request.collection,
                &request.scope,
                &request.connection_id,
            )),
            Self::EphemeralUnsubscribe {
                request_id,
                request,
            } => Some((
                request_id.clone(),
                "unsubscribe",
                &request.collection,
                &request.scope,
                &request.connection_id,
            )),
            Self::Ping { .. } => None,
        }
    }

    fn resolve(self, authority: &ResolvedAppAuthority) -> LiveSocketClientMessage {
        match self {
            Self::EphemeralSubscribe {
                request_id,
                request,
            } => LiveSocketClientMessage::EphemeralSubscribe {
                request_id,
                request: request.resolve(authority),
            },
            Self::EphemeralPublish {
                request_id,
                request,
            } => LiveSocketClientMessage::EphemeralPublish {
                request_id,
                request: request.resolve(authority),
            },
            Self::EphemeralDelete {
                request_id,
                request,
            } => LiveSocketClientMessage::EphemeralDelete {
                request_id,
                request: request.resolve(authority),
            },
            Self::EphemeralUnsubscribe {
                request_id,
                request,
            } => LiveSocketClientMessage::EphemeralUnsubscribe {
                request_id,
                request: request.resolve(authority),
            },
            Self::Ping { request_id } => LiveSocketClientMessage::Ping { request_id },
        }
    }
}

async fn authorize_live_socket_room(
    runtime: &AppState,
    connection_id: &str,
    text: &str,
    policy_mode: PolicyAuthMode,
    authority: &ResolvedAppAuthority,
    invalidation_negotiated: bool,
) -> Result<Option<BoundRoomAuthorization>, LiveSocketResponse> {
    if policy_mode != PolicyAuthMode::Sessions {
        return Ok(None);
    }
    let Ok(message) = serde_json::from_str::<SessionLiveSocketClientMessage>(text) else {
        return Ok(None);
    };
    let Some((request_id, operation, collection, scope, frame_connection)) = message.room_target()
    else {
        return Ok(None);
    };
    if frame_connection != connection_id
        || !runtime
            .ephemeral
            .collection_requires_room_permission(collection)
    {
        return Ok(None);
    }
    if !invalidation_negotiated {
        return Err(socket_error(
            request_id,
            operation,
            Diagnostic::error(
                "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                "auth",
                "protected room operations require authInvalidationProtocol: 1",
            ),
        )
        .into());
    }
    authorize_bound_ephemeral_room(
        runtime,
        collection,
        scope,
        ephemeral_auth_from_authority(authority),
        true,
    )
    .await
    .map(Some)
    .map_err(|error| socket_error(request_id, operation, error.0.diagnostic).into())
}

/// Handle a socket-text operation. Ephemeral operations reach the room
/// authority directly — a busy mutation holding the global write mutex cannot
/// delay a cursor publish on this socket (LLP 0032 L9).
struct LiveSocketResponse {
    text: String,
    room_authority: Option<RoomAuthorityPermit>,
}

#[derive(Clone, Copy, Default)]
struct LiveSocketEffectContext<'a> {
    protected_room: Option<&'a BoundRoomAuthorization>,
    effect_fence: Option<&'a crate::ephemeral::ConnectionEffectFence>,
}

impl From<String> for LiveSocketResponse {
    fn from(text: String) -> Self {
        Self {
            text,
            room_authority: None,
        }
    }
}

#[cfg(test)]
fn handle_live_socket_text(
    ephemeral: &EphemeralApi,
    connection_id: &str,
    text: &str,
    policy_mode: PolicyAuthMode,
    authorization_invalidation_ready: bool,
    authority: &ResolvedAppAuthority,
) -> LiveSocketResponse {
    handle_live_socket_text_authorized(
        ephemeral,
        connection_id,
        text,
        policy_mode,
        authorization_invalidation_ready,
        authority,
        LiveSocketEffectContext::default(),
    )
}

fn handle_live_socket_text_authorized(
    ephemeral: &EphemeralApi,
    connection_id: &str,
    text: &str,
    policy_mode: PolicyAuthMode,
    authorization_invalidation_ready: bool,
    authority: &ResolvedAppAuthority,
    effect_context: LiveSocketEffectContext<'_>,
) -> LiveSocketResponse {
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
        )
        .into();
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
            )
            .into();
        }
    };
    let decoded = match policy_mode {
        PolicyAuthMode::Sessions => {
            if let Some(field) = legacy_body_auth_field(&raw) {
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
                )
                .into();
            }
            serde_json::from_value::<SessionLiveSocketClientMessage>(raw.clone())
                .map(|message| message.resolve(authority))
        }
        PolicyAuthMode::Dev => serde_json::from_value::<LiveSocketClientMessage>(raw.clone()),
    };
    let mut message = match decoded {
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
            )
            .into();
        }
    };
    if let Some(auth) = effect_context
        .protected_room
        .map(|authorization| authorization.auth.clone())
    {
        match &mut message {
            LiveSocketClientMessage::EphemeralSubscribe { request, .. }
            | LiveSocketClientMessage::EphemeralUnsubscribe { request, .. } => {
                request.auth = auth;
            }
            LiveSocketClientMessage::EphemeralPublish { request, .. } => {
                request.auth = auth;
            }
            LiveSocketClientMessage::EphemeralDelete { request, .. } => {
                request.auth = auth;
            }
            LiveSocketClientMessage::Ping { .. } => {}
        }
    }
    let admitted_room_authority = effect_context
        .protected_room
        .and_then(|authorization| authorization.permit.as_ref());
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
        )
        .into();
    }

    // The HTTP and WebSocket twins share the item-5 activation floor. A
    // protected room subscribe is an auth-scoped live materialization even
    // though its control frame arrives after the upgrade, so it must be
    // refused before the room registration exists until item 6 installs the
    // authorization-invalidation protocol. Public rooms remain available.
    //
    // @ref LLP 0058#live-and-replay-admission-before-later-items — protected
    //   ephemeral registration is unavailable before item 6 on every transport.
    if matches!(policy_mode, PolicyAuthMode::Sessions)
        && !authorization_invalidation_ready
        && let LiveSocketClientMessage::EphemeralSubscribe {
            request_id,
            request,
        } = &message
        && ephemeral
            .subscription_requires_permission(&request.collection)
            .unwrap_or(false)
    {
        return socket_error(
            request_id.clone(),
            "ephemeral_subscribe",
            Diagnostic::error(
                "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                "auth",
                "auth-scoped live work is unavailable until authorization invalidation is ready",
            )
            .with_details(json!({ "capability": "authScopedLive" })),
        )
        .into();
    }

    // Liveness probe: answered immediately and statelessly (no lock, no
    // connection binding to check — the probe carries no connection_id and
    // performs no operation on connection state).
    if let LiveSocketClientMessage::Ping { request_id } = &message {
        return socket_pong(request_id.clone()).into();
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
        )
        .into();
    }

    match message {
        LiveSocketClientMessage::EphemeralSubscribe {
            request_id,
            request,
        } => match match effect_context.effect_fence {
            Some(effect_fence) => ephemeral.subscribe_with_room_authority_and_effect_fence(
                request,
                now_millis(),
                admitted_room_authority,
                effect_fence.clone(),
            ),
            None => ephemeral.subscribe_with_room_authority(
                request,
                now_millis(),
                admitted_room_authority,
            ),
        } {
            Ok(message) => admitted_socket_ack(
                ephemeral,
                request_id,
                "subscribe",
                json!({ "message": &message }),
                Some(&message),
                admitted_room_authority,
            ),
            Err(error) => {
                socket_error(request_id, "subscribe", diagnostic_from_ephemeral(error)).into()
            }
        },
        LiveSocketClientMessage::EphemeralPublish {
            request_id,
            request,
        } => match ephemeral.publish_with_room_authority(
            request,
            now_millis(),
            admitted_room_authority,
        ) {
            Ok(outcome) => socket_ack(request_id, "publish", json!({ "outcome": outcome })).into(),
            Err(error) => {
                socket_error(request_id, "publish", diagnostic_from_ephemeral(error)).into()
            }
        },
        LiveSocketClientMessage::EphemeralDelete {
            request_id,
            request,
        } => match ephemeral.delete_with_room_authority(
            request,
            now_millis(),
            admitted_room_authority,
        ) {
            Ok(message) => admitted_socket_ack(
                ephemeral,
                request_id,
                "delete",
                json!({ "message": &message }),
                message.as_ref(),
                admitted_room_authority,
            ),
            Err(error) => {
                socket_error(request_id, "delete", diagnostic_from_ephemeral(error)).into()
            }
        },
        LiveSocketClientMessage::EphemeralUnsubscribe {
            request_id,
            request,
        } => {
            let receipt_scope = request.scope.clone();
            let collection = request.collection.clone();
            match ephemeral.unsubscribe_with_room_authority(
                request,
                now_millis(),
                admitted_room_authority,
            ) {
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
                    .into()
                }
                Err(error) => {
                    socket_error(request_id, "unsubscribe", diagnostic_from_ephemeral(error)).into()
                }
            }
        }
        LiveSocketClientMessage::Ping { .. } => unreachable!("handled above"),
    }
}

fn admitted_socket_ack(
    ephemeral: &EphemeralApi,
    request_id: Option<String>,
    operation: &str,
    body: Value,
    message: Option<&crate::ephemeral::EphemeralMessage>,
    admitted_room_authority: Option<&RoomAuthorityPermit>,
) -> LiveSocketResponse {
    let room_authority = match (message, admitted_room_authority) {
        (Some(_), Some(_)) => None,
        (Some(message), None) => {
            match ephemeral.begin_final_send(&RealtimeEnvelope::Ephemeral(message.clone())) {
                Ok(Some(RealtimePublicationPermit::Room(room_authority))) => Some(room_authority),
                Ok(None) => None,
                Ok(Some(RealtimePublicationPermit::Durable { .. })) => {
                    unreachable!("an ephemeral acknowledgement cannot acquire durable authority")
                }
                Err(error) => {
                    return socket_error(request_id, operation, diagnostic_from_ephemeral(error))
                        .into();
                }
            }
        }
        (None, _) => None,
    };
    LiveSocketResponse {
        text: socket_ack(request_id, operation, body),
        room_authority,
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
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(connection_act): Extension<PreparedConnectionAct>,
    Extension(admission): Extension<AdmissionLease>,
    Path(_connection_id): Path<String>,
) -> Result<Response, ApiError> {
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    {
        let _effect = admission.effect_guard("HTTP outbox connection verification")?;
        connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || Ok(()))?;
    }
    let recovery_marker_pending = {
        let _effect = admission.effect_guard("HTTP outbox recovery priority check")?;
        let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
        connection_act
            .try_act(&runtime.connections, epoch_now_ms, monotonic_now, || {
                Ok(runtime
                    .ephemeral
                    .has_eligible_recovery_marker_bound_if_active(
                        &connection_act.connection_id,
                        &connection_act.effect_fence(),
                    ))
            })?
            .unwrap_or(false)
    };
    let mut projections = if !recovery_marker_pending
        && authority.active_mode() == AuthMode::Sessions
        && connection_act.authorization_invalidation.is_some()
        && runtime
            .read
            .connection_has_auth_scoped_live(&connection_act.connection_id)
    {
        let projection_connection = connection_act.connection_id.clone();
        let rerun_admission = admission.clone();
        let projection_handoff_limit = runtime.projection_handoff_limit();
        with_snapback(&runtime.snapback, move |snapback| {
            snapback.authorization_invalidation_frames_with_handoff_limit(
                &projection_connection,
                &rerun_admission,
                projection_handoff_limit,
            )
        })
        .await?
    } else {
        Vec::new()
    };
    let projection_handoff_bytes = projections.iter().fold(0_usize, |total, projection| {
        total.saturating_add(crate::ephemeral::estimated_durable_handoff_bytes(
            projection,
        ))
    });
    let outbox_handoff_limit =
        crate::ephemeral::MAX_OUTBOX_HANDOFF_BYTES.saturating_sub(projection_handoff_bytes);
    let admitted = {
        let _effect = admission.effect_guard("HTTP outbox drain publication")?;
        let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
        connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || {
            Ok(runtime
                .ephemeral
                .drain_outbox_for_send_bound_if_active_with_handoff_limit(
                    &connection_act.connection_id,
                    &connection_act.effect_fence(),
                    outbox_handoff_limit,
                ))
        })?
    };
    let selected_recovery_marker = admitted
        .as_ref()
        .is_some_and(|batch| batch.len() == 1 && batch[0].is_recovery_marker());
    if selected_recovery_marker || admitted.is_none() {
        // Queue recovery controls are emitted alone and before every direct
        // projection. An extinct activity record likewise emits only its
        // typed resnapshot boundary. Authorization obligations are
        // level-triggered and regenerate on the next eligible poll.
        projections.clear();
    }
    let mut publication_authority = Vec::new();
    let mut outbox_leases = Vec::new();
    let mut drained = match admitted {
        Some(admitted) => admitted
            .into_iter()
            .map(|admitted| {
                let (envelope, permit, lease) = admitted.into_leased_parts();
                publication_authority.extend(permit);
                outbox_leases.push(lease);
                envelope
            })
            .collect::<Vec<_>>(),
        None => vec![RealtimeEnvelope::Durable(
            crate::ephemeral::DurableMessage::new(
                serde_json::to_vec(&LiveEnvelope::ResyncRequired {
                    reason: "unknown_or_reaped".to_owned(),
                    subscription_id: None,
                    scope: None,
                    epoch: None,
                    clear_retained: true,
                })
                .unwrap_or_default(),
            ),
        )],
    };
    for projection in projections {
        let envelope = RealtimeEnvelope::Durable(projection);
        let permit = runtime
            .ephemeral
            .begin_final_send(&envelope)
            .map_err(|error| {
                ApiError::from(SnapbackError::new(diagnostic_from_ephemeral(error)))
            })?;
        publication_authority.extend(permit);
        drained.push(envelope);
    }
    let mut response = Json(drained).into_response();
    retain_realtime_handoff_in(
        &mut response,
        publication_authority,
        outbox_leases,
        Some(RetainedConnectionHandoff {
            connections: runtime.connections.clone(),
            ephemeral: runtime.ephemeral.clone(),
            connection_act,
            auth_provider: runtime.auth_provider.clone(),
        }),
    );
    Ok(response)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
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

// HTTP ephemeral operations keep the legacy dev wire shape while allowing
// the session-mode transport to omit client-asserted identity. These private
// wire structs retain serde's duplicate-field checking; conversion installs
// only the authority prepared by the shared invocation gate.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WirePublishRequest {
    collection: String,
    scope: Scope,
    connection_id: String,
    session_id: Option<String>,
    user_id: Option<String>,
    custom_key: Option<String>,
    value: Vec<u8>,
    ttl_ms: Option<u64>,
    auth: Option<AuthContext>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WireDeleteRequest {
    collection: String,
    scope: Scope,
    connection_id: String,
    session_id: Option<String>,
    user_id: Option<String>,
    custom_key: Option<String>,
    auth: Option<AuthContext>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WireSubscribeRequest {
    collection: String,
    scope: Scope,
    connection_id: String,
    auth: Option<AuthContext>,
}

fn resolved_wire_ephemeral_auth(
    supplied: Option<AuthContext>,
    policy_mode: PolicyAuthMode,
    authority: &ResolvedAppAuthority,
) -> Result<AuthContext, ApiError> {
    match policy_mode {
        PolicyAuthMode::Dev => supplied.ok_or_else(|| {
            ApiError::request_json_invalid("missing field `auth` in the dev ephemeral DTO")
        }),
        PolicyAuthMode::Sessions => {
            if supplied.is_some() {
                return Err(body_auth_unsupported("auth"));
            }
            Ok(ephemeral_auth_from_authority(authority))
        }
    }
}

impl WirePublishRequest {
    fn resolve(
        self,
        policy_mode: PolicyAuthMode,
        authority: &ResolvedAppAuthority,
    ) -> Result<PublishRequest, ApiError> {
        let auth = resolved_wire_ephemeral_auth(self.auth, policy_mode, authority)?;
        let (session_id, user_id, custom_key) = match policy_mode {
            PolicyAuthMode::Dev => (self.session_id, self.user_id, self.custom_key),
            PolicyAuthMode::Sessions => (
                auth.session_id.clone(),
                auth.user_id.clone(),
                // The shared gate rejects every planted custom-key authority
                // carrier before this conversion.
                None,
            ),
        };
        Ok(PublishRequest {
            collection: self.collection,
            scope: self.scope,
            connection_id: self.connection_id,
            session_id,
            user_id,
            custom_key,
            value: self.value,
            ttl_ms: self.ttl_ms,
            auth,
        })
    }
}

impl WireDeleteRequest {
    fn resolve(
        self,
        policy_mode: PolicyAuthMode,
        authority: &ResolvedAppAuthority,
    ) -> Result<DeleteRequest, ApiError> {
        let auth = resolved_wire_ephemeral_auth(self.auth, policy_mode, authority)?;
        let (session_id, user_id, custom_key) = match policy_mode {
            PolicyAuthMode::Dev => (self.session_id, self.user_id, self.custom_key),
            PolicyAuthMode::Sessions => (auth.session_id.clone(), auth.user_id.clone(), None),
        };
        Ok(DeleteRequest {
            collection: self.collection,
            scope: self.scope,
            connection_id: self.connection_id,
            session_id,
            user_id,
            custom_key,
            auth,
        })
    }
}

impl WireSubscribeRequest {
    fn resolve(
        self,
        policy_mode: PolicyAuthMode,
        authority: &ResolvedAppAuthority,
    ) -> Result<SubscribeRequest, ApiError> {
        Ok(SubscribeRequest {
            collection: self.collection,
            scope: self.scope,
            connection_id: self.connection_id,
            auth: resolved_wire_ephemeral_auth(self.auth, policy_mode, authority)?,
        })
    }
}

fn parse_ephemeral_json<T: serde::de::DeserializeOwned>(
    headers: &HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<T, ApiError> {
    let body = body.map_err(|error| ApiError::request_json_invalid(error.to_string()))?;
    if body.is_empty() {
        return Err(ApiError::request_json_invalid("request body must not be empty"));
    }
    let is_json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
    if !is_json {
        return Err(ApiError::request_json_invalid(
            "request body requires Content-Type: application/json",
        ));
    }
    // Deserialize the original bytes so duplicate fields remain observable.
    serde_json::from_slice(&body)
        .map_err(|error| ApiError::request_json_invalid(error.to_string()))
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
    State(runtime): State<AppState>,
    headers: HeaderMap,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(connection_act): Extension<PreparedConnectionAct>,
    Extension(admission): Extension<AdmissionLease>,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let policy_mode = runtime.active_policy_auth_mode();
    let mut request = match policy_mode {
        PolicyAuthMode::Sessions => {
            parse_ephemeral_json::<SessionPublishRequest>(&headers, body)?
                .resolve(authority.resolved())
        }
        PolicyAuthMode::Dev => parse_ephemeral_json::<WirePublishRequest>(&headers, body)?
            .resolve(policy_mode, authority.resolved())?,
    };
    let room_authority = if policy_mode == PolicyAuthMode::Sessions {
        let authorized = authorize_bound_ephemeral_room(
            &runtime,
            &request.collection,
            &request.scope,
            request.auth.clone(),
            connection_act.authorization_invalidation.is_some(),
        )
        .await?;
        request.auth = authorized.auth;
        authorized.permit
    } else {
        None
    };
    let _effect = admission.effect_guard("ephemeral publish")?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    let output =
        connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || {
            runtime
                .ephemeral
                .publish_with_room_authority(request, epoch_now_ms, room_authority.as_ref())
                .map_err(ApiError::from_ephemeral)
        })?;
    Ok(retain_room_authority(
        Json(output).into_response(),
        room_authority,
    ))
}

async fn subscribe_ephemeral(
    State(runtime): State<AppState>,
    headers: HeaderMap,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(connection_act): Extension<PreparedConnectionAct>,
    Extension(admission): Extension<AdmissionLease>,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let policy_mode = runtime.active_policy_auth_mode();
    let mut request = match policy_mode {
        PolicyAuthMode::Sessions => {
            parse_ephemeral_json::<SessionSubscribeRequest>(&headers, body)?
                .resolve(authority.resolved())
        }
        PolicyAuthMode::Dev => parse_ephemeral_json::<WireSubscribeRequest>(&headers, body)?
            .resolve(policy_mode, authority.resolved())?,
    };
    let room_authority = if policy_mode == PolicyAuthMode::Sessions {
        let authorized = authorize_bound_ephemeral_room(
            &runtime,
            &request.collection,
            &request.scope,
            request.auth.clone(),
            connection_act.authorization_invalidation.is_some(),
        )
        .await?;
        request.auth = authorized.auth;
        authorized.permit
    } else {
        None
    };
    let _effect = admission.effect_guard("ephemeral subscribe")?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    let output =
        connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || {
            runtime
                .ephemeral
                .subscribe_with_room_authority_and_effect_fence(
                    request,
                    epoch_now_ms,
                    room_authority.as_ref(),
                    connection_act.effect_fence(),
                )
                .map_err(ApiError::from_ephemeral)
        })?;
    Ok(retain_room_authority(
        Json(output).into_response(),
        room_authority,
    ))
}

async fn delete_ephemeral(
    State(runtime): State<AppState>,
    headers: HeaderMap,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(connection_act): Extension<PreparedConnectionAct>,
    Extension(admission): Extension<AdmissionLease>,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let policy_mode = runtime.active_policy_auth_mode();
    let mut request = match policy_mode {
        PolicyAuthMode::Sessions => parse_ephemeral_json::<SessionDeleteRequest>(&headers, body)?
            .resolve(authority.resolved()),
        PolicyAuthMode::Dev => parse_ephemeral_json::<WireDeleteRequest>(&headers, body)?
            .resolve(policy_mode, authority.resolved())?,
    };
    let room_authority = if policy_mode == PolicyAuthMode::Sessions {
        let authorized = authorize_bound_ephemeral_room(
            &runtime,
            &request.collection,
            &request.scope,
            request.auth.clone(),
            connection_act.authorization_invalidation.is_some(),
        )
        .await?;
        request.auth = authorized.auth;
        authorized.permit
    } else {
        None
    };
    let _effect = admission.effect_guard("ephemeral delete")?;
    let (epoch_now_ms, monotonic_now) = auth_runtime_now(&runtime);
    let output =
        connection_act.try_act(&runtime.connections, epoch_now_ms, monotonic_now, || {
            runtime
                .ephemeral
                .delete_with_room_authority(request, epoch_now_ms, room_authority.as_ref())
                .map_err(ApiError::from_ephemeral)
        })?;
    Ok(retain_room_authority(
        Json(output).into_response(),
        room_authority,
    ))
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
pub struct ApiError(
    SnapbackError,
    Option<Receipt>,
    Option<u64>,
    Option<FunctionAttribution>,
);

impl ApiError {
    fn from_ephemeral(error: crate::ephemeral::EphemeralError) -> Self {
        Self(
            SnapbackError::new(diagnostic_from_ephemeral(error)),
            None,
            None,
            None,
        )
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
            None,
            None,
        )
    }

    /// Attach a receipt to an error response (a REJECTED mutation still
    /// produces its receipt — LLP 0034 §3.2, ENG-22478).
    fn with_receipt(error: SnapbackError, receipt: Receipt) -> Self {
        Self(error, Some(receipt), None, None)
    }

    fn with_attribution(mut self, attribution: Option<FunctionAttribution>) -> Self {
        self.3 = attribution;
        self
    }

    fn auth_throttled(retry_after_seconds: u64) -> Self {
        Self(
            SnapbackError::error(
                "SNAPBACK_AUTH_THROTTLED",
                "auth",
                "authentication request rate limit exceeded",
            ),
            None,
            Some(retry_after_seconds.max(1)),
            None,
        )
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
        Self(value, None, None, None)
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
        // @ref LLP 0055#principal-kinds — an operation naming a principal that is
        //   not a known agent.
        | "SNAPBACK_AUTH_AGENT_UNKNOWN"
        | "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND" => StatusCode::NOT_FOUND,
        "SNAPBACK_MUTATION_CONFLICT"
        | "SNAPBACK_ACTION_GENERATION_CONFLICT"
        | "SNAPBACK_CONFIG_VERIFY_STALE"
        | "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
        | "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED"
        | "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
        | "SNAPBACK_AUTH_TABLE_COLLISION"
        | "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION"
        | "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE"
        | "SNAPBACK_AUTH_INVALIDATION_PENDING"
        | "SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE"
        | "SNAPBACK_AUTH_RESNAPSHOT_REQUIRED"
        | "SNAPBACK_AUTH_GRANT_PENDING"
        | "SNAPBACK_AUTH_GRANT_SCOPE_STALE"
        | "SNAPBACK_AUTH_RETRY_NOT_EXHAUSTED"
        | "SNAPBACK_AUTH_RETRY_NOT_PENDING"
        | "SNAPBACK_AUTHORIZED_LEASE_BOUNDARY_MISMATCH"
        | "SNAPBACK_AUTHORIZED_LEASE_EXPIRED"
        | "SNAPBACK_AUTHORIZED_LEASE_REQUEST_REUSED"
        | "SNAPBACK_AUTHORIZED_LEASE_STALE"
        | "SNAPBACK_AUTH_MODE_DOWNGRADE"
        // @ref LLP 0056#declaring-a-membership-table — a duplicate write against
        //   the generated unique index is a conflict, not a bad request.
        | "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION"
        // @ref LLP 0055#principal-kinds — deactivation is refused when it would
        //   leave a protected LLP 0056 resource with no eligible holder; the
        //   operation conflicts with the last-eligible-holder invariant.
        | "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND"
        | "SNAPBACK_AUTH_AGENT_CREDENTIAL_EXISTS"
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   the M2 write invariants conflict with durable state: removing/demoting
        //   the final eligible holder, deleting a resource whose roster remains,
        //   and creating a protected resource without seating its bootstrap holder.
        | "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_DELETE_BLOCKED"
        | "SNAPBACK_MEMBERSHIP_BOOTSTRAP_REQUIRED"
        | "SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED"
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
        | "SNAPBACK_AUTHORIZED_LEASE_AUTHORITY_INVALID"
        | "SNAPBACK_AUTH_IMPERSONATION_REQUIRED"
        | "SNAPBACK_AUTH_PERMISSION_DENIED"
        | "SNAPBACK_AUTH_GRANT_SCOPE_DENIED"
        // @ref LLP 0055#ending-authority-revocation-expiry-deactivation — a permanently deactivated agent is
        //   refused fail-closed at every authority-creating/exercising path.
        | "SNAPBACK_AUTH_AGENT_DEACTIVATED"
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   the M2 writer-class seam and transition matrix are authorization
        //   refusals: raw/HostPlan membership writes, a write matching no declared
        //   transition, a userless authority, a field outside the matched
        //   transition, seating a corpse, and the system-only sweep.
        | "SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED"
        | "SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        | "SNAPBACK_MEMBERSHIP_NO_EFFECTIVE_PRINCIPAL"
        | "SNAPBACK_MEMBERSHIP_INELIGIBLE_HOLDER"
        | "SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED"
        | "SNAPBACK_MEMBERSHIP_SWEEP_AUTHORITY"
        | "SNAPBACK_PROFILE_FORBIDS" => StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_TOKEN_REQUIRED"
        | "SNAPBACK_ADMIN_SECRET_READ_REQUIRED"
        | "SNAPBACK_CONNECTION_TOKEN_REQUIRED"
        | "SNAPBACK_CONNECTION_AUTHORITY_MISMATCH"
        | "SNAPBACK_AUTH_REQUIRED"
        | "SNAPBACK_AUTH_SESSION_EXPIRED"
        | "SNAPBACK_AUTH_STREAM_RESET"
        | "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED"
        // @ref LLP 0055#credentials-and-tokens — a credential of one class
        //   presented on another class's surface is a typed mismatch, never an
        //   anonymous fall-through.
        | "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
        | "SNAPBACK_AUTH_CODE_INVALID"
        | "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID"
        | "SNAPBACK_AUTH_GRANT_INVALID"
        | "SNAPBACK_AUTH_STEP_UP_REQUIRED"
        | "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID" => StatusCode::UNAUTHORIZED,
        "SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED"
        | "SNAPBACK_ADMIN_SECRET_READ_BUDGET_EXHAUSTED"
        | "SNAPBACK_ADMIN_SECRET_READ_LEASE_CAPACITY_EXCEEDED"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_CAPACITY_EXCEEDED"
        | "SNAPBACK_AUTH_THROTTLED"
        | "SNAPBACK_AUTH_AGENT_CREDENTIAL_ROTATION_THROTTLED"
        | "SNAPBACK_AUTH_GRANT_CAP"
        | "SNAPBACK_AUTH_PAIRING_CODE_CAP"
        | "SNAPBACK_AUTH_PAIRING_REQUEST_CAP"
        | "SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY"
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
        // @ref LLP 0058#admitted-body-ingestion — the admitted ingest deadline
        // is a client fault: the request body never finished arriving.
        "SNAPBACK_REQUEST_BODY_TIMEOUT" => StatusCode::REQUEST_TIMEOUT,
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
        | "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE"
        | "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
        | "SNAPBACK_AUTH_MODE_STATE_CORRUPT"
        | "SNAPBACK_AUTH_MODE_PENDING"
        | "SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED"
        | "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH"
        | "SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED"
        | "SNAPBACK_AUTH_CLOCK_ROLLBACK"
        | "SNAPBACK_AUTHORIZED_LEASE_KEY_UNAVAILABLE"
        | "SNAPBACK_AUTHORIZED_LEASE_STATE_CORRUPT"
        | "SNAPBACK_AUTHORIZED_LEASE_UNAVAILABLE"
        | "SNAPBACK_AUTH_INVALIDATION_CAUSE_EXHAUSTED"
        | "SNAPBACK_AUTH_INVALIDATION_CONNECTION_GENERATION_EXHAUSTED"
        | "SNAPBACK_AUTH_INVALIDATION_ISSUER_EXHAUSTED"
        | "SNAPBACK_AUTH_INVALIDATION_ISSUER_UNAVAILABLE"
        | "SNAPBACK_AUTH_INVALIDATION_REVISION_EXHAUSTED"
        | "SNAPBACK_AUTH_INVALIDATION_SCOPE_SEQUENCE_EXHAUSTED"
        | "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        | "SNAPBACK_AUTH_PROJECTION_CORRUPT"
        | "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        | "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        | "SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE"
        | "SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN"
        | "SNAPBACK_AUTH_GRANT_STATE_CORRUPT"
        | "SNAPBACK_AUTH_SCOPE_BASIS_CORRUPT"
        | "SNAPBACK_EPHEMERAL_AUTHORITY_PENDING"
        | "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED"
        | "SNAPBACK_AUTH_REVOCATION_UNCERTAIN"
        | "SNAPBACK_AUTH_RETRY_EXHAUSTED"
        | "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT"
        | "SNAPBACK_ADMIN_SECRET_READ_GENERATION_EXHAUSTED"
        | "SNAPBACK_APP_GENERATION_EXHAUSTED"
        | "SNAPBACK_AUTHORIZATION_EPOCH_EXHAUSTED"
        | "SNAPBACK_AUTHORIZATION_VERSION_CORRUPT"
        | "SNAPBACK_V8_RUNNER_HOST_UNSUPPORTED" => StatusCode::SERVICE_UNAVAILABLE,
        // Exhaustive allow-list of request, declaration, authorization, and
        // application-handler diagnostics. Adding a new code does not add it
        // here automatically: the default below remains a truthful 500 until
        // its producer deliberately chooses a client class.
        "SNAPBACK_ARG_MISSING"
        | "SNAPBACK_ACTION_MUTATION_REFERENCE_INVALID"
        | "SNAPBACK_AUTHORITY_INDEPENDENT_INVALID"
        | "SNAPBACK_AUTHORIZED_LEASE_CONFIG_INVALID"
        | "SNAPBACK_AUTHORIZED_LEASE_INVALID"
        | "SNAPBACK_AUTHORIZED_LEASE_QUERY_NOT_RETAINABLE"
        | "SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED"
        | "SNAPBACK_CLIENT_MUTATION_ACK_LIMIT_EXCEEDED"
        | "SNAPBACK_CLIENT_MUTATION_ACK_OVERLAP"
        | "SNAPBACK_CLIENT_MUTATION_PURGE_SELECTOR_INVALID"
        | "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED"
        | "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY"
        | "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED"
        | "SNAPBACK_AUTH_INVALIDATION_ACK_BEFORE_COMMIT"
        | "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED"
        | "SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED"
        | "SNAPBACK_AUTH_REQUEST_INVALID"
        | "SNAPBACK_AUTH_GRANT_EXPIRY_INVALID"
        | "SNAPBACK_AUTH_GRANT_SCOPE_INVALID"
        | "SNAPBACK_AUTH_RESCUE_INVALID"
        | "SNAPBACK_AUTH_RESCUE_MANAGED_STATE_UNSUPPORTED"
        | "SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED"
        | "SNAPBACK_AUTH_STALE_RESULT"
        | "SNAPBACK_AUTH_UNDECLARABLE_RETENTION"
        | "SNAPBACK_AUTH_USER_MISSING"
        | "SNAPBACK_AUTH_SCOPED_TOKEN_TTL_INVALID"
        | "SNAPBACK_CAPABILITY_UNSUPPORTED"
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
        // @ref LLP 0056#declaring-a-membership-table — every membership
        //   declaration-shape and activation refusal is a client fault (a bad
        //   schema or nonconforming data), never a server error.
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_DANGLING_RESOURCE"
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_DUPLICATE"
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_NULL_AXIS"
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_UNKNOWN_ROLE"
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE"
        | "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE"
        | "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE_TABLE"
        | "SNAPBACK_MEMBERSHIP_AXIS_COLLISION"
        | "SNAPBACK_MEMBERSHIP_AXIS_FIELD_UNKNOWN"
        | "SNAPBACK_MEMBERSHIP_OPERATION_INVALID"
        | "SNAPBACK_MEMBERSHIP_BOOTSTRAP_ROLE_UNKNOWN"
        | "SNAPBACK_MEMBERSHIP_CONFUSABLE_ROLES"
        | "SNAPBACK_MEMBERSHIP_DUPLICATE_ROLE"
        | "SNAPBACK_MEMBERSHIP_EMPTY_ROLE_LIST"
        | "SNAPBACK_MEMBERSHIP_EMPTY_VOCABULARY"
        | "SNAPBACK_MEMBERSHIP_EXPIRY_EFFECT_UNSUPPORTED"
        | "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_AXIS"
        | "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_UNKNOWN"
        | "SNAPBACK_MEMBERSHIP_ID_COLLISION"
        | "SNAPBACK_MEMBERSHIP_ID_INVALID"
        | "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_AMBIGUOUS"
        | "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_INVALID"
        | "SNAPBACK_MEMBERSHIP_INCIDENTAL_FLOOR"
        | "SNAPBACK_MEMBERSHIP_INCIDENTAL_UNKNOWN"
        | "SNAPBACK_MEMBERSHIP_INDEX_NAME_COLLISION"
        | "SNAPBACK_MEMBERSHIP_LAST_HOLDER_APP_SCOPE"
        | "SNAPBACK_MEMBERSHIP_LAST_HOLDER_BOOTSTRAP_MISMATCH"
        | "SNAPBACK_MEMBERSHIP_LAST_HOLDER_ROLE_UNKNOWN"
        | "SNAPBACK_MEMBERSHIP_OPTIONAL_KEY_AXIS"
        | "SNAPBACK_MEMBERSHIP_PERMISSION_BACKING_CONFLICT"
        | "SNAPBACK_MEMBERSHIP_PRINCIPAL_TYPE"
        | "SNAPBACK_MEMBERSHIP_PROVENANCE_FIELD_RESERVED"
        | "SNAPBACK_MEMBERSHIP_RESERVED_ROLE"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_AXIS_REQUIRED"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_REF_INVALID"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_TYPE"
        | "SNAPBACK_MEMBERSHIP_ROLE_CONTROL_CHARACTER"
        | "SNAPBACK_MEMBERSHIP_ROLE_EMPTY"
        | "SNAPBACK_MEMBERSHIP_ROLE_PENDING_OVERLAP"
        | "SNAPBACK_MEMBERSHIP_ROLE_RESERVED_SEPARATOR"
        | "SNAPBACK_MEMBERSHIP_ROLE_TYPE"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_AXIS_FIELD"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_SELF_ON_OTHER"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_CALLER"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_FIELD"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_ROLE"
        | "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION"
        | "SNAPBACK_MEMBERSHIP_UNKNOWN_ROLE"
        | "SNAPBACK_PERMISSIONS_UNAVAILABLE_IN_ACTION"
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   the M2 write-path malformed/structural refusals: a null axis, a
        //   missing resource/target/expiry, an immutable-axis patch, and the
        //   bootstrap/teardown shape mismatches. (The privileged-writer guard
        //   is an internal misuse surfaced as a bad request.)
        | "SNAPBACK_MEMBERSHIP_NULL_AXIS"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING"
        | "SNAPBACK_MEMBERSHIP_TARGET_MISSING"
        | "SNAPBACK_MEMBERSHIP_PATCH_AXIS"
        | "SNAPBACK_MEMBERSHIP_NOT_DECLARED"
        | "SNAPBACK_MEMBERSHIP_NO_BOOTSTRAP_ROLE"
        | "SNAPBACK_MEMBERSHIP_BOOTSTRAP_RESOURCE_MISMATCH"
        | "SNAPBACK_MEMBERSHIP_BOOTSTRAP_APP_SCOPE"
        | "SNAPBACK_MEMBERSHIP_TEARDOWN_RESOURCE_MISSING"
        | "SNAPBACK_MEMBERSHIP_NO_EXPIRY"
        | "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_MATRIX"
        | "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_REQUIRED"
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
        | "SNAPBACK_SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING"
        | "SNAPBACK_SCHEMA_PERMISSION_FIELD_DUPLICATE"
        | "SNAPBACK_SCHEMA_PERMISSION_FIELD_UNKNOWN"
        | "SNAPBACK_SCHEMA_PARSE_FAILED"
        | "SNAPBACK_SCHEMA_SYSTEM_FIELD"
        | "SNAPBACK_STALE_FUNCTION_ARTIFACT_KIND"
        | "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION"
        | "SNAPBACK_STALE_SCHEMA_ARTIFACT_KIND"
        | "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION"
        | "SNAPBACK_SYSTEM_FIELD_WRITE"
        | "SNAPBACK_TIMESTAMP_OUT_OF_RANGE"
        | "SNAPBACK_UNSUPPORTED_BLOB"
        | "SNAPBACK_VALUE_EXPR_AUTHORITATIVE_ONLY"
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
        let mut response = (
            status,
            Json(ErrorResponse {
                diagnostic: self.0.diagnostic,
                receipt: self.1,
                attribution: self.3,
            }),
        )
            .into_response();
        if let Some(seconds) = self.2
            && let Ok(value) = HeaderValue::from_str(&seconds.to_string())
        {
            response.headers_mut().insert(header::RETRY_AFTER, value);
        }
        response
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
        ACTION_WORKER_LIMIT_MAX, ADMITTED_BODY_INGEST_DEADLINE_MS, AdmissionLease,
        CRON_DISPATCH_CONCURRENCY_DEFAULT,
        CRON_DISPATCH_CONCURRENCY_MAX, ConnectionGrant, ConnectionOpenAttempt, DetachedActionHost,
        DetachedActionWorkerCounters, OpenConnectionRequest, PolicyAuthMode, PreparedAuthority,
        RealtimeEnvelope, SharedSnapback, SnapbackApp, app, configured_action_worker_limit,
        configured_cron_dispatch_concurrency, coordinated_app_reset, dispatch_cron_tick_background,
        finish_registered_response, parse_action_watchdog_timeout, parse_optional_json,
        reserve_detached_action_worker, reserve_detached_action_worker_with_counters,
        retain_realtime_authority_in, run_detached_ibex_action_with_admission_and_counters,
        spawn_detached_action_worker, status_for_diagnostic_code, with_snapback,
    };
    use crate::admin::{AppState, ServerContext, ServerProfile};
    use crate::admin_impersonation::{
        IMPERSONATION_CAPABILITY_HEADER, ImpersonationCapabilityRegistry,
    };
    use crate::auth::crypto::{OsRandom, SessionBearer};
    use crate::auth::invalidation::{
        AuthorizationInvalidationConnection, IssuerId, LiveInvalidationIssuer, QueryNamespace,
    };
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
    use crate::auth::provider::{
        AUTH_SESSION_SLIDING_WINDOW_MS, AUTH_SESSION_SUPERSESSION_GRACE_MS,
        AUTH_SESSION_USE_COALESCE_MS, AuthClock, AuthProvider, AuthProviderProfile,
    };
    use crate::cron::CronRunOutcome;
    use crate::diagnostic::SnapbackError;
    use crate::local::{
        EnsureAppMode, LiveInvalidationAdmission, LiveSubscribeInput, LocalSnapback, StagedAction,
    };
    use crate::manifest::{
        AuthInput, AuthManifest, AuthMode, AuthRequirement, CronActivationPolicy, CronJitterPolicy,
        CronJobDefinition, CronOverlapPolicy, CronRetryMode, CronRetryPolicy, CronSchedule,
        FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
        FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule,
        MutationAcknowledgementRequest, MutationPlan, MutationStep, QueryPlan, ReturnValue,
        SNAPBACK_SESSIONS_SCHEMA_VERSION, SchemaManifest, SeedData, TableManifest,
        TargetCapabilityId, ValueExpr,
    };
    use crate::runtime::IbexActionHost;
    use crate::storage::ClientMutationIdentity;
    use crate::storage::auth::AuthTransactionAttempt;
    use axum::Json;
    use axum::body::{Body, Bytes, to_bytes};
    use axum::extract::{Extension, Path as AxumPath, State};
    use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode, header};
    use axum::response::IntoResponse as _;
    use futures_util::{SinkExt as _, StreamExt as _};
    use serde_json::{Map, Value, json};
    use std::collections::{BTreeMap, BTreeSet};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::{Arc, Condvar, Mutex as StdMutex};
    use std::time::{Duration, Instant};
    use syn::visit::Visit;
    use tokio::net::TcpListener;
    use tokio::sync::{Mutex, Semaphore};
    use tower::ServiceExt as _;
    use uuid::Uuid;

    struct ManualServerAuthClock {
        base_epoch_ms: u64,
        epoch_ms: AtomicU64,
        monotonic_origin: Instant,
    }

    impl ManualServerAuthClock {
        fn new(epoch_ms: u64) -> Self {
            Self {
                base_epoch_ms: epoch_ms,
                epoch_ms: AtomicU64::new(epoch_ms),
                monotonic_origin: Instant::now(),
            }
        }

        fn set(&self, epoch_ms: u64) {
            self.epoch_ms.store(epoch_ms, Ordering::SeqCst);
        }

        fn monotonic_at(&self, epoch_ms: u64) -> Instant {
            self.monotonic_origin
                + Duration::from_millis(epoch_ms.saturating_sub(self.base_epoch_ms))
        }
    }

    impl AuthClock for ManualServerAuthClock {
        fn epoch_ms(&self) -> u64 {
            self.epoch_ms.load(Ordering::SeqCst)
        }

        fn monotonic_now(&self) -> Instant {
            self.monotonic_at(self.epoch_ms())
        }
    }

    fn bound_loopback_context() -> ServerContext {
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback context fixture");
        ServerContext::from_bound_listener(&listener).expect("read loopback fixture address")
    }

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
        let mut context = bound_loopback_context();
        context.profile = ServerProfile::Test;
        context.admin_token = Some("auth-http-admin".to_owned());
        let state = AppState::from_snapback(snapback, context)
            .with_policy_auth_mode(mode)
            .with_impersonation_capabilities(registry)
            .with_auth_provider(provider);
        (state, capability.expect("captured capability"))
    }

    fn manual_clock_sessions_fixture(start_ms: u64) -> (AppState, Arc<ManualServerAuthClock>) {
        let clock = Arc::new(ManualServerAuthClock::new(start_ms));
        let mut snapback = LocalSnapback::memory().expect("manual-clock HTTP fixture");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            start_ms,
            &OsRandom,
        )
        .expect("activate manual-clock auth catalog");
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                keyring,
                Arc::new(OsRandom),
                clock.clone(),
            )
            .expect("construct manual-clock auth provider"),
        );
        let mut context = bound_loopback_context();
        context.profile = ServerProfile::Test;
        let state = activate_test_sessions(
            AppState::from_snapback(snapback, context)
                .with_policy_auth_mode(PolicyAuthMode::Sessions)
                .with_auth_provider(provider),
        );
        (state, clock)
    }

    fn auth_invalidation_reset_fixture() -> AppState {
        let mut snapback = LocalSnapback::memory().expect("memory reset fixture");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            super::now_millis(),
            &OsRandom,
        )
        .expect("activate reset auth catalog");
        let provider = Arc::new(
            AuthProvider::new(AuthProviderProfile::Test, keyring)
                .expect("construct reset auth provider"),
        );
        let (app_id, target_profile_id) = {
            let schema = snapback.auth_database_mut().schema();
            (
                schema.app_id.clone(),
                schema.target_profile.clone().unwrap_or_else(|| {
                    crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned()
                }),
            )
        };
        let (authorization, version_stream, boot_sequence) = snapback
            .auth_database_mut()
            .reserve_invalidation_boot_issuer()
            .expect("reserve predecessor issuer");
        let issuer_id = crate::auth::invalidation::IssuerId::fresh(
            authorization.incarnation.clone(),
            boot_sequence,
        )
        .expect("construct predecessor issuer id");
        let issuer = provider
            .authenticate_invalidation_boot_issuer(issuer_id, &target_profile_id, &app_id)
            .expect("authenticate predecessor issuer");
        snapback
            .install_auth_invalidation(issuer.clone(), authorization, version_stream)
            .expect("install predecessor invalidation projections");

        AppState::from_snapback(snapback, bound_loopback_context())
            .with_auth_provider(provider)
            .with_auth_invalidation(issuer)
            .with_auth_runtime_facts(
                settled_sessions_state(),
                AuthProgramReadiness::new(true, true, true, true, true, true, true),
            )
            .expect("install reset sessions posture")
    }

    fn dormant_dev_reset_fixture() -> AppState {
        let mut snapback = LocalSnapback::memory().expect("memory dormant reset fixture");
        let runtime = crate::auth::runtime::AuthRuntime::inspect(
            &mut snapback,
            None,
            AuthProviderProfile::Dev,
        )
        .expect("inspect dormant auth runtime");
        assert!(!runtime.catalog_ready(), "fixture must remain dormant");
        let coordinator = runtime
            .build_coordinator(&mut snapback)
            .expect("build dormant stream coordinator");
        let mut context = bound_loopback_context();
        context.profile = ServerProfile::Dev;
        AppState::from_snapback(snapback, context).with_auth_runtime(&runtime, coordinator)
    }

    fn auth_projection_http_fixture(
        connection_id: &str,
        subscription_count: u64,
        retained_row_bytes: usize,
    ) -> AppState {
        let mut snapback = LocalSnapback::memory().expect("memory projection HTTP fixture");
        snapback
            .apply_schema(SchemaManifest {
                schema_hash: Some("projection-http-schema".to_owned()),
                tables: vec![crate::manifest::TableManifest {
                    name: "items".to_owned(),
                    fields: vec![FieldManifest {
                        name: "value".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("apply projection HTTP schema");
        let list = FunctionDefinition::new(
            "listItems",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "items".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        );
        let mut insert_values = BTreeMap::new();
        insert_values.insert("value".to_owned(), ValueExpr::Arg("value".to_owned()));
        let insert = FunctionDefinition::new(
            "insertItem",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                steps: vec![MutationStep::Insert {
                    table: "items".to_owned(),
                    values: insert_values,
                    bind_id_as: None,
                }],
                return_value: Some(ReturnValue::ChangedCount),
            })),
        );
        let delete = FunctionDefinition::new(
            "deleteItem",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                steps: vec![MutationStep::Delete {
                    table: "items".to_owned(),
                    id: ValueExpr::Arg("id".to_owned()),
                }],
                return_value: Some(ReturnValue::ChangedCount),
            })),
        );
        snapback.load_functions(FunctionManifest {
            bundle_hash: Some("projection-http-functions".to_owned()),
            functions: vec![list, insert, delete],
            ..FunctionManifest::default()
        });
        if retained_row_bytes > 0 {
            snapback
                .invoke_mutation(
                    "insertItem",
                    HandlerInput {
                        args: json!({ "value": "x".repeat(retained_row_bytes) }),
                        ..HandlerInput::default()
                    },
                )
                .expect("insert retained projection row");
        }
        snapback
            .invoke_mutation(
                "insertItem",
                HandlerInput {
                    args: json!({ "value": "remove-me" }),
                    ..HandlerInput::default()
                },
            )
            .expect("insert removable projection row");
        let removable_id = snapback
            .invoke_query("listItems", HandlerInput::default())
            .expect("query removable projection row")
            .rows
            .into_iter()
            .find(|row| row["value"] == "remove-me")
            .and_then(|row| row["_id"].as_str().map(str::to_owned))
            .expect("removable row id");

        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            super::now_millis(),
            &OsRandom,
        )
        .expect("activate projection HTTP auth catalog");
        let provider = Arc::new(
            AuthProvider::new(AuthProviderProfile::Test, keyring)
                .expect("construct projection HTTP provider"),
        );
        let (app_id, target_profile_id) = {
            let schema = snapback.auth_database_mut().schema();
            (
                schema.app_id.clone(),
                schema.target_profile.clone().unwrap_or_else(|| {
                    crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned()
                }),
            )
        };
        let (authorization, version_stream, boot_sequence) = snapback
            .auth_database_mut()
            .reserve_invalidation_boot_issuer()
            .expect("reserve projection HTTP issuer");
        let issuer_id = IssuerId::fresh(authorization.incarnation.clone(), boot_sequence)
            .expect("construct projection HTTP issuer id");
        let issuer = provider
            .authenticate_invalidation_boot_issuer(issuer_id, &target_profile_id, &app_id)
            .expect("authenticate projection HTTP issuer");
        let projection_connection = AuthorizationInvalidationConnection {
            protocol_version: crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION,
            issuer_id: issuer.authenticated().issuer_id.clone(),
            connection_generation: issuer
                .reserve_connection_generation()
                .expect("projection connection generation"),
            authorization: authorization.clone(),
            version_stream: version_stream.clone(),
            issuer_retirement: None,
        };
        snapback
            .install_auth_invalidation(issuer.clone(), authorization, version_stream)
            .expect("install projection HTTP invalidation");
        for query_instance_id in 0..subscription_count {
            snapback
                .subscribe_live_with_invalidation(
                    "listItems",
                    LiveSubscribeInput {
                        connection_id: connection_id.to_owned(),
                        input: HandlerInput::default(),
                        authorization_namespace: Some(QueryNamespace {
                            client_store_id: "projection_http_store".to_owned(),
                            query_key: "listItems:{}".to_owned(),
                            query_instance_id: 500 + query_instance_id,
                        }),
                        supersedes: None,
                    },
                    LiveInvalidationAdmission {
                        session_mode: true,
                        connection: Some(projection_connection.clone()),
                        effect_fence: None,
                    },
                )
                .expect("install projection HTTP subscription");
        }
        loop {
            let initial = snapback.drain_outbox_for_send(connection_id);
            if initial.is_empty() {
                break;
            }
            for admitted in initial {
                assert!(admitted.commit_handoff());
            }
        }
        snapback
            .invoke_mutation(
                "deleteItem",
                HandlerInput {
                    args: json!({ "id": removable_id }),
                    ..HandlerInput::default()
                },
            )
            .expect("raise projection HTTP obligations");

        AppState::from_snapback(snapback, bound_loopback_context())
            .with_policy_auth_mode(PolicyAuthMode::Sessions)
            .with_auth_provider(provider)
            .with_auth_invalidation(issuer)
            .with_auth_runtime_facts(
                settled_sessions_state(),
                AuthProgramReadiness::new(true, true, true, true, true, true, true),
            )
            .expect("install projection HTTP sessions posture")
    }

    fn protected_room_server_fixture() -> (AppState, tempfile::TempDir) {
        let directory = tempfile::tempdir().expect("protected-room fixture directory");
        let database_path = directory.path().join("protected-room.sqlite3");
        let mut snapback = LocalSnapback::open(&database_path).expect("file-backed snapback");
        let projection = RoomPermissionProjection {
            table: "roomMembers".to_owned(),
            subject_field: "userId".to_owned(),
            scope_fields: BTreeMap::from([("roomId".to_owned(), "roomId".to_owned())]),
        };
        let collection = EphemeralCollection::local_cursor("protectedPresence", "roomId")
            .require_room_permission("room")
            .permission_backed_by(projection);
        let schema = SchemaManifest {
            schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
            app_id: "auth-http-fixture".to_owned(),
            auth: Some(AuthManifest {
                mode: AuthMode::Sessions,
            }),
            required_capabilities: vec![TargetCapabilityId::AuthSessionsV1.to_string()],
            schema_hash: Some(format!("{SCHEMA_V1_PREFIX}{}", "1".repeat(64))),
            inputs_hash: Some(format!("{INPUTS_V1_PREFIX}{}", "3".repeat(64))),
            tables: vec![TableManifest {
                name: "roomMembers".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "roomId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "userId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: true,
                permission_fields: Some(vec!["roomId".to_owned(), "userId".to_owned()]),
                membership: None,
            }],
            ephemeral_collections: vec![collection],
            ..SchemaManifest::default()
        };
        let readiness = AuthProgramReadiness::new(true, true, true, true, true, true, true);
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(super::now_millis(), &OsRandom)
            .expect("provision protected-room keyring before sessions consume");
        let settled = snapback
            .auth_database_mut()
            .stage_auth_mode(sessions_deployment(), schema.clone(), None)
            .expect("stage protected-room sessions schema");
        assert_eq!(settled.mode_state, AuthModeStatus::PendingRestart);
        let settled = snapback
            .auth_database_mut()
            .consume_sessions_auth_mode(&readiness)
            .expect("consume protected-room sessions schema");
        snapback
            .synchronize_auth_mode_admission(&settled)
            .expect("synchronize protected-room admission");
        let mut kick = FunctionDefinition::new(
            "kickRoomMember",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                steps: vec![MutationStep::Delete {
                    table: "roomMembers".to_owned(),
                    id: ValueExpr::Arg("id".to_owned()),
                }],
                return_value: Some(ReturnValue::ChangedCount),
            })),
        );
        kick.auth_requirement = Some(AuthRequirement::Authenticated);
        kick.write_set_summary.primary_table = Some("roomMembers".to_owned());
        kick.write_set_summary.tables = vec!["roomMembers".to_owned()];
        let diagnostics = snapback.publish_preflighted_functions(
            FunctionManifest {
                schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
                app_id: "auth-http-fixture".to_owned(),
                bundle_hash: Some(format!("{FUNCTION_V1_PREFIX}{}", "2".repeat(64))),
                inputs_hash: Some(format!("{INPUTS_V1_PREFIX}{}", "3".repeat(64))),
                functions: vec![kick],
                ..FunctionManifest::default()
            },
            42,
        );
        assert!(
            diagnostics.is_empty(),
            "protected-room function manifest loads: {diagnostics:?}"
        );

        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            super::now_millis(),
            &OsRandom,
        )
        .expect("activate protected-room auth catalog");
        let provider = Arc::new(
            AuthProvider::new(AuthProviderProfile::Test, keyring)
                .expect("construct protected-room auth provider"),
        );
        let (authorization, version_stream, boot_sequence) = snapback
            .auth_database_mut()
            .reserve_invalidation_boot_issuer()
            .expect("reserve protected-room boot issuer");
        let issuer_id = IssuerId::fresh(authorization.incarnation.clone(), boot_sequence)
            .expect("construct protected-room issuer id");
        let issuer: LiveInvalidationIssuer = provider
            .authenticate_invalidation_boot_issuer(
                issuer_id,
                crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
                "auth-http-fixture",
            )
            .expect("authenticate protected-room issuer");
        snapback
            .install_auth_invalidation(issuer.clone(), authorization, version_stream)
            .expect("install protected-room invalidation");

        let mut context = bound_loopback_context();
        context.profile = ServerProfile::Test;
        let state = AppState::from_snapback(snapback, context)
            .with_auth_provider(provider)
            .with_auth_invalidation(issuer)
            .with_auth_runtime_facts(settled, readiness)
            .expect("install protected-room sessions posture");
        assert!(
            state.read.available(),
            "fixture must exercise the WAL reader lane"
        );
        (state, directory)
    }

    /// @ref LLP 0053#ephemeral-room-authority-invalidation — L9 requires an
    /// unrelated protected room to register, publish, and drain over both HTTP
    /// and WebSocket while an affected authorization commit is pending, with
    /// no writer-mutex hop on the room path.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn protected_room_server_fast_paths_progress_during_affected_commit() {
        const AFFECTED_ROOM: &str = "room-affected";
        const UNRELATED_ROOM: &str = "room-unrelated";
        const UNRELATED_WS_ROOM: &str = "room-unrelated-ws";
        const AFFECTED_MEMBER: &str = "member-affected";

        let (state, _directory) = tokio::task::spawn_blocking(|| {
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            protected_room_server_fixture()
        })
        .await
        .expect("construct protected-room fixture off the async workers");
        let credential = mint_test_credential(&state, "room-l9@example.com").await;
        let bearer = credential["token"]
            .as_str()
            .expect("fixture session bearer")
            .to_owned();
        let user_id = credential["session"]["userId"]
            .as_str()
            .expect("fixture user id")
            .to_owned();
        let seed = SeedData {
            tables: BTreeMap::from([(
                "roomMembers".to_owned(),
                vec![
                    Map::from_iter([
                        ("_id".to_owned(), json!(AFFECTED_MEMBER)),
                        ("roomId".to_owned(), json!(AFFECTED_ROOM)),
                        ("userId".to_owned(), json!(user_id)),
                    ]),
                    Map::from_iter([
                        ("_id".to_owned(), json!("member-unrelated")),
                        ("roomId".to_owned(), json!(UNRELATED_ROOM)),
                        ("userId".to_owned(), json!(user_id)),
                    ]),
                    Map::from_iter([
                        ("_id".to_owned(), json!("member-unrelated-ws")),
                        ("roomId".to_owned(), json!(UNRELATED_WS_ROOM)),
                        ("userId".to_owned(), json!(user_id)),
                    ]),
                ],
            )]),
        };
        with_snapback(&state.snapback, move |snapback| snapback.seed(seed))
            .await
            .expect("seed both room memberships");

        let router = app(state.clone());
        let opened = router
            .clone()
            .oneshot(connection_open_request(
                Some(&bearer),
                json!({
                    "connectionId": "l9-unrelated-http",
                    "authInvalidationProtocol": 1,
                }),
            ))
            .await
            .expect("open unrelated protected-room connection");
        assert_eq!(opened.status(), StatusCode::OK);
        let opened = response_json(opened).await;
        let connection_id = opened["connectionId"]
            .as_str()
            .expect("connection id")
            .to_owned();
        let connection_token = opened["connectionToken"]
            .as_str()
            .expect("connection token")
            .to_owned();

        let affected_scope = Scope::from_pairs([("roomId", AFFECTED_ROOM)]);
        let affected_permit = state
            .ephemeral
            .begin_server_authorized_room_act("protectedPresence", &affected_scope)
            .expect("admit affected precommit sink")
            .expect("protected room returns a permit");
        let kick_router = router.clone();
        let kick_bearer = bearer.clone();
        let kick = tokio::spawn(async move {
            kick_router
                .oneshot(session_auth_http_request(
                    "/mutation/kickRoomMember",
                    serde_json::to_vec(&json!({ "args": { "id": AFFECTED_MEMBER } }))
                        .expect("serialize kick"),
                    &kick_bearer,
                ))
                .await
                .expect("kick response")
        });

        let pending_deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match state
                .ephemeral
                .begin_server_authorized_room_act("protectedPresence", &affected_scope)
            {
                Err(error) if error.code == EphemeralErrorCode::AuthorityPending => break,
                Ok(permit) => drop(permit),
                Err(error) => panic!("unexpected affected-room admission: {error:?}"),
            }
            assert!(
                Instant::now() < pending_deadline,
                "kick did not install its affected-room dependency ticket"
            );
            tokio::task::yield_now().await;
        }
        assert!(
            state.snapback.try_lock().is_err(),
            "the affected mutation intentionally holds the writer lane while its commit waits"
        );

        let connection_request = |method: &str, uri: String, body: Option<Value>| {
            let mut builder = Request::builder()
                .method(method)
                .uri(uri)
                .header("x-snapback-auth-client-protocol", "1")
                .header("x-snapback-auth-invalidation-protocol", "1")
                .header("x-snapback-connection-token", &connection_token);
            let body = if let Some(body) = body {
                builder = builder.header(header::CONTENT_TYPE, "application/json");
                Body::from(serde_json::to_vec(&body).expect("serialize connection request"))
            } else {
                Body::empty()
            };
            builder.body(body).expect("connection request")
        };
        let unrelated_scope = json!({ "roomId": UNRELATED_ROOM });
        let subscribe = tokio::time::timeout(
            Duration::from_secs(1),
            router.clone().oneshot(connection_request(
                "POST",
                "/ephemeral/subscribe".to_owned(),
                Some(json!({
                    "collection": "protectedPresence",
                    "scope": unrelated_scope,
                    "connection_id": connection_id,
                })),
            )),
        )
        .await
        .expect("unrelated protected subscribe must not queue on the writer")
        .expect("unrelated subscribe response");
        let subscribe_status = subscribe.status();
        let subscribe_body = response_json(subscribe).await;
        assert_eq!(
            subscribe_status,
            StatusCode::OK,
            "unexpected subscribe response: {subscribe_body}"
        );
        assert!(
            subscribe_body.get("Snapshot").is_some(),
            "unrelated registration publishes its initial protected snapshot: {subscribe_body}"
        );
        assert!(state.snapback.try_lock().is_err());

        let publish = tokio::time::timeout(
            Duration::from_secs(1),
            router.clone().oneshot(connection_request(
                "POST",
                "/ephemeral/publish".to_owned(),
                Some(json!({
                    "collection": "protectedPresence",
                    "scope": { "roomId": UNRELATED_ROOM },
                    "connection_id": connection_id,
                    "value": [117, 110, 114, 101, 108, 97, 116, 101, 100],
                    "ttl_ms": 5_000,
                })),
            )),
        )
        .await
        .expect("unrelated protected publish must not queue on the writer")
        .expect("unrelated publish response");
        assert_eq!(publish.status(), StatusCode::OK);
        let _ = response_json(publish).await;
        assert!(state.snapback.try_lock().is_err());

        let drain = tokio::time::timeout(
            Duration::from_secs(1),
            router.clone().oneshot(connection_request(
                "GET",
                format!("/outbox/{connection_id}"),
                None,
            )),
        )
        .await
        .expect("unrelated protected drain must not queue on the writer")
        .expect("unrelated drain response");
        assert_eq!(drain.status(), StatusCode::OK);
        let drained = response_json(drain).await;
        assert!(
            drained.as_array().is_some_and(|frames| !frames.is_empty()),
            "the unrelated publish is destructively drained while the affected commit waits"
        );
        assert!(state.snapback.try_lock().is_err());

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind protected-room WebSocket server");
        let address = listener.local_addr().expect("WebSocket server address");
        let ws_server_state = state.clone();
        let server = tokio::spawn(async move {
            app(ws_server_state)
                .bind(listener)
                .expect("bind protected-room WebSocket app")
                .serve()
                .await
                .expect("serve protected-room WebSocket test");
        });
        use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
        let mut ws_request = format!("ws://{address}/live/{connection_id}/stream")
            .into_client_request()
            .expect("protected-room WebSocket request");
        ws_request.headers_mut().insert(
            "x-snapback-connection-token",
            connection_token.parse().expect("connection token header"),
        );
        ws_request.headers_mut().insert(
            "x-snapback-auth-client-protocol",
            "1".parse().expect("client protocol header"),
        );
        ws_request.headers_mut().insert(
            "x-snapback-auth-invalidation-protocol",
            "1".parse().expect("invalidation protocol header"),
        );
        let (mut socket, _) = tokio::time::timeout(
            Duration::from_secs(1),
            tokio_tungstenite::connect_async(ws_request),
        )
        .await
        .expect("unrelated protected WebSocket upgrade must not queue on the writer")
        .expect("connect protected-room WebSocket");

        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({
                    "type": "ephemeral_subscribe",
                    "requestId": "l9-ws-subscribe",
                    "request": {
                        "collection": "protectedPresence",
                        "scope": { "roomId": UNRELATED_WS_ROOM },
                        "connection_id": connection_id,
                    },
                })
                .to_string()
                .into(),
            ))
            .await
            .expect("send unrelated protected WebSocket subscribe");
        let subscribe_ack = tokio::time::timeout(Duration::from_secs(1), socket.next())
            .await
            .expect("unrelated protected WebSocket subscribe must make progress")
            .expect("subscribe acknowledgement frame")
            .expect("read subscribe acknowledgement");
        let tokio_tungstenite::tungstenite::Message::Text(subscribe_ack) = subscribe_ack else {
            panic!("expected protected-room subscribe text acknowledgement");
        };
        let subscribe_ack: Value =
            serde_json::from_str(&subscribe_ack).expect("subscribe acknowledgement JSON");
        assert_eq!(subscribe_ack["kind"], "ephemeral_ack");
        assert_eq!(subscribe_ack["requestId"], "l9-ws-subscribe");
        assert_eq!(subscribe_ack["operation"], "subscribe");
        assert!(state.snapback.try_lock().is_err());

        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({
                    "type": "ephemeral_publish",
                    "requestId": "l9-ws-publish",
                    "request": {
                        "collection": "protectedPresence",
                        "scope": { "roomId": UNRELATED_WS_ROOM },
                        "connection_id": connection_id,
                        "value": [119, 115],
                        "ttl_ms": 5_000,
                    },
                })
                .to_string()
                .into(),
            ))
            .await
            .expect("send unrelated protected WebSocket publish");
        tokio::time::timeout(Duration::from_secs(1), async {
            let mut saw_publish_ack = false;
            let mut saw_drained_message = false;
            while !saw_publish_ack || !saw_drained_message {
                let frame = socket
                    .next()
                    .await
                    .expect("publish response frame")
                    .expect("read publish response");
                let tokio_tungstenite::tungstenite::Message::Text(frame) = frame else {
                    continue;
                };
                let frame: Value = serde_json::from_str(&frame).expect("publish response JSON");
                saw_publish_ack |= frame["kind"] == "ephemeral_ack"
                    && frame["requestId"] == "l9-ws-publish"
                    && frame["operation"] == "publish";
                saw_drained_message |=
                    frame["kind"] == "ephemeral" && frame["message"].get("Upsert").is_some();
            }
        })
        .await
        .expect("unrelated protected WebSocket publish/drain must not queue on the writer");
        assert!(state.snapback.try_lock().is_err());
        let _ = socket.close(None).await;
        server.abort();

        drop(affected_permit);
        let kick = tokio::time::timeout(Duration::from_secs(2), kick)
            .await
            .expect("kick completes after affected sink quiesces")
            .expect("kick task joins");
        assert_eq!(kick.status(), StatusCode::OK);
    }

    fn auth_http_fixture_with_provider(
        mode: PolicyAuthMode,
    ) -> (SnapbackApp, String, Arc<AuthProvider>) {
        let (state, capability) = auth_runtime_fixture(mode);
        let provider = state
            .auth_provider
            .clone()
            .expect("installed auth provider");
        (app(state), capability, provider)
    }

    fn auth_http_fixture(mode: PolicyAuthMode) -> (SnapbackApp, String) {
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

    fn activation_functions(bundle_marker: char, hide_rows: bool) -> FunctionManifest {
        let query = |name, kind| {
            FunctionDefinition::new(
                name,
                kind,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table: "items".to_owned(),
                    filters: hide_rows
                        .then(|| FilterExpr {
                            field: "value".to_owned(),
                            op: FilterOp::Eq,
                            value: ValueExpr::Literal(json!("never-visible")),
                        })
                        .into_iter()
                        .collect(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            )
        };
        FunctionManifest {
            schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
            app_id: "auth-activation-fixture".to_owned(),
            bundle_hash: Some(format!(
                "{FUNCTION_V1_PREFIX}{}",
                bundle_marker.to_string().repeat(64)
            )),
            inputs_hash: Some(format!("{INPUTS_V1_PREFIX}{}", "3".repeat(64))),
            functions: vec![
                query("listItems", FunctionKind::Query),
                query("liveItems", FunctionKind::LiveQuery),
            ],
            ..FunctionManifest::default()
        }
    }

    fn sessions_activation_server_fixture() -> AppState {
        let mut snapback = LocalSnapback::memory().expect("memory activation server fixture");
        let schema = SchemaManifest {
            schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
            app_id: "auth-activation-fixture".to_owned(),
            auth: Some(AuthManifest {
                mode: AuthMode::Sessions,
            }),
            required_capabilities: vec![TargetCapabilityId::AuthSessionsV1.to_string()],
            schema_hash: Some(format!("{SCHEMA_V1_PREFIX}{}", "1".repeat(64))),
            inputs_hash: Some(format!("{INPUTS_V1_PREFIX}{}", "3".repeat(64))),
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields: vec![FieldManifest {
                    name: "value".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                }],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: None,
            }],
            ..SchemaManifest::default()
        };
        let predecessor_functions = activation_functions('2', false);
        let prepared = snapback
            .prepare_auth_provision(
                EnsureAppMode::Sessions,
                Some(schema),
                Some(predecessor_functions.clone()),
                Some(SeedData {
                    tables: BTreeMap::from([(
                        "items".to_owned(),
                        vec![Map::from_iter([(
                            "value".to_owned(),
                            json!("predecessor-visible"),
                        )])],
                    )]),
                }),
            )
            .expect("preflight complete initial sessions pair");
        let (_, pending) = snapback
            .commit_auth_provision(prepared, "test")
            .expect("stage initial sessions pair");
        assert_eq!(pending.mode_state, AuthModeStatus::PendingRestart);

        let readiness = AuthProgramReadiness::new(true, true, true, true, true, true, true);
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(super::now_millis(), &OsRandom)
            .expect("provision activation keyring before sessions consume");
        let settled = snapback
            .auth_database_mut()
            .consume_sessions_auth_mode(&readiness)
            .expect("consume initial sessions pair");
        snapback
            .synchronize_auth_mode_admission(&settled)
            .expect("synchronize settled sessions admission");
        let diagnostics = snapback.publish_preflighted_functions(predecessor_functions, 43);
        assert!(
            diagnostics.iter().all(|diagnostic| !matches!(
                diagnostic.severity,
                crate::diagnostic::DiagnosticSeverity::Error
                    | crate::diagnostic::DiagnosticSeverity::Fatal
            )),
            "activation functions must publish: {diagnostics:?}"
        );
        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            super::now_millis(),
            &OsRandom,
        )
        .expect("activate auth catalog");
        let provider = Arc::new(
            AuthProvider::new(AuthProviderProfile::Test, keyring)
                .expect("construct activation auth provider"),
        );
        let (authorization, version_stream, boot_sequence) = snapback
            .auth_database_mut()
            .reserve_invalidation_boot_issuer()
            .expect("reserve activation invalidation issuer");
        let issuer_id = IssuerId::fresh(authorization.incarnation.clone(), boot_sequence)
            .expect("construct activation issuer id");
        let issuer = provider
            .authenticate_invalidation_boot_issuer(
                issuer_id,
                crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
                "auth-activation-fixture",
            )
            .expect("authenticate activation invalidation issuer");
        snapback
            .install_auth_invalidation(issuer.clone(), authorization, version_stream)
            .expect("install activation invalidation state");

        let mut context = bound_loopback_context();
        context.profile = ServerProfile::Test;
        context.admin_token = Some("auth-http-admin".to_owned());
        AppState::from_snapback(snapback, context)
            .with_auth_provider(provider)
            .with_auth_invalidation(issuer)
            .with_auth_runtime_facts(settled, readiness)
            .expect("install activation sessions posture")
    }

    async fn sessions_activation_server_fixture_async() -> AppState {
        tokio::task::spawn_blocking(|| {
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            sessions_activation_server_fixture()
        })
        .await
        .expect("construct activation fixture off the async workers")
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

    fn activate_test_sessions(state: AppState) -> AppState {
        state
            .with_auth_runtime_facts(
                settled_sessions_state(),
                AuthProgramReadiness::new(true, true, true, true, true, true, true),
            )
            .expect("activate composed sessions runtime")
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
        let route_admission = test_route_admission(state).0;
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

    fn leased_outbox_http_response(
        state: &AppState,
        connection_act: super::PreparedConnectionAct,
        payload: &[u8],
    ) -> axum::response::Response {
        state
            .ephemeral
            .enqueue_durable_for_test(&connection_act.connection_id, payload.to_vec());
        leased_queued_outbox_http_response(state, connection_act)
    }

    fn leased_bound_outbox_http_response(
        state: &AppState,
        connection_act: super::PreparedConnectionAct,
        payload: &[u8],
    ) -> axum::response::Response {
        state.ephemeral.enqueue_durable_bound_for_test(
            &connection_act.connection_id,
            payload.to_vec(),
            connection_act.effect_fence(),
        );
        leased_queued_outbox_http_response(state, connection_act)
    }

    fn leased_queued_outbox_http_response(
        state: &AppState,
        connection_act: super::PreparedConnectionAct,
    ) -> axum::response::Response {
        state
            .ephemeral
            .touch_connection(&connection_act.connection_id);
        let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(state);
        let admitted = connection_act
            .try_act(&state.connections, epoch_now_ms, monotonic_now, || {
                Ok(state
                    .ephemeral
                    .drain_outbox_for_send_bound_if_active(
                        &connection_act.connection_id,
                        &connection_act.effect_fence(),
                    )
                    .expect("fixture connection remains active"))
            })
            .expect("select an exact leased HTTP batch");
        assert_eq!(admitted.len(), 1, "fixture selects one durable frame");
        let mut permits = Vec::new();
        let mut leases = Vec::new();
        let envelopes = admitted
            .into_iter()
            .map(|admitted| {
                let (envelope, permit, lease) = admitted.into_leased_parts();
                permits.extend(permit);
                leases.push(lease);
                envelope
            })
            .collect::<Vec<_>>();
        let mut response = Json(envelopes).into_response();
        super::retain_realtime_handoff_in(
            &mut response,
            permits,
            leases,
            Some(super::RetainedConnectionHandoff {
                connections: state.connections.clone(),
                ephemeral: state.ephemeral.clone(),
                connection_act,
                auth_provider: state.auth_provider.clone(),
            }),
        );
        let admission = test_route_admission(state).0;
        let policy = super::route_registry()
            .into_iter()
            .find(|spec| spec.path == "/outbox/{connection_id}")
            .expect("registered outbox route")
            .effective_for(state.active_policy_auth_mode());
        finish_registered_response(policy, response, Some(&admission), None)
    }

    fn prepare_session_connection_act(
        state: &AppState,
        bearer: &str,
        connection_id: &str,
    ) -> (super::OpenedConnectionGrant, super::PreparedConnectionAct) {
        let provider = state.auth_provider.as_ref().expect("provider");
        let coordinator = state.auth_coordinator.as_ref().expect("coordinator");
        let epoch_now_ms = provider.now_ms();
        let monotonic_now = provider.monotonic_now();
        let prepared = super::prepare_connection_open_authority(
            state,
            super::PresentedSessionBearer::Candidate(bearer),
            epoch_now_ms,
            monotonic_now,
        )
        .expect("prepare session connection authority");
        let opened = state
            .connections
            .open_prepared(super::ConnectionOpenAttempt::new(
                Some(connection_id.to_owned()),
                None,
                true,
                prepared,
                epoch_now_ms,
                monotonic_now,
                None,
            ))
            .expect("open session connection");
        let connection_act = state
            .connections
            .prepare_act(
                &opened.grant.connection_id,
                Some(&opened.grant.connection_token),
                Some(coordinator.as_ref()),
                false,
                epoch_now_ms,
                monotonic_now,
            )
            .expect("prepare exact session connection act");
        (opened, connection_act)
    }

    fn prepare_invalidation_session_connection_act(
        state: &AppState,
        bearer: &str,
        connection_id: &str,
    ) -> (super::OpenedConnectionGrant, super::PreparedConnectionAct) {
        let provider = state.auth_provider.as_ref().expect("provider");
        let coordinator = state.auth_coordinator.as_ref().expect("coordinator");
        let epoch_now_ms = provider.now_ms();
        let monotonic_now = provider.monotonic_now();
        let prepared = super::prepare_connection_open_authority(
            state,
            super::PresentedSessionBearer::Candidate(bearer),
            epoch_now_ms,
            monotonic_now,
        )
        .expect("prepare invalidation session authority");
        let opened = state
            .connections
            .open_prepared(super::ConnectionOpenAttempt::new(
                Some(connection_id.to_owned()),
                None,
                true,
                prepared,
                epoch_now_ms,
                monotonic_now,
                Some(crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION),
            ))
            .expect("open invalidation session connection");
        let connection_act = state
            .connections
            .prepare_act(
                &opened.grant.connection_id,
                Some(&opened.grant.connection_token),
                Some(coordinator.as_ref()),
                false,
                epoch_now_ms,
                monotonic_now,
            )
            .expect("prepare exact invalidation session act");
        assert!(connection_act.authorization_invalidation.is_some());
        (opened, connection_act)
    }

    async fn direct_outbox_http_response(
        state: &AppState,
        connection_act: &super::PreparedConnectionAct,
    ) -> Result<axum::response::Response, super::ApiError> {
        let admission = test_route_admission(state).0;
        let authority = InvocationGate::prepare_admitted_authority(
            InvocationSource::OutboxDrain,
            AuthMode::Sessions,
            state.server.profile,
            admission.clone(),
            &WireAuthorityFields::default(),
            connection_act.resolved.clone(),
        )
        .expect("prepare direct outbox authority")
        .with_fenced_publication(connection_act.bound.publication().clone());
        let response = super::drain_outbox(
            State(state.clone()),
            Extension(authority.clone()),
            Extension(connection_act.clone()),
            Extension(admission.clone()),
            axum::extract::Path(connection_act.connection_id.clone()),
        )
        .await?;
        let policy = super::route_registry()
            .into_iter()
            .find(|spec| spec.path == "/outbox/{connection_id}")
            .expect("registered outbox route")
            .effective_for(PolicyAuthMode::Sessions);
        Ok(finish_registered_response(
            policy,
            response,
            Some(&admission),
            Some(&authority),
        ))
    }

    fn open_registered_session_connection(
        state: &AppState,
        bearer: &str,
        connection_id: &str,
    ) -> (String, u64, Arc<tokio::sync::Notify>) {
        let provider = state.auth_provider.as_ref().expect("provider");
        let epoch_now_ms = provider.now_ms();
        let monotonic_now = provider.monotonic_now();
        let prepared = super::prepare_connection_open_authority(
            state,
            super::PresentedSessionBearer::Candidate(bearer),
            epoch_now_ms,
            monotonic_now,
        )
        .expect("prepare session-bound connection authority");
        let opened = state
            .connections
            .open_prepared(super::ConnectionOpenAttempt::new(
                Some(connection_id.to_owned()),
                None,
                true,
                prepared,
                epoch_now_ms,
                monotonic_now,
                None,
            ))
            .expect("open session-bound connection grant");
        let (registration_generation, waker) = state
            .ephemeral
            .delivery_notifier()
            .register_bound(&opened.grant.connection_id, opened.grant_id)
            .expect("register exact session-bound socket");
        (opened.grant.connection_id, registration_generation, waker)
    }

    async fn assert_revocation_terminalized(
        state: &AppState,
        connection_id: &str,
        registration_generation: u64,
        waker: &tokio::sync::Notify,
    ) {
        tokio::time::timeout(Duration::from_secs(1), waker.notified())
            .await
            .expect("known-committed revocation wakes the exact socket");
        let notifier = state.ephemeral.delivery_notifier();
        let event = notifier
            .terminal_if_current(connection_id, registration_generation)
            .expect("known-committed revocation installs a terminal event");
        assert_eq!(
            event.code,
            crate::live_wire::LiveAuthErrorCode::SessionExpired
        );
        assert_eq!(event.reason, crate::live_wire::LiveAuthErrorReason::Revoked);
        assert!(
            event.close_by
                <= Instant::now() + crate::auth::session_projection::TERMINAL_CLOSE_GRACE,
            "terminal close remains inside the five-second protocol bound"
        );
        assert!(!notifier.is_deliverable(connection_id, registration_generation));
        let registry = state.connections.lock();
        assert!(!registry.grants.contains_key(connection_id));
        registry.assert_grant_indexes_consistent();
    }

    fn prepared_provider_route_authority(
        state: &AppState,
        source: InvocationSource,
        bearer: &str,
    ) -> Extension<PreparedAuthority> {
        assert!(matches!(
            source,
            InvocationSource::AuthRefresh | InvocationSource::AuthLogout
        ));
        let provider = state.auth_provider.as_ref().expect("provider");
        let coordinator = state.auth_coordinator.as_ref().expect("coordinator");
        let prepared = coordinator
            .resolve_family_bearer(bearer, provider.now_ms(), provider.monotonic_now())
            .expect("resolve provider-route bearer through projection");
        let (resolved, publication) = prepared.into_parts();
        Extension(
            InvocationGate::prepare_admitted_authority(
                source,
                AuthMode::Sessions,
                state.server.profile,
                test_route_admission(state).0,
                &WireAuthorityFields::default(),
                resolved,
            )
            .expect("prepare provider-route authority")
            .with_fenced_publication(publication),
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

    fn offer_auth_client_protocol(request: &mut Request<Body>) {
        request.headers_mut().insert(
            HeaderName::from_static("x-snapback-auth-client-protocol"),
            HeaderValue::from_static("1"),
        );
    }

    fn session_auth_http_request(uri: &str, body: Vec<u8>, bearer: &str) -> Request<Body> {
        let mut request = auth_http_request("POST", uri, body, true, None, None);
        offer_auth_client_protocol(&mut request);
        request.headers_mut().insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {bearer}")).expect("bearer header"),
        );
        request
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
        let captured_incarnation = response
            .extensions()
            .get::<PreparedAuthority>()
            .and_then(PreparedAuthority::authorization_stream_incarnation)
            .expect("handshake authority carries its exact stream incarnation")
            .to_owned();
        let body = response_json(response).await;
        assert_eq!(body["activeMode"], "sessions");
        assert_eq!(body["transitionGeneration"], 7);
        assert_eq!(body["clientProtocols"]["authClient"], 1);
        assert_eq!(body["clientProtocols"]["authInvalidation"], Value::Null);
        assert_eq!(body["provider"]["available"], true);
        assert_eq!(body["authority"]["userId"], credential["session"]["userId"]);
        assert_eq!(body["authority"]["sessionId"], credential["session"]["id"]);
        assert_eq!(body["authority"]["isAuthenticated"], true);
        assert_eq!(body["authorizationStreamIncarnation"], captured_incarnation);
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
    async fn pending_and_quarantined_modes_refuse_both_function_load_ingresses() {
        for quarantined in [false, true] {
            let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
            let state = state
                .with_auth_runtime_facts(
                    pending_sessions_state(quarantined),
                    AuthProgramReadiness::item4(false),
                )
                .expect("install pending mode");
            let router = app(state.clone());

            let direct = router
                .clone()
                .oneshot(auth_http_request(
                    "POST",
                    "/_snapback/api/functions/load",
                    serde_json::to_vec(&legacy_v0_activation_bypass_manifest()).unwrap(),
                    true,
                    Some("auth-http-admin"),
                    None,
                ))
                .await
                .expect("direct pending function-load refusal");
            assert_eq!(direct.status(), StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(
                response_json(direct).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_MODE_PENDING"
            );

            let host = router
                .oneshot(auth_http_request(
                    "POST",
                    "/_snapback/api/host-ops",
                    serde_json::to_vec(&json!({
                        "operation": "functions.load",
                        "functions": legacy_v0_activation_bypass_manifest(),
                    }))
                    .unwrap(),
                    true,
                    Some("auth-http-admin"),
                    None,
                ))
                .await
                .expect("host-op pending function-load refusal");
            assert_eq!(host.status(), StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(
                response_json(host).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_MODE_PENDING"
            );

            assert_eq!(
                with_snapback(&state.snapback, |snapback| {
                    snapback.function_kind("listItems")
                })
                .await,
                None,
                "neither ingress may publish the raw v0 manifest"
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

    fn legacy_v0_activation_bypass_manifest() -> FunctionManifest {
        FunctionManifest {
            schema_version: "snapback.v0".to_owned(),
            app_id: "auth-activation-fixture".to_owned(),
            bundle_hash: Some("sha256:legacy-raw-load-would-accept".to_owned()),
            inputs_hash: Some("sha256:legacy-raw-inputs".to_owned()),
            functions: vec![FunctionDefinition::new(
                "listItems",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            )],
            ..FunctionManifest::default()
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn dev_direct_functions_load_admission_closes_stage_race() {
        let (state, _) = tokio::task::spawn_blocking(|| {
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            auth_runtime_fixture(PolicyAuthMode::Dev)
        })
        .await
        .expect("construct dev fixture off async workers");
        let router = app(state.clone());
        let controller = state.auth_admission_controller();
        let app_lock = state.snapback.lock().await;
        let request = auth_http_request(
            "POST",
            "/_snapback/api/functions/load",
            serde_json::to_vec(&FunctionManifest::default()).unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        );
        let load = tokio::spawn(async move {
            router
                .oneshot(request)
                .await
                .expect("paused dev function-load response")
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while controller.snapshot().in_flight == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("direct load acquires managed admission before the app lock");

        let transition = tokio::task::spawn_blocking({
            let controller = controller.clone();
            move || {
                let guard = controller.begin_transition()?;
                drop(guard);
                Ok::<(), SnapbackError>(())
            }
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while controller.snapshot().accepting {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("stage closes new admission while load is paused after routing");
        assert!(!transition.is_finished());

        drop(app_lock);
        let response = tokio::time::timeout(Duration::from_secs(2), load)
            .await
            .expect("predecessor load reaches its response")
            .expect("load task joins");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(
            !transition.is_finished(),
            "stage cannot reach its durable cut while the predecessor response body owns admission"
        );
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("drain predecessor load response");
        assert_eq!(
            serde_json::from_slice::<Value>(&body).expect("pending response JSON")["diagnostic"]["code"],
            "SNAPBACK_AUTH_MODE_PENDING"
        );
        tokio::time::timeout(Duration::from_secs(2), transition)
            .await
            .expect("stage resumes after the response drain")
            .expect("transition task joins")
            .expect("transition acquisition succeeds");
        assert!(controller.snapshot().accepting);
    }

    /// A request body that never finishes arriving (ENG-24988). The trickled
    /// upload owns a managed admission root, so without a monotonic ingest
    /// deadline it would retain that root indefinitely and force every
    /// auth-mode activation into `SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT`.
    fn stalled_admitted_request(uri: &str) -> Request<Body> {
        let stalled = futures_util::stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(
            br#"{"args":"#,
        ))])
        .chain(futures_util::stream::pending());
        let mut request = Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from_stream(stalled))
            .expect("stalled admitted request");
        offer_auth_client_protocol(&mut request);
        request
    }

    // @ref LLP 0058#admitted-body-ingestion — the ingest deadline is exact,
    // monotonic, and strictly below the 30000 ms quiescence deadline.
    #[tokio::test(start_paused = true)]
    async fn admitted_body_ingestion_times_out_strictly_below_quiescence_deadline() {
        let (state, _) = tokio::task::spawn_blocking(|| {
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            auth_runtime_fixture(PolicyAuthMode::Dev)
        })
        .await
        .expect("construct dev fixture off async workers");
        let router = app(state.clone());
        let controller = state.auth_admission_controller();
        let started = tokio::time::Instant::now();
        let response = router
            .oneshot(stalled_admitted_request("/mutation/missing_function"))
            .await
            .expect("stalled body reaches its deadline refusal");
        let elapsed = started.elapsed();
        assert!(
            elapsed >= Duration::from_millis(ADMITTED_BODY_INGEST_DEADLINE_MS),
            "ingest refusal arrived before the deadline: {elapsed:?}"
        );
        assert!(
            elapsed
                < Duration::from_millis(
                    crate::auth::admission::AUTH_MODE_QUIESCENCE_TIMEOUT_MS
                ),
            "admitted request lifetime reached the quiescence deadline: {elapsed:?}"
        );
        assert_eq!(response.status(), StatusCode::REQUEST_TIMEOUT);
        let body = response_json(response).await;
        assert_eq!(body["diagnostic"]["code"], "SNAPBACK_REQUEST_BODY_TIMEOUT");
        assert_eq!(
            body["diagnostic"]["details"]["deadlineMs"],
            json!(ADMITTED_BODY_INGEST_DEADLINE_MS)
        );
        assert_eq!(
            controller.snapshot().in_flight,
            0,
            "the deadline refusal must release its admission root"
        );
    }

    // @ref LLP 0058#admitted-body-ingestion — closing the admitted epoch
    // cancels in-flight body buffering and releases the root without waiting
    // for the client to disconnect, so staging's drain cannot be starved.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn admitted_body_ingestion_cancels_when_admission_closes() {
        let (state, _) = tokio::task::spawn_blocking(|| {
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            auth_runtime_fixture(PolicyAuthMode::Dev)
        })
        .await
        .expect("construct dev fixture off async workers");
        let router = app(state.clone());
        let controller = state.auth_admission_controller();
        let request = stalled_admitted_request("/mutation/missing_function");
        let stalled = tokio::spawn(async move {
            router
                .oneshot(request)
                .await
                .expect("stalled body reaches its close refusal")
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while controller.snapshot().in_flight == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("stalled body owns a managed admission root");

        // The full 30000 ms staging barrier must not be consumed: the close
        // cancels ingestion immediately instead of waiting out the deadline.
        let transition = tokio::spawn({
            let controller = controller.clone();
            async move { controller.begin_transition_async(|| Ok(())).await }
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while controller.snapshot().accepting {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("stage closes admission while the body is still arriving");

        // The refusal is a response on the still-connected client, not a
        // disconnect, and draining it releases the admission root.
        let response = tokio::time::timeout(Duration::from_secs(2), stalled)
            .await
            .expect("stalled request is refused at epoch close")
            .expect("stalled request task joins");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = response_json(response).await;
        assert_eq!(body["diagnostic"]["code"], "SNAPBACK_AUTH_MODE_PENDING");

        let transition = tokio::time::timeout(Duration::from_secs(5), transition)
            .await
            .expect("stage quiesces a stalled admitted body without timing out")
            .expect("transition task joins")
            .expect("transition acquisition succeeds");
        let reopened = transition
            .abort_and_reopen()
            .expect("reopen the unchanged generation");
        assert!(reopened.accepting);
        assert_eq!(reopened.in_flight, 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn direct_functions_load_quiesces_old_query_body_and_activates_complete_pair() {
        let state = sessions_activation_server_fixture_async().await;
        let router = app(state.clone());
        let controller = state.auth_admission_controller();
        let predecessor_admission = controller.snapshot();
        let predecessor_mode = state.auth_mode_state();
        let predecessor_bundle = predecessor_mode
            .active_deployment
            .as_ref()
            .expect("predecessor deployment")
            .bundle_hash
            .clone();

        let rejected = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/functions/load",
                serde_json::to_vec(&legacy_v0_activation_bypass_manifest()).unwrap(),
                true,
                Some("auth-http-admin"),
                None,
            ))
            .await
            .expect("legacy direct load rejection");
        assert!(
            !rejected.status().is_success(),
            "sessions mode must never enter the raw v0 function loader"
        );
        let rejected = response_json(rejected).await;
        assert!(
            rejected["diagnostic"]["code"]
                .as_str()
                .is_some_and(|code| code.contains("ARTIFACT") || code.contains("CAPABILITY")),
            "complete-pair preflight must own the rejection: {rejected}"
        );
        assert_eq!(
            state
                .auth_mode_state()
                .active_deployment
                .as_ref()
                .expect("unchanged deployment")
                .bundle_hash,
            predecessor_bundle
        );

        let mut query = auth_http_request(
            "POST",
            "/query/listItems",
            br#"{}"#.to_vec(),
            true,
            None,
            None,
        );
        offer_auth_client_protocol(&mut query);
        let old_response = router
            .clone()
            .oneshot(query)
            .await
            .expect("predecessor query response");
        assert_eq!(old_response.status(), StatusCode::OK);

        let successor_functions = activation_functions('4', true);
        let successor_bundle = successor_functions
            .bundle_hash
            .clone()
            .expect("successor bundle");
        let activation_request = auth_http_request(
            "POST",
            "/_snapback/api/functions/load",
            serde_json::to_vec(&successor_functions).unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        );
        let activation = tokio::spawn({
            let router = router.clone();
            async move {
                router
                    .oneshot(activation_request)
                    .await
                    .expect("direct activation response")
            }
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while controller.snapshot().accepting {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("activation closes admission while old response is paused");
        assert_eq!(controller.snapshot().in_flight, 1);
        assert!(
            !activation.is_finished(),
            "the durable activation cannot overtake an unpolled predecessor query body"
        );

        let old_body = to_bytes(old_response.into_body(), usize::MAX)
            .await
            .expect("publish predecessor query body under its still-live epoch");
        let old_body: Value = serde_json::from_slice(&old_body).expect("old query JSON");
        assert_eq!(old_body["rows"].as_array().map(Vec::len), Some(1));

        let activated = tokio::time::timeout(Duration::from_secs(2), activation)
            .await
            .expect("activation resumes after predecessor response drains")
            .expect("activation task joins");
        assert_eq!(activated.status(), StatusCode::OK);
        let _ = response_json(activated).await;
        let reopened = controller.snapshot();
        assert!(reopened.accepting);
        assert_eq!(reopened.in_flight, 0);
        assert_ne!(
            reopened.admission_epoch,
            predecessor_admission.admission_epoch
        );
        assert_eq!(
            state
                .auth_mode_state()
                .active_deployment
                .as_ref()
                .expect("successor deployment")
                .bundle_hash,
            successor_bundle
        );

        let (durable_authorization, projected_authorization) =
            with_snapback(&state.snapback, |snapback| {
                (
                    snapback
                        .auth_database_mut()
                        .authorization_version()
                        .expect("durable activation authorization"),
                    snapback
                        .auth_invalidation_expectation_for_test()
                        .expect("projected activation authorization"),
                )
            })
            .await;
        assert_eq!(projected_authorization, durable_authorization);

        let mut successor_query = auth_http_request(
            "POST",
            "/query/listItems",
            br#"{}"#.to_vec(),
            true,
            None,
            None,
        );
        offer_auth_client_protocol(&mut successor_query);
        let successor_response = router
            .oneshot(successor_query)
            .await
            .expect("successor query response");
        assert_eq!(successor_response.status(), StatusCode::OK);
        assert_eq!(
            response_json(successor_response).await["rows"],
            json!([]),
            "every query admitted after activation observes the successor policy"
        );
    }

    #[tokio::test]
    async fn sessions_activation_runtime_projection_failure_never_reopens_admission() {
        let state = sessions_activation_server_fixture_async().await;
        let controller = state.auth_admission_controller();
        let predecessor_bundle = state
            .auth_mode_state()
            .active_deployment
            .as_ref()
            .expect("predecessor deployment")
            .bundle_hash
            .clone();
        let successor = activation_functions('6', true);
        let successor_bundle = successor.bundle_hash.clone().expect("successor bundle");
        state.inject_auth_mode_publication_failure();

        let response = app(state.clone())
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/functions/load",
                serde_json::to_vec(&successor).unwrap(),
                true,
                Some("auth-http-admin"),
                None,
            ))
            .await
            .expect("injected runtime projection failure response");
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "TEST_AUTH_MODE_PUBLICATION_FAILURE"
        );
        assert_eq!(
            state
                .auth_mode_state()
                .active_deployment
                .as_ref()
                .expect("runtime projection remains predecessor")
                .bundle_hash,
            predecessor_bundle
        );
        let durable_bundle = with_snapback(&state.snapback, |snapback| {
            snapback
                .auth_database_mut()
                .auth_mode_snapshot()
                .expect("durable activation snapshot")
                .state
                .active_deployment
                .expect("durable successor deployment")
                .bundle_hash
        })
        .await;
        assert_eq!(durable_bundle, successor_bundle);
        let closed = controller.snapshot();
        assert!(!closed.accepting);
        assert_eq!(closed.in_flight, 0);
        assert_eq!(
            controller.admit().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
    }

    #[tokio::test]
    async fn host_ops_functions_load_cannot_bypass_complete_pair_activation() {
        let state = sessions_activation_server_fixture_async().await;
        let router = app(state.clone());
        let controller = state.auth_admission_controller();
        let predecessor_admission = controller.snapshot();
        let predecessor = state.auth_mode_state();
        let predecessor_bundle = predecessor
            .active_deployment
            .as_ref()
            .expect("predecessor deployment")
            .bundle_hash
            .clone();

        let rejected = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                serde_json::to_vec(&json!({
                    "operation": "functions.load",
                    "functions": legacy_v0_activation_bypass_manifest(),
                }))
                .unwrap(),
                true,
                Some("auth-http-admin"),
                None,
            ))
            .await
            .expect("host-op legacy load rejection");
        assert_eq!(rejected.status(), StatusCode::OK);
        let rejected = response_json(rejected).await;
        assert_eq!(rejected["ok"], false);
        assert!(
            rejected["diagnostics"][0]["code"]
                .as_str()
                .is_some_and(|code| code.contains("ARTIFACT") || code.contains("CAPABILITY")),
            "host-op must expose complete-pair preflight rejection: {rejected}"
        );
        assert_eq!(
            state
                .auth_mode_state()
                .active_deployment
                .as_ref()
                .expect("unchanged deployment")
                .bundle_hash,
            predecessor_bundle
        );

        let successor_functions = activation_functions('5', true);
        let successor_bundle = successor_functions
            .bundle_hash
            .clone()
            .expect("successor bundle");
        let activated = router
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                serde_json::to_vec(&json!({
                    "operation": "functions.load",
                    "functions": successor_functions,
                }))
                .unwrap(),
                true,
                Some("auth-http-admin"),
                None,
            ))
            .await
            .expect("coordinated host-op activation response");
        assert_eq!(activated.status(), StatusCode::OK);
        let activated = response_json(activated).await;
        assert_eq!(activated["ok"], true, "{activated}");
        assert_eq!(activated["data"]["loaded"], true);
        assert_eq!(
            state
                .auth_mode_state()
                .active_deployment
                .as_ref()
                .expect("successor deployment")
                .bundle_hash,
            successor_bundle
        );
        let reopened = controller.snapshot();
        assert!(reopened.accepting);
        assert_ne!(
            reopened.admission_epoch,
            predecessor_admission.admission_epoch
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
    async fn item5_live_gate_preserves_only_manifest_proved_independent_exception() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let item5 = AuthProgramReadiness::new(true, true, true, true, false, false, false);
        let state = state
            .with_auth_runtime_facts(settled_sessions_state(), item5)
            .expect("install item-5 sessions fixture");
        let mut independent = FunctionDefinition::new(
            "publicFeed",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "items".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        );
        independent.authority_independent = true;
        independent.auth_requirement = Some(crate::manifest::AuthRequirement::Public);
        let scoped = FunctionDefinition::new(
            "privateFeed",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "items".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        );
        super::with_snapback(&state.snapback, move |snapback| {
            snapback
                .apply_schema(SchemaManifest {
                    ephemeral_collections: vec![
                        EphemeralCollection::local_cursor("public_cursors", "room"),
                        EphemeralCollection::local_cursor("private_cursors", "room")
                            .require_room_permission("room_read"),
                    ],
                    tables: vec![crate::manifest::TableManifest {
                        name: "items".to_owned(),
                        fields: Vec::new(),
                        indexes: Vec::new(),
                        syncable: false,
                        permission_backing: false,
                        permission_fields: None,
                        membership: None,
                    }],
                    ..SchemaManifest::default()
                })
                .expect("install live-gate schema");
            let diagnostics = snapback.load_functions(FunctionManifest {
                functions: vec![independent, scoped],
                ..FunctionManifest::default()
            });
            assert!(
                diagnostics.iter().all(|diagnostic| diagnostic.severity
                    != crate::diagnostic::DiagnosticSeverity::Error),
                "live-gate manifest must load: {diagnostics:?}"
            );
        })
        .await;
        let spec = super::core_route_registrations()
            .into_iter()
            .find(|route| route.spec.path == "/live/{name}/subscribe")
            .expect("registered live subscribe")
            .spec;
        let headers = HeaderMap::from_iter([(
            HeaderName::from_static("x-snapback-auth-client-protocol"),
            HeaderValue::from_static("1"),
        )]);

        assert!(
            super::session_live_protocol_refusal(
                spec,
                &state,
                &headers,
                "/live/publicFeed/subscribe",
                None,
            )
            .await
            .is_none()
        );
        let refusal = super::session_live_protocol_refusal(
            spec,
            &state,
            &headers,
            "/live/privateFeed/subscribe",
            None,
        )
        .await
        .expect("auth-scoped live must fail before item 6");
        assert_eq!(
            refusal.diagnostic.code,
            "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE"
        );

        let ephemeral_spec = super::core_route_registrations()
            .into_iter()
            .find(|route| route.spec.path == "/ephemeral/subscribe")
            .expect("registered ephemeral subscribe")
            .spec;
        assert!(
            super::session_live_protocol_refusal(
                ephemeral_spec,
                &state,
                &headers,
                "/ephemeral/subscribe",
                Some(&json!({ "collection": "public_cursors" })),
            )
            .await
            .is_none()
        );
        assert_eq!(
            super::session_live_protocol_refusal(
                ephemeral_spec,
                &state,
                &headers,
                "/ephemeral/subscribe",
                Some(&json!({ "collection": "private_cursors" })),
            )
            .await
            .expect("protected room must fail before item 6")
            .diagnostic
            .code,
            "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE"
        );

        let socket_subscribe = |collection: &str| {
            json!({
                "type": "ephemeral_subscribe",
                "requestId": format!("subscribe-{collection}"),
                "request": {
                    "collection": collection,
                    "scope": { "room": "one" },
                    "connection_id": "conn-item5"
                }
            })
            .to_string()
        };
        let public_socket: Value = serde_json::from_str(
            &super::handle_live_socket_text(
                &state.ephemeral,
                "conn-item5",
                &socket_subscribe("public_cursors"),
                PolicyAuthMode::Sessions,
                false,
                &ResolvedAppAuthority::Anonymous,
            )
            .text,
        )
        .expect("public socket response");
        assert_eq!(
            public_socket["kind"], "ephemeral_ack",
            "session-mode authority-independent registration must not require body auth"
        );
        let protected_socket: Value = serde_json::from_str(
            &super::handle_live_socket_text(
                &state.ephemeral,
                "conn-item5",
                &socket_subscribe("private_cursors"),
                PolicyAuthMode::Sessions,
                false,
                &ResolvedAppAuthority::Anonymous,
            )
            .text,
        )
        .expect("protected socket refusal");
        assert_eq!(
            protected_socket["diagnostic"]["code"], "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
            "the WebSocket registration twin must share the HTTP item-5 gate"
        );

        let mut planted: Value =
            serde_json::from_str(&socket_subscribe("public_cursors")).expect("socket frame");
        planted["request"]["auth"] = json!({
            "principal": "planted",
            "session_id": null,
            "user_id": null,
            "permissions": []
        });
        let planted: Value = serde_json::from_str(
            &super::handle_live_socket_text(
                &state.ephemeral,
                "conn-item5",
                &planted.to_string(),
                PolicyAuthMode::Sessions,
                false,
                &ResolvedAppAuthority::Anonymous,
            )
            .text,
        )
        .expect("planted-auth refusal");
        assert_eq!(
            planted["diagnostic"]["code"],
            "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED"
        );

        let dev_missing_auth: Value = serde_json::from_str(
            &super::handle_live_socket_text(
                &state.ephemeral,
                "conn-item5",
                &socket_subscribe("public_cursors"),
                PolicyAuthMode::Dev,
                false,
                &ResolvedAppAuthority::Anonymous,
            )
            .text,
        )
        .expect("dev closed-shape refusal");
        assert_eq!(
            dev_missing_auth["diagnostic"]["code"], "SNAPBACK_WEBSOCKET_MESSAGE_INVALID",
            "the legacy dev DTO must still require its auth member"
        );
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
    async fn authorized_lease_route_requires_readiness_and_exact_protocol_offer() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let credential = mint_test_credential(&state, "authorized-lease-route@example.com").await;
        let bearer = credential["token"].as_str().unwrap().to_owned();
        let request = |lease_protocol: Option<&str>, include_unknown: bool| {
            let mut builder = Request::builder()
                .method("POST")
                .uri("/query/missing_function/authorized-lease")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                .header("x-snapback-auth-client-protocol", "1")
                .header("x-snapback-auth-invalidation-protocol", "1");
            if let Some(lease_protocol) = lease_protocol {
                builder = builder.header("x-snapback-authorized-lease-protocol", lease_protocol);
            }
            let body = if include_unknown {
                r#"{
                        "args": {},
                        "leaseRequestId": "request_1",
                        "clientStoreId": "store_1",
                        "queryKey": "missing_function:{}",
                        "queryInstanceId": 1,
                        "unexpected": true
                    }"#
            } else {
                r#"{
                        "args": {},
                        "leaseRequestId": "request_1",
                        "clientStoreId": "store_1",
                        "queryKey": "missing_function:{}",
                        "queryInstanceId": 1
                    }"#
            };
            builder.body(Body::from(body)).unwrap()
        };

        let dependencies_ready =
            AuthProgramReadiness::new(true, true, true, true, true, true, false);
        let unavailable = app(state
            .clone()
            .with_auth_runtime_facts(settled_sessions_state(), dependencies_ready)
            .expect("install pre-authorized-lease readiness"))
        .oneshot(request(Some("1"), false))
        .await
        .unwrap();
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(unavailable).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );

        let ready = app(state
            .with_auth_runtime_facts(
                settled_sessions_state(),
                AuthProgramReadiness::new(true, true, true, true, true, true, true),
            )
            .expect("install authorized-lease readiness"));
        let missing_offer = ready.clone().oneshot(request(None, false)).await.unwrap();
        assert_eq!(missing_offer.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(missing_offer).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );

        let unknown = ready
            .clone()
            .oneshot(request(Some("1"), true))
            .await
            .unwrap();
        assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response_json(unknown).await["diagnostic"]["code"],
            "SNAPBACK_REQUEST_JSON_INVALID"
        );

        let accepted_offer = ready.oneshot(request(Some("1"), false)).await.unwrap();
        assert_eq!(
            response_json(accepted_offer).await["diagnostic"]["code"],
            "SNAPBACK_UNKNOWN_FUNCTION",
            "an exact protocol offer must reach the fresh full-query path"
        );
    }

    #[tokio::test]
    async fn dev_transport_and_prod_profile_fail_closed_but_keep_health_available() {
        let (mut non_loopback, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        Arc::make_mut(&mut non_loopback.server)
            .record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
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

        let (mut sessions, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        Arc::make_mut(&mut sessions.server)
            .record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
        let sessions = sessions.with_insecure_dev_auth_override(true);
        let refused = app(sessions)
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
    }

    #[tokio::test]
    async fn plaintext_handshake_fence_precedes_bearer_resolution_for_active_and_desired_sessions()
    {
        const BEARER_SENTINEL: &str = "sbs_PLAINTEXT_HANDSHAKE_SENTINEL_MUST_NOT_BE_CONSUMED";

        async fn handshake(router: SnapbackApp, bearer: Option<&str>) -> (StatusCode, Value) {
            let mut request = Request::builder().uri("/auth/session");
            if let Some(bearer) = bearer {
                request = request.header(header::AUTHORIZATION, format!("Bearer {bearer}"));
            }
            let response = router
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            let status = response.status();
            (status, response_json(response).await)
        }

        let (mut active, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        Arc::make_mut(&mut active.server)
            .record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
        let active = active.with_insecure_dev_auth_override(true);
        assert_eq!(
            active
                .validate_auth_transport()
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_TRANSPORT_INSECURE"
        );
        let (status, body) = handshake(app(active), Some(BEARER_SENTINEL)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            body["diagnostic"]["code"],
            "SNAPBACK_AUTH_TRANSPORT_INSECURE"
        );
        assert!(!body.to_string().contains(BEARER_SENTINEL));

        let (mut desired, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        desired
            .publish_auth_mode_state(pending_sessions_state(false))
            .unwrap();
        Arc::make_mut(&mut desired.server)
            .record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
        let desired = desired.with_insecure_dev_auth_override(true);
        assert_eq!(
            desired
                .validate_auth_transport()
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_TRANSPORT_INSECURE"
        );
        let desired_router = app(desired);
        let health = desired_router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);
        let (status, body) = handshake(desired_router, Some(BEARER_SENTINEL)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            body["diagnostic"]["code"],
            "SNAPBACK_AUTH_TRANSPORT_INSECURE"
        );
        assert!(!body.to_string().contains(BEARER_SENTINEL));

        let (mut dev, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        Arc::make_mut(&mut dev.server)
            .record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
        let dev = dev.with_insecure_dev_auth_override(true);
        let (status, body) = handshake(app(dev), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["activeMode"], "dev");
        assert_eq!(body["authority"]["isAuthenticated"], false);
    }

    #[tokio::test]
    async fn loopback_context_cannot_authorize_a_different_non_loopback_listener() {
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

        async fn request(port: u16, path: &str) -> (StatusCode, Value) {
            let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .unwrap_or_else(|error| panic!("connect detached {path}: {error}"));
            stream
                .write_all(
                    format!(
                        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap_or_else(|error| panic!("write detached {path}: {error}"));
            let mut response = Vec::new();
            stream
                .read_to_end(&mut response)
                .await
                .unwrap_or_else(|error| panic!("read detached {path}: {error}"));
            let split = response
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .expect("HTTP response header delimiter");
            let head = std::str::from_utf8(&response[..split]).expect("HTTP response headers");
            let status = head
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|raw| raw.parse::<u16>().ok())
                .and_then(|raw| StatusCode::from_u16(raw).ok())
                .expect("HTTP response status");
            let body = serde_json::from_slice(&response[split + 4..]).unwrap_or(Value::Null);
            (status, body)
        }

        // auth_runtime_fixture deliberately carries positive posture from a
        // different, throwaway loopback listener. The network bind below must
        // replace that evidence rather than trusting the prebuilt context.
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        assert_eq!(state.server.listener_transport_loopback(), Some(true));

        // This is the shipped bypass shape: the router claims loopback while
        // an embedder serves it on every interface. Connect through loopback so
        // the test remains hermetic; the socket itself is still non-loopback.
        let listener = TcpListener::bind("0.0.0.0:0")
            .await
            .expect("bind real non-loopback embedded listener");
        let port = listener
            .local_addr()
            .expect("embedded listener address")
            .port();
        let server = tokio::spawn(async move {
            app(state)
                .bind(listener)
                .expect("couple sessions app to real non-loopback listener")
                .serve()
                .await
                .expect("serve detached sessions router");
        });
        let (health, _) = request(port, "/health").await;
        assert_eq!(health, StatusCode::OK);

        for path in ["/inspect", "/auth/session"] {
            let (status, body) = request(port, path).await;
            assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{path}");
            assert_eq!(
                body["diagnostic"]["code"], "SNAPBACK_AUTH_TRANSPORT_INSECURE",
                "{path}: {body}"
            );
        }

        server.abort();
        let _ = server.await;

        let (mut forged, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let context = Arc::make_mut(&mut forged.server);
        context.record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
        context.loopback = true;
        context.host = "127.0.0.1".to_owned();
        let response = app(forged)
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .body(Body::empty())
                    .expect("forged-loopback request"),
            )
            .await
            .expect("forged-loopback response");
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_TRANSPORT_INSECURE",
            "public descriptive fields must not override listener-owned posture"
        );
    }

    #[tokio::test]
    async fn hosted_auth_configuration_is_fail_closed_in_embedded_composition() {
        let (mut state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        Arc::make_mut(&mut state.server).auth_deployment =
            crate::auth::deployment::AuthDeploymentTarget::Hosted;
        let router = app(state);

        for path in ["/inspect", "/auth/session"] {
            let refused = router
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(refused.status(), StatusCode::SERVICE_UNAVAILABLE, "{path}");
            let body = response_json(refused).await;
            assert_eq!(
                body["diagnostic"]["code"], "SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED",
                "{path}"
            );
            assert_eq!(
                body["diagnostic"]["details"]["blockers"],
                serde_json::json!([
                    "externalTls",
                    "effectiveSource",
                    "authenticationThrottle",
                    "sessionInvalidation",
                    "clientCredentialPosture",
                    "deploymentAttestation",
                    "liveHealth",
                    "handlerCompatibility",
                    "operatorSurface",
                ]),
                "{path}"
            );
        }

        for path in ["/", "/health"] {
            let diagnostic = router
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(diagnostic.status(), StatusCode::OK, "{path}");
        }
    }

    #[tokio::test]
    async fn snapback_static_pages_ship_a_hash_pinned_restrictive_csp() {
        use base64::Engine as _;
        use sha2::{Digest as _, Sha256};

        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        let response = app(state)
            .oneshot(
                Request::builder()
                    .uri("/_snapback/admin/setup")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let csp = response
            .headers()
            .get("content-security-policy")
            .and_then(|value| value.to_str().ok())
            .unwrap()
            .to_owned();
        assert!(csp.contains("default-src 'none'"), "{csp}");
        assert!(csp.contains("object-src 'none'"), "{csp}");
        assert!(csp.contains("frame-ancestors 'none'"), "{csp}");
        assert!(csp.contains("require-trusted-types-for 'script'"), "{csp}");
        assert!(!csp.contains("unsafe-eval"), "{csp}");
        let script_directive = csp
            .split(';')
            .find(|directive| directive.trim_start().starts_with("script-src "))
            .unwrap();
        assert!(!script_directive.contains("unsafe-inline"), "{csp}");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert_eq!(response.headers()["referrer-policy"], "no-referrer");
        assert_eq!(response.headers()["x-frame-options"], "DENY");
        assert_eq!(
            response.headers()["cross-origin-resource-policy"],
            "same-origin"
        );

        let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
            .await
            .unwrap();
        let html = std::str::from_utf8(&bytes).unwrap();
        let script = html
            .split_once("<script>")
            .and_then(|(_, suffix)| suffix.split_once("</script>"))
            .map(|(script, _)| script)
            .expect("one embedded setup script");
        let digest = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(script));
        assert!(
            csp.contains(&format!("'sha256-{digest}'")),
            "the served inline script changed without updating its CSP hash: {csp}"
        );

        // The built Exact shell has build-specific inline manifest/bootstrap
        // blocks. Its handler must hash the exact served bytes and the shared
        // middleware must preserve that response-specific policy.
        let dist = tempfile::tempdir().unwrap();
        let admin_html = concat!(
            "<!doctype html><script type=\"application/json\">\n",
            "{\"buildId\":\"fixture\"}\n",
            "</script><script>\n",
            "globalThis.__exactAppBasePath = '/_snapback/admin';\n",
            "</script><script type=\"module\" src=\"/assets/main.js\"></script>",
        );
        std::fs::write(dist.path().join("index.html"), admin_html).unwrap();
        let expected_digests = crate::admin::inline_script_sha256_digests(admin_html.as_bytes());
        assert_eq!(expected_digests.len(), 2);
        let (mut state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        Arc::make_mut(&mut state.server).admin_dist = Some(dist.path().to_owned());
        let response = app(state)
            .oneshot(
                Request::builder()
                    .uri("/_snapback/admin")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let csp = response
            .headers()
            .get("content-security-policy")
            .and_then(|value| value.to_str().ok())
            .unwrap()
            .to_owned();
        for digest in &expected_digests {
            assert!(
                csp.contains(&format!("'sha256-{digest}'")),
                "built admin inline bytes are not admitted by their response CSP: {csp}"
            );
        }
        let script_directive = csp
            .split(';')
            .find(|directive| directive.trim_start().starts_with("script-src "))
            .unwrap();
        assert_eq!(script_directive.matches("'sha256-").count(), 2, "{csp}");
        assert!(!script_directive.contains("unsafe-inline"), "{csp}");
        assert!(csp.contains("require-trusted-types-for 'script'"), "{csp}");
        let body = to_bytes(response.into_body(), 2 * 1024 * 1024)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), admin_html.as_bytes());
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

    #[tokio::test]
    async fn scoped_token_carrier_is_resolved_only_for_granted_current_function_scope() {
        async fn prepare_query(
            AxumPath(name): AxumPath<String>,
            Extension(authority): Extension<PreparedAuthority>,
        ) -> Result<Json<super::FunctionResponse<Value>>, super::ApiError> {
            let function = FunctionDefinition::new(
                name,
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            );
            let attribution = authority.function_attribution();
            let prepared = InvocationGate::prepare_function(authority, &function)
                .map_err(super::ApiError::from)
                .map_err(|error| error.with_attribution(attribution.clone()))?;
            Ok(Json(super::FunctionResponse::new(
                serde_json::to_value(prepared.projection()).unwrap(),
                attribution,
            )))
        }

        let state = sessions_activation_server_fixture_async().await;
        let provider = state.auth_provider.clone().unwrap();
        let now_ms = provider.now_ms();
        let (token, agent_credential) = with_snapback(&state.snapback, move |snapback| {
            let db = snapback.auth_database_mut();
            db.with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(
                       id, created_at_ms, kind, display_name, operator_contact,
                       registration_provenance, deactivated_at_ms, owner_user_id
                     ) VALUES('carrier-user', ?1, 'human', NULL, NULL, NULL, NULL, NULL)",
                    rusqlite::params![now_ms as i64],
                )?;
                tx.execute(
                    "INSERT INTO _auth_scope_bases(
                       function_id, kind, generation, present, authority_creating
                     ) VALUES('fn:allowed', 'query', 0, 1, 0)",
                    [],
                )?;
                Ok(())
            })?;
            db.create_agent_principal(
                "carrier-agent",
                now_ms,
                &crate::storage::auth_agents::AgentRegistration {
                    display_name: None,
                    operator_contact: None,
                    registration_provenance: "carrier-test".to_owned(),
                    owner_user_id: Some("carrier-user".to_owned()),
                },
            )?;
            let credential = db.issue_initial_agent_credential(
                "carrier-agent",
                now_ms,
                provider.agent_random_source(),
            )?;
            db.with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_grants(
                       id, actor_user_id, effective_user_id, scopes, created_at_ms,
                       expires_at_ms, revoked_at_ms, created_by, request_id,
                       consent_digest, last_used_at_ms
                     ) VALUES('carrier-grant', 'carrier-agent', 'carrier-user', ?1, ?2, ?3,
                              NULL, 'test', NULL, NULL, ?2)",
                    rusqlite::params![
                        r#"[{"fn":"fn:allowed","kind":"query","basis":0,"authorityCreating":false}]"#,
                        now_ms as i64,
                        (now_ms + 60_000) as i64,
                    ],
                )?;
                Ok(())
            })?;
            let issued = db.mint_scoped_token(
                &credential.secret,
                "carrier-grant",
                None,
                now_ms,
                provider.agent_random_source(),
            )?;
            Ok::<_, SnapbackError>((
                issued.secret.expose_secret().to_owned(),
                credential.secret.expose_secret().to_owned(),
            ))
        })
        .await
        .unwrap();

        let connection_router = super::app(state.clone());
        let opened = connection_router
            .clone()
            .oneshot(connection_open_request(Some(&token), json!({})))
            .await
            .unwrap();
        assert_eq!(opened.status(), StatusCode::OK);
        assert_eq!(
            opened.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store, private"
        );
        let opened = response_json(opened).await;
        let connection_id = opened["connectionId"].as_str().unwrap();
        let connection_token = opened["connectionToken"].as_str().unwrap();
        state.connections.lock().assert_grant_indexes_consistent();

        let wrong_open = connection_router
            .clone()
            .oneshot(connection_open_request(Some(&agent_credential), json!({})))
            .await
            .unwrap();
        assert_eq!(wrong_open.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(wrong_open).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
        );

        let live = connection_router
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/live/{connection_id}/stream"))
                    .header("x-snapback-auth-client-protocol", "1")
                    .header(super::CONNECTION_TOKEN_HEADER, connection_token)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(live.status(), StatusCode::SERVICE_UNAVAILABLE);
        let live = response_json(live).await;
        assert_eq!(
            live["diagnostic"]["code"],
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
        assert_eq!(
            live["diagnostic"]["details"]["capability"],
            "grantBackedLive"
        );

        let router = super::router_from_registrations(
            vec![
                super::RegisteredRoute::new(
                    super::app_function_route("POST", "/query/{name}"),
                    axum::routing::post(prepare_query),
                ),
                super::RegisteredRoute::new(
                    super::app_auth_route("POST", "/query/{name}/authorized-lease"),
                    axum::routing::post(prepare_query),
                ),
            ],
            state.clone(),
        )
        .with_state(state.clone());
        let request = |uri: &str, bearer: &str| {
            Request::builder()
                .method("POST")
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                .header("x-snapback-auth-client-protocol", "1")
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap()
        };

        let allowed = router
            .clone()
            .oneshot(request("/query/allowed", &token))
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);
        let projection = response_json(allowed).await;
        assert_eq!(projection["userId"], "carrier-user");
        assert_eq!(projection["kind"], "human");
        assert_eq!(projection["actor"]["userId"], "carrier-agent");
        assert_eq!(projection["actor"]["grantId"], "carrier-grant");
        assert_eq!(
            projection["attribution"],
            json!({
                "actorUserId": "carrier-agent",
                "effectiveUserId": "carrier-user",
                "grantId": "carrier-grant",
                "dryRun": false
            })
        );

        let denied = router
            .clone()
            .oneshot(request("/query/not-granted", &token))
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        let denied = response_json(denied).await;
        assert_eq!(
            denied["diagnostic"]["code"],
            "SNAPBACK_AUTH_GRANT_SCOPE_DENIED"
        );
        assert_eq!(denied["attribution"], projection["attribution"]);

        let wrong_class = router
            .clone()
            .oneshot(request("/query/allowed", &agent_credential))
            .await
            .unwrap();
        assert_eq!(wrong_class.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(wrong_class).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
        );

        let retained = router
            .clone()
            .oneshot(request("/query/allowed/authorized-lease", &token))
            .await
            .unwrap();
        assert_eq!(retained.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(retained).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
        );

        with_snapback(&state.snapback, |snapback| {
            snapback.auth_database_mut().with_auth_transaction(|tx| {
                tx.execute(
                    "UPDATE _auth_scope_bases
                     SET generation = generation + 1, present = 0
                     WHERE function_id = 'fn:allowed' AND kind = 'query'",
                    [],
                )?;
                Ok(())
            })
        })
        .await
        .unwrap();
        let stale = router
            .clone()
            .oneshot(request("/query/allowed", &token))
            .await
            .unwrap();
        assert_eq!(stale.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            response_json(stale).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_GRANT_SCOPE_DENIED"
        );

        let mut hosted = state;
        Arc::make_mut(&mut hosted.server).auth_deployment =
            crate::auth::deployment::AuthDeploymentTarget::Hosted;
        let hosted_router = super::router_from_registrations(
            vec![super::RegisteredRoute::new(
                super::app_function_route("POST", "/query/{name}"),
                axum::routing::post(prepare_query),
            )],
            hosted.clone(),
        )
        .with_state(hosted);
        let hosted = hosted_router
            .oneshot(request("/query/allowed", &token))
            .await
            .unwrap();
        assert_eq!(
            response_json(hosted).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED"
        );
    }

    async fn request_captured_challenge(router: &SnapbackApp, email: &str) -> String {
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

    /// @ref LLP 0057#routes-operations-and-dtos — the HTTP projection enforces the
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

    /// @ref LLP 0057#email-code-provider — exercise the real request transaction,
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

    /// @ref LLP 0057#catalog-write-and-lifecycle-rules — the dedicated reset holds
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

    /// @ref LLP 0057#concurrency-locks-and-linearization — the multiplexed reset
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
        let router = app(AppState::from_snapback(snapback, bound_loopback_context())
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

    /// @ref LLP 0057#rotation — the registered provider routes pin the exact
    /// bearer, body, status, and credential projection through the shared
    /// SessionAuth gate.
    #[tokio::test]
    async fn auth_refresh_and_logout_routes_enforce_exact_carriers_and_statuses() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let state = activate_test_sessions(state);
        let initial = mint_test_credential(&state, "refresh@example.com").await;
        let initial_token = initial["token"].as_str().unwrap().to_owned();
        let router = app(state);

        let refreshed = router
            .clone()
            .oneshot(session_auth_http_request(
                "/auth/refresh",
                br#"{}"#.to_vec(),
                &initial_token,
            ))
            .await
            .expect("refresh current bearer");
        let refreshed_status = refreshed.status();
        let refreshed = response_json(refreshed).await;
        assert_eq!(refreshed_status, StatusCode::OK, "{refreshed}");
        assert_eq!(
            refreshed
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "authorityDescriptor".to_owned(),
                "refreshAfter".to_owned(),
                "session".to_owned(),
                "token".to_owned(),
                "tokenType".to_owned(),
            ])
        );
        assert_eq!(refreshed["authorityDescriptor"]["descriptorVersion"], 1);
        assert_eq!(
            refreshed["authorityDescriptor"]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "authorityInstanceId".to_owned(),
                "descriptorVersion".to_owned(),
                "sessionGeneration".to_owned(),
            ])
        );
        assert_eq!(refreshed["tokenType"], "Bearer");
        let current_token = refreshed["token"].as_str().unwrap().to_owned();
        assert_ne!(current_token, initial_token);

        let superseded = router
            .clone()
            .oneshot(session_auth_http_request(
                "/auth/refresh",
                br#"{}"#.to_vec(),
                &initial_token,
            ))
            .await
            .expect("in-grace predecessor response");
        assert_eq!(superseded.status(), StatusCode::CONFLICT);
        assert_eq!(
            response_json(superseded).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_REFRESH_SUPERSEDED"
        );

        let mut duplicate =
            auth_http_request("POST", "/auth/refresh", br#"{}"#.to_vec(), true, None, None);
        offer_auth_client_protocol(&mut duplicate);
        duplicate.headers_mut().append(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {current_token}")).unwrap(),
        );
        duplicate.headers_mut().append(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {current_token}")).unwrap(),
        );
        let mut missing =
            auth_http_request("POST", "/auth/refresh", br#"{}"#.to_vec(), true, None, None);
        offer_auth_client_protocol(&mut missing);
        let malformed = {
            let mut request =
                auth_http_request("POST", "/auth/refresh", br#"{}"#.to_vec(), true, None, None);
            offer_auth_client_protocol(&mut request);
            request.headers_mut().insert(
                header::AUTHORIZATION,
                HeaderValue::from_static("Basic not-a-bearer"),
            );
            request
        };
        for request in [missing, malformed, duplicate] {
            let response = router
                .clone()
                .oneshot(request)
                .await
                .expect("invalid bearer response");
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(
                response_json(response).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_REQUIRED"
            );
        }

        let body_alias = router
            .clone()
            .oneshot(session_auth_http_request(
                "/auth/logout",
                br#"{"token":"body-alias"}"#.to_vec(),
                &current_token,
            ))
            .await
            .expect("closed logout body response");
        assert_eq!(body_alias.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response_json(body_alias).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_REQUEST_INVALID"
        );

        let logout = router
            .clone()
            .oneshot(session_auth_http_request(
                "/auth/logout",
                br#"{}"#.to_vec(),
                &current_token,
            ))
            .await
            .expect("logout current bearer");
        assert_eq!(logout.status(), StatusCode::NO_CONTENT);
        let repeated = router
            .oneshot(session_auth_http_request(
                "/auth/logout",
                br#"{}"#.to_vec(),
                &current_token,
            ))
            .await
            .expect("repeated logout response");
        assert_eq!(repeated.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(repeated).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_SESSION_EXPIRED"
        );
    }

    #[tokio::test]
    async fn agent_token_route_accepts_exactly_one_target_and_returns_complete_receipts() {
        let state = sessions_activation_server_fixture_async().await;
        let provider = state.auth_provider.clone().unwrap();
        let now_ms = provider.now_ms();
        let credential = with_snapback(&state.snapback, move |snapback| {
            let db = snapback.auth_database_mut();
            db.with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(
                       id, created_at_ms, kind, display_name, operator_contact,
                       registration_provenance, deactivated_at_ms, owner_user_id
                     ) VALUES('grant-user', ?1, 'human', NULL, NULL, NULL, NULL, NULL)",
                    rusqlite::params![now_ms as i64],
                )?;
                Ok(())
            })?;
            db.create_agent_principal(
                "route-agent",
                now_ms,
                &crate::storage::auth_agents::AgentRegistration {
                    display_name: Some("Route Agent".to_owned()),
                    operator_contact: None,
                    registration_provenance: "route-test".to_owned(),
                    owner_user_id: Some("grant-user".to_owned()),
                },
            )?;
            let issued = db.issue_initial_agent_credential(
                "route-agent",
                now_ms,
                provider.agent_random_source(),
            )?;
            db.with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_grants(
                       id, actor_user_id, effective_user_id, scopes, created_at_ms,
                       expires_at_ms, revoked_at_ms, created_by, request_id,
                       consent_digest, last_used_at_ms
                     ) VALUES('route-grant', 'route-agent', 'grant-user', ?1, ?2, ?3,
                              NULL, 'test', 'route-pairing', NULL, ?2)",
                    rusqlite::params![
                        r#"[{"fn":"fn:listItems","kind":"query","basis":0,"authorityCreating":false}]"#,
                        now_ms as i64,
                        (now_ms + 60_000) as i64,
                    ],
                )?;
                tx.execute(
                    "INSERT INTO _auth_pairing_requests(
                       id, code_hash, minted_by_user_id, agent_user_id,
                       requested_scopes, state, attempts, created_at_ms,
                       expires_at_ms, consumed_at_ms, grant_id
                     ) VALUES('route-pairing', zeroblob(32), 'grant-user', 'route-agent',
                              ?1, 'approved', 0, ?2, ?3, ?2, 'route-grant')",
                    rusqlite::params![
                        r#"[{"fn":"fn:listItems","kind":"query","basis":0,"authorityCreating":false}]"#,
                        now_ms as i64,
                        (now_ms + 60_000) as i64,
                    ],
                )?;
                tx.execute(
                    "INSERT INTO _auth_pairing_requests(
                       id, code_hash, minted_by_user_id, agent_user_id,
                       requested_scopes, state, attempts, created_at_ms,
                       expires_at_ms, consumed_at_ms, grant_id
                     ) VALUES('route-pending',
                              X'0101010101010101010101010101010101010101010101010101010101010101',
                              'grant-user', 'route-agent',
                              ?1, 'pending', 0, ?2, ?3, NULL, NULL)",
                    rusqlite::params![
                        r#"[{"fn":"fn:listItems","kind":"query","basis":0,"authorityCreating":false}]"#,
                        now_ms as i64,
                        (now_ms + 60_000) as i64,
                    ],
                )?;
                Ok(())
            })?;
            Ok::<_, SnapbackError>(issued.secret.expose_secret().to_owned())
        })
        .await
        .unwrap();
        let router = app(state);

        let mut ordinary_request = auth_http_request(
            "POST",
            "/auth/agents/token",
            serde_json::to_vec(&json!({
                "credential": credential,
                "grantId": "route-grant",
            }))
            .unwrap(),
            true,
            None,
            None,
        );
        offer_auth_client_protocol(&mut ordinary_request);
        let ordinary = router
            .clone()
            .oneshot(ordinary_request)
            .await
            .unwrap();
        let ordinary_status = ordinary.status();
        let ordinary = response_json(ordinary).await;
        assert_eq!(ordinary_status, StatusCode::OK, "{ordinary}");
        assert_eq!(ordinary["grantId"], "route-grant");
        assert_eq!(ordinary["grantExpiresAtMs"], now_ms + 60_000);
        assert_eq!(ordinary["scopes"][0]["fn"], "fn:listItems");
        assert!(ordinary["token"].as_str().unwrap().starts_with("sbagt_"));

        let mut pairing_request = auth_http_request(
            "POST",
            "/auth/agents/token",
            serde_json::to_vec(&json!({
                "credential": credential,
                "pairingRequestId": "route-pairing",
            }))
            .unwrap(),
            true,
            None,
            None,
        );
        offer_auth_client_protocol(&mut pairing_request);
        let pairing = router
            .clone()
            .oneshot(pairing_request)
            .await
            .unwrap();
        let pairing_status = pairing.status();
        let pairing = response_json(pairing).await;
        assert_eq!(pairing_status, StatusCode::OK, "{pairing}");
        assert_eq!(pairing["grantId"], "route-grant");
        assert_eq!(pairing["grantExpiresAtMs"], now_ms + 60_000);
        assert_eq!(pairing["scopes"], ordinary["scopes"]);

        let mut pending_request = auth_http_request(
            "POST",
            "/auth/agents/token",
            serde_json::to_vec(&json!({
                "credential": credential,
                "pairingRequestId": "route-pending",
            }))
            .unwrap(),
            true,
            None,
            None,
        );
        offer_auth_client_protocol(&mut pending_request);
        let pending = router
            .clone()
            .oneshot(pending_request)
            .await
            .unwrap();
        assert_eq!(pending.status(), StatusCode::CONFLICT);
        assert_eq!(
            response_json(pending).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_GRANT_PENDING"
        );

        for invalid in [
            json!({"credential": credential}),
            json!({
                "credential": credential,
                "grantId": "route-grant",
                "pairingRequestId": "route-pairing",
            }),
        ] {
            let mut request = auth_http_request(
                "POST",
                "/auth/agents/token",
                serde_json::to_vec(&invalid).unwrap(),
                true,
                None,
                None,
            );
            offer_auth_client_protocol(&mut request);
            let response = router
                .clone()
                .oneshot(request)
                .await
                .unwrap();
            assert_eq!(
                response_json(response).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_REQUEST_INVALID"
            );
        }
    }

    /// @ref LLP 0055#ending-authority-revocation-expiry-deactivation — the
    /// owner bulk endpoint ends every grant to the named actor, is idempotent,
    /// and reveals nothing to a different signed-in user.
    #[tokio::test]
    async fn bulk_grant_revocation_is_owner_scoped_idempotent_and_no_store_over_http() {
        let state = sessions_activation_server_fixture_async().await;
        let owner = mint_test_credential(&state, "bulk-owner@example.com").await;
        let stranger = mint_test_credential(&state, "bulk-stranger@example.com").await;
        let owner_id = owner["session"]["userId"].as_str().unwrap().to_owned();
        let owner_bearer = owner["token"].as_str().unwrap().to_owned();
        let stranger_bearer = stranger["token"].as_str().unwrap().to_owned();
        let provider = state.auth_provider.clone().unwrap();
        let now_ms = provider.now_ms();
        let owner_id_for_setup = owner_id.clone();
        with_snapback(&state.snapback, move |snapback| {
            let db = snapback.auth_database_mut();
            db.create_agent_principal(
                "bulk-route-agent",
                now_ms,
                &crate::storage::auth_agents::AgentRegistration {
                    display_name: Some("Bulk Route Agent".to_owned()),
                    operator_contact: None,
                    registration_provenance: "bulk-route-test".to_owned(),
                    owner_user_id: Some(owner_id_for_setup.clone()),
                },
            )?;
            db.with_auth_transaction(|tx| {
                for (grant_id, request_id) in [
                    ("bulk-route-grant-a", "bulk-route-request-a"),
                    ("bulk-route-grant-b", "bulk-route-request-b"),
                ] {
                    tx.execute(
                        "INSERT INTO _auth_grants(
                           id, actor_user_id, effective_user_id, scopes,
                           created_at_ms, expires_at_ms, revoked_at_ms,
                           created_by, request_id, consent_digest, last_used_at_ms
                         ) VALUES(?1, 'bulk-route-agent', ?2, ?3, ?4, ?5,
                                  NULL, 'test', ?6, NULL, ?4)",
                        rusqlite::params![
                            grant_id,
                            &owner_id_for_setup,
                            r#"[{"fn":"fn:listItems","kind":"query","basis":0,"authorityCreating":false}]"#,
                            now_ms as i64,
                            (now_ms + 60_000) as i64,
                            request_id,
                        ],
                    )?;
                }
                Ok(())
            })
        })
        .await
        .unwrap();
        let router = app(state);

        let request = |method: &'static str, uri: &'static str, bearer: &str| {
            let mut request = auth_http_request(method, uri, Vec::new(), false, None, None);
            offer_auth_client_protocol(&mut request);
            request.headers_mut().insert(
                header::AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {bearer}")).unwrap(),
            );
            request
        };

        let foreign = router
            .clone()
            .oneshot(request(
                "DELETE",
                "/auth/grants/by-actor/bulk-route-agent",
                &stranger_bearer,
            ))
            .await
            .unwrap();
        assert_eq!(foreign.status(), StatusCode::NO_CONTENT);
        assert_eq!(foreign.headers()[header::CACHE_CONTROL], "no-store, private");

        let before = router
            .clone()
            .oneshot(request("GET", "/auth/grants", &owner_bearer))
            .await
            .unwrap();
        let before_status = before.status();
        let before = response_json(before).await;
        assert_eq!(before_status, StatusCode::OK, "{before}");
        assert_eq!(before.as_array().unwrap().len(), 2);
        assert!(
            before
                .as_array()
                .unwrap()
                .iter()
                .all(|grant| grant["revokedAtMs"].is_null()),
            "the foreign caller cannot alter the owner's grants"
        );

        for attempt in 1..=2 {
            let revoked = router
                .clone()
                .oneshot(request(
                    "DELETE",
                    "/auth/grants/by-actor/bulk-route-agent",
                    &owner_bearer,
                ))
                .await
                .unwrap();
            assert_eq!(revoked.status(), StatusCode::NO_CONTENT, "attempt {attempt}");
            assert_eq!(
                revoked.headers()[header::CACHE_CONTROL],
                "no-store, private"
            );
        }

        let after = router
            .oneshot(request("GET", "/auth/grants", &owner_bearer))
            .await
            .unwrap();
        let after = response_json(after).await;
        assert_eq!(after.as_array().unwrap().len(), 2);
        assert!(
            after
                .as_array()
                .unwrap()
                .iter()
                .all(|grant| grant["revokedAtMs"].as_u64().is_some()),
            "the first owner call revokes all grants and the retry is inert"
        );
    }

    /// @ref LLP 0055#re-credentialing-recovery-and-the-production-profile-invariant — authority-creating consent consumes
    /// one operation/target/session-bound proof in the grant transaction;
    /// ordinary consent remains frictionless.
    #[tokio::test]
    async fn grant_step_up_is_domain_separated_target_bound_and_single_effect() {
        let state = sessions_activation_server_fixture_async().await;
        let provider = state.auth_provider.clone().unwrap();
        let credential = mint_test_credential(&state, "step-up@example.com").await;
        let bearer = credential["token"].as_str().unwrap().to_owned();
        let second_credential = mint_test_credential(&state, "step-up@example.com").await;
        let second_bearer = second_credential["token"].as_str().unwrap().to_owned();
        let user_id = credential["session"]["userId"].as_str().unwrap().to_owned();
        let now_ms = provider.now_ms();
        let request_ids = with_snapback(&state.snapback, {
            let provider = provider.clone();
            let user_id = user_id.clone();
            move |snapback| {
                let db = snapback.auth_database_mut();
                db.create_agent_principal(
                    "step-up-agent",
                    now_ms,
                    &crate::storage::auth_agents::AgentRegistration {
                        display_name: Some("Step-up Agent".to_owned()),
                        operator_contact: None,
                        registration_provenance: "step-up-route-test".to_owned(),
                        owner_user_id: Some(user_id.clone()),
                    },
                )?;
                let agent_credential = db
                    .issue_initial_agent_credential(
                        "step-up-agent",
                        now_ms,
                        provider.agent_random_source(),
                    )?
                    .secret;
                db.with_auth_transaction(|tx| {
                    tx.execute(
                        "INSERT INTO _auth_scope_bases(
                           function_id, kind, generation, present, authority_creating
                         ) VALUES
                           ('fn:seatRole', 'mutation', 0, 1, 1),
                           ('fn:listItems', 'query', 0, 1, 0)",
                        [],
                    )?;
                    Ok(())
                })?;

                let mut present = |function_id: &str,
                                   kind: crate::storage::auth_grants::ScopedFunctionKind|
                 -> crate::diagnostic::SnapbackResult<String> {
                    let pairing =
                        db.mint_pairing_code(&user_id, now_ms, provider.agent_random_source())?;
                    db.present_pairing_code(
                        &agent_credential,
                        &pairing.request_id,
                        &pairing.secret,
                        &[crate::storage::auth_grants::GrantScopeRequest::Exact {
                            function_id: function_id.to_owned(),
                            kind,
                        }],
                        now_ms,
                    )?;
                    Ok(pairing.request_id)
                };
                Ok::<_, SnapbackError>((
                    present(
                        "fn:seatRole",
                        crate::storage::auth_grants::ScopedFunctionKind::Mutation,
                    )?,
                    present(
                        "fn:seatRole",
                        crate::storage::auth_grants::ScopedFunctionKind::Mutation,
                    )?,
                    present(
                        "fn:listItems",
                        crate::storage::auth_grants::ScopedFunctionKind::Query,
                    )?,
                ))
            }
        })
        .await
        .unwrap();
        let (bound_request, other_request, ordinary_request) = request_ids;
        let router = app(state.clone());

        let ordinary = router
            .clone()
            .oneshot(session_auth_http_request(
                &format!("/auth/grant-requests/{ordinary_request}/approve"),
                br#"{}"#.to_vec(),
                &bearer,
            ))
            .await
            .unwrap();
        assert_eq!(ordinary.status(), StatusCode::OK);

        let missing = router
            .clone()
            .oneshot(session_auth_http_request(
                &format!("/auth/grant-requests/{bound_request}/approve"),
                br#"{}"#.to_vec(),
                &bearer,
            ))
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(missing).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_STEP_UP_REQUIRED"
        );

        let login_admission = provider.admit_email("step-up@example.com").await.unwrap();
        let login_now_ms = provider.now_ms();
        let login_challenge = with_snapback(&state.snapback, move |snapback| {
            login_admission
                .request_code(snapback.auth_database_mut(), login_now_ms)
                .map(|response| response.challenge_id)
        })
        .await
        .unwrap();
        let login_mailbox =
            serde_json::to_value(provider.mailbox_entry(&login_challenge).await.unwrap()).unwrap();
        let login_code = login_mailbox["code"].as_str().unwrap().to_owned();
        let login_as_step_up = router
            .clone()
            .oneshot(session_auth_http_request(
                &format!("/auth/grant-requests/{bound_request}/approve"),
                serde_json::to_vec(&json!({
                    "stepUp": {"challengeId": login_challenge, "code": login_code}
                }))
                .unwrap(),
                &bearer,
            ))
            .await
            .unwrap();
        assert_eq!(login_as_step_up.status(), StatusCode::UNAUTHORIZED);

        let challenge_response = router
            .clone()
            .oneshot(session_auth_http_request(
                "/auth/step-up/request",
                serde_json::to_vec(&json!({
                    "operation": "grantApproval",
                    "requestId": bound_request,
                }))
                .unwrap(),
                &bearer,
            ))
            .await
            .unwrap();
        assert_eq!(challenge_response.status(), StatusCode::OK);
        assert_eq!(
            challenge_response.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let challenge = response_json(challenge_response).await;
        let challenge_id = challenge["challengeId"].as_str().unwrap().to_owned();
        let expires_at = challenge["expiresAt"].as_u64().unwrap();
        assert!(expires_at >= now_ms + crate::auth::provider::AUTH_STEP_UP_TTL_MS);
        assert!(expires_at <= now_ms + crate::auth::provider::AUTH_STEP_UP_TTL_MS + 1_000);
        let mailbox =
            serde_json::to_value(provider.mailbox_entry(&challenge_id).await.unwrap()).unwrap();
        let code = mailbox["code"].as_str().unwrap().to_owned();

        let substituted = router
            .clone()
            .oneshot(session_auth_http_request(
                &format!("/auth/grant-requests/{other_request}/approve"),
                serde_json::to_vec(&json!({
                    "stepUp": {"challengeId": challenge_id, "code": code}
                }))
                .unwrap(),
                &bearer,
            ))
            .await
            .unwrap();
        assert_eq!(substituted.status(), StatusCode::UNAUTHORIZED);
        let substituted_json = response_json(substituted).await;
        assert_eq!(
            substituted_json["diagnostic"]["code"],
            "SNAPBACK_AUTH_STEP_UP_REQUIRED"
        );
        assert!(!substituted_json.to_string().contains(&code));

        let wrong_session = router
            .clone()
            .oneshot(session_auth_http_request(
                &format!("/auth/grant-requests/{bound_request}/approve"),
                serde_json::to_vec(&json!({
                    "stepUp": {"challengeId": challenge_id, "code": code}
                }))
                .unwrap(),
                &second_bearer,
            ))
            .await
            .unwrap();
        assert_eq!(wrong_session.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(wrong_session).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_STEP_UP_REQUIRED"
        );

        let approval_body = serde_json::to_vec(&json!({
            "stepUp": {"challengeId": challenge_id, "code": code}
        }))
        .unwrap();
        // Simulate a lost SQLite COMMIT acknowledgement after the first
        // concurrent transaction actually commits. Exact request/grant/proof
        // reconciliation must still publish one successful immutable grant.
        crate::storage::auth_grants::inject_next_grant_commit_uncertain(&bound_request);
        let first = router.clone().oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{bound_request}/approve"),
            approval_body.clone(),
            &bearer,
        ));
        let second = router.clone().oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{bound_request}/approve"),
            approval_body,
            &bearer,
        ));
        let (first, second) = tokio::join!(first, second);
        assert_eq!(first.unwrap().status(), StatusCode::OK);
        assert_eq!(second.unwrap().status(), StatusCode::OK);

        let replay_for_other = router
            .clone()
            .oneshot(session_auth_http_request(
                &format!("/auth/grant-requests/{other_request}/approve"),
                serde_json::to_vec(&json!({
                    "stepUp": {"challengeId": challenge_id, "code": code}
                }))
                .unwrap(),
                &bearer,
            ))
            .await
            .unwrap();
        assert_eq!(replay_for_other.status(), StatusCode::UNAUTHORIZED);

        let second_challenge_response = router
            .clone()
            .oneshot(session_auth_http_request(
                "/auth/step-up/request",
                serde_json::to_vec(&json!({
                    "operation": "grantApproval",
                    "requestId": other_request,
                }))
                .unwrap(),
                &bearer,
            ))
            .await
            .unwrap();
        assert_eq!(second_challenge_response.status(), StatusCode::OK);
        let second_challenge = response_json(second_challenge_response).await;
        let second_challenge_id = second_challenge["challengeId"]
            .as_str()
            .unwrap()
            .to_owned();
        let second_mailbox = serde_json::to_value(
            provider
                .mailbox_entry(&second_challenge_id)
                .await
                .unwrap(),
        )
        .unwrap();
        let second_code = second_mailbox["code"].as_str().unwrap().to_owned();
        crate::storage::auth_grants::inject_next_grant_reconciliation_failure(&other_request);
        let unavailable = router
            .clone()
            .oneshot(session_auth_http_request(
                &format!("/auth/grant-requests/{other_request}/approve"),
                serde_json::to_vec(&json!({
                    "stepUp": {
                        "challengeId": second_challenge_id,
                        "code": second_code,
                    }
                }))
                .unwrap(),
                &bearer,
            ))
            .await
            .unwrap();
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(unavailable).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN"
        );
        let reconciled_retry = router
            .clone()
            .oneshot(session_auth_http_request(
                &format!("/auth/grant-requests/{other_request}/approve"),
                br#"{}"#.to_vec(),
                &bearer,
            ))
            .await
            .unwrap();
        assert_eq!(reconciled_retry.status(), StatusCode::OK);

        with_snapback(&state.snapback, move |snapback| {
            snapback.auth_database_mut().with_auth_read(|connection| {
                let grants: i64 = connection.query_row(
                    "SELECT COUNT(*) FROM _auth_grants WHERE request_id = ?1",
                    rusqlite::params![bound_request],
                    |row| row.get(0),
                )?;
                let plaintext_matches: i64 = connection.query_row(
                    "SELECT COUNT(*) FROM _auth_verification_codes
                     WHERE challenge_id = ?1 AND code_digest = CAST(?2 AS BLOB)",
                    rusqlite::params![&challenge_id, &code],
                    |row| row.get(0),
                )?;
                let (attempts, consumed): (i64, bool) = connection.query_row(
                    "SELECT attempts, consumed_at_ms IS NOT NULL
                     FROM _auth_verification_codes WHERE challenge_id = ?1",
                    rusqlite::params![&challenge_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                assert_eq!(grants, 1);
                assert_eq!(plaintext_matches, 0);
                assert_eq!(attempts, 3);
                assert!(consumed);
                Ok::<_, SnapbackError>(())
            })
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn production_step_up_delivery_fails_closed_without_capture() {
        let state = sessions_activation_server_fixture_async().await;
        let credential = mint_test_credential(&state, "prod-step-up@example.com").await;
        let bearer = credential["token"].as_str().unwrap().to_owned();
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(super::now_millis(), &OsRandom)
            .unwrap();
        let provider = Arc::new(AuthProvider::new(AuthProviderProfile::Prod, keyring).unwrap());
        let state = state.with_auth_provider(provider);
        let router = app(state.clone());
        let response = router
            .oneshot(session_auth_http_request(
                "/auth/step-up/request",
                serde_json::to_vec(&json!({
                    "operation": "grantApproval",
                    "requestId": "prod-target",
                }))
                .unwrap(),
                &bearer,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE"
        );
        let challenge_count = with_snapback(&state.snapback, |snapback| {
            snapback.auth_database_mut().with_auth_read(|connection| {
                connection
                    .query_row(
                        "SELECT COUNT(*) FROM _auth_verification_codes
                         WHERE canonical_address = 'prod-step-up@example.com'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(SnapbackError::from)
            })
        })
        .await
        .unwrap();
        assert_eq!(challenge_count, 0);
    }

    /// @ref LLP 0058#gate-algorithm — required provider-route credentials are
    /// resolved before the closed body is parsed; only a valid live bearer may
    /// reach the provider DTO parser.
    #[tokio::test]
    async fn session_auth_credentials_precede_refresh_and_logout_body_errors() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let state = activate_test_sessions(state);
        let credential = mint_test_credential(&state, "precedence@example.com").await;
        let bearer = credential["token"].as_str().unwrap().to_owned();
        let unknown = SessionBearer::generate(&OsRandom)
            .unwrap()
            .expose_secret()
            .to_owned();
        let router = app(state);

        for uri in ["/auth/refresh", "/auth/logout"] {
            let mut missing = auth_http_request(
                "POST",
                uri,
                vec![b'x'; super::AUTH_REQUEST_BODY_LIMIT + 1],
                true,
                None,
                None,
            );
            offer_auth_client_protocol(&mut missing);
            let malformed = {
                let mut request =
                    auth_http_request("POST", uri, br#"{"#.to_vec(), true, None, None);
                offer_auth_client_protocol(&mut request);
                request.headers_mut().insert(
                    header::AUTHORIZATION,
                    HeaderValue::from_static("Basic not-a-bearer"),
                );
                request
            };
            let unknown = session_auth_http_request(uri, br#"{"#.to_vec(), &unknown);
            for request in [missing, malformed, unknown] {
                let response = router
                    .clone()
                    .oneshot(request)
                    .await
                    .expect("credential-precedence response");
                assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
                assert_eq!(
                    response_json(response).await["diagnostic"]["code"],
                    "SNAPBACK_AUTH_REQUIRED"
                );
            }

            let valid = router
                .clone()
                .oneshot(session_auth_http_request(uri, br#"{"#.to_vec(), &bearer))
                .await
                .expect("valid bearer malformed-body response");
            assert_eq!(valid.status(), StatusCode::BAD_REQUEST);
            assert_eq!(
                response_json(valid).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_REQUEST_INVALID"
            );
        }

        let logout = router
            .clone()
            .oneshot(session_auth_http_request(
                "/auth/logout",
                br#"{}"#.to_vec(),
                &bearer,
            ))
            .await
            .expect("terminalize precedence fixture");
        assert_eq!(logout.status(), StatusCode::NO_CONTENT);
        for uri in ["/auth/refresh", "/auth/logout"] {
            let response = router
                .clone()
                .oneshot(session_auth_http_request(uri, br#"{"#.to_vec(), &bearer))
                .await
                .expect("terminal credential precedence response");
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(
                response_json(response).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_SESSION_EXPIRED"
            );
        }
    }

    /// @ref LLP 0059#operation-specific-publication — a refresh may commit its
    /// successor, but a revocation that wins before the finite-response handoff
    /// fences the credential bytes from publication.
    #[tokio::test]
    async fn refresh_credential_response_is_fenced_by_prepublication_revocation() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let state = activate_test_sessions(state);
        let initial = mint_test_credential(&state, "refresh-fence@example.com").await;
        let predecessor = initial["token"].as_str().unwrap().to_owned();
        let refresh_authority =
            prepared_provider_route_authority(&state, InvocationSource::AuthRefresh, &predecessor)
                .0;
        let refreshed = super::auth_refresh(
            State(state.clone()),
            Extension(refresh_authority.clone()),
            auth_provider_headers(Some(&predecessor)),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect("refresh commits before publication pause");
        let successor = refreshed.0.token().expose_secret().to_owned();

        let logout_authority =
            prepared_provider_route_authority(&state, InvocationSource::AuthLogout, &successor).0;
        let logout = super::auth_logout(
            State(state),
            Extension(logout_authority),
            auth_provider_headers(Some(&successor)),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect("revocation wins before refresh response handoff");
        assert_eq!(logout.status(), StatusCode::NO_CONTENT);

        let refresh_policy = super::route_registry()
            .into_iter()
            .find(|spec| spec.path == "/auth/refresh")
            .expect("registered refresh route")
            .effective_for(PolicyAuthMode::Sessions);
        let response = super::finish_registered_response(
            refresh_policy,
            refreshed.into_response(),
            Some(refresh_authority.admission_lease()),
            Some(&refresh_authority),
        );
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = response_json(response).await;
        assert_eq!(body["diagnostic"]["code"], "SNAPBACK_AUTH_SESSION_EXPIRED");
        let serialized = serde_json::to_string(&body).unwrap();
        assert!(!serialized.contains(&predecessor));
        assert!(!serialized.contains(&successor));
    }

    #[tokio::test]
    async fn authorized_durable_http_body_holds_commit_through_final_poll() {
        let state = auth_invalidation_reset_fixture();
        let authorization = state
            .snapback
            .lock()
            .await
            .auth_invalidation_expectation_for_test()
            .expect("installed authorization expectation");
        let envelope = RealtimeEnvelope::Durable(crate::ephemeral::DurableMessage::authorized(
            br#"{"kind":"private_board"}"#.to_vec(),
            authorization.clone(),
        ));
        let permit = state
            .ephemeral
            .begin_final_send(&envelope)
            .expect("current durable publication is admitted")
            .expect("auth-scoped durable publication carries a permit");
        let mut response = Json(vec![envelope]).into_response();
        retain_realtime_authority_in(&mut response, vec![permit]);
        let admission = state
            .auth_admission_controller()
            .admit_for_mode(AuthMode::Sessions)
            .expect("sessions response admission");
        let policy = super::route_registry()
            .into_iter()
            .find(|spec| spec.path == "/outbox/{connection_id}")
            .expect("registered outbox route")
            .effective_for(PolicyAuthMode::Sessions);
        let response = finish_registered_response(policy, response, Some(&admission), None);

        let successor = crate::storage::AuthorizationVersion {
            incarnation: authorization.incarnation,
            epoch: authorization.epoch + 1,
        };
        let (prepared_tx, prepared_rx) = std::sync::mpsc::channel();
        let prepare_ephemeral = state.ephemeral.clone();
        let prepare = std::thread::spawn(move || {
            let ticket = prepare_ephemeral
                .prepare_room_authorization_event_for_test(successor)
                .expect("prepare successor authorization event");
            prepared_tx.send(ticket).unwrap();
        });
        assert!(
            prepared_rx.recv_timeout(Duration::from_millis(20)).is_err(),
            "the HTTP response body must retain the durable publication permit"
        );

        let _body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll response body to its final sink");
        let ticket = prepared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("authorization prepare resumes after the body completes");
        assert!(
            state
                .ephemeral
                .rollback_room_authorization_event_for_test(&ticket)
        );
        prepare.join().expect("prepare thread joins");
    }

    #[tokio::test]
    async fn unpolled_http_batch_is_suppressed_and_requeued_after_authority_mismatch() {
        let state = AppState::detached(LocalSnapback::memory().expect("mismatch HTTP fixture"));
        let opened = state
            .connections
            .open(Some("mismatch-http".to_owned()), None, true)
            .expect("open predecessor grant");
        let act = state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare predecessor HTTP act");
        let response = leased_outbox_http_response(&state, act, b"mismatch-preserved");

        let (replacement_incarnation, replacement_publication) =
            FencedPublication::anonymous_for_unmanaged_dev_connection();
        let mismatch_authority = synthetic_session_bound(
            &replacement_incarnation,
            "mismatch-session",
            "mismatch-user",
            "email-code",
            1,
            u64::MAX,
            replacement_publication,
        );
        let mismatch = state
            .connections
            .open_prepared(ConnectionOpenAttempt::new(
                Some(opened.connection_id.clone()),
                Some(&opened.connection_token),
                true,
                synthetic_connection_authority(mismatch_authority),
                super::now_millis(),
                Instant::now(),
                None,
            ))
            .expect_err("different immutable authority retires the predecessor");
        assert_eq!(
            mismatch.diagnostic.code,
            "SNAPBACK_CONNECTION_AUTHORITY_MISMATCH"
        );

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll retired leased body");
        assert!(body.is_empty(), "retired HTTP ownership publishes no bytes");
        let retry = state.ephemeral.drain_outbox(&opened.connection_id);
        assert!(matches!(
            retry.as_slice(),
            [RealtimeEnvelope::Durable(message)] if message.payload == b"mismatch-preserved"
        ));
    }

    #[tokio::test]
    async fn no_lease_projection_still_revalidates_exact_grant_at_first_poll() {
        let state = AppState::detached(LocalSnapback::memory().expect("direct HTTP fixture"));
        let opened = state
            .connections
            .open(Some("direct-http".to_owned()), None, true)
            .expect("open direct-projection grant");
        let act = state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare direct-projection act");
        let mut response = Json(vec![RealtimeEnvelope::Durable(
            crate::ephemeral::DurableMessage::new(b"direct-projection".to_vec()),
        )])
        .into_response();
        super::retain_realtime_handoff_in(
            &mut response,
            Vec::new(),
            Vec::new(),
            Some(super::RetainedConnectionHandoff {
                connections: state.connections.clone(),
                ephemeral: state.ephemeral.clone(),
                connection_act: act,
                auth_provider: None,
            }),
        );
        let admission = test_route_admission(&state).0;
        let policy = super::route_registry()
            .into_iter()
            .find(|spec| spec.path == "/outbox/{connection_id}")
            .unwrap()
            .effective_for(PolicyAuthMode::Dev);
        let response = finish_registered_response(policy, response, Some(&admission), None);

        let (incarnation, publication) =
            FencedPublication::anonymous_for_unmanaged_dev_connection();
        let mismatch = synthetic_session_bound(
            &incarnation,
            "direct-session",
            "direct-user",
            "email-code",
            1,
            u64::MAX,
            publication,
        );
        state
            .connections
            .open_prepared(ConnectionOpenAttempt::new(
                Some(opened.connection_id),
                Some(&opened.connection_token),
                true,
                synthetic_connection_authority(mismatch),
                super::now_millis(),
                Instant::now(),
                None,
            ))
            .expect_err("mismatch retires no-lease response owner");
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll direct response");
        assert!(body.is_empty());
    }

    #[tokio::test]
    async fn projection_only_http_body_loses_to_marker_installed_after_selection() {
        let state = AppState::detached(LocalSnapback::memory().expect("projection marker fixture"));
        let opened = state
            .connections
            .open(Some("projection-marker-http".to_owned()), None, true)
            .expect("open projection response grant");
        let act = state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare projection response act");
        let fence = act.effect_fence();
        state.ephemeral.touch_connection(&opened.connection_id);
        let mut response = Json(vec![RealtimeEnvelope::Durable(
            crate::ephemeral::DurableMessage::new(b"direct-projection".to_vec()),
        )])
        .into_response();
        super::retain_realtime_handoff_in(
            &mut response,
            Vec::new(),
            Vec::new(),
            Some(super::RetainedConnectionHandoff {
                connections: state.connections.clone(),
                ephemeral: state.ephemeral.clone(),
                connection_act: act,
                auth_provider: None,
            }),
        );
        let admission = test_route_admission(&state).0;
        let policy = super::route_registry()
            .into_iter()
            .find(|spec| spec.path == "/outbox/{connection_id}")
            .unwrap()
            .effective_for(PolicyAuthMode::Dev);
        let response = finish_registered_response(policy, response, Some(&admission), None);

        state
            .ephemeral
            .overflow_outbox_for_test(&opened.connection_id, Some(fence.clone()));
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll projection response after marker installation");
        assert!(
            body.is_empty(),
            "projection cannot overtake recovery marker"
        );

        let retry = state
            .ephemeral
            .drain_outbox_for_send_bound_if_active(&opened.connection_id, &fence)
            .expect("connection activity remains live");
        assert_eq!(retry.len(), 1);
        assert!(retry[0].is_recovery_marker());
    }

    #[tokio::test]
    async fn http_unbound_ordinary_lease_loses_to_later_exact_marker() {
        let state = AppState::detached(LocalSnapback::memory().expect("HTTP marker fixture"));
        let opened = state
            .connections
            .open(Some("unbound-exact-marker-http".to_owned()), None, true)
            .expect("open HTTP response grant");
        let act = state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare HTTP response act");
        let fence = act.effect_fence();
        let response = leased_outbox_http_response(&state, act, b"unbound-ordinary");
        state
            .ephemeral
            .overflow_outbox_for_test(&opened.connection_id, Some(fence.clone()));

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll ordinary response after exact overflow");
        assert!(
            body.is_empty(),
            "ordinary bytes cannot overtake exact recovery"
        );
        let retry = state
            .ephemeral
            .drain_outbox_for_send_bound_if_active(&opened.connection_id, &fence)
            .expect("connection activity remains live");
        assert_eq!(retry.len(), 1);
        assert!(retry[0].is_recovery_marker());
    }

    #[tokio::test]
    async fn http_exact_ordinary_lease_loses_to_later_unbound_marker() {
        let state = AppState::detached(LocalSnapback::memory().expect("HTTP marker fixture"));
        let opened = state
            .connections
            .open(Some("exact-unbound-marker-http".to_owned()), None, true)
            .expect("open HTTP response grant");
        let act = state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare HTTP response act");
        let fence = act.effect_fence();
        let response = leased_bound_outbox_http_response(&state, act, b"exact-ordinary");
        state
            .ephemeral
            .overflow_outbox_for_test(&opened.connection_id, None);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll ordinary response after global overflow");
        assert!(
            body.is_empty(),
            "ordinary bytes cannot overtake global recovery"
        );
        let retry = state
            .ephemeral
            .drain_outbox_for_send_bound_if_active(&opened.connection_id, &fence)
            .expect("connection activity remains live");
        assert_eq!(retry.len(), 1);
        assert!(retry[0].is_recovery_marker());
    }

    #[tokio::test]
    async fn http_exact_marker_lease_loses_to_later_unbound_marker() {
        let state = AppState::detached(LocalSnapback::memory().expect("HTTP marker rank fixture"));
        let opened = state
            .connections
            .open(Some("exact-marker-rank-http".to_owned()), None, true)
            .expect("open HTTP response grant");
        let act = state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare HTTP response act");
        let fence = act.effect_fence();
        state
            .ephemeral
            .overflow_outbox_for_test(&opened.connection_id, Some(fence.clone()));
        let response = leased_queued_outbox_http_response(&state, act);
        state
            .ephemeral
            .overflow_outbox_for_test(&opened.connection_id, None);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll exact marker response after global overflow");
        assert!(
            body.is_empty(),
            "a selected exact marker cannot overtake broader recovery"
        );
        let retry = state
            .ephemeral
            .drain_outbox_for_send_bound_if_active(&opened.connection_id, &fence)
            .expect("connection activity remains live");
        assert_eq!(retry.len(), 1);
        let RealtimeEnvelope::Durable(marker) = retry[0].envelope() else {
            panic!("expected global durable recovery marker");
        };
        let marker = serde_json::from_slice::<Value>(&marker.payload).expect("marker JSON");
        assert_eq!(marker["kind"], "resync_required");
    }

    #[tokio::test]
    async fn websocket_projection_offer_loses_to_marker_installed_after_selection() {
        let state = AppState::detached(LocalSnapback::memory().expect("WS marker fixture"));
        let opened = state
            .connections
            .open(Some("projection-marker-ws".to_owned()), None, true)
            .expect("open WS projection grant");
        let act = state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare WS projection act");
        let fence = act.effect_fence();
        state.ephemeral.touch_connection(&opened.connection_id);
        let notifier = state.ephemeral.delivery_notifier();
        let (generation, _waker) = notifier
            .register_bound(&opened.connection_id, act.grant_id.clone())
            .expect("register exact WS projection owner");
        // Projection computation/selection happened before this point. The
        // final writer offer must still observe this newly installed marker.
        state
            .ephemeral
            .overflow_outbox_for_test(&opened.connection_id, Some(fence.clone()));
        let admission = test_route_admission(&state).0;
        let (writer, mut writes) = tokio::sync::mpsc::channel(1);
        let outcome = super::send_live_with_admission(
            super::LiveHandoffCut {
                writer: &writer,
                notify: &notifier,
                connection_id: &opened.connection_id,
                generation,
                connections: &state.connections,
                connection_act: &act,
            },
            super::Message::Text("direct-projection".into()),
            &admission,
            None,
            None,
            Some(&state.ephemeral),
        )
        .await;
        assert_eq!(outcome, super::LiveHandoffOutcome::Superseded);
        assert!(
            writes.try_recv().is_err(),
            "projection never crosses the bounded writer cut"
        );
        let retry = state
            .ephemeral
            .drain_outbox_for_send_bound_if_active(&opened.connection_id, &fence)
            .expect("connection activity remains live");
        assert_eq!(retry.len(), 1);
        assert!(retry[0].is_recovery_marker());
    }

    #[test]
    fn websocket_selected_marker_defers_precomputed_projections_and_emits_alone() {
        let state = AppState::detached(LocalSnapback::memory().expect("WS marker-alone fixture"));
        let opened = state
            .connections
            .open(Some("marker-alone-ws".to_owned()), None, true)
            .expect("open WS marker owner");
        let act = state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare WS marker owner");
        state.ephemeral.touch_connection(&opened.connection_id);
        state
            .ephemeral
            .overflow_outbox_for_test(&opened.connection_id, Some(act.effect_fence()));
        let messages = state
            .ephemeral
            .drain_outbox_for_send_bound_if_active(&opened.connection_id, &act.effect_fence())
            .expect("active WS marker drain");
        let mut projections = vec![crate::ephemeral::DurableMessage::new(
            b"precomputed-projection".to_vec(),
        )];

        super::defer_ws_projections_for_recovery_marker(&mut projections, &messages);
        assert!(projections.is_empty());
        assert_eq!(messages.len(), 1);
        assert!(messages[0].is_recovery_marker());
    }

    #[tokio::test]
    async fn oversized_http_projection_returns_503_before_outbox_lease_and_stays_pending() {
        let connection_id = "oversized-projection-http";
        let state = auth_projection_http_fixture(connection_id, 1, 0)
            .with_projection_handoff_limit_for_test(1_000);
        let credential = mint_test_credential(&state, "oversized-projection@example.com").await;
        let bearer = credential["token"].as_str().expect("credential token");
        let (_opened, act) =
            prepare_invalidation_session_connection_act(&state, bearer, connection_id);
        state.ephemeral.touch_connection(connection_id);
        state.ephemeral.enqueue_durable_bound_for_test(
            connection_id,
            b"ordinary-after-projection-error".to_vec(),
            act.effect_fence(),
        );

        let error = direct_outbox_http_response(&state, &act)
            .await
            .expect_err("unsplittable server projection must fail closed");
        assert_eq!(
            error.0.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
        assert_eq!(
            error.into_response().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        let queued = state
            .ephemeral
            .drain_outbox_for_send_bound_if_active(connection_id, &act.effect_fence())
            .expect("connection activity remains live");
        assert!(queued.iter().any(|admitted| {
            matches!(
                admitted.envelope(),
                RealtimeEnvelope::Durable(message)
                    if message.payload == b"ordinary-after-projection-error"
            )
        }));
        drop(queued);
        let repeated = direct_outbox_http_response(&state, &act)
            .await
            .expect_err("failed projection obligation remains pending");
        assert_eq!(
            repeated.0.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
    }

    #[tokio::test]
    async fn leased_marker_suppresses_http_projection_then_marker_emits_alone_before_retry() {
        let connection_id = "leased-marker-projection-http";
        let state = auth_projection_http_fixture(connection_id, 1, 0);
        let credential = mint_test_credential(&state, "marker-projection@example.com").await;
        let bearer = credential["token"].as_str().expect("credential token");
        let (_opened, act) =
            prepare_invalidation_session_connection_act(&state, bearer, connection_id);
        state.ephemeral.touch_connection(connection_id);
        state
            .ephemeral
            .overflow_outbox_for_test(connection_id, Some(act.effect_fence()));
        let leased_marker = state
            .ephemeral
            .drain_outbox_for_send_bound_if_active(connection_id, &act.effect_fence())
            .expect("active marker lease");
        assert_eq!(leased_marker.len(), 1);
        assert!(leased_marker[0].is_recovery_marker());

        let suppressed = direct_outbox_http_response(&state, &act)
            .await
            .expect("leased marker suppresses handler projections");
        let suppressed = to_bytes(suppressed.into_body(), usize::MAX)
            .await
            .expect("poll suppressed projection body");
        assert!(
            suppressed.is_empty(),
            "another response's leased marker remains the publication owner"
        );
        for marker in leased_marker {
            marker.release_handoff();
        }

        let marker_response = direct_outbox_http_response(&state, &act)
            .await
            .expect("retry selects recovery marker");
        let marker_response = to_bytes(marker_response.into_body(), usize::MAX)
            .await
            .expect("poll recovery marker body");
        let marker_response = serde_json::from_slice::<Vec<RealtimeEnvelope>>(&marker_response)
            .expect("marker response JSON");
        assert_eq!(marker_response.len(), 1, "marker is emitted alone");
        let RealtimeEnvelope::Durable(marker) = &marker_response[0] else {
            panic!("expected durable recovery marker");
        };
        let marker = serde_json::from_slice::<Value>(&marker.payload).expect("marker payload");
        assert_eq!(marker["kind"], "resync_required");

        let projection_response = direct_outbox_http_response(&state, &act)
            .await
            .expect("post-marker poll regenerates pending projection");
        let projection_response = to_bytes(projection_response.into_body(), usize::MAX)
            .await
            .expect("poll regenerated projection body");
        let projection_response =
            serde_json::from_slice::<Vec<RealtimeEnvelope>>(&projection_response)
                .expect("projection response JSON");
        assert!(projection_response.iter().any(|envelope| {
            let RealtimeEnvelope::Durable(message) = envelope else {
                return false;
            };
            serde_json::from_slice::<Value>(&message.payload)
                .is_ok_and(|payload| payload["kind"] == "authorization_invalidation")
        }));
    }

    #[tokio::test]
    async fn cancelled_mode_root_releases_http_batch_at_eof_while_body_is_retained() {
        use http_body::Body as _;

        let state = AppState::detached(LocalSnapback::memory().expect("cancelled HTTP fixture"));
        let opened = state
            .connections
            .open(Some("cancelled-http".to_owned()), None, true)
            .expect("open cancelled-response grant");
        let act = state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare cancelled-response act");
        let response = leased_outbox_http_response(&state, act, b"cancelled-preserved");
        state
            .auth_admission_controller()
            .retire_current_epoch_for_test()
            .expect_err("retirement cancels the retained response root at zero timeout");

        let mut body = response.into_body();
        let first =
            std::future::poll_fn(|context| std::pin::Pin::new(&mut body).poll_frame(context)).await;
        assert!(first.is_none(), "cancelled root exposes EOF without bytes");
        assert!(
            body.is_end_stream(),
            "the latched authority failure is a terminal body state"
        );
        let retry = state.ephemeral.drain_outbox(&opened.connection_id);
        assert!(matches!(
            retry.as_slice(),
            [RealtimeEnvelope::Durable(message)] if message.payload == b"cancelled-preserved"
        ));
        drop(body);
    }

    #[tokio::test]
    async fn unpolled_http_batch_is_suppressed_and_requeued_after_pressure_eviction() {
        let state = AppState::detached(LocalSnapback::memory().expect("pressure HTTP fixture"));
        let opened = state
            .connections
            .open(Some("pressure-http".to_owned()), None, true)
            .expect("open pressure victim");
        let act = state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare pressure-victim HTTP act");
        let response = leased_outbox_http_response(&state, act, b"pressure-preserved");

        for index in 0..(MAX_CONNECTION_GRANTS - 1) {
            state
                .connections
                .open(Some(format!("pressure_http_{index}")), None, true)
                .expect("fill bounded connection registry");
        }
        {
            let mut grants = state.connections.lock();
            let ids = grants.grants.keys().cloned().collect::<Vec<_>>();
            grants.unused.clear();
            grants.used.clear();
            for id in ids {
                let last_use_ms = u64::from(id != opened.connection_id);
                let record = grants.grants.get_mut(&id).expect("grant record");
                record.used = true;
                record.last_use_ms = last_use_ms;
                grants.used.insert((last_use_ms, id));
            }
        }
        state
            .connections
            .open(Some("after-http-pressure".to_owned()), None, true)
            .expect("idle pressure victim makes bounded room");
        assert!(
            state
                .connections
                .verify(&opened.connection_id, Some(&opened.connection_token))
                .is_err(),
            "the response owner is the pressure victim"
        );

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll pressure-retired leased body");
        assert!(
            body.is_empty(),
            "pressure-retired HTTP ownership publishes no bytes"
        );
        let retry = state.ephemeral.drain_outbox(&opened.connection_id);
        assert!(matches!(
            retry.as_slice(),
            [RealtimeEnvelope::Durable(message)] if message.payload == b"pressure-preserved"
        ));
    }

    #[tokio::test]
    async fn first_http_poll_uses_provider_clock_and_cannot_ack_expired_session_leaf() {
        let start_ms = 1_000_000;
        let (state, clock) = manual_clock_sessions_fixture(start_ms);
        let credential = mint_test_credential(&state, "leased-expiry@example.com").await;
        let bearer = credential["token"].as_str().expect("session bearer");
        let (opened, act) = prepare_session_connection_act(&state, bearer, "leased-expiry");
        let deadline_ms = match &act.bound {
            BoundGrantAuthority::Session { deadline_ms, .. } => *deadline_ms,
            BoundGrantAuthority::Anonymous { .. }
            | BoundGrantAuthority::ServicePrincipal { .. } => {
                panic!("expected session-bound act")
            }
        };
        let response = leased_outbox_http_response(&state, act, b"expiry-preserved");

        clock.set(deadline_ms.saturating_add(1));
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll fake-clock-expired leased body");
        assert!(
            body.is_empty(),
            "expired leaf cannot expose or acknowledge bytes"
        );
        let retry = state.ephemeral.drain_outbox(&opened.grant.connection_id);
        assert!(matches!(
            retry.as_slice(),
            [RealtimeEnvelope::Durable(message)] if message.payload == b"expiry-preserved"
        ));
    }

    #[tokio::test]
    async fn finalized_revocation_between_http_selection_and_first_poll_suppresses_batch() {
        let (state, _clock) = manual_clock_sessions_fixture(2_000_000);
        let credential = mint_test_credential(&state, "leased-revoke@example.com").await;
        let bearer = credential["token"].as_str().expect("session bearer");
        let (opened, act) = prepare_session_connection_act(&state, bearer, "leased-revoke");
        let (incarnation, session_id, generation) = match &act.bound {
            BoundGrantAuthority::Session {
                authorization_stream_incarnation,
                session_id,
                generation,
                ..
            } => (
                authorization_stream_incarnation.clone(),
                session_id.clone(),
                *generation,
            ),
            BoundGrantAuthority::Anonymous { .. }
            | BoundGrantAuthority::ServicePrincipal { .. } => {
                panic!("expected session-bound act")
            }
        };
        let response = leased_outbox_http_response(&state, act, b"revoke-preserved");

        state.auth_terminal_lifecycle.terminate_session_generation(
            &incarnation,
            &session_id,
            generation,
            crate::live_wire::LiveAuthErrorReason::Revoked,
            Instant::now() + Duration::from_secs(5),
        );
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll revoked leased HTTP body");
        assert!(body.is_empty(), "revoked grant cannot publish or ack bytes");
        let retry = state.ephemeral.drain_outbox(&opened.grant.connection_id);
        assert!(matches!(
            retry.as_slice(),
            [RealtimeEnvelope::Durable(message)] if message.payload == b"revoke-preserved"
        ));
    }

    #[tokio::test]
    async fn committed_reset_between_http_selection_and_first_poll_suppresses_batch() {
        let (state, _clock) = manual_clock_sessions_fixture(3_000_000);
        let credential = mint_test_credential(&state, "leased-reset@example.com").await;
        let bearer = credential["token"].as_str().expect("session bearer");
        let (opened, act) = prepare_session_connection_act(&state, bearer, "leased-reset");
        let response = leased_outbox_http_response(&state, act, b"reset-preserved");

        state.auth_terminal_lifecycle.committed_stream_reset(
            crate::live_wire::LiveAuthErrorReason::Reset,
            Instant::now() + Duration::from_secs(5),
        );
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll reset leased HTTP body");
        assert!(body.is_empty(), "reset grant cannot publish or ack bytes");
        let retry = state.ephemeral.drain_outbox(&opened.grant.connection_id);
        assert!(matches!(
            retry.as_slice(),
            [RealtimeEnvelope::Durable(message)] if message.payload == b"reset-preserved"
        ));
    }

    #[tokio::test]
    async fn coalescing_replacement_between_http_selection_and_first_poll_retries_latest() {
        let state = AppState::detached(LocalSnapback::memory().expect("coalesce HTTP fixture"));
        let opened = state
            .connections
            .open(Some("coalesce-http".to_owned()), None, true)
            .expect("open coalesce grant");
        let act = state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare coalesce HTTP act");
        let upsert = |value: &[u8], entry_version| crate::ephemeral::EphemeralMessage::Upsert {
            room: crate::ephemeral::RoomId {
                collection: "cursors".to_owned(),
                scope: crate::ephemeral::Scope::default(),
                routing_key: "room".to_owned(),
            },
            room_authority_generation: 0,
            entry: crate::ephemeral::EphemeralEntry {
                key: crate::ephemeral::EntryKey("cursor".to_owned()),
                value: value.to_vec(),
                received_at_ms: 1,
                expires_at_ms: 10_000,
                scope_epoch: 1,
                entry_version,
            },
        };
        state
            .ephemeral
            .enqueue_ephemeral_for_test(&opened.connection_id, upsert(b"old", 1), None);
        let response = leased_queued_outbox_http_response(&state, act.clone());
        state
            .ephemeral
            .enqueue_ephemeral_for_test(&opened.connection_id, upsert(b"new", 2), None);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("poll superseded coalesced HTTP body");
        assert!(
            body.is_empty(),
            "superseded lease cannot acknowledge old state"
        );
        let retry = state
            .ephemeral
            .drain_outbox_for_send_bound_if_active(&opened.connection_id, &act.effect_fence())
            .expect("connection activity remains live");
        assert_eq!(retry.len(), 1);
        assert!(matches!(
            retry[0].envelope(),
            RealtimeEnvelope::Ephemeral(crate::ephemeral::EphemeralMessage::Upsert {
                entry,
                ..
            }) if entry.value == b"new" && entry.entry_version == 2
        ));
    }

    #[test]
    fn prepared_handoff_linearizes_before_concurrent_mismatch_retirement() {
        use std::sync::mpsc;

        let registry = ConnectionRegistry::default();
        let (incarnation, publication) =
            FencedPublication::anonymous_for_unmanaged_dev_connection();
        let opened = registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some("paused-handoff".to_owned()),
                None,
                true,
                synthetic_connection_authority(BoundGrantAuthority::Anonymous {
                    authorization_stream_incarnation: incarnation,
                    publication,
                }),
                1,
                Instant::now(),
                None,
            ))
            .expect("open handoff grant");
        let act = registry
            .prepare_act(
                &opened.grant.connection_id,
                Some(&opened.grant.connection_token),
                None,
                true,
                2,
                Instant::now(),
            )
            .expect("prepare handoff act");
        let sink_registry = registry.clone();
        let (capture_tx, capture_rx) = mpsc::channel();
        registry.install_retirement_sink(move |capture| {
            assert!(
                sink_registry.grants.try_lock().is_ok(),
                "retirement sink runs after the registry guard is released"
            );
            capture_tx.send(capture).unwrap();
        });

        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let act_registry = registry.clone();
        let handoff = std::thread::spawn(move || {
            act.try_act(&act_registry, 2, Instant::now(), || {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
        });
        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("handoff pauses after exact grant validation");

        let (mismatch_incarnation, mismatch_publication) =
            FencedPublication::anonymous_for_unmanaged_dev_connection();
        let retirement_registry = registry.clone();
        let retirement_connection_id = opened.grant.connection_id.clone();
        let retirement_connection_token = opened.grant.connection_token.clone();
        let (retired_tx, retired_rx) = mpsc::channel();
        let retirement = std::thread::spawn(move || {
            let mismatch_authority = synthetic_session_bound(
                &mismatch_incarnation,
                "paused-session",
                "paused-user",
                "email-code",
                1,
                u64::MAX,
                mismatch_publication,
            );
            let result = retirement_registry.open_prepared(ConnectionOpenAttempt::new(
                Some(retirement_connection_id),
                Some(&retirement_connection_token),
                true,
                synthetic_connection_authority(mismatch_authority),
                3,
                Instant::now(),
                None,
            ));
            retired_tx.send(result.map(|_| ())).unwrap();
        });
        assert!(
            retired_rx.recv_timeout(Duration::from_millis(30)).is_err(),
            "mismatch retirement waits while the bounded handoff owns the registry cut"
        );
        release_tx.send(()).unwrap();
        handoff
            .join()
            .expect("handoff thread joins")
            .expect("validated handoff wins before retirement");
        let retired = retired_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("retirement completes after handoff")
            .expect_err("mismatch still rejects reuse");
        assert_eq!(
            retired.diagnostic.code,
            "SNAPBACK_CONNECTION_AUTHORITY_MISMATCH"
        );
        let capture = capture_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("mismatch publishes the exact retirement capture");
        assert_eq!(capture.connection_id, opened.grant.connection_id);
        assert_eq!(capture.grant_id, opened.grant_id);
        retirement.join().expect("retirement thread joins");
    }

    /// @ref LLP 0059#plan-begin-commit-finalize — a known logout commit must
    /// propagate terminal authority loss even when projection Finalize fails;
    /// the original projection diagnostic remains the request outcome.
    #[tokio::test]
    async fn postcommit_logout_finalize_failure_still_terminalizes_exact_grant() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let state = activate_test_sessions(state);
        let credential = mint_test_credential(&state, "logout-finalize@example.com").await;
        let bearer = credential["token"].as_str().expect("logout bearer");
        let session_id = credential["session"]["id"]
            .as_str()
            .expect("logout session id")
            .to_owned();
        let generation = credential["authorityDescriptor"]["sessionGeneration"]
            .as_u64()
            .expect("logout session generation");
        let incarnation = state
            .auth_coordinator
            .as_ref()
            .expect("logout coordinator")
            .authorization_stream_incarnation()
            .expect("logout incarnation");
        let (connection_id, registration_generation, waker) =
            open_registered_session_connection(&state, bearer, "logout-finalize");
        let authority =
            prepared_provider_route_authority(&state, InvocationSource::AuthLogout, bearer);
        let coordinator = state.auth_coordinator.clone().expect("logout coordinator");
        coordinator.inject_finalize_failure();

        let error = super::auth_logout(
            State(state.clone()),
            authority,
            auth_provider_headers(Some(bearer)),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect_err("injected logout projection finalize failure");
        assert_eq!(
            error.0.diagnostic.code, "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "terminal propagation must not mask the projection diagnostic"
        );
        assert!(coordinator.requires_rebuild(&session_id).unwrap());
        assert_revocation_terminalized(
            &state,
            &connection_id,
            registration_generation,
            waker.as_ref(),
        )
        .await;

        state.auth_terminal_lifecycle.terminate_session_generation(
            &incarnation,
            &session_id,
            generation,
            crate::live_wire::LiveAuthErrorReason::Revoked,
            Instant::now() + crate::auth::session_projection::TERMINAL_CLOSE_GRACE,
        );
        assert!(
            state
                .ephemeral
                .delivery_notifier()
                .terminal_if_current(&connection_id, registration_generation)
                .is_some(),
            "duplicate propagation is idempotent and preserves the first terminal event"
        );
    }

    /// Admin/host minting shares this coordinator path. The twenty-first
    /// committed session must terminalize the evicted predecessor even when
    /// successor projection finalization fails and globally closes admission.
    ///
    /// @ref LLP 0059#operation-specific-publication — cap eviction propagates
    /// the exact predecessor terminal event after its joint durable commit.
    #[tokio::test]
    async fn postcommit_admin_mint_cap_finalize_failure_still_terminalizes_eviction() {
        let start_ms = super::now_millis();
        let clock = Arc::new(ManualServerAuthClock::new(start_ms));
        let mut snapback = LocalSnapback::memory().expect("manual-clock cap fixture");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            start_ms,
            &OsRandom,
        )
        .expect("activate cap auth catalog");
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                keyring,
                Arc::new(OsRandom),
                clock.clone(),
            )
            .expect("construct manual-clock cap provider"),
        );
        let mut context = bound_loopback_context();
        context.profile = ServerProfile::Test;
        let state = activate_test_sessions(
            AppState::from_snapback(snapback, context)
                .with_policy_auth_mode(PolicyAuthMode::Sessions)
                .with_auth_provider(provider.clone()),
        );
        let email = "admin-cap-finalize@example.com";
        let first = mint_test_credential(&state, email).await;
        for offset in 1..crate::auth::provider::AUTH_SESSION_LIVE_LIMIT {
            clock.set(start_ms + u64::try_from(offset).unwrap());
            let _ = mint_test_credential(&state, email).await;
        }
        let first_bearer = first["token"].as_str().expect("oldest cap bearer");
        let (connection_id, registration_generation, waker) =
            open_registered_session_connection(&state, first_bearer, "admin-cap-finalize");
        let coordinator = state.auth_coordinator.clone().expect("cap coordinator");
        coordinator.inject_finalize_failure();
        clock
            .set(start_ms + u64::try_from(crate::auth::provider::AUTH_SESSION_LIVE_LIMIT).unwrap());
        let admission = provider.admit_email(email).await.expect("admit cap email");
        let route_admission = test_route_admission(&state).0;

        let error = super::coordinated_mint_session(&state, &provider, admission, &route_admission)
            .await
            .expect_err("injected postcommit issuance finalize failure");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "terminal propagation must not mask the issuance diagnostic"
        );
        assert_eq!(
            coordinator
                .authorization_stream_incarnation()
                .expect_err("issuance failure keeps the coordinator globally closed")
                .diagnostic
                .code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
        assert_revocation_terminalized(
            &state,
            &connection_id,
            registration_generation,
            waker.as_ref(),
        )
        .await;
    }

    /// Expiry already arrives as an authoritative projection result. Repeated
    /// sink delivery must be harmless while the first delivery invalidates the
    /// reverse-indexed grant and schedules terminal close.
    #[tokio::test]
    async fn authoritative_expiry_terminal_sink_is_idempotent() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let state = activate_test_sessions(state);
        let credential = mint_test_credential(&state, "expiry-terminal@example.com").await;
        let bearer = credential["token"].as_str().expect("expiry bearer");
        let session_id = credential["session"]["id"]
            .as_str()
            .expect("expiry session id")
            .to_owned();
        let generation = credential["authorityDescriptor"]["sessionGeneration"]
            .as_u64()
            .expect("expiry generation");
        let incarnation = state
            .auth_coordinator
            .as_ref()
            .expect("expiry coordinator")
            .authorization_stream_incarnation()
            .expect("expiry incarnation");
        let (connection_id, registration_generation, waker) =
            open_registered_session_connection(&state, bearer, "expiry-terminal");
        let expired = crate::auth::session_projection::ExpiredSession {
            authorization_stream_incarnation: incarnation,
            session_id,
            generation,
            close_by: Instant::now() + crate::auth::session_projection::TERMINAL_CLOSE_GRACE,
        };

        state
            .auth_terminal_lifecycle
            .expire_sessions(vec![expired.clone()]);
        state.auth_terminal_lifecycle.expire_sessions(vec![expired]);
        tokio::time::timeout(Duration::from_secs(1), waker.notified())
            .await
            .expect("expiry wakes the exact socket once");
        let notifier = state.ephemeral.delivery_notifier();
        let event = notifier
            .terminal_if_current(&connection_id, registration_generation)
            .expect("expiry terminal event installed");
        assert_eq!(event.reason, crate::live_wire::LiveAuthErrorReason::Expired);
        assert!(!notifier.is_deliverable(&connection_id, registration_generation));
        let registry = state.connections.lock();
        assert!(!registry.grants.contains_key(&connection_id));
        registry.assert_grant_indexes_consistent();
    }

    /// @ref LLP 0057#rotation — the shared gate resolves an attributable
    /// predecessor from the projection without applying ordinary-use grace;
    /// the refresh state machine owns the outside-grace family revocation.
    #[tokio::test]
    async fn refresh_gate_preserves_outside_grace_reuse_revocation() {
        let start_ms = super::now_millis();
        let clock = Arc::new(ManualServerAuthClock::new(start_ms));
        let mut snapback = LocalSnapback::memory().expect("manual-clock refresh fixture");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            start_ms,
            &OsRandom,
        )
        .expect("activate manual-clock auth catalog");
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                keyring,
                Arc::new(OsRandom),
                clock.clone(),
            )
            .expect("construct manual-clock provider"),
        );
        let mut context = bound_loopback_context();
        context.profile = ServerProfile::Test;
        let state = activate_test_sessions(
            AppState::from_snapback(snapback, context)
                .with_policy_auth_mode(PolicyAuthMode::Sessions)
                .with_auth_provider(provider),
        );
        let initial = mint_test_credential(&state, "reuse@example.com").await;
        let predecessor = initial["token"].as_str().unwrap().to_owned();
        let router = app(state);

        let rotated = router
            .clone()
            .oneshot(session_auth_http_request(
                "/auth/refresh",
                br#"{}"#.to_vec(),
                &predecessor,
            ))
            .await
            .expect("initial rotation response");
        assert_eq!(rotated.status(), StatusCode::OK);
        let successor = response_json(rotated).await["token"]
            .as_str()
            .unwrap()
            .to_owned();

        clock.set(start_ms + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1);
        let reused = router
            .clone()
            .oneshot(session_auth_http_request(
                "/auth/refresh",
                br#"{}"#.to_vec(),
                &predecessor,
            ))
            .await
            .expect("outside-grace reuse response");
        assert_eq!(reused.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(reused).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_SESSION_EXPIRED"
        );

        let successor_after_reuse = router
            .oneshot(session_auth_http_request(
                "/auth/logout",
                br#"{}"#.to_vec(),
                &successor,
            ))
            .await
            .expect("revoked successor response");
        assert_eq!(successor_after_reuse.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(successor_after_reuse).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_SESSION_EXPIRED"
        );
    }

    /// @ref LLP 0057#logout-ordinary-supersession-and-family-alarm — every bearer class publishes the
    /// same delayed response, while only an attributable tombstone revokes.
    #[tokio::test]
    async fn auth_family_alarm_is_delayed_opaque_and_revoke_only() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let state = activate_test_sessions(state);
        let initial = mint_test_credential(&state, "alarm@example.com").await;
        let predecessor = initial["token"].as_str().unwrap().to_owned();
        let unknown = SessionBearer::generate(&OsRandom)
            .unwrap()
            .expose_secret()
            .to_owned();

        for bearer in [None, Some("malformed"), Some(unknown.as_str())] {
            let started = Instant::now();
            let response = super::auth_family_alarm(
                State(state.clone()),
                test_route_admission(&state),
                auth_provider_headers(bearer),
                Ok(Bytes::from_static(br#"{}"#)),
            )
            .await
            .expect("opaque alarm response");
            assert_eq!(response.status(), StatusCode::ACCEPTED);
            assert_eq!(response_json(response).await["accepted"], true);
            assert!(started.elapsed() >= Duration::from_millis(20));
        }

        // A current bearer is an opaque no-op and remains refreshable.
        let response = super::auth_family_alarm(
            State(state.clone()),
            test_route_admission(&state),
            auth_provider_headers(Some(&predecessor)),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect("current alarm response");
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(response_json(response).await["accepted"], true);
        let rotated = super::auth_refresh(
            State(state.clone()),
            prepared_provider_route_authority(&state, InvocationSource::AuthRefresh, &predecessor),
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
            let response = super::auth_family_alarm(
                State(state.clone()),
                test_route_admission(&state),
                auth_provider_headers(Some(&predecessor)),
                Ok(Bytes::from_static(br#"{}"#)),
            )
            .await
            .expect("tombstone/already-revoked alarm response");
            assert_eq!(response.status(), StatusCode::ACCEPTED);
            assert_eq!(response_json(response).await["accepted"], true);
            assert!(started.elapsed() >= Duration::from_millis(20));
        }
        let revoked = app(state.clone())
            .oneshot(session_auth_http_request(
                "/auth/logout",
                br#"{}"#.to_vec(),
                &successor,
            ))
            .await
            .expect("tombstone alarm revoked-family response");
        assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(revoked).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_SESSION_EXPIRED"
        );

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

    /// @ref LLP 0057#routes-operations-and-dtos — active dev refusal precedes the
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

    /// @ref LLP 0059#projected-session — registered required
    /// session routes resolve their bearer through the process projection and
    /// publish the terminating logout response through its committed outcome.
    #[tokio::test]
    async fn registered_session_auth_routes_resolve_projection_and_publish_logout() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let state = activate_test_sessions(state);
        let credential = mint_test_credential(&state, "registered-session@example.com").await;
        let bearer = credential["token"].as_str().unwrap().to_owned();
        let router = app(state);

        let mut missing_request =
            auth_http_request("POST", "/auth/logout", br#"{}"#.to_vec(), true, None, None);
        offer_auth_client_protocol(&mut missing_request);
        let missing = router
            .clone()
            .oneshot(missing_request)
            .await
            .expect("missing registered bearer response");
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(missing).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_REQUIRED"
        );

        let logout = session_auth_http_request("/auth/logout", br#"{}"#.to_vec(), &bearer);
        let response = router
            .clone()
            .oneshot(logout)
            .await
            .expect("projection-resolved logout response");
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
    }

    /// @ref LLP 0059#operation-specific-publication — a successful finite app
    /// request records authenticated use under the same prepared authority and
    /// publishes the later deadline only after the durable outcome is known.
    #[tokio::test]
    async fn successful_finite_session_use_extends_the_projection_deadline() {
        let start_ms = 1_700_000_000_000;
        let clock = Arc::new(ManualServerAuthClock::new(start_ms));
        let mut snapback = LocalSnapback::memory().expect("manual-clock auth fixture");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            start_ms,
            &OsRandom,
        )
        .expect("activate manual-clock auth catalog");
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                keyring,
                Arc::new(OsRandom),
                clock.clone(),
            )
            .expect("construct manual-clock auth provider"),
        );
        let state = AppState::from_snapback(snapback, bound_loopback_context())
            .with_policy_auth_mode(PolicyAuthMode::Sessions)
            .with_auth_provider(provider);
        let credential = mint_test_credential(&state, "sliding-use@example.com").await;
        let bearer = credential["token"].as_str().unwrap().to_owned();
        let coordinator = state.auth_coordinator.clone().unwrap();

        let use_at_ms = start_ms + AUTH_SESSION_USE_COALESCE_MS;
        clock.set(use_at_ms);
        let prepared = coordinator
            .resolve_required_bearer(&bearer, use_at_ms, clock.monotonic_now())
            .expect("resolve current bearer before finite use");
        let (resolved, publication) = prepared.into_parts();
        let authority = InvocationGate::prepare_authority(
            InvocationSource::HttpQuery,
            AuthMode::Sessions,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            resolved,
        )
        .expect("prepare finite request authority")
        .with_fenced_publication(publication);
        super::record_successful_finite_session_use(&state, &authority)
            .await
            .expect("record successful finite session use");

        let after_original_deadline = start_ms + AUTH_SESSION_SLIDING_WINDOW_MS + 1;
        coordinator
            .resolve_required_bearer(
                &bearer,
                after_original_deadline,
                clock.monotonic_at(after_original_deadline),
            )
            .expect("sliding use moved the projected deadline past its original value");
    }

    /// @ref LLP 0057#host-operation-dtos — mint projects the exact credential as a
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
                "authorityDescriptor".to_owned(),
                "refreshAfter".to_owned(),
                "session".to_owned(),
                "token".to_owned(),
                "tokenType".to_owned(),
            ])
        );
        assert_eq!(
            response["data"]["authorityDescriptor"]["descriptorVersion"],
            1
        );
        assert_eq!(
            response["data"]["authorityDescriptor"]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "authorityInstanceId".to_owned(),
                "descriptorVersion".to_owned(),
                "sessionGeneration".to_owned(),
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
        let route_admission = test_route_admission(&state).0;
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

    /// @ref LLP 0057#host-operation-dtos — ordinary dormant collisions use the
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
        let mut context = bound_loopback_context();
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
            authorization_invalidation: None,
        };
        let grant_debug = format!("{grant:?}");
        assert!(!grant_debug.contains(SENTINEL), "{grant_debug}");
        assert!(grant_debug.contains("[REDACTED]"), "{grant_debug}");

        let open = OpenConnectionRequest {
            connection_id: Some("conn_debug".to_owned()),
            previous_token: Some(SENTINEL.to_owned()),
            auth_invalidation_protocol: None,
        };
        let open_debug = format!("{open:?}");
        assert!(!open_debug.contains(SENTINEL), "{open_debug}");
        assert!(open_debug.contains("[REDACTED]"), "{open_debug}");
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
            "SNAPBACK_AUTH_ACCEPTANCE_PROPERTY_RECEIPT",
            "machine-readable property-oracle marker emitted only by the LLP 0053 server acceptance test",
        ),
        (
            "SNAPBACK_AUTH_ACCEPTANCE_ROOM_RECEIPT",
            "machine-readable marker emitted only by the LLP 0053 room acceptance test",
        ),
        (
            "SNAPBACK_AUTH_ACCEPTANCE_ROOM_DRAIN_SEND_RECEIPT",
            "machine-readable drain/send schedule marker emitted only by the LLP 0053 room acceptance test",
        ),
        (
            "SNAPBACK_AUTH_ACCEPTANCE_ROOM_ENQUEUE_DRAIN_RECEIPT",
            "machine-readable enqueue/drain schedule marker emitted only by the LLP 0053 room acceptance test",
        ),
        (
            "SNAPBACK_AUTH_ACCEPTANCE_ROOM_FRAME_ENQUEUE_RECEIPT",
            "machine-readable frame/enqueue schedule marker emitted only by the LLP 0053 room acceptance test",
        ),
        (
            "SNAPBACK_AUTH_ACCEPTANCE_SERVER_RECEIPT",
            "machine-readable marker emitted only by the LLP 0053 server acceptance test",
        ),
        (
            "SNAPBACK_AUTH_ACCEPTANCE_SERVER_REPLAY",
            "machine-readable replay-oracle marker emitted only by the LLP 0053 server acceptance test",
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
        "SNAPBACK_AUTHORIZED_LEASE_CONFIG_INVALID",
        "SNAPBACK_AUTHORIZED_LEASE_INVALID",
        "SNAPBACK_AUTHORIZED_LEASE_QUERY_NOT_RETAINABLE",
        "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED",
        "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY",
        "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED",
        "SNAPBACK_AUTH_INVALIDATION_ACK_BEFORE_COMMIT",
        "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
        "SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED",
        "SNAPBACK_AUTH_REQUEST_INVALID",
        "SNAPBACK_AUTH_GRANT_EXPIRY_INVALID",
        "SNAPBACK_AUTH_GRANT_SCOPE_INVALID",
        "SNAPBACK_AUTH_RESCUE_INVALID",
        "SNAPBACK_AUTH_RESCUE_MANAGED_STATE_UNSUPPORTED",
        "SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED",
        "SNAPBACK_AUTH_STALE_RESULT",
        "SNAPBACK_AUTH_UNDECLARABLE_RETENTION",
        "SNAPBACK_AUTH_USER_MISSING",
        "SNAPBACK_AUTH_SCOPED_TOKEN_TTL_INVALID",
        "SNAPBACK_CAPABILITY_UNSUPPORTED",
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
        "SNAPBACK_MEMBERSHIP_ACTIVATION_DANGLING_RESOURCE",
        "SNAPBACK_MEMBERSHIP_ACTIVATION_DUPLICATE",
        "SNAPBACK_MEMBERSHIP_ACTIVATION_NULL_AXIS",
        "SNAPBACK_MEMBERSHIP_ACTIVATION_UNKNOWN_ROLE",
        "SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE",
        "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE",
        "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE_TABLE",
        "SNAPBACK_MEMBERSHIP_AXIS_COLLISION",
        "SNAPBACK_MEMBERSHIP_AXIS_FIELD_UNKNOWN",
        "SNAPBACK_MEMBERSHIP_OPERATION_INVALID",
        "SNAPBACK_MEMBERSHIP_BOOTSTRAP_ROLE_UNKNOWN",
        "SNAPBACK_MEMBERSHIP_CONFUSABLE_ROLES",
        "SNAPBACK_MEMBERSHIP_DUPLICATE_ROLE",
        "SNAPBACK_MEMBERSHIP_EMPTY_ROLE_LIST",
        "SNAPBACK_MEMBERSHIP_EMPTY_VOCABULARY",
        "SNAPBACK_MEMBERSHIP_EXPIRY_EFFECT_UNSUPPORTED",
        "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_AXIS",
        "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_UNKNOWN",
        "SNAPBACK_MEMBERSHIP_ID_COLLISION",
        "SNAPBACK_MEMBERSHIP_ID_INVALID",
        "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_AMBIGUOUS",
        "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_INVALID",
        "SNAPBACK_MEMBERSHIP_INCIDENTAL_FLOOR",
        "SNAPBACK_MEMBERSHIP_INCIDENTAL_UNKNOWN",
        "SNAPBACK_MEMBERSHIP_INDEX_NAME_COLLISION",
        "SNAPBACK_MEMBERSHIP_LAST_HOLDER_APP_SCOPE",
        "SNAPBACK_MEMBERSHIP_LAST_HOLDER_BOOTSTRAP_MISMATCH",
        "SNAPBACK_MEMBERSHIP_LAST_HOLDER_ROLE_UNKNOWN",
        "SNAPBACK_MEMBERSHIP_OPTIONAL_KEY_AXIS",
        "SNAPBACK_MEMBERSHIP_PERMISSION_BACKING_CONFLICT",
        "SNAPBACK_MEMBERSHIP_PRINCIPAL_TYPE",
        "SNAPBACK_MEMBERSHIP_PROVENANCE_FIELD_RESERVED",
        "SNAPBACK_MEMBERSHIP_RESERVED_ROLE",
        "SNAPBACK_MEMBERSHIP_RESOURCE_AXIS_REQUIRED",
        "SNAPBACK_MEMBERSHIP_RESOURCE_REF_INVALID",
        "SNAPBACK_MEMBERSHIP_RESOURCE_TYPE",
        "SNAPBACK_MEMBERSHIP_ROLE_CONTROL_CHARACTER",
        "SNAPBACK_MEMBERSHIP_ROLE_EMPTY",
        "SNAPBACK_MEMBERSHIP_ROLE_PENDING_OVERLAP",
        "SNAPBACK_MEMBERSHIP_ROLE_RESERVED_SEPARATOR",
        "SNAPBACK_MEMBERSHIP_ROLE_TYPE",
        "SNAPBACK_MEMBERSHIP_TRANSITION_AXIS_FIELD",
        "SNAPBACK_MEMBERSHIP_TRANSITION_SELF_ON_OTHER",
        "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_CALLER",
        "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_FIELD",
        "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_ROLE",
        "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION",
        "SNAPBACK_MEMBERSHIP_UNKNOWN_ROLE",
        "SNAPBACK_PERMISSIONS_UNAVAILABLE_IN_ACTION",
        // LLP 0056 M2 write-path malformed/structural refusals.
        "SNAPBACK_MEMBERSHIP_NULL_AXIS",
        "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
        "SNAPBACK_MEMBERSHIP_TARGET_MISSING",
        "SNAPBACK_MEMBERSHIP_PATCH_AXIS",
        "SNAPBACK_MEMBERSHIP_NOT_DECLARED",
        "SNAPBACK_MEMBERSHIP_NO_BOOTSTRAP_ROLE",
        "SNAPBACK_MEMBERSHIP_BOOTSTRAP_RESOURCE_MISMATCH",
        "SNAPBACK_MEMBERSHIP_BOOTSTRAP_APP_SCOPE",
        "SNAPBACK_MEMBERSHIP_TEARDOWN_RESOURCE_MISSING",
        "SNAPBACK_MEMBERSHIP_NO_EXPIRY",
        "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_MATRIX",
        "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_REQUIRED",
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
        "SNAPBACK_SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING",
        "SNAPBACK_SCHEMA_PERMISSION_FIELD_DUPLICATE",
        "SNAPBACK_SCHEMA_PERMISSION_FIELD_UNKNOWN",
        "SNAPBACK_SCHEMA_PARSE_FAILED",
        "SNAPBACK_SCHEMA_SYSTEM_FIELD",
        "SNAPBACK_STALE_FUNCTION_ARTIFACT_KIND",
        "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION",
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_KIND",
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION",
        "SNAPBACK_SYSTEM_FIELD_WRITE",
        "SNAPBACK_TIMESTAMP_OUT_OF_RANGE",
        "SNAPBACK_UNSUPPORTED_BLOB",
        "SNAPBACK_VALUE_EXPR_AUTHORITATIVE_ONLY",
        "SNAPBACK_V8_COMPAT_CONFIG_INVALID",
        "SNAPBACK_V8_COMPAT_FLAG_REFUSED",
        "SNAPBACK_WEBSOCKET_MESSAGE_INVALID",
        "SNAPBACK_WEBSOCKET_SENDER_MISMATCH",
    ];

    const UNAUTHORIZED_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ADMIN_SECRET_READ_REQUIRED",
        "SNAPBACK_ADMIN_TOKEN_REQUIRED",
        "SNAPBACK_AUTH_CODE_INVALID",
        "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID",
        "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH",
        "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED",
        "SNAPBACK_AUTH_GRANT_INVALID",
        "SNAPBACK_AUTH_REQUIRED",
        "SNAPBACK_AUTH_STEP_UP_REQUIRED",
        "SNAPBACK_AUTH_SESSION_EXPIRED",
        "SNAPBACK_AUTH_STREAM_RESET",
        "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
        "SNAPBACK_CONNECTION_AUTHORITY_MISMATCH",
        "SNAPBACK_CONNECTION_TOKEN_REQUIRED",
    ];

    const FORBIDDEN_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ADMIN_DISABLED",
        "SNAPBACK_AUTH_AGENT_DEACTIVATED",
        "SNAPBACK_ADMIN_SECRET_READ_MINT_DENIED",
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID",
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_REQUIRED",
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_REPLAYED",
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_STALE",
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_STARTUP_MISMATCH",
        "SNAPBACK_ADMIN_SECRET_READ_SCOPE_DENIED",
        "SNAPBACK_AUTH_CODE_LOCKED",
        "SNAPBACK_AUTHORIZED_LEASE_AUTHORITY_INVALID",
        "SNAPBACK_AUTH_IMPERSONATION_REQUIRED",
        "SNAPBACK_AUTH_GRANT_SCOPE_DENIED",
        "SNAPBACK_AUTH_PERMISSION_DENIED",
        "SNAPBACK_CONNECTION_TOKEN_INVALID",
        "SNAPBACK_LIVE_RESUME_OWNERSHIP",
        // LLP 0056 M2 writer-class seam + transition-matrix authorization refusals.
        "SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED",
        "SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED",
        "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED",
        "SNAPBACK_MEMBERSHIP_NO_EFFECTIVE_PRINCIPAL",
        "SNAPBACK_MEMBERSHIP_INELIGIBLE_HOLDER",
        "SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED",
        "SNAPBACK_MEMBERSHIP_SWEEP_AUTHORITY",
        "SNAPBACK_PROFILE_FORBIDS",
    ];

    const NOT_FOUND_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_AUTH_AGENT_UNKNOWN",
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
        "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND",
        "SNAPBACK_AUTH_AGENT_CREDENTIAL_EXISTS",
        // LLP 0056 M2 write invariants that conflict with durable state.
        "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND",
        "SNAPBACK_MEMBERSHIP_RESOURCE_DELETE_BLOCKED",
        "SNAPBACK_MEMBERSHIP_BOOTSTRAP_REQUIRED",
        "SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED",
        "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION",
        "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
        "SNAPBACK_AUTH_INVALIDATION_PENDING",
        "SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE",
        "SNAPBACK_AUTH_GRANT_PENDING",
        "SNAPBACK_AUTH_GRANT_SCOPE_STALE",
        "SNAPBACK_AUTH_RESNAPSHOT_REQUIRED",
        "SNAPBACK_AUTH_RETRY_NOT_EXHAUSTED",
        "SNAPBACK_AUTH_RETRY_NOT_PENDING",
        "SNAPBACK_AUTHORIZED_LEASE_BOUNDARY_MISMATCH",
        "SNAPBACK_AUTHORIZED_LEASE_EXPIRED",
        "SNAPBACK_AUTHORIZED_LEASE_REQUEST_REUSED",
        "SNAPBACK_AUTHORIZED_LEASE_STALE",
        "SNAPBACK_AUTH_MODE_DOWNGRADE",
        "SNAPBACK_AUTH_REFRESH_SUPERSEDED",
        "SNAPBACK_AUTH_TABLE_COLLISION",
        "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
        "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED",
        "SNAPBACK_CONFIG_VERIFY_STALE",
        "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION",
        "SNAPBACK_MUTATION_CONFLICT",
        "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
        "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION",
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
        "SNAPBACK_AUTH_AGENT_CREDENTIAL_ROTATION_THROTTLED",
        "SNAPBACK_AUTH_GRANT_CAP",
        "SNAPBACK_AUTH_PAIRING_CODE_CAP",
        "SNAPBACK_AUTH_PAIRING_REQUEST_CAP",
        "SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY",
        "SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED",
        "SNAPBACK_EPHEMERAL_RATE_LIMITED",
        "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT",
        "SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT",
    ];

    const REQUEST_TIMEOUT_DIAGNOSTICS: &[&str] = &["SNAPBACK_REQUEST_BODY_TIMEOUT"];

    const GATEWAY_TIMEOUT_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ACTION_TIMEOUT",
        "SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED",
    ];

    const SERVICE_UNAVAILABLE_DIAGNOSTICS: &[&str] = &[
        "SNAPBACK_ACTION_CAPACITY_EXCEEDED",
        "SNAPBACK_ADMIN_SECRET_READ_GENERATION_EXHAUSTED",
        "SNAPBACK_APP_GENERATION_EXHAUSTED",
        "SNAPBACK_AUTH_CATALOG_CORRUPT",
        "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED",
        "SNAPBACK_AUTH_CLOCK_ROLLBACK",
        "SNAPBACK_AUTHORIZED_LEASE_KEY_UNAVAILABLE",
        "SNAPBACK_AUTHORIZED_LEASE_STATE_CORRUPT",
        "SNAPBACK_AUTHORIZED_LEASE_UNAVAILABLE",
        "SNAPBACK_AUTH_INVALIDATION_CAUSE_EXHAUSTED",
        "SNAPBACK_AUTH_INVALIDATION_CONNECTION_GENERATION_EXHAUSTED",
        "SNAPBACK_AUTH_INVALIDATION_ISSUER_EXHAUSTED",
        "SNAPBACK_AUTH_INVALIDATION_ISSUER_UNAVAILABLE",
        "SNAPBACK_AUTH_INVALIDATION_REVISION_EXHAUSTED",
        "SNAPBACK_AUTH_INVALIDATION_SCOPE_SEQUENCE_EXHAUSTED",
        "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
        "SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED",
        "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT",
        "SNAPBACK_AUTH_MODE_DOWNGRADE_COMMITTED",
        "SNAPBACK_AUTH_MODE_STATE_CORRUPT",
        "SNAPBACK_AUTH_MODE_PENDING",
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
        "SNAPBACK_AUTH_PROJECTION_CORRUPT",
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
        "SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE",
        "SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN",
        "SNAPBACK_AUTH_GRANT_STATE_CORRUPT",
        "SNAPBACK_AUTH_SCOPE_BASIS_CORRUPT",
        "SNAPBACK_AUTH_REVOCATION_UNCERTAIN",
        "SNAPBACK_AUTH_RETRY_EXHAUSTED",
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH",
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED",
        "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT",
        "SNAPBACK_AUTHORIZATION_EPOCH_EXHAUSTED",
        "SNAPBACK_AUTHORIZATION_VERSION_CORRUPT",
        "SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING",
        "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE",
        "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACT_MISSING",
        "SNAPBACK_CAPABILITY_MINIFLARE_MISSING",
        "SNAPBACK_CAPABILITY_WORKERD_MISSING",
        "SNAPBACK_CRON_DISPATCH_CAPACITY_EXCEEDED",
        "SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED",
        "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL",
        "SNAPBACK_EPHEMERAL_AUTHORITY_PENDING",
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
        "SNAPBACK_AUTH_TRANSPORT_INSECURE",
        "SNAPBACK_AUTH_INVALIDATION_CORRUPT",
        "SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID",
        "SNAPBACK_AUTH_INVALIDATION_RETIREMENT_INVALID",
        "SNAPBACK_AUTH_INVALIDATION_SERIALIZE_FAILED",
        "SNAPBACK_BENCH_EPHEMERAL",
        "SNAPBACK_BENCH_READ_LANE_STALLED",
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
        "SNAPBACK_EPHEMERAL_REAUTHORIZATION_INCOMPLETE",
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
        "SNAPBACK_AUTH_AGENT_CREDENTIAL_STATE_CORRUPT",
        "SNAPBACK_MEMBERSHIP_PROVENANCE_ROW_INVALID",
        "SNAPBACK_MEMBERSHIP_PROVENANCE_UNAVAILABLE",
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
        (StatusCode::REQUEST_TIMEOUT, REQUEST_TIMEOUT_DIAGNOSTICS),
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
        BoundGrantAuthority, BoundSessionKey, ConnectionRegistry, ConnectionRegistryState,
        FencedPublication, LiveSocketClientMessage, MAX_CONNECTION_GRANTS,
        PreparedConnectionOpenAuthority, RouteClass, RoutePolicy, live_socket_operation_name,
        live_socket_operations, route_registry,
    };
    use crate::ephemeral::{
        DeleteRequest, EphemeralCollection, EphemeralErrorCode, PublishRequest,
        RoomPermissionProjection, Scope, SubscribeRequest,
    };

    fn synthetic_connection_authority(
        bound: BoundGrantAuthority,
    ) -> PreparedConnectionOpenAuthority {
        let resolved = match &bound {
            BoundGrantAuthority::Anonymous { .. } => ResolvedAppAuthority::Anonymous,
            BoundGrantAuthority::ServicePrincipal { authority, .. } => authority.clone(),
            BoundGrantAuthority::Session {
                session_id,
                user_id,
                provider,
                generation,
                ..
            } => ResolvedAppAuthority::Session {
                user_id: user_id.clone(),
                session_id: session_id.clone(),
                provider: provider.clone(),
                generation: *generation,
                authority_instance_id: Uuid::now_v7().to_string(),
                session_not_after_ms: u64::MAX,
                provider_not_after_ms: None,
            },
        };
        PreparedConnectionOpenAuthority {
            resolved,
            bound,
            managed_authority: true,
        }
    }

    fn synthetic_session_bound(
        incarnation: &str,
        session_id: &str,
        user_id: &str,
        provider: &str,
        generation: u64,
        deadline_ms: u64,
        publication: crate::auth::session_projection::FencedPublication,
    ) -> BoundGrantAuthority {
        BoundGrantAuthority::Session {
            authorization_stream_incarnation: incarnation.to_owned(),
            session_id: session_id.to_owned(),
            user_id: user_id.to_owned(),
            provider: provider.to_owned(),
            generation,
            deadline_ms,
            publication,
        }
    }

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

        registry.clear_after_committed_reset();
        assert!(
            registry
                .verify("readable", Some(&adopted.connection_token))
                .is_err(),
            "a committed stream reset invalidates every predecessor grant"
        );
        assert!(
            registry
                .verify(&collided.connection_id, Some(&collided.connection_token))
                .is_err()
        );
        registry.lock().assert_grant_indexes_consistent();
    }

    /// @ref LLP 0059#reuse-and-mismatch — previous-token reuse is exact over
    /// every immutable authority field; the cached deadline alone is mutable.
    #[test]
    fn connection_previous_token_reuse_compares_every_authority_field() {
        let (incarnation, publication) =
            crate::auth::session_projection::FencedPublication::anonymous_for_unmanaged_dev_connection();
        let session_id = Uuid::now_v7().to_string();
        let user_id = Uuid::now_v7().to_string();
        let base = synthetic_session_bound(
            &incarnation,
            &session_id,
            &user_id,
            "email-code",
            7,
            10_000,
            publication.clone(),
        );
        let mismatches = [
            BoundGrantAuthority::Anonymous {
                authorization_stream_incarnation: incarnation.clone(),
                publication: publication.clone(),
            },
            synthetic_session_bound(
                &Uuid::now_v7().to_string(),
                &session_id,
                &user_id,
                "email-code",
                7,
                10_000,
                publication.clone(),
            ),
            synthetic_session_bound(
                &incarnation,
                &Uuid::now_v7().to_string(),
                &user_id,
                "email-code",
                7,
                10_000,
                publication.clone(),
            ),
            synthetic_session_bound(
                &incarnation,
                &session_id,
                &Uuid::now_v7().to_string(),
                "email-code",
                7,
                10_000,
                publication.clone(),
            ),
            synthetic_session_bound(
                &incarnation,
                &session_id,
                &user_id,
                "different-provider",
                7,
                10_000,
                publication.clone(),
            ),
            synthetic_session_bound(
                &incarnation,
                &session_id,
                &user_id,
                "email-code",
                8,
                10_000,
                publication.clone(),
            ),
        ];
        for mismatch in mismatches {
            let registry = ConnectionRegistry::default();
            let opened = registry
                .open_prepared(ConnectionOpenAttempt::new(
                    Some("exact-authority".to_owned()),
                    None,
                    true,
                    synthetic_connection_authority(base.clone()),
                    1,
                    Instant::now(),
                    None,
                ))
                .expect("seed exact grant");
            let error = registry
                .open_prepared(ConnectionOpenAttempt::new(
                    Some(opened.grant.connection_id.clone()),
                    Some(&opened.grant.connection_token),
                    true,
                    synthetic_connection_authority(mismatch),
                    2,
                    Instant::now(),
                    None,
                ))
                .expect_err("identity drift must invalidate and refuse reuse");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_CONNECTION_AUTHORITY_MISMATCH"
            );
            let state = registry.lock();
            assert!(state.grants.is_empty());
            assert!(
                state.pressure_mint_only,
                "non-exact previousToken retirement immediately disables readable-id adoption"
            );
            state.assert_grant_indexes_consistent();
        }

        let registry = ConnectionRegistry::default();
        let opened = registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some("deadline-only".to_owned()),
                None,
                true,
                synthetic_connection_authority(base.clone()),
                1,
                Instant::now(),
                None,
            ))
            .expect("seed deadline grant");
        let later = synthetic_session_bound(
            &incarnation,
            &session_id,
            &user_id,
            "email-code",
            7,
            20_000,
            publication,
        );
        let reused = registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some(opened.grant.connection_id.clone()),
                Some(&opened.grant.connection_token),
                false,
                synthetic_connection_authority(later),
                2,
                Instant::now(),
                None,
            ))
            .expect("deadline-only change reuses exact grant");
        assert_eq!(reused.grant, opened.grant);
        assert_eq!(reused.grant_id, opened.grant_id);
        assert!(!reused.newly_minted);
        let state = registry.lock();
        assert!(matches!(
            state
                .grants
                .get(&reused.grant.connection_id)
                .map(|record| &record.authority),
            Some(BoundGrantAuthority::Session {
                deadline_ms: 20_000,
                ..
            })
        ));
        state.assert_grant_indexes_consistent();
    }

    #[test]
    fn connection_registry_negotiates_exact_invalidation_v1_with_bound_authority() {
        let registry = ConnectionRegistry::default();
        let issuer_id =
            crate::auth::invalidation::IssuerId::fresh("018f0d90-7b11-7a22-8c33-445566778899", 7)
                .expect("issuer id");
        let authenticator =
            crate::auth::invalidation::IssuerAuthenticator::new("test-protocol-key", [0x33; 32])
                .expect("authenticator");
        let authenticated = authenticator
            .authenticate(issuer_id.clone(), "test-target", "test-app")
            .expect("authenticated issuer");
        let issuer = crate::auth::invalidation::LiveInvalidationIssuer::with_authenticator(
            authenticated,
            authenticator,
            "test-target",
            "test-app",
        )
        .expect("live issuer");
        issuer
            .install_authorization_expectation(crate::storage::AuthorizationVersion {
                incarnation: issuer_id.authorization_incarnation.clone(),
                epoch: 4,
            })
            .expect("authorization expectation");
        issuer
            .install_version_stream("018f0d90-7b11-7a22-8c33-4455667788aa")
            .expect("version stream");
        registry.install_invalidation_issuer(issuer);

        let (incarnation, publication) =
            FencedPublication::anonymous_for_unmanaged_dev_connection();
        let prepared = || {
            synthetic_connection_authority(BoundGrantAuthority::Anonymous {
                authorization_stream_incarnation: incarnation.clone(),
                publication: publication.clone(),
            })
        };
        let legacy = registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some("legacy".to_owned()),
                None,
                true,
                prepared(),
                1,
                Instant::now(),
                None,
            ))
            .expect("legacy grant");
        assert!(legacy.grant.authorization_invalidation.is_none());
        let negotiated = registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some("negotiated".to_owned()),
                None,
                true,
                prepared(),
                2,
                Instant::now(),
                Some(crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION),
            ))
            .expect("negotiated grant");
        let descriptor = negotiated
            .grant
            .authorization_invalidation
            .as_ref()
            .expect("v1 descriptor");
        assert_eq!(descriptor.protocol_version, 1);
        assert_eq!(descriptor.issuer_id, issuer_id);
        assert_eq!(descriptor.connection_generation, 1);
        assert_eq!(descriptor.authorization.epoch, 4);
        assert_eq!(
            descriptor.version_stream,
            "018f0d90-7b11-7a22-8c33-4455667788aa"
        );
        assert_eq!(
            descriptor
                .issuer_retirement
                .as_ref()
                .expect("prior issuer retirement")
                .retire_through_boot_sequence,
            6
        );
        let reopened = registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some(negotiated.grant.connection_id.clone()),
                Some(&negotiated.grant.connection_token),
                false,
                prepared(),
                3,
                Instant::now(),
                Some(1),
            ))
            .expect("idempotent reopen");
        assert_eq!(
            reopened.grant.authorization_invalidation,
            negotiated.grant.authorization_invalidation
        );
    }

    /// @ref LLP 0059#connection-bound-authority — the three closed source
    /// buckets have exact independent limits and an inclusive 60-second drop.
    #[test]
    fn connection_open_throttle_has_exact_closed_bucket_boundaries() {
        let mut state = ConnectionRegistryState::default();
        let start = Instant::now();
        let first = BoundSessionKey {
            authorization_stream_incarnation: "incarnation-a".to_owned(),
            session_id: "session-a".to_owned(),
            generation: 1,
        };
        for _ in 0..super::CONNECTION_OPEN_SESSION_LIMIT {
            state
                .consume_session_open(first.clone(), start)
                .expect("attempts one through sixty are admitted");
        }
        assert_eq!(state.consume_session_open(first.clone(), start), Err(60));
        assert_eq!(
            state.consume_session_open(first.clone(), start + Duration::from_secs(59)),
            Err(1)
        );
        let second = BoundSessionKey {
            session_id: "session-b".to_owned(),
            ..first.clone()
        };
        state
            .consume_session_open(second, start)
            .expect("one session cannot exhaust another session's bucket");
        state
            .consume_session_open(first, start + Duration::from_secs(60))
            .expect("the exact window boundary drops predecessor attempts");

        for _ in 0..super::CONNECTION_OPEN_COARSE_LIMIT {
            state
                .consume_anonymous_open("incarnation-a", start)
                .expect("anonymous attempts one through 240 are admitted");
        }
        assert_eq!(
            state.consume_anonymous_open("incarnation-a", start),
            Err(60)
        );
        state
            .consume_unknown_open("incarnation-a", start)
            .expect("canonical-unknown has a separate coarse budget");
        state
            .consume_anonymous_open("incarnation-b", start)
            .expect("a successor incarnation has a fresh coarse budget");
        for _ in 1..super::CONNECTION_OPEN_COARSE_LIMIT {
            state
                .consume_unknown_open("incarnation-a", start)
                .expect("unknown attempts through 240 are admitted");
        }
        assert_eq!(
            state.consume_unknown_open("incarnation-a", start + Duration::from_millis(1)),
            Err(60),
            "Retry-After rounds the remaining fractional minute up"
        );
        state
            .consume_unknown_open("incarnation-a", start + Duration::from_secs(60))
            .expect("unknown bucket also opens at the exact boundary");

        let survivor = BoundSessionKey {
            authorization_stream_incarnation: "incarnation-a".to_owned(),
            session_id: "session-survivor".to_owned(),
            generation: 2,
        };
        state
            .consume_session_open(survivor.clone(), start + Duration::from_secs(121))
            .expect("new session source admitted after old buckets expire");
        assert_eq!(state.session_open_attempts.len(), 1);
        assert!(state.session_open_attempts.contains_key(&survivor));
    }

    /// @ref LLP 0055#routes-and-credential-classes — every agent-management
    /// route has a closed, independent budget, including malformed attempts.
    #[test]
    fn agent_management_routes_have_independent_exact_throttle_budgets() {
        let agent_paths = super::core_route_registrations()
            .into_iter()
            .filter_map(|route| {
                super::agent_route_throttle_limit(route.spec.path)
                    .map(|limit| (route.spec.path, limit))
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        assert_eq!(
            agent_paths.keys().copied().collect::<Vec<_>>(),
            vec![
                "/auth/agents/pair",
                "/auth/agents/revoke-self",
                "/auth/agents/rotate",
                "/auth/agents/token",
                "/auth/grant-requests",
                "/auth/grant-requests/{id}/approve",
                "/auth/grant-requests/{id}/deny",
                "/auth/grants",
                "/auth/grants/by-actor/{actor_id}",
                "/auth/grants/{id}",
                "/auth/pairing-codes",
            ]
        );

        let mut state = ConnectionRegistryState::default();
        let start = Instant::now();
        let path = "/auth/agents/rotate";
        let limit = agent_paths[path];
        let first = super::AgentRouteThrottleSource::Credential([1; 32]);
        for _ in 0..limit {
            state
                .consume_agent_route(path, first.clone(), limit, start)
                .expect("attempts through the exact route limit are admitted");
        }
        assert_eq!(
            state.consume_agent_route(path, first.clone(), limit, start),
            Err(60)
        );
        assert_eq!(
            state.consume_agent_route(
                path,
                first.clone(),
                limit,
                start + Duration::from_secs(59)
            ),
            Err(1)
        );

        state
            .consume_agent_route(
                path,
                super::AgentRouteThrottleSource::Credential([2; 32]),
                limit,
                start,
            )
            .expect("one credential cannot exhaust another credential's bucket");

        let sibling = "/auth/agents/revoke-self";
        state
            .consume_agent_route(
                sibling,
                first.clone(),
                agent_paths[sibling],
                start,
            )
            .expect("one route cannot exhaust another route's bucket");
        state
            .consume_agent_route(path, first, limit, start + Duration::from_secs(60))
            .expect("the exact window boundary drops predecessor attempts");

        let user_a = super::AgentRouteThrottleSource::Session("user-a".to_owned());
        let user_b = super::AgentRouteThrottleSource::Session("user-b".to_owned());
        let session_path = "/auth/grants";
        let session_limit = agent_paths[session_path];
        for _ in 0..session_limit {
            state
                .consume_agent_route(session_path, user_a.clone(), session_limit, start)
                .expect("user A reaches its exact limit");
        }
        assert_eq!(
            state.consume_agent_route(session_path, user_a, session_limit, start),
            Err(60)
        );
        state
            .consume_agent_route(session_path, user_b, session_limit, start)
            .expect("one user cannot exhaust another user's bucket");
    }

    /// @ref LLP 0059#connection-bound-authority — exact generation
    /// invalidation cleans both LRU and reverse indexes without touching a
    /// sibling session or anonymous grant.
    #[test]
    fn connection_reverse_indexes_do_not_leave_ghosts() {
        let registry = ConnectionRegistry::default();
        let (incarnation, publication) =
            crate::auth::session_projection::FencedPublication::anonymous_for_unmanaged_dev_connection();
        let user_id = Uuid::now_v7().to_string();
        let first_session = Uuid::now_v7().to_string();
        let second_session = Uuid::now_v7().to_string();
        for connection_id in ["session-a-1", "session-a-2"] {
            registry
                .open_prepared(ConnectionOpenAttempt::new(
                    Some(connection_id.to_owned()),
                    None,
                    true,
                    synthetic_connection_authority(synthetic_session_bound(
                        &incarnation,
                        &first_session,
                        &user_id,
                        "email-code",
                        3,
                        10_000,
                        publication.clone(),
                    )),
                    1,
                    Instant::now(),
                    None,
                ))
                .expect("session grant");
        }
        registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some("session-b".to_owned()),
                None,
                true,
                synthetic_connection_authority(synthetic_session_bound(
                    &incarnation,
                    &second_session,
                    &user_id,
                    "email-code",
                    1,
                    10_000,
                    publication.clone(),
                )),
                1,
                Instant::now(),
                None,
            ))
            .expect("sibling session grant");
        registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some("anonymous".to_owned()),
                None,
                true,
                synthetic_connection_authority(BoundGrantAuthority::Anonymous {
                    authorization_stream_incarnation: incarnation.clone(),
                    publication,
                }),
                1,
                Instant::now(),
                None,
            ))
            .expect("anonymous grant");
        registry.lock().assert_grant_indexes_consistent();

        let captures = registry.invalidate_session_generation(&incarnation, &first_session, 3);
        assert_eq!(captures.len(), 2);
        let state = registry.lock();
        assert!(!state.grants.contains_key("session-a-1"));
        assert!(!state.grants.contains_key("session-a-2"));
        assert!(state.grants.contains_key("session-b"));
        assert!(state.grants.contains_key("anonymous"));
        assert!(state.pressure_mint_only);
        state.assert_grant_indexes_consistent();
        drop(state);

        let captures = registry.clear_after_committed_reset();
        assert_eq!(captures.len(), 2);
        let state = registry.lock();
        assert!(state.grants.is_empty());
        assert!(state.anonymous_grants.is_empty());
        assert!(state.session_grants.is_empty());
        state.assert_grant_indexes_consistent();
    }

    /// @ref LLP 0059#act-time-validation — a prepared predecessor cannot
    /// destructively drain data after its grant id is replaced under the same
    /// public connection id.
    #[test]
    fn stale_prepared_connection_act_cannot_drain_reused_connection_outbox() {
        let state = AppState::detached(LocalSnapback::memory().expect("memory fixture"));
        let registry = state.connections.clone();
        let first = registry
            .open(Some("reused-wire-id".to_owned()), None, true)
            .expect("first grant");
        let stale = registry
            .prepare_act(
                &first.connection_id,
                Some(&first.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare predecessor act");
        registry.clear_after_committed_reset();
        // Force the historical reuse shape after asserting production's
        // mint-only containment, so this test continues to exercise the
        // independent act-time grant-id fence.
        {
            let mut grants = registry.lock();
            assert!(grants.pressure_mint_only);
            grants.pressure_mint_only = false;
        }
        let replacement = registry
            .open(Some(first.connection_id.clone()), None, true)
            .expect("reuse wire id after reset");
        assert_eq!(replacement.connection_id, first.connection_id);
        state
            .ephemeral
            .enqueue_durable_for_test(&replacement.connection_id, br#"{"private":true}"#.to_vec());

        let drained = AtomicBool::new(false);
        let error = stale
            .try_act(&registry, super::now_millis(), Instant::now(), || {
                drained.store(true, Ordering::SeqCst);
                Ok(state.ephemeral.drain_outbox(&replacement.connection_id))
            })
            .expect_err("stale grant id must fail before destructive drain");
        assert_eq!(error.0.diagnostic.code, "SNAPBACK_CONNECTION_TOKEN_INVALID");
        assert!(!drained.load(Ordering::SeqCst));

        let current = registry
            .prepare_act(
                &replacement.connection_id,
                Some(&replacement.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare replacement act");
        let messages = current
            .try_act(&registry, super::now_millis(), Instant::now(), || {
                Ok(state.ephemeral.drain_outbox(&replacement.connection_id))
            })
            .expect("replacement owns queued data");
        assert_eq!(messages.len(), 1);
    }

    /// HTTP polling is not allowed to adopt delayed frames merely because a
    /// local profile reused the readable id. Production containment mints;
    /// this forced-reuse seam proves the exact drain remains safe anyway.
    #[test]
    fn polling_id_reuse_drops_predecessor_effects_and_delivers_successor() {
        let state = AppState::detached(LocalSnapback::memory().expect("memory fixture"));
        let registry = state.connections.clone();
        let first = registry
            .open(Some("poll-reuse".to_owned()), None, true)
            .expect("predecessor grant");
        let predecessor = registry
            .prepare_act(
                &first.connection_id,
                Some(&first.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("predecessor act");
        state.ephemeral.enqueue_durable_bound_for_test(
            &first.connection_id,
            b"predecessor".to_vec(),
            predecessor.effect_fence(),
        );

        registry.clear_after_committed_reset();
        {
            let mut grants = registry.lock();
            assert!(grants.pressure_mint_only);
            grants.pressure_mint_only = false;
        }
        let replacement = registry
            .open(Some(first.connection_id.clone()), None, true)
            .expect("forced same-id replacement");
        assert_eq!(replacement.connection_id, first.connection_id);
        let current = registry
            .prepare_act(
                &replacement.connection_id,
                Some(&replacement.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("replacement act");
        state.ephemeral.enqueue_durable_bound_for_test(
            &replacement.connection_id,
            b"successor".to_vec(),
            current.effect_fence(),
        );
        state.ephemeral.touch_connection(&replacement.connection_id);
        let payloads = state
            .ephemeral
            .drain_outbox_for_send_bound_if_active(
                &replacement.connection_id,
                &current.effect_fence(),
            )
            .expect("active poll connection")
            .into_iter()
            .filter_map(|admitted| match admitted.into_parts().0 {
                RealtimeEnvelope::Durable(message) => Some(message.payload),
                RealtimeEnvelope::Ephemeral(_) => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(payloads, vec![b"successor".to_vec()]);
    }

    #[tokio::test]
    async fn slow_socket_write_releases_its_handoff_at_the_monotonic_deadline() {
        struct Release(Arc<AtomicBool>);
        impl Drop for Release {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }

        let released = Arc::new(AtomicBool::new(false));
        let held = Release(released.clone());
        let blocked = async move {
            let _held = held;
            std::future::pending::<Result<(), ()>>().await
        };
        assert!(
            !super::bounded_live_write(blocked, tokio::time::Instant::now()).await,
            "a non-reading peer may not hold auth quiescence indefinitely"
        );
        assert!(
            released.load(Ordering::SeqCst),
            "timeout cancellation releases admission/publication ownership"
        );
    }

    /// @ref LLP 0059#fenced-effects-and-live-closure — a stream premark wins
    /// the final grant act even when verification cloned the predecessor first.
    #[test]
    fn prepared_connection_act_loses_to_concurrent_stream_premark() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let coordinator = state.auth_coordinator.clone().expect("coordinator");
        let prepared = state
            .connections
            .prepare_open_authority(
                coordinator.as_ref(),
                super::PresentedSessionBearer::Absent,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare anonymous connection");
        let opened = state
            .connections
            .open_prepared(ConnectionOpenAttempt::new(
                Some("premark-race".to_owned()),
                None,
                true,
                prepared,
                super::now_millis(),
                Instant::now(),
                None,
            ))
            .expect("open managed grant");
        let act = state
            .connections
            .prepare_act(
                &opened.grant.connection_id,
                Some(&opened.grant.connection_token),
                Some(coordinator.as_ref()),
                false,
                super::now_millis(),
                Instant::now(),
            )
            .expect("clone act before premark");
        let reset = coordinator.premark_stream_reset().expect("premark reset");
        let ran = AtomicBool::new(false);
        let error = act
            .try_act(
                &state.connections,
                super::now_millis(),
                Instant::now(),
                || {
                    ran.store(true, Ordering::SeqCst);
                    Ok(())
                },
            )
            .expect_err("pending stream mutation closes predecessor act");
        assert_eq!(error.0.diagnostic.code, "SNAPBACK_AUTH_STREAM_RESET");
        assert!(!ran.load(Ordering::SeqCst));
        let rollback = SnapbackError::error("TEST_ROLLBACK", "test", "known rollback");
        assert_eq!(
            coordinator
                .finish_stream_reset::<()>(reset, AuthTransactionAttempt::RolledBack(rollback))
                .expect_err("test rollback propagates")
                .diagnostic
                .code,
            "TEST_ROLLBACK"
        );
    }

    fn connection_open_request(bearer: Option<&str>, body: Value) -> Request<Body> {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/connection/open")
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-snapback-auth-client-protocol", "1");
        if let Some(bearer) = bearer {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {bearer}"));
        }
        builder
            .body(Body::from(
                serde_json::to_vec(&body).expect("serialize open body"),
            ))
            .expect("connection-open request")
    }

    fn projected_connection_deadline(
        state: &AppState,
        bearer: &str,
    ) -> (ResolvedAppAuthority, u64) {
        let provider = state.auth_provider.as_ref().expect("provider");
        let coordinator = state.auth_coordinator.as_ref().expect("coordinator");
        let bearer = SessionBearer::parse(bearer).expect("canonical bearer");
        let super::ConnectionBearerResolution::Current(prepared) = coordinator
            .classify_connection_bearer(&bearer, provider.now_ms(), provider.monotonic_now())
            .expect("classify projected bearer")
        else {
            panic!("bearer must be current")
        };
        let (authority, _incarnation, deadline_ms, _publication) = prepared.into_parts();
        (authority, deadline_ms)
    }

    /// @ref LLP 0059#connection-bound-authority — current-bearer opens resolve
    /// solely through the projection, store only the closed grant authority,
    /// record one qualifying use, and reject a superseded predecessor.
    #[tokio::test]
    async fn connection_open_uses_projected_current_bearer_and_records_sliding_use() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let state = state
            .with_auth_runtime_facts(
                settled_sessions_state(),
                AuthProgramReadiness::new(true, true, true, true, false, false, false),
            )
            .expect("install item-5 sessions posture");
        let credential = mint_test_credential(&state, "connection-open@example.com").await;
        let predecessor = credential["token"]
            .as_str()
            .expect("credential token")
            .to_owned();
        let (projected, before_deadline) = projected_connection_deadline(&state, &predecessor);
        tokio::time::sleep(Duration::from_millis(5)).await;
        let router = app(state.clone());
        let response = router
            .clone()
            .oneshot(connection_open_request(Some(&predecessor), json!({})))
            .await
            .expect("connection open response");
        let status = response.status();
        let opened = response_json(response).await;
        assert_eq!(status, StatusCode::OK, "unexpected open response: {opened}");
        let connection_id = opened["connectionId"].as_str().unwrap().to_owned();
        let connection_token = opened["connectionToken"].as_str().unwrap().to_owned();
        let (_after_authority, after_deadline) =
            projected_connection_deadline(&state, &predecessor);
        assert!(
            after_deadline > before_deadline,
            "a successful current-bearer open is a qualifying sliding use"
        );
        {
            let state_guard = state.connections.lock();
            let record = state_guard
                .grants
                .get(&connection_id)
                .expect("stored grant");
            let BoundGrantAuthority::Session {
                session_id,
                user_id,
                provider,
                generation,
                deadline_ms,
                ..
            } = &record.authority
            else {
                panic!("current bearer must mint a session grant")
            };
            let ResolvedAppAuthority::Session {
                session_id: projected_session_id,
                user_id: projected_user_id,
                provider: projected_provider,
                generation: projected_generation,
                ..
            } = projected
            else {
                panic!("fixture bearer must project session authority")
            };
            assert_eq!(session_id, &projected_session_id);
            assert_eq!(user_id, &projected_user_id);
            assert_eq!(provider, &projected_provider);
            assert_eq!(*generation, projected_generation);
            assert_eq!(*deadline_ms, after_deadline);
            assert!(!format!("{:?}", record.authority).contains(&predecessor));
            state_guard.assert_grant_indexes_consistent();
        }

        let reopened = router
            .clone()
            .oneshot(connection_open_request(
                Some(&predecessor),
                json!({
                    "connectionId": connection_id,
                    "previousToken": connection_token,
                }),
            ))
            .await
            .expect("exact reopen response");
        assert_eq!(reopened.status(), StatusCode::OK);
        let reopened = response_json(reopened).await;
        assert_eq!(reopened, opened);

        let rotated = router
            .clone()
            .oneshot(session_auth_http_request(
                "/auth/refresh",
                br#"{}"#.to_vec(),
                &predecessor,
            ))
            .await
            .expect("rotate bearer after grant");
        assert_eq!(rotated.status(), StatusCode::OK);
        let rotated = response_json(rotated).await;
        let successor = rotated["token"]
            .as_str()
            .expect("successor token")
            .to_owned();
        let refused = router
            .clone()
            .oneshot(connection_open_request(Some(&predecessor), json!({})))
            .await
            .expect("superseded open response");
        assert_eq!(refused.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(refused).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED"
        );

        let successor_reuse = router
            .oneshot(connection_open_request(
                Some(&successor),
                json!({
                    "connectionId": opened["connectionId"],
                    "previousToken": opened["connectionToken"],
                }),
            ))
            .await
            .expect("successor exact-authority reuse response");
        assert_eq!(successor_reuse.status(), StatusCode::OK);
        assert_eq!(response_json(successor_reuse).await, opened);
    }

    /// @ref LLP 0059#connection-bound-authority — even a semantically rejected
    /// body consumes the exact projected session source before returning.
    #[tokio::test]
    async fn rejected_connection_open_bodies_still_consume_session_budget() {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
        let state = state
            .with_auth_runtime_facts(
                settled_sessions_state(),
                AuthProgramReadiness::new(true, true, true, true, false, false, false),
            )
            .expect("install item-5 sessions posture");
        let credential = mint_test_credential(&state, "rejected-open@example.com").await;
        let bearer = credential["token"].as_str().expect("credential token");
        let router = app(state);
        let mut missing_protocol =
            connection_open_request(Some(bearer), json!({ "userId": "client-asserted" }));
        missing_protocol
            .headers_mut()
            .remove("x-snapback-auth-client-protocol");
        let missing_protocol = router
            .clone()
            .oneshot(missing_protocol)
            .await
            .expect("missing-protocol open response");
        assert_eq!(missing_protocol.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response_json(missing_protocol).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED"
        );
        for attempt in 1..super::CONNECTION_OPEN_SESSION_LIMIT {
            let response = router
                .clone()
                .oneshot(connection_open_request(
                    Some(bearer),
                    json!({ "userId": "client-asserted" }),
                ))
                .await
                .expect("rejected open response");
            assert_eq!(
                response.status(),
                StatusCode::BAD_REQUEST,
                "rejected attempt {attempt} should reach semantic body refusal"
            );
            assert_eq!(
                response_json(response).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED"
            );
        }
        let throttled = router
            .oneshot(connection_open_request(
                Some(bearer),
                json!({ "userId": "client-asserted" }),
            ))
            .await
            .expect("throttled rejected open response");
        assert_eq!(throttled.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(throttled.headers()[header::RETRY_AFTER], "60");
        assert_eq!(
            response_json(throttled).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_THROTTLED"
        );
    }

    #[tokio::test]
    async fn committed_reset_terminalizes_only_the_exact_bound_socket() {
        let state = auth_invalidation_reset_fixture();
        let registry = state.connections.clone();
        assert!(
            registry.invalidation_expectation_for_test().is_some(),
            "fixture begins with the predecessor connection issuer",
        );
        let grant = registry
            .open(Some("terminal-reset".to_owned()), None, true)
            .expect("open predecessor grant");
        let grant_id = registry
            .lock()
            .grants
            .get(&grant.connection_id)
            .expect("stored predecessor grant")
            .grant_id
            .clone();
        let notifier = state.ephemeral.delivery_notifier();
        let (generation, waker) = notifier
            .register_bound(&grant.connection_id, grant_id)
            .expect("register exact socket grant");
        let close_by = Instant::now() + Duration::from_secs(5);

        state
            .auth_terminal_lifecycle
            .committed_stream_reset(crate::live_wire::LiveAuthErrorReason::Reset, close_by);
        tokio::time::timeout(Duration::from_secs(1), waker.notified())
            .await
            .expect("committed reset wakes exact socket");
        let event = notifier
            .terminal_if_current(&grant.connection_id, generation)
            .expect("terminal event installed");
        assert_eq!(event.code, crate::live_wire::LiveAuthErrorCode::StreamReset);
        assert_eq!(event.reason, crate::live_wire::LiveAuthErrorReason::Reset);
        assert_eq!(event.close_by, close_by);
        assert!(!notifier.is_deliverable(&grant.connection_id, generation));
        assert!(
            registry
                .verify(&grant.connection_id, Some(&grant.connection_token))
                .is_err(),
            "grant invalidation linearizes before the terminal wake"
        );
        assert!(
            registry.invalidation_expectation_for_test().is_none(),
            "terminal reset clears the predecessor connection issuer",
        );
    }

    #[tokio::test]
    async fn committed_reset_rebuilds_every_invalidation_projection_before_reopening() {
        let state = auth_invalidation_reset_fixture();
        let predecessor = state
            .auth_coordinator
            .as_ref()
            .expect("reset coordinator")
            .authorization_stream_incarnation()
            .expect("predecessor incarnation");
        let old_grant = state
            .connections
            .open(Some("reset-predecessor".to_owned()), None, true)
            .expect("open predecessor connection");
        let route_admission = test_route_admission(&state).0;

        let reset = coordinated_app_reset(&state, &route_admission, None)
            .await
            .expect("committed reset returns success");
        assert!(reset.is_none());

        let successor = state
            .auth_coordinator
            .as_ref()
            .expect("reset coordinator")
            .authorization_stream_incarnation()
            .expect("successor incarnation");
        assert_ne!(successor, predecessor);
        let durable = with_snapback(&state.snapback, |snapback| {
            snapback
                .auth_database_mut()
                .authorization_version()
                .expect("durable reset authorization")
        })
        .await;
        assert_eq!(durable.incarnation, successor);
        assert_eq!(durable.epoch, 0);
        assert!(
            state
                .connections
                .verify(&old_grant.connection_id, Some(&old_grant.connection_token),)
                .is_err(),
            "predecessor connection is terminal after reset",
        );

        let router_projection = state
            .auth_invalidation
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .expect("router successor issuer")
            .authorization_expectation()
            .expect("router authorization expectation");
        assert_eq!(router_projection, durable);
        assert_eq!(
            state
                .connections
                .invalidation_expectation_for_test()
                .expect("connection successor issuer"),
            durable,
        );
        assert_eq!(
            state
                .ephemeral
                .authorization_expectation_for_test()
                .expect("room successor issuer"),
            durable,
        );
        let query_projection = with_snapback(&state.snapback, |snapback| {
            snapback
                .auth_invalidation_expectation_for_test()
                .expect("query successor expectation")
        })
        .await;
        assert_eq!(query_projection, durable);

        let credential = mint_test_credential(&state, "reset-successor@example.com").await;
        let bearer = credential["token"]
            .as_str()
            .expect("fresh successor bearer")
            .to_owned();
        let router = app(state.clone());
        let handshake = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                    .header("x-snapback-auth-client-protocol", "1")
                    .header("x-snapback-auth-invalidation-protocol", "1")
                    .header("x-snapback-authority-descriptor-protocol", "1")
                    .header("x-snapback-authorized-lease-protocol", "1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .expect("successor handshake response");
        assert_eq!(handshake.status(), StatusCode::OK);
        let handshake = response_json(handshake).await;
        assert_eq!(handshake["authorizationStreamIncarnation"], successor);
        assert_eq!(
            handshake["availability"]["retainedReads"]["available"],
            true
        );
        assert_eq!(handshake["clientProtocols"]["authorizedLease"], 1);
        assert_eq!(handshake["authorizedLease"]["protocolVersion"], 1);

        let lease_admission = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/query/missing_function/authorized-lease")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                    .header("x-snapback-auth-client-protocol", "1")
                    .header("x-snapback-auth-invalidation-protocol", "1")
                    .header("x-snapback-authorized-lease-protocol", "1")
                    .body(Body::from(
                        r#"{
                            "args": {},
                            "leaseRequestId": "reset_successor_request",
                            "clientStoreId": "reset_successor_store",
                            "queryKey": "missing_function:{}",
                            "queryInstanceId": 1
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .expect("successor lease admission response");
        assert_eq!(
            response_json(lease_admission).await["diagnostic"]["code"],
            "SNAPBACK_UNKNOWN_FUNCTION",
            "the successor query and lease gates must reach function lookup",
        );
    }

    #[tokio::test]
    async fn dormant_dev_reset_rotates_stream_without_installing_a_session_issuer() {
        // Match the production startup graph: even a dormant dev database has
        // one inspected provider and one rebuilt stream coordinator. The old
        // provider/coordinator-absent compatibility fast path is intentionally
        // unreachable in this fixture.
        let state = dormant_dev_reset_fixture();
        assert!(!state.auth_catalog_ready);
        assert!(state.auth_provider.is_some());
        let coordinator = state
            .auth_coordinator
            .as_ref()
            .expect("dormant stream coordinator");
        let mut predecessor = coordinator
            .authorization_stream_incarnation()
            .expect("initial dormant incarnation");
        let route_admission = test_route_admission(&state).0;

        for reset_index in 0..2 {
            let reset = coordinated_app_reset(&state, &route_admission, None)
                .await
                .expect("dormant dev reset succeeds");
            assert!(reset.is_none());

            let successor = coordinator
                .authorization_stream_incarnation()
                .expect("dormant successor remains available");
            assert_ne!(successor, predecessor, "reset {reset_index} rotates stream");
            let durable = with_snapback(&state.snapback, |snapback| {
                snapback
                    .auth_database_mut()
                    .authorization_version()
                    .expect("durable dormant successor")
            })
            .await;
            assert_eq!(durable.incarnation, successor);
            assert_eq!(durable.epoch, 0);
            predecessor = successor;

            assert!(
                state
                    .auth_invalidation
                    .read()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .is_none(),
                "dev router has no sessions issuer",
            );
            assert!(
                state
                    .connections
                    .invalidation_expectation_for_test()
                    .is_none(),
                "dev connections have no sessions issuer",
            );
            assert!(
                state
                    .ephemeral
                    .authorization_expectation_for_test()
                    .is_none(),
                "dev rooms have no sessions issuer",
            );
            assert!(
                with_snapback(&state.snapback, |snapback| {
                    snapback.auth_invalidation_expectation_for_test()
                })
                .await
                .is_none(),
                "dev queries have no sessions issuer",
            );
        }
    }

    #[tokio::test]
    async fn active_dev_ready_catalog_reset_stays_session_issuer_free() {
        // Catalog readiness is not the issuer predicate. A ready catalog can
        // remain active Dev during staging or after downgrade; startup only
        // installs an invalidation issuer when the active mode is Sessions.
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        assert!(state.auth_catalog_ready);
        assert_eq!(state.auth_mode_state().active, AuthMode::Dev);
        let coordinator = state
            .auth_coordinator
            .as_ref()
            .expect("ready Dev stream coordinator");
        let predecessor = coordinator
            .authorization_stream_incarnation()
            .expect("ready Dev predecessor");
        let route_admission = test_route_admission(&state).0;

        coordinated_app_reset(&state, &route_admission, None)
            .await
            .expect("ready Dev reset succeeds");
        let successor = coordinator
            .authorization_stream_incarnation()
            .expect("ready Dev successor remains available");
        assert_ne!(successor, predecessor);
        let durable = with_snapback(&state.snapback, |snapback| {
            snapback
                .auth_database_mut()
                .authorization_version()
                .expect("durable ready Dev successor")
        })
        .await;
        assert_eq!(durable.incarnation, successor);
        assert!(
            state
                .auth_invalidation
                .read()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .is_none(),
            "ready Dev router has no sessions issuer",
        );
        assert!(
            state
                .connections
                .invalidation_expectation_for_test()
                .is_none(),
            "ready Dev connections have no sessions issuer",
        );
        assert!(
            state
                .ephemeral
                .authorization_expectation_for_test()
                .is_none(),
            "ready Dev rooms have no sessions issuer",
        );
        assert!(
            with_snapback(&state.snapback, |snapback| {
                snapback.auth_invalidation_expectation_for_test()
            })
            .await
            .is_none(),
            "ready Dev queries have no sessions issuer",
        );
    }

    #[tokio::test]
    async fn postcommit_reset_finalize_failure_clears_issuers_and_stays_globally_closed() {
        let state = auth_invalidation_reset_fixture();
        let coordinator = state.auth_coordinator.clone().expect("reset coordinator");
        let predecessor = coordinator
            .authorization_stream_incarnation()
            .expect("predecessor incarnation");
        coordinator.inject_finalize_failure();
        let route_admission = test_route_admission(&state).0;

        let error = coordinated_app_reset(&state, &route_admission, None)
            .await
            .expect_err("injected postcommit finalize failure");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_REVOCATION_UNCERTAIN");
        let durable = with_snapback(&state.snapback, |snapback| {
            snapback
                .auth_database_mut()
                .authorization_version()
                .expect("durable committed successor")
        })
        .await;
        assert_ne!(durable.incarnation, predecessor);
        assert_eq!(
            coordinator
                .authorization_stream_incarnation()
                .expect_err("coordinator stays globally closed")
                .diagnostic
                .code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
        );
        assert!(
            state
                .auth_invalidation
                .read()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .is_none(),
            "router issuer is cleared",
        );
        assert!(
            state
                .connections
                .invalidation_expectation_for_test()
                .is_none(),
            "connection issuer is cleared",
        );
        assert!(
            state
                .ephemeral
                .authorization_expectation_for_test()
                .is_none(),
            "room issuer is cleared",
        );
        assert!(
            with_snapback(&state.snapback, |snapback| {
                snapback.auth_invalidation_expectation_for_test()
            })
            .await
            .is_none(),
            "query issuer is cleared",
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
            super::app(state)
                .bind(listener)
                .expect("bind socket test app")
                .serve()
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

    #[tokio::test]
    async fn terminal_socket_sends_closed_auth_error_then_4401() {
        let state = crate::admin::AppState::detached(
            LocalSnapback::memory().expect("in-memory terminal socket state"),
        );
        let registry = state.connections.clone();
        let ephemeral = state.ephemeral.clone();
        let lifecycle = state.auth_terminal_lifecycle.clone();
        let grant = registry
            .open(Some("terminal_socket".to_owned()), None, true)
            .expect("socket grant");
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        let server = tokio::spawn(async move {
            super::app(state)
                .bind(listener)
                .expect("bind socket test app")
                .serve()
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

        lifecycle.committed_stream_reset(
            crate::live_wire::LiveAuthErrorReason::Reset,
            Instant::now() + Duration::from_secs(5),
        );
        let terminal = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .expect("terminal frame deadline")
            .expect("terminal frame present")
            .expect("terminal frame readable");
        let tokio_tungstenite::tungstenite::Message::Text(terminal) = terminal else {
            panic!("expected typed terminal text frame");
        };
        let terminal: Value = serde_json::from_str(&terminal).expect("typed terminal JSON");
        assert_eq!(
            terminal,
            json!({
                "kind": "auth_error",
                "code": "SNAPBACK_AUTH_STREAM_RESET",
                "reason": "reset",
            })
        );
        let close = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .expect("terminal close deadline")
            .expect("terminal close present")
            .expect("terminal close readable");
        let tokio_tungstenite::tungstenite::Message::Close(Some(close)) = close else {
            panic!("expected terminal close frame");
        };
        assert_eq!(u16::from(close.code), super::TERMINAL_AUTH_CLOSE_CODE);
        assert_eq!(close.reason, "auth_error");
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
        let response = super::handle_live_socket_text(
            &ephemeral,
            "conn",
            &frame,
            super::PolicyAuthMode::Dev,
            false,
            &ResolvedAppAuthority::Anonymous,
        );
        let response: serde_json::Value =
            serde_json::from_str(&response.text).expect("typed socket error");
        assert_eq!(
            response["diagnostic"]["code"],
            "SNAPBACK_WEBSOCKET_MESSAGE_TOO_LARGE"
        );
    }
}
