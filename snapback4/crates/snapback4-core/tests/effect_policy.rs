#![cfg(feature = "sqlite")]
use snapback4_core::{Context, Engine, Settled, identity::{self, ServiceSample}};
use snapback4_lang::compile;
use serde_json::json;
use std::collections::BTreeMap;

fn engine(settings: &str) -> Engine {
    let bound = compile(&[("schema.q".into(), format!("effect mail {settings}\nmutation send():\n  emit mail {{ n: 1 }}\n"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn emit(engine: &mut Engine, id: &str, at: i64) -> String {
    engine.mutate("send", Some(id), Context::new("dev:alice", Default::default()).at(at)).unwrap();
    engine.effects(Some("queued"), 100).unwrap().into_iter().find(|run| run.at == at).unwrap().id
}
fn service(engine: &Engine) -> identity::Session {
    identity::service_session(engine.store(), "worker", 0, 1).unwrap()
}
fn sample(now: i64) -> ServiceSample { ServiceSample { now, supervisor_revision: 0 } }
fn adopt(engine: &mut Engine, settings: &str, legacy: bool) {
    let bound = compile(&[("schema.q".into(), format!("effect mail {settings}\nmutation send():\n  emit mail {{ n: 1 }}\n"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut schema = bound.schema;
    if legacy { schema.effect_specs.clear(); }
    engine.adopt(schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
}
fn outbox_snapshot(engine: &Engine, id: &str) -> Vec<rusqlite::types::Value> {
    let mut statement = engine.store().conn().prepare("SELECT * FROM _outbox WHERE id = ?1").unwrap();
    let columns = statement.column_count();
    statement.query_row([id], |row| (0..columns).map(|column| row.get(column)).collect()).unwrap()
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

#[test]
fn generation_drift_parks_before_stale_lease_for_settle_and_every_step_verb() {
    let mut engine = engine("retry 2");
    let ids = [emit(&mut engine, "settle", 0), emit(&mut engine, "begin", 1), emit(&mut engine, "done", 2), emit(&mut engine, "park", 3)];
    let service = service(&engine);
    let claims = engine.claim_effects_strict(&service.token, None, 4, 1_000, true, || sample(10)).unwrap();
    let leases: BTreeMap<_, _> = claims.into_iter().map(|run| (run.id, run.lease_token.unwrap())).collect();
    adopt(&mut engine, "retry 3", false);

    let errors = [
        engine.settle_effect_strict(&service.token, &ids[0], Some(&leases[&ids[0]]), Settled::Done { result: None }, || sample(2_000)).unwrap_err(),
        engine.begin_effect_step_strict(&service.token, &ids[1], &leases[&ids[1]], "provider", &json!({ "n": 1 }), false, || sample(2_000)).unwrap_err(),
        engine.complete_effect_step_strict(&service.token, &ids[2], &leases[&ids[2]], "provider", &json!({ "ok": true }), || sample(2_000)).unwrap_err(),
        engine.park_effect_step_strict(&service.token, &ids[3], &leases[&ids[3]], "provider", "unknown", || sample(2_000)).unwrap_err(),
    ];
    assert!(errors.iter().all(|error| error.code() == "E_EFFECT_GENERATION"));
    for id in ids {
        let row: (String, Option<String>, Option<String>, Option<i64>, Option<i64>, Option<String>, Option<i64>) = engine.store().conn().query_row(
            "SELECT state, error_code, error, settled_at, lease_until, claimed_by, next_at FROM _outbox WHERE id = ?1", [&id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
        ).unwrap();
        assert_eq!(row.0, "parked"); assert_eq!(row.1.as_deref(), Some("E_EFFECT_GENERATION"));
        assert!(row.2.is_some() && row.3 == Some(2_000)); assert_eq!((row.4, row.5, row.6), (None, None, None));
    }
}

#[test]
fn generation_drift_refuses_terminal_states_without_rewriting_their_evidence() {
    let mut engine = engine("retry 2");
    let cases = [
        (emit(&mut engine, "sent", 0), "sent", 0, Some("sent-result"), None, None),
        (emit(&mut engine, "satisfied", 1), "satisfied", 0, Some("satisfied-result"), None, None),
        (emit(&mut engine, "failed", 2), "failed", 0, None, Some("failed-error"), Some("E_EFFECT_ATTEMPTS")),
        (emit(&mut engine, "cancelled", 3), "failed", 1, None, Some("cancelled-error"), Some("E_EFFECT_CANCELLED")),
        (emit(&mut engine, "parked", 4), "parked", 0, None, Some("parked-error"), Some("E_STEP_PARKED")),
    ];
    for (index, (id, state, cancelled, result, error, code)) in cases.iter().enumerate() {
        engine.store().conn().execute(
            "UPDATE _outbox SET state = ?2, cancelled = ?3, result = ?4, error = ?5, error_code = ?6, settled_at = ?7, lease_until = ?8, claimed_by = ?9, lease_digest = ?10, next_at = ?11 WHERE id = ?1",
            rusqlite::params![id, state, cancelled, result, error, code, 100 + index as i64, 200 + index as i64, format!("terminal-worker-{index}"), format!("terminal-lease-{index}"), 300 + index as i64],
        ).unwrap();
    }
    let service = service(&engine);
    adopt(&mut engine, "retry 3", false);

    for (id, ..) in &cases {
        let before = outbox_snapshot(&engine, id);
        let error = engine.settle_effect_strict(
            &service.token, id, Some("stale-lease"), Settled::Done { result: None }, || sample(1_000),
        ).unwrap_err();
        assert_eq!(error.code(), "E_EFFECT_GENERATION");
        assert_eq!(outbox_snapshot(&engine, id), before, "terminal evidence changed for {id}");
    }
}

#[test]
fn release_is_admission_provenance_not_effect_contract_generation() {
    let mut engine = engine("retry 2");
    engine.store().set_meta("release", "A").unwrap();
    let admitted_under_a = emit(&mut engine, "release-a", 0);
    let contract_a: String = engine.store().conn().query_row(
        "SELECT contract FROM _outbox WHERE id = ?1", [&admitted_under_a], |row| row.get(0),
    ).unwrap();

    engine.store().set_meta("release", "B").unwrap();
    let service = service(&engine);
    let claimed = engine.claim_effects_strict(&service.token, None, 1, 1_000, true, || sample(1)).unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].id, admitted_under_a);
    assert_eq!(claimed[0].release.as_deref(), Some("A"));

    let admitted_under_b = emit(&mut engine, "release-b", 2);
    let (release_b, contract_b): (Option<String>, String) = engine.store().conn().query_row(
        "SELECT release, contract FROM _outbox WHERE id = ?1", [&admitted_under_b], |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap();
    assert_eq!(release_b.as_deref(), Some("B"));
    assert_eq!(contract_b, contract_a, "release must not enter the effect compatibility contract");
}

#[test]
fn legacy_declared_effect_recomputes_the_implicit_work_contract() {
    let mut engine = engine("");
    let id = emit(&mut engine, "legacy", 0);
    let service = service(&engine);
    adopt(&mut engine, "", true);
    let claimed = engine.claim_effects_strict(&service.token, None, 1, 1_000, true, || sample(1)).unwrap();
    assert_eq!(claimed.len(), 1); assert_eq!(claimed[0].id, id);
    assert_eq!(claimed[0].work.policy.backoff_ms, 4_000);
}

#[test]
fn strict_claim_parks_generation_drift_before_deadline_expiry() {
    let mut engine = engine("retry 2 deadline 1s");
    let id = emit(&mut engine, "deadline", 0);
    let service = service(&engine);
    adopt(&mut engine, "retry 3 deadline 1s", false);
    assert!(engine.claim_effects_strict(&service.token, None, 1, 1_000, true, || sample(2_000)).unwrap().is_empty());
    let run = engine.effects(Some("parked"), 1).unwrap().remove(0);
    assert_eq!(run.id, id); assert_eq!(run.error_code.as_deref(), Some("E_EFFECT_GENERATION"));
}

#[test]
fn held_effect_poll_samples_authority_once_inside_its_writer_boundary() {
    let mut engine = engine("");
    let service = service(&engine);
    let samples = std::cell::Cell::new(0);
    engine.authorize_effect_poll_strict(&service.token, || { samples.set(samples.get() + 1); sample(1) }).unwrap();
    assert_eq!(samples.get(), 1);
}
