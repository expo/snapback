//! Equal-image substitution only for engine-enforced immutable local fields.
// @ref LLP 3000.036.004#111-avoid-duplicate-concrete-searches — no reference or mutable-field equality is assumed.
use super::*;
use snapback4_core::schema::{Table,Constraint};

pub(super) fn stable(table:&Table,rule:&RuleExpr)->RuleExpr{
    let mut out=rule.clone();
    out.terms_mut(&mut |term| {
        if let RuleTerm::OldField(field)=term && (field=="id"||table.constraints.iter().any(|c|matches!(c,Constraint::Immutable{fields} if fields.contains(field)))) {
            *term=RuleTerm::Field(field.clone());
        }
    });out
}
pub(super) fn update(table:&Table,policy:&RuleExpr)->Result<bool,String>{
    kernel::implies(&stable(table,&table.update_rule_judged()),&stable(table,&policy.old_and_next()))
}
