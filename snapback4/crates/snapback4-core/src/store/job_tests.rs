//! SQLite supplies lifecycle/physical witnesses for the shared job contract.
use super::*;
use crate::engine::job::test_cases::{self as cases, Fixture, RawJob};

struct Sqlite(Store);
impl Fixture for Sqlite {
    type Store = Store;
    type Tx<'a> = Tx<'a>;
    fn store(&mut self) -> &mut Store {
        &mut self.0
    }
    fn write(&mut self, commit: bool, work: impl FnOnce(&Tx<'_>)) {
        let tx = self.0.transaction().unwrap();
        work(&tx);
        if commit {
            tx.commit().unwrap();
        } else {
            tx.rollback().unwrap();
        }
    }
    fn try_write(
        &mut self,
        work: impl FnOnce(&Tx<'_>) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError> {
        let tx = self.0.transaction()?;
        work(&tx)?;
        tx.commit()
    }
    fn savepoint(tx: &Tx<'_>) {
        tx.savepoint("program").unwrap();
    }
    fn rollback_to(tx: &Tx<'_>) {
        tx.rollback_to("program").unwrap();
    }
    fn seed_chunks(tx: &Tx<'_>, chunks: i64) {
        tx.conn()
            .execute("UPDATE _jobs SET chunks=?1", [chunks])
            .unwrap();
    }
    fn raw(&mut self, id: &str) -> RawJob {
        self.0
            .conn()
            .query_row(
                "SELECT args,domain,cursor,upper FROM _jobs WHERE id=?1",
                [id],
                |row| {
                    Ok(RawJob {
                        args: row.get(0)?,
                        domain: row.get(1)?,
                        cursor: row
                            .get::<_, Option<String>>(2)?
                            .and_then(|hex| decode_bytes_hex(&hex)),
                        upper: row
                            .get::<_, Option<String>>(3)?
                            .and_then(|hex| decode_bytes_hex(&hex)),
                    })
                },
            )
            .unwrap()
    }
    fn seed_schedule_metadata(&mut self, legacy_prefix: bool) {
        for &(key, value) in cases::schedule_metadata_seed(legacy_prefix) {
            let tx = self.0.transaction().unwrap();
            tx.set_meta(key, value).unwrap();
            tx.commit().unwrap();
        }
    }
}

macro_rules! shared {
    ($($case:ident),* $(,)?) => { $(
        #[test]
        fn $case() { cases::$case(&mut Sqlite(Store::memory().unwrap())); }
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
    park_finish_and_missing_rows,
    nul_admission_and_absent_lookups,
    park_chunk_normalizes_diagnostics,
    signed_counter_boundary,
    statement_error_is_terminal,
    oversized_limits
);
#[cfg(feature = "native")]
shared!(native_continuation, native_signed_counter_boundary);

#[test]
fn two_connections_advance_the_same_job_under_the_writer_fence() {
    use std::{
        sync::atomic::{AtomicBool, Ordering},
        time::{Duration, Instant},
    };
    static BLOCKED: AtomicBool = AtomicBool::new(false);
    fn busy(attempt: i32) -> bool {
        BLOCKED.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(1));
        attempt < 4000
    }
    let dir = std::env::temp_dir().join(format!("sb4_jobs_race_{:x}", crate::ids::seed()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let mut first = Store::open(&path).unwrap();
    let tx = first.transaction().unwrap();
    tx.insert_job("race", "race", &BTreeMap::new(), "hash", 0)
        .unwrap();
    tx.commit().unwrap();
    let mut second = Store::open(&path).unwrap();
    second.test_support_conn_mut().busy_handler(Some(busy)).unwrap();
    BLOCKED.store(false, Ordering::SeqCst);
    let tx = first.transaction().unwrap();
    assert_eq!(cases::race_step(&tx), 0);
    let join = std::thread::spawn(move || {
        let tx = second.transaction().unwrap();
        let previous = cases::race_step(&tx);
        tx.commit().unwrap();
        previous
    });
    let start = Instant::now();
    while !BLOCKED.load(Ordering::SeqCst) && start.elapsed() < Duration::from_secs(4) {
        std::thread::sleep(Duration::from_millis(1));
    }
    let blocked = BLOCKED.load(Ordering::SeqCst);
    tx.commit().unwrap();
    assert_eq!(
        join.join().unwrap(),
        1,
        "second writer must read the committed continuation"
    );
    assert!(
        blocked,
        "second SQLite connection must reach its writer lock"
    );
    cases::assert_race(&mut first);
    let tx = first.transaction().unwrap();
    assert_eq!(tx.head_job().unwrap().unwrap().cursor, Some(vec![2]));
    tx.rollback().unwrap();
    drop(first);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn legacy_nul_rows_remain_addressable() {
    let mut store = Store::memory().unwrap();
    let tx = store.transaction().unwrap();
    tx.insert_job("a", "job", &BTreeMap::new(), "hash", 0)
        .unwrap();
    // A pre-upgrade SQLite row, including a malformed saved boundary.
    tx.conn()
        .execute(
            "UPDATE _jobs SET id=?1,name=?2",
            params!["a\0id", "job\0name"],
        )
        .unwrap();
    tx.set_meta("schedule:pulse\0name", "broken").unwrap();
    tx.commit().unwrap();
    assert!(store.job("a\0id").unwrap().is_some());
    let tx = store.transaction().unwrap();
    assert_eq!(tx.head_job().unwrap().unwrap().run.id, "a\0id");
    tx.record_job_chunk(cases::counter_chunk("a\0id", 1))
        .unwrap();
    tx.park_job_chunk("a\0id", "reason\0detail", 1, 1, 0, 0)
        .unwrap();
    tx.park_job("a\0id", "reason\0detail", 2).unwrap();
    tx.finish_job_sweeps("a\0id", 1, 3).unwrap();
    tx.set_schedule_boundary("pulse\0name", 2).unwrap();
    tx.set_schedule_shape("pulse\0name", "shape").unwrap();
    tx.commit().unwrap();
    let run = store.job("a\0id").unwrap().unwrap();
    assert_eq!(
        (run.state, run.rows_written),
        (crate::engine::job::JobState::Done, 1)
    );
    assert_eq!(run.error.as_deref(), Some("reason\u{fffd}detail"));
    assert_eq!(store.schedule_boundary("pulse\0name").unwrap(), Some(2));
    assert_eq!(
        store.schedule_shape("pulse\0name").unwrap().as_deref(),
        Some("shape")
    );
}
