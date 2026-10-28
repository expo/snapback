//! Explicit null hiding preserves the current closure and refuses new null writes.
// @ref LLP 3000.000.000.003#5-loosen-required-and-release-refusals-rel4 — a hiding view changes only the selected null domain, never independent intent.
use crate::{ast,lexer,parser,print,release_bridge::{Bridge,type_span}};

pub fn hide_nulls(bridge:&mut Bridge,hides:&[ast::RollbackHide]) {
    if hides.is_empty(){return;}
    let before=crate::compile(&bridge.sources);
    let write_targets=before.programs.iter().flat_map(|p|p.sources.iter())
        .filter(|(key,_)|key.starts_with("write/"))
        .filter_map(|(_, (site,name))|name.split_once(' ').map(|(_,table)|(site.to_string(),table.to_owned())))
        .collect::<std::collections::BTreeMap<_,_>>();
    let hidden_columns=hides.iter().map(|h|format!("{}.{}",h.table,h.column)).collect::<Vec<_>>().join(", ");
    for fill in before.schema.backfills.iter().chain(&before.schema.downfills) {
        if hides.iter().any(|h|h.table==fill.table&&fill.outputs.contains(&h.column)) {
            bridge.diagnostics.push(crate::diag::type_error(&hides[0].site,format!("intentional rollback hiding of {hidden_columns} cannot retain migration {} writing the hidden column",fill.name),"remove rollback hides to retain a visible optional view, or preview the original source with rollback --to N --exact --check; migration definitions must retain their immutable identity").guide("deploy"));
            return;
        }
    }
    for (file,text) in &mut bridge.sources {
        let mut doc=parser::parse_document(file,text).0;
        let (tokens,_)=lexer::lex(file,text);
        let mut edits=Vec::new();
        for table in &doc.tables {for column in &table.columns {
            if hides.iter().any(|h|h.table==table.name&&h.column==column.name) {
                if let Some((a,b))=type_span(file,text,column) {
                    edits.push((a,b,print::scalar_type(&column.type_.required())));
                }
            }
        }}
        // Rollback directives are registration intent, not executable view source.
        // They were validated against the nullable authored source already.
        for hide in &doc.rollback_hides {
            let a=offset(text,hide.site.line,1);
            let b=text[a..].find('\n').map_or(text.len(),|n|a+n+1);
            edits.push((a,b,String::new()));
        }
        crate::bind::intent_walk::document(&mut doc,&mut |expr| {
            let ast::Expr::Write{table,fields,site,..}=expr else{return};
            let table=write_targets.get(&site.to_string()).map(String::as_str).unwrap_or(table.as_str());
            if !hides.iter().any(|h|h.table==table){return;}
            let site=site.clone();
            let mut changed=false;
            for field in fields.iter_mut() {
                if !hides.iter().any(|h|h.table==table&&h.column==field.name){continue;}
                let value=field.value.take().unwrap_or_else(||ast::Expr::Name{name:field.name.clone(),site:field.site.clone()});
                field.value=Some(ast::Expr::Assert{value:Box::new(value),code:"ROLLBACK_NULL".into(),message:Some(format!("{}.{}, null writes are paused in this intentional rollback hiding view; select the forward release to write an unquoted value",table,field.name)),site:field.site.clone()});
                changed=true;
            }
            if !changed{return;}
            // Replace the object alone: keys, conditions and surrounding control
            // flow retain their exact authored text. Tokens exclude string braces.
            let at=offset(text,site.line,site.col);
            let mut square=0;let mut curly=0;let mut start=None;
            for token in tokens.iter().filter(|t|offset(text,t.site.line,t.site.col)>=at) {
                if token.kind==lexer::Kind::Str {continue;}
                match token.value.as_str() {
                    "["=>square+=1,
                    "]"=>square-=1,
                    "{" if start.is_some()||square==0=>{curly+=1;if start.is_none(){start=Some(offset(text,token.site.line,token.site.col));}},
                    "}" if start.is_some()=>{curly-=1;if curly==0 {
                        let object=ast::Expr::Object{fields:fields.clone(),site:site.clone()};
                        edits.push((start.unwrap(),offset(text,token.site.line,token.site.col)+1,print::expression(&object)));break;
                    }},_=>(),
                }
            }
        });
        // Outer object edits already include transformed nested writes.
        edits.sort_by_key(|(a,b,_)|(*a,std::cmp::Reverse(*b)));
        let mut selected:Vec<(usize,usize,String)>=Vec::new();
        for edit in edits {
            if selected.last().is_some_and(|(_,b,_)|edit.0<*b){continue;}
            selected.push(edit);
        }
        for(a,b,value)in selected.into_iter().rev(){text.replace_range(a..b,&value);}
    }
    let after=crate::compile(&bridge.sources);
    if before.schema.backfills!=after.schema.backfills||before.schema.downfills!=after.schema.downfills||before.schema.extractions!=after.schema.extractions {
        bridge.diagnostics.push(crate::diag::type_error(&hides[0].site,format!("intentional rollback hiding of {hidden_columns} changes a migration definition"),"remove rollback hides to retain a visible optional view, or preview the original source with rollback --to N --exact --check; historical migration definitions cannot change meaning").guide("deploy"));
    }
    if !after.diagnostics.is_empty() {
        bridge.diagnostics.push(crate::diag::type_error(&hides[0].site,format!("intentional rollback hiding of {hidden_columns} cannot compile its narrowed writes (including any nullable spread inputs)"),"spell out hidden values to receive ROLLBACK_NULL assertions, or remove rollback hides and retain a visible optional view").guide("deploy"));
    }
    bridge.diagnostics.extend(after.diagnostics);
    bridge.changes.extend(hides.iter().map(|h|format!("{}.{}: intentional null hiding; current workflow and invariants retained; null writes refuse ROLLBACK_NULL in this view",h.table,h.column)));
}
fn offset(text:&str,line:u32,col:u32)->usize {
    let a=text.split_inclusive('\n').take(line.saturating_sub(1) as usize).map(str::len).sum::<usize>();
    a+text[a..].chars().take(col.saturating_sub(1) as usize).map(char::len_utf8).sum::<usize>()
}
