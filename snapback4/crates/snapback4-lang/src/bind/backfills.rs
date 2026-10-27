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
    for d in catalog.documents.iter().flat_map(|d|&d.extractions) {
        let extraction=snapback4_core::schema::Extraction{each:d.each,child:d.child.clone(),parent:d.parent.clone(),reference:d.reference.clone(),fields:d.fields.iter().cloned().collect()};
        // @ref LLP 3000.000.000.003#5-loosen-required-and-release-refusals-rel4 — check refuses invented historical birth timestamps before adoption.
        if let Some(child)=schema.table(&extraction.child) {
            for (column,default) in &child.defaults {
                if column!=&extraction.reference && !extraction.fields.contains_key(column)
                    && !matches!(default,snapback4_core::schema::ColumnDefault::Literal(_)) {
                    diagnostics.push(type_error(&d.site,format!("extract {} from {} cannot supply {}.{} default {} for historical rows",extraction.child,extraction.parent,extraction.child,column,match default{snapback4_core::schema::ColumnDefault::Now=>"now",_=>"viewer"}),"use a literal default, make the column optional without a default, or map a retained parent timestamp explicitly").guide("deploy"));
                }
            }
        }
        schema.extractions.push(extraction);
    }
    let mut forward_names=BTreeSet::new();let mut forward_outputs=BTreeSet::new();
    for d in catalog.documents.iter().flat_map(|d|&d.backfills) {bind_one(catalog,schema,diagnostics,d,false,&mut forward_names,&mut forward_outputs);}
    let mut down_names=BTreeSet::new();let mut down_outputs=BTreeSet::new();
    for d in catalog.documents.iter().flat_map(|d|&d.downfills) {bind_one(catalog,schema,diagnostics,d,true,&mut down_names,&mut down_outputs);}
    bind_enum_aliases(catalog,schema,diagnostics,&mut forward_names,&mut forward_outputs,&mut down_names,&mut down_outputs);
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
            if (asset(&column.type_.kind)||matches!(&column.type_.kind,ast::TypeKind::Ref{..})) && column.maintained.is_none() && column.sequence.is_none() && column.written_by.is_none() {
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

// @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — enum spelling aliases lower to ordinary reversible receipts.
fn bind_enum_aliases(catalog:&Catalog,schema:&mut Schema,diagnostics:&mut Vec<Diagnostic>,forward_names:&mut BTreeSet<(String,String)>,forward_outputs:&mut BTreeSet<(String,String)>,down_names:&mut BTreeSet<(String,String)>,down_outputs:&mut BTreeSet<(String,String)>){
    let mut groups:BTreeMap<(String,String),Vec<_>>=BTreeMap::new();
    for (table,column,old,new,site) in catalog.documents.iter().flat_map(|d|&d.enum_aliases){groups.entry((table.clone(),column.clone())).or_default().push((old,new,site));}
    for((table,column),aliases)in groups {
        let site=aliases[0].2;
        let decl=catalog.documents.iter().flat_map(|d|&d.tables).find(|t|t.name==table).and_then(|t|t.columns.iter().find(|c|c.name==column));
        let Some(decl)=decl else {diagnostics.push(unknown(site,format!("enum alias column {table}.{column} is not declared"),"name a current enum column"));continue};
        let ast::TypeKind::Enum{variants}= &decl.type_.kind else {diagnostics.push(type_error(site,"value aliases require an enum column","declare an enum column"));continue};
        let mut origins=BTreeSet::new();let mut destinations=BTreeSet::new();
        if aliases.iter().any(|(old,new,_)|old==new||variants.contains(old)||!variants.contains(new)||!origins.insert((*old).clone())||!destinations.insert((*new).clone())) {
            diagnostics.push(type_error(site,format!("enum aliases on {table}.{column} must be injective predecessor-only spellings to distinct current variants"),"use explicit backfill/down for a merge or changed business meaning"));continue;
        }
        let mut old_type=decl.type_.clone();if let ast::TypeKind::Enum{variants}=&mut old_type.kind {for(old,new,_)in &aliases {variants.retain(|v|v!=*new);variants.push((*old).clone());}variants.sort();}
        for down in [false,true] {
            let mut value=ast::Expr::Name{name:column.clone(),site:site.clone()};
            for(old,new,_)in aliases.iter().rev() {
                let(from,to)=if down{(new,old)}else{(old,new)};
                let string=|v:&String|ast::Expr::Literal{value:ast::Literal::Str(v.clone()),site:site.clone()};
                value=ast::Expr::If{then:Box::new(string(to)),condition:Box::new(ast::Expr::Binary{op:"=".into(),left:Box::new(ast::Expr::Name{name:column.clone(),site:site.clone()}),right:Box::new(string(from)),site:site.clone()}),otherwise:Box::new(value),site:site.clone()};
            }
            let name=format!("$enum:{}:{column}:{}",if down{"down"}else{"up"},aliases.iter().map(|(a,b,_)|format!("{a}:{b}")).collect::<Vec<_>>().join(":"));
            let fill=ast::BackfillDecl{table:table.clone(),name,args:vec![ast::ArgDecl{name:column.clone(),type_:if down{decl.type_.clone()}else{old_type.clone()},alias:None,default:None,deprecated:false,site:site.clone()}],value:ast::Expr::Object{fields:vec![ast::ObjectField{spread:false,name:column.clone(),value:Some(value),site:site.clone()}],site:site.clone()},site:site.clone()};
            if down {bind_one(catalog,schema,diagnostics,&fill,true,down_names,down_outputs)}else{bind_one(catalog,schema,diagnostics,&fill,false,forward_names,forward_outputs)}
        }
    }
}
