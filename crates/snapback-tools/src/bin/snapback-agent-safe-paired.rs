//! Experimentally paired/interleaved active-lane recorder for LLP 0162 row 13.
//!
//! The baseline executable is a separately provenance-bound observation
//! wrapper linked by path to the exact pre-profile tree. The wrapper does not
//! alter the accepted three product instrumentation paths. This executable
//! alternates that process with a child invocation of itself whose mutation
//! fixture activates ordinary-mutation coverage and carries a server-issued
//! client-range identity through the production commit seam.
//!
//! @ref LLP 0162#measurement-gate — compare the named baseline binary and the
//!   active covered lane in time-local three-subpair AB/BA outer samples,
//!   bound to exact bytes.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use snapback_tools::bench::{
    BenchConfig, BenchReport, IdleObservation, measure_idle_agent_safe_active_covered, run,
    run_agent_safe_active_covered,
};

const RECORDED_PAIRS: usize = 11;
const RECORDED_SUBPAIRS_PER_PAIR: usize = 3;
const BOOTSTRAP_SAMPLES: usize = 20_000;
const ACCEPTED_BASELINE_SHA256: &str =
    "d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91";
const BASELINE_REVISION: &str = "2ab36e28c74c450213b65f17ef81c0d6652ba33a";
const BASELINE_INSTRUMENTATION_COMMIT: &str = "3109a3b4f5068595a71448b10788b56b4fa358f5";
const BASELINE_ROOT_CARGO_LOCK_SHA256: &str =
    "sha256:496569d9a3cb87609b6e79974f69126dbaccba53eb71d093f5dcf090fe1a36b1";
const BASELINE_WORKER_CARGO_LOCK_SHA256: &str =
    "sha256:05bd0af1ed649011354f091e2cd371f38aaf5c229437c6a98b4807c7d0eead3d";
const BASELINE_DIRTY_PATHS: [&str; 3] = [
    "src/bench.rs",
    "src/bin/snapback-agent-safe-step0.rs",
    "src/bin/snapback-bench.rs",
];
const BASELINE_WORKER_FILES: [(&str, &str); 5] = [
    (
        "tools/agent-safe-baseline-worker/.gitignore",
        "sha256:306fd52e74fca6746e12acc750f232de15e71da917756a1270d74c91f5eb7368",
    ),
    (
        "tools/agent-safe-baseline-worker/Cargo.lock",
        BASELINE_WORKER_CARGO_LOCK_SHA256,
    ),
    (
        "tools/agent-safe-baseline-worker/Cargo.toml",
        "sha256:24c6ee237f07fcbb6df72ce9609368eeb8201d1927c0d583ac7851eb2f0a6a63",
    ),
    (
        "tools/agent-safe-baseline-worker/build.rs",
        "sha256:6026942fdd10ca697a163fa327d0c6cf8a899d7ac2fb58115309f8651c9ee958",
    ),
    (
        "tools/agent-safe-baseline-worker/src/main.rs",
        "sha256:62b82d5b15c8db63637ff91e426a14644cc34b113ce140e695e7ecec012ea0cc",
    ),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Artifact {
    schema_version: &'static str,
    artifact_name: &'static str,
    date: &'static str,
    baseline: BaselineBinding,
    candidate: CandidateBinding,
    hardware_class: Hardware,
    toolchain: Toolchain,
    protocol: Protocol,
    raw_pairs: Vec<RawPair>,
    comparisons: Vec<Comparison>,
    byte_comparisons: Vec<ByteComparison>,
    idle_gates: IdleGates,
    measured_comparative_thresholds_passed: bool,
    full_row_13_protocol_qualified: bool,
    measurement_coverage: MeasurementCoverage,
    remaining_row_13_gates: [&'static str; 2],
    claim_boundary: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BaselineBinding {
    artifact_name: String,
    artifact_schema_version: String,
    artifact_sha256: String,
    source_revision: String,
    source_posture: String,
    build_provenance_sha256: String,
    build_provenance: BaselineBuildProvenance,
    source_root_cargo_lock_path: String,
    source_root_cargo_lock_sha256: String,
    external_worker_cargo_lock_path: String,
    external_worker_cargo_lock_sha256: String,
    executable_path: String,
    executable_sha256: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BaselineBuildProvenance {
    schema_version: String,
    source_revision: String,
    instrumentation_source_commit: String,
    instrumentation_files: Vec<InstrumentationFile>,
    external_worker: ExternalWorkerProvenance,
    build_profile: String,
    rustc_version: String,
    cargo_version: String,
    executable_sha256: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExternalWorkerProvenance {
    package_name: String,
    source_tree_path: String,
    snapback_path_dependency: String,
    path_dependency_source_revision: String,
    baseline_root_cargo_lock_sha256: String,
    derived_cargo_lock_sha256: String,
    lock_derivation: String,
    files: Vec<InstrumentationFile>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstrumentationFile {
    path: String,
    sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CandidateBinding {
    source_revision: String,
    source_tree_clean: bool,
    executable_path: String,
    executable_sha256: String,
    build_profile: &'static str,
    active_profile: &'static str,
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
struct Toolchain {
    rustc: String,
    cargo: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Protocol {
    warmups_per_executable: usize,
    recorded_pairs: usize,
    raw_subpairs_per_recorded_pair: usize,
    pair_order: &'static str,
    estimator: &'static str,
    confidence_interval: &'static str,
    bootstrap_samples: usize,
    bootstrap_seed: &'static str,
    quiescence_rule: &'static str,
    baseline_worker_protocol: &'static str,
    candidate_worker_protocol: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MeasurementCoverage {
    paired_active_covered_threshold_metrics: [&'static str; 9],
    paired_active_covered_unbounded_byte_metrics: [&'static str; 4],
    paired_active_covered_idle_gates: [&'static str; 3],
    retained_but_not_qualified_from_raw_report: [&'static str; 1],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RawPair {
    pair: usize,
    order_sequence: &'static str,
    raw_subpairs: Vec<RawSubpair>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RawSubpair {
    subpair: usize,
    order: &'static str,
    baseline_worker_protocol: String,
    baseline: BenchReport,
    baseline_idle: IdleObservation,
    candidate_active_covered_worker_protocol: String,
    candidate_active_covered: BenchReport,
    candidate_active_covered_idle: IdleObservation,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Comparison {
    metric: &'static str,
    direction: &'static str,
    bound_kind: &'static str,
    bound_percent: f64,
    paired_regressions_percent: Vec<f64>,
    paired_median_regression_percent: f64,
    bootstrap_90_percent_lower: f64,
    bootstrap_90_percent_upper: f64,
    passed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ByteComparison {
    metric: &'static str,
    baseline_values: Vec<u64>,
    candidate_active_covered_values: Vec<u64>,
    baseline_median: u64,
    candidate_active_covered_median: u64,
    paired_change_percent: Vec<Option<f64>>,
    threshold_status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IdleGates {
    duration_ms: u64,
    baseline_combined_cpu_us: Vec<u64>,
    candidate_combined_cpu_us: Vec<u64>,
    candidate_cpu_max_observed_us: u64,
    cpu_resolution_us: u64,
    cpu_passed: bool,
    baseline_rss_before_kb: Vec<f64>,
    candidate_rss_before_kb: Vec<f64>,
    baseline_rss_median_kb: f64,
    candidate_rss_median_kb: f64,
    paired_rss_regressions_percent: Vec<f64>,
    paired_rss_median_regression_percent: f64,
    bootstrap_90_percent_lower: f64,
    bootstrap_90_percent_upper: f64,
    rss_equivalence_bound_percent: f64,
    rss_passed: bool,
    candidate_output_block_operations: Vec<u64>,
    candidate_database_family_byte_deltas: Vec<i64>,
    every_candidate_output_block_count_zero: bool,
    every_candidate_database_family_delta_zero: bool,
    disk_passed: bool,
    passed: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerObservation {
    protocol: String,
    report: BenchReport,
    idle: IdleObservation,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdleWorkerObservation {
    protocol: String,
    idle: IdleObservation,
}

struct Arguments {
    output: PathBuf,
    baseline_artifact: PathBuf,
    baseline_provenance: PathBuf,
    baseline_root_cargo_lock: PathBuf,
    baseline_worker_cargo_lock: PathBuf,
    baseline_executable: PathBuf,
    baseline_executable_sha256: String,
    expected_revision: String,
}

#[derive(Clone, Copy)]
enum Direction {
    Latency,
    Throughput,
}

struct Metric {
    name: &'static str,
    value: fn(&BenchReport) -> f64,
    direction: Direction,
    bound_kind: &'static str,
    bound: f64,
}

struct ByteMetric {
    name: &'static str,
    value: fn(&BenchReport) -> u64,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct LockPackage {
    name: String,
    version: String,
    source: Option<String>,
    checksum: Option<String>,
}

fn main() -> anyhow::Result<()> {
    match std::env::args().nth(1).as_deref() {
        Some("--active-covered-worker") => return active_worker(),
        Some("--active-covered-idle-worker") => return active_idle_worker(),
        _ => {}
    }
    if cfg!(debug_assertions) {
        bail!("paired evidence must be produced by a --release binary");
    }
    let arguments = arguments()?;
    ensure_machine_quiescent()?;
    let baseline_bytes = std::fs::read(&arguments.baseline_artifact).with_context(|| {
        format!(
            "read baseline artifact {}",
            arguments.baseline_artifact.display()
        )
    })?;
    let baseline_sha256 = format!("{:x}", Sha256::digest(&baseline_bytes));
    if baseline_sha256 != ACCEPTED_BASELINE_SHA256 {
        bail!("baseline artifact bytes do not match the accepted LLP 0162 digest");
    }
    let baseline_json: Value =
        serde_json::from_slice(&baseline_bytes).context("decode baseline artifact")?;
    validate_baseline(&baseline_json)?;
    let baseline_provenance_bytes =
        std::fs::read(&arguments.baseline_provenance).with_context(|| {
            format!(
                "read baseline build provenance {}",
                arguments.baseline_provenance.display()
            )
        })?;
    let baseline_provenance_sha256 =
        format!("sha256:{:x}", Sha256::digest(&baseline_provenance_bytes));
    let baseline_provenance: BaselineBuildProvenance =
        serde_json::from_slice(&baseline_provenance_bytes)
            .context("decode baseline build provenance")?;
    let hardware = hardware()?;
    validate_hardware(&baseline_json, &hardware)?;
    let toolchain = Toolchain {
        rustc: checked_command(&["rustc", "--version"])?,
        cargo: checked_command(&["cargo", "--version"])?,
    };
    validate_toolchain(&baseline_json, &toolchain)?;
    validate_baseline_provenance(&baseline_provenance, &toolchain)?;
    validate_candidate_source(&arguments.expected_revision)?;

    let (baseline_root_cargo_lock, baseline_root_cargo_lock_sha256, baseline_root_lock_bytes) =
        bind_lockfile(
            &arguments.baseline_root_cargo_lock,
            BASELINE_ROOT_CARGO_LOCK_SHA256,
            "baseline source-root Cargo.lock",
        )?;
    let (baseline_worker_cargo_lock, baseline_worker_cargo_lock_sha256, worker_lock_bytes) =
        bind_lockfile(
            &arguments.baseline_worker_cargo_lock,
            BASELINE_WORKER_CARGO_LOCK_SHA256,
            "external baseline worker Cargo.lock",
        )?;
    validate_worker_lock_derivation(&baseline_root_lock_bytes, &worker_lock_bytes)?;

    let baseline_executable = canonical_regular_file(&arguments.baseline_executable)?;
    let baseline_executable_sha256 = digest_file(&baseline_executable)?;
    if baseline_executable_sha256 != normalize_sha256(&arguments.baseline_executable_sha256) {
        bail!("baseline executable bytes do not match --baseline-executable-sha256");
    }
    if baseline_executable_sha256 != normalize_sha256(&baseline_provenance.executable_sha256) {
        bail!("baseline executable bytes do not match the build-provenance subject digest");
    }
    let candidate_executable = canonical_regular_file(&std::env::current_exe()?)?;
    let candidate_executable_sha256 = digest_file(&candidate_executable)?;

    // One complete warm-up per executable. Each recorded outer pair contains
    // three full mirrored-order raw subpairs. The median-of-three estimator
    // keeps a transient excursion from becoming an outer bootstrap sample,
    // while the alternating outer parity balances which revision runs first.
    let _ = run_baseline(&baseline_executable)?;
    let _ = run_candidate(&candidate_executable)?;
    let mut raw_pairs = Vec::with_capacity(RECORDED_PAIRS);
    for pair in 0..RECORDED_PAIRS {
        let (order_sequence, baseline_first) = outer_pair_order(pair);
        let mut raw_subpairs = Vec::with_capacity(RECORDED_SUBPAIRS_PER_PAIR);
        for (subpair, baseline_first) in baseline_first.into_iter().enumerate() {
            let (order, baseline, candidate) = if baseline_first {
                (
                    "baselineThenCandidate",
                    run_baseline(&baseline_executable)?,
                    run_candidate(&candidate_executable)?,
                )
            } else {
                let candidate = run_candidate(&candidate_executable)?;
                let baseline = run_baseline(&baseline_executable)?;
                ("candidateThenBaseline", baseline, candidate)
            };
            raw_subpairs.push(RawSubpair {
                subpair: subpair + 1,
                order,
                baseline_worker_protocol: baseline.protocol,
                baseline: baseline.report,
                baseline_idle: baseline.idle,
                candidate_active_covered_worker_protocol: candidate.protocol,
                candidate_active_covered: candidate.report,
                candidate_active_covered_idle: candidate.idle,
            });
        }
        raw_pairs.push(RawPair {
            pair: pair + 1,
            order_sequence,
            raw_subpairs,
        });
    }
    let comparisons = metrics()
        .iter()
        .map(|metric| compare(&raw_pairs, metric))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let byte_comparisons = byte_metrics()
        .iter()
        .map(|metric| compare_bytes(&raw_pairs, metric))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let idle_gates = compare_idle(&raw_pairs)?;
    let measured_comparative_thresholds_passed =
        comparisons.iter().all(|comparison| comparison.passed) && idle_gates.passed;
    let artifact = Artifact {
        schema_version: "snapback.agent-safe-active-paired.v3",
        artifact_name: "agent-safe-active-covered-paired-2026-08-04",
        date: "2026-08-04",
        baseline: BaselineBinding {
            artifact_name: baseline_json["artifactName"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            artifact_schema_version: baseline_json["schemaVersion"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            artifact_sha256: format!("sha256:{baseline_sha256}"),
            source_revision: BASELINE_REVISION.to_owned(),
            source_posture: baseline_json["source"]["baselineSourcePosture"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            build_provenance_sha256: baseline_provenance_sha256,
            build_provenance: baseline_provenance,
            source_root_cargo_lock_path: baseline_root_cargo_lock.display().to_string(),
            source_root_cargo_lock_sha256: baseline_root_cargo_lock_sha256,
            external_worker_cargo_lock_path: baseline_worker_cargo_lock.display().to_string(),
            external_worker_cargo_lock_sha256: baseline_worker_cargo_lock_sha256,
            executable_path: baseline_executable.display().to_string(),
            executable_sha256: baseline_executable_sha256,
        },
        candidate: CandidateBinding {
            source_revision: arguments.expected_revision,
            source_tree_clean: true,
            executable_path: candidate_executable.display().to_string(),
            executable_sha256: candidate_executable_sha256,
            build_profile: "release",
            active_profile: "serverIssuedClientRange+ordinaryMutationCoverageV1+productionEnvelopeChokePoint",
        },
        hardware_class: hardware,
        toolchain,
        protocol: Protocol {
            warmups_per_executable: 1,
            recorded_pairs: RECORDED_PAIRS,
            raw_subpairs_per_recorded_pair: RECORDED_SUBPAIRS_PER_PAIR,
            pair_order: "even zero-based outer pairs AB/BA/AB; odd zero-based outer pairs BA/AB/BA",
            estimator: "compute each raw subpair regression, take the median of three within each of 11 outer pairs, then take the median of the 11 outer values",
            confidence_interval: "deterministic bootstrap 90% interval over 11 outer median-of-three regressions; interval must lie wholly inside the registered bound",
            bootstrap_samples: BOOTSTRAP_SAMPLES,
            bootstrap_seed: "snapback-agent-safe-active-paired-v2/2026-08-04",
            quiescence_rule: "direct release binary refuses unless no cargo or rustc process exists",
            baseline_worker_protocol: "external digest-bound wrapper and lockfile path-linked to the exact pre-profile tree; original baseline product posture remains exactly three instrumentation paths",
            candidate_worker_protocol: "same release executable: --active-covered-worker records active-covered read/write metrics; a fresh --active-covered-idle-worker first runs the dormant comparator workload, then holds the armed storage connection and server-issued range across the five-second idle observation",
        },
        raw_pairs,
        comparisons,
        byte_comparisons,
        idle_gates,
        measured_comparative_thresholds_passed,
        full_row_13_protocol_qualified: false,
        measurement_coverage: MeasurementCoverage {
            paired_active_covered_threshold_metrics: [
                "currentPointReadP50Us",
                "currentPointReadP95Us",
                "currentRangeReadP50Us",
                "currentRangeReadP95Us",
                "currentQueryPlanReadP50Us",
                "currentQueryPlanReadP95Us",
                "singleWriterMutationsPerSec",
                "singleWriterMutationP50Us",
                "singleWriterMutationP95Us",
            ],
            paired_active_covered_unbounded_byte_metrics: [
                "allocatedWriteBytesPerChangedRow",
                "allocatedWriteBytesPerOperation",
                "retainedBytesPerChangedRow",
                "retainedBytesPerOperation",
            ],
            paired_active_covered_idle_gates: [
                "combinedCpuAtFiveSeconds",
                "residentMemoryEquivalence",
                "outputBlocksAndDatabaseFamilyBytesUnchanged",
            ],
            retained_but_not_qualified_from_raw_report: [
                "fanout metrics do not activate the LLP 0163 covered lane",
            ],
        },
        remaining_row_13_gates: [
            "separate dated absolute-operation and active-carrier contention record for this exact frozen revision",
            "every applicable crash/reopen correctness gate",
        ],
        claim_boundary: "comparative evidence only; this artifact alone does not pass Acceptance 13, accept LLP 0163-0165, or advertise a capability",
    };
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&arguments.output)
        .with_context(|| format!("create new paired artifact {}", arguments.output.display()))?;
    serde_json::to_writer_pretty(&mut output, &artifact)?;
    use std::io::Write as _;
    writeln!(output)?;
    output.sync_all()?;
    println!("wrote {}", arguments.output.display());
    Ok(())
}

fn active_worker() -> anyhow::Result<()> {
    if cfg!(debug_assertions) {
        bail!("active covered worker must be a --release binary");
    }
    let report = run_agent_safe_active_covered(&BenchConfig::agent_safe_step0())?;
    let executable = std::env::current_exe().context("resolve active covered worker executable")?;
    let output = Command::new(&executable)
        .arg("--active-covered-idle-worker")
        .output()
        .with_context(|| format!("run isolated active idle worker {}", executable.display()))?;
    if !output.status.success() {
        bail!(
            "isolated active idle worker failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let idle_observation: IdleWorkerObservation =
        serde_json::from_slice(&output.stdout).context("decode isolated active idle report")?;
    anyhow::ensure!(
        idle_observation.protocol == "agentSafeActiveCoveredIdleWorkerV1",
        "isolated active idle worker did not attest its exact protocol"
    );
    println!(
        "{}",
        serde_json::to_string(&WorkerObservation {
            protocol: "agentSafeActiveCoveredWorkerV3".to_owned(),
            report,
            idle: idle_observation.idle,
        })?
    );
    Ok(())
}

/// Measure idle residency in a fresh process whose preceding allocation/code
/// footprint matches the dormant comparator workload. Active read/write costs
/// are already measured by the parent worker; repeating them here would make
/// transient envelope setup part of the otherwise-idle RSS metric. The actual
/// active coverage manifest, armed storage connection, and issued range remain
/// live inside `measure_idle_agent_safe_active_covered` for the whole window.
///
/// @ref LLP 0162#measurement-gate — per-metric fixtures keep setup outside the
///   idle window and compare active storage after the same dormant warm path.
fn active_idle_worker() -> anyhow::Result<()> {
    if cfg!(debug_assertions) {
        bail!("active covered idle worker must be a --release binary");
    }
    let _ = run(&BenchConfig::agent_safe_step0())?;
    let idle = measure_idle_agent_safe_active_covered(Duration::from_secs(5))?;
    println!(
        "{}",
        serde_json::to_string(&IdleWorkerObservation {
            protocol: "agentSafeActiveCoveredIdleWorkerV1".to_owned(),
            idle,
        })?
    );
    Ok(())
}

fn arguments() -> anyhow::Result<Arguments> {
    let mut output = None;
    let mut baseline_artifact = None;
    let mut baseline_provenance = None;
    let mut baseline_root_cargo_lock = None;
    let mut baseline_worker_cargo_lock = None;
    let mut baseline_executable = None;
    let mut baseline_executable_sha256 = None;
    let mut expected_revision = None;
    let mut arguments = std::env::args_os().skip(1);
    while let Some(argument) = arguments.next() {
        let slot = match argument.to_str() {
            Some("--output") => &mut output,
            Some("--baseline-artifact") => &mut baseline_artifact,
            Some("--baseline-provenance") => &mut baseline_provenance,
            Some("--baseline-root-cargo-lock") => &mut baseline_root_cargo_lock,
            Some("--baseline-worker-cargo-lock") => &mut baseline_worker_cargo_lock,
            Some("--baseline-executable") => &mut baseline_executable,
            Some("--baseline-executable-sha256") => &mut baseline_executable_sha256,
            Some("--expected-revision") => &mut expected_revision,
            _ => bail!(
                "usage: snapback-agent-safe-paired --output PATH --baseline-artifact PATH --baseline-provenance PATH --baseline-root-cargo-lock PATH --baseline-worker-cargo-lock PATH --baseline-executable PATH --baseline-executable-sha256 SHA256 --expected-revision REV"
            ),
        };
        *slot = arguments.next().map(PathBuf::from);
    }
    let string = |value: Option<PathBuf>, name: &str| -> anyhow::Result<String> {
        value
            .and_then(|value| value.into_os_string().into_string().ok())
            .with_context(|| format!("{name} requires a UTF-8 value"))
    };
    Ok(Arguments {
        output: output.context("--output is required")?,
        baseline_artifact: baseline_artifact.context("--baseline-artifact is required")?,
        baseline_provenance: baseline_provenance.context("--baseline-provenance is required")?,
        baseline_root_cargo_lock: baseline_root_cargo_lock
            .context("--baseline-root-cargo-lock is required")?,
        baseline_worker_cargo_lock: baseline_worker_cargo_lock
            .context("--baseline-worker-cargo-lock is required")?,
        baseline_executable: baseline_executable.context("--baseline-executable is required")?,
        baseline_executable_sha256: string(
            baseline_executable_sha256,
            "--baseline-executable-sha256",
        )?,
        expected_revision: string(expected_revision, "--expected-revision")?,
    })
}

fn validate_baseline_provenance(
    provenance: &BaselineBuildProvenance,
    toolchain: &Toolchain,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        provenance.schema_version == "snapback.agent-safe-baseline-build-provenance.v2"
            && provenance.source_revision == BASELINE_REVISION
            && provenance.instrumentation_source_commit == BASELINE_INSTRUMENTATION_COMMIT
            && provenance.build_profile == "release"
            && provenance.rustc_version == toolchain.rustc
            && provenance.cargo_version == toolchain.cargo,
        "baseline build provenance does not bind the accepted source recipe/toolchain/profile"
    );
    let expected = [
        (
            "src/bench.rs",
            "sha256:7d9936f65e41ff9d5b3118966c8e5038b4777cdfa2ad1fe1617e35ad5fa73ed0",
        ),
        (
            "src/bin/snapback-agent-safe-step0.rs",
            "sha256:b646422c12e1651daa48b70cdb3a894693ea31cd6eb01eb81c0f6215a42e6232",
        ),
        (
            "src/bin/snapback-bench.rs",
            "sha256:540e7aed8416f48df6ae361a95e39e2f6dbecca2ad22489e59325da9b0ec9b57",
        ),
    ];
    let mut observed = provenance
        .instrumentation_files
        .iter()
        .map(|file| (file.path.as_str(), file.sha256.as_str()))
        .collect::<Vec<_>>();
    observed.sort_unstable();
    anyhow::ensure!(
        observed == expected,
        "baseline instrumentation blob digests diverge"
    );
    anyhow::ensure!(
        provenance.external_worker.package_name == "snapback-agent-safe-baseline-worker"
            && provenance.external_worker.source_tree_path == "tools/agent-safe-baseline-worker"
            && provenance.external_worker.snapback_path_dependency == "../.."
            && provenance.external_worker.path_dependency_source_revision == BASELINE_REVISION
            && provenance.external_worker.baseline_root_cargo_lock_sha256
                == BASELINE_ROOT_CARGO_LOCK_SHA256
            && provenance.external_worker.derived_cargo_lock_sha256
                == BASELINE_WORKER_CARGO_LOCK_SHA256
            && provenance.external_worker.lock_derivation
                == "seed exact baseline root lock; resolve isolated wrapper offline; require every shared package name/version/source/checksum tuple to match and the wrapper to be the only addition",
        "external baseline worker does not bind the exact path dependency/tree"
    );
    let mut observed_worker = provenance
        .external_worker
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.sha256.as_str()))
        .collect::<Vec<_>>();
    observed_worker.sort_unstable();
    anyhow::ensure!(
        observed_worker == BASELINE_WORKER_FILES,
        "external baseline worker source/lock digests diverge"
    );
    anyhow::ensure!(
        is_sha256(&provenance.executable_sha256),
        "baseline provenance executable digest is malformed"
    );
    Ok(())
}

fn validate_baseline(baseline: &Value) -> anyhow::Result<()> {
    anyhow::ensure!(
        baseline["schemaVersion"] == "snapback.agent-safe-step0-baseline.v1"
            && baseline["artifactName"] == "agent-safe-step0-pre-profile-2026-08-03",
        "baseline artifact identity is not the accepted LLP 0162 step-0 record"
    );
    anyhow::ensure!(
        baseline["source"]["revision"] == BASELINE_REVISION
            && baseline["source"]["dirty"] == true
            && baseline["source"]["profileChangesPresent"] == false
            && baseline["source"]["buildProfile"] == "release",
        "baseline source posture diverges from the accepted record"
    );
    let mut paths = baseline["source"]["dirtyPaths"]
        .as_array()
        .context("baseline source.dirtyPaths is missing")?
        .iter()
        .map(|value| value.as_str().unwrap_or_default())
        .collect::<Vec<_>>();
    paths.sort_unstable();
    let mut expected = BASELINE_DIRTY_PATHS.to_vec();
    expected.sort_unstable();
    anyhow::ensure!(paths == expected, "baseline instrumentation paths diverge");
    Ok(())
}

fn validate_candidate_source(expected_revision: &str) -> anyhow::Result<()> {
    let head = checked_command(&["git", "rev-parse", "HEAD"])?;
    anyhow::ensure!(
        head == expected_revision,
        "checked-out HEAD differs from --expected-revision"
    );
    let dirty = checked_command(&["git", "status", "--porcelain", "--untracked-files=all"])?;
    anyhow::ensure!(
        dirty.is_empty(),
        "paired recorder requires a clean source tree; found:\n{dirty}"
    );
    anyhow::ensure!(
        snapback_kernel::identity::git_commit() == expected_revision,
        "release executable was not built from --expected-revision"
    );
    anyhow::ensure!(
        !snapback_kernel::identity::git_dirty(),
        "release executable was not built from a clean source tree"
    );
    Ok(())
}

fn bind_lockfile(
    path: &Path,
    expected_sha256: &str,
    subject: &str,
) -> anyhow::Result<(PathBuf, String, Vec<u8>)> {
    let metadata = std::fs::symlink_metadata(path)
        .with_context(|| format!("inspect {subject} {}", path.display()))?;
    anyhow::ensure!(
        metadata.file_type().is_file() && !metadata.file_type().is_symlink(),
        "{subject} must be a regular non-symlink file"
    );
    let canonical = path
        .canonicalize()
        .with_context(|| format!("canonicalize {subject} {}", path.display()))?;
    let bytes = std::fs::read(&canonical)
        .with_context(|| format!("read {subject} {}", canonical.display()))?;
    let digest = format!("sha256:{:x}", Sha256::digest(&bytes));
    anyhow::ensure!(
        digest == expected_sha256,
        "{subject} bytes do not match the registered digest"
    );
    Ok((canonical, digest, bytes))
}

fn validate_worker_lock_derivation(root: &[u8], worker: &[u8]) -> anyhow::Result<()> {
    let root = parse_lock_packages(root)?;
    let worker = parse_lock_packages(worker)?;
    let wrapper = LockPackage {
        name: "snapback-agent-safe-baseline-worker".to_owned(),
        version: "0.1.0".to_owned(),
        source: None,
        checksum: None,
    };
    let additions = worker.difference(&root).cloned().collect::<BTreeSet<_>>();
    anyhow::ensure!(
        additions == BTreeSet::from([wrapper.clone()]),
        "external worker lock adds or changes a package beyond the wrapper: {additions:?}"
    );
    anyhow::ensure!(
        worker.contains(&LockPackage {
            name: "snapback".to_owned(),
            version: "0.1.0".to_owned(),
            source: None,
            checksum: None,
        }),
        "external worker lock does not path-link the baseline snapback package"
    );
    Ok(())
}

fn parse_lock_packages(bytes: &[u8]) -> anyhow::Result<BTreeSet<LockPackage>> {
    type LockPackageFields = (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );

    let text = std::str::from_utf8(bytes).context("Cargo.lock is not UTF-8")?;
    let mut packages = BTreeSet::new();
    let mut current: Option<LockPackageFields> = None;
    let flush = |current: &mut Option<LockPackageFields>,
                 packages: &mut BTreeSet<LockPackage>|
     -> anyhow::Result<()> {
        let Some((name, version, source, checksum)) = current.take() else {
            return Ok(());
        };
        let package = LockPackage {
            name: name.context("Cargo.lock package is missing name")?,
            version: version.context("Cargo.lock package is missing version")?,
            source,
            checksum,
        };
        anyhow::ensure!(
            packages.insert(package.clone()),
            "Cargo.lock repeats package identity {package:?}"
        );
        Ok(())
    };
    for line in text.lines() {
        if line == "[[package]]" {
            flush(&mut current, &mut packages)?;
            current = Some((None, None, None, None));
            continue;
        }
        let Some((name, version, source, checksum)) = current.as_mut() else {
            continue;
        };
        for (prefix, slot) in [
            ("name = ", name),
            ("version = ", version),
            ("source = ", source),
            ("checksum = ", checksum),
        ] {
            if let Some(value) = line.strip_prefix(prefix) {
                *slot = Some(
                    serde_json::from_str::<String>(value)
                        .with_context(|| format!("decode Cargo.lock {prefix}value"))?,
                );
                break;
            }
        }
    }
    flush(&mut current, &mut packages)?;
    anyhow::ensure!(!packages.is_empty(), "Cargo.lock contains no packages");
    Ok(packages)
}

fn hardware() -> anyhow::Result<Hardware> {
    Ok(Hardware {
        os: checked_command(&["sw_vers", "-productVersion"])?,
        architecture: std::env::consts::ARCH,
        model: sysctl("hw.model")?,
        cpu: sysctl("machdep.cpu.brand_string")?,
        logical_cpus: std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(0),
        memory_bytes: sysctl("hw.memsize")?.parse().unwrap_or(0),
    })
}

fn validate_hardware(baseline: &Value, current: &Hardware) -> anyhow::Result<()> {
    let expected = &baseline["hardwareClass"];
    anyhow::ensure!(
        expected["os"] == current.os
            && expected["architecture"] == current.architecture
            && expected["model"] == current.model
            && expected["cpu"] == current.cpu
            && expected["logicalCpus"] == current.logical_cpus
            && expected["memoryBytes"] == current.memory_bytes,
        "measurement host differs from the accepted step-0 hardware/OS class"
    );
    Ok(())
}

fn validate_toolchain(baseline: &Value, current: &Toolchain) -> anyhow::Result<()> {
    anyhow::ensure!(
        baseline["source"]["rustcVersion"] == current.rustc
            && baseline["source"]["cargoVersion"] == current.cargo,
        "measurement toolchain differs from the accepted step-0 toolchain"
    );
    Ok(())
}

fn canonical_regular_file(path: &Path) -> anyhow::Result<PathBuf> {
    let metadata = std::fs::symlink_metadata(path)
        .with_context(|| format!("inspect executable {}", path.display()))?;
    anyhow::ensure!(
        metadata.file_type().is_file(),
        "executable path must be a regular file"
    );
    anyhow::ensure!(
        !metadata.file_type().is_symlink(),
        "executable path must not be a symlink"
    );
    path.canonicalize()
        .with_context(|| format!("canonicalize executable {}", path.display()))
}

fn run_baseline(executable: &Path) -> anyhow::Result<WorkerObservation> {
    let output = Command::new(executable)
        .output()
        .with_context(|| format!("run baseline worker {}", executable.display()))?;
    if !output.status.success() {
        bail!(
            "baseline worker failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let observation: WorkerObservation =
        serde_json::from_slice(&output.stdout).context("decode baseline worker report")?;
    anyhow::ensure!(
        observation.protocol == "agentSafeDormantBaselineWorkerV1",
        "baseline worker did not attest the dormant pre-profile protocol"
    );
    Ok(observation)
}

fn run_candidate(executable: &Path) -> anyhow::Result<WorkerObservation> {
    let output = Command::new(executable)
        .arg("--active-covered-worker")
        .output()
        .with_context(|| format!("run candidate worker {}", executable.display()))?;
    if !output.status.success() {
        bail!(
            "candidate worker failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let observation: WorkerObservation =
        serde_json::from_slice(&output.stdout).context("decode candidate worker report")?;
    anyhow::ensure!(
        observation.protocol == "agentSafeActiveCoveredWorkerV3",
        "candidate worker did not attest the active covered protocol"
    );
    Ok(observation)
}

fn metrics() -> [Metric; 9] {
    [
        metric(
            "currentPointReadP50Us",
            |r| r.current_point_read_p50_us,
            Direction::Latency,
            "twoSidedEquivalence",
            5.0,
        ),
        metric(
            "currentPointReadP95Us",
            |r| r.current_point_read_p95_us,
            Direction::Latency,
            "twoSidedEquivalence",
            5.0,
        ),
        metric(
            "currentRangeReadP50Us",
            |r| r.current_range_read_p50_us,
            Direction::Latency,
            "twoSidedEquivalence",
            5.0,
        ),
        metric(
            "currentRangeReadP95Us",
            |r| r.current_range_read_p95_us,
            Direction::Latency,
            "twoSidedEquivalence",
            5.0,
        ),
        metric(
            "currentQueryPlanReadP50Us",
            |r| r.current_query_plan_read_p50_us,
            Direction::Latency,
            "twoSidedEquivalence",
            5.0,
        ),
        metric(
            "currentQueryPlanReadP95Us",
            |r| r.current_query_plan_read_p95_us,
            Direction::Latency,
            "twoSidedEquivalence",
            5.0,
        ),
        metric(
            "singleWriterMutationsPerSec",
            |r| r.single_writer_mutations_per_sec,
            Direction::Throughput,
            "oneSidedRegression",
            15.0,
        ),
        metric(
            "singleWriterMutationP50Us",
            |r| r.single_writer_mutation_p50_us,
            Direction::Latency,
            "oneSidedRegression",
            15.0,
        ),
        metric(
            "singleWriterMutationP95Us",
            |r| r.single_writer_mutation_p95_us,
            Direction::Latency,
            "oneSidedRegression",
            15.0,
        ),
    ]
}

fn byte_metrics() -> [ByteMetric; 4] {
    [
        ByteMetric {
            name: "allocatedWriteBytesPerChangedRow",
            value: |report| report.allocated_write_bytes_per_changed_row,
        },
        ByteMetric {
            name: "allocatedWriteBytesPerOperation",
            value: |report| report.allocated_write_bytes_per_operation,
        },
        ByteMetric {
            name: "retainedBytesPerChangedRow",
            value: |report| report.retained_bytes_per_changed_row,
        },
        ByteMetric {
            name: "retainedBytesPerOperation",
            value: |report| report.retained_bytes_per_operation,
        },
    ]
}

fn metric(
    name: &'static str,
    value: fn(&BenchReport) -> f64,
    direction: Direction,
    bound_kind: &'static str,
    bound: f64,
) -> Metric {
    Metric {
        name,
        value,
        direction,
        bound_kind,
        bound,
    }
}

fn compare(pairs: &[RawPair], metric: &Metric) -> anyhow::Result<Comparison> {
    let regressions = pairs
        .iter()
        .map(|pair| {
            ensure_three_subpairs(pair)?;
            let raw_regressions = pair
                .raw_subpairs
                .iter()
                .map(|subpair| {
                    let baseline = (metric.value)(&subpair.baseline);
                    let candidate = (metric.value)(&subpair.candidate_active_covered);
                    anyhow::ensure!(baseline > 0.0, "baseline {} is not positive", metric.name);
                    Ok(match metric.direction {
                        Direction::Latency => 100.0 * (candidate / baseline - 1.0),
                        Direction::Throughput => 100.0 * (1.0 - candidate / baseline),
                    })
                })
                .collect::<anyhow::Result<Vec<_>>>()?;
            median_of_three(raw_regressions)
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let (lower, upper) = bootstrap_median_interval(&regressions);
    let passed = if metric.bound_kind == "twoSidedEquivalence" {
        lower >= -metric.bound && upper <= metric.bound
    } else {
        upper <= metric.bound
    };
    let mut sorted = regressions.clone();
    sorted.sort_by(f64::total_cmp);
    Ok(Comparison {
        metric: metric.name,
        direction: match metric.direction {
            Direction::Latency => "higherIsWorse",
            Direction::Throughput => "lowerIsWorse",
        },
        bound_kind: metric.bound_kind,
        bound_percent: metric.bound,
        paired_regressions_percent: regressions,
        paired_median_regression_percent: median(&sorted),
        bootstrap_90_percent_lower: lower,
        bootstrap_90_percent_upper: upper,
        passed,
    })
}

fn compare_bytes(pairs: &[RawPair], metric: &ByteMetric) -> anyhow::Result<ByteComparison> {
    for pair in pairs {
        ensure_three_subpairs(pair)?;
    }
    let baseline_values = pairs
        .iter()
        .map(|pair| {
            let mut values = pair
                .raw_subpairs
                .iter()
                .map(|subpair| (metric.value)(&subpair.baseline))
                .collect::<Vec<_>>();
            values.sort_unstable();
            values[values.len() / 2]
        })
        .collect::<Vec<_>>();
    let candidate_active_covered_values = pairs
        .iter()
        .map(|pair| {
            let mut values = pair
                .raw_subpairs
                .iter()
                .map(|subpair| (metric.value)(&subpair.candidate_active_covered))
                .collect::<Vec<_>>();
            values.sort_unstable();
            values[values.len() / 2]
        })
        .collect::<Vec<_>>();
    let paired_change_percent = baseline_values
        .iter()
        .zip(&candidate_active_covered_values)
        .map(|(baseline, candidate)| {
            (*baseline > 0).then(|| 100.0 * (*candidate as f64 / *baseline as f64 - 1.0))
        })
        .collect();
    let mut sorted_baseline = baseline_values.clone();
    sorted_baseline.sort_unstable();
    let mut sorted_candidate = candidate_active_covered_values.clone();
    sorted_candidate.sort_unstable();
    Ok(ByteComparison {
        metric: metric.name,
        baseline_values,
        candidate_active_covered_values,
        baseline_median: sorted_baseline[sorted_baseline.len() / 2],
        candidate_active_covered_median: sorted_candidate[sorted_candidate.len() / 2],
        paired_change_percent,
        threshold_status: "observed; LLP 0162 registers the metric but no numeric byte bound",
    })
}

fn compare_idle(pairs: &[RawPair]) -> anyhow::Result<IdleGates> {
    anyhow::ensure!(
        !pairs.is_empty(),
        "idle comparison requires paired observations"
    );
    for pair in pairs {
        ensure_three_subpairs(pair)?;
    }
    anyhow::ensure!(
        pairs
            .iter()
            .all(|pair| pair.raw_subpairs.iter().all(|subpair| {
                subpair.baseline_idle.duration_ms == 5_000
                    && subpair.candidate_active_covered_idle.duration_ms == 5_000
            })),
        "idle worker observations must each cover exactly five seconds"
    );
    let baseline_combined_cpu_us = pairs
        .iter()
        .flat_map(|pair| &pair.raw_subpairs)
        .map(|subpair| {
            subpair
                .baseline_idle
                .cpu_user_us
                .saturating_add(subpair.baseline_idle.cpu_system_us)
        })
        .collect::<Vec<_>>();
    let candidate_combined_cpu_us = pairs
        .iter()
        .flat_map(|pair| &pair.raw_subpairs)
        .map(|subpair| {
            subpair
                .candidate_active_covered_idle
                .cpu_user_us
                .saturating_add(subpair.candidate_active_covered_idle.cpu_system_us)
        })
        .collect::<Vec<_>>();
    let candidate_cpu_max_observed_us =
        candidate_combined_cpu_us.iter().copied().max().unwrap_or(0);
    let baseline_rss_before_kb = pairs
        .iter()
        .map(|pair| {
            let mut values = pair
                .raw_subpairs
                .iter()
                .map(|subpair| subpair.baseline_idle.resident_kb_before)
                .collect::<Vec<_>>();
            values.sort_by(f64::total_cmp);
            median(&values)
        })
        .collect::<Vec<_>>();
    let candidate_rss_before_kb = pairs
        .iter()
        .map(|pair| {
            let mut values = pair
                .raw_subpairs
                .iter()
                .map(|subpair| subpair.candidate_active_covered_idle.resident_kb_before)
                .collect::<Vec<_>>();
            values.sort_by(f64::total_cmp);
            median(&values)
        })
        .collect::<Vec<_>>();
    anyhow::ensure!(
        pairs
            .iter()
            .flat_map(|pair| &pair.raw_subpairs)
            .all(|subpair| {
                let baseline = subpair.baseline_idle.resident_kb_before;
                let candidate = subpair.candidate_active_covered_idle.resident_kb_before;
                baseline.is_finite() && baseline > 0.0 && candidate.is_finite() && candidate > 0.0
            }),
        "idle RSS observations must be finite and positive"
    );
    let paired_rss_regressions_percent = pairs
        .iter()
        .map(|pair| {
            let raw_regressions = pair
                .raw_subpairs
                .iter()
                .map(|subpair| {
                    100.0
                        * (subpair.candidate_active_covered_idle.resident_kb_before
                            / subpair.baseline_idle.resident_kb_before
                            - 1.0)
                })
                .collect::<Vec<_>>();
            median_of_three(raw_regressions)
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let (bootstrap_90_percent_lower, bootstrap_90_percent_upper) =
        bootstrap_median_interval(&paired_rss_regressions_percent);
    let mut sorted_rss_regressions = paired_rss_regressions_percent.clone();
    sorted_rss_regressions.sort_by(f64::total_cmp);
    let mut sorted_baseline_rss = baseline_rss_before_kb.clone();
    sorted_baseline_rss.sort_by(f64::total_cmp);
    let mut sorted_candidate_rss = candidate_rss_before_kb.clone();
    sorted_candidate_rss.sort_by(f64::total_cmp);
    let candidate_output_block_operations = pairs
        .iter()
        .flat_map(|pair| &pair.raw_subpairs)
        .map(|subpair| {
            subpair
                .candidate_active_covered_idle
                .output_block_operations
        })
        .collect::<Vec<_>>();
    let candidate_database_family_byte_deltas = pairs
        .iter()
        .flat_map(|pair| &pair.raw_subpairs)
        .map(|subpair| {
            let observation = &subpair.candidate_active_covered_idle;
            i64::try_from(
                observation.database_family_bytes_after as i128
                    - observation.database_family_bytes_before as i128,
            )
            .context("idle database-family byte delta exceeds i64")
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let cpu_passed = candidate_cpu_max_observed_us <= 5_000;
    let rss_passed = bootstrap_90_percent_lower >= -5.0 && bootstrap_90_percent_upper <= 5.0;
    let every_candidate_output_block_count_zero = candidate_output_block_operations
        .iter()
        .all(|operations| *operations == 0);
    let every_candidate_database_family_delta_zero = candidate_database_family_byte_deltas
        .iter()
        .all(|delta| *delta == 0);
    let disk_passed =
        every_candidate_output_block_count_zero && every_candidate_database_family_delta_zero;
    Ok(IdleGates {
        duration_ms: 5_000,
        baseline_combined_cpu_us,
        candidate_combined_cpu_us,
        candidate_cpu_max_observed_us,
        cpu_resolution_us: 5_000,
        cpu_passed,
        baseline_rss_before_kb,
        candidate_rss_before_kb,
        baseline_rss_median_kb: median(&sorted_baseline_rss),
        candidate_rss_median_kb: median(&sorted_candidate_rss),
        paired_rss_regressions_percent,
        paired_rss_median_regression_percent: median(&sorted_rss_regressions),
        bootstrap_90_percent_lower,
        bootstrap_90_percent_upper,
        rss_equivalence_bound_percent: 5.0,
        rss_passed,
        candidate_output_block_operations,
        candidate_database_family_byte_deltas,
        every_candidate_output_block_count_zero,
        every_candidate_database_family_delta_zero,
        disk_passed,
        passed: cpu_passed && rss_passed && disk_passed,
    })
}

fn ensure_three_subpairs(pair: &RawPair) -> anyhow::Result<()> {
    anyhow::ensure!(
        pair.raw_subpairs.len() == RECORDED_SUBPAIRS_PER_PAIR,
        "outer pair {} must contain exactly three raw subpairs",
        pair.pair
    );
    Ok(())
}

fn outer_pair_order(pair: usize) -> (&'static str, [bool; RECORDED_SUBPAIRS_PER_PAIR]) {
    if pair.is_multiple_of(2) {
        ("AB/BA/AB", [true, false, true])
    } else {
        ("BA/AB/BA", [false, true, false])
    }
}

fn median_of_three(mut values: Vec<f64>) -> anyhow::Result<f64> {
    anyhow::ensure!(
        values.len() == RECORDED_SUBPAIRS_PER_PAIR,
        "median-of-three estimator requires exactly three values"
    );
    values.sort_by(f64::total_cmp);
    Ok(values[1])
}

fn bootstrap_median_interval(values: &[f64]) -> (f64, f64) {
    let mut state = 0x7e57_0162_2026_0804_u64;
    let mut estimates = Vec::with_capacity(BOOTSTRAP_SAMPLES);
    let mut sample = Vec::with_capacity(values.len());
    for _ in 0..BOOTSTRAP_SAMPLES {
        sample.clear();
        for _ in 0..values.len() {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            sample.push(values[(state as usize) % values.len()]);
        }
        sample.sort_by(f64::total_cmp);
        estimates.push(median(&sample));
    }
    estimates.sort_by(f64::total_cmp);
    (
        estimates[BOOTSTRAP_SAMPLES / 20],
        estimates[BOOTSTRAP_SAMPLES * 19 / 20],
    )
}

fn median(sorted: &[f64]) -> f64 {
    sorted[sorted.len() / 2]
}

fn normalize_sha256(value: &str) -> String {
    if value.starts_with("sha256:") {
        value.to_owned()
    } else {
        format!("sha256:{value}")
    }
}

fn is_sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn digest_file(path: &Path) -> anyhow::Result<String> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("read executable for digest {}", path.display()))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn ensure_machine_quiescent() -> anyhow::Result<()> {
    let processes = checked_command(&["ps", "-axo", "comm="])?;
    let offenders = processes
        .lines()
        .filter(|line| {
            let name = line.rsplit('/').next().unwrap_or(line).trim();
            name == "cargo" || name == "rustc"
        })
        .collect::<Vec<_>>();
    anyhow::ensure!(
        offenders.is_empty(),
        "active build processes contaminate measurement: {offenders:?}"
    );
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
    fn normalizes_digest_prefix_without_changing_bytes() {
        let digest = "a".repeat(64);
        assert_eq!(normalize_sha256(&digest), format!("sha256:{digest}"));
        assert_eq!(
            normalize_sha256(&format!("sha256:{digest}")),
            format!("sha256:{digest}")
        );
    }

    #[test]
    fn paired_bootstrap_is_deterministic() {
        let values = [-2.0, -1.0, 0.0, 1.0, 2.0];
        assert_eq!(
            bootstrap_median_interval(&values),
            bootstrap_median_interval(&values)
        );
    }

    #[test]
    fn outer_pairs_mirror_three_raw_subpair_orders() {
        assert_eq!(outer_pair_order(0), ("AB/BA/AB", [true, false, true]));
        assert_eq!(outer_pair_order(1), ("BA/AB/BA", [false, true, false]));
        assert_eq!(outer_pair_order(10), ("AB/BA/AB", [true, false, true]));
    }

    #[test]
    fn outer_estimator_uses_the_raw_median_of_three() {
        assert_eq!(median_of_three(vec![80.0, 2.0, 3.0]).unwrap(), 3.0);
        assert!(median_of_three(vec![2.0, 3.0]).is_err());
    }

    #[test]
    fn worker_lock_derivation_allows_only_matching_baseline_packages_and_wrapper() {
        let root = br#"version = 4

[[package]]
name = "serde"
version = "1.0.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"

[[package]]
name = "snapback"
version = "0.1.0"
"#;
        let worker = br#"version = 4

[[package]]
name = "serde"
version = "1.0.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"

[[package]]
name = "snapback"
version = "0.1.0"

[[package]]
name = "snapback-agent-safe-baseline-worker"
version = "0.1.0"
"#;
        validate_worker_lock_derivation(root, worker).expect("matching derived worker lock");

        let changed = String::from_utf8(worker.to_vec())
            .unwrap()
            .replace("version = \"1.0.1\"", "version = \"1.0.2\"");
        assert!(validate_worker_lock_derivation(root, changed.as_bytes()).is_err());
    }
}
