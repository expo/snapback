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
mod pure_calls;
mod flow;
mod conditional;
mod joins;
mod returned_shapes;
mod diagnostics;
mod constraints;
mod expr;
mod extrema;
mod objects;
mod write_keys;
mod reads;
mod prefix;
mod lanes;
mod views;
pub(crate) mod setup;

/// A bound operation: the IR plus the types the client sees.
#[derive(Clone, Debug)]
pub struct BoundProgram {
    /// Source statement ownership stays beside flat IR, like diagnostic sites.
    pub(crate) statement_ends: Vec<usize>,
    pub view_types: BTreeMap<String, Ty>,
    pub(crate) filters: BTreeMap<String, String>,
    /// Whole-domain consumers for diagnostics only; absent from IR/wire.
    pub(crate) constraint_domains: std::collections::BTreeSet<String>,
    pub(crate) sources: BTreeMap<String, (Site, String)>,
    /// Source-table pages before binding filters, for executable horizon repairs only.
    pub(crate) page_sources: BTreeMap<String, ReadExpr>,
    pub(crate) canonical_sources: BTreeMap<String, String>,
    pub(crate) selections: BTreeMap<String, String>,
    /// Scan sites the compiler generated for a timeline read: the only scans whose
    /// filter is exactly the platform's retirement check.
    pub(crate) timeline_scans: std::collections::BTreeSet<String>,
    pub program: Program,
    pub(crate) presence: Option<snapback4_core::schema::Execution>,
    pub module: String,
    pub args: Vec<(String, Ty)>,
    pub result: Ty,
    pub notes: Vec<Diagnostic>,
    pub site: Site,
    /// Job helpers with non-uniform meter reads; diagnostic context only, never IR/wire.
    pub job_bound_helpers: std::collections::BTreeSet<String>,
}

impl BoundProgram {
    pub fn filter_source(&self, site: &str) -> Option<&str> { self.filters.get(site).map(String::as_str) }
    pub fn domain_source(&self, site: &str) -> Option<&str> { self.sources.get(&format!("domain/{site}")).map(|(_, text)| text.as_str()) }
    pub fn loop_source(&self, binding: &str) -> Option<&str> { self.sources.get(&format!("for/{binding}")).map(|(_, text)| text.as_str()) }
    pub fn selections(&self) -> &BTreeMap<String, String> { &self.selections }
    /// Whether the scan at `site` is a timeline read's own expansion, not an authored scan.
    pub fn timeline_scan(&self, site: &str) -> bool { self.timeline_scans.contains(site) }
    /// The actual binder choice, shared by `why` and structural cost reports.
    pub fn selection(&self, site: &str) -> Option<&str> { self.selections.get(site).map(String::as_str) }
}

#[derive(Clone)]
pub struct Binder<'a> {
    pure_functions: BTreeMap<String, bool>,
    call_types: BTreeMap<Vec<String>, Ty>,
    filters: BTreeMap<String, String>,
    view_types: BTreeMap<String, Ty>,
    constraint_domains: std::collections::BTreeSet<String>,
    sources: BTreeMap<String, (Site, String)>,
    page_sources: BTreeMap<String, ReadExpr>,
    canonical_sources: BTreeMap<String, String>,
    selections: BTreeMap<String, String>,
    presence_sources: Vec<(Expr, Site, String)>,
    catalog: &'a Catalog,
    schema: &'a snapback4_core::schema::Schema,
    name: String,
    kind: ProgramKind,
    caller_kind: ProgramKind,
    /// Diagnostic-only caller path; helpers never change execution authority.
    call_chain: Vec<(String, Site)>,
    job_bound_helpers: std::collections::BTreeSet<String>,
    scopes: Vec<BTreeMap<String, Binding>>,
    focal: Option<(String, Ty)>,
    /// Only direct scanned-row columns get false-on-null ordering in where.
    in_predicate: bool,
    variants: Vec<(String, bool)>,
    temps: u32,
    sites: u32,
    returns: Vec<(Ty, A)>,
    /// Depth of helper expansion, to bound recursion.
    depth: u32,
    /// Enclosing `for` and `chunk` bodies: where `break` may stand.
    loops: u32,
    /// Enclosing caller loops affect placement, but never helper-local jumps.
    caller_loops: u32,
    in_prelude: bool,
    record_ownership: bool,
    /// The feed table and source site of the timeline read being expanded, while
    /// it is: the generated scan carries that read's own site.
    expanding_feed: Option<(String, Site)>,
    timeline_scans: std::collections::BTreeSet<String>,
    notes: Vec<Diagnostic>,
    errors: Vec<Diagnostic>,
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
    fields: BTreeMap<Vec<String>, Ty>,
    /// An invalid binding retains its original cause; its unknown type never escapes compilation.
    error: Option<Diagnostic>,
    /// Original operands for a diagnostic rewrite, never type or runtime provenance.
    origins: Vec<(Ty, A)>,
}

const MAX_EXPANSION_DEPTH: u32 = 8;
const MENTION_MAX: u32 = 64;

impl<'a> Binder<'a> {
    pub fn bind(catalog: &'a Catalog, schema: &'a snapback4_core::schema::Schema, module: &str, decl: &ast::ProgramDecl, diagnostics: &mut Vec<Diagnostic>) -> Option<BoundProgram> {
        Self::bind_with_ownership(catalog, schema, module, decl, diagnostics, true)
    }

    /// Differential-test control: lowering is identical with the side map disabled.
    #[doc(hidden)]
    pub fn bind_with_ownership(catalog: &'a Catalog, schema: &'a snapback4_core::schema::Schema, module: &str, decl: &ast::ProgramDecl, diagnostics: &mut Vec<Diagnostic>, record_ownership: bool) -> Option<BoundProgram> {
        let mut binder = Binder { pure_functions: BTreeMap::new(), call_types: BTreeMap::new(), page_sources: BTreeMap::new(), canonical_sources: BTreeMap::new(), constraint_domains: Default::default(), filters: BTreeMap::new(), variants: Vec::new(), view_types: BTreeMap::new(), sources: BTreeMap::new(), selections: BTreeMap::new(), presence_sources: Vec::new(), catalog, schema, name: decl.name.clone(), kind: decl.kind, caller_kind: decl.kind, call_chain: Vec::new(), job_bound_helpers: Default::default(), scopes: vec![BTreeMap::new()], focal: None, in_predicate: false, temps: 0, sites: 0, returns: Vec::new(), depth: 0, loops: 0, caller_loops: 0, in_prelude: false, record_ownership, expanding_feed: None, timeline_scans: Default::default(), notes: Vec::new(), errors: Vec::new() };
        binder.call_chain.push((super::operation_name(module, &decl.name), decl.site.clone()));
        binder.declare(pure_calls::CONSTANTS, Ty::Null);
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
            binder.scopes[0].insert(arg.name.clone(), Binding { runtime: arg.name.clone(), ty: ty.clone(), declared: ty.clone(), parameter: true, revision: 0, fields: BTreeMap::new(), error: None, origins: Vec::new() });
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
            return Some(BoundProgram { statement_ends: Vec::new(), page_sources: binder.page_sources, canonical_sources: binder.canonical_sources, constraint_domains: binder.constraint_domains, filters: binder.filters, view_types: binder.view_types, selections: binder.selections, sources: binder.sources, timeline_scans: binder.timeline_scans, program: Program { name: full_name, kind, args, read_time_granularity_ms: None, body: Vec::new(), native: true, returned_shapes: Default::default() }, presence: None, module: module.to_owned(), args: arg_types, result, notes: binder.notes, site: decl.site.clone(), job_bound_helpers: binder.job_bound_helpers });
        }
        let mut body = setup::Body::default();
        let mut shape_candidates = Vec::new();
        let mut statement_ends = Vec::new();
        let mut failed = false;
        let count = decl.body.len();
        let arguments = binder.scopes.clone();
        for (index, statement) in decl.body.iter().enumerate() {
            if decl.kind == ProgramKind::Job {
                binder.scopes = arguments.clone();
                binder.push_scope();
                binder.in_prelude = true;
                let mut prelude = setup::Body::default();
                for statement in &decl.prelude {
                    if let Err(diagnostic) = binder.statement(statement, &mut prelude, false) {
                        binder.record_error(diagnostic);
                        binder.append_errors(diagnostics);
                        return None;
                    }
                }
                binder.in_prelude = false;
                if !prelude.is_empty() {
                    // @ref LLP 3000.007#5.2 — each sweep carries its prelude as setup in the existing serialized statement vocabulary.
                    body.push_if(Expr::Literal(Value::Bool(true)), prelude, setup::Body::default());
                }
            }
            match binder.statement(statement, &mut body, index + 1 == count) {
                Ok(()) => {
                    if decl.kind == ProgramKind::Query && let S::Return { value: A::Shape { base, .. }, .. } = statement
                        && matches!(base.as_ref(), A::Read(_) | A::Merge(_) | A::Name { .. }) {
                        shape_candidates.push(body.len().saturating_sub(2));
                    }
                    // Binding a chunk prefix may hoist setup statements. The
                    // chunk itself is the final statement emitted for this
                    // declaration, so validate that scan directly instead of
                    // zipping the differently-shaped AST and IR vectors.
                    if decl.kind == ProgramKind::Job && let S::For { site, .. } = statement
                        && !matches!(body.last(), Some(Stmt::For { domain: LoopDomain::Page(_), .. })) {
                        diagnostics.push(placement(site, "a job sweep needs a table or prefix domain", "for row in table:"));
                        failed = true;
                    }
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
                    binder.record_error(diagnostic);
                    failed = true;
                }
            }
            // @ref LLP 3000.025#3-proposed-rule — include payload and helper setup in the enclosing source statement.
            statement_ends.push(body.len());
        }
        if failed {
            binder.append_errors(diagnostics);
            return None;
        }
        // The interpreter returns null when control reaches the end. Include
        // that observable path in the generated result type; a return nested
        // in one branch or in a possibly-empty loop does not cover it.
        if !control::exits(&body) {
            binder.returns.push((Ty::Null, A::Literal { value: Literal::Null, site: decl.site.clone() }));
        }
        let result = match binder.return_type() {
            Ok(ty) => ty,
            Err(error) => { diagnostics.push(error); return None; }
        };
        let full_name = super::operation_name(module, &decl.name);
        let kind = match decl.kind {
            ProgramKind::Query => ir::ProgramKind::Query,
            ProgramKind::Mutation => ir::ProgramKind::Mutation,
            ProgramKind::Job => ir::ProgramKind::Job,
        };
        let ownership = body.ownership;
        let returned_shapes = returned_shapes::marks(&body.code, &full_name, &shape_candidates);
        let program = Program { name: full_name, kind, args, read_time_granularity_ms: None, body: body.code, native: false, returned_shapes };
        let presence = if kind == ir::ProgramKind::Mutation {
            Some(super::residency::presence_facts(schema, &program, &ownership, &binder.presence_sources))
        } else { None };
        Some(BoundProgram { statement_ends, page_sources: binder.page_sources, canonical_sources: binder.canonical_sources, constraint_domains: binder.constraint_domains, filters: binder.filters, view_types: binder.view_types, selections: binder.selections, sources: binder.sources, timeline_scans: binder.timeline_scans, program, presence, module: module.to_owned(), args: arg_types, result, notes: binder.notes, site: decl.site.clone(), job_bound_helpers: binder.job_bound_helpers })
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
        self.scopes.last_mut().expect("a scope").insert(name.to_owned(), Binding { runtime: runtime.clone(), declared: ty.clone(), ty, parameter: false, revision: 0, fields: BTreeMap::new(), error: None, origins: Vec::new() });
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

    fn read(&mut self, read: &ReadExpr, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        if let Some(timeline) = self.schema.timelines.iter().find(|timeline| timeline.name == read.table) {
            let expanded = if let Some(plan) = self.catalog.feed_views.get(&read.table) {
                super::feed_view::read(timeline, plan, read)?
            } else { super::timeline::read(timeline, read)? };
            // @ref LLP 3000.013#14.4 — the scale certificate trusts only the scan this expansion generates.
            let outer = self.expanding_feed.replace((timeline.table("Feed"), read.site.clone()));
            let bound = self.expr(&expanded, out);
            self.expanding_feed = outer;
            return bound;
        }
        if let Some(shaped) = self.page_shape(read) { return self.expr(&shaped, out); }
        if self.is_page(read, ReadMode::FilteredPoint)? {
            let (scan, take) = self.scan(read, out)?;
            return Ok((Expr::Scan(scan), Ty::Page(read.table.clone(), take)));
        }
        let info = self.table(&read.table, &read.site)?;
        if let Some(maintain) = &info.maintained {
            if read.keys.len() != maintain.by.len() || read.keys.iter().filter_map(|key| key.column.as_ref()).any(|column| !maintain.by.contains(column)) {
                return Err(super::maintains::refusal(&read.site, format!("{} scalar lookup needs the complete group key: {}", read.table, maintain.by.join(", ")), format!("supply every group key, or page the view: {} first 20 by .id after c", read.table)));
            }
        }
        let value = self.read_value(read, ReadMode::FilteredPoint, out)?;
        if let Some(maintain) = &info.maintained {
            // A maintained point read is the typed value: zero when absent.
            let tmp = self.temp("total");
            let zero = Expr::Literal(Value::Int(0));
            out.push(Stmt::Let { name: tmp.clone(), value });
            out.push(Stmt::If {
                condition: Expr::Binary { op: BinaryOp::Eq, left: Box::new(ir::var(&tmp)), right: Box::new(Expr::Literal(Value::Null)) },
                then_body: vec![Stmt::Assign { name: tmp.clone(), value: zero }],
                else_body: vec![Stmt::Assign { name: tmp.clone(), value: ir::field(ir::var(&tmp), "value") }],
            });
            let ty = info.columns.get("value").map(Ty::from_scalar).unwrap_or(Ty::Int);
            let _ = maintain;
            return Ok((ir::var(&tmp), ty));
        }
        Ok((value, Ty::Row(read.table.clone()).optional()))
    }

    fn scan(&mut self, read: &ReadExpr, out: &mut setup::Body) -> Fallible<(Scan, u32)> {
        self.scan_at(read, out, prefix::Position::Page)
    }

    fn scan_at(&mut self, read: &ReadExpr, out: &mut setup::Body, position: prefix::Position) -> Fallible<(Scan, u32)> {
        if self.schema.maintain_for(&read.table).is_some_and(|m| m.groups_by_parent(self.schema)) {
            return Err(Diagnostic::new(&read.site,"E_READ_THROUGH_SCAN",format!("{} groups are readable only by their parent key",read.table),format!("{}[parent]",read.table)).guide("maintains"));
        }
        let info = self.table(&read.table, &read.site)?;
        let (keys, index, selection) = self.select_index(info, read, ReadMode::Range, out)?;
        let prefix = self.order_keys(info, &index, keys)?;
        let (range, bound) = self.prefix_bound(read, &index, position)?;
        if info.maintained.is_some() && let Some(position) = index.columns.iter().position(|field| field == "value") {
            if prefix.len() != position {
                return Err(super::maintains::refusal(&range.site, format!("{} by {} needs every ranking scope field pinned: {}", read.table, index.name, index.columns[..position].join(", ")),
                    format!("pin {} with where equalities, then read {} last {} by .value after c; omit the scope predicate for a global ranking", index.columns[..position].join(", "), read.table, range.take)));
            }
        }
        if range.take == 0 {
            return Err(type_error(&range.site, "a page holds at least one row", print::read_expr(&ReadExpr { range: Some(ast::RangeSpec { take: 50, ..range.clone() }), ..read.clone() })));
        }
        let mut page_source = read.clone();
        page_source.computed.extend(index.computed.iter().map(|(key, value)| {
            let mut value = value.clone();
            if let A::Call { args, .. } = &mut value
                && let Some(A::Name { name, site }) = args.first().cloned() {
                args[0] = A::Member { base: Box::new(A::Focal { site: site.clone() }), name, site };
            }
            (key.clone(), value)
        }));
        for (key, column) in page_source.keys.iter_mut().zip(&index.columns) {
            key.column.get_or_insert_with(|| column.clone());
        }
        let filter_text = read.filter.as_ref().map(|expr| self.catalog.source.expression(expr));
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
            if !info.total_cursor(&index) {
                let columns = index.columns.iter().map(|column| index.computed.get(column)
                    .map(print::expression).unwrap_or_else(|| column.clone())).collect::<Vec<_>>().join(", ");
                if index.unique {
                    // Do not add id to the unique constraint: that would
                    // weaken it. Plan a separate pageable index from the read.
                    let mut planned = read.clone();
                    let rewrite = if index.computed.is_empty() {
                        planned.index = None;
                        for (key, column) in planned.keys.iter_mut().zip(&index.columns) { key.column.get_or_insert_with(|| column.clone()); }
                        planned.order_keys = index.columns.iter().skip(prefix.len()).cloned().collect();
                        print::read_expr(&planned)
                    } else {
                        let mut name = format!("{}Page", index.name);
                        while info.indexes.iter().any(|index| index.name == name) { name.push('_'); }
                        planned.index = Some(name.clone());
                        format!("add `by {name}: {columns}, id` to {}; read `{}`", read.table, print::read_expr(&planned))
                    };
                    return Err(Diagnostic::new(&range.site, "E_CURSOR_INDEX", format!("index {}.{} cannot carry a cursor: its nullable unique key allows tied null rows without an id tiebreak", read.table, index.name), rewrite).guide("indexes"));
                }
                return Err(Diagnostic::new(&range.site, "E_CURSOR_INDEX", format!("index {}.{} cannot carry a cursor: it has no declared id or total unique key", read.table, index.name), format!("by {}: {columns}, id", index.name)).guide("indexes").mechanical());
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
        let scan_site = self.site();
        self.page_sources.insert(scan_site.clone(), page_source);
        let pins = read.keys.iter().enumerate().map(|(position, key)| {
            let column = key.column.as_ref().unwrap_or(&index.columns[position]);
            format!(".{column} = {}", self.catalog.source.operand(&key.value))
        }).collect::<Vec<_>>().join(" and ");
        let domain = if pins.is_empty() { read.table.clone() } else { format!("{} where {pins}", read.table) };
        self.sources.insert(format!("domain/{scan_site}"), (read.site.clone(), domain));
        if filter.is_some() && let Some(text) = filter_text { self.filters.insert(scan_site.clone(), text); }
        // Only the generated scan itself, never an authored scan bound inside its keys, cursor or helpers.
        if self.expanding_feed.as_ref().is_some_and(|(feed, site)| *feed == read.table && *site == read.site) { self.timeline_scans.insert(scan_site.clone()); }
        self.record_selection(&scan_site, read, &index, if position == prefix::Position::Exists { "exists" } else { "page" }, &selection);
        // Authored spelling serves diagnostics; inferred-index residency sites
        // keep canonical bytes. Explicit-index search alternatives retain their
        // authored origin even when presence planning synthesizes a browse index.
        if !read.order_keys.is_empty() && let Some(text) = self.catalog.canonical_read_origins.get(&read.site.to_string()) {
            self.canonical_sources.insert(scan_site.clone(), text.clone());
        }
        let spelling = if !read.order_keys.is_empty() { self.catalog.read_origins.get(&read.site.to_string()).cloned() } else { None };
        self.sources.insert(scan_site.clone(), (read.site.clone(), spelling.unwrap_or_else(|| print::read_expr(&ReadExpr { index: None, range: None, matching: None, filter: None, seeks: Vec::new(), ..read.clone() }))));
        let mut scan = Scan {
            variant: self.variant(),
            site: scan_site,
            table: read.table.clone(),
            index: index.name,
            prefix,
            order: if range.order == ast::Order::Asc { Order::Asc } else { Order::Desc },
            take: bound,
            existence: position == prefix::Position::Exists,
            after,
            before: None,
            range: seek,
            filter,
            opaque_cursor: range.cursor.is_some(),
            merge_site: None,
            provenance: KeyProvenance::Shape,
        };
        if position == prefix::Position::Aggregate && snapback4_core::engine::rules::scan_visibility(self.schema, &scan).uniform {
            scan.take = Bound::Meter;
        }
        if matches!(position, prefix::Position::Exists | prefix::Position::Aggregate) {
            self.constraint_domains.insert(scan.site.clone());
        }
        // @ref LLP 3000.028#4-put-the-rules-where-the-builder-meets-them — job/preview advice belongs only to a helper with a query-ineligible meter read.
        if self.caller_kind == ProgramKind::Job && self.call_chain.len() > 1
            && scan.take == Bound::Meter && !snapback4_core::engine::rules::scan_visibility(self.schema, &scan).uniform {
            self.job_bound_helpers.insert(self.call_chain.last().unwrap().0.clone());
        }
        if self.caller_kind != ProgramKind::Job && (position != prefix::Position::Aggregate || self.caller_kind == ProgramKind::Query) { self.check_meter_prefix(read, &scan)?; }
        Ok((scan, range.take))
    }

    /// Evaluate the keys, then choose the index: explicit `by`, else by
    /// key names, count and types. Point reads need a unique full key;
    /// ranges need a strict prefix.
    fn select_index(&mut self, info: &'a TableInfo, read: &ReadExpr, mode: ReadMode, out: &mut setup::Body) -> Fallible<(Vec<(Option<String>, Expr, Ty)>, ast::IndexDecl, String)> {
        let normalized = super::mixed_keys::read(info, read, self.catalog)?;
        let read = normalized.as_ref();
        super::validate_key_names(read)?;
        if !read.keys.is_empty() && read.keys.iter().all(|key| key.column.is_none()) {
            let declared = |index: &&ast::IndexDecl| !self.catalog.synthesized.contains(&(read.table.clone(), index.name.clone()));
            let candidates = info.indexes.iter().filter(declared).filter(|index| match &read.index {
                Some(name) => &index.name == name,
                None => index.unique && index.columns.len() == read.keys.len(),
            }).collect::<Vec<_>>();
            if read.index.is_none() && mode == ReadMode::Range && read.order_keys.is_empty() && candidates.len() == 1 {
                let scan = info.indexes.iter().filter(declared).find(|index| !index.unique && index.is_plain() && index.columns.len() > read.keys.len());
                let columns = scan.map(|index| index.columns.as_slice()).unwrap_or(&candidates[0].columns);
                let predicate = read.keys.iter().zip(columns).map(|(key, column)| format!(".{column} = {}", self.catalog.source.operand(&key.value))).collect::<Vec<_>>().join(" and ");
                return Err(Diagnostic::new(&read.site, "E_QUARRY_POSITIONAL_SCAN", "a positional key selects one declared unique row, not a scan prefix",
                    format!("{} where {predicate} first 20 by .id", read.table)).guide("reads"));
            }
            if candidates.len() != 1 {
                let columns = candidates.first().map(|index| index.columns.as_slice()).or_else(|| info.indexes.iter().filter(declared).find(|index| index.columns.len() >= read.keys.len()).map(|index| index.columns.as_slice())).unwrap_or(&[]);
                let named = read.keys.iter().enumerate().map(|(at, key)| format!("{} = {}", columns.get(at).map(String::as_str).unwrap_or("column"), print::expression(&key.value))).collect::<Vec<_>>().join(", ");
                return Err(Diagnostic::new(&read.site, "E_QUARRY_POSITIONAL_SCAN", format!("{} positional key has {} declared unique keys of arity {}; use named columns", read.table, candidates.len(), read.keys.len()), format!("{}[{named}]", read.table)).guide("reads"));
            }
            if read.index.is_none() {
                let mut explicit = read.clone();
                explicit.index = Some(candidates[0].name.clone());
                return self.select_index(info, &explicit, mode, out).map(|(keys, index, _)| (keys, index, "only declared unique key of this arity".into()));
            }
        }
        let point = mode != ReadMode::Range;
        let mut keys = Vec::<(Option<String>, Expr, Ty)>::new();
        for part in &read.keys {
            let expected_column = part.column.clone();
            let mut setup = setup::Body::default();
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
        let mut selection = if read.index.is_some() { "explicit by" } else if named { "named equality columns" } else { "compatible positional key types" };
        // A `words(..)` index serves one read: `matching` with exactly its
        // leading columns as keys. Every other read sees plain indexes only.
        let searching = mode == ReadMode::Range && read.matching.is_some();
        let mut candidates: Vec<&ast::IndexDecl> = info
            .indexes
            .iter()
            .filter(|index| read.index.as_ref().is_none_or(|explicit| explicit == &index.name))
            .filter(|index| read.seeks.iter().all(|b| index.columns.get(keys.len()) == Some(&b.column)))
            .filter(|index| if searching { index.searches_after(keys.len()) } else { index.words.is_none() })
            .filter(|index| match mode {
                ReadMode::Point | ReadMode::FilteredPoint => index.unique && (index.columns.len() == keys.len() || (named && mode == ReadMode::FilteredPoint && info.total_unique(index) && index.columns.len() < keys.len())),
                ReadMode::Exists => (index.columns.len() == keys.len() && (named || read.index.is_some() || index.unique)) || (named && info.total_unique(index) && index.columns.len() < keys.len()),
                ReadMode::Range => index.columns.len() > keys.len() || (!read.order_keys.is_empty() && index.unique && index.columns.len() == keys.len()),
            })
            .filter(|index| {
                if named {
                    if index.columns.len() < keys.len() { index.columns.iter().all(|column| keys.iter().any(|(c, _, _)| c.as_ref() == Some(column))) } else { keys.iter().all(|(c, _, _)| index.columns[..keys.len()].contains(c.as_ref().unwrap())) }
                } else {
                    true
                }
            })
            .collect();
        if named && matches!(mode, ReadMode::FilteredPoint | ReadMode::Exists) {
            if let Some(width) = candidates.iter().filter(|i| info.total_unique(i)).map(|i| i.columns.len()).min() {
                candidates.retain(|i| info.total_unique(i) && i.columns.len() == width);
            }
        }
        // Positional keys select by type; a text literal may meet an
        // identity column (it becomes an id once the index is chosen).
        if !named {
            candidates.retain(|index| {
                keys.iter().enumerate().all(|(position, (_, e, t))| {
                    index.columns.get(position).is_some_and(|column| {
                        let expected = self.key_ty(info, index, column);
                        t.comparable(&expected) || (expected.is_identity() && matches!(e, Expr::Literal(Value::String(_))))
                    })
                })
            });
            // @ref LLP 3000.007#18.5 — resolve remaining ambiguity without replacing an existing exact-type winner.
            let exact: Vec<_> = candidates.iter().copied().filter(|index| keys.iter().enumerate().all(|(position, (_, _, t))| index.columns.get(position).is_some_and(|column| self.key_ty(info, index, column) == t.required()))).collect();
            if exact.len() == 1 {
                candidates = exact;
                if read.index.is_none() { selection = "single exact positional type match"; }
            }
            else {
                // Filter before the one-candidate arm so identity literals receive their index's type.
                let unique: Vec<_> = candidates.iter().copied().filter(|index| index.unique && index.columns.len() == keys.len()).collect();
                if unique.len() == 1 {
                    candidates = unique;
                    if read.index.is_none() { selection = "only compatible full unique key"; }
                }
            }
        }
        if let Some(explicit) = &read.index
            && candidates.is_empty()
        {
            let known = info.indexes.iter().find(|i| &i.name == explicit);
            return Err(match known {
                None => unknown(&read.site, format!("{} has no index {explicit}", read.table), name_rewrite(explicit, info.indexes.iter().map(|i| i.name.as_str()), None)),
                Some(index) if index.words.is_some() && !searching => unknown(&read.site, format!("{}.{explicit} is a words index; it is read with matching", read.table), format!("{}[{}] matching q first 50 by {explicit}", read.table, index.columns[..index.words.as_ref().map_or(0, |(p, _)| *p)].join(", "))),
                Some(index) if searching => unknown(&read.site, format!("{}.{explicit} has its words after {} column{}; matching takes exactly those as keys", read.table, index.words.as_ref().map_or(0, |(p, _)| *p), if index.words.as_ref().map_or(0, |(p, _)| *p) == 1 { "" } else { "s" }), format!("{}[{}] matching q first 50 by {explicit}", read.table, index.columns[..index.words.as_ref().map_or(0, |(p, _)| *p)].join(", "))),
                Some(index) => self.index_mismatch(info, read, mode, &keys, index),
            });
        }
        match candidates.len() {
            1 => {
                let index = candidates[0].clone();
                if mode == ReadMode::Range && read.index.is_none() && !read.keys.is_empty() && !named {
                    let predicate = read.keys.iter().zip(&index.columns).map(|(key, column)| format!(".{column} = {}", self.catalog.source.operand(&key.value))).collect::<Vec<_>>().join(" and ");
                    let order = index.columns.iter().skip(read.keys.len()).map(|column| format!(".{column}")).collect::<Vec<_>>().join(", ");
                    return Err(Diagnostic::new(&read.site, "E_QUARRY_POSITIONAL_SCAN", format!("{} would select non-unique prefix {}", print::read_expr(read), index.name), format!("{} where {predicate} first 50 by {order}", read.table)).guide("reads"));
                }
                if !named {
                    for (position, (_, e, t)) in keys.iter_mut().enumerate() {
                        if let Some(column) = index.columns.get(position)
                            && self.key_ty(info, &index, column).is_identity()
                            && let Expr::Literal(Value::String(text)) = e
                        {
                            *e = Expr::Literal(Value::Id(text.clone()));
                            *t = Ty::Id;
                        }
                    }
                }
                Ok((keys, index, selection.into()))
            }
            0 => {
                let declared: Vec<String> = info.indexes.iter().map(|i| format!("{} ({})", i.name, i.columns.join(", "))).collect();
                if searching {
                    let scope: Vec<String> = keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "<column>".into())).collect();
                    Err(unknown(&read.site, format!("{} has no words index after {} key{}; its indexes are {}", read.table, keys.len(), if keys.len() == 1 { "" } else { "s" }, declared.join(", ")), format!("by by{}Words: {}words(<text column>), at, id", scope.iter().map(|c| title(c)).collect::<String>(), scope.iter().map(|c| format!("{c}, ")).collect::<String>())))
                } else if point {
                    Err(unknown(&read.site, format!("{} has no unique index over {} column{} matching this key; its indexes are {}", read.table, keys.len(), if keys.len() == 1 { "" } else { "s" }, declared.join(", ")), format!("unique by{}: {}", keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "Column".into())).map(|c| title(&c)).collect::<String>(), keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "<column>".into())).collect::<Vec<_>>().join(", ")) + if named && mode != ReadMode::Point { "  -- an index is needed when the named equalities do not cover a total unique key" } else { "" }))
                } else {
                    Err(unknown(&read.site, format!("{} has no index whose prefix takes {} key{}; its indexes are {}", read.table, keys.len(), if keys.len() == 1 { "" } else { "s" }, declared.join(", ")), format!("by by{}: {}, id", keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "Column".into())).map(|c| title(&c)).collect::<String>(), keys.iter().map(|(c, _, _)| c.clone().unwrap_or_else(|| "<column>".into())).collect::<Vec<_>>().join(", "))).guide("indexes"))
                }
            }
            _ => {
                let names: Vec<&str> = candidates.iter().map(|i| i.name.as_str()).collect();
                Err(ambiguous(&read.site, format!("{} has {} indexes matching this key: {}; choose one", read.table, names.len(), names.join(", ")), format!("{} by {}", print::read_expr(read), names[0])))
            }
        }
    }

    fn key_ty(&self, info: &TableInfo, index: &ast::IndexDecl, column: &str) -> Ty {
        if index.computed.contains_key(column) { return Ty::Int; }
        if column == "id" {
            return Ty::Ref(info.decl.name.clone());
        }
        info.columns.get(column).map(Ty::from_scalar).unwrap_or(Ty::Unknown)
    }

    fn order_keys(&mut self, info: &TableInfo, index: &ast::IndexDecl, keys: Vec<(Option<String>, Expr, Ty)>) -> Fallible<Vec<Expr>> {
        let named = keys.iter().all(|(c, _, _)| c.is_some());
        if !named {
            for (position, (_, _, t)) in keys.iter().enumerate() {
                let expected = self.key_ty(info, index, &index.columns[position]);
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
            let expected = self.key_ty(info, index, column);
            if !keys[position].2.comparable(&expected) {
                return Err(type_error(&index.site, format!("{column} is {}; {}.{column} is {}", keys[position].2.name(), info.decl.name, expected.name()), format!("use {} for {column}", expected.name())));
            }
            ordered.push(keys[position].1.clone());
        }
        Ok(ordered)
    }

    fn walk(&mut self, table: &str, seed: &A, column: &str, depth: u32, site: &Site, out: &mut setup::Body) -> Fallible<(Recurse, Ty)> {
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

    fn merge(&mut self, merge: &ast::MergeExpr, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        if merge.lanes.iter().any(|lane| lane.planned.is_some()) || merge.index.is_empty() { return self.planned_view(merge, out, prefix::Position::Page); }
        let info = self.table(&merge.table, &merge.site)?;
        if merge.lanes.first().and_then(|lane| lane.table.as_deref()).is_some_and(|table| table != merge.table) {
            return Err(type_error(&merge.site, "the first merge lane must use the header table, which owns the cursor", "start with [prefix] for the header table").guide("feeds"));
        }
        let Some(index) = info.indexes.iter().find(|index| index.name == merge.index).cloned() else {
            return Err(unknown(&merge.site, format!("{} has no index {}", merge.table, merge.index), name_rewrite(&merge.index, info.indexes.iter().map(|i| i.name.as_str()), None)));
        };
        // @ref LLP 3000.007#18.1 — matching merges lower to scoped matching scans in the existing lane IR.
        let direction = if merge.order == ast::Order::Asc { "first" } else { "last" };
        let matching_form = |scope: &[String]| format!("merge {} matching q{} {direction} {} by {}:\n  [{}]", merge.table, if merge.cursor.is_some() { " after c" } else { "" }, merge.take, merge.index, scope.join(", "));
        if let Some((position, _)) = &index.words {
            let scope = &index.columns[..*position];
            if merge.matching.is_none() {
                return Err(unsupported(&merge.site, "merge over a words index without matching", matching_form(scope)).guide("search"));
            }
            if merge.lanes.iter().any(|lane| lane.prefix.len() != *position || lane.columns.as_ref().is_some_and(|columns| columns.iter().flatten().any(|column| !scope.contains(column)))) {
                return Err(type_error(&merge.site, format!("matching merge lanes must pin exactly the {} scope column(s) before words in {}.{}", position, merge.table, merge.index), matching_form(scope)).guide("search"));
            }
        } else if merge.matching.is_some() {
            return Err(unsupported(&merge.site, "matching on a merge over a plain index", format!("merge {} {direction} {} by {}:\n  [prefix]  -- or merge {} matching q {direction} {} by <wordsIndex>:\n  [scope]", merge.table, merge.take, merge.index, merge.table, merge.take)).guide("search"));
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
        let matching = merge.matching.as_ref().map(|value| self.expr(value, out)).transpose()?;
        let matching = matching.map(|(value, ty)| {
            let name = self.temp("matching");
            let runtime = self.declare(&name, ty);
            out.push(Stmt::Let { name: runtime, value });
            Box::new(A::Name { name, site: merge.site.clone() })
        });
        let mut lanes = Vec::new();
        for lane in &merge.lanes {
            // @ref LLP 3000.007#20.3 — inbox and public broadcast projections share a row and ordering, not an audience.
            let table = lane.table.as_deref().unwrap_or(&merge.table);
            if table != merge.table {
                let other = self.table(table, &lane.site)?;
                let other_index = other.indexes.iter().find(|i| i.name == merge.index);
                if info.columns != other.columns || other_index.is_none_or(|i| i.columns != index.columns || i.unique != index.unique || i.words != index.words || self.schema.tables[table].indexes[&i.name] != self.schema.tables[&merge.table].indexes[&index.name]) || merge.matching.is_some() {
                    return Err(type_error(&lane.site, "a named-table merge lane needs the same columns and plain index as its header table", format!("give {table} the columns and {} index of {}, or read it separately", merge.index, merge.table)).guide("feeds"));
                }
            }
            self.push_scope();
            let mut setup = setup::Body::default();
            let mut source = None;
            let mut binding = String::new();
            if let Some((name, domain)) = &lane.loop_ {
                // Source keys, seeks and predicate setup precede discovery; only
                // the lane prefix may depend on the source row.
                let (domain, ty) = self.lane_domain(domain, out)?;
                source = Some(domain);
                binding = self.declare(name, ty);
                // @ref LLP 3000.007#20.12 — filtered discovery lanes keep their selector in eager setup; lazy discovery freezes only prefixes.
                if merge.filter.as_ref().is_some_and(|filter| source.as_ref().is_some_and(|source| source.scan().is_some()) || lanes::filter_uses_lane(filter, name)) {
                    let source_binding = self.temp("source");
                    setup.push(Stmt::Let { name: binding, value: ir::var(&source_binding) });
                    binding = source_binding;
                }
            }
            // @ref LLP 3000.007#20.12 — a merge predicate uses each lane's existing metered filter, before a candidate can be emitted.
            let read = ReadExpr { computed: Default::default(), order_keys: Vec::new(), table: table.to_owned(), keys: lane.prefix.iter().enumerate().map(|(position, value)| ast::KeyPart { column: lane.columns.as_ref().and_then(|c| c.get(position).cloned().flatten()), value: value.clone(), site: value.site().clone() }).collect(), index: Some(merge.index.clone()), range: Some(ast::RangeSpec { order: merge.order, take: merge.take, cursor: None, site: lane.site.clone() }), matching: matching.clone(), filter: merge.filter.clone(), seeks: Vec::new(), site: lane.site.clone() };
            let (mut scan, _) = self.scan(&read, &mut setup)?;
            self.pop_scope();
            scan.after = cursor_expr.clone().map(Box::new);
            scan.opaque_cursor = cursor_expr.is_some();
            scan.merge_site = Some(merge_site.clone());
            if let Some((_, domain)) = &lane.loop_ {
                self.sources.insert(format!("for/{binding}"), (domain.site().clone(), self.catalog.source.expression(domain)));
            }
            lanes.push(MergeLane { guard: None, distinct: None, branch: None, project: None, setup: setup.code, scan, source, binding });
        }
        Ok((Expr::Merge(Merge { variant: self.variant(), position: None, view: None, order_keys: Vec::new(), site: merge_site, lanes }), Ty::Page(merge.table.clone(), merge.take)))
    }

    // ----- shapes -----

    fn shape(&mut self, base: &A, fields: &[ShapeField], site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let (base_expr, base_ty) = self.expr(base, out)?;
        self.shape_bound(base_expr, base_ty, fields, site, out)
    }

    fn shape_bound(&mut self, base_expr: Expr, base_ty: Ty, fields: &[ShapeField], site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        match base_ty.clone() {
            Ty::Page(table, max) => {
                let list = self.temp("rows");
                out.push(Stmt::Let { name: list.clone(), value: Expr::Array(Vec::new()) });
                let item = self.temp("row");
                let domain = match base_expr {
                    Expr::Scan(scan) => LoopDomain::Page(scan),
                    other => LoopDomain::DerivedArray { value: other, max, bound_source: "page".into() },
                };
                let mut body = setup::Body::default();
                let (object, object_ty) = self.shape_object(&item, Ty::Row(table.clone()), fields, site, &mut body)?;
                body.push(Stmt::Push { target: list.clone(), value: object });
                out.push_for(item, domain, body);
                Ok((ir::var(&list), Ty::Collection(Box::new(object_ty), max)))
            }
            Ty::Collection(item_ty, max) | Ty::List(item_ty, max) => {
                let list = self.temp("items");
                out.push(Stmt::Let { name: list.clone(), value: Expr::Array(Vec::new()) });
                let item = self.temp("item");
                let mut body = setup::Body::default();
                let (object, object_ty) = self.shape_object(&item, *item_ty, fields, site, &mut body)?;
                body.push(Stmt::Push { target: list.clone(), value: object });
                out.push_for(item, LoopDomain::DerivedArray { value: base_expr, max, bound_source: "shape".into() }, body);
                Ok((ir::var(&list), Ty::Collection(Box::new(object_ty), max)))
            }
            Ty::Row(_) | Ty::WriteRow(_) | Ty::Object(_) | Ty::RowShape(_) | Ty::RowObject(_) => {
                let row = self.temp("row");
                out.push(Stmt::Let { name: row.clone(), value: base_expr });
                self.shape_object(&row, base_ty, fields, site, out)
            }
            Ty::Optional(inner) if matches!(*inner, Ty::Row(_) | Ty::WriteRow(_) | Ty::Object(_) | Ty::RowShape(_) | Ty::RowObject(_)) => {
                let row = self.temp("row");
                out.push(Stmt::Let { name: row.clone(), value: base_expr });
                let result = self.temp("shaped");
                out.push(Stmt::Let { name: result.clone(), value: Expr::Literal(Value::Null) });
                let mut body = setup::Body::default();
                let (object, object_ty) = self.shape_object(&row, *inner, fields, site, &mut body)?;
                body.push(Stmt::Assign { name: result.clone(), value: object });
                out.push_if(Expr::Binary { op: BinaryOp::Ne, left: Box::new(ir::var(&row)), right: Box::new(Expr::Literal(Value::Null)) }, body, setup::Body::default());
                Ok((ir::var(&result), object_ty.optional()))
            }
            other => Err(type_error(site, format!("a shape applies to a row, an object or a page; got {}", other.name()), "shape a read: `messages[id] { body }`")),
        }
    }

    /// Build the object of a shape over a focal row variable.
    fn shape_object(&mut self, row_var: &str, row_ty: Ty, fields: &[ShapeField], site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        objects::explicit_fields(fields.iter().filter_map(|f| match f {
            ShapeField::Bare { name, site } | ShapeField::Field { name, site, .. } => Some((name.as_str(), site)),
            _ => None,
        }))?;
        let prior = self.focal.replace((row_var.to_owned(), row_ty.clone()));
        self.push_scope();
        let result = (|| {
            let mut exprs = Vec::<(String, Expr)>::new();
            let mut types = BTreeMap::new();
            let mut add = |binder: &mut Self, name: String, e: Expr, t: Ty, setup: setup::Body, out: &mut setup::Body| {
                if types.contains_key(&name) {
                    // A replaced value still runs and pays its meter. Freeze
                    // preceding fields before dropping one from the output,
                    // including failures/reads with no setup statements.
                    for (_, value) in &mut exprs {
                        *value = binder.snapshot(std::mem::replace(value, Expr::Literal(Value::Null)), out);
                    }
                    exprs.retain(|(field, _)| field != &name);
                }
                binder.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
                let e = if expr::allocates(&e) { binder.snapshot(e, out) } else { e };
                exprs.push((name.clone(), e));
                types.insert(name, t);
            };
            for field in fields {
                match field {
                    ShapeField::Spread { site } => {
                        for (name, _) in self.row_fields(&row_ty, site)? {
                            if matches!(row_ty, Ty::RowShape(_)) && fields.iter().any(|field| matches!(field, ShapeField::Field { name: explicit, .. } if explicit == &name)) { continue; }
                            // @ref LLP 3000.015#1 — wildcard selection has the same
                            // optional private-field semantics as explicit selection.
                            let (value, ty) = self.member(ir::var(row_var), row_ty.clone(), &name, site)?;
                            add(self, name, value, ty, setup::Body::default(), out);
                        }
                    }
                    ShapeField::NamedSpread { name, site } => {
                        let Some(shape) = self.catalog.shapes.get(name).cloned() else {
                            return Err(unknown(site, format!("unknown shape {name}"), name_rewrite(name, self.catalog.shapes.keys().map(String::as_str), None)));
                        };
                        let mut setup = setup::Body::default();
                        let (nested, nested_ty) = self.shape_object(row_var, row_ty.clone(), &shape.fields, site, &mut setup)?;
                        if let (Expr::Object(nested_fields) | Expr::Shape { fields: nested_fields, .. }, Ty::Object(nested_types) | Ty::RowShape(nested_types) | Ty::RowObject(nested_types)) = (nested, nested_ty) {
                            for (name, e) in nested_fields {
                                let t = nested_types[&name].clone();
                                add(self, name, e, t, std::mem::take(&mut setup), out);
                            }
                        }
                    }
                    ShapeField::Bare { name, site } => {
                        let (e, t) = self.member(ir::var(row_var), row_ty.clone(), name, site)?;
                        add(self, name.clone(), e, t, setup::Body::default(), out);
                    }
                    ShapeField::Field { name, value, .. } => {
                        let mut setup = setup::Body::default();
                        let (e, t) = self.expr(value, &mut setup)?;
                        add(self, name.clone(), e, t, setup, out);
                    }
                }
            }
            let _ = site;
            let fields = exprs.into_iter().collect();
            if matches!(row_ty, Ty::Row(_) | Ty::WriteRow(_) | Ty::RowShape(_) | Ty::RowObject(_)) {
                if types.contains_key("pending") { return Err(type_error(site, "pending is the device's row metadata", "omit pending from the shape; it is preserved from the row")); }
                let ty = if matches!(row_ty, Ty::RowObject(_)) { Ty::RowObject(types) } else { Ty::RowShape(types) };
                Ok((Expr::Shape { base: Box::new(ir::var(row_var)), fields }, ty))
            } else { Ok((Expr::Object(fields), Ty::Object(types))) }
        })();
        self.pop_scope();
        self.focal = prior;
        result
    }

    fn row_fields(&self, ty: &Ty, site: &Site) -> Fallible<Vec<(String, Ty)>> {
        match ty.required() {
            Ty::WriteRow(table) => {
                let info = self.table(&table, site)?;
                let mut fields = vec![("id".to_owned(), Ty::Ref(table.clone()))];
                fields.extend(info.columns.iter().filter(|(name,_)| !super::columns::fields(info).any(|f|f == *name)).map(|(name,scalar)|(name.clone(),Ty::from_scalar(scalar))));
                Ok(fields)
            }
            Ty::Row(table) => {
                let info = self.table(&table, site)?;
                let mut fields = vec![("id".to_owned(), Ty::Ref(table.clone()))];
                fields.extend(info.columns.iter().map(|(name, scalar)| (name.clone(), Ty::from_scalar(scalar))));
                Ok(fields)
            }
            Ty::Object(fields) | Ty::RowShape(fields) | Ty::RowObject(fields) => Ok(fields.into_iter().collect()),
            other => Err(type_error(site, format!("* spreads a row or an object; got {}", other.name()), "shape a row")),
        }
    }

    // ----- writes -----

    /// Bind a write. When `valued`, the write yields its row (an insert's
    /// image, an update's or upsert's re-read row, null for a delete).
    fn write(&mut self, expr: &A, out: &mut setup::Body, valued: bool) -> Fallible<Option<(Expr, Ty)>> {
        let A::Write { op, table, keys, fields, if_absent, condition, site } = expr else { unreachable!() };
        if self.in_prelude {
            return Err(placement(site, "a write belongs to a chunk", format!("move {} {table} inside a top-level `for row in table:` job sweep", op.word())));
        }
        if self.kind == ProgramKind::Query {
            return Err(Diagnostic::new(site, "E_QUARRY_PLACEMENT", format!("queries cannot {} {table}", op.word()), "move the write into a mutation").guide("programs"));
        }
        let info = self.table(table, site)?;
        if info.maintained.is_some() {
            return Err(unknown(site, format!("{table} is a maintained aggregate; write its source rows instead"), format!("{} {}", op.word(), info.maintained.as_ref().map(|m| m.source.clone()).unwrap_or_default())));
        }
        for field in fields {
            if info.decl.columns.iter().any(|c| c.name == field.name && c.sequence.is_some()) {
                return Err(Diagnostic::new(&field.site, "E_SEQUENCE_SUPPLIED", format!("{table}.{} is assigned by the engine", field.name),
                    format!("omit {} from the {} payload", field.name, op.word())).guide("writes"));
            }
            if super::columns::fields(info).any(|name|name == field.name) {
                return Err(super::columns::refusal(&field.site,format!("{table}.{} is engine-maintained; write its source rows instead",field.name)));
            }
        }
        // Writes share table-level residency facts, but every source occurrence
        // (including an expanded helper) belongs in a changed-prediction note.
        let write_name = format!("{} {table}", op.word());
        self.sources.insert(format!("write/{write_name}/{site}"), (site.clone(), write_name));
        match op {
            WriteOp::Insert => {
                let (row, row_ty) = self.write_row(info, fields, None, site, out)?;
                let tmp = self.temp("inserted");
                out.push(Stmt::Const { name: tmp.clone(), value: row });
                if *if_absent {
                    let result = self.temp("absent");
                    out.push(Stmt::InsertIfAbsent { table: table.clone(), row: ir::var(&tmp), result: result.clone() });
                    return Ok(valued.then(|| (self.project_insert(info, ir::var(&result)), row_ty.optional())));
                }
                out.push(Stmt::Insert { table: table.clone(), row: ir::var(&tmp) });
                Ok(valued.then(|| (self.project_insert(info, ir::var(&tmp)), row_ty)))
            }
            WriteOp::Update | WriteOp::Upsert => {
                // @ref LLP 3000.007#17 — upsert's insert arm has no old row on which to decide a condition.
                if *op == WriteOp::Upsert && condition.is_some() {
                    return Err(unknown(site, "upsert cannot take a condition", "a condition belongs on update; an upsert inserts or patches"));
                }
                // @ref LLP 3000.007#8 — item 7: target resolution and conditional old images belong to the engine.
                let key = self.write_key(info, keys, site, out).map_err(|error| self.extra_write_test(info, expr, error))?;
                let upsert = *op == WriteOp::Upsert;
                if upsert && fields.iter().any(|f| f.name == "id") {
                    return Err(unknown(site, "upsert cannot spell id; the key names the row", "remove id from the patch; the key names the row"));
                }
                let (patch, _) = self.write_row(info, fields, Some("patch"), site, out)?;
                let condition = if let Some(condition) = condition {
                    let old = self.temp("condition");
                    let prior = self.focal.replace((old.clone(), Ty::Row(table.clone())));
                    let mut setup = setup::Body::default();
                    let bound = self.expr(condition, &mut setup);
                    self.focal = prior;
                    let (value, ty) = bound?;
                    if !ty.is_bool() {
                        return Err(type_error(condition.site(), format!("update's condition must be bool, got {}", ty.name()), "update t[key] { body } if .body = expected"));
                    }
                    out.nest(&format!("{}.condition", out.len()), &setup.ownership);
                    Some(ir::WriteCondition { old, setup: setup.code, value })
                } else { None };
                let result = valued.then(|| self.temp("written"));
                let target = Read { site: site.to_string(), table: table.clone(), index: key.index, key: key.key, provenance: KeyProvenance::Shape };
                out.push(Stmt::WriteTarget { target, patch, upsert, condition, result: result.clone() });
                Ok(result.map(|name| (ir::var(&name), self.write_result_type(info).optional())))
            }
            WriteOp::Delete => {
                let key = self.write_key(info, keys, site, out).map_err(|error| self.extra_write_test(info, expr, error))?;
                if key.alternate {
                    let location = self.site();
                    self.sources.insert(location.clone(), (site.clone(), format!("delete {table}")));
                    out.push(Stmt::DeleteTarget { target: Read { site: location, table: table.clone(), index: key.index, key: key.key, provenance: KeyProvenance::Shape } });
                } else {
                    out.push(Stmt::Delete { table: table.clone(), key: key.key[0].clone() });
                }
                Ok(valued.then(|| (Expr::Literal(Value::Null), Ty::Null)))
            }
        }
    }

    fn write_key(&mut self, info: &'a TableInfo, keys: &[ast::KeyPart], site: &Site, out: &mut setup::Body) -> Fallible<WriteKey> {
        if keys.is_empty() {
            return Err(unknown(site, format!("{} needs a key: which row?", info.decl.name), format!("{}[id]", info.decl.name)));
        }
        // A row value as the key addresses the row by its id.
        if keys.len() == 1 && keys[0].column.is_none() {
            let mut row_setup = setup::Body::default();
            let (e, t) = self.expr(&keys[0].value, &mut row_setup)?;
            if let Ty::Row(table) | Ty::WriteRow(table) = t.required()
                && table == info.decl.name
            {
                out.extend(row_setup);
                let id = self.temp("key");
                out.push(Stmt::Let { name: id.clone(), value: ir::field(e, "id") });
                return Ok(WriteKey { index: "byId".into(), key: vec![ir::var(&id)], alternate: false });
            }
        }
        let read = ReadExpr { computed: Default::default(), order_keys: Vec::new(), table: info.decl.name.clone(), keys: keys.to_vec(), index: None, range: None, matching: None, filter: None, seeks: Vec::new(), site: site.clone() };
        let (bound, index, _) = self.select_index(info, &read, ReadMode::Point, out)?;
        let key = self.order_keys(info, &index, bound)?;
        if index.name == "byId" {
            let id = self.temp("key");
            out.push(Stmt::Let { name: id.clone(), value: key[0].clone() });
            return Ok(WriteKey { index: "byId".into(), key: vec![ir::var(&id)], alternate: false });
        }
        Ok(WriteKey { index: index.name, key, alternate: true })
    }

    fn write_row(&mut self, info: &'a TableInfo, fields: &[ObjectField], current: Option<&str>, site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        objects::explicit_fields(fields.iter().filter(|f| !f.spread).map(|f| (f.name.as_str(), &f.site)))?;
        let expanded;
        let fields = if fields.iter().any(|field| field.spread) {
            expanded = self.expand_object_fields(fields, Some(info), out)?;
            &expanded
        } else { fields };
        for field in fields {
            if super::columns::fields(info).any(|name|name == field.name) {
                return Err(super::columns::refusal(&field.site,format!("{}.{} is engine-maintained; write its source rows instead",info.decl.name,field.name)));
            }
        }
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
                    let mut setup = setup::Body::default();
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

    fn write_row_with_id(&mut self, info: &'a TableInfo, fields: &[ObjectField], id: Expr, site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let id = self.snapshot(id, out);
        let mut exprs = vec![("id".to_owned(), id)];
        let mut given = std::collections::BTreeSet::new();
        for field in fields {
            let Some(scalar) = info.columns.get(&field.name) else {
                return Err(unknown(&field.site, format!("{} has no column {}", info.decl.name, field.name), name_rewrite(&field.name, info.columns.keys().map(String::as_str), None)));
            };
            let expected = Ty::from_scalar(scalar);
            let mut setup = setup::Body::default();
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
                if column.written_by.is_some() {
                    // Preserve omission until the engine checks supplied-field authority.
                    given.insert(column.name.clone());
                    continue;
                }
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
        let missing: Vec<&str> = info.columns.iter().filter(|(name, scalar)| !scalar.optional && !info.decl.columns.iter().any(|c| c.name == **name && c.sequence.is_some()) && !super::columns::fields(info).any(|f|f == *name) && !given.contains(*name)).map(|(name, _)| name.as_str()).collect();
        if !missing.is_empty() {
            return Err(type_error(site, format!("insert into {} omits required column{} {}", info.decl.name, if missing.len() == 1 { "" } else { "s" }, missing.join(", ")), format!("insert {} {{ {} }}", info.decl.name, given.iter().cloned().chain(missing.iter().map(|m| format!("{m}: <{}>", info.columns.get(*m).map(print::scalar_type).unwrap_or_default()))).collect::<Vec<_>>().join(", "))));
        }
        Ok((Expr::Object(exprs.into_iter().collect()), self.write_result_type(info)))
    }

    fn project_insert(&self, info: &TableInfo, row: Expr) -> Expr {
        if info.decl.columns.iter().any(|column| column.written_by.is_some()) {
            Expr::Builtin { builtin: Builtin::ProjectFields { table: info.decl.name.clone() }, args: vec![row] }
        } else { row }
    }

    fn write_result_type(&self, info: &TableInfo) -> Ty {
        if super::columns::fields(info).next().is_some() { Ty::WriteRow(info.decl.name.clone()) } else { Ty::Row(info.decl.name.clone()) }
    }

    fn field_value(&mut self, field: &ObjectField, expected: &Ty, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
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
    /// A read may check extra equalities after a total unique lookup.
    FilteredPoint,
    /// A full key of any index: presence.
    Exists,
    /// A strict prefix: a page.
    Range,
}

struct WriteKey {
    index: String,
    key: Vec<Expr>,
    alternate: bool,
}

fn literal_int(expr: &A) -> Option<i64> {
    match expr {
        A::Literal { value: Literal::Number(text), .. } => text.parse().ok(),
        A::Unary { op, value, .. } if op == "-" => literal_int(value).map(|n| -n),
        _ => None,
    }
}

pub(super) fn validate_code(site: &Site, code: &str) -> Fallible<()> {
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
    let moving: Vec<&str> = index.columns.iter().map(|column| match index.computed.get(column) {
        Some(A::Call { args, .. }) => match args.first() { Some(A::Name { name, .. }) => name.as_str(), _ => column.as_str() },
        _ => column.as_str(),
    }).filter(|column| *column != "id" && !immutable.contains(column)).fold(Vec::new(), |mut columns, column| {
        if !columns.contains(&column) { columns.push(column); }
        columns
    });
    if !moving.is_empty() {
        return Err(Diagnostic::new(site, "E_JOB_CURSOR_INDEX", format!("sweep over {}.{} sweeps by {}, which a write could change under the cursor; a sweep's index columns are id or immutable", scan.table, scan.index, moving.join(", ")), format!("immutable {}  -- on table {}, or use `for row in {}:` for stable id order", moving.join(", "), scan.table, scan.table)).guide("jobs"));
    }
    Ok(())
}
