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

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Schema {
    pub tables: BTreeMap<String, Table>,
    #[serde(default)]
    pub maintains: Vec<Maintain>,
    #[serde(default, skip_serializing_if = "Auth::is_default")]
    pub auth: Auth,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<String>,
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
            .filter_map(|(name, table)| table.sync.as_ref().map(|sync| (name.as_str(), table, sync)))
    }

    /// The maintain whose target is `table`, if `table` is an aggregate.
    pub fn maintain_for(&self, table: &str) -> Option<&Maintain> {
        self.maintains.iter().find(|maintain| maintain.target == table)
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
        RuleExpr::Exists { table: target, index: target_index, key, .. } if target == table && target_index == index => {
            key.iter().map(substitute).collect::<Option<Vec<_>>>().is_some_and(|key| key == probe_key)
        }
        RuleExpr::Deny | RuleExpr::Ne(_, _) | RuleExpr::Not(_) | RuleExpr::Exists { .. } | RuleExpr::Created { .. } => false,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Table {
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
}

impl ColumnType {
    pub fn required(&self) -> &ColumnType {
        match self {
            Self::Optional(inner) => inner,
            other => other,
        }
    }

    pub fn is_optional(&self) -> bool {
        matches!(self, Self::Optional(_))
    }

    pub fn is_indexable(&self) -> bool {
        match self {
            Self::Image { .. } | Self::Video { .. } | Self::List { .. } | Self::Json { .. } => false,
            Self::Optional(inner) => inner.is_indexable(),
            _ => true,
        }
    }

    pub fn contains_asset(&self) -> bool {
        match self {
            Self::Image { .. } | Self::Video { .. } => true,
            Self::Optional(inner) | Self::List { of: inner, .. } => inner.contains_asset(),
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

    /// The column names, in order. Word-prefix components (a Snapback 2
    /// search form this slice does not support) contribute nothing.
    pub fn columns(&self) -> Vec<String> {
        self.components.iter().filter_map(|c| c.column().cloned()).collect()
    }

    pub fn is_plain(&self) -> bool {
        self.components.iter().all(|c| matches!(c, IndexComponent::Column(_)))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum IndexComponent {
    Column(String),
    WordPrefixes { fields: Vec<String>, #[serde(default)] contract: serde_json::Value },
}

impl IndexComponent {
    pub fn column(&self) -> Option<&String> {
        match self {
            Self::Column(column) => Some(column),
            Self::WordPrefixes { .. } => None,
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
    And(Vec<RuleExpr>),
    Or(Vec<RuleExpr>),
    Not(Box<RuleExpr>),
    Exists { table: String, index: String, key: Vec<RuleTerm>, provenance: KeyProvenance },
    /// True only when the indexed target row was inserted earlier in this
    /// same transaction; insert rules only.
    Created { table: String, index: String, key: Vec<RuleTerm>, provenance: KeyProvenance },
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
            if let RuleTerm::Field(field) = term {
                out.insert(field.clone());
            }
        };
        match self {
            Self::Public { .. } | Self::Allow | Self::Deny => {}
            Self::Eq(left, right) | Self::Ne(left, right) => {
                term(left, out);
                term(right, out);
            }
            Self::And(items) | Self::Or(items) => items.iter().for_each(|item| item.fields(out)),
            Self::Not(inner) => inner.fields(out),
            Self::Exists { key, .. } | Self::Created { key, .. } => key.iter().for_each(|item| term(item, out)),
        }
    }

    /// The disjuncts of the rule: an `or` flattens, anything else is itself.
    pub fn disjuncts(&self) -> Vec<&RuleExpr> {
        match self {
            Self::Or(items) => items.iter().flat_map(|item| item.disjuncts()).collect(),
            other => vec![other],
        }
    }

    /// The rule as Quarry text, for diagnostics and rewrites.
    pub fn quarry(&self) -> String {
        fn term(term: &RuleTerm) -> String {
            match term {
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
            Self::Ne(l, r) => format!("{} != {}", term(l), term(r)),
            Self::And(items) => items.iter().map(|i| i.quarry()).collect::<Vec<_>>().join(" and "),
            Self::Or(items) => items.iter().map(|i| i.quarry()).collect::<Vec<_>>().join(" or "),
            Self::Not(inner) => format!("not ({})", inner.quarry()),
            Self::Exists { table, key, .. } => format!("exists {table}[{}]", key.iter().map(term).collect::<Vec<_>>().join(", ")),
            Self::Created { table, key, .. } => format!("created {table}[{}]", key.iter().map(term).collect::<Vec<_>>().join(", ")),
        }
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

/// A table with public rules, for fixtures and tests.
pub fn public_table(columns: BTreeMap<String, ColumnType>, indexes: BTreeMap<String, Index>) -> Table {
    let public = RuleExpr::Public { reason: "fixture".to_owned() };
    Table {
        columns,
        indexes,
        rules: Rules { read: public.clone(), insert: public.clone(), update: public.clone(), delete: public },
        constraints: Vec::new(),
        leave: LeavePolicy::default(),
        sync: None,
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
    let mut issues = Vec::new();
    let issue = |issues: &mut Vec<SchemaIssue>, path: String, message: String| issues.push(SchemaIssue { path, message });
    for (table_name, table) in &schema.tables {
        let path = format!("tables.{table_name}");
        if table.columns.get("id") != Some(&ColumnType::Id) {
            issue(&mut issues, format!("{path}.columns.id"), "every table has an intrinsic id column".into());
        }
        match table.indexes.get(BY_ID) {
            Some(index) if index.unique && index.columns() == ["id"] => {}
            _ => issue(&mut issues, format!("{path}.indexes.{BY_ID}"), "every table has the intrinsic unique byId index".into()),
        }
        for (name, index) in &table.indexes {
            let ipath = format!("{path}.indexes.{name}");
            if index.components.is_empty() || index.components.len() > 8 {
                issue(&mut issues, ipath.clone(), "declare between 1 and 8 components".into());
            }
            let mut seen = BTreeSet::new();
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
                    IndexComponent::WordPrefixes { .. } => issue(&mut issues, ipath.clone(), "word-prefix indexes are not in this slice".into()),
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
                    if by.is_empty() || *max == 0 {
                        issue(&mut issues, cpath.clone(), "cap needs at least one column and a positive maximum".into());
                    }
                    for column in by {
                        if !table.columns.contains_key(column) {
                            issue(&mut issues, cpath.clone(), format!("cap names undeclared column {column}"));
                        }
                    }
                    if !table.indexes.values().any(|index| index.columns().starts_with(by)) {
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
                    match schema.table(target).and_then(|t| t.index(index)) {
                        Some(target_index) if target_index.columns().len() == key.len() => {}
                        Some(_) => issue(&mut issues, cpath, "after insert key arity does not match the index".into()),
                        None => issue(&mut issues, cpath, format!("after insert names unknown {target}.{index}")),
                    }
                }
                Constraint::AppendOnly => {}
            }
        }
        if let Some(sync) = &table.sync {
            validate_sync(schema, table_name, table, sync, &format!("{path}.sync"), &mut issues);
        }
    }
    for (position, maintain) in schema.maintains.iter().enumerate() {
        validate_maintain(schema, position, maintain, &mut issues);
    }
    issues
}

fn validate_rule(schema: &Schema, table: &Table, rule: &RuleExpr, update: bool, insert: bool, path: &str, issues: &mut Vec<SchemaIssue>) {
    let check_term = |term: &RuleTerm, issues: &mut Vec<SchemaIssue>| match term {
        RuleTerm::Field(field) => {
            if !table.columns.contains_key(field) {
                issues.push(SchemaIssue { path: path.to_owned(), message: format!("rule reads undeclared column {field}") });
            }
        }
        RuleTerm::OldField(field) | RuleTerm::NextField(field) => {
            if !update {
                issues.push(SchemaIssue { path: path.to_owned(), message: "old and next images exist only in update rules".into() });
            } else if !table.columns.contains_key(field) {
                issues.push(SchemaIssue { path: path.to_owned(), message: format!("rule reads undeclared column {field}") });
            }
        }
        RuleTerm::Viewer | RuleTerm::Literal(_) => {}
    };
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => {}
        RuleExpr::Eq(l, r) | RuleExpr::Ne(l, r) => {
            check_term(l, issues);
            check_term(r, issues);
        }
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().for_each(|item| validate_rule(schema, table, item, update, insert, path, issues)),
        RuleExpr::Not(inner) => validate_rule(schema, table, inner, update, insert, path, issues),
        RuleExpr::Exists { table: target, index, key, .. } | RuleExpr::Created { table: target, index, key, .. } => {
            if matches!(rule, RuleExpr::Created { .. }) && !insert {
                issues.push(SchemaIssue { path: path.to_owned(), message: "created probes are valid only in insert rules".into() });
            }
            match schema.table(target).and_then(|t| t.index(index)) {
                Some(target_index) => {
                    if target_index.columns().len() != key.len() {
                        issues.push(SchemaIssue { path: path.to_owned(), message: format!("probe of {target}.{index} has {} terms; the index has {}", key.len(), target_index.columns().len()) });
                    }
                }
                None => issues.push(SchemaIssue { path: path.to_owned(), message: format!("rule probes unknown {target}.{index}") }),
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
    if maintain.by.is_empty() {
        issue(issues, "maintain by needs at least one source column".into());
    }
    for field in &maintain.by {
        match source.columns.get(field) {
            None => issue(issues, format!("maintain names unknown source column {}.{field}", maintain.source)),
            Some(kind) if target.columns.get(field) != Some(kind) => issue(issues, format!("maintain target column {field} must match the source type {kind}")),
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
    let allowed: BTreeSet<&str> = ["id", "value"].into_iter().chain(maintain.by.iter().map(String::as_str)).collect();
    let extra: Vec<_> = target.columns.keys().filter(|c| !allowed.contains(c.as_str())).cloned().collect();
    if !extra.is_empty() {
        issue(issues, format!("maintain target {} has non-aggregate columns {}", maintain.target, extra.join(", ")));
    }
    if !target.indexes.values().any(|index| index.unique && index.columns() == maintain.by) {
        issue(issues, format!("maintain target {} needs a unique index over {}", maintain.target, maintain.by.join(", ")));
    }
}

/// Why a `sync` line cannot be honoured, as the term the author must change.
fn validate_sync(schema: &Schema, table_name: &str, table: &Table, sync: &Sync, path: &str, issues: &mut Vec<SchemaIssue>) {
    let issue = |issues: &mut Vec<SchemaIssue>, message: String| issues.push(SchemaIssue { path: path.to_owned(), message });
    match &sync.audience {
        Audience::Public => {
            if !table.rules.read.is_uniformly_readable() {
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
            if !table.rules.read.disjuncts().iter().any(|d| **d == implied || **d == implied_flipped) && !table.rules.read.is_uniformly_readable() {
                issue(issues, format!("sync to .{column} is only sound when the read rule has the disjunct `.{column} = viewer`; it reads under `{}`", table.rules.read.quarry()));
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
            let mut want = prefix.iter().map(|column| RuleTerm::Field(column.clone())).collect::<Vec<_>>();
            want.push(RuleTerm::Viewer);
            for column in prefix {
                if !table.columns.contains_key(column) {
                    issue(issues, format!("sync to {target_name}[.{column}] names an undeclared column of {table_name}"));
                }
            }
            // The audience index: the target's columns for the prefix, then the principal.
            let Some(audience_columns) = target_prefix_columns(table_name, table, target, prefix, principal) else {
                issue(issues, format!("sync to {target_name}[{}]: {target_name} has no column matching {} (same name and type, or one reference to the same table)", prefix.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", "), prefix.iter().map(|c| format!("{table_name}.{c}")).collect::<Vec<_>>().join(", ")));
                return;
            };
            let mut wanted_index = audience_columns.clone();
            wanted_index.push(principal.clone());
            if !target.indexes.values().any(|index| index.columns() == wanted_index) {
                issue(issues, format!("sync to {target_name}[{}] needs an index on {target_name} over {}", prefix.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", "), wanted_index.join(", ")));
            }
            let mut wanted_by_principal = vec![principal.clone()];
            wanted_by_principal.extend(audience_columns.iter().cloned());
            if !target.indexes.values().any(|index| index.columns().starts_with(&wanted_by_principal)) {
                issue(issues, format!("sync to {target_name}[..] needs an index on {target_name} whose leading columns are {} so a device can find its groups", wanted_by_principal.join(", ")));
            }
            if !table.rules.read.is_uniformly_readable() {
                let sound = table.rules.read.disjuncts().iter().any(|d| match d {
                    RuleExpr::Exists { table: t, key, .. } => t == target_name && *key == want,
                    _ => false,
                });
                if !sound {
                    issue(issues, format!("sync to {target_name}[{}] is only sound when the read rule has the disjunct `exists {target_name}[{}]`; it reads under `{}`", prefix.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", "), want.iter().map(|t| match t { RuleTerm::Field(f) => format!(".{f}"), _ => "viewer".into() }).collect::<Vec<_>>().join(", "), table.rules.read.quarry()));
                }
            }
        }
    }
    if let Some(horizon) = &sync.horizon {
        match table.index(&horizon.by) {
            None => issue(issues, format!("horizon names unknown index {table_name}.{}", horizon.by)),
            Some(index) => {
                let group: Vec<String> = match &sync.audience {
                    Audience::Public => Vec::new(),
                    Audience::Column(column) => vec![column.clone()],
                    Audience::Target { prefix, .. } => prefix.clone(),
                };
                if !index.columns().starts_with(&group) {
                    issue(issues, format!("horizon index {} must lead with the audience columns {}", horizon.by, group.join(", ")));
                }
                if horizon.last == 0 {
                    issue(issues, "a horizon keeps at least one row".into());
                }
            }
        }
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

/// Optional columns absent from a stored image read as `null`.
pub fn materialize_optional_fields(row: &mut Value, table: &Table) {
    let fields = match row {
        Value::Row(fields) | Value::Map(fields) => fields,
        _ => return,
    };
    for (name, kind) in &table.columns {
        if kind.is_optional() && !fields.contains_key(name) {
            fields.insert(name.clone(), Value::Null);
        }
    }
}

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
        ArgType::Enum { variants } => ColumnType::Enum { variants: variants.clone() },
        ArgType::Decimal { scale } => ColumnType::Decimal { scale: *scale },
        ArgType::Money { currency, scale } => ColumnType::Money { currency: currency.clone(), scale: *scale },
    })
}
