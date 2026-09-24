//! Bind a planned view's source lanes independently, preserving source rules.
use super::*;

impl Binder<'_> {
    pub(super) fn planned_view(&mut self, merge: &ast::MergeExpr, out: &mut setup::Body, position: prefix::Position) -> Fallible<(Expr, Ty)> {
        let site = self.site();
        let cursor = merge.cursor.as_ref().map(|value| self.expr(value, out)).transpose()?;
        if let Some((_, ty)) = &cursor && ty.required() != Ty::Cursor {
            return Err(type_error(&merge.site, "after expects a cursor", "declare c: cursor ? and pass after c"));
        }
        let mut lanes = Vec::new();
        let mut result: Option<BTreeMap<String, Ty>> = None;
        let mut first_site = None;
        // Queries retain the view's shared cursor identity. A non-query with
        // one source is an ordinary admitted scan followed by a row shape;
        // representing it as a merge would reject safe capped mutations.
        let plain = self.caller_kind != ProgramKind::Query && merge.lanes.len() == 1
            && merge.lanes[0].project.is_some() && merge.lanes[0].loop_.is_none();
        for lane in &merge.lanes {
            let mut read = *lane.planned.clone().expect("planned lane");
            if let Some(range) = &mut read.range { range.cursor = None; }
            self.push_scope();
            let (source, binding) = if let Some((name, domain)) = &lane.loop_ {
                let (source, ty) = self.lane_domain(domain, out)?;
                (Some(source), self.declare(name, ty))
            } else { (None, String::new()) };
            let distinct = lane.distinct.as_ref().map(|value| self.expr(value, out).map(|(value, _)| value)).transpose()?;
            let mut setup = setup::Body::default();
            let (mut scan, _) = self.scan_at(&read, &mut setup, position)?;
            scan.after = cursor.as_ref().map(|(value, _)| Box::new(value.clone()));
            scan.opaque_cursor = cursor.is_some();
            scan.merge_site = Some(site.clone());
            if lane.project.is_none() {
                // Admission was checked against the original domain cap above.
                scan.take = Bound::Literal(merge.take);
                self.pop_scope();
                lanes.push(MergeLane { guard: None, distinct, branch: lane.branch.clone(), setup: setup.code, scan, source, binding, project: None });
                continue;
            }
            scan.after = None;
            let mut conjuncts = Vec::new();
            if let Some(filter) = &read.filter { super::super::intent::split(*filter.clone(), &mut conjuncts); }
            let guard = super::super::intent::conjunction(conjuncts.into_iter().filter(super::super::intent::independent).collect());
            let guard = guard.map(|guard| self.expr(&guard, out).map(|(value, _)| value)).transpose()?;
            let mut projection_setup = setup::Body::default();
            let project_binding = if plain { self.temp("view_row") } else { "$project".into() };
            let (project, ty) = self.shape_object(&project_binding, Ty::Row(read.table.clone()), lane.project.as_ref().expect("view projection"), &lane.site, &mut projection_setup)?;
            if plain {
                scan.merge_site = None;
                scan.after = cursor.as_ref().map(|(value, _)| Box::new(value.clone()));
                let max = scan.take.maximum() as u32;
                let target = self.temp("view_rows");
                out.extend(setup);
                out.push(Stmt::Let { name: target.clone(), value: Expr::Array(Vec::new()) });
                projection_setup.push(Stmt::Push { target: target.clone(), value: project });
                out.push_for(project_binding, LoopDomain::Page(scan), projection_setup);
                self.pop_scope();
                return Ok((ir::var(&target), Ty::Collection(Box::new(ty), max)));
            }
            let fields = match ty { Ty::RowShape(fields) | Ty::Object(fields) => fields, _ => unreachable!("shape object") };
            if let Some(prior) = &mut result {
                if prior.keys().ne(fields.keys()) {
                    return Err(type_error(&lane.site, format!("view {} branch fields differ from branch at {}", merge.table, first_site.as_ref().unwrap()), "project the same named fields in every view branch").guide("reads"));
                }
                for (name, ty) in fields {
                    let old = &prior[&name];
                    let joined = view_join(old, &ty).ok_or_else(|| type_error(&lane.site,
                        format!("view {} field {name}: {} conflicts with {} at {}", merge.table, ty.name(), old.name(), first_site.as_ref().unwrap()),
                        format!("project compatible values for {name} in every branch")).guide("reads"))?;
                    prior.insert(name, joined);
                }
            } else { first_site = Some(lane.site.clone()); result = Some(fields); }
            let project = if projection_setup.is_empty() { project } else { Expr::Block { body: projection_setup.code, value: Box::new(project) } };
            self.pop_scope();
            lanes.push(MergeLane { guard, distinct, branch: lane.branch.clone(), setup: setup.code, scan, source, binding, project: Some(project) });
        }
        if result.is_none() && !lanes.is_empty() {
            return Ok((Expr::Merge(Merge { position: None, view: None, order_keys: Vec::new(), site, lanes }), Ty::Page(merge.table.clone(), merge.take)));
        }
        let fields = match self.catalog.view_types.get(&merge.table) {
            Some(Ty::RowShape(fields)) => fields.clone(), _ => result.unwrap_or_default(),
        };
        let mut names = merge.view_order.clone();
        names.retain(|name| name != "id"); names.push("id".into());
        let mut suffix = names.into_iter().map(|name| {
            let kind = fields.get(&name).and_then(cursor_kind).ok_or_else(|| type_error(&merge.site,
                format!("view order .{name} has no scalar column type"), "order by a field projecting a scalar source column in every branch"))?;
            Ok(snapback4_core::cursor::CursorColumn { name, kind })
        }).collect::<Fallible<Vec<_>>>()?;
        suffix.push(snapback4_core::cursor::CursorColumn { name: "$branch".into(), kind: snapback4_core::schema::ColumnType::Text { max: 1024 } });
        let position = ir::ViewPosition { take: merge.take, order: if merge.order == ast::Order::Asc { Order::Asc } else { Order::Desc }, after: cursor.map(|(value, _)| Box::new(value)), suffix };
        self.view_types.insert(merge.table.clone(), Ty::RowShape(fields.clone()));
        Ok((Expr::Merge(Merge { position: Some(position), view: Some(merge.table.clone()), order_keys: merge.view_order.clone(), site, lanes }), Ty::Collection(Box::new(Ty::RowShape(fields)), merge.take)))
    }
}

fn view_join(a: &Ty, b: &Ty) -> Option<Ty> {
    let optional = a.is_optional() || b.is_optional();
    let a = a.required();
    let b = b.required();
    let joined = if matches!(a, Ty::Id | Ty::Ref(_)) && matches!(b, Ty::Id | Ty::Ref(_)) { Ty::Id }
        else if a == Ty::Null { b }
        else if b == Ty::Null { a }
        else if a.comparable(&b) { a.join(&b) }
        else { return None; };
    Some(if optional { joined.optional() } else { joined })
}

fn cursor_kind(ty: &Ty) -> Option<snapback4_core::schema::ColumnType> {
    use snapback4_core::schema::ColumnType as C;
    Some(match ty {
        Ty::Id | Ty::Ref(_) => C::Id, Ty::Principal => C::Principal,
        Ty::Int => C::Int, Ty::Bool => C::Bool, Ty::Time => C::Time,
        Ty::Text(max) => C::Text { max: *max }, Ty::Bytes => C::Bytes { max: u32::MAX },
        Ty::Enum(variants) => C::Enum { variants: variants.clone() },
        Ty::Decimal(scale) => C::Decimal { scale: *scale },
        Ty::Money(currency, scale) => C::Money { currency: currency.clone(), scale: *scale },
        Ty::Optional(inner) => C::Optional(Box::new(cursor_kind(inner)?)),
        _ => return None,
    })
}
