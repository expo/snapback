//! Concrete predecessor-audience checks eliminate impossible Boolean valuations.
// @ref LLP 3000.036.004.002#s2-release-narrowing — the actual excluded creator must satisfy its predecessor's setter audience.
use super::*;
pub fn prior_allowed(bound:&Bound,policy:&RuleExpr,c:&Counterexample)->Option<bool>{
 if !c.current_execution||!c.reachability.is_reachable(){return None;}
 let deps=stability::dependencies(bound,policy);
 for step in &c.history{
  let p=&bound.programs.iter().find(|p|p.program.name==step.operation)?.program;
  if super::super::release_authority::opaque_program(p){return None;}
  let changed=ir::write_tables(p).into_iter().map(|(t,_)|t).chain(stability::implicit(bound,p)).collect::<BTreeSet<_>>();
  if !changed.is_disjoint(&deps){return None;}
 }
 let now=c.history.last()?.clock.unwrap_or(NOW);
 rules::evaluate(policy,&c.viewer,c.old.as_ref(),&c.row,false,&mut Snapshot{schema:&bound.schema,rows:&c.supporting_rows,now}).ok()
}

pub fn retained_value(inv:&Invariant,c:&Counterexample)->bool{
 let Some(column)=&inv.column else{return false;};let Ok(id)=c.row.field("id")else{return false;};
 let Some(rows)=c.history.last().and_then(|step|step.result.get("committedRows")).and_then(|v|serde_json::from_value::<BTreeMap<String,Vec<Value>>>(v.clone()).ok())else{return false;};
 rows.get(&inv.table).into_iter().flatten().any(|row|row.field("id").ok()==Some(id)&&row.field(column).ok()==c.row.field(column).ok())
}
