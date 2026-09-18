#![cfg(feature = "sqlite")]
use snapback4_core::{Context, Engine, Settled, Value, identity::{self, ServiceSample}, schema::{WorkPolicy, WorkSpec}};
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
    let claims = engine.claim_effects_strict(&service.token, None, 4, 1_000, true, None, || sample(10)).unwrap();
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
    let claimed = engine.claim_effects_strict(&service.token, None, 1, 1_000, true, None, || sample(1)).unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].id, admitted_under_a);
    assert_eq!(claimed[0].release.as_deref(), Some("A"));
    let declaration_a = claimed[0].declaration_contract.clone();

    let admitted_under_b = emit(&mut engine, "release-b", 2);
    let (release_b, contract_b): (Option<String>, String) = engine.store().conn().query_row(
        "SELECT release, contract FROM _outbox WHERE id = ?1", [&admitted_under_b], |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap();
    assert_eq!(release_b.as_deref(), Some("B"));
    assert_eq!(contract_b, contract_a, "release must not enter the effect compatibility contract");
    let claimed = engine.claim_effects_strict(&service.token, Some("mail"), 1, 1_000, true, None, || sample(3)).unwrap();
    assert_eq!(claimed[0].id, admitted_under_b);
    assert_eq!(claimed[0].declaration_contract, declaration_a, "release must not enter the declaration contract");
}

#[test]
fn legacy_declared_effect_recomputes_the_implicit_work_contract() {
    let mut engine = engine("");
    let id = emit(&mut engine, "legacy", 0);
    let service = service(&engine);
    adopt(&mut engine, "", true);
    let claimed = engine.claim_effects_strict(&service.token, None, 1, 1_000, true, None, || sample(1)).unwrap();
    assert_eq!(claimed.len(), 1); assert_eq!(claimed[0].id, id);
    assert_eq!(claimed[0].work.policy.backoff_ms, 4_000);
}

#[test]
fn strict_claim_parks_generation_drift_before_deadline_expiry() {
    let mut engine = engine("retry 2 deadline 1s");
    let id = emit(&mut engine, "deadline", 0);
    let service = service(&engine);
    adopt(&mut engine, "retry 3 deadline 1s", false);
    assert!(engine.claim_effects_strict(&service.token, None, 1, 1_000, true, None, || sample(2_000)).unwrap().is_empty());
    let run = engine.effects(Some("parked"), 1).unwrap().remove(0);
    assert_eq!(run.id, id); assert_eq!(run.error_code.as_deref(), Some("E_EFFECT_GENERATION"));
}

#[test]
fn held_effect_poll_samples_authority_once_inside_its_writer_boundary() {
    let mut engine = engine("");
    let service = service(&engine);
    let samples = std::cell::Cell::new(0);
    engine.authorize_effect_poll_strict(&service.token, None, None, false, || { samples.set(samples.get() + 1); sample(1) }).unwrap();
    assert_eq!(samples.get(), 1);
}

#[test]
fn declaration_contract_is_deterministic_and_keeps_the_row_contract_compatible() {
    let work = WorkSpec { secrets: vec!["MAIL_KEY".into()], policy: WorkPolicy::default() };
    let other_payload = Value::String("other".into());
    let declaration = work.effect_declaration_contract("mail");
    assert_eq!(declaration, work.effect_declaration_contract("mail"));
    assert_eq!(declaration, snapback4_core::value::digest(&("effect-payload:generic-value:v1", "mail", &work)), "payload and release are not declaration inputs");
    assert_ne!(declaration, work.effect_declaration_contract("push"));
    assert_ne!(declaration, WorkSpec { secrets: vec!["OTHER_KEY".into()], ..work.clone() }.effect_declaration_contract("mail"));
    assert_ne!(declaration, WorkSpec { policy: WorkPolicy { max_attempts: 7, ..work.policy.clone() }, ..work.clone() }.effect_declaration_contract("mail"));
    assert_ne!(work.effect_contract("mail", &Value::Int(1)), work.effect_contract("mail", &other_payload));
    assert_eq!(work.effect_contract("mail", &Value::Int(1)), "2eee4a9cd6c745f8ba0fa08643a8cdcc6e1d34b8efd16bc751fdbecea68fb057");
}

#[test]
fn declaration_fence_precedes_all_queue_mutation_and_absence_stays_compatible() {
    let mut subject = engine("retry 2");
    let id = emit(&mut subject, "generated", 0);
    let subject_service = service(&subject);
    let current = subject.schema().effect_specs["mail"].effect_declaration_contract("mail");
    let first = subject.claim_effects_fenced("service:worker", Some("mail"), 1, 1_000, 0).unwrap().remove(0);
    assert_eq!((first.state.as_str(), first.attempts, first.lease_until), ("running", 1, Some(1_000)));
    subject.store().conn().execute("INSERT INTO _effect_presence(principal, id, deadline) VALUES ('dev:pending', ?1, 10_000)", [&id]).unwrap();
    let before = outbox_snapshot(&subject, &id);
    let counts_before: (i64, i64, i64) = subject.store().conn().query_row(
        "SELECT COALESCE(SUM(attempts), 0), (SELECT COUNT(*) FROM _effect_steps),
                (SELECT COUNT(*) FROM _effect_presence WHERE id = ?1)
         FROM _outbox", [&id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).unwrap();
    let error = subject.claim_effects_strict(&subject_service.token, Some("mail"), 1, 1_000, true, Some("stale-generated-contract"), || sample(1_001)).unwrap_err();
    assert_eq!(error.code(), "E_EFFECT_GENERATION");
    assert_eq!(outbox_snapshot(&subject, &id), before);
    let counts_after: (i64, i64, i64) = subject.store().conn().query_row(
        "SELECT COALESCE(SUM(attempts), 0), (SELECT COUNT(*) FROM _effect_steps),
                (SELECT COUNT(*) FROM _effect_presence WHERE id = ?1)
         FROM _outbox", [&id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).unwrap();
    assert_eq!(counts_after, counts_before);

    let claim = subject.claim_effects_strict(&subject_service.token, Some("mail"), 1, 1_000, true, Some(&current), || sample(1_001)).unwrap().remove(0);
    assert_eq!(claim.id, id);
    assert_eq!(claim.attempts, 2, "the matching declaration must permit ordinary expiry, requeue and reclaim");
    assert_ne!(claim.lease_token, first.lease_token);
    assert_eq!(claim.declaration_contract.as_deref(), Some(current.as_str()));
    assert_eq!(subject.store().conn().query_row("SELECT COUNT(*) FROM _effect_presence WHERE id = ?1", [&id], |row| row.get::<_, i64>(0)).unwrap(), 0);
    let claimed = outbox_snapshot(&subject, &id);
    assert_eq!(subject.claim_effects_strict(&subject_service.token, Some("missing"), 1, 1_000, true, Some(&current), || sample(1_002)).unwrap_err().code(), "E_EFFECT_GENERATION");
    assert_eq!(outbox_snapshot(&subject, &id), claimed, "a missing current named declaration must not maintain another row");

    let mut legacy = engine("retry 2");
    let legacy_id = emit(&mut legacy, "legacy-filter", 0);
    let service = service(&legacy);
    let claim = legacy.claim_effects_strict(&service.token, Some("mail"), 1, 1_000, true, None, || sample(1)).unwrap().remove(0);
    assert_eq!(claim.id, legacy_id);
    assert!(claim.declaration_contract.is_some());
}

#[test]
fn strict_status_samples_once_fences_running_authority_and_preserves_terminal_evidence() {
    let mut subject = engine("retry 2 deadline 1s");
    let target = emit(&mut subject, "target", 0);
    let untouched = emit(&mut subject, "untouched", 1);
    let subject_service = service(&subject);
    let claims = subject.claim_effects_strict(&subject_service.token, Some("mail"), 2, 10_000, true, None, || sample(2)).unwrap();
    let leases: BTreeMap<_, _> = claims.into_iter().map(|run| (run.id, run.lease_token.unwrap())).collect();
    let other_service = identity::service_session(subject.store(), "other", 0, 1).unwrap();
    let before_other = outbox_snapshot(&subject, &target);
    let copied_lease = leases[&target].clone();
    assert_eq!(subject.effect_status_strict(&other_service.token, &target, &copied_lease, || sample(3)).unwrap_err().code(), "E_EFFECT_LEASE");
    assert_eq!(outbox_snapshot(&subject, &target), before_other, "a different current service cannot use the real lease");
    let samples = std::cell::Cell::new(0);
    let running = subject.effect_status_strict(&subject_service.token, &target, &leases[&target], || { samples.set(samples.get() + 1); sample(3) }).unwrap();
    assert_eq!(samples.get(), 1); assert_eq!(running.state, "running");
    let before_wrong = outbox_snapshot(&subject, &target);
    assert_eq!(subject.effect_status_strict(&subject_service.token, &target, "wrong", || sample(4)).unwrap_err().code(), "E_EFFECT_LEASE");
    assert_eq!(outbox_snapshot(&subject, &target), before_wrong);

    let deadline = subject.effect_status_strict(&subject_service.token, &target, &leases[&target], || sample(2_000)).unwrap();
    assert_eq!((deadline.state.as_str(), deadline.error_code.as_deref()), ("failed", Some("E_EFFECT_DEADLINE")));
    assert_eq!(subject.effects(None, 10).unwrap().into_iter().find(|run| run.id == untouched).unwrap().state, "running", "status must not expire unrelated rows");
    let reader = identity::service_session(subject.store(), "reader", 0, 1).unwrap();
    assert_eq!(subject.effect_status_strict(&reader.token, &target, "not-the-lease", || sample(2_001)).unwrap().state, "failed");
    adopt(&mut subject, "retry 3 deadline 1s", false);
    let terminal = outbox_snapshot(&subject, &target);
    assert_eq!(subject.effect_status_strict(&reader.token, &target, "irrelevant", || sample(2_002)).unwrap_err().code(), "E_EFFECT_GENERATION");
    assert_eq!(outbox_snapshot(&subject, &target), terminal);
    identity::close_session(subject.store(), &reader.token).unwrap();
    assert_eq!(subject.effect_status_strict(&reader.token, &target, "irrelevant", || sample(2_003)).unwrap_err().code(), "E_AUTH");
    assert_eq!(outbox_snapshot(&subject, &target), terminal);

    let mut expiry = engine("retry 2");
    let id = emit(&mut expiry, "expiry", 0);
    let unrelated = emit(&mut expiry, "unrelated", 1);
    let service = service(&expiry);
    let claim = expiry.claim_effects_strict(&service.token, Some("mail"), 1, 1_000, true, None, || sample(2)).unwrap().remove(0);
    let before = outbox_snapshot(&expiry, &id);
    assert_eq!(expiry.effect_status_strict(&service.token, &id, claim.lease_token.as_deref().unwrap(), || sample(1_002)).unwrap_err().code(), "E_EFFECT_LEASE");
    assert_eq!(outbox_snapshot(&expiry, &id), before, "status must not requeue or grant a successor after lease loss");
    let unrelated_before = outbox_snapshot(&expiry, &unrelated);
    assert_eq!(expiry.store().conn().execute("UPDATE _outbox SET cancelled = 1 WHERE id = ?1 AND state = 'running'", [&id]).unwrap(), 1);
    let cancelled = expiry.effect_status_strict(&service.token, &id, claim.lease_token.as_deref().unwrap(), || sample(1_003)).unwrap();
    assert_eq!((cancelled.state.as_str(), cancelled.cancelled, cancelled.error_code.as_deref()), ("failed", true, Some("E_EFFECT_CANCELLED")));
    assert_eq!(outbox_snapshot(&expiry, &unrelated), unrelated_before, "status cancellation must finalize only its target");
}
