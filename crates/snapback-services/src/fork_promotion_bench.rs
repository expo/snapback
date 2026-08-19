//! Confined storage half of the fork-promotion benchmark.
//!
//! Connections and transactions never cross this API. The rank-7 recorder
//! receives only measurements and a one-shot reservation handle.

use std::path::Path;
use std::time::Instant;

use anyhow::Context as _;
use rusqlite::{Connection, Transaction, params};
use serde_json::json;
use snapback_kernel::branches::{BranchId, ChildStreamId, MaterializedBase};
use snapback_kernel::commit_envelope::{
    IdentityEpochStateV1, IdentityEpochV1, OperationBoundFactsV1, OperationIdentityV1,
    OperationIssuanceV1, OperationKeyV1, OperationOriginatorClassV1, derive_host_operation_id,
};
use snapback_kernel::diagnostic::SnapbackResult;
use snapback_kernel::fork_promotion::{
    ApprovedOperationFactsV1, BranchArtifactBindingV1, BranchGrantV1, BranchLimitsV1,
    BranchOperationDraftV1, BranchOperationV1, ForkCoverageV1, ForkEgressPolicyV1,
    InAppBranchCreateV1, LogicalWriteFactV1, PromotionAdmissionTicketV1, PromotionApprovalV1,
    PromotionAuthorityDecisionV1, PromotionContentionPolicyV1, PromotionReplayContextV1,
    PromotionSealKey, ReplayCustodyClassV1, RetainedReplayInputV1, SnapshotRowV1,
    create_in_app_branch, exact_fork_diff, execute_branch_operation, issue_promotion_ticket,
    promote_by_reexecution, reap_expired_in_app_branches, request_head_reservation,
    seal_promotion_request,
};

const ROWS: usize = 512;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkPromotionBenchmarkRun {
    pub fork_creation_us: f64,
    pub exact_diff_us: f64,
    pub promotion_us: f64,
    pub ttl_reap_us: f64,
}

// @ref LLP 0276#phases —
//   benchmark metrology keeps raw rusqlite state inside its confined owner.
pub fn run_fork_promotion_benchmark_once(seed: u64) -> anyhow::Result<ForkPromotionBenchmarkRun> {
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
    Ok(ForkPromotionBenchmarkRun {
        fork_creation_us,
        exact_diff_us,
        promotion_us,
        ttl_reap_us: micros(started),
    })
}

fn source() -> anyhow::Result<Connection> {
    let mut connection = Connection::open_in_memory()?;
    connection.execute_batch(
        "CREATE TABLE _snapback_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
         CREATE TABLE _snapback_changes (
           id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL,
           table_name TEXT NOT NULL, row_id TEXT NOT NULL, op TEXT NOT NULL,
           row_json TEXT, changed_at_ms INTEGER NOT NULL
         );
         CREATE TABLE _snapback_history_policies_v1 (
           table_name TEXT PRIMARY KEY, retain_ms INTEGER NOT NULL, max_rows INTEGER NOT NULL
         );
         CREATE TABLE _snapback_record_history_v1 (
           id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL,
           table_name TEXT NOT NULL, row_id TEXT NOT NULL, op TEXT NOT NULL,
           row_json TEXT, changed_at_ms INTEGER NOT NULL, operation_id TEXT
         );
         CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
         INSERT INTO _snapback_version VALUES (1, 9);",
    )?;
    let tx = connection.transaction()?;
    for id in 1..=ROWS as i64 {
        tx.execute(
            "INSERT INTO widgets(id, name) VALUES (?1, ?2)",
            params![id, format!("widget-{id}")],
        )?;
    }
    snapback_kernel::operation_ledger::create_infra(&tx)?;
    snapback_kernel::operation_ledger::register_epoch_in(&tx, &epoch(1))?;
    tx.commit()?;
    Ok(connection)
}

pub struct PromotionContentionReservation {
    connection: Connection,
    ticket: PromotionAdmissionTicketV1,
}

#[derive(Clone, Copy, Debug)]
pub struct PromotionContentionPolicy {
    pub reservation_interval_ms: u64,
    pub maximum_promotion_commit_duration_ms: u64,
}

pub fn prepare_promotion_contention_reservation(
    database_path: &Path,
    canonical_stream_id: &str,
    workers: usize,
    issued_at_ms: i64,
) -> anyhow::Result<PromotionContentionReservation> {
    let mut connection = Connection::open(database_path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    let tx = connection.transaction()?;
    snapback_kernel::operation_ledger::register_epoch_in(&tx, &epoch(issued_at_ms.max(1) as u64))?;
    tx.commit()?;
    let ticket = issue_promotion_ticket(
        &mut connection,
        identity(
            canonical_stream_id,
            "contention-ticket",
            "promotion.reserve",
        ),
        &BranchId("contention-branch".to_owned()),
        canonical_stream_id,
        workers as u64,
        issued_at_ms.saturating_add(60_000),
        issued_at_ms,
        PromotionContentionPolicyV1::default(),
    )?;
    connection.execute(
        "UPDATE _snapback_promotion_admission SET losses = ?2 WHERE ticket_id = ?1",
        params![
            ticket.ticket_identity.key.operation_id,
            ticket.contention_policy.reservation_after_losses as i64
        ],
    )?;
    Ok(PromotionContentionReservation { connection, ticket })
}

impl PromotionContentionReservation {
    pub fn activate(self, now_ms: i64) -> SnapbackResult<PromotionContentionPolicy> {
        request_head_reservation(&self.connection, &self.ticket, now_ms)?;
        Ok(PromotionContentionPolicy {
            reservation_interval_ms: self.ticket.contention_policy.reservation_interval_ms,
            maximum_promotion_commit_duration_ms: self
                .ticket
                .contention_policy
                .maximum_commit_duration_ms,
        })
    }
}

pub fn count_committed_contention_rows(database_path: &Path) -> anyhow::Result<usize> {
    Ok(Connection::open(database_path)?
        .query_row("SELECT COUNT(*) FROM todos", [], |row| row.get(0))?)
}

fn epoch(issued_at_ms: u64) -> IdentityEpochV1 {
    IdentityEpochV1 {
        schema_version: 1,
        originator_class: OperationOriginatorClassV1::Host,
        audience: "bench-app".to_owned(),
        authority_instance_id: "bench-authority".to_owned(),
        epoch_id: "bench-epoch".to_owned(),
        epoch_sequence: 1,
        state: IdentityEpochStateV1::Open,
        issued_at_ms,
        terminated_at_ms: None,
        authority_authenticator_digest: sha('a'),
    }
}

fn create_request(seed: u64, ordinal: u64, base_version: u64, now: i64) -> InAppBranchCreateV1 {
    InAppBranchCreateV1 {
        schema_version: 1,
        branch_id: BranchId(format!("bench-branch-{seed}-{ordinal}")),
        child_stream_id: ChildStreamId(format!("bench-child-{seed}-{ordinal}")),
        base_stream: "canonical".to_owned(),
        base_version,
        artifact_binding: BranchArtifactBindingV1 {
            schema_hash: sha('1'),
            function_bundle_hash: sha('2'),
        },
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

#[allow(clippy::result_large_err)]
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

#[allow(clippy::result_large_err)]
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

#[allow(clippy::result_large_err)]
fn scan_widgets(connection: &Connection) -> SnapbackResult<Vec<SnapshotRowV1>> {
    let mut statement = connection.prepare("SELECT id, name FROM widgets")?;
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

fn micros(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1_000_000.0
}

fn sha(character: char) -> String {
    format!("sha256:{}", character.to_string().repeat(64))
}
