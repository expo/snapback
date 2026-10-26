//! Empty approval initialization is not an authored column authority event.
// @ref LLP 3000.036.004.000#9-integration-24-wave-26-precision — insert initialization and actual changed edits are separate boundaries.
use super::*;
use snapback4_core::{Value,schema::ColumnDefault};

// @ref LLP 3000.036.004.000#10-wave-30-default-initialization-dx13 — authored write intent and runtime grants share literal initialization.
fn declared_default(bound:&Bound,inv:&Invariant,row:&Value)->bool {
    inv.column.as_ref().is_some_and(|column|matches!(
        bound.schema.tables[&inv.table].defaults.get(column),
        Some(ColumnDefault::Literal(value)) if row.field(column).ok()==Some(value)))
}
pub(super) fn empty_creation(bound:&Bound,inv:&Invariant,old:Option<&Value>,row:&Value)->bool {
    inv.target=="write" && old.is_none() && inv.column.as_ref().is_some_and(|column|
        matches!(row.field(column),Ok(Value::Null)) || declared_default(bound,inv,row))
}
pub(super) fn policy(bound:&Bound,inv:&Invariant,effect:&str)->Option<RuleExpr> {
    let policy=inv.policy.clone()?;
    if effect!="insert"||inv.target!="write" {return Some(policy);}
    let Some(column)=&inv.column else{return Some(policy);};
    Some(RuleExpr::Or(vec![bound.schema.tables[&inv.table].column_initialization(column),policy]))
}

#[cfg(test)]mod tests {
 use super::*;
 #[test]fn clearing_or_initializing_a_sibling_does_not_exempt_an_edit(){
  let b=crate::compile(&[("schema.q".into(),"table docs:\n  approved: bool default false\n  reason: text ?\n  read <- allow\n  insert <- allow\n  online only\ninvariant docs.approved write only deny\ninvariant docs.reason write only deny\n".into())]);
  assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
  let row=Value::Row(std::collections::BTreeMap::from([("approved".into(),Value::Bool(false)),("reason".into(),Value::Null)]).into());
  for inv in &b.invariants {assert!(empty_creation(&b,inv,None,&row));assert!(!empty_creation(&b,inv,Some(&row),&row));assert_eq!(policy(&b,inv,"update"),inv.policy);}
 }
}
