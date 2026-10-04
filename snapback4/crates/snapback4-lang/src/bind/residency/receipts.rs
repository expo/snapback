//! Receipt prediction is a compile-time property of the expanded program.
//! No value wrappers or traversal are installed in the device interpreter.
// @ref LLP 3000.022#14.3 — allocate optimistically, consume accounting on the server.
use super::*;
use crate::diag::Site;
use snapback4_core::{ir::{Builtin, Read}, schema::{Constraint, MaintainKind, RuleTerm}};

type Origins = BTreeSet<String>;
type Env = BTreeMap<String, Origins>;

pub(super) fn classify(schema: &Schema, program: &Program) -> Option<ResidencySite> {
    if schema.receipts.is_empty() || program.kind != ProgramKind::Mutation { return None; }
    let mut walk = Walk { schema, found: None, at: program.name.clone(), expr: None, rules: BTreeSet::new(), implicit: &[], authored: None };
    walk.body(&program.body, &mut Env::new());
    walk.found.map(|(site, _)| site)
}

pub(crate) fn located(schema: &Schema, bound: &super::super::BoundProgram, catalog: &Catalog) -> Option<(ResidencySite, Site)> {
    if schema.receipts.is_empty() || bound.program.kind != ProgramKind::Mutation { return None; }
    let mut walk = Walk { schema, found: None, at: bound.program.name.clone(), expr: None, rules: BTreeSet::new(), implicit: &bound.implicit_write_results, authored: Some(&bound.receipt_sources) };
    walk.body(&bound.program.body, &mut Env::new());
    if walk.found.is_none() && let Some((table, site)) = bound.receipt_returns.first() {
        walk.at = site.to_string();
        walk.mark(table, format!("helper returns whole receipt row {table}"));
        return walk.found.map(|(reason, _)| (reason, site.clone()));
    }
    let (mut reason, expr) = walk.found?;
    let location = expr.as_ref().and_then(|expr| bound.receipt_sources.iter().find(|(e, _)| e == expr).map(|(_, s)| s.clone()))
        .or_else(|| bound.sources.get(&reason.site).map(|(s, _)| s.clone()))
        .unwrap_or_else(|| if reason.site.starts_with("tables.") { catalog.site_for(&reason.site) } else { bound.site.clone() });
    reason.site = location.to_string();
    Some((reason, location))
}

struct Walk<'a> {
    schema: &'a Schema,
    implicit: &'a [Expr],
    authored: Option<&'a [(Expr, Site)]>,
    found: Option<(ResidencySite, Option<Expr>)>,
    at: String,
    expr: Option<Expr>,
    rules: BTreeSet<(String, String)>,
}

impl Walk<'_> {
    fn mark(&mut self, table: &str, reason: String) {
        if self.found.is_none() {
            self.found = Some((ResidencySite { site: self.at.clone(), table: table.into(), index: String::new(),
                kind: "receipt dependency".into(), class: SiteClass::Server, reason,
                rewrite: "queue this mutation for server settlement; predict using only non-clause fields and stable ids".into() }, self.expr.clone()));
        }
    }
    fn owned(&self, table: &str, field: &str) -> bool {
        self.schema.receipt_dependencies.get(table).is_some_and(|fs| fs.contains(field))
    }
    fn field(&mut self, table: &str, field: &str) {
        if self.owned(table, field) {
            self.mark(table, format!("reads receipt-owned or derived field {table}.{field}"));
        }
    }
    fn whole(&mut self, origins: Origins) {
        if let Some(table) = origins.iter().find(|t| self.schema.receipt_dependencies.contains_key(*t)) {
            self.mark(table, format!("uses whole receipt row {table} as a value"));
        }
    }
    fn consume(&mut self, value: &Expr, env: &mut Env) {
        let origins = self.value(value, env);
        let previous = self.expr.replace(value.clone());
        self.whole(origins);
        self.expr = previous;
    }
    fn key(&mut self, table: &str, index: &str) {
        if let Some(i) = self.schema.tables.get(table).and_then(|t| t.index(index))
            && let Some(field) = self.schema.receipt_dependencies.get(table).and_then(|fs| fs.iter().find(|f| i.uses_column(f))) {
            self.mark(table, format!("selects {table} by receipt-owned or derived key ({field})"));
        }
        // Derived existence is dependent even for an absent by-id read.
        if self.schema.maintain_for(table).is_some() && self.schema.receipt_dependencies.contains_key(table) {
            self.mark(table, format!("reads receipt-derived aggregate {table}"));
        }
    }
    fn read(&mut self, read: &Read, env: &mut Env) -> Origins {
        self.at = read.site.clone();
        self.key(&read.table, &read.index);
        for key in &read.key { self.consume(key, env); }
        self.rule(&read.table, "read");
        [read.table.clone()].into()
    }
    fn scan(&mut self, scan: &ir::Scan, env: &mut Env) -> Origins {
        self.at = scan.site.clone();
        self.key(&scan.table, &scan.index);
        for key in &scan.prefix {
            match key { ir::IndexKeyExpr::Scalar(v) | ir::IndexKeyExpr::WordPrefix(v) => self.consume(v, env) }
        }
        for v in scan.after.iter().chain(scan.before.iter()) { self.consume(v, env); }
        if let Some(range) = &scan.range {
            for v in range.gt.iter().chain(range.gte.iter()).chain(range.lt.iter()).chain(range.lte.iter()) { self.consume(v, env); }
        }
        self.rule(&scan.table, "read");
        let origins: Origins = [scan.table.clone()].into();
        if let Some(filter) = &scan.filter {
            let mut nested = env.clone();
            nested.insert("$filter".into(), origins.clone());
            self.consume(filter, &mut nested);
        }
        origins
    }
    fn value(&mut self, value: &Expr, env: &mut Env) -> Origins {
        let before = self.expr.replace(value.clone());
        let result = match value {
            Expr::Literal(_) | Expr::Input(_) => Origins::new(),
            Expr::Variable(name) => env.get(name).cloned().unwrap_or_default(),
            Expr::Field { base, name } => {
                let sources = self.value(base, env);
                self.expr = Some(value.clone());
                for table in sources { self.field(&table, name); }
                Origins::new()
            }
            Expr::Get(read) => self.read(read, env),
            Expr::Exists(read) => { self.read(read, env); Origins::new() }
            Expr::Scan(scan) => self.scan(scan, env),
            Expr::Array(items) => {
                for item in items { self.consume(item, env); }
                Origins::new()
            }
            Expr::Object(fields) => {
                for field in fields.values() { self.consume(field, env); }
                Origins::new()
            }
            Expr::Shape { base, fields } => {
                // Base supplies provenance metadata only; fields are the values read.
                self.value(base, env);
                for field in fields.values() { self.consume(field, env); }
                Origins::new()
            }
            Expr::Binary { left, right, .. } => {
                // Compiler-generated null tests assert presence, without inspecting
                // a row payload. Owned scalar fields are still inspected recursively.
                if self.authored.is_some_and(|sources| !sources.iter().any(|(e, _)| e == value)) && (matches!(left.as_ref(), Expr::Literal(snapback4_core::Value::Null)) || matches!(right.as_ref(), Expr::Literal(snapback4_core::Value::Null))) {
                    self.value(left, env); self.value(right, env);
                } else { self.consume(left, env); self.consume(right, env); }
                Origins::new()
            }
            Expr::Unary { value, .. } => { self.consume(value, env); Origins::new() }
            Expr::Block { body, value } => { self.body(body, env); self.value(value, env) }
            Expr::Builtin { builtin: Builtin::ProjectFields { table }, args } => {
                // This is the compiler's insert-result projection, not an authored
                // whole-row consumer. Its id/text fields remain safe to read.
                for arg in args { self.value(arg, env); }
                [table.clone()].into()
            }
            Expr::Builtin { builtin: Builtin::OptionalField { field }, args } => {
                for arg in args { for table in self.value(arg, env) { self.field(&table, field); } }
                Origins::new()
            }
            Expr::Builtin { builtin: Builtin::ReceiptSettled { table }, .. } => {
                self.mark(table, format!("calls a receipt projection or receipt state builtin for {table}"));
                Origins::new()
            }
            Expr::Builtin { builtin, args } => {
                let mut inputs = Origins::new();
                for (i, arg) in args.iter().enumerate() {
                    // Streaming projection arguments bind the source row as $filter.
                    if i == 1 && matches!(builtin, Builtin::Sum | Builtin::ExtremumOf { .. }) {
                        let mut nested = env.clone(); nested.insert("$filter".into(), inputs.clone());
                        self.consume(arg, &mut nested);
                    } else { inputs.extend(self.value(arg, env)); }
                }
                self.expr = Some(value.clone());
                self.whole(inputs.clone());
                inputs
            }
            Expr::Merge(merge) => {
                let mut origins = Origins::new();
                for lane in &merge.lanes {
                    let mut nested = env.clone();
                    if let Some(source) = &lane.source {
                        let input = self.domain(&source.domain(), &mut nested);
                        nested.insert(lane.binding.clone(), input);
                    }
                    if let Some(guard) = &lane.guard { self.consume(guard, &mut nested); }
                    let input = self.scan(&lane.scan, &mut nested);
                    nested.insert("$project".into(), input.clone());
                    self.body(&lane.setup, &mut nested);
                    if let Some(project) = &lane.project { origins.extend(self.value(project, &mut nested)); }
                    else { origins.extend(input); }
                    if let Some(distinct) = &lane.distinct { self.consume(distinct, &mut nested); }
                }
                origins
            }
        };
        self.expr = before;
        result
    }
    fn domain(&mut self, domain: &LoopDomain, env: &mut Env) -> Origins {
        match domain {
            LoopDomain::Page(scan) => self.scan(scan, env),
            LoopDomain::DerivedArray { value, .. } => self.value(value, env),
            LoopDomain::ExpressionRange { start, end_exclusive } => { self.consume(start, env); self.consume(end_exclusive, env); Origins::new() }
            LoopDomain::Recurse(r) => {
                self.at = r.site.clone(); self.key(&r.table, &r.index); self.field(&r.table, &r.next_field);
                self.consume(&r.seed, env); self.rule(&r.table, "read"); [r.table.clone()].into()
            }
            LoopDomain::ArgList { name, .. } => env.get(name).cloned().unwrap_or_default(),
            LoopDomain::LiteralRange { .. } => Origins::new(),
        }
    }
    fn body(&mut self, body: &[Stmt], env: &mut Env) {
        for stmt in body {
            if self.found.is_some() { break; }
            match stmt {
                Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value } => {
                    let origins = self.value(value, env); env.insert(name.clone(), origins);
                }
                Stmt::Push { target, value } => {
                    let origins = self.value(value, env); self.whole(origins.clone());
                    env.entry(target.clone()).or_default().extend(origins);
                }
                Stmt::Return(value) => {
                    if self.implicit.contains(value) { self.value(value, env); }
                    else { self.consume(value, env); }
                }
                Stmt::Require { condition, site, .. } => {
                    if let Some(site) = site { self.at = site.clone(); }
                    self.consume(condition, env);
                }
                Stmt::Check { condition, current } => { self.read(current, env); self.consume(condition, env); }
                Stmt::If { condition, then_body, else_body } => {
                    self.consume(condition, env);
                    let mut a = env.clone(); let mut b = env.clone();
                    self.body(then_body, &mut a); self.body(else_body, &mut b);
                    join(&mut a, b); *env = a;
                }
                Stmt::For { binding, domain, body } => {
                    let origins = self.domain(domain, env);
                    // Monotone fixed point covers assignments carried between iterations.
                    loop {
                        let before = env.clone(); let mut nested = env.clone();
                        nested.insert(binding.clone(), origins.clone()); self.body(body, &mut nested);
                        join(env, nested);
                        if *env == before || self.found.is_some() { break; }
                    }
                }
                Stmt::Insert { table, row } | Stmt::InsertIfAbsent { table, row, .. } => {
                    self.consume(row, env); self.write(table, "insert");
                    if let Stmt::InsertIfAbsent { result, .. } = stmt { env.insert(result.clone(), [table.clone()].into()); }
                    else if let Expr::Variable(name) = row { env.insert(name.clone(), [table.clone()].into()); }
                }
                Stmt::Update { table, key, patch } | Stmt::Upsert { table, key, row: patch } => {
                    self.consume(key, env); self.consume(patch, env); self.write(table, "update");
                    if matches!(stmt, Stmt::Upsert { .. }) { self.write(table, "insert"); }
                }
                Stmt::Delete { table, key } => { self.consume(key, env); self.write(table, "delete"); }
                Stmt::DeleteTarget { target } => { self.read(target, env); self.write(&target.table, "delete"); }
                Stmt::WriteTarget { target, patch, upsert, condition, result } => {
                    self.read(target, env); self.consume(patch, env);
                    if let Some(c) = condition {
                        let mut nested = env.clone(); nested.insert(c.old.clone(), [target.table.clone()].into());
                        self.body(&c.setup, &mut nested); self.consume(&c.value, &mut nested);
                    }
                    self.write(&target.table, "update");
                    if *upsert { self.write(&target.table, "insert"); }
                    if let Some(result) = result { env.insert(result.clone(), [target.table.clone()].into()); }
                }
                Stmt::Emit { payload, once, .. } => { self.consume(payload, env); if let Some(once) = once { self.consume(once, env); } }
                Stmt::Break | Stmt::Continue => {}
            }
        }
    }
    fn term(&mut self, table: &str, term: &RuleTerm) {
        match term {
            RuleTerm::Reference { table: target, column, field, .. } => { self.field(table, column); self.field(target, field); self.rule(target, "read"); }
            RuleTerm::Field(f) | RuleTerm::OldField(f) | RuleTerm::NextField(f) => self.field(table, f), _ => {} }
    }
    fn rule_expr(&mut self, owner: &str, rule: &RuleExpr) {
        match rule {
            RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) | RuleExpr::Compare(_, a, b) => { self.term(owner, a); self.term(owner, b); }
            RuleExpr::And(items) | RuleExpr::Or(items) => for item in items { self.rule_expr(owner, item); },
            RuleExpr::Not(item) => self.rule_expr(owner, item),
            RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
                for term in key { self.term(owner, term); }
                self.key(table, index);
                for (field, term) in equalities { self.field(table, field); self.term(owner, term); }
                self.rule(table, "read");
            }
            RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public { .. } => {}
        }
    }
    fn rule(&mut self, table: &str, effect: &str) {
        if !self.rules.insert((table.into(), effect.into())) { return; }
        let Some(t) = self.schema.tables.get(table) else { return; };
        let previous = self.at.clone(); let expr = self.expr.take();
        self.at = format!("tables.{table}.rules.{effect}");
        self.rule_expr(table, match effect { "insert" => &t.rules.insert, "update" => &t.rules.update, "delete" => &t.rules.delete, _ => &t.rules.read });
        if let Some(parent) = &t.through { self.rule(&parent.parent, "read"); }
        self.at = previous; self.expr = expr;
    }
    fn write(&mut self, table: &str, effect: &str) {
        self.rule(table, effect);
        let Some(t) = self.schema.tables.get(table) else { return; };
        if effect == "insert" {
            for (i, c) in t.constraints.iter().enumerate() {
                if let Constraint::FinalExistsOnInsert { table: target, index, key } = c {
                    self.at = format!("tables.{table}.constraints[{i}]"); self.expr = None;
                    for term in key { self.term(table, term); }
                    self.key(target, index); self.rule(target, "read");
                }
            }
        }
        if effect != "delete" {
            for c in &t.constraints {
                if let Constraint::Cap { by, .. } = c {
                    for field in by { self.field(table, field); }
                }
            }
        }
        // @ref LLP 3000.022#14.3 — device counts stay settled; sums can
        // overflow and member moves can change the cached count's domain.
        for maintain in &self.schema.maintains {
            if !(maintain.source == table || maintain.row_key.as_ref().is_some_and(|k| k.table == table))
                || !self.schema.receipt_dependencies.contains_key(&maintain.target) { continue; }
            if maintain.row_key.as_ref().is_some_and(|k| k.table == table) && effect != "delete" {
                self.rule(table, "read");
                self.rule(&maintain.source, "read");
            }
            let reason = if matches!(maintain.kind, MaintainKind::Sum { .. }) {
                Some("can overflow")
            } else if maintain.row_key.as_ref().is_some_and(|k| k.table == table) && effect == "update" {
                Some("can change the member's count domain")
            } else if self.schema.tables[&maintain.target].constraints.iter().any(|c| !matches!(c, Constraint::Unique { .. }))
                || self.schema.tables[&maintain.target].indexes.values().any(|index| index.unique
                    && index.columns() != ["id"] && index.columns() != maintain.group_fields()) {
                Some("has target constraints")
            } else { None };
            if let Some(reason) = reason {
                self.mark(table, format!("write to {table} evaluates receipt-derived maintenance {} which {reason}", maintain.label()));
            }
        }
        for path in t.recorded.values() { self.field(&path.table, &path.column); }
    }
}

fn join(into: &mut Env, other: Env) {
    for (name, origins) in other { into.entry(name).or_default().extend(origins); }
}
