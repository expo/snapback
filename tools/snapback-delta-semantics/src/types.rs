//! Reference carriers, ledgers, form inputs, and closed verdicts.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

pub type Row = BTreeMap<String, Value>;
pub type ScopeId = String;

fn deserialize_present_value<'de, D>(deserializer: D) -> Result<Option<Value>, D::Error>
where
    D: Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FallbackReason {
    MissingImage,
    PredicateUnanalyzable,
    RankUndecidable,
    BoundaryDisplacement,
    CompletenessIndeterminate,
    RekeyUnread,
    ScopeUnfilled,
    DemandIdentityTransition,
    RefusalTransition,
    SupportUnproved,
    ScopeUnresolved,
    UniqueViolation,
    WireUnaddressable,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "verdict", deny_unknown_fields)]
pub enum FormVerdict<Delta, State> {
    Maintain {
        #[serde(rename = "deltaOut")]
        delta_out: Delta,
        #[serde(rename = "nextState")]
        next_state: State,
    },
    Fallback {
        reason: FallbackReason,
    },
}

impl<Delta, State> FormVerdict<Delta, State> {
    pub fn fallback(reason: FallbackReason) -> Self {
        Self::Fallback { reason }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChangeOp {
    Insert,
    Update,
    Delete,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppChange {
    pub row_key: String,
    pub op: ChangeOp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_image: Option<Row>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_image: Option<Row>,
    #[serde(default)]
    pub changed_fields: BTreeSet<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppBatch {
    #[serde(default)]
    pub changes: Vec<AppChange>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FoldedAppChange {
    pub row_key: String,
    pub op: ChangeOp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_image: Option<Row>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_image: Option<Row>,
    #[serde(default)]
    pub changed_fields: BTreeSet<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Admission {
    Enter,
    Leave,
    StayIn,
    StayOut,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeltaZEntry {
    pub row_key: String,
    pub op: ChangeOp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_image: Option<Row>,
    pub admit: Admission,
    #[serde(default)]
    pub rank_keys: Vec<Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeltaZBatch {
    #[serde(default)]
    pub entries: Vec<DeltaZEntry>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RankKey {
    pub values: Vec<Value>,
    pub row_key: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RankedRow {
    pub row_key: String,
    pub rank_keys: RankKey,
    pub row: Row,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "op",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SeqOp {
    SpliceIn {
        sort_key: RankKey,
        row: Row,
    },
    SpliceOut {
        sort_key: RankKey,
        row_key: String,
    },
    Patch {
        sort_key: RankKey,
        row_key: String,
        post: Row,
    },
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeltaSeq {
    #[serde(default)]
    pub ops: Vec<SeqOp>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BitTransitionKind {
    ZeroToOne,
    OneToZero,
    Unchanged,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BitTransition {
    pub scope: ScopeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element: Option<String>,
    pub transition: BitTransitionKind,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeltaBit {
    #[serde(default)]
    pub transitions: Vec<BitTransition>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReadRequest {
    Point {
        index: String,
        key: Vec<Value>,
    },
    Probe {
        edge: String,
        scope: ScopeId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        element: Option<String>,
    },
    Range {
        index: String,
        #[serde(rename = "keyPrefix")]
        key_prefix: Vec<Value>,
        bound: usize,
    },
    Tail {
        window: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        boundary: Option<RankKey>,
        k: usize,
        #[serde(default)]
        label_only: bool,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReadResponse {
    Point {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        row: Option<Row>,
    },
    Probe {
        #[serde(default)]
        rows: Vec<Row>,
    },
    Range {
        #[serde(default)]
        rows: Vec<Row>,
        exhausted: bool,
    },
    Tail {
        #[serde(default)]
        rows: Vec<Row>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exhausted: Option<bool>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadPair {
    pub request: ReadRequest,
    pub response: ReadResponse,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(transparent)]
pub struct ReadTranscript(pub Vec<ReadPair>);

impl ReadTranscript {
    pub fn response(&self, request: &ReadRequest) -> Option<&ReadResponse> {
        let mut matches = self.0.iter().filter(|pair| &pair.request == request);
        let first = matches.next()?;
        if matches.all(|pair| pair.response == first.response) {
            Some(&first.response)
        } else {
            None
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrderField {
    pub field: String,
    pub direction: Direction,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Direction {
    Asc,
    Desc,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RankBound {
    pub key: RankKey,
    pub inclusive: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Interval {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lower: Option<RankBound>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upper: Option<RankBound>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowConfig {
    pub window_id: String,
    pub order: Vec<OrderField>,
    #[serde(default)]
    pub interval: Interval,
    pub take: usize,
    #[serde(default)]
    pub projection_fields: BTreeSet<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompletenessLabel {
    Complete,
    Incomplete,
    ZeroTakeUnproved,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowState {
    #[serde(default)]
    pub rows: Vec<RankedRow>,
    pub boundary: Option<RankKey>,
    pub result_count: usize,
    pub complete: bool,
    pub label: CompletenessLabel,
    pub continuation: Option<RankKey>,
}

impl WindowState {
    pub fn empty(complete: bool) -> Self {
        Self {
            rows: Vec::new(),
            boundary: None,
            result_count: 0,
            complete,
            label: if complete {
                CompletenessLabel::Complete
            } else {
                CompletenessLabel::Incomplete
            },
            continuation: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Filter {
    pub field: String,
    pub op: FilterOp,
    #[serde(
        default,
        deserialize_with = "deserialize_present_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub argument: Option<Value>,
    #[serde(
        default,
        deserialize_with = "deserialize_present_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub literal: Option<Value>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum FilterOp {
    Eq,
    In,
    Lt,
    Lte,
    Gt,
    Gte,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Visibility {
    PublicRead,
    Owner {
        field: String,
        #[serde(rename = "userId")]
        user_id: String,
    },
    Membership {
        arm: String,
        #[serde(rename = "resourceField")]
        resource_field: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        roles: Option<Vec<String>>,
        edge: String,
    },
    AnyOf {
        arms: Vec<Visibility>,
    },
}

/// Post-cut support evidence supplied by E6 to a membership arm. A bare bit
/// is already evaluated under the declaration's role rule; the expanded form
/// lets vectors exercise that rule directly.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(untagged)]
pub enum MembershipEvidence {
    Bit(bool),
    Fact {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        role: Option<String>,
        #[serde(default)]
        pending: bool,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AdmissionGrain {
    CompleteScope,
    Window,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdmitConfig {
    pub visibility: Visibility,
    #[serde(default)]
    pub filters: Vec<Filter>,
    pub grain: AdmissionGrain,
    #[serde(default)]
    pub rank_order: Vec<OrderField>,
    #[serde(default)]
    pub probe_relation: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdmitState {
    #[serde(default)]
    pub retained: BTreeMap<String, Row>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdmitInput {
    pub changes: AppBatch,
    #[serde(default)]
    pub support_bits: BTreeMap<String, BTreeMap<String, MembershipEvidence>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Presence {
    Optional,
    Required,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LookupConfig {
    pub index: String,
    pub parent_join_fields: Vec<String>,
    pub child_join_fields: Vec<String>,
    pub presence: Presence,
    #[serde(default)]
    pub projection_fields: BTreeSet<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LookupScopeState {
    pub lookup_key: Option<Vec<Value>>,
    pub child_key: Option<String>,
    pub found: bool,
    pub row_version: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LookupState {
    #[serde(default)]
    pub scopes: BTreeMap<ScopeId, LookupScopeState>,
    #[serde(default)]
    pub children: BTreeMap<String, Row>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LookupInput {
    #[serde(default)]
    pub parent: DeltaZBatch,
    #[serde(default)]
    pub child: DeltaZBatch,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum LookupDeltaOp {
    Patch {
        scope: ScopeId,
        child_key: String,
        fields: Row,
    },
    Presence {
        scope: ScopeId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        child_key: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<Row>,
    },
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LookupDelta {
    #[serde(default)]
    pub ops: Vec<LookupDeltaOp>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerParentWindowConfig {
    pub index: String,
    pub parent_join_fields: Vec<String>,
    pub demand_paged: bool,
    pub max_children_per_parent: usize,
    pub window: WindowConfig,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerParentScopeState {
    pub lookup_key: Option<Vec<Value>>,
    pub window: WindowState,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerParentWindowState {
    #[serde(default)]
    pub scopes: BTreeMap<ScopeId, PerParentScopeState>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerParentWindowInput {
    #[serde(default)]
    pub parent: DeltaZBatch,
    #[serde(default)]
    pub child_by_scope: BTreeMap<ScopeId, DeltaZBatch>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedSeqOp {
    pub scope: ScopeId,
    pub op: SeqOp,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedDeltaSeq {
    #[serde(default)]
    pub ops: Vec<ScopedSeqOp>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SupportEdgeKind {
    Direct,
    Through,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SupportMode {
    Exists,
    All { elements: Vec<String> },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportConfig {
    pub edge: String,
    pub edge_kind: SupportEdgeKind,
    pub mode: SupportMode,
    pub parent_join_fields: Vec<String>,
    pub support_join_fields: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub through_target_field: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportScopeState {
    pub join_key: Vec<Value>,
    pub bit: bool,
    /// Complete retained through-row -> target-row evidence for this scope.
    /// `None` means target-side scope attribution is not proven.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub through_targets: Option<BTreeMap<String, String>>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportState {
    #[serde(default)]
    pub scopes: BTreeMap<ScopeId, SupportScopeState>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportInput {
    #[serde(default)]
    pub parent: DeltaZBatch,
    #[serde(default)]
    pub support: DeltaZBatch,
    #[serde(default)]
    pub target: DeltaZBatch,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MembershipLiftConfig {
    pub index: String,
    pub support_field: String,
    pub bound: usize,
    pub windowed_unprojected: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MembershipLiftState {
    #[serde(default)]
    pub retained: BTreeMap<String, Row>,
    #[serde(default)]
    pub surviving_any_of: BTreeSet<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MembershipLiftInput {
    #[serde(default)]
    pub bits: DeltaBit,
    #[serde(default)]
    pub support_values: BTreeMap<ScopeId, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrincipalState {
    pub binding: LookupState,
    pub target: LookupState,
    #[serde(default)]
    pub principal_digests: BTreeMap<ScopeId, String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrincipalInput {
    pub binding: LookupInput,
    pub target: LookupInput,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrincipalConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binding: Option<LookupConfig>,
    pub target: LookupConfig,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrincipalDelta {
    pub binding: LookupDelta,
    pub target: LookupDelta,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssemblyNodeKind {
    Root,
    ToOne,
    ToMany,
    Exists,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssemblyNode {
    pub node_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub kind: AssemblyNodeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_field: Option<String>,
    #[serde(default)]
    pub projection_fields: BTreeSet<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AssemblyEvent {
    RootSeq {
        node_id: String,
        delta: DeltaSeq,
    },
    ToOne {
        node_id: String,
        delta: LookupDelta,
    },
    ToMany {
        node_id: String,
        scope: ScopeId,
        delta: DeltaSeq,
    },
    Exists {
        node_id: String,
        delta: DeltaBit,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssembleConfig {
    pub root_node_id: String,
    pub nodes: Vec<AssemblyNode>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssembleState {
    pub result: Value,
    #[serde(default)]
    pub ordered_root_keys: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssembleInput {
    #[serde(default)]
    pub events: Vec<AssemblyEvent>,
    /// Per-node post-state operator outputs. E8 derives the nested result from
    /// these carrier values and the closed projection configuration.
    pub next_node_outputs: BTreeMap<String, BTreeMap<ScopeId, Value>>,
    /// Optional corpus assertion only; it is never adopted as evaluator state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_result: Option<Value>,
    #[serde(default)]
    pub ordered_root_keys: Vec<String>,
    pub node_completeness: Vec<NodeCompletenessLabel>,
    /// Opaque identity/proof data carried through unchanged. E8 does not
    /// interpret this tuple as semantic evidence.
    pub proof_tuple: Value,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GraphCompletenessLabel {
    Unknown,
    Complete,
    Prefix,
    Window,
    Refused,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeCompletenessLabel {
    pub node_id: String,
    pub label: GraphCompletenessLabel,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WireOpKind {
    Add,
    Update,
    Remove,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WireOp {
    pub op: WireOpKind,
    pub node_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WireFrame {
    #[serde(default)]
    pub ops: Vec<WireOp>,
    #[serde(default)]
    pub ordered_root_keys: Vec<String>,
    pub node_completeness: Vec<NodeCompletenessLabel>,
    pub graph_completeness: GraphCompletenessLabel,
    /// Opaque identity/proof data copied byte-for-byte from the form input.
    pub proof_tuple: Value,
    pub result_digest: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "form",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Operator {
    Admit { config: AdmitConfig },
    Window { config: WindowConfig },
    KeyedLookup { config: LookupConfig },
    PerParentWindow { config: PerParentWindowConfig },
    SupportSemiJoin { config: SupportConfig },
    MembershipLift { config: MembershipLiftConfig },
    PrincipalBind { config: PrincipalConfig },
    Assemble { config: AssembleConfig },
    Composition { nodes: Vec<CompositionNode> },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompositionNode {
    pub node_id: String,
    pub operator: Box<Operator>,
    #[serde(default)]
    pub inputs: Vec<CompositionInputArm>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "source",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CompositionInputArm {
    Upstream { name: String, node_id: String },
    External { name: String, input: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeltaSemanticsCase {
    pub format: String,
    pub name: String,
    #[serde(default)]
    pub coverage: Vec<String>,
    pub operator: Operator,
    pub initial_state: Value,
    pub folded_change_batch: Value,
    #[serde(default)]
    pub read_transcript: ReadTranscript,
    pub expected: Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeltaSemanticsManifestCase {
    pub name: String,
    pub path: String,
    pub sha256: String,
    #[serde(default)]
    pub coverage: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeltaSemanticsManifest {
    pub artifact_kind: String,
    pub corpus: String,
    pub corpus_format_version: u32,
    pub case_schema_path: String,
    pub evaluator_identity: String,
    pub cases: Vec<DeltaSemanticsManifestCase>,
}
