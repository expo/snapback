use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{FieldType, HandlerInput, QueryOutput, SchemaManifest, TableManifest};
use crate::search::analyzer::analyze_field;
use crate::search::ast::{
    atom_tokens, canonical_atom_bytes, canonicalize_query, clause_atom, query_core_hash,
};
use crate::search::highlight::{SearchOccurrence, highlights};
use crate::search::scorer::{atom_frequency, atom_score};
pub use crate::search::types::*;
use crate::storage::{ChangeOp, ChangedRow};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension, Transaction, params, params_from_iter};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

const SEARCH_RELEASE_BATCH_ROWS: usize = 400;

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
          content_digest TEXT NOT NULL,
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
          content_digest TEXT NOT NULL,
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
    for (table, column) in [
        ("_snapback_search_sources", "content_digest"),
        ("_snapback_search_frontiers", "content_digest"),
    ] {
        let has_column = conn
            .prepare(&format!("PRAGMA table_info({table})"))?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(Result::ok)
            .any(|candidate| candidate == column);
        if !has_column {
            conn.execute(
                &format!(
                    "ALTER TABLE {table}
                     ADD COLUMN {column} TEXT NOT NULL DEFAULT ''"
                ),
                [],
            )?;
        }
    }
    // @ref LLP 0073#adapter-contract-and-capabilities — every derived-state
    // mutation invalidates the generation seal until the canonical maintainer
    // verifies the source/posting/frontier tuple and advances the content root.
    // Any write outside the verified maintainer transaction quarantines the
    // complete generation. Official maintenance verifies the changed source,
    // advances the content root, and atomically reseals it before commit.
    // This catches omissions in non-candidate postings without adding an
    // unbounded whole-index scan to every search request.
    for (relation, event) in [
        ("sources", "INSERT"),
        ("sources", "UPDATE"),
        ("sources", "DELETE"),
        ("terms", "INSERT"),
        ("terms", "UPDATE"),
        ("terms", "DELETE"),
        ("frontiers", "INSERT"),
        ("frontiers", "UPDATE"),
        ("frontiers", "DELETE"),
    ] {
        let timing = event.to_ascii_lowercase();
        let row = if event == "DELETE" { "OLD" } else { "NEW" };
        conn.execute_batch(&format!(
            "CREATE TRIGGER IF NOT EXISTS _snapback_search_{relation}_{timing}_quarantine
             AFTER {event} ON _snapback_search_{relation}
             BEGIN
               UPDATE _snapback_search_generations
               SET status='quarantined',
                   corruption_reason='derived search state changed without a verified generation seal'
               WHERE table_name={row}.table_name
                 AND index_name={row}.index_name
                 AND generation={row}.generation
                 AND status IN ('active','quarantined');
             END;"
        ))?;
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
    let generation: Option<(u64, String, String, String, String, Option<String>)> = conn
        .query_row(
            "SELECT generation, semantic_version, manifest_digest, root_digest, status,
                corruption_reason
         FROM _snapback_search_generations
         WHERE table_name = ?1 AND index_name = ?2
           AND status IN ('active','quarantined')
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, generation DESC
         LIMIT 1",
            params![table, index],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()?;
    let Some((generation, semantic, manifest, root, status, corruption_reason)) = generation else {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
            format!("search index {table}.{index} has no active generation"),
        ));
    };
    if status != "active" || corruption_reason.is_some() || decode_generation_root(&root).is_err() {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_INDEX_CORRUPT",
            format!("search index {table}.{index} generation seal is not valid"),
        ));
    }
    Ok((generation, semantic, manifest))
}

fn manifest_digest(index: &SearchIndexManifestV1) -> SnapbackResult<String> {
    let value = serde_json::to_value(index).map_err(|_| {
        diagnostic(
            "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
            "search index manifest does not serialize",
        )
    })?;
    crate::rqs_contract::sha256_identity(&value).map_err(|_| {
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
        SearchVisibilityV1::Membership { resource_field, .. } => row
            .get(resource_field)
            .and_then(Value::as_str)
            .map(|value| format!("membership:{value}"))
            .ok_or_else(|| {
                diagnostic(
                    "SNAPBACK_SEARCH_MAINTENANCE_FAILED",
                    format!("membership search source is missing string field {resource_field}"),
                )
            }),
    }
}

type SourceTokens = (
    Vec<SearchToken>,
    BTreeMap<String, String>,
    Map<String, Value>,
);

fn source_tokens(index: &SearchIndexManifestV1, row: &Value) -> SnapbackResult<SourceTokens> {
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

fn token_values(tokens: &[SearchToken]) -> Vec<Value> {
    tokens
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
        .collect()
}

fn content_digest(value: &Value) -> SnapbackResult<String> {
    crate::rqs_contract::sha256_identity(value).map_err(|_| {
        diagnostic(
            "SNAPBACK_SEARCH_MAINTENANCE_FAILED",
            "search source content is not canonically digestible",
        )
    })
}

fn live_source_content_digest(
    row_id: &str,
    source_version: u64,
    partition: &str,
    stored: &Map<String, Value>,
    filters: &Map<String, Value>,
    source_fields: &BTreeMap<String, String>,
    tokens: &[SearchToken],
) -> SnapbackResult<String> {
    content_digest(&json!({
        "profile": "snapback-search-source-content-v1",
        "rowId": row_id,
        "sourceVersion": source_version,
        "partition": partition,
        "stored": stored,
        "filters": filters,
        "sourceFields": source_fields,
        "tokens": token_values(tokens),
        "tombstone": false,
    }))
}

fn tombstone_content_digest(row_id: &str, source_version: u64) -> SnapbackResult<String> {
    content_digest(&json!({
        "profile": "snapback-search-source-content-v1",
        "rowId": row_id,
        "sourceVersion": source_version,
        "tombstone": true,
    }))
}

fn decode_sha256_digest(digest: &str) -> SnapbackResult<[u8; 32]> {
    let encoded = digest.strip_prefix("sha256:").ok_or_else(|| {
        diagnostic(
            "SNAPBACK_SEARCH_INDEX_CORRUPT",
            "search source content digest has the wrong profile",
        )
    })?;
    if encoded.len() != 64 {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_INDEX_CORRUPT",
            "search source content digest has the wrong size",
        ));
    }
    let mut decoded = [0_u8; 32];
    for (index, byte) in decoded.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&encoded[index * 2..index * 2 + 2], 16).map_err(|_| {
            diagnostic(
                "SNAPBACK_SEARCH_INDEX_CORRUPT",
                "search source content digest is not hexadecimal",
            )
        })?;
    }
    Ok(decoded)
}

fn encode_generation_root(root: [u8; 32]) -> String {
    let encoded = root
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("sha256-xor-v1:{encoded}")
}

fn decode_generation_root(root: &str) -> SnapbackResult<[u8; 32]> {
    let encoded = root.strip_prefix("sha256-xor-v1:").ok_or_else(|| {
        diagnostic(
            "SNAPBACK_SEARCH_INDEX_CORRUPT",
            "search generation root has the wrong profile",
        )
    })?;
    decode_sha256_digest(&format!("sha256:{encoded}"))
}

fn xor_content_digest(root: &mut [u8; 32], digest: &str) -> SnapbackResult<()> {
    for (root_byte, digest_byte) in root.iter_mut().zip(decode_sha256_digest(digest)?) {
        *root_byte ^= digest_byte;
    }
    Ok(())
}

fn generation_root_from_frontiers(
    conn: &Connection,
    table: &str,
    index: &str,
    generation: u64,
) -> SnapbackResult<String> {
    let mut statement = conn.prepare(
        "SELECT content_digest FROM _snapback_search_frontiers
         WHERE table_name=?1 AND index_name=?2 AND generation=?3
         ORDER BY source_id",
    )?;
    let mut rows = statement.query(params![table, index, generation as i64])?;
    let mut root = [0_u8; 32];
    while let Some(row) = rows.next()? {
        xor_content_digest(&mut root, &row.get::<_, String>(0)?)?;
    }
    Ok(encode_generation_root(root))
}

struct SourceReplacement<'a> {
    table: &'a str,
    index: &'a SearchIndexManifestV1,
    generation: u64,
    row_id: &'a str,
    source_version: u64,
    row: Option<&'a Value>,
}

fn replace_source(
    tx: &Transaction<'_>,
    source: SourceReplacement<'_>,
    counters: &mut MaintenanceCounters,
) -> SnapbackResult<()> {
    let SourceReplacement {
        table,
        index,
        generation,
        row_id,
        source_version,
        row,
    } = source;
    let generation_status: Option<String> = tx
        .query_row(
            "SELECT status FROM _snapback_search_generations
             WHERE table_name=?1 AND index_name=?2 AND generation=?3",
            params![table, index.name, generation as i64],
            |row| row.get(0),
        )
        .optional()?;
    if generation_status
        .as_deref()
        .is_some_and(|status| status != "active")
    {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_INDEX_CORRUPT",
            "search maintenance cannot reseal a generation that was already quarantined",
        ));
    }
    let old_content_digest: Option<String> = tx
        .query_row(
            "SELECT content_digest FROM _snapback_search_frontiers
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND source_id=?4",
            params![table, index.name, generation as i64, row_id],
            |row| row.get(0),
        )
        .optional()?;
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
            let new_content_digest = tombstone_content_digest(row_id, source_version)?;
            tx.execute(
                "INSERT INTO _snapback_search_frontiers
                 (table_name,index_name,generation,source_id,highest_version,tombstone,content_digest)
                 VALUES (?1,?2,?3,?4,?5,1,?6)
                 ON CONFLICT(table_name,index_name,generation,source_id)
                 DO UPDATE SET highest_version=excluded.highest_version,tombstone=1,
                               content_digest=excluded.content_digest
                 WHERE excluded.highest_version >= highest_version",
                params![
                    table,
                    index.name,
                    generation as i64,
                    row_id,
                    source_version as i64,
                    new_content_digest,
                ],
            )?;
            verify_source_derived(tx, table, index, generation, row_id, source_version, None)?;
            reseal_generation_source(
                tx,
                table,
                index,
                generation,
                source_version,
                old_content_digest.as_deref(),
                &new_content_digest,
            )?;
        }
        Some(row) => {
            let partition = partition_for(index, row)?;
            let (tokens, source_fields, stored) = source_tokens(index, row)?;
            if old_postings.saturating_add(tokens.len())
                > index.source_limits.max_posting_operations as usize
            {
                return Err(diagnostic(
                    "SNAPBACK_SEARCH_SOURCE_LIMIT",
                    "search source replacement exceeds its declared old-plus-new posting bound",
                ));
            }
            counters.positions = counters.positions.saturating_add(tokens.len());
            counters.posting_ops = counters.posting_ops.saturating_add(tokens.len());
            let token_json = serde_json::to_string(&token_values(&tokens)).map_err(|_| {
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
            let new_content_digest = live_source_content_digest(
                row_id,
                source_version,
                &partition,
                &stored,
                &filters,
                &source_fields,
                &tokens,
            )?;
            counters.bytes = counters.bytes.saturating_add(
                token_json.len() + fields_json.len() + filters_json.len() + row_json.len(),
            );
            tx.execute(
                "INSERT INTO _snapback_search_sources
                 (table_name,index_name,generation,row_id,source_version,partition_key,row_json,filters_json,fields_json,tokens_json,content_digest,tombstone)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0)",
                params![table, index.name, generation as i64, row_id, source_version as i64, partition, row_json, filters_json, fields_json, token_json, new_content_digest],
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
                 (table_name,index_name,generation,source_id,highest_version,tombstone,content_digest)
                 VALUES (?1,?2,?3,?4,?5,0,?6)
                 ON CONFLICT(table_name,index_name,generation,source_id)
                 DO UPDATE SET highest_version=excluded.highest_version,tombstone=0,
                               content_digest=excluded.content_digest
                 WHERE excluded.highest_version >= highest_version",
                params![
                    table,
                    index.name,
                    generation as i64,
                    row_id,
                    source_version as i64,
                    new_content_digest,
                ],
            )?;
            let expected = IndexedSource {
                row_id: row_id.to_owned(),
                source_version,
                partition,
                stored,
                filters,
                source_fields,
                tokens,
                content_digest: new_content_digest.clone(),
            };
            verify_source_derived(
                tx,
                table,
                index,
                generation,
                row_id,
                source_version,
                Some(&expected),
            )?;
            reseal_generation_source(
                tx,
                table,
                index,
                generation,
                source_version,
                old_content_digest.as_deref(),
                &new_content_digest,
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
                SourceReplacement {
                    table: &table.name,
                    index,
                    generation,
                    row_id: &change.id,
                    source_version: version,
                    row: if change.op == ChangeOp::Delete {
                        None
                    } else {
                        change.row.as_ref()
                    },
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
    schema: &SchemaManifest,
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
    match &index.visibility {
        SearchVisibilityV1::Owner { field } => {
            let owner = source_fields.get(field.as_str()).ok_or_else(invalid)?;
            if owner.optional
                || !matches!(owner.field_type, FieldType::String | FieldType::Principal)
            {
                return Err(invalid());
            }
            participating_non_text.insert(field.clone());
        }
        SearchVisibilityV1::Membership {
            declaration,
            resource_field,
            roles,
        } => {
            let resource = source_fields
                .get(resource_field.as_str())
                .ok_or_else(invalid)?;
            if resource.optional
                || !matches!(
                    resource.field_type,
                    FieldType::String | FieldType::Principal | FieldType::Id { .. }
                )
            {
                return Err(invalid());
            }
            let (_, membership) = crate::manifest::find_membership_declaration(schema, declaration)
                .ok_or_else(invalid)?;
            if membership.scope != crate::manifest::MembershipScope::Resource {
                return Err(invalid());
            }
            if let Some(roles) = roles {
                let unique = roles.iter().collect::<BTreeSet<_>>();
                if roles.is_empty()
                    || unique.len() != roles.len()
                    || roles
                        .iter()
                        .any(|role| !membership.vocabulary().any(|known| known == role))
                {
                    return Err(invalid());
                }
            }
            participating_non_text.insert(resource_field.clone());
        }
        SearchVisibilityV1::PublicRead => {}
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
            validate_index_declaration(schema, table, index)?;
            let index_manifest_digest = manifest_digest(index)?;
            let existing: Option<(u64, String, String, String, String, Option<String>)> = tx
                .query_row(
                    "SELECT generation, semantic_version, manifest_digest, root_digest, status,
                            corruption_reason
                     FROM _snapback_search_generations
                     WHERE table_name=?1 AND index_name=?2
                       AND status IN ('active','quarantined')
                     ORDER BY generation DESC LIMIT 1",
                    params![table.name, index.name],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)? as u64,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                        ))
                    },
                )
                .optional()?;
            if existing.as_ref().is_some_and(
                |(_, semantic, current_digest, root, status, reason)| {
                    semantic == &index.semantic_version
                        && current_digest == &index_manifest_digest
                        && status == "active"
                        && reason.is_none()
                        && decode_generation_root(root).is_ok()
                },
            ) {
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
            for (id, version, row) in &rows {
                replace_source(
                    tx,
                    SourceReplacement {
                        table: &table.name,
                        index,
                        generation,
                        row_id: id,
                        source_version: *version,
                        row: Some(row),
                    },
                    &mut counters,
                )?;
            }
            counters.enforce_global()?;
            let root_digest =
                generation_root_from_frontiers(tx, &table.name, &index.name, generation)?;
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

#[derive(Clone, Debug, PartialEq)]
struct IndexedSource {
    row_id: String,
    source_version: u64,
    partition: String,
    stored: Map<String, Value>,
    filters: Map<String, Value>,
    source_fields: BTreeMap<String, String>,
    tokens: Vec<SearchToken>,
    content_digest: String,
}

struct RawIndexedSource {
    row_id: String,
    source_version: i64,
    partition: String,
    stored_json: String,
    filters_json: String,
    source_fields_json: String,
    tokens_json: String,
    content_digest: String,
}

fn decode_raw_source(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawIndexedSource> {
    Ok(RawIndexedSource {
        row_id: row.get(0)?,
        source_version: row.get(1)?,
        partition: row.get(2)?,
        stored_json: row.get(3)?,
        filters_json: row.get(4)?,
        source_fields_json: row.get(5)?,
        tokens_json: row.get(7)?,
        content_digest: row.get(8)?,
    })
}

fn parse_source(raw: RawIndexedSource) -> SnapbackResult<IndexedSource> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct TokenWire {
        field: String,
        token: String,
        position: u32,
        source_start: u32,
        source_end: u32,
    }

    let corrupt = || {
        diagnostic(
            "SNAPBACK_SEARCH_INDEX_CORRUPT",
            "search source record has a malformed derived-state payload",
        )
    };
    let tokens: Vec<TokenWire> = serde_json::from_str(&raw.tokens_json).map_err(|_| corrupt())?;
    if raw.source_version < 0
        || tokens.iter().any(|token| {
            token.field.is_empty()
                || token.token.is_empty()
                || token.source_start >= token.source_end
        })
    {
        return Err(corrupt());
    }
    Ok(IndexedSource {
        row_id: raw.row_id,
        source_version: raw.source_version as u64,
        partition: raw.partition,
        stored: serde_json::from_str(&raw.stored_json).map_err(|_| corrupt())?,
        filters: serde_json::from_str(&raw.filters_json).map_err(|_| corrupt())?,
        source_fields: serde_json::from_str(&raw.source_fields_json).map_err(|_| corrupt())?,
        tokens: tokens
            .into_iter()
            .map(|token| SearchToken {
                field: token.field,
                token: token.token,
                position: token.position,
                source_start: token.source_start,
                source_end: token.source_end,
            })
            .collect(),
        content_digest: raw.content_digest,
    })
}

fn load_candidate_sources(
    conn: &Connection,
    table: &str,
    index: &SearchIndexManifestV1,
    generation: u64,
    partition: &str,
    candidate_ids: &[String],
) -> SnapbackResult<Vec<IndexedSource>> {
    let mut raw_sources = BTreeMap::new();
    for chunk in candidate_ids.chunks(SEARCH_RELEASE_BATCH_ROWS) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT row_id,source_version,partition_key,row_json,filters_json,fields_json,
                    tombstone,tokens_json,content_digest
             FROM _snapback_search_sources
             WHERE table_name=? AND index_name=? AND generation=?
               AND partition_key=? AND row_id IN ({placeholders})
             ORDER BY row_id"
        );
        let mut parameters = vec![
            SqlValue::Text(table.to_owned()),
            SqlValue::Text(index.name.clone()),
            SqlValue::Integer(generation as i64),
            SqlValue::Text(partition.to_owned()),
        ];
        parameters.extend(chunk.iter().cloned().map(SqlValue::Text));
        let mut statement = conn.prepare(&sql)?;
        let mut rows = statement.query(params_from_iter(parameters.iter()))?;
        while let Some(row) = rows.next()? {
            let raw = decode_raw_source(row)?;
            raw_sources.insert(raw.row_id.clone(), raw);
        }
    }

    candidate_ids
        .iter()
        .map(|row_id| {
            raw_sources
                .remove(row_id)
                .ok_or_else(|| {
                    diagnostic(
                        "SNAPBACK_SEARCH_INDEX_CORRUPT",
                        "search posting references a missing source record",
                    )
                })
                .and_then(parse_source)
        })
        .collect()
}

fn authoritative_indexed_source(
    index: &SearchIndexManifestV1,
    row_id: &str,
    row: &Value,
) -> SnapbackResult<IndexedSource> {
    let source_version = row.get("_version").and_then(Value::as_u64).ok_or_else(|| {
        diagnostic(
            "SNAPBACK_SEARCH_INDEX_CORRUPT",
            "authoritative search source has no portable row version",
        )
    })?;
    let partition = partition_for(index, row)?;
    let (tokens, source_fields, stored) = source_tokens(index, row)?;
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
    let content_digest = live_source_content_digest(
        row_id,
        source_version,
        &partition,
        &stored,
        &filters,
        &source_fields,
        &tokens,
    )?;
    Ok(IndexedSource {
        row_id: row_id.to_owned(),
        source_version,
        partition,
        stored,
        filters,
        source_fields,
        tokens,
        content_digest,
    })
}

fn load_authoritative_rows(
    conn: &Connection,
    table: &TableManifest,
    row_ids: &[String],
) -> SnapbackResult<BTreeMap<String, Value>> {
    let quoted = crate::storage::quote_ident(&table.name)?;
    let mut documents = BTreeMap::new();
    for chunk in row_ids.chunks(SEARCH_RELEASE_BATCH_ROWS) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql =
            format!("SELECT * FROM {quoted} WHERE \"_id\" IN ({placeholders}) ORDER BY \"_id\"");
        let parameters = chunk
            .iter()
            .cloned()
            .map(SqlValue::Text)
            .collect::<Vec<_>>();
        let mut statement = conn.prepare(&sql)?;
        let columns = statement
            .column_names()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let mut rows = statement.query(params_from_iter(parameters.iter()))?;
        while let Some(row) = rows.next()? {
            let document = crate::storage::row_to_document(row, table, &columns)?;
            let row_id = document
                .get("_id")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    diagnostic(
                        "SNAPBACK_SEARCH_INDEX_CORRUPT",
                        "search posting references a missing authoritative source row",
                    )
                })?
                .to_owned();
            documents.insert(row_id, document);
        }
    }
    Ok(documents)
}

fn verify_source_derived(
    conn: &Connection,
    table: &str,
    index: &SearchIndexManifestV1,
    generation: u64,
    row_id: &str,
    source_version: u64,
    expected: Option<&IndexedSource>,
) -> SnapbackResult<()> {
    let raw_source = conn
        .query_row(
            "SELECT row_id,source_version,partition_key,row_json,filters_json,fields_json,
                    tombstone,tokens_json,content_digest
             FROM _snapback_search_sources
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND row_id=?4",
            params![table, index.name, generation as i64, row_id],
            decode_raw_source,
        )
        .optional()?;
    let actual_source = raw_source.map(parse_source).transpose()?;
    if actual_source.as_ref() != expected {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_INDEX_CORRUPT",
            "derived search source differs from its canonical source content",
        ));
    }

    let mut statement = conn.prepare(
        "SELECT partition_key,token,field_name,position,source_start,source_end,source_version
         FROM _snapback_search_terms
         WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND row_id=?4
         ORDER BY field_name,position",
    )?;
    let actual_terms = statement
        .query_map(
            params![table, index.name, generation as i64, row_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let mut expected_terms = expected
        .map(|source| {
            source
                .tokens
                .iter()
                .map(|token| {
                    (
                        source.partition.clone(),
                        token.token.clone(),
                        token.field.clone(),
                        i64::from(token.position),
                        i64::from(token.source_start),
                        i64::from(token.source_end),
                        source.source_version as i64,
                    )
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    expected_terms.sort_by(|left, right| (&left.2, left.3).cmp(&(&right.2, right.3)));
    if actual_terms != expected_terms {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_INDEX_CORRUPT",
            "derived search postings differ from canonical source tokens",
        ));
    }

    let frontier: Option<(i64, i64, String)> = conn
        .query_row(
            "SELECT highest_version,tombstone,content_digest
             FROM _snapback_search_frontiers
             WHERE table_name=?1 AND index_name=?2 AND generation=?3 AND source_id=?4",
            params![table, index.name, generation as i64, row_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let expected_digest = match expected {
        Some(source) => source.content_digest.clone(),
        None => tombstone_content_digest(row_id, source_version)?,
    };
    if frontier
        != Some((
            source_version as i64,
            i64::from(expected.is_none()),
            expected_digest,
        ))
    {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_INDEX_CORRUPT",
            "derived search frontier differs from canonical source state",
        ));
    }
    Ok(())
}

fn reseal_generation_source(
    tx: &Transaction<'_>,
    table: &str,
    index: &SearchIndexManifestV1,
    generation: u64,
    source_version: u64,
    old_content_digest: Option<&str>,
    new_content_digest: &str,
) -> SnapbackResult<()> {
    let generation_row: Option<(String, String)> = tx
        .query_row(
            "SELECT root_digest,receipt_json FROM _snapback_search_generations
             WHERE table_name=?1 AND index_name=?2 AND generation=?3
               AND status IN ('active','quarantined')",
            params![table, index.name, generation as i64],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((root_digest, receipt_json)) = generation_row else {
        // A rebuild constructs derived rows before publishing its generation
        // record. Activation computes and stores the complete root afterward.
        return Ok(());
    };
    let mut root = decode_generation_root(&root_digest)?;
    if let Some(old_content_digest) = old_content_digest {
        xor_content_digest(&mut root, old_content_digest)?;
    }
    xor_content_digest(&mut root, new_content_digest)?;
    let root_digest = encode_generation_root(root);
    let row_count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM _snapback_search_sources
         WHERE table_name=?1 AND index_name=?2 AND generation=?3",
        params![table, index.name, generation as i64],
        |row| row.get(0),
    )?;
    let mut receipt: crate::search::rebuild::SearchRebuildReceiptV1 =
        serde_json::from_str(&receipt_json).map_err(|_| {
            diagnostic(
                "SNAPBACK_SEARCH_INDEX_CORRUPT",
                "search generation receipt is not parseable during reseal",
            )
        })?;
    receipt.root_digest = root_digest.clone();
    receipt.source_head = receipt.source_head.max(source_version);
    receipt.row_count = row_count as u64;
    tx.execute(
        "UPDATE _snapback_search_generations
         SET status='active',source_head=MAX(source_head,?4),root_digest=?5,
             receipt_json=?6,corruption_reason=NULL
         WHERE table_name=?1 AND index_name=?2 AND generation=?3",
        params![
            table,
            index.name,
            generation as i64,
            source_version as i64,
            root_digest,
            serde_json::to_string(&receipt).map_err(|_| {
                diagnostic(
                    "SNAPBACK_SEARCH_MAINTENANCE_FAILED",
                    "search generation receipt does not serialize during reseal",
                )
            })?,
        ],
    )?;
    Ok(())
}

fn atom_matches(
    atom: &SearchMatchAtomV1,
    terms: &[String],
    source: &IndexedSource,
) -> SnapbackResult<(bool, Vec<SearchOccurrence>)> {
    if terms.is_empty() {
        return Ok((false, Vec::new()));
    }
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
    let canonical_atom = canonical_atom_bytes(atom)?;
    let occurrences = match atom {
        SearchMatchAtomV1::Term(_) => field_tokens
            .into_iter()
            .filter(|token| token.token == terms[0])
            .map(|token| SearchOccurrence {
                field: token.field.clone(),
                source_start: token.source_start,
                source_end: token.source_end,
                canonical_atom: canonical_atom.clone(),
            })
            .collect(),
        SearchMatchAtomV1::Prefix(_) => field_tokens
            .into_iter()
            .filter(|token| token.token.starts_with(&terms[0]))
            .map(|token| SearchOccurrence {
                field: token.field.clone(),
                source_start: token.source_start,
                source_end: token.source_end,
                canonical_atom: canonical_atom.clone(),
            })
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
                            && token.field == window[0].field
                            && (index == 0 || token.position == window[index - 1].position + 1)
                    })
            })
            .map(|window| SearchOccurrence {
                field: window[0].field.clone(),
                source_start: window[0].source_start,
                source_end: window[window.len() - 1].source_end,
                canonical_atom: canonical_atom.clone(),
            })
            .collect(),
    };
    Ok((frequency > 0, occurrences))
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

fn prefix_upper_bound(prefix: &str) -> Option<String> {
    let mut scalars = prefix.chars().collect::<Vec<_>>();
    while let Some(last) = scalars.pop() {
        if last == char::MAX {
            continue;
        }
        let mut next = u32::from(last) + 1;
        if (0xD800..=0xDFFF).contains(&next) {
            next = 0xE000;
        }
        scalars.push(char::from_u32(next).expect("next Unicode scalar is valid"));
        return Some(scalars.into_iter().collect());
    }
    None
}

const PREFIX_TERM_COUNT_BOUNDED_SQL: &str = "SELECT COUNT(DISTINCT token)
     FROM _snapback_search_terms
     WHERE table_name=?1 AND index_name=?2 AND generation=?3
       AND partition_key=?4 AND token>=?5 AND token<?6
       AND (?7 IS NULL OR field_name=?7)";

const PREFIX_TERM_COUNT_OPEN_SQL: &str = "SELECT COUNT(DISTINCT token)
     FROM _snapback_search_terms
     WHERE table_name=?1 AND index_name=?2 AND generation=?3
       AND partition_key=?4 AND token>=?5
       AND (?6 IS NULL OR field_name=?6)";

const PREFIX_CANDIDATES_BOUNDED_SQL: &str = "SELECT DISTINCT row_id
     FROM _snapback_search_terms
     WHERE table_name=?1 AND index_name=?2 AND generation=?3
       AND partition_key=?4 AND token>=?5 AND token<?6
       AND (?7 IS NULL OR field_name=?7)
     ORDER BY row_id";

const PREFIX_CANDIDATES_OPEN_SQL: &str = "SELECT DISTINCT row_id
     FROM _snapback_search_terms
     WHERE table_name=?1 AND index_name=?2 AND generation=?3
       AND partition_key=?4 AND token>=?5
       AND (?6 IS NULL OR field_name=?6)
     ORDER BY row_id";

fn collect_candidate_rows(
    mut rows: rusqlite::Rows<'_>,
    max_candidate_work: u32,
) -> SnapbackResult<BTreeSet<String>> {
    let mut candidates = BTreeSet::new();
    while let Some(row) = rows.next()? {
        candidates.insert(row.get(0)?);
        if candidates.len() > max_candidate_work as usize {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_WORK_LIMIT",
                "search posting anchor exceeds the declared exact-ranking ceiling",
            ));
        }
    }
    Ok(candidates)
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
        // SQLite's BINARY collation compares UTF-8 bytes, whose order matches
        // Unicode scalar order. The half-open successor range is therefore
        // exactly equivalent to the previous substr prefix test for every
        // already-analyzed valid token, while remaining index-sargable.
        // @ref LLP 0221#phases — Phase 0(b): sargable prefix range; public
        // semantics and logical work ceilings are unchanged.
        let upper_bound = prefix_upper_bound(anchor);
        let term_count: i64 = match upper_bound.as_deref() {
            Some(upper_bound) => conn.query_row(
                PREFIX_TERM_COUNT_BOUNDED_SQL,
                params![
                    table,
                    index.name,
                    generation as i64,
                    partition,
                    anchor,
                    upper_bound,
                    field,
                ],
                |row| row.get(0),
            )?,
            None => conn.query_row(
                PREFIX_TERM_COUNT_OPEN_SQL,
                params![
                    table,
                    index.name,
                    generation as i64,
                    partition,
                    anchor,
                    field,
                ],
                |row| row.get(0),
            )?,
        };
        if term_count > index.query_limits.max_prefix_terms as i64 {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_WORK_LIMIT",
                "search prefix vocabulary exceeds the declared partition-local ceiling",
            ));
        }
        let mut statement = conn.prepare(match upper_bound {
            Some(_) => PREFIX_CANDIDATES_BOUNDED_SQL,
            None => PREFIX_CANDIDATES_OPEN_SQL,
        })?;
        let rows = match upper_bound.as_deref() {
            Some(upper_bound) => statement.query(params![
                table,
                index.name,
                generation as i64,
                partition,
                anchor,
                upper_bound,
                field,
            ])?,
            None => statement.query(params![
                table,
                index.name,
                generation as i64,
                partition,
                anchor,
                field,
            ])?,
        };
        collect_candidate_rows(rows, index.query_limits.max_candidate_work)
    } else {
        let mut statement = conn.prepare(
            "SELECT DISTINCT row_id
             FROM _snapback_search_terms
             WHERE table_name=?1 AND index_name=?2 AND generation=?3
               AND partition_key=?4 AND token=?5
               AND (?6 IS NULL OR field_name=?6)
             ORDER BY row_id",
        )?;
        let rows = statement.query(params![
            table,
            index.name,
            generation as i64,
            partition,
            anchor,
            field,
        ])?;
        collect_candidate_rows(rows, index.query_limits.max_candidate_work)
    }
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
            FieldType::String
            | FieldType::Enum { .. }
            | FieldType::Principal
            | FieldType::Id { .. }
            | FieldType::AssetRef { .. } => filter.value.is_string(),
            FieldType::Boolean => filter.value.is_boolean(),
            FieldType::Integer => filter.value.as_i64().is_some(),
            FieldType::Real
            | FieldType::Json
            | FieldType::Structured { .. }
            | FieldType::Vector { .. }
            | FieldType::RelationIncarnation { .. } => false,
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
    let membership_visibility = matches!(index.visibility, SearchVisibilityV1::Membership { .. });
    if membership_visibility != plan.resource_arg.is_some() {
        return Err(diagnostic(
            "SNAPBACK_SEARCH_QUERY_INVALID",
            "membership search visibility and resourceArg must be present together",
        ));
    }
    let membership_resource = plan
        .resource_arg
        .as_deref()
        .map(|resource_arg| {
            input
                .args
                .get(resource_arg)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    diagnostic(
                        "SNAPBACK_SEARCH_QUERY_INVALID",
                        format!(
                            "membership search requires non-empty string argument {resource_arg}"
                        ),
                    )
                })
        })
        .transpose()?;
    let mut request_args = input.args.clone();
    if let Some(resource_arg) = &plan.resource_arg {
        request_args
            .as_object_mut()
            .ok_or_else(|| {
                diagnostic(
                    "SNAPBACK_SEARCH_QUERY_INVALID",
                    "membership search arguments must be an object",
                )
            })?
            .remove(resource_arg);
    }
    // @ref LLP 0131#runtime-ingress-validation — the request parse delegates
    // through the shared args-contract seam so this special case and the
    // SchemaRef delegation are one path-carrying serde authority.
    let request: SearchRequestV1 = crate::args_contract::parse_search_request(&request_args)?;
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
    let mut membership_declaration = None;
    let mut membership_roles = None;
    let mut authorization_incarnation = None;
    let mut authorization_epoch = None;
    let mut seat_admitted = true;
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
        SearchVisibilityV1::Membership {
            declaration, roles, ..
        } => {
            let subject = authority.owner_subject.ok_or_else(|| {
                diagnostic(
                    "SNAPBACK_SEARCH_QUERY_INVALID",
                    "membership search requires a canonical effective-user subject",
                )
            })?;
            let resource = membership_resource
                .as_deref()
                .expect("resourceArg consistency checked above");
            let (membership_table, membership) =
                crate::manifest::find_membership_declaration(schema, declaration).ok_or_else(
                    || {
                        diagnostic(
                            "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
                            "membership search declaration is unavailable",
                        )
                    },
                )?;
            let resource_column = membership.resource.as_ref().ok_or_else(|| {
                diagnostic(
                    "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
                    "membership search declaration is not resource-scoped",
                )
            })?;
            let authorization =
                crate::storage::auth_stream::read_authorization_version_snapshot(conn)?
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_AUTHORIZATION_VERSION_CORRUPT",
                            "auth",
                            "authorization-version metadata is missing",
                        )
                    })?;
            authorization_incarnation = Some(authorization.incarnation);
            authorization_epoch = Some(authorization.epoch);
            membership_declaration = Some(declaration.clone());
            membership_roles = roles.clone();

            // `membership_probe_plan` deliberately ignores the optional expiry
            // column: expiry becomes effective only when the declared sweep
            // removes the row, so direct search seat resolution mirrors it.
            // @ref LLP 0100#8-the-membership-composition-family-routed-sibling-surfaces
            let sql = format!(
                "SELECT {role} FROM {table} WHERE {principal}=?1 AND {resource}=?2",
                role = crate::storage::quote_ident(&membership.role)?,
                table = crate::storage::quote_ident(&membership_table.name)?,
                principal = crate::storage::quote_ident(&membership.principal)?,
                resource = crate::storage::quote_ident(resource_column)?,
            );
            let role: Option<String> = conn
                .query_row(&sql, params![subject, resource], |row| row.get(0))
                .optional()?;
            let admitted_roles =
                crate::manifest::effective_membership_roles(membership, roles.as_deref());
            seat_admitted = role
                .as_ref()
                .is_some_and(|role| admitted_roles.iter().any(|allowed| allowed == role));
            format!("membership:{resource}")
        }
    };
    // @ref LLP 0100#8-the-membership-composition-family-routed-sibling-surfaces —
    // membership custody, including the current authorization version, is
    // compared before posting traversal and collapses to the uniform restart.
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
                || body.membership_resource.as_ref() != membership_resource.as_ref()
                || body.membership_declaration.as_ref() != membership_declaration.as_ref()
                || body.membership_roles.as_ref() != membership_roles.as_ref()
                || body.authorization_incarnation.as_ref() != authorization_incarnation.as_ref()
                || body.authorization_epoch != authorization_epoch
                || body.release_policy_digest != authority.release_policy_digest
                || body.row_id_direction != "asc"
            {
                return Err(cursor_restart());
            }
            Ok((body.score, body.row_id))
        })
        .transpose()?;

    let candidate_ids = if seat_admitted {
        posting_candidates(conn, &table.name, index, generation, &partition, &query)?
    } else {
        // No seat follows the exact ordinary zero-candidate page path. This
        // keeps outsider, revoked, and nonexistent-resource observations equal.
        BTreeSet::new()
    };
    let candidate_ids = candidate_ids.into_iter().collect::<Vec<_>>();
    // @ref LLP 0221#phases — Phase 0(b): batched release SQL rechecks; the
    // per-row authoritative derivation, digest checks, and all-or-nothing
    // release semantics remain unchanged.
    let retained_sources = load_candidate_sources(
        conn,
        &table.name,
        index,
        generation,
        &partition,
        &candidate_ids,
    )?;
    let mut authoritative_rows = load_authoritative_rows(conn, table, &candidate_ids)?;
    let mut sources = Vec::new();
    for source in retained_sources {
        // @ref LLP 0073#authorization-and-result-release — release replays the
        // canonical derivation from the authoritative row, rather than trusting
        // even well-formed stored/filter/source-field/token payloads.
        let authoritative = authoritative_rows
            .remove(&source.row_id)
            .ok_or_else(|| {
                diagnostic(
                    "SNAPBACK_SEARCH_INDEX_CORRUPT",
                    "search posting references a missing authoritative source row",
                )
            })
            .and_then(|row| {
                authoritative_indexed_source(index, &source.row_id, &row).map_err(|_| {
                    diagnostic(
                        "SNAPBACK_SEARCH_INDEX_CORRUPT",
                        "search source cannot be reproduced from its authoritative row",
                    )
                })
            })?;
        // The recheck compares RFC 8785 canonical content digests, not struct
        // representation: an integral Real spells `5` in a retained source
        // record but reloads from SQLite as `5.0`, and both canonicalize to
        // "5". The stored record must match its own digest (tamper) and that
        // digest must match the authoritative derivation (drift); the released
        // page then uses the authoritative derivation, never the stored bytes.
        let source_digest = live_source_content_digest(
            &source.row_id,
            source.source_version,
            &source.partition,
            &source.stored,
            &source.filters,
            &source.source_fields,
            &source.tokens,
        )?;
        if source_digest != source.content_digest
            || source.content_digest != authoritative.content_digest
        {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_INDEX_CORRUPT",
                "search source content failed its authoritative digest recheck",
            ));
        }
        sources.push(authoritative);
    }

    let mut ranked = Vec::<(u32, IndexedSource, Vec<SearchOccurrence>)>::new();
    for source in sources {
        if source.partition != partition {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_INDEX_CORRUPT",
                "search source partition disagrees with its access key",
            ));
        }
        let filters_match = query.all.iter().all(|clause| match clause {
            SearchClauseV1::Filter(filter) => source
                .filters
                .get(&filter.field)
                .is_some_and(|stored| filter.value.matches_value(stored)),
            _ => true,
        });
        if !filters_match {
            continue;
        }
        let mut score = 0_u32;
        let mut matched_occurrences = Vec::<SearchOccurrence>::new();
        let mut required_match = true;
        for clause in &query.all {
            if let Some(atom) = clause_atom(clause) {
                let terms = atom_tokens(&atom)?;
                let (matches, occurrences) = atom_matches(&atom, &terms, &source)?;
                required_match &= matches;
                if matches {
                    score = score
                        .checked_add(atom_score(index, &atom, &terms, &source.tokens))
                        .ok_or_else(|| {
                            diagnostic("SNAPBACK_SEARCH_INDEX_CORRUPT", "score overflow")
                        })?;
                    matched_occurrences.extend(occurrences);
                }
            } else if let SearchClauseV1::Any(atoms) = clause {
                let mut any_match = false;
                for atom in atoms {
                    let terms = atom_tokens(atom)?;
                    let (matches, occurrences) = atom_matches(atom, &terms, &source)?;
                    if matches {
                        any_match = true;
                        score = score
                            .checked_add(atom_score(index, atom, &terms, &source.tokens))
                            .ok_or_else(|| {
                                diagnostic("SNAPBACK_SEARCH_INDEX_CORRUPT", "score overflow")
                            })?;
                        matched_occurrences.extend(occurrences);
                    }
                }
                required_match &= any_match;
            } else if let SearchClauseV1::Not(atom) = clause {
                let terms = atom_tokens(atom)?;
                required_match &= !atom_matches(atom, &terms, &source)?.0;
            }
        }
        if required_match {
            ranked.push((score, source, matched_occurrences));
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
        // Current authoritative source version/visibility recheck in this pinned
        // snapshot. A mismatch is drift: no partial page is released.
        let quoted = crate::storage::quote_ident(&table.name)?;
        let current: Option<(u64, Option<String>)> = conn
            .query_row(
                &format!(
                    "SELECT \"_version\", {} FROM {quoted} WHERE \"_id\"=?1",
                    match &index.visibility {
                        SearchVisibilityV1::Owner { field } => crate::storage::quote_ident(field)?,
                        SearchVisibilityV1::Membership { resource_field, .. } => {
                            crate::storage::quote_ident(resource_field)?
                        }
                        SearchVisibilityV1::PublicRead => "NULL".to_owned(),
                    }
                ),
                params![source.row_id],
                |row| Ok((row.get::<_, i64>(0)? as u64, row.get(1)?)),
            )
            .optional()?;
        let current_partition =
            current
                .as_ref()
                .and_then(|(_, value)| value.as_ref())
                .map(|value| match &index.visibility {
                    SearchVisibilityV1::Owner { .. } => format!("owner:{value}"),
                    SearchVisibilityV1::Membership { .. } => format!("membership:{value}"),
                    SearchVisibilityV1::PublicRead => unreachable!("public selects NULL"),
                });
        if current.as_ref().map(|(version, _)| *version) != Some(source.source_version)
            || !matches!(&index.visibility, SearchVisibilityV1::PublicRead)
                && current_partition.as_deref() != Some(partition.as_str())
        {
            return Err(diagnostic(
                "SNAPBACK_SEARCH_INDEX_CORRUPT",
                "search posting failed current authoritative source recheck",
            ));
        }
        items.push(SearchItemV1 {
            row_id: source.row_id.clone(),
            score: *score,
            fields: source.stored.clone(),
            highlights: highlights(
                &index.highlight_fields,
                &source.source_fields,
                matched_tokens,
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
                    membership_resource: membership_resource.clone(),
                    membership_declaration: membership_declaration.clone(),
                    membership_roles: membership_roles.clone(),
                    authorization_incarnation: authorization_incarnation.clone(),
                    authorization_epoch,
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
    use crate::manifest::{
        FieldManifest, FieldType, MembershipManifest, MembershipOp, MembershipScope,
        MembershipTarget, MembershipTransition, SeedData,
    };
    use crate::storage::{LocalDatabase, MembershipWriter};
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    fn search_schema(visibility: SearchVisibilityV1) -> SchemaManifest {
        let classification = if matches!(visibility, SearchVisibilityV1::PublicRead) {
            SearchFieldClassV1::Public
        } else {
            SearchFieldClassV1::Private
        };
        let mut field_classifications = BTreeMap::from([
            ("owner".to_owned(), classification),
            ("status".to_owned(), classification),
        ]);
        if matches!(visibility, SearchVisibilityV1::Membership { .. }) {
            field_classifications.insert("resource".to_owned(), classification);
        }
        SchemaManifest {
            required_capabilities: vec![SEARCH_CAPABILITY.to_owned()],
            tables: vec![
                TableManifest {
                    name: "incidents".to_owned(),
                    fields: ["title", "summary", "status", "owner", "resource"]
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
                        field_classifications,
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
                        live_limits: None,
                    }],
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    syncable: false,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
                    history: None,
                },
                TableManifest {
                    name: "rooms".to_owned(),
                    fields: vec![FieldManifest {
                        name: "name".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
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
                },
                TableManifest {
                    name: "room_members".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "userId".to_owned(),
                            field_type: FieldType::Principal,
                            optional: false,
                        },
                        FieldManifest {
                            name: "roomId".to_owned(),
                            field_type: FieldType::Id {
                                table: "rooms".to_owned(),
                            },
                            optional: false,
                        },
                        FieldManifest {
                            name: "role".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                    ],
                    indexes: Vec::new(),
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    syncable: false,
                    permission_backing: false,
                    permission_fields: None,
                    membership: Some(MembershipManifest {
                        id: Some("roomMembers".to_owned()),
                        principal: "userId".to_owned(),
                        resource: Some("roomId".to_owned()),
                        role: "role".to_owned(),
                        roles: vec!["owner".to_owned(), "member".to_owned()],
                        pending_roles: Some(vec!["invited".to_owned()]),
                        bootstrap_role: None,
                        last_holder: None,
                        expiry: None,
                        incidental: None,
                        provenance: None,
                        transitions: vec![MembershipTransition {
                            op: MembershipOp::Remove,
                            by: vec!["self".to_owned()],
                            target: MembershipTarget::Own,
                            from: None,
                            to: None,
                            fields: None,
                        }],
                        scope: MembershipScope::Resource,
                        resource_table: Some("rooms".to_owned()),
                        principal_addressed_writes: None,
                    }),
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
            ],
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
                ,"resource": "room-a"
            }),
            json!({
                "_id": "incident-2",
                "title": "Checkout degraded",
                "summary": "Payment latency",
                "status": "open",
                "owner": "alice"
                ,"resource": "room-a"
            }),
            json!({
                "_id": "incident-3",
                "title": bob_title,
                "summary": "API latency",
                "status": "open",
                "owner": "bob"
                ,"resource": "room-a"
            }),
            json!({
                "_id": "incident-4",
                "title": "Resolved checkout",
                "summary": "Historical incident",
                "status": "resolved",
                "owner": "alice"
                ,"resource": "room-b"
            }),
        ]
        .into_iter()
        .map(|value| value.as_object().expect("seed object").clone())
        .collect();
        SeedData {
            tables: BTreeMap::from([
                ("incidents".to_owned(), rows),
                (
                    "rooms".to_owned(),
                    vec![
                        json!({"_id": "room-a", "name": "Room A"})
                            .as_object()
                            .unwrap()
                            .clone(),
                        json!({"_id": "room-b", "name": "Room B"})
                            .as_object()
                            .unwrap()
                            .clone(),
                    ],
                ),
            ]),
        }
    }

    fn seeded(visibility: SearchVisibilityV1) -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(search_schema(visibility))
            .expect("apply search schema");
        db.schema_seed()
            .seed(fixture_seed("Checkout outage"))
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
        db.schema_seed()
            .apply_schema(search_schema(visibility))
            .expect("apply search schema");
        db.schema_seed()
            .seed(fixture_seed(bob_title))
            .expect("seed indexed rows");
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
                            op: SearchFilterOpV1::Eq,
                            value: SearchFilterValueV1::String("open".to_owned()),
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

    fn membership_visibility(roles: Option<Vec<String>>) -> SearchVisibilityV1 {
        SearchVisibilityV1::Membership {
            declaration: "roomMembers".to_owned(),
            resource_field: "resource".to_owned(),
            roles,
        }
    }

    fn membership_request(resource: &str, after: Option<String>, limit: u32) -> HandlerInput {
        let mut input = request(after, limit);
        input
            .args
            .as_object_mut()
            .expect("request object")
            .insert("resourceId".to_owned(), json!(resource));
        input
    }

    fn search_page(output: QueryOutput) -> SearchPageV1 {
        SearchPageV1 {
            items: output
                .rows
                .into_iter()
                .map(|row| serde_json::from_value(row).expect("search item"))
                .collect(),
            has_more: output.cursor.is_some(),
            cursor: output.cursor,
        }
    }

    fn grant_seat(db: &mut LocalDatabase, principal: &str, resource: &str, role: &str) -> String {
        let writer = MembershipWriter::Admin;
        let plan = db
            .membership_plans()
            .plan_privileged_membership_insert(
                &writer,
                "room_members",
                Map::from_iter([
                    ("userId".to_owned(), json!(principal)),
                    ("roomId".to_owned(), json!(resource)),
                    ("role".to_owned(), json!(role)),
                ]),
            )
            .expect("plan membership seat");
        let commit = db
            .membership_plans()
            .commit_membership_plan(&writer, plan)
            .expect("commit membership seat");
        commit
            .changes
            .iter()
            .find(|change| change.table == "room_members")
            .expect("membership insert change")
            .id
            .clone()
    }

    fn revoke_own_seat(db: &mut LocalDatabase, principal: &str, member_id: &str) {
        let writer = MembershipWriter::User {
            effective_principal: principal.to_owned(),
        };
        let plan = db
            .membership_plans()
            .plan_membership_remove(&writer, "room_members", member_id)
            .expect("plan membership revocation");
        db.membership_plans()
            .commit_membership_plan(&writer, plan)
            .expect("commit membership revocation");
    }

    fn run(
        db: &LocalDatabase,
        input: &HandlerInput,
        owner_subject: Option<&str>,
    ) -> SnapbackResult<QueryOutput> {
        db.query_reads_read()
            .with_pinned_read_view(|view| run_view(&view, input, owner_subject))
    }

    fn run_view(
        view: &crate::storage::DbRead<'_>,
        input: &HandlerInput,
        owner_subject: Option<&str>,
    ) -> SnapbackResult<QueryOutput> {
        let resource_arg = view
            .schema()
            .table("incidents")
            .and_then(|table| table.search_indexes.first())
            .and_then(|index| {
                matches!(index.visibility, SearchVisibilityV1::Membership { .. })
                    .then_some("resourceId")
            });
        run_view_with_resource_arg(view, input, owner_subject, resource_arg)
    }

    fn run_view_with_resource_arg(
        view: &crate::storage::DbRead<'_>,
        input: &HandlerInput,
        owner_subject: Option<&str>,
        resource_arg: Option<&str>,
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
            resource_arg: resource_arg.map(ToOwned::to_owned),
        };
        view.search(&plan, input, &authority)
    }

    #[test]
    fn prefix_upper_bound_advances_the_last_available_unicode_scalar() {
        assert_eq!(prefix_upper_bound("abc"), Some("abd".to_owned()));
        assert_eq!(prefix_upper_bound("café"), Some("cafê".to_owned()));
        assert_eq!(
            prefix_upper_bound(&format!("a{}", char::MAX)),
            Some("b".to_owned())
        );
        assert_eq!(
            prefix_upper_bound(&format!("{}{}", char::MAX, char::MAX)),
            None
        );
        assert_eq!(prefix_upper_bound("\u{D7FF}"), Some("\u{E000}".to_owned()));
        assert_eq!(prefix_upper_bound(""), None);
    }

    #[test]
    fn prefix_candidate_plan_uses_anchor_token_range() {
        let db = seeded(SearchVisibilityV1::PublicRead);
        let details = db
            .query_reads_read()
            .with_pinned_read_view(|view| {
                let table = view.schema().table("incidents").expect("fixture table");
                let index = table.search_indexes.first().expect("fixture search index");
                let prefix = "check";
                let upper_bound = prefix_upper_bound(prefix).expect("bounded ASCII prefix");
                view.with_connection(|conn| {
                    let (generation, _, _) = active_generation(conn, &table.name, &index.name)?;
                    let mut statement = conn.prepare(&format!(
                        "EXPLAIN QUERY PLAN {PREFIX_CANDIDATES_BOUNDED_SQL}"
                    ))?;
                    let rows = statement.query_map(
                        params![
                            table.name,
                            index.name,
                            generation as i64,
                            "public",
                            prefix,
                            upper_bound,
                            Option::<String>::None,
                        ],
                        |row| row.get::<_, String>(3),
                    )?;
                    Ok(rows.collect::<Result<Vec<_>, _>>()?)
                })
            })
            .expect("explain prefix candidate query");

        assert!(
            details.iter().any(|detail| {
                detail.contains("SEARCH")
                    && detail.contains("_snapback_search_terms_anchor")
                    && (detail.contains("token>") || detail.contains("token<"))
            }),
            "prefix candidates must use the anchor index token range: {details:?}"
        );
        assert!(
            details
                .iter()
                .all(|detail| !detail.contains("SCAN _snapback_search_terms")),
            "prefix candidates must not full-scan search terms: {details:?}"
        );
    }

    #[test]
    fn phrase_matching_emits_one_complete_source_span() {
        let source_text = "alpha beta gamma";
        let source = IndexedSource {
            row_id: "incident-phrase".into(),
            source_version: 1,
            partition: "public".into(),
            stored: Map::new(),
            filters: Map::new(),
            source_fields: BTreeMap::from([("summary".into(), source_text.into())]),
            tokens: crate::search::analyzer::analyze_field("summary", source_text).unwrap(),
            content_digest: "unused-by-atom-matcher".into(),
        };
        let atom = SearchMatchAtomV1::Phrase(SearchPhraseV1 {
            values: vec!["alpha".into(), "beta".into()],
            field: Some("summary".into()),
        });
        let terms = atom_tokens(&atom).unwrap();
        let (matched, occurrences) = atom_matches(&atom, &terms, &source).unwrap();
        assert!(matched);
        assert_eq!(occurrences.len(), 1);
        assert_eq!(occurrences[0].source_start, 0);
        assert_eq!(occurrences[0].source_end, 10);

        let prefix = SearchMatchAtomV1::Prefix(SearchTermV1 {
            value: "alp".into(),
            field: Some("summary".into()),
        });
        let prefix_terms = atom_tokens(&prefix).unwrap();
        let (prefix_matched, prefix_occurrences) =
            atom_matches(&prefix, &prefix_terms, &source).unwrap();
        assert!(prefix_matched);
        assert_eq!(prefix_occurrences.len(), 1);
        assert_eq!(prefix_occurrences[0].source_start, 0);
        assert_eq!(
            prefix_occurrences[0].source_end, 5,
            "prefix highlights cover the complete source token"
        );
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
    fn official_mutation_verifies_and_reseals_the_generation() {
        let mut db = seeded(SearchVisibilityV1::PublicRead);
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![crate::storage::BufferedWrite::Patch {
                    table: "incidents".to_owned(),
                    id: "incident-1".to_owned(),
                    values: Map::from_iter([
                        (
                            "title".to_owned(),
                            Value::String("Recovered service".to_owned()),
                        ),
                        (
                            "summary".to_owned(),
                            Value::String("Everything is healthy".to_owned()),
                        ),
                    ]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("official search-source mutation");

        assert_eq!(
            run(&db, &request(None, 10), None)
                .expect("resealed checkout search")
                .rows
                .len(),
            2,
        );
        let recovered = run(&db, &request_for("recovered", None, 10), None)
            .expect("resealed replacement is searchable");
        assert_eq!(recovered.rows.len(), 1);
        assert_eq!(recovered.rows[0]["rowId"], "incident-1");
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
    fn membership_member_sees_cross_owner_matches_within_resource() {
        let mut db = seeded(membership_visibility(None));
        grant_seat(&mut db, "carol", "room-a", "member");

        let page = run(&db, &membership_request("room-a", None, 10), Some("carol"))
            .expect("member-visible search");
        let owners = page
            .rows
            .iter()
            .map(|row| row["fields"]["owner"].as_str().unwrap())
            .collect::<BTreeSet<_>>();
        assert_eq!(owners, BTreeSet::from(["alice", "bob"]));
        assert_eq!(page.rows.len(), 3);
    }

    #[test]
    fn membership_outsider_empty_is_byte_identical_to_nonexistent_resource() {
        let mut db = seeded(membership_visibility(None));
        grant_seat(&mut db, "alice", "room-a", "member");

        let outsider = search_page(
            run(
                &db,
                &membership_request("room-a", None, 10),
                Some("mallory"),
            )
            .expect("outsider gets empty success"),
        );
        let nonexistent = search_page(
            run(
                &db,
                &membership_request("room-missing", None, 10),
                Some("alice"),
            )
            .expect("nonexistent resource gets empty success"),
        );
        assert_eq!(
            serde_json::to_value(outsider).unwrap(),
            serde_json::to_value(nonexistent).unwrap()
        );
    }

    #[test]
    fn membership_revocation_zeroes_next_fresh_search() {
        let mut db = seeded(membership_visibility(None));
        let member_id = grant_seat(&mut db, "carol", "room-a", "member");
        assert_eq!(
            run(&db, &membership_request("room-a", None, 10), Some("carol"))
                .expect("seated search")
                .rows
                .len(),
            3
        );

        revoke_own_seat(&mut db, "carol", &member_id);
        let revoked = search_page(
            run(&db, &membership_request("room-a", None, 10), Some("carol"))
                .expect("revoked search is empty success"),
        );
        let outsider = search_page(
            run(
                &db,
                &membership_request("room-a", None, 10),
                Some("mallory"),
            )
            .expect("outsider search is empty success"),
        );
        assert_eq!(
            serde_json::to_value(revoked).unwrap(),
            serde_json::to_value(outsider).unwrap()
        );
    }

    #[test]
    fn membership_stale_cursor_after_revocation_is_uniform_restart() {
        let mut db = seeded(membership_visibility(None));
        let member_id = grant_seat(&mut db, "carol", "room-a", "member");
        let first = run(&db, &membership_request("room-a", None, 1), Some("carol"))
            .expect("first member page");
        let cursor = first.cursor.expect("member continuation");

        revoke_own_seat(&mut db, "carol", &member_id);
        let stale = run(
            &db,
            &membership_request("room-a", Some(cursor), 1),
            Some("carol"),
        )
        .expect_err("revoked continuation restarts");
        let garbage = run(
            &db,
            &membership_request("room-a", Some("garbage".to_owned()), 1),
            Some("carol"),
        )
        .expect_err("garbage continuation restarts");
        assert_eq!(stale.diagnostic.code, "SNAPBACK_SEARCH_CURSOR_RESTART");
        assert_eq!(
            serde_json::to_vec(&stale).unwrap(),
            serde_json::to_vec(&garbage).unwrap()
        );
    }

    #[test]
    fn membership_partition_is_pushed_down_and_bound_into_cursors() {
        let mut db = seeded(membership_visibility(None));
        grant_seat(&mut db, "carol", "room-a", "member");
        grant_seat(&mut db, "carol", "room-b", "member");
        let room_a =
            run(&db, &membership_request("room-a", None, 1), Some("carol")).expect("room-a page");
        assert_eq!(room_a.rows.len(), 1);
        let cursor = room_a.cursor.expect("room-a continuation");
        assert!(
            run(&db, &membership_request("room-b", None, 10), Some("carol"))
                .expect("room-b partition")
                .rows
                .is_empty(),
            "room-a matches must not be traversed through room-b"
        );

        let error = run(
            &db,
            &membership_request("room-b", Some(cursor), 1),
            Some("carol"),
        )
        .expect_err("resource-bound cursor");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_CURSOR_RESTART");
    }

    #[test]
    fn membership_roles_filter_admits_only_listed_roles() {
        let mut member_db = seeded(membership_visibility(Some(vec!["owner".to_owned()])));
        grant_seat(&mut member_db, "carol", "room-a", "member");
        assert!(
            run(
                &member_db,
                &membership_request("room-a", None, 10),
                Some("carol")
            )
            .expect("wrong-role empty success")
            .rows
            .is_empty()
        );

        let mut owner_db = seeded(membership_visibility(Some(vec!["owner".to_owned()])));
        grant_seat(&mut owner_db, "carol", "room-a", "owner");
        assert_eq!(
            run(
                &owner_db,
                &membership_request("room-a", None, 10),
                Some("carol")
            )
            .expect("listed-role search")
            .rows
            .len(),
            3
        );
    }

    #[test]
    fn classifications_are_closed_and_manifest_changes_rebuild_then_purge() {
        assert!(
            serde_json::from_value::<SearchTextFieldV1>(json!({ "weight": 8 })).is_err(),
            "omitting a text-field classification must not silently become public"
        );
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
            .schema_seed()
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
        db.schema_seed()
            .apply_schema(changed)
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
    fn replacement_source_limit_counts_old_and_new_postings() {
        let mut conn = Connection::open_in_memory().expect("search maintenance fixture");
        create_infra(&conn).expect("create derived-search tables");
        let mut schema = search_schema(SearchVisibilityV1::PublicRead);
        let index = &mut schema.tables[0].search_indexes[0];
        index.source_limits.max_posting_operations = 1;
        let index = index.clone();
        let row = json!({
            "title": "checkout",
            "summary": "",
            "status": "open",
            "owner": "alice"
        });
        let tx = conn.transaction().expect("begin maintenance");
        replace_source(
            &tx,
            SourceReplacement {
                table: "incidents",
                index: &index,
                generation: 1,
                row_id: "incident-1",
                source_version: 1,
                row: Some(&row),
            },
            &mut MaintenanceCounters::default(),
        )
        .expect("initial source has one posting operation");
        let error = replace_source(
            &tx,
            SourceReplacement {
                table: "incidents",
                index: &index,
                generation: 1,
                row_id: "incident-1",
                source_version: 2,
                row: Some(&row),
            },
            &mut MaintenanceCounters::default(),
        )
        .expect_err("replacement must count the deleted and inserted posting");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_SOURCE_LIMIT");
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
    fn malformed_derived_source_payload_refuses_instead_of_losing_matches() {
        let (_directory, path, db) = file_seeded(SearchVisibilityV1::PublicRead, "Checkout outage");
        drop(db);
        let raw = Connection::open(&path).expect("open corruption fixture");
        raw.execute(
            "UPDATE _snapback_search_sources SET tokens_json='[{\"field\":\"title\"}]'
             WHERE table_name='incidents' AND index_name='search_incidents'
               AND row_id='incident-1'",
            [],
        )
        .expect("malform a retained source payload");
        drop(raw);

        let corrupt = LocalDatabase::open(&path).expect("open corrupt derived index");
        let error = run(&corrupt, &request(None, 10), None)
            .expect_err("malformed derived payload must fail closed");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_INDEX_CORRUPT");
    }

    #[test]
    fn well_formed_token_tamper_cannot_create_a_search_result() {
        let (_directory, path, db) = file_seeded(SearchVisibilityV1::PublicRead, "Checkout outage");
        drop(db);
        let raw = Connection::open(&path).expect("open token-tamper fixture");
        raw.execute(
            "UPDATE _snapback_search_sources
             SET tokens_json='[{\"field\":\"title\",\"token\":\"forgedneedle\",\"position\":0,\"sourceStart\":0,\"sourceEnd\":12}]'
             WHERE table_name='incidents' AND index_name='search_incidents'
               AND row_id='incident-3'",
            [],
        )
        .expect("replace source tokens with a well-formed forged token");
        raw.execute(
            "UPDATE _snapback_search_terms
             SET token='forgedneedle',source_start=0,source_end=12
             WHERE table_name='incidents' AND index_name='search_incidents'
               AND row_id='incident-3' AND field_name='title' AND position=0",
            [],
        )
        .expect("forge a matching posting anchor");
        // Exercise the independent source-content authentication even if an
        // operator mistakenly clears the trigger-owned quarantine marker.
        raw.execute(
            "UPDATE _snapback_search_generations
             SET status='active',corruption_reason=NULL
             WHERE table_name='incidents' AND index_name='search_incidents'",
            [],
        )
        .expect("simulate an incorrectly cleared quarantine marker");
        drop(raw);

        let corrupt = LocalDatabase::open(&path).expect("open token-tampered index");
        let error = run(&corrupt, &request_for("forgedneedle", None, 10), None)
            .expect_err("well-formed forged tokens must fail authoritative recheck");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_INDEX_CORRUPT");
    }

    #[test]
    fn well_formed_stored_field_tamper_cannot_escape() {
        let (_directory, path, db) = file_seeded(SearchVisibilityV1::PublicRead, "Checkout outage");
        drop(db);
        let raw = Connection::open(&path).expect("open stored-field-tamper fixture");
        raw.execute(
            "UPDATE _snapback_search_sources
             SET row_json='{\"owner\":\"mallory\",\"status\":\"open\",\"summary\":\"Checkout is slow\",\"title\":\"Forged stored title\"}'
             WHERE table_name='incidents' AND index_name='search_incidents'
               AND row_id='incident-1'",
            [],
        )
        .expect("replace stored projection with a well-formed forged object");
        raw.execute(
            "UPDATE _snapback_search_generations
             SET status='active',corruption_reason=NULL
             WHERE table_name='incidents' AND index_name='search_incidents'",
            [],
        )
        .expect("simulate an incorrectly cleared quarantine marker");
        drop(raw);

        let corrupt = LocalDatabase::open(&path).expect("open stored-field-tampered index");
        let error = run(&corrupt, &request(None, 10), None)
            .expect_err("well-formed stored projection tamper must fail authoritative recheck");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_INDEX_CORRUPT");
    }

    #[test]
    fn omitted_non_candidate_posting_quarantines_the_generation() {
        let (_directory, path, db) = file_seeded(SearchVisibilityV1::PublicRead, "Checkout outage");
        drop(db);
        let raw = Connection::open(&path).expect("open omitted-posting fixture");
        assert_eq!(
            raw.execute(
                "DELETE FROM _snapback_search_terms
                 WHERE table_name='incidents' AND index_name='search_incidents'
                   AND row_id='incident-4' AND token='historical'",
                [],
            )
            .expect("remove a posting outside the requested candidate set"),
            1
        );
        drop(raw);

        let mut corrupt = LocalDatabase::open(&path).expect("open posting-omitted index");
        let error = run(&corrupt, &request_for("latency", None, 10), None)
            .expect_err("a dirty generation must refuse before candidate routing");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_INDEX_CORRUPT");
        let maintenance = corrupt
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![crate::storage::BufferedWrite::Patch {
                    table: "incidents".to_owned(),
                    id: "incident-1".to_owned(),
                    values: Map::from_iter([(
                        "status".to_owned(),
                        Value::String("resolved".to_owned()),
                    )]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("ordinary maintenance must not clear a pre-existing quarantine");
        assert_eq!(maintenance.diagnostic.code, "SNAPBACK_SEARCH_INDEX_CORRUPT");
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
    fn paired_membership_observations_do_not_reveal_other_resource_matches() {
        let (_left_dir, _left_path, mut left) =
            file_seeded(membership_visibility(None), "Checkout outage");
        let (_right_dir, _right_path, mut right) =
            file_seeded(membership_visibility(None), "Checkout outage");
        grant_seat(&mut left, "carol", "room-a", "member");
        grant_seat(&mut right, "carol", "room-a", "member");
        right
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![crate::storage::BufferedWrite::Patch {
                    table: "incidents".to_owned(),
                    id: "incident-4".to_owned(),
                    values: Map::from_iter([
                        ("title".to_owned(), json!("Checkout hidden room")),
                        ("summary".to_owned(), json!("Checkout hidden match")),
                        ("status".to_owned(), json!("open")),
                    ]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("add hidden other-resource match");

        let input = membership_request("room-a", None, 1);
        let left_page = run(&left, &input, Some("carol")).expect("left member page");
        let right_page = run(&right, &input, Some("carol")).expect("right member page");
        assert_eq!(left_page.rows, right_page.rows);
        assert_eq!(left_page.cursor.is_some(), right_page.cursor.is_some());
        assert_eq!(
            left_page.cursor.as_ref().map(String::len),
            right_page.cursor.as_ref().map(String::len)
        );
    }

    #[test]
    fn membership_visibility_validation_refuses_invalid_declarations_and_roles() {
        let assert_invalid = |schema: &SchemaManifest| {
            let table = schema.table("incidents").unwrap();
            let error = validate_index_declaration(schema, table, &table.search_indexes[0])
                .expect_err("invalid membership search declaration");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID"
            );
        };

        let mut unknown = search_schema(membership_visibility(None));
        if let SearchVisibilityV1::Membership { declaration, .. } =
            &mut unknown.tables[0].search_indexes[0].visibility
        {
            *declaration = "missingDeclaration".to_owned();
        }
        assert_invalid(&unknown);

        let mut app_scoped = search_schema(membership_visibility(None));
        let membership = app_scoped.tables[2].membership.as_mut().unwrap();
        membership.scope = MembershipScope::App;
        membership.resource = None;
        membership.resource_table = None;
        assert_invalid(&app_scoped);

        let outside_roles =
            search_schema(membership_visibility(Some(vec!["moderator".to_owned()])));
        assert_invalid(&outside_roles);
    }

    #[test]
    fn membership_visibility_without_resource_arg_is_refused() {
        let db = seeded(membership_visibility(None));
        let error = db
            .query_reads_read()
            .with_pinned_read_view(|view| {
                run_view_with_resource_arg(
                    &view,
                    &membership_request("room-a", None, 10),
                    Some("carol"),
                    None,
                )
            })
            .expect_err("membership search plan without resourceArg");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_QUERY_INVALID");
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
                reader.query_reads_read().with_pinned_read_view(|view| {
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
                .schema_seed()
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
        db.schema_seed()
            .apply_schema(search_schema(SearchVisibilityV1::PublicRead))
            .expect("large corpus schema");
        let rows = (0..CORPUS_ROWS)
            .map(|index| {
                json!({
                    "_id": format!("incident-{index:04}"),
                    "title": "Needle checkout",
                    "summary": format!("deterministic corpus row {index:04}"),
                    "status": "open",
                    "owner": "alice",
                    "resource": "room-a"
                })
                .as_object()
                .unwrap()
                .clone()
            })
            .collect();
        let build_started = Instant::now();
        db.schema_seed()
            .seed(SeedData {
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

    #[test]
    fn membership_prefix_search_stays_within_local_sqlite_scale_budget() {
        const CORPUS_ROWS: usize = 2_000;
        const BUILD_CHUNK_ROWS: usize = 200;
        const BUILD_BUDGET: Duration = Duration::from_secs(30);
        // Every corpus row matches the prefix, so this query's cost is
        // dominated by the semantic per-candidate authoritative re-derivation
        // that release requires (LLP 0073 §Authorization and result release),
        // not by posting traversal: a debug build spends roughly a second on
        // 2k candidates. The budget guards order-of-magnitude regressions in
        // the batched release path; the sargability guarantee itself is pinned
        // deterministically by `prefix_candidate_plan_uses_anchor_token_range`
        // and by `selective_prefix_membership_query_is_fast_at_scale` below.
        const QUERY_BUDGET: Duration = Duration::from_secs(5);

        let build_started = Instant::now();
        let mut db = LocalDatabase::memory().expect("membership scale database");
        db.schema_seed()
            .apply_schema(search_schema(membership_visibility(None)))
            .expect("membership scale schema");
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "rooms".to_owned(),
                    vec![
                        json!({"_id": "room-scale", "name": "Scale room"})
                            .as_object()
                            .expect("room object")
                            .clone(),
                    ],
                )]),
            })
            .expect("membership scale resource");
        grant_seat(&mut db, "carol", "room-scale", "member");
        for start in (0..CORPUS_ROWS).step_by(BUILD_CHUNK_ROWS) {
            let end = (start + BUILD_CHUNK_ROWS).min(CORPUS_ROWS);
            let rows = (start..end)
                .map(|row| {
                    json!({
                        "_id": format!("message-{row:04}"),
                        "title": format!("sharedprefix{:02} alpha beta", row % 32),
                        "summary": format!("deterministic membership message {row:04}"),
                        "status": "open",
                        "owner": "alice",
                        "resource": "room-scale"
                    })
                    .as_object()
                    .expect("message object")
                    .clone()
                })
                .collect();
            db.schema_seed()
                .seed(SeedData {
                    tables: BTreeMap::from([("incidents".to_owned(), rows)]),
                })
                .expect("membership scale corpus chunk");
        }
        let build_elapsed = build_started.elapsed();
        assert!(
            build_elapsed <= BUILD_BUDGET,
            "membership scale build exceeded preregistered budget: {build_elapsed:?}"
        );

        let mut input = HandlerInput {
            args: serde_json::to_value(SearchRequestV1 {
                query: SearchQueryAstV1 {
                    all: vec![SearchClauseV1::Prefix(SearchTermV1 {
                        value: "shared".to_owned(),
                        field: None,
                    })],
                },
                limit: Some(50),
                after: None,
            })
            .expect("prefix request serializes"),
            ..HandlerInput::default()
        };
        input
            .args
            .as_object_mut()
            .expect("membership request object")
            .insert("resourceId".to_owned(), json!("room-scale"));

        let query_started = Instant::now();
        let page = run(&db, &input, Some("carol")).expect("membership prefix scale query");
        let query_elapsed = query_started.elapsed();
        eprintln!(
            "membership prefix scale: rows={CORPUS_ROWS} build={build_elapsed:?} query={query_elapsed:?}"
        );
        assert!(
            query_elapsed <= QUERY_BUDGET,
            "membership prefix query exceeded preregistered budget: {query_elapsed:?}"
        );
        assert_eq!(page.rows.len(), 50);
        assert!(page.cursor.is_some());
        assert_eq!(
            page.rows
                .iter()
                .map(|row| row["rowId"].as_str().unwrap_or_default().to_owned())
                .collect::<Vec<_>>(),
            (0..50)
                .map(|row| format!("message-{row:04}"))
                .collect::<Vec<_>>()
        );
    }

    /// A scaled-down cut of the Clique pilot defect envelope
    /// (`issues/closed/20260809-membership-search-envelope-latency.md`): a
    /// per-partition posting vocabulary where the query prefix matches only a
    /// small slice. Before the Phase 0(b) fix the two prefix predicates used
    /// `substr(token,1,length(?))=?`, forcing a full token scan of the
    /// partition per query; the half-open range seeks instead. At this
    /// committed size the scan itself is cheap — the budget here pins
    /// correctness and absence of regression, while the sargability witness
    /// is the EXPLAIN plan gate above. The timed query takes the minimum of
    /// five runs to shed scheduler noise.
    /// @ref LLP 0221#phases — Phase 0(b) proof: selective-prefix fixture
    /// evidence; the plan gate is the durable scan/seek witness.
    #[test]
    fn selective_prefix_membership_query_is_fast_at_scale() {
        const CORPUS_ROWS: usize = 4_000;
        const NEEDLE_STRIDE: usize = 80;
        const BUILD_CHUNK_ROWS: usize = 200;
        const BUILD_BUDGET: Duration = Duration::from_secs(90);
        const QUERY_RUNS: usize = 5;
        const QUERY_BUDGET: Duration = Duration::from_secs(1);

        let build_started = Instant::now();
        let mut db = LocalDatabase::memory().expect("selective scale database");
        db.schema_seed()
            .apply_schema(search_schema(membership_visibility(None)))
            .expect("selective scale schema");
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "rooms".to_owned(),
                    vec![
                        json!({"_id": "room-scale", "name": "Scale room"})
                            .as_object()
                            .expect("room object")
                            .clone(),
                    ],
                )]),
            })
            .expect("selective scale resource");
        grant_seat(&mut db, "carol", "room-scale", "member");
        for start in (0..CORPUS_ROWS).step_by(BUILD_CHUNK_ROWS) {
            let end = (start + BUILD_CHUNK_ROWS).min(CORPUS_ROWS);
            let rows = (start..end)
                .map(|row| {
                    let mut title =
                        format!("filler{row:04}a filler{row:04}b filler{row:04}c filler{row:04}d");
                    if row % NEEDLE_STRIDE == 0 {
                        title.push_str(&format!(" needleword{row:04}"));
                    }
                    json!({
                        "_id": format!("message-{row:04}"),
                        "title": title,
                        "summary": format!("deterministic selective message {row:04}"),
                        "status": "open",
                        "owner": "alice",
                        "resource": "room-scale"
                    })
                    .as_object()
                    .expect("message object")
                    .clone()
                })
                .collect();
            db.schema_seed()
                .seed(SeedData {
                    tables: BTreeMap::from([("incidents".to_owned(), rows)]),
                })
                .expect("selective scale corpus chunk");
        }
        let build_elapsed = build_started.elapsed();
        assert!(
            build_elapsed <= BUILD_BUDGET,
            "selective scale build exceeded preregistered budget: {build_elapsed:?}"
        );

        let mut input = HandlerInput {
            args: serde_json::to_value(SearchRequestV1 {
                query: SearchQueryAstV1 {
                    all: vec![SearchClauseV1::Prefix(SearchTermV1 {
                        value: "needle".to_owned(),
                        field: None,
                    })],
                },
                limit: Some(50),
                after: None,
            })
            .expect("selective prefix request serializes"),
            ..HandlerInput::default()
        };
        input
            .args
            .as_object_mut()
            .expect("membership request object")
            .insert("resourceId".to_owned(), json!("room-scale"));

        let mut best = Duration::MAX;
        let mut page = None;
        for _ in 0..QUERY_RUNS {
            let query_started = Instant::now();
            let result = run(&db, &input, Some("carol")).expect("selective prefix scale query");
            best = best.min(query_started.elapsed());
            page = Some(result);
        }
        let page = page.expect("at least one query run");
        eprintln!(
            "selective prefix scale: rows={CORPUS_ROWS} matches={} build={build_elapsed:?} best-of-{QUERY_RUNS} query={best:?}",
            CORPUS_ROWS / NEEDLE_STRIDE
        );
        assert!(
            best <= QUERY_BUDGET,
            "selective prefix query exceeded preregistered budget: {best:?}"
        );
        assert_eq!(page.rows.len(), CORPUS_ROWS / NEEDLE_STRIDE);
        assert!(page.cursor.is_none());
        assert_eq!(
            page.rows
                .iter()
                .map(|row| row["rowId"].as_str().unwrap_or_default().to_owned())
                .collect::<Vec<_>>(),
            (0..CORPUS_ROWS)
                .step_by(NEEDLE_STRIDE)
                .map(|row| format!("message-{row:04}"))
                .collect::<Vec<_>>()
        );
    }

    /// Reuses the fixture table/index names so the shared `run` plan applies,
    /// but declares a `Real` field participating as a stored field. (A `Real`
    /// equality filter is rejected at declaration time — "must use a portable
    /// exact scalar type" — so stored fields are the whole Real surface.)
    fn real_field_schema() -> SchemaManifest {
        SchemaManifest {
            required_capabilities: vec![SEARCH_CAPABILITY.to_owned()],
            tables: vec![TableManifest {
                name: "incidents".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "title".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "minutes".to_owned(),
                        field_type: FieldType::Real,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                search_indexes: vec![SearchIndexManifestV1 {
                    format_version: 1,
                    name: "search_incidents".to_owned(),
                    semantic_version: "incident-search.v1".to_owned(),
                    analyzer: SEARCH_ANALYZER.to_owned(),
                    analyzer_tables_digest:
                        crate::search::unicode17_generated::ANALYZER_TABLES_DIGEST.to_owned(),
                    text_fields: BTreeMap::from([(
                        "title".to_owned(),
                        SearchTextFieldV1 {
                            weight: 8,
                            classification: SearchFieldClassV1::Public,
                        },
                    )]),
                    field_classifications: BTreeMap::from([(
                        "minutes".to_owned(),
                        SearchFieldClassV1::Public,
                    )]),
                    equality_filters: Vec::new(),
                    stored_fields: vec!["minutes".to_owned(), "title".to_owned()],
                    highlight_fields: vec!["title".to_owned()],
                    visibility: SearchVisibilityV1::PublicRead,
                    tie_break: "score-desc-row-id-asc.v1".to_owned(),
                    source_limits: Default::default(),
                    query_limits: Default::default(),
                    cursor_limits: Default::default(),
                    maintenance_limits: Default::default(),
                    live_limits: None,
                }],
                vector_indexes: Vec::new(),
                search_live_limits: None,
                syncable: false,
                permission_backing: false,
                permission_fields: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
                history: None,
            }],
            ..SchemaManifest::default()
        }
    }

    fn term_request(term: &str) -> HandlerInput {
        HandlerInput {
            args: serde_json::to_value(SearchRequestV1 {
                query: SearchQueryAstV1 {
                    all: vec![SearchClauseV1::Term(SearchTermV1 {
                        value: term.to_owned(),
                        field: None,
                    })],
                },
                limit: Some(10),
                after: None,
            })
            .expect("request serializes"),
            ..HandlerInput::default()
        }
    }

    #[test]
    fn integral_real_stored_and_filter_values_release_from_the_insert_path() {
        // Regression for issues/20260730-search-real-integral-digest-corruption:
        // insert/seed-maintained rows keep the in-memory document, so an
        // integral value in a Real field must not read as index corruption at
        // authoritative release.
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(real_field_schema())
            .expect("apply real-field search schema");
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "incidents".to_owned(),
                    vec![
                        json!({"_id": "recipe-1", "title": "Skillet lasagna", "minutes": 5})
                            .as_object()
                            .unwrap()
                            .clone(),
                        json!({"_id": "recipe-2", "title": "Lasagna soup", "minutes": 7.5})
                            .as_object()
                            .unwrap()
                            .clone(),
                    ],
                )]),
            })
            .expect("seed integral and fractional Real rows");
        let page = run(&db, &term_request("lasagna"), None)
            .expect("integral Real stored/filter values must release");
        assert_eq!(page.rows.len(), 2);
        let minutes = page
            .rows
            .iter()
            .map(|row| {
                (
                    row["rowId"].as_str().unwrap(),
                    row["fields"]["minutes"].clone(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        assert_eq!(minutes["recipe-1"], json!(5.0));
        assert_eq!(minutes["recipe-2"], json!(7.5));

        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![crate::storage::BufferedWrite::Insert {
                    table: "incidents".to_owned(),
                    id: "recipe-3".to_owned(),
                    values: Map::from_iter([
                        ("title".to_owned(), Value::String("Lasagna bake".to_owned())),
                        ("minutes".to_owned(), json!(45)),
                    ]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("official insert of an integral Real value");
        let page = run(&db, &term_request("lasagna"), None)
            .expect("insert-maintained integral Real row must release");
        assert_eq!(page.rows.len(), 3);
    }

    #[test]
    fn legacy_integral_spelling_in_source_records_still_releases() {
        // Pre-normalization databases retain source records whose stored/filter
        // payloads spell an integral Real as `5` while the authoritative row
        // reloads as `5.0`. RFC 8785 canonicalizes both to "5", so the digest
        // recheck must release them rather than reporting corruption.
        let directory = tempfile::tempdir().expect("legacy spelling fixture");
        let path = directory.path().join("search.sqlite3");
        let mut db = LocalDatabase::open(&path).expect("open file search database");
        db.schema_seed()
            .apply_schema(real_field_schema())
            .expect("apply real-field search schema");
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "incidents".to_owned(),
                    vec![
                        json!({"_id": "recipe-1", "title": "Skillet lasagna", "minutes": 5})
                            .as_object()
                            .unwrap()
                            .clone(),
                    ],
                )]),
            })
            .expect("seed integral Real row");
        drop(db);

        let raw = Connection::open(&path).expect("open legacy-spelling fixture");
        let rewritten = raw
            .execute(
                "UPDATE _snapback_search_sources
                 SET row_json=replace(row_json,'5.0','5'),
                     filters_json=replace(filters_json,'5.0','5')
                 WHERE table_name='incidents' AND index_name='search_incidents'
                   AND row_id='recipe-1'",
                [],
            )
            .expect("rewrite retained payloads to the legacy integral spelling");
        assert_eq!(rewritten, 1);
        // The out-of-band rewrite trips the tamper trigger; a real legacy
        // database was written by ordinary maintenance and carries no marker.
        raw.execute(
            "UPDATE _snapback_search_generations
             SET status='active',corruption_reason=NULL
             WHERE table_name='incidents' AND index_name='search_incidents'",
            [],
        )
        .expect("clear the trigger-owned quarantine marker");
        drop(raw);

        let legacy = LocalDatabase::open(&path).expect("open legacy-spelling database");
        let page = run(&legacy, &term_request("lasagna"), None)
            .expect("legacy integral spelling must pass the canonical digest recheck");
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0]["fields"]["minutes"], json!(5.0));
        drop(legacy);

        // A genuine value change in the retained payload is still corruption.
        let raw = Connection::open(&path).expect("open value-tamper fixture");
        raw.execute(
            "UPDATE _snapback_search_sources
             SET row_json=replace(row_json,'5','9'),
                 filters_json=replace(filters_json,'5','9')
             WHERE table_name='incidents' AND index_name='search_incidents'
               AND row_id='recipe-1'",
            [],
        )
        .expect("tamper the retained Real value");
        raw.execute(
            "UPDATE _snapback_search_generations
             SET status='active',corruption_reason=NULL
             WHERE table_name='incidents' AND index_name='search_incidents'",
            [],
        )
        .expect("exercise the digest recheck rather than the quarantine marker");
        drop(raw);
        let tampered = LocalDatabase::open(&path).expect("open value-tampered database");
        let error = run(&tampered, &term_request("lasagna"), None)
            .expect_err("a genuinely divergent Real value must fail closed");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_INDEX_CORRUPT");
    }
}
