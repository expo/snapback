//! A continuation belongs to a returned page, not the last auxiliary scan.
//! This retains the SB2 return/alias/one-to-one-shape analysis without its
//! certificate or receipt machinery.
use crate::ir::*;
use crate::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, PartialEq, Eq)]
enum Origin {
    Empty,
    Page(String, Option<String>),
    Record(BTreeMap<String, Origin>),
    Cursor(String),
}
type Bindings = BTreeMap<String, Origin>;


#[derive(Default)]
pub(super) struct Plan {
    pub returns: BTreeMap<String, String>,
    pub collectors: BTreeMap<String, String>,
}

pub(super) fn plan(program: &Program) -> Plan {
    if program.kind != ProgramKind::Query { return Plan::default(); }
    let mut collectors = BTreeMap::new();
    let returns = returned_origins(program, false, &mut collectors).into_iter().filter_map(|(path, origin)| result_page(&origin).map(|(site, _)| (path, site.to_owned()))).collect();
    Plan { returns, collectors }
}

/// Read sites whose pages flow to a query return, including cursorless pages.
/// Diagnostics use the same alias/shape analysis as continuation ownership;
/// adding a note must not change the runtime's opaque-cursor-only plan.
pub fn returned_page_sites(program: &Program) -> BTreeSet<String> {
    fn collect(origin: Origin, sites: &mut BTreeSet<String>) {
        match origin {
            Origin::Page(site, _) => { sites.insert(site); }
            Origin::Record(fields) => {
                for value in fields.into_values() { collect(value, sites); }
            }
            _ => {}
        }
    }
    let mut sites = BTreeSet::new();
    if program.kind == ProgramKind::Query {
        for origin in returned_origins(program, true, &mut BTreeMap::new()).into_values() {
            collect(origin, &mut sites);
        }
    }
    sites
}

fn result_page(origin: &Origin) -> Option<(&str, Option<&str>)> {
    fn collect<'a>(origin: &'a Origin, pages: &mut BTreeSet<(&'a str, &'a str)>) -> bool {
        match origin {
            Origin::Page(site, Some(cursor)) => {
                pages.insert((site, cursor));
                true
            }
            Origin::Record(fields) => fields.values().all(|value| collect(value, pages)),
            Origin::Page(_, None) => false,
            _ => true,
        }
    }
    if let Origin::Page(site, cursor) = origin {
        return Some((site, cursor.as_deref()));
    }
    let mut pages = BTreeSet::new();
    (collect(origin, &mut pages) && pages.len() == 1).then(|| {
        let (site, cursor) = *pages.first().unwrap();
        (site, Some(cursor))
    })
}

fn returned_origins(program: &Program, include_cursorless: bool, collectors: &mut BTreeMap<String, String>) -> BTreeMap<String, Origin> {
    let mut bindings = program.args.iter().filter_map(|(name, kind)| {
        (matches!(kind, ArgType::Cursor)
            || matches!(kind, ArgType::Optional(inner) if matches!(inner.as_ref(), ArgType::Cursor)))
            .then(|| (name.clone(), Origin::Cursor(name.clone())))
    }).collect();
    let mut returns = BTreeMap::new();
    if origins(&program.body, &program.name, &mut bindings, &mut returns, collectors, include_cursorless) {
        returns.insert("fallthrough".into(), Origin::Empty);
    }
    returns
}

fn scan_cursor(scan: &Scan, bindings: &Bindings) -> Option<String> {
    match scan
        .after
        .as_deref()
        .and_then(|value| expression_origin(value, bindings, false))
    {
        Some(Origin::Cursor(name)) if scan.before.is_none() => Some(name),
        _ => None,
    }
}

fn expression_origin(value: &Expr, bindings: &Bindings, include_cursorless: bool) -> Option<Origin> {
    match value {
        Expr::Scan(scan) if include_cursorless || scan.opaque_cursor => {
            Some(Origin::Page(scan.site.clone(), scan_cursor(scan, bindings)))
        }
        Expr::Merge(merge) if include_cursorless || merge.lanes.iter().all(|lane| lane.scan.opaque_cursor) => {
            let mut cursor = None;
            for lane in &merge.lanes {
                let mut local = bindings.clone();
                if lane.source.is_some() {
                    local.remove(&lane.binding);
                }
                origins(&lane.setup, "", &mut local, &mut BTreeMap::new(), &mut BTreeMap::new(), include_cursorless);
                let next = scan_cursor(&lane.scan, &local);
                if next.is_none() || (cursor.is_some() && next != cursor) {
                    return Some(Origin::Page(merge.site.clone(), None));
                }
                cursor = next;
            }
            Some(Origin::Page(merge.site.clone(), cursor))
        }
        Expr::Variable(name) => bindings.get(name).cloned(),
        Expr::Object(fields) | Expr::Shape { fields, .. } => Some(Origin::Record(
            fields
                .iter()
                .filter_map(|(name, value)| {
                    expression_origin(value, bindings, include_cursorless).map(|origin| (name.clone(), origin))
                })
                .collect(),
        )),
        Expr::Field { base, name } => match expression_origin(base, bindings, include_cursorless) {
            Some(Origin::Record(mut fields)) => fields.remove(name),
            _ => None,
        },
        Expr::Array(values) if values.is_empty() => Some(Origin::Empty),
        Expr::Literal(Value::Array(values)) if values.is_empty() => Some(Origin::Empty),
        _ => None,
    }
}

fn domain_origin(domain: &LoopDomain, bindings: &Bindings, include_cursorless: bool) -> Option<Origin> {
    match domain {
        LoopDomain::Page(scan) if include_cursorless || scan.opaque_cursor => {
            Some(Origin::Page(scan.site.clone(), scan_cursor(scan, bindings)))
        }
        LoopDomain::DerivedArray { value, .. } => expression_origin(value, bindings, include_cursorless),
        _ => None,
    }
}

// Count every collector write and reject early exits. Nested point shapes can
// branch and write their own temporaries, but the outer collector gets one push.
fn writes(body: &[Stmt], counts: &mut BTreeMap<String, usize>, nested_loop: bool) -> bool {
    let mut exits = false;
    for statement in body {
        match statement {
            Stmt::Const { name, .. }
            | Stmt::Let { name, .. }
            | Stmt::Assign { name, .. }
            | Stmt::Push { target: name, .. } => *counts.entry(name.clone()).or_default() += 1,
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                exits |= writes(then_body, counts, nested_loop);
                exits |= writes(else_body, counts, nested_loop);
            }
            Stmt::For { binding, body, .. } => {
                *counts.entry(binding.clone()).or_default() += 1;
                // @ref LLP 3000.007#19.2 — a helper's lowered return breaks its own loop, not the enclosing page's one-to-one shape.
                exits |= writes(body, counts, true);
            }
            Stmt::Return(_) => exits = true,
            Stmt::Break | Stmt::Continue => exits |= !nested_loop,
            _ => {}
        }
    }
    exits
}

/// Paths are statement indexes separated by /then/ or /else/. Loops consume
/// pages; only a proved one-to-one collector transports a page out of a loop.
fn origins(
    body: &[Stmt],
    prefix: &str,
    bindings: &mut Bindings,
    returns: &mut BTreeMap<String, Origin>,
    collectors: &mut BTreeMap<String, String>,
    include_cursorless: bool,
) -> bool {
    for (index, statement) in body.iter().enumerate() {
        let path = format!("{prefix}:{}", index + 1);
        match statement {
            Stmt::Const { name, value }
            | Stmt::Let { name, value }
            | Stmt::Assign { name, value } => {
                if let Some(origin) = expression_origin(value, bindings, include_cursorless) {
                    bindings.insert(name.clone(), origin);
                } else {
                    bindings.remove(name);
                }
            }
            Stmt::Push { target, .. } => {
                bindings.remove(target);
            }
            Stmt::Return(value) => {
                returns.insert(
                    path,
                    expression_origin(value, bindings, include_cursorless).unwrap_or(Origin::Empty),
                );
                return false;
            }
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                let mut yes = bindings.clone();
                let mut no = bindings.clone();
                let yes_live = origins(then_body, &format!("{path}:then"), &mut yes, returns, collectors, include_cursorless);
                let no_live = origins(else_body, &format!("{path}:else"), &mut no, returns, collectors, include_cursorless);
                *bindings = match (yes_live, no_live) {
                    (true, true) => yes
                        .into_iter()
                        .filter(|(name, value)| no.get(name) == Some(value))
                        .collect(),
                    (true, false) => yes,
                    (false, true) => no,
                    (false, false) => return false,
                };
            }
            Stmt::For {
                binding,
                domain,
                body,
            } => {
                let origin = domain_origin(domain, bindings, include_cursorless);
                // A loop's early return has no certified top-level page site.
                // Keep it visible to admission without inventing provenance.
                let mut local = bindings.clone();
                local.remove(binding);
                let mut nested = BTreeMap::new();
                origins(body, &path, &mut local, &mut nested, collectors, include_cursorless);
                returns.extend(nested.into_keys().map(|path| (path, Origin::Empty)));
                let mut changed = BTreeMap::new();
                let exits = writes(body, &mut changed, false);
                // @ref LLP 3000.007#19.2 — retain the rejected collector's page so execution distinguishes an untaken exit or exhausted loop from lost rows.
                if exits && let Some(Origin::Page(site, _)) = &origin {
                    collectors.insert(path.clone(), site.clone());
                }
                *changed.entry(binding.clone()).or_default() += 1;
                let targets = body
                    .iter()
                    .filter_map(|statement| match statement {
                        Stmt::Push { target, .. }
                            if !exits
                                && changed.get(target) == Some(&1)
                                && bindings.get(target) == Some(&Origin::Empty) =>
                        {
                            Some(target.clone())
                        }
                        _ => None,
                    })
                    .collect::<Vec<_>>();
                for name in changed.keys() {
                    bindings.remove(name);
                }
                if let Some(origin @ Origin::Page(_, _)) = origin {
                    for target in targets {
                        bindings.insert(target, origin.clone());
                    }
                }
            }
            Stmt::Break | Stmt::Continue => return false,
            _ => {}
        }
    }
    true
}
