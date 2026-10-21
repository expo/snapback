//! Development reset storage, in its original single transaction and order.
// @ref LLP 3000.007#20.25 — preserve service seats and schema while rotating store identity.
use crate::engine::committer::{Committed, Committer, Kind, Member, MemberTx};
use crate::rows::Rows;

use super::*;
use crate::engine::dev_reset::{DevResetStore, ResetState};

/// Tables a reset keeps whole: the store's own metadata, the catalog that
/// numbers tables and indexes, and the adopted generations.
const KEPT: [&str; 3] = ["_meta", "_catalog", "_generations"];

/// Identity tables a reset empties except for service seats: the dev
/// worker's session and `snapback4 token` seats outlive a reset, accounts,
/// guests and their sessions do not.
const SERVICE_SEATS: [(&str, &str); 5] = [
    ("_principals", "id"),
    ("_sessions", "principal"),
    ("_read_sessions", "principal"),
    ("_principal_generations", "principal"),
    ("_session_mint_bindings", "principal"),
];

impl DevResetStore for Store {
    fn dev_reset(
        &mut self,
        pin_clock: impl FnOnce(&MemberTx<'_, '_>) -> Result<i64, RuntimeError>,
        inventory_assets: impl FnOnce(&MemberTx<'_, '_>) -> Result<Vec<String>, RuntimeError>,
        prime_schedules: impl FnOnce(&MemberTx<'_, '_>, i64) -> Result<(), RuntimeError>,
        seed: impl FnOnce(&MemberTx<'_, '_>, u64, i64) -> Result<u64, RuntimeError>,
    ) -> Result<Committed<ResetState>, RuntimeError> {
        Committer::run_committed(
            self,
            Member::new(Kind::Administrative, |tx| {
                // @ref LLP 3000.000.000.000.000#2-fixture-semantics — a new identity cannot inherit the retired store's future clock.
                tx.reset_clock()?;
                let now = pin_clock(&tx)?;
                let previous_store_id = tx.store_identity()?.unwrap_or_default();
                let head = tx.next_seq()?.saturating_sub(1);
                let assets = inventory_assets(&tx)?;
                tx.reset_tables()?;
                prime_schedules(&tx, now)?;
                tx.reset_identity()?;
                let store_id = tx.store_identity()?.unwrap_or_default();
                // No change evidence may certify an interval across the reset.
                tx.widen_change_evidence();
                let seeded = seed(&tx, head, now)?;
                let seq = tx.next_seq()?.saturating_sub(1);
                tx.complete(ResetState {
                    previous_store_id,
                    store_id,
                    seq,
                    seeded,
                    assets,
                })
            }),
        )
    }
}

impl Tx<'_> {
    pub(crate) fn reset_clock(&self) -> Result<(), RuntimeError> {
        self.conn()
            .execute("DELETE FROM _meta WHERE key = 'time_audience_clock'", [])?;
        Ok(())
    }
    pub(crate) fn reset_tables(&self) -> Result<(), RuntimeError> {
        let tables: Vec<String> = self.conn()
                .prepare("SELECT name FROM main.sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'")?
                .query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
        // @ref LLP 3000.039#6.5 — reset every table without referential actions.
        for table in &tables {
            if KEPT.contains(&table.as_str()) {
                continue;
            }
            let quoted = format!("\"{}\"", table.replace('"', "\"\""));
            match SERVICE_SEATS.iter().find(|(name, _)| name == table) {
                Some((_, column)) => self.conn().execute(
                    &format!("DELETE FROM {quoted} WHERE substr({column}, 1, ?2) <> ?1"),
                    rusqlite::params![
                        crate::identity::SERVICE_PREFIX,
                        crate::identity::SERVICE_PREFIX.len() as i64
                    ],
                )?,
                None => self.conn().execute(&format!("DELETE FROM {quoted}"), [])?,
            };
        }
        // Prime at the reset clock; replay's suppression count restarts.
        self.conn().execute("DELETE FROM _meta WHERE key LIKE 'schedule:%' OR key LIKE 'schedule-shape:%' OR key = 'dev:suppressed-effects'", [])?;
        Ok(())
    }
    pub(crate) fn reset_identity(&self) -> Result<(), RuntimeError> {
        self.conn().execute(
            "UPDATE _meta SET value = lower(hex(randomblob(16))) WHERE key = 'store_id'",
            [],
        )?;
        Ok(())
    }
}
