//! Effective column payload audience; unresolved observer edges stay explicit.
use super::*;
// @ref LLP 3000.036.004#121-column-read-intent — a private owner gate narrows only the column payload.
pub(super) fn admission(table:&snapback4_core::schema::Table,column:Option<&str>)->RuleExpr{
    let mut rules=vec![super::temporal::admission(table)];
    if let Some(owner)=column.and_then(|c|table.written_by.get(c)).filter(|o|!o.audience){
        rules.push(RuleExpr::Eq(RuleTerm::Field(owner.owner.clone()),RuleTerm::Viewer));
    }
    RuleExpr::And(rules)
}
