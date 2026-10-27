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

/// Nonempty current setter audience, proved only for the selected exact shell.
/// Judge inputs and the same row's real read/write gates without inventing a
/// successful setter trace. Unsupported policy/reference evaluation is unknown.
pub fn setter_actor(bound:&Bound,inv:&Invariant,setter:&str,argument:&str,c:&Counterexample)->Option<String>{
 if !c.current_execution||!c.reachability.is_reachable(){return None;}
 let program=&bound.programs.iter().find(|p|p.program.name==setter)?.program;
 let column=inv.column.as_deref()?;let table=&bound.schema.tables[&inv.table];
 if table.immutable_fields().any(|name|name==column){return None;}
 let rows=c.history.last()?.result.get("committedRows").and_then(|v|serde_json::from_value::<BTreeMap<String,Vec<Value>>>(v.clone()).ok())?;
 let id=c.row.field("id").ok()?;
 let row=rows.get(&inv.table)?.iter().find(|r|r.field("id").ok()==Some(id))?;
 let now=c.history.last()?.clock.unwrap_or(NOW);
 let reads_target=ir::read_sites(program).iter().any(|r|r.table==inv.table&&r.kind!="write target");
 for actor in histories::actors(bound,&rows).into_iter().take(128){
  let judgment=|policy:&RuleExpr|rules::evaluate(policy,&actor,Some(row),row,false,&mut Snapshot{schema:&bound.schema,rows:&rows,now}).ok();
  if judgment(inv.policy.as_ref()?)!=Some(true)||judgment(&table.update_rule_judged())!=Some(true)||reads_target&&judgment(&table.rules.read)!=Some(true)||table.column_writes.get(column).is_some_and(|r|judgment(r)!=Some(true))||table.frozen_columns.get(column).is_some_and(|r|judgment(r)!=Some(false)){continue;}
  let mut args=arguments(&program.args,0)?;args.insert(argument.into(),c.row.field(column).ok()?.clone());
  for(name,kind)in &program.args{if matches!(kind,ir::ArgType::Ref{table}if table==&inv.table){args.insert(name.clone(),id.clone());}}
  if snapback4_core::engine::validate::validate_inputs(&bound.schema,program,&mut args).is_ok(){return Some(actor);}
 }None
}
