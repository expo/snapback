//! Semantic owning-handle access, never a backend borrow.
// @ref LLP 3000.009.001.000#3.4 — inherent operations dispatch explicitly inside the port.
use super::handles::{SqliteStore, SqliteTx};
#[cfg(feature = "postgres")]
use super::handles::{PostgresStore, PostgresTx};
use crate::{RuntimeError, Value, Schema};
use crate::store_port::{AnyStore, AnyTx};
use crate::store_port::timeline_launch;
use crate::store_port::Sizes;
impl AnyTx<'_> {
    pub(crate) fn session_authority_facts(&self, digest: &str) -> Result<crate::identity::facts::SessionFacts, RuntimeError> {
        match self {
            Self::Sqlite(SqliteTx(inner)) => inner.session_authority_facts(digest),
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(inner)) => inner.session_authority_facts(digest),
        }
    }

    pub(crate) fn abandon(&self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.abandon(), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.abandon() } }
    pub(crate) fn store_id(&self) -> Result<String, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.store_id(), #[cfg(feature = "postgres")] Self::Postgres(_) => crate::metadata::MetadataReader::store_identity(self)?.ok_or_else(|| RuntimeError::Store("missing store identity".into())) } }
    pub(crate) fn savepoint(&self, name: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.savepoint(name), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.savepoint(name) } }
    pub(crate) fn release(&self, name: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.release(name), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.release(name) } }
    pub(crate) fn rollback_to(&self, name: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.rollback_to(name), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.rollback_to(name) } }
    pub(crate) fn pin_time_audience_clock(&self, requested: i64) -> Result<i64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.pin_time_audience_clock(requested), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "time-publication" }) } }
    pub(crate) fn selected_time_audience(&self, table: &str, id: &str, now: i64) -> Result<Option<crate::store_port::TimeOpening>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.selected_time_audience(table, id, now), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "time-publication" }) } }
    pub(crate) fn due_time_audience(&self, now: i64) -> Result<Option<crate::store_port::TimeOpening>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.due_time_audience(now), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "time-publication" }) } }
    pub(crate) fn remove_time_audience(&self, table: &str, id: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.remove_time_audience(table, id), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "time-publication" }) } }
    pub(crate) fn set_time_audience_published(
        &self,
        table: &str,
        id: &str,
        published: bool,
    ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.set_time_audience_published(table, id, published), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "time-publication" }) } }
    pub(crate) fn next_time_audience(&self) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.next_time_audience(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "time-publication" }) } }
    pub(crate) fn reset_clock(&self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.reset_clock(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "dev-reset" }) } }
    pub(crate) fn reset_tables(&self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.reset_tables(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "dev-reset" }) } }
    pub(crate) fn reset_identity(&self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.reset_identity(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "dev-reset" }) } }
}
impl AnyStore {
    pub fn asset_location(&self) -> Result<crate::store_port::AssetLocation<'_>, RuntimeError> {
        match self {
            Self::Sqlite(SqliteStore(inner)) => Ok(crate::store_port::AssetLocation {
                directory: inner.assets_dir(),
                ephemeral: inner.ephemeral_assets(),
            }),
            #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "assets" }),
        }
    }
    pub(crate) fn exclude_ephemeral(&mut self, schema: &Schema) { match self { Self::Sqlite(SqliteStore(inner)) => inner.exclude_ephemeral(schema), #[cfg(feature = "postgres")] Self::Postgres(_) => () } }
    pub fn is_read_only(&self) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.is_read_only(), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => Ok(inner.borrow()?.read_only) } }
    pub fn is_memory(&self) -> bool { match self { Self::Sqlite(SqliteStore(inner)) => inner.is_memory(), #[cfg(feature = "postgres")] Self::Postgres(_) => false } }
    pub fn store_id(&self) -> Result<String, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.store_id(), #[cfg(feature = "postgres")] Self::Postgres(_) => crate::metadata::MetadataReader::store_identity(self)?.ok_or_else(|| RuntimeError::Store("missing store identity".into())) } }
    pub fn optional_store_id(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.optional_store_id(), #[cfg(feature = "postgres")] Self::Postgres(_) => crate::metadata::MetadataReader::store_identity(self) } }
    pub fn seq(&self) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.seq(), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.read(|tx| Ok(crate::partition::PartitionRows::next_seq(tx)? - 1)) } }
    pub fn applied_outcome(&self, principal: &str, id: &str) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.applied_outcome(principal, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.read(|tx| Ok(crate::receipts::ReceiptReader::receipt(tx, principal, id)?.map(|r| r.outcome))) } }
    pub fn rows(&self, table: &str) -> Result<Vec<Value>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.rows(table), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.read(|tx| tx.rows(table)) } }
    pub fn rows_limited(&self, table: &str, limit: usize) -> Result<(Vec<Value>, bool), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.rows_limited(table, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.read(|tx| tx.rows_limited(table, limit)) } }
    pub fn count(&self, table: &str) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.count(table), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.read(|tx| tx.count(table)) } }
    pub fn sizes(&self) -> Result<Sizes, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.sizes(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }) } }
    pub fn database_path(&self) -> Option<&str> { match self { Self::Sqlite(SqliteStore(inner)) => inner.database_path(), #[cfg(feature = "postgres")] Self::Postgres(_) => None } }
    pub fn set_busy_timeout(&self, timeout: std::time::Duration) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.set_busy_timeout(timeout), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "connection-policy" }) } }
    pub(crate) fn accept_open(&self) { match self { Self::Sqlite(SqliteStore(inner)) => inner.accept_open(), #[cfg(feature = "postgres")] Self::Postgres(_) => () } }
    pub fn successor(&mut self, schema: &Schema) -> Result<Vec<crate::successor::Step>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.successor(schema), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "release-activation" }) } }
    pub fn check_timeline_activation(&mut self, schema: &Schema) -> Result<Vec<timeline_launch::Estimate>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.check_timeline_activation(schema), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "release-activation" }) } }
    pub fn check_timeline_activation_at(&mut self, schema: &Schema, now: i64, allow_launch: bool) -> Result<Vec<timeline_launch::Estimate>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.check_timeline_activation_at(schema, now, allow_launch), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "release-activation" }) } }
    pub(crate) fn resolve_session_snapshot(&self, digest: &str, now: i64, expected_store_id: Option<&str>, supervisor_revision: Option<usize>) -> Result<Option<crate::identity::Capability>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.resolve_session_snapshot(digest, now, expected_store_id, supervisor_revision), #[cfg(feature = "postgres")] Self::Postgres(_) => self.with_session_authority_snapshot(digest, |tx, facts| {
            if expected_store_id.is_none() || facts.store_id.as_deref() != expected_store_id { return Ok(None); }
            Ok(crate::identity::facts::resolve(tx, facts, now, supervisor_revision)?.map(|s| (s.principal, s.kind, s.scope)))
        }) } }
    pub(crate) fn invalidate_expired_authority_session(&self, digest: &str, now: i64) -> Result<(), RuntimeError> { self.delete_expired_session_member(digest, now) }
    pub fn retain_ownership(&mut self, owner: std::sync::Arc<std::fs::File>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.retain_ownership(owner), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "ownership" }) } }
    pub fn check_ownership(&self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.check_ownership(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "ownership" }) } }
}
impl AnyStore {
    pub fn dormant_inventory(
        &mut self,
        after: Option<&str>,
        limit: usize,
    ) -> Result<Vec<crate::release_history::DormantItem>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.dormant_inventory(after, limit), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }) } }
    pub fn release_status(
        &mut self,
        after: u64,
        items_after: Option<&str>,
        event_id: Option<u64>,
    ) -> Result<serde_json::Value, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.release_status(after, items_after, event_id), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(handle)) => handle.read(|tx| crate::release_history::status(tx, after, items_after, event_id)) } }
    pub fn prune_dormant(
        &mut self,
        confirm: bool,
        expected_revision: Option<u64>,
    ) -> Result<serde_json::Value, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.prune_dormant(confirm, expected_revision), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }) } }
    pub fn rollback_incompatible_values(&self, current: &Schema, target: &Schema, name: &str, column: &str) -> Result<(u64, Vec<String>), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.rollback_incompatible_values(current, target, name, column), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }) } }
}
impl AnyStore {
    pub fn adoption_estimate(
        &mut self,
        schema: &Schema,
    ) -> Result<Option<crate::store_port::adoption_estimate::AdoptionEstimate>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.adoption_estimate(schema), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "release-activation" }) } }
}
impl AnyStore {
    pub fn timeline_launch_estimate(&mut self, schema: &Schema) -> Result<Vec<timeline_launch::Estimate>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.timeline_launch_estimate(schema), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "release-activation" }) } }
}
impl AnyStore {
    pub fn time_audience_clock(&self) -> Result<i64, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.time_audience_clock(), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.read(|tx| crate::activation::ActivationReader::time_audience_clock(tx)) } }
}
impl AnyStore {
    pub fn adoption_report(&self) -> &crate::store_port::report::AdoptionReport {
        match self { Self::Sqlite(SqliteStore(inner)) => &inner.adoption_report, #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => &inner.report }
    }
    pub(crate) fn adoption_report_mut(&mut self) -> &mut crate::store_port::report::AdoptionReport {
        match self { Self::Sqlite(SqliteStore(inner)) => &mut inner.adoption_report, #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => &mut inner.report }
    }
    pub fn replay_bound(&self, principal: &str, id: &str, name: &str, args: &serde_json::Value) -> Result<Option<String>, RuntimeError> {
        crate::receipts::replay_bound(self, principal, id, name, args)
    }
}
impl AnyTx<'_> {
    pub(crate) fn replay_bound(&self, principal: &str, id: &str, name: &str, args: &serde_json::Value) -> Result<Option<String>, RuntimeError> {
        crate::receipts::replay_bound(self, principal, id, name, args)
    }
}

impl crate::store_port::ReadSnapshot<'_> {
    pub(crate) fn abandon(&self) -> Result<(), RuntimeError> { self.tx.abandon() }
    pub(crate) fn next_time_audience(&self) -> Result<Option<i64>, RuntimeError> { self.tx.next_time_audience() }
}

impl crate::ledger::LedgerReader for AnyTx<'_> {
    fn commits_after(&self, after: u64, limit: usize) -> Result<Vec<(u64, Vec<String>)>, RuntimeError> {
        match self { Self::Sqlite(SqliteTx(inner)) => inner.commits_after(after, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.commits_after(after, limit) }
    }
}
impl crate::ledger::LedgerTransaction for AnyTx<'_> {
    fn record_commit(&self, seq: u64, at: i64, program: &str, principal: &str, kind: &str, touched: &[String], writes: u64) -> Result<(), RuntimeError> {
        match self { Self::Sqlite(SqliteTx(inner)) => inner.record_commit(seq, at, program, principal, kind, touched, writes), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.record_commit(seq, at, program, principal, kind, touched, writes) }
    }
}
impl crate::ledger::LedgerReader for crate::store_port::ReadSnapshot<'_> {
    fn commits_after(&self, after: u64, limit: usize) -> Result<Vec<(u64, Vec<String>)>, RuntimeError> {
        crate::ledger::LedgerReader::commits_after(&self.tx, after, limit)
    }
}

use crate::assets::Asset;
impl AnyTx<'_> {
    pub(crate) fn record_asset(&self, asset: &Asset) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.record_asset(asset), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.record_asset(asset) } }
    pub(crate) fn asset_viewed(&self, id: &str, principal: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.asset_viewed(id, principal), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.asset_viewed(id, principal) } }
    pub(crate) fn record_asset_view(
        &self,
        id: &str,
        principal: &str,
        now: i64,
    ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.record_asset_view(id, principal, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.record_asset_view(id, principal, now) } }
    pub(crate) fn stage_stale_assets_for(
        &self,
        now: i64,
        budget: std::time::Duration,
    ) -> Result<Vec<Asset>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.stage_stale_assets_for(now, budget), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.stage_stale_assets_for(now, budget) } }
    pub(crate) fn forget_asset(&self, id: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.forget_asset(id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.forget_asset(id) } }
}
impl crate::store_port::ReadSnapshot<'_> {
    pub(crate) fn pending_effect_presence(&self, principal: &str, now: i64) -> Result<bool, RuntimeError> { crate::engine::effects::OutboxTransaction::pending_effect_presence(&self.tx, principal, now) }
}

impl AnyStore {
    pub fn empty_with_asset_ledger(&self) -> Result<Self, RuntimeError> {
        match self { Self::Sqlite(SqliteStore(inner)) => inner.empty_with_asset_ledger().map(|inner| Self::Sqlite(SqliteStore(inner))), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "assets" }) }
    }
}

impl AnyStore {
    pub fn preserved_between(&self, schema: &Schema, after: u64, through: u64) -> Option<Vec<String>> { crate::revocation::preserved_between(self, schema, after, through) }
    pub fn footprint_between(&self, after: u64, through: u64) -> Option<crate::revocation::Footprint> { crate::revocation::footprint_between(self, after, through) }
}
impl crate::store_port::ReadSnapshot<'_> {
    pub fn optional_store_id(&self) -> Result<Option<String>, RuntimeError> { crate::metadata::MetadataReader::store_identity(self) }
    pub fn preserved_between(&self, schema: &Schema, after: u64, through: u64) -> Option<Vec<String>> { crate::revocation::preserved_between(self, schema, after, through) }
    pub fn footprint_between(&self, after: u64, through: u64) -> Option<crate::revocation::Footprint> { crate::revocation::footprint_between(self, after, through) }
}

use crate::metadata::{MetadataReader, MetadataWriter, DevMetadata, SchemaMarker};
impl AnyStore {
    pub fn store_identity(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::store_identity(self) }
    pub fn generation_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::generation_value(self) }
    pub fn release_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::release_value(self) }
    pub fn release_native_digest(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::release_native_digest(self) }
    pub fn time_audience_clock_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::time_audience_clock_value(self) }
    pub fn release_revision_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::release_revision_value(self) }
    pub fn deployment_environment(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::deployment_environment(self) }
    pub fn dev_value(&self, key: DevMetadata) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::dev_value(self, key) }
    pub fn worker_status(&self, worker: Option<&str>) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::worker_status(self, worker) }
    pub fn schema_marker(&self, marker: SchemaMarker) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::schema_marker(self, marker) }
}
impl AnyTx<'_> {
    pub fn store_identity(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::store_identity(self) }
    pub fn generation_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::generation_value(self) }
    pub fn release_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::release_value(self) }
    pub fn release_native_digest(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::release_native_digest(self) }
    pub fn time_audience_clock_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::time_audience_clock_value(self) }
    pub fn release_revision_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::release_revision_value(self) }
    pub fn deployment_environment(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::deployment_environment(self) }
    pub fn dev_value(&self, key: DevMetadata) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::dev_value(self, key) }
    pub fn worker_status(&self, worker: Option<&str>) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::worker_status(self, worker) }
    pub fn schema_marker(&self, marker: SchemaMarker) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::schema_marker(self, marker) }
}
impl crate::store_port::ReadSnapshot<'_> {
    pub fn store_identity(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::store_identity(self) }
    pub fn generation_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::generation_value(self) }
    pub fn release_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::release_value(self) }
    pub fn release_native_digest(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::release_native_digest(self) }
    pub fn time_audience_clock_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::time_audience_clock_value(self) }
    pub fn release_revision_value(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::release_revision_value(self) }
    pub fn deployment_environment(&self) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::deployment_environment(self) }
    pub fn dev_value(&self, key: DevMetadata) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::dev_value(self, key) }
    pub fn worker_status(&self, worker: Option<&str>) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::worker_status(self, worker) }
    pub fn schema_marker(&self, marker: SchemaMarker) -> Result<Option<String>, RuntimeError> { <Self as MetadataReader>::schema_marker(self, marker) }
}
impl AnyStore {
    pub fn set_dev_value(&self, key: DevMetadata, value: &str) -> Result<(), RuntimeError> { <Self as MetadataWriter>::set_dev_value(self, key, value) }
    pub fn set_deployment_environment(&self, value: &str) -> Result<(), RuntimeError> { <Self as MetadataWriter>::set_deployment_environment(self, value) }
    pub fn set_worker_status(&self, worker: Option<&str>, value: &str) -> Result<(), RuntimeError> { <Self as MetadataWriter>::set_worker_status(self, worker, value) }
}
impl AnyTx<'_> {
    pub fn set_dev_value(&self, key: DevMetadata, value: &str) -> Result<(), RuntimeError> { <Self as MetadataWriter>::set_dev_value(self, key, value) }
    pub fn set_deployment_environment(&self, value: &str) -> Result<(), RuntimeError> { <Self as MetadataWriter>::set_deployment_environment(self, value) }
    pub fn set_worker_status(&self, worker: Option<&str>, value: &str) -> Result<(), RuntimeError> { <Self as MetadataWriter>::set_worker_status(self, worker, value) }
}
impl AnyTx<'_> {
    pub fn next_seq(&self) -> Result<u64, RuntimeError> { crate::partition::PartitionRows::next_seq(self) }
    pub fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> { crate::rows::Rows::get(self, table, id) }
}
impl crate::store_port::ReadSnapshot<'_> {
    pub fn next_seq(&self) -> Result<u64, RuntimeError> { crate::partition::PartitionRows::next_seq(self) }
    pub fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> { crate::rows::Rows::get(self, table, id) }
}
impl crate::store_port::ReadSnapshot<'_> {
    pub fn store_id(&self) -> Result<String, RuntimeError> { self.tx.store_id() }
    pub fn commits_after(&self, after: u64, limit: usize) -> Result<Vec<(u64, Vec<String>)>, RuntimeError> { crate::ledger::LedgerReader::commits_after(self, after, limit) }
    pub fn inspection_schema_json(&self) -> Result<String, RuntimeError> { match &self.tx { AnyTx::Sqlite(SqliteTx(inner)) => inner.inspection_schema_json(), #[cfg(feature = "postgres")] AnyTx::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }) } }
    pub fn inspection_schema_text(&self) -> Result<String, String> { match &self.tx { AnyTx::Sqlite(SqliteTx(inner)) => inner.inspection_schema_text(), #[cfg(feature = "postgres")] AnyTx::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
}

use crate::engine::job::JobSummary;
impl AnyStore {
    pub fn job_summaries(&self, error_bytes: usize) -> Result<Vec<JobSummary>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.job_summaries(error_bytes), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => crate::engine::job::JobStore::job_summaries(&mut *inner.borrow()?, error_bytes) } }
    pub fn latest_schedule_boundary(&self) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.latest_schedule_boundary(), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => crate::engine::job::JobStore::latest_schedule_boundary(&mut *inner.borrow()?) } }
    pub fn schedule_shape(&self, name: &str) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.schedule_shape(name), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => crate::engine::job::JobStore::schedule_shape(&mut *inner.borrow()?, name) } }
    pub fn schedule_boundary(&self, name: &str) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.schedule_boundary(name), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => crate::engine::job::JobStore::schedule_boundary(&mut *inner.borrow()?, name) } }
}
impl AnyTx<'_> {
    pub fn save_schedule_shape(&self, name: &str, shape: &str) -> Result<(), RuntimeError> { crate::engine::job::JobTransaction::write_schedule_shape(self, name, shape) }
    pub fn save_schedule_boundary(&self, name: &str, boundary: i64) -> Result<(), RuntimeError> { crate::engine::job::JobTransaction::write_schedule_boundary(self, name, boundary) }
}

pub(crate) trait FollowingHistoryReader: crate::rows::Rows {
    fn history_point(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError>;
    fn history_head(&self, table: &str, index: &str, prefix: &[Value], after: Option<Vec<Value>>) -> Result<Option<Value>, RuntimeError>;
}
impl FollowingHistoryReader for AnyTx<'_> {
    fn history_point(
        &self,
        table: &str,
        id: &str,
    ) -> Result<Option<Value>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.history_point(table, id), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "following-history" }) } }
    fn history_head(
        &self,
        table: &str,
        index: &str,
        prefix: &[Value],
        after: Option<Vec<Value>>,
    ) -> Result<Option<Value>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.history_head(table, index, prefix, after), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "following-history" }) } }
}
impl FollowingHistoryReader for crate::store_port::ReadSnapshot<'_> {
    fn history_point(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> { self.tx.history_point(table, id) }
    fn history_head(&self, table: &str, index: &str, prefix: &[Value], after: Option<Vec<Value>>) -> Result<Option<Value>, RuntimeError> { self.tx.history_head(table, index, prefix, after) }
}

impl crate::receipts::ReceiptTransaction for AnyTx<'_> {
    fn record_applied(&self, principal: &str, id: &str, seq: u64, outcome: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.record_applied(principal, id, seq, outcome), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => crate::receipts::ReceiptTransaction::record_applied(inner, principal, id, seq, outcome) } }
    fn bind_applied(&self, principal: &str, id: &str, name: &str, args: &serde_json::Value, at: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => inner.bind_applied(principal, id, name, args, at), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => crate::receipts::ReceiptTransaction::bind_applied(inner, principal, id, name, args, at) } }
}

impl AnyStore {
    pub fn forget_asset(&self, id: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.forget_asset(id), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.write(|tx| tx.forget_asset(id)) } }
}

impl AnyStore {
    pub fn record_asset(&self, asset: &Asset) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.record_asset(asset), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.write(|tx| tx.record_asset(asset)) } }
    pub fn asset(&self, id: &str) -> Result<Option<Asset>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.asset(id), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.read(|tx| crate::assets::AssetTransaction::asset(tx, id)) } }
    pub fn install(&mut self, schema: &Schema) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.install(schema), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "release-activation" }) } }
}

impl AnyTx<'_> {
    pub fn record_commit(&self, seq: u64, at: i64, program: &str, principal: &str, kind: &str, touched: &[String], writes: u64) -> Result<(), RuntimeError> {
        crate::ledger::LedgerTransaction::record_commit(self, seq, at, program, principal, kind, touched, writes)
    }
}

impl AnyStore {
    pub fn applied_ops(&self) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.applied_ops(), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.read(|tx| tx.applied_ops()) } }
    #[cfg(feature = "evaluation-support")]
    pub fn evaluation_rows(&self) -> Result<Vec<(String, String)>, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.evaluation_rows(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
}
impl AnyTx<'_> {
    pub fn read_log(&self, partition: &str, after: u64, limit: usize) -> Result<Vec<crate::store_port::LogEvent>, RuntimeError> {
        match self { Self::Sqlite(SqliteTx(inner)) => inner.read_log(partition, after, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.read_log(partition, after, limit) }
    }
}
impl crate::store_port::ReadSnapshot<'_> {
    pub fn read_log(&self, partition: &str, after: u64, limit: usize) -> Result<Vec<crate::store_port::LogEvent>, RuntimeError> { self.tx.read_log(partition, after, limit) }
}

impl AnyStore {
    /// Family adapters alone do not admit public worker execution or claims.
    // @ref LLP 3000.009.001.000#initial-http-profile-and-public-release-bootstrap — workers wait for their full recovery/producer contract.
    pub fn admit_worker_execution(&self) -> Result<(), RuntimeError> {
        match self {
            Self::Sqlite(_) => Ok(()),
            #[cfg(feature = "postgres")]
            Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "worker-execution" }),
        }
    }
}
