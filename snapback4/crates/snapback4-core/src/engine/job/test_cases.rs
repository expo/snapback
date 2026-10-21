use super::*;

/// Lifecycle and physical witnesses are supplied by the adapter; assertions
/// and every family operation below are shared.
pub(crate) trait Fixture {
    type Store: JobStore;
    type Tx<'a>: JobTransaction
    where
        Self: 'a;
    fn store(&mut self) -> &mut Self::Store;
    fn write(&mut self, commit: bool, work: impl FnOnce(&Self::Tx<'_>));
    /// Own the transaction: an adapter error propagates and drops it before commit.
    fn try_write(
        &mut self,
        work: impl FnOnce(&Self::Tx<'_>) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError>;
    fn savepoint(tx: &Self::Tx<'_>);
    fn rollback_to(tx: &Self::Tx<'_>);
    fn seed_chunks(tx: &Self::Tx<'_>, chunks: i64);
    fn raw(&mut self, id: &str) -> RawJob;
    fn seed_schedule_metadata(&mut self, legacy_prefix: bool);
}

pub(crate) struct RawJob {
    pub args: String,
    pub domain: Option<String>,
    pub cursor: Option<Vec<u8>>,
    pub upper: Option<Vec<u8>>,
}

pub(crate) fn roundtrip(f: &mut impl Fixture) {
    f.write(true, |tx| queue_and_continue(tx));
    assert_committed(f.store());
    f.write(true, |tx| {
        assert_continuation(tx);
        advance(tx);
    });
    let run = f.store().job("a").unwrap().unwrap();
    assert_eq!(
        (run.state, run.chunks, run.rows_written),
        (JobState::Done, 2, 9)
    );
    assert_eq!(f.store().schedule_boundary("pulse").unwrap(), Some(120_000));
}

pub(crate) fn rollback(f: &mut impl Fixture) {
    f.write(false, |tx| queue_and_continue(tx));
    assert_eq!(f.store().job_count().unwrap(), 0);
    assert_eq!(f.store().schedule_shape("pulse").unwrap(), None);
    assert_eq!(f.store().schedule_boundary("pulse").unwrap(), None);
}

pub(crate) fn savepoint<F: Fixture>(f: &mut F) {
    f.write(true, |tx| queue_and_continue(tx));
    f.write(true, |tx| {
        F::savepoint(tx);
        advance(tx);
        F::rollback_to(tx);
        assert_continuation(tx);
        tx.park_job_chunk("a", "E_BOUND: fixture", 30, 1, 4, 4096)
            .unwrap();
    });
    let run = f.store().job("a").unwrap().unwrap();
    assert_eq!(
        (run.state, run.chunks, run.rows_written, run.retries),
        (JobState::Parked, 1, 2, 4)
    );
    let raw = f.raw("a");
    assert_eq!(raw.cursor.as_deref(), Some([0, 127, 255].as_slice()));
    assert_eq!(f.store().schedule_boundary("pulse").unwrap(), Some(60_000));
}

pub(crate) fn ordering(f: &mut impl Fixture) {
    f.write(true, |tx| {
        assert!(tx.head_job().unwrap().is_none());
        for (id, at) in [
            ("b", 10),
            ("a", 10),
            ("á", 10),
            ("Z", 10),
            ("old", 9),
            ("new", 11),
        ] {
            tx.insert_job(id, id, &BTreeMap::new(), "hash", at).unwrap();
        }
        // Head uses time then binary id, regardless of insertion or locale.
        for id in ["old", "Z", "a", "b", "á", "new"] {
            assert_eq!(tx.head_job().unwrap().unwrap().run.id, id);
            tx.finish_job_sweeps(id, 1, 20).unwrap();
        }
        assert!(tx.head_job().unwrap().is_none());
    });
    let ids = |runs: Vec<JobRun>| runs.into_iter().map(|run| run.id).collect::<Vec<_>>();
    assert_eq!(
        ids(f.store().jobs(100).unwrap()),
        ["new", "b", "a", "á", "Z", "old"]
    );
    assert_eq!(ids(f.store().jobs(3).unwrap()), ["new", "b", "a"]);
    assert!(f.store().jobs(0).unwrap().is_empty());
    assert_eq!(f.store().jobs(usize::MAX).unwrap().len(), 6);
    assert!(f.store().job("missing").unwrap().is_none());
}

fn domain() -> Scan {
    use crate::ir::{Bound, IndexKeyExpr, KeyProvenance, Order};
    Scan {
        site: "a ünicode domain".into(),
        table: "items".into(),
        index: "byId".into(),
        prefix: vec![IndexKeyExpr::Scalar(Expr::Literal(Value::Int(
            9_007_199_254_740_993,
        )))],
        order: Order::Desc,
        take: Bound::Literal(u32::MAX),
        existence: false,
        after: None,
        before: None,
        range: None,
        filter: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Const,
        variant: None,
        cursor_pins: 0,
    }
}

pub(crate) fn integer_widths_and_encodings<F: Fixture>(f: &mut F) {
    const WIDE: u64 = (1 << 53) + 1;
    let args = BTreeMap::from([
        ("wide".into(), Value::Int(i64::MAX)),
        ("bytes".into(), Value::Bytes(vec![0, 128, 255])),
        ("text".into(), Value::String("é🦀\n\0".into())),
    ]);
    let domain = domain();
    f.write(true, |tx| {
        tx.insert_job("wide", "wide", &args, "native-v1:exact bytes", WIDE as i64)
            .unwrap();
        F::seed_chunks(tx, WIDE as i64);
        tx.record_job_chunk(JobChunkUpdate {
            id: "wide",
            state: JobState::Running,
            sweep: u32::MAX as usize,
            cursor: Some(&[0, 128, 255]),
            upper: Some(&[255, 0]),
            rows_written: WIDE + 3,
            now: i64::MAX,
            size: u32::MAX,
            retries: WIDE + 1,
            heap_peak: WIDE + 2,
            domain: Some(&domain),
        })
        .unwrap();
        let head = tx.head_job().unwrap().unwrap();
        assert_eq!(head.args, args);
        assert_eq!(head.domain, Some(domain.clone()));
        assert_eq!(head.program_hash, "native-v1:exact bytes");
        assert_eq!((head.run.sweep, head.run.chunk_size), (u32::MAX, u32::MAX));
        assert_eq!(
            (
                head.run.chunks,
                head.run.rows_written,
                head.run.retries,
                head.run.heap_peak
            ),
            (WIDE + 1, WIDE + 3, WIDE + 1, WIDE + 2)
        );
        assert_eq!(
            (head.run.created_at, head.run.updated_at),
            (WIDE as i64, i64::MAX)
        );
    });
    let raw = f.raw("wide");
    assert_eq!(raw.args, canonical_json(&Value::Map(args.into())));
    assert_eq!(raw.domain, Some(canonical_json(&domain)));
    assert_eq!(raw.cursor, Some(vec![0, 128, 255]));
    assert_eq!(raw.upper, Some(vec![255, 0]));
    f.write(true, |tx| {
        tx.park_job_chunk(
            "wide",
            "wide park",
            i64::MIN,
            (1 << 31) + 7,
            WIDE + 7,
            WIDE + 8,
        )
        .unwrap()
    });
    let run = f.store().job("wide").unwrap().unwrap();
    assert_eq!(
        (run.chunk_size, run.retries, run.heap_peak, run.updated_at),
        ((1 << 31) + 7, WIDE + 7, WIDE + 8, i64::MIN)
    );
    let summary = f.store().job_summaries(100).unwrap().remove(0);
    assert_eq!(summary.rows_written, (WIDE + 3) as i64);
}

pub(crate) fn cursor_null_empty_and_binary(f: &mut impl Fixture) {
    f.write(true, |tx| {
        tx.insert_job("a", "cursor", &BTreeMap::new(), "hash", 0)
            .unwrap();
        let initial = tx.head_job().unwrap().unwrap();
        assert!(initial.cursor.is_none() && initial.upper.is_none() && initial.domain.is_none());
        for (cursor, upper) in [
            (Some([].as_slice()), Some([].as_slice())),
            (Some([0, 255, 128].as_slice()), Some([255, 0].as_slice())),
            (None, None),
        ] {
            tx.record_job_chunk(JobChunkUpdate {
                id: "a",
                state: JobState::Running,
                sweep: 0,
                cursor,
                upper,
                rows_written: 0,
                now: 0,
                size: 1,
                retries: 0,
                heap_peak: 0,
                domain: None,
            })
            .unwrap();
            let head = tx.head_job().unwrap().unwrap();
            assert_eq!(head.cursor.as_deref(), cursor);
            assert_eq!(head.upper.as_deref(), upper);
        }
    });
    let raw = f.raw("a");
    assert!(raw.cursor.is_none() && raw.upper.is_none());
}

pub(crate) fn summary_utf8(f: &mut impl Fixture) {
    f.write(true, |tx| {
        tx.insert_job("a", "utf8", &BTreeMap::new(), "hash", 10)
            .unwrap();
        tx.insert_job("b", "no-error", &BTreeMap::new(), "hash", 10)
            .unwrap();
    });
    // Shared policy replaces NUL before either inspection or truncation.
    // Include empty errors separately from the NULL error of the queued run.
    for error in ["abé🦀z", "ab\0é🦀z", "\0🦀", "a🦀🦀🦀🦀tail", ""] {
        f.write(true, |tx| tx.park_job("a", error, 20).unwrap());
        let normalized = error.replace('\0', "\u{fffd}");
        assert_eq!(
            f.store().job("a").unwrap().unwrap().error.as_deref(),
            Some(normalized.as_str())
        );
        for count in [0, 1, 2, 3, 4, 5, error.len(), usize::MAX] {
            let summaries = f.store().job_summaries(count).unwrap();
            assert_eq!(
                summaries.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
                ["b", "a"]
            );
            assert_eq!(summaries[0].state, "queued");
            assert!(summaries[0].error.is_none() && !summaries[0].error_truncated);
            let n = job_error_limit(count) as usize;
            let prefix = normalized.chars().take(n).collect::<String>();
            assert_eq!(summaries[1].error.as_deref(), Some(prefix.as_str()));
            assert_eq!(
                summaries[1].error_truncated,
                normalized.len() as i64 > job_error_limit(count)
            );
            assert_eq!(summaries[1].state, "parked");
        }
    }
}

pub(crate) fn summary_cap_and_name_ties(f: &mut impl Fixture) {
    f.write(true, |tx| {
        tx.insert_job("hidden", "outside-64", &BTreeMap::new(), "hash", 0)
            .unwrap();
        for i in (0..65).rev() {
            tx.insert_job(&format!("{i:02}"), "repeat", &BTreeMap::new(), "hash", 1)
                .unwrap();
        }
    });
    let summaries = f.store().job_summaries(3).unwrap();
    assert_eq!(summaries.len(), 1, "limit rows before deduplicating names");
    assert_eq!(
        (summaries[0].name.as_str(), summaries[0].id.as_str()),
        ("repeat", "64")
    );
}

// Physical fixtures stay behind each adapter's named test operation.
pub(crate) fn schedule_metadata_seed(legacy_prefix: bool) -> &'static [(&'static str, &'static str)] {
    if legacy_prefix {
        &[("SCHEDULE:legacy", "7")]
    } else {
        &[
            ("schedule:broken", "9223372036854775808"),
            ("schedule:not-a-time", "NaN"),
            ("schedule-shape:unrelated", "9223372036854775807"),
            ("release", "9223372036854775807"),
        ]
    }
}

pub(crate) fn schedule_metadata(f: &mut impl Fixture) {
    assert_eq!(f.store().latest_schedule_boundary().unwrap(), None);
    f.seed_schedule_metadata(false);
    assert_eq!(f.store().schedule_boundary("broken").unwrap(), None);
    assert_eq!(f.store().latest_schedule_boundary().unwrap(), None);
    // SQLite LIKE folds the ASCII prefix even for legacy/raw metadata keys.
    f.seed_schedule_metadata(true);
    assert_eq!(f.store().latest_schedule_boundary().unwrap(), Some(7));
    assert_eq!(f.store().schedule_boundary("legacy").unwrap(), None);
    f.write(true, |tx| {
        assert_eq!(tx.schedule_shape("pulse").unwrap(), None);
        assert_eq!(tx.schedule_boundary("broken").unwrap(), None);
        tx.set_schedule_boundary("negative", i64::MIN).unwrap();
        tx.set_schedule_boundary("pulse", (1 << 53) + 1).unwrap();
        tx.set_schedule_shape("pulse", "shape: é").unwrap();
        tx.set_schedule_boundary("pulse", i64::MAX).unwrap();
        assert_eq!(tx.schedule_boundary("pulse").unwrap(), Some(i64::MAX));
        assert_eq!(
            tx.schedule_shape("pulse").unwrap().as_deref(),
            Some("shape: é")
        );
    });
    f.write(false, |tx| {
        tx.set_schedule_shape("pulse", "rolled back").unwrap();
        tx.set_schedule_boundary("pulse", 0).unwrap();
    });
    assert_eq!(
        f.store().schedule_shape("pulse").unwrap().as_deref(),
        Some("shape: é")
    );
    assert_eq!(
        f.store().schedule_boundary("negative").unwrap(),
        Some(i64::MIN)
    );
    assert_eq!(
        f.store().schedule_boundary("pulse").unwrap(),
        Some(i64::MAX)
    );
    assert_eq!(
        f.store().latest_schedule_boundary().unwrap(),
        Some(i64::MAX)
    );
}

pub(crate) fn park_finish_and_missing_rows(f: &mut impl Fixture) {
    f.write(true, |tx| {
        tx.insert_job("a", "counts", &BTreeMap::new(), "hash", 0)
            .unwrap();
        tx.record_job_chunk(JobChunkUpdate {
            id: "a",
            state: JobState::Running,
            sweep: 1,
            cursor: Some(&[1]),
            upper: Some(&[2]),
            rows_written: 42,
            now: 1,
            size: 32,
            retries: 3,
            heap_peak: 64,
            domain: None,
        })
        .unwrap();
        tx.park_job("a", "park", 2).unwrap();
        tx.finish_job_sweeps("a", u32::MAX as usize, 3).unwrap();
        tx.park_job("missing", "no row", 4).unwrap();
        tx.finish_job_sweeps("missing", 4, 4).unwrap();
        tx.park_job_chunk("missing", "no row", 4, 1, 2, 3).unwrap();
        tx.record_job_chunk(JobChunkUpdate {
            id: "missing",
            state: JobState::Done,
            sweep: 1,
            cursor: None,
            upper: None,
            rows_written: 99,
            now: 4,
            size: 1,
            retries: 2,
            heap_peak: 3,
            domain: None,
        })
        .unwrap();
    });
    let run = f.store().job("a").unwrap().unwrap();
    assert_eq!(
        (run.state, run.sweep, run.chunks, run.rows_written),
        (JobState::Done, u32::MAX, 1, 42)
    );
    assert_eq!((run.chunk_size, run.retries, run.heap_peak), (32, 3, 64));
    assert_eq!((run.updated_at, run.error.as_deref()), (3, Some("park")));
    let raw = f.raw("a");
    assert!(raw.cursor.is_none() && raw.upper.is_none());
    assert_eq!(f.store().job_count().unwrap(), 1);
}

#[cfg(feature = "native")]
pub(crate) fn native_continuation(f: &mut impl Fixture) {
    let bytes = br#"{ "wide":9007199254740993,"next":[] }"#;
    f.write(true, |tx| {
        tx.insert_job("a", "native", &BTreeMap::new(), "hash", 0)
            .unwrap();
        tx.record_native_job_chunk("a", JobState::Running, Some(bytes), (1 << 53) + 1, 1)
            .unwrap();
        let head = tx.head_job().unwrap().unwrap();
        assert_eq!(head.cursor.as_deref(), Some(bytes.as_slice()));
        assert_eq!(head.run.rows_written, (1 << 53) + 1);
    });
    assert_eq!(f.raw("a").cursor.as_deref(), Some(bytes.as_slice()));
    f.write(true, |tx| {
        tx.record_native_job_chunk("a", JobState::Running, Some(&[]), 0, 2)
            .unwrap();
        assert_eq!(
            tx.head_job().unwrap().unwrap().cursor.as_deref(),
            Some([].as_slice())
        );
        tx.record_native_job_chunk("a", JobState::Done, None, 1, 3)
            .unwrap();
        tx.record_native_job_chunk("missing", JobState::Done, None, 10, 4)
            .unwrap();
    });
    let run = f.store().job("a").unwrap().unwrap();
    assert_eq!(
        (run.chunks, run.rows_written, run.state),
        (3, (1 << 53) + 2, JobState::Done)
    );
    assert_eq!(f.raw("a").cursor, None);
    assert_eq!(f.store().job_count().unwrap(), 1);
}

pub(crate) fn race_step(tx: &impl JobTransaction) -> u64 {
    let head = tx.head_job().unwrap().unwrap();
    assert_eq!(head.run.id, "race");
    let previous = head.run.rows_written;
    assert_eq!(
        head.cursor,
        if previous == 0 {
            None
        } else {
            Some(vec![previous as u8])
        }
    );
    tx.record_job_chunk(JobChunkUpdate {
        id: "race",
        state: JobState::Running,
        sweep: 0,
        cursor: Some(&[(previous + 1) as u8]),
        upper: None,
        rows_written: 1,
        now: 10,
        size: 1,
        retries: 0,
        heap_peak: 0,
        domain: None,
    })
    .unwrap();
    previous
}

pub(crate) fn assert_race(store: &mut impl JobStore) {
    let run = store.job("race").unwrap().unwrap();
    assert_eq!(
        (run.chunks, run.rows_written, run.state),
        (2, 2, JobState::Running)
    );
}

pub(crate) fn queue_and_continue(tx: &impl JobTransaction) {
    let args = BTreeMap::from([("periodEnd".into(), Value::Int(60_000))]);
    tx.insert_job("b", "tick", &args, "hash", 10).unwrap();
    tx.insert_job("a", "tick", &args, "hash", 10).unwrap();
    // FIFO ties use the id; adapter row order must not pick insertion order.
    assert_eq!(tx.head_job().unwrap().unwrap().run.id, "a");
    tx.record_job_chunk(JobChunkUpdate {
        id: "a",
        state: JobState::Running,
        sweep: 0,
        cursor: Some(&[0, 127, 255]),
        upper: Some(&[255, 255]),
        rows_written: 2,
        now: 20,
        size: 32,
        retries: 1,
        heap_peak: 1024,
        domain: None,
    })
    .unwrap();
    tx.set_schedule_shape("pulse", "shape").unwrap();
    tx.set_schedule_boundary("pulse", 60_000).unwrap();
    tx.park_job("b", "E_JOB_GENERATION: fixture", 20).unwrap();
    assert_continuation(tx);
}

pub(crate) fn assert_continuation(tx: &impl JobTransaction) {
    let head = tx.head_job().unwrap().unwrap();
    assert_eq!(head.run.id, "a");
    assert_eq!(head.run.state, JobState::Running);
    assert_eq!((head.run.chunks, head.run.rows_written), (1, 2));
    assert_eq!(head.cursor.as_deref(), Some([0, 127, 255].as_slice()));
    assert_eq!(head.upper.as_deref(), Some([255, 255].as_slice()));
    assert_eq!(head.args.get("periodEnd"), Some(&Value::Int(60_000)));
    assert_eq!(
        tx.schedule_shape("pulse").unwrap().as_deref(),
        Some("shape")
    );
    assert_eq!(tx.schedule_boundary("pulse").unwrap(), Some(60_000));
}

pub(crate) fn advance(tx: &impl JobTransaction) {
    tx.record_job_chunk(JobChunkUpdate {
        id: "a",
        state: JobState::Done,
        sweep: 1,
        cursor: None,
        upper: None,
        rows_written: 7,
        now: 30,
        size: 16,
        retries: 2,
        heap_peak: 2048,
        domain: None,
    })
    .unwrap();
    tx.set_schedule_boundary("pulse", 120_000).unwrap();
    assert!(tx.head_job().unwrap().is_none());
}

pub(crate) fn assert_committed(store: &mut impl JobStore) {
    assert_eq!(store.job_count().unwrap(), 2);
    let runs = store.jobs(2).unwrap();
    assert_eq!(runs.len(), 2);
    let run = store.job("b").unwrap().unwrap();
    assert_eq!(run.state, JobState::Parked);
    assert_eq!(run.error.as_deref(), Some("E_JOB_GENERATION: fixture"));
    assert_eq!(store.schedule_boundary("pulse").unwrap(), Some(60_000));
    assert_eq!(store.latest_schedule_boundary().unwrap(), Some(60_000));
}

pub(crate) fn nul_admission_and_absent_lookups(f: &mut impl Fixture) {
    f.write(true, |tx| {
        for (id, name) in [("bad\0id", "job"), ("good", "bad\0name")] {
            assert_eq!(
                tx.insert_job(id, name, &BTreeMap::new(), "hash", 0)
                    .unwrap_err()
                    .code(),
                "E_INPUT"
            );
        }
        assert_eq!(
            tx.set_schedule_shape("bad\0schedule", "shape")
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
        assert_eq!(
            tx.set_schedule_boundary("bad\0boundary", 1)
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
        assert_eq!(tx.schedule_shape("missing\0name").unwrap(), None);
        assert_eq!(tx.schedule_boundary("missing\0name").unwrap(), None);
        tx.park_job("missing\0id", "reason\0detail", 0).unwrap();
        tx.finish_job_sweeps("missing\0id", 1, 0).unwrap();
    });
    assert_eq!(f.store().job_count().unwrap(), 0);
    assert_eq!(f.store().job("missing\0id").unwrap(), None);
    assert_eq!(f.store().schedule_shape("missing\0name").unwrap(), None);
    assert_eq!(f.store().schedule_boundary("missing\0name").unwrap(), None);
}

pub(crate) fn park_chunk_normalizes_diagnostics(f: &mut impl Fixture) {
    f.write(true, |tx| {
        tx.insert_job("a", "job", &BTreeMap::new(), "hash", 0)
            .unwrap();
        tx.park_job_chunk("a", "ab\0🦀", 1, 1, 0, 0).unwrap();
    });
    assert_eq!(
        f.store().job("a").unwrap().unwrap().error.as_deref(),
        Some("ab\u{fffd}🦀")
    );
    let summary = f.store().job_summaries(3).unwrap().remove(0);
    assert_eq!(summary.error.as_deref(), Some("ab\u{fffd}"));
    assert!(summary.error_truncated);
}

pub(crate) fn signed_counter_boundary<F: Fixture>(f: &mut F) {
    for initial in [i64::MAX - 1, i64::MAX] {
        f.write(true, |tx| {
            tx.insert_job(&initial.to_string(), "counts", &BTreeMap::new(), "hash", 0)
                .unwrap();
            tx.record_job_chunk(counter_chunk(&initial.to_string(), initial as u64))
                .unwrap();
            F::seed_chunks(tx, initial);
        });
        for added in [1, u64::MAX] {
            f.write(true, |tx| {
                tx.record_job_chunk(counter_chunk(&initial.to_string(), added))
                    .unwrap()
            });
            let run = f.store().job(&initial.to_string()).unwrap().unwrap();
            assert_eq!(
                (run.chunks, run.rows_written, run.retries, run.heap_peak),
                (
                    i64::MAX as u64,
                    i64::MAX as u64,
                    i64::MAX as u64,
                    i64::MAX as u64
                )
            );
        }
    }
}

pub(crate) fn counter_chunk(id: &str, rows: u64) -> JobChunkUpdate<'_> {
    JobChunkUpdate {
        id,
        state: JobState::Running,
        sweep: 0,
        cursor: Some(&[1]),
        upper: None,
        rows_written: rows,
        now: 1,
        size: 1,
        retries: u64::MAX,
        heap_peak: u64::MAX,
        domain: None,
    }
}

#[cfg(feature = "native")]
pub(crate) fn native_signed_counter_boundary<F: Fixture>(f: &mut F) {
    for initial in [i64::MAX - 1, i64::MAX] {
        f.write(true, |tx| {
            tx.insert_job(&initial.to_string(), "native", &BTreeMap::new(), "hash", 0)
                .unwrap();
            tx.record_native_job_chunk(
                &initial.to_string(),
                JobState::Running,
                Some(&[0]),
                initial as u64,
                0,
            )
            .unwrap();
            F::seed_chunks(tx, initial);
        });
        for added in [1, u64::MAX] {
            f.write(true, |tx| {
                tx.record_native_job_chunk(
                    &initial.to_string(),
                    JobState::Running,
                    Some(&[1]),
                    added,
                    1,
                )
                .unwrap()
            });
            let run = f.store().job(&initial.to_string()).unwrap().unwrap();
            assert_eq!(
                (run.chunks, run.rows_written),
                (i64::MAX as u64, i64::MAX as u64)
            );
        }
    }
}

pub(crate) fn statement_error_is_terminal(f: &mut impl Fixture) {
    let after_error = std::cell::Cell::new(false);
    let result = f.try_write(|tx| {
        tx.insert_job("a", "job", &BTreeMap::new(), "hash", 0)?;
        tx.set_schedule_boundary("pulse", 1)?;
        // A real adapter statement failure: the primary key already exists.
        tx.insert_job("a", "duplicate", &BTreeMap::new(), "hash", 0)?;
        after_error.set(true);
        tx.park_job("a", "must not run", 1)?;
        Ok(())
    });
    assert!(result.is_err());
    assert!(
        !after_error.get(),
        "adapter errors must propagate out of their owning transaction"
    );
    assert_eq!(
        f.store().job_count().unwrap(),
        0,
        "earlier successful writes rolled back"
    );
    assert_eq!(f.store().schedule_boundary("pulse").unwrap(), None);
    f.try_write(|tx| tx.insert_job("a", "new transaction", &BTreeMap::new(), "hash", 1))
        .unwrap();
    assert_eq!(f.store().job_count().unwrap(), 1);
}

pub(crate) fn oversized_limits(f: &mut impl Fixture) {
    f.write(true, |tx| {
        for id in ["a", "b", "c"] {
            tx.insert_job(id, id, &BTreeMap::new(), "hash", 0).unwrap();
        }
        tx.park_job("a", "é\0🦀", 1).unwrap();
    });
    let expected = f.store().jobs(3).unwrap();
    for limit in [
        (i32::MAX as usize) + 1,
        i64::MAX as usize,
        (i64::MAX as usize).saturating_add(1),
        usize::MAX,
    ] {
        assert_eq!(f.store().jobs(limit).unwrap(), expected);
        let summary = f
            .store()
            .job_summaries(limit)
            .unwrap()
            .into_iter()
            .find(|s| s.id == "a")
            .unwrap();
        assert_eq!(summary.error.as_deref(), Some("é\u{fffd}🦀"));
        assert!(!summary.error_truncated);
    }
}
