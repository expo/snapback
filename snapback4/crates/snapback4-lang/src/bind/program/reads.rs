//! Seeks and row-local scan predicates.
use super::*;

impl<'a> Binder<'a> {
    // @ref LLP 3000.007#5.3 — a seek constrains the first index column after the pinned prefix.
    pub(super) fn seek(&mut self, info: &'a TableInfo, read: &ReadExpr, index: &ast::IndexDecl, out: &mut Vec<Stmt>) -> Fallible<Option<ir::Range>> {
        if read.seeks.is_empty() { return Ok(None); }
        let mut range = ir::Range { gt: None, gte: None, lt: None, lte: None };
        for bound in &read.seeks {
            if index.columns.get(read.keys.len()) != Some(&bound.column) || read.matching.is_some() {
                return Err(type_error(&bound.site, "a seek compares the first unpinned column of a plain index", "t[prefix, col >= start, col < end] first 50 by index"));
            }
            let expected = self.column_ty(info, &bound.column);
            let (value, ty) = self.field_value(&ObjectField { name: bound.column.clone(), value: Some(bound.value.clone()), site: bound.site.clone() }, &expected, out)?;
            if !ty.comparable(&expected) || ty.is_optional() || expected.is_optional() {
                return Err(type_error(&bound.site, format!("seek on {}.{} expects {}, got {}", read.table, bound.column, expected.name(), ty.name()), format!("{} {} <{}>", bound.column, bound.op, expected.name())));
            }
            let slot = match bound.op.as_str() { ">" => &mut range.gt, ">=" => &mut range.gte, "<" => &mut range.lt, "<=" => &mut range.lte, _ => unreachable!("parser seek comparison") };
            if slot.is_some() { return Err(type_error(&bound.site, "a seek bound is repeated", "write one lower and one upper bound")); }
            *slot = Some(Box::new(self.snapshot(value, out)));
        }
        if (range.gt.is_some() && range.gte.is_some()) || (range.lt.is_some() && range.lte.is_some()) {
            return Err(type_error(&read.site, "a seek has at most one lower and one upper bound", "t[prefix, col >= start, col < end] first 50 by index"));
        }
        Ok(Some(range))
    }
}

impl Binder<'_> {
    pub(super) fn scan_filter(&mut self, read: &ReadExpr, index: &ast::IndexDecl) -> Fallible<(ReadExpr, Option<Box<Expr>>)> {
        let mut read = read.clone();
        let Some(predicate) = read.filter.take() else { return Ok((read, None)); };
        // A single next-column comparison is the same seek as its key spelling.
        if read.seeks.is_empty() && read.matching.is_none()
            && let A::Binary { op, left, right, site } = predicate.as_ref()
            && matches!(op.as_str(), ">" | ">=" | "<" | "<=")
            && let A::Member { base, name, .. } = left.as_ref()
            && matches!(base.as_ref(), A::Focal { .. })
            && index.columns.get(read.keys.len()) == Some(name)
            && !has_focal(right)
        {
            read.seeks.push(ast::SeekBound { column: name.clone(), op: op.clone(), value: *right.clone(), site: site.clone() });
            self.notes.push(Diagnostic::new(site, "N_SEEK", "a `where` on the next index column is a seek; write it in the key", print::read_expr(&read)).guide("reads"));
            return Ok((read, None));
        }
        let prior = self.focal.replace(("$filter".into(), Ty::Row(read.table.clone())));
        let kind = std::mem::replace(&mut self.kind, ProgramKind::Query);
        let mut body = Vec::new();
        self.push_scope();
        let bound = self.expr(&predicate, &mut body);
        self.pop_scope();
        self.kind = kind;
        self.focal = prior;
        let (value, ty) = bound?;
        if !ty.is_bool() { return Err(type_error(predicate.site(), format!("where needs a bool predicate, got {}", ty.name()), "where .col = value")); }
        // @ref LLP 3000.007#5.6 — predicate setup, including lazy reads, runs afresh for each rule-visible row.
        let value = if body.is_empty() { value } else { Expr::Block { body, value: Box::new(value) } };
        Ok((read, Some(Box::new(value))))
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
