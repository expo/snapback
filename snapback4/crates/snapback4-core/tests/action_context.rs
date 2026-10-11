#![cfg(feature = "sqlite")]
use snapback4_core::{Ceilings, Context, Engine, Schema, Value, identity};
use snapback4_core::engine::actions::ActionSettled;
use snapback4_core::ir::{ArgType, Expr, Program, ProgramKind, Stmt};
use snapback4_core::schema::{ActionSpec, Schedule, WorkPolicy, WorkSpec};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn program() -> Program {
    Program { name: "work".into(), kind: ProgramKind::Action, args: BTreeMap::new(), read_time_granularity_ms: None, native: false, returned_shapes: Default::default(),
        body: vec![Stmt::Require { condition: Expr::Literal(Value::Bool(true)), code: "E_RULE".into(), site: None, message: None }] }
}
fn schema(policy: WorkPolicy) -> Schema {
    Schema { action_specs: BTreeMap::from([("work".into(), ActionSpec {
        returns: Some(BTreeMap::from([("answer".into(), ArgType::Int), ("note".into(), ArgType::Optional(Box::new(ArgType::Text { max: 8, min: 0, format: None })))])),
        work: WorkSpec { secrets: vec![], policy },
    })]), ..Schema::default() }
}
fn engine() -> Engine { Engine::memory(schema(WorkPolicy::default()), [program()]).unwrap() }
fn admit(engine: &mut Engine, id: &str, at: i64) { engine.request_action("work", id, Context::new("dev:alice", BTreeMap::new()).at(at)).unwrap(); }
fn claim(engine: &mut Engine, at: i64) -> String { engine.claim_actions("service:worker", None, 1, 1_000, 1, at).unwrap().remove(0).session.token }

#[test]
fn result_validation_is_terminal_and_uses_the_admitted_shape() {
    for bad in [json!(42), json!({"answer":"secret-value"}), json!({"answer":1,"extra":true}), json!({"answer":1,"note":"too long a note"})] {
        let mut engine = engine(); admit(&mut engine, "x", 0); let lease = claim(&mut engine, 0);
        let run = engine.settle_action("x", "service:worker", &lease, ActionSettled::Done(bad), 1).unwrap();
        assert_eq!(run.state, "failed"); assert_eq!(run.error_code.as_deref(), Some("E_ACTION_RESULT"));
        assert!(!run.error.unwrap().contains("secret-value"));
        assert!(identity::resolve(engine.store(), &lease, 2).unwrap().is_none());
        assert!(engine.claim_actions("service:worker", None, 1, 1_000, 1, 5_000).unwrap().is_empty());
    }
    let mut engine = engine(); admit(&mut engine, "x", 0); let lease = claim(&mut engine, 0);
    // A live old attempt validates against its admitted declaration, not this replacement.
    let mut successor = schema(WorkPolicy::default()); successor.action_specs.get_mut("work").unwrap().returns = Some(BTreeMap::new());
    engine.adopt(successor, [program()]).unwrap();
    let run = engine.settle_action("x", "service:worker", &lease, ActionSettled::Done(json!({"answer":7})), 1).unwrap();
    assert_eq!(run.result, Some(json!({"answer":7,"note":null})));
}

#[test]
fn media_results_validate_nested_facts_and_authoritative_byte_bounds() {
    use snapback4_core::assets::{Asset, AssetKind};
    for (kind, wanted) in [(ArgType::Image { max: 10 }, AssetKind::Image), (ArgType::Video { max: 10 }, AssetKind::Video)] {
        for (value, bytes, asset_kind, valid) in [
            (json!({"id":"asset"}), 10, wanted.clone(), true),
            (json!({"id":"asset","bytes":10,"width":1,"type":"image/png"}), 10, wanted.clone(), true),
            (json!({"id":"asset","bytes":"not-a-number","secret":"leak"}), 10, wanted.clone(), false),
            (json!({"id":"asset","width":"bad"}), 10, wanted.clone(), false),
            (json!({"id":"asset","extra":null}), 10, wanted.clone(), false),
            (json!({"id":"asset","bytes":1}), 11, wanted.clone(), false),
            (json!({"id":"asset"}), 11, wanted.clone(), false),
            (json!({"id":"missing"}), 10, wanted.clone(), false),
            (json!({"id":"asset"}), 10, if wanted == AssetKind::Image { AssetKind::Video } else { AssetKind::Image }, false),
        ] {
            let mut declared = schema(WorkPolicy::default());
            let nested = ArgType::Optional(Box::new(ArgType::List { of: Some(Box::new(kind.clone())), max: 2 }));
            declared.action_specs.get_mut("work").unwrap().returns = Some(BTreeMap::from([("media".into(), nested)]));
            let mut engine = Engine::memory(declared, [program()]).unwrap();
            engine.store().record_asset(&Asset { id: "asset".into(), owner: "dev:alice".into(), kind: asset_kind, content_type: "image/png".into(), bytes, width: Some(1), height: Some(1), duration: None, created_at: 0, home: None, released_at: None }).unwrap();
            admit(&mut engine, "media", 0); let lease = claim(&mut engine, 0);
            let result = json!({"media":[value]});
            let run = engine.settle_action("media", "service:worker", &lease, ActionSettled::Done(result.clone()), 1).unwrap();
            if valid { assert_eq!(run.state, "done"); assert_eq!(run.result, Some(result)); }
            else {
                assert_eq!(run.state, "failed", "{result}");
                assert_eq!(run.error_code.as_deref(), Some("E_ACTION_RESULT"));
                assert!(!run.error.unwrap().contains("leak"));
                assert!(engine.claim_actions("service:worker", None, 1, 1_000, 1, 5_000).unwrap().is_empty());
            }
        }
    }
}

#[test]
fn a_completed_step_replays_across_claims_and_changed_input_refuses() {
    let mut engine = engine(); admit(&mut engine, "x", 0); let first = claim(&mut engine, 0);
    let columns: Vec<String> = engine.store().conn().prepare("SELECT name FROM pragma_table_info('_action_steps')").unwrap()
        .query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(columns, ["invocation", "name", "input_digest", "provider_key", "state", "claim_digest", "result", "at", "settled_at", "error"]);
    let started = engine.begin_action_step("x", "service:worker", &first, "mail", &json!({"to":"alice"}), false, 1).unwrap();
    assert_eq!(started.state, "run");
    assert_eq!(started.key, "99f7bb8290f67bce6b9446558c6762e4975539a2a5f63540d07234ea986119f4");
    let started_row: (String, String, String, String, Option<String>, i64, Option<i64>, Option<String>) = engine.store().conn().query_row(
        "SELECT input_digest, provider_key, state, claim_digest, result, at, settled_at, error FROM _action_steps WHERE invocation = 'x' AND name = 'mail'",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))).unwrap();
    assert_eq!(started_row, (snapback4_core::store::payload_digest(&json!({"to":"alice"})), started.key.clone(), "started".into(), format!("{:x}", Sha256::digest(first.as_bytes())), None, 1, None, None));
    assert_eq!(engine.begin_action_step("x", "service:worker", &first, "mail", &json!({"to":"alice"}), false, 2).unwrap_err().code(), "E_STEP_BUSY");
    let after_busy: (String, String, String, String, Option<String>, i64, Option<i64>, Option<String>) = engine.store().conn().query_row(
        "SELECT input_digest, provider_key, state, claim_digest, result, at, settled_at, error FROM _action_steps WHERE invocation = 'x' AND name = 'mail'",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))).unwrap();
    assert_eq!(after_busy, started_row, "a refusal rolls its writer transaction back");
    engine.complete_action_step("x", "service:worker", &first, "mail", &json!({"provider":"receipt"}), 3).unwrap();
    assert_eq!(engine.complete_action_step("x", "service:worker", &first, "mail", &json!({"provider":"receipt"}), 4).unwrap().result, Some(json!({"provider":"receipt"})));
    let completed_row: (String, String, String, String, Option<String>, i64, Option<i64>, Option<String>) = engine.store().conn().query_row(
        "SELECT input_digest, provider_key, state, claim_digest, result, at, settled_at, error FROM _action_steps WHERE invocation = 'x' AND name = 'mail'",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))).unwrap();
    assert_eq!(engine.complete_action_step("x", "service:worker", &first, "mail", &json!({"provider":"other"}), 5).unwrap_err().code(), "E_STEP_RESULT");
    let after_mismatch: (String, String, String, String, Option<String>, i64, Option<i64>, Option<String>) = engine.store().conn().query_row(
        "SELECT input_digest, provider_key, state, claim_digest, result, at, settled_at, error FROM _action_steps WHERE invocation = 'x' AND name = 'mail'",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))).unwrap();
    assert_eq!(after_mismatch, completed_row, "a mismatched repeat cannot rewrite the receipt");
    let second = claim(&mut engine, 1_001);
    let replay = engine.begin_action_step("x", "service:worker", &second, "mail", &json!({"to":"alice"}), false, 1_002).unwrap();
    assert_eq!(replay.state, "done"); assert_eq!(replay.key, started.key); assert_eq!(replay.result, Some(json!({"provider":"receipt"})));
    assert_eq!(engine.begin_action_step("x", "service:worker", &second, "mail", &json!({"to":"bob"}), false, 1_003).unwrap_err().code(), "E_STEP_INPUT");
    let after_changed_input: (String, String, String, String, Option<String>, i64, Option<i64>, Option<String>) = engine.store().conn().query_row(
        "SELECT input_digest, provider_key, state, claim_digest, result, at, settled_at, error FROM _action_steps WHERE invocation = 'x' AND name = 'mail'",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))).unwrap();
    assert_eq!(after_changed_input, completed_row);
    assert_eq!(engine.complete_action_step("x", "service:worker", &first, "mail", &json!(null), 1_003).unwrap_err().code(), "E_ACTION_LEASE");
}

#[test]
fn an_oversized_step_result_parks_the_row_and_owner_atomically() {
    let mut engine = engine();
    engine.set_ceilings(Ceilings { output_bytes: 4, ..Ceilings::default() });
    admit(&mut engine, "large", 0); let lease = claim(&mut engine, 0);
    engine.begin_action_step("large", "service:worker", &lease, "provider", &json!(null), false, 1).unwrap();
    assert_eq!(engine.complete_action_step("large", "service:worker", &lease, "provider", &json!("large"), 2).unwrap_err().code(), "E_STEP_RESULT");
    let (state, result, error): (String, Option<String>, Option<String>) = engine.store().conn().query_row(
        "SELECT state, result, error FROM _action_steps WHERE invocation = 'large' AND name = 'provider'",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
    assert_eq!((state.as_str(), result, error.as_deref()), ("parked", None, Some("result exceeds output byte ceiling")));
    let owner = engine.action_request_at("large", "dev:alice", 2).unwrap();
    assert_eq!((owner.state.as_str(), owner.error_code.as_deref()), ("parked", Some("E_STEP_RESULT")));
    assert!(identity::resolve(engine.store(), &lease, 2).unwrap().is_none());
}

#[test]
fn an_uncertain_step_reconciles_with_the_same_key_or_parks() {
    for reconcile in [true, false] {
        let mut engine = engine(); admit(&mut engine, "x", 0); let first = claim(&mut engine, 0);
        let started = engine.begin_action_step("x", "service:worker", &first, "provider", &json!([1,2]), false, 1).unwrap();
        let second = claim(&mut engine, 1_001);
        let answer = engine.begin_action_step("x", "service:worker", &second, "provider", &json!([1,2]), reconcile, 1_002);
        if reconcile {
            let step = answer.unwrap(); assert_eq!(step.state, "reconcile"); assert_eq!(step.key, started.key);
            engine.complete_action_step("x", "service:worker", &second, "provider", &json!("found-by-key"), 1_003).unwrap();
        } else {
            assert_eq!(answer.unwrap_err().code(), "E_STEP_PARKED");
            assert_eq!(engine.action_request_at("x", "dev:alice", 1_003).unwrap().state, "parked");
            assert!(identity::resolve(engine.store(), &second, 1_003).unwrap().is_none());
            assert!(engine.claim_actions("service:worker", None, 1, 1_000, 1, 10_000).unwrap().is_empty());
        }
    }
}

#[test]
fn deadline_cancellation_and_revocation_end_inflight_authority() {
    let mut engine = Engine::memory(schema(WorkPolicy { deadline_ms: Some(1_000), ..WorkPolicy::default() }), [program()]).unwrap();
    admit(&mut engine, "deadline", 0); let lease = claim(&mut engine, 0);
    let status = engine.action_status("deadline", "service:worker", &lease, 1_000).unwrap();
    assert_eq!(status.error_code.as_deref(), Some("E_ACTION_DEADLINE"));
    assert!(identity::resolve(engine.store(), &lease, 1_000).unwrap().is_none());
    admit(&mut engine, "cancel", 2_000); let lease = claim(&mut engine, 2_000);
    assert_eq!(engine.cancel_action("cancel", "dev:bob", 2_001).unwrap_err().code(), "E_ACTION_UNKNOWN");
    let run = engine.cancel_action("cancel", "dev:alice", 2_001).unwrap(); assert!(run.cancelled);
    assert!(engine.action_status("cancel", "service:worker", &lease, 2_002).unwrap().cancelled);
    assert!(identity::resolve(engine.store(), &lease, 2_002).unwrap().is_none());
    let owner = identity::custom_session(engine.store(), "member:alice", "member", 3_000, 1).unwrap();
    engine.request_action("work", "revoke", Context::new(&owner.principal, BTreeMap::new()).with_session(&owner.token).at(3_000)).unwrap();
    let lease = claim(&mut engine, 3_000);
    assert!(identity::resolve(engine.store(), &lease, 3_001).unwrap().is_some());
    identity::close_session(engine.store(), &owner.token).unwrap();
    assert!(identity::resolve(engine.store(), &lease, 3_002).unwrap().is_none(), "inflight context cannot outlive the admitting session");
    assert_eq!(engine.action_status("revoke", "service:worker", &lease, 3_003).unwrap().error_code.as_deref(), Some("E_ACTION_AUTHORITY"));
}

#[test]
fn admitted_policy_is_frozen_and_changed_queued_contract_parks() {
    let mut engine = Engine::memory(schema(WorkPolicy { max_attempts: 1, ..WorkPolicy::default() }), [program()]).unwrap();
    admit(&mut engine, "one", 0); let lease = claim(&mut engine, 0);
    let run = engine.settle_action("one", "service:worker", &lease, ActionSettled::Failed { error: "temporary".into(), retry: true }, 1).unwrap();
    assert_eq!(run.state, "failed"); assert_eq!(run.attempt, 1);
    admit(&mut engine, "queued", 2);
    engine.adopt(schema(WorkPolicy::default()), [program()]).unwrap();
    assert!(engine.claim_actions("service:worker", None, 1, 1_000, 1, 3).unwrap().is_empty());
    assert_eq!(engine.action_request_at("queued", "dev:alice", 4).unwrap().error_code.as_deref(), Some("E_ACTION_GENERATION"));
}

#[test]
fn a_scheduled_action_is_admitted_once_under_its_service_seat() {
    let mut schema = schema(WorkPolicy::default());
    schema.schedules.push(Schedule { name: "hourly".into(), every_ms: 60_000, offset_ms: 0, target: "work".into(), service: Some("service:billing".into()) });
    let mut engine = Engine::memory(schema, [program()]).unwrap();
    assert!(engine.fire_schedules(0).unwrap().is_empty());
    assert_eq!(engine.fire_schedules(60_000).unwrap(), ["hourly"]);
    assert!(engine.fire_schedules(60_001).unwrap().is_empty());
    let claim = engine.claim_actions("service:worker", None, 10, 60_000, 60, 60_001).unwrap().remove(0);
    assert_eq!(claim.request.principal, "service:billing"); assert_eq!(claim.request.service_generation, Some(0));
    assert_eq!(claim.session.principal, "service:billing");
    assert_eq!(engine.action_counts().unwrap().get("running"), Some(&1));
}

#[test]
fn nested_actions_borrow_the_whole_chain_before_parent_status_is_polled() {
    let mut engine = engine();
    let owner = identity::custom_session(engine.store(), "member:alice", "member", 0, 1).unwrap();
    engine.request_action("work", "parent", Context::new(&owner.principal, BTreeMap::new()).with_session(&owner.token).at(0)).unwrap();
    let parent = claim(&mut engine, 0);
    engine.request_action("work", "child", Context::new(&owner.principal, BTreeMap::new()).with_session(&parent).at(1)).unwrap();
    let child = claim(&mut engine, 1);
    engine.request_action("work", "grandchild", Context::new(&owner.principal, BTreeMap::new()).with_session(&child).at(2)).unwrap();
    assert!(identity::resolve(engine.store(), &child, 2).unwrap().is_some());
    identity::close_session(engine.store(), &owner.token).unwrap();
    // No parent status/settlement call has removed either delegated credential.
    assert!(identity::resolve(engine.store(), &parent, 3).unwrap().is_none());
    assert!(identity::resolve(engine.store(), &child, 3).unwrap().is_none());
    assert!(engine.claim_actions("service:worker", None, 10, 1_000, 1, 3).unwrap().is_empty());
    assert_eq!(engine.request_action("work", "raced-admission", Context::new(&owner.principal, BTreeMap::new()).with_session(&child).at(3)).unwrap_err().code(), "E_AUTH");
    assert_eq!(engine.action_counts().unwrap().get("failed"), Some(&1));
}
