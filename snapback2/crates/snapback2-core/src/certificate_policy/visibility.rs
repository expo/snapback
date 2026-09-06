//! Prefix-local visibility proofs; the table policy itself is never changed.
use crate::ir::{Expr, Input, Scan};
use crate::schema::{ColumnType, RuleExpr, RuleTerm, Schema, Table};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(crate) struct Visibility {
    pub uniform: bool,
    pub decided_true: bool,
}

pub(crate) fn uniform_visibility(schema: &Schema, scan: &Scan) -> bool {
    scan_visibility(schema, scan).uniform
}

// @ref LLP 1001#3-read-and-write-states-no-silent-states — a self-key probe or a
// decided disjunct needs no runtime verdict; pinnedness alone still needs one.
pub(crate) fn scan_visibility(schema: &Schema, scan: &Scan) -> Visibility {
    let Some(table) = schema.table(&scan.table) else {
        return Visibility::default();
    };
    let Some(index) = table.index(&scan.index) else {
        return Visibility::default();
    };
    // Column names let a differently ordered probe unique index resolve the same pins.
    let pinned: BTreeMap<_, _> = index.columns.iter().zip(&scan.prefix).collect();
    let decided_true = rule_true(&table.rules.read, &scan.table, table, &pinned);
    let mut used = BTreeSet::new();
    rule_fields(&table.rules.read, &mut used);
    Visibility {
        uniform: decided_true || used.iter().all(|field| pinned.contains_key(field)),
        decided_true,
    }
}

fn pinned_term(term: &RuleTerm, expression: &Expr) -> bool {
    match (term, expression) {
        (RuleTerm::Viewer, Expr::Input(Input::Viewer)) => true,
        (RuleTerm::Literal(left), Expr::Literal(right)) => left == right,
        _ => false,
    }
}

fn rule_true(
    rule: &RuleExpr,
    table_name: &str,
    table: &Table,
    pinned: &BTreeMap<&String, &Expr>,
) -> bool {
    match rule {
        RuleExpr::Allow | RuleExpr::Public { .. } => true,
        RuleExpr::Eq(left, right) => [(left, right), (right, left)].iter().any(|(field, value)| {
            let RuleTerm::Field(column) = field else {
                return false;
            };
            pinned
                .get(column)
                .is_some_and(|expression| pinned_term(value, expression))
        }),
        RuleExpr::Or(rules) => rules
            .iter()
            .any(|rule| rule_true(rule, table_name, table, pinned)),
        RuleExpr::Exists {
            table: target,
            index,
            key,
            ..
        } if target == table_name => {
            let Some(index) = table.index(index) else {
                return false;
            };
            index.unique
                && !key.is_empty()
                && key.len() == index.columns.len()
                && index.columns.iter().zip(key).all(|(column, term)| {
                    // Optional nulls have no point-hit witness. Do not infer this
                    // from a non-null prefix: the unique key itself must be total.
                    table
                        .columns
                        .get(column)
                        .is_some_and(|ty| !matches!(ty, ColumnType::Optional(_)))
                        && match term {
                            RuleTerm::Field(field) => field == column,
                            _ => pinned
                                .get(column)
                                .is_some_and(|expression| pinned_term(term, expression)),
                        }
                })
        }
        _ => false,
    }
}

pub(super) fn rule_fields(rule: &RuleExpr, out: &mut BTreeSet<String>) {
    match rule {
        RuleExpr::Eq(left, right) | RuleExpr::Ne(left, right) => {
            for term in [left, right] {
                if let RuleTerm::Field(name) = term {
                    out.insert(name.clone());
                }
            }
        }
        RuleExpr::Exists { key, .. } | RuleExpr::Created { key, .. } => {
            for term in key {
                if let RuleTerm::Field(name) = term {
                    out.insert(name.clone());
                }
            }
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => {
            rules.iter().for_each(|rule| rule_fields(rule, out));
        }
        RuleExpr::Not(rule) => rule_fields(rule, out),
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => {}
    }
}
