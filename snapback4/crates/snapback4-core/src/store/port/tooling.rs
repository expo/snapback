//! Release tooling and read-only inspection dispatch.
// @ref LLP 3000.009.001.000#3.4 — typed facts and backup ownership remain inside each adapter.
use super::handles::SqliteStore;
use crate::{RuntimeError, Schema};
use crate::store_port::{AnyStore, AnyInspection};
use crate::inspection::{InspectionColumnKind, InspectionResult, InspectionRows, HandlerFailure, CommitClockRecord, WorkRecordKind};
use std::path::Path;
use serde_json::Value as Json;
impl AnyStore {
    /// Separates a private staging snapshot's replica and authentication incarnation.
    pub fn promote_snapshot(&mut self, provenance:Json)->Result<Json,RuntimeError>{match self {Self::Sqlite(SqliteStore(inner))=>inner.promote_snapshot(provenance),#[cfg(feature="postgres")]Self::Postgres(_)=>Err(RuntimeError::StoreUnsupported{family:"promotion"})}}

    // @ref LLP 3000.000.000.002#8-wave-21-release-evolution — previews retain declared identities and original immutable asset custody.
    pub fn preview_asset_root(&mut self, path: &Path) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.preview_asset_root(path), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }) } }
    pub fn release_table_mapping(&self, current: &Schema, target: &Schema) -> Result<std::collections::BTreeMap<String, String>, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.release_table_mapping(current, target), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn preview_target_table(&self, name: &str) -> Result<String, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.preview_target_table(name), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn preview_source_column(&self, name: &str, column: &str, source: &crate::schema::Table) -> Result<String, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.preview_source_column(name, column, source), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn preview_hidden_causes(&self, name: &str) -> Result<Vec<(String, u64)>, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.preview_hidden_causes(name), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn snapshot_to(&self, path: &Path) -> Result<(), String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.snapshot_to(path), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "backup" }.to_string()) } }
    pub fn inspection_generation(&self) -> Result<(String, String), String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.inspection_generation(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn inspection_table_population(&self, name: &str) -> Result<u64, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.inspection_table_population(name), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn has_release_history(&self) -> Result<bool, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.has_release_history(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn release_referenced(&self, release: i64) -> Result<bool, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.release_referenced(release), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn release_adopted(&self, release: i64) -> Result<bool, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.release_adopted(release), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn capture_preview_active(&self) -> Result<(), String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.capture_preview_active(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn preview_populations(&self, table: &str) -> Result<(i64, i64, i64), String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.preview_populations(table), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn visit_preview_lost(
        &self,
        visit: impl FnMut(String, String, String) -> Result<(), String>,
    ) -> Result<(), String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.visit_preview_lost(visit), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn preview_parent_dormant(&self, parent: &str, id: &str) -> Result<bool, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.preview_parent_dormant(parent, id), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn handler_failure_records(&self) -> Result<Vec<HandlerFailure>, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.handler_failure_records(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn visit_recent_commit_clock(
        &self,
        threshold: i64,
        table_bytes: i64,
        limit: i64,
        visit: impl FnMut(CommitClockRecord) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.visit_recent_commit_clock(threshold, table_bytes, limit, visit), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }) } }
    pub fn recent_commit_max_at(&self, limit: i64) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.recent_commit_max_at(limit), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }) } }
    pub fn inspection_has_data(&self) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.inspection_has_data(), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }) } }
    pub fn record_witness_barrier(
        &mut self,
        at: impl FnOnce() -> i64,
    ) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => inner.record_witness_barrier(at), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }) } }
    pub fn inspection_column_populated(
        &self,
        table: &str,
        column: &str,
        non_null: impl FnMut(bool, &str) -> Result<bool, String>,
    ) -> Result<bool, String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.inspection_column_populated(table, column, non_null), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn preview_hidden_population(&self, name: &str) -> Result<(u64, Vec<String>), String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.preview_hidden_population(name), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn preview_empty_population(
        &self,
        name: &str,
        column: &str,
        path: &str,
        encoded: &str,
        prior_missing: bool,
        prior: &str,
        prior_path: &str,
    ) -> Result<(u64, Vec<String>, u64), String> { match self { Self::Sqlite(SqliteStore(inner)) => inner.preview_empty_population(name, column, path, encoded, prior_missing, prior, prior_path), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
}
impl AnyInspection {
    pub fn merged_records(&self, table: &str) -> InspectionResult<Vec<crate::Value>> { match self { Self::Sqlite(inner) => inner.merged_records(table), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    pub fn begin_snapshot(&self) -> InspectionResult<()> { match self { Self::Sqlite(inner) => inner.begin_snapshot(), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    pub fn build_views(&mut self, schema: &Schema, ephemeral: impl FnMut(&str)) -> InspectionResult<()> { match self { Self::Sqlite(inner) => inner.build_views(schema, ephemeral), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    pub fn build_retained_views(
        &mut self,
        schema: &Schema,
        dormant: bool,
        all_releases: bool,
        ephemeral: impl FnMut(&str),
    ) -> InspectionResult<()> { match self { Self::Sqlite(inner) => inner.build_retained_views(schema, dormant, all_releases, ephemeral), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    pub fn query(
        &self,
        body: &str,
        limit: u32,
        object_rows: bool,
        classify_error: impl Fn(String) -> (&'static str, String),
        check_columns: impl Fn(&[String]) -> InspectionResult<()>,
        kinds: impl FnOnce(usize) -> InspectionResult<Vec<InspectionColumnKind>>,
    ) -> InspectionResult<InspectionRows> { match self { Self::Sqlite(inner) => inner.query(body, limit, object_rows, classify_error, check_columns, kinds), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    pub fn optional_release(&self) -> InspectionResult<Option<String>> { match self { Self::Sqlite(inner) => inner.optional_release(), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    pub fn required_release(&self) -> InspectionResult<String> { match self { Self::Sqlite(inner) => inner.required_release(), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    pub fn witness_generation(&self) -> InspectionResult<(i64, String, String, String)> { match self { Self::Sqlite(inner) => inner.witness_generation(), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    pub fn work_commit(
        &self,
        seq: Option<i64>,
    ) -> std::result::Result<Option<(String, String, i64)>, String> { match self { Self::Sqlite(inner) => inner.work_commit(seq), #[cfg(feature = "postgres")] Self::Postgres => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn work_records(
        &self,
        kind: WorkRecordKind,
        id: &str,
    ) -> std::result::Result<Vec<Json>, String> { match self { Self::Sqlite(inner) => inner.work_records(kind, id), #[cfg(feature = "postgres")] Self::Postgres => Err(RuntimeError::StoreUnsupported { family: "inspection" }.to_string()) } }
    pub fn retained_schema(&self, schema: Schema) -> InspectionResult<Schema> { match self { Self::Sqlite(inner) => inner.retained_schema(schema), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    pub fn dormant_inventory(&self) -> InspectionResult<Vec<crate::release_history::DormantItem>> { match self { Self::Sqlite(inner) => inner.dormant_inventory(), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
}

impl AnyStore {
    pub fn inspection_worker_reports(&self) -> Result<Vec<String>, RuntimeError> {
        match self { Self::Sqlite(SqliteStore(inner)) => Ok(inner.inspection_worker_reports()), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "inspection" }) }
    }
}
