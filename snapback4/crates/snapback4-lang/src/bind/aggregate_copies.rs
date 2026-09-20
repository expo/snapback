//! A note about public columns whose values derive from reads.
use snapback4_core::schema::{RuleExpr, RuleTerm};
#[path = "aggregate_provenance.rs"]
mod provenance;
pub(super) use provenance::notes;

/// Only prove simple unconditional rules; a row/probe-dependent rule is
/// unknown, never assumed unrestricted. This is not an authorization checker.
pub fn truth(rule: &RuleExpr) -> Option<bool> {
    match rule {
        RuleExpr::Allow | RuleExpr::Public { .. } => Some(true),
        RuleExpr::Deny => Some(false),
        RuleExpr::Not(inner) => truth(inner).map(|value| !value),
        RuleExpr::And(terms) | RuleExpr::Or(terms) => {
            let and = matches!(rule, RuleExpr::And(_));
            let values: Vec<_> = terms.iter().map(truth).collect();
            if values.contains(&Some(!and)) { Some(!and) }
            else if values.iter().all(|value| *value == Some(and)) { Some(and) }
            else { None }
        }
        RuleExpr::Eq(left, right) | RuleExpr::Ne(left, right) => {
            let equal = match (left, right) {
                (RuleTerm::Viewer, RuleTerm::Viewer) => true,
                (RuleTerm::Literal(left), RuleTerm::Literal(right)) => left == right,
                _ => return None,
            };
            Some(if matches!(rule, RuleExpr::Eq(..)) { equal } else { !equal })
        }
        _ => None,
    }
}
