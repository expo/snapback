//! Advisory proof of a child owner copied and checked against a stable parent.
use super::catalog::Catalog;
use crate::ast::{self, Expr, ReadExpr, ShapeField};
use snapback4_core::schema::{Schema, Table, Constraint, ColumnType, RuleExpr, RuleTerm};
use std::collections::BTreeSet;
fn stable(table: &Table, fields: &[&str]) -> bool {
    if fields.iter().any(|field|table.written_by.contains_key(*field)||table.maintained.contains_key(*field)) { return false; }
    matches!(table.rules.update, RuleExpr::Deny) || fields.iter().all(|field| table.constraints.iter().any(|c| matches!(c, Constraint::Immutable { fields } if fields.iter().any(|f| f == field))))
}
fn conjuncts(rule: &RuleExpr) -> Vec<&RuleExpr> { match rule { RuleExpr::And(rs) => rs.iter().flat_map(conjuncts).collect(), r => vec![r] } }
fn equality(rule: &RuleExpr, a: &RuleTerm, b: &RuleTerm) -> bool {
    conjuncts(rule).iter().any(|r| matches!(r, RuleExpr::Eq(x,y) if x == a && y == b || x == b && y == a))
}
fn rename(rule: &mut RuleExpr, child: &str, parent: &str) {
    let term = |t: &mut RuleTerm| if matches!(t, RuleTerm::Field(f) if f == child) { *t = RuleTerm::Field(parent.into()); };
    match rule {
        RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) | RuleExpr::Compare(_,a,b) => { term(a); term(b); }
        RuleExpr::And(rs) | RuleExpr::Or(rs) => for r in rs { rename(r,child,parent); },
        RuleExpr::Not(r) => rename(r,child,parent),
        RuleExpr::Exists { key,equalities,.. } | RuleExpr::Created { key,equalities,.. } => { for k in key { term(k); } for (_,v) in equalities { term(v); } },
        _ => {}
    }
}
// @ref LLP 3000.036.002#7 — no application assertion alone verifies stored child ownership.
pub(super) fn readable(catalog: &Catalog, schema: &Schema, read: &ReadExpr, known: &BTreeSet<String>) -> bool {
    let Some(child) = schema.table(&read.table) else { return false; };
    if schema.maintain_for(&read.table).is_some() || system_writes(catalog,&read.table) { return false; }
    for part in &read.keys {
        let Some(reference) = &part.column else { continue; };
        let Some(ColumnType::Ref { table: parent_name }) = child.columns.get(reference) else { continue; };
        let Some(parent) = schema.table(parent_name) else { continue; };
        // Immutable owner fields do not prevent a kept id being deleted and recreated.
        if child.on_delete.get(reference).is_some_and(|a| *a==snapback4_core::schema::references::OnDelete::Keep)
            && (!matches!(parent.rules.delete,RuleExpr::Deny) || parent.expire.is_some() || parent.ephemeral.is_some()) { continue; }
        if schema.maintain_for(parent_name).is_some() || system_writes(catalog,parent_name) { continue; }
        let input = crate::print::expression(&part.value);
        let known_parent = known.contains(&format!("exists {parent_name}[id = {input}]"));
        let projected_parent = matches!(&part.value, Expr::Member { base,name,.. } if name == "id" && matches!(base.as_ref(),Expr::Focal { .. }))
            && projected_from(catalog, read, parent_name);
        if !known_parent && !projected_parent { continue; }
        for (owner, kind) in &child.columns {
            if *kind != ColumnType::Principal || !stable(child, &[reference,owner]) { continue; }
            for (parent_owner, kind) in &parent.columns {
                if *kind != ColumnType::Principal || !stable(parent, &[parent_owner]) { continue; }
                let a = RuleTerm::Field(owner.clone());
                let b = RuleTerm::Reference { table: parent_name.clone(), column: reference.clone(), field: parent_owner.clone(), old:false };
                let verified = child.rules.insert.disjuncts().iter().all(|branch| equality(branch,&a,&b)
                    || equality(branch,&a,&RuleTerm::Viewer) && equality(branch,&b,&RuleTerm::Viewer));
                if !verified || matches!(child.rules.insert,RuleExpr::Deny) { continue; }
                if child.rules.read.any_term(&|t| matches!(t,RuleTerm::Field(f) if f!=owner)) || parent.rules.read.any_term(&|t| matches!(t,RuleTerm::Field(f) if f!=parent_owner)) { continue; }
                let mut readers = child.rules.read.clone(); rename(&mut readers,owner,parent_owner);
                if readers == parent.rules.read { return true; }
            }
        }
    }
    false
}
fn system_writes(catalog:&Catalog,table:&str)->bool {
    catalog.documents.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ast::ProgramKind::Job).any(|p| {
        if p.native { return true; }
        let mut changed=false;let mut body=p.prelude.clone();body.extend(p.body.clone());
        super::intent_walk::statements(&mut body,&mut |e| if matches!(e,Expr::Write { table:t,.. } if t==table) || matches!(e,Expr::Call { .. }) { changed=true; });
        changed
    })
}
fn projected_from(catalog: &Catalog, wanted: &ReadExpr, parent: &str) -> bool {
    let mut found = false;
    for doc in &catalog.documents {
        for p in &doc.programs {
            let mut body = p.body.clone();
            super::intent_walk::statements(&mut body, &mut |expr| {
                if let Expr::Shape { base,fields,.. } = expr && matches!(base.as_ref(),Expr::Read(r) if r.table == parent) {
                    // Only the direct field's probe has this focal row. Nested shapes do not.
                    found |= fields.iter().any(|f| matches!(f,ShapeField::Field { value:Expr::Exists { read,.. },.. } if read.site == wanted.site));
                }
            });
        }
    }
    found
}
/// Positional typed table arguments denote id, even beside other unique keys.
pub(super) fn typed_id(catalog: &Catalog, read: &ReadExpr) -> bool {
    let [part] = read.keys.as_slice() else { return false; };
    let Expr::Name { name,.. } = &part.value else { return false; };
    for doc in &catalog.documents {
        for p in &doc.programs {
            if !p.args.iter().any(|a| a.name == *name && matches!(&a.type_.kind,ast::TypeKind::Ref { table } if table == &read.table)) { continue; }
            let mut seen = false; let mut body=p.body.clone();
            super::intent_walk::statements(&mut body,&mut |e| if matches!(e,Expr::Read(r) if r.site == read.site) { seen=true; });
            if seen { return true; }
        }
    }
    false
}
