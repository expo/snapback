//! The one thread that owns `Runtime` and every store operation.
// @ref LLP 1002#5-the-owner — HTTP threads send work here; no second store opener exists.

use crate::project::{CompiledProject, SeedData, seed_rows};
use crate::protocol::{Refusal, json_to_value};
use crate::writer_util::{is_id_kind, next_id, owner_gone, recertify, unix_millis};
use crate::writer_wire::{execution_json, live_json};
use serde_json::{Map, Value as Json, json};
use snapback2_core::{
    ArgType, Bound, Ceilings, ChannelSide, ChannelVerdict, Checker, ColumnType, Context, Execution,
    ExecutionState, Expr, Generation, KeyProvenance, MigrationPlan, Order, Principal, Program,
    ProgramKind, RuleExpr, RuleTerm, Runtime, Scan, Stmt, Store, Value,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

#[derive(Clone, Debug)]
pub enum Identity {
    Bearer(String),
    Persona(String),
    Anonymous,
    #[allow(dead_code)] // Lane C uses this through `OwnerHandle::execute_system`.
    System,
}

#[derive(Clone, Debug)]
pub struct SseEvent {
    pub seq: Option<u64>,
    pub data: Json,
    pub terminal: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectsStatus {
    pub engine: String,
    pub queued: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub running: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent_unknown: Option<u64>,
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
        events: Sender<SseEvent>,
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

    /// Lane C's runner uses this to return an effect result through a named mutation.
    #[allow(dead_code)] // public seam for lane C's feature-gated effects module
    pub fn execute_system(&self, op: String, args: Json) -> Result<Json, Refusal> {
        self.call(Action::Execute {
            op,
            args,
            identity: Identity::System,
            expected: Some(ProgramKind::Mutation),
        })
    }

    /// Default-build outbox visibility. Lane C replaces this commit-derived count
    /// with its claim/read actions while keeping all access on this writer thread.
    #[allow(dead_code)] // public seam for lane C's feature-gated effects module
    pub fn outbox_queued(&self) -> Result<u64, Refusal> {
        self.call(Action::OutboxQueued)?
            .get("queued")
            .and_then(Json::as_u64)
            .ok_or_else(|| {
                Refusal::owner(
                    "E_OWNER_PROTOCOL",
                    "owner omitted outbox count",
                    "restart snapback2 dev",
                )
            })
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
        events: Sender<SseEvent>,
    },
    Unsubscribe {
        id: u64,
    },
    ChannelSubscribe {
        name: String,
        args: Json,
        identity: Identity,
        events: Sender<SseEvent>,
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
    Applying {
        generation: String,
    },
    Refused {
        refusal: Refusal,
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
        limit: u32,
        identity: Identity,
    },
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
    #[allow(dead_code)] // feature-gated lane C action
    OutboxQueued,
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
    events: Sender<SseEvent>,
}

#[derive(Clone)]
struct ChannelClient {
    name: String,
    args: BTreeMap<String, Value>,
    context: Context,
    verdict: ChannelVerdict,
    events: Sender<SseEvent>,
}

struct State {
    runtime: Option<Runtime>,
    compiled: CompiledProject,
    seed: SeedData,
    store_path: PathBuf,
    root: PathBuf,
    mode: String,
    phase: Json,
    live: BTreeMap<u64, LiveClient>,
    channels: BTreeMap<u64, ChannelClient>,
    next_channel: u64,
    clock_offset_ms: i64,
    stop: Arc<AtomicBool>,
}

pub fn spawn_writer(
    runtime: Runtime,
    compiled: CompiledProject,
    seed: SeedData,
    store_path: PathBuf,
    root: PathBuf,
    mode: String,
    stop: Arc<AtomicBool>,
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
                    store_path,
                    root,
                    mode,
                    phase: Json::String("ready".to_owned()),
                    live: BTreeMap::new(),
                    channels: BTreeMap::new(),
                    next_channel: 0,
                    clock_offset_ms: 0,
                    stop,
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

/// The landed `Runtime::seed` executes as `system` but still evaluates table
/// write rules. A seed is an owner-authorized system commit, so install an
/// in-memory allow-rule successor for that single commit and restore the
/// certified generation immediately afterward.
pub fn apply_seed(runtime: &mut Runtime, rows: &[(String, Value)]) -> Result<u64, Refusal> {
    if rows.is_empty() {
        return runtime
            .store()
            .commit_seq()
            .map_err(|error| Refusal::from_runtime(&error));
    }
    let original = runtime.generation().clone();
    let mut seed_generation = original.clone();
    for table in seed_generation.schema.tables.values_mut() {
        table.rules.insert = RuleExpr::Allow;
        table.rules.update = RuleExpr::Allow;
    }
    recertify(&mut seed_generation)?;
    runtime
        .apply_successor(seed_generation)
        .map_err(|error| Refusal::from_successor(&error))?;
    let result = runtime
        .seed(rows)
        .map_err(|error| Refusal::from_runtime(&error));
    runtime
        .apply_successor(original)
        .map_err(|error| Refusal::from_successor(&error))?;
    result
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
                self.runtime_mut().unsubscribe(id);
                self.live.remove(&id);
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
                refusal,
                generation,
            } => {
                self.phase = json!({
                    "state": "refused",
                    "generation": generation,
                    "refusal": refusal,
                });
                Ok(json!({ "ok": true }))
            }
            Action::Apply {
                compiled,
                migration,
                seed,
            } => self.apply(compiled, migration, seed),
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
                limit,
                identity,
            } => self.data(table, index, prefix, limit, identity),
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
                Ok(json!({ "ok": true, "offsetMs": self.clock_offset_ms }))
            }
            Action::OutboxQueued => Ok(json!({ "queued": self.outbox_queued()? })),
            Action::Stop { cause } => {
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
            Identity::System => Ok(Principal {
                id: "system".to_owned(),
                kind: "system".to_owned(),
                name: Some("system".to_owned()),
            }),
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
        let mut context = Context::query(principal.id, values);
        context.principal_kind = principal.kind;
        context.now = Some(self.now());
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
            .programs
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
        let original = self.runtime().generation().clone();
        let targets: BTreeSet<_> = original
            .schema
            .maintains
            .iter()
            .map(|maintain| maintain.target.clone())
            .collect();
        if targets.is_empty() {
            let execution = self
                .runtime_mut()
                .execute(op, context)
                .map_err(|error| Refusal::from_runtime(&error))?;
            if matches!(execution.state, ExecutionState::Committed { .. }) {
                self.after_commit(execution.seq)?;
            }
            return Ok(execution);
        }
        let mut admitted = original.clone();
        for target in targets {
            if let Some(table) = admitted.schema.tables.get_mut(&target) {
                table.rules.insert = RuleExpr::Allow;
                table.rules.update = RuleExpr::Allow;
            }
        }
        recertify(&mut admitted)?;
        self.runtime_mut()
            .apply_successor(admitted)
            .map_err(|error| Refusal::from_successor(&error))?;
        let result = self
            .runtime_mut()
            .execute(op, context)
            .map_err(|error| Refusal::from_runtime(&error));
        let fanout = result.as_ref().ok().and_then(|execution| {
            matches!(execution.state, ExecutionState::Committed { .. }).then_some(execution.seq)
        });
        let fanout_result = fanout.map(|seq| self.after_commit(seq)).transpose();
        if let Err(error) = self.runtime_mut().apply_successor(original) {
            let refusal = Refusal::from_successor(&error);
            crate::watch::log(
                &self.root,
                json!({ "exited": "fatal generation restore", "refusal": refusal }),
            );
            self.stop.store(true, AtomicOrdering::SeqCst);
            return Err(refusal);
        }
        fanout_result?;
        result
    }

    fn subscribe(
        &mut self,
        op: String,
        args: Json,
        identity: Identity,
        events: Sender<SseEvent>,
    ) -> Result<Json, Refusal> {
        let principal = self.principal(identity)?;
        let context = self.context(principal, &op, args)?;
        let (id, execution) = self
            .runtime_mut()
            .subscribe(&op, context.clone())
            .map_err(|error| Refusal::from_runtime(&error))?;
        events
            .send(SseEvent {
                seq: Some(execution.seq),
                data: live_json(Ok(&execution), execution.seq),
                terminal: false,
            })
            .map_err(|_| owner_gone())?;
        self.live.insert(
            id,
            LiveClient {
                op,
                context,
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
        events: Sender<SseEvent>,
    ) -> Result<Json, Refusal> {
        let principal = self.principal(identity)?;
        let args = channel_args(self.runtime().generation(), &name, &args)?;
        let mut context = Context::query(principal.id, BTreeMap::new());
        context.principal_kind = principal.kind;
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
        let mut context = Context::query(principal.id.clone(), BTreeMap::new());
        context.principal_kind = principal.kind;
        context.now = Some(self.now());
        let verdict = self
            .runtime_mut()
            .channel_admit(&name, ChannelSide::Publish, &args, &context)
            .map_err(|error| Refusal::from_runtime(&error))?;
        if !verdict.admitted {
            return Ok(json!({
                "state": "refused",
                "code": "E_RULE_CHANNEL_PUBLISH",
            }));
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
                subscriber.events.send(event.clone()).is_ok()
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
        let deliveries = self.runtime_mut().rerun(&invalidated);
        for delivery in deliveries.into_iter().filter(|delivery| delivery.changed) {
            if let Some(client) = self.live.get(&delivery.id) {
                let data = match delivery.execution.as_ref() {
                    Ok(execution) => live_json(Ok(execution), delivery.seq),
                    Err(error) => live_json(Err(Refusal::from_runtime(error)), delivery.seq),
                };
                let _ = client.events.send(SseEvent {
                    seq: Some(delivery.seq),
                    data,
                    terminal: false,
                });
            }
        }
        self.readmit_channels(&commit);
        Ok(())
    }

    fn readmit_channels(&mut self, commit: &snapback2_core::CommitRecord) {
        let touched: Vec<u64> = self
            .channels
            .iter()
            .filter_map(|(id, client)| {
                Runtime::channel_touched(commit, &client.verdict).then_some(*id)
            })
            .collect();
        for id in touched {
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
                    let code = result
                        .err()
                        .map(|error| error.code().to_owned())
                        .unwrap_or_else(|| "E_RULE_CHANNEL_SUBSCRIBE".to_owned());
                    let _ = client.events.send(SseEvent {
                        seq: Some(commit.seq),
                        data: json!({ "state": "refused", "code": code }),
                        terminal: true,
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
        self.phase = Json::String("ready".to_owned());
        // The landed engine refreshes its subscription index during successor
        // apply but does not return those deliveries, so the owner sends one
        // explicit fresh execution to each connected subscriber.
        let clients: Vec<_> = self.live.values().cloned().collect();
        for client in clients {
            let delivery = self
                .runtime_mut()
                .execute(&client.op, client.context.clone());
            let seq = delivery
                .as_ref()
                .map(|execution| execution.seq)
                .unwrap_or_else(|_| self.runtime().store().commit_seq().unwrap_or(0));
            let data = match delivery.as_ref() {
                Ok(execution) => live_json(Ok(execution), seq),
                Err(error) => live_json(Err(Refusal::from_runtime(error)), seq),
            };
            let _ = client.events.send(SseEvent {
                seq: Some(seq),
                data,
                terminal: false,
            });
        }
        Ok(serde_json::to_value(report).unwrap_or(Json::Null))
    }

    fn reset(&mut self) -> Result<Json, Refusal> {
        let generation = self.compiled.generation.clone();
        let seed = self.seed.clone();
        self.runtime.take();
        let rebuilt = (|| {
            let mut store =
                Store::open(&self.store_path).map_err(|error| Refusal::from_runtime(&error))?;
            store
                .reset_data()
                .map_err(|error| Refusal::from_runtime(&error))?;
            let mut runtime = Runtime::open(store, generation)
                .map_err(|error| Refusal::from_successor(&error))?;
            let now = self.now();
            for persona in &seed.personas {
                runtime
                    .persona(persona, now)
                    .map_err(|error| Refusal::from_identity(&error))?;
            }
            let rows = seed_rows(&seed, &self.compiled)?;
            if !rows.is_empty() {
                apply_seed(&mut runtime, &rows)?;
            }
            Ok(runtime)
        })();
        let runtime = match rebuilt {
            Ok(runtime) => runtime,
            Err(error) => {
                crate::watch::log(
                    &self.root,
                    json!({ "exited": "fatal reset", "refusal": error }),
                );
                self.stop.store(true, AtomicOrdering::SeqCst);
                return Err(error);
            }
        };
        self.runtime = Some(runtime);
        self.live.clear();
        self.channels.clear();
        Ok(json!({ "ok": true, "seq": self.runtime().store().commit_seq().unwrap_or(0) }))
    }

    fn data(
        &mut self,
        table_name: String,
        index_name: String,
        prefix: Json,
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
            .schema
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
        let op = format!("__owner.data.{table_name}");
        let program = Program {
            name: op.clone(),
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
                after: None,
                before: None,
                range: None,
                provenance: KeyProvenance::Const,
            }))],
        };
        let certificate = Checker::new(&self.runtime().generation().schema, Ceilings::default())
            .check(&program)
            .map_err(|error| {
                Refusal::new(
                    error.code,
                    "bound",
                    error.message,
                    error.rewrite,
                    "bound/data",
                )
            })?;
        let mut next = self.runtime().generation().clone();
        next.programs.insert(op.clone(), (program, certificate));
        self.runtime_mut()
            .apply_successor(next)
            .map_err(|error| Refusal::from_successor(&error))?;
        self.execute(&op, json!({}), identity, Some(ProgramKind::Query))
    }

    fn why(&mut self, op: String, args: Json, identity: Identity) -> Result<Json, Refusal> {
        let principal = self.principal(identity)?;
        let context = self.context(principal, &op, args)?;
        let execution = self
            .runtime_mut()
            .execute(&op, context)
            .map_err(|error| Refusal::from_runtime(&error))?;
        Ok(json!({
            "op": op,
            "result": execution_json(&execution),
            "trace": execution.trace,
            "subscriptions": self.runtime().subscriptions().into_iter().filter(|subscription| subscription.op == op).collect::<Vec<_>>(),
        }))
    }

    fn trace(&self, seq: Option<u64>) -> Result<Json, Refusal> {
        let latest = self
            .runtime()
            .store()
            .commit_seq()
            .map_err(|error| Refusal::from_runtime(&error))?;
        let wanted = seq.unwrap_or(latest);
        let commit = self
            .runtime()
            .store()
            .commits_since(wanted.saturating_sub(1), 1)
            .map_err(|error| Refusal::from_runtime(&error))?
            .into_iter()
            .find(|commit| commit.seq == wanted)
            .ok_or_else(|| {
                Refusal::new(
                    "E_INPUT_TRACE_UNKNOWN",
                    "input",
                    format!("commit {wanted} is not retained"),
                    "pass latest or a retained commit seq",
                    "input/trace",
                )
            })?;
        let invalidated = self.runtime().invalidated(&commit);
        Ok(json!({
            "commit": commit,
            "outbox": { "emits": commit.emits, "engine": "none" },
            "invalidated": invalidated,
        }))
    }

    fn status(&self) -> Result<Json, Refusal> {
        let personas = self
            .runtime()
            .principals(Some("persona"))
            .map_err(|error| Refusal::from_identity(&error))?;
        Ok(json!({
            "project": self.root,
            "status": self.phase,
            "generation": self.runtime().generation().hash,
            "seq": self.runtime().store().commit_seq().map_err(|error| Refusal::from_runtime(&error))?,
            "subscriptions": self.live.len(),
            "channelSubscriptions": self.channels.len(),
            "effects": EffectsStatus {
                engine: "none".to_owned(),
                queued: self.outbox_queued()?,
                running: None,
                sent: None,
                failed: None,
                sent_unknown: None,
            },
            "personas": personas,
            "mode": self.mode,
        }))
    }

    fn manifest(&self) -> Json {
        let ops = self
            .runtime()
            .generation()
            .programs
            .iter()
            .filter(|(name, _)| !name.starts_with("__owner."))
            .map(|(name, (program, _))| {
                (
                    name.clone(),
                    json!({
                        "kind": match program.kind { ProgramKind::Query => "query", ProgramKind::Mutation => "mutation" },
                        "args": program.args,
                    }),
                )
            })
            .collect::<Map<_, _>>();
        json!({
            "generation": self.runtime().generation().hash,
            "ops": ops,
            "channels": self.runtime().generation().schema.channels,
            "auth": self.runtime().generation().schema.auth,
            "tables": self.runtime().generation().schema.tables.keys().collect::<Vec<_>>(),
        })
    }

    fn outbox_queued(&self) -> Result<u64, Refusal> {
        // With effects disabled every emitted row stays queued. `Store` does not
        // yet expose outbox reads publicly, so use its bounded commit ledger.
        Ok(self
            .runtime()
            .store()
            .commits_since(0, 10_000)
            .map_err(|error| Refusal::from_runtime(&error))?
            .iter()
            .map(|commit| commit.emits)
            .sum())
    }

    fn now(&self) -> i64 {
        unix_millis().saturating_add(self.clock_offset_ms)
    }
}

fn operation_args(
    generation: &Generation,
    op: &str,
    args: &Json,
) -> Result<BTreeMap<String, Value>, Refusal> {
    let program = &generation
        .programs
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
    let id_args = infer_id_args(program, generation);
    let mut values = BTreeMap::new();
    for (name, kind) in &program.args {
        let Some(value) = object.get(name) else {
            continue;
        };
        values.insert(
            name.clone(),
            json_as_arg(value, kind, id_args.contains(name))?,
        );
    }
    Ok(values)
}

fn channel_args(
    generation: &Generation,
    name: &str,
    args: &Json,
) -> Result<BTreeMap<String, Value>, Refusal> {
    let channel = generation.schema.channels.get(name).ok_or_else(|| {
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
    let id_args = channel_id_args(channel, generation);
    channel
        .args
        .iter()
        .map(|(name, kind)| {
            let value = object.get(name).ok_or_else(|| {
                Refusal::input(
                    format!("channel is missing arg {name}"),
                    "pass every channel arg",
                )
            })?;
            Ok((
                name.clone(),
                json_as_arg(value, kind, id_args.contains(name))?,
            ))
        })
        .collect()
}

fn json_as_arg(value: &Json, kind: &ArgType, id: bool) -> Result<Value, Refusal> {
    if id {
        return value
            .as_str()
            .map(|value| Value::Id(value.to_owned()))
            .ok_or_else(|| Refusal::input("id arguments must be strings", "pass a string id"));
    }
    match kind {
        ArgType::List { .. } => value
            .as_array()
            .ok_or_else(|| Refusal::input("list arguments must be arrays", "pass a JSON array"))?
            .iter()
            .map(json_to_value)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        ArgType::Decimal { .. } | ArgType::Money { .. } => {
            value.as_i64().map(Value::Int).ok_or_else(|| {
                Refusal::input(
                    "decimal and money arguments use integer minor units",
                    "pass an integer",
                )
            })
        }
        ArgType::Enum { .. } => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| {
                Refusal::input(
                    "enum arguments must be strings",
                    "pass a declared enum string",
                )
            }),
        ArgType::Scalar => json_to_value(value),
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

fn infer_id_args(program: &Program, generation: &Generation) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    for statement in &program.body {
        infer_statement(statement, generation, &mut ids);
    }
    ids
}

fn infer_statement(statement: &Stmt, generation: &Generation, ids: &mut BTreeSet<String>) {
    match statement {
        Stmt::Const { value, .. }
        | Stmt::Let { value, .. }
        | Stmt::Assign { value, .. }
        | Stmt::Push { value, .. }
        | Stmt::Return(value) => infer_expr(value, generation, ids),
        Stmt::If {
            condition,
            then_body,
            else_body,
        } => {
            infer_expr(condition, generation, ids);
            then_body
                .iter()
                .chain(else_body)
                .for_each(|statement| infer_statement(statement, generation, ids));
        }
        Stmt::For { domain, body, .. } => {
            if let snapback2_core::LoopDomain::Page(scan) = domain {
                infer_scan(scan, generation, ids);
            }
            body.iter()
                .for_each(|statement| infer_statement(statement, generation, ids));
        }
        Stmt::Require { condition, .. } => infer_expr(condition, generation, ids),
        Stmt::Insert { table, row } => infer_row_expr(table, row, generation, ids),
        Stmt::Update { table, key, patch } => {
            infer_expected(key, true, ids);
            infer_row_expr(table, patch, generation, ids);
        }
        Stmt::Upsert { table, key, row } => {
            infer_expected(key, true, ids);
            infer_row_expr(table, row, generation, ids);
        }
        Stmt::Delete { key, .. } => infer_expected(key, true, ids),
        Stmt::Emit { payload, .. } => infer_expr(payload, generation, ids),
        Stmt::Break | Stmt::Continue => {}
    }
}

fn infer_expr(expression: &Expr, generation: &Generation, ids: &mut BTreeSet<String>) {
    match expression {
        Expr::Get(read) | Expr::Exists(read) => infer_read(read, generation, ids),
        Expr::Scan(scan) => infer_scan(scan, generation, ids),
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => {
            infer_expr(base, generation, ids)
        }
        Expr::Array(values) | Expr::Builtin { args: values, .. } => values
            .iter()
            .for_each(|value| infer_expr(value, generation, ids)),
        Expr::Object(values) => values
            .values()
            .for_each(|value| infer_expr(value, generation, ids)),
        Expr::Binary { left, right, .. } => {
            infer_expr(left, generation, ids);
            infer_expr(right, generation, ids);
        }
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
    }
}

fn infer_read(read: &snapback2_core::Read, generation: &Generation, ids: &mut BTreeSet<String>) {
    if let Some(index) = generation
        .schema
        .tables
        .get(&read.table)
        .and_then(|table| table.indexes.get(&read.index))
    {
        for (position, expression) in read.key.iter().enumerate() {
            let is_id = index
                .columns
                .get(position)
                .and_then(|column| generation.schema.tables[&read.table].columns.get(column))
                .is_some_and(is_id_kind);
            infer_expected(expression, is_id, ids);
        }
    }
}

fn infer_scan(scan: &Scan, generation: &Generation, ids: &mut BTreeSet<String>) {
    if let Some(index) = generation
        .schema
        .tables
        .get(&scan.table)
        .and_then(|table| table.indexes.get(&scan.index))
    {
        for (position, expression) in scan.prefix.iter().enumerate() {
            let is_id = index
                .columns
                .get(position)
                .and_then(|column| generation.schema.tables[&scan.table].columns.get(column))
                .is_some_and(is_id_kind);
            infer_expected(expression, is_id, ids);
        }
    }
}

fn infer_row_expr(
    table: &str,
    expression: &Expr,
    generation: &Generation,
    ids: &mut BTreeSet<String>,
) {
    let Expr::Object(fields) = expression else {
        infer_expr(expression, generation, ids);
        return;
    };
    if let Some(table) = generation.schema.tables.get(table) {
        for (field, expression) in fields {
            infer_expected(
                expression,
                table.columns.get(field).is_some_and(is_id_kind),
                ids,
            );
        }
    }
}

fn infer_expected(expression: &Expr, id: bool, ids: &mut BTreeSet<String>) {
    if id && let Expr::Variable(name) = expression {
        ids.insert(name.clone());
    }
}

fn channel_id_args(channel: &snapback2_core::Channel, generation: &Generation) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    infer_rule_ids(&channel.publish, generation, &mut ids);
    infer_rule_ids(&channel.subscribe, generation, &mut ids);
    ids
}

fn infer_rule_ids(rule: &RuleExpr, generation: &Generation, ids: &mut BTreeSet<String>) {
    match rule {
        RuleExpr::Exists {
            table, index, key, ..
        } => {
            if let Some(definition) = generation
                .schema
                .tables
                .get(table)
                .and_then(|table| table.indexes.get(index))
            {
                for (position, term) in key.iter().enumerate() {
                    if let RuleTerm::Field(name) = term {
                        let id = definition
                            .columns
                            .get(position)
                            .and_then(|column| generation.schema.tables[table].columns.get(column))
                            .is_some_and(is_id_kind);
                        if id {
                            ids.insert(name.clone());
                        }
                    }
                }
            }
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => rules
            .iter()
            .for_each(|rule| infer_rule_ids(rule, generation, ids)),
        RuleExpr::Not(rule) => infer_rule_ids(rule, generation, ids),
        _ => {}
    }
}
