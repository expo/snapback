//! Static availability of a maintained point's scalar result.

use super::*;
use std::collections::{BTreeMap, BTreeSet};

pub(super) const AUTHORIZATION: &str = "$maintainAuthorization";

impl Binder<'_> {
    /// A private maintained point is nullable: authorization may withhold a
    /// stored value and the logical zero alike. Keep the numeric type required
    /// only when the key or a surviving guard proves the view's read rule.
    // @ref LLP 3000.013#14.7 — hidden maintained hits and misses are null;
    // an admitted miss alone becomes the aggregate identity.
    pub(super) fn maintained_result_type(
        &self,
        maintain: &ast::MaintainDecl,
        read: &ReadExpr,
        ty: Ty,
    ) -> Ty {
        if self.caller_kind == ProgramKind::Job
            || self
                .schema
                .table(&read.table)
                .is_some_and(|table| table.rules.read.is_uniformly_readable())
        {
            return ty;
        }
        let Some(expected) = substituted_rule(maintain, read) else {
            return ty.optional();
        };
        if self.condition_known(&expected, true) || self.authorization_holds(&expected, true) {
            ty
        } else {
            ty.optional()
        }
    }

    /// Store a truth fact on every lexical root it depends on. Existing branch
    /// intersection and rebinding logic then keeps exactly the facts that
    /// survive control flow and clears facts whose operands change.
    pub(super) fn record_maintain_authorization(&mut self, condition: &A, truth: bool) {
        let Some((key, roots)) = self.authorization_key(condition, truth) else {
            return;
        };
        for root in roots {
            let Some(mut binding) = self.binding(&root).cloned() else {
                return;
            };
            binding.fields.insert(key.clone(), Ty::Bool);
            self.scopes
                .last_mut()
                .expect("a scope")
                .insert(root, binding);
        }
    }

    fn authorization_holds(&self, condition: &A, truth: bool) -> bool {
        self.authorization_key(condition, truth)
            .is_some_and(|(key, roots)| {
                roots.iter().all(|root| {
                    self.binding(root)
                        .is_some_and(|binding| binding.fields.get(&key) == Some(&Ty::Bool))
                })
            })
    }

    fn authorization_key(
        &self,
        condition: &A,
        truth: bool,
    ) -> Option<(Vec<String>, BTreeSet<String>)> {
        let mut roots = BTreeSet::new();
        let key = self.condition_identity(condition, truth, &mut roots)?;
        if roots.is_empty() {
            roots.insert(pure_calls::CONSTANTS.to_owned());
        }
        Some((vec![AUTHORIZATION.into(), key], roots))
    }

    fn condition_identity(
        &self,
        condition: &A,
        truth: bool,
        roots: &mut BTreeSet<String>,
    ) -> Option<String> {
        match condition {
            A::Unary { op, value, .. } if op == "not" => {
                self.condition_identity(value, !truth, roots)
            }
            A::Binary {
                op, left, right, ..
            } if matches!(op.as_str(), "=" | "!=") => {
                let mut operands = [
                    self.value_identity(left, roots)?,
                    self.value_identity(right, roots)?,
                ];
                operands.sort();
                let equal = (op == "=") == truth;
                Some(format!("compare:{equal}:{:?}", operands))
            }
            _ => Some(format!(
                "truth:{truth}:{}",
                self.value_identity(condition, roots)?
            )),
        }
    }

    fn value_identity(&self, value: &A, roots: &mut BTreeSet<String>) -> Option<String> {
        match value {
            A::Name { name, .. }
                if matches!(
                    name.as_str(),
                    "allow" | "public" | "true" | "deny" | "false"
                ) =>
            {
                Some(format!("bool:{name}"))
            }
            A::Unary { op, value, .. } => {
                Some(format!("unary:{op}:{}", self.value_identity(value, roots)?))
            }
            A::Binary {
                op, left, right, ..
            } => Some(format!(
                "binary:{op}:{}:{}",
                self.value_identity(left, roots)?,
                self.value_identity(right, roots)?
            )),
            A::Exists { read, .. } => self.read_identity("exists", read, roots),
            A::Created { read, .. } => self.read_identity("created", read, roots),
            _ => self.stable_value(value, roots).map(|value| value.key()),
        }
    }

    fn read_identity(
        &self,
        kind: &str,
        read: &ReadExpr,
        roots: &mut BTreeSet<String>,
    ) -> Option<String> {
        if read.range.is_some()
            || read.matching.is_some()
            || read.filter.is_some()
            || !read.seeks.is_empty()
        {
            return None;
        }
        let keys = read
            .keys
            .iter()
            .map(|key| {
                Some(format!(
                    "{:?}:{}",
                    key.column,
                    self.value_identity(&key.value, roots)?
                ))
            })
            .collect::<Option<Vec<_>>>()?;
        Some(format!("{kind}:{:?}:{:?}:{keys:?}", read.table, read.index))
    }

    fn condition_known(&self, condition: &A, truth: bool) -> bool {
        match condition {
            A::Name { name, .. } if matches!(name.as_str(), "allow" | "public" | "true") => truth,
            A::Name { name, .. } if matches!(name.as_str(), "deny" | "false") => !truth,
            A::Literal {
                value: Literal::Bool(value),
                ..
            } => *value == truth,
            A::Unary { op, value, .. } if op == "not" => self.condition_known(value, !truth),
            A::Binary {
                op, left, right, ..
            } if op == "and" && truth => {
                self.condition_known(left, true) && self.condition_known(right, true)
            }
            A::Binary {
                op, left, right, ..
            } if op == "or" && truth => {
                self.condition_known(left, true) || self.condition_known(right, true)
            }
            A::Binary {
                op, left, right, ..
            } if matches!(op.as_str(), "=" | "!=") => {
                let mut roots = BTreeSet::new();
                let same = self
                    .value_identity(left, &mut roots)
                    .zip(self.value_identity(right, &mut roots))
                    .is_some_and(|(left, right)| left == right);
                same && ((op == "=") == truth)
            }
            _ => false,
        }
    }
}

fn substituted_rule(maintain: &ast::MaintainDecl, read: &ReadExpr) -> Option<A> {
    let rule = maintain.read.as_ref()?;
    if maintain.by.len() != read.keys.len() {
        return None;
    }
    let mut keys: BTreeMap<String, A> = maintain
        .by
        .iter()
        .map(|field| field.trim_start_matches('.').to_owned())
        .zip(read.keys.iter().map(|key| key.value.clone()))
        .collect();
    for key in &read.keys {
        if let Some(column) = &key.column {
            keys.insert(column.clone(), key.value.clone());
        }
    }
    let mut expected = rule.value.clone();
    super::super::intent_walk::expression(&mut expected, &mut |expr| {
        if let A::Member { base, name, .. } = expr
            && matches!(base.as_ref(), A::Focal { .. })
            && let Some(value) = keys.get(name)
        {
            *expr = value.clone();
        }
    });
    Some(expected)
}
