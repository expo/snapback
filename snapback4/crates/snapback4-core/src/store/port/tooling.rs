//! Release tooling and read-only inspection dispatch.
// @ref LLP 3000.009.001.000#3.4 — typed facts and backup ownership remain inside each adapter.
use crate::{RuntimeError, Schema};
use crate::store_port::{AnyStore, AnyInspection};
use crate::inspection::{InspectionResult, InspectionRows, HandlerFailure, CommitClockRecord, WorkRecordKind};
use std::path::Path;
use serde_json::Value as Json;
impl AnyStore {
    pub fn snapshot_to(&self, path: &Path) -> Result<(), String> { match self { Self::Sqlite(inner) => inner.snapshot_to(path) } }
    pub fn inspection_generation(&self) -> Result<(String, String), String> { match self { Self::Sqlite(inner) => inner.inspection_generation() } }
    pub fn inspection_table_population(&self, name: &str) -> Result<u64, String> { match self { Self::Sqlite(inner) => inner.inspection_table_population(name) } }
    pub fn has_release_history(&self) -> Result<bool, String> { match self { Self::Sqlite(inner) => inner.has_release_history() } }
    pub fn release_referenced(&self, release: i64) -> Result<bool, String> { match self { Self::Sqlite(inner) => inner.release_referenced(release) } }
    pub fn release_adopted(&self, release: i64) -> Result<bool, String> { match self { Self::Sqlite(inner) => inner.release_adopted(release) } }
    pub fn capture_preview_active(&self) -> Result<(), String> { match self { Self::Sqlite(inner) => inner.capture_preview_active() } }
    pub fn preview_populations(&self, table: &str) -> Result<(i64, i64, i64), String> { match self { Self::Sqlite(inner) => inner.preview_populations(table) } }
    pub fn visit_preview_lost(
        &self,
        visit: impl FnMut(String, String, String) -> Result<(), String>,
    ) -> Result<(), String> { match self { Self::Sqlite(inner) => inner.visit_preview_lost(visit) } }
    pub fn preview_parent_dormant(&self, parent: &str, id: &str) -> Result<bool, String> { match self { Self::Sqlite(inner) => inner.preview_parent_dormant(parent, id) } }
    pub fn handler_failure_records(&self) -> Result<Vec<HandlerFailure>, String> { match self { Self::Sqlite(inner) => inner.handler_failure_records() } }
    pub fn visit_recent_commit_clock(
        &self,
        threshold: i64,
        table_bytes: i64,
        limit: i64,
        visit: impl FnMut(CommitClockRecord) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError> { match self { Self::Sqlite(inner) => inner.visit_recent_commit_clock(threshold, table_bytes, limit, visit) } }
    pub fn recent_commit_max_at(&self, limit: i64) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(inner) => inner.recent_commit_max_at(limit) } }
    pub fn inspection_has_data(&self) -> Result<bool, RuntimeError> { match self { Self::Sqlite(inner) => inner.inspection_has_data() } }
    pub fn record_witness_barrier(
        &mut self,
        at: impl FnOnce() -> i64,
    ) -> Result<u64, RuntimeError> { match self { Self::Sqlite(inner) => inner.record_witness_barrier(at) } }
    pub fn inspection_column_populated(
        &self,
        table: &str,
        column: &str,
        non_null: impl FnMut(bool, &str) -> Result<bool, String>,
    ) -> Result<bool, String> { match self { Self::Sqlite(inner) => inner.inspection_column_populated(table, column, non_null) } }
    pub fn preview_hidden_population(&self, name: &str) -> Result<(u64, Vec<String>), String> { match self { Self::Sqlite(inner) => inner.preview_hidden_population(name) } }
    pub fn preview_empty_population(
        &self,
        name: &str,
        column: &str,
        path: &str,
        encoded: &str,
        prior_missing: bool,
        prior: &str,
    ) -> Result<(u64, Vec<String>, u64), String> { match self { Self::Sqlite(inner) => inner.preview_empty_population(name, column, path, encoded, prior_missing, prior) } }
}
impl AnyInspection {
    pub fn begin_snapshot(&self) -> InspectionResult<()> { match self { Self::Sqlite(inner) => inner.begin_snapshot() } }
    pub fn build_views(&self, schema: &Schema, ephemeral: impl FnMut(&str)) -> InspectionResult<()> { match self { Self::Sqlite(inner) => inner.build_views(schema, ephemeral) } }
    pub fn build_retained_views(
        &self,
        schema: &Schema,
        dormant: bool,
        all_releases: bool,
        ephemeral: impl FnMut(&str),
    ) -> InspectionResult<()> { match self { Self::Sqlite(inner) => inner.build_retained_views(schema, dormant, all_releases, ephemeral) } }
    pub fn query(
        &self,
        body: &str,
        limit: u32,
        object_rows: bool,
        classify_error: impl Fn(String) -> (&'static str, String),
        check_columns: impl Fn(&[String]) -> InspectionResult<()>,
        booleans: impl FnOnce(usize) -> InspectionResult<Vec<bool>>,
    ) -> InspectionResult<InspectionRows> { match self { Self::Sqlite(inner) => inner.query(body, limit, object_rows, classify_error, check_columns, booleans) } }
    pub fn optional_release(&self) -> InspectionResult<Option<String>> { match self { Self::Sqlite(inner) => inner.optional_release() } }
    pub fn required_release(&self) -> InspectionResult<String> { match self { Self::Sqlite(inner) => inner.required_release() } }
    pub fn witness_generation(&self) -> InspectionResult<(i64, String, String, String)> { match self { Self::Sqlite(inner) => inner.witness_generation() } }
    pub fn work_commit(
        &self,
        seq: Option<i64>,
    ) -> std::result::Result<Option<(String, String, i64)>, String> { match self { Self::Sqlite(inner) => inner.work_commit(seq) } }
    pub fn work_records(
        &self,
        kind: WorkRecordKind,
        id: &str,
    ) -> std::result::Result<Vec<Json>, String> { match self { Self::Sqlite(inner) => inner.work_records(kind, id) } }
    pub fn retained_schema(&self, schema: Schema) -> InspectionResult<Schema> { match self { Self::Sqlite(inner) => inner.retained_schema(schema) } }
}

impl AnyStore {
    pub fn inspection_worker_reports(&self) -> Result<Vec<String>, RuntimeError> {
        match self { Self::Sqlite(inner) => Ok(inner.inspection_worker_reports()) }
    }
}
