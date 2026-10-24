//! A rollback view joins value domains and retains current authored authority.
// @ref LLP 3000.000.000.002#8-wave-21-release-evolution — generated source is reviewable; no automatic business-policy synthesis.
use crate::{ast::{self,TypeKind}, lexer::{self,Kind}, parser, print};
use std::collections::BTreeMap;
pub struct Bridge {pub sources:Vec<(String,String)>,pub changes:Vec<String>,pub diagnostics:Vec<crate::diag::Diagnostic>}

/// Injective current-to-view column identities from authored rename declarations.
/// Shared by index source transport and CLI hard-constraint admission.
pub use super::release_bridge_indexes::column_names as declared_column_names;
pub use super::release_bridge_indexes::align_current_schema;
pub use super::release_bridge_policy::Policies as PolicyComparison;

/// Source-domain inclusion includes text minima/formats, which live outside
/// ColumnType in the compiled schema. Never infer admission from advice prose.
pub fn requires_view(target:&[(String,String)],current:&[(String,String)])->bool {
    // An executable repair behind unchanged data and intent must not restore
    // the old implementation. Ordinary schema/intent evolution is governed by
    // visibility facts below, rather than the mere presence of an invariant.
    if same_data_and_intent(target,current)
        && !crate::compile(current).invariants.is_empty()
        && modules(target)!=modules(current) {return true;}
    let before_schema=crate::compile(target).schema;
    // @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — column authority alone is not a visibility risk.
    let after_schema=crate::compile(current).schema;
    // One historical child is not a uniqueness promise for future parents.
    // Retain the current child population when old source has only one cell.
    if after_schema.extractions.iter().any(|e|!e.each&&before_schema.table(&e.parent).is_some_and(|t|e.fields.values().any(|c|t.columns.contains_key(c)))) {return true;}

    let mut table_names=after_schema.table_renames.iter()
        .filter(|(_,old)|before_schema.tables.contains_key(*old))
        .map(|(new,old)|(new.clone(),old.clone())).collect::<BTreeMap<_,_>>();
    for(new,prior)in &before_schema.table_renames {
        if after_schema.tables.contains_key(prior)&&!after_schema.tables.contains_key(new) {
            table_names.insert(prior.clone(),new.clone());
        }
    }
    let after_schema=after_schema.with_table_names(&table_names).ok();
    let docs=current.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
    let tables=docs.iter().flat_map(|d|&d.tables).collect::<Vec<_>>();
    let mut aliases=tables.iter().filter_map(|t|t.renamed_from.as_ref().map(|old|(t.name.clone(),old.clone()))).collect::<BTreeMap<_,_>>();
    for(file,text)in target{for t in parser::parse_document(file,text).0.tables{if let Some(prior)=t.renamed_from{aliases.insert(t.name,prior);}}}
    fn normalize(t:&mut ast::ScalarType,aliases:&BTreeMap<String,String>){match &mut t.kind{TypeKind::Ref{table}=>{let mut seen=std::collections::BTreeSet::new();while let Some(old)=aliases.get(table){if !seen.insert(table.clone()){*table=seen.into_iter().min().unwrap();break}*table=old.clone();}},TypeKind::List{item,..}=>normalize(item,aliases),_=>()}}
    if super::release_bridge_constraints::relaxed(target,current) {return true;}
    for(file,text)in target {
        for old in parser::parse_document(file,text).0.tables {
            let Some(next)=tables.iter().find(|t|t.name==old.name||t.renamed_from.as_ref()==Some(&old.name)||old.renamed_from.as_ref()==Some(&t.name))else{continue};
            for col in &old.columns {
                let Some(candidate)=next.columns.iter().find(|c|c.name==col.name||c.renamed_from.as_ref()==Some(&col.name)||col.renamed_from.as_ref()==Some(&c.name))else{continue};
                let scalar=!matches!(&col.type_.kind,TypeKind::Ref{..}|TypeKind::List{..}|TypeKind::Image{..}|TypeKind::File{..}|TypeKind::Video{..});
                if scalar&&after_schema.as_ref().is_some_and(|s|s.downfills.iter().any(|d|d.table==old.name&&d.outputs.contains(&col.name))){continue;}
                let mut from=candidate.type_.clone();let mut to=col.type_.clone();normalize(&mut from,&aliases);normalize(&mut to,&aliases);
                if !crate::client_contracts::accepts(&crate::types::scalar_to_arg(&from),&crate::types::scalar_to_arg(&to)){return true}
            }
            let Some(columns)=declared_column_names(&old,next)else{return true};
            let normalize_columns=|fields:&[String]|fields.iter().map(|c|columns.get(c).unwrap_or(c).clone()).collect::<Vec<_>>();
            if old.indexes.iter().any(|i|i.unique&&!next.indexes.iter().any(|n|n.unique&&after_schema.as_ref().is_some_and(|schema|
                super::release_bridge_indexes::same_key(&before_schema,schema,&old.name,i,n,&columns)))){return true}
            if old.caps.iter().any(|c|!next.caps.iter().any(|n|normalize_columns(&n.by)==c.by&&n.max<=c.max)){return true}
        }
    }false
}

fn modules(sources:&[(String,String)])->Vec<(String,String)> {
    let mut out=sources.iter().map(|(file,text)|(std::path::Path::new(file).file_stem().unwrap_or(std::ffi::OsStr::new("schema")).to_string_lossy().into_owned(),text.clone())).collect::<Vec<_>>();out.sort();out
}

pub(super) fn operation_name(file:&str,name:&str)->String {
    let module=std::path::Path::new(file).file_stem().and_then(|s|s.to_str()).unwrap_or("schema");
    if module=="schema"{name.to_owned()}else{format!("{module}.{name}")}
}

/// Compare authored data/intent declarations and executable signatures, while
/// excluding executable bodies. Module identity and wire signatures still count.
pub fn same_data_and_intent(target:&[(String,String)],current:&[(String,String)])->bool {
    fn signature(sources:&[(String,String)])->Vec<(String,Vec<(lexer::Kind,String)>)> {
        modules(sources).into_iter().map(|(module,text)| {
            let doc=parser::parse_document(&module,&text).0;
            let mut edits=Vec::new();
            for site in doc.programs.iter().map(|p|&p.site).chain(doc.functions.iter().map(|p|&p.site)) {
                let start=offset(&text,site.line,1);
                let declaration=declaration(&text,site.line);
                let (tokens,_)=lexer::lex(&module,&declaration);
                let mut depth=0;
                if let Some(colon)=tokens.iter().find(|token| {
                    match token.value.as_str(){"("|"["|"{"=>depth+=1,")"|"]"|"}"=>depth-=1,_=>()}
                    token.value==":"&&depth==0
                }) {
                    let end=(start+declaration.len()).min(text.len());
                    let body=start+offset(&declaration,colon.site.line,colon.site.col)+1;
                    edits.push((body,end));
                }
            }
            let mut text=text;
            edits.sort_by_key(|e|std::cmp::Reverse(e.0));
            for (start,end) in edits {text.replace_range(start..end,"\n");}
            let (tokens,_)=lexer::lex(&module,&text);
            (module,tokens.into_iter().map(|t|(t.kind,t.value)).collect())
        }).collect()
    }
    signature(target)==signature(current)
}

pub fn loosen(target:&[(String,String)],current:&[(String,String)])->Bridge {
    let mut bridge=loosen_inner(target,current);
    for diagnostic in &mut bridge.diagnostics {
        if diagnostic.site.line==0 {
            let docs=current.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
            diagnostic.site=docs.iter().flat_map(|d|&d.programs).find(|p|diagnostic.message.contains(&p.name)).map(|p|p.site.clone())
                .or_else(||docs.iter().flat_map(|d|&d.tables).find_map(|t|t.columns.iter().find(|c|diagnostic.message.contains(&format!("{}.{}",t.name,c.name))).map(|c|c.site.clone())))
                .or_else(||docs.iter().flat_map(|d|&d.tables).next().map(|t|t.site.clone()))
                .unwrap_or_else(||crate::Site::new(current.first().map(|s|s.0.as_str()).unwrap_or("schema.q"),1,1));
        }
    }
    bridge
}
fn loosen_inner(target:&[(String,String)],current:&[(String,String)])->Bridge {
    let current_bound=crate::compile(current);
    if current_bound.schema.extractions.iter().any(|e|!e.each)||!current_bound.invariants.is_empty()||current_bound.schema.tables.values().any(|t|!t.column_writes.is_empty()||!t.frozen_columns.is_empty()) {
        let mut allow_guarded=false;
        let complete=super::release_bridge_current::prepare(target,current,&mut allow_guarded);
        if complete.diagnostics.is_empty() || !allow_guarded{return complete;}
        // A complete current closure is preferred, but a selective guarded
        // predecessor is also truthful when its retained contracts compile.
        let guarded=super::release_bridge_current::guarded(target,current);
        if guarded.diagnostics.is_empty(){return guarded;}
        return Bridge{diagnostics:complete.diagnostics.into_iter().chain(guarded.diagnostics).collect(),..guarded};
    }
    let guarded=loosen_guarded(target,current);
    if !guarded.diagnostics.is_empty(){
        let complete=super::release_bridge_current::prepare(target,current,&mut false);
        if complete.diagnostics.is_empty(){return complete;}
        let current_bridge=super::release_bridge_current::guarded(target,current);
        if current_bridge.diagnostics.is_empty(){return current_bridge;}
    }
    guarded
}

fn loosen_guarded(target:&[(String,String)],current:&[(String,String)])->Bridge {
    let new: BTreeMap<_,_>=current.iter().flat_map(|(file,text)|parser::parse_document(file,text).0.tables.into_iter().map(move|t|(t.name.clone(),(file,text,t)))).collect();
    let mut new=new;
    for (_,(_,_,table)) in new.clone() {if let Some(old)=&table.renamed_from {if let Some(value)=new.get(&table.name).cloned(){new.insert(old.clone(),value);}}}
    for(file,text)in target {for old in parser::parse_document(file,text).0.tables {if let Some(prior)=&old.renamed_from {if !new.contains_key(&old.name){if let Some(value)=new.get(prior).cloned(){new.insert(old.name.clone(),value);}}}}}
    let mut domain_diagnostics=Vec::new();let mut changes=Vec::new();let mut affected=std::collections::BTreeSet::new();let mut sources=target.to_vec();let mut names=std::collections::BTreeSet::new();
    for (file,text) in &mut sources {
        let document=parser::parse_document(file,text).0;let mut edits=Vec::new();
        for table in &document.tables {
            names.insert(table.name.clone());
            let Some((_,_,next))=new.get(&table.name) else {continue};
            if next.name!=table.name {affected.insert(table.name.clone());changes.push(format!("table {}: current spelling {}; target spelling routes the same identity",table.name,next.name));}
            for column in &table.columns {
                let Some(candidate)=next.columns.iter().find(|c|c.name==column.name || c.renamed_from.as_ref()==Some(&column.name)||column.renamed_from.as_ref()==Some(&c.name)) else {continue};
                if candidate.name!=column.name {affected.insert(table.name.clone());changes.push(format!("{}.{}: current column spelling {}; target spelling routes the same cell",table.name,column.name,candidate.name));}
                let Some(joined)=join(&column.type_,&candidate.type_,&new) else {domain_diagnostics.push(crate::diag::type_error(&column.site,format!("rollback view for {}.{} has incompatible predecessor/current domains {} / {}",table.name,column.name,print::scalar_type(&column.type_),print::scalar_type(&candidate.type_)),"author a truthful compatible source and typed migration before deploying").guide("deploy"));continue};
                // A current guard may rely on a value being impossible under its
                // schema. Never reintroduce predecessor-only values behind that
                // same predicate merely because another column needs widening.
                let mut current_domain=join(&candidate.type_,&candidate.type_,&new).unwrap();
                let mut joined_domain=joined.clone();
                fn normalize(t:&mut ast::ScalarType,tables:&BTreeMap<String,(&String,&String,ast::TableDecl)>){
                    match &mut t.kind {
                        TypeKind::Ref{table}=>{if let Some((_,_,next))=tables.get(table){*table=next.name.clone();}},
                        TypeKind::List{item,..}=>normalize(item,tables),
                        TypeKind::Enum{variants}=>variants.sort(), _=>()
                    }
                }
                normalize(&mut current_domain,&new);normalize(&mut joined_domain,&new);
                if current_domain!=joined_domain {
                    domain_diagnostics.push(crate::diag::type_error(&column.site,format!("rollback view for {}.{} would admit predecessor values excluded by the current domain; current authority may depend on their absence",table.name,column.name),"author a compatible rollback source preserving the current domain and truthful migrations; do not widen a current confidentiality or safety boundary").guide("deploy"));
                }
                if joined==column.type_ {continue;}
                affected.insert(table.name.clone());
                if let Some((start,end))=type_span(file,text,column) {
                    edits.push((start,end,print::scalar_type(&joined)));
                    changes.push(format!("{}.{}: {} → {}",table.name,column.name,print::scalar_type(&column.type_),print::scalar_type(&joined)));
                }
            }
        }
        edits.sort_by_key(|e|std::cmp::Reverse(e.0));for(start,end,value)in edits{text.replace_range(start..end,&value);}
    }
    if !domain_diagnostics.is_empty() {
        let complete=super::release_bridge_current::prepare(target,current,&mut false);
        if complete.diagnostics.is_empty(){return complete;}
        let current_bridge=super::release_bridge_current::guarded(target,current);
        if current_bridge.diagnostics.is_empty(){return current_bridge;}
    }
    // New concepts keep their current rules. They are retained populations,
    // not a promise that a frozen old operation exposes a new concept.
    let aliases:BTreeMap<_,_>=names.iter().filter_map(|old|new.get(old).filter(|(_,_,t)|&t.name!=old).map(|(_,_,t)|(t.name.clone(),old.clone()))).collect();
    let mut additions=String::new();
    for (name,(file,text,table)) in &new {
        if name!=&table.name {continue;} // Alias lookup entries are not declarations.
        if names.contains(name)||aliases.contains_key(name)||table.renamed_from.as_ref().is_some_and(|old|names.contains(old)){continue;}
        affected.insert(name.clone());
        match retained_declaration(file,text,table,&aliases) {
            Ok(source)=>{additions.push_str(&source);additions.push('\n');},
            Err(reason)=>domain_diagnostics.push(crate::diag::type_error(&table.site,reason,"retain an authored compatible guarded source for this table mapping").guide("deploy")),
        }
        changes.push(format!("new table {name}: retained with its current rules; old operations may not expose it"));
    }
    if !additions.is_empty() {let mut name="rollback-retained.q".to_owned();while sources.iter().any(|(f,_)|f==&name){name.insert_str(0,"retained-");}sources.push((name,additions));}
    let transported=super::release_bridge_rules::carry(&mut sources,current,&mut changes,&std::collections::BTreeSet::new());
    affected.extend(transported);
    let (mut diagnostics,fallback)=super::release_bridge_guards::carry(&mut sources,current,&affected,&mut changes);
    if !fallback.is_empty(){
        super::release_bridge_rules::carry(&mut sources,current,&mut changes,&fallback);
        (diagnostics,_)=super::release_bridge_guards::carry(&mut sources,current,&affected,&mut changes);
    }
    let current_bound=crate::compile(current);
    if current_bound.diagnostics.is_empty()&&crate::compile(target).diagnostics.is_empty() {
        super::release_bridge_indexes::prune_unused_equivalent_keys(&mut sources,current,&mut changes);
    }
    let bound=crate::compile(&sources);
    if bound.schema.auth!=current_bound.schema.auth
        || super::release_bridge_guards::current_context_needed(&sources,current,&bound.schema,&current_bound.schema) {
        diagnostics.push(crate::diag::type_error(&crate::Site::default(),"rollback guards need the current ordered execution and schema context","retain the complete current guarded workflow, including authentication and guard-dependent reads").guide("deploy"));
    }
    for(file,text)in target {
        let old=parser::parse_document(file,text).0;
        let Some((_,next))=current.iter().find(|(f,_)|operation_name(f,"")==operation_name(file,""))else{continue};
        let next=parser::parse_document(file,next).0;
        for(name,prior,site)in &old.aliases {
            let qualified=operation_name(file,name);
            let retained=current_bound.programs.iter().any(|p|p.program.name==qualified);
            if retained&&!next.aliases.iter().any(|(alias,target,_)|alias==name&&target==prior) {
                diagnostics.push(crate::diag::type_error(site,format!("rollback export {qualified} needs its current definition or alias target"),"retain the complete current guarded endpoint and dependency closure").guide("deploy"));
            }
        }
    }

    for previous in &crate::compile(target).programs {
        if let Some(current)=current_bound.programs.iter().find(|p|p.program.name==previous.program.name) {
            let mut positions=std::collections::BTreeSet::new();
            let collapsed=previous.program.args.iter().any(|(name,_)| {
                let spellings=std::iter::once(name.as_str()).chain(previous.program.arg_aliases.iter().filter(|(_,owner)|*owner==name).map(|(alias,_)|alias.as_str()));
                let resolved=spellings.filter_map(|name|current.program.argument(name).map(|(canonical,_)|canonical)).collect::<std::collections::BTreeSet<_>>();
                resolved.len()>1||resolved.iter().any(|position|!positions.insert(*position))
            });
            if collapsed {
                diagnostics.push(crate::diag::type_error(&crate::Site::default(),format!("rollback export {} cannot merge or rebind old wire input positions behind current guards",previous.program.name),"author a compatible current guarded endpoint with distinct old argument positions").guide("deploy"));
            }
        }
    }
    let current_authority=match align_current_schema(&bound.schema,&sources,&current_bound.schema,current,&aliases) {
        Ok(schema)=>Some(schema),
        Err(error)=>{diagnostics.push(crate::diag::type_error(&crate::Site::default(),format!("rollback current authority cannot align declared table/column identities: {error}"),"author a compatible guarded identity mapping").guide("deploy"));None},
    };
    for(name,table)in &bound.schema.tables {
        let Some((_,_,next))=new.get(name)else{continue};
        let Some(current_table)=current_bound.schema.table(&next.name)else{continue};
        if current_authority.as_ref().is_some_and(|schema|schema.table(name).is_some_and(|authority| {
            let policies=PolicyComparison::new(&bound.schema,schema);
            table.column_reads.len()!=authority.column_reads.len()
                ||table.column_reads.iter().any(|(column,rule)|!policies.optional_rule(Some(rule),authority.column_reads.get(column)))
                ||table.written_by!=authority.written_by
                ||table.column_writes!=authority.column_writes
                ||table.frozen_columns!=authority.frozen_columns
        })) {
            diagnostics.push(crate::diag::type_error(&next.site,format!("rollback view needs current field authority on {name}"),"retain the complete current guarded workflow and its column read/write authority").guide("deploy"));
        }
        for column in &next.columns {
            let old_name=column.renamed_from.as_ref().filter(|name|table.columns.contains_key(*name)).unwrap_or(&column.name);
            if table.columns.contains_key(old_name)&&table.defaults.get(old_name)!=current_table.defaults.get(&column.name) {
                diagnostics.push(crate::diag::type_error(&column.site,format!("rollback view cannot preserve current default for {name}.{}",column.name),"retain the current authored default in a compatible guarded rollback source").guide("deploy"));
            }
        }
    }
    if bound.diagnostics.is_empty() && !super::release_bridge_current::contracts(&crate::compile(target),&bound) {
        diagnostics.push(crate::diag::type_error(&crate::Site::default(),"rollback view cannot preserve every predecessor wire contract, including argument aliases and distinct input positions","retain the old parameter aliases on compatible current endpoints, or author a guarded compatibility endpoint before deploying").guide("deploy"));
    }
    diagnostics.extend(bound.diagnostics);diagnostics.extend(domain_diagnostics);
    Bridge {sources,changes,diagnostics}
}
fn offset(text:&str,line:u32,col:u32)->usize {
    let start=text.split_inclusive('\n').take(line.saturating_sub(1) as usize).map(str::len).sum::<usize>();
    start+text[start..].chars().take(col.saturating_sub(1) as usize).map(char::len_utf8).sum::<usize>()
}
pub fn type_span(file:&str,text:&str,column:&ast::ColumnDecl)->Option<(usize,usize)> {
    let(tokens,_)=lexer::lex(file,text);let at=tokens.iter().position(|t|t.site==column.site)?;
    let start=tokens.get(at+2)?;let mut depth=0;
    for (ordinal,token) in tokens.iter().skip(at+2).enumerate() {
        // A nominal type may itself be named `default`, `read`, etc. Only
        // recognize metadata after consuming the first token of the type.
        if ordinal>0 && depth==0 && (token.kind==Kind::Newline || matches!(token.value.as_str(),"default"|"renamed"|"on"|"read"|"write"|"written"|"readable")) {
            // End before whitespace preceding metadata/comment/newline.
            let end=offset(text,token.site.line,token.site.col);
            let start=offset(text,start.site.line,start.site.col);let end=text[..end].trim_end().len();
            return (start<=end).then_some((start,end));
        }
        match token.value.as_str(){"("|"["=>depth+=1,")"|"]"=>depth-=1,_=>()}
    }None
}
fn declaration(text:&str,line:u32)->String {
    let lines:Vec<_>=text.lines().collect();let start=line.saturating_sub(1) as usize;let mut end=start+1;
    while end<lines.len() {let s=lines[end];if !s.trim().is_empty() && !s.starts_with(char::is_whitespace) && !s.starts_with("--"){break;}end+=1;}
    lines[start..end].join("\n")+"\n"
}
// Rewrite only structural table references; strings, column names and bound
// rule parameters retain their spelling and policy meaning.
pub(super) fn retained_declaration(file:&str,text:&str,table:&ast::TableDecl,aliases:&BTreeMap<String,String>)->Result<String,String> {
    let mut source=declaration(text,table.site.line);
    let mut decl=parser::parse_document(file,&source).0.tables.into_iter().next().ok_or("missing retained table declaration")?;
    let mut edits=Vec::new();
    fn remap_type(t:&mut ast::ScalarType,aliases:&BTreeMap<String,String>) {
        match &mut t.kind {TypeKind::Ref{table}=>{if let Some(name)=aliases.get(table){*table=name.clone();}},TypeKind::List{item,..}=>remap_type(item,aliases),_=>()}
    }
    for column in &decl.columns {
        let mut type_=column.type_.clone();remap_type(&mut type_,aliases);
        if type_!=column.type_ {if let Some((start,end))=type_span(file,&source,column){edits.push((start,end,print::scalar_type(&type_)));}}
    }
    let mut visit=|expr:&mut ast::Expr| {
        if let ast::Expr::Read(read)|ast::Expr::Exists{read,..}|ast::Expr::Created{read,..}=expr {
            if let Some(name)=aliases.get(&read.table) {let start=offset(&source,read.site.line,read.site.col);edits.push((start,start+read.table.len(),name.clone()));}
        }
    };
    for rule in decl.rules.iter_mut().chain(decl.column_reads.iter_mut().map(|(_,r)|r)) {crate::bind::intent_walk::expression(&mut rule.value,&mut visit);}
    for column in &mut decl.columns {
        for expr in [&mut column.read,&mut column.write,&mut column.default].into_iter().flatten(){crate::bind::intent_walk::expression(expr,&mut visit);}
        if let Some(expr)=column.maintained.as_mut().and_then(|a|a.filter.as_mut()){crate::bind::intent_walk::expression(expr,&mut visit);}
    }
    for (_,expr,_) in &mut decl.immutable_when {crate::bind::intent_walk::expression(expr,&mut visit);}
    for (expr,_) in &mut decl.final_exists {crate::bind::intent_walk::expression(expr,&mut visit);}
    // Sync targets are structural table probes outside the expression AST.
    if let Some(sync)=&decl.sync {
        let (tokens,_)=lexer::lex(file,&source);
        // Lexer continuation rules keep indented `or` arms in this logical
        // declaration even when their physical line differs from `sync`.
        if let Some(start)=tokens.iter().position(|t|t.site==sync.site) {
            let end=tokens[start..].iter().position(|t|matches!(t.kind,Kind::Newline|Kind::Eof)).map_or(tokens.len(),|n|start+n);
            for pair in tokens[start..end].windows(2) {if pair[0].kind==Kind::Word && pair[1].value=="[" {if let Some(name)=aliases.get(&pair[0].value){let start=offset(&source,pair[0].site.line,pair[0].site.col);edits.push((start,start+pair[0].value.len(),name.clone()));}}}
        }
    }
    edits.sort();edits.dedup();
    if edits.iter().any(|(a,b,_)|a>b||*b>source.len()||!source.is_char_boundary(*a)||!source.is_char_boundary(*b))
        || edits.windows(2).any(|pair|pair[0].1>pair[1].0) {
        return Err("unsupported or overlapping retained-table source spans".into());
    }
    edits.sort_by_key(|e|std::cmp::Reverse(e.0));
    for (start,end,value) in edits {source.replace_range(start..end,&value);}
    Ok(source)
}
fn join(old:&ast::ScalarType,new:&ast::ScalarType,tables:&BTreeMap<String,(&String,&String,ast::TableDecl)>)->Option<ast::ScalarType> {
    let kind=match (&old.kind,&new.kind) {
        (TypeKind::Int|TypeKind::IntRange{..},TypeKind::Int|TypeKind::IntRange{..})=>{
            let bounds=|k:&TypeKind|match k{TypeKind::IntRange{min,max}=>(min.unwrap_or(i64::MIN),max.unwrap_or(i64::MAX)),_=>(i64::MIN,i64::MAX)};
            let(a,b)=bounds(&old.kind);let(x,y)=bounds(&new.kind);let(min,max)=(a.min(x),b.max(y));
            if min==i64::MIN && max==i64::MAX {TypeKind::Int}else{TypeKind::IntRange{min:(min!=i64::MIN).then_some(min),max:(max!=i64::MAX).then_some(max)}}
        }
        (TypeKind::Image{max:a,once:b},TypeKind::Image{max:x,once:y}) if b==y=>TypeKind::Image{max:(*a).max(*x),once:*b},
        (TypeKind::Video{max:a},TypeKind::Video{max:b})=>TypeKind::Video{max:(*a).max(*b)},
        (TypeKind::File{max:a,types:b},TypeKind::File{max:x,types:y}) if b==y=>TypeKind::File{max:(*a).max(*x),types:b.clone()},
        (TypeKind::Text{min:a,max:b,format:c},TypeKind::Text{min:x,max:y,format:z}) if c==z=>TypeKind::Text{min:Some(a.unwrap_or(0).min(x.unwrap_or(0))).filter(|v|*v>0),max:(*b).max(*y),format:c.clone()},
        (TypeKind::Enum{variants:a},TypeKind::Enum{variants:b})=>{let mut v=a.clone();for x in b {if !v.contains(x){v.push(x.clone());}}TypeKind::Enum{variants:v}},
        (TypeKind::List{item:a,min:b,max:c},TypeKind::List{item:x,min:y,max:z})=>TypeKind::List{item:Box::new(join(a,x,tables)?),min:(*b).min(*y),max:(*c).max(*z)},
        // Only an explicit rename provides nominal identity; structural similarity
        // or independently declared replacement tables cannot justify a bridge.
        (TypeKind::Ref{table:a},TypeKind::Ref{table:b}) if a==b || tables.get(a).is_some_and(|(_,_,t)| t.name==*b)=>TypeKind::Ref{table:a.clone()},
        (a,b) if a==b=>a.clone(),
        // Other conversions require an explicit typed migration. A bridge never
        // guesses a nominal reference, money currency or asset policy.
        _=>return None,
    };
    Some(ast::ScalarType{kind,optional:old.optional||new.optional})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixed_narrowing_keeps_current_domains_and_the_complete_current_closure() {
        let old="table items:\n  kind: enum('private', 'public')\n  amount: int\n  read <- .kind != 'public'\n  online only\nquery readItem(id: items):\n  return items[id]\n";
        let new=old.replace("enum('private', 'public')","enum('public')").replace("amount: int","amount: int ?");
        let b=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),new)]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        assert!(b.sources[0].1.contains("kind: enum('public')"));
        assert!(!b.sources[0].1.contains("'private'"));
        let renamed=b.sources[0].1.replace("query readItem", "query currentRead")+"alias readItem = currentRead\n";
        let aliased=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),renamed)]);
        assert!(aliased.diagnostics.is_empty(),"{:?}",aliased.diagnostics);
        assert!(aliased.sources[0].1.contains("alias readItem = currentRead"));
    }
    #[test]
    fn mixed_domain_closure_refuses_missing_fields_and_incompatible_inputs() {
        let old="table items:\n  kind: enum('private', 'public')\n  amount: int\n  public\n  online only\nquery readItem(id: items, n: int):\n  return items[id]\n";
        for new in [old.replace("enum('private', 'public')","enum('public')").replace("amount: int\n", ""),old.replace("enum('private', 'public')","enum('public')").replace("n: int)","n: int 1..10)")] {
            let b=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),new)]);
            assert!(!b.diagnostics.is_empty());
        }
    }
    #[test]
    fn view_trigger_uses_full_domains_and_identity_not_advice_strings(){
        let old="table items:\n  text: text 4..100\n  cap 2 by text\n  public\n  online only\n";
        for new in [old.replace("4..100","<=100"),old.replace("cap 2","cap 3")] {assert!(requires_view(&[("s.q".into(),old.into())],&[("s.q".into(),new)]));}
        assert!(!requires_view(&[("s.q".into(),old.into())],&[("s.q".into(),old.replace("cap 2","cap 1"))]));
        let old="table people:\n  public\n  online only\ntable items:\n  buyer: people\n  unique buyer\n  public\n  online only\n";
        let new=old.replace("buyer: people","customer: people renamed from buyer").replace("unique buyer","unique customer");
        assert!(!requires_view(&[("s.q".into(),old.into())],&[("s.q".into(),new.clone())]));
        assert!(!requires_view(&[("s.q".into(),new)],&[("s.q".into(),old.into())]));
    }
    #[test]
    fn current_quota_immutability_and_lifetime_survive_a_widened_view(){
        let old="table items:\n  amount: int\n  owner: principal\n  until: time\n  cap 2 by owner\n  insert <- allow\n  online only\nmutation add():\n  return insert items {amount:1,owner:viewer,until:1000000}\n";
        let new=old.replace("amount: int","amount: int ?").replace("cap 2 by owner","cap 1 by owner\n  immutable owner\n  expire at .until");
        let b=loosen(&[("s.q".into(),old.into())],&[("s.q".into(),new)]);assert!(b.diagnostics.is_empty(),"{:?} {:?}",b.diagnostics,b.sources);
        let bound=crate::compile(&b.sources);let table=&bound.schema.tables["items"];
        assert!(table.constraints.contains(&snapback4_core::schema::Constraint::Cap{by:vec!["owner".into()],max:1}));
        assert!(table.constraints.contains(&snapback4_core::schema::Constraint::Immutable{fields:vec!["owner".into()]}));assert_eq!(table.expire.as_deref(),Some("until"));
    }
    #[test]
    fn aliased_current_endpoint_keeps_its_guard_on_a_union_view() {
        let old="table items:\n  amount: int\n  public\n  online only\nquery oldRead(id: items):\n  item = items[id] ! else MISSING\n  return item.amount + 1\n";
        let new="table items:\n  amount: int ?\n  public\n  online only\nquery currentRead(id: items):\n  item = items[id] ! else MISSING\n  require item.amount != null else AMOUNT_PENDING\n  return item.amount + 1\nalias oldRead = currentRead\n";
        let b=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),new.into())]);
        assert!(b.diagnostics.is_empty(),"{:?} {:?}",b.diagnostics,b.sources);
        assert!(b.sources[0].1.contains("query oldRead"));assert!(b.sources[0].1.contains("AMOUNT_PENDING"));
    }
    #[test]
    fn loosens_target_domains_preserving_its_operations_and_rules() {
        let old="table items:\n  amount: money USD\n  photos: [image <=1024] 1..8\n  public\n  online only\nquery oldRead():\n  return items first 10 by .id {amount,photos}\n";
        let new=old.replace("money USD","money USD ?").replace("1..8","<=8").replace("oldRead","newRead");
        let b=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),new)]);
        assert!(b.diagnostics.is_empty(),"{:?}\n{:?}",b.diagnostics,b.sources);
        assert!(b.sources[0].1.contains("query oldRead"));assert!(!b.sources[0].1.contains("query newRead"));
        assert!(b.sources[0].1.contains("amount: money USD 2 ?"));assert!(!b.changes.iter().any(|c|c.contains("verify operation oldRead")));
    }
}

/// Historical source cannot silently erase an enforced column audience.
/// This closed proof accepts an identical guard or a conjunctive table guard;
/// other workflows need an authored compatibility endpoint, never an ack.
pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)])->Result<(),String>{
    use snapback4_core::schema::RuleExpr;
    let old=crate::compile(target);let next=crate::compile(current);
    if next.schema.tables.values().all(|t|t.column_writes.is_empty()&&t.frozen_columns.is_empty()){return Ok(());}
    let aliases=next.schema.table_renames.iter().filter(|(_,prior)|old.schema.tables.contains_key(*prior)).map(|(new,prior)|(new.clone(),prior.clone())).chain(old.schema.table_renames.iter().filter(|(new,prior)|!next.schema.tables.contains_key(*new)&&next.schema.tables.contains_key(*prior)).map(|(new,prior)|(prior.clone(),new.clone()))).collect();
    let aligned=align_current_schema(&old.schema,target,&next.schema,current,&aliases)?;
    fn implies(rule:&RuleExpr,policy:&RuleExpr,policies:&PolicyComparison<'_>)->bool{
        policies.rule(rule,policy) || *rule==RuleExpr::Deny || *policy==RuleExpr::Allow || match rule {RuleExpr::And(xs)=>xs.iter().any(|r|implies(r,policy,policies)),_=>false}
    }
    fn writes_column(value:&serde_json::Value,table:&str,column:&str,effect:&str,defaulted:bool)->bool {
        match value {
            serde_json::Value::Object(fields)=>{
                if fields.contains_key("Literal"){return false;}
                for(kind,body)in fields {
                    let write_effect=match kind.as_str(){"Insert"|"InsertIfAbsent"=>"insert","Update"=>"update","Upsert"=>"upsert","WriteTarget"=>if body["upsert"]==true{"upsert"}else{"update"},_=>""};
                    let target=body["table"].as_str().or_else(||body["target"]["table"].as_str());
                    if write_effect==effect&&target==Some(table){
                        let patch=body.get("patch").or_else(||body.get("row"));
                        let object=patch.and_then(|p|p.get("Object")).and_then(serde_json::Value::as_object);
                        if object.is_none_or(|o|o.contains_key(column)) || effect!="update"&&defaulted {return true;}
                    }
                    if writes_column(body,table,column,effect,defaulted){return true;}
                }false
            },
            serde_json::Value::Array(xs)=>xs.iter().any(|x|writes_column(x,table,column,effect,defaulted)),
            _=>false,
        }
    }
    fn leading_guard(target:&[(String,String)],aligned:&snapback4_core::Schema,table:&str,operation:&str,policy:&RuleExpr)->bool {
        let mut sources=target.to_vec();
        let Some((_,source))=sources.first_mut()else{return false};
        source.push_str(&format!("\ninvariant {table}.{operation} only {}\n",policy.quarry()));
        let proof=crate::compile(&sources);if !proof.diagnostics.is_empty(){return false;}
        let comparison=PolicyComparison::new(&proof.schema,aligned);
        let report=crate::security::analyze_rules(&proof);
        report.invariants.iter().any(|v|v.status==crate::security::Status::Proved&&v.invariant.table==table&&v.invariant.operation.as_deref()==Some(operation)
            &&v.invariant.policy.as_ref().is_some_and(|compiled|comparison.rule(compiled,policy))
            &&v.invariant.requirements.iter().any(|require|comparison.rule(require,policy)))
    }
    let policies=PolicyComparison::new(&old.schema,&aligned);
    for(name,current)in &aligned.tables {
        let Some(prior)=old.schema.table(name)else{continue};
        for (column,policy) in &current.column_writes {
            if !prior.columns.contains_key(column){continue;}
            for program in &old.programs {
                let writes=snapback4_core::ir::write_tables(&program.program);
                for(_,effect)in writes.iter().filter(|(t,e)|t==name&&*e!="delete") {
                    let defaulted=prior.defaults.get(column).is_some_and(|d|!matches!(d,snapback4_core::schema::ColumnDefault::Literal(snapback4_core::Value::Null)));
                    if !writes_column(&serde_json::to_value(&program.program).unwrap(),name,column,effect,defaulted){continue;}
                    let safe=prior.column_writes.get(column)==Some(policy) || match *effect {"insert"=>implies(&prior.rules.insert,policy,&policies),"update"=>!prior.update_transition&&implies(&prior.rules.update,policy,&policies),"upsert"=>!prior.update_transition&&implies(&prior.rules.insert,policy,&policies)&&implies(&prior.rules.update,policy,&policies),_=>false};
                    if !safe && !leading_guard(target,&aligned,name,&program.program.name,policy) {return Err(format!("{}: exact source operation {} can write {name}.{column} without current rule `write <- {}`; retain this audience in a guarded bridge before selecting the source",program.site,program.program.name,policy.quarry()));}
                }
            }
        }
        for(column,condition)in &current.frozen_columns {
            if prior.columns.contains_key(column)&&prior.frozen_columns.get(column)!=Some(condition)&&*condition!=RuleExpr::Deny&&!prior.constraints.iter().any(|c|matches!(c,snapback4_core::schema::Constraint::Immutable{fields}if fields.contains(column)))&&old.programs.iter().any(|p|snapback4_core::ir::write_tables(&p.program).iter().any(|(t,e)|t==name&&*e!="delete"&&writes_column(&serde_json::to_value(&p.program).unwrap(),name,column,e,false))) {
                return Err(format!("{name}.{column}: exact source omits current rule `immutable when {}`; retain the freeze in an authored bridge before selecting source",condition.quarry()));
            }
        }
    }
    Ok(())
}
