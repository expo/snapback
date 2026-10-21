//! A development reset: the adopted schema over an empty store, under a new
//! store identity, optionally reseeded, in one SQLite transaction.
// @ref LLP 3000.007#20.25 — what "fresh" keeps and what it empties; why the head keeps counting.
use super::*;


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
        pin_clock: impl FnOnce(&committer::MemberTx<'_, '_>) -> Result<i64, RuntimeError>,
        inventory_assets: impl FnOnce(&committer::MemberTx<'_, '_>) -> Result<Vec<String>, RuntimeError>,
        prime_schedules: impl FnOnce(&committer::MemberTx<'_, '_>, i64) -> Result<(), RuntimeError>,
        seed: impl FnOnce(&committer::MemberTx<'_, '_>, u64, i64) -> Result<u64, RuntimeError>,
    ) -> Result<committer::Resolution<ResetState>, RuntimeError>;
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
        let directory = self.store.asset_location()?.directory().to_path_buf();
        // Like adoption: no ephemeral program runs across the identity change.
        drop(self.ephemeral.lock()?);
        Ok(Committer::run_committed_with(self, |engine| {
            let schema = &engine.schema;
            engine.store.dev_reset(
            |tx| tx.pin_writer_time(schema, now),
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
                tx.record_commit(head + 1, now, ("dev reset", crate::SYSTEM_PRINCIPAL, "reset"), &touched, 0)?;
                tx.prepare_seed_inputs(schema)?;
                tx.seed_rows(schema, rows, now)
            },
            )
        }, |engine, (), ResetState { previous_store_id, store_id, seq, seeded, assets }| {
            // A new store identity starts a fresh bounded expiry walk. Clear only
            // after commit so a refused reset keeps the old store's continuation.
            engine.expiry_after.clear();
            engine.timeline_schedule = timeline::Schedule::default();
            engine.ephemeral.rebind_committed(store_id.clone(), engine.generation, &engine.schema);
            Ok(DevReset { previous_store_id, store_id, seq, seeded, assets: assets::AssetSweep::named(assets, &directory) })
        })?.into_inner())
    }
}
