//! Proved contradictions between caller gates and table rules; unknown is quiet.
// @ref LLP 3000.036.002#9 — bounded, path-local contradiction proofs never infer that different roles or principals are disjoint.
use super::catalog::Catalog;
use crate::{Diagnostic, ast::*};
use std::collections::BTreeMap;

type Atom = (String, String, bool); // equality when true, inequality otherwise
// DNF: no alternatives is false; one empty alternative is unknown/true.
type Facts = Vec<Vec<Atom>>;
const LIMIT: usize = 64;
fn unknown() -> Facts {
    vec![vec![]]
}
fn combine(a: Facts, b: Facts, and: bool) -> Facts {
    if !and {
        return if a.len() + b.len() > LIMIT {
            unknown()
        } else {
            a.into_iter().chain(b).collect()
        };
    }
    if a.len().saturating_mul(b.len()) > LIMIT {
        return unknown();
    }
    a.into_iter()
        .flat_map(|a| b.iter().map(move |b| a.iter().chain(b).cloned().collect()))
        .collect()
}
fn possible(facts: &Facts) -> bool {
    facts.iter().any(|facts| {
        let mut roots = BTreeMap::<String, String>::new();
        fn root(roots: &BTreeMap<String, String>, term: &str) -> String {
            let mut at = term;
            while let Some(next) = roots.get(at) {
                at = next;
            }
            at.into()
        }
        for (a, b, equal) in facts {
            if !equal {
                continue;
            }
            let (a, b) = (root(&roots, a), root(&roots, b));
            if a != b {
                roots.insert(a, b);
            }
        }
        let mut literals = BTreeMap::new();
        for (a, b, _) in facts {
            for term in [a, b] {
                if term.starts_with("literal:") {
                    let r = root(&roots, term);
                    if let Some(old) = literals.insert(r, term)
                        && old != term
                    {
                        return false;
                    }
                }
            }
        }
        facts
            .iter()
            .all(|(a, b, eq)| *eq || root(&roots, a) != root(&roots, b))
    })
}
#[derive(Clone, Default)]
struct Env {
    references: BTreeMap<String, String>,
    values: BTreeMap<String, String>,
    rows: BTreeMap<String, (String, BTreeMap<String, String>)>,
}
fn term(expr: &Expr, env: &Env, row: Option<&BTreeMap<String, String>>) -> Option<String> {
    match expr {
        Expr::Name { name, .. } if name == "viewer" => Some("viewer".into()),
        Expr::Name { name, .. } => env
            .values
            .get(name)
            .cloned()
            .or_else(|| env.rows.get(name)?.1.get("id").cloned()),
        Expr::Literal {
            value: Literal::Number(text),
            site,
        } => Some(format!(
            "literal:Number({})",
            super::integer_literal(text, site).ok()?
        )),
        Expr::Literal { value, .. } => Some(format!("literal:{value:?}")),
        Expr::Member { base, name, .. } => match base.as_ref() {
            Expr::Focal { .. } => row?.get(name).cloned(),
            Expr::Name { name: alias, .. } => env.rows.get(alias)?.1.get(name).cloned(),
            _ => None,
        },
        _ => None,
    }
}
fn predicate(
    expr: &Expr,
    env: &Env,
    row: Option<&BTreeMap<String, String>>,
    positive: bool,
    table_rule: bool,
) -> Facts {
    match expr {
        Expr::Name { name, .. }
            if ["true", "false"].contains(&name.as_str())
                || table_rule && ["allow", "deny"].contains(&name.as_str()) =>
        {
            if (["allow", "true"].contains(&name.as_str())) == positive {
                unknown()
            } else {
                vec![]
            }
        }
        Expr::Literal {
            value: Literal::Bool(value),
            ..
        } => {
            if *value == positive {
                unknown()
            } else {
                vec![]
            }
        }
        Expr::Unary { op, value, .. } if op == "not" => {
            predicate(value, env, row, !positive, table_rule)
        }
        Expr::Binary {
            op, left, right, ..
        } if op == "and" || op == "or" => combine(
            predicate(left, env, row, positive, table_rule),
            predicate(right, env, row, positive, table_rule),
            (op == "and") == positive,
        ),
        Expr::Binary {
            op, left, right, ..
        } if op == "=" || op == "!=" => match (term(left, env, row), term(right, env, row)) {
            (Some(a), Some(b)) => vec![vec![(a, b, (op == "=") == positive)]],
            _ => unknown(),
        },
        // Program probes are reads, whereas rule probes see hidden rows. Never
        // equate them or assume unrelated roster rows cannot overlap.
        _ => unknown(),
    }
}
fn row(
    catalog: &Catalog,
    table: &str,
    keys: &[KeyPart],
    env: &Env,
) -> Option<BTreeMap<String, String>> {
    let info = catalog.tables.get(table)?;
    let mut keys = keys.to_vec();
    if keys.iter().any(|k| k.column.is_none()) {
        let [key] = keys.as_mut_slice() else {
            return None;
        };
        let known_id = match &key.value {
            Expr::Name { name, .. } => {
                env.references.get(name).is_some_and(|t| t == table)
                    || env.rows.get(name).is_some_and(|(t, _)| t == table)
            }
            Expr::Member { base, name, .. } if name == "id" => {
                matches!(base.as_ref(), Expr::Name { name, .. } if env.rows.get(name).is_some_and(|(t, _)| t == table))
            }
            _ => false,
        };
        if !known_id {
            return None;
        }
        key.column = Some("id".into());
    }
    let mut read = ReadExpr {
        table: table.into(),
        keys,
        ..super::auth_lints::empty_read(table, &info.decl.site)
    };
    // `pins` resolves only an unambiguous real index and full unique key.
    read.range = None;
    let pins = super::auth_lints::pins(catalog, &read)?;
    let key: BTreeMap<_, _> = pins
        .iter()
        .map(|(col, expr)| Some((col.clone(), term(expr, env, None)?)))
        .collect::<Option<_>>()?;
    let index = info.indexes.iter().find(|i| {
        i.is_plain() && info.total_unique(i) && i.columns.iter().all(|c| key.contains_key(c))
    })?;
    let identity = format!(
        "{table}:{:?}",
        index
            .columns
            .iter()
            .map(|c| (c, &key[c]))
            .collect::<Vec<_>>()
    );
    Some(
        info.columns
            .keys()
            .map(|c| {
                (
                    c.clone(),
                    key.get(c)
                        .cloned()
                        .unwrap_or_else(|| format!("row:{identity}:{c}")),
                )
            })
            .collect(),
    )
}
fn opaque_effect(expr: &Expr) -> bool {
    matches!(
        expr,
        Expr::Write { .. }
            | Expr::Call { .. }
            | Expr::ShapeUse { .. }
            | Expr::Shape { .. }
            | Expr::Merge(_)
    ) || matches!(expr, Expr::Object { fields, .. } if fields.iter().any(|f| f.spread))
}
fn expressions(statement: &Stmt) -> Vec<Expr> {
    let mut body = vec![statement.clone()];
    let mut result = vec![];
    super::intent_walk::statements(&mut body, &mut |e| result.push(e.clone()));
    result
}
pub(super) fn notes(catalog: &Catalog) -> Vec<Diagnostic> {
    let mut out = vec![];
    for p in catalog
        .documents
        .iter()
        .flat_map(|d| &d.programs)
        .filter(|p| p.kind == ProgramKind::Mutation && !p.native)
    {
        let mut env = Env::default();
        for param in &p.args {
            env.values
                .insert(param.name.clone(), format!("arg:{}", param.name));
            if let TypeKind::Ref { table } = &param.type_.kind {
                env.references.insert(param.name.clone(), table.clone());
            }
        }
        let body: Vec<_> = p.prelude.iter().chain(&p.body).cloned().collect();
        visit(catalog, p, &body, env, unknown(), &mut out);
    }
    out
}
fn visit(
    catalog: &Catalog,
    p: &ProgramDecl,
    body: &[Stmt],
    mut env: Env,
    mut facts: Facts,
    out: &mut Vec<Diagnostic>,
) {
    for s in body {
        match s {
            Stmt::If {
                condition,
                then_body,
                else_body,
                ..
            } => {
                // A condition helper can write before either branch. Analyze
                // just the condition, not the branch bodies, for entry effects.
                let condition_stmt = Stmt::Expr {
                    value: condition.clone(),
                    site: condition.site().clone(),
                };
                if expressions(&condition_stmt).iter().any(opaque_effect) {
                    env = Env::default();
                    facts = unknown();
                }
                visit(
                    catalog,
                    p,
                    then_body,
                    env.clone(),
                    combine(
                        facts.clone(),
                        predicate(condition, &env, None, true, false),
                        true,
                    ),
                    out,
                );
                visit(
                    catalog,
                    p,
                    else_body,
                    env.clone(),
                    combine(
                        facts.clone(),
                        predicate(condition, &env, None, false, false),
                        true,
                    ),
                    out,
                );
                // Branch writes/rebindings may invalidate every entry fact.
                env = Env::default();
                facts = unknown();
                continue;
            }
            Stmt::For { body, .. } => {
                visit(catalog, p, body, Env::default(), unknown(), out);
                env = Env::default();
                facts = unknown();
                continue;
            }
            Stmt::As { .. } => {
                env = Env::default();
                facts = unknown();
                continue;
            }
            Stmt::Break { .. } | Stmt::Continue { .. } => break,
            _ => {}
        }
        let es = expressions(s);
        // Calls and compound effects are opaque; drop stale facts before any
        // expression that could change a witnessed row, including helper calls.
        let effects = es.iter().filter(|e| opaque_effect(e)).count();
        if effects > 0
            && !(effects == 1
                && matches!(
                    s,
                    Stmt::Expr {
                        value: Expr::Write { .. },
                        ..
                    } | Stmt::Bind {
                        value: Expr::Write { .. },
                        ..
                    } | Stmt::Return {
                        value: Expr::Write { .. },
                        ..
                    }
                ))
        {
            facts = unknown();
            env = Env::default();
        }
        for e in &es {
            if let Expr::Write {
                op: WriteOp::Update | WriteOp::Upsert,
                table,
                keys,
                fields,
                site,
                ..
            } = e
            {
                let Some(info) = catalog.tables.get(table) else {
                    continue;
                };
                if info.decl.columns.iter().any(|c| c.written_by.is_some())
                    || fields.iter().any(|f| f.spread)
                {
                    continue;
                }
                let Some(rule) = info.decl.rules.iter().find(|r| r.effect == Effect::Update) else {
                    continue;
                };
                let Some(image) = row(catalog, table, keys, &env) else {
                    continue;
                };
                let mut next = image.clone();
                for field in fields {
                    let value = field.value.clone().unwrap_or_else(|| Expr::Name {
                        name: field.name.clone(),
                        site: field.site.clone(),
                    });
                    next.insert(
                        field.name.clone(),
                        term(&value, &env, None)
                            .unwrap_or_else(|| format!("next-unknown:{}:{}", site, field.name)),
                    );
                }
                let authority = if let [old_alias, next_alias] = rule.bindings.as_slice() {
                    let mut images = env.clone();
                    images
                        .rows
                        .insert(old_alias.clone(), (table.clone(), image.clone()));
                    images
                        .rows
                        .insert(next_alias.clone(), (table.clone(), next));
                    predicate(&rule.value, &images, None, true, true)
                } else if rule.bindings.is_empty() {
                    combine(
                        predicate(&rule.value, &env, Some(&image), true, true),
                        predicate(&rule.value, &env, Some(&next), true, true),
                        true,
                    )
                } else {
                    continue;
                };
                if possible(&facts)
                    && !possible(&combine(facts.clone(), authority, true))
                    && !matches!(
                        &rule.value,
                        Expr::Literal {
                            value: Literal::Bool(false),
                            ..
                        }
                    )
                    && !matches!(&rule.value, Expr::Name { name, .. } if name == "deny" || name == "false")
                {
                    let arm = if matches!(
                        e,
                        Expr::Write {
                            op: WriteOp::Upsert,
                            ..
                        }
                    ) {
                        "update arm of this upsert"
                    } else {
                        "update"
                    };
                    out.push(Diagnostic::new(site, "N_WRITE_DENIED", format!("{}: no caller satisfying the preceding require/branch conditions can pass {table}'s update rule at {}; the {arm} cannot pass that rule", p.name, rule.site), "amend the table update rule or the caller gate; a mutation require does not grant table authority (guide rule-recipes)").guide("rule-recipes"));
                }
            }
        }
        if let Stmt::Bind {
            names,
            value,
            site: _,
            ..
        } = s
        {
            if let [alias] = names.as_slice() {
                // Use the old environment for RHS evaluation before rebinding.
                let scalar = term(value, &env, None);
                let base = if let Expr::Assert { value, .. } = value {
                    value.as_ref()
                } else {
                    value
                };
                let lookup = if let Expr::Read(read) = base {
                    row(catalog, &read.table, &read.keys, &env).map(|r| (read, r))
                } else {
                    None
                };
                if let Some((read, image)) = &lookup
                    && matches!(value, Expr::Read(_))
                    && read.range.is_none()
                    && read.filter.is_none()
                    && read.index.is_none()
                {
                    let info = &catalog.tables[&read.table];
                    if info.through.is_none()
                        && info.maintained.is_none()
                        && let Some(rule) =
                            info.decl.rules.iter().find(|r| r.effect == Effect::Read)
                    {
                        let authority = predicate(&rule.value, &env, Some(image), true, true);
                        if possible(&facts) && !possible(&combine(facts.clone(), authority, true)) {
                            out.push(Diagnostic::new(&read.site, "N_LOOKUP_NEVER_VISIBLE", format!("{}: this nullable {} point lookup is always null for callers satisfying the preceding require/branch conditions under the read rule at {}; an `{alias} != null` branch cannot run", p.name, read.table, rule.site), "authorize these callers to read the row, or write by key under the table rule without a preliminary lookup; guide rule-recipes, enrolment into hidden things").guide("rule-recipes"));
                        }
                    }
                }
                // Facts naming the old alias are immutable symbolic snapshots;
                // rebinding conservatively drops all facts to avoid alias reuse.
                if env.values.contains_key(alias) || env.rows.contains_key(alias) {
                    facts = unknown();
                }
                env.values.remove(alias);
                env.rows.remove(alias);
                env.references.remove(alias);
                if let Some(scalar) = scalar {
                    env.values.insert(alias.clone(), scalar);
                }
                if matches!(value, Expr::Assert { .. })
                    && let Some((read, image)) = lookup
                    && !catalog.tables[&read.table]
                        .decl
                        .columns
                        .iter()
                        .any(|c| c.written_by.is_some())
                {
                    env.rows.insert(alias.clone(), (read.table.clone(), image));
                }
            } else {
                env = Env::default();
                facts = unknown();
            }
        }
        if let Stmt::Require { condition, .. } = s {
            facts = combine(facts, predicate(condition, &env, None, true, false), true);
        }
        if effects > 0 {
            facts = unknown();
            env = Env::default();
        }
        if matches!(s, Stmt::Return { .. }) {
            break;
        }
    }
}
