use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{FieldType, HandlerInput, QueryOutput, SchemaManifest, TableManifest};
use crate::search::analyzer::analyze_field;
use crate::search::ast::{atom_tokens, canonicalize_query, clause_atom, query_core_hash};
use crate::search::highlight::highlights;
use crate::search::scorer::{atom_frequency, atom_score};
use crate::search::types::*;
use crate::storage::{ChangeOp, ChangedRow};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

fn diagnostic(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "search", message)
}

pub fn create_infra(conn: &Connection) -> SnapbackResult<()> {
    // @ref LLP 0073#index-maintenance — the canonical term/position/source
    // authority is ordinary transactional SQLite state, not native FTS.
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS _snapback_search_generations (
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          semantic_version TEXT NOT NULL,
          manifest_digest TEXT NOT NULL,
          generation INTEGER NOT NULL,
          status TEXT NOT NULL,
          source_head INTEGER NOT NULL,
          root_digest TEXT NOT NULL,
          receipt_json TEXT NOT NULL,
          corruption_reason TEXT,
          PRIMARY KEY(table_name, index_name, generation)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS _snapback_search_one_active_generation
          ON _snapback_search_generations(table_name, index_name)
          WHERE status = 'active';
        CREATE TABLE IF NOT EXISTS _snapback_search_sources (
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          generation INTEGER NOT NULL,
          row_id TEXT NOT NULL,
          source_version INTEGER NOT NULL,
          partition_key TEXT NOT NULL,
          row_json TEXT NOT NULL,
          filters_json TEXT NOT NULL,
          fields_json TEXT NOT NULL,
          tokens_json TEXT NOT NULL,
          tombstone INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(table_name, index_name, generation, row_id)
        );
        CREATE INDEX IF NOT EXISTS _snapback_search_sources_partition
          ON _snapback_search_sources(table_name, index_name, generation, partition_key, row_id);
        CREATE TABLE IF NOT EXISTS _snapback_search_terms (
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          generation INTEGER NOT NULL,
          partition_key TEXT NOT NULL,
          token TEXT NOT NULL,
          row_id TEXT NOT NULL,
          field_name TEXT NOT NULL,
          position INTEGER NOT NULL,
          source_start INTEGER NOT NULL,
          source_end INTEGER NOT NULL,
          source_version INTEGER NOT NULL,
          PRIMARY KEY(table_name, index_name, generation, row_id, field_name, position)
        );
        CREATE INDEX IF NOT EXISTS _snapback_search_terms_anchor
          ON _snapback_search_terms(table_name, index_name, generation, partition_key, token, row_id);
        CREATE TABLE IF NOT EXISTS _snapback_search_frontiers (
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          generation INTEGER NOT NULL,
          source_id TEXT NOT NULL,
          highest_version INTEGER NOT NULL,
          tombstone INTEGER NOT NULL,
          PRIMARY KEY(table_name, index_name, generation, source_id)
        );
        CREATE TABLE IF NOT EXISTS _snapback_search_builds (
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          generation INTEGER NOT NULL,
          snapshot_head INTEGER NOT NULL,
          candidate_head INTEGER NOT NULL,
          cursor TEXT,
          status TEXT NOT NULL,
          root_digest TEXT,
          PRIMARY KEY(table_name, index_name, generation)
        );
        CREATE TABLE IF NOT EXISTS _snapback_search_journal_leases (
          table_name TEXT NOT NULL,
          index_name TEXT NOT NULL,
          generation INTEGER NOT NULL,
          floor_version INTEGER NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          PRIMARY KEY(table_name, index_name, generation)
        );
        ",
    )?;
    let has_manifest_digest = conn
        .prepare("PRAGMA table_info(_snapback_search_generations)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(Result::ok)
        .any(|column| column == "manifest_digest");
    if !has_manifest_digest {
        conn.execute(
            "ALTER TABLE _snapback_search_generations
             ADD COLUMN manifest_digest TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    Ok(())
}

fn search_index<'a>(
    schema: &'a SchemaManifest,
    table: &str,
    index: &str,
) -> SnapbackResult<(&'a TableManifest, &'a SearchIndexManifestV1)> {
    let table = schema.table(table).ok_or_else(|| {
        diagnostic(
            "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
            "search table is not installed",
        )
    })?;
    let index = table
        .search_indexes
        .iter()
        .find(|candidate| candidate.name == index)
        .ok_or_else(|| {
            diagnostic(
                "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
                "search index is not installed",
            )
        })?;
    Ok((table, index))
}

fn active_generation(
    conn: &Connection,
    table: &str,
    index: &str,
) -> SnapbackResult<(u64, String, String)> {
    conn.query_row(
        "SELECT generation, semantic_version, manifest_digest
         FROM _snapback_search_generations
         WHERE table_name = ?1 AND index_name = ?2 AND status = 'active'",
        params![table, index],
        |row| Ok((row.get::<_, i64>(0)? as u64, row.get(1)?, row.get(2)?)),
    )
    .optional()?
    .ok_or_else(|| {
        diagnostic(
            "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
            format!("search index {table}.{index} has no active generation"),
        )
    })
}

fn manifest_digest(index: &SearchIndexManifestV1) -> SnapbackResult<String> {
    let value = serde_json::to_value(index).map_err(|_| {
        diagnostic(
            "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
            "search index manifest does not serialize",
        )
    })?;
    crate::rqs::sha256_identity(&value).map_err(|_| {
        diagnostic(
            "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
            "search index manifest is not canonicalizable",
        )
    })
}

fn partition_for(index: &SearchIndexManifestV1, row: &Value) -> SnapbackResult<String> {
    match &index.visibility {
        SearchVisibilityV1::PublicRead => Ok("public".to_owned()),
        SearchVisibilityV1::Owner { field } => row
            .get(field)
            .and_then(Value::as_str)
            .map(|value| format!("owner:{value}"))
            .ok_or_else(|| {
                diagnostic(
                    "SNAPBACK_SEARCH_MAINTENANCE_FAILED",
                    format!("owner search source is missing string field {field}"),
                )
            }),
    }
}

fn source_tokens(
    index: &SearchIndexManifestV1,
    row: &Value,
) -> SnapbackResult<(
    Vec<SearchToken>,
    BTreeMap<String, String>,
    Map<String, Value>,
)> {
    let mut tokens = Vec::new();
    let mut source_fields = BTreeMap::new();
    let mut stored = Map::new();
    let mut bytes = 0_usize;
    for field in index.text_fields.keys() {
        let value = row.get(field).and_then(Value::as_str).unwrap_or("");
        bytes = bytes.saturating_add(value.len());
        source_fields.insert(field.clone(), value.to_owned());
        tokens.extend(analyze_field(field, value)?);
    }
    if bytes > index.source_limits.max_indexed_bytes as usize
        || tokens.len() > index.source_limits.max_tokens as usize
        || tokens.len() > index.source_limits.max_posting_operations as usize
    {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_SOURCE_LIMIT",
            "search source exceeds its declared byte/token/posting bound",
        ));
    }
    for field in &index.stored_fields {
        stored.insert(
            field.clone(),
            row.get(field).cloned().unwrap_or(Value::Null),
        );
    }
    Ok((tokens, source_fields, stored))
}

fn replace_source(
    tx: &Transaction<'_>,
    table: &str,
    index: &SearchIndexManifestV1,
    generation: u64,
    row_id: &str,
    source_version: u64,
    row: Option<&Value>,
    counters: &mut MaintenanceCounters,
) -> SnapbackResult<()> {
    let old_postings: usize = tx.query_row(
        "SELECT COUNT(*) FROM _snapback_search_terms
         WHERE table_name = ?1 AND index_name = ?2 AND generation = ?3 AND row_id = ?4",
        params![table, index.name, generation as i64, row_id],
        |row| row.get::<_, i64>(0).map(|value| value as usize),
    )?;
    counters.posting_ops = counters.posting_ops.saturating_add(old_postings);
    tx.execute(
        "DELETE FROM _snapback_search_terms
         WHERE table_name = ?1 AND index_name = ?2 AND generation = ?3 AND row_id = ?4",
        params![table, index.name, generation as i64, row_id],
    )?;
    tx.execute(
        "DELETE FROM _snapback_search_sources
         WHERE table_name = ?1 AND index_name = ?2 AND generation = ?3 AND row_id = ?4",
        params![table, index.name, generation as i64, row_id],
    )?;
    counters.effects = counters.effects.saturating_add(1);
    match row {
        None => {
            tx.execute(
                "INSERT INTO _snapback_search_frontiers
                 (table_name,index_name,generation,source_id,highest_version,tombstone)
                 VALUES (?1,?2,?3,?4,?5,1)
                 ON CONFLICT(table_name,index_name,generation,source_id)
                 DO UPDATE SET highest_version=excluded.highest_version,tombstone=1
                 WHERE excluded.highest_version >= highest_version",
                params![
                    table,
                    index.name,
                    generation as i64,
                    row_id,
                    source_version as i64
                ],
            )?;
        }
        Some(row) => {
            let partition = partition_for(index, row)?;
            let (tokens, source_fields, stored) = source_tokens(index, row)?;
            counters.positions = counters.positions.saturating_add(tokens.len());
            counters.posting_ops = counters.posting_ops.saturating_add(tokens.len());
            let token_json = serde_json::to_string(
                &tokens
                    .iter()
                    .map(|token| {
                        json!({
                            "field": token.field,
                            "token": token.token,
                            "position": token.position,
                            "sourceStart": token.source_start,
                            "sourceEnd": token.source_end,
                        })
                    })
                    .collect::<Vec<_>>(),
            )
            .map_err(|_| {
                diagnostic(
                    "SNAPBACK_SEARCH_MAINTENANCE_FAILED",
                    "tokens do not serialize",
                )
            })?;
            let fields_json = serde_json::to_string(&source_fields).map_err(|_| {
                diagnostic(
                    "SNAPBACK_SEARCH_MAINTENANCE_FAILED",
                    "fields do not serialize",
                )
            })?;
            let filters = index
                .equality_filters
                .iter()
                .map(|field| {
                    (
                        field.clone(),
                        row.get(field).cloned().unwrap_or(Value::Null),
                    )
                })
                .collect::<Map<_, _>>();
            let filters_json = serde_json::to_string(&filters).map_err(|_| {
                diagnostic(
                    "SNAPBACK_SEARCH_MAINTENANCE_FAILED",
                    "filters do not serialize",
                )
            })?;
            let row_json = serde_json::to_string(&stored).map_err(|_| {
                diagnostic(
                    "SNAPBACK_SEARCH_MAINTENANCE_FAILED",
                    "stored fields do not serialize",
                )
            })?;
            counters.bytes = counters.bytes.saturating_add(
                token_json.len() + fields_json.len() + filters_json.len() + row_json.len(),
            );
            tx.execute(
                "INSERT INTO _snapback_search_sources
                 (table_name,index_name,generation,row_id,source_version,partition_key,row_json,filters_json,fields_json,tokens_json,tombstone)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,0)",
                params![table, index.name, generation as i64, row_id, source_version as i64, partition, row_json, filters_json, fields_json, token_json],
            )?;
            for token in &tokens {
                tx.execute(
                    "INSERT INTO _snapback_search_terms
                     (table_name,index_name,generation,partition_key,token,row_id,field_name,position,source_start,source_end,source_version)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![
                        table,
                        index.name,
                        generation as i64,
                        partition,
                        token.token,
                        row_id,
                        token.field,
                        token.position as i64,
                        token.source_start as i64,
                        token.source_end as i64,
                        source_version as i64,
                    ],
                )?;
            }
            tx.execute(
                "INSERT INTO _snapback_search_frontiers
                 (table_name,index_name,generation,source_id,highest_version,tombstone)
                 VALUES (?1,?2,?3,?4,?5,0)
                 ON CONFLICT(table_name,index_name,generation,source_id)
                 DO UPDATE SET highest_version=excluded.highest_version,tombstone=0
                 WHERE excluded.highest_version >= highest_version",
                params![
                    table,
                    index.name,
                    generation as i64,
                    row_id,
                    source_version as i64
                ],
            )?;
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Default)]
struct MaintenanceCounters {
    effects: usize,
    posting_ops: usize,
    positions: usize,
    bytes: usize,
}

impl MaintenanceCounters {
    fn delta_from(self, before: Self) -> Self {
        Self {
            effects: self.effects.saturating_sub(before.effects),
            posting_ops: self.posting_ops.saturating_sub(before.posting_ops),
            positions: self.positions.saturating_sub(before.positions),
            bytes: self.bytes.saturating_sub(before.bytes),
        }
    }

    fn add(&mut self, value: Self) {
        self.effects = self.effects.saturating_add(value.effects);
        self.posting_ops = self.posting_ops.saturating_add(value.posting_ops);
        self.positions = self.positions.saturating_add(value.positions);
        self.bytes = self.bytes.saturating_add(value.bytes);
    }

    fn enforce_global(&self) -> SnapbackResult<()> {
        if self.effects > SEARCH_MAX_MAINTENANCE_EFFECTS
            || self.posting_ops > SEARCH_MAX_POSTING_OPS
            || self.positions > SEARCH_MAX_POSITIONS
            || self.bytes > SEARCH_MAX_BYTES_PER_COMMIT
        {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_MAINTENANCE_LIMIT",
                "aggregate search maintenance exceeds the global transaction ceiling",
            ));
        }
        Ok(())
    }

    fn enforce_index(&self, limits: &SearchMaintenanceLimitsV1) -> SnapbackResult<()> {
        if self.effects > limits.search_maintenance_effects as usize
            || self.posting_ops > limits.search_posting_ops as usize
            || self.positions > limits.search_positions as usize
            || self.bytes > limits.search_bytes as usize
        {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_MAINTENANCE_LIMIT",
                "search maintenance exceeds the declared per-index transaction ceiling",
            ));
        }
        Ok(())
    }
}

pub fn maintain_search_indexes_in_tx(
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
        for index in &table.search_indexes {
            let (generation, semantic, digest) = active_generation(tx, &table.name, &index.name)?;
            if semantic != index.semantic_version || digest != manifest_digest(index)? {
                return Err(diagnostic(
                    "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
                    "active search generation has the wrong semantic version",
                ));
            }
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
            index_counters.enforce_index(&index.maintenance_limits)?;
            counters.enforce_global()?;
        }
    }
    counters.enforce_global()
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
        let id = value
            .get("_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let version = value.get("_version").and_then(Value::as_u64).unwrap_or(0);
        out.push((id, version, value));
    }
    Ok(out)
}

fn validate_index_declaration(
    table: &TableManifest,
    index: &SearchIndexManifestV1,
) -> SnapbackResult<()> {
    let invalid = || {
        diagnostic(
            "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
            format!(
                "search index {}.{} does not match the experimental v1 profile",
                table.name, index.name
            ),
        )
    };
    if index.analyzer != SEARCH_ANALYZER
        || index.analyzer_tables_digest
            != crate::search::unicode17_generated::ANALYZER_TABLES_DIGEST
        || index.tie_break != "score-desc-row-id-asc.v1"
        || index.text_fields.is_empty()
        || index.text_fields.len() > 16
        || index.text_fields.values().any(|field| {
            field.weight == 0
                || field.weight > 64
                || matches!(
                    field.classification,
                    SearchFieldClassV1::Sensitive | SearchFieldClassV1::Forbidden
                )
        })
    {
        return Err(invalid());
    }

    let source_fields = table
        .fields
        .iter()
        .map(|field| (field.name.as_str(), field))
        .collect::<BTreeMap<_, _>>();
    if index.text_fields.keys().any(|field| {
        !source_fields
            .get(field.as_str())
            .is_some_and(|source| source.field_type == FieldType::String)
    }) {
        return Err(invalid());
    }
    let equality = index.equality_filters.iter().collect::<BTreeSet<_>>();
    let stored = index.stored_fields.iter().collect::<BTreeSet<_>>();
    let highlights = index.highlight_fields.iter().collect::<BTreeSet<_>>();
    if equality.len() != index.equality_filters.len()
        || stored.len() != index.stored_fields.len()
        || highlights.len() != index.highlight_fields.len()
        || highlights
            .iter()
            .any(|field| !index.text_fields.contains_key(field.as_str()))
    {
        return Err(invalid());
    }

    let mut participating_non_text = equality
        .into_iter()
        .chain(stored)
        .map(ToOwned::to_owned)
        .collect::<BTreeSet<String>>();
    if let SearchVisibilityV1::Owner { field } = &index.visibility {
        let owner = source_fields.get(field.as_str()).ok_or_else(invalid)?;
        if owner.optional || !matches!(owner.field_type, FieldType::String | FieldType::Principal) {
            return Err(invalid());
        }
        participating_non_text.insert(field.clone());
    }
    for field in index.text_fields.keys() {
        participating_non_text.remove(field);
    }
    let declared = index
        .field_classifications
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    if declared != participating_non_text
        || participating_non_text
            .iter()
            .any(|field| !source_fields.contains_key(field.as_str()))
        || index.field_classifications.values().any(|classification| {
            matches!(
                classification,
                SearchFieldClassV1::Sensitive | SearchFieldClassV1::Forbidden
            )
        })
    {
        return Err(invalid());
    }
    if matches!(index.visibility, SearchVisibilityV1::PublicRead)
        && (index
            .text_fields
            .values()
            .any(|field| field.classification != SearchFieldClassV1::Public)
            || index
                .field_classifications
                .values()
                .any(|classification| *classification != SearchFieldClassV1::Public))
    {
        return Err(invalid());
    }
    Ok(())
}

/// Build/activate a verified physical generation in the schema transaction.
/// The local implementation uses the writer reservation as the bounded switch
/// fence; future background catch-up uses the persisted build/lease rows.
pub fn activate_manifest_in_tx(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    source_head: u64,
) -> SnapbackResult<()> {
    for table in &schema.tables {
        for index in &table.search_indexes {
            validate_index_declaration(table, index)?;
            let index_manifest_digest = manifest_digest(index)?;
            let existing: Option<(u64, String, String)> = tx
                .query_row(
                    "SELECT generation, semantic_version, manifest_digest
                     FROM _snapback_search_generations
                     WHERE table_name=?1 AND index_name=?2 AND status='active'",
                    params![table.name, index.name],
                    |row| Ok((row.get::<_, i64>(0)? as u64, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            if existing
                .as_ref()
                .is_some_and(|(_, semantic, current_digest)| {
                    semantic == &index.semantic_version && current_digest == &index_manifest_digest
                })
            {
                continue;
            }
            let generation: u64 = tx.query_row(
                "SELECT COALESCE(MAX(generation),0)+1 FROM _snapback_search_generations
                 WHERE table_name=?1 AND index_name=?2",
                params![table.name, index.name],
                |row| row.get::<_, i64>(0).map(|value| value as u64),
            )?;
            tx.execute(
                "INSERT INTO _snapback_search_builds
                 (table_name,index_name,generation,snapshot_head,candidate_head,status)
                 VALUES (?1,?2,?3,?4,?4,'building')",
                params![
                    table.name,
                    index.name,
                    generation as i64,
                    source_head as i64
                ],
            )?;
            crate::search::rebuild::record_journal_lease(
                tx,
                &table.name,
                &index.name,
                generation,
                source_head,
                u64::MAX,
            )?;
            let rows = scan_table_rows(tx, table)?;
            let mut counters = MaintenanceCounters::default();
            let mut digest = Sha256::new();
            for (id, version, row) in &rows {
                replace_source(
                    tx,
                    &table.name,
                    index,
                    generation,
                    id,
                    *version,
                    Some(row),
                    &mut counters,
                )?;
                digest.update((id.len() as u32).to_be_bytes());
                digest.update(id.as_bytes());
                digest.update(version.to_be_bytes());
            }
            counters.enforce_global()?;
            let root_digest = format!("sha256:{:x}", digest.finalize());
            let receipt = crate::search::rebuild::SearchRebuildReceiptV1 {
                executor: "derived-search-catchup.v1".to_owned(),
                table: table.name.clone(),
                index: index.name.clone(),
                generation,
                source_head,
                root_digest: root_digest.clone(),
                row_count: rows.len() as u64,
                activated: true,
            };
            tx.execute(
                "UPDATE _snapback_search_generations
                 SET status='retired'
                 WHERE table_name=?1 AND index_name=?2 AND status='active'",
                params![table.name, index.name],
            )?;
            tx.execute(
                "INSERT INTO _snapback_search_generations
                 (table_name,index_name,semantic_version,manifest_digest,generation,status,source_head,root_digest,receipt_json)
                 VALUES (?1,?2,?3,?4,?5,'active',?6,?7,?8)",
                params![
                    table.name,
                    index.name,
                    index.semantic_version,
                    index_manifest_digest,
                    generation as i64,
                    source_head as i64,
                    root_digest,
                    serde_json::to_string(&receipt).unwrap_or_default()
                ],
            )?;
            tx.execute(
                "UPDATE _snapback_search_builds
                 SET status='activated',root_digest=?4
                 WHERE table_name=?1 AND index_name=?2 AND generation=?3",
                params![
                    table.name,
                    index.name,
                    generation as i64,
                    receipt.root_digest
                ],
            )?;
            tx.execute(
                "DELETE FROM _snapback_search_journal_leases
                 WHERE table_name=?1 AND index_name=?2 AND generation=?3",
                params![table.name, index.name, generation as i64],
            )?;
            // Retired generations remain as compact receipt/tombstone rows so
            // generation numbers are never reused, while their derived
            // postings/sources/frontiers/build work are reclaimed atomically
            // with the switch. A reader already pinned before this commit
            // continues to see the old WAL snapshot.
            for relation in [
                "_snapback_search_terms",
                "_snapback_search_sources",
                "_snapback_search_frontiers",
                "_snapback_search_builds",
            ] {
                tx.execute(
                    &format!(
                        "DELETE FROM {relation}
                         WHERE table_name=?1 AND index_name=?2 AND generation<>?3"
                    ),
                    params![table.name, index.name, generation as i64],
                )?;
            }
        }
    }
    Ok(())
}

#[derive(Clone)]
struct IndexedSource {
    row_id: String,
    source_version: u64,
    partition: String,
    stored: Map<String, Value>,
    filters: Map<String, Value>,
    source_fields: BTreeMap<String, String>,
    tokens: Vec<SearchToken>,
}

fn decode_source(row: &rusqlite::Row<'_>) -> rusqlite::Result<IndexedSource> {
    let tokens: Vec<Value> = serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or_default();
    Ok(IndexedSource {
        row_id: row.get(0)?,
        source_version: row.get::<_, i64>(1)? as u64,
        partition: row.get(2)?,
        stored: serde_json::from_str(&row.get::<_, String>(3)?).unwrap_or_default(),
        filters: serde_json::from_str(&row.get::<_, String>(4)?).unwrap_or_default(),
        source_fields: serde_json::from_str(&row.get::<_, String>(5)?).unwrap_or_default(),
        tokens: tokens
            .into_iter()
            .filter_map(|token| {
                Some(SearchToken {
                    field: token.get("field")?.as_str()?.to_owned(),
                    token: token.get("token")?.as_str()?.to_owned(),
                    position: token.get("position")?.as_u64()? as u32,
                    source_start: token.get("sourceStart")?.as_u64()? as u32,
                    source_end: token.get("sourceEnd")?.as_u64()? as u32,
                })
            })
            .collect(),
    })
}

fn atom_matches<'a>(
    atom: &SearchMatchAtomV1,
    terms: &[String],
    source: &'a IndexedSource,
) -> (bool, Vec<&'a SearchToken>) {
    let field = match atom {
        SearchMatchAtomV1::Term(value) | SearchMatchAtomV1::Prefix(value) => value.field.as_deref(),
        SearchMatchAtomV1::Phrase(value) => value.field.as_deref(),
    };
    let field_tokens = source
        .tokens
        .iter()
        .filter(|token| field.is_none_or(|field| token.field == field))
        .collect::<Vec<_>>();
    let frequency = atom_frequency(atom, terms, &field_tokens);
    let occurrences = match atom {
        SearchMatchAtomV1::Term(_) => field_tokens
            .into_iter()
            .filter(|token| token.token == terms[0])
            .collect(),
        SearchMatchAtomV1::Prefix(_) => field_tokens
            .into_iter()
            .filter(|token| token.token.starts_with(&terms[0]))
            .collect(),
        SearchMatchAtomV1::Phrase(_) => field_tokens
            .windows(terms.len())
            .filter(|window| {
                window
                    .iter()
                    .zip(terms)
                    .enumerate()
                    .all(|(index, (token, term))| {
                        token.token == *term
                            && (index == 0 || token.position == window[index - 1].position + 1)
                    })
            })
            .flat_map(|window| window.iter().copied())
            .collect(),
    };
    (frequency > 0, occurrences)
}

pub struct SearchExecutionAuthority<'a> {
    pub app_id: &'a str,
    pub database_id: &'a str,
    pub target_profile_id: &'a str,
    pub stream_epoch: &'a str,
    pub authority_instance: &'a str,
    pub owner_subject: Option<&'a str>,
    pub release_policy_digest: &'a str,
    pub now_ms: u64,
    pub cursor_roots: &'a [(String, [u8; 32])],
}

fn cursor_restart() -> SnapbackError {
    diagnostic(
        "SNAPBACK_SEARCH_CURSOR_RESTART",
        "search cursor is not valid for this query and caller; restart from the first page",
    )
}

fn posting_candidates_for_atom(
    conn: &Connection,
    table: &str,
    index: &SearchIndexManifestV1,
    generation: u64,
    partition: &str,
    atom: &SearchMatchAtomV1,
) -> SnapbackResult<BTreeSet<String>> {
    let terms = atom_tokens(atom)?;
    let anchor = terms.first().ok_or_else(|| {
        diagnostic(
            "SNAPBACK_SEARCH_QUERY_INVALID",
            "search match atom has no positive posting anchor",
        )
    })?;
    let field = match atom {
        SearchMatchAtomV1::Term(value) | SearchMatchAtomV1::Prefix(value) => value.field.as_deref(),
        SearchMatchAtomV1::Phrase(value) => value.field.as_deref(),
    };
    let prefix = matches!(atom, SearchMatchAtomV1::Prefix(_));
    if prefix {
        let term_count: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT token)
             FROM _snapback_search_terms
             WHERE table_name=?1 AND index_name=?2 AND generation=?3
               AND partition_key=?4 AND substr(token,1,length(?5))=?5
               AND (?6 IS NULL OR field_name=?6)",
            params![
                table,
                index.name,
                generation as i64,
                partition,
                anchor,
                field,
            ],
            |row| row.get(0),
        )?;
        if term_count > index.query_limits.max_prefix_terms as i64 {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_WORK_LIMIT",
                "search prefix vocabulary exceeds the declared partition-local ceiling",
            ));
        }
    }
    let sql = if prefix {
        "SELECT DISTINCT row_id
         FROM _snapback_search_terms
         WHERE table_name=?1 AND index_name=?2 AND generation=?3
           AND partition_key=?4 AND substr(token,1,length(?5))=?5
           AND (?6 IS NULL OR field_name=?6)
         ORDER BY row_id"
    } else {
        "SELECT DISTINCT row_id
         FROM _snapback_search_terms
         WHERE table_name=?1 AND index_name=?2 AND generation=?3
           AND partition_key=?4 AND token=?5
           AND (?6 IS NULL OR field_name=?6)
         ORDER BY row_id"
    };
    let mut statement = conn.prepare(sql)?;
    let mut rows = statement.query(params![
        table,
        index.name,
        generation as i64,
        partition,
        anchor,
        field,
    ])?;
    let mut candidates = BTreeSet::new();
    while let Some(row) = rows.next()? {
        candidates.insert(row.get(0)?);
        if candidates.len() > index.query_limits.max_candidate_work as usize {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_WORK_LIMIT",
                "search posting anchor exceeds the declared exact-ranking ceiling",
            ));
        }
    }
    Ok(candidates)
}

fn posting_candidates(
    conn: &Connection,
    table: &str,
    index: &SearchIndexManifestV1,
    generation: u64,
    partition: &str,
    query: &SearchQueryAstV1,
) -> SnapbackResult<BTreeSet<String>> {
    // A direct positive is conjunctive, so any one is a complete candidate
    // superset. Without one, the sole flat `any` is the positive anchor and
    // its member posting sets are unioned.
    if let Some(atom) = query.all.iter().find_map(clause_atom) {
        return posting_candidates_for_atom(conn, table, index, generation, partition, &atom);
    }
    let atoms = query
        .all
        .iter()
        .find_map(|clause| match clause {
            SearchClauseV1::Any(atoms) => Some(atoms),
            _ => None,
        })
        .ok_or_else(|| {
            diagnostic(
                "SNAPBACK_SEARCH_QUERY_INVALID",
                "search query has no positive posting anchor",
            )
        })?;
    let mut candidates = BTreeSet::new();
    for atom in atoms {
        candidates.extend(posting_candidates_for_atom(
            conn, table, index, generation, partition, atom,
        )?);
        if candidates.len() > index.query_limits.max_candidate_work as usize {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_WORK_LIMIT",
                "search any-clause anchors exceed the declared exact-ranking ceiling",
            ));
        }
    }
    Ok(candidates)
}

fn validate_filter_values(table: &TableManifest, query: &SearchQueryAstV1) -> SnapbackResult<()> {
    for filter in query.all.iter().filter_map(|clause| match clause {
        SearchClauseV1::Filter(filter) => Some(filter),
        _ => None,
    }) {
        let declared = table.field(&filter.field).ok_or_else(|| {
            diagnostic(
                "SNAPBACK_SEARCH_QUERY_INVALID",
                "search filter references an unknown source field",
            )
        })?;
        let valid = match &declared.field_type {
            FieldType::String | FieldType::Principal | FieldType::Id { .. } => {
                filter.value.is_string()
            }
            FieldType::Boolean => filter.value.is_boolean(),
            FieldType::Integer => filter.value.as_i64().is_some(),
            _ => false,
        };
        if !valid {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_QUERY_INVALID",
                format!(
                    "search equality filter {} has the wrong portable scalar type",
                    filter.field
                ),
            ));
        }
    }
    Ok(())
}

pub fn query_search_on(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &SearchQueryPlanV1,
    input: &HandlerInput,
    authority: &SearchExecutionAuthority<'_>,
) -> SnapbackResult<QueryOutput> {
    let (table, index) = search_index(schema, &plan.table, &plan.index)?;
    if plan.parser != SEARCH_PARSER
        || plan.required_capability != SEARCH_CAPABILITY
        || plan.result_projection != "search-page-v1"
    {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
            "search query plan names an unsupported semantic profile",
        ));
    }
    let request: SearchRequestV1 = serde_json::from_value(input.args.clone()).map_err(|_| {
        diagnostic(
            "SNAPBACK_SEARCH_QUERY_INVALID",
            "search arguments must be {query, limit?, after?}",
        )
    })?;
    let limit = request.limit.unwrap_or(20);
    if !(1..=SEARCH_MAX_LIMIT).contains(&limit) {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_QUERY_INVALID",
            "search limit must be in 1..50",
        ));
    }
    let query = canonicalize_query(index, request.query)?;
    validate_filter_values(table, &query)?;
    let query_hash = query_core_hash(&query)?;
    let (generation, semantic_version, digest) = active_generation(conn, &table.name, &index.name)?;
    if digest != manifest_digest(index)? {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
            "active search generation has the wrong manifest digest",
        ));
    }
    let partition = match &index.visibility {
        SearchVisibilityV1::PublicRead => "public".to_owned(),
        SearchVisibilityV1::Owner { .. } => authority
            .owner_subject
            .map(|subject| format!("owner:{subject}"))
            .ok_or_else(|| {
                diagnostic(
                    "SNAPBACK_SEARCH_QUERY_INVALID",
                    "owner search requires a canonical effective-user subject",
                )
            })?,
    };
    let after = request
        .after
        .as_deref()
        .map(|wire| {
            let body = crate::search::cursor::decode(
                wire,
                authority.cursor_roots,
                authority.app_id,
                authority.target_profile_id,
                authority.now_ms,
            )
            .map_err(|_| cursor_restart())?;
            if body.database_id != authority.database_id
                || body.stream_epoch != authority.stream_epoch
                || body.semantic_version != semantic_version
                || body.physical_generation != generation
                || body.query_core_hash != query_hash
                || body.limit != limit
                || body.authority_instance != authority.authority_instance
                || body.owner_subject.as_deref() != authority.owner_subject
                || body.release_policy_digest != authority.release_policy_digest
                || body.row_id_direction != "asc"
            {
                return Err(cursor_restart());
            }
            Ok((body.score, body.row_id))
        })
        .transpose()?;

    let candidate_ids =
        posting_candidates(conn, &table.name, index, generation, &partition, &query)?;
    let mut statement = conn.prepare(
        "SELECT row_id,source_version,partition_key,row_json,filters_json,fields_json,
                tombstone,tokens_json
         FROM _snapback_search_sources
         WHERE table_name=?1 AND index_name=?2 AND generation=?3
           AND partition_key=?4 AND row_id=?5",
    )?;
    let mut sources = Vec::new();
    for row_id in candidate_ids {
        let source = statement
            .query_row(
                params![table.name, index.name, generation as i64, partition, row_id],
                decode_source,
            )
            .optional()?
            .ok_or_else(|| {
                diagnostic(
                    "SNAPBACK_SEARCH_INDEX_CORRUPT",
                    "search posting references a missing source record",
                )
            })?;
        sources.push(source);
    }

    let mut ranked = Vec::<(u32, IndexedSource, Vec<SearchToken>)>::new();
    for source in sources {
        if source.partition != partition {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_INDEX_CORRUPT",
                "search source partition disagrees with its access key",
            ));
        }
        let filters_match = query.all.iter().all(|clause| match clause {
            SearchClauseV1::Filter(filter) => {
                source.filters.get(&filter.field) == Some(&filter.value)
            }
            _ => true,
        });
        if !filters_match {
            continue;
        }
        let mut score = 0_u32;
        let mut matched_tokens = Vec::<SearchToken>::new();
        let mut required_match = true;
        for clause in &query.all {
            if let Some(atom) = clause_atom(clause) {
                let terms = atom_tokens(&atom)?;
                let (matches, occurrences) = atom_matches(&atom, &terms, &source);
                required_match &= matches;
                if matches {
                    score = score
                        .checked_add(atom_score(index, &atom, &terms, &source.tokens))
                        .ok_or_else(|| {
                            diagnostic("SNAPBACK_SEARCH_INDEX_CORRUPT", "score overflow")
                        })?;
                    matched_tokens.extend(occurrences.into_iter().cloned());
                }
            } else if let SearchClauseV1::Any(atoms) = clause {
                let mut any_match = false;
                for atom in atoms {
                    let terms = atom_tokens(atom)?;
                    let (matches, occurrences) = atom_matches(atom, &terms, &source);
                    if matches {
                        any_match = true;
                        score = score
                            .checked_add(atom_score(index, atom, &terms, &source.tokens))
                            .ok_or_else(|| {
                                diagnostic("SNAPBACK_SEARCH_INDEX_CORRUPT", "score overflow")
                            })?;
                        matched_tokens.extend(occurrences.into_iter().cloned());
                    }
                }
                required_match &= any_match;
            } else if let SearchClauseV1::Not(atom) = clause {
                let terms = atom_tokens(atom)?;
                required_match &= !atom_matches(atom, &terms, &source).0;
            }
        }
        if required_match {
            ranked.push((score, source, matched_tokens));
        }
    }
    ranked.sort_by(|(score_a, source_a, _), (score_b, source_b, _)| {
        score_b
            .cmp(score_a)
            .then(source_a.row_id.as_bytes().cmp(source_b.row_id.as_bytes()))
    });
    if let Some((score, row_id)) = &after {
        ranked.retain(|(candidate_score, source, _)| {
            candidate_score < score
                || (candidate_score == score && source.row_id.as_bytes() > row_id.as_bytes())
        });
    }
    let has_more = ranked.len() > limit as usize;
    ranked.truncate(limit as usize);
    let mut items = Vec::new();
    for (score, source, matched_tokens) in &ranked {
        // Current authoritative source version/owner recheck in this pinned
        // snapshot. A mismatch is drift: no partial page is released.
        let quoted = crate::storage::quote_ident(&table.name)?;
        let current: Option<(u64, Option<String>)> = conn
            .query_row(
                &format!(
                    "SELECT \"_version\", {} FROM {quoted} WHERE \"_id\"=?1",
                    match &index.visibility {
                        SearchVisibilityV1::Owner { field } => crate::storage::quote_ident(field)?,
                        SearchVisibilityV1::PublicRead => "NULL".to_owned(),
                    }
                ),
                params![source.row_id],
                |row| Ok((row.get::<_, i64>(0)? as u64, row.get(1)?)),
            )
            .optional()?;
        let current_partition = current
            .as_ref()
            .and_then(|(_, owner)| owner.as_ref())
            .map(|owner| format!("owner:{owner}"));
        if current.as_ref().map(|(version, _)| *version) != Some(source.source_version)
            || matches!(&index.visibility, SearchVisibilityV1::Owner { .. })
                && current_partition.as_deref() != Some(partition.as_str())
        {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_INDEX_CORRUPT",
                "search posting failed current authoritative source recheck",
            ));
        }
        let occurrence_refs = matched_tokens.iter().collect::<Vec<_>>();
        items.push(SearchItemV1 {
            row_id: source.row_id.clone(),
            score: *score,
            fields: source.stored.clone(),
            highlights: highlights(
                &index.highlight_fields,
                &source.source_fields,
                &occurrence_refs,
            ),
        });
    }
    let cursor = if has_more {
        let (score, source, _) = ranked.last().ok_or_else(|| {
            diagnostic(
                "SNAPBACK_SEARCH_INDEX_CORRUPT",
                "search continuation has no boundary",
            )
        })?;
        let (key_generation, root) = authority.cursor_roots.first().ok_or_else(|| {
            diagnostic(
                "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
                "search cursor key material is unavailable",
            )
        })?;
        Some(
            crate::search::cursor::mint(
                root,
                &SearchCursorV1 {
                    format_version: 1,
                    app_id: authority.app_id.to_owned(),
                    database_id: authority.database_id.to_owned(),
                    target_profile_id: authority.target_profile_id.to_owned(),
                    stream_epoch: authority.stream_epoch.to_owned(),
                    semantic_version,
                    physical_generation: generation,
                    query_core_hash: query_hash,
                    limit,
                    authority_instance: authority.authority_instance.to_owned(),
                    owner_subject: authority.owner_subject.map(ToOwned::to_owned),
                    release_policy_digest: authority.release_policy_digest.to_owned(),
                    score: *score,
                    row_id: source.row_id.clone(),
                    row_id_direction: "asc".to_owned(),
                    key_generation: key_generation.clone(),
                    issued_at: authority.now_ms,
                    expires_at: authority.now_ms.saturating_add(SEARCH_CURSOR_TTL_MS),
                },
            )
            .map_err(|_| {
                diagnostic(
                    "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
                    "search continuation cursor could not be minted",
                )
            })?,
        )
    } else {
        None
    };
    let version = crate::storage::current_version_on(conn)?;
    Ok(QueryOutput {
        version,
        rows: items
            .into_iter()
            .map(|item| serde_json::to_value(item).expect("search item serializes"))
            .collect(),
        cursor,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{FieldManifest, FieldType, SeedData};
    use crate::storage::LocalDatabase;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    fn search_schema(visibility: SearchVisibilityV1) -> SchemaManifest {
        let classification = if matches!(visibility, SearchVisibilityV1::PublicRead) {
            SearchFieldClassV1::Public
        } else {
            SearchFieldClassV1::Private
        };
        SchemaManifest {
            required_capabilities: vec![SEARCH_CAPABILITY.to_owned()],
            tables: vec![TableManifest {
                name: "incidents".to_owned(),
                fields: ["title", "summary", "status", "owner"]
                    .into_iter()
                    .map(|name| FieldManifest {
                        name: name.to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    })
                    .collect(),
                indexes: Vec::new(),
                search_indexes: vec![SearchIndexManifestV1 {
                    format_version: 1,
                    name: "search_incidents".to_owned(),
                    semantic_version: "incident-search.v1".to_owned(),
                    analyzer: SEARCH_ANALYZER.to_owned(),
                    analyzer_tables_digest:
                        crate::search::unicode17_generated::ANALYZER_TABLES_DIGEST.to_owned(),
                    text_fields: BTreeMap::from([
                        (
                            "summary".to_owned(),
                            SearchTextFieldV1 {
                                weight: 4,
                                classification,
                            },
                        ),
                        (
                            "title".to_owned(),
                            SearchTextFieldV1 {
                                weight: 8,
                                classification,
                            },
                        ),
                    ]),
                    field_classifications: BTreeMap::from([
                        ("owner".to_owned(), classification),
                        ("status".to_owned(), classification),
                    ]),
                    equality_filters: vec!["status".to_owned()],
                    stored_fields: vec![
                        "owner".to_owned(),
                        "status".to_owned(),
                        "summary".to_owned(),
                        "title".to_owned(),
                    ],
                    highlight_fields: vec!["summary".to_owned(), "title".to_owned()],
                    visibility,
                    tie_break: "score-desc-row-id-asc.v1".to_owned(),
                    source_limits: Default::default(),
                    query_limits: Default::default(),
                    cursor_limits: Default::default(),
                    maintenance_limits: Default::default(),
                }],
                syncable: false,
                permission_backing: false,
                permission_fields: None,
                membership: None,
            }],
            ..SchemaManifest::default()
        }
    }

    fn fixture_seed(bob_title: &str) -> SeedData {
        let rows = [
            json!({
                "_id": "incident-1",
                "title": "API latency at checkout",
                "summary": "Checkout is slow",
                "status": "open",
                "owner": "alice"
            }),
            json!({
                "_id": "incident-2",
                "title": "Checkout degraded",
                "summary": "Payment latency",
                "status": "open",
                "owner": "alice"
            }),
            json!({
                "_id": "incident-3",
                "title": bob_title,
                "summary": "API latency",
                "status": "open",
                "owner": "bob"
            }),
            json!({
                "_id": "incident-4",
                "title": "Resolved checkout",
                "summary": "Historical incident",
                "status": "resolved",
                "owner": "alice"
            }),
        ]
        .into_iter()
        .map(|value| value.as_object().expect("seed object").clone())
        .collect();
        SeedData {
            tables: BTreeMap::from([("incidents".to_owned(), rows)]),
        }
    }

    fn seeded(visibility: SearchVisibilityV1) -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.apply_schema(search_schema(visibility))
            .expect("apply search schema");
        db.seed(fixture_seed("Checkout outage"))
            .expect("seed indexed rows");
        db
    }

    fn file_seeded(
        visibility: SearchVisibilityV1,
        bob_title: &str,
    ) -> (tempfile::TempDir, PathBuf, LocalDatabase) {
        let directory = tempfile::tempdir().expect("search file fixture");
        let path = directory.path().join("search.sqlite3");
        let mut db = LocalDatabase::open(&path).expect("open file search database");
        db.apply_schema(search_schema(visibility))
            .expect("apply search schema");
        db.seed(fixture_seed(bob_title)).expect("seed indexed rows");
        (directory, path, db)
    }

    fn request(after: Option<String>, limit: u32) -> HandlerInput {
        request_for("checkout", after, limit)
    }

    fn request_for(term: &str, after: Option<String>, limit: u32) -> HandlerInput {
        HandlerInput {
            args: serde_json::to_value(SearchRequestV1 {
                query: SearchQueryAstV1 {
                    all: vec![
                        SearchClauseV1::Term(SearchTermV1 {
                            value: term.to_owned(),
                            field: None,
                        }),
                        SearchClauseV1::Filter(SearchFilterV1 {
                            field: "status".to_owned(),
                            op: "eq".to_owned(),
                            value: Value::String("open".to_owned()),
                        }),
                    ],
                },
                limit: Some(limit),
                after,
            })
            .expect("request serializes"),
            ..HandlerInput::default()
        }
    }

    fn run(
        db: &LocalDatabase,
        input: &HandlerInput,
        owner_subject: Option<&str>,
    ) -> SnapbackResult<QueryOutput> {
        db.with_pinned_read_view(|view| run_view(&view, input, owner_subject))
    }

    fn run_view(
        view: &crate::storage::DbRead<'_>,
        input: &HandlerInput,
        owner_subject: Option<&str>,
    ) -> SnapbackResult<QueryOutput> {
        let roots = vec![("cursor-root.v1".to_owned(), [7_u8; 32])];
        let authority = SearchExecutionAuthority {
            app_id: "search-test",
            database_id: "database-v1",
            target_profile_id: "local-dev-sqlite-ibex",
            stream_epoch: "stream-v1",
            authority_instance: "authority-v1",
            owner_subject,
            release_policy_digest: "sha256:policy",
            now_ms: 1_000,
            cursor_roots: &roots,
        };
        let plan = SearchQueryPlanV1 {
            table: "incidents".to_owned(),
            index: "search_incidents".to_owned(),
            parser: SEARCH_PARSER.to_owned(),
            result_projection: "search-page-v1".to_owned(),
            required_capability: SEARCH_CAPABILITY.to_owned(),
        };
        view.search(&plan, input, &authority)
    }

    #[test]
    fn maintained_postings_rank_filter_highlight_and_paginate() {
        let db = seeded(SearchVisibilityV1::PublicRead);
        let first = run(&db, &request(None, 1), None).expect("first page");
        assert_eq!(first.rows.len(), 1);
        assert_eq!(first.rows[0]["rowId"], "incident-1");
        assert!(first.rows[0]["score"].as_u64().unwrap_or_default() > 0);
        assert!(
            first.rows[0]["highlights"]
                .as_array()
                .is_some_and(|values| !values.is_empty())
        );
        let cursor = first.cursor.expect("continuation cursor");
        let second = run(&db, &request(Some(cursor.clone()), 1), None).expect("second page");
        assert_eq!(second.rows.len(), 1);
        assert_ne!(second.rows[0]["rowId"], first.rows[0]["rowId"]);

        let tampered = format!("{cursor}x");
        let error = run(&db, &request(Some(tampered), 1), None).expect_err("tampered cursor");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_CURSOR_RESTART");
    }

    #[test]
    fn owner_partition_is_pushed_down_and_bound_into_cursors() {
        let db = seeded(SearchVisibilityV1::Owner {
            field: "owner".to_owned(),
        });
        let alice = run(&db, &request(None, 1), Some("alice")).expect("alice page");
        assert_eq!(alice.rows.len(), 1);
        assert_eq!(alice.rows[0]["fields"]["owner"], "alice");
        let alice_cursor = alice.cursor.expect("alice continuation");

        let bob = run(&db, &request(None, 10), Some("bob")).expect("bob page");
        assert_eq!(bob.rows.len(), 1);
        assert_eq!(bob.rows[0]["rowId"], "incident-3");
        assert_eq!(bob.rows[0]["fields"]["owner"], "bob");

        let error =
            run(&db, &request(Some(alice_cursor), 1), Some("bob")).expect_err("owner-bound cursor");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_CURSOR_RESTART");
    }

    #[test]
    fn classifications_are_closed_and_manifest_changes_rebuild_then_purge() {
        let (directory, path, mut db) = file_seeded(
            SearchVisibilityV1::Owner {
                field: "owner".to_owned(),
            },
            "Checkout outage",
        );
        let mut invalid = search_schema(SearchVisibilityV1::Owner {
            field: "owner".to_owned(),
        });
        invalid.tables[0].search_indexes[0]
            .field_classifications
            .remove("status");
        let error = db
            .apply_schema(invalid)
            .expect_err("unclassified participating field");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID"
        );

        let mut changed = search_schema(SearchVisibilityV1::Owner {
            field: "owner".to_owned(),
        });
        changed.tables[0].search_indexes[0]
            .field_classifications
            .insert("status".to_owned(), SearchFieldClassV1::Public);
        db.apply_schema(changed)
            .expect("classification-only manifest change rebuilds");
        drop(db);

        let raw = Connection::open(&path).expect("inspect rebuilt generations");
        let generations = raw
            .prepare(
                "SELECT generation,status FROM _snapback_search_generations
                 WHERE table_name='incidents' AND index_name='search_incidents'
                 ORDER BY generation",
            )
            .unwrap()
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            generations,
            vec![(1, "retired".to_owned()), (2, "active".to_owned())]
        );
        for table in [
            "_snapback_search_terms",
            "_snapback_search_sources",
            "_snapback_search_frontiers",
            "_snapback_search_builds",
        ] {
            let stale: i64 = raw
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM {table}
                         WHERE table_name='incidents' AND index_name='search_incidents'
                           AND generation=1"
                    ),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(stale, 0, "retired {table} rows must be purged");
        }
        drop(raw);
        let reopened = LocalDatabase::open(&path).expect("reopen rebuilt database");
        assert_eq!(
            run(&reopened, &request(None, 10), Some("alice"))
                .expect("rebuilt search")
                .rows
                .len(),
            2
        );
        drop(reopened);
        drop(directory);
    }

    #[test]
    fn corruption_backup_and_restore_are_fail_closed_and_recoverable() {
        let (_directory, path, db) = file_seeded(SearchVisibilityV1::PublicRead, "Checkout outage");
        drop(db);
        let backup = path.with_extension("verified-backup.sqlite3");
        std::fs::copy(&path, &backup).expect("copy verified backup");

        let raw = Connection::open(&path).expect("open corruption fixture");
        raw.execute(
            "DELETE FROM _snapback_search_sources
             WHERE table_name='incidents' AND index_name='search_incidents'
               AND row_id='incident-1'",
            [],
        )
        .expect("remove source under retained postings");
        drop(raw);
        let corrupt = LocalDatabase::open(&path).expect("open corrupt derived index");
        let error = run(&corrupt, &request(None, 10), None).expect_err("corrupt search refuses");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_INDEX_CORRUPT");
        drop(corrupt);

        std::fs::copy(&backup, &path).expect("restore verified backup");
        let restored = LocalDatabase::open(&path).expect("open restored database");
        let page = run(&restored, &request(None, 10), None).expect("restored search");
        assert_eq!(
            page.rows
                .iter()
                .map(|row| row["rowId"].as_str().unwrap_or_default())
                .collect::<Vec<_>>(),
            vec!["incident-1", "incident-2", "incident-3"]
        );
    }

    #[test]
    fn paired_owner_observations_do_not_reveal_other_owner_matches() {
        let (_left_dir, _left_path, left) = file_seeded(
            SearchVisibilityV1::Owner {
                field: "owner".to_owned(),
            },
            "Checkout outage",
        );
        let (_right_dir, _right_path, right) = file_seeded(
            SearchVisibilityV1::Owner {
                field: "owner".to_owned(),
            },
            "Unrelated outage",
        );
        let left_page = run(&left, &request(None, 1), Some("alice")).expect("left owner page");
        let right_page = run(&right, &request(None, 1), Some("alice")).expect("right owner page");
        assert_eq!(left_page.rows, right_page.rows);
        assert_eq!(left_page.cursor.is_some(), right_page.cursor.is_some());
        assert_eq!(
            left_page.cursor.as_ref().map(String::len),
            right_page.cursor.as_ref().map(String::len)
        );

        let prefix = HandlerInput {
            args: serde_json::to_value(SearchRequestV1 {
                query: SearchQueryAstV1 {
                    all: vec![SearchClauseV1::Prefix(SearchTermV1 {
                        value: "c".to_owned(),
                        field: None,
                    })],
                },
                limit: Some(10),
                after: None,
            })
            .unwrap(),
            ..HandlerInput::default()
        };
        assert_eq!(
            run(&left, &prefix, Some("alice"))
                .unwrap_err()
                .diagnostic
                .code,
            run(&right, &prefix, Some("alice"))
                .unwrap_err()
                .diagnostic
                .code
        );
    }

    #[test]
    fn pinned_reader_survives_atomic_generation_switch() {
        let (_directory, path, db) = file_seeded(SearchVisibilityV1::PublicRead, "Checkout outage");
        drop(db);
        let reader = LocalDatabase::open(&path).expect("open pinned reader");
        let mut writer = LocalDatabase::open(&path).expect("open generation writer");
        let (pinned_tx, pinned_rx) = std::sync::mpsc::channel();
        let (switched_tx, switched_rx) = std::sync::mpsc::channel();
        let old_page = std::thread::scope(|scope| {
            let handle = scope.spawn(move || {
                reader.with_pinned_read_view(|view| {
                    view.current_version()?;
                    pinned_tx.send(()).expect("announce pinned snapshot");
                    switched_rx.recv().expect("await generation switch");
                    run_view(&view, &request(None, 10), None)
                })
            });
            pinned_rx.recv().expect("reader pins before switch");
            let mut replacement = search_schema(SearchVisibilityV1::PublicRead);
            replacement.tables[0].search_indexes[0]
                .text_fields
                .get_mut("summary")
                .unwrap()
                .weight = 5;
            writer
                .apply_schema(replacement)
                .expect("atomic rebuild and switch");
            switched_tx.send(()).expect("release pinned reader");
            handle
                .join()
                .expect("reader thread")
                .expect("old pinned query")
        });
        assert_eq!(old_page.rows.len(), 3);
        drop(writer);

        let latest = LocalDatabase::open(&path).expect("open current generation");
        assert_eq!(
            run(&latest, &request(None, 10), None)
                .expect("current generation query")
                .rows
                .len(),
            3
        );
    }

    #[test]
    fn preregistered_large_corpus_stays_within_local_sqlite_budgets() {
        const CORPUS_ROWS: usize = 128;
        const BUILD_BUDGET: Duration = Duration::from_secs(5);
        const QUERY_BUDGET: Duration = Duration::from_secs(1);
        let mut db = LocalDatabase::memory().expect("large corpus database");
        db.apply_schema(search_schema(SearchVisibilityV1::PublicRead))
            .expect("large corpus schema");
        let rows = (0..CORPUS_ROWS)
            .map(|index| {
                json!({
                    "_id": format!("incident-{index:04}"),
                    "title": "Needle checkout",
                    "summary": format!("deterministic corpus row {index:04}"),
                    "status": "open",
                    "owner": "alice"
                })
                .as_object()
                .unwrap()
                .clone()
            })
            .collect();
        let build_started = Instant::now();
        db.seed(SeedData {
            tables: BTreeMap::from([("incidents".to_owned(), rows)]),
        })
        .expect("bounded large corpus build");
        assert!(
            build_started.elapsed() <= BUILD_BUDGET,
            "large corpus build exceeded preregistered budget"
        );
        let query_started = Instant::now();
        let page =
            run(&db, &request_for("needle", None, 50), None).expect("bounded large corpus query");
        assert!(
            query_started.elapsed() <= QUERY_BUDGET,
            "large corpus query exceeded preregistered budget"
        );
        assert_eq!(page.rows.len(), 50);
        assert!(page.cursor.is_some());
        assert_eq!(
            page.rows
                .iter()
                .map(|row| row["rowId"].as_str().unwrap_or_default().to_owned())
                .collect::<Vec<_>>(),
            (0..50)
                .map(|index| format!("incident-{index:04}"))
                .collect::<Vec<_>>()
        );
    }
}
