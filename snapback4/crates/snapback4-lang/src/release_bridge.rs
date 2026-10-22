//! A rollback view joins value domains and retains current authored authority.
// @ref LLP 3000.000.000.002#8-wave-21-release-evolution — generated source is reviewable; no automatic business-policy synthesis.
use crate::{ast::{self,TypeKind}, lexer::{self,Kind}, parser, print};
use std::collections::BTreeMap;
pub struct Bridge {pub sources:Vec<(String,String)>,pub changes:Vec<String>,pub diagnostics:Vec<crate::diag::Diagnostic>}

/// Source-domain inclusion includes text minima/formats, which live outside
/// ColumnType in the compiled schema. Never infer admission from advice prose.
pub fn requires_view(target:&[(String,String)],current:&[(String,String)])->bool {
    // Policy repairs need a current-closure view even when no value domain
    // widened. Byte-identical source needs no adapter (and equal-source
    // registration must not create an endless chain of equivalent parents).
    let modules=|sources:&[(String,String)]| {let mut out=sources.iter().map(|(file,text)|(std::path::Path::new(file).file_stem().unwrap_or(std::ffi::OsStr::new("schema")).to_string_lossy().into_owned(),text.clone())).collect::<Vec<_>>();out.sort();out};
    let old_text=modules(target);let next_text=modules(current);
    if old_text!=next_text && !crate::compile(current).invariants.is_empty(){return true;}
    let docs=current.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
    let tables=docs.iter().flat_map(|d|&d.tables).collect::<Vec<_>>();
    let mut aliases=tables.iter().filter_map(|t|t.renamed_from.as_ref().map(|old|(t.name.clone(),old.clone()))).collect::<BTreeMap<_,_>>();
    for(file,text)in target{for t in parser::parse_document(file,text).0.tables{if let Some(prior)=t.renamed_from{aliases.insert(t.name,prior);}}}
    fn normalize(t:&mut ast::ScalarType,aliases:&BTreeMap<String,String>){match &mut t.kind{TypeKind::Ref{table}=>{let mut seen=std::collections::BTreeSet::new();while let Some(old)=aliases.get(table){if !seen.insert(table.clone()){*table=seen.into_iter().min().unwrap();break}*table=old.clone();}},TypeKind::List{item,..}=>normalize(item,aliases),_=>()}}
    for(file,text)in target {
        for old in parser::parse_document(file,text).0.tables {
            let Some(next)=tables.iter().find(|t|t.name==old.name||t.renamed_from.as_ref()==Some(&old.name)||old.renamed_from.as_ref()==Some(&t.name))else{continue};
            for col in &old.columns {
                let Some(candidate)=next.columns.iter().find(|c|c.name==col.name||c.renamed_from.as_ref()==Some(&col.name)||col.renamed_from.as_ref()==Some(&c.name))else{continue};
                let scalar=!matches!(&col.type_.kind,TypeKind::Ref{..}|TypeKind::List{..}|TypeKind::Image{..}|TypeKind::File{..}|TypeKind::Video{..});
                if scalar&&docs.iter().flat_map(|d|&d.downfills).any(|d|d.table==next.name&&matches!(&d.value,ast::Expr::Object{fields,..}if fields.iter().any(|f|f.name==col.name))){continue;}
                let mut from=candidate.type_.clone();let mut to=col.type_.clone();normalize(&mut from,&aliases);normalize(&mut to,&aliases);
                if !crate::client_contracts::accepts(&crate::types::scalar_to_arg(&from),&crate::types::scalar_to_arg(&to)){return true}
            }
            let mut columns=next.columns.iter().filter_map(|c|c.renamed_from.as_ref().filter(|old_name|old.columns.iter().any(|o|&o.name==*old_name)).map(|old_name|(c.name.clone(),old_name.clone()))).collect::<BTreeMap<_,_>>();
            for c in &old.columns{if let Some(prior)=&c.renamed_from{if next.columns.iter().any(|n|&n.name==prior)&&!next.columns.iter().any(|n|n.name==c.name){columns.insert(prior.clone(),c.name.clone());}}}
            let normalize_columns=|fields:&[String]|fields.iter().map(|c|columns.get(c).unwrap_or(c).clone()).collect::<Vec<_>>();
            if old.indexes.iter().any(|i|i.unique&&!next.indexes.iter().any(|n|n.unique&&normalize_columns(&n.columns)==i.columns)){return true}
            if old.caps.iter().any(|c|!next.caps.iter().any(|n|normalize_columns(&n.by)==c.by&&n.max<=c.max)){return true}
            if old.final_exists.iter().any(|(expr,_)|!next.final_exists.iter().any(|(n,_)|print::expression(expr)==print::expression(n))){return true}
        }
    }false
}

pub fn loosen(target:&[(String,String)],current:&[(String,String)])->Bridge {
    if !crate::compile(current).invariants.is_empty() {
        return super::release_bridge_current::prepare(target,current);
    }
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
        // Reusing the complete authored current closure preserves its schema
        // impossibility facts as well as guards. This closed fallback requires
        // every old field/name and accepted input; it invents no translation.
        let old_docs=target.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
        let current_docs=current.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
        let fields_survive=old_docs.iter().flat_map(|d|&d.tables).all(|old|current_docs.iter().flat_map(|d|&d.tables).find(|t|t.name==old.name).is_some_and(|next|old.columns.iter().all(|c|next.columns.iter().any(|n|n.name==c.name))));
        fn exports(docs:&[ast::Document])->BTreeMap<String,&ast::ProgramDecl>{
            let mut out=BTreeMap::new();
            for doc in docs {for p in &doc.programs {out.insert(p.name.clone(),p);}
                for (name,target,_) in &doc.aliases {if let Some(p)=doc.programs.iter().find(|p|p.name==*target){out.insert(name.clone(),p);}}
            }out
        }
        let next_exports=exports(&current_docs);
        let inputs_survive=exports(&old_docs).iter().all(|(name,old)|next_exports.get(name).is_some_and(|next|old.kind==next.kind&&old.args.len()==next.args.len()&&old.args.iter().zip(&next.args).all(|(a,b)|a.name==b.name&&super::release_bridge_rules::input_accepts(&a.type_,&b.type_))));
        if fields_survive&&inputs_survive {
            let bound=crate::compile(current);
            changes.clear();
            changes.push("mixed domains: retained the complete current authored schema and workflow closure, preserving every predecessor table/field/operation name and accepted input; review current results in the old UI".into());
            return Bridge{sources:current.to_vec(),changes,diagnostics:bound.diagnostics};
        }
    }
    // New concepts keep their current rules. They are retained populations,
    // not a promise that a frozen old operation exposes a new concept.
    let aliases:BTreeMap<_,_>=names.iter().filter_map(|old|new.get(old).filter(|(_,_,t)|&t.name!=old).map(|(_,_,t)|(t.name.clone(),old.clone()))).collect();
    let mut additions=String::new();
    for (name,(file,text,table)) in &new {
        if name!=&table.name {continue;} // Alias lookup entries are not declarations.
        if names.contains(name)||aliases.contains_key(name)||table.renamed_from.as_ref().is_some_and(|old|names.contains(old)){continue;}
        affected.insert(name.clone());
        additions.push_str(&retained_declaration(file,text,table,&aliases));additions.push('\n');
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
    let bound=crate::compile(&sources);diagnostics.extend(bound.diagnostics);diagnostics.extend(domain_diagnostics);
    Bridge {sources,changes,diagnostics}
}
fn offset(text:&str,line:u32,col:u32)->usize {
    let start=text.split_inclusive('\n').take(line.saturating_sub(1) as usize).map(str::len).sum::<usize>();
    start+text[start..].chars().take(col.saturating_sub(1) as usize).map(char::len_utf8).sum::<usize>()
}
pub fn type_span(file:&str,text:&str,column:&ast::ColumnDecl)->Option<(usize,usize)> {
    let(tokens,_)=lexer::lex(file,text);let at=tokens.iter().position(|t|t.site==column.site)?;
    let start=tokens.get(at+2)?;let mut depth=0;
    for token in tokens.iter().skip(at+2) {
        if depth==0 && (token.kind==Kind::Newline || matches!(token.value.as_str(),"default"|"renamed"|"on"|"read"|"written"|"readable")) {
            // End before whitespace preceding metadata/comment/newline.
            let end=offset(text,token.site.line,token.site.col);
            return Some((offset(text,start.site.line,start.site.col),text[..end].trim_end().len()));
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
pub(super) fn retained_declaration(file:&str,text:&str,table:&ast::TableDecl,aliases:&BTreeMap<String,String>)->String {
    let mut source=declaration(text,table.site.line);
    let mut decl=parser::parse_document(file,&source).0.tables.remove(0);
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
        for expr in [&mut column.read,&mut column.default].into_iter().flatten(){crate::bind::intent_walk::expression(expr,&mut visit);}
        if let Some(expr)=column.maintained.as_mut().and_then(|a|a.filter.as_mut()){crate::bind::intent_walk::expression(expr,&mut visit);}
    }
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
    edits.sort();edits.dedup();edits.sort_by_key(|e|std::cmp::Reverse(e.0));
    for (start,end,value) in edits {source.replace_range(start..end,&value);}
    source
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
