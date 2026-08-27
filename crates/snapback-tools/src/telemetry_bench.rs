//! Reproducible LLP 0154 Phase-1 capacity and latency evidence.
//!
//! Storage measurements run through a services-owned proof API so the façade
//! does not expose private buffers, SQLite connections, transactions, or
//! maintenance primitives.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest as _, Sha256};
use snapback_services::telemetry::benchmark_support::{
    BurstAndShedReport, EventArmedWorkerReport, FileCapReport, LatencyReport, QueryLatencyReport,
    StorageBenchmarkConfig, StorageBenchmarkReport, SweepReport, counted_application_rows,
    counted_kind_rows, run_storage_benchmark, wait_for_persisted_delta,
};
use snapback_services::telemetry::*;
use std::fs;
use std::hint::black_box;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
    let StorageBenchmarkReport {
        burst_and_shed,
        event_armed_worker,
        file_cap,
        flush,
        checkpoint,
        sweep,
        queries,
    } = run_storage_benchmark(StorageBenchmarkConfig {
        buffer_burst_events: config.buffer_burst_events,
        producer_flush_cycles: config.producer_flush_cycles,
        flush_batches: config.flush_batches,
        flush_batch_size: config.flush_batch_size,
        sweep_rows: config.sweep_rows,
        query_rows: config.query_rows,
        query_samples: config.query_samples,
    })?;
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
        build_commit: snapback_kernel::identity::git_commit().to_owned(),
        build_dirty: Some(snapback_kernel::identity::git_dirty()),
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
    runtime
        .block_on(
            snapback_server::benchmark_support::exercise_telemetry_query_pair(
                enabled,
                disabled,
                body,
                config.app_samples,
            ),
        )
        .map_err(|error| bench_error("SNAPBACK_TELEMETRY_BENCH_HTTP_FAILED", error.to_string()))?;
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
