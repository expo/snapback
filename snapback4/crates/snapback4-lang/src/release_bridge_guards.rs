//! Carry authored guards; never invent a value for a newly optional field.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — compilation gates automatic registration.
use crate::{ast::Stmt, parser, print};
use std::collections::BTreeSet;

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
    let next = current
        .iter()
        .flat_map(|(file, text)| parser::parse_document(file, text).0.programs.into_iter())
        .map(|p| (p.name.clone(), p))
        .collect::<std::collections::BTreeMap<_, _>>();
    for (file, text) in sources {
        let doc = parser::parse_document(file, text).0;
        let mut edits = Vec::new();
        for old in doc.programs {
            let Some(new) = next.get(&old.name) else {
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
                fallback.insert(old.name.clone());
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
