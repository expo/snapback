//! Transactional SQLite maintenance for exact vector-index generations.
//!
//! This module owns derived write state only. Query execution is deliberately
//! isolated in `vector::query`, so adding or qualifying the read surface does
//! not change the source-commit boundary implemented here.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::SchemaManifest;
use crate::storage::{ChangeOp, ChangedRow};
use crate::vector::diagnostics::{corpus_bound, index_corrupt, index_unavailable};
use crate::vector::storage::{
    VectorFrontierCasV1, VectorMaintenanceBudget, VectorSourceFrontierV1,
    VectorSourceUpdateIdentityV1, classify_vector_frontier_cas, encode_vector_binary64_le,
};
use crate::vector::types::{VectorIndexManifestV1, VectorVisibilityV1};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

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
pub fn create_infra(conn: &Connection) -> SnapbackResult<()> {
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

pub(crate) fn manifest_digest(index: &VectorIndexManifestV1) -> SnapbackResult<String> {
    let value = serde_json::to_value(index)
        .map_err(|_| maintenance_error("vector index manifest does not serialize"))?;
    crate::rqs::sha256_identity(&value)
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
pub fn stage_manifest_in_tx(
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
pub(crate) struct CanonicalPosting {
    pub partition: String,
    pub vector_blob: Vec<u8>,
    pub filters: Map<String, Value>,
    pub fields: Map<String, Value>,
    pub content_digest: String,
}

pub(crate) fn posting_content_digest(
    row_id: &str,
    source_version: u64,
    partition: &str,
    vector: &[f64],
    filters: &Map<String, Value>,
    fields: &Map<String, Value>,
) -> SnapbackResult<String> {
    // This is the shared VEC-3/VEC-4 release identity. Keep the member set
    // exact: VEC-4's authoritative-release carrier re-computes these bytes.
    crate::rqs::sha256_identity(&json!({
        "rowId": row_id,
        "sourceVersion": source_version,
        "partition": partition,
        "vector": vector,
        "filters": filters,
        "fields": fields,
    }))
    .map_err(|_| maintenance_error("vector posting identity is not canonicalizable"))
}

pub(crate) fn canonical_posting(
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
    let content_digest = posting_content_digest(
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
    crate::rqs::sha256_identity(&json!({
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
                receipt_json,activated_head,predecessor_generation,status,corruption_reason,
                source_head
         FROM _snapback_vector_generations
         WHERE table_name=?1 AND status IN ('active','quarantined')
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
                row.get::<_, String>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, i64>(10)?,
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
                status,
                reason,
                source_head,
            ) = row?;
            if status != "active" || reason.is_some() || !root_digest.starts_with(ROOT_PREFIX) {
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
                status,
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
pub(crate) struct GenerationUpdate {
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
pub fn maintain_vector_indexes_in_tx(
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
        {
            if let Some(predecessor) = binding.predecessor_generation {
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
        let expected = posting_content_digest(
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
