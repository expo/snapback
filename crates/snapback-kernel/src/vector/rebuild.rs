//! Approved, resumable `derived-vector-catchup.v1` for SQLite.
//!
//! This is an LLP 0081 specialization, not a generic schema migration step:
//! application lanes remain open while an operation-owned fixed source
//! snapshot is built and journal catch-up converges. Only the final verified
//! generation switch takes the short SQLite writer fence.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{SchemaManifest, TableManifest};
use crate::migration::{
    MigrationApprovalV1, MigrationAudienceV1, MigrationCeilings, approval_digest,
    validate_approval_shape,
};
use crate::storage::{ChangeOp, VersionedChangedRow};
use crate::vector::diagnostics::{index_corrupt, index_unavailable};
use crate::vector::sqlite::{
    GenerationUpdate, canonical_posting, maintain_candidate_in_tx, manifest_digest,
    verify_generation,
};
use crate::vector::types::VectorIndexManifestV1;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

pub const VECTOR_REBUILD_EXECUTOR: &str = "derived-vector-catchup.v1";
pub const VECTOR_REBUILD_PLAN_SCHEMA_VERSION: &str = "vector-rebuild-plan-v1";
const VECTOR_REBUILD_PLAN_DOMAIN: &str = "snapback:vector-rebuild-plan:v1";

fn rebuild_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "vector", message)
}

fn plan_invalid(message: impl Into<String>) -> SnapbackError {
    rebuild_error("SNAPBACK_VECTOR_MAINTENANCE_FAILED", message)
}

fn to_sql_u64(value: u64, context: &str) -> SnapbackResult<i64> {
    i64::try_from(value)
        .map_err(|_| plan_invalid(format!("{context} exceeds SQLite's integer domain")))
}

fn decode_nonnegative(value: i64) -> SnapbackResult<u64> {
    u64::try_from(value).map_err(|_| index_corrupt())
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorRebuildPlanBodyV1 {
    pub schema_version: String,
    pub executor: String,
    pub table: String,
    pub index: String,
    pub semantic_version: String,
    pub manifest_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predecessor_generation: Option<u64>,
    pub audience: MigrationAudienceV1,
    pub ceilings: MigrationCeilings,
    pub max_batch_rows: u32,
    pub journal_lease_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorRebuildPlanV1 {
    pub body: VectorRebuildPlanBodyV1,
    pub plan_digest: String,
    pub plan_id: String,
}

fn digest_body(body: &VectorRebuildPlanBodyV1) -> SnapbackResult<String> {
    let value = serde_json::to_value(body)
        .map_err(|_| plan_invalid("vector rebuild plan does not serialize"))?;
    let canonical = crate::rqs_contract::jcs(&value)
        .map_err(|_| plan_invalid("vector rebuild plan is not canonicalizable"))?;
    let mut digest = Sha256::new();
    digest.update(VECTOR_REBUILD_PLAN_DOMAIN.as_bytes());
    digest.update(b"\n");
    digest.update(canonical.as_bytes());
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

impl VectorRebuildPlanV1 {
    pub fn seal(body: VectorRebuildPlanBodyV1) -> SnapbackResult<Self> {
        validate_plan_body(&body)?;
        let plan_digest = digest_body(&body)?;
        let plan_id = format!("vector-rebuild-v1:{plan_digest}");
        Ok(Self {
            body,
            plan_digest,
            plan_id,
        })
    }

    pub fn validate(&self) -> SnapbackResult<()> {
        validate_plan_body(&self.body)?;
        let digest = digest_body(&self.body)?;
        if digest != self.plan_digest
            || self.plan_id != format!("vector-rebuild-v1:{}", self.plan_digest)
        {
            return Err(plan_invalid(
                "vector rebuild plan seal does not match its body",
            ));
        }
        Ok(())
    }
}

fn validate_plan_body(body: &VectorRebuildPlanBodyV1) -> SnapbackResult<()> {
    if body.schema_version != VECTOR_REBUILD_PLAN_SCHEMA_VERSION
        || body.executor != VECTOR_REBUILD_EXECUTOR
        || body.table.trim().is_empty()
        || body.index.trim().is_empty()
        || body.semantic_version.trim().is_empty()
        || !body.manifest_digest.starts_with("sha256:")
        || body.max_batch_rows == 0
        || body.max_batch_rows > 1_024
        || body.journal_lease_ms == 0
        || body.ceilings.max_affected_rows == 0
        || body.ceilings.max_bytes == 0
        || body.ceilings.max_writes == 0
        || body.ceilings.max_barrier_downtime_ms == 0
    {
        return Err(plan_invalid(
            "vector rebuild plan is outside the closed v1 profile",
        ));
    }
    if body.audience.database_id.trim().is_empty()
        || body.audience.stream_incarnation.trim().is_empty()
        || body.audience.target_profile_id.trim().is_empty()
    {
        return Err(plan_invalid(
            "vector rebuild plan has no resolved target audience",
        ));
    }
    Ok(())
}

fn validate_approval(
    plan: &VectorRebuildPlanV1,
    approval: &MigrationApprovalV1,
    now_ms: u64,
) -> SnapbackResult<String> {
    plan.validate()?;
    validate_approval_shape(approval)?;
    if approval.plan_digest != plan.plan_digest
        || approval.audience != plan.body.audience
        || approval.observation_digest.trim().is_empty()
        || approval.policy_digest.trim().is_empty()
        || now_ms < approval.issued_at_ms
        || now_ms >= approval.expires_at_ms
    {
        return Err(plan_invalid(
            "vector rebuild approval does not bind this plan, target, policy, observation, or admission time",
        ));
    }
    approval_digest(approval)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum VectorRebuildStateV1 {
    Baseline,
    Catchup,
    Verified,
    Activated,
    RolledBack,
    Quarantined,
}

impl VectorRebuildStateV1 {
    fn from_sql(value: &str) -> SnapbackResult<Self> {
        match value {
            "baseline" => Ok(Self::Baseline),
            "catchup" => Ok(Self::Catchup),
            "verified" => Ok(Self::Verified),
            "activated" => Ok(Self::Activated),
            "rolled-back" => Ok(Self::RolledBack),
            "quarantined" => Ok(Self::Quarantined),
            _ => Err(index_corrupt()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorRebuildProgressV1 {
    pub operation_id: String,
    pub table: String,
    pub index: String,
    pub generation: u64,
    pub state: VectorRebuildStateV1,
    pub snapshot_head: u64,
    pub candidate_head: u64,
    pub snapshot_rows: u64,
    pub snapshot_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_digest: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorRebuildReceiptV1 {
    pub executor: String,
    pub operation_id: String,
    pub plan_digest: String,
    pub approval_digest: String,
    pub table: String,
    pub index: String,
    pub generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predecessor_generation: Option<u64>,
    pub source_head: u64,
    pub root_digest: String,
    pub live_rows: u64,
    pub frontier_rows: u64,
    pub activated: bool,
    pub rollback_eligible: bool,
}

struct BuildRow {
    operation_id: String,
    table: String,
    index: String,
    generation: u64,
    predecessor_generation: Option<u64>,
    plan: VectorRebuildPlanV1,
    approval_digest: String,
    snapshot_head: u64,
    candidate_head: u64,
    baseline_cursor: Option<String>,
    state: VectorRebuildStateV1,
    root_digest: Option<String>,
    snapshot_rows: u64,
    snapshot_bytes: u64,
    lease_expires_at_ms: u64,
}

impl BuildRow {
    fn progress(&self) -> VectorRebuildProgressV1 {
        VectorRebuildProgressV1 {
            operation_id: self.operation_id.clone(),
            table: self.table.clone(),
            index: self.index.clone(),
            generation: self.generation,
            state: self.state.clone(),
            snapshot_head: self.snapshot_head,
            candidate_head: self.candidate_head,
            snapshot_rows: self.snapshot_rows,
            snapshot_bytes: self.snapshot_bytes,
            baseline_cursor: self.baseline_cursor.clone(),
            root_digest: self.root_digest.clone(),
        }
    }
}

fn load_build(conn: &Connection, operation_id: &str) -> SnapbackResult<BuildRow> {
    type RawBuildRow = (
        String,
        String,
        i64,
        Option<i64>,
        String,
        String,
        String,
        String,
        i64,
        i64,
        Option<String>,
        String,
        Option<String>,
        i64,
        i64,
        i64,
    );
    let raw: Option<RawBuildRow> = conn
        .query_row(
            "SELECT table_name,index_name,generation,predecessor_generation,
                    plan_digest,approval_digest,plan_json,approval_json,
                    snapshot_head,candidate_head,baseline_cursor,status,root_digest,
                    snapshot_rows,snapshot_bytes,lease_expires_at_ms
             FROM _snapback_vector_builds WHERE operation_id=?1",
            params![operation_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                    row.get(11)?,
                    row.get(12)?,
                    row.get(13)?,
                    row.get(14)?,
                    row.get(15)?,
                ))
            },
        )
        .optional()?;
    let Some((
        table,
        index,
        generation,
        predecessor_generation,
        stored_plan_digest,
        stored_approval_digest,
        plan_json,
        approval_json,
        snapshot_head,
        candidate_head,
        baseline_cursor,
        status,
        root_digest,
        snapshot_rows,
        snapshot_bytes,
        lease_expires_at_ms,
    )) = raw
    else {
        return Err(index_unavailable());
    };
    let plan: VectorRebuildPlanV1 =
        serde_json::from_str(&plan_json).map_err(|_| index_corrupt())?;
    let approval: MigrationApprovalV1 =
        serde_json::from_str(&approval_json).map_err(|_| index_corrupt())?;
    plan.validate()?;
    if plan.plan_digest != stored_plan_digest
        || approval_digest(&approval)? != stored_approval_digest
        || approval.operation_id != operation_id
    {
        return Err(index_corrupt());
    }
    Ok(BuildRow {
        operation_id: operation_id.to_owned(),
        table,
        index,
        generation: decode_nonnegative(generation)?,
        predecessor_generation: predecessor_generation.map(decode_nonnegative).transpose()?,
        plan,
        approval_digest: stored_approval_digest,
        snapshot_head: decode_nonnegative(snapshot_head)?,
        candidate_head: decode_nonnegative(candidate_head)?,
        baseline_cursor,
        state: VectorRebuildStateV1::from_sql(&status)?,
        root_digest,
        snapshot_rows: decode_nonnegative(snapshot_rows)?,
        snapshot_bytes: decode_nonnegative(snapshot_bytes)?,
        lease_expires_at_ms: decode_nonnegative(lease_expires_at_ms)?,
    })
}

fn index_binding<'a>(
    schema: &'a SchemaManifest,
    table: &str,
    index: &str,
) -> SnapbackResult<(&'a TableManifest, &'a VectorIndexManifestV1)> {
    let table = schema.table(table).ok_or_else(index_unavailable)?;
    let index = table
        .vector_indexes
        .iter()
        .find(|candidate| candidate.name == index)
        .ok_or_else(index_unavailable)?;
    Ok((table, index))
}

fn active_generation(conn: &Connection, table: &str, index: &str) -> SnapbackResult<Option<u64>> {
    conn.query_row(
        "SELECT generation FROM _snapback_vector_generations
         WHERE table_name=?1 AND index_name=?2 AND status='active'",
        params![table, index],
        |row| row.get::<_, i64>(0),
    )
    .optional()?
    .map(decode_nonnegative)
    .transpose()
}

fn candidate_generation(
    tx: &Transaction<'_>,
    table: &str,
    index: &VectorIndexManifestV1,
    source_head: u64,
) -> SnapbackResult<u64> {
    let digest = manifest_digest(index)?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT generation FROM _snapback_vector_generations
             WHERE table_name=?1 AND index_name=?2 AND manifest_digest=?3 AND status='pending'
             ORDER BY generation DESC LIMIT 1",
            params![table, index.name, digest],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(existing) = existing {
        return decode_nonnegative(existing);
    }
    let generation: i64 = tx.query_row(
        "SELECT COALESCE(MAX(generation),0)+1 FROM _snapback_vector_generations
         WHERE table_name=?1 AND index_name=?2",
        params![table, index.name],
        |row| row.get(0),
    )?;
    tx.execute(
        "INSERT INTO _snapback_vector_generations
         (table_name,index_name,semantic_version,manifest_digest,manifest_json,generation,
          status,source_head,root_digest,receipt_json)
         VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,?8,'{}')",
        params![
            table,
            index.name,
            index.semantic_version,
            digest,
            serde_json::to_string(index)
                .map_err(|_| plan_invalid("vector index manifest does not serialize"))?,
            generation,
            to_sql_u64(source_head, "vector snapshot head")?,
            format!("sha256-xor-v1:{}", "00".repeat(32)),
        ],
    )?;
    decode_nonnegative(generation)
}

fn scan_fixed_snapshot(
    tx: &Transaction<'_>,
    table: &TableManifest,
    operation_id: &str,
    ceilings: &MigrationCeilings,
) -> SnapbackResult<(u64, u64)> {
    let quoted = crate::storage::quote_ident(&table.name)?;
    let mut statement = tx.prepare(&format!("SELECT * FROM {quoted} ORDER BY \"_id\""))?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query([])?;
    let mut count = 0_u64;
    let mut bytes = 0_u64;
    while let Some(row) = rows.next()? {
        let value = crate::storage::row_to_document(row, table, &columns)?;
        let row_id = value
            .get("_id")
            .and_then(Value::as_str)
            .ok_or_else(index_corrupt)?;
        let source_version = value
            .get("_version")
            .and_then(Value::as_u64)
            .ok_or_else(index_corrupt)?;
        let row_json = serde_json::to_string(&value)
            .map_err(|_| plan_invalid("vector snapshot row does not serialize"))?;
        count = count.checked_add(1).ok_or_else(|| {
            plan_invalid("vector snapshot row count overflowed its approved ceiling")
        })?;
        bytes = bytes
            .checked_add(row_json.len() as u64)
            .ok_or_else(|| plan_invalid("vector snapshot byte count overflowed"))?;
        if count > ceilings.max_affected_rows || bytes > ceilings.max_bytes {
            return Err(plan_invalid(
                "vector fixed snapshot exceeds the approved row or byte ceiling",
            ));
        }
        tx.execute(
            "INSERT INTO _snapback_vector_build_snapshot
             (operation_id,row_id,source_version,row_json) VALUES (?1,?2,?3,?4)",
            params![
                operation_id,
                row_id,
                to_sql_u64(source_version, "vector snapshot row version")?,
                row_json
            ],
        )?;
    }
    Ok((count, bytes))
}

/// Admit an approved operation and materialize its stable source snapshot in
/// one writer transaction. Application commits after `snapshot_head` remain
/// open and are covered by the persisted journal-floor lease.
///
/// @ref LLP 0081#2-canonical-plan-and-approval
/// @ref LLP 0073#rebuilds-and-migrations
pub(crate) fn begin_rebuild(
    conn: &mut Connection,
    schema: &SchemaManifest,
    plan: &VectorRebuildPlanV1,
    approval: &MigrationApprovalV1,
    now_ms: u64,
) -> SnapbackResult<VectorRebuildProgressV1> {
    let sealed_approval = validate_approval(plan, approval, now_ms)?;
    let (table, index) = index_binding(schema, &plan.body.table, &plan.body.index)?;
    crate::manifest::validate_vector_index_manifest(table, index)?;
    if index.semantic_version != plan.body.semantic_version
        || manifest_digest(index)? != plan.body.manifest_digest
    {
        return Err(plan_invalid(
            "vector rebuild plan does not bind the installed index declaration",
        ));
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if tx
        .query_row(
            "SELECT 1 FROM _snapback_vector_builds WHERE operation_id=?1",
            params![approval.operation_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        let existing = load_build(&tx, &approval.operation_id)?;
        if existing.plan.plan_digest != plan.plan_digest
            || existing.approval_digest != sealed_approval
        {
            return Err(plan_invalid(
                "vector rebuild operation id is already bound to a different plan or approval",
            ));
        }
        let progress = existing.progress();
        tx.rollback()?;
        return Ok(progress);
    }
    let source_head = crate::storage::current_version_on(&tx)?;
    let predecessor = active_generation(&tx, &table.name, &index.name)?;
    if predecessor != plan.body.predecessor_generation {
        return Err(plan_invalid(
            "vector rebuild predecessor changed after approval",
        ));
    }
    let generation = candidate_generation(&tx, &table.name, index, source_head)?;
    tx.execute(
        "UPDATE _snapback_vector_generations
         SET status='building',source_head=?4,predecessor_generation=?5,
             activated_head=NULL,rollback_eligible=0,corruption_reason=NULL
         WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND status='pending'",
        params![
            table.name,
            index.name,
            to_sql_u64(generation, "vector generation")?,
            to_sql_u64(source_head, "vector snapshot head")?,
            predecessor
                .map(|value| to_sql_u64(value, "predecessor vector generation"))
                .transpose()?,
        ],
    )?;
    let (snapshot_rows, snapshot_bytes) =
        scan_fixed_snapshot(&tx, table, &approval.operation_id, &plan.body.ceilings)?;
    let lease_expires_at_ms = now_ms
        .checked_add(plan.body.journal_lease_ms)
        .ok_or_else(|| plan_invalid("vector journal lease expiry overflowed"))?;
    tx.execute(
        "INSERT INTO _snapback_vector_journal_leases
         (operation_id,table_name,index_name,generation,floor_version,expires_at_ms)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            approval.operation_id,
            table.name,
            index.name,
            to_sql_u64(generation, "vector generation")?,
            to_sql_u64(source_head, "vector journal floor")?,
            to_sql_u64(lease_expires_at_ms, "vector journal lease expiry")?,
        ],
    )?;
    tx.execute(
        "INSERT INTO _snapback_vector_builds
         (operation_id,table_name,index_name,generation,predecessor_generation,
          plan_digest,approval_digest,plan_json,approval_json,snapshot_head,candidate_head,
          baseline_cursor,status,snapshot_rows,snapshot_bytes,lease_expires_at_ms)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10,NULL,'baseline',?11,?12,?13)",
        params![
            approval.operation_id,
            table.name,
            index.name,
            to_sql_u64(generation, "vector generation")?,
            predecessor
                .map(|value| to_sql_u64(value, "predecessor vector generation"))
                .transpose()?,
            plan.plan_digest,
            sealed_approval,
            serde_json::to_string(plan)
                .map_err(|_| plan_invalid("vector rebuild plan does not serialize"))?,
            serde_json::to_string(approval)
                .map_err(|_| plan_invalid("vector rebuild approval does not serialize"))?,
            to_sql_u64(source_head, "vector snapshot head")?,
            to_sql_u64(snapshot_rows, "vector snapshot rows")?,
            to_sql_u64(snapshot_bytes, "vector snapshot bytes")?,
            to_sql_u64(lease_expires_at_ms, "vector journal lease expiry")?,
        ],
    )?;
    tx.commit()?;
    inspect_rebuild(conn, &approval.operation_id)
}

fn renew_lease(tx: &Transaction<'_>, build: &BuildRow, now_ms: u64) -> SnapbackResult<u64> {
    let lease: Option<(String, String, i64, i64, i64)> = tx
        .query_row(
            "SELECT table_name,index_name,generation,floor_version,expires_at_ms
             FROM _snapback_vector_journal_leases WHERE operation_id=?1",
            params![build.operation_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()?;
    let Some((table, index, generation, floor, lease_expires)) = lease else {
        return Err(index_unavailable());
    };
    let generation = decode_nonnegative(generation)?;
    let floor = decode_nonnegative(floor)?;
    let lease_expires = decode_nonnegative(lease_expires)?;
    if table != build.table
        || index != build.index
        || generation != build.generation
        || floor != build.snapshot_head
        || floor > build.candidate_head.saturating_add(1)
        || lease_expires != build.lease_expires_at_ms
        || now_ms >= lease_expires
    {
        return Err(index_unavailable());
    }
    let expires = now_ms
        .checked_add(build.plan.body.journal_lease_ms)
        .ok_or_else(|| plan_invalid("vector journal lease renewal overflowed"))?;
    let renewed = tx.execute(
        "UPDATE _snapback_vector_journal_leases SET expires_at_ms=?2
         WHERE operation_id=?1 AND table_name=?3 AND index_name=?4
           AND generation=?5 AND floor_version=?6 AND expires_at_ms=?7",
        params![
            build.operation_id,
            to_sql_u64(expires, "vector journal lease expiry")?,
            build.table,
            build.index,
            to_sql_u64(build.generation, "vector generation")?,
            to_sql_u64(build.snapshot_head, "vector journal floor")?,
            to_sql_u64(build.lease_expires_at_ms, "vector journal lease expiry")?,
        ],
    )?;
    if renewed != 1 {
        return Err(index_unavailable());
    }
    let build_renewed = tx.execute(
        "UPDATE _snapback_vector_builds SET lease_expires_at_ms=?2
         WHERE operation_id=?1 AND lease_expires_at_ms=?3",
        params![
            build.operation_id,
            to_sql_u64(expires, "vector journal lease expiry")?,
            to_sql_u64(build.lease_expires_at_ms, "vector journal lease expiry")?,
        ],
    )?;
    if build_renewed != 1 {
        return Err(index_unavailable());
    }
    Ok(expires)
}

fn quarantine_and_commit(
    tx: Transaction<'_>,
    build: &BuildRow,
    code: &'static str,
    message: &'static str,
) -> SnapbackResult<VectorRebuildProgressV1> {
    tx.execute(
        "UPDATE _snapback_vector_builds SET status='quarantined',error_code=?2
         WHERE operation_id=?1",
        params![build.operation_id, code],
    )?;
    tx.execute(
        "UPDATE _snapback_vector_generations
         SET status='quarantined',corruption_reason=?4
         WHERE table_name=?1 AND index_name=?2 AND generation=?3",
        params![
            build.table,
            build.index,
            to_sql_u64(build.generation, "vector generation")?,
            message
        ],
    )?;
    tx.execute(
        "DELETE FROM _snapback_vector_journal_leases WHERE operation_id=?1",
        params![build.operation_id],
    )?;
    tx.commit()?;
    Err(rebuild_error(code, message))
}

fn coalesce_versioned(changes: Vec<VersionedChangedRow>) -> Vec<GenerationUpdate> {
    let mut latest = BTreeMap::<String, GenerationUpdate>::new();
    for versioned in changes {
        let change = versioned.change;
        latest.insert(
            change.id.clone(),
            GenerationUpdate {
                source_id: change.id,
                source_version: versioned.version,
                row: if change.op == ChangeOp::Delete {
                    None
                } else {
                    change.row
                },
            },
        );
    }
    latest.into_values().collect()
}

fn baseline_batch(
    tx: &Transaction<'_>,
    build: &BuildRow,
    index: &VectorIndexManifestV1,
) -> SnapbackResult<bool> {
    let cursor = build.baseline_cursor.as_deref().unwrap_or("");
    let mut statement = tx.prepare(
        "SELECT row_id,source_version,row_json
         FROM _snapback_vector_build_snapshot
         WHERE operation_id=?1 AND row_id>?2 ORDER BY row_id LIMIT ?3",
    )?;
    let rows = statement.query_map(
        params![
            build.operation_id,
            cursor,
            i64::from(build.plan.body.max_batch_rows)
        ],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    )?;
    let mut updates = Vec::new();
    let mut last = None;
    for row in rows {
        let (source_id, source_version, row_json) = row?;
        let row: Value = serde_json::from_str(&row_json).map_err(|_| index_corrupt())?;
        updates.push(GenerationUpdate {
            source_id: source_id.clone(),
            source_version: decode_nonnegative(source_version)?,
            row: Some(row),
        });
        last = Some(source_id);
    }
    if updates.is_empty() {
        tx.execute(
            "UPDATE _snapback_vector_builds
             SET status='catchup',candidate_head=snapshot_head
             WHERE operation_id=?1",
            params![build.operation_id],
        )?;
        return Ok(true);
    }
    maintain_candidate_in_tx(tx, &build.table, index, build.generation, &updates)?;
    tx.execute(
        "UPDATE _snapback_vector_builds SET baseline_cursor=?2 WHERE operation_id=?1",
        params![build.operation_id, last],
    )?;
    Ok(false)
}

fn verify_against_authoritative_source(
    tx: &Transaction<'_>,
    table: &TableManifest,
    index: &VectorIndexManifestV1,
    generation: u64,
) -> SnapbackResult<(String, u64, u64)> {
    let quoted = crate::storage::quote_ident(&table.name)?;
    let mut statement = tx.prepare(&format!("SELECT * FROM {quoted} ORDER BY \"_id\""))?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query([])?;
    let mut authoritative_ids = BTreeSet::new();
    while let Some(row) = rows.next()? {
        let value = crate::storage::row_to_document(row, table, &columns)?;
        let row_id = value
            .get("_id")
            .and_then(Value::as_str)
            .ok_or_else(index_corrupt)?;
        let source_version = value
            .get("_version")
            .and_then(Value::as_u64)
            .ok_or_else(index_corrupt)?;
        let posting = canonical_posting(index, row_id, source_version, &value)?;
        let stored: Option<(i64, String, String)> = tx
            .query_row(
                "SELECT source_version,partition_key,content_digest
                 FROM _snapback_vector_sources
                 WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND row_id=?4",
                params![
                    table.name,
                    index.name,
                    to_sql_u64(generation, "vector generation")?,
                    row_id
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        if stored
            != Some((
                to_sql_u64(source_version, "vector source version")?,
                posting.partition,
                posting.content_digest,
            ))
        {
            return Err(index_corrupt());
        }
        authoritative_ids.insert(row_id.to_owned());
    }
    let mut stored = tx.prepare(
        "SELECT row_id FROM _snapback_vector_sources
         WHERE table_name=?1 AND index_name=?2 AND generation=?3 ORDER BY row_id",
    )?;
    let stored_ids = stored.query_map(
        params![
            table.name,
            index.name,
            to_sql_u64(generation, "vector generation")?
        ],
        |row| row.get::<_, String>(0),
    )?;
    for row_id in stored_ids {
        if !authoritative_ids.contains(&row_id?) {
            return Err(index_corrupt());
        }
    }
    verify_generation(tx, &table.name, index, generation)
}

fn catchup_batch(
    tx: &Transaction<'_>,
    build: &BuildRow,
    table: &TableManifest,
    index: &VectorIndexManifestV1,
) -> SnapbackResult<bool> {
    let floor = crate::storage::change_journal_floor_on(tx)?;
    if floor > build.candidate_head.saturating_add(1) {
        return Err(rebuild_error(
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            "vector catch-up lost its leased journal suffix and must restart",
        ));
    }
    let head = crate::storage::current_version_on(tx)?;
    let (changes, cutoff) = crate::storage::versioned_changes_to_table_batch(
        tx,
        &table.name,
        build.candidate_head,
        head,
        build.plan.body.max_batch_rows as usize,
    )?;
    let updates = coalesce_versioned(changes);
    if !updates.is_empty() {
        maintain_candidate_in_tx(tx, &table.name, index, build.generation, &updates)?;
    }
    tx.execute(
        "UPDATE _snapback_vector_builds SET candidate_head=?2 WHERE operation_id=?1",
        params![
            build.operation_id,
            to_sql_u64(cutoff, "vector candidate head")?
        ],
    )?;
    if cutoff != head {
        return Ok(false);
    }
    let (root, _, _) = verify_against_authoritative_source(tx, table, index, build.generation)?;
    tx.execute(
        "UPDATE _snapback_vector_builds SET status='verified',root_digest=?2
         WHERE operation_id=?1",
        params![build.operation_id, root],
    )?;
    tx.execute(
        "UPDATE _snapback_vector_generations
         SET status='verified',source_head=?4,root_digest=?5,corruption_reason=NULL
         WHERE table_name=?1 AND index_name=?2 AND generation=?3",
        params![
            table.name,
            index.name,
            to_sql_u64(build.generation, "vector generation")?,
            to_sql_u64(head, "vector candidate head")?,
            root,
        ],
    )?;
    Ok(true)
}

/// Execute one durable baseline or catch-up batch. Progress, shadow writes,
/// the generation root, and lease renewal commit atomically.
pub(crate) fn resume_rebuild(
    conn: &mut Connection,
    schema: &SchemaManifest,
    operation_id: &str,
    now_ms: u64,
) -> SnapbackResult<VectorRebuildProgressV1> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let build = load_build(&tx, operation_id)?;
    let (table, index) = index_binding(schema, &build.table, &build.index)?;
    if manifest_digest(index)? != build.plan.body.manifest_digest {
        return quarantine_and_commit(
            tx,
            &build,
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            "installed vector declaration changed during catch-up",
        );
    }
    if matches!(
        build.state,
        VectorRebuildStateV1::Activated
            | VectorRebuildStateV1::RolledBack
            | VectorRebuildStateV1::Quarantined
    ) {
        let progress = build.progress();
        tx.rollback()?;
        return Ok(progress);
    }
    if now_ms >= build.lease_expires_at_ms {
        return quarantine_and_commit(
            tx,
            &build,
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            "vector rebuild journal lease expired; restart from a fresh snapshot",
        );
    }
    if renew_lease(&tx, &build, now_ms).is_err() {
        return quarantine_and_commit(
            tx,
            &build,
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            "vector rebuild journal lease is missing, expired, or no longer binds this build",
        );
    }
    match build.state {
        VectorRebuildStateV1::Baseline => {
            baseline_batch(&tx, &build, index)?;
        }
        VectorRebuildStateV1::Catchup => {
            if let Err(error) = catchup_batch(&tx, &build, table, index) {
                if error.diagnostic.code == "SNAPBACK_VECTOR_INDEX_UNAVAILABLE" {
                    return quarantine_and_commit(
                        tx,
                        &build,
                        "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
                        "vector catch-up journal suffix is unavailable",
                    );
                }
                if error.diagnostic.code == "SNAPBACK_VECTOR_INDEX_CORRUPT" {
                    return quarantine_and_commit(
                        tx,
                        &build,
                        "SNAPBACK_VECTOR_INDEX_CORRUPT",
                        "vector catch-up candidate failed authoritative verification",
                    );
                }
                return Err(error);
            }
        }
        VectorRebuildStateV1::Verified => {}
        VectorRebuildStateV1::Activated
        | VectorRebuildStateV1::RolledBack
        | VectorRebuildStateV1::Quarantined => unreachable!("terminal states returned above"),
    }
    tx.commit()?;
    inspect_rebuild(conn, operation_id)
}

/// Verify and publish a candidate under one bounded SQLite writer fence.
/// Catch-up too large for the approved fence is refused without changing the
/// active generation; the caller resumes ordinary batches first.
pub(crate) fn activate_rebuild(
    conn: &mut Connection,
    schema: &SchemaManifest,
    operation_id: &str,
) -> SnapbackResult<VectorRebuildReceiptV1> {
    let started = Instant::now();
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let build = load_build(&tx, operation_id)?;
    if build.state != VectorRebuildStateV1::Verified {
        return Err(index_unavailable());
    }
    let (table, index) = index_binding(schema, &build.table, &build.index)?;
    let head = crate::storage::current_version_on(&tx)?;
    if head > build.candidate_head {
        let max_writes = usize::try_from(build.plan.body.ceilings.max_writes)
            .unwrap_or(usize::MAX)
            .min(1_024);
        let (changes, cutoff) = crate::storage::versioned_changes_to_table_batch(
            &tx,
            &table.name,
            build.candidate_head,
            head,
            max_writes,
        )?;
        if cutoff != head {
            return Err(index_unavailable());
        }
        tx.execute(
            "UPDATE _snapback_vector_generations SET status='building'
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND status='verified'",
            params![
                table.name,
                index.name,
                to_sql_u64(build.generation, "vector generation")?
            ],
        )?;
        let updates = coalesce_versioned(changes);
        if !updates.is_empty() {
            maintain_candidate_in_tx(&tx, &table.name, index, build.generation, &updates)?;
        }
    }
    let (root, live_rows, frontier_rows) =
        verify_against_authoritative_source(&tx, table, index, build.generation)?;
    if started.elapsed().as_millis() as u64 > build.plan.body.ceilings.max_barrier_downtime_ms {
        return Err(rebuild_error(
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            "verified vector switch exceeded its approved fence duration",
        ));
    }
    let current_active = active_generation(&tx, &table.name, &index.name)?;
    if current_active != build.predecessor_generation {
        return Err(index_unavailable());
    }
    if let Some(predecessor) = build.predecessor_generation {
        tx.execute(
            "UPDATE _snapback_vector_generations
             SET status='retired',rollback_eligible=1
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND status='active'",
            params![
                table.name,
                index.name,
                to_sql_u64(predecessor, "predecessor vector generation")?
            ],
        )?;
    }
    let receipt = VectorRebuildReceiptV1 {
        executor: VECTOR_REBUILD_EXECUTOR.to_owned(),
        operation_id: build.operation_id.clone(),
        plan_digest: build.plan.plan_digest.clone(),
        approval_digest: build.approval_digest.clone(),
        table: table.name.clone(),
        index: index.name.clone(),
        generation: build.generation,
        predecessor_generation: build.predecessor_generation,
        source_head: head,
        root_digest: root.clone(),
        live_rows,
        frontier_rows,
        activated: true,
        rollback_eligible: build.predecessor_generation.is_some(),
    };
    tx.execute(
        "UPDATE _snapback_vector_generations
         SET status='active',source_head=?4,root_digest=?5,receipt_json=?6,
             corruption_reason=NULL,predecessor_generation=?7,activated_head=?4,
             rollback_eligible=0
         WHERE table_name=?1 AND index_name=?2 AND generation=?3",
        params![
            table.name,
            index.name,
            to_sql_u64(build.generation, "vector generation")?,
            to_sql_u64(head, "vector activation head")?,
            root,
            serde_json::to_string(&receipt)
                .map_err(|_| plan_invalid("vector rebuild receipt does not serialize"))?,
            build
                .predecessor_generation
                .map(|value| to_sql_u64(value, "predecessor vector generation"))
                .transpose()?,
        ],
    )?;
    tx.execute(
        "UPDATE _snapback_vector_builds
         SET status='activated',candidate_head=?2,root_digest=?3
         WHERE operation_id=?1",
        params![
            build.operation_id,
            to_sql_u64(head, "vector activation head")?,
            receipt.root_digest
        ],
    )?;
    tx.execute(
        "DELETE FROM _snapback_vector_journal_leases WHERE operation_id=?1",
        params![build.operation_id],
    )?;
    tx.execute(
        "DELETE FROM _snapback_vector_build_snapshot WHERE operation_id=?1",
        params![build.operation_id],
    )?;
    tx.commit()?;
    Ok(receipt)
}

/// Republish the retained predecessor only while no successor-era source
/// commit has occurred. The one-active-generation invariant and build state
/// transition commit atomically.
pub(crate) fn rollback_generation(
    conn: &mut Connection,
    schema: &SchemaManifest,
    table_name: &str,
    index_name: &str,
) -> SnapbackResult<VectorRebuildReceiptV1> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (table, _) = index_binding(schema, table_name, index_name)?;
    let active: Option<(i64, Option<i64>, Option<i64>)> = tx
        .query_row(
            "SELECT generation,predecessor_generation,activated_head
             FROM _snapback_vector_generations
             WHERE table_name=?1 AND index_name=?2 AND status='active'",
            params![table_name, index_name],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((successor, Some(predecessor), Some(activated_head))) = active else {
        return Err(index_unavailable());
    };
    let successor = decode_nonnegative(successor)?;
    let predecessor = decode_nonnegative(predecessor)?;
    let activated_head = decode_nonnegative(activated_head)?;
    if crate::storage::current_version_on(&tx)? != activated_head {
        return Err(index_unavailable());
    }
    let predecessor_row: Option<(String, String, i64)> = tx
        .query_row(
            "SELECT manifest_json,receipt_json,rollback_eligible
             FROM _snapback_vector_generations
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND status='retired'",
            params![
                table_name,
                index_name,
                to_sql_u64(predecessor, "predecessor vector generation")?
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((manifest_json, receipt_json, 1)) = predecessor_row else {
        return Err(index_unavailable());
    };
    let predecessor_index: VectorIndexManifestV1 =
        serde_json::from_str(&manifest_json).map_err(|_| index_corrupt())?;
    let (root, live_rows, frontier_rows) =
        verify_against_authoritative_source(&tx, table, &predecessor_index, predecessor)?;
    let predecessor_receipt: VectorRebuildReceiptV1 =
        serde_json::from_str(&receipt_json).map_err(|_| index_corrupt())?;
    tx.execute(
        "UPDATE _snapback_vector_generations
         SET status='retired',rollback_eligible=0
         WHERE table_name=?1 AND index_name=?2 AND generation=?3",
        params![
            table_name,
            index_name,
            to_sql_u64(successor, "successor vector generation")?
        ],
    )?;
    tx.execute(
        "UPDATE _snapback_vector_generations
         SET status='active',rollback_eligible=0,predecessor_generation=NULL,
             activated_head=?4,root_digest=?5,corruption_reason=NULL
         WHERE table_name=?1 AND index_name=?2 AND generation=?3",
        params![
            table_name,
            index_name,
            to_sql_u64(predecessor, "predecessor vector generation")?,
            to_sql_u64(activated_head, "vector rollback head")?,
            root
        ],
    )?;
    tx.execute(
        "UPDATE _snapback_vector_builds SET status='rolled-back'
         WHERE table_name=?1 AND index_name=?2 AND generation=?3",
        params![
            table_name,
            index_name,
            to_sql_u64(successor, "successor vector generation")?
        ],
    )?;
    tx.commit()?;
    Ok(VectorRebuildReceiptV1 {
        executor: VECTOR_REBUILD_EXECUTOR.to_owned(),
        operation_id: predecessor_receipt.operation_id,
        plan_digest: predecessor_receipt.plan_digest,
        approval_digest: predecessor_receipt.approval_digest,
        table: table_name.to_owned(),
        index: index_name.to_owned(),
        generation: predecessor,
        predecessor_generation: None,
        source_head: activated_head,
        root_digest: root,
        live_rows,
        frontier_rows,
        activated: true,
        rollback_eligible: false,
    })
}

pub(crate) fn inspect_rebuild(
    conn: &Connection,
    operation_id: &str,
) -> SnapbackResult<VectorRebuildProgressV1> {
    Ok(load_build(conn, operation_id)?.progress())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{FieldManifest, FieldType};
    use crate::migration::{MIGRATION_APPROVAL_SCHEMA_VERSION, MIGRATION_OPERATION_ID_PREFIX};
    use crate::storage::ChangedRow;
    use crate::vector::diagnostics::code;
    use crate::vector::storage::encode_vector_binary64_le;
    use crate::vector::{
        VECTOR_DISTANCE_PROFILE_ID, VECTOR_ORDERING_PROFILE_ID, VectorFieldClassV1,
        VectorMaintenanceLimitsV1, VectorMetricV1, VectorTieBreakV1, VectorVisibilityV1,
    };
    use tempfile::TempDir;

    fn index() -> VectorIndexManifestV1 {
        VectorIndexManifestV1 {
            format_version: 1,
            name: "by_embedding".to_owned(),
            semantic_version: "documents.embedding.v1".to_owned(),
            vector_field: "embedding".to_owned(),
            dimensions: 2,
            metric: VectorMetricV1::L2sq,
            distance_profile: VECTOR_DISTANCE_PROFILE_ID.to_owned(),
            ordering_profile: VECTOR_ORDERING_PROFILE_ID.to_owned(),
            field_classifications: BTreeMap::from([
                ("embedding".to_owned(), VectorFieldClassV1::Private),
                ("owner".to_owned(), VectorFieldClassV1::Private),
                ("status".to_owned(), VectorFieldClassV1::Private),
                ("title".to_owned(), VectorFieldClassV1::Private),
            ]),
            equality_filters: vec!["status".to_owned()],
            stored_fields: vec!["title".to_owned()],
            visibility: VectorVisibilityV1::Owner {
                field: "owner".to_owned(),
            },
            tie_break: VectorTieBreakV1::IdAsc,
            max_indexed_vectors_per_partition: 32,
            max_scalar_pairs: 64,
            maintenance_limits: VectorMaintenanceLimitsV1::default(),
        }
    }

    fn schema() -> SchemaManifest {
        SchemaManifest {
            tables: vec![TableManifest {
                name: "documents".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "embedding".to_owned(),
                        field_type: FieldType::Vector { dimensions: 2 },
                        optional: false,
                    },
                    FieldManifest {
                        name: "owner".to_owned(),
                        field_type: FieldType::Principal,
                        optional: false,
                    },
                    FieldManifest {
                        name: "status".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "title".to_owned(),
                        field_type: FieldType::Real,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                search_indexes: Vec::new(),
                vector_indexes: vec![index()],
                search_live_limits: None,
                syncable: false,
                permission_backing: false,
                permission_fields: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            }],
            ..SchemaManifest::default()
        }
    }

    fn document(id: &str, version: u64, owner: &str, title: f64) -> Value {
        serde_json::json!({
            "_id": id,
            "_version": version,
            "embedding": [title, 0.0],
            "owner": owner,
            "status": "ready",
            "title": title,
        })
    }

    fn initialize(path: &std::path::Path) -> (Connection, SchemaManifest) {
        let mut conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE _snapback_version(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
             INSERT INTO _snapback_version(id,version) VALUES(1,0);
             CREATE TABLE _snapback_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
             CREATE TABLE _snapback_changes(
               id INTEGER PRIMARY KEY AUTOINCREMENT,version INTEGER NOT NULL,
               table_name TEXT NOT NULL,row_id TEXT NOT NULL,op TEXT NOT NULL,
               row_json TEXT,changed_at_ms INTEGER NOT NULL
             );
             CREATE INDEX _snapback_changes_by_version ON _snapback_changes(version,id);
             CREATE INDEX _snapback_changes_by_table_version
               ON _snapback_changes(table_name,version);
             CREATE INDEX _snapback_changes_invalid_committed_version
               ON _snapback_changes(table_name)
               WHERE typeof(version) <> 'integer' OR version <= 0
                 OR version > 9007199254740991;
             CREATE TABLE documents(
               _id TEXT PRIMARY KEY,_version INTEGER NOT NULL,embedding BLOB NOT NULL,
               owner TEXT NOT NULL,status TEXT NOT NULL,title REAL NOT NULL
             );",
        )
        .unwrap();
        crate::vector::sqlite::create_infra(&conn).unwrap();
        let schema = schema();
        source_commit(&mut conn, &schema, 1, vec![("a", "alice", 1.0)]);
        let tx = conn.transaction().unwrap();
        crate::vector::sqlite::stage_manifest_in_tx(&tx, &schema, 1).unwrap();
        tx.commit().unwrap();
        (conn, schema)
    }

    fn source_commit(
        conn: &mut Connection,
        schema: &SchemaManifest,
        version: u64,
        rows: Vec<(&str, &str, f64)>,
    ) {
        let tx = conn.transaction().unwrap();
        let mut changes = Vec::new();
        for (id, owner, title) in rows {
            let row = document(id, version, owner, title);
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM documents WHERE _id=?1)",
                    params![id],
                    |row| row.get(0),
                )
                .unwrap();
            let op = if exists {
                tx.execute(
                    "UPDATE documents SET _version=?2,embedding=?3,owner=?4,
                         status='ready',title=?5 WHERE _id=?1",
                    params![
                        id,
                        version as i64,
                        encode_vector_binary64_le(&[title, 0.0], 2).unwrap(),
                        owner,
                        title
                    ],
                )
                .unwrap();
                ChangeOp::Update
            } else {
                tx.execute(
                    "INSERT INTO documents(_id,_version,embedding,owner,status,title)
                     VALUES (?1,?2,?3,?4,'ready',?5)",
                    params![
                        id,
                        version as i64,
                        encode_vector_binary64_le(&[title, 0.0], 2).unwrap(),
                        owner,
                        title
                    ],
                )
                .unwrap();
                ChangeOp::Insert
            };
            tx.execute(
                "INSERT INTO _snapback_changes
                 (version,table_name,row_id,op,row_json,changed_at_ms)
                 VALUES (?1,'documents',?2,?3,?4,0)",
                params![
                    version as i64,
                    id,
                    if op == ChangeOp::Insert {
                        "insert"
                    } else {
                        "update"
                    },
                    serde_json::to_string(&row).unwrap()
                ],
            )
            .unwrap();
            changes.push(ChangedRow {
                table: "documents".to_owned(),
                id: id.to_owned(),
                op,
                row: Some(row),
                changed_fields: Vec::new(),
            });
        }
        crate::vector::sqlite::maintain_vector_indexes_in_tx(&tx, schema, &changes, version)
            .unwrap();
        tx.execute(
            "UPDATE _snapback_version SET version=?1 WHERE id=1",
            params![version as i64],
        )
        .unwrap();
        tx.commit().unwrap();
    }

    fn audience(database_id: &str) -> MigrationAudienceV1 {
        MigrationAudienceV1 {
            project_id: None,
            target_id: None,
            environment_id: None,
            deployment_id: None,
            release_id: None,
            database_id: database_id.to_owned(),
            stream_incarnation: "stream-1".to_owned(),
            activation_generation: 1,
            target_profile_id: "local-dev-sqlite-ibex.v1".to_owned(),
        }
    }

    fn plan(predecessor: Option<u64>, audience: MigrationAudienceV1) -> VectorRebuildPlanV1 {
        let index = index();
        VectorRebuildPlanV1::seal(VectorRebuildPlanBodyV1 {
            schema_version: VECTOR_REBUILD_PLAN_SCHEMA_VERSION.to_owned(),
            executor: VECTOR_REBUILD_EXECUTOR.to_owned(),
            table: "documents".to_owned(),
            index: index.name.clone(),
            semantic_version: index.semantic_version.clone(),
            manifest_digest: manifest_digest(&index).unwrap(),
            predecessor_generation: predecessor,
            audience,
            ceilings: MigrationCeilings {
                max_affected_rows: 32,
                max_bytes: 1_000_000,
                max_writes: 32,
                max_barrier_downtime_ms: 10_000,
            },
            max_batch_rows: 1,
            journal_lease_ms: 10_000,
        })
        .unwrap()
    }

    fn approval(plan: &VectorRebuildPlanV1, operation_suffix: &str) -> MigrationApprovalV1 {
        MigrationApprovalV1 {
            schema_version: MIGRATION_APPROVAL_SCHEMA_VERSION.to_owned(),
            plan_digest: plan.plan_digest.clone(),
            observation_digest: "observation-1".to_owned(),
            policy_digest: "policy-1".to_owned(),
            audience: plan.body.audience.clone(),
            approver: "operator:test".to_owned(),
            generator_is_approver: false,
            issued_at_ms: 1,
            expires_at_ms: 100_000,
            operation_id: format!("{MIGRATION_OPERATION_ID_PREFIX}{operation_suffix}"),
        }
    }

    fn drive_verified(
        conn: &mut Connection,
        schema: &SchemaManifest,
        operation_id: &str,
        mut now_ms: u64,
    ) -> VectorRebuildProgressV1 {
        for _ in 0..32 {
            let progress = inspect_rebuild(conn, operation_id).unwrap();
            if progress.state == VectorRebuildStateV1::Verified {
                return progress;
            }
            now_ms += 1;
            resume_rebuild(conn, schema, operation_id, now_ms).unwrap();
        }
        panic!("vector rebuild did not reach verified state")
    }

    fn new_fixture() -> (TempDir, std::path::PathBuf, Connection, SchemaManifest) {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("vector.sqlite");
        let (conn, schema) = initialize(&path);
        (temp, path, conn, schema)
    }

    #[test]
    fn approval_binding_fixed_snapshot_restart_catchup_and_switch_are_exact() {
        let (_temp, path, mut conn, schema) = new_fixture();
        assert_eq!(
            conn.query_row(
                "SELECT status FROM _snapback_vector_generations",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "pending"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM _snapback_vector_sources", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );

        let plan = plan(None, audience("db-1"));
        let mut wrong_audience = approval(&plan, "wrong-audience");
        wrong_audience.audience.database_id = "db-elsewhere".to_owned();
        let error = begin_rebuild(&mut conn, &schema, &plan, &wrong_audience, 10)
            .expect_err("approval audience mismatch refuses");
        assert_eq!(error.diagnostic.code, code::MAINTENANCE_FAILED);

        let approval = approval(&plan, "restart-catchup");
        let begun = begin_rebuild(&mut conn, &schema, &plan, &approval, 10).unwrap();
        assert_eq!(begun.state, VectorRebuildStateV1::Baseline);
        assert_eq!((begun.snapshot_head, begun.candidate_head), (1, 1));
        let mut colliding_approval = approval.clone();
        colliding_approval.policy_digest = "policy-elsewhere".to_owned();
        let collision = begin_rebuild(&mut conn, &schema, &plan, &colliding_approval, 11)
            .expect_err("operation id cannot adopt another approval");
        assert_eq!(collision.diagnostic.code, code::MAINTENANCE_FAILED);

        source_commit(
            &mut conn,
            &schema,
            2,
            vec![("a", "alice", 2.0), ("b", "bob", 3.0)],
        );
        let frozen_title: f64 = conn
            .query_row(
                "SELECT json_extract(row_json,'$.title')
                 FROM _snapback_vector_build_snapshot WHERE row_id='a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(frozen_title, 1.0);

        resume_rebuild(&mut conn, &schema, &approval.operation_id, 12).unwrap();
        drop(conn);
        let mut conn = Connection::open(path).unwrap();
        let verified = drive_verified(&mut conn, &schema, &approval.operation_id, 12);
        assert_eq!(verified.candidate_head, 2);
        let versions = conn
            .prepare(
                "SELECT row_id,source_version FROM _snapback_vector_sources
                 WHERE generation=?1 ORDER BY row_id",
            )
            .unwrap()
            .query_map(params![verified.generation as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(versions, vec![("a".to_owned(), 2), ("b".to_owned(), 2)]);
        let receipt = activate_rebuild(&mut conn, &schema, &approval.operation_id).unwrap();
        assert_eq!((receipt.source_head, receipt.live_rows), (2, 2));
        assert_eq!(
            conn.query_row(
                "SELECT generation FROM _snapback_vector_generations WHERE status='active'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            verified.generation as i64
        );
    }

    #[test]
    fn missing_lease_and_lost_journal_floor_quarantine_durably() {
        let (_temp, _path, mut conn, schema) = new_fixture();
        let lease_plan = plan(None, audience("db-lease"));
        let lease_approval = approval(&lease_plan, "lease-loss");
        begin_rebuild(&mut conn, &schema, &lease_plan, &lease_approval, 10).unwrap();
        conn.execute(
            "DELETE FROM _snapback_vector_journal_leases WHERE operation_id=?1",
            params![lease_approval.operation_id],
        )
        .unwrap();
        let error = resume_rebuild(&mut conn, &schema, &lease_approval.operation_id, 11)
            .expect_err("deleted lease quarantines");
        assert_eq!(error.diagnostic.code, code::INDEX_UNAVAILABLE);
        assert_eq!(
            inspect_rebuild(&conn, &lease_approval.operation_id)
                .unwrap()
                .state,
            VectorRebuildStateV1::Quarantined
        );

        let (_temp, _path, mut conn, schema) = new_fixture();
        let plan = plan(None, audience("db-floor"));
        let approval = approval(&plan, "floor-loss");
        begin_rebuild(&mut conn, &schema, &plan, &approval, 10).unwrap();
        resume_rebuild(&mut conn, &schema, &approval.operation_id, 11).unwrap();
        resume_rebuild(&mut conn, &schema, &approval.operation_id, 12).unwrap();
        assert_eq!(
            inspect_rebuild(&conn, &approval.operation_id)
                .unwrap()
                .state,
            VectorRebuildStateV1::Catchup
        );
        source_commit(&mut conn, &schema, 3, vec![("a", "alice", 3.0)]);
        conn.execute(
            "INSERT INTO _snapback_meta(key,value) VALUES('retention_floor','3')",
            [],
        )
        .unwrap();
        let error = resume_rebuild(&mut conn, &schema, &approval.operation_id, 13)
            .expect_err("lost journal suffix quarantines");
        assert_eq!(error.diagnostic.code, code::INDEX_UNAVAILABLE);
        assert_eq!(
            inspect_rebuild(&conn, &approval.operation_id)
                .unwrap()
                .state,
            VectorRebuildStateV1::Quarantined
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM _snapback_vector_journal_leases
                 WHERE operation_id=?1",
                params![approval.operation_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }

    fn build_and_activate(
        conn: &mut Connection,
        schema: &SchemaManifest,
        predecessor: Option<u64>,
        suffix: &str,
    ) -> VectorRebuildReceiptV1 {
        let plan = plan(predecessor, audience(&format!("db-{suffix}")));
        let approval = approval(&plan, suffix);
        begin_rebuild(conn, schema, &plan, &approval, 10).unwrap();
        drive_verified(conn, schema, &approval.operation_id, 10);
        activate_rebuild(conn, schema, &approval.operation_id).unwrap()
    }

    #[test]
    fn predecessor_rollback_closes_at_first_successor_source_commit() {
        let (_temp, _path, mut conn, schema) = new_fixture();
        let first = build_and_activate(&mut conn, &schema, None, "first");
        let second = build_and_activate(&mut conn, &schema, Some(first.generation), "second");
        assert!(second.rollback_eligible);
        let rolled_back =
            rollback_generation(&mut conn, &schema, "documents", "by_embedding").unwrap();
        assert_eq!(rolled_back.generation, first.generation);

        let third = build_and_activate(&mut conn, &schema, Some(first.generation), "third");
        assert!(third.rollback_eligible);
        source_commit(&mut conn, &schema, 2, vec![("a", "alice", 4.0)]);
        let eligible: i64 = conn
            .query_row(
                "SELECT rollback_eligible FROM _snapback_vector_generations
                 WHERE generation=?1",
                params![first.generation as i64],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(eligible, 0);
        let error = rollback_generation(&mut conn, &schema, "documents", "by_embedding")
            .expect_err("first successor commit closes rollback");
        assert_eq!(error.diagnostic.code, code::INDEX_UNAVAILABLE);
    }
}
