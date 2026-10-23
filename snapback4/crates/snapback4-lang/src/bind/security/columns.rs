//! Effective column payload audience; unresolved observer edges stay explicit.
use super::*;
// @ref LLP 3000.036.004#121-column-read-intent — a private owner gate narrows only the column payload.
pub(super) fn admission(table:&snapback4_core::schema::Table,column:Option<&str>)->RuleExpr{
    let mut rules=vec![super::temporal::admission(table)];
    if let Some(owner)=column.and_then(|c|table.written_by.get(c)).filter(|o|!o.audience){
        rules.push(RuleExpr::Eq(RuleTerm::Field(owner.owner.clone()),RuleTerm::Viewer));
    }
    if let Some(rule)=column.and_then(|c|table.column_reads.get(c)) { rules.push(rule.clone()); }
    RuleExpr::And(rules)
}

/// Every enforcement gate can confer authority or introduce a raw witness edge.
pub(super) fn rules(table:&snapback4_core::schema::Table)->impl Iterator<Item=&RuleExpr>{
    [&table.rules.read,&table.rules.insert,&table.rules.update,&table.rules.delete].into_iter().chain(table.column_reads.values()).chain(table.column_writes.values()).chain(table.frozen_columns.values())
}

/// Column effects carry effective row/owner authority, not a standalone cell gate.
pub(super) fn effects(table:&snapback4_core::schema::Table)->impl Iterator<Item=(String,RuleExpr)>+'_ {
    [("read".into(),table.rules.read.clone()),("insert".into(),table.guarded_rule(Effect::Insert).into_owned()),("update".into(),table.guarded_rule(Effect::Update).into_owned()),("delete".into(),table.rules.delete.clone())].into_iter()
        .chain(table.column_writes.iter().map(|(column,rule)|(format!("{column} write"),rule.clone())))
        .chain(table.frozen_columns.iter().map(|(column,rule)|(format!("{column} immutable when"),rule.clone())))
        .chain(table.column_reads.keys().map(|column|(format!("{column} read"),admission(table,Some(column)))))
}
