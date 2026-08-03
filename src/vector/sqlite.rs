use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{FieldType, HandlerInput, QueryOutput, SchemaManifest, TableManifest};
use crate::storage::{ChangeOp, ChangedRow};
use crate::vector::types::*;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

fn diagnostic(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "vector", message)
}

pub fn create_infra(conn: &Connection) -> SnapbackResult<()> {
    // @ref LLP 0132#index-maintenance-and-storage — canonical little-endian f64
    // blobs live in ordinary transactional SQLite shadow state.
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS _snapback_vector_generations (
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          semantic_version TEXT NOT NULL,
          manifest_digest TEXT NOT NULL,
          generation INTEGER NOT NULL,
          status TEXT NOT NULL,
          source_head INTEGER NOT NULL,
          root_digest TEXT NOT NULL,
          corruption_reason TEXT,
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
          ON _snapback_vector_sources(table_name,index_name,generation,partition_key,row_id);
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
        ",
    )?;
    // @ref LLP 0132#index-maintenance-and-storage — derived-state writes are
    // valid only when the canonical maintainer reseals the whole generation
    // in the same transaction. An out-of-band edit leaves a durable
    // quarantine marker that queries observe before candidate traversal.
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

fn generation_root(
    conn: &Connection,
    table: &str,
    index: &str,
    generation: u64,
) -> SnapbackResult<String> {
    let mut sources = conn.prepare(
        "SELECT row_id,content_digest FROM _snapback_vector_sources
         WHERE table_name=?1 AND index_name=?2 AND generation=?3
         ORDER BY row_id COLLATE BINARY ASC",
    )?;
    let source_rows = sources
        .query_map(params![table, index, generation as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut frontiers = conn.prepare(
        "SELECT source_id,highest_version,tombstone,content_digest
         FROM _snapback_vector_frontiers
         WHERE table_name=?1 AND index_name=?2 AND generation=?3
         ORDER BY source_id COLLATE BINARY ASC",
    )?;
    let frontier_rows = frontiers
        .query_map(params![table, index, generation as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    crate::rqs::sha256_identity(&json!({
        "sources": source_rows,
        "frontiers": frontier_rows,
    }))
    .map_err(|_| {
        diagnostic(
            "SNAPBACK_VECTOR_INDEX_CORRUPT",
            "vector generation root is not canonicalizable",
        )
    })
}

fn manifest_digest(index: &VectorIndexManifestV1) -> SnapbackResult<String> {
    let value = serde_json::to_value(index).map_err(|_| {
        diagnostic(
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            "vector index manifest does not serialize",
        )
    })?;
    crate::rqs::sha256_identity(&value).map_err(|_| {
        diagnostic(
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            "vector index manifest is not canonicalizable",
        )
    })
}

fn index_binding<'a>(
    schema: &'a SchemaManifest,
    table_name: &str,
    index_name: &str,
) -> SnapbackResult<(&'a TableManifest, &'a VectorIndexManifestV1)> {
    let table = schema.table(table_name).ok_or_else(|| {
        diagnostic(
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            "vector table is not installed",
        )
    })?;
    let index = table
        .vector_indexes
        .iter()
        .find(|candidate| candidate.name == index_name)
        .ok_or_else(|| {
            diagnostic(
                "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
                "vector index is not installed",
            )
        })?;
    Ok((table, index))
}

fn active_generation(
    conn: &Connection,
    table: &str,
    index: &VectorIndexManifestV1,
) -> SnapbackResult<u64> {
    let active: Option<(i64, String, String, String, String, Option<String>)> = conn
        .query_row(
            "SELECT generation,semantic_version,manifest_digest,status,root_digest,corruption_reason
             FROM _snapback_vector_generations
             WHERE table_name=?1 AND index_name=?2
               AND status IN ('active','quarantined')
             ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, generation DESC LIMIT 1",
            params![table, index.name],
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
    let Some((generation, semantic, digest, status, root, corruption_reason)) = active else {
        return Err(diagnostic(
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            "vector index has no active generation",
        ));
    };
    if status != "active"
        || corruption_reason.is_some()
        || root.len() != 71
        || !root.starts_with("sha256:")
        || !root[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(diagnostic(
            "SNAPBACK_VECTOR_INDEX_CORRUPT",
            "vector index generation seal is not valid",
        ));
    }
    if semantic != index.semantic_version || digest != manifest_digest(index)? {
        return Err(diagnostic(
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            "vector index generation does not match the installed declaration",
        ));
    }
    if root != generation_root(conn, table, &index.name, generation as u64)? {
        return Err(diagnostic(
            "SNAPBACK_VECTOR_INDEX_CORRUPT",
            "vector generation root does not match its derived rows",
        ));
    }
    Ok(generation as u64)
}

pub(crate) fn validate_index_declaration(
    table: &TableManifest,
    index: &VectorIndexManifestV1,
) -> SnapbackResult<()> {
    let invalid = || {
        diagnostic(
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            format!(
                "vector index {}.{} does not match the exact v1 profile",
                table.name, index.name
            ),
        )
    };
    if index.format_version != 1
        || index.name.trim().is_empty()
        || index.semantic_version.trim().is_empty()
        || index.distance_profile != VECTOR_DISTANCE_PROFILE
        || index.ordering_profile != VECTOR_ORDERING_PROFILE
        || index.dimensions == 0
        || index.dimensions > VECTOR_MAX_DIMENSIONS
        || index.max_indexed_vectors_per_partition == 0
        || index.max_indexed_vectors_per_partition > VECTOR_MAX_CORPUS
        || u64::from(index.dimensions) * u64::from(index.max_indexed_vectors_per_partition)
            > VECTOR_MAX_SCALAR_PAIRS
        || index.equality_filters.len() > VECTOR_MAX_FILTERS
        || index.maintenance_limits.vector_maintenance_effects == 0
        || index.maintenance_limits.vector_maintenance_effects > VECTOR_MAX_MAINTENANCE_EFFECTS
        || index.maintenance_limits.vector_bytes == 0
        || index.maintenance_limits.vector_bytes > VECTOR_MAX_BYTES_PER_COMMIT
    {
        return Err(invalid());
    }
    let vector = table.field(&index.vector_field).ok_or_else(invalid)?;
    if vector.optional
        || vector.field_type
            != (FieldType::Vector {
                dimensions: index.dimensions,
            })
    {
        return Err(invalid());
    }
    let equality = index.equality_filters.iter().collect::<BTreeSet<_>>();
    let stored = index.stored_fields.iter().collect::<BTreeSet<_>>();
    if equality.len() != index.equality_filters.len()
        || stored.len() != index.stored_fields.len()
        || equality.iter().any(|name| {
            !table.field(name).is_some_and(|field| {
                !field.optional
                    && matches!(
                        field.field_type,
                        FieldType::String
                            | FieldType::Boolean
                            | FieldType::Integer
                            | FieldType::Principal
                            | FieldType::Id { .. }
                    )
            })
        })
        || stored.iter().any(|name| table.field(name).is_none())
    {
        return Err(invalid());
    }
    let mut participating = equality
        .into_iter()
        .chain(stored)
        .map(|name| (*name).clone())
        .collect::<BTreeSet<_>>();
    participating.insert(index.vector_field.clone());
    match &index.visibility {
        VectorVisibilityV1::Owner { field } => {
            if !table.field(field).is_some_and(|owner| {
                !owner.optional
                    && matches!(owner.field_type, FieldType::String | FieldType::Principal)
            }) {
                return Err(invalid());
            }
        }
        VectorVisibilityV1::PublicRead => {}
    }
    if index
        .field_classifications
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>()
        != participating
        || index.field_classifications.values().any(|classification| {
            matches!(
                classification,
                VectorFieldClassV1::Sensitive | VectorFieldClassV1::Forbidden
            )
        })
        || matches!(index.visibility, VectorVisibilityV1::PublicRead)
            && index
                .field_classifications
                .values()
                .any(|classification| *classification != VectorFieldClassV1::Public)
    {
        return Err(invalid());
    }
    Ok(())
}

fn partition_for(index: &VectorIndexManifestV1, row: &Value) -> SnapbackResult<String> {
    match &index.visibility {
        VectorVisibilityV1::PublicRead => Ok("public".to_owned()),
        VectorVisibilityV1::Owner { field } => row
            .get(field)
            .and_then(Value::as_str)
            .map(|value| format!("owner:{value}"))
            .ok_or_else(|| {
                diagnostic(
                    "SNAPBACK_VECTOR_VALUE_INVALID",
                    "vector owner partition is missing or invalid",
                )
            }),
    }
}

fn vector_from_row(index: &VectorIndexManifestV1, row: &Value) -> SnapbackResult<Vec<f64>> {
    let values = row
        .get(&index.vector_field)
        .and_then(Value::as_array)
        .ok_or_else(|| {
            diagnostic(
                "SNAPBACK_VECTOR_VALUE_INVALID",
                "declared vector field is missing or is not an array",
            )
        })?
        .iter()
        .map(|value| {
            value.as_f64().ok_or_else(|| {
                diagnostic(
                    "SNAPBACK_VECTOR_VALUE_INVALID",
                    "stored vector component is not a binary64 number",
                )
            })
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    crate::vector::admit_stored_vector(&values, index.dimensions)
}

fn encode_vector(values: &[f64]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(values.len() * 8);
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn decode_vector(bytes: &[u8], dimensions: u32) -> SnapbackResult<Vec<f64>> {
    if bytes.len() != dimensions as usize * 8 {
        return Err(diagnostic(
            "SNAPBACK_VECTOR_INDEX_CORRUPT",
            "vector shadow blob has the wrong byte length",
        ));
    }
    let values = bytes
        .chunks_exact(8)
        .map(|chunk| f64::from_le_bytes(chunk.try_into().expect("eight-byte chunk")))
        .collect::<Vec<_>>();
    crate::vector::admit_stored_vector(&values, dimensions).map_err(|_| {
        diagnostic(
            "SNAPBACK_VECTOR_INDEX_CORRUPT",
            "vector shadow blob contains an inadmissible component",
        )
    })
}

fn source_parts(
    index: &VectorIndexManifestV1,
    row: &Value,
) -> SnapbackResult<(String, Vec<f64>, Map<String, Value>, Map<String, Value>)> {
    let partition = partition_for(index, row)?;
    let vector = vector_from_row(index, row)?;
    let filters = index
        .equality_filters
        .iter()
        .map(|field| {
            (
                field.clone(),
                row.get(field).cloned().unwrap_or(Value::Null),
            )
        })
        .collect();
    let fields = index
        .stored_fields
        .iter()
        .map(|field| {
            (
                field.clone(),
                row.get(field).cloned().unwrap_or(Value::Null),
            )
        })
        .collect();
    Ok((partition, vector, filters, fields))
}

fn content_digest(
    row_id: &str,
    source_version: u64,
    partition: &str,
    vector: &[f64],
    filters: &Map<String, Value>,
    fields: &Map<String, Value>,
) -> SnapbackResult<String> {
    crate::rqs::sha256_identity(&json!({
        "rowId": row_id,
        "sourceVersion": source_version,
        "partition": partition,
        "vector": vector,
        "filters": filters,
        "fields": fields,
    }))
    .map_err(|_| {
        diagnostic(
            "SNAPBACK_VECTOR_INDEX_CORRUPT",
            "vector source identity is not canonicalizable",
        )
    })
}

#[derive(Clone, Copy, Default)]
struct MaintenanceCounters {
    effects: u32,
    bytes: u32,
}

impl MaintenanceCounters {
    fn add(&mut self, delta: Self) {
        self.effects = self.effects.saturating_add(delta.effects);
        self.bytes = self.bytes.saturating_add(delta.bytes);
    }

    fn delta_from(self, before: Self) -> Self {
        Self {
            effects: self.effects.saturating_sub(before.effects),
            bytes: self.bytes.saturating_sub(before.bytes),
        }
    }

    fn enforce_global(&self) -> SnapbackResult<()> {
        if self.effects > VECTOR_MAX_MAINTENANCE_EFFECTS || self.bytes > VECTOR_MAX_BYTES_PER_COMMIT
        {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_WORK_LIMIT",
                "vector maintenance exceeds the global transaction ceiling",
            ));
        }
        Ok(())
    }

    fn enforce_index(&self, index: &VectorIndexManifestV1) -> SnapbackResult<()> {
        if self.effects > index.maintenance_limits.vector_maintenance_effects
            || self.bytes > index.maintenance_limits.vector_bytes
        {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_WORK_LIMIT",
                "vector maintenance exceeds the declared transaction ceiling",
            ));
        }
        Ok(())
    }
}

fn replace_source(
    tx: &Transaction<'_>,
    table: &str,
    index: &VectorIndexManifestV1,
    generation: u64,
    row_id: &str,
    source_version: u64,
    row: Option<&Value>,
    counters: &mut MaintenanceCounters,
) -> SnapbackResult<()> {
    let generation_seal: Option<(String, String, Option<String>)> = tx
        .query_row(
            "SELECT status,root_digest,corruption_reason
             FROM _snapback_vector_generations
             WHERE table_name=?1 AND index_name=?2 AND generation=?3",
            params![table, index.name, generation as i64],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if generation_seal
        .as_ref()
        .is_some_and(|(status, root, reason)| {
            status != "active"
                || root.len() != 71
                || !root.starts_with("sha256:")
                || !root[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
                || reason.is_some()
        })
    {
        return Err(diagnostic(
            "SNAPBACK_VECTOR_INDEX_CORRUPT",
            "vector maintenance cannot reseal a generation that was already quarantined",
        ));
    }
    if let Some((_, root, _)) = &generation_seal
        && root != &generation_root(tx, table, &index.name, generation)?
    {
        return Err(diagnostic(
            "SNAPBACK_VECTOR_INDEX_CORRUPT",
            "vector maintenance found a generation-root mismatch",
        ));
    }

    let next = match row {
        Some(row) => {
            let (partition, vector, filters, fields) = source_parts(index, row)?;
            let blob = encode_vector(&vector);
            let filters_json = serde_json::to_string(&filters).map_err(|_| {
                diagnostic(
                    "SNAPBACK_VECTOR_VALUE_INVALID",
                    "vector filter projection does not serialize",
                )
            })?;
            let fields_json = serde_json::to_string(&fields).map_err(|_| {
                diagnostic(
                    "SNAPBACK_VECTOR_VALUE_INVALID",
                    "vector stored projection does not serialize",
                )
            })?;
            let digest = content_digest(
                row_id,
                source_version,
                &partition,
                &vector,
                &filters,
                &fields,
            )?;
            Some((partition, blob, filters_json, fields_json, digest))
        }
        None => None,
    };
    let tombstone_digest = if next.is_none() {
        Some(
            crate::rqs::sha256_identity(&json!({
                "rowId": row_id,
                "sourceVersion": source_version,
                "tombstone": true,
            }))
            .map_err(|_| {
                diagnostic(
                    "SNAPBACK_VECTOR_INDEX_CORRUPT",
                    "vector tombstone identity is not canonicalizable",
                )
            })?,
        )
    } else {
        None
    };
    let next_digest = next
        .as_ref()
        .map(|entry| entry.4.as_str())
        .or(tombstone_digest.as_deref())
        .expect("source or tombstone digest")
        .to_owned();
    let previous: Option<(u64, bool, String)> = tx
        .query_row(
            "SELECT highest_version,tombstone,content_digest
             FROM _snapback_vector_frontiers
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND source_id=?4",
            params![table, index.name, generation as i64, row_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    row.get::<_, i64>(1)? != 0,
                    row.get(2)?,
                ))
            },
        )
        .optional()?;
    if let Some((highest, tombstone, digest)) = previous {
        if highest > source_version {
            return Ok(());
        }
        if highest == source_version {
            if tombstone == next.is_none() && digest == next_digest {
                return Ok(());
            }
            return Err(diagnostic(
                "SNAPBACK_VECTOR_INDEX_CORRUPT",
                "vector source version was reused with different derived bytes",
            ));
        }
    }

    tx.execute(
        "DELETE FROM _snapback_vector_sources
         WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND row_id=?4",
        params![table, index.name, generation as i64, row_id],
    )?;
    counters.effects = counters.effects.saturating_add(1);
    if let Some((partition, blob, filters_json, fields_json, digest)) = next {
        let count: u32 = tx.query_row(
            "SELECT COUNT(*) FROM _snapback_vector_sources
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND partition_key=?4",
            params![table, index.name, generation as i64, partition],
            |row| row.get(0),
        )?;
        if count >= index.max_indexed_vectors_per_partition {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_CORPUS_BOUND",
                "vector mutation would exceed the declared partition corpus bound",
            ));
        }
        counters.bytes = counters
            .bytes
            .saturating_add((blob.len() + filters_json.len() + fields_json.len()) as u32);
        tx.execute(
            "INSERT INTO _snapback_vector_sources
             (table_name,index_name,generation,row_id,source_version,partition_key,vector_blob,filters_json,fields_json,content_digest)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                table,
                index.name,
                generation as i64,
                row_id,
                source_version as i64,
                partition,
                blob,
                filters_json,
                fields_json,
                digest,
            ],
        )?;
    }
    tx.execute(
        "INSERT INTO _snapback_vector_frontiers
         (table_name,index_name,generation,source_id,highest_version,tombstone,content_digest)
         VALUES (?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(table_name,index_name,generation,source_id) DO UPDATE SET
           highest_version=excluded.highest_version,
           tombstone=excluded.tombstone,
           content_digest=excluded.content_digest",
        params![
            table,
            index.name,
            generation as i64,
            row_id,
            source_version as i64,
            i64::from(row.is_none()),
            next_digest,
        ],
    )?;
    if generation_seal.is_some() {
        let root = generation_root(tx, table, &index.name, generation)?;
        let resealed = tx.execute(
            "UPDATE _snapback_vector_generations
                SET status='active',root_digest=?4,corruption_reason=NULL,source_head=?5
              WHERE table_name=?1 AND index_name=?2 AND generation=?3
                AND status='quarantined'",
            params![
                table,
                index.name,
                generation as i64,
                root,
                source_version as i64
            ],
        )?;
        if resealed != 1 {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_INDEX_CORRUPT",
                "vector generation could not be resealed after maintenance",
            ));
        }
    }
    Ok(())
}

fn scan_table_rows(
    tx: &Transaction<'_>,
    table: &TableManifest,
) -> SnapbackResult<Vec<(String, u64, Value)>> {
    let quoted = crate::storage::quote_ident(&table.name)?;
    let mut statement = tx.prepare(&format!("SELECT * FROM {quoted} ORDER BY \"_id\" ASC"))?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let value = crate::storage::row_to_document(row, table, &columns)?;
        out.push((
            value
                .get("_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            value
                .get("_version")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            value,
        ));
    }
    Ok(out)
}

pub fn activate_manifest_in_tx(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    source_head: u64,
) -> SnapbackResult<()> {
    for table in &schema.tables {
        for index in &table.vector_indexes {
            validate_index_declaration(table, index)?;
            let digest = manifest_digest(index)?;
            let existing: Option<(String, String, String)> = tx
                .query_row(
                    "SELECT semantic_version,manifest_digest,status
                     FROM _snapback_vector_generations
                     WHERE table_name=?1 AND index_name=?2
                     ORDER BY generation DESC LIMIT 1",
                    params![table.name, index.name],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            if existing
                .as_ref()
                .is_some_and(|(semantic, existing_digest, status)| {
                    semantic == &index.semantic_version
                        && existing_digest == &digest
                        && status == "active"
                })
            {
                active_generation(tx, &table.name, index)?;
                let overflow: Option<String> = tx
                    .query_row(
                        "SELECT partition_key FROM _snapback_vector_sources
                         WHERE table_name=?1 AND index_name=?2
                         GROUP BY partition_key HAVING COUNT(*)>?3 LIMIT 1",
                        params![
                            table.name,
                            index.name,
                            index.max_indexed_vectors_per_partition
                        ],
                        |row| row.get(0),
                    )
                    .optional()?;
                if overflow.is_some() {
                    return Err(diagnostic(
                        "SNAPBACK_VECTOR_CORPUS_BOUND",
                        "existing vector partition exceeds the declared corpus bound",
                    ));
                }
                continue;
            }
            let generation: u64 = tx.query_row(
                "SELECT COALESCE(MAX(generation),0)+1 FROM _snapback_vector_generations
                 WHERE table_name=?1 AND index_name=?2",
                params![table.name, index.name],
                |row| row.get::<_, i64>(0).map(|value| value as u64),
            )?;
            let rows = scan_table_rows(tx, table)?;
            let mut counters = MaintenanceCounters::default();
            for (row_id, source_version, row) in &rows {
                replace_source(
                    tx,
                    &table.name,
                    index,
                    generation,
                    row_id,
                    *source_version,
                    Some(row),
                    &mut counters,
                )?;
            }
            tx.execute(
                "UPDATE _snapback_vector_generations SET status='retired'
                 WHERE table_name=?1 AND index_name=?2 AND status='active'",
                params![table.name, index.name],
            )?;
            let root = generation_root(tx, &table.name, &index.name, generation)?;
            tx.execute(
                "INSERT INTO _snapback_vector_generations
                 (table_name,index_name,semantic_version,manifest_digest,generation,status,source_head,root_digest,corruption_reason)
                 VALUES (?1,?2,?3,?4,?5,'active',?6,?7,NULL)",
                params![
                    table.name,
                    index.name,
                    index.semantic_version,
                    digest,
                    generation as i64,
                    source_head as i64,
                    root,
                ],
            )?;
            tx.execute(
                "DELETE FROM _snapback_vector_sources
                 WHERE table_name=?1 AND index_name=?2 AND generation<>?3",
                params![table.name, index.name, generation as i64],
            )?;
            tx.execute(
                "DELETE FROM _snapback_vector_frontiers
                 WHERE table_name=?1 AND index_name=?2 AND generation<>?3",
                params![table.name, index.name, generation as i64],
            )?;
        }
    }
    Ok(())
}

pub fn maintain_vector_indexes_in_tx(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    changes: &[ChangedRow],
    version: u64,
) -> SnapbackResult<()> {
    let mut counters = MaintenanceCounters::default();
    let mut by_index = BTreeMap::<(String, String), MaintenanceCounters>::new();
    for change in changes {
        let Some(table) = schema.table(&change.table) else {
            continue;
        };
        for index in &table.vector_indexes {
            let generation = active_generation(tx, &table.name, index)?;
            let before = counters;
            replace_source(
                tx,
                &table.name,
                index,
                generation,
                &change.id,
                version,
                if change.op == ChangeOp::Delete {
                    None
                } else {
                    change.row.as_ref()
                },
                &mut counters,
            )?;
            let index_counters = by_index
                .entry((table.name.clone(), index.name.clone()))
                .or_default();
            index_counters.add(counters.delta_from(before));
            index_counters.enforce_index(index)?;
            counters.enforce_global()?;
        }
    }
    counters.enforce_global()
}

fn validate_filter_value(field_type: &FieldType, value: &VectorFilterValueV1) -> bool {
    match (field_type, value) {
        (
            FieldType::String
            | FieldType::Principal
            | FieldType::Id { .. }
            | FieldType::AssetRef { .. },
            VectorFilterValueV1::String(_),
        )
        | (FieldType::Boolean, VectorFilterValueV1::Boolean(_)) => true,
        (FieldType::Integer, VectorFilterValueV1::Number(number)) => number.as_i64().is_some(),
        _ => false,
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct VectorWorkCountersV1 {
    pub postings_enumerated: u64,
    pub filter_comparisons: u64,
    pub candidates_scored: u64,
    pub scalar_pairs: u64,
    pub source_reads: u64,
}

struct Candidate {
    row_id: String,
    source_version: u64,
    partition: String,
    vector: Vec<f64>,
    filters: Map<String, Value>,
    fields: Map<String, Value>,
    content_digest: String,
    distance: f64,
}

pub(crate) fn query_vector_with_facts(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &VectorQueryPlanV1,
    input: &HandlerInput,
) -> SnapbackResult<(QueryOutput, VectorWorkCountersV1)> {
    let (table, index) = index_binding(schema, &plan.table, &plan.index)?;
    let generation = active_generation(conn, &table.name, index)?;
    let request: VectorRequestV1 = serde_json::from_value(input.args.clone()).map_err(|_| {
        diagnostic(
            "SNAPBACK_VECTOR_QUERY_INVALID",
            "vector request does not match the closed v1 argument shape",
        )
    })?;
    let query = crate::vector::admit_query_vector(&request.vector, index.dimensions)?;
    let k = request.k.unwrap_or(10);
    if k == 0 || k > VECTOR_MAX_K {
        return Err(diagnostic(
            "SNAPBACK_VECTOR_QUERY_INVALID",
            "vector k must be in 1..=64",
        ));
    }
    let mut filters = request.filters.unwrap_or_default();
    let distinct = filters
        .iter()
        .map(|filter| filter.field.as_str())
        .collect::<BTreeSet<_>>();
    if filters.len() > VECTOR_MAX_FILTERS || distinct.len() != filters.len() {
        return Err(diagnostic(
            "SNAPBACK_VECTOR_QUERY_INVALID",
            "vector filters must be distinct and contain at most eight fields",
        ));
    }
    for filter in &filters {
        if !index.equality_filters.contains(&filter.field)
            || !table
                .field(&filter.field)
                .is_some_and(|field| validate_filter_value(&field.field_type, &filter.value))
        {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_QUERY_INVALID",
                "vector filter is undeclared or has the wrong portable scalar type",
            ));
        }
    }
    // @ref LLP 0132#candidate-to-release-consistency — filter work is
    // counted in declaration order, independent of caller object ordering.
    filters.sort_by_key(|filter| {
        index
            .equality_filters
            .iter()
            .position(|field| field == &filter.field)
            .expect("validated declared vector filter")
    });
    let partition = match &index.visibility {
        VectorVisibilityV1::PublicRead => "public".to_owned(),
        VectorVisibilityV1::Owner { .. } => input
            .auth
            .user_id
            .as_ref()
            .map(|owner| format!("owner:{owner}"))
            .ok_or_else(|| {
                diagnostic(
                    "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
                    "vector owner authority is unavailable",
                )
            })?,
    };
    let mut statement = conn.prepare(
        "SELECT row_id,source_version,partition_key,vector_blob,filters_json,fields_json,content_digest
         FROM _snapback_vector_sources
         WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND partition_key=?4
         ORDER BY row_id ASC",
    )?;
    let mut rows = statement.query(params![
        table.name,
        index.name,
        generation as i64,
        partition
    ])?;
    let mut counters = VectorWorkCountersV1::default();
    let mut candidates = Vec::new();
    while let Some(row) = rows.next()? {
        counters.postings_enumerated += 1;
        if counters.postings_enumerated > u64::from(index.max_indexed_vectors_per_partition) {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_WORK_LIMIT",
                "vector partition enumeration exceeds its declared corpus ceiling",
            ));
        }
        let filter_values: Map<String, Value> = serde_json::from_str(&row.get::<_, String>(4)?)
            .map_err(|_| {
                diagnostic(
                    "SNAPBACK_VECTOR_INDEX_CORRUPT",
                    "vector filter projection is corrupt",
                )
            })?;
        let mut accepted = true;
        for filter in &filters {
            counters.filter_comparisons += 1;
            if counters.filter_comparisons
                > u64::from(index.max_indexed_vectors_per_partition) * filters.len() as u64
            {
                return Err(diagnostic(
                    "SNAPBACK_VECTOR_WORK_LIMIT",
                    "vector equality filtering exceeds its structural ceiling",
                ));
            }
            if !filter
                .value
                .matches_value(filter_values.get(&filter.field).unwrap_or(&Value::Null))
            {
                accepted = false;
                break;
            }
        }
        if !accepted {
            continue;
        }
        if counters
            .scalar_pairs
            .saturating_add(u64::from(index.dimensions))
            > u64::from(index.dimensions) * u64::from(index.max_indexed_vectors_per_partition)
        {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_WORK_LIMIT",
                "vector query exceeds the declared scalar-pair work ceiling",
            ));
        }
        let vector = decode_vector(&row.get::<_, Vec<u8>>(3)?, index.dimensions)?;
        counters.candidates_scored += 1;
        if counters.candidates_scored > u64::from(index.max_indexed_vectors_per_partition) {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_WORK_LIMIT",
                "vector scoring exceeds its declared candidate ceiling",
            ));
        }
        counters.scalar_pairs += u64::from(index.dimensions);
        let distance = crate::vector::distance(index.metric, &query, &vector);
        if !distance.is_finite() {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_INDEX_CORRUPT",
                "vector distance escaped the portable finite domain",
            ));
        }
        let fields: Map<String, Value> =
            serde_json::from_str(&row.get::<_, String>(5)?).map_err(|_| {
                diagnostic(
                    "SNAPBACK_VECTOR_INDEX_CORRUPT",
                    "vector stored projection is corrupt",
                )
            })?;
        candidates.push(Candidate {
            row_id: row.get(0)?,
            source_version: row.get::<_, i64>(1)? as u64,
            partition: row.get(2)?,
            vector,
            filters: filter_values,
            fields,
            content_digest: row.get(6)?,
            distance,
        });
    }
    candidates.sort_by(|left, right| {
        let primary = match index.metric {
            VectorMetricV1::L2sq => left.distance.total_cmp(&right.distance),
            VectorMetricV1::Dot => right.distance.total_cmp(&left.distance),
        };
        primary.then_with(|| match index.tie_break {
            VectorTieBreakV1::IdAsc => left.row_id.as_bytes().cmp(right.row_id.as_bytes()),
            VectorTieBreakV1::IdDesc => right.row_id.as_bytes().cmp(left.row_id.as_bytes()),
        })
    });
    candidates.truncate(k as usize);
    let quoted_table = crate::storage::quote_ident(&table.name)?;
    let mut items = Vec::new();
    for candidate in candidates {
        counters.source_reads += 1;
        if counters.source_reads > u64::from(k) {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_WORK_LIMIT",
                "vector release reads exceed k",
            ));
        }
        let mut current_statement =
            conn.prepare(&format!("SELECT * FROM {quoted_table} WHERE \"_id\"=?1"))?;
        let columns = current_statement
            .column_names()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let current: Option<Value> = current_statement
            .query_row(params![candidate.row_id], |row| {
                crate::storage::row_to_document(row, table, &columns)
                    .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
            })
            .optional()
            .map_err(|_| {
                diagnostic(
                    "SNAPBACK_VECTOR_INDEX_CORRUPT",
                    "vector authoritative source row cannot be decoded",
                )
            })?;
        let Some(current) = current else {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_INDEX_CORRUPT",
                "vector source row disappeared during release recheck",
            ));
        };
        let current_version = current
            .get("_version")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let (partition, vector, filter_values, fields) =
            source_parts(index, &current).map_err(|_| {
                diagnostic(
                    "SNAPBACK_VECTOR_INDEX_CORRUPT",
                    "vector authoritative source row no longer matches the declaration",
                )
            })?;
        let digest = content_digest(
            &candidate.row_id,
            current_version,
            &partition,
            &vector,
            &filter_values,
            &fields,
        )?;
        if current_version != candidate.source_version
            || partition != candidate.partition
            || vector != candidate.vector
            || filter_values != candidate.filters
            || fields != candidate.fields
            || digest != candidate.content_digest
        {
            return Err(diagnostic(
                "SNAPBACK_VECTOR_INDEX_CORRUPT",
                "vector posting failed current authoritative source recheck",
            ));
        }
        items.push(VectorItemV1 {
            row_id: candidate.row_id,
            distance: candidate.distance,
            fields: candidate.fields,
        });
    }
    let version = crate::storage::current_version_on(conn)?;
    Ok((
        QueryOutput {
            version,
            rows: items
                .into_iter()
                .map(|item| serde_json::to_value(item).expect("vector item serializes"))
                .collect(),
            cursor: None,
        },
        counters,
    ))
}

pub fn query_vector_on(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &VectorQueryPlanV1,
    input: &HandlerInput,
) -> SnapbackResult<QueryOutput> {
    query_vector_with_facts(conn, schema, plan, input).map(|(output, _)| output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        AuthInput, FieldManifest, MutationPlan, MutationStep, SeedData, ValueExpr,
    };
    use crate::storage::{DbRead, LocalDatabase};

    fn vector_index(
        dimensions: u32,
        metric: VectorMetricV1,
        visibility: VectorVisibilityV1,
        tie_break: VectorTieBreakV1,
        corpus: u32,
    ) -> VectorIndexManifestV1 {
        let public = matches!(visibility, VectorVisibilityV1::PublicRead);
        let classification = if public {
            VectorFieldClassV1::Public
        } else {
            VectorFieldClassV1::Private
        };
        VectorIndexManifestV1 {
            format_version: 1,
            name: "by_embedding".to_owned(),
            semantic_version: format!("documents.embedding.{dimensions}.v1"),
            vector_field: "embedding".to_owned(),
            dimensions,
            metric,
            distance_profile: VECTOR_DISTANCE_PROFILE.to_owned(),
            ordering_profile: VECTOR_ORDERING_PROFILE.to_owned(),
            field_classifications: BTreeMap::from([
                ("category".to_owned(), classification),
                ("embedding".to_owned(), classification),
                ("title".to_owned(), classification),
            ]),
            equality_filters: vec!["category".to_owned()],
            stored_fields: vec!["title".to_owned()],
            visibility,
            tie_break,
            max_indexed_vectors_per_partition: corpus,
            maintenance_limits: VectorMaintenanceLimitsV1::default(),
        }
    }

    fn schema_with(index: Option<VectorIndexManifestV1>) -> SchemaManifest {
        let mut schema = SchemaManifest::default();
        schema.required_capabilities = index
            .as_ref()
            .map(|_| vec![VECTOR_CAPABILITY.to_owned()])
            .unwrap_or_default();
        let dimensions = index.as_ref().map_or(32, |index| index.dimensions);
        schema.tables = vec![TableManifest {
            name: "documents".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "ownerId".to_owned(),
                    field_type: FieldType::Principal,
                    optional: false,
                },
                FieldManifest {
                    name: "category".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "embedding".to_owned(),
                    field_type: FieldType::Vector { dimensions },
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            search_indexes: Vec::new(),
            vector_indexes: index.into_iter().collect(),
            syncable: false,
            permission_backing: false,
            permission_fields: None,
            membership: None,
            asset_sharing: None,
        }];
        schema
    }

    fn fixture_vector(dimensions: u32, first: f64, second: f64) -> Vec<Value> {
        (0..dimensions)
            .map(|index| match index {
                0 => json!(first),
                1 => json!(second),
                _ => json!(0.0),
            })
            .collect()
    }

    fn fixture_row(
        id: &str,
        owner: &str,
        title: &str,
        category: &str,
        vector: Vec<Value>,
    ) -> Map<String, Value> {
        Map::from_iter([
            ("_id".to_owned(), json!(id)),
            ("ownerId".to_owned(), json!(owner)),
            ("title".to_owned(), json!(title)),
            ("category".to_owned(), json!(category)),
            ("embedding".to_owned(), Value::Array(vector)),
        ])
    }

    fn seeded_database(
        index: VectorIndexManifestV1,
        rows: Vec<Map<String, Value>>,
    ) -> LocalDatabase {
        let schema = schema_with(Some(index));
        let mut database = LocalDatabase::memory().expect("in-memory database");
        database
            .apply_schema(schema)
            .expect("activate vector schema");
        database
            .reset_and_seed(Some(SeedData {
                tables: BTreeMap::from([("documents".to_owned(), rows)]),
            }))
            .expect("seed maintained vector rows");
        database
    }

    fn plan() -> VectorQueryPlanV1 {
        VectorQueryPlanV1 {
            table: "documents".to_owned(),
            index: "by_embedding".to_owned(),
            distance_profile: VECTOR_DISTANCE_PROFILE.to_owned(),
            result_projection: "vector-page-v1".to_owned(),
            required_capability: VECTOR_CAPABILITY.to_owned(),
        }
    }

    fn input(
        owner: Option<&str>,
        vector: Vec<Value>,
        filters: Option<Vec<VectorFilterV1>>,
    ) -> HandlerInput {
        HandlerInput {
            args: json!({
                "vector": vector,
                "k": 64,
                "filters": filters,
            }),
            auth: AuthInput {
                principal: owner.map(str::to_owned),
                user_id: owner.map(str::to_owned),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        }
    }

    fn patch(
        database: &mut LocalDatabase,
        id: &str,
        values: BTreeMap<String, ValueExpr>,
    ) -> SnapbackResult<()> {
        database
            .execute_mutation(
                &MutationPlan {
                    steps: vec![MutationStep::Patch {
                        table: "documents".to_owned(),
                        id: ValueExpr::Literal(json!(id)),
                        values,
                    }],
                    return_value: None,
                },
                &HandlerInput::default(),
            )
            .map(|_| ())
    }

    fn delete(database: &mut LocalDatabase, id: &str) -> SnapbackResult<()> {
        database
            .execute_mutation(
                &MutationPlan {
                    steps: vec![MutationStep::Delete {
                        table: "documents".to_owned(),
                        id: ValueExpr::Literal(json!(id)),
                    }],
                    return_value: None,
                },
                &HandlerInput::default(),
            )
            .map(|_| ())
    }

    fn resident_kib() -> u64 {
        std::process::Command::new("ps")
            .args(["-o", "rss=", "-p"])
            .arg(std::process::id().to_string())
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .and_then(|text| text.trim().parse::<u64>().ok())
            .unwrap_or_default()
    }

    fn row_ids(output: &QueryOutput) -> Vec<&str> {
        output
            .rows
            .iter()
            .map(|row| row["rowId"].as_str().expect("rowId"))
            .collect()
    }

    // @ref LLP 0132#acceptance — the frozen Research Room workload is
    // restated at 32 dimensions under the two v1 visibility shapes; owner
    // noninterference includes the complete logical-work transcript.
    #[test]
    fn research_room_fixture_is_exact_for_owner_and_public_visibility() {
        let owner_index = vector_index(
            32,
            VectorMetricV1::L2sq,
            VectorVisibilityV1::Owner {
                field: "ownerId".to_owned(),
            },
            VectorTieBreakV1::IdAsc,
            16,
        );
        let alice_rows = vec![
            fixture_row(
                "paper-a",
                "alice",
                "Portable indexes",
                "systems",
                fixture_vector(32, 1.0, 0.0),
            ),
            fixture_row(
                "paper-b",
                "alice",
                "Exact retrieval",
                "systems",
                fixture_vector(32, 0.0, 1.0),
            ),
        ];
        let mut left_rows = alice_rows.clone();
        left_rows.push(fixture_row(
            "private-bob",
            "bob",
            "Other owner",
            "systems",
            fixture_vector(32, 1.0, 1.0),
        ));
        let mut right_rows = alice_rows;
        right_rows.push(fixture_row(
            "private-bob",
            "bob",
            "Changed other owner",
            "systems",
            fixture_vector(32, -1.0, -1.0),
        ));
        let left = seeded_database(owner_index.clone(), left_rows);
        let right = seeded_database(owner_index, right_rows);
        let query = input(
            Some("alice"),
            fixture_vector(32, 0.5, 0.5),
            Some(vec![VectorFilterV1 {
                field: "category".to_owned(),
                op: VectorFilterOpV1::Eq,
                value: VectorFilterValueV1::String("systems".to_owned()),
            }]),
        );
        let left_result = DbRead::Live(&left)
            .vector_search_with_facts(&plan(), &query)
            .expect("left owner query");
        let right_result = DbRead::Live(&right)
            .vector_search_with_facts(&plan(), &query)
            .expect("right owner query");
        assert_eq!(left_result, right_result);
        assert_eq!(row_ids(&left_result.0), vec!["paper-a", "paper-b"]);
        assert_eq!(left_result.0.rows[0]["distance"], json!(0.5));
        assert_eq!(left_result.0.cursor, None);

        let public_index = vector_index(
            32,
            VectorMetricV1::Dot,
            VectorVisibilityV1::PublicRead,
            VectorTieBreakV1::IdDesc,
            16,
        );
        let public = seeded_database(
            public_index,
            vec![
                fixture_row(
                    "paper-a",
                    "alice",
                    "A",
                    "systems",
                    fixture_vector(32, 1.0, 0.0),
                ),
                fixture_row(
                    "paper-b",
                    "bob",
                    "B",
                    "systems",
                    fixture_vector(32, 1.0, 0.0),
                ),
            ],
        );
        let output = DbRead::Live(&public)
            .vector_search(&plan(), &input(None, fixture_vector(32, 1.0, 0.0), None))
            .expect("public dot query");
        assert_eq!(row_ids(&output), vec!["paper-b", "paper-a"]);
        assert_eq!(output.rows[0]["distance"], json!(1.0));
    }

    // @ref LLP 0132#index-maintenance-and-storage — ordinary source commits
    // and the shadow generation advance atomically through every mutation
    // shape, including negative probes after transfer and delete.
    #[test]
    fn insert_update_transfer_delete_and_bounds_are_commit_head_exact() {
        let index = vector_index(
            2,
            VectorMetricV1::L2sq,
            VectorVisibilityV1::Owner {
                field: "ownerId".to_owned(),
            },
            VectorTieBreakV1::IdAsc,
            1,
        );
        let mut database = seeded_database(
            index,
            vec![
                fixture_row(
                    "alice-full",
                    "alice",
                    "A",
                    "systems",
                    fixture_vector(2, 0.0, 0.0),
                ),
                fixture_row(
                    "bob-row",
                    "bob",
                    "B",
                    "systems",
                    fixture_vector(2, 1.0, 0.0),
                ),
            ],
        );
        let overflow = database
            .execute_mutation(
                &MutationPlan {
                    steps: vec![MutationStep::Insert {
                        table: "documents".to_owned(),
                        values: BTreeMap::from([
                            ("ownerId".to_owned(), ValueExpr::Literal(json!("alice"))),
                            ("title".to_owned(), ValueExpr::Literal(json!("overflow"))),
                            ("category".to_owned(), ValueExpr::Literal(json!("systems"))),
                            (
                                "embedding".to_owned(),
                                ValueExpr::Literal(json!([2.0, 0.0])),
                            ),
                        ]),
                        bind_id_as: None,
                    }],
                    return_value: None,
                },
                &HandlerInput::default(),
            )
            .expect_err("full destination refuses insert");
        assert_eq!(overflow.diagnostic.code, "SNAPBACK_VECTOR_CORPUS_BOUND");

        let transfer = patch(
            &mut database,
            "bob-row",
            BTreeMap::from([("ownerId".to_owned(), ValueExpr::Literal(json!("alice")))]),
        )
        .expect_err("full destination refuses transfer");
        assert_eq!(transfer.diagnostic.code, "SNAPBACK_VECTOR_CORPUS_BOUND");
        assert_eq!(
            row_ids(
                &DbRead::Live(&database)
                    .vector_search(
                        &plan(),
                        &input(Some("bob"), fixture_vector(2, 1.0, 0.0), None)
                    )
                    .expect("failed transfer rolled source and index back")
            ),
            vec!["bob-row"]
        );

        patch(
            &mut database,
            "bob-row",
            BTreeMap::from([(
                "embedding".to_owned(),
                ValueExpr::Literal(json!([4.0, 0.0])),
            )]),
        )
        .expect("update maintained at head");
        let updated = DbRead::Live(&database)
            .vector_search(
                &plan(),
                &input(Some("bob"), fixture_vector(2, 0.0, 0.0), None),
            )
            .expect("updated vector query");
        assert_eq!(updated.rows[0]["distance"], json!(16.0));
        delete(&mut database, "bob-row").expect("delete maintained at head");
        let deleted = DbRead::Live(&database)
            .vector_search(
                &plan(),
                &input(Some("bob"), fixture_vector(2, 0.0, 0.0), None),
            )
            .expect("post-delete negative query");
        assert!(deleted.rows.is_empty());

        let mut maintenance_limited = vector_index(
            2,
            VectorMetricV1::L2sq,
            VectorVisibilityV1::PublicRead,
            VectorTieBreakV1::IdAsc,
            4,
        );
        maintenance_limited.maintenance_limits.vector_bytes = 1;
        let mut limited = seeded_database(maintenance_limited, Vec::new());
        let failure = limited
            .execute_mutation(
                &MutationPlan {
                    steps: vec![MutationStep::Insert {
                        table: "documents".to_owned(),
                        values: BTreeMap::from([
                            ("ownerId".to_owned(), ValueExpr::Literal(json!("alice"))),
                            ("title".to_owned(), ValueExpr::Literal(json!("rollback"))),
                            ("category".to_owned(), ValueExpr::Literal(json!("systems"))),
                            (
                                "embedding".to_owned(),
                                ValueExpr::Literal(json!([0.0, 0.0])),
                            ),
                        ]),
                        bind_id_as: None,
                    }],
                    return_value: None,
                },
                &HandlerInput::default(),
            )
            .expect_err("maintenance ceiling rolls source mutation back");
        assert_eq!(failure.diagnostic.code, "SNAPBACK_VECTOR_WORK_LIMIT");
        assert!(
            DbRead::Live(&limited)
                .vector_search(&plan(), &input(None, fixture_vector(2, 0.0, 0.0), None))
                .expect("empty index after maintenance rollback")
                .rows
                .is_empty()
        );
    }

    #[test]
    fn activation_preflight_classification_and_query_shape_refuse_stably() {
        let base = vector_index(
            2,
            VectorMetricV1::L2sq,
            VectorVisibilityV1::Owner {
                field: "ownerId".to_owned(),
            },
            VectorTieBreakV1::IdAsc,
            1,
        );
        for (field, classification) in [
            ("embedding", VectorFieldClassV1::Sensitive),
            ("category", VectorFieldClassV1::Forbidden),
            ("title", VectorFieldClassV1::Sensitive),
        ] {
            let mut invalid = base.clone();
            invalid
                .field_classifications
                .insert(field.to_owned(), classification);
            let error =
                validate_index_declaration(&schema_with(Some(invalid.clone())).tables[0], &invalid)
                    .expect_err("classification matrix violation");
            assert_eq!(error.diagnostic.code, "SNAPBACK_VECTOR_INDEX_UNAVAILABLE");
        }
        let mut public_private = base.clone();
        public_private.visibility = VectorVisibilityV1::PublicRead;
        let error = validate_index_declaration(
            &schema_with(Some(public_private.clone())).tables[0],
            &public_private,
        )
        .expect_err("public index refuses private fields");
        assert_eq!(error.diagnostic.code, "SNAPBACK_VECTOR_INDEX_UNAVAILABLE");

        let plain_schema = schema_with(None);
        let mut database = LocalDatabase::memory().expect("legacy database");
        database
            .apply_schema(plain_schema)
            .expect("install legacy table");
        database
            .reset_and_seed(Some(SeedData {
                tables: BTreeMap::from([(
                    "documents".to_owned(),
                    vec![
                        fixture_row(
                            "legacy-a",
                            "alice",
                            "A",
                            "systems",
                            fixture_vector(32, 0.0, 0.0),
                        ),
                        fixture_row(
                            "legacy-b",
                            "alice",
                            "B",
                            "systems",
                            fixture_vector(32, 1.0, 0.0),
                        ),
                    ],
                )]),
            }))
            .expect("seed legacy rows");
        let legacy_index = vector_index(
            32,
            VectorMetricV1::L2sq,
            VectorVisibilityV1::Owner {
                field: "ownerId".to_owned(),
            },
            VectorTieBreakV1::IdAsc,
            1,
        );
        let activation = database
            .apply_schema(schema_with(Some(legacy_index)))
            .expect_err("legacy partition over the declared bound");
        assert_eq!(activation.diagnostic.code, "SNAPBACK_VECTOR_CORPUS_BOUND");

        let indexed = seeded_database(
            base,
            vec![fixture_row(
                "only",
                "alice",
                "A",
                "systems",
                fixture_vector(2, 0.0, 0.0),
            )],
        );
        for invalid_args in [
            json!({"vector": [0.0]}),
            json!({"vector": [0.0, 0.0], "k": 65}),
            json!({"vector": [0.0, 0.0], "filters": [
                {"field": "category", "op": "eq", "value": "systems"},
                {"field": "category", "op": "eq", "value": "systems"}
            ]}),
        ] {
            let error = DbRead::Live(&indexed)
                .vector_search(
                    &plan(),
                    &HandlerInput {
                        args: invalid_args,
                        auth: AuthInput {
                            user_id: Some("alice".to_owned()),
                            ..AuthInput::default()
                        },
                        ..HandlerInput::default()
                    },
                )
                .expect_err("closed query grammar refusal");
            assert_eq!(error.diagnostic.code, "SNAPBACK_VECTOR_QUERY_INVALID");
        }
    }

    #[test]
    fn derived_state_tamper_is_quarantined_before_release() {
        let index = vector_index(
            2,
            VectorMetricV1::L2sq,
            VectorVisibilityV1::PublicRead,
            VectorTieBreakV1::IdAsc,
            4,
        );
        let mut connection = Connection::open_in_memory().expect("connection");
        connection
            .execute_batch(
                "CREATE TABLE documents(
                   _id TEXT PRIMARY KEY,
                   _version INTEGER NOT NULL,
                   _createdAt INTEGER NOT NULL,
                   _updatedAt INTEGER NOT NULL,
                   ownerId TEXT NOT NULL,
                   category TEXT NOT NULL,
                   title TEXT NOT NULL,
                   embedding BLOB NOT NULL
                 );
                 CREATE TABLE _snapback_version(id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
                 INSERT INTO _snapback_version(id,version) VALUES(1,1);",
            )
            .expect("source tables");
        create_infra(&connection).expect("vector infra");
        let schema = schema_with(Some(index));
        let vector = encode_vector(&[0.0, 0.0]);
        connection
            .execute(
                "INSERT INTO documents VALUES('row-a',1,0,0,'alice','systems','A',?1)",
                params![vector],
            )
            .expect("source row");
        let tx = connection.transaction().expect("activation transaction");
        activate_manifest_in_tx(&tx, &schema, 1).expect("activate generation");
        tx.commit().expect("commit activation");
        connection
            .execute(
                "UPDATE _snapback_vector_sources SET content_digest='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
                [],
            )
            .expect("tamper derived row");
        let error = query_vector_on(
            &connection,
            &schema,
            &plan(),
            &input(None, fixture_vector(2, 0.0, 0.0), None),
        )
        .expect_err("quarantined generation refuses before release");
        assert_eq!(error.diagnostic.code, "SNAPBACK_VECTOR_INDEX_CORRUPT");
    }

    // @ref LLP 0132#acceptance — preregistered realistic-scale release gate:
    // 1,536 dimensions fills the exact product-bound partition (43,690
    // vectors), measures build/update/query/RSS, and probes N+1 refusal.
    #[test]
    #[ignore = "release-scale gate; run explicitly on a qualified high-memory build host"]
    fn realistic_scale_1536_by_43690_meets_preregistered_budgets() {
        use std::time::Instant;

        const DIMENSIONS: u32 = 1_536;
        const VECTORS: u32 = 43_690;
        const BUILD_BUDGET_MS: u128 = 900_000;
        const UPDATE_BUDGET_MS: u128 = 60_000;
        const QUERY_BUDGET_MS: u128 = 120_000;
        const RSS_BUDGET_KIB: u64 = 16 * 1024 * 1024;
        assert_eq!(u64::from(DIMENSIONS) * u64::from(VECTORS), 67_107_840);
        assert_eq!(
            VECTORS,
            (VECTOR_MAX_SCALAR_PAIRS / u64::from(DIMENSIONS)) as u32
        );

        let directory = tempfile::tempdir().expect("scale database directory");
        let path = directory.path().join("vector-scale.sqlite3");
        let mut connection = Connection::open(&path).expect("scale connection");
        connection
            .execute_batch(
                "PRAGMA journal_mode=OFF;
                 PRAGMA synchronous=OFF;
                 PRAGMA temp_store=MEMORY;
                 CREATE TABLE documents(
                   _id TEXT PRIMARY KEY,
                   _version INTEGER NOT NULL,
                   _createdAt INTEGER NOT NULL,
                   _updatedAt INTEGER NOT NULL,
                   ownerId TEXT NOT NULL,
                   category TEXT NOT NULL,
                   title TEXT NOT NULL,
                   embedding BLOB NOT NULL
                 );
                 CREATE TABLE _snapback_version(id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
                 INSERT INTO _snapback_version(id,version) VALUES(1,1);",
            )
            .expect("scale source tables");
        create_infra(&connection).expect("scale vector infra");
        let index = vector_index(
            DIMENSIONS,
            VectorMetricV1::L2sq,
            VectorVisibilityV1::PublicRead,
            VectorTieBreakV1::IdAsc,
            VECTORS,
        );
        let schema = schema_with(Some(index));
        let vector = encode_vector(&vec![0.0; DIMENSIONS as usize]);
        let seed = connection.transaction().expect("scale seed transaction");
        {
            let mut insert = seed
                .prepare_cached(
                    "INSERT INTO documents
                     (_id,_version,_createdAt,_updatedAt,ownerId,category,title,embedding)
                     VALUES(?1,1,0,0,'public','systems','scale',?2)",
                )
                .expect("scale insert statement");
            for ordinal in 0..VECTORS {
                insert
                    .execute(params![format!("row-{ordinal:05}"), &vector])
                    .expect("fill scale partition");
            }
        }
        seed.commit().expect("commit scale source corpus");

        let build_started = Instant::now();
        let activation = connection.transaction().expect("scale activation");
        activate_manifest_in_tx(&activation, &schema, 1).expect("build filled generation");
        activation.commit().expect("commit filled generation");
        let build_ms = build_started.elapsed().as_millis();

        let update_row = json!({
            "_id": "row-00000",
            "_version": 2,
            "_createdAt": 0,
            "_updatedAt": 1,
            "ownerId": "public",
            "category": "systems",
            "title": "scale-updated",
            "embedding": vec![0.0; DIMENSIONS as usize],
        });
        let update_started = Instant::now();
        let update = connection.transaction().expect("scale update transaction");
        update
            .execute(
                "UPDATE documents SET _version=2,_updatedAt=1,title='scale-updated' WHERE _id='row-00000'",
                [],
            )
            .expect("update authoritative scale row");
        maintain_vector_indexes_in_tx(
            &update,
            &schema,
            &[ChangedRow {
                table: "documents".to_owned(),
                id: "row-00000".to_owned(),
                op: ChangeOp::Update,
                row: Some(update_row),
                changed_fields: vec!["title".to_owned()],
            }],
            2,
        )
        .expect("maintain scale update");
        update.commit().expect("commit scale update");
        let update_ms = update_started.elapsed().as_millis();

        let query_started = Instant::now();
        let (output, counters) = query_vector_with_facts(
            &connection,
            &schema,
            &plan(),
            &input(None, fixture_vector(DIMENSIONS, 0.0, 0.0), None),
        )
        .expect("query filled scale partition");
        let query_ms = query_started.elapsed().as_millis();
        assert_eq!(output.rows.len(), VECTOR_MAX_K as usize);
        assert_eq!(counters.postings_enumerated, u64::from(VECTORS));
        assert_eq!(counters.candidates_scored, u64::from(VECTORS));
        assert_eq!(counters.scalar_pairs, 67_107_840);
        assert_eq!(counters.source_reads, u64::from(VECTOR_MAX_K));

        let overflow = connection
            .transaction()
            .expect("scale overflow transaction");
        overflow
            .execute(
                "INSERT INTO documents
                 (_id,_version,_createdAt,_updatedAt,ownerId,category,title,embedding)
                 VALUES('row-overflow',3,0,0,'public','systems','overflow',?1)",
                params![&vector],
            )
            .expect("provisional overflow source row");
        let overflow_row = json!({
            "_id": "row-overflow",
            "_version": 3,
            "_createdAt": 0,
            "_updatedAt": 0,
            "ownerId": "public",
            "category": "systems",
            "title": "overflow",
            "embedding": vec![0.0; DIMENSIONS as usize],
        });
        let refusal = maintain_vector_indexes_in_tx(
            &overflow,
            &schema,
            &[ChangedRow {
                table: "documents".to_owned(),
                id: "row-overflow".to_owned(),
                op: ChangeOp::Insert,
                row: Some(overflow_row),
                changed_fields: Vec::new(),
            }],
            3,
        )
        .expect_err("N+1 vector refuses at the corpus boundary");
        assert_eq!(refusal.diagnostic.code, "SNAPBACK_VECTOR_CORPUS_BOUND");
        drop(overflow);
        let retained: u32 = connection
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .expect("retained source count");
        assert_eq!(retained, VECTORS);

        let rss_kib = resident_kib();
        let database_bytes = std::fs::metadata(&path).expect("scale db metadata").len();
        println!(
            "{}",
            serde_json::to_string(&json!({
                "artifactKind": "vectorRealisticScaleBudgetReceiptV1",
                "profile": VECTOR_DISTANCE_PROFILE,
                "dimensions": DIMENSIONS,
                "vectorCount": VECTORS,
                "vectorBytes": u64::from(DIMENSIONS) * u64::from(VECTORS) * 8,
                "scalarPairs": u64::from(DIMENSIONS) * u64::from(VECTORS),
                "databaseBytes": database_bytes,
                "buildMs": build_ms,
                "updateMs": update_ms,
                "queryMs": query_ms,
                "residentKiB": rss_kib,
                "budgets": {
                    "buildMs": BUILD_BUDGET_MS,
                    "updateMs": UPDATE_BUDGET_MS,
                    "queryMs": QUERY_BUDGET_MS,
                    "residentKiB": RSS_BUDGET_KIB,
                },
                "boundary": {
                    "filledAdmitted": true,
                    "nextRefusal": "SNAPBACK_VECTOR_CORPUS_BOUND",
                    "sourceRolledBack": true,
                },
            }))
            .expect("scale receipt serializes")
        );
        assert!(build_ms <= BUILD_BUDGET_MS, "scale build budget exceeded");
        assert!(
            update_ms <= UPDATE_BUDGET_MS,
            "scale update budget exceeded"
        );
        assert!(query_ms <= QUERY_BUDGET_MS, "scale query budget exceeded");
        assert!(
            rss_kib > 0 && rss_kib <= RSS_BUDGET_KIB,
            "scale RSS budget exceeded"
        );
    }

    #[test]
    fn declaration_refuses_dimension_corpus_product_over_ceiling() {
        let table = TableManifest {
            name: "items".to_owned(),
            fields: vec![crate::manifest::FieldManifest {
                name: "embedding".to_owned(),
                field_type: FieldType::Vector { dimensions: 4096 },
                optional: false,
            }],
            indexes: Vec::new(),
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            syncable: false,
            permission_backing: false,
            permission_fields: None,
            membership: None,
            asset_sharing: None,
        };
        let index = VectorIndexManifestV1 {
            format_version: 1,
            name: "by_embedding".to_owned(),
            semantic_version: "items.embedding.v1".to_owned(),
            vector_field: "embedding".to_owned(),
            dimensions: 4096,
            metric: VectorMetricV1::L2sq,
            distance_profile: VECTOR_DISTANCE_PROFILE.to_owned(),
            ordering_profile: VECTOR_ORDERING_PROFILE.to_owned(),
            field_classifications: BTreeMap::from([(
                "embedding".to_owned(),
                VectorFieldClassV1::Private,
            )]),
            equality_filters: Vec::new(),
            stored_fields: Vec::new(),
            visibility: VectorVisibilityV1::Owner {
                field: "ownerId".to_owned(),
            },
            tie_break: VectorTieBreakV1::IdAsc,
            max_indexed_vectors_per_partition: 65_536,
            maintenance_limits: VectorMaintenanceLimitsV1::default(),
        };
        let error = validate_index_declaration(&table, &index).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_VECTOR_INDEX_UNAVAILABLE");
    }
}
