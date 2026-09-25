//! Expand a planned view into source-table lanes before collecting indexes.
use super::{intent, intent_walk as walk};
use super::catalog::Catalog;
use crate::ast::*;
use crate::diag::{Diagnostic, Fallible, type_error};
use std::collections::BTreeMap;

pub(super) fn expand(catalog: &mut Catalog, diagnostics: &mut Vec<Diagnostic>) {
    let mut views = BTreeMap::new();
    for view in catalog.documents.iter().flat_map(|doc| &doc.views) {
        if views.insert(view.name.clone(), view.clone()).is_some() || catalog.tables.contains_key(&view.name) {
            diagnostics.push(type_error(&view.site, format!("duplicate view {}", view.name), "give each table and view a distinct name"));
        }
    }
    for doc in &mut catalog.documents {
        for view in &doc.views {
            let site = view.site.clone();
            doc.programs.push(ProgramDecl { held: false, predicts: false, server: false, native: false,
                kind: ProgramKind::Query, name: format!("$view:{}", view.name), args: Vec::new(), prelude: Vec::new(), site: site.clone(),
                body: vec![Stmt::Return { site: site.clone(), value: Expr::Read(ReadExpr {
                    table: view.name.clone(), keys: Vec::new(), seeks: Vec::new(), computed: BTreeMap::new(), index: None, order_keys: vec!["id".into()],
                    filter: None, matching: None, range: Some(RangeSpec { order: Order::Asc, take: 1, cursor: None, site: site.clone() }), site,
                }) }],
            });
        }
        walk::document(doc, &mut |value| {
            if let Expr::Read(read) | Expr::Exists { read, .. } = value {
                catalog.read_origins.entry(read.site.to_string()).or_insert_with(|| catalog.source.expression(&Expr::Read(read.clone())));
                catalog.canonical_read_origins.entry(read.site.to_string()).or_insert_with(|| if read.index.is_none() { crate::print::read_expr(read) } else { catalog.source.expression(&Expr::Read(read.clone())) });
            }
        });
        walk::document(doc, &mut |value| {
            if let Expr::Exists { read, site } = value && let Some(view) = views.get(&read.table) {
                let mut read = read.clone();
                read.range = Some(RangeSpec { order: Order::Asc, take: 1, cursor: None, site: site.clone() });
                match read_view(view, &read) {
                    Ok(merge) => *value = Expr::Binary { op: ">".into(), left: Box::new(Expr::Call { name: "count".into(), args: vec![Expr::Merge(merge)], site: site.clone() }),
                        right: Box::new(Expr::Literal { value: Literal::Number("0".into()), site: site.clone() }), site: site.clone() },
                    Err(error) => diagnostics.push(error),
                }
            } else if let Expr::Read(read) = value && let Some(view) = views.get(&read.table) {
                match read_view(view, read) { Ok(merge) => *value = Expr::Merge(merge), Err(error) => diagnostics.push(error) }
            }
        });
    }
}

fn read_view(view: &ViewDecl, read: &ReadExpr) -> Fallible<MergeExpr> {
    if !read.keys.is_empty() || read.index.is_some() || !read.seeks.is_empty() {
        return Err(type_error(&read.site, "view reads use predicates and projected order fields", format!("{} where .id = value first 20 by .id", view.name)).guide("reads"));
    }
    let range = read.range.clone().unwrap_or(RangeSpec { order: Order::Asc, take: 8192, cursor: None, site: read.site.clone() });
    let mut lanes = Vec::new();
    let order = if read.order_keys.is_empty() { vec!["id".into()] } else { read.order_keys.clone() };
    for (branch_number, branch) in view.branches.iter().enumerate() {
        let mut projection = BTreeMap::from([("id".to_owned(), focal("id", &branch.site))]);
        for field in &branch.fields {
            match field {
                ShapeField::Bare { name, site } => { projection.insert(name.clone(), focal(name, site)); }
                ShapeField::Field { name, value, .. } if name != "id" => { projection.insert(name.clone(), value.clone()); }
                _ => return Err(type_error(&branch.site, "view branches list named fields and carry their source id implicitly", "write { post: .id, actor: .authorId, at }; omit an explicit id field").guide("reads")),
            }
        }
        let mut source_order = Vec::new();
        for field in &order {
            let Some(source) = projection.get(field).and_then(|value| intent::column(value)) else {
                return Err(type_error(&branch.site, format!("view {} order field .{field} must project a bare column in branch {}", view.name, branch.source), format!("project {field}: .<sourceColumn> in every branch")).guide("reads"));
            };
            source_order.push(source.to_owned());
        }
        let mut filter = Vec::new();
        if let Some(predicate) = &branch.predicate { filter.push(predicate.clone()); }
        let mut eliminate = false;
        if let Some(predicate) = &read.filter {
            let mut predicates = Vec::new();
            intent::split(*predicate.clone(), &mut predicates);
            for mut predicate in predicates {
                // Literal equality to a constant projection can prune a lane;
                // dynamic equalities remain ordinary source-row predicates.
                if let Expr::Binary { op, left, right, .. } = &predicate && op == "=" {
                    for (field, other) in [(left.as_ref(), right.as_ref()), (right.as_ref(), left.as_ref())] {
                        if let Some(projected) = intent::column(field).and_then(|name| projection.get(name))
                            && let (Expr::Literal { value: a, .. }, Expr::Literal { value: b, .. }) = (projected, other) && a != b { eliminate = true; }
                    }
                }
                super::view_predicate::project(&mut predicate, &projection)?;
                filter.push(predicate);
            }
        }
        if eliminate { continue; }
        let planned = ReadExpr { computed: Default::default(), table: branch.source.clone(), keys: Vec::new(), seeks: Vec::new(), filter: intent::conjunction(filter), index: None,
            order_keys: source_order, matching: read.matching.clone(), range: read.range.clone(), site: read.site.clone() };
        let mut fields = branch.fields.clone();
        if !fields.iter().any(|field| matches!(field, ShapeField::Bare { name, .. } if name == "id")) {
            fields.push(ShapeField::Field { name: "id".into(), value: focal("id", &branch.site), site: branch.site.clone() });
        }
        lanes.push(MergeLane { nulls: None, distinct: None, branch: Some(format!("{}:{branch_number}", view.name)), planned: Some(Box::new(planned)), project: Some(fields), table: Some(branch.source.clone()), prefix: Vec::new(), columns: None, loop_: None, site: branch.site.clone() });
    }
    Ok(MergeExpr { view_order: order, table: view.name.clone(), matching: None, filter: None, index: String::new(), order: range.order, take: range.take, cursor: range.cursor, lanes, site: read.site.clone() })
}

fn focal(name: &str, site: &crate::diag::Site) -> Expr {
    Expr::Member { base: Box::new(Expr::Focal { site: site.clone() }), name: name.into(), site: site.clone() }
}
