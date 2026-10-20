//! Private-cluster Postgres witnesses for the same cases as store/job_tests.
use super::super::store::Tx;
use super::*;
use crate::engine::job::{
    JobStore, JobTransaction,
    test_cases::{self as cases, Fixture, RawJob},
};

fn connect() -> Client {
    Client::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES")
            .expect("SKIP P1-JB_POSTGRES_UNAVAILABLE: run with a private SNAPBACK4_EVAL_POSTGRES"),
        postgres::NoTls,
    )
    .unwrap()
}

struct Pg {
    engine: PostgresEngine,
    name: String,
}
impl Pg {
    fn new() -> Self {
        let name = format!("sb4_eval_jobs_{:x}", crate::ids::seed());
        Self {
            engine: PostgresEngine::create(connect(), &name, Schema::default(), []).unwrap(),
            name,
        }
    }
}
impl Drop for Pg {
    fn drop(&mut self) {
        let result = self
            .engine
            .store
            .client
            .batch_execute(&format!("DROP SCHEMA {} CASCADE", self.name));
        if !std::thread::panicking() {
            result.unwrap();
        }
    }
}
impl Fixture for Pg {
    type Store = Store;
    type Tx<'a> = Tx<'a>;
    fn store(&mut self) -> &mut Store {
        &mut self.engine.store
    }
    fn write(&mut self, commit: bool, work: impl FnOnce(&Tx<'_>)) {
        let tx = self
            .engine
            .store
            .transaction(Some(WriteMode::Serialized))
            .unwrap();
        work(&tx);
        if commit {
            tx.commit().unwrap();
        } else {
            tx.rollback().unwrap();
        }
    }
    fn savepoint(tx: &Tx<'_>) {
        tx.batch("SAVEPOINT program").unwrap();
    }
    fn rollback_to(tx: &Tx<'_>) {
        tx.rollback_program().unwrap();
    }
    fn seed_chunks(tx: &Tx<'_>, chunks: i64) {
        tx.execute("UPDATE _jobs SET chunks=$1", &[&chunks])
            .unwrap();
    }
    fn raw(&mut self, id: &str) -> RawJob {
        let row = self
            .engine
            .store
            .client
            .query_one(
                "SELECT args,domain,cursor,upper FROM _jobs WHERE id=$1",
                &[&id],
            )
            .unwrap();
        RawJob {
            args: row.get(0),
            domain: row.get(1),
            cursor: row.get(2),
            upper: row.get(3),
        }
    }
    fn set_meta(&mut self, key: &str, value: &str) {
        let tx = self
            .engine
            .store
            .transaction(Some(WriteMode::Serialized))
            .unwrap();
        tx.execute(
            "INSERT INTO _meta(key,value) VALUES ($1,$2)",
            &[&key, &value],
        )
        .unwrap();
        tx.commit().unwrap();
    }
}

macro_rules! shared {
    ($($case:ident),* $(,)?) => { $(
        #[test]
        #[ignore = "P1-JB_POSTGRES_UNAVAILABLE: requires private SNAPBACK4_EVAL_POSTGRES; scripts/test-postgres.sh"]
        fn $case() { cases::$case(&mut Pg::new()); }
    )* };
}
shared!(
    roundtrip,
    rollback,
    savepoint,
    ordering,
    integer_widths_and_encodings,
    cursor_null_empty_and_binary,
    summary_utf8,
    summary_cap_and_name_ties,
    schedule_metadata,
    park_finish_and_missing_rows
);
#[cfg(feature = "native")]
shared!(native_continuation);

#[test]
#[ignore = "P1-JB_POSTGRES_UNAVAILABLE: requires private SNAPBACK4_EVAL_POSTGRES; scripts/test-postgres.sh"]
fn writes_require_the_existing_serialized_head_fence() {
    let mut f = Pg::new();
    f.write(true, |tx| {
        tx.insert_job("a", "job", &BTreeMap::new(), "hash", 0)
            .unwrap()
    });
    for mode in [None, Some(WriteMode::Serializable)] {
        let tx = f.engine.store.transaction(mode).unwrap();
        let writes = [
            tx.insert_job("b", "job", &BTreeMap::new(), "hash", 0),
            tx.park_job("a", "park", 1),
            tx.finish_job_sweeps("a", 1, 1),
            tx.park_job_chunk("a", "park", 1, 1, 1, 1),
            tx.record_job_chunk(crate::engine::job::JobChunkUpdate {
                id: "a",
                state: crate::engine::job::JobState::Done,
                sweep: 1,
                cursor: None,
                upper: None,
                rows_written: 1,
                now: 1,
                size: 1,
                retries: 1,
                heap_peak: 1,
                domain: None,
            }),
            tx.set_schedule_shape("pulse", "shape"),
            tx.set_schedule_boundary("pulse", 1),
        ];
        for result in writes {
            assert!(
                result
                    .unwrap_err()
                    .to_string()
                    .contains("serialized shared-head fence")
            );
        }
        #[cfg(feature = "native")]
        assert!(
            tx.record_native_job_chunk("a", crate::engine::job::JobState::Done, None, 1, 1)
                .is_err()
        );
        assert_eq!(tx.head_job().unwrap().unwrap().run.chunks, 0);
        tx.rollback().unwrap();
    }
    assert_eq!(f.store().job_count().unwrap(), 1);
    assert_eq!(f.store().schedule_shape("pulse").unwrap(), None);
    assert_eq!(f.store().schedule_boundary("pulse").unwrap(), None);
}

#[test]
#[ignore = "P1-JB_POSTGRES_UNAVAILABLE: requires private SNAPBACK4_EVAL_POSTGRES; scripts/test-postgres.sh"]
fn two_connections_advance_the_same_job_under_the_writer_fence() {
    use std::time::{Duration, Instant};
    let mut f = Pg::new();
    f.write(true, |tx| {
        tx.insert_job("race", "race", &BTreeMap::new(), "hash", 0)
            .unwrap()
    });
    let mut client = connect();
    let pid: i32 = client
        .query_one("SELECT pg_backend_pid()", &[])
        .unwrap()
        .get(0);
    let mut second = PostgresEngine::open(client, &f.name).unwrap();
    let mut observer = connect();
    let tx = f
        .engine
        .store
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    assert_eq!(cases::race_step(&tx), 0);
    let join = std::thread::spawn(move || {
        let tx = second
            .store
            .transaction(Some(WriteMode::Serialized))
            .unwrap();
        let previous = cases::race_step(&tx);
        tx.commit().unwrap();
        previous
    });
    let start = Instant::now();
    let blocked = loop {
        let blocked: bool = observer.query_one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT seq FROM _head%FOR UPDATE' AND cardinality(pg_blocking_pids(pid)) > 0)", &[&pid]).unwrap().get(0);
        if blocked || start.elapsed() >= Duration::from_secs(4) {
            break blocked;
        }
        std::thread::sleep(Duration::from_millis(2));
    };
    tx.commit().unwrap();
    assert_eq!(
        join.join().unwrap(),
        1,
        "second writer must read the committed continuation"
    );
    assert!(
        blocked,
        "second Postgres connection must reach the shared-head lock"
    );
    cases::assert_race(f.store());
    f.write(false, |tx| {
        assert_eq!(tx.head_job().unwrap().unwrap().cursor, Some(vec![2]))
    });
}

#[test]
#[ignore = "P1-JB_POSTGRES_UNAVAILABLE: requires private SNAPBACK4_EVAL_POSTGRES; scripts/test-postgres.sh"]
fn attach_installs_missing_tables_and_reopens_while_a_reader_holds_them() {
    let mut f = Pg::new();
    f.engine
        .store
        .client
        .batch_execute("DROP TABLE _jobs; DROP TABLE _meta")
        .unwrap();
    let mut reopened = PostgresEngine::open(connect(), &f.name).unwrap();
    let tx = reopened
        .store
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    tx.insert_job("a", "job", &BTreeMap::new(), "hash", 0)
        .unwrap();
    tx.set_schedule_boundary("pulse", 10).unwrap();
    tx.commit().unwrap();
    let reader = reopened.store.transaction(None).unwrap();
    assert_eq!(reader.head_job().unwrap().unwrap().run.id, "a");
    assert_eq!(reader.schedule_boundary("pulse").unwrap(), Some(10));
    // Any unconditional ALTER/CREATE taking an exclusive lock would time out.
    let mut again = PostgresEngine::open(connect(), &f.name).unwrap();
    assert_eq!(again.store.job_count().unwrap(), 1);
    assert_eq!(again.store.schedule_boundary("pulse").unwrap(), Some(10));
    reader.rollback().unwrap();
}

#[test]
#[ignore = "P1-JB_POSTGRES_UNAVAILABLE: requires private SNAPBACK4_EVAL_POSTGRES; scripts/test-postgres.sh"]
fn stale_generation_inspection_is_refused() {
    let mut f = Pg::new();
    f.engine
        .store
        .client
        .execute("UPDATE _backend SET generation=generation+1", &[])
        .unwrap();
    for result in [
        f.store().job_count().map(|_| ()),
        f.store().jobs(1).map(|_| ()),
        f.store().job("missing").map(|_| ()),
        f.store().job_summaries(1).map(|_| ()),
        f.store().schedule_shape("pulse").map(|_| ()),
        f.store().schedule_boundary("pulse").map(|_| ()),
        f.store().latest_schedule_boundary().map(|_| ()),
    ] {
        assert_eq!(result.unwrap_err().code(), "E_GENERATION");
    }
}

#[test]
#[ignore = "P1-JB_POSTGRES_UNAVAILABLE: requires private SNAPBACK4_EVAL_POSTGRES; scripts/test-postgres.sh"]
fn a_refused_attach_rolls_back_job_table_creation() {
    let mut f = Pg::new();
    f.engine
        .store
        .client
        .batch_execute("DROP TABLE _jobs; DROP TABLE _meta; UPDATE _backend SET generation=-1")
        .unwrap();
    let error = PostgresEngine::open(connect(), &f.name)
        .err()
        .expect("negative generation refuses after physical upgrades");
    assert_eq!(error.code(), "E_GENERATION");
    for table in ["_jobs", "_meta"] {
        let present: bool = f
            .engine
            .store
            .client
            .query_one("SELECT to_regclass($1) IS NOT NULL", &[&table])
            .unwrap()
            .get(0);
        assert!(!present, "refused attach must roll back {table}");
    }
}
