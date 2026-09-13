//! Lexical statement scopes, flow refinements and helper expansion.

use super::*;

impl Binder<'_> {
    // ----- statements -----

    pub(super) fn block(&mut self, statements: &[S], out: &mut Vec<Stmt>, completes: bool) -> Fallible<()> {
        self.push_scope();
        let count = statements.len();
        let mut result = Ok(());
        for (index, statement) in statements.iter().enumerate() {
            result = self.statement(statement, out, completes && index + 1 == count);
            if result.is_err() {
                break;
            }
        }
        self.pop_scope();
        result
    }

    pub(super) fn statement(&mut self, statement: &S, out: &mut Vec<Stmt>, completes: bool) -> Fallible<()> {
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
                if self.scopes.last().is_some_and(|scope| scope.contains_key(name)) {
                    return Err(unknown(site, format!("duplicate local {name}"), format!("rename {name} so every local in this scope is unique")));
                }
                if matches!(self.lookup(name), Some(_)) && self.scopes[0].contains_key(name) {
                    return Err(unknown(site, format!("{name} is an argument; locals cannot shadow arguments"), format!("rename the local (for example {name}2)")));
                }
                let (expr, ty) = self.value_of(value, out)?;
                if matches!(value, A::Write { op: WriteOp::Delete, .. }) {
                    return Err(unknown(site, "delete does not yield a value; return a confirmation value after the write", "delete the row, then `return null`"));
                }
                let runtime = self.declare(name, ty);
                out.push(Stmt::Let { name: runtime, value: expr });
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
                if self.kind == ProgramKind::Query {
                    return Err(Diagnostic::new(site, "E_EMIT_IN_QUERY", "queries cannot emit effects", "change query to mutation before emitting an effect"));
                }
                if !self.catalog.effects.contains_key(effect) {
                    return Err(unknown(site, format!("unknown effect {effect}"), format!("declare `effect {effect} from <module>` at the top level")));
                }
                let (expr, _) = self.expr(payload, out)?;
                out.push(Stmt::Emit { effect: effect.clone(), payload: expr });
                Ok(())
            }
            S::If { condition, then_body, else_body, site: _ } => {
                let (expr, ty) = self.expr(condition, out)?;
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
                        (true, true) => continue,
                    };
                    self.scopes.last_mut().expect("a scope").insert(name, binding);
                }
                out.push(Stmt::If { condition: expr, then_body: then_out, else_body: else_out });
                Ok(())
            }
            S::For { name, domain, body, site } => {
                let (loop_domain, item_ty) = self.loop_domain(domain, out)?;
                let mut body_out = Vec::new();
                self.push_scope();
                let binding = self.declare(name, item_ty);
                let result = self.block(body, &mut body_out, false);
                self.pop_scope();
                result?;
                let _ = site;
                out.push(Stmt::For { binding, domain: loop_domain, body: body_out });
                Ok(())
            }
            S::Expr { value, site } => {
                if let A::Call { name, args, site: call_site } = value
                    && self.catalog.procs.contains_key(name)
                {
                    return self.proc_call(name, args, call_site, out);
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

    pub(super) fn tuple_bind(&mut self, names: &[String], value: &A, site: &Site, out: &mut Vec<Stmt>) -> Fallible<()> {
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
                }
            }
            _ => {}
        }
    }

    pub(super) fn loop_domain(&mut self, domain: &A, out: &mut Vec<Stmt>) -> Fallible<(LoopDomain, Ty)> {
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
                if args.len() != 2 {
                    return Err(type_error(site, "range takes two integer literals", "for i in range(0, 10):"));
                }
                let start = literal_int(&args[0]).ok_or_else(|| type_error(args[0].site(), "range takes integer literals", "for i in range(0, 10):"))?;
                let end = literal_int(&args[1]).ok_or_else(|| type_error(args[1].site(), "range takes integer literals", "for i in range(0, 10):"))?;
                if end < start || end - start > 10_000 {
                    return Err(unbound_loop(site, "range spans at most 10,000 steps", "for i in range(0, 10):"));
                }
                Ok((LoopDomain::LiteralRange { start, end_exclusive: end }, Ty::Int))
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
    fn helper_arguments(&mut self, name: &str, declared: &[ast::ArgDecl], args: &[A], site: &Site, out: &mut Vec<Stmt>) -> Fallible<BTreeMap<String, Binding>> {
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
            if !ty.assignable_to(&expected) {
                return Err(type_error(given.site(), format!("{name}'s {} is {}; got {}", declared.name, expected.name(), ty.name()), format!("pass {} for {}", expected.name(), declared.name)));
            }
            let runtime = self.temp(&declared.name);
            out.push(Stmt::Let { name: runtime.clone(), value: expr });
            bindings.insert(declared.name.clone(), Binding { runtime, ty: expected });
        }
        Ok(bindings)
    }

    pub(super) fn proc_call(&mut self, name: &str, args: &[A], site: &Site, out: &mut Vec<Stmt>) -> Fallible<()> {
        let proc = self.catalog.procs[name].clone();
        let bindings = self.helper_arguments(name, &proc.args, args, site, out)?;
        let caller = std::mem::replace(&mut self.scopes, vec![bindings]);
        let focal = self.focal.take();
        self.depth += 1;
        let result = self.block(&proc.body, out, false);
        self.depth -= 1;
        self.scopes = caller;
        self.focal = focal;
        result
    }

    pub(super) fn fn_call(&mut self, function: &ast::FunctionDecl, args: &[A], site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        let bindings = self.helper_arguments(&function.name, &function.args, args, site, out)?;
        let caller = std::mem::replace(&mut self.scopes, vec![bindings]);
        let focal = self.focal.take();
        self.depth += 1;
        let result = self.expr(&function.body, out);
        self.depth -= 1;
        self.scopes = caller;
        self.focal = focal;
        result
    }

    fn visible_bindings(&self) -> BTreeMap<String, Binding> {
        self.scopes.iter().flat_map(|scope| scope.iter().map(|(name, binding)| (name.clone(), binding.clone()))).collect()
    }

    fn branch(&mut self, condition: &A, taken: bool, statements: &[S], completes: bool) -> Fallible<(Vec<Stmt>, BTreeMap<String, Binding>)> {
        self.push_scope();
        self.narrow(condition, taken);
        let mut out = Vec::new();
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

/// A loop may be empty. A return, an unconditional refusal, or two exiting
/// branches leave no path to the following statement.
fn exits(statements: &[Stmt]) -> bool {
    statements.iter().any(|statement| match statement {
        Stmt::Return(_) => true,
        Stmt::Require { condition: Expr::Literal(Value::Bool(false)), .. } => true,
        Stmt::If { then_body, else_body, .. } => exits(then_body) && exits(else_body),
        _ => false,
    })
}
