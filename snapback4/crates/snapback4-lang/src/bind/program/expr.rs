//! Expression lowering with branch-owned setup statements.

use super::*;
use snapback4_core::calendar::Civil;

impl Binder<'_> {
    /// Bare tables are domains only at an aggregate/loop consumer; ordinary
    /// names keep their lexical meaning and ordinary pages keep their bounds.
    pub(super) fn aggregate_domain(&self, value: &A) -> Option<ReadExpr> {
        match value {
            A::Read(read) if read.range.is_none() && read.matching.is_none() => Some(read.clone()),
            A::Name { name, site } if self.binding(name).is_none() && self.catalog.tables.contains_key(name) =>
                Some(ReadExpr { cursor_prefix: None, order_keys: Vec::new(), computed: Default::default(), table: name.clone(), keys: Vec::new(), index: Some("byId".into()), range: None, matching: None, filter: None, seeks: Vec::new(), site: site.clone() }),
            _ => None,
        }
    }

    // ----- expressions -----

    /// An expression whose value is used (bound, returned, or a final
    /// write): writes yield their row.
    pub(super) fn value_of(&mut self, value: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        if let A::Write { .. } = value {
            return self.write(value, out, true).map(|opt| opt.expect("a valued write"));
        }
        self.expr(value, out)
    }

    /// Strict compound children run in source order, before setup emitted by
    /// a later child. Lexical values and their fields cannot change here;
    /// leaving those fields in their object also preserves pending provenance.
    pub(super) fn snapshot(&mut self, value: Expr, out: &mut setup::Body) -> Expr {
        if matches!(value, Expr::Literal(_) | Expr::Input(Input::Viewer | Input::Now)) || lexical_value(&value) {
            return value;
        }
        let name = self.temp("value");
        out.push(Stmt::Let { name: name.clone(), value });
        ir::var(&name)
    }

    pub(super) fn sequence_setup<'e>(&mut self, prior: impl Iterator<Item = &'e mut Expr>, setup: setup::Body, out: &mut setup::Body) {
        if !setup.is_empty() {
            for value in prior {
                *value = self.snapshot(std::mem::replace(value, Expr::Literal(Value::Null)), out);
            }
            out.extend(setup);
        }
    }

    pub(super) fn strict_args(&mut self, args: &[A], out: &mut setup::Body) -> Fallible<Vec<(Expr, Ty)>> {
        let mut values = Vec::<(Expr, Ty)>::new();
        let mut failed = None;
        for arg in args {
            let mut setup = setup::Body::default();
            match self.expr(arg, &mut setup) {
                Ok(value) => {
                    self.sequence_setup(values.iter_mut().map(|(e, _)| e), setup, out);
                    values.push(value);
                }
                Err(error) => { self.record_error(error.clone()); failed.get_or_insert(error); }
            }
        }
        match failed { Some(error) => Err(error), None => Ok(values) }
    }

    pub(super) fn expr(&mut self, expr: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        // Only shape/object/list construction forwards output position. Every
        // operator, call, key, predicate and assertion consumes its operands.
        let prior = self.returned_data;
        self.returned_data &= matches!(expr, A::Array { .. } | A::Object { .. } | A::Shape { .. } | A::ShapeUse { .. } | A::Member { .. } | A::Name { .. } | A::Focal { .. });
        let start = out.len();
        let result = self.expr_inner(expr, out);
        if !matches!(expr, A::Write { .. }) && point_facts::writes(&out[start..]) { self.invalidate_points(); }
        self.returned_data = prior;
        // Even a builtin's ordinary type refusal should explain why a whole
        // maintained value cannot be consumed. Successful calls are checked by
        // the shared IR allowlist; this only improves already-failing calls.
        if result.as_ref().is_err_and(|d| d.code == "E_QUARRY_TYPE") {
            let args: Vec<&A> = match expr { A::Call { args, .. } => args.iter().collect(), A::Binary { left, right, .. } => vec![left, right], _ => vec![] };
            let mut probe = self.clone();
            for arg in args {
                if let Ok((_, ty)) = probe.expr(arg, &mut setup::Body::default()) {
                    self.maintenance_operand(&ty, arg.site())?;
                }
            }
        }
        let result = result?;
        if !self.schema.receipts.is_empty() {
            let site = self.call_chain.iter().find(|(name, _)| self.catalog.documents.iter().flat_map(|d| &d.tables).filter_map(|t| t.receipts.as_ref()).any(|clause| &clause.operations[0] == name))
                .map(|(_, site)| site).unwrap_or_else(|| expr.site());
            self.receipt_sources.push((result.0.clone(), site.clone()));
        }
        Ok(result)
    }

    fn maintenance_operand(&self, ty: &Ty, site: &Site) -> Fallible<()> {
        match ty {
            Ty::Row(table) | Ty::WriteRow(table) | Ty::Page(table, _) => {
                if self.schema.row_view_predicate_field(table, "recountPending").is_some() {
                    return Err(Diagnostic::new(site, "E_VIEW_KEY", format!("value contains {table}.recountPending/pending maintenance state"),
                        "project the field you need first (value, member identity or copied member fields); return maintenance state only as query data").guide("maintains"));
                }
            },
            Ty::Optional(item) | Ty::List(item, _) | Ty::Collection(item, _) => self.maintenance_operand(item, site)?,
            Ty::Object(fields) | Ty::RowShape(fields) | Ty::RowObject(fields) => for ty in fields.values() { self.maintenance_operand(ty, site)?; },
            _ => {},
        }
        Ok(())
    }

    pub(super) fn computation(&mut self, expr: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let prior = std::mem::replace(&mut self.returned_data, false);
        let result = self.expr(expr, out);
        self.returned_data = prior;
        result
    }

    fn expr_inner(&mut self, expr: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let site = expr.site();
        match expr {
            A::Name { name, .. } if self.binding(name).is_none() && self.catalog.view_reads.contains_key(name) => {
                let mut merge = self.catalog.view_reads[name].clone();
                merge.site = site.clone();
                self.planned_view(&merge, out, prefix::Position::Page)
            }
            A::Name { name, .. } if self.binding(name).is_none() && self.catalog.tables.contains_key(name) => {
                self.read(&ReadExpr { cursor_prefix: None, computed: Default::default(), table: name.clone(), keys: Vec::new(), seeks: Vec::new(), filter: None, index: Some("byId".into()),
                    order_keys: vec!["id".into()], range: None, matching: None, site: site.clone() }, out)
            }
            A::Name { name, .. } => self.name(name, site),
            A::Focal { .. } => match &self.focal {
                Some((var, ty)) => Ok((ir::var(var), ty.clone())),
                None => Err(unknown(site, "focal . is valid only inside a row shape", "name the row: `row.field`")),
            },
            A::Literal { value, .. } => Ok(match value {
                Literal::Str(text) => (Expr::Literal(Value::String(text.clone())), Ty::Text(text.chars().count() as u32)),
                Literal::Number(text) => (Expr::Literal(Value::Int(super::super::integer_literal(text, site)?)), Ty::Int),
                Literal::Bool(b) => (Expr::Literal(Value::Bool(*b)), Ty::Bool),
                Literal::Null => (Expr::Literal(Value::Null), Ty::Null),
            }),
            A::Array { items, .. } => {
                let mut exprs = Vec::new();
                let mut item_ty: Option<Ty> = None;
                let args = self.strict_args(items, out)?;
                let origins: Vec<_> = args.iter().zip(items).map(|((_, ty), source)| (ty.clone(), source.clone())).collect();
                for (e, t) in args {
                    item_ty = Some(match item_ty {
                        Some(j) => j.join_item(&t).map_err(|error| self.join_error_many(error.at("[]"), &origins))?,
                        None => t,
                    });
                    exprs.push(e);
                }
                let max = exprs.len() as u32;
                Ok((Expr::Array(exprs), Ty::List(Box::new(item_ty.unwrap_or(Ty::Unknown)), max)))
            }
            A::Object { fields, .. } => self.object(fields, out),
            A::Unary { op, value, .. } => {
                let (e, t) = self.expr(value, out)?;
                if op == "not" {
                    if !t.is_bool() {
                        let operand = print::expression(value);
                        return Err(type_error(site, format!("not needs a bool, got {} — `not` binds tighter than a comparison, so `not {operand} = x` reads as `(not {operand}) = x`", t.name()),
                            format!("write `{operand} != x`, or parenthesize: `not ({operand} = x)`")));
                    }
                    Ok((Expr::Unary { op: UnaryOp::Not, value: Box::new(e) }, Ty::Bool))
                } else {
                    if !t.is_numeric() {
                        return Err(type_error(site, format!("unary - needs a present number, got {}", t.name()), "negate an int, decimal or money value"));
                    }
                    Ok((Expr::Unary { op: UnaryOp::Neg, value: Box::new(e) }, t))
                }
            }
            A::Binary { op, left, right, .. } => self.binary(op, left, right, site, out),
            A::If { then, condition, otherwise, .. } => self.conditional(then, condition, otherwise, out),
            A::Member { base, name, .. } => {
                // Generated maintain keys are literal path-named columns. Resolve
                // the full chain before ordinary member/reference traversal.
                if let Some((root, path)) = aggregate_path(expr) {
                    let (e, t) = self.computation(root, out)?;
                    if let Ty::Row(table) = t.required()
                        && let Some(info) = self.catalog.tables.get(&table)
                        && info.maintained.is_some() && info.columns.contains_key(&path)
                    {
                        let (value, ty) = self.member(e, t, &path, site)?;
                        return Ok((value, self.field_refinement(expr).unwrap_or(ty)));
                    }
                }
                let (e, t) = self.computation(base, out)?;
                if name == "length" && matches!(t.required(), Ty::Text(_) | Ty::List(..) | Ty::Page(..) | Ty::Collection(..)) {
                    return Err(unsupported(site, ".length", format!("count({})", print::expression(base))));
                }
                // @ref LLP 3000.036#12 — a required reference's field reads its row:
                // `x.ref.col` is `t[x.ref].col`, the same authorized point read
                // (null when the row is missing or hidden), bound once.
                // A recorded attribution column spelled `ref.col` names the value
                // copied at insert; the live read would be a second meaning.
                let recorded = matches!(base.as_ref(), A::Member { name: column, .. }
                    if self.catalog.tables.values().any(|info| info.recorded.contains_key(&format!("{column}.{name}"))));
                if let Ty::Ref(table) = &t && name != "id" && !recorded
                    && self.catalog.tables.get(table).is_some_and(|info| info.maintained.is_none() && info.decl.ephemeral.is_none())
                {
                    let local = self.temp("reference");
                    let runtime = self.declare(&local, t.clone());
                    out.push(Stmt::Const { name: runtime, value: e });
                    let key = ast::KeyPart { column: None, value: A::Name { name: local, site: site.clone() }, site: site.clone() };
                    let read = ReadExpr { cursor_prefix: None, computed: Default::default(), order_keys: Vec::new(), table: table.clone(), keys: vec![key], index: None, range: None, matching: None, filter: None, seeks: Vec::new(), site: site.clone() };
                    return self.computation(&A::Member { base: Box::new(A::Read(read)), name: name.clone(), site: site.clone() }, out);
                }
                // @ref LLP 3000.036#13.7 — `x.ref.col` reads one reference. A second hop
                // (`r.planting.bed.owner`) gets the two steps that compile, by name.
                if let Ty::Ref(target) = t.required() && t.is_optional() && name != "id"
                    && let Some(rewrite) = self.second_hop_rewrite(base, &target, name) {
                    return Err(type_error(site, format!("`{}` reads two references; `x.ref.col` reads one ({} may be missing or hidden)", print::expression(expr), print::expression(base)), rewrite).guide("shapes"));
                }
                let (value, ty) = self.member(e, t, name, site)?;
                Ok((value, self.field_refinement(expr).unwrap_or(ty)))
            }
            A::Call { name, args, .. } => {
                let (value, ty) = self.call(name, args, site, out)?;
                self.record_call(expr, &ty);
                Ok((value, self.call_refinement(expr).unwrap_or(ty)))
            },
            A::Read(read) if read.table == "connected" && !self.catalog.tables.contains_key("connected") => self.connected(read, out),
            A::Read(read) => {
                let (value, ty) = self.read(read, out)?;
                Ok((value, if self.point_present(read) { ty.required() } else { ty }))
            },
            A::Merge(merge) => self.merge(merge, out),
            A::Exists { read, .. } if read.table == "connected" && !self.catalog.tables.contains_key("connected") => {
                let (count, _) = self.connected(read, out)?;
                Ok((Expr::Binary { op: BinaryOp::Gt, left: Box::new(count), right: Box::new(Expr::Literal(Value::Int(0))) }, Ty::Bool))
            }
            A::Exists { read, .. } => {
                self.exists_read(read, out)
            }
            A::Created { .. } => Err(unknown(site, "created is valid only in an insert table rule", "use exists here")),
            A::Assert { value, code, message, .. } => {
                validate_code(site, code)?;
                let (e, t) = self.expr(value, out)?;
                let tmp = self.temp("present");
                out.push(Stmt::Let { name: tmp.clone(), value: e });
                out.push(Stmt::Require { condition: Expr::Binary { op: BinaryOp::Ne, left: Box::new(ir::var(&tmp)), right: Box::new(Expr::Literal(Value::Null)) }, code: code.clone(), site: Some(site.to_string()), message: message.clone() });
                if let A::Read(read) = value.as_ref() { self.narrow_point(read); }
                Ok((ir::var(&tmp), t.required()))
            }
            A::Shape { base, fields, .. } => self.shape(base, fields, site, out),
            A::ShapeUse { base, name, .. } => {
                let Some(shape) = self.catalog.shapes.get(name).cloned() else {
                    return Err(unknown(site, format!("unknown shape {name}"), name_rewrite(name, self.catalog.shapes.keys().map(String::as_str), Some("declare `shape name = { fields }`"))));
                };
                self.shape(base, &shape.fields, site, out)
            }
            A::Walk { table, seed, column, depth, .. } => {
                let (recurse, ty) = self.walk(table, seed, column, *depth, site, out)?;
                let list = self.temp("walk");
                out.push(Stmt::Let { name: list.clone(), value: Expr::Array(Vec::new()) });
                let item = self.temp("node");
                out.push(Stmt::For { binding: item.clone(), domain: LoopDomain::Recurse(recurse), body: vec![Stmt::Push { target: list.clone(), value: ir::var(&item) }] });
                Ok((ir::var(&list), Ty::List(Box::new(ty), depth.saturating_add(1))))
            }
            A::Write { .. } => self.write(expr, out, true).map(|opt| opt.expect("a valued write")),
        }
    }

    /// `connected[p]`: how many connections the principal holds open on the
    /// server now, an int; `exists connected[p]` is the bool. Not a table:
    /// the server's registry of long polls answers it, a device answers 1
    /// and marks its read, and the server decides the write.
    fn connected(&mut self, read: &ReadExpr, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let site = &read.site;
        if read.keys.len() != 1 || read.range.is_some() || read.matching.is_some() || read.index.is_some() {
            return Err(unknown(site, "connected takes one principal: connected[p] counts its connections, exists connected[p] tests", "exists connected[m.principal]"));
        }
        let key = &read.keys[0];
        let (e, t) = self.expr_as_identity(&key.value, out, &Ty::Principal)?;
        if !matches!(t.required(), Ty::Principal | Ty::Id) {
            return Err(type_error(key.value.site(), format!("connected takes a principal, got {}", t.name()), "connected[m.principal]"));
        }
        // @ref LLP 3000.007#20.1 — retain the author's deciding read alongside the IR, never in its serialized form.
        self.presence_sources.push((e.clone(), site.clone(), print::read_expr(read)));
        self.sources.insert(format!("presence/{site}"), (site.clone(), print::read_expr(read)));
        Ok((Expr::Builtin { builtin: Builtin::Connected, args: vec![e] }, Ty::Int))
    }

    pub(super) fn name(&mut self, name: &str, site: &Site) -> Fallible<(Expr, Ty)> {
        match name {
            "viewer" | "$input:viewer" => Ok((Expr::Input(Input::Viewer), Ty::Principal)),
            "now" | "commit" => {
                if self.kind == ProgramKind::Query && name == "commit" {
                    return Err(unknown(site, "commit is the mutation commit clock; queries read now", "now"));
                }
                Ok((Expr::Input(Input::Now), Ty::Time))
            }
            "new" => {
                if self.viewer_depth.is_some() { return Err(job_reads::read_only(site)); }
                if self.kind == ProgramKind::Query {
                    return Err(unknown(site, "queries cannot mint ids", "mint ids in a mutation"));
                }
                Ok((Expr::Input(Input::NewId), Ty::Id))
            }
            "true" => Ok((Expr::Literal(Value::Bool(true)), Ty::Bool)),
            "false" => Ok((Expr::Literal(Value::Bool(false)), Ty::Bool)),
            "null" => Ok((Expr::Literal(Value::Null), Ty::Null)),
            _ => {
                if let Some(binding) = self.binding(name) {
                    if let Some(error) = &binding.error { return Err(error.clone()); }
                    return Ok((ir::var(&binding.runtime), binding.ty.clone()));
                }
                if self.catalog.tables.contains_key(name) {
                    return Err(unknown(site, format!("{name} is a table; a read needs a key or a range"), format!("{name}[key]  -- or: {name}[prefix] first 50 by index")));
                }
                let declared: Vec<&str> = self.scopes.iter().flat_map(|s| s.keys().map(String::as_str)).chain(["viewer", "now", "new"]).collect();
                Err(unknown(site, format!("unknown name {name}"), name_rewrite(name, declared, None)))
            }
        }
    }

    /// The type of `expr` without binding it into this program.
    fn speculative_type(&self, expr: &A) -> Option<Ty> {
        let mut probe = self.clone();
        probe.computation(expr, &mut setup::Body::default()).ok().map(|(_, ty)| ty)
    }

    /// A local name for the row a reference column names, unused in scope.
    fn row_local(&self, column: &str) -> String {
        let taken = |name: &str| self.scopes.iter().any(|scope| scope.contains_key(name)) || self.catalog.tables.contains_key(name);
        let mut name = column.to_owned();
        if taken(&name) { name.push_str("Row"); }
        while taken(&name) { name.push('_'); }
        name
    }

    /// `x.a.b.c` where `x.a` is a required reference: read the `a` row, then one hop.
    fn second_hop_rewrite(&self, base: &A, target: &str, field: &str) -> Option<String> {
        let A::Member { base: inner, name: hop, .. } = base else { return None };
        let Some(Ty::Ref(first)) = self.speculative_type(inner).filter(|ty| !ty.is_optional()) else { return None };
        let reference = print::expression(inner);
        let row = self.row_local(inner_name(inner).unwrap_or(&first));
        let mut second = self.row_local(hop);
        if second == row { second.push_str("Row"); }
        Some(format!("read the first row, then one hop: `{row} = {first}[{reference}] ! else NOT_FOUND`, then `{row}.{hop}.{field}` (null when the {target} row is missing or hidden); for a present value read that row too: `{second} = {target}[{row}.{hop}] ! else NOT_FOUND`, then `{second}.{field}`"))
    }

    /// `p.bed.max` compared in `op`: read the `bed` row present first, then compare its field.
    fn present_row_rewrite(&self, operand: &A, op: &str, left: &A, right: &A) -> Option<String> {
        let A::Member { base, name: field, .. } = operand else { return None };
        let Some(Ty::Ref(table)) = self.speculative_type(base).filter(|ty| !ty.is_optional()) else { return None };
        let row = self.row_local(inner_name(base).unwrap_or(&table));
        let read = print::expression(base);
        let compared = |side: &A| if std::ptr::eq(side, operand) { format!("{row}.{field}") } else { print::expression(side) };
        Some(format!("read the row present first, so a missing or hidden one refuses instead of passing: `{row} = {table}[{read}] ! else NOT_FOUND`, then compare `{} {op} {}` (`?? 0` would treat a missing row as 0)", compared(left), compared(right)))
    }

    pub(super) fn member(&mut self, base: Expr, ty: Ty, name: &str, site: &Site) -> Fallible<(Expr, Ty)> {
        let field_ty = match ty.required() {
            Ty::WriteRow(table) => {
                let info = self.table(&table, site)?;
                if super::super::columns::fields(info).any(|f|f == name) {
                    return Err(Diagnostic::new(site,"E_MAINTAINED_COLUMN_RESULT",format!("{table}.{name} is absent from a write result"),"read the row under its read rule").guide("maintains"));
                }
                return self.member(base, if ty.is_optional() { Ty::Row(table).optional() } else { Ty::Row(table) }, name, site);
            }
            Ty::Row(table) => {
                let info = self.table(&table, site)?;
                // @ref LLP 3000.007#23 — count is an alias of the certified
                // value, except when the view declares a real count column.
                if name == "count" && !info.columns.contains_key(name)
                    && info.maintained.as_ref().is_some_and(|m| m.aggregate == "count") {
                    return self.member(base, ty, "value", site);
                }
                // @ref LLP 3000.015#3 — check the receiver's static row type
                // before lowering can erase helper or returned-data position.
                if !self.returned_data || self.depth > 0 || (name != "id" && name != "pending" && !info.columns.contains_key(name)) {
                    super::super::row_views::predicate_field(info, name, site)?;
                }
                if name == "pending" && self.returned_data && info.maintained.as_ref().is_some_and(|m| m.row_key.is_some()) {
                    return Ok((Expr::Builtin { builtin: Builtin::OptionalField { field: name.into() }, args: vec![base] }, Ty::Bool.optional()));
                }
                if let Some(column) = info.decl.columns.iter().find(|column| column.name == name && column.written_by.is_some() && !column.readable_by_audience) {
                    return Ok((Expr::Builtin { builtin: Builtin::OptionalField { field: name.into() }, args: vec![base] }, Ty::from_scalar(&column.type_).optional()));
                }
                if name == "id" {
                    Ty::Ref(table.clone())
                } else {
                    match info.columns.get(name) {
                        Some(scalar) => Ty::from_scalar(scalar),
                        None => return Err(unknown(site, format!("{table} has no column {name}"), name_rewrite(name, info.columns.keys().map(String::as_str).chain(["id"]), None))),
                    }
                }
            }
            Ty::Object(fields) | Ty::RowShape(fields) | Ty::RowObject(fields) => match fields.get(name) {
                Some(field) => field.clone(),
                None => return Err(unknown(site, format!("this object has no field {name}"), name_rewrite(name, fields.keys().map(String::as_str), None))),
            },
            Ty::Ref(table) => {
                // @ref LLP 3000.007#18.5 — a reference needs an explicit row lookup or the shape's implicit row parameter.
                let reference = match &base {
                    Expr::Variable(runtime) => self.scopes.iter().rev().find_map(|scope| scope.iter().find(|(_, binding)| &binding.runtime == runtime).map(|(name, _)| name.as_str())).unwrap_or("reference"),
                    _ => "reference",
                };
                return Err(type_error(site, format!("a {table} reference has no fields"),
                    format!("{table}[{reference}] ! else NOT_FOUND — read the row, or use the shape's row parameter: {table}[{reference}] {{ {name}: .{name} }}")).guide("shapes"));
            }
            Ty::Image | Ty::Video => match name {
                "id" => Ty::Id,
                "width" | "height" | "duration" => Ty::Int.optional(),
                "bytes" => Ty::Int,
                "type" => Ty::Text(64),
                _ => return Err(unknown(site, format!("assets have no field {name}"), "id, width, height, bytes, type, duration")),
            },
            Ty::File => match name {
                "id" => Ty::Id,
                "bytes" => Ty::Int,
                "type" => Ty::Text(128),
                "name" => Ty::Text(snapback4_core::assets::MAX_NAME_BYTES as u32),
                _ => return Err(unknown(site, format!("files have no field {name}"), "id, bytes, type, name")),
            },
            // A scalar already *is* the value, so the repair is to drop the field access,
            // not to go and find a row. `int has no fields` was the most frequent compile
            // error of the 0.2.28 calibration — 20 of its 32 E_QUARRY_TYPE — and the
            // generic advice pointed away from the fix: a full group-key `maintain`
            // lookup is its count, and the author had written `.value` on it.
            // `Ty::Id` keeps the old advice: an id is exactly the case where a row read
            // is what is missing.
            other @ (Ty::Bool | Ty::Int | Ty::Time | Ty::Decimal(_) | Ty::Money(..) | Ty::Text(_) | Ty::Principal | Ty::Enum(_)) => {
                return Err(type_error(site, format!("{} has no fields", other.name()), format!("this is already a value — remove `.{name}`")));
            }
            other => return Err(type_error(site, format!("{} has no fields", other.name()), "read a row or an object before selecting a field")),
        };
        let result_ty = if ty.is_optional() { field_ty.optional() } else { field_ty };
        Ok((ir::field(base, name), result_ty))
    }

    pub(super) fn binary(&mut self, op: &str, left: &A, right: &A, site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        if op == "in" {
            let (value, ty) = self.expr(left, out)?;
            let value = self.snapshot(value, out);
            let (domain, item) = self.loop_domain(right, out)?;
            if !ty.comparable(&item) { return Err(type_error(site, format!("in compares {} with {}", ty.name(), item.name()), "use a list of values of the column's type")); }
            let found = self.temp("contains");
            let binding = self.temp("member");
            out.push(Stmt::Let { name: found.clone(), value: ir::lit(Value::Bool(false)) });
            let body = vec![Stmt::If { condition: Expr::Binary { op: BinaryOp::Eq, left: Box::new(value), right: Box::new(ir::var(&binding)) },
                then_body: vec![Stmt::Assign { name: found.clone(), value: ir::lit(Value::Bool(true)) }, Stmt::Break], else_body: Vec::new() }];
            out.push(Stmt::For { binding, domain, body });
            return Ok((ir::var(&found), Ty::Bool));
        }
        if op == "??" {
            let (l, lt) = self.expr(left, out)?;
            let tmp = self.temp("or");
            out.push(Stmt::Let { name: tmp.clone(), value: l });
            let mut fallback = setup::Body::default();
            // `conversationId ?? 'dm1'`: a text literal after an identity is
            // an id, as it is beside `=` and in a key.
            let (r, rt) = if lt.required().is_identity() { self.expr_as_identity(right, &mut fallback, &lt.required())? } else { self.expr(right, &mut fallback)? };
            fallback.push(Stmt::Assign { name: tmp.clone(), value: r });
            out.push_if(Expr::Binary { op: BinaryOp::Eq, left: Box::new(ir::var(&tmp)), right: Box::new(Expr::Literal(Value::Null)) }, fallback, setup::Body::default());
            let joined = self.join(&lt.required(), &rt, left, right)?;
            let ty = if rt.is_optional() { joined } else { joined.required() };
            return Ok((ir::var(&tmp), ty));
        }
        let (l, lt) = self.expr(left, out)?;
        if op == "and" || op == "or" {
            let result = self.temp("bool");
            out.push(Stmt::Let { name: result.clone(), value: l });
            let mut branch = setup::Body::default();
            self.push_scope();
            self.narrow(left, op == "and");
            let right = self.expr(right, &mut branch);
            self.pop_scope();
            let (r, rt) = right?;
            if !lt.is_bool() || !rt.is_bool() {
                return Err(type_error(site, format!("{op} needs bool operands; got {} and {}", lt.name(), rt.name()), "compare each side first"));
            }
            branch.push(Stmt::Assign { name: result.clone(), value: r });
            let (then_body, else_body) = if op == "and" { (branch, setup::Body::default()) } else { (setup::Body::default(), branch) };
            out.push_if(ir::var(&result), then_body, else_body);
            return Ok((ir::var(&result), Ty::Bool));
        }
        let coerce_right = lt.is_identity();
        let mut right_setup = setup::Body::default();
        let (r, rt) = if coerce_right { self.expr_as_identity(right, &mut right_setup, &lt)? } else { self.expr(right, &mut right_setup)? };
        let (l, lt) = if rt.is_identity() && !lt.is_identity() {
            match (left, &l) {
                (A::Literal { value: Literal::Str(text), .. }, _) => (Expr::Literal(Value::Id(text.clone())), Ty::Id),
                _ => (l, lt),
            }
        } else {
            (l, lt)
        };
        // Work hoisted from the right cannot run before the left value.
        let l = if right_setup.is_empty() {
            l
        } else {
            let left_value = self.temp("left");
            out.push(Stmt::Let { name: left_value.clone(), value: l });
            out.extend(right_setup);
            ir::var(&left_value)
        };
        let focal_nullable = |value: &A, ty: &Ty| self.in_predicate && ty.is_optional()
            && self.focal.as_ref().is_some_and(|(name, ty)| name == "$filter" && matches!(ty, Ty::Row(_)))
            && super::super::intent::column(value).is_some();
        let nullable_left = focal_nullable(left, &lt);
        let nullable_right = focal_nullable(right, &rt);
        let ir_op = match op {
            "/" | "%" => {
                if !matches!(lt, Ty::Int | Ty::Time) || !matches!(rt, Ty::Int | Ty::Time) {
                    return Err(type_error(site, format!("{op} takes present ints or times; got {} and {}", lt.name(), rt.name()), "narrow the operands before division"));
                }
                // @ref LLP 3000.007#5.1 — division shares divmod's Euclidean result and zero refusal.
                let divided = Expr::Builtin { builtin: Builtin::Divmod { remainder_sink: "operator".into() }, args: vec![l, r] };
                return Ok((ir::field(divided, if op == "/" { "quotient" } else { "remainder" }), Ty::Int));
            }
            "+" if matches!((&lt, &rt), (Ty::Text(_), Ty::Text(_))) => {
                let (Ty::Text(a), Ty::Text(b)) = (lt, rt) else { unreachable!() };
                // @ref LLP 3000.007#5.1 — text addition uses the shared, heap-metered concatenation builtin.
                return Ok((Expr::Builtin { builtin: Builtin::Concat, args: vec![l, r] }, Ty::Text(a.saturating_add(b))));
            }
            "+" if matches!((&lt, &rt), (Ty::List(..), Ty::List(..))) => {
                // @ref LLP 3000.019#6 — list construction is an expression, including returns and arguments.
                // @ref LLP 3000.007#5.1 — join items as in literals; Concat charges the full allocation.
                let Ty::List(item, _) = self.join(&lt, &rt, left, right)? else { unreachable!() };
                let (Ty::List(_, a), Ty::List(_, b)) = (lt, rt) else { unreachable!() };
                return Ok((Expr::Builtin { builtin: Builtin::Concat, args: vec![l, r] }, Ty::List(item, a.saturating_add(b))));
            }
            "+" if matches!(lt.required(), Ty::List(..)) || matches!(rt.required(), Ty::List(..)) => {
                return Err(type_error(site, format!("+ concatenates two lists; got {} and {}", lt.name(), rt.name()),
                    "use `xs + [x]` to append an item; make both lists present with `xs ?? []` if optional"));
            }
            "=" | "!=" => {
                if !lt.comparable(&rt) {
                    if let Some(rewrite) = self.inner_row_rewrite(left, right, &lt, &rt) {
                        return Err(type_error(site, format!("{op} compares {} with {}: inside a predicate, `.` is the predicate's own row, not the enclosing one", lt.name(), rt.name()), rewrite));
                    }
                    return Err(type_error(site, format!("{op} compares {} with {}", lt.name(), rt.name()), "compare values of one type"));
                }
                if op == "=" { BinaryOp::Eq } else { BinaryOp::Ne }
            }
            "<" | "<=" | ">" | ">=" => {
                if (lt.is_optional() && !nullable_left) || (rt.is_optional() && !nullable_right) {
                    let operand = if lt.is_optional() && !nullable_left { left } else { right };
                    // @ref LLP 3000.036#13.7 — a reference field is optional because its row may be
                    // missing or hidden; `?? 0` would admit then. Read the row present instead (lane 013).
                    if let Some(rewrite) = self.present_row_rewrite(operand, op, left, right) {
                        return Err(type_error(site, format!("{op} needs present operands; `{}` reads a row through a reference, which is null when that row is missing or hidden", print::expression(operand)), rewrite));
                    }
                    return Err(type_error(
                        site,
                        format!("{op} needs present operands; got {} and {}", lt.name(), rt.name()),
                        format!("narrow first: `if {} != null:`, or `{} ?? 0`", print::expression(operand), print::expression(operand)),
                    ));
                }
                if !lt.comparable(&rt) {
                    return Err(type_error(site, format!("{op} compares {} with {}", lt.name(), rt.name()), "compare values of one type"));
                }
                match op {
                    "<" => BinaryOp::Lt,
                    "<=" => BinaryOp::Lte,
                    ">" => BinaryOp::Gt,
                    _ => BinaryOp::Gte,
                }
            }
            "+" | "-" | "*" => {
                if !lt.is_numeric() || !rt.is_numeric() {
                    let optional = if lt.is_optional() { left } else { right };
                    let rewrite = if matches!(optional, A::Call { .. }) && (lt.is_optional() || rt.is_optional()) {
                        let (a, b) = if lt.is_optional() { ("ttl".into(), print::expression(right)) } else { (print::expression(left), "ttl".into()) };
                        format!("bind the optional call once: `ttl = {}`; use `{a} {op} {b} if ttl != null else null`", print::expression(optional))
                    } else if lt.is_optional() || rt.is_optional() {
                        format!("guard `{} != null` before the arithmetic, or choose an explicit default with `{} ?? 0`", print::expression(optional), print::expression(optional))
                    } else { "use int, decimal or money operands for arithmetic".into() };
                    return Err(type_error(site, format!("{op} needs present numbers; got {} and {}", lt.name(), rt.name()), rewrite));
                }
                let result = match (op, &lt, &rt) {
                    ("-", Ty::Time, Ty::Time) => Ty::Int,
                    ("+", Ty::Time, Ty::Int) | ("+", Ty::Int, Ty::Time) | ("-", Ty::Time, Ty::Int) => Ty::Time,
                    ("*", Ty::Time, _) | ("*", _, Ty::Time) => {
                        let left = if lt == Ty::Time { format!("({} / 1)", print::expression(left)) } else { print::expression(left) };
                        let right = if rt == Ty::Time { format!("({} / 1)", print::expression(right)) } else { print::expression(right) };
                        return Err(type_error(site, "* cannot scale a time; use an int number of milliseconds", format!("{left} * {right} — `/ 1` turns a time into int milliseconds; store the scaled count as int. For a server-arrival order keep a per-conversation counter instead: `snapback4 guide arrival`")));
                    }
                    ("+", Ty::Time, Ty::Time) => {
                        return Err(type_error(site, "+ cannot add two times; an offset is an int number of milliseconds", "change the duration parameter or column to int, then add it to the time; subtract two times to measure an elapsed duration"));
                    }
                    (_, Ty::Decimal(a), Ty::Decimal(b)) if a == b && op != "*" => Ty::Decimal(*a),
                    (_, Ty::Money(c, a), Ty::Money(d, b)) if a == b && c == d && op != "*" => Ty::Money(c.clone(), *a),
                    ("*", Ty::Decimal(a), Ty::Int) | ("*", Ty::Int, Ty::Decimal(a)) => Ty::Decimal(*a),
                    ("*", Ty::Money(c, a), Ty::Int) | ("*", Ty::Int, Ty::Money(c, a)) => Ty::Money(c.clone(), *a),
                    (_, Ty::Int, Ty::Int) => Ty::Int,
                    _ => return Err(type_error(site, format!("{op} needs matching numeric types; got {} and {}", lt.name(), rt.name()), "convert one operand")),
                };
                let ir_op = match op {
                    "+" => BinaryOp::Add,
                    "-" => BinaryOp::Sub,
                    _ => BinaryOp::Mul,
                };
                return Ok((Expr::Binary { op: ir_op, left: Box::new(l), right: Box::new(r) }, result));
            }
            other => return Err(unknown(site, format!("unknown operator {other}"), "use =, !=, <, <=, >, >=, +, -, *, and, or, ??")),
        };
        let mut present = Vec::new();
        if matches!(ir_op, BinaryOp::Lt | BinaryOp::Lte | BinaryOp::Gt | BinaryOp::Gte) {
            if nullable_left { present.push(l.clone()); }
            if nullable_right { present.push(r.clone()); }
        }
        let mut comparison = Expr::Binary { op: ir_op, left: Box::new(l), right: Box::new(r) };
        // @ref LLP 3000.013#2.1 — predicate nulls do not enter ordering;
        // the ordinary interpreter's total value ordering remains unchanged.
        for value in present.into_iter().rev() {
            comparison = Expr::Binary { op: BinaryOp::And,
                left: Box::new(Expr::Binary { op: BinaryOp::Ne, left: Box::new(value), right: Box::new(ir::lit(Value::Null)) }),
                right: Box::new(comparison) };
        }
        Ok((comparison, Ty::Bool))
    }

    /// An expression in an identity position: a text literal becomes an id.
    pub(super) fn expr_as_identity(&mut self, expr: &A, out: &mut setup::Body, expected: &Ty) -> Fallible<(Expr, Ty)> {
        if let A::Literal { value: Literal::Str(text), .. } = expr {
            if text.is_empty() {
                return Err(type_error(expr.site(), "an empty text literal cannot be an id", "use a non-empty id literal, or null"));
            }
            return Ok((Expr::Literal(Value::Id(text.clone())), expected.required()));
        }
        self.expr(expr, out)
    }

    pub(super) fn call(&mut self, name: &str, args: &[A], site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        if let Some(result) = self.job_query_call(name, args, site, out) { return result; }
        // Compiler-only references bypass the function catalog entirely.
        let primitive = name.strip_prefix("$builtin:");
        if primitive.is_none() && let Some(function) = self.catalog.functions.get(name).cloned() {
            return self.fn_call(&function, args, site, out);
        }
        let name = primitive.unwrap_or(name);
        let arity = |n: usize, rewrite: &str| -> Fallible<()> {
            if args.len() != n {
                return Err(type_error(site, format!("{name} takes {n} argument{}; received {}", if n == 1 { "" } else { "s" }, args.len()), rewrite));
            }
            Ok(())
        };
        match name {
            "receiptSettled" if primitive.is_some() => {
                arity(1, "receipt settlement needs a row")?;
                let (value, ty) = self.expr(&args[0], out)?;
                let Ty::Row(table) = ty else { return Err(type_error(site, "receipt settlement needs a row", "use a receipt row")); };
                Ok((Expr::Builtin { builtin: Builtin::ReceiptSettled { table }, args: vec![value] }, Ty::Bool))
            }
            super::super::intent_variants::PRESENT => {
                let (value, _) = self.expr(&args[0], out)?;
                Ok((Expr::Binary { op: BinaryOp::Ne, left: Box::new(value), right: Box::new(Expr::Literal(Value::Null)) }, Ty::Bool))
            }
            super::super::intent_variants::SEARCH => {
                let (value, ty) = self.expr(&args[0], out)?;
                if !matches!(ty, Ty::Text(_)) { return Err(type_error(site, "matching needs present text", "matching (q ?? '')")); }
                let A::Name { name, .. } = &args[1] else { unreachable!("planned needle binding") };
                let runtime = self.temp("intentNeedle");
                self.declare(name, ty);
                self.scopes.last_mut().unwrap().get_mut(name).unwrap().runtime = runtime.clone();
                out.push(Stmt::Let { name: runtime.clone(), value });
                Ok((Expr::Builtin { builtin: Builtin::SearchPresent, args: vec![ir::var(&runtime)] }, Ty::Bool))
            }
            "day" | "hour" | "bucket" => {
                let (millis, offset) = super::super::maintains::calendar(name, args, site)?;
                let (value, ty) = self.expr(&args[0], out)?;
                if ty != Ty::Time { return Err(type_error(args[0].site(), format!("{name} needs a required time, got {}", ty.name()), "pass a required time column or now")); }
                let mut args = vec![value];
                if offset != 0 { args.push(Expr::Literal(Value::Int(offset))); }
                Ok((Expr::Builtin { builtin: Builtin::Calendar { millis }, args }, Ty::Int))
            }
            // @ref LLP 3000.040#22-builtins — months since 1970-01 and calendar years, UTC, and back to a time.
            "month" | "year" => {
                arity(1, &format!("{name}(time); civil periods are UTC and take no offset"))?;
                let (value, ty) = self.expr(&args[0], out)?;
                if ty != Ty::Time { return Err(type_error(args[0].site(), format!("{name} needs a required time, got {}", ty.name()), format!("{name}(.at), {name}(now), or {name}(t ?? now)")).guide("time")); }
                let function = if name == "month" { Civil::Month } else { Civil::Year };
                Ok((Expr::Builtin { builtin: Builtin::Civil(function), args: vec![value] }, Ty::Int))
            }
            "monthStart" | "yearStart" => {
                let unit = if name == "monthStart" { "month" } else { "year" };
                arity(1, &format!("{name}({unit}); {unit}(t) gives one"))?;
                let (value, ty) = self.expr(&args[0], out)?;
                if ty != Ty::Int { return Err(type_error(args[0].site(), format!("{name} takes a {unit} number (an int), got {}", ty.name()), format!("{name}({unit}(t)), or {name}({unit}(now) + 1) for the next")).guide("time")); }
                let function = if name == "monthStart" { Civil::MonthStart } else { Civil::YearStart };
                Ok((Expr::Builtin { builtin: Builtin::Civil(function), args: vec![value] }, Ty::Time))
            }
            "count" => {
                arity(1, "count(list)")?;
                if let Some(read) = self.aggregate_domain(&args[0]) && self.is_page(&read, ReadMode::FilteredPoint)? {
                    let saved = self.total.replace(("count", None));
                    let scanned = self.scan_at(&read, out, prefix::Position::Aggregate);
                    self.total = saved;
                    let (scan, _) = scanned?;
                    self.shape_meter_note(&scan, &read);
                    return Ok((Expr::Builtin { builtin: Builtin::Count, args: vec![Expr::Scan(scan)] }, Ty::Int));
                }
                let (e, t) = self.expr(&args[0], out)?;
                if matches!(t, Ty::Text(_)) {
                    return Ok((Expr::Builtin { builtin: Builtin::Len, args: vec![e] }, Ty::Int));
                }
                if t.loop_max().is_none() {
                    return Err(type_error(
                        args[0].site(),
                        format!("count takes present text, a list or a page, got {}", t.name()),
                        "count(text), count(list), or count(page); narrow optional values first",
                    ));
                }
                Ok((Expr::Builtin { builtin: Builtin::Count, args: vec![e] }, Ty::Int))
            }
            "lower" | "trim" => {
                arity(1, &format!("{name}(text)"))?;
                let (value, ty) = self.expr(&args[0], out)?;
                let Ty::Text(max) = ty else {
                    return Err(type_error(site, format!("{name} takes present text, got {}", ty.name()), &format!("{name}(text ?? '')")));
                };
                let (builtin, max) = if name == "lower" { (Builtin::Lower, max.saturating_mul(3)) } else { (Builtin::Trim, max) };
                Ok((Expr::Builtin { builtin, args: vec![value] }, Ty::Text(max)))
            }
            "sha256" => {
                arity(1, "sha256(text)")?;
                let (value, ty) = self.expr(&args[0], out)?;
                if !matches!(ty, Ty::Text(_)) {
                    return Err(type_error(site, format!("sha256 takes present text, got {}", ty.name()), "sha256(text ?? '')"));
                }
                Ok((Expr::Builtin { builtin: Builtin::Sha256, args: vec![value] }, Ty::Text(64)))
            }
            "group" => {
                arity(2, "group(list, 'column')")?;
                let (value, ty) = self.expr(&args[0], out)?;
                let Some((item, max)) = ty.sequence() else { return Err(type_error(site, "group takes a list or page", "group(rows, 'column')")); };
                let A::Literal { value: Literal::Str(field), .. } = &args[1] else { return Err(type_error(args[1].site(), "group names one field with a text literal", "group(rows, 'column')")); };
                let (selection, key) = self.member(Expr::Literal(Value::Null), item.clone(), field, args[1].site())?;
                let optional = matches!(selection, Expr::Builtin { builtin: Builtin::OptionalField { .. }, .. });
                let group = Ty::Object(BTreeMap::from([("key".into(), key), ("items".into(), Ty::List(Box::new(item), max))]));
                Ok((Expr::Builtin { builtin: Builtin::Group { field: field.clone(), optional }, args: vec![value] }, Ty::List(Box::new(group), max)))
            }
            "first" | "last" | "at" => {
                arity(if name == "at" { 2 } else { 1 }, &format!("{name}(list{})", if name == "at" { ", index" } else { "" }))?;
                let values = self.strict_args(args, out)?;
                let Some((item, _)) = values[0].1.sequence() else { return Err(type_error(args[0].site(), format!("{name} takes a list or page"), &format!("{name}(rows)"))); };
                if name == "at" && values[1].1 != Ty::Int { return Err(type_error(args[1].site(), "at's index is an int", "at(list, 0)")); }
                Ok((Expr::Builtin { builtin: match name { "first" => Builtin::First, "last" => Builtin::Last, _ => Builtin::At }, args: values.into_iter().map(|(value, _)| value).collect() }, item.optional()))
            }
            "join" => {
                arity(2, "join(list, separator)")?;
                let [(list, lt), (sep, st)]: [(Expr, Ty); 2] = self.strict_args(args, out)?.try_into().expect("checked arity");
                let max = match (lt.sequence(), &st) {
                    (Some((item, count)), Ty::Text(sep)) => match item {
                        Ty::Text(max) => max.saturating_mul(count).saturating_add(sep.saturating_mul(count.saturating_sub(1))),
                        Ty::Unknown if count == 0 => 0,
                        _ => return Err(type_error(site, "join takes a list of present text values", "join(['a', 'b'], ', ')")),
                    },
                    _ => return Err(type_error(site, "join takes a list of present text values and a text separator", "join(['a', 'b'], ', ')")),
                };
                Ok((Expr::Builtin { builtin: Builtin::Join, args: vec![list, sep] }, Ty::Text(max)))
            }
            "sum" if args.len() == 2 => {
                let source = if let Some(read) = self.aggregate_domain(&args[0]) {
                    let saved = self.total.replace(("sum", Some(print::expression(&args[1]))));
                    let scanned = self.scan_at(&read, out, prefix::Position::Aggregate);
                    self.total = saved;
                    let (scan, _) = scanned?;
                    self.shape_meter_note(&scan, &read);
                    if scan.take == Bound::Meter {
                        let saved = self.focal.replace(("$filter".into(), Ty::Row(read.table.clone())));
                        let mut setup = setup::Body::default();
                        let predicate_context = std::mem::replace(&mut self.in_predicate, false);
                        let projected = self.expr(&args[1], &mut setup);
                        self.in_predicate = predicate_context;
                        self.focal = saved;
                        let (projection, ty) = projected?;
                        if !ty.is_numeric() || !setup.is_empty() {
                            return Err(type_error(args[1].site(), "a streaming sum needs a required numeric column", "sum(messages[prefix] by index, .amount)"));
                        }
                        return Ok((Expr::Builtin { builtin: Builtin::Sum, args: vec![Expr::Scan(scan), projection] }, ty));
                    }
                    let ty = Ty::Page(read.table, scan.take.maximum() as u32);
                    (Expr::Scan(scan), ty)
                } else { self.expr(&args[0], out)? };
                // `sum(page, .x)`: the rows' field, summed — a loop that
                // pushes each projection, then the sum of the list.
                let (source, source_ty) = source;
                let (domain, item_ty) = match (&source, &source_ty) {
                    (Expr::Scan(scan), Ty::Page(table, _)) => (LoopDomain::Page(scan.clone()), Ty::Row(table.clone())),
                    (_, Ty::Page(table, max)) => (LoopDomain::DerivedArray { value: source.clone(), max: *max, bound_source: "sum".into() }, Ty::Row(table.clone())),
                    (_, Ty::Collection(item, max)) | (_, Ty::List(item, max)) => (LoopDomain::DerivedArray { value: source.clone(), max: *max, bound_source: "sum".into() }, item.as_ref().clone()),
                    (_, other) => return Err(type_error(args[0].site(), format!("sum takes a page or a bounded list, got {}", other.name()), "sum(t[prefix] first 50 by index, .amount)")),
                };
                let list = self.temp("sum");
                let item = self.temp("row");
                out.push(Stmt::Let { name: list.clone(), value: Expr::Array(Vec::new()) });
                let mut body = setup::Body::default();
                self.push_scope();
                self.declare(&item, item_ty.clone());
                let saved = self.focal.replace((item.clone(), item_ty));
                let projected = self.expr(&args[1], &mut body);
                self.focal = saved;
                self.pop_scope();
                let (projection, projection_ty) = projected?;
                if !projection_ty.is_numeric() {
                    return Err(type_error(
                        args[1].site(),
                        format!("sum adds numbers; .{} is {}", print::expression(&args[1]).trim_start_matches('.'), projection_ty.name()),
                        if projection_ty.required().is_numeric() { format!("{} ?? 0", print::expression(&args[1])) } else { "name a numeric field: sum(page, .amount)".into() },
                    ));
                }
                body.push(Stmt::Push { target: list.clone(), value: projection });
                out.push_for(item, domain, body);
                Ok((Expr::Builtin { builtin: Builtin::Sum, args: vec![ir::var(&list)] }, projection_ty))
            }
            "sum" => {
                arity(1, "sum(list)")?;
                let (e, t) = self.expr(&args[0], out)?;
                let Some((item, _)) = t.sequence() else { return Err(type_error(args[0].site(), format!("sum takes a list of numbers, got {}", t.name()), "sum(list), or sum(page, .amount)")); };
                if !item.is_numeric() {
                    return Err(type_error(args[0].site(), format!("sum takes numbers, got a list of {}", item.name()), "map the rows to their numeric field first"));
                }
                Ok((Expr::Builtin { builtin: Builtin::Sum, args: vec![e] }, item))
            }
            "slice" => {
                arity(3, "slice(value, start, end)")?;
                let [(e, t), (s, st), (n, nt)]: [(Expr, Ty); 3] = self.strict_args(args, out)?.try_into().expect("checked arity");
                if !matches!(st, Ty::Int) || !matches!(nt, Ty::Int) {
                    return Err(type_error(site, "slice positions are ints", "slice(text, 0, 80)"));
                }
                let ty = match t.required() {
                    Ty::Text(max) => match (literal_int(&args[1]), literal_int(&args[2])) {
                        (Some(a), Some(b)) if b >= a => Ty::Text(((b - a) as u32).min(max)),
                        _ => Ty::Text(max),
                    },
                    Ty::List(item, max) => Ty::List(item, max),
                    Ty::Page(table, max) => Ty::List(Box::new(Ty::Row(table)), max),
                    Ty::Collection(item, max) => Ty::Collection(item, max),
                    other => return Err(type_error(args[0].site(), format!("slice takes text or a bounded list, got {}", other.name()), "slice(text, start, end)")),
                };
                if t.is_optional() {
                    return Err(type_error(args[0].site(), "slice needs a present value", format!("slice({} ?? '', start, end)", print::expression(&args[0]))));
                }
                Ok((Expr::Builtin { builtin: Builtin::Slice, args: vec![e, s, n] }, ty))
            }
            "min" | "max" => {
                if args.len() == 1 && matches!(&args[0], A::Read(_)) {
                    let source = self.catalog.read_origins.get(&args[0].site().to_string()).cloned().unwrap_or_else(|| self.catalog.source.expression(&args[0]));
                    if let Some((read, field)) = source.rsplit_once(", .") {
                        return Err(ambiguous(site, format!("{name}: the comma after by continues the read's order, leaving only one argument"),
                            format!("{name}(({read}), .{field})")).guide("reads"));
                    }
                }
                arity(2, &format!("{name}(a, b), or {name}(rows, .column)"))?;
                if let Some(result) = self.extremum(name, args, out)? { return Ok(result); }
                let [(a, at), (b, bt)]: [(Expr, Ty); 2] = self.strict_args(args, out)?.try_into().expect("checked arity");
                let joined = self.join(&at, &bt, &args[0], &args[1])?;
                if at.is_optional() || bt.is_optional() || !at.comparable(&bt) {
                    return Err(type_error(site, format!("{name} takes two present values of one type; got {} and {}", at.name(), bt.name()), "narrow the operands first"));
                }
                Ok((Expr::Builtin { builtin: if name == "min" { Builtin::Min } else { Builtin::Max }, args: vec![a, b] }, joined))
            }
            "tokens" => {
                arity(1, "tokens(text)")?;
                let (e, t) = self.expr(&args[0], out)?;
                if !matches!(t, Ty::Text(_)) {
                    return Err(type_error(args[0].site(), format!("tokens takes present text, got {}", t.name()), "tokens(body ?? '')"));
                }
                Ok((Expr::Builtin { builtin: Builtin::MentionTokens, args: vec![e] }, Ty::List(Box::new(Ty::Text(64)), MENTION_MAX)))
            }
            "share" => {
                arity(3, "share(amount, recipients, recipient)")?;
                let [(a, at), (list, lt), (r, _)]: [(Expr, Ty); 3] = self.strict_args(args, out)?.try_into().expect("checked arity");
                if !at.is_numeric() {
                    return Err(type_error(args[0].site(), format!("share's amount must be a present number, got {}", at.name()), "share(amount, recipients, recipient)"));
                }
                if lt.loop_max().is_none() {
                    return Err(type_error(args[1].site(), format!("share recipients must be a bounded list, got {}", lt.name()), "share(amount, recipients, recipient)"));
                }
                Ok((Expr::Builtin { builtin: Builtin::DeterministicShare, args: vec![a, list, r] }, at))
            }
            "sorted" | "divmod" => Err(unknown(site, format!("{name} binds a pair"), format!("(a, b) = {name}({})", args.iter().map(print::expression).collect::<Vec<_>>().join(", ")))),
            "range" => Err(unknown(site, "range is a for domain", "for i in range(0, 10):")),
            "sort" => {
                if args.len() < 2 {
                    return Err(type_error(site, "sort takes a list and one or more field names", "sort(rows, 'at')"));
                }
                let (e, t) = self.expr(&args[0], out)?;
                let mut keys = Vec::new();
                for key in &args[1..] {
                    let A::Literal { value: Literal::Str(field), .. } = key else {
                        return Err(type_error(key.site(), "sort keys are field name literals", "sort(rows, 'at')"));
                    };
                    let (field, order) = match field.strip_prefix('-') {
                        Some(rest) => (rest.to_owned(), Order::Desc),
                        None => (field.clone(), Order::Asc),
                    };
                    let optional = if let Some((item, _)) = t.sequence() {
                        self.member(Expr::Literal(Value::Null), item, &field, key.site())
                            .is_ok_and(|(selection, _)| matches!(selection, Expr::Builtin { builtin: Builtin::OptionalField { .. }, .. }))
                    } else { false };
                    keys.push(SortKey { field, order, optional });
                }
                if t.loop_max().is_none() {
                    return Err(type_error(args[0].site(), format!("sort takes a bounded list, got {}", t.name()), "sort(rows, 'at')"));
                }
                Ok((Expr::Builtin { builtin: Builtin::Sort { keys }, args: vec![e] }, t))
            }
            other => Err(unknown(
                site,
                format!("unknown function {other}"),
                name_rewrite(other, self.catalog.functions.keys().map(String::as_str).chain(["count", "sum", "slice", "min", "max", "tokens", "share", "sort", "divmod", "sorted", "lower", "trim", "sha256", "join", "group", "first", "last", "at", "day", "hour", "bucket", "month", "year", "monthStart", "yearStart"]), None),
            )),
        }
    }
}

fn lexical_value(expr: &Expr) -> bool {
    match expr {
        Expr::Variable(_) => true,
        Expr::Field { base, .. } => lexical_value(base),
        _ => false,
    }
}

pub(super) fn allocates(expr: &Expr) -> bool {
    match expr {
        Expr::Input(Input::NewId) => true,
        Expr::Array(values) | Expr::Builtin { args: values, .. } => values.iter().any(allocates),
        Expr::Object(fields) => fields.values().any(allocates),
        Expr::Binary { left, right, .. } => allocates(left) || allocates(right),
        Expr::Unary { value, .. } | Expr::Field { base: value, .. } => allocates(value),
        _ => false,
    }
}

/// Only a named row or focal row can head a literal aggregate column chain.
fn aggregate_path(expr: &A) -> Option<(&A, String)> {
    let mut root = expr;
    let mut fields = Vec::new();
    while let A::Member { base, name, .. } = root { fields.push(name.as_str()); root = base; }
    if fields.len() < 2 || !matches!(root, A::Focal { .. } | A::Name { .. }) { return None; }
    fields.reverse();
    Some((root, fields.join(".")))
}

impl Binder<'_> {
    /// `entries where .contest = .id` inside a contests shape: both dots are
    /// the inner row. Name the column on the inner table and bind the outer
    /// value through a named key, which reads the enclosing row.
    // @ref LLP 3000.036#11 — lexical scope of `.` in nested projections (app-farm pattern 44).
    fn inner_row_rewrite(&self, left: &A, right: &A, lt: &Ty, rt: &Ty) -> Option<String> {
        self.focal.as_ref()?;
        let (Ty::Ref(a), Ty::Ref(b)) = (lt.required(), rt.required()) else { return None };
        let dotted = |expr: &A| match expr { A::Member { base, name, .. } if matches!(base.as_ref(), A::Focal { .. }) => Some(name.clone()), _ => None };
        let (column, other_field, inner) = match (dotted(left), dotted(right)) {
            (Some(l), Some(r)) if r == "id" => (l, r, b.clone()),
            (Some(l), Some(r)) if l == "id" => (r, l, a.clone()),
            _ => return None,
        };
        let outer = if inner == a { b } else { a };
        Some(format!("`.{other_field}` here is the {inner} row's own id; to match the enclosing {outer} row, use a named key, which reads the enclosing row: `{inner}[{column} = .{other_field}]` (keep the same order and page after it, e.g. `{inner}[{column} = .{other_field}] first 20 by .id`), or bind the outer value to a local before the nested read"))
    }
}

/// The last name of `x.a`: `a`.
fn inner_name(expr: &A) -> Option<&str> {
    match expr { A::Member { name, .. } => Some(name.as_str()), A::Name { name, .. } => Some(name.as_str()), _ => None }
}
