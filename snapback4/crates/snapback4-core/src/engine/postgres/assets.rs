//! Asset ledger facts on the existing serialized Postgres transaction.
//! Bytes retain the local-file custody path; the Postgres host is P1b.
// @ref LLP 3000.009.001.000#3.1 — policy is shared; this adapter only stores ledger facts.
use super::store::{Store, Tx};
use crate::{
    RuntimeError,
    assets::{
        self, Asset, AssetIntentReader, AssetKind, AssetTransaction, IntentDeclaration,
        IntentPlacement, IntentRecord, PendingIntent, UNCLAIMED_TTL_MS, UploadedIntent,
    },
};
use std::cell::RefCell;

fn nul(values: &[&str]) -> bool {
    values.iter().any(|value| value.contains('\0'))
}
fn missing() -> RuntimeError {
    RuntimeError::Sql(rusqlite::Error::QueryReturnedNoRows)
}

fn read(row: &postgres::Row) -> Result<Asset, RuntimeError> {
    let home: (Option<String>, Option<String>, Option<String>) = (
        row.try_get("home_table")?,
        row.try_get("home_id")?,
        row.try_get("home_column")?,
    );
    Ok(Asset {
        id: row.try_get("id")?,
        owner: row.try_get("owner")?,
        kind: match row.try_get::<_, &str>("kind")? {
            "video" => AssetKind::Video,
            "file" => AssetKind::File,
            _ => AssetKind::Image,
        },
        content_type: row.try_get("content_type")?,
        bytes: row.try_get::<_, i64>("bytes")? as u64,
        width: row.try_get::<_, Option<i64>>("width")?.map(|v| v as u32),
        height: row.try_get::<_, Option<i64>>("height")?.map(|v| v as u32),
        duration: row.try_get::<_, Option<i64>>("duration")?.map(|v| v as u64),
        created_at: row.try_get("created_at")?,
        home: match home {
            (Some(t), Some(r), Some(c)) => Some((t, r, c)),
            _ => None,
        },
        released_at: row.try_get("released_at")?,
        name: row.try_get("name")?,
    })
}

impl AssetIntentReader for RefCell<&mut Store> {
    fn asset_intent_exists(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> {
        if nul(&[owner, id]) {
            return Ok(false);
        }
        let mut store = self.borrow_mut();
        let tx = store.transaction(None)?;
        let found = tx.asset_intent_exists(owner, id)?;
        tx.rollback()?;
        Ok(found)
    }
}

impl AssetIntentReader for Tx<'_> {
    fn asset_intent_exists(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> {
        if nul(&[owner, id]) {
            return Ok(false);
        }
        Ok(self.query(
            "SELECT EXISTS(SELECT 1 FROM _asset_intents WHERE owner=$1 AND intent=$2)",
            &[&owner, &id],
        )?[0]
            .get(0))
    }
}

impl AssetTransaction for Tx<'_> {
    fn pinned_asset_bytes(&self, owner: &str) -> Result<i64, RuntimeError> {
        if nul(&[owner]) {
            return Ok(0);
        }
        // SUM(bigint) is NUMERIC on Postgres. Cast the exact sum, never through
        // floating point; an overflowing aggregate is terminal on both stores.
        Ok(self.query("SELECT COALESCE(SUM(a.bytes),0)::bigint FROM _asset_intents u JOIN _assets a ON a.id=u.asset WHERE u.owner=$1 AND u.state='pending' AND a.home_table IS NULL AND NOT EXISTS(SELECT 1 FROM _ops o WHERE o.principal=u.owner AND o.id=u.intent)", &[&owner])?[0].try_get(0)?)
    }

    fn record_uploaded_intent(&self, record: &UploadedIntent<'_>) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("publish asset intent")?;
        if !self.asset_intent_exists(record.owner, record.id)? {
            record.validate_new()?;
        }
        self.execute("INSERT INTO _asset_intents(owner,intent,fingerprint,asset,facts,placement,state) VALUES($1,$2,$3,$4,$5,$6,'pending') ON CONFLICT(owner,intent) DO UPDATE SET asset=excluded.asset,facts=excluded.facts,state='pending' WHERE _asset_intents.state='declared'", &[&record.owner,&record.id,&record.fingerprint,&record.asset,&record.facts,&record.placement])?;
        Ok(())
    }

    fn intent_declaration(
        &self,
        owner: &str,
        id: &str,
    ) -> Result<Option<IntentDeclaration>, RuntimeError> {
        if nul(&[owner, id]) {
            return Ok(None);
        }
        self.query(
            "SELECT fingerprint,placement,state FROM _asset_intents WHERE owner=$1 AND intent=$2",
            &[&owner, &id],
        )?
        .first()
        .map(|r| {
            Ok(IntentDeclaration {
                fingerprint: r.try_get(0)?,
                placement: r.try_get(1)?,
                state: r.try_get(2)?,
            })
        })
        .transpose()
    }

    fn declare_intent(
        &self,
        owner: &str,
        id: &str,
        fingerprint: &str,
        placement: &str,
    ) -> Result<(), RuntimeError> {
        assets::validate_ledger_text(&[owner, id, fingerprint])?;
        self.require_serialized_head_fence("declare asset intent")?;
        self.execute("INSERT INTO _asset_intents(owner,intent,fingerprint,placement,state) VALUES($1,$2,$3,$4,'declared')", &[&owner,&id,&fingerprint,&placement])?;
        Ok(())
    }

    fn intent_placement(
        &self,
        owner: &str,
        id: &str,
    ) -> Result<Option<IntentPlacement>, RuntimeError> {
        if nul(&[owner, id]) {
            return Ok(None);
        }
        self.query(
            "SELECT placement,state FROM _asset_intents WHERE owner=$1 AND intent=$2",
            &[&owner, &id],
        )?
        .first()
        .map(|r| {
            Ok(IntentPlacement {
                placement: r.try_get(0)?,
                state: r.try_get(1)?,
            })
        })
        .transpose()
    }

    fn pending_intents(
        &self,
        owner: &str,
        after: &str,
    ) -> Result<Vec<PendingIntent>, RuntimeError> {
        if nul(&[owner]) {
            return Ok(vec![]);
        }
        // A cursor is an ordering bound, not a key lookup. Against NUL-free
        // keys, > prefix\0suffix is exactly > prefix under byte ordering.
        let after = after.split('\0').next().unwrap_or("");
        self.query("SELECT u.intent,u.facts FROM _asset_intents u JOIN _assets a ON a.id=u.asset WHERE u.owner=$1 AND u.intent>$2 AND u.state='pending' AND a.home_table IS NULL AND a.released_at IS NULL AND NOT EXISTS(SELECT 1 FROM _ops o WHERE o.principal=u.owner AND o.id=u.intent) ORDER BY u.intent LIMIT 51", &[&owner,&after])?.iter().map(|r| Ok(PendingIntent {id:r.try_get(0)?,facts:r.try_get(1)?})).collect()
    }

    fn intent_cancelled(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> {
        if nul(&[owner, id]) {
            return Err(missing());
        }
        self.query(
            "SELECT state='cancelled' FROM _asset_intents WHERE owner=$1 AND intent=$2",
            &[&owner, &id],
        )?
        .first()
        .ok_or_else(missing)?
        .try_get(0)
        .map_err(Into::into)
    }

    fn settle_intent(&self, owner: &str, id: &str) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("settle asset intent")?;
        if nul(&[owner, id]) {
            return Ok(());
        }
        self.execute("UPDATE _asset_intents SET state='settled' WHERE owner=$1 AND intent=$2 AND state != 'cancelled'", &[&owner,&id])?;
        Ok(())
    }

    fn cancel_intent(&self, owner: &str, id: &str) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("cancel asset intent")?;
        if !self.asset_intent_exists(owner, id)? {
            assets::validate_ledger_text(&[owner, id])?;
        }
        self.execute("INSERT INTO _asset_intents(owner,intent,state) VALUES($1,$2,'cancelled') ON CONFLICT(owner,intent) DO UPDATE SET state='cancelled'", &[&owner,&id])?;
        Ok(())
    }

    fn asset_ids(&self) -> Result<Vec<String>, RuntimeError> {
        Ok(self
            .query("SELECT id FROM _assets ORDER BY id", &[])?
            .iter()
            .map(|r| r.get(0))
            .collect())
    }

    fn asset(&self, id: &str) -> Result<Option<Asset>, RuntimeError> {
        if nul(&[id]) {
            return Ok(None);
        }
        self.query("SELECT id,owner,kind,content_type,bytes,width,height,duration,created_at,home_table,home_id,home_column,released_at,name FROM _assets WHERE id=$1", &[&id])?.first().map(read).transpose()
    }

    fn asset_reserved(&self, id: &str) -> Result<bool, RuntimeError> {
        if nul(&[id]) {
            return Ok(false);
        }
        Ok(self.query(
            "SELECT EXISTS(SELECT 1 FROM _asset_gc WHERE asset=$1)",
            &[&id],
        )?[0]
            .get(0))
    }

    fn place_asset(
        &self,
        id: &str,
        table: &str,
        row_id: &str,
        column: &str,
    ) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("place asset")?;
        if nul(&[id]) {
            return Ok(());
        }
        assets::validate_ledger_text(&[table, row_id, column])?;
        self.execute("UPDATE _assets SET home_table=$2,home_id=$3,home_column=$4,released_at=NULL WHERE id=$1", &[&id,&table,&row_id,&column])?;
        Ok(())
    }

    fn replay_record(&self, owner: &str, id: &str) -> Result<Option<IntentRecord>, RuntimeError> {
        if nul(&[owner, id]) {
            return Ok(None);
        }
        self.query(
            "SELECT fingerprint,facts,state FROM _asset_intents WHERE owner=$1 AND intent=$2",
            &[&owner, &id],
        )?
        .first()
        .map(|r| {
            Ok(IntentRecord {
                binding: r.try_get(0)?,
                facts: r.try_get(1)?,
                state: r.try_get(2)?,
            })
        })
        .transpose()
    }

    fn placement_record(
        &self,
        owner: &str,
        id: &str,
    ) -> Result<Option<IntentRecord>, RuntimeError> {
        if nul(&[owner, id]) {
            return Ok(None);
        }
        self.query(
            "SELECT placement,facts,state FROM _asset_intents WHERE owner=$1 AND intent=$2",
            &[&owner, &id],
        )?
        .first()
        .map(|r| {
            Ok(IntentRecord {
                binding: r.try_get(0)?,
                facts: r.try_get(1)?,
                state: r.try_get(2)?,
            })
        })
        .transpose()
    }

    fn mutation_executed(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> {
        if nul(&[owner, id]) {
            return Ok(false);
        }
        Ok(self.query(
            "SELECT EXISTS(SELECT 1 FROM _ops WHERE principal=$1 AND id=$2)",
            &[&owner, &id],
        )?[0]
            .get(0))
    }
}

// These ledger operations match SQLite's inherent methods. P1b will route the
// host to them; keeping the byte writer out of this adapter is intentional.
#[allow(dead_code)]
impl Tx<'_> {
    pub(super) fn record_asset(&self, asset: &Asset) -> Result<(), RuntimeError> {
        assets::validate_ledger_text(&[
            &asset.id,
            &asset.owner,
            &asset.content_type,
            asset.name.as_deref().unwrap_or(""),
        ])?;
        self.require_serialized_head_fence("record asset")?;
        self.execute("INSERT INTO _assets(id,owner,kind,content_type,bytes,width,height,duration,created_at,home_table,home_id,home_column,released_at,name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,NULL,NULL,$10)", &[&asset.id,&asset.owner,&asset.kind.word(),&asset.content_type,&(asset.bytes as i64),&asset.width.map(i64::from),&asset.height.map(i64::from),&asset.duration.map(|d| d as i64),&asset.created_at,&asset.name])?;
        Ok(())
    }

    pub(super) fn stale_assets(&self, now: i64) -> Result<Vec<Asset>, RuntimeError> {
        self.query("SELECT id,owner,kind,content_type,bytes,width,height,duration,created_at,home_table,home_id,home_column,released_at,name FROM _assets WHERE released_at IS NOT NULL OR (home_table IS NULL AND created_at < $1 AND NOT EXISTS(SELECT 1 FROM _asset_intents u WHERE u.asset=_assets.id AND u.state='pending' AND NOT EXISTS(SELECT 1 FROM _ops o WHERE o.principal=u.owner AND o.id=u.intent))) ORDER BY created_at,id LIMIT 256", &[&(now-UNCLAIMED_TTL_MS)])?.iter().map(read).collect()
    }

    pub(super) fn stage_stale_assets_for(
        &self,
        now: i64,
        budget: std::time::Duration,
    ) -> Result<Vec<Asset>, RuntimeError> {
        self.require_serialized_head_fence("stage stale assets")?;
        let started = std::time::Instant::now();
        let mut assets = self.stale_assets(now)?;
        let mut staged = 0;
        for asset in &assets {
            if staged > 0 && started.elapsed() >= budget {
                break;
            }
            self.execute(
                "INSERT INTO _asset_gc(asset) VALUES($1) ON CONFLICT(asset) DO NOTHING",
                &[&asset.id],
            )?;
            self.execute(
                "UPDATE _assets SET released_at=COALESCE(released_at,$2) WHERE id=$1",
                &[&asset.id, &now],
            )?;
            staged += 1;
        }
        assets.truncate(staged);
        Ok(assets)
    }

    pub(super) fn forget_asset(&self, id: &str) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("forget asset")?;
        if nul(&[id]) {
            return Ok(());
        }
        self.execute("DELETE FROM _asset_views WHERE asset=$1", &[&id])?;
        self.execute("DELETE FROM _asset_gc WHERE asset=$1", &[&id])?;
        self.execute("DELETE FROM _assets WHERE id=$1", &[&id])?;
        Ok(())
    }

    pub(super) fn release_asset(
        &self,
        id: &str,
        table: &str,
        row_id: &str,
        column: &str,
        now: i64,
    ) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("release asset")?;
        if nul(&[id, table, row_id, column]) {
            return Ok(());
        }
        self.execute("UPDATE _assets SET released_at=$2,home_table=NULL,home_id=NULL,home_column=NULL WHERE id=$1 AND released_at IS NULL AND home_table=$3 AND home_id=$4 AND home_column=$5", &[&id,&now,&table,&row_id,&column])?;
        Ok(())
    }

    pub(super) fn asset_viewed(&self, id: &str, principal: &str) -> Result<bool, RuntimeError> {
        if nul(&[id, principal]) {
            return Ok(false);
        }
        Ok(self.query(
            "SELECT EXISTS(SELECT 1 FROM _asset_views WHERE asset=$1 AND principal=$2)",
            &[&id, &principal],
        )?[0]
            .get(0))
    }

    pub(super) fn record_asset_view(
        &self,
        id: &str,
        principal: &str,
        now: i64,
    ) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("record asset view")?;
        if !self.asset_viewed(id, principal)? {
            assets::validate_ledger_text(&[id, principal])?;
        }
        self.execute("INSERT INTO _asset_views(asset,principal,at) VALUES($1,$2,$3) ON CONFLICT(asset,principal) DO NOTHING", &[&id,&principal,&now])?;
        Ok(())
    }
}
