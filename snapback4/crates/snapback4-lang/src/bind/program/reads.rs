//! Seeks and row-local scan predicates.
use super::*;

impl<'a> Binder<'a> {
    // @ref LLP 3000.011.000.001#4 — retain the binder's actual choice for why, never infer a new lookup or rewrite.
    pub(super) fn record_selection(&mut self, site: &str, read: &ReadExpr, index: &ast::IndexDecl, result: &str, reason: &str) {
        let named = read.keys.iter().all(|key| key.column.is_some());
        let bindings = index.columns.iter().enumerate().filter_map(|(position, column)| {
            let key = if named { read.keys.iter().find(|key| key.column.as_ref() == Some(column)) } else { read.keys.get(position) }?;
            Some(format!("{column} = {}", self.catalog.source.operand(&key.value)))
        }).collect::<Vec<_>>().join(", ");
        let origin = if self.catalog.synthesized.contains(&(read.table.clone(), index.name.clone())) { "synthesized; " } else { "" };
        let source = if origin.is_empty() { String::new() } else { format!("; read: {}", self.catalog.read_origins.get(&read.site.to_string()).cloned().unwrap_or_else(|| print::read_expr(read))) };
        let mut selection = format!("selected {} ({bindings}); result: {result}; {origin}{reason}{source}", index.name);
        if !self.variants.is_empty() {
            let when = self.variants.iter().map(|(name, present)| format!("{} {}", name.trim_start_matches("$intentPresent:").trim_start_matches("$intentSearch:"), if *present { "present" } else { "absent" })).collect::<Vec<_>>().join(" and ");
            selection = format!("when {when}: {selection}");
        }
        self.selections.entry(site.into()).and_modify(|prior| { if !prior.contains(&selection) { prior.push_str("; "); prior.push_str(&selection); } }).or_insert(selection);
    }

    // @ref LLP 3000.007#10 — a covered total unique key reads one row; additional named equalities check that row.
    pub(super) fn read_value(&mut self, read: &ReadExpr, mode: ReadMode, out: &mut setup::Body) -> Fallible<Expr> {
        let info = self.table(&read.table, &read.site)?;
        for key in &read.keys { if let Some(field) = &key.column { super::super::row_views::predicate_field(info, field, &read.site)?; } }
        if !read.seeks.is_empty() { return Err(type_error(&read.site, "a seek needs a bounded page", "t[prefix, col >= start] first 50 by index")); }
        if read.keys.is_empty() { return Err(unknown(&read.site, format!("{}[] reads nothing; a point read needs a key", read.table), format!("{}[id]", read.table))); }
        let mut point = read.clone();
        let implicit_group = mode == ReadMode::FilteredPoint && info.maintained.is_some() && point.index.is_none();
        if implicit_group { point.index = Some("byGroup".into()); }
        let (mut keys, index, mut selection) = self.select_index(info, &point, mode, out)?;
        super::super::point_key::check(info, &index, read, &keys.iter().map(|(column, _, ty)|
            (column.as_deref(), !ty.is_optional() && *ty != Ty::Unknown)).collect::<Vec<_>>())?;
        if implicit_group { selection = "complete maintained group key".into(); }
        let extra = keys.len() > index.columns.len();
        let mut equalities = Vec::new();
        if extra {
            for (column, value, ty) in &mut keys {
                let column = column.as_ref().expect("named key");
                if column != "id" && !info.columns.contains_key(column) {
                    return Err(unknown(&read.site, format!("{} has no column {column}", read.table), name_rewrite(column, info.columns.keys().map(String::as_str).chain(["id"]), None)));
                }
                let expected = self.key_ty(info, &index, column);
                if !ty.comparable(&expected) { return Err(type_error(&read.site, format!("{column} is {}; {}.{column} is {}", ty.name(), read.table, expected.name()), format!("use {} for {column}", expected.name()))); }
                *value = self.snapshot(value.clone(), out);
                if !index.columns.contains(column) { equalities.push((column.clone(), value.clone())); }
            }
            keys.retain(|(column, _, _)| index.columns.contains(column.as_ref().unwrap()));
        }
        let key = self.order_keys(info, &index, keys)?;
        let location = self.site();
        self.record_selection(&location, read, &index, if mode == ReadMode::Exists { "exists" } else if info.maintained.is_some() { "scalar" } else { "row or null" }, &selection);
        self.sources.insert(location.clone(), (read.site.clone(), print::read_expr(read)));
        let mut point = Read { site: location, table: read.table.clone(), index: index.name, key, provenance: KeyProvenance::Shape };
        // @ref LLP 3000.028#3.4 — only a caller-proved existence read may use the whole owner partition.
        if mode == ReadMode::Exists && equalities.is_empty() {
            super::super::own_keys::existence(self.schema, &mut point);
        }
        if equalities.is_empty() { return Ok(if mode == ReadMode::Exists { Expr::Exists(point) } else { Expr::Get(point) }); }
        let row = self.temp("probe");
        out.push(Stmt::Let { name: row.clone(), value: Expr::Get(point) });
        let mut condition = Expr::Binary { op: BinaryOp::Ne, left: Box::new(ir::var(&row)), right: Box::new(Expr::Literal(Value::Null)) };
        // @ref LLP 3000.014#5-what-derives-from-the-capture — a denied aggregate carries a null value, not a present group.
        if mode == ReadMode::Exists && info.maintained.is_some() {
            let present = Expr::Binary { op: BinaryOp::Ne, left: Box::new(ir::field(ir::var(&row), "value")), right: Box::new(Expr::Literal(Value::Null)) };
            condition = Expr::Binary { op: BinaryOp::And, left: Box::new(condition), right: Box::new(present) };
        }
        for (column, value) in equalities {
            let test = Expr::Binary { op: BinaryOp::Eq, left: Box::new(ir::field(ir::var(&row), &column)), right: Box::new(value) };
            condition = Expr::Binary { op: BinaryOp::And, left: Box::new(condition), right: Box::new(test) };
        }
        if mode == ReadMode::Exists { return Ok(condition); }
        out.push(Stmt::If { condition, then_body: Vec::new(), else_body: vec![Stmt::Assign { name: row.clone(), value: Expr::Literal(Value::Null) }] });
        Ok(ir::var(&row))
    }

    // @ref LLP 3000.007#5.3 — a seek constrains the first index column after the pinned prefix.
    pub(super) fn seek(&mut self, info: &'a TableInfo, read: &ReadExpr, index: &ast::IndexDecl, out: &mut setup::Body) -> Fallible<Option<ir::Range>> {
        if read.seeks.is_empty() { return Ok(None); }
        let mut range = ir::Range { gt: None, gte: None, lt: None, lte: None };
        for bound in &read.seeks {
            if index.columns.get(read.keys.len()) != Some(&bound.column) || read.matching.is_some() {
                return Err(type_error(&bound.site, "a seek compares the first unpinned column of a plain index", "t[prefix, col >= start, col < end] first 50 by index"));
            }
            let expected = self.key_ty(info, index, &bound.column);
            let (value, ty) = self.field_value(&ObjectField { spread: false, name: bound.column.clone(), value: Some(bound.value.clone()), site: bound.site.clone() }, &expected, out)?;
            if !ty.comparable(&expected) || ty.is_optional() {
                let endpoint = print::expression(&bound.value);
                let rewrite = if ty.is_optional() {
                    format!("put the read inside `if {endpoint} != null:`, then `{} where .{} {} {endpoint}`", read.table, bound.column, bound.op)
                } else {
                    format!("use a present {} endpoint in `{} where .{} {} {endpoint}`", expected.required().name(), read.table, bound.column, bound.op)
                };
                return Err(type_error(&bound.site, format!("seek on {}.{} expects present {}, got {}", read.table, bound.column, expected.required().name(), ty.name()), rewrite));
            }
            let slot = match bound.op.as_str() { ">" => &mut range.gt, ">=" => &mut range.gte, "<" => &mut range.lt, "<=" => &mut range.lte, _ => unreachable!("parser seek comparison") };
            if slot.is_some() { return Err(type_error(&bound.site, "a seek bound is repeated", "write one lower and one upper bound")); }
            *slot = Some(Box::new(self.snapshot(value, out)));
        }
        if (range.gt.is_some() && range.gte.is_some()) || (range.lt.is_some() && range.lte.is_some()) {
            return Err(type_error(&read.site, "a seek has at most one lower and one upper bound", "t[prefix, col >= start, col < end] first 50 by index"));
        }
        // Null sorts below every present value. An upper-only nullable seek
        // must skip the entire null segment, including its id suffixes.
        if range.gt.is_none() && range.gte.is_none()
            && read.seeks.first().is_some_and(|bound| self.key_ty(info, index, &bound.column).is_optional()) {
            range.gt = Some(Box::new(ir::lit(Value::Null)));
        }
        Ok(Some(range))
    }
}

impl Binder<'_> {
    pub(super) fn variant(&self) -> Option<ir::VariantId> {
        (!self.variants.is_empty()).then(|| {
            let hash = snapback4_core::value::digest(&self.variants);
            std::array::from_fn(|i| u32::from_str_radix(&hash[i * 8..i * 8 + 8], 16).expect("hex digest"))
        })
    }

    // @ref LLP 3000.007#18.5 — a declared page shape after a scalar predicate needs no wrapper or correction loop.
    pub(super) fn page_shape(&self, read: &ReadExpr) -> Option<A> {
        let predicate = read.filter.as_ref()?;
        let (base, name, site) = trailing_shape(predicate)?;
        self.catalog.shapes.get(name)?;
        // Type the operand in isolation: no speculative setup, notes or source sites
        // escape. A valid row/object shape inside the predicate keeps its meaning.
        let mut probe = self.clone();
        probe.focal = Some(("$filter".into(), Ty::Row(read.table.clone())));
        probe.kind = ProgramKind::Query;
        probe.in_predicate = true;
        let (_, ty) = probe.expr(base, &mut setup::Body::default()).ok()?;
        if matches!(ty.required(), Ty::Row(_) | Ty::Object(_) | Ty::RowShape(_) | Ty::RowObject(_) | Ty::Page(_, _) | Ty::Collection(_, _) | Ty::List(_, _)) { return None; }
        let mut page = read.clone();
        remove_trailing_shape(page.filter.as_mut()?);
        Some(A::ShapeUse { base: Box::new(A::Read(page)), name: name.into(), site: site.clone() })
    }

    pub(super) fn scan_filter(&mut self, read: &ReadExpr, index: &ast::IndexDecl) -> Fallible<(ReadExpr, Option<Box<Expr>>)> {
        let mut read = read.clone();
        let Some(mut predicate) = read.filter.take() else { return Ok((read, None)); };
        // Planning knows parameter declarations; binding also knows helper,
        // local and lane selectors. Only present, infallible endpoints may
        // leave the short-circuit predicate in either pass.
        let required = self.scopes.iter().flat_map(|scope| scope.keys())
            .filter(|name| self.binding(name).is_some_and(|binding| !binding.ty.is_optional()))
            .cloned().collect();
        if !read.order_keys.is_empty() && read.matching.is_none() {
            let info = self.table(&read.table, &read.site)?;
            let mut parts = Vec::new(); super::super::intent::split(*predicate, &mut parts);
            let mut residual = Vec::new();
            for part in parts {
                let candidate = super::super::intent::comparison(&part).map(|(column, op, value)| (column, vec![op], value))
                    .or_else(|| super::super::intent::equality(&part, info)
                        .filter(|(column, _)| !self.key_ty(info, index, column).is_optional())
                        .map(|(column, value)| (column, vec![">=".into(), "<=".into()], value)));
                if let Some((column, ops, value)) = candidate
                    && index.columns.get(read.keys.len()) == Some(&column)
                    && super::super::intent_aggregates::safe_endpoint(&value, &required)
                    && ops.iter().all(|op| !read.seeks.iter().any(|bound| bound.op.starts_with('<') == op.starts_with('<'))) {
                    for op in ops { read.seeks.push(ast::SeekBound { column: column.clone(), op, value: value.clone(), site: part.site().clone() }); }
                } else { residual.push(part); }
            }
            let Some(remaining) = super::super::intent::conjunction(residual) else { return Ok((read, None)); };
            predicate = remaining;
        }
        // A single next-column comparison is the same seek as its key spelling.
        if read.seeks.is_empty() && read.matching.is_none()
            && let A::Binary { op, left, right, site } = predicate.as_ref()
            && matches!(op.as_str(), ">" | ">=" | "<" | "<=")
            && let A::Member { base, name, .. } = left.as_ref()
            && matches!(base.as_ref(), A::Focal { .. })
            && index.columns.get(read.keys.len()) == Some(name)
            && !has_focal(right)
            && super::super::intent_aggregates::safe_endpoint(right, &required)
        {
            read.seeks.push(ast::SeekBound { column: name.clone(), op: op.clone(), value: *right.clone(), site: site.clone() });
            self.notes.push(Diagnostic::new(site, "N_SEEK", "a `where` on the next index column is a seek; write it in the key", print::read_expr(&read)).guide("reads"));
            return Ok((read, None));
        }
        // @ref LLP 3000.007#20.3 — an unscoped filter can spend the whole page meter on unrelated authors.
        if self.kind == ProgramKind::Query && read.keys.is_empty() && read.seeks.is_empty() && read.matching.is_none()
            && has_focal(&predicate) && !pins_leading_column(&predicate, index.columns.first().map(String::as_str))
        {
            let consequence = if follow_edge_filter(&predicate, self.table(&read.table, &read.site)?) {
                "pages come back short and incomplete when followed authors are sparse (`complete: false`)"
            } else { "sparse matches can exhaust the row meter and return short `complete: false` pages" };
            self.notes.push(Diagnostic::new(predicate.site(), "N_SPARSE_FILTER",
                format!("{} by {}: this unscoped `where` pins no index prefix; {consequence}", read.table, index.name),
                "pin a column with `where .col = value`, choose `by .col`, or read a `view` (see `snapback4 guide feeds`)").guide("feeds"));
        }
        let value = self.row_predicate(&read.table, &predicate)?;
        Ok((read, Some(Box::new(value))))
    }

    pub(super) fn row_predicate(&mut self, table: &str, predicate: &A) -> Fallible<Expr> {
        let row_ty = Ty::Row(table.into());
        let prior = self.focal.replace(("$filter".into(), row_ty.clone()));
        let kind = std::mem::replace(&mut self.kind, ProgramKind::Query);
        let predicate_context = std::mem::replace(&mut self.in_predicate, true);
        let mut body = setup::Body::default();
        self.push_scope();
        // A fresh lexical row snapshot lets short-circuit guards narrow its
        // fields without leaking facts to another scan or an enclosing row.
        self.scopes.last_mut().unwrap().insert("$filter".into(), Binding {
            runtime: "$filter".into(), declared: row_ty.clone(), ty: row_ty,
            parameter: false, revision: 0, fields: BTreeMap::new(), error: None, origins: Vec::new(),
        });
        let bound = self.expr(predicate, &mut body);
        self.pop_scope();
        self.kind = kind;
        self.in_predicate = predicate_context;
        self.focal = prior;
        let (value, ty) = bound?;
        if !ty.is_bool() { return Err(type_error(predicate.site(), format!("where needs a bool predicate, got {}", ty.name()), "where .col = value")); }
        // @ref LLP 3000.007#5.6 — predicate setup, including lazy reads, runs afresh for each rule-visible row.
        Ok(if body.is_empty() { value } else { Expr::Block { body: body.code, value: Box::new(value) } })
    }
}

fn pins_leading_column(expr: &A, column: Option<&str>) -> bool {
    let focal_column = |value: &A| matches!(value, A::Member { base, name, .. } if matches!(base.as_ref(), A::Focal { .. }) && Some(name.as_str()) == column);
    match expr {
        A::Binary { op, left, right, .. } if op == "and" => pins_leading_column(left, column) || pins_leading_column(right, column),
        A::Binary { op, left, right, .. } if op == "or" => pins_leading_column(left, column) && pins_leading_column(right, column),
        A::Binary { op, left, right, .. } if op == "=" => (focal_column(left) && !has_focal(right)) || (focal_column(right) && !has_focal(left)),
        _ => false,
    }
}

fn has_focal(expr: &A) -> bool {
    match expr {
        A::Focal { .. } => true,
        A::Name { .. } | A::Literal { .. } => false,
        A::Member { base, .. } | A::Unary { value: base, .. } => has_focal(base),
        A::Binary { left, right, .. } => has_focal(left) || has_focal(right),
        A::Call { args, .. } => args.iter().any(has_focal),
        // Other forms stay predicates; a read on a row-dependent key must not escape the row.
        _ => true,
    }
}

/// Only the rightmost postfix can be the builder's attempted page shape.
fn trailing_shape(expr: &A) -> Option<(&A, &str, &Site)> {
    match expr {
        A::ShapeUse { base, name, site } => Some((base, name, site)),
        A::Unary { value, .. } => trailing_shape(value),
        A::Binary { right, .. } => trailing_shape(right),
        A::If { otherwise, .. } => trailing_shape(otherwise),
        _ => None,
    }
}

fn remove_trailing_shape(expr: &mut A) {
    match expr {
        A::ShapeUse { base, .. } => *expr = *base.clone(),
        A::Unary { value, .. } => remove_trailing_shape(value),
        A::Binary { right, .. } => remove_trailing_shape(right),
        A::If { otherwise, .. } => remove_trailing_shape(otherwise),
        _ => unreachable!("a trailing shape was found"),
    }
}

// Recognize the edge probe structurally, including renamed follow tables
// and named keys. Ordinary row predicates retain the general sparse note.
fn follow_edge_filter(expr: &A, table: &TableInfo) -> bool {
    match expr {
        A::Exists { read, .. } => read.keys.iter().any(|key| matches!(&key.value, A::Name { name, .. } if name == "viewer"))
            && read.keys.iter().any(|key| matches!(&key.value, A::Member { base, name, .. } if matches!(base.as_ref(), A::Focal { .. }) && table.columns.get(name).is_some_and(|ty| ty.kind == ast::TypeKind::Principal))),
        A::Binary { left, right, .. } => follow_edge_filter(left, table) || follow_edge_filter(right, table),
        A::Unary { value, .. } | A::ShapeUse { base: value, .. } => follow_edge_filter(value, table),
        _ => false,
    }
}
