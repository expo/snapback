//! A syntactic returned-shape mark, with a single-use census of lowered names.
use super::*;

// @ref LLP 3000.007#5.6 — rewind only a top-level returned shape over an inline read or its single-definition, single-use variable.
pub(super) fn marks(body: &[Stmt], program: &str, candidates: &[usize]) -> BTreeMap<String, String> {
    if candidates.is_empty() { return BTreeMap::new(); }
    let mut census = Census::default();
    census.body(body);
    candidates.iter().filter_map(|&index| {
        let Stmt::For { domain, body: shape, .. } = body.get(index)? else { return None; };
        let Stmt::Return(Expr::Variable(target)) = body.get(index + 1)? else { return None; };
        if !matches!(shape.last(), Some(Stmt::Push { target: pushed, .. }) if pushed == target) { return None; }
        let page = match domain {
            LoopDomain::Page(scan) => &scan.site,
            LoopDomain::DerivedArray { value: Expr::Merge(merge), .. } => &merge.site,
            LoopDomain::DerivedArray { value: Expr::Variable(name), .. }
                if census.definitions.get(name) == Some(&1) && census.uses.get(name) == Some(&1) => census.reads.get(name)?,
            _ => return None,
        };
        Some((format!("{program}:{}", index + 1), page.clone()))
    }).collect()
}

#[derive(Default)]
struct Census {
    definitions: BTreeMap<String, usize>,
    uses: BTreeMap<String, usize>,
    reads: BTreeMap<String, String>,
}

impl Census {
    fn use_name(&mut self, name: &str) { *self.uses.entry(name.to_owned()).or_default() += 1; }
    fn define(&mut self, name: &str) { *self.definitions.entry(name.to_owned()).or_default() += 1; }

    fn body(&mut self, body: &[Stmt]) {
        for stmt in body {
            match stmt {
                Stmt::Let { name, value } | Stmt::Const { name, value } | Stmt::Assign { name, value } => {
                    self.define(name);
                    match value {
                        Expr::Scan(scan) => { self.reads.insert(name.clone(), scan.site.clone()); }
                        Expr::Merge(merge) => { self.reads.insert(name.clone(), merge.site.clone()); }
                        _ => {}
                    }
                    self.expr(value);
                }
                Stmt::Push { target, value } => { self.define(target); self.expr(value); }
                Stmt::If { condition, then_body, else_body } => { self.expr(condition); self.body(then_body); self.body(else_body); }
                Stmt::For { binding, domain, body } => {
                    self.define(binding);
                    match domain {
                        LoopDomain::Page(scan) => self.scan(scan),
                        LoopDomain::DerivedArray { value, .. } => self.expr(value),
                        LoopDomain::ExpressionRange { start, end_exclusive } => { self.expr(start); self.expr(end_exclusive); }
                        LoopDomain::ArgList { name, .. } => self.use_name(name),
                        LoopDomain::Recurse(recurse) => self.expr(&recurse.seed),
                        LoopDomain::LiteralRange { .. } => {}
                    }
                    self.body(body);
                }
                Stmt::Return(value) | Stmt::Require { condition: value, .. }
                | Stmt::Insert { row: value, .. } => self.expr(value),
                Stmt::Emit { payload, once, .. } => { self.expr(payload); if let Some(key) = once { self.expr(key); } },
                Stmt::InsertIfAbsent { row, result, .. } => { self.define(result); self.expr(row); }
                Stmt::Check { condition, current } => { self.expr(condition); self.read(current); }
                Stmt::Update { key, patch, .. } => { self.expr(key); self.expr(patch); }
                Stmt::Upsert { key, row, .. } => { self.expr(key); self.expr(row); }
                Stmt::WriteTarget { target, patch, condition, result, .. } => {
                    self.read(target); self.expr(patch);
                    if let Some(condition) = condition { self.body(&condition.setup); self.expr(&condition.value); }
                    if let Some(result) = result { self.define(result); }
                }
                Stmt::Delete { key, .. } => self.expr(key),
                Stmt::DeleteTarget { target } => self.read(target),
                Stmt::Break | Stmt::Continue => {}
            }
        }
    }

    fn read(&mut self, read: &Read) { for key in &read.key { self.expr(key); } }

    fn scan(&mut self, scan: &Scan) {
        for key in &scan.prefix {
            match key { IndexKeyExpr::Scalar(value) | IndexKeyExpr::WordPrefix(value) => self.expr(value) }
        }
        if let Bound::Arg { name, .. } = &scan.take { self.use_name(name); }
        for value in [&scan.after, &scan.before, &scan.filter].into_iter().flatten() { self.expr(value); }
        if let Some(range) = &scan.range {
            for value in [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten() { self.expr(value); }
        }
    }

    fn expr(&mut self, value: &Expr) {
        match value {
            Expr::Variable(name) => self.use_name(name),
            Expr::Array(items) | Expr::Builtin { args: items, .. } => { for item in items { self.expr(item); } }
            Expr::Object(fields) => { for field in fields.values() { self.expr(field); } }
            Expr::Shape { base, fields } => { self.expr(base); for field in fields.values() { self.expr(field); } }
            Expr::Field { base, .. } | Expr::Unary { value: base, .. } => self.expr(base),
            Expr::Binary { left, right, .. } => { self.expr(left); self.expr(right); }
            Expr::Get(read) | Expr::Exists(read) => self.read(read),
            Expr::Scan(scan) => self.scan(scan),
            Expr::Merge(merge) => {
                for lane in &merge.lanes {
                    self.define(&lane.binding);
                    self.body(&lane.setup);
                    if let Some(source) = &lane.source {
                        if let Some(scan) = source.scan() { self.scan(scan); }
                        for value in source.expressions() { self.expr(value); }
                    }
                    self.scan(&lane.scan);
                }
            }
            Expr::Block { body, value } => { self.body(body); self.expr(value); }
            Expr::Literal(_) | Expr::Input(_) => {}
        }
    }
}
