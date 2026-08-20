//! Transactional SQLite maintenance for exact vector-index generations.
//!
//! This module owns derived write state only. Query execution is deliberately
//! isolated in `vector::query`, so adding or qualifying the read surface does
//! not change the source-commit boundary implemented here.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{HandlerInput, QueryOutput, SchemaManifest, TableManifest};
use crate::storage::{ChangeOp, ChangedRow};
use crate::vector::diagnostics::{corpus_bound, index_corrupt, index_unavailable, query_invalid};
use crate::vector::query::{
    VectorAuthoritativeReleaseV1, VectorPostingV1, VectorWorkCountersV1, evaluate_vector_query,
    vector_posting_content_digest,
};
use crate::vector::storage::{
    VectorFrontierCasV1, VectorMaintenanceBudget, VectorSourceFrontierV1,
    VectorSourceUpdateIdentityV1, classify_vector_frontier_cas, encode_vector_binary64_le,
};
use crate::vector::types::{
    VectorIndexManifestV1, VectorQueryPlanV1, VectorRequestV1, VectorVisibilityV1,
};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

const ROOT_PREFIX: &str = "sha256-xor-v1:";

fn maintenance_error(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        crate::vector::diagnostics::code::MAINTENANCE_FAILED,
        crate::vector::diagnostics::VECTOR_DIAGNOSTIC_SUBSYSTEM,
        message,
    )
}

fn to_sql_u64(value: u64, context: &str) -> SnapbackResult<i64> {
    i64::try_from(value)
        .map_err(|_| maintenance_error(format!("{context} exceeds SQLite's signed integer domain")))
}

fn decode_nonnegative(value: i64) -> SnapbackResult<u64> {
    u64::try_from(value).map_err(|_| index_corrupt())
}

/// Install the ordinary shadow-state relations used by both synchronous
/// maintenance and the vector-specific derived catch-up executor.
///
/// @ref LLP 0132#index-maintenance-and-storage — source rows, postings,
///   frontiers, tombstones, generations, builds, and leases share the same
///   transactional SQLite durability domain as authoritative application rows.
pub(crate) fn create_infra(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS _snapback_vector_generations (
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          semantic_version TEXT NOT NULL,
          manifest_digest TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          generation INTEGER NOT NULL,
          status TEXT NOT NULL,
          source_head INTEGER NOT NULL,
          root_digest TEXT NOT NULL,
          receipt_json TEXT NOT NULL,
          corruption_reason TEXT,
          predecessor_generation INTEGER,
          activated_head INTEGER,
          rollback_eligible INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(table_name,index_name,generation)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS _snapback_vector_one_active_generation
          ON _snapback_vector_generations(table_name,index_name)
          WHERE status='active';
        CREATE TABLE IF NOT EXISTS _snapback_vector_sources (
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          generation INTEGER NOT NULL,
          row_id TEXT NOT NULL,
          source_version INTEGER NOT NULL,
          partition_key TEXT NOT NULL,
          vector_blob BLOB NOT NULL,
          filters_json TEXT NOT NULL,
          fields_json TEXT NOT NULL,
          content_digest TEXT NOT NULL,
          PRIMARY KEY(table_name,index_name,generation,row_id)
        );
        CREATE INDEX IF NOT EXISTS _snapback_vector_sources_partition
          ON _snapback_vector_sources(
            table_name,index_name,generation,partition_key,row_id
          );
        CREATE TABLE IF NOT EXISTS _snapback_vector_frontiers (
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          generation INTEGER NOT NULL,
          source_id TEXT NOT NULL,
          highest_version INTEGER NOT NULL,
          tombstone INTEGER NOT NULL,
          content_digest TEXT NOT NULL,
          PRIMARY KEY(table_name,index_name,generation,source_id)
        );
        CREATE TABLE IF NOT EXISTS _snapback_vector_builds (
          operation_id TEXT PRIMARY KEY,
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          generation INTEGER NOT NULL,
          predecessor_generation INTEGER,
          plan_digest TEXT NOT NULL,
          approval_digest TEXT NOT NULL,
          plan_json TEXT NOT NULL,
          approval_json TEXT NOT NULL,
          snapshot_head INTEGER NOT NULL,
          candidate_head INTEGER NOT NULL,
          baseline_cursor TEXT,
          status TEXT NOT NULL,
          root_digest TEXT,
          snapshot_rows INTEGER NOT NULL,
          snapshot_bytes INTEGER NOT NULL,
          lease_expires_at_ms INTEGER NOT NULL,
          error_code TEXT,
          UNIQUE(table_name,index_name,generation)
        );
        CREATE TABLE IF NOT EXISTS _snapback_vector_build_snapshot (
          operation_id TEXT NOT NULL,
          row_id TEXT NOT NULL,
          source_version INTEGER NOT NULL,
          row_json TEXT NOT NULL,
          PRIMARY KEY(operation_id,row_id)
        );
        CREATE TABLE IF NOT EXISTS _snapback_vector_journal_leases (
          operation_id TEXT PRIMARY KEY,
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          generation INTEGER NOT NULL,
          floor_version INTEGER NOT NULL,
          expires_at_ms INTEGER NOT NULL
        );
        ",
    )?;

    // Writes outside the canonical maintainer invalidate an active seal. The
    // maintainer moves an active generation through transaction-local
    // `maintaining` before touching rows, verifies the result, and reseals it
    // before commit; candidate builds remain `building` until verification.
    for (relation, event) in [
        ("sources", "INSERT"),
        ("sources", "UPDATE"),
        ("sources", "DELETE"),
        ("frontiers", "INSERT"),
        ("frontiers", "UPDATE"),
        ("frontiers", "DELETE"),
    ] {
        let timing = event.to_ascii_lowercase();
        let row = if event == "DELETE" { "OLD" } else { "NEW" };
        conn.execute_batch(&format!(
            "CREATE TRIGGER IF NOT EXISTS _snapback_vector_{relation}_{timing}_quarantine
             AFTER {event} ON _snapback_vector_{relation}
             BEGIN
               UPDATE _snapback_vector_generations
               SET status='quarantined',
                   corruption_reason='derived vector state changed without a verified generation seal'
               WHERE table_name={row}.table_name
                 AND index_name={row}.index_name
                 AND generation={row}.generation
                 AND status IN ('active','quarantined');
             END;"
        ))?;
    }
    Ok(())
}

pub fn manifest_digest(index: &VectorIndexManifestV1) -> SnapbackResult<String> {
    let value = serde_json::to_value(index)
        .map_err(|_| maintenance_error("vector index manifest does not serialize"))?;
    crate::rqs_contract::sha256_identity(&value)
        .map_err(|_| maintenance_error("vector index manifest is not canonicalizable"))
}

fn manifest_json(index: &VectorIndexManifestV1) -> SnapbackResult<String> {
    serde_json::to_string(index)
        .map_err(|_| maintenance_error("vector index manifest does not serialize"))
}

/// Record candidate generations only. Schema installation never scans source
/// rows and never activates a nonempty index; an approved rebuild operation
/// owns snapshot creation and publication.
///
/// @ref LLP 0073#rebuilds-and-migrations — declaration installation and
///   verified generation activation are distinct durability boundaries.
pub(crate) fn stage_manifest_in_tx(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    source_head: u64,
) -> SnapbackResult<()> {
    for table in &schema.tables {
        for index in &table.vector_indexes {
            crate::manifest::validate_vector_index_manifest(table, index)?;
            let digest = manifest_digest(index)?;
            let existing: Option<(i64, String)> = tx
                .query_row(
                    "SELECT generation,status FROM _snapback_vector_generations
                     WHERE table_name=?1 AND index_name=?2 AND manifest_digest=?3
                       AND status IN ('pending','building','verified','active')
                     ORDER BY generation DESC LIMIT 1",
                    params![table.name, index.name, digest],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            if existing.is_some() {
                continue;
            }
            tx.execute(
                "UPDATE _snapback_vector_generations
                 SET status='superseded'
                 WHERE table_name=?1 AND index_name=?2 AND status='pending'",
                params![table.name, index.name],
            )?;
            let generation: i64 = tx.query_row(
                "SELECT COALESCE(MAX(generation),0)+1
                 FROM _snapback_vector_generations
                 WHERE table_name=?1 AND index_name=?2",
                params![table.name, index.name],
                |row| row.get(0),
            )?;
            tx.execute(
                "INSERT INTO _snapback_vector_generations
                 (table_name,index_name,semantic_version,manifest_digest,manifest_json,
                  generation,status,source_head,root_digest,receipt_json)
                 VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,?8,'{}')",
                params![
                    table.name,
                    index.name,
                    index.semantic_version,
                    digest,
                    manifest_json(index)?,
                    generation,
                    to_sql_u64(source_head, "vector staging source head")?,
                    empty_generation_root(),
                ],
            )?;
        }
    }
    Ok(())
}

/// Explicit adapter output: the ordinary query envelope and the logical work
/// evidence are returned together, while physical generation identity stays
/// an internal storage concern.
#[derive(Clone, Debug, PartialEq)]
#[allow(dead_code)] // consumed by the VEC runtime-integration lane
pub struct VectorSqliteQueryResultV1 {
    pub output: QueryOutput,
    pub counters: VectorWorkCountersV1,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[allow(dead_code)] // carried privately from read lane to writer quarantine
pub struct VectorGenerationIdentity {
    table: String,
    index: String,
    generation: u64,
}

/// Process-local fence between corruption detection and durable quarantine.
///
/// A read transaction cannot update the generation row it has pinned. The
/// fence therefore makes the exact generation unselectable immediately, while
/// the detecting request releases its read and opens the bounded writer that
/// records the durable quarantine. The generation query-facts binding covers
/// the target table's complete field declarations and vector manifest, so a
/// caller-made `ReaderPool::with_pinned_read` schema cannot fence a healthy
/// generation while an unrelated additive schema activation remains outside
/// the comparison.
///
/// @ref LLP 0132#candidate-to-release-consistency — release-recheck drift
/// fails closed without a post-detection selection window.
#[derive(Debug)]
pub(crate) struct PendingVectorQuarantineGate {
    state: Mutex<PendingVectorQuarantineState>,
}

#[derive(Debug)]
struct PendingVectorQuarantineState {
    schema: SchemaManifest,
    generations: BTreeSet<VectorGenerationIdentity>,
}

impl PendingVectorQuarantineGate {
    pub(crate) fn new(schema: &SchemaManifest) -> Self {
        Self {
            state: Mutex::new(PendingVectorQuarantineState {
                schema: schema.clone(),
                generations: BTreeSet::new(),
            }),
        }
    }

    pub(crate) fn set_schema(&self, schema: &SchemaManifest) {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .schema = schema.clone();
    }

    fn mark_if_current_generation_query_facts(
        &self,
        identity: &VectorGenerationIdentity,
        query_schema: &SchemaManifest,
    ) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let current_facts = generation_query_facts_in_schema(&state.schema, identity);
        let query_facts = generation_query_facts_in_schema(query_schema, identity);
        if query_facts.is_some() && current_facts == query_facts {
            state.generations.insert(identity.clone());
        }
    }

    pub(crate) fn contains(&self, identity: &VectorGenerationIdentity) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .generations
            .contains(identity)
    }

    pub(crate) fn clear(&self, identity: &VectorGenerationIdentity) {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .generations
            .remove(identity);
    }
}

/// Every schema fact consumed by the SQLite vector query path. The full field
/// list is load-bearing even for an unfiltered request because authoritative
/// release decodes every physical source column before reconstructing the
/// canonical posting. Other tables and non-vector table declarations are not
/// consulted by this path and therefore do not make a surviving generation
/// stale.
#[derive(Debug, PartialEq)]
struct VectorGenerationQueryFacts<'a> {
    table_name: &'a str,
    fields: &'a [crate::manifest::FieldManifest],
    index: &'a VectorIndexManifestV1,
}

fn generation_query_facts_in_schema<'a>(
    schema: &'a SchemaManifest,
    identity: &VectorGenerationIdentity,
) -> Option<VectorGenerationQueryFacts<'a>> {
    let table = schema.table(&identity.table)?;
    let index = table
        .vector_indexes
        .iter()
        .find(|index| index.name == identity.index)?;
    Some(VectorGenerationQueryFacts {
        table_name: &table.name,
        fields: &table.fields,
        index,
    })
}

#[derive(Clone, Debug, PartialEq)]
#[allow(dead_code)] // consumed by the VEC runtime-integration lane
pub struct VectorSqliteQueryFailure {
    error: SnapbackError,
    quarantine_target: Option<VectorGenerationIdentity>,
    database_binding: Option<crate::storage::DatabaseBinding>,
    query_schema: Option<SchemaManifest>,
}

impl VectorSqliteQueryFailure {
    pub fn error(&self) -> &SnapbackError {
        &self.error
    }

    pub(crate) fn into_parts(
        self,
    ) -> (
        SnapbackError,
        Option<VectorGenerationIdentity>,
        Option<crate::storage::DatabaseBinding>,
        Option<SchemaManifest>,
    ) {
        (
            self.error,
            self.quarantine_target,
            self.database_binding,
            self.query_schema,
        )
    }

    pub(crate) fn bind_to(
        mut self,
        database_binding: Option<crate::storage::DatabaseBinding>,
    ) -> Self {
        self.database_binding = database_binding;
        self
    }

    pub(crate) fn is_bound_to(&self, database_binding: &crate::storage::DatabaseBinding) -> bool {
        self.database_binding
            .as_ref()
            .is_some_and(|binding| binding.matches(database_binding))
    }

    pub(crate) fn with_query_schema(mut self, schema: &SchemaManifest) -> Self {
        self.query_schema = Some(schema.clone());
        self
    }

    fn without_target(error: SnapbackError) -> Self {
        Self {
            error,
            quarantine_target: None,
            database_binding: None,
            query_schema: None,
        }
    }

    fn for_generation(error: SnapbackError, identity: &VectorGenerationIdentity) -> Self {
        let quarantine_target = (error.diagnostic.code
            == crate::vector::diagnostics::code::INDEX_CORRUPT)
            .then(|| identity.clone());
        Self {
            error,
            quarantine_target,
            database_binding: None,
            query_schema: None,
        }
    }
}

fn query_index<'a>(
    schema: &'a SchemaManifest,
    plan: &VectorQueryPlanV1,
) -> SnapbackResult<(&'a TableManifest, &'a VectorIndexManifestV1)> {
    crate::manifest::validate_vector_query_plan_shape(plan)?;
    let table = schema.table(&plan.table).ok_or_else(index_unavailable)?;
    let index = table
        .vector_indexes
        .iter()
        .find(|index| index.name == plan.index)
        .ok_or_else(index_unavailable)?;
    Ok((table, index))
}

fn active_query_generation(
    conn: &Connection,
    table: &TableManifest,
    index: &VectorIndexManifestV1,
    quarantine_gate: Option<&PendingVectorQuarantineGate>,
) -> Result<VectorGenerationIdentity, VectorSqliteQueryFailure> {
    type ActiveGenerationRow = (i64, String, String, i64, String, String, Option<i64>);
    let active: Option<ActiveGenerationRow> = conn
        .query_row(
            "SELECT generation,semantic_version,manifest_digest,source_head,root_digest,
                    receipt_json,predecessor_generation
             FROM _snapback_vector_generations
             WHERE table_name=?1 AND index_name=?2 AND status='active'",
            params![table.name, index.name],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(SnapbackError::from)
        .map_err(VectorSqliteQueryFailure::without_target)?;
    let Some((generation, semantic_version, digest, source_head, root, receipt_json, predecessor)) =
        active
    else {
        let quarantined: bool = conn
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM _snapback_vector_generations
                   WHERE table_name=?1 AND index_name=?2 AND status='quarantined'
                 )",
                params![table.name, index.name],
                |row| row.get(0),
            )
            .map_err(SnapbackError::from)
            .map_err(VectorSqliteQueryFailure::without_target)?;
        return Err(VectorSqliteQueryFailure::without_target(if quarantined {
            index_corrupt()
        } else {
            index_unavailable()
        }));
    };
    let generation =
        decode_nonnegative(generation).map_err(VectorSqliteQueryFailure::without_target)?;
    let identity = VectorGenerationIdentity {
        table: table.name.clone(),
        index: index.name.clone(),
        generation,
    };
    if quarantine_gate.is_some_and(|gate| gate.contains(&identity)) {
        return Err(VectorSqliteQueryFailure::without_target(index_corrupt()));
    }
    let source_head = decode_nonnegative(source_head)
        .map_err(|error| VectorSqliteQueryFailure::for_generation(error, &identity))?;
    let predecessor = predecessor
        .map(decode_nonnegative)
        .transpose()
        .map_err(|error| VectorSqliteQueryFailure::for_generation(error, &identity))?;
    let receipt: crate::vector::rebuild::VectorRebuildReceiptV1 =
        serde_json::from_str(&receipt_json)
            .map_err(|_| VectorSqliteQueryFailure::for_generation(index_corrupt(), &identity))?;
    let expected_manifest_digest = manifest_digest(index)
        .map_err(|error| VectorSqliteQueryFailure::for_generation(error, &identity))?;
    if semantic_version != index.semantic_version
        || digest != expected_manifest_digest
        || !root.starts_with(ROOT_PREFIX)
        || receipt.executor != crate::vector::rebuild::VECTOR_REBUILD_EXECUTOR
        || receipt.table != table.name
        || receipt.index != index.name
        || receipt.generation != generation
        || receipt.predecessor_generation != predecessor
        || receipt.source_head != source_head
        || receipt.root_digest != root
        || !receipt.activated
    {
        return Err(VectorSqliteQueryFailure::for_generation(
            index_corrupt(),
            &identity,
        ));
    }
    Ok(identity)
}

fn load_authoritative_row(
    conn: &Connection,
    table: &TableManifest,
    row_id: &str,
) -> SnapbackResult<Option<Value>> {
    let quoted = crate::storage::quote_ident(&table.name)?;
    let mut statement =
        conn.prepare(&format!("SELECT * FROM {quoted} WHERE \"_id\"=?1 LIMIT 1"))?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query(params![row_id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    Ok(Some(crate::storage::row_to_document(row, table, &columns)?))
}

/// Mark one exact physical generation unusable. Read-pool connections are
/// deliberately `query_only`; callers use the private quarantine target on
/// [`VectorSqliteQueryFailure`] to invoke this helper on the writer lane. The
/// exact identity prevents a delayed report from poisoning a newer generation.
#[allow(dead_code)] // invoked by the VEC runtime-integration writer lane
pub(crate) fn quarantine_generation_on(
    conn: &Connection,
    identity: &VectorGenerationIdentity,
    reason: &'static str,
) -> SnapbackResult<bool> {
    let changed = conn.execute(
        "UPDATE _snapback_vector_generations
         SET status='quarantined',corruption_reason=?4,rollback_eligible=0
         WHERE table_name=?1 AND index_name=?2 AND generation=?3
           AND status IN ('active','maintaining','verified','building')",
        params![
            identity.table,
            identity.index,
            to_sql_u64(identity.generation, "vector generation")?,
            reason
        ],
    )?;
    if changed > 1 {
        return Err(index_corrupt());
    }
    Ok(changed == 1)
}

/// Re-derive every query-consumed schema fact plus the immutable vector
/// manifest bound to the exact generation before an opaque read-lane failure
/// can change generation state. This rejects a failure induced through
/// `ReaderPool::with_pinned_read` with caller-made field or vector facts, even
/// when the failure carries this database's private binding, while allowing an
/// older whole-schema snapshot to settle when an unrelated additive activation
/// preserved this generation and its complete query-facts projection.
pub(crate) fn quarantine_generation_for_schema_on(
    conn: &Connection,
    identity: &VectorGenerationIdentity,
    query_schema: &SchemaManifest,
    reason: &'static str,
) -> SnapbackResult<bool> {
    let bound: Option<(String, String, String)> = conn
        .query_row(
            "SELECT semantic_version,manifest_digest,manifest_json
             FROM _snapback_vector_generations
             WHERE table_name=?1 AND index_name=?2 AND generation=?3",
            params![
                identity.table,
                identity.index,
                to_sql_u64(identity.generation, "vector generation")?
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((semantic_version, stored_digest, stored_manifest)) = bound else {
        return Err(index_corrupt());
    };
    let active_schema =
        crate::storage::active_schema_manifest_from_connection(conn)?.ok_or_else(index_corrupt)?;
    let active_facts =
        generation_query_facts_in_schema(&active_schema, identity).ok_or_else(index_corrupt)?;
    let query_facts =
        generation_query_facts_in_schema(query_schema, identity).ok_or_else(index_corrupt)?;
    let durable_manifest: VectorIndexManifestV1 =
        serde_json::from_str(&stored_manifest).map_err(|_| index_corrupt())?;
    if durable_manifest.name != identity.index
        || active_facts != query_facts
        || durable_manifest != *query_facts.index
        || semantic_version != query_facts.index.semantic_version
        || stored_digest != manifest_digest(query_facts.index)?
        || stored_digest != manifest_digest(&durable_manifest)?
    {
        return Err(index_corrupt());
    }
    quarantine_generation_on(conn, identity, reason)
}

/// Evaluate one vector plan entirely inside the caller's already-pinned
/// SQLite snapshot. Owner authority is accepted only through the explicit
/// server-resolved `owner_subject`; `input.auth` is never consulted.
///
/// Release drift is tagged with the exact generation that must be quarantined
/// on the writer lane. The adapter returns no partial page.
///
/// @ref LLP 0132#candidate-to-release-consistency — candidates and their
///   authoritative release derivations are read from the same source cut.
#[allow(dead_code)] // invoked by the VEC runtime-integration read lane
pub(crate) fn query_vector_on(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &VectorQueryPlanV1,
    input: &HandlerInput,
    owner_subject: Option<&str>,
) -> Result<VectorSqliteQueryResultV1, VectorSqliteQueryFailure> {
    query_vector_on_with_quarantine_gate(conn, schema, plan, input, owner_subject, None)
}

pub(crate) fn query_vector_on_with_quarantine_gate(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &VectorQueryPlanV1,
    input: &HandlerInput,
    owner_subject: Option<&str>,
    quarantine_gate: Option<&PendingVectorQuarantineGate>,
) -> Result<VectorSqliteQueryResultV1, VectorSqliteQueryFailure> {
    let (table, index) =
        query_index(schema, plan).map_err(VectorSqliteQueryFailure::without_target)?;
    let snapshot_version = crate::storage::current_version_on(conn)
        .map_err(VectorSqliteQueryFailure::without_target)?;
    let identity =
        active_query_generation(conn, table, index, quarantine_gate).map_err(|failure| {
            if let (Some(gate), Some(identity)) = (quarantine_gate, &failure.quarantine_target) {
                gate.mark_if_current_generation_query_facts(identity, schema);
            }
            failure
        })?;
    query_vector_generation_on(
        conn,
        table,
        index,
        input,
        owner_subject,
        snapshot_version,
        &identity,
    )
    .map_err(|error| {
        let failure = VectorSqliteQueryFailure::for_generation(error, &identity);
        if let (Some(gate), Some(identity)) = (quarantine_gate, &failure.quarantine_target) {
            gate.mark_if_current_generation_query_facts(identity, schema);
        }
        failure
    })
}

#[allow(clippy::too_many_arguments)]
fn query_vector_generation_on(
    conn: &Connection,
    table: &TableManifest,
    index: &VectorIndexManifestV1,
    input: &HandlerInput,
    owner_subject: Option<&str>,
    snapshot_version: u64,
    identity: &VectorGenerationIdentity,
) -> SnapbackResult<VectorSqliteQueryResultV1> {
    let partition = match &index.visibility {
        VectorVisibilityV1::PublicRead => "public".to_owned(),
        VectorVisibilityV1::Owner { .. } => owner_subject
            .filter(|subject| !subject.is_empty())
            .map(|subject| format!("owner:{subject}"))
            .ok_or_else(query_invalid)?,
    };
    let request: VectorRequestV1 =
        serde_path_to_error::deserialize(input.args.clone()).map_err(|_| query_invalid())?;
    let mut statement = conn.prepare(
        "SELECT row_id,source_version,partition_key,vector_blob,filters_json,fields_json,
                content_digest
         FROM _snapback_vector_sources
         WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND partition_key=?4
         ORDER BY row_id",
    )?;
    let postings = statement
        .query_map(
            params![
                table.name,
                index.name,
                to_sql_u64(identity.generation, "vector generation")?,
                partition
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Vec<u8>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )?
        .map(|row| {
            let (row_id, source_version, partition, vector_bytes, filters, fields, digest) = row?;
            Ok(VectorPostingV1 {
                row_id,
                source_version: decode_nonnegative(source_version)?,
                partition,
                vector_bytes,
                filters: serde_json::from_str(&filters).map_err(|_| index_corrupt())?,
                fields: serde_json::from_str(&fields).map_err(|_| index_corrupt())?,
                content_digest: digest,
            })
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    drop(statement);

    let evaluation =
        evaluate_vector_query(table, index, &partition, request, postings, |candidate| {
            let Some(row) = load_authoritative_row(conn, table, candidate.row_id)? else {
                return Err(index_corrupt());
            };
            let source_version = row
                .get("_version")
                .and_then(Value::as_u64)
                .filter(|version| *version <= snapshot_version)
                .ok_or_else(index_corrupt)?;
            let posting = canonical_posting(index, candidate.row_id, source_version, &row)
                .map_err(|_| index_corrupt())?;
            let authorized = posting.partition == partition;
            let release = VectorAuthoritativeReleaseV1 {
                source_version,
                partition: posting.partition,
                content_digest: posting.content_digest,
                authorized,
                fields: posting.fields,
            };
            Ok(Some(release))
        })?;
    Ok(VectorSqliteQueryResultV1 {
        output: QueryOutput {
            version: snapshot_version,
            rows: evaluation
                .page
                .items
                .into_iter()
                .map(|item| serde_json::to_value(item).expect("vector item serializes"))
                .collect(),
            cursor: None,
        },
        counters: evaluation.counters,
    })
}

fn partition_for(index: &VectorIndexManifestV1, row: &Value) -> SnapbackResult<String> {
    match &index.visibility {
        VectorVisibilityV1::PublicRead => Ok("public".to_owned()),
        VectorVisibilityV1::Owner { field } => row
            .get(field)
            .and_then(Value::as_str)
            .map(|owner| format!("owner:{owner}"))
            .ok_or_else(crate::vector::diagnostics::value_invalid),
    }
}

fn vector_from_row(index: &VectorIndexManifestV1, row: &Value) -> SnapbackResult<Vec<f64>> {
    row.get(&index.vector_field)
        .and_then(Value::as_array)
        .ok_or_else(crate::vector::diagnostics::value_invalid)?
        .iter()
        .map(|value| {
            value
                .as_f64()
                .ok_or_else(crate::vector::diagnostics::value_invalid)
        })
        .collect()
}

fn projected_map(fields: &[String], row: &Value) -> Map<String, Value> {
    fields
        .iter()
        .map(|field| {
            (
                field.clone(),
                row.get(field).cloned().unwrap_or(Value::Null),
            )
        })
        .collect()
}

#[derive(Clone, Debug)]
pub struct CanonicalPosting {
    pub partition: String,
    pub vector_blob: Vec<u8>,
    pub filters: Map<String, Value>,
    pub fields: Map<String, Value>,
    pub content_digest: String,
}

pub fn canonical_posting(
    index: &VectorIndexManifestV1,
    row_id: &str,
    source_version: u64,
    row: &Value,
) -> SnapbackResult<CanonicalPosting> {
    let partition = partition_for(index, row)?;
    let raw_vector = vector_from_row(index, row)?;
    let vector_blob = encode_vector_binary64_le(&raw_vector, index.dimensions)?;
    let vector = crate::vector::storage::decode_vector_binary64_le(&vector_blob, index.dimensions)?;
    let filters = projected_map(&index.equality_filters, row);
    let fields = projected_map(&index.stored_fields, row);
    let content_digest = vector_posting_content_digest(
        row_id,
        source_version,
        &partition,
        &vector,
        &filters,
        &fields,
    )?;
    Ok(CanonicalPosting {
        partition,
        vector_blob,
        filters,
        fields,
        content_digest,
    })
}

fn tombstone_digest(row_id: &str, source_version: u64) -> SnapbackResult<String> {
    crate::rqs_contract::sha256_identity(&json!({
        "rowId": row_id,
        "sourceVersion": source_version,
        "tombstone": true,
    }))
    .map_err(|_| maintenance_error("vector tombstone identity is not canonicalizable"))
}

fn decode_sha256_digest(digest: &str) -> SnapbackResult<[u8; 32]> {
    let encoded = digest.strip_prefix("sha256:").ok_or_else(index_corrupt)?;
    if encoded.len() != 64 {
        return Err(index_corrupt());
    }
    let mut decoded = [0_u8; 32];
    for (index, byte) in decoded.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&encoded[index * 2..index * 2 + 2], 16)
            .map_err(|_| index_corrupt())?;
    }
    Ok(decoded)
}

fn empty_generation_root() -> String {
    format!("{ROOT_PREFIX}{}", "00".repeat(32))
}

fn generation_root_from_frontiers(
    conn: &Connection,
    table: &str,
    index: &str,
    generation: u64,
) -> SnapbackResult<String> {
    let mut statement = conn.prepare(
        "SELECT content_digest FROM _snapback_vector_frontiers
         WHERE table_name=?1 AND index_name=?2 AND generation=?3
         ORDER BY source_id",
    )?;
    let mut rows = statement.query(params![
        table,
        index,
        to_sql_u64(generation, "vector generation")?
    ])?;
    let mut root = [0_u8; 32];
    while let Some(row) = rows.next()? {
        for (left, right) in root
            .iter_mut()
            .zip(decode_sha256_digest(&row.get::<_, String>(0)?)?)
        {
            *left ^= right;
        }
    }
    Ok(format!(
        "{ROOT_PREFIX}{}",
        root.iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

fn load_frontier(
    conn: &Connection,
    table: &str,
    index_name: &str,
    index_version: &str,
    generation: u64,
    source_id: &str,
) -> SnapbackResult<Option<VectorSourceFrontierV1>> {
    let raw: Option<(i64, i64, String)> = conn
        .query_row(
            "SELECT highest_version,tombstone,content_digest
             FROM _snapback_vector_frontiers
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND source_id=?4",
            params![
                table,
                index_name,
                to_sql_u64(generation, "vector generation")?,
                source_id
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    raw.map(|(version, tombstone, content_digest)| {
        if !matches!(tombstone, 0 | 1) {
            return Err(index_corrupt());
        }
        Ok(VectorSourceFrontierV1 {
            identity: VectorSourceUpdateIdentityV1 {
                index_version: index_version.to_owned(),
                source_id: source_id.to_owned(),
                source_version: decode_nonnegative(version)?,
            },
            tombstone: tombstone == 1,
            content_digest,
        })
    })
    .transpose()
}

#[derive(Clone)]
struct ActiveBinding {
    table: String,
    index: VectorIndexManifestV1,
    generation: u64,
    status: String,
    source_head: u64,
    receipt_json: String,
    activated_head: Option<u64>,
    predecessor_generation: Option<u64>,
}

fn active_bindings_for_tables(
    conn: &Connection,
    tables: &BTreeSet<String>,
) -> SnapbackResult<Vec<ActiveBinding>> {
    let mut out = Vec::new();
    let mut statement = conn.prepare(
        "SELECT index_name,generation,manifest_json,manifest_digest,root_digest,
                receipt_json,activated_head,predecessor_generation,source_head
         FROM _snapback_vector_generations
         WHERE table_name=?1 AND status='active'
         ORDER BY index_name,generation",
    )?;
    for table in tables {
        let rows = statement.query_map(params![table], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, i64>(8)?,
            ))
        })?;
        for row in rows {
            let (
                index_name,
                generation,
                raw_manifest,
                stored_digest,
                root_digest,
                receipt_json,
                activated_head,
                predecessor_generation,
                source_head,
            ) = row?;
            if !root_digest.starts_with(ROOT_PREFIX) {
                return Err(index_corrupt());
            }
            let index: VectorIndexManifestV1 =
                serde_json::from_str(&raw_manifest).map_err(|_| index_corrupt())?;
            if index.name != index_name || manifest_digest(&index)? != stored_digest {
                return Err(index_corrupt());
            }
            out.push(ActiveBinding {
                table: table.clone(),
                index,
                generation: decode_nonnegative(generation)?,
                status: "active".to_owned(),
                source_head: decode_nonnegative(source_head)?,
                receipt_json,
                activated_head: activated_head.map(decode_nonnegative).transpose()?,
                predecessor_generation: predecessor_generation
                    .map(decode_nonnegative)
                    .transpose()?,
            });
        }
    }
    Ok(out)
}

#[derive(Clone)]
pub struct GenerationUpdate {
    pub source_id: String,
    pub source_version: u64,
    pub row: Option<Value>,
}

#[derive(Clone)]
struct PlannedUpdate {
    binding: ActiveBinding,
    incoming: VectorSourceFrontierV1,
    expected: Option<VectorSourceFrontierV1>,
    posting: Option<CanonicalPosting>,
}

fn current_source_partition(
    conn: &Connection,
    binding: &ActiveBinding,
    source_id: &str,
) -> SnapbackResult<Option<(String, u64, String)>> {
    let raw: Option<(String, i64, String)> = conn
        .query_row(
            "SELECT partition_key,source_version,content_digest
             FROM _snapback_vector_sources
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND row_id=?4",
            params![
                binding.table,
                binding.index.name,
                to_sql_u64(binding.generation, "vector generation")?,
                source_id
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    raw.map(|(partition, version, digest)| Ok((partition, decode_nonnegative(version)?, digest)))
        .transpose()
}

fn plan_updates(
    tx: &Transaction<'_>,
    bindings: &[ActiveBinding],
    updates: &BTreeMap<String, GenerationUpdate>,
    budget: &mut VectorMaintenanceBudget,
) -> SnapbackResult<Vec<PlannedUpdate>> {
    let mut planned = Vec::new();
    let mut partition_delta = BTreeMap::<(String, String, u64, String), i64>::new();
    let mut partition_limits = BTreeMap::<(String, String, u64, String), u32>::new();

    for binding in bindings {
        for update in updates.values() {
            let current = load_frontier(
                tx,
                &binding.table,
                &binding.index.name,
                &binding.index.semantic_version,
                binding.generation,
                &update.source_id,
            )?;
            let posting = update
                .row
                .as_ref()
                .map(|row| {
                    canonical_posting(
                        &binding.index,
                        &update.source_id,
                        update.source_version,
                        row,
                    )
                })
                .transpose()?;
            let digest = posting.as_ref().map_or_else(
                || tombstone_digest(&update.source_id, update.source_version),
                |posting| Ok(posting.content_digest.clone()),
            )?;
            let incoming = VectorSourceFrontierV1 {
                identity: VectorSourceUpdateIdentityV1 {
                    index_version: binding.index.semantic_version.clone(),
                    source_id: update.source_id.clone(),
                    source_version: update.source_version,
                },
                tombstone: posting.is_none(),
                content_digest: digest,
            };
            let expected = match classify_vector_frontier_cas(current.as_ref(), &incoming)? {
                VectorFrontierCasV1::Idempotent | VectorFrontierCasV1::Stale => continue,
                VectorFrontierCasV1::Apply { expected } => expected,
            };
            let old = current_source_partition(tx, binding, &update.source_id)?;
            match (current.as_ref(), old.as_ref()) {
                (Some(frontier), Some((_, version, digest)))
                    if !frontier.tombstone
                        && frontier.identity.source_version == *version
                        && frontier.content_digest == *digest => {}
                (Some(frontier), None) if frontier.tombstone => {}
                (None, None) => {}
                _ => return Err(index_corrupt()),
            }
            budget.charge(
                1,
                posting
                    .as_ref()
                    .map_or(0, |posting| posting.vector_blob.len() as u64),
            )?;
            if let Some((partition, _, _)) = &old {
                *partition_delta
                    .entry((
                        binding.table.clone(),
                        binding.index.name.clone(),
                        binding.generation,
                        partition.clone(),
                    ))
                    .or_default() -= 1;
            }
            if let Some(posting) = &posting {
                let key = (
                    binding.table.clone(),
                    binding.index.name.clone(),
                    binding.generation,
                    posting.partition.clone(),
                );
                *partition_delta.entry(key.clone()).or_default() += 1;
                partition_limits.insert(key, binding.index.max_indexed_vectors_per_partition);
            }
            planned.push(PlannedUpdate {
                binding: binding.clone(),
                incoming,
                expected,
                posting,
            });
        }
    }

    // Check every final destination occupancy before the first derived write.
    // This includes aggregate transfers where no individual replacement alone
    // appears to fill the destination.
    for (key, delta) in partition_delta {
        let (table, index, generation, partition) = key.clone();
        let current: i64 = tx.query_row(
            "SELECT COUNT(*) FROM _snapback_vector_sources
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND partition_key=?4",
            params![
                table,
                index,
                to_sql_u64(generation, "vector generation")?,
                partition
            ],
            |row| row.get(0),
        )?;
        let final_count = current.checked_add(delta).ok_or_else(index_corrupt)?;
        let limit = i64::from(partition_limits.get(&key).copied().unwrap_or_else(|| {
            bindings
                .iter()
                .find(|binding| {
                    binding.table == key.0
                        && binding.index.name == key.1
                        && binding.generation == key.2
                })
                .map_or(0, |binding| binding.index.max_indexed_vectors_per_partition)
        }));
        if final_count < 0 {
            return Err(index_corrupt());
        }
        if final_count > limit {
            return Err(corpus_bound());
        }
    }
    Ok(planned)
}

fn write_frontier(tx: &Transaction<'_>, update: &PlannedUpdate) -> SnapbackResult<()> {
    let generation = to_sql_u64(update.binding.generation, "vector generation")?;
    let incoming_version = to_sql_u64(
        update.incoming.identity.source_version,
        "vector source version",
    )?;
    let changed = if let Some(expected) = &update.expected {
        tx.execute(
            "UPDATE _snapback_vector_frontiers
             SET highest_version=?5,tombstone=?6,content_digest=?7
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND source_id=?4
               AND highest_version=?8 AND tombstone=?9 AND content_digest=?10",
            params![
                update.binding.table,
                update.binding.index.name,
                generation,
                update.incoming.identity.source_id,
                incoming_version,
                i64::from(update.incoming.tombstone),
                update.incoming.content_digest,
                to_sql_u64(
                    expected.identity.source_version,
                    "expected vector source version"
                )?,
                i64::from(expected.tombstone),
                expected.content_digest,
            ],
        )?
    } else {
        tx.execute(
            "INSERT OR IGNORE INTO _snapback_vector_frontiers
             (table_name,index_name,generation,source_id,highest_version,tombstone,content_digest)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                update.binding.table,
                update.binding.index.name,
                generation,
                update.incoming.identity.source_id,
                incoming_version,
                i64::from(update.incoming.tombstone),
                update.incoming.content_digest,
            ],
        )?
    };
    if changed != 1 {
        return Err(index_corrupt());
    }
    Ok(())
}

fn verify_applied_source(tx: &Transaction<'_>, update: &PlannedUpdate) -> SnapbackResult<()> {
    let frontier = load_frontier(
        tx,
        &update.binding.table,
        &update.binding.index.name,
        &update.binding.index.semantic_version,
        update.binding.generation,
        &update.incoming.identity.source_id,
    )?;
    if frontier.as_ref() != Some(&update.incoming) {
        return Err(index_corrupt());
    }
    let stored =
        current_source_partition(tx, &update.binding, &update.incoming.identity.source_id)?;
    match (&update.posting, stored) {
        (None, None) => Ok(()),
        (Some(posting), Some((partition, version, digest)))
            if partition == posting.partition
                && version == update.incoming.identity.source_version
                && digest == posting.content_digest =>
        {
            Ok(())
        }
        _ => Err(index_corrupt()),
    }
}

fn apply_planned_updates(tx: &Transaction<'_>, planned: &[PlannedUpdate]) -> SnapbackResult<()> {
    let touched = planned
        .iter()
        .map(|update| {
            (
                update.binding.table.clone(),
                update.binding.index.name.clone(),
                update.binding.generation,
            )
        })
        .collect::<BTreeSet<_>>();
    for (table, index, generation) in &touched {
        let changed = tx.execute(
            "UPDATE _snapback_vector_generations SET status='maintaining'
             WHERE table_name=?1 AND index_name=?2 AND generation=?3
               AND status IN ('active','building')",
            params![table, index, to_sql_u64(*generation, "vector generation")?],
        )?;
        if changed != 1 {
            return Err(index_corrupt());
        }
    }
    for update in planned {
        tx.execute(
            "DELETE FROM _snapback_vector_sources
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND row_id=?4",
            params![
                update.binding.table,
                update.binding.index.name,
                to_sql_u64(update.binding.generation, "vector generation")?,
                update.incoming.identity.source_id
            ],
        )?;
        if let Some(posting) = &update.posting {
            tx.execute(
                "INSERT INTO _snapback_vector_sources
                 (table_name,index_name,generation,row_id,source_version,partition_key,
                  vector_blob,filters_json,fields_json,content_digest)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params![
                    update.binding.table,
                    update.binding.index.name,
                    to_sql_u64(update.binding.generation, "vector generation")?,
                    update.incoming.identity.source_id,
                    to_sql_u64(
                        update.incoming.identity.source_version,
                        "vector source version"
                    )?,
                    posting.partition,
                    posting.vector_blob,
                    serde_json::to_string(&posting.filters).map_err(|_| maintenance_error(
                        "vector filter projection does not serialize"
                    ))?,
                    serde_json::to_string(&posting.fields).map_err(|_| maintenance_error(
                        "vector stored projection does not serialize"
                    ))?,
                    posting.content_digest,
                ],
            )?;
        }
        write_frontier(tx, update)?;
        verify_applied_source(tx, update)?;
    }
    for (table, index, generation) in touched {
        let root = generation_root_from_frontiers(tx, &table, &index, generation)?;
        let incoming_head = planned
            .iter()
            .filter(|update| {
                update.binding.table == table
                    && update.binding.index.name == index
                    && update.binding.generation == generation
            })
            .map(|update| update.incoming.identity.source_version)
            .max()
            .unwrap_or(0);
        let binding = planned
            .iter()
            .find(|update| {
                update.binding.table == table
                    && update.binding.index.name == index
                    && update.binding.generation == generation
            })
            .map(|update| &update.binding)
            .ok_or_else(index_corrupt)?;
        let source_head = binding.source_head.max(incoming_head);
        let receipt_json = if binding.status == "active" {
            let (_, live_rows, frontier_rows) =
                verify_generation(tx, &table, &binding.index, generation)?;
            let mut receipt: crate::vector::rebuild::VectorRebuildReceiptV1 =
                serde_json::from_str(&binding.receipt_json).map_err(|_| index_corrupt())?;
            receipt.source_head = source_head;
            receipt.root_digest.clone_from(&root);
            receipt.live_rows = live_rows;
            receipt.frontier_rows = frontier_rows;
            if binding
                .activated_head
                .is_some_and(|activated| source_head > activated)
            {
                receipt.rollback_eligible = false;
            }
            serde_json::to_string(&receipt).map_err(|_| index_corrupt())?
        } else {
            binding.receipt_json.clone()
        };
        tx.execute(
            "UPDATE _snapback_vector_generations
             SET status=?4,source_head=MAX(source_head,?5),root_digest=?6,
                 receipt_json=?7,corruption_reason=NULL
             WHERE table_name=?1 AND index_name=?2 AND generation=?3",
            params![
                table,
                index,
                to_sql_u64(generation, "vector generation")?,
                binding.status,
                to_sql_u64(source_head, "vector source head")?,
                root,
                receipt_json,
            ],
        )?;
    }
    Ok(())
}

/// Apply one already-versioned batch to a specific candidate generation. This
/// is the only derived-write seam the rebuild executor needs.
pub(crate) fn maintain_candidate_in_tx(
    tx: &Transaction<'_>,
    table: &str,
    index: &VectorIndexManifestV1,
    generation: u64,
    updates: &[GenerationUpdate],
) -> SnapbackResult<()> {
    let generation_row: Option<(String, String, i64, String)> = tx
        .query_row(
            "SELECT manifest_digest,status,source_head,receipt_json
             FROM _snapback_vector_generations
             WHERE table_name=?1 AND index_name=?2 AND generation=?3",
            params![
                table,
                index.name,
                to_sql_u64(generation, "vector generation")?
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((digest, status, source_head, receipt_json)) = generation_row else {
        return Err(index_unavailable());
    };
    if digest != manifest_digest(index)? || !matches!(status.as_str(), "building" | "maintaining") {
        return Err(index_corrupt());
    }
    let binding = ActiveBinding {
        table: table.to_owned(),
        index: index.clone(),
        generation,
        status,
        source_head: decode_nonnegative(source_head)?,
        receipt_json,
        activated_head: None,
        predecessor_generation: None,
    };
    let updates = updates
        .iter()
        .cloned()
        .map(|update| (update.source_id.clone(), update))
        .collect::<BTreeMap<_, _>>();
    let mut budget = VectorMaintenanceBudget::default();
    let planned = plan_updates(tx, &[binding], &updates, &mut budget)?;
    apply_planned_updates(tx, &planned)
}

/// Maintain every active vector generation touched by one authoritative
/// source transaction. Planning, the single global budget, and final corpus
/// occupancy all complete before the first derived write.
///
/// @ref LLP 0132#index-maintenance-and-storage — the budget is mutation-global
///   across indexes and every refusal rolls back source plus derived state.
pub(crate) fn maintain_vector_indexes_in_tx(
    tx: &Transaction<'_>,
    _schema: &SchemaManifest,
    changes: &[ChangedRow],
    source_version: u64,
) -> SnapbackResult<()> {
    if changes.is_empty() {
        return Ok(());
    }
    let tables = changes
        .iter()
        .map(|change| change.table.clone())
        .collect::<BTreeSet<_>>();
    let bindings = active_bindings_for_tables(tx, &tables)?;
    if bindings.is_empty() {
        return Ok(());
    }
    let mut updates_by_table = BTreeMap::<String, BTreeMap<String, GenerationUpdate>>::new();
    for change in changes {
        updates_by_table
            .entry(change.table.clone())
            .or_default()
            .insert(
                change.id.clone(),
                GenerationUpdate {
                    source_id: change.id.clone(),
                    source_version,
                    row: if change.op == ChangeOp::Delete {
                        None
                    } else {
                        change.row.clone()
                    },
                },
            );
    }
    let mut budget = VectorMaintenanceBudget::default();
    let mut planned = Vec::new();
    for table in &tables {
        let table_bindings = bindings
            .iter()
            .filter(|binding| binding.table == *table)
            .cloned()
            .collect::<Vec<_>>();
        if let Some(updates) = updates_by_table.get(table) {
            planned.extend(plan_updates(tx, &table_bindings, updates, &mut budget)?);
        }
    }
    apply_planned_updates(tx, &planned)?;

    // The retained predecessor is a valid fast rollback only until the first
    // source commit maintained exclusively by its successor.
    for binding in bindings {
        if binding
            .activated_head
            .is_some_and(|activated| source_version > activated)
            && let Some(predecessor) = binding.predecessor_generation
        {
            tx.execute(
                "UPDATE _snapback_vector_generations SET rollback_eligible=0
                 WHERE table_name=?1 AND index_name=?2 AND generation=?3",
                params![
                    binding.table,
                    binding.index.name,
                    to_sql_u64(predecessor, "predecessor vector generation")?
                ],
            )?;
        }
    }
    Ok(())
}

pub(crate) fn verify_generation(
    conn: &Connection,
    table: &str,
    index: &VectorIndexManifestV1,
    generation: u64,
) -> SnapbackResult<(String, u64, u64)> {
    let mut statement = conn.prepare(
        "SELECT source_id,highest_version,tombstone,content_digest
         FROM _snapback_vector_frontiers
         WHERE table_name=?1 AND index_name=?2 AND generation=?3
         ORDER BY source_id",
    )?;
    let mut rows = statement.query(params![
        table,
        index.name,
        to_sql_u64(generation, "vector generation")?
    ])?;
    let mut frontier_count = 0_u64;
    let mut live_count = 0_u64;
    while let Some(row) = rows.next()? {
        frontier_count += 1;
        let source_id: String = row.get(0)?;
        let version = decode_nonnegative(row.get(1)?)?;
        let tombstone: i64 = row.get(2)?;
        let digest: String = row.get(3)?;
        if !matches!(tombstone, 0 | 1) {
            return Err(index_corrupt());
        }
        let source: Option<(i64, String, Vec<u8>, String, String, String)> = conn
            .query_row(
                "SELECT source_version,partition_key,vector_blob,filters_json,fields_json,
                        content_digest
                 FROM _snapback_vector_sources
                 WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND row_id=?4",
                params![
                    table,
                    index.name,
                    to_sql_u64(generation, "vector generation")?,
                    source_id
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()?;
        if tombstone == 1 {
            if source.is_some() || digest != tombstone_digest(&source_id, version)? {
                return Err(index_corrupt());
            }
            continue;
        }
        let Some((stored_version, partition, blob, filters_json, fields_json, stored_digest)) =
            source
        else {
            return Err(index_corrupt());
        };
        let stored_version = decode_nonnegative(stored_version)?;
        let vector = crate::vector::storage::decode_vector_binary64_le(&blob, index.dimensions)?;
        let filters: Map<String, Value> =
            serde_json::from_str(&filters_json).map_err(|_| index_corrupt())?;
        let fields: Map<String, Value> =
            serde_json::from_str(&fields_json).map_err(|_| index_corrupt())?;
        let expected = vector_posting_content_digest(
            &source_id,
            stored_version,
            &partition,
            &vector,
            &filters,
            &fields,
        )?;
        if version != stored_version
            || digest != stored_digest
            || digest != expected
            || filters.keys().collect::<BTreeSet<_>>()
                != index.equality_filters.iter().collect::<BTreeSet<_>>()
            || fields.keys().collect::<BTreeSet<_>>()
                != index.stored_fields.iter().collect::<BTreeSet<_>>()
        {
            return Err(index_corrupt());
        }
        live_count += 1;
    }
    let orphan: Option<String> = conn
        .query_row(
            "SELECT row_id FROM _snapback_vector_sources s
             WHERE table_name=?1 AND index_name=?2 AND generation=?3
               AND NOT EXISTS (
                 SELECT 1 FROM _snapback_vector_frontiers f
                 WHERE f.table_name=s.table_name AND f.index_name=s.index_name
                   AND f.generation=s.generation AND f.source_id=s.row_id
                   AND f.tombstone=0
               ) LIMIT 1",
            params![
                table,
                index.name,
                to_sql_u64(generation, "vector generation")?
            ],
            |row| row.get(0),
        )
        .optional()?;
    if orphan.is_some() {
        return Err(index_corrupt());
    }
    let overflow: Option<String> = conn
        .query_row(
            "SELECT partition_key FROM _snapback_vector_sources
             WHERE table_name=?1 AND index_name=?2 AND generation=?3
             GROUP BY partition_key HAVING COUNT(*)>?4 LIMIT 1",
            params![
                table,
                index.name,
                to_sql_u64(generation, "vector generation")?,
                i64::from(index.max_indexed_vectors_per_partition)
            ],
            |row| row.get(0),
        )
        .optional()?;
    if overflow.is_some() {
        return Err(corpus_bound());
    }
    Ok((
        generation_root_from_frontiers(conn, table, &index.name, generation)?,
        live_count,
        frontier_count,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{AuthInput, FieldManifest, FieldType};
    use crate::vector::diagnostics::code;
    use crate::vector::{
        VECTOR_CAPABILITY, VECTOR_DISTANCE_PROFILE_ID, VECTOR_ORDERING_PROFILE_ID,
        VECTOR_RESULT_PROJECTION, VectorFieldClassV1, VectorMaintenanceLimitsV1, VectorMetricV1,
        VectorTieBreakV1,
    };

    #[test]
    fn quarantine_failure_binding_cannot_cross_databases() {
        let first = crate::storage::DatabaseBinding::isolated_for_test();
        let second = crate::storage::DatabaseBinding::isolated_for_test();
        let failure = VectorSqliteQueryFailure::for_generation(
            index_corrupt(),
            &VectorGenerationIdentity {
                table: "documents".to_owned(),
                index: "by_embedding".to_owned(),
                generation: 1,
            },
        )
        .bind_to(Some(first.clone()));

        assert!(failure.is_bound_to(&first));
        assert!(!failure.is_bound_to(&second));
    }

    #[test]
    fn pending_quarantine_fences_a_generation_preserved_by_additive_schema_activation() {
        let schema_s0 = schema(vec![index(
            "by_embedding",
            VectorVisibilityV1::Owner {
                field: "owner".to_owned(),
            },
            8,
        )]);
        let gate = PendingVectorQuarantineGate::new(&schema_s0);
        let generation_g = VectorGenerationIdentity {
            table: "documents".to_owned(),
            index: "by_embedding".to_owned(),
            generation: 1,
        };

        // The reader captured S0 before pinning. An unrelated additive
        // activation installs S1 while preserving this exact generation G.
        let mut schema_s1 = schema_s0.clone();
        schema_s1.tables.push(TableManifest {
            name: "unrelated".to_owned(),
            fields: Vec::new(),
            indexes: Vec::new(),
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            syncable: false,
            permission_backing: false,
            permission_fields: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        });
        gate.set_schema(&schema_s1);

        let mut forged_schema = schema_s0.clone();
        forged_schema.tables[0].vector_indexes[0].semantic_version =
            "caller-selected-version".to_owned();
        gate.mark_if_current_generation_query_facts(&generation_g, &forged_schema);
        assert!(
            !gate.contains(&generation_g),
            "caller-selected vector facts must not fence a healthy generation"
        );

        let mut forged_field_schema = schema_s0.clone();
        forged_field_schema.tables[0]
            .fields
            .iter_mut()
            .find(|field| field.name == "status")
            .expect("status field")
            .field_type = FieldType::Boolean;
        gate.mark_if_current_generation_query_facts(&generation_g, &forged_field_schema);
        assert!(
            !gate.contains(&generation_g),
            "caller-selected field facts must not fence a healthy generation"
        );

        // Corruption detected by the S0 reader must still fence G: S1 changed
        // the whole schema, not G's complete query-facts projection.
        gate.mark_if_current_generation_query_facts(&generation_g, &schema_s0);
        assert!(
            gate.contains(&generation_g),
            "an additive schema activation must not reopen a surviving corrupt generation"
        );
    }

    fn index(name: &str, visibility: VectorVisibilityV1, corpus: u32) -> VectorIndexManifestV1 {
        let classification = if matches!(visibility, VectorVisibilityV1::PublicRead) {
            VectorFieldClassV1::Public
        } else {
            VectorFieldClassV1::Private
        };
        let mut field_classifications = BTreeMap::from([
            ("embedding".to_owned(), classification),
            ("status".to_owned(), classification),
            ("title".to_owned(), classification),
        ]);
        if matches!(visibility, VectorVisibilityV1::Owner { .. }) {
            field_classifications.insert("owner".to_owned(), classification);
        }
        VectorIndexManifestV1 {
            format_version: 1,
            name: name.to_owned(),
            semantic_version: format!("documents.{name}.v1"),
            vector_field: "embedding".to_owned(),
            dimensions: 2,
            metric: VectorMetricV1::L2sq,
            distance_profile: VECTOR_DISTANCE_PROFILE_ID.to_owned(),
            ordering_profile: VECTOR_ORDERING_PROFILE_ID.to_owned(),
            field_classifications,
            equality_filters: vec!["status".to_owned()],
            stored_fields: vec!["title".to_owned()],
            visibility,
            tie_break: VectorTieBreakV1::IdAsc,
            max_indexed_vectors_per_partition: corpus,
            max_scalar_pairs: u64::from(corpus) * 2,
            maintenance_limits: VectorMaintenanceLimitsV1::default(),
        }
    }

    fn schema(indexes: Vec<VectorIndexManifestV1>) -> SchemaManifest {
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
                vector_indexes: indexes,
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

    fn setup(indexes: Vec<VectorIndexManifestV1>) -> (Connection, SchemaManifest) {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE _snapback_version(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
             INSERT INTO _snapback_version(id,version) VALUES (1,0);
             CREATE TABLE documents(
               _id TEXT PRIMARY KEY,_version INTEGER NOT NULL,embedding BLOB NOT NULL,
               owner TEXT NOT NULL,status TEXT NOT NULL,title REAL NOT NULL
             );",
        )
        .unwrap();
        create_infra(&conn).unwrap();
        let schema = schema(indexes);
        let tx = conn.transaction().unwrap();
        stage_manifest_in_tx(&tx, &schema, 0).unwrap();
        tx.commit().unwrap();
        (conn, schema)
    }

    fn activate_all(conn: &mut Connection, schema: &SchemaManifest) {
        let tx = conn.transaction().unwrap();
        for index in &schema.tables[0].vector_indexes {
            let generation: i64 = tx
                .query_row(
                    "SELECT generation FROM _snapback_vector_generations
                     WHERE table_name='documents' AND index_name=?1 AND status='pending'",
                    params![index.name],
                    |row| row.get(0),
                )
                .unwrap();
            let receipt = crate::vector::rebuild::VectorRebuildReceiptV1 {
                executor: crate::vector::rebuild::VECTOR_REBUILD_EXECUTOR.to_owned(),
                operation_id: format!("test-{}", index.name),
                plan_digest: "test-plan".to_owned(),
                approval_digest: "test-approval".to_owned(),
                table: "documents".to_owned(),
                index: index.name.clone(),
                generation: generation as u64,
                predecessor_generation: None,
                source_head: 0,
                root_digest: empty_generation_root(),
                live_rows: 0,
                frontier_rows: 0,
                activated: true,
                rollback_eligible: false,
            };
            tx.execute(
                "UPDATE _snapback_vector_generations
                 SET status='active',receipt_json=?3
                 WHERE table_name='documents' AND index_name=?1 AND generation=?2",
                params![
                    index.name,
                    generation,
                    serde_json::to_string(&receipt).unwrap()
                ],
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }

    fn document(id: &str, version: u64, owner: &str, title: f64) -> Value {
        json!({
            "_id": id,
            "_version": version,
            "embedding": [title, -0.0],
            "owner": owner,
            "status": "ready",
            "title": title,
        })
    }

    fn change(id: &str, version: u64, owner: &str, title: f64, op: ChangeOp) -> ChangedRow {
        let row = (op != ChangeOp::Delete).then(|| document(id, version, owner, title));
        ChangedRow {
            table: "documents".to_owned(),
            id: id.to_owned(),
            op,
            row,
            changed_fields: Vec::new(),
        }
    }

    fn insert_authoritative(tx: &Transaction<'_>, id: &str, version: u64, owner: &str, title: f64) {
        tx.execute(
            "INSERT INTO documents(_id,_version,embedding,owner,status,title)
             VALUES (?1,?2,?3,?4,'ready',?5)",
            params![
                id,
                version as i64,
                encode_vector_binary64_le(&[title, -0.0], 2).unwrap(),
                owner,
                title
            ],
        )
        .unwrap();
    }

    #[test]
    fn staging_is_metadata_only_and_source_commit_maintenance_is_atomic() {
        let (mut conn, schema) = setup(vec![index(
            "by_embedding",
            VectorVisibilityV1::Owner {
                field: "owner".to_owned(),
            },
            8,
        )]);
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
        activate_all(&mut conn, &schema);
        let tx = conn.transaction().unwrap();
        insert_authoritative(&tx, "a", 1, "alice", 1.0);
        maintain_vector_indexes_in_tx(
            &tx,
            &schema,
            &[change("a", 1, "alice", 1.0, ChangeOp::Insert)],
            1,
        )
        .unwrap();
        tx.execute("UPDATE _snapback_version SET version=1 WHERE id=1", [])
            .unwrap();
        tx.commit().unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT partition_key FROM _snapback_vector_sources WHERE row_id='a'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "owner:alice"
        );
        let (_, live, frontiers) =
            verify_generation(&conn, "documents", &schema.tables[0].vector_indexes[0], 1).unwrap();
        assert_eq!((live, frontiers), (1, 1));
    }

    #[test]
    fn mutation_global_budget_refuses_before_any_index_write() {
        let indexes = ["first", "second"]
            .into_iter()
            .map(|name| index(name, VectorVisibilityV1::PublicRead, 1_024))
            .collect();
        let (mut conn, schema) = setup(indexes);
        activate_all(&mut conn, &schema);
        let changes = (0..513)
            .map(|row| {
                change(
                    &format!("row-{row:04}"),
                    1,
                    "alice",
                    row as f64,
                    ChangeOp::Insert,
                )
            })
            .collect::<Vec<_>>();
        let tx = conn.transaction().unwrap();
        let error = maintain_vector_indexes_in_tx(&tx, &schema, &changes, 1)
            .expect_err("1,026 cross-index posting effects refuse");
        assert_eq!(error.diagnostic.code, code::MAINTENANCE_LIMIT);
        assert_eq!(
            tx.query_row("SELECT COUNT(*) FROM _snapback_vector_sources", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
    }

    #[test]
    fn ownership_transfer_into_full_partition_refuses_without_partial_move() {
        let (mut conn, schema) = setup(vec![index(
            "by_embedding",
            VectorVisibilityV1::Owner {
                field: "owner".to_owned(),
            },
            1,
        )]);
        activate_all(&mut conn, &schema);
        let tx = conn.transaction().unwrap();
        maintain_vector_indexes_in_tx(
            &tx,
            &schema,
            &[
                change("a", 1, "alice", 1.0, ChangeOp::Insert),
                change("b", 1, "bob", 2.0, ChangeOp::Insert),
            ],
            1,
        )
        .unwrap();
        tx.commit().unwrap();

        let tx = conn.transaction().unwrap();
        let error = maintain_vector_indexes_in_tx(
            &tx,
            &schema,
            &[change("a", 2, "bob", 1.0, ChangeOp::Update)],
            2,
        )
        .expect_err("full bob partition refuses transfer");
        assert_eq!(error.diagnostic.code, code::CORPUS_BOUND);
        drop(tx);
        let partitions = conn
            .prepare("SELECT row_id,partition_key FROM _snapback_vector_sources ORDER BY row_id")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            partitions,
            vec![
                ("a".to_owned(), "owner:alice".to_owned()),
                ("b".to_owned(), "owner:bob".to_owned())
            ]
        );
    }

    #[test]
    fn same_snapshot_query_uses_server_authority_and_carries_quarantine_identity() {
        let (mut conn, schema) = setup(vec![index(
            "by_embedding",
            VectorVisibilityV1::Owner {
                field: "owner".to_owned(),
            },
            8,
        )]);
        activate_all(&mut conn, &schema);
        let tx = conn.transaction().unwrap();
        insert_authoritative(&tx, "a", 1, "alice", 1.0);
        maintain_vector_indexes_in_tx(
            &tx,
            &schema,
            &[change("a", 1, "alice", 1.0, ChangeOp::Insert)],
            1,
        )
        .unwrap();
        tx.execute("UPDATE _snapback_version SET version=1 WHERE id=1", [])
            .unwrap();
        tx.commit().unwrap();

        let plan = VectorQueryPlanV1 {
            table: "documents".to_owned(),
            index: "by_embedding".to_owned(),
            distance_profile: VECTOR_DISTANCE_PROFILE_ID.to_owned(),
            result_projection: VECTOR_RESULT_PROJECTION.to_owned(),
            required_capability: VECTOR_CAPABILITY.to_owned(),
        };
        let input = HandlerInput {
            args: json!({"vector": [0.0, 0.0], "k": 1}),
            auth: AuthInput {
                user_id: Some("mallory".to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let result = query_vector_on(&conn, &schema, &plan, &input, Some("alice")).unwrap();
        assert_eq!(result.output.version, 1);
        assert_eq!(result.output.rows[0]["rowId"], "a");
        assert_eq!(result.counters.release_source_reads, 1);

        let receipt: String = conn
            .query_row(
                "SELECT receipt_json FROM _snapback_vector_generations WHERE generation=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        conn.execute(
            "UPDATE _snapback_vector_generations SET receipt_json='not-json'
             WHERE generation=1",
            [],
        )
        .unwrap();
        let malformed = query_vector_on(&conn, &schema, &plan, &input, Some("alice"))
            .expect_err("malformed active receipt refuses");
        assert_eq!(malformed.error.diagnostic.code, code::INDEX_CORRUPT);
        assert_eq!(malformed.quarantine_target.as_ref().unwrap().generation, 1);
        conn.execute(
            "UPDATE _snapback_vector_generations SET receipt_json=?1 WHERE generation=1",
            params![receipt],
        )
        .unwrap();

        conn.execute(
            "UPDATE documents SET _version=2,title=9.0 WHERE _id='a'",
            [],
        )
        .unwrap();
        conn.execute("UPDATE _snapback_version SET version=2 WHERE id=1", [])
            .unwrap();
        let quarantine_gate = PendingVectorQuarantineGate::new(&schema);
        let failure = query_vector_on_with_quarantine_gate(
            &conn,
            &schema,
            &plan,
            &input,
            Some("alice"),
            Some(&quarantine_gate),
        )
        .expect_err("authoritative release drift refuses the whole page");
        assert_eq!(failure.error.diagnostic.code, code::INDEX_CORRUPT);
        let identity = failure
            .quarantine_target
            .expect("release corruption carries private generation identity");
        assert!(
            quarantine_gate.contains(&identity),
            "detection immediately fences the generation in-process"
        );
        assert_eq!(
            conn.query_row(
                "SELECT status FROM _snapback_vector_generations WHERE generation=1",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "active",
            "the pending fence precedes durable settlement"
        );
        let pending = query_vector_on_with_quarantine_gate(
            &conn,
            &schema,
            &plan,
            &input,
            Some("alice"),
            Some(&quarantine_gate),
        )
        .expect_err("a pending generation must be unselectable before settlement");
        assert_eq!(pending.error.diagnostic.code, code::INDEX_CORRUPT);
        assert!(
            pending.quarantine_target.is_none(),
            "the pending gate refuses before another reader selects the generation"
        );
        assert!(
            quarantine_generation_on(
                &conn,
                &identity,
                "authoritative vector release recheck failed"
            )
            .unwrap()
        );
        quarantine_gate.clear(&identity);
        assert_eq!(
            conn.query_row(
                "SELECT status FROM _snapback_vector_generations WHERE generation=1",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "quarantined"
        );
    }

    #[test]
    fn frontier_replay_stale_divergence_and_tombstone_are_closed() {
        let (mut conn, schema) = setup(vec![index(
            "by_embedding",
            VectorVisibilityV1::Owner {
                field: "owner".to_owned(),
            },
            8,
        )]);
        activate_all(&mut conn, &schema);
        let tx = conn.transaction().unwrap();
        maintain_vector_indexes_in_tx(
            &tx,
            &schema,
            &[change("a", 2, "alice", 2.0, ChangeOp::Insert)],
            2,
        )
        .unwrap();
        tx.commit().unwrap();

        let tx = conn.transaction().unwrap();
        maintain_vector_indexes_in_tx(
            &tx,
            &schema,
            &[change("a", 2, "alice", 2.0, ChangeOp::Update)],
            2,
        )
        .unwrap();
        let divergent = maintain_vector_indexes_in_tx(
            &tx,
            &schema,
            &[change("a", 2, "alice", 3.0, ChangeOp::Update)],
            2,
        )
        .expect_err("same-version divergent content is corruption");
        assert_eq!(divergent.diagnostic.code, code::INDEX_CORRUPT);
        drop(tx);

        let tx = conn.transaction().unwrap();
        maintain_vector_indexes_in_tx(
            &tx,
            &schema,
            &[change("a", 3, "alice", 0.0, ChangeOp::Delete)],
            3,
        )
        .unwrap();
        tx.commit().unwrap();
        let tx = conn.transaction().unwrap();
        maintain_vector_indexes_in_tx(
            &tx,
            &schema,
            &[change("a", 2, "alice", 2.0, ChangeOp::Insert)],
            2,
        )
        .unwrap();
        assert_eq!(
            tx.query_row(
                "SELECT COUNT(*) FROM _snapback_vector_sources WHERE row_id='a'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            tx.query_row(
                "SELECT highest_version FROM _snapback_vector_frontiers WHERE source_id='a'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            3
        );
    }

    #[test]
    fn quarantined_history_does_not_wedge_source_writes_or_a_successor() {
        let (mut conn, schema) = setup(vec![index(
            "by_embedding",
            VectorVisibilityV1::Owner {
                field: "owner".to_owned(),
            },
            8,
        )]);
        activate_all(&mut conn, &schema);
        conn.execute(
            "UPDATE _snapback_vector_generations
             SET status='quarantined',corruption_reason='test' WHERE generation=1",
            [],
        )
        .unwrap();
        let tx = conn.transaction().unwrap();
        maintain_vector_indexes_in_tx(
            &tx,
            &schema,
            &[change("open", 1, "alice", 1.0, ChangeOp::Insert)],
            1,
        )
        .expect("no active generation leaves authoritative writes open");
        stage_manifest_in_tx(&tx, &schema, 1).unwrap();
        tx.commit().unwrap();
        activate_all(&mut conn, &schema);
        let tx = conn.transaction().unwrap();
        maintain_vector_indexes_in_tx(
            &tx,
            &schema,
            &[change("successor", 2, "alice", 2.0, ChangeOp::Insert)],
            2,
        )
        .expect("historical quarantine does not wedge active successor");
        assert_eq!(
            tx.query_row(
                "SELECT generation FROM _snapback_vector_sources WHERE row_id='successor'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            2
        );
    }
}
