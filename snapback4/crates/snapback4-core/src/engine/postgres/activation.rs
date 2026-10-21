//! Opening facts and atomic generation publication under the head fence.
// @ref LLP 3000.009.001.000#3.4 — the public bootstrap needs persisted backend facts, even while evolution remains refused.
use super::store::{Store, Tx, absent_text_key, signed};
use crate::{RuntimeError, Schema, Program, Value, activation::{self, ActivationReader, ActivationTransaction, ActivationPreparation, Backend, TimelineWorkReader}, engine::release::ReleaseTransaction, metadata::{RestoredPopulation, SchemaMarker, MetadataReader}, release_history::DormantItem, value::canonical_json};
use std::{cell::RefCell, collections::BTreeMap};

pub(super) fn initialize(tx: &Tx<'_>, schema: &Schema, programs: &BTreeMap<String, Program>, generation: u64, now: i64) -> Result<(), RuntimeError> {
    super::activation_schema::initialize(tx)?;
    if tx.meta("store_id")?.is_none() { tx.set_meta("store_id", &format!("{:016x}{:016x}", crate::ids::seed(), crate::ids::seed()))?; }
    // An evaluator's already-qualified internal upgrades precede this record.
    // History is append-only: conflicting bytes for an existing generation refuse.
    tx.publish_backend(&Backend(signed(generation)?, canonical_json(schema), canonical_json(programs)), now)?;
    tx.set_meta("schema_hash", &schema.hash())?;
    tx.set_meta("activation_hash", &activation::activation_hash(schema, programs, tx.meta("release_native_digest")?.as_deref()))?;
    tx.mark_live_sum_candidates()?;
    if schema.maintains.iter().any(|m| m.row_key.is_none()) { tx.mark_maintained_ids()?; }
    if crate::rows::caps::required(schema) { tx.set_meta("cap_counts_schema", &schema.hash())?; }
    // No timed table is admitted. The empty publication index is complete.
    tx.set_meta("time_audience_publications_v1", "1")?;
    Ok(())
}

impl Tx<'_> {
    /// Install only already-admitted metadata. Row evolution/rebuild policy is
    /// deliberately not hidden in this operation; callers preflight it first.
    pub(super) fn publish_backend(&self, backend: &Backend, now: i64) -> Result<(), RuntimeError> {
        let Backend(generation, schema, programs) = backend;
        if *generation <= 0 { return Err(RuntimeError::Generation("invalid stored generation".into())); }
        let existing = self.query("SELECT schema,programs FROM _generations WHERE generation=$1", &[generation])?;
        if let Some(row) = existing.first() {
            activation::check_backend(&Backend(*generation, row.get(0), row.get(1)), backend)?;
        } else {
            self.execute_one("INSERT INTO _generations(generation,schema,programs,at) VALUES ($1,$2,$3,$4)", &[generation, schema, programs, &now])?;
        }
        self.execute_one("UPDATE _backend SET generation=$1,schema=$2,programs=$3 WHERE singleton", &[generation, schema, programs])?;
        self.set_meta("generation", &generation.to_string())?;
        let schema: Schema = super::store::decode(schema)?;
        let mut next: i64 = self.query("SELECT COALESCE(MAX(num),0) FROM _catalog", &[])?[0].get(0);
        for (name, table) in schema.tables.iter().filter(|(_, t)| t.ephemeral.is_none()) {
            for name in std::iter::once(name.clone()).chain(table.indexes.keys().map(|index| format!("{name}.{index}"))) {
                if self.query("SELECT num FROM _catalog WHERE name=$1", &[&name])?.is_empty() {
                    next = next.checked_add(1).ok_or_else(|| RuntimeError::Generation("catalog number exhausted".into()))?;
                    self.execute_one("INSERT INTO _catalog(name,num) VALUES ($1,$2)", &[&name, &next])?;
                }
            }
        }
        Ok(())
    }
}

impl ActivationReader for Tx<'_> {
    fn opening_backend(&self) -> Result<Backend, RuntimeError> {
        let rows = self.query("SELECT g.generation,g.schema,g.programs FROM _generations g JOIN _meta m ON m.key='generation' AND g.generation=m.value::bigint", &[])?;
        let row = rows.first().ok_or_else(|| RuntimeError::Store("no readable activated backend in this store".into()))?;
        Ok(Backend(row.get(0), row.get(1), row.get(2)))
    }
    fn check_selected_release(&self, expected: Option<u64>) -> Result<(), RuntimeError> {
        activation::check_selected(self.meta("release")?.as_deref(), expected)
    }
    fn time_audience_clock(&self) -> Result<i64, RuntimeError> {
        Ok(self.meta("time_audience_clock")?.and_then(|v| v.parse().ok()).unwrap_or(i64::MIN))
    }
    fn opening_marker(&self, marker: SchemaMarker) -> Result<Option<String>, RuntimeError> { self.schema_marker(marker) }
    fn previous_schema(&self) -> Result<Option<String>, RuntimeError> {
        Ok(self.query("SELECT g.schema FROM _generations g JOIN _meta m ON m.key='generation' AND g.generation=m.value::bigint", &[])?.first().map(|r| r.get(0)))
    }
    fn live_sum_marker(&self) -> Result<Option<String>, RuntimeError> { self.meta("live_sum_candidates") }
    fn activation_population(&self) -> Result<Option<String>, RuntimeError> { self.meta("activation_population") }
    fn narrowed_retained(&self) -> Result<Option<String>, RuntimeError> { self.meta("activation_narrowed_retained") }
    fn narrowed_restored(&self) -> Result<Option<String>, RuntimeError> { self.meta("activation_narrowed_restored") }
    fn restored_population(&self, kind: RestoredPopulation, path: &str) -> Result<Option<String>, RuntimeError> {
        let prefix = match kind { RestoredPopulation::Rows => "activation_narrowed_restored", RestoredPopulation::Column => "activation_column_restored", RestoredPopulation::Table => "activation_table_restored" };
        self.meta(&format!("{prefix}:{path}"))
    }
    fn activation_inventory(&self) -> Result<Vec<DormantItem>, RuntimeError> {
        // No Postgres evolution is admitted; no hidden retained population exists.
        Ok(Vec::new())
    }
    fn table_populated(&self, table: &str) -> Result<bool, RuntimeError> {
        if absent_text_key(&[table]) { return Ok(false); }
        Ok(self.query("SELECT EXISTS(SELECT 1 FROM r WHERE t=$1)", &[&table])?[0].get(0))
    }
    fn any_table_image(&self, table: &str, mut survives: impl FnMut(&Value) -> bool) -> Result<bool, RuntimeError> {
        if absent_text_key(&[table]) { return Ok(false); }
        let mut after: Option<String> = None;
        loop {
            let rows = self.query("SELECT id,data FROM r WHERE t=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 1", &[&table, &after])?;
            let Some(row) = rows.first() else { return Ok(false); };
            let image = crate::json_codec::from_text(row.get(1)).map_err(|e| RuntimeError::Store(e.to_string()))?;
            if survives(&image) { return Ok(true); }
            after = Some(row.get(0));
        }
    }
    fn timeline_rebuild_exists(&self, table: &str, id: &str) -> Result<bool, RuntimeError> {
        if absent_text_key(&[table, id]) { return Ok(false); }
        Ok(self.query("SELECT EXISTS(SELECT 1 FROM r WHERE t=$1 AND id=$2)", &[&table, &id])?[0].get(0))
    }
}

impl ActivationTransaction for Tx<'_> {
    fn set_active_release(&self, release: u64) -> Result<(), RuntimeError> { self.set_meta("release", &release.to_string()) }
    fn mark_live_sum_candidates(&self) -> Result<(), RuntimeError> { self.set_meta("live_sum_candidates", "1") }
    fn mark_maintained_ids(&self) -> Result<(), RuntimeError> { self.set_meta(crate::schema::MAINTAINED_ID_META, crate::schema::MAINTAINED_ID_VERSION) }
    fn set_audience_epoch(&self, table: &str, epoch: u64, now: i64) -> Result<(), RuntimeError> {
        self.set_meta(&crate::partition::audience_epoch_key(table), &epoch.to_string())?;
        self.set_meta(&crate::partition::audience_epoch_time_key(table), &now.to_string())
    }
    fn clear_activation_metadata(&self) -> Result<(), RuntimeError> {
        // SQLite LIKE is ASCII-insensitive and '_' is a wildcard; retain that selection.
        self.execute("DELETE FROM _meta WHERE key IN ('activation_restore','activation_population','activation_narrowed_retained','activation_narrowed_restored') OR key ILIKE 'activation_narrowed_restored:%' OR key ILIKE 'activation_column_restored:%' OR key ILIKE 'activation_table_restored:%' OR key ILIKE 'activation_table_restored_ids:%' OR key ILIKE 'activation_narrowed_restored_ids:%' OR key ILIKE 'activation_column_restored_ids:%'", &[])?;
        Ok(())
    }
    fn clear_retired_table(&self, table: &str) -> Result<(), RuntimeError> {
        if absent_text_key(&[table]) { return Ok(()); }
        self.rows_cache.borrow_mut().invalidate(table);
        self.execute("DELETE FROM r WHERE t=$1", &[&table])?;
        Ok(())
    }
    fn clear_retired_index(&self, table: &str, index: &str) -> Result<(), RuntimeError> {
        if absent_text_key(&[table, index]) { return Ok(()); }
        self.rows_cache.borrow_mut().invalidate(table);
        self.execute("DELETE FROM i WHERE t=$1 AND ix=$2", &[&table, &index])?;
        Ok(())
    }
}

// A Postgres preparation borrows the owning activation transaction. It never
// creates another writer, or exposes a driver handle to shared policy.
pub(super) struct Preparation<'tx, 'store>(pub &'tx Tx<'store>);
impl ReleaseTransaction for Preparation<'_, '_> {
    fn selected_release(&self) -> Result<Option<String>, RuntimeError> { self.0.meta("release") }
    fn release_revision(&self) -> Result<Option<String>, RuntimeError> { self.0.meta("release_revision") }
}
impl ActivationPreparation for Preparation<'_, '_> {
    fn check_selected_release(&self, expected: Option<u64>) -> Result<(), RuntimeError> { ActivationReader::check_selected_release(self.0, expected) }
    fn check_backend(&self, backend: &Backend) -> Result<(), RuntimeError> { activation::check_backend(&self.0.opening_backend()?, backend) }
    fn activation_inventory(&self) -> Result<Vec<DormantItem>, RuntimeError> { self.0.activation_inventory() }
    fn enable_dormant(&self) -> Result<(), RuntimeError> {
        // The minimal release profile has no retired definitions. Its admission
        // refuses schema transitions before any writes, rather than discarding them.
        Ok(())
    }
    fn prepare_release_metadata(&self, native_digest: &str, restore: bool) -> Result<(), RuntimeError> {
        self.0.set_meta("release_native_digest", native_digest)?;
        self.0.set_meta("activation_restore", if restore { "true" } else { "false" })
    }
}

impl TimelineWorkReader for RefCell<&mut Store> {
    fn timeline_work_count(&self, table: &str, state: &str) -> Result<u64, RuntimeError> {
        if absent_text_key(&[table, state]) { return Ok(0); }
        let mut store = self.try_borrow_mut().map_err(|_| RuntimeError::Store("Postgres timeline snapshot already borrowed".into()))?;
        let tx = store.transaction(None)?;
        let n: i64 = tx.query("SELECT COUNT(*) FROM r WHERE t=$1 AND data::jsonb #>> '{Row,status,String}'=$2", &[&table, &state])?[0].get(0);
        tx.rollback()?;
        Ok(n as u64)
    }
}
