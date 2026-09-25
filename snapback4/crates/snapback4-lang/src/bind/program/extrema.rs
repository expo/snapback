//! Resolve column extrema without changing the binary min/max overload.
use super::*;

impl Binder<'_> {
    // @ref LLP 3000.013#5.1 — domains retain aggregate admission and coverage.
    pub(super) fn extremum(&mut self, name: &str, args: &[A], out: &mut setup::Body) -> Fallible<Option<(Expr, Ty)>> {
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
            (Expr::Scan(scan), Ty::Row(read.table), true)
        } else {
            let (source, ty) = self.expr(&args[0], out)?;
            (source, ty.sequence().expect("probed sequence").0, false)
        };
        let (_, ty) = self.member(Expr::Literal(Value::Null), item, field, args[1].site())?;
        // Column ordering uses the same total order as binary min/max. Nulls
        // contribute no value, including when every row's column is null.
        Ok(Some((Expr::Builtin { builtin: Builtin::Extremum { field: field.clone(), max: name == "max", domain }, args: vec![source] }, ty.optional())))
    }
}
