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

fn sqlite_deadline_fixture(bytes: usize) -> (AnyStore, std::path::PathBuf, std::path::PathBuf) {
    let directory = std::env::temp_dir().join(format!("sb4-g23-lock-{:x}", crate::ids::seed()));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("deadline.sqlite");
    let store = AnyStore::open(&path).unwrap();
    store
        .test_support_conn()
        .busy_timeout(Duration::from_millis(1234))
        .unwrap();
    store.test_support_conn().execute_batch(&format!("PRAGMA journal_mode=DELETE; PRAGMA cache_size=1; PRAGMA cache_spill=1; CREATE TABLE deadline_data(id INTEGER PRIMARY KEY,value BLOB); INSERT INTO deadline_data VALUES(1,zeroblob({bytes}))")).unwrap();
    assert_eq!(
        store
            .test_support_conn()
            .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "delete"
    );
    (store, path, directory)
}
fn hold_sqlite_lock(connection: rusqlite::Connection) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        connection.execute_batch("ROLLBACK").unwrap();
    })
}
#[test]
fn sqlite_fallback_begin_obeys_deadline_and_restores_contention_policy() {
    let (mut store, path, directory) = sqlite_deadline_fixture(16);
    let blocker = rusqlite::Connection::open(&path).unwrap();
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let holder = hold_sqlite_lock(blocker);
    let started = Instant::now();
    let bounded = Committer::open_program_before(
        &mut store,
        None,
        "alice",
        None,
        Some(Instant::now() + Duration::from_millis(20)),
    )
    .is_err();
    let elapsed = started.elapsed();
    let restored = store
        .test_support_conn()
        .query_row("PRAGMA busy_timeout", [], |row| row.get::<_, i64>(0))
        .unwrap();
    let normal = Instant::now();
    Committer::open_program(&mut store, None, "alice", None)
        .unwrap()
        .rollback()
        .unwrap();
    let ordinary_wait = normal.elapsed();
    holder.join().unwrap();
    assert!(
        bounded,
        "bounded BEGIN must not wait for the holder to exit"
    );
    assert!(
        elapsed < Duration::from_millis(300),
        "remaining deadline overrun: {elapsed:?}"
    );
    assert_eq!(restored, 1234);
    assert!(
        ordinary_wait > Duration::from_millis(100),
        "negative control must encounter the held lock: {ordinary_wait:?}"
    );
    drop(store);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn sqlite_fallback_page_spill_obeys_deadline_and_restores_contention_policy() {
    let (mut store, path, directory) = sqlite_deadline_fixture(1048576);
    store.test_support_conn().execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE deadline_parent(id INTEGER PRIMARY KEY); CREATE TABLE deadline_child(id INTEGER REFERENCES deadline_parent(id) DEFERRABLE INITIALLY DEFERRED)").unwrap();
    let attempts = Cell::new(0);
    let mut holder = None;
    let started = Instant::now();
    let result = Committer::run_program_until(
        &mut store,
        None,
        "alice",
        None,
        Instant::now() + Duration::from_millis(100),
        |member| {
            attempts.set(attempts.get() + 1);
            if attempts.get() == 1 {
                member
                    .tx
                    .test_support_conn()
                    .execute("INSERT INTO deadline_child VALUES(1)", [])?;
            } else {
                let blocker = rusqlite::Connection::open(&path)?;
                blocker.execute_batch("BEGIN")?;
                blocker.query_row("SELECT value FROM deadline_data", [], |row| {
                    row.get::<_, Vec<u8>>(0)
                })?;
                holder = Some(hold_sqlite_lock(blocker));
                // SQLite may defer a failed cache spill and return success. The
                // complete retry driver must still refuse a late COMMIT.
                member
                    .tx
                    .test_support_conn()
                    .execute("UPDATE deadline_data SET value=randomblob(1048576)", [])?;
            }
            member.complete(Pending::value(()))
        },
    );
    let elapsed = started.elapsed();
    let restored = store
        .test_support_conn()
        .query_row("PRAGMA busy_timeout", [], |row| row.get::<_, i64>(0))
        .unwrap();
    let normal = Instant::now();
    store
        .test_support_conn()
        .execute_batch("BEGIN EXCLUSIVE; ROLLBACK")
        .unwrap();
    let ordinary_wait = normal.elapsed();
    holder
        .take()
        .expect("the known abort must reach a fallback")
        .join()
        .unwrap();
    assert!(result.is_err(), "late fallback must not commit");
    assert_eq!(attempts.get(), 2);
    assert!(
        elapsed < Duration::from_millis(300),
        "remaining deadline overrun: {elapsed:?}"
    );
    assert_eq!(restored, 1234);
    assert!(
        ordinary_wait > Duration::from_millis(100),
        "negative control must encounter the held reader: {ordinary_wait:?}"
    );
    assert_eq!(
        store
            .test_support_conn()
            .query_row(
                "SELECT hex(substr(value,1,2)) FROM deadline_data",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "0000"
    );
    let n=store.test_support_conn().query_row("WITH RECURSIVE n(v) AS (VALUES(1) UNION ALL SELECT v+1 FROM n WHERE v<10000) SELECT count(*) FROM n",[],|row|row.get::<_,i64>(0)).unwrap();
    assert_eq!(n, 10000, "expired progress callback must be gone");
    drop(store);
    std::fs::remove_dir_all(directory).unwrap();
}

fn solo_tail_deadline(pg: bool) {
    use crate::engine::program_batch::fault;
    let mut engine = crate::engine::program_batch::tests::fixture(pg);
    if pg {
        #[cfg(feature="postgres")]
        engine.store_mut().test_postgres_handle_mut().store.get_mut().client.batch_execute("CREATE TABLE tail_parent(id int PRIMARY KEY); INSERT INTO tail_parent VALUES(1); CREATE TABLE tail_child(id int REFERENCES tail_parent(id) DEFERRABLE INITIALLY DEFERRED)").unwrap();
    } else {
        engine.store().test_support_conn().execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE tail_parent(id int PRIMARY KEY); INSERT INTO tail_parent VALUES(1); CREATE TABLE tail_child(id int REFERENCES tail_parent(id) DEFERRABLE INITIALLY DEFERRED)").unwrap();
    }
    let before = engine.seq().unwrap();
    let deadline = Instant::now() + Duration::from_millis(300);
    let tails = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let seen = tails.clone();
    let attempts = Cell::new(0);
    let result = fault::with_tail_hook(
        move || {
            if seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 1 {
                std::thread::sleep(
                    (deadline + Duration::from_millis(10))
                        .saturating_duration_since(Instant::now()),
                );
            }
        },
        || {
            Committer::run_program_until(
                engine.store_mut(),
                None,
                "alice",
                None,
                deadline,
                |member| {
                    attempts.set(attempts.get() + 1);
                    let id = if attempts.get() == 1 { 2 } else { 1 };
                    #[cfg(feature = "postgres")]
                    if pg {
                        member
                            .tx
                            .test_postgres_tx()
                            .execute("INSERT INTO tail_child VALUES($1)", &[&id])?;
                    }
                    if !pg {
                        member
                            .tx
                            .test_support_conn()
                            .execute("INSERT INTO tail_child VALUES(?1)", [id])?;
                    }
                    member.record_commit(
                        member.tx.next_seq()?,
                        1000,
                        ("tail", "alice", "mutation"),
                        &[],
                        1,
                    )?;
                    member.complete(Pending::value(()))
                },
            )
        },
    );
    assert_eq!(attempts.get(), 2);
    assert_eq!(tails.load(std::sync::atomic::Ordering::SeqCst), 2);
    assert!(
        result.is_err(),
        "N=1 must not select COMMIT after tail delivery crosses the deadline"
    );
    assert_eq!(engine.seq().unwrap(), before);
    #[cfg(feature = "postgres")]
    if pg {
        assert_eq!(
            engine
                .store_mut()
                .test_postgres_handle_mut()
                .store
                .get_mut()
                .client
                .query_one("SELECT count(*) FROM tail_child", &[])
                .unwrap()
                .get::<_, i64>(0),
            0
        );
    }
    if !pg {
        assert_eq!(
            engine
                .store()
                .test_support_conn()
                .query_row("SELECT count(*) FROM tail_child", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
#[test]
fn solo_deadline_after_verified_tail_sqlite() {
    solo_tail_deadline(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn solo_deadline_after_verified_tail_postgres() {
    solo_tail_deadline(true);
}
