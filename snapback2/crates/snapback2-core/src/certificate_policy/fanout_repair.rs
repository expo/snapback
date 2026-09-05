//! Quarry edits for the proof failure, using the actual table, index, keys, and bound.
use super::*;
use crate::schema::{RuleExpr, RuleTerm};

pub(super) const NO_UNION: &str = "loop one scan, not a merge; per-recipient rows past one group are LLP 1016's continuation, not yet available";

pub(super) fn scan_text(scan: &Scan, index: Option<&str>) -> String {
    let take = match &scan.take {
        Bound::Literal(n) => n.to_string(),
        Bound::Arg { name, .. } => name.clone(),
    };
    let direction = if scan.order == Order::Asc {
        "first"
    } else {
        "last"
    };
    let after = scan
        .after
        .as_deref()
        .map(|e| format!(" after {}", expr(e)))
        .unwrap_or_default();
    format!(
        "{}[{}]{after} {direction} {take} by {}",
        scan.table,
        scan.prefix.iter().map(expr).collect::<Vec<_>>().join(", "),
        index.unwrap_or(&scan.index)
    )
}

pub(super) fn prefix(schema: &Schema, scan: &Scan, binding: Option<&str>) -> String {
    let table = &schema.tables[&scan.table];
    let index = &table.indexes[&scan.index];
    let mut columns = index.columns[..scan.prefix.len()].to_vec();
    let mut fields = BTreeSet::new();
    rule_fields(&table.rules.read, &mut fields);
    let mut repaired = scan.clone();
    for field in fields {
        if columns.contains(&field) {
            continue;
        }
        columns.push(field.clone());
        repaired
            .prefix
            .push(pinned_value(&table.rules.read, &field).unwrap_or(Expr::Variable(field)));
    }
    for field in &index.columns {
        if !columns.contains(field) {
            columns.push(field.clone());
        }
    }
    let name = format!("{}Scoped", scan.index);
    let read = scan_text(&repaired, Some(&name));
    let head = binding
        .map(|name| format!("for {name} in {read}:"))
        .unwrap_or(read);
    format!("by {name}: {}\n{head}", columns.join(", "))
}

fn pinned_value(rule: &RuleExpr, field: &str) -> Option<Expr> {
    match rule {
        RuleExpr::Eq(a, b) => {
            let value = if a == &RuleTerm::Field(field.to_owned()) {
                b
            } else if b == &RuleTerm::Field(field.to_owned()) {
                a
            } else {
                return None;
            };
            match value {
                RuleTerm::Viewer => Some(Expr::Input(Input::Viewer)),
                RuleTerm::Literal(value) => Some(Expr::Literal(value.clone())),
                _ => None,
            }
        }
        RuleExpr::And(rules) => rules.iter().find_map(|rule| pinned_value(rule, field)),
        _ => None,
    }
}

fn expr(value: &Expr) -> String {
    match value {
        Expr::Variable(name) => name.clone(),
        Expr::Input(input) => match input {
            Input::Viewer => "viewer",
            Input::Now => "now",
            Input::NewId => "newId",
            Input::ReadTime => "now",
        }
        .to_owned(),
        Expr::Field { base, name } => format!("{}.{name}", expr(base)),
        Expr::Literal(Value::String(s) | Value::Id(s)) => serde_json::to_string(s).unwrap(),
        Expr::Literal(Value::Int(n)) => n.to_string(),
        Expr::Literal(Value::Bool(b)) => b.to_string(),
        Expr::Literal(Value::Null) => "null".to_owned(),
        Expr::Array(values) => format!(
            "[{}]",
            values.iter().map(expr).collect::<Vec<_>>().join(", ")
        ),
        Expr::Object(fields) => format!(
            "{{ {} }}",
            fields
                .iter()
                .map(|(k, v)| format!("{k}: {}", expr(v)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Expr::Binary { op, left, right } => {
            let op = match op {
                BinaryOp::Eq | BinaryOp::SameValueZero => "=",
                BinaryOp::Ne => "!=",
                BinaryOp::Lt => "<",
                BinaryOp::Lte => "<=",
                BinaryOp::Gt => ">",
                BinaryOp::Gte => ">=",
                BinaryOp::Add => "+",
                BinaryOp::Sub => "-",
                BinaryOp::Mul => "*",
                BinaryOp::And => "and",
                BinaryOp::Or => "or",
            };
            format!("({} {op} {})", expr(left), expr(right))
        }
        Expr::Unary { op, value } => format!(
            "{}({})",
            if *op == UnaryOp::Not { "not " } else { "-" },
            expr(value)
        ),
        Expr::Get(read) | Expr::Exists(read) => format!(
            "{}{}[{}] by {}",
            if matches!(value, Expr::Exists(_)) {
                "exists "
            } else {
                ""
            },
            read.table,
            read.key.iter().map(expr).collect::<Vec<_>>().join(", "),
            read.index
        ),
        Expr::Scan(scan) => scan_text(scan, None),
        _ => "<key expression>".to_owned(),
    }
}
