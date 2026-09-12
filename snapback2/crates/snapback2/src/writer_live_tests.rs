use super::*;
use crate::blob_store::{FileBlobStore, LocalStaging};
use crate::owner::OwnerInfo;
use crate::project::{CompiledProject, SeedData};
use crate::writer_util::unix_millis;
use snapback2_core::{
    Auth, ColumnType, Index, IndexComponent, ProjectJson, Schema, Store, public_table,
};
use std::sync::atomic::AtomicU64;

static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);

fn point_read(op: &str, table: &str, index: &str, argument: &str) -> Program {
    Program {
        name: op.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([(argument.to_owned(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(snapback2_core::Read {
            site: format!("{op}.read"),
            table: table.to_owned(),
            index: index.to_owned(),
            key: vec![Expr::Variable(argument.to_owned())],
            provenance: KeyProvenance::Arg,
        }))],
    }
}

fn connected_read() -> Program {
    Program {
        name: "presence.count".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("principal".to_owned(), ArgType::Principal)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(snapback2_core::Read {
            site: "presence.count.read".to_owned(),
            table: snapback2_core::CONNECTED_TABLE.to_owned(),
            index: snapback2_core::CONNECTED_INDEX.to_owned(),
            key: vec![Expr::Variable("principal".to_owned())],
            provenance: KeyProvenance::Arg,
        }))],
    }
}

fn project(programs: Vec<Program>) -> ProjectJson {
    ProjectJson {
        version: 1,
        schema: Schema {
            tables: BTreeMap::from([(
                "items".to_owned(),
                public_table(
                    BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        ("value".to_owned(), ColumnType::Int),
                    ]),
                    BTreeMap::from([(
                        "byId".to_owned(),
                        Index {
                            components: vec![IndexComponent::Column("id".to_owned())],
                            unique: true,
                        },
                    )]),
                ),
            )]),
            ..Schema::default()
        },
        programs,
        effects: Vec::new(),
        auth: Auth::default(),
    }
}

fn programs() -> Vec<Program> {
    vec![
        point_read("items.point", "items", "byId", "key"),
        connected_read(),
        Program {
            name: "items.change".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([
                ("key".to_owned(), ArgType::Id),
                ("value".to_owned(), ArgType::Int),
            ]),
            read_time_granularity_ms: None,
            body: vec![
                Stmt::Update {
                    table: "items".to_owned(),
                    key: Expr::Variable("key".to_owned()),
                    patch: Expr::Object(BTreeMap::from([(
                        "value".to_owned(),
                        Expr::Variable("value".to_owned()),
                    )])),
                },
                Stmt::Return(Expr::Literal(Value::Bool(true))),
            ],
        },
    ]
}

fn compiled(project: &ProjectJson, generation: Generation) -> CompiledProject {
    CompiledProject {
        project: project.clone(),
        generation,
        api_dts: String::new(),
        compiler_ms: 0.0,
        quarry: Vec::new(),
        sources: Default::default(),
    }
}

pub(super) fn state(label: &str) -> State {
    let project = project(programs());
    let generation = Generation::certify(&project, Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation.clone()).unwrap();
    runtime
        .seed(&[(
            "items".to_owned(),
            snapback2_core::object([
                ("id", Value::Id("target".to_owned())),
                ("value", Value::Int(0)),
            ]),
        )])
        .unwrap();
    state_from(label, project, generation, runtime)
}

/// A writer state over a prepared runtime; the effects seam tests hand in a
/// store that already holds queued outbox rows.
pub(super) fn state_from(
    label: &str,
    project: ProjectJson,
    generation: Generation,
    runtime: Runtime,
) -> State {
    let nonce = NEXT_ROOT.fetch_add(1, AtomicOrdering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "snapback2-writer-live-{label}-{}-{nonce}",
        std::process::id()
    ));
    std::fs::create_dir_all(root.join(".snapback")).unwrap();
    let blobs: Arc<dyn BlobStore> = Arc::new(FileBlobStore::open(&root).unwrap());
    let staging = Arc::new(LocalStaging::open(&root).unwrap());
    State {
        connected: Default::default(),
        runtime: Some(runtime),
        compiled: compiled(&project, generation),
        seed: SeedData::default(),
        root: root.clone(),
        mode: "dev".to_owned(),
        phase: json!("ready"),
        live: BTreeMap::new(),
        last_live_dispatch_work: 0,
        channels: BTreeMap::new(),
        ledger: VecDeque::new(),
        operator_rejection: None,
        next_channel: 0,
        channel_dirty: BTreeSet::new(),
        clock_offset_ms: 0,
        restarted_through_seq: 0,
        stop: Arc::new(AtomicBool::new(false)),
        owner: OwnerInfo {
            pid: 0,
            port: 0,
            url: String::new(),
            secret: "test-secret".to_owned(),
            generation: String::new(),
            started_at: unix_millis(),
            mode: "dev".to_owned(),
            project: root,
        },
        exited: false,
        effects_wake: None,
        outbox_observation: Default::default(),
        effect_bindings: None,
        asset_carriers: BTreeMap::new(),
        blobs,
        staging,
        media_jobs: Default::default(),
        asset_reclaim_after: String::new(),
        asset_blob_continuation: None,
        asset_sweep_pending: None,
        next_asset_sweep: Instant::now() + ASSET_SWEEP_INTERVAL,
    }
}

/// An in-process writer over `project`, on a fresh in-memory store.
pub(super) fn state_with(label: &str, project: ProjectJson) -> State {
    let generation = Generation::certify(&project, Ceilings::default()).unwrap();
    let runtime = Runtime::open(Store::memory().unwrap(), generation.clone()).unwrap();
    state_from(label, project, generation, runtime)
}

fn subscribe(state: &mut State, op: &str, args: Json) -> (u64, SseReceiver) {
    let (events, receiver) = sse_queue();
    let response = state
        .subscribe(
            op.to_owned(),
            args,
            Identity::Persona("observer".to_owned()),
            OfflineOptions {
                receipt: true,
                drain: false,
                validator: None,
            },
            events,
        )
        .unwrap();
    let id = response["id"].as_u64().unwrap();
    let initial = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
    assert_eq!(initial.terminal, false);
    assert_eq!(initial.seq, initial.data["seq"].as_u64());
    assert!(initial.data["receipt"].is_object());
    assert!(initial.data["validator"].as_str().is_some());
    (id, receiver)
}

fn assert_identity(state: &State) {
    let owner_ids = state.live.keys().copied().collect::<Vec<_>>();
    let runtime_ids = state
        .runtime()
        .subscriptions()
        .into_iter()
        .map(|entry| entry.id)
        .collect::<Vec<_>>();
    assert_eq!(owner_ids, runtime_ids);
}

fn point_case(total: usize, affected: usize) {
    let mut state = state(&format!("point-{total}-{affected}"));
    let mut receivers = Vec::with_capacity(total);
    let mut affected_ids = Vec::with_capacity(affected);
    for index in 0..total {
        let key = if index < affected {
            "target".to_owned()
        } else {
            format!("other-{index}")
        };
        let (id, receiver) = subscribe(&mut state, "items.point", json!({ "key": key }));
        if index < affected {
            affected_ids.push(id);
        }
        receivers.push((index < affected, receiver));
    }
    assert_identity(&state);
    let execution = state
        .runtime_mut()
        .execute(
            "items.change",
            Context::mutation(
                Actor::persona("writer").unwrap(),
                BTreeMap::from([
                    ("key".to_owned(), Value::Id("target".to_owned())),
                    ("value".to_owned(), Value::Int(1)),
                ]),
            ),
        )
        .unwrap();
    assert!(matches!(execution.state, ExecutionState::Committed { .. }));
    let started = Instant::now();
    state.after_commit(execution.seq).unwrap();
    let elapsed = started.elapsed();
    assert_eq!(state.last_live_dispatch_work, affected);
    let ledger = state.ledger.back().unwrap();
    assert_eq!(ledger.invalidated, affected_ids);
    assert_eq!(ledger.deliveries.len(), affected);
    for (is_affected, receiver) in receivers {
        match receiver.recv_timeout(Duration::ZERO) {
            Ok(frame) => {
                assert!(is_affected, "an unrelated subscription received a frame");
                assert_eq!(frame.seq, Some(execution.seq));
                assert_eq!(frame.data["seq"], execution.seq);
                let row = frame.data["rows"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|row| row["table"] == "items" && row["id"] == "target")
                    .unwrap();
                assert_eq!(row["row"]["id"], "target");
                assert_eq!(row["row"]["value"], 1);
                assert_eq!(frame.data["state"], "complete");
                assert!(frame.data["receipt"].is_object());
                assert!(frame.data["validator"].as_str().is_some());
                assert!(!frame.terminal);
            }
            Err(RecvTimeoutError::Timeout) => assert!(!is_affected),
            Err(error) => panic!("subscription queue failed: {error:?}"),
        }
    }
    assert_identity(&state);
    println!(
        "OWNER_LIVE_DISPATCH {}",
        json!({
            "path": "after_commit",
            "total": total,
            "affected": affected,
            "dispatchLookups": state.last_live_dispatch_work,
            "elapsedNanos": elapsed.as_nanos(),
            "expiry": "next-session lookup; no expired authority and therefore no live-session scan",
            "channels": "empty registry still executes readmission selection",
        })
    );
    std::fs::remove_dir_all(&state.root).unwrap();
}

fn connected_case(total: usize, affected: usize) {
    let mut state = state(&format!("connected-{total}-{affected}"));
    let mut receivers = Vec::with_capacity(total);
    let mut affected_ids = Vec::with_capacity(affected);
    for index in 0..total {
        let principal = if index < affected {
            "dev:target".to_owned()
        } else {
            format!("dev:other-{index}")
        };
        let (id, receiver) = subscribe(
            &mut state,
            "presence.count",
            json!({ "principal": principal }),
        );
        if index < affected {
            affected_ids.push(id);
        }
        receivers.push((index < affected, receiver));
    }
    assert_identity(&state);
    let (events, _connection) = sse_queue();
    state
        .connected_open(Identity::Persona("target".to_owned()), events)
        .unwrap();
    let started = Instant::now();
    state.flush_connected_now();
    let elapsed = started.elapsed();
    assert_eq!(state.last_live_dispatch_work, affected);
    for (is_affected, receiver) in receivers {
        match receiver.recv_timeout(Duration::ZERO) {
            Ok(frame) => {
                assert!(
                    is_affected,
                    "an unrelated connected subscription received a frame"
                );
                assert_eq!(frame.seq, frame.data["seq"].as_u64());
                assert_eq!(frame.data["data"]["principal"], "dev:target");
                assert_eq!(frame.data["data"]["value"], 1);
                assert_eq!(frame.data["connected"], true);
                assert!(frame.data["receipt"].is_object());
                assert!(frame.data["validator"].as_str().is_some());
                assert!(!frame.terminal);
            }
            Err(RecvTimeoutError::Timeout) => assert!(!is_affected),
            Err(error) => panic!("subscription queue failed: {error:?}"),
        }
    }
    assert_identity(&state);
    assert_eq!(
        state
            .runtime()
            .connected_invalidated(&BTreeSet::from(["dev:target".to_owned()])),
        affected_ids
    );
    println!(
        "OWNER_LIVE_DISPATCH {}",
        json!({
            "path": "connected",
            "total": total,
            "affected": affected,
            "dispatchLookups": state.last_live_dispatch_work,
            "elapsedNanos": elapsed.as_nanos(),
            "coalescing": "deadline accelerated only after the real connection changed the runtime snapshot",
        })
    );
    std::fs::remove_dir_all(&state.root).unwrap();
}

#[test]
fn owner_dispatch_uses_core_ids_for_actual_commit_and_connected_frames() {
    for total in [200, 2_000] {
        for affected in [1, 50] {
            point_case(total, affected);
            connected_case(total, affected);
        }
    }
}

#[test]
fn live_ids_survive_clock_and_successor_reruns_and_terminal_cleanup_detaches_once() {
    let mut state = state("lifecycle");
    let (id, receiver) = subscribe(&mut state, "items.point", json!({ "key": "target" }));
    assert_identity(&state);

    state.handle(Action::Clock { advance_ms: 1 }).unwrap();
    assert_eq!(state.live.keys().copied().collect::<Vec<_>>(), vec![id]);
    assert_identity(&state);

    let same_project = state.compiled.project.clone();
    let same_generation = Generation::certify(&same_project, Ceilings::default()).unwrap();
    state
        .apply(compiled(&same_project, same_generation), None, None, None)
        .unwrap();
    let successor = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
    assert_eq!(successor.seq, successor.data["seq"].as_u64());
    assert!(!successor.terminal);
    assert_eq!(state.live.keys().copied().collect::<Vec<_>>(), vec![id]);
    assert_identity(&state);

    let removed_project = project(Vec::new());
    let removed_generation = Generation::certify(&removed_project, Ceilings::default()).unwrap();
    state
        .apply(
            compiled(&removed_project, removed_generation),
            None,
            None,
            None,
        )
        .unwrap();
    let terminal = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
    assert_eq!(terminal.seq, terminal.data["seq"].as_u64());
    assert_eq!(terminal.data["state"], "refused");
    assert!(terminal.terminal);
    assert!(state.live.is_empty());
    assert!(state.runtime().subscriptions().is_empty());

    state.handle(Action::Unsubscribe { id }).unwrap();
    assert!(state.live.is_empty());
    assert!(state.runtime().subscriptions().is_empty());
    std::fs::remove_dir_all(&state.root).unwrap();
}

#[test]
fn mutation_generation_fence_is_atomic_and_replay_terminals_survive_successors() {
    let mut state = state("generation-fence");
    let generation = state.runtime().generation().program_hash().to_owned();
    let authority = state.resolve_authority(Identity::Persona("alice".into())).unwrap();
    let grant = state.mint_replay_grant(authority.principal.id.as_str()).unwrap();
    let request = |offset, expected: &str| Action::Execute {
        op: "items.change".into(), args: json!({"key":"target", "value":7}),
        identity: Identity::Persona("alice".into()), expected: Some(ProgramKind::Mutation),
        expected_generation: Some(json!(expected)), offline: OfflineOptions::default(),
        replay: Some(json!({"grant":grant.id,"offset":offset,"count":1,
            "intent":format!("{}:{offset}",grant.id),"trace":{"points":[],"verdicts":[]}})),
    };
    let committed = state.handle(request(0, &generation)).unwrap();
    assert_eq!(committed["state"], "committed");
    let mut successor = state.compiled.project.clone();
    successor.programs.iter_mut().find(|p| p.name == "items.change").unwrap().body.pop();
    let next = Generation::certify(&successor, Ceilings::default()).unwrap();
    state.apply(compiled(&successor, next), None, None, None).unwrap();
    let seq = state.runtime().store().commit_seq().unwrap();
    assert_eq!(state.handle(request(0, &generation)).unwrap(), committed);
    let rejected = state.handle(request(1, &generation)).unwrap();
    assert_eq!(rejected["reason"], "generation_changed");
    assert_eq!(rejected["code"], "E_GENERATION_CHANGED");
    assert_eq!(state.runtime().store().commit_seq().unwrap(), seq);
    assert_eq!(state.handle(request(1, &generation)).unwrap(), rejected);
    let plain = state.handle(Action::Execute {
        op:"items.change".into(), args:json!({"key":"target","value":9}),
        identity:Identity::Persona("alice".into()), expected:Some(ProgramKind::Mutation),
        expected_generation:Some(json!(generation)), offline:OfflineOptions::default(), replay:None,
    }).unwrap();
    assert_eq!(plain["reason"], "generation_changed");
    assert_eq!(state.runtime().store().commit_seq().unwrap(), seq);
    for invalid in [Json::Null, json!(17), json!([]), json!("not-a-hash")] {
        let mut malformed = request(2, &generation);
        if let Action::Execute { expected_generation, .. } = &mut malformed { *expected_generation = Some(invalid); }
        assert_eq!(state.handle(malformed).unwrap_err().code, "E_INPUT");
    }
    let mut scheduled = state.compiled.project.clone();
    let target = scheduled.programs.iter_mut().find(|p| p.name == "items.change").unwrap();
    target.args.clear(); target.body = vec![Stmt::Return(Expr::Literal(Value::Null))];
    scheduled.programs.push(Program { name:"items.timerBinding".into(), kind:ProgramKind::Query,
        args:BTreeMap::new(), read_time_granularity_ms:None, body:vec![Stmt::Return(Expr::Object(BTreeMap::from([
            ("enabled".into(), Expr::Literal(Value::Bool(true))), ("args".into(), Expr::Object(BTreeMap::new()))
        ])))] });
    scheduled.schema.schedules.push(snapback2_core::timers::Schedule { name:"periodic".into(),
        trigger:snapback2_core::timers::Trigger::Every { duration_ms:86_400_000 }, target:"items.change".into(),
        binding:"items.timerBinding".into(), site:"test".into() });
    let next = Generation::certify(&scheduled, Ceilings::default()).unwrap();
    state.apply(compiled(&scheduled, next), None, None, None).unwrap();
    assert_eq!(state.handle(request(0, &generation)).unwrap(), committed);
    assert_eq!(state.handle(request(1, &generation)).unwrap(), rejected);
    let scheduled_generation = state.runtime().generation().program_hash().to_owned();
    let fresh = || {
        let mut action = request(2, &scheduled_generation);
        if let Action::Execute { args, .. } = &mut action { *args = json!({}); }
        action
    };
    let seq = state.runtime().store().commit_seq().unwrap();
    let denied = state.handle(fresh()).unwrap();
    assert_eq!(denied["state"], "rejected");
    assert_eq!(denied["code"], "E_OPERATOR_REQUIRED");
    assert_eq!(denied["intent"], format!("{}:2", grant.id));
    assert_eq!(state.runtime().store().commit_seq().unwrap(), seq);
    assert_eq!(state.handle(fresh()).unwrap(), denied);
    let restored = Generation::certify(&successor, Ceilings::default()).unwrap();
    state.apply(compiled(&successor, restored), None, None, None).unwrap();
    assert_eq!(state.handle(fresh()).unwrap(), denied,
        "restoring client eligibility must not execute a settled rejection");
    std::fs::remove_dir_all(&state.root).unwrap();
}

#[test]
fn guarded_mutation_conflicts_keep_the_current_row_on_plain_and_replay_wire() {
    let mut state = state("guarded-wire");
    let mut project = state.compiled.project.clone();
    project.programs.push(Program { name: "items.guarded".into(), kind: ProgramKind::Mutation,
        args: BTreeMap::new(), read_time_granularity_ms: None, body: vec![Stmt::Check {
            condition: Expr::Literal(Value::Bool(false)), current: snapback2_core::Read {
                site: "items.current".into(), table: "items".into(), index: "byId".into(),
                key: vec![Expr::Literal(Value::Id("target".into()))], provenance: KeyProvenance::Const,
            } }] });
    let generation = Generation::certify(&project, Ceilings::default()).unwrap();
    state.apply(compiled(&project, generation), None, None, None).unwrap();
    let actor = state.resolve_authority(Identity::Persona("alice".into())).unwrap();
    let grant = state.mint_replay_grant(actor.principal.id.as_str()).unwrap();
    let replay = json!({"grant":grant.id,"offset":0,"count":1,"intent":format!("{}:0",grant.id),
        "trace":{"points":[],"verdicts":[]}});
    let request = |replay| Action::Execute { op:"items.guarded".into(), args:json!({}),
        identity:Identity::Persona("alice".into()), expected:Some(ProgramKind::Mutation),
        expected_generation:None, offline:OfflineOptions::default(), replay };
    let seq = state.runtime().store().commit_seq().unwrap();
    for result in [state.handle(request(None)).unwrap(), state.handle(request(Some(replay.clone()))).unwrap()] {
        assert_eq!(result["state"], "rejected"); assert_eq!(result["reason"], "conflict");
        assert_eq!(result["code"], "E_CONFLICT"); assert_eq!(result["current"], json!({"id":"target","value":0}));
    }
    assert_eq!(state.runtime().store().commit_seq().unwrap(), seq);
    let result = state.handle(request(Some(replay))).unwrap();
    assert_eq!(result["current"]["value"], 0);
    std::fs::remove_dir_all(&state.root).unwrap();
}
