//! Recognize the bucket/filter relationship from IR, never generated names.
use super::*;
use snapback4_core::schema::IndexComponent;

// @ref LLP 3000.013#2.1 — only the inclusive endpoint buckets can reject
// the exact time predicates. Other filters and read rules remain growing work.
pub(super) fn reason(schema: &Schema, lane: &MergeLane) -> Option<String> {
    if !lane.setup.is_empty() || lane.scan.take == Bound::Meter { return None; }
    let LaneSource::Range { start, end_exclusive, .. } = lane.source.as_ref()? else { return None; };
    let lanes = display::range_size(start, end_exclusive)?;
    let Expr::Builtin { builtin: Builtin::Calendar { millis }, args: lower } = start else { return None; };
    let Expr::Binary { op: BinaryOp::Add, left: end, right: one } = end_exclusive else { return None; };
    if **one != Expr::Literal(Value::Int(1)) { return None; }
    let Expr::Builtin { builtin: Builtin::Calendar { millis: upper_millis }, args: upper } = end.as_ref() else { return None; };
    if millis != upper_millis { return None; }
    let ([lower], [upper]) = (lower.as_slice(), upper.as_slice()) else { return None; };
    let unit = match *millis { 3_600_000 => "hours", 86_400_000 => "days", _ => return None };
    let table = schema.table(&lane.scan.table)?;
    let index = table.index(&lane.scan.index)?;
    let key = index.components.iter().zip(&lane.scan.prefix).find_map(|(component, pin)| {
        match (component, pin) {
            (IndexComponent::Calendar(key), IndexKeyExpr::Scalar(Expr::Variable(name)))
                if name == &lane.binding && key.millis == *millis && key.offset == 0 => Some(key),
            _ => None,
        }
    })?;
    let predicates = conjuncts(lane.scan.filter.as_ref()?, &BTreeMap::new())?;
    let mut has_lower = false;
    let mut has_upper = false;
    for predicate in predicates {
        let Expr::Binary { op, left, right } = predicate else { return None; };
        let Expr::Field { base, name } = left.as_ref() else { return None; };
        if **base != Expr::Variable("$filter".into()) || name != &key.column { return None; }
        match op {
            BinaryOp::Gt | BinaryOp::Gte if right.as_ref() == lower => has_lower = true,
            BinaryOp::Lt | BinaryOp::Lte if right.as_ref() == upper => has_upper = true,
            _ => return None,
        }
    }
    (has_lower && has_upper).then(|| format!(
        "{} rows in the window's two edge {unit} (window-bounded: at most {lanes} lanes, page {}; includes repeated skips and opening/refill lookahead; edge-bucket density is data-dependent)",
        lane.scan.table, display::bound(&lane.scan.take)))
}

type Facts = BTreeMap<String, Vec<Expr>>;

// Recover conjunctions from the binder's short-circuit temporaries. Refuse
// any unfamiliar control flow: a false negative keeps the ordinary warning.
fn conjuncts(expr: &Expr, locals: &Facts) -> Option<Vec<Expr>> {
    match expr {
        Expr::Variable(name) => locals.get(name).cloned(),
        Expr::Binary { op: BinaryOp::And, left, right } => {
            let mut facts = conjuncts(left, locals)?;
            facts.extend(conjuncts(right, locals)?);
            Some(facts)
        }
        Expr::Binary { op: BinaryOp::Gt | BinaryOp::Gte | BinaryOp::Lt | BinaryOp::Lte, .. } => Some(vec![expr.clone()]),
        Expr::Block { body, value } => {
            let mut locals = locals.clone();
            statements(body, &mut locals)?;
            conjuncts(value, &locals)
        }
        _ => None,
    }
}

fn statements(body: &[Stmt], locals: &mut Facts) -> Option<()> {
    for stmt in body {
        match stmt {
            Stmt::Let { name, value } | Stmt::Const { name, value } | Stmt::Assign { name, value } => {
                locals.insert(name.clone(), conjuncts(value, locals)?);
            }
            Stmt::If { condition: Expr::Variable(name), then_body, else_body } if else_body.is_empty() => {
                let mut facts = locals.get(name)?.clone();
                let mut branch = locals.clone();
                statements(then_body, &mut branch)?;
                // No other pre-existing local may change conditionally.
                if locals.iter().any(|(key, value)| key != name && branch.get(key) != Some(value)) { return None; }
                facts.extend(branch.get(name)?.clone());
                locals.insert(name.clone(), facts);
            }
            _ => return None,
        }
    }
    Some(())
}
