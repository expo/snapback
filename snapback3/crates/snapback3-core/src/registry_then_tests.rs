use super::*;
use crate::schema::Schema;
use crate::search_key::IndexComponent;
use crate::{Actor, ColumnType, Index, SYSTEM_PRINCIPAL_ID, public_table};
use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn execute_then_uses_the_private_reserved_system_context() {
    let mut admitted = pending_then_runtime("outbox-admitted");
    let execution = admitted
        .execute_then(
            "clock.then",
            BTreeMap::new(),
            15,
            None,
            VecDeque::new(),
            "outbox-admitted",
        )
        .unwrap();
    assert!(matches!(execution.state, ExecutionState::Committed { .. }));
    assert_eq!(
        admitted
            .store()
            .outbox_get("outbox-admitted")
            .unwrap()
            .unwrap()
            .state,
        "sent"
    );
    let commit = admitted.store().commits_since(0, 2).unwrap().pop().unwrap();
    assert_eq!(commit.principal, SYSTEM_PRINCIPAL_ID.as_str());
    assert_eq!(commit.kind, "system");
}

#[test]
fn rejected_then_fault_after_commit_cannot_replay_after_time_changes() {
    let path = temp_path();
    let generation = timed_then_generation();
    {
        let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation.clone()).unwrap();
        let mut emit = Context::mutation(Actor::user("user").unwrap(), BTreeMap::new());
        emit.now = Some(1);
        emit.new_ids = VecDeque::from(["outbox-1".to_owned()]);
        runtime.execute("clock.emit", emit).unwrap();
        runtime.claim_effect(1).unwrap().claimed.unwrap();
        runtime
            .store()
            .outbox_settle(
                "outbox-1",
                "then_pending",
                Some(&serde_json::Value::Null),
                None,
                None,
            )
            .unwrap();

        runtime.fail_after_then_commit_once();
        let error = runtime
            .execute_then(
                "clock.then",
                BTreeMap::new(),
                5,
                None,
                VecDeque::new(),
                "outbox-1",
            )
            .unwrap_err();
        assert!(error.to_string().contains("simulated crash"));
    }

    let mut restarted = Runtime::open(Store::open(&path).unwrap(), generation).unwrap();
    let row = restarted.store().outbox_get("outbox-1").unwrap().unwrap();
    assert_eq!(row.state, "sent");
    assert!(
        row.last_error
            .as_deref()
            .is_some_and(|error| error.contains("TOO_EARLY"))
    );
    assert!(
        restarted
            .execute_then(
                "clock.then",
                BTreeMap::new(),
                15,
                None,
                VecDeque::new(),
                "outbox-1",
            )
            .unwrap_err()
            .to_string()
            .contains("not then_pending"),
        "restart cannot re-run a then that would now commit"
    );
    drop(restarted);
    cleanup(&path);
}

#[test]
fn claimed_then_binding_covers_body_arguments_schema_and_effect_grants() {
    assert_changed_then(|project| {
        project
            .programs
            .iter_mut()
            .find(|program| program.name == "clock.then")
            .unwrap()
            .body = vec![Stmt::Return(Expr::Literal(Value::Null))];
    });
    assert_changed_then(|project| {
        project
            .programs
            .iter_mut()
            .find(|program| program.name == "clock.then")
            .unwrap()
            .args
            .insert("newRequiredArgument".into(), crate::ArgType::Id);
    });
    assert_changed_then(|project| {
        project.effects[0].grants = vec!["https://changed.example".into()];
    });
    assert_changed_then(|project| {
        project
            .schema
            .tables
            .get_mut("clockRows")
            .unwrap()
            .columns
            .insert(
                "note".into(),
                ColumnType::Optional(Box::new(ColumnType::Text { max: 20 })),
            );
    });
}

#[test]
fn unrelated_compatible_successor_keeps_claimed_then_valid() {
    let mut runtime = pending_then_runtime("outbox-compatible");
    let mut project = timed_then_project();
    project.programs.push(Program {
        name: "unrelated.query".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Null))],
    });
    project
        .schema
        .tables
        .insert("unrelatedRows".into(), id_table());
    let successor = Generation::certify(&project, Ceilings::default()).unwrap();
    runtime.apply_successor(successor).unwrap();
    let execution = runtime
        .execute_then(
            "clock.then",
            BTreeMap::new(),
            15,
            None,
            VecDeque::new(),
            "outbox-compatible",
        )
        .unwrap();
    assert!(
        matches!(execution.state, ExecutionState::Committed { .. }),
        "compatible successor changed then outcome: {:?}",
        execution.state
    );
}

#[test]
fn direct_store_claim_cannot_mint_then_execution_custody() {
    let generation = timed_then_generation();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let mut emit = Context::mutation(Actor::user("user").unwrap(), BTreeMap::new());
    emit.now = Some(1);
    emit.new_ids = VecDeque::from(["outbox-legacy".to_owned()]);
    runtime.execute("clock.emit", emit).unwrap();
    let claimed = runtime
        .store()
        .outbox_claim_next(1, &["clock.effect".to_owned()])
        .unwrap()
        .claimed
        .unwrap();
    assert_eq!(claimed.claim_binding, None);
    runtime
        .store()
        .outbox_settle(
            "outbox-legacy",
            "then_pending",
            Some(&serde_json::Value::Null),
            None,
            None,
        )
        .unwrap();
    let execution = runtime
        .execute_then(
            "clock.then",
            BTreeMap::new(),
            15,
            None,
            VecDeque::new(),
            "outbox-legacy",
        )
        .unwrap();
    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "E_EFFECT_THEN_CHANGED"
    ));
}

fn assert_changed_then(edit: impl FnOnce(&mut ProjectJson)) {
    let mut runtime = pending_then_runtime("outbox-changed");
    let mut project = timed_then_project();
    edit(&mut project);
    runtime
        .apply_successor(Generation::certify(&project, Ceilings::default()).unwrap())
        .unwrap();
    let execution = runtime
        .execute_then(
            "clock.then",
            BTreeMap::new(),
            15,
            None,
            VecDeque::new(),
            "outbox-changed",
        )
        .unwrap();
    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "E_EFFECT_THEN_CHANGED"
    ));
    assert_eq!(
        runtime
            .store()
            .outbox_get("outbox-changed")
            .unwrap()
            .unwrap()
            .last_error
            .as_deref(),
        Some("E_EFFECT_THEN_CHANGED")
    );
}

fn timed_then_generation() -> Generation {
    Generation::certify(&timed_then_project(), Ceilings::default()).unwrap()
}

fn timed_then_project() -> ProjectJson {
    ProjectJson {
        version: 1,
        schema: Schema {
            tables: BTreeMap::from([("clockRows".into(), id_table())]),
            schedules: Vec::new(),
            maintains: Vec::new(),
            channels: BTreeMap::new(),
            auth: Auth::default(),
            effects: vec!["clock.effect".to_owned()],
        },
        programs: vec![
            Program {
                name: "clock.emit".to_owned(),
                kind: ProgramKind::Mutation,
                args: BTreeMap::new(),
                read_time_granularity_ms: None,
                body: vec![Stmt::Emit {
                    effect: "clock.effect".to_owned(),
                    payload: Expr::Literal(Value::Null),
                }],
            },
            Program {
                name: "clock.then".to_owned(),
                kind: ProgramKind::Mutation,
                args: BTreeMap::new(),
                read_time_granularity_ms: None,
                body: vec![
                    Stmt::Require {
                        site: None,
                        condition: Expr::Binary {
                            op: crate::ir::BinaryOp::Gte,
                            left: Box::new(Expr::Input(crate::ir::Input::Now)),
                            right: Box::new(Expr::Literal(Value::Int(10))),
                        },
                        code: "TOO_EARLY".to_owned(),
                    },
                    Stmt::Return(Expr::Get(crate::ir::Read {
                        site: "clock.then.read".into(),
                        table: "clockRows".into(),
                        index: "byId".into(),
                        key: vec![Expr::Literal(Value::Id("never".into()))],
                        provenance: crate::ir::KeyProvenance::Const,
                    })),
                ],
            },
        ],
        effects: vec![EffectDecl {
            name: "clock.effect".to_owned(),
            grants: Vec::new(),
            source: "async () => null".to_owned(),
            then: Some("clock.then".to_owned()),
        }],
        auth: Auth::default(),
    }
}

fn id_table() -> crate::schema::Table {
    public_table(
        BTreeMap::from([("id".into(), ColumnType::Id)]),
        BTreeMap::from([(
            "byId".into(),
            Index {
                components: vec![IndexComponent::Column("id".into())],
                unique: true,
            },
        )]),
    )
}

fn pending_then_runtime(outbox_id: &str) -> Runtime {
    let mut runtime = Runtime::open(Store::memory().unwrap(), timed_then_generation()).unwrap();
    let mut emit = Context::mutation(Actor::user("user").unwrap(), BTreeMap::new());
    emit.now = Some(1);
    emit.new_ids = VecDeque::from([outbox_id.to_owned()]);
    runtime.execute("clock.emit", emit).unwrap();
    runtime.claim_effect(1).unwrap().claimed.unwrap();
    runtime
        .store()
        .outbox_settle(
            outbox_id,
            "then_pending",
            Some(&serde_json::Value::Null),
            None,
            None,
        )
        .unwrap();
    runtime
}

fn temp_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "snapback3-then-fault-{}-{}.sqlite",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ))
}

fn cleanup(path: &std::path::Path) {
    for path in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        let _ = std::fs::remove_file(path);
    }
}
