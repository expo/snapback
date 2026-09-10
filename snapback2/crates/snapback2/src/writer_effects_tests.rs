use crate::effects::serialize_claimed_outbox;
use serde_json::json;
use snapback2_core::{
    Actor, Auth, Ceilings, Context, EffectDecl, Expr, Generation, Program, ProgramKind,
    ProjectJson, Runtime, Schema, Stmt, Store, Value,
};
use std::collections::{BTreeMap, VecDeque};

#[test]
fn fractional_json_result_settles_running_before_then_conversion() {
    let emit = Program {
        name: "effects.emit".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Emit {
            effect: "effects.run".to_owned(),
            payload: Expr::Literal(Value::Null),
        }],
    };
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: Schema {
                schedules: Vec::new(),
                tables: BTreeMap::new(),
                maintains: Vec::new(),
                channels: BTreeMap::new(),
                auth: Auth::default(),
                effects: vec!["effects.run".to_owned()],
            },
            programs: vec![emit],
            effects: vec![EffectDecl {
                name: "effects.run".to_owned(),
                grants: Vec::new(),
                source: "async () => ({ ratio: 1.5 })".to_owned(),
                then: Some("effects.then".to_owned()),
            }],
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let mut context = Context::mutation(Actor::user("user").unwrap(), BTreeMap::new());
    context.now = Some(1);
    context.new_ids = VecDeque::from(["outbox-1".to_owned()]);
    runtime.execute("effects.emit", context).unwrap();
    runtime
        .store()
        .outbox_claim_next(1, &["effects.run".to_owned()])
        .unwrap()
        .unwrap();

    let mut state = super::writer_live_tests::state("fractional-effect");
    state.runtime = Some(runtime);
    state
        .settle_outbox(
            "outbox-1",
            "then_pending",
            Some(&json!({ "ratio": 1.5 })),
            None,
            None,
        )
        .unwrap();

    let row = state
        .runtime()
        .store()
        .outbox_get("outbox-1")
        .unwrap()
        .unwrap();
    assert_eq!(row.state, "then_pending");
    assert_eq!(row.result, Some(json!({ "ratio": 1.5 })));
    std::fs::remove_dir_all(state.root).unwrap();
}

#[test]
fn claim_serialization_failure_requeues_and_logs_the_claimed_row() {
    let emit = Program {
        name: "effects.emit".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Emit {
            effect: "effects.run".to_owned(),
            payload: Expr::Literal(Value::Null),
        }],
    };
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: Schema {
                schedules: Vec::new(),
                tables: BTreeMap::new(),
                maintains: Vec::new(),
                channels: BTreeMap::new(),
                auth: Auth::default(),
                effects: vec!["effects.run".to_owned()],
            },
            programs: vec![emit],
            effects: vec![EffectDecl {
                name: "effects.run".to_owned(),
                grants: Vec::new(),
                source: "async () => true".to_owned(),
                then: None,
            }],
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let mut context = Context::mutation(Actor::user("user").unwrap(), BTreeMap::new());
    context.now = Some(1);
    context.new_ids = VecDeque::from(["outbox-1".to_owned()]);
    runtime.execute("effects.emit", context).unwrap();
    let claimed = runtime
        .store()
        .outbox_claim_next(1, &["effects.run".to_owned()])
        .unwrap();
    let mut logs = Vec::new();

    let error = serialize_claimed_outbox(
        &runtime,
        claimed,
        |_| Err("simulated serializer refusal".to_owned()),
        |id, message| logs.push((id.to_owned(), message.to_owned())),
    )
    .unwrap_err();

    assert_eq!(error.code, "E_EFFECT_CLAIM_SERIALIZATION");
    let row = runtime.store().outbox_get("outbox-1").unwrap().unwrap();
    assert_eq!(row.state, "queued");
    assert_eq!(row.attempts, 0);
    assert!(
        row.last_error
            .as_deref()
            .is_some_and(|message| message.contains("simulated serializer refusal"))
    );
    assert_eq!(logs[0].0, "outbox-1");
    assert!(logs[0].1.contains("simulated serializer refusal"));
}
