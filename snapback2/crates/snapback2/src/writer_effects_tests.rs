use super::{Action, OwnerHandle, State};
use crate::effects::serialize_claimed_outbox;
use serde_json::{Value as Json, json};
use snapback2_core::{
    Actor, Auth, Ceilings, Context, EffectDecl, Expr, Generation, Program, ProgramKind,
    ProjectJson, Runtime, Schema, Stmt, Store, Value,
};
use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::Ordering as AtomicOrdering;

/// A writer state whose store holds `rows` queued `effects.run` jobs
/// (`outbox-1`, `outbox-2`, …) bound to a declaration with a `then`.
pub(super) fn effects_state(label: &str, rows: usize) -> State {
    let project = ProjectJson {
        version: 1,
        schema: Schema {
            schedules: Vec::new(),
            tables: BTreeMap::new(),
            maintains: Vec::new(),
            channels: BTreeMap::new(),
            auth: Auth::default(),
            effects: vec!["effects.run".to_owned()],
        },
        programs: vec![Program {
            name: "effects.emit".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Emit {
                effect: "effects.run".to_owned(),
                payload: Expr::Literal(Value::Null),
            }],
        }],
        effects: vec![EffectDecl {
            name: "effects.run".to_owned(),
            grants: Vec::new(),
            source: "async () => true".to_owned(),
            then: Some("effects.then".to_owned()),
        }],
        auth: Auth::default(),
    };
    let generation = Generation::certify(&project, Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation.clone()).unwrap();
    for index in 1..=rows {
        let mut context = Context::mutation(Actor::user("user").unwrap(), BTreeMap::new());
        context.now = Some(1);
        context.new_ids = VecDeque::from([format!("outbox-{index}")]);
        runtime.execute("effects.emit", context).unwrap();
    }
    super::writer_live_tests::state_from(label, project, generation, runtime)
}

/// That state driven on its own thread the way the owner drives the writer;
/// the effects seam tests claim and settle through the returned handle.
pub(crate) fn spawn_effects_writer(label: &str, rows: usize) -> OwnerHandle {
    let mut state = effects_state(label, rows);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || super::writer_jobs::drive(&mut state, rx));
    OwnerHandle { tx }
}

// @ref LLP 1021#5-a-running-effect-can-be-stopped — the writer is the second fence: no claim once stop is set, whatever the runner asks.
#[test]
fn stop_fences_outbox_claims_at_the_writer() {
    let mut state = effects_state("claim-fence", 2);
    state.stop.store(true, AtomicOrdering::SeqCst);
    assert_eq!(
        state.handle(Action::OutboxClaim { now: 1 }).unwrap(),
        Json::Null
    );
    let row = state
        .runtime()
        .store()
        .outbox_get("outbox-1")
        .unwrap()
        .unwrap();
    assert_eq!((row.state.as_str(), row.attempts), ("queued", 0));
    state.stop.store(false, AtomicOrdering::SeqCst);
    let claimed = state.handle(Action::OutboxClaim { now: 1 }).unwrap();
    assert_eq!(claimed["id"], "outbox-1", "{claimed}");
    // Stop lands while the job runs: its settlement still commits, and no second claim follows.
    state.stop.store(true, AtomicOrdering::SeqCst);
    state
        .handle(Action::OutboxSettle {
            id: "outbox-1".to_owned(),
            state: "sent".to_owned(),
            result: Some(json!(true)),
            last_error: None,
            next_at: None,
        })
        .unwrap();
    assert_eq!(
        state.handle(Action::OutboxClaim { now: 2 }).unwrap(),
        Json::Null
    );
    let sent = state
        .runtime()
        .store()
        .outbox_get("outbox-1")
        .unwrap()
        .unwrap();
    assert_eq!((sent.state.as_str(), sent.attempts), ("sent", 1));
    let waiting = state
        .runtime()
        .store()
        .outbox_get("outbox-2")
        .unwrap()
        .unwrap();
    assert_eq!((waiting.state.as_str(), waiting.attempts), ("queued", 0));
}

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
        .claimed
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
        .unwrap()
        .claimed;
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
