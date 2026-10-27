//! Evaluable decision answers over a current unredacted engine witness.
// @ref LLP 3000.036.004.002#s3-evaluated-answers — prose and saved redacted evidence never establish a true premise.
use super::*;
#[derive(Clone,Debug,Serialize)]
pub struct Evaluation {pub intent:String,pub status:String,pub detail:String}
fn result(line:&str,status:&str,detail:impl Into<String>)->Evaluation{Evaluation{intent:line.into(),status:status.into(),detail:detail.into()}}
/// `allow T.operation when P` is an explicit decision allowance, lowered through
/// the same Quarry invariant binder. It grants no runtime permission.
pub fn evaluate(sources:&[(String,String)],bound:&Bound,subject:&Invariant,c:&Counterexample,line:&str)->Evaluation{
 if line.contains(['\n','\r',';']){return result(line,"invalid","one intent line is required");}
 let mut allowance_effect=None;
 let assertion=if let Some(allow)=line.strip_prefix("allow "){
  let Some((target,predicate))=allow.split_once(" when ")else{return result(line,"invalid","use allow TABLE.OPERATION when P");};
  let target=if let Some(column)=target.strip_suffix(" insert"){
   allowance_effect=Some("insert");format!("{column} write")
  }else{target.to_owned()};
  format!("invariant {target} only {predicate}")
 }else if line.starts_with("invariant "){line.to_owned()}else{return result(line,"invalid","use a Quarry invariant or allow TABLE.OPERATION when P");};
 let mut selected=sources.to_vec();selected.push(("$sec12-answer.q".into(),format!("{assertion}\n")));
 let checked=crate::compile(&selected);
 if !checked.diagnostics.is_empty(){return result(line,"invalid",checked.diagnostics.iter().map(|d|d.code.as_str()).collect::<Vec<_>>().join(", "));}
 let answers=checked.invariants.iter().filter(|i|i.site.file=="$sec12-answer.q").collect::<Vec<_>>();
 if answers.len()!=1{return result(line,"invalid","exactly one bound intent is required");}let inv=answers[0];
 if allowance_effect.is_some_and(|effect|effect!=c.effect)||inv.table!=subject.table||inv.column!=subject.column
  ||!(inv.operation.as_ref()==Some(&c.operation)||inv.operation.is_none()&&(inv.target=="always"||inv.target=="write"&&matches!(c.effect.as_str(),"insert"|"update"))||inv.operation.is_none()&&inv.target==c.effect){
  return result(line,"invalid","intent must cover the witnessed table, operation/effect and column");
 }
 if !c.current_execution{return result(line,"unknown","saved evidence is not a current execution");}
 if !c.reachability.is_reachable()||c.history.is_empty(){return result(line,"unknown","no current executed history");}
 // Focal old/next images are actual boundary inputs. Population predicates may
 // use the recorded initial population only when every history operation leaves
 // all transitive read/authority dependencies unchanged, including implicit writes.
 let mut reference=false;
 if let Some(mut syntax)=inv.syntax.clone(){crate::bind::intent_walk::expression(&mut syntax,&mut |e|if let ast::Expr::Member{base,..}=e&&!matches!(base.as_ref(),ast::Expr::Focal{..}){reference=true;});}
 if reference{return result(line,"unknown","reference-member answers require live boundary replay; repair source or use a boundary-local predicate");}
 let mut dependencies=inv.dependencies();dependencies.remove(&inv.table);
 if let Some(mut syntax)=inv.syntax.clone(){crate::bind::intent_walk::expression(&mut syntax,&mut |e|if let ast::Expr::Read(read)|ast::Expr::Exists{read,..}=e{dependencies.insert(read.table.clone());});}
 if let Some(policy)=&inv.policy{dependencies.extend(stability::dependencies(bound,policy));}
 for step in &c.history{
  let Some(p)=bound.programs.iter().find(|p|p.program.name==step.operation)else{return result(line,"unknown","history operation unavailable");};
  if super::super::release_authority::opaque_program(&p.program){return result(line,"unknown","opaque history requires boundary replay");}
  let changed=ir::write_tables(&p.program).into_iter().map(|(t,_)|t).chain(stability::implicit(bound,&p.program)).collect::<BTreeSet<_>>();
  if !changed.is_disjoint(&dependencies){return result(line,"unknown","intent population changed during the history; repair source or use boundary-local intent");}
 }
 let now=c.history.last().and_then(|step|step.clock).unwrap_or(NOW);
 let judgment=policy_at(bound,inv,&c.supporting_rows,&c.viewer,c.old.as_ref(),&c.row,now);
 let judgment=if judgment==Ok(true)&&c.effect=="update"{
  c.old.as_ref().map(|old|policy_at(bound,inv,&c.supporting_rows,&c.viewer,Some(old),old,now)).unwrap_or_else(||Err("missing old image".into()))
 }else{judgment};
 match judgment{Ok(true)=>result(line,"holds","predicate holds on the current witnessed boundary"),Ok(false)=>result(line,"refuted","predicate is false on the current witnessed boundary"),Err(why)=>result(line,"unknown",why)}
}

#[cfg(test)]mod tests{
 use super::*;
 pub(super) fn witness()->(Vec<(String,String)>,Bound,Invariant,Counterexample){
  let source="table docs:\n  signed: bool default false\n  approved: bool default false\n  status: enum('draft', 'done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(signed: bool):\n  return insert docs { signed }\nmutation finish(doc: docs):\n  update docs[doc] { status: 'done' }\n  return null\ninvariant docs.finish only not .signed or .approved\n";
  let sources=vec![("schema.q".into(),source.into())];let bound=crate::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
  let inv=bound.invariants[0].clone();let mut campaign=Campaign::work_bounded(3072);generated_campaign(&bound,&mut campaign,false);
  let c=campaign.violations.into_iter().find(|c|c.operation=="finish"&&c.reachability.is_reachable()&&c.row.field("signed").ok()==Some(&Value::Bool(true))).expect("actual false-premise witness");(sources,bound,inv,c)
 }
 #[test]fn false_premises_and_wrong_targets_cannot_close_a_gate(){
  let (sources,bound,inv,c)=witness();
  for line in ["invariant docs.finish only not .signed or .approved","allow docs.finish when not .signed or .approved"]{assert_eq!(evaluate(&sources,&bound,&inv,&c,line).status,"refuted");}
  assert_eq!(evaluate(&sources,&bound,&inv,&c,"allow docs.finish when .signed and not .approved").status,"holds");
  for line in ["the spec permits progress","allow docs.create when allow","invariant docs.read only allow","allow docs.finish when allow\ninvariant docs always allow"]{assert_eq!(evaluate(&sources,&bound,&inv,&c,line).status,"invalid");}
 }
 #[test]fn observed_next_image_does_not_hide_a_false_old_image(){
  let (sources,bound,inv,c)=witness();assert_eq!(evaluate(&sources,&bound,&inv,&c,"allow docs.finish when .status = 'done'").status,"refuted");
 }
}

#[cfg(test)]mod regression_tests{
 use super::*;
 #[test]fn saved_evidence_and_unsupported_reference_members_never_supply_truth(){
  let (mut sources,_,inv,c)=super::tests::witness();
  let bound=crate::compile(&sources);
  let saved:Counterexample=serde_json::from_value(serde_json::to_value(&c).unwrap()).unwrap();
  assert!(!saved.current_execution);
  assert_eq!(evaluate(&sources,&bound,&inv,&saved,"allow docs.finish when .signed").status,"unknown");
  sources[0].1=sources[0].1.replace("table docs:","table parents:\n  limit: int\n  read <- allow\n  online only\ntable docs:\n  parent: parents ?");
  let bound=crate::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
  assert_eq!(evaluate(&sources,&bound,&inv,&c,"allow docs.finish when .parent.limit + 0 > 0").status,"unknown");
 }
 #[test]fn a_column_answer_must_name_that_column_and_write_excludes_delete_and_read(){
  let (sources,bound,mut inv,mut c)=super::tests::witness();
  inv.column=Some("signed".into());
  assert_eq!(evaluate(&sources,&bound,&inv,&c,"allow docs.finish when .signed").status,"invalid");
  assert_eq!(evaluate(&sources,&bound,&inv,&c,"allow docs.signed update when .signed").status,"holds");
  inv.column=None;
  for effect in ["delete","read"]{c.effect=effect.into();assert_eq!(evaluate(&sources,&bound,&inv,&c,"invariant docs.write only allow").status,"invalid");}
 }
}
