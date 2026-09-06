// @ref LLP 1001#3-read-and-write-states-no-silent-states — a returned page or merge has one consistent cursor suffix and cannot disclose a hidden examined position.
use super::*;
use crate::Value;

// @ref LLP 1011#b1-opaque-cursors — derive each return's ordered page from IR;
// branch-local aliases never turn an auxiliary read into the delivered page.
#[derive(Clone, PartialEq, Eq)]
enum Origin {
    Empty,
    Page(String, Option<String>),
    Cursor(String),
}
type Bindings = BTreeMap<String, Origin>;

pub(super) fn result_pages(
    schema: &Schema,
    program: &Program,
) -> Result<BTreeMap<String, ResultPageSite>, Vec<CheckError>> {
    if program.kind != ProgramKind::Query {
        return Ok(BTreeMap::new());
    }
    let returns = returned_origins(program);
    returns
        .into_iter()
        .filter_map(|(path, origin)| match origin {
            Origin::Page(site, _) => Some(
                resolve_result_page_site(schema, &program.body, &site).map(|page| (path, page)),
            ),
            _ => None,
        })
        .collect()
}

fn returned_origins(program: &Program) -> BTreeMap<String, Origin> {
    let mut bindings = program.args.iter().filter_map(|(name, kind)| {
        (matches!(kind, ArgType::Cursor)
            || matches!(kind, ArgType::Optional(inner) if matches!(inner.as_ref(), ArgType::Cursor)))
            .then(|| (name.clone(), Origin::Cursor(name.clone())))
    }).collect();
    let mut returns = BTreeMap::new();
    if origins(&program.body, "", &mut bindings, &mut returns) {
        returns.insert("fallthrough".into(), Origin::Empty);
    }
    returns
}

fn scan_cursor(scan: &Scan, bindings: &Bindings) -> Option<String> {
    match scan
        .after
        .as_deref()
        .and_then(|value| expression_origin(value, bindings))
    {
        Some(Origin::Cursor(name)) if scan.before.is_none() => Some(name),
        _ => None,
    }
}

/// An operation-wide log guarantee, derived from RETURNS, never auxiliary reads.
/// This is admission metadata, not a new certificate/wire-cursor format.
// @ref LLP 1012#6-reads-offline — every possible returned page must continue the same ascending bounded log.
pub fn resumable_log_cursor(
    program: &Program,
    certificate: &Certificate,
) -> Result<String, &'static str> {
    if program.kind != ProgramKind::Query {
        return Err("not-query");
    }
    let returns = returned_origins(program);
    if returns.is_empty() {
        return Err("no-returned-page");
    }
    let mut cursor = None;
    for (path, origin) in returns {
        let Origin::Page(_, Some(name)) = origin else {
            return Err("cursor-binding");
        };
        let page = certificate
            .result_pages
            .get(&path)
            .ok_or("no-returned-page")?;
        if page.order != Order::Asc {
            return Err("descending");
        }
        let take = certificate
            .read_sites
            .iter()
            .find(|site| site.site == page.site)
            .map(|site| site.take)
            .or_else(|| {
                certificate
                    .merge_sites
                    .iter()
                    .find(|site| site.site == page.site)
                    .map(|site| site.take)
            });
        if take.is_none_or(|take| take > 50) {
            return Err("page-bound");
        }
        if cursor.as_ref().is_some_and(|previous| previous != &name) {
            return Err("cursor-binding");
        }
        cursor = Some(name);
    }
    cursor.ok_or("no-returned-page")
}

fn expression_origin(value: &Expr, bindings: &Bindings) -> Option<Origin> {
    match value {
        Expr::Scan(scan) if scan.opaque_cursor => {
            Some(Origin::Page(scan.site.clone(), scan_cursor(scan, bindings)))
        }
        Expr::Merge(merge) if merge.lanes.iter().all(|lane| lane.scan.opaque_cursor) => {
            let mut cursor = None;
            for lane in &merge.lanes {
                let mut local = bindings.clone();
                if lane.source.is_some() {
                    local.remove(&lane.binding);
                }
                origins(&lane.setup, "", &mut local, &mut BTreeMap::new());
                let next = scan_cursor(&lane.scan, &local);
                if next.is_none() || (cursor.is_some() && next != cursor) {
                    return Some(Origin::Page(merge.site.clone(), None));
                }
                cursor = next;
            }
            Some(Origin::Page(merge.site.clone(), cursor))
        }
        Expr::Variable(name) => bindings.get(name).cloned(),
        Expr::Array(values) if values.is_empty() => Some(Origin::Empty),
        Expr::Literal(Value::Array(values)) if values.is_empty() => Some(Origin::Empty),
        _ => None,
    }
}

fn domain_origin(domain: &LoopDomain, bindings: &Bindings) -> Option<Origin> {
    match domain {
        LoopDomain::Page(scan) if scan.opaque_cursor => {
            Some(Origin::Page(scan.site.clone(), scan_cursor(scan, bindings)))
        }
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
    returns: &mut BTreeMap<String, Origin>,
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
                returns.insert(
                    path,
                    expression_origin(value, bindings).unwrap_or(Origin::Empty),
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
                // A loop's early return has no certified top-level page site.
                // Keep it visible to admission without inventing provenance.
                let mut local = bindings.clone();
                local.remove(binding);
                let mut nested = BTreeMap::new();
                origins(body, &format!("{path}/loop/"), &mut local, &mut nested);
                returns.extend(nested.into_keys().map(|path| (path, Origin::Empty)));
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

fn resolve_result_page_site(
    schema: &Schema,
    statements: &[Stmt],
    declared: &str,
) -> Result<ResultPageSite, Vec<CheckError>> {
    // A repeated site can execute with different bindings even when its IR is
    // identical. Count reads inside operands as well as the enclosing read.
    fn visit_scan<'a>(scan: &'a Scan, root: bool, scans: &mut Vec<(&'a Scan, bool)>) {
        scans.push((scan, root));
        for value in &scan.prefix {
            visit_expr(value, scans);
        }
        for value in [scan.after.as_deref(), scan.before.as_deref()]
            .into_iter()
            .flatten()
        {
            visit_expr(value, scans);
        }
        if let Some(range) = &scan.range {
            for value in [&range.gt, &range.gte, &range.lt, &range.lte]
                .into_iter()
                .flatten()
            {
                visit_expr(value, scans);
            }
        }
    }
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
            Expr::Get(read) | Expr::Exists(read) => {
                read.key.iter().for_each(|value| visit_expr(value, scans));
            }
            Expr::Scan(scan) => visit_scan(scan, true, scans),
            Expr::Merge(merge) => {
                for (index, lane) in merge.lanes.iter().enumerate() {
                    if let Some(source) = &lane.source {
                        visit_scan(source, true, scans);
                    }
                    visit_statements(&lane.setup, scans);
                    visit_scan(&lane.scan, index == 0, scans);
                }
            }
            Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
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
                        LoopDomain::Page(scan) => visit_scan(scan, true, scans),
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
    let Some(columns) = index.columns.get(first.prefix.len()..) else {
        // check_all keeps analyzing after structural refusals so that callers
        // receive all diagnostics, including the original prefix arity error.
        return Err(vec![CheckError {
            site: None,
            code: "E_TRACE_SUBSET".to_owned(),
            message: format!(
                "result-page site {declared} prefix exceeds index {}.{}",
                first.table, first.index
            ),
            rewrite: "shorten the result page's prefix to leave an index suffix".to_owned(),
        }]);
    };
    let suffix = columns
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

#[cfg(test)]
mod drain_tests {
    use super::*;
    use crate::{ColumnType, Index, public_table};

    fn page(site: &str, order: Order, take: u32, cursor: &str) -> Expr {
        Expr::Scan(Scan {
            site: site.into(),
            table: "rows".into(),
            index: "byId".into(),
            prefix: vec![],
            order,
            take: Bound::Literal(take),
            after: Some(Box::new(Expr::Variable(cursor.into()))),
            before: None,
            range: None,
            opaque_cursor: true,
            merge_site: None,
            provenance: KeyProvenance::Const,
        })
    }
    fn contract(body: Vec<Stmt>) -> Result<String, &'static str> {
        let schema = Schema {
            tables: BTreeMap::from([(
                "rows".into(),
                public_table(
                    BTreeMap::from([("id".into(), ColumnType::Id)]),
                    BTreeMap::from([(
                        "byId".into(),
                        Index {
                            columns: vec!["id".into()],
                            unique: true,
                        },
                    )]),
                ),
            )]),
            ..Schema::default()
        };
        let p = Program {
            name: "log".into(),
            kind: ProgramKind::Query,
            args: BTreeMap::from([
                ("a".into(), ArgType::Optional(Box::new(ArgType::Cursor))),
                ("c".into(), ArgType::Optional(Box::new(ArgType::Cursor))),
                ("flag".into(), ArgType::Bool),
            ]),
            read_time_granularity_ms: None,
            body,
        };
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&p)
            .unwrap();
        resumable_log_cursor(&p, &certificate)
    }
    #[test]
    fn returned_cursor_not_first_arg_or_auxiliary_read() {
        assert_eq!(
            contract(vec![
                Stmt::Const {
                    name: "unused".into(),
                    value: page("aux", Order::Desc, 60, "a")
                },
                Stmt::Const {
                    name: "position".into(),
                    value: Expr::Variable("c".into())
                },
                Stmt::Const {
                    name: "rows".into(),
                    value: page("result", Order::Asc, 50, "position")
                },
                Stmt::Return(Expr::Variable("rows".into())),
            ]),
            Ok("c".into())
        );
        assert_eq!(
            contract(vec![
                Stmt::Const {
                    name: "unused".into(),
                    value: page("aux", Order::Asc, 1, "a")
                },
                Stmt::Return(page("result", Order::Desc, 50, "c")),
            ]),
            Err("descending")
        );
        assert_eq!(
            contract(vec![Stmt::Return(page("result", Order::Asc, 51, "c"))]),
            Err("page-bound")
        );
    }
    #[test]
    fn every_return_must_continue_the_same_ascending_log() {
        let branches = |other| {
            vec![Stmt::If {
                condition: Expr::Variable("flag".into()),
                then_body: vec![Stmt::Return(page("yes", Order::Asc, 50, "c"))],
                else_body: vec![Stmt::Return(other)],
            }]
        };
        assert_eq!(
            contract(branches(page("no", Order::Asc, 10, "c"))),
            Ok("c".into())
        );
        assert_eq!(
            contract(branches(page("no", Order::Desc, 10, "c"))),
            Err("descending")
        );
        assert_eq!(
            contract(branches(page("no", Order::Asc, 10, "a"))),
            Err("cursor-binding")
        );
        assert_eq!(
            contract(branches(Expr::Array(vec![]))),
            Err("cursor-binding")
        );
        assert_eq!(
            contract(vec![Stmt::If {
                condition: Expr::Variable("flag".into()),
                then_body: vec![Stmt::Return(page("yes", Order::Asc, 10, "c"))],
                else_body: vec![],
            }]),
            Err("cursor-binding")
        );
        assert_eq!(
            contract(vec![
                Stmt::For {
                    binding: "i".into(),
                    domain: LoopDomain::LiteralRange {
                        start: 0,
                        end_exclusive: 1
                    },
                    body: vec![Stmt::Return(Expr::Array(vec![]))],
                },
                Stmt::Return(page("result", Order::Asc, 10, "c")),
            ]),
            Err("cursor-binding")
        );
        assert_eq!(
            contract(vec![
                Stmt::Let {
                    name: "position".into(),
                    value: Expr::Variable("c".into())
                },
                Stmt::Assign {
                    name: "position".into(),
                    value: Expr::Variable("a".into())
                },
                Stmt::Return(page("result", Order::Asc, 10, "position"))
            ]),
            Ok("a".into())
        );
    }
}
