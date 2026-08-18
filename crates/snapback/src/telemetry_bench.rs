//! Reproducible LLP 0154 Phase-1 capacity and latency evidence.
//!
//! This is deliberately a child of `telemetry`: the benchmark exercises the
//! same private buffer, batch, maintenance, and cap paths as production without
//! adding an author-facing telemetry mutation API.

use super::TelemetryLocalExt as _;
use super::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::hint::black_box;

/// File-backed twin of the shared finite Ibex bench fixture. Constructing it
/// here (from `crate::bench_fixture`) keeps the proof on the exact fixture the
/// main harness measures without this background-owned module reaching up
/// into the transport-owned `crate::bench` harness.
fn configured_file(
    path: impl AsRef<std::path::Path>,
) -> crate::diagnostic::SnapbackResult<crate::local::LocalSnapback> {
    let mut snapback = crate::local::LocalSnapback::open(path)?;
    snapback.apply_schema(crate::bench_fixture::schema())?;
    snapback.load_functions(crate::bench_fixture::functions());
    Ok(snapback)
}

const BENCHMARK_BASELINE_FILE: &str =
    "tests/acceptance/telemetry-phase1-benchmark-baseline.v1.json";
const BENCHMARK_METHOD: &str = "snapback.telemetry-phase1.method.v3:http-alternation+default-event-worker+buffer-burst+c8-file-cap+direct-transaction-sequenced-flush+wal-checkpoint+retention-sweep+hourly-daily-rollup-scan+file-backed-ibex-on-off-midpoint-worker";
const QUERY_NAMES_PER_BUCKET: usize = 200;

#[derive(Clone, Copy, Debug)]
pub struct Phase1BenchmarkConfig {
    pub profile: BenchmarkProofProfile,
    pub buffer_burst_events: usize,
    pub producer_flush_cycles: usize,
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
            profile: BenchmarkProofProfile::Full,
            buffer_burst_events: 16_384,
            producer_flush_cycles: 12,
            flush_batches: 24,
            flush_batch_size: 256,
            sweep_rows: 10_000,
            query_rows: 9_600,
            query_samples: 50,
            app_samples: 800,
        }
    }

    pub fn smoke() -> Self {
        Self {
            profile: BenchmarkProofProfile::Smoke,
            buffer_burst_events: 2_048,
            producer_flush_cycles: 3,
            flush_batches: 3,
            flush_batch_size: 32,
            sweep_rows: 256,
            query_rows: 800,
            query_samples: 5,
            app_samples: 512,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BenchmarkProofProfile {
    Smoke,
    Full,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Phase1BenchmarkReport {
    pub schema_version: String,
    pub method: String,
    pub environment: BenchmarkEnvironment,
    pub ceilings: BenchmarkCeilings,
    pub amplification: AmplificationReport,
    pub burst_and_shed: BurstAndShedReport,
    pub event_armed_worker: EventArmedWorkerReport,
    pub file_cap: FileCapReport,
    pub flush: LatencyReport,
    pub checkpoint: LatencyReport,
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
pub struct BenchmarkCeilings {
    pub revision: String,
    pub method_digest: String,
    pub baseline_file: String,
    pub proof_profile: BenchmarkProofProfile,
    pub required_build_profile: String,
    pub worker_flush_p95_ms: f64,
    pub direct_flush_p95_ms: f64,
    pub checkpoint_p95_ms: f64,
    pub sweep_ms: f64,
    pub event_query_p95_ms: f64,
    pub stats_query_p95_ms: f64,
    pub app_query_p95_ms: f64,
    pub app_p95_overhead_percent: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommittedBenchmarkBaseline {
    schema_version: String,
    revision: String,
    method: String,
    method_digest: String,
    profiles: CommittedBenchmarkProfiles,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommittedBenchmarkProfiles {
    smoke: CommittedBenchmarkProfile,
    full: CommittedBenchmarkProfile,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommittedBenchmarkProfile {
    required_build_profile: String,
    worker_flush_p95_ms: f64,
    direct_flush_p95_ms: f64,
    checkpoint_p95_ms: f64,
    sweep_ms: f64,
    event_query_p95_ms: f64,
    stats_query_p95_ms: f64,
    app_query_p95_ms: f64,
    app_p95_overhead_percent: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AmplificationReport {
    pub http_application_queries: usize,
    pub function_rows: u64,
    pub http_request_rows: u64,
    pub total_counted_rows: u64,
    pub rows_per_request: f64,
    pub disabled_counted_rows: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventArmedWorkerReport {
    pub default_batch_size: usize,
    pub cycles: usize,
    pub offered_events: usize,
    pub persisted_rows: u64,
    pub drops: u64,
    pub flush_wait: LatencyReport,
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
    pub hourly_rollup_rows: u64,
    pub daily_rollup_rows: u64,
    pub rollup_rows_scanned: u64,
    pub raw_rows_scanned: u64,
    pub event_page: LatencyReport,
    pub stats: LatencyReport,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLatencyReport {
    pub samples_each: usize,
    pub worker_flush_sentinel_sample: usize,
    pub worker_flushed_rows_at_sentinel: u64,
    pub worker_flushed_rows_before_final_drain: u64,
    pub telemetry_on: LatencyReport,
    pub telemetry_off: LatencyReport,
    pub p50_overhead_percent: f64,
    pub p95_overhead_percent: f64,
}

pub fn run_phase1_benchmark(
    config: &Phase1BenchmarkConfig,
) -> SnapbackResult<Phase1BenchmarkReport> {
    if config.buffer_burst_events < 1
        || config.producer_flush_cycles < 1
        || config.flush_batches < 1
        || config.flush_batch_size < 1
        || config.flush_batch_size > 1_024
        || config.sweep_rows < 1
        || config.query_rows < QUERY_NAMES_PER_BUCKET * 2
        || !config.query_rows.is_multiple_of(QUERY_NAMES_PER_BUCKET * 2)
        || config.query_samples < 1
        || config.app_samples < 1
    {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_CONFIG_INVALID",
            "every benchmark size must be positive, query rows must be divisible by 400, and a flush batch may not exceed 1024 rows",
        ));
    }

    let environment = benchmark_environment();
    let ceilings = ceilings_for(config.profile)?;
    assert_build_profile(config.profile, &environment)?;
    let amplification = measure_http_amplification(config)?;
    let burst_and_shed = measure_buffer_burst(config)?;
    let event_armed_worker = measure_event_armed_worker(config)?;
    let file_cap = measure_file_cap()?;
    let flush = measure_flush(config)?;
    let checkpoint = measure_checkpoint(config)?;
    let sweep = measure_sweep(config)?;
    let queries = measure_queries(config)?;
    let app_latency = measure_app_latency(config)?;

    if (amplification.rows_per_request - 2.0).abs() > f64::EPSILON
        || amplification.function_rows != amplification.http_application_queries as u64
        || amplification.http_request_rows != amplification.http_application_queries as u64
        || amplification.disabled_counted_rows != 0
    {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_AMPLIFICATION_FAILED",
            format!(
                "one HTTP application query must produce one function row plus one carrier row and disabled telemetry must produce none; got {} rows/request and {} disabled rows",
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
    if event_armed_worker.persisted_rows != event_armed_worker.offered_events as u64
        || event_armed_worker.drops != 0
    {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_EVENT_WORKER_FAILED",
            "the default event-armed worker did not persist every offered row without shedding",
        ));
    }
    if queries.hourly_rollup_rows + queries.daily_rollup_rows != config.query_rows as u64
        || queries.rollup_rows_scanned < config.query_rows as u64
    {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_QUERY_CARDINALITY_FAILED",
            "the stats workload did not retain and scan the requested high-cardinality hourly/daily rollup rows",
        ));
    }
    if app_latency.worker_flushed_rows_at_sentinel < DEFAULT_BATCH_SIZE as u64 {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_APP_WORKER_BYPASSED",
            "the telemetry-on application workload did not persist one default batch before its inside-window sentinel",
        ));
    }
    assert_latency_ceilings(
        &ceilings,
        &event_armed_worker,
        &flush,
        &checkpoint,
        &sweep,
        &queries,
        &app_latency,
    )?;

    Ok(Phase1BenchmarkReport {
        schema_version: "snapback.telemetry-phase1-benchmark.v2".to_owned(),
        method: BENCHMARK_METHOD.to_owned(),
        environment,
        ceilings,
        amplification,
        burst_and_shed,
        event_armed_worker,
        file_cap,
        flush,
        checkpoint,
        sweep,
        queries,
        app_latency,
    })
}

fn benchmark_environment() -> BenchmarkEnvironment {
    BenchmarkEnvironment {
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
    }
}

fn ceilings_for(profile: BenchmarkProofProfile) -> SnapbackResult<BenchmarkCeilings> {
    let baseline: CommittedBenchmarkBaseline = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/acceptance/telemetry-phase1-benchmark-baseline.v1.json"
    )))
    .map_err(|error| {
        bench_error(
            "SNAPBACK_TELEMETRY_BENCH_BASELINE_INVALID",
            error.to_string(),
        )
    })?;
    let computed_method_digest =
        format!("sha256:{:x}", Sha256::digest(BENCHMARK_METHOD.as_bytes()));
    if baseline.schema_version != "snapback.telemetry-phase1-benchmark-baseline.v1"
        || baseline.method != BENCHMARK_METHOD
        || baseline.method_digest != computed_method_digest
    {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_BASELINE_INVALID",
            "the committed baseline schema, method, and method digest must agree with the benchmark implementation",
        ));
    }
    let configured = match profile {
        BenchmarkProofProfile::Smoke => baseline.profiles.smoke,
        BenchmarkProofProfile::Full => baseline.profiles.full,
    };
    Ok(BenchmarkCeilings {
        revision: baseline.revision,
        method_digest: baseline.method_digest,
        baseline_file: BENCHMARK_BASELINE_FILE.to_owned(),
        proof_profile: profile,
        required_build_profile: configured.required_build_profile,
        worker_flush_p95_ms: configured.worker_flush_p95_ms,
        direct_flush_p95_ms: configured.direct_flush_p95_ms,
        checkpoint_p95_ms: configured.checkpoint_p95_ms,
        sweep_ms: configured.sweep_ms,
        event_query_p95_ms: configured.event_query_p95_ms,
        stats_query_p95_ms: configured.stats_query_p95_ms,
        app_query_p95_ms: configured.app_query_p95_ms,
        app_p95_overhead_percent: configured.app_p95_overhead_percent,
    })
}

fn assert_build_profile(
    profile: BenchmarkProofProfile,
    environment: &BenchmarkEnvironment,
) -> SnapbackResult<()> {
    let required = match profile {
        BenchmarkProofProfile::Smoke => "debug",
        BenchmarkProofProfile::Full => "release",
    };
    if environment.profile != required {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_BUILD_PROFILE_INVALID",
            format!("{profile:?} evidence requires a {required} build"),
        ));
    }
    if profile == BenchmarkProofProfile::Full
        && (environment.build_commit == "unknown" || environment.build_dirty != Some(false))
    {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_BUILD_IDENTITY_INVALID",
            "full evidence requires a revision-stamped clean release build",
        ));
    }
    Ok(())
}

fn measure_http_amplification(
    config: &Phase1BenchmarkConfig,
) -> SnapbackResult<AmplificationReport> {
    use axum::body::{Body, to_bytes};
    use axum::http::Request;
    use tower::ServiceExt;

    let enabled_temp = BenchmarkTempDir::new("http-on")?;
    let disabled_temp = BenchmarkTempDir::new("http-off")?;
    let enabled = configured_file(enabled_temp.path.join("app.sqlite3"))?;
    let mut disabled = configured_file(disabled_temp.path.join("app.sqlite3"))?;
    disabled.set_telemetry_config(TelemetryConfig {
        max_days: 0,
        ..TelemetryConfig::default()
    })?;
    let enabled_telemetry = enabled.telemetry();
    let disabled_telemetry = disabled.telemetry();
    enabled_telemetry.force_flush()?;
    disabled_telemetry.force_flush()?;
    let function_before = counted_kind_rows(&enabled_telemetry, "function_run")?;
    let http_before = counted_kind_rows(&enabled_telemetry, "http_request")?;
    let disabled_before = counted_application_rows(&disabled_telemetry)?;
    let enabled_router = crate::server::router(enabled);
    let disabled_router = crate::server::router(disabled);
    let body = serde_json::to_vec(&crate::manifest::FunctionCallRequest {
        input: crate::bench_fixture::args(json!({})),
        stream_connection_id: None,
        expected_generation: None,
    })
    .map_err(|error| bench_error("SNAPBACK_TELEMETRY_BENCH_HTTP_FAILED", error.to_string()))?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| {
            bench_error("SNAPBACK_TELEMETRY_BENCH_RUNTIME_FAILED", error.to_string())
        })?;
    runtime.block_on(async {
        for index in 0..config.app_samples {
            let request = || {
                Request::builder()
                    .method("POST")
                    .uri("/query/noop")
                    .header("content-type", "application/json")
                    .body(Body::from(body.clone()))
                    .expect("benchmark request")
            };
            let responses = if index % 2 == 0 {
                [
                    enabled_router.clone().oneshot(request()).await,
                    disabled_router.clone().oneshot(request()).await,
                ]
            } else {
                [
                    disabled_router.clone().oneshot(request()).await,
                    enabled_router.clone().oneshot(request()).await,
                ]
            };
            for response in responses {
                let response = response.map_err(|error| {
                    bench_error("SNAPBACK_TELEMETRY_BENCH_HTTP_FAILED", error.to_string())
                })?;
                if !response.status().is_success() {
                    return Err(bench_error(
                        "SNAPBACK_TELEMETRY_BENCH_HTTP_FAILED",
                        format!("benchmark query returned {}", response.status()),
                    ));
                }
                black_box(
                    to_bytes(response.into_body(), usize::MAX)
                        .await
                        .map_err(|error| {
                            bench_error("SNAPBACK_TELEMETRY_BENCH_HTTP_FAILED", error.to_string())
                        })?,
                );
            }
        }
        Ok::<(), SnapbackError>(())
    })?;
    enabled_telemetry.force_flush()?;
    disabled_telemetry.force_flush()?;
    let function_rows =
        counted_kind_rows(&enabled_telemetry, "function_run")?.saturating_sub(function_before);
    let http_request_rows =
        counted_kind_rows(&enabled_telemetry, "http_request")?.saturating_sub(http_before);
    let disabled_counted_rows =
        counted_application_rows(&disabled_telemetry)?.saturating_sub(disabled_before);
    let total_counted_rows = function_rows.saturating_add(http_request_rows);
    Ok(AmplificationReport {
        http_application_queries: config.app_samples,
        function_rows,
        http_request_rows,
        total_counted_rows,
        rows_per_request: total_counted_rows as f64 / config.app_samples as f64,
        disabled_counted_rows,
    })
}

fn measure_app_latency(config: &Phase1BenchmarkConfig) -> SnapbackResult<AppLatencyReport> {
    let enabled_temp = BenchmarkTempDir::new("app-on")?;
    let disabled_temp = BenchmarkTempDir::new("app-off")?;
    let enabled = configured_file(enabled_temp.path.join("app.sqlite3"))?;
    let mut disabled = configured_file(disabled_temp.path.join("app.sqlite3"))?;
    disabled.set_telemetry_config(TelemetryConfig {
        max_days: 0,
        ..TelemetryConfig::default()
    })?;
    for _ in 0..8 {
        enabled.invoke_query("noop", crate::bench_fixture::args(json!({})))?;
        disabled.invoke_query("noop", crate::bench_fixture::args(json!({})))?;
    }
    let enabled_telemetry = enabled.telemetry();
    let disabled_telemetry = disabled.telemetry();
    enabled_telemetry.force_flush()?;
    disabled_telemetry.force_flush()?;
    let enabled_before = counted_kind_rows(&enabled_telemetry, "function_run")?;
    let disabled_before = counted_kind_rows(&disabled_telemetry, "function_run")?;
    let mut on_samples = Vec::with_capacity(config.app_samples);
    let mut off_samples = Vec::with_capacity(config.app_samples);
    let worker_flush_sentinel_sample = config.app_samples * 3 / 4;
    let mut worker_flushed_rows_at_sentinel = 0;
    for index in 0..config.app_samples {
        if index % 2 == 0 {
            time_query(&enabled, &mut on_samples)?;
            time_query(&disabled, &mut off_samples)?;
        } else {
            time_query(&disabled, &mut off_samples)?;
            time_query(&enabled, &mut on_samples)?;
        }
        if index + 1 == worker_flush_sentinel_sample {
            worker_flushed_rows_at_sentinel =
                counted_kind_rows(&enabled_telemetry, "function_run")?
                    .saturating_sub(enabled_before);
        }
    }
    let worker_flushed_rows_before_final_drain = wait_for_persisted_delta(
        &enabled_telemetry,
        "function_run",
        enabled_before,
        DEFAULT_BATCH_SIZE as u64,
        Duration::from_secs(10),
    )?;
    enabled_telemetry.force_flush()?;
    disabled_telemetry.force_flush()?;
    let enabled_rows =
        counted_kind_rows(&enabled_telemetry, "function_run")?.saturating_sub(enabled_before);
    let disabled_rows =
        counted_kind_rows(&disabled_telemetry, "function_run")?.saturating_sub(disabled_before);
    if enabled_rows != config.app_samples as u64 || disabled_rows != 0 {
        return Err(bench_error(
            "SNAPBACK_TELEMETRY_BENCH_APP_ACCOUNTING_FAILED",
            format!(
                "expected {} enabled rows and zero disabled rows; got {enabled_rows} and {disabled_rows}",
                config.app_samples
            ),
        ));
    }
    let on = latency_report(on_samples, 1);
    let off = latency_report(off_samples, 1);
    Ok(AppLatencyReport {
        samples_each: config.app_samples,
        worker_flush_sentinel_sample,
        worker_flushed_rows_at_sentinel,
        worker_flushed_rows_before_final_drain,
        p50_overhead_percent: relative_percent(on.p50_ms, off.p50_ms),
        p95_overhead_percent: relative_percent(on.p95_ms, off.p95_ms),
        telemetry_on: on,
        telemetry_off: off,
    })
}

fn time_query(
    snapback: &crate::local::LocalSnapback,
    samples: &mut Vec<f64>,
) -> SnapbackResult<()> {
    let started = Instant::now();
    black_box(snapback.invoke_query("noop", crate::bench_fixture::args(json!({})))?);
    samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    Ok(())
}

fn counted_kind_rows(telemetry: &Telemetry, kind: &str) -> SnapbackResult<u64> {
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

fn counted_application_rows(telemetry: &Telemetry) -> SnapbackResult<u64> {
    Ok(counted_kind_rows(telemetry, "function_run")?
        .saturating_add(counted_kind_rows(telemetry, "http_request")?))
}

fn wait_for_persisted_delta(
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

fn measure_event_armed_worker(
    config: &Phase1BenchmarkConfig,
) -> SnapbackResult<EventArmedWorkerReport> {
    let temp = BenchmarkTempDir::new("event-worker")?;
    let telemetry = Telemetry::open_for_database(
        &temp.path.join("app.sqlite3"),
        "01900000-0000-7000-8000-000000000001",
        TelemetryConfig::default(),
    )?;
    let mut samples = Vec::with_capacity(config.producer_flush_cycles);
    for cycle in 0..config.producer_flush_cycles {
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
        cycles: config.producer_flush_cycles,
        offered_events: config.producer_flush_cycles * DEFAULT_BATCH_SIZE,
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

fn measure_checkpoint(config: &Phase1BenchmarkConfig) -> SnapbackResult<LatencyReport> {
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
    let mut samples = Vec::with_capacity(config.flush_batches);
    for batch in 0..config.flush_batches {
        let events = (0..config.flush_batch_size)
            .map(|offset| {
                benchmark_event(
                    &generation,
                    "function_run",
                    "checkpoint",
                    (batch * config.flush_batch_size + offset) as u64,
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
    let now = wall_now_ms();
    let half = config.query_rows / 2;
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

#[allow(clippy::too_many_arguments)]
fn assert_latency_ceilings(
    ceilings: &BenchmarkCeilings,
    worker: &EventArmedWorkerReport,
    flush: &LatencyReport,
    checkpoint: &LatencyReport,
    sweep: &SweepReport,
    queries: &QueryLatencyReport,
    app: &AppLatencyReport,
) -> SnapbackResult<()> {
    for (metric, observed, ceiling) in [
        (
            "eventArmedWorker.flushWait.p95Ms",
            worker.flush_wait.p95_ms,
            ceilings.worker_flush_p95_ms,
        ),
        ("flush.p95Ms", flush.p95_ms, ceilings.direct_flush_p95_ms),
        (
            "checkpoint.p95Ms",
            checkpoint.p95_ms,
            ceilings.checkpoint_p95_ms,
        ),
        ("sweep.latencyMs", sweep.latency_ms, ceilings.sweep_ms),
        (
            "queries.eventPage.p95Ms",
            queries.event_page.p95_ms,
            ceilings.event_query_p95_ms,
        ),
        (
            "queries.stats.p95Ms",
            queries.stats.p95_ms,
            ceilings.stats_query_p95_ms,
        ),
        (
            "appLatency.telemetryOn.p95Ms",
            app.telemetry_on.p95_ms,
            ceilings.app_query_p95_ms,
        ),
        (
            "appLatency.p95OverheadPercent",
            app.p95_overhead_percent,
            ceilings.app_p95_overhead_percent,
        ),
    ] {
        if !observed.is_finite() || observed > ceiling {
            return Err(bench_error(
                "SNAPBACK_TELEMETRY_BENCH_LATENCY_CEILING_FAILED",
                format!(
                    "{metric} observed {observed:.3} exceeded {ceiling:.3} under ceiling revision {} ({:?})",
                    ceilings.revision, ceilings.proof_profile
                ),
            ));
        }
    }
    Ok(())
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
        assert_eq!(report.ceilings.proof_profile, BenchmarkProofProfile::Smoke);
        assert_eq!(report.amplification.rows_per_request, 2.0);
        assert_eq!(report.event_armed_worker.cycles, 3);
        assert!(report.burst_and_shed.dropped_events > 0);
        assert!(report.file_cap.within_cap);
        assert_eq!(report.sweep.rows_after, 0);
        assert_eq!(report.queries.rollup_rows_scanned, 800);
        assert_eq!(report.queries.event_page.samples, 5);
        assert_eq!(report.app_latency.samples_each, 512);
        assert!(report.app_latency.worker_flushed_rows_at_sentinel >= DEFAULT_BATCH_SIZE as u64);
    }
}
