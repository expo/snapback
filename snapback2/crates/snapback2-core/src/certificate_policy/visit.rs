use super::*;

/// Every expression a statement holds directly (bodies excluded), each walked in full.
pub(crate) fn visit_statement_exprs(statement: &Stmt, visit: &mut impl FnMut(&Expr)) {
    match statement {
        Stmt::Const { value, .. }
        | Stmt::Let { value, .. }
        | Stmt::Assign { value, .. }
        | Stmt::Push { value, .. }
        | Stmt::Return(value) => walk_expr(value, visit),
        Stmt::If { condition, .. } => walk_expr(condition, visit),
        Stmt::For { domain, .. } => match domain {
            LoopDomain::Page(scan) => walk_expr(&Expr::Scan(scan.clone()), visit),
            LoopDomain::DerivedArray { value, .. } => walk_expr(value, visit),
            LoopDomain::Recurse(recurse) => walk_expr(&recurse.seed, visit),
            LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => {}
        },
        Stmt::Require { condition, .. } => walk_expr(condition, visit),
        Stmt::Insert { row, .. } => walk_expr(row, visit),
        Stmt::Update { key, patch, .. } => {
            walk_expr(key, visit);
            walk_expr(patch, visit);
        }
        Stmt::Upsert { key, row, .. } => {
            walk_expr(key, visit);
            walk_expr(row, visit);
        }
        Stmt::Delete { key, .. } => walk_expr(key, visit),
        Stmt::Emit { payload, .. } => walk_expr(payload, visit),
        Stmt::Break | Stmt::Continue => {}
    }
}

pub(super) fn walk_expr(expression: &Expr, visit: &mut impl FnMut(&Expr)) {
    visit(expression);
    match expression {
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => walk_expr(base, visit),
        Expr::Binary { left, right, .. } => {
            walk_expr(left, visit);
            walk_expr(right, visit);
        }
        Expr::Array(values) | Expr::Builtin { args: values, .. } => {
            values.iter().for_each(|value| walk_expr(value, visit));
        }
        Expr::Object(values) => values.values().for_each(|value| walk_expr(value, visit)),
        Expr::Get(read) | Expr::Exists(read) => {
            read.key.iter().for_each(|value| walk_expr(value, visit));
        }
        Expr::Scan(scan) => {
            scan.prefix
                .iter()
                .for_each(|value| walk_expr(value.expression(), visit));
            [scan.after.as_deref(), scan.before.as_deref()]
                .into_iter()
                .flatten()
                .for_each(|value| walk_expr(value, visit));
            if let Some(range) = &scan.range {
                [
                    range.gt.as_deref(),
                    range.gte.as_deref(),
                    range.lt.as_deref(),
                    range.lte.as_deref(),
                ]
                .into_iter()
                .flatten()
                .for_each(|value| walk_expr(value, visit));
            }
        }
        Expr::Merge(merge) => {
            for lane in &merge.lanes {
                for stmt in &lane.setup {
                    visit_statement_exprs(stmt, visit);
                }
                if let Some(source) = &lane.source {
                    walk_expr(&Expr::Scan(source.clone()), visit);
                }
                walk_expr(&Expr::Scan(lane.scan.clone()), visit);
            }
        }
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
    }
}
