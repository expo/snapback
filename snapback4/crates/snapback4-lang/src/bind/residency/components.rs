//! Conservative ownership over the executable, already alpha-renamed IR.
use snapback4_core::{ir::*, schema::Component};
use std::collections::{BTreeMap, BTreeSet};

// @ref LLP 3000.001#proposed-composition-of-retained-and-authoritative-reads — only independent, cursor-free returned record fields get a device composition plan.
pub(super) fn plan(program: &Program) -> Vec<Component> {
    prove(program).unwrap_or_default()
}

fn cursor(arg: &ArgType) -> bool {
    match arg { ArgType::Cursor => true, ArgType::Optional(inner) | ArgType::List { of: Some(inner), .. } => cursor(inner), _ => false }
}

fn prove(program: &Program) -> Option<Vec<Component>> {
    if program.kind != ProgramKind::Query || program.native || program.args.values().any(cursor) { return None; }
    let (Stmt::Return(Expr::Object(fields)), body) = program.body.split_last()? else { return None };
    if fields.len() < 2 { return None; }
    let mut names = BTreeSet::new();
    for stmt in body {
        match stmt {
            Stmt::Let { name, .. } | Stmt::Const { name, .. } if names.insert(name.clone()) => {}
            Stmt::Require { .. } => {}
            _ => return None,
        }
    }
    let mut bindings: BTreeMap<String, (usize, Facts)> = BTreeMap::new();
    let mut guards = Vec::new();
    for (index, stmt) in body.iter().enumerate() {
        let value = match stmt { Stmt::Let { value, .. } | Stmt::Const { value, .. } => value, Stmt::Require { condition, .. } => condition, _ => return None };
        let facts = inspect(value, &names)?;
        // Forward references or shadowed top-level locals are never a proof.
        if facts.names.iter().any(|name| !program.args.contains_key(name) && !bindings.contains_key(name)) { return None; }
        match stmt {
            Stmt::Let { name, .. } | Stmt::Const { name, .. } => { bindings.insert(name.clone(), (index, facts)); }
            _ => guards.push(facts),
        }
    }
    fn dependencies(facts: &Facts, bindings: &BTreeMap<String, (usize, Facts)>, used: &mut BTreeSet<usize>, reads: &mut BTreeSet<usize>) {
        for name in &facts.names {
            if let Some((index, binding)) = bindings.get(name) && used.insert(*index) {
                if binding.reads > 0 { reads.insert(*index); }
                dependencies(binding, bindings, used, reads);
            }
        }
    }
    for guard in guards {
        let mut used = BTreeSet::new(); let mut reads = BTreeSet::new();
        dependencies(&guard, &bindings, &mut used, &mut reads);
        if guard.reads > 0 || !reads.is_empty() { return None; }
    }
    let mut owners: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let mut plans = Vec::new();
    for (field, value) in fields {
        let facts = inspect(value, &names)?;
        if facts.names.iter().any(|name| !program.args.contains_key(name) && !bindings.contains_key(name)) { return None; }
        let mut used = BTreeSet::new(); let mut reads = BTreeSet::new();
        dependencies(&facts, &bindings, &mut used, &mut reads);
        // Combining independently acquired bindings is not this slice's aggregate/join contract.
        let read_sites: usize = bindings.values().filter(|(index, _)| reads.contains(index)).map(|(_, facts)| facts.reads).sum();
        if read_sites + facts.reads > 1 { return None; }
        for index in used { owners.entry(index).or_default().push(plans.len()); }
        plans.push(Component { field: field.clone(), statements: Vec::new() });
    }
    for (index, facts) in bindings.values() {
        let fields = owners.get(index).map(Vec::as_slice).unwrap_or_default();
        if facts.reads > 0 && fields.len() != 1 { return None; }
        if let [field] = fields { plans[*field].statements.push(*index); }
    }
    for plan in &mut plans { plan.statements.sort_unstable(); }
    Some(plans)
}

#[derive(Default)]
struct Facts { names: BTreeSet<String>, locals: BTreeSet<String>, reads: usize }
fn inspect(value: &Expr, top: &BTreeSet<String>) -> Option<Facts> {
    let mut facts = Facts::default();
    facts.expr(value, top)?;
    Some(facts)
}
impl Facts {
    fn expr(&mut self, value: &Expr, top: &BTreeSet<String>) -> Option<()> {
        match value {
            Expr::Literal(_) | Expr::Input(_) => {}
            Expr::Variable(name) => { if !self.locals.contains(name) { self.names.insert(name.clone()); } }
            Expr::Field { base, .. } | Expr::Unary { value: base, .. } => self.expr(base, top)?,
            Expr::Array(values) => for value in values { self.expr(value, top)?; },
            Expr::Object(fields) => for value in fields.values() { self.expr(value, top)?; },
            Expr::Shape { base, fields } => { self.expr(base, top)?; for value in fields.values() { self.expr(value, top)?; } }
            Expr::Binary { left, right, .. } => { self.expr(left, top)?; self.expr(right, top)?; }
            Expr::Builtin { builtin, args } => {
                match builtin {
                    Builtin::Divmod { remainder_sink } if top.contains(remainder_sink) => return None,
                    Builtin::Connected => self.reads += 1,
                    Builtin::Count | Builtin::CountCapped | Builtin::Sum | Builtin::Calendar { .. } | Builtin::Len | Builtin::Slice | Builtin::Concat | Builtin::Lower | Builtin::Trim | Builtin::Sha256 | Builtin::Join | Builtin::Group { .. } | Builtin::First | Builtin::Last | Builtin::At | Builtin::Min | Builtin::Max | Builtin::Divmod { .. } | Builtin::Sort { .. } | Builtin::MentionTokens | Builtin::DeterministicShare => {}
                }
                for arg in args { self.expr(arg, top)?; }
            }
            Expr::Get(read) | Expr::Exists(read) => { self.reads += 1; for key in &read.key { self.expr(key, top)?; } }
            Expr::Scan(scan) => self.scan(scan, top)?,
            Expr::Merge(merge) => {
                self.reads += 1;
                for lane in &merge.lanes {
                    if top.contains(&lane.binding) { return None; }
                    self.locals.insert(lane.binding.clone());
                    self.stmts(&lane.setup, top)?;
                    if let Some(source) = &lane.source {
                        match source {
                            snapback4_core::ir::LaneSource::Scan(scan) => self.scan(scan, top)?,
                            other => { for value in other.expressions() { self.expr(value, top)?; } }
                        }
                    }
                    self.scan(&lane.scan, top)?;
                }
            }
            Expr::Block { body, value } => { self.stmts(body, top)?; self.expr(value, top)?; }
        }
        Some(())
    }
    fn scan(&mut self, scan: &Scan, top: &BTreeSet<String>) -> Option<()> {
        if scan.opaque_cursor || scan.after.is_some() || scan.before.is_some() { return None; }
        self.reads += 1;
        for key in &scan.prefix { match key { IndexKeyExpr::Scalar(value) | IndexKeyExpr::WordPrefix(value) => self.expr(value, top)? } }
        if let Bound::Arg { name, .. } = &scan.take { self.names.insert(name.clone()); }
        if let Some(range) = &scan.range { for value in [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten() { self.expr(value, top)?; } }
        if let Some(filter) = &scan.filter { self.expr(filter, top)?; }
        Some(())
    }
    fn stmts(&mut self, body: &[Stmt], top: &BTreeSet<String>) -> Option<()> {
        for stmt in body {
            match stmt {
                Stmt::Let { name, value } | Stmt::Const { name, value } => {
                    if top.contains(name) { return None; }
                    self.expr(value, top)?;
                    self.locals.insert(name.clone());
                }
                Stmt::Assign { name, value } | Stmt::Push { target: name, value } => {
                    if top.contains(name) || !self.locals.contains(name) { return None; }
                    self.expr(value, top)?;
                }
                Stmt::Return(value) | Stmt::Require { condition: value, .. } => self.expr(value, top)?,
                Stmt::If { condition, then_body, else_body } => { self.expr(condition, top)?; self.stmts(then_body, top)?; self.stmts(else_body, top)?; }
                Stmt::For { binding, domain, body } => {
                    if top.contains(binding) { return None; }
                    match domain {
                        LoopDomain::Page(scan) => self.scan(scan, top)?,
                        LoopDomain::Recurse(recurse) => { self.reads += 1; self.expr(&recurse.seed, top)?; }
                        LoopDomain::DerivedArray { value, .. } => self.expr(value, top)?,
                        LoopDomain::ExpressionRange { start, end_exclusive } => { self.expr(start, top)?; self.expr(end_exclusive, top)?; }
                        LoopDomain::ArgList { name, .. } => { self.names.insert(name.clone()); }
                        LoopDomain::LiteralRange { .. } => {}
                    }
                    self.locals.insert(binding.clone());
                    self.stmts(body, top)?;
                }
                Stmt::Break | Stmt::Continue => {}
                // No write, result sink, check or effect is a component proof.
                _ => return None,
            }
        }
        Some(())
    }
}
