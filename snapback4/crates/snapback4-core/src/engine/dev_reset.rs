//! A development reset: the adopted schema over an empty store, under a new
//! store identity, optionally reseeded, in one SQLite transaction.
// @ref LLP 3000.007#20.25 — what "fresh" keeps and what it empties; why the head keeps counting.
use super::*;

/// Tables a reset keeps whole: the store's own metadata, the catalog that
/// numbers tables and indexes, and the adopted generations.
const KEPT: [&str; 3] = ["_meta", "_catalog", "_generations"];

/// Identity tables a reset empties except for service seats: the dev
/// worker's session and `snapback4 token` seats outlive a reset, accounts,
/// guests and their sessions do not.
const SERVICE_SEATS: [(&str, &str); 5] = [
    ("_principals", "id"), ("_sessions", "principal"), ("_read_sessions", "principal"),
    ("_principal_generations", "principal"), ("_session_mint_bindings", "principal"),
];

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
        let tx = self.store.transaction()?;
        let previous_store_id = tx.meta("store_id")?.unwrap_or_default();
        let head = tx.next_seq()?.saturating_sub(1);
        let assets: Vec<String> = tx.conn().prepare("SELECT id FROM _assets")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
        let tables: Vec<String> = tx.conn()
            .prepare("SELECT name FROM main.sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'")?
            .query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
        for table in &tables {
            if KEPT.contains(&table.as_str()) { continue; }
            let quoted = format!("\"{}\"", table.replace('"', "\"\""));
            match SERVICE_SEATS.iter().find(|(name, _)| name == table) {
                Some((_, column)) => tx.conn().execute(&format!("DELETE FROM {quoted} WHERE substr({column}, 1, ?2) <> ?1"),
                    rusqlite::params![crate::identity::SERVICE_PREFIX, crate::identity::SERVICE_PREFIX.len() as i64])?,
                None => tx.conn().execute(&format!("DELETE FROM {quoted}"), [])?,
            };
        }
        // A fresh store has no schedule boundary: the next tick records the
        // current one without firing a missed period. Replay's count restarts.
        tx.conn().execute("DELETE FROM _meta WHERE key LIKE 'schedule:%' OR key LIKE 'schedule-shape:%' OR key = 'dev:suppressed-effects'", [])?;
        tx.conn().execute("UPDATE _meta SET value = lower(hex(randomblob(16))) WHERE key = 'store_id'", [])?;
        let store_id = tx.meta("store_id")?.unwrap_or_default();
        // Every table changed: no change evidence may certify an interval
        // across the reset.
        tx.changes.borrow_mut().widen();
        let touched: Vec<String> = self.schema.visible_tables().map(|(name, _)| name.clone()).collect();
        tx.record_commit(head + 1, now, "dev reset", crate::SYSTEM_PRINCIPAL, "reset", &touched, 0)?;
        let seeded = seed_rows(&self.schema, &tx, rows, now)?;
        let seq = tx.next_seq()?.saturating_sub(1);
        tx.commit()?;
        self.timeline_schedule = timeline::Schedule::default();
        self.ephemeral.rebind_committed(store_id.clone(), self.generation, &self.schema);
        Ok(DevReset { previous_store_id, store_id, seq, seeded, assets: assets::AssetSweep::named(assets, self.store.assets_dir()) })
    }
}
