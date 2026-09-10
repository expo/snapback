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
pub const STAGING_PER_PRINCIPAL_BYTES: u64 = 256 * 1024 * 1024;
pub const STAGING_PER_PRINCIPAL_OBJECTS: u32 = 20;
pub const STAGING_GLOBAL_BYTES: u64 = 512 * 1024 * 1024;
pub const STAGING_GLOBAL_OBJECTS: u32 = 40;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetUpload {
    pub id: String,
    pub kind: String,
    pub state: String,
    pub bytes: u64,
    pub created_at: i64,
    pub released_at: Option<i64>,
    pub reclaiming: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetStagingUsage {
    /// Admission charge for unlocated receiving and available ready originals,
    /// including released originals; not total physical storage.
    pub bytes: u64,
    /// Receiving (including cancellation custody) and never-claimed ready uploads.
    pub objects: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetStagingSnapshot {
    pub global: AssetStagingUsage,
    pub creator: AssetStagingUsage,
}

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
    pub staged_bytes: u64,
    pub reclaiming: bool,
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
    pub once: bool,
}

impl Store {
    pub fn asset_viewed(&self, id: &str, principal: &str) -> Result<bool, RuntimeError> {
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM _asset_views WHERE asset_id = ?1 AND principal = ?2)",
            params![id, principal],
            |row| row.get(0),
        )?)
    }

    // @ref LLP 1006#2a1-one-use-image-delivery-clique-f3-2026-09-05 — commit after body writes, before the HTTP completion byte; admission alone never consumes.
    pub(crate) fn record_asset_view(
        &mut self,
        id: &str,
        principal: &str,
        at: i64,
    ) -> Result<(), RuntimeError> {
        let transaction = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let viewed: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM _asset_views WHERE asset_id = ?1 AND principal = ?2)",
            params![id, principal],
            |row| row.get(0),
        )?;
        if viewed {
            return Err(RuntimeError::AssetViewed(id.to_owned()));
        }
        transaction.execute(
            "INSERT INTO _asset_views(asset_id, principal, at) VALUES (?1, ?2, ?3)",
            params![id, principal, at],
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Mint an ordinary store id before exposing the receiving ledger row.
    pub(crate) fn begin_asset(
        &mut self,
        kind: AssetKind,
        created_by: &str,
        created_at: i64,
    ) -> Result<String, RuntimeError> {
        self.begin_asset_charged(kind, created_by, created_at, 0)
    }

    /// Reserve byte admission charge and a pending object slot in the ledger before
    /// the upload body can outlive the request that created it. Like
    /// `begin_asset`, the raw string-principal mint stays crate-private;
    /// `Runtime::begin_asset_charged` is the typed-actor entry.
    pub(crate) fn begin_asset_charged(
        &mut self,
        kind: AssetKind,
        created_by: &str,
        created_at: i64,
        staged_bytes: u64,
    ) -> Result<String, RuntimeError> {
        self.enforce_staging_caps(created_by, staged_bytes)?;
        let id = self
            .reserve_new_ids()?
            .pop_front()
            .expect("the fixed allocator block is non-empty");
        self.asset_create_receiving(&id, kind, created_by, created_at, staged_bytes)?;
        Ok(id)
    }

    fn asset_create_receiving(
        &mut self,
        id: &str,
        kind: AssetKind,
        created_by: &str,
        created_at: i64,
        staged_bytes: u64,
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
                created_by, created_at, released_at, staged_bytes, reclaiming,
                locator_table, locator_row, locator_column
             ) VALUES (?1, 'receiving', ?2, NULL, NULL, NULL, NULL, NULL,
                       ?3, ?4, NULL, ?5, 0, NULL, NULL, NULL)",
            params![
                id,
                kind.as_str(),
                created_by,
                created_at,
                i64::try_from(staged_bytes).map_err(|_| RuntimeError::AssetTooLarge(
                    "asset staging byte count exceeds SQLite integer storage".to_owned()
                ))?,
            ],
        )?;
        Ok(())
    }

    pub fn enforce_staging_caps(&self, created_by: &str, bytes: u64) -> Result<(), RuntimeError> {
        let usage = self.asset_staging_usage(created_by)?;
        let recovery = "Inspect client.listUploads(); discard only ids whose future use you have abandoned with client.discardUpload(id), or wait for eligible cleanup. Receiving cleanup may retain its charge";
        if usage.creator.objects >= STAGING_PER_PRINCIPAL_OBJECTS {
            return Err(RuntimeError::AssetTooLarge(format!(
                "your pending object ceiling is full: {} / {STAGING_PER_PRINCIPAL_OBJECTS} objects. {recovery}",
                usage.creator.objects
            )));
        }
        if bytes > STAGING_PER_PRINCIPAL_BYTES.saturating_sub(usage.creator.bytes) {
            return Err(RuntimeError::AssetTooLarge(format!(
                "your byte admission ceiling would be exceeded: {} / {STAGING_PER_PRINCIPAL_BYTES} charged bytes; requested {bytes} bytes. Charges include released ready originals during grace, even with free pending slots. {recovery}",
                usage.creator.bytes
            )));
        }
        if usage.global.objects >= STAGING_GLOBAL_OBJECTS {
            return Err(RuntimeError::AssetTooLarge(format!(
                "the owner pending object ceiling is full (limit {STAGING_GLOBAL_OBJECTS}); your usage is {} pending objects. {recovery}. Other accounts must recover their own abandoned uploads",
                usage.creator.objects
            )));
        }
        if bytes > STAGING_GLOBAL_BYTES.saturating_sub(usage.global.bytes) {
            return Err(RuntimeError::AssetTooLarge(format!(
                "the owner byte admission ceiling would be exceeded (limit {STAGING_GLOBAL_BYTES} bytes); your usage is {} charged bytes; requested {bytes} bytes. Charges include released ready originals during grace, even with free pending slots. {recovery}. Other accounts must recover their own abandoned uploads",
                usage.creator.bytes
            )));
        }
        Ok(())
    }

    /// Recomputed from durable rows on every call, so restart has no separate
    /// accounting state to rebuild or trust.
    // @ref LLP 1006#14-what-it-costs — releases free pending slots but retain the existing original-byte admission charge; receiving cancellation still owns a slot.
    pub fn asset_staging_usage(
        &self,
        created_by: &str,
    ) -> Result<AssetStagingSnapshot, RuntimeError> {
        fn usage(
            connection: &Connection,
            creator: Option<&str>,
        ) -> Result<AssetStagingUsage, RuntimeError> {
            let (bytes, objects): (i64, i64) = if let Some(creator) = creator {
                connection.query_row(
                    "SELECT COALESCE(SUM(MAX(staged_bytes, COALESCE(bytes, 0))), 0),
                            COALESCE(SUM(CASE WHEN state = 'receiving' OR released_at IS NULL THEN 1 ELSE 0 END), 0)
                     FROM _assets
                     WHERE locator_table IS NULL
                       AND (state = 'receiving' OR (state = 'ready' AND reclaiming = 0)) AND created_by = ?1",
                    [creator],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?
            } else {
                connection.query_row(
                    "SELECT COALESCE(SUM(MAX(staged_bytes, COALESCE(bytes, 0))), 0),
                            COALESCE(SUM(CASE WHEN state = 'receiving' OR released_at IS NULL THEN 1 ELSE 0 END), 0)
                     FROM _assets
                     WHERE locator_table IS NULL
                       AND (state = 'receiving' OR (state = 'ready' AND reclaiming = 0))",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?
            };
            Ok(AssetStagingUsage {
                bytes: u64::try_from(bytes).map_err(|_| {
                    RuntimeError::Serialization("asset staging byte total is negative".to_owned())
                })?,
                objects: u32::try_from(objects).map_err(|_| {
                    RuntimeError::Serialization("asset staging object total exceeds u32".to_owned())
                })?,
            })
        }
        Ok(AssetStagingSnapshot {
            global: usage(&self.conn, None)?,
            creator: usage(&self.conn, Some(created_by))?,
        })
    }

    /// Durably charge finalized growth while the row is still receiving, so
    /// publication can never get ahead of quota reconstruction after restart.
    pub fn asset_reserve_finalized_bytes(
        &mut self,
        id: &str,
        bytes: u64,
    ) -> Result<(), RuntimeError> {
        if bytes == 0 {
            return Err(RuntimeError::AssetType(
                "finalized asset bytes must be positive".to_owned(),
            ));
        }
        let row = self
            .asset(id)?
            .filter(|row| row.state == AssetState::Receiving && !row.reclaiming)
            .ok_or_else(|| {
                RuntimeError::AssetNotReady(format!("asset {id} is missing or is not receiving"))
            })?;
        if let Some(reserved) = row.bytes {
            if reserved == bytes {
                return Ok(());
            }
            return Err(RuntimeError::AssetType(format!(
                "asset {id} already reserved {reserved} finalized bytes"
            )));
        }
        let growth = bytes.saturating_sub(row.staged_bytes);
        if growth > 0 {
            let usage = self.asset_staging_usage(&row.created_by)?;
            if growth > STAGING_PER_PRINCIPAL_BYTES.saturating_sub(usage.creator.bytes) {
                return Err(RuntimeError::AssetTooLarge(format!(
                    "your finalized growth of {growth} bytes exceeds the {STAGING_PER_PRINCIPAL_BYTES} byte admission ceiling; your charge is {} bytes, including released ready originals during grace",
                    usage.creator.bytes
                )));
            }
            if growth > STAGING_GLOBAL_BYTES.saturating_sub(usage.global.bytes) {
                return Err(RuntimeError::AssetTooLarge(format!(
                    "finalized growth of {growth} bytes exceeds the owner {STAGING_GLOBAL_BYTES} byte admission ceiling; charges include released ready originals during grace"
                )));
            }
        }
        let bytes = i64::try_from(bytes).map_err(|_| {
            RuntimeError::AssetTooLarge(format!(
                "asset {id} byte count exceeds SQLite integer storage"
            ))
        })?;
        let changed = self.conn.execute(
            "UPDATE _assets SET bytes = ?2
             WHERE id = ?1 AND state = 'receiving' AND reclaiming = 0 AND bytes IS NULL",
            params![id, bytes],
        )?;
        if changed != 1 {
            return Err(RuntimeError::AssetNotReady(format!(
                "asset {id} is missing or is not receiving"
            )));
        }
        Ok(())
    }

    pub fn asset_mark_ready(
        &mut self,
        id: &str,
        facts: &AssetReadyFacts,
    ) -> Result<(), RuntimeError> {
        let row = self
            .asset(id)?
            .filter(|row| row.state == AssetState::Receiving && !row.reclaiming)
            .ok_or_else(|| {
                RuntimeError::AssetNotReady(format!("asset {id} is missing or is not receiving"))
            })?;
        validate_ready_facts(facts, Some(row.kind))?;
        if row.bytes != Some(facts.bytes) {
            return Err(RuntimeError::AssetNotReady(format!(
                "asset {id} finalized bytes were not durably reserved before publication"
            )));
        }
        let changed = self.conn.execute(
            "UPDATE _assets SET state = 'ready', type = ?2,
                    width = ?3, height = ?4, duration = ?5
             WHERE id = ?1 AND state = 'receiving' AND reclaiming = 0 AND bytes = ?6",
            params![
                id,
                facts.media_type,
                facts.width,
                facts.height,
                facts.duration,
                i64::try_from(facts.bytes).map_err(|_| RuntimeError::AssetTooLarge(format!(
                    "asset {id} byte count exceeds SQLite integer storage"
                )))?,
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

    pub fn asset_ids(&self) -> Result<Vec<String>, RuntimeError> {
        let mut statement = self.conn.prepare("SELECT id FROM _assets ORDER BY id")?;
        Ok(statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Only the caller's unclaimed receiving/ready uploads; bounded by the page size.
    pub fn unclaimed_uploads(
        &self,
        creator: &str,
        after: &str,
    ) -> Result<Vec<AssetUpload>, RuntimeError> {
        let mut statement = self.conn.prepare(
            "SELECT id, kind, state, MAX(staged_bytes, COALESCE(bytes, 0)), created_at,
                    released_at, reclaiming
             FROM _assets WHERE created_by = ?1 AND locator_table IS NULL
               AND (state = 'receiving' OR (state = 'ready' AND reclaiming = 0)) AND id > ?2
             ORDER BY id LIMIT 101",
        )?;
        Ok(statement
            .query_map(params![creator, after], |row| {
                Ok(AssetUpload {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    state: row.get(2)?,
                    bytes: row.get(3)?,
                    created_at: row.get(4)?,
                    released_at: row.get(5)?,
                    reclaiming: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    // @ref LLP 1006#9-lifecycle-finalize-off-the-writer-and-reclamation — explicit owner disposal uses the same durable tombstone as grace-based reclamation.
    pub(crate) fn discard_upload(&mut self, creator: &str, id: &str) -> Result<bool, RuntimeError> {
        let transaction = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let changed = transaction.execute(
            "UPDATE _assets SET reclaiming = 1
             WHERE id = ?1 AND created_by = ?2 AND locator_table IS NULL",
            params![id, creator],
        )?;
        if changed == 0
            && asset_row(&transaction, id)?
                .is_some_and(|row| row.created_by == creator && row.locator.is_some())
        {
            return Err(RuntimeError::AssetInUse(id.to_owned()));
        }
        transaction.commit()?;
        // Missing and foreign ids have the same answer, including after a retry.
        Ok(changed > 0)
    }

    // @ref LLP 1006#9-lifecycle-finalize-off-the-writer-and-reclamation — unclaimed rows age out without scanning application tables.
    pub fn reclaim(&mut self, now: i64) -> Result<Vec<String>, RuntimeError> {
        let cutoff = now.saturating_sub(ASSET_RECLAIM_GRACE_MS);
        let transaction = self.conn.transaction()?;
        let ids = {
            let mut statement = transaction.prepare(
                "SELECT id FROM _assets
                 WHERE locator_table IS NULL
                   AND (reclaiming = 1
                        OR MAX(created_at, COALESCE(released_at, created_at)) <= ?1)
                 ORDER BY id",
            )?;
            statement
                .query_map([cutoff], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        // The row survives as a `reclaiming` tombstone until the server's
        // fork-aware blob deletion succeeds and `finish_asset_reclaims` runs,
        // so a crash between the two cannot orphan bytes.
        for id in &ids {
            transaction.execute(
                "UPDATE _assets SET reclaiming = 1 WHERE id = ?1 AND locator_table IS NULL",
                [id],
            )?;
        }
        transaction.commit()?;
        // Blob bytes are server-owned. Fork snapshots share immutable blobs,
        // so the server must treat every live/fork ledger as a referrer before
        // deleting any id returned here (LLP 1006 §9a).
        Ok(ids)
    }

    pub fn finish_asset_reclaims(&mut self, ids: &[String]) -> Result<(), RuntimeError> {
        let transaction = self.conn.transaction()?;
        for id in ids {
            if transaction.execute(
                "DELETE FROM _assets WHERE id = ?1 AND reclaiming = 1 AND locator_table IS NULL",
                [id],
            )? > 0
            {
                transaction.execute("DELETE FROM _asset_views WHERE asset_id = ?1", [id])?;
            }
        }
        transaction.commit()?;
        Ok(())
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
    if row.state != AssetState::Ready || row.reclaiming {
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
#[allow(clippy::too_many_arguments)]
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

pub(crate) fn validate_asset_inputs(
    transaction: &Transaction<'_>,
    program: &crate::ir::Program,
    context: &crate::engine::Context,
) -> Result<Vec<String>, RuntimeError> {
    let mut staged = Vec::new();
    for (name, kind) in &program.args {
        if !kind.contains_asset() {
            continue;
        }
        let value = context
            .args
            .get(name)
            .ok_or_else(|| RuntimeError::Input(format!("missing arg {name}")))?;
        for asset in crate::assets::arg_asset_uses(kind, value, &format!("arg {name}"))? {
            let row = validate_asset_use(transaction, &asset, context.viewer(), true)?;
            if row.locator.is_none() {
                staged.push(row.id);
            }
        }
    }
    Ok(staged)
}

// @ref LLP 1006#6a-discard-unused-arguments-at-commit — only validated staged arguments of this call may bypass release grace.
pub(crate) fn discard_unused_arguments(
    transaction: &Transaction<'_>,
    creator: &str,
    ids: &[String],
) -> Result<(), RuntimeError> {
    for id in ids {
        transaction.execute(
            "UPDATE _assets SET reclaiming = 1
             WHERE id = ?1 AND created_by = ?2 AND state = 'ready'
               AND reclaiming = 0 AND locator_table IS NULL",
            params![id, creator],
        )?;
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
    // Reset releases every row into the `reclaiming` tombstone state; the
    // server deletes the bytes and finishes the reclaim (LLP 1006 §9a).
    transaction.execute(
        "UPDATE _assets SET reclaiming = 1,
            locator_table = NULL, locator_row = NULL, locator_column = NULL",
        [],
    )?;
    Ok(ids)
}

pub(crate) fn delivery_row(
    connection: &Connection,
    id: &str,
) -> Result<AssetLedgerRow, RuntimeError> {
    let unavailable = || RuntimeError::AssetNotReady("asset is unavailable".to_owned());
    let row = asset_row(connection, id)?.ok_or_else(unavailable)?;
    if row.state != AssetState::Ready || row.reclaiming || row.locator.is_none() {
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
    once: bool,
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
        once,
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
        i64,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let raw = connection
        .query_row(
            "SELECT id, state, kind, type, bytes, width, height, duration,
                    created_by, created_at, released_at, staged_bytes, reclaiming,
                    locator_table, locator_row, locator_column
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
                    row.get(14)?,
                    row.get(15)?,
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
            staged_bytes,
            reclaiming,
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
        let staged_bytes = u64::try_from(staged_bytes).map_err(|_| {
            RuntimeError::Serialization(format!("asset {id} has negative staged byte count"))
        })?;
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
            staged_bytes,
            reclaiming: reclaiming != 0,
            locator,
        })
    })
    .transpose()
}

#[cfg(test)]
mod tests {
    #[test]
    fn reset_data_clears_once_views_before_sweep() {
        let mut store = crate::Store::memory().unwrap();
        store.record_asset_view("old-asset", "alice", 11).unwrap();
        store.reset_data().unwrap();
        assert!(!store.asset_viewed("old-asset", "alice").unwrap());
    }

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
