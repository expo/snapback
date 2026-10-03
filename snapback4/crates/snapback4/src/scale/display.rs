use super::*;

impl Certificate {
    pub(crate) fn line(&self) -> String {
        let scope = if self.per_chunk { "per chunk — " } else { "" };
        let verdict = match self.class {
            Class::Constant => format!("constant — at most {} rows examined, {} probes, {} lanes", self.bounds.rows_examined, self.bounds.probes, self.bounds.lanes.map_or_else(|| "meter-bounded".into(), |n| n.to_string())),
            // A cleanup site keeps its own words inside a growing certificate: under a condition
            // whose only extra work is cleanup, that variant is constant once cleanup catches up.
            Class::Grows if self.growth_sites.iter().any(|g| g.when.is_some()) => self.growth_sites.iter().map(|g| match (&g.when, g.backlog) {
                (Some(when), true) if self.variants.iter().any(|v| &v.when == when && v.class == Class::Backlog) =>
                    format!("when {when}: constant once background cleanup catches up ({})", g.reason),
                (Some(when), true) => format!("when {when}: also, until background cleanup catches up, {}", g.reason),
                (None, true) => format!("also, until background cleanup catches up, {}", g.reason),
                (Some(when), false) => format!("when {when}: grows with {}", g.reason),
                (None, false) => format!("grows with {}", g.reason),
            }).collect::<Vec<_>>().join("; "),
            Class::Grows => {
                let (cleanup, grows): (Vec<_>, Vec<_>) = self.growth_sites.iter().partition(|g| g.backlog);
                let reasons = |sites: &[&Growth]| sites.iter().map(|g| g.reason.as_str()).collect::<Vec<_>>().join("; ");
                let also = if cleanup.is_empty() { String::new() } else { format!("; also, until background cleanup catches up, {}", reasons(&cleanup)) };
                format!("grows with {}{also}", reasons(&grows))
            }
            Class::Backlog => format!("constant once background cleanup catches up; until then at most {} rows examined: {}",
                self.bounds.rows_examined, self.growth_sites.iter().map(|g| match &g.when {
                    Some(when) => format!("when {when}: {}", g.reason), None => g.reason.clone(),
                }).collect::<Vec<_>>().join("; ")),
        };
        let writes = if self.per_write.is_empty() { String::new() } else { format!("; per write: {}", self.per_write.join("; ")) };
        let sweep = if self.whole_job.is_empty() { String::new() } else { format!("; whole job grows with {}", self.whole_job.join("; ")) };
        let constants = self.variants.iter().filter(|variant| variant.class == Class::Constant)
            .map(|variant| format!("; when {}: constant", variant.when)).collect::<String>();
        format!("scale: {scope}{verdict}{constants}{writes}{sweep}{}", self.search_decoration.as_ref().map_or(String::new(), |plan|format!("; {plan}")))
    }
}

/// A presence test: the binding it tests (its runtime name, or the searched
/// expression's text), whether it tests a search, and whether it tests "present".
pub(super) fn presence(expr: &Expr) -> Option<(String, bool, bool)> {
    match expr {
        Expr::Binary { op: op @ (BinaryOp::Eq | BinaryOp::Ne), left, right } => {
            let input = match (left.as_ref(), right.as_ref()) {
                (Expr::Variable(name), Expr::Literal(Value::Null)) | (Expr::Literal(Value::Null), Expr::Variable(name)) => name,
                _ => return None,
            };
            Some((input.clone(), false, *op == BinaryOp::Ne))
        }
        Expr::Builtin { builtin: Builtin::SearchPresent, args } => Some((match &args[0] {
            Expr::Variable(name) => name.clone(),
            value => self::expr(value),
        }, true, true)),
        _ => None,
    }
}

pub(super) fn author_name(name: &str) -> String {
    if let Some(local) = name.strip_prefix('$') { local.trim_end_matches(|ch: char| ch.is_ascii_digit()).into() }
    else { name.into() }
}

pub(super) fn conditions(conditions: &[(String, bool)]) -> Option<String> {
    if conditions.is_empty() { return None; }
    let render = |present| {
        // One spelling for one state, whatever order the tests nest in.
        let mut names: Vec<_> = conditions.iter().filter(|(_, value)| *value == present).map(|(name, _)| name.as_str()).collect();
        names.sort_unstable();
        if names.is_empty() { return None; }
        let verb = if names.len() == 1 { "is" } else if names.len() == 2 { "are both" } else { "are all" };
        Some(format!("{} {verb} {}", names.join(" and "), if present { "present" } else { "absent" }))
    };
    Some([render(true), render(false)].into_iter().flatten().collect::<Vec<_>>().join(" and "))
}

pub(crate) fn summary(certificates: &[Certificate]) -> String {
    let of = |class: Class| certificates.iter().filter(|c| c.class == class).map(|c| c.operation.as_str()).collect::<Vec<_>>();
    let (grows, backlog) = (of(Class::Grows), of(Class::Backlog));
    let named = |names: &[&str]| if names.is_empty() { String::new() } else { format!(" ({})", names.join(", ")) };
    let chunks = certificates.iter().filter(|c| c.per_chunk).count();
    // @ref LLP 3000.013#14.4 — a backlog is counted apart from growth with the corpus.
    let cleanup = if backlog.is_empty() { String::new() } else { format!("; {} constant once background cleanup catches up{}", backlog.len(), named(&backlog)) };
    format!("scale: {} of {} operations are constant{cleanup}; {} grow with data{}{} — `check --cost` gives the certificate",
        certificates.len() - grows.len() - backlog.len(), certificates.len(), grows.len(), named(&grows),
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

pub(crate) fn expr(e: &Expr) -> String { render(e, &BTreeMap::new()) }

fn render(e: &Expr, env: &BTreeMap<String, String>) -> String {
    let sub = |e: &Expr| render(e, env);
    match e {
        Expr::Literal(Value::String(s) | Value::Id(s)) => snapback4_lang::print::quote(s),
        Expr::Literal(v) => snapback4_core::wire::to_json(v).to_string(),
        Expr::Variable(s) => if s == "$filter" { String::new() } else { env.get(s).cloned().unwrap_or_else(|| s.clone()) },
        Expr::Input(input) => match input { Input::Viewer => "viewer", Input::Now => "now", Input::NewId => "new", Input::ReadTime => "read time" }.into(),
        Expr::Field { base, name } => format!("{}.{name}", sub(base)),
        Expr::Unary { op, value } => {
            let value = sub(value);
            if *op == UnaryOp::Not { format!("not {value}") }
            else if value.starts_with('-') { format!("-({value})") } else { format!("-{value}") }
        }
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
                        else if a == condition { format!("({a} or {b})") }
                        else if condition == format!("not {b}") { format!("({b} or {a})") }
                        else { format!("({a} if {condition} else {b})") };
                    env.insert(key, value);
                }
            }
            Stmt::For { binding, domain, body } => {
                // `in` is lowered to false, then an equality loop that sets
                // true and breaks. Ignoring the loop prints the initializer.
                if let Some((name, needle)) = membership_loop(binding, body)
                    && env.get(name).is_some_and(|value| value == "false") {
                    let values = match domain {
                        LoopDomain::ArgList { name, .. } => env.get(name).cloned().unwrap_or_else(|| name.clone()),
                        LoopDomain::DerivedArray { value, .. } => render(value, env),
                        LoopDomain::LiteralRange { start, end_exclusive } => format!("range({start}, {end_exclusive})"),
                        LoopDomain::ExpressionRange { start, end_exclusive } => format!("range({}, {})", render(start, env), render(end_exclusive, env)),
                        LoopDomain::Page(scan) => format!("{} domain", scan.table),
                        LoopDomain::Recurse(_) => "walk domain".into(),
                    };
                    env.insert(name.into(), format!("({} in {values})", render(needle, env)));
                } else {
                    forget_loop_writes(body, env);
                }
            }
            _ => {}
        }
    }
}

fn membership_loop<'a>(binding: &str, body: &'a [Stmt]) -> Option<(&'a str, &'a Expr)> {
    let [Stmt::If { condition: Expr::Binary { op: BinaryOp::Eq, left, right }, then_body, else_body }] = body else { return None; };
    let [Stmt::Assign { name, value: Expr::Literal(Value::Bool(true)) }, Stmt::Break] = then_body.as_slice() else { return None; };
    if !else_body.is_empty() || right.as_ref() != &Expr::Variable(binding.into()) { return None; }
    Some((name, left))
}

fn forget_loop_writes(body: &[Stmt], env: &mut BTreeMap<String, String>) {
    for stmt in body {
        match stmt {
            Stmt::Assign { name, .. } | Stmt::Push { target: name, .. } => { env.insert(name.clone(), "loop result".into()); }
            Stmt::If { then_body, else_body, .. } => { forget_loop_writes(then_body, env); forget_loop_writes(else_body, env); }
            Stmt::For { body, .. } => forget_loop_writes(body, env),
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
