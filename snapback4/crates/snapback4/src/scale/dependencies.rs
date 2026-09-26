//! Monotone data-dependency propagation, separate from meter accounting.
use super::*;

type Locals = BTreeMap<String, bool>;

// A boolean per IR local forms a finite lattice. Revisit the body until no
// assignment adds a dependency; never price reads, probes or writes here.
// @ref LLP 3000.013#9 — a bounded read's value can still drive growing work.
pub(super) fn fixed_point(data: &mut Locals, statements: &[Stmt]) {
    loop {
        let previous = data.clone();
        body(data, statements);
        if *data == previous { break; }
    }
}

fn bind(data: &mut Locals, name: &str, dependent: bool) {
    *data.entry(name.into()).or_default() |= dependent;
}

fn body(data: &mut Locals, statements: &[Stmt]) {
    for stmt in statements {
        match stmt {
            Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value }
            | Stmt::Push { target: name, value } => {
                let dependent = expr(data, value);
                bind(data, name, dependent);
            }
            Stmt::For { binding, domain: value, body: statements } => {
                let dependent = domain(data, value);
                bind(data, binding, dependent);
                // The enclosing fixed point also closes nested loops.
                body(data, statements);
            }
            Stmt::If { condition, then_body, else_body } => {
                expr(data, condition);
                body(data, then_body);
                body(data, else_body);
            }
            Stmt::Return(value) | Stmt::Require { condition: value, .. } => { expr(data, value); }
            Stmt::Emit { payload, once, .. } => {
                expr(data, payload);
                if let Some(key) = once { expr(data, key); }
            }
            Stmt::Check { condition, current } => { expr(data, condition); read(data, current); }
            Stmt::Insert { row, .. } | Stmt::InsertIfAbsent { row, .. } => {
                expr(data, row);
                if let Stmt::InsertIfAbsent { result, .. } = stmt { bind(data, result, true); }
            }
            Stmt::Update { key, patch: value, .. } | Stmt::Upsert { key, row: value, .. } => {
                expr(data, key); expr(data, value);
            }
            Stmt::Delete { key, .. } => { expr(data, key); }
            Stmt::DeleteTarget { target } => { read(data, target); }
            Stmt::WriteTarget { target, patch, condition, result, .. } => {
                read(data, target); expr(data, patch);
                if let Some(c) = condition { body(data, &c.setup); expr(data, &c.value); }
                if let Some(name) = result { bind(data, name, true); }
            }
            Stmt::Break | Stmt::Continue => {}
        }
    }
}

fn domain(data: &mut Locals, value: &LoopDomain) -> bool {
    match value {
        LoopDomain::Page(s) => { scan(data, s); true }
        LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => false,
        LoopDomain::ExpressionRange { start, end_exclusive } => expr(data, start) | expr(data, end_exclusive),
        LoopDomain::DerivedArray { value, .. } => expr(data, value),
        LoopDomain::Recurse(r) => { expr(data, &r.seed); true }
    }
}

fn read(data: &mut Locals, read: &Read) {
    for key in &read.key { expr(data, key); }
}

fn scan(data: &mut Locals, scan: &Scan) {
    for key in &scan.prefix {
        match key { IndexKeyExpr::Scalar(e) | IndexKeyExpr::WordPrefix(e) => { expr(data, e); } }
    }
    for value in [&scan.after, &scan.before, &scan.filter].into_iter().flatten() { expr(data, value); }
    if let Some(r) = &scan.range {
        for value in [&r.gt, &r.gte, &r.lt, &r.lte].into_iter().flatten() { expr(data, value); }
    }
}

fn expr(data: &mut Locals, value: &Expr) -> bool {
    match value {
        Expr::Literal(_) | Expr::Input(_) => false,
        Expr::Variable(name) => data.get(name).copied().unwrap_or(true),
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => expr(data, base),
        Expr::Array(values) => values.iter().fold(false, |d, e| expr(data, e) | d),
        Expr::Object(values) => values.values().fold(false, |d, e| expr(data, e) | d),
        Expr::Shape { base, fields } => {
            let dependent = expr(data, base);
            fields.values().fold(dependent, |d, e| expr(data, e) | d)
        }
        Expr::Binary { left, right, .. } => expr(data, left) | expr(data, right),
        Expr::Builtin { builtin, args } => builtin.operands(args).fold(matches!(builtin, Builtin::Connected), |d, e| expr(data, e) | d),
        Expr::Get(r) | Expr::Exists(r) => { read(data, r); true }
        Expr::Block { body: statements, value } => { body(data, statements); expr(data, value) }
        Expr::Scan(s) => { scan(data, s); true }
        Expr::Merge(m) => {
            if let Some(after) = m.position.as_ref().and_then(|p| p.after.as_ref()) { expr(data, after); }
            for lane in &m.lanes {
                if let Some(guard) = &lane.guard { expr(data, guard); }
                match &lane.source {
                    None => {}
                    Some(LaneSource::Scan(s)) => scan(data, s),
                    Some(LaneSource::List { value, .. }) => { expr(data, value); }
                    Some(LaneSource::Range { start, end_exclusive, .. }) => { expr(data, start); expr(data, end_exclusive); }
                }
                bind(data, &lane.binding, lane.source.is_some());
                if let Some(distinct) = &lane.distinct { expr(data, distinct); }
                body(data, &lane.setup);
                scan(data, &lane.scan);
                if let Some(project) = &lane.project { expr(data, project); }
            }
            true
        }
    }
}
