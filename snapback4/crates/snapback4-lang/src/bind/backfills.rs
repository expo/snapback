//! Bind historical arguments without requiring them in the current row type.
use super::*;
use crate::{ast, diag::{type_error, unknown}, types::{Ty, scalar_to_column}};
use snapback4_core::schema::backfill::Backfill;
use std::collections::{BTreeMap, BTreeSet};

fn bind_one(
    catalog:&Catalog,schema:&mut Schema,diagnostics:&mut Vec<Diagnostic>,d:&ast::BackfillDecl,down:bool,
    names:&mut BTreeSet<(String,String)>,outputs:&mut BTreeSet<(String,String)>,
) {
    let word=if down{"down projection"}else{"backfill"};
    if !names.insert((d.table.clone(),d.name.clone())) { diagnostics.push(unknown(&d.site,format!("duplicate {word} name on this table"),"give each historical transform its own name")); return; }
    let decl = ast::ProgramDecl { delivery: None, held:false, predicts:false, server:false, kind:ast::ProgramKind::Query,
        name: format!("{}{}{}",if down{"down"}else{"backfill"},d.table,d.name), args:d.args.clone(), prelude:vec![],
        body:vec![ast::Stmt::Return { value:d.value.clone(), site:d.site.clone() }], native:false, site:d.site.clone() };
    let Some(bound) = program::Binder::bind_historical(catalog,schema,"schema",&decl,diagnostics) else {return};
    let Ty::Object(fields) = &bound.result else { diagnostics.push(type_error(&d.site,format!("{word} returns an object patch"),"{ column: historicalValue }")); return; };
    let Some(table) = schema.table(&d.table) else {diagnostics.push(unknown(&d.site,format!("{word} table is not declared"),"declare the current table"));return};
    for (c,ty) in fields {
        if !down {if let Some(kind) = table.columns.get(c) {
            if !ty.assignable_to(&Ty::from_column(kind)) { diagnostics.push(type_error(&d.site,format!("backfill {}.{c} returns {}, expected {}",d.table,ty.name(),kind),"return a value fitting the candidate column")); }
        }}
        if !outputs.insert((d.table.clone(),c.clone())) { diagnostics.push(type_error(&d.site,format!("{word}s overlap on {}.{c}",d.table),"combine simultaneous outputs in one declaration")); }
    }
    let fill = Backfill { table:d.table.clone(), name:d.name.clone(), inputs:d.args.iter().map(|a|(a.name.clone(),scalar_to_column(&a.type_))).collect::<BTreeMap<_,_>>(), outputs:fields.keys().cloned().collect(), program:bound.program };
    let admitted=if down {fill.admit_down(schema)}else{fill.admit(schema)};
    if let Err(why) = admitted { diagnostics.push(type_error(&d.site,why,"use deterministic typed fields and a scalar patch").guide("deploy")); }
    if down {schema.downfills.push(fill.normalized())}else{schema.backfills.push(fill.normalized())}
}

pub(super) fn bind(catalog: &Catalog, schema: &mut Schema, diagnostics: &mut Vec<Diagnostic>) {
    let mut forward_names=BTreeSet::new();let mut forward_outputs=BTreeSet::new();
    for d in catalog.documents.iter().flat_map(|d|&d.backfills) {bind_one(catalog,schema,diagnostics,d,false,&mut forward_names,&mut forward_outputs);}
    let mut down_names=BTreeSet::new();let mut down_outputs=BTreeSet::new();
    for d in catalog.documents.iter().flat_map(|d|&d.downfills) {bind_one(catalog,schema,diagnostics,d,true,&mut down_names,&mut down_outputs);}
    for table in catalog.documents.iter().flat_map(|d|&d.tables) {
        if let Some(old)=&table.renamed_from {
            if old==&table.name || catalog.tables.contains_key(old) || schema.table_renames.values().any(|v|v==old) {
                diagnostics.push(type_error(&table.site,"table rename requires one distinct predecessor-only source","keep one name for each row lifetime"));
            } else {schema.table_renames.insert(table.name.clone(),old.clone());}
        }
        for column in table.columns.iter().filter(|c|c.renamed_from.is_some()) {
            let old=column.renamed_from.as_ref().unwrap();
            if old==&column.name || table.columns.iter().any(|c|&c.name==old) {
                diagnostics.push(type_error(&column.site,format!("rename source {}.{old} must be a distinct predecessor-only column",table.name),"remove the current old column and retain only the renamed declaration"));continue
            }
            fn asset(kind:&ast::TypeKind)->bool {match kind {ast::TypeKind::Image{..}|ast::TypeKind::Video{..}|ast::TypeKind::File{..}=>true,ast::TypeKind::List{item,..}=>asset(&item.kind),_=>false}}
            if asset(&column.type_.kind) && column.maintained.is_none() && column.sequence.is_none() && column.written_by.is_none() {
                schema.asset_renames.entry(table.name.clone()).or_default().insert(column.name.clone(),old.clone());continue;
            }
            if matches!(&column.type_.kind, ast::TypeKind::Ref{..}|ast::TypeKind::Image{..}|ast::TypeKind::Video{..}|ast::TypeKind::File{..}|ast::TypeKind::List{..})
                || column.maintained.is_some() || column.sequence.is_some() || column.written_by.is_some()
            {
                diagnostics.push(type_error(&column.site,format!("column rename on {}.{} requires an authoritative scalar without reference, asset, collection, captured or lifetime ownership",table.name,column.name),"use a bridge migration that preserves the protected field's authority and lifetime"));continue
            }
            let declaration=|input:&str,output:&str,prefix:&str|ast::BackfillDecl{
                table:table.name.clone(),name:format!("$rename:{prefix}:{old}:{}",column.name),
                args:vec![ast::ArgDecl{alias:None,default:None,deprecated:false,name:input.into(),type_:column.type_.clone(),site:column.site.clone()}],
                value:ast::Expr::Object{fields:vec![ast::ObjectField{spread:false,name:output.into(),value:Some(ast::Expr::Name{name:input.into(),site:column.site.clone()}),site:column.site.clone()}],site:column.site.clone()},site:column.site.clone()
            };
            bind_one(catalog,schema,diagnostics,&declaration(old,&column.name,"up"),false,&mut forward_names,&mut forward_outputs);
            bind_one(catalog,schema,diagnostics,&declaration(&column.name,old,"down"),true,&mut down_names,&mut down_outputs);
        }
    }
}
