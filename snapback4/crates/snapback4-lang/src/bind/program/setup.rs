//! Expression ownership for analysis, removed before admission or execution.
use super::*;

// @ref LLP 3000.007#19.1 — analysis grouping must not change executed IR, statement sites, admission or charges.
pub(super) fn restore(program: &mut Program) -> BTreeMap<String, String> {
    let mut paths = BTreeMap::new();
    body(&mut program.body, &format!("programs.{}.body", program.name), &program.name, 0, &mut paths);
    paths
}

fn body(stmts: &mut Vec<Stmt>, source: &str, runtime: &str, offset: usize, paths: &mut BTreeMap<String, String>) {
    let mut flat = Vec::new();
    for (n, mut stmt) in std::mem::take(stmts).into_iter().enumerate() {
        let origin = format!("{source}.{n}");
        // These two outer blocks are binder-owned. The only authored Block
        // is a scan's where predicate, nested inside the scan expression.
        if let Stmt::If { condition: value, .. } | Stmt::Emit { payload: value, .. } = &mut stmt
            && matches!(value, Expr::Block { .. }) {
            let Expr::Block { body: mut setup, value: result } = std::mem::replace(value, Expr::Literal(Value::Null)) else { unreachable!() };
            body(&mut setup, &format!("{origin}.value"), runtime, offset + flat.len(), paths);
            flat.extend(setup);
            *value = *result;
        }
        let site = format!("{runtime}:{}", offset + flat.len() + 1);
        paths.insert(origin.clone(), site.clone());
        match &mut stmt {
            Stmt::If { then_body, else_body, .. } => {
                body(then_body, &format!("{origin}.then"), &format!("{site}:then"), 0, paths);
                body(else_body, &format!("{origin}.else"), &format!("{site}:else"), 0, paths);
            }
            Stmt::For { body: inner, .. } => body(inner, &format!("{origin}.loop"), &site, 0, paths),
            Stmt::WriteTarget { condition: Some(condition), .. } => body(&mut condition.setup, &format!("{origin}.condition"), &format!("{site}:condition"), 0, paths),
            _ => {}
        }
        flat.push(stmt);
    }
    *stmts = flat;
}
