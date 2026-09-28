//! Request the ordinary indexes for a server audience alternative. The authored
//! expression remains the device program; no membership predicate is added to it.
use super::catalog::Catalog;
use crate::ast::*;

// @ref LLP 3000.028#3.3 — only a single bare ordinary search is inferred.
pub(super) fn capture(catalog: &mut Catalog) {
    for doc in &catalog.documents {
        for program in &doc.programs {
            if program.kind != ProgramKind::Query || program.held || !program.prelude.is_empty() { continue; }
            let [Stmt::Return { value: Expr::Read(read), .. }] = program.body.as_slice() else { continue };
            if read.matching.is_none() || read.index.is_some() || !read.keys.is_empty()
                || read.range.is_none() || read.order_keys.is_empty()
                || read.filter.as_deref().is_some_and(|value| !scalar(value)) { continue; }
            let Some(table) = catalog.tables.get(&read.table) else { continue };
            if table.maintained.is_some() || table.decl.sync.is_none() { continue; }
            let Some(rule) = table.decl.rules.iter().find(|r| r.effect == Effect::Read) else { continue };
            let Expr::Exists { read: probe, .. } = &rule.value else { continue };
            let Some(members) = catalog.tables.get(&probe.table) else { continue };
            if members.decl.expire.is_some() || members.maintained.is_some() { continue; }
            // The bound schema proof remains authoritative. This candidate only
            // asks the existing planner for physical indexes; it changes no read.
            let mut candidate = read.clone();
            candidate.filter = Some(Box::new(match candidate.filter.take() {
                Some(filter) => Expr::Binary { op: "and".into(), left: Box::new(rule.value.clone()), right: filter, site: read.site.clone() },
                None => rule.value.clone(),
            }));
            catalog.ordinary_searches.push(candidate);
        }
    }
}

fn scalar(value: &Expr) -> bool {
    match value {
        Expr::Literal { .. } | Expr::Name { .. } => true,
        Expr::Member { base, .. } => matches!(base.as_ref(), Expr::Focal { .. }),
        Expr::Unary { value, .. } => scalar(value),
        Expr::Binary { left, right, .. } => scalar(left) && scalar(right),
        _ => false,
    }
}
