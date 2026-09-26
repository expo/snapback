//! Recursive effect check for population admission and replayable job setup.
use crate::ir::{Expr, IndexKeyExpr, LoopDomain, Scan, Stmt};

// Check expressions too: an inlined helper may hide a write in a payload,
// condition, binding or loop domain. Unknown future forms must be considered.
pub(super) fn statements<const ALLOW_EMIT: bool>(body: &[Stmt]) -> bool {
    body.iter().all(|stmt| match stmt {
        Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. }
        | Stmt::Return(value) | Stmt::Require { condition: value, .. } => expression::<ALLOW_EMIT>(value),
        Stmt::Emit { payload, once, .. } => ALLOW_EMIT && expression::<ALLOW_EMIT>(payload) && once.as_ref().is_none_or(expression::<ALLOW_EMIT>),
        Stmt::Check { condition, current } => expression::<ALLOW_EMIT>(condition) && current.key.iter().all(expression::<ALLOW_EMIT>),
        Stmt::If { condition, then_body, else_body } => expression::<ALLOW_EMIT>(condition) && statements::<ALLOW_EMIT>(then_body) && statements::<ALLOW_EMIT>(else_body),
        Stmt::For { domain: source, body, .. } => domain::<ALLOW_EMIT>(source) && statements::<ALLOW_EMIT>(body),
        Stmt::Break | Stmt::Continue => true,
        Stmt::Insert { .. } | Stmt::InsertIfAbsent { .. } | Stmt::Update { .. } | Stmt::Upsert { .. } | Stmt::WriteTarget { .. } | Stmt::Delete { .. } | Stmt::DeleteTarget { .. } => false,
    })
}

fn domain<const ALLOW_EMIT: bool>(value: &LoopDomain) -> bool {
    // Every domain has a finite range, a list/depth bound or the scan meter.
    // Classification follows effects, including in the domain's expressions.
    match value {
        LoopDomain::Page(source) => scan::<ALLOW_EMIT>(source),
        LoopDomain::DerivedArray { value, .. } => expression::<ALLOW_EMIT>(value),
        LoopDomain::ExpressionRange { start, end_exclusive } => expression::<ALLOW_EMIT>(start) && expression::<ALLOW_EMIT>(end_exclusive),
        LoopDomain::Recurse(recurse) => expression::<ALLOW_EMIT>(&recurse.seed),
        LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => true,
    }
}

fn scan<const ALLOW_EMIT: bool>(scan: &Scan) -> bool {
    scan.prefix.iter().all(|key| match key { IndexKeyExpr::Scalar(value) | IndexKeyExpr::WordPrefix(value) => expression::<ALLOW_EMIT>(value) })
        && [&scan.filter, &scan.after, &scan.before].into_iter().flatten().all(|value| expression::<ALLOW_EMIT>(value))
        && scan.range.as_ref().is_none_or(|range| [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten().all(|value| expression::<ALLOW_EMIT>(value)))
}

fn expression<const ALLOW_EMIT: bool>(value: &Expr) -> bool {
    match value {
        Expr::Block { body, value } => statements::<ALLOW_EMIT>(body) && expression::<ALLOW_EMIT>(value),
        Expr::Array(values) => values.iter().all(expression::<ALLOW_EMIT>),
        Expr::Builtin { builtin, args: values } => builtin.operands(values).all(expression::<ALLOW_EMIT>),
        Expr::Object(fields) => fields.values().all(expression::<ALLOW_EMIT>),
        Expr::Shape { base, fields } => expression::<ALLOW_EMIT>(base) && fields.values().all(expression::<ALLOW_EMIT>),
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => expression::<ALLOW_EMIT>(base),
        Expr::Binary { left, right, .. } => expression::<ALLOW_EMIT>(left) && expression::<ALLOW_EMIT>(right),
        Expr::Get(read) | Expr::Exists(read) => read.key.iter().all(expression::<ALLOW_EMIT>),
        Expr::Scan(source) => scan::<ALLOW_EMIT>(source),
        Expr::Merge(merge) => merge.position.as_ref().and_then(|position| position.after.as_deref()).is_none_or(expression::<ALLOW_EMIT>) && merge.lanes.iter().all(|lane| lane.guard.as_ref().is_none_or(expression::<ALLOW_EMIT>) && lane.project.as_ref().is_none_or(expression::<ALLOW_EMIT>) && lane.distinct.as_ref().is_none_or(expression::<ALLOW_EMIT>) && statements::<ALLOW_EMIT>(&lane.setup) && scan::<ALLOW_EMIT>(&lane.scan) && lane.source.as_ref().is_none_or(|source| source.scan().is_none_or(scan::<ALLOW_EMIT>) && source.expressions().into_iter().all(expression::<ALLOW_EMIT>))),
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => true,
    }
}
