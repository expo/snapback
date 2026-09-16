#![cfg(feature = "sqlite")]
use snapback4_core::{Context, Engine, Settled};
use snapback4_lang::compile;
use serde_json::json;

fn engine(settings: &str) -> Engine {
    let bound = compile(&[("schema.q".into(), format!("effect mail {settings}\nmutation send():\n  emit mail {{ n: 1 }}\n"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn emit(engine: &mut Engine, id: &str, at: i64) -> String {
    engine.mutate("send", Some(id), Context::new("dev:alice", Default::default()).at(at)).unwrap();
    engine.effects(Some("queued"), 100).unwrap().into_iter().find(|run| run.at == at).unwrap().id
}

#[test]
fn effect_policy_is_frozen_at_emission_and_cancellation_is_terminal() {
    let mut engine = engine("retry 2 backoff 1s deadline 1m cancellation allow");
    let id = emit(&mut engine, "x", 0);
    let first = engine.claim_effects_fenced("service:worker", None, 1, 10_000, 0).unwrap().remove(0);
    assert_eq!(first.work.policy.max_attempts, 2); assert_eq!(first.deadline, Some(60_000));
    let failure = Settled::Failed { error: "temporary".into(), retry: true };
    let next = engine.settle_effect_claim(&id, "service:worker", first.lease_token.as_deref(), failure.clone(), 1).unwrap();
    assert_eq!(next.next_at, Some(1_001));
    let second = engine.claim_effects_fenced("service:worker", None, 1, 10_000, 1_001).unwrap().remove(0);
    assert_eq!(engine.settle_effect_claim(&id, "service:worker", second.lease_token.as_deref(), failure, 1_002).unwrap().state, "failed");
    let id = emit(&mut engine, "cancel", 2_000);
    let claim = engine.claim_effects_fenced("service:worker", None, 1, 10_000, 2_000).unwrap().remove(0);
    assert!(engine.cancel_effect(&id, 2_001).unwrap().cancelled);
    assert_eq!(engine.settle_effect_claim(&id, "service:worker", claim.lease_token.as_deref(), Settled::Done { result: None }, 2_002).unwrap_err().code(), "E_EFFECT_LEASE");
    assert!(engine.claim_effects_fenced("service:worker", None, 1, 10_000, 3_000).unwrap().is_empty());
}

#[test]
fn deadline_and_same_worker_successors_are_fenced() {
    let mut engine = engine("deadline 2s"); let id = emit(&mut engine, "x", 0);
    let first = engine.claim_effects_fenced("service:worker", None, 1, 1_000, 0).unwrap().remove(0);
    let next = engine.claim_effects_fenced("service:worker", None, 1, 10_000, 1_001).unwrap().remove(0);
    assert_ne!(first.lease_token, next.lease_token); assert_eq!(next.lease_until, Some(2_000));
    for token in [None, first.lease_token.as_deref()] {
        assert_eq!(engine.settle_effect_claim(&id, "service:worker", token, Settled::Done { result: None }, 1_002).unwrap_err().code(), "E_EFFECT_LEASE");
    }
    engine.requeue_expired_effects(2_000).unwrap();
    let run = engine.effects(Some("failed"), 10).unwrap().remove(0);
    assert_eq!(run.error_code.as_deref(), Some("E_EFFECT_DEADLINE"));
    let encoded = serde_json::to_value(&run).unwrap(); assert_eq!(encoded["deadline"], json!(2_000));
    assert!(encoded.get("lease_token").is_none());
}

#[test]
fn policy_changes_do_not_rewrite_admitted_work_and_cancel_can_be_forbidden() {
    let mut engine = engine("retry 1 deadline 1m cancellation deny"); let id = emit(&mut engine, "x", 0);
    let bound = compile(&[("schema.q".into(), "effect mail retry 8\nmutation send():\n  emit mail { n: 1 }\n".into())]);
    engine.adopt(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(engine.cancel_effect(&id, 1).unwrap_err().code(), "E_EFFECT_CANCELLATION");
    let run = engine.claim_effects_fenced("service:worker", None, 1, 1_000, 1).unwrap().remove(0);
    assert_eq!(run.work.policy.max_attempts, 1);
    assert_eq!(engine.settle_effect_claim(&id, "service:worker", run.lease_token.as_deref(), Settled::Failed { error: "no".into(), retry: true }, 2).unwrap().state, "failed");
}
