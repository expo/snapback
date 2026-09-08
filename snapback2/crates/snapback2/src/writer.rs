//! The one thread that owns `Runtime` and every store operation.
// @ref LLP 1002#5-the-owner — HTTP threads send work here; no second store opener exists.

use crate::blob_store::{BlobStore, LocalStaging};
use crate::owner::OwnerInfo;
use crate::project::{CompiledProject, SeedData, StagedBuildCache};
use crate::protocol::Refusal;
use crate::writer_util::{owner_gone, unix_millis};
use crate::writer_wire::{execution_json, live_frame, refusal_frame};
use serde_json::{Value as Json, json};
use snapback2_core::{
    Actor, ArgType, AssetKind, AssetReadyFacts, Bound, Ceilings, ChannelSide, ChannelVerdict,
    Context, Execution, ExecutionState, Expr, Generation, KeyProvenance, MigrationPlan, Order,
    Program, ProgramKind, Runtime, Scan, Stmt, Value, max_certified_page_rows,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::thread;
use std::time::{Duration, Instant};

#[path = "writer_assets.rs"]
mod writer_assets;
#[path = "writer_auth.rs"]
mod writer_auth;
#[path = "writer_channels.rs"]
mod writer_channels;
#[path = "writer_connected.rs"]
mod writer_connected;
#[path = "writer_data.rs"]
mod writer_data;
#[path = "writer_effects.rs"]
mod writer_effects;
#[path = "writer_jobs.rs"]
mod writer_jobs;
#[path = "writer_ledger.rs"]
mod writer_ledger;
#[cfg(test)]
#[path = "writer_live_tests.rs"]
mod writer_live_tests;
#[path = "writer_offline.rs"]
mod writer_offline;
#[path = "writer_operator.rs"]
mod writer_operator;
#[path = "writer_rehearsal.rs"]
mod writer_rehearsal;
#[path = "writer_replay.rs"]
mod writer_replay;
#[path = "writer_resume.rs"]
mod writer_resume;
#[path = "writer_sse.rs"]
mod writer_sse;
#[path = "writer_timers.rs"]
mod writer_timers;
#[path = "writer_values.rs"]
mod writer_values;

use writer_assets::asset_record;
use writer_auth::{SessionFence, actor};
use writer_channels::ChannelClient;
use writer_ledger::CommitLedger;
pub(crate) use writer_offline::OfflineOptions;
pub(crate) use writer_rehearsal::rehearsal_args;
pub use writer_sse::{SseReceiver, SseSender, queue as sse_queue};
use writer_values::{channel_args, frame_digest, json_as_kind, operation_args};
#[derive(Clone, PartialEq, Eq)]
pub enum Identity {
    Bearer(String),
    Persona(String),
    Operator { by: String },
    Carrier(String),
    Anonymous,
}

impl fmt::Debug for Identity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Bearer(_) => formatter.write_str("Bearer(<redacted>)"),
            Self::Persona(name) => formatter.debug_tuple("Persona").field(name).finish(),
            Self::Operator { by } => formatter.debug_struct("Operator").field("by", by).finish(),
            Self::Carrier(_) => formatter.write_str("Carrier(<redacted>)"),
            Self::Anonymous => formatter.write_str("Anonymous"),
        }
    }
}

#[derive(Clone, Debug)]
pub struct SseEvent {
    pub seq: Option<u64>,
    pub data: Json,
    pub terminal: bool,
}

#[derive(Clone)]
pub struct OwnerHandle {
    tx: Sender<Request>,
}

impl OwnerHandle {
    pub fn call(&self, action: Action) -> Result<Json, Refusal> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(Request { action, reply: tx })
            .map_err(|_| owner_gone())?;
        rx.recv().map_err(|_| owner_gone())?
    }

    pub fn subscribe(
        &self,
        op: String,
        args: Json,
        identity: Identity,
        offline: OfflineOptions,
        events: SseSender,
    ) -> Result<Json, Refusal> {
        self.call(Action::Subscribe {
            op,
            args,
            identity,
            offline,
            events,
        })
    }

    pub fn unsubscribe(&self, id: u64) {
        let _ = self.call(Action::Unsubscribe { id });
    }
}

#[allow(clippy::large_enum_variant)]
pub enum Action {
    ConnectedOpen {
        identity: Identity,
        events: SseSender,
    },
    ConnectedClose {
        id: u64,
    },
    RehearsalSnapshot {
        target: crate::rehearsal::Target,
        args: Json,
        identity: Identity,
        reply: Sender<Result<crate::rehearsal::Snapshot, Refusal>>,
    },
    Jobs,
    Timers,
    TimerTrace {
        id: String,
    },
    Job {
        id: String,
        after: u64,
    },
    JobControl {
        id: String,
        resume: bool,
        identity: Identity,
    },
    EnqueueJob {
        name: String,
        args: Json,
        identity: Identity,
        plan: bool,
    },
    Adhoc {
        program: Program,
        source: String,
        args: Json,
        identity: Identity,
        plan: bool,
    },
    Status,
    Manifest,
    Program {
        generation: String,
        identity: Identity,
    },
    Execute {
        op: String,
        args: Json,
        identity: Identity,
        expected: Option<ProgramKind>,
        offline: OfflineOptions,
        replay: Option<Json>,
    },
    Resume {
        body: Json,
        identity: Identity,
    },
    Subscribe {
        op: String,
        args: Json,
        identity: Identity,
        offline: OfflineOptions,
        events: SseSender,
    },
    Unsubscribe {
        id: u64,
    },
    ChannelSubscribe {
        name: String,
        args: Json,
        identity: Identity,
        events: SseSender,
    },
    ChannelUnsubscribe {
        id: u64,
    },
    ChannelWrite {
        name: String,
        args: Json,
        lease: String,
        version: Json,
        value: Option<Json>,
        identity: Identity,
    },
    Signup {
        email: String,
        password: String,
    },
    Login {
        email: String,
        password: String,
        remaining: Option<Json>,
    },
    Guest {
        remaining: Option<Json>,
    },
    Logout {
        token: String,
    },
    Me {
        identity: Identity,
    },
    Personas,
    Persona {
        name: String,
    },
    Apply {
        compiled: CompiledProject,
        migration: Option<MigrationPlan>,
        seed: Option<SeedData>,
        cache: Option<StagedBuildCache>,
    },
    PublishOwner,
    Applying {
        generation: String,
    },
    Refused {
        refusals: Vec<Refusal>,
        generation: String,
    },
    Fork {
        path: PathBuf,
    },
    Reset,
    // The periodic sweep reclaims in place; this variant is the owner's
    // on-demand reclamation entry point and is exercised by tests.
    #[allow(dead_code)]
    ReclaimAssets,
    ListUploads {
        identity: Identity,
        after: String,
    },
    DiscardUpload {
        identity: Identity,
        id: String,
    },
    AssetUploadAuthorize {
        bytes: u64,
        identity: Identity,
    },
    AssetUploadBegin {
        kind: AssetKind,
        custody: crate::blob_store::UploadCustody,
        bytes: u64,
        identity: Identity,
    },
    AssetUploadReserve {
        id: String,
        bytes: u64,
    },
    AssetUploadReady {
        id: String,
        facts: AssetReadyFacts,
    },
    AssetUploadFailed {
        id: String,
    },
    AssetSession {
        identity: Identity,
    },
    AssetConsume {
        id: String,
        principal: String,
    },
    AssetDelivery {
        id: String,
        identity: Identity,
    },
    Data {
        table: String,
        index: String,
        prefix: Json,
        after: Option<Json>,
        limit: u32,
        identity: Identity,
    },
    RuleVerdicts(String, Identity),
    Why {
        op: String,
        args: Json,
        identity: Identity,
        query_only: bool,
    },
    Trace {
        seq: Option<u64>,
    },
    Commits {
        since: u64,
        limit: usize,
    },
    Subscriptions,
    Clock {
        advance_ms: i64,
    },
    EffectsResolve {
        effect: String,
        generation: Option<String>,
    },
    EffectsNow,
    OutboxClaim {
        now: i64,
    },
    OutboxSettle {
        id: String,
        state: String,
        result: Option<Json>,
        last_error: Option<String>,
        next_at: Option<i64>,
    },
    OutboxThenPending {
        limit: usize,
    },
    OutboxMarkUnknown,
    OutboxMarkQueuedUnavailable {
        error: String,
    },
    OutboxExecuteThen {
        op: String,
        args: Json,
        outbox_id: String,
    },
    OutboxRequeue {
        id: String,
    },
    InstallEffectsWake {
        wake: SyncSender<()>,
    },
    EffectsLog {
        lines: Vec<Json>,
    },
    Stop {
        cause: String,
    },
}

struct Request {
    action: Action,
    reply: Sender<Result<Json, Refusal>>,
}

#[derive(Clone)]
struct LiveClient {
    op: String,
    context: Context,
    session: Option<SessionFence>,
    offline: bool,
    drain: bool,
    last_frame: Json,
    events: SseSender,
}

struct State {
    connected: writer_connected::Connections,
    runtime: Option<Runtime>,
    compiled: CompiledProject,
    seed: SeedData,
    root: PathBuf,
    mode: String,
    phase: Json,
    // @ref LLP 1001#5-live-subscriptions-livers — the map key is the core
    // SubscriptionId for the slot's whole lifetime; reruns never re-subscribe.
    live: BTreeMap<u64, LiveClient>,
    #[cfg(test)]
    last_live_dispatch_work: usize,
    channels: BTreeMap<u64, ChannelClient>,
    ledger: VecDeque<CommitLedger>,
    operator_rejection: Option<Json>,
    next_channel: u64,
    channel_dirty: BTreeSet<String>,
    clock_offset_ms: i64,
    restarted_through_seq: u64,
    stop: Arc<AtomicBool>,
    owner: OwnerInfo,
    exited: bool,
    effects_wake: Option<SyncSender<()>>,
    asset_carriers: BTreeMap<String, writer_auth::AssetCarrier>,
    blobs: Arc<dyn BlobStore>,
    staging: Arc<LocalStaging>,
    pending_asset_deletes: BTreeSet<String>,
    next_asset_sweep: Instant,
}

const ASSET_SWEEP_INTERVAL: Duration = Duration::from_secs(60);

#[allow(clippy::too_many_arguments)]
pub fn spawn_writer(
    runtime: Runtime,
    compiled: CompiledProject,
    seed: SeedData,
    root: PathBuf,
    mode: String,
    restarted_through_seq: u64,
    stop: Arc<AtomicBool>,
    owner: OwnerInfo,
    blobs: Arc<dyn BlobStore>,
    staging: Arc<LocalStaging>,
) -> Result<OwnerHandle, Refusal> {
    let (tx, rx) = mpsc::channel();
    let handle = OwnerHandle { tx };
    thread::Builder::new()
        .name("snapback2-writer".to_owned())
        .spawn(move || {
            run_writer(
                State {
                    connected: Default::default(),
                    runtime: Some(runtime),
                    compiled,
                    seed,
                    root,
                    mode,
                    phase: Json::String("ready".to_owned()),
                    live: BTreeMap::new(),
                    #[cfg(test)]
                    last_live_dispatch_work: 0,
                    channels: BTreeMap::new(),
                    ledger: VecDeque::new(),
                    operator_rejection: None,
                    next_channel: 0,
                    channel_dirty: BTreeSet::new(),
                    clock_offset_ms: 0,
                    restarted_through_seq,
                    stop,
                    owner,
                    exited: false,
                    effects_wake: None,
                    asset_carriers: BTreeMap::new(),
                    blobs,
                    staging,
                    pending_asset_deletes: BTreeSet::new(),
                    next_asset_sweep: Instant::now() + ASSET_SWEEP_INTERVAL,
                },
                rx,
            )
        })
        .map_err(|error| {
            Refusal::owner(
                "E_OWNER_WRITER_THREAD",
                error.to_string(),
                "free process resources and rerun snapback2 dev",
            )
        })?;
    Ok(handle)
}

/// Authenticated session facts, plus a grant only when one was minted.
// @ref LLP 1012#4-the-range-store — same-principal reauthentication must use the
// fresh session epoch to reopen its sealed partition.
fn session_json(
    token: &str,
    viewer: &str,
    kind: &str,
    auth_epoch: u64,
    grant: Option<snapback2_core::ReplayGrant>,
) -> Json {
    let mut response =
        json!({ "token": token, "viewer": viewer, "kind": kind, "authEpoch": auth_epoch });
    if let Some(grant) = grant {
        response["grant"] = json!(grant);
    }
    response
}

pub fn apply_seed(runtime: &mut Runtime, rows: &[(String, Value)]) -> Result<u64, Refusal> {
    if rows.is_empty() {
        return runtime
            .store()
            .commit_seq()
            .map_err(|error| Refusal::from_runtime(&error));
    }
    runtime
        .seed(rows)
        .map_err(|error| Refusal::from_runtime(&error))
}

fn run_writer(mut state: State, rx: Receiver<Request>) {
    if let Err(error) = state.sweep_assets_on_boot() {
        crate::watch::log(
            &state.root,
            json!({ "exited": "asset startup sweep failed", "refusal": error }),
        );
        state.stop.store(true, AtomicOrdering::SeqCst);
        return;
    }
    writer_jobs::drive(&mut state, rx);
}

impl State {
    fn runtime(&self) -> &Runtime {
        self.runtime.as_ref().expect("writer runtime present")
    }

    fn runtime_mut(&mut self) -> &mut Runtime {
        self.runtime.as_mut().expect("writer runtime present")
    }

    fn handle(&mut self, action: Action) -> Result<Json, Refusal> {
        let result = self.dispatch(action);
        self.flush_channels();
        result
    }

    fn dispatch(&mut self, action: Action) -> Result<Json, Refusal> {
        match action {
            Action::ConnectedOpen { identity, events } => self.connected_open(identity, events),
            Action::ConnectedClose { id } => {
                self.connected_close(id);
                Ok(Json::Null)
            }
            Action::RehearsalSnapshot {
                target,
                args,
                identity,
                reply,
            } => {
                let _ = reply.send(self.rehearsal_snapshot(target, args, identity));
                Ok(json!({}))
            }
            Action::Jobs => self.jobs(),
            Action::Timers => self.timers(),
            Action::TimerTrace { id } => self.timer_trace(&id),
            Action::Job { id, after } => self.job(&id, after),
            Action::JobControl {
                id,
                resume,
                identity,
            } => self.job_control(&id, resume, identity),
            Action::EnqueueJob {
                name,
                args,
                identity,
                plan,
            } => self.enqueue_job(&name, args, identity, plan),
            Action::Adhoc {
                program,
                source,
                args,
                identity,
                plan,
            } => self.adhoc(program, source, args, identity, plan),
            Action::Status => self.status(),
            Action::Manifest => Ok(self.manifest()),
            Action::Program {
                generation,
                identity,
            } => {
                self.resolve_authority(identity)?;
                writer_offline::program(self.runtime().generation(), &generation)
            }
            Action::Execute {
                op,
                args,
                identity,
                expected,
                offline,
                replay,
            } => self.execute(&op, args, identity, expected, offline, replay),
            Action::Resume { body, identity } => self.resume(body, identity),
            Action::Subscribe {
                op,
                args,
                identity,
                offline,
                events,
            } => self.subscribe(op, args, identity, offline, events),
            Action::Unsubscribe { id } => {
                if self.live.remove(&id).is_some() {
                    self.runtime_mut().unsubscribe(id);
                }
                Ok(json!({ "ok": true }))
            }
            Action::ChannelSubscribe {
                name,
                args,
                identity,
                events,
            } => self.channel_subscribe(name, args, identity, events),
            Action::ChannelUnsubscribe { id } => {
                self.channel_unsubscribe(id);
                Ok(json!({ "ok": true }))
            }
            Action::ChannelWrite {
                name,
                args,
                lease,
                version,
                value,
                identity,
            } => self.channel_write(name, args, lease, version, value, identity),
            Action::Signup { email, password } => {
                let now = self.now();
                let session = self
                    .runtime_mut()
                    .signup(&email, &password, now)
                    .map_err(|error| Refusal::from_identity(&error))?;
                Ok(session_json(
                    &session.token,
                    session.principal.id.as_str(),
                    &session.principal.kind,
                    session.auth_epoch,
                    None,
                ))
            }
            Action::Login {
                email,
                password,
                remaining,
            } => {
                let now = self.now();
                let session = self
                    .runtime_mut()
                    .login(&email, &password, now)
                    .map_err(|error| Refusal::from_identity(&error))?;
                let grant = self.grant_if_low(session.principal.id.as_str(), remaining.as_ref())?;
                Ok(session_json(
                    &session.token,
                    session.principal.id.as_str(),
                    &session.principal.kind,
                    session.auth_epoch,
                    grant,
                ))
            }
            Action::Guest { remaining } => {
                let now = self.now();
                let session = self
                    .runtime_mut()
                    .guest(now)
                    .map_err(|error| Refusal::from_identity(&error))?;
                let grant = self.grant_if_low(session.principal.id.as_str(), remaining.as_ref())?;
                Ok(session_json(
                    &session.token,
                    session.principal.id.as_str(),
                    &session.principal.kind,
                    session.auth_epoch,
                    grant,
                ))
            }
            Action::Logout { token } => {
                let now = self.now();
                // Pin expiry cleanup and logout to the same instant so an
                // expired epoch is fenced before identity removes its row.
                self.sweep_expired_sessions_at(now)?;
                let authority = self
                    .runtime_mut()
                    .logout(&token, now)
                    .map_err(|error| Refusal::from_identity(&error))?;
                self.fence_session(&authority);
                Ok(json!({ "ok": true }))
            }
            Action::Me { identity } => {
                let authority = self.resolve_authority(identity)?;
                Ok(json!({
                    "viewer": authority.principal.id,
                    "kind": authority.principal.kind,
                    "authEpoch": authority.auth_epoch(),
                }))
            }
            Action::Personas => {
                self.require_dev_personas()?;
                Ok(serde_json::to_value(
                    self.runtime()
                        .principals(Some("persona"))
                        .map_err(|error| Refusal::from_identity(&error))?,
                )
                .unwrap_or(Json::Array(Vec::new())))
            }
            Action::Persona { name } => {
                self.require_dev_personas()?;
                let now = self.now();
                let session = self
                    .runtime_mut()
                    .persona(&name, now)
                    .map_err(|error| Refusal::from_identity(&error))?;
                Ok(json!({ "name": name, "viewer": session.principal.id, "token": session.token }))
            }
            Action::Applying { generation } => {
                self.phase = json!({ "state": "applying", "generation": generation });
                Ok(json!({ "ok": true }))
            }
            Action::Refused {
                refusals,
                generation,
            } => {
                self.phase = json!({
                    "state": "refused",
                    "generation": generation,
                    "refused": refusals,
                });
                Ok(json!({ "ok": true }))
            }
            Action::Apply {
                compiled,
                migration,
                seed,
                cache,
            } => {
                let generation = compiled.generation.hash();
                let result = self.apply(compiled, migration, seed, cache);
                if let Err(refusal) = &result {
                    self.phase = json!({ "state": "refused", "generation": generation, "refused": [refusal] });
                    crate::watch::log(&self.root, self.phase.clone());
                }
                result
            }
            Action::PublishOwner => self.publish_owner(),
            Action::Fork { path } => {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|error| {
                        Refusal::owner(
                            "E_OWNER_FORK",
                            error.to_string(),
                            "make .snapback/forks writable",
                        )
                    })?;
                }
                self.runtime()
                    .store()
                    .snapshot_to(&path)
                    .map_err(|error| Refusal::from_runtime(&error))?;
                Ok(json!({ "ok": true, "path": path }))
            }
            Action::Reset => self.reset(),
            Action::ReclaimAssets => self.reclaim_assets(),
            Action::ListUploads { identity, after } => self.list_uploads(identity, &after),
            Action::DiscardUpload { identity, id } => self.discard_upload(identity, &id),
            Action::AssetUploadAuthorize { bytes, identity } => {
                self.asset_upload_authorize(bytes, identity)
            }
            Action::AssetUploadBegin {
                kind,
                custody,
                bytes,
                identity,
            } => self.asset_upload_begin(kind, bytes, identity, custody),
            Action::AssetUploadReserve { id, bytes } => {
                self.runtime_mut()
                    .reserve_asset_finalized_bytes(&id, bytes)
                    .map_err(|error| Refusal::from_runtime(&error))?;
                Ok(json!({ "ok": true }))
            }
            Action::AssetUploadReady { id, facts } => {
                self.staging.finish_upload(&id);
                self.runtime_mut()
                    .mark_asset_ready(&id, &facts)
                    .map_err(|error| Refusal::from_runtime(&error))?;
                Ok(asset_record(&id, &facts))
            }
            Action::AssetUploadFailed { id } => {
                self.staging.finish_upload(&id);
                self.runtime_mut()
                    .mark_asset_failed(&id)
                    .map_err(|error| Refusal::from_runtime(&error))?;
                Ok(json!({ "ok": true }))
            }
            Action::AssetSession { identity } => self.mint_asset_carrier(identity),
            Action::AssetDelivery { id, identity } => self.asset_delivery(&id, identity),
            Action::AssetConsume { id, principal } => self.asset_consume(&id, &principal),
            Action::Data {
                table,
                index,
                prefix,
                after,
                limit,
                identity,
            } => self.data(table, index, prefix, after, limit, identity),
            Action::RuleVerdicts(table, identity) => self.rule_verdicts(table, identity),
            Action::Why {
                op,
                args,
                identity,
                query_only,
            } => self.why(op, args, identity, query_only),
            Action::Trace { seq } => self.trace(seq),
            Action::Commits { since, limit } => Ok(serde_json::to_value(
                self.runtime()
                    .store()
                    .commits_since(since, limit.min(500))
                    .map_err(|error| Refusal::from_runtime(&error))?,
            )
            .unwrap_or(Json::Array(Vec::new()))),
            Action::Subscriptions => Ok(serde_json::to_value(self.runtime().subscriptions())
                .unwrap_or(Json::Array(Vec::new()))),
            Action::Clock { advance_ms } => {
                if self.mode != "dev" {
                    return Err(Refusal::new(
                        "E_OWNER_CLOCK_NOT_DEV",
                        "owner",
                        "clock control is available only in dev mode",
                        "start snapback2 dev without --serve",
                        "owner/clock",
                    ));
                }
                // @ref LLP 1002#4-the-wire — the development clock is monotonic so
                // a refused rewind cannot extend session authority or rerun live state.
                if advance_ms < 0 {
                    return Err(Refusal::input(
                        "clock advanceMs must be non-negative",
                        "pass advanceMs >= 0",
                    ));
                }
                self.clock_offset_ms = self.clock_offset_ms.saturating_add(advance_ms);
                self.advance_channel_clock(advance_ms);
                self.sweep_expired_sessions()?;
                self.sweep_channels();
                self.sweep_offline_now()?;
                self.sweep_assets_now()?;
                let subscriptions = self.live.keys().copied().collect::<Vec<_>>();
                let _ = self.rerun_live(&subscriptions, false);
                Ok(json!({ "ok": true, "offsetMs": self.clock_offset_ms }))
            }
            Action::EffectsResolve { effect, generation } => {
                self.effect_declarations(&effect, generation.as_deref())
            }
            Action::EffectsNow => Ok(json!({ "now": self.now() })),
            Action::OutboxClaim { now } => {
                let root = self.root.clone();
                crate::effects::claim_outbox(self.runtime(), &root, now)
            }
            Action::OutboxSettle {
                id,
                state,
                result,
                last_error,
                next_at,
            } => writer_effects::settle_outbox(
                self.runtime(),
                &id,
                &state,
                result.as_ref(),
                last_error.as_deref(),
                next_at,
            ),
            Action::OutboxThenPending { limit } => Ok(serde_json::to_value(
                self.runtime()
                    .store()
                    .outbox_then_pending(limit.min(500))
                    .map_err(|error| Refusal::from_runtime(&error))?,
            )
            .map_err(|error| {
                Refusal::from_runtime(&snapback2_core::RuntimeError::Serialization(
                    error.to_string(),
                ))
            })?),
            Action::OutboxMarkUnknown => {
                let changed = self
                    .runtime()
                    .store()
                    .outbox_mark_unknown_running()
                    .map_err(|error| Refusal::from_runtime(&error))?;
                Ok(json!({ "changed": changed }))
            }
            Action::OutboxMarkQueuedUnavailable { error } => {
                let changed = self
                    .runtime()
                    .store()
                    .outbox_mark_queued_error(&error)
                    .map_err(|error| Refusal::from_runtime(&error))?;
                Ok(json!({ "changed": changed }))
            }
            Action::OutboxExecuteThen {
                op,
                args,
                outbox_id,
            } => self.execute_then(&op, args, &outbox_id),
            Action::OutboxRequeue { id } => {
                let row = self
                    .runtime()
                    .store()
                    .outbox_get(&id)
                    .map_err(|error| Refusal::from_runtime(&error))?
                    .ok_or_else(|| {
                        Refusal::new(
                            "E_EFFECT_NOT_FOUND",
                            "effect",
                            format!("outbox row {id} does not exist"),
                            "requeue an id shown by snapback2 trace",
                            "effects/requeue",
                        )
                    })?;
                if !matches!(row.state.as_str(), "sent_unknown" | "failed") {
                    return Err(Refusal::new(
                        "E_EFFECT_REQUEUE_STATE",
                        "effect",
                        format!(
                            "outbox row {id} is {}, not sent_unknown or failed",
                            row.state
                        ),
                        "requeue only a sent_unknown or failed outbox row",
                        "effects/requeue",
                    ));
                }
                let requeued = self
                    .runtime()
                    .store()
                    .outbox_requeue(&id)
                    .map_err(|error| Refusal::from_runtime(&error))?;
                if !requeued {
                    return Err(Refusal::new(
                        "E_EFFECT_REQUEUE_STATE",
                        "effect",
                        format!("outbox row {id} is neither sent_unknown nor failed"),
                        "requeue only a sent_unknown or failed outbox row",
                        "effects/requeue",
                    ));
                }
                self.wake_effects();
                Ok(json!({ "ok": true, "id": id, "state": "queued" }))
            }
            Action::InstallEffectsWake { wake } => {
                self.effects_wake = Some(wake);
                Ok(json!({ "ok": true }))
            }
            Action::EffectsLog { lines } => {
                for line in lines {
                    crate::watch::log(&self.root, json!({ "effect": line }));
                }
                Ok(json!({ "ok": true }))
            }
            Action::Stop { cause } => {
                self.exited = true;
                self.phase = json!({ "state": "exited", "cause": cause });
                crate::watch::log(&self.root, json!({ "exited": cause }));
                self.stop.store(true, AtomicOrdering::SeqCst);
                Ok(json!({ "ok": true, "exited": cause }))
            }
        }
    }

    fn require_dev_personas(&self) -> Result<(), Refusal> {
        if self.mode == "dev" {
            Ok(())
        } else {
            Err(Refusal::new(
                "E_AUTH_PERSONA_NOT_DEV",
                "auth",
                "personas are refused by a serve owner",
                "use a user/guest session for served requests, or start a dev owner for personas",
                "auth/personas",
            ))
        }
    }

    fn execute(
        &mut self,
        op: &str,
        args: Json,
        identity: Identity,
        expected: Option<ProgramKind>,
        offline: OfflineOptions,
        replay: Option<Json>,
    ) -> Result<Json, Refusal> {
        if let Identity::Operator { by } = identity {
            self.operation_kind(op, expected)?;
            let execution = self.operator_execution(op, args, by)?;
            return Ok(writer_operator::operator_json(&execution));
        }
        self.refuse_schedule_target(op)?;
        // Only the mutation route accepts replay. Resolve its live authority
        // before consulting the ledger; a terminal belongs to the principal
        // even when a successor removed or changed the original program.
        if let Some(replay) = replay {
            let authority = self.resolve_authority(identity)?;
            return self.execute_replayed_mutation(op, args, &authority, replay);
        }
        let kind = self.operation_kind(op, expected)?;
        let authority = self.resolve_authority(identity)?;
        if offline.drain {
            self.admit_drain(op)?;
        }
        let execution = if kind == ProgramKind::Mutation {
            let context = self.mutation_context(&authority, op, args)?;
            self.execute_mutation(op, context)?
        } else {
            let context = self.context(&authority, op, args)?;
            let execution = self
                .runtime_mut()
                .execute(op, context.clone())
                .map_err(|error| Refusal::from_runtime(&error))?;
            if offline.receipt {
                let full = writer_offline::envelope_json(
                    self.runtime().generation(),
                    op,
                    &context,
                    &execution,
                )?;
                return Ok(writer_offline::conditional_frame(
                    &full,
                    offline.validator.as_deref(),
                ));
            }
            execution
        };
        Ok(execution_json(&execution))
    }

    fn operation_kind(
        &self,
        op: &str,
        expected: Option<ProgramKind>,
    ) -> Result<ProgramKind, Refusal> {
        let kind = self
            .runtime()
            .generation()
            .programs()
            .get(op)
            .map(|entry| entry.0.kind)
            .ok_or_else(|| {
                Refusal::new(
                    "E_OP_UNKNOWN",
                    "op",
                    format!("unknown operation {op}"),
                    "use an operation listed by /api/manifest",
                    "op/manifest",
                )
            })?;
        if kind == ProgramKind::Job {
            return Err(Refusal::operator_required());
        }
        if expected.is_some_and(|expected| expected != kind) {
            return Err(Refusal::new(
                "E_OP_KIND",
                "op",
                format!("{op} is a {kind:?}, not the requested operation kind"),
                "send queries to /api/query and mutations to /api/mutation",
                "op/kind",
            ));
        }
        Ok(kind)
    }

    fn execute_mutation(&mut self, op: &str, context: Context) -> Result<Execution, Refusal> {
        let execution = self
            .runtime_mut()
            .execute(op, context)
            .map_err(|error| Refusal::from_runtime(&error))?;
        if matches!(execution.state, ExecutionState::Committed { .. }) {
            self.after_commit(execution.seq)?;
        }
        Ok(execution)
    }

    fn subscribe(
        &mut self,
        op: String,
        args: Json,
        identity: Identity,
        offline: OfflineOptions,
        events: SseSender,
    ) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        if offline.drain {
            self.admit_drain(&op)?;
        }
        let context = self.context(&authority, &op, args)?;
        let (id, execution) = self
            .runtime_mut()
            .subscribe(&op, context.clone())
            .map_err(|error| Refusal::from_runtime(&error))?;
        let (full, terminal) = if offline.receipt {
            writer_offline::envelope_frame(self.runtime().generation(), &op, &context, &execution)
        } else {
            writer_offline::connected_frame(self.runtime().generation(), &op, &execution)
        };
        let data = if offline.receipt && !terminal {
            writer_offline::conditional_frame(&full, offline.validator.as_deref())
        } else {
            full.clone()
        };
        events
            .send_latest(SseEvent {
                seq: Some(execution.seq),
                data: data.clone(),
                terminal,
            })
            .map_err(|_| owner_gone())?;
        self.live.insert(
            id,
            LiveClient {
                op,
                context,
                session: authority.session,
                offline: offline.receipt,
                drain: offline.drain,
                last_frame: full,
                events,
            },
        );
        Ok(json!({ "id": id, "seq": execution.seq }))
    }

    fn apply(
        &mut self,
        compiled: CompiledProject,
        migration: Option<MigrationPlan>,
        seed: Option<SeedData>,
        cache: Option<StagedBuildCache>,
    ) -> Result<Json, Refusal> {
        crate::media_helper::require_for_generation(&compiled.generation)?;
        let report = if let Some(plan) = migration {
            let released_at = self.now();
            self.runtime_mut()
                .apply_migration(compiled.generation.clone(), &plan, released_at)
                .map_err(|error| Refusal::from_runtime(&error))?
        } else {
            let now = self.now();
            self.runtime_mut()
                .apply_successor_at(compiled.generation.clone(), now)
                .map_err(|error| Refusal::from_successor(&error))?
        };
        if let Some(cache) = cache
            && let Err(error) = cache.publish()
        {
            self.stop.store(true, AtomicOrdering::SeqCst);
            return Err(error
                .with_detail("applied", json!(true))
                .with_detail("activeGeneration", json!(compiled.generation.hash())));
        }
        self.compiled = compiled;
        if let Some(seed) = seed {
            self.seed = seed;
        }
        self.owner.generation = self.compiled.generation.hash();
        self.sweep_expired_sessions()?;
        self.reset_channels();
        self.phase = Json::String("ready".to_owned());
        let clients = self.live.keys().copied().collect::<Vec<_>>();
        let _ = self.rerun_live(&clients, true);
        self.wake_effects();
        if let Err(error) = self.publish_owner() {
            self.stop.store(true, AtomicOrdering::SeqCst);
            return Err(error
                .with_detail("applied", json!(true))
                .with_detail("activeGeneration", json!(self.owner.generation)));
        }
        Ok(serde_json::to_value(report).unwrap_or(Json::Null))
    }

    fn publish_owner(&self) -> Result<Json, Refusal> {
        crate::owner::write_owner_if_active(&self.root, &self.owner, self.exited)?;
        Ok(json!({ "ok": true, "exited": self.exited }))
    }

    fn rule_verdicts(&mut self, table_name: String, identity: Identity) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        let context = self.execution_context(&authority, BTreeMap::new())?;
        let rows = self
            .runtime_mut()
            .read_rule_verdicts(&table_name, context)
            .map_err(|error| Refusal::from_runtime(&error))?;
        Ok(json!({ "table": table_name, "as": authority.principal.id, "rows": rows }))
    }

    fn now(&self) -> i64 {
        unix_millis().saturating_add(self.clock_offset_ms)
    }
}

#[cfg(test)]
#[path = "writer_effects_tests.rs"]
mod effects_tests;
