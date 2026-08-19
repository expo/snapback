//! Dated, statistically controlled pre-profile baseline for LLP 0162 step 0.
//!
//! @ref LLP 0162#measurement-gate — a named pre-profile artifact with fixed
//!   hardware/fixtures, warm-up, run count, estimator/spread, and formulas.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use serde::Serialize;
use snapback_tools::bench::{BenchConfig, BenchReport, IdleObservation, measure_idle, run};

const RECORDED_RUNS: usize = 11;
const IDLE_RECORDED_RUNS: usize = 11;
const IDLE_SAMPLE_SECONDS: u64 = 5;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Artifact {
    schema_version: &'static str,
    artifact_name: &'static str,
    date: &'static str,
    source: Source,
    hardware_class: HardwareClass,
    fixture: Fixture,
    protocol: Protocol,
    raw_runs: Vec<BenchReport>,
    summary: BTreeMap<String, Statistics>,
    idle_observations: Vec<IdleObservation>,
    claim_boundary: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    revision: String,
    dirty: bool,
    dirty_paths: Vec<String>,
    baseline_source_posture: &'static str,
    profile_changes_present: bool,
    build_profile: &'static str,
    rustc_version: String,
    cargo_version: String,
}

#[derive(Serialize)]
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
struct Fixture {
    recorded_runs: usize,
    whole_run_warmups: usize,
    per_metric_warmups: usize,
    iterations_per_compute_metric: usize,
    subscriptions: usize,
    read_set_size: usize,
    conflict_trials: usize,
    ephemeral_publishes: usize,
    current_read_rows: usize,
    current_range_limit: usize,
    idle_recorded_runs: usize,
    idle_sample_seconds: u64,
    idle_total_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Protocol {
    estimator: &'static str,
    spread: &'static str,
    comparison_interval: &'static str,
    latency_regression_formula: &'static str,
    throughput_regression_formula: &'static str,
    read_equivalence_bound_percent: f64,
    mutation_regression_bound_percent: f64,
    idle_cpu_resolution_us: u64,
    idle_rss_equivalence_bound_percent: f64,
    idle_disk_write_rule: &'static str,
    bytes_metric_definition: &'static str,
    novel_operation_rule: &'static str,
    crash_reopen_rule: &'static str,
    quiescence_rule: &'static str,
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
    let output_path = output_path()?;
    ensure_machine_quiescent()?;
    let config = BenchConfig::agent_safe_step0();
    // One complete unrecorded run absorbs process-wide runtime/cache startup.
    // Every individual metric also performs four fixture-local warm-ups.
    run(&config)?;
    let mut raw_runs = Vec::with_capacity(RECORDED_RUNS);
    for _ in 0..RECORDED_RUNS {
        raw_runs.push(run(&config)?);
    }
    let mut idle_observations = Vec::with_capacity(IDLE_RECORDED_RUNS);
    for _ in 0..IDLE_RECORDED_RUNS {
        idle_observations.push(measure_idle(Duration::from_secs(IDLE_SAMPLE_SECONDS))?);
    }

    let artifact = Artifact {
        schema_version: "snapback.agent-safe-step0-baseline.v1",
        artifact_name: "agent-safe-step0-pre-profile-2026-08-03",
        date: "2026-08-03",
        source: Source {
            revision: option_env!("SNAPBACK_BUILD_GIT_COMMIT")
                .unwrap_or("unknown")
                .to_owned(),
            dirty: matches!(option_env!("SNAPBACK_BUILD_GIT_DIRTY"), Some("true")),
            dirty_paths: git_dirty_paths(),
            baseline_source_posture: "pinned pre-profile source revision plus only the three listed step-0 instrumentation paths",
            profile_changes_present: false,
            build_profile: "release",
            rustc_version: command(&["rustc", "--version"]),
            cargo_version: command(&["cargo", "--version"]),
        },
        hardware_class: HardwareClass {
            os: command(&["sw_vers", "-productVersion"]),
            architecture: std::env::consts::ARCH.to_owned(),
            model: sysctl("hw.model"),
            cpu: sysctl("machdep.cpu.brand_string"),
            logical_cpus: std::thread::available_parallelism()
                .map(usize::from)
                .unwrap_or(0),
            memory_bytes: sysctl("hw.memsize").parse().unwrap_or(0),
        },
        fixture: Fixture {
            recorded_runs: RECORDED_RUNS,
            whole_run_warmups: 1,
            per_metric_warmups: 4,
            iterations_per_compute_metric: config.iterations,
            subscriptions: config.subscriptions,
            read_set_size: config.read_set_size,
            conflict_trials: config.conflict_trials,
            ephemeral_publishes: config.ephemeral_publishes,
            current_read_rows: 512,
            current_range_limit: 50,
            idle_recorded_runs: IDLE_RECORDED_RUNS,
            idle_sample_seconds: IDLE_SAMPLE_SECONDS,
            idle_total_seconds: IDLE_RECORDED_RUNS as u64 * IDLE_SAMPLE_SECONDS,
        },
        protocol: Protocol {
            estimator: "median of 11 fresh-fixture runs",
            spread: "median absolute deviation (MAD), with min/max retained",
            comparison_interval: "paired candidate/baseline run ratios; deterministic bootstrap over the 11 paired ratios; 90% interval must lie wholly inside the registered bound",
            latency_regression_formula: "100 * (candidateMedian - baselineMedian) / baselineMedian",
            throughput_regression_formula: "100 * (baselineMedian - candidateMedian) / baselineMedian",
            read_equivalence_bound_percent: 5.0,
            mutation_regression_bound_percent: 15.0,
            idle_cpu_resolution_us: 5_000,
            idle_rss_equivalence_bound_percent: 5.0,
            idle_disk_write_rule: "candidate outputBlockOperations must remain 0 and databaseFamilyBytesAfter must equal databaseFamilyBytesBefore",
            bytes_metric_definition: "allocated = database + WAL + SHM file-family growth while one row/operation remains open; retained = database-family growth after close/checkpoint",
            novel_operation_rule: "fork creation/diff/promotion/reap have no honest pre-profile product comparator; their first implementation records absolute latency and cannot advertise until a dated bound is ratified beside this artifact",
            crash_reopen_rule: "correctness-only cut matrices: no pre-profile envelope/publication/promotion/effect-settlement boundaries exist; each candidate component must pass its named crash/reopen corpus before advertisement",
            quiescence_rule: "the runner refuses while any other cargo or rustc process is present; recorded runs start only after this build-process preflight passes",
        },
        summary: summarize(&raw_runs, &idle_observations),
        raw_runs,
        idle_observations,
        claim_boundary: "baseline evidence only; every LLP 0162/0163 capability remains Missing",
    };
    let mut json = serde_json::to_string_pretty(&artifact)?;
    json.push('\n');
    if let Some(path) = output_path {
        std::fs::write(path, json)?;
    } else {
        print!("{json}");
    }
    Ok(())
}

fn output_path() -> anyhow::Result<Option<PathBuf>> {
    let mut arguments = std::env::args_os().skip(1);
    let Some(argument) = arguments.next() else {
        return Ok(None);
    };
    anyhow::ensure!(
        argument == "--output",
        "usage: snapback-agent-safe-step0 [--output PATH]"
    );
    let path = arguments
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("--output requires a path"))?;
    anyhow::ensure!(
        arguments.next().is_none(),
        "usage: snapback-agent-safe-step0 [--output PATH]"
    );
    Ok(Some(path))
}

type BenchMetric = (&'static str, fn(&BenchReport) -> f64);

fn summarize(runs: &[BenchReport], idle: &[IdleObservation]) -> BTreeMap<String, Statistics> {
    let metrics: [BenchMetric; 20] = [
        ("currentPointReadP50Us", |run| run.current_point_read_p50_us),
        ("currentPointReadP95Us", |run| run.current_point_read_p95_us),
        ("currentRangeReadP50Us", |run| run.current_range_read_p50_us),
        ("currentRangeReadP95Us", |run| run.current_range_read_p95_us),
        ("currentQueryPlanReadP50Us", |run| {
            run.current_query_plan_read_p50_us
        }),
        ("currentQueryPlanReadP95Us", |run| {
            run.current_query_plan_read_p95_us
        }),
        ("singleWriterMutationsPerSec", |run| {
            run.single_writer_mutations_per_sec
        }),
        ("singleWriterMutationP50Us", |run| {
            run.single_writer_mutation_p50_us
        }),
        ("singleWriterMutationP95Us", |run| {
            run.single_writer_mutation_p95_us
        }),
        ("matcherSkipUsPerSub", |run| run.matcher_skip_us_per_sub),
        ("fanoutUsPerAffectedSub", |run| {
            run.fanout_us_per_affected_sub
        }),
        ("fanoutCeilingSubsAt10ms", |run| {
            run.fanout_ceiling_subs_at_10ms
        }),
        ("readSetValidationUsPerDep", |run| {
            run.read_set_validation_us_per_dep
        }),
        ("allocatedWriteBytesPerChangedRow", |run| {
            run.allocated_write_bytes_per_changed_row as f64
        }),
        ("allocatedWriteBytesPerOperation", |run| {
            run.allocated_write_bytes_per_operation as f64
        }),
        ("retainedBytesPerChangedRow", |run| {
            run.retained_bytes_per_changed_row as f64
        }),
        ("retainedBytesPerOperation", |run| {
            run.retained_bytes_per_operation as f64
        }),
        ("vmCostUs", |run| run.vm_cost_us),
        ("readDuringWriteViaLockUs", |run| {
            run.read_during_write_via_lock_us
        }),
        ("readDuringWriteViaReadLaneUs", |run| {
            run.read_during_write_via_read_lane_us
        }),
    ];
    let mut summary = metrics
        .into_iter()
        .map(|(name, get)| {
            let values = runs.iter().map(get).collect::<Vec<_>>();
            (name.to_owned(), statistics(values))
        })
        .collect::<BTreeMap<_, _>>();
    for (name, values) in [
        (
            "idleCpuUserUs",
            idle.iter().map(|run| run.cpu_user_us as f64).collect(),
        ),
        (
            "idleCpuSystemUs",
            idle.iter().map(|run| run.cpu_system_us as f64).collect(),
        ),
        (
            "idleOutputBlockOperations",
            idle.iter()
                .map(|run| run.output_block_operations as f64)
                .collect(),
        ),
        (
            "idleResidentDeltaKb",
            idle.iter()
                .map(|run| run.resident_kb_after - run.resident_kb_before)
                .collect(),
        ),
        (
            "idleDatabaseFamilyDeltaBytes",
            idle.iter()
                .map(|run| {
                    run.database_family_bytes_after as f64 - run.database_family_bytes_before as f64
                })
                .collect(),
        ),
    ] {
        summary.insert(name.to_owned(), statistics(values));
    }
    summary
}

fn statistics(mut values: Vec<f64>) -> Statistics {
    values.sort_by(|left, right| left.total_cmp(right));
    let median_value = median(&values);
    let mut deviations = values
        .iter()
        .map(|value| (value - median_value).abs())
        .collect::<Vec<_>>();
    deviations.sort_by(|left, right| left.total_cmp(right));
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
    command(&["git", "status", "--porcelain=v1", "--untracked-files=all"])
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
    // SAFETY: `getppid` has no pointer arguments or preconditions. Cargo is
    // allowed to be the direct launcher after it has finished compilation.
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
        "step-0 baseline requires an uncontended build machine; competing processes: {}",
        blockers.join("; ")
    );
    Ok(())
}
