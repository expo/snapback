//! The schema: tables, columns, indexes, rules, constraints, maintained
//! aggregates, and the two words Snapback 4 adds to a table — `sync`, the
//! partition declaration (LLP 2000.000 §7.1), and the leave policy that
//! survives from Snapback 2's `retain` (LLP 2000.000 §7.2).
//!
//! The serialized form is Snapback 2's, so the conformance corpus under
//! `corpus/` loads unchanged; fields Snapback 4 deleted (`deliver`,
//! `tombstones`, `channels`) are ignored on the way in.

use crate::ir::{ArgType, KeyProvenance};
use crate::value::{Value, digest};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

pub mod columns;
pub mod reservations;
pub mod through;
mod reference;
pub mod ephemeral;
mod work;
pub use work::{ActionSpec, WorkPolicy, WorkSpec};
pub mod routes;
pub mod timeline;
mod capabilities;
mod delivery;
mod receipts;
pub use receipts::ReceiptFamily;
pub use delivery::DeliveryBinding;
pub mod field_authority;
pub mod own_keys;
pub use field_authority::FieldAuthority;
pub use routes::RouteSpec;
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Schema {
    pub receipts: Vec<ReceiptFamily>,
    /// Schema-time closure; retained on device projections without private derivations.
    pub receipt_dependencies: BTreeMap<String, BTreeSet<String>>,
    /// Public, schema-derived reservation prices; private maintained formulas
    /// are omitted from device projections, but their write charge is not.
    pub source_reservations: BTreeMap<String, reservations::WriteReservation>,
    /// Decode-only compatibility fence; programs narrow it before admission.
    pub legacy_receipt_prediction: bool,
    pub tables: BTreeMap<String, Table>,
    /// Nonsemantic inspection input; only the catalog side record persists it.
    /// Never part of schema equality, hashes, generation bytes or device input.
    #[cfg(feature = "sqlite")]
    pub authored_indexes: inspection::AuthoredIndexes,
    pub delivery: Vec<DeliveryBinding>,
    #[cfg(feature = "sqlite")]
    pub delivery_lookup: crate::engine::delivery::Lookup,
    pub timelines: Vec<timeline::Timeline>,
    pub maintains: Vec<Maintain>,
    pub auth: Auth,
    pub effects: Vec<String>,
    pub schedules: Vec<Schedule>,
    /// Compiled execution facts; absent on serialized conformance inputs.
    pub operations: BTreeMap<String, Execution>,
    /// Author refusals keyed by table and unique index; changing wording is not a physical index migration.
    pub unique_refusals: BTreeMap<String, BTreeMap<String, UniqueRefusal>>,
    /// Server work contracts; kept outside the interpreter/corpus IR.
    pub action_specs: BTreeMap<String, ActionSpec>,
    pub effect_specs: BTreeMap<String, WorkSpec>,
    pub routes: BTreeMap<String, RouteSpec>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UniqueRefusal {
    pub code: String,
    pub message: String,
}

// @ref LLP 3000.028#3.3 — the SDK serializes positions; Rust alone evaluates queries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchComposition {
    pub table: String,
    pub index: String,
    pub column: String,
    pub kind: ColumnType,
    pub order: crate::ir::Order,
    pub limit: u64,
    pub needle: String,
    pub cursor: String,
    pub variant: Option<crate::ir::VariantId>,
}

// @ref LLP 3000.007#6.2 — eligibility is static; prediction and horizon coverage are per call.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Execution {
    /// A compiler-proved point projection, evaluated after the bare search page.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub search_decoration: bool,
    /// Compiler-proved SDK composition descriptor; no application predicate is changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<SearchComposition>,
    // @ref LLP 3000.017#2.4 — absent facts retain legacy schema bytes.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ephemeral: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub renews: bool,
    #[serde(default, rename = "renewMs", skip_serializing_if = "Option::is_none")]
    pub renew_ms: Option<u64>,
    #[serde(default, rename = "ephemeralReads", skip_serializing_if = "Vec::is_empty")]
    pub ephemeral_reads: Vec<String>,
    /// Author-declared device-only query. Incomplete local answers never fall back to the server.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub held: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub components: Vec<Component>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runs: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predicts: Option<String>,
    #[serde(default)]
    pub sites: Vec<ResidencySite>,
    #[serde(default)]
    pub requires: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub connected_effects_only: bool,
    /// Pure presence-dependent branches whose untaken arm prediction also charges.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prediction_guards: Vec<String>,
    /// Infallible effect-payload work omitted by the device, at original statement paths.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prediction_skips: Vec<String>,
    /// Server reads that feed effects exclusively; these do not require device coverage.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effect_payload_reads: Vec<ResidencySite>,
}

/// A returned record field and the zero-based top-level statements it owns.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Component {
    pub field: String,
    pub statements: Vec<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResidencySite {
    pub site: String,
    pub table: String,
    pub index: String,
    pub kind: String,
    pub class: SiteClass,
    pub reason: String,
    pub rewrite: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SiteClass { Held, Horizon, Server }

/// Source spelling only: the resolved `sync` remains the delivery authority.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Residency {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub online_only: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub inferred: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inherited_from: Option<String>,
}

impl Residency {
    fn is_default(&self) -> bool { self == &Self::default() }
}

/// `schedule name every 2m [at 08:00]: job`. Period boundaries are whole
/// multiples of `every_ms` since the epoch, shifted by `offset_ms`; the job
/// runs once for each boundary the server's clock crosses, with the period
/// that ended there as `periodStart`/`periodEnd` when it declares them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Schedule {
    pub name: String,
    pub every_ms: u64,
    #[serde(default)]
    pub offset_ms: u64,
    pub target: String,
    /// Actions require an explicit `service:<name>`; jobs remain system work.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
}

impl Schedule {
    /// The most recent period boundary at or before `now`.
    pub fn boundary(&self, now: i64) -> i64 {
        let every = self.every_ms as i64;
        let offset = self.offset_ms as i64;
        (now - offset).div_euclid(every) * every + offset
    }
}

impl Schema {
    pub fn hash(&self) -> String {
        digest(self)
    }

    pub fn table(&self, name: &str) -> Option<&Table> {
        self.tables.get(name)
    }

    /// Every table whose rows reach a device: `(name, table, sync)`.
    pub fn synced(&self) -> impl Iterator<Item = (&str, &Table, &Sync)> {
        self.tables
            .iter()
            .filter(|(name, _)| self.visible(name))
            .filter_map(|(name, table)| table.sync.as_ref().map(|sync| (name.as_str(), table, sync)))
    }

    /// The maintain whose target is `table`, if `table` is an aggregate.
    pub fn maintain_for(&self, table: &str) -> Option<&Maintain> {
        self.maintains.iter().find(|maintain| maintain.target == table)
    }

    /// A source cap proves a bound on distinct derived groups; no target cap is enforced.
    pub fn group_bound(&self, name: &str, pinned: &[String]) -> Option<u32> {
        let table = self.table(name)?;
        let ordinary = table.constraints.iter().filter_map(|c| match c {
            Constraint::Cap { by, max } if by.iter().all(|field| pinned.contains(field)) => Some(*max), _ => None,
        }).min();
        let derived = self.maintain_for(name).and_then(|m| {
            let source = self.table(&m.source)?;
            source.constraints.iter().filter_map(|c| match c {
                Constraint::Cap { by, max } if by.iter().all(|field| pinned.contains(field) && m.bare_key(field)) => Some(*max), _ => None,
            }).min()
        });
        ordinary.into_iter().chain(derived).min()
    }

    /// Whether an `exists` probe's target row is structurally readable by the
    /// probing viewer (public target, or the read rule is proven true for the
    /// exact indexed row being probed). Copied from Snapback 2: the proof is
    /// structural on purpose, so a hidden probe never leaks by its result.
    pub fn rule_input_is_readable(&self, table_name: &str, index_name: &str, key: &[RuleTerm]) -> bool {
        let Some(table) = self.table(table_name) else { return false };
        if table.rules.read.is_uniformly_readable() {
            return true;
        }
        let Some(index) = table.index(index_name) else { return false };
        if !index.is_plain() {
            return false;
        }
        let columns = index.columns();
        prove_probe_row_readable(&table.rules.read, table_name, index_name, &columns, key)
    }
}

fn prove_probe_row_readable(rule: &RuleExpr, table: &str, index: &str, index_columns: &[String], probe_key: &[RuleTerm]) -> bool {
    let substitute = |term: &RuleTerm| match term {
        RuleTerm::Field(field) => index_columns.iter().position(|column| column == field).and_then(|position| probe_key.get(position)).cloned(),
        RuleTerm::OldField(_) | RuleTerm::NextField(_) => None,
        other => Some(other.clone()),
    };
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow => true,
        RuleExpr::Eq(left, right) => substitute(left).zip(substitute(right)).is_some_and(|(left, right)| left == right),
        RuleExpr::And(rules) => !rules.is_empty() && rules.iter().all(|rule| prove_probe_row_readable(rule, table, index, index_columns, probe_key)),
        RuleExpr::Or(rules) => rules.iter().any(|rule| prove_probe_row_readable(rule, table, index, index_columns, probe_key)),
        RuleExpr::Exists { table: target, index: target_index, key, equalities, .. } if target == table && target_index == index && equalities.is_empty() => {
            key.iter().map(substitute).collect::<Option<Vec<_>>>().is_some_and(|key| key == probe_key)
        }
        RuleExpr::Deny | RuleExpr::Compare(..) | RuleExpr::Ne(_, _) | RuleExpr::Not(_) | RuleExpr::Exists { .. } | RuleExpr::Created { .. } => false,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Table {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ephemeral: Option<ephemeral::Ephemeral>,
    /// Engine-assigned ordinal → required parent reference column.
    // @ref LLP 3000.015#2 — one counter per parent row across child tables.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub sequences: BTreeMap<String, String>,
    /// Field authority and visibility, independent of the row update grant.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub written_by: BTreeMap<String, FieldAuthority>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub update_transition: bool,
    /// Lifetime-bound inherited authority. Absent on legacy schemas.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub through: Option<through::Through>,
    /// Engine-maintained readable fields, with their derivation identity.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub maintained: BTreeMap<String, String>,
    /// Engine-owned historical facts, keyed by their one-hop source path.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub recorded: BTreeMap<String, RecordedField>,
    #[serde(default, skip_serializing_if = "Residency::is_default")]
    pub residency: Residency,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub defaults: BTreeMap<String, ColumnDefault>,
    pub columns: BTreeMap<String, ColumnType>,
    pub indexes: BTreeMap<String, Index>,
    pub rules: Rules,
    #[serde(default)]
    pub constraints: Vec<Constraint>,
    /// What a device does with this table's rows when its right to them is
    /// revoked: drop them (`until-revoked`) or keep what was delivered.
    #[serde(default, alias = "retain")]
    pub leave: LeavePolicy,
    /// The partition declaration. Absent means online-only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync: Option<Sync>,
    /// `expire at .column`: the time column that ends a row's life. A row
    /// past it is absent to every reader on every host from that moment,
    /// and the server's sweep deletes it so the log carries the deletion
    /// to each device that holds it (LLP 3000 §7).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expire: Option<String>,
}

// @ref LLP 3000.007.003#3.2 — attribution is stored on the contributing row, never resolved by the aggregate evaluator.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordedField {
    pub reference: String,
    pub table: String,
    pub column: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ColumnDefault {
    Literal(Value),
    Now,
    Viewer,
}

impl ColumnDefault {
    pub fn value(&self, now: i64, viewer: &str) -> Value {
        match self {
            Self::Literal(value) => value.clone(),
            Self::Now => Value::Int(now),
            Self::Viewer => Value::Id(viewer.to_owned()),
        }
    }
}

impl Table {
    pub fn index(&self, name: &str) -> Option<&Index> {
        self.indexes.get(name)
    }

    pub fn cap(&self, by: &[String]) -> Option<u32> {
        self.constraints.iter().find_map(|constraint| match constraint {
            Constraint::Cap { by: group, max } if group == by => Some(*max),
            _ => None,
        })
    }

    pub fn immutable_fields(&self) -> impl Iterator<Item = &str> {
        self.constraints.iter().flat_map(|constraint| match constraint {
            Constraint::Immutable { fields } => fields.iter().map(String::as_str).collect::<Vec<_>>(),
            _ => Vec::new(),
        })
    }

    /// Whether `row` is past its `expire` column at `now`: absent to every
    /// reader, pending the sweep. A null time never expires.
    pub fn expired(&self, row: &Value, now: i64) -> bool {
        self.deadline(row).is_some_and(|at| at <= now)
    }

    /// The index the expiry sweep walks: the first leading with the
    /// `expire` column, as the declaration requires.
    pub fn expiry_index(&self) -> Option<(&str, &Index)> {
        let column = self.expiry_column()?;
        self.indexes.iter().find(|(_, index)| {
                index.is_plain() && index.columns().first().map(String::as_str) == Some(column)
            }).map(|(name, index)| (name.as_str(), index))
    }

    /// The column carrying the principal a `sync to T[...]` audience reads.
    pub fn principal_columns(&self) -> Vec<&str> {
        self.columns.iter().filter(|(_, kind)| matches!(kind, ColumnType::Principal)).map(|(name, _)| name.as_str()).collect()
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LeavePolicy {
    #[default]
    UntilRevoked,
    DeliveredHistory,
}

/// `sync public`, `sync to .column`, or `sync to target[.prefix, ...]`, each
/// with an optional horizon `last N by index` (LLP 2000.000 §7.1, LLP 3000 §7).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sync {
    pub audience: Audience,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizon: Option<Horizon>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Audience {
    /// Every principal holds the same partition.
    Public,
    /// The principal named by this row's column.
    Column(String),
    /// Every principal with a row in `table` whose `prefix` columns equal this
    /// row's `prefix` columns, read from the target's `principal` column.
    Target { table: String, prefix: Vec<String>, principal: String },
}

/// `last N by index`: a device holds at most N rows per group, where the group
/// is the audience prefix, in the index's descending order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Horizon {
    pub last: u32,
    pub by: String,
}

impl Sync {
    pub fn line(&self) -> String {
        let audience = match &self.audience {
            Audience::Public => "sync public".to_owned(),
            Audience::Column(column) => format!("sync to .{column}"),
            Audience::Target { table, prefix, .. } => format!("sync to {table}[{}]", prefix.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", ")),
        };
        match &self.horizon {
            Some(horizon) => format!("{audience} last {} by {}", horizon.last, horizon.by),
            None => audience,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ColumnType {
    Id,
    Principal,
    Text { max: u32 },
    Bytes { max: u32 },
    Image { max: u32, #[serde(default, skip_serializing_if = "std::ops::Not::not")] once: bool },
    Video { max: u32 },
    Int,
    Enum { variants: Vec<String> },
    Decimal { scale: u8 },
    Money { currency: String, scale: u8 },
    Bool,
    Time,
    Ref { table: String },
    Json { max_bytes: u32 },
    Optional(Box<ColumnType>),
    List { of: Box<ColumnType>, max: u32 },
    // @ref LLP 3000.007#5.4 — a new enum tag makes older engines refuse the minimum.
    ListRange { of: Box<ColumnType>, min: u32, max: u32 },
}
impl ColumnType {
    pub fn required(&self) -> &ColumnType {
        match self {
            Self::Optional(inner) => inner,
            other => other,
        }
    }

    pub fn is_optional(&self) -> bool { matches!(self, Self::Optional(_)) }

    pub fn is_indexable(&self) -> bool {
        match self {
            Self::Image { .. } | Self::Video { .. } | Self::List { .. } | Self::ListRange { .. } | Self::Json { .. } => false,
            Self::Optional(inner) => inner.is_indexable(),
            _ => true,
        }
    }

    pub fn contains_asset(&self) -> bool {
        match self {
            Self::Image { .. } | Self::Video { .. } => true,
            Self::Optional(inner) | Self::List { of: inner, .. } | Self::ListRange { of: inner, .. } => inner.contains_asset(),
            _ => false,
        }
    }
}

impl fmt::Display for ColumnType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Id => f.write_str("id"),
            Self::Principal => f.write_str("principal"),
            Self::Text { max } => write!(f, "text <={max}"),
            Self::Bytes { max } => write!(f, "bytes <={max}"),
            Self::Image { max, once: false } => write!(f, "image <={max}"),
            Self::Image { max, once: true } => write!(f, "image <={max} once"),
            Self::Video { max } => write!(f, "video <={max}"),
            Self::Int => f.write_str("int"),
            Self::Enum { variants } => write!(f, "enum({})", variants.iter().map(|v| format!("'{v}'")).collect::<Vec<_>>().join(", ")),
            Self::Decimal { scale } => write!(f, "decimal {scale}"),
            Self::Money { currency, scale } => write!(f, "money {currency} {scale}"),
            Self::Bool => f.write_str("bool"),
            Self::Time => f.write_str("time"),
            Self::Ref { table } => f.write_str(table),
            Self::Json { max_bytes } => write!(f, "json <={max_bytes}"),
            Self::Optional(inner) => write!(f, "{inner} ?"),
            Self::List { of, max } => write!(f, "[{of}] <={max}"),
            Self::ListRange { of, min, max } => write!(f, "[{of}] {min}..{max}"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Index {
    pub components: Vec<IndexComponent>,
    pub unique: bool,
}

impl Index {
    pub fn of(columns: &[&str], unique: bool) -> Self {
        Self { components: columns.iter().map(|c| IndexComponent::Column((*c).to_owned())).collect(), unique }
    }

    /// Ordered key names: columns and time-function names. A `words(..)`
    /// component contributes nothing here; `word_component` names it.
    /// Use `IndexComponent::column` for actual row fields (such as rule pins).
    pub fn columns(&self) -> Vec<String> {
        self.components.iter().filter_map(|c| c.key_name().cloned()).collect()
    }

    pub fn is_plain(&self) -> bool {
        self.components.iter().all(|c| matches!(c, IndexComponent::Column(_)))
    }

    pub fn uses_column(&self, name: &str) -> bool {
        self.components.iter().any(|component| match component {
            IndexComponent::Column(column) => column == name,
            IndexComponent::Calendar(key) => key.column == name,
            IndexComponent::WordPrefixes { fields, .. } => fields.iter().any(|field| field == name),
            IndexComponent::Contribution(maintain) => maintain.dependencies().contains(name),
        })
    }

    /// The `words(..)` component, if any: its position among the
    /// components and the text columns it tokenizes.
    pub fn word_component(&self) -> Option<(usize, &[String])> {
        self.components.iter().enumerate().find_map(|(position, component)| match component {
            IndexComponent::WordPrefixes { fields, .. } => Some((position, fields.as_slice())),
            IndexComponent::Column(_) | IndexComponent::Calendar(_) | IndexComponent::Contribution(_) => None,
        })
    }

    /// The columns after the first `components` components: a cursor's
    /// suffix, and the order a page continues in. Counted in components,
    /// so a scan whose prefix ends with a word skips the word too.
    pub fn suffix_after(&self, components: usize) -> Vec<String> {
        self.components.iter().skip(components).filter_map(|c| c.key_name().cloned()).collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum IndexComponent {
    /// Internal selected physical source rows; an optional following expiry component
    /// orders the group by deadline (null last), then the appended source id.
    Contribution(Box<Maintain>),
    Column(String),
    Calendar(crate::maintain::CalendarKey),
    WordPrefixes { fields: Vec<String>, #[serde(default)] contract: serde_json::Value },
}

impl IndexComponent {
    pub fn key_name(&self) -> Option<&String> {
        match self { Self::Calendar(key) => Some(&key.function), _ => self.column() }
    }
    pub fn key_type(&self, table: &Table) -> Option<ColumnType> {
        match self { Self::Calendar(_) => Some(ColumnType::Int), Self::Column(name) => table.columns.get(name).cloned(), _ => None }
    }
    pub fn value(&self, row: &Value) -> Option<Value> {
        match self { Self::Calendar(key) => Some(key.value(row)), Self::Column(name) => Some(row.field(name).cloned().unwrap_or(Value::Null)), _ => None }
    }
    pub fn column(&self) -> Option<&String> {
        match self {
            Self::Column(column) => Some(column),
            Self::Calendar(_) | Self::WordPrefixes { .. } | Self::Contribution(_) => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rules {
    pub read: RuleExpr,
    pub insert: RuleExpr,
    pub update: RuleExpr,
    pub delete: RuleExpr,
}

impl Rules {
    pub fn deny() -> Self {
        Self { read: RuleExpr::Deny, insert: RuleExpr::Deny, update: RuleExpr::Deny, delete: RuleExpr::Deny }
    }

    pub fn for_effect(&self, effect: Effect) -> &RuleExpr {
        match effect {
            Effect::Read => &self.read,
            Effect::Insert => &self.insert,
            Effect::Update => &self.update,
            Effect::Delete => &self.delete,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Effect {
    Read,
    Insert,
    Update,
    Delete,
}

impl fmt::Display for Effect {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Read => "read",
            Self::Insert => "insert",
            Self::Update => "update",
            Self::Delete => "delete",
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleExpr {
    Public { reason: String },
    Allow,
    Deny,
    Eq(RuleTerm, RuleTerm),
    Ne(RuleTerm, RuleTerm),
    /// Ordered comparisons are confined to named update transitions.
    Compare(crate::ir::BinaryOp, RuleTerm, RuleTerm),
    And(Vec<RuleExpr>),
    Or(Vec<RuleExpr>),
    Not(Box<RuleExpr>),
    Exists {
        table: String, index: String, key: Vec<RuleTerm>, provenance: KeyProvenance,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        equalities: Vec<(String, RuleTerm)>,
    },
    /// True only when the indexed target row was inserted earlier in this
    /// same transaction; insert rules only.
    Created {
        table: String, index: String, key: Vec<RuleTerm>, provenance: KeyProvenance,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        equalities: Vec<(String, RuleTerm)>,
    },
}

impl RuleExpr {
    pub fn is_public(&self) -> bool {
        matches!(self, Self::Public { .. })
    }

    pub fn is_uniformly_readable(&self) -> bool {
        matches!(self, Self::Public { .. } | Self::Allow)
    }

    /// Every `.field` the rule reads, on any probe key or comparison.
    pub fn fields(&self, out: &mut BTreeSet<String>) {
        let term = |term: &RuleTerm, out: &mut BTreeSet<String>| {
            if let RuleTerm::Field(field) | RuleTerm::Reference { column: field, .. } | RuleTerm::ReferenceChain { column: field, .. } = term {
                out.insert(field.clone());
            }
        };
        match self {
            Self::Public { .. } | Self::Allow | Self::Deny => {}
            Self::Eq(left, right) | Self::Ne(left, right) | Self::Compare(_, left, right) => {
                term(left, out);
                term(right, out);
            }
            Self::And(items) | Self::Or(items) => items.iter().for_each(|item| item.fields(out)),
            Self::Not(inner) => inner.fields(out),
            Self::Exists { key, equalities, .. } | Self::Created { key, equalities, .. } => {
                key.iter().chain(equalities.iter().map(|(_, term)| term)).for_each(|item| term(item, out));
            }
        }
    }

    /// The disjuncts of the rule: an `or` flattens, anything else is itself.
    pub fn disjuncts(&self) -> Vec<&RuleExpr> {
        match self {
            Self::Or(items) => items.iter().flat_map(|item| item.disjuncts()).collect(),
            other => vec![other],
        }
    }

    // @ref LLP 3000.007#20.6 — service seats read on the server and never enlarge a device's audience.
    pub fn service_grant(&self) -> Option<&str> {
        match self {
            Self::Eq(RuleTerm::Viewer, RuleTerm::Literal(Value::Id(principal)))
            | Self::Eq(RuleTerm::Literal(Value::Id(principal)), RuleTerm::Viewer)
                if principal.strip_prefix("service:").is_some_and(|name| !name.is_empty()) => Some(principal),
            _ => None,
        }
    }

    /// Remove only entire service disjuncts; a conjunct, negation or ordinary
    /// principal equality must still pass the ordinary exact-audience check.
    pub fn device_audience_rule(&self) -> std::borrow::Cow<'_, RuleExpr> {
        let terms = self.disjuncts();
        if !terms.iter().any(|term| term.service_grant().is_some()) { return std::borrow::Cow::Borrowed(self); }
        let mut audience: Vec<_> = terms.into_iter().filter(|term| term.service_grant().is_none()).cloned().collect();
        std::borrow::Cow::Owned(match audience.len() {
            0 => Self::Deny,
            1 => audience.pop().expect("one audience"),
            _ => Self::Or(audience),
        })
    }

    /// The rule as Quarry text, for diagnostics and rewrites.
    pub fn quarry(&self) -> String {
        fn term(term: &RuleTerm) -> String {
            match term {
                RuleTerm::Reference { table, column, field, old } => format!("{table}[{}.{column}].{field}", if *old { "old" } else { "" }),
                RuleTerm::ReferenceChain { column, hops, old } => hops.iter().fold(format!("{}.{column}", if *old { "old" } else { "" }), |key, hop| format!("{}[{key}].{}", hop.table, hop.field)),
                RuleTerm::Field(f) => format!(".{f}"),
                RuleTerm::OldField(f) => format!("old.{f}"),
                RuleTerm::NextField(f) => format!("next.{f}"),
                RuleTerm::Viewer => "viewer".to_owned(),
                RuleTerm::Literal(Value::String(s)) => format!("'{s}'"),
                RuleTerm::Literal(Value::Id(s)) => format!("'{s}'"),
                RuleTerm::Literal(v) => crate::value::canonical_json(v),
            }
        }
        match self {
            Self::Public { .. } => "public".to_owned(),
            Self::Allow => "allow".to_owned(),
            Self::Deny => "deny".to_owned(),
            Self::Eq(l, r) => format!("{} = {}", term(l), term(r)),
            Self::Compare(op,l,r) => format!("{} {} {}", term(l), match op { crate::ir::BinaryOp::Gte => ">=", crate::ir::BinaryOp::Gt => ">", crate::ir::BinaryOp::Lte => "<=", _ => "<" }, term(r)),
            Self::Ne(l, r) => format!("{} != {}", term(l), term(r)),
            Self::And(items) => items.iter().map(|i| i.quarry()).collect::<Vec<_>>().join(" and "),
            Self::Or(items) => items.iter().map(|i| i.quarry()).collect::<Vec<_>>().join(" or "),
            Self::Not(inner) => format!("not ({})", inner.quarry()),
            Self::Exists { table, key, equalities, .. } => format!("exists {table}[{}]", key.iter().map(term).chain(equalities.iter().map(|(col, value)| format!("{col} = {}", term(value)))).collect::<Vec<_>>().join(", ")),
            Self::Created { table, key, equalities, .. } => format!("created {table}[{}]", key.iter().map(term).chain(equalities.iter().map(|(col, value)| format!("{col} = {}", term(value)))).collect::<Vec<_>>().join(", ")),
        }
    }
}

pub use reference::{RuleTerm, RuleHop, MAX_RULE_HOPS};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Constraint {
    /// Shared decoder fence. Only the schema codec writes this wire carrier.
    Capabilities(BTreeSet<String>),
    /// Decode-only marker from unpublished F2 stores; the schema codec removes it.
    #[serde(skip_serializing)]
    Recorded,
    Unique { index: String },
    Cap { by: Vec<String>, max: u32 },
    AppendOnly,
    Immutable { fields: Vec<String> },
    Text { field: String, #[serde(default)] min: u32, #[serde(default, skip_serializing_if = "Option::is_none")] format: Option<TextFormat> },
    /// After every statement and before commit, the indexed target point
    /// must exist for each row this transaction inserted (`after insert`).
    FinalExistsOnInsert { table: String, index: String, key: Vec<RuleTerm> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextFormat {
    Handle,
    Url,
}

impl TextFormat {
    pub fn matches(self, text: &str) -> bool {
        match self {
            Self::Handle => text.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'),
            Self::Url => text
                .strip_prefix("https://")
                .or_else(|| text.strip_prefix("http://"))
                .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| !c.is_whitespace() && !c.is_control())),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Maintain {
    /// Compiler-owned whole owner-key partition (LLP 3000.028 §3.4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub own_keys: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_key: Option<crate::maintain::RowKey>,
    pub parent_key: Option<through::Through>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub aliases: BTreeMap<String,String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private: Option<columns::ColumnOwner>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<crate::maintain::Predicate>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub computed: BTreeMap<String, crate::maintain::CalendarKey>,
    #[serde(default, skip_serializing_if = "Residency::is_default")]
    pub residency: Residency,
    pub kind: MaintainKind,
    pub source: String,
    pub by: Vec<String>,
    pub target: String,
    #[serde(default)]
    pub readable: Option<RuleExpr>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MaintainKind {
    Count,
    Sum { of: String },
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Auth {
    pub password: bool,
    pub guests: bool,
}

impl Auth {
    fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

/// The intrinsic index every table carries.
pub const BY_ID: &str = "byId";

/// Bounded suffix lookup for sequence prediction, shared by every device store.
pub fn sequence_index(column: &str) -> String { format!("$sequence:{column}") }

/// A table with public rules, for fixtures and tests.
pub fn public_table(columns: BTreeMap<String, ColumnType>, indexes: BTreeMap<String, Index>) -> Table {
    let public = RuleExpr::Public { reason: "fixture".to_owned() };
    Table {
        ephemeral: None,
        sequences: Default::default(), written_by: Default::default(), update_transition: false, through: None,
        maintained: BTreeMap::new(), recorded: BTreeMap::new(),
        residency: Residency::default(),
        defaults: BTreeMap::new(),
        columns,
        indexes,
        rules: Rules { read: public.clone(), insert: public.clone(), update: public.clone(), delete: public },
        constraints: Vec::new(),
        leave: LeavePolicy::default(),
        sync: None,
        expire: None,
    }
}

/// One problem with a schema, located by a dotted path into it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SchemaIssue {
    pub path: String,
    pub message: String,
}

/// Structural admission of a raw schema: every index names declared,
/// indexable columns; every rule and constraint address exists; every
/// maintain has the closed target shape; every `sync` is invertible.
pub fn validate(schema: &Schema) -> Vec<SchemaIssue> {
    let mut issues = columns::validate(schema);
    issues.extend(ephemeral::validate(schema));
    issues.extend(field_authority::validate(schema));
    issues.extend(through::validate(schema));
    timeline::validate(schema, &mut issues);
    let issue = |issues: &mut Vec<SchemaIssue>, path: String, message: String| issues.push(SchemaIssue { path, message });
    let mut route_paths = BTreeSet::new();
    for (name, route) in &schema.routes {
        let path = format!("routes.{name}");
        if name.is_empty() || name.len() > 128 || name.split('.').any(|part| part.is_empty() || !part.bytes().enumerate().all(|(i, b)| b.is_ascii_alphabetic() || b == b'_' || (i > 0 && b.is_ascii_digit()))) {
            issue(&mut issues, path.clone(), "a route name is a qualified identifier of at most 128 bytes".into());
        }
        if let Err(message) = route.validate() { issue(&mut issues, path.clone(), message); }
        if !route_paths.insert(&route.path) { issue(&mut issues, path, "two route declarations publish the same POST path".into()); }
    }
    for (table_name, table) in &schema.tables {
        let path = format!("tables.{table_name}");
        for (column, parent) in &table.sequences {
            let valid = table.columns.get(column) == Some(&ColumnType::Int)
                && matches!(table.columns.get(parent), Some(ColumnType::Ref { table }) if schema.tables.contains_key(table))
                && !table.defaults.contains_key(column) && !table.maintained.contains_key(column)
                && !table.recorded.contains_key(column)
                && [column, parent].iter().all(|field| table.constraints.iter().any(|c| matches!(c, Constraint::Immutable { fields } if fields.contains(field))))
                && table.indexes.get(&sequence_index(column)) == Some(&Index::of(&[parent, column], false));
            if !valid { issue(&mut issues, format!("{path}.sequences.{column}"), "sequence by requires an int column, a required table reference, immutable ordinal and parent, and its sequence index; compile the declaration (guide types)".into()); }
        }
        for (field, capture) in &table.recorded {
            let target = schema.table(&capture.table);
            let valid = !table.defaults.contains_key(field) && field == &format!("{}.{}", capture.reference, capture.column)
                && !capture.reference.contains('.') && !capture.column.contains('.')
                && table.columns.get(&capture.reference).is_some_and(|kind| kind.required() == &ColumnType::Ref { table: capture.table.clone() })
                && table.immutable_fields().any(|name| name == capture.reference)
                && target.is_some_and(|target| target.rules.read.is_uniformly_readable()
                    && (capture.column == "id" || target.immutable_fields().any(|name| name == capture.column))
                    && target.columns.get(&capture.column).is_some_and(|kind| table.columns.get(field) == Some(&ColumnType::Optional(Box::new(kind.required().clone())))));
            if !valid { issue(&mut issues, format!("{path}.recorded.{field}"), "recorded attribution requires one immutable reference to a public target's immutable column or id, with an optional stored type; guide maintains".into()); }
        }
        if table.columns.get("id") != Some(&ColumnType::Id) {
            issue(&mut issues, format!("{path}.columns.id"), "every table has an intrinsic id column".into());
        }
        match table.indexes.get(BY_ID) {
            Some(index) if index.is_plain() && index.unique && index.columns() == ["id"] => {}
            _ => issue(&mut issues, format!("{path}.indexes.{BY_ID}"), "every table has the intrinsic unique byId index".into()),
        }
        for (name, index) in &table.indexes {
            let ipath = format!("{path}.indexes.{name}");
            if index.components.is_empty() || index.components.len() > 8 {
                issue(&mut issues, ipath.clone(), "declare between 1 and 8 components".into());
            }
            let mut seen = BTreeSet::new();
            let mut words = 0;
            for component in &index.components {
                match component {
                    IndexComponent::Column(column) => {
                        if !seen.insert(column) {
                            issue(&mut issues, ipath.clone(), format!("duplicate column {column}"));
                        }
                        match table.columns.get(column) {
                            None => issue(&mut issues, ipath.clone(), format!("undeclared column {column}")),
                            Some(kind) if !kind.is_indexable() => issue(&mut issues, ipath.clone(), format!("column {column} is {kind}, which cannot be indexed")),
                            _ => {}
                        }
                    }
                    IndexComponent::Calendar(key) => {
                        if !seen.insert(&key.function) || table.columns.contains_key(&key.function) {
                            issue(&mut issues, ipath.clone(), format!("computed index key {} is repeated or collides with a column", key.function));
                        }
                        if let Err(message) = key.validate(table) { issue(&mut issues, ipath.clone(), message); }
                    }
                    IndexComponent::Contribution(maintain) => {
                        let format_valid = index.components.len() == 1 || (index.components.len() == 2
                            && table.expiry_column().is_some_and(|expiry| index.components[1].column().map(String::as_str) == Some(expiry)));
                        if index.unique || !format_valid || maintain.source != *table_name || name != &maintain.contribution_index() {
                            issue(&mut issues, ipath.clone(), "invalid internal contribution index".into());
                        }
                        if let Err(message) = maintain.validate_keys(table) { issue(&mut issues, ipath.clone(), message); }
                    }
                    IndexComponent::WordPrefixes { fields, contract } => {
                        // One tokenizer, named: a store built under another
                        // contract would answer a different question.
                        words += 1;
                        if words > 1 {
                            issue(&mut issues, ipath.clone(), "an index has at most one words(..) component".into());
                        }
                        if index.unique {
                            issue(&mut issues, ipath.clone(), "a words(..) index cannot be unique: a row has one entry per word".into());
                        }
                        if fields.is_empty() {
                            issue(&mut issues, ipath.clone(), "words(..) names at least one text column".into());
                        }
                        if index.components.last().is_some_and(|last| last == component) {
                            issue(&mut issues, ipath.clone(), "words(..) is followed by the columns a page is ordered by, ending in id".into());
                        }
                        if contract.as_str() != Some(crate::words::CONTRACT) {
                            issue(&mut issues, ipath.clone(), format!("words(..) contract {contract} is not this engine's {}", crate::words::CONTRACT));
                        }
                        for field in fields {
                            match table.columns.get(field).map(ColumnType::required) {
                                Some(ColumnType::Text { .. }) => {}
                                Some(kind) => issue(&mut issues, ipath.clone(), format!("words({field}) needs a text column; {field} is {kind}")),
                                None => issue(&mut issues, ipath.clone(), format!("words names undeclared column {field}")),
                            }
                        }
                    }
                }
            }
        }
        for (side, rule) in [("read", &table.rules.read), ("insert", &table.rules.insert), ("update", &table.rules.update), ("delete", &table.rules.delete)] {
            validate_rule(schema, table, rule, side == "update", side == "insert", &format!("{path}.rules.{side}"), &mut issues);
        }
        for (position, constraint) in table.constraints.iter().enumerate() {
            let cpath = format!("{path}.constraints[{position}]");
            match constraint {
                Constraint::Unique { index } => {
                    if !table.indexes.get(index).is_some_and(|i| i.unique) {
                        issue(&mut issues, cpath, format!("unique constraint names no unique index {index}"));
                    }
                }
                Constraint::Cap { by, max } => {
                    // @ref LLP 3000.007#20.3 — an empty group is the whole table, under the existing cap enforcement.
                    if *max == 0 {
                        issue(&mut issues, cpath.clone(), "cap needs a positive maximum".into());
                    }
                    for column in by {
                        if !table.columns.contains_key(column) {
                            issue(&mut issues, cpath.clone(), format!("cap names undeclared column {column}"));
                        }
                    }
                    if !table.indexes.values().any(|index| index.is_plain() && index.columns().starts_with(by)) {
                        issue(&mut issues, cpath, format!("cap by {} needs an index whose leading columns are exactly those", by.join(", ")));
                    }
                }
                Constraint::Immutable { fields } => {
                    for field in fields {
                        if !table.columns.contains_key(field) {
                            issue(&mut issues, cpath.clone(), format!("immutable names undeclared column {field}"));
                        }
                    }
                }
                Constraint::Text { field, .. } => {
                    if !matches!(table.columns.get(field).map(ColumnType::required), Some(ColumnType::Text { .. })) {
                        issue(&mut issues, cpath, format!("text constraint on non-text column {field}"));
                    }
                }
                Constraint::FinalExistsOnInsert { table: target, index, key } => {
                    for term in key { reference::validate_term(schema, table, term, false, &cpath, &mut issues); }
                    match schema.table(target).and_then(|t| t.index(index)) {
                        Some(target_index) if target_index.is_plain() && target_index.columns().len() == key.len() => {}
                        Some(_) => issue(&mut issues, cpath,
                        "after insert needs a plain index with matching key arity".into()),
                        None => issue(&mut issues, cpath, format!("after insert names unknown {target}.{index}")),
                    }
                }
                Constraint::AppendOnly | Constraint::Capabilities(_) | Constraint::Recorded => {}
            }
        }
        if let Some(sync) = &table.sync {
            validate_sync(schema, table_name, table, sync, &format!("{path}.sync"), &mut issues);
        }
        if let Some(column) = &table.expire {
            let epath = format!("{path}.expire");
            match table.columns.get(column).map(ColumnType::required) {
                Some(ColumnType::Time) => {}
                Some(kind) => issue(&mut issues, epath.clone(), format!("expire at .{column} needs a time column; {column} is {kind}")),
                None => issue(&mut issues, epath.clone(), format!("expire names undeclared column {column}")),
            }
            if table.expiry_index().is_none() {
                issue(&mut issues, epath, format!("expire at .{column} needs an index leading with {column}"));
            }
        }
    }
    for (position, maintain) in schema.maintains.iter().enumerate() {
        validate_maintain(schema, position, maintain, &mut issues);
        if let Err(message) = own_keys::validate(schema, maintain) {
            issues.push(SchemaIssue { path: format!("maintains[{position}]"), message });
        }
    }
    for issue in &mut issues {
        for maintain in schema.maintains.iter().filter(|m|m.private.is_some()) {
            issue.path = issue.path.replace(&maintain.target, &maintain.label());
            issue.message = issue.message.replace(&maintain.target, &maintain.label());
        }
    }
    issues
}

fn validate_rule(schema: &Schema, table: &Table, rule: &RuleExpr, update: bool, insert: bool, path: &str, issues: &mut Vec<SchemaIssue>) {
    let check_term = |term: &RuleTerm, issues: &mut Vec<SchemaIssue>| reference::validate_term(schema, table, term, update, path, issues);
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => {}
        RuleExpr::Eq(l, r) | RuleExpr::Ne(l, r) | RuleExpr::Compare(_, l, r) => {
            if matches!(rule, RuleExpr::Compare(..)) && (!update || !table.update_transition) { issues.push(SchemaIssue { path: path.into(), message: "ordered comparisons require a named update transition".into() }); }
            check_term(l, issues);
            check_term(r, issues);
        }
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().for_each(|item| validate_rule(schema, table, item, update, insert, path, issues)),
        RuleExpr::Not(inner) => validate_rule(schema, table, inner, update, insert, path, issues),
        RuleExpr::Exists { table: target, index, key, equalities, .. } | RuleExpr::Created { table: target, index, key, equalities, .. } => {
            if matches!(rule, RuleExpr::Created { .. }) && !insert {
                issues.push(SchemaIssue { path: path.to_owned(), message: "created probes are valid only in insert rules".into() });
            }
            match schema.table(target).and_then(|t| t.index(index)) {
                Some(target_index) => {
                    if !target_index.is_plain() {
                        issues.push(SchemaIssue {
                            path: path.to_owned(),
                            message: format!("probe of {target}.{index} needs a plain index"),
                        });
                    }
                    if target_index.columns().len() != key.len() {
                        issues.push(SchemaIssue { path: path.to_owned(), message: format!("probe of {target}.{index} has {} terms; the index has {}", key.len(), target_index.columns().len()) });
                    }
                }
                None => issues.push(SchemaIssue { path: path.to_owned(), message: format!("rule probes unknown {target}.{index}") }),
            }
            if !equalities.is_empty() {
                if !schema.table(target).is_some_and(|table| table.index(index).is_some_and(|index| index.unique && index.columns().iter().all(|col| table.columns.get(col).is_some_and(|ty| !ty.is_optional())))) {
                    issues.push(SchemaIssue { path: path.to_owned(), message: "extra probe equalities need a total unique key".into() });
                }
                for (column, term) in equalities {
                    if !schema.table(target).is_some_and(|table| table.columns.contains_key(column)) {
                        issues.push(SchemaIssue { path: path.to_owned(), message: format!("probe checks undeclared column {target}.{column}") });
                    }
                    check_term(term, issues);
                }
            }
            key.iter().for_each(|term| check_term(term, issues));
        }
    }
}

fn validate_maintain(schema: &Schema, position: usize, maintain: &Maintain, issues: &mut Vec<SchemaIssue>) {
    let path = format!("maintains[{position}]");
    let issue = |issues: &mut Vec<SchemaIssue>, message: String| issues.push(SchemaIssue { path: path.clone(), message });
    let Some(source) = schema.table(&maintain.source) else {
        issue(issues, format!("maintain names unknown source table {}", maintain.source));
        return;
    };
    let Some(target) = schema.table(&maintain.target) else {
        issue(issues, format!("maintain names unknown target table {}", maintain.target));
        return;
    };
    if let Some(key)=&maintain.row_key {
        if let Err(message)=key.validate(schema,maintain) {issue(issues,message);}
        return;
    }
    // @ref LLP 3000.007#20.9 — stored value order cannot rank live sums between expiry and sweep; enforce at every schema entry point.
    if source.is_expiring() && target.indexes.values().any(|index| index.columns().iter().any(|column| column == "value")) {
        issue(issues, format!("maintain {} cannot order by value because source {} expires", maintain.target, maintain.source));
    }
    // The sweep, and a commit retiring its expired births, delete expired
    // rows as source writes; a maintained row is the engine's to write.
    if target.is_expiring() {
        issue(issues, format!("maintain {} cannot expire; give its source {} the lifetime", maintain.target, maintain.source));
    }
    if let Some(message) = maintain.expiring_read_refusal(schema) { issue(issues, message); }
    if maintain.by.is_empty() {
        issue(issues, "maintain by needs at least one source column".into());
    }
    if let Err(message) = maintain.validate_keys(source) { issue(issues, message); }
    for (field, target_field) in maintain.by.iter().zip(maintain.group_fields()) {
        let calendar_type = if maintain.computed.get(field).is_some_and(|key| source.recorded.contains_key(&key.column)) { ColumnType::Optional(Box::new(ColumnType::Int)) } else { ColumnType::Int };
        let expected = if maintain.computed.contains_key(field) { Some(&calendar_type) } else { source.columns.get(maintain.aliases.get(field).unwrap_or(field)) };
        match expected {
            None => issue(issues, format!("maintain names unknown source column {}.{field}", maintain.source)),
            Some(kind) if target.columns.get(&target_field) != Some(kind) => issue(issues, format!("maintain target column {field} must match the source type {kind}")),
            _ => {}
        }
    }
    let expected_value = match &maintain.kind {
        MaintainKind::Count => Some(ColumnType::Int),
        MaintainKind::Sum { of } => match source.columns.get(of) {
            Some(kind @ (ColumnType::Int | ColumnType::Decimal { .. } | ColumnType::Money { .. })) => Some(kind.clone()),
            Some(kind) => {
                issue(issues, format!("sum over {}.{of} needs int, decimal, or money, not {kind}", maintain.source));
                None
            }
            None => {
                issue(issues, format!("sum names unknown source column {}.{of}", maintain.source));
                None
            }
        },
    };
    if let Some(expected) = expected_value
        && target.columns.get("value") != Some(&expected)
    {
        issue(issues, format!("maintain target {}.value must be {expected}", maintain.target));
    }
    let group_fields = maintain.group_fields();
    let allowed: BTreeSet<&str> = ["id", "value"].into_iter().chain(group_fields.iter().map(String::as_str)).collect();
    let extra: Vec<_> = target.columns.keys().filter(|c| !allowed.contains(c.as_str())).cloned().collect();
    if !extra.is_empty() {
        issue(issues, format!("maintain target {} has non-aggregate columns {}", maintain.target, extra.join(", ")));
    }
    if !target.indexes.values().any(|index| index.unique && index.columns() == maintain.group_fields()) {
        issue(issues, format!("maintain target {} needs a unique index over {}", maintain.target, maintain.by.join(", ")));
    }
    // A delivered aggregate reveals a count: every recipient must be able to
    // read every contributing row, so the aggregate's audience is its
    // source's audience, grouped by the audience columns.
    if let Some(target_sync) = &target.sync
        && !source.rules.read.is_uniformly_readable()
    {
        let preserves = |column: &String, source_column: &String| maintain.group_fields().contains(column)
            && if let Some(capture) = maintain.aliases.get(column) { capture == source_column } else { column == source_column && maintain.bare_key(column) };
        let sound = match (&target_sync.audience, source.sync.as_ref().map(|sync| &sync.audience)) {
            (Audience::Public, Some(Audience::Public)) => true,
            (Audience::Column(column), Some(Audience::Column(source_column))) => preserves(column, source_column),
            (Audience::Target { table, prefix, principal }, Some(Audience::Target { table: source_table, prefix: source_prefix, principal: source_principal })) => table == source_table && principal == source_principal && prefix.len() == source_prefix.len() && prefix.iter().zip(source_prefix).all(|(column, source_column)| preserves(column, source_column)),
            _ => false,
        };
        if !sound {
            issue(issues, format!("maintain target {} syncs to an audience its source {} does not deliver to; a device would hold a count over rows it may not read. Sync the source to the same audience and group by its columns, or make the source public", maintain.target, maintain.source));
        }
    }
}

/// Why a `sync` line cannot be honoured, as the term the author must change.
fn validate_sync(schema: &Schema, table_name: &str, table: &Table, sync: &Sync, path: &str, issues: &mut Vec<SchemaIssue>) {
    let issue = |issues: &mut Vec<SchemaIssue>, message: String| issues.push(SchemaIssue { path: path.to_owned(), message });
    let audience_rule = table.rules.read.device_audience_rule();
    // @ref LLP 3000.014#5 — a child admits exactly its substituted audience, never a public subset.
    if table.through.is_some() {
        let exact = match (audience_rule.as_ref(), &sync.audience) {
            (RuleExpr::Allow | RuleExpr::Public { .. }, Audience::Public) => true,
            (RuleExpr::Eq(RuleTerm::Field(field), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(field)), Audience::Column(column)) => field == column,
            (RuleExpr::Exists { table, key, equalities, .. }, Audience::Target { table: target, prefix, .. }) => table == target && equalities.is_empty() && key == &prefix.iter().cloned().map(RuleTerm::Field).chain([RuleTerm::Viewer]).collect::<Vec<_>>(),
            _ => false,
        };
        if !exact { issue(issues, "read through sync must exactly equal its inherited audience; use `sync` to infer it, or `online only`".into()); }
    }

    match &sync.audience {
        Audience::Public => {
            if !audience_rule.is_uniformly_readable() {
                issue(issues, format!("sync public needs a public read rule; {table_name} reads under `{}`", table.rules.read.quarry()));
            }
        }
        Audience::Column(column) => {
            match table.columns.get(column) {
                Some(ColumnType::Principal) => {}
                Some(kind) => issue(issues, format!("sync to .{column} needs a principal column, not {kind}")),
                None => issue(issues, format!("sync to .{column} names an undeclared column")),
            }
            let implied = RuleExpr::Eq(RuleTerm::Field(column.clone()), RuleTerm::Viewer);
            let implied_flipped = RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column.clone()));
            // The rule is exactly the audience: a second disjunct would admit
            // viewers the partition never delivers to; a conjunct would deliver
            // rows the rule denies.
            if !audience_rule.is_uniformly_readable() && *audience_rule != implied && *audience_rule != implied_flipped {
                issue(issues, format!("sync to .{column} is only sound when the read rule is exactly `.{column} = viewer`; it reads under `{}`", table.rules.read.quarry()));
            }
        }
        Audience::Target { table: target_name, prefix, principal } => {
            let Some(target) = schema.table(target_name) else {
                issue(issues, format!("sync to {target_name} names an unknown table"));
                return;
            };
            if target.columns.get(principal) != Some(&ColumnType::Principal) {
                issue(issues, format!("sync to {target_name} reads principals from {target_name}.{principal}, which is not a principal column"));
            }
            for column in prefix {
                if !table.columns.contains_key(column) {
                    issue(issues, format!("sync to {target_name}[.{column}] names an undeclared column of {table_name}"));
                }
            }
            match audience_binding(schema, table_name, table, sync) {
                Err(why) => issue(issues, why),
                Ok(binding) if !audience_rule.is_uniformly_readable() => {
                    if !grant_guard(
                        &target.rules.insert,
                        &binding.columns,
                        &binding.principal,
                        target_name,
                        target,
                        schema,
                    ) {
                        issue(
                            issues,
                            format!(
                                "{target_name} grants the private audience of {table_name}: every insert rule branch needs an independent grant probe in {target_name}, binding its recipient to viewer and its group columns to this group's columns ({}), or a created probe for the new group; `.{principal} = viewer` alone lets anyone join. This also governs insert if absent and upsert",
                                binding.columns.join(", ")
                            ),
                        );
                    }
                    let fixed = binding.columns.iter().chain(std::iter::once(&binding.principal)).all(|column|
                        target.constraints.iter().any(|constraint| matches!(constraint, Constraint::Immutable { fields } if fields.contains(column))));
                    if !fixed
                        && !grant_guard(
                            &target.rules.update,
                            &binding.columns,
                            &binding.principal,
                            target_name,
                            target,
                            schema,
                        )
                    {
                        issue(
                            issues,
                            format!(
                                "{target_name} can retarget the private audience of {table_name}: make the audience columns immutable or guard every update branch with an independent grant probe"
                            ),
                        );
                    }
                }
                _ => {}
            }
        }
    }
    // Without a horizon, a group's rows are taken from an index leading with
    // the audience columns; `check` says so, or the first sync would.
    if sync.horizon.is_none() {
        let group: Vec<String> = match &sync.audience {
            Audience::Public => Vec::new(),
            Audience::Column(column) => vec![column.clone()],
            Audience::Target { prefix, .. } => prefix.clone(),
        };
        if !group.is_empty() && !table.indexes.values().any(|index| index.is_plain() && index.columns().starts_with(&group)) {
            issue(issues, format!("{} needs an index on {table_name} leading with {} so a device can take a group's rows: `by by{}: {}, id`", sync.line(), group.join(", "), group.iter().map(|c| { let mut cs = c.chars(); cs.next().map(|f| f.to_uppercase().collect::<String>() + cs.as_str()).unwrap_or_default() }).collect::<String>(), group.join(", ")),
            );
        }
    }
    if let Some(horizon) = &sync.horizon {
        match table.index(&horizon.by) {
            None => issue(issues, format!("horizon names unknown index {table_name}.{}", horizon.by),
            ),
            Some(index) => {
                let group: Vec<String> = match &sync.audience {
                    Audience::Public => Vec::new(),
                    Audience::Column(column) => vec![column.clone()],
                    Audience::Target { prefix, .. } => prefix.clone(),
                };
                if !index.is_plain() || !index.columns().starts_with(&group) {
                    issue(issues, format!(
                            "horizon index {} must be plain and lead with the audience columns {}", horizon.by, group.join(", ")),
                    );
                }
                if horizon.last == 0 {
                    issue(issues, "a horizon keeps at least one row".into());
                }
            }
        }
    }
}

// @ref LLP 3000#7-decisions-during-execution — every audience-granting branch requires prior authority
fn grant_guard(
    rule: &RuleExpr,
    columns: &[String],
    principal: &str,
    audience_name: &str,
    audience: &Table,
    schema: &Schema,
) -> bool {
    let group_pinned = |key: &[RuleTerm]| {
        !columns.is_empty() && columns.iter().all(|column|
        key.iter().any(|term| matches!(term, RuleTerm::Field(field) | RuleTerm::NextField(field) if field == column)))
    };
    match rule {
        RuleExpr::Deny => true,
        RuleExpr::Exists { table, index, key, .. } => table == audience_name && audience.index(index).is_some_and(|index| {
            let fields = index.columns();
            let term = |column: &str| fields.iter().position(|field| field == column).and_then(|at| key.get(at));
            index.is_plain() && fields.len() == key.len() && term(principal) == Some(&RuleTerm::Viewer)
                && !columns.is_empty() && columns.iter().all(|column|
                    matches!(term(column), Some(RuleTerm::Field(field) | RuleTerm::NextField(field)) if field == column))
        }),
        RuleExpr::Created { table, index, key, .. } => columns.len() == 1 && key.len() == 1 && group_pinned(key)
            && matches!(audience.columns.get(&columns[0]), Some(ColumnType::Ref { table: group }) if group == table)
            && schema.table(table).and_then(|table| table.index(index)).is_some_and(|index| index.unique && index.columns() == ["id"]),
        RuleExpr::And(rules) => rules.iter().any(|rule| grant_guard(rule, columns, principal, audience_name, audience, schema)),
        RuleExpr::Or(rules) => rules.iter().all(|rule| grant_guard(rule, columns, principal, audience_name, audience, schema)),
        _ => false,
    }
}

/// The target table's columns a content row's `prefix` columns are matched
/// against. `.id` on the content table matches the target's reference to
/// the content table; any other column matches the target's same-named
/// column of the same type, else its sole reference to the same table.
pub fn target_prefix_columns(content_name: &str, content: &Table, target: &Table, prefix: &[String], principal: &str) -> Option<Vec<String>> {
    let mut out = Vec::new();
    for column in prefix {
        let kind = if column == "id" { ColumnType::Ref { table: content_name.to_owned() } } else { content.columns.get(column)?.required().clone() };
        let same_name = target.columns.get(column).filter(|target_kind| column != "id" && target_kind.required() == &kind && column != principal);
        if same_name.is_some() {
            out.push(column.clone());
            continue;
        }
        let by_reference: Vec<&String> = target.columns.iter().filter(|(name, target_kind)| name.as_str() != "id" && name.as_str() != principal && matches!(&kind, ColumnType::Ref { .. }) && target_kind.required() == &kind).map(|(name, _)| name).collect();
        match by_reference.as_slice() {
            [one] => out.push((*one).clone()),
            _ => return None,
        }
    }
    Some(out)
}

/// The proof behind `sync to target[.prefix] by .principal`: the read
/// rule's probe of the target and the target index that probe uses. The
/// partition log delivers by exactly this index; it never reconstructs the
/// mapping from column names or types (a same-typed second reference would
/// deliver one group under the authority of another).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AudienceBinding {
    /// The unique target index `columns ++ [principal]`: a group's principals.
    pub group_index: String,
    /// The target's columns the content row's prefix maps to, in order.
    pub columns: Vec<String>,
    /// The target's principal column, at the probe's `viewer` position.
    pub principal: String,
    /// A target index leading with `principal ++ columns`: a principal's groups.
    pub principal_index: String,
}

pub fn audience_binding(schema: &Schema, table_name: &str, table: &Table, sync: &Sync) -> Result<AudienceBinding, String> {
    let Audience::Target { table: target_name, prefix, principal } = &sync.audience else {
        return Err(format!("{table_name} does not sync to a target table"));
    };
    let target = schema.table(target_name).ok_or_else(|| format!("sync to {target_name} names an unknown table"))?;
    let spelled_prefix = prefix.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", ");
    let mut want = prefix.iter().map(|column| RuleTerm::Field(column.clone())).collect::<Vec<_>>();
    want.push(RuleTerm::Viewer);
    let spelled_want = want.iter().map(|t| match t { RuleTerm::Field(f) => format!(".{f}"), _ => "viewer".into() }).collect::<Vec<_>>().join(", ");
    let audience_rule = table.rules.read.device_audience_rule();
    let columns = if audience_rule.is_uniformly_readable() {
        // A public table may sync to any audience; the mapping is by name and type.
        target_prefix_columns(table_name, table, target, prefix, principal).ok_or_else(|| format!("sync to {target_name}[{spelled_prefix}]: {target_name} has no column matching {} (same name and type, or one reference to the same table)", prefix.iter().map(|c| format!("{table_name}.{c}")).collect::<Vec<_>>().join(", ")))?
    } else {
        // The rule is exactly the probe the sync inverts: a second disjunct
        // would admit viewers the partition never delivers to; a conjunct
        // or a literal in the key would deliver rows the rule denies.
        let exact = format!("sync to {target_name}[{spelled_prefix}] is only sound when the read rule is exactly `exists {target_name}[{spelled_want}]`; it reads under `{}`", table.rules.read.quarry());
        let RuleExpr::Exists { table: probed, index, key, equalities, .. } = audience_rule.as_ref() else { return Err(exact) };
        if probed != target_name || *key != want || !equalities.is_empty() {
            return Err(exact);
        }
        let index_def = target.index(index).ok_or_else(|| format!("the read rule probes unknown index {target_name}.{index}"))?;
        let index_columns = index_def.columns();
        if !index_def.is_plain() || index_columns.len() != want.len() {
            return Err(format!("the read rule's probe uses {target_name}.{index}, which does not cover exactly `{spelled_want}`"));
        }
        let probe_principal = &index_columns[prefix.len()];
        if probe_principal != principal {
            return Err(format!("sync to {target_name}[{spelled_prefix}] by .{principal} reads recipients from {target_name}.{principal}, but the read rule binds viewer to {target_name}.{probe_principal}; say `by .{probe_principal}`"));
        }
        index_columns[..prefix.len()].to_vec()
    };
    for column in prefix {
        if table.columns.get(column).is_some_and(ColumnType::is_optional) && !table.through.as_ref().is_some_and(|t| t.fields.contains_key(column)) {
            return Err(format!("sync to {target_name}[{spelled_prefix}] needs required group keys; {table_name}.{column} is optional. Make every content group column required so online rules and device partitions name the same group"));
        }
    }
    for column in &columns {
        if target.columns.get(column).is_some_and(ColumnType::is_optional) {
            return Err(format!("sync to {target_name}[{spelled_prefix}] needs required group keys; {target_name}.{column} is optional. Make every audience group column required so membership discovery, revocation and content delivery name the same group"));
        }
    }
    let mut by_group = columns.clone();
    by_group.push(principal.clone());
    let (group_index, group_def) = target.indexes.iter().find(|(_, index)| index.is_plain() && index.columns() == by_group).ok_or_else(|| format!("sync to {target_name}[{spelled_prefix}] needs an index on {target_name} over {}", by_group.join(", ")))?;
    if !group_def.unique {
        return Err(format!("the audience index {target_name}.{group_index} must be unique: with two rows for one group and principal, deleting one would revoke a group the other still grants"));
    }
    let mut by_principal = vec![principal.clone()];
    by_principal.extend(columns.iter().cloned());
    let principal_index = target.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(&by_principal)).map(|(name, _)| name.clone()).ok_or_else(|| format!("sync to {target_name}[{spelled_prefix}] needs an index on {target_name} whose leading columns are {} so a device can find its groups", by_principal.join(", ")))?;
    Ok(AudienceBinding { group_index: group_index.clone(), columns, principal: principal.clone(), principal_index })
}

/// The maintained target's row address for a source image: the `by` values.
pub fn maintained_key(source: &Value, by: &[String]) -> Vec<Value> {
    by.iter().map(|field| source.field(field).cloned().unwrap_or(Value::Null)).collect()
}

/// The id of a maintained row is its group's canonical form, as Snapback 2
/// spelled it: an aggregate's identity is its key, and the conformance
/// corpus holds it to this spelling. Programs read aggregates by group,
/// never by id.
pub fn maintained_id(key: &[Value]) -> String {
    crate::value::canonical_json(&key)
}

/// Whether a value is (or contains) the reserved system principal.
pub fn contains_system_principal(value: &Value) -> bool {
    match value {
        Value::Id(id) => id == crate::SYSTEM_PRINCIPAL,
        Value::Array(items) => items.iter().any(contains_system_principal),
        Value::Row(fields) | Value::Map(fields) => fields.values().any(contains_system_principal),
        _ => false,
    }
}

/// Missing optional columns read as null; missing required columns with a
/// literal default read that value. Contextual defaults belong to inserts.
pub fn materialize_optional_fields(row: &mut Value, table: &Table) {
    let fields = match row {
        Value::Row(fields) | Value::Map(fields) => fields,
        _ => return,
    };
    for (name, kind) in &table.columns {
        if !fields.contains_key(name) {
            if table.maintained.contains_key(name) {
                fields.insert(name.clone(), Value::Int(0));
            } else if kind.is_optional() {
                fields.insert(name.clone(), Value::Null);
            } else if let Some(ColumnDefault::Literal(value)) = table.defaults.get(name) {
                fields.insert(name.clone(), value.clone());
            }
        }
    }
}

/// Borrow complete images; materialize old images only when needed.
pub fn row_image<'a>(row: &'a Value, table: &Table) -> std::borrow::Cow<'a, Value> {
    if table.columns.keys().all(|column| row.field(column).is_ok()) { return std::borrow::Cow::Borrowed(row); }
    let mut image = row.clone();
    materialize_optional_fields(&mut image, table);
    std::borrow::Cow::Owned(image)
}

#[cfg(test)]
mod tests;
/// The type an argument declares as a column type, for value validation.
pub fn arg_as_column(kind: &ArgType) -> Option<ColumnType> {
    Some(match kind {
        ArgType::Cursor | ArgType::Scalar => return None,
        ArgType::Id => ColumnType::Id,
        ArgType::Principal => ColumnType::Principal,
        ArgType::Ref { table } => ColumnType::Ref { table: table.clone() },
        ArgType::Text { max, .. } => ColumnType::Text { max: *max },
        ArgType::Bytes { max } => ColumnType::Bytes { max: *max },
        ArgType::Image { max } => ColumnType::Image { max: *max, once: false },
        ArgType::Video { max } => ColumnType::Video { max: *max },
        ArgType::Int => ColumnType::Int,
        ArgType::Bool => ColumnType::Bool,
        ArgType::Time => ColumnType::Time,
        ArgType::Json { max_bytes } => ColumnType::Json { max_bytes: *max_bytes },
        ArgType::Optional(inner) => ColumnType::Optional(Box::new(arg_as_column(inner)?)),
        ArgType::List { of, max } => ColumnType::List { of: Box::new(of.as_deref().map(arg_as_column).flatten().unwrap_or(ColumnType::Json { max_bytes: 4096 })), max: *max },
        ArgType::ListRange { of, min, max } => ColumnType::ListRange { of: Box::new(of.as_deref().and_then(arg_as_column).unwrap_or(ColumnType::Json { max_bytes: 4096 })), min: *min, max: *max },
        ArgType::Enum { variants } => ColumnType::Enum { variants: variants.clone() },
        ArgType::Decimal { scale } => ColumnType::Decimal { scale: *scale },
        ArgType::Money { currency, scale } => ColumnType::Money { currency: currency.clone(), scale: *scale },
    })
}
#[cfg(feature = "sqlite")] pub mod inspection;
