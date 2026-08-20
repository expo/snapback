//! Dated absolute-latency instrument for LLP 0164's novel operations.
//!
//! Build in release mode, wait for build quiescence, then invoke the binary
//! directly with the output path, accepted baseline path, and exact expected
//! revision. The record is evidence for ratifying bounds; it is not itself a
//! capability claim.
//!
//! @ref LLP 0162#measurement-gate — fork creation, exact diff, promotion, and
//!   reap have no pre-profile comparator and require dated absolute evidence.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Barrier, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, bail};
use serde::Serialize;
use sha2::{Digest, Sha256};
use snapback_engine::bench_support::{
    AgentSafeActiveContentionWriter, prepare_agent_safe_active_contention_database,
};
use snapback_kernel::fork_promotion_bench::{
    ForkPromotionBenchmarkRun as Run, run_fork_promotion_benchmark_once,
};

const RECORDED_RUNS: usize = 11;
const LOCAL_WARMUPS: usize = 4;
const ROWS: usize = 512;
const CONTENTION_SAMPLES: usize = 128;
const CONTENTION_WORKERS: usize = 8;
const ACCEPTED_BASELINE_SHA256: &str =
    "d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91";
const FORK_CREATION_MEDIAN_BOUND_US: f64 = 1_000.0;
const EXACT_DIFF_MEDIAN_BOUND_US: f64 = 2_500.0;
const PROMOTION_MEDIAN_BOUND_US: f64 = 7_500.0;
const TTL_REAP_MEDIAN_BOUND_US: f64 = 250.0;
const ORDINARY_WRITER_CONTENTION_P99_BOUND_US: f64 = 1_250_000.0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Artifact {
    schema_version: &'static str,
    artifact_name: &'static str,
    date: &'static str,
    source_revision: String,
    source_tree_clean: bool,
    executable_sha256: String,
    baseline_artifact: BaselineBinding,
    toolchain: Toolchain,
    hardware_class: Hardware,
    fixture: Fixture,
    protocol: Protocol,
    raw_runs: Vec<Run>,
    summary_us: BTreeMap<&'static str, Statistics>,
    contention: ContentionEvidence,
    absolute_bounds: AbsoluteBounds,
    absolute_bounds_passed: bool,
    bound_ratification: &'static str,
    promotion_egress_scope: &'static str,
    claim_boundary: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AbsoluteBounds {
    fork_creation_median_us: f64,
    exact_diff_median_us: f64,
    promotion_median_us: f64,
    ttl_reap_median_us: f64,
    ordinary_writer_contention_p99_us: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BaselineBinding {
    artifact_name: String,
    schema_version: String,
    sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Toolchain {
    rustc: String,
    cargo: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Hardware {
    os: String,
    architecture: &'static str,
    model: String,
    cpu: String,
    logical_cpus: usize,
    memory_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    logical_rows: usize,
    changed_rows: usize,
    operations_per_promotion: usize,
    whole_run_warmups: usize,
    per_metric_warmups: usize,
    recorded_runs: usize,
    contention_samples: usize,
    contention_workers: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Protocol {
    estimator: &'static str,
    spread: &'static str,
    build_profile: &'static str,
    quiescence_rule: &'static str,
    measurement_scope: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentionEvidence {
    metric: &'static str,
    sample_definition: &'static str,
    reservation_interval_ms: u64,
    maximum_promotion_commit_duration_ms: u64,
    raw_request_to_commit_us: Vec<f64>,
    deferred_sample_count: usize,
    initial_deferred_worker_count: usize,
    p50_us: f64,
    p95_us: f64,
    p99_us: f64,
    max_us: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Statistics {
    median: f64,
    mad: f64,
    min: f64,
    max: f64,
}

fn main() -> anyhow::Result<()> {
    if cfg!(debug_assertions) {
        bail!("benchmark must be built with --release");
    }
    let mut arguments = std::env::args_os().skip(1);
    let output = arguments.next().map(PathBuf::from).context(
        "usage: snapback-fork-promotion-bench OUTPUT.json BASELINE.json EXPECTED_REVISION",
    )?;
    let baseline_path = arguments.next().map(PathBuf::from).context(
        "usage: snapback-fork-promotion-bench OUTPUT.json BASELINE.json EXPECTED_REVISION",
    )?;
    let expected_revision = arguments
        .next()
        .and_then(|value| value.into_string().ok())
        .context(
            "usage: snapback-fork-promotion-bench OUTPUT.json BASELINE.json EXPECTED_REVISION",
        )?;
    if arguments.next().is_some() {
        bail!("usage: snapback-fork-promotion-bench OUTPUT.json BASELINE.json EXPECTED_REVISION");
    }
    ensure_machine_quiescent()?;
    let source_revision = validate_candidate_source(&expected_revision)?;
    let baseline_bytes = std::fs::read(&baseline_path)
        .with_context(|| format!("read baseline artifact {}", baseline_path.display()))?;
    let baseline_sha256 = validate_baseline_digest(&baseline_bytes)?;
    let baseline: serde_json::Value =
        serde_json::from_slice(&baseline_bytes).context("decode baseline artifact")?;
    let baseline_artifact_name = baseline["artifactName"]
        .as_str()
        .context("baseline artifactName is missing")?;
    let baseline_schema_version = baseline["schemaVersion"]
        .as_str()
        .context("baseline schemaVersion is missing")?;
    if baseline_artifact_name != "agent-safe-step0-pre-profile-2026-08-03"
        || baseline_schema_version != "snapback.agent-safe-step0-baseline.v1"
    {
        bail!("benchmark requires the accepted LLP 0162 step-0 baseline artifact");
    }
    let hardware = Hardware {
        os: checked_command(&["sw_vers", "-productVersion"])?,
        architecture: std::env::consts::ARCH,
        model: sysctl("hw.model")?,
        cpu: sysctl("machdep.cpu.brand_string")?,
        logical_cpus: std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(0),
        memory_bytes: sysctl("hw.memsize")?.parse().unwrap_or(0),
    };
    if hardware.architecture != "aarch64"
        || hardware.model != "Mac17,3"
        || hardware.cpu != "Apple M5"
        || hardware.logical_cpus != 10
        || hardware.memory_bytes != 34_359_738_368
    {
        bail!(
            "benchmark hardware does not match the accepted Mac17,3 / Apple M5 / 10 CPU / 32 GiB baseline class"
        );
    }
    if baseline["hardwareClass"]["os"].as_str() != Some(hardware.os.as_str())
        || baseline["hardwareClass"]["architecture"].as_str() != Some(hardware.architecture)
        || baseline["hardwareClass"]["model"].as_str() != Some(hardware.model.as_str())
        || baseline["hardwareClass"]["cpu"].as_str() != Some(hardware.cpu.as_str())
        || baseline["hardwareClass"]["logicalCpus"].as_u64() != Some(hardware.logical_cpus as u64)
        || baseline["hardwareClass"]["memoryBytes"].as_u64() != Some(hardware.memory_bytes)
    {
        bail!("step-0 baseline hardware binding diverges from the measurement host");
    }
    let toolchain = Toolchain {
        rustc: checked_command(&["rustc", "--version"])?,
        cargo: checked_command(&["cargo", "--version"])?,
    };
    if baseline["source"]["rustcVersion"].as_str() != Some(toolchain.rustc.as_str())
        || baseline["source"]["cargoVersion"].as_str() != Some(toolchain.cargo.as_str())
    {
        bail!("step-0 baseline toolchain binding diverges from the measurement host");
    }

    run_once(0)?;
    for index in 0..LOCAL_WARMUPS {
        run_once(10_000 + index as u64)?;
    }
    let mut raw_runs = Vec::with_capacity(RECORDED_RUNS);
    for index in 0..RECORDED_RUNS {
        raw_runs.push(run_once(20_000 + index as u64)?);
    }
    let contention = measure_writer_contention()?;
    let summary_us = summarize(&raw_runs);
    let absolute_bounds = AbsoluteBounds {
        fork_creation_median_us: FORK_CREATION_MEDIAN_BOUND_US,
        exact_diff_median_us: EXACT_DIFF_MEDIAN_BOUND_US,
        promotion_median_us: PROMOTION_MEDIAN_BOUND_US,
        ttl_reap_median_us: TTL_REAP_MEDIAN_BOUND_US,
        ordinary_writer_contention_p99_us: ORDINARY_WRITER_CONTENTION_P99_BOUND_US,
    };
    let absolute_bounds_passed = summary_us["forkCreation"].median
        <= absolute_bounds.fork_creation_median_us
        && summary_us["exactDiff"].median <= absolute_bounds.exact_diff_median_us
        && summary_us["promotion"].median <= absolute_bounds.promotion_median_us
        && summary_us["ttlReap"].median <= absolute_bounds.ttl_reap_median_us
        && contention.p99_us <= absolute_bounds.ordinary_writer_contention_p99_us;
    anyhow::ensure!(
        absolute_bounds_passed,
        "final fork/promotion measurements exceeded the author-ratified LLP 0162 absolute bounds"
    );
    let artifact = Artifact {
        schema_version: "snapback.fork-promotion-performance.v3",
        artifact_name: "agent-safe-fork-promotion-absolute-2026-08-04",
        date: "2026-08-04",
        source_revision,
        source_tree_clean: true,
        executable_sha256: digest_file(&std::env::current_exe()?)?,
        baseline_artifact: BaselineBinding {
            artifact_name: baseline_artifact_name.to_owned(),
            schema_version: baseline_schema_version.to_owned(),
            sha256: format!("sha256:{baseline_sha256}"),
        },
        toolchain,
        hardware_class: hardware,
        fixture: Fixture {
            logical_rows: ROWS,
            changed_rows: 1,
            operations_per_promotion: 1,
            whole_run_warmups: 1,
            per_metric_warmups: LOCAL_WARMUPS,
            recorded_runs: RECORDED_RUNS,
            contention_samples: CONTENTION_SAMPLES,
            contention_workers: CONTENTION_WORKERS,
        },
        protocol: Protocol {
            estimator: "median of 11 fresh-fixture runs",
            spread: "median absolute deviation (MAD), with min/max and raw runs retained",
            build_profile: "release",
            quiescence_rule: "direct binary invocation refuses while another cargo or rustc process exists",
            measurement_scope: "absolute latency only; no honest pre-profile product comparator exists",
        },
        summary_us,
        raw_runs,
        contention,
        absolute_bounds,
        absolute_bounds_passed,
        bound_ratification: "Ratified by Charlie Cheever in LLP 0162's dated 2026-08-04 v0.13 absolute-bound record before this final run",
        promotion_egress_scope: "DenyAll/no-effects only; CaptureOnly intent publication and settlement are not measured",
        claim_boundary: "instrumentation evidence only; this record alone does not qualify row 13 or advertise fork, promotion, CaptureOnly, or aggregate capabilities",
    };
    let mut output_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output)
        .with_context(|| format!("create new dated artifact {}", output.display()))?;
    writeln!(output_file, "{}", serde_json::to_string_pretty(&artifact)?)?;
    output_file.sync_all()?;
    println!("wrote {}", output.display());
    Ok(())
}

fn validate_candidate_source(expected_revision: &str) -> anyhow::Result<String> {
    let checkout_revision = checked_command(&["git", "rev-parse", "HEAD"])?;
    let dirty = checked_command(&["git", "status", "--porcelain", "--untracked-files=all"])?;
    validate_candidate_binding(
        expected_revision,
        &checkout_revision,
        &dirty,
        option_env!("SNAPBACK_BUILD_GIT_COMMIT"),
        option_env!("SNAPBACK_BUILD_GIT_DIRTY"),
    )?;
    Ok(checkout_revision)
}

fn validate_candidate_binding(
    expected_revision: &str,
    checkout_revision: &str,
    dirty: &str,
    compiled_revision: Option<&str>,
    compiled_dirty: Option<&str>,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        checkout_revision == expected_revision,
        "benchmark revision mismatch: expected {expected_revision}, checked out {checkout_revision}"
    );
    anyhow::ensure!(
        dirty.is_empty(),
        "benchmark requires a clean source tree; found:\n{dirty}"
    );
    anyhow::ensure!(
        compiled_revision == Some(expected_revision),
        "release executable was not built from EXPECTED_REVISION"
    );
    anyhow::ensure!(
        compiled_dirty == Some("false"),
        "release executable was not built from a clean source tree"
    );
    Ok(())
}

fn validate_baseline_digest(bytes: &[u8]) -> anyhow::Result<String> {
    let digest = format!("{:x}", Sha256::digest(bytes));
    anyhow::ensure!(
        digest == ACCEPTED_BASELINE_SHA256,
        "baseline artifact bytes do not match the accepted LLP 0162 digest"
    );
    Ok(digest)
}

fn digest_file(path: &std::path::Path) -> anyhow::Result<String> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("read executable for digest {}", path.display()))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn run_once(seed: u64) -> anyhow::Result<Run> {
    run_fork_promotion_benchmark_once(seed)
}

/// Measure the ordinary-writer tail introduced by the frozen promotion head
/// reservation. Eight file-backed active carriers begin behind one production
/// reservation and commit 128 issuance-bearing ordinary mutations through the
/// envelope choke point. The nearest-rank p99 retains every request-to-COMMIT
/// sample, including the intentional reservation wait.
///
/// @ref LLP 0162#5-promotion-stays-strict-and-merge-free — the bounded
///   reservation requires a p99 under-contention latency record.
fn measure_writer_contention() -> anyhow::Result<ContentionEvidence> {
    let directory = tempfile::tempdir().context("create contention fixture directory")?;
    let database_path = directory.path().join("contention.sqlite");
    let database = prepare_agent_safe_active_contention_database(&database_path)
        .context("prepare active ordinary-mutation contention database")?;
    let canonical_stream_id = database.canonical_stream_id().to_owned();
    let issued_at_ms = unix_millis()?;
    let reservation = database.prepare_reservation(CONTENTION_WORKERS, issued_at_ms)?;
    let start = Arc::new(Barrier::new(CONTENTION_WORKERS + 1));
    let abort = Arc::new(AtomicBool::new(false));
    let setup_gate = Arc::new(Mutex::new(()));
    let (ready_tx, ready_rx) = mpsc::channel();
    let per_worker = CONTENTION_SAMPLES / CONTENTION_WORKERS;
    let mut workers = Vec::with_capacity(CONTENTION_WORKERS);
    for worker in 0..CONTENTION_WORKERS {
        let database = database.clone();
        let canonical_stream_id = canonical_stream_id.clone();
        let start = start.clone();
        let abort = abort.clone();
        let setup_gate = setup_gate.clone();
        let ready_tx = ready_tx.clone();
        workers.push(thread::spawn(
            move || -> anyhow::Result<(bool, Vec<(f64, bool)>)> {
                let carrier = {
                    let _setup = setup_gate
                        .lock()
                        .map_err(|_| anyhow::anyhow!("contention writer setup lock poisoned"))?;
                    AgentSafeActiveContentionWriter::open(database, worker, &canonical_stream_id)
                };
                ready_tx
                    .send(carrier.as_ref().map(|_| ()).map_err(ToString::to_string))
                    .context("report contention writer readiness")?;
                start.wait();
                let mut carrier = carrier?;
                if abort.load(Ordering::Acquire) {
                    bail!("contention writer setup aborted before measurement");
                }
                let mut samples = Vec::with_capacity(per_worker);
                for ordinal in 0..per_worker {
                    let sample_started = Instant::now();
                    let mut was_deferred = false;
                    loop {
                        match carrier.commit_next(worker, ordinal) {
                            Ok(()) => break,
                            Err(error)
                                if error.diagnostic.code == "SNAPBACK_PROMOTION_HEAD_RESERVED" =>
                            {
                                was_deferred = true;
                                let until_ms = error.diagnostic.details["untilMs"]
                                    .as_i64()
                                    .context("reservation refusal omitted untilMs")?;
                                let remaining =
                                    until_ms.saturating_sub(unix_millis()?).max(1) as u64;
                                thread::sleep(Duration::from_millis(remaining));
                            }
                            Err(error) => return Err(error.into()),
                        }
                    }
                    samples.push((micros(sample_started), was_deferred));
                }
                let initial_deferred = samples.first().is_some_and(|(_, deferred)| *deferred);
                Ok((initial_deferred, samples))
            },
        ));
    }
    drop(ready_tx);
    let setup_errors = (0..CONTENTION_WORKERS)
        .map(|_| {
            ready_rx
                .recv()
                .context("receive contention writer readiness")
        })
        .collect::<anyhow::Result<Vec<_>>>()?
        .into_iter()
        .filter_map(Result::err)
        .collect::<Vec<_>>();
    if !setup_errors.is_empty() {
        abort.store(true, Ordering::Release);
        start.wait();
        for worker in workers {
            let _ = worker.join();
        }
        bail!("contention writers failed setup: {setup_errors:?}");
    }
    let reservation_policy = database.activate_reservation(reservation, unix_millis()?)?;
    start.wait();

    let mut samples = Vec::with_capacity(CONTENTION_SAMPLES);
    let mut deferred_sample_count = 0;
    let mut initial_deferred_worker_count = 0;
    for worker in workers {
        let (initial_deferred, worker_samples) = worker
            .join()
            .map_err(|_| anyhow::anyhow!("contention writer thread panicked"))??;
        initial_deferred_worker_count += usize::from(initial_deferred);
        for (sample, deferred) in worker_samples {
            samples.push(sample);
            deferred_sample_count += usize::from(deferred);
        }
    }
    anyhow::ensure!(
        samples.len() == CONTENTION_SAMPLES && initial_deferred_worker_count == CONTENTION_WORKERS,
        "contention fixture did not place every initial writer behind the reservation"
    );
    let committed_rows = database.committed_rows()?;
    anyhow::ensure!(
        committed_rows == CONTENTION_SAMPLES,
        "active contention carrier committed {committed_rows} rows, expected {CONTENTION_SAMPLES}"
    );
    let mut sorted = samples.clone();
    sorted.sort_by(f64::total_cmp);
    Ok(ContentionEvidence {
        metric: "ordinaryWriterReservationRequestToCommitP99Us",
        sample_definition: "128 active issuance-bearing ordinary mutations across 8 file-backed carriers; timer begins before the real staged mutation carrier and ends only after its envelope-bearing storage transaction commits; a reservation refusal retries the same server-issued operation identity; each worker's first sample is observed deferred by one active production promotion reservation",
        reservation_interval_ms: reservation_policy.reservation_interval_ms,
        maximum_promotion_commit_duration_ms: reservation_policy
            .maximum_promotion_commit_duration_ms,
        p50_us: percentile(&sorted, 0.50),
        p95_us: percentile(&sorted, 0.95),
        p99_us: percentile(&sorted, 0.99),
        max_us: *sorted.last().unwrap_or(&0.0),
        raw_request_to_commit_us: samples,
        deferred_sample_count,
        initial_deferred_worker_count,
    })
}

fn unix_millis() -> anyhow::Result<i64> {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock predates Unix epoch")?
            .as_millis(),
    )
    .context("system clock milliseconds exceed i64")
}

fn percentile(sorted: &[f64], quantile: f64) -> f64 {
    let rank = (quantile * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len().saturating_sub(1))]
}

fn summarize(runs: &[Run]) -> BTreeMap<&'static str, Statistics> {
    let mut metrics = BTreeMap::new();
    for (name, values) in [
        (
            "forkCreation",
            runs.iter().map(|run| run.fork_creation_us).collect(),
        ),
        (
            "exactDiff",
            runs.iter().map(|run| run.exact_diff_us).collect(),
        ),
        (
            "promotion",
            runs.iter().map(|run| run.promotion_us).collect(),
        ),
        ("ttlReap", runs.iter().map(|run| run.ttl_reap_us).collect()),
    ] {
        metrics.insert(name, statistics(values));
    }
    metrics
}

fn statistics(mut values: Vec<f64>) -> Statistics {
    values.sort_by(f64::total_cmp);
    let median = values[values.len() / 2];
    let mut deviations = values
        .iter()
        .map(|value| (value - median).abs())
        .collect::<Vec<_>>();
    deviations.sort_by(f64::total_cmp);
    Statistics {
        median,
        mad: deviations[deviations.len() / 2],
        min: values[0],
        max: values[values.len() - 1],
    }
}

fn micros(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1_000_000.0
}

fn ensure_machine_quiescent() -> anyhow::Result<()> {
    let output = checked_command(&["ps", "-axo", "comm="])?;
    let offenders = output
        .lines()
        .filter(|line| {
            let name = line.rsplit('/').next().unwrap_or(line).trim();
            name == "cargo" || name == "rustc"
        })
        .collect::<Vec<_>>();
    if !offenders.is_empty() {
        bail!("refusing contaminated benchmark: active build processes {offenders:?}");
    }
    Ok(())
}

fn checked_command(arguments: &[&str]) -> anyhow::Result<String> {
    let output = Command::new(arguments[0])
        .args(&arguments[1..])
        .output()
        .with_context(|| format!("run measurement prerequisite {arguments:?}"))?;
    if !output.status.success() {
        bail!(
            "measurement prerequisite {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn sysctl(name: &str) -> anyhow::Result<String> {
    checked_command(&["sysctl", "-n", name])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contention_recorder_observes_real_reservation_and_retains_p99_population() {
        let evidence = measure_writer_contention().expect("contention evidence");
        assert_eq!(evidence.raw_request_to_commit_us.len(), CONTENTION_SAMPLES);
        assert_eq!(evidence.initial_deferred_worker_count, CONTENTION_WORKERS);
        assert_eq!(evidence.deferred_sample_count, CONTENTION_WORKERS);
        assert_eq!(evidence.reservation_interval_ms, 1_000);
        assert_eq!(evidence.maximum_promotion_commit_duration_ms, 500);
        assert!(evidence.p99_us >= evidence.p95_us);
        assert!(evidence.max_us >= evidence.p99_us);
    }

    #[test]
    fn absolute_recorder_rejects_stale_or_dirty_compiled_identity() {
        let revision = "a".repeat(40);
        validate_candidate_binding(&revision, &revision, "", Some(&revision), Some("false"))
            .expect("exact clean binding");
        assert!(
            validate_candidate_binding(
                &revision,
                &revision,
                "",
                Some(&"b".repeat(40)),
                Some("false"),
            )
            .is_err()
        );
        assert!(
            validate_candidate_binding(&revision, &revision, "", Some(&revision), Some("true"))
                .is_err()
        );
        assert!(
            validate_candidate_binding(
                &revision,
                &revision,
                " M src/storage.rs",
                Some(&revision),
                Some("false"),
            )
            .is_err()
        );
    }

    #[test]
    fn absolute_recorder_accepts_only_the_exact_step0_baseline_bytes() {
        let baseline = include_bytes!(
            "../../../../tests/acceptance/fixtures/agent-safe-storage/performance-baseline.2026-08-03.v1.json"
        );
        assert_eq!(
            validate_baseline_digest(baseline).expect("accepted baseline"),
            ACCEPTED_BASELINE_SHA256
        );
        let mut drifted = baseline.to_vec();
        drifted.push(b'\n');
        assert!(validate_baseline_digest(&drifted).is_err());
    }
}
