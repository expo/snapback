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
    let exports=|sources:&[(String,String)]| {
        let mut out=std::collections::BTreeMap::new();
        for(file,text)in sources {
            let doc=parser::parse_document(file,text).0;
            for p in &doc.programs{out.insert(super::release_bridge::operation_name(file,&p.name),p.clone());}
            for(name,target,_)in &doc.aliases{if let Some(p)=doc.programs.iter().find(|p|p.name==*target){out.insert(super::release_bridge::operation_name(file,name),p.clone());}}
        }out
    };
    let shapes=|sources:&[(String,String)]| {
        let mut out=std::collections::BTreeMap::new();
        for(file,text)in sources {
            for shape in parser::parse_document(file,text).0.shapes {
                let fields=shape.fields.iter().map(|field|match field {
                    crate::ast::ShapeField::Spread{..}=>"...".into(),
                    crate::ast::ShapeField::NamedSpread{name,..}=>format!("...{name}"),
                    crate::ast::ShapeField::Bare{name,..}=>name.clone(),
                    crate::ast::ShapeField::Field{name,value,..}=>format!("{name}:{}",print::expression(value)),
                }).collect::<Vec<_>>();
                out.insert(shape.name,fields);
            }
        }out
    };
    let shapes_changed=shapes(sources)!=shapes(current);
    let view=exports(sources);let mut next=exports(current);
    // Compare declared row identities, never raw business strings or an
    // unrelated schema/domain addition. The selective view has its own
    // compatible old wire workflow; current authority is checked separately.
    let mut names=current_schema.table_renames.iter().filter(|(_,old)|view_schema.tables.contains_key(*old)).map(|(new,old)|(new.clone(),old.clone())).collect::<std::collections::BTreeMap<_,_>>();
    for(name,prior)in &view_schema.table_renames {
        if current_schema.tables.contains_key(prior)&&!current_schema.tables.contains_key(name){names.insert(prior.clone(),name.clone());}
    }
    for p in next.values_mut() {
        let mut doc=crate::ast::Document::default();doc.programs.push(p.clone());
        crate::bind::intent_walk::document(&mut doc,&mut |expr|match expr {
            crate::ast::Expr::Read(r)|crate::ast::Expr::Exists{read:r,..}|crate::ast::Expr::Created{read:r,..}=>{if let Some(old)=names.get(&r.table){r.table=old.clone();}},
            crate::ast::Expr::Write{table,..}=>{if let Some(old)=names.get(table){*table=old.clone();}},
            _=>(),
        });
        *p=doc.programs.pop().unwrap();
    }
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

pub(super) fn carry(
    sources: &mut [(String, String)],
    current: &[(String, String)],
    _affected: &BTreeSet<String>,
    changes: &mut Vec<String>,
) -> (Vec<crate::Diagnostic>,BTreeSet<String>) {
    let mut diagnostics = Vec::new();
    let mut fallback=BTreeSet::new();
    let current_documents = current
        .iter()
        .map(|(file, text)| parser::parse_document(file, text).0)
        .collect::<Vec<_>>();
    let target_documents = sources
        .iter()
        .map(|(file, text)| parser::parse_document(file, text).0)
        .collect::<Vec<_>>();
    let helper_signatures = |docs: &[crate::ast::Document]| {
        docs.iter()
            .flat_map(|d| {
                d.functions.iter().map(move |f| {
                    let text = d
                        .source
                        .declarations
                        .get(&f.site.to_string())
                        .cloned()
                        .unwrap_or_default();
                    let (tokens, _) = crate::lexer::lex(&d.file, &text);
                    let calls = tokens
                        .windows(2)
                        .filter(|p| p[0].kind == crate::lexer::Kind::Word && p[1].value == "(")
                        .map(|p| p[0].value.clone())
                        .collect::<Vec<_>>();
                    (
                        f.name.clone(),
                        (
                            tokens
                                .into_iter()
                                .map(|t| (t.kind, t.value))
                                .collect::<Vec<_>>(),
                            calls,
                        ),
                    )
                })
            })
            .collect::<std::collections::BTreeMap<_, _>>()
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
                                (format!("{at}:{}", print::expression(value)), value.clone()),
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

fn normalized_statement(s: &Stmt) -> String {
    match s {
        Stmt::As {
            principal, body, ..
        } => format!(
            "as {} {:?}",
            print::expression(principal),
            body.iter().map(normalized_statement).collect::<Vec<_>>()
        ),
        Stmt::Bind { names, value, .. } => format!("bind {names:?} {}", print::expression(value)),
        Stmt::Expr { value, .. } => format!("expr {}", print::expression(value)),
        Stmt::Require {
            condition,
            code,
            message,
            ..
        } => format!(
            "require {} {code:?} {message:?}",
            print::expression(condition)
        ),
        Stmt::Return { value, .. } => format!("return {}", print::expression(value)),
        Stmt::Emit {
            effect,
            payload,
            once,
            ..
        } => format!(
            "emit {effect} {} {:?}",
            print::expression(payload),
            once.as_ref().map(print::expression)
        ),
        Stmt::If {
            condition,
            then_body,
            else_body,
            ..
        } => format!(
            "if {} {:?} {:?}",
            print::expression(condition),
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
            print::expression(domain),
            body.iter().map(normalized_statement).collect::<Vec<_>>()
        ),
        Stmt::Break { .. } => "break".into(),
        Stmt::Continue { .. } => "continue".into(),
    }
}
