//! Exact non-empty facts established by successful count guards.

use super::*;
use std::collections::BTreeSet;

pub(super) const NONEMPTY: &str = "$aggregateNonempty";
/// Capture marker for a local whose current value is an exact `count(domain)`
/// observation. It lives on the result and every domain root: ordinary
/// rebinding, a write, an authority edge, or a control-flow meet therefore
/// destroys stale provenance without repurposing diagnostic `origins`.
pub(super) const COUNT_CAPTURE: &str = "$aggregateCountCapture";

impl Binder<'_> {
    /// A non-empty observation survives evaluation of its guard only when the
    /// complete condition is write-free. Unlike point facts, aggregate facts
    /// deliberately admit filters and seeks because those are part of the
    /// exact domain identity recorded below.
    pub(super) fn aggregate_guard_safe(&self, value: &A) -> bool {
        match value {
            A::Name { .. } | A::Focal { .. } | A::Literal { .. } => true,
            A::Array { items, .. } => items.iter().all(|item| self.aggregate_guard_safe(item)),
            A::Object { fields, .. } => fields.iter().all(|field| field.value.as_ref().is_none_or(|value| self.aggregate_guard_safe(value))),
            A::Unary { value, .. } | A::Assert { value, .. } | A::ShapeUse { base: value, .. } => self.aggregate_guard_safe(value),
            A::Binary { left, right, .. } => self.aggregate_guard_safe(left) && self.aggregate_guard_safe(right),
            A::Member { base, .. } => self.aggregate_guard_safe(base),
            A::Call { name, args, .. } => self.catalog.functions.get(name).is_none_or(|function|
                self.pure_functions.get(&function.name) == Some(&true))
                && args.iter().all(|arg| self.aggregate_guard_safe(arg)),
            A::Read(read) | A::Exists { read, .. } | A::Created { read, .. } => {
                read.computed.values().all(|value| self.aggregate_guard_safe(value))
                    && read.keys.iter().all(|key| self.aggregate_guard_safe(&key.value))
                    && read.seeks.iter().all(|seek| self.aggregate_guard_safe(&seek.value))
                    && read.filter.as_deref().is_none_or(|filter| self.aggregate_guard_safe(filter))
                    && read.matching.as_deref().is_none_or(|matching| self.aggregate_guard_safe(matching))
                    && read.range.as_ref().and_then(|range| range.cursor.as_deref()).is_none_or(|cursor| self.aggregate_guard_safe(cursor))
            }
            A::Shape { base, fields, .. } => self.aggregate_guard_safe(base)
                && fields.iter().all(|field| match field {
                    ShapeField::Field { value, .. } => self.aggregate_guard_safe(value),
                    ShapeField::Spread { .. } | ShapeField::NamedSpread { .. } | ShapeField::Bare { .. } => true,
                }),
            A::If { then, condition, otherwise, .. } => self.aggregate_guard_safe(then)
                && self.aggregate_guard_safe(condition)
                && self.aggregate_guard_safe(otherwise),
            A::Merge(_) | A::Walk { .. } | A::Write { .. } => false,
        }
    }

    /// Record only implications that follow from count's nonnegative range.
    /// The common authored form is `require n > 0`, where `n` was bound from
    /// `count(domain)`; direct count calls use the same identity.
    // @ref LLP 3000.013.001#4-non-empty-domain-proof — the fact belongs to the exact domain roots and transaction state.
    pub(super) fn record_aggregate_nonempty(&mut self, condition: &A, truth: bool) {
        if !truth { return; }
        let A::Binary { op, left, right, .. } = condition else { return };
        let (candidate, threshold, op) = if let Some(n) = literal_int(right) {
            (left.as_ref(), n, op.as_str())
        } else if let Some(n) = literal_int(left) {
            let reversed = match op.as_str() { "<" => ">", "<=" => ">=", ">" => "<", ">=" => "<=", other => other };
            (right.as_ref(), n, reversed)
        } else { return };
        let proves_positive = match op {
            ">" => threshold >= 0,
            ">=" | "=" => threshold >= 1,
            "!=" => threshold == 0,
            _ => false,
        };
        if !proves_positive { return; }
        let Some((key, roots)) = self.count_key(candidate) else { return };
        for root in roots {
            let Some(mut binding) = self.binding(&root).cloned() else { return };
            binding.fields.insert(key.clone(), Ty::Bool);
            self.scopes.last_mut().expect("a scope").insert(root, binding);
        }
    }

    pub(super) fn aggregate_nonempty(&self, read: &ReadExpr) -> bool {
        self.aggregate_key(read).is_some_and(|(key, roots)| roots.iter().all(|root|
            self.binding(root).is_some_and(|binding| binding.fields.get(&key) == Some(&Ty::Bool))))
    }

    /// Resolve count provenance before rebinding `name`: a count domain may
    /// itself refer to the old value of that local. Such a self-dependent
    /// capture cannot be represented by the post-assignment binding and is
    /// therefore deliberately not narrowed.
    pub(super) fn count_capture(&self, name: &str, value: &A) -> Option<(Vec<String>, BTreeSet<String>)> {
        let A::Call { name: call, args, .. } = value else { return None };
        if call != "count" || args.len() != 1 || self.catalog.functions.contains_key(call)
            || !self.aggregate_guard_safe(value) { return None; }
        let read = args.first().and_then(|arg| self.aggregate_domain(arg))?;
        let (aggregate, roots) = self.aggregate_key(&read)?;
        if roots.contains(name) { return None; }
        let capture = vec![COUNT_CAPTURE.into(), aggregate[1].clone()];
        Some((capture, roots))
    }

    /// Attach pre-resolved capture-time provenance after assigning `name`.
    /// `origins` remains diagnostic history; this field fact is the reaching
    /// definition proof used by a later `require name > 0`.
    pub(super) fn record_count_capture(&mut self, name: &str, capture: Option<(Vec<String>, BTreeSet<String>)>) {
        let Some((capture, mut owners)) = capture else { return };
        owners.insert(name.to_owned());
        for owner in owners {
            let Some(mut binding) = self.binding(&owner).cloned() else { return };
            binding.fields.insert(capture.clone(), Ty::Bool);
            self.scopes.last_mut().expect("a scope").insert(owner, binding);
        }
    }

    fn count_key(&self, value: &A) -> Option<(Vec<String>, BTreeSet<String>)> {
        let (count_arg, captured_name) = match value {
            A::Call { name, args, .. } if name == "count" && args.len() == 1
                && !self.catalog.functions.contains_key(name) => args.first(),
            A::Name { name, .. } => self.binding(name)?.origins.iter().rev().find_map(|(_, origin)| match origin {
                A::Call { name, args, .. } if name == "count" && args.len() == 1
                    && !self.catalog.functions.contains_key(name) => args.first(),
                _ => None,
            }),
            _ => None,
        }.map(|arg| (arg, match value { A::Name { name, .. } => Some(name.as_str()), _ => None }))?;
        let result = self.aggregate_key(&self.aggregate_domain(count_arg)?)?;
        if let Some(name) = captured_name {
            let capture = vec![COUNT_CAPTURE.into(), result.0[1].clone()];
            if self.binding(name)?.fields.get(&capture) != Some(&Ty::Bool)
                || !result.1.iter().all(|root| self.binding(root)
                    .is_some_and(|binding| binding.fields.get(&capture) == Some(&Ty::Bool)))
            {
                return None;
            }
        }
        Some(result)
    }

    fn aggregate_key(&self, read: &ReadExpr) -> Option<(Vec<String>, BTreeSet<String>)> {
        if read.range.is_some() || read.matching.is_some() { return None; }
        let mut roots = BTreeSet::new();
        let keys = read.keys.iter().map(|key| Some(format!("{:?}:{}", key.column,
            self.aggregate_value(&key.value, &mut roots)?))).collect::<Option<Vec<_>>>()?;
        let seeks = read.seeks.iter().map(|seek| Some(format!("{}:{}:{}", seek.column, seek.op,
            self.aggregate_value(&seek.value, &mut roots)?))).collect::<Option<Vec<_>>>()?;
        let filter = match read.filter.as_deref() {
            Some(value) => Some(self.aggregate_value(value, &mut roots)?),
            None => None,
        };
        if roots.is_empty() { roots.insert(pure_calls::CONSTANTS.into()); }
        let identity = format!("{:?}:{:?}:{:?}:{keys:?}:{seeks:?}:{filter:?}", read.table, read.index, read.order_keys);
        Some((vec![NONEMPTY.into(), identity], roots))
    }

    fn aggregate_value(&self, value: &A, roots: &mut BTreeSet<String>) -> Option<String> {
        match value {
            A::Focal { .. } => Some("focal".into()),
            A::Member { base, name, .. } if matches!(base.as_ref(), A::Focal { .. }) => Some(format!("focal.{name}")),
            A::Literal { .. } | A::Name { .. } | A::Member { .. } => self.stable_value(value, roots).map(|value| value.key()),
            A::Unary { op, value, .. } => Some(format!("unary:{op}:{}", self.aggregate_value(value, roots)?)),
            A::Binary { op, left, right, .. } => Some(format!("binary:{op}:{}:{}", self.aggregate_value(left, roots)?, self.aggregate_value(right, roots)?)),
            A::Call { name, args, .. } => {
                let function = self.catalog.functions.get(name)?;
                if self.pure_functions.get(&function.name) != Some(&true) { return None; }
                Some(format!("call:{name}:{:?}", args.iter().map(|arg| self.aggregate_value(arg, roots)).collect::<Option<Vec<_>>>()?))
            }
            A::Array { items, .. } => Some(format!("array:{:?}", items.iter().map(|item| self.aggregate_value(item, roots)).collect::<Option<Vec<_>>>()?)),
            _ => None,
        }
    }
}
