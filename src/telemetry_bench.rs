//! Reproducible LLP 0154 Phase-1 capacity and latency evidence.
//!
//! This is deliberately a child of `telemetry`: the benchmark exercises the
//! same private buffer, batch, maintenance, and cap paths as production without
//! adding an author-facing telemetry mutation API.

use super::*;
use serde::Serialize;
use std::hint::black_box;

#[derive(Clone, Copy, Debug)]
pub struct Phase1BenchmarkConfig {
    pub buffer_burst_events: usize,
    pub flush_batches: usize,
    pub flush_batch_size: usize,
    pub sweep_rows: usize,
    pub query_rows: usize,
    pub query_samples: usize,
    pub app_samples: usize,
}

impl Phase1BenchmarkConfig {
    pub fn full() -> Self {
        Self {
            buffer_burst_events: 16_384,
            flush_batches: 24,
            flush_batch_size: 256,
            sweep_rows: 10_000,
            query_rows: 10_000,
            query_samples: 50,
            app_samples: 400,
        }
    }

    pub fn smoke() -> Self {
        Self {
            buffer_burst_events: 2_048,
            flush_batches: 3,
            flush_batch_size: 32,
            sweep_rows: 256,
            query_rows: 256,
            query_samples: 3,
            app_samples: 8,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Phase1BenchmarkReport {
    pub schema_version: String,
    pub method: String,
    pub environment: BenchmarkEnvironment,
    pub amplification: AmplificationReport,
    pub burst_and_shed: BurstAndShedReport,
    pub file_cap: FileCapReport,
    pub flush: LatencyReport,
    pub sweep: SweepReport,
    pub queries: QueryLatencyReport,
    pub app_latency: AppLatencyReport,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkEnvironment {
    pub build_commit: String,
    pub build_dirty: Option<bool>,
    pub os: String,
    pub architecture: String,
    pub profile: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AmplificationReport {
    pub application_queries: usize,
    pub counted_rows: u64,
    pub rows_per_request: f64,
    pub disabled_counted_rows: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BurstAndShedReport {
    pub offered_events: usize,
    pub retained_events: usize,
    pub dropped_events: u64,
    pub reserved_events_retained: usize,
    pub reserved_capacity: usize,
    pub enqueue_us_per_event: f64,
}

#[derive(Clone, Debug, Serialize)]
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyReport {
    pub samples: usize,
    pub work_per_sample: usize,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub max_ms: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepReport {
    pub rows_before: u64,
    pub rows_after: u64,
    pub latency_ms: f64,
    pub wal_bytes_after: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryLatencyReport {
    pub source_rows: usize,
    pub event_page: LatencyReport,
    pub stats: LatencyReport,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLatencyReport {
    pub samples_each: usize,
    pub telemetry_on: LatencyReport,
    pub telemetry_off: LatencyReport,
    pub p50_overhead_percent: f64,
    pub p95_overhead_percent: f64,
}

pub fn run_phase1_benchmark(
    config: &Phase1BenchmarkConfig,
) -> SnapbackResult<Phase1BenchmarkReport> {
    if config.buffer_burst_events < 1
        || config.flush_batches < 1
        || config.flush_batch_size < 1
        || config.flush_batch_size > 1_024
        || config.sweep_rows < 1
        || config.query_rows < 1
        || config.query_samples < 1
        || config.app_samples < 1
    {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_CONFIG_INVALID",
            "every benchmark size must be positive and a flush batch may not exceed 1024 rows",
        ));
    }

    let (amplification, app_latency) = measure_app_latency_and_amplification(config)?;
    let burst_and_shed = measure_buffer_burst(config)?;
    let file_cap = measure_file_cap()?;
    let flush = measure_flush(config)?;
    let sweep = measure_sweep(config)?;
    let queries = measure_queries(config)?;

    if (amplification.rows_per_request - 1.0).abs() > f64::EPSILON
        || amplification.disabled_counted_rows != 0
    {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_AMPLIFICATION_FAILED",
            format!(
                "one direct application query must produce exactly one counted function span and disabled telemetry must produce none; got {} and {}",
                amplification.rows_per_request, amplification.disabled_counted_rows
            ),
        ));
    }
    if burst_and_shed.dropped_events == 0
        || burst_and_shed.reserved_events_retained != burst_and_shed.reserved_capacity
    {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_SHED_FAILED",
            "the overload burst did not shed normal work while preserving the complete reserved slice",
        ));
    }
    if !file_cap.within_cap
        || file_cap.dropped_events == 0
        || file_cap.retained_reserved_events != file_cap.offered_reserved_events as u64
    {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_FILE_CAP_FAILED",
            "the physical cap gate did not remain under cap, shed work, and retain reserved events",
        ));
    }
    if sweep.rows_before != config.sweep_rows as u64 || sweep.rows_after != 0 {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_SWEEP_FAILED",
            "the retention sweep did not remove exactly the expired benchmark rows",
        ));
    }

    Ok(Phase1BenchmarkReport {
        schema_version: "snapback.telemetry-phase1-benchmark.v1".to_owned(),
        method: "release in-process benchmark over the shipped buffer/store/query seams; application latency uses real Ibex finite queries with telemetry alternated on/off".to_owned(),
        environment: BenchmarkEnvironment {
            build_commit: option_env!("SNAPBACK_BUILD_GIT_COMMIT")
                .unwrap_or("unknown")
                .to_owned(),
            build_dirty: option_env!("SNAPBACK_BUILD_GIT_DIRTY")
                .and_then(|value| value.parse::<bool>().ok()),
            os: std::env::consts::OS.to_owned(),
            architecture: std::env::consts::ARCH.to_owned(),
            profile: if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            }
            .to_owned(),
        },
        amplification,
        burst_and_shed,
        file_cap,
        flush,
        sweep,
        queries,
        app_latency,
    })
}

fn measure_app_latency_and_amplification(
    config: &Phase1BenchmarkConfig,
) -> SnapbackResult<(AmplificationReport, AppLatencyReport)> {
    let mut enabled = crate::bench::configured()?;
    let mut disabled = crate::bench::configured()?;
    enabled.set_telemetry_config(TelemetryConfig {
        buffer_capacity: 65_536,
        priority_reserve: 4_096,
        batch_size: 1_024,
        max_age_ms: 60_000,
        ..TelemetryConfig::default()
    })?;
    disabled.set_telemetry_config(TelemetryConfig {
        max_days: 0,
        ..TelemetryConfig::default()
    })?;
    for _ in 0..8 {
        enabled.invoke_query("noop", crate::bench::args(json!({})))?;
        disabled.invoke_query("noop", crate::bench::args(json!({})))?;
    }
    let enabled_telemetry = enabled.telemetry();
    let disabled_telemetry = disabled.telemetry();
    enabled_telemetry.force_flush()?;
    disabled_telemetry.force_flush()?;
    let enabled_before = counted_function_rows(&enabled_telemetry)?;
    let disabled_before = counted_function_rows(&disabled_telemetry)?;

    let mut on_samples = Vec::with_capacity(config.app_samples);
    let mut off_samples = Vec::with_capacity(config.app_samples);
    for index in 0..config.app_samples {
        if index % 2 == 0 {
            time_query(&enabled, &mut on_samples)?;
            time_query(&disabled, &mut off_samples)?;
        } else {
            time_query(&disabled, &mut off_samples)?;
            time_query(&enabled, &mut on_samples)?;
        }
    }
    enabled_telemetry.force_flush()?;
    disabled_telemetry.force_flush()?;
    let enabled_rows = counted_function_rows(&enabled_telemetry)?.saturating_sub(enabled_before);
    let disabled_rows = counted_function_rows(&disabled_telemetry)?.saturating_sub(disabled_before);
    let on = latency_report(on_samples, 1);
    let off = latency_report(off_samples, 1);
    let p50_overhead_percent = relative_percent(on.p50_ms, off.p50_ms);
    let p95_overhead_percent = relative_percent(on.p95_ms, off.p95_ms);

    Ok((
        AmplificationReport {
            application_queries: config.app_samples,
            counted_rows: enabled_rows,
            rows_per_request: enabled_rows as f64 / config.app_samples as f64,
            disabled_counted_rows: disabled_rows,
        },
        AppLatencyReport {
            samples_each: config.app_samples,
            telemetry_on: on,
            telemetry_off: off,
            p50_overhead_percent,
            p95_overhead_percent,
        },
    ))
}

fn time_query(
    snapback: &crate::local::LocalSnapback,
    samples: &mut Vec<f64>,
) -> SnapbackResult<()> {
    let started = Instant::now();
    black_box(snapback.invoke_query("noop", crate::bench::args(json!({})))?);
    samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    Ok(())
}

fn counted_function_rows(telemetry: &Telemetry) -> SnapbackResult<u64> {
    let mut store = telemetry
        .producer
        .shared
        .store
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let connection = store.ensure_connection(wall_now_ms())?;
    let count: i64 = connection.query_row(
        "SELECT count(*) FROM telemetry_events_visible WHERE kind='function_run' AND phase IN ('point','joined','terminal')",
        [],
        |row| row.get(0),
    )?;
    Ok(count.max(0) as u64)
}

fn measure_buffer_burst(config: &Phase1BenchmarkConfig) -> SnapbackResult<BurstAndShedReport> {
    let buffer_capacity = (config.buffer_burst_events / 2).clamp(1_024, 16_384);
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
    for sequence in 0..config.buffer_burst_events {
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
    let offered = config.buffer_burst_events + reserved_capacity;
    Ok(BurstAndShedReport {
        offered_events: offered,
        retained_events: buffer.len(),
        dropped_events: buffer.drops_since_boot.values().sum(),
        reserved_events_retained: buffer.reserved.len(),
        reserved_capacity,
        enqueue_us_per_event: elapsed_us / offered as f64,
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

fn measure_flush(config: &Phase1BenchmarkConfig) -> SnapbackResult<LatencyReport> {
    let temp = BenchmarkTempDir::new("flush")?;
    let path = temp.path.join("telemetry.sqlite3");
    let mut store = Store::open_unbound(
        path,
        "01900000-0000-7000-8000-000000000001",
        TelemetryConfig {
            file_size_cap_bytes: 256 * 1024 * 1024,
            sweep_interval_ms: 24 * 60 * 60 * 1_000,
            ..TelemetryConfig::default()
        },
    )?;
    let generation = store.generation.clone();
    let mut samples = Vec::with_capacity(config.flush_batches);
    for batch in 0..config.flush_batches {
        let events = (0..config.flush_batch_size)
            .map(|offset| {
                benchmark_event(
                    &generation,
                    "function_run",
                    "flush",
                    (batch * config.flush_batch_size + offset) as u64,
                    Priority::Normal,
                    0,
                )
            })
            .collect();
        let started = Instant::now();
        store.flush(events, BTreeMap::new(), wall_now_ms(), false)?;
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    }
    Ok(latency_report(samples, config.flush_batch_size))
}

fn measure_sweep(config: &Phase1BenchmarkConfig) -> SnapbackResult<SweepReport> {
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
    for chunk_start in (0..config.sweep_rows).step_by(1_024) {
        let chunk_end = (chunk_start + 1_024).min(config.sweep_rows);
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

fn measure_queries(config: &Phase1BenchmarkConfig) -> SnapbackResult<QueryLatencyReport> {
    let telemetry = Telemetry::in_memory(
        "01900000-0000-7000-8000-000000000001",
        TelemetryConfig {
            file_size_cap_bytes: 256 * 1024 * 1024,
            ..TelemetryConfig::default()
        },
    )?;
    {
        let mut store = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let generation = store.generation.clone();
        for chunk_start in (0..config.query_rows).step_by(1_024) {
            let chunk_end = (chunk_start + 1_024).min(config.query_rows);
            let events = (chunk_start..chunk_end)
                .map(|sequence| {
                    benchmark_event(
                        &generation,
                        "function_run",
                        "query-source",
                        sequence as u64,
                        Priority::Normal,
                        0,
                    )
                })
                .collect();
            store.flush(events, BTreeMap::new(), wall_now_ms(), false)?;
        }
    }
    let event_request = crate::telemetry_query::TelemetryEventsRequestV1 {
        limit: 100,
        ..Default::default()
    };
    let stats_request = crate::telemetry_query::TelemetryStatsRequestV1::default();
    let mut event_samples = Vec::with_capacity(config.query_samples);
    let mut stats_samples = Vec::with_capacity(config.query_samples);
    for sample in 0..config.query_samples {
        if sample % 2 == 0 {
            time_events(&telemetry, &event_request, &mut event_samples)?;
            time_stats(&telemetry, &stats_request, &mut stats_samples)?;
        } else {
            time_stats(&telemetry, &stats_request, &mut stats_samples)?;
            time_events(&telemetry, &event_request, &mut event_samples)?;
        }
    }
    Ok(QueryLatencyReport {
        source_rows: config.query_rows,
        event_page: latency_report(event_samples, 100),
        stats: latency_report(stats_samples, config.query_rows),
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
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = ((sorted.len() as f64 - 1.0) * fraction).round() as usize;
    sorted[rank.min(sorted.len() - 1)]
}

fn relative_percent(value: f64, baseline: f64) -> f64 {
    if baseline <= f64::EPSILON {
        0.0
    } else {
        (value / baseline - 1.0) * 100.0
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase1_benchmark_smoke_exercises_every_gate() {
        let report = run_phase1_benchmark(&Phase1BenchmarkConfig::smoke()).unwrap();
        assert_eq!(report.amplification.rows_per_request, 1.0);
        assert!(report.burst_and_shed.dropped_events > 0);
        assert!(report.file_cap.within_cap);
        assert_eq!(report.sweep.rows_after, 0);
        assert_eq!(report.queries.event_page.samples, 3);
        assert_eq!(report.app_latency.samples_each, 8);
    }
}
