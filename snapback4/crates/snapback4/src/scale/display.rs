use super::*;

impl Certificate {
    pub(crate) fn line(&self) -> String {
        let scope = if self.per_chunk { "per chunk — " } else { "" };
        let verdict = match self.class {
            Class::Constant => format!("constant — at most {} rows examined, {} probes, {} lanes", self.bounds.rows_examined, self.bounds.probes, self.bounds.lanes.map_or_else(|| "meter-bounded".into(), |n| n.to_string())),
            Class::Grows => format!("grows with {}", self.growth_sites.iter().map(|g| g.reason.as_str()).collect::<Vec<_>>().join("; ")),
        };
        let writes = if self.per_write.is_empty() { String::new() } else { format!("; per write: {}", self.per_write.join("; ")) };
        let sweep = if self.whole_job.is_empty() { String::new() } else { format!("; whole job grows with {}", self.whole_job.join("; ")) };
        format!("scale: {scope}{verdict}{writes}{sweep}")
    }
}

pub(crate) fn summary(certificates: &[Certificate]) -> String {
    let grows: Vec<_> = certificates.iter().filter(|c| c.class == Class::Grows).map(|c| c.operation.as_str()).collect();
    let chunks = certificates.iter().filter(|c| c.per_chunk).count();
    format!("scale: {} of {} operations are constant; {} grow with data{}{} — check --cost explains",
        certificates.len() - grows.len(), certificates.len(), grows.len(),
        if grows.is_empty() { String::new() } else { format!(" ({})", grows.join(", ")) },
        if chunks == 0 { String::new() } else { format!("; {chunks} job(s) assessed per chunk") })
}

pub(super) fn bound(b: &Bound) -> String {
    match b { Bound::Literal(n) => n.to_string(), Bound::Meter => "the domain".into(), Bound::Arg { name, max } => format!("{name} (at most {max})") }
}

pub(super) fn domain(schema: &Schema, scan: &Scan) -> String {
    let pins: Vec<_> = schema.table(&scan.table).and_then(|t| t.index(&scan.index)).into_iter()
        .flat_map(|i| i.components.iter().zip(&scan.prefix))
        .filter_map(|(c, key)| c.key_name().zip(key.scalar()).map(|(name, e)| format!(".{name} = {}", expr(e)))).collect();
    if pins.is_empty() { scan.table.clone() } else { format!("{} where {}", scan.table, pins.join(" and ")) }
}

pub(super) fn expr(e: &Expr) -> String { render(e, &BTreeMap::new()) }

fn render(e: &Expr, env: &BTreeMap<String, String>) -> String {
    let sub = |e: &Expr| render(e, env);
    match e {
        Expr::Literal(Value::String(s) | Value::Id(s)) => format!("'{s}'"),
        Expr::Literal(v) => snapback4_core::wire::to_json(v).to_string(),
        Expr::Variable(s) => if s == "$filter" { String::new() } else { env.get(s).cloned().unwrap_or_else(|| s.clone()) },
        Expr::Input(input) => match input { Input::Viewer => "viewer", Input::Now => "now", Input::NewId => "new", Input::ReadTime => "read time" }.into(),
        Expr::Field { base, name } => format!("{}.{name}", sub(base)),
        Expr::Unary { op, value } => format!("{}{}", if *op == UnaryOp::Not { "not " } else { "-" }, sub(value)),
        Expr::Binary { op, left, right } => format!("({} {} {})", sub(left), match op {
            BinaryOp::Eq | BinaryOp::SameValueZero => "=", BinaryOp::Ne => "!=", BinaryOp::Lt => "<", BinaryOp::Lte => "<=", BinaryOp::Gt => ">", BinaryOp::Gte => ">=", BinaryOp::Add => "+", BinaryOp::Sub => "-", BinaryOp::Mul => "*", BinaryOp::And => "and", BinaryOp::Or => "or",
        }, sub(right)),
        Expr::Get(r) | Expr::Exists(r) => format!("{}{}[{}]", if matches!(e, Expr::Exists(_)) { "exists " } else { "" }, r.table, r.key.iter().map(sub).collect::<Vec<_>>().join(", ")),
        Expr::Builtin { builtin, args } => format!("{}({})", match builtin { Builtin::Calendar { millis: 3_600_000 } => "hour".into(), Builtin::Calendar { millis: 86_400_000 } => "day".into(), b => format!("{b:?}").to_lowercase() }, args.iter().map(sub).collect::<Vec<_>>().join(", ")),
        Expr::Array(items) => format!("[{}]", items.iter().map(sub).collect::<Vec<_>>().join(", ")),
        Expr::Scan(s) => format!("{} domain", s.table),
        Expr::Merge(m) => format!("{} merge", m.table()),
        Expr::Block { body, value } => { let mut env = env.clone(); render_body(body, &mut env); render(value, &env) },
        Expr::Object(_) | Expr::Shape { .. } => "projected value".into(),
    }
}

// The binder lowers short-circuit predicates into temporary locals. Recover
// their conditional expressions from IR so the builder never sees `$bool3`.
fn render_body(body: &[Stmt], env: &mut BTreeMap<String, String>) {
    for stmt in body {
        match stmt {
            Stmt::Let { name, value } | Stmt::Const { name, value } | Stmt::Assign { name, value } => {
                let text = render(value, env); env.insert(name.clone(), text);
            }
            Stmt::If { condition, then_body, else_body } => {
                let condition = render(condition, env);
                let mut yes = env.clone(); let mut no = env.clone();
                render_body(then_body, &mut yes); render_body(else_body, &mut no);
                let keys: BTreeSet<_> = yes.keys().chain(no.keys()).cloned().collect();
                for key in keys {
                    let a = yes.get(&key).cloned().unwrap_or_else(|| key.clone());
                    let b = no.get(&key).cloned().unwrap_or_else(|| key.clone());
                    let value = if a == b { a }
                        else if b == condition { format!("({b} and {a})") }
                        else if condition == format!("not {b}") { format!("({b} or {a})") }
                        else { format!("({a} if {condition} else {b})") };
                    env.insert(key, value);
                }
            }
            _ => {}
        }
    }
}

/// Recognize literal ranges and common clock/argument windows without
/// pricing expression steps. Equality is structural, not a source-text guess.
pub(super) fn range_size(start: &Expr, end: &Expr) -> Option<u64> {
    fn offset(e: &Expr) -> (&Expr, i64) {
        match e {
            Expr::Binary { op: BinaryOp::Add, left, right } if matches!(**right, Expr::Literal(Value::Int(_))) => {
                let Expr::Literal(Value::Int(n)) = **right else { unreachable!() }; (left, n)
            }
            Expr::Binary { op: BinaryOp::Sub, left, right } if matches!(**right, Expr::Literal(Value::Int(_))) => {
                let Expr::Literal(Value::Int(n)) = **right else { unreachable!() }; (left, n.saturating_neg())
            }
            _ => (e, 0),
        }
    }
    if let (Expr::Literal(Value::Int(a)), Expr::Literal(Value::Int(b))) = (start, end) { return Some(b.saturating_sub(*a).max(0) as u64); }
    let (a, lo) = offset(start);
    let (b, hi) = offset(end);
    if a == b { return Some(hi.saturating_sub(lo).max(0) as u64); }
    // @ref LLP 3000.013#2.1 — inclusive bucket windows have a bounded
    // lane count even though both endpoints move with the clock. For the
    // same base, floor((x+b)/m)-floor((x+a)/m) <= ceil((b-a)/m).
    if let (Expr::Builtin { builtin: Builtin::Calendar { millis: am }, args: aa },
        Expr::Builtin { builtin: Builtin::Calendar { millis: bm }, args: ba }) = (a, b)
        && am == bm && *am > 0
        && let ([a], [b]) = (aa.as_slice(), ba.as_slice()) {
        let (a, delta_a) = offset(a);
        let (b, delta_b) = offset(b);
        if a == b {
            let span = i128::from(delta_b) - i128::from(delta_a);
            let period = i128::from(*am);
            let buckets = span.div_euclid(period) + i128::from(span.rem_euclid(period) != 0);
            return u64::try_from((buckets + i128::from(hi) - i128::from(lo)).max(0)).ok();
        }
    }
    None
}
