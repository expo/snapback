//! Guarded views keep historical extracted cells as authorized result projections.
// @ref LLP 3000.000.000.003#2-frozen-result-fields — only the receipt-owned extraction child represents the original parent payload; never choose a followup.
use crate::{ast::{Expr, Stmt}, types::Ty, release_bridge::Bridge};
use std::collections::{BTreeMap,BTreeSet};

pub(super) fn preserve(target:&[(String,String)], bridge:&mut Bridge) {
    if !bridge.diagnostics.is_empty(){return;}
    let old=crate::compile(target);let current=crate::compile(&bridge.sources);let mut needed_children=BTreeSet::new();
    if current.schema.extractions.is_empty(){return;}
    fn table(ty:&Ty)->Option<&str>{match ty{Ty::Row(t)|Ty::WriteRow(t)|Ty::Page(t,_)=>Some(t),Ty::Optional(t)|Ty::List(t,_)|Ty::Collection(t,_)=>table(t),_=>None}}
    fn returns<'a>(body:&'a [Stmt],out:&mut Vec<&'a Expr>,implicit:bool){
        for(i,stmt)in body.iter().enumerate(){match stmt{
            Stmt::Return{value,..}=>out.push(value),
            Stmt::Expr{value,..}if implicit&&i+1==body.len()=>out.push(value),
            Stmt::If{then_body,else_body,..}=>{returns(then_body,out,false);returns(else_body,out,false);},
            Stmt::For{body,..}|Stmt::As{body,..}=>returns(body,out,false),_=>()
        }}
    }
    for(file,text)in &mut bridge.sources {
        let doc=crate::parser::parse_document(file,text).0;let mut edits=Vec::new();let mut helpers=BTreeMap::new();
        for program in &doc.programs {
            let name=crate::release_bridge::operation_name(file,&program.name);
            let Some(before)=old.programs.iter().find(|p|p.program.name==name)else{continue};
            let Some(parent)=table(&before.result).map(str::to_owned).or_else(||crate::release_result_lineage::table(&before.program))else{continue};
            let Some(after)=current.programs.iter().find(|p|p.program.name==name)else{continue};
            // A changed operation returning unrelated data is a compatibility review,
            // not permission to invent parent identity from an arbitrary object.
            if table(&after.result).map(str::to_owned).or_else(||crate::release_result_lineage::table(&after.program)).as_deref()!=Some(parent.as_str()){continue;}
            let served=crate::client_contracts::result_fields(&after.result,&current);
            let mut projections=Vec::new();
            for extraction in current.schema.extractions.iter().filter(|e|!e.each&&e.parent==parent){
                let Some(old_parent)=old.schema.table(&parent)else{continue};
                for(child_column,parent_column)in &extraction.fields {
                    if !old_parent.columns.contains_key(parent_column)||current.schema.tables[&parent].columns.contains_key(parent_column)
                        ||served.contains_key(parent_column)||served.contains_key(&format!("[].{parent_column}")){continue;}
                    let helper=format!("rollbackResult_{}_{}",extraction.child,child_column);
                    let column=extraction.result_column();let index=format!("rollbackOriginal_{}",extraction.child);
                    let definition=format!("fn {helper}(parent: id):\n  original = {}[{column} = parent] by {index}\n  if original != null and original.{} = parent:\n    return original.{child_column}\n  return null\n",extraction.child,extraction.reference);
                    if let Some(existing)=doc.functions.iter().find(|f|f.name==helper){
                        let tokens=|text:&str|crate::lexer::lex(file,text).0.into_iter().filter(|t|!matches!(t.kind,crate::lexer::Kind::Newline|crate::lexer::Kind::Indent|crate::lexer::Kind::Dedent|crate::lexer::Kind::Eof)).map(|t|(t.kind,t.value)).collect::<Vec<_>>();
                        let same=doc.source.declarations.get(&existing.site.to_string()).is_some_and(|text|tokens(text)==tokens(&definition));
                        if !same||!extraction.has_result_anchor(&current.schema.tables[&extraction.child]){
                            bridge.diagnostics.push(crate::diag::type_error(&program.site,format!("generated rollback result helper {helper} conflicts with authored code"),"rename the authored helper before registering this view"));continue;
                        }
                    }
                    helpers.insert(helper.clone(),definition);needed_children.insert(extraction.child.clone());
                    projections.push(format!("{parent_column}: {helper}(.id)"));
                }
            }
            if projections.is_empty(){continue;}
            let mut values=Vec::new();returns(&program.body,&mut values,true);
            for value in values {
                if matches!(value,Expr::Literal{value:crate::ast::Literal::Null,..}){continue;}
                if let Some((start,raw))=doc.source.expression_source(value) {
                    let offset=text.split_inclusive('\n').take(start.line.saturating_sub(1)as usize).map(str::len).sum::<usize>()
                        +text.lines().nth(start.line.saturating_sub(1)as usize).unwrap_or("").chars().take(start.col.saturating_sub(1)as usize).map(char::len_utf8).sum::<usize>();
                    edits.push((offset,offset+raw.len(),format!("({raw}) {{ *, {} }}",projections.join(", "))));
                }
            }
            bridge.changes.push(format!("operation {name}: historical {parent} extracted result fields [{}] remain readable through the authorized receipt-owned child; absent payloads return null, never an arbitrary followup",projections.iter().filter_map(|p|p.split_once(':').map(|p|p.0)).collect::<Vec<_>>().join(", ")));
        }
        let mut spans=BTreeSet::new();edits.retain(|(a,b,_)|spans.insert((*a,*b)));edits.sort_by_key(|e|std::cmp::Reverse(e.0));
        for(a,b,value)in edits{text.replace_range(a..b,&value);}
        for(name,helper)in &helpers{if !doc.functions.iter().any(|f|&f.name==name){text.push('\n');text.push_str(helper);}}
    }
    let needed=current.schema.extractions.iter().filter(|e|!e.each&&needed_children.contains(&e.child)).collect::<Vec<_>>();
    for(file,text)in &mut bridge.sources {
        let doc=crate::parser::parse_document(file,text).0;let mut edits=Vec::new();
        for extraction in &needed {
            let column=extraction.result_column();let index=format!("rollbackOriginal_{}",extraction.child);
            if let Some(table)=doc.tables.iter().find(|t|t.name==extraction.child){
                if table.columns.iter().any(|c|c.name==column)||table.indexes.iter().any(|i|i.name==index){
                    if extraction.has_result_anchor(&current.schema.tables[&extraction.child]){continue;}
                    bridge.diagnostics.push(crate::diag::type_error(&table.site,"rollback result anchor collides with authored child data","rename that field/index before preparing a guarded view"));continue;
                }
                let offset=text.split_inclusive('\n').take(table.site.line as usize).map(str::len).sum::<usize>();
                edits.push((offset,format!("  {column}: {} ? on delete keep write <- deny\n  immutable {column}\n  unique {index}: {column}\n",extraction.parent)));
            }
        }
        edits.sort_by_key(|e|std::cmp::Reverse(e.0));for(offset,addition)in edits{text.insert_str(offset,&addition);}
    }
    bridge.diagnostics.extend(crate::compile(&bridge.sources).diagnostics);
}
