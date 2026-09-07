use crate::ir::{ArgType, KeyProvenance};
pub use crate::search_key::IndexComponent;
use crate::value::{Value, digest};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Schema {
    pub tables: BTreeMap<String, Table>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub schedules: Vec<crate::timers::Schedule>,
    #[serde(default)]
    pub maintains: Vec<Maintain>,
    // @ref LLP 1001#9-schema-additions — defaults preserve the frozen S1 corpus shape.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub channels: BTreeMap<String, Channel>,
    #[serde(default, skip_serializing_if = "Auth::is_default")]
    pub auth: Auth,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<String>,
}

impl Schema {
    pub fn hash(&self) -> String {
        digest(self)
    }

    pub fn rule_hash(&self, rule: &RuleExpr) -> String {
        // @ref LLP 1001#7-channels-schemachannels — a scoped verdict binds
        // the complete referenced policy graph, not a disclosure projection.
        // Scoped verdicts are reusable authority. Bind them to the complete
        // schema policy so a successor cannot carry a verdict across any
        // referenced read-rule replacement, including cyclic rule graphs.
        digest(&(self.hash(), rule))
    }

    pub fn table(&self, name: &str) -> Option<&Table> {
        if name == crate::CONNECTED_TABLE {
            return Some(&crate::connected::TABLE);
        }
        self.tables.get(name)
    }

    /// Whether an `exists` probe may expose its row/absence instead of an
    /// authority verdict. The proof is intentionally structural: public
    /// targets pass, as do protected targets whose read rule is proven true
    /// for the exact indexed row being probed (for example a membership row
    /// guarded by that same `(scope, viewer)` existence check).
    pub fn rule_input_is_readable(
        &self,
        table_name: &str,
        index_name: &str,
        key: &[RuleTerm],
    ) -> bool {
        let Some(table) = self.table(table_name) else {
            return false;
        };
        if table.rules.read.is_uniformly_readable() {
            return true;
        }
        let Some(index) = table.index(index_name) else {
            return false;
        };
        let Some(columns) = index.scalar_columns() else {
            return false;
        };
        prove_probe_row_readable(&table.rules.read, table_name, index_name, &columns, key)
    }
}

fn prove_probe_row_readable(
    rule: &RuleExpr,
    table: &str,
    index: &str,
    index_columns: &[String],
    probe_key: &[RuleTerm],
) -> bool {
    let substitute = |term: &RuleTerm| match term {
        RuleTerm::Field(field) => index_columns
            .iter()
            .position(|column| column == field)
            .and_then(|position| probe_key.get(position))
            .cloned(),
        // Relational update terms are never valid in read rules. Keep this
        // proof fail-closed if an uncertified schema reaches it anyway.
        RuleTerm::OldField(_) | RuleTerm::NextField(_) => None,
        other => Some(other.clone()),
    };
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow => true,
        RuleExpr::Eq(left, right) => substitute(left)
            .zip(substitute(right))
            .is_some_and(|(left, right)| left == right),
        RuleExpr::And(rules) => {
            !rules.is_empty()
                && rules.iter().all(|rule| {
                    prove_probe_row_readable(rule, table, index, index_columns, probe_key)
                })
        }
        RuleExpr::Or(rules) => rules
            .iter()
            .any(|rule| prove_probe_row_readable(rule, table, index, index_columns, probe_key)),
        RuleExpr::Exists {
            table: target,
            index: target_index,
            key,
            ..
        } if target == table && target_index == index => key
            .iter()
            .map(substitute)
            .collect::<Option<Vec<_>>>()
            .is_some_and(|key| key == probe_key),
        RuleExpr::Deny
        | RuleExpr::Ne(_, _)
        | RuleExpr::Not(_)
        | RuleExpr::Exists { .. }
        | RuleExpr::Created { .. } => false,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Table {
    pub columns: BTreeMap<String, ColumnType>,
    pub indexes: BTreeMap<String, Index>,
    pub rules: Rules,
    #[serde(default)]
    pub constraints: Vec<Constraint>,
    // @ref LLP 1012#5-retention-revocation-and-the-fence — retention governs
    // the client-side hidden-row case and defaults compatibly for older IR.
    #[serde(default)]
    pub retain: RetentionPolicy,
}

impl Table {
    pub fn index(&self, name: &str) -> Option<&Index> {
        self.indexes.get(name)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RetentionPolicy {
    #[default]
    UntilRevoked,
    DeliveredHistory,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ColumnType {
    Id,
    // @ref LLP 1001#6-identity-identityrs — Schema principals stay nominal while v1 encodes them as Value::Id.
    Principal,
    Text {
        max: u32,
    },
    // @ref LLP 1001#9-schema-additions — bytes use the value model's canonical lowercase-base16 wrapper.
    Bytes {
        max: u32,
    },
    // @ref LLP 1006#1-the-move — assets are closed map values; the bound is stored bytes, not record size.
    Image {
        max: u32,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        once: bool,
    },
    Video {
        max: u32,
    },
    Int,
    // @ref LLP 1001#9-schema-additions — enum and fixed-scale columns keep scalar storage keys.
    Enum {
        variants: Vec<String>,
    },
    Decimal {
        scale: u8,
    },
    Money {
        currency: String,
        scale: u8,
    },
    Bool,
    Time,
    Ref {
        table: String,
    },
    Json {
        max_bytes: u32,
    },
    Optional(Box<ColumnType>),
    List {
        of: Box<ColumnType>,
        max: u32,
    },
}

impl ColumnType {
    pub fn is_once(&self) -> bool {
        match self {
            Self::Image { once, .. } => *once,
            Self::Optional(inner) | Self::List { of: inner, .. } => inner.is_once(),
            _ => false,
        }
    }

    // @ref LLP 1006#1-the-move — asset records and lists are deliberately outside scalar index custody.
    pub(crate) fn is_indexable(&self) -> bool {
        match self {
            Self::Image { .. } | Self::Video { .. } | Self::List { .. } => false,
            Self::Optional(inner) => inner.is_indexable(),
            _ => true,
        }
    }

    pub(crate) fn contains_asset(&self) -> bool {
        match self {
            Self::Image { .. } | Self::Video { .. } => true,
            Self::Optional(inner) | Self::List { of: inner, .. } => inner.contains_asset(),
            _ => false,
        }
    }
}

impl fmt::Display for ColumnType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Id => formatter.write_str("Id"),
            Self::Principal => formatter.write_str("Principal"),
            Self::Text { max } => write!(formatter, "Text(max={max})"),
            Self::Bytes { max } => write!(formatter, "Bytes(max={max})"),
            Self::Image { max, once: false } => write!(formatter, "Image(max={max})"),
            Self::Image { max, once: true } => write!(formatter, "Image(max={max}, once)"),
            Self::Video { max } => write!(formatter, "Video(max={max})"),
            Self::Int => formatter.write_str("Int"),
            Self::Enum { variants } => write!(formatter, "Enum({})", variants.join("|")),
            Self::Decimal { scale } => write!(formatter, "Decimal(scale={scale})"),
            Self::Money { currency, scale } => {
                write!(formatter, "Money({currency}, scale={scale})")
            }
            Self::Bool => formatter.write_str("Bool"),
            Self::Time => formatter.write_str("Time"),
            Self::Ref { table } => write!(formatter, "Ref({table})"),
            Self::Json { max_bytes } => write!(formatter, "Json(maxBytes={max_bytes})"),
            Self::Optional(inner) => write!(formatter, "Optional({inner})"),
            Self::List { of, max } => write!(formatter, "List({of}, max={max})"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Index {
    pub components: Vec<IndexComponent>,
    pub unique: bool,
}

impl Index {
    pub fn derived_offset(&self) -> Option<usize> {
        self.components
            .iter()
            .position(|c| matches!(c, IndexComponent::WordPrefixes { .. }))
    }
    pub fn scalar_columns(&self) -> Option<Vec<String>> {
        self.suffix_columns(0)
    }
    pub fn suffix_columns(&self, offset: usize) -> Option<Vec<String>> {
        self.components
            .get(offset..)?
            .iter()
            .map(|c| c.column().cloned())
            .collect()
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleExpr {
    Public {
        reason: String,
    },
    Allow,
    Deny,
    Eq(RuleTerm, RuleTerm),
    Ne(RuleTerm, RuleTerm),
    And(Vec<RuleExpr>),
    Or(Vec<RuleExpr>),
    Not(Box<RuleExpr>),
    Exists {
        table: String,
        index: String,
        key: Vec<RuleTerm>,
        provenance: KeyProvenance,
    },
    // @ref LLP 1001#9-schema-additions — creation provenance is insert-rule-only and transaction-local.
    /// One indexed point probe that is true only when the resolved target row
    /// was inserted earlier in this same transaction.
    Created {
        table: String,
        index: String,
        key: Vec<RuleTerm>,
        provenance: KeyProvenance,
    },
}

impl RuleExpr {
    pub fn is_public(&self) -> bool {
        matches!(self, Self::Public { .. })
    }
    pub fn is_uniformly_readable(&self) -> bool {
        matches!(self, Self::Public { .. } | Self::Allow)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleTerm {
    Field(String),
    OldField(String),
    NextField(String),
    Viewer,
    Literal(Value),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Constraint {
    Unique {
        index: String,
    },
    Cap {
        by: Vec<String>,
        max: u32,
    },
    AppendOnly,
    Immutable {
        fields: Vec<String>,
    },
    Text {
        field: String,
        #[serde(default)]
        min: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        format: Option<TextFormat>,
    },
    // @ref LLP 1001#9-schema-additions — the creator-seat postcondition applies only to source inserts.
    /// For each row inserted into this table, require the indexed target point
    /// to exist after every statement has completed and before commit.
    FinalExistsOnInsert {
        table: String,
        index: String,
        key: Vec<RuleTerm>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextFormat {
    Handle,
    Url,
}

impl TextFormat {
    pub(crate) fn matches(self, text: &str) -> bool {
        match self {
            Self::Handle => text
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'),
            Self::Url => text
                .strip_prefix("https://")
                .or_else(|| text.strip_prefix("http://"))
                .is_some_and(|rest| {
                    !rest.is_empty()
                        && rest
                            .chars()
                            .all(|character| !character.is_whitespace() && !character.is_control())
                }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Maintain {
    pub kind: MaintainKind,
    pub source: String,
    pub by: Vec<String>,
    pub target: String,
    pub readable: Option<RuleExpr>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MaintainKind {
    Count,
    Sum { of: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MaintainIssue {
    pub position: usize,
    pub message: String,
}

// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — maintained
// targets are closed, single-owner engine projections at every trust boundary.
/// Validate the closed row shape that engine-owned aggregate writes materialize.
/// Keeping this independent of the compiler makes raw project JSON and successor
/// admission fail before an aggregate write or backfill can observe a bad shape.
pub(crate) fn maintain_issues(schema: &Schema) -> Vec<MaintainIssue> {
    let mut issues = Vec::new();
    let mut target_owners = BTreeMap::<&str, usize>::new();
    let maintain_sources = schema
        .maintains
        .iter()
        .map(|maintain| maintain.source.as_str())
        .collect::<BTreeSet<_>>();

    for (position, maintain) in schema.maintains.iter().enumerate() {
        let issue = |message| MaintainIssue { position, message };
        if maintain.source == crate::CONNECTED_TABLE || maintain.target == crate::CONNECTED_TABLE {
            issues.push(issue(
                "connected is a virtual program read, not a maintained source or target".to_owned(),
            ));
            continue;
        }

        if let Some(first) = target_owners.insert(maintain.target.as_str(), position) {
            issues.push(issue(format!(
                "maintain target {} is owned by both schema.maintains[{first}] and schema.maintains[{position}]",
                maintain.target
            )));
        }
        if maintain_sources.contains(maintain.target.as_str()) {
            issues.push(issue(format!(
                "maintain target {} cannot also be a maintain source",
                maintain.target
            )));
        }
        if maintain.by.is_empty() {
            issues.push(issue(
                "maintain.by must contain at least one source column".to_owned(),
            ));
        }

        let source = schema.table(&maintain.source);
        if source.is_none() {
            issues.push(issue(format!(
                "maintain names unknown source table {}",
                maintain.source
            )));
        }
        let target = schema.table(&maintain.target);
        if target.is_none() {
            issues.push(issue(format!(
                "maintain names unknown target table {}",
                maintain.target
            )));
        }

        let mut group_fields = BTreeSet::new();
        for field in &maintain.by {
            if !group_fields.insert(field.as_str()) {
                issues.push(issue(format!("maintain.by repeats source column {field}")));
                continue;
            }
            if field == "id" || field == "value" {
                issues.push(issue(format!(
                    "maintain.by cannot use reserved source column {field}"
                )));
                continue;
            }
            if source.is_some_and(|table| !table.columns.contains_key(field)) {
                issues.push(issue(format!(
                    "maintain names unknown source column {}.{field}",
                    maintain.source
                )));
            } else if source
                .and_then(|table| table.columns.get(field))
                .is_some_and(ColumnType::contains_asset)
            {
                // @ref LLP 1006#2a-one-asset-one-home-author-ruling-2026-09-01 — maintained grouping would silently copy an affine asset into a second cell.
                issues.push(issue(format!(
                    "maintain.by cannot use asset-typed source column {}.{field}",
                    maintain.source
                )));
            }
        }

        if let MaintainKind::Sum { of } = &maintain.kind
            && let Some(source) = source
        {
            match source.columns.get(of) {
                None => issues.push(issue(format!(
                    "sum maintain names unknown source column {}.{of}",
                    maintain.source
                ))),
                Some(ColumnType::Int | ColumnType::Decimal { .. } | ColumnType::Money { .. }) => {}
                Some(_) => issues.push(issue(format!(
                    "sum maintain source column {}.{of} must be Int, Decimal, or Money",
                    maintain.source
                ))),
            }
        }

        let (Some(source), Some(target)) = (source, target) else {
            continue;
        };
        if target.columns.get("id") != Some(&ColumnType::Id) {
            issues.push(issue(format!(
                "maintain target {}.id must be the intrinsic Id column",
                maintain.target
            )));
        }
        let expected_value = match &maintain.kind {
            MaintainKind::Count => Some(&ColumnType::Int),
            MaintainKind::Sum { of } => source.columns.get(of),
        };
        if let Some(expected_value) = expected_value
            && target.columns.get("value") != Some(expected_value)
        {
            issues.push(issue(format!(
                "maintain target {}.value type {} must equal source {} type {}",
                maintain.target,
                target
                    .columns
                    .get("value")
                    .map(ToString::to_string)
                    .unwrap_or_else(|| "missing".to_owned()),
                match &maintain.kind {
                    MaintainKind::Count => "count".to_owned(),
                    MaintainKind::Sum { of } => format!("{}.{of}", maintain.source),
                },
                expected_value,
            )));
        }

        let mut allowed = BTreeSet::from(["id", "value"]);
        for field in group_fields {
            if field == "id" || field == "value" {
                continue;
            }
            allowed.insert(field);
            let Some(source_type) = source.columns.get(field) else {
                continue;
            };
            if target.columns.get(field) != Some(source_type) {
                issues.push(issue(format!(
                    "maintain target {}.{field} must exactly match source {}.{field}",
                    maintain.target, maintain.source
                )));
            }
        }
        let extra: Vec<_> = target
            .columns
            .keys()
            .filter(|field| !allowed.contains(field.as_str()))
            .cloned()
            .collect();
        if !extra.is_empty() {
            issues.push(issue(format!(
                "maintain target {} has non-aggregate columns {}",
                maintain.target,
                extra.join(", ")
            )));
        }
    }

    issues
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Channel {
    pub args: BTreeMap<String, ArgType>,
    pub publish: RuleExpr,
    pub subscribe: RuleExpr,
    pub ttl_ms: u32,
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

pub fn public_table(
    columns: BTreeMap<String, ColumnType>,
    indexes: BTreeMap<String, Index>,
) -> Table {
    let public = RuleExpr::Public {
        reason: "spike fixture".to_owned(),
    };
    Table {
        columns,
        indexes,
        rules: Rules {
            read: public.clone(),
            insert: public.clone(),
            update: public.clone(),
            delete: public,
        },
        constraints: Vec::new(),
        retain: RetentionPolicy::default(),
    }
}

// @ref LLP 1001#unicode-search-foundation — derived indexes are bounded, nonunique scan predicates.
pub(crate) fn index_errors(table_name: &str, table: &Table) -> Vec<crate::RuntimeError> {
    let mut errors = Vec::new();
    for (name, index) in &table.indexes {
        for column in index.components.iter().filter_map(IndexComponent::column) {
            if table
                .columns
                .get(column)
                .is_some_and(|kind| !kind.is_indexable())
            {
                errors.push(crate::RuntimeError::SchemaIndexColumn {
                    table: table_name.into(),
                    index: name.clone(),
                    column: column.clone(),
                });
            }
        }
        let mut fail = |message: String| {
            errors.push(crate::RuntimeError::Schema(format!(
                "index {table_name}.{name}: {message}"
            )))
        };
        if index.derived_offset().is_some()
            && table
                .constraints
                .iter()
                .any(|c| matches!(c,Constraint::Unique{index} if index==name))
        {
            fail("wordPrefixes cannot be a unique constraint address".into());
        }
        if index.components.is_empty() || index.components.len() > 8 {
            fail("declare between 1 and 8 components".into());
        }
        let mut columns = BTreeSet::new();
        let mut derived = 0;
        for (offset, component) in index.components.iter().enumerate() {
            match component {
                IndexComponent::Column(column) => {
                    if !columns.insert(column) {
                        fail(format!("duplicate column {column}"));
                    }
                    match table.columns.get(column) {
                        None => fail(format!("undeclared column {column}")),
                        Some(kind) if !kind.is_indexable() => {}
                        _ => {}
                    }
                }
                IndexComponent::WordPrefixes { fields, .. } => {
                    derived += 1;
                    if index.unique || derived > 1 || offset + 1 == index.components.len() {
                        fail("wordPrefixes needs one nonunique derived component followed by an ordinary suffix".into());
                    }
                    let mut seen = BTreeSet::new();
                    if fields.is_empty() {
                        fail("wordPrefixes needs at least one bounded text field".into());
                    }
                    for field in fields {
                        if !seen.insert(field) {
                            fail(format!("repeated wordPrefixes field {field}"));
                        }
                        let kind = table.columns.get(field);
                        let valid = match kind {
                            Some(ColumnType::Text { .. }) => true,
                            Some(ColumnType::Optional(inner)) => {
                                matches!(inner.as_ref(), ColumnType::Text { .. })
                            }
                            _ => false,
                        };
                        if !valid {
                            fail(format!(
                                "wordPrefixes field {field} must be declared bounded required or optional text"
                            ));
                        }
                    }
                }
            }
        }
    }
    errors
}
