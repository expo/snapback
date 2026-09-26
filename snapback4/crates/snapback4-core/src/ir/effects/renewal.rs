//! A deliberately small proof, separate from exhaustive effect discovery.
// @ref LLP 3000.017#2.2 — fixed keys alone do not prove renewal.
use super::*;

pub(super) fn prove(program: &Program, schema: &crate::schema::Schema) -> bool {
    if program.kind != ProgramKind::Mutation || program.native {
        return false;
    }
    let Some((write, guards)) = program.body.split_last() else {
        return false;
    };
    let args: BTreeSet<_> = program.args.keys().cloned().collect();
    let stable = |expr: &Expr| inputs(expr, None).is_some_and(|names| names.is_subset(&args));
    let one_write = match write {
        Stmt::Update { key, patch, .. } => stable(key) && stable(patch),
        Stmt::Upsert { key, row, .. } => stable(key) && stable(row),
        Stmt::WriteTarget {
            target,
            patch,
            condition: None,
            result: None,
            ..
        } => !target.key.is_empty() && target.key.iter().all(stable) && stable(patch),
        _ => false,
    };
    if !one_write {
        return false;
    }
    // Walk backwards: each local must feed a guard, possibly through another
    // local. Locals cannot shadow arguments or reach the key/patch. Refuse
    // control flow, helpers/blocks and opaque builtins rather than guessing.
    let mut needed = BTreeSet::new();
    let mut locals = BTreeSet::new();
    for stmt in guards.iter().rev() {
        let value = match stmt {
            Stmt::Require { condition, .. } => condition,
            Stmt::Let { name, value } | Stmt::Const { name, value }
                if !args.contains(name) && locals.insert(name) && needed.remove(name) =>
            {
                value
            }
            _ => return false,
        };
        let Some(names) = inputs(value, Some(schema)) else {
            return false;
        };
        needed.extend(names);
    }
    needed.is_subset(&args)
}

// In guards, only durable point reads are allowed: an ephemeral write may
// invalidate an ephemeral guard, including through expiry. In a write, all leaves must be literal,
// argument, viewer or now. This walk admits no expression with side effects.
fn inputs(expr: &Expr, reads: Option<&crate::schema::Schema>) -> Option<BTreeSet<String>> {
    let children: Vec<&Expr> = match expr {
        Expr::Variable(name) => return Some([name.clone()].into()),
        Expr::Literal(_) | Expr::Input(Input::Viewer | Input::Now) => return Some(BTreeSet::new()),
        Expr::Array(xs) => xs.iter().collect(),
        Expr::Object(xs) => xs.values().collect(),
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => vec![base],
        Expr::Binary { left, right, .. } => vec![left, right],
        Expr::Get(read) | Expr::Exists(read)
            if reads.is_some_and(|schema| schema.table(&read.table).is_some_and(|t| t.ephemeral.is_none())) => read.key.iter().collect(),
        _ => return None,
    };
    let mut names = BTreeSet::new();
    for child in children {
        names.extend(inputs(child, reads)?);
    }
    Some(names)
}
