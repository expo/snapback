//! Resolve row extrema without changing the binary min/max overload.
use super::*;

impl Binder<'_> {
    // @ref LLP 3000.019#3.2 — literal columns retain their encoding and seek;
    // other scalar values bind to the aggregate row and fold the whole scan.
    pub(super) fn extremum(&mut self, name: &str, args: &[A], out: &mut setup::Body) -> Fallible<Option<(Expr, Ty)>> {
        if matches!(&args[1], A::Member { base, .. } if matches!(base.as_ref(), A::Focal { .. })) {
            return self.column_extremum(name, args, out);
        }
        let candidate = self.aggregate_domain(&args[0]).or_else(|| {
            self.catalog.extremum_domains.get(&args[0].site().to_string()).filter(|read|
                !self.catalog.tables.get(&read.table).and_then(|table| table.maintained.as_ref())
                    .is_some_and(|maintain| maintain.by.is_empty())).cloned()
        });
        let domain = if let Some(read) = candidate {
            self.is_page(&read, ReadMode::FilteredPoint)?.then_some(read)
        } else { None };
        let nonempty = domain.as_ref().is_some_and(|read| self.aggregate_nonempty(read));
        let mut probe = self.clone();
        let source_ty = match probe.expr(&args[0], &mut setup::Body::default()) {
            Ok((_, ty)) => {
                if ty.sequence().is_none() { return Ok(None); }
                Some(ty)
            }
            Err(error) if domain.is_none() => return Err(error),
            Err(_) => None,
        };
        let outer = probe.expr(&args[1], &mut setup::Body::default());
        if let Ok((_, other)) = &outer {
            if !other.is_optional() && source_ty.as_ref().is_some_and(|ty| ty.comparable(other)) {
                return Ok(None); // the existing binary collection overload
            }
            // An expression which needs the enclosing focal row cannot silently
            // switch to the aggregate row. Removing just that focal binding also
            // distinguishes nested shapes/aggregates that own their own `.`.
            probe.focal = None;
            if self.focal.is_some() && probe.expr(&args[1], &mut setup::Body::default()).is_err() {
                return Err(ambiguous(args[1].site(), format!("{name}'s value expression can bind the enclosing row"),
                    format!("move `{name}({}, {})` into a helper outside the enclosing shape; pass enclosing values as named arguments", print::expression(&args[0]), print::expression(&args[1]))).guide("reads"));
            }
        }
        let (source, item, domain) = if let Some(read) = domain {
            let (scan, _) = self.scan_at(&read, out, prefix::Position::Aggregate)?;
            self.shape_meter_note(&scan, &read);
            (Expr::Scan(scan), Ty::Row(read.table), true)
        } else {
            let (source, ty) = self.expr(&args[0], out)?;
            (source, ty.sequence().expect("probed sequence").0, false)
        };
        let saved = self.focal.replace(("$filter".into(), item.clone()));
        let predicate = std::mem::replace(&mut self.in_predicate, false);
        let kind = std::mem::replace(&mut self.kind, ProgramKind::Query);
        self.push_scope();
        self.declare("$filter", item);
        let mut body = setup::Body::default();
        let projected = self.expr(&args[1], &mut body);
        self.pop_scope();
        self.kind = kind;
        self.in_predicate = predicate;
        self.focal = saved;
        let (value, ty) = projected?;
        if matches!(ty.required(), Ty::List(..) | Ty::Collection(..) | Ty::Page(..) | Ty::Object(..) | Ty::RowShape(..) | Ty::RowObject(..) | Ty::Row(..) | Ty::WriteRow(..)) {
            return Err(type_error(args[1].site(), format!("{name} needs a scalar row expression, got {}", ty.name()),
                format!("{name}({}, .column + 1)", print::expression(&args[0]))));
        }
        let value = if body.is_empty() { value } else { Expr::Block { body: body.code, value: Box::new(value) } };
        let result = if nonempty && !ty.is_optional() { ty } else { ty.optional() };
        Ok(Some((Expr::Builtin { builtin: Builtin::ExtremumOf { max: name == "max", domain }, args: vec![source, value] }, result)))
    }

    // @ref LLP 3000.013#5.1 — domains retain aggregate admission and coverage.
    fn column_extremum(&mut self, name: &str, args: &[A], out: &mut setup::Body) -> Fallible<Option<(Expr, Ty)>> {
        let A::Member { base, name: field, .. } = &args[1] else { return Ok(None); };
        if !matches!(base.as_ref(), A::Focal { .. }) { return Ok(None); }
        // Speculation must not emit setup or consume fresh names for a scalar
        // binary call such as min(value, .column) inside an existing shape.
        let mut probe = self.clone();
        let domain = if let Some(read) = self.aggregate_domain(&args[0]) {
            self.is_page(&read, ReadMode::FilteredPoint)?.then_some(read)
        } else { None };
        let probed = match probe.expr(&args[0], &mut setup::Body::default()) {
            Ok(value) => Some(value),
            Err(error) if domain.is_none() => return Err(error),
            // A streaming domain need not be a valid materialized page.
            Err(_) => None,
        };
        if let Some((_, ty)) = probed {
            let Some((item, _)) = ty.sequence() else { return Ok(None); };
            if let Ok((_, other)) = probe.expr(&args[1], &mut setup::Body::default())
                && !other.is_optional() && ty.comparable(&other) {
                if self.member(Expr::Literal(Value::Null), item, field, args[1].site()).is_ok() {
                    return Err(ambiguous(args[1].site(), format!("{name} can compare two collections or aggregate .{field} from the first"),
                        format!("bind `other = .{field}` before this call and write `{name}({}, other)` for the binary comparison; for an aggregate, call `{name}(rows, .{field})` outside the enclosing shape", print::expression(&args[0]))).guide("reads"));
                }
                return Ok(None);
            }
        }
        let nonempty = domain.as_ref().is_some_and(|read| self.aggregate_nonempty(read));
        let (source, item, domain) = if let Some(mut read) = domain {
            // Bare table names reach the binder without intent planning.
            if matches!(&args[0], A::Name { .. }) {
                let info = self.table(&read.table, &read.site)?;
                if let Some(index) = info.indexes.iter().filter(|index| index.is_plain() && index.columns.first() == Some(field)).min_by_key(|index| &index.name) {
                    read.index = Some(index.name.clone());
                }
            }
            let (mut scan, _) = self.scan_at(&read, out, prefix::Position::Aggregate)?;
            if scan.orders_field(self.schema, field) {
                scan.order = if name == "max" { Order::Desc } else { Order::Asc };
                // Nulls contribute no extremum. Seek past their entire index
                // segment, including when there are no present values.
                if self.schema.tables[&read.table].columns.get(field).is_some_and(|column| matches!(column, snapback4_core::schema::ColumnType::Optional(_))) {
                    let range = scan.range.get_or_insert(ir::Range { gt: None, gte: None, lt: None, lte: None });
                    if range.gt.is_none() && range.gte.is_none() { range.gt = Some(Box::new(Expr::Literal(Value::Null))); }
                }
            }
            // The runtime seeks the first qualifying ordered value. Price that
            // candidate limit for advice only; the aggregate IR keeps its domain.
            // Expired rows are charged and skipped before a value qualifies.
            let mut advice = scan.clone();
            if scan.orders_field(self.schema, field) && !self.schema.tables[&read.table].is_expiring() { advice.take = Bound::Literal(1); }
            self.shape_meter_note(&advice, &read);
            (Expr::Scan(scan), Ty::Row(read.table), true)
        } else {
            let (source, ty) = self.expr(&args[0], out)?;
            (source, ty.sequence().expect("probed sequence").0, false)
        };
        let (_, ty) = self.member(Expr::Literal(Value::Null), item, field, args[1].site())?;
        // Column ordering uses the same total order as binary min/max. Nulls
        // contribute no value, including when every row's column is null.
        let result = if nonempty && !ty.is_optional() { ty } else { ty.optional() };
        Ok(Some((Expr::Builtin { builtin: Builtin::Extremum { field: field.clone(), max: name == "max", domain }, args: vec![source] }, result)))
    }
}
