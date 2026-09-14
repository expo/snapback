//! Lowering one Quarry program to the IR: a scope of typed names, one
//! statement list that expressions may hoist temporaries into, reads that
//! choose their index, writes that read their target once, and shapes that
//! become bounded loops. Every refusal carries the rewrite that would pass.

use super::catalog::{Catalog, TableInfo};
use crate::ast::{self, Expr as A, Literal, ObjectField, ProgramKind, ReadExpr, ShapeField, Stmt as S, WriteOp};
use crate::diag::{Diagnostic, Fallible, Site, ambiguous, name_rewrite, placement, type_error, unbound_loop, unknown, unsupported};
use crate::print;
use crate::types::{Ty, scalar_to_arg};
use snapback4_core::ir::{self, BinaryOp, Bound, Builtin, Expr, IndexKeyExpr, Input, KeyProvenance, LoopDomain, Merge, MergeLane, Order, Program, Read, Recurse, Scan, SortKey, Stmt, UnaryOp};
use snapback4_core::value::Value;
use std::collections::BTreeMap;

mod control;
mod expr;
mod reads;

/// A bound operation: the IR plus the types the client sees.
#[derive(Clone, Debug)]
pub struct BoundProgram {
    pub program: Program,
    pub module: String,
    pub args: Vec<(String, Ty)>,
    pub result: Ty,
    pub notes: Vec<Diagnostic>,
    pub site: Site,
}

pub struct Binder<'a> {
    catalog: &'a Catalog,
    name: String,
    kind: ProgramKind,
    scopes: Vec<BTreeMap<String, Binding>>,
    focal: Option<(String, Ty)>,
    temps: u32,
    sites: u32,
    returns: Vec<Ty>,
    /// Depth of helper expansion, to bound recursion.
    depth: u32,
    /// Enclosing `for` and `chunk` bodies: where `break` may stand.
    loops: u32,
    in_prelude: bool,
    notes: Vec<Diagnostic>,
}

/// Source names are lexical; the IR's flat environment needs a distinct
/// runtime name for each declaration and each helper expansion.
#[derive(Clone, PartialEq, Eq)]
struct Binding {
    runtime: String,
    ty: Ty,
    declared: Ty,
    parameter: bool,
    revision: u32,
}

const MAX_EXPANSION_DEPTH: u32 = 8;
const MENTION_MAX: u32 = 64;

impl<'a> Binder<'a> {
    pub fn bind(catalog: &'a Catalog, module: &str, decl: &ast::ProgramDecl, diagnostics: &mut Vec<Diagnostic>) -> Option<BoundProgram> {
        let mut binder = Binder { catalog, name: decl.name.clone(), kind: decl.kind, scopes: vec![BTreeMap::new()], focal: None, temps: 0, sites: 0, returns: Vec::new(), depth: 0, loops: 0, in_prelude: false, notes: Vec::new() };
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
            binder.scopes[0].insert(arg.name.clone(), Binding { runtime: arg.name.clone(), ty: ty.clone(), declared: ty.clone(), parameter: true, revision: 0 });
            args.insert(arg.name.clone(), scalar_to_arg(&arg.type_));
            arg_types.push((arg.name.clone(), ty));
        }
        if decl.native {
            // The body is the app's Rust (LLP 3000.005): nothing to bind, the
            // module is checked against the declaration by `check`.
            let full_name = super::operation_name(module, &decl.name);
            let (kind, result) = match decl.kind {
                ProgramKind::Query => (ir::ProgramKind::Query, Ty::Json),
                _ => (ir::ProgramKind::Job, Ty::Null),
            };
            return Some(BoundProgram { program: Program { name: full_name, kind, args, read_time_granularity_ms: None, body: Vec::new(), native: true }, module: module.to_owned(), args: arg_types, result, notes: binder.notes, site: decl.site.clone() });
        }
        let mut body = Vec::new();
        let mut failed = false;
        let count = decl.body.len();
        let arguments = binder.scopes.clone();
        for (index, statement) in decl.body.iter().enumerate() {
            if decl.kind == ProgramKind::Job {
                binder.scopes = arguments.clone();
                binder.push_scope();
                binder.in_prelude = true;
                let mut prelude = Vec::new();
                for statement in &decl.prelude {
                    if let Err(diagnostic) = binder.statement(statement, &mut prelude, false) {
                        diagnostics.push(diagnostic);
                        return None;
                    }
                }
                binder.in_prelude = false;
                if !prelude.is_empty() {
                    // @ref LLP 3000.007#5.2 — each sweep carries its prelude as setup in the existing serialized statement vocabulary.
                    body.push(Stmt::If { condition: Expr::Literal(Value::Bool(true)), then_body: prelude, else_body: Vec::new() });
                }
            }
            match binder.statement(statement, &mut body, index + 1 == count) {
                Ok(()) => {
                    // Binding a chunk prefix may hoist setup statements. The
                    // chunk itself is the final statement emitted for this
                    // declaration, so validate that scan directly instead of
                    // zipping the differently-shaped AST and IR vectors.
                    if decl.kind == ProgramKind::Job
                        && let S::For { site, .. } = statement
                        && let Some(Stmt::For { domain: LoopDomain::Page(scan), .. }) = body.last()
                        && let Err(diagnostic) = stable_chunk(catalog, site, scan)
                    {
                        diagnostics.push(diagnostic);
                        failed = true;
                    }
                }
                Err(diagnostic) => {
                    diagnostics.push(diagnostic);
                    failed = true;
                }
            }
        }
        if failed {
            return None;
        }
        // The interpreter returns null when control reaches the end. Include
        // that observable path in the generated result type; a return nested
        // in one branch or in a possibly-empty loop does not cover it.
        if !control::exits(&body) {
            binder.returns.push(Ty::Null);
        }
        let result = binder.returns.iter().fold(None, |joined: Option<Ty>, ty| Some(match joined { Some(j) => j.join(ty), None => ty.clone() })).unwrap_or(Ty::Null);
        let full_name = super::operation_name(module, &decl.name);
        let kind = match decl.kind {
            ProgramKind::Query => ir::ProgramKind::Query,
            ProgramKind::Mutation => ir::ProgramKind::Mutation,
            ProgramKind::Job => ir::ProgramKind::Job,
        };
        Some(BoundProgram { program: Program { name: full_name, kind, args, read_time_granularity_ms: None, body, native: false }, module: module.to_owned(), args: arg_types, result, notes: binder.notes, site: decl.site.clone() })
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
        self.binding(name).map(|binding| &binding.ty)
    }

    fn binding(&self, name: &str) -> Option<&Binding> {
        self.scopes.iter().rev().find_map(|scope| scope.get(name))
    }

    fn declare(&mut self, name: &str, ty: Ty) -> String {
        let runtime = if name.starts_with('$') { name.to_owned() } else { self.temp(name) };
        self.scopes.last_mut().expect("a scope").insert(name.to_owned(), Binding { runtime: runtime.clone(), declared: ty.clone(), ty, parameter: false, revision: 0 });
        runtime
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
        if !read.seeks.is_empty() { return Err(type_error(&read.site, "a seek needs a bounded page", "t[prefix, col >= start] first 50 by index")); }
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
        let (read, filter) = self.scan_filter(read, &index)?;
        let read = &read;
        // Key expressions precede the seek bounds and cursor, including their setup.
        let prefix: Vec<Expr> = prefix.into_iter().map(|value| self.snapshot(value, out)).collect();
        let seek = self.seek(info, read, &index, out)?;
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
        let mut prefix: Vec<IndexKeyExpr> = prefix.into_iter().map(IndexKeyExpr::Scalar).collect();
        if let Some(matching) = &read.matching {
            // The search text follows the keys as the word term; the index
            // was chosen for its words component in exactly that position.
            let (e, t) = self.expr(matching, out)?;
            if !matches!(t, Ty::Text(_)) {
                let rewrite = if matches!(t, Ty::Optional(ref inner) if matches!(**inner, Ty::Text(_))) { format!("{} ?? ''", print::expression(matching)) } else { "matching q  -- with q: text <=100".to_owned() };
                return Err(type_error(matching.site(), format!("matching takes present text, got {}", t.name()), rewrite));
            }
            prefix.push(IndexKeyExpr::WordPrefix(e));
        }
        Ok((
            Scan {
                site: self.site(),
                table: read.table.clone(),
                index: index.name,
                prefix,
                order: if range.order == ast::Order::Asc { Order::Asc } else { Order::Desc },
                take: Bound::Literal(range.take),
                after,
                before: None,
                range: seek,
                filter,
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
        super::validate_key_names(read)?;
        let point = mode != ReadMode::Range;
        let mut keys = Vec::<(Option<String>, Expr, Ty)>::new();
        for part in &read.keys {
            let expected_column = part.column.clone();
            let mut setup = Vec::new();
            let (e, t) = match &expected_column {
                Some(column) if column == "id" => self.expr_as_identity(&part.value, &mut setup, &Ty::Ref(read.table.clone()))?,
                Some(column) => match info.columns.get(column) {
                    Some(scalar) if Ty::from_scalar(scalar).is_identity() => self.expr_as_identity(&part.value, &mut setup, &Ty::from_scalar(scalar))?,
                    _ => self.expr(&part.value, &mut setup)?,
                },
                None => self.expr(&part.value, &mut setup)?,
            };
            self.sequence_setup(keys.iter_mut().map(|(_, e, _)| e), setup, out);
            let e = if expr::allocates(&e) { self.snapshot(e, out) } else { e };
            keys.push((expected_column, e, t));
        }
        let named = keys.iter().all(|(c, _, _)| c.is_some()) && !keys.is_empty();
        // A `words(..)` index serves one read: `matching` with exactly its
        // leading columns as keys. Every other read sees plain indexes only.
        let searching = mode == ReadMode::Range && read.matching.is_some();
        let mut candidates: Vec<&ast::IndexDecl> = info
            .indexes
            .iter()
            .filter(|index| read.index.as_ref().is_none_or(|explicit| explicit == &index.name))
            .filter(|index| read.seeks.iter().all(|b| index.columns.get(keys.len()) == Some(&b.column)))
            .filter(|index| if searching { index.searches_after(keys.len()) } else { index.is_plain() })
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
                Some(index) if index.words.is_some() && !searching => unknown(&read.site, format!("{}.{explicit} is a words index; it is read with matching", read.table), format!("{}[{}] matching q first 50 by {explicit}", read.table, index.columns[..index.words.as_ref().map_or(0, |(p, _)| *p)].join(", "))),
                Some(index) if searching => unknown(&read.site, format!("{}.{explicit} has its words after {} column{}; matching takes exactly those as keys", read.table, index.words.as_ref().map_or(0, |(p, _)| *p), if index.words.as_ref().map_or(0, |(p, _)| *p) == 1 { "" } else { "s" }), format!("{}[{}] matching q first 50 by {explicit}", read.table, index.columns[..index.words.as_ref().map_or(0, |(p, _)| *p)].join(", "))),
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
                if searching {
                    let scope: Vec<String> = keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "<column>".into())).collect();
                    Err(unknown(&read.site, format!("{} has no words index after {} key{}; its indexes are {}", read.table, keys.len(), if keys.len() == 1 { "" } else { "s" }, declared.join(", ")), format!("by by{}Words: {}words(<text column>), at, id", scope.iter().map(|c| title(c)).collect::<String>(), scope.iter().map(|c| format!("{c}, ")).collect::<String>())))
                } else if point {
                    Err(unknown(&read.site, format!("{} has no unique index over {} column{} matching this key; its indexes are {}", read.table, keys.len(), if keys.len() == 1 { "" } else { "s" }, declared.join(", ")), format!("unique by{}: {}", keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "Column".into())).map(|c| title(&c)).collect::<String>(), keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "<column>".into())).collect::<Vec<_>>().join(", "))))
                } else {
                    Err(unknown(&read.site, format!("{} has no index whose prefix takes {} key{}; its indexes are {}", read.table, keys.len(), if keys.len() == 1 { "" } else { "s" }, declared.join(", ")), format!("by by{}: {}, id", keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "Column".into())).map(|c| title(&c)).collect::<String>(), keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "<column>".into())).collect::<Vec<_>>().join(", "))))
                }
            }
            _ => {
                // Two candidates whose columns merely compare with the keys
                // (an `id` beside a reference): the one whose column types
                // are the keys' types is the one meant.
                if !named {
                    let exact: Vec<&ast::IndexDecl> = candidates.iter().copied().filter(|index| keys.iter().enumerate().all(|(position, (_, _, t))| index.columns.get(position).is_some_and(|column| self.column_ty(info, column) == t.required()))).collect();
                    if exact.len() == 1 {
                        let index = exact[0].clone();
                        return Ok((keys, index));
                    }
                }
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
            let Some(position) = keys.iter().position(|(c, _, _)| c.as_deref() == Some(column)) else {
                return Err(unknown(&index.site, format!("key omits column {column} of {}.{}", info.decl.name, index.name), format!("name each prefix column once: {}", index.columns.iter().take(keys.len()).cloned().collect::<Vec<_>>().join(", "))));
            };
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
        if !index.is_plain() {
            return Err(unsupported(&merge.site, "merge over a words index", format!("read {}[..] matching q first {} by {} per lane, or on the device over synced rows", merge.table, merge.take, merge.index)));
        }
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
                binding = self.declare(name, Ty::Row(domain.table.clone()));
            }
            let read = ReadExpr { table: merge.table.clone(), keys: lane.prefix.iter().enumerate().map(|(position, value)| ast::KeyPart { column: lane.columns.as_ref().and_then(|c| c.get(position).cloned().flatten()), value: value.clone(), site: value.site().clone() }).collect(), index: Some(merge.index.clone()), range: Some(ast::RangeSpec { order: merge.order, take: merge.take, cursor: None, site: lane.site.clone() }), matching: None, filter: None, seeks: Vec::new(), site: lane.site.clone() };
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
            Ty::Row(_) | Ty::Object(_) | Ty::RowShape(_) => {
                let row = self.temp("row");
                out.push(Stmt::Let { name: row.clone(), value: base_expr });
                self.shape_object(&row, base_ty, fields, site, out)
            }
            Ty::Optional(inner) if matches!(*inner, Ty::Row(_) | Ty::Object(_) | Ty::RowShape(_)) => {
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
            let mut exprs = Vec::<(String, Expr)>::new();
            let mut types = BTreeMap::new();
            let mut add = |binder: &mut Self, name: String, e: Expr, t: Ty, site: &Site, setup: Vec<Stmt>, out: &mut Vec<Stmt>| -> Fallible<()> {
                binder.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
                let e = if expr::allocates(&e) { binder.snapshot(e, out) } else { e };
                if types.contains_key(&name) {
                    return Err(unknown(site, format!("shape repeats field {name}"), "keep one"));
                }
                exprs.push((name.clone(), e));
                types.insert(name, t);
                Ok(())
            };
            for field in fields {
                match field {
                    ShapeField::Spread { site } => {
                        for (name, ty) in self.row_fields(&row_ty, site)? {
                            add(self, name.clone(), ir::field(ir::var(row_var), &name), ty, site, Vec::new(), out)?;
                        }
                    }
                    ShapeField::NamedSpread { name, site } => {
                        let Some(shape) = self.catalog.shapes.get(name).cloned() else {
                            return Err(unknown(site, format!("unknown shape {name}"), name_rewrite(name, self.catalog.shapes.keys().map(String::as_str), None)));
                        };
                        let mut setup = Vec::new();
                        let (nested, nested_ty) = self.shape_object(row_var, row_ty.clone(), &shape.fields, site, &mut setup)?;
                        if let (Expr::Object(nested_fields) | Expr::Shape { fields: nested_fields, .. }, Ty::Object(nested_types) | Ty::RowShape(nested_types)) = (nested, nested_ty) {
                            for (name, e) in nested_fields {
                                let t = nested_types[&name].clone();
                                add(self, name, e, t, site, std::mem::take(&mut setup), out)?;
                            }
                        }
                    }
                    ShapeField::Bare { name, site } => {
                        let (e, t) = self.member(ir::var(row_var), row_ty.clone(), name, site)?;
                        add(self, name.clone(), e, t, site, Vec::new(), out)?;
                    }
                    ShapeField::Field { name, value, site } => {
                        let mut setup = Vec::new();
                        let (e, t) = self.expr(value, &mut setup)?;
                        add(self, name.clone(), e, t, site, setup, out)?;
                    }
                }
            }
            let _ = site;
            let fields = exprs.into_iter().collect();
            if matches!(row_ty, Ty::Row(_) | Ty::RowShape(_)) {
                if types.contains_key("pending") { return Err(type_error(site, "pending is the device's row metadata", "omit pending from the shape; it is preserved from the row")); }
                Ok((Expr::Shape { base: Box::new(ir::var(row_var)), fields }, Ty::RowShape(types)))
            } else { Ok((Expr::Object(fields), Ty::Object(types))) }
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
            Ty::Object(fields) | Ty::RowShape(fields) => Ok(fields.into_iter().collect()),
            other => Err(type_error(site, format!("* spreads a row or an object; got {}", other.name()), "shape a row")),
        }
    }

    // ----- writes -----

    /// Bind a write. When `valued`, the write yields its row (an insert's
    /// image, an update's or upsert's re-read row, null for a delete).
    fn write(&mut self, expr: &A, out: &mut Vec<Stmt>, valued: bool) -> Fallible<Option<(Expr, Ty)>> {
        let A::Write { op, table, keys, fields, if_absent, condition, site } = expr else { unreachable!() };
        if self.in_prelude {
            return Err(placement(site, "a write belongs to a chunk", format!("move {} {table} into the chunk body", op.word())));
        }
        if self.kind == ProgramKind::Query {
            return Err(Diagnostic::new(site, "E_QUARRY_PLACEMENT", format!("queries cannot {} {table}", op.word()), "move the write into a mutation").guide("programs"));
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
                let (patch, _) = self.write_row(info, &with_key, Some("patch"), site, out)?;
                let Expr::Object(mut fields) = patch else { unreachable!("a typed patch is an object") };
                fields.insert("id".into(), ir::var(&id_var));
                let row = Expr::Object(fields);
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
            let mut row_setup = Vec::new();
            let (e, t) = self.expr(&keys[0].value, &mut row_setup)?;
            if let Ty::Row(table) = t.required()
                && table == info.decl.name
            {
                out.extend(row_setup);
                let id = self.temp("key");
                out.push(Stmt::Let { name: id.clone(), value: ir::field(e, "id") });
                return Ok(WriteKey { index: "byId".into(), key: vec![ir::var(&id)], alternate: false, named: Vec::new() });
            }
        }
        let read = ReadExpr { table: info.decl.name.clone(), keys: keys.to_vec(), index: None, range: None, matching: None, filter: None, seeks: Vec::new(), site: site.clone() };
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
                let mut exprs = Vec::<(String, Expr)>::new();
                let mut types = BTreeMap::new();
                for field in fields {
                    if field.name == "id" {
                        return Err(unknown(&field.site, "update cannot change id", "remove id from the patch"));
                    }
                    let Some(scalar) = info.columns.get(&field.name) else {
                        return Err(unknown(&field.site, format!("{} has no column {}", info.decl.name, field.name), name_rewrite(&field.name, info.columns.keys().map(String::as_str), None)));
                    };
                    let expected = Ty::from_scalar(scalar);
                    let mut setup = Vec::new();
                    let (e, t) = self.field_value(field, &expected, &mut setup)?;
                    self.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
                    if !t.writable_to(&expected) {
                        return Err(type_error(&field.site, format!("{}.{} is {}; got {}", info.decl.name, field.name, expected.name(), t.name()), format!("write {} into {}", expected.name(), field.name)));
                    }
                    let e = if expr::allocates(&e) { self.snapshot(e, out) } else { e };
                    exprs.push((field.name.clone(), e));
                    if types.insert(field.name.clone(), t).is_some() {
                        return Err(unknown(&field.site, format!("field {} is written twice", field.name), "keep one"));
                    }
                }
                Ok((Expr::Object(exprs.into_iter().collect()), Ty::Object(types)))
            }
        }
    }

    fn write_row_with_id(&mut self, info: &'a TableInfo, fields: &[ObjectField], id: Expr, site: &Site, out: &mut Vec<Stmt>) -> Fallible<(Expr, Ty)> {
        let id = self.snapshot(id, out);
        let mut exprs = vec![("id".to_owned(), id)];
        let mut given = std::collections::BTreeSet::new();
        for field in fields {
            let Some(scalar) = info.columns.get(&field.name) else {
                return Err(unknown(&field.site, format!("{} has no column {}", info.decl.name, field.name), name_rewrite(&field.name, info.columns.keys().map(String::as_str), None)));
            };
            let expected = Ty::from_scalar(scalar);
            let mut setup = Vec::new();
            let (e, t) = self.field_value(field, &expected, &mut setup)?;
            self.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
            if !t.writable_to(&expected) {
                return Err(type_error(&field.site, format!("{}.{} is {}; got {}", info.decl.name, field.name, expected.name(), t.name()), format!("write {} into {}", expected.name(), field.name)));
            }
            let e = if expr::allocates(&e) { self.snapshot(e, out) } else { e };
            if !given.insert(field.name.clone()) {
                return Err(unknown(&field.site, format!("field {} is written twice", field.name), "keep one"));
            }
            exprs.push((field.name.clone(), e));
        }
        // Materialize the same defaults in the insert expression so its returned row is the written image.
        for column in &info.decl.columns {
            if !given.contains(&column.name) && let Some(default) = &column.default {
                let default = super::defaults::column(column, default)?;
                let value = match default {
                    snapback4_core::schema::ColumnDefault::Literal(value) => Expr::Literal(value),
                    snapback4_core::schema::ColumnDefault::Now => Expr::Input(Input::Now),
                    snapback4_core::schema::ColumnDefault::Viewer => Expr::Input(Input::Viewer),
                };
                exprs.push((column.name.clone(), value));
                given.insert(column.name.clone());
            }
        }
        let missing: Vec<&str> = info.columns.iter().filter(|(name, scalar)| !scalar.optional && !given.contains(*name)).map(|(name, _)| name.as_str()).collect();
        if !missing.is_empty() {
            return Err(type_error(site, format!("insert into {} omits required column{} {}", info.decl.name, if missing.len() == 1 { "" } else { "s" }, missing.join(", ")), format!("insert {} {{ {} }}", info.decl.name, given.iter().cloned().chain(missing.iter().map(|m| format!("{m}: <{}>", info.columns.get(*m).map(print::scalar_type).unwrap_or_default()))).collect::<Vec<_>>().join(", "))));
        }
        Ok((Expr::Object(exprs.into_iter().collect()), Ty::Row(info.decl.name.clone())))
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

/// A sweep continues across commits from a cursor, so no write may move an
/// unvisited row across it: every column of the chunk's index is `id` or
/// declared `immutable` (LLP 1016 §4 D2).
fn stable_chunk(catalog: &Catalog, site: &Site, scan: &Scan) -> Fallible<()> {
    let Some(info) = catalog.tables.get(&scan.table) else { return Ok(()) };
    let Some(index) = info.indexes.iter().find(|index| index.name == scan.index) else { return Ok(()) };
    let immutable: Vec<&str> = info.decl.immutable.iter().flat_map(|(columns, _)| columns.iter().map(String::as_str)).collect();
    let moving: Vec<&str> = index.columns.iter().map(String::as_str).filter(|column| *column != "id" && !immutable.contains(column)).collect();
    if !moving.is_empty() {
        return Err(Diagnostic::new(site, "E_JOB_CURSOR_INDEX", format!("chunk over {}.{} sweeps by {}, which a write could change under the cursor; a sweep's index columns are id or immutable", scan.table, scan.index, moving.join(", ")), format!("immutable {}  -- on table {}, or sweep by byId", moving.join(", "), scan.table)).guide("jobs"));
    }
    Ok(())
}
