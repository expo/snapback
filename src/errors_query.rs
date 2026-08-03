//! Typed issue-triage reads over the error-tracking views owned by telemetry.
//!
//! This module is deliberately a consumer. Grouping, release activation, and
//! authored transitions stay on the telemetry store's single write owner.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::telemetry_query::{QueryContext, TelemetryCapabilityOutcomeV1, TelemetryVarianceV1};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const DEFAULT_ISSUE_LIMIT: usize = 100;
pub const MAX_ISSUE_LIMIT: usize = 500;
pub const ERRORS_FIXTURE_CORPUS_FILE: &str = "errors.query-fixtures-v1.json";
const CURSOR_MAX_BYTES: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorsIssueStateV1 {
    Open,
    Resolved,
    Ignored,
    Regressed,
}

impl ErrorsIssueStateV1 {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Resolved => "resolved",
            Self::Ignored => "ignored",
            Self::Regressed => "regressed",
        }
    }

    fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "open" => Ok(Self::Open),
            "resolved" => Ok(Self::Resolved),
            "ignored" => Ok(Self::Ignored),
            "regressed" => Ok(Self::Regressed),
            _ => Err(SnapbackError::error(
                "SNAPBACK_ERROR_GROUP_STATE_INVALID",
                "telemetry",
                "error group contains an invalid state",
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorsIssueOrderV1 {
    #[default]
    LastSeen,
    Count,
}

impl ErrorsIssueOrderV1 {
    fn column(self) -> &'static str {
        match self {
            Self::LastSeen => "last_seen_ms",
            Self::Count => "count",
        }
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorsIssuesRequestV1 {
    #[serde(default)]
    pub state: Option<ErrorsIssueStateV1>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub subsystem: Option<String>,
    #[serde(default)]
    pub failure_disposition: Option<String>,
    #[serde(default)]
    pub release: Option<String>,
    #[serde(default)]
    pub since: Option<String>,
    #[serde(default)]
    pub from_ms: Option<i64>,
    #[serde(default)]
    pub to_ms: Option<i64>,
    #[serde(default)]
    pub order: ErrorsIssueOrderV1,
    #[serde(default)]
    #[schemars(length(max = CURSOR_MAX_BYTES))]
    pub cursor: Option<String>,
    #[serde(default = "default_issue_limit")]
    #[schemars(range(min = 1, max = MAX_ISSUE_LIMIT))]
    pub limit: usize,
}

fn default_issue_limit() -> usize {
    DEFAULT_ISSUE_LIMIT
}

impl ErrorsIssuesRequestV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        if self.limit == 0 || self.limit > MAX_ISSUE_LIMIT {
            return Err(errors_invalid(format!(
                "errors issues limit must be between 1 and {MAX_ISSUE_LIMIT}"
            )));
        }
        if self
            .from_ms
            .is_some_and(|from| self.to_ms.is_some_and(|to| from > to))
        {
            return Err(errors_invalid("errors fromMs must not exceed toMs"));
        }
        for (name, value) in [
            ("kind", self.kind.as_deref()),
            ("name", self.name.as_deref()),
            ("subsystem", self.subsystem.as_deref()),
            ("failureDisposition", self.failure_disposition.as_deref()),
            ("release", self.release.as_deref()),
            ("since", self.since.as_deref()),
        ] {
            if value.is_some_and(|value| value.is_empty() || value.len() > 3_000) {
                return Err(errors_invalid(format!("errors {name} filter is invalid")));
            }
        }
        if self
            .cursor
            .as_ref()
            .is_some_and(|cursor| cursor.len() > CURSOR_MAX_BYTES)
        {
            return Err(errors_invalid("errors cursor is too large"));
        }
        Ok(())
    }
}

impl Default for ErrorsIssuesRequestV1 {
    fn default() -> Self {
        Self {
            state: None,
            kind: None,
            name: None,
            subsystem: None,
            failure_disposition: None,
            release: None,
            since: None,
            from_ms: None,
            to_ms: None,
            order: ErrorsIssueOrderV1::LastSeen,
            cursor: None,
            limit: DEFAULT_ISSUE_LIMIT,
        }
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorIssueSummaryV1 {
    pub issue: String,
    pub title: String,
    pub state: ErrorsIssueStateV1,
    pub state_seq: i64,
    pub kind: String,
    pub name: String,
    pub code: Option<String>,
    pub error_class: Option<String>,
    pub status_class: Option<i64>,
    pub subsystem: Option<String>,
    pub failure_disposition: String,
    pub first_seen_ms: i64,
    pub last_seen_ms: i64,
    pub first_seen_seq: i64,
    pub last_seen_seq: i64,
    pub last_regressed_seq: Option<i64>,
    pub first_release: Option<String>,
    pub last_release: Option<String>,
    pub count: u64,
    pub suppressed_cooldown_count: u64,
    pub suppressed_rollout_count: u64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorsVarianceV1 {
    #[serde(flatten)]
    pub telemetry: TelemetryVarianceV1,
    pub overflow_fold_count: u64,
    pub overflow_fold_scope: String,
    pub group_horizon_start_ms: i64,
    pub exemplar_stale: bool,
    pub exemplar_truncated: bool,
    pub exemplar_drop_counters: BTreeMap<String, u64>,
    pub suppression_counters: BTreeMap<String, u64>,
    pub transition_history_floor_seq: Option<i64>,
    pub transition_history_truncated: bool,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorsIssuesResponseV1 {
    pub schema_version: String,
    pub order: ErrorsIssueOrderV1,
    pub issues: Vec<ErrorIssueSummaryV1>,
    pub next_cursor: Option<String>,
    pub known_releases: Vec<String>,
    pub variance: ErrorsVarianceV1,
}

#[derive(Clone, Debug, Default, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorsIssueRequestV1 {
    pub issue: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorCorrelationQueryV1 {
    pub operation: String,
    pub input: Value,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorExemplarV1 {
    pub observation: String,
    pub recorded_ts_ms: i64,
    pub recorded_seq: i64,
    pub release: Option<String>,
    pub title_template: Option<String>,
    pub template_truncated: bool,
    pub stack_head: Option<String>,
    pub stack_truncated: bool,
    pub telemetry_events_query: ErrorCorrelationQueryV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorTransitionV1 {
    pub seq: i64,
    pub from: ErrorsIssueStateV1,
    pub to: ErrorsIssueStateV1,
    pub at_ms: i64,
    pub actor: String,
    pub release: Option<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorsIssueResponseV1 {
    pub schema_version: String,
    pub issue: ErrorIssueSummaryV1,
    pub exemplars: Vec<ErrorExemplarV1>,
    pub transitions: Vec<ErrorTransitionV1>,
    pub variance: ErrorsVarianceV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorsTransitionSelectorV1 {
    pub open_before: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(untagged)]
pub enum ErrorsTransitionRequestV1 {
    Single(ErrorsSingleTransitionRequestV1),
    Bulk(ErrorsBulkTransitionRequestV1),
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorsSingleTransitionRequestV1 {
    pub issue: String,
    pub to: ErrorsIssueStateV1,
    #[schemars(range(min = 0))]
    pub expect_seq: i64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorsBulkTransitionRequestV1 {
    pub selector: ErrorsTransitionSelectorV1,
    pub to: ErrorsIssueStateV1,
}

impl Default for ErrorsTransitionRequestV1 {
    fn default() -> Self {
        Self::Single(ErrorsSingleTransitionRequestV1 {
            issue: String::new(),
            to: ErrorsIssueStateV1::Open,
            expect_seq: 0,
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorTransitionOutcomeV1 {
    Applied,
    Conflict,
    Invalid,
    Missing,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorTransitionResultV1 {
    pub issue: String,
    pub outcome: ErrorTransitionOutcomeV1,
    pub state: Option<ErrorsIssueStateV1>,
    pub state_seq: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorsTransitionResponseV1 {
    pub schema_version: String,
    pub release: Option<String>,
    pub activation_seq: Option<i64>,
    pub activation_floor_seq: i64,
    pub rows: Vec<ErrorTransitionResultV1>,
    pub variance: ErrorsVarianceV1,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IssuesCursorV1 {
    version: String,
    order: ErrorsIssueOrderV1,
    selector_sha256: String,
    value: i64,
    issue: String,
}

#[derive(Clone, Debug)]
struct ErrorMeta {
    retention_boundary_ms: i64,
    freshness_watermark: Option<i64>,
    drops_lifetime: BTreeMap<String, u64>,
    overflow_fold_count: u64,
    group_horizon_start_ms: i64,
    activation_floor_seq: i64,
}

fn read_error_meta(connection: &Connection) -> SnapbackResult<ErrorMeta> {
    connection
        .query_row(
            "SELECT max(retention_floor,observation_clock_ms-max_days_mirror*86400000),
                (SELECT max(recorded_ts_ms) FROM telemetry_events_visible),
                drop_counters_lifetime,overflow_fold_count,
                observation_clock_ms-daily_days*86400000,
                release_activation_floor_seq
         FROM telemetry_meta WHERE singleton=1",
            [],
            |row| {
                let drops: String = row.get(2)?;
                Ok(ErrorMeta {
                    retention_boundary_ms: row.get(0)?,
                    freshness_watermark: row.get(1)?,
                    drops_lifetime: serde_json::from_str(&drops).unwrap_or_default(),
                    overflow_fold_count: row.get(3)?,
                    group_horizon_start_ms: row.get(4)?,
                    activation_floor_seq: row.get(5)?,
                })
            },
        )
        .map_err(Into::into)
}

fn known_releases(connection: &Connection) -> SnapbackResult<Vec<String>> {
    connection
        .prepare("SELECT release FROM release_activations_visible ORDER BY activated_seq,release")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn activation_seq(connection: &Connection, release: &str) -> SnapbackResult<i64> {
    let known = known_releases(connection)?;
    let activation = connection
        .query_row(
            "SELECT activated_seq FROM release_activations_visible WHERE release=?1",
            params![release],
            |row| row.get(0),
        )
        .optional()?;
    activation.ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_ERROR_RELEASE_UNKNOWN_OR_PRUNED",
            "telemetry",
            "error query release is unknown or below the retained activation floor",
        )
        .with_details(json!({ "release": release, "knownReleases": known }))
    })
}

fn structural_title(code: Option<&str>, error_class: Option<&str>, name: &str) -> String {
    format!(
        "{} in {name}",
        code.or(error_class).unwrap_or("unclassified")
    )
}

fn issue_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ErrorIssueSummaryV1> {
    let state = row.get::<_, String>(1)?;
    let code = row.get::<_, Option<String>>(5)?;
    let error_class = row.get::<_, Option<String>>(6)?;
    let name = row.get::<_, String>(4)?;
    Ok(ErrorIssueSummaryV1 {
        issue: row.get(0)?,
        title: structural_title(code.as_deref(), error_class.as_deref(), &name),
        state: ErrorsIssueStateV1::parse(&state).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                1,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        state_seq: row.get(2)?,
        kind: row.get(3)?,
        name,
        code,
        error_class,
        status_class: row.get(7)?,
        subsystem: row.get(8)?,
        failure_disposition: row.get(9)?,
        first_seen_ms: row.get(10)?,
        last_seen_ms: row.get(11)?,
        first_seen_seq: row.get(12)?,
        last_seen_seq: row.get(13)?,
        last_regressed_seq: row.get(14)?,
        first_release: row.get(15)?,
        last_release: row.get(16)?,
        count: row.get(17)?,
        suppressed_cooldown_count: row.get(18)?,
        suppressed_rollout_count: row.get(19)?,
    })
}

fn issues_selector_sha256(request: &ErrorsIssuesRequestV1) -> String {
    let canonical = serde_json::to_vec(&json!({
        "state": request.state,
        "kind": request.kind,
        "name": request.name,
        "subsystem": request.subsystem,
        "failureDisposition": request.failure_disposition,
        "release": request.release,
        "since": request.since,
        "fromMs": request.from_ms,
        "toMs": request.to_ms,
        "order": request.order,
    }))
    .expect("errors issue selector serializes");
    format!("sha256:{:x}", Sha256::digest(canonical))
}

fn decode_cursor(
    raw: &str,
    order: ErrorsIssueOrderV1,
    selector_sha256: &str,
) -> SnapbackResult<IssuesCursorV1> {
    let bytes = URL_SAFE_NO_PAD
        .decode(raw)
        .map_err(|_| errors_invalid("errors cursor is invalid"))?;
    let cursor: IssuesCursorV1 =
        serde_json::from_slice(&bytes).map_err(|_| errors_invalid("errors cursor is invalid"))?;
    if cursor.version != "snapback.errors.issues-cursor.v1"
        || cursor.order != order
        || cursor.selector_sha256 != selector_sha256
    {
        return Err(errors_invalid(
            "errors cursor does not match the requested selector",
        ));
    }
    Ok(cursor)
}

fn encode_cursor(
    order: ErrorsIssueOrderV1,
    selector_sha256: &str,
    issue: &ErrorIssueSummaryV1,
) -> String {
    let value = match order {
        ErrorsIssueOrderV1::LastSeen => issue.last_seen_ms,
        ErrorsIssueOrderV1::Count => i64::try_from(issue.count).unwrap_or(i64::MAX),
    };
    URL_SAFE_NO_PAD.encode(
        serde_json::to_vec(&IssuesCursorV1 {
            version: "snapback.errors.issues-cursor.v1".to_owned(),
            order,
            selector_sha256: selector_sha256.to_owned(),
            value,
            issue: issue.issue.clone(),
        })
        .expect("errors cursor serializes"),
    )
}

pub(crate) fn query_issues(
    connection: &Connection,
    request: &ErrorsIssuesRequestV1,
    context: &QueryContext,
) -> SnapbackResult<ErrorsIssuesResponseV1> {
    request.validate()?;
    let meta = read_error_meta(connection)?;
    let known = known_releases(connection)?;
    if let Some(release) = request.release.as_deref() {
        activation_seq(connection, release)?;
    }
    let since_seq = request
        .since
        .as_deref()
        .map(|release| activation_seq(connection, release))
        .transpose()?;
    let selector_sha256 = issues_selector_sha256(request);
    let cursor = request
        .cursor
        .as_deref()
        .map(|cursor| decode_cursor(cursor, request.order, &selector_sha256))
        .transpose()?;
    let mut sql = String::from(
        "SELECT issue,state,state_seq,kind,name,code,error_class,status_class,subsystem,
                failure_disposition,first_seen_ms,last_seen_ms,first_seen_seq,last_seen_seq,
                last_regressed_seq,first_release,last_release,count,suppressed_cooldown_count,
                suppressed_rollout_count
         FROM error_groups_visible WHERE 1=1",
    );
    let mut values = Vec::new();
    for (column, value) in [
        ("kind", request.kind.as_ref()),
        ("name", request.name.as_ref()),
        ("subsystem", request.subsystem.as_ref()),
        ("failure_disposition", request.failure_disposition.as_ref()),
    ] {
        if let Some(value) = value {
            sql.push_str(&format!(" AND {column}=?"));
            values.push(SqlValue::Text(value.clone()));
        }
    }
    if let Some(state) = request.state {
        sql.push_str(" AND state=?");
        values.push(SqlValue::Text(state.as_str().to_owned()));
    }
    if let Some(release) = &request.release {
        // @ref LLP 0156#e12--the-store-classification-only-tables-raw-tier-exemplars —
        //   the release facet is first/last equality, while activation order
        //   is reserved for `since` and bulk resolve. Unknown/below-floor
        //   names were refused above rather than silently returning empty.
        sql.push_str(" AND (first_release=? OR last_release=?)");
        values.extend([
            SqlValue::Text(release.clone()),
            SqlValue::Text(release.clone()),
        ]);
    }
    if let Some(from) = request.from_ms {
        sql.push_str(" AND last_seen_ms>=?");
        values.push(SqlValue::Integer(from));
    }
    if let Some(to) = request.to_ms {
        sql.push_str(" AND first_seen_ms<=?");
        values.push(SqlValue::Integer(to));
    }
    if let Some(sequence) = since_seq {
        // @ref LLP 0156#e14--surface-typed-operations-projected-everywhere-d5-discipline —
        //   the post-release preset is acceptance-sequence based, including
        //   regressions strictly after activation.
        sql.push_str(" AND (first_seen_seq>=? OR last_regressed_seq>?)");
        values.extend([SqlValue::Integer(sequence), SqlValue::Integer(sequence)]);
    }
    if let Some(cursor) = cursor {
        sql.push_str(&format!(
            " AND ({}<? OR ({}=? AND issue>?))",
            request.order.column(),
            request.order.column()
        ));
        values.extend([
            SqlValue::Integer(cursor.value),
            SqlValue::Integer(cursor.value),
            SqlValue::Text(cursor.issue),
        ]);
    }
    sql.push_str(&format!(
        " ORDER BY {} DESC,issue ASC LIMIT ?",
        request.order.column()
    ));
    values.push(SqlValue::Integer(
        i64::try_from(request.limit + 1).unwrap_or(i64::MAX),
    ));
    let mut issues = connection
        .prepare(&sql)?
        .query_map(params_from_iter(values), issue_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let truncated = issues.len() > request.limit;
    if truncated {
        issues.truncate(request.limit);
    }
    let next_cursor = truncated.then(|| {
        encode_cursor(
            request.order,
            &selector_sha256,
            issues.last().expect("nonempty bounded page"),
        )
    });
    let variance = error_variance(connection, &meta, context, None, truncated)?;
    Ok(ErrorsIssuesResponseV1 {
        schema_version: "snapback.errors.issues.v1".to_owned(),
        order: request.order,
        issues,
        next_cursor,
        known_releases: known,
        variance,
    })
}

pub(crate) fn query_issue(
    connection: &Connection,
    request: &ErrorsIssueRequestV1,
    context: &QueryContext,
) -> SnapbackResult<ErrorsIssueResponseV1> {
    validate_issue_id(&request.issue)?;
    let meta = read_error_meta(connection)?;
    let issue = connection
        .query_row(
            "SELECT issue,state,state_seq,kind,name,code,error_class,status_class,subsystem,
                    failure_disposition,first_seen_ms,last_seen_ms,first_seen_seq,last_seen_seq,
                    last_regressed_seq,first_release,last_release,count,suppressed_cooldown_count,
                    suppressed_rollout_count
             FROM error_groups_visible WHERE issue=?1",
            params![request.issue],
            issue_from_row,
        )
        .optional()?
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ERROR_ISSUE_NOT_FOUND",
                "telemetry",
                "error issue is not present in the visible horizon",
            )
        })?;
    let exemplars = connection
        .prepare(
            "SELECT x.observation,x.recorded_ts_ms,x.recorded_seq,x.release,
                    x.title_template,x.template_truncated,x.stack_head,x.stack_truncated,
                    (SELECT e.correlation FROM telemetry_events_visible e
                     WHERE e.observation=x.observation AND e.correlation IS NOT NULL
                     ORDER BY e.recorded_ts_ms,e.id LIMIT 1)
             FROM error_exemplars_visible x
             WHERE x.issue=?1 ORDER BY x.recorded_seq DESC,x.observation",
        )?
        .query_map(params![request.issue], |row| {
            let recorded_ts_ms = row.get::<_, i64>(1)?;
            let correlation = row.get::<_, Option<String>>(8)?;
            let mut input = json!({
                "fromMs": recorded_ts_ms.saturating_sub(60_000).max(0),
                "toMs": recorded_ts_ms.saturating_add(60_000),
                "order": "asc",
                "limit": 100,
            });
            if let Some(correlation) = correlation {
                input["correlation"] = json!(correlation);
            }
            Ok(ErrorExemplarV1 {
                observation: row.get(0)?,
                recorded_ts_ms,
                recorded_seq: row.get(2)?,
                release: row.get(3)?,
                title_template: row.get(4)?,
                template_truncated: row.get::<_, i64>(5)? != 0,
                stack_head: row.get(6)?,
                stack_truncated: row.get::<_, i64>(7)? != 0,
                telemetry_events_query: ErrorCorrelationQueryV1 {
                    operation: "telemetry.events".to_owned(),
                    input,
                },
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let transitions = connection
        .prepare(
            "SELECT seq,from_state,to_state,at_ms,actor,release
             FROM error_transitions_visible WHERE issue=?1 ORDER BY seq",
        )?
        .query_map(params![request.issue], |row| {
            let from = row.get::<_, String>(1)?;
            let to = row.get::<_, String>(2)?;
            Ok((row.get(0)?, from, to, row.get(3)?, row.get(4)?, row.get(5)?))
        })?
        .map(|row| {
            let (seq, from, to, at_ms, actor, release) = row?;
            Ok(ErrorTransitionV1 {
                seq,
                from: ErrorsIssueStateV1::parse(&from)?,
                to: ErrorsIssueStateV1::parse(&to)?,
                at_ms,
                actor,
                release,
            })
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    let variance = error_variance(connection, &meta, context, Some(&request.issue), false)?;
    Ok(ErrorsIssueResponseV1 {
        schema_version: "snapback.errors.issue.v1".to_owned(),
        issue,
        exemplars,
        transitions,
        variance,
    })
}

fn error_variance(
    connection: &Connection,
    meta: &ErrorMeta,
    context: &QueryContext,
    issue: Option<&str>,
    page_truncated: bool,
) -> SnapbackResult<ErrorsVarianceV1> {
    let predicate = issue.map_or(String::new(), |_| " WHERE issue=?1".to_owned());
    let read = |sql: &str| -> SnapbackResult<(u64, u64, u64, u64, u64, u64)> {
        let full = format!(
            "SELECT coalesce(sum(exemplar_depth_drop_count),0),
                    coalesce(sum(exemplar_byte_drop_count),0),
                    coalesce(sum(exemplar_flush_drop_count),0),
                    coalesce(sum(suppressed_cooldown_count),0),
                    coalesce(sum(suppressed_rollout_count),0),
                    coalesce(sum(count),0) FROM {sql}{predicate}"
        );
        let mut statement = connection.prepare(&full)?;
        if let Some(issue) = issue {
            statement
                .query_row(params![issue], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                })
                .map_err(Into::into)
        } else {
            statement
                .query_row([], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                })
                .map_err(Into::into)
        }
    };
    let (depth, bytes, flush, cooldown, rollout, observations) = read("error_groups_visible")?;
    let exemplar_count: u64 = if let Some(issue) = issue {
        connection.query_row(
            "SELECT count(*) FROM error_exemplars_visible WHERE issue=?1",
            params![issue],
            |row| row.get(0),
        )?
    } else {
        connection.query_row("SELECT count(*) FROM error_exemplars_visible", [], |row| {
            row.get(0)
        })?
    };
    let exemplar_stale = if issue.is_some() {
        observations > 0 && exemplar_count == 0
    } else {
        connection.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM error_groups_visible g
               WHERE g.count>0 AND NOT EXISTS(
                 SELECT 1 FROM error_exemplars_visible x WHERE x.issue=g.issue
               )
             )",
            [],
            |row| row.get::<_, i64>(0).map(|value| value != 0),
        )?
    };
    let (transition_floor, transition_truncated): (Option<i64>, bool) = if let Some(issue) = issue {
        let row: (i64, Option<i64>) = connection.query_row(
            "SELECT state_seq,(SELECT min(seq) FROM error_transitions_visible WHERE issue=?1)
             FROM error_groups_visible WHERE issue=?1",
            params![issue],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        (
            row.1.or(Some(row.0)),
            row.0 > 0 && row.1.is_none_or(|floor| floor > 1),
        )
    } else {
        let truncated: bool = connection.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM error_groups_visible g
               WHERE g.state_seq>0 AND NOT EXISTS(
                 SELECT 1 FROM error_transitions_visible t
                 WHERE t.issue=g.issue AND t.seq=1
               )
             )",
            [],
            |row| row.get::<_, i64>(0).map(|value| value != 0),
        )?;
        // Transition sequence is issue-local, so there is no truthful global
        // floor for a list response. Keep only the aggregate truncation bit;
        // errors.issue carries the exact per-issue floor.
        (None, truncated)
    };
    let exemplar_truncated = depth > 0 || bytes > 0 || flush > 0;
    Ok(ErrorsVarianceV1 {
        telemetry: TelemetryVarianceV1 {
            store_backend: "local-sqlite-sibling".to_owned(),
            field_exactness: BTreeMap::from([
                ("groups".to_owned(), "exactVisibleRows".to_owned()),
                ("titles".to_owned(), "structuralOnly".to_owned()),
            ]),
            sampling_factor: 1.0,
            freshness_watermark: match (context.last_flush_watermark, meta.freshness_watermark) {
                (Some(memory), Some(persisted)) => Some(memory.max(persisted)),
                (Some(value), None) | (None, Some(value)) => Some(value),
                (None, None) => None,
            },
            retention_boundary_ms: meta.retention_boundary_ms,
            drops_since_boot: context.drops_since_boot.clone(),
            drops_lifetime: meta.drops_lifetime.clone(),
            truncation: BTreeMap::from([
                ("pageLimit".to_owned(), json!(page_truncated)),
                ("exemplars".to_owned(), json!(exemplar_truncated)),
                ("transitionHistory".to_owned(), json!(transition_truncated)),
            ]),
            capability_outcome: if page_truncated || exemplar_truncated || transition_truncated {
                TelemetryCapabilityOutcomeV1::BoundedWindow
            } else {
                TelemetryCapabilityOutcomeV1::Exact
            },
        },
        overflow_fold_count: meta.overflow_fold_count,
        overflow_fold_scope: "cumulativeSinceGenerationStart".to_owned(),
        group_horizon_start_ms: meta.group_horizon_start_ms,
        // Ring replacement is reported by the three explicit truncation/drop
        // counters. "Stale" is the distinct retention state LLP 0156 names:
        // the durable group still has occurrences but every raw exemplar has
        // aged out of the visible raw horizon.
        exemplar_stale,
        exemplar_truncated,
        exemplar_drop_counters: BTreeMap::from([
            ("depth".to_owned(), depth),
            ("bytes".to_owned(), bytes),
            ("flush".to_owned(), flush),
        ]),
        suppression_counters: BTreeMap::from([
            ("cooldown".to_owned(), cooldown),
            ("rollout".to_owned(), rollout),
        ]),
        transition_history_floor_seq: transition_floor,
        transition_history_truncated: transition_truncated,
    })
}

pub(crate) fn transition_variance(
    connection: &Connection,
    context: &QueryContext,
) -> SnapbackResult<ErrorsVarianceV1> {
    let meta = read_error_meta(connection)?;
    error_variance(connection, &meta, context, None, false)
}

pub(crate) fn activation_floor(connection: &Connection) -> SnapbackResult<i64> {
    Ok(read_error_meta(connection)?.activation_floor_seq)
}

fn errors_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_ERRORS_QUERY_INVALID", "telemetry", message)
}

/// Refuse malformed or adjacent-kind ids at the operation boundary. Error
/// issue groups were introduced after LLP 0148, so unlike older persisted id
/// kinds there is no legacy UUIDv7 spelling to preserve here.
pub(crate) fn validate_issue_id(issue: &str) -> SnapbackResult<()> {
    if crate::ids::looks_like(crate::ids::Kind::Issue, issue) {
        Ok(())
    } else {
        Err(SnapbackError::error(
            "SNAPBACK_ERROR_ISSUE_ID_INVALID",
            "telemetry",
            "error issue id must be a canonical iss_ identifier",
        ))
    }
}

/// Language-neutral examples pinned beside the generated operation schemas.
pub fn errors_fixture_corpus() -> Value {
    let issue = json!({
        "issue": "iss_00000000000000000000000000",
        "title": "SNAPBACK_HANDLER_FAILED in todos.create",
        "state": "open",
        "stateSeq": 0,
        "kind": "function_run",
        "name": "todos.create",
        "code": "SNAPBACK_HANDLER_FAILED",
        "errorClass": null,
        "statusClass": null,
        "subsystem": "runtime",
        "failureDisposition": "fault",
        "firstSeenMs": 1000,
        "lastSeenMs": 2000,
        "firstSeenSeq": 4,
        "lastSeenSeq": 7,
        "lastRegressedSeq": null,
        "firstRelease": "release-fixture",
        "lastRelease": "release-fixture",
        "count": 2,
        "suppressedCooldownCount": 0,
        "suppressedRolloutCount": 0
    });
    let variance = json!({
        "storeBackend": "local-sqlite-sibling",
        "fieldExactness": {
            "groups": "exactVisibleRows",
            "titles": "structuralOnly"
        },
        "samplingFactor": 1.0,
        "freshnessWatermark": 2000,
        "retentionBoundaryMs": 0,
        "dropsSinceBoot": {},
        "dropsLifetime": {},
        "truncation": {
            "pageLimit": false,
            "exemplars": false,
            "transitionHistory": false
        },
        "capabilityOutcome": "exact",
        "overflowFoldCount": 0,
        "overflowFoldScope": "cumulativeSinceGenerationStart",
        "groupHorizonStartMs": 0,
        "exemplarStale": false,
        "exemplarTruncated": false,
        "exemplarDropCounters": { "depth": 0, "bytes": 0, "flush": 0 },
        "suppressionCounters": { "cooldown": 0, "rollout": 0 },
        "transitionHistoryFloorSeq": null,
        "transitionHistoryTruncated": false
    });
    let mut detail_variance = variance.clone();
    detail_variance["transitionHistoryFloorSeq"] = json!(0);
    json!({
        "schemaVersion": "snapback.errors.query-fixtures.v1",
        "issues": {
            "request": { "since": "release-fixture", "order": "lastSeen", "limit": 100 },
            "response": {
                "schemaVersion": "snapback.errors.issues.v1",
                "order": "lastSeen",
                "issues": [issue.clone()],
                "nextCursor": null,
                "knownReleases": ["release-fixture"],
                "variance": variance.clone()
            },
            "forbiddenOperatorMetadataFields": ["titleTemplate", "stackHead", "message"]
        },
        "issue": {
            "request": { "issue": "iss_00000000000000000000000000" },
            "response": {
                "schemaVersion": "snapback.errors.issue.v1",
                "issue": issue,
                "exemplars": [{
                    "observation": "obs_00000000000000000000000000",
                    "recordedTsMs": 2000,
                    "recordedSeq": 7,
                    "release": "release-fixture",
                    "titleTemplate": "database timeout after {number}ms",
                    "templateTruncated": false,
                    "stackHead": "at todos.create (todos.js:10)",
                    "stackTruncated": false,
                    "telemetryEventsQuery": {
                        "operation": "telemetry.events",
                        "input": {
                            "correlation": "corr_fixture",
                            "fromMs": 0,
                            "toMs": 62000,
                            "order": "asc",
                            "limit": 100
                        }
                    }
                }],
                "transitions": [],
                "variance": detail_variance
            },
            "authority": "adminSecretRead",
            "cacheControl": "no-store"
        },
        "transition": {
            "singleRequest": {
                "issue": "iss_00000000000000000000000000",
                "to": "resolved",
                "expectSeq": 0
            },
            "bulkRequest": {
                "selector": { "openBefore": "release-fixture" },
                "to": "resolved"
            },
            "singleResponse": {
                "schemaVersion": "snapback.errors.transition.v1",
                "release": null,
                "activationSeq": null,
                "activationFloorSeq": 0,
                "rows": [{
                    "issue": "iss_00000000000000000000000000",
                    "outcome": "applied",
                    "state": "resolved",
                    "stateSeq": 1
                }],
                "variance": variance.clone()
            },
            "bulkResponse": {
                "schemaVersion": "snapback.errors.transition.v1",
                "release": "release-fixture",
                "activationSeq": 10,
                "activationFloorSeq": 0,
                "rows": [{
                    "issue": "iss_00000000000000000000000000",
                    "outcome": "applied",
                    "state": "resolved",
                    "stateSeq": 1
                }],
                "variance": variance
            },
            "bulkSelection": "last_seen_seq < activated_seq",
            "sinceSelection": "first_seen_seq >= activated_seq OR last_regressed_seq > activated_seq"
        }
    })
}
