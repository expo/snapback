//! Exhaustive effects, including expression blocks and inlined helpers.
// @ref LLP 3000.017#2.2-ephemeral-mutations — write_tables is not an admission boundary.
use super::*;
use std::collections::BTreeSet;

#[derive(Default, Debug)]
pub struct Effects {
    pub reads: BTreeSet<String>,
    pub writes: BTreeSet<String>,
    pub renews: bool,
    pub emit: bool,
    stable: BTreeSet<String>,
}
impl Effects {
    pub fn of(program: &Program) -> Self {
        let mut effects = Self { renews: true, stable: program.args.keys().cloned().collect(), ..Self::default() };
        effects.statements(&program.body);
        effects.renews &= !effects.writes.is_empty();
        effects
    }
    fn stable(&self, expr: &Expr) -> bool {
        match expr {
            Expr::Variable(name) => self.stable.contains(name),
            Expr::Literal(_) | Expr::Input(Input::Viewer) => true,
            Expr::Array(xs) => xs.iter().all(|x| self.stable(x)),
            Expr::Object(xs) => xs.values().all(|x| self.stable(x)),
            Expr::Field { base, .. } | Expr::Unary { value: base, .. } => self.stable(base),
            Expr::Binary { left, right, .. } => self.stable(left) && self.stable(right),
            _ => false,
        }
    }
    fn write(&mut self, table: &str, key: Option<&Expr>) {
        self.writes.insert(table.into());
        self.renews &= key.is_some_and(|key| self.stable(key));
    }
    fn target(&mut self, read: &Read, renew: bool) {
        self.writes.insert(read.table.clone());
        self.renews &= renew && read.key.iter().all(|x| self.stable(x));
        self.read(read);
    }
    fn statements(&mut self, body: &[Stmt]) {
        for stmt in body {
            match stmt {
                Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value } => {
                    let stable = self.stable(value); self.expression(value);
                    if stable { self.stable.insert(name.clone()); } else { self.stable.remove(name); }
                }
                Stmt::Push { target, value } => { self.stable.remove(target); self.expression(value); }
                Stmt::Return(value) | Stmt::Require { condition: value, .. } => self.expression(value),
                Stmt::Check { condition, current } => { self.expression(condition); self.read(current); }
                Stmt::If { condition, then_body, else_body } => {
                    self.expression(condition);
                    let before = self.stable.clone(); self.statements(then_body); let then = self.stable.clone();
                    self.stable = before; self.statements(else_body); self.stable.retain(|v| then.contains(v));
                }
                Stmt::For { binding, domain, body } => {
                    self.domain(domain); let before = self.stable.clone(); self.stable.remove(binding);
                    self.statements(body); self.stable.retain(|v| before.contains(v));
                }
                Stmt::Insert { table, row } | Stmt::InsertIfAbsent { table, row, .. } => { self.write(table, None); self.expression(row); }
                Stmt::Update { table, key, patch } => { self.write(table, Some(key)); self.expression(key); self.expression(patch); }
                Stmt::Upsert { table, key, row } => { self.write(table, Some(key)); self.expression(key); self.expression(row); }
                Stmt::WriteTarget { target, patch, condition, .. } => {
                    self.target(target, true); self.expression(patch);
                    if let Some(c) = condition { self.statements(&c.setup); self.expression(&c.value); }
                }
                Stmt::Delete { table, key } => { self.write(table, None); self.expression(key); }
                Stmt::DeleteTarget { target } => self.target(target, false),
                Stmt::Emit { payload, once, .. } => { self.emit = true; self.expression(payload); if let Some(e) = once { self.expression(e); } }
                Stmt::Break | Stmt::Continue => {}
            }
        }
    }
    fn domain(&mut self, domain: &LoopDomain) {
        match domain {
            LoopDomain::Page(scan) => self.scan(scan),
            LoopDomain::ExpressionRange { start, end_exclusive } => { self.expression(start); self.expression(end_exclusive); }
            LoopDomain::DerivedArray { value, .. } => self.expression(value),
            LoopDomain::Recurse(r) => { self.reads.insert(r.table.clone()); self.expression(&r.seed); }
            LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => {}
        }
    }
    fn read(&mut self, read: &Read) { self.reads.insert(read.table.clone()); for key in &read.key { self.expression(key); } }
    fn scan(&mut self, scan: &Scan) {
        self.reads.insert(scan.table.clone());
        for key in &scan.prefix { match key { IndexKeyExpr::Scalar(e) | IndexKeyExpr::WordPrefix(e) => self.expression(e) } }
        for e in [&scan.filter, &scan.after, &scan.before].into_iter().flatten() { self.expression(e); }
        if let Some(r) = &scan.range { for e in [&r.gt, &r.gte, &r.lt, &r.lte].into_iter().flatten() { self.expression(e); } }
    }
    fn expression(&mut self, expr: &Expr) {
        match expr {
            Expr::Block { body, value } => { self.statements(body); self.expression(value); }
            Expr::Array(xs) | Expr::Builtin { args: xs, .. } => { for x in xs { self.expression(x); } }
            Expr::Object(xs) => { for x in xs.values() { self.expression(x); } }
            Expr::Shape { base, fields } => { self.expression(base); for x in fields.values() { self.expression(x); } }
            Expr::Field { base, .. } | Expr::Unary { value: base, .. } => self.expression(base),
            Expr::Binary { left, right, .. } => { self.expression(left); self.expression(right); }
            Expr::Get(read) | Expr::Exists(read) => self.read(read),
            Expr::Scan(scan) => self.scan(scan),
            Expr::Merge(merge) => {
                if let Some(e) = merge.position.as_ref().and_then(|p| p.after.as_deref()) { self.expression(e); }
                for lane in &merge.lanes {
                    self.statements(&lane.setup); self.scan(&lane.scan);
                    for e in [&lane.guard, &lane.distinct, &lane.project].into_iter().flatten() { self.expression(e); }
                    if let Some(source) = &lane.source {
                        // No wildcard: a new lane kind must declare its effects.
                        match source {
                            LaneSource::Scan(s) => self.scan(s),
                            LaneSource::Range { start, end_exclusive, .. } => { self.expression(start); self.expression(end_exclusive); }
                            LaneSource::List { value, .. } => self.expression(value),
                        }
                    }
                }
            }
            Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
        }
    }
}
