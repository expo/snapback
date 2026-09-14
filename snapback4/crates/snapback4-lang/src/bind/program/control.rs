//! Lexical statement scopes, flow refinements and helper expansion.

use super::*;

impl Binder<'_> {
    // ----- statements -----

    pub(super) fn block(&mut self, statements: &[S], out: &mut setup::Body, completes: bool) -> Fallible<()> {
        let before = self.visible_bindings();
        self.push_scope();
        let count = statements.len();
        let mut result = Ok(());
        for (index, statement) in statements.iter().enumerate() {
            result = self.statement(statement, out, completes && index + 1 == count);
            if result.is_err() {
                break;
            }
        }
        let after = self.visible_bindings();
        self.pop_scope();
        for (name, old) in before {
            let new = &after[&name];
            if old.runtime == new.runtime && old.revision != new.revision {
                self.scopes.last_mut().expect("a scope").insert(name, new.clone());
            }
        }
        result
    }

    pub(super) fn statement(&mut self, statement: &S, out: &mut setup::Body, completes: bool) -> Fallible<()> {
        match statement {
            S::Return { value, site: _ } => {
                let (expr, ty) = self.value_of(value, out)?;
                self.returns.push(ty);
                out.push(Stmt::Return(expr));
                Ok(())
            }
            S::Bind { names, value, site } => {
                if names.len() == 2 {
                    return self.tuple_bind(names, value, site, out);
                }
                if names.len() != 1 {
                    return Err(unknown(site, "tuple bindings take exactly two names and sorted(a, b) or divmod(a, b)", "(quotient, remainder) = divmod(dividend, divisor)"));
                }
                let name = &names[0];
                if self.binding(name).is_some_and(|binding| binding.parameter) {
                    return Err(unknown(site, format!("{name} is an argument; locals cannot shadow arguments"), format!("rename the local (for example {name}2)")));
                }
                if let Some(mut binding) = self.binding(name).cloned()
                    && let Ty::List(item, _) = &binding.ty
                    && let A::Binary { op, left, right, .. } = value
                    && op == "+" && matches!(left.as_ref(), A::Name { name: source, .. } if source == name)
                    && let A::Array { items, .. } = right.as_ref()
                    && items.len() == 1
                {
                    let (value, ty) = self.value_of(&items[0], out)?;
                    if !ty.assignable_to(item) && !item.assignable_to(&ty) {
                        return Err(type_error(site, format!("{name} holds {}; cannot append {}", item.name(), ty.name()), "append an item of the list's type"));
                    }
                    // @ref LLP 3000.007#5.1 — append in place; the heap meter is the accumulated list's bound.
                    binding.ty = Ty::List(Box::new(item.join(&ty)), u32::MAX);
                    binding.declared = binding.ty.clone();
                    binding.fields.clear();
                    binding.revision += 1;
                    out.push(Stmt::Push { target: binding.runtime.clone(), value });
                    self.scopes.last_mut().expect("a scope").insert(name.clone(), binding);
                    return Ok(());
                }
                let (expr, ty) = self.value_of(value, out)?;
                if matches!(value, A::Write { op: WriteOp::Delete, .. }) {
                    return Err(unknown(site, "delete does not yield a value; return a confirmation value after the write", "delete the row, then `return null`"));
                }
                // @ref LLP 3000.007#5.1 — rebinding preserves the local slot and resets its flow refinement.
                if let Some(mut binding) = self.binding(name).cloned() {
                    if ty != Ty::Null && binding.declared != Ty::Null && !ty.assignable_to(&binding.declared) && !binding.declared.assignable_to(&ty) {
                        return Err(type_error(site, format!("{name} is {}; cannot rebind it to {}", binding.declared.name(), ty.name()), "use a different local for a different type"));
                    }
                    let joined = binding.declared.join(&ty);
                    binding.declared = if self.loops > 0 { joined.rebound() } else { joined };
                    binding.ty = if self.loops > 0 { ty.rebound() } else { ty };
                    binding.fields.clear();
                    binding.revision += 1;
                    out.push(Stmt::Assign { name: binding.runtime.clone(), value: expr });
                    self.scopes.last_mut().expect("a scope").insert(name.clone(), binding);
                } else {
                    let runtime = self.declare(name, ty);
                    out.push(Stmt::Let { name: runtime, value: expr });
                }
                Ok(())
            }
            S::Require { condition, code, site } => {
                validate_code(site, code)?;
                let (expr, ty) = self.expr(condition, out)?;
                if !ty.is_bool() {
                    return Err(type_error(condition.site(), format!("require needs a bool condition, got {}", ty.name()), "compare the value: `require x != null else CODE`"));
                }
                self.narrow(condition, true);
                out.push(Stmt::Require { condition: expr, code: code.clone(), site: Some(site.to_string()) });
                Ok(())
            }
            S::Emit { effect, payload, site } => {
                if self.in_prelude {
                    return Err(placement(site, "a write belongs to a chunk", "move emit into the chunk body"));
                }
                if self.kind == ProgramKind::Query {
                    return Err(Diagnostic::new(site, "E_EMIT_IN_QUERY", "queries cannot emit effects", "change query to mutation before emitting an effect"));
                }
                if !self.catalog.effects.contains_key(effect) {
                    return Err(unknown(site, format!("unknown effect {effect}"), format!("declare `effect {effect}` at the top level; a worker with a service token claims what is emitted (guide effects)")));
                }
                let start = out.len();
                let (expr, _) = self.expr(payload, out)?;
                if self.record_ownership { out.own(start, setup::Owner::Payload); }
                out.push(Stmt::Emit { effect: effect.clone(), payload: expr });
                Ok(())
            }
            S::If { condition, then_body, else_body, site: _ } => {
                let start = out.len();
                let (expr, ty) = self.expr(condition, out)?;
                if self.record_ownership { out.own(start, setup::Owner::Condition); }
                if !ty.is_bool() {
                    return Err(type_error(condition.site(), format!("if needs a bool condition, got {}", ty.name()), "compare the value: `if x != null:`"));
                }
                let before = self.visible_bindings();
                let (then_out, then_bindings) = self.branch(condition, true, then_body, completes)?;
                let (else_out, else_bindings) = self.branch(condition, false, else_body, completes)?;
                // Only continuing paths meet at the join. Branch locals do
                // not escape, but a fact proved by every survivor does.
                for (name, mut binding) in before {
                    let then_ty = if then_bindings[&name].runtime == binding.runtime { &then_bindings[&name].ty } else { &binding.ty };
                    let else_ty = if else_bindings[&name].runtime == binding.runtime { &else_bindings[&name].ty } else { &binding.ty };
                    binding.ty = match (exits(&then_out), exits(&else_out)) {
                        (false, false) => then_ty.join(else_ty),
                        (false, true) => then_ty.clone(),
                        (true, false) => else_ty.clone(),
                        (true, true) => binding.ty.clone(),
                    };
                    let then_fields = if then_bindings[&name].runtime == binding.runtime { &then_bindings[&name].fields } else { &binding.fields };
                    let else_fields = if else_bindings[&name].runtime == binding.runtime { &else_bindings[&name].fields } else { &binding.fields };
                    binding.fields = match (exits(&then_out), exits(&else_out)) {
                        (false, false) => then_fields.iter().filter_map(|(path, ty)| else_fields.get(path).map(|other| (path.clone(), ty.join(other)))).collect(),
                        (false, true) => then_fields.clone(),
                        (true, false) => else_fields.clone(),
                        (true, true) => binding.fields.clone(),
                    };
                    binding.declared = then_bindings[&name].declared.join(&else_bindings[&name].declared);
                    binding.revision = then_bindings[&name].revision.max(else_bindings[&name].revision);
                    self.scopes.last_mut().expect("a scope").insert(name, binding);
                }
                out.push_if(expr, then_out, else_out);
                Ok(())
            }
            S::For { name, domain, body, site } => {
                let (loop_domain, item_ty) = self.loop_domain(domain, out)?;
                if self.binding(name).is_some_and(|binding| binding.parameter) {
                    return Err(unknown(site, format!("{name} is an argument; locals cannot shadow arguments"), "give the loop item a fresh name"));
                }
                let (binding, body_out) = self.loop_body(name, item_ty, body, site)?;
                self.sources.insert(format!("for/{binding}"), (site.clone(), print::expression(domain)));
                out.push_for(binding, loop_domain, body_out);
                Ok(())
            }
            S::Break { site } => {
                if self.loops == 0 {
                    return Err(placement(site, "break ends the enclosing for or chunk, and there is none here", "delete this line; a program ends with return"));
                }
                out.push(Stmt::Break);
                Ok(())
            }
            S::Continue { site } => {
                if self.loops == 0 {
                    return Err(placement(site, "continue advances the enclosing for or chunk, and there is none here", "delete this line; a program ends with return"));
                }
                // @ref LLP 3000.007#5.1 — continue uses the interpreter's existing loop flow.
                out.push(Stmt::Continue);
                Ok(())
            }
            S::Expr { value, site } => {
                if let A::Call { name, args, site: call_site } = value
                    && let Some(function) = self.catalog.functions.get(name).cloned()
                    && (!completes || self.kind == ProgramKind::Job)
                {
                    let (value, _) = self.fn_call(&function, args, call_site, out)?;
                    out.push(Stmt::Let { name: self.temp("discarded"), value });
                    return Ok(());
                }
                if completes && self.kind != ProgramKind::Job {
                    let (expr, ty) = self.value_of(value, out)?;
                    self.returns.push(ty);
                    out.push(Stmt::Return(expr));
                    return Ok(());
                }
                if let A::Write { .. } = value {
                    self.write(value, out, false)?;
                    return Ok(());
                }
                Err(unknown(site, "a non-final expression must be a write; bind it if its value is needed", format!("value = {}", print::expression(value))))
            }
        }
    }

    pub(super) fn tuple_bind(&mut self, names: &[String], value: &A, site: &Site, out: &mut setup::Body) -> Fallible<()> {
        let A::Call { name, args, .. } = value else {
            return Err(unknown(site, "tuple bindings take exactly two names and sorted(a, b) or divmod(a, b)", "(quotient, remainder) = divmod(dividend, divisor)"));
        };
        if args.len() != 2 || (name != "divmod" && name != "sorted") {
            return Err(unknown(site, "tuple bindings take exactly two names and sorted(a, b) or divmod(a, b)", format!("({}, {}) = divmod(a, b)", names[0], names[1])));
        }
        for (position, local) in names.iter().enumerate() {
            if names[..position].contains(local) || self.scopes.last().is_some_and(|scope| scope.contains_key(local)) || self.scopes[0].contains_key(local) {
                return Err(unknown(site, format!("duplicate local {local}"), "give each tuple component a fresh name"));
            }
        }
        let (a, at) = self.expr(&args[0], out)?;
        let ta = self.temp("a");
        out.push(Stmt::Let { name: ta.clone(), value: a });
        let (b, bt) = self.expr(&args[1], out)?;
        if name == "divmod" {
            if !at.is_numeric() || !bt.is_numeric() {
                return Err(type_error(site, format!("divmod takes two present numbers, got {} and {}", at.name(), bt.name()), "narrow both operands first"));
            }
            let tmp = self.temp("divmod");
            out.push(Stmt::Let { name: tmp.clone(), value: Expr::Builtin { builtin: Builtin::Divmod { remainder_sink: "lexicographic-id".into() }, args: vec![ir::var(&ta), b] } });
            let first = self.declare(&names[0], Ty::Int);
            let second = self.declare(&names[1], Ty::Int);
            out.push(Stmt::Let { name: first, value: ir::field(ir::var(&tmp), "quotient") });
            out.push(Stmt::Let { name: second, value: ir::field(ir::var(&tmp), "remainder") });
        } else {
            if !at.comparable(&bt) || at.is_optional() || bt.is_optional() {
                return Err(type_error(site, format!("sorted takes two present values of one type, got {} and {}", at.name(), bt.name()), "narrow both operands first"));
            }
            let tb = self.temp("b");
            out.push(Stmt::Let { name: tb.clone(), value: b });
            let joined = at.join(&bt);
            let first = self.declare(&names[0], joined.clone());
            let second = self.declare(&names[1], joined);
            out.push(Stmt::Let { name: first, value: Expr::Builtin { builtin: Builtin::Min, args: vec![ir::var(&ta), ir::var(&tb)] } });
            out.push(Stmt::Let { name: second, value: Expr::Builtin { builtin: Builtin::Max, args: vec![ir::var(&ta), ir::var(&tb)] } });
        }
        Ok(())
    }

    /// Join loop-carried writes with the zero-iteration path before accepting
    /// the body. A refinement from the first iteration cannot bless later ones.
    fn loop_body(&mut self, name: &str, item: Ty, body: &[S], site: &Site) -> Fallible<(String, setup::Body)> {
        let mut header = self.visible_bindings();
        let saved = self.scopes.clone();
        let (temps, sites, returns) = (self.temps, self.sites, self.returns.len());
        // An acyclic dependency among carried slots stabilizes in at most
        // one pass per slot plus the first literal refinement. A cycle that
        // keeps nesting a value inside itself has no finite Quarry type.
        for _ in 0..header.len() + 2 {
            self.scopes = saved.clone();
            self.scopes.last_mut().expect("a scope").extend(header.clone());
            self.temps = temps;
            self.sites = sites;
            self.returns.truncate(returns);
            self.push_scope();
            let binding = self.declare(name, item.clone());
            self.loops += 1;
            let mut out = setup::Body::default();
            let result = self.block(body, &mut out, false);
            self.loops -= 1;
            let after = self.visible_bindings();
            self.pop_scope();
            result?;
            let mut changed = false;
            for (local, old) in &mut header {
                let new = &after[local];
                if new.runtime != old.runtime || new.revision == old.revision {
                    continue;
                }
                let declared = old.declared.join(&new.declared);
                let ty = old.ty.join(&declared);
                changed |= old.ty != ty || old.declared != declared || !old.fields.is_empty();
                old.fields.clear();
                old.ty = ty;
                old.declared = declared;
                old.revision = new.revision;
            }
            if !changed {
                self.scopes.last_mut().expect("a scope").extend(header);
                return Ok((binding, out));
            }
        }
        self.scopes = saved;
        Err(type_error(site, "this loop keeps growing a recursive value type", "accumulate items of a fixed type rather than nesting an accumulator inside itself"))
    }

    /// After `require x != null` or inside `if x != null:`, `x` is present.
    pub(super) fn narrow(&mut self, condition: &A, then_branch: bool) {
        match condition {
            A::Unary { op, value, .. } if op == "not" => self.narrow(value, !then_branch),
            A::Binary { op, left, right, .. } if (op == "and" && then_branch) || (op == "or" && !then_branch) => {
                self.narrow(left, then_branch);
                self.narrow(right, then_branch);
            }
            A::Binary { op, left, right, .. } if op == "!=" || op == "=" => {
                let candidate = match (left.as_ref(), right.as_ref()) {
                    (A::Literal { value: Literal::Null, .. }, other) | (other, A::Literal { value: Literal::Null, .. }) => other,
                    _ => return,
                };
                if let A::Name { name, .. } = candidate
                    && let Some(mut binding) = self.binding(name).cloned()
                {
                    binding.ty = if (op == "!=") == then_branch { binding.ty.required() } else { Ty::Null };
                    self.scopes.last_mut().expect("a scope").insert(name.clone(), binding);
                } else if let Some((name, path)) = field_path(candidate)
                    && !path.is_empty()
                    && let Some(mut binding) = self.binding(name).cloned()
                    && let Ok((_, ty)) = self.expr(candidate, &mut setup::Body::default())
                {
                    // @ref LLP 3000.007#10 — null guards refine fields of lexical snapshots, through short circuits and surviving branches.
                    let present = (op == "!=") == then_branch;
                    if present { binding.ty = binding.ty.required(); }
                    binding.fields.insert(path, if present { ty.required() } else { Ty::Null });
                    self.scopes.last_mut().expect("a scope").insert(name.to_owned(), binding);
                }
            }
            _ => {}
        }
    }

    pub(super) fn field_refinement(&self, expr: &A) -> Option<Ty> {
        let (name, path) = field_path(expr)?;
        self.binding(name)?.fields.get(&path).cloned()
    }

    pub(super) fn loop_domain(&mut self, domain: &A, out: &mut setup::Body) -> Fallible<(LoopDomain, Ty)> {
        match domain {
            A::Read(read) if read.range.is_some() => {
                let (scan, _) = self.scan(read, out)?;
                Ok((LoopDomain::Page(scan), Ty::Row(read.table.clone())))
            }
            A::Walk { table, seed, column, depth, site } => {
                let (recurse, ty) = self.walk(table, seed, column, *depth, site, out)?;
                Ok((LoopDomain::Recurse(recurse), ty))
            }
            A::Call { name, args, site } if name == "range" => {
                if args.len() != 2 { return Err(type_error(site, "range takes two int expressions", "for i in range(0, n):")); }
                let (start, start_ty) = self.expr(&args[0], out)?;
                let mut setup = setup::Body::default();
                let (end, end_ty) = self.expr(&args[1], &mut setup)?;
                let start = if setup.is_empty() { start } else { self.snapshot(start, out) };
                out.extend(setup);
                if start_ty != Ty::Int || end_ty != Ty::Int { return Err(type_error(site, "range takes two present ints", "for i in range(0, n):")); }
                let domain = match (literal_int(&args[0]), literal_int(&args[1])) {
                    (Some(start), Some(end_exclusive)) => LoopDomain::LiteralRange { start, end_exclusive },
                    _ => LoopDomain::ExpressionRange { start, end_exclusive: end },
                };
                Ok((domain, Ty::Int))
            }
            A::Name { name, site } if self.scopes[0].contains_key(name) && self.binding(name).is_some_and(|binding| binding.runtime == *name) => {
                let ty = self.lookup(name).expect("bound argument").clone();
                match ty {
                    Ty::List(item, max) => Ok((LoopDomain::ArgList { name: name.clone(), max }, *item)),
                    Ty::Optional(inner) if matches!(*inner, Ty::List(..)) => Err(type_error(site, "for cannot iterate an optional list", format!("for x in {name} ?? []:"))),
                    other => Err(type_error(site, format!("for cannot iterate {}", other.name()), "iterate a bounded page or a bounded list argument")),
                }
            }
            other => {
                let (expr, ty) = self.expr(other, out)?;
                match ty {
                    Ty::List(item, max) => Ok((LoopDomain::DerivedArray { value: expr, max, bound_source: "list".into() }, *item)),
                    Ty::Page(table, max) => Ok((LoopDomain::DerivedArray { value: expr, max, bound_source: "page".into() }, Ty::Row(table))),
                    Ty::Collection(item, max) => Ok((LoopDomain::DerivedArray { value: expr, max, bound_source: "shape".into() }, *item)),
                    Ty::Optional(inner) if inner.loop_max().is_some() => Err(type_error(other.site(), "for cannot iterate an optional list", format!("for x in {} ?? []:", print::expression(other)))),
                    Ty::Unknown => Err(unbound_loop(other.site(), "for cannot prove a static bound for this value", "iterate a bounded page, a bounded list argument, or tokens(text)")),
                    other_ty => Err(type_error(other.site(), format!("for cannot iterate {}", other_ty.name()), "iterate a bounded page or bounded list")),
                }
            }
        }
    }

    /// Arguments belong to the caller: bind and snapshot each one before
    /// introducing any parameter. `new` and reads are evaluated once, in
    /// source order, even when the helper uses the parameter repeatedly.
    fn helper_arguments(&mut self, name: &str, declared: &[ast::ArgDecl], args: &[A], site: &Site, out: &mut setup::Body) -> Fallible<BTreeMap<String, Binding>> {
        if self.depth >= MAX_EXPANSION_DEPTH {
            return Err(unsupported(site, "helpers nested deeper than eight levels", "flatten the helper"));
        }
        if args.len() != declared.len() {
            return Err(type_error(site, format!("{name} takes {} arguments; received {}", declared.len(), args.len()), format!("{name}({})", declared.iter().map(|a| a.name.clone()).collect::<Vec<_>>().join(", "))));
        }
        let mut bindings = BTreeMap::new();
        for (declared, given) in declared.iter().zip(args) {
            if bindings.contains_key(&declared.name) {
                return Err(unknown(&declared.site, format!("duplicate argument {}", declared.name), "rename one helper parameter"));
            }
            let expected = Ty::from_scalar(&declared.type_);
            let (expr, ty) = if expected.required().is_identity() { self.expr_as_identity(given, out, &expected)? } else { self.expr(given, out)? };
            // @ref LLP 3000.007#18.5 — call-site expansion preserves a same-table row; references keep their existing meaning.
            let expected = match (expected.required(), ty.required()) {
                (Ty::Ref(table), Ty::Row(row)) if table == row && (!ty.is_optional() || expected.is_optional()) => {
                    if expected.is_optional() { Ty::Row(row).optional() } else { Ty::Row(row) }
                }
                _ => expected,
            };
            if !ty.assignable_to(&expected) {
                return Err(type_error(given.site(), format!("{name}'s {} is {}; got {}", declared.name, expected.name(), ty.name()), format!("pass {} for {}", expected.name(), declared.name)));
            }
            let runtime = self.temp(&declared.name);
            out.push(Stmt::Let { name: runtime.clone(), value: expr });
            bindings.insert(declared.name.clone(), Binding { runtime, ty: expected.clone(), declared: expected, parameter: true, revision: 0, fields: BTreeMap::new() });
        }
        Ok(bindings)
    }

    pub(super) fn fn_call(&mut self, function: &ast::FunctionDecl, args: &[A], site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let bindings = self.helper_arguments(&function.name, &function.args, args, site, out)?;
        let caller = std::mem::replace(&mut self.scopes, vec![bindings]);
        let focal = self.focal.take();
        let loops = std::mem::take(&mut self.loops);
        let returns = std::mem::take(&mut self.returns);
        self.depth += 1;
        // @ref LLP 3000.007#5.2 — helpers expand in the caller's placement; a return exits only this expansion.
        let result = match &function.body {
            ast::FunctionBody::Expression(value) => self.value_of(value, out),
            ast::FunctionBody::Block(statements) => {
                let mut body = setup::Body::default();
                self.block(statements, &mut body, false).map(|()| {
                    let ty = self.returns.iter().cloned().reduce(|a, b| a.join(&b)).unwrap_or(Ty::Null);
                    let result = self.temp("result");
                    let done = self.temp("returned");
                    out.push(Stmt::Let { name: result.clone(), value: Expr::Literal(Value::Null) });
                    out.push(Stmt::Let { name: done.clone(), value: Expr::Literal(Value::Bool(false)) });
                    let ownership = setup::helper_ownership(&body);
                    let code = helper_returns(body.code, &result, &done).0;
                    out.extend(setup::Body { code, ownership });
                    (ir::var(&result), ty)
                })
            }
        };
        self.depth -= 1;
        self.returns = returns;
        self.loops = loops;
        self.scopes = caller;
        self.focal = focal;
        result.map_err(|diagnostic| {
            if matches!(diagnostic.code.as_str(), "E_QUARRY_PLACEMENT" | "E_EMIT_IN_QUERY") || diagnostic.message == "queries cannot mint ids" {
                placement(site, format!("fn {}: {} (at {})", function.name, diagnostic.message, diagnostic.site), diagnostic.rewrite)
            } else { diagnostic }
        })
    }

    fn visible_bindings(&self) -> BTreeMap<String, Binding> {
        self.scopes.iter().flat_map(|scope| scope.iter().map(|(name, binding)| (name.clone(), binding.clone()))).collect()
    }

    fn branch(&mut self, condition: &A, taken: bool, statements: &[S], completes: bool) -> Fallible<(setup::Body, BTreeMap<String, Binding>)> {
        self.push_scope();
        self.narrow(condition, taken);
        let mut out = setup::Body::default();
        let result = (|| {
            for (index, statement) in statements.iter().enumerate() {
                self.statement(statement, &mut out, completes && index + 1 == statements.len())?;
            }
            Ok((out, self.visible_bindings()))
        })();
        self.pop_scope();
        result
    }
}

/// Lower helper-local returns without extending the serialized IR. Guards
/// skip the remaining statements; a returning loop breaks its own iteration.
fn helper_returns(statements: Vec<Stmt>, result: &str, done: &str) -> (Vec<Stmt>, bool) {
    let mut out = Vec::new();
    let mut may_return = false;
    for statement in statements {
        let (statements, returns) = match statement {
            Stmt::Return(value) => (vec![Stmt::Assign { name: result.into(), value }, Stmt::Assign { name: done.into(), value: Expr::Literal(Value::Bool(true)) }], true),
            Stmt::If { condition, then_body, else_body } => {
                let (then_body, a) = helper_returns(then_body, result, done);
                let (else_body, b) = helper_returns(else_body, result, done);
                (vec![Stmt::If { condition, then_body, else_body }], a || b)
            }
            Stmt::For { binding, domain, body } => {
                let (mut body, returns) = helper_returns(body, result, done);
                if returns {
                    body.push(Stmt::If { condition: ir::var(done), then_body: vec![Stmt::Break], else_body: Vec::new() });
                }
                (vec![Stmt::For { binding, domain, body }], returns)
            }
            other => (vec![other], false),
        };
        if may_return {
            out.push(Stmt::If { condition: Expr::Unary { op: UnaryOp::Not, value: Box::new(ir::var(done)) }, then_body: statements, else_body: Vec::new() });
        } else {
            out.extend(statements);
        }
        may_return |= returns;
    }
    (out, may_return)
}

/// A loop may be empty. A return, an unconditional refusal, or two exiting
/// branches leave no path to the following statement.
pub(super) fn exits(statements: &[Stmt]) -> bool {
    statements.iter().any(|statement| match statement {
        Stmt::Return(_) | Stmt::Break | Stmt::Continue => true,
        Stmt::Require { condition: Expr::Literal(Value::Bool(false)), .. } => true,
        Stmt::If { then_body, else_body, .. } => exits(then_body) && exits(else_body),
        _ => false,
    })
}

/// Only lexical snapshots have stable fields; repeated database reads do not.
fn field_path(expr: &A) -> Option<(&str, Vec<String>)> {
    match expr {
        A::Name { name, .. } => Some((name, Vec::new())),
        A::Member { base, name, .. } => {
            let (root, mut path) = field_path(base)?;
            path.push(name.clone());
            Some((root, path))
        }
        _ => None,
    }
}
