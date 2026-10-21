//! Pre-upgrade SQLite rows may contain identifiers that new admission refuses.
// @ref LLP 3000.009.001.000#9.1 — stored keys remain usable through their whole lifecycle.
use super::*;
use crate::{
    Engine,
    authority::AuthorityTransaction,
    engine::actions::ActionSettled,
    schema::{ActionSpec, Schema},
};

const LEGACY: &str = "job\0one";
const ACTION: &str = "work\0old";

fn engine() -> Engine {
    Engine::memory(Schema::default(), []).unwrap()
}

fn seed(engine: &Engine, id: &str, at: i64, deadline: Option<i64>) {
    let mut spec = ActionSpec::default();
    spec.work.policy.cancellable = true;
    spec.work.policy.max_attempts = 2;
    // Bypass admission exactly as a pre-upgrade database would. No contract
    // was recorded on these legacy rows; their original policy still applies.
    (match &engine.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).conn().execute(
        "INSERT INTO _requests(id,name,args,principal,at,state,spec,deadline) VALUES (?1,?2,'{}','dev:alice',?3,'queued',?4,?5)",
        params![id, ACTION, at, serde_json::to_string(&spec).unwrap(), deadline],
    ).unwrap();
}

fn claim(engine: &mut Engine, now: i64) -> crate::engine::actions::ActionClaim {
    engine
        .claim_actions("service:worker", Some(ACTION), 1, 1_000, 60, now)
        .unwrap()
        .remove(0)
}

fn revoked(engine: &mut Engine, token: &str) {
    let tx = engine.store_mut().transaction().unwrap();
    assert!(
        tx.session_by_digest(&identity::digest(token))
            .unwrap()
            .is_none()
    );
}

#[test]
fn legacy_nul_request_deadline_and_lease_expiry_preserve_outcomes() {
    for case in ["deadline", "lease", "attempts"] {
        let mut engine = engine();
        seed(&engine, LEGACY, 0, (case == "deadline").then_some(1_000));
        let claimed = claim(&mut engine, 0);
        if case == "attempts" {
            (match &engine
                .store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).conn()
                .execute("UPDATE _requests SET attempts = 2 WHERE id = ?1", [LEGACY])
                .unwrap();
        }
        assert_eq!(engine.requeue_expired_actions(1_000).unwrap(), 1);
        let run = engine
            .action_request_at(LEGACY, "dev:alice", 1_000)
            .unwrap();
        if case == "lease" {
            assert_eq!(run.state, "queued");
            assert_eq!(run.error.as_deref(), Some("the action lease expired"));
            assert!(run.lease_until.is_none());
            assert!(run.settled_at.is_none());
            let next = claim(&mut engine, 1_000);
            assert_eq!(next.request.id, LEGACY);
            assert_eq!(next.request.attempt, 2);
        } else {
            assert_eq!(run.state, "failed");
            assert_eq!(
                run.error_code.as_deref(),
                Some(if case == "deadline" {
                    "E_ACTION_DEADLINE"
                } else {
                    "E_ACTION_ATTEMPTS"
                })
            );
            assert_eq!(run.settled_at, Some(1_000));
            assert_eq!(run.lease_until, Some(1_000));
        }
        revoked(&mut engine, &claimed.session.token);
    }
}

#[test]
fn legacy_nul_oldest_request_does_not_poison_claim_batch() {
    let mut engine = engine();
    seed(&engine, LEGACY, 0, None);
    seed(&engine, "healthy", 1, None);
    let claims = engine
        .claim_action_set("service:worker", &[ACTION.into()], 2, 1_000, 60, 10)
        .unwrap();
    assert_eq!(
        claims
            .iter()
            .map(|claim| claim.request.id.as_str())
            .collect::<Vec<_>>(),
        [LEGACY, "healthy"]
    );
    assert!(claims.iter().all(|claim| claim.request.state == "running"
        && claim.request.attempt == 1
        && claim.request.lease_until == Some(1_010)));
}

#[test]
fn legacy_nul_request_replay_and_authority_failure_address_stored_keys() {
    let mut engine = engine();
    seed(&engine, LEGACY, 0, None);
    let changes = (match &engine.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).conn().total_changes();
    // The client invocation-id admission now refuses NUL via identity_fits.
    // Replaying a stored row remains an adapter/policy operation, not new
    // identity admission; pin both sides of that boundary.
    assert_eq!(engine.request_action(ACTION, LEGACY,
        crate::Context::new("dev:alice", Default::default()).at(10)).unwrap_err().code(), "E_INPUT");
    let tx = engine.store_mut().transaction().unwrap();
    assert!(tx.request("not\0stored").unwrap().is_none());
    assert!(tx.work_by_id("not\0stored").unwrap().is_none());
    let run = crate::engine::actions::replay(&tx, LEGACY, "dev:alice", ACTION, &serde_json::json!({}), 10)
        .unwrap().unwrap();
    assert_eq!(run.id, LEGACY);
    tx.rollback().unwrap();
    assert_eq!((match &engine.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).conn().total_changes(), changes);
    (match &engine.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).conn().execute("UPDATE _requests SET family = 'revoked', principal_generation = 0, admitted_expires_at = 100 WHERE id = ?1", [LEGACY]).unwrap();
    assert!(
        engine
            .claim_actions("service:worker", Some(ACTION), 1, 1_000, 60, 10)
            .unwrap()
            .is_empty()
    );
    let tx = engine.store_mut().transaction().unwrap();
    let run = tx.request(LEGACY).unwrap().unwrap();
    assert_eq!(run.state, "failed");
    assert_eq!(run.error_code.as_deref(), Some("E_ACTION_AUTHORITY"));
    assert_eq!(run.settled_at, Some(10));
}

#[test]
fn legacy_nul_request_settlement_preserves_done_refused_and_retry_outcomes() {
    for case in ["done", "refused", "retry"] {
        let mut engine = engine();
        seed(&engine, LEGACY, 0, None);
        let claimed = claim(&mut engine, 0);
        let settled = match case {
            "done" => ActionSettled::Done(serde_json::json!({"ok": true})),
            "refused" => ActionSettled::Refused {
                code: "E_REFUSED",
                error: "refused".into(),
            },
            _ => ActionSettled::Failed {
                error: "retry".into(),
                retry: true,
            },
        };
        let run = engine
            .settle_action(
                LEGACY,
                "service:worker",
                &claimed.session.token,
                settled,
                10,
            )
            .unwrap();
        assert_eq!(
            run.state,
            match case {
                "done" => "done",
                "refused" => "failed",
                _ => "queued",
            }
        );
        assert_eq!(run.settled_at, (case != "retry").then_some(10));
        if case == "done" {
            assert_eq!(run.result, Some(serde_json::json!({"ok": true})));
        }
        if case == "refused" {
            assert_eq!(run.error_code.as_deref(), Some("E_REFUSED"));
        }
        revoked(&mut engine, &claimed.session.token);
    }
}

#[test]
fn legacy_nul_request_cancellation_preserves_cooperative_fence() {
    let mut engine = engine();
    seed(&engine, LEGACY, 0, None);
    let claimed = claim(&mut engine, 0);
    let run = engine.cancel_action(LEGACY, "dev:alice", 10).unwrap();
    assert_eq!(run.state, "failed");
    assert_eq!(run.error_code.as_deref(), Some("E_ACTION_CANCELLED"));
    assert!(run.cancelled);
    assert_eq!(run.lease_until, Some(1_000));
    assert_eq!(run.settled_at, Some(10));
    revoked(&mut engine, &claimed.session.token);
    let error = engine
        .settle_action(
            LEGACY,
            "service:worker",
            &claimed.session.token,
            ActionSettled::Done(serde_json::Value::Null),
            11,
        )
        .unwrap_err();
    assert_eq!(error.code(), "E_ACTION_LEASE");
}
