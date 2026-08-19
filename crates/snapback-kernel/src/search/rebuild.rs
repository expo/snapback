use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::SchemaManifest;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRebuildReceiptV1 {
    pub executor: String,
    pub table: String,
    pub index: String,
    pub generation: u64,
    pub source_head: u64,
    pub root_digest: String,
    pub row_count: u64,
    pub activated: bool,
}

pub(crate) fn quarantine_generation(
    conn: &Connection,
    table: &str,
    index: &str,
    generation: u64,
    reason: &str,
) -> SnapbackResult<()> {
    conn.execute(
        "UPDATE _snapback_search_generations
         SET status = 'quarantined', corruption_reason = ?4
         WHERE table_name = ?1 AND index_name = ?2 AND generation = ?3",
        params![table, index, generation as i64, reason],
    )?;
    Ok(())
}

pub(crate) fn inspect_generation(
    conn: &Connection,
    table: &str,
    index: &str,
) -> SnapbackResult<Option<SearchRebuildReceiptV1>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT receipt_json FROM _snapback_search_generations
             WHERE table_name = ?1 AND index_name = ?2 AND status = 'active'
             ORDER BY generation DESC LIMIT 1",
            params![table, index],
            |row| row.get(0),
        )
        .optional()?;
    raw.map(|raw| {
        serde_json::from_str(&raw).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_SEARCH_INDEX_CORRUPT",
                "search",
                "active search generation receipt is corrupt",
            )
        })
    })
    .transpose()
}

pub(crate) fn record_journal_lease(
    tx: &Transaction<'_>,
    table: &str,
    index: &str,
    generation: u64,
    floor: u64,
    expires_at_ms: u64,
) -> SnapbackResult<()> {
    tx.execute(
        "INSERT INTO _snapback_search_journal_leases
         (table_name, index_name, generation, floor_version, expires_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(table_name, index_name, generation)
         DO UPDATE SET floor_version = excluded.floor_version,
                       expires_at_ms = excluded.expires_at_ms",
        params![
            table,
            index,
            generation as i64,
            floor as i64,
            expires_at_ms as i64
        ],
    )?;
    Ok(())
}

pub fn declared_indexes(schema: &SchemaManifest) -> usize {
    schema
        .tables
        .iter()
        .map(|table| table.search_indexes.len())
        .sum()
}
