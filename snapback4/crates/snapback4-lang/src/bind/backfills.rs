//! Bind historical arguments without requiring them in the current row type.
use super::*;
use crate::{ast, diag::{type_error, unknown}, types::{Ty, scalar_to_column}};
use snapback4_core::schema::backfill::Backfill;
use std::collections::{BTreeMap, BTreeSet};
pub(super) fn bind(catalog: &Catalog, schema: &mut Schema, diagnostics: &mut Vec<Diagnostic>) {
    let mut names = BTreeSet::new(); let mut outputs = BTreeSet::new();
    for d in catalog.documents.iter().flat_map(|d| &d.backfills) {
        if !names.insert((d.table.clone(),d.name.clone())) { diagnostics.push(unknown(&d.site,"duplicate backfill name on this table","give each historical transform its own name")); continue; }
        let decl = ast::ProgramDecl { delivery: None, held:false, predicts:false, server:false, kind:ast::ProgramKind::Query,
            name: format!("backfill{}{}",d.table,d.name), args:d.args.clone(), prelude:vec![],
            body:vec![ast::Stmt::Return { value:d.value.clone(), site:d.site.clone() }], native:false, site:d.site.clone() };
        let Some(bound) = program::Binder::bind(catalog,schema,"schema",&decl,diagnostics) else {continue};
        let Ty::Object(fields) = &bound.result else { diagnostics.push(type_error(&d.site,"backfill returns an object patch","{ column: historicalValue }")); continue; };
        let Some(table) = schema.table(&d.table) else {diagnostics.push(unknown(&d.site,"backfill table is not declared","declare the candidate table"));continue};
        for (c,ty) in fields {
            if let Some(kind) = table.columns.get(c) {
                if !ty.assignable_to(&Ty::from_column(kind)) { diagnostics.push(type_error(&d.site,format!("backfill {}.{c} returns {}, expected {}",d.table,ty.name(),kind),"return a value fitting the candidate column")); }
            }
            if !outputs.insert((d.table.clone(),c.clone())) { diagnostics.push(type_error(&d.site,format!("backfills overlap on {}.{c}",d.table),"combine simultaneous outputs in one backfill")); }
        }
        let fill = Backfill { table:d.table.clone(), name:d.name.clone(), inputs:d.args.iter().map(|a|(a.name.clone(),scalar_to_column(&a.type_))).collect::<BTreeMap<_,_>>(), outputs:fields.keys().cloned().collect(), program:bound.program };
        if let Err(why) = fill.admit(schema) { diagnostics.push(type_error(&d.site,why,"use deterministic historical fields and a scalar patch").guide("deploy")); }
        schema.backfills.push(fill.normalized());
    }
}
