//! High-level storage measurements for the Phase-1 telemetry proof.
//!
//! The benchmark façade receives only reports. Buffer state, SQLite
//! connections, transactions, and maintenance primitives remain private to
//! the services owner.

use super::*;
use std::hint::black_box;

// @ref LLP 0276#phases — the service owner keeps storage authority private;
// the remainder receives only benchmark observations.

const QUERY_NAMES_PER_BUCKET: usize = 200;

#[derive(Clone, Copy, Debug)]
pub struct StorageBenchmarkConfig {
    pub buffer_burst_events: usize,
    pub producer_flush_cycles: usize,
    pub flush_batches: usize,
    pub flush_batch_size: usize,
    pub sweep_rows: usize,
    pub query_rows: usize,
    pub query_samples: usize,
}

#[derive(Clone, Debug)]
pub struct StorageBenchmarkReport {
    pub burst_and_shed: BurstAndShedReport,
    pub event_armed_worker: EventArmedWorkerReport,
    pub file_cap: FileCapReport,
    pub flush: LatencyReport,
    pub checkpoint: LatencyReport,
    pub sweep: SweepReport,
    pub queries: QueryLatencyReport,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventArmedWorkerReport {
    pub default_batch_size: usize,
    pub cycles: usize,
    pub offered_events: usize,
    pub persisted_rows: u64,
    pub drops: u64,
    pub flush_wait: LatencyReport,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BurstAndShedReport {
    pub offered_events: usize,
    pub retained_events: usize,
    pub dropped_events: u64,
    pub reserved_events_retained: usize,
    pub reserved_capacity: usize,
    pub enqueue_us_per_event: f64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCapReport {
    pub cap_bytes: u64,
    pub main_wal_shm_bytes: u64,
    pub offered_normal_events: usize,
    pub offered_reserved_events: usize,
    pub retained_reserved_events: u64,
    pub dropped_events: u64,
    pub within_cap: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyReport {
    pub samples: usize,
    pub work_per_sample: usize,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub max_ms: f64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepReport {
    pub rows_before: u64,
    pub rows_after: u64,
    pub latency_ms: f64,
    pub wal_bytes_after: u64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryLatencyReport {
    pub source_rows: usize,
    pub hourly_rollup_rows: u64,
    pub daily_rollup_rows: u64,
    pub rollup_rows_scanned: u64,
    pub raw_rows_scanned: u64,
    pub event_page: LatencyReport,
    pub stats: LatencyReport,
}

pub fn run_storage_benchmark(
    config: StorageBenchmarkConfig,
) -> SnapbackResult<StorageBenchmarkReport> {
    Ok(StorageBenchmarkReport {
        burst_and_shed: measure_buffer_burst(config.buffer_burst_events)?,
        event_armed_worker: measure_event_armed_worker(config.producer_flush_cycles)?,
        file_cap: measure_file_cap()?,
        flush: measure_flush(config.flush_batches, config.flush_batch_size)?,
        checkpoint: measure_checkpoint(config.flush_batches, config.flush_batch_size)?,
        sweep: measure_sweep(config.sweep_rows)?,
        queries: measure_queries(config.query_rows, config.query_samples)?,
    })
}

pub fn counted_kind_rows(telemetry: &Telemetry, kind: &str) -> SnapbackResult<u64> {
    let mut store = telemetry
        .producer
        .shared
        .store
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let connection = store.ensure_connection(wall_now_ms())?;
    let count: i64 = connection.query_row(
        "SELECT count(*) FROM telemetry_events_visible WHERE kind=?1 AND phase IN ('point','joined','terminal')",
        [kind],
        |row| row.get(0),
    )?;
    Ok(count.max(0) as u64)
}

pub fn counted_application_rows(telemetry: &Telemetry) -> SnapbackResult<u64> {
    Ok(counted_kind_rows(telemetry, "function_run")?
        .saturating_add(counted_kind_rows(telemetry, "http_request")?))
}

pub fn wait_for_persisted_delta(
    telemetry: &Telemetry,
    kind: &str,
    before: u64,
    required_delta: u64,
    timeout: Duration,
) -> SnapbackResult<u64> {
    let started = Instant::now();
    loop {
        let delta = counted_kind_rows(telemetry, kind)?.saturating_sub(before);
        if delta >= required_delta {
            return Ok(delta);
        }
        if started.elapsed() >= timeout {
            return Err(bench_error(
                "SNAPBACK_TELEMETRY_BENCH_WORKER_TIMEOUT",
                format!("worker persisted {delta} {kind} rows; expected at least {required_delta}"),
            ));
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}

fn measure_buffer_burst(buffer_burst_events: usize) -> SnapbackResult<BurstAndShedReport> {
    let buffer_capacity = (buffer_burst_events / 2).clamp(1_024, 16_384);
    let reserved_capacity = (buffer_capacity / 8).max(1);
    let burst_config = TelemetryConfig {
        buffer_capacity,
        priority_reserve: reserved_capacity,
        batch_size: 256,
        max_age_ms: 60_000,
        ..TelemetryConfig::default()
    };
    burst_config.validate()?;
    let generation = ids::mint(IdKind::Generation)?;
    let mut buffer = Buffer {
        current_generation: generation.clone(),
        accepting: true,
        ..Buffer::default()
    };
    let started = Instant::now();
    for sequence in 0..buffer_burst_events {
        enqueue_locked(
            &mut buffer,
            &burst_config,
            benchmark_event(
                &generation,
                "function_run",
                "burst",
                sequence as u64,
                Priority::Normal,
                0,
            ),
        );
    }
    for sequence in 0..reserved_capacity {
        enqueue_locked(
            &mut buffer,
            &burst_config,
            benchmark_event(
                &generation,
                "diagnostic",
                "reserved",
                sequence as u64,
                Priority::Reserved,
                0,
            ),
        );
    }
    let elapsed_us = started.elapsed().as_secs_f64() * 1_000_000.0;
    let offered = buffer_burst_events + reserved_capacity;
    Ok(BurstAndShedReport {
        offered_events: offered,
        retained_events: buffer.len(),
        dropped_events: buffer.drops_since_boot.values().sum(),
        reserved_events_retained: buffer.reserved.len(),
        reserved_capacity,
        enqueue_us_per_event: elapsed_us / offered as f64,
    })
}

fn measure_event_armed_worker(cycles: usize) -> SnapbackResult<EventArmedWorkerReport> {
    let temp = BenchmarkTempDir::new("event-worker")?;
    let telemetry = Telemetry::open_for_database(
        &temp.path.join("app.sqlite3"),
        "01900000-0000-7000-8000-000000000001",
        TelemetryConfig::default(),
    )?;
    let mut samples = Vec::with_capacity(cycles);
    for cycle in 0..cycles {
        let started = Instant::now();
        for sequence in 0..DEFAULT_BATCH_SIZE {
            telemetry.point_classified(
                OperationClassIdV1::DIAGNOSTIC,
                &format!("event-armed-{cycle}-{sequence}"),
                Some(200),
                None,
                None,
                None,
                Priority::Normal,
            );
        }
        let target = ((cycle + 1) * DEFAULT_BATCH_SIZE) as u64;
        wait_for_persisted_delta(&telemetry, "diagnostic", 0, target, Duration::from_secs(10))?;
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    }
    let diagnostics = telemetry.diagnostics();
    let persisted_rows = counted_kind_rows(&telemetry, "diagnostic")?;
    Ok(EventArmedWorkerReport {
        default_batch_size: DEFAULT_BATCH_SIZE,
        cycles,
        offered_events: cycles * DEFAULT_BATCH_SIZE,
        persisted_rows,
        drops: diagnostics.drops_since_boot.values().sum(),
        flush_wait: latency_report(samples, DEFAULT_BATCH_SIZE),
    })
}

fn measure_file_cap() -> SnapbackResult<FileCapReport> {
    const CAP: u64 = 1024 * 1024;
    const RESERVED: usize = 20;
    const NORMAL: usize = 300;
    let temp = BenchmarkTempDir::new("cap")?;
    let path = temp.path.join("telemetry.sqlite3");
    let mut store = Store::open_unbound(
        path.clone(),
        "01900000-0000-7000-8000-000000000001",
        TelemetryConfig {
            file_size_cap_bytes: CAP,
            ..TelemetryConfig::default()
        },
    )?;
    let generation = store.generation.clone();
    let mut events = (0..RESERVED)
        .map(|sequence| {
            benchmark_event(
                &generation,
                "diagnostic",
                "reserved",
                sequence as u64,
                Priority::Reserved,
                0,
            )
        })
        .collect::<Vec<_>>();
    events.extend((0..NORMAL).map(|sequence| {
        benchmark_event(
            &generation,
            "function_run",
            "cap-normal",
            sequence as u64,
            Priority::Normal,
            6_000,
        )
    }));
    store.flush(events, BTreeMap::new(), wall_now_ms(), true)?;
    let physical = telemetry_file_bytes(&path);
    let connection = store.conn.as_ref().expect("file store opened");
    let retained_reserved: i64 = connection.query_row(
        "SELECT count(*) FROM telemetry_events WHERE kind='diagnostic' AND name='reserved'",
        [],
        |row| row.get(0),
    )?;
    let drops: String = connection.query_row(
        "SELECT drop_counters_lifetime FROM telemetry_meta WHERE singleton=1",
        [],
        |row| row.get(0),
    )?;
    let drops: BTreeMap<String, u64> = serde_json::from_str(&drops).unwrap_or_default();
    Ok(FileCapReport {
        cap_bytes: CAP,
        main_wal_shm_bytes: physical,
        offered_normal_events: NORMAL,
        offered_reserved_events: RESERVED,
        retained_reserved_events: retained_reserved.max(0) as u64,
        dropped_events: drops.values().sum(),
        within_cap: physical <= CAP,
    })
}

fn measure_flush(batches: usize, batch_size: usize) -> SnapbackResult<LatencyReport> {
    let temp = BenchmarkTempDir::new("flush")?;
    let mut store = Store::open_unbound(
        temp.path.join("telemetry.sqlite3"),
        "01900000-0000-7000-8000-000000000001",
        TelemetryConfig {
            file_size_cap_bytes: 256 * 1024 * 1024,
            sweep_interval_ms: 24 * 60 * 60 * 1_000,
            ..TelemetryConfig::default()
        },
    )?;
    let generation = store.generation.clone();
    let mut samples = Vec::with_capacity(batches);
    for batch in 0..batches {
        let events = (0..batch_size)
            .map(|offset| {
                benchmark_event(
                    &generation,
                    "function_run",
                    "flush",
                    (batch * batch_size + offset) as u64,
                    Priority::Normal,
                    0,
                )
            })
            .collect();
        let started = Instant::now();
        store.flush(events, BTreeMap::new(), wall_now_ms(), false)?;
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    }
    Ok(latency_report(samples, batch_size))
}

fn measure_checkpoint(batches: usize, batch_size: usize) -> SnapbackResult<LatencyReport> {
    let temp = BenchmarkTempDir::new("checkpoint")?;
    let mut store = Store::open_unbound(
        temp.path.join("telemetry.sqlite3"),
        "01900000-0000-7000-8000-000000000001",
        TelemetryConfig {
            file_size_cap_bytes: 256 * 1024 * 1024,
            sweep_interval_ms: 24 * 60 * 60 * 1_000,
            ..TelemetryConfig::default()
        },
    )?;
    let generation = store.generation.clone();
    let mut samples = Vec::with_capacity(batches);
    for batch in 0..batches {
        let events = (0..batch_size)
            .map(|offset| {
                benchmark_event(
                    &generation,
                    "function_run",
                    "checkpoint",
                    (batch * batch_size + offset) as u64,
                    Priority::Normal,
                    0,
                )
            })
            .collect();
        store.flush(events, BTreeMap::new(), wall_now_ms(), false)?;
        let started = Instant::now();
        store
            .conn
            .as_mut()
            .expect("checkpoint store opened")
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    }
    Ok(latency_report(samples, batch_size))
}

fn measure_sweep(sweep_rows: usize) -> SnapbackResult<SweepReport> {
    let temp = BenchmarkTempDir::new("sweep")?;
    let path = temp.path.join("telemetry.sqlite3");
    let mut store = Store::open_unbound(
        path.clone(),
        "01900000-0000-7000-8000-000000000001",
        TelemetryConfig {
            max_days: 1,
            file_size_cap_bytes: 256 * 1024 * 1024,
            ..TelemetryConfig::default()
        },
    )?;
    let generation = store.generation.clone();
    let base = wall_now_ms();
    for chunk_start in (0..sweep_rows).step_by(1_024) {
        let chunk_end = (chunk_start + 1_024).min(sweep_rows);
        let events = (chunk_start..chunk_end)
            .map(|sequence| {
                benchmark_event(
                    &generation,
                    "function_run",
                    "expired",
                    sequence as u64,
                    Priority::Normal,
                    0,
                )
            })
            .collect();
        store.flush(events, BTreeMap::new(), base, false)?;
    }
    let rows_before = store_row_count(&store)?;
    let started = Instant::now();
    store.flush(
        Vec::new(),
        BTreeMap::new(),
        base.saturating_add(2 * DAY_MS),
        true,
    )?;
    let latency_ms = started.elapsed().as_secs_f64() * 1_000.0;
    let rows_after = store_row_count(&store)?;
    let wal = PathBuf::from(format!("{}-wal", path.display()));
    let wal_bytes_after = fs::metadata(wal).map_or(0, |metadata| metadata.len());
    Ok(SweepReport {
        rows_before,
        rows_after,
        latency_ms,
        wal_bytes_after,
    })
}

fn measure_queries(query_rows: usize, query_samples: usize) -> SnapbackResult<QueryLatencyReport> {
    let telemetry = Telemetry::in_memory(
        "01900000-0000-7000-8000-000000000001",
        TelemetryConfig {
            file_size_cap_bytes: 256 * 1024 * 1024,
            ..TelemetryConfig::default()
        },
    )?;
    let now = wall_now_ms();
    let half = query_rows / 2;
    let buckets_per_tier = half / QUERY_NAMES_PER_BUCKET;
    let (hourly_rollup_rows, daily_rollup_rows) = {
        let mut store = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let generation = store.generation.clone();
        let fixture_config = store.config.clone();
        let connection = store.conn.as_mut().expect("query store opened");
        let transaction = connection.transaction()?;
        let current_hour = hour_start(now);
        let current_day = day_start(now);
        for bucket in 0..buckets_per_tier {
            let stamp = current_hour.saturating_sub((bucket as i64 + 1) * HOUR_MS);
            let events = (0..QUERY_NAMES_PER_BUCKET)
                .map(|name_index| {
                    benchmark_event(
                        &generation,
                        "function_run",
                        &format!("query-name-{name_index:03}"),
                        (bucket * QUERY_NAMES_PER_BUCKET + name_index) as u64,
                        Priority::Normal,
                        0,
                    )
                })
                .collect::<Vec<_>>();
            insert_batch(&transaction, &events, stamp, bucket as i64 + 1)?;
        }
        for bucket in 0..buckets_per_tier {
            let stamp = current_day.saturating_sub((100 + bucket as i64) * DAY_MS);
            let events = (0..QUERY_NAMES_PER_BUCKET)
                .map(|name_index| {
                    benchmark_event(
                        &generation,
                        "function_run",
                        &format!("query-name-{name_index:03}"),
                        (half + bucket * QUERY_NAMES_PER_BUCKET + name_index) as u64,
                        Priority::Normal,
                        0,
                    )
                })
                .collect::<Vec<_>>();
            insert_batch(
                &transaction,
                &events,
                stamp,
                (buckets_per_tier + bucket) as i64 + 1,
            )?;
        }
        maintain(&transaction, &fixture_config, now)?;
        transaction.commit()?;
        let hourly_rollup_rows = connection
            .query_row(
                "SELECT count(*) FROM telemetry_rollup_hourly WHERE generation=?1",
                [&generation],
                |row| row.get::<_, i64>(0),
            )?
            .max(0) as u64;
        let daily_rollup_rows = connection
            .query_row(
                "SELECT count(*) FROM telemetry_rollup_daily WHERE generation=?1",
                [&generation],
                |row| row.get::<_, i64>(0),
            )?
            .max(0) as u64;
        (hourly_rollup_rows, daily_rollup_rows)
    };
    let event_request = crate::telemetry_query::TelemetryEventsRequestV1 {
        limit: 100,
        ..Default::default()
    };
    let stats_request = crate::telemetry_query::TelemetryStatsRequestV1::default();
    let baseline_stats = telemetry.query_stats(&stats_request)?;
    let rollup_rows_scanned = baseline_stats
        .variance
        .truncation
        .get("workLimits")
        .and_then(|value| value.get("rollupRowsScanned"))
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let raw_rows_scanned = baseline_stats
        .coverage
        .raw_tail_rows
        .saturating_add(baseline_stats.coverage.raw_edge_rows);
    let mut event_samples = Vec::with_capacity(query_samples);
    let mut stats_samples = Vec::with_capacity(query_samples);
    for sample in 0..query_samples {
        if sample % 2 == 0 {
            time_events(&telemetry, &event_request, &mut event_samples)?;
            time_stats(&telemetry, &stats_request, &mut stats_samples)?;
        } else {
            time_stats(&telemetry, &stats_request, &mut stats_samples)?;
            time_events(&telemetry, &event_request, &mut event_samples)?;
        }
    }
    Ok(QueryLatencyReport {
        source_rows: query_rows,
        hourly_rollup_rows,
        daily_rollup_rows,
        rollup_rows_scanned,
        raw_rows_scanned,
        event_page: latency_report(event_samples, 100),
        stats: latency_report(stats_samples, rollup_rows_scanned as usize),
    })
}

fn time_events(
    telemetry: &Telemetry,
    request: &crate::telemetry_query::TelemetryEventsRequestV1,
    samples: &mut Vec<f64>,
) -> SnapbackResult<()> {
    let started = Instant::now();
    black_box(telemetry.query_events(request)?);
    samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    Ok(())
}

fn time_stats(
    telemetry: &Telemetry,
    request: &crate::telemetry_query::TelemetryStatsRequestV1,
    samples: &mut Vec<f64>,
) -> SnapbackResult<()> {
    let started = Instant::now();
    black_box(telemetry.query_stats(request)?);
    samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    Ok(())
}

fn benchmark_event(
    generation: &str,
    kind: &str,
    name: &str,
    sequence: u64,
    priority: Priority,
    detail_bytes: usize,
) -> Event {
    Event {
        sequence,
        admission: AdmittedObservationClassV1 {
            observation_id: ids::mint(IdKind::Observation).expect("benchmark CSPRNG"),
            registry_version: crate::telemetry_contract::OPERATION_CLASS_REGISTRY_VERSION,
            operation_class: "benchmark.fixture",
            telemetry_kind: kind.to_owned(),
            telemetry_projection: TelemetryProjectionModeV1::JoinedTerminal,
        },
        phase: Phase::Joined,
        generation: generation.to_owned(),
        ts_ms: wall_now_ms(),
        name: name.to_owned(),
        status: Some(200),
        duration_ms: Some(1.0),
        code: None,
        correlation: None,
        release: None,
        details: (detail_bytes > 0).then(|| json!({ "message": "x".repeat(detail_bytes) })),
        priority,
        enqueued_at: Instant::now(),
    }
}

fn store_row_count(store: &Store) -> SnapbackResult<u64> {
    let count: i64 = store
        .conn
        .as_ref()
        .expect("benchmark store opened")
        .query_row("SELECT count(*) FROM telemetry_events", [], |row| {
            row.get(0)
        })?;
    Ok(count.max(0) as u64)
}

fn latency_report(mut samples: Vec<f64>, work_per_sample: usize) -> LatencyReport {
    samples.sort_by(|left, right| left.total_cmp(right));
    LatencyReport {
        samples: samples.len(),
        work_per_sample,
        p50_ms: percentile(&samples, 0.50),
        p95_ms: percentile(&samples, 0.95),
        max_ms: samples.last().copied().unwrap_or_default(),
    }
}

fn percentile(sorted: &[f64], fraction: f64) -> f64 {
    let rank = (fraction * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len().saturating_sub(1))]
}

fn bench_error(code: &str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "telemetry-benchmark", message)
}

struct BenchmarkTempDir {
    path: PathBuf,
}

impl BenchmarkTempDir {
    fn new(label: &str) -> SnapbackResult<Self> {
        let path = std::env::temp_dir().join(format!(
            "snapback-telemetry-bench-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir(&path).map_err(|error| {
            bench_error(
                "SNAPBACK_TELEMETRY_BENCH_TEMPDIR_FAILED",
                format!("could not create {}: {error}", path.display()),
            )
        })?;
        Ok(Self { path })
    }
}

impl Drop for BenchmarkTempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
