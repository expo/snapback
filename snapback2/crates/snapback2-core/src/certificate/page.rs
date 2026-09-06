// @ref LLP 1001#3-read-and-write-states-no-silent-states — a returned page or merge has one consistent cursor suffix and cannot disclose a hidden examined position.
use super::*;
use crate::Value;

// @ref LLP 1011#b1-opaque-cursors — derive each return's ordered page from IR;
// branch-local aliases never turn an auxiliary read into the delivered page.
#[derive(Clone, PartialEq, Eq)]
enum Origin {
    Empty,
    Page(String),
}
type Bindings = BTreeMap<String, Origin>;

pub(super) fn result_pages(
    schema: &Schema,
    program: &Program,
) -> Result<BTreeMap<String, ResultPageSite>, Vec<CheckError>> {
    if program.kind != ProgramKind::Query {
        return Ok(BTreeMap::new());
    }
    let mut returns = BTreeMap::new();
    origins(&program.body, "", &mut Bindings::new(), &mut returns);
    returns
        .into_iter()
        .map(|(path, site)| {
            resolve_result_page_site(schema, &program.body, &site).map(|page| (path, page))
        })
        .collect()
}

fn expression_origin(value: &Expr, bindings: &Bindings) -> Option<Origin> {
    match value {
        Expr::Scan(scan) if scan.opaque_cursor => Some(Origin::Page(scan.site.clone())),
        Expr::Merge(merge) if merge.lanes.iter().all(|lane| lane.scan.opaque_cursor) => {
            Some(Origin::Page(merge.site.clone()))
        }
        Expr::Variable(name) => bindings.get(name).cloned(),
        Expr::Array(values) if values.is_empty() => Some(Origin::Empty),
        Expr::Literal(Value::Array(values)) if values.is_empty() => Some(Origin::Empty),
        _ => None,
    }
}

fn domain_origin(domain: &LoopDomain, bindings: &Bindings) -> Option<Origin> {
    match domain {
        LoopDomain::Page(scan) if scan.opaque_cursor => Some(Origin::Page(scan.site.clone())),
        LoopDomain::DerivedArray { value, .. } => expression_origin(value, bindings),
        _ => None,
    }
}

// Count every collector write and reject early exits. Nested point shapes can
// branch and write their own temporaries, but the outer collector gets one push.
fn writes(body: &[Stmt], counts: &mut BTreeMap<String, usize>) -> bool {
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
                exits |= writes(then_body, counts);
                exits |= writes(else_body, counts);
            }
            Stmt::For { binding, body, .. } => {
                *counts.entry(binding.clone()).or_default() += 1;
                exits |= writes(body, counts);
            }
            Stmt::Return(_) | Stmt::Break | Stmt::Continue => exits = true,
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
    returns: &mut BTreeMap<String, String>,
) -> bool {
    for (index, statement) in body.iter().enumerate() {
        let path = format!("{prefix}{index}");
        match statement {
            Stmt::Const { name, value }
            | Stmt::Let { name, value }
            | Stmt::Assign { name, value } => {
                if let Some(origin) = expression_origin(value, bindings) {
                    bindings.insert(name.clone(), origin);
                } else {
                    bindings.remove(name);
                }
            }
            Stmt::Push { target, .. } => {
                bindings.remove(target);
            }
            Stmt::Return(value) => {
                if let Some(Origin::Page(site)) = expression_origin(value, bindings) {
                    returns.insert(path, site);
                }
                return false;
            }
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                let mut yes = bindings.clone();
                let mut no = bindings.clone();
                let yes_live = origins(then_body, &format!("{path}/then/"), &mut yes, returns);
                let no_live = origins(else_body, &format!("{path}/else/"), &mut no, returns);
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
                let origin = domain_origin(domain, bindings);
                let mut changed = BTreeMap::new();
                let exits = writes(body, &mut changed);
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
                if let Some(origin @ Origin::Page(_)) = origin {
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

fn resolve_result_page_site(
    schema: &Schema,
    statements: &[Stmt],
    declared: &str,
) -> Result<ResultPageSite, Vec<CheckError>> {
    fn visit_expr<'a>(expression: &'a Expr, scans: &mut Vec<(&'a Scan, bool)>) {
        match expression {
            Expr::Field { base, .. } | Expr::Unary { value: base, .. } => visit_expr(base, scans),
            Expr::Binary { left, right, .. } => {
                visit_expr(left, scans);
                visit_expr(right, scans);
            }
            Expr::Array(values) | Expr::Builtin { args: values, .. } => {
                values.iter().for_each(|value| visit_expr(value, scans));
            }
            Expr::Object(values) => {
                values.values().for_each(|value| visit_expr(value, scans));
            }
            Expr::Scan(scan) => scans.push((scan, true)),
            Expr::Merge(merge) => {
                for (index, lane) in merge.lanes.iter().enumerate() {
                    scans.extend(lane.source.as_ref().map(|scan| (scan, true)));
                    visit_statements(&lane.setup, scans);
                    scans.push((&lane.scan, index == 0));
                }
            }
            Expr::Literal(_)
            | Expr::Variable(_)
            | Expr::Input(_)
            | Expr::Get(_)
            | Expr::Exists(_) => {}
        }
    }
    fn visit_statements<'a>(statements: &'a [Stmt], scans: &mut Vec<(&'a Scan, bool)>) {
        for statement in statements {
            match statement {
                Stmt::Const { value, .. }
                | Stmt::Let { value, .. }
                | Stmt::Assign { value, .. }
                | Stmt::Push { value, .. }
                | Stmt::Return(value)
                | Stmt::Require {
                    condition: value, ..
                }
                | Stmt::Insert { row: value, .. }
                | Stmt::Delete { key: value, .. }
                | Stmt::Emit { payload: value, .. } => visit_expr(value, scans),
                Stmt::Update { key, patch, .. } => {
                    visit_expr(key, scans);
                    visit_expr(patch, scans);
                }
                Stmt::Upsert { key, row, .. } => {
                    visit_expr(key, scans);
                    visit_expr(row, scans);
                }
                Stmt::If {
                    condition,
                    then_body,
                    else_body,
                } => {
                    visit_expr(condition, scans);
                    visit_statements(then_body, scans);
                    visit_statements(else_body, scans);
                }
                Stmt::For { domain, body, .. } => {
                    match domain {
                        LoopDomain::Page(scan) => scans.push((scan, true)),
                        LoopDomain::DerivedArray { value, .. } => visit_expr(value, scans),
                        LoopDomain::Recurse(recurse) => visit_expr(&recurse.seed, scans),
                        LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => {}
                    }
                    visit_statements(body, scans);
                }
                Stmt::Break | Stmt::Continue => {}
            }
        }
    }

    let mut scans = Vec::new();
    visit_statements(statements, &mut scans);
    let matching = scans
        .into_iter()
        .filter(|(scan, _)| scan.site == declared || scan.merge_site.as_deref() == Some(declared))
        .collect::<Vec<_>>();
    let Some((first, _)) = matching.first() else {
        return Err(vec![CheckError {
            site: None,
            code: "E_TRACE_SUBSET".to_owned(),
            message: format!("declared result-page site {declared} is not a scan or merge"),
            rewrite:
                "recompile the operation so its result-page site names the returned scan or merge"
                    .to_owned(),
        }]);
    };
    let merge = first.merge_site.as_deref() == Some(declared);
    let Some(table) = schema.table(&first.table) else {
        return Err(vec![CheckError {
            site: None,
            code: "E_SCHEMA".to_owned(),
            message: format!(
                "result-page site {declared} names missing table {}",
                first.table
            ),
            rewrite: "use a declared table for the result page".to_owned(),
        }]);
    };
    let Some(index) = table.index(&first.index) else {
        return Err(vec![CheckError {
            site: None,
            code: "E_SCHEMA".to_owned(),
            message: format!(
                "result-page site {declared} names missing index {}.{}",
                first.table, first.index
            ),
            rewrite: "use a declared index for the result page".to_owned(),
        }]);
    };
    let suffix = index.columns[first.prefix.len()..]
        .iter()
        .filter_map(|name| {
            table.columns.get(name).cloned().map(|kind| CursorColumn {
                name: name.clone(),
                kind,
            })
        })
        .collect::<Vec<_>>();
    let page = ResultPageSite {
        site: declared.to_owned(),
        table: first.table.clone(),
        index: first.index.clone(),
        order: first.order,
        suffix,
        merge,
    };
    let consistent = matching.iter().all(|(scan, _)| {
        scan.table == page.table
            && scan.index == page.index
            && scan.order == page.order
            && scan.prefix.len() + page.suffix.len() == index.columns.len()
            && (scan.merge_site.as_deref() == Some(declared)) == merge
    });
    if !consistent
        || matching.iter().filter(|(_, root)| *root).count() != 1
        || page.suffix.is_empty()
        || page.suffix.len() + first.prefix.len() != index.columns.len()
    {
        return Err(vec![CheckError {
            site: None,
            code: "E_TRACE_SUBSET".to_owned(),
            message: format!(
                "result-page site {declared} does not identify one consistent index suffix"
            ),
            rewrite: "return one scan or merge with one table, index, order, and prefix width"
                .to_owned(),
        }]);
    }
    Ok(page)
}
