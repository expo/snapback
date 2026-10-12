//! Static availability of a maintained point's scalar result.

use super::*;
use std::collections::{BTreeMap, BTreeSet};
use snapback4_core::schema::RuleTerm;

pub(super) const AUTHORIZATION: &str = "$maintainAuthorization";
const TARGET_ROW: &str = "$maintainTarget";

#[derive(Clone, Copy, Debug)]
enum AuthorizationDomain {
    /// Program `exists` observes only rows readable by the current viewer.
    Program,
    /// A table rule's witness tests raw row presence below the target rule.
    Rule,
}

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
        if !self.maintained_parent_is_live(maintain, read) {
            return ty.optional();
        }
        if (self.caller_kind == ProgramKind::Job && self.viewer_depth.is_none())
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
        if self.authorization_proved(&expected, true) {
            ty
        } else {
            ty.optional()
        }
    }

    /// A system job bypasses read policy, but an inherited maintained point
    /// still disappears with its through parent. A dominating exact-point
    /// witness or the live parent row supplying `.id` proves that lifetime.
    fn maintained_parent_is_live(&self, maintain: &ast::MaintainDecl, read: &ReadExpr) -> bool {
        let Some(parent) = self.schema.maintain_for(&read.table).and_then(|maintain| maintain.parent_key.as_ref()) else { return true };
        let Some(key) = group_keys(maintain, read).remove(&parent.reference) else { return false };
        let site = key.site().clone();
        self.point_present(&ReadExpr {
            cursor_prefix: None, computed: Default::default(), order_keys: Vec::new(), table: parent.parent.clone(),
            keys: vec![ast::KeyPart { column: None, value: key, site: site.clone() }], seeks: Vec::new(), filter: None,
            index: None, range: None, matching: None, site,
        })
    }

    /// Store a truth fact on every lexical root it depends on. Existing branch
    /// intersection and rebinding logic then keeps exactly the facts that
    /// survive control flow and clears facts whose operands change.
    pub(super) fn record_maintain_authorization(&mut self, condition: &A, truth: bool) {
        let Some((key, roots)) = self.authorization_key(condition, truth, AuthorizationDomain::Program) else {
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
        self.authorization_key(condition, truth, AuthorizationDomain::Rule)
            .is_some_and(|(key, roots)| {
                roots.iter().all(|root| {
                    self.binding(root)
                        .is_some_and(|binding| binding.fields.get(&key) == Some(&Ty::Bool))
                })
            })
    }

    /// Facts may prove a read rule without restating the whole expression:
    /// one admitted disjunct proves an `or`, while every conjunct proves an
    /// `and`. This is the same propositional narrowing used by control flow.
    fn authorization_proved(&self, condition: &A, truth: bool) -> bool {
        if self.condition_known(condition, truth) || self.authorization_holds(condition, truth) {
            return true;
        }
        match condition {
            A::Unary { op, value, .. } if op == "not" => self.authorization_proved(value, !truth),
            A::Binary {
                op, left, right, ..
            } if op == "and" && truth => {
                self.authorization_proved(left, true) && self.authorization_proved(right, true)
            }
            A::Binary {
                op, left, right, ..
            } if op == "and" => {
                self.authorization_proved(left, false) || self.authorization_proved(right, false)
            }
            A::Binary {
                op, left, right, ..
            } if op == "or" && truth => {
                self.authorization_proved(left, true) || self.authorization_proved(right, true)
            }
            A::Binary {
                op, left, right, ..
            } if op == "or" => {
                self.authorization_proved(left, false) && self.authorization_proved(right, false)
            }
            _ => false,
        }
    }

    fn authorization_key(
        &self,
        condition: &A,
        truth: bool,
        domain: AuthorizationDomain,
    ) -> Option<(Vec<String>, BTreeSet<String>)> {
        let mut roots = BTreeSet::new();
        let key = self.condition_identity(condition, truth, domain, &mut roots)?;
        if roots.is_empty() {
            roots.insert(pure_calls::CONSTANTS.to_owned());
        }
        Some((vec![AUTHORIZATION.into(), key], roots))
    }

    fn condition_identity(
        &self,
        condition: &A,
        truth: bool,
        domain: AuthorizationDomain,
        roots: &mut BTreeSet<String>,
    ) -> Option<String> {
        match condition {
            A::Unary { op, value, .. } if op == "not" => {
                self.condition_identity(value, !truth, domain, roots)
            }
            A::Exists { read, .. } => {
                let raw = matches!(domain, AuthorizationDomain::Rule)
                    || truth
                    || self.program_absence_is_raw(read);
                let identity = self.read_identity("exists", if raw { "raw" } else { "readable" }, read, roots)?;
                Some(format!("truth:{truth}:{identity}"))
            }
            A::Created { read, .. } => {
                let identity = self.read_identity("created", "raw", read, roots)?;
                Some(format!("truth:{truth}:{identity}"))
            }
            A::Binary {
                op, left, right, ..
            } if matches!(op.as_str(), "=" | "!=") => {
                let mut operands = [
                    self.value_identity(left, domain, roots)?,
                    self.value_identity(right, domain, roots)?,
                ];
                operands.sort();
                let equal = (op == "=") == truth;
                Some(format!("compare:{equal}:{:?}", operands))
            }
            _ => Some(format!(
                "truth:{truth}:{}",
                self.value_identity(condition, domain, roots)?
            )),
        }
    }

    fn value_identity(&self, value: &A, domain: AuthorizationDomain, roots: &mut BTreeSet<String>) -> Option<String> {
        match value {
            A::Unary { op, value, .. } => {
                Some(format!("unary:{op}:{}", self.value_identity(value, domain, roots)?))
            }
            A::Binary {
                op, left, right, ..
            } => Some(format!(
                "binary:{op}:{}:{}",
                self.value_identity(left, domain, roots)?,
                self.value_identity(right, domain, roots)?
            )),
            // Nested witnesses have no known polarity. Keep their observable
            // program domain separate from the raw witness used by a rule.
            A::Exists { read, .. } => self.read_identity("exists", match domain {
                AuthorizationDomain::Program => "readable",
                AuthorizationDomain::Rule => "raw",
            }, read, roots),
            A::Created { read, .. } => self.read_identity("created", "raw", read, roots),
            _ => self.stable_value(value, roots).map(|value| value.key()),
        }
    }

    fn read_identity(
        &self,
        kind: &str,
        domain: &str,
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
                    self.value_identity(&key.value, AuthorizationDomain::Rule, roots)?
                ))
            })
            .collect::<Option<Vec<_>>>()?;
        Some(format!("{kind}:{domain}:{:?}:{:?}:{keys:?}", read.table, read.index))
    }

    /// A negative program existence test establishes raw absence only when
    /// every row selected by its complete point key is structurally readable.
    fn program_absence_is_raw(&self, read: &ReadExpr) -> bool {
        if self.caller_kind == ProgramKind::Job && self.viewer_depth.is_none() {
            return true;
        }
        program_absence_is_raw(self.schema, read)
    }

    fn condition_known(&self, condition: &A, truth: bool) -> bool {
        match condition {
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
                    .value_identity(left, AuthorizationDomain::Rule, &mut roots)
                    .zip(self.value_identity(right, AuthorizationDomain::Rule, &mut roots))
                    .is_some_and(|(left, right)| left == right);
                same && ((op == "=") == truth)
            }
            _ => false,
        }
    }
}

/// Whether an authorized program miss is also a raw miss for the complete
/// point key. Shared with the matching authoring note so type and lint facts
/// use one witness-domain boundary.
pub(in crate::bind) fn program_absence_is_raw(
    schema: &snapback4_core::schema::Schema,
    read: &ReadExpr,
) -> bool {
    let Some(table) = schema.table(&read.table) else { return false };
    // A through child inherits its parent's visibility outside the child's
    // compiled rule. A raw rule witness can still see the live child.
    if table.through.is_some() { return false; }
    if table.rules.read.is_uniformly_readable() { return true; }
    if read.range.is_some() || read.matching.is_some() || read.filter.is_some() || !read.seeks.is_empty() {
        return false;
    }
    let term = |value: &A| match value {
        A::Name { name, .. } if name == "viewer" => Some(RuleTerm::Viewer),
        A::Literal { value: Literal::Str(value), .. } => Some(RuleTerm::Literal(snapback4_core::Value::String(value.clone()))),
        A::Literal { value: Literal::Number(value), site } => super::super::integer_literal(value, site).ok()
            .map(|value| RuleTerm::Literal(snapback4_core::Value::Int(value))),
        A::Literal { value: Literal::Bool(value), .. } => Some(RuleTerm::Literal(snapback4_core::Value::Bool(*value))),
        A::Literal { value: Literal::Null, .. } => Some(RuleTerm::Literal(snapback4_core::Value::Null)),
        _ => None,
    };
    let Some(supplied) = read.keys.iter().map(|key| term(&key.value).map(|term| (key.column.as_deref(), term)))
        .collect::<Option<Vec<_>>>() else { return false };
    let fits = |term: &RuleTerm, column: &snapback4_core::schema::ColumnType| {
        if matches!(term, RuleTerm::Literal(snapback4_core::Value::Null)) { return column.is_optional(); }
        match (term, column.required()) {
            (RuleTerm::Viewer, snapback4_core::schema::ColumnType::Principal) => true,
            (RuleTerm::Literal(snapback4_core::Value::Bool(_)), snapback4_core::schema::ColumnType::Bool) => true,
            (RuleTerm::Literal(snapback4_core::Value::Int(_)), column) if column.is_int() => true,
            (RuleTerm::Literal(snapback4_core::Value::String(_)), snapback4_core::schema::ColumnType::Text { .. } | snapback4_core::schema::ColumnType::Enum { .. }) => true,
            (RuleTerm::Literal(snapback4_core::Value::String(_) | snapback4_core::Value::Id(_)), snapback4_core::schema::ColumnType::Id | snapback4_core::schema::ColumnType::Principal | snapback4_core::schema::ColumnType::Ref { .. }) => true,
            _ => false,
        }
    };
    let candidates: Vec<_> = table.indexes.iter().filter(|(name, index)| {
        if read.index.as_ref().is_some_and(|selected| selected != *name) { return false; }
        if !index.is_plain() { return false; }
        if supplied.iter().all(|(column, _)| column.is_some()) {
            index.components.len() == supplied.len()
                && index.columns().iter().all(|column| supplied.iter().any(|(supplied, _)| supplied == &Some(column.as_str())))
        } else {
            supplied.iter().all(|(column, _)| column.is_none())
                && index.unique && index.components.len() == supplied.len()
                && index.columns().iter().zip(&supplied).all(|(column, (_, term))| table.columns.get(column).is_some_and(|ty| fits(term, ty)))
        }
    }).collect();
    let [(index_name, index)] = candidates.as_slice() else { return false };
    let key = if supplied.iter().all(|(column, _)| column.is_some()) {
        let Some(key) = index.columns().iter().map(|column| supplied.iter()
            .find_map(|(supplied, term)| (*supplied == Some(column)).then_some(term.clone())))
            .collect::<Option<Vec<_>>>() else { return false };
        key
    } else {
        supplied.into_iter().map(|(_, term)| term).collect()
    };
    schema.rule_input_is_readable(&read.table, index_name, &key)
}

fn substituted_rule(maintain: &ast::MaintainDecl, read: &ReadExpr) -> Option<A> {
    let rule = maintain.read.as_ref()?;
    let keys = group_keys(maintain, read);
    if keys.len() != maintain.by.len() { return None; }
    let mut expected = rule.value.clone();
    normalize_rule_constants(&mut expected);
    // Rule focals name the maintained target row. Seal that namespace before
    // substituting declared group fields so a remaining target-only field can
    // never borrow the caller projection's focal row.
    super::super::intent_walk::expression(&mut expected, &mut |expr| {
        if let A::Member { base, .. } = expr && let A::Focal { site } = base.as_ref() {
            **base = A::Name { name: TARGET_ROW.into(), site: site.clone() };
        }
    });
    super::super::intent_walk::expression(&mut expected, &mut |expr| {
        if let A::Member { base, name, .. } = expr
            && matches!(base.as_ref(), A::Name { name, .. } if name == TARGET_ROW)
            && let Some(value) = keys.get(name)
        {
            *expr = value.clone();
        }
    });
    Some(expected)
}

fn group_keys(maintain: &ast::MaintainDecl, read: &ReadExpr) -> BTreeMap<String, A> {
    if maintain.by.len() != read.keys.len() { return BTreeMap::new(); }
    let mut keys: BTreeMap<_, _> = maintain.by.iter().map(|field| field.trim_start_matches('.').to_owned())
        .zip(read.keys.iter().map(|key| key.value.clone())).collect();
    for key in &read.keys {
        if let Some(column) = &key.column { keys.insert(column.clone(), key.value.clone()); }
    }
    keys
}

/// Rule constants occupy their own namespace. Freeze that identity before a
/// group field is replaced by a program expression whose lexical name may be
/// `allow`, `public`, or `deny`.
pub(in crate::bind) fn normalize_rule_constants(expression: &mut A) {
    super::super::intent_walk::expression(expression, &mut |expr| {
        let A::Name { name, site } = expr else { return };
        let value = match name.as_str() {
            "allow" | "public" => true,
            "deny" => false,
            _ => return,
        };
        let site = site.clone();
        *expr = A::Literal {
            value: Literal::Bool(value),
            site,
        };
    });
}
