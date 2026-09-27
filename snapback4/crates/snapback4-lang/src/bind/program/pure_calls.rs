//! Null facts for repeated, effect-free helper calls over lexical snapshots.
use super::*;
use std::collections::BTreeSet;

pub(super) const CONSTANTS: &str = "$pureCallConstants";

#[derive(Debug)]
enum Stable {
    Literal(String),
    Snapshot(String, Vec<String>),
    Viewer,
    Call(String, Vec<Stable>),
}

impl Binder<'_> {
    // @ref LLP 3000.007#5.2 — a repeated pure call narrows like a snapshot field.
    // Facts live on *every* argument root so the existing branch intersections,
    // reassignment invalidation and loop fixed point apply to them as to fields.
    fn stable_call(&self, value: &A) -> Option<(Vec<String>, BTreeSet<String>)> {
        if !matches!(value, A::Call { .. }) { return None; }
        let mut roots = BTreeSet::new();
        let stable = self.stable_value(value, &mut roots)?;
        if roots.is_empty() { roots.insert(CONSTANTS.into()); }
        Some((vec!["$pureCall".into(), stable.key()], roots))
    }

    fn stable_value(&self, value: &A, roots: &mut BTreeSet<String>) -> Option<Stable> {
        match value {
            A::Literal { .. } => Some(Stable::Literal(print::expression(value))),
            A::Name { name, .. } if name == "viewer" => Some(Stable::Viewer),
            A::Name { name, .. } if matches!(name.as_str(), "now" | "commit" | "new") => None,
            A::Name { .. } | A::Member { .. } | A::Focal { .. } => {
                let (root, path) = control::field_path(value, self.focal.as_ref().map(|(name, _)| name.as_str()))?;
                let runtime = if let Some(binding) = self.binding(&root) {
                    roots.insert(root.clone());
                    binding.runtime.clone()
                } else {
                    // A shape's implicit row is an immutable lexical snapshot.
                    // Its unique runtime identity separates projection scopes;
                    // with no mutable argument roots, use the constant anchor.
                    self.focal.as_ref().filter(|(name, _)| name == &root)?.0.clone()
                };
                Some(Stable::Snapshot(runtime, path))
            }
            A::Call { name, args, .. } => {
                let function = self.catalog.functions.get(name)?;
                if !self.pure_functions.get(&function.name).copied().unwrap_or(false) { return None; }
                Some(Stable::Call(function.name.clone(), args.iter().map(|arg| self.stable_value(arg, roots)).collect::<Option<_>>()?))
            }
            _ => None,
        }
    }

    pub(super) fn narrow_call(&mut self, value: &A, present: bool) {
        let Some((key, roots)) = self.stable_call(value) else { return; };
        let Some(ty) = self.call_types.get(&key) else { return; };
        let ty = if present { ty.required() } else { Ty::Null };
        for root in roots {
            let mut binding = self.binding(&root).expect("a stable root").clone();
            binding.fields.insert(key.clone(), ty.clone());
            self.scopes.last_mut().expect("a scope").insert(root, binding);
        }
    }

    pub(super) fn record_call(&mut self, value: &A, ty: &Ty) {
        if let Some((key, _)) = self.stable_call(value) { self.call_types.insert(key, ty.clone()); }
    }

    pub(super) fn call_refinement(&self, value: &A) -> Option<Ty> {
        let (key, roots) = self.stable_call(value)?;
        let mut result = None;
        for root in roots {
            let ty = self.binding(&root)?.fields.get(&key)?;
            if result.as_ref().is_some_and(|other| other != ty) { return None; }
            result = Some(ty.clone());
        }
        result
    }
}

impl Stable {
    // Escaped serialization of the structured identity, never source
    // sites or helper temporaries. Argument order and snapshot identity matter.
    fn key(&self) -> String {
        match self {
            Self::Literal(value) => format!("literal:{value:?}"),
            Self::Snapshot(root, path) => format!("snapshot:{root:?}:{path:?}"),
            Self::Viewer => "viewer".into(),
            Self::Call(name, args) => format!("call:{name:?}:{:?}", args.iter().map(Self::key).collect::<Vec<_>>()),
        }
    }
}

// Inspect expanded IR, after argument setup: this covers transitive helpers,
// named shapes, aggregates and reads hidden in blocks without a second AST
// effect model. It only classifies effects; calls still execute and are metered.
pub(super) fn expression(value: &Expr) -> bool {
    match value {
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(Input::Viewer) => true,
        Expr::Input(Input::Now | Input::ReadTime | Input::NewId) => false,
        Expr::Get(_) | Expr::Exists(_) | Expr::Scan(_) | Expr::Merge(_) => false,
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => expression(base),
        Expr::Array(values) => values.iter().all(expression),
        Expr::Object(fields) => fields.values().all(expression),
        Expr::Shape { base, fields } => expression(base) && fields.values().all(expression),
        Expr::Binary { left, right, .. } => expression(left) && expression(right),
        Expr::Builtin { builtin, args } => builtin_pure(builtin) && args.iter().all(expression),
        Expr::Block { body, value } => statements(body) && expression(value),
    }
}

fn builtin_pure(builtin: &Builtin) -> bool {
    match builtin {
        Builtin::Connected => false,
        Builtin::ProjectFields { .. } | Builtin::OptionalField { .. } | Builtin::Calendar { .. }
        | Builtin::Len | Builtin::Slice | Builtin::Concat | Builtin::Lower | Builtin::Trim
        | Builtin::Sha256 | Builtin::Join | Builtin::Group { .. } | Builtin::First | Builtin::Last
        | Builtin::At | Builtin::Min | Builtin::Max | Builtin::Extremum { .. }
        | Builtin::ExtremumOf { .. } | Builtin::Divmod { .. } | Builtin::Sort { .. }
        | Builtin::MentionTokens | Builtin::SearchPresent | Builtin::DeterministicShare
        | Builtin::Count | Builtin::Sum | Builtin::CountCapped => true,
    }
}

pub(super) fn statements(body: &[Stmt]) -> bool {
    body.iter().all(|statement| match statement {
        Stmt::Let { value, .. } | Stmt::Const { value, .. } | Stmt::Assign { value, .. }
        | Stmt::Push { value, .. } | Stmt::Return(value) => expression(value),
        Stmt::Require { condition, .. } => expression(condition),
        Stmt::If { condition, then_body, else_body } => expression(condition) && statements(then_body) && statements(else_body),
        Stmt::For { domain, body, .. } => {
            let pure = match domain {
                LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => true,
                LoopDomain::ExpressionRange { start, end_exclusive } => expression(start) && expression(end_exclusive),
                LoopDomain::DerivedArray { value, .. } => expression(value),
                LoopDomain::Page(_) | LoopDomain::Recurse(_) => false,
            };
            pure && statements(body)
        }
        Stmt::Break | Stmt::Continue => true,
        Stmt::Check { .. } | Stmt::InsertIfAbsent { .. } | Stmt::Insert { .. }
        | Stmt::Update { .. } | Stmt::Upsert { .. } | Stmt::WriteTarget { .. }
        | Stmt::Delete { .. } | Stmt::DeleteTarget { .. } | Stmt::Emit { .. } => false,
    })
}
