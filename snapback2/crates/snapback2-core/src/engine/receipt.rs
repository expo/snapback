//! Public execution and closure-receipt values.

use super::provenance::ResultProvenance;
use crate::ir::Order;
use crate::store::TouchedKey;
use crate::value::Value;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RowRecord {
    pub table: String,
    pub id: String,
    pub row: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum StopReason {
    Limit,
    Exhausted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraceRange {
    pub site: String,
    pub table: String,
    pub index: String,
    pub prefix: Vec<Value>,
    pub order: Order,
    pub take: u32,
    pub after: Option<Value>,
    pub before: Option<Value>,
    pub gt: Option<Value>,
    pub gte: Option<Value>,
    pub lt: Option<Value>,
    pub lte: Option<Value>,
    pub rule_hash: String,
    pub examined_ids: Vec<String>,
    /// Every examined row admitted by the read rule, including page-cut rows.
    pub visible_ids: Vec<String>,
    /// The admitted rows that the scan returned after applying `take`.
    pub returned_ids: Vec<String>,
    pub stop: StopReason,
    pub absence: bool,
    pub halo: Option<RowRecord>,
    pub n2_key: Option<Vec<Value>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleInputTrace {
    pub rule_hash: String,
    pub table: String,
    pub index: String,
    pub key: Vec<Value>,
    pub result: bool,
    pub hidden: bool,
    pub pinned_inputs_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PointTrace {
    pub site: String,
    pub table: String,
    pub index: String,
    pub key: Vec<Value>,
    pub examined: bool,
    pub visible: bool,
    /// Digest of the row image observed at this point read, or `None` for an
    /// authoritative absence. Captured before any later statement writes it.
    #[serde(default)]
    pub digest: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConstraintTrace {
    pub table: String,
    pub check: String,
    pub index: String,
    pub prefix: Vec<Value>,
    pub examined_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmitRecord {
    pub id: String,
    pub effect: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthoritativeTrace {
    /// Runtime-only return identity for page minting; never a receipt or wire field.
    #[serde(skip)]
    pub result_page_return: Option<String>,
    /// Operator diagnostics only: the last attempted write, including one refused before it touched rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_write_attempt: Option<crate::certificate::WriteSite>,
    pub rows: Vec<RowRecord>,
    pub points: Vec<PointTrace>,
    pub constraint_inputs: Vec<ConstraintTrace>,
    pub ranges: Vec<TraceRange>,
    pub absences: Vec<(String, String, Vec<Value>)>,
    pub rule_inputs: Vec<RuleInputTrace>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub merges: Vec<MergeTrace>,
    pub examined: u64,
    pub rule_probes: u64,
    pub steps: u64,
    pub writes: BTreeMap<String, u64>,
    // @ref LLP 1001#2-what-a-commit-records — invalidation uses physical before/after keys.
    #[serde(default)]
    pub touched: Vec<TouchedKey>,
    #[serde(default)]
    pub emits: Vec<EmitRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MergeTrace {
    pub site: String,
    pub deduplicated_union_len: u64,
    pub last_returned_suffix: Option<Vec<Value>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptRange {
    pub site: String,
    pub table: String,
    pub index: String,
    pub prefix: Vec<Value>,
    pub order: Order,
    pub take: u32,
    pub after: Option<Value>,
    pub before: Option<Value>,
    pub gt: Option<Value>,
    pub gte: Option<Value>,
    pub lt: Option<Value>,
    pub lte: Option<Value>,
    pub rule_hash: String,
    pub row_ids: Vec<String>,
    pub stop: StopReason,
    pub absence: bool,
    pub halo: Option<RowRecord>,
    pub n2_key: Option<Vec<Value>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Verdict {
    pub rule_hash: String,
    pub pinned_inputs_digest: String,
    pub principal: String,
    pub auth_epoch: u64,
    pub result: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClosureReceipt {
    /// Binds authority-issued absence facts to the schema that observed them.
    /// Rows remain client-issuable and do not depend on this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_hash: Option<String>,
    pub rows: Vec<RowRecord>,
    pub ranges: Vec<ReceiptRange>,
    pub absences: Vec<(String, String, Vec<Value>)>,
    pub verdicts: Vec<Verdict>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Execution {
    pub result: Value,
    #[serde(skip)]
    pub result_provenance: ResultProvenance,
    pub trace: AuthoritativeTrace,
    pub receipt: ClosureReceipt,
    pub state: ExecutionState,
    pub seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ExecutionState {
    Complete,
    Capped,
    Partial { reason: String },
    Denied { rule: String },
    Committed { seq: u64 },
    Rejected { code: String, message: String },
}
