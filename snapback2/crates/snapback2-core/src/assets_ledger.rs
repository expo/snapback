//! Engine-owned asset staging, ownership, and reclamation ledger.

use crate::assets::{AssetKind, AssetUse, column_asset_uses, is_engine_id};
use crate::engine::RuntimeError;
use crate::identity::SYSTEM_PRINCIPAL_ID;
use crate::schema::Schema;
use crate::store::Store;
use crate::value::{I53_MAX, Value};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const ASSET_RECLAIM_GRACE_MS: i64 = 24 * 60 * 60 * 1_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetState {
    Receiving,
    Ready,
    Failed,
}

impl AssetState {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "receiving" => Some(Self::Receiving),
            "ready" => Some(Self::Ready),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetLocator {
    pub table: String,
    pub row: String,
    pub column: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetReadyFacts {
    #[serde(rename = "type")]
    pub media_type: String,
    pub bytes: u64,
    pub width: i64,
    pub height: i64,
    pub duration: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetLedgerRow {
    pub id: String,
    pub state: AssetState,
    pub kind: AssetKind,
    #[serde(rename = "type")]
    pub media_type: Option<String>,
    pub bytes: Option<u64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration: Option<i64>,
    pub created_by: String,
    pub created_at: i64,
    pub released_at: Option<i64>,
    pub locator: Option<AssetLocator>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDelivery {
    pub kind: AssetKind,
    #[serde(rename = "type")]
    pub media_type: String,
    pub bytes: u64,
    pub width: i64,
    pub height: i64,
    pub duration: Option<i64>,
    pub public: bool,
}

impl Store {
    /// Mint an ordinary store id before exposing the receiving ledger row.
    pub(crate) fn begin_asset(
        &mut self,
        kind: AssetKind,
        created_by: &str,
        created_at: i64,
    ) -> Result<String, RuntimeError> {
        let id = self
            .reserve_new_ids()?
            .pop_front()
            .expect("the fixed allocator block is non-empty");
        self.asset_create_receiving(&id, kind, created_by, created_at)?;
        Ok(id)
    }

    fn asset_create_receiving(
        &mut self,
        id: &str,
        kind: AssetKind,
        created_by: &str,
        created_at: i64,
    ) -> Result<(), RuntimeError> {
        if !is_engine_id(id) || created_by.is_empty() || created_by == SYSTEM_PRINCIPAL_ID.as_str()
        {
            return Err(RuntimeError::AssetType(
                "asset id must be minted and uploader must be a non-system actor".to_owned(),
            ));
        }
        self.conn.execute(
            "INSERT INTO _assets(
                id, state, kind, type, bytes, width, height, duration,
                created_by, created_at, released_at, locator_table, locator_row, locator_column
             ) VALUES (?1, 'receiving', ?2, NULL, NULL, NULL, NULL, NULL, ?3, ?4, NULL, NULL, NULL, NULL)",
            params![id, kind.as_str(), created_by, created_at],
        )?;
        Ok(())
    }

    pub fn asset_mark_ready(
        &mut self,
        id: &str,
        facts: &AssetReadyFacts,
    ) -> Result<(), RuntimeError> {
        validate_ready_facts(facts, self.asset(id)?.map(|row| row.kind))?;
        let changed = self.conn.execute(
            "UPDATE _assets SET state = 'ready', type = ?2, bytes = ?3,
                    width = ?4, height = ?5, duration = ?6
             WHERE id = ?1 AND state = 'receiving'",
            params![
                id,
                facts.media_type,
                i64::try_from(facts.bytes).map_err(|_| RuntimeError::AssetTooLarge(format!(
                    "asset {id} byte count exceeds SQLite integer storage"
                )))?,
                facts.width,
                facts.height,
                facts.duration,
            ],
        )?;
        if changed != 1 {
            return Err(RuntimeError::AssetNotReady(format!(
                "asset {id} is missing or is not receiving"
            )));
        }
        Ok(())
    }

    pub fn asset_mark_failed(&mut self, id: &str) -> Result<(), RuntimeError> {
        let changed = self.conn.execute(
            "UPDATE _assets SET state = 'failed' WHERE id = ?1 AND state = 'receiving'",
            [id],
        )?;
        if changed != 1 {
            return Err(RuntimeError::AssetNotReady(format!(
                "asset {id} is missing or is not receiving"
            )));
        }
        Ok(())
    }

    pub fn asset(&self, id: &str) -> Result<Option<AssetLedgerRow>, RuntimeError> {
        asset_row(&self.conn, id)
    }

    // @ref LLP 1006#9-lifecycle-finalize-off-the-writer-and-reclamation — unclaimed rows age out without scanning application tables.
    pub fn reclaim(&mut self, now: i64) -> Result<Vec<String>, RuntimeError> {
        let cutoff = now.saturating_sub(ASSET_RECLAIM_GRACE_MS);
        let transaction = self.conn.transaction()?;
        let ids = {
            let mut statement = transaction.prepare(
                "SELECT id FROM _assets
                 WHERE locator_table IS NULL
                   AND MAX(created_at, COALESCE(released_at, created_at)) <= ?1
                 ORDER BY id",
            )?;
            statement
                .query_map([cutoff], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        for id in &ids {
            transaction.execute("DELETE FROM _assets WHERE id = ?1", [id])?;
        }
        transaction.commit()?;
        // Blob bytes are server-owned. Fork snapshots share immutable blobs,
        // so the server must treat every live/fork ledger as a referrer before
        // deleting any id returned here (LLP 1006 §9a).
        Ok(ids)
    }
}

pub(crate) fn validate_asset_use(
    connection: &Connection,
    asset: &AssetUse,
    principal: &str,
    require_creator: bool,
) -> Result<AssetLedgerRow, RuntimeError> {
    let Some(row) = asset_row(connection, &asset.record.id)? else {
        return Err(RuntimeError::AssetNotReady(format!(
            "asset {} is missing or not ready",
            asset.record.id
        )));
    };
    if row.state != AssetState::Ready {
        return Err(RuntimeError::AssetNotReady(format!(
            "asset {} is missing or not ready",
            asset.record.id
        )));
    }
    if row.kind != asset.record.kind
        || row.width != Some(asset.record.width)
        || row.height != Some(asset.record.height)
        || row.duration != asset.record.duration
        || require_creator && row.created_by != principal
    {
        return Err(RuntimeError::AssetType(format!(
            "asset {} kind, facts, or uploader do not match the ledger",
            asset.record.id
        )));
    }
    let bytes = row.bytes.ok_or_else(|| {
        RuntimeError::AssetType(format!(
            "asset {} has no finalized byte count",
            asset.record.id
        ))
    })?;
    if bytes > u64::from(asset.max) {
        return Err(RuntimeError::AssetTooLarge(format!(
            "asset {} has {bytes} bytes, over max {}",
            asset.record.id, asset.max
        )));
    }
    Ok(row)
}

// @ref LLP 1006#2a-one-asset-one-home-author-ruling-2026-09-01 — release old-only ids and claim new-only ids once per cell, preserving same-cell list edits.
pub(crate) fn reconcile_row_assets(
    transaction: &Transaction<'_>,
    schema: &Schema,
    table_name: &str,
    row_id: &str,
    old: Option<&Value>,
    new: Option<&Value>,
    principal: &str,
    released_at: i64,
) -> Result<(), RuntimeError> {
    let Some(table) = schema.table(table_name) else {
        return Err(RuntimeError::Schema(format!("missing table {table_name}")));
    };
    let mut releases = Vec::new();
    let mut claims = Vec::new();
    for (column, kind) in &table.columns {
        if !kind.contains_asset() {
            continue;
        }
        let label = format!("{table_name}.{column}");
        let old_uses = old.map_or_else(
            || Ok(Vec::new()),
            |row| column_asset_uses(kind, row.field(column).ok(), &label),
        )?;
        let new_uses = new.map_or_else(
            || Ok(Vec::new()),
            |row| column_asset_uses(kind, row.field(column).ok(), &label),
        )?;
        for asset in &new_uses {
            validate_asset_use(transaction, asset, principal, false)?;
        }
        let old_ids = old_uses
            .iter()
            .map(|asset| asset.record.id.clone())
            .collect::<BTreeSet<_>>();
        let new_by_id = new_uses
            .into_iter()
            .map(|asset| (asset.record.id.clone(), asset))
            .collect::<BTreeMap<_, _>>();
        let new_ids = new_by_id.keys().cloned().collect::<BTreeSet<_>>();
        for id in old_ids.difference(&new_ids) {
            releases.push((column.clone(), id.clone()));
        }
        for id in new_ids.difference(&old_ids) {
            claims.push((column.clone(), new_by_id[id].clone()));
        }
    }

    for (column, id) in releases {
        transaction.execute(
            "UPDATE _assets SET locator_table = NULL, locator_row = NULL, locator_column = NULL,
                    released_at = ?5
             WHERE id = ?1 AND locator_table = ?2 AND locator_row = ?3 AND locator_column = ?4",
            params![id, table_name, row_id, column, released_at],
        )?;
    }
    for (column, asset) in claims {
        validate_asset_use(transaction, &asset, principal, true)?;
        let changed = transaction.execute(
            "UPDATE _assets SET locator_table = ?2, locator_row = ?3, locator_column = ?4,
                    released_at = NULL
             WHERE id = ?1 AND (
                locator_table IS NULL OR
                (locator_table = ?2 AND locator_row = ?3 AND locator_column = ?4)
             )",
            params![asset.record.id, table_name, row_id, column],
        )?;
        if changed != 1 {
            return Err(RuntimeError::AssetInUse(format!(
                "asset {} is already claimed by another cell",
                asset.record.id
            )));
        }
    }
    Ok(())
}

pub(crate) fn release_table_assets(
    transaction: &Transaction<'_>,
    table: &str,
    released_at: i64,
) -> Result<(), RuntimeError> {
    transaction.execute(
        "UPDATE _assets SET locator_table = NULL, locator_row = NULL, locator_column = NULL,
                released_at = ?2
         WHERE locator_table = ?1",
        params![table, released_at],
    )?;
    Ok(())
}

pub(crate) fn release_column_assets(
    transaction: &Transaction<'_>,
    table: &str,
    column: &str,
    released_at: i64,
) -> Result<(), RuntimeError> {
    transaction.execute(
        "UPDATE _assets SET locator_table = NULL, locator_row = NULL, locator_column = NULL,
                released_at = ?3
         WHERE locator_table = ?1 AND locator_column = ?2",
        params![table, column, released_at],
    )?;
    Ok(())
}

pub(crate) fn clear_assets(transaction: &Transaction<'_>) -> Result<Vec<String>, RuntimeError> {
    let ids = {
        let mut statement = transaction.prepare("SELECT id FROM _assets ORDER BY id")?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
    };
    transaction.execute("DELETE FROM _assets", [])?;
    Ok(ids)
}

pub(crate) fn delivery_row(
    connection: &Connection,
    id: &str,
) -> Result<AssetLedgerRow, RuntimeError> {
    let unavailable = || RuntimeError::AssetNotReady("asset is unavailable".to_owned());
    let row = asset_row(connection, id)?.ok_or_else(unavailable)?;
    if row.state != AssetState::Ready || row.locator.is_none() {
        return Err(unavailable());
    }
    Ok(row)
}

pub(crate) fn locator_cell_matches(
    schema: &Schema,
    row: &Value,
    locator: &AssetLocator,
    ledger: &AssetLedgerRow,
) -> bool {
    let Some(kind) = schema
        .table(&locator.table)
        .and_then(|table| table.columns.get(&locator.column))
    else {
        return false;
    };
    column_asset_uses(kind, row.field(&locator.column).ok(), "stored asset cell").is_ok_and(
        |uses| {
            let mut matching = uses.iter().filter(|asset| asset.record.id == ledger.id);
            matching.next().is_some_and(|asset| {
                asset.record.kind == ledger.kind
                    && Some(asset.record.width) == ledger.width
                    && Some(asset.record.height) == ledger.height
                    && asset.record.duration == ledger.duration
            }) && matching.next().is_none()
        },
    )
}

pub(crate) fn ready_delivery(
    row: AssetLedgerRow,
    public: bool,
) -> Result<AssetDelivery, RuntimeError> {
    let unavailable = || RuntimeError::AssetNotReady("asset is unavailable".to_owned());
    Ok(AssetDelivery {
        kind: row.kind,
        media_type: row.media_type.ok_or_else(unavailable)?,
        bytes: row.bytes.ok_or_else(unavailable)?,
        width: row.width.ok_or_else(unavailable)?,
        height: row.height.ok_or_else(unavailable)?,
        duration: row.duration,
        public,
    })
}

fn validate_ready_facts(
    facts: &AssetReadyFacts,
    kind: Option<AssetKind>,
) -> Result<(), RuntimeError> {
    let kind = kind.ok_or_else(|| RuntimeError::AssetNotReady("asset is missing".to_owned()))?;
    if facts.media_type.is_empty()
        || facts.bytes == 0
        || !(1..=I53_MAX).contains(&facts.width)
        || !(1..=I53_MAX).contains(&facts.height)
        || match kind {
            AssetKind::Image => facts.duration.is_some(),
            AssetKind::Video => facts
                .duration
                .is_none_or(|duration| !(1..=I53_MAX).contains(&duration)),
        }
    {
        return Err(RuntimeError::AssetType(
            "finalized asset facts do not match the closed kind record".to_owned(),
        ));
    }
    Ok(())
}

fn asset_row(connection: &Connection, id: &str) -> Result<Option<AssetLedgerRow>, RuntimeError> {
    type Raw = (
        String,
        String,
        String,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        String,
        i64,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let raw = connection
        .query_row(
            "SELECT id, state, kind, type, bytes, width, height, duration,
                    created_by, created_at, released_at, locator_table, locator_row, locator_column
             FROM _assets WHERE id = ?1",
            [id],
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
                ))
            },
        )
        .optional()?;
    raw.map(|raw: Raw| {
        let (
            id,
            state,
            kind,
            media_type,
            bytes,
            width,
            height,
            duration,
            created_by,
            created_at,
            released_at,
            locator_table,
            locator_row,
            locator_column,
        ) = raw;
        let state = AssetState::parse(&state).ok_or_else(|| {
            RuntimeError::Serialization(format!("asset {id} has invalid state {state}"))
        })?;
        let kind = AssetKind::parse(&kind).ok_or_else(|| {
            RuntimeError::Serialization(format!("asset {id} has invalid kind {kind}"))
        })?;
        let bytes = bytes
            .map(|bytes| {
                u64::try_from(bytes).map_err(|_| {
                    RuntimeError::Serialization(format!("asset {id} has negative byte count"))
                })
            })
            .transpose()?;
        let locator = match (locator_table, locator_row, locator_column) {
            (None, None, None) => None,
            (Some(table), Some(row), Some(column)) => Some(AssetLocator { table, row, column }),
            _ => {
                return Err(RuntimeError::Serialization(format!(
                    "asset {id} has a partial locator"
                )));
            }
        };
        Ok(AssetLedgerRow {
            id,
            state,
            kind,
            media_type,
            bytes,
            width,
            height,
            duration,
            created_by,
            created_at,
            released_at,
            locator,
        })
    })
    .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_asset_mint_rejects_the_system_principal() {
        let mut store = Store::memory().unwrap();
        let error = store
            .asset_create_receiving(
                "s2id-00000000000000000000000000000001-0000000000000001",
                AssetKind::Image,
                SYSTEM_PRINCIPAL_ID.as_str(),
                0,
            )
            .unwrap_err();
        assert_eq!(error.code(), "E_ASSET_TYPE");
        assert!(
            store
                .asset("s2id-00000000000000000000000000000001-0000000000000001")
                .unwrap()
                .is_none()
        );
    }
}
