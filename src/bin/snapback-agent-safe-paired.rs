//! Experimentally paired/interleaved active-lane recorder for LLP 0162 row 13.
//!
//! The baseline executable is the pre-profile `snapback-bench` binary. This
//! executable alternates that process with a child invocation of itself whose
//! mutation fixture activates ordinary-mutation coverage and carries a
//! server-issued client-range identity through the production commit seam.
//!
//! @ref LLP 0162#measurement-gate — compare the named baseline binary and the
//!   active covered lane in time-local AB/BA pairs, bound to exact bytes.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use snapback::bench::{BenchConfig, BenchReport, run_agent_safe_active_covered};

const RECORDED_PAIRS: usize = 11;
const BOOTSTRAP_SAMPLES: usize = 20_000;
const ACCEPTED_BASELINE_SHA256: &str =
    "d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91";
const BASELINE_REVISION: &str = "2ab36e28c74c450213b65f17ef81c0d6652ba33a";
const BASELINE_INSTRUMENTATION_COMMIT: &str = "3109a3b4f5068595a71448b10788b56b4fa358f5";
const BASELINE_DIRTY_PATHS: [&str; 3] = [
    "src/bench.rs",
    "src/bin/snapback-agent-safe-step0.rs",
    "src/bin/snapback-bench.rs",
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
    measured_comparative_thresholds_passed: bool,
    full_row_13_protocol_qualified: bool,
    measurement_coverage: MeasurementCoverage,
    remaining_row_13_gates: [&'static str; 6],
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
    build_profile: String,
    rustc_version: String,
    cargo_version: String,
    executable_sha256: String,
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
    paired_active_covered_metrics: [&'static str; 9],
    retained_but_not_qualified_from_raw_report: [&'static str; 2],
    explicitly_unmeasured_or_inactive: [&'static str; 2],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RawPair {
    pair: usize,
    order: &'static str,
    baseline: BenchReport,
    candidate_active_covered: BenchReport,
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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveWorkerObservation {
    protocol: String,
    report: BenchReport,
}

struct Arguments {
    output: PathBuf,
    baseline_artifact: PathBuf,
    baseline_provenance: PathBuf,
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

fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("--active-covered-worker") {
        return active_worker();
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

    // One complete warm-up per executable. Recorded samples then alternate
    // AB/BA, so neither revision systematically owns the first observation.
    let _ = run_baseline(&baseline_executable)?;
    let _ = run_candidate(&candidate_executable)?;
    let mut raw_pairs = Vec::with_capacity(RECORDED_PAIRS);
    for pair in 0..RECORDED_PAIRS {
        let (order, baseline, candidate) = if pair % 2 == 0 {
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
        raw_pairs.push(RawPair {
            pair: pair + 1,
            order,
            baseline,
            candidate_active_covered: candidate,
        });
    }
    let comparisons = metrics()
        .iter()
        .map(|metric| compare(&raw_pairs, metric))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let measured_comparative_thresholds_passed =
        comparisons.iter().all(|comparison| comparison.passed);
    let artifact = Artifact {
        schema_version: "snapback.agent-safe-active-paired.v1",
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
            pair_order: "AB/BA alternating by zero-based pair parity",
            estimator: "median of 11 time-local paired regression percentages",
            confidence_interval: "deterministic bootstrap 90% interval over paired medians; interval must lie wholly inside the registered bound",
            bootstrap_samples: BOOTSTRAP_SAMPLES,
            bootstrap_seed: "snapback-agent-safe-active-paired-v1/2026-08-04",
            quiescence_rule: "direct release binary refuses unless no cargo or rustc process exists",
            baseline_worker_protocol: "external pre-profile snapback-bench --agent-safe-step0 --json",
            candidate_worker_protocol: "same executable --active-covered-worker on a fresh database per observation",
        },
        raw_pairs,
        comparisons,
        measured_comparative_thresholds_passed,
        full_row_13_protocol_qualified: false,
        measurement_coverage: MeasurementCoverage {
            paired_active_covered_metrics: [
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
            retained_but_not_qualified_from_raw_report: [
                "fanout metrics do not activate the LLP 0163 covered lane",
                "write-byte metrics still use the dormant one-row storage fixture",
            ],
            explicitly_unmeasured_or_inactive: [
                "paired idle CPU/RSS/disk observations",
                "active-covered allocated/retained bytes per row and operation",
            ],
        },
        remaining_row_13_gates: [
            "paired idle CPU/RSS/disk observations",
            "active-covered allocation/retention measurement",
            "dated fixed-Air execution of this exact clean revision",
            "dated p99 contention record",
            "RFC-author ratification of absolute fork/promotion bounds",
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
    println!(
        "{}",
        serde_json::to_string(&ActiveWorkerObservation {
            protocol: "agentSafeActiveCoveredWorkerV1".to_owned(),
            report,
        })?
    );
    Ok(())
}

fn arguments() -> anyhow::Result<Arguments> {
    let mut output = None;
    let mut baseline_artifact = None;
    let mut baseline_provenance = None;
    let mut baseline_executable = None;
    let mut baseline_executable_sha256 = None;
    let mut expected_revision = None;
    let mut arguments = std::env::args_os().skip(1);
    while let Some(argument) = arguments.next() {
        let slot = match argument.to_str() {
            Some("--output") => &mut output,
            Some("--baseline-artifact") => &mut baseline_artifact,
            Some("--baseline-provenance") => &mut baseline_provenance,
            Some("--baseline-executable") => &mut baseline_executable,
            Some("--baseline-executable-sha256") => &mut baseline_executable_sha256,
            Some("--expected-revision") => &mut expected_revision,
            _ => bail!(
                "usage: snapback-agent-safe-paired --output PATH --baseline-artifact PATH --baseline-provenance PATH --baseline-executable PATH --baseline-executable-sha256 SHA256 --expected-revision REV"
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
        provenance.schema_version == "snapback.agent-safe-baseline-build-provenance.v1"
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
        option_env!("SNAPBACK_BUILD_GIT_COMMIT") == Some(expected_revision),
        "release executable was not built from --expected-revision"
    );
    anyhow::ensure!(
        option_env!("SNAPBACK_BUILD_GIT_DIRTY") == Some("false"),
        "release executable was not built from a clean source tree"
    );
    Ok(())
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

fn run_baseline(executable: &Path) -> anyhow::Result<BenchReport> {
    let output = Command::new(executable)
        .args(["--agent-safe-step0", "--json"])
        .output()
        .with_context(|| format!("run baseline worker {}", executable.display()))?;
    if !output.status.success() {
        bail!(
            "baseline worker failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    serde_json::from_slice(&output.stdout).context("decode baseline worker report")
}

fn run_candidate(executable: &Path) -> anyhow::Result<BenchReport> {
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
    let observation: ActiveWorkerObservation =
        serde_json::from_slice(&output.stdout).context("decode candidate worker report")?;
    anyhow::ensure!(
        observation.protocol == "agentSafeActiveCoveredWorkerV1",
        "candidate worker did not attest the active covered protocol"
    );
    Ok(observation.report)
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
            let baseline = (metric.value)(&pair.baseline);
            let candidate = (metric.value)(&pair.candidate_active_covered);
            anyhow::ensure!(baseline > 0.0, "baseline {} is not positive", metric.name);
            Ok(match metric.direction {
                Direction::Latency => 100.0 * (candidate / baseline - 1.0),
                Direction::Throughput => 100.0 * (1.0 - candidate / baseline),
            })
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
}
