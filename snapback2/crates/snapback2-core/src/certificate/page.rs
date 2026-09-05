use super::*;

pub(super) fn resolve_result_page_site(
    schema: &Schema,
    statements: &[Stmt],
    declared: &str,
) -> Result<ResultPageSite, Vec<CheckError>> {
    fn visit_expr<'a>(expression: &'a Expr, scans: &mut Vec<&'a Scan>) {
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
            Expr::Scan(scan) => scans.push(scan),
            Expr::Literal(_)
            | Expr::Variable(_)
            | Expr::Input(_)
            | Expr::Get(_)
            | Expr::Exists(_) => {}
        }
    }
    fn visit_statements<'a>(statements: &'a [Stmt], scans: &mut Vec<&'a Scan>) {
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
                        LoopDomain::Page(scan) => scans.push(scan),
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
        .filter(|scan| scan.site == declared || scan.merge_site.as_deref() == Some(declared))
        .collect::<Vec<_>>();
    let Some(first) = matching.first() else {
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
    let consistent = matching.iter().all(|scan| {
        scan.table == page.table
            && scan.index == page.index
            && scan.order == page.order
            && scan.prefix.len() + page.suffix.len() == index.columns.len()
            && (scan.merge_site.as_deref() == Some(declared)) == merge
    });
    if !consistent
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
