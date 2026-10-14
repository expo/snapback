//! Required point-read row images are lexical snapshots. Selecting their
//! stored scalar fields reads no other row; expose those fixed values to page
//! planning without declaring copied audience fields equal to their parents.
// @ref LLP 3000.036.001#17 — parent-pinned pages use stored snapshot keys.
use crate::ast::*;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn lower_program(program: &mut ProgramDecl, fields: &BTreeMap<String, BTreeSet<String>>) {
    if program.kind != ProgramKind::Query || program.native || !program.prelude.is_empty() { return; }
    body(&mut program.body, fields, &BTreeMap::new(), &mut 0);
}

fn body(statements: &mut Vec<Stmt>, fields: &BTreeMap<String, BTreeSet<String>>, inherited: &BTreeMap<String,String>, serial: &mut usize) {
    let mut rows = inherited.clone();
    let mut out = Vec::new();
    for mut stmt in std::mem::take(statements) {
    if let Stmt::Bind { value, .. } | Stmt::Return { value, .. } = &mut stmt {
                let read = match value { Expr::Read(read) => Some(read), Expr::Shape { base, .. } | Expr::ShapeUse { base, .. } =>
                    if let Expr::Read(read) = base.as_mut() { Some(read) } else { None }, _ => None };
                if let Some(read) = read && read.range.is_some() && let Some(filter) = &mut read.filter {
                    let mut selected = BTreeMap::new();
                    super::intent_walk::expression(filter, &mut |value| {
                        let Expr::Member { base, name, site } = value else { return };
                        let Expr::Name { name: row, .. } = base.as_ref() else { return };
                        if !rows.get(row).and_then(|table| fields.get(table)).is_some_and(|fields| fields.contains(name)) { return; }
                        let key = (row.clone(),name.clone());
                        let site = site.clone();
                        let snapshot = value.clone();
                        let fixed = selected.entry(key).or_insert_with(|| {
                            *serial += 1; let fixed = format!("$pageKey{serial}");
                            out.push(Stmt::Bind { names: vec![fixed.clone()], value: snapshot, site: site.clone() }); fixed
                        }).clone();
                        *value=Expr::Name {name:fixed,site:site.clone()};
                    });
                }
            }
        match &mut stmt {
            Stmt::Bind { names, value, .. } => {
                for name in names.iter() { rows.remove(name); }
                let [name] = names.as_slice() else { out.push(stmt); continue };
                if let Expr::Assert { value, .. } = value && let Expr::Read(read) = value.as_ref()
                    && !read.keys.is_empty() && read.range.is_none() && read.filter.is_none() && read.matching.is_none()
                    && fields.contains_key(&read.table) { rows.insert(name.clone(),read.table.clone()); }
            }
            Stmt::If { then_body, else_body, .. } => {
                body(then_body, fields, &rows, serial); body(else_body, fields, &rows, serial);
                // A name may be rebound in either arm. Do not assume its old
                // snapshot type on the joined path.
                rows.clear();
            }
            Stmt::For { .. } | Stmt::As { .. } => { rows.clear(); }
            _ => {}
        }
        out.push(stmt);
    }
    *statements=out;
}
