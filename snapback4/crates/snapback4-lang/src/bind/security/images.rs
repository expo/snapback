//! Equal-image substitution only for engine-enforced immutable local fields.
// @ref LLP 3000.036.004#111-avoid-duplicate-concrete-searches — no reference or mutable-field equality is assumed.
use super::*;
use snapback4_core::schema::{Table,Constraint};

pub(super) fn stable(table:&Table,rule:&RuleExpr)->RuleExpr{
    fn term(table:&Table,value:&mut RuleTerm){
        if let RuleTerm::OldField(field)=value && (field=="id"||table.constraints.iter().any(|c|matches!(c,Constraint::Immutable{fields} if fields.contains(field)))) {
            *value=RuleTerm::Field(field.clone());
        }
    }
    fn walk(table:&Table,rule:&mut RuleExpr){match rule{
        RuleExpr::Eq(a,b)|RuleExpr::Ne(a,b)|RuleExpr::Compare(_,a,b)=>{term(table,a);term(table,b);},
        RuleExpr::Exists{key,equalities,..}|RuleExpr::Created{key,equalities,..}=>{
            for value in key.iter_mut().chain(equalities.iter_mut().map(|(_,t)|t)){term(table,value);}
        },
        RuleExpr::And(xs)|RuleExpr::Or(xs)=>for rule in xs{walk(table,rule)},
        RuleExpr::Not(rule)=>walk(table,rule),
        RuleExpr::Allow|RuleExpr::Deny|RuleExpr::Public{..}=>{},
    }}
    let mut out=rule.clone();walk(table,&mut out);out
}
pub(super) fn update(table:&Table,policy:&RuleExpr)->Result<bool,String>{
    kernel::implies(&stable(table,&table.update_rule_judged()),&stable(table,&policy.old_and_next()))
}
