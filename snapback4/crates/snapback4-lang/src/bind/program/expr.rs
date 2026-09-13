//! Expression lowering with branch-owned setup statements.

use super::*;

impl Binder<'_> {
    // ----- expressions -----

    /// An expression whose value is used (bound, returned, or a final
    /// write): writes yield their row.
    pub(super) fn value_of(&mut self, value: &A, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        if let A::Write { .. } = value {
            return self.write(value, out, true).map(|opt| opt.expect("a valued write"));
        }
        self.expr(value, out)
    }

    /// Strict compound children run in source order, before setup emitted by
    /// a later child. Lexical values and their fields cannot change here;
    /// leaving those fields in their object also preserves pending provenance.
    pub(super) fn snapshot(&mut self, value: Expr, out: &mut Vec<Stmt>) -> Expr {
        if matches!(value, Expr::Literal(_) | Expr::Input(Input::Viewer | Input::Now)) || lexical_value(&value) {
            return value;
        }
        let name = self.temp("value");
        out.push(Stmt::Let { name: name.clone(), value });
        ir::var(&name)
    }

    pub(super) fn sequence_setup<'e>(&mut self, prior: impl Iterator<Item = &'e mut Expr>, setup: Vec<Stmt>, out: &mut Vec<Stmt>) {
        if !setup.is_empty() {
            for value in prior {
                *value = self.snapshot(std::mem::replace(value, Expr::Literal(Value::Null)), out);
            }
            out.extend(setup);
        }
    }

    fn strict_args(&mut self, args: &[A], out: &mut Vec<Stmt>) -> Fallible<Vec<(Expr, Ty)>> {
        let mut values = Vec::<(Expr, Ty)>::new();
        for arg in args {
            let mut setup = Vec::new();
            let value = self.expr(arg, &mut setup)?;
            self.sequence_setup(values.iter_mut().map(|(e, _)| e), setup, out);
            values.push(value);
        }
        Ok(values)
    }

    pub fn expr(&mut self, expr: &A, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        let site = expr.site();
        match expr {
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
                for (e, t) in self.strict_args(items, out)? {
                    item_ty = Some(match item_ty {
                        Some(j) => j.join(&t),
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
                        return Err(type_error(site, format!("not needs a bool, got {}", t.name()), "compare the value first"));
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
            A::If { then, condition, otherwise, .. } => {
                let (cond, cond_ty) = self.expr(condition, out)?;
                if !cond_ty.is_bool() {
                    return Err(type_error(condition.site(), format!("a conditional value needs a bool condition, got {}", cond_ty.name()), "compare the value: `x if ttl != null else y`"));
                }
                // Each arm binds under its narrowing and runs only when taken.
                let temp = self.temp("if");
                let mut then_out = Vec::new();
                self.push_scope();
                self.narrow(condition, true);
                let then_bound = self.expr(then, &mut then_out);
                self.pop_scope();
                let (then_expr, then_ty) = then_bound?;
                let mut else_out = Vec::new();
                self.push_scope();
                self.narrow(condition, false);
                let else_bound = self.expr(otherwise, &mut else_out);
                self.pop_scope();
                let (else_expr, else_ty) = else_bound?;
                then_out.push(Stmt::Assign { name: temp.clone(), value: then_expr });
                else_out.push(Stmt::Assign { name: temp.clone(), value: else_expr });
                out.push(Stmt::Let { name: temp.clone(), value: Expr::Literal(Value::Null) });
                out.push(Stmt::If { condition: cond, then_body: then_out, else_body: else_out });
                let ty = if then_ty == Ty::Null {
                    else_ty.optional()
                } else if else_ty == Ty::Null {
                    then_ty.optional()
                } else {
                    then_ty.join(&else_ty)
                };
                Ok((ir::var(&temp), ty))
            }
            A::Member { base, name, .. } => {
                let (e, t) = self.expr(base, out)?;
                self.member(e, t, name, site)
            }
            A::Call { name, args, .. } => self.call(name, args, site, out),
            A::Read(read) => self.read(read, out),
            A::Merge(merge) => self.merge(merge, out),
            A::Exists { read, .. } => {
                let (point, _) = self.point(read, ReadMode::Exists, out)?;
                Ok((Expr::Exists(point), Ty::Bool))
            }
            A::Created { .. } => Err(unknown(site, "created is valid only in an insert table rule", "use exists here")),
            A::Assert { value, code, .. } => {
                validate_code(site, code)?;
                let (e, t) = self.expr(value, out)?;
                let tmp = self.temp("present");
                out.push(Stmt::Let { name: tmp.clone(), value: e });
                out.push(Stmt::Require { condition: Expr::Binary { op: BinaryOp::Ne, left: Box::new(ir::var(&tmp)), right: Box::new(Expr::Literal(Value::Null)) }, code: code.clone(), site: Some(site.to_string()) });
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

    pub(super) fn name(&mut self, name: &str, site: &Site) -> Fallible<(Expr, Ty)> {
        match name {
            "viewer" => Ok((Expr::Input(Input::Viewer), Ty::Principal)),
            "now" | "commit" => {
                if self.kind == ProgramKind::Query && name == "commit" {
                    return Err(unknown(site, "commit is the mutation commit clock; queries read now", "now"));
                }
                Ok((Expr::Input(Input::Now), Ty::Time))
            }
            "new" => {
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

    pub(super) fn member(&mut self, base: Expr, ty: Ty, name: &str, site: &Site) -> Fallible<(Expr, Ty)> {
        let field_ty = match ty.required() {
            Ty::Row(table) => {
                let info = self.table(&table, site)?;
                if name == "id" {
                    Ty::Ref(table.clone())
                } else {
                    match info.columns.get(name) {
                        Some(scalar) => Ty::from_scalar(scalar),
                        None => return Err(unknown(site, format!("{table} has no column {name}"), name_rewrite(name, info.columns.keys().map(String::as_str).chain(["id"]), None))),
                    }
                }
            }
            Ty::Object(fields) => match fields.get(name) {
                Some(field) => field.clone(),
                None => return Err(unknown(site, format!("this object has no field {name}"), name_rewrite(name, fields.keys().map(String::as_str), None))),
            },
            Ty::Image | Ty::Video => match name {
                "id" => Ty::Id,
                "width" | "height" | "duration" => Ty::Int.optional(),
                "bytes" => Ty::Int,
                "type" => Ty::Text(64),
                _ => return Err(unknown(site, format!("assets have no field {name}"), "id, width, height, bytes, type, duration")),
            },
            other => return Err(type_error(site, format!("{} has no fields", other.name()), "read a row or an object before selecting a field")),
        };
        let result_ty = if ty.is_optional() { field_ty.optional() } else { field_ty };
        Ok((ir::field(base, name), result_ty))
    }

    pub(super) fn object(&mut self, fields: &[ObjectField], out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        let mut exprs = Vec::<(String, Expr)>::new();
        let mut types = BTreeMap::new();
        for field in fields {
            let mut setup = Vec::new();
            let (e, t) = match &field.value {
                Some(value) => self.expr(value, &mut setup)?,
                None => self.name(&field.name, &field.site)?,
            };
            self.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
            // Object IR stores fields by name. Minted ids still follow source
            // field order when no child needs a statement-producing expansion.
            let e = if allocates(&e) { self.snapshot(e, out) } else { e };
            if types.contains_key(&field.name) {
                return Err(unknown(&field.site, format!("duplicate field {}", field.name), "keep one"));
            }
            exprs.push((field.name.clone(), e));
            types.insert(field.name.clone(), t);
        }
        Ok((Expr::Object(exprs.into_iter().collect()), Ty::Object(types)))
    }

    pub(super) fn binary(&mut self, op: &str, left: &A, right: &A, site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        if op == "??" {
            let (l, lt) = self.expr(left, out)?;
            let tmp = self.temp("or");
            out.push(Stmt::Let { name: tmp.clone(), value: l });
            let mut fallback = Vec::new();
            // `conversationId ?? 'dm1'`: a text literal after an identity is
            // an id, as it is beside `=` and in a key.
            let (r, rt) = if lt.required().is_identity() { self.expr_as_identity(right, &mut fallback, &lt.required())? } else { self.expr(right, &mut fallback)? };
            fallback.push(Stmt::Assign { name: tmp.clone(), value: r });
            out.push(Stmt::If { condition: Expr::Binary { op: BinaryOp::Eq, left: Box::new(ir::var(&tmp)), right: Box::new(Expr::Literal(Value::Null)) }, then_body: fallback, else_body: Vec::new() });
            let ty = if rt.is_optional() { lt.required().join(&rt) } else { lt.required().join(&rt).required() };
            return Ok((ir::var(&tmp), ty));
        }
        if op == "/" || op == "%" {
            return Err(unknown(site, "division binds a quotient and a remainder at once", format!("(quotient, remainder) = divmod({}, {})", print::expression(left), print::expression(right))));
        }
        let (l, lt) = self.expr(left, out)?;
        if op == "and" || op == "or" {
            let result = self.temp("bool");
            out.push(Stmt::Let { name: result.clone(), value: l });
            let mut branch = Vec::new();
            self.push_scope();
            self.narrow(left, op == "and");
            let right = self.expr(right, &mut branch);
            self.pop_scope();
            let (r, rt) = right?;
            if !lt.is_bool() || !rt.is_bool() {
                return Err(type_error(site, format!("{op} needs bool operands; got {} and {}", lt.name(), rt.name()), "compare each side first"));
            }
            branch.push(Stmt::Assign { name: result.clone(), value: r });
            let (then_body, else_body) = if op == "and" { (branch, Vec::new()) } else { (Vec::new(), branch) };
            out.push(Stmt::If { condition: ir::var(&result), then_body, else_body });
            return Ok((ir::var(&result), Ty::Bool));
        }
        let coerce_right = lt.is_identity();
        let mut right_setup = Vec::new();
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
        let ir_op = match op {
            "=" | "!=" => {
                if !lt.comparable(&rt) {
                    return Err(type_error(site, format!("{op} compares {} with {}", lt.name(), rt.name()), "compare values of one type"));
                }
                if op == "=" { BinaryOp::Eq } else { BinaryOp::Ne }
            }
            "<" | "<=" | ">" | ">=" => {
                if lt.is_optional() || rt.is_optional() {
                    return Err(type_error(
                        site,
                        format!("{op} needs present operands; got {} and {}", lt.name(), rt.name()),
                        format!("narrow first: `if {} != null:`, or `{} ?? 0`", print::expression(if lt.is_optional() { left } else { right }), print::expression(if lt.is_optional() { left } else { right })),
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
                    return Err(type_error(site, format!("{op} needs present numbers; got {} and {}", lt.name(), rt.name()), "narrow optional operands with `?? 0`"));
                }
                let result = match (op, &lt, &rt) {
                    ("-", Ty::Time, Ty::Time) => Ty::Int,
                    ("+", Ty::Time, Ty::Int) | ("+", Ty::Int, Ty::Time) | ("-", Ty::Time, Ty::Int) => Ty::Time,
                    ("+", Ty::Time, Ty::Time) | ("*", Ty::Time, _) | ("*", _, Ty::Time) => {
                        return Err(type_error(site, "time values add or subtract an int offset; time + time and time * n have no meaning", "subtract two times for an int difference in milliseconds"));
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
        Ok((Expr::Binary { op: ir_op, left: Box::new(l), right: Box::new(r) }, Ty::Bool))
    }

    /// An expression in an identity position: a text literal becomes an id.
    pub(super) fn expr_as_identity(&mut self, expr: &A, out: &mut Vec<Stmt>, expected: &Ty) -> Fallible<(Expr, Ty)> {
        if let A::Literal { value: Literal::Str(text), .. } = expr {
            if text.is_empty() {
                return Err(type_error(expr.site(), "an empty text literal cannot be an id", "use a non-empty id literal, or null"));
            }
            return Ok((Expr::Literal(Value::Id(text.clone())), expected.required()));
        }
        self.expr(expr, out)
    }

    pub(super) fn call(&mut self, name: &str, args: &[A], site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        if let Some(function) = self.catalog.functions.get(name).cloned() {
            return self.fn_call(&function, args, site, out);
        }
        if self.catalog.procs.contains_key(name) {
            return Err(unknown(site, format!("{name} is a proc; call it as a statement"), format!("{name}({})", args.iter().map(print::expression).collect::<Vec<_>>().join(", "))));
        }
        let arity = |n: usize, rewrite: &str| -> Fallible<()> {
            if args.len() != n {
                return Err(type_error(site, format!("{name} takes {n} argument{}; received {}", if n == 1 { "" } else { "s" }, args.len()), rewrite));
            }
            Ok(())
        };
        match name {
            "count" => {
                arity(1, "count(list)")?;
                let (e, t) = self.expr(&args[0], out)?;
                if t.loop_max().is_none() {
                    return Err(type_error(
                        args[0].site(),
                        format!("count takes a bounded list or page, got {}", t.name()),
                        if matches!(t.required(), Ty::Text(_)) { "for a text length use slice, or store the length" } else { "count a page or a bounded list" },
                    ));
                }
                Ok((Expr::Builtin { builtin: Builtin::Count, args: vec![e] }, Ty::Int))
            }
            "sum" if args.len() == 2 => {
                // `sum(page, .x)`: the rows' field, summed — a loop that
                // pushes each projection, then the sum of the list.
                let (source, source_ty) = self.expr(&args[0], out)?;
                let (domain, item_ty) = match (&source, &source_ty) {
                    (Expr::Scan(scan), Ty::Page(table, _)) => (LoopDomain::Page(scan.clone()), Ty::Row(table.clone())),
                    (_, Ty::Collection(item, max)) | (_, Ty::List(item, max)) => (LoopDomain::DerivedArray { value: source.clone(), max: *max, bound_source: "sum".into() }, item.as_ref().clone()),
                    (_, other) => return Err(type_error(args[0].site(), format!("sum takes a page or a bounded list, got {}", other.name()), "sum(t[prefix] first 50 by index, .amount)")),
                };
                let list = self.temp("sum");
                let item = self.temp("row");
                out.push(Stmt::Let { name: list.clone(), value: Expr::Array(Vec::new()) });
                let mut body = Vec::new();
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
                out.push(Stmt::For { binding: item, domain, body });
                Ok((Expr::Builtin { builtin: Builtin::Sum, args: vec![ir::var(&list)] }, projection_ty))
            }
            "sum" => {
                arity(1, "sum(list)")?;
                let (e, t) = self.expr(&args[0], out)?;
                let item = match &t {
                    Ty::List(item, _) | Ty::Collection(item, _) => item.as_ref().clone(),
                    other => return Err(type_error(args[0].site(), format!("sum takes a bounded list of numbers, got {}", other.name()), "sum a list of int values")),
                };
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
                arity(2, &format!("{name}(a, b)"))?;
                let [(a, at), (b, bt)]: [(Expr, Ty); 2] = self.strict_args(args, out)?.try_into().expect("checked arity");
                if at.is_optional() || bt.is_optional() || !at.comparable(&bt) {
                    return Err(type_error(site, format!("{name} takes two present values of one type; got {} and {}", at.name(), bt.name()), "narrow the operands first"));
                }
                Ok((Expr::Builtin { builtin: if name == "min" { Builtin::Min } else { Builtin::Max }, args: vec![a, b] }, at.join(&bt)))
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
                    keys.push(SortKey { field, order });
                }
                if t.loop_max().is_none() {
                    return Err(type_error(args[0].site(), format!("sort takes a bounded list, got {}", t.name()), "sort(rows, 'at')"));
                }
                Ok((Expr::Builtin { builtin: Builtin::Sort { keys }, args: vec![e] }, t))
            }
            "len" => Err(unknown(site, "len is spelled count", format!("count({})", args.first().map(print::expression).unwrap_or_default()))),
            other => Err(unknown(
                site,
                format!("unknown function {other}"),
                name_rewrite(other, self.catalog.functions.keys().map(String::as_str).chain(["count", "sum", "slice", "min", "max", "tokens", "share", "sort", "divmod", "sorted"]), None),
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
