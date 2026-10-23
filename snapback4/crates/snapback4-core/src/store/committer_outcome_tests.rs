use super::*;
use std::cell::Cell;

#[test]
fn known_commit_rollback_reruns_once_without_publishing_first_attempt() {
    let mut store = AnyStore::memory().unwrap();
    store.test_support_conn().execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE parent(id INTEGER PRIMARY KEY); INSERT INTO parent VALUES(1); CREATE TABLE child(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)").unwrap();
    let attempts = Cell::new(0);
    let resolution = Committer::run_program(&mut store, None, "alice", None, |tx| {
        attempts.set(attempts.get() + 1);
        tx.tx.test_support_conn().execute(
            "INSERT INTO child VALUES(?1)",
            [if attempts.get() == 1 { 2 } else { 1 }],
        )?;
        tx.complete(Pending::new(attempts.get(), attempts.get()))
    })
    .unwrap();
    assert_eq!(attempts.get(), 2);
    let value = Committer::finish(&mut store, resolution, |store, data, value| {
        assert_eq!(
            store
                .test_support_conn()
                .query_row("SELECT count(*) FROM child", [], |row| row.get::<_, i64>(0))?,
            1
        );
        assert_eq!(data, 2);
        Ok(value)
    })
    .unwrap();
    assert_eq!(value, 2);
}

#[test]
fn failed_rollback_does_not_authorize_rerun() {
    let mut store = AnyStore::memory().unwrap();
    let attempts = Cell::new(0);
    let result: Result<Resolution<()>, _> =
        Committer::run_program(&mut store, None, "alice", None, |tx| {
            attempts.set(attempts.get() + 1);
            tx.tx.test_support_conn().execute_batch("ROLLBACK")?;
            Err(RuntimeError::Store("original failure".into()))
        });
    assert!(matches!(result, Err(RuntimeError::CommitOutcomeUnknown(_))));
    assert_eq!(attempts.get(), 1);
}

#[test]
fn ambiguity_ownership_loss_and_transport_absence_are_not_abort_evidence() {
    for error in [
        RuntimeError::CommitOutcomeUnknown("lost ack".into()),
        RuntimeError::StoreOwnership("new owner".into()),
        RuntimeError::Store("disconnected".into()),
    ] {
        assert!(!Failure::commit(error).aborted);
    }
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn fallback_cancellable_flights_use_one_remaining_deadline() {
    use postgres::{Client, NoTls};
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let namespace = format!("sb4_eval_g23_budget_{:x}", crate::ids::seed());
    let mut engine = crate::Engine::new_at(
        AnyStore::create_postgres(&connection, &namespace).unwrap(),
        crate::Schema::default(),
        [],
        1000,
    )
    .unwrap();
    let mut control = Client::connect(&connection, NoTls).unwrap();
    control.batch_execute(&format!("SET search_path={namespace},pg_catalog; CREATE TABLE g23_parent(id int PRIMARY KEY); INSERT INTO g23_parent VALUES(1); CREATE TABLE g23_child(id int REFERENCES g23_parent(id) DEFERRABLE INITIALLY DEFERRED)")).unwrap();
    let attempts = Cell::new(0);
    let completed = Cell::new(0);
    let result = Committer::run_program_until(
        engine.store_mut(),
        None,
        "alice",
        None,
        Instant::now() + Duration::from_millis(500),
        |member| {
            attempts.set(attempts.get() + 1);
            let tx = member.tx.test_postgres_tx();
            if attempts.get() == 1 {
                tx.execute("INSERT INTO g23_child VALUES(2)", &[])?;
            } else {
                for _ in 0..3 {
                    tx.query("SELECT pg_sleep(0.3)", &[])?;
                    completed.set(completed.get() + 1);
                }
            }
            member.complete(Pending::value(()))
        },
    );
    assert!(result.is_err());
    assert_eq!(attempts.get(), 2);
    assert!(completed.get() < 3);
    assert_eq!(
        control
            .query_one("SELECT count(*) FROM g23_child", &[])
            .unwrap()
            .get::<_, i64>(0),
        0
    );
    // An expired attempt cannot poison another invocation's connection.
    Committer::run_program(engine.store_mut(), None, "alice", None, |member| {
        member
            .tx
            .test_postgres_tx()
            .execute("INSERT INTO g23_child VALUES(1)", &[])?;
        member.complete(Pending::value(()))
    })
    .unwrap();
    assert_eq!(
        control
            .query_one("SELECT count(*) FROM g23_child", &[])
            .unwrap()
            .get::<_, i64>(0),
        1
    );
}
