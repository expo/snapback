//! Dated absolute-latency instrument for LLP 0164's novel operations.
//!
//! Build in release mode, wait for build quiescence, then invoke the binary
//! directly with the output path. The record is evidence for ratifying bounds;
//! it is not itself a capability claim.
//!
//! @ref LLP 0162#measurement-gate — fork creation, exact diff, promotion, and
//!   reap have no pre-profile comparator and require dated absolute evidence.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;

use anyhow::{Context, bail};
use rusqlite::{Connection, Transaction, params};
use serde::Serialize;
use serde_json::json;
use snapback::branches::{BranchId, ChildStreamId, MaterializedBase};
use snapback::commit_envelope::{
    OperationBoundFactsV1, OperationIdentityV1, OperationIssuanceV1, OperationKeyV1,
    OperationOriginatorClassV1,
};
use snapback::diagnostic::SnapbackResult;
use snapback::fork_promotion::{
    ApprovedOperationFactsV1, BranchGrantV1, BranchLimitsV1, BranchOperationDraftV1,
    BranchOperationV1, ForkCoverageV1, ForkEgressPolicyV1, InAppBranchCreateV1, LogicalWriteFactV1,
    PromotionApprovalV1, PromotionAuthorityDecisionV1, PromotionContentionPolicyV1,
    PromotionSealKey, ReplayCustodyClassV1, RetainedReplayInputV1, SnapshotRowV1,
    create_in_app_branch, exact_fork_diff, execute_branch_operation, issue_promotion_ticket,
    promote_by_reexecution, reap_expired_in_app_branches, seal_promotion_request,
};
use snapback::proof_checkpoint::BoundaryRowV1;

const RECORDED_RUNS: usize = 11;
const LOCAL_WARMUPS: usize = 4;
const ROWS: usize = 512;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Artifact {
    schema_version: &'static str,
    artifact_name: &'static str,
    date: &'static str,
    source_revision: String,
    hardware_class: Hardware,
    fixture: Fixture,
    protocol: Protocol,
    raw_runs: Vec<Run>,
    summary_us: BTreeMap<&'static str, Statistics>,
    bound_ratification: &'static str,
    claim_boundary: &'static str,
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
    let output = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .context("usage: snapback-fork-promotion-bench OUTPUT.json")?;
    ensure_machine_quiescent()?;

    run_once(0)?;
    for index in 0..LOCAL_WARMUPS {
        run_once(10_000 + index as u64)?;
    }
    let mut raw_runs = Vec::with_capacity(RECORDED_RUNS);
    for index in 0..RECORDED_RUNS {
        raw_runs.push(run_once(20_000 + index as u64)?);
    }
    let artifact = Artifact {
        schema_version: "snapback.fork-promotion-performance.v1",
        artifact_name: "agent-safe-fork-promotion-absolute-2026-08-03",
        date: "2026-08-03",
        source_revision: command(&["git", "rev-parse", "HEAD"]),
        hardware_class: Hardware {
            os: command(&["sw_vers", "-productVersion"]),
            architecture: std::env::consts::ARCH,
            model: sysctl("hw.model"),
            cpu: sysctl("machdep.cpu.brand_string"),
            logical_cpus: std::thread::available_parallelism()
                .map(usize::from)
                .unwrap_or(0),
            memory_bytes: sysctl("hw.memsize").parse().unwrap_or(0),
        },
        fixture: Fixture {
            logical_rows: ROWS,
            changed_rows: 1,
            operations_per_promotion: 1,
            whole_run_warmups: 1,
            per_metric_warmups: LOCAL_WARMUPS,
            recorded_runs: RECORDED_RUNS,
        },
        protocol: Protocol {
            estimator: "median of 11 fresh-fixture runs",
            spread: "median absolute deviation (MAD), with min/max and raw runs retained",
            build_profile: "release",
            quiescence_rule: "direct binary invocation refuses while another cargo or rustc process exists",
            measurement_scope: "absolute latency only; no honest pre-profile product comparator exists",
        },
        summary_us: summarize(&raw_runs),
        raw_runs,
        bound_ratification: "Missing: LLP 0162 author has not ratified absolute bounds beside the step-0 artifact",
        claim_boundary: "instrumentation evidence only; fork and promotion capabilities remain Missing",
    };
    std::fs::write(
        &output,
        format!("{}\n", serde_json::to_string_pretty(&artifact)?),
    )?;
    println!("wrote {}", output.display());
    Ok(())
}

fn run_once(seed: u64) -> anyhow::Result<Run> {
    let now = 1_000_000 + seed as i64 * 100;
    let mut canonical = source()?;
    let create = create_request(seed, 9, 9, now);
    let started = Instant::now();
    create_in_app_branch(&mut canonical, &create)?;
    let mut workspace = MaterializedBase::materialize(&canonical, None)?;
    let fork_creation_us = micros(started);

    let operation = draft(seed, &create.child_stream_id.0);
    execute_branch_operation(
        &mut workspace.conn,
        &create.branch_id,
        &operation,
        now + 1,
        rename,
    )?;
    let started = Instant::now();
    let diff = exact_fork_diff(&workspace, &create.branch_id, scan_widgets)?;
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
    )?;
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
        &key,
        now + 3,
    )?;
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
        scan_widget_boundary,
        rename_replay,
    )?;
    let promotion_us = micros(started);

    let reap = create_request(seed, 10, 10, now);
    create_in_app_branch(&mut canonical, &reap)?;
    let started = Instant::now();
    reap_expired_in_app_branches(&mut canonical, now + 30_000)?;
    let ttl_reap_us = micros(started);

    Ok(Run {
        fork_creation_us,
        exact_diff_us,
        promotion_us,
        ttl_reap_us,
    })
}

fn source() -> anyhow::Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    conn.execute_batch(
        "CREATE TABLE _snapback_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
         CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
         INSERT INTO _snapback_version VALUES (1, 9);",
    )?;
    let tx = conn.transaction()?;
    for id in 1..=ROWS as i64 {
        tx.execute(
            "INSERT INTO widgets(id, name) VALUES (?1, ?2)",
            params![id, format!("widget-{id}")],
        )?;
    }
    tx.commit()?;
    Ok(conn)
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
            ttl_ms: 30_000,
        },
        coverage: coverage(),
        egress_policy: ForkEgressPolicyV1::DenyAll,
        created_at_ms: now,
    }
}

fn identity(stream: &str, operation: &str, function: &str) -> OperationIdentityV1 {
    OperationIdentityV1 {
        schema_version: 1,
        key: OperationKeyV1 {
            stream_id: stream.to_owned(),
            originator_class: OperationOriginatorClassV1::Host,
            operation_id: operation.to_owned(),
        },
        issuance: OperationIssuanceV1::HostIncarnation {
            epoch_id: "bench-epoch".to_owned(),
            upstream_identity: format!("bench-upstream-{operation}"),
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
    tx: &Transaction<'_>,
    operation: &BranchOperationV1,
) -> SnapbackResult<ApprovedOperationFactsV1> {
    let name = operation.canonical_arguments["name"]
        .as_str()
        .unwrap_or_default();
    tx.execute("UPDATE widgets SET name=?1 WHERE id=1", params![name])?;
    Ok(facts(name))
}

fn scan_widgets(conn: &Connection) -> SnapbackResult<Vec<SnapshotRowV1>> {
    let mut statement = conn.prepare("SELECT id, name FROM widgets ORDER BY id")?;
    let rows = statement.query_map([], |row| {
        let id = row.get::<_, i64>(0)?;
        let name = row.get::<_, String>(1)?;
        Ok(SnapshotRowV1 {
            table_name: "widgets".to_owned(),
            row_id: id.to_string(),
            row: json!({ "id": id, "name": name }),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn scan_widget_boundary(conn: &Connection) -> SnapbackResult<Vec<BoundaryRowV1>> {
    let mut rows = scan_widgets(conn)?
        .into_iter()
        .map(|row| BoundaryRowV1 {
            qualified_table: row.table_name,
            row_id: row.row_id,
            value: row.row,
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        (&left.qualified_table, &left.row_id).cmp(&(&right.qualified_table, &right.row_id))
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
    let output = command(&["ps", "-axo", "comm="]);
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

fn command(arguments: &[&str]) -> String {
    Command::new(arguments[0])
        .args(&arguments[1..])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_default()
}

fn sysctl(name: &str) -> String {
    command(&["sysctl", "-n", name])
}

fn sha(character: char) -> String {
    format!("sha256:{}", character.to_string().repeat(64))
}
