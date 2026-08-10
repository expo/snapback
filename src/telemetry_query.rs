//! Typed reads over the single sibling telemetry store and its offline SQL hatch.
//!
//! The writer and admission path remain in [`crate::telemetry`]. This module
//! only consumes the visibility views that writer owns.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::limits::Limit;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params_from_iter};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;
use std::collections::BTreeMap;
use std::ffi::CString;
use std::path::Path;
use std::ptr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

pub const DEFAULT_EVENT_LIMIT: usize = 100;
pub const MAX_EVENT_LIMIT: usize = 500;
pub const DEFAULT_AGENT_EXPORT_BYTE_BOUND: usize = 4 * 1024 * 1024;
pub const MIN_AGENT_EXPORT_BYTE_BOUND: usize = 1_024;
pub const MAX_AGENT_EXPORT_BYTE_BOUND: usize = 4 * 1024 * 1024;
pub const DEFAULT_SQL_ROW_BUDGET: usize = 1_000;
pub const DEFAULT_SQL_STEP_BUDGET: u64 = 1_000_000;
pub const DEFAULT_SQL_TIME_BUDGET_MS: u64 = 2_000;
pub const DEFAULT_SQL_BYTE_BUDGET: usize = 4 * 1024 * 1024;
pub const MAX_SQL_QUERY_BYTES: usize = 64 * 1024;
pub const MAX_SQL_ROW_BUDGET: usize = 100_000;
pub const MAX_SQL_STEP_BUDGET: u64 = 10_000_000;
pub const MAX_SQL_TIME_BUDGET_MS: u64 = 10_000;
pub const MAX_SQL_BYTE_BUDGET: usize = 64 * 1024 * 1024;
const SQL_RESULT_SCHEMA_VERSION: &str = "snapback.telemetry.sql-result.v1";
/// D5 stats are aggregate reads, not an unbounded dump. Each authority tier
/// gets a fixed input-row ceiling; exceeding it asks the caller to narrow the
/// time/kind/name filter before Rust materializes an unbounded response.
pub const MAX_STATS_ROLLUP_ROWS: usize = 10_000;
pub const MAX_STATS_RAW_TAIL_ROWS: usize = 10_000;
pub const TYPED_QUERY_MAX_STEPS: u64 = 1_000_000;
pub const TYPED_QUERY_MAX_TIME_MS: u64 = 2_000;
pub const QUERY_FIXTURE_CORPUS_FILE: &str = "telemetry.query-fixtures-v1.json";
const MAX_EXPORT_CONTINUATION_TOKEN_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TelemetryCapabilityOutcomeV1 {
    Exact,
    Approximate,
    BoundedWindow,
    Unsupported,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryCursorV1 {
    pub recorded_ts_ms: i64,
    pub id: i64,
}

#[derive(Clone, Debug, Default, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryFilterV1 {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub status: Option<i64>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub correlation: Option<String>,
    #[serde(default)]
    pub from_ms: Option<i64>,
    #[serde(default)]
    pub to_ms: Option<i64>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryEventsRequestV1 {
    #[serde(default, flatten)]
    pub filter: TelemetryFilterV1,
    #[serde(default)]
    pub cursor_recorded_ts_ms: Option<i64>,
    #[serde(default)]
    pub cursor_id: Option<i64>,
    #[serde(default)]
    pub order: TelemetryEventOrderV1,
    #[serde(default = "default_event_limit")]
    pub limit: usize,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TelemetryEventOrderV1 {
    #[default]
    Asc,
    Desc,
}

fn default_event_limit() -> usize {
    DEFAULT_EVENT_LIMIT
}

impl Default for TelemetryEventsRequestV1 {
    fn default() -> Self {
        Self {
            filter: TelemetryFilterV1::default(),
            cursor_recorded_ts_ms: None,
            cursor_id: None,
            order: TelemetryEventOrderV1::Asc,
            limit: DEFAULT_EVENT_LIMIT,
        }
    }
}

impl TelemetryEventsRequestV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        if self.limit == 0 || self.limit > MAX_EVENT_LIMIT {
            return Err(query_invalid(format!(
                "telemetry events limit must be between 1 and {MAX_EVENT_LIMIT}"
            )));
        }
        if self.cursor_recorded_ts_ms.is_some() != self.cursor_id.is_some() {
            return Err(query_invalid(
                "telemetry cursor requires cursorRecordedTsMs and cursorId together",
            ));
        }
        validate_filter(&self.filter)
    }
}

#[derive(Clone, Debug, Default, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryStatsFilterV1 {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub from_ms: Option<i64>,
    #[serde(default)]
    pub to_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lane: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryStatsRequestV1 {
    #[serde(default, flatten)]
    pub filter: TelemetryStatsFilterV1,
    #[serde(default, skip_serializing_if = "is_false")]
    pub group_by_caller: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl TelemetryStatsRequestV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        if self
            .filter
            .from_ms
            .is_some_and(|from| self.filter.to_ms.is_some_and(|to| from > to))
        {
            return Err(query_invalid("telemetry fromMs must not exceed toMs"));
        }
        for (field, value) in [
            ("kind", self.filter.kind.as_deref()),
            ("name", self.filter.name.as_deref()),
        ] {
            if value.is_some_and(|value| value.len() > 3_000) {
                return Err(query_invalid(format!(
                    "telemetry {field} filter is too long"
                )));
            }
        }
        if self
            .filter
            .caller_key
            .as_ref()
            .is_some_and(|value| value.len() > 512)
        {
            return Err(query_invalid(
                "telemetry callerKey filter exceeds the 512-byte caller-key bound",
            ));
        }
        if let Some(lane) = self.filter.lane.as_deref()
            && !matches!(
                lane,
                "anonymous" | "declared" | "integration" | "first-party"
            )
        {
            return Err(query_invalid(
                "telemetry lane must be anonymous, declared, integration, or first-party",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryExportRequestV1 {
    #[serde(default, flatten)]
    pub filter: TelemetryFilterV1,
}

impl TelemetryExportRequestV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        validate_filter(&self.filter)
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryAgentExportRequestV1 {
    #[serde(default, flatten)]
    pub filter: TelemetryFilterV1,
    #[serde(default)]
    #[schemars(length(max = MAX_EXPORT_CONTINUATION_TOKEN_BYTES))]
    pub continuation_token: Option<String>,
    #[serde(default = "default_event_limit")]
    #[schemars(range(min = 1, max = MAX_EVENT_LIMIT))]
    pub max_rows: usize,
    #[serde(default = "default_agent_export_byte_bound")]
    #[schemars(range(
        min = MIN_AGENT_EXPORT_BYTE_BOUND,
        max = MAX_AGENT_EXPORT_BYTE_BOUND
    ))]
    pub max_bytes: usize,
}

fn default_agent_export_byte_bound() -> usize {
    DEFAULT_AGENT_EXPORT_BYTE_BOUND
}

impl Default for TelemetryAgentExportRequestV1 {
    fn default() -> Self {
        Self {
            filter: TelemetryFilterV1::default(),
            continuation_token: None,
            max_rows: DEFAULT_EVENT_LIMIT,
            max_bytes: DEFAULT_AGENT_EXPORT_BYTE_BOUND,
        }
    }
}

impl TelemetryAgentExportRequestV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        validate_filter(&self.filter)?;
        if self.max_rows == 0 || self.max_rows > MAX_EVENT_LIMIT {
            return Err(query_invalid(format!(
                "telemetry agent export maxRows must be between 1 and {MAX_EVENT_LIMIT}"
            )));
        }
        if !(MIN_AGENT_EXPORT_BYTE_BOUND..=MAX_AGENT_EXPORT_BYTE_BOUND).contains(&self.max_bytes) {
            return Err(query_invalid(format!(
                "telemetry agent export maxBytes must be between {MIN_AGENT_EXPORT_BYTE_BOUND} and {MAX_AGENT_EXPORT_BYTE_BOUND}"
            )));
        }
        if self.continuation_token.is_some() && self.filter != TelemetryFilterV1::default() {
            return Err(query_invalid(
                "telemetry agent export continuation carries its frozen filter; do not repeat or replace filter fields",
            ));
        }
        Ok(())
    }
}

fn validate_filter(filter: &TelemetryFilterV1) -> SnapbackResult<()> {
    if filter
        .from_ms
        .is_some_and(|from| filter.to_ms.is_some_and(|to| from > to))
    {
        return Err(query_invalid("telemetry fromMs must not exceed toMs"));
    }
    for (field, value) in [
        ("kind", filter.kind.as_deref()),
        ("name", filter.name.as_deref()),
        ("code", filter.code.as_deref()),
        ("correlation", filter.correlation.as_deref()),
        ("text", filter.text.as_deref()),
    ] {
        if value.is_some_and(|value| value.len() > 3_000) {
            return Err(query_invalid(format!(
                "telemetry {field} filter is too long"
            )));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryVarianceV1 {
    pub store_backend: String,
    pub field_exactness: BTreeMap<String, String>,
    pub sampling_factor: f64,
    pub freshness_watermark: Option<i64>,
    pub retention_boundary_ms: i64,
    pub drops_since_boot: BTreeMap<String, u64>,
    pub drops_lifetime: BTreeMap<String, u64>,
    pub truncation: BTreeMap<String, Value>,
    pub capability_outcome: TelemetryCapabilityOutcomeV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryEventV1 {
    pub id: i64,
    pub observation: String,
    pub phase: String,
    pub generation: String,
    pub class_v: i64,
    pub ts_ms: i64,
    pub recorded_ts_ms: i64,
    pub kind: String,
    pub name: String,
    pub status: Option<i64>,
    pub duration_ms: Option<f64>,
    pub code: Option<String>,
    pub correlation: Option<String>,
    pub release: Option<String>,
    pub details: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryEventsResponseV1 {
    pub schema_version: String,
    pub order: TelemetryEventOrderV1,
    pub events: Vec<TelemetryEventV1>,
    pub next_cursor: Option<TelemetryCursorV1>,
    pub variance: TelemetryVarianceV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryStatusCountV1 {
    pub kind: String,
    pub status_class: String,
    pub count: u64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryLatencyV1 {
    pub name: String,
    pub count: u64,
    pub p50_ms: Option<f64>,
    pub p95_ms: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryNamedCountV1 {
    pub kind: String,
    pub name: String,
    pub count: u64,
    pub error_count: u64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySeriesPointV1 {
    pub bucket_start_ms: i64,
    pub bucket_end_ms: i64,
    pub kind: String,
    pub name: String,
    pub count: u64,
    pub error_count: u64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryCoverageV1 {
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub rollup_watermark_id: i64,
    pub rollup_rows: u64,
    pub raw_tail_rows: u64,
    pub raw_edge_rows: u64,
    pub raw_tail_start_id: Option<i64>,
    pub raw_tail_end_id: Option<i64>,
    pub partitions: Vec<TelemetryCoveragePartitionV1>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryCoveragePartitionV1 {
    pub tier: String,
    pub bucket_start_ms: i64,
    pub bucket_end_ms: i64,
    pub coverage_start_ms: i64,
    pub coverage_end_ms: i64,
    pub watermark_id: i64,
    pub kind: String,
    pub name: String,
    pub count: u64,
    pub error_count: u64,
    pub folded_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller_lane: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryCallerCountV1 {
    pub lane: String,
    pub caller_key: String,
    pub kind: String,
    pub name: String,
    pub count: u64,
    pub error_count: u64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryStatsResponseV1 {
    pub schema_version: String,
    pub status_counts: Vec<TelemetryStatusCountV1>,
    pub latency: Vec<TelemetryLatencyV1>,
    pub named_counts: Vec<TelemetryNamedCountV1>,
    pub series: Vec<TelemetrySeriesPointV1>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caller_counts: Vec<TelemetryCallerCountV1>,
    pub coverage: TelemetryCoverageV1,
    pub variance: TelemetryVarianceV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryExportHeaderV1 {
    pub schema_version: String,
    pub record_type: String,
    pub app_id: String,
    pub environment: String,
    pub generation: String,
    pub app_db_incarnation: String,
    pub snapshot: TelemetryCursorV1,
    pub variance: TelemetryVarianceV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryExportEventV1 {
    pub schema_version: String,
    pub record_type: String,
    pub app_id: String,
    pub environment: String,
    #[serde(flatten)]
    pub event: TelemetryEventV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryExportPageV1 {
    pub schema_version: String,
    pub snapshot: TelemetryCursorV1,
    pub records: Vec<TelemetryExportEventV1>,
    pub next_cursor: Option<TelemetryCursorV1>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryAgentExportBoundsV1 {
    #[schemars(range(min = 1, max = MAX_EVENT_LIMIT))]
    pub max_rows: usize,
    #[schemars(range(
        min = MIN_AGENT_EXPORT_BYTE_BOUND,
        max = MAX_AGENT_EXPORT_BYTE_BOUND
    ))]
    pub max_bytes: usize,
}

/// One finite export page for host operations and control MCP. `pageBytes`
/// is the exact compact-JSON byte length of this data object, so callers can
/// prove both declared bounds before accepting the surrounding host envelope.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryAgentExportPageV1 {
    pub schema_version: String,
    pub header: TelemetryExportHeaderV1,
    #[schemars(length(max = MAX_EVENT_LIMIT))]
    pub records: Vec<TelemetryExportEventV1>,
    pub declared_bounds: TelemetryAgentExportBoundsV1,
    #[schemars(range(max = MAX_EVENT_LIMIT))]
    pub page_rows: usize,
    #[schemars(range(max = MAX_AGENT_EXPORT_BYTE_BOUND))]
    pub page_bytes: usize,
    pub truncated: bool,
    #[schemars(length(max = MAX_EXPORT_CONTINUATION_TOKEN_BYTES))]
    pub continuation_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TelemetryExportContinuationV1 {
    version: String,
    store_generation: String,
    app_db_incarnation: String,
    filter: TelemetryFilterV1,
    header: TelemetryExportHeaderV1,
    after: TelemetryCursorV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySqlBudgetV1 {
    #[serde(default = "default_sql_rows")]
    pub max_rows: usize,
    #[serde(default = "default_sql_steps")]
    pub max_steps: u64,
    #[serde(default = "default_sql_time_ms")]
    pub max_time_ms: u64,
    #[serde(default = "default_sql_bytes")]
    pub max_bytes: usize,
}

fn default_sql_rows() -> usize {
    DEFAULT_SQL_ROW_BUDGET
}
fn default_sql_steps() -> u64 {
    DEFAULT_SQL_STEP_BUDGET
}
fn default_sql_time_ms() -> u64 {
    DEFAULT_SQL_TIME_BUDGET_MS
}
fn default_sql_bytes() -> usize {
    DEFAULT_SQL_BYTE_BUDGET
}

impl Default for TelemetrySqlBudgetV1 {
    fn default() -> Self {
        Self {
            max_rows: DEFAULT_SQL_ROW_BUDGET,
            max_steps: DEFAULT_SQL_STEP_BUDGET,
            max_time_ms: DEFAULT_SQL_TIME_BUDGET_MS,
            max_bytes: DEFAULT_SQL_BYTE_BUDGET,
        }
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySqlResultV1 {
    pub schema_version: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub steps: u64,
    pub elapsed_ms: u64,
    pub truncated: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct QueryContext {
    pub drops_since_boot: BTreeMap<String, u64>,
    pub last_flush_watermark: Option<i64>,
}

#[derive(Clone, Debug)]
struct Meta {
    retention_boundary_ms: i64,
    rollup_watermark_id: i64,
    drops_lifetime: BTreeMap<String, u64>,
    persisted_freshness_watermark: Option<i64>,
}

struct TypedQueryBudget<'a> {
    connection: &'a Connection,
    interrupted: Arc<AtomicBool>,
}

impl TypedQueryBudget<'_> {
    fn finish<T>(self, result: SnapbackResult<T>) -> SnapbackResult<T> {
        if self.interrupted.load(Ordering::Acquire) {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_QUERY_WORK_LIMIT_EXCEEDED",
                "telemetry",
                "telemetry query exceeded its step or wall-clock work budget; narrow the filters",
            ));
        }
        result
    }
}

impl Drop for TypedQueryBudget<'_> {
    fn drop(&mut self) {
        self.connection.progress_handler(0, None::<fn() -> bool>);
    }
}

fn with_typed_query_budget<T>(
    connection: &Connection,
    read: impl FnOnce() -> SnapbackResult<T>,
) -> SnapbackResult<T> {
    with_typed_query_budget_limits(
        connection,
        TYPED_QUERY_MAX_STEPS,
        Duration::from_millis(TYPED_QUERY_MAX_TIME_MS),
        read,
    )
}

fn with_typed_query_budget_limits<T>(
    connection: &Connection,
    maximum_steps: u64,
    maximum_time: Duration,
    read: impl FnOnce() -> SnapbackResult<T>,
) -> SnapbackResult<T> {
    let steps = Arc::new(AtomicU64::new(0));
    let interrupted = Arc::new(AtomicBool::new(false));
    let progress_steps = Arc::clone(&steps);
    let progress_interrupted = Arc::clone(&interrupted);
    let started = Instant::now();
    connection.progress_handler(
        100,
        Some(move || {
            let observed = progress_steps
                .fetch_add(100, Ordering::Relaxed)
                .saturating_add(100);
            let stop = observed > maximum_steps || started.elapsed() > maximum_time;
            if stop {
                progress_interrupted.store(true, Ordering::Release);
            }
            stop
        }),
    );
    let budget = TypedQueryBudget {
        connection,
        interrupted,
    };
    budget.finish(read())
}

fn read_meta(connection: &Connection) -> SnapbackResult<Meta> {
    connection
        .query_row(
            "SELECT max(retention_floor, observation_clock_ms - max_days_mirror * 86400000),
                    rollup_watermark_id,
                    drop_counters_lifetime,
                    (SELECT max(recorded_ts_ms) FROM telemetry_events_visible),
                    (SELECT max(coverage_end_ms) FROM telemetry_rollup_visible)
             FROM telemetry_meta WHERE singleton=1",
            [],
            |row| {
                let drops: String = row.get(2)?;
                let raw_freshness = row.get::<_, Option<i64>>(3)?;
                let rollup_freshness = row.get::<_, Option<i64>>(4)?;
                Ok(Meta {
                    retention_boundary_ms: row.get(0)?,
                    rollup_watermark_id: row.get(1)?,
                    drops_lifetime: serde_json::from_str(&drops).unwrap_or_default(),
                    persisted_freshness_watermark: match (raw_freshness, rollup_freshness) {
                        (Some(raw), Some(rollup)) => Some(raw.max(rollup)),
                        (Some(value), None) | (None, Some(value)) => Some(value),
                        (None, None) => None,
                    },
                })
            },
        )
        .map_err(Into::into)
}

fn variance(
    meta: &Meta,
    context: &QueryContext,
    field_exactness: BTreeMap<String, String>,
    capability_outcome: TelemetryCapabilityOutcomeV1,
    truncation: BTreeMap<String, Value>,
) -> TelemetryVarianceV1 {
    TelemetryVarianceV1 {
        store_backend: "local-sqlite-sibling".to_owned(),
        field_exactness,
        sampling_factor: 1.0,
        freshness_watermark: match (
            context.last_flush_watermark,
            meta.persisted_freshness_watermark,
        ) {
            (Some(memory), Some(persisted)) => Some(memory.max(persisted)),
            (Some(value), None) | (None, Some(value)) => Some(value),
            (None, None) => None,
        },
        retention_boundary_ms: meta.retention_boundary_ms,
        drops_since_boot: context.drops_since_boot.clone(),
        drops_lifetime: meta.drops_lifetime.clone(),
        truncation,
        capability_outcome,
    }
}

pub(crate) fn query_events(
    connection: &Connection,
    request: &TelemetryEventsRequestV1,
    context: &QueryContext,
) -> SnapbackResult<TelemetryEventsResponseV1> {
    with_typed_query_budget(connection, || {
        query_events_unbudgeted(connection, request, context)
    })
}

fn query_events_unbudgeted(
    connection: &Connection,
    request: &TelemetryEventsRequestV1,
    context: &QueryContext,
) -> SnapbackResult<TelemetryEventsResponseV1> {
    request.validate()?;
    let meta = read_meta(connection)?;
    let mut sql = String::from(
        "SELECT id,observation,phase,generation,class_v,ts_ms,recorded_ts_ms,kind,name,status,duration_ms,code,correlation,release,details FROM telemetry_events_visible WHERE 1=1",
    );
    let mut values = Vec::new();
    append_event_filter(&mut sql, &mut values, &request.filter);
    if let (Some(ts), Some(id)) = (request.cursor_recorded_ts_ms, request.cursor_id) {
        sql.push_str(match request.order {
            TelemetryEventOrderV1::Asc => {
                " AND (recorded_ts_ms > ? OR (recorded_ts_ms = ? AND id > ?))"
            }
            TelemetryEventOrderV1::Desc => {
                " AND (recorded_ts_ms < ? OR (recorded_ts_ms = ? AND id < ?))"
            }
        });
        values.extend([
            SqlValue::Integer(ts),
            SqlValue::Integer(ts),
            SqlValue::Integer(id),
        ]);
    }
    sql.push_str(match request.order {
        TelemetryEventOrderV1::Asc => " ORDER BY recorded_ts_ms ASC,id ASC LIMIT ?",
        TelemetryEventOrderV1::Desc => " ORDER BY recorded_ts_ms DESC,id DESC LIMIT ?",
    });
    values.push(SqlValue::Integer((request.limit + 1) as i64));
    let mut statement = connection.prepare(&sql)?;
    let mut events = statement
        .query_map(params_from_iter(values), event_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let truncated = events.len() > request.limit;
    if truncated {
        events.truncate(request.limit);
    }
    let next_cursor = truncated.then(|| {
        let event = events
            .last()
            .expect("truncated page contains requested limit");
        TelemetryCursorV1 {
            recorded_ts_ms: event.recorded_ts_ms,
            id: event.id,
        }
    });
    Ok(TelemetryEventsResponseV1 {
        schema_version: "snapback.telemetry.events.v1".to_owned(),
        order: request.order,
        events,
        next_cursor,
        variance: variance(
            &meta,
            context,
            BTreeMap::from([
                ("events".to_owned(), "exactVisibleRows".to_owned()),
                (
                    "ordering".to_owned(),
                    match request.order {
                        TelemetryEventOrderV1::Asc => "exactRecordedTimestampThenIdAscending",
                        TelemetryEventOrderV1::Desc => "exactRecordedTimestampThenIdDescending",
                    }
                    .to_owned(),
                ),
            ]),
            if truncated {
                TelemetryCapabilityOutcomeV1::BoundedWindow
            } else {
                TelemetryCapabilityOutcomeV1::Exact
            },
            BTreeMap::from([("pageLimit".to_owned(), json!(request.limit))]),
        ),
    })
}

fn append_event_filter(sql: &mut String, values: &mut Vec<SqlValue>, filter: &TelemetryFilterV1) {
    for (column, value) in [
        ("kind", filter.kind.as_ref()),
        ("name", filter.name.as_ref()),
        ("code", filter.code.as_ref()),
        ("correlation", filter.correlation.as_ref()),
    ] {
        if let Some(value) = value {
            sql.push_str(&format!(" AND {column}=?"));
            values.push(SqlValue::Text(value.clone()));
        }
    }
    if let Some(status) = filter.status {
        sql.push_str(" AND status=?");
        values.push(SqlValue::Integer(status));
    }
    if let Some(from) = filter.from_ms {
        sql.push_str(" AND recorded_ts_ms>=?");
        values.push(SqlValue::Integer(from));
    }
    if let Some(to) = filter.to_ms {
        sql.push_str(" AND recorded_ts_ms<=?");
        values.push(SqlValue::Integer(to));
    }
    if let Some(text) = &filter.text {
        sql.push_str(" AND (name LIKE ? ESCAPE '\\' OR ifnull(code,'') LIKE ? ESCAPE '\\' OR ifnull(correlation,'') LIKE ? ESCAPE '\\' OR ifnull(details,'') LIKE ? ESCAPE '\\')");
        let escaped = text
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = SqlValue::Text(format!("%{escaped}%"));
        values.extend([pattern.clone(), pattern.clone(), pattern.clone(), pattern]);
    }
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TelemetryEventV1> {
    Ok(TelemetryEventV1 {
        id: row.get(0)?,
        observation: row.get(1)?,
        phase: row.get(2)?,
        generation: row.get(3)?,
        class_v: row.get(4)?,
        ts_ms: row.get(5)?,
        recorded_ts_ms: row.get(6)?,
        kind: row.get(7)?,
        name: row.get(8)?,
        status: row.get(9)?,
        duration_ms: row.get(10)?,
        code: row.get(11)?,
        correlation: row.get(12)?,
        release: row.get(13)?,
        details: row
            .get::<_, Option<String>>(14)?
            .and_then(|raw| serde_json::from_str(&raw).ok()),
    })
}

#[derive(Default)]
struct StatsAggregate {
    ok: u64,
    error: u64,
    histogram: [u64; 17],
    start: Option<i64>,
    end: Option<i64>,
}

pub(crate) fn query_stats(
    connection: &Connection,
    request: &TelemetryStatsRequestV1,
    context: &QueryContext,
) -> SnapbackResult<TelemetryStatsResponseV1> {
    with_typed_query_budget(connection, || {
        query_stats_unbudgeted(connection, request, context)
    })
}

fn query_stats_unbudgeted(
    connection: &Connection,
    request: &TelemetryStatsRequestV1,
    context: &QueryContext,
) -> SnapbackResult<TelemetryStatsResponseV1> {
    request.validate()?;
    let meta = read_meta(connection)?;
    let mut by_kind: BTreeMap<String, StatsAggregate> = BTreeMap::new();
    let mut by_name: BTreeMap<String, StatsAggregate> = BTreeMap::new();
    let mut by_kind_name: BTreeMap<(String, String), StatsAggregate> = BTreeMap::new();
    let mut by_caller: BTreeMap<(String, String, String, String), StatsAggregate> = BTreeMap::new();
    let mut series: BTreeMap<(i64, i64, String, String), (u64, u64)> = BTreeMap::new();
    let caller_sensitive = request.group_by_caller
        || request.filter.caller_key.is_some()
        || request.filter.lane.is_some();
    let mut rollup_rows_scanned = 0u64;
    let mut rollup_rows = 0u64;
    let mut raw_tail_rows = 0u64;
    let mut raw_edge_rows = 0u64;
    let mut raw_tail_start_id = None;
    let mut raw_tail_end_id = None;
    let mut partitions = Vec::new();
    let mut partial_bucket_overlap = false;
    let mut raw_edge_substitution = false;
    let mut snapped_to_bucket_boundaries = false;
    let mut exact_edge_intervals = Vec::new();
    // Folding metadata is read without the requested name predicate: `_other`
    // is evidence that a named filter may have been folded away, not a count
    // to merge into that named answer.
    let folded_count = query_window_folded_count(
        connection,
        meta.rollup_watermark_id,
        &request.filter,
        caller_sensitive,
    )?;
    let named_filter_may_be_folded = request.filter.name.is_some() && folded_count > 0;

    let mut sql = if caller_sensitive {
        String::from(
            "SELECT tier,bucket_start_ms,bucket_end_ms,kind,name,caller_lane,caller_key,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_caller_rollup_visible WHERE watermark_id<=?",
        )
    } else {
        String::from(
            "SELECT tier,bucket_start_ms,bucket_end_ms,kind,name,NULL AS caller_lane,NULL AS caller_key,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_rollup_visible WHERE watermark_id<=?",
        )
    };
    let mut values = vec![SqlValue::Integer(meta.rollup_watermark_id)];
    append_stats_filter(
        &mut sql,
        &mut values,
        &request.filter,
        true,
        caller_sensitive,
    );
    sql.push_str(" ORDER BY bucket_start_ms,tier,kind,name,caller_lane,caller_key LIMIT ?");
    values.push(SqlValue::Integer((MAX_STATS_ROLLUP_ROWS + 1) as i64));
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, u64>(7)?,
            row.get::<_, u64>(8)?,
            row.get::<_, String>(9)?,
            row.get::<_, i64>(10)?,
            row.get::<_, i64>(11)?,
            row.get::<_, i64>(12)?,
            row.get::<_, u64>(13)?,
        ))
    })?;
    for row in rows {
        let (
            tier,
            bucket_start,
            bucket_end,
            kind,
            name,
            caller_lane,
            caller_key,
            count,
            errors,
            histogram,
            start,
            end,
            watermark,
            folded,
        ) = row?;
        rollup_rows_scanned += 1;
        enforce_stats_work_limit(
            rollup_rows_scanned,
            MAX_STATS_ROLLUP_ROWS,
            "rollup coverage rows",
        )?;
        // Partial-window substitution is a bucket decision, not a per-name
        // coverage decision. Different names in one bucket can have different
        // observed coverage intervals; substituting only the row whose
        // coverage crosses the requested edge would let the raw edge read
        // double-count a neighboring name whose narrower rollup row stayed.
        let partial = request
            .filter
            .from_ms
            .is_some_and(|from| from > bucket_start)
            || request.filter.to_ms.is_some_and(|to| to < bucket_end);
        partial_bucket_overlap |= partial;
        if partial {
            let intersection_start = request
                .filter
                .from_ms
                .map_or(bucket_start, |from| from.max(bucket_start));
            let intersection_end = request
                .filter
                .to_ms
                .map_or(bucket_end, |to| to.min(bucket_end));
            if intersection_start >= meta.retention_boundary_ms {
                raw_edge_substitution = true;
                exact_edge_intervals.push((intersection_start, intersection_end));
                continue;
            }
            snapped_to_bucket_boundaries = true;
        }
        rollup_rows += 1;
        partitions.push(TelemetryCoveragePartitionV1 {
            tier,
            bucket_start_ms: bucket_start,
            bucket_end_ms: bucket_end,
            coverage_start_ms: start,
            coverage_end_ms: end,
            watermark_id: watermark,
            kind: kind.clone(),
            name: name.clone(),
            count,
            error_count: errors,
            folded_count: folded,
            caller_lane: caller_lane.clone(),
            caller_key: caller_key.clone(),
        });
        let histogram = decode_histogram(&histogram);
        merge_stats(
            by_kind.entry(kind.clone()).or_default(),
            count,
            errors,
            &histogram,
            start,
            end,
        );
        merge_stats(
            by_name.entry(name.clone()).or_default(),
            count,
            errors,
            &histogram,
            start,
            end,
        );
        merge_stats(
            by_kind_name
                .entry((kind.clone(), name.clone()))
                .or_default(),
            count,
            errors,
            &histogram,
            start,
            end,
        );
        if let (Some(lane), Some(caller_key)) = (caller_lane, caller_key) {
            merge_stats(
                by_caller
                    .entry((lane, caller_key, kind.clone(), name.clone()))
                    .or_default(),
                count,
                errors,
                &histogram,
                start,
                end,
            );
        }
        merge_series(
            &mut series,
            bucket_start,
            bucket_end,
            kind,
            name,
            count,
            errors,
        );
    }

    let exact_edge_intervals = merge_time_intervals(exact_edge_intervals);
    let mut sql = String::from(
        "SELECT id,kind,name,status,code,duration_ms,recorded_ts_ms,details FROM telemetry_events_visible WHERE phase IN ('point','joined','terminal') AND (id>?",
    );
    let mut values = vec![SqlValue::Integer(meta.rollup_watermark_id)];
    if !exact_edge_intervals.is_empty() {
        sql.push_str(" OR (id<=? AND (");
        values.push(SqlValue::Integer(meta.rollup_watermark_id));
        for (index, (start, end)) in exact_edge_intervals.iter().enumerate() {
            if index > 0 {
                sql.push_str(" OR ");
            }
            sql.push_str("recorded_ts_ms BETWEEN ? AND ?");
            values.push(SqlValue::Integer(*start));
            values.push(SqlValue::Integer(*end));
        }
        sql.push_str("))");
    }
    sql.push(')');
    append_stats_filter(
        &mut sql,
        &mut values,
        &request.filter,
        false,
        caller_sensitive,
    );
    sql.push_str(" ORDER BY id LIMIT ?");
    values.push(SqlValue::Integer((MAX_STATS_RAW_TAIL_ROWS + 1) as i64));
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values), |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<i64>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<f64>>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, Option<String>>(7)?,
        ))
    })?;
    for row in rows {
        let (id, kind, name, status, code, duration, recorded, details) = row?;
        let raw_rows = raw_tail_rows
            .saturating_add(raw_edge_rows)
            .saturating_add(1);
        enforce_stats_work_limit(
            raw_rows,
            MAX_STATS_RAW_TAIL_ROWS,
            "raw-tail and retained-edge events",
        )?;
        if id > meta.rollup_watermark_id {
            raw_tail_rows += 1;
            raw_tail_start_id = min_option(raw_tail_start_id, Some(id));
            raw_tail_end_id = max_option(raw_tail_end_id, Some(id));
        } else {
            raw_edge_rows += 1;
        }
        let caller = caller_attribution_from_raw_details(details.as_deref());
        if caller_sensitive && caller.is_none() {
            continue;
        }
        let errors = u64::from(code.is_some() || status.is_some_and(|value| value >= 500));
        let mut histogram = [0; 17];
        if let Some(duration) = duration {
            histogram[histogram_index(duration)] = 1;
        }
        merge_stats(
            by_kind.entry(kind.clone()).or_default(),
            1,
            errors,
            &histogram,
            recorded,
            recorded,
        );
        merge_stats(
            by_name.entry(name.clone()).or_default(),
            1,
            errors,
            &histogram,
            recorded,
            recorded,
        );
        merge_stats(
            by_kind_name
                .entry((kind.clone(), name.clone()))
                .or_default(),
            1,
            errors,
            &histogram,
            recorded,
            recorded,
        );
        if let Some((lane, caller_key)) = caller {
            merge_stats(
                by_caller
                    .entry((lane, caller_key, kind.clone(), name.clone()))
                    .or_default(),
                1,
                errors,
                &histogram,
                recorded,
                recorded,
            );
        }
        let bucket_start = recorded.div_euclid(3_600_000) * 3_600_000;
        merge_series(
            &mut series,
            bucket_start,
            bucket_start.saturating_add(3_600_000),
            kind,
            name,
            1,
            errors,
        );
    }

    let mut start = None;
    let mut end = None;
    let mut status_counts = Vec::new();
    for (kind, aggregate) in by_kind {
        start = min_option(start, aggregate.start);
        end = max_option(end, aggregate.end);
        status_counts.push(TelemetryStatusCountV1 {
            kind: kind.clone(),
            status_class: "ok".to_owned(),
            count: aggregate.ok,
        });
        status_counts.push(TelemetryStatusCountV1 {
            kind,
            status_class: "error".to_owned(),
            count: aggregate.error,
        });
    }
    let latency = by_name
        .into_iter()
        .map(|(name, aggregate)| TelemetryLatencyV1 {
            name,
            count: aggregate.histogram.iter().sum(),
            p50_ms: histogram_percentile(&aggregate.histogram, 0.50),
            p95_ms: histogram_percentile(&aggregate.histogram, 0.95),
        })
        .collect();
    let named_counts = by_kind_name
        .into_iter()
        .map(|((kind, name), aggregate)| TelemetryNamedCountV1 {
            kind,
            name,
            count: aggregate.ok.saturating_add(aggregate.error),
            error_count: aggregate.error,
        })
        .collect();
    let series = series
        .into_iter()
        .map(
            |((bucket_start_ms, bucket_end_ms, kind, name), (count, error_count))| {
                TelemetrySeriesPointV1 {
                    bucket_start_ms,
                    bucket_end_ms,
                    kind,
                    name,
                    count,
                    error_count,
                }
            },
        )
        .collect();
    let caller_counts = if request.group_by_caller {
        by_caller
            .into_iter()
            .map(
                |((lane, caller_key, kind, name), aggregate)| TelemetryCallerCountV1 {
                    lane,
                    caller_key,
                    kind,
                    name,
                    count: aggregate.ok.saturating_add(aggregate.error),
                    error_count: aggregate.error,
                },
            )
            .collect()
    } else {
        Vec::new()
    };
    let exact_count_posture = if named_filter_may_be_folded || folded_count > 0 {
        "boundedByHeavyHitterFolding".to_owned()
    } else if snapped_to_bucket_boundaries {
        "exactAtReportedSnappedBucketWindow".to_owned()
    } else {
        "exactDisjointRollupsPlusRawTailAndRetainedEdges".to_owned()
    };
    let mut field_exactness = BTreeMap::from([
        (
            "statusCounts".to_owned(),
            if named_filter_may_be_folded {
                "boundedByHeavyHitterFolding".to_owned()
            } else if snapped_to_bucket_boundaries {
                "exactAtReportedSnappedBucketWindow".to_owned()
            } else {
                "exactDisjointRollupsPlusRawTailAndRetainedEdges".to_owned()
            },
        ),
        (
            "latencyPercentiles".to_owned(),
            "boundedHistogramEstimate".to_owned(),
        ),
        ("namedCounts".to_owned(), exact_count_posture.clone()),
        (
            "series".to_owned(),
            if snapped_to_bucket_boundaries {
                "exactAtReportedSnappedBucketWindow".to_owned()
            } else {
                "exactDisjointRollupsPlusRawTailAndRetainedEdges".to_owned()
            },
        ),
    ]);
    if request.group_by_caller {
        field_exactness.insert("callerCounts".to_owned(), exact_count_posture);
    }

    Ok(TelemetryStatsResponseV1 {
        schema_version: "snapback.telemetry.stats.v1".to_owned(),
        status_counts,
        latency,
        named_counts,
        series,
        caller_counts,
        coverage: TelemetryCoverageV1 {
            start_ms: start,
            end_ms: end,
            rollup_watermark_id: meta.rollup_watermark_id,
            rollup_rows,
            raw_tail_rows,
            raw_edge_rows,
            raw_tail_start_id,
            raw_tail_end_id,
            partitions,
        },
        variance: variance(
            &meta,
            context,
            field_exactness,
            TelemetryCapabilityOutcomeV1::Approximate,
            BTreeMap::from([
                (
                    "heavyHittersFoldedAsOther".to_owned(),
                    json!(folded_count > 0),
                ),
                ("foldedCount".to_owned(), json!(folded_count)),
                (
                    "partialBucketOverlap".to_owned(),
                    json!(partial_bucket_overlap),
                ),
                (
                    "rawEdgeSubstitution".to_owned(),
                    json!(raw_edge_substitution),
                ),
                (
                    "snappedToBucketBoundaries".to_owned(),
                    json!(snapped_to_bucket_boundaries),
                ),
                (
                    "namedFilterMayBeFolded".to_owned(),
                    json!(named_filter_may_be_folded),
                ),
                (
                    "requestedWindow".to_owned(),
                    json!({
                        "startMs": request.filter.from_ms,
                        "endMs": request.filter.to_ms,
                    }),
                ),
                (
                    "reportedWindow".to_owned(),
                    json!({
                        "startMs": start,
                        "endMs": end,
                    }),
                ),
                (
                    "workLimits".to_owned(),
                    json!({
                        "rollupRows": MAX_STATS_ROLLUP_ROWS,
                        "rawTailAndRetainedEdgeRows": MAX_STATS_RAW_TAIL_ROWS,
                        "rollupRowsScanned": rollup_rows_scanned,
                    }),
                ),
                (
                    "histogramPercentileErrorBounds".to_owned(),
                    json!({
                        "bucketUpperBoundMultiplier": 2.0,
                        "overflowBucketUpperBound": null,
                        "unit": "milliseconds"
                    }),
                ),
            ]),
        ),
    })
}

fn query_window_folded_count(
    connection: &Connection,
    watermark: i64,
    filter: &TelemetryStatsFilterV1,
    caller_sensitive: bool,
) -> SnapbackResult<u64> {
    let mut sql = String::from(if caller_sensitive {
        "SELECT folded_count FROM telemetry_caller_rollup_visible WHERE watermark_id<=?"
    } else {
        "SELECT folded_count FROM telemetry_rollup_visible WHERE watermark_id<=?"
    });
    let mut values = vec![SqlValue::Integer(watermark)];
    if let Some(kind) = &filter.kind {
        sql.push_str(" AND kind=?");
        values.push(SqlValue::Text(kind.clone()));
    }
    if let Some(from) = filter.from_ms {
        sql.push_str(" AND coverage_end_ms>=?");
        values.push(SqlValue::Integer(from));
    }
    if let Some(to) = filter.to_ms {
        sql.push_str(" AND coverage_start_ms<=?");
        values.push(SqlValue::Integer(to));
    }
    if caller_sensitive {
        if let Some(lane) = &filter.lane {
            sql.push_str(" AND caller_lane=?");
            values.push(SqlValue::Text(lane.clone()));
        }
        if let Some(caller_key) = &filter.caller_key {
            sql.push_str(" AND caller_key=?");
            values.push(SqlValue::Text(caller_key.clone()));
        }
    }
    sql.push_str(" LIMIT ?");
    values.push(SqlValue::Integer((MAX_STATS_ROLLUP_ROWS + 1) as i64));
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values), |row| row.get::<_, u64>(0))?;
    let mut count = 0usize;
    let mut folded = 0u64;
    for row in rows {
        count += 1;
        enforce_stats_work_limit(count as u64, MAX_STATS_ROLLUP_ROWS, "folding evidence rows")?;
        folded = folded.saturating_add(row?);
    }
    Ok(folded)
}

fn enforce_stats_work_limit(count: u64, maximum: usize, surface: &str) -> SnapbackResult<()> {
    if count <= maximum as u64 {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_TELEMETRY_STATS_WORK_LIMIT_EXCEEDED",
        "telemetry",
        "telemetry stats exceeded its bounded query work envelope; narrow the filters",
    )
    .with_details(json!({
        "surface": surface,
        "maximumRows": maximum,
    })))
}

fn append_stats_filter(
    sql: &mut String,
    values: &mut Vec<SqlValue>,
    filter: &TelemetryStatsFilterV1,
    rollup: bool,
    caller_sensitive: bool,
) {
    if let Some(kind) = &filter.kind {
        sql.push_str(" AND kind=?");
        values.push(SqlValue::Text(kind.clone()));
    }
    if let Some(name) = &filter.name {
        sql.push_str(" AND name=?");
        values.push(SqlValue::Text(name.clone()));
    }
    if let Some(from) = filter.from_ms {
        sql.push_str(if rollup {
            " AND coverage_end_ms>=?"
        } else {
            " AND recorded_ts_ms>=?"
        });
        values.push(SqlValue::Integer(from));
    }
    if let Some(to) = filter.to_ms {
        sql.push_str(if rollup {
            " AND coverage_start_ms<=?"
        } else {
            " AND recorded_ts_ms<=?"
        });
        values.push(SqlValue::Integer(to));
    }
    if caller_sensitive {
        let (lane_column, key_column) = if rollup {
            ("caller_lane", "caller_key")
        } else {
            (
                "json_extract(details,'$.callerLane')",
                "json_extract(details,'$.callerKey')",
            )
        };
        if !rollup {
            sql.push_str(
                " AND ((json_extract(details,'$.callerLane')='anonymous' AND json_extract(details,'$.callerKey')='anonymous') OR (json_extract(details,'$.callerLane')='first-party' AND json_extract(details,'$.callerKey')='') OR (json_extract(details,'$.callerLane') IN ('declared','integration') AND length(json_extract(details,'$.callerKey')) BETWEEN 1 AND 512))",
            );
        }
        if let Some(lane) = &filter.lane {
            sql.push_str(&format!(" AND {lane_column}=?"));
            values.push(SqlValue::Text(lane.clone()));
        }
        if let Some(caller_key) = &filter.caller_key {
            sql.push_str(&format!(" AND {key_column}=?"));
            values.push(SqlValue::Text(caller_key.clone()));
        }
    }
}

fn caller_attribution_from_raw_details(details: Option<&str>) -> Option<(String, String)> {
    let object = serde_json::from_str::<Value>(details?).ok()?;
    let lane = object.get("callerLane")?.as_str()?;
    let key = object.get("callerKey")?.as_str()?;
    let valid = match lane {
        "anonymous" => key == "anonymous",
        "first-party" => key.is_empty(),
        "declared" | "integration" => !key.is_empty() && key.len() <= 512,
        _ => false,
    };
    valid.then(|| (lane.to_owned(), key.to_owned()))
}

fn merge_stats(
    target: &mut StatsAggregate,
    count: u64,
    errors: u64,
    histogram: &[u64; 17],
    start: i64,
    end: i64,
) {
    target.error = target.error.saturating_add(errors);
    target.ok = target.ok.saturating_add(count.saturating_sub(errors));
    for (target, value) in target.histogram.iter_mut().zip(histogram) {
        *target = target.saturating_add(*value);
    }
    target.start = min_option(target.start, Some(start));
    target.end = max_option(target.end, Some(end));
}

#[allow(clippy::too_many_arguments)]
fn merge_series(
    series: &mut BTreeMap<(i64, i64, String, String), (u64, u64)>,
    bucket_start_ms: i64,
    bucket_end_ms: i64,
    kind: String,
    name: String,
    count: u64,
    errors: u64,
) {
    let entry = series
        .entry((bucket_start_ms, bucket_end_ms, kind, name))
        .or_default();
    entry.0 = entry.0.saturating_add(count);
    entry.1 = entry.1.saturating_add(errors);
}

fn merge_time_intervals(mut intervals: Vec<(i64, i64)>) -> Vec<(i64, i64)> {
    intervals.sort_unstable();
    let mut merged: Vec<(i64, i64)> = Vec::new();
    for (start, end) in intervals {
        if let Some(last) = merged.last_mut()
            && start <= last.1.saturating_add(1)
        {
            last.1 = last.1.max(end);
        } else {
            merged.push((start, end));
        }
    }
    merged
}

fn min_option(left: Option<i64>, right: Option<i64>) -> Option<i64> {
    left.into_iter().chain(right).min()
}
fn max_option(left: Option<i64>, right: Option<i64>) -> Option<i64> {
    left.into_iter().chain(right).max()
}

fn decode_histogram(raw: &str) -> [u64; 17] {
    let mut output = [0; 17];
    if let Ok(values) = serde_json::from_str::<Vec<u64>>(raw) {
        for (index, value) in values.into_iter().take(17).enumerate() {
            output[index] = value;
        }
    }
    output
}

fn histogram_index(duration_ms: f64) -> usize {
    if !duration_ms.is_finite() || duration_ms < 0.0 {
        return 16;
    }
    let mut bound = 1.0;
    for index in 0..16 {
        if duration_ms <= bound {
            return index;
        }
        bound *= 2.0;
    }
    16
}

fn histogram_percentile(histogram: &[u64; 17], percentile: f64) -> Option<f64> {
    let total: u64 = histogram.iter().sum();
    if total == 0 {
        return None;
    }
    let rank = ((total as f64 * percentile).ceil() as u64).max(1);
    let mut seen = 0;
    for (index, count) in histogram.iter().enumerate() {
        seen += count;
        if seen >= rank {
            return Some(if index < 16 {
                2f64.powi(index as i32)
            } else {
                65_536.0
            });
        }
    }
    Some(65_536.0)
}

pub(crate) fn begin_export(
    connection: &Connection,
    request: &TelemetryExportRequestV1,
    context: &QueryContext,
) -> SnapbackResult<TelemetryExportHeaderV1> {
    with_typed_query_budget(connection, || {
        begin_export_unbudgeted(connection, request, context)
    })
}

fn begin_export_unbudgeted(
    connection: &Connection,
    request: &TelemetryExportRequestV1,
    context: &QueryContext,
) -> SnapbackResult<TelemetryExportHeaderV1> {
    request.validate()?;
    let meta = read_meta(connection)?;
    let (app_id, environment) = export_identity(connection)?;
    let (generation, app_db_incarnation) = export_store_binding(connection)?;
    let mut maximum_sql =
        String::from("SELECT recorded_ts_ms,id FROM telemetry_events_visible WHERE 1=1");
    let mut maximum_values = Vec::new();
    append_event_filter(&mut maximum_sql, &mut maximum_values, &request.filter);
    maximum_sql.push_str(" ORDER BY recorded_ts_ms DESC,id DESC LIMIT 1");
    let snapshot = connection
        .query_row(&maximum_sql, params_from_iter(maximum_values), |row| {
            Ok(TelemetryCursorV1 {
                recorded_ts_ms: row.get(0)?,
                id: row.get(1)?,
            })
        })
        .optional()?
        .unwrap_or(TelemetryCursorV1 {
            recorded_ts_ms: 0,
            id: 0,
        });
    Ok(TelemetryExportHeaderV1 {
        schema_version: "snapback.telemetry.export.v1".to_owned(),
        record_type: "header".to_owned(),
        app_id,
        environment,
        generation,
        app_db_incarnation,
        snapshot,
        variance: variance(
            &meta,
            context,
            BTreeMap::from([(
                "events".to_owned(),
                "exactSnapshotBoundedVisibleRows".to_owned(),
            )]),
            TelemetryCapabilityOutcomeV1::Exact,
            BTreeMap::from([("pageLimitMaximum".to_owned(), json!(MAX_EVENT_LIMIT))]),
        ),
    })
}

pub(crate) fn export_page(
    connection: &Connection,
    request: &TelemetryExportRequestV1,
    header: &TelemetryExportHeaderV1,
    after: Option<&TelemetryCursorV1>,
    limit: usize,
) -> SnapbackResult<TelemetryExportPageV1> {
    with_typed_query_budget(connection, || {
        export_page_unbudgeted(connection, request, header, after, limit)
    })
}

fn export_page_unbudgeted(
    connection: &Connection,
    request: &TelemetryExportRequestV1,
    header: &TelemetryExportHeaderV1,
    after: Option<&TelemetryCursorV1>,
    limit: usize,
) -> SnapbackResult<TelemetryExportPageV1> {
    request.validate()?;
    if limit == 0 || limit > MAX_EVENT_LIMIT {
        return Err(query_invalid(format!(
            "telemetry export page limit must be between 1 and {MAX_EVENT_LIMIT}"
        )));
    }
    let current_binding = export_store_binding(connection)?;
    if (
        header.generation.as_str(),
        header.app_db_incarnation.as_str(),
    ) != (current_binding.0.as_str(), current_binding.1.as_str())
    {
        return Err(SnapbackError::error(
            "SNAPBACK_TELEMETRY_EXPORT_SNAPSHOT_STALE",
            "telemetry",
            "telemetry export snapshot belongs to a replaced or reset store generation; restart the export",
        ));
    }
    let (app_id, environment) = export_identity(connection)?;
    if (header.app_id.as_str(), header.environment.as_str())
        != (app_id.as_str(), environment.as_str())
    {
        return Err(SnapbackError::error(
            "SNAPBACK_TELEMETRY_EXPORT_SNAPSHOT_STALE",
            "telemetry",
            "telemetry export snapshot belongs to a different app/environment store binding; restart the export",
        ));
    }
    let mut sql = String::from(
        "SELECT id,observation,phase,generation,class_v,ts_ms,recorded_ts_ms,kind,name,status,duration_ms,code,correlation,release,details FROM telemetry_events_visible WHERE 1=1",
    );
    let mut values = Vec::new();
    append_event_filter(&mut sql, &mut values, &request.filter);
    sql.push_str(" AND (recorded_ts_ms < ? OR (recorded_ts_ms = ? AND id <= ?))");
    values.extend([
        SqlValue::Integer(header.snapshot.recorded_ts_ms),
        SqlValue::Integer(header.snapshot.recorded_ts_ms),
        SqlValue::Integer(header.snapshot.id),
    ]);
    if let Some(after) = after {
        sql.push_str(" AND (recorded_ts_ms > ? OR (recorded_ts_ms = ? AND id > ?))");
        values.extend([
            SqlValue::Integer(after.recorded_ts_ms),
            SqlValue::Integer(after.recorded_ts_ms),
            SqlValue::Integer(after.id),
        ]);
    }
    sql.push_str(" ORDER BY recorded_ts_ms,id LIMIT ?");
    values.push(SqlValue::Integer((limit + 1) as i64));
    let mut statement = connection.prepare(&sql)?;
    let mut events = statement
        .query_map(params_from_iter(values), event_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let truncated = events.len() > limit;
    if truncated {
        events.truncate(limit);
    }
    let next_cursor = truncated.then(|| {
        let event = events.last().expect("truncated export page contains limit");
        TelemetryCursorV1 {
            recorded_ts_ms: event.recorded_ts_ms,
            id: event.id,
        }
    });
    let records = events
        .into_iter()
        .map(|event| TelemetryExportEventV1 {
            schema_version: "snapback.telemetry.export.v1".to_owned(),
            record_type: "event".to_owned(),
            app_id: app_id.clone(),
            environment: environment.clone(),
            event,
        })
        .collect();
    Ok(TelemetryExportPageV1 {
        schema_version: "snapback.telemetry.export-page.v1".to_owned(),
        snapshot: header.snapshot.clone(),
        records,
        next_cursor,
    })
}

/// Produce one finite, continuable export page for JSON-only agent carriers.
///
/// @ref LLP 0154#amendment-2026-08-02-agent-first-export-carrier — host ops
///   and control MCP declare row/byte ceilings and advance only with an opaque,
///   authenticated token bound to the original filter and frozen snapshot.
pub(crate) fn agent_export_page(
    connection: &Connection,
    request: &TelemetryAgentExportRequestV1,
    context: &QueryContext,
    continuation_key: &[u8; 32],
) -> SnapbackResult<TelemetryAgentExportPageV1> {
    with_typed_query_budget(connection, || {
        agent_export_page_unbudgeted(connection, request, context, continuation_key)
    })
}

fn agent_export_page_unbudgeted(
    connection: &Connection,
    request: &TelemetryAgentExportRequestV1,
    context: &QueryContext,
    continuation_key: &[u8; 32],
) -> SnapbackResult<TelemetryAgentExportPageV1> {
    request.validate()?;
    let store_binding = export_store_binding(connection)?;
    let (filter, header, after) = match request.continuation_token.as_deref() {
        Some(token) => {
            let continuation = decode_export_continuation(token, continuation_key)?;
            if (
                continuation.store_generation.as_str(),
                continuation.app_db_incarnation.as_str(),
            ) != (store_binding.0.as_str(), store_binding.1.as_str())
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_TELEMETRY_EXPORT_CONTINUATION_STALE",
                    "telemetry",
                    "telemetry export continuation belongs to a replaced or reset store generation; restart the export",
                ));
            }
            (
                continuation.filter,
                continuation.header,
                Some(continuation.after),
            )
        }
        None => {
            let export_request = TelemetryExportRequestV1 {
                filter: request.filter.clone(),
            };
            let header = begin_export_unbudgeted(connection, &export_request, context)?;
            (request.filter.clone(), header, None)
        }
    };
    let export_request = TelemetryExportRequestV1 {
        filter: filter.clone(),
    };
    let raw_page = export_page_unbudgeted(
        connection,
        &export_request,
        &header,
        after.as_ref(),
        request.max_rows,
    )?;
    let has_row_after_page = raw_page.next_cursor.is_some();
    let mut accepted = Vec::new();
    let mut accepted_page = None;

    if raw_page.records.is_empty() {
        let mut page = agent_page_response(request, header, Vec::new(), None);
        set_agent_page_bytes(&mut page)?;
        if page.page_bytes > request.max_bytes {
            return Err(agent_export_page_too_small(request.max_bytes));
        }
        return Ok(page);
    }

    let raw_page_len = raw_page.records.len();
    for (index, record) in raw_page.records.into_iter().enumerate() {
        accepted.push(record);
        let more = index + 1 < raw_page_len || has_row_after_page;
        let token = if more {
            let event = &accepted
                .last()
                .expect("candidate export page has one row")
                .event;
            Some(encode_export_continuation(
                &TelemetryExportContinuationV1 {
                    version: "snapback.telemetry.export-continuation.v1".to_owned(),
                    store_generation: store_binding.0.clone(),
                    app_db_incarnation: store_binding.1.clone(),
                    filter: filter.clone(),
                    header: header.clone(),
                    after: TelemetryCursorV1 {
                        recorded_ts_ms: event.recorded_ts_ms,
                        id: event.id,
                    },
                },
                continuation_key,
            )?)
        } else {
            None
        };
        let mut candidate = agent_page_response(request, header.clone(), accepted.clone(), token);
        set_agent_page_bytes(&mut candidate)?;
        if candidate.page_bytes > request.max_bytes {
            accepted.pop();
            break;
        }
        accepted_page = Some(candidate);
    }

    accepted_page.ok_or_else(|| agent_export_page_too_small(request.max_bytes))
}

fn agent_page_response(
    request: &TelemetryAgentExportRequestV1,
    header: TelemetryExportHeaderV1,
    records: Vec<TelemetryExportEventV1>,
    continuation_token: Option<String>,
) -> TelemetryAgentExportPageV1 {
    TelemetryAgentExportPageV1 {
        schema_version: "snapback.telemetry.agent-export-page.v1".to_owned(),
        header,
        page_rows: records.len(),
        records,
        declared_bounds: TelemetryAgentExportBoundsV1 {
            max_rows: request.max_rows,
            max_bytes: request.max_bytes,
        },
        page_bytes: 0,
        truncated: continuation_token.is_some(),
        continuation_token,
    }
}

fn set_agent_page_bytes(page: &mut TelemetryAgentExportPageV1) -> SnapbackResult<()> {
    for _ in 0..8 {
        let length = serde_json::to_vec(page)
            .map_err(|_| query_invalid("telemetry agent export page could not be serialized"))?
            .len();
        if page.page_bytes == length {
            return Ok(());
        }
        page.page_bytes = length;
    }
    Err(query_invalid(
        "telemetry agent export page byte accounting did not converge",
    ))
}

fn agent_export_page_too_small(max_bytes: usize) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_TELEMETRY_EXPORT_PAGE_TOO_SMALL",
        "telemetry",
        format!(
            "telemetry agent export maxBytes={max_bytes} cannot carry the page metadata and next record; increase maxBytes"
        ),
    )
}

const EXPORT_CONTINUATION_PREFIX: &str = "sbtel1";
const MAX_EXPORT_CONTINUATION_BYTES: usize = 32 * 1024;

fn encode_export_continuation(
    continuation: &TelemetryExportContinuationV1,
    key: &[u8; 32],
) -> SnapbackResult<String> {
    let payload = serde_json::to_vec(continuation).map_err(|_| invalid_export_continuation())?;
    if payload.len() > MAX_EXPORT_CONTINUATION_BYTES {
        return Err(invalid_export_continuation());
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts 32-byte keys");
    mac.update(EXPORT_CONTINUATION_PREFIX.as_bytes());
    mac.update(&[0]);
    mac.update(&payload);
    Ok(format!(
        "{EXPORT_CONTINUATION_PREFIX}.{}.{}",
        URL_SAFE_NO_PAD.encode(&payload),
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    ))
}

fn decode_export_continuation(
    token: &str,
    key: &[u8; 32],
) -> SnapbackResult<TelemetryExportContinuationV1> {
    if token.len() > MAX_EXPORT_CONTINUATION_TOKEN_BYTES {
        return Err(invalid_export_continuation());
    }
    let mut parts = token.split('.');
    let (Some(prefix), Some(payload), Some(signature), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(invalid_export_continuation());
    };
    if prefix != EXPORT_CONTINUATION_PREFIX {
        return Err(invalid_export_continuation());
    }
    let payload = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| invalid_export_continuation())?;
    let signature = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| invalid_export_continuation())?;
    if payload.len() > MAX_EXPORT_CONTINUATION_BYTES {
        return Err(invalid_export_continuation());
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts 32-byte keys");
    mac.update(EXPORT_CONTINUATION_PREFIX.as_bytes());
    mac.update(&[0]);
    mac.update(&payload);
    mac.verify_slice(&signature)
        .map_err(|_| invalid_export_continuation())?;
    let continuation: TelemetryExportContinuationV1 =
        serde_json::from_slice(&payload).map_err(|_| invalid_export_continuation())?;
    if continuation.version != "snapback.telemetry.export-continuation.v1" {
        return Err(invalid_export_continuation());
    }
    validate_filter(&continuation.filter)?;
    if continuation.store_generation != continuation.header.generation
        || continuation.app_db_incarnation != continuation.header.app_db_incarnation
    {
        return Err(invalid_export_continuation());
    }
    Ok(continuation)
}

fn invalid_export_continuation() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_TELEMETRY_EXPORT_CONTINUATION_INVALID",
        "telemetry",
        "telemetry export continuation is invalid or belongs to another server startup",
    )
}

fn export_store_binding(connection: &Connection) -> SnapbackResult<(String, String)> {
    connection
        .query_row(
            "SELECT generation,app_db_incarnation FROM telemetry_meta WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(Into::into)
}

fn export_identity(connection: &Connection) -> SnapbackResult<(String, String)> {
    let (app_id, environment): (Option<String>, Option<String>) = connection.query_row(
        "SELECT app_id,environment FROM telemetry_meta WHERE singleton=1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let (Some(app_id), Some(environment)) = (app_id, environment) else {
        return Err(SnapbackError::error(
            "SNAPBACK_TELEMETRY_IDENTITY_UNBOUND",
            "telemetry",
            "telemetry export requires a trusted app/environment store binding",
        ));
    };
    Ok((app_id, environment))
}

/// Execute exactly one local-only statement against the telemetry sibling.
///
/// @ref LLP 0154#d5--the-query-contract-typed-operations-projected-everywhere — read-only open plus an
///   attribution-aware authorizer admits base reads only through the visible
///   views. This function deliberately has no HTTP route.
pub fn query_local_sql(
    telemetry_path: &Path,
    sql: &str,
    budget: TelemetrySqlBudgetV1,
) -> SnapbackResult<TelemetrySqlResultV1> {
    if sql.trim().is_empty() {
        return Err(sql_denied("telemetry SQL query must not be empty"));
    }
    if sql.len() > MAX_SQL_QUERY_BYTES {
        return Err(sql_denied(format!(
            "telemetry SQL query exceeds the {MAX_SQL_QUERY_BYTES}-byte input limit"
        )));
    }
    if budget.max_rows == 0
        || budget.max_steps == 0
        || budget.max_time_ms == 0
        || budget.max_bytes == 0
    {
        return Err(sql_denied("telemetry SQL budgets must all be positive"));
    }
    if budget.max_rows > MAX_SQL_ROW_BUDGET
        || budget.max_steps > MAX_SQL_STEP_BUDGET
        || budget.max_time_ms > MAX_SQL_TIME_BUDGET_MS
        || budget.max_bytes > MAX_SQL_BYTE_BUDGET
    {
        return Err(sql_denied(
            "telemetry SQL budgets exceed the hard C8 ceilings",
        ));
    }
    let connection = Connection::open_with_flags(
        telemetry_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| sql_open_failed(telemetry_path, error))?;
    connection.pragma_update(None, "temp_store", "MEMORY")?;
    connection.set_prepared_statement_cache_capacity(0);
    // The post-row byte meter cannot stop a scalar function allocating before
    // SQLite returns a value. Clamp SQLite itself so every value/row and the
    // compiled statement are bounded before VM execution.
    connection.set_limit(
        Limit::SQLITE_LIMIT_LENGTH,
        i32::try_from(budget.max_bytes).unwrap_or(i32::MAX),
    );
    connection.set_limit(
        Limit::SQLITE_LIMIT_SQL_LENGTH,
        i32::try_from(MAX_SQL_QUERY_BYTES).unwrap(),
    );
    connection.set_limit(Limit::SQLITE_LIMIT_COLUMN, 256);
    connection.set_limit(Limit::SQLITE_LIMIT_EXPR_DEPTH, 100);
    connection.set_limit(Limit::SQLITE_LIMIT_COMPOUND_SELECT, 100);
    connection.set_limit(Limit::SQLITE_LIMIT_FUNCTION_ARG, 32);
    connection.set_limit(Limit::SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 4_096);
    connection.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0);
    connection.set_limit(Limit::SQLITE_LIMIT_WORKER_THREADS, 0);
    connection.authorizer(Some(telemetry_sql_authorizer));

    let max_rows = budget.max_rows;
    let max_steps = budget.max_steps;
    let max_bytes = budget.max_bytes;
    let deadline = Duration::from_millis(budget.max_time_ms);
    let steps = Arc::new(AtomicU64::new(0));
    let progress_steps = Arc::clone(&steps);
    let started = Instant::now();
    connection.progress_handler(
        100,
        Some(move || {
            let observed = progress_steps
                .fetch_add(100, Ordering::Relaxed)
                .saturating_add(100);
            observed > max_steps || started.elapsed() > deadline
        }),
    );

    validate_single_sql_statement(&connection, sql)?;

    let mut statement = connection.prepare(sql).map_err(map_sql_hatch_error)?;
    if !statement.readonly() {
        return Err(sql_denied("telemetry SQL statement is not read-only"));
    }
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut cursor = statement.query([]).map_err(map_sql_hatch_error)?;
    let columns_json_bytes = serde_json::to_vec(&columns)
        .map_err(|_| query_invalid("telemetry SQL columns could not be serialized"))?
        .len();
    let fixed_json_bytes = sql_result_fixed_json_bytes();
    let mut rows = Vec::new();
    let mut rows_json_bytes = 2usize;
    let mut truncated = false;
    enforce_sql_result_byte_budget(
        fixed_json_bytes,
        columns_json_bytes,
        rows_json_bytes,
        steps.load(Ordering::Relaxed),
        started.elapsed().as_millis().try_into().unwrap_or(u64::MAX),
        truncated,
        max_bytes,
    )?;
    while let Some(row) = cursor.next().map_err(map_sql_hatch_error)? {
        if rows.len() >= max_rows {
            truncated = true;
            break;
        }
        let mut values = Vec::with_capacity(columns.len());
        for index in 0..columns.len() {
            let value = value_ref_to_json(row.get_ref(index)?);
            values.push(value);
        }
        let row_json_bytes = serde_json::to_vec(&values)
            .map_err(|_| query_invalid("telemetry SQL row could not be serialized"))?
            .len();
        let candidate_rows_json_bytes = rows_json_bytes
            .saturating_add(usize::from(!rows.is_empty()))
            .saturating_add(row_json_bytes);
        enforce_sql_result_byte_budget(
            fixed_json_bytes,
            columns_json_bytes,
            candidate_rows_json_bytes,
            steps.load(Ordering::Relaxed),
            started.elapsed().as_millis().try_into().unwrap_or(u64::MAX),
            truncated,
            max_bytes,
        )?;
        rows_json_bytes = candidate_rows_json_bytes;
        rows.push(values);
    }
    let elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
    let result = TelemetrySqlResultV1 {
        schema_version: SQL_RESULT_SCHEMA_VERSION.to_owned(),
        columns,
        rows,
        steps: steps.load(Ordering::Relaxed),
        elapsed_ms,
        truncated,
    };
    let exact_bytes = serde_json::to_vec(&result)
        .map_err(|_| query_invalid("telemetry SQL result could not be serialized"))?
        .len();
    if exact_bytes > max_bytes {
        return Err(sql_budget_exceeded("byte", max_bytes as u64));
    }
    debug_assert_eq!(
        exact_bytes,
        sql_result_json_bytes(
            fixed_json_bytes,
            columns_json_bytes,
            rows_json_bytes,
            result.steps,
            result.elapsed_ms,
            result.truncated,
        )
    );
    Ok(result)
}

/// Fixed bytes in the compact JSON object after subtracting each dynamic
/// value. Keeping this derived from the actual response serializer makes the
/// incremental C8 meter exact without repeatedly serializing all prior rows.
fn sql_result_fixed_json_bytes() -> usize {
    let empty = TelemetrySqlResultV1 {
        schema_version: SQL_RESULT_SCHEMA_VERSION.to_owned(),
        columns: Vec::new(),
        rows: Vec::new(),
        steps: 0,
        elapsed_ms: 0,
        truncated: false,
    };
    serde_json::to_vec(&empty)
        .expect("telemetry SQL result shape serializes")
        .len()
        - 2 // columns: []
        - 2 // rows: []
        - 1 // steps: 0
        - 1 // elapsedMs: 0
        - 5 // truncated: false
}

fn sql_result_json_bytes(
    fixed: usize,
    columns: usize,
    rows: usize,
    steps: u64,
    elapsed_ms: u64,
    truncated: bool,
) -> usize {
    fixed
        .saturating_add(columns)
        .saturating_add(rows)
        .saturating_add(steps.to_string().len())
        .saturating_add(elapsed_ms.to_string().len())
        .saturating_add(if truncated { 4 } else { 5 })
}

#[allow(clippy::too_many_arguments)]
fn enforce_sql_result_byte_budget(
    fixed: usize,
    columns: usize,
    rows: usize,
    steps: u64,
    elapsed_ms: u64,
    truncated: bool,
    maximum: usize,
) -> SnapbackResult<()> {
    if sql_result_json_bytes(fixed, columns, rows, steps, elapsed_ms, truncated) <= maximum {
        return Ok(());
    }
    Err(sql_budget_exceeded("byte", maximum as u64))
}

fn telemetry_sql_authorizer(context: AuthContext<'_>) -> Authorization {
    match context.action {
        AuthAction::Select | AuthAction::Recursive => Authorization::Allow,
        AuthAction::Read { table_name, .. } => {
            let visible = matches!(
                table_name,
                "telemetry_events_visible" | "telemetry_rollup_visible"
            );
            let attributed = context.accessor.is_some_and(|view| {
                matches!(
                    view,
                    "telemetry_events_visible" | "telemetry_rollup_visible"
                )
            });
            // A CTE/recursive working table has no database owner. Main and
            // temp base tables always carry one and remain denied unless the
            // visibility-view accessor is the reason SQLite is reading them.
            let ephemeral_cte = context.database_name.is_none();
            if visible || attributed || ephemeral_cte {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::Function { function_name } if allowed_sql_function(function_name) => {
            Authorization::Allow
        }
        _ => Authorization::Deny,
    }
}

/// Walk SQLite's own prepare tail without executing any statement. This is
/// local rather than rusqlite's crate-wide `extra_check` feature because that
/// feature changes existing `execute_batch` PRAGMA behavior elsewhere in the
/// runtime. Every raw statement is finalized before the next tail is read.
fn validate_single_sql_statement(connection: &Connection, sql: &str) -> SnapbackResult<()> {
    let input =
        CString::new(sql).map_err(|_| sql_denied("telemetry SQL contains an embedded NUL byte"))?;
    let start = input.as_ptr();
    // SAFETY: `input` owns a NUL-terminated buffer for this whole loop;
    // `connection` remains alive; SQLite owns each prepared statement only
    // until the unconditional finalize below.
    let end = unsafe { start.add(sql.len()) };
    let mut cursor = start;
    let mut statements = 0usize;
    while cursor < end {
        let mut raw = ptr::null_mut();
        let mut tail = ptr::null();
        let remaining = unsafe { end.offset_from(cursor) };
        let remaining = i32::try_from(remaining)
            .map_err(|_| sql_denied("telemetry SQL statement is too large"))?;
        let code = unsafe {
            rusqlite::ffi::sqlite3_prepare_v2(
                connection.handle(),
                cursor,
                remaining,
                &mut raw,
                &mut tail,
            )
        };
        if code != rusqlite::ffi::SQLITE_OK {
            if !raw.is_null() {
                unsafe { rusqlite::ffi::sqlite3_finalize(raw) };
            }
            return Err(map_sql_hatch_error(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(code),
                None,
            )));
        }
        if raw.is_null() {
            break;
        }
        statements += 1;
        unsafe { rusqlite::ffi::sqlite3_finalize(raw) };
        if statements > 1 {
            return Err(sql_denied(
                "telemetry SQL accepts exactly one statement with no tail",
            ));
        }
        if tail.is_null() || tail <= cursor {
            return Err(sql_denied("telemetry SQL parser made no forward progress"));
        }
        cursor = tail;
    }
    if statements != 1 {
        return Err(sql_denied("telemetry SQL requires exactly one statement"));
    }
    Ok(())
}

fn allowed_sql_function(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "abs"
            | "avg"
            | "coalesce"
            | "count"
            | "ifnull"
            | "instr"
            | "length"
            | "lower"
            | "max"
            | "min"
            | "nullif"
            | "round"
            | "substr"
            | "substring"
            | "sum"
            | "total"
            | "trim"
            | "typeof"
            | "upper"
    )
}

fn value_ref_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => json!(value),
        ValueRef::Real(value) => json!(value),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => {
            json!({ "base64": base64::engine::general_purpose::STANDARD.encode(value) })
        }
    }
}

fn query_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_TELEMETRY_QUERY_INVALID", "telemetry", message)
}

fn sql_denied(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_TELEMETRY_SQL_DENIED", "telemetry", message)
}

fn sql_budget_exceeded(kind: &str, limit: u64) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_TELEMETRY_SQL_BUDGET_EXCEEDED",
        "telemetry",
        "telemetry SQL query exceeded its local resource budget",
    )
    .with_details(json!({ "budget": kind, "limit": limit }))
}

fn sql_open_failed(path: &Path, error: rusqlite::Error) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_TELEMETRY_SQL_OPEN_FAILED",
        "telemetry",
        "telemetry sibling could not be opened read-only",
    )
    .with_details(json!({
        "path": path.display().to_string(),
        "error": error.to_string()
    }))
}

fn map_sql_hatch_error(error: rusqlite::Error) -> SnapbackError {
    use rusqlite::ErrorCode;
    match &error {
        rusqlite::Error::SqliteFailure(inner, _)
            if inner.code == ErrorCode::AuthorizationForStatementDenied =>
        {
            sql_denied("telemetry SQL authorizer denied the statement")
        }
        rusqlite::Error::SqliteFailure(inner, _)
            if inner.code == ErrorCode::OperationInterrupted =>
        {
            sql_budget_exceeded("step-or-time", 0)
        }
        rusqlite::Error::MultipleStatement => {
            sql_denied("telemetry SQL accepts exactly one statement with no tail")
        }
        _ => SnapbackError::error(
            "SNAPBACK_TELEMETRY_SQL_FAILED",
            "telemetry",
            "telemetry SQL query failed",
        )
        .with_details(json!({ "error": error.to_string() })),
    }
}

/// Committed, language-neutral examples for every typed query response and
/// the NDJSON record family. The schema drift gate writes this value beside
/// the generated schemas.
pub fn query_fixture_corpus() -> Value {
    json!({
        "schemaVersion": "snapback.telemetry.query-fixtures.v1",
        "events": {
            "request": { "kind": "http_request", "order": "desc", "limit": 2 },
            "response": {
                "schemaVersion": "snapback.telemetry.events.v1",
                "order": "desc",
                "events": [{
                    "id": 7,
                    "observation": "obs_fixture",
                    "phase": "joined",
                    "generation": "gen_fixture",
                    "classV": 1,
                    "tsMs": 1000,
                    "recordedTsMs": 1001,
                    "kind": "http_request",
                    "name": "/health",
                    "status": 200,
                    "durationMs": 2.0,
                    "code": null,
                    "correlation": null,
                    "release": "sha256:fixture",
                    "details": null
                }],
                "nextCursor": null,
                "variance": fixture_variance("exact")
            }
        },
        "stats": {
            "request": { "fromMs": 0, "toMs": 2000 },
            "response": {
                "schemaVersion": "snapback.telemetry.stats.v1",
                "statusCounts": [
                    { "kind": "http_request", "statusClass": "ok", "count": 1 },
                    { "kind": "http_request", "statusClass": "error", "count": 0 }
                ],
                "latency": [{ "name": "/health", "count": 1, "p50Ms": 2.0, "p95Ms": 2.0 }],
                "namedCounts": [{
                    "kind": "http_request", "name": "/health", "count": 1, "errorCount": 0
                }],
                "series": [{
                    "bucketStartMs": 0,
                    "bucketEndMs": 3600000,
                    "kind": "http_request",
                    "name": "/health",
                    "count": 1,
                    "errorCount": 0
                }],
                "coverage": {
                    "startMs": 1001,
                    "endMs": 1001,
                    "rollupWatermarkId": 7,
                    "rollupRows": 1,
                    "rawTailRows": 0,
                    "rawEdgeRows": 0,
                    "rawTailStartId": null,
                    "rawTailEndId": null,
                    "partitions": [{
                        "tier": "hourly",
                        "bucketStartMs": 0,
                        "bucketEndMs": 3600000,
                        "coverageStartMs": 1001,
                        "coverageEndMs": 1001,
                        "watermarkId": 7,
                        "kind": "http_request",
                        "name": "/health",
                        "count": 1,
                        "errorCount": 0,
                        "foldedCount": 0
                    }]
                },
                "variance": fixture_variance("approximate")
            },
            "namedFilterFolded": {
                "request": { "kind": "http_request", "name": "z-folded-name" },
                "expected": {
                    "statusCounts": [],
                    "fieldExactness": "boundedByHeavyHitterFolding",
                    "namedFilterMayBeFolded": true
                }
            }
        },
        "export": {
            "request": { "kind": "http_request" },
            "header": {
                "schemaVersion": "snapback.telemetry.export.v1",
                "recordType": "header",
                "appId": "app_fixture",
                "environment": "local",
                "generation": "gen_fixture",
                "appDbIncarnation": "01900000-0000-7000-8000-000000000001",
                "snapshot": { "recordedTsMs": 1001, "id": 7 },
                "variance": fixture_variance("exact")
            },
            "page": {
                "schemaVersion": "snapback.telemetry.export-page.v1",
                "snapshot": { "recordedTsMs": 1001, "id": 7 },
                "records": [],
                "nextCursor": null
            }
        },
        "agentExport": {
            "request": {
                "kind": "http_request",
                "maxRows": 2,
                "maxBytes": 65536
            },
            "continuationRequest": {
                "continuationToken": "sbtel1.eyJ2ZXJzaW9uIjoic25hcGJhY2sudGVsZW1ldHJ5LmV4cG9ydC1jb250aW51YXRpb24udjEifQ.Zml4dHVyZS1tYWM",
                "maxRows": 2,
                "maxBytes": 65536
            },
            "page": {
                "schemaVersion": "snapback.telemetry.agent-export-page.v1",
                "header": {
                    "schemaVersion": "snapback.telemetry.export.v1",
                    "recordType": "header",
                    "appId": "app_fixture",
                    "environment": "local",
                    "generation": "gen_fixture",
                    "appDbIncarnation": "01900000-0000-7000-8000-000000000001",
                    "snapshot": { "recordedTsMs": 1001, "id": 7 },
                    "variance": fixture_variance("exact")
                },
                "records": [{
                    "schemaVersion": "snapback.telemetry.export.v1",
                    "recordType": "event",
                    "appId": "app_fixture",
                    "environment": "local",
                    "id": 7,
                    "observation": "obs_fixture",
                    "phase": "joined",
                    "generation": "gen_fixture",
                    "classV": 1,
                    "tsMs": 1000,
                    "recordedTsMs": 1001,
                    "kind": "http_request",
                    "name": "/health",
                    "status": 200,
                    "durationMs": 2.0,
                    "code": null,
                    "correlation": null,
                    "release": "sha256:fixture",
                    "details": null
                }],
                "declaredBounds": { "maxRows": 2, "maxBytes": 65536 },
                "pageRows": 1,
                "pageBytes": 1138,
                "truncated": true,
                "continuationToken": "sbtel1.eyJ2ZXJzaW9uIjoic25hcGJhY2sudGVsZW1ldHJ5LmV4cG9ydC1jb250aW51YXRpb24udjEifQ.Zml4dHVyZS1tYWM"
            }
        }
    })
}

fn fixture_variance(outcome: &str) -> Value {
    json!({
        "storeBackend": "local-sqlite-sibling",
        "fieldExactness": {},
        "samplingFactor": 1.0,
        "freshnessWatermark": 1001,
        "retentionBoundaryMs": 0,
        "dropsSinceBoot": {},
        "dropsLifetime": {},
        "truncation": {},
        "capabilityOutcome": outcome
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fixture() -> (tempfile::TempDir, std::path::PathBuf) {
        let directory = tempdir().unwrap();
        let path = directory.path().join("telemetry.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE telemetry_events(id INTEGER, name TEXT);\n\
                 CREATE TABLE telemetry_rollup_hourly(id INTEGER);\n\
                 CREATE VIEW telemetry_events_visible AS SELECT * FROM telemetry_events;\n\
                 CREATE VIEW telemetry_rollup_visible AS SELECT * FROM telemetry_rollup_hourly;\n\
                 INSERT INTO telemetry_events VALUES(1,'ok');",
            )
            .unwrap();
        (directory, path)
    }

    #[test]
    fn sql_hatch_allows_views_and_denies_base_tables_mutations_and_escape_features() {
        let (_directory, path) = fixture();
        let answer = query_local_sql(
            &path,
            "SELECT id,name FROM telemetry_events_visible",
            TelemetrySqlBudgetV1::default(),
        )
        .unwrap();
        assert_eq!(answer.rows, vec![vec![json!(1), json!("ok")]]);
        for sql in [
            "SELECT ';' FROM telemetry_events_visible",
            "SELECT id FROM telemetry_events_visible -- ; SELECT 2",
            "SELECT id /* ; SELECT 2 */ FROM telemetry_events_visible",
        ] {
            query_local_sql(&path, sql, TelemetrySqlBudgetV1::default()).unwrap_or_else(|error| {
                panic!("parser-safe semicolon refused for {sql}: {error:?}")
            });
        }
        for sql in [
            "SELECT * FROM telemetry_events",
            "SELECT * FROM telemetry_rollup_hourly",
            "DELETE FROM telemetry_events_visible",
            "PRAGMA table_info(telemetry_events_visible)",
            "ATTACH DATABASE ':memory:' AS other",
            "DETACH DATABASE main",
            "SELECT load_extension('nope')",
            "SELECT printf('%1000000000s','x') FROM telemetry_events_visible",
            "SELECT * FROM telemetry_events_visible; SELECT 1",
            "SELECT * FROM telemetry_events_visible\0; SELECT 1",
        ] {
            let error =
                query_local_sql(&path, sql, TelemetrySqlBudgetV1::default()).expect_err(sql);
            assert!(
                matches!(
                    error.diagnostic.code.as_str(),
                    "SNAPBACK_TELEMETRY_SQL_DENIED" | "SNAPBACK_TELEMETRY_SQL_FAILED"
                ),
                "{sql}: {:?}",
                error.diagnostic
            );
        }
        let oversized = " ".repeat(MAX_SQL_QUERY_BYTES + 1);
        let error = query_local_sql(&path, &oversized, TelemetrySqlBudgetV1::default())
            .expect_err("SQL input bytes are bounded before prepare");
        assert_eq!(error.diagnostic.code, "SNAPBACK_TELEMETRY_SQL_DENIED");
    }

    #[test]
    fn sql_hatch_enforces_row_and_step_budgets() {
        let (_directory, path) = fixture();
        let row_limited = query_local_sql(
            &path,
            "SELECT id FROM telemetry_events_visible UNION ALL SELECT id FROM telemetry_events_visible",
            TelemetrySqlBudgetV1 {
                max_rows: 1,
                ..TelemetrySqlBudgetV1::default()
            },
        )
        .unwrap();
        assert_eq!(row_limited.rows.len(), 1);
        assert!(row_limited.truncated);
        let error = query_local_sql(
            &path,
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000) SELECT count(*) FROM n, telemetry_events_visible",
            TelemetrySqlBudgetV1 {
                max_steps: 100,
                ..TelemetrySqlBudgetV1::default()
            },
        )
        .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_TELEMETRY_SQL_BUDGET_EXCEEDED"
        );
    }

    #[test]
    fn sql_hatch_byte_budget_covers_columns_and_the_exact_response_envelope() {
        let (_directory, path) = fixture();
        let alias = "a".repeat(1_000);
        let sql = format!("SELECT id AS \"{alias}\" FROM telemetry_events_visible");
        let maximum = 1_024;
        let error = query_local_sql(
            &path,
            &sql,
            TelemetrySqlBudgetV1 {
                max_bytes: maximum,
                ..TelemetrySqlBudgetV1::default()
            },
        )
        .expect_err("a tiny cell behind a large alias must still exceed the output budget");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_TELEMETRY_SQL_BUDGET_EXCEEDED"
        );
        assert_eq!(error.diagnostic.details["budget"], json!("byte"));
        assert_eq!(error.diagnostic.details["limit"], json!(maximum));

        let successful_budget = 2_048;
        let result = query_local_sql(
            &path,
            &sql,
            TelemetrySqlBudgetV1 {
                max_bytes: successful_budget,
                ..TelemetrySqlBudgetV1::default()
            },
        )
        .unwrap();
        assert!(serde_json::to_vec(&result).unwrap().len() <= successful_budget);
    }

    #[test]
    fn typed_query_progress_budget_interrupts_work_and_removes_its_hook() {
        let connection = Connection::open_in_memory().unwrap();
        let error = with_typed_query_budget_limits(
            &connection,
            100,
            Duration::from_secs(1),
            || {
                connection
                    .query_row(
                        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000) SELECT count(*) FROM n",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(Into::into)
            },
        )
        .expect_err("typed query work must be interruptible");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_TELEMETRY_QUERY_WORK_LIMIT_EXCEEDED"
        );
        assert_eq!(
            connection
                .query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1,
            "the scoped handler is removed after the typed read"
        );
    }

    #[test]
    fn finite_agent_export_fixture_pins_bounds_and_continuation() {
        let corpus = query_fixture_corpus();
        let fixture = &corpus["agentExport"];
        let request: TelemetryAgentExportRequestV1 =
            serde_json::from_value(fixture["request"].clone()).unwrap();
        request.validate().unwrap();
        let continuation_request: TelemetryAgentExportRequestV1 =
            serde_json::from_value(fixture["continuationRequest"].clone()).unwrap();
        continuation_request.validate().unwrap();
        let page: TelemetryAgentExportPageV1 =
            serde_json::from_value(fixture["page"].clone()).unwrap();
        assert_eq!(page.page_rows, page.records.len());
        assert_eq!(page.truncated, page.continuation_token.is_some());
        assert_eq!(page.declared_bounds.max_rows, request.max_rows);
        assert_eq!(page.declared_bounds.max_bytes, request.max_bytes);
        assert_eq!(
            page.page_bytes,
            serde_json::to_vec(&page).unwrap().len(),
            "the fixture preserves the finite carrier's exact byte accounting"
        );
    }
}
