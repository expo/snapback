use crate::ir::{ArgType, KeyProvenance};
use crate::value::{Value, digest};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

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
        prove_probe_row_readable(
            &table.rules.read,
            table_name,
            index_name,
            &index.columns,
            key,
        )
    }

    /// Proves that every row in an indexed prefix receives the same read
    /// verdict. Every row field consulted by the rule, including fields used
    /// to form an indexed rule probe, must be fixed by that prefix.
    pub fn read_is_uniform_for_prefix(
        &self,
        table_name: &str,
        index_name: &str,
        prefix_len: usize,
    ) -> bool {
        let Some(table) = self.table(table_name) else {
            return false;
        };
        let Some(index) = table.index(index_name) else {
            return false;
        };
        let pinned: BTreeSet<_> = index.columns.iter().take(prefix_len).cloned().collect();
        let mut used = BTreeSet::new();
        table.rules.read.row_fields(&mut used);
        used.is_subset(&pinned)
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
}

impl Table {
    pub fn index(&self, name: &str) -> Option<&Index> {
        self.indexes.get(name)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ColumnType {
    Id,
    // @ref LLP 1001#6-identity-identityrs — Schema principals stay nominal while v1 encodes them as Value::Id.
    Principal,
    Text { max: u32 },
    // @ref LLP 1001#9-schema-additions — bytes use the value model's canonical lowercase-base16 wrapper.
    Bytes { max: u32 },
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

    fn row_fields(&self, out: &mut BTreeSet<String>) {
        match self {
            Self::Eq(a, b) | Self::Ne(a, b) => {
                for term in [a, b] {
                    match term {
                        RuleTerm::Field(name) => {
                            out.insert(name.clone());
                        }
                        RuleTerm::OldField(name) | RuleTerm::NextField(name) => {
                            out.insert(format!("\0invalid-update-field:{name}"));
                        }
                        RuleTerm::Viewer | RuleTerm::Literal(_) => {}
                    }
                }
            }
            Self::Exists { key, .. } | Self::Created { key, .. } => {
                for term in key {
                    match term {
                        RuleTerm::Field(name) => {
                            out.insert(name.clone());
                        }
                        RuleTerm::OldField(name) | RuleTerm::NextField(name) => {
                            out.insert(format!("\0invalid-update-field:{name}"));
                        }
                        RuleTerm::Viewer | RuleTerm::Literal(_) => {}
                    }
                }
            }
            Self::And(rules) | Self::Or(rules) => {
                for rule in rules {
                    rule.row_fields(out);
                }
            }
            Self::Not(rule) => rule.row_fields(out),
            Self::Public { .. } | Self::Allow | Self::Deny => {}
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
