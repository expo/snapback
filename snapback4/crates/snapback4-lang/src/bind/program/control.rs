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
            if let Err(error) = self.statement(statement, out, completes && index + 1 == count) {
                if result.is_ok() { result = Err(error); }
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

    pub(super) fn append_errors(&mut self, diagnostics: &mut Vec<Diagnostic>) {
        for error in self.errors.drain(..) {
            if !diagnostics.contains(&error) { diagnostics.push(error); }
        }
    }

    pub(super) fn record_error(&mut self, error: Diagnostic) {
        if !self.errors.contains(&error) { self.errors.push(error); }
    }

    pub(super) fn statement(&mut self, statement: &S, out: &mut setup::Body, completes: bool) -> Fallible<()> {
        let result = self.statement_inner(statement, out, completes);
        if let Err(error) = &result {
            self.record_error(error.clone());
            if let S::Bind { names, .. } = statement {
                for name in names {
                    if self.binding(name).is_some_and(|binding| binding.parameter) { continue; }
                    let runtime = self.declare(name, Ty::Unknown);
                    let binding = self.scopes.last_mut().unwrap().get_mut(name).unwrap();
                    binding.error = Some(error.clone());
                    out.push(Stmt::Let { name: runtime, value: Expr::Literal(Value::Null) });
                }
            }
        }
        result
    }

    // @ref LLP 3000.007#5.1 — recursive growth is an assignment failure;
    // an ill-typed value keeps its original expression diagnostic.
    fn assignment_type_error(&self, error: Diagnostic, name: &str, value: &A, site: &Site) -> Diagnostic {
        if self.loops > 0 && error.code == "E_QUARRY_TYPE" && recursive_concat(value, name) {
            recursive_list_error(site, name)
        } else { error }
    }

    fn statement_inner(&mut self, statement: &S, out: &mut setup::Body, completes: bool) -> Fallible<()> {
        match statement {
            S::Return { value, site: _ } => {
                let (expr, ty) = self.value_of(value, out)?;
                self.returns.push((ty, value.clone()));
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
                    && let Ty::List(item, max) = &binding.ty
                    && let A::Binary { op, left, right, .. } = value
                    && op == "+" && matches!(left.as_ref(), A::Name { name: source, .. } if source == name)
                    && let A::Array { items, .. } = right.as_ref()
                    && items.len() == 1
                {
                    let (element, ty) = self.value_of(&items[0], out)?;
                    let mut origins = binding.origins.clone();
                    origins.push((Ty::List(Box::new(ty.clone()), 1), value.clone()));
                    let joined = if *max == 0 { ty.clone() } else { item.join_item(&ty).map_err(|error| self.assignment_type_error(self.join_error_many(error.at("[]"), &origins), name, value, site))? };
                    if !ty.assignable_to(&joined) || !item.assignable_to(&joined) {
                        return Err(self.assignment_type_error(type_error(site, format!("{name} holds {}; cannot append {}", item.name(), ty.name()), "append an item of the list's type"), name, value, site));
                    }
                    // @ref LLP 3000.007#5.1 — append in place; the heap meter is the accumulated list's bound.
                    binding.ty = Ty::List(Box::new(joined), u32::MAX);
                    binding.origins = origins;
                    binding.declared = binding.ty.clone();
                    binding.fields.clear();
                    binding.error = None;
                    binding.revision += 1;
                    out.push(Stmt::Push { target: binding.runtime.clone(), value: element });
                    self.scopes.last_mut().expect("a scope").insert(name.clone(), binding);
                    return Ok(());
                }
                let (expr, ty) = self.value_of(value, out)?;
                if matches!(value, A::Write { op: WriteOp::Delete, .. }) {
                    return Err(unknown(site, "delete does not yield a value; return a confirmation value after the write", "delete the row, then `return null`"));
                }
                // @ref LLP 3000.007#5.1 — rebinding preserves the local slot and resets its flow refinement.
                if let Some(mut binding) = self.binding(name).cloned() {
                    let mut origins = binding.origins.clone();
                    origins.push((ty.clone(), value.clone()));
                    let joined = binding.declared.join(&ty).map_err(|error| self.assignment_type_error(self.assignment_join_error(error, name, &origins), name, value, site))?;
                    if ty != Ty::Null && binding.declared != Ty::Null && !ty.assignable_to(&binding.declared) && !binding.declared.assignable_to(&ty) {
                        return Err(self.assignment_type_error(type_error(site, format!("{name} is {}; cannot rebind it to {}", binding.declared.name(), ty.name()), "use a different local for a different type"), name, value, site));
                    }
                    binding.declared = if self.loops > 0 { joined.rebound() } else { joined };
                    binding.ty = if self.loops > 0 { ty.rebound() } else { ty };
                    binding.origins = origins;
                    binding.fields.clear();
                    binding.error = None;
                    binding.revision += 1;
                    out.push(Stmt::Assign { name: binding.runtime.clone(), value: expr });
                    self.scopes.last_mut().expect("a scope").insert(name.clone(), binding);
                } else {
                    let runtime = self.declare(name, ty.clone());
                    self.scopes.last_mut().unwrap().get_mut(name).unwrap().origins.push((ty, value.clone()));
                    out.push(Stmt::Let { name: runtime, value: expr });
                }
                Ok(())
            }
            S::Require { condition, code, site } => {
                validate_code(site, code)?;
                let (expr, ty) = self.expr(condition, out)?;
                if !ty.is_bool() {
                    return Err(type_error(condition.site(), format!("require needs a bool condition, got {}", ty.name()), bool_condition_rewrite(&ty, "require x {} else CODE")));
                }
                self.narrow(condition, true);
                out.push(Stmt::Require { condition: expr, code: code.clone(), site: Some(site.to_string()) });
                Ok(())
            }
            S::Emit { effect, payload, once, site } => {
                if self.in_prelude {
                    return Err(placement(site, "a write belongs to a chunk", "move emit inside a top-level `for row in table:` job sweep"));
                }
                if self.kind == ProgramKind::Query {
                    return Err(Diagnostic::new(site, "E_EMIT_IN_QUERY", "queries cannot emit effects", "change query to mutation before emitting an effect"));
                }
                if !self.catalog.effects.contains_key(effect) {
                    return Err(unknown(site, format!("unknown effect {effect}"), format!("declare `effect {effect}` at the top level; a worker with a service token claims what is emitted (guide effects)")));
                }
                let start = out.len();
                let (mut expr, _) = self.expr(payload, out)?;
                if self.record_ownership { out.own(start, setup::Owner::Payload); }
                let once = once.as_ref().map(|key| {
                    let A::Array { items, .. } = key else {
                        return Err(type_error(key.site(), "once requires an array of key values", "emit notify { ... } once [recipient, periodEnd]"));
                    };
                    let mut setup = setup::Body::default();
                    // A once key is a positional tuple, not an iterable list:
                    // recipient and period may deliberately have different types.
                    let key = Expr::Array(self.strict_args(items, &mut setup)?.into_iter().map(|(value, _)| value).collect());
                    self.sequence_setup([&mut expr].into_iter(), setup, out);
                    Ok(key)
                }).transpose()?;
                out.push(Stmt::Emit { effect: effect.clone(), payload: expr, once });
                Ok(())
            }
            S::If { condition, then_body, else_body, site } => {
                let start = out.len();
                let (expr, ty) = self.expr(condition, out)?;
                if self.record_ownership { out.own(start, setup::Owner::Condition); }
                if !ty.is_bool() {
                    return Err(type_error(condition.site(), format!("if needs a bool condition, got {}", ty.name()), bool_condition_rewrite(&ty, "if x {}:")));
                }
                let before = self.visible_bindings();
                let (then_out, then_bindings) = self.branch(condition, true, then_body, completes)?;
                let (else_out, else_bindings) = self.branch(condition, false, else_body, completes)?;
                let then_flow = flow::Outcomes::block(&then_out);
                let else_flow = flow::Outcomes::block(&else_out);
                // Only continuing paths meet at the join. Branch locals do
                // not escape, but a fact proved by every survivor does.
                for (name, mut binding) in before {
                    let then_ty = if then_bindings[&name].runtime == binding.runtime { &then_bindings[&name].ty } else { &binding.ty };
                    let else_ty = if else_bindings[&name].runtime == binding.runtime { &else_bindings[&name].ty } else { &binding.ty };
                    binding.ty = match (then_flow.exits(), else_flow.exits()) {
                        (false, false) => self.join(then_ty, else_ty, &joins::local(&name, site), &joins::local(&name, site))?,
                        (false, true) => then_ty.clone(),
                        (true, false) => else_ty.clone(),
                        (true, true) => binding.ty.clone(),
                    };
                    let then_fields = if then_bindings[&name].runtime == binding.runtime { &then_bindings[&name].fields } else { &binding.fields };
                    let else_fields = if else_bindings[&name].runtime == binding.runtime { &else_bindings[&name].fields } else { &binding.fields };
                    binding.fields = match (then_flow.exits(), else_flow.exits()) {
                        (false, false) => then_fields.iter().filter_map(|(path, ty)| else_fields.get(path).map(|other| self.join(ty, other, &joins::local(&name, site), &joins::local(&name, site)).map(|ty| (path.clone(), ty)))).collect::<Fallible<_>>()?,
                        (false, true) => then_fields.clone(),
                        (true, false) => else_fields.clone(),
                        (true, true) => binding.fields.clone(),
                    };
                    // Break/continue still carry declarations to the loop's
                    // fixed point; return/refusal carry none to any later use.
                    binding.declared = match (then_flow.terminates(), else_flow.terminates()) {
                        (false, false) => self.join(&then_bindings[&name].declared, &else_bindings[&name].declared, &joins::local(&name, site), &joins::local(&name, site))?,
                        (false, true) => then_bindings[&name].declared.clone(),
                        (true, false) => else_bindings[&name].declared.clone(),
                        (true, true) => binding.declared.clone(),
                    };
                    for origin in then_bindings[&name].origins.iter().chain(&else_bindings[&name].origins) {
                        if !binding.origins.iter().any(|(_, source)| *source == origin.1) { binding.origins.push(origin.clone()); }
                    }
                    binding.revision = then_bindings[&name].revision.max(else_bindings[&name].revision);
                    self.scopes.last_mut().expect("a scope").insert(name, binding);
                }
                out.push_if(expr, then_out, else_out);
                Ok(())
            }
            S::For { name, domain, body, site } => {
                if self.caller_kind == ProgramKind::Job && self.loops + self.caller_loops == 0
                    && matches!(domain, A::If { condition, .. } if super::super::intent_variants::condition(condition).is_some()) {
                    let mut leaf = domain;
                    while let A::If { then, .. } = leaf { leaf = then; }
                    let table = match leaf { A::Read(read) => read.table.as_str(), A::Merge(merge) => merge.table.as_str(), _ => "table" };
                    return Err(placement(site, "argument-presence alternatives cannot be a job sweep domain",
                        format!("for {name} in {table}:  -- put the optional filter and work inside this stable sweep")).guide("jobs"));
                }
                let (loop_domain, item_ty) = self.loop_domain(domain, out)?;
                if self.binding(name).is_some_and(|binding| binding.parameter) {
                    return Err(unknown(site, format!("{name} is an argument; locals cannot shadow arguments"), "give the loop item a fresh name"));
                }
                let before = self.visible_bindings();
                let (binding, body_out) = self.loop_body(name, item_ty, body, site)?;
                if self.caller_kind == ProgramKind::Job && self.loops + self.caller_loops == 0 && matches!(&loop_domain, LoopDomain::Page(scan) if scan.take == Bound::Meter) {
                    let after = self.visible_bindings();
                    if let Some((name, _)) = before.iter().find(|(name, old)| after.get(*name).is_some_and(|new| old.revision != new.revision)) {
                        return Err(placement(site, format!("automatic sweep carries local {name} across iterations, but chunks commit independently"), format!("declare {name} inside the `for row in table:` body for per-item work, or store cross-chunk progress in a table")).guide("jobs"));
                    }
                }
                self.sources.insert(format!("for/{binding}"), (site.clone(), self.catalog.source.expression(domain)));
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
                // @ref LLP 3000.017#2.2 — a bare signal write
                // returns nothing; explicit return still yields its value.
                if let A::Write { table, .. } = value
                    && self.schema.table(table).is_some_and(|t| t.ephemeral.is_some())
                {
                    self.write(value, out, false)?;
                    return Ok(());
                }
                if completes && self.kind != ProgramKind::Job {
                    let (expr, ty) = self.value_of(value, out)?;
                    self.returns.push((ty, value.clone()));
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
            let joined = self.join(&at, &bt, &args[0], &args[1])?;
            if !at.comparable(&bt) || at.is_optional() || bt.is_optional() {
                return Err(type_error(site, format!("sorted takes two present values of one type, got {} and {}", at.name(), bt.name()), "narrow both operands first"));
            }
            let tb = self.temp("b");
            out.push(Stmt::Let { name: tb.clone(), value: b });
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
        let mut growing_list = None;
        // An acyclic dependency among carried slots stabilizes in at most
        // one pass per slot plus the first literal refinement. A cycle that
        // keeps nesting a value inside itself has no finite Quarry type.
        for _ in 0..header.len() + 2 {
            growing_list = None;
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
                let declared = self.join(&old.declared, &new.declared, &joins::local(local, site), &joins::local(local, site))?;
                let ty = self.join(&old.ty, &declared, &joins::local(local, site), &joins::local(local, site))?;
                let type_changed = old.ty != ty || old.declared != declared;
                if type_changed && matches!(ty, Ty::List(..))
                    && new.origins.iter().any(|(_, source)| has_concat(source)) {
                    growing_list.get_or_insert_with(|| local.clone());
                }
                changed |= type_changed || !old.fields.is_empty();
                old.fields.clear();
                old.ty = ty;
                old.declared = declared;
                for origin in &new.origins {
                    if !old.origins.iter().any(|(_, source)| *source == origin.1) { old.origins.push(origin.clone()); }
                }
                old.revision = new.revision;
            }
            if !changed {
                self.scopes.last_mut().expect("a scope").extend(header);
                return Ok((binding, out));
            }
        }
        self.scopes = saved;
        // @ref LLP 3000.007#5.1 — lengths widen to the heap bound, but recursively
        // nesting a carried list has no finite item type. Offer the fixed-item form.
        if let Some(local) = growing_list {
            return Err(recursive_list_error(site, &local));
        }
        Err(type_error(site, "this loop keeps growing a recursive value type", "accumulate items of a fixed type rather than nesting an accumulator inside itself"))
    }

    /// After `require x != null` or inside `if x != null:`, `x` is present.
    pub(super) fn narrow(&mut self, condition: &A, then_branch: bool) {
        match condition {
            A::Call { name, args, site } if name == super::super::intent_variants::PRESENT => self.narrow(&A::Binary {
                op: "!=".into(), left: Box::new(args[0].clone()), right: Box::new(A::Literal { value: Literal::Null, site: site.clone() }), site: site.clone(),
            }, then_branch),
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
                } else if let Some((name, path)) = field_path(candidate, self.focal.as_ref().map(|(name, _)| name.as_str()))
                    && !path.is_empty()
                    && let Some(mut binding) = self.binding(&name).cloned()
                    && let Ok((_, ty)) = self.expr(candidate, &mut setup::Body::default())
                {
                    // @ref LLP 3000.007#10 — null guards refine fields of lexical snapshots, through short circuits and surviving branches.
                    let present = (op == "!=") == then_branch;
                    if present { binding.ty = binding.ty.required(); }
                    binding.fields.insert(path, if present { ty.required() } else { Ty::Null });
                    self.scopes.last_mut().expect("a scope").insert(name.to_owned(), binding);
                } else {
                    self.narrow_call(candidate, (op == "!=") == then_branch);
                }
            }
            _ => {}
        }
    }

    pub(super) fn field_refinement(&self, expr: &A) -> Option<Ty> {
        let (name, path) = field_path(expr, self.focal.as_ref().map(|(name, _)| name.as_str()))?;
        self.binding(&name)?.fields.get(&path).cloned()
    }

    pub(super) fn loop_domain(&mut self, domain: &A, out: &mut setup::Body) -> Fallible<(LoopDomain, Ty)> {
        if let A::Read(read) = domain && let Some(shaped) = self.page_shape(read) { return self.loop_domain(&shaped, out); }
        if let A::Name { name, site } = domain && self.binding(name).is_none() && self.catalog.tables.contains_key(name) {
            let read = ReadExpr { cursor_prefix: None, order_keys: Vec::new(), computed: Default::default(), table: name.clone(), keys: Vec::new(), index: Some("byId".into()), range: None, matching: None, filter: None, seeks: Vec::new(), site: site.clone() };
            let (scan, _) = self.scan_at(&read, out, prefix::Position::Domain)?;
            return Ok((LoopDomain::Page(scan), Ty::Row(name.clone())));
        }
        match domain {
            A::Name { name, .. } if self.binding(name).is_none() && self.catalog.view_reads.contains_key(name) => {
                let mut merge = self.catalog.view_reads[name].clone(); merge.site = domain.site().clone();
                self.loop_domain(&A::Merge(merge), out)
            }
            A::Merge(merge) if merge.index.is_empty() => {
                let (value, ty) = self.planned_view(merge, out, prefix::Position::Domain)?;
                let item = match ty { Ty::Page(table, _) => Ty::Row(table), Ty::Collection(item, _) => *item, _ => unreachable!("planned collection") };
                Ok((LoopDomain::DerivedArray { value, max: merge.take, bound_source: "planned domain".into() }, item))
            }
            A::Read(read) if self.is_page(read, ReadMode::FilteredPoint)? => {
                let (scan, _) = self.scan_at(read, out, prefix::Position::Domain)?;
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
                (Ty::Ref(table), Ty::WriteRow(row)) if table == row && (!ty.is_optional() || expected.is_optional()) => {
                    if expected.is_optional() { Ty::WriteRow(row).optional() } else { Ty::WriteRow(row) }
                }
                _ => expected,
            };
            if !ty.assignable_to(&expected) {
                return Err(type_error(given.site(), format!("{name}'s {} is {}; got {}", declared.name, expected.name(), ty.name()), match (ty.required(), expected.required()) {
                    (Ty::Enum(variants), Ty::Text(max)) if variants.iter().any(|variant| variant.chars().count() > max as usize) => format!("change {name}'s parameter to `{}: {}`; not every variant fits text <={max}", declared.name, ty.name()),
                    _ if ty.is_optional() && !expected.is_optional() => format!("{} — require this argument once before calling {name}; absent or hidden rows refuse NOT_FOUND", print::expression(&A::Assert { value: Box::new(given.clone()), code: "NOT_FOUND".into(), site: given.site().clone() })),
                    _ => format!("pass {} for {}", expected.name(), declared.name),
                }));
            }
            let runtime = self.temp(&declared.name);
            out.push(Stmt::Let { name: runtime.clone(), value: expr });
            bindings.insert(declared.name.clone(), Binding { runtime, ty: expected.clone(), declared: expected, parameter: true, revision: 0, fields: BTreeMap::new(), error: None, origins: Vec::new() });
        }
        Ok(bindings)
    }

    pub(super) fn fn_call(&mut self, function: &ast::FunctionDecl, args: &[A], site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let bindings = self.helper_arguments(&function.name, &function.args, args, site, out)?;
        let start = out.len();
        let caller = std::mem::replace(&mut self.scopes, vec![bindings]);
        self.declare(pure_calls::CONSTANTS, Ty::Null);
        let focal = self.focal.take();
        let loops = std::mem::take(&mut self.loops);
        // @ref LLP 3000.019#6 — remove the measured helper/inline placement discrepancy.
        // @ref LLP 3000.007#5.2 — placement inherits caller loops; break/continue stay lexical.
        self.caller_loops += loops;
        let returns = std::mem::take(&mut self.returns);
        self.depth += 1;
        self.call_chain.push((function.name.clone(), site.clone()));
        // @ref LLP 3000.007#5.2 — helpers expand in the caller's placement; a return exits only this expansion.
        let result = match &function.body {
            ast::FunctionBody::Expression(value) => self.value_of(value, out),
            ast::FunctionBody::Block(statements) => {
                let mut body = setup::Body::default();
                self.block(statements, &mut body, false).and_then(|()| {
                    let ty = self.return_type()?;
                    let result = self.temp("result");
                    let done = self.temp("returned");
                    out.push(Stmt::Let { name: result.clone(), value: Expr::Literal(Value::Null) });
                    out.push(Stmt::Let { name: done.clone(), value: Expr::Literal(Value::Bool(false)) });
                    let ownership = setup::helper_ownership(&body);
                    let code = helper_returns(body.code, &result, &done).0;
                    out.extend(setup::Body { code, ownership });
                    Ok((ir::var(&result), ty))
                })
            }
        };
        if let Ok((value, _)) = &result {
            self.pure_functions.insert(function.name.clone(), pure_calls::statements(&out[start..]) && pure_calls::expression(value));
        }
        self.depth -= 1;
        self.call_chain.pop();
        self.returns = returns;
        self.loops = loops;
        self.caller_loops -= loops;
        self.scopes = caller;
        self.focal = focal;
        result.map_err(|diagnostic| {
            if matches!(diagnostic.code.as_str(), "E_QUARRY_PLACEMENT" | "E_EMIT_IN_QUERY") || diagnostic.message == "queries cannot mint ids" {
                self.errors.retain(|error| *error != diagnostic);
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
            let mut result = Ok(());
            for (index, statement) in statements.iter().enumerate() {
                if let Err(error) = self.statement(statement, &mut out, completes && index + 1 == statements.len()) {
                    if result.is_ok() { result = Err(error); }
                }
            }
            result.map(|()| (out, self.visible_bindings()))
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

pub(super) fn exits(statements: &[Stmt]) -> bool {
    flow::Outcomes::block(statements).exits()
}

/// Only lexical snapshots have stable fields; repeated database reads do not.
// @ref LLP 3000.019#3.2 — the aggregate's declared row is a lexical snapshot;
// null guards inside its value expression refine `.field` for that row only.
pub(super) fn field_path(expr: &A, focal: Option<&str>) -> Option<(String, Vec<String>)> {
    match expr {
        A::Name { name, .. } => Some((name.clone(), Vec::new())),
        A::Focal { .. } => Some((focal?.to_owned(), Vec::new())),
        A::Member { base, name, .. } => {
            let (root, mut path) = field_path(base, focal)?;
            path.push(name.clone());
            Some((root, path))
        }
        _ => None,
    }
}

/// A condition needs a `bool`, and the repair depends on what the author has.
///
/// For most optionals `x != null` is exactly right: the question is whether a value
/// is present. For `bool ?` it is a trap — `x != null` is also true when the value is
/// `false`, so an author who follows that advice gets a condition that compiles, is
/// blessed by `check`, and silently inverts their intent for every explicitly-false
/// row. The 0.2.28 calibration hit this class six times.
///
/// `shape` carries `{}` where the comparison belongs.
pub(super) fn bool_condition_rewrite(ty: &crate::types::Ty, shape: &str) -> String {
    if matches!(ty.required(), crate::types::Ty::Bool) {
        format!("compare the value: `{}` — `x != null` is also true when x is false", shape.replace("{}", "= true"))
    } else {
        format!("compare the value: `{}`", shape.replace("{}", "!= null"))
    }
}

fn has_concat(value: &A) -> bool {
    let mut found = false;
    super::super::intent_walk::expression(&mut value.clone(), &mut |value| {
        found |= matches!(value, A::Binary { op, .. } if op == "+");
    });
    found
}

fn recursive_concat(value: &A, name: &str) -> bool {
    // Follow returned container values, not arbitrary references: count(xs)
    // and even count([xs]) consume the accumulator without embedding it.
    fn embeds(value: &A, name: &str, nested: bool) -> bool {
        match value {
            A::Name { name: source, .. } => nested && source == name,
            A::Array { items, .. } => items.iter().any(|item| embeds(item, name, true)),
            A::Object { fields, .. } => fields.iter().any(|field| field.value.as_ref()
                .map_or(nested && field.name == name, |value| embeds(value, name, nested))),
            A::If { then, otherwise, .. } => embeds(then, name, nested) || embeds(otherwise, name, nested),
            A::Binary { op, left, right, .. } if op == "+" || op == "??" =>
                embeds(left, name, nested) || embeds(right, name, nested),
            A::Assert { value, .. } => embeds(value, name, nested),
            _ => false,
        }
    }
    has_concat(value) && embeds(value, name, false)
}

fn recursive_list_error(site: &Site, local: &str) -> Diagnostic {
    type_error(site, format!("this loop keeps growing {local}'s recursive list item type"),
        format!("use `{local} = {local} + [x]` with x of a fixed item type; do not nest a carried accumulator inside itself"))
}
