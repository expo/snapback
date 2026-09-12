//! Snapshot isolation and bounded observation of would-be external side effects.
use crate::{RuntimeError, Store, Value};
use rusqlite::{Connection, backup::Backup, params};
use std::{path::Path, time::Duration};

/// One emission the rehearsal would have delivered, as the effect would receive it.
pub struct RehearsalEmit {
    pub effect: String,
    pub payload: Value,
}

/// One asset the rehearsal would have released from its cell (never reclaimed).
pub struct RehearsalRelease {
    pub id: String,
    pub bytes: Option<u64>,
    pub table: String,
    pub row: String,
    pub column: String,
}

pub struct RehearsalSideEffects {
    pub effect_count: u64,
    pub effects: Vec<RehearsalEmit>,
    pub asset_release_count: u64,
    pub assets_released: Vec<RehearsalRelease>,
}

impl Store {
    // @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — a snapshot must not reuse the live allocator's namespace or outstanding id ranges.
    pub fn snapshot_rehearsal_to(&self, path: &Path) -> Result<(), RuntimeError> {
        let mut copy = Connection::open(path)?;
        // The copy is taken on the owner's only store connection, so pacing the
        // backup (as the fork primitive does) would only lengthen the writer's
        // pause: copy every page in one step.
        Backup::new(&self.conn, &mut copy)?.run_to_completion(1 << 20, Duration::ZERO, None)?;
        let tx = copy.transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO _meta(key,value) VALUES ('id_namespace',lower(hex(randomblob(16))))",
            [],
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO _meta(key,value) VALUES ('id_high_water','0')",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Connection-local observation only: capture releases inside the same transaction
    /// as the program, so a rejected chunk reports no rolled-back releases.
    pub fn observe_rehearsal_releases(&self) -> Result<(), RuntimeError> {
        self.conn.execute_batch(
            "CREATE TEMP TABLE rehearsal_releases (
                id TEXT PRIMARY KEY, bytes INTEGER, table_name TEXT, row_id TEXT, column_name TEXT
             );
             CREATE TEMP TRIGGER rehearsal_release AFTER UPDATE ON main._assets
             WHEN OLD.locator_table IS NOT NULL AND NEW.locator_table IS NULL
             BEGIN
               INSERT OR IGNORE INTO rehearsal_releases
               VALUES (OLD.id, OLD.bytes, OLD.locator_table, OLD.locator_row, OLD.locator_column);
             END;",
        )?;
        Ok(())
    }

    /// Every outbox row the rehearsal added and every release it recorded, counted in
    /// full and listed up to `limit` each.
    pub fn rehearsal_side_effects(
        &self,
        after: u64,
        limit: u32,
    ) -> Result<RehearsalSideEffects, RuntimeError> {
        let effect_count: u64 = self.conn.query_row(
            "SELECT count(*) FROM _outbox WHERE seq > ?1",
            [after],
            |r| r.get(0),
        )?;
        let mut stmt = self.conn.prepare(
            "SELECT effect, payload FROM _outbox WHERE seq > ?1 ORDER BY seq, id LIMIT ?2",
        )?;
        let effects = stmt
            .query_map(params![after, limit], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(effect, payload)| {
                Ok(RehearsalEmit {
                    effect,
                    payload: serde_json::from_str(&payload)
                        .map_err(|e| RuntimeError::Serialization(e.to_string()))?,
                })
            })
            .collect::<Result<Vec<_>, RuntimeError>>()?;
        let asset_release_count: u64 =
            self.conn
                .query_row("SELECT count(*) FROM rehearsal_releases", [], |r| r.get(0))?;
        let mut stmt = self.conn.prepare(
            "SELECT id, bytes, table_name, row_id, column_name FROM rehearsal_releases
             ORDER BY id LIMIT ?1",
        )?;
        let assets_released = stmt
            .query_map([limit], |r| {
                Ok(RehearsalRelease {
                    id: r.get(0)?,
                    bytes: r.get(1)?,
                    table: r.get(2)?,
                    row: r.get(3)?,
                    column: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(RehearsalSideEffects {
            effect_count,
            effects,
            asset_release_count,
            assets_released,
        })
    }
}
