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
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use rusqlite::{Connection, Transaction, TransactionBehavior, params};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use snapback::branches::{BranchId, ChildStreamId, MaterializedBase};
use snapback::commit_envelope::{
    IdentityEpochStateV1, IdentityEpochV1, OperationBoundFactsV1, OperationIdentityV1,
    OperationIssuanceV1, OperationKeyV1, OperationOriginatorClassV1, derive_host_operation_id,
};
use snapback::diagnostic::SnapbackResult;
use snapback::fork_promotion::{
    ApprovedOperationFactsV1, BranchGrantV1, BranchLimitsV1, BranchOperationDraftV1,
    BranchOperationV1, CanonicalAdmissionV1, ForkCoverageV1, ForkEgressPolicyV1,
    InAppBranchCreateV1, LogicalWriteFactV1, PromotionApprovalV1, PromotionAuthorityDecisionV1,
    PromotionContentionPolicyV1, PromotionReplayContextV1, PromotionSealKey, ReplayCustodyClassV1,
    RetainedReplayInputV1, SnapshotRowV1, canonical_mutation_admission, create_in_app_branch,
    exact_fork_diff, execute_branch_operation, issue_promotion_ticket, promote_by_reexecution,
    reap_expired_in_app_branches, request_head_reservation, seal_promotion_request,
};

const RECORDED_RUNS: usize = 11;
const LOCAL_WARMUPS: usize = 4;
const ROWS: usize = 512;
const CONTENTION_SAMPLES: usize = 128;
const CONTENTION_WORKERS: usize = 8;
const FORK_CREATION_MEDIAN_BOUND_US: f64 = 1_000.0;
const EXACT_DIFF_MEDIAN_BOUND_US: f64 = 2_500.0;
const PROMOTION_MEDIAN_BOUND_US: f64 = 7_500.0;
const TTL_REAP_MEDIAN_BOUND_US: f64 = 250.0;
const ORDINARY_WRITER_CONTENTION_P99_BOUND_US: f64 = 750_000.0;

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Run {
    fork_creation_us: f64,
    exact_diff_us: f64,
    promotion_us: f64,
    ttl_reap_us: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentionEvidence {
    metric: &'static str,
    sample_definition: &'static str,
    reservation_interval_ms: u64,
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
    let source_revision = checked_command(&["git", "rev-parse", "HEAD"])?;
    if source_revision != expected_revision {
        bail!(
            "benchmark revision mismatch: expected {expected_revision}, checked out {source_revision}"
        );
    }
    let dirty = checked_command(&["git", "status", "--porcelain", "--untracked-files=all"])?;
    if !dirty.is_empty() {
        bail!("benchmark requires a clean tracked source tree; found:\n{dirty}");
    }
    let baseline_bytes = std::fs::read(&baseline_path)
        .with_context(|| format!("read baseline artifact {}", baseline_path.display()))?;
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
            sha256: format!("sha256:{:x}", Sha256::digest(&baseline_bytes)),
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
        bound_ratification: "Ratified by Charlie Cheever in LLP 0162's dated 2026-08-04 absolute-bound record before this final run",
        claim_boundary: "instrumentation evidence only; fork and promotion capabilities remain Missing",
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

fn digest_file(path: &std::path::Path) -> anyhow::Result<String> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("read executable for digest {}", path.display()))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn run_once(seed: u64) -> anyhow::Result<Run> {
    let now = 1_000_000 + seed as i64 * 100;
    let mut canonical = source()?;
    let create = create_request(seed, 9, 9, now);
    let started = Instant::now();
    create_in_app_branch(&mut canonical, &create).context("create benchmark branch")?;
    let mut workspace = MaterializedBase::materialize(&canonical, None)?;
    let fork_creation_us = micros(started);

    let operation = draft(seed, &create.child_stream_id.0);
    execute_branch_operation(
        &mut workspace.conn,
        &create.branch_id,
        &operation,
        now + 1,
        rename,
    )
    .context("execute benchmark branch operation")?;
    let started = Instant::now();
    let diff = exact_fork_diff(&workspace, &create.branch_id, scan_widgets)
        .context("compute benchmark fork diff")?;
    let exact_diff_us = micros(started);

    let aggregate = identity("canonical", &format!("promotion-{seed}"), "widgets.rename");
    let ticket = issue_promotion_ticket(
        &mut canonical,
        aggregate.clone(),
        &create.branch_id,
        "canonical",
        1,
        now + 60_000,
        now + 2,
        PromotionContentionPolicyV1 {
            reservation_after_losses: 2,
            reservation_interval_ms: 1_000,
            reservation_quota: 1,
            maximum_commit_duration_ms: 500,
        },
    )
    .context("issue benchmark promotion ticket")?;
    let key = PromotionSealKey::from_server_secret([0x42; 32])?;
    let request = seal_promotion_request(
        &workspace,
        &diff,
        PromotionApprovalV1 {
            approver_principal_id: "bench-principal".to_owned(),
            approver_grant_id: "bench-grant".to_owned(),
            authority_fingerprint: sha('d'),
            approved_at_ms: now + 3,
            expires_at_ms: now + 50_000,
        },
        ticket,
        aggregate,
        &sha('f'),
        &key,
        now + 3,
    )
    .context("seal benchmark promotion request")?;
    let started = Instant::now();
    promote_by_reexecution(
        &mut canonical,
        &workspace,
        &diff,
        &request,
        &key,
        &PromotionAuthorityDecisionV1::Revalidated {
            grant_id: "bench-grant".to_owned(),
            authority_fingerprint: sha('d'),
        },
        now + 4,
        &sha('f'),
        rename_replay,
    )
    .context("promote benchmark branch")?;
    let promotion_us = micros(started);

    let reap = create_request(seed, 10, 10, now);
    create_in_app_branch(&mut canonical, &reap).context("create benchmark reap branch")?;
    let started = Instant::now();
    reap_expired_in_app_branches(&mut canonical, now + 30_000).context("reap benchmark branch")?;
    let ttl_reap_us = micros(started);

    Ok(Run {
        fork_creation_us,
        exact_diff_us,
        promotion_us,
        ttl_reap_us,
    })
}

fn source() -> anyhow::Result<Connection> {
    initialize_source(Connection::open_in_memory()?)
}

fn source_at(path: &std::path::Path) -> anyhow::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    initialize_source(conn)
}

fn initialize_source(mut conn: Connection) -> anyhow::Result<Connection> {
    conn.execute_batch(
        "CREATE TABLE _snapback_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
         CREATE TABLE _snapback_changes (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           version INTEGER NOT NULL,
           table_name TEXT NOT NULL,
           row_id TEXT NOT NULL,
           op TEXT NOT NULL,
           row_json TEXT,
           changed_at_ms INTEGER NOT NULL
         );
         CREATE TABLE _snapback_history_policies_v1 (
           table_name TEXT PRIMARY KEY,
           retain_ms INTEGER NOT NULL,
           max_rows INTEGER NOT NULL
         );
         CREATE TABLE _snapback_record_history_v1 (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           version INTEGER NOT NULL,
           table_name TEXT NOT NULL,
           row_id TEXT NOT NULL,
           op TEXT NOT NULL,
           row_json TEXT,
           changed_at_ms INTEGER NOT NULL,
           operation_id TEXT
         );
         CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
         CREATE TABLE _snapback_contention_writes (
           id INTEGER PRIMARY KEY,
           worker INTEGER NOT NULL,
           ordinal INTEGER NOT NULL
         );
         INSERT INTO _snapback_version VALUES (1, 9);",
    )?;
    let tx = conn.transaction()?;
    for id in 1..=ROWS as i64 {
        tx.execute(
            "INSERT INTO widgets(id, name) VALUES (?1, ?2)",
            params![id, format!("widget-{id}")],
        )?;
    }
    snapback::operation_ledger::create_infra(&tx)?;
    snapback::operation_ledger::register_epoch_in(
        &tx,
        &IdentityEpochV1 {
            schema_version: 1,
            originator_class: OperationOriginatorClassV1::Host,
            audience: "bench-app".to_owned(),
            authority_instance_id: "bench-authority".to_owned(),
            epoch_id: "bench-epoch".to_owned(),
            epoch_sequence: 1,
            state: IdentityEpochStateV1::Open,
            issued_at_ms: 1,
            terminated_at_ms: None,
            authority_authenticator_digest: sha('a'),
        },
    )?;
    tx.commit()?;
    Ok(conn)
}

/// Measure the ordinary-writer tail introduced by the frozen promotion head
/// reservation. Eight real SQLite writers begin behind one production
/// reservation and then commit 128 operations through the production
/// admission gate. The nearest-rank p99 is retained with every raw sample.
///
/// @ref LLP 0162#5-promotion-stays-strict-and-merge-free — the bounded
///   reservation requires a p99 under-contention latency record.
fn measure_writer_contention() -> anyhow::Result<ContentionEvidence> {
    let directory = tempfile::tempdir().context("create contention fixture directory")?;
    let database_path = directory.path().join("contention.sqlite");
    let mut canonical = source_at(&database_path)?;
    let ticket = issue_promotion_ticket(
        &mut canonical,
        identity("canonical", "contention-ticket", "promotion.reserve"),
        &BranchId("contention-branch".to_owned()),
        "canonical",
        CONTENTION_WORKERS as u64,
        80_000,
        10_000,
        PromotionContentionPolicyV1::default(),
    )?;
    // Fixture admission starts from the exact durable state reached after the
    // production promotion loop records two consecutive CAS losses. The
    // reservation itself is requested and enforced only through production
    // APIs; this setup mutation is outside the timed interval.
    canonical.execute(
        "UPDATE _snapback_promotion_admission SET losses = ?2 WHERE ticket_id = ?1",
        params![
            ticket.ticket_identity.key.operation_id,
            ticket.contention_policy.reservation_after_losses as i64
        ],
    )?;
    let logical_start_ms = 20_000_i64;
    request_head_reservation(&canonical, &ticket, logical_start_ms)?;
    drop(canonical);

    let barrier = Arc::new(Barrier::new(CONTENTION_WORKERS));
    let wall_start = Instant::now();
    let per_worker = CONTENTION_SAMPLES / CONTENTION_WORKERS;
    let mut workers = Vec::with_capacity(CONTENTION_WORKERS);
    for worker in 0..CONTENTION_WORKERS {
        let database_path = database_path.clone();
        let barrier = barrier.clone();
        workers.push(thread::spawn(
            move || -> anyhow::Result<(bool, Vec<(f64, bool)>)> {
                let mut conn = Connection::open(database_path)?;
                conn.busy_timeout(Duration::from_secs(5))?;
                barrier.wait();
                let mut samples = Vec::with_capacity(per_worker);
                for ordinal in 0..per_worker {
                    let sample_started = Instant::now();
                    let mut was_deferred = false;
                    loop {
                        let elapsed_ms =
                            i64::try_from(wall_start.elapsed().as_millis()).unwrap_or(i64::MAX);
                        match canonical_mutation_admission(
                            &conn,
                            "canonical",
                            logical_start_ms.saturating_add(elapsed_ms),
                        )? {
                            CanonicalAdmissionV1::Admit => break,
                            CanonicalAdmissionV1::DeferredByPromotionReservation { until_ms } => {
                                was_deferred = true;
                                let now_ms = logical_start_ms.saturating_add(elapsed_ms);
                                let remaining = until_ms.saturating_sub(now_ms).max(1) as u64;
                                thread::sleep(Duration::from_millis(remaining.min(2)));
                            }
                        }
                    }
                    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                    tx.execute(
                        "INSERT INTO _snapback_contention_writes(id, worker, ordinal)
                         VALUES (?1, ?2, ?3)",
                        params![
                            (worker * per_worker + ordinal + 1) as i64,
                            worker as i64,
                            ordinal as i64
                        ],
                    )?;
                    tx.execute(
                        "UPDATE _snapback_version SET version = version + 1 WHERE id = 1",
                        [],
                    )?;
                    tx.commit()?;
                    samples.push((micros(sample_started), was_deferred));
                }
                let initial_deferred = samples.first().is_some_and(|(_, deferred)| *deferred);
                Ok((initial_deferred, samples))
            },
        ));
    }
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
    let mut sorted = samples.clone();
    sorted.sort_by(f64::total_cmp);
    Ok(ContentionEvidence {
        metric: "ordinaryWriterReservationRequestToCommitP99Us",
        sample_definition: "128 benchmark SQL writes across 8 concurrent SQLite connections; timer begins before the production canonical_mutation_admission gate and ends after the benchmark transaction COMMIT; this is reservation-gate tail cost, not the full envelope mutation path; each worker's first sample is observed deferred by one active production promotion reservation",
        reservation_interval_ms: ticket.contention_policy.reservation_interval_ms,
        p50_us: percentile(&sorted, 0.50),
        p95_us: percentile(&sorted, 0.95),
        p99_us: percentile(&sorted, 0.99),
        max_us: *sorted.last().unwrap_or(&0.0),
        raw_request_to_commit_us: samples,
        deferred_sample_count,
        initial_deferred_worker_count,
    })
}

fn percentile(sorted: &[f64], quantile: f64) -> f64 {
    let rank = (quantile * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len().saturating_sub(1))]
}

fn create_request(seed: u64, ordinal: u64, base_version: u64, now: i64) -> InAppBranchCreateV1 {
    InAppBranchCreateV1 {
        schema_version: 1,
        branch_id: BranchId(format!("bench-branch-{seed}-{ordinal}")),
        child_stream_id: ChildStreamId(format!("bench-child-{seed}-{ordinal}")),
        base_stream: "canonical".to_owned(),
        base_version,
        grant: BranchGrantV1 {
            principal_id: "bench-principal".to_owned(),
            grant_id: "bench-grant".to_owned(),
            audience: "bench-app".to_owned(),
            authority_fingerprint: sha('d'),
            allowed_functions: vec!["widgets.rename".to_owned()],
            allowed_lanes: vec!["ordinaryMutation".to_owned()],
            expires_at_ms: now + 60_000,
        },
        limits: BranchLimitsV1 {
            max_live_branches_per_principal: 8,
            max_live_branches_per_app: 8,
            max_operations: 8,
            max_retained_bytes: 128 * 1024,
            max_diff_rows: 16,
            max_digest_work_bytes: 512 * 1024,
            ttl_ms: 30_000,
        },
        coverage: coverage(),
        egress_policy: ForkEgressPolicyV1::DenyAll,
        created_at_ms: now,
    }
}

fn identity(stream: &str, operation: &str, function: &str) -> OperationIdentityV1 {
    let upstream_identity = format!("bench-upstream-{operation}");
    OperationIdentityV1 {
        schema_version: 1,
        key: OperationKeyV1 {
            stream_id: stream.to_owned(),
            originator_class: OperationOriginatorClassV1::Host,
            operation_id: derive_host_operation_id(&upstream_identity, 0),
        },
        issuance: OperationIssuanceV1::HostIncarnation {
            epoch_id: "bench-epoch".to_owned(),
            upstream_identity,
            commit_ordinal: 0,
            authority_authenticator_digest: sha('a'),
        },
        bound_facts: OperationBoundFactsV1 {
            audience: "bench-app".to_owned(),
            principal_fingerprint: sha('b'),
            authority_instance_id: "bench-authority".to_owned(),
            operation_kind: "promotion".to_owned(),
            function_or_command: function.to_owned(),
            input_fingerprint: sha('c'),
        },
    }
}

fn draft(seed: u64, stream: &str) -> BranchOperationDraftV1 {
    BranchOperationDraftV1 {
        schema_version: 1,
        identity: identity(stream, &format!("branch-op-{seed}"), "widgets.rename"),
        artifact_identity: sha('e'),
        function_or_command: "widgets.rename".to_owned(),
        canonical_arguments: json!({ "id": 1, "name": format!("renamed-{seed}") }),
        principal_id: "bench-principal".to_owned(),
        grant_id: "bench-grant".to_owned(),
        read_baseline: json!({ "widgets/1": "widget-1" }),
        replay_inputs: vec![RetainedReplayInputV1 {
            name: "ctx.locale".to_owned(),
            custody: ReplayCustodyClassV1::InlineRedacted,
            value: json!("en-US"),
        }],
        causal_predecessors: Vec::new(),
    }
}

fn coverage() -> ForkCoverageV1 {
    ForkCoverageV1 {
        covered_lanes: vec!["ordinaryMutation".to_owned()],
        uncovered_lanes: Vec::new(),
        schema_covered: false,
        system_fields_covered: false,
        assets_covered: false,
        effects_covered: false,
    }
}

fn facts(name: &str) -> ApprovedOperationFactsV1 {
    ApprovedOperationFactsV1 {
        read_facts: json!({ "widgets/1": "widget-1" }),
        ctx_answers: json!({ "locale": "en-US" }),
        decision: json!({ "rename": true }),
        result: json!({ "ok": true }),
        writes: vec![LogicalWriteFactV1 {
            table_name: "widgets".to_owned(),
            row_id: "1".to_owned(),
            after: Some(json!({ "id": 1, "name": name })),
        }],
        effects: Vec::new(),
        coverage: coverage(),
    }
}

fn rename(
    tx: &Transaction<'_>,
    draft: &BranchOperationDraftV1,
) -> SnapbackResult<ApprovedOperationFactsV1> {
    let name = draft.canonical_arguments["name"]
        .as_str()
        .unwrap_or_default();
    tx.execute("UPDATE widgets SET name=?1 WHERE id=1", params![name])?;
    Ok(facts(name))
}

fn rename_replay(
    context: &PromotionReplayContextV1<'_>,
    operation: &BranchOperationV1,
) -> SnapbackResult<ApprovedOperationFactsV1> {
    let _current = context.read_row("widgets", "1")?;
    let name = operation.canonical_arguments["name"]
        .as_str()
        .unwrap_or_default();
    Ok(facts(name))
}

fn scan_widgets(conn: &Connection) -> SnapbackResult<Vec<SnapshotRowV1>> {
    let mut statement = conn.prepare("SELECT id, name FROM widgets")?;
    let rows = statement.query_map([], |row| {
        let id = row.get::<_, i64>(0)?;
        let name = row.get::<_, String>(1)?;
        Ok(SnapshotRowV1 {
            table_name: "widgets".to_owned(),
            row_id: id.to_string(),
            row: json!({ "id": id, "name": name }),
        })
    })?;
    let mut rows = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    rows.sort_by(|left, right| {
        (&left.table_name, &left.row_id).cmp(&(&right.table_name, &right.row_id))
    });
    Ok(rows)
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

fn sha(character: char) -> String {
    format!("sha256:{}", character.to_string().repeat(64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contention_recorder_observes_real_reservation_and_retains_p99_population() {
        let evidence = measure_writer_contention().expect("contention evidence");
        assert_eq!(evidence.raw_request_to_commit_us.len(), CONTENTION_SAMPLES);
        assert_eq!(evidence.initial_deferred_worker_count, CONTENTION_WORKERS);
        assert!(evidence.p99_us >= evidence.p95_us);
        assert!(evidence.max_us >= evidence.p99_us);
    }
}
