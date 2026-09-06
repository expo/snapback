use super::*;
use crate::schema::Schema;
use crate::{Actor, SYSTEM_PRINCIPAL_ID};
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
        runtime
            .store()
            .outbox_claim_next(1, &["clock.effect".to_owned()])
            .unwrap()
            .unwrap();
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

fn timed_then_generation() -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema: Schema {
                tables: BTreeMap::new(),
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
                    body: vec![Stmt::Require {
                        condition: Expr::Binary {
                            op: crate::ir::BinaryOp::Gte,
                            left: Box::new(Expr::Input(crate::ir::Input::Now)),
                            right: Box::new(Expr::Literal(Value::Int(10))),
                        },
                        code: "TOO_EARLY".to_owned(),
                    }],
                },
            ],
            effects: vec![EffectDecl {
                name: "clock.effect".to_owned(),
                grants: Vec::new(),
                source: "async () => null".to_owned(),
                then: Some("clock.then".to_owned()),
            }],
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn pending_then_runtime(outbox_id: &str) -> Runtime {
    let mut runtime = Runtime::open(Store::memory().unwrap(), timed_then_generation()).unwrap();
    let mut emit = Context::mutation(Actor::user("user").unwrap(), BTreeMap::new());
    emit.now = Some(1);
    emit.new_ids = VecDeque::from([outbox_id.to_owned()]);
    runtime.execute("clock.emit", emit).unwrap();
    runtime
        .store()
        .outbox_claim_next(1, &["clock.effect".to_owned()])
        .unwrap()
        .unwrap();
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
        "snapback2-then-fault-{}-{}.sqlite",
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
