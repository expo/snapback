//! Track maintenance fields through lowered helpers, aliases and control flow.
// @ref LLP 3000.015#3 — a public status projection cannot become a predicate.
use super::*;

#[derive(Clone, Default, PartialEq, Eq)]
struct Fact { rows: BTreeSet<String>, state: BTreeSet<String> }
impl Fact {
    fn row(table: &str) -> Self { Self { rows: [table.into()].into(), ..Self::default() } }
    fn join(&mut self, other: Self) { self.rows.extend(other.rows); self.state.extend(other.state); }
}
struct Walk<'a> { schema: &'a Schema, env: BTreeMap<String, Fact> }
type Result<T> = std::result::Result<T, String>;

pub(super) fn check(schema: &Schema, program: &Program) -> Result<()> {
    if !schema.maintains.iter().any(|m| m.row_key.is_some()) { return Ok(()); }
    Walk { schema, env: BTreeMap::new() }.body(&program.body).map(|_| ())
}
impl Walk<'_> {
    fn predicate(&self, fact: &Fact) -> Result<()> {
        if let Some(message) = fact.state.first() { Err(message.clone()) } else { Ok(()) }
    }
    fn field(&self, fact: Fact, field: &str) -> Result<Fact> {
        let mut state = fact.state;
        for table in fact.rows {
            if let Some(message) = self.schema.row_view_predicate_field(&table, field) {
                // Only these two public status fields may be projected. Unknown
                // and private fields refuse even as data, never becoming null.
                if !matches!(field, "recountPending" | "pending") { return Err(message); }
                state.insert(message);
            }
        }
        Ok(Fact { state, ..Fact::default() })
    }
    fn read(&mut self, read: &Read) -> Result<Fact> {
        if self.schema.is_recount_work(&read.table) {
            return Err(format!("E_VIEW_KEY: {} is private maintenance state; use value or member fields of the public view (guide maintains)", read.table));
        }
        for e in &read.key { let f = self.expr(e)?; self.predicate(&f)?; }
        if let Some(index) = self.schema.table(&read.table).and_then(|t| t.index(&read.index)) {
            for field in index.columns() {
                if let Some(message) = self.schema.row_view_predicate_field(&read.table, &field) { return Err(message); }
            }
        }
        Ok(Fact::row(&read.table))
    }
    fn scan(&mut self, scan: &Scan) -> Result<Fact> {
        self.read(&Read { site: scan.site.clone(), table: scan.table.clone(), index: scan.index.clone(),
            key: vec![], provenance: scan.provenance })?;
        let mut values: Vec<&Expr> = scan.prefix.iter().map(|p| match p { IndexKeyExpr::Scalar(e) | IndexKeyExpr::WordPrefix(e) => e }).collect();
        values.extend(scan.after.as_deref()); values.extend(scan.before.as_deref());
        if let Some(range) = &scan.range { values.extend(range.gt.iter().chain(&range.gte).chain(&range.lt).chain(&range.lte).map(Box::as_ref)); }
        for e in values { let f = self.expr(e)?; self.predicate(&f)?; }
        let row = Fact::row(&scan.table);
        if let Some(filter) = &scan.filter {
            let old = self.env.insert("$filter".into(), row.clone());
            let f = self.expr(filter)?; self.predicate(&f)?;
            if let Some(old) = old { self.env.insert("$filter".into(), old); } else { self.env.remove("$filter"); }
        }
        Ok(row)
    }
    fn expr(&mut self, expr: &Expr) -> Result<Fact> {
        let mut out = Fact::default();
        match expr {
            Expr::Literal(_) | Expr::Input(_) => {},
            Expr::Variable(name) => return Ok(self.env.get(name).cloned().unwrap_or_default()),
            Expr::Field { base, name } => { let f = self.expr(base)?; return self.field(f, name); },
            Expr::Get(read) => return self.read(read),
            Expr::Exists(read) => { self.read(read)?; },
            Expr::Scan(scan) => return self.scan(scan),
            Expr::Block { body, value } => { out = self.body(body)?; out.join(self.expr(value)?); return Ok(out); },
            Expr::Array(values) => for value in values { out.join(self.expr(value)?); },
            Expr::Object(fields) => for value in fields.values() { out.join(self.expr(value)?); },
            Expr::Shape { base, fields } => { out = self.expr(base)?; for value in fields.values() { out.join(self.expr(value)?); } },
            Expr::Unary { value, .. } => { out = self.expr(value)?; self.predicate(&out)?; out.rows.clear(); },
            Expr::Binary { left, right, .. } => {
                out = self.expr(left)?; out.join(self.expr(right)?); self.predicate(&out)?; out.rows.clear();
            },
            Expr::Builtin { builtin, args } => {
                for arg in args { out.join(self.expr(arg)?); }
                match builtin {
                    Builtin::OptionalField { field } => return self.field(out, field),
                    Builtin::ProjectFields { .. } | Builtin::First | Builtin::Last | Builtin::At | Builtin::Slice | Builtin::Concat => {},
                    Builtin::Sort { keys } => {
                        for key in keys { let f = self.field(out.clone(), &key.field)?; self.predicate(&f)?; }
                    },
                    Builtin::Group { field, .. } | Builtin::Extremum { field, .. } => {
                        let f = self.field(out.clone(), field)?; self.predicate(&f)?;
                    },
                    _ => { self.predicate(&out)?; out.rows.clear(); },
                }
            },
            Expr::Merge(merge) => {
                if let Some(position) = &merge.position {
                    for e in position.after.iter() { let f = self.expr(e)?; self.predicate(&f)?; }
                }
                for lane in &merge.lanes {
                    let source = match &lane.source {
                        None => self.scan(&lane.scan)?, Some(LaneSource::Scan(scan)) => self.scan(scan)?,
                        Some(LaneSource::List { value, .. }) => self.expr(value)?,
                        Some(LaneSource::Range { start, end_exclusive, .. }) => {
                            for e in [start, end_exclusive] { let f = self.expr(e)?; self.predicate(&f)?; } Fact::default()
                        },
                    };
                    self.env.insert(lane.binding.clone(), source);
                    out.join(self.body(&lane.setup)?);
                    for e in lane.guard.iter().chain(&lane.distinct) { let f = self.expr(e)?; self.predicate(&f)?; }
                    let row = self.scan(&lane.scan)?;
                    self.env.insert("$project".into(), row.clone());
                    out.join(if let Some(project) = &lane.project { self.expr(project)? } else { row });
                }
            },
        }
        Ok(out)
    }
    fn bind(&mut self, name: &str, fact: Fact) { self.env.entry(name.into()).or_default().join(fact); }
    fn body(&mut self, body: &[Stmt]) -> Result<Fact> {
        let mut out = Fact::default();
        for stmt in body {
            match stmt {
                Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value }
                | Stmt::Push { target: name, value } => { let f = self.expr(value)?; self.bind(name, f); },
                Stmt::Return(e) => out.join(self.expr(e)?),
                Stmt::Require { condition, .. } => { let f = self.expr(condition)?; self.predicate(&f)?; },
                Stmt::Check { condition, current } => { self.read(current)?; let f = self.expr(condition)?; self.predicate(&f)?; },
                Stmt::If { condition, then_body, else_body } => {
                    let f = self.expr(condition)?; self.predicate(&f)?;
                    out.join(self.body(then_body)?); out.join(self.body(else_body)?);
                },
                Stmt::For { binding, domain, body } => {
                    let f = match domain {
                        LoopDomain::Page(scan) => self.scan(scan)?,
                        LoopDomain::DerivedArray { value, .. } => self.expr(value)?,
                        LoopDomain::ArgList { name, .. } => self.env.get(name).cloned().unwrap_or_default(),
                        LoopDomain::Recurse(r) => { let f = self.expr(&r.seed)?; self.predicate(&f)?; Fact::row(&r.table) },
                        LoopDomain::ExpressionRange { start, end_exclusive } => {
                            for e in [start, end_exclusive] { let f = self.expr(e)?; self.predicate(&f)?; } Fact::default()
                        },
                        LoopDomain::LiteralRange { .. } => Fact::default(),
                    };
                    self.bind(binding, f);
                    loop {
                        let prior = self.env.clone();
                        out.join(self.body(body)?);
                        if self.env == prior { break; }
                    }
                },
                Stmt::WriteTarget { target, patch, condition, result, .. } => {
                    let row = self.read(target)?; self.expr(patch)?;
                    if let Some(c) = condition { self.bind(&c.old, row.clone()); self.body(&c.setup)?; let f = self.expr(&c.value)?; self.predicate(&f)?; }
                    if let Some(name) = result { self.bind(name, row); }
                },
                Stmt::Insert { row, .. } => { self.expr(row)?; },
                Stmt::InsertIfAbsent { table, row, result } => { self.expr(row)?; self.bind(result, Fact::row(table)); },
                Stmt::Update { key, patch, .. } | Stmt::Upsert { key, row: patch, .. } => {
                    let f = self.expr(key)?; self.predicate(&f)?; self.expr(patch)?;
                },
                Stmt::Delete { key, .. } => { let f = self.expr(key)?; self.predicate(&f)?; },
                Stmt::DeleteTarget { target } => { self.read(target)?; },
                Stmt::Emit { payload, once, .. } => { self.expr(payload)?; if let Some(e) = once { self.expr(e)?; } },
                Stmt::Break | Stmt::Continue => {},
            }
        }
        Ok(out)
    }
}
