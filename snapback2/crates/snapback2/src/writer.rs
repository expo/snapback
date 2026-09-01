//! The one thread that owns `Runtime` and every store operation.
// @ref LLP 1002#5-the-owner — HTTP threads send work here; no second store opener exists.

use crate::owner::OwnerInfo;
use crate::project::{CompiledProject, SeedData, seed_rows};
use crate::protocol::{Refusal, json_to_value};
use crate::writer_util::{next_id, owner_gone, unix_millis};
use crate::writer_wire::{execution_json, live_frame, refusal_frame};
use serde_json::{Value as Json, json};
use snapback2_core::{
    Actor, ArgType, Bound, Ceilings, ChannelSide, ChannelVerdict, ColumnType, Context, Execution,
    ExecutionState, Expr, Generation, KeyProvenance, MigrationPlan, Order, Principal, Program,
    ProgramKind, Runtime, Scan, Stmt, Value, max_certified_page_rows,
};
use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::thread;

#[path = "writer_effects.rs"]
mod writer_effects;
#[path = "writer_ledger.rs"]
mod writer_ledger;
#[path = "writer_sse.rs"]
mod writer_sse;

use writer_ledger::{CommitLedger, LedgerDelivery};
pub use writer_sse::{SseReceiver, SseSender, queue as sse_queue};

#[derive(Clone, Debug)]
pub enum Identity {
    Bearer(String),
    Persona(String),
    Anonymous,
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
        events: SseSender,
    ) -> Result<Json, Refusal> {
        self.call(Action::Subscribe {
            op,
            args,
            identity,
            events,
        })
    }

    pub fn unsubscribe(&self, id: u64) {
        let _ = self.call(Action::Unsubscribe { id });
    }
}

// Apply carries a whole certified successor so the writer remains the sole Runtime owner.
#[allow(clippy::large_enum_variant)]
pub enum Action {
    Status,
    Manifest,
    Execute {
        op: String,
        args: Json,
        identity: Identity,
        expected: Option<ProgramKind>,
    },
    Subscribe {
        op: String,
        args: Json,
        identity: Identity,
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
    ChannelPublish {
        name: String,
        args: Json,
        payload: Json,
        identity: Identity,
    },
    Signup {
        email: String,
        password: String,
    },
    Login {
        email: String,
        password: String,
    },
    Guest,
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
    runtime_id: u64,
    op: String,
    context: Context,
    last_frame: Json,
    events: SseSender,
}

#[derive(Clone)]
struct ChannelClient {
    name: String,
    args: BTreeMap<String, Value>,
    context: Context,
    verdict: ChannelVerdict,
    events: SseSender,
}

struct State {
    runtime: Option<Runtime>,
    compiled: CompiledProject,
    seed: SeedData,
    root: PathBuf,
    mode: String,
    phase: Json,
    live: BTreeMap<u64, LiveClient>,
    channels: BTreeMap<u64, ChannelClient>,
    ledger: VecDeque<CommitLedger>,
    next_channel: u64,
    clock_offset_ms: i64,
    restarted_through_seq: u64,
    stop: Arc<AtomicBool>,
    owner: OwnerInfo,
    exited: bool,
    effects_wake: Option<SyncSender<()>>,
}

pub fn spawn_writer(
    runtime: Runtime,
    compiled: CompiledProject,
    seed: SeedData,
    root: PathBuf,
    mode: String,
    restarted_through_seq: u64,
    stop: Arc<AtomicBool>,
    owner: OwnerInfo,
) -> Result<OwnerHandle, Refusal> {
    let (tx, rx) = mpsc::channel();
    let handle = OwnerHandle { tx };
    thread::Builder::new()
        .name("snapback2-writer".to_owned())
        .spawn(move || {
            run_writer(
                State {
                    runtime: Some(runtime),
                    compiled,
                    seed,
                    root,
                    mode,
                    phase: Json::String("ready".to_owned()),
                    live: BTreeMap::new(),
                    channels: BTreeMap::new(),
                    ledger: VecDeque::new(),
                    next_channel: 0,
                    clock_offset_ms: 0,
                    restarted_through_seq,
                    stop,
                    owner,
                    exited: false,
                    effects_wake: None,
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
    while let Ok(request) = rx.recv() {
        let result = state.handle(request.action);
        let _ = request.reply.send(result);
        if state.stop.load(AtomicOrdering::SeqCst) {
            break;
        }
    }
}

impl State {
    fn runtime(&self) -> &Runtime {
        self.runtime.as_ref().expect("writer runtime present")
    }

    fn runtime_mut(&mut self) -> &mut Runtime {
        self.runtime.as_mut().expect("writer runtime present")
    }

    fn handle(&mut self, action: Action) -> Result<Json, Refusal> {
        match action {
            Action::Status => self.status(),
            Action::Manifest => Ok(self.manifest()),
            Action::Execute {
                op,
                args,
                identity,
                expected,
            } => self.execute(&op, args, identity, expected),
            Action::Subscribe {
                op,
                args,
                identity,
                events,
            } => self.subscribe(op, args, identity, events),
            Action::Unsubscribe { id } => {
                if let Some(client) = self.live.remove(&id) {
                    self.runtime_mut().unsubscribe(client.runtime_id);
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
                self.channels.remove(&id);
                Ok(json!({ "ok": true }))
            }
            Action::ChannelPublish {
                name,
                args,
                payload,
                identity,
            } => self.channel_publish(name, args, payload, identity),
            Action::Signup { email, password } => {
                let now = self.now();
                let session = self
                    .runtime_mut()
                    .signup(&email, &password, now)
                    .map_err(|error| Refusal::from_identity(&error))?;
                Ok(json!({ "token": session.token, "viewer": session.principal.id }))
            }
            Action::Login { email, password } => {
                let now = self.now();
                let session = self
                    .runtime_mut()
                    .login(&email, &password, now)
                    .map_err(|error| Refusal::from_identity(&error))?;
                Ok(json!({ "token": session.token, "viewer": session.principal.id }))
            }
            Action::Guest => {
                let now = self.now();
                let session = self
                    .runtime_mut()
                    .guest(now)
                    .map_err(|error| Refusal::from_identity(&error))?;
                Ok(json!({ "token": session.token, "viewer": session.principal.id }))
            }
            Action::Logout { token } => {
                self.runtime_mut()
                    .logout(&token)
                    .map_err(|error| Refusal::from_identity(&error))?;
                Ok(json!({ "ok": true }))
            }
            Action::Me { identity } => {
                let principal = self.principal(identity)?;
                Ok(json!({ "viewer": principal.id, "kind": principal.kind }))
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
            } => self.apply(compiled, migration, seed),
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
            Action::Data {
                table,
                index,
                prefix,
                after,
                limit,
                identity,
            } => self.data(table, index, prefix, after, limit, identity),
            Action::RuleVerdicts(table, identity) => self.rule_verdicts(table, identity),
            Action::Why { op, args, identity } => self.why(op, args, identity),
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
                self.clock_offset_ms = self.clock_offset_ms.saturating_add(advance_ms);
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

    fn principal(&mut self, identity: Identity) -> Result<Principal, Refusal> {
        match identity {
            Identity::Bearer(token) => {
                let now = self.now();
                self.runtime()
                    .authenticate(&token, now)
                    .map_err(|error| Refusal::from_identity(&error))
            }
            Identity::Persona(name) => {
                self.require_dev_personas()?;
                let now = self.now();
                self.runtime_mut()
                    .persona(&name, now)
                    .map(|session| session.principal)
                    .map_err(|error| Refusal::from_identity(&error))
            }
            Identity::Anonymous => Err(Refusal::new(
                "E_AUTH_REQUIRED",
                "auth",
                "authentication is required",
                "send Authorization: Bearer <token> or X-Snapback-As in dev",
                "auth/identity",
            )),
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
                "use Authorization: Bearer <token> or start a dev owner",
                "auth/personas",
            ))
        }
    }

    fn context(&self, principal: Principal, op: &str, args: Json) -> Result<Context, Refusal> {
        let values = operation_args(self.runtime().generation(), op, &args)?;
        let mut context = Context::query(actor(&principal)?, values);
        let now = self.now();
        context.now = Some(now);
        context.read_time = Some(now);
        context.new_ids = (0..1024).map(|_| next_id()).collect::<VecDeque<_>>();
        Ok(context)
    }

    fn execute(
        &mut self,
        op: &str,
        args: Json,
        identity: Identity,
        expected: Option<ProgramKind>,
    ) -> Result<Json, Refusal> {
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
        if expected.is_some_and(|expected| expected != kind) {
            return Err(Refusal::new(
                "E_OP_KIND",
                "op",
                format!("{op} is a {kind:?}, not the requested operation kind"),
                "send queries to /api/query and mutations to /api/mutation",
                "op/kind",
            ));
        }
        let principal = self.principal(identity)?;
        let context = self.context(principal, op, args)?;
        let execution = if kind == ProgramKind::Mutation {
            self.execute_mutation(op, context)?
        } else {
            self.runtime_mut()
                .execute(op, context)
                .map_err(|error| Refusal::from_runtime(&error))?
        };
        Ok(execution_json(&execution))
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
        events: SseSender,
    ) -> Result<Json, Refusal> {
        let principal = self.principal(identity)?;
        let context = self.context(principal, &op, args)?;
        let (id, execution) = self
            .runtime_mut()
            .subscribe(&op, context.clone())
            .map_err(|error| Refusal::from_runtime(&error))?;
        let (data, terminal) = live_frame(Ok(&execution), execution.seq);
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
                runtime_id: id,
                op,
                context,
                last_frame: data,
                events,
            },
        );
        Ok(json!({ "id": id, "seq": execution.seq }))
    }

    fn channel_subscribe(
        &mut self,
        name: String,
        args: Json,
        identity: Identity,
        events: SseSender,
    ) -> Result<Json, Refusal> {
        let principal = self.principal(identity)?;
        let args = channel_args(self.runtime().generation(), &name, &args)?;
        let mut context = Context::query(actor(&principal)?, BTreeMap::new());
        context.now = Some(self.now());
        let verdict = self
            .runtime_mut()
            .channel_admit(&name, ChannelSide::Subscribe, &args, &context)
            .map_err(|error| Refusal::from_runtime(&error))?;
        if !verdict.admitted {
            return Err(Refusal::new(
                "E_RULE_CHANNEL_SUBSCRIBE",
                "rule",
                format!("principal is not admitted to channel {name}"),
                "use channel arguments and a principal admitted by the subscribe rule",
                "rule/channels",
            ));
        }
        self.next_channel += 1;
        let id = self.next_channel;
        self.channels.insert(
            id,
            ChannelClient {
                name,
                args,
                context,
                verdict,
                events,
            },
        );
        Ok(json!({ "id": id }))
    }

    fn channel_publish(
        &mut self,
        name: String,
        args: Json,
        payload: Json,
        identity: Identity,
    ) -> Result<Json, Refusal> {
        let principal = self.principal(identity)?;
        let args = channel_args(self.runtime().generation(), &name, &args)?;
        let mut context = Context::query(actor(&principal)?, BTreeMap::new());
        context.now = Some(self.now());
        let verdict = self
            .runtime_mut()
            .channel_admit(&name, ChannelSide::Publish, &args, &context)
            .map_err(|error| Refusal::from_runtime(&error))?;
        if !verdict.admitted {
            let seq = self
                .runtime()
                .store()
                .commit_seq()
                .map_err(|error| Refusal::from_runtime(&error))?;
            return Ok(refusal_frame(
                Refusal::new(
                    "E_RULE_CHANNEL_PUBLISH",
                    "rule",
                    format!("principal is not admitted to publish on channel {name}"),
                    "use channel arguments and a principal admitted by the publish rule",
                    "rule/channels",
                ),
                seq,
            )
            .0);
        }
        let at = self.now();
        let seq = self
            .runtime()
            .store()
            .commit_seq()
            .map_err(|error| Refusal::from_runtime(&error))?;
        let event = SseEvent {
            seq: Some(seq),
            data: json!({ "from": principal.id, "payload": payload, "at": at }),
            terminal: false,
        };
        self.channels.retain(|_, subscriber| {
            if subscriber.name == name && subscriber.args == args {
                subscriber.events.try_send(event.clone()).is_ok()
            } else {
                true
            }
        });
        Ok(json!({ "ok": true }))
    }

    fn after_commit(&mut self, seq: u64) -> Result<(), Refusal> {
        let commit = self
            .runtime()
            .store()
            .commits_since(seq.saturating_sub(1), 1)
            .map_err(|error| Refusal::from_runtime(&error))?
            .into_iter()
            .find(|commit| commit.seq == seq)
            .ok_or_else(|| {
                Refusal::owner(
                    "E_OWNER_COMMIT_MISSING",
                    format!("commit {seq} was not recorded"),
                    "inspect the store and restart the owner",
                )
            })?;
        let invalidated = self.runtime().invalidated(&commit);
        let clients = self
            .live
            .iter()
            .filter_map(|(id, client)| invalidated.contains(&client.runtime_id).then_some(*id))
            .collect::<Vec<_>>();
        let deliveries = self.rerun_live(&clients, false);
        self.ledger.push_back(CommitLedger {
            seq,
            invalidated: clients,
            deliveries,
        });
        while self.ledger.len() > 1_000 {
            self.ledger.pop_front();
        }
        self.readmit_channels(&commit);
        if commit.emits > 0 {
            self.wake_effects();
        }
        Ok(())
    }

    fn rerun_live(&mut self, ids: &[u64], force: bool) -> Vec<LedgerDelivery> {
        let mut deliveries = Vec::new();
        for id in ids {
            let Some(mut client) = self.live.get(id).cloned() else {
                continue;
            };
            self.runtime_mut().unsubscribe(client.runtime_id);
            let now = self.now();
            client.context.now = Some(now);
            client.context.read_time = Some(now);
            match self
                .runtime_mut()
                .subscribe(&client.op, client.context.clone())
            {
                Ok((runtime_id, execution)) => {
                    let (frame, terminal) = live_frame(Ok(&execution), execution.seq);
                    let changed = frame_digest(&frame) != frame_digest(&client.last_frame);
                    client.runtime_id = runtime_id;
                    client.last_frame = frame.clone();
                    if force || changed {
                        let _ = client.events.send_latest(SseEvent {
                            seq: Some(execution.seq),
                            data: frame,
                            terminal,
                        });
                        deliveries.push(LedgerDelivery {
                            id: *id,
                            seq: execution.seq,
                        });
                    }
                    self.live.insert(*id, client);
                }
                Err(error) => {
                    let seq = self.runtime().store().commit_seq().unwrap_or_default();
                    let (frame, terminal) = live_frame(Err(Refusal::from_runtime(&error)), seq);
                    let _ = client.events.send_latest(SseEvent {
                        seq: Some(seq),
                        data: frame,
                        terminal,
                    });
                    deliveries.push(LedgerDelivery { id: *id, seq });
                    self.live.remove(id);
                }
            }
        }
        deliveries
    }

    fn readmit_channels(&mut self, commit: &snapback2_core::CommitRecord) {
        let touched: Vec<u64> = self
            .channels
            .iter()
            .filter_map(|(id, client)| {
                Runtime::channel_touched(commit, &client.verdict).then_some(*id)
            })
            .collect();
        self.readmit_channel_ids(touched, commit.seq);
    }

    fn readmit_channel_ids(&mut self, ids: Vec<u64>, seq: u64) {
        for id in ids {
            let Some(client) = self.channels.get(&id).cloned() else {
                continue;
            };
            match self.runtime_mut().channel_admit(
                &client.name,
                ChannelSide::Subscribe,
                &client.args,
                &client.context,
            ) {
                Ok(verdict) if verdict.admitted => {
                    if let Some(current) = self.channels.get_mut(&id) {
                        current.verdict = verdict;
                    }
                }
                result => {
                    let refusal = result
                        .err()
                        .map(|error| Refusal::from_runtime(&error))
                        .unwrap_or_else(|| {
                            Refusal::new(
                                "E_RULE_CHANNEL_SUBSCRIBE",
                                "rule",
                                format!(
                                    "principal is no longer admitted to channel {}",
                                    client.name
                                ),
                                "restore channel membership or use arguments admitted by the subscribe rule",
                                "rule/channels",
                            )
                        });
                    let (data, terminal) = refusal_frame(refusal, seq);
                    let _ = client.events.send_latest(SseEvent {
                        seq: Some(seq),
                        data,
                        terminal,
                    });
                    self.channels.remove(&id);
                }
            }
        }
    }

    fn apply(
        &mut self,
        compiled: CompiledProject,
        migration: Option<MigrationPlan>,
        seed: Option<SeedData>,
    ) -> Result<Json, Refusal> {
        let seq = self
            .runtime()
            .store()
            .commit_seq()
            .map_err(|error| Refusal::from_runtime(&error))?;
        let report = if let Some(plan) = migration {
            self.runtime_mut()
                .apply_migration(compiled.generation.clone(), &plan)
                .map_err(|error| Refusal::from_runtime(&error))?
        } else {
            self.runtime_mut()
                .apply_successor(compiled.generation.clone())
                .map_err(|error| Refusal::from_successor(&error))?
        };
        self.compiled = compiled;
        if let Some(seed) = seed {
            self.seed = seed;
        }
        let channels = self.channels.keys().copied().collect();
        self.readmit_channel_ids(channels, seq);
        self.owner.generation = self.compiled.generation.hash();
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

    fn reset(&mut self) -> Result<Json, Refusal> {
        let seed = self.seed.clone();
        let rows = seed_rows(&seed, &self.compiled)?;
        let now = self.now();
        for persona in &seed.personas {
            self.runtime_mut()
                .persona(persona, now)
                .map_err(|error| Refusal::from_identity(&error))?;
        }
        let seq = self
            .runtime_mut()
            .reset_and_seed(&rows)
            .map_err(|error| Refusal::from_runtime(&error))?;
        let runtime_ids = self
            .live
            .values()
            .map(|client| client.runtime_id)
            .collect::<Vec<_>>();
        for id in runtime_ids {
            self.runtime_mut().unsubscribe(id);
        }
        self.live.clear();
        self.channels.clear();
        self.ledger.clear();
        self.wake_effects();
        Ok(json!({ "ok": true, "seq": seq }))
    }

    fn data(
        &mut self,
        table_name: String,
        index_name: String,
        prefix: Json,
        after: Option<Json>,
        limit: u32,
        identity: Identity,
    ) -> Result<Json, Refusal> {
        if limit == 0 || limit > 500 {
            return Err(Refusal::input(
                "data limit must be between 1 and 500",
                "pass --limit 1..500",
            ));
        }
        let table = self
            .runtime()
            .generation()
            .schema()
            .tables
            .get(&table_name)
            .cloned()
            .ok_or_else(|| {
                Refusal::new(
                    "E_SCHEMA_TABLE_UNKNOWN",
                    "schema",
                    format!("unknown table {table_name}"),
                    "use a table listed by /api/manifest",
                    "schema/tables",
                )
            })?;
        let certified_limit = max_certified_page_rows(
            self.runtime().generation().schema(),
            &table_name,
            &Ceilings::default(),
        )
        .min(500);
        if certified_limit == 0 {
            return Err(Refusal::new(
                "E_BOUND",
                "bound",
                format!("declared rows from {table_name} exceed the data output ceiling"),
                "lower the table's declared serialized row maximum",
                "bound/output",
            ));
        }
        let limit = limit.min(certified_limit);
        let index = table.indexes.get(&index_name).ok_or_else(|| {
            Refusal::new(
                "E_SCHEMA_INDEX_UNKNOWN",
                "schema",
                format!("unknown index {table_name}.{index_name}"),
                "use an index declared by the table",
                "schema/indexes",
            )
        })?;
        let prefix_values = prefix.as_array().ok_or_else(|| {
            Refusal::input("data prefix must be a JSON array", "pass --prefix '[...]'")
        })?;
        if prefix_values.len() > index.columns.len() {
            return Err(Refusal::input(
                "data prefix is longer than the index key",
                "remove extra prefix values",
            ));
        }
        let mut converted = Vec::new();
        for (position, value) in prefix_values.iter().enumerate() {
            let column = table
                .columns
                .get(&index.columns[position])
                .expect("certified index column");
            converted.push(json_as_kind(value, column)?);
        }
        let after = match after {
            Some(value) => {
                let Some(column_name) = index.columns.get(prefix_values.len()) else {
                    return Err(Refusal::input(
                        "data after requires an index column after the prefix",
                        "shorten the prefix or omit after",
                    ));
                };
                let column = table
                    .columns
                    .get(column_name)
                    .expect("certified index column");
                Some(json_as_kind(&value, column)?)
            }
            None => None,
        };
        let program = Program {
            name: format!("__owner.data.{table_name}"),
            kind: ProgramKind::Query,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Return(Expr::Scan(Scan {
                site: format!("<owner:data:{table_name}.{index_name}>"),
                table: table_name,
                index: index_name,
                prefix: converted.into_iter().map(Expr::Literal).collect(),
                order: Order::Asc,
                take: Bound::Literal(limit),
                after: after.map(|value| Box::new(Expr::Literal(value))),
                before: None,
                range: None,
                provenance: KeyProvenance::Const,
            }))],
        };
        let principal = self.principal(identity)?;
        let mut context = Context::query(actor(&principal)?, BTreeMap::new());
        let now = self.now();
        context.now = Some(now);
        context.read_time = Some(now);
        context.new_ids = (0..1024).map(|_| next_id()).collect::<VecDeque<_>>();
        let execution = self
            .runtime_mut()
            .execute_adhoc(&program, context)
            .map_err(|error| Refusal::from_runtime(&error))?;
        let mut response = execution_json(&execution);
        if let Some(object) = response.as_object_mut() {
            object.insert("trace".to_owned(), json!(execution.trace));
        }
        Ok(response)
    }

    fn rule_verdicts(&mut self, table_name: String, identity: Identity) -> Result<Json, Refusal> {
        let principal = self.principal(identity)?;
        let context = Context::query(actor(&principal)?, BTreeMap::new());
        let rows = self
            .runtime_mut()
            .read_rule_verdicts(&table_name, context)
            .map_err(|error| Refusal::from_runtime(&error))?;
        Ok(json!({ "table": table_name, "as": principal.id, "rows": rows }))
    }

    fn now(&self) -> i64 {
        unix_millis().saturating_add(self.clock_offset_ms)
    }
}

fn actor(principal: &Principal) -> Result<Actor, Refusal> {
    Actor::try_from(principal).map_err(|error| {
        Refusal::new(
            "E_AUTH_RESERVED",
            "auth",
            error.to_string(),
            "authenticate as a user, guest, or development persona",
            "auth/identity",
        )
    })
}

#[cfg(test)]
#[path = "writer_effects_tests.rs"]
mod effects_tests;

fn operation_args(
    generation: &Generation,
    op: &str,
    args: &Json,
) -> Result<BTreeMap<String, Value>, Refusal> {
    let program = &generation
        .programs()
        .get(op)
        .ok_or_else(|| {
            Refusal::new(
                "E_OP_UNKNOWN",
                "op",
                format!("unknown operation {op}"),
                "use /api/manifest",
                "op/manifest",
            )
        })?
        .0;
    let object = args.as_object().ok_or_else(|| {
        Refusal::input(
            "operation args must be a JSON object",
            "pass {} when there are no args",
        )
    })?;
    let unknown: Vec<_> = object
        .keys()
        .filter(|key| !program.args.contains_key(*key))
        .cloned()
        .collect();
    if !unknown.is_empty() {
        return Err(Refusal::input(
            format!("unknown operation args: {}", unknown.join(", ")),
            "remove args not declared by the operation",
        ));
    }
    let mut values = BTreeMap::new();
    for (name, kind) in &program.args {
        let Some(value) = object.get(name) else {
            if matches!(kind, ArgType::Optional(_)) {
                values.insert(name.clone(), Value::Null);
            }
            continue;
        };
        values.insert(name.clone(), json_as_arg(value, kind)?);
    }
    Ok(values)
}

fn frame_digest(frame: &Json) -> String {
    let mut value = frame.clone();
    if let Some(object) = value.as_object_mut() {
        object.remove("seq");
    }
    serde_json::to_string(&value).unwrap_or_default()
}

fn channel_args(
    generation: &Generation,
    name: &str,
    args: &Json,
) -> Result<BTreeMap<String, Value>, Refusal> {
    let channel = generation.schema().channels.get(name).ok_or_else(|| {
        Refusal::new(
            "E_OP_CHANNEL_UNKNOWN",
            "op",
            format!("unknown channel {name}"),
            "use a channel listed by /api/manifest",
            "op/channels",
        )
    })?;
    let object = args.as_object().ok_or_else(|| {
        Refusal::input(
            "channel args must be a JSON object",
            "pass {\"arg\": value}",
        )
    })?;
    channel
        .args
        .iter()
        .map(|(name, kind)| {
            let value = match object.get(name) {
                Some(value) => json_as_arg(value, kind)?,
                None if matches!(kind, ArgType::Optional(_)) => Value::Null,
                None => {
                    return Err(Refusal::input(
                        format!("channel is missing arg {name}"),
                        "pass every required channel arg",
                    ));
                }
            };
            Ok((name.clone(), value))
        })
        .collect()
}

fn json_as_arg(value: &Json, kind: &ArgType) -> Result<Value, Refusal> {
    match kind {
        ArgType::Optional(_) if value.is_null() => Ok(Value::Null),
        ArgType::Optional(inner) => json_as_arg(value, inner),
        ArgType::Id | ArgType::Ref { .. } => value
            .as_str()
            .map(|value| Value::Id(value.to_owned()))
            .ok_or_else(|| Refusal::input("id arguments must be strings", "pass a string id")),
        ArgType::List { of, .. } => value
            .as_array()
            .ok_or_else(|| Refusal::input("list arguments must be arrays", "pass a JSON array"))?
            .iter()
            .map(|value| match of {
                Some(of) => json_as_arg(value, of),
                None => json_to_value(value),
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        ArgType::Int | ArgType::Time | ArgType::Decimal { .. } | ArgType::Money { .. } => value
            .as_i64()
            .map(Value::Int)
            .ok_or_else(|| Refusal::input("numeric arguments must be integers", "pass an integer")),
        ArgType::Text { .. } | ArgType::Enum { .. } => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| {
                Refusal::input("text and enum arguments must be strings", "pass a string")
            }),
        ArgType::Bytes { .. } => json_as_bytes(value, "bytes arguments"),
        ArgType::Bool => value.as_bool().map(Value::Bool).ok_or_else(|| {
            Refusal::input("boolean arguments must be true or false", "pass a boolean")
        }),
        ArgType::Json { .. } | ArgType::Scalar => json_to_value(value),
    }
}

fn json_as_kind(value: &Json, kind: &ColumnType) -> Result<Value, Refusal> {
    match kind {
        ColumnType::Optional(inner) => {
            if value.is_null() {
                Ok(Value::Null)
            } else {
                json_as_kind(value, inner)
            }
        }
        ColumnType::Id | ColumnType::Ref { .. } => value
            .as_str()
            .map(|value| Value::Id(value.to_owned()))
            .ok_or_else(|| Refusal::input("id index values must be strings", "pass a string id")),
        ColumnType::Text { .. } | ColumnType::Enum { .. } => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| Refusal::input("text index values must be strings", "pass a string")),
        ColumnType::Bytes { .. } => json_as_bytes(value, "bytes index values"),
        ColumnType::Int
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => value.as_i64().map(Value::Int).ok_or_else(|| {
            Refusal::input("numeric index values must be integers", "pass an integer")
        }),
        ColumnType::Bool => value.as_bool().map(Value::Bool).ok_or_else(|| {
            Refusal::input(
                "boolean index values must be true or false",
                "pass a boolean",
            )
        }),
        ColumnType::Json { .. } | ColumnType::List { .. } => json_to_value(value),
    }
}

fn json_as_bytes(value: &Json, label: &str) -> Result<Value, Refusal> {
    let bytes = value
        .as_object()
        .filter(|object| object.len() == 1)
        .and_then(|object| object.get("Bytes"))
        .and_then(Json::as_str)
        .and_then(snapback2_core::decode_bytes_hex)
        .ok_or_else(|| {
            Refusal::input(
                format!("{label} must use {{\"Bytes\":\"lowercase-base16\"}}"),
                "pass canonical lowercase even-length base16",
            )
        })?;
    Ok(Value::Bytes(bytes))
}
