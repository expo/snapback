//! Carry authored guards; never invent a value for a newly optional field.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — compilation gates automatic registration.
use crate::{ast::Stmt, parser, print};
use std::collections::BTreeSet;

// Guard meaning depends on statement order and named definitions, not merely
// the last textual binding. Compare declared row identities, then select
// current execution when that guarded context cannot be transported intact.
// Field/table authority is validated separately before choosing a strategy.
pub(super) fn current_context_needed(
    sources:&[(String,String)],current:&[(String,String)],
    view_schema:&snapback4_core::Schema,current_schema:&snapback4_core::Schema,
)->bool {
    let view_docs=sources.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
    let mut next_docs=current.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
    let mut names=current_schema.table_renames.iter().filter(|(_,old)|view_schema.tables.contains_key(*old)).map(|(new,old)|(new.clone(),old.clone())).collect::<std::collections::BTreeMap<_,_>>();
    for(name,prior)in &view_schema.table_renames {
        if current_schema.tables.contains_key(prior)&&!current_schema.tables.contains_key(name){names.insert(prior.clone(),name.clone());}
    }
    for doc in &mut next_docs{normalize_identities(doc,&names);}
    if super::release_bridge_indexes::current_context_needed(&view_docs,&next_docs,view_schema,current_schema,&names){return true;}
    let exports=|docs:&[crate::ast::Document]| {
        let mut out=std::collections::BTreeMap::new();
        for doc in docs {
            for p in &doc.programs{out.insert(super::release_bridge::operation_name(&doc.file,&p.name),p.clone());}
            for(name,target,_)in &doc.aliases{if let Some(p)=doc.programs.iter().find(|p|p.name==*target){out.insert(super::release_bridge::operation_name(&doc.file,name),p.clone());}}
        }out
    };
    let shapes=|docs:&[crate::ast::Document]| {
        let mut out=std::collections::BTreeMap::new();
        for doc in docs {
            for shape in &doc.shapes {
                let fields=shape.fields.iter().map(|field|match field {
                    crate::ast::ShapeField::Spread{..}=>"...".into(),
                    crate::ast::ShapeField::NamedSpread{name,..}=>format!("...{name}"),
                    crate::ast::ShapeField::Bare{name,..}=>name.clone(),
                    crate::ast::ShapeField::Field{name,value,..}=>format!("{name}:{}",expression_signature(value)),
                }).collect::<Vec<_>>();
                out.insert(shape.name.clone(),fields);
            }
        }out
    };
    let shapes_changed=shapes(&view_docs)!=shapes(&next_docs);
    let view=exports(&view_docs);let next=exports(&next_docs);
    for(name,p)in next {
        let Some(old)=view.get(&name)else{continue};
        let mut sensitive=p.prelude.iter().chain(&p.body).any(|s|matches!(s,Stmt::Require{..}|Stmt::If{..}|Stmt::For{..}|Stmt::As{..}));
        let mut doc=crate::ast::Document::default();doc.programs.push(p.clone());
        crate::bind::intent_walk::document(&mut doc,&mut |expr|{
            sensitive|=matches!(expr,crate::ast::Expr::Read(_)|crate::ast::Expr::Exists{..}|crate::ast::Expr::Created{..}|crate::ast::Expr::Walk{..}|crate::ast::Expr::Merge(_)|crate::ast::Expr::If{..}|crate::ast::Expr::Assert{..}|crate::ast::Expr::Call{..}|crate::ast::Expr::Write{condition:Some(_),..});
        });
        let body=|p:&crate::ast::ProgramDecl|p.prelude.iter().chain(&p.body).map(normalized_statement).collect::<Vec<_>>();
        if sensitive&&(body(old)!=body(&p)||shapes_changed){return true;}
    }
    false
}

// Only typed row-reference slots change spelling. Literal values, member names,
// helper identities and business strings retain their authored meaning.
fn normalize_identities(doc:&mut crate::ast::Document,names:&std::collections::BTreeMap<String,String>) {
    fn kind(ty:&mut crate::ast::ScalarType,names:&std::collections::BTreeMap<String,String>){
        match &mut ty.kind {
            crate::ast::TypeKind::Ref{table}=>if let Some(old)=names.get(table){*table=old.clone();},
            crate::ast::TypeKind::List{item,..}=>kind(item,names),
            _=>(),
        }
    }
    for p in &mut doc.programs{for a in &mut p.args{kind(&mut a.type_,names);}}
    for f in &mut doc.functions{for a in &mut f.args{kind(&mut a.type_,names);}}
    let table=|name:&mut String|{if let Some(old)=names.get(name){*name=old.clone();}};
    crate::bind::intent_walk::document(doc,&mut |expr|match expr {
        crate::ast::Expr::Read(r)|crate::ast::Expr::Exists{read:r,..}|crate::ast::Expr::Created{read:r,..}=>table(&mut r.table),
        crate::ast::Expr::Write{table:name,..}|crate::ast::Expr::Walk{table:name,..}=>table(name),
        crate::ast::Expr::Merge(m)=>{table(&mut m.table);for lane in &mut m.lanes{if let Some(name)=&mut lane.table{table(name);}if let Some(r)=&mut lane.planned{table(&mut r.table);}if let Some((_,r))=&mut lane.nulls{table(&mut r.table);}}},
        _=>(),
    });
}

pub(super) fn carry(
    sources: &mut [(String, String)],
    current: &[(String, String)],
    _affected: &BTreeSet<String>,
    changes: &mut Vec<String>,
) -> (Vec<crate::Diagnostic>,BTreeSet<String>) {
    let mut diagnostics = Vec::new();
    let mut fallback=BTreeSet::new();
    let mut current_documents = current
        .iter()
        .map(|(file, text)| parser::parse_document(file, text).0)
        .collect::<Vec<_>>();
    let target_documents = sources
        .iter()
        .map(|(file, text)| parser::parse_document(file, text).0)
        .collect::<Vec<_>>();
    let target_tables=target_documents.iter().flat_map(|d|&d.tables).map(|t|t.name.clone()).collect::<BTreeSet<_>>();
    let current_tables=current_documents.iter().flat_map(|d|&d.tables).map(|t|t.name.clone()).collect::<BTreeSet<_>>();
    let mut identities=std::collections::BTreeMap::new();
    for table in current_documents.iter().flat_map(|d|&d.tables) {
        if let Some(prior)=table.renamed_from.as_ref().filter(|prior|target_tables.contains(*prior)){identities.insert(table.name.clone(),prior.clone());}
    }
    for table in target_documents.iter().flat_map(|d|&d.tables) {
        if let Some(prior)=table.renamed_from.as_ref().filter(|prior|current_tables.contains(*prior)&&!current_tables.contains(&table.name)){identities.insert(prior.clone(),table.name.clone());}
    }
    for doc in &mut current_documents{normalize_identities(doc,&identities);}
    let helper_signatures = |docs: &[crate::ast::Document]| {
        let mut out=std::collections::BTreeMap::new();
        for doc in docs {
            for f in &doc.functions {
                let args=f.args.iter().map(|a|(a.name.clone(),a.type_.clone(),a.alias.clone(),a.default.as_ref().map(expression_signature),a.deprecated)).collect::<Vec<_>>();
                let body=match &f.body {
                    crate::ast::FunctionBody::Expression(e)=>vec![format!("expression {}",expression_signature(e))],
                    crate::ast::FunctionBody::Block(body)=>body.iter().map(normalized_statement).collect(),
                };
                let mut function=crate::ast::Document::default();function.functions.push(f.clone());
                let mut calls=Vec::new();crate::bind::intent_walk::document(&mut function,&mut |e|if let crate::ast::Expr::Call{name,..}=e{calls.push(name.clone());});
                out.insert(f.name.clone(),((args,body),calls));
            }
        }out
    };
    let current_helpers = helper_signatures(&current_documents);
    let target_helpers = helper_signatures(&target_documents);
    let mut next=std::collections::BTreeMap::new();
    for doc in &current_documents {
        for p in &doc.programs {next.insert(super::release_bridge::operation_name(&doc.file,&p.name),p.clone());}
        for(name,target,_)in &doc.aliases {if let Some(p)=doc.programs.iter().find(|p|p.name==*target){let mut exported=p.clone();exported.name=name.clone();next.insert(super::release_bridge::operation_name(&doc.file,name),exported);}}
    }
    for (file, text) in sources {
        let doc = parser::parse_document(file, text).0;
        let mut edits = Vec::new();
        for old in doc.programs {
            let Some(new) = next.get(&super::release_bridge::operation_name(file,&old.name)) else {
                continue;
            };
            // The whole selected source must retain current matching guards,
            // including changes unrelated to the column that triggered a view.
            let guards = old
                .prelude
                .iter()
                .chain(&old.body)
                .filter_map(guard)
                .collect::<BTreeSet<_>>();
            let added = new
                .prelude
                .iter()
                .chain(&new.body)
                .filter_map(guard)
                .filter(|g| !guards.contains(g))
                .collect::<BTreeSet<_>>();
            let bindings = |p: &crate::ast::ProgramDecl| {
                p.prelude
                    .iter()
                    .chain(&p.body)
                    .filter_map(|s| {
                        if let Stmt::Bind { names, value, .. } = s {
                            Some((names, value))
                        } else {
                            None
                        }
                    })
                    .flat_map(|(names, value)| {
                        names.iter().enumerate().map(move |(at, name)| {
                            (
                                name.clone(),
                                (format!("{at}:{}", expression_signature(value)), value.clone()),
                            )
                        })
                    })
                    .collect::<std::collections::BTreeMap<_, _>>()
            };
            let old_bindings = bindings(&old);
            let new_bindings = bindings(new);
            let mut dependent = BTreeSet::new();
            let mut helpers = BTreeSet::new();
            let collect = |expr: &crate::ast::Expr,
                           names: &mut BTreeSet<String>,
                           helpers: &mut BTreeSet<String>| {
                let mut expr = expr.clone();
                crate::bind::intent_walk::expression(&mut expr, &mut |e| match e {
                    crate::ast::Expr::Name { name, .. } => {
                        names.insert(name.clone());
                    }
                    crate::ast::Expr::Call { name, .. } => {
                        helpers.insert(name.clone());
                    }
                    _ => (),
                });
            };
            for s in new.prelude.iter().chain(&new.body) {
                if let Stmt::Require { condition, .. } = s {
                    collect(condition, &mut dependent, &mut helpers);
                }
            }
            let mut visited = BTreeSet::new();
            let mut unsafe_binding = false;
            while let Some(name) = dependent.pop_first() {
                if !visited.insert(name.clone()) {
                    continue;
                }
                if let Some((signature, value)) = new_bindings.get(&name) {
                    if old_bindings.get(&name).map(|(s, _)| s) != Some(signature)
                        || has_write(value)
                    {
                        unsafe_binding = true;
                    }
                    collect(value, &mut dependent, &mut helpers);
                } else if old_bindings.contains_key(&name) {
                    unsafe_binding = true;
                }
            }
            // Reused authored workflows retain their complete helper meaning,
            // including helpers feeding writes, returns and system scopes.
            let mut workflow = crate::ast::Document::default();
            workflow.programs.push(new.clone());
            crate::bind::intent_walk::document(&mut workflow, &mut |e| {
                if let crate::ast::Expr::Call { name, .. } = e {
                    helpers.insert(name.clone());
                }
            });
            let mut visited = BTreeSet::new();
            let mut unsafe_helper = false;
            while let Some(name) = helpers.pop_first() {
                // Helper declarations are global after the compiler validates
                // optional file qualification. Compare the resolved identity.
                let name=name.rsplit('.').next().unwrap_or(&name).to_owned();
                if !visited.insert(name.clone()) {
                    continue;
                }
                if current_helpers.get(&name).map(|s| &s.0)
                    != target_helpers.get(&name).map(|s| &s.0)
                {
                    unsafe_helper = true;
                }
                if let Some((_, calls)) = current_helpers.get(&name) {
                    helpers.extend(calls.iter().cloned());
                }
            }
            let nested = |p: &crate::ast::ProgramDecl| {
                p.body
                    .iter()
                    .filter(|s| matches!(s, Stmt::If { .. } | Stmt::For { .. } | Stmt::As { .. }))
                    .map(|s| normalized_statement(s))
                    .collect::<Vec<_>>()
            };
            if unsafe_binding || unsafe_helper || nested(&old) != nested(new) {
                fallback.insert(super::release_bridge::operation_name(file,&old.name));
                diagnostics.push(crate::diag::type_error(&old.site,format!("rollback guard dependency closure for {} differs; an old binding/helper or control-flow path cannot establish the current guard",old.name),"retain a compatible guarded old workflow or declare intentional hiding of the unrepresentable values").guide("deploy"));
                continue;
            }
            if added.is_empty() {
                continue;
            }
            // Keep the old workflow; add current requirements after its reads,
            // immediately before the first effect/return. Undefined or changed
            // bindings fail ordinary compilation rather than guessing policy.
            let at = old
                .body
                .iter()
                .find(|s| {
                    !matches!(s, Stmt::Require { .. })
                        && !matches!(s,Stmt::Bind{value,..} if !has_write(value))
                })
                .map(stmt_site)
                .unwrap_or(old.site.line + 1);
            let offset = text
                .split_inclusive('\n')
                .take(at.saturating_sub(1) as usize)
                .map(str::len)
                .sum::<usize>();
            edits.push((
                offset,
                added.iter().map(|g| format!("  {g}\n")).collect::<String>(),
            ));
            for g in added {
                changes.push(format!("operation {}: carried current {g}", old.name));
            }
        }
        edits.sort_by_key(|(at, _)| std::cmp::Reverse(*at));
        for (at, guard) in edits {
            text.insert_str(at, &guard);
        }
    }
    (diagnostics,fallback)
}
fn guard(s: &Stmt) -> Option<String> {
    match s {
        Stmt::Require {
            condition,
            code,
            message,
            ..
        } => Some(format!(
            "require {} else {}{}",
            print::expression(condition),
            code,
            message
                .as_ref()
                .map(|m| format!(" '{}'", m.replace('\\', "\\\\").replace('\'', "\\'")))
                .unwrap_or_default()
        )),
        _ => None,
    }
}
fn stmt_site(s: &Stmt) -> u32 {
    match s {
        Stmt::As { site, .. }
        | Stmt::Bind { site, .. }
        | Stmt::Expr { site, .. }
        | Stmt::Require { site, .. }
        | Stmt::Return { site, .. }
        | Stmt::Emit { site, .. }
        | Stmt::If { site, .. }
        | Stmt::For { site, .. }
        | Stmt::Break { site }
        | Stmt::Continue { site } => site.line,
    }
}

fn has_write(e: &crate::ast::Expr) -> bool {
    let mut e = e.clone();
    let mut writes = false;
    crate::bind::intent_walk::expression(&mut e, &mut |e| {
        if matches!(e, crate::ast::Expr::Write { .. }) {
            writes = true;
        }
    });
    writes
}

// A source printer is deliberately lossy (for example it prints a merge's
// header without its lanes). Security comparison retains every AST field and
// strips only diagnostic locations. Exhaustive Expr matching makes new
// expression forms require an explicit location-normalization decision.
fn expression_signature(value:&crate::ast::Expr)->String {
    use crate::ast::{Expr,ShapeField};
    fn shape(fields:&mut [ShapeField]) {
        for field in fields {
            match field {
                ShapeField::Spread{site}|ShapeField::NamedSpread{site,..}|ShapeField::Bare{site,..}|ShapeField::Field{site,..}=>*site=crate::Site::default(),
            }
        }
    }
    fn read(r:&mut crate::ast::ReadExpr) {
        r.site=crate::Site::default();
        for k in &mut r.keys{k.site=crate::Site::default();}
        for seek in &mut r.seeks{seek.site=crate::Site::default();}
        if let Some(range)=&mut r.range{range.site=crate::Site::default();}
    }
    let mut value=value.clone();
    crate::bind::intent_walk::expression(&mut value,&mut |expr| {
        match expr {
            Expr::Read(r)=>read(r),
            Expr::Exists{read:r,site}|Expr::Created{read:r,site}=>{read(r);*site=crate::Site::default();},
            Expr::Merge(m)=>{
                m.site=crate::Site::default();
                for lane in &mut m.lanes {
                    lane.site=crate::Site::default();
                    if let Some(fields)=&mut lane.project{shape(fields);}
                    if let Some(r)=&mut lane.planned{read(r);}
                    if let Some((_,r))=&mut lane.nulls{read(r);}
                }
            },
            Expr::Object{fields,site}=>{*site=crate::Site::default();for f in fields{f.site=crate::Site::default();}},
            Expr::Shape{fields,site,..}=>{*site=crate::Site::default();shape(fields);},
            Expr::Write{keys,fields,site,..}=>{*site=crate::Site::default();for k in keys{k.site=crate::Site::default();}for f in fields{f.site=crate::Site::default();}},
            Expr::Name{site,..}|Expr::Focal{site}|Expr::Literal{site,..}|Expr::Array{site,..}
            |Expr::Unary{site,..}|Expr::Binary{site,..}|Expr::Member{site,..}|Expr::Call{site,..}
            |Expr::Assert{site,..}|Expr::ShapeUse{site,..}|Expr::Walk{site,..}|Expr::If{site,..}=>*site=crate::Site::default(),
        }
    });
    format!("{value:?}")
}

fn normalized_statement(s: &Stmt) -> String {
    match s {
        Stmt::As {
            principal, body, ..
        } => format!(
            "as {} {:?}",
            expression_signature(principal),
            body.iter().map(normalized_statement).collect::<Vec<_>>()
        ),
        Stmt::Bind { names, value, .. } => format!("bind {names:?} {}", expression_signature(value)),
        Stmt::Expr { value, .. } => format!("expr {}", expression_signature(value)),
        Stmt::Require {
            condition,
            code,
            message,
            ..
        } => format!(
            "require {} {code:?} {message:?}",
            expression_signature(condition)
        ),
        Stmt::Return { value, .. } => format!("return {}", expression_signature(value)),
        Stmt::Emit {
            effect,
            payload,
            once,
            ..
        } => format!(
            "emit {effect} {} {:?}",
            expression_signature(payload),
            once.as_ref().map(expression_signature)
        ),
        Stmt::If {
            condition,
            then_body,
            else_body,
            ..
        } => format!(
            "if {} {:?} {:?}",
            expression_signature(condition),
            then_body
                .iter()
                .map(normalized_statement)
                .collect::<Vec<_>>(),
            else_body
                .iter()
                .map(normalized_statement)
                .collect::<Vec<_>>()
        ),
        Stmt::For {
            name, domain, body, ..
        } => format!(
            "for {name} {} {:?}",
            expression_signature(domain),
            body.iter().map(normalized_statement).collect::<Vec<_>>()
        ),
        Stmt::Break { .. } => "break".into(),
        Stmt::Continue { .. } => "continue".into(),
    }
}
