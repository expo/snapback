//! Exact service principals named by compiled authorization facts.
use snapback4_core::{
    Value,
    ir::{BinaryOp, Expr, Input, Stmt},
    schema::{RuleExpr, RuleTerm},
};
use std::collections::BTreeSet;

fn principal(value: &Value) -> Option<&str> {
    match value {
        Value::Id(value) => value
            .strip_prefix("service:")
            .filter(|name| !name.is_empty())
            .map(|_| value.as_str()),
        _ => None,
    }
}

fn rule(rule: &RuleExpr, seats: &mut BTreeSet<String>, positive: bool) {
    match rule {
        RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Literal(value))
        | RuleExpr::Eq(RuleTerm::Literal(value), RuleTerm::Viewer)
            if positive =>
        {
            if let Some(value) = principal(value) {
                seats.insert(value.into());
            }
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => rules
            .iter()
            .for_each(|rule| self::rule(rule, seats, positive)),
        RuleExpr::Not(rule) => self::rule(rule, seats, !positive),
        _ => {}
    }
}

fn expression(expr: &Expr, seats: &mut BTreeSet<String>, positive: bool) {
    match expr {
        Expr::Binary {
            op: BinaryOp::Eq | BinaryOp::SameValueZero,
            left,
            right,
        } => match (&**left, &**right, positive) {
            (Expr::Input(Input::Viewer), Expr::Literal(value), true)
            | (Expr::Literal(value), Expr::Input(Input::Viewer), true) => {
                if let Some(value) = principal(value) {
                    seats.insert(value.into());
                }
            }
            _ => {}
        },
        Expr::Binary {
            op: BinaryOp::And | BinaryOp::Or,
            left,
            right,
        } => {
            expression(left, seats, positive);
            expression(right, seats, positive);
        }
        Expr::Unary {
            op: snapback4_core::ir::UnaryOp::Not,
            value,
        } => expression(value, seats, !positive),
        Expr::Block { body, value } => {
            statements(body, seats);
            expression(value, seats, positive);
        }
        _ => {}
    }
}

fn statements(body: &[Stmt], seats: &mut BTreeSet<String>) {
    for statement in body {
        match statement {
            Stmt::Require { condition, .. } => expression(condition, seats, true),
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                statements(then_body, seats);
                statements(else_body, seats);
            }
            Stmt::For { body, .. } => statements(body, seats),
            Stmt::Check { condition, .. } => expression(condition, seats, true),
            Stmt::WriteTarget {
                condition: Some(condition),
                ..
            } => statements(&condition.setup, seats),
            _ => {}
        }
    }
}

// @ref LLP 3000.000.000.002#10-wave-25-day-two-friction-dx8 — minted seats stay ordinary principals; this is advisory schema evidence, never a grant.
pub(crate) fn collect(bound: &snapback4_lang::Bound) -> BTreeSet<String> {
    let mut seats = BTreeSet::new();
    for table in bound.schema.tables.values() {
        for rule in [
            &table.rules.read,
            &table.rules.insert,
            &table.rules.update,
            &table.rules.delete,
        ] {
            self::rule(rule, &mut seats, true);
        }
        for rule in table.column_reads.values() {
            self::rule(rule, &mut seats, true);
        }
    }
    for program in &bound.programs {
        statements(&program.program.body, &mut seats);
    }
    seats.extend(
        bound
            .schema
            .schedules
            .iter()
            .filter_map(|schedule| schedule.service.clone()),
    );
    seats.extend(
        bound
            .schema
            .routes
            .values()
            .filter_map(|route| route.service.clone()),
    );
    seats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_authorization_facts_name_service_seats() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "use server\nuse identity\ntable rows:\n  role: enum('service:literal')\n  read <- viewer = 'service:reader'\n  insert <- viewer = 'service:writer' and allow\n  online only\nmutation grant():\n  require viewer = 'service:operator' else NO\n  return 'service:result'\nquery label():\n  return 'service:query-result'\naction run() <- viewer = 'service:runner'\nroute hook: post \"/hook\" as service:router\nschedule hourly every 1h as service:runner: run\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert_eq!(
            collect(&bound),
            [
                "service:operator",
                "service:reader",
                "service:router",
                "service:runner",
                "service:writer"
            ]
            .into_iter()
            .map(str::to_owned)
            .collect()
        );
    }
}
