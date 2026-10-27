//! An explicit optional-presence allowance is a tautology, not an extra policy.
// @ref LLP 3000.036.004.002#s3-evaluated-answers — source presence declarations must not manufacture unrelated rollback restrictions.
use crate::security::Invariant;
use snapback4_core::{schema::{RuleExpr,RuleTerm},Value};
pub(crate) fn universal(inv:&Invariant)->bool{
 if inv.target!="always"||inv.operation.is_some()||inv.column.is_some()||inv.unsupported.is_some()||!inv.requirements.is_empty(){return false;}
 fn column(rule:&RuleExpr,equal:bool)->Option<&str>{
  let (a,b)=match (equal,rule){(true,RuleExpr::Eq(a,b))|(false,RuleExpr::Ne(a,b))=>(a,b),_=>return None};
  match(a,b){(RuleTerm::Field(name),RuleTerm::Literal(Value::Null))|(RuleTerm::Literal(Value::Null),RuleTerm::Field(name))=>Some(name),_=>None}
 }
 let Some(RuleExpr::Or(parts))=&inv.policy else{return false;};
 parts.len()==2&&[(0,1),(1,0)].into_iter().any(|(a,b)|column(&parts[a],true).is_some_and(|name|column(&parts[b],false)==Some(name)))
}
pub(crate) fn independent(bound:&crate::Bound)->bool{bound.invariants.iter().any(|inv|!universal(inv))}
#[cfg(test)]mod tests{
 #[test]fn only_an_exact_presence_tautology_is_unrestricted(){
  let head="table docs:\n  a: text ?\n  b: text ?\n  read <- allow\n  online only\n";
  for (predicate,yes)in [(".a = null or .a != null",true),("null != .a or null = .a",true),(".a = null or .b != null",false),(".a = null or viewer = 'service:owner'",false),(".a = null and .a != null",false),(".a != null",false)]{
   let bound=crate::compile(&[("schema.q".into(),format!("{head}invariant docs always {predicate}\n"))]);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);assert_eq!(super::universal(&bound.invariants[0]),yes,"{predicate}");
  }
  let bound=crate::compile(&[("schema.q".into(),format!("{head}invariant docs.read only true\n"))]);assert!(super::independent(&bound));
 }
}
