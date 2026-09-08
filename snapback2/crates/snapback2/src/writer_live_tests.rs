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
    }
}

fn state(label: &str) -> State {
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
        asset_carriers: BTreeMap::new(),
        blobs,
        staging,
        pending_asset_deletes: BTreeSet::new(),
        next_asset_sweep: Instant::now() + ASSET_SWEEP_INTERVAL,
    }
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
