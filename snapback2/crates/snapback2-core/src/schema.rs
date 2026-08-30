use crate::ir::{ArgType, KeyProvenance};
use crate::value::{Value, digest};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Schema {
    pub tables: BTreeMap<String, Table>,
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
        // @ref LLP 0331#amendment-to-ruling-0-ruled-2026-08-30 — authored
        // rules no longer carry input visibility. Preserve the frozen S1
        // certificate hash shape while deriving that legacy projection from
        // the referenced table policy.
        digest(&HashSchema::from(self))
    }

    pub fn rule_hash(&self, rule: &RuleExpr) -> String {
        digest(&HashRuleExpr::from_rule(rule, self))
    }

    pub fn table(&self, name: &str) -> Option<&Table> {
        self.tables.get(name)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Table {
    pub columns: BTreeMap<String, ColumnType>,
    pub indexes: BTreeMap<String, Index>,
    pub rules: Rules,
    #[serde(default)]
    pub constraints: Vec<Constraint>,
}

impl Table {
    pub fn index(&self, name: &str) -> Option<&Index> {
        self.indexes.get(name)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ColumnType {
    Id,
    Text { max: u32 },
    Int,
    // @ref LLP 1001#9-schema-additions — enum and fixed-scale columns keep scalar storage keys.
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
    pub(crate) fn contains_list(&self) -> bool {
        match self {
            Self::List { .. } => true,
            Self::Optional(inner) => inner.contains_list(),
            _ => false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Index {
    pub columns: Vec<String>,
    pub unique: bool,
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
}

impl RuleExpr {
    pub fn is_public(&self) -> bool {
        matches!(self, Self::Public { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleTerm {
    Field(String),
    Viewer,
    Literal(Value),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Constraint {
    Unique { index: String },
    Cap { by: Vec<String>, max: u32 },
    AppendOnly,
    Immutable { fields: Vec<String> },
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
    }
}

#[derive(Serialize)]
struct HashSchema {
    tables: BTreeMap<String, HashTable>,
    maintains: Vec<HashMaintain>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    channels: BTreeMap<String, HashChannel>,
    #[serde(default, skip_serializing_if = "Auth::is_default")]
    auth: Auth,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    effects: Vec<String>,
}

impl From<&Schema> for HashSchema {
    fn from(schema: &Schema) -> Self {
        Self {
            tables: schema
                .tables
                .iter()
                .map(|(name, table)| (name.clone(), HashTable::from_table(table, schema)))
                .collect(),
            maintains: schema
                .maintains
                .iter()
                .map(|maintain| HashMaintain::from_maintain(maintain, schema))
                .collect(),
            channels: schema
                .channels
                .iter()
                .map(|(name, channel)| (name.clone(), HashChannel::from_channel(channel, schema)))
                .collect(),
            auth: schema.auth.clone(),
            effects: schema.effects.clone(),
        }
    }
}

#[derive(Serialize)]
struct HashTable {
    columns: BTreeMap<String, ColumnType>,
    indexes: BTreeMap<String, Index>,
    rules: HashRules,
    constraints: Vec<Constraint>,
}

impl HashTable {
    fn from_table(table: &Table, schema: &Schema) -> Self {
        Self {
            columns: table.columns.clone(),
            indexes: table.indexes.clone(),
            rules: HashRules::from_rules(&table.rules, schema),
            constraints: table.constraints.clone(),
        }
    }
}

#[derive(Serialize)]
struct HashRules {
    read: HashRuleExpr,
    insert: HashRuleExpr,
    update: HashRuleExpr,
    delete: HashRuleExpr,
}

impl HashRules {
    fn from_rules(rules: &Rules, schema: &Schema) -> Self {
        Self {
            read: HashRuleExpr::from_rule(&rules.read, schema),
            insert: HashRuleExpr::from_rule(&rules.insert, schema),
            update: HashRuleExpr::from_rule(&rules.update, schema),
            delete: HashRuleExpr::from_rule(&rules.delete, schema),
        }
    }
}

#[derive(Serialize)]
enum HashRuleExpr {
    Public {
        reason: String,
    },
    Allow,
    Deny,
    Eq(RuleTerm, RuleTerm),
    Ne(RuleTerm, RuleTerm),
    And(Vec<HashRuleExpr>),
    Or(Vec<HashRuleExpr>),
    Not(Box<HashRuleExpr>),
    Exists {
        table: String,
        index: String,
        key: Vec<RuleTerm>,
        provenance: KeyProvenance,
        input_visibility: HashInputVisibility,
    },
}

impl HashRuleExpr {
    fn from_rule(rule: &RuleExpr, schema: &Schema) -> Self {
        match rule {
            RuleExpr::Public { reason } => Self::Public {
                reason: reason.clone(),
            },
            RuleExpr::Allow => Self::Allow,
            RuleExpr::Deny => Self::Deny,
            RuleExpr::Eq(left, right) => Self::Eq(left.clone(), right.clone()),
            RuleExpr::Ne(left, right) => Self::Ne(left.clone(), right.clone()),
            RuleExpr::And(rules) => Self::And(
                rules
                    .iter()
                    .map(|rule| Self::from_rule(rule, schema))
                    .collect(),
            ),
            RuleExpr::Or(rules) => Self::Or(
                rules
                    .iter()
                    .map(|rule| Self::from_rule(rule, schema))
                    .collect(),
            ),
            RuleExpr::Not(rule) => Self::Not(Box::new(Self::from_rule(rule, schema))),
            RuleExpr::Exists {
                table,
                index,
                key,
                provenance,
            } => Self::Exists {
                table: table.clone(),
                index: index.clone(),
                key: key.clone(),
                provenance: *provenance,
                input_visibility: HashInputVisibility::for_table(schema, table),
            },
        }
    }
}

#[derive(Serialize)]
enum HashInputVisibility {
    Readable,
    Hidden,
}

impl HashInputVisibility {
    fn for_table(schema: &Schema, table: &str) -> Self {
        if schema
            .table(table)
            .is_some_and(|table| matches!(table.rules.read, RuleExpr::Deny))
        {
            Self::Hidden
        } else {
            Self::Readable
        }
    }
}

#[derive(Serialize)]
struct HashMaintain {
    kind: MaintainKind,
    source: String,
    by: Vec<String>,
    target: String,
    readable: Option<HashRuleExpr>,
}

impl HashMaintain {
    fn from_maintain(maintain: &Maintain, schema: &Schema) -> Self {
        Self {
            kind: maintain.kind.clone(),
            source: maintain.source.clone(),
            by: maintain.by.clone(),
            target: maintain.target.clone(),
            readable: maintain
                .readable
                .as_ref()
                .map(|rule| HashRuleExpr::from_rule(rule, schema)),
        }
    }
}

#[derive(Serialize)]
struct HashChannel {
    args: BTreeMap<String, ArgType>,
    publish: HashRuleExpr,
    subscribe: HashRuleExpr,
    ttl_ms: u32,
}

impl HashChannel {
    fn from_channel(channel: &Channel, schema: &Schema) -> Self {
        Self {
            args: channel.args.clone(),
            publish: HashRuleExpr::from_rule(&channel.publish, schema),
            subscribe: HashRuleExpr::from_rule(&channel.subscribe, schema),
            ttl_ms: channel.ttl_ms,
        }
    }
}
