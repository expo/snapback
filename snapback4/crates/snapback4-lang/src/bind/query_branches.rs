//! Explicit query caller branches can be broader than a table read rule.
// @ref LLP 3000.036.002#131-notes-and-declarations — missing proof is advice about filtering, never a grant or disjoint-role claim.
use super::catalog::Catalog;
use crate::{ast::*, Diagnostic};
use snapback4_core::schema::{RuleExpr, RuleTerm, Schema};
use std::collections::BTreeMap;

fn implies(have: &RuleExpr, need: &RuleExpr) -> bool {
    if matches!(need, RuleExpr::Eq(a,b) if a == b && matches!(a, RuleTerm::Field(_) | RuleTerm::Viewer | RuleTerm::Literal(_))) || have == need || need.is_uniformly_readable() || matches!(have, RuleExpr::Deny) { return true; }
    match (have, need) {
        (_, RuleExpr::And(items)) => items.iter().all(|n| implies(have, n)),
        (RuleExpr::Or(items), _) => items.iter().all(|h| implies(h, need)),
        (RuleExpr::And(items), _) => items.iter().any(|h| implies(h, need)),
        (_, RuleExpr::Or(items)) => items.iter().any(|n| implies(have, n)),
        (RuleExpr::Eq(a,b), RuleExpr::Eq(c,d)) => a == d && b == c,
        (RuleExpr::Exists { table:a, index:ai, key:ak, equalities:ae, .. }, RuleExpr::Exists { table:b, index:bi, key:bk, equalities:be, .. }) =>
            a == b && ai == bi && ak == bk && be.iter().all(|pair| ae.contains(pair)),
        _ => false,
    }
}
fn positive_probe(rule: &RuleExpr) -> bool {
    match rule {
        RuleExpr::Exists { .. } => true,
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().any(positive_probe),
        _ => false,
    }
}
#[derive(Clone)]
struct Origin { read: ReadExpr, gates: Vec<Expr>, path: Vec<String> }
type Locals = BTreeMap<String, Vec<Origin>>;
fn returned(catalog: &Catalog, value: &Expr, gates: &[Expr], locals: &Locals) -> Vec<Origin> {
    let read = match value {
        Expr::Read(read) => catalog.source.read(&read.site).map(|r| r.0).or_else(|| Some(read.clone())),
        Expr::Merge(merge) => catalog.source.read(&merge.site).map(|r| r.0),
        _ => None,
    };
    if let Some(read) = read { return vec![Origin { read, gates: gates.to_vec(), path: Vec::new() }]; }
    match value {
        Expr::Name { name, .. } => locals.get(name).cloned().unwrap_or_default().into_iter().map(|mut origin| { origin.gates.extend_from_slice(gates); origin }).collect(),
        Expr::Member { base, name, .. } => returned(catalog, base, gates, locals).into_iter().filter_map(|mut origin| {
            if origin.path.is_empty() { return Some(origin); }
            if origin.path[0] != *name { return None; }
            origin.path.remove(0); Some(origin)
        }).collect(),
        Expr::Shape { base, .. } | Expr::Assert { value: base, .. } | Expr::ShapeUse { base, .. } => returned(catalog, base, gates, locals),
        Expr::Array { items, .. } => items.iter().flat_map(|v| returned(catalog, v, gates, locals)).collect(),
        Expr::Object { fields, .. } => fields.iter().flat_map(|f| {
            let value = f.value.clone().unwrap_or_else(|| Expr::Name { name: f.name.clone(), site: f.site.clone() });
            returned(catalog, &value, gates, locals).into_iter().map(|mut origin| {
                if !f.spread { origin.path.insert(0, f.name.clone()); }
                origin
            }).collect::<Vec<_>>()
        }).collect(),
        Expr::If { condition, then, otherwise, .. } => {
            let mut yes = gates.to_vec(); yes.push(*condition.clone());
            let mut no = gates.to_vec(); no.push(Expr::Unary { op: "not".into(), value: condition.clone(), site: condition.site().clone() });
            returned(catalog, then, &yes, locals).into_iter().chain(returned(catalog, otherwise, &no, locals)).collect()
        }
        _ => Vec::new(),
    }
}
pub(super) fn notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for program in catalog.documents.iter().flat_map(|d| &d.programs).filter(|p| p.kind == ProgramKind::Query && !p.native) {
        let body: Vec<_> = program.prelude.iter().chain(&program.body).cloned().collect();
        inspect(catalog, schema, program, &body, Vec::new(), Locals::new(), &mut notes);
    }
    notes
}
fn inspect(catalog: &Catalog, schema: &Schema, program: &ProgramDecl, body: &[Stmt], mut gates: Vec<Expr>, mut locals: Locals, notes: &mut Vec<Diagnostic>) -> Option<Locals> {
    for statement in body {
        match statement {
            Stmt::Require { condition, .. } => gates.push(condition.clone()),
            Stmt::If { condition, then_body, else_body, .. } => {
                let mut yes = gates.clone(); yes.push(condition.clone());
                let yes = inspect(catalog, schema, program, then_body, yes, locals.clone(), notes);
                let mut no = gates.clone(); no.push(Expr::Unary { op: "not".into(), value: Box::new(condition.clone()), site: condition.site().clone() });
                let no = inspect(catalog, schema, program, else_body, no, locals.clone(), notes);
                locals = match (yes, no) {
                    (Some(mut a), Some(b)) => { for (name, origins) in b { a.entry(name).or_default().extend(origins); } a }
                    (Some(a), None) | (None, Some(a)) => a,
                    (None, None) => return None,
                };
            }
            Stmt::Return { value, .. } => {
                for origin in returned(catalog, value, &gates, &locals) {
                    let mut all_gates = origin.gates; all_gates.extend(gates.clone());
                    inspect_read(catalog, schema, program, &origin.read, &all_gates, notes);
                }
                return None;
            }
            Stmt::Bind { names, value, .. } => {
                let origins = returned(catalog, value, &gates, &locals);
                for name in names { locals.remove(name); }
                if names.len() == 1 { locals.insert(names[0].clone(), origins); }
            }
            Stmt::For { body, .. } => {
                if let Some(iterated) = inspect(catalog, schema, program, body, gates.clone(), locals.clone(), notes) {
                    for (name, origins) in iterated { locals.entry(name).or_default().extend(origins); }
                }
            }
            Stmt::Expr { .. } | Stmt::Emit { .. } | Stmt::As { .. } => gates.clear(),
            Stmt::Break { .. } | Stmt::Continue { .. } => return None,
        }
    }
    Some(locals)
}

fn inspect_read(catalog: &Catalog, schema: &Schema, program: &ProgramDecl, read: &ReadExpr, gates: &[Expr], notes: &mut Vec<Diagnostic>) {
    let Some(info) = catalog.tables.get(&read.table).filter(|t| t.maintained.is_none() && t.through.is_none()) else { return };
    let Some(table) = schema.table(&read.table).filter(|t| !t.rules.read.is_uniformly_readable() && !matches!(t.rules.read, RuleExpr::Deny)) else { return };
    // Give operation arguments stable symbolic field identities for
    // this proof only. The real schema and authority are untouched.
    let mut context = info.clone();
    for arg in &program.args { context.columns.insert(format!("$queryArg:{}", arg.name), arg.type_.clone()); }
    let bind = |value: &Expr| {
        let mut value = value.clone();
        super::intent_walk::expression(&mut value, &mut |expr| {
            if let Expr::Name { name, site } = expr && program.args.iter().any(|a| a.name == *name) {
                *expr = Expr::Member { base: Box::new(Expr::Focal { site: site.clone() }), name: format!("$queryArg:{name}"), site: site.clone() };
            }
        });
        super::schema::bind_rule(catalog, &context, &RuleDecl { effect: Effect::Read, bindings: Vec::new(), site: value.site().clone(), value }).ok()
    };
    let Some(rule) = info.decl.rules.iter().find(|r| r.effect == Effect::Read) else { return };
    let mut expected = rule.value.clone();
    let pins = super::auth_lints::pins(catalog, &read).unwrap_or_default();
    super::intent_walk::expression(&mut expected, &mut |expr| {
        if let Expr::Member { base, name, .. } = expr && matches!(base.as_ref(), Expr::Focal { .. }) && let Some(value) = pins.get(name) { *expr = value.clone(); }
    });
    let Some(expected) = bind(&expected) else { return };
    let mut conditions: Vec<_> = gates.iter().filter_map(bind).collect();
    if !conditions.iter().any(positive_probe) { return; }
    if let Some(filter) = &read.filter && let Some(rule) = bind(filter) { conditions.push(rule); }
    for key in &read.keys {
        if let Some(column) = &key.column {
            let equality = Expr::Binary { op: "=".into(), left: Box::new(Expr::Member { base: Box::new(Expr::Focal { site: key.site.clone() }), name: column.clone(), site: key.site.clone() }), right: Box::new(key.value.clone()), site: key.site.clone() };
            if let Some(rule) = bind(&equality) { conditions.push(rule); }
        }
    }
    if implies(&RuleExpr::And(conditions), &expected) { return; }
    if notes.iter().any(|n| n.code == "N_QUERY_FILTERED" && n.site == read.site) { return; }
    let site = info.decl.rules.iter().find(|r| r.effect == Effect::Read).map(|r| r.site.to_string()).unwrap_or_default();
    notes.push(Diagnostic::new(&read.site, "N_QUERY_FILTERED", format!("query {}: an explicit caller branch does not establish {}'s read rule `{}` at {site}; that branch may return fewer rows or an empty page after table authorization. Roles may overlap; this is a missing read-authority proof", program.name, read.table, table.rules.read.quarry()), "require or filter by the matching table read condition in each branch, or deliberately handle caller-filtered rows; the query never widens table authority. Authorization recipes: guide rule-recipes").guide("rules"));
}
