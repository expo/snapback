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
    let canonical = crate::rqs::jcs(&value)
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
    let raw: Option<(
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
    )> = conn
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
pub fn begin_rebuild(
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
    if let Some(existing) = tx
        .query_row(
            "SELECT 1 FROM _snapback_vector_builds WHERE operation_id=?1",
            params![approval.operation_id],
            |_| Ok(()),
        )
        .optional()?
    {
        let _ = existing;
        let progress = load_build(&tx, &approval.operation_id)?.progress();
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
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,0,NULL,'baseline',?11,?12,?13)",
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
    let expires = now_ms
        .checked_add(build.plan.body.journal_lease_ms)
        .ok_or_else(|| plan_invalid("vector journal lease renewal overflowed"))?;
    tx.execute(
        "UPDATE _snapback_vector_journal_leases SET expires_at_ms=?2
         WHERE operation_id=?1",
        params![
            build.operation_id,
            to_sql_u64(expires, "vector journal lease expiry")?
        ],
    )?;
    tx.execute(
        "UPDATE _snapback_vector_builds SET lease_expires_at_ms=?2
         WHERE operation_id=?1",
        params![
            build.operation_id,
            to_sql_u64(expires, "vector journal lease expiry")?
        ],
    )?;
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
pub fn resume_rebuild(
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
    renew_lease(&tx, &build, now_ms)?;
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
pub fn activate_rebuild(
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
pub fn rollback_generation(
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

pub fn inspect_rebuild(
    conn: &Connection,
    operation_id: &str,
) -> SnapbackResult<VectorRebuildProgressV1> {
    Ok(load_build(conn, operation_id)?.progress())
}
