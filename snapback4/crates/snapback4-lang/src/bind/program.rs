//! Lowering one Quarry program to the IR: a scope of typed names, one
//! statement list that expressions may hoist temporaries into, reads that
//! choose their index, writes that read their target once, and shapes that
//! become bounded loops. Every refusal carries the rewrite that would pass.

use super::catalog::{Catalog, TableInfo};
use crate::ast::{self, Expr as A, Literal, ObjectField, ProgramKind, ReadExpr, ShapeField, Stmt as S, WriteOp};
use crate::diag::{Diagnostic, Fallible, Site, ambiguous, name_rewrite, type_error, unbound_loop, unknown, unsupported};
use crate::print;
use crate::types::{Ty, scalar_to_arg};
use snapback4_core::ir::{self, BinaryOp, Bound, Builtin, Expr, IndexKeyExpr, Input, KeyProvenance, LoopDomain, Merge, MergeLane, Order, Program, Read, Recurse, Scan, SortKey, Stmt, UnaryOp};
use snapback4_core::value::Value;
use std::collections::BTreeMap;

/// A bound operation: the IR plus the types the client sees.
#[derive(Clone, Debug)]
pub struct BoundProgram {
    pub program: Program,
    pub module: String,
    pub args: Vec<(String, Ty)>,
    pub result: Ty,
    pub site: Site,
}

pub struct Binder<'a> {
    catalog: &'a Catalog,
    name: String,
    kind: ProgramKind,
    scopes: Vec<BTreeMap<String, Ty>>,
    focal: Option<(String, Ty)>,
    temps: u32,
    sites: u32,
    returns: Vec<Ty>,
    /// Depth of fn/proc expansion, to bound recursion.
    depth: u32,
}

const MAX_EXPANSION_DEPTH: u32 = 8;
const MENTION_MAX: u32 = 64;

impl<'a> Binder<'a> {
    pub fn bind(catalog: &'a Catalog, module: &str, decl: &ast::ProgramDecl, diagnostics: &mut Vec<Diagnostic>) -> Option<BoundProgram> {
        let mut binder = Binder { catalog, name: decl.name.clone(), kind: decl.kind, scopes: vec![BTreeMap::new()], focal: None, temps: 0, sites: 0, returns: Vec::new(), depth: 0 };
        let mut args = BTreeMap::new();
        let mut arg_types = Vec::new();
        for arg in &decl.args {
            if args.contains_key(&arg.name) {
                diagnostics.push(unknown(&arg.site, format!("duplicate argument {}", arg.name), "rename one argument"));
                return None;
            }
            if let ast::TypeKind::Ref { table } = &arg.type_.kind
                && !catalog.tables.contains_key(table)
            {
                diagnostics.push(type_error(&arg.site, format!("argument {} references unknown table {table}", arg.name), name_rewrite(table, catalog.tables.keys().map(String::as_str), None)));
                return None;
            }
            let ty = Ty::from_scalar(&arg.type_);
            binder.scopes[0].insert(arg.name.clone(), ty.clone());
            args.insert(arg.name.clone(), scalar_to_arg(&arg.type_));
            arg_types.push((arg.name.clone(), ty));
        }
        let mut body = Vec::new();
        let mut failed = false;
        let count = decl.body.len();
        for (index, statement) in decl.body.iter().enumerate() {
            match binder.statement(statement, &mut body, index + 1 == count) {
                Ok(()) => {}
                Err(diagnostic) => {
                    diagnostics.push(diagnostic);
                    failed = true;
                }
            }
        }
        if failed {
            return None;
        }
        let result = binder.returns.iter().fold(None, |joined: Option<Ty>, ty| Some(match joined { Some(j) => j.join(ty), None => ty.clone() })).unwrap_or(Ty::Null);
        let full_name = if module == "schema" { decl.name.clone() } else { format!("{module}.{}", decl.name) };
        let kind = match decl.kind {
            ProgramKind::Query => ir::ProgramKind::Query,
            ProgramKind::Mutation => ir::ProgramKind::Mutation,
            ProgramKind::Job => ir::ProgramKind::Job,
        };
        Some(BoundProgram { program: Program { name: full_name, kind, args, read_time_granularity_ms: None, body }, module: module.to_owned(), args: arg_types, result, site: decl.site.clone() })
    }

    fn site(&mut self) -> String {
        self.sites += 1;
        format!("programs.{}.{}", self.name, self.sites - 1)
    }

    fn temp(&mut self, hint: &str) -> String {
        self.temps += 1;
        format!("${hint}{}", self.temps)
    }

    fn lookup(&self, name: &str) -> Option<&Ty> {
        self.scopes.iter().rev().find_map(|scope| scope.get(name))
    }

    fn declare(&mut self, name: &str, ty: Ty) {
        self.scopes.last_mut().expect("a scope").insert(name.to_owned(), ty);
    }

    fn push_scope(&mut self) {
        self.scopes.push(BTreeMap::new());
    }

    fn pop_scope(&mut self) {
        self.scopes.pop();
    }

    fn table(&self, name: &str, site: &Site) -> Fallible<&'a TableInfo> {
        self.catalog.tables.get(name).ok_or_else(|| unknown(site, format!("unknown table {name}"), name_rewrite(name, self.catalog.tables.keys().map(String::as_str), None)))
    }

    // ----- statements -----

    fn block(&mut self, statements: &[S], out: &mut Vec<Stmt>, completes: bool) -> Fallible<()> {
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

    fn statement(&mut self, statement: &S, out: &mut Vec<Stmt>, completes: bool) -> Fallible<()> {
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
                self.declare(name, ty);
                out.push(Stmt::Let { name: name.clone(), value: expr });
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
                let mut then_out = Vec::new();
                self.push_scope();
                self.narrow(condition, true);
                let then_result = self.block(then_body, &mut then_out, completes);
                self.pop_scope();
                then_result?;
                let mut else_out = Vec::new();
                self.push_scope();
                self.narrow(condition, false);
                let else_result = self.block(else_body, &mut else_out, completes);
                self.pop_scope();
                else_result?;
                out.push(Stmt::If { condition: expr, then_body: then_out, else_body: else_out });
                Ok(())
            }
            S::For { name, domain, body, site } => {
                let (loop_domain, item_ty) = self.loop_domain(domain, out)?;
                let mut body_out = Vec::new();
                self.push_scope();
                self.declare(name, item_ty);
                let result = self.block(body, &mut body_out, false);
                self.pop_scope();
                result?;
                let _ = site;
                out.push(Stmt::For { binding: name.clone(), domain: loop_domain, body: body_out });
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

    fn tuple_bind(&mut self, names: &[String], value: &A, site: &Site, out: &mut Vec<Stmt>) -> Fallible<()> {
        let A::Call { name, args, .. } = value else {
            return Err(unknown(site, "tuple bindings take exactly two names and sorted(a, b) or divmod(a, b)", "(quotient, remainder) = divmod(dividend, divisor)"));
        };
        if args.len() != 2 || (name != "divmod" && name != "sorted") {
            return Err(unknown(site, "tuple bindings take exactly two names and sorted(a, b) or divmod(a, b)", format!("({}, {}) = divmod(a, b)", names[0], names[1])));
        }
        let (a, at) = self.expr(&args[0], out)?;
        let (b, bt) = self.expr(&args[1], out)?;
        if name == "divmod" {
            if !at.is_numeric() || !bt.is_numeric() {
                return Err(type_error(site, format!("divmod takes two present numbers, got {} and {}", at.name(), bt.name()), "narrow both operands first"));
            }
            let tmp = self.temp("divmod");
            out.push(Stmt::Let { name: tmp.clone(), value: Expr::Builtin { builtin: Builtin::Divmod { remainder_sink: "lexicographic-id".into() }, args: vec![a, b] } });
            out.push(Stmt::Let { name: names[0].clone(), value: ir::field(ir::var(&tmp), "quotient") });
            out.push(Stmt::Let { name: names[1].clone(), value: ir::field(ir::var(&tmp), "remainder") });
            self.declare(&names[0], Ty::Int);
            self.declare(&names[1], Ty::Int);
        } else {
            if !at.comparable(&bt) || at.is_optional() || bt.is_optional() {
                return Err(type_error(site, format!("sorted takes two present values of one type, got {} and {}", at.name(), bt.name()), "narrow both operands first"));
            }
            let ta = self.temp("a");
            let tb = self.temp("b");
            out.push(Stmt::Let { name: ta.clone(), value: a });
            out.push(Stmt::Let { name: tb.clone(), value: b });
            out.push(Stmt::Let { name: names[0].clone(), value: Expr::Builtin { builtin: Builtin::Min, args: vec![ir::var(&ta), ir::var(&tb)] } });
            out.push(Stmt::Let { name: names[1].clone(), value: Expr::Builtin { builtin: Builtin::Max, args: vec![ir::var(&ta), ir::var(&tb)] } });
            let joined = at.join(&bt);
            self.declare(&names[0], joined.clone());
            self.declare(&names[1], joined);
        }
        Ok(())
    }

    /// After `require x != null` or inside `if x != null:`, `x` is present.
    fn narrow(&mut self, condition: &A, then_branch: bool) {
        match condition {
            A::Binary { op, left, right, .. } if op == "and" && then_branch => {
                self.narrow(left, true);
                self.narrow(right, true);
            }
            A::Binary { op, left, right, .. } if (op == "!=") == then_branch && (op == "!=" || op == "=") => {
                let candidate = match (left.as_ref(), right.as_ref()) {
                    (A::Literal { value: Literal::Null, .. }, other) | (other, A::Literal { value: Literal::Null, .. }) => other,
                    _ => return,
                };
                if let A::Name { name, .. } = candidate
                    && let Some(ty) = self.lookup(name).cloned()
                {
                    let required = ty.required();
                    for scope in self.scopes.iter_mut().rev() {
                        if let Some(slot) = scope.get_mut(name) {
                            *slot = required;
                            break;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn loop_domain(&mut self, domain: &A, out: &mut Vec<Stmt>) -> Fallible<(LoopDomain, Ty)> {
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
            A::Name { name, site } if self.scopes[0].contains_key(name) => {
                let ty = self.scopes[0][name].clone();
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

    fn proc_call(&mut self, name: &str, args: &[A], site: &Site, out: &mut Vec<Stmt>) -> Fallible<()> {
        let proc = self.catalog.procs[name].clone();
        if self.depth >= MAX_EXPANSION_DEPTH {
            return Err(unsupported(site, "procs nested deeper than eight levels", "flatten the helper"));
        }
        if args.len() != proc.args.len() {
            return Err(type_error(site, format!("{name} takes {} arguments; received {}", proc.args.len(), args.len()), format!("{name}({})", proc.args.iter().map(|a| a.name.clone()).collect::<Vec<_>>().join(", "))));
        }
        self.push_scope();
        for (declared, given) in proc.args.iter().zip(args) {
            let (expr, ty) = self.expr(given, out)?;
            let expected = Ty::from_scalar(&declared.type_);
            if !ty.assignable_to(&expected) {
                self.pop_scope();
                return Err(type_error(given.site(), format!("{name}'s {} is {}; got {}", declared.name, expected.name(), ty.name()), format!("pass {} for {}", expected.name(), declared.name)));
            }
            let tmp = self.temp(&declared.name);
            out.push(Stmt::Let { name: tmp.clone(), value: expr });
            out.push(Stmt::Let { name: declared.name.clone(), value: ir::var(&tmp) });
            self.declare(&declared.name, expected);
        }
        self.depth += 1;
        let result = (|| {
            for statement in &proc.body {
                self.statement(statement, out, false)?;
            }
            Ok(())
        })();
        self.depth -= 1;
        self.pop_scope();
        result
    }

    // ----- expressions -----

    /// An expression whose value is used (bound, returned, or a final
    /// write): writes yield their row.
    fn value_of(&mut self, value: &A, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        if let A::Write { .. } = value {
            return self.write(value, out, true).map(|opt| opt.expect("a valued write"));
        }
        self.expr(value, out)
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
                Literal::Number(text) => match text.parse::<i64>() {
                    Ok(n) if (snapback4_core::value::I53_MIN..=snapback4_core::value::I53_MAX).contains(&n) => (Expr::Literal(Value::Int(n)), Ty::Int),
                    _ => return Err(type_error(site, "number literals are integers within ±2^53", "use a decimal column with scaled integer minor units")),
                },
                Literal::Bool(b) => (Expr::Literal(Value::Bool(*b)), Ty::Bool),
                Literal::Null => (Expr::Literal(Value::Null), Ty::Null),
            }),
            A::Array { items, .. } => {
                let mut exprs = Vec::new();
                let mut item_ty: Option<Ty> = None;
                for item in items {
                    let (e, t) = self.expr(item, out)?;
                    item_ty = Some(match item_ty { Some(j) => j.join(&t), None => t });
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

    fn name(&mut self, name: &str, site: &Site) -> Fallible<(Expr, Ty)> {
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
                if let Some(ty) = self.lookup(name) {
                    return Ok((ir::var(name), ty.clone()));
                }
                if self.catalog.tables.contains_key(name) {
                    return Err(unknown(site, format!("{name} is a table; a read needs a key or a range"), format!("{name}[key]  -- or: {name}[prefix] first 50 by index")));
                }
                let declared: Vec<&str> = self.scopes.iter().flat_map(|s| s.keys().map(String::as_str)).chain(["viewer", "now", "new"]).collect();
                Err(unknown(site, format!("unknown name {name}"), name_rewrite(name, declared, None)))
            }
        }
    }

    fn member(&mut self, base: Expr, ty: Ty, name: &str, site: &Site) -> Fallible<(Expr, Ty)> {
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
                "width" | "height" | "bytes" | "duration" => Ty::Int,
                "type" => Ty::Text(64),
                _ => return Err(unknown(site, format!("assets have no field {name}"), "id, width, height, bytes, type, duration")),
            },
            other => return Err(type_error(site, format!("{} has no fields", other.name()), "read a row or an object before selecting a field")),
        };
        let result_ty = if ty.is_optional() { field_ty.optional() } else { field_ty };
        Ok((ir::field(base, name), result_ty))
    }

    fn object(&mut self, fields: &[ObjectField], out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        let mut exprs = BTreeMap::new();
        let mut types = BTreeMap::new();
        for field in fields {
            let (e, t) = match &field.value {
                Some(value) => self.expr(value, out)?,
                None => self.name(&field.name, &field.site)?,
            };
            if exprs.insert(field.name.clone(), e).is_some() {
                return Err(unknown(&field.site, format!("duplicate field {}", field.name), "keep one"));
            }
            types.insert(field.name.clone(), t);
        }
        Ok((Expr::Object(exprs), Ty::Object(types)))
    }

    fn binary(&mut self, op: &str, left: &A, right: &A, site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        if op == "??" {
            let (l, lt) = self.expr(left, out)?;
            let tmp = self.temp("or");
            out.push(Stmt::Let { name: tmp.clone(), value: l });
            let mut fallback = Vec::new();
            let (r, rt) = self.expr(right, &mut fallback)?;
            fallback.push(Stmt::Assign { name: tmp.clone(), value: r });
            out.push(Stmt::If { condition: Expr::Binary { op: BinaryOp::Eq, left: Box::new(ir::var(&tmp)), right: Box::new(Expr::Literal(Value::Null)) }, then_body: fallback, else_body: Vec::new() });
            let ty = if rt.is_optional() { lt.required().join(&rt) } else { lt.required().join(&rt).required() };
            return Ok((ir::var(&tmp), ty));
        }
        if op == "/" || op == "%" {
            return Err(unknown(site, "division binds a quotient and a remainder at once", format!("(quotient, remainder) = divmod({}, {})", print::expression(left), print::expression(right))));
        }
        let (l, lt) = self.expr(left, out)?;
        let coerce_right = lt.is_identity();
        let (r, rt) = if coerce_right { self.expr_as_identity(right, out, &lt)? } else { self.expr(right, out)? };
        let (l, lt) = if rt.is_identity() && !lt.is_identity() {
            match (left, &l) {
                (A::Literal { value: Literal::Str(text), .. }, _) => (Expr::Literal(Value::Id(text.clone())), Ty::Id),
                _ => (l, lt),
            }
        } else {
            (l, lt)
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
                    return Err(type_error(site, format!("{op} needs present operands; got {} and {}", lt.name(), rt.name()), format!("narrow first: `if {} != null:`, or `{} ?? 0`", print::expression(if lt.is_optional() { left } else { right }), print::expression(if lt.is_optional() { left } else { right }))));
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
                    ("+", Ty::Time, Ty::Time) | ("*", Ty::Time, _) | ("*", _, Ty::Time) => return Err(type_error(site, "time values add or subtract an int offset; time + time and time * n have no meaning", "subtract two times for an int difference in milliseconds")),
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
            "and" | "or" => {
                if !lt.is_bool() || !rt.is_bool() {
                    return Err(type_error(site, format!("{op} needs bool operands; got {} and {}", lt.name(), rt.name()), "compare each side first"));
                }
                if op == "and" { BinaryOp::And } else { BinaryOp::Or }
            }
            other => return Err(unknown(site, format!("unknown operator {other}"), "use =, !=, <, <=, >, >=, +, -, *, and, or, ??")),
        };
        Ok((Expr::Binary { op: ir_op, left: Box::new(l), right: Box::new(r) }, Ty::Bool))
    }

    /// An expression in an identity position: a text literal becomes an id.
    fn expr_as_identity(&mut self, expr: &A, out: &mut Vec<Stmt>, expected: &Ty) -> Fallible<(Expr, Ty)> {
        if let A::Literal { value: Literal::Str(text), .. } = expr {
            if text.is_empty() {
                return Err(type_error(expr.site(), "an empty text literal cannot be an id", "use a non-empty id literal, or null"));
            }
            return Ok((Expr::Literal(Value::Id(text.clone())), expected.required()));
        }
        self.expr(expr, out)
    }

    fn call(&mut self, name: &str, args: &[A], site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
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
                    return Err(type_error(args[0].site(), format!("count takes a bounded list or page, got {}", t.name()), if matches!(t.required(), Ty::Text(_)) { "for a text length use slice, or store the length" } else { "count a page or a bounded list" }));
                }
                Ok((Expr::Builtin { builtin: Builtin::Count, args: vec![e] }, Ty::Int))
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
                let (e, t) = self.expr(&args[0], out)?;
                let (s, st) = self.expr(&args[1], out)?;
                let (n, nt) = self.expr(&args[2], out)?;
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
                let (a, at) = self.expr(&args[0], out)?;
                let (b, bt) = self.expr(&args[1], out)?;
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
                let (a, at) = self.expr(&args[0], out)?;
                let (list, lt) = self.expr(&args[1], out)?;
                let (r, _) = self.expr(&args[2], out)?;
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
            other => Err(unknown(site, format!("unknown function {other}"), name_rewrite(other, self.catalog.functions.keys().map(String::as_str).chain(["count", "sum", "slice", "min", "max", "tokens", "share", "sort", "divmod", "sorted"]), None))),
        }
    }

    fn fn_call(&mut self, function: &ast::FunctionDecl, args: &[A], site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        if self.depth >= MAX_EXPANSION_DEPTH {
            return Err(unsupported(site, "fns nested deeper than eight levels", "flatten the helper"));
        }
        if args.len() != function.args.len() {
            return Err(type_error(site, format!("{} takes {} arguments; received {}", function.name, function.args.len(), args.len()), format!("{}({})", function.name, function.args.iter().map(|a| a.name.clone()).collect::<Vec<_>>().join(", "))));
        }
        self.push_scope();
        for (declared, given) in function.args.iter().zip(args) {
            let expected = Ty::from_scalar(&declared.type_);
            let (expr, ty) = if expected.is_identity() { self.expr_as_identity(given, out, &expected)? } else { self.expr(given, out)? };
            if !ty.assignable_to(&expected) {
                self.pop_scope();
                return Err(type_error(given.site(), format!("{}'s {} is {}; got {}", function.name, declared.name, expected.name(), ty.name()), format!("pass {} for {}", expected.name(), declared.name)));
            }
            let tmp = self.temp(&declared.name);
            out.push(Stmt::Let { name: tmp.clone(), value: expr });
            self.declare(&declared.name, expected);
            out.push(Stmt::Let { name: declared.name.clone(), value: ir::var(&tmp) });
        }
        self.depth += 1;
        let result = self.expr(&function.body, out);
        self.depth -= 1;
        self.pop_scope();
        result
    }

    // ----- reads -----

    fn read(&mut self, read: &ReadExpr, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        if read.range.is_some() {
            let (scan, take) = self.scan(read, out)?;
            return Ok((Expr::Scan(scan), Ty::Page(read.table.clone(), take)));
        }
        let info = self.table(&read.table, &read.site)?;
        let (point, _) = self.point(read, ReadMode::Point, out)?;
        if let Some(maintain) = &info.maintained {
            // A maintained point read is the typed value: zero when absent.
            let tmp = self.temp("total");
            let zero = Expr::Literal(Value::Int(0));
            out.push(Stmt::Let { name: tmp.clone(), value: Expr::Get(point) });
            out.push(Stmt::If {
                condition: Expr::Binary { op: BinaryOp::Eq, left: Box::new(ir::var(&tmp)), right: Box::new(Expr::Literal(Value::Null)) },
                then_body: vec![Stmt::Assign { name: tmp.clone(), value: zero }],
                else_body: vec![Stmt::Assign { name: tmp.clone(), value: ir::field(ir::var(&tmp), "value") }],
            });
            let ty = info.columns.get("value").map(Ty::from_scalar).unwrap_or(Ty::Int);
            let _ = maintain;
            return Ok((ir::var(&tmp), ty));
        }
        Ok((Expr::Get(point), Ty::Row(read.table.clone()).optional()))
    }

    /// Bind a point read: a full unique key, its index chosen by arity,
    /// names, and types.
    fn point(&mut self, read: &ReadExpr, mode: ReadMode, out: &mut Vec<Stmt>) -> Fallible<(Read, &'a TableInfo)> {
        let info = self.table(&read.table, &read.site)?;
        if read.keys.is_empty() {
            return Err(unknown(&read.site, format!("{}[] reads nothing; a point read needs a key", read.table), format!("{}[id]", read.table)));
        }
        let (keys, index) = self.select_index(info, read, mode, out)?;
        let key = self.order_keys(info, &index, keys)?;
        Ok((Read { site: self.site(), table: read.table.clone(), index: index.name, key, provenance: KeyProvenance::Shape }, info))
    }

    fn scan(&mut self, read: &ReadExpr, out: &mut Vec<Stmt>) -> Fallible<(Scan, u32)> {
        let info = self.table(&read.table, &read.site)?;
        let range = read.range.as_ref().expect("a range read");
        let (keys, index) = self.select_index(info, read, ReadMode::Range, out)?;
        let prefix = self.order_keys(info, &index, keys)?;
        if range.take == 0 {
            return Err(type_error(&range.site, "a page holds at least one row", print::read_expr(&ReadExpr { range: Some(ast::RangeSpec { take: 50, ..range.clone() }), ..read.clone() })));
        }
        let mut after = None;
        if let Some(cursor) = &range.cursor {
            let (e, t) = self.expr(cursor, out)?;
            if !matches!(t.required(), Ty::Cursor) {
                return Err(type_error(cursor.site(), format!("after expects a cursor, got {}", t.name()), "declare c: cursor ? and pass after c"));
            }
            let last = index.columns.last().map(String::as_str);
            if last != Some("id") && !index.unique {
                return Err(unknown(&range.site, format!("index {}.{} cannot carry a cursor: it neither ends in id nor is unique", read.table, index.name), format!("by {}: {}, id", index.name, index.columns.join(", "))));
            }
            after = Some(Box::new(e));
        }
        Ok((
            Scan {
                site: self.site(),
                table: read.table.clone(),
                index: index.name,
                prefix: prefix.into_iter().map(IndexKeyExpr::Scalar).collect(),
                order: if range.order == ast::Order::Asc { Order::Asc } else { Order::Desc },
                take: Bound::Literal(range.take),
                after,
                before: None,
                range: None,
                opaque_cursor: range.cursor.is_some(),
                merge_site: None,
                provenance: KeyProvenance::Shape,
            },
            range.take,
        ))
    }

    /// Evaluate the keys, then choose the index: explicit `by`, else by
    /// key names, count and types. Point reads need a unique full key;
    /// ranges need a strict prefix.
    fn select_index(&mut self, info: &'a TableInfo, read: &ReadExpr, mode: ReadMode, out: &mut Vec<Stmt>) -> Fallible<(Vec<(Option<String>, Expr, Ty)>, ast::IndexDecl)> {
        let point = mode != ReadMode::Range;
        let mut keys = Vec::new();
        for part in &read.keys {
            let expected_column = part.column.clone();
            let (e, t) = match &expected_column {
                Some(column) if column == "id" => self.expr_as_identity(&part.value, out, &Ty::Ref(read.table.clone()))?,
                Some(column) => match info.columns.get(column) {
                    Some(scalar) if Ty::from_scalar(scalar).is_identity() => self.expr_as_identity(&part.value, out, &Ty::from_scalar(scalar))?,
                    _ => self.expr(&part.value, out)?,
                },
                None => self.expr(&part.value, out)?,
            };
            keys.push((expected_column, e, t));
        }
        let named = keys.iter().all(|(c, _, _)| c.is_some()) && !keys.is_empty();
        let mut candidates: Vec<&ast::IndexDecl> = info
            .indexes
            .iter()
            .filter(|index| read.index.as_ref().is_none_or(|explicit| explicit == &index.name))
            .filter(|index| match mode {
                ReadMode::Point => index.unique && index.columns.len() == keys.len(),
                ReadMode::Exists => index.columns.len() == keys.len(),
                ReadMode::Range => index.columns.len() > keys.len(),
            })
            .filter(|index| {
                if named {
                    keys.iter().all(|(c, _, _)| index.columns[..keys.len()].contains(c.as_ref().unwrap()))
                } else {
                    true
                }
            })
            .collect();
        // Positional keys select by type; a text literal may meet an
        // identity column (it becomes an id once the index is chosen).
        if !named {
            candidates.retain(|index| {
                keys.iter().enumerate().all(|(position, (_, e, t))| {
                    index.columns.get(position).is_some_and(|column| {
                        let expected = self.column_ty(info, column);
                        t.comparable(&expected) || (expected.is_identity() && matches!(e, Expr::Literal(Value::String(_))))
                    })
                })
            });
        }
        if let Some(explicit) = &read.index
            && candidates.is_empty()
        {
            let known = info.indexes.iter().find(|i| &i.name == explicit);
            return Err(match known {
                None => unknown(&read.site, format!("{} has no index {explicit}", read.table), name_rewrite(explicit, info.indexes.iter().map(|i| i.name.as_str()), None)),
                Some(index) => type_error(&read.site, format!("{}.{explicit} is over {}; this {} supplies {} key{}", read.table, index.columns.join(", "), if point { "point read" } else { "range" }, keys.len(), if keys.len() == 1 { "" } else { "s" }), if point { format!("{}[{}]", read.table, index.columns.join(", ")) } else { format!("{}[{}] first 50 by {explicit}", read.table, index.columns[..index.columns.len() - 1].join(", ")) }),
            });
        }
        match candidates.len() {
            1 => {
                let index = candidates[0].clone();
                if !named {
                    for (position, (_, e, t)) in keys.iter_mut().enumerate() {
                        if let Some(column) = index.columns.get(position)
                            && self.column_ty(info, column).is_identity()
                            && let Expr::Literal(Value::String(text)) = e
                        {
                            *e = Expr::Literal(Value::Id(text.clone()));
                            *t = Ty::Id;
                        }
                    }
                }
                Ok((keys, index))
            }
            0 => {
                let declared: Vec<String> = info.indexes.iter().map(|i| format!("{} ({})", i.name, i.columns.join(", "))).collect();
                if point {
                    Err(unknown(&read.site, format!("{} has no unique index over {} column{} matching this key; its indexes are {}", read.table, keys.len(), if keys.len() == 1 { "" } else { "s" }, declared.join(", ")), format!("unique by{}: {}", keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "Column".into())).map(|c| title(&c)).collect::<String>(), keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "<column>".into())).collect::<Vec<_>>().join(", "))))
                } else {
                    Err(unknown(&read.site, format!("{} has no index whose prefix takes {} key{}; its indexes are {}", read.table, keys.len(), if keys.len() == 1 { "" } else { "s" }, declared.join(", ")), format!("by by{}: {}, id", keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "Column".into())).map(|c| title(&c)).collect::<String>(), keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "<column>".into())).collect::<Vec<_>>().join(", "))))
                }
            }
            _ => {
                let names: Vec<&str> = candidates.iter().map(|i| i.name.as_str()).collect();
                Err(ambiguous(&read.site, format!("{} has {} indexes matching this key: {}; choose one", read.table, names.len(), names.join(", ")), format!("{} by {}", print::read_expr(read), names[0])))
            }
        }
    }

    fn column_ty(&self, info: &TableInfo, column: &str) -> Ty {
        if column == "id" {
            return Ty::Ref(info.decl.name.clone());
        }
        info.columns.get(column).map(Ty::from_scalar).unwrap_or(Ty::Unknown)
    }

    fn order_keys(&mut self, info: &TableInfo, index: &ast::IndexDecl, keys: Vec<(Option<String>, Expr, Ty)>) -> Fallible<Vec<Expr>> {
        let named = keys.iter().all(|(c, _, _)| c.is_some());
        if !named {
            for (position, (_, _, t)) in keys.iter().enumerate() {
                let expected = self.column_ty(info, &index.columns[position]);
                if !t.comparable(&expected) {
                    return Err(type_error(&index.site, format!("key {} is {}; {}.{}.{} is {}", position + 1, t.name(), info.decl.name, index.name, index.columns[position], expected.name()), format!("use {} for key {}", expected.name(), position + 1)));
                }
            }
            return Ok(keys.into_iter().map(|(_, e, _)| e).collect());
        }
        let mut ordered = Vec::new();
        for column in index.columns.iter().take(keys.len()) {
            let position = keys.iter().position(|(c, _, _)| c.as_deref() == Some(column)).expect("matched");
            let expected = self.column_ty(info, column);
            if !keys[position].2.comparable(&expected) {
                return Err(type_error(&index.site, format!("{column} is {}; {}.{column} is {}", keys[position].2.name(), info.decl.name, expected.name()), format!("use {} for {column}", expected.name())));
            }
            ordered.push(keys[position].1.clone());
        }
        Ok(ordered)
    }

    fn walk(&mut self, table: &str, seed: &A, column: &str, depth: u32, site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Recurse, Ty)> {
        let info = self.table(table, site)?;
        let Some(next) = info.columns.get(column) else {
            return Err(unknown(site, format!("{table} has no column {column}"), name_rewrite(column, info.columns.keys().map(String::as_str), None)));
        };
        if !matches!(next.kind, ast::TypeKind::Ref { table: ref t } if t == table) {
            return Err(type_error(site, format!("walk follows a reference back to {table}; {table}.{column} is {}", print::scalar_type(next)), format!("{column}: {table} ?")));
        }
        if depth == 0 || depth > 64 {
            return Err(unbound_loop(site, "walk depth is between 1 and 64", format!("walk {table}[seed] up .{column} depth 8")));
        }
        let (seed_expr, _) = self.expr_as_identity(seed, out, &Ty::Ref(table.to_owned()))?;
        Ok((Recurse { site: self.site(), table: table.to_owned(), index: "byId".into(), seed: Box::new(seed_expr), next_field: column.to_owned(), depth, fanout: 1, provenance: KeyProvenance::Computed }, Ty::Row(table.to_owned())))
    }

    fn merge(&mut self, merge: &ast::MergeExpr, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        let info = self.table(&merge.table, &merge.site)?;
        let Some(index) = info.indexes.iter().find(|index| index.name == merge.index).cloned() else {
            return Err(unknown(&merge.site, format!("{} has no index {}", merge.table, merge.index), name_rewrite(&merge.index, info.indexes.iter().map(|i| i.name.as_str()), None)));
        };
        let width = merge.lanes.first().map(|lane| lane.prefix.len()).unwrap_or(0);
        if width >= index.columns.len() {
            return Err(type_error(&merge.site, format!("merge lane prefixes must leave at least one {}.{} suffix column", merge.table, merge.index), "drop the last prefix key from every lane"));
        }
        if merge.lanes.iter().any(|lane| lane.prefix.len() != width) {
            return Err(type_error(&merge.site, "merge lanes must have equal-width index prefixes", format!("use {width} prefix key(s) in every lane")));
        }
        let mut cursor_expr = None;
        if let Some(cursor) = &merge.cursor {
            let (e, t) = self.expr(cursor, out)?;
            if !matches!(t.required(), Ty::Cursor) {
                return Err(type_error(cursor.site(), format!("merge after expects a cursor, got {}", t.name()), "declare c: cursor ? and pass after c"));
            }
            cursor_expr = Some(e);
        }
        let merge_site = self.site();
        let order = if merge.order == ast::Order::Asc { Order::Asc } else { Order::Desc };
        let mut lanes = Vec::new();
        for lane in &merge.lanes {
            self.push_scope();
            let mut setup = Vec::new();
            let mut source = None;
            let mut binding = String::new();
            if let Some((name, domain)) = &lane.loop_ {
                let (scan, _) = self.scan(domain, &mut setup)?;
                source = Some(scan);
                binding = name.clone();
                self.declare(name, Ty::Row(domain.table.clone()));
            }
            let read = ReadExpr { table: merge.table.clone(), keys: lane.prefix.iter().enumerate().map(|(position, value)| ast::KeyPart { column: lane.columns.as_ref().and_then(|c| c.get(position).cloned().flatten()), value: value.clone(), site: value.site().clone() }).collect(), index: Some(merge.index.clone()), range: Some(ast::RangeSpec { order: merge.order, take: merge.take, cursor: None, site: lane.site.clone() }), site: lane.site.clone() };
            let (mut scan, _) = self.scan(&read, &mut setup)?;
            self.pop_scope();
            scan.after = cursor_expr.clone().map(Box::new);
            scan.opaque_cursor = cursor_expr.is_some();
            scan.merge_site = Some(merge_site.clone());
            lanes.push(MergeLane { setup, scan, source, binding });
        }
        let _ = order;
        Ok((Expr::Merge(Merge { site: merge_site, lanes }), Ty::Page(merge.table.clone(), merge.take)))
    }

    // ----- shapes -----

    fn shape(&mut self, base: &A, fields: &[ShapeField], site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        let (base_expr, base_ty) = self.expr(base, out)?;
        match base_ty.clone() {
            Ty::Page(table, max) => {
                let list = self.temp("rows");
                out.push(Stmt::Let { name: list.clone(), value: Expr::Array(Vec::new()) });
                let item = self.temp("row");
                let domain = match base_expr {
                    Expr::Scan(scan) => LoopDomain::Page(scan),
                    other => LoopDomain::DerivedArray { value: other, max, bound_source: "page".into() },
                };
                let mut body = Vec::new();
                let (object, object_ty) = self.shape_object(&item, Ty::Row(table.clone()), fields, site, &mut body)?;
                body.push(Stmt::Push { target: list.clone(), value: object });
                out.push(Stmt::For { binding: item, domain, body });
                Ok((ir::var(&list), Ty::Collection(Box::new(object_ty), max)))
            }
            Ty::Collection(item_ty, max) | Ty::List(item_ty, max) => {
                let list = self.temp("items");
                out.push(Stmt::Let { name: list.clone(), value: Expr::Array(Vec::new()) });
                let item = self.temp("item");
                let mut body = Vec::new();
                let (object, object_ty) = self.shape_object(&item, *item_ty, fields, site, &mut body)?;
                body.push(Stmt::Push { target: list.clone(), value: object });
                out.push(Stmt::For { binding: item, domain: LoopDomain::DerivedArray { value: base_expr, max, bound_source: "shape".into() }, body });
                Ok((ir::var(&list), Ty::Collection(Box::new(object_ty), max)))
            }
            Ty::Row(_) | Ty::Object(_) => {
                let row = self.temp("row");
                out.push(Stmt::Let { name: row.clone(), value: base_expr });
                self.shape_object(&row, base_ty, fields, site, out)
            }
            Ty::Optional(inner) if matches!(*inner, Ty::Row(_) | Ty::Object(_)) => {
                let row = self.temp("row");
                out.push(Stmt::Let { name: row.clone(), value: base_expr });
                let result = self.temp("shaped");
                out.push(Stmt::Let { name: result.clone(), value: Expr::Literal(Value::Null) });
                let mut body = Vec::new();
                let (object, object_ty) = self.shape_object(&row, *inner, fields, site, &mut body)?;
                body.push(Stmt::Assign { name: result.clone(), value: object });
                out.push(Stmt::If { condition: Expr::Binary { op: BinaryOp::Ne, left: Box::new(ir::var(&row)), right: Box::new(Expr::Literal(Value::Null)) }, then_body: body, else_body: Vec::new() });
                Ok((ir::var(&result), object_ty.optional()))
            }
            other => Err(type_error(site, format!("a shape applies to a row, an object or a page; got {}", other.name()), "shape a read: `messages[id] { body }`")),
        }
    }

    /// Build the object of a shape over a focal row variable.
    fn shape_object(&mut self, row_var: &str, row_ty: Ty, fields: &[ShapeField], site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        let prior = self.focal.replace((row_var.to_owned(), row_ty.clone()));
        self.push_scope();
        let result = (|| {
            let mut exprs = BTreeMap::new();
            let mut types = BTreeMap::new();
            let mut add = |name: String, e: Expr, t: Ty, site: &Site| -> Fallible<()> {
                if exprs.insert(name.clone(), e).is_some() {
                    return Err(unknown(site, format!("shape repeats field {name}"), "keep one"));
                }
                types.insert(name, t);
                Ok(())
            };
            for field in fields {
                match field {
                    ShapeField::Spread { site } => {
                        for (name, ty) in self.row_fields(&row_ty, site)? {
                            add(name.clone(), ir::field(ir::var(row_var), &name), ty, site)?;
                        }
                    }
                    ShapeField::NamedSpread { name, site } => {
                        let Some(shape) = self.catalog.shapes.get(name).cloned() else {
                            return Err(unknown(site, format!("unknown shape {name}"), name_rewrite(name, self.catalog.shapes.keys().map(String::as_str), None)));
                        };
                        let (nested, nested_ty) = self.shape_object(row_var, row_ty.clone(), &shape.fields, site, out)?;
                        if let (Expr::Object(nested_fields), Ty::Object(nested_types)) = (nested, nested_ty) {
                            for (name, e) in nested_fields {
                                let t = nested_types[&name].clone();
                                add(name, e, t, site)?;
                            }
                        }
                    }
                    ShapeField::Bare { name, site } => {
                        let (e, t) = self.member(ir::var(row_var), row_ty.clone(), name, site)?;
                        add(name.clone(), e, t, site)?;
                    }
                    ShapeField::Field { name, value, site } => {
                        let (e, t) = self.expr(value, out)?;
                        add(name.clone(), e, t, site)?;
                    }
                }
            }
            let _ = site;
            Ok((Expr::Object(exprs), Ty::Object(types)))
        })();
        self.pop_scope();
        self.focal = prior;
        result
    }

    fn row_fields(&self, ty: &Ty, site: &Site) -> Fallible<Vec<(String, Ty)>> {
        match ty.required() {
            Ty::Row(table) => {
                let info = self.table(&table, site)?;
                let mut fields = vec![("id".to_owned(), Ty::Ref(table.clone()))];
                fields.extend(info.columns.iter().map(|(name, scalar)| (name.clone(), Ty::from_scalar(scalar))));
                Ok(fields)
            }
            Ty::Object(fields) => Ok(fields.into_iter().collect()),
            other => Err(type_error(site, format!("* spreads a row or an object; got {}", other.name()), "shape a row")),
        }
    }

    // ----- writes -----

    /// Bind a write. When `valued`, the write yields its row (an insert's
    /// image, an update's or upsert's re-read row, null for a delete).
    fn write(&mut self, expr: &A, out: &mut Vec<Stmt>, valued: bool) -> Fallible<Option<(Expr, Ty)>> {
        let A::Write { op, table, keys, fields, if_absent, condition, site } = expr else { unreachable!() };
        if self.kind == ProgramKind::Query {
            return Err(Diagnostic::new(site, "E_QUARRY_PLACEMENT", format!("queries cannot {}", op.word()), "move the write into a mutation").guide("programs"));
        }
        let info = self.table(table, site)?;
        if info.maintained.is_some() {
            return Err(unknown(site, format!("{table} is a maintained aggregate; write its source rows instead"), format!("{} {}", op.word(), info.maintained.as_ref().map(|m| m.source.clone()).unwrap_or_default())));
        }
        match op {
            WriteOp::Insert => {
                let (row, row_ty) = self.write_row(info, fields, None, site, out)?;
                let tmp = self.temp("inserted");
                out.push(Stmt::Const { name: tmp.clone(), value: row });
                if *if_absent {
                    let result = self.temp("absent");
                    out.push(Stmt::InsertIfAbsent { table: table.clone(), row: ir::var(&tmp), result: result.clone() });
                    return Ok(valued.then(|| (ir::var(&result), row_ty.optional())));
                }
                out.push(Stmt::Insert { table: table.clone(), row: ir::var(&tmp) });
                Ok(valued.then(|| (ir::var(&tmp), row_ty)))
            }
            WriteOp::Update => {
                let key = self.write_key(info, keys, site, out)?;
                let current = self.temp("current");
                if condition.is_some() || key.alternate {
                    out.push(Stmt::Let { name: current.clone(), value: Expr::Get(Read { site: self.site(), table: table.clone(), index: key.index.clone(), key: key.key.clone(), provenance: KeyProvenance::Shape }) });
                    if key.alternate {
                        out.push(Stmt::Require { condition: Expr::Binary { op: BinaryOp::Ne, left: Box::new(ir::var(&current)), right: Box::new(Expr::Literal(Value::Null)) }, code: "NOT_FOUND".into(), site: Some(site.to_string()) });
                    }
                }
                let id_expr = if key.alternate { ir::field(ir::var(&current), "id") } else { key.key[0].clone() };
                let (patch, _) = self.write_row(info, fields, Some(&current), site, out)?;
                if let Some(condition) = condition {
                    let prior = self.focal.replace((current.clone(), Ty::Row(table.clone()).optional()));
                    let mut check_out = Vec::new();
                    let bound = self.expr(condition, &mut check_out);
                    self.focal = prior;
                    let (check, check_ty) = bound?;
                    if !check_ty.is_bool() {
                        return Err(type_error(condition.site(), format!("update's condition must be bool, got {}", check_ty.name()), "update t[key] { body } if .body = expected"));
                    }
                    out.extend(check_out);
                    out.push(Stmt::Check { condition: check, current: Read { site: self.site(), table: table.clone(), index: key.index.clone(), key: key.key.clone(), provenance: KeyProvenance::Shape } });
                }
                out.push(Stmt::Update { table: table.clone(), key: id_expr.clone(), patch });
                if !valued {
                    return Ok(None);
                }
                let result = self.temp("updated");
                out.push(Stmt::Let { name: result.clone(), value: Expr::Get(Read { site: self.site(), table: table.clone(), index: "byId".into(), key: vec![id_expr], provenance: KeyProvenance::Computed }) });
                Ok(Some((ir::var(&result), Ty::Row(table.clone()).optional())))
            }
            WriteOp::Upsert => {
                let key = self.write_key(info, keys, site, out)?;
                let id_var = self.temp("id");
                if key.alternate {
                    let current = self.temp("current");
                    out.push(Stmt::Let { name: current.clone(), value: Expr::Get(Read { site: self.site(), table: table.clone(), index: key.index.clone(), key: key.key.clone(), provenance: KeyProvenance::Shape }) });
                    out.push(Stmt::Let { name: id_var.clone(), value: Expr::Input(Input::NewId) });
                    out.push(Stmt::If { condition: Expr::Binary { op: BinaryOp::Ne, left: Box::new(ir::var(&current)), right: Box::new(Expr::Literal(Value::Null)) }, then_body: vec![Stmt::Assign { name: id_var.clone(), value: ir::field(ir::var(&current), "id") }], else_body: Vec::new() });
                } else {
                    out.push(Stmt::Let { name: id_var.clone(), value: key.key[0].clone() });
                }
                if fields.iter().any(|f| f.name == "id") {
                    return Err(unknown(site, "upsert cannot spell id; the key names the row", print::expression(&A::Write { op: *op, table: table.clone(), keys: keys.clone(), fields: fields.iter().filter(|f| f.name != "id").cloned().collect(), if_absent: false, condition: None, site: site.clone() })));
                }
                let mut with_key = fields.clone();
                for (column, key_expr) in key.named.iter() {
                    if !with_key.iter().any(|f| &f.name == column) {
                        with_key.push(ObjectField { name: column.clone(), value: Some(key_expr.clone()), site: site.clone() });
                    }
                }
                let (row, _) = self.write_row_with_id(info, &with_key, ir::var(&id_var), site, out)?;
                let tmp = self.temp("upserted");
                out.push(Stmt::Const { name: tmp.clone(), value: row });
                out.push(Stmt::Upsert { table: table.clone(), key: ir::var(&id_var), row: ir::var(&tmp) });
                if !valued {
                    return Ok(None);
                }
                let result = self.temp("written");
                out.push(Stmt::Let { name: result.clone(), value: Expr::Get(Read { site: self.site(), table: table.clone(), index: "byId".into(), key: vec![ir::var(&id_var)], provenance: KeyProvenance::Computed }) });
                Ok(Some((ir::var(&result), Ty::Row(table.clone()).optional())))
            }
            WriteOp::Delete => {
                let key = self.write_key(info, keys, site, out)?;
                let id_expr = if key.alternate {
                    let current = self.temp("current");
                    out.push(Stmt::Let { name: current.clone(), value: Expr::Get(Read { site: self.site(), table: table.clone(), index: key.index.clone(), key: key.key.clone(), provenance: KeyProvenance::Shape }) });
                    out.push(Stmt::Require { condition: Expr::Binary { op: BinaryOp::Ne, left: Box::new(ir::var(&current)), right: Box::new(Expr::Literal(Value::Null)) }, code: "NOT_FOUND".into(), site: Some(site.to_string()) });
                    ir::field(ir::var(&current), "id")
                } else {
                    key.key[0].clone()
                };
                out.push(Stmt::Delete { table: table.clone(), key: id_expr });
                Ok(valued.then(|| (Expr::Literal(Value::Null), Ty::Null)))
            }
        }
    }

    fn write_key(&mut self, info: &'a TableInfo, keys: &[ast::KeyPart], site: &Site, out: &mut Vec<Stmt>) -> Fallible<WriteKey> {
        if keys.is_empty() {
            return Err(unknown(site, format!("{} needs a key: which row?", info.decl.name), format!("{}[id]", info.decl.name)));
        }
        // A row value as the key addresses the row by its id.
        if keys.len() == 1 && keys[0].column.is_none() {
            let (e, t) = self.expr(&keys[0].value, out)?;
            if let Ty::Row(table) = t.required()
                && table == info.decl.name
            {
                let id = self.temp("key");
                out.push(Stmt::Let { name: id.clone(), value: ir::field(e, "id") });
                return Ok(WriteKey { index: "byId".into(), key: vec![ir::var(&id)], alternate: false, named: Vec::new() });
            }
        }
        let read = ReadExpr { table: info.decl.name.clone(), keys: keys.to_vec(), index: None, range: None, site: site.clone() };
        let (bound, index) = self.select_index(info, &read, ReadMode::Point, out)?;
        let named: Vec<(String, A)> = keys.iter().enumerate().map(|(position, part)| (part.column.clone().unwrap_or_else(|| index.columns[position].clone()), part.value.clone())).collect();
        let key = self.order_keys(info, &index, bound)?;
        if index.name == "byId" {
            let id = self.temp("key");
            out.push(Stmt::Let { name: id.clone(), value: key[0].clone() });
            return Ok(WriteKey { index: "byId".into(), key: vec![ir::var(&id)], alternate: false, named: Vec::new() });
        }
        Ok(WriteKey { index: index.name, key, alternate: true, named })
    }

    fn write_row(&mut self, info: &'a TableInfo, fields: &[ObjectField], current: Option<&str>, site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        match current {
            None => {
                if fields.iter().any(|f| f.name == "id") {
                    let (given, _) = fields.iter().find(|f| f.name == "id").map(|f| f.value.as_ref().map(|v| self.expr_as_identity(v, out, &Ty::Id)).unwrap_or_else(|| self.name("id", site))).unwrap()?;
                    return self.write_row_with_id(info, &fields.iter().filter(|f| f.name != "id").cloned().collect::<Vec<_>>(), given, site, out);
                }
                self.write_row_with_id(info, fields, Expr::Input(Input::NewId), site, out)
            }
            Some(_) => {
                // A patch: only the named columns, each typed.
                let mut exprs = BTreeMap::new();
                let mut types = BTreeMap::new();
                for field in fields {
                    if field.name == "id" {
                        return Err(unknown(&field.site, "update cannot change id", "remove id from the patch"));
                    }
                    let Some(scalar) = info.columns.get(&field.name) else {
                        return Err(unknown(&field.site, format!("{} has no column {}", info.decl.name, field.name), name_rewrite(&field.name, info.columns.keys().map(String::as_str), None)));
                    };
                    let expected = Ty::from_scalar(scalar);
                    let (e, t) = self.field_value(field, &expected, out)?;
                    if !t.assignable_to(&expected) {
                        return Err(type_error(&field.site, format!("{}.{} is {}; got {}", info.decl.name, field.name, expected.name(), t.name()), format!("write {} into {}", expected.name(), field.name)));
                    }
                    exprs.insert(field.name.clone(), e);
                    types.insert(field.name.clone(), t);
                }
                Ok((Expr::Object(exprs), Ty::Object(types)))
            }
        }
    }

    fn write_row_with_id(&mut self, info: &'a TableInfo, fields: &[ObjectField], id: Expr, site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        let mut exprs = BTreeMap::new();
        exprs.insert("id".to_owned(), id);
        let mut given = std::collections::BTreeSet::new();
        for field in fields {
            let Some(scalar) = info.columns.get(&field.name) else {
                return Err(unknown(&field.site, format!("{} has no column {}", info.decl.name, field.name), name_rewrite(&field.name, info.columns.keys().map(String::as_str), None)));
            };
            let expected = Ty::from_scalar(scalar);
            let (e, t) = self.field_value(field, &expected, out)?;
            if !t.assignable_to(&expected) {
                return Err(type_error(&field.site, format!("{}.{} is {}; got {}", info.decl.name, field.name, expected.name(), t.name()), format!("write {} into {}", expected.name(), field.name)));
            }
            if exprs.insert(field.name.clone(), e).is_some() {
                return Err(unknown(&field.site, format!("field {} is written twice", field.name), "keep one"));
            }
            given.insert(field.name.clone());
        }
        let missing: Vec<&str> = info.columns.iter().filter(|(name, scalar)| !scalar.optional && !given.contains(*name)).map(|(name, _)| name.as_str()).collect();
        if !missing.is_empty() {
            return Err(type_error(site, format!("insert into {} omits required column{} {}", info.decl.name, if missing.len() == 1 { "" } else { "s" }, missing.join(", ")), format!("insert {} {{ {} }}", info.decl.name, given.iter().cloned().chain(missing.iter().map(|m| format!("{m}: <{}>", info.columns.get(*m).map(print::scalar_type).unwrap_or_default()))).collect::<Vec<_>>().join(", "))));
        }
        Ok((Expr::Object(exprs), Ty::Row(info.decl.name.clone())))
    }

    fn field_value(&mut self, field: &ObjectField, expected: &Ty, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        match &field.value {
            Some(value) if expected.required().is_identity() => self.expr_as_identity(value, out, expected),
            Some(value) => {
                let (e, t) = self.expr(value, out)?;
                // A text literal in an enum position is that variant.
                if let (Ty::Enum(variants), Expr::Literal(Value::String(text))) = (expected.required(), &e) {
                    if variants.contains(text) {
                        return Ok((e, Ty::Enum(variants)));
                    }
                    return Err(type_error(value.site(), format!("'{text}' is not one of {}", variants.iter().map(|v| format!("'{v}'")).collect::<Vec<_>>().join(", ")), format!("'{}'", variants.first().cloned().unwrap_or_default())));
                }
                Ok((e, t))
            }
            None => self.name(&field.name, &field.site),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReadMode {
    /// A full unique key: one row.
    Point,
    /// A full key of any index: presence.
    Exists,
    /// A strict prefix: a page.
    Range,
}

struct WriteKey {
    index: String,
    key: Vec<Expr>,
    alternate: bool,
    named: Vec<(String, A)>,
}

fn literal_int(expr: &A) -> Option<i64> {
    match expr {
        A::Literal { value: Literal::Number(text), .. } => text.parse().ok(),
        A::Unary { op, value, .. } if op == "-" => literal_int(value).map(|n| -n),
        _ => None,
    }
}

fn validate_code(site: &Site, code: &str) -> Fallible<()> {
    if code.starts_with("E_") {
        return Err(Diagnostic::new(site, "E_OP_RESERVED", format!("application refusal code {code} uses the reserved E_ namespace"), code.trim_start_matches("E_").to_owned()).guide("programs"));
    }
    if !code.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_') {
        return Err(unknown(site, format!("refusal codes are UPPER_SNAKE words; {code} is not"), code.to_uppercase().replace(|c: char| !c.is_ascii_alphanumeric(), "_")));
    }
    Ok(())
}

fn title(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}
