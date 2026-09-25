//! Complete operand walk for the effect-only slice, including opaque work.
use snapback4_core::ir::*;

pub(super) fn expression(expr: &Expr, f: &mut dyn FnMut(&Expr)) {
    f(expr);
    match expr {
        Expr::Literal(_) | Expr::Input(_) | Expr::Variable(_) => {}
        Expr::Get(read) | Expr::Exists(read) => for key in &read.key { expression(key, f); },
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => expression(base, f),
        Expr::Array(items) | Expr::Builtin { args: items, .. } => for item in items { expression(item, f); },
        Expr::Object(fields) => for item in fields.values() { expression(item, f); },
        Expr::Shape { base, fields } => { expression(base, f); for item in fields.values() { expression(item, f); } }
        Expr::Binary { left, right, .. } => { expression(left, f); expression(right, f); }
        Expr::Block { body, value } => {
            for stmt in body { statement(stmt, &mut |expr| expression(expr, f)); }
            expression(value, f);
        }
        Expr::Scan(scan) => scan_values(scan, &mut |expr| expression(expr, f)),
        Expr::Merge(merge) => for lane in &merge.lanes {
            if let Some(source) = &lane.source {
                if let Some(scan) = source.scan() { scan_values(scan, &mut |expr| expression(expr, f)); }
                for expr in source.expressions() { expression(expr, f); }
            }
            for stmt in &lane.setup { statement(stmt, &mut |expr| expression(expr, f)); }
            scan_values(&lane.scan, &mut |expr| expression(expr, f));
        },
    }
}

fn scan_values(scan: &Scan, f: &mut dyn FnMut(&Expr)) {
    for key in &scan.prefix { let (IndexKeyExpr::Scalar(expr) | IndexKeyExpr::WordPrefix(expr)) = key; f(expr); }
    for expr in [&scan.after, &scan.before, &scan.filter].into_iter().flatten() { f(expr); }
    if let Some(range) = &scan.range { for expr in [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten() { f(expr); } }
    if let Bound::Arg { name, .. } = &scan.take { f(&Expr::Variable(name.clone())); }
}

pub(super) fn domain(domain: &LoopDomain, f: &mut dyn FnMut(&Expr)) {
    match domain {
        LoopDomain::Page(scan) => scan_values(scan, f),
        LoopDomain::ExpressionRange { start, end_exclusive } => { f(start); f(end_exclusive); }
        LoopDomain::DerivedArray { value, .. } => f(value),
        LoopDomain::Recurse(recurse) => f(&recurse.seed),
        LoopDomain::ArgList { name, .. } => f(&Expr::Variable(name.clone())),
        LoopDomain::LiteralRange { .. } => {}
    }
}

pub(super) fn statement(stmt: &Stmt, f: &mut dyn FnMut(&Expr)) {
    match stmt {
        Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value } | Stmt::Push { target: name, value } => {
            f(&Expr::Variable(name.clone())); f(value);
        }
        Stmt::Emit { payload, once, .. } => { f(payload); if let Some(key) = once { f(key); } }
        Stmt::If { condition, then_body, else_body } => { f(condition); for stmt in then_body.iter().chain(else_body) { statement(stmt, f); } }
        Stmt::For { binding, domain: source, body } => { f(&Expr::Variable(binding.clone())); domain(source, f); for stmt in body { statement(stmt, f); } }
        Stmt::Require { condition, .. } | Stmt::Return(condition) => f(condition),
        Stmt::Check { condition, current } => { f(condition); for key in &current.key { f(key); } }
        Stmt::Insert { row, .. } => f(row),
        Stmt::InsertIfAbsent { row, result, .. } => { f(row); f(&Expr::Variable(result.clone())); }
        Stmt::Update { key, patch, .. } | Stmt::Upsert { key, row: patch, .. } => { f(key); f(patch); }
        Stmt::WriteTarget { target, patch, condition, result, .. } => {
            for key in &target.key { f(key); } f(patch);
            if let Some(result) = result { f(&Expr::Variable(result.clone())); }
            if let Some(condition) = condition { for stmt in &condition.setup { statement(stmt, f); } f(&condition.value); }
        }
        Stmt::Delete { key, .. } => f(key),
        Stmt::DeleteTarget { target } => for key in &target.key { f(key); },
        Stmt::Break | Stmt::Continue => {}
    }
}
