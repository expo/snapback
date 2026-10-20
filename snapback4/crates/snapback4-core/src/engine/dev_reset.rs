//! A development reset: the adopted schema over an empty store, under a new
//! store identity, optionally reseeded, in one SQLite transaction.
// @ref LLP 3000.007#20.25 — what "fresh" keeps and what it empties; why the head keeps counting.
use super::*;
use crate::assets::AssetTransaction;

use crate::engine::job::JobTransaction;

pub(crate) struct ResetState {
    pub previous_store_id: String,
    pub store_id: String,
    pub seq: u64,
    pub seeded: u64,
    pub assets: Vec<String>,
}

/// Ordered storage reset with engine policy at the original statement boundaries.
// P1: implement the reset transaction for Postgres.
pub(crate) trait DevResetStore {
    fn dev_reset(
        &mut self,
        pin_clock: impl FnOnce(&crate::store::Tx<'_>) -> Result<i64, RuntimeError>,
        inventory_assets: impl FnOnce(&crate::store::Tx<'_>) -> Result<Vec<String>, RuntimeError>,
        prime_schedules: impl FnOnce(&crate::store::Tx<'_>, i64) -> Result<(), RuntimeError>,
        seed: impl FnOnce(&crate::store::Tx<'_>, u64, i64) -> Result<u64, RuntimeError>,
    ) -> Result<Committed<ResetState>, RuntimeError>;
}

/// What a development reset did. The caller unlinks `assets` after the
/// commit, outside any engine guard it holds.
#[derive(Debug)]
pub struct DevReset {
    pub previous_store_id: String,
    pub store_id: String,
    /// The store's head after the reset and any reseed.
    pub seq: u64,
    pub seeded: u64,
    pub assets: assets::AssetSweep,
}

impl Engine {
    /// Empty every application table and everything derived from them
    /// (views, maintained columns, indexes, counts, the partition log),
    /// every queue (effects, jobs, actions), uploaded assets and every
    /// non-service account and session; keep the adopted schema and
    /// generation. The store takes a new identity so a connected device
    /// re-acquires instead of keeping its partition; the head keeps counting
    /// (the reset is itself a commit). `rows` are then written as `/seed`
    /// writes them, in the same transaction. Development only: the release
    /// host never calls this.
    pub fn dev_reset_at(&mut self, rows: Vec<(String, Value)>, now: i64) -> Result<DevReset, RuntimeError> {
        // Like adoption: no ephemeral program runs across the identity change.
        drop(self.ephemeral.lock()?);
        let schema = &self.schema;
        let committed = self.store.dev_reset(
            |tx| time_audience::pin_writer_time(schema, tx, now),
            |tx| tx.asset_ids(),
            |tx, now| {
                for schedule in &schema.schedules {
                    tx.set_schedule_boundary(&schedule.name, schedule.boundary(now))?;
                    tx.set_schedule_shape(&schedule.name, &crate::value::digest(schedule))?;
                }
                Ok(())
            },
            |tx, head, now| {
                let touched: Vec<String> = schema.visible_tables().map(|(name, _)| name.clone()).collect();
                tx.record_commit(head + 1, now, "dev reset", crate::SYSTEM_PRINCIPAL, "reset", &touched, 0)?;
                if crate::store::backfills::has_evidence(tx)? {crate::store::backfills::prepare_inputs(tx,schema,None)?;}
                seed_rows(schema, tx, rows, now)
            },
        )?;
        Ok(committed.after_commit(|ResetState { previous_store_id, store_id, seq, seeded, assets }| {
            // A new store identity starts a fresh bounded expiry walk. Clear only
            // after commit so a refused reset keeps the old store's continuation.
            self.expiry_after.clear();
            self.timeline_schedule = timeline::Schedule::default();
            self.ephemeral.rebind_committed(store_id.clone(), self.generation, &self.schema);
            DevReset { previous_store_id, store_id, seq, seeded, assets: assets::AssetSweep::named(assets, self.store.assets_dir()) }
        }).into_inner())
    }
}
