//! Expanded helpers can write from any expression block.
// @ref LLP 3000.022#14.3 — legacy eligibility examines the complete expanded write footprint.
use super::*;
pub(super) fn stmts_write_tables(stmts: &[Stmt], out: &mut Vec<(String, &'static str)>) {
    for stmt in stmts {
        match stmt {
            Stmt::Insert { table, .. } | Stmt::InsertIfAbsent { table, .. } => out.push((table.clone(), "insert")),
            Stmt::Update { table, .. } => out.push((table.clone(), "update")),
            Stmt::Upsert { table, .. } => out.push((table.clone(), "upsert")),
            Stmt::WriteTarget { target, upsert, .. } => out.push((target.table.clone(), if *upsert { "upsert" } else { "update" })),
            Stmt::Delete { table, .. } => out.push((table.clone(), "delete")),
            Stmt::DeleteTarget { target } => out.push((target.table.clone(), "delete")),
            _ => {}
        }
        match stmt {
            Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) => expr_write_tables(value, out),
            Stmt::Emit { payload: value, once, .. } => { expr_write_tables(value, out); if let Some(value) = once { expr_write_tables(value, out); } },
            Stmt::If { condition, then_body, else_body } => {
                expr_write_tables(condition, out);
                stmts_write_tables(then_body, out);
                stmts_write_tables(else_body, out);
            }
            Stmt::For { domain, body, .. } => {
                match domain {
                    LoopDomain::Page(scan) => scan_write_tables(scan, out),
                    LoopDomain::ExpressionRange { start, end_exclusive } => { expr_write_tables(start, out); expr_write_tables(end_exclusive, out); }
                    LoopDomain::DerivedArray { value, .. } => expr_write_tables(value, out),
                    LoopDomain::Recurse(recurse) => {
                        expr_write_tables(&recurse.seed, out);
                    }
                    LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => {}
                }
                stmts_write_tables(body, out);
            }
            Stmt::Require { condition, .. } => expr_write_tables(condition, out),
            Stmt::Check { condition, current } => {
                expr_write_tables(condition, out);
                for key in &current.key { expr_write_tables(key, out); }
            }
            Stmt::InsertIfAbsent { row, .. } | Stmt::Insert { row, .. } => expr_write_tables(row, out),
            Stmt::Update { key, patch, .. } => {
                expr_write_tables(key, out);
                expr_write_tables(patch, out);
            }
            Stmt::Upsert { key, row, .. } => {
                expr_write_tables(key, out);
                expr_write_tables(row, out);
            }
            Stmt::WriteTarget { target, patch, condition, .. } => {
                for key in &target.key { expr_write_tables(key, out); }
                expr_write_tables(patch, out);
                if let Some(condition) = condition { stmts_write_tables(&condition.setup, out); expr_write_tables(&condition.value, out); }
            }
            Stmt::Delete { key, .. } => expr_write_tables(key, out),
            Stmt::DeleteTarget { target } => {
                for key in &target.key { expr_write_tables(key, out); }
            }
            Stmt::Break | Stmt::Continue => {}
        }
    }
}

fn scan_write_tables(scan: &Scan, out: &mut Vec<(String, &'static str)>) {
    if let Some(filter) = &scan.filter { expr_write_tables(filter, out); }
    if let Some(range) = &scan.range {
        for bound in [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten() { expr_write_tables(bound, out); }
    }
    for key in &scan.prefix {
        match key { IndexKeyExpr::Scalar(expr) | IndexKeyExpr::WordPrefix(expr) => expr_write_tables(expr, out) }
    }
    for cursor in [&scan.after, &scan.before].into_iter().flatten() { expr_write_tables(cursor, out); }
}

fn expr_write_tables(expr: &Expr, out: &mut Vec<(String, &'static str)>) {
    match expr {
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
        Expr::Field { base, .. } => expr_write_tables(base, out),
        Expr::Array(items) => items.iter().for_each(|item| expr_write_tables(item, out)),
        Expr::Object(fields) => fields.values().for_each(|item| expr_write_tables(item, out)),
        Expr::Shape { base, fields } => { expr_write_tables(base, out); fields.values().for_each(|item| expr_write_tables(item, out)); }
        Expr::Binary { left, right, .. } => {
            expr_write_tables(left, out);
            expr_write_tables(right, out);
        }
        Expr::Unary { value, .. } => expr_write_tables(value, out),
        Expr::Builtin { args, .. } => args.iter().for_each(|item| expr_write_tables(item, out)),
        Expr::Get(read) | Expr::Exists(read) => {
            read.key.iter().for_each(|item| expr_write_tables(item, out));
        }
        Expr::Block { body, value } => { stmts_write_tables(body, out); expr_write_tables(value, out); }
        Expr::Scan(scan) => scan_write_tables(scan, out),
        Expr::Merge(merge) => {
            if let Some(after) = merge.position.as_ref().and_then(|position| position.after.as_ref()) { expr_write_tables(after, out); }
            for lane in &merge.lanes {
                if let Some(guard) = &lane.guard { expr_write_tables(guard, out); }
                if let Some(project) = &lane.project { expr_write_tables(project, out); }
                if let Some(value) = &lane.distinct { expr_write_tables(value, out); }
                stmts_write_tables(&lane.setup, out);
                if let Some(source) = &lane.source {
                    if let Some(scan) = source.scan() { scan_write_tables(scan, out); }
                    for value in source.expressions() { expr_write_tables(value, out); }
                }
                scan_write_tables(&lane.scan, out);
            }
        }
    }
}
