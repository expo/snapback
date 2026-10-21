//! SQLite asset ledger access.
// @ref LLP 3000.009.001.000#9.1 — shared admission and deterministic bounded selections on both adapters.
// ----- persistence: asset facts, upload intents and views -----

use crate::store::{Store, Tx};
use crate::{
    RuntimeError,
    assets::{
        Asset, AssetKind, IntentDeclaration, IntentPlacement, PendingIntent,
        UploadedIntent,
    },
};
use rusqlite::{Connection, OptionalExtension, params};

const COLUMNS: &str = "id, owner, kind, content_type, bytes, width, height, duration, created_at, home_table, home_id, home_column, released_at, name";

fn read_asset(row: &rusqlite::Row<'_>) -> rusqlite::Result<Asset> {
    let kind: String = row.get(2)?;
    let home: (Option<String>, Option<String>, Option<String>) =
        (row.get(9)?, row.get(10)?, row.get(11)?);
    Ok(Asset {
        id: row.get(0)?,
        owner: row.get(1)?,
        kind: match kind.as_str() {
            "video" => AssetKind::Video,
            "file" => AssetKind::File,
            _ => AssetKind::Image,
        },
        content_type: row.get(3)?,
        bytes: row.get::<_, i64>(4)? as u64,
        width: row.get::<_, Option<i64>>(5)?.map(|w| w as u32),
        height: row.get::<_, Option<i64>>(6)?.map(|h| h as u32),
        duration: row.get::<_, Option<i64>>(7)?.map(|d| d as u64),
        created_at: row.get(8)?,
        home: match home {
            (Some(table), Some(id), Some(column)) => Some((table, id, column)),
            _ => None,
        },
        released_at: row.get(12)?,
        name: row.get(13)?,
    })
}

fn find(conn: &Connection, id: &str) -> Result<Option<Asset>, RuntimeError> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM _assets WHERE id = ?1"),
            [id],
            read_asset,
        )
        .optional()?)
}

fn stale(conn: &Connection, now: i64) -> Result<Vec<Asset>, RuntimeError> {
    let mut statement = conn.prepare(&format!("SELECT {COLUMNS} FROM _assets WHERE released_at IS NOT NULL OR (home_table IS NULL AND created_at < ?1 AND NOT EXISTS (SELECT 1 FROM _asset_intents u WHERE u.asset=_assets.id AND u.state='pending' AND NOT EXISTS (SELECT 1 FROM _ops o WHERE o.principal=u.owner AND o.id=u.intent))) ORDER BY created_at, id LIMIT 256"))?;
    let rows = statement.query_map([crate::assets::stale_asset_cutoff(now)], read_asset)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn forget(conn: &Connection, id: &str) -> Result<(), RuntimeError> {
    conn.execute("DELETE FROM _asset_views WHERE asset = ?1", [id])?;
    conn.execute("DELETE FROM _asset_gc WHERE asset = ?1", [id])?;
    conn.execute("DELETE FROM _assets WHERE id = ?1", [id])?;
    Ok(())
}

fn record(conn: &Connection, asset: &Asset) -> Result<(), RuntimeError> {
    crate::assets::validate_ledger_text(&[&asset.id, &asset.owner, &asset.content_type, asset.name.as_deref().unwrap_or("")])?;
    conn.execute(
            &format!("INSERT INTO _assets({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, NULL, NULL, ?10)"),
            params![asset.id, asset.owner, asset.kind.word(), asset.content_type, asset.bytes as i64, asset.width.map(i64::from), asset.height.map(i64::from), asset.duration.map(|d| d as i64), asset.created_at, asset.name],
        )?;
    Ok(())
}

impl Store {
    /// Record an upload. The bytes are the caller's to write at `asset_path`.
    pub fn record_asset(&self, asset: &Asset) -> Result<(), RuntimeError> {
        record(self.conn(), asset)
    }

    pub fn asset(&self, id: &str) -> Result<Option<Asset>, RuntimeError> {
        find(self.conn(), id)
    }

    pub fn asset_path(&self, id: &str) -> std::path::PathBuf {
        self.assets_dir().join(id)
    }

    /// Assets nobody serves any more: released by their home, or never
    /// claimed within the grace period. The sweep unlinks and forgets them.
    pub fn stale_assets(&self, now: i64) -> Result<Vec<Asset>, RuntimeError> {
        stale(self.conn(), now)
    }

    pub fn forget_asset(&self, id: &str) -> Result<(), RuntimeError> {
        forget(self.conn(), id)
    }
}

impl Tx<'_> {
    pub fn record_asset(&self, asset: &Asset) -> Result<(), RuntimeError> {
        record(self.conn(), asset)
    }

    /// Select a bounded sweep batch and close the claim race for old,
    /// unclaimed uploads before their files are removed outside the guard.
    pub fn stage_stale_assets(&self, now: i64) -> Result<Vec<Asset>, RuntimeError> {
        self.stage_stale_assets_for(now, std::time::Duration::MAX)
    }

    pub fn stage_stale_assets_for(
        &self,
        now: i64,
        budget: std::time::Duration,
    ) -> Result<Vec<Asset>, RuntimeError> {
        let started = std::time::Instant::now();
        let mut assets = stale(self.conn(), now)?;
        let mut staged = 0;
        for asset in &assets {
            if staged > 0 && started.elapsed() >= budget {
                break;
            }
            self.conn().execute(
                "INSERT OR IGNORE INTO _asset_gc(asset) VALUES (?1)",
                [&asset.id],
            )?;
            self.conn().execute(
                "UPDATE _assets SET released_at = COALESCE(released_at, ?2) WHERE id = ?1",
                params![asset.id, now],
            )?;
            staged += 1;
        }
        assets.truncate(staged);
        Ok(assets)
    }

    pub fn forget_asset(&self, id: &str) -> Result<(), RuntimeError> {
        forget(self.conn(), id)
    }

    pub fn asset(&self, id: &str) -> Result<Option<Asset>, RuntimeError> {
        find(self.conn(), id)
    }

    /// A row column takes the asset: one asset, one home. The uploader's
    /// own assets only (the system principal may place any), and an asset
    /// another row already holds is refused.
    pub fn claim_asset(
        &self,
        id: &str,
        by: &str,
        table: &str,
        row_id: &str,
        column: &str,
    ) -> Result<Asset, RuntimeError> {
        crate::assets::claim_asset(self, id, by, table, row_id, column)
    }

    /// Only the recorded home can let go of an asset. Legacy references in
    /// another cell (or to an unplaced upload) leave its ledger untouched.
    pub fn release_asset(
        &self,
        id: &str,
        table: &str,
        row_id: &str,
        column: &str,
        now: i64,
    ) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _assets SET released_at = ?2, home_table = NULL, home_id = NULL, home_column = NULL WHERE id = ?1 AND released_at IS NULL AND home_table = ?3 AND home_id = ?4 AND home_column = ?5", params![id, now, table, row_id, column])?;
        Ok(())
    }

    pub fn asset_viewed(&self, id: &str, principal: &str) -> Result<bool, RuntimeError> {
        Ok(self
            .conn()
            .query_row(
                "SELECT 1 FROM _asset_views WHERE asset = ?1 AND principal = ?2",
                params![id, principal],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    pub fn record_asset_view(
        &self,
        id: &str,
        principal: &str,
        now: i64,
    ) -> Result<(), RuntimeError> {
        if !self.asset_viewed(id, principal)? { crate::assets::validate_ledger_text(&[id, principal])?; }
        self.conn().execute(
            "INSERT OR IGNORE INTO _asset_views(asset, principal, at) VALUES (?1, ?2, ?3)",
            params![id, principal, now],
        )?;
        Ok(())
    }
}

impl crate::assets::AssetIntentReader for Store {
    fn asset_intent_exists(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> {
        intent_exists(self.conn(), owner, id)
    }
}

impl crate::assets::AssetIntentReader for Tx<'_> {
    fn asset_intent_exists(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> {
        intent_exists(self.conn(), owner, id)
    }
}

fn intent_exists(conn: &Connection, owner: &str, id: &str) -> Result<bool, RuntimeError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM _asset_intents WHERE owner=?1 AND intent=?2)",
        [owner, id],
        |r| r.get::<_, bool>(0),
    )?)
}

// @ref LLP 3000.009.001.000#9.1 — an adapter error is terminal; callers roll back rather than continuing.
impl crate::assets::AssetTransaction for Tx<'_> {
    fn pinned_asset_bytes(&self, owner: &str) -> Result<i64, RuntimeError> {
        let mut statement = self.conn().prepare("SELECT a.bytes FROM _asset_intents u JOIN _assets a ON a.id=u.asset WHERE u.owner=?1 AND u.state='pending' AND a.home_table IS NULL AND NOT EXISTS(SELECT 1 FROM _ops o WHERE o.principal=u.owner AND o.id=u.intent) ORDER BY u.intent COLLATE BINARY")?;
        statement.query_map([owner], |r| r.get::<_, i64>(0))?.try_fold(0, |total, bytes| {
            crate::assets::add_pinned_asset_bytes(total, bytes?)
        })
    }

    fn record_uploaded_intent(&self, record: &UploadedIntent<'_>) -> Result<(), RuntimeError> {
        if !intent_exists(self.conn(), record.owner, record.id)? { record.validate_new()?; }
        self.conn().execute("INSERT INTO _asset_intents(owner,intent,fingerprint,asset,facts,placement,state) VALUES(?1,?2,?3,?4,?5,?6,'pending') ON CONFLICT(owner,intent) DO UPDATE SET asset=excluded.asset,facts=excluded.facts,state='pending' WHERE _asset_intents.state='declared'", params![record.owner, record.id, record.fingerprint, record.asset, record.facts, record.placement])?;
        Ok(())
    }

    fn intent_declaration(
        &self,
        owner: &str,
        id: &str,
    ) -> Result<Option<IntentDeclaration>, RuntimeError> {
        Ok(self.conn().query_row("SELECT fingerprint,placement,state FROM _asset_intents WHERE owner=?1 AND intent=?2", [owner, id], |r| Ok(IntentDeclaration { fingerprint: r.get(0)?, placement: r.get(1)?, state: r.get(2)? })).optional()?)
    }

    fn declare_intent(
        &self,
        owner: &str,
        id: &str,
        fingerprint: &str,
        placement: &str,
    ) -> Result<(), RuntimeError> {
        crate::assets::validate_ledger_text(&[owner, id, fingerprint])?;
        self.conn().execute("INSERT INTO _asset_intents(owner,intent,fingerprint,placement,state) VALUES(?1,?2,?3,?4,'declared')", params![owner, id, fingerprint, placement])?;
        Ok(())
    }

    fn intent_placement(
        &self,
        owner: &str,
        id: &str,
    ) -> Result<Option<IntentPlacement>, RuntimeError> {
        Ok(self
            .conn()
            .query_row(
                "SELECT placement,state FROM _asset_intents WHERE owner=?1 AND intent=?2",
                [owner, id],
                |r| {
                    Ok(IntentPlacement {
                        placement: r.get(0)?,
                        state: r.get(1)?,
                    })
                },
            )
            .optional()?)
    }

    fn pending_intents(
        &self,
        owner: &str,
        after: &str,
    ) -> Result<Vec<PendingIntent>, RuntimeError> {
        Ok(self.conn().prepare("SELECT u.intent,u.facts FROM _asset_intents u JOIN _assets a ON a.id=u.asset WHERE u.owner=?1 AND u.intent>?2 AND u.state='pending' AND a.home_table IS NULL AND a.released_at IS NULL AND NOT EXISTS(SELECT 1 FROM _ops o WHERE o.principal=u.owner AND o.id=u.intent) ORDER BY u.intent LIMIT 51")?.query_map([owner, after], |r| Ok(PendingIntent { id: r.get(0)?, facts: r.get(1)? }))?.collect::<Result<_, _>>()?)
    }

    fn intent_cancelled(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> {
        Ok(self.conn().query_row(
            "SELECT state='cancelled' FROM _asset_intents WHERE owner=?1 AND intent=?2",
            [owner, id],
            |r| r.get::<_, bool>(0),
        )?)
    }

    fn settle_intent(&self, owner: &str, id: &str) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _asset_intents SET state='settled' WHERE owner=?1 AND intent=?2 AND state != 'cancelled'", [owner, id])?;
        Ok(())
    }

    fn cancel_intent(&self, owner: &str, id: &str) -> Result<(), RuntimeError> {
        if !intent_exists(self.conn(), owner, id)? { crate::assets::validate_ledger_text(&[owner, id])?; }
        self.conn().execute("INSERT INTO _asset_intents(owner,intent,state) VALUES(?1,?2,'cancelled') ON CONFLICT(owner,intent) DO UPDATE SET state='cancelled'", [owner, id])?;
        Ok(())
    }

    fn asset_ids(&self) -> Result<Vec<String>, RuntimeError> {
        Ok(self
            .conn()
            .prepare("SELECT id FROM _assets ORDER BY id")?
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?)
    }

    fn asset(&self, id: &str) -> Result<Option<Asset>, RuntimeError> {
        self.asset(id)
    }

    fn asset_reserved(&self, id: &str) -> Result<bool, RuntimeError> {
        Ok(self.conn().query_row(
            "SELECT EXISTS(SELECT 1 FROM _asset_gc WHERE asset = ?1)",
            [id],
            |row| row.get::<_, bool>(0),
        )?)
    }

    fn place_asset(
        &self,
        id: &str,
        table: &str,
        row_id: &str,
        column: &str,
    ) -> Result<(), RuntimeError> {
        crate::assets::validate_ledger_text(&[table, column])?;
        if row_id.contains('\0')
            && !(self.catalog.contains_key(table) && self.get(table, row_id)?.is_some())
        {
            crate::assets::validate_ledger_text(&[row_id])?;
        }
        self.conn().execute("UPDATE _assets SET home_table = ?2, home_id = ?3, home_column = ?4, released_at = NULL WHERE id = ?1", params![id, table, row_id, column])?;
        Ok(())
    }

    fn replay_record(
        &self,
        owner: &str,
        id: &str,
    ) -> Result<Option<crate::assets::IntentRecord>, RuntimeError> {
        Ok(self
            .conn()
            .query_row(
                "SELECT fingerprint, facts, state FROM _asset_intents WHERE owner=?1 AND intent=?2",
                [owner, id],
                |r| {
                    Ok(crate::assets::IntentRecord {
                        binding: r.get(0)?,
                        facts: r.get(1)?,
                        state: r.get(2)?,
                    })
                },
            )
            .optional()?)
    }



    fn mutation_executed(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> {
        crate::receipts::ReceiptReader::receipt_exists(self, owner, id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::{AssetIntentReader, AssetTransaction, test_cases};

    fn asset(id: &str) -> Asset {
        Asset {
            id: id.into(),
            owner: "alice".into(),
            kind: AssetKind::File,
            content_type: "application/pdf".into(),
            bytes: 10,
            width: None,
            height: None,
            duration: None,
            created_at: 1,
            home: None,
            released_at: None,
            name: None,
        }
    }

    #[test]
    fn shared_declaration_cases_and_rollback() {
        let mut store = Store::memory().unwrap();
        store.record_asset(&asset("upload")).unwrap();
        let tx = store.transaction().unwrap();
        tx.declare_intent("alice", "declared", "original", "{}")
            .unwrap();
        tx.commit().unwrap();
        test_cases::reader_is_owner_scoped(&store);
        let tx = store.transaction().unwrap();
        test_cases::declarations_and_tombstones(&tx);
        tx.rollback().unwrap();
        assert!(!store.asset_intent_exists("alice", "tombstone").unwrap());
        let tx = store.transaction().unwrap();
        assert_eq!(
            tx.intent_declaration("alice", "declared")
                .unwrap()
                .unwrap()
                .state,
            "declared"
        );
        assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 0);
        tx.rollback().unwrap();
    }

    #[test]
    fn shared_quota_and_recovery_cases() {
        let mut store = Store::memory().unwrap();
        for id in (0..52).map(|n| format!("p{n:02}")).chain(
            [
                "cancelled",
                "settled",
                "executed",
                "released",
                "placed",
                "other",
            ]
            .map(String::from),
        ) {
            store.record_asset(&asset(&id)).unwrap();
            let owner = if id == "other" { "bob" } else { "alice" };
            let tx = store.transaction().unwrap();
            tx.record_uploaded_intent(&UploadedIntent {
                owner,
                id: &id,
                fingerprint: "fp",
                asset: &id,
                facts: "{}",
                placement: None,
            })
            .unwrap();
            tx.commit().unwrap();
        }
        store.conn().execute_batch("UPDATE _asset_intents SET state='cancelled' WHERE intent='cancelled';
            UPDATE _asset_intents SET state='settled' WHERE intent='settled';
            UPDATE _assets SET released_at=2 WHERE id='released';
            UPDATE _assets SET home_table='docs',home_id='row',home_column='doc' WHERE id='placed';
            INSERT INTO _ops(principal,id,seq,outcome) VALUES('alice','executed',1,'{}');
            INSERT INTO _ops(principal,id,seq,outcome) VALUES('bob','p00',1,'{}');
            INSERT INTO _asset_intents(owner,intent,asset,facts,state) VALUES('alice','missing','absent','{}','pending');").unwrap();
        let tx = store.transaction().unwrap();
        test_cases::quota_and_recovery(&tx);
        tx.rollback().unwrap();
    }
}

#[cfg(test)]
#[path = "assets/parity_tests.rs"]
mod parity_tests;

impl crate::assets::AssetPlacementReader for Tx<'_> {
    fn placement_record(
        &self,
        owner: &str,
        id: &str,
    ) -> Result<Option<crate::assets::IntentRecord>, RuntimeError> {
        Ok(self
            .conn()
            .query_row(
                "SELECT placement,facts,state FROM _asset_intents WHERE owner=?1 AND intent=?2",
                [owner, id],
                |r| {
                    Ok(crate::assets::IntentRecord {
                        binding: r.get(0)?,
                        facts: r.get(1)?,
                        state: r.get(2)?,
                    })
                },
            )
            .optional()?)
    }
}
