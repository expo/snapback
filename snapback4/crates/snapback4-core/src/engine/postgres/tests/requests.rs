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
    store::test_race::FenceRace,
};
use postgres::{Client, NoTls};
use std::{collections::BTreeMap, sync::Arc};

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
        for operation in 0..8 {
            let tx = e.store.transaction(mode).unwrap();
            let error = match operation {
                0 => tx.insert_request(&new("forbidden")).unwrap_err(),
                1 => tx
                    .finish_request("fenced", "parked", "E_STEP_PARKED", "error", 20)
                    .unwrap_err(),
                2 => tx.requeue_request("fenced", 20).unwrap_err(),
                3 => tx
                    .fail_request_authority("fenced", "error", 20)
                    .unwrap_err(),
                4 => tx
                    .claim_request("fenced", "other", "other", 200)
                    .unwrap_err(),
                5 => tx
                    .settle_request(
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
                6 => tx.cancel_request("fenced").unwrap_err(),
                7 => actions::finish(&tx, "fenced", "parked", "E_STEP_PARKED", "error", 20)
                    .unwrap_err(),
                _ => unreachable!(),
            };
            assert!(
                error.to_string().contains("serialized shared-head fence"),
                "{error}"
            );
            tx.rollback().unwrap();
            let tx = e.store.transaction(None).unwrap();
            let run = tx.request("fenced").unwrap().unwrap();
            assert_eq!(run.state, "running");
            assert_eq!(run.attempt, 1);
            assert_eq!(run.lease_until, Some(100));
            assert!(!run.cancelled);
            assert!(tx.request("forbidden").unwrap().is_none());
            tx.rollback().unwrap();
        }
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
    tx.commit().unwrap();
    let mut engines = [
        PostgresEngine::open(client(), &name).unwrap(),
        PostgresEngine::open(client(), &name).unwrap(),
    ];
    let (holder, contender) = engines.split_at_mut(1);
    let order = Arc::new(FenceRace::postgres(&mut holder[0].store.client, &mut contender[0].store.client, client()));
    let handles: Vec<_> = engines
        .into_iter()
        .enumerate()
        .map(|(n, mut e)| {
            let order = order.clone();
            std::thread::spawn(move || {
                let tx = e
                    .store
                    .transaction_with_begin_hook(Some(WriteMode::Serialized), || {
                        order.after_begin(n == 0)
                    })
                    .unwrap();
                order.after_fence(n == 0).unwrap();
                let won = test_cases::claim_due(&tx, &format!("service:worker{n}"));
                tx.commit().unwrap();
                won
            })
        })
        .collect();
    assert_eq!(
        handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect::<Vec<_>>(),
        [true, false]
    );
    let tx = e.store.transaction(None).unwrap();
    let run = tx.request("race").unwrap().unwrap();
    assert_eq!(run.state, "running");
    assert_eq!(run.attempt, 1);
    assert_eq!(run.lease_until, Some(100));
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn postgres_fence_race_rejects_a_contender_that_takes_no_fence() {
    use std::time::{Duration, Instant};
    let mut holder = engine();
    let name = name(&mut holder.store);
    let mut contender = PostgresEngine::open(client(), &name).unwrap();
    let timeout = Duration::from_millis(100);
    let race = FenceRace::postgres(&mut holder.store.client, &mut contender.store.client, client()).with_timeout(timeout);
    std::thread::scope(|scope| {
        let race = &race;
        let peer = scope.spawn(move || {
            let tx = contender.store.transaction_with_begin_hook(None, || race.after_begin(false)).unwrap();
            tx.rollback().unwrap();
        });
        let tx = holder.store.transaction_with_begin_hook(Some(WriteMode::Serialized), || race.after_begin(true)).unwrap();
        let started = Instant::now();
        assert_eq!(race.after_fence(true).unwrap_err(), "contender never blocked on the holder's fence");
        assert!(started.elapsed() >= timeout);
        tx.rollback().unwrap();
        peer.join().unwrap();
    });
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_expiry_vs_settlement_is_serialized_in_both_orders() {
    for expiry_first in [true, false] {
        let expected = test_cases::sqlite_expiry_settlement_outcome(expiry_first);
        let mut e = engine();
        let name = name(&mut e.store);
        let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
        let digest = crate::identity::digest("race-token");
        tx.execute("INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES ($1,'dev:alice','action',0,100,'delegated')", &[&digest]).unwrap();
        test_cases::seed_expiry_settlement(&tx, "race-token");
        tx.commit().unwrap();
        let mut engines = [
            PostgresEngine::open(client(), &name).unwrap(),
            PostgresEngine::open(client(), &name).unwrap(),
        ];
        let (holder, contender) = engines.split_at_mut(1);
        let order = Arc::new(FenceRace::postgres(&mut holder[0].store.client, &mut contender[0].store.client, client()));
        let handles: Vec<_> = engines
            .into_iter()
            .enumerate()
            .map(|(n, mut e)| {
                let order = order.clone();
                std::thread::spawn(move || {
                    let first = n == 0;
                    let tx = e
                        .store
                        .transaction_with_begin_hook(Some(WriteMode::Serialized), || {
                            order.after_begin(first)
                        })
                        .unwrap();
                    order.after_fence(first).unwrap();
                    let won = test_cases::expiry_settlement_operation(
                        &tx,
                        if first { expiry_first } else { !expiry_first },
                        "race-token",
                    );
                    tx.commit().unwrap();
                    won
                })
            })
            .collect();
        assert_eq!(
            handles
                .into_iter()
                .map(|h| h.join().unwrap())
                .collect::<Vec<_>>(),
            [true, false]
        );
        let tx = e.store.transaction(None).unwrap();
        assert_eq!(tx.request("expiry-race").unwrap(), Some(expected));
        assert!(tx.session_by_digest(&digest).unwrap().is_none());
    }
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_limited_expiry_contract() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::limited_expiry(&tx);
    tx.commit().unwrap();
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_duplicate_insert_ends_transaction() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::duplicate_insert(&tx);
    tx.rollback().unwrap();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    assert!(tx.request("duplicate").unwrap().is_none());
    test_cases::insert(&tx, "duplicate", "work", 0);
    tx.commit().unwrap();
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_nul_names_are_refused_before_writes() {
    let mut e = engine();
    for field in 0..7 {
        let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
        test_cases::nul_insertion(&tx, field);
        tx.rollback().unwrap();
        assert!(e.store.request_counts().unwrap().is_empty());
    }
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_diagnostic_and_json_text_contract() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.execute("INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES ('delegated','dev:alice','action',0,100,'delegated')", &[]).unwrap();
    test_cases::diagnostic_and_json_text(&tx);
    tx.commit().unwrap();
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_cached_reads_survive_additive_upgrade_on_another_connection() {
    let mut a = engine();
    let name = name(&mut a.store);
    let mut b = PostgresEngine::open(client(), &name).unwrap();
    let tx = a.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.insert_request(&NewRequest {
        deadline: Some(10),
        ..new("cached")
    })
    .unwrap();
    let before = tx.request("cached").unwrap().unwrap();
    assert_eq!(
        tx.expired_requests(10, 1).unwrap().as_slice(),
        std::slice::from_ref(&before)
    );
    tx.commit().unwrap();
    // A retains both prepared statements across transactions. B performs an
    // additive physical upgrade under the same head lock as attach.
    let tx = b.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.batch("ALTER TABLE _requests ADD COLUMN future_metadata TEXT")
        .unwrap();
    tx.commit().unwrap();
    let tx = a.store.transaction(None).unwrap();
    assert_eq!(tx.request("cached").unwrap(), Some(before.clone()));
    assert_eq!(tx.expired_requests(10, 1).unwrap(), [before]);
    tx.rollback().unwrap();
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_out_of_range_attempts_end_transaction_with_sql_error() {
    let mut e = engine();
    for attempts in [-1, u32::MAX as i64 + 1] {
        let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
        test_cases::insert(&tx, "wide", "work", 0);
        tx.execute(
            "UPDATE _requests SET attempts = $1 WHERE id = 'wide'",
            &[&attempts],
        )
        .unwrap();
        test_cases::invalid_attempts(&tx);
        tx.rollback().unwrap();
        assert!(e.store.request_counts().unwrap().is_empty());
    }
}

#[test]
#[ignore = "SKIP_POSTGRES_REQUESTS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn request_attach_refuses_volatile_or_rewritten_ledgers() {
    let table = "_requests";
    for ddl in [format!("ALTER TABLE {table} SET UNLOGGED"), format!("CREATE RULE discard AS ON INSERT TO {table} DO INSTEAD NOTHING")] {
        let mut e = engine();
        let name: String = e.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
        e.store.client.batch_execute(&ddl).unwrap();
        drop(e);
        let error = PostgresEngine::open(client(), &name).err().expect("incompatible request ledger must refuse");
        assert!(error.to_string().contains(&format!("SNAPBACK_REQUESTS_SCHEMA: {table}:")), "{error}");
    }
}
