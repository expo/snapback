//! Dated profile-bearing comparison for LLP 0162 Acceptance 13.
//!
//! @ref LLP 0162#measurement-gate — compare eleven fresh-fixture candidate
//! runs with the registered step-0 baseline. The current historical baseline
//! cannot form experimental pairs, so the runner retains ordinal-zipped ratios
//! and a deterministic 90% bootstrap only as explicitly unqualified evidence.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use anyhow::Context;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use snapback_tools::bench::{BenchConfig, BenchReport, IdleObservation, measure_idle, run};

const RECORDED_RUNS: usize = 11;
const IDLE_RECORDED_RUNS: usize = 11;
const IDLE_SAMPLE_SECONDS: u64 = 5;
const BOOTSTRAP_SAMPLES: usize = 20_000;
const DEFAULT_BASELINE: &str =
    "tests/acceptance/fixtures/agent-safe-storage/performance-baseline.2026-08-03.v1.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Artifact {
    schema_version: &'static str,
    artifact_name: &'static str,
    date: &'static str,
    baseline_artifact_name: String,
    baseline_artifact_sha256: String,
    source: Source,
    hardware_class: HardwareClass,
    protocol: Protocol,
    raw_runs: Vec<BenchReport>,
    summary: BTreeMap<String, Statistics>,
    idle_observations: Vec<IdleObservation>,
    paired_comparisons: Vec<PairedComparison>,
    idle_gates: IdleGates,
    verdict: Verdict,
    claim_boundary: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    revision: String,
    dirty: bool,
    dirty_paths: Vec<String>,
    profile_changes_present: bool,
    build_profile: &'static str,
    rustc_version: String,
    cargo_version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HardwareClass {
    os: String,
    architecture: String,
    model: String,
    cpu: String,
    logical_cpus: usize,
    memory_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Protocol {
    recorded_runs: usize,
    whole_run_warmups: usize,
    per_metric_warmups: usize,
    idle_recorded_runs: usize,
    idle_sample_seconds: u64,
    paired_estimator: &'static str,
    bootstrap_samples: usize,
    bootstrap_seed: &'static str,
    confidence_interval_percent: u8,
    read_equivalence_bound_percent: f64,
    mutation_regression_bound_percent: f64,
    idle_cpu_resolution_us: u64,
    idle_rss_equivalence_bound_percent: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Statistics {
    median: f64,
    mad: f64,
    min: f64,
    max: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairedComparison {
    metric: &'static str,
    direction: &'static str,
    bound_kind: &'static str,
    bound_percent: f64,
    baseline_median: f64,
    candidate_median: f64,
    paired_regressions_percent: Vec<f64>,
    paired_median_regression_percent: f64,
    bootstrap_90_percent_lower: f64,
    bootstrap_90_percent_upper: f64,
    passed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IdleGates {
    cpu_max_observed_us: u64,
    cpu_resolution_us: u64,
    cpu_passed: bool,
    baseline_rss_median_kb: f64,
    candidate_rss_median_kb: f64,
    rss_regression_percent: f64,
    rss_equivalence_bound_percent: f64,
    rss_passed: bool,
    every_output_block_count_zero: bool,
    every_database_family_delta_zero: bool,
    disk_passed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Verdict {
    passed: bool,
    protocol_qualified: bool,
    failed_metrics: Vec<String>,
    note: &'static str,
}

#[derive(Clone, Copy)]
enum Direction {
    Latency,
    Throughput,
}

struct Metric {
    json_name: &'static str,
    report_value: fn(&BenchReport) -> f64,
    direction: Direction,
    bound_kind: &'static str,
    bound: f64,
}

fn main() -> anyhow::Result<()> {
    anyhow::ensure!(
        !cfg!(debug_assertions),
        "candidate evidence must be produced by a --release binary"
    );
    let (baseline_path, output_path) = arguments()?;
    ensure_machine_quiescent()?;
    let baseline_bytes = std::fs::read(&baseline_path)
        .with_context(|| format!("read baseline {}", baseline_path.display()))?;
    let baseline_sha256 = format!("{:x}", Sha256::digest(&baseline_bytes));
    let baseline: Value = serde_json::from_slice(&baseline_bytes)?;
    validate_baseline(&baseline)?;
    let hardware = hardware_class();
    validate_hardware(&baseline, &hardware)?;

    let config = BenchConfig::agent_safe_step0();
    run(&config)?;
    let mut raw_runs = Vec::with_capacity(RECORDED_RUNS);
    for _ in 0..RECORDED_RUNS {
        raw_runs.push(run(&config)?);
    }
    let mut idle_observations = Vec::with_capacity(IDLE_RECORDED_RUNS);
    for _ in 0..IDLE_RECORDED_RUNS {
        idle_observations.push(measure_idle(Duration::from_secs(IDLE_SAMPLE_SECONDS))?);
    }

    let metrics = gated_metrics();
    let paired_comparisons = metrics
        .iter()
        .map(|metric| compare_metric(&baseline, &raw_runs, metric))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let idle_gates = compare_idle(&baseline, &idle_observations)?;
    let mut failed_metrics = paired_comparisons
        .iter()
        .filter(|comparison| !comparison.passed)
        .map(|comparison| comparison.metric.to_owned())
        .collect::<Vec<_>>();
    if !idle_gates.cpu_passed {
        failed_metrics.push("idleCpu".to_owned());
    }
    if !idle_gates.rss_passed {
        failed_metrics.push("idleRss".to_owned());
    }
    if !idle_gates.disk_passed {
        failed_metrics.push("idleDisk".to_owned());
    }
    // The step-0 artifact predates the candidate, so equal ordinals are not
    // experimental pairs. Preserve the arithmetic as exploratory evidence,
    // but refuse a qualified LLP 0162 row-13 verdict until a driver records
    // matched/interleaved baseline and candidate observations.
    failed_metrics.push("experimentalPairing".to_owned());

    let artifact = Artifact {
        schema_version: "snapback.agent-safe-candidate.v1",
        artifact_name: "agent-safe-profile-candidate-2026-08-03",
        date: "2026-08-03",
        baseline_artifact_name: baseline["artifactName"]
            .as_str()
            .unwrap_or("unknown")
            .to_owned(),
        baseline_artifact_sha256: baseline_sha256,
        source: Source {
            revision: snapback_kernel::identity::git_commit().to_owned(),
            dirty: snapback_kernel::identity::git_dirty(),
            dirty_paths: git_dirty_paths(),
            profile_changes_present: true,
            build_profile: "release",
            rustc_version: command(&["rustc", "--version"]),
            cargo_version: command(&["cargo", "--version"]),
        },
        hardware_class: hardware,
        protocol: Protocol {
            recorded_runs: RECORDED_RUNS,
            whole_run_warmups: 1,
            per_metric_warmups: 4,
            idle_recorded_runs: IDLE_RECORDED_RUNS,
            idle_sample_seconds: IDLE_SAMPLE_SECONDS,
            paired_estimator: "median of 11 ordinal-zipped historical/candidate regression percentages (exploratory only; not experimental pairs)",
            bootstrap_samples: BOOTSTRAP_SAMPLES,
            bootstrap_seed: "snapback-agent-safe-candidate-v1/2026-08-03",
            confidence_interval_percent: 90,
            read_equivalence_bound_percent: 5.0,
            mutation_regression_bound_percent: 15.0,
            idle_cpu_resolution_us: 5_000,
            idle_rss_equivalence_bound_percent: 5.0,
        },
        summary: summarize(&raw_runs, &idle_observations),
        raw_runs,
        idle_observations,
        paired_comparisons,
        idle_gates,
        verdict: Verdict {
            passed: false,
            protocol_qualified: false,
            failed_metrics,
            note: "The arithmetic thresholds are exploratory only: historical and candidate observations were not experimentally paired. A digest-bound matched/interleaved run, novel-operation bounds, and every correctness corpus remain independent gates.",
        },
        claim_boundary: "unqualified exploratory evidence only; it is not an LLP 0162 Acceptance 13 pass, does not accept LLP 0163-0165, and advertises no capability",
    };
    let mut json = serde_json::to_string_pretty(&artifact)?;
    json.push('\n');
    std::fs::write(&output_path, json)
        .with_context(|| format!("write candidate {}", output_path.display()))?;
    println!("{}", output_path.display());
    Ok(())
}

fn arguments() -> anyhow::Result<(PathBuf, PathBuf)> {
    let mut baseline = PathBuf::from(DEFAULT_BASELINE);
    let mut output = None;
    let mut arguments = std::env::args_os().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == "--baseline" {
            baseline = arguments
                .next()
                .map(PathBuf::from)
                .ok_or_else(|| anyhow::anyhow!("--baseline requires a path"))?;
        } else if argument == "--output" {
            output = Some(
                arguments
                    .next()
                    .map(PathBuf::from)
                    .ok_or_else(|| anyhow::anyhow!("--output requires a path"))?,
            );
        } else {
            anyhow::bail!("usage: snapback-agent-safe-candidate [--baseline PATH] --output PATH");
        }
    }
    Ok((
        baseline,
        output.ok_or_else(|| anyhow::anyhow!("--output requires a path"))?,
    ))
}

fn validate_baseline(baseline: &Value) -> anyhow::Result<()> {
    anyhow::ensure!(
        baseline["schemaVersion"] == "snapback.agent-safe-step0-baseline.v1",
        "baseline has the wrong schemaVersion"
    );
    anyhow::ensure!(
        baseline["rawRuns"].as_array().map(Vec::len) == Some(RECORDED_RUNS),
        "baseline must contain exactly eleven raw runs"
    );
    anyhow::ensure!(
        baseline["idleObservations"].as_array().map(Vec::len) == Some(IDLE_RECORDED_RUNS),
        "baseline must contain exactly eleven idle observations"
    );
    Ok(())
}

fn validate_hardware(baseline: &Value, current: &HardwareClass) -> anyhow::Result<()> {
    let expected = &baseline["hardwareClass"];
    anyhow::ensure!(
        expected["architecture"] == current.architecture,
        "architecture differs from baseline"
    );
    anyhow::ensure!(
        expected["model"] == current.model,
        "machine model differs from baseline"
    );
    anyhow::ensure!(expected["cpu"] == current.cpu, "CPU differs from baseline");
    anyhow::ensure!(
        expected["logicalCpus"] == current.logical_cpus,
        "logical CPU count differs from baseline"
    );
    anyhow::ensure!(
        expected["memoryBytes"] == current.memory_bytes,
        "memory size differs from baseline"
    );
    Ok(())
}

fn gated_metrics() -> [Metric; 9] {
    [
        Metric {
            json_name: "current_point_read_p50_us",
            report_value: |r| r.current_point_read_p50_us,
            direction: Direction::Latency,
            bound_kind: "twoSidedEquivalence",
            bound: 5.0,
        },
        Metric {
            json_name: "current_point_read_p95_us",
            report_value: |r| r.current_point_read_p95_us,
            direction: Direction::Latency,
            bound_kind: "twoSidedEquivalence",
            bound: 5.0,
        },
        Metric {
            json_name: "current_range_read_p50_us",
            report_value: |r| r.current_range_read_p50_us,
            direction: Direction::Latency,
            bound_kind: "twoSidedEquivalence",
            bound: 5.0,
        },
        Metric {
            json_name: "current_range_read_p95_us",
            report_value: |r| r.current_range_read_p95_us,
            direction: Direction::Latency,
            bound_kind: "twoSidedEquivalence",
            bound: 5.0,
        },
        Metric {
            json_name: "current_query_plan_read_p50_us",
            report_value: |r| r.current_query_plan_read_p50_us,
            direction: Direction::Latency,
            bound_kind: "twoSidedEquivalence",
            bound: 5.0,
        },
        Metric {
            json_name: "current_query_plan_read_p95_us",
            report_value: |r| r.current_query_plan_read_p95_us,
            direction: Direction::Latency,
            bound_kind: "twoSidedEquivalence",
            bound: 5.0,
        },
        Metric {
            json_name: "single_writer_mutations_per_sec",
            report_value: |r| r.single_writer_mutations_per_sec,
            direction: Direction::Throughput,
            bound_kind: "oneSidedRegression",
            bound: 15.0,
        },
        Metric {
            json_name: "single_writer_mutation_p50_us",
            report_value: |r| r.single_writer_mutation_p50_us,
            direction: Direction::Latency,
            bound_kind: "oneSidedRegression",
            bound: 15.0,
        },
        Metric {
            json_name: "single_writer_mutation_p95_us",
            report_value: |r| r.single_writer_mutation_p95_us,
            direction: Direction::Latency,
            bound_kind: "oneSidedRegression",
            bound: 15.0,
        },
    ]
}

fn compare_metric(
    baseline: &Value,
    candidate: &[BenchReport],
    metric: &Metric,
) -> anyhow::Result<PairedComparison> {
    let baseline_runs = baseline["rawRuns"]
        .as_array()
        .context("baseline rawRuns is not an array")?;
    let baseline_values = baseline_runs
        .iter()
        .map(|run| {
            run[metric.json_name]
                .as_f64()
                .with_context(|| format!("baseline metric {} is missing", metric.json_name))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let candidate_values = candidate
        .iter()
        .map(metric.report_value)
        .collect::<Vec<_>>();
    let paired = baseline_values
        .iter()
        .zip(&candidate_values)
        .map(|(baseline, candidate)| {
            anyhow::ensure!(
                *baseline > 0.0,
                "baseline metric {} is not positive",
                metric.json_name
            );
            Ok(match metric.direction {
                Direction::Latency => 100.0 * (candidate / baseline - 1.0),
                Direction::Throughput => 100.0 * (1.0 - candidate / baseline),
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let (lower, upper) = bootstrap_median_interval(&paired);
    let passed = if metric.bound_kind == "twoSidedEquivalence" {
        lower >= -metric.bound && upper <= metric.bound
    } else {
        upper <= metric.bound
    };
    let mut baseline_sorted = baseline_values.clone();
    baseline_sorted.sort_by(f64::total_cmp);
    let mut candidate_sorted = candidate_values.clone();
    candidate_sorted.sort_by(f64::total_cmp);
    let mut paired_sorted = paired.clone();
    paired_sorted.sort_by(f64::total_cmp);
    Ok(PairedComparison {
        metric: metric.json_name,
        direction: match metric.direction {
            Direction::Latency => "higherIsWorse",
            Direction::Throughput => "lowerIsWorse",
        },
        bound_kind: metric.bound_kind,
        bound_percent: metric.bound,
        baseline_median: median(&baseline_sorted),
        candidate_median: median(&candidate_sorted),
        paired_regressions_percent: paired,
        paired_median_regression_percent: median(&paired_sorted),
        bootstrap_90_percent_lower: lower,
        bootstrap_90_percent_upper: upper,
        passed,
    })
}

fn bootstrap_median_interval(values: &[f64]) -> (f64, f64) {
    let mut state = 0x7e57_0162_2026_0803_u64;
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

fn compare_idle(baseline: &Value, candidate: &[IdleObservation]) -> anyhow::Result<IdleGates> {
    let baseline_idle = baseline["idleObservations"]
        .as_array()
        .context("baseline idleObservations is not an array")?;
    let mut baseline_rss = baseline_idle
        .iter()
        .map(|row| {
            row["residentKbBefore"]
                .as_f64()
                .context("baseline residentKbBefore is missing")
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    baseline_rss.sort_by(f64::total_cmp);
    let mut candidate_rss = candidate
        .iter()
        .map(|row| row.resident_kb_before)
        .collect::<Vec<_>>();
    candidate_rss.sort_by(f64::total_cmp);
    let baseline_rss_median = median(&baseline_rss);
    let candidate_rss_median = median(&candidate_rss);
    let rss_regression_percent = 100.0 * (candidate_rss_median / baseline_rss_median - 1.0);
    let cpu_max_observed_us = candidate
        .iter()
        .map(|row| row.cpu_user_us.saturating_add(row.cpu_system_us))
        .max()
        .unwrap_or(0);
    let every_output_block_count_zero =
        candidate.iter().all(|row| row.output_block_operations == 0);
    let every_database_family_delta_zero = candidate
        .iter()
        .all(|row| row.database_family_bytes_before == row.database_family_bytes_after);
    Ok(IdleGates {
        cpu_max_observed_us,
        cpu_resolution_us: 5_000,
        cpu_passed: cpu_max_observed_us <= 5_000,
        baseline_rss_median_kb: baseline_rss_median,
        candidate_rss_median_kb: candidate_rss_median,
        rss_regression_percent,
        rss_equivalence_bound_percent: 5.0,
        rss_passed: rss_regression_percent.abs() <= 5.0,
        every_output_block_count_zero,
        every_database_family_delta_zero,
        disk_passed: every_output_block_count_zero && every_database_family_delta_zero,
    })
}

type BenchMetric = (&'static str, fn(&BenchReport) -> f64);

fn summarize(runs: &[BenchReport], idle: &[IdleObservation]) -> BTreeMap<String, Statistics> {
    let metrics: [BenchMetric; 17] = [
        ("currentPointReadP50Us", |r| r.current_point_read_p50_us),
        ("currentPointReadP95Us", |r| r.current_point_read_p95_us),
        ("currentRangeReadP50Us", |r| r.current_range_read_p50_us),
        ("currentRangeReadP95Us", |r| r.current_range_read_p95_us),
        ("currentQueryPlanReadP50Us", |r| {
            r.current_query_plan_read_p50_us
        }),
        ("currentQueryPlanReadP95Us", |r| {
            r.current_query_plan_read_p95_us
        }),
        ("singleWriterMutationsPerSec", |r| {
            r.single_writer_mutations_per_sec
        }),
        ("singleWriterMutationP50Us", |r| {
            r.single_writer_mutation_p50_us
        }),
        ("singleWriterMutationP95Us", |r| {
            r.single_writer_mutation_p95_us
        }),
        ("allocatedWriteBytesPerChangedRow", |r| {
            r.allocated_write_bytes_per_changed_row as f64
        }),
        ("allocatedWriteBytesPerOperation", |r| {
            r.allocated_write_bytes_per_operation as f64
        }),
        ("retainedBytesPerChangedRow", |r| {
            r.retained_bytes_per_changed_row as f64
        }),
        ("retainedBytesPerOperation", |r| {
            r.retained_bytes_per_operation as f64
        }),
        ("matcherSkipUsPerSub", |r| r.matcher_skip_us_per_sub),
        ("fanoutUsPerAffectedSub", |r| r.fanout_us_per_affected_sub),
        ("readSetValidationUsPerDep", |r| {
            r.read_set_validation_us_per_dep
        }),
        ("vmCostUs", |r| r.vm_cost_us),
    ];
    let mut summary = metrics
        .into_iter()
        .map(|(name, get)| (name.to_owned(), statistics(runs.iter().map(get).collect())))
        .collect::<BTreeMap<_, _>>();
    for (name, values) in [
        (
            "idleCpuUserUs",
            idle.iter().map(|r| r.cpu_user_us as f64).collect(),
        ),
        (
            "idleCpuSystemUs",
            idle.iter().map(|r| r.cpu_system_us as f64).collect(),
        ),
        (
            "idleOutputBlockOperations",
            idle.iter()
                .map(|r| r.output_block_operations as f64)
                .collect(),
        ),
        (
            "idleResidentDeltaKb",
            idle.iter()
                .map(|r| r.resident_kb_after - r.resident_kb_before)
                .collect(),
        ),
        (
            "idleDatabaseFamilyDeltaBytes",
            idle.iter()
                .map(|r| {
                    r.database_family_bytes_after as f64 - r.database_family_bytes_before as f64
                })
                .collect(),
        ),
    ] {
        summary.insert(name.to_owned(), statistics(values));
    }
    summary
}

fn statistics(mut values: Vec<f64>) -> Statistics {
    values.sort_by(f64::total_cmp);
    let median_value = median(&values);
    let mut deviations = values
        .iter()
        .map(|value| (value - median_value).abs())
        .collect::<Vec<_>>();
    deviations.sort_by(f64::total_cmp);
    Statistics {
        median: median_value,
        mad: median(&deviations),
        min: values.first().copied().unwrap_or(0.0),
        max: values.last().copied().unwrap_or(0.0),
    }
}

fn median(sorted: &[f64]) -> f64 {
    match sorted.len() {
        0 => 0.0,
        len if len % 2 == 1 => sorted[len / 2],
        len => (sorted[len / 2 - 1] + sorted[len / 2]) / 2.0,
    }
}

fn hardware_class() -> HardwareClass {
    HardwareClass {
        os: command(&["sw_vers", "-productVersion"]),
        architecture: std::env::consts::ARCH.to_owned(),
        model: sysctl("hw.model"),
        cpu: sysctl("machdep.cpu.brand_string"),
        logical_cpus: std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(0),
        memory_bytes: sysctl("hw.memsize").parse().unwrap_or(0),
    }
}

fn sysctl(name: &str) -> String {
    command(&["sysctl", "-n", name])
}

fn command(arguments: &[&str]) -> String {
    let Some((program, arguments)) = arguments.split_first() else {
        return "unknown".to_owned();
    };
    Command::new(program)
        .args(arguments)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown".to_owned())
}

fn git_dirty_paths() -> Vec<String> {
    Command::new("git")
        .args(["status", "--porcelain=v1", "--untracked-files=all"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.split_whitespace().last())
        .map(ToOwned::to_owned)
        .collect()
}

fn ensure_machine_quiescent() -> anyhow::Result<()> {
    let output = Command::new("ps").args(["-Ao", "pid=,command="]).output()?;
    anyhow::ensure!(
        output.status.success(),
        "could not inspect competing processes"
    );
    let processes = String::from_utf8(output.stdout)?;
    let own_pid = std::process::id();
    // SAFETY: `getppid` has no pointer arguments or preconditions.
    let launcher_pid = unsafe { libc::getppid() as u32 };
    let blockers = processes
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let (pid, command) = line.split_once(char::is_whitespace)?;
            let pid = pid.parse::<u32>().ok()?;
            (pid != own_pid
                && pid != launcher_pid
                && (command.contains("/cargo ")
                    || command.ends_with("/cargo")
                    || command.contains("/rustc ")
                    || command.ends_with("/rustc")))
            .then(|| line.to_owned())
        })
        .collect::<Vec<_>>();
    anyhow::ensure!(
        blockers.is_empty(),
        "candidate comparison requires an uncontended build machine; competing processes: {}",
        blockers.join("; ")
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_bootstrap_interval_is_stable() {
        let values = [-2.0, -1.0, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
        let first = bootstrap_median_interval(&values);
        assert_eq!(first, bootstrap_median_interval(&values));
        assert!(first.0 <= 1.5 && first.1 >= 1.5);
    }
}
