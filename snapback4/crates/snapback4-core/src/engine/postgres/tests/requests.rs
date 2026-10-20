//! The same request cases as SQLite, plus physical Postgres witnesses.
// @ref LLP 3000.009.001.000#10 — request family conformance on both adapters.
use super::super::{PostgresEngine, WriteMode, store::Store};
use crate::{
    authority::AuthorityTransaction,
    engine::actions::{
        self,
        requests::{NewRequest, RequestSettlement, RequestsStore, RequestsTransaction, test_cases},
    },
    schema::Schema,
};
use postgres::{Client, NoTls};
use std::{
    collections::BTreeMap,
    sync::{Arc, Barrier},
};

fn client() -> Client {
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES")
        .expect("SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES; run the ignored tests with an evaluation cluster");
    Client::connect(&url, NoTls).expect("connect to explicitly selected evaluation cluster")
}

fn engine() -> PostgresEngine {
    PostgresEngine::create(
        client(),
        &format!("sb4_eval_requests_{:x}", crate::ids::seed()),
        Schema::default(),
        [],
    )
    .unwrap()
}

fn name(store: &mut Store) -> String {
    store
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0)
}

fn new(id: &str) -> NewRequest<'_> {
    NewRequest {
        id,
        action: "work",
        args: "{}",
        principal: "dev:alice",
        at: 10,
        authority: None,
        args_digest: "digest",
        spec: "{}",
        contract: "contract",
        deadline: None,
        release: None,
        service_generation: None,
    }
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_finish_and_settlement_contract() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.execute("INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES ('delegated','dev:alice','action',10,1010,'delegated')", &[]).unwrap();
    test_cases::finish_and_settle(&tx, "delegated");
    tx.commit().unwrap();
    assert_eq!(
        e.store.request_counts().unwrap(),
        BTreeMap::from([("done".into(), 1)])
    );
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_selection_and_rollback_contract() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::selection(&tx);
    tx.rollback().unwrap();
    assert!(e.store.request_counts().unwrap().is_empty());
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_nulls_and_integer_bounds_contract() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::nulls_and_integer_bounds(&tx, |attempts| {
        tx.execute(
            "UPDATE _requests SET attempts = $1 WHERE id = 'wide'",
            &[&attempts],
        )
        .unwrap();
    });
    tx.commit().unwrap();
    assert_eq!(
        e.store.request_counts().unwrap(),
        BTreeMap::from([("queued".into(), 1)])
    );
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_legacy_nulls_contract() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.execute("INSERT INTO _requests(id, name, args, principal, at, state, family) VALUES ('legacy', 'work', '{}', 'dev:alice', $1, 'queued', 'partial')", &[&i64::MIN]).unwrap();
    test_cases::legacy_nulls(&tx);
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_conditional_update_counts_contract() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::conditional_counts(&tx, |id, from, to| {
        let rows = tx
            .query(
                "UPDATE _requests SET state = $3 WHERE id = $1 AND state = $2 RETURNING id",
                &[&id, &from, &to],
            )
            .unwrap();
        if let Some(row) = rows.first() {
            assert_eq!(row.get::<_, &str>(0), id);
        }
        rows.len() as u64
    });
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_authority_and_lease_contract() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.execute("INSERT INTO _sessions(token_digest, principal, kind, created_at, expires_at, family) VALUES ('admitting', 'alice', 'member', 0, 100, 'family'), ('delegated', 'alice', 'action', 10, 80, 'delegated')", &[]).unwrap();
    test_cases::authority_and_lease(&tx);
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_writes_require_the_existing_head_fence() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.insert_request(&new("fenced")).unwrap();
    tx.claim_request("fenced", "worker", "digest", 100).unwrap();
    tx.commit().unwrap();
    for mode in [None, Some(WriteMode::Serializable)] {
        let tx = e.store.transaction(mode).unwrap();
        for error in [
            tx.insert_request(&new("forbidden")).unwrap_err(),
            tx.finish_request("fenced", "parked", "E_STEP_PARKED", "error", 20)
                .unwrap_err(),
            tx.requeue_request("fenced", 20).unwrap_err(),
            tx.fail_request_authority("fenced", "error", 20)
                .unwrap_err(),
            tx.claim_request("fenced", "other", "other", 200)
                .unwrap_err(),
            tx.settle_request(
                "fenced",
                &RequestSettlement {
                    state: "done",
                    result: None,
                    error: None,
                    next_at: None,
                    settled_at: Some(20),
                    error_code: None,
                },
            )
            .unwrap_err(),
            tx.cancel_request("fenced").unwrap_err(),
        ] {
            assert!(
                error.to_string().contains("serialized shared-head fence"),
                "{error}"
            );
        }
        assert!(actions::finish(&tx, "fenced", "parked", "E_STEP_PARKED", "error", 20).is_err());
        let run = tx.request("fenced").unwrap().unwrap();
        assert_eq!(run.state, "running");
        assert_eq!(run.attempt, 1);
        assert_eq!(run.lease_until, Some(100));
        assert!(!run.cancelled);
        assert!(tx.request("forbidden").unwrap().is_none());
        tx.rollback().unwrap();
    }
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_upgrade_and_reopen_preserve_legacy_rows_without_noop_alter_locks() {
    let mut e = engine();
    let name = name(&mut e.store);
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.execute("INSERT INTO _requests(id, name, args, principal, at, state) VALUES ('legacy', 'work', '{}', 'dev:alice', $1, 'queued')", &[&i64::MIN]).unwrap();
    // Simulate the predecessor layout. The fresh DDL already has these columns.
    tx.batch("ALTER TABLE _requests DROP COLUMN family, DROP COLUMN principal_generation, DROP COLUMN admitted_expires_at, DROP COLUMN args_digest, DROP COLUMN error_code, DROP COLUMN settled_at, DROP COLUMN spec, DROP COLUMN contract, DROP COLUMN deadline, DROP COLUMN release, DROP COLUMN service_generation, DROP COLUMN cancelled; DROP TABLE _meta").unwrap();
    tx.commit().unwrap();
    drop(e);
    let mut e = PostgresEngine::open(client(), &name).unwrap();
    let tx = e.store.transaction(None).unwrap();
    test_cases::legacy_nulls(&tx);
    assert!(tx.request_release().unwrap().is_none());
    tx.rollback().unwrap();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.execute(
        "INSERT INTO _meta(key,value) VALUES ('release','release-v1')",
        &[],
    )
    .unwrap();
    tx.commit().unwrap();
    // Hold AccessShareLock: an unconditional ALTER (even ADD IF NOT EXISTS)
    // during open would wait and hit attach's lock timeout.
    let reader = e.store.transaction(None).unwrap();
    test_cases::legacy_nulls(&reader);
    assert_eq!(
        reader.request_release().unwrap().as_deref(),
        Some("release-v1")
    );
    let mut reopened = PostgresEngine::open(client(), &name).unwrap();
    assert_eq!(
        reopened.store.request_counts().unwrap(),
        BTreeMap::from([("queued".into(), 1)])
    );
    reader.rollback().unwrap();
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_finish_rollback_snapshot_and_reopen_are_atomic() {
    let mut e = engine();
    let name = name(&mut e.store);
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.insert_request(&new("snapshot")).unwrap();
    tx.execute("INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES ('delegated','dev:alice','action',10,100,'delegated')", &[]).unwrap();
    tx.claim_request("snapshot", "worker", "delegated", 100)
        .unwrap();
    tx.commit().unwrap();
    let mut writer = PostgresEngine::open(client(), &name).unwrap();
    let reader = e.store.transaction(None).unwrap();
    assert_eq!(
        reader.request("snapshot").unwrap().unwrap().state,
        "running"
    );
    let tx = writer
        .store
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    actions::finish(&tx, "snapshot", "parked", "E_STEP_PARKED", "uncertain", 20).unwrap();
    tx.cancel_request("snapshot").unwrap();
    assert!(tx.session_by_digest("delegated").unwrap().is_none());
    tx.rollback().unwrap();
    let tx = writer
        .store
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    assert!(tx.session_by_digest("delegated").unwrap().is_some());
    assert!(!tx.request("snapshot").unwrap().unwrap().cancelled);
    actions::finish(&tx, "snapshot", "parked", "E_STEP_RESULT", "oversized", 30).unwrap();
    tx.cancel_request("snapshot").unwrap();
    tx.commit().unwrap();
    assert_eq!(
        reader.request("snapshot").unwrap().unwrap().state,
        "running"
    );
    assert!(reader.session_by_digest("delegated").unwrap().is_some());
    reader.rollback().unwrap();
    drop(writer);
    let mut reopened = PostgresEngine::open(client(), &name).unwrap();
    let tx = reopened.store.transaction(None).unwrap();
    let run = tx.request("snapshot").unwrap().unwrap();
    assert_eq!(run.state, "parked");
    assert_eq!(run.error_code.as_deref(), Some("E_STEP_RESULT"));
    assert_eq!(run.settled_at, Some(30));
    assert_eq!(run.lease_until, Some(100));
    assert!(run.cancelled);
    assert!(tx.session_by_digest("delegated").unwrap().is_none());
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_claim_race_has_exactly_one_winner() {
    let mut e = engine();
    let name = name(&mut e.store);
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.insert_request(&new("race")).unwrap();
    test_cases::insert(&tx, "conditional-race", "conditional", 10);
    tx.commit().unwrap();
    let mut engines = [
        PostgresEngine::open(client(), &name).unwrap(),
        PostgresEngine::open(client(), &name).unwrap(),
    ];
    for e in &mut engines {
        let tx = e.store.transaction(None).unwrap();
        assert_eq!(
            tx.due_requests(10, Some("work"), None, 1).unwrap(),
            ["race"]
        );
        tx.rollback().unwrap();
    }
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = engines.into_iter().enumerate().map(|(n, mut e)| {
        let barrier = barrier.clone();
        std::thread::spawn(move || {
            barrier.wait();
            let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
            let won = test_cases::claim_due(&tx, &format!("service:worker{n}"));
            let conditional = tx.query("UPDATE _requests SET state = 'running' WHERE id = 'conditional-race' AND state = 'queued' RETURNING id", &[]).unwrap();
            if let Some(row) = conditional.first() { assert_eq!(row.get::<_, &str>(0), "conditional-race"); }
            let rows = tx.query("UPDATE _requests SET state = 'failed' WHERE id = 'race' AND state = 'queued' RETURNING id", &[]).unwrap();
            assert!(rows.is_empty(), "stale conditional update cannot overwrite the winner");
            tx.commit().unwrap();
            (won, conditional.len())
        })
    }).collect();
    let winners: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(winners.iter().filter(|(won, _)| *won).count(), 1);
    let mut affected: Vec<_> = winners.iter().map(|(_, changed)| *changed).collect();
    affected.sort();
    assert_eq!(affected, [0, 1]);
    let tx = e.store.transaction(None).unwrap();
    let run = tx.request("race").unwrap().unwrap();
    assert_eq!(run.state, "running");
    assert_eq!(run.attempt, 1);
    assert_eq!(run.lease_until, Some(100));
}
