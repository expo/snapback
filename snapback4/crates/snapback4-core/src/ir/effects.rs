//! Exhaustive effects, including expression blocks and inlined helpers.
// @ref LLP 3000.017#2.2 — write_tables is not an admission boundary.
use super::*;
use std::collections::BTreeSet;
mod renewal;

#[derive(Default, Debug)]
pub struct Effects {
    pub reads: BTreeSet<String>,
    pub writes: BTreeSet<String>,
    pub renews: bool,
    pub emit: bool,
}
impl Effects {
    pub fn writes_in(body: &[Stmt]) -> bool {
        let mut effects = Self::default();
        effects.statements(body);
        !effects.writes.is_empty()
    }
    pub fn of(program: &Program, schema: &crate::schema::Schema) -> Self {
        let mut effects = Self::default();
        effects.statements(&program.body);
        effects.renews = renewal::prove(program, schema);
        effects
    }
    fn write(&mut self, table: &str) {
        self.writes.insert(table.into());
    }
    fn target(&mut self, read: &Read) {
        self.writes.insert(read.table.clone());
        self.read(read);
    }
    fn statements(&mut self, body: &[Stmt]) {
        for stmt in body {
            match stmt {
                Stmt::Const { value, .. }
                | Stmt::Let { value, .. }
                | Stmt::Assign { value, .. } => {
                    self.expression(value);
                }
                Stmt::Push { value, .. } => self.expression(value),
                Stmt::Return(value)
                | Stmt::Require {
                    condition: value, ..
                } => self.expression(value),
                Stmt::Check { condition, current } => {
                    self.expression(condition);
                    self.read(current);
                }
                Stmt::If {
                    condition,
                    then_body,
                    else_body,
                } => {
                    self.expression(condition);
                    self.statements(then_body);
                    self.statements(else_body);
                }
                Stmt::For { domain, body, .. } => {
                    self.domain(domain);
                    self.statements(body);
                }
                Stmt::Insert { table, row } | Stmt::InsertIfAbsent { table, row, .. } => {
                    self.write(table);
                    self.expression(row);
                }
                Stmt::Update { table, key, patch } => {
                    self.write(table);
                    self.expression(key);
                    self.expression(patch);
                }
                Stmt::Upsert { table, key, row } => {
                    self.write(table);
                    self.expression(key);
                    self.expression(row);
                }
                Stmt::WriteTarget {
                    target,
                    patch,
                    condition,
                    ..
                } => {
                    self.target(target);
                    self.expression(patch);
                    if let Some(c) = condition {
                        self.statements(&c.setup);
                        self.expression(&c.value);
                    }
                }
                Stmt::Delete { table, key } => {
                    self.write(table);
                    self.expression(key);
                }
                Stmt::DeleteTarget { target } => self.target(target),
                Stmt::Emit { payload, once, .. } => {
                    self.emit = true;
                    self.expression(payload);
                    if let Some(e) = once {
                        self.expression(e);
                    }
                }
                Stmt::Break | Stmt::Continue => {}
            }
        }
    }
    fn domain(&mut self, domain: &LoopDomain) {
        match domain {
            LoopDomain::Page(scan) => self.scan(scan),
            LoopDomain::ExpressionRange {
                start,
                end_exclusive,
            } => {
                self.expression(start);
                self.expression(end_exclusive);
            }
            LoopDomain::DerivedArray { value, .. } => self.expression(value),
            LoopDomain::Recurse(r) => {
                self.reads.insert(r.table.clone());
                self.expression(&r.seed);
            }
            LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => {}
        }
    }
    fn read(&mut self, read: &Read) {
        self.reads.insert(read.table.clone());
        for key in &read.key {
            self.expression(key);
        }
    }
    fn scan(&mut self, scan: &Scan) {
        self.reads.insert(scan.table.clone());
        for key in &scan.prefix {
            match key {
                IndexKeyExpr::Scalar(e) | IndexKeyExpr::WordPrefix(e) => self.expression(e),
            }
        }
        for e in [&scan.filter, &scan.after, &scan.before]
            .into_iter()
            .flatten()
        {
            self.expression(e);
        }
        if let Some(r) = &scan.range {
            for e in [&r.gt, &r.gte, &r.lt, &r.lte].into_iter().flatten() {
                self.expression(e);
            }
        }
    }
    fn expression(&mut self, expr: &Expr) {
        match expr {
            Expr::Block { body, value } => {
                self.statements(body);
                self.expression(value);
            }
            Expr::Builtin { args, .. } => {
                for arg in args { self.expression(arg); }
            }
            Expr::Array(xs) => {
                for x in xs {
                    self.expression(x);
                }
            }
            Expr::Object(xs) => {
                for x in xs.values() {
                    self.expression(x);
                }
            }
            Expr::Shape { base, fields } => {
                self.expression(base);
                for x in fields.values() {
                    self.expression(x);
                }
            }
            Expr::Field { base, .. } | Expr::Unary { value: base, .. } => self.expression(base),
            Expr::Binary { left, right, .. } => {
                self.expression(left);
                self.expression(right);
            }
            Expr::Get(read) | Expr::Exists(read) => self.read(read),
            Expr::Scan(scan) => self.scan(scan),
            Expr::Merge(merge) => {
                if let Some(e) = merge.position.as_ref().and_then(|p| p.after.as_deref()) {
                    self.expression(e);
                }
                for lane in &merge.lanes {
                    self.statements(&lane.setup);
                    self.scan(&lane.scan);
                    for e in [&lane.guard, &lane.distinct, &lane.project]
                        .into_iter()
                        .flatten()
                    {
                        self.expression(e);
                    }
                    if let Some(source) = &lane.source {
                        // No wildcard: a new lane kind must declare its effects.
                        match source {
                            LaneSource::Scan(s) => self.scan(s),
                            LaneSource::Range {
                                start,
                                end_exclusive,
                                ..
                            } => {
                                self.expression(start);
                                self.expression(end_exclusive);
                            }
                            LaneSource::List { value, .. } => self.expression(value),
                        }
                    }
                }
            }
            Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
        }
    }
}
